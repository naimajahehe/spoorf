"""
Passive DHCP Sniffer Daemon (UDP 67/68)
=======================================
Menangkap DHCP Discover, Request, ACK, dan Release.
Mengekstrak Hostname, Vendor Class, OS Fingerprint (PRL), Client ID, dan FQDN.
"""

import threading
import time
from typing import Dict, Any, Optional, Callable
from scapy.all import (
    sniff,
    conf,
    ifaces,
    BOOTP,
    DHCP,
    Ether,
    IPv6,
    DHCP6,
    DHCP6OptClientId,
    DHCP6OptVendorClass,
    DHCP6OptClientFQDN,
    DHCP6OptOptReq
)
from ..network import get_network_info, get_self_mac, is_valid_mac, is_valid_private_ip
from ...utils.logger import logger

_DHCP_PROFILE_FIELDS = (
    'ip',
    'hostname',
    'vendor_class',
    'dhcp_fingerprint',
    'client_id',
    'fqdn',
)


def diff_dhcp_profiles(
    before: Dict[str, Dict[str, Any]],
    after: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    """Bandingkan snapshot DHCP unik berbasis MAC dan laporkan delta profil."""
    before_macs = set(before)
    after_macs = set(after)
    new_macs = sorted(after_macs - before_macs)
    updated_macs = sorted(
        mac
        for mac in before_macs & after_macs
        if any(
            before[mac].get(field) != after[mac].get(field)
            for field in _DHCP_PROFILE_FIELDS
        )
    )
    unchanged_macs = sorted((before_macs & after_macs) - set(updated_macs))
    return {
        'before_count': len(before),
        'after_count': len(after),
        'new_count': len(new_macs),
        'updated_count': len(updated_macs),
        'unchanged_count': len(unchanged_macs),
        'new_macs': new_macs,
        'updated_macs': updated_macs,
        'unchanged_macs': unchanged_macs,
    }


class DHCPDiscoveredCache:
    """
    Thread-safe & Anti-Contamination Cache untuk temuan passive DHCP sniffer.
    - Kunci primer adalah MAC address (hardware / persistent randomized).
    - Smart merge: mempertahankan field bernilai lama jika field paket baru kosong.
    - Anti IP Churn: pemetaan IP di-reset total jika kepemilikan IP berpindah ke MAC lain.
    - LRU Eviction: batas memori maksimal 300 perangkat.
    """
    def __init__(self, max_capacity: int = 300):
        self._lock = threading.Lock()
        self._cache_by_mac: Dict[str, Dict[str, Any]] = {}
        self._ip_to_mac: Dict[str, str] = {}
        self._max_capacity = max_capacity

    def update(self, mac: str, ip: str, entry: Dict[str, Any]):
        with self._lock:
            norm_mac = mac.lower().replace('-', ':') if mac else ''
            clean_ip = ip.strip() if (ip and is_valid_private_ip(ip)) else ''

            if not norm_mac and not clean_ip:
                return

            # Ambil entri lama jika ada (berdasarkan MAC sebagai identitas tunggal)
            old_entry = self._cache_by_mac.get(norm_mac, {}) if norm_mac else {}

            # Smart merge: pertahankan nilai non-empty lama jika nilai baru kosong
            merged = {
                'mac': norm_mac or old_entry.get('mac', ''),
                'ip': clean_ip or old_entry.get('ip', ''),
                'hostname': entry.get('hostname') or old_entry.get('hostname', ''),
                'vendor_class': entry.get('vendor_class') or old_entry.get('vendor_class', ''),
                'dhcp_fingerprint': entry.get('dhcp_fingerprint') or old_entry.get('dhcp_fingerprint', ''),
                'client_id': entry.get('client_id') or old_entry.get('client_id', ''),
                'fqdn': entry.get('fqdn') or old_entry.get('fqdn', ''),
                'message_type': entry.get('message_type') or old_entry.get('message_type', ''),
                'message_type_code': entry.get('message_type_code') if entry.get('message_type_code') is not None else old_entry.get('message_type_code'),
                'lease_time': entry.get('lease_time') or old_entry.get('lease_time'),
                'router_ip': entry.get('router_ip') or old_entry.get('router_ip', ''),
                'server_id': entry.get('server_id') or old_entry.get('server_id', ''),
                'is_rogue_dhcp': entry.get('is_rogue_dhcp') if entry.get('is_rogue_dhcp') is not None else old_entry.get('is_rogue_dhcp', False),
                'rogue_server_ip': entry.get('rogue_server_ip') or old_entry.get('rogue_server_ip', ''),
                'rogue_server_mac': entry.get('rogue_server_mac') or old_entry.get('rogue_server_mac', ''),
                'is_release': entry.get('is_release') if entry.get('is_release') is not None else old_entry.get('is_release', False),
                'is_decline': entry.get('is_decline') if entry.get('is_decline') is not None else old_entry.get('is_decline', False),
                'last_seen': entry.get('last_seen', time.strftime("%Y-%m-%d %H:%M:%S")),
                'last_seen_ts': entry.get('last_seen_ts') or old_entry.get('last_seen_ts') or time.time()
            }

            # Simpan ke cache primer MAC
            if norm_mac:
                # Eviction check jika melebihi kapasitas
                if len(self._cache_by_mac) >= self._max_capacity and norm_mac not in self._cache_by_mac:
                    # Buang entri dengan last_seen paling tua
                    oldest_mac = min(
                        self._cache_by_mac.keys(),
                        key=lambda m: self._cache_by_mac[m].get('last_seen', '')
                    )
                    del self._cache_by_mac[oldest_mac]
                    # Hapus mapping IP lama yang merujuk ke oldest_mac
                    stale_ips = [k for k, v in self._ip_to_mac.items() if v == oldest_mac]
                    for s_ip in stale_ips:
                        del self._ip_to_mac[s_ip]

                self._cache_by_mac[norm_mac] = merged

            # Kelola pemetaan dinamis IP -> MAC (Anti IP Churn / Reassignment Protection)
            if clean_ip and norm_mac:
                self._ip_to_mac[clean_ip] = norm_mac

    def get(self, key: str, default=None):
        """Mencari entri berdasarkan MAC address terlebih dahulu, lalu via mapping IP."""
        with self._lock:
            norm_key = key.lower().replace('-', ':')
            # 1. Cek langsung via MAC
            if norm_key in self._cache_by_mac:
                return dict(self._cache_by_mac[norm_key])
            # 2. Cek via mapping IP -> MAC
            if key in self._ip_to_mac:
                target_mac = self._ip_to_mac[key]
                if target_mac in self._cache_by_mac:
                    return dict(self._cache_by_mac[target_mac])
            return default

    def get_snapshot(self) -> Dict[str, Dict[str, Any]]:
        """Snapshot dictionary kompatibel untuk seluruh consumer (keyed by MAC dan IP)."""
        with self._lock:
            snapshot = {}
            for mac, entry in self._cache_by_mac.items():
                snapshot[mac] = dict(entry)
            for ip, mac in self._ip_to_mac.items():
                if mac in self._cache_by_mac:
                    snapshot[ip] = dict(self._cache_by_mac[mac])
            return snapshot

    def get_unique_snapshot(self) -> Dict[str, Dict[str, Any]]:
        """Snapshot satu-entri-per-MAC untuk statistik dan perbandingan profil."""
        with self._lock:
            return {
                mac: dict(entry)
                for mac, entry in self._cache_by_mac.items()
            }

    def clear(self):
        with self._lock:
            self._cache_by_mac.clear()
            self._ip_to_mac.clear()

dhcp_cache = DHCPDiscoveredCache()

_dhcp_sniffer_running: bool = False
_dhcp_sniffer_thread: Optional[threading.Thread] = None
_dhcp_callback: Optional[Callable[[Dict[str, Any]], None]] = None

DHCP_MSG_TYPES = {
    1: "DISCOVER",
    2: "OFFER",
    3: "REQUEST",
    4: "DECLINE",
    5: "ACK",
    6: "NAK",
    7: "RELEASE",
    8: "INFORM"
}

DHCP6_MSG_TYPES = {
    1: "SOLICIT",
    2: "ADVERTISE",
    3: "REQUEST",
    4: "CONFIRM",
    5: "RENEW",
    6: "REBIND",
    7: "REPLY",
    8: "RELEASE",
    9: "DECLINE",
    10: "RECONFIGURE",
    11: "INFORMATION-REQUEST",
    12: "RELAY-FORW",
    13: "RELAY-REPL"
}

def _is_dhcp6_packet(pkt) -> bool:
    """Deteksi apakah paket Scapy merupakan pesan atau opsi DHCPv6."""
    try:
        return any(getattr(l, '__name__', '').startswith('DHCP6') for l in pkt.layers())
    except Exception:
        return False

def _handle_dhcp6_packet(pkt) -> None:
    """Callback parser paket DHCPv6 Scapy (UDP 546/547)."""
    try:
        mac = pkt[Ether].src if pkt.haslayer(Ether) else ''
        if not mac or not is_valid_mac(mac):
            return
        norm_mac = mac.lower().replace('-', ':')

        src_ipv6 = pkt[IPv6].src if pkt.haslayer(IPv6) else ''

        # Cari layer message DHCPv6 untuk mengambil msgtype
        msg_type_code = None
        for l in pkt.layers():
            layer_name = getattr(l, '__name__', '')
            if layer_name.startswith('DHCP6_') or layer_name == 'DHCP6':
                layer_obj = pkt.getlayer(l)
                if layer_obj and hasattr(layer_obj, 'msgtype'):
                    msg_type_code = getattr(layer_obj, 'msgtype')
                    break

        if msg_type_code is None:
            msg_type_code = getattr(pkt, 'msgtype', 1)

        msg_type_name = DHCP6_MSG_TYPES.get(msg_type_code, f"TYPE_{msg_type_code}")

        # Option 1: Client ID (DUID)
        client_id = ""
        if pkt.haslayer(DHCP6OptClientId):
            raw_duid = getattr(pkt[DHCP6OptClientId], 'duid', None)
            if raw_duid:
                if isinstance(raw_duid, bytes):
                    client_id = ':'.join(f"{b:02x}" for b in raw_duid)
                else:
                    client_id = str(raw_duid).strip()

        # Option 16: Vendor Class
        vendor_class = ""
        if pkt.haslayer(DHCP6OptVendorClass):
            raw_vc = getattr(pkt[DHCP6OptVendorClass], 'vcdata', None)
            if raw_vc:
                if isinstance(raw_vc, (list, tuple)):
                    parts = []
                    for item in raw_vc:
                        if isinstance(item, bytes):
                            parts.append(item.decode('utf-8', errors='ignore'))
                        else:
                            parts.append(str(item))
                    vendor_class = ' '.join(parts).strip()
                elif isinstance(raw_vc, bytes):
                    vendor_class = raw_vc.decode('utf-8', errors='ignore').strip()
                else:
                    vendor_class = str(raw_vc).strip()

        # Option 39: FQDN / Hostname
        hostname = ""
        if pkt.haslayer(DHCP6OptClientFQDN):
            raw_fqdn = getattr(pkt[DHCP6OptClientFQDN], 'fqdn', None)
            if raw_fqdn:
                if isinstance(raw_fqdn, bytes):
                    hostname = raw_fqdn.decode('utf-8', errors='ignore').strip()
                else:
                    hostname = str(raw_fqdn).strip()

        # Option 6: Option Request Option (ORO) Fingerprint
        dhcp_fingerprint = ""
        if pkt.haslayer(DHCP6OptOptReq):
            reqopts = getattr(pkt[DHCP6OptOptReq], 'reqopts', None)
            if reqopts:
                oro_str = ','.join(str(x) for x in reqopts)
                if '23' in oro_str and '24' in oro_str and '31' in oro_str:
                    dhcp_fingerprint = "Android DHCPv6 Signature"
                elif '23' in oro_str and '24' in oro_str and '39' in oro_str:
                    dhcp_fingerprint = "Apple iOS/macOS DHCPv6 Signature"
                elif '44' in oro_str or '47' in oro_str:
                    dhcp_fingerprint = "Microsoft Windows DHCPv6 Signature"
                else:
                    dhcp_fingerprint = f"DHCPv6 Signature (ORO: {oro_str})"

        if vendor_class and not dhcp_fingerprint:
            dhcp_fingerprint = f"DHCPv6 Vendor ({vendor_class})"

        is_release = (msg_type_code == 8)
        is_decline = (msg_type_code == 9)

        dhcp_entry = {
            'mac': norm_mac,
            'ip': '',
            'ipv6': src_ipv6,
            'hostname': hostname,
            'vendor_class': vendor_class,
            'dhcp_fingerprint': dhcp_fingerprint,
            'client_id': client_id,
            'fqdn': hostname,
            'message_type': msg_type_name,
            'message_type_code': msg_type_code,
            'lease_time': '',
            'lease_sec': 0,
            'router_ip': '',
            'server_id': '',
            'is_rogue_dhcp': False,
            'rogue_server_ip': '',
            'rogue_server_mac': '',
            'is_release': is_release,
            'is_decline': is_decline,
            'last_seen': time.strftime("%Y-%m-%d %H:%M:%S")
        }

        dhcp_cache.update(norm_mac, '', dhcp_entry)
        logger.info(f"📱 [DHCPv6 Sniffer] ({msg_type_name}): MAC={norm_mac} IPv6={src_ipv6 or '?'} Host='{hostname}' Class='{vendor_class}' DUID='{client_id}' FP='{dhcp_fingerprint}'")

        if _dhcp_callback:
            try:
                _dhcp_callback(dhcp_entry)
            except Exception as cb_err:
                logger.debug(f"DHCPv6 callback notice: {cb_err}")
    except Exception as e:
        logger.debug(f"DHCPv6 packet handling notice: {e}")

def _handle_dhcp_packet(pkt) -> None:
    """Callback parser paket DHCP (IPv4) dan DHCPv6 (IPv6) Scapy."""
    try:
        if _is_dhcp6_packet(pkt):
            _handle_dhcp6_packet(pkt)
            return

        if not pkt.haslayer(DHCP) or not pkt.haslayer(BOOTP):
            return

        bootp = pkt[BOOTP]
        raw_chaddr = bootp.chaddr[:6]
        mac = ':'.join(f"{b:02x}" for b in raw_chaddr) if raw_chaddr else ''
        if not mac or mac == '00:00:00:00:00:00':
            if pkt.haslayer(Ether):
                mac = pkt[Ether].src

        if not mac or not is_valid_mac(mac):
            return

        norm_mac = mac.lower().replace('-', ':')

        # Parsing DHCP Options
        options = dict([o for o in pkt[DHCP].options if isinstance(o, tuple) and len(o) == 2])

        # Option 53: DHCP Message Type
        msg_type_code = options.get('message-type')
        msg_type_name = DHCP_MSG_TYPES.get(msg_type_code, f"TYPE_{msg_type_code}")

        # Option 12: Hostname
        raw_host = options.get('hostname')
        hostname = ""
        if isinstance(raw_host, bytes):
            hostname = raw_host.decode('utf-8', errors='ignore').strip()
        elif isinstance(raw_host, str):
            hostname = raw_host.strip()

        # Option 60: Vendor Class Identifier
        raw_vclass = options.get('vendor_class_id')
        vendor_class = ""
        if isinstance(raw_vclass, bytes):
            vendor_class = raw_vclass.decode('utf-8', errors='ignore').strip()
        elif isinstance(raw_vclass, str):
            vendor_class = raw_vclass.strip()

        # Option 54: Server Identifier (DHCP Server IPv4)
        raw_server_id = options.get('server_id') or options.get(54)
        server_id = ""
        if raw_server_id:
            try:
                if isinstance(raw_server_id, (list, tuple)) and len(raw_server_id) > 0:
                    s_cand = str(raw_server_id[0]).strip()
                    if is_valid_private_ip(s_cand):
                        server_id = s_cand
                elif isinstance(raw_server_id, str) and is_valid_private_ip(raw_server_id.strip()):
                    server_id = raw_server_id.strip()
                elif isinstance(raw_server_id, bytes) and len(raw_server_id) == 4:
                    import socket
                    s_cand = socket.inet_ntoa(raw_server_id)
                    if is_valid_private_ip(s_cand):
                        server_id = s_cand
            except:
                server_id = ""

        # Option 55: Parameter Request List (OS Fingerprint Matrix)
        raw_prl = options.get('param_req_list')
        dhcp_fingerprint = ""
        prl_values = []
        prl_str = ""
        if raw_prl:
            try:
                if isinstance(raw_prl, (list, tuple, bytes, bytearray)):
                    prl_values = [int(value) for value in raw_prl]
                else:
                    prl_values = [
                        int(value.strip())
                        for value in str(raw_prl).split(',')
                        if value.strip()
                    ]
                prl_values = [
                    value for value in prl_values
                    if 0 <= value <= 255
                ]
            except (TypeError, ValueError):
                prl_values = []
            prl_str = ','.join(str(value) for value in prl_values)
        prl_set = set(prl_values)

        # Deterministic PRL + Vendor Class + Hostname Signature Matching
        vclass_lower = vendor_class.lower()
        host_lower = hostname.lower()

        if 'playstation' in vclass_lower or 'playstation' in host_lower:
            dhcp_fingerprint = "Sony PlayStation"
        elif 'nintendo' in vclass_lower or 'nintendo' in host_lower:
            dhcp_fingerprint = "Nintendo Gaming Console"
        elif prl_values[:5] == [1, 121, 3, 6, 15] or ('iphone' in host_lower or 'ipad' in host_lower):
            dhcp_fingerprint = "Apple iOS Signature"
        elif prl_values[:6] == [1, 3, 6, 15, 119, 252] or ('macbook' in host_lower or 'mac-mini' in host_lower or 'imac' in host_lower):
            dhcp_fingerprint = "Apple macOS Signature"
        elif (
            {26, 28, 51, 58, 59}.issubset(prl_set)
            or vclass_lower.startswith('android-dhcp-')
            or {28, 51, 58}.issubset(prl_set)
        ):
            if vclass_lower.startswith('android-dhcp-'):
                dhcp_fingerprint = f"Android OS Signature ({vendor_class})"
            else:
                dhcp_fingerprint = "Android OS Signature"
        elif (
            {31, 33, 43, 44, 46, 47}.issubset(prl_set)
            or {44, 46, 47, 252}.issubset(prl_set)
            or vclass_lower == 'msft 5.0'
        ):
            dhcp_fingerprint = "Microsoft Windows Signature"
        elif (
            prl_values[:6] == [1, 3, 6, 12, 15, 28]
            or prl_values[:8] == [1, 28, 2, 3, 15, 6, 119, 12]
            or 'udhcp' in vclass_lower
            or 'dhcpcd' in vclass_lower
        ):
            dhcp_fingerprint = "Linux/Embedded IoT Signature"
        elif prl_values:
            dhcp_fingerprint = f"Generic PRL ({len(prl_values)} opts)"

        # Option 61: Client Identifier
        raw_cid = options.get('client_id')
        client_id = ""
        if isinstance(raw_cid, bytes):
            client_id = ':'.join(f"{b:02x}" for b in raw_cid)
        elif isinstance(raw_cid, str):
            client_id = raw_cid.strip()

        # Option 81: Client FQDN
        raw_fqdn = options.get('client_FQDN')
        fqdn = ""
        if isinstance(raw_fqdn, bytes):
            if len(raw_fqdn) > 3:
                fqdn = raw_fqdn[3:].decode('utf-8', errors='ignore').strip('').strip()
        elif isinstance(raw_fqdn, str):
            fqdn = raw_fqdn.strip()

        # Option 51: IP Address Lease Time (seconds)
        raw_lease = options.get('lease_time') or options.get(51)
        lease_sec = 0
        lease_str = ""
        if raw_lease is not None:
            try:
                if isinstance(raw_lease, bytes):
                    lease_sec = int.from_bytes(raw_lease, byteorder='big')
                elif isinstance(raw_lease, int):
                    lease_sec = raw_lease

                # Defensive Guard: Cegah crash OverflowError pada Windows C-runtime time_t
                if lease_sec >= 0xFFFFFFFF or lease_sec > 2592000:
                    lease_str = "Permanent / Infinite Lease"
                elif lease_sec > 0:
                    lease_str = f"{lease_sec}s ({round(lease_sec / 3600, 1)}h)"
            except:
                lease_str = ""

        # Option 3: Router / Default Gateway
        raw_router = options.get('router') or options.get(3)
        router_ip = ""
        if raw_router:
            try:
                if isinstance(raw_router, (list, tuple)) and len(raw_router) > 0:
                    candidate = str(raw_router[0]).strip()
                    if is_valid_private_ip(candidate):
                        router_ip = candidate
                elif isinstance(raw_router, str) and is_valid_private_ip(raw_router.strip()):
                    router_ip = raw_router.strip()
            except:
                router_ip = ""

        # Alamat IP: Option 50 (requested_addr) atau yiaddr/ciaddr
        ip = ""
        for candidate in (
            options.get('requested_addr'),
            bootp.yiaddr,
            bootp.ciaddr,
        ):
            clean_candidate = str(candidate).strip() if candidate else ""
            if is_valid_private_ip(clean_candidate):
                ip = clean_candidate
                break

        # Deteksi Rogue DHCP Server (Opsi 54 != Gateway Resmi pada respon OFFER/ACK)
        is_rogue_dhcp = False
        active_dhcp_server = server_id
        if not active_dhcp_server and pkt.haslayer('IP'):
            active_dhcp_server = pkt['IP'].src

        # Ekstrak MAC fisik pengirim paket balasan server (Ethernet Source MAC)
        server_phys_mac = ""
        if pkt.haslayer(Ether):
            server_phys_mac = pkt[Ether].src.lower().replace('-', ':')

        if msg_type_code in (2, 5, 6) and active_dhcp_server:
            try:
                net_info = get_network_info()
                official_gw = net_info.get('gateway', '')
                my_ip = net_info.get('ip', '')
                my_mac = (get_self_mac() or '').lower().replace('-', ':')
                if (is_valid_private_ip(active_dhcp_server) and 
                    official_gw and 
                    active_dhcp_server != official_gw and 
                    active_dhcp_server != my_ip and
                    server_phys_mac != my_mac and
                    norm_mac != my_mac):
                    is_rogue_dhcp = True
                    logger.warning(
                        f"🚨 [DHCP Sniffer] ROGUE DHCP SERVER DETECTED! Server IP: {active_dhcp_server}, "
                        f"Server Physical MAC: {server_phys_mac or norm_mac}, Official Gateway: {official_gw}"
                    )
            except Exception:
                pass

        # Penanganan Event DHCP RELEASE (Opsi 53 = 7) & DECLINE (Opsi 53 = 4)
        is_release = (msg_type_code == 7)
        is_decline = (msg_type_code == 4)
        if is_release:
            logger.info(f"⚡ [DHCP Sniffer] Instant Disconnect (DHCP RELEASE) from MAC={norm_mac} IP={ip or '?'}")
        elif is_decline:
            logger.warning(f"⚠️ [DHCP Sniffer] IP Conflict Detected (DHCP DECLINE): MAC={norm_mac} reported IP={ip or '?'} is already occupied!")

        dhcp_entry = {
            'mac': norm_mac,
            'ip': ip,
            'hostname': hostname,
            'vendor_class': vendor_class,
            'dhcp_fingerprint': dhcp_fingerprint,
            'client_id': client_id,
            'fqdn': fqdn,
            'message_type': msg_type_name,
            'message_type_code': msg_type_code,
            'lease_time': lease_str,
            'lease_sec': lease_sec,
            'router_ip': router_ip,
            'server_id': server_id,
            'is_rogue_dhcp': is_rogue_dhcp,
            'rogue_server_ip': active_dhcp_server if is_rogue_dhcp else '',
            'rogue_server_mac': (server_phys_mac or norm_mac) if is_rogue_dhcp else '',
            'is_release': is_release,
            'is_decline': is_decline,
            'last_seen': time.strftime("%Y-%m-%d %H:%M:%S")
        }

        dhcp_cache.update(norm_mac, ip, dhcp_entry)

        logger.info(f"📱 [DHCP Sniffer] ({msg_type_name}): MAC={norm_mac} IP={ip or '?'} Host='{hostname}' Class='{vendor_class}' FP='{dhcp_fingerprint}' Lease='{lease_str}' GW='{router_ip}' Rogue={is_rogue_dhcp}")

        if _dhcp_callback:
            try:
                _dhcp_callback(dhcp_entry)
            except Exception as cb_err:
                logger.debug(f"DHCP callback notice: {cb_err}")
    except Exception as e:
        logger.debug(f"DHCP packet handling notice: {e}")

def start_dhcp_sniffer(callback=None) -> None:
    """Nyalakan Passive DHCP Sniffer Daemon di thread latar belakang dengan auto-healing."""
    global _dhcp_sniffer_running, _dhcp_sniffer_thread, _dhcp_callback
    if _dhcp_sniffer_running:
        return

    _dhcp_callback = callback
    _dhcp_sniffer_running = True

    def sniffer_worker():
        logger.info("👂 [DHCP Sniffer] Passive Dual-Stack DHCP Listener aktif (UDP 67/68/546/547)...")
        while _dhcp_sniffer_running:
            try:
                info = get_network_info()
                my_ip = info.get('ip')
                scapy_iface = None
                if my_ip:
                    for _, s_obj in ifaces.items():
                        if hasattr(s_obj, 'ips') and my_ip in s_obj.ips:
                            scapy_iface = s_obj
                            break
                if not scapy_iface:
                    scapy_iface = conf.iface

                sniff(
                    iface=scapy_iface,
                    filter="udp and (port 67 or port 68 or port 546 or port 547)",
                    prn=_handle_dhcp_packet,
                    store=False,
                    stop_filter=lambda p: not _dhcp_sniffer_running
                )
            except Exception as e:
                if not _dhcp_sniffer_running:
                    break
                logger.warning(f"DHCP sniffer transient error: {e}, auto-recovering in 3s...")
                time.sleep(3)
        logger.info("⏹️ [DHCP Sniffer] Listener stopped cleanly.")

    _dhcp_sniffer_thread = threading.Thread(target=sniffer_worker, daemon=True, name="dhcp-sniffer-daemon")
    _dhcp_sniffer_thread.start()

def stop_dhcp_sniffer() -> None:
    """Hentikan thread sniffer DHCP seketika via Self-Packet Loopback Wakeup."""
    global _dhcp_sniffer_running, _dhcp_sniffer_thread
    _dhcp_sniffer_running = False

    # Bangunkan C-level Scapy/Npcap seketika menggunakan loopback dummy packet (menghilangkan blocking hang)
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.1)
        s.sendto(b'\x00', ('127.0.0.1', 67))
        s.close()
    except:
        pass

    if _dhcp_sniffer_thread and _dhcp_sniffer_thread.is_alive():
        _dhcp_sniffer_thread.join(timeout=0.4)
