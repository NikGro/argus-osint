"""Execution-scoped cancellation, shared by services and process adapters."""

import contextvars

CANCEL_EVENT = contextvars.ContextVar("actor_cancel_event", default=None)
