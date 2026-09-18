from __future__ import annotations


class AllyError(Exception):
    """Base error with a patient-safe message."""

    status = 500
    code = "ally_error"

    def __init__(self, message: str, *, detail: str = "") -> None:
        super().__init__(message)
        self.detail = detail


class LLMError(AllyError):
    status = 503
    code = "llm_unavailable"


class NotConfigured(AllyError):
    status = 503
    code = "not_configured"


class Forbidden(AllyError):
    status = 403
    code = "forbidden"


class Conflict(AllyError):
    status = 409
    code = "conflict"


class NotFound(AllyError):
    status = 404
    code = "not_found"
