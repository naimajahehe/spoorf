"""
Network Scanner Orchestrator
=============================
Orkestrator pemindaian jaringan modular berkecepatan tinggi.
Mengintegrasikan modul discovery (ARP, Multicast, DHCP) dan modul fingerprinting.
"""

import time
import socket
import threading
import platform
import concurrent.futures
import ipaddress
from typing import List, Dict, Any, Optional

from .network import (
    get_wifi_info,
    get_network_info,
    get_current_gateway,
    get_self_mac,
    is_network_changed,
    is_valid_private_ip,
    is_valid_private_network,
    is_valid_mac
)
from .discovery import (
    dhcp_cache,
    start_dhcp_sniffer,
    stop_dhcp_sniffer,
    collect_ssdp_sensors,
    collect_mdns_sensors,
    send_multicast_wakeup,
    get_ssdp_cache,
    get_mdns_cache,
    get_mac_from_arp,
    collect_from_arp_cache,
    collect_from_arp_broadcast,
    sweep_subnet_for_arp,
    probe_sleeping_host_via_unicast_arp,
    collect_from_ndp_cache,
    send_ipv6_all_nodes_multicast,
    verify_ipv6_alive,
    detect_ap_isolation
)
from .fingerprint import (
    is_randomized_mac,
    get_vendor,
    query_netbios,
    query_mdns,
    get_hostname_info,
    ping_fast,
    scan_ports,
    get_http_info,
    detect_os,
    detect_device_type,
    synthesize_ensemble_profile,
    synthesize_profile_assessment
)
from .proximity import measure_target_proximity
from ..utils.logger import logger

class NetworkScanner:
    """Orkestrator pemindaian jaringan terpadu (Hybrid Multi-Vector Discovery)."""

    _DEVICE_HISTORY: Dict[str, Dict[str, str]] = {}
    _HISTORY_LOCK = threading.Lock()
    _LATEST_AP_ISOLATION: Dict[str, Any] = {
        "is_isolated": False,
        "confidence": 0.0,
        "percentage": 0,
        "status": "normal",
        "reason": "Belum ada pemindaian yang dijalankan"
    }

    @classmethod
    def get_ap_isolation(cls) -> Dict[str, Any]:
        return dict(cls._LATEST_AP_ISOLATION)

    # Backward-compatible proxy methods
    get_wifi_info = staticmethod(get_wifi_info)
    get_network_info = staticmethod(get_network_info)
    get_current_gateway = staticmethod(get_current_gateway)
    get_self_mac = staticmethod(get_self_mac)
    is_network_changed = staticmethod(is_network_changed)
    is_valid_private_ip = staticmethod(is_valid_private_ip)
    is_valid_mac = staticmethod(is_valid_mac)
    ping_fast = staticmethod(ping_fast)
    scan_ports = staticmethod(scan_ports)
    get_vendor = staticmethod(get_vendor)
    is_randomized_mac = staticmethod(is_randomized_mac)
    get_hostname_info = staticmethod(get_hostname_info)
    start_dhcp_sniffer = staticmethod(start_dhcp_sniffer)
    stop_dhcp_sniffer = staticmethod(stop_dhcp_sniffer)

    @classmethod
    def _build_device(
        cls,
        ip: str,
        mac: str,
        gateway_ip: str,
        is_active_layer2: bool = True,
        dhcp_snapshot: Optional[Dict[str, Any]] = None,
        ssdp_snapshot: Optional[Dict[str, Any]] = None,
        mdns_snapshot: Optional[Dict[str, Any]] = None,
        ipv6_snapshot: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        """Bangun objek informasi lengkap perangkat (profiling & enrichment)."""
        norm_mac = mac.lower().replace('-', ':')
        self_mac = (get_self_mac() or '').lower().replace('-', ':')
        is_self = bool(self_mac and norm_mac == self_mac)

        ipv6_info = (ipv6_snapshot or {}).get(norm_mac, {})
        ipv6_addrs = ipv6_info.get('addresses', [])
        ipv6_ll = ipv6_info.get('link_local', '')
        ipv6_glob = ipv6_info.get('global', '')
        is_dual = bool(ip and ipv6_addrs)

        if is_self:
            host_name = socket.gethostname()
            profiled_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            # Identitas host operator dideteksi DINAMIS dari OS yang berjalan —
            # bukan di-hardcode ke satu laptop tertentu — agar benar di komputer
            # pengguna mana pun (penting untuk distribusi).
            sys_platform = platform.system()
            if sys_platform == 'Windows':
                try:
                    win_build = int(platform.version().split('.')[2])
                except Exception:
                    win_build = 0
                self_os = 'Windows 11' if win_build >= 22000 else f"Windows {platform.release()}"
                self_ttl = 128
                self_vendor_class = 'MSFT 5.0'
                self_dhcp_fp = 'Microsoft Windows Signature'
            elif sys_platform == 'Darwin':
                self_os = 'macOS'
                self_ttl = 64
                self_vendor_class = ''
                self_dhcp_fp = 'Apple macOS Signature'
            else:
                self_os = sys_platform or 'Linux'
                self_ttl = 64
                self_vendor_class = ''
                self_dhcp_fp = 'Linux/Embedded IoT Signature'
            self_vendor = get_vendor(norm_mac) or 'This PC (Controller)'
            return {
                'ip': ip,
                'mac': norm_mac,
                'hostname': host_name,
                'vendor': self_vendor,
                'os': self_os,
                'device_type': 'This PC (Perangkat Ini)',
                'open_ports': {},
                'services': [],
                'web_title': '',
                'web_server': '',
                'workgroup': 'WORKGROUP',
                'user_name': '',
                'is_gateway': False,
                'is_self': True,
                'is_online': True,
                'is_blocked': False,
                'rtt_ms': 0.1,
                'ttl': self_ttl,
                'is_randomized_mac': False,
                'mac_type': 'Factory Hardware (OUI)',
                'first_seen': time.strftime('%Y-%m-%d %H:%M:%S'),
                'last_seen': time.strftime('%Y-%m-%d %H:%M:%S'),
                'dhcp_vendor_class': self_vendor_class,
                'dhcp_fingerprint': self_dhcp_fp,
                'dhcp_client_id': '',
                'dhcp_fqdn': f"{host_name}.local",
                'ipv6_link_local': ipv6_ll,
                'ipv6_global': ipv6_glob,
                'ipv6_addresses': ipv6_addrs,
                'is_dual_stack': is_dual,
                'vendor_confidence': 0,
                'type_confidence': 0,
                'hostname_confidence': 0,
                'profile_status': 'unknown',
                'profile_evidence': [],
                'profiled_at': profiled_at,
                'profile_version': 1,
            }

        is_gateway = (ip == gateway_ip)
        vendor = get_vendor(norm_mac, is_gateway=is_gateway)

        dhcp_map = dhcp_snapshot or dhcp_cache.get_snapshot()
        ssdp_map = ssdp_snapshot or get_ssdp_cache()
        mdns_map = mdns_snapshot or get_mdns_cache()
        dhcp_hit = dhcp_map.get(norm_mac) or dhcp_map.get(ip, {})

        # 1. Resolusi Hostname Adaptif (Gunakan Cache Terlebih Dahulu)
        mdns_entry = mdns_map.get(ip, {})
        mdns_h = (mdns_entry.get('hostname') or mdns_entry.get('model', '')) if isinstance(mdns_entry, dict) else (mdns_entry if isinstance(mdns_entry, str) else '')
        ssdp_entry = ssdp_map.get(ip, {})
        ssdp_h = (ssdp_entry.get('friendly_name') or ssdp_entry.get('model_name', '')) if isinstance(ssdp_entry, dict) else (ssdp_entry if isinstance(ssdp_entry, str) else '')

        known_host = (dhcp_hit.get('hostname') if isinstance(dhcp_hit, dict) else '') or mdns_h or ssdp_h
        if known_host and isinstance(known_host, str):
            # Buang sufiks ".local." / ".local" secara TEPAT. (rstrip('.local.')
            # keliru: ia membuang tiap karakter di himpunan {. l o c a} sehingga
            # "Nicola.local." menjadi "Ni". removesuffix hanya membuang sufiksnya.)
            hostname = known_host.strip().removesuffix('.local.').removesuffix('.local').rstrip('.')
            nb_info = {'workgroup': '', 'user': ''}
        elif is_randomized_mac(norm_mac):
            # Smartphone dengan MAC acak tidak pernah menjalankan NetBIOS SMB port 137
            hostname = query_mdns(ip, timeout=0.1)
            nb_info = {'workgroup': '', 'user': ''}
        else:
            hostname, nb_info = get_hostname_info(ip, is_gateway=is_gateway)

        # 2. Probing Adaptif (Ping & Port Scan Cerdas)
        ping = ping_fast(ip)
        open_ports = {}
        if ping['alive']:
            open_ports = scan_ports(ip)
        elif not is_randomized_mac(norm_mac) or is_gateway:
            vital_ports = {}
            for port in [80, 443]:
                try:
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s.settimeout(0.04)
                    if s.connect_ex((ip, port)) == 0:
                        vital_ports[port] = str(port)
                    s.close()
                except:
                    pass
            open_ports = vital_ports

        http_info = get_http_info(ip, list(open_ports.keys()))

        profiled_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        profile = synthesize_profile_assessment(
            ip=ip,
            norm_mac=norm_mac,
            is_gateway=is_gateway,
            vendor=vendor,
            hostname=hostname,
            nb_info=nb_info,
            ping_info=ping,
            open_ports=open_ports,
            http_info=http_info,
            dhcp_discovered=dhcp_map,
            ssdp_discovered=ssdp_map,
            mdns_discovered=mdns_map,
            observed_at=profiled_at,
            ipv6_info=ipv6_info,
        )
        syn_hostname = profile['hostname']
        syn_vendor = profile['vendor']
        os_name = profile['os']
        device_type = profile['device_type']

        now_str = time.strftime('%Y-%m-%d %H:%M:%S')
        now_ts = time.time()
        with cls._HISTORY_LOCK:
            if norm_mac not in cls._DEVICE_HISTORY:
                cls._DEVICE_HISTORY[norm_mac] = {
                    'ip': ip,
                    'mac': norm_mac,
                    'first_seen': now_str,
                    'last_seen': now_str,
                    'last_seen_ts': now_ts
                }
            else:
                cls._DEVICE_HISTORY[norm_mac]['ip'] = ip
                cls._DEVICE_HISTORY[norm_mac]['mac'] = norm_mac
                cls._DEVICE_HISTORY[norm_mac]['last_seen'] = now_str
                cls._DEVICE_HISTORY[norm_mac]['last_seen_ts'] = now_ts

            first_seen = cls._DEVICE_HISTORY[norm_mac]['first_seen']
            last_seen = cls._DEVICE_HISTORY[norm_mac]['last_seen']
        is_online = ping['alive'] or is_active_layer2

        dhcp_hit = dhcp_map.get(norm_mac) or dhcp_map.get(ip, {})

        # 3. Estimasi Jarak Fisik (Proximity Engine)
        prox = measure_target_proximity(
            target_ip=ip,
            target_mac=norm_mac,
            is_gateway=is_gateway
        )

        rtt_val = prox.get('rtt_ms', 0) if prox.get('rtt_ms', 0) > 0 else ping.get('rtt', 0)

        return {
            'ip': ip,
            'mac': norm_mac,
            'vendor': syn_vendor,
            'hostname': syn_hostname,
            'is_online': is_online,
            'is_blocked': False,
            'is_gateway': is_gateway,
            'device_type': device_type,
            'os': os_name,
            'rtt_ms': rtt_val,
            'distance_zone': prox.get('distance_zone', 'unknown'),
            'estimated_range': prox.get('estimated_range', '-'),
            'ttl': ping.get('ttl', 64) if ping.get('alive') else (128 if os_name == 'Windows' else 64),
            'is_randomized_mac': is_randomized_mac(norm_mac),
            'mac_type': 'Private MAC (Randomized)' if is_randomized_mac(norm_mac) else 'Factory Hardware (OUI)',
            'open_ports': list(open_ports.keys()),
            'services': list(open_ports.values()),
            'workgroup': nb_info.get('workgroup', ''),
            'user_name': nb_info.get('user', ''),
            'web_title': http_info.get('web_title', ''),
            'web_server': http_info.get('web_server', ''),
            'first_seen': first_seen,
            'last_seen': last_seen,
            'dhcp_vendor_class': dhcp_hit.get('vendor_class', ''),
            'dhcp_fingerprint': dhcp_hit.get('dhcp_fingerprint', ''),
            'dhcp_client_id': dhcp_hit.get('client_id', ''),
            'dhcp_fqdn': dhcp_hit.get('fqdn', ''),
            'ipv6_link_local': ipv6_ll,
            'ipv6_global': ipv6_glob,
            'ipv6_addresses': ipv6_addrs,
            'is_dual_stack': is_dual,
            'vendor_confidence': profile['vendor_confidence'],
            'type_confidence': profile['type_confidence'],
            'hostname_confidence': profile['hostname_confidence'],
            'profile_status': profile['profile_status'],
            'profile_evidence': profile['profile_evidence'],
            'profiled_at': profile['profiled_at'],
            'profile_version': profile['profile_version'],
        }

    @classmethod
    def scan_full(cls, include_multicast_wakeup: bool = True) -> List[Dict[str, Any]]:
        """Eksekusi pemindaian jaringan menyeluruh (Multi-Vector Discovery)."""
        start_time = time.time()
        logger.info("🔍 Memulai SCAN jaringan cerdas & berkecepatan tinggi...")

        # Establish an authoritative private IPv4 topology before any helper can
        # cause packet or network I/O. A cache-only result is intentionally not
        # surfaced without a currently valid gateway that can safely verify it.
        net_info = get_network_info()
        gateway_ip = get_current_gateway()
        network_cidr = net_info.get('network', '')
        if not is_valid_private_network(network_cidr) or not is_valid_private_ip(gateway_ip):
            logger.warning("Scan dibatalkan: jaringan atau gateway RFC1918 tidak valid")
            return []

        try:
            curr_net = ipaddress.IPv4Network(network_cidr, strict=False)
            gateway_is_resolved = ipaddress.IPv4Address(gateway_ip) in curr_net
        except ValueError:
            logger.warning("Scan dibatalkan: CIDR jaringan tidak dapat divalidasi")
            return []

        if not gateway_is_resolved:
            logger.warning("Scan dibatalkan: gateway berada di luar jaringan aktif")
            return []

        discovered: Dict[str, str] = {}
        discovered_ipv6: Dict[str, Dict[str, Any]] = {}

        # 1. PARALLEL CONCURRENT MULTI-VECTOR DISCOVERY ENGINE (Tahap 1, 2, 3 serentak)
        # Menjalankan Multicast (SSDP + mDNS), IPv6 All-Nodes, dan Active Layer 2 ARP Broadcast
        # secara bersamaan dalam ThreadPoolExecutor untuk akurasi maksimal (timeout 0.80s - 1.20s)
        # dengan total durasi awal dipadatkan menjadi hanya ~1.20s (penghematan waktu ~45%).
        def _run_multicast_sensors():
            try:
                if include_multicast_wakeup:
                    send_multicast_wakeup()
                collect_ssdp_sensors(timeout=0.80)
                collect_mdns_sensors(timeout=0.80)
            except Exception as e:
                logger.debug(f"Multicast sensors exception: {e}")

        def _run_ipv6_discovery():
            try:
                collect_from_ndp_cache(discovered_ipv6)
                send_ipv6_all_nodes_multicast(discovered_ipv6, timeout=0.80)
            except Exception as e:
                logger.debug(f"IPv6 discovery exception: {e}")

        def _run_l2_arp_discovery():
            try:
                # Active Layer 2 ARP Request Broadcast ke seluruh subnet
                collect_from_arp_broadcast(discovered, timeout=1.20)
                # Fast Subnet Sweep untuk memicu kernel OS ARP
                sweep_subnet_for_arp(discovered)
            except Exception as e:
                logger.debug(f"Layer 2 ARP discovery exception: {e}")

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as discovery_executor:
            f_multi = discovery_executor.submit(_run_multicast_sensors)
            f_v6 = discovery_executor.submit(_run_ipv6_discovery)
            f_arp = discovery_executor.submit(_run_l2_arp_discovery)
            concurrent.futures.wait([f_multi, f_v6, f_arp], timeout=1.35)

        # 5. Kumpulkan kandidat dari DHCP Cache, OS ARP Cache, dan Device History yang belum terverifikasi
        candidates: Dict[str, str] = {}

        collect_from_arp_cache(candidates)

        dhcp_snapshot = dhcp_cache.get_snapshot()
        for k, d_info in dhcp_snapshot.items():
            d_ip = d_info.get('ip')
            d_mac = d_info.get('mac')
            if curr_net and d_ip and d_mac and is_valid_private_ip(d_ip) and is_valid_mac(d_mac):
                try:
                    if ipaddress.IPv4Address(d_ip) not in curr_net:
                        continue
                except ValueError:
                    continue
                candidates[d_ip] = d_mac

        if cls._DEVICE_HISTORY:
            for entry in cls._DEVICE_HISTORY.values():
                h_ip = entry.get('ip')
                h_mac = entry.get('mac')
                if curr_net and h_ip and h_mac and is_valid_private_ip(h_ip) and is_valid_mac(h_mac):
                    try:
                        if ipaddress.IPv4Address(h_ip) not in curr_net:
                            continue
                    except ValueError:
                        continue
                    if h_ip not in candidates:
                        candidates[h_ip] = h_mac

        # 6. Verifikasi Liveness untuk seluruh kandidat yang belum masuk 'discovered' (Doze Wakeup / Unicast ARP Probe)
        unverified = [
            (ip, mac)
            for ip, mac in candidates.items()
            if gateway_is_resolved and ip not in discovered
        ]
        if unverified:
            logger.info(f"📱 Memverifikasi {len(unverified)} host kandidat (Unicast ARP / Doze Probe)...")
            num_probe_workers = min(15, len(unverified))
            with concurrent.futures.ThreadPoolExecutor(max_workers=num_probe_workers) as probe_executor:
                futures = [
                    probe_executor.submit(
                        probe_sleeping_host_via_unicast_arp,
                        target_ip, target_mac, discovered, 0.25
                    )
                    for target_ip, target_mac in unverified
                ]
                concurrent.futures.wait(futures, timeout=1.5)

        # 6b. Rekonsiliasi Liveness IPv6 (dengan VERIFIKASI AKTIF paralel):
        # Kumpulkan dulu kandidat IPv6-only (MAC aktif di NDP/Multicast tapi belum ada di 'discovered'),
        # petakan ke IPv4 terakhirnya, lalu VERIFIKASI HIDUP secara paralel. Entri NDP bisa STALE (basi) &
        # tetap ada beberapa menit setelah perangkat mematikan Wi-Fi, jadi jangan percaya cache — hanya
        # tandai ONLINE bila probe ICMPv6 NS dijawab Neighbor Advertisement.
        self_mac_for_probe = get_self_mac()
        v6_candidates = []  # (matched_ipv4, norm_v6_mac, v6_addr)
        for v6_mac, v6_data in discovered_ipv6.items():
            norm_v6_mac = v6_mac.lower().replace('-', ':')
            already_in_discovered = any(m.lower().replace('-', ':') == norm_v6_mac for m in discovered.values())
            if already_in_discovered:
                continue
            matched_ipv4 = None
            for c_ip, c_mac in candidates.items():
                if c_mac.lower().replace('-', ':') == norm_v6_mac:
                    matched_ipv4 = c_ip
                    break
            if not matched_ipv4 and norm_v6_mac in cls._DEVICE_HISTORY:
                matched_ipv4 = cls._DEVICE_HISTORY[norm_v6_mac].get('ip')
            if not matched_ipv4:
                dhcp_item = dhcp_snapshot.get(norm_v6_mac)
                if dhcp_item and dhcp_item.get('ip') and is_valid_private_ip(dhcp_item['ip']):
                    matched_ipv4 = dhcp_item['ip']
            if not (matched_ipv4 and is_valid_private_ip(matched_ipv4)):
                continue
            v6_addr = v6_data.get('link_local') or v6_data.get('global') or (v6_data.get('addresses') or [None])[0]
            if v6_addr:
                v6_candidates.append((matched_ipv4, norm_v6_mac, v6_addr))

        if v6_candidates:
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(10, len(v6_candidates))) as v6_exec:
                future_map = {
                    v6_exec.submit(verify_ipv6_alive, mac, addr, self_mac_for_probe): (ipv4, mac)
                    for (ipv4, mac, addr) in v6_candidates
                }
                for fut in concurrent.futures.as_completed(future_map):
                    ipv4, mac = future_map[fut]
                    try:
                        alive = fut.result()
                    except Exception:
                        alive = False
                    if alive:
                        logger.info(f"🌐 [Dual-Stack Liveness] Host {ipv4} ({mac}) TERVERIFIKASI ONLINE via ICMPv6 NS/NA")
                        discovered[ipv4] = mac
                    else:
                        logger.debug(f"🚫 [Dual-Stack Liveness] Host {ipv4} ({mac}) tidak menjawab probe IPv6 (entri NDP basi) -> dilewati")

        # 7. Pastikan Gateway tercakup
        if gateway_ip and gateway_ip not in discovered:
            gw_mac = get_mac_from_arp(gateway_ip)
            if gw_mac:
                discovered[gateway_ip] = gw_mac

        # 8. Pastikan Host Sendiri selalu tercakup & Online
        try:
            info = get_network_info()
            my_ip = info.get('ip')
            my_mac = (get_self_mac() or '').lower().replace('-', ':')
            if my_ip and my_mac:
                discovered[my_ip] = my_mac
        except Exception as e:
            logger.warning(f"Notice adding self host: {e}")

        logger.info(f"📡 Ditemukan {len(discovered)} perangkat aktif di jaringan. Memulai enrichment paralel...")

        # 6. ENRICHMENT PARALEL
        devices: List[Dict[str, Any]] = []
        if discovered:
            ssdp_snapshot = get_ssdp_cache()
            mdns_snapshot = get_mdns_cache()
            num_workers = min(20, len(discovered) + 2)
            with concurrent.futures.ThreadPoolExecutor(max_workers=num_workers) as executor:
                future_to_ip = {
                    executor.submit(
                        cls._build_device, ip, mac, gateway_ip, True,
                        dhcp_snapshot, ssdp_snapshot, mdns_snapshot, discovered_ipv6
                    ): ip
                    for ip, mac in discovered.items()
                }
                for future in concurrent.futures.as_completed(future_to_ip):
                    try:
                        dev = future.result()
                        if dev:
                            devices.append(dev)
                    except Exception as e:
                        logger.warning(f"Error enriching device: {e}")

        # 9. Evaluasi Diagnostik AP Isolation
        try:
            cls._LATEST_AP_ISOLATION = detect_ap_isolation(discovered, candidates, dhcp_snapshot)
            if cls._LATEST_AP_ISOLATION.get('is_isolated'):
                logger.warning(f"🚨 [AP Isolation] {cls._LATEST_AP_ISOLATION.get('reason')} (Confidence: {cls._LATEST_AP_ISOLATION.get('percentage')}%)")
        except Exception as iso_err:
            logger.debug(f"AP Isolation evaluation notice: {iso_err}")

        # Urutkan berdasarkan oktet IP numerik
        devices.sort(key=lambda d: [int(x) if x.isdigit() else 0 for x in str(d.get('ip', '0.0.0.0')).split('.')])

        elapsed = time.time() - start_time
        logger.info(f"✅ SCAN SELESAI! {len(devices)} perangkat dipindai lengkap dalam {elapsed:.2f} detik.")
        return devices
