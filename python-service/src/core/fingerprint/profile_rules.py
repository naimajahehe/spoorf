import re
from collections.abc import Iterable


COMPONENT_ONLY_VENDORS = {
    "Intel",
    "Realtek",
    "MediaTek",
    "Foxconn",
    "Qualcomm",
    "AzureWave",
    "Lite-On",
}

DEVICE_TYPE_RULES = {
    "Smartphone / Tablet": {
        "vendor_tokens": {
            "samsung", "xiaomi", "redmi", "poco", "oppo", "realme",
            "vivo", "infinix", "tecno", "oneplus", "iphone", "ipad",
        },
        "identity_tokens": {
            "android-dhcp", "galaxy", "iphone", "ipad", "pixel",
            "sm-a", "sm-s", "redmi", "poco", "oppo", "realme",
            "vivo", "infinix", "tecno", "oneplus",
        },
        "service_tokens": {"_companion-link._tcp", "_apple-mobdev2._tcp"},
    },
    "PC / Laptop": {
        "identity_tokens": {
            "desktop-", "laptop-", "macbook", "imac", "msft 5.0",
            "thinkpad", "latitude", "elitebook", "surface laptop",
            "vivobook", "zenbook", "aspire", "desktop", "laptop",
        },
        "service_tokens": {"smb", "microsoft-ds", "_workstation._tcp"},
    },
    "Smart TV / Multimedia": {
        "identity_tokens": {
            "qled", "bravia", "smart tv", "chromecast", "android tv",
            "roku", "soundbar", "airplay", "apple tv", "webos tv",
        },
        "service_tokens": {
            "_googlecast._tcp", "_airplay._tcp", "_raop._tcp",
        },
    },
    "Printer": {
        "identity_tokens": {
            "printer", "laserjet", "deskjet", "epson", "pixma", "ecotank",
        },
        "service_tokens": {"ipp", "_ipp._tcp", "_printer._tcp"},
    },
    "IP Camera / IoT": {
        "identity_tokens": {
            "camera", "webcam", "esp32", "esp8266", "tuya", "tapo",
            "nest cam",
        },
        "service_tokens": {"rtsp", "mqtt", "_hap._tcp"},
    },
    "Network Infrastructure": {
        "identity_tokens": {
            "router", "access point", "openwrt", "routeros", "unifi ap",
        },
        "service_tokens": {"snmp", "dns", "dhcp"},
    },
}

_VENDOR_ALIASES = (
    ("hewlett packard", "HP"),
    ("hewlett-packard", "HP"),
    ("hp printer", "HP Printer"),
    ("raspberry pi", "Raspberry Pi"),
    ("tp link", "TP-Link"),
    ("tp-link", "TP-Link"),
    ("apple", "Apple"),
    ("samsung", "Samsung"),
    ("xiaomi", "Xiaomi"),
    ("redmi", "Xiaomi"),
    ("poco", "Xiaomi"),
    ("google", "Google"),
    ("microsoft", "Microsoft"),
    ("msft", "Microsoft"),
    ("lenovo", "Lenovo"),
    ("dell", "Dell"),
    ("hp", "HP"),
    ("asustek", "ASUS"),
    ("asus", "ASUS"),
    ("acer", "Acer"),
    ("sony", "Sony"),
    ("lg", "LG"),
    ("mikrotik", "MikroTik"),
    ("ubiquiti", "Ubiquiti"),
    ("huawei", "Huawei"),
    ("oppo", "OPPO"),
    ("realme", "Realme"),
    ("vivo", "Vivo"),
    ("infinix", "Infinix"),
    ("tecno", "Tecno"),
    ("oneplus", "OnePlus"),
    ("espressif", "Espressif"),
    ("epson", "Epson"),
    ("canon", "Canon"),
    ("brother", "Brother"),
    ("intel", "Intel"),
    ("realtek", "Realtek"),
    ("mediatek", "MediaTek"),
    ("foxconn", "Foxconn"),
    ("qualcomm", "Qualcomm"),
    ("azurewave", "AzureWave"),
    ("lite on", "Lite-On"),
    ("lite-on", "Lite-On"),
)

_IDENTITY_VENDOR_PATTERNS = (
    ("sm-a", "Samsung"),
    ("sm-s", "Samsung"),
    ("galaxy", "Samsung"),
    ("qled", "Samsung"),
    ("iphone", "Apple"),
    ("ipad", "Apple"),
    ("macbook", "Apple"),
    ("imac", "Apple"),
    ("apple tv", "Apple"),
    ("pixel", "Google"),
    ("nest cam", "Google"),
    ("thinkpad", "Lenovo"),
    ("latitude", "Dell"),
    ("elitebook", "HP"),
    ("surface", "Microsoft"),
    ("vivobook", "ASUS"),
    ("zenbook", "ASUS"),
    ("aspire", "Acer"),
    ("bravia", "Sony"),
    ("webos", "LG"),
    ("pixma", "Canon"),
    ("ecotank", "Epson"),
    ("esp32", "Espressif"),
    ("esp8266", "Espressif"),
    ("raspberry pi", "Raspberry Pi"),
)

_TOKEN_RE = re.compile(r"[0-9A-Za-z]+")


def _tokens(value: str) -> tuple[str, ...]:
    return tuple(_TOKEN_RE.findall((value or "").casefold()))


def _contains_token_sequence(haystack: tuple[str, ...], needle: tuple[str, ...]) -> bool:
    if not needle or len(needle) > len(haystack):
        return False
    return any(
        haystack[index:index + len(needle)] == needle
        for index in range(len(haystack) - len(needle) + 1)
    )


def _contains(value: str, token: str) -> bool:
    normalized = (value or "").casefold()
    spaced = normalized.replace("_", " ").replace("-", " ")
    token_normalized = token.casefold()
    token_spaced = token_normalized.replace("_", " ").replace("-", " ")
    if any(character in token_normalized for character in "_.-"):
        return token_normalized in normalized or token_spaced in spaced
    return _contains_token_sequence(_tokens(value), _tokens(token))


def _alias_vendor(value: str) -> str:
    tokens = _tokens(value)
    for alias, label in _VENDOR_ALIASES:
        if _contains_token_sequence(tokens, _tokens(alias)):
            return label
    return "Unknown"


def canonicalize_vendor(value: str) -> str:
    rendered = (value or "").strip()
    if not rendered or rendered.casefold() in {
        "unknown",
        "generic device",
        "private device (randomized mac)",
        "router / gateway",
    }:
        return "Unknown"
    alias = _alias_vendor(rendered)
    return alias if alias != "Unknown" else rendered


def vendor_candidates(*values: str) -> list[str]:
    candidates = []
    for value in values:
        canonical = _alias_vendor(value)
        if canonical != "Unknown" and canonical not in candidates:
            candidates.append(canonical)
        for pattern, vendor in _IDENTITY_VENDOR_PATTERNS:
            if _contains(value, pattern) and vendor not in candidates:
                candidates.append(vendor)
    return candidates


def device_type_candidates(
    *values: str,
    vendor: str = "",
    services: Iterable[str] = (),
    allow_vendor_tokens: bool = True,
) -> list[str]:
    identity_text = " ".join(str(value) for value in values if value)
    service_values = tuple(str(service).casefold() for service in services if service)

    identity_matches = [
        category
        for category, rules in DEVICE_TYPE_RULES.items()
        if any(_contains(identity_text, token) for token in rules["identity_tokens"])
    ]
    if identity_matches:
        return identity_matches

    service_matches = [
        category
        for category, rules in DEVICE_TYPE_RULES.items()
        if any(
            token.casefold() in service
            for token in rules["service_tokens"]
            for service in service_values
        )
    ]
    if service_matches:
        return service_matches

    if allow_vendor_tokens and vendor:
        return [
            category
            for category, rules in DEVICE_TYPE_RULES.items()
            if any(_contains(vendor, token) for token in rules.get("vendor_tokens", set()))
        ]
    return []


__all__ = [
    "COMPONENT_ONLY_VENDORS",
    "DEVICE_TYPE_RULES",
    "canonicalize_vendor",
    "device_type_candidates",
    "vendor_candidates",
]
