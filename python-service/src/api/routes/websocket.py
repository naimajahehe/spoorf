"""WebSocket Real-Time Event Hub Route."""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ...config import verify_api_token
from ...container import ConnectionManager  # noqa: F401
from ..deps import get_connection_manager

router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws/events")
async def websocket_events(websocket: WebSocket):
    """
    WebSocket endpoint untuk live stream telemetri, deteksi DHCP, log DNS,
    flow L7, dan event keamanan Sentinel.
    """
    # KEAMANAN (P1): tolak handshake WS bila otorisasi gagal (Fail-Closed)
    provided = websocket.headers.get("x-sentinel-token") or websocket.query_params.get("token")
    ok, _reason = verify_api_token(provided)
    if not ok:
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
