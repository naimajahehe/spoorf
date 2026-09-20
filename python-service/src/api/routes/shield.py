"""Sentinel Shield Anti-ARP Poisoning Defense & Threat Detection Routes."""

from fastapi import APIRouter, Depends

from ..deps import auto_inject, get_gaming_engine, get_shield_engine
from ..schemas import ShieldModeRequest, ShieldToggleRequest

router = APIRouter(tags=["Shield"])


@router.get("/api/shield/status")
@auto_inject
def get_shield_status(shield_engine=Depends(get_shield_engine)):
    """Status proteksi Sentinel Shield."""
    return {
        "success": True,
        "data": shield_engine.get_status(),
    }


@router.post("/api/shield/toggle")
@auto_inject
def toggle_shield(
    req: ShieldToggleRequest,
    shield_engine=Depends(get_shield_engine),
    gaming_engine=Depends(get_gaming_engine),
):
    """Aktifkan atau nonaktifkan Sentinel Shield."""
    if req.enabled:
        status = shield_engine.enable(
            mode=req.mode or "host_lock",
            auto_retaliate=bool(req.auto_retaliate),
            lan_targets=req.lan_targets,
        )
    else:
        status = shield_engine.disable()
    gaming_engine.toggle(False)
    return {
        "success": True,
        "data": status,
    }


@router.post("/api/shield/mode")
@auto_inject
def set_shield_mode(
    req: ShieldModeRequest,
    shield_engine=Depends(get_shield_engine),
):
    """Ubah mode operasi Sentinel Shield."""
    status = shield_engine.set_mode(
        mode=req.mode,
        auto_retaliate=bool(req.auto_retaliate),
    )
    return {
        "success": True,
        "data": status,
    }


@router.get("/api/shield/threats")
@auto_inject
def get_shield_threats(shield_engine=Depends(get_shield_engine)):
    """Ambil daftar ancaman ARP spoofing yang terdeteksi."""
    return {
        "success": True,
        "data": shield_engine.get_threats(),
    }


@router.delete("/api/shield/threats")
@auto_inject
def clear_shield_threats(shield_engine=Depends(get_shield_engine)):
    """Bersihkan riwayat log ancaman."""
    success = shield_engine.clear_threats()
    return {
        "success": success,
        "message": "Threat log cleared",
    }
