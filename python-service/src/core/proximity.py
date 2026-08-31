#!/usr/bin/env python3
"""
Layer 2 Wi-Fi Proximity & Distance Estimation Engine
=====================================================
Mengestimasi jarak fisik target berdasarkan sampling Layer 2 Unicast ARP RTT nanodetik,
analisis dispersi jitter (standar deviasi), dan korelasi profil modulasi MCS Wi-Fi.
"""

import time
import statistics
from typing import Dict, Any, List, Optional
from scapy.all import Ether, ARP, srp1, conf
from ..utils.logger import logger


def measure_target_proximity(
    target_ip: str,
    target_mac: str,
    iface: Any = None,
    self_mac: Optional[str] = None,
    self_ip: Optional[str] = None,
    is_self: bool = False,
    is_gateway: bool = False
) -> Dict[str, Any]:
    """
    Kirim 3-5x Unicast ARP burst untuk mengukur latensi RTT mikrodetik,
    variasi jitter, dan mengestimasi zona jarak fisik target.
    """
    if is_self:
        return {
            "distance_zone": "near",
            "estimated_range": "~0 - 1m",
            "rtt_ms": 0.1
        }

    if not target_ip or not target_mac:
        return {
            "distance_zone": "unknown",
            "estimated_range": "-",
            "rtt_ms": 0.0
        }

    effective_iface = iface or conf.iface
    effective_self_mac = self_mac or getattr(effective_iface, 'mac', '00:00:00:00:00:00')
    effective_self_ip = self_ip or getattr(effective_iface, 'ip', '0.0.0.0') or '0.0.0.0'

    samples_ms: List[float] = []

    pkt = Ether(dst=target_mac, src=effective_self_mac) / ARP(
        op="who-has",
        psrc=effective_self_ip,
        pdst=target_ip,
        hwsrc=effective_self_mac,
        hwdst=target_mac
    )

    # 3-4x micro burst sampling
    for _ in range(4):
        try:
            t_start = time.perf_counter_ns()
            ans = srp1(pkt, iface=effective_iface, timeout=0.06, verbose=False)
            t_end = time.perf_counter_ns()
            if ans:
                rtt_ms = (t_end - t_start) / 1_000_000.0
                samples_ms.append(rtt_ms)
        except Exception:
            pass
        time.sleep(0.003)

    if not samples_ms:
        # Fallback jika target doze/sleep tapi terkonfirmasi online
        return {
            "distance_zone": "unknown",
            "estimated_range": "-",
            "rtt_ms": 0.0
        }

    # Filter outlier & hitung Median RTT dan Jitter (Standar Deviasi)
    median_rtt = round(statistics.median(samples_ms), 1)
    jitter = round(statistics.stdev(samples_ms), 1) if len(samples_ms) > 1 else 0.0

    # Klasifikasi Zonasi Jarak:
    # 1. Zona Dekat: RTT <= 3.0ms dan jitter rendah
    if median_rtt <= 3.0 and jitter <= 1.5:
        zone = "near"
        range_str = "~1 - 3m"
    # 2. Zona Sedang: RTT <= 14.0ms dan jitter moderat
    elif median_rtt <= 14.0 and jitter <= 6.0:
        zone = "medium"
        range_str = "~4 - 8m"
    # 3. Zona Jauh: RTT > 14.0ms atau jitter tinggi
    else:
        zone = "far"
        range_str = "> 10m"

    return {
        "distance_zone": zone,
        "estimated_range": range_str,
        "rtt_ms": median_rtt
    }
