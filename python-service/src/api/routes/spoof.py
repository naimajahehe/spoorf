"""ARP & NDP IPv6 Spoofing, Bandwidth Throttling & Restorations Routes."""

from fastapi import APIRouter, Depends, HTTPException

from ...exceptions.custom import SessionNotFoundError
from ...utils.logger import logger
from ..deps import auto_inject, get_spoofer
from ..schemas import SpoofLimitRequest, SpoofStartRequest, SpoofStopRequest

router = APIRouter(tags=["Spoof"])


@router.post("/api/spoof/limit")
@auto_inject
def update_spoof_limit(
    req: SpoofLimitRequest,
    spoofer=Depends(get_spoofer),
):
    """Update kecepatan throttling PWM (0-100%) untuk sesi tertentu."""
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


@router.post("/api/spoof/start")
@auto_inject
def start_spoof(
    req: SpoofStartRequest,
    spoofer=Depends(get_spoofer),
):
    """Mulai sesi ARP Poisoning / IPv6 NDP Spoofing (Dual-Stack)."""
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


@router.post("/api/spoof/stop")
@auto_inject
def stop_spoof(
    req: SpoofStopRequest,
    spoofer=Depends(get_spoofer),
):
    """Hentikan sesi manipulasi dan pulihkan tabel ARP korban."""
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


@router.post("/api/spoof/restore")
@auto_inject
def restore_spoof(
    req: SpoofStopRequest,
    spoofer=Depends(get_spoofer),
):
    """Restorasi tabel ARP korban (alias stop_spoof)."""
    try:
        spoofer.stop(req.session_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/spoof/stop_all")
@auto_inject
def stop_all_spoof(spoofer=Depends(get_spoofer)):
    """Hentikan seluruh sesi spoofing aktif serentak."""
    logger.info("📥 [HTTP API] Request stop_all_spoof")
    try:
        spoofer.stop_all()
        return {"success": True, "message": "All spoofing sessions stopped"}
    except Exception as e:
        logger.error(f"Error stopping all spoof sessions: {e}")
        raise HTTPException(status_code=500, detail=str(e))
