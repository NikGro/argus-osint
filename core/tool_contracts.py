"""One transport-independent contract for built-in and community tool results."""

from typing import Any, Literal, TypedDict

ToolState = Literal["failed", "needs_input", "needs_selection", "completed"]


class ToolResult(TypedDict, total=False):
    outputs: list[dict[str, Any]]
    updates: list[dict[str, Any]]
    warnings: list[str]
    failed: bool
    error: str | None
    log: str
    candidates: list[dict[str, Any]]
    input_request: dict[str, Any] | None


def validate_result(value: Any) -> ToolResult:
    if not isinstance(value, dict):
        raise ValueError("Invalid tool result.")
    for key in ("outputs", "updates", "warnings", "candidates"):
        if key in value and not isinstance(value[key], list):
            raise ValueError("Invalid tool result field: " + key)
    if not isinstance(value.get("outputs"), list) or len(value["outputs"]) > 5000:
        raise ValueError("A tool must return at most 5000 output nodes.")
    if value.get("input_request") is not None and not isinstance(
        value["input_request"], dict
    ):
        raise ValueError("Invalid tool input request.")
    return value


def result_state(result: ToolResult) -> ToolState:
    if result.get("failed"):
        return "failed"
    if result.get("input_request"):
        return "needs_input"
    if result.get("candidates"):
        return "needs_selection"
    return "completed"
