"""Bettercap Security Suite: DNS Spoofer, Packet Dissector & Fast SYN Scan Routes."""

from fastapi import APIRouter, Depends, HTTPException

from ...core.network import is_valid_private_ip
from ...utils.logger import logger
from ..deps import (
    auto_inject,
    get_bettercap_dissector,
    get_bettercap_dns,
    get_bettercap_syn_scanner,
    get_transparent_gateway,
)
from ..schemas import (
    DnsHostsRequest,
    DnsSpoofAddRequest,
    DnsSpoofAllRequest,
    DnsSpoofUpdateRequest,
    DnsTtlRequest,
    SynScanRequest,
)

router = APIRouter(tags=["Bettercap"])


@router.get("/api/bettercap/status")
@auto_inject
def get_bettercap_status(
    transparent_gateway=Depends(get_transparent_gateway),
    bettercap_dns=Depends(get_bettercap_dns),
    bettercap_dissector=Depends(get_bettercap_dissector),
):
    """Status umum modul security Bettercap."""
    gw_status = transparent_gateway.get_status()
    return {
        "success": True,
        "dns_rules_count": len(bettercap_dns.get_all_rules()),
        "sniffed_credentials_count": len(bettercap_dissector.get_history(limit=500)),
        "active_gateway_sessions": gw_status.get(
            "active_count", len(gw_status.get("active_sessions", {}))
        ),
    }


@router.get("/api/bettercap/dns/rules")
@auto_inject
def get_bettercap_dns_rules(bettercap_dns=Depends(get_bettercap_dns)):
    """Daftar seluruh rule DNS spoofing aktif."""
    return {
        "success": True,
        "rules": bettercap_dns.get_all_rules(),
        "spoof_all_enabled": bettercap_dns.spoof_all_enabled,
        "spoof_all_address": bettercap_dns.spoof_all_address,
        "default_ttl": bettercap_dns.default_ttl,
    }


@router.post("/api/bettercap/dns/spoof-all")
@auto_inject
def set_bettercap_dns_spoof_all(
    req: DnsSpoofAllRequest,
    bettercap_dns=Depends(get_bettercap_dns),
):
    """Toggle catch-all DNS spoofing (palsukan semua domain ke satu IP)."""
    state = bettercap_dns.set_spoof_all(req.enabled, req.address)
    return {"success": True, **state}


@router.post("/api/bettercap/dns/hosts")
@auto_inject
def load_bettercap_dns_hosts(
    req: DnsHostsRequest,
    bettercap_dns=Depends(get_bettercap_dns),
):
    """Muat mapping hosts domain->IP dari file atau konten inline."""
    if req.content is not None:
        count = bettercap_dns.load_hosts_content(req.content, req.default_address, req.action)
    elif req.path:
        count = bettercap_dns.load_hosts_file(req.path, req.default_address, req.action)
    else:
        raise HTTPException(status_code=400, detail="Sertakan 'path' atau 'content'")
    return {"success": True, "loaded": count, "rules": bettercap_dns.get_all_rules()}


@router.post("/api/bettercap/dns/ttl")
@auto_inject
def set_bettercap_dns_ttl(
    req: DnsTtlRequest,
    bettercap_dns=Depends(get_bettercap_dns),
):
    """Set default TTL (Time-to-Live) untuk jawaban DNS palsu."""
    ttl = bettercap_dns.set_default_ttl(req.ttl)
    return {"success": True, "default_ttl": ttl}


@router.post("/api/bettercap/dns/rules")
@auto_inject
def add_bettercap_dns_rule(
    req: DnsSpoofAddRequest,
    bettercap_dns=Depends(get_bettercap_dns),
):
    """Tambah aturan pemalsuan DNS baru."""
    rule = bettercap_dns.add_rule(
        domain=req.domain,
        target_ip=req.target_ip,
        action=req.action,
        is_enabled=req.is_enabled,
    )
    return {
        "success": True,
        "rule": rule.to_dict(),
        "rules": bettercap_dns.get_all_rules(),
    }


@router.put("/api/bettercap/dns/rules/{rule_id}")
@auto_inject
def update_bettercap_dns_rule(
    rule_id: str,
    req: DnsSpoofUpdateRequest,
    bettercap_dns=Depends(get_bettercap_dns),
):
    """Perbarui aturan pemalsuan DNS yang ada."""
    rule = bettercap_dns.update_rule(
        rule_id=rule_id,
        domain=req.domain,
        target_ip=req.target_ip,
        action=req.action,
        is_enabled=req.is_enabled,
    )
    if not rule:
        raise HTTPException(status_code=404, detail=f"Rule {rule_id} not found")
    return {
        "success": True,
        "rule": rule.to_dict(),
        "rules": bettercap_dns.get_all_rules(),
    }


@router.delete("/api/bettercap/dns/rules/{rule_id}")
@auto_inject
def delete_bettercap_dns_rule(
    rule_id: str,
    bettercap_dns=Depends(get_bettercap_dns),
):
    """Hapus aturan pemalsuan DNS."""
    success = bettercap_dns.delete_rule(rule_id)
    return {
        "success": success,
        "rules": bettercap_dns.get_all_rules(),
    }


@router.get("/api/bettercap/credentials")
@auto_inject
def get_bettercap_credentials(
    limit: int = 100,
    bettercap_dissector=Depends(get_bettercap_dissector),
):
    """Riwayat kredensial plain-text yang tersniff dari jaringan."""
    return {
        "success": True,
        "credentials": bettercap_dissector.get_history(limit=limit),
    }


@router.delete("/api/bettercap/credentials")
@auto_inject
def clear_bettercap_credentials(bettercap_dissector=Depends(get_bettercap_dissector)):
    """Bersihkan riwayat kredensial."""
    bettercap_dissector.clear()
    return {
        "success": True,
        "message": "Bettercap credentials cleared",
    }


@router.post("/api/bettercap/syn-scan")
@auto_inject
def run_bettercap_syn_scan(
    req: SynScanRequest,
    bettercap_syn_scanner=Depends(get_bettercap_syn_scanner),
):
    """Eksekusi Fast Raw TCP SYN Scan (RFC 1918 Private IP Scope strictly enforced)."""
    if not is_valid_private_ip(req.target_ip):
        raise HTTPException(
            status_code=400,
            detail=f"Target IP '{req.target_ip}' bukan alamat IP privat yang sah (RFC 1918)",
        )
    try:
        result = bettercap_syn_scanner.scan_host(
            target_ip=req.target_ip,
            ports=req.ports,
            profile=req.profile,
        )
        return {
            "success": True,
            "data": result,
        }
    except Exception as e:
        logger.error(f"Error executing Bettercap SYN scan: {e}")
        raise HTTPException(status_code=500, detail=str(e))
