from __future__ import annotations

import hashlib
import os
import platform
import subprocess
import time
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file
from PIL import Image, ImageOps

import config
from services.image_files import guess_mimetype, resolve_allowed_path


files_bp = Blueprint("files", __name__)
_thumbnail_cleanup_at = 0.0


@files_bp.route("/api/serve-image", methods=["GET"])
def serve_image():
    try:
        raw_path = request.args.get("path")
        if not raw_path:
            return jsonify({"error": "No path provided"}), 400

        path = resolve_allowed_path(raw_path)
        if not path or not path.exists():
            return jsonify({"error": "File not found"}), 404

        return send_file(path, mimetype=guess_mimetype(path))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@files_bp.route("/api/thumbnail", methods=["GET"])
def serve_thumbnail():
    try:
        raw_path = request.args.get("path")
        if not raw_path:
            return jsonify({"error": "No path provided"}), 400

        source_path = resolve_allowed_path(raw_path)
        if not source_path or not source_path.exists():
            return jsonify({"error": "File not found"}), 404

        width = _clamp_int(request.args.get("w"), default=config.GALLERY_THUMBNAIL_WIDTH, minimum=128, maximum=1536)
        quality = _clamp_int(request.args.get("q"), default=config.GALLERY_THUMBNAIL_QUALITY, minimum=45, maximum=92)
        thumbnail_path = _thumbnail_path(source_path, width, quality)

        if not thumbnail_path.exists():
            _create_thumbnail(source_path, thumbnail_path, width, quality)
            _cleanup_thumbnail_cache()

        return send_file(thumbnail_path, mimetype="image/webp", max_age=60 * 60 * 24 * 30, conditional=True)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _clamp_int(value, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _thumbnail_dir(width: int) -> Path:
    path = Path(config.OPENAI_SAVE_DIR) / "thumbnails" / str(width)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _thumbnail_path(source_path: Path, width: int, quality: int) -> Path:
    name = _thumbnail_cache_name(source_path, width, quality)
    return _thumbnail_dir(width) / name


def _thumbnail_cache_name(source_path: Path, width: int, quality: int) -> str:
    stat = source_path.stat()
    key = f"{source_path.resolve()}|{stat.st_size}|{stat.st_mtime_ns}|{width}|{quality}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:32] + ".webp"


def delete_thumbnail_cache_for_source(raw_path: str | os.PathLike[str] | None) -> int:
    source_path = resolve_allowed_path(raw_path) if raw_path else None
    if not source_path or not source_path.exists():
        return 0

    cache_root = Path(config.OPENAI_SAVE_DIR) / "thumbnails"
    widths = {config.GALLERY_THUMBNAIL_WIDTH}
    if cache_root.exists():
        for path in cache_root.iterdir():
            if not path.is_dir():
                continue
            try:
                widths.add(int(path.name))
            except ValueError:
                continue

    deleted = 0
    for width in widths:
        directory = cache_root / str(width)
        if not directory.exists():
            continue
        for quality in range(45, 93):
            candidate = directory / _thumbnail_cache_name(source_path, width, quality)
            try:
                if candidate.is_file():
                    candidate.unlink()
                    deleted += 1
            except OSError:
                continue
    return deleted


def _create_thumbnail(source_path: Path, thumbnail_path: Path, width: int, quality: int) -> None:
    thumbnail_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = thumbnail_path.with_name(f"{thumbnail_path.stem}.{os.getpid()}.{time.time_ns()}.tmp")
    with Image.open(source_path) as image:
        try:
            image.seek(0)
        except EOFError:
            pass
        image = ImageOps.exif_transpose(image)
        image.thumbnail((width, width), Image.Resampling.LANCZOS)
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
        image.save(temp_path, "WEBP", quality=quality, method=4)
    os.replace(temp_path, thumbnail_path)


def _cleanup_thumbnail_cache() -> None:
    global _thumbnail_cleanup_at
    max_bytes = int(float(config.GALLERY_THUMBNAIL_CACHE_MAX_GB or 0) * 1024 * 1024 * 1024)
    if max_bytes <= 0:
        return

    now = time.monotonic()
    if now - _thumbnail_cleanup_at < 120:
        return
    _thumbnail_cleanup_at = now

    root = Path(config.OPENAI_SAVE_DIR) / "thumbnails"
    if not root.exists():
        return
    files = [path for path in root.rglob("*.webp") if path.is_file()]
    total = sum(path.stat().st_size for path in files)
    if total <= max_bytes:
        return

    target = int(max_bytes * 0.9)
    for path in sorted(files, key=lambda item: item.stat().st_atime):
        try:
            size = path.stat().st_size
            path.unlink()
            total -= size
        except OSError:
            continue
        if total <= target:
            break


@files_bp.route("/api/open-folder", methods=["POST"])
def open_folder():
    try:
        data = request.get_json(silent=True) or {}
        raw_path = data.get("path")
        path = resolve_allowed_path(raw_path) if raw_path else None
        if not path or not path.exists():
            return jsonify({"success": False, "message": "Path not found"}), 404

        folder = path.parent if path.is_file() else path
        if platform.system() == "Windows":
            if path.is_file():
                subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
            else:
                subprocess.Popen(["explorer", os.path.normpath(folder)])
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", str(folder)])
        else:
            subprocess.Popen(["xdg-open", str(folder)])

        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
