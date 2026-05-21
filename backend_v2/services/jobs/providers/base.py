from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from services.jobs.store import JobStore


class ProviderError(Exception):
    pass


class ProviderTimeout(ProviderError):
    pass


class ProviderAdapter(ABC):
    name: str

    @abstractmethod
    def run(self, job: dict[str, Any], store: JobStore) -> list[dict[str, Any]]:
        """Run a queued job to completion and return normalized image records."""

    def normalize_payload(self, job: dict[str, Any]) -> dict[str, Any]:
        params = dict(job.get("params") or {})
        params.setdefault("prompt", job.get("prompt") or "")
        if job.get("input_images"):
            params.setdefault("image_urls", job["input_images"])
        return params
