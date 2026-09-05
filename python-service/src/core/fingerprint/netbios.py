"""
NetBIOS (NBNS) & mDNS Name Resolution
"""

import socket
from typing import Dict, Tuple
from scapy.all import IP, UDP, DNS, DNSQR, sr1

def query_netbios(
    ip: str,
    timeout: float = 0.25,
    *,
    strict: bool = False,
) -> Dict[str, str]:
    """Query NetBIOS Name Service (port 137 UDP) untuk Windows/Samba."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(timeout)
            query = (
                b'\x82\x28\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00'
                b'\x20CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\x00\x00\x21\x00\x01'
            )
            s.sendto(query, (ip, 137))
            data, _ = s.recvfrom(1024)

        if len(data) > 56:
            num_names = data[56]
            offset = 57
            names = []
            for _ in range(min(num_names, 8)):
                if offset + 18 <= len(data):
                    raw_name = data[offset:offset+15].decode('ascii', errors='ignore').strip()
                    name_type = data[offset+15]
                    flags = int.from_bytes(data[offset+16:offset+18], 'big')
                    is_group = bool(flags & 0x8000)
                    names.append((raw_name, name_type, is_group))
                    offset += 18

            hostname = ""
            workgroup = ""
            user = ""
            for name, ntype, is_group in names:
                if ntype == 0x00 and not is_group and not hostname:
                    hostname = name
                elif ntype == 0x00 and is_group and not workgroup:
                    workgroup = name
                elif ntype == 0x03 and not is_group and not user:
                    user = name

            return {'hostname': hostname, 'workgroup': workgroup, 'user': user}
    except Exception:
        if strict:
            raise
    return {'hostname': '', 'workgroup': '', 'user': ''}

def query_mdns(ip: str, timeout: float = 0.25) -> str:
    """Query mDNS / Bonjour (port 5353 UDP) untuk Apple, Android, Linux."""
    try:
        octets = ip.split('.')
        arpa = f"{octets[3]}.{octets[2]}.{octets[1]}.{octets[0]}.in-addr.arpa"
        pkt = IP(dst=ip)/UDP(sport=5353, dport=5353)/DNS(rd=1, qd=DNSQR(qname=arpa, qtype='PTR'))
        ans = sr1(pkt, timeout=timeout, verbose=0)
        if ans and ans.haslayer(DNS) and ans[DNS].ancount > 0:
            name = ans[DNS].an.rdata
            if isinstance(name, bytes):
                name = name.decode('utf-8', errors='ignore')
            return str(name).rstrip('.local.').rstrip('.')
    except:
        pass
    return ""

def get_hostname_info(ip: str, is_gateway: bool = False) -> Tuple[str, Dict[str, str]]:
    """Dapatkan nama host melalui NetBIOS, mDNS, dan Reverse DNS."""
    if is_gateway:
        return "Gateway / Router", {'workgroup': '', 'user': ''}

    nb = query_netbios(ip)
    if nb['hostname']:
        return nb['hostname'], nb

    mdns = query_mdns(ip)
    if mdns:
        return mdns, nb

    return "", nb
