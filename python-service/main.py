import sys
import multiprocessing

from src.utils.preflight import preflight, EXIT_OK, EXIT_ERROR

HOST = "127.0.0.1"
PORT = 8001


def main() -> int:
    multiprocessing.freeze_support()

    # Pre-bind guard: cegah crash-loop akibat tabrakan port (WinError 10048).
    # Dijalankan SEBELUM impor berat (scapy/cert/interface) agar entrypoint kedua
    # keluar cepat tanpa menyalakan side effect saat port sudah dipegang engine lain.
    guard = preflight(HOST, PORT)
    if guard.action in (EXIT_OK, EXIT_ERROR):
        print(f"[Preflight] {guard.message}", file=sys.stderr, flush=True)
        return guard.exit_code

    import uvicorn
    from src.server import app
    uvicorn.run(app, host=HOST, port=PORT, log_level="info", access_log=False)
    return 0


if __name__ == '__main__':
    sys.exit(main())
