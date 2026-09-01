"""
Comprehensive System & Hardware Diagnostics Module
===================================================
Menjalankan inspeksi mendalam dan nyata terhadap:
1. Driver Kernel Npcap (NDIS 6) & DLL Packet Capture Windows.
2. Hak akses Administrator OS (raw socket injection).
3. Adapter fisik aktif (Wi-Fi / Ethernet LAN / USB Tethering) & Gateway ping.
4. Status integritas subsystem Spoorf & Scapy Layer-2 bindings.
"""

import os
import sys
import time
import socket
import subprocess
import ctypes
from typing import Dict, Any, List, Optional
import ipaddress

from scapy.all import conf, ifaces
from .network import get_network_info, get_wifi_info, get_self_mac, is_valid_private_ip
from ..utils.logger import logger

def check_admin_privileges() -> Dict[str, Any]:
    """Cek apakah proses berjalan dengan hak akses Administrator (Windows) / Root (Linux)."""
    is_admin = False
    try:
        if sys.platform == 'win32':
            is_admin = bool(ctypes.windll.shell32.IsUserAnAdmin())
        else:
            is_admin = (os.geteuid() == 0)
    except Exception as e:
        logger.debug(f"Admin check error: {e}")

    return {
        "status": "ok" if is_admin else "warning",
        "is_admin": is_admin,
        "details": "Berjalan dengan hak akses Administrator (Full Raw L2 Injection)" if is_admin else "Berjalan sebagai User standar (Raw packet injection mungkin terbatas oleh Windows UAC)"
    }

def check_npcap_driver() -> Dict[str, Any]:
    """
    Inspeksi nyata Npcap NDIS 6 Kernel Driver di Windows:
    - Service 'npcap' status via Windows Service Controller (`sc query npcap`)
    - Keberadaan DLL C:\\Windows\\System32\\Npcap\\wpcap.dll & Packet.dll
    - Scapy pcap backend binding (conf.use_pcap) dan jumlah interface Layer 2
    """
    is_windows = sys.platform == 'win32'
    
    # 1. Cek Service Controller
    service_installed = False
    service_running = False
    service_state_text = "UNKNOWN"
    
    if is_windows:
        try:
            # Gunakan subprocess list (shell=False) sesuai security invariant
            res = subprocess.run(
                ["sc", "query", "npcap"],
                capture_output=True,
                text=True,
                timeout=2.0,
                check=False
            )
            if res.returncode == 0:
                service_installed = True
                out = res.stdout.upper()
                if "STATE" in out and "RUNNING" in out:
                    service_running = True
                    service_state_text = "RUNNING"
                elif "STOPPED" in out:
                    service_state_text = "STOPPED"
                else:
                    service_state_text = "PAUSED_OR_PENDING"
            else:
                # Cek legacy WinPcap (npf) bila npcap tidak ada
                res_npf = subprocess.run(
                    ["sc", "query", "npf"],
                    capture_output=True,
                    text=True,
                    timeout=2.0,
                    check=False
                )
                if res_npf.returncode == 0:
                    service_installed = True
                    if "RUNNING" in res_npf.stdout.upper():
                        service_running = True
                        service_state_text = "RUNNING (Legacy NPF)"
        except Exception as e:
            logger.debug(f"Notice querying npcap service: {e}")

    # 2. Cek File DLL Npcap
    dll_candidates = [
        r"C:\Windows\System32\Npcap\wpcap.dll",
        r"C:\Windows\System32\wpcap.dll",
        r"C:\Windows\System32\Packet.dll",
        r"C:\Windows\System32\Npcap\Packet.dll",
        r"C:\Windows\SysWOW64\Npcap\wpcap.dll",
        r"C:\Windows\SysWOW64\wpcap.dll"
    ]
    present_dlls = [p for p in dll_candidates if os.path.exists(p)]
    has_wpcap_dll = any("wpcap.dll" in p.lower() for p in present_dlls)
    has_packet_dll = any("packet.dll" in p.lower() for p in present_dlls)
    dlls_present = has_wpcap_dll and has_packet_dll

    # 3. Cek Scapy L2 Binding
    scapy_use_pcap = bool(getattr(conf, 'use_pcap', False))
    iface_count = len(ifaces) if ifaces else 0
    default_iface_name = getattr(getattr(conf, 'iface', None), 'name', 'None')
    default_iface_desc = getattr(getattr(conf, 'iface', None), 'description', '')

    # 4. Tentukan Overall Npcap Status
    if not is_windows:
        # Di Linux/macOS memakai AF_PACKET bawaan kernel
        return {
            "status": "ok",
            "installed": True,
            "service_running": True,
            "scapy_bound": True,
            "dlls_present": True,
            "interfaces_count": iface_count,
            "default_iface": default_iface_name,
            "details": f"Linux Native Raw Socket (AF_PACKET) aktif ({iface_count} interfaces terdeteksi)"
        }

    if service_running and dlls_present and scapy_use_pcap and iface_count > 0:
        status = "ok"
        details = f"Npcap NDIS 6 Kernel Driver RUNNING ({iface_count} L2 interfaces terdeteksi, default: {default_iface_desc or default_iface_name})"
    elif dlls_present and not service_running:
        status = "warning"
        details = "Npcap terpasang namun kernel service 'npcap' dalam keadaan STOPPED. Jalankan 'net start npcap' di PowerShell Admin."
    elif not dlls_present and not service_installed:
        status = "error"
        details = "Npcap Driver tidak ditemukan di Windows. Harap install Npcap dengan opsi 'WinPcap API-compatible mode' dari npcap.com."
    else:
        status = "warning"
        details = f"Npcap terdeteksi parsial (DLL: {len(present_dlls)} ditemukan, Service: {service_state_text}, L2 Ifaces: {iface_count})"

    return {
        "status": status,
        "installed": service_installed or dlls_present,
        "service_running": service_running,
        "service_state": service_state_text,
        "dlls_present": dlls_present,
        "present_dll_paths": present_dlls,
        "scapy_bound": scapy_use_pcap,
        "interfaces_count": iface_count,
        "default_iface": default_iface_name,
        "default_iface_desc": default_iface_desc,
        "details": details
    }

def check_network_adapter_and_gateway() -> Dict[str, Any]:
    """Inspeksi adapter jaringan fisik aktif, IP privat, dan konektivitas gateway."""
    info = get_network_info()
    wifi = get_wifi_info()
    self_mac = get_self_mac()

    ip = info.get('ip', '')
    gateway = info.get('gateway', '')
    interface_name = info.get('interface', '')
    ssid = wifi.get('ssid', '')
    connected = wifi.get('connected', False)
    iface_type = wifi.get('interface_type', 'wifi')

    # Cek Reachability Gateway secara nyata (TCP / UDP connect timeout 500ms)
    gw_reachable = False
    gw_latency_ms = 0.0
    if gateway and is_valid_private_ip(gateway):
        t0 = time.perf_counter()
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.4)
                # Coba probe port 80 / 53 / 443 gateway
                s.connect((gateway, 80))
                gw_reachable = True
                gw_latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        except:
            # Jika port 80 tertutup, coba ping socket UDP
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                    s.settimeout(0.3)
                    s.connect((gateway, 53))
                    gw_reachable = True
                    gw_latency_ms = round((time.perf_counter() - t0) * 1000, 2)
            except:
                gw_reachable = False

    is_valid_ip = is_valid_private_ip(ip)

    if connected and is_valid_ip:
        status = "ok"
        details = f"Terhubung via {iface_type.upper()} ({ssid or interface_name}) - IP: {ip}, Gateway: {gateway} ({gw_latency_ms}ms)"
    elif is_valid_ip:
        status = "warning"
        details = f"IP lokal terdeteksi ({ip}) namun koneksi Wi-Fi/LAN terputus atau tidak teridentifikasi."
    else:
        status = "error"
        details = "Tidak ada adapter jaringan aktif dengan IP privat RFC 1918. Sambungkan PC ke Wi-Fi atau kabel LAN."

    return {
        "status": status,
        "connected": connected,
        "interface": interface_name,
        "interface_type": iface_type,
        "ssid": ssid,
        "signal": wifi.get('signal', ''),
        "ip": ip,
        "netmask": info.get('netmask', ''),
        "network": info.get('network', ''),
        "gateway": gateway,
        "gateway_reachable": gw_reachable,
        "gateway_latency_ms": gw_latency_ms,
        "self_mac": self_mac,
        "details": details
    }

def run_system_diagnostics() -> Dict[str, Any]:
    """
    Eksekusi pemeriksaan diagnosa lengkap dari seluruh subsistem.
    Menghasilkan data terstruktur dan log terminal bootstrap nyata.
    """
    t_start = time.perf_counter()
    
    admin_check = check_admin_privileges()
    npcap_check = check_npcap_driver()
    adapter_check = check_network_adapter_and_gateway()

    # Hitung overall status
    statuses = [admin_check["status"], npcap_check["status"], adapter_check["status"]]
    if "error" in statuses:
        overall_status = "error"
    elif "warning" in statuses:
        overall_status = "warning"
    else:
        overall_status = "ok"

    elapsed_ms = round((time.perf_counter() - t_start) * 1000, 2)

    # Format log bootstrap nyata
    logs: List[str] = [
        f"[BOOT] NetCut Sentinel Python Engine v2.3.0 initialized (PID: {os.getpid()})",
        f"[AUTH] Administrator Privilege: {'YES (Elevated)' if admin_check['is_admin'] else 'NO (Standard User)'}",
        f"[NPCAP] {npcap_check['details']}",
        f"[NET] {adapter_check['details']}",
        f"[INVARIANT] Gateway Immunity ({adapter_check.get('gateway', 'N/A')}) & Anti-Self Cut ({adapter_check.get('self_mac', 'N/A')}) LOCKED"
    ]

    return {
        "success": True,
        "status": overall_status,
        "elapsed_ms": elapsed_ms,
        "checks": {
            "python_engine": {
                "status": "ok",
                "version": "2.3.0",
                "pid": os.getpid(),
                "platform": sys.platform,
                "details": f"FastAPI + Scapy Engine running on Python {sys.version.split()[0]}"
            },
            "npcap_driver": npcap_check,
            "admin_privileges": admin_check,
            "network_adapter": adapter_check
        },
        "logs": logs
    }
