"""Enterprise Logging Subsystem for NetCut Sentinel Network Engine.

Supports dual-mode output:
- Standard human-readable text logs (ideal for local PowerShell dev).
- High-performance, crash-safe Structured JSON logs (ideal for production/SIEM).
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any, Dict

from ..config import settings

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
        }

        # Ekstrak extra kwargs yang disematkan caller (mis: victim_ip, session_id, action)
        extras = {k: v for k, v in record.__dict__.items() if k not in _RESERVED_ATTRS}
        if extras:
            payload["context"] = extras

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)


def setup_logger(name: str = "netcut") -> logging.Logger:
    """Configures and returns a logger instance with idempotent handler registration."""
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


logger = setup_logger()