#!/usr/bin/env python3
"""
Bettercap-Style Fast SYN & Port Reconnaissance Scanner
======================================================
Pemindai port TCP asinkronus berkecepatan tinggi terinspirasi dari modul Bettercap `syn.scan`:
- Multi-threaded TCP Port probing
- Preset profil port (Top 20, Top 100, Common Web/Admin, Custom)
- Service banner grabbing (SSH, HTTP Server, FTP, SMB, Telnet, DB)
- Latency & service identification
"""

import socket
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, asdict

from ...utils.logger import logger

# Batas maksimum jumlah port kustom untuk mencegah resource exhaustion (port sweep berlebih)
MAX_CUSTOM_PORTS = 1024

# Port profiling presets
TOP_20_PORTS = [21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 993, 995, 1433, 3306, 3389, 5432, 8080, 8443]

TOP_100_PORTS = [
    20, 21, 22, 23, 25, 53, 67, 68, 69, 80, 88, 110, 111, 119, 123, 135, 137, 138, 139, 143,
    161, 162, 179, 389, 443, 445, 465, 500, 514, 515, 520, 587, 631, 636, 873, 902, 989, 990,
    993, 995, 1025, 1080, 1194, 1433, 1434, 1521, 1701, 1723, 1812, 1883, 2049, 2082, 2083,
    2086, 2087, 2181, 2222, 3000, 3128, 3306, 3389, 3690, 4369, 5000, 5060, 5222, 5432, 5672,
    5900, 5984, 6379, 6667, 7000, 8000, 8008, 8080, 8081, 8088, 8443, 8500, 8888, 9000, 9042,
    9090, 9092, 9100, 9200, 9300, 9418, 9999, 10000, 11211, 27017, 27018, 28017, 50000, 50070
]

PORT_SERVICE_MAP = {
    21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
    80: "HTTP", 110: "POP3", 135: "MS-RPC", 139: "NetBIOS", 143: "IMAP",
    443: "HTTPS", 445: "SMB", 587: "SMTP-Submission", 993: "IMAPS", 995: "POP3S",
    1433: "MSSQL", 1521: "Oracle-DB", 2049: "NFS", 3000: "Node-App", 3306: "MySQL",
    3389: "RDP", 5000: "Flask-App", 5432: "PostgreSQL", 5900: "VNC", 6379: "Redis",
    8000: "HTTP-Alt", 8001: "FastAPI-App", 8080: "HTTP-Proxy", 8443: "HTTPS-Alt",
    8888: "HTTP-Admin", 9000: "Sonar-PHP", 9200: "Elasticsearch", 27017: "MongoDB"
}


@dataclass
class PortScanResult:
    port: int
    state: str  # 'open' | 'closed' | 'filtered'
    service: str
    banner: Optional[str] = None
    rtt_ms: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class FastSYNScanner:
    """Pemindai port asinkronus berkecepatan tinggi dengan identifikasi banner layanan."""

    def __init__(self, max_workers: int = 50, timeout: float = 1.0):
        self.max_workers = max_workers
        self.timeout = timeout

    @staticmethod
    def _sanitize_ports(ports: List[int]) -> List[int]:
        """Saring port kustom: hanya integer 1..65535, buang duplikat (jaga urutan), cap MAX_CUSTOM_PORTS."""
        seen = set()
        clean: List[int] = []
        for p in ports:
            try:
                pi = int(p)
            except (TypeError, ValueError):
                continue
            if 1 <= pi <= 65535 and pi not in seen:
                seen.add(pi)
                clean.append(pi)
                if len(clean) >= MAX_CUSTOM_PORTS:
                    break
        return clean

    def _probe_port(self, target_ip: str, port: int) -> Optional[PortScanResult]:
        """Lakukan socket connect probe dan ambil service banner jika terbuka."""
        start_t = time.perf_counter()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)

        try:
            res = sock.connect_ex((target_ip, port))
            rtt = round((time.perf_counter() - start_t) * 1000, 2)

            if res == 0:
                service = PORT_SERVICE_MAP.get(port, f"TCP-{port}")
                banner = None

                # Coba grab banner (non-blocking)
                try:
                    sock.settimeout(0.6)
                    # Jika HTTP, kirim HEAD request
                    if port in (80, 8080, 8000, 3000, 5000, 8888):
                        sock.sendall(b"HEAD / HTTP/1.0\r\nHost: target\r\n\r\n")
                    # Jika SSH / FTP, banner otomatis dikirim server
                    raw = sock.recv(256)
                    if raw:
                        banner = raw.decode("utf-8", errors="ignore").strip().split("\r\n")[0][:100]
                except Exception:
                    pass

                return PortScanResult(
                    port=port,
                    state="open",
                    service=service,
                    banner=banner,
                    rtt_ms=rtt
                )
        except Exception:
            pass
        finally:
            sock.close()

        return None

    def scan_host(self, target_ip: str, ports: Optional[List[int]] = None, profile: str = "top-20") -> Dict[str, Any]:
        """Jalankan pemindaian port pada target host."""
        if ports is None or len(ports) == 0:
            if profile == "top-100":
                target_ports = TOP_100_PORTS
            else:
                target_ports = TOP_20_PORTS
        else:
            # Sanitasi port kustom: hanya integer 1..65535, dedupe (jaga urutan), cap maksimum.
            target_ports = self._sanitize_ports(ports)

        start_time = time.time()
        open_ports: List[PortScanResult] = []

        with ThreadPoolExecutor(max_workers=min(self.max_workers, len(target_ports))) as executor:
            future_to_port = {executor.submit(self._probe_port, target_ip, p): p for p in target_ports}
            for future in as_completed(future_to_port):
                res = future.result()
                if res:
                    open_ports.append(res)

        # Urutkan berdasarkan nomor port
        open_ports.sort(key=lambda x: x.port)
        duration = round(time.time() - start_time, 2)

        return {
            "target_ip": target_ip,
            "total_scanned": len(target_ports),
            "open_count": len(open_ports),
            "scan_duration_sec": duration,
            "profile": profile,
            "open_ports": [p.to_dict() for p in open_ports]
        }
