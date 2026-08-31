"""
IPv6 Neighbor Discovery Protocol (NDP) & Multicast Sensor
=========================================================
Modul penemuan host IPv6 berbasis NDP (RFC 4861) dan All-Nodes Multicast (RFC 4291).
Mendukung ekstraksi alamat Link-Local (fe80::), Global Unicast (2000::/3), dan SLAAC.
"""

import sys
import time
import socket
import ipaddress
import subprocess
from typing import Dict, Any, List, Optional
from scapy.all import (
    srp, conf, Ether, IPv6, ICMPv6EchoRequest,
    ICMPv6ND_NS, ICMPv6ND_NA, ICMPv6NDOptSrcLLAddr
)
from ...utils.logger import logger

def is_valid_ipv6(addr: str) -> bool:
    """Validasi apakah string merupakan alamat IPv6 yang valid dan bukan loopback."""
    if not addr or not isinstance(addr, str):
        return False
    # Bersihkan scope ID Windows/Linux jika ada (e.g. fe80::1%14 atau fe80::1%Wi-Fi)
    clean_addr = addr.split('%')[0].strip()
    try:
        ip_obj = ipaddress.IPv6Address(clean_addr)
        # Jangan anggap loopback (::1) atau unspecified (::) sebagai host valid
        if ip_obj.is_loopback or ip_obj.is_unspecified:
            return False
        return True
    except (ValueError, ipaddress.AddressValueError):
        return False

def categorize_ipv6(addr: str) -> str:
    """
    Kategorikan tipe alamat IPv6:
    - 'link_local': fe80::/10
    - 'global': 2000::/3 (Public Internet Routable)
    - 'ula': fc00::/7 (Unique Local Address)
    - 'multicast': ff00::/8
    """
    clean_addr = addr.split('%')[0].strip()
    try:
        ip_obj = ipaddress.IPv6Address(clean_addr)
        if ip_obj.is_link_local:
            return 'link_local'
        if ip_obj.is_multicast:
            return 'multicast'
        # Unique Local Address (ULA fc00::/7)
        if ip_obj in ipaddress.IPv6Network('fc00::/7'):
            return 'ula'
        # Global Unicast Address (2000::/3)
        if ip_obj in ipaddress.IPv6Network('2000::/3') or ip_obj.is_global:
            return 'global'
        return 'other'
    except:
        return 'unknown'

def verify_ipv6_alive(mac: str, ipv6_addr: str, self_mac: str = "", timeout: float = 0.5, retries: int = 1) -> bool:
    """
    Verifikasi liveness AKTIF sebuah neighbor IPv6 via ICMPv6 Neighbor Solicitation -> Advertisement
    (NUD, RFC 4861). Wajib dijawab host yang hidup, lebih andal daripada Echo (yang bisa difilter).
    Mengembalikan True HANYA jika ada Neighbor Advertisement balasan (perangkat benar-benar hidup);
    False bila tidak ada balasan (perangkat mati / entri NDP basi).

    `retries` menambah retransmisi NS agar tahan terhadap loss Wi-Fi / radio power-save (Doze),
    mengurangi risiko false-offline pada perangkat idle-tapi-hidup. Dipakai untuk mencegah status
    ONLINE palsu dari entri Neighbor Cache STALE.
    """
    clean_addr = (ipv6_addr or '').split('%')[0].strip()
    norm_mac = (mac or '').lower().replace('-', ':')
    if not is_valid_ipv6(clean_addr):
        return False
    if len(norm_mac.split(':')) != 6:
        return False
    try:
        conf.verb = 0
        ns = (
            Ether(dst=norm_mac) /
            IPv6(dst=clean_addr) /
            ICMPv6ND_NS(tgt=clean_addr)
        )
        if self_mac:
            ns = ns / ICMPv6NDOptSrcLLAddr(lladdr=self_mac.lower().replace('-', ':'))
        ans, _ = srp(ns, timeout=timeout, retry=max(0, retries), verbose=0)
        for _snd, rcv in ans:
            if rcv is not None and rcv.haslayer(ICMPv6ND_NA):
                return True
        return False
    except Exception as e:
        logger.debug(f"Notice verifying IPv6 liveness for {clean_addr}: {e}")
        return False

def collect_from_ndp_cache(discovered_ipv6: Dict[str, Dict[str, Any]]) -> None:
    """
    Membaca tabel Neighbor Cache IPv6 dari kernel OS (Windows & Linux).
    Format hasil: discovered_ipv6[norm_mac] = { 'link_local': ..., 'global': ..., 'addresses': [...] }
    """
    try:
        if sys.platform == 'win32':
            # Gunakan netsh ipv6 show neighbors (eksekusi sangat cepat < 0.05 detik)
            res = subprocess.run(
                ['netsh', 'interface', 'ipv6', 'show', 'neighbors'],
                capture_output=True, text=True, check=False, timeout=1.5
            )
            if res.returncode == 0:
                lines = res.stdout.splitlines()
                for line in lines:
                    parts = line.split()
                    # Format umum: [IPv6 Address] [MAC/Physical Address] [Type]
                    if len(parts) >= 2:
                        raw_ip = parts[0].strip()
                        raw_mac = parts[1].strip()
                        
                        # Validasi format MAC (e.g. 4e-e1-14-14-ad-87 atau 4e:e1:14:14:ad:87)
                        if '-' in raw_mac or ':' in raw_mac:
                            norm_mac = raw_mac.lower().replace('-', ':')
                            if len(norm_mac.split(':')) == 6 and is_valid_ipv6(raw_ip):
                                clean_ip = raw_ip.split('%')[0]
                                if norm_mac not in discovered_ipv6:
                                    discovered_ipv6[norm_mac] = {
                                        'mac': norm_mac,
                                        'link_local': None,
                                        'global': None,
                                        'addresses': []
                                    }
                                
                                if clean_ip not in discovered_ipv6[norm_mac]['addresses']:
                                    discovered_ipv6[norm_mac]['addresses'].append(clean_ip)
                                
                                cat = categorize_ipv6(clean_ip)
                                if cat == 'link_local' and not discovered_ipv6[norm_mac]['link_local']:
                                    discovered_ipv6[norm_mac]['link_local'] = clean_ip
                                elif cat == 'global' and not discovered_ipv6[norm_mac]['global']:
                                    discovered_ipv6[norm_mac]['global'] = clean_ip
        else:
            # Linux / macOS: ip -6 neigh show
            res = subprocess.run(
                ['ip', '-6', 'neigh', 'show'],
                capture_output=True, text=True, check=False, timeout=1.5
            )
            if res.returncode == 0:
                lines = res.stdout.splitlines()
                for line in lines:
                    parts = line.split()
                    # Format: fe80::... dev eth0 lladdr 00:11:22:33:44:55 REACHABLE
                    if 'lladdr' in parts:
                        idx = parts.index('lladdr')
                        if idx + 1 < len(parts):
                            raw_ip = parts[0]
                            raw_mac = parts[idx + 1]
                            norm_mac = raw_mac.lower().replace('-', ':')
                            if is_valid_ipv6(raw_ip) and len(norm_mac.split(':')) == 6:
                                clean_ip = raw_ip.split('%')[0]
                                if norm_mac not in discovered_ipv6:
                                    discovered_ipv6[norm_mac] = {
                                        'mac': norm_mac,
                                        'link_local': None,
                                        'global': None,
                                        'addresses': []
                                    }
                                if clean_ip not in discovered_ipv6[norm_mac]['addresses']:
                                    discovered_ipv6[norm_mac]['addresses'].append(clean_ip)
                                
                                cat = categorize_ipv6(clean_ip)
                                if cat == 'link_local' and not discovered_ipv6[norm_mac]['link_local']:
                                    discovered_ipv6[norm_mac]['link_local'] = clean_ip
                                elif cat == 'global' and not discovered_ipv6[norm_mac]['global']:
                                    discovered_ipv6[norm_mac]['global'] = clean_ip

    except Exception as e:
        logger.debug(f"Notice reading NDP cache: {e}")

def send_ipv6_all_nodes_multicast(discovered_ipv6: Dict[str, Dict[str, Any]], timeout: float = 0.35) -> None:
    """
    Mengirimkan ICMPv6 Echo Request ke grup All-Nodes Multicast (ff02::1)
    untuk memicu respon dari seluruh host IPv6 aktif pada antarmuka lokal.
    """
    try:
        conf.verb = 0
        pkt = Ether(dst="33:33:00:00:00:01") / IPv6(dst="ff02::1") / ICMPv6EchoRequest(data=b"NETCUT_DISCOVER")
        ans, _ = srp(pkt, timeout=timeout, retry=0, verbose=0)
        for snd, rcv in ans:
            if rcv.haslayer(IPv6):
                src_ip = rcv[IPv6].src
                src_mac = rcv[Ether].src.lower().replace('-', ':') if rcv.haslayer(Ether) else ''
                if src_mac and is_valid_ipv6(src_ip):
                    clean_ip = src_ip.split('%')[0]
                    if src_mac not in discovered_ipv6:
                        discovered_ipv6[src_mac] = {
                            'mac': src_mac,
                            'link_local': None,
                            'global': None,
                            'addresses': []
                        }
                    if clean_ip not in discovered_ipv6[src_mac]['addresses']:
                        discovered_ipv6[src_mac]['addresses'].append(clean_ip)
                    
                    cat = categorize_ipv6(clean_ip)
                    if cat == 'link_local' and not discovered_ipv6[src_mac]['link_local']:
                        discovered_ipv6[src_mac]['link_local'] = clean_ip
                    elif cat == 'global' and not discovered_ipv6[src_mac]['global']:
                        discovered_ipv6[src_mac]['global'] = clean_ip
    except Exception as e:
        logger.debug(f"Notice sending IPv6 All-Nodes multicast: {e}")
