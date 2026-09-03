"""Port pre-bind guard: cegah crash-loop akibat tabrakan port (WinError 10048).

Uvicorn menjalankan startup lifespan FastAPI (yang mencetak "Engine READY" dan
menyalakan DHCP sniffer/telemetry/liveness) SEBELUM mencoba bind socket. Bila
port sudah dipegang engine lain, bind gagal dengan `[Errno 10048]` dan engine
langsung shutdown — supervisor Electron lalu me-respawn, bertabrakan lagi, dan
terbentuk crash-loop yang tampak sebagai "engine offline" di sisi Node.

Guard ini dipanggil di entrypoint SEBELUM `uvicorn.run(...)`:

  * Ada engine Spoorf sehat di port -> keluar tenang (exit 0). Supervisor
    menganggapnya "sudah jalan", bukan "crash", sehingga tidak me-respawn.
  * Port dipakai proses non-Spoorf -> pesan actionable + exit 1.
  * Port bebas -> lanjut startup normal.
"""

from __future__ import annotations

import json
import socket
import urllib.request
from dataclasses import dataclass
from typing import Callable, Tuple

# Aksi hasil preflight.
PROCEED = "proceed"
EXIT_OK = "exit_ok"
EXIT_ERROR = "exit_error"


@dataclass(frozen=True)
class PreflightResult:
    action: str
    exit_code: int
    message: str


def decide(engine_alive: bool, port_free: bool) -> Tuple[str, int]:
    """Keputusan murni. Sinyal 'engine hidup' lebih otoritatif dari 'port bebas'."""
    if engine_alive:
        return (EXIT_OK, 0)
    if not port_free:
        return (EXIT_ERROR, 1)
    return (PROCEED, 0)


def is_port_free(host: str, port: int) -> bool:
    """True bila kita bisa bind (host, port). Meniru bind uvicorn tanpa reuse."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((host, port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def probe_spoorf_engine(host: str, port: int, timeout: float = 1.0) -> bool:
    """True bila /health menjawab dan responsnya milik engine Spoorf."""
    url = f"http://{host}:{port}/health"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            if resp.status != 200:
                return False
            data = json.loads(resp.read().decode("utf-8", "replace"))
    except Exception:
        return False
    return (
        isinstance(data, dict)
        and "npcap_ready" in data
        and str(data.get("engine", "")).startswith("FastAPI")
    )


def preflight(
    host: str,
    port: int,
    port_free_fn: Callable[[str, int], bool] = is_port_free,
    engine_probe_fn: Callable[[str, int], bool] = probe_spoorf_engine,
) -> PreflightResult:
    """Cek port sebelum bind dan kembalikan aksi yang harus diambil entrypoint."""
    free = port_free_fn(host, port)
    engine = False if free else engine_probe_fn(host, port)
    action, code = decide(engine_alive=engine, port_free=free)
    messages = {
        PROCEED: f"Port {host}:{port} bebas - melanjutkan startup engine.",
        EXIT_OK: (
            f"Engine Spoorf lain sudah aktif di {host}:{port}. "
            "Keluar dengan tenang (exit 0) agar supervisor tidak me-respawn."
        ),
        EXIT_ERROR: (
            f"Port {host}:{port} dipakai proses lain (bukan engine Spoorf). "
            "Tutup proses tersebut atau ubah port, lalu jalankan ulang."
        ),
    }
    return PreflightResult(action=action, exit_code=code, message=messages[action])
