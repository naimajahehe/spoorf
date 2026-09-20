"""Captive Portal Redirection, Transparent Gateway & DNS Sinkhole Routes."""

from fastapi import APIRouter, Depends, HTTPException

from ...utils.logger import logger
from ..deps import (
    auto_inject,
    get_connection_manager,
    get_redirect_manager,
    get_transparent_gateway,
)
from ..schemas import (
    GatewayStartRequest,
    GatewayStopRequest,
    RedirectStartRequest,
    RedirectStopRequest,
    SinkholeDomainRequest,
)

router = APIRouter(tags=["Redirector & Gateway"])


# ===== REDIRECT (CAPTIVE PORTAL) ROUTES =====
@router.get("/api/redirect/status")
@auto_inject
def get_redirect_status(redirect_manager=Depends(get_redirect_manager)):
    """Status seluruh sesi captive portal aktif."""
    return {
        "success": True,
        "sessions": redirect_manager.get_sessions()
    }


@router.post("/api/redirect/start")
@auto_inject
def start_redirect(
    req: RedirectStartRequest,
    redirect_manager=Depends(get_redirect_manager),
):
    """Mulai captive portal redirection untuk target IP."""
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


@router.post("/api/redirect/stop")
@auto_inject
def stop_redirect(
    req: RedirectStopRequest,
    redirect_manager=Depends(get_redirect_manager),
):
    """Hentikan captive portal redirection untuk target IP."""
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


# ===== TRANSPARENT GATEWAY & DNS SINKHOLE ROUTES =====
@router.get("/api/gateway/status")
@auto_inject
def get_gateway_status(transparent_gateway=Depends(get_transparent_gateway)):
    """Status transparent gateway dan sesi inspeksi lalu lintas."""
    return {
        "success": True,
        "data": transparent_gateway.get_status()
    }


@router.post("/api/gateway/start")
@auto_inject
def start_transparent_gateway(
    req: GatewayStartRequest,
    transparent_gateway=Depends(get_transparent_gateway),
    manager=Depends(get_connection_manager),
):
    """Mulai transparent gateway untuk target IP."""
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


@router.post("/api/gateway/stop")
@auto_inject
def stop_transparent_gateway(
    req: GatewayStopRequest,
    transparent_gateway=Depends(get_transparent_gateway),
    manager=Depends(get_connection_manager),
):
    """Hentikan transparent gateway untuk target IP."""
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


@router.get("/api/gateway/sinkhole")
@auto_inject
def get_gateway_sinkholes(transparent_gateway=Depends(get_transparent_gateway)):
    """Daftar seluruh domain dalam sinkhole DNS."""
    return {
        "success": True,
        "domains": transparent_gateway.get_sinkhole_domains()
    }


@router.post("/api/gateway/sinkhole/add")
@auto_inject
def add_gateway_sinkhole(
    req: SinkholeDomainRequest,
    transparent_gateway=Depends(get_transparent_gateway),
):
    """Tambahkan domain ke daftar sinkhole DNS."""
    success = transparent_gateway.add_sinkhole_domain(req.domain)
    return {
        "success": success,
        "domain": req.domain,
        "domains": transparent_gateway.get_sinkhole_domains()
    }


@router.post("/api/gateway/sinkhole/remove")
@auto_inject
def remove_gateway_sinkhole(
    req: SinkholeDomainRequest,
    transparent_gateway=Depends(get_transparent_gateway),
):
    """Hapus domain dari daftar sinkhole DNS."""
    success = transparent_gateway.remove_sinkhole_domain(req.domain)
    return {
        "success": success,
        "domain": req.domain,
        "domains": transparent_gateway.get_sinkhole_domains()
    }


@router.get("/api/gateway/dns-logs")
@auto_inject
def get_gateway_dns_logs(
    limit: int = 100,
    transparent_gateway=Depends(get_transparent_gateway),
):
    """Ambil riwayat log DNS query yang tertangkap."""
    return {
        "success": True,
        "logs": transparent_gateway.get_dns_logs(limit=limit)
    }


@router.delete("/api/gateway/dns-logs")
@auto_inject
def clear_gateway_dns_logs(transparent_gateway=Depends(get_transparent_gateway)):
    """Bersihkan riwayat log DNS query."""
    transparent_gateway.clear_dns_logs()
    return {
        "success": True,
        "message": "DNS logs cleared"
    }
