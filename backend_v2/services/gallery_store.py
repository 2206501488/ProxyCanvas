from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from config import GALLERY_DB_PATH, OPENAI_SAVE_DIR


GALLERY_FILE = Path(OPENAI_SAVE_DIR) / "gallery.json"
GALLERY_DB = Path(GALLERY_DB_PATH)
_gallery_lock = threading.RLock()
_initialized = False

KNOWN_IMAGE_KEYS = {
    "id",
    "status",
    "error",
    "localPath",
    "savedFilePath",
    "thumbnail",
    "width",
    "height",
    "prompt",
    "apiType",
    "params",
    "createdAt",
    "originalUrl",
    "isFavorite",
    "tags",
}


def _empty_gallery() -> dict[str, Any]:
    return {"images": [], "tags": []}


def load_gallery() -> dict[str, Any]:
    _ensure_ready()
    with _gallery_lock, _connect() as connection:
        image_rows = connection.execute(
            """
            SELECT *
            FROM gallery_images
            ORDER BY created_at DESC, id ASC
            """
        ).fetchall()
        tag_rows = connection.execute(
            """
            SELECT image_id, tag
            FROM gallery_image_tags
            ORDER BY image_id ASC, tag ASC
            """
        ).fetchall()

    tags_by_image: dict[str, list[str]] = {}
    all_tags: set[str] = set()
    for row in tag_rows:
        tag = row["tag"]
        tags_by_image.setdefault(row["image_id"], []).append(tag)
        all_tags.add(tag)

    return {
        "images": [_row_to_image(row, tags_by_image.get(row["id"], [])) for row in image_rows],
        "tags": sorted(all_tags),
    }


def save_gallery(data: dict[str, Any]) -> None:
    """Replace the SQLite gallery with the provided data.

    Kept for compatibility with older callers; normal writes should use
    upsert_image, add_images, delete_image, or replace_tags.
    """
    images = data.get("images", []) if isinstance(data, dict) else []
    if not isinstance(images, list):
        images = []

    _ensure_ready()
    with _gallery_lock, _connect() as connection:
        connection.execute("DELETE FROM gallery_image_tags")
        connection.execute("DELETE FROM gallery_images")
        _insert_images(connection, [image for image in images if isinstance(image, dict)])
        connection.commit()


def upsert_image(image: dict[str, Any]) -> bool:
    """Insert or update an image. Returns True when inserted, False when updated."""
    if not isinstance(image, dict) or not image.get("id"):
        raise ValueError("gallery image id is required")

    _ensure_ready()
    image_id = str(image["id"])
    with _gallery_lock, _connect() as connection:
        existing = connection.execute("SELECT 1 FROM gallery_images WHERE id = ?", (image_id,)).fetchone()
        _insert_images(connection, [image])
        connection.commit()
        return existing is None


def delete_image(image_id: str) -> tuple[bool, str | None]:
    """Delete a gallery record. Returns (deleted, saved_file_path)."""
    _ensure_ready()
    with _gallery_lock, _connect() as connection:
        row = connection.execute(
            "SELECT saved_file_path, local_path FROM gallery_images WHERE id = ?",
            (image_id,),
        ).fetchone()
        if not row:
            return False, None

        connection.execute("DELETE FROM gallery_image_tags WHERE image_id = ?", (image_id,))
        connection.execute("DELETE FROM gallery_images WHERE id = ?", (image_id,))
        connection.commit()
        return True, row["saved_file_path"] or _path_from_serve_url(row["local_path"] or "")


def replace_tags(tags: list[str]) -> None:
    """Compatibility hook for the old JSON-level tag list.

    Tags are now derived from per-image tag rows, matching what the frontend
    actually uses. The requested list is intentionally not allowed to create
    tags that no image owns.
    """
    _ensure_ready()


def add_images(images: list[dict[str, Any]]) -> None:
    if not images:
        return

    _ensure_ready()
    with _gallery_lock, _connect() as connection:
        _insert_images(connection, [image for image in images if isinstance(image, dict) and image.get("id")])
        connection.commit()


def _ensure_ready() -> None:
    global _initialized
    if _initialized:
        return

    with _gallery_lock:
        if _initialized:
            return
        GALLERY_DB.parent.mkdir(parents=True, exist_ok=True)
        with _connect() as connection:
            _init_db(connection)
            if _is_gallery_empty(connection):
                _migrate_json_gallery(connection)
            connection.commit()
        _initialized = True


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(GALLERY_DB, timeout=30, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    return connection


def _init_db(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS gallery_images (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            error_json TEXT,
            local_path TEXT NOT NULL,
            saved_file_path TEXT,
            thumbnail TEXT,
            width INTEGER,
            height INTEGER,
            prompt TEXT NOT NULL,
            api_type TEXT NOT NULL,
            params_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            original_url_json TEXT,
            is_favorite INTEGER NOT NULL DEFAULT 0,
            extra_json TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS gallery_image_tags (
            image_id TEXT NOT NULL,
            tag TEXT NOT NULL,
            PRIMARY KEY (image_id, tag),
            FOREIGN KEY (image_id) REFERENCES gallery_images(id) ON DELETE CASCADE
        )
        """
    )
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_created ON gallery_images(created_at)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_api_type ON gallery_images(api_type)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_favorite ON gallery_images(is_favorite)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_tags_tag ON gallery_image_tags(tag)")


def _is_gallery_empty(connection: sqlite3.Connection) -> bool:
    count = connection.execute("SELECT COUNT(*) FROM gallery_images").fetchone()[0]
    return int(count or 0) == 0


def _migrate_json_gallery(connection: sqlite3.Connection) -> None:
    data = _load_json_gallery()
    images = data.get("images", []) if isinstance(data, dict) else []
    if not isinstance(images, list) or not images:
        return
    _insert_images(connection, [image for image in images if isinstance(image, dict) and image.get("id")])


def _load_json_gallery() -> dict[str, Any]:
    if not GALLERY_FILE.exists():
        return _empty_gallery()
    try:
        with GALLERY_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return _empty_gallery()
    return data if isinstance(data, dict) else _empty_gallery()


def _insert_images(connection: sqlite3.Connection, images: list[dict[str, Any]]) -> None:
    timestamp = _now_iso()
    for image in images:
        normalized = _normalize_image(image)
        image_id = normalized["id"]
        connection.execute(
            """
            INSERT INTO gallery_images (
                id, status, error_json, local_path, saved_file_path, thumbnail,
                width, height, prompt, api_type, params_json, created_at,
                original_url_json, is_favorite, extra_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                error_json = excluded.error_json,
                local_path = excluded.local_path,
                saved_file_path = excluded.saved_file_path,
                thumbnail = excluded.thumbnail,
                width = excluded.width,
                height = excluded.height,
                prompt = excluded.prompt,
                api_type = excluded.api_type,
                params_json = excluded.params_json,
                created_at = excluded.created_at,
                original_url_json = excluded.original_url_json,
                is_favorite = excluded.is_favorite,
                extra_json = excluded.extra_json,
                updated_at = excluded.updated_at
            """,
            (
                image_id,
                normalized["status"],
                _json_dumps(normalized.get("error")),
                normalized["localPath"],
                normalized.get("savedFilePath"),
                normalized.get("thumbnail"),
                normalized.get("width"),
                normalized.get("height"),
                normalized["prompt"],
                normalized["apiType"],
                _json_dumps(normalized["params"]),
                normalized["createdAt"],
                _json_dumps(normalized.get("originalUrl")),
                1 if normalized["isFavorite"] else 0,
                _json_dumps(normalized["extra"]),
                timestamp,
            ),
        )
        connection.execute("DELETE FROM gallery_image_tags WHERE image_id = ?", (image_id,))
        for tag in normalized["tags"]:
            connection.execute(
                "INSERT OR IGNORE INTO gallery_image_tags (image_id, tag) VALUES (?, ?)",
                (image_id, tag),
            )


def _normalize_image(image: dict[str, Any]) -> dict[str, Any]:
    extra = {key: value for key, value in image.items() if key not in KNOWN_IMAGE_KEYS}
    return {
        "id": str(image["id"]),
        "status": str(image.get("status") or "success"),
        "error": image.get("error"),
        "localPath": str(image.get("localPath") or ""),
        "savedFilePath": _optional_str(image.get("savedFilePath")),
        "thumbnail": _optional_str(image.get("thumbnail")),
        "width": _optional_int(image.get("width")),
        "height": _optional_int(image.get("height")),
        "prompt": str(image.get("prompt") or ""),
        "apiType": str(image.get("apiType") or "other"),
        "params": image.get("params") if isinstance(image.get("params"), dict) else {},
        "createdAt": str(image.get("createdAt") or _now_iso()),
        "originalUrl": image.get("originalUrl"),
        "isFavorite": bool(image.get("isFavorite")),
        "tags": _clean_tag_list(image.get("tags", [])),
        "extra": extra,
    }


def _row_to_image(row: sqlite3.Row, tags: list[str]) -> dict[str, Any]:
    extra = _json_loads(row["extra_json"], {})
    image = extra if isinstance(extra, dict) else {}
    image.update(
        {
            "id": row["id"],
            "status": row["status"],
            "localPath": row["local_path"],
            "prompt": row["prompt"],
            "apiType": row["api_type"],
            "params": _json_loads(row["params_json"], {}),
            "createdAt": row["created_at"],
            "isFavorite": bool(row["is_favorite"]),
            "tags": _clean_tag_list(tags),
        }
    )
    _set_if_present(image, "error", _json_loads(row["error_json"], None))
    _set_if_present(image, "savedFilePath", row["saved_file_path"])
    _set_if_present(image, "thumbnail", row["thumbnail"])
    _set_if_present(image, "width", row["width"])
    _set_if_present(image, "height", row["height"])
    _set_if_present(image, "originalUrl", _json_loads(row["original_url_json"], None))
    return image


def _path_from_serve_url(value: str) -> str | None:
    if "/api/serve-image?path=" not in value:
        return None
    return unquote(value.split("path=", 1)[1])


def _clean_tag_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in value:
        tag = _clean_tag(item)
        if tag and tag not in seen:
            cleaned.append(tag)
            seen.add(tag)
    return cleaned


def _clean_tag(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if text else None


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _set_if_present(target: dict[str, Any], key: str, value: Any) -> None:
    if value is not None:
        target[key] = value


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
