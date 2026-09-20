"""System, Health & Diagnostics Route Handlers."""

import time
from fastapi import APIRouter, Depends

from ...core.diagnostics import check_npcap_driver, run_system_diagnostics
from ..deps import auto_inject, get_spoofer

router = APIRouter(tags=["System"])


@router.get("/health")
@auto_inject
def health_check():
    """Health check endpoint accessible without authentication."""
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


@router.get("/api/system/diagnostics")
@auto_inject
def get_system_diagnostics():
    """Run comprehensive system and environment diagnostics."""
    return run_system_diagnostics()


@router.get("/api/status")
@auto_inject
def get_status(spoofer=Depends(get_spoofer)):
    """Summary of active ARP/NDP sessions, interfaces, and IPv6 leak status."""
    sessions = spoofer.get_all_sessions()
    ipv6_cut = sum(1 for s in sessions.values() if s.get("ipv6", {}).get("status") == "cut")
    ipv6_leak = sum(1 for s in sessions.values() if s.get("ipv6", {}).get("status") == "leak")
    return {
        "success": True,
        "status": {
            "sessions": sessions,
            "interface": getattr(spoofer, "_win_interface_name", None) or str(getattr(spoofer, "_interface", "")),
            "self_mac": getattr(spoofer, "_self_mac", ""),
            "active_count": len(sessions),
            "ipv6_summary": {"cut": ipv6_cut, "leak": ipv6_leak}
        }
    }
