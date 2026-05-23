from __future__ import annotations

"""Translate unified job params into provider-specific legacy payloads.

This module intentionally stays thin: it resolves the active model schema, then
delegates the actual field mapping to small provider translators. That keeps
provider differences isolated and makes the compatibility layer easier to
reason about when new providers are added.
"""

from typing import Any

from services.jobs.payloads.apimart import translate as translate_apimart
from services.jobs.payloads.cliproxy import translate as translate_cliproxy
from services.jobs.payloads.common import (
    flatten_payload,
    image_count,
    lookup_model_config,
    model_value,
    request_model_config,
    size_for_model,
    strip_schema_fields,
)
from services.jobs.payloads.nanobanana2 import translate as translate_nanobanana2
from services.jobs.payloads.openai import translate as translate_openai
from services.jobs.payloads.sousaku import translate as translate_sousaku


def translate_provider_payload(provider: str, payload: dict[str, Any]) -> dict[str, Any]:
    provider = str(provider or "").strip().lower()
    source = flatten_payload(payload)
    request_config = request_model_config(source)
    model = model_value(provider, source, request_config)
    model_config = lookup_model_config(provider, model) or request_config
    ratio = str(source.get("ratio") or source.get("size") or "")
    resolution = str(source.get("resolution") or "")
    quality = source.get("quality")
    n = image_count(source, model_config)

    if provider == "sousaku":
        return translate_sousaku(source, model=model, model_config=model_config, ratio=ratio, resolution=resolution, quality=quality, n=n)
    if provider == "nanobanana2":
        return translate_nanobanana2(source, model=model, model_config=model_config, ratio=ratio, resolution=resolution, quality=quality, n=n)
    if provider == "cliproxy":
        return translate_cliproxy(source, model=model, model_config=model_config, ratio=ratio, resolution=resolution, quality=quality, n=n)
    if provider == "openai":
        return translate_openai(source, model=model, model_config=model_config, ratio=ratio, resolution=resolution, quality=quality, n=n)
    if provider == "apimart":
        return translate_apimart(source, model=model, model_config=model_config, ratio=ratio, resolution=resolution, quality=quality, n=n)

    translated = dict(source)
    translated["prompt"] = source.get("prompt") or ""
    if model:
        translated["model"] = model
    if n:
        translated["n"] = n
    translated["size"] = size_for_model(model_config, ratio, resolution, fallback=ratio or str(source.get("size") or "16:9"))
    if resolution:
        translated["resolution"] = resolution
    if model == "gpt-image-2-official":
        translated["quality"] = quality or "high"
        translated["moderation"] = source.get("moderation") or "low"
    return strip_schema_fields(translated)
