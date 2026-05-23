from __future__ import annotations

from typing import Any

from .common import canonical_resolution, cliproxy_pixel_size, int_value, size_for_model, strip_schema_fields


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

    resolution_key = canonical_resolution(resolution) or "2K"
    # CLIProxy keeps the legacy size field, but the actual meaning depends on
    # the selected model and resolution. This mapping is centralized here so the
    # worker and the UI do not need to duplicate it.
    translated["size"] = size_for_model(
        model_config,
        ratio or "16:9",
        resolution_key,
        fallback=(ratio if model == "gemini-3.1-flash-image" else cliproxy_pixel_size(ratio, resolution_key)),
    )
    translated["resolution"] = resolution_key
    if quality:
        translated["quality"] = quality
    if source.get("inputMaxEdge"):
        translated["input_max_edge"] = int_value(source.get("inputMaxEdge"))
    return strip_schema_fields(translated)
