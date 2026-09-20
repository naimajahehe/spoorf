#!/usr/bin/env python3
"""
NetCut Sentinel FastAPI Server & WebSocket Event Hub
====================================================
FastAPI microservice menyediakan REST API dan WebSocket stream
untuk orkestrator L2 network discovery, ARP spoofing, dan live telemetry.
Modularized architecture (APIRouter per domain, DI via Depends, and Lifespan Manager).
"""

import logging
import time
import uuid
import warnings

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api.routes import ALL_ROUTERS
from .config import settings, verify_api_token
from .container import get_default_container
from .lifespan import lifespan
from .utils.logger import logger, request_id_ctx

# Redam peringatan kompatibilitas internal Scapy & Cryptography
warnings.filterwarnings("ignore", category=DeprecationWarning, module="scapy")
try:
    from cryptography.utils import CryptographyDeprecationWarning
    warnings.filterwarnings("ignore", category=CryptographyDeprecationWarning)
except Exception:
    pass

logging.getLogger("scapy.runtime").setLevel(logging.ERROR)

# Inisialisasi FastAPI dengan Modern Lifespan Context Manager
app = FastAPI(
    title="NetCut Sentinel Network Engine",
    description="Modular High-Performance Layer 2 Network Discovery, ARP Spoofing, L7 Interception & Bettercap Security Suite Engine",
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

# CORS terkunci
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# OBSERVABILITAS: Distributed Tracing & HTTP Access Logging Middleware
@app.middleware("http")
async def request_tracing_middleware(request: Request, call_next):
    raw_req_id = request.headers.get("x-request-id")
    req_id = raw_req_id.strip() if raw_req_id and raw_req_id.strip() else uuid.uuid4().hex[:12]

    token = request_id_ctx.set(req_id)
    start_time = time.perf_counter()
    try:
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        response.headers["x-request-id"] = req_id

        # Redam log akses rutin /health kecuali ada error atau mode debug
        if request.url.path not in _PUBLIC_PATHS or response.status_code >= 400:
            logger.info(
                f"{request.method} {request.url.path} {response.status_code} ({duration_ms}ms)",
                extra={
                    "http": {
                        "method": request.method,
                        "path": request.url.path,
                        "status_code": response.status_code,
                        "duration_ms": duration_ms,
                        "client_ip": request.client.host if request.client else None,
                    }
                }
            )
        return response
    except Exception as exc:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        logger.error(
            f"{request.method} {request.url.path} UNHANDLED_EXCEPTION ({duration_ms}ms): {exc}",
            exc_info=True,
            extra={
                "http": {
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": duration_ms,
                    "client_ip": request.client.host if request.client else None,
                }
            }
        )
        raise
    finally:
        request_id_ctx.reset(token)


# KEAMANAN (P1): Universal Fail-Closed Token Guard
_PUBLIC_PATHS = {"/health", "/api/health"}


@app.middleware("http")
async def api_token_guard(request: Request, call_next):
    if request.url.path not in _PUBLIC_PATHS and request.method != "OPTIONS":
        provided = request.headers.get("x-sentinel-token")
        ok, reason = verify_api_token(provided, settings)
        if not ok:
            return JSONResponse(
                status_code=401,
                content={"success": False, "error": reason or "Unauthorized: missing or invalid API token."}
            )
    return await call_next(request)


# KEAMANAN (P2): Sanitasi respons error 5xx
@app.exception_handler(StarletteHTTPException)
async def sanitized_http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code >= 500:
        logger.error(
            f"[API {exc.status_code}] {request.method} {request.url.path}: {exc.detail}",
            exc_info=True
        )
        return JSONResponse(status_code=exc.status_code, content={"success": False, "error": "Internal server error"})
    return JSONResponse(status_code=exc.status_code, content={"success": False, "error": exc.detail})


# Registrasi seluruh Domain APIRouter
for router in ALL_ROUTERS:
    app.include_router(router)


# Container singleton instance untuk accessor modul ASGI
container = get_default_container()

__all__ = [
    "app",
    "container",
    "request_tracing_middleware",
    "api_token_guard",
    "sanitized_http_exception_handler",
]
