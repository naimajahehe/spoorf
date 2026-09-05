"""
Fingerprint Subsystem Exports
"""

from .vendors import OUIRecord, OUIRegistry, get_oui_record, is_randomized_mac, get_vendor
from .os_detect import detect_os, detect_device_type
from .evidence import EvidenceStrength, ProfileEvidence, ProfileStatus
from .profile_rules import canonicalize_vendor, device_type_candidates, vendor_candidates
from .ensemble import (
    assess_device_profile,
    synthesize_ensemble_profile,
    synthesize_profile_assessment,
)


def query_netbios(*args, **kwargs):
    from .netbios import query_netbios as _query_netbios
    return _query_netbios(*args, **kwargs)


def query_mdns(*args, **kwargs):
    from .netbios import query_mdns as _query_mdns
    return _query_mdns(*args, **kwargs)


def get_hostname_info(*args, **kwargs):
    from .netbios import get_hostname_info as _get_hostname_info
    return _get_hostname_info(*args, **kwargs)


def ping_fast(*args, **kwargs):
    from .probe import ping_fast as _ping_fast
    return _ping_fast(*args, **kwargs)


def scan_ports(*args, **kwargs):
    from .probe import scan_ports as _scan_ports
    return _scan_ports(*args, **kwargs)


def get_http_info(*args, **kwargs):
    from .probe import get_http_info as _get_http_info
    return _get_http_info(*args, **kwargs)


__all__ = [
    "OUIRecord",
    "OUIRegistry",
    "get_oui_record",
    "is_randomized_mac",
    "get_vendor",
    "query_netbios",
    "query_mdns",
    "get_hostname_info",
    "ping_fast",
    "scan_ports",
    "get_http_info",
    "detect_os",
    "detect_device_type",
    "EvidenceStrength",
    "ProfileEvidence",
    "ProfileStatus",
    "canonicalize_vendor",
    "device_type_candidates",
    "vendor_candidates",
    "assess_device_profile",
    "synthesize_ensemble_profile",
    "synthesize_profile_assessment",
]
