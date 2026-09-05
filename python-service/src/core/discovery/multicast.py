"""
Multicast Discovery: SSDP (UPnP) & mDNS (Bonjour)
"""

import socket
import re
import time
import xml.etree.ElementTree as ET
from urllib.request import urlopen, Request
import urllib.parse
from typing import Dict, Any, Tuple

_SSDP_DISCOVERED: Dict[str, Dict[str, str]] = {}
_MDNS_DISCOVERED: Dict[str, Dict[str, str]] = {}

# KEAMANAN (M1): batasi ukuran baca deskriptor UPnP dari peer tak-tepercaya di LAN.
# 512KB = ribuan kali lebih besar dari deskriptor UPnP nyata (~1–50KB), jadi tak ada
# perangkat sah yang terpotong, tetapi mencegah DoS kehabisan memori dari respons raksasa.
MAX_SSDP_DESCRIPTOR_BYTES = 512 * 1024
MAX_IDENTITY_RESPONSES_PER_FAMILY = 64

_IDENTITY_QUERIES = {
    socket.AF_INET: (
        (
            'ssdp_ipv4',
            b'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\n'
            b'MAN: "ssdp:discover"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n',
            ('239.255.255.250', 1900),
        ),
        (
            'mdns_ipv4',
            b'\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00'
            b'\x09_services\x07_dns-sd\x04_udp\x05local\x00\x00\x0c\x80\x01',
            ('224.0.0.251', 5353),
        ),
        (
            'llmnr_ipv4',
            b'\x00\x01\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00'
            b'\x01*\x00\x00\x01\x00\x01',
            ('224.0.0.252', 5355),
        ),
    ),
    socket.AF_INET6: (
        (
            'ssdp_ipv6',
            b'M-SEARCH * HTTP/1.1\r\nHOST: [ff02::c]:1900\r\n'
            b'MAN: "ssdp:discover"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n',
            ('ff02::c', 1900),
        ),
        (
            'mdns_ipv6',
            b'\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00'
            b'\x09_services\x07_dns-sd\x04_udp\x05local\x00\x00\x0c\x80\x01',
            ('ff02::fb', 5353),
        ),
        (
            'llmnr_ipv6',
            b'\x00\x01\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00'
            b'\x01*\x00\x00\x01\x00\x01',
            ('ff02::1:3', 5355),
        ),
    ),
}


def _read_dns_name(data: bytes, offset: int, depth: int = 0) -> Tuple[str, int]:
    if depth > 8:
        return "", offset
    labels = []
    cursor = offset
    next_offset = offset
    jumped = False
    while cursor < len(data):
        length = data[cursor]
        if length == 0:
            cursor += 1
            if not jumped:
                next_offset = cursor
            break
        if length & 0xC0 == 0xC0:
            if cursor + 1 >= len(data):
                break
            pointer = ((length & 0x3F) << 8) | data[cursor + 1]
            pointed, _ = _read_dns_name(data, pointer, depth + 1)
            if pointed:
                labels.append(pointed)
            cursor += 2
            if not jumped:
                next_offset = cursor
            jumped = True
            break
        cursor += 1
        if cursor + length > len(data):
            break
        labels.append(data[cursor:cursor + length].decode("utf-8", errors="ignore"))
        cursor += length
        if not jumped:
            next_offset = cursor
    return ".".join(part for part in labels if part), next_offset


def _parse_dns_identity(data: bytes, protocol: str) -> Dict[str, Any]:
    if len(data) < 12:
        return {}
    question_count = int.from_bytes(data[4:6], "big")
    record_count = sum(
        int.from_bytes(data[start:start + 2], "big")
        for start in (6, 8, 10)
    )
    offset = 12
    try:
        for _ in range(question_count):
            _, offset = _read_dns_name(data, offset)
            offset += 4

        names = []
        values = []
        for _ in range(record_count):
            name, offset = _read_dns_name(data, offset)
            if offset + 10 > len(data):
                break
            record_type = int.from_bytes(data[offset:offset + 2], "big")
            data_length = int.from_bytes(data[offset + 8:offset + 10], "big")
            data_offset = offset + 10
            record_end = data_offset + data_length
            if record_end > len(data):
                break
            if name:
                names.append(name)
            if record_type in {5, 12}:
                value, _ = _read_dns_name(data, data_offset)
                if value:
                    values.append(value)
            elif record_type == 33 and data_length >= 6:
                value, _ = _read_dns_name(data, data_offset + 6)
                if value:
                    values.append(value)
            elif record_type == 16:
                raw = data[data_offset:record_end]
                values.append(raw.decode("utf-8", errors="ignore"))
            offset = record_end
    except (IndexError, ValueError):
        return {}

    candidates = names + values
    hostname = ""
    for candidate in candidates:
        clean = str(candidate).strip().rstrip(".")
        if not clean or clean.startswith("_"):
            continue
        if clean.casefold().endswith(".local"):
            clean = clean[:-6].rstrip(".")
        if clean:
            hostname = clean
            break

    combined = " ".join(candidates)
    model = ""
    for brand in (
        "iPhone", "iPad", "MacBook", "iMac", "Galaxy", "Pixel",
        "Poco", "Redmi", "Sony", "LG", "Samsung",
    ):
        if brand.casefold() in combined.casefold():
            model = brand
            break
    result: Dict[str, Any] = {"records": candidates}
    if hostname:
        result["hostname"] = hostname
    if protocol == "mdns" and model:
        result["model"] = model
    return result


def _parse_ssdp_response(data: bytes) -> Dict[str, str]:
    text = data.decode("utf-8", errors="ignore")
    headers = {}
    for line in text.splitlines()[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().casefold()] = value.strip()
    result = {
        "location": headers.get("location", ""),
        "server": headers.get("server", ""),
        "st": headers.get("st", ""),
        "usn": headers.get("usn", ""),
    }
    friendly_name = headers.get("friendlyname") or headers.get("x-friendly-name")
    manufacturer = headers.get("manufacturer") or headers.get("x-manufacturer")
    model_name = (
        headers.get("modelname")
        or headers.get("x-model-name")
        or headers.get("server")
    )
    if friendly_name:
        result["friendly_name"] = friendly_name
    if manufacturer:
        result["manufacturer"] = manufacturer
    if model_name:
        result["model_name"] = model_name
    return {key: value for key, value in result.items() if value}


def _merge_identity(
    destination: Dict[str, Dict[str, Any]],
    ip: str,
    identity: Dict[str, Any],
) -> None:
    if not identity:
        return
    current = destination.setdefault(ip, {})
    for key, value in identity.items():
        if value:
            current[key] = value


def collect_identity_multicast(timeout: float = 0.8) -> Dict[str, Any]:
    """Send one dual-stack identity query per protocol and collect same-socket replies."""
    protocols = {
        name: False
        for queries in _IDENTITY_QUERIES.values()
        for name, _payload, _destination in queries
    }
    errors = []
    partial_failures = []
    per_run = {"ssdp": {}, "mdns": {}, "llmnr": {}}
    receive_window = min(max(0.01, float(timeout)), 10.0)

    for family in (socket.AF_INET, socket.AF_INET6):
        queries = _IDENTITY_QUERIES[family]
        family_name = "ipv4" if family == socket.AF_INET else "ipv6"
        try:
            with socket.socket(family, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as sock:
                if family == socket.AF_INET:
                    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
                else:
                    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_MULTICAST_HOPS, 2)
                sock.settimeout(receive_window)
                for name, payload, destination in queries:
                    try:
                        sock.sendto(payload, destination)
                        protocols[name] = True
                    except Exception as error:
                        message = str(error).strip() or type(error).__name__
                        errors.append({"protocol": name, "error": message})
                        partial_failures.append({"sensor": name, "error": message})

                deadline = time.monotonic() + receive_window
                response_count = 0
                while response_count < MAX_IDENTITY_RESPONSES_PER_FAMILY:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        break
                    sock.settimeout(max(0.001, min(receive_window, remaining)))
                    try:
                        data, address = sock.recvfrom(4096)
                    except socket.timeout:
                        break
                    except Exception as error:
                        message = str(error).strip() or type(error).__name__
                        partial_failures.append({
                            "sensor": f"{family_name}_receive",
                            "error": message,
                        })
                        break

                    response_count += 1
                    ip = str(address[0]).split("%", 1)[0]
                    port = int(address[1]) if len(address) > 1 else 0
                    if data.startswith(b"HTTP/"):
                        protocol = "ssdp"
                        identity = _parse_ssdp_response(data)
                    else:
                        transaction_id = (
                            int.from_bytes(data[:2], "big")
                            if len(data) >= 2
                            else -1
                        )
                        protocol = (
                            "mdns"
                            if port == 5353 or transaction_id == 0
                            else "llmnr"
                        )
                        identity = _parse_dns_identity(data, protocol)
                    _merge_identity(per_run[protocol], ip, identity)
        except Exception as error:
            message = str(error).strip() or type(error).__name__
            for name, _payload, _destination in queries:
                if not protocols[name]:
                    errors.append({"protocol": name, "error": message})
                    partial_failures.append({"sensor": name, "error": message})

    for ip, identity in per_run["mdns"].items():
        _MDNS_DISCOVERED[ip] = dict(identity)

    succeeded = sum(1 for delivered in protocols.values() if delivered)
    return {
        "delivery": {
            "attempted": len(protocols),
            "succeeded": succeeded,
            "failed": len(protocols) - succeeded,
            "protocols": protocols,
            "errors": errors,
        },
        **per_run,
        "partial_failures": partial_failures,
    }


def _fetch_ssdp_descriptor(loc, ip, opener=urlopen, max_bytes=MAX_SSDP_DESCRIPTOR_BYTES):
    """Ambil & parse satu deskriptor perangkat UPnP dengan aman.

    - SSRF-guard: hanya ambil bila host URL == IP pengirim SSDP.
    - Baca TERBATAS `max_bytes` (BUKAN res.read() tanpa batas) agar tak boros memori
      saat peer mengirim respons raksasa/lambat.
    - Kembalikan dict metadata atau None (tak pernah melempar) untuk degradasi mulus.
    `opener` dapat diinjeksi pada test agar tak menyentuh jaringan.
    """
    try:
        parsed = urllib.parse.urlparse(loc)
        if parsed.hostname != ip:
            return None
        req = Request(loc, headers={'User-Agent': 'NetCut-Sentinel/2.0'})
        with opener(req, timeout=0.35) as res:
            xml_content = res.read(max_bytes)
        root = ET.fromstring(xml_content)
        ns = {'ns': 'urn:schemas-upnp-org:device-1-0'}

        def find_text(tag):
            el = root.find(f".//ns:{tag}", ns)
            if el is None:
                el = root.find(f".//{tag}")
            return el.text.strip() if el is not None and el.text else ""

        return {
            'friendly_name': find_text('friendlyName'),
            'manufacturer': find_text('manufacturer'),
            'model_name': find_text('modelName'),
            'model_desc': find_text('modelDescription')
        }
    except Exception:
        return None

def collect_ssdp_sensors(timeout: float = 0.4) -> Dict[str, Dict[str, str]]:
    """Kirim SSDP M-SEARCH (UPnP) multicast pada 239.255.255.250:1900."""
    global _SSDP_DISCOVERED
    ssdp_request = (
        "M-SEARCH * HTTP/1.1\r\n"
        "HOST: 239.255.255.250:1900\r\n"
        "MAN: \"ssdp:discover\"\r\n"
        "MX: 1\r\n"
        "ST: ssdp:all\r\n"
        "\r\n"
    ).encode('utf-8')

    s = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        s.settimeout(timeout)
        s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        s.sendto(ssdp_request, ('239.255.255.250', 1900))

        locations_to_fetch = {}
        while True:
            try:
                data, addr = s.recvfrom(2048)
                ip = addr[0]
                resp = data.decode('utf-8', errors='ignore')
                loc_match = re.search(r'LOCATION:\s*(\S+)', resp, re.IGNORECASE)
                if loc_match and ip not in _SSDP_DISCOVERED:
                    locations_to_fetch[ip] = loc_match.group(1).strip()
            except socket.timeout:
                break
            except:
                break
    except:
        locations_to_fetch = {}
    finally:
        if s:
            s.close()

    # Ambil & parse deskriptor perangkat (maks 8 lokasi), masing-masing dengan
    # SSRF-guard + baca terbatas via _fetch_ssdp_descriptor (M1 hardening).
    for ip, loc in list(locations_to_fetch.items())[:8]:
        info = _fetch_ssdp_descriptor(loc, ip)
        if info:
            _SSDP_DISCOVERED[ip] = info

    return dict(_SSDP_DISCOVERED)

def collect_mdns_sensors(timeout: float = 0.4) -> Dict[str, Dict[str, str]]:
    """Kirim query multicast DNS (mDNS) pada 224.0.0.251:5353."""
    global _MDNS_DISCOVERED
    s = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        s.settimeout(timeout)
        s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 255)
        # PTR query untuk _services._dns-sd._udp.local
        query = (
            b'\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00'
            b'\x09_services\x07_dns-sd\x04_udp\x05local\x00\x00\x0c\x00\x01'
        )
        s.sendto(query, ('224.0.0.251', 5353))

        while True:
            try:
                data, addr = s.recvfrom(2048)
                ip = addr[0]
                text = data.decode('utf-8', errors='ignore')
                model = ""
                for brand in ['iPhone', 'iPad', 'MacBook', 'iMac', 'Galaxy', 'Pixel', 'Poco', 'Redmi', 'Sony', 'LG', 'Samsung']:
                    if brand.lower() in text.lower():
                        model = brand
                        break
                _MDNS_DISCOVERED[ip] = {'model': model}
            except socket.timeout:
                break
            except:
                break
    except:
        pass
    finally:
        if s:
            s.close()
    return dict(_MDNS_DISCOVERED)

def send_multicast_wakeup():
    """
    Kirim paket multicast ringan Dual-Stack (IPv4 + IPv6) untuk membangunkan
    smartphone dan IoT dari mode hemat daya / sleep doze state.
    """
    protocol_order = (
        'ssdp_ipv4',
        'mdns_ipv4',
        'llmnr_ipv4',
        'ssdp_ipv6',
        'mdns_ipv6',
        'llmnr_ipv6',
    )
    protocols = {name: False for name in protocol_order}
    errors = []

    def record_failure(names, exc):
        message = str(exc).strip() or type(exc).__name__
        for name in names:
            if protocols[name]:
                continue
            errors.append({'protocol': name, 'error': message})

    def send_named(sock, name, payload, destination):
        try:
            sock.sendto(payload, destination)
            protocols[name] = True
        except Exception as exc:
            record_failure((name,), exc)

    # 1. IPv4 Multicast Wake-up Burst (SSDP, mDNS, LLMNR)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as s4:
            s4.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
            s4.settimeout(0.05)
            # SSDP M-SEARCH (UPnP)
            send_named(
                s4,
                'ssdp_ipv4',
                b'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nST: ssdp:all\r\n\r\n',
                ('239.255.255.250', 1900),
            )
            # mDNS Services PTR Query
            send_named(
                s4,
                'mdns_ipv4',
                b'\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x09_services\x07_dns-sd\x04_udp\x05local\x00\x00\x0c\x00\x01',
                ('224.0.0.251', 5353),
            )
            # LLMNR Query
            send_named(
                s4,
                'llmnr_ipv4',
                b'\x00\x01\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x01*\x00\x00\x01\x00\x01',
                ('224.0.0.252', 5355),
            )
    except Exception as exc:
        record_failure(protocol_order[:3], exc)

    # 2. IPv6 Multicast Wake-up Burst (mDNS IPv6, SSDP IPv6, LLMNR IPv6)
    try:
        with socket.socket(socket.AF_INET6, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as s6:
            s6.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_MULTICAST_HOPS, 2)
            s6.settimeout(0.05)
            # SSDP IPv6 Link-Local (ff02::c)
            send_named(
                s6,
                'ssdp_ipv6',
                b'M-SEARCH * HTTP/1.1\r\nHOST: [ff02::c]:1900\r\nMAN: "ssdp:discover"\r\nST: ssdp:all\r\n\r\n',
                ('ff02::c', 1900),
            )
            # mDNS IPv6 (ff02::fb)
            send_named(
                s6,
                'mdns_ipv6',
                b'\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x09_services\x07_dns-sd\x04_udp\x05local\x00\x00\x0c\x00\x01',
                ('ff02::fb', 5353),
            )
            # LLMNR IPv6 (ff02::1:3)
            send_named(
                s6,
                'llmnr_ipv6',
                b'\x00\x01\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x01*\x00\x00\x01\x00\x01',
                ('ff02::1:3', 5355),
            )
    except Exception as exc:
        record_failure(protocol_order[3:], exc)

    succeeded = sum(1 for delivered in protocols.values() if delivered)
    return {
        'attempted': len(protocol_order),
        'succeeded': succeeded,
        'failed': len(protocol_order) - succeeded,
        'protocols': protocols,
        'errors': errors,
    }

def get_ssdp_cache() -> Dict[str, Dict[str, str]]:
    return dict(_SSDP_DISCOVERED)

def get_mdns_cache() -> Dict[str, Dict[str, str]]:
    return dict(_MDNS_DISCOVERED)
