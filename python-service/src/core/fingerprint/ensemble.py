"""
Multi-Sensor Ensemble Profile Synthesizer
=========================================
Menggabungkan data dari Passive DHCP, SSDP UPnP, mDNS Bonjour, NetBIOS,
dan Banner Grabber untuk menghasilkan identitas perangkat paling akurat.
"""

import re
from typing import Dict, Any, Tuple, Optional
from .os_detect import detect_os, detect_device_type

_SMARTPHONE_PATTERNS = [
    (r'\b(galaxy|samsung)\b', 'Samsung Mobile'),
    (r'\b(redmi|poco|xiaomi)\b', 'Xiaomi Mobile'),
    (r'\b(infinix)\b', 'Infinix Mobile'),
    (r'\b(tecno)\b', 'Tecno Mobile'),
    (r'\b(realme)\b', 'Realme Mobile'),
    (r'\b(oppo)\b', 'OPPO Mobile'),
    (r'\b(vivo)\b', 'Vivo Mobile'),
    (r'\b(oneplus)\b', 'OnePlus Mobile'),
    (r'\b(pixel)\b', 'Google Pixel Mobile'),
    (r'\b(iphone|ipad|ipod)\b', 'Apple iOS (Mobile)')
]

_NEGATIVE_DEVICE_KEYWORDS = [
    'tv', 'qled', 'bravia', 'soundbar', 'hub', 'fridge', 'ac',
    'printer', 'cast', 'vivobook', 'zenbook', 'laptop', 'desktop', 'pc'
]

def extract_mobile_brand_from_hostname(hostname: str) -> Optional[str]:
    """
    Ekstrak merek smartphone dari hostname secara defensif.
    - Cek kata kunci negatif (TV, Soundbar, Vivobook, PC) -> return None
    - Cek pola kata kunci merek smartphone dengan regex batas kata (word boundary)
    """
    if not hostname:
        return None

    h_clean = hostname.lower().replace('-', ' ').replace('_', ' ')

    # 1. Negative Lookahead Guard: Jangan tebak jika terindikasi Smart TV atau PC/Laptop
    for neg in _NEGATIVE_DEVICE_KEYWORDS:
        if re.search(rf'\b{neg}\b', h_clean):
            return None

    # 2. Positive Smartphone Pattern Matching
    for pattern, brand_label in _SMARTPHONE_PATTERNS:
        if re.search(pattern, h_clean):
            return brand_label

    return None

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
    mdns_discovered: Dict[str, Any]
) -> Tuple[str, str, str, str]:
    """Korelasikan temuan seluruh sensor untuk menentukan Hostname, Vendor, OS, dan Device Type."""
    final_hostname = hostname or ""
    final_vendor = vendor or "Generic Device"
    
    # 1. Sensor DHCP (Teknik 3B)
    dhcp_info = dhcp_discovered.get(norm_mac) or dhcp_discovered.get(ip, {})
    dhcp_host = dhcp_info.get('hostname', '')
    dhcp_vendor_class = dhcp_info.get('vendor_class', '')
    dhcp_fp = dhcp_info.get('dhcp_fingerprint', '')

    if dhcp_host and (not final_hostname or final_hostname == ip or final_hostname.startswith('Unknown')):
        final_hostname = dhcp_host

    if dhcp_vendor_class:
        v_class_lower = dhcp_vendor_class.lower()
        if 'android' in v_class_lower and ('generic' in final_vendor.lower() or 'private' in final_vendor.lower()):
            final_vendor = "Android Mobile"
        elif 'msft' in v_class_lower:
            if 'generic' in final_vendor.lower() or 'private' in final_vendor.lower():
                final_vendor = "Microsoft Windows PC"

    # 2. Sensor SSDP UPnP
    ssdp_info = ssdp_discovered.get(ip, {})
    if ssdp_info:
        ssdp_friendly = ssdp_info.get('friendly_name', '')
        ssdp_manuf = ssdp_info.get('manufacturer', '')
        ssdp_model = ssdp_info.get('model_name', '')

        if ssdp_friendly and (not final_hostname or final_hostname == ip):
            final_hostname = ssdp_friendly
        if ssdp_manuf and ('generic' in final_vendor.lower() or 'private' in final_vendor.lower()):
            final_vendor = f"{ssdp_manuf} ({ssdp_model})" if ssdp_model else ssdp_manuf

    # 3. Sensor mDNS Bonjour
    mdns_info = mdns_discovered.get(ip, {})
    if mdns_info:
        mdns_host = mdns_info.get('hostname', '')
        mdns_model = mdns_info.get('model', '')
        if mdns_host and (not final_hostname or final_hostname == ip):
            final_hostname = mdns_host
        if mdns_model and ('generic' in final_vendor.lower() or 'private' in final_vendor.lower()):
            final_vendor = mdns_model

    # 4. Sensor HTTP Server Title
    web_title = http_info.get('web_title', '')
    if web_title and is_gateway and ('generic' in final_vendor.lower() or final_vendor == 'Router / Gateway'):
        for gw_brand in ['MikroTik', 'TP-Link', 'OpenWrt', 'Tenda', 'Huawei', 'ZTE', 'Ubiquiti']:
            if gw_brand.lower() in web_title.lower():
                final_vendor = gw_brand
                break

    # 5. Deteksi OS & Device Type
    os_name = detect_os(ping_info, open_ports, final_vendor, final_hostname, is_gateway)

    if dhcp_fp:
        if 'Apple iOS' in dhcp_fp:
            os_name = "Apple iOS"
        elif 'Apple macOS' in dhcp_fp:
            os_name = "macOS (Apple)"
        elif 'Apple' in dhcp_fp:
            os_name = "iOS / macOS (Apple)"
        elif 'PlayStation' in dhcp_fp:
            os_name = "PlayStation OS"
        elif 'Nintendo' in dhcp_fp:
            os_name = "Nintendo OS"
        elif 'Android' in dhcp_fp and 'Windows' not in os_name:
            os_name = "Android OS"
        elif 'Windows' in dhcp_fp:
            os_name = "Windows"
        elif 'Linux' in dhcp_fp and 'Windows' not in os_name:
            os_name = "Linux / Embedded"

    # 6. Solusi 4: Decoupled Mobile Brand Heuristics for Randomized MACs
    # Dijalankan HANYA jika bukan Windows PC (port 445 tertutup dan os bukan Windows)
    if 445 not in open_ports and 'windows' not in os_name.lower():
        mobile_brand = extract_mobile_brand_from_hostname(final_hostname)
        if mobile_brand and ('generic' in final_vendor.lower() or 'private' in final_vendor.lower() or final_vendor == "Android Mobile"):
            final_vendor = mobile_brand
            if 'Apple' in mobile_brand:
                os_name = "iOS / macOS (Apple)"
            elif os_name in ["Unknown OS", "Generic OS", "Android / Linux"]:
                os_name = "Android OS"

    device_type = detect_device_type(is_gateway, final_vendor, final_hostname, os_name, open_ports)

    # Smart TV / Multimedia disambiguation
    if any(k in final_hostname.lower() for k in ['tv', 'qled', 'bravia', 'soundbar', 'cast']):
        if device_type in ["Generic Client Device", "PC / Laptop"]:
            device_type = "Smart TV / Multimedia"
        if 'samsung' in final_hostname.lower() and ('generic' in final_vendor.lower() or 'private' in final_vendor.lower()):
            final_vendor = "Samsung (Smart TV / Audio)"

    return final_hostname, final_vendor, os_name, device_type
