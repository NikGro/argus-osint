"""Execution-scoped cancellation, shared by services and process adapters."""

import contextvars

CANCEL_EVENT = contextvars.ContextVar("actor_cancel_event", default=None)


def checkpoint():
    event = CANCEL_EVENT.get()
    if event is not None and event.is_set():
        from core.errors import AppError

        raise AppError("actor_cancelled", 409)
