"""
Network Subsystem & Adapter Management
=======================================
Menangani deteksi interface fisik/Wi-Fi, IP gateway, status koneksi Wi-Fi,
dan konfigurasi IP forwarding di Windows dan Linux.
"""

import time
import threading
import sys
import subprocess
import re
import socket
import netifaces
import ipaddress
from typing import Dict, Any, Optional
from scapy.all import conf, ifaces
from ..utils.logger import logger

_RFC1918_NETWORKS = [
    ipaddress.IPv4Network("10.0.0.0/8"),
    ipaddress.IPv4Network("172.16.0.0/12"),
    ipaddress.IPv4Network("192.168.0.0/16"),
]

_WIFI_INFO_CACHE: Dict[str, Any] = {}
_WIFI_INFO_CACHE_TIME: float = 0.0
_WIFI_CACHE_LOCK = threading.Lock()
_WIFI_CACHE_TTL = 10.0  # 10 detik cache untuk mencegah stuttering kartu Wi-Fi di Windows

def clear_wifi_cache():
    """Reset cache Wi-Fi seketika saat ada pergantian gateway atau koneksi."""
    global _WIFI_INFO_CACHE_TIME
    with _WIFI_CACHE_LOCK:
        _WIFI_INFO_CACHE_TIME = 0.0

def is_valid_private_ip(ip: str) -> bool:
    """Validasi apakah string adalah alamat IPv4 private yang sah (RFC 1918)."""
    if not ip or not isinstance(ip, str):
        return False
    try:
        obj = ipaddress.IPv4Address(ip.strip())
        return any(obj in net for net in _RFC1918_NETWORKS)
    except:
        return False

def is_valid_private_network(cidr: str) -> bool:
    """Validasi bahwa seluruh CIDR IPv4 berada di dalam rentang RFC 1918."""
    if not cidr or not isinstance(cidr, str):
        return False
    try:
        net = ipaddress.IPv4Network(cidr.strip(), strict=False)
        return any(net.subnet_of(private) for private in _RFC1918_NETWORKS)
    except (ipaddress.AddressValueError, ipaddress.NetmaskValueError, ValueError):
        return False

def is_valid_mac(mac: str) -> bool:
    """Validasi format alamat MAC 6-oktet."""
    if not mac or not isinstance(mac, str):
        return False
    norm = mac.replace('-', ':').strip()
    return bool(re.match(r'^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$', norm))

def get_self_mac() -> str:
    """Ambil MAC address milik interface aktif mesin operator/controller ini."""
    try:
        info = get_network_info()
        my_ip = info.get('ip')
        if my_ip:
            for _, s_obj in ifaces.items():
                if hasattr(s_obj, 'ips') and my_ip in s_obj.ips:
                    m = getattr(s_obj, 'mac', None)
                    if m:
                        return m.lower().replace('-', ':')
    except Exception as e:
        logger.debug(f"Notice get_self_mac: {e}")

    try:
        raw_mac = getattr(conf.iface, 'mac', None)
        if raw_mac:
            return raw_mac.lower().replace('-', ':')
    except:
        pass
    return "00:00:00:00:00:00"

def get_active_ip() -> Optional[str]:
    """Tanyakan langsung ke routing table OS alamat IPv4 privat aktif mana yang digunakan untuk akses gateway."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if is_valid_private_ip(ip):
                return ip
    except Exception:
        pass
    return None

def get_current_gateway() -> str:
    """Dapatkan default gateway IP yang aktif di sistem saat ini."""
    try:
        gws = netifaces.gateways()
        default_gw = gws.get('default', {}).get(netifaces.AF_INET)
        if default_gw and is_valid_private_ip(default_gw[0]):
            return default_gw[0]
    except:
        pass

    try:
        if sys.platform == 'win32':
            output = subprocess.check_output(
                ["route", "print", "0.0.0.0"],
                text=True,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            for line in output.splitlines():
                if "0.0.0.0" in line:
                    parts = line.split()
                    if (
                        len(parts) >= 3 and
                        parts[0] == "0.0.0.0" and
                        is_valid_private_ip(parts[2])
                    ):
                        return parts[2]
    except:
        pass

    return ""

def get_network_info() -> Dict[str, Any]:
    """Dapatkan informasi adapter jaringan aktif saat ini (Wi-Fi / Ethernet diutamakan, abaikan Bluetooth)."""
    active_ip = get_active_ip()
    current_gw = get_current_gateway()

    # 1. Jika active_ip terdeteksi langsung dari kernel routing, cari interface yang memiliki IP tersebut
    if active_ip and is_valid_private_ip(active_ip) and is_valid_private_ip(current_gw):
        for iface in netifaces.interfaces():
            try:
                addrs = netifaces.ifaddresses(iface)
                if netifaces.AF_INET in addrs:
                    for ip_info in addrs[netifaces.AF_INET]:
                        if ip_info.get('addr') == active_ip:
                            netmask = ip_info.get('netmask', '')
                            network = str(ipaddress.IPv4Network(f"{active_ip}/{netmask}", strict=False))
                            if not is_valid_private_network(network):
                                continue
                            return {
                                'ip': active_ip,
                                'netmask': netmask,
                                'network': network,
                                'gateway': current_gw,
                                'interface': iface
                            }
            except Exception:
                continue

    # 2. Coba default gateway dari netifaces
    try:
        gws = netifaces.gateways()
        default_gw = gws.get('default', {}).get(netifaces.AF_INET)
        if default_gw:
            gw_ip, iface = default_gw[0], default_gw[1]
            addrs = netifaces.ifaddresses(iface)
            if netifaces.AF_INET in addrs:
                ip_info = addrs[netifaces.AF_INET][0]
                ip = ip_info['addr']
                if is_valid_private_ip(ip) and is_valid_private_ip(gw_ip):
                    netmask = ip_info['netmask']
                    network = str(ipaddress.IPv4Network(f"{ip}/{netmask}", strict=False))
                    if is_valid_private_network(network):
                        return {
                            'ip': ip,
                            'netmask': netmask,
                            'network': network,
                            'gateway': gw_ip,
                            'interface': iface
                        }
    except Exception:
        pass

    # 3. Iterasi interface dengan memfilter adapter Bluetooth/Virtual
    ignored_keywords = ['bluetooth', 'loopback', 'virtual', 'vethernet', 'wsl', 'tap', 'host-only', 'npcap']
    candidates = []

    for iface in netifaces.interfaces():
        try:
            iface_lower = str(iface).lower()
            if any(k in iface_lower for k in ignored_keywords):
                continue

            addrs = netifaces.ifaddresses(iface)
            if netifaces.AF_INET in addrs:
                ip_info = addrs[netifaces.AF_INET][0]
                ip = ip_info['addr']
                if is_valid_private_ip(ip) and is_valid_private_ip(current_gw):
                    netmask = ip_info['netmask']
                    network = str(ipaddress.IPv4Network(f"{ip}/{netmask}", strict=False))
                    if is_valid_private_network(network):
                        candidates.append({
                            'ip': ip,
                            'netmask': netmask,
                            'network': network,
                            'gateway': current_gw,
                            'interface': iface
                        })
        except Exception:
            continue

    if candidates:
        return candidates[0]

    return {
        'ip': '',
        'netmask': '',
        'network': '',
        'gateway': '',
        'interface': ''
    }

def get_wifi_info() -> Dict[str, Any]:
    """
    Universal Network Resolver:
    Ambil status koneksi jaringan aktif (Wi-Fi, Ethernet LAN, USB Tethering)
    dengan multi-language parsing & TTL Caching.
    """
    global _WIFI_INFO_CACHE, _WIFI_INFO_CACHE_TIME
    now = time.time()
    with _WIFI_CACHE_LOCK:
        if _WIFI_INFO_CACHE and (now - _WIFI_INFO_CACHE_TIME) < _WIFI_CACHE_TTL:
            return dict(_WIFI_INFO_CACHE)

    wifi_info = {
        'connected': False,
        'ssid': '',
        'bssid': '',
        'signal': '',
        'radio_type': '',
        'channel': '',
        'interface': 'Wi-Fi',
        'interface_type': 'wifi',
        'state': 'disconnected'
    }
    if sys.platform != 'win32':
        return wifi_info

    # 1. Coba deteksi interface Wi-Fi via netsh wlan
    try:
        output = subprocess.check_output(
            ["netsh", "wlan", "show", "interfaces"],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=1.5
        )
        lines = output.splitlines()
        for line in lines:
            line_str = line.strip()
            if not line_str or ':' not in line_str:
                continue
            key, val = [x.strip() for x in line_str.split(':', 1)]
            key_lower = key.lower()
            val_lower = val.lower()

            if any(k in key_lower for k in ('state', 'keadaan', 'status')):
                wifi_info['connected'] = any(s in val_lower for s in ('connected', 'terhubung'))
            elif 'bssid' in key_lower:
                wifi_info['bssid'] = val
            elif 'ssid' in key_lower:
                wifi_info['ssid'] = val
            elif any(k in key_lower for k in ('signal', 'sinyal')):
                wifi_info['signal'] = val
            elif 'radio' in key_lower:
                wifi_info['radio_type'] = val
            elif any(k in key_lower for k in ('channel', 'saluran')):
                wifi_info['channel'] = val
            elif any(k in key_lower for k in ('name', 'nama')) and not wifi_info['ssid']:
                wifi_info['interface'] = val
    except Exception as e:
        logger.debug(f"Notice netsh wifi info: {e}")

    # 2. Universal Fallback: Jika Wi-Fi tidak terhubung, periksa apakah terhubung via Ethernet LAN / Tethering
    if not wifi_info['connected']:
        try:
            import psutil
            gw = get_current_gateway()
            if gw and gw != "0.0.0.0":
                stats = psutil.net_if_stats()
                addrs = psutil.net_if_addrs()
                for iface_name, stat in stats.items():
                    if stat.isup and 'loopback' not in iface_name.lower():
                        if_addrs = addrs.get(iface_name, [])
                        for a in if_addrs:
                            if a.family == socket.AF_INET and not a.address.startswith('127.') and not a.address.startswith('169.254.'):
                                name_lower = iface_name.lower()
                                if any(x in name_lower for x in ('ethernet', 'local area', 'lan', 'eth')):
                                    wifi_info['connected'] = True
                                    wifi_info['ssid'] = 'Ethernet (LAN)'
                                    wifi_info['signal'] = '100%'
                                    wifi_info['interface'] = iface_name
                                    wifi_info['interface_type'] = 'ethernet'
                                    break
                                elif any(x in name_lower for x in ('rndis', 'tether', 'cellular', 'mobile')):
                                    wifi_info['connected'] = True
                                    wifi_info['ssid'] = 'Mobile / USB Hotspot'
                                    wifi_info['signal'] = '100%'
                                    wifi_info['interface'] = iface_name
                                    wifi_info['interface_type'] = 'tethering'
                                    break
                                elif not wifi_info['connected'] and 'wi-fi' not in name_lower and 'wlan' not in name_lower:
                                    wifi_info['connected'] = True
                                    wifi_info['ssid'] = f"Koneksi LAN ({iface_name})"
                                    wifi_info['signal'] = '100%'
                                    wifi_info['interface'] = iface_name
                                    wifi_info['interface_type'] = 'ethernet'
                                    break
                        if wifi_info['connected']:
                            break
        except Exception as e:
            logger.debug(f"Notice universal network fallback: {e}")

    wifi_info['state'] = 'connected' if wifi_info['connected'] else 'disconnected'

    with _WIFI_CACHE_LOCK:
        _WIFI_INFO_CACHE = dict(wifi_info)
        _WIFI_INFO_CACHE_TIME = now

    return wifi_info

def is_network_changed(prev_gateway: str, prev_interface: str) -> bool:
    """Deteksi apakah gateway atau interface jaringan mengalami perubahan."""
    curr_gateway = get_current_gateway()
    if not curr_gateway:
        return False
    try:
        info = get_network_info()
        curr_interface = info.get('interface', '')
    except:
        curr_interface = ''
    if prev_gateway != curr_gateway or prev_interface != curr_interface:
        logger.warning(f"🔥 JARINGAN BERUBAH! Gateway: {prev_gateway}->{curr_gateway}, Iface: {prev_interface}->{curr_interface}")
        return True
    return False

def is_forwarding_enabled(win_iface_name: Optional[str] = None) -> bool:
    """
    Baca state IP forwarding saat ini (untuk disimpan sebagai baseline & dipulihkan).
    Windows: parse `netsh interface ipv4 show interface <iface>`.
    Linux: baca /proc/sys/net/ipv4/ip_forward.
    """
    try:
        if sys.platform == 'win32':
            iface_name = win_iface_name or "Wi-Fi"
            out = subprocess.check_output(
                ["netsh", "interface", "ipv4", "show", "interface", str(iface_name)],
                text=True,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            for line in out.splitlines():
                if "forwarding" in line.lower():
                    return "enabled" in line.lower()
            return False
        else:
            with open('/proc/sys/net/ipv4/ip_forward') as f:
                return f.read().strip() == '1'
    except Exception:
        return False

def set_ip_forwarding(enabled: bool, win_iface_name: Optional[str] = None) -> bool:
    """Aktifkan atau nonaktifkan IP forwarding & Weak Host Model di level OS kernel."""
    target_state = "enabled" if enabled else "disabled"
    try:
        if sys.platform == 'win32':
            iface_name = win_iface_name or "Wi-Fi"
            # 1. IP Forwarding
            res = subprocess.run(
                ["netsh", "interface", "ipv4", "set", "interface", str(iface_name), f"forwarding={target_state}"],
                capture_output=True, text=True, check=False
            )
            # 2. Weak Host Model (Wajib agar kernel Windows mengizinkan intra-interface packet routing)
            subprocess.run(
                ["netsh", "interface", "ipv4", "set", "interface", str(iface_name), f"weakhostsend={target_state}"],
                capture_output=True, text=True, check=False
            )
            subprocess.run(
                ["netsh", "interface", "ipv4", "set", "interface", str(iface_name), f"weakhostreceive={target_state}"],
                capture_output=True, text=True, check=False
            )
            if res.returncode == 0:
                logger.info(f"✅ IP Forwarding & WeakHost {target_state} on interface '{iface_name}'")
                return True
            else:
                logger.warning(f"⚠️ Gagal set IP Forwarding: {res.stderr.strip() or res.stdout.strip()}")
                return False
        else:
            val = '1' if enabled else '0'
            with open('/proc/sys/net/ipv4/ip_forward', 'w') as f:
                f.write(val)
            logger.info(f"✅ IP Forwarding set to {val}")
            return True
    except Exception as e:
        logger.warning(f"⚠️ Gagal set IP Forwarding: {e}")
        return False
