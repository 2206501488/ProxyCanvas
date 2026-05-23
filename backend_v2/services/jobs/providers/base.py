from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from services.jobs.store import JobStore
from services.jobs.model_payload import translate_provider_payload


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
        images = job.get("input_images")
        if not images:
            job_params = job.get("params") if isinstance(job.get("params"), dict) else {}
            images = (
                job_params.get("image_urls")
                or job_params.get("imageUrls")
                or job_params.get("input_images")
                or job_params.get("inputImages")
                or []
            )
        if images:
            params.setdefault("image_urls", images)
        return translate_provider_payload(str(job.get("provider") or self.name), params)
