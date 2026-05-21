from __future__ import annotations

import os
import subprocess
import uuid

from flask import Blueprint, jsonify, request, send_file

from services.gallery_store import add_images
from services.image_files import guess_mimetype, is_allowed_image_filename
from services.image_importer import import_local_paths, import_uploaded_files


imports_bp = Blueprint("imports", __name__)
_PICKED_LOCAL_FILES: dict[str, str] = {}


@imports_bp.route("/api/gallery/import", methods=["POST"])
def import_images():
    try:
        prompt = request.form.get("prompt", "外部导入图片")
        api_type = request.form.get("apiType", "other")
        ratio = request.form.get("ratio", "auto")
        quality = request.form.get("quality", "imported")
        created_at = request.form.get("createdAt") or None
        tags = _parse_tags(request.form.get("tags"))

        files = request.files.getlist("files")
        if files:
            images = import_uploaded_files(
                files,
                prompt=prompt,
                api_type=api_type,
                ratio=ratio,
                quality=quality,
                created_at=created_at,
                tags=tags,
            )
        else:
            payload = request.get_json(silent=True) or {}
            paths = payload.get("paths") or []
            images = import_local_paths(
                paths,
                prompt=payload.get("prompt", prompt),
                api_type=payload.get("apiType", api_type),
                ratio=payload.get("ratio", ratio),
                quality=payload.get("quality", quality),
                created_at=payload.get("createdAt") or created_at,
                tags=payload.get("tags") if isinstance(payload.get("tags"), list) else tags,
            )

        if not images:
            return jsonify({"success": False, "message": "No images provided"}), 400

        add_images(images)
        return jsonify({"success": True, "data": images})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@imports_bp.route("/api/gallery/import-local-picker", methods=["POST"])
def import_images_from_local_picker():
    try:
        payload = request.get_json(silent=True) or {}
        paths = _pick_local_image_paths()
        if not paths:
            return jsonify({"success": False, "message": "No images selected"}), 400

        tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []
        images = import_local_paths(
            paths,
            prompt=payload.get("prompt") or "外部导入图片",
            api_type=payload.get("apiType") or "other",
            ratio=payload.get("ratio") or "auto",
            quality=payload.get("quality") or "imported",
            created_at=payload.get("createdAt") or None,
            tags=tags,
        )
        add_images(images)

        deleted = 0
        skipped = 0
        if payload.get("deleteOriginal"):
            for path in paths:
                try:
                    os.remove(path)
                    deleted += 1
                except Exception:
                    skipped += 1

        return jsonify({
            "success": True,
            "data": images,
            "deletedOriginalCount": deleted,
            "deleteOriginalSkippedCount": skipped,
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@imports_bp.route("/api/gallery/pick-local-files", methods=["POST"])
def pick_local_files():
    try:
        paths = _pick_local_image_paths()
        items = []
        for path in paths:
            if not is_allowed_image_filename(path):
                continue
            token = uuid.uuid4().hex
            _PICKED_LOCAL_FILES[token] = path
            items.append({
                "token": token,
                "name": os.path.basename(path),
                "previewUrl": f"/api/gallery/local-preview/{token}",
            })
        return jsonify({"success": True, "data": items})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@imports_bp.route("/api/gallery/local-preview/<token>", methods=["GET"])
def local_preview(token: str):
    path = _PICKED_LOCAL_FILES.get(token)
    if not path or not os.path.exists(path):
        return jsonify({"error": "File not found"}), 404
    return send_file(path, mimetype=guess_mimetype(path))


@imports_bp.route("/api/gallery/import-picked-local-files", methods=["POST"])
def import_picked_local_files():
    try:
        payload = request.get_json(silent=True) or {}
        tokens = payload.get("tokens") if isinstance(payload.get("tokens"), list) else []
        paths = [_PICKED_LOCAL_FILES[token] for token in tokens if token in _PICKED_LOCAL_FILES]
        if not paths:
            return jsonify({"success": False, "message": "No images selected"}), 400

        tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []
        images = import_local_paths(
            paths,
            prompt=payload.get("prompt") or "外部导入图片",
            api_type=payload.get("apiType") or "other",
            ratio=payload.get("ratio") or "auto",
            quality=payload.get("quality") or "imported",
            created_at=payload.get("createdAt") or None,
            tags=tags,
        )
        add_images(images)

        deleted = 0
        skipped = 0
        if payload.get("deleteOriginal"):
            for path in paths:
                try:
                    os.remove(path)
                    deleted += 1
                except Exception:
                    skipped += 1

        for token in tokens:
            _PICKED_LOCAL_FILES.pop(token, None)

        return jsonify({
            "success": True,
            "data": images,
            "deletedOriginalCount": deleted,
            "deleteOriginalSkippedCount": skipped,
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


def _parse_tags(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def _pick_local_image_paths() -> list[str]:
    command = r"""
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiAwareness {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
"@
[DpiAwareness]::SetProcessDPIAware() | Out-Null
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Multiselect = $true
$dialog.Filter = 'Image files|*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tiff;*.tif|All files|*.*'
$dialog.Title = '选择要导入到画廊的图片'
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  $dialog.FileNames | ForEach-Object { Write-Output $_ }
}
"""
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-STA", "-Command", command],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=None,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Failed to open file picker")
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]
