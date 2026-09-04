#!/usr/bin/env python3
"""
NetCut Sentinel FastAPI Server & WebSocket Event Hub
====================================================
FastAPI microservice menyediakan REST API dan WebSocket stream
untuk orkestrator L2 network discovery, ARP spoofing, dan live telemetry.
"""

import os
import time
import socket
import logging
import asyncio
import ipaddress
import threading
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from pydantic import BaseModel

from .core.scanner import NetworkScanner
from .core.spoofer import ARPSpoofer
from .exceptions.custom import SessionNotFoundError
from .core.telemetry import NetworkTelemetrySampler
from .core.redirector import RedirectManager, TransparentGatewayManager
from .core.discovery import (
    dhcp_cache,
    send_multicast_wakeup,
    pulse_batch,
    pulse_host,
    LivenessWatchdogDaemon,
)
from .core.discovery.dhcp import diff_dhcp_profiles
from .core.network import (
    clear_wifi_cache,
    get_current_gateway,
    get_network_info,
    get_self_mac,
    is_valid_private_ip,
    is_valid_private_network,
)
from .core.interceptor import SpoorfCertEngine, L7FlowManager, L7Flow
from .core.bettercap import BettercapDNSEngine, BettercapPacketDissector, FastSYNScanner
from .core.shield import shield_engine
from .core.gaming import gaming_engine
from .core.diagnostics import run_system_diagnostics, check_npcap_driver
from .utils.logger import logger
import warnings
# Redam peringatan kompatibilitas internal Scapy & Cryptography (TripleDES deprecation warning)
warnings.filterwarnings("ignore", category=DeprecationWarning, module="scapy")
try:
    from cryptography.utils import CryptographyDeprecationWarning
    warnings.filterwarnings("ignore", category=CryptographyDeprecationWarning)
except Exception:
    pass

# Redam peringatan internal Scapy saat probing IP offline (Broadcast fallback warning)
logging.getLogger("scapy.runtime").setLevel(logging.ERROR)

app = FastAPI(
    title="NetCut Sentinel Network Engine",
    description="Modular High-Performance Layer 2 Network Discovery, ARP Spoofing, L7 Interception & Bettercap Security Suite Engine",
    version="2.3.0"
)


def _filter_dhcp_observation_snapshot(
    snapshot: Dict[str, Dict[str, Any]],
    controller_ip: str,
    gateway_ip: str,
    controller_mac: str,
) -> Dict[str, Dict[str, Any]]:
    """Exclude controller and gateway infrastructure from target profile metrics."""
    normalized_self_mac = controller_mac.lower().replace('-', ':')
    excluded_ips = {controller_ip, gateway_ip}
    return {
        mac: entry
        for mac, entry in snapshot.items()
        if mac.lower().replace('-', ':') != normalized_self_mac
        and str(entry.get('ip') or '').strip() not in excluded_ips
    }

# CORS terkunci: engine hanya dipanggil Node (server-to-server, tidak terikat CORS).
# Browser TIDAK boleh memanggil engine langsung -> menutup drive-by ARP spoofing dari website.
# Set PY_CORS_ORIGINS (comma-separated) hanya bila memang perlu akses lintas-origin dari browser.
_py_cors_env = os.getenv("PY_CORS_ORIGINS", "").strip()
_py_cors_origins = [o.strip() for o in _py_cors_env.split(",") if o.strip()] if _py_cors_env else []
app.add_middleware(
    CORSMiddleware,
    allow_origins=_py_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# KEAMANAN (P1): Token bearer lokal opsional. Meski engine bind loopback (:8001),
# tanpa auth setiap proses lokal bisa memicu ARP spoof/DNS spoof. Bila env
# SENTINEL_API_TOKEN diset (disuntik Electron & diteruskan Node), wajibkan header
# `x-sentinel-token`. Nonaktif otomatis bila token tak diset (kompatibel dev).
_PUBLIC_PATHS = {"/health"}

@app.middleware("http")
async def api_token_guard(request: Request, call_next):
    expected = os.getenv("SENTINEL_API_TOKEN")
    if expected:
        if request.url.path not in _PUBLIC_PATHS and request.method != "OPTIONS":
            provided = request.headers.get("x-sentinel-token")
            if provided != expected:
                return JSONResponse(
                    status_code=401,
                    content={"success": False, "error": "Unauthorized: missing or invalid API token."}
                )
    return await call_next(request)

# KEAMANAN (P2): Sanitasi respons error. Detail 5xx (mis. `detail=str(e)`) berpotensi
# membocorkan internal → di-log penuh di server, tapi klien hanya menerima pesan generik.
# Pesan 4xx (validasi, mis. RFC1918) dipertahankan karena bersifat operasional.
@app.exception_handler(StarletteHTTPException)
async def sanitized_http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code >= 500:
        logger.error(f"[API {exc.status_code}] {request.method} {request.url.path}: {exc.detail}")
        return JSONResponse(status_code=exc.status_code, content={"success": False, "error": "Internal server error"})
    return JSONResponse(status_code=exc.status_code, content={"success": False, "error": exc.detail})

scanner = NetworkScanner()
spoofer = ARPSpoofer()
redirect_manager = RedirectManager(spoofer)
cert_engine = SpoorfCertEngine()

def on_l7_flow_event(flow_dict: Dict[str, Any]):
    manager.broadcast({
        "event": "traffic_l7_flow",
        "data": flow_dict
    })

flow_manager = L7FlowManager(on_flow_broadcast=on_l7_flow_event)

def on_bettercap_dns_spoofed(spoof_dict: Dict[str, Any]):
    manager.broadcast({
        "event": "bettercap_dns_spoofed",
        "data": spoof_dict
    })

def on_bettercap_credential_sniffed(cred_dict: Dict[str, Any]):
    manager.broadcast({
        "event": "bettercap_credential_sniffed",
        "data": cred_dict
    })

bettercap_dns = BettercapDNSEngine(on_spoof_callback=on_bettercap_dns_spoofed)
bettercap_dissector = BettercapPacketDissector(on_credential_callback=on_bettercap_credential_sniffed)
bettercap_syn_scanner = FastSYNScanner()

def on_gateway_dns_query_event(log_entry: Dict[str, Any]):
    manager.broadcast({
        "event": "gateway_dns_query",
        "data": log_entry
    })
    try:
        is_sni = "SNI" in str(log_entry.get("qtype", ""))
        flow_manager.record_flow(
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

transparent_gateway = TransparentGatewayManager(
    spoofer,
    on_dns_query_event=on_gateway_dns_query_event,
    bettercap_dns=bettercap_dns,
    bettercap_dissector=bettercap_dissector
)
telemetry_sampler = NetworkTelemetrySampler()
executor = ThreadPoolExecutor(max_workers=5)

# ===== WEBSOCKET CONNECTION MANAGER =====
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self._lock = threading.Lock()

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

    def broadcast(self, message: Dict[str, Any]):
        with self._lock:
            conns = list(self.active_connections)
        if not conns or loop is None or not loop.is_running():
            return
        for connection in conns:
            try:
                asyncio.run_coroutine_threadsafe(connection.send_json(message), loop)
            except Exception as e:
                logger.debug(f"WS broadcast notice: {e}")

manager = ConnectionManager()
loop: Optional[asyncio.AbstractEventLoop] = None
liveness_daemon = LivenessWatchdogDaemon(event_callback=lambda evt: manager.broadcast(evt))

# ===== WATCHDOG THREAD =====
last_gateway = ""
last_interface = ""

def network_watchdog_thread():
    global last_gateway, last_interface
    try:
        info = scanner.get_network_info()
        last_interface = info.get('interface', '')
        last_gateway = scanner.get_current_gateway()
    except:
        pass

    logger.info("🐕 Network Telemetry Streamer started (streaming 1s)...")
    check_cycle = 0
    while True:
        time.sleep(1)
        check_cycle += 1

        # Broadcast live telemetry stream setiap 1 detik
        try:
            current_telemetry = telemetry_sampler.sample()
            manager.broadcast({
                "event": "telemetry",
                "data": current_telemetry
            })
        except:
            pass

        # Periksa pergantian gateway / interface setiap 10 detik
        if check_cycle >= 10:
            check_cycle = 0
            try:
                if scanner.is_network_changed(last_gateway, last_interface):
                    logger.warning("🔥 Watchdog detected network change! Refreshing spoofer & halting stale sessions...")
                    spoofer.stop_all()
                    redirect_manager.stop_all()
                    transparent_gateway.stop_all()
                    spoofer.refresh_interface()
                    dhcp_cache.clear()
                    scanner._DEVICE_HISTORY.clear()
                    clear_wifi_cache()
                    try:
                        info = scanner.get_network_info()
                        last_interface = info.get('interface', '')
                        last_gateway = scanner.get_current_gateway()
                    except:
                        pass

                    manager.broadcast({
                        "event": "network_changed",
                        "success": False,
                        "error": "NETWORK_CHANGED",
                        "message": f"Gateway changed to {last_gateway}",
                        "data": {
                            "new_gateway": last_gateway,
                            "new_interface": last_interface
                        }
                    })
            except Exception as e:
                logger.debug(f"Watchdog notice: {e}")

@app.on_event("startup")
async def startup_event():
    global loop
    loop = asyncio.get_running_loop()
    t = threading.Thread(target=network_watchdog_thread, daemon=True, name="watchdog-thread")
    t.start()

    # Aktifkan Passive DHCP Sniffer Daemon
    def on_dhcp_detected(device_info: Dict[str, Any]):
        manager.broadcast({
            "event": "dhcp_device_discovered",
            "data": device_info
        })
        if device_info.get("is_rogue_dhcp"):
            manager.broadcast({
                "event": "rogue_dhcp_detected",
                "data": {
                    "server_ip": device_info.get("rogue_server_ip") or device_info.get("server_id") or device_info.get("ip"),
                    "server_mac": device_info.get("mac"),
                    "gateway_ip": device_info.get("router_ip"),
                    "message": f"Rogue DHCP Server terdeteksi pada IP {device_info.get('rogue_server_ip') or device_info.get('server_id') or device_info.get('ip')} (MAC: {device_info.get('mac')})"
                }
            })
    NetworkScanner.start_dhcp_sniffer(callback=on_dhcp_detected)
    liveness_daemon.start()
    shield_engine.set_event_callback(lambda evt: manager.broadcast(evt))
    # Wire telemetri Gaming Mode ke WebSocket (ping/jitter live) — sebelumnya tak tersambung.
    gaming_engine.set_event_callback(lambda name, data: manager.broadcast({"event": name, "data": data}))

    logger.info("🚀 NetCut Sentinel Modular FastAPI Engine READY on http://127.0.0.1:8001")
    logger.info("📖 Governed by: docs/specs/SPEC-001, SPEC-002, SPEC-003, SPEC-005")
    logger.info("📖 Event Taxonomy: docs/EVENT_TAXONOMY.md | Runbook: docs/TROUBLESHOOTING.md")

@app.on_event("shutdown")
def shutdown_event():
    logger.info("🛑 Shutting down FastAPI microservice, cleaning all ARP spoof sessions...")
    cleanup_stages = (
        ("Shield", shield_engine.disable),
        ("Gaming", lambda: gaming_engine.toggle(False)),
        ("liveness watchdog", liveness_daemon.stop),
        ("DHCP sniffer", NetworkScanner.stop_dhcp_sniffer),
        ("redirect manager", redirect_manager.stop_all),
        ("transparent gateway", transparent_gateway.stop_all),
        ("ARP spoofer", spoofer.stop_all),
        ("executor", lambda: executor.shutdown(wait=False)),
    )
    failures = []
    for stage_name, cleanup in cleanup_stages:
        try:
            cleanup()
        except Exception as error:
            logger.error(f"Shutdown cleanup failed for {stage_name}: {error}")
            failures.append((stage_name, error))

    if failures:
        details = "; ".join(f"{stage_name}: {error}" for stage_name, error in failures)
        logger.error(f"Shutdown cleanup completed with failures: {details}")

# ===== Pydantic Request Models =====
class ShieldToggleRequest(BaseModel):
    enabled: bool
    mode: Optional[str] = "host_lock"
    auto_retaliate: Optional[bool] = False
    lan_targets: Optional[List[Dict[str, str]]] = None

class ShieldModeRequest(BaseModel):
    mode: str
    auto_retaliate: Optional[bool] = False
class LivenessPulseRequest(BaseModel):
    targets: List[Dict[str, Any]]
    gateway_ip: Optional[str] = None
    timeout: Optional[float] = 3.0

class SpoofStartRequest(BaseModel):
    victim_ip: str
    victim_mac: str
    gateway_ip: str
    gateway_mac: str
    speed_limit: int = 0
    victim_ipv6: Optional[str] = None
    gateway_ipv6: Optional[str] = None
    blackhole: bool = False  # True (Gaming) -> racun ke MAC hantu, bukan ke operator

class QuickReauthTarget(BaseModel):
    victim_ip: str
    victim_mac: str
    gateway_ip: str
    gateway_mac: str
    victim_ipv6: Optional[str] = None
    gateway_ipv6: Optional[str] = None

class QuickReauthRequest(BaseModel):
    targets: List[QuickReauthTarget]
    hold_ms: int = 1500

class ScanRequest(BaseModel):
    skip_multicast_wakeup: bool = False

class SpoofLimitRequest(BaseModel):
    session_id: str
    speed_limit: int

class SpoofStopRequest(BaseModel):
    session_id: str

class RedirectStartRequest(BaseModel):
    victim_ip: str
    victim_mac: str
    gateway_ip: str
    gateway_mac: str
    redirect_url: str
    instagram_username: str = ""

class RedirectStopRequest(BaseModel):
    victim_ip: str

class GatewayStartRequest(BaseModel):
    victim_ip: str
    victim_mac: str
    gateway_ip: str
    gateway_mac: str

class GatewayStopRequest(BaseModel):
    victim_ip: str

class SinkholeDomainRequest(BaseModel):
    domain: str

class DeepPortScanRequest(BaseModel):
    ip: str
    ports: Optional[List[int]] = None

class LeafCertRequest(BaseModel):
    domain: str

class DnsSpoofAddRequest(BaseModel):
    domain: str
    target_ip: str = "192.168.1.1"
    action: str = "spoof"
    is_enabled: bool = True

class DnsSpoofUpdateRequest(BaseModel):
    domain: Optional[str] = None
    target_ip: Optional[str] = None
    action: Optional[str] = None
    is_enabled: Optional[bool] = None

# Model fitur port bettercap dns.spoof
class DnsSpoofAllRequest(BaseModel):
    enabled: bool
    address: str = ""

class DnsHostsRequest(BaseModel):
    path: Optional[str] = None
    content: Optional[str] = None
    default_address: str = ""
    action: str = "spoof"  # 'sinkhole' untuk daftar blokir

class DnsTtlRequest(BaseModel):
    ttl: int = 10

class SynScanRequest(BaseModel):
    target_ip: str
    ports: Optional[List[int]] = None
    profile: str = "top-20"

# ===== REST API Routes =====
@app.get("/health")
def health_check():
    npcap = check_npcap_driver()
    return {
        "status": "ok",
        "engine": "FastAPI Microservice (Modular v2.3)",
        "npcap_ready": npcap["status"] == "ok",
        "npcap_installed": npcap["installed"],
        "npcap_service_running": npcap["service_running"],
        "interfaces_count": npcap.get("interfaces_count", 0),
        "timestamp": time.time()
    }

@app.get("/api/system/diagnostics")
def get_system_diagnostics():
    return run_system_diagnostics()

@app.get("/api/wifi")
def get_wifi_status():
    wifi = scanner.get_wifi_info()
    return {
        "success": True,
        "wifi": wifi
    }

@app.get("/api/telemetry")
def get_telemetry():
    return {
        "success": True,
        "telemetry": telemetry_sampler.sample()
    }

@app.get("/api/status")
def get_status():
    sessions = spoofer.get_all_sessions()
    return {
        "success": True,
        "status": {
            "sessions": sessions,
            "interface": spoofer._win_interface_name or str(spoofer._interface),
            "self_mac": spoofer._self_mac,
            "active_count": len(sessions)
        }
    }

@app.post("/api/scan")
async def scan_network(req: Optional[ScanRequest] = None):
    """Eksekusi scan jaringan di ThreadPool terpisah non-blocking."""
    logger.info("📥 [HTTP API] Request scan_network diterima")
    running_loop = asyncio.get_running_loop()
    try:
        liveness_daemon.set_scanning_active(True)
        skip_multicast_wakeup = bool(req and req.skip_multicast_wakeup)
        devices = await running_loop.run_in_executor(
            executor,
            lambda: scanner.scan_full(
                include_multicast_wakeup=not skip_multicast_wakeup
            ),
        )
        try:
            liveness_daemon.update_tracked_devices(devices)
        except Exception:
            pass
        return {
            "success": True,
            "data": {
                "devices": devices,
                "count": len(devices),
                "ap_isolation": scanner.get_ap_isolation()
            }
        }
    except Exception as e:
        logger.error(f"Scan failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        liveness_daemon.set_scanning_active(False)

@app.post("/api/liveness/pulse")
async def pulse_devices_liveness(req: LivenessPulseRequest):
    """
    Sub-second Multi-Vector Unicast Liveness Pulse Endpoint (< 0.75s).
    Menguji status online/offline kumpulan perangkat secara paralel.
    """
    try:
        results = pulse_batch(
            targets=req.targets,
            gateway_ip=req.gateway_ip,
            timeout=req.timeout or 3.0
        )
        return {
            "success": True,
            "data": {
                "results": results
            }
        }
    except Exception as e:
        logger.error(f"Error during liveness pulse: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/scan/ports")
async def deep_scan_device_ports(req: DeepPortScanRequest):
    """Eksekusi multi-threaded deep port scanner untuk target IP tertentu."""
    from .core.network import is_valid_private_ip
    if not is_valid_private_ip(req.ip):
        raise HTTPException(status_code=400, detail=f"Target IP '{req.ip}' bukan alamat IP privat yang sah (RFC 1918)")

    logger.info(f"📥 [HTTP API] Request deep_scan_ports untuk {req.ip}")
    running_loop = asyncio.get_running_loop()
    try:
        from .core.fingerprint.probe import deep_scan_ports
        result = await running_loop.run_in_executor(
            executor,
            deep_scan_ports,
            req.ip,
            req.ports
        )
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        logger.error(f"Deep port scan failed for {req.ip}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/dhcp/wakeup")
async def trigger_dhcp_wakeup():
    """Refresh discovery dan observasi DHCP alami untuk Optimasi Teknik 3B."""
    logger.info("📥 [HTTP API] Request Discovery Refresh & DHCP Observation diterima")
    network_info = get_network_info()
    controller_ip = str(network_info.get('ip') or '').strip()
    network_cidr = str(network_info.get('network') or '').strip()
    gateway_ip = str(get_current_gateway() or '').strip()

    if (
        not is_valid_private_ip(controller_ip)
        or not is_valid_private_network(network_cidr)
        or not is_valid_private_ip(gateway_ip)
    ):
        raise HTTPException(
            status_code=400,
            detail="Discovery Refresh membutuhkan topologi IPv4 RFC1918 yang valid",
        )

    try:
        active_network = ipaddress.IPv4Network(network_cidr, strict=False)
        if (
            ipaddress.IPv4Address(controller_ip) not in active_network
            or ipaddress.IPv4Address(gateway_ip) not in active_network
        ):
            raise HTTPException(
                status_code=400,
                detail="Controller atau gateway berada di luar subnet aktif",
            )
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail="CIDR jaringan aktif tidak valid",
        ) from error

    running_loop = asyncio.get_running_loop()
    try:
        controller_mac = get_self_mac() or ''
        before = _filter_dhcp_observation_snapshot(
            dhcp_cache.get_unique_snapshot(),
            controller_ip,
            gateway_ip,
            controller_mac,
        )
        delivery = await running_loop.run_in_executor(
            executor,
            send_multicast_wakeup,
        )
        if delivery.get('succeeded', 0) <= 0:
            raise HTTPException(
                status_code=503,
                detail="Tidak ada datagram discovery yang berhasil dikirim",
            )

        await asyncio.sleep(4.0)
        after = _filter_dhcp_observation_snapshot(
            dhcp_cache.get_unique_snapshot(),
            controller_ip,
            gateway_ip,
            controller_mac,
        )
        dhcp_delta = diff_dhcp_profiles(before, after)
        return {
            "success": True,
            "message": "Discovery refresh transmitted; DHCP observation window completed",
            "data": {
                "delivery": delivery,
                "dhcp_delta": dhcp_delta,
                "dhcp_profiled_count": len(after),
                "snapshot": after,
                "observation_seconds": 4.0,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Discovery refresh failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/network/quick-reauth")
async def quick_reauth_profiling(req: QuickReauthRequest):
    """
    Quick Re-Auth Profiling: micro-cut SERENTAK ke target Unknown lalu restore, diperkuat
    multicast wake-up, untuk memancing DHCP REQUEST baru (ditangkap sniffer pasif).
    """
    logger.info(f"📥 [HTTP API] Request quick-reauth untuk {len(req.targets)} target (hold {req.hold_ms}ms)")
    running_loop = asyncio.get_running_loop()
    try:
        def _run():
            result = spoofer.micro_cut_batch(
                [t.dict() for t in req.targets],
                hold_seconds=req.hold_ms / 1000.0
            )
            # Perkuat: siaran multicast untuk memancing renew DHCP setelah koneksi pulih
            try:
                send_multicast_wakeup()
            except Exception as e:
                logger.debug(f"Notice multicast wakeup after reauth: {e}")
            return result

        data = await running_loop.run_in_executor(executor, _run)
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"Quick re-auth failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/dhcp/stats")
def get_dhcp_profiling_stats():
    """Mengambil status snapshot profiling DHCP real-time."""
    snapshot = dhcp_cache.get_snapshot()
    return {
        "success": True,
        "data": {
            "count": len(snapshot),
            "snapshot": snapshot
        }
    }

@app.get("/api/network/ap-isolation")
def get_ap_isolation_status():
    """Mengambil status diagnostik evaluasi AP Isolation terkini."""
    return {
        "success": True,
        "data": scanner.get_ap_isolation()
    }

@app.post("/api/spoof/limit")
def update_spoof_limit(req: SpoofLimitRequest):
    logger.info(f"📥 [HTTP API] Request update_spoof_limit untuk session {req.session_id} -> {req.speed_limit}%")
    try:
        success = spoofer.set_speed_limit(req.session_id, req.speed_limit)
        return {
            "success": success,
            "session_id": req.session_id,
            "speed_limit": req.speed_limit
        }
    except Exception as e:
        logger.error(f"Error updating spoof limit: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/spoof/start")
def start_spoof(req: SpoofStartRequest):
    logger.info(f"📥 [HTTP API] Request start_spoof untuk {req.victim_ip}")
    try:
        session_id = spoofer.start(
            victim_ip=req.victim_ip,
            victim_mac=req.victim_mac,
            gateway_ip=req.gateway_ip,
            gateway_mac=req.gateway_mac,
            speed_limit=req.speed_limit,
            victim_ipv6=req.victim_ipv6,
            gateway_ipv6=req.gateway_ipv6,
            blackhole=req.blackhole
        )
        return {
            "success": True,
            "data": {
                "session_id": session_id
            }
        }
    except Exception as e:
        logger.error(f"Error starting spoof: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/spoof/stop")
def stop_spoof(req: SpoofStopRequest):
    logger.info(f"📥 [HTTP API] Request stop_spoof untuk session {req.session_id}")
    try:
        spoofer.stop(req.session_id)
        return {
            "success": True,
            "message": f"Session {req.session_id} stopped"
        }
    except SessionNotFoundError:
        return {
            "success": True,
            "already_stopped": True,
            "message": f"Session {req.session_id} already stopped"
        }
    except Exception as e:
        logger.error(f"Error stopping spoof: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/spoof/restore")
def restore_spoof(req: SpoofStopRequest):
    try:
        spoofer.stop(req.session_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/spoof/stop_all")
def stop_all_spoof():
    logger.info("📥 [HTTP API] Request stop_all_spoof")
    try:
        spoofer.stop_all()
        return {"success": True, "message": "All spoofing sessions stopped"}
    except Exception as e:
        logger.error(f"Error stopping all spoof sessions: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ===== REDIRECT (CAPTIVE PORTAL & DNS SPOOFING) ROUTES =====
@app.get("/api/redirect/status")
def get_redirect_status():
    return {
        "success": True,
        "sessions": redirect_manager.get_sessions()
    }

@app.post("/api/redirect/start")
def start_redirect(req: RedirectStartRequest):
    logger.info(f"📥 [HTTP API] Request start_redirect untuk {req.victim_ip} -> {req.redirect_url}")
    try:
        data = redirect_manager.start_redirect(
            victim_ip=req.victim_ip,
            victim_mac=req.victim_mac,
            gateway_ip=req.gateway_ip,
            gateway_mac=req.gateway_mac,
            redirect_url=req.redirect_url,
            instagram_username=req.instagram_username
        )
        return {
            "success": True,
            "data": data
        }
    except Exception as e:
        logger.error(f"Error starting redirect: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/redirect/stop")
def stop_redirect(req: RedirectStopRequest):
    logger.info(f"📥 [HTTP API] Request stop_redirect untuk {req.victim_ip}")
    try:
        success = redirect_manager.stop_redirect(req.victim_ip)
        return {
            "success": success,
            "message": f"Redirect for {req.victim_ip} stopped"
        }
    except Exception as e:
        logger.error(f"Error stopping redirect: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ===== TRANSPARENT GATEWAY & TRAFFIC INSPECTION ROUTES =====
@app.get("/api/gateway/status")
def get_gateway_status():
    return {
        "success": True,
        "data": transparent_gateway.get_status()
    }

@app.post("/api/gateway/start")
def start_transparent_gateway(req: GatewayStartRequest):
    logger.info(f"📥 [HTTP API] Request start_transparent_gateway untuk {req.victim_ip}")
    try:
        data = transparent_gateway.start_gateway(
            victim_ip=req.victim_ip,
            victim_mac=req.victim_mac,
            gateway_ip=req.gateway_ip,
            gateway_mac=req.gateway_mac
        )
        manager.broadcast({
            "event": "gateway_status_changed",
            "data": transparent_gateway.get_status()
        })
        return {
            "success": True,
            "data": data
        }
    except Exception as e:
        logger.error(f"Error starting transparent gateway: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/gateway/stop")
def stop_transparent_gateway(req: GatewayStopRequest):
    logger.info(f"📥 [HTTP API] Request stop_transparent_gateway untuk {req.victim_ip}")
    try:
        success = transparent_gateway.stop_gateway(req.victim_ip)
        manager.broadcast({
            "event": "gateway_status_changed",
            "data": transparent_gateway.get_status()
        })
        return {
            "success": success,
            "message": f"Transparent gateway for {req.victim_ip} stopped"
        }
    except Exception as e:
        logger.error(f"Error stopping transparent gateway: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/gateway/sinkhole")
def get_gateway_sinkholes():
    return {
        "success": True,
        "domains": transparent_gateway.get_sinkhole_domains()
    }

@app.post("/api/gateway/sinkhole/add")
def add_gateway_sinkhole(req: SinkholeDomainRequest):
    success = transparent_gateway.add_sinkhole_domain(req.domain)
    return {
        "success": success,
        "domain": req.domain,
        "domains": transparent_gateway.get_sinkhole_domains()
    }

@app.post("/api/gateway/sinkhole/remove")
def remove_gateway_sinkhole(req: SinkholeDomainRequest):
    success = transparent_gateway.remove_sinkhole_domain(req.domain)
    return {
        "success": success,
        "domain": req.domain,
        "domains": transparent_gateway.get_sinkhole_domains()
    }

@app.get("/api/gateway/dns-logs")
def get_gateway_dns_logs(limit: int = 100):
    return {
        "success": True,
        "logs": transparent_gateway.get_dns_logs(limit=limit)
    }

@app.delete("/api/gateway/dns-logs")
def clear_gateway_dns_logs():
    transparent_gateway.clear_dns_logs()
    return {
        "success": True,
        "message": "DNS logs cleared"
    }

# ===== L7 INTERCEPTOR & DYNAMIC TLS CA (MITMPROXY ENGINE) ROUTES =====
@app.get("/api/interceptor/ca")
def get_interceptor_ca_status():
    return {
        "success": True,
        "data": cert_engine.get_ca_info()
    }

@app.get("/api/interceptor/ca/cert")
def download_interceptor_ca_cert():
    pem_bytes = cert_engine.get_ca_cert_pem()
    return Response(
        content=pem_bytes,
        media_type="application/x-x509-ca-cert",
        headers={
            "Content-Disposition": "attachment; filename=spoorf-ca.crt"
        }
    )

@app.post("/api/interceptor/cert/leaf")
def generate_leaf_certificate(req: LeafCertRequest):
    try:
        key_pem, cert_pem = cert_engine.generate_leaf_cert(req.domain)
        return {
            "success": True,
            "domain": req.domain,
            "cert": cert_pem.decode("utf-8"),
            "key": key_pem.decode("utf-8")
        }
    except Exception as e:
        logger.error(f"Error generating leaf cert for {req.domain}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/interceptor/flows")
def get_interceptor_flows(
    limit: int = 100,
    search: Optional[str] = None,
    scheme: Optional[str] = None,
    method: Optional[str] = None,
    is_blocked: Optional[bool] = None
):
    return {
        "success": True,
        "stats": flow_manager.get_stats(),
        "flows": flow_manager.get_flows(
            limit=limit,
            search=search,
            scheme=scheme,
            method=method,
            is_blocked=is_blocked
        )
    }

@app.delete("/api/interceptor/flows")
def clear_interceptor_flows():
    flow_manager.clear()
    return {
        "success": True,
        "message": "L7 Flows cleared"
    }

# ===== BETTERCAP SECURITY SUITE (DNS SPOOFER, PACKET DISSECTOR, SYN SCAN) ROUTES =====
@app.get("/api/bettercap/status")
def get_bettercap_status():
    gw_status = transparent_gateway.get_status()
    return {
        "success": True,
        "dns_rules_count": len(bettercap_dns.get_all_rules()),
        "sniffed_credentials_count": len(bettercap_dissector.get_history(limit=500)),
        "active_gateway_sessions": gw_status.get("active_count", len(gw_status.get("active_sessions", {})))
    }

@app.get("/api/bettercap/dns/rules")
def get_bettercap_dns_rules():
    return {
        "success": True,
        "rules": bettercap_dns.get_all_rules(),
        "spoof_all_enabled": bettercap_dns.spoof_all_enabled,
        "spoof_all_address": bettercap_dns.spoof_all_address,
        "default_ttl": bettercap_dns.default_ttl
    }

@app.post("/api/bettercap/dns/spoof-all")
def set_bettercap_dns_spoof_all(req: DnsSpoofAllRequest):
    # dns.spoof.all — catch-all: palsukan SEMUA domain ke satu IP (opt-in, hati-hati).
    state = bettercap_dns.set_spoof_all(req.enabled, req.address)
    return {"success": True, **state}

@app.post("/api/bettercap/dns/hosts")
def load_bettercap_dns_hosts(req: DnsHostsRequest):
    # dns.spoof.hosts — muat pemetaan domain->IP dari file ATAU konten inline.
    if req.content is not None:
        count = bettercap_dns.load_hosts_content(req.content, req.default_address, req.action)
    elif req.path:
        count = bettercap_dns.load_hosts_file(req.path, req.default_address, req.action)
    else:
        raise HTTPException(status_code=400, detail="Sertakan 'path' atau 'content'")
    return {"success": True, "loaded": count, "rules": bettercap_dns.get_all_rules()}

@app.post("/api/bettercap/dns/ttl")
def set_bettercap_dns_ttl(req: DnsTtlRequest):
    # dns.spoof.ttl — TTL jawaban DNS palsu.
    ttl = bettercap_dns.set_default_ttl(req.ttl)
    return {"success": True, "default_ttl": ttl}

@app.post("/api/bettercap/dns/rules")
def add_bettercap_dns_rule(req: DnsSpoofAddRequest):
    rule = bettercap_dns.add_rule(
        domain=req.domain,
        target_ip=req.target_ip,
        action=req.action,
        is_enabled=req.is_enabled
    )
    return {
        "success": True,
        "rule": rule.to_dict(),
        "rules": bettercap_dns.get_all_rules()
    }

@app.put("/api/bettercap/dns/rules/{rule_id}")
def update_bettercap_dns_rule(rule_id: str, req: DnsSpoofUpdateRequest):
    rule = bettercap_dns.update_rule(
        rule_id=rule_id,
        domain=req.domain,
        target_ip=req.target_ip,
        action=req.action,
        is_enabled=req.is_enabled
    )
    if not rule:
        raise HTTPException(status_code=404, detail=f"Rule {rule_id} not found")
    return {
        "success": True,
        "rule": rule.to_dict(),
        "rules": bettercap_dns.get_all_rules()
    }

@app.delete("/api/bettercap/dns/rules/{rule_id}")
def delete_bettercap_dns_rule(rule_id: str):
    success = bettercap_dns.delete_rule(rule_id)
    return {
        "success": success,
        "rules": bettercap_dns.get_all_rules()
    }

@app.get("/api/bettercap/credentials")
def get_bettercap_credentials(limit: int = 100):
    return {
        "success": True,
        "credentials": bettercap_dissector.get_history(limit=limit)
    }

@app.delete("/api/bettercap/credentials")
def clear_bettercap_credentials():
    bettercap_dissector.clear()
    return {
        "success": True,
        "message": "Bettercap credentials cleared"
    }

@app.post("/api/bettercap/syn-scan")
def run_bettercap_syn_scan(req: SynScanRequest):
    from .core.network import is_valid_private_ip
    if not is_valid_private_ip(req.target_ip):
        raise HTTPException(status_code=400, detail=f"Target IP '{req.target_ip}' bukan alamat IP privat yang sah (RFC 1918)")
    try:
        result = bettercap_syn_scanner.scan_host(
            target_ip=req.target_ip,
            ports=req.ports,
            profile=req.profile
        )
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        logger.error(f"Error executing Bettercap SYN scan: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ===== SENTINEL SHIELD (ANTI-ARP SPOOFING & THREAT DETECTOR) ROUTES =====
@app.get("/api/shield/status")
def get_shield_status():
    return {
        "success": True,
        "data": shield_engine.get_status()
    }

@app.post("/api/shield/toggle")
def toggle_shield(req: ShieldToggleRequest):
    if req.enabled:
        status = shield_engine.enable(
            mode=req.mode or "host_lock",
            auto_retaliate=bool(req.auto_retaliate),
            lan_targets=req.lan_targets
        )
    else:
        status = shield_engine.disable()
    gaming_engine.toggle(False)
    return {
        "success": True,
        "data": status
    }

@app.post("/api/shield/mode")
def set_shield_mode(req: ShieldModeRequest):
    status = shield_engine.set_mode(
        mode=req.mode,
        auto_retaliate=bool(req.auto_retaliate)
    )
    return {
        "success": True,
        "data": status
    }

@app.get("/api/shield/threats")
def get_shield_threats():
    return {
        "success": True,
        "data": shield_engine.get_threats()
    }

@app.delete("/api/shield/threats")
def clear_shield_threats():
    success = shield_engine.clear_threats()
    return {
        "success": success,
        "message": "Threat log cleared"
    }

# ===== WEBSOCKET ROUTE =====
@app.websocket("/ws/events")
async def websocket_events(websocket: WebSocket):
    # KEAMANAN (P1): tolak handshake WS tanpa token yang benar bila guard aktif.
    expected = os.getenv("SENTINEL_API_TOKEN")
    if expected:
        provided = websocket.headers.get("x-sentinel-token") or websocket.query_params.get("token")
        if provided != expected:
            await websocket.close(code=1008)  # Policy Violation
            return
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        manager.disconnect(websocket)

class GamingToggleRequest(BaseModel):
    enabled: bool
    mode: Optional[str] = "auto_airtime"
    target_ping_ms: Optional[float] = 25.0

@app.get("/api/gaming/status")
async def get_gaming_status():
    from .core.gaming import gaming_engine
    return {
        "success": True,
        "data": gaming_engine.get_status()
    }

@app.post("/api/gaming/toggle")
async def toggle_gaming_mode(req: GamingToggleRequest):
    from .core.gaming import gaming_engine
    status = gaming_engine.toggle(
        enabled=req.enabled,
        mode=req.mode or "auto_airtime",
        target_ping_ms=req.target_ping_ms or 25.0
    )
    return {
        "success": True,
        "data": status
    }
