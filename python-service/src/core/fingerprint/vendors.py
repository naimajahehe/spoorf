"""
Vendor & OUI Database + MAC Randomization Heuristics
"""

from .oui_registry import OUIRecord, OUIRegistry, get_oui_record


_VENDOR_ALIASES = (
    ("apple", "Apple"),
    ("samsung", "Samsung"),
    ("xiaomi", "Xiaomi"),
    ("infinix", "Infinix"),
    ("tecno", "Tecno"),
    ("itel", "Itel"),
    ("oppo", "OPPO"),
    ("realme", "Realme"),
    ("oneplus", "OnePlus"),
    ("vivo", "Vivo"),
    ("huawei", "Huawei"),
    ("honor", "Honor"),
    ("tp-link", "TP-Link"),
    ("tp link", "TP-Link"),
    ("espressif", "Espressif (ESP8266/ESP32)"),
    ("intel", "Intel"),
    ("realtek", "Realtek"),
    ("foxconn", "Foxconn"),
    ("lenovo", "Lenovo"),
    ("dell", "Dell"),
    ("hewlett-packard", "HP"),
    ("hp inc", "HP"),
    ("asus", "ASUS"),
    ("acer", "Acer"),
    ("microsoft", "Microsoft"),
    ("cisco meraki", "Cisco"),
    ("cisco systems", "Cisco"),
    ("cisco", "Cisco"),
    ("mikrotik", "MikroTik"),
    ("ubiquiti", "Ubiquiti"),
    ("tenda", "Tenda"),
    ("vmware", "VMware"),
    ("virtualbox", "VirtualBox"),
    ("raspberry pi", "Raspberry Pi"),
    ("nokia", "Nokia"),
)


def _compat_vendor_label(organization: str) -> str:
    lowered = organization.casefold()
    for needle, label in _VENDOR_ALIASES:
        if needle in lowered:
            return label
    return organization


def is_randomized_mac(mac: str) -> bool:
    """Deteksi apakah MAC adalah Private/Randomized MAC (bit locally administered aktif: 2, 6, A, E)."""
    if not mac or len(mac) < 2:
        return False
    try:
        second_char = mac.replace('-', ':').split(':')[0][1].upper()
        return second_char in ('2', '6', 'A', 'E')
    except:
        return False


def get_vendor(mac: str, is_gateway: bool = False) -> str:
    """Identifikasi vendor perangkat berdasarkan registry OUI lokal."""
    if not mac:
        return "Router / Gateway" if is_gateway else "Unknown"

    record = get_oui_record(mac)
    if record:
        return _compat_vendor_label(record.organization)

    if is_randomized_mac(mac):
        return "Private Device (Randomized MAC)"

    return "Router / Gateway" if is_gateway else "Generic Device"


__all__ = [
    "OUIRecord",
    "OUIRegistry",
    "get_oui_record",
    "is_randomized_mac",
    "get_vendor",
]
