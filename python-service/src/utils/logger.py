"""Enterprise Logging Subsystem for NetCut Sentinel Network Engine.

Supports dual-mode output:
- Standard human-readable text logs (ideal for local PowerShell dev).
- High-performance, crash-safe Structured JSON logs (ideal for production/SIEM).
"""

from __future__ import annotations

import contextvars
import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from ..config import settings

# Context variable for distributed request tracing (e.g. from x-request-id)
request_id_ctx: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("request_id", default=None)

# Atribut internal standar logging.LogRecord yang tidak boleh diekstrak sebagai extra context
_RESERVED_ATTRS = frozenset({
    "args", "asctime", "created", "exc_info", "exc_text", "filename",
    "funcName", "levelname", "levelno", "lineno", "module", "msecs",
    "message", "msg", "name", "pathname", "process", "processName",
    "relativeCreated", "stack_info", "thread", "threadName"
})


class StructuredJSONFormatter(logging.Formatter):
    """Zero-dependency JSON formatter with automatic serialization of LogRecord extras.

    Defensive guarantee: Uses default=str in json.dumps to ensure that complex
    non-serializable network objects (Scapy packets, raw byte buffers) never crash logging.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "source": {
                "file": record.filename,
                "line": record.lineno,
                "function": record.funcName,
            },
        }

        # Automatically bind correlation ID from contextvars if present
        req_id = request_id_ctx.get()
        if req_id:
            payload["request_id"] = req_id

        # Ekstrak extra kwargs yang disematkan caller (mis: victim_ip, session_id, action)
        extras = {k: v for k, v in record.__dict__.items() if k not in _RESERVED_ATTRS}
        if extras:
            payload["context"] = extras

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)


def setup_logger(name: str = "netcut") -> logging.Logger:
    """Configures and returns the root netcut logger instance with idempotent handler registration."""
    logger = logging.getLogger(name)
    level_name = settings.LOG_LEVEL.upper()
    logger.setLevel(getattr(logging, level_name, logging.INFO))

    # Proteksi idempoten: jangan tambahkan handler jika sudah terdaftar
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stderr)

        if settings.LOG_FORMAT == "json":
            formatter: logging.Formatter = StructuredJSONFormatter()
        else:
            formatter = logging.Formatter(
                "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S"
            )

        handler.setFormatter(formatter)
        logger.addHandler(handler)

    return logger


# Inisialisasi root logger
_root_logger = setup_logger("netcut")


def get_logger(name: Optional[str] = None) -> logging.Logger:
    """
    Factory untuk mendapatkan logger terstruktur hierarkis.
    - get_logger() -> logging.Logger("netcut")
    - get_logger("spoofer") -> logging.Logger("netcut.spoofer")
    - get_logger("netcut.spoofer") -> logging.Logger("netcut.spoofer")
    Child loggers otomatis melakukan propagasi ke root netcut logger tanpa menduplikasi handler.
    """
    if not name or name == "netcut":
        return _root_logger

    if not name.startswith("netcut."):
        scoped_name = f"netcut.{name}"
    else:
        scoped_name = name

    child = logging.getLogger(scoped_name)
    child.propagate = True
    return child


logger = _root_logger