class LumaLabsError(Exception):
    """Base exception for LumaLabs SDK errors."""


class LumaLabsAuthError(LumaLabsError):
    """Raised when the configured web session is rejected."""


class LumaLabsAPIError(LumaLabsError):
    """Raised when LumaLabs returns an application-level error."""


class LumaLabsConfigError(LumaLabsError):
    """Raised when required local SDK configuration is missing or invalid."""
