"""Service Container & Lifecycle Registry for NetCut Sentinel Network Engine."""

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional
from fastapi import WebSocket

from .core.scanner import NetworkScanner
from .core.spoofer import ARPSpoofer
from .core.telemetry import NetworkTelemetrySampler
from .core.redirector import RedirectManager, TransparentGatewayManager
from .core.discovery import (
    dhcp_cache,
    get_mac_from_arp,
    LivenessWatchdogDaemon,
    clear_discovery_caches,
)
from .core.network import clear_wifi_cache
from .core.interceptor import SpoorfCertEngine, L7FlowManager
from .core.bettercap import BettercapDNSEngine, BettercapPacketDissector, FastSYNScanner
from .core.shield import shield_engine
from .core.gaming import gaming_engine
from .config import settings
from .utils.logger import logger


class ConnectionManager:
    """Manages active WebSocket connections and thread-safe broadcasts."""

    def __init__(self, loop: Optional[asyncio.AbstractEventLoop] = None):
        self.active_connections: List[WebSocket] = []
        self._lock = threading.Lock()
        self.loop = loop

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        with self._lock:
            self.active_connections.append(websocket)
        logger.info(f"🔌 WebSocket client connected (Total: {len(self.active_connections)})")

    def disconnect(self, websocket: WebSocket):
        with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)
        logger.info(f"🔌 WebSocket client disconnected (Remaining: {len(self.active_connections)})")

    def _safe_send_done(self, fut: Any, conn: WebSocket):
        try:
            fut.result()
        except Exception as e:
            logger.debug(f"WS send_json failed, removing dead connection: {e}")
            self.disconnect(conn)

    def broadcast(self, message: Dict[str, Any]):
        with self._lock:
            conns = list(self.active_connections)
        loop = self.loop
        if not conns or loop is None or not loop.is_running():
            return
        for connection in conns:
            try:
                fut = asyncio.run_coroutine_threadsafe(connection.send_json(message), loop)
                fut.add_done_callback(lambda f, conn=connection: self._safe_send_done(f, conn))
            except Exception as e:
                logger.debug(f"WS broadcast notice: {e}")
                self.disconnect(connection)


class EngineContainer:
    """
    Central Service Container encapsulation for all network manipulation,
    discovery, telemetry, and security suite engines.
    """

    def __init__(
        self,
        loop: Optional[asyncio.AbstractEventLoop] = None,
        stop_event: Optional[threading.Event] = None
    ):
        self.loop = loop
        self.stop_event = stop_event or threading.Event()
        self.connection_manager = ConnectionManager(loop=loop)

        self.scanner = NetworkScanner()
        self.spoofer = ARPSpoofer()
        self.redirect_manager = RedirectManager(self.spoofer)
        self.cert_engine = SpoorfCertEngine()

        # Wiring L7 Flow & Bettercap callbacks to WebSocket broadcast
        self.flow_manager = L7FlowManager(
            on_flow_broadcast=lambda flow_dict: self.connection_manager.broadcast({
                "event": "traffic_l7_flow",
                "data": flow_dict
            })
        )

        self.bettercap_dns = BettercapDNSEngine(
            on_spoof_callback=lambda spoof_dict: self.connection_manager.broadcast({
                "event": "bettercap_dns_spoofed",
                "data": spoof_dict
            })
        )

        self.bettercap_dissector = BettercapPacketDissector(
            on_credential_callback=lambda cred_dict: self.connection_manager.broadcast({
                "event": "bettercap_credential_sniffed",
                "data": cred_dict
            })
        )

        self.bettercap_syn_scanner = FastSYNScanner()

        def on_gateway_dns_query(log_entry: Dict[str, Any]):
            self.connection_manager.broadcast({
                "event": "gateway_dns_query",
                "data": log_entry
            })
            try:
                is_sni = "SNI" in str(log_entry.get("qtype", ""))
                self.flow_manager.record_flow(
                    client_ip=log_entry.get("target_ip", ""),
                    host=log_entry.get("domain", ""),
                    scheme="https" if is_sni else "dns",
                    method="SNI" if is_sni else "QUERY",
                    port=443 if is_sni else 53,
                    is_tls=is_sni,
                    status_code=403 if log_entry.get("status") == "sinkholed" else 200,
                    is_blocked=log_entry.get("status") == "sinkholed"
                )
            except Exception as e:
                logger.debug(f"Notice recording L7 flow from DNS/SNI event: {e}")

        self.transparent_gateway = TransparentGatewayManager(
            self.spoofer,
            on_dns_query_event=on_gateway_dns_query,
            bettercap_dns=self.bettercap_dns,
            bettercap_dissector=self.bettercap_dissector
        )

        self.telemetry_sampler = NetworkTelemetrySampler()
        self.executor = ThreadPoolExecutor(max_workers=settings.MAX_WORKERS)
        self.liveness_daemon = LivenessWatchdogDaemon(
            event_callback=lambda evt: self.connection_manager.broadcast(evt)
        )
        self.shield_engine = shield_engine
        self.gaming_engine = gaming_engine

    def on_dhcp_detected(self, device_info: Dict[str, Any]):
        """Forward detected DHCP events and rogue DHCP alerts to WebSockets."""
        self.connection_manager.broadcast({
            "event": "dhcp_device_discovered",
            "data": device_info
        })
        if device_info.get("is_rogue_dhcp"):
            r_server_ip = (
                device_info.get("rogue_server_ip")
                or device_info.get("server_id")
                or device_info.get("ip")
            )
            r_server_mac = device_info.get("rogue_server_mac") or device_info.get("mac")
            self.connection_manager.broadcast({
                "event": "rogue_dhcp_detected",
                "data": {
                    "server_ip": r_server_ip,
                    "server_mac": r_server_mac,
                    "gateway_ip": device_info.get("router_ip"),
                    "message": f"Rogue DHCP Server terdeteksi pada IP {r_server_ip} (MAC: {r_server_mac})"
                }
            })

    def run_watchdog_loop(self):
        """
        Background telemetry streamer & network shift watchdog.
        Menggunakan stop_event.wait(1.0) sehingga proses shutdown deterministik tanpa delay/zombie.
        """
        last_gateway = ""
        last_interface = ""
        last_gateway_mac = ""
        try:
            info = self.scanner.get_network_info()
            last_interface = info.get("interface", "")
            last_gateway = self.scanner.get_current_gateway()
            last_gateway_mac = get_mac_from_arp(last_gateway) if last_gateway else ""
        except Exception:
            pass

        logger.info("🐕 Network Telemetry Streamer started (streaming 1s)...")
        check_cycle = 0

        while not self.stop_event.is_set():
            if self.stop_event.wait(1.0):
                break
            check_cycle += 1

            # Broadcast live telemetry stream setiap 1 detik
            try:
                current_telemetry = self.telemetry_sampler.sample()
                self.connection_manager.broadcast({
                    "event": "telemetry",
                    "data": current_telemetry
                })
            except Exception:
                pass

            # Periksa pergantian gateway / interface setiap 10 detik
            if check_cycle >= 10:
                check_cycle = 0
                try:
                    if self.scanner.is_network_changed(last_gateway, last_interface, last_gateway_mac):
                        logger.warning("🔥 Watchdog detected network change! Refreshing spoofer & halting stale sessions...")
                        try:
                            self.shield_engine.disable()
                        except Exception as e:
                            logger.debug(f"Watchdog shield disable notice: {e}")
                        self.spoofer.stop_all()
                        self.redirect_manager.stop_all()
                        self.transparent_gateway.stop_all()
                        self.spoofer.refresh_interface()
                        dhcp_cache.clear()
                        self.scanner.clear_history()
                        clear_wifi_cache()
                        clear_discovery_caches()
                        try:
                            info = self.scanner.get_network_info()
                            last_interface = info.get("interface", "")
                            last_gateway = self.scanner.get_current_gateway()
                            last_gateway_mac = get_mac_from_arp(last_gateway) if last_gateway else ""
                        except Exception:
                            pass

                        self.connection_manager.broadcast({
                            "event": "network_changed",
                            "success": False,
                            "error": "NETWORK_CHANGED",
                            "message": f"Gateway changed to {last_gateway}",
                            "data": {
                                "new_gateway": last_gateway,
                                "new_interface": last_interface,
                                "new_gateway_mac": last_gateway_mac
                            }
                        })
                except Exception as e:
                    logger.debug(f"Watchdog notice: {e}")

    def teardown(self):
        """
        Deterministic 8-stage shutdown sequence in exact order verified by test_api_server:
        1. Shield
        2. Gaming
        3. liveness watchdog
        4. DHCP sniffer
        5. redirect manager
        6. transparent gateway
        7. ARP spoofer
        8. executor
        """
        cleanup_stages = (
            ("Shield", self.shield_engine.disable),
            ("Gaming", lambda: self.gaming_engine.toggle(False)),
            ("liveness watchdog", self.liveness_daemon.stop),
            ("DHCP sniffer", NetworkScanner.stop_dhcp_sniffer),
            ("redirect manager", self.redirect_manager.stop_all),
            ("transparent gateway", self.transparent_gateway.stop_all),
            ("ARP spoofer", self.spoofer.stop_all),
            ("executor", lambda: self.executor.shutdown(wait=False)),
        )
        failures = []
        for stage_name, cleanup in cleanup_stages:
            try:
                cleanup()
            except Exception as error:
                logger.error(
                    f"Shutdown cleanup failed for {stage_name}: {error}",
                    exc_info=True,
                    extra={"stage": stage_name}
                )
                failures.append((stage_name, error))

        if failures:
            details = "; ".join(f"{stage_name}: {error}" for stage_name, error in failures)
            logger.error(
                f"Shutdown cleanup completed with failures: {details}",
                extra={"failed_stages": [s for s, _ in failures]}
            )


_DEFAULT_CONTAINER: Optional[EngineContainer] = None
_DEFAULT_LOCK = threading.Lock()


def get_default_container() -> EngineContainer:
    """Lazy-singleton default container untuk fallback direct unit tests."""
    global _DEFAULT_CONTAINER
    if _DEFAULT_CONTAINER is None:
        with _DEFAULT_LOCK:
            if _DEFAULT_CONTAINER is None:
                _DEFAULT_CONTAINER = EngineContainer()
    return _DEFAULT_CONTAINER
