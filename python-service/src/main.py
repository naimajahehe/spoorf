#!/usr/bin/env python3
import sys

from src.utils.preflight import preflight, EXIT_OK, EXIT_ERROR

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except:
        pass

HOST = "127.0.0.1"
PORT = 8001

if __name__ == "__main__":
    # Pre-bind guard: cegah crash-loop akibat tabrakan port (WinError 10048).
    guard = preflight(HOST, PORT)
    if guard.action in (EXIT_OK, EXIT_ERROR):
        print(f"[Preflight] {guard.message}", file=sys.stderr, flush=True)
        sys.exit(guard.exit_code)

    import uvicorn
    print(f"[INFO] Launching NetCut Sentinel FastAPI Microservice on http://{HOST}:{PORT} ...")
    uvicorn.run("src.server:app", host=HOST, port=PORT, log_level="info", access_log=False)
