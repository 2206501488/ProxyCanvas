from __future__ import annotations

import mimetypes
import os
from pathlib import Path
from urllib.parse import quote

from config import CLIPROXY_SAVE_DIR, NANOBANANA2_SAVE_DIR, OPENAI_SAVE_DIR


ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tif"}


def allowed_roots() -> list[Path]:
    roots = [OPENAI_SAVE_DIR, NANOBANANA2_SAVE_DIR, CLIPROXY_SAVE_DIR]
    return [Path(root).resolve() for root in dict.fromkeys(roots)]


def resolve_allowed_path(raw_path: str | os.PathLike[str]) -> Path | None:
    path = Path(raw_path).resolve()
    for root in allowed_roots():
        try:
            path.relative_to(root)
            return path
        except ValueError:
            continue
    return None


def is_allowed_image_filename(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_IMAGE_EXTENSIONS


def guess_mimetype(path: str | os.PathLike[str]) -> str:
    mime, _ = mimetypes.guess_type(str(path))
    return mime or "application/octet-stream"


def serve_url_for_path(path: str | os.PathLike[str]) -> str:
    return f"/api/serve-image?path={quote(str(path), safe='')}"


def import_dir() -> Path:
    path = Path(OPENAI_SAVE_DIR) / "imports"
    path.mkdir(parents=True, exist_ok=True)
    return path
