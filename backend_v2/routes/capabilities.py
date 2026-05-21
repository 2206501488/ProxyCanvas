from __future__ import annotations

from flask import Blueprint, jsonify


capabilities_bp = Blueprint("capabilities", __name__)


@capabilities_bp.route("/api/capabilities", methods=["GET"])
def get_capabilities():
    return jsonify({
        "backendVersion": "v2",
        "features": {
            "galleryImport": True,
            "localPickerImport": True,
        },
    })
