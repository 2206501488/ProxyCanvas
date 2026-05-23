import hashlib
import json
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

import config


@dataclass(frozen=True)
class ReferenceImage:
    data: bytes
    content_type: str
    suffix: str
    cache_hit: bool


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


REFERENCE_CACHE_DIR = Path(os.getenv(
    "APIMART_REFERENCE_CACHE_DIR",
    str(Path(config.OPENAI_SAVE_DIR) / "reference_cache"),
))
REFERENCE_CACHE_TTL_SECONDS = _env_int("APIMART_REFERENCE_CACHE_TTL_SECONDS", 24 * 60 * 60)
REFERENCE_CACHE_MAX_BYTES = _env_int("APIMART_REFERENCE_CACHE_MAX_BYTES", 2 * 1024 * 1024 * 1024)
REFERENCE_CACHE_MAX_FILE_BYTES = _env_int("APIMART_REFERENCE_CACHE_MAX_FILE_BYTES", 50 * 1024 * 1024)
REFERENCE_CACHE_CLEAN_INTERVAL_SECONDS = _env_int("APIMART_REFERENCE_CACHE_CLEAN_INTERVAL_SECONDS", 600)

_CACHE_LOCK = threading.RLock()
_LAST_CLEANUP_AT = 0.0


def load_reference_image(url: str, *, timeout: int = 30, proxies: Any = None) -> ReferenceImage:
    """Load a remote reference image with a small persistent URL hash cache."""
    now = time.time()
    key = _cache_key(url)
    with _CACHE_LOCK:
        REFERENCE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _maybe_cleanup_locked(now)
        cached = _read_cache_locked(key, url, now)
        if cached is not None:
            return cached

    response = requests.get(url, timeout=timeout, proxies=config.HTTP_PROXIES if proxies is None else proxies)
    response.raise_for_status()
    data = response.content
    content_type = _content_type(response.headers.get("Content-Type", ""))
    suffix = _suffix_from_content_type(content_type) or _suffix_from_url(url)

    if len(data) > REFERENCE_CACHE_MAX_FILE_BYTES:
        return ReferenceImage(data=data, content_type=content_type, suffix=suffix, cache_hit=False)

    with _CACHE_LOCK:
        REFERENCE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _write_cache_locked(key, url, data, content_type, suffix, now)
        _cleanup_locked(now, trim_only=True)

    return ReferenceImage(data=data, content_type=content_type, suffix=suffix, cache_hit=False)


def cleanup_reference_cache(*, force: bool = False) -> None:
    with _CACHE_LOCK:
        REFERENCE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cleanup_locked(time.time(), force=force)


def _read_cache_locked(key: str, url: str, now: float) -> ReferenceImage | None:
    meta_path = _meta_path(key)
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _delete_entry_locked(key)
        return None

    if meta.get("url") != url:
        _delete_entry_locked(key)
        return None

    file_name = str(meta.get("file") or "")
    image_path = REFERENCE_CACHE_DIR / file_name
    last_used_at = float(meta.get("last_used_at") or meta.get("created_at") or 0)
    if not file_name or not image_path.exists() or _is_expired(last_used_at, now):
        _delete_entry_locked(key)
        return None

    try:
        data = image_path.read_bytes()
    except OSError:
        _delete_entry_locked(key)
        return None

    meta["last_used_at"] = now
    meta["size"] = len(data)
    _atomic_write_json(meta_path, meta)
    return ReferenceImage(
        data=data,
        content_type=str(meta.get("content_type") or "image/png"),
        suffix=str(meta.get("suffix") or _suffix_from_url(file_name)),
        cache_hit=True,
    )


def _write_cache_locked(key: str, url: str, data: bytes, content_type: str, suffix: str, now: float) -> None:
    image_name = f"{key}{suffix}"
    image_path = REFERENCE_CACHE_DIR / image_name
    tmp_path = REFERENCE_CACHE_DIR / f"{key}.tmp"
    tmp_path.write_bytes(data)
    os.replace(tmp_path, image_path)
    _atomic_write_json(_meta_path(key), {
        "url": url,
        "file": image_name,
        "content_type": content_type,
        "suffix": suffix,
        "size": len(data),
        "created_at": now,
        "last_used_at": now,
    })


def _maybe_cleanup_locked(now: float) -> None:
    global _LAST_CLEANUP_AT
    if now - _LAST_CLEANUP_AT < REFERENCE_CACHE_CLEAN_INTERVAL_SECONDS:
        return
    _cleanup_locked(now)
    _LAST_CLEANUP_AT = now


def _cleanup_locked(now: float, *, force: bool = False, trim_only: bool = False) -> None:
    entries: list[dict[str, Any]] = []
    for meta_path in REFERENCE_CACHE_DIR.glob("*.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            key = meta_path.stem
            image_path = REFERENCE_CACHE_DIR / str(meta.get("file") or "")
            last_used_at = float(meta.get("last_used_at") or meta.get("created_at") or 0)
            if not image_path.exists():
                _delete_entry_locked(key)
                continue
            if not trim_only and _is_expired(last_used_at, now):
                _delete_entry_locked(key)
                continue
            size = int(meta.get("size") or image_path.stat().st_size)
            entries.append({"key": key, "last_used_at": last_used_at, "size": size})
        except Exception:
            _delete_entry_locked(meta_path.stem)

    referenced_files = set()
    for entry_meta_path in REFERENCE_CACHE_DIR.glob("*.json"):
        try:
            entry_meta = json.loads(entry_meta_path.read_text(encoding="utf-8"))
            referenced_files.add(str(entry_meta.get("file") or ""))
        except Exception:
            pass
    for image_path in REFERENCE_CACHE_DIR.iterdir():
        if image_path.suffix.lower() in {".json", ".tmp"}:
            continue
        if image_path.name not in referenced_files:
            try:
                image_path.unlink()
            except OSError:
                pass

    total_size = sum(entry["size"] for entry in entries)
    if not force and total_size <= REFERENCE_CACHE_MAX_BYTES:
        return

    target_size = int(REFERENCE_CACHE_MAX_BYTES * 0.8)
    for entry in sorted(entries, key=lambda item: item["last_used_at"]):
        if total_size <= target_size:
            break
        _delete_entry_locked(str(entry["key"]))
        total_size -= int(entry["size"])


def _delete_entry_locked(key: str) -> None:
    meta_path = _meta_path(key)
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        file_name = str(meta.get("file") or "")
    except Exception:
        file_name = ""

    paths = [meta_path, meta_path.with_suffix(".json.tmp"), REFERENCE_CACHE_DIR / file_name if file_name else None]
    paths.extend(REFERENCE_CACHE_DIR.glob(f"{key}.*"))
    for path in paths:
        if path is None:
            continue
        try:
            path.unlink()
        except OSError:
            pass


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    tmp_path = path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp_path, path)


def _cache_key(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()


def _meta_path(key: str) -> Path:
    return REFERENCE_CACHE_DIR / f"{key}.json"


def _is_expired(last_used_at: float, now: float) -> bool:
    return REFERENCE_CACHE_TTL_SECONDS > 0 and now - last_used_at > REFERENCE_CACHE_TTL_SECONDS


def _content_type(value: str) -> str:
    normalized = value.lower().split(";", 1)[0].strip()
    return normalized if normalized.startswith("image/") else "image/png"


def _suffix_from_content_type(content_type: str) -> str:
    if content_type in {"image/jpeg", "image/jpg"}:
        return ".jpg"
    if content_type == "image/webp":
        return ".webp"
    if content_type == "image/png":
        return ".png"
    return ""


def _suffix_from_url(url: str) -> str:
    path = url.lower().split("?", 1)[0]
    for suffix in (".png", ".jpg", ".jpeg", ".webp"):
        if path.endswith(suffix):
            return ".jpg" if suffix == ".jpeg" else suffix
    return ".png"
