"""
ARP Discovery & Subnet Sweeping Subsystem
"""

import sys
import subprocess
import re
import socket
import concurrent.futures
import random
import time
from typing import Dict
from scapy.all import Ether, ARP, srp, conf
from ..network import (
    get_self_mac,
    get_network_info,
    is_valid_mac,
    is_valid_private_ip,
    is_valid_private_network,
)
from ...utils.logger import logger

def probe_sleeping_host_via_gateway_arp(
    target_ip: str,
    target_mac: str,
    gateway_ip: str,
    discovered: Dict[str, str],
    timeout: float = 0.25
) -> None:
    """
    Kirim Unicast ARP Request dengan psrc = gateway_ip (Gateway-Disguised Probe).
    Membangunkan chipset Wi-Fi smartphone yang sedang Doze Sleep / Battery Saver
    karena smartphone selalu membalas ARP dari router gateway agar IP sewaannya tidak dicabut.
    """
    try:
        if not is_valid_private_ip(target_ip) or not is_valid_mac(target_mac) or not gateway_ip:
            return
        if target_ip in discovered:
            return

        self_mac = (get_self_mac() or '').lower().replace('-', ':')
        if not self_mac or not is_valid_mac(self_mac):
            self_mac = getattr(conf.iface, 'mac', None)
        if self_mac:
            self_mac = self_mac.lower().replace('-', ':')

        # Paket Unicast ARP: Ethernet dst = target_mac, Ethernet src = self_mac, ARP psrc = gateway_ip, pdst = target_ip
        unicast_arp = Ether(dst=target_mac, src=self_mac) / ARP(
            op=1, # who-has
            hwsrc=self_mac,
            psrc=gateway_ip,
            hwdst=target_mac,
            pdst=target_ip
        )
        ans, _ = srp(unicast_arp, timeout=timeout, verbose=False, retry=0)
        for _, rcv in ans:
            if rcv.haslayer(ARP):
                rcv_mac = rcv[ARP].hwsrc.lower().replace('-', ':')
                if is_valid_mac(rcv_mac):
                    discovered[target_ip] = rcv_mac
                    logger.debug(f"📱 [Doze Wakeup] Sleeping host {target_ip} ({rcv_mac}) responded to gateway-disguised probe!")
                    break
    except Exception as e:
        logger.debug(f"Sleeping host probe notice for {target_ip}: {e}")

def get_mac_from_arp(ip: str) -> str:
    """Ambil MAC address untuk IP tertentu dari ARP cache kernel OS."""
    try:
        if sys.platform == 'win32':
            # Argumen list tanpa shell=True (hindari interpolasi shell) + sembunyikan konsol.
            output = subprocess.check_output(
                ["arp", "-a", ip], text=True,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            pattern = r'(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F-]{17})'
            matches = re.findall(pattern, output)
            if matches:
                return matches[0][1].replace('-', ':').lower()
        else:
            output = subprocess.check_output(["arp", "-n", ip], text=True)
            pattern = r'(\d+\.\d+\.\d+\.\d+)\s+(\S+)'
            matches = re.findall(pattern, output)
            if matches:
                return matches[0][1].lower()
        return ""
    except:
        return ""

def collect_from_arp_cache(discovered: Dict[str, str]) -> None:
    """Kumpulkan IP & MAC dari tabel ARP lokal OS (< 0.05s)."""
    try:
        self_mac = (get_self_mac() or '').lower().replace('-', ':')
        curr_net = None
        try:
            info = get_network_info()
            self_ip = info.get('ip', '')
            if info.get('network'):
                import ipaddress
                curr_net = ipaddress.IPv4Network(info['network'], strict=False)
        except:
            pass

        if sys.platform == 'win32':
            output = subprocess.check_output(
                ["arp", "-a"], text=True,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            pattern = r'(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F-]{17})'
            for ip, mac in re.findall(pattern, output):
                norm_mac = mac.replace('-', ':').lower()
                if (is_valid_private_ip(ip) and
                    is_valid_mac(norm_mac) and
                    not norm_mac.startswith('ff:ff:ff') and
                    not norm_mac.startswith('01:00:5e') and
                    not ip.endswith('.255') and
                    ip != self_ip and
                    norm_mac != self_mac and
                    ip not in discovered):
                    if curr_net:
                        try:
                            import ipaddress
                            if ipaddress.IPv4Address(ip) not in curr_net:
                                continue
                        except:
                            pass
                    discovered[ip] = norm_mac
        else:
            output = subprocess.check_output(["arp", "-n"], text=True)
            pattern = r'(\d+\.\d+\.\d+\.\d+)\s+\S+\s+([0-9a-fA-F:]{17})'
            for ip, mac in re.findall(pattern, output):
                norm_mac = mac.lower()
                if (is_valid_private_ip(ip) and
                    is_valid_mac(norm_mac) and
                    ip != self_ip and
                    norm_mac != self_mac and
                    ip not in discovered):
                    discovered[ip] = norm_mac
    except Exception as e:
        logger.debug(f"ARP cache read notice: {e}")

def collect_from_arp_broadcast(discovered: Dict[str, str], timeout: float = 1.0) -> None:
    """Active Layer 2 ARP Request Broadcast ke seluruh subnet via Scapy srp()."""
    try:
        import ipaddress
        net_info = get_network_info()
        network_cidr = net_info.get('network')
        if not is_valid_private_network(network_cidr):
            return

        # PENCEGAHAN BROADCAST STORM PADA SUPERNET /16 ATAU /8:
        # Jika subnet lebih besar dari /22 (> 1024 host), batasi broadcast
        # ke blok /24 lokal di sekitar host agar tidak memicu AP rate-limiting / storm control.
        try:
            net_obj = ipaddress.IPv4Network(network_cidr, strict=False)
            if net_obj.num_addresses > 1024:
                my_ip = net_info.get('ip', '')
                if my_ip and is_valid_private_ip(my_ip):
                    network_cidr = f"{my_ip.rsplit('.', 1)[0]}.0/24"
        except:
            pass

        arp_req = Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(pdst=network_cidr)
        ans, _ = srp(arp_req, timeout=timeout, verbose=False, retry=1)

        self_mac = (get_self_mac() or '').lower().replace('-', ':')
        self_ip = net_info.get('ip', '')

        for _, rcv in ans:
            if rcv.haslayer(ARP):
                ip = rcv[ARP].psrc
                mac = rcv[ARP].hwsrc.lower().replace('-', ':')
                if (is_valid_private_ip(ip) and
                    is_valid_mac(mac) and
                    ip != self_ip and
                    mac != self_mac and
                    ip not in discovered):
                    discovered[ip] = mac
    except Exception as e:
        logger.warning(f"ARP broadcast scan notice: {e}")

def sweep_subnet_for_arp(discovered: Dict[str, str]) -> None:
    """
    Sweep seluruh IP di subnet menggunakan soket non-blocking.
    Memaksa kernel OS melakukan resolusi ARP ke semua host, termasuk Windows ber-firewall stealth.
    Dilengkapi Stealth Randomized Shuffling & Micro-Jitter untuk menghindari alarm IDS/IPS.
    Mendukung supernet (/22, /20, /24) secara cerdas.
    """
    try:
        import ipaddress
        info = get_network_info()
        network_cidr = info.get('network', '')
        self_ip = info.get('ip', '')
        gateway_ip = info.get('gateway', '')

        if not is_valid_private_network(network_cidr):
            return

        if self_ip and is_valid_private_ip(self_ip):
            safe_base_prefix = self_ip.rsplit('.', 1)[0]
        elif gateway_ip and is_valid_private_ip(gateway_ip):
            safe_base_prefix = gateway_ip.rsplit('.', 1)[0]
        else:
            safe_base_prefix = ''

        candidate_ips = []
        net_obj = ipaddress.IPv4Network(network_cidr, strict=False)
        if net_obj.num_addresses <= 1024:
            candidate_ips = [str(ip) for ip in net_obj.hosts()]
        elif safe_base_prefix:
            candidate_ips = [f"{safe_base_prefix}.{i}" for i in range(1, 255)]
        else:
            return

        # Stealth Shuffling: Acak urutan IP target agar tidak membentuk pola staircase scan
        random.shuffle(candidate_ips)

        def probe_ip(target_ip: str):
            if not is_valid_private_ip(target_ip) or target_ip == self_ip or target_ip in discovered:
                return

            # Micro-jitter acak 1ms - 4ms untuk menghindari signature IDS
            time.sleep(random.uniform(0.001, 0.004))

            # 1. Probe UDP mDNS (5353) untuk membangun ARP cache
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as u:
                    u.settimeout(0.06)
                    u.sendto(b'', (target_ip, 5353))
            except Exception:
                pass

            # 2. Probe TCP port 80 cepat (cukup 1 paket untuk memicu kernel OS mengirim ARP)
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(0.04)
                    s.connect_ex((target_ip, 80))
            except Exception:
                pass

        with concurrent.futures.ThreadPoolExecutor(max_workers=75) as ex:
            list(ex.map(probe_ip, candidate_ips))
    except Exception as e:
        logger.debug(f"Subnet sweep notice: {e}")

    collect_from_arp_cache(discovered)
