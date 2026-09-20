"""Network Discovery, Scanning, Liveness Pulse & DHCP Profiling Routes."""

import asyncio
import ipaddress
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from ...core.discovery import (
    collect_profile_refresh,
    dhcp_cache,
    pulse_batch,
    send_multicast_wakeup,
)
from ...core.discovery.dhcp import diff_dhcp_profiles
from ...core.discovery.profile_observation import (
    ProfileCollectorUnavailableError,
    ProfileRefreshValidationError,
)
from ...core.fingerprint.probe import deep_scan_ports
from ...core.network import (
    get_current_gateway,
    get_network_info,
    get_self_mac,
    is_valid_mac,
    is_valid_private_ip,
    is_valid_private_network,
)
from ...utils.logger import logger
from ..deps import (
    auto_inject,
    get_executor,
    get_liveness_daemon,
    get_scanner,
)
from ..schemas import (
    DeepPortScanRequest,
    LivenessPulseRequest,
    ProfileRefreshRequest,
    ProfileRefreshTarget,
    QuickReauthRequest,
    ScanRequest,
)

router = APIRouter(tags=["Discovery"])


def _filter_dhcp_observation_snapshot(
    snapshot: Dict[str, Dict[str, Any]],
    controller_ip: str,
    gateway_ip: str,
    controller_mac: str,
) -> Dict[str, Dict[str, Any]]:
    """Exclude controller and gateway infrastructure from target profile metrics."""
    normalized_self_mac = controller_mac.lower().replace("-", ":")
    excluded_ips = {controller_ip, gateway_ip}
    return {
        mac: entry
        for mac, entry in snapshot.items()
        if mac.lower().replace("-", ":") != normalized_self_mac
        and str(entry.get("ip") or "").strip() not in excluded_ips
    }


def _profile_target_payloads(
    targets: List[ProfileRefreshTarget],
) -> List[Dict[str, Any]]:
    payloads = [target.model_dump() for target in targets]
    for target in payloads:
        if not is_valid_private_ip(target["ip"]):
            raise HTTPException(
                status_code=400,
                detail=f"Target IPv4 '{target['ip']}' bukan alamat RFC1918 yang valid",
            )
        if not is_valid_mac(target["mac"]):
            raise HTTPException(
                status_code=400,
                detail=f"Target MAC '{target['mac']}' tidak valid",
            )
        for address in target["ipv6_addresses"]:
            try:
                ipv6 = ipaddress.IPv6Address(address.split("%", 1)[0].strip())
            except ValueError as error:
                raise HTTPException(
                    status_code=400,
                    detail=f"Alamat IPv6 '{address}' tidak valid",
                ) from error
            if not (ipv6.is_link_local or ipv6 in ipaddress.IPv6Network("fc00::/7")):
                raise HTTPException(
                    status_code=400,
                    detail="Profile refresh hanya menerima IPv6 link-local atau ULA",
                )
    return payloads


async def _run_profile_refresh(
    targets: List[ProfileRefreshTarget],
    observation_seconds: float,
    executor=None,
) -> Dict[str, Any]:
    payloads = _profile_target_payloads(targets)
    running_loop = asyncio.get_running_loop()
    try:
        return await running_loop.run_in_executor(
            executor,
            collect_profile_refresh,
            payloads,
            float(observation_seconds),
        )
    except ProfileRefreshValidationError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ProfileCollectorUnavailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Profile refresh failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/wifi")
@auto_inject
def get_wifi_status(scanner=Depends(get_scanner)):
    """Ambil status Wi-Fi adapter dari OS."""
    wifi = scanner.get_wifi_info()
    return {
        "success": True,
        "wifi": wifi
    }


@router.post("/api/scan")
@auto_inject
async def scan_network(
    req: Optional[ScanRequest] = None,
    scanner=Depends(get_scanner),
    liveness_daemon=Depends(get_liveness_daemon),
    executor=Depends(get_executor),
):
    """Eksekusi scan jaringan di ThreadPool terpisah non-blocking."""
    logger.info("📥 [HTTP API] Request scan_network diterima")
    running_loop = asyncio.get_running_loop()
    try:
        liveness_daemon.set_scanning_active(True)
        skip_multicast_wakeup = bool(req and req.skip_multicast_wakeup)
        devices = await running_loop.run_in_executor(
            executor,
            lambda: scanner.scan_full(
                include_multicast_wakeup=not skip_multicast_wakeup
            ),
        )
        try:
            liveness_daemon.update_tracked_devices(devices)
        except Exception:
            pass
        return {
            "success": True,
            "data": {
                "devices": devices,
                "count": len(devices),
                "ap_isolation": scanner.get_ap_isolation()
            }
        }
    except Exception as e:
        logger.error(f"Scan failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        liveness_daemon.set_scanning_active(False)


@router.post("/api/liveness/pulse")
@auto_inject
async def pulse_devices_liveness(req: LivenessPulseRequest):
    """
    Sub-second Multi-Vector Unicast Liveness Pulse Endpoint (< 0.75s).
    Menguji status online/offline kumpulan perangkat secara paralel.
    """
    try:
        results = pulse_batch(
            targets=req.targets,
            gateway_ip=req.gateway_ip,
            timeout=req.timeout or 3.0
        )
        return {
            "success": True,
            "data": {
                "results": results
            }
        }
    except Exception as e:
        logger.error(f"Error during liveness pulse: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/scan/ports")
@auto_inject
async def deep_scan_device_ports(
    req: DeepPortScanRequest,
    executor=Depends(get_executor),
):
    """Eksekusi multi-threaded deep port scanner untuk target IP tertentu."""
    if not is_valid_private_ip(req.ip):
        raise HTTPException(
            status_code=400,
            detail=f"Target IP '{req.ip}' bukan alamat IP privat yang sah (RFC 1918)"
        )

    logger.info(f"📥 [HTTP API] Request deep_scan_ports untuk {req.ip}")
    running_loop = asyncio.get_running_loop()
    try:
        result = await running_loop.run_in_executor(
            executor,
            deep_scan_ports,
            req.ip,
            req.ports
        )
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        logger.error(f"Deep port scan failed for {req.ip}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/dhcp/wakeup")
@auto_inject
async def trigger_dhcp_wakeup(executor=Depends(get_executor)):
    """Refresh discovery dan observasi DHCP alami untuk Optimasi Teknik 3B."""
    logger.info("📥 [HTTP API] Request Discovery Refresh & DHCP Observation diterima")
    network_info = get_network_info()
    controller_ip = str(network_info.get("ip") or "").strip()
    network_cidr = str(network_info.get("network") or "").strip()
    gateway_ip = str(get_current_gateway() or "").strip()

    if (
        not is_valid_private_ip(controller_ip)
        or not is_valid_private_network(network_cidr)
        or not is_valid_private_ip(gateway_ip)
    ):
        raise HTTPException(
            status_code=400,
            detail="Discovery Refresh membutuhkan topologi IPv4 RFC1918 yang valid",
        )

    try:
        active_network = ipaddress.IPv4Network(network_cidr, strict=False)
        if (
            ipaddress.IPv4Address(controller_ip) not in active_network
            or ipaddress.IPv4Address(gateway_ip) not in active_network
        ):
            raise HTTPException(
                status_code=400,
                detail="Controller atau gateway berada di luar subnet aktif",
            )
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail="CIDR jaringan aktif tidak valid",
        ) from error

    running_loop = asyncio.get_running_loop()
    try:
        controller_mac = get_self_mac() or ""
        before = _filter_dhcp_observation_snapshot(
            dhcp_cache.get_unique_snapshot(),
            controller_ip,
            gateway_ip,
            controller_mac,
        )
        delivery = await running_loop.run_in_executor(
            executor,
            send_multicast_wakeup,
        )
        if delivery.get("succeeded", 0) <= 0:
            raise HTTPException(
                status_code=503,
                detail="Tidak ada datagram discovery yang berhasil dikirim",
            )

        await asyncio.sleep(4.0)
        after = _filter_dhcp_observation_snapshot(
            dhcp_cache.get_unique_snapshot(),
            controller_ip,
            gateway_ip,
            controller_mac,
        )
        dhcp_delta = diff_dhcp_profiles(before, after)
        return {
            "success": True,
            "message": "Discovery refresh transmitted; DHCP observation window completed",
            "data": {
                "delivery": delivery,
                "dhcp_delta": dhcp_delta,
                "dhcp_profiled_count": len(after),
                "snapshot": after,
                "observation_seconds": 4.0,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Discovery refresh failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/network/profile-refresh")
@auto_inject
async def profile_refresh(
    req: ProfileRefreshRequest,
    executor=Depends(get_executor),
):
    """Koleksi profil sensor pasif berwaktu terbatas."""
    logger.info(
        f"📥 [HTTP API] Request profile-refresh untuk {len(req.targets)} target "
        f"({req.observation_seconds:.1f}s)"
    )
    data = await _run_profile_refresh(req.targets, req.observation_seconds, executor=executor)
    return {"success": True, "data": data}


@router.post("/api/network/quick-reauth")
@auto_inject
async def quick_reauth_profiling(
    req: QuickReauthRequest,
    executor=Depends(get_executor),
):
    """Deprecated compatibility alias for safe passive profile observation."""
    logger.info(
        f"📥 [HTTP API] Deprecated quick-reauth alias untuk {len(req.targets)} target"
    )
    targets = [
        ProfileRefreshTarget(
            ip=target.victim_ip,
            mac=target.victim_mac,
            ipv6_addresses=[target.victim_ipv6] if target.victim_ipv6 else [],
        )
        for target in req.targets
    ]
    observation_seconds = max(3.0, min(10.0, req.hold_ms / 1000.0))
    data = await _run_profile_refresh(targets, observation_seconds, executor=executor)
    return {"success": True, "deprecated": True, "data": data}


@router.get("/api/dhcp/stats")
@auto_inject
def get_dhcp_profiling_stats():
    """Mengambil status snapshot profiling DHCP real-time."""
    snapshot = dhcp_cache.get_snapshot()
    return {
        "success": True,
        "data": {
            "count": len(snapshot),
            "snapshot": snapshot
        }
    }


@router.get("/api/network/ap-isolation")
@auto_inject
def get_ap_isolation_status(scanner=Depends(get_scanner)):
    """Mengambil status diagnostik evaluasi AP Isolation terkini."""
    return {
        "success": True,
        "data": scanner.get_ap_isolation()
    }
