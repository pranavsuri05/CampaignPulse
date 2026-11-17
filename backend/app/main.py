import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_settings
from app.errors import AppError
from app.routers import campaigns, data

log = logging.getLogger("campaign_pulse")


def _err(status: int, code: str, message: str, details: object | None = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details}})


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Campaign Pulse API", version="1.0.0",
                  description="Pre-send verification and post-send diagnostics for event emails. "
                              "Simulation Mode — No real emails are being sent.")
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origin_list, allow_methods=["GET", "POST", "PATCH", "DELETE"],
                       allow_headers=["Content-Type", "X-API-Key"], expose_headers=["Content-Disposition", "X-Row-Count"])

    @app.middleware("http")
    async def api_key_guard(request: Request, call_next):
        key = get_settings().api_key
        if key and request.method in ("POST", "PATCH", "DELETE", "PUT") and request.headers.get("x-api-key") != key:
            return _err(401, "unauthorized", "A valid X-API-Key header is required for this operation.")
        return await call_next(request)

    @app.exception_handler(AppError)
    async def app_error(_: Request, e: AppError):
        return _err(e.status_code, e.code, e.message, e.details)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, e: StarletteHTTPException):
        return _err(e.status_code, "http_error", str(e.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, e: RequestValidationError):
        details = [{"field": ".".join(str(p) for p in x["loc"][1:]), "message": x["msg"]} for x in e.errors()]
        return _err(422, "validation_error", "Request validation failed.", details)

    @app.exception_handler(Exception)
    async def unhandled(_: Request, e: Exception):
        log.error("Unhandled error: %s", type(e).__name__)  # no request data / PII in logs
        return _err(500, "internal_error", "Something went wrong. Please try again.")

    app.include_router(campaigns.router)
    app.include_router(data.router)
    return app


app = create_app()
