import base64
import hashlib
import os
import sys
import tempfile
import threading
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import HTTP_PROXIES, SOUSAKU_CONFIG_PATH, SOUSAKU_SAVE_DIR
from services.reference_cache import load_reference_image

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sdk.sousaku import SousakuClient  # noqa: E402
from sdk.sousaku.exceptions import SousakuError, SousakuTaskFailedError  # noqa: E402


_CLIENT: SousakuClient | None = None
_CLIENT_CONFIG_MTIME: float | None = None
_SAVED_BY_TASK: dict[str, dict[str, str]] = {}
_TASK_TOKENS: dict[str, str] = {}
_CLIENT_LOCK = threading.Lock()
_IMAGE_MODEL_DEFAULT_RESOLUTIONS = {
    "gpt-image-2-low": "4k",
    "gpt-image-2": "4k",
    "gpt-image-2-high": "4k",
    "seedream-4.5": "2k",
    "wan-image-2.7-pro": "4k",
}
_IMAGE_MODELS_FIXED_NUMBER = {
    "mj-image-v7",
    "mj-image-niji-7",
}


def _get_client() -> SousakuClient:
    global _CLIENT, _CLIENT_CONFIG_MTIME
    config_mtime = _config_mtime()
    if _CLIENT is not None and _CLIENT_CONFIG_MTIME == config_mtime:
        return _CLIENT

    with _CLIENT_LOCK:
        config_mtime = _config_mtime()
        if _CLIENT is None or _CLIENT_CONFIG_MTIME != config_mtime:
            _CLIENT = SousakuClient.from_config(SOUSAKU_CONFIG_PATH, save_dir=SOUSAKU_SAVE_DIR)
            _CLIENT_CONFIG_MTIME = config_mtime
    return _CLIENT


def _config_mtime() -> float | None:
    try:
        return os.path.getmtime(SOUSAKU_CONFIG_PATH)
    except OSError:
        return None


def create_task(data: dict[str, Any]) -> dict[str, Any]:
    client = _get_client()
    prompt = data.get("prompt", "")
    if not prompt:
        return {"success": False, "error": {"message": "prompt is required"}}

    n = _safe_int(data.get("n"), default=1, minimum=1, maximum=10)
    ratio = data.get("size") or data.get("ratio") or "1:1"
    model = data.get("model") or "medium"
    resolved_model = client.normalize_model(model)
    if resolved_model in _IMAGE_MODELS_FIXED_NUMBER:
        n = 4
    resolution = ""
    if resolved_model in _IMAGE_MODEL_DEFAULT_RESOLUTIONS:
        resolution = data.get("resolution") or _IMAGE_MODEL_DEFAULT_RESOLUTIONS[resolved_model]
    auto_optimize = bool(data.get("auto_optimize", False))
    estimated_credits = client.estimate_credits(resolved_model, n)
    temp_paths: list[str] = []
    try:
        with _CLIENT_LOCK:
            selected_profile = client.select_token_for_generation(required_credits=estimated_credits)
            account_before = _account_snapshot_from_profile(client, selected_profile)
            temp_paths = _reference_images_to_temp_files(data.get("image_urls") or [])
            reference_images = client.upload_reference_images(temp_paths) if temp_paths else []
            task_id = client.create_image(
                prompt,
                model=model,
                ratio=ratio,
                resolution=resolution,
                auto_optimize=auto_optimize,
                number=n,
                reference_images=reference_images,
            )
            _TASK_TOKENS[task_id] = client.token
            account_after = _safe_account_snapshot(client)
        return {
            "success": True,
            "meta": {
                "account": account_after or account_before,
                "model": resolved_model,
                "estimated_credits": estimated_credits,
                "credit_before": (account_before or {}).get("total_credit"),
                "credit_after": (account_after or {}).get("total_credit"),
            },
            "data": [{
                "status": "submitted",
                "task_id": task_id,
            }],
        }
    except Exception as exc:
        return {"success": False, "error": {"message": str(exc)}}
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except OSError:
                pass


def get_task(task_id: str) -> dict[str, Any]:
    client = _get_client()
    try:
        with _CLIENT_LOCK:
            task_token = _TASK_TOKENS.get(task_id)
            if task_token:
                client.set_token(task_token)
            task = client.get_task_status(task_id)
        images = []
        saved_for_task = _SAVED_BY_TASK.setdefault(task_id, {})
        for index, image in enumerate(task.images, start=1):
            saved_path = saved_for_task.get(image.url)
            if not saved_path:
                try:
                    filename = _image_filename(task_id, index, image.url)
                    saved_path = client.download_image(image, save_dir=SOUSAKU_SAVE_DIR, filename=filename)
                    saved_for_task[image.url] = saved_path
                except Exception:
                    saved_path = None

            images.append({
                "url": image.url,
                "saved_path": saved_path,
                "width": image.width,
                "height": image.height,
                "thumbnail_url": image.thumbnail_url,
                "file_id": image.file_id,
                "content_id": image.content_id,
                "download_failed": saved_path is None,
            })

        status = task.status.lower()
        response: dict[str, Any] = {
            "status": status,
            "data": {
                "status": status,
                "task_id": task.task_id,
                "progress": task.progress,
                "result": {"images": images},
            },
        }
        if task.is_failed:
            response["error"] = {"message": _task_error_message(task.raw)}
        return response
    except SousakuTaskFailedError as exc:
        return {
            "status": "failed",
            "error": {"message": exc.message},
            "data": {
                "status": "failed",
                "task_id": task_id,
                "result": {"images": []},
            },
        }
    except SousakuError as exc:
        return {"status": "failed", "error": {"message": str(exc)}}
    except Exception as exc:
        return {"status": "failed", "error": {"message": str(exc)}}


def refresh_account_records() -> list[dict[str, Any]]:
    client = _get_client()
    with _CLIENT_LOCK:
        return client.save_account_records(include_token=True, include_raw=False)


def refresh_account_records_for_tokens(tokens: list[str]) -> list[dict[str, Any]]:
    records = []
    normalized_tokens = [str(token).strip() for token in tokens if str(token).strip()]
    if not normalized_tokens:
        return records

    for token in normalized_tokens:
        client = SousakuClient.from_config(SOUSAKU_CONFIG_PATH, tokens=[token], save_dir=SOUSAKU_SAVE_DIR)
        try:
            record = client.get_account_record(include_token=True, include_raw=False)
        except Exception as exc:
            record = {
                "token": token,
                "token_masked": client._mask_token(token),
                "error": str(exc),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        with _CLIENT_LOCK:
            _merge_account_record(client.accounts_path, record)
        records.append(record)
    return records


def refresh_task_account(task_id: str) -> dict[str, Any] | None:
    task_token = _TASK_TOKENS.get(task_id)
    if not task_token:
        return None
    client = _get_client()
    with _CLIENT_LOCK:
        client.set_token(task_token)
        record = client.get_account_record(include_token=True, include_raw=False)
        _merge_account_record(client.accounts_path, record)
        return record


def _merge_account_record(accounts_path: str | None, record: dict[str, Any]) -> None:
    if not accounts_path:
        return
    path = Path(accounts_path)
    payload: dict[str, Any] = {"accounts": []}
    if path.exists():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            payload = {"accounts": []}

    accounts = payload.get("accounts") if isinstance(payload.get("accounts"), list) else []
    token = record.get("token")
    user_id = record.get("user_id")
    token_masked = record.get("token_masked")
    updated = False
    for index, account in enumerate(accounts):
        if not isinstance(account, dict):
            continue
        if (token and account.get("token") == token) or (user_id and account.get("user_id") == user_id) or (token_masked and account.get("token_masked") == token_masked):
            accounts[index] = record
            updated = True
            break
    if not updated:
        accounts.append(record)

    from datetime import datetime, timezone

    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    payload["count"] = len(accounts)
    payload["accounts"] = accounts
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _reference_images_to_temp_files(image_urls: list[Any]) -> list[str]:
    paths = []
    for idx, item in enumerate(image_urls):
        url = item.get("url", "") if isinstance(item, dict) else str(item or "")
        if not url:
            continue
        suffix = ".png"
        try:
            if url.startswith("data:"):
                header, b64_data = url.split(",", 1)
                mime_type = header.split(";", 1)[0].split(":", 1)[1] if ":" in header else "image/png"
                suffix = _suffix_from_content_type(mime_type)
                content = base64.b64decode(b64_data)
            else:
                image = load_reference_image(url, timeout=60, proxies=HTTP_PROXIES)
                suffix = image.suffix or _suffix_from_url(url)
                content = image.data

            handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix=f"sousaku_ref_{idx}_")
            with handle:
                handle.write(content)
            paths.append(handle.name)
        except Exception:
            continue
    return paths


def _safe_int(value: Any, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _safe_account_snapshot(client: SousakuClient) -> dict[str, Any] | None:
    try:
        profile = client.get_user_profile()
    except Exception:
        return None
    return _account_snapshot_from_profile(client, profile)


def _account_snapshot_from_profile(client: SousakuClient, profile: Any) -> dict[str, Any]:
    account_name = profile.user_email or profile.nick_name or profile.user_name or profile.user_id
    return {
        "account": account_name,
        "user_id": profile.user_id,
        "nick_name": profile.nick_name,
        "user_email": profile.user_email,
        "share_code": profile.share_code,
        "inviter_share_code": profile.inviter_share_code,
        "package_level": profile.package_level,
        "total_credit": profile.total_credit,
        "subscription_credit": profile.subscription_credit,
        "permanent_credit": profile.permanent_credit,
        "running_task_count": profile.running_task_count,
        "token_masked": client._mask_token(client.token),
    }


def _image_filename(task_id: str, index: int, url: str) -> str:
    url_hash = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12] if url else f"{index:02d}"
    return f"sousaku_{task_id[:16]}_{url_hash}.{_suffix_from_url(url).lstrip('.') or 'png'}"


def _suffix_from_content_type(content_type: str) -> str:
    value = content_type.lower().split(";", 1)[0].strip()
    if value == "image/png":
        return ".png"
    if value in {"image/jpeg", "image/jpg"}:
        return ".jpg"
    if value == "image/webp":
        return ".webp"
    return ".png"


def _suffix_from_url(url: str) -> str:
    path = url.lower().split("?", 1)[0]
    for suffix in (".png", ".jpg", ".jpeg", ".webp"):
        if path.endswith(suffix):
            return ".jpg" if suffix == ".jpeg" else suffix
    return ".png"


def _task_error_message(task: dict[str, Any]) -> str:
    message = task.get("error_message")
    if message:
        return str(message)
    if task.get("is_nsfw_error"):
        return "content rejected by model compliance check"
    return "Sousaku task failed"
