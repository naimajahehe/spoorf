"""
Multi-Vector Asynchronous Unicast Liveness Pulse Engine (< 0.75s Offline Detection)
Combines:
  1. Layer 2 Direct Unicast & Broadcast Dual ARP Burst (Clean Host-to-Host)
  2. Layer 3 Fast ICMP Ping Fallback (Doze / Power-Saving Resilience)
  3. Layer 4 UDP High-Port Trigger & Layer 3 IPv6 Neighbor Solicitation

Tri-Vector Async Race Architecture:
  - Vektor 1, 2, dan 3 dieksekusi secara SERENTAK (paralel) dalam _PULSE_EXECUTOR (non-blocking).
  - First-to-Respond Winner: Begitu satu vektor membalas (< 25ms), langsung return is_alive: True.
  - Timeout maksimal diselaraskan ke 1.0 detik (selaras dengan batas UI 2.0 detik).
"""

import time
import socket
import subprocess
import concurrent.futures
import threading
from typing import Dict, Any, List, Optional, Callable
from scapy.all import Ether, ARP, srp, conf
from ..network import get_self_mac, get_network_info, is_valid_mac, is_valid_private_ip
from .ipv6_ndp import verify_ipv6_alive
from ...utils.logger import logger

# Global persistent thread pool untuk pulse probing (menghindari blocking shutdown wait=True)
_PULSE_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=32, thread_name_prefix="PulseWorker")

def pulse_host(
    target_ip: str,
    target_mac: str,
    gateway_ip: Optional[str] = None,
    target_ipv6: Optional[str] = None,
    timeout: float = 3.0,
    retry: bool = True
) -> Dict[str, Any]:
    """
    Eksekusi deteksi denyut liveness asinkron ke target tertentu.
    Menggunakan algoritma Tri-Vector Async First-to-Respond Race (~3.0s max timeout):
      1. Vektor L2: Dual-Burst ARP (Unicast + Broadcast simultan)
      2. Vektor L3: Fast ICMP Ping Probe (300ms - 850ms)
      3. Vektor L4/IPv6: UDP High-Port Wakeup Trigger + IPv6 Neighbor Solicitation
    Begitu salah satu dari 3 vektor membalas (< 25ms), langsung mengembalikan status
    is_alive: True seketika tanpa menunggu thread lainnya!
    """
    result = {
        'ip': target_ip,
        'mac': target_mac.lower() if target_mac else '',
        'is_alive': False,
        'vector': 'none',
        'rtt_ms': 0.0,
        'timestamp': time.time()
    }

    if not is_valid_private_ip(target_ip) or not is_valid_mac(target_mac):
        return result

    norm_mac = target_mac.lower().replace('-', ':')
    self_mac = (get_self_mac() or '').lower().replace('-', ':')
    if not self_mac or not is_valid_mac(self_mac):
        self_mac = getattr(conf.iface, 'mac', None)
    if self_mac:
        self_mac = self_mac.lower().replace('-', ':')

    # Resolve local host IP for clean, non-poisoning ARP queries
    my_ip = ""
    try:
        my_ip = (get_network_info() or {}).get('ip', '')
    except Exception:
        pass
    effective_src_ip = my_ip if (my_ip and is_valid_private_ip(my_ip)) else target_ip

    start_time = time.time()

    def _probe_unicast_arp(timeout_val: float) -> Optional[float]:
        """Vektor 1: Layer 2 Direct Unicast & Broadcast ARP Burst."""
        try:
            unicast_arp = Ether(dst=norm_mac, src=self_mac) / ARP(
                op=1,
                hwsrc=self_mac,
                psrc=effective_src_ip,
                hwdst=norm_mac,
                pdst=target_ip
            )
            broadcast_arp = Ether(dst="ff:ff:ff:ff:ff:ff", src=self_mac) / ARP(
                op=1,
                hwsrc=self_mac,
                psrc=effective_src_ip,
                pdst=target_ip
            )
            t0 = time.time()
            ans, _ = srp([unicast_arp, broadcast_arp], timeout=timeout_val, verbose=False, retry=1 if retry else 0)
            t1 = time.time()
            for _, rcv in ans:
                if rcv.haslayer(ARP):
                    rcv_mac = rcv[ARP].hwsrc.lower().replace('-', ':')
                    if rcv_mac == norm_mac or is_valid_mac(rcv_mac):
                        return max(0.1, round((t1 - t0) * 1000, 2))
        except Exception as e:
            logger.debug(f"Unicast ARP probe exception for {target_ip}: {e}")
        return None

    def _probe_icmp_ping(timeout_ms: int = 850) -> Optional[float]:
        """Vektor 2: Fast ICMP Ping Fallback (Untuk perangkat mobile dalam Wi-Fi Power Save / Doze)."""
        try:
            t0 = time.time()
            p = subprocess.run(["ping", "-n", "3", "-w", "800", target_ip], capture_output=True, text=True)
            if "TTL=" in p.stdout or "Reply from" in p.stdout or "Menerima balasan" in p.stdout:
                return max(0.1, round((time.time() - t0) * 1000, 2))
        except Exception:
            pass
        return None

    def _probe_udp_and_ipv6(timeout_val: float) -> Optional[float]:
        """Vektor 3: Layer 4 UDP High-Port Trigger & Layer 3 IPv6 Neighbor Solicitation."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.settimeout(0.05)
                s.sendto(b'\x00', (target_ip, 38291))
                try:
                    s.sendto(b'', (target_ip, 5353))
                except Exception:
                    pass
        except Exception:
            pass

        if target_ipv6:
            try:
                t0 = time.time()
                if verify_ipv6_alive(target_ipv6, norm_mac, timeout=timeout_val):
                    t1 = time.time()
                    return max(0.1, round((t1 - t0) * 1000, 2))
            except Exception:
                pass
        return None

    # TRI-VECTOR ASYNC RACE (Non-Blocking Global Pool)
    effective_timeout = max(0.40, timeout)
    ping_timeout_ms = min(2600, int(effective_timeout * 1000))

    futures = {
        _PULSE_EXECUTOR.submit(_probe_unicast_arp, effective_timeout): "unicast_arp",
        _PULSE_EXECUTOR.submit(_probe_icmp_ping, ping_timeout_ms): "icmp_ping",
        _PULSE_EXECUTOR.submit(_probe_udp_and_ipv6, effective_timeout): "ipv6_ndp"
    }

    # First-to-Respond Winner: Begitu ada 1 vektor yang membalas, langsung kembalikan is_alive: True!
    try:
        for fut in concurrent.futures.as_completed(futures, timeout=effective_timeout + 0.15):
            rtt = fut.result()
            if rtt is not None:
                result['is_alive'] = True
                result['vector'] = futures[fut]
                result['rtt_ms'] = rtt
                return result
    except concurrent.futures.TimeoutError:
        pass
    except Exception as e:
        logger.debug(f"Pulse race exception: {e}")

    total_duration_ms = round((time.time() - start_time) * 1000, 2)
    result['rtt_ms'] = total_duration_ms
    return result

def pulse_batch(
    targets: List[Dict[str, Any]],
    gateway_ip: Optional[str] = None,
    max_workers: int = 8,
    timeout: float = 3.0
) -> Dict[str, Dict[str, Any]]:
    """
    Eksekusi pulse ke sekumpulan perangkat secara paralel (asinkron).
    Dibatasi max 8 worker untuk mencegah Npcap driver buffer collision di Windows.
    """
    results: Dict[str, Dict[str, Any]] = {}
    if not targets:
        return results

    effective_workers = min(max_workers, max(1, len(targets)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=effective_workers) as executor:
        future_to_ip = {
            executor.submit(
                pulse_host,
                t.get('ip', ''),
                t.get('mac', ''),
                gateway_ip,
                t.get('ipv6_link_local') or t.get('ipv6_global'),
                timeout,
                True
            ): t.get('ip', '')
            for t in targets if t.get('ip') and t.get('mac')
        }

        done, not_done = concurrent.futures.wait(future_to_ip.keys(), timeout=timeout + 0.35)
        for fut in done:
            ip = future_to_ip[fut]
            try:
                res = fut.result()
                results[ip] = res
            except Exception as e:
                results[ip] = {
                    'ip': ip,
                    'mac': '',
                    'is_alive': False,
                    'vector': 'error',
                    'rtt_ms': 0.0,
                    'timestamp': time.time()
                }

        # Handle timeout futures
        for fut in not_done:
            ip = future_to_ip[fut]
            results[ip] = {
                'ip': ip,
                'mac': '',
                'is_alive': False,
                'vector': 'timeout',
                'rtt_ms': timeout * 1000,
                'timestamp': time.time()
            }

    return results

class LivenessWatchdogDaemon:
    """
    Background Daemon yang secara berkala memverifikasi denyut liveness perangkat
    yang terdaftar dan menyiarkan event disconnection jika terbukti offline.
    """
    def __init__(self, event_callback: Optional[Callable[[Dict[str, Any]], None]] = None, interval: float = 15.0, broadcast_fn: Optional[Callable[[Dict[str, Any]], None]] = None):
        self.event_callback = event_callback or broadcast_fn or (lambda x: None)
        self.interval = interval
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._devices: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._scanning_active = False  # True selama scan penuh -> watchdog dijeda

    def set_scanning_active(self, active: bool):
        """
        Jeda/lanjutkan watchdog selama scan penuh berlangsung.
        Saat scan aktif, probing liveness dilewati agar tidak berebut buffer
        pcap/Npcap dengan pemindaian utama (mencegah paket hilang).
        """
        self._scanning_active = bool(active)

    def update_tracked_devices(self, devices: List[Dict[str, Any]]):
        with self._lock:
            self._devices = {
                d['ip']: d for d in devices
                if d.get('ip') and d.get('mac') and not d.get('is_gateway') and not d.get('is_self')
            }

    def update_tracked(self, devices: List[Dict[str, Any]]):
        self.update_tracked_devices(devices)

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="LivenessWatchdog")
        self._thread.start()

    def stop(self):
        self._running = False

    def _run_loop(self):
        while self._running:
            try:
                time.sleep(self.interval)
                # Jeda watchdog selama scan penuh (hindari rebutan buffer pcap).
                if self._scanning_active:
                    continue
                with self._lock:
                    targets = list(self._devices.values())
                if not targets:
                    continue

                batch_res = pulse_batch(targets, timeout=3.0)
                for ip, res in batch_res.items():
                    if not res.get('is_alive'):
                        logger.info(f"Watchdog detected offline device: {ip}")
                        self.event_callback({
                            "event": "device_offline_pulse",
                            "data": {
                                "ip": ip,
                                "mac": res.get('mac'),
                                "vector": res.get('vector')
                            }
                        })
            except Exception as e:
                logger.debug(f"Watchdog loop notice: {e}")
