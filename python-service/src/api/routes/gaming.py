"""Gaming Mode Priority Optimization Routes."""

from fastapi import APIRouter, Depends

from ..deps import auto_inject, get_gaming_engine
from ..schemas import GamingToggleRequest

router = APIRouter(tags=["Gaming"])


@router.get("/api/gaming/status")
@auto_inject
async def get_gaming_status(gaming_engine=Depends(get_gaming_engine)):
    """Status Gaming Priority Mode."""
    return {
        "success": True,
        "data": gaming_engine.get_status(),
    }


@router.post("/api/gaming/toggle")
@auto_inject
async def toggle_gaming_mode(
    req: GamingToggleRequest,
    gaming_engine=Depends(get_gaming_engine),
):
    """Aktifkan atau nonaktifkan optimasi latensi gaming."""
    status = gaming_engine.toggle(
        enabled=req.enabled,
        mode=req.mode or "auto_airtime",
        target_ping_ms=req.target_ping_ms or 25.0,
    )
    return {
        "success": True,
        "data": status,
    }
