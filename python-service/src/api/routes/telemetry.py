"""Real-Time Network Telemetry Route Handlers."""

from fastapi import APIRouter, Depends

from ..deps import auto_inject, get_telemetry_sampler

router = APIRouter(tags=["Telemetry"])


@router.get("/api/telemetry")
@auto_inject
def get_telemetry(telemetry_sampler=Depends(get_telemetry_sampler)):
    """Sample throughput real-time (Mbps) dan latensi ping gateway."""
    return {
        "success": True,
        "telemetry": telemetry_sampler.sample()
    }
