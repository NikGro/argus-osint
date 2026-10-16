"""Stable transport codes; human diagnostics are never translation identifiers."""


class AppError(Exception):
    def __init__(self, code, status=400, detail="", **params):
        self.code, self.status, self.detail, self.params = code, status, detail, params
        super().__init__(detail or code)


def classify(error):
    if isinstance(error, AppError):
        return error
    if isinstance(error, KeyError):
        return AppError("not_found", 404)
    if isinstance(error, (ValueError, TypeError)):
        return AppError("validation_failed", 400, str(error))
    return AppError("internal_error", 500)
