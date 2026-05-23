from __future__ import annotations

import mimetypes
import os
from pathlib import Path
from urllib.parse import quote

import config


ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tif"}
_storage_base_cache: Path | None = None
_storage_base_raw: str | None = None


def allowed_roots() -> list[Path]:
    return [storage_base()]


def storage_base() -> Path:
    global _storage_base_cache, _storage_base_raw

    raw = str(config.OPENAI_SAVE_DIR)
    if _storage_base_cache is None or _storage_base_raw != raw:
        _storage_base_cache = Path(raw).resolve()
        _storage_base_raw = raw
    return _storage_base_cache


def absolute_path_for_relative_path(relative_path: str | os.PathLike[str] | None) -> Path | None:
    if relative_path is None:
        return None
    rel = Path(str(relative_path))
    if rel.is_absolute() or rel.drive or rel.root or ".." in rel.parts:
        return None
    return storage_base() / rel


def resolve_storage_path(relative_path: str | os.PathLike[str] | None) -> Path | None:
    root = storage_base()
    path = absolute_path_for_relative_path(relative_path)
    if path is None:
        return None
    path = path.resolve()
    try:
        path.relative_to(root)
        return path
    except ValueError:
        return None


def path_to_relative_path(raw_path: str | os.PathLike[str] | None) -> str | None:
    if not raw_path:
        return None
    path = Path(raw_path).resolve()
    try:
        return path.relative_to(storage_base()).as_posix()
    except ValueError:
        return None
    return None


def resolve_allowed_path(
    raw_path: str | os.PathLike[str] | None = None,
    *,
    relative_path: str | os.PathLike[str] | None = None,
) -> Path | None:
    ref_path = resolve_storage_path(relative_path)
    if ref_path is not None:
        return ref_path
    if raw_path is None:
        return None
    raw = Path(str(raw_path))
    if not raw.is_absolute():
        return resolve_storage_path(raw_path)
    path = Path(raw_path).resolve()
    try:
        path.relative_to(storage_base())
        return path
    except ValueError:
        pass
    return None


def is_allowed_image_filename(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_IMAGE_EXTENSIONS


def guess_mimetype(path: str | os.PathLike[str]) -> str:
    mime, _ = mimetypes.guess_type(str(path))
    return mime or "application/octet-stream"


def serve_url_for_path(path: str | os.PathLike[str]) -> str:
    relative = path_to_relative_path(path)
    if relative:
        return f"/api/serve-image?path={quote(relative, safe='')}"
    return f"/api/serve-image?path={quote(str(path), safe='')}"


def import_dir() -> Path:
    path = Path(config.OPENAI_SAVE_DIR) / "imports"
    path.mkdir(parents=True, exist_ok=True)
    return path
