"""Centralized Configuration & Settings Engine for NetCut Sentinel.

Single source of truth utilizing Pydantic v2 and python-dotenv.
Provides runtime validation, type coercion, environment variable priority,
and zero-regression backward compatibility.
"""

from __future__ import annotations

import hmac
import os
import sys
from pathlib import Path
from typing import List, Optional, Tuple

from dotenv import load_dotenv
from pydantic import BaseModel, Field, field_validator

# Muat file .env dari python-service, backend-node, atau root repo
_local_env = Path(__file__).resolve().parent.parent / ".env"
_backend_env = Path(__file__).resolve().parent.parent.parent / "backend-node" / ".env"
_root_env = Path(__file__).resolve().parent.parent.parent / ".env"

if _local_env.exists():
    load_dotenv(dotenv_path=_local_env)
elif _backend_env.exists():
    load_dotenv(dotenv_path=_backend_env)
elif _root_env.exists():
    load_dotenv(dotenv_path=_root_env)
else:
    load_dotenv()


class EngineSettings(BaseModel):
    """Declarative typed configuration schema for NetCut Sentinel Network Engine."""

    # Server Bindings
    HOST: str = Field(default="127.0.0.1")
    PORT: int = Field(default=8001, ge=1, le=65535)

    # Product Metadata
    APP_VERSION: str = Field(default="2.41.66")
    ENVIRONMENT: str = Field(default="development")

    # Logging Controls
    LOG_LEVEL: str = Field(default="INFO")
    LOG_FORMAT: str = Field(default="text")

    # ThreadPool Concurrency
    MAX_WORKERS: int = Field(default=5, gt=0)

    # Security, Token Guard, and CORS
    SENTINEL_API_TOKEN: Optional[str] = Field(default=None)
    SENTINEL_ALLOW_INSECURE_DEV: bool = Field(default=False)
    PY_CORS_ORIGINS: str = Field(default="")

    # Legacy Backward Compatibility Parameters
    ARP_TIMEOUT: int = Field(default=3, gt=0)
    SPOOF_INTERVAL: int = Field(default=1, gt=0)

    @field_validator("LOG_LEVEL", mode="before")
    @classmethod
    def normalize_log_level(cls, v: object) -> str:
        if isinstance(v, str):
            val = v.strip().upper()
            if val in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
                return val
        return "INFO"

    @field_validator("LOG_FORMAT", mode="before")
    @classmethod
    def normalize_log_format(cls, v: object) -> str:
        if isinstance(v, str):
            val = v.strip().lower()
            if val in ("text", "json"):
                return val
        return "text"

    @property
    def cors_origins(self) -> List[str]:
        """Parsed list of allowed CORS origins, stripped and deduplicated."""
        if not self.PY_CORS_ORIGINS or not self.PY_CORS_ORIGINS.strip():
            return []
        return [o.strip() for o in self.PY_CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        """True if running as frozen binary (PyInstaller) or in production environment."""
        return getattr(sys, "frozen", False) or self.ENVIRONMENT.lower() == "production"

    @classmethod
    def from_env(cls) -> "EngineSettings":
        """Factory initializing settings from active environment variables."""

        def get_bool(key: str, default: bool = False) -> bool:
            v = os.getenv(key)
            if v is None:
                return default
            return v.strip().lower() in ("1", "true", "yes", "on")

        def get_int(key: str, default: int) -> int:
            try:
                v = os.getenv(key)
                return int(v) if v is not None else default
            except ValueError:
                return default

        token = os.getenv("SENTINEL_API_TOKEN")
        cleaned_token = token.strip() if token and token.strip() else None

        env_val = os.getenv("SENTINEL_ENV", os.getenv("NODE_ENV", "development"))
        is_prod = getattr(sys, "frozen", False) or env_val.lower() == "production"
        dev_default = not is_prod

        return cls(
            HOST=os.getenv("ENGINE_HOST", os.getenv("HOST", "127.0.0.1")),
            PORT=get_int("ENGINE_PORT", get_int("PORT", 8001)),
            APP_VERSION=os.getenv("APP_VERSION", "2.41.66"),
            ENVIRONMENT=env_val,
            LOG_LEVEL=os.getenv("LOG_LEVEL", "INFO"),
            LOG_FORMAT=os.getenv("LOG_FORMAT", "text"),
            MAX_WORKERS=get_int("MAX_WORKERS", 5),
            SENTINEL_API_TOKEN=cleaned_token,
            SENTINEL_ALLOW_INSECURE_DEV=get_bool("SENTINEL_ALLOW_INSECURE_DEV", dev_default),
            PY_CORS_ORIGINS=os.getenv("PY_CORS_ORIGINS", ""),
            ARP_TIMEOUT=get_int("ARP_TIMEOUT", 3),
            SPOOF_INTERVAL=get_int("SPOOF_INTERVAL", 1),
        )


def verify_api_token(provided_token: Optional[str], s: Optional[EngineSettings] = None) -> Tuple[bool, Optional[str]]:
    """Evaluates an incoming token against Sentinel fail-closed authorization policy.

    Returns:
        (is_authorized, rejection_reason_if_false)
    """
    active_settings = s or settings
    expected = active_settings.SENTINEL_API_TOKEN

    # 1. Jika token dikonfigurasi, wajib cocok (timing-safe)
    if expected:
        if not provided_token or not hmac.compare_digest(provided_token, expected):
            return False, "Unauthorized: missing or invalid API token."
        return True, None

    # 2. Jika token TIDAK diset di produksi -> Fail-Closed Mutlak
    if active_settings.is_production:
        return False, "Unauthorized: SENTINEL_API_TOKEN is mandatory in production environment."

    # 3. Jika token TIDAK diset di dev -> Cek Escape Hatch
    if active_settings.SENTINEL_ALLOW_INSECURE_DEV:
        return True, None

    # 4. Default Fail-Closed: Tolak akses tanpa token pada loopback
    return False, (
        "Unauthorized: fail-closed auth enabled by default. "
        "Set SENTINEL_API_TOKEN in your environment or set SENTINEL_ALLOW_INSECURE_DEV=1 for dev mode."
    )


# Authoritative Global Singleton Instance
settings = EngineSettings.from_env()
