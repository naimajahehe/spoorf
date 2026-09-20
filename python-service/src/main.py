#!/usr/bin/env python3
import sys

from src.config import settings
from src.utils.logger import logger
from src.utils.preflight import preflight, EXIT_OK, EXIT_ERROR

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

HOST = settings.HOST
PORT = settings.PORT

if __name__ == "__main__":
    # Pre-bind guard: cegah crash-loop akibat tabrakan port (WinError 10048).
    guard = preflight(HOST, PORT)
    if guard.action in (EXIT_OK, EXIT_ERROR):
        if guard.action == EXIT_OK:
            logger.info(f"[Preflight] {guard.message}")
        else:
            logger.error(f"[Preflight] {guard.message}")
        sys.exit(guard.exit_code)

    import uvicorn
    logger.info(f"Launching NetCut Sentinel FastAPI Microservice on http://{HOST}:{PORT} ...")
    uvicorn.run("src.server:app", host=HOST, port=PORT, log_level="info", access_log=False)
