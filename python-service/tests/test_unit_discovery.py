"""
Unit & Concurrency Tests for Discovery Subsystem (src.core.discovery)
Covers: Happy Path, Negative Tests, and Thread-Safe Concurrency Edge Cases
"""

import unittest
import concurrent.futures
import socket
from unittest.mock import patch
from src.core.discovery import (
    dhcp_cache,
    get_ssdp_cache,
    get_mdns_cache
)
from src.core.discovery.multicast import collect_identity_multicast


def _dns_answer(transaction_id, hostname, ip):
    encoded_name = b"".join(
        bytes([len(part)]) + part.encode("ascii")
        for part in hostname.split(".")
    ) + b"\x00"
    return (
        transaction_id.to_bytes(2, "big")
        + b"\x84\x00\x00\x00\x00\x01\x00\x00\x00\x00"
        + encoded_name
        + b"\x00\x01\x00\x01\x00\x00\x00\x78\x00\x04"
        + socket.inet_aton(ip)
    )


SSDP_RESPONSE_FIXTURE = (
    b"HTTP/1.1 200 OK\r\n"
    b"LOCATION: http://192.168.1.20/device.xml\r\n"
    b"SERVER: Samsung SmartTV\r\n"
    b"ST: upnp:rootdevice\r\n"
    b"USN: uuid:living-room-tv\r\n\r\n"
)
MDNS_RESPONSE_FIXTURE = _dns_answer(0, "Galaxy-A07.local", "192.168.1.20")
LLMNR_RESPONSE_FIXTURE = _dns_answer(1, "DESKTOP-TEST", "192.168.1.30")

class TestCoreDiscovery(unittest.TestCase):

    def setUp(self):
        dhcp_cache.clear()

    # ===== 1. DHCP Cache Happy Path =====
    def test_dhcp_cache_happy_path(self):
        """Happy Path: Storing and retrieving DHCP metadata with message types."""
        entry = {
            'mac': '11:22:33:44:55:66',
            'ip': '192.168.1.120',
            'hostname': 'My-Phone',
            'message_type': 'ACK',
            'message_type_code': 5
        }
        dhcp_cache.update('11:22:33:44:55:66', '192.168.1.120', entry)

        by_mac = dhcp_cache.get('11:22:33:44:55:66')
        by_ip = dhcp_cache.get('192.168.1.120')

        self.assertIsNotNone(by_mac)
        self.assertEqual(by_mac['hostname'], 'My-Phone')
        self.assertEqual(by_mac['message_type'], 'ACK')
        self.assertEqual(by_ip['hostname'], 'My-Phone')

        snapshot = dhcp_cache.get_snapshot()
        self.assertIn('11:22:33:44:55:66', snapshot)
        self.assertIn('192.168.1.120', snapshot)

    def test_dhcp_cache_smart_merge_happy_path(self):
        """Happy Path: ACK with empty hostname must NOT overwrite existing hostname."""
        mac = 'aa:bb:cc:11:22:33'
        # 1. Paket DHCP Request membawa Hostname
        dhcp_cache.update(mac, '192.168.1.75', {'hostname': 'Galaxy-A52', 'message_type': 'REQUEST'})
        self.assertEqual(dhcp_cache.get(mac)['hostname'], 'Galaxy-A52')

        # 2. Paket DHCP ACK datang dari router dengan IP tapi Hostname kosong
        dhcp_cache.update(mac, '192.168.1.75', {'hostname': '', 'message_type': 'ACK'})
        # Hostname harus tetap Galaxy-A52!
        self.assertEqual(dhcp_cache.get(mac)['hostname'], 'Galaxy-A52')
        self.assertEqual(dhcp_cache.get(mac)['message_type'], 'ACK')

    def test_dhcp_cache_anti_ip_churn_reassignment(self):
        """Anti-Contamination: IP reassignment must cleanly switch to new MAC without cross-contamination."""
        mac_a = '11:11:11:11:11:11'
        mac_b = '22:22:22:22:22:22'
        shared_ip = '192.168.1.99'

        # Device A sewa IP .99
        dhcp_cache.update(mac_a, shared_ip, {'hostname': 'Device-A-Samsung'})
        self.assertEqual(dhcp_cache.get(shared_ip)['hostname'], 'Device-A-Samsung')

        # Device B masuk dan mengambil IP .99 yang sama
        dhcp_cache.update(mac_b, shared_ip, {'hostname': 'Device-B-iPhone'})
        
        # IP .99 sekarang mutlak milik Device B
        entry_ip = dhcp_cache.get(shared_ip)
        self.assertEqual(entry_ip['mac'], mac_b)
        self.assertEqual(entry_ip['hostname'], 'Device-B-iPhone')

        # Data Device A asli tetap terjaga di kuncinya sendiri
        entry_mac_a = dhcp_cache.get(mac_a)
        self.assertEqual(entry_mac_a['hostname'], 'Device-A-Samsung')

    def test_dhcp_cache_lru_capacity_edge_case(self):
        """Edge Case: Cache capacity bounds check (dropping oldest entry)."""
        from src.core.discovery.dhcp import DHCPDiscoveredCache
        bounded_cache = DHCPDiscoveredCache(max_capacity=5)
        for i in range(7):
            m = f"00:00:00:00:00:{i:02x}"
            bounded_cache.update(m, f"192.168.1.{i+10}", {'hostname': f"Host-{i}", 'last_seen': f"2026-01-0{i+1}"})

        # Kapasitas maksimal tidak boleh melebihi 5
        self.assertEqual(len(bounded_cache._cache_by_mac), 5)
        # Entri pertama (paling tua) harus sudah dibuang
        self.assertIsNone(bounded_cache.get("00:00:00:00:00:00"))
        # Entri terbaru harus tetap ada
        self.assertIsNotNone(bounded_cache.get("00:00:00:00:00:06"))

    # ===== 2. Negative Tests =====
    def test_dhcp_cache_empty_and_invalid_ip_negative(self):
        """Negative: 0.0.0.0 or empty IP string must NEVER be stored as a key."""
        entry = {'mac': 'aa:bb:cc:11:22:33', 'ip': '', 'hostname': 'Test'}
        dhcp_cache.update('aa:bb:cc:11:22:33', '', entry)

        snapshot = dhcp_cache.get_snapshot()
        self.assertNotIn('', snapshot)
        self.assertNotIn('0.0.0.0', snapshot)
        self.assertIn('aa:bb:cc:11:22:33', snapshot)

    # ===== 3. Edge Cases: Multithreaded Concurrency =====
    def test_dhcp_cache_concurrent_access_edge_case(self):
        """Edge Case: 20 threads simultaneously writing and reading from cache."""
        def worker(i: int):
            mac = f"00:11:22:33:44:{i:02x}"
            ip = f"192.168.1.{i+10}"
            # Write
            dhcp_cache.update(mac, ip, {'hostname': f"Host-{i}", 'idx': i})
            # Read
            _ = dhcp_cache.get(mac)
            _ = dhcp_cache.get_snapshot()

        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
            futures = [executor.submit(worker, i) for i in range(100)]
            for f in concurrent.futures.as_completed(futures):
                self.assertIsNone(f.exception())

        # Verify all entries were recorded cleanly
        snapshot = dhcp_cache.get_snapshot()
        self.assertGreaterEqual(len(snapshot), 100)

    def test_dhcp_options_51_and_3_defensive_parsing(self):
        """Happy & Edge: Option 51 (Lease) and Option 3 (Gateway) parsing."""
        from src.core.discovery.dhcp import _handle_dhcp_packet
        from scapy.all import Ether, IP, UDP, BOOTP, DHCP

        # Buat paket mock DHCP ACK dengan Opsi 51 (bytes) dan Opsi 3 (tuple)
        raw_lease_bytes = (86400).to_bytes(4, byteorder='big') # 24 jam
        pkt = Ether(src="aa:bb:cc:dd:ee:ff") / IP() / UDP() / BOOTP(
            chaddr=b'\xaa\xbb\xcc\xdd\xee\xff' + b'\x00'*10,
            yiaddr="192.168.1.55"
        ) / DHCP(options=[
            ('message-type', 5),
            ('hostname', 'Test-Lease-Host'),
            ('lease_time', raw_lease_bytes),
            ('router', ('192.168.1.1', '192.168.1.2')),
            'end'
        ])

        _handle_dhcp_packet(pkt)
        entry = dhcp_cache.get('aa:bb:cc:dd:ee:ff')
        self.assertIsNotNone(entry)
        self.assertIn("86400s", entry.get('lease_time', ''))
        self.assertEqual(entry.get('router_ip'), '192.168.1.1')

        # Test Infinite lease (0xFFFFFFFF) overflow guard
        inf_lease_bytes = (0xFFFFFFFF).to_bytes(4, byteorder='big')
        pkt_inf = Ether(src="11:22:33:aa:bb:cc") / IP() / UDP() / BOOTP(
            chaddr=b'\x11\x22\x33\xaa\xbb\xcc' + b'\x00'*10,
            yiaddr="192.168.1.56"
        ) / DHCP(options=[
            ('message-type', 5),
            ('lease_time', inf_lease_bytes),
            'end'
        ])
        _handle_dhcp_packet(pkt_inf)
        entry_inf = dhcp_cache.get('11:22:33:aa:bb:cc')
        self.assertEqual(entry_inf.get('lease_time'), "Permanent / Infinite Lease")

    def test_dhcp_sniffer_lifecycle_self_packet_wakeup(self):
        """Lifecycle: Sniffer start and stop gracefully terminates via loopback wakeup packet."""
        from src.core.discovery.dhcp import start_dhcp_sniffer, stop_dhcp_sniffer
        from unittest.mock import patch, MagicMock
        import time
        mock_thread = MagicMock()
        mock_thread.is_alive.return_value = False
        with patch('src.core.discovery.dhcp.threading.Thread', return_value=mock_thread), \
             patch('socket.socket'):
            start_dhcp_sniffer()
            time.sleep(0.1)
            stop_dhcp_sniffer()
        # Harus berhenti secara bersih
        from src.core.discovery import dhcp
        self.assertFalse(dhcp._dhcp_sniffer_running)

    def test_rogue_dhcp_detection(self):
        """Security: Verify Rogue DHCP server is detected when server_id != official gateway."""
        from src.core.discovery.dhcp import _handle_dhcp_packet
        from scapy.all import Ether, IP, UDP, BOOTP, DHCP
        from unittest.mock import patch

        pkt_rogue = Ether(src="de:ad:be:ef:00:01") / IP(src="192.168.1.250") / UDP() / BOOTP(
            chaddr=b'\xde\xad\xbe\xef\x00\x01' + b'\x00'*10,
            yiaddr="192.168.1.188"
        ) / DHCP(options=[
            ('message-type', 2), # OFFER
            ('server_id', '192.168.1.250'),
            ('router', '192.168.1.250'),
            'end'
        ])

        with patch('src.core.discovery.dhcp.get_network_info', return_value={'gateway': '192.168.1.1', 'ip': '192.168.1.100'}):
            _handle_dhcp_packet(pkt_rogue)
            entry = dhcp_cache.get('de:ad:be:ef:00:01')
            self.assertIsNotNone(entry)
            self.assertTrue(entry.get('is_rogue_dhcp'))
            self.assertEqual(entry.get('rogue_server_ip'), '192.168.1.250')
            self.assertEqual(entry.get('rogue_server_mac'), 'de:ad:be:ef:00:01')

    def test_dhcp_release_parsing(self):
        """Happy Path: Verify DHCP RELEASE (Option 53 = 7) flags is_release = True."""
        from src.core.discovery.dhcp import _handle_dhcp_packet
        from scapy.all import Ether, IP, UDP, BOOTP, DHCP

        pkt_release = Ether(src="aa:bb:cc:dd:ee:11") / IP() / UDP() / BOOTP(
            chaddr=b'\xaa\xbb\xcc\xdd\xee\x11' + b'\x00'*10,
            ciaddr="192.168.1.77"
        ) / DHCP(options=[
            ('message-type', 7), # RELEASE
            ('server_id', '192.168.1.1'),
            'end'
        ])

        _handle_dhcp_packet(pkt_release)
        entry = dhcp_cache.get('aa:bb:cc:dd:ee:11')
        self.assertIsNotNone(entry)
        self.assertTrue(entry.get('is_release'))
        self.assertEqual(entry.get('message_type'), 'RELEASE')

    def test_expanded_deterministic_prl_matrix(self):
        """Fingerprint: Verify PlayStation, Nintendo, iOS, macOS, Windows deterministic PRL signatures."""
        from src.core.discovery.dhcp import _handle_dhcp_packet
        from scapy.all import Ether, IP, UDP, BOOTP, DHCP

        # 1. PlayStation
        pkt_ps = Ether(src="00:d9:d1:11:22:33") / IP() / UDP() / BOOTP(
            chaddr=b'\x00\xd9\xd1\x11\x22\x33' + b'\x00'*10,
            yiaddr="192.168.1.60"
        ) / DHCP(options=[
            ('message-type', 3),
            ('vendor_class_id', 'PlayStation 5'),
            ('param_req_list', [1, 3, 6, 15, 28, 33, 43]),
            'end'
        ])
        _handle_dhcp_packet(pkt_ps)
        self.assertEqual(dhcp_cache.get('00:d9:d1:11:22:33')['dhcp_fingerprint'], 'Sony PlayStation')

        # 2. Apple macOS vs iOS
        pkt_mac = Ether(src="bc:d0:74:11:22:33") / IP() / UDP() / BOOTP(
            chaddr=b'\xbc\xd0\x74\x11\x22\x33' + b'\x00'*10,
            yiaddr="192.168.1.61"
        ) / DHCP(options=[
            ('message-type', 3),
            ('hostname', 'MacBook-Pro-Naim'),
            ('param_req_list', [1, 3, 6, 15, 119, 252]),
            'end'
        ])
        _handle_dhcp_packet(pkt_mac)
        self.assertEqual(dhcp_cache.get('bc:d0:74:11:22:33')['dhcp_fingerprint'], 'Apple macOS Signature')

        # 3. Android versioned
        pkt_android = Ether(src="82:3a:44:11:22:33") / IP() / UDP() / BOOTP(
            chaddr=b'\x82\x3a\x44\x11\x22\x33' + b'\x00'*10,
            yiaddr="192.168.1.62"
        ) / DHCP(options=[
            ('message-type', 3),
            ('vendor_class_id', 'android-dhcp-14'),
            ('param_req_list', [1, 3, 6, 15, 26, 28, 51, 58, 59, 43]),
            'end'
        ])
        _handle_dhcp_packet(pkt_android)
        self.assertIn('Android OS Signature (android-dhcp-14)', dhcp_cache.get('82:3a:44:11:22:33')['dhcp_fingerprint'])

    def test_sleeping_host_unicast_probe(self):
        """Happy & Edge: Verify Gateway-Disguised Unicast probe adds responding host to discovered map."""
        from src.core.discovery.arp import probe_sleeping_host_via_gateway_arp
        from scapy.all import Ether, ARP
        from unittest.mock import patch

        discovered = {}
        target_ip = "192.168.1.88"
        target_mac = "a8:3b:76:11:22:33"
        gateway_ip = "192.168.1.1"

        # Mock srp to simulate responding sleeping phone
        fake_rcv = Ether(src=target_mac) / ARP(hwsrc=target_mac, psrc=target_ip)
        with patch('src.core.discovery.arp.srp', return_value=([(None, fake_rcv)], [])):
            probe_sleeping_host_via_gateway_arp(target_ip, target_mac, gateway_ip, discovered, timeout=0.1)
            self.assertIn(target_ip, discovered)
            self.assertEqual(discovered[target_ip], target_mac)

    def test_sleeping_host_probe_uses_controller_identity(self):
        """A liveness probe must not advertise the gateway IP with controller MAC."""
        from src.core.discovery.arp import probe_sleeping_host_via_unicast_arp
        from scapy.all import ARP, Ether
        from unittest.mock import patch

        target_ip = '192.168.1.88'
        target_mac = 'a8:3b:76:11:22:33'
        self_ip = '192.168.1.100'
        self_mac = '00:11:22:33:44:55'

        with patch('src.core.discovery.arp.get_network_info', return_value={'ip': self_ip}), \
             patch('src.core.discovery.arp.get_self_mac', return_value=self_mac), \
             patch('src.core.discovery.arp.srp', return_value=([], [])) as mock_srp:
            probe_sleeping_host_via_unicast_arp(
                target_ip,
                target_mac,
                {},
                timeout=0.1,
            )

        sent = mock_srp.call_args.args[0]
        self.assertEqual(sent[Ether].src, self_mac)
        self.assertEqual(sent[ARP].hwsrc, self_mac)
        self.assertEqual(sent[ARP].psrc, self_ip)
        self.assertEqual(sent[ARP].pdst, target_ip)

    def test_sleeping_host_unicast_probe_rejects_non_private_gateway(self):
        from src.core.discovery.arp import probe_sleeping_host_via_gateway_arp
        from unittest.mock import patch

        with patch('src.core.discovery.arp.get_self_mac', return_value='00:11:22:33:44:55'), \
             patch('src.core.discovery.arp.srp', return_value=([], [])) as mock_srp:
            probe_sleeping_host_via_gateway_arp(
                '192.168.1.88',
                'a8:3b:76:11:22:33',
                '203.0.113.1',
                {},
                timeout=0.1,
            )

        mock_srp.assert_not_called()

    def test_scanner_device_history_structure_and_wakeup_integration(self):
        """Verify _DEVICE_HISTORY records valid IP/MAC/timestamp and scan_full dispatches unicast probes."""
        from src.core.scanner import NetworkScanner
        from unittest.mock import patch
        import time

        # Reset history
        NetworkScanner._DEVICE_HISTORY.clear()

        # Simulate build device
        with patch('src.core.scanner.get_self_mac', return_value=''), \
             patch('src.core.scanner.get_hostname_info', return_value=('', {'workgroup': '', 'user': ''})), \
             patch('src.core.scanner.ping_fast', return_value={'alive': True, 'rtt': 1, 'ttl': 64}), \
             patch('src.core.scanner.scan_ports', return_value={}), \
             patch('src.core.scanner.get_http_info', return_value={}), \
             patch('src.core.scanner.measure_target_proximity', return_value={}), \
             patch(
                 'src.core.scanner.synthesize_ensemble_profile',
                 return_value=('', 'Test Vendor', 'Unknown', 'Unknown'),
             ):
            dev1 = NetworkScanner._build_device(
                ip='192.168.1.105',
                mac='a8:3b:76:00:11:22',
                gateway_ip='192.168.1.1',
                is_active_layer2=True
            )
        self.assertIn('a8:3b:76:00:11:22', NetworkScanner._DEVICE_HISTORY)
        hist_entry = NetworkScanner._DEVICE_HISTORY['a8:3b:76:00:11:22']
        self.assertEqual(hist_entry['ip'], '192.168.1.105')
        self.assertEqual(hist_entry['mac'], 'a8:3b:76:00:11:22')
        self.assertIn('last_seen_ts', hist_entry)

        # Add a sleeping device to history
        NetworkScanner._DEVICE_HISTORY['b4:c8:10:99:88:77'] = {
            'ip': '192.168.1.150',
            'mac': 'b4:c8:10:99:88:77',
            'first_seen': '2026-08-28 12:00:00',
            'last_seen': '2026-08-28 12:00:00',
            'last_seen_ts': time.time() - 300
        }

        probed_targets = []
        def mock_probe_sleeping(target_ip, target_mac, discovered, timeout=0.2):
            probed_targets.append((target_ip, target_mac))
            discovered[target_ip] = target_mac

        with patch('src.core.scanner.get_current_gateway', return_value='192.168.1.1'), \
             patch('src.core.scanner.get_network_info', return_value={'ip': '192.168.1.20', 'network': '192.168.1.0/24'}), \
             patch('src.core.scanner.collect_ssdp_sensors'), \
             patch('src.core.scanner.collect_mdns_sensors'), \
             patch('src.core.scanner.collect_from_arp_cache') as mock_arp_cache, \
             patch('src.core.scanner.collect_from_arp_broadcast'), \
             patch('src.core.scanner.sweep_subnet_for_arp'), \
             patch('src.core.scanner.send_multicast_wakeup'), \
             patch('src.core.scanner.probe_sleeping_host_via_unicast_arp', side_effect=mock_probe_sleeping), \
             patch('src.core.scanner.get_mac_from_arp', return_value='00:11:22:33:44:55'), \
             patch('src.core.scanner.get_self_mac', return_value='a8:3b:76:0c:dc:55'), \
             patch.object(
                 NetworkScanner,
                 '_build_device',
                 side_effect=lambda ip, mac, *_args, **_kwargs: {'ip': ip, 'mac': mac},
             ):

            results = NetworkScanner.scan_full()
            # Sleeping host must have been probed!
            self.assertIn(('192.168.1.150', 'b4:c8:10:99:88:77'), probed_targets)
            # Sleeping host must be returned in results
            result_ips = [d['ip'] for d in results]
            self.assertIn('192.168.1.150', result_ips)

    def test_scan_full_unresolved_network_skips_every_active_discovery_helper(self):
        """Unresolved topology must return before any packet-capable scanner helper."""
        from src.core.scanner import NetworkScanner
        from unittest.mock import patch

        NetworkScanner._DEVICE_HISTORY.clear()
        NetworkScanner._DEVICE_HISTORY['b4:c8:10:99:88:77'] = {
            'ip': '192.168.1.150',
            'mac': 'b4:c8:10:99:88:77',
        }

        try:
            with patch('src.core.scanner.get_current_gateway', return_value=''), \
                 patch(
                     'src.core.scanner.get_network_info',
                     return_value={'ip': '', 'network': '', 'gateway': ''}
                 ), \
                 patch('src.core.scanner.collect_ssdp_sensors') as mock_ssdp, \
                 patch('src.core.scanner.collect_mdns_sensors') as mock_mdns, \
                 patch('src.core.scanner.collect_from_arp_cache') as mock_arp_cache, \
                 patch('src.core.scanner.collect_from_arp_broadcast') as mock_arp_broadcast, \
                 patch('src.core.scanner.sweep_subnet_for_arp') as mock_arp_sweep, \
                 patch('src.core.scanner.send_multicast_wakeup') as mock_multicast_wakeup, \
                 patch('src.core.scanner.collect_from_ndp_cache') as mock_ndp_cache, \
                 patch('src.core.scanner.send_ipv6_all_nodes_multicast') as mock_ipv6_multicast, \
                 patch('src.core.scanner.probe_sleeping_host_via_unicast_arp') as mock_sleeping_probe, \
                 patch('src.core.scanner.verify_ipv6_alive') as mock_ipv6_liveness, \
                 patch('src.core.scanner.get_mac_from_arp') as mock_gateway_probe, \
                 patch.object(NetworkScanner, '_build_device') as mock_device_builder, \
                 patch('src.core.scanner.get_self_mac', return_value='') as mock_self_mac, \
                 patch('src.core.scanner.detect_ap_isolation', return_value={}), \
                 patch('src.core.discovery.arp.get_self_mac', return_value='00:11:22:33:44:55'), \
                 patch('src.core.discovery.arp.srp', return_value=([], [])) as mock_srp:
                result = NetworkScanner.scan_full()

            self.assertEqual(result, [])
            mock_srp.assert_not_called()
            for helper in (
                mock_multicast_wakeup,
                mock_ssdp,
                mock_mdns,
                mock_ndp_cache,
                mock_ipv6_multicast,
                mock_arp_cache,
                mock_arp_broadcast,
                mock_arp_sweep,
                mock_sleeping_probe,
                mock_ipv6_liveness,
                mock_gateway_probe,
                mock_self_mac,
                mock_device_builder,
            ):
                helper.assert_not_called()
        finally:
            NetworkScanner._DEVICE_HISTORY.clear()

    def test_scan_full_public_network_skips_every_active_discovery_helper(self):
        """A public CIDR is rejected before multicast, ARP, or enrichment probes run."""
        from src.core.scanner import NetworkScanner
        from unittest.mock import patch

        with patch('src.core.scanner.get_current_gateway', return_value='203.0.113.1'), \
             patch(
                 'src.core.scanner.get_network_info',
                 return_value={
                     'ip': '203.0.113.10',
                     'network': '203.0.113.0/24',
                     'gateway': '203.0.113.1',
                 },
             ), \
             patch('src.core.scanner.send_multicast_wakeup') as mock_multicast_wakeup, \
             patch('src.core.scanner.collect_ssdp_sensors') as mock_ssdp, \
             patch('src.core.scanner.collect_mdns_sensors') as mock_mdns, \
             patch('src.core.scanner.collect_from_arp_cache') as mock_arp_cache, \
             patch('src.core.scanner.collect_from_ndp_cache') as mock_ndp_cache, \
             patch('src.core.scanner.send_ipv6_all_nodes_multicast') as mock_ipv6_multicast, \
             patch('src.core.scanner.collect_from_arp_broadcast') as mock_arp_broadcast, \
             patch('src.core.scanner.sweep_subnet_for_arp') as mock_arp_sweep, \
             patch('src.core.scanner.probe_sleeping_host_via_unicast_arp') as mock_sleeping_probe, \
             patch('src.core.scanner.verify_ipv6_alive') as mock_ipv6_liveness, \
             patch('src.core.scanner.get_mac_from_arp') as mock_gateway_probe, \
             patch.object(NetworkScanner, '_build_device') as mock_device_builder, \
             patch('src.core.scanner.get_self_mac', return_value='') as mock_self_mac, \
             patch('src.core.scanner.detect_ap_isolation', return_value={}):
            result = NetworkScanner.scan_full()

        self.assertEqual(result, [])
        for helper in (
            mock_multicast_wakeup,
            mock_ssdp,
            mock_mdns,
            mock_ndp_cache,
            mock_ipv6_multicast,
            mock_arp_cache,
            mock_arp_broadcast,
            mock_arp_sweep,
            mock_sleeping_probe,
            mock_ipv6_liveness,
            mock_gateway_probe,
            mock_self_mac,
            mock_device_builder,
        ):
            helper.assert_not_called()

    def test_scan_full_can_skip_duplicate_multicast_wakeup(self):
        """Technique 3B scan must retain discovery but not send a second wake-up burst."""
        from src.core.scanner import NetworkScanner
        from unittest.mock import patch

        with patch('src.core.scanner.get_current_gateway', return_value='192.168.1.1'), \
             patch(
                 'src.core.scanner.get_network_info',
                 return_value={
                     'ip': '192.168.1.100',
                     'network': '192.168.1.0/24',
                     'gateway': '192.168.1.1',
                 },
             ), \
             patch('src.core.scanner.send_multicast_wakeup') as mock_wakeup, \
             patch('src.core.scanner.collect_ssdp_sensors') as mock_ssdp, \
             patch('src.core.scanner.collect_mdns_sensors') as mock_mdns, \
             patch('src.core.scanner.collect_from_ndp_cache'), \
             patch('src.core.scanner.send_ipv6_all_nodes_multicast'), \
             patch('src.core.scanner.collect_from_arp_cache'), \
             patch('src.core.scanner.collect_from_arp_broadcast'), \
             patch('src.core.scanner.sweep_subnet_for_arp'), \
             patch('src.core.scanner.get_mac_from_arp', return_value='00:aa:bb:cc:dd:ee'), \
             patch('src.core.scanner.get_self_mac', return_value='00:11:22:33:44:55'), \
             patch.object(NetworkScanner, '_build_device', return_value=None), \
             patch('src.core.scanner.detect_ap_isolation', return_value={}):
            NetworkScanner.scan_full(include_multicast_wakeup=False)

        mock_wakeup.assert_not_called()
        mock_ssdp.assert_called_once()
        mock_mdns.assert_called_once()

    def test_sweep_subnet_for_arp_resilience_and_fallbacks(self):
        """Edge Cases: sweep_subnet_for_arp with empty self_ip, supernet /16, and RFC 1918 enforcement."""
        from src.core.discovery.arp import sweep_subnet_for_arp
        from unittest.mock import patch

        discovered = {}

        # 1. Invalid network must fail closed without probing.
        with patch('src.core.discovery.arp.get_network_info', return_value={'network': 'invalid_cidr', 'ip': '', 'gateway': ''}), \
             patch('src.core.discovery.arp.socket.socket') as mock_sock, \
             patch('src.core.discovery.arp.collect_from_arp_cache'):
            sweep_subnet_for_arp(discovered)
            mock_sock.assert_not_called()

        # 2. Test huge supernet (/16) restriction to local /24 block
        with patch('src.core.discovery.arp.get_network_info', return_value={'network': '10.0.0.0/16', 'ip': '10.0.50.25', 'gateway': '10.0.0.1'}), \
             patch('src.core.discovery.arp.socket.socket'), \
             patch('src.core.discovery.arp.collect_from_arp_cache'):
            sweep_subnet_for_arp(discovered)
            # Should safely execute

    def test_arp_broadcast_skips_non_rfc1918_network(self):
        from src.core.discovery.arp import collect_from_arp_broadcast
        from unittest.mock import patch

        with patch(
            'src.core.discovery.arp.get_network_info',
            return_value={'network': '203.0.113.0/24', 'ip': '203.0.113.10'}
        ), patch('src.core.discovery.arp.srp') as mock_srp:
            collect_from_arp_broadcast({})

        mock_srp.assert_not_called()

    def test_arp_sweep_skips_non_rfc1918_network(self):
        from src.core.discovery.arp import sweep_subnet_for_arp
        from unittest.mock import patch

        with patch(
            'src.core.discovery.arp.get_network_info',
            return_value={
                'network': '203.0.113.0/24',
                'ip': '203.0.113.10',
                'gateway': '203.0.113.1'
            }
        ), patch('src.core.discovery.arp.socket.socket') as mock_socket, \
             patch('src.core.discovery.arp.collect_from_arp_cache'):
            sweep_subnet_for_arp({})

        mock_socket.assert_not_called()

    def test_dhcp6_packet_handling(self):
        """Verify DHCPv6 packet parser extracts DUID, Vendor Class, and ORO fingerprint."""
        from scapy.all import Ether, IPv6, UDP, DHCP6_Solicit, DHCP6OptClientId, DHCP6OptVendorClass, DHCP6OptOptReq
        from src.core.discovery.dhcp import _handle_dhcp6_packet, dhcp_cache

        # Create Mock Scapy DHCPv6 Solicit packet
        pkt = (
            Ether(src='4e:e1:14:14:ad:87', dst='33:33:00:01:00:02') /
            IPv6(src='fe80::4ee1:14ff:fe14:ad87', dst='ff02::1:2') /
            UDP(sport=546, dport=547) /
            DHCP6_Solicit() /
            DHCP6OptClientId(duid=b'\x00\x01\x00\x01\x2c\x3d\x4e\xe1\x14\x14\xad\x87') /
            DHCP6OptVendorClass(enterprisenum=9999, vcdata=[b'android-dhcp-15']) /
            DHCP6OptOptReq(reqopts=[23, 24, 31])
        )

        _handle_dhcp6_packet(pkt)

        entry = dhcp_cache.get('4e:e1:14:14:ad:87')
        self.assertIsNotNone(entry)
        self.assertEqual(entry['mac'], '4e:e1:14:14:ad:87')
        self.assertIn('2c:3d:4e:e1:14:14:ad:87', entry['client_id'])
        self.assertEqual(entry['vendor_class'], 'android-dhcp-15')
        self.assertEqual(entry['dhcp_fingerprint'], 'Android DHCPv6 Signature')
        self.assertEqual(entry['message_type'], 'SOLICIT')

    def test_dual_stack_multicast_wakeup_execution(self):
        """Verify send_multicast_wakeup runs dual-stack IPv4 + IPv6 bursts safely."""
        from src.core.discovery.multicast import send_multicast_wakeup
        from unittest.mock import patch
        with patch('src.core.discovery.multicast.socket.socket'):
            send_multicast_wakeup()

    def test_multicast_wakeup_reports_partial_delivery(self):
        """Method 1 must report each successful and failed discovery datagram."""
        from src.core.discovery.multicast import send_multicast_wakeup
        from unittest.mock import patch

        class FakeSocket:
            def __init__(self, family):
                self.family = family

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def setsockopt(self, *_args):
                return None

            def settimeout(self, *_args):
                return None

            def sendto(self, _payload, destination):
                if destination[0] == 'ff02::c':
                    raise OSError('IPv6 SSDP unavailable')
                return 1

        def socket_factory(family, *_args):
            return FakeSocket(family)

        with patch('src.core.discovery.multicast.socket.socket', side_effect=socket_factory):
            result = send_multicast_wakeup()

        self.assertEqual(result['attempted'], 6)
        self.assertEqual(result['succeeded'], 5)
        self.assertEqual(result['failed'], 1)
        self.assertFalse(result['protocols']['ssdp_ipv6'])
        self.assertTrue(result['protocols']['mdns_ipv4'])
        self.assertEqual(result['errors'][0]['protocol'], 'ssdp_ipv6')

    def test_identity_multicast_receives_on_the_query_sockets(self):
        class FakeDiscoverySocket:
            def __init__(self):
                self.sent = []
                self.received_after_send = False

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def setsockopt(self, *_args):
                return None

            def settimeout(self, _timeout):
                return None

            def sendto(self, payload, destination):
                self.sent.append((payload, destination))
                return len(payload)

            def recvfrom(self, _size):
                self.received_after_send = bool(self.sent)
                raise socket.timeout()

        sockets = [FakeDiscoverySocket(), FakeDiscoverySocket()]
        with patch(
            "src.core.discovery.multicast.socket.socket",
            side_effect=sockets,
        ):
            result = collect_identity_multicast(timeout=0.01)

        self.assertTrue(all(sock.received_after_send for sock in sockets))
        self.assertEqual(result["delivery"]["attempted"], 6)

    def test_identity_multicast_normalizes_current_call_packet_fixtures(self):
        from src.core.discovery import multicast

        class FixtureSocket:
            def __init__(self, responses):
                self.responses = list(responses)

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def setsockopt(self, *_args):
                return None

            def settimeout(self, _timeout):
                return None

            def sendto(self, payload, _destination):
                return len(payload)

            def recvfrom(self, _size):
                if not self.responses:
                    raise socket.timeout()
                return self.responses.pop(0)

        ipv4_socket = FixtureSocket([
            (SSDP_RESPONSE_FIXTURE, ("192.168.1.20", 1900)),
            (MDNS_RESPONSE_FIXTURE, ("192.168.1.20", 5353)),
            (LLMNR_RESPONSE_FIXTURE, ("192.168.1.30", 5355)),
        ])
        ipv6_socket = FixtureSocket([])
        multicast._SSDP_DISCOVERED.clear()
        multicast._MDNS_DISCOVERED.clear()
        multicast._SSDP_DISCOVERED["192.168.1.99"] = {"server": "stale"}
        multicast._MDNS_DISCOVERED["192.168.1.99"] = {"hostname": "stale"}

        with patch(
            "src.core.discovery.multicast.socket.socket",
            side_effect=[ipv4_socket, ipv6_socket],
        ):
            result = collect_identity_multicast(timeout=0.01)

        self.assertEqual(
            result["ssdp"]["192.168.1.20"]["server"],
            "Samsung SmartTV",
        )
        self.assertEqual(
            result["mdns"]["192.168.1.20"]["hostname"],
            "Galaxy-A07",
        )
        self.assertEqual(
            result["llmnr"]["192.168.1.30"]["hostname"],
            "DESKTOP-TEST",
        )
        self.assertNotIn("192.168.1.99", result["ssdp"])
        self.assertNotIn("192.168.1.99", result["mdns"])
        self.assertIn("192.168.1.99", get_ssdp_cache())
        self.assertIn("192.168.1.99", get_mdns_cache())

    def test_dhcp_unique_snapshot_and_delta_are_mac_centric(self):
        """One device must count once and profile changes must be measurable."""
        from src.core.discovery.dhcp import DHCPDiscoveredCache, diff_dhcp_profiles

        cache = DHCPDiscoveredCache()
        cache.update(
            'aa:bb:cc:dd:ee:01',
            '192.168.1.20',
            {'hostname': 'Phone', 'vendor_class': ''},
        )
        before = cache.get_unique_snapshot()

        self.assertEqual(list(before), ['aa:bb:cc:dd:ee:01'])

        cache.update(
            'aa:bb:cc:dd:ee:01',
            '192.168.1.20',
            {'hostname': 'Phone', 'vendor_class': 'android-dhcp-14'},
        )
        cache.update(
            'aa:bb:cc:dd:ee:02',
            '192.168.1.21',
            {'hostname': 'Laptop', 'dhcp_fingerprint': 'Microsoft Windows Signature'},
        )
        after = cache.get_unique_snapshot()
        delta = diff_dhcp_profiles(before, after)

        self.assertEqual(len(after), 2)
        self.assertEqual(delta['new_count'], 1)
        self.assertEqual(delta['updated_count'], 1)
        self.assertEqual(delta['new_macs'], ['aa:bb:cc:dd:ee:02'])
        self.assertEqual(delta['updated_macs'], ['aa:bb:cc:dd:ee:01'])

    def test_dhcp_prl_matching_uses_integer_options_not_substrings(self):
        """Options 128/151/158 must not masquerade as Android 28/51/58."""
        from src.core.discovery.dhcp import _handle_dhcp_packet
        from scapy.all import Ether, IP, UDP, BOOTP, DHCP

        false_positive_mac = '02:11:22:33:44:55'
        false_positive = (
            Ether(src=false_positive_mac)
            / IP(src='0.0.0.0', dst='255.255.255.255')
            / UDP(sport=68, dport=67)
            / BOOTP(chaddr=bytes.fromhex('021122334455') + bytes(10), xid=1)
            / DHCP(options=[
                ('message-type', 3),
                ('requested_addr', '192.168.1.77'),
                ('param_req_list', [128, 151, 158]),
                'end',
            ])
        )
        _handle_dhcp_packet(false_positive)
        false_entry = dhcp_cache.get(false_positive_mac)
        self.assertNotEqual(false_entry['dhcp_fingerprint'], 'Android OS Signature')

        android_mac = '02:11:22:33:44:66'
        android = (
            Ether(src=android_mac)
            / IP(src='0.0.0.0', dst='255.255.255.255')
            / UDP(sport=68, dport=67)
            / BOOTP(chaddr=bytes.fromhex('021122334466') + bytes(10), xid=2)
            / DHCP(options=[
                ('message-type', 3),
                ('requested_addr', '192.168.1.78'),
                ('param_req_list', [1, 3, 6, 26, 28, 51, 58, 59]),
                'end',
            ])
        )
        _handle_dhcp_packet(android)
        self.assertEqual(
            dhcp_cache.get(android_mac)['dhcp_fingerprint'],
            'Android OS Signature',
        )

    def test_dhcp_renewal_falls_through_zero_yiaddr_to_ciaddr(self):
        """A renewal REQUEST with ciaddr must retain its current private IP."""
        from src.core.discovery.dhcp import _handle_dhcp_packet
        from scapy.all import Ether, IP, UDP, BOOTP, DHCP

        mac = '02:aa:bb:cc:dd:ee'
        packet = (
            Ether(src=mac)
            / IP(src='192.168.1.88', dst='192.168.1.1')
            / UDP(sport=68, dport=67)
            / BOOTP(
                chaddr=bytes.fromhex('02aabbccddee') + bytes(10),
                ciaddr='192.168.1.88',
                yiaddr='0.0.0.0',
                xid=3,
            )
            / DHCP(options=[('message-type', 3), ('hostname', b'Renewing-Host'), 'end'])
        )

        _handle_dhcp_packet(packet)

        entry = dhcp_cache.get(mac)
        self.assertIsNotNone(entry)
        self.assertEqual(entry['ip'], '192.168.1.88')

    # ===== 4. SSDP Descriptor Fetch — M1 unbounded-read hardening =====
    def test_ssdp_descriptor_read_is_capped(self):
        """Security (M1): descriptor fetch must cap res.read() to a bounded size, never unbounded."""
        from src.core.discovery.multicast import _fetch_ssdp_descriptor, MAX_SSDP_DESCRIPTOR_BYTES

        read_calls = []

        class _FakeResp:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *a):
                return False

            def read(self_inner, n=-1):
                read_calls.append(n)
                return (b'<root xmlns="urn:schemas-upnp-org:device-1-0">'
                        b'<device><friendlyName>Cap Test</friendlyName></device></root>')

        def fake_opener(req, timeout=None):
            return _FakeResp()

        info = _fetch_ssdp_descriptor('http://192.168.1.50/desc.xml', '192.168.1.50', opener=fake_opener)

        # read() must be asked for a POSITIVE byte cap — never unbounded (-1 / None)
        self.assertTrue(read_calls, "res.read() was never called")
        self.assertIn(MAX_SSDP_DESCRIPTOR_BYTES, read_calls)
        self.assertNotIn(-1, read_calls)
        self.assertNotIn(None, read_calls)
        self.assertEqual(info['friendly_name'], 'Cap Test')

    def test_ssdp_descriptor_parses_normal_within_cap(self):
        """A normal small descriptor still parses fully (no legit device loses its name)."""
        from src.core.discovery.multicast import _fetch_ssdp_descriptor

        xml = (b'<?xml version="1.0"?>'
               b'<root xmlns="urn:schemas-upnp-org:device-1-0"><device>'
               b'<friendlyName>Living Room TV</friendlyName>'
               b'<manufacturer>Acme</manufacturer>'
               b'<modelName>X-100</modelName></device></root>')

        class _R:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *a):
                return False

            def read(self_inner, n=-1):
                return xml[:n] if (n is not None and n >= 0) else xml

        info = _fetch_ssdp_descriptor('http://10.0.0.5/d.xml', '10.0.0.5',
                                      opener=lambda req, timeout=None: _R())
        self.assertEqual(info['friendly_name'], 'Living Room TV')
        self.assertEqual(info['manufacturer'], 'Acme')
        self.assertEqual(info['model_name'], 'X-100')

    def test_ssdp_descriptor_rejects_ssrf_mismatch(self):
        """SSRF-guard preserved: URL host != SSDP sender IP must NOT be fetched."""
        from src.core.discovery.multicast import _fetch_ssdp_descriptor

        opened = []

        def opener(req, timeout=None):
            opened.append(True)
            raise AssertionError("opener must not be called on host/ip mismatch")

        res = _fetch_ssdp_descriptor('http://evil.example.com/d.xml', '192.168.1.50', opener=opener)
        self.assertIsNone(res)
        self.assertEqual(opened, [])

    def test_ssdp_descriptor_oversize_degrades_gracefully(self):
        """Oversize/garbage payload: read stays bounded and helper returns None (no raise)."""
        from src.core.discovery.multicast import _fetch_ssdp_descriptor, MAX_SSDP_DESCRIPTOR_BYTES

        huge = b'A' * (MAX_SSDP_DESCRIPTOR_BYTES * 4)
        read_sizes = []

        class _R:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *a):
                return False

            def read(self_inner, n=-1):
                read_sizes.append(n)
                return huge[:n] if (n is not None and n >= 0) else huge

        res = _fetch_ssdp_descriptor('http://192.168.1.9/d.xml', '192.168.1.9',
                                     opener=lambda req, timeout=None: _R())
        self.assertIsNone(res)
        self.assertTrue(read_sizes)
        self.assertTrue(all(s is not None and 0 <= s <= MAX_SSDP_DESCRIPTOR_BYTES for s in read_sizes))

if __name__ == '__main__':
    unittest.main()
