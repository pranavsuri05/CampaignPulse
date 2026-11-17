class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str, details: object | None = None):
        super().__init__(message)
        self.message = message
        self.details = details


class NotFound(AppError):
    status_code, code = 404, "not_found"


class Conflict(AppError):
    status_code, code = 409, "conflict"


class Unprocessable(AppError):
    status_code, code = 422, "unprocessable"


class PayloadTooLarge(AppError):
    status_code, code = 413, "payload_too_large"
