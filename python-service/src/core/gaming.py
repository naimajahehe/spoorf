"""
Sentinel Gaming Engine - Ultra-Low Latency & Anti-Jitter Subsystem
===================================================================
Menyediakan pengoptimalan jaringan Layer-2 otomatis untuk gaming kompetitif:
1. Dynamic Airtime Optimization: Mengisolasi trafik download perangkat lain agar antrean router kosong.
2. Zero-Lag Blackhole Forwarding: Mencegah router membanjiri laptop dengan trafik video orang lain.
3. Sub-Second Jitter & Latency Watchdog: Mengukur latensi real-time (ms), variasi jitter, dan packet loss.
"""

import re
import time
import math
import random
import threading
import subprocess
import collections
from typing import Dict, Any, List, Optional, Callable
from .network import get_current_gateway, get_network_info, is_valid_private_ip
from ..utils.logger import logger

# Ambil RTT ICMP asli dari output `ping` Windows. Menangkap English ("time=34ms",
# "time<1ms") maupun lokal Indonesia ("waktu=34ms", "waktu<1ms"). Nilai inilah
# latensi jaringan sebenarnya — bukan wall-clock spawn subprocess yang membengkak
# saat CPU sibuk (banyak thread spoof-loop) dan membuat ping tampak tinggi palsu.
_PING_RTT_RE = re.compile(r"(?:time|waktu)\s*([=<])\s*(\d+)\s*ms", re.IGNORECASE)


def parse_ping_rtt_ms(stdout: str) -> Optional[float]:
    """Kembalikan RTT (ms) dari output ping, atau None bila tak ada balasan.

    Untuk "time<1ms" kembalikan 1.0 (batas atas sub-milidetik) agar tetap masuk akal.
    """
    if not stdout:
        return None
    m = _PING_RTT_RE.search(stdout)
    if not m:
        return None
    op, val = m.group(1), float(m.group(2))
    if op == '<':
        # "<1ms" -> pakai nilainya sebagai batas atas (mis. 1.0), minimal 0.5.
        return max(0.5, val)
    return max(0.5, val)


class GamingEngine:
    """
    Sub-layanan pengoptimalan latensi dan jitter untuk mode gaming.
    Thread-safe dan hemat resource CPU.
    """
    def __init__(self, event_callback: Optional[Callable[[str, Dict[str, Any]], None]] = None):
        self._lock = threading.Lock()
        self._is_enabled = False
        self._mode = "auto_airtime"  # "auto_airtime" | "blackhole_priority"
        self._target_ping_ms = 25.0
        self._activated_at: Optional[float] = None
        self._event_callback = event_callback
        
        # Telemetry sensor buffers
        self._latest_ping: float = 18.0
        self._latest_jitter: float = 1.2
        self._packet_loss: float = 0.0
        self._ping_history = collections.deque(maxlen=30)
        self._loss_window = collections.deque(maxlen=20)
        
        self._stop_event = threading.Event()
        self._watchdog_thread: Optional[threading.Thread] = None

    def set_event_callback(self, callback: Callable[[str, Dict[str, Any]], None]):
        """Setel fungsi callback untuk menyiarkan event WebSocket ke Node.js / UI."""
        self._event_callback = callback

    def is_enabled(self) -> bool:
        with self._lock:
            return self._is_enabled

    def get_status(self) -> Dict[str, Any]:
        """Mengembalikan status terkini Gaming Mode beserta telemetri latensi."""
        with self._lock:
            return self._get_status_unlocked()

    def toggle(self, enabled: bool, mode: str = "auto_airtime", target_ping_ms: float = 25.0) -> Dict[str, Any]:
        """Aktifkan atau nonaktifkan Mode Gaming."""
        with self._lock:
            if self._is_enabled == enabled:
                if enabled:
                    self._mode = mode
                    self._target_ping_ms = target_ping_ms
                return self._get_status_unlocked()

            self._is_enabled = enabled
            self._mode = mode
            self._target_ping_ms = max(5.0, min(100.0, target_ping_ms))

            if enabled:
                self._activated_at = time.time()
                self._stop_event.clear()
                self._watchdog_thread = threading.Thread(
                    target=self._telemetry_watchdog_loop,
                    name="GamingWatchdogThread",
                    daemon=True
                )
                self._watchdog_thread.start()
                logger.info(f"🎮 Mode Gaming DIAKTIFKAN (Mode: {self._mode}, Target Ping: {self._target_ping_ms}ms)")
            else:
                self._activated_at = None
                self._stop_event.set()
                logger.info("🎮 Mode Gaming DINONAKTIFKAN (Kembali ke mode normal)")

            status = self._get_status_unlocked()

        if self._event_callback:
            try:
                self._event_callback("gaming_status_changed", status)
            except Exception as e:
                logger.debug(f"Error broadcasting gaming status: {e}")

        return status

    def _get_status_unlocked(self) -> Dict[str, Any]:
        uptime_sec = round(time.time() - self._activated_at, 1) if (self._is_enabled and self._activated_at) else 0.0
        return {
            "is_enabled": self._is_enabled,
            "mode": self._mode,
            "target_ping_ms": self._target_ping_ms,
            "ping_ms": round(self._latest_ping, 1),
            "jitter_ms": round(self._latest_jitter, 1),
            "packet_loss_pct": round(self._packet_loss, 1),
            "uptime_seconds": uptime_sec,
            "timestamp": time.time()
        }

    def _measure_realtime_ping(self, target_ip: str) -> Optional[float]:
        """Ukur latensi ke host target dengan fast single ping (~350ms timeout).

        Latensi diambil dari nilai ICMP asli (time=/waktu=) pada output ping —
        BUKAN wall-clock mengelilingi spawn subprocess. Wall-clock membengkak
        drastis saat CPU sibuk oleh banyak thread spoof-loop Gaming Mode, sehingga
        dulu membuat ping tampak sangat tinggi padahal jaringan baik-baik saja.
        """
        try:
            p = subprocess.run(
                ["ping", "-n", "1", "-w", "350", target_ip],
                capture_output=True,
                text=True,
                timeout=1.0,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)  # cegah kedip konsol Windows
            )
            rtt = parse_ping_rtt_ms(p.stdout)
            if rtt is not None:
                return rtt
        except Exception:
            pass
        return None

    def _telemetry_watchdog_loop(self):
        """Loop latar belakang pengukur latensi & jitter setiap 1.0 detik."""
        # Ukur latensi ke INTERNET (Cloudflare 1.1.1.1), bukan gateway lokal —
        # agar angka mencerminkan ping gaming nyata, bukan ~1ms LAN.
        ping_target = "1.1.1.1"

        while not self._stop_event.is_set():
            sample_time = time.time()
            rtt = self._measure_realtime_ping(ping_target)

            with self._lock:
                if rtt is not None:
                    self._ping_history.append(rtt)
                    self._loss_window.append(0)
                    self._latest_ping = rtt
                else:
                    self._loss_window.append(1)

                if len(self._ping_history) >= 2:
                    diffs = [
                        abs(self._ping_history[i] - self._ping_history[i - 1])
                        for i in range(1, len(self._ping_history))
                    ]
                    self._latest_jitter = sum(diffs) / len(diffs)
                else:
                    self._latest_jitter = 0.8

                if len(self._loss_window) > 0:
                    self._packet_loss = (sum(self._loss_window) / len(self._loss_window)) * 100.0
                else:
                    self._packet_loss = 0.0

                telemetry_payload = {
                    "ping_ms": round(self._latest_ping, 1),
                    "jitter_ms": round(self._latest_jitter, 1),
                    "packet_loss_pct": round(self._packet_loss, 1),
                    "is_optimal": self._latest_ping <= self._target_ping_ms,
                    "timestamp": sample_time
                }

            if self._event_callback:
                try:
                    self._event_callback("gaming_telemetry", telemetry_payload)
                except Exception as e:
                    logger.debug(f"Error emitting gaming telemetry: {e}")

            if self._stop_event.wait(1.0):
                break

gaming_engine = GamingEngine()
