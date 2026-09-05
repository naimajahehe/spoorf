"""Bounded passive identity observation for explicitly supplied LAN targets."""

from __future__ import annotations

import ipaddress
import socket
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List

from ..fingerprint import assess_device_profile
from ..fingerprint.netbios import query_netbios
from ..network import (
    get_current_gateway,
    get_network_info,
    get_self_mac,
    is_valid_mac,
    is_valid_private_ip,
    is_valid_private_network,
)
from .arp import collect_from_arp_cache, get_mac_from_arp
from .dhcp import dhcp_cache
from .ipv6_ndp import categorize_ipv6, collect_from_ndp_cache, verify_ipv6_alive
from .multicast import collect_identity_multicast

MAX_PROFILE_TARGETS = 300
MAX_PROFILE_WORKERS = 8
MIN_OBSERVATION_SECONDS = 3.0
MAX_OBSERVATION_SECONDS = 10.0
DEFAULT_OBSERVATION_SECONDS = 5.0
EVIDENCE_MAX_AGE_SECONDS = 300


class ProfileRefreshValidationError(ValueError):
    """The request or active LAN topology is unsafe for observation."""


class ProfileCollectorUnavailableError(RuntimeError):
    """No bounded identity multicast request could be delivered."""


def _normalize_mac(mac: str) -> str:
    return str(mac or "").strip().lower().replace("-", ":")


def _normalize_ipv6(address: str) -> str:
    return str(ipaddress.IPv6Address(str(address or "").split("%", 1)[0].strip()))


def _fresh_dhcp_snapshot(
    snapshot: Dict[str, Dict[str, Any]],
    now: float,
) -> Dict[str, Dict[str, Any]]:
    fresh: Dict[str, Dict[str, Any]] = {}
    for mac, entry in (snapshot or {}).items():
        if not isinstance(entry, dict):
            continue
        norm_mac = _normalize_mac(entry.get("mac") or mac)
        try:
            age = now - float(entry.get("last_seen_ts"))
        except (TypeError, ValueError):
            continue
        if 0 <= age <= EVIDENCE_MAX_AGE_SECONDS and is_valid_mac(norm_mac):
            fresh[norm_mac] = dict(entry)
    return fresh


def _sanitize_sensor_error(error: Any) -> str:
    raw = str(error).strip() or type(error).__name__
    printable = "".join(character if character.isprintable() else " " for character in raw)
    return " ".join(printable.split())[:200]


def _append_partial_failure(
    partial_failures: List[Dict[str, str]],
    sensor: str,
    error: Any,
    *,
    target: str = "",
) -> None:
    failure = {
        "sensor": _sanitize_sensor_error(sensor or "unknown")[:80],
        "error": _sanitize_sensor_error(error),
    }
    if target:
        failure["target"] = _sanitize_sensor_error(target)[:128]
    partial_failures.append(failure)


def _extend_partial_failures(
    partial_failures: List[Dict[str, str]],
    failures: Any,
) -> None:
    for failure in failures or []:
        if not isinstance(failure, dict):
            continue
        _append_partial_failure(
            partial_failures,
            failure.get("sensor") or "unknown",
            failure.get("error") or "Unknown sensor failure",
            target=str(failure.get("target") or ""),
        )


def _reverse_dns(ip: str, *, strict: bool = False) -> str:
    try:
        return str(socket.gethostbyaddr(ip)[0] or "").strip()
    except (OSError, socket.herror, socket.gaierror):
        if strict:
            raise
        return ""


def _merge_multicast_evidence(
    observations: Dict[str, Dict[str, Any]],
    addresses: List[str],
) -> Dict[str, Any]:
    merged: Dict[str, Any] = {}
    for address in addresses:
        identity = (observations or {}).get(address, {})
        if not isinstance(identity, dict):
            continue
        for key, value in identity.items():
            if not value:
                continue
            if isinstance(value, list):
                current = merged.setdefault(key, [])
                if isinstance(current, list):
                    for item in value:
                        if item not in current:
                            current.append(item)
                continue
            merged.setdefault(key, value)
    return merged


def _validate_topology() -> tuple[str, str, str, ipaddress.IPv4Network]:
    network_info = get_network_info() or {}
    controller_ip = str(network_info.get("ip") or "").strip()
    gateway_ip = str(
        get_current_gateway() or network_info.get("gateway") or ""
    ).strip()
    network_cidr = str(network_info.get("network") or "").strip()
    controller_mac = _normalize_mac(get_self_mac())

    if (
        not is_valid_private_ip(controller_ip)
        or not is_valid_private_ip(gateway_ip)
        or not is_valid_private_network(network_cidr)
        or not is_valid_mac(controller_mac)
    ):
        raise ProfileRefreshValidationError(
            "Profile refresh membutuhkan controller, gateway, dan CIDR RFC1918 yang valid"
        )

    try:
        active_network = ipaddress.IPv4Network(network_cidr, strict=False)
        if (
            ipaddress.IPv4Address(controller_ip) not in active_network
            or ipaddress.IPv4Address(gateway_ip) not in active_network
        ):
            raise ProfileRefreshValidationError(
                "Controller atau gateway berada di luar subnet aktif"
            )
    except ValueError as error:
        raise ProfileRefreshValidationError(
            "CIDR jaringan aktif tidak valid"
        ) from error

    return controller_ip, controller_mac, gateway_ip, active_network


def _normalize_targets(
    targets: List[Dict[str, Any]],
    controller_ip: str,
    controller_mac: str,
    gateway_ip: str,
    active_network: ipaddress.IPv4Network,
) -> List[Dict[str, Any]]:
    if not isinstance(targets, list):
        raise ProfileRefreshValidationError("Targets harus berupa list")
    if len(targets) > MAX_PROFILE_TARGETS:
        raise ProfileRefreshValidationError(
            f"Maksimal {MAX_PROFILE_TARGETS} target per profile refresh"
        )

    normalized: Dict[str, Dict[str, Any]] = {}
    for raw_target in targets:
        if not isinstance(raw_target, dict):
            raise ProfileRefreshValidationError("Target tidak valid")
        ip = str(raw_target.get("ip") or "").strip()
        mac = _normalize_mac(raw_target.get("mac"))
        requested_ipv6 = raw_target.get("ipv6_addresses") or []

        if not is_valid_private_ip(ip):
            raise ProfileRefreshValidationError(
                f"Target IPv4 '{ip}' bukan alamat RFC1918 yang valid"
            )
        if ipaddress.IPv4Address(ip) not in active_network:
            raise ProfileRefreshValidationError(
                f"Target IPv4 '{ip}' berada di luar subnet aktif"
            )
        if not is_valid_mac(mac):
            raise ProfileRefreshValidationError(
                f"Target MAC '{raw_target.get('mac')}' tidak valid"
            )
        if ip in {controller_ip, gateway_ip} or mac == controller_mac:
            raise ProfileRefreshValidationError(
                "Controller dan gateway tidak boleh menjadi target profile refresh"
            )
        if not isinstance(requested_ipv6, list) or len(requested_ipv6) > 8:
            raise ProfileRefreshValidationError(
                "Setiap target hanya boleh memiliki maksimal 8 alamat IPv6"
            )

        clean_ipv6 = []
        for address in requested_ipv6:
            try:
                normalized_address = _normalize_ipv6(address)
            except ValueError as error:
                raise ProfileRefreshValidationError(
                    f"Alamat IPv6 '{address}' tidak valid"
                ) from error
            if categorize_ipv6(normalized_address) not in {"link_local", "ula"}:
                raise ProfileRefreshValidationError(
                    "Profile refresh hanya menerima IPv6 link-local atau ULA"
                )
            if normalized_address not in clean_ipv6:
                clean_ipv6.append(normalized_address)

        current = normalized.get(mac)
        if current is None:
            normalized[mac] = {
                "ip": ip,
                "mac": mac,
                "ipv6_addresses": clean_ipv6,
            }
            continue
        for address in clean_ipv6:
            if address not in current["ipv6_addresses"]:
                current["ipv6_addresses"].append(address)

    return list(normalized.values())


def _capture_neighbor_snapshots(
    partial_failures: List[Dict[str, str]],
) -> tuple[Dict[str, str], Dict[str, Dict[str, Any]]]:
    arp_snapshot: Dict[str, str] = {}
    ndp_snapshot: Dict[str, Dict[str, Any]] = {}
    try:
        collect_from_arp_cache(arp_snapshot, strict=True)
    except Exception as error:
        _append_partial_failure(partial_failures, "arp_cache", error)
    try:
        collect_from_ndp_cache(ndp_snapshot, strict=True)
    except Exception as error:
        _append_partial_failure(partial_failures, "ndp_cache", error)

    return (
        {
            str(ip).strip(): _normalize_mac(mac)
            for ip, mac in arp_snapshot.items()
            if is_valid_private_ip(str(ip).strip()) and is_valid_mac(_normalize_mac(mac))
        },
        {
            _normalize_mac(mac): dict(info)
            for mac, info in ndp_snapshot.items()
            if is_valid_mac(_normalize_mac(mac)) and isinstance(info, dict)
        },
    )


def _validate_observed_target_pairs(
    targets: List[Dict[str, Any]],
    gateway_mac: str,
    ndp_snapshot: Dict[str, Dict[str, Any]],
) -> None:
    for target in targets:
        if target["mac"] == gateway_mac:
            raise ProfileRefreshValidationError(
                "Controller dan gateway tidak boleh menjadi target profile refresh"
            )
        observed_addresses = {
            _normalize_ipv6(address)
            for address in ndp_snapshot.get(target["mac"], {}).get("addresses", [])
            if address
        }
        for address in target["ipv6_addresses"]:
            if address not in observed_addresses:
                raise ProfileRefreshValidationError(
                    f"Pasangan IPv6/MAC {address} / {target['mac']} "
                    "tidak ada pada snapshot NDP saat ini"
                )


def _capture_fresh_dhcp(
    now: float,
    partial_failures: List[Dict[str, str]],
    sensor: str,
) -> Dict[str, Dict[str, Any]]:
    try:
        return _fresh_dhcp_snapshot(dhcp_cache.get_unique_snapshot(), now)
    except Exception as error:
        _append_partial_failure(partial_failures, sensor, error)
        return {}


def _collect_target_sensors(
    target: Dict[str, Any],
    controller_mac: str,
) -> Dict[str, Any]:
    failures: List[Dict[str, str]] = []
    try:
        netbios = query_netbios(target["ip"], strict=True)
    except Exception as error:
        netbios = {"hostname": "", "workgroup": "", "user": ""}
        _append_partial_failure(
            failures,
            "netbios",
            error,
            target=target["ip"],
        )
    try:
        reverse_dns = _reverse_dns(target["ip"], strict=True)
    except Exception as error:
        reverse_dns = ""
        _append_partial_failure(
            failures,
            "reverse_dns",
            error,
            target=target["ip"],
        )

    ipv6_alive: Dict[str, bool] = {}
    for address in target["ipv6_addresses"]:
        try:
            ipv6_alive[address] = bool(
                verify_ipv6_alive(
                    target["mac"],
                    address,
                    self_mac=controller_mac,
                    timeout=0.35,
                    retries=0,
                    strict=True,
                )
            )
        except Exception as error:
            ipv6_alive[address] = False
            _append_partial_failure(
                failures,
                "ipv6_liveness",
                error,
                target=address,
            )

    return {
        "netbios": netbios if isinstance(netbios, dict) else {},
        "reverse_dns": reverse_dns,
        "ipv6_alive": ipv6_alive,
        "partial_failures": failures,
    }


def _dhcpv6_identity(
    dhcp_info: Dict[str, Any],
    ndp_info: Dict[str, Any],
) -> Dict[str, Any]:
    ipv6_info = dict(ndp_info or {})
    fingerprint = str(dhcp_info.get("dhcp_fingerprint") or "")
    has_v6_identity = (
        "dhcpv6" in fingerprint.casefold()
        or bool(dhcp_info.get("ipv6"))
        or str(dhcp_info.get("message_type") or "").upper()
        in {"SOLICIT", "ADVERTISE", "CONFIRM", "RENEW", "REBIND", "REPLY"}
    )
    if has_v6_identity:
        for field in (
            "vendor_class",
            "fqdn",
            "hostname",
            "dhcp_fingerprint",
            "client_id",
        ):
            if dhcp_info.get(field):
                ipv6_info[field] = dhcp_info[field]
        if dhcp_info.get("client_id"):
            ipv6_info["duid"] = dhcp_info["client_id"]
    return ipv6_info


def _passive_ap_isolation_summary(
    targets: List[Dict[str, Any]],
    arp_snapshot: Dict[str, str],
    visible_count: int,
) -> Dict[str, Any]:
    l2_peers = sum(
        1
        for target in targets
        if arp_snapshot.get(target["ip"]) == target["mac"]
    )
    if l2_peers:
        return {
            "is_isolated": False,
            "confidence": 0.0,
            "percentage": 0,
            "status": "normal",
            "reason": f"Observed {l2_peers} requested target(s) in the current ARP cache",
            "indicators": {"l2_peers_found": l2_peers, "visible_targets": visible_count},
        }
    if visible_count:
        return {
            "is_isolated": False,
            "confidence": 0.4,
            "percentage": 40,
            "status": "possible",
            "reason": "Targets produced identity evidence without current ARP visibility",
            "indicators": {"l2_peers_found": 0, "visible_targets": visible_count},
        }
    return {
        "is_isolated": False,
        "confidence": 0.0,
        "percentage": 0,
        "status": "unknown",
        "reason": "No target visibility evidence was observed",
        "indicators": {"l2_peers_found": 0, "visible_targets": 0},
    }


def collect_profile_refresh(
    targets: List[Dict[str, Any]],
    observation_seconds: float = DEFAULT_OBSERVATION_SECONDS,
) -> Dict[str, Any]:
    """Collect one bounded, non-spoofing identity observation window."""
    started_at = time.time()
    try:
        observation_seconds = float(observation_seconds)
    except (TypeError, ValueError) as error:
        raise ProfileRefreshValidationError(
            "Observation time tidak valid"
        ) from error
    if not MIN_OBSERVATION_SECONDS <= observation_seconds <= MAX_OBSERVATION_SECONDS:
        raise ProfileRefreshValidationError(
            f"Observation time harus {MIN_OBSERVATION_SECONDS:g}-"
            f"{MAX_OBSERVATION_SECONDS:g} detik"
        )

    controller_ip, controller_mac, gateway_ip, active_network = _validate_topology()
    normalized_targets = _normalize_targets(
        targets,
        controller_ip,
        controller_mac,
        gateway_ip,
        active_network,
    )
    partial_failures: List[Dict[str, str]] = []
    arp_snapshot, ndp_snapshot = _capture_neighbor_snapshots(partial_failures)

    gateway_mac = arp_snapshot.get(gateway_ip)
    if not gateway_mac:
        try:
            gateway_mac = _normalize_mac(
                get_mac_from_arp(gateway_ip, strict=True)
            )
        except Exception as error:
            _append_partial_failure(
                partial_failures,
                "gateway_arp",
                error,
                target=gateway_ip,
            )
            gateway_mac = ""
    if not is_valid_mac(gateway_mac):
        raise ProfileRefreshValidationError(
            "MAC gateway aktif tidak dapat diverifikasi"
        )
    if gateway_mac == controller_mac:
        raise ProfileRefreshValidationError(
            "MAC controller dan gateway aktif tidak boleh sama"
        )
    _validate_observed_target_pairs(
        normalized_targets,
        gateway_mac,
        ndp_snapshot,
    )

    before_dhcp = _capture_fresh_dhcp(
        started_at,
        partial_failures,
        "dhcp_cache_initial",
    )
    try:
        multicast = collect_identity_multicast()
    except Exception as error:
        _append_partial_failure(
            partial_failures,
            "identity_multicast",
            error,
        )
        multicast = {
            "delivery": {
                "attempted": 6,
                "succeeded": 0,
                "failed": 6,
                "protocols": {},
                "errors": [],
            },
            "ssdp": {},
            "mdns": {},
            "llmnr": {},
            "partial_failures": [],
        }
    delivery = multicast.get("delivery") or {}
    multicast_delivered = int(delivery.get("succeeded") or 0) > 0
    _extend_partial_failures(
        partial_failures,
        multicast.get("partial_failures"),
    )
    if not multicast_delivered and not any(
        failure.get("sensor") == "identity_multicast"
        for failure in partial_failures
    ):
        _append_partial_failure(
            partial_failures,
            "identity_multicast",
            "No identity multicast request was delivered",
        )

    time.sleep(observation_seconds)
    after_time = time.time()
    after_dhcp = _capture_fresh_dhcp(
        after_time,
        partial_failures,
        "dhcp_cache_final",
    )
    dhcp_by_mac = dict(before_dhcp)
    dhcp_by_mac.update(after_dhcp)

    submitted = []
    with ThreadPoolExecutor(max_workers=MAX_PROFILE_WORKERS) as pool:
        for target in normalized_targets:
            submitted.append(
                (
                    target,
                    pool.submit(_collect_target_sensors, target, controller_mac),
                )
            )

        sensor_results: Dict[str, Dict[str, Any]] = {}
        for target, future in submitted:
            try:
                sensor_results[target["mac"]] = future.result()
            except Exception as error:
                sensor_results[target["mac"]] = {
                    "netbios": {},
                    "reverse_dns": "",
                    "ipv6_alive": {},
                    "partial_failures": [],
                }
                _append_partial_failure(
                    partial_failures,
                    "target_observation",
                    error,
                    target=target["ip"],
                )

    observed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    devices = []
    source_counts: Dict[str, int] = {}
    status_counts = {"high": 0, "medium": 0, "unknown": 0}
    hostname_count = 0
    visible_count = 0

    for target in normalized_targets:
        mac = target["mac"]
        ip = target["ip"]
        sensors = sensor_results[mac]
        _extend_partial_failures(
            partial_failures,
            sensors["partial_failures"],
        )
        dhcp_info = dhcp_by_mac.get(mac, {})
        ndp_info = ndp_snapshot.get(mac, {})
        ipv6_info = _dhcpv6_identity(dhcp_info, ndp_info)
        multicast_addresses = [ip, *target["ipv6_addresses"]]
        mdns_info = _merge_multicast_evidence(
            multicast.get("mdns") or {},
            multicast_addresses,
        )
        ssdp_info = _merge_multicast_evidence(
            multicast.get("ssdp") or {},
            multicast_addresses,
        )
        llmnr_info = _merge_multicast_evidence(
            multicast.get("llmnr") or {},
            multicast_addresses,
        )
        netbios_info = dict(sensors["netbios"])
        if not netbios_info.get("hostname") and llmnr_info.get("hostname"):
            netbios_info["hostname"] = llmnr_info["hostname"]

        assessment = assess_device_profile(
            ip=ip,
            mac=mac,
            is_gateway=False,
            dhcp_info=dhcp_info,
            mdns_info=mdns_info,
            ssdp_info=ssdp_info,
            netbios_info=netbios_info,
            reverse_dns=sensors["reverse_dns"],
            ttl=None,
            open_ports=[],
            services=[],
            ipv6_info=ipv6_info,
            observed_at=observed_at,
        )

        observed_sources = set()
        if arp_snapshot.get(ip) == mac:
            observed_sources.add("ARP")
        if target["ipv6_addresses"]:
            observed_sources.add("NDP")
        if dhcp_info:
            observed_sources.add("DHCP")
        if _dhcpv6_identity(dhcp_info, {}).keys():
            observed_sources.add("DHCPv6")
        if ssdp_info:
            observed_sources.add("SSDP")
        if mdns_info:
            observed_sources.add("mDNS")
        if llmnr_info:
            observed_sources.add("LLMNR")
        if any(netbios_info.values()):
            observed_sources.add("NetBIOS")
        if sensors["reverse_dns"]:
            observed_sources.add("Reverse DNS")
        if any(sensors["ipv6_alive"].values()):
            observed_sources.add("IPv6 Liveness")
        visible = bool(observed_sources)
        for item in assessment.get("profile_evidence", []):
            source = str(item.get("source") or "").strip()
            if source:
                observed_sources.add(source)

        if visible:
            visible_count += 1
        status = assessment.get("profile_status")
        if status not in status_counts:
            status = "unknown"
        status_counts[status] += 1
        hostname = str(assessment.get("hostname") or "").strip()
        if hostname and hostname.casefold() != "unknown":
            hostname_count += 1
        for source in observed_sources:
            source_counts[source] = source_counts.get(source, 0) + 1

        devices.append({
            "ip": ip,
            "mac": mac,
            "ipv6_addresses": list(target["ipv6_addresses"]),
            "visible": visible,
            "observed_sources": sorted(observed_sources),
            "ipv6_liveness": sensors["ipv6_alive"],
            **assessment,
        })

    if not multicast_delivered and visible_count == 0:
        raise ProfileCollectorUnavailableError(
            "Tidak ada collector yang menghasilkan observasi profile yang dapat digunakan"
        )

    profiled_count = status_counts["high"] + status_counts["medium"]
    coverage_percentage = (
        round(profiled_count * 100 / len(devices))
        if devices
        else None
    )
    duration_ms = max(0, round((time.time() - started_at) * 1000))
    return {
        "visible_count": visible_count,
        "high_confidence_count": status_counts["high"],
        "medium_confidence_count": status_counts["medium"],
        "unknown_count": status_counts["unknown"],
        "hostname_count": hostname_count,
        "coverage_percentage": coverage_percentage,
        "sources": dict(sorted(source_counts.items())),
        "ap_isolation": _passive_ap_isolation_summary(
            normalized_targets,
            arp_snapshot,
            visible_count,
        ),
        "partial_failures": partial_failures,
        "duration_ms": duration_ms,
        "devices": devices,
    }


__all__ = [
    "DEFAULT_OBSERVATION_SECONDS",
    "EVIDENCE_MAX_AGE_SECONDS",
    "MAX_OBSERVATION_SECONDS",
    "MAX_PROFILE_TARGETS",
    "MAX_PROFILE_WORKERS",
    "MIN_OBSERVATION_SECONDS",
    "ProfileCollectorUnavailableError",
    "ProfileRefreshValidationError",
    "collect_profile_refresh",
]
