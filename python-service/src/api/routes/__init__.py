"""Route aggregation hub for NetCut Sentinel API."""

from .bettercap import router as bettercap_router
from .discovery import router as discovery_router
from .gaming import router as gaming_router
from .interceptor import router as interceptor_router
from .redirector import router as redirector_router
from .shield import router as shield_router
from .spoof import router as spoof_router
from .system import router as system_router
from .telemetry import router as telemetry_router
from .websocket import router as websocket_router

ALL_ROUTERS = [
    system_router,
    discovery_router,
    spoof_router,
    redirector_router,
    telemetry_router,
    interceptor_router,
    bettercap_router,
    shield_router,
    gaming_router,
    websocket_router,
]

__all__ = [
    "system_router",
    "discovery_router",
    "spoof_router",
    "redirector_router",
    "telemetry_router",
    "interceptor_router",
    "bettercap_router",
    "shield_router",
    "gaming_router",
    "websocket_router",
    "ALL_ROUTERS",
]
