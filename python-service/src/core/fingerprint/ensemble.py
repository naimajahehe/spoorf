"""
Explainable multi-sensor device profile synthesis.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from .evidence import ProfileEvidence
from .os_detect import detect_os
from .oui_registry import get_oui_record
from .profile_rules import (
    COMPONENT_ONLY_VENDORS,
    canonicalize_vendor,
    device_type_candidates,
    vendor_candidates,
)
from .vendors import is_randomized_mac


_BROAD_CONSUMER_VENDORS = {"Apple", "Samsung"}
_OUI_DEVICE_TYPES = {
    "Lenovo": "PC / Laptop",
    "Dell": "PC / Laptop",
    "HP": "PC / Laptop",
    "ASUS": "PC / Laptop",
    "Acer": "PC / Laptop",
    "Microsoft": "PC / Laptop",
    "TP-Link": "Network Infrastructure",
    "MikroTik": "Network Infrastructure",
    "Ubiquiti": "Network Infrastructure",
    "Espressif": "IP Camera / IoT",
    "Raspberry Pi": "IP Camera / IoT",
    "Epson": "Printer",
    "Canon": "Printer",
    "Brother": "Printer",
    "HP Printer": "Printer",
}


class _CandidateScores:
    def __init__(self) -> None:
        self._scores: dict[str, dict[str, int]] = {}

    def add(self, candidate: str, group: str, points: int) -> None:
        if not candidate or candidate == "Unknown":
            return
        groups = self._scores.setdefault(candidate, {})
        groups[group] = max(points, groups.get(group, 0))

    def select(self) -> tuple[str, int, set[str], bool]:
        if not self._scores:
            return "Unknown", 0, set(), False
        ranked = sorted(
            (
                (min(sum(groups.values()), 100), candidate, set(groups))
                for candidate, groups in self._scores.items()
            ),
            reverse=True,
        )
        score, candidate, groups = ranked[0]
        tied = len(ranked) > 1 and ranked[1][0] == score
        if tied:
            return "Unknown", score, set(), True
        return candidate, score, groups, False


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _add_evidence(
    records: list[ProfileEvidence],
    *,
    source: str,
    group: str,
    field: str,
    value: Any,
    strength: str,
    observed_at: str,
) -> None:
    rendered = _text(value)
    if rendered:
        records.append(ProfileEvidence(
            source=source,
            group=group,
            field=field,
            value=rendered,
            strength=strength,
            observed_at=observed_at,
        ))


def _add_identity_scores(
    *,
    vendor_scores: _CandidateScores,
    type_scores: _CandidateScores,
    hostname_scores: _CandidateScores,
    source: str,
    info: dict,
    manufacturer_keys: tuple[str, ...],
    model_keys: tuple[str, ...],
    hostname_keys: tuple[str, ...],
    observed_at: str,
    evidence: list[ProfileEvidence],
) -> list[str]:
    manufacturer = next((_text(info.get(key)) for key in manufacturer_keys if _text(info.get(key))), "")
    model = next((_text(info.get(key)) for key in model_keys if _text(info.get(key))), "")
    hostname = next((_text(info.get(key)) for key in hostname_keys if _text(info.get(key))), "")
    combined = " / ".join(value for value in (manufacturer, model) if value)
    explicit = bool(manufacturer and model)
    group = "explicit_identity" if explicit else source.casefold()
    points = 85 if explicit else 60
    hostname_points = 45 if explicit else 35

    if combined:
        _add_evidence(
            evidence,
            source=source,
            group=group,
            field="manufacturer_model" if explicit else "manufacturer_or_model",
            value=combined,
            strength="explicit" if explicit else "strong",
            observed_at=observed_at,
        )
    if hostname:
        _add_evidence(
            evidence,
            source=source,
            group=group,
            field="hostname",
            value=hostname,
            strength="strong" if explicit else "medium",
            observed_at=observed_at,
        )
        hostname_scores.add(hostname, group, hostname_points)

    identity_text = " ".join(value for value in (manufacturer, model) if value)
    if identity_text:
        vendors = vendor_candidates(manufacturer, model)
        canonical_manufacturer = canonicalize_vendor(manufacturer)
        if (
            manufacturer
            and canonical_manufacturer != "Unknown"
            and canonical_manufacturer not in vendors
        ):
            vendors.insert(0, canonical_manufacturer)
        for vendor in vendors:
            vendor_scores.add(vendor, group, points)
        for device_type in device_type_candidates(
            identity_text,
            vendor=vendors[0] if len(vendors) == 1 else "",
        ):
            type_scores.add(device_type, group, points)
    return [value for value in (manufacturer, model, hostname) if value]


def _add_dhcp_scores(
    *,
    vendor_scores: _CandidateScores,
    type_scores: _CandidateScores,
    hostname_scores: _CandidateScores,
    info: dict,
    source: str,
    group: str,
    observed_at: str,
    evidence: list[ProfileEvidence],
) -> list[str]:
    values = []
    for field in ("vendor_class", "fqdn", "hostname", "dhcp_fingerprint"):
        value = _text(info.get(field))
        if not value:
            continue
        values.append(value)
        _add_evidence(
            evidence,
            source=source,
            group=group,
            field=field,
            value=value,
            strength="medium",
            observed_at=observed_at,
        )

    identity_text = " ".join(values)
    vendors = vendor_candidates(*values)
    for vendor in vendors:
        vendor_scores.add(vendor, group, 45)
    for device_type in device_type_candidates(
        identity_text,
        vendor=vendors[0] if len(vendors) == 1 else "",
    ):
        type_scores.add(device_type, group, 50)

    hostname = _text(info.get("hostname")) or _text(info.get("fqdn"))
    if hostname:
        hostname_scores.add(hostname, group, 60)
    return values


def _infer_os(
    *,
    vendor: str,
    device_type: str,
    hostname: str,
    is_gateway: bool,
    ttl: Optional[int],
    open_ports: list[int],
    services: list[str],
    dhcp_info: dict,
) -> str:
    identity = " ".join((
        vendor,
        device_type,
        hostname,
        _text(dhcp_info.get("vendor_class")),
        _text(dhcp_info.get("dhcp_fingerprint")),
    )).casefold()
    if is_gateway or device_type in {"Router / Gateway", "Network Infrastructure"}:
        return "Linux / RouterOS"
    if any(token in identity for token in ("macbook", "imac", "macos")):
        return "macOS (Apple)"
    if any(token in identity for token in ("iphone", "ipad", "apple ios")):
        return "iOS (Apple)"
    if device_type == "Smartphone / Tablet" and vendor != "Apple":
        return "Android OS"
    if device_type == "PC / Laptop" and (
        445 in open_ports
        or any(service.casefold() in {"smb", "microsoft-ds"} for service in services)
        or "msft" in identity
        or (ttl is not None and 96 <= ttl <= 128)
    ):
        return "Windows"
    if device_type == "IP Camera / IoT":
        return "Linux / Embedded"

    port_map = {
        port: services[index] if index < len(services) else str(port)
        for index, port in enumerate(open_ports)
    }
    return detect_os(
        {"alive": ttl is not None, "ttl": ttl or 0},
        port_map,
        vendor,
        hostname,
        is_gateway,
    )


def assess_device_profile(
    *,
    ip: str,
    mac: str,
    is_gateway: bool,
    dhcp_info: dict,
    mdns_info: dict,
    ssdp_info: dict,
    netbios_info: dict,
    reverse_dns: str,
    ttl: Optional[int],
    open_ports: list[int],
    services: list[str],
    ipv6_info: dict,
    observed_at: str,
) -> dict:
    vendor_scores = _CandidateScores()
    type_scores = _CandidateScores()
    hostname_scores = _CandidateScores()
    evidence: list[ProfileEvidence] = []
    identity_values: list[str] = []

    if mac and not is_randomized_mac(mac):
        oui_record = get_oui_record(mac)
        if oui_record:
            oui_vendor = canonicalize_vendor(oui_record.organization)
            _add_evidence(
                evidence,
                source="OUI",
                group="oui",
                field="organization",
                value=oui_record.organization,
                strength="strong",
                observed_at=observed_at,
            )
            vendor_scores.add(oui_vendor, "oui", 55)
            oui_type = _OUI_DEVICE_TYPES.get(oui_vendor)
            if oui_type:
                type_scores.add(oui_type, "oui", 25)

    identity_values.extend(_add_dhcp_scores(
        vendor_scores=vendor_scores,
        type_scores=type_scores,
        hostname_scores=hostname_scores,
        info=dhcp_info or {},
        source="DHCP",
        group="dhcp",
        observed_at=observed_at,
        evidence=evidence,
    ))
    identity_values.extend(_add_identity_scores(
        vendor_scores=vendor_scores,
        type_scores=type_scores,
        hostname_scores=hostname_scores,
        source="mDNS",
        info=mdns_info or {},
        manufacturer_keys=("manufacturer",),
        model_keys=("model", "model_name"),
        hostname_keys=("hostname", "friendly_name"),
        observed_at=observed_at,
        evidence=evidence,
    ))
    identity_values.extend(_add_identity_scores(
        vendor_scores=vendor_scores,
        type_scores=type_scores,
        hostname_scores=hostname_scores,
        source="SSDP",
        info=ssdp_info or {},
        manufacturer_keys=("manufacturer",),
        model_keys=("model_name", "model"),
        hostname_keys=("friendly_name", "hostname"),
        observed_at=observed_at,
        evidence=evidence,
    ))

    ipv6_identity = {
        field: ipv6_info.get(field)
        for field in ("vendor_class", "fqdn", "hostname", "dhcp_fingerprint")
        if ipv6_info.get(field)
    }
    if ipv6_identity:
        identity_values.extend(_add_dhcp_scores(
            vendor_scores=vendor_scores,
            type_scores=type_scores,
            hostname_scores=hostname_scores,
            info=ipv6_identity,
            source="DHCPv6",
            group="dhcpv6",
            observed_at=observed_at,
            evidence=evidence,
        ))

    dhcp_duid = _text(dhcp_info.get("client_id"))
    ipv6_duid = _text(ipv6_info.get("duid") or ipv6_info.get("client_id"))
    if dhcp_duid and ipv6_duid and dhcp_duid.casefold() == ipv6_duid.casefold():
        _add_evidence(
            evidence,
            source="DHCPv6",
            group="dhcpv6_correlation",
            field="duid",
            value=ipv6_duid,
            strength="strong",
            observed_at=observed_at,
        )
        correlation_values = [
            _text(ipv6_info.get(field))
            for field in ("vendor_class", "fqdn", "hostname", "dhcp_fingerprint")
            if _text(ipv6_info.get(field))
        ] or [
            _text(dhcp_info.get(field))
            for field in ("vendor_class", "fqdn", "hostname", "dhcp_fingerprint")
            if _text(dhcp_info.get(field))
        ]
        correlation_text = " ".join(correlation_values)
        correlation_vendors = vendor_candidates(*correlation_values)
        for candidate in correlation_vendors:
            vendor_scores.add(candidate, "dhcpv6_correlation", 45)
        for candidate in device_type_candidates(
            correlation_text,
            vendor=correlation_vendors[0] if len(correlation_vendors) == 1 else "",
        ):
            type_scores.add(candidate, "dhcpv6_correlation", 50)

    network_names = []
    for source, value in (
        ("NetBIOS", _text((netbios_info or {}).get("hostname"))),
        ("Reverse DNS", _text(reverse_dns)),
    ):
        if not value:
            continue
        network_names.append(value)
        identity_values.append(value)
        _add_evidence(
            evidence,
            source=source,
            group="network_name",
            field="hostname",
            value=value,
            strength="strong",
            observed_at=observed_at,
        )
        hostname_scores.add(value, "network_name", 55)
        for candidate in device_type_candidates(value):
            type_scores.add(candidate, "network_name", 35)

    meaningful_services = [
        _text(service)
        for service in services
        if _text(service).casefold() not in {"80", "443", "http", "https"}
    ]
    if meaningful_services:
        _add_evidence(
            evidence,
            source="Service Discovery",
            group="service_signature",
            field="services",
            value=", ".join(meaningful_services),
            strength="medium",
            observed_at=observed_at,
        )
        for candidate in device_type_candidates(services=meaningful_services):
            type_scores.add(candidate, "service_signature", 35)

    pattern_text = " ".join(identity_values)
    pattern_vendors = vendor_candidates(*identity_values)
    for candidate in pattern_vendors:
        vendor_scores.add(candidate, "identity_pattern", 35)
    for candidate in device_type_candidates(
        pattern_text,
        vendor=pattern_vendors[0] if len(pattern_vendors) == 1 else "",
    ):
        type_scores.add(candidate, "identity_pattern", 35)
    for hostname in (
        _text(dhcp_info.get("hostname")) or _text(dhcp_info.get("fqdn")),
        _text((mdns_info or {}).get("hostname")),
        _text((ssdp_info or {}).get("friendly_name")),
        *network_names,
    ):
        if hostname and (
            vendor_candidates(hostname)
            or device_type_candidates(hostname)
        ):
            hostname_scores.add(hostname, "identity_pattern", 20)

    if ttl is not None:
        _add_evidence(
            evidence,
            source="Liveness",
            group="liveness",
            field="ttl",
            value=ttl,
            strength="weak",
            observed_at=observed_at,
        )
        if 96 <= ttl <= 128:
            type_scores.add("PC / Laptop", "liveness", 10)

    vendor, vendor_score, vendor_groups, vendor_tied = vendor_scores.select()
    device_type, type_score, type_groups, type_tied = type_scores.select()
    hostname, hostname_score, _, _ = hostname_scores.select()

    if vendor in COMPONENT_ONLY_VENDORS and "explicit_identity" not in vendor_groups:
        vendor = "Unknown"
    if vendor in _BROAD_CONSUMER_VENDORS and vendor_groups == {"oui"}:
        vendor = "Unknown"
    if vendor_tied:
        vendor = "Unknown"
    if type_tied:
        device_type = "Unknown"

    if is_gateway:
        device_type = "Router / Gateway"

    high = (
        vendor != "Unknown"
        and device_type != "Unknown"
        and vendor_score >= 80
        and type_score >= 80
        and (
            len(vendor_groups) >= 2
            or "explicit_identity" in vendor_groups
        )
        and (
            len(type_groups) >= 2
            or "explicit_identity" in type_groups
        )
    )
    medium = vendor_score >= 60 or type_score >= 60
    profile_status = "high" if high else "medium" if medium else "unknown"
    if is_gateway:
        profile_status = "unknown"

    os_name = _infer_os(
        vendor=vendor,
        device_type=device_type,
        hostname=hostname,
        is_gateway=is_gateway,
        ttl=ttl,
        open_ports=open_ports,
        services=services,
        dhcp_info=dhcp_info,
    )

    return {
        "vendor": vendor,
        "device_type": device_type,
        "hostname": hostname,
        "os": os_name,
        "vendor_confidence": vendor_score,
        "type_confidence": type_score,
        "hostname_confidence": hostname_score,
        "profile_status": profile_status,
        "profile_evidence": [item.to_dict() for item in evidence],
        "profiled_at": observed_at,
        "profile_version": 1,
    }


def synthesize_profile_assessment(
    ip: str,
    norm_mac: str,
    is_gateway: bool,
    vendor: str,
    hostname: str,
    nb_info: Dict[str, str],
    ping_info: Dict[str, Any],
    open_ports: Dict[int, str],
    http_info: Dict[str, str],
    dhcp_discovered: Dict[str, Any],
    ssdp_discovered: Dict[str, Any],
    mdns_discovered: Dict[str, Any],
    observed_at: Optional[str] = None,
    ipv6_info: Optional[Dict[str, Any]] = None,
) -> dict:
    del vendor, http_info
    dhcp_info = dhcp_discovered.get(norm_mac) or dhcp_discovered.get(ip, {})
    ssdp_info = ssdp_discovered.get(ip, {})
    mdns_info = mdns_discovered.get(ip, {})
    netbios_info = dict(nb_info or {})
    if hostname and not (
        _text(dhcp_info.get("hostname"))
        or _text(mdns_info.get("hostname"))
        or _text(ssdp_info.get("friendly_name"))
    ):
        netbios_info["hostname"] = hostname

    return assess_device_profile(
        ip=ip,
        mac=norm_mac,
        is_gateway=is_gateway,
        dhcp_info=dhcp_info if isinstance(dhcp_info, dict) else {},
        mdns_info=mdns_info if isinstance(mdns_info, dict) else {},
        ssdp_info=ssdp_info if isinstance(ssdp_info, dict) else {},
        netbios_info=netbios_info,
        reverse_dns=hostname if netbios_info.get("hostname") else "",
        ttl=ping_info.get("ttl") if ping_info.get("alive") else None,
        open_ports=list(open_ports),
        services=list(open_ports.values()),
        ipv6_info=ipv6_info or {},
        observed_at=observed_at or datetime.now(timezone.utc).isoformat(),
    )


def synthesize_ensemble_profile(
    ip: str,
    norm_mac: str,
    is_gateway: bool,
    vendor: str,
    hostname: str,
    nb_info: Dict[str, str],
    ping_info: Dict[str, Any],
    open_ports: Dict[int, str],
    http_info: Dict[str, str],
    dhcp_discovered: Dict[str, Any],
    ssdp_discovered: Dict[str, Any],
    mdns_discovered: Dict[str, Any],
) -> Tuple[str, str, str, str]:
    assessment = synthesize_profile_assessment(
        ip=ip,
        norm_mac=norm_mac,
        is_gateway=is_gateway,
        vendor=vendor,
        hostname=hostname,
        nb_info=nb_info,
        ping_info=ping_info,
        open_ports=open_ports,
        http_info=http_info,
        dhcp_discovered=dhcp_discovered,
        ssdp_discovered=ssdp_discovered,
        mdns_discovered=mdns_discovered,
    )
    return (
        assessment["hostname"],
        assessment["vendor"],
        assessment["os"],
        assessment["device_type"],
    )


def extract_mobile_brand_from_hostname(hostname: str) -> Optional[str]:
    candidates = vendor_candidates(hostname)
    mobile_types = device_type_candidates(hostname)
    if mobile_types != ["Smartphone / Tablet"] or not candidates:
        return None
    labels = {
        "Samsung": "Samsung Mobile",
        "Xiaomi": "Xiaomi Mobile",
        "Infinix": "Infinix Mobile",
        "Tecno": "Tecno Mobile",
        "Realme": "Realme Mobile",
        "OPPO": "OPPO Mobile",
        "Vivo": "Vivo Mobile",
        "OnePlus": "OnePlus Mobile",
        "Google": "Google Pixel Mobile",
        "Apple": "Apple iOS (Mobile)",
    }
    return labels.get(candidates[0])


__all__ = [
    "assess_device_profile",
    "extract_mobile_brand_from_hostname",
    "synthesize_ensemble_profile",
    "synthesize_profile_assessment",
]
