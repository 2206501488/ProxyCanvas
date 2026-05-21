class SousakuError(Exception):
    """Base exception for Sousaku SDK errors."""


class SousakuAuthError(SousakuError):
    """Raised when all configured tokens are rejected."""


class SousakuAPIError(SousakuError):
    """Raised when Sousaku returns an application-level error."""


class SousakuTimeoutError(SousakuError):
    """Raised when a task does not finish before the timeout."""


class SousakuTaskFailedError(SousakuError):
    """Raised when a Sousaku generation task fails."""

    def __init__(self, task_id: str, message: str, raw: dict | None = None):
        super().__init__(f"Sousaku task failed: {task_id}: {message}")
        self.task_id = task_id
        self.message = message
        self.raw = raw or {}
