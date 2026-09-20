"""WebSocket Real-Time Event Hub Route."""

import hmac
import os
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ...container import ConnectionManager
from ..deps import get_connection_manager

router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws/events")
async def websocket_events(websocket: WebSocket):
    """
    WebSocket endpoint untuk live stream telemetri, deteksi DHCP, log DNS,
    flow L7, dan event keamanan Sentinel.
    """
    # KEAMANAN (P1): tolak handshake WS tanpa token yang benar bila guard aktif.
    expected = os.getenv("SENTINEL_API_TOKEN")
    if expected:
        provided = websocket.headers.get("x-sentinel-token") or websocket.query_params.get("token")
        if not provided or not hmac.compare_digest(provided, expected):
            await websocket.close(code=1008)  # Policy Violation
            return

    manager = get_connection_manager()
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
