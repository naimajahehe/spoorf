"""
OS Detection & Device Classification Heuristics
"""

from typing import Dict, Any

def detect_os(ping_info: Dict[str, Any], open_ports: Dict[int, str], vendor: str, hostname: str, is_gateway: bool) -> str:
    """Heuristik deteksi OS berdasarkan TTL ICMP, open port, vendor OUI, dan hostname."""
    if is_gateway:
        return "Linux / RouterOS"

    h = hostname.lower() if hostname else ""
    v = vendor.lower() if vendor else ""
    ports = set(open_ports.keys())
    ttl = ping_info.get('ttl', 0)

    # 1. Windows OS
    if 445 in ports or 139 in ports or 3389 in ports:
        return "Windows"
    if 65 <= ttl <= 128:
        return "Windows"

    # 2. Apple iOS / macOS
    if 'apple' in v:
        if any(x in h for x in ['iphone', 'ipad', 'ipod']):
            return "iOS (Apple)"
        if any(x in h for x in ['macbook', 'imac', 'mac-mini', 'mac-pro']):
            return "macOS (Apple)"
        return "iOS / macOS (Apple)"

    # 3. Android Mobile
    if any(k in v for k in ['samsung', 'xiaomi', 'oppo', 'vivo', 'realme', 'infinix', 'tecno', 'oneplus', 'huawei']):
        return "Android"
    if any(k in h for k in ['android', 'galaxy', 'redmi', 'poco', 'infinix', 'realme', 'oppo', 'vivo']):
        return "Android"

    # 4. Linux / Embedded
    if 22 in ports:
        return "Linux"
    if 1 <= ttl <= 64:
        return "Android / Linux"

    return "Unknown OS"

def detect_device_type(is_gateway: bool, vendor: str, hostname: str, os_name: str, open_ports: Dict[int, str]) -> str:
    """Klasifikasi kategori perangkat (Router, Smartphone, PC/Laptop, IoT, Server)."""
    if is_gateway:
        return "Router / Gateway"

    h = hostname.lower() if hostname else ""
    v = vendor.lower() if vendor else ""
    o = os_name.lower() if os_name else ""
    ports = set(open_ports.keys())

    # Mobile Phones / Tablets
    if any(x in v for x in ['samsung', 'xiaomi', 'oppo', 'vivo', 'realme', 'infinix', 'tecno', 'oneplus']):
        return "Android / iOS (Mobile)"
    if 'apple' in v and ('iphone' in h or 'ipad' in h or 'ios' in o):
        return "Android / iOS (Mobile)"
    if 'android' in h or 'galaxy' in h or 'redmi' in h or 'infinix' in h:
        return "Android / iOS (Mobile)"

    # Computers / Laptops
    if any(x in v for x in ['lenovo', 'dell', 'hp', 'asus', 'acer', 'microsoft', 'intel']):
        return "PC / Laptop"
    if 'windows' in o or 'mac' in h or 'desktop' in h or 'laptop' in h or 445 in ports or 3389 in ports:
        return "PC / Laptop"

    # IoT / Smart Devices / Cameras
    if any(x in v for x in ['espressif', 'raspberry', 'tuya', 'broadlink']):
        return "IoT / Smart Home"
    if 554 in ports or 1883 in ports or 'cam' in h:
        return "IP Camera / IoT"

    # Servers / Network Equipment
    if any(x in v for x in ['cisco', 'mikrotik', 'ubiquiti', 'tp-link', 'tenda']):
        return "Network Infrastructure"
    if any(p in ports for p in [22, 80, 443, 3306, 5432, 6379, 27017]):
        return "Server / Network Host"

    return "Generic Client Device"
