"""
AP Isolation (Wireless Client Isolation) Detector
==================================================
Mendeteksi apakah router / Access Point (AP) menerapkan isolasi klien Layer 2
menggunakan metode uji silang diferensial (Multicast BSSID Reflection, L2 vs L3 Hairpinning,
dan korelasi Passive DHCP / History).
"""

import socket
import time
import uuid
from typing import Dict, Any, Optional
from scapy.all import Ether, IP, UDP, ICMP, srp, conf
from ..network import get_network_info, get_current_gateway, get_self_mac, is_valid_private_ip, is_valid_mac
from ...utils.logger import logger

def test_multicast_bssid_reflection(timeout: float = 0.25) -> bool:
    """
    Uji apakah AP memancarkan kembali (reflect) frame multicast ke seluruh BSSID di udara.
    PENTING: IP_MULTICAST_LOOP disetel ke 0 agar TIDAK dipantulkan oleh kernel internal OS sendiri.
    """
    probe_token = f"AP_ISO_{uuid.uuid4().hex[:12]}".encode('utf-8')
    test_port = 38292
    
    rx_sock = None
    tx_sock = None
    try:
        rx_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        rx_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        rx_sock.bind(('', test_port))
        rx_sock.settimeout(timeout)

        tx_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        tx_sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        # WAJIB: Matikan internal kernel loopback agar hanya menerima pantulan fisik dari gelombang radio Access Point!
        try:
            tx_sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_LOOP, 0)
        except Exception:
            pass

        tx_sock.sendto(probe_token, ('224.0.0.1', test_port))
        
        start = time.time()
        while time.time() - start < timeout:
            try:
                data, _ = rx_sock.recvfrom(1024)
                if probe_token in data:
                    return True
            except socket.timeout:
                break
            except Exception:
                break
        return False
    except Exception as e:
        logger.debug(f"Multicast BSSID reflection test error: {e}")
        return False
    finally:
        if rx_sock:
            try:
                rx_sock.close()
            except Exception:
                pass
        if tx_sock:
            try:
                tx_sock.close()
            except Exception:
                pass

def test_l3_hairpinning(candidate_ip: str, gateway_mac: str, timeout: float = 0.3) -> bool:
    """
    Uji apakah Gateway melakukan Layer 3 Hairpinning / Routing ke target yang terisolasi L2.
    Mengirim paket UDP/ICMP yang dibungkus dengan Ethernet dst = gateway_mac.
    """
    try:
        if not is_valid_private_ip(candidate_ip) or not is_valid_mac(gateway_mac):
            return False
            
        self_mac = (get_self_mac() or getattr(conf.iface, 'mac', None) or '').lower().replace('-', ':')
        if not self_mac:
            return False

        # Kirim probe Layer 3 ke IP target melalui MAC Gateway
        probe_pkt = Ether(dst=gateway_mac, src=self_mac) / IP(dst=candidate_ip) / UDP(dport=38291) / b"AP_ISO_HAIRPIN_TEST"
        ans, _ = srp(probe_pkt, timeout=timeout, verbose=False, retry=0)
        return len(ans) > 0
    except Exception as e:
        logger.debug(f"L3 Hairpinning probe error for {candidate_ip}: {e}")
        return False

def detect_ap_isolation(
    discovered_hosts: Dict[str, str],
    candidates: Optional[Dict[str, str]] = None,
    dhcp_snapshot: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Evaluasi diagnostik komprehensif tingkat kepastian AP Isolation (0% - 100%).
    """
    gateway_ip = get_current_gateway()
    net_info = get_network_info()
    my_ip = net_info.get('ip', '')
    self_mac = (get_self_mac() or '').lower().replace('-', ':')

    indicators = {
        "gateway_alive": False,
        "l2_peers_found": 0,
        "multicast_echo_blocked": False,
        "l3_hairpinning_confirmed": False,
        "has_candidates": False
    }

    # 1. Gateway Verification
    if gateway_ip and (gateway_ip in discovered_hosts or is_valid_private_ip(gateway_ip)):
        indicators["gateway_alive"] = True
    else:
        return {
            "is_isolated": False,
            "confidence": 0.0,
            "percentage": 0,
            "status": "normal",
            "reason": "Gateway router tidak merespons",
            "indicators": indicators
        }

    # 2. Hitung jumlah perangkat L2 selain Gateway dan Diri Sendiri
    non_gateway_peers = [
        ip for ip, mac in discovered_hosts.items()
        if ip != gateway_ip and ip != my_ip and mac.lower().replace('-', ':') != self_mac
    ]
    indicators["l2_peers_found"] = len(non_gateway_peers)

    # RULE 1: Jika ditemukan minimal 1 perangkat lain di Layer 2, isolasi PASTI TIDAK AKTIF (0%)
    if len(non_gateway_peers) > 0:
        return {
            "is_isolated": False,
            "confidence": 0.0,
            "percentage": 0,
            "status": "normal",
            "reason": f"Normal: Terdeteksi {len(non_gateway_peers)} perangkat aktif di Layer 2",
            "indicators": indicators
        }

    # Hanya gateway yang terlihat di L2 -> Mulai kalkulasi skor isolasi
    score = 40  # Base score for zero-peer ARP yield

    # 3. Uji Pantulan Multicast BSSID dengan IP_MULTICAST_LOOP = 0
    echo_received = test_multicast_bssid_reflection(timeout=0.25)
    indicators["multicast_echo_blocked"] = not echo_received

    if not echo_received:
        score += 35  # AP memblokir pantulan multicast antar klien di udara
    else:
        # Jika AP memantulkan multicast, kemungkinan jaringan hanya kosong / sepi
        score = max(10, score - 30)

    # 4. Evaluasi Kandidat (Korelasi DHCP Cache & History)
    active_candidates = {}
    if candidates:
        active_candidates.update({ip: mac for ip, mac in candidates.items() if ip != gateway_ip and ip != my_ip})
    if dhcp_snapshot:
        for k, v in dhcp_snapshot.items():
            c_ip = v.get('ip')
            c_mac = v.get('mac')
            if c_ip and c_mac and c_ip != gateway_ip and c_ip != my_ip:
                active_candidates[c_ip] = c_mac

    indicators["has_candidates"] = len(active_candidates) > 0

    # 5. Uji Silang L2 vs L3 Hairpinning jika ada kandidat
    gateway_mac = discovered_hosts.get(gateway_ip) or ""
    if active_candidates and gateway_mac:
        for c_ip in list(active_candidates.keys())[:3]:
            if test_l3_hairpinning(c_ip, gateway_mac, timeout=0.25):
                indicators["l3_hairpinning_confirmed"] = True
                score = 100  # L3 hidup via gateway, L2 diblokir total -> 100% Confirmed AP Isolation
                break

    # 6. Skenario "Klien Tunggal" (Lone Client Guard)
    # Jika tidak ada kandidat perangkat lain sama sekali dan echo multicast diblokir,
    # batasi skor maksimal 70% (karena bisa jadi jaringan rumahan yang sedang kosong).
    if not indicators["has_candidates"] and not indicators["l3_hairpinning_confirmed"]:
        if score > 70:
            score = 70

    percentage = max(0, min(100, score))
    confidence = round(percentage / 100.0, 2)
    is_isolated = percentage >= 70

    if percentage >= 90:
        status = "confirmed"
        reason = "100% Terkonfirmasi: Router membatasi lalu lintas L2 antar perangkat (AP Isolation Aktif)"
    elif percentage >= 70:
        status = "probable"
        reason = f"Kemungkinan Besar AP Isolation ({percentage}%): Hanya Gateway yang merespons dan siaran BSSID dibatasi"
    elif percentage >= 30:
        status = "idle"
        reason = f"Jaringan Sepi ({percentage}%): Belum ada perangkat lain yang terdeteksi aktif"
    else:
        status = "normal"
        reason = "Normal: Komunikasi lokal Layer 2 terbuka"

    return {
        "is_isolated": is_isolated,
        "confidence": confidence,
        "percentage": percentage,
        "status": status,
        "reason": reason,
        "indicators": indicators
    }
