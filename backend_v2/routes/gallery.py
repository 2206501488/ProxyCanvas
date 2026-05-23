from __future__ import annotations

import os
import shutil
from pathlib import Path

from flask import Blueprint, jsonify, request

from routes.files import delete_thumbnail_cache_for_source
from services import gallery_store


gallery_bp = Blueprint("gallery", __name__)


def _optional_positive_int(value: str | None, *, maximum: int) -> int | None:
    if value is None or value == "":
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return max(0, min(parsed, maximum))


@gallery_bp.route("/api/gallery", methods=["GET"])
def get_gallery():
    try:
        limit = _optional_positive_int(request.args.get("limit"), maximum=1000)
        offset = _optional_positive_int(request.args.get("offset"), maximum=1_000_000) or 0
        return jsonify({"success": True, "data": gallery_store.load_gallery(limit=limit, offset=offset)})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@gallery_bp.route("/api/gallery", methods=["POST"])
def add_to_gallery():
    try:
        image = request.get_json(silent=True) or {}
        inserted = gallery_store.upsert_image(image)
        current_app_log("加入画廊" if inserted else "更新图片", image.get("id", "unknown"))
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@gallery_bp.route("/api/gallery/<image_id>", methods=["DELETE"])
def delete_from_gallery(image_id: str):
    try:
        delete_local = request.args.get("delete_local", "false").lower() == "true"
        deleted, local_path = gallery_store.delete_image(image_id)

        if local_path:
            delete_thumbnail_cache_for_source(local_path)
            if delete_local and os.path.exists(local_path):
                os.remove(local_path)

        if deleted:
            current_app_log("删除记录", image_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@gallery_bp.route("/api/gallery/tags", methods=["POST"])
def update_gallery_tags():
    try:
        payload = request.get_json(silent=True) or {}
        tags = payload.get("tags", [])
        gallery_store.replace_tags(tags if isinstance(tags, list) else [])
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@gallery_bp.route("/api/gallery/batch/delete", methods=["POST"])
def batch_delete_gallery():
    try:
        payload = request.get_json(silent=True) or {}
        ids = payload.get("ids") if isinstance(payload.get("ids"), list) else []
        delete_local = bool(payload.get("deleteLocal"))

        deleted = gallery_store.delete_images(ids)
        local_deleted = 0
        local_skipped = 0
        thumbnails_deleted = 0
        for _, local_path in deleted:
            if not local_path:
                if delete_local:
                    local_skipped += 1
                continue
            thumbnails_deleted += delete_thumbnail_cache_for_source(local_path)
            if delete_local:
                try:
                    if os.path.exists(local_path):
                        os.remove(local_path)
                        local_deleted += 1
                    else:
                        local_skipped += 1
                except OSError:
                    local_skipped += 1

        return jsonify({
            "success": True,
            "data": {
                "deleted": len(deleted),
                "localDeleted": local_deleted,
                "localSkipped": local_skipped,
                "thumbnailsDeleted": thumbnails_deleted,
            },
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@gallery_bp.route("/api/gallery/batch/tags", methods=["POST"])
def batch_update_gallery_tags():
    try:
        payload = request.get_json(silent=True) or {}
        ids = payload.get("ids") if isinstance(payload.get("ids"), list) else []
        add = payload.get("add") if isinstance(payload.get("add"), list) else []
        remove = payload.get("remove") if isinstance(payload.get("remove"), list) else []
        touched = gallery_store.update_image_tags(ids, add=add, remove=remove)
        return jsonify({"success": True, "data": {"updated": touched}})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@gallery_bp.route("/api/gallery/batch/favorite", methods=["POST"])
def batch_favorite_gallery():
    try:
        payload = request.get_json(silent=True) or {}
        ids = payload.get("ids") if isinstance(payload.get("ids"), list) else []
        favorite = bool(payload.get("favorite"))
        touched = gallery_store.set_images_favorite(ids, favorite)
        return jsonify({"success": True, "data": {"updated": touched, "favorite": favorite}})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@gallery_bp.route("/api/gallery/batch/export", methods=["POST"])
def batch_export_gallery():
    try:
        payload = request.get_json(silent=True) or {}
        ids = payload.get("ids") if isinstance(payload.get("ids"), list) else []
        images = gallery_store.get_images_by_ids(ids)
        if not images:
            return jsonify({"success": False, "message": "No images selected"}), 400

        target_dir = _pick_export_directory()
        if not target_dir:
            return jsonify({
                "success": True,
                "data": {
                    "exported": 0,
                    "skipped": 0,
                    "directory": "",
                    "cancelled": True,
                },
            })

        exported = 0
        skipped = 0
        for image in images:
            source = image.get("savedFilePath") or _path_from_serve_url(str(image.get("localPath") or ""))
            if not source or not os.path.isfile(source):
                skipped += 1
                continue
            try:
                destination = _unique_destination(target_dir, Path(source).name)
                shutil.copy2(source, destination)
                exported += 1
            except OSError:
                skipped += 1

        return jsonify({
            "success": True,
            "data": {
                "exported": exported,
                "skipped": skipped,
                "directory": str(target_dir),
                "cancelled": False,
            },
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


def _pick_export_directory() -> Path | None:
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(title="选择另存为目录")
        root.destroy()
        return Path(selected) if selected else None
    except Exception:
        return None


def _unique_destination(directory: Path, filename: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / filename
    if not candidate.exists():
        return candidate
    stem = candidate.stem
    suffix = candidate.suffix
    index = 2
    while True:
        next_candidate = directory / f"{stem}_{index}{suffix}"
        if not next_candidate.exists():
            return next_candidate
        index += 1


def _path_from_serve_url(value: str) -> str | None:
    if "/api/serve-image" not in value:
        return None
    from urllib.parse import parse_qs, unquote, urlparse

    from services.image_files import resolve_allowed_path

    parsed = urlparse(value)
    params = parse_qs(parsed.query)
    raw_path = params.get("path", [None])[0]
    if not raw_path:
        return None
    path = resolve_allowed_path(raw_path)
    return str(path) if path else unquote(raw_path)


def current_app_log(message: str, image_id: str) -> None:
    try:
        from flask import current_app

        logger = current_app.config.get("APIMART_LOG_EVENT")
        if logger:
            logger("GALLERY", message, "OK", id=image_id)
    except Exception:
        pass
