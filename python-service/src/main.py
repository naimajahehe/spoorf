#!/usr/bin/env python3
import sys
import uvicorn

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except:
        pass

if __name__ == "__main__":
    print("[INFO] Launching NetCut Sentinel FastAPI Microservice on http://127.0.0.1:8001 ...")
    uvicorn.run("src.server:app", host="127.0.0.1", port=8001, log_level="info", access_log=False)
