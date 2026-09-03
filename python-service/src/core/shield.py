"""
Sentinel Shield - Anti-ARP Spoofing & Threat Detection Engine
=============================================================
Menyediakan perlindungan tingkat kernel terhadap serangan Layer 2 (ARP Poisoning/NetCut):
1. Host Immunity: Mengunci entri ARP Gateway di kernel Windows menjadi Permanent (Statis).
2. Threat Radar (IDS): Mendeteksi frame ARP palsu yang mencoba meracuni Gateway.
3. LAN Auto-Healing: Menyuntikkan paket pemulih Gratuitous ARP secara berkala untuk target LAN.
"""

import time
import threading
import sys
import subprocess
import collections
from typing import Dict, Any, List, Optional, Callable
from scapy.all import Ether, ARP, sniff, sendp, conf
from .network import get_current_gateway, get_network_info, get_self_mac, is_valid_mac, is_valid_private_ip
from ..exceptions.custom import SpoofError
from ..utils.logger import logger


_WORKER_JOIN_TIMEOUT_SECONDS = 2.0


class SentinelShield:
    def __init__(self, event_callback: Optional[Callable[[Dict[str, Any]], None]] = None):
        self._lock = threading.Lock()
        self._is_enabled = False
        self._mode = "host_lock"  # "host_lock" | "lan_healing" | "reflect_counter"
        self._auto_retaliate = False
        self._gateway_ip = ""
        self._gateway_mac = ""
        self._interface_name = ""
        self._win_alias = "Wi-Fi"
        self._self_mac = ""
        self._locked_at: Optional[str] = None
        self._event_callback = event_callback
        
        self._threats: collections.deque = collections.deque(maxlen=100)
        self._sniffer_stop_event = threading.Event()
        self._sniffer_thread: Optional[threading.Thread] = None
        self._heartbeat_stop_event = threading.Event()
        self._heartbeat_thread: Optional[threading.Thread] = None
        self._healing_stop_event = threading.Event()
        self._healing_thread: Optional[threading.Thread] = None
        self._healing_targets: List[Dict[str, str]] = []

    def set_event_callback(self, callback: Callable[[Dict[str, Any]], None]):
        self._event_callback = callback

    def _resolve_gateway_mac(self, gw_ip: str) -> str:
        """Cari MAC address fisik asli dari gateway router."""
        # KEAMANAN (P1): validasi sebelum interpolasi ke PowerShell.
        if not is_valid_private_ip(gw_ip):
            return ""
        try:
            if sys.platform == 'win32':
                ps_script = f"Get-NetNeighbor -IPAddress '{gw_ip}' | Select-Object -ExpandProperty LinkLayerAddress"
                out = subprocess.check_output(
                    ["powershell", "-NoProfile", "-Command", ps_script],
                    text=True,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
                ).strip()
                if out:
                    norm = out.split()[0].replace('-', ':').lower()
                    if is_valid_mac(norm) and norm != "00:00:00:00:00:00":
                        return norm
        except Exception as e:
            logger.debug(f"Notice resolving gateway MAC from Get-NetNeighbor: {e}")

        try:
            from .discovery.arp import scan_arp
            res = scan_arp(f"{gw_ip}/32", timeout=0.8)
            for d in res:
                if d.get('ip') == gw_ip and is_valid_mac(d.get('mac')):
                    return d['mac'].lower().replace('-', ':')
        except Exception:
            pass

        return ""

    def _lock_kernel_neighbor(self, gw_ip: str, gw_mac: str, iface_alias: str) -> bool:
        """Kunci entri gateway di kernel Windows menjadi Permanent/Static."""
        if sys.platform != 'win32':
            return True

        # KEAMANAN (P1): tolak input gateway tak valid sebelum menyentuh OS.
        if not is_valid_private_ip(gw_ip) or not is_valid_mac(gw_mac):
            logger.debug("Notice: gw_ip/gw_mac invalid — lewati kernel neighbor lock")
            return False

        norm_mac_dash = gw_mac.replace(':', '-').upper()
        norm_mac_colon = gw_mac.replace('-', ':').lower()
        alias_ps = iface_alias.replace("'", "''")  # escape utk string PowerShell

        success = False
        try:
            # KEAMANAN (P1): arg-list + input tervalidasi (tanpa shell=True).
            ps_script = (
                f"Set-NetNeighbor -InterfaceAlias '{alias_ps}' -IPAddress '{gw_ip}' -LinkLayerAddress '{norm_mac_dash}' -State Permanent -ErrorAction SilentlyContinue; "
                f"if (!$?) {{ New-NetNeighbor -InterfaceAlias '{alias_ps}' -IPAddress '{gw_ip}' -LinkLayerAddress '{norm_mac_dash}' -State Permanent -ErrorAction SilentlyContinue }}; "
                f"if ($?) {{ exit 0 }} else {{ exit 1 }}"
            )
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_script],
                shell=False, timeout=4, capture_output=True,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            success = result.returncode == 0
        except Exception as e:
            logger.debug(f"Set-NetNeighbor notice: {e}")

        try:
            result = subprocess.run(
                ["netsh", "interface", "ipv4", "set", "neighbors", iface_alias, gw_ip, norm_mac_colon],
                shell=False, timeout=3, capture_output=True,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            success = success or result.returncode == 0
        except Exception as e:
            logger.debug(f"netsh set neighbors notice: {e}")

        return success

    @staticmethod
    def _join_workers(workers: List[Optional[threading.Thread]]) -> None:
        current = threading.current_thread()
        for worker in workers:
            if worker and worker is not current and worker.is_alive():
                worker.join(timeout=_WORKER_JOIN_TIMEOUT_SECONDS)

    @staticmethod
    def _workers_stopped(workers: List[Optional[threading.Thread]]) -> bool:
        return all(not worker or not worker.is_alive() for worker in workers)

    def _unlock_kernel_neighbor(self, gw_ip: str, iface_alias: str) -> bool:
        """Kembalikan entri gateway di kernel Windows menjadi Dynamic/Unreachable."""
        if sys.platform != 'win32':
            return True

        # KEAMANAN (P1): tolak input gateway tak valid sebelum menyentuh OS.
        if not is_valid_private_ip(gw_ip):
            return False

        alias_ps = iface_alias.replace("'", "''")  # escape utk string PowerShell

        try:
            ps_script = f"Remove-NetNeighbor -InterfaceAlias '{alias_ps}' -IPAddress '{gw_ip}' -Confirm:$false -ErrorAction SilentlyContinue"
            subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_script],
                shell=False, timeout=3, capture_output=True,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
        except Exception:
            pass

        try:
            subprocess.run(
                ["netsh", "interface", "ipv4", "delete", "neighbors", iface_alias, gw_ip],
                shell=False, timeout=3, capture_output=True,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
        except Exception:
            pass

        return True

    def _threat_sniffer_loop(self):
        """Thread passive sniffer mendeteksi paket ARP racun di udara."""
        logger.info("🛡️ [Sentinel Shield] ARP Threat Sniffer aktif...")
        gw_ip = self._gateway_ip
        gw_mac = self._gateway_mac.lower().replace('-', ':')
        self_mac = self._self_mac.lower().replace('-', ':')

        def _arp_filter(pkt):
            if not pkt.haslayer(ARP):
                return False
            arp = pkt[ARP]
            if arp.op in (1, 2) and arp.psrc == gw_ip:
                hwsrc = arp.hwsrc.lower().replace('-', ':')
                if hwsrc != gw_mac and hwsrc != self_mac:
                    return True
            return False

        def _process_packet(pkt):
            if self._sniffer_stop_event.is_set():
                return
            arp = pkt[ARP]
            attacker_mac = arp.hwsrc.lower().replace('-', ':')
            target_ip = arp.pdst
            
            threat = {
                "id": f"threat_{int(time.time()*1000)}",
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "attacker_ip": getattr(pkt.getlayer(Ether), 'src', '') or arp.psrc,
                "attacker_mac": attacker_mac,
                "target_ip": target_ip,
                "claimed_ip": arp.psrc,
                "type": "gateway_arp_spoof",
                "action_taken": "mitigated_by_shield",
                "details": f"Perangkat MAC {attacker_mac} mencoba memalsukan Gateway {gw_ip}"
            }

            with self._lock:
                now_ts = time.time()
                recent_threat = next((t for t in reversed(self._threats) if t.get('attacker_mac') == attacker_mac), None)
                if not recent_threat or (now_ts - getattr(self, '_last_threat_ts', 0) > 3.0):
                    self._threats.append(threat)
                    self._last_threat_ts = now_ts
                    logger.warning(f"🚨 [SENTINEL SHIELD ALERT] Serangan ARP Spoofing terdeteksi dari MAC: {attacker_mac}!")
                    
                    if self._event_callback:
                        try:
                            self._event_callback({
                                "event": "arp_threat_detected",
                                "data": threat
                            })
                        except Exception as cb_err:
                            logger.debug(f"Threat callback error: {cb_err}")

        while not self._sniffer_stop_event.is_set():
            try:
                sniff(
                    filter="arp",
                    prn=_process_packet,
                    lfilter=_arp_filter,
                    timeout=1.5,
                    store=False
                )
            except Exception as e:
                if not self._sniffer_stop_event.is_set():
                    time.sleep(1.0)

    def _heartbeat_loop(self):
        """Kirim clean ARP query berkala ke router agar router tidak pernah meracuni entri host ini."""
        gw_ip = self._gateway_ip
        gw_mac = self._gateway_mac
        self_mac = self._self_mac
        info = get_network_info()
        my_ip = info.get('ip', '')

        while not self._heartbeat_stop_event.is_set():
            try:
                if my_ip and gw_ip and gw_mac and self_mac:
                    pkt = Ether(dst=gw_mac, src=self_mac) / ARP(
                        op=1,
                        hwsrc=self_mac,
                        psrc=my_ip,
                        hwdst=gw_mac,
                        pdst=gw_ip
                    )
                    sendp(pkt, verbose=False)
            except Exception:
                pass

            if self._heartbeat_stop_event.wait(3.5):
                break

    def _lan_healer_loop(self):
        """Vaksinasi/Penyembuhan Jaringan: kirim Gratuitous ARP broadcast pemulih secara berkala."""
        gw_ip = self._gateway_ip
        gw_mac = self._gateway_mac

        while not self._healing_stop_event.is_set():
            try:
                if gw_ip and gw_mac:
                    garp_pkt = Ether(dst="ff:ff:ff:ff:ff:ff", src=gw_mac) / ARP(
                        op=2,
                        hwsrc=gw_mac,
                        psrc=gw_ip,
                        hwdst="ff:ff:ff:ff:ff:ff",
                        pdst=gw_ip
                    )
                    sendp(garp_pkt, verbose=False)
            except Exception:
                pass

            if self._healing_stop_event.wait(1.5):
                break

    def enable(self, mode: str = "host_lock", auto_retaliate: bool = False, lan_targets: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
        """Aktifkan Sentinel Shield."""
        with self._lock:
            if self._is_enabled:
                self._mode = mode
                self._auto_retaliate = auto_retaliate
                return self.get_status()

            prior_workers = [
                self._sniffer_thread,
                self._heartbeat_thread,
                self._healing_thread,
            ]
            self._sniffer_stop_event.set()
            self._heartbeat_stop_event.set()
            self._healing_stop_event.set()

        self._join_workers(prior_workers)
        if not self._workers_stopped(prior_workers):
            raise SpoofError("Worker Sentinel Shield sebelumnya belum berhenti")

        info = get_network_info()
        gw_ip = get_current_gateway()
        if not is_valid_private_ip(gw_ip):
            raise SpoofError("Gateway private tidak dapat divalidasi")

        gw_mac = self._resolve_gateway_mac(gw_ip)
        if not is_valid_mac(gw_mac) or gw_mac == "00:00:00:00:00:00":
            raise SpoofError(f"MAC gateway untuk {gw_ip} tidak dapat divalidasi")

        self_mac = get_self_mac()
        win_alias = "Wi-Fi"
        if not self._lock_kernel_neighbor(gw_ip, gw_mac, win_alias):
            raise SpoofError(f"Gagal mengunci neighbor gateway {gw_ip}")

        sniffer_thread = threading.Thread(
            target=self._threat_sniffer_loop,
            daemon=True,
            name="shield-threat-sniffer"
        )
        heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop,
            daemon=True,
            name="shield-clean-heartbeat"
        )
        healing_thread = None
        if mode == "lan_healing":
            healing_thread = threading.Thread(
                target=self._lan_healer_loop,
                daemon=True,
                name="shield-lan-healer"
            )

        with self._lock:
            self._gateway_ip = gw_ip
            self._gateway_mac = gw_mac
            self._interface_name = info.get('interface', '')
            self._self_mac = self_mac
            self._win_alias = win_alias
            self._mode = mode
            self._auto_retaliate = auto_retaliate
            self._healing_targets = lan_targets or []
            self._is_enabled = True
            self._locked_at = time.strftime("%Y-%m-%d %H:%M:%S")
            self._sniffer_stop_event.clear()
            self._heartbeat_stop_event.clear()
            if healing_thread:
                self._healing_stop_event.clear()
            self._sniffer_thread = sniffer_thread
            self._heartbeat_thread = heartbeat_thread
            self._healing_thread = healing_thread

        sniffer_thread.start()
        heartbeat_thread.start()
        if healing_thread:
            healing_thread.start()

        logger.info(f"🛡️ [Sentinel Shield AKTIF] Gateway {gw_ip} ({gw_mac}) berhasil dikunci permanen di interface '{win_alias}'. Mode: {mode}")
        status = self.get_status()
        if self._event_callback:
            try:
                self._event_callback({
                    "event": "shield_status_changed",
                    "data": status
                })
            except Exception:
                pass

        return status

    def disable(self) -> Dict[str, Any]:
        """Nonaktifkan Sentinel Shield dan pulihkan state dynamic."""
        with self._lock:
            was_enabled = self._is_enabled
            gw_ip = self._gateway_ip
            win_alias = self._win_alias
            self._sniffer_stop_event.set()
            self._heartbeat_stop_event.set()
            self._healing_stop_event.set()
            workers = [
                self._sniffer_thread,
                self._heartbeat_thread,
                self._healing_thread,
            ]
            self._is_enabled = False
            self._locked_at = None

        if was_enabled and gw_ip:
            self._unlock_kernel_neighbor(gw_ip, win_alias)

        self._join_workers(workers)

        with self._lock:
            if self._workers_stopped(workers):
                self._sniffer_thread = None
                self._heartbeat_thread = None
                self._healing_thread = None

        status = self.get_status()
        if was_enabled:
            logger.info("🛡️ [Sentinel Shield NONAKTIF] Gateway neighbor dikembalikan ke mode dinamis.")

            if self._event_callback:
                try:
                    self._event_callback({
                        "event": "shield_status_changed",
                        "data": status
                    })
                except Exception:
                    pass

        return status

    def set_mode(self, mode: str, auto_retaliate: bool = False) -> Dict[str, Any]:
        """Ubah mode pertahanan shield."""
        worker_to_stop = None
        start_healer = False
        with self._lock:
            self._mode = mode
            self._auto_retaliate = auto_retaliate
            
            if self._is_enabled:
                if mode == "lan_healing" and (not self._healing_thread or not self._healing_thread.is_alive()):
                    worker_to_stop = self._healing_thread
                    self._healing_stop_event.set()
                    start_healer = True
                elif mode != "lan_healing" and self._healing_thread and self._healing_thread.is_alive():
                    self._healing_stop_event.set()
                    worker_to_stop = self._healing_thread

        self._join_workers([worker_to_stop])
        if worker_to_stop and worker_to_stop.is_alive():
            raise SpoofError("Worker LAN healing sebelumnya belum berhenti")

        healer_thread = None
        if start_healer:
            healer_thread = threading.Thread(
                target=self._lan_healer_loop,
                daemon=True,
                name="shield-lan-healer"
            )
            with self._lock:
                self._healing_stop_event.clear()
                self._healing_thread = healer_thread
            healer_thread.start()
        elif worker_to_stop:
            with self._lock:
                if self._healing_thread is worker_to_stop:
                    self._healing_thread = None

        return self.get_status()

    def get_status(self) -> Dict[str, Any]:
        """Dapatkan status lengkap Sentinel Shield."""
        return {
            "is_enabled": self._is_enabled,
            "mode": self._mode,
            "auto_retaliate": self._auto_retaliate,
            "gateway_ip": self._gateway_ip or get_current_gateway(),
            "gateway_mac": self._gateway_mac,
            "win_alias": self._win_alias,
            "locked_at": self._locked_at,
            "threats_count": len(self._threats),
            "latest_threat": self._threats[-1] if self._threats else None
        }

    def get_threats(self) -> List[Dict[str, Any]]:
        """Dapatkan seluruh riwayat serangan yang terdeteksi."""
        return list(self._threats)

    def clear_threats(self) -> bool:
        """Bersihkan riwayat serangan."""
        with self._lock:
            self._threats.clear()
        return True

# Singleton Instance
shield_engine = SentinelShield()
