from __future__ import annotations

from typing import Any

from .common import canonical_resolution, default, size_for_model, strip_schema_fields


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
    resolution_key = canonical_resolution(resolution) or resolution
    translated["size"] = size_for_model(model_config, ratio, resolution_key, fallback=ratio or str(source.get("size") or "16:9"))
    if resolution_key:
        translated["resolution"] = resolution_key

    # Keep the official GPT-Image-2 path explicit, because APIMart treats it as
    # a slightly different payload shape than the Gemini-family models.
    if model == "gpt-image-2-official":
        translated["quality"] = quality or "high"
        translated["moderation"] = source.get("moderation") or default(model_config, "moderation") or "low"

    return strip_schema_fields(translated)
