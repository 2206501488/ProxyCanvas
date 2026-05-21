from __future__ import annotations

import os

from flask import Blueprint, jsonify, request

from services import gallery_store


gallery_bp = Blueprint("gallery", __name__)


@gallery_bp.route("/api/gallery", methods=["GET"])
def get_gallery():
    try:
        return jsonify({"success": True, "data": gallery_store.load_gallery()})
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

        if delete_local and local_path and os.path.exists(local_path):
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


def current_app_log(message: str, image_id: str) -> None:
    try:
        from flask import current_app

        logger = current_app.config.get("APIMART_LOG_EVENT")
        if logger:
            logger("GALLERY", message, "OK", id=image_id)
    except Exception:
        pass
