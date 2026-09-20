"""L7 Traffic Interception, Dynamic TLS CA & Flow Analytics Routes."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Response

from ...utils.logger import logger
from ..deps import auto_inject, get_cert_engine, get_flow_manager
from ..schemas import LeafCertRequest

router = APIRouter(tags=["Interceptor"])


@router.get("/api/interceptor/ca")
@auto_inject
def get_interceptor_ca_status(cert_engine=Depends(get_cert_engine)):
    """Status Root CA dinamis untuk inspeksi HTTPS."""
    return {
        "success": True,
        "data": cert_engine.get_ca_info()
    }


@router.get("/api/interceptor/ca/cert")
@auto_inject
def download_interceptor_ca_cert(cert_engine=Depends(get_cert_engine)):
    """Unduh sertifikat publik Root CA (spoorf-ca.crt)."""
    pem_bytes = cert_engine.get_ca_cert_pem()
    return Response(
        content=pem_bytes,
        media_type="application/x-x509-ca-cert",
        headers={
            "Content-Disposition": "attachment; filename=spoorf-ca.crt"
        }
    )


@router.post("/api/interceptor/cert/leaf")
@auto_inject
def generate_leaf_certificate(
    req: LeafCertRequest,
    cert_engine=Depends(get_cert_engine),
):
    """Generate leaf certificate dinamis untuk domain tertentu."""
    try:
        key_pem, cert_pem = cert_engine.generate_leaf_cert(req.domain)
        return {
            "success": True,
            "domain": req.domain,
            "cert": cert_pem.decode("utf-8"),
            "key": key_pem.decode("utf-8")
        }
    except Exception as e:
        logger.error(f"Error generating leaf cert for {req.domain}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/interceptor/flows")
@auto_inject
def get_interceptor_flows(
    limit: int = 100,
    search: Optional[str] = None,
    scheme: Optional[str] = None,
    method: Optional[str] = None,
    is_blocked: Optional[bool] = None,
    flow_manager=Depends(get_flow_manager),
):
    """Monitoring aliran paket L7 (HTTP/HTTPS/DNS)."""
    return {
        "success": True,
        "stats": flow_manager.get_stats(),
        "flows": flow_manager.get_flows(
            limit=limit,
            search=search,
            scheme=scheme,
            method=method,
            is_blocked=is_blocked
        )
    }


@router.delete("/api/interceptor/flows")
@auto_inject
def clear_interceptor_flows(flow_manager=Depends(get_flow_manager)):
    """Bersihkan riwayat aliran paket L7."""
    flow_manager.clear()
    return {
        "success": True,
        "message": "L7 Flows cleared"
    }
