"""
Network Telemetry Sampler
==========================
Menghitung throughput jaringan real-time (download & upload Mbps),
status sinyal Wi-Fi, dan latency ping gateway.
"""

import time
import psutil
from typing import Dict, Any
from .network import get_wifi_info, get_current_gateway
from ..utils.logger import logger

class NetworkTelemetrySampler:
    def __init__(self):
        self.last_time = time.time()
        self.last_bytes_recv = 0
        self.last_bytes_sent = 0
        # Adapter sumber `last_bytes_*`. Delta hanya sah bila adapter sample == adapter seed;
        # saat berganti (Wi-Fi<->Ethernet/tethering), counter antar-NIC tak sebanding.
        self.last_iface = ''
        self.last_ping_time = 0.0
        self.cached_latency_ms = 12
        self.init_counters()

    @staticmethod
    def _get_nic_counters(active_iface: str = ''):
        """Kembalikan counter NIC dari SATU sumber konsisten: adapter AKTIF (active_iface) bila
        tersedia, lalu 'Wi-Fi', jika tidak agregat. Meng-hardcode 'Wi-Fi' membuat throughput
        selalu terbaca dari kartu Wi-Fi yang idle (0 byte) saat pengguna memakai kabel LAN /
        tethering, sehingga grafik bandwidth mandek di 0.00 Mbps (BUG-15). Dipakai init_counters()
        & sample() agar seed & delta berasal dari sumber yang sama."""
        try:
            pernic = psutil.net_io_counters(pernic=True)
            if active_iface and active_iface in pernic:
                return pernic[active_iface]
            wifi = pernic.get('Wi-Fi')
            if wifi is not None:
                return wifi
        except:
            pass
        return psutil.net_io_counters()

    @staticmethod
    def _active_iface() -> str:
        """Nama adapter jaringan aktif saat ini (Wi-Fi / Ethernet / tethering)."""
        try:
            return (get_wifi_info() or {}).get('interface', '') or ''
        except Exception:
            return ''

    def init_counters(self):
        try:
            iface = self._active_iface()
            counters = self._get_nic_counters(iface)
            self.last_bytes_recv = counters.bytes_recv
            self.last_bytes_sent = counters.bytes_sent
            self.last_iface = iface
            self.last_time = time.time()
        except:
            pass

    def sample(self) -> Dict[str, Any]:
        now = time.time()
        dt = max(0.2, now - self.last_time)
        self.last_time = now

        # 1. Status Wi-Fi & Jaringan Universal (dengan TTL Cache)
        wifi_info = get_wifi_info()
        is_connected = bool(wifi_info.get('connected', False))
        ssid = wifi_info.get('ssid', '')
        signal = wifi_info.get('signal', '')
        interface_type = wifi_info.get('interface_type', 'wifi')

        # 2. Kalkulasi Throughput Real Download & Upload Mbps
        download_mbps = 0.0
        upload_mbps = 0.0
        try:
            current_iface = wifi_info.get('interface', '')
            nic_stat = self._get_nic_counters(current_iface)

            # Hitung delta HANYA bila counter berasal dari adapter yang SAMA dengan seed terakhir.
            # Saat adapter berganti (Wi-Fi<->Ethernet/tethering), selisih antar-NIC menghasilkan
            # spike phantom (adapter baru byte-nya jauh lebih besar) atau mandek 0 (lebih kecil,
            # ter-clamp). Untuk tick pergantian: reseed saja, laporkan 0.
            if current_iface == self.last_iface and self.last_bytes_recv > 0 and is_connected:
                delta_recv = max(0, nic_stat.bytes_recv - self.last_bytes_recv)
                delta_sent = max(0, nic_stat.bytes_sent - self.last_bytes_sent)
                download_mbps = round((delta_recv * 8) / (dt * 1024 * 1024), 2)
                upload_mbps = round((delta_sent * 8) / (dt * 1024 * 1024), 2)

            self.last_bytes_recv = nic_stat.bytes_recv
            self.last_bytes_sent = nic_stat.bytes_sent
            self.last_iface = current_iface
        except:
            pass

        # 3. Real Ping Latency ke Gateway (Di-sample tiap 3.5s untuk mencegah router queue overload)
        latency_ms = self.cached_latency_ms
        if is_connected:
            if (now - self.last_ping_time) >= 3.5:
                self.last_ping_time = now
                try:
                    gw = get_current_gateway()
                    if gw:
                        from .fingerprint.probe import ping_fast
                        p = ping_fast(gw)
                        self.cached_latency_ms = p.get('rtt', 12)
                    else:
                        self.cached_latency_ms = 14
                except:
                    pass
            latency_ms = self.cached_latency_ms

        return {
            'connected': is_connected,
            'ssid': ssid,
            'signal': signal,
            'interface_type': interface_type,
            'download': download_mbps,
            'upload': upload_mbps,
            'latency': latency_ms,
            'timestamp': int(now * 1000)
        }
