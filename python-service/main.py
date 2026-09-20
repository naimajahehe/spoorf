import multiprocessing
import sys

from src.config import settings
from src.utils.logger import logger
from src.utils.preflight import preflight, EXIT_OK, EXIT_ERROR

HOST = settings.HOST
PORT = settings.PORT


def main() -> int:
    multiprocessing.freeze_support()

    # Pre-bind guard: cegah crash-loop akibat tabrakan port (WinError 10048).
    # Dijalankan SEBELUM impor berat (scapy/cert/interface) agar entrypoint kedua
    # keluar cepat tanpa menyalakan side effect saat port sudah dipegang engine lain.
    guard = preflight(HOST, PORT)
    if guard.action in (EXIT_OK, EXIT_ERROR):
        if guard.action == EXIT_OK:
            logger.info(f"[Preflight] {guard.message}")
        else:
            logger.error(f"[Preflight] {guard.message}")
        return guard.exit_code

    import uvicorn
    from src.server import app
    logger.info(f"Launching NetCut Sentinel FastAPI Microservice on http://{HOST}:{PORT} ...")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info", access_log=False)
    return 0


if __name__ == '__main__':
    sys.exit(main())
