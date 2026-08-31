"""
Probing: ICMP Ping, TCP Port Scan, HTTP Web Title Banner Grabber
"""

import socket
import re
from typing import Dict, Any, List
from scapy.all import IP, ICMP, sr1
from ...utils.logger import logger

_SERVICES = {
    80: 'HTTP', 443: 'HTTPS', 53: 'DNS', 22: 'SSH', 21: 'FTP',
    23: 'Telnet', 25: 'SMTP', 110: 'POP3', 143: 'IMAP', 8080: 'HTTP-Proxy',
    8443: 'HTTPS-Alt', 3389: 'RDP', 445: 'SMB', 139: 'NetBIOS-SSN',
    137: 'NetBIOS-NS', 554: 'RTSP (IP Cam)', 1883: 'MQTT (IoT)',
    8000: 'HTTP-Dev', 5000: 'HTTP-Dev', 3000: 'HTTP-Dev', 6379: 'Redis',
    3306: 'MySQL', 5432: 'PostgreSQL', 27017: 'MongoDB', 8888: 'HTTP-Alt',
    9000: 'HTTP-Alt', 9090: 'HTTP-Alt', 10000: 'Webmin', 1900: 'SSDP/UPnP',
    5353: 'mDNS', 9100: 'RAW-Print', 631: 'IPP-Print', 8008: 'Google-Cast',
    8009: 'Google-Cast-V2', 8554: 'RTSP-Alt', 8883: 'MQTT-TLS', 5900: 'VNC',
    25565: 'Minecraft', 27015: 'Steam', 32400: 'Plex-Media'
}

def ping_fast(ip: str) -> Dict[str, Any]:
    """Kirim ICMP Ping berkecepatan tinggi via Scapy sr1."""
    try:
        pkt = IP(dst=ip) / ICMP()
        reply = sr1(pkt, timeout=0.25, verbose=False)
        if reply:
            sent_t = getattr(pkt, 'sent_time', None)
            reply_t = getattr(reply, 'time', None)
            if sent_t is not None and reply_t is not None:
                try:
                    rtt = max(1, int((reply_t - sent_t) * 1000))
                except (TypeError, ValueError):
                    rtt = 5
            else:
                rtt = 5

            return {
                'alive': True,
                'ttl': getattr(reply, 'ttl', 64),
                'rtt': rtt
            }
    except Exception as e:
        logger.debug(f"Ping notice for {ip}: {e}")
    return {'alive': False, 'ttl': 0, 'rtt': 0}

def scan_ports(ip: str) -> Dict[int, str]:
    """Scan port-port umum secara cepat dengan socket connect_ex."""
    common_ports = [80, 443, 8080, 22, 53, 445, 3389, 8000, 5000, 3000, 554, 1883]
    open_ports = {}
    for port in common_ports:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.08)
                result = s.connect_ex((ip, port))
                if result == 0:
                    open_ports[port] = _SERVICES.get(port, str(port))
        except:
            pass
    return open_ports

def get_http_info(ip: str, open_ports: List[int]) -> Dict[str, str]:
    """Ambil HTTP server banner dan <title> untuk port web yang terbuka."""
    web_ports = [p for p in [80, 8080, 8000, 5000, 3000, 8888, 9000, 9090, 10000, 443, 8443, 8008, 631] if p in open_ports]
    if not web_ports:
        return {'web_title': '', 'web_server': ''}

    port = web_ports[0]
    try:
        raw_data = b""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.3)
            s.connect((ip, port))
            req = f"GET / HTTP/1.1\r\nHost: {ip}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\nConnection: close\r\n\r\n"
            s.sendall(req.encode())
            while len(raw_data) < 4096:
                chunk = s.recv(1024)
                if not chunk:
                    break
                raw_data += chunk

        response = raw_data.decode('utf-8', errors='ignore')
        server = ""
        server_match = re.search(r'Server:\s*([^\r\n]+)', response, re.IGNORECASE)
        if server_match:
            server = server_match.group(1).strip()

        title = ""
        title_match = re.search(r'<title[^>]*>(.*?)</title>', response, re.IGNORECASE | re.DOTALL)
        if title_match:
            title = re.sub(r'\s+', ' ', title_match.group(1)).strip()

        return {'web_title': title[:60], 'web_server': server[:40]}
    except:
        pass
    return {'web_title': '', 'web_server': ''}

TOP_100_PORTS = [
    21, 22, 23, 25, 53, 80, 81, 88, 110, 111, 135, 137, 138, 139, 143, 161, 199,
    389, 443, 445, 465, 514, 515, 548, 554, 587, 631, 636, 873, 902, 912, 993,
    995, 1025, 1080, 1433, 1521, 1723, 1883, 1900, 2049, 2121, 3000, 3128, 3306,
    3389, 4242, 5000, 5060, 5222, 5353, 5432, 5555, 5672, 5900, 5984, 6000, 6379,
    6667, 7000, 7001, 7070, 7777, 8000, 8008, 8009, 8080, 8081, 8088, 8090, 8181,
    8282, 8443, 8554, 8883, 8888, 9000, 9090, 9091, 9100, 9200, 9300, 9418, 9999,
    10000, 11211, 27017, 27018, 28017, 32400, 50000
]

def _scan_single_port(ip: str, port: int, timeout: float = 0.08) -> tuple:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            res = s.connect_ex((ip, port))
            return (port, res == 0)
    except:
        return (port, False)

def deep_scan_ports(ip: str, ports: List[int] = None) -> Dict[str, Any]:
    """Multi-threaded deep port scanner untuk target IP tertentu."""
    import concurrent.futures
    if not ports:
        scan_list = TOP_100_PORTS
    else:
        # Sanitize and clamp ports to valid 1-65535, max 1000 ports
        valid = []
        for p in ports:
            try:
                p_int = int(p)
                if 1 <= p_int <= 65535:
                    valid.append(p_int)
            except:
                pass
        scan_list = sorted(list(set(valid)))[:1000]
        if not scan_list:
            scan_list = TOP_100_PORTS

    open_ports_dict = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(scan_list), 50)) as executor:
        futures = {executor.submit(_scan_single_port, ip, p): p for p in scan_list}
        for future in concurrent.futures.as_completed(futures):
            try:
                port, is_open = future.result()
                if is_open:
                    open_ports_dict[port] = _SERVICES.get(port, str(port))
            except:
                pass

    open_port_list = sorted(list(open_ports_dict.keys()))
    http_info = get_http_info(ip, open_port_list)

    return {
        'ip': ip,
        'open_ports': open_port_list,
        'services': [open_ports_dict[p] for p in open_port_list],
        'web_title': http_info.get('web_title', ''),
        'web_server': http_info.get('web_server', '')
    }

