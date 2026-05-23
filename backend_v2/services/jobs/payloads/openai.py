from __future__ import annotations

from typing import Any

from .common import size_for_model, strip_schema_fields


def translate(
    source: dict[str, Any],
    *,
    model: str,
    model_config: dict[str, Any],
    ratio: str,
    resolution: str,
    quality: Any,
    n: int,
) -> dict[str, Any]:
    translated = dict(source)
    translated["prompt"] = source.get("prompt") or ""
    if model:
        translated["model"] = model
    if n:
        translated["n"] = n
    translated["size"] = size_for_model(model_config, ratio, resolution, fallback=ratio or "16:9")
    return strip_schema_fields(translated)
