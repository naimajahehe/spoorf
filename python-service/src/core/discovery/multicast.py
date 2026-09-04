"""
Multicast Discovery: SSDP (UPnP) & mDNS (Bonjour)
"""

import socket
import re
import xml.etree.ElementTree as ET
from urllib.request import urlopen, Request
import urllib.parse
from typing import Dict, Any

_SSDP_DISCOVERED: Dict[str, Dict[str, str]] = {}
_MDNS_DISCOVERED: Dict[str, Dict[str, str]] = {}

# KEAMANAN (M1): batasi ukuran baca deskriptor UPnP dari peer tak-tepercaya di LAN.
# 512KB = ribuan kali lebih besar dari deskriptor UPnP nyata (~1–50KB), jadi tak ada
# perangkat sah yang terpotong, tetapi mencegah DoS kehabisan memori dari respons raksasa.
MAX_SSDP_DESCRIPTOR_BYTES = 512 * 1024


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
    # 1. IPv4 Multicast Wake-up Burst (SSDP, mDNS, LLMNR)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as s4:
            s4.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
            s4.settimeout(0.05)
            # SSDP M-SEARCH (UPnP)
            s4.sendto(b'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nST: ssdp:all\r\n\r\n', ('239.255.255.250', 1900))
            # mDNS Services PTR Query
            s4.sendto(b'\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x09_services\x07_dns-sd\x04_udp\x05local\x00\x00\x0c\x00\x01', ('224.0.0.251', 5353))
            # LLMNR Query
            s4.sendto(b'\x00\x01\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x01*\x00\x00\x01\x00\x01', ('224.0.0.252', 5355))
    except Exception:
        pass

    # 2. IPv6 Multicast Wake-up Burst (mDNS IPv6, SSDP IPv6, LLMNR IPv6)
    try:
        with socket.socket(socket.AF_INET6, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as s6:
            s6.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_MULTICAST_HOPS, 2)
            s6.settimeout(0.05)
            # SSDP IPv6 Link-Local (ff02::c)
            try:
                s6.sendto(b'M-SEARCH * HTTP/1.1\r\nHOST: [ff02::c]:1900\r\nMAN: "ssdp:discover"\r\nST: ssdp:all\r\n\r\n', ('ff02::c', 1900))
            except Exception:
                pass
            # mDNS IPv6 (ff02::fb)
            try:
                s6.sendto(b'\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x09_services\x07_dns-sd\x04_udp\x05local\x00\x00\x0c\x00\x01', ('ff02::fb', 5353))
            except Exception:
                pass
            # LLMNR IPv6 (ff02::1:3)
            try:
                s6.sendto(b'\x00\x01\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x01*\x00\x00\x01\x00\x01', ('ff02::1:3', 5355))
            except Exception:
                pass
    except Exception:
        pass

def get_ssdp_cache() -> Dict[str, Dict[str, str]]:
    return dict(_SSDP_DISCOVERED)

def get_mdns_cache() -> Dict[str, Dict[str, str]]:
    return dict(_MDNS_DISCOVERED)

