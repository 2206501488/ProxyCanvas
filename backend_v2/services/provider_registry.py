from __future__ import annotations

import threading
from typing import Any, Callable

import config


ProviderChangeListener = Callable[[], None]

_BUILTIN_ORDER = ["openai", "cliproxy", "sousaku", "nanobanana2", "apimart"]
_LISTENERS: list[ProviderChangeListener] = []
_LOCK = threading.RLock()


def add_change_listener(listener: ProviderChangeListener) -> None:
    with _LOCK:
        if listener not in _LISTENERS:
            _LISTENERS.append(listener)


def _notify_change() -> None:
    with _LOCK:
        listeners = list(_LISTENERS)
    for listener in listeners:
        try:
            listener()
        except Exception:
            pass


def reload_runtime_config() -> None:
    config.apply_runtime_config()
    _notify_change()


def _provider_source(provider_id: str) -> str:
    raw = config.read_providers_settings().get("providers", {})
    return "config/providers.json" if isinstance(raw, dict) and provider_id in raw else "config.py"


def _sort_key(item: tuple[str, dict[str, Any]]) -> tuple[int, str]:
    provider_id, _provider = item
    try:
        return (_BUILTIN_ORDER.index(provider_id), provider_id)
    except ValueError:
        return (len(_BUILTIN_ORDER), provider_id)


def provider_settings() -> dict[str, Any]:
    return config.normalized_providers_settings()


def list_providers(*, include_disabled: bool = True) -> list[dict[str, Any]]:
    data = provider_settings()
    items = sorted(data.get("providers", {}).items(), key=_sort_key)
    providers: list[dict[str, Any]] = []
    for provider_id, provider in items:
        if not include_disabled and not provider.get("enabled", True):
            continue
        providers.append(provider_summary(provider_id, provider))
    return providers


def provider_summary(provider_id: str, provider: dict[str, Any] | None = None) -> dict[str, Any]:
    provider = provider or get_provider(provider_id) or {}
    return {
        "id": provider_id,
        "label": provider.get("label", provider_id),
        "type": provider.get("type", ""),
        "enabled": provider.get("enabled", True),
        "source": _provider_source(provider_id),
        "baseUrl": provider.get("baseUrl", ""),
        "apiKey": provider.get("apiKey", ""),
        "defaultModel": provider.get("defaultModel", ""),
        "models": provider.get("models", []),
        "capabilities": provider.get("capabilities", []),
        "notes": provider.get("notes", ""),
        "configPath": provider.get("configPath", ""),
        "builtin": provider_id in config.DEFAULT_PROVIDERS_SETTINGS["providers"],
    }


def get_provider(provider_id: str) -> dict[str, Any] | None:
    provider = provider_settings().get("providers", {}).get(str(provider_id or "").strip())
    return dict(provider) if isinstance(provider, dict) else None


def is_enabled(provider_id: str) -> bool:
    provider = get_provider(provider_id)
    return bool(provider and provider.get("enabled", True))


def update_provider(provider_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    provider_id = str(provider_id or "").strip()
    if not provider_id:
        raise KeyError("Provider not found")

    current = provider_settings()
    providers = current.setdefault("providers", {})
    if provider_id not in providers:
        raise KeyError("Provider not found")

    provider = dict(providers[provider_id])
    allowed_keys = {
        "label",
        "enabled",
        "baseUrl",
        "apiKey",
        "defaultModel",
        "configPath",
        "notes",
    }
    for key in allowed_keys:
        if key in payload:
            provider[key] = payload[key]

    providers[provider_id] = provider
    config.write_providers_settings(current)
    reload_runtime_config()
    return provider_summary(provider_id)


def build_job_adapters(*, app: Any, endpoints: dict[str, Any]) -> dict[str, Any]:
    from services.jobs.providers import APIMartAdapter, FlaskEndpointAdapter, OpenAITaskAdapter, SousakuAdapter

    adapters: dict[str, Any] = {}
    for provider in list_providers(include_disabled=False):
        provider_id = provider["id"]
        provider_type = provider.get("type")
        if provider_type == "sousaku":
            adapters[provider_id] = SousakuAdapter()
        elif provider_id == "cliproxy":
            adapters[provider_id] = FlaskEndpointAdapter(
                name=provider_id,
                app=app,
                endpoint=endpoints["cliproxy"],
                path="/api/generate-cliproxy",
            )
        elif provider_id == "nanobanana2":
            adapters[provider_id] = FlaskEndpointAdapter(
                name=provider_id,
                app=app,
                endpoint=endpoints["nanobanana2"],
                path="/api/generate-nanobanana2",
            )
        elif provider_id == "apimart":
            adapters[provider_id] = APIMartAdapter(
                app=app,
                submit_endpoint=endpoints["apimart_submit"],
                status_endpoint=endpoints["apimart_status"],
            )
        elif provider_id == "openai":
            adapters[provider_id] = OpenAITaskAdapter(
                app=app,
                submit_endpoint=endpoints["openai_submit"],
                status_endpoint=endpoints["openai_status"],
            )
    return adapters
