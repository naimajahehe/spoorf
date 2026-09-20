#!/usr/bin/env python3
"""
NetCut Sentinel FastAPI Server & WebSocket Event Hub
====================================================
FastAPI microservice menyediakan REST API dan WebSocket stream
untuk orkestrator L2 network discovery, ARP spoofing, dan live telemetry.
Modularized architecture (APIRouter per domain, DI via Depends, and Lifespan Manager).
"""

import asyncio
import hmac
import logging
import os
import sys
import warnings

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api.routes import ALL_ROUTERS
from .api.routes.bettercap import (
    add_bettercap_dns_rule,
    clear_bettercap_credentials,
    delete_bettercap_dns_rule,
    get_bettercap_credentials,
    get_bettercap_dns_rules,
    get_bettercap_status,
    load_bettercap_dns_hosts,
    run_bettercap_syn_scan,
    set_bettercap_dns_spoof_all,
    set_bettercap_dns_ttl,
    update_bettercap_dns_rule,
)
from .api.routes.discovery import (
    _filter_dhcp_observation_snapshot,
    deep_scan_device_ports,
    get_ap_isolation_status,
    get_dhcp_profiling_stats,
    get_wifi_status,
    profile_refresh,
    pulse_devices_liveness,
    quick_reauth_profiling,
    scan_network,
    trigger_dhcp_wakeup,
)
from .api.routes.gaming import (
    get_gaming_status,
    toggle_gaming_mode,
)
from .api.routes.interceptor import (
    clear_interceptor_flows,
    download_interceptor_ca_cert,
    generate_leaf_certificate,
    get_interceptor_ca_status,
    get_interceptor_flows,
)
from .api.routes.redirector import (
    add_gateway_sinkhole,
    clear_gateway_dns_logs,
    get_gateway_dns_logs,
    get_gateway_sinkholes,
    get_gateway_status,
    get_redirect_status,
    remove_gateway_sinkhole,
    start_redirect,
    start_transparent_gateway,
    stop_redirect,
    stop_transparent_gateway,
)
from .api.routes.shield import (
    clear_shield_threats,
    get_shield_status,
    get_shield_threats,
    set_shield_mode,
    toggle_shield,
)
from .api.routes.spoof import (
    restore_spoof,
    start_spoof,
    stop_all_spoof,
    stop_spoof,
    update_spoof_limit,
)
from .api.routes.system import (
    get_status,
    get_system_diagnostics,
    health_check,
)
from .api.routes.telemetry import get_telemetry
from .api.routes.websocket import websocket_events
from .api.schemas import (
    DeepPortScanRequest,
    DnsHostsRequest,
    DnsSpoofAddRequest,
    DnsSpoofAllRequest,
    DnsSpoofUpdateRequest,
    DnsTtlRequest,
    GamingToggleRequest,
    GatewayStartRequest,
    GatewayStopRequest,
    LeafCertRequest,
    LivenessPulseRequest,
    ProfileRefreshRequest,
    ProfileRefreshTarget,
    QuickReauthRequest,
    QuickReauthTarget,
    RedirectStartRequest,
    RedirectStopRequest,
    ScanRequest,
    ShieldModeRequest,
    ShieldToggleRequest,
    SinkholeDomainRequest,
    SpoofLimitRequest,
    SpoofStartRequest,
    SpoofStopRequest,
    SynScanRequest,
)
from .container import ConnectionManager, get_default_container
from .core.discovery import (
    collect_profile_refresh,
    dhcp_cache,
    pulse_batch,
    send_multicast_wakeup,
)
from .core.discovery.dhcp import diff_dhcp_profiles
from .core.discovery.profile_observation import (
    ProfileCollectorUnavailableError,
    ProfileRefreshValidationError,
)
from .core.gaming import gaming_engine
from .core.network import (
    get_current_gateway,
    get_network_info,
    get_self_mac,
    is_valid_mac,
    is_valid_private_ip,
    is_valid_private_network,
)
from .core.scanner import NetworkScanner
from .core.shield import shield_engine
from .core.spoofer import ARPSpoofer
from .exceptions.custom import SessionNotFoundError, SpoofError
from .lifespan import lifespan
from .config import settings, verify_api_token
from .utils.logger import logger

# Redam peringatan kompatibilitas internal Scapy & Cryptography
warnings.filterwarnings("ignore", category=DeprecationWarning, module="scapy")
try:
    from cryptography.utils import CryptographyDeprecationWarning
    warnings.filterwarnings("ignore", category=CryptographyDeprecationWarning)
except Exception:
    pass

logging.getLogger("scapy.runtime").setLevel(logging.ERROR)

# Inisialisasi FastAPI dengan Modern Lifespan Context Manager
app = FastAPI(
    title="NetCut Sentinel Network Engine",
    description="Modular High-Performance Layer 2 Network Discovery, ARP Spoofing, L7 Interception & Bettercap Security Suite Engine",
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

# CORS terkunci
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# KEAMANAN (P1): Universal Fail-Closed Token Guard
_PUBLIC_PATHS = {"/health"}


@app.middleware("http")
async def api_token_guard(request: Request, call_next):
    if request.url.path not in _PUBLIC_PATHS and request.method != "OPTIONS":
        provided = request.headers.get("x-sentinel-token")
        ok, reason = verify_api_token(provided, settings)
        if not ok:
            return JSONResponse(
                status_code=401,
                content={"success": False, "error": reason or "Unauthorized: missing or invalid API token."}
            )
    return await call_next(request)


# KEAMANAN (P2): Sanitasi respons error 5xx
@app.exception_handler(StarletteHTTPException)
async def sanitized_http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code >= 500:
        logger.error(f"[API {exc.status_code}] {request.method} {request.url.path}: {exc.detail}")
        return JSONResponse(status_code=exc.status_code, content={"success": False, "error": "Internal server error"})
    return JSONResponse(status_code=exc.status_code, content={"success": False, "error": exc.detail})


# Registrasi seluruh Domain APIRouter
for router in ALL_ROUTERS:
    app.include_router(router)


# =============================================================================
# BACKWARD COMPATIBILITY FACADE & SINGLETON EXPORTS
# =============================================================================
# Memastikan modul-level patching (@patch('src.server.spoofer...')) dan direct
# function calls dari existing unit tests tetap bekerja 100% tanpa modifikasi.
container = get_default_container()

scanner = container.scanner
spoofer = container.spoofer
redirect_manager = container.redirect_manager
cert_engine = container.cert_engine
flow_manager = container.flow_manager
bettercap_dns = container.bettercap_dns
bettercap_dissector = container.bettercap_dissector
bettercap_syn_scanner = container.bettercap_syn_scanner
transparent_gateway = container.transparent_gateway
telemetry_sampler = container.telemetry_sampler
executor = container.executor
manager = container.connection_manager
liveness_daemon = container.liveness_daemon


def shutdown_event():
    """Callable shutdown cleanup sequence preserving exact test contract."""
    srv = sys.modules.get("src.server")
    _shield = getattr(srv, "shield_engine", shield_engine)
    _gaming = getattr(srv, "gaming_engine", gaming_engine)
    _liveness = getattr(srv, "liveness_daemon", container.liveness_daemon)
    _scanner_cls = getattr(srv, "NetworkScanner", NetworkScanner)
    _redirect = getattr(srv, "redirect_manager", container.redirect_manager)
    _gateway = getattr(srv, "transparent_gateway", container.transparent_gateway)
    _spoofer = getattr(srv, "spoofer", container.spoofer)
    _executor = getattr(srv, "executor", container.executor)

    cleanup_stages = (
        ("Shield", _shield.disable),
        ("Gaming", lambda: _gaming.toggle(False)),
        ("liveness watchdog", _liveness.stop),
        ("DHCP sniffer", _scanner_cls.stop_dhcp_sniffer),
        ("redirect manager", _redirect.stop_all),
        ("transparent gateway", _gateway.stop_all),
        ("ARP spoofer", _spoofer.stop_all),
        ("executor", lambda: _executor.shutdown(wait=False)),
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


__all__ = [
    "app",
    "container",
    "scanner",
    "spoofer",
    "redirect_manager",
    "cert_engine",
    "flow_manager",
    "bettercap_dns",
    "bettercap_dissector",
    "bettercap_syn_scanner",
    "transparent_gateway",
    "telemetry_sampler",
    "executor",
    "manager",
    "liveness_daemon",
    "shield_engine",
    "gaming_engine",
    "NetworkScanner",
    "ARPSpoofer",
    "ConnectionManager",
    "dhcp_cache",
    "shutdown_event",
    # Functions
    "health_check",
    "get_system_diagnostics",
    "get_wifi_status",
    "get_telemetry",
    "get_status",
    "scan_network",
    "pulse_devices_liveness",
    "deep_scan_device_ports",
    "trigger_dhcp_wakeup",
    "profile_refresh",
    "quick_reauth_profiling",
    "get_dhcp_profiling_stats",
    "get_ap_isolation_status",
    "update_spoof_limit",
    "start_spoof",
    "stop_spoof",
    "restore_spoof",
    "stop_all_spoof",
    "get_redirect_status",
    "start_redirect",
    "stop_redirect",
    "get_gateway_status",
    "start_transparent_gateway",
    "stop_transparent_gateway",
    "get_gateway_sinkholes",
    "add_gateway_sinkhole",
    "remove_gateway_sinkhole",
    "get_gateway_dns_logs",
    "clear_gateway_dns_logs",
    "get_interceptor_ca_status",
    "download_interceptor_ca_cert",
    "generate_leaf_certificate",
    "get_interceptor_flows",
    "clear_interceptor_flows",
    "get_bettercap_status",
    "get_bettercap_dns_rules",
    "set_bettercap_dns_spoof_all",
    "load_bettercap_dns_hosts",
    "set_bettercap_dns_ttl",
    "add_bettercap_dns_rule",
    "update_bettercap_dns_rule",
    "delete_bettercap_dns_rule",
    "get_bettercap_credentials",
    "clear_bettercap_credentials",
    "run_bettercap_syn_scan",
    "get_shield_status",
    "toggle_shield",
    "set_shield_mode",
    "get_shield_threats",
    "clear_shield_threats",
    "websocket_events",
    "get_gaming_status",
    "toggle_gaming_mode",
    # Helper functions
    "get_network_info",
    "get_current_gateway",
    "get_self_mac",
    "send_multicast_wakeup",
    "collect_profile_refresh",
    "pulse_batch",
    "is_valid_private_ip",
    "is_valid_private_network",
    "is_valid_mac",
    "diff_dhcp_profiles",
    "_filter_dhcp_observation_snapshot",
    # Exceptions
    "SessionNotFoundError",
    "SpoofError",
    "ProfileRefreshValidationError",
    "ProfileCollectorUnavailableError",
    # Schemas
    "ShieldToggleRequest",
    "ShieldModeRequest",
    "LivenessPulseRequest",
    "SpoofStartRequest",
    "QuickReauthTarget",
    "QuickReauthRequest",
    "ProfileRefreshTarget",
    "ProfileRefreshRequest",
    "ScanRequest",
    "SpoofLimitRequest",
    "SpoofStopRequest",
    "RedirectStartRequest",
    "RedirectStopRequest",
    "GatewayStartRequest",
    "GatewayStopRequest",
    "SinkholeDomainRequest",
    "DeepPortScanRequest",
    "LeafCertRequest",
    "DnsSpoofAddRequest",
    "DnsSpoofUpdateRequest",
    "DnsSpoofAllRequest",
    "DnsHostsRequest",
    "DnsTtlRequest",
    "SynScanRequest",
    "GamingToggleRequest",
]
