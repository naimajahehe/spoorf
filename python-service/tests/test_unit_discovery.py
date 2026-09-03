"""
Unit & Concurrency Tests for Discovery Subsystem (src.core.discovery)
Covers: Happy Path, Negative Tests, and Thread-Safe Concurrency Edge Cases
"""

import unittest
import concurrent.futures
from src.core.discovery import (
    dhcp_cache,
    get_ssdp_cache,
    get_mdns_cache
)

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
        def mock_probe_sleeping(target_ip, target_mac, gw_ip, discovered, timeout=0.2):
            probed_targets.append((target_ip, target_mac))
            discovered[target_ip] = target_mac

        with patch('src.core.scanner.get_current_gateway', return_value='192.168.1.1'), \
             patch('src.core.scanner.get_network_info', return_value={'ip': '192.168.1.20', 'network': '192.168.1.0/24'}), \
             patch('src.core.scanner.collect_ssdp_sensors'), \
             patch('src.core.scanner.collect_mdns_sensors'), \
             patch('src.core.scanner.collect_from_arp_cache'), \
             patch('src.core.scanner.collect_from_arp_broadcast'), \
             patch('src.core.scanner.sweep_subnet_for_arp'), \
             patch('src.core.scanner.send_multicast_wakeup'), \
             patch('src.core.scanner.probe_sleeping_host_via_gateway_arp', side_effect=mock_probe_sleeping), \
             patch('src.core.scanner.get_mac_from_arp', return_value='00:11:22:33:44:55'), \
             patch('src.core.scanner.get_self_mac', return_value='a8:3b:76:0c:dc:55'):

            results = NetworkScanner.scan_full()
            # Sleeping host must have been probed!
            self.assertIn(('192.168.1.150', 'b4:c8:10:99:88:77'), probed_targets)
            # Sleeping host must be returned in results
            result_ips = [d['ip'] for d in results]
            self.assertIn('192.168.1.150', result_ips)

    def test_scan_full_unresolved_network_never_sends_arp(self):
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
                 patch('src.core.scanner.collect_ssdp_sensors'), \
                 patch('src.core.scanner.collect_mdns_sensors'), \
                 patch('src.core.scanner.collect_from_arp_cache'), \
                 patch('src.core.scanner.collect_from_arp_broadcast'), \
                 patch('src.core.scanner.sweep_subnet_for_arp'), \
                 patch('src.core.scanner.send_multicast_wakeup'), \
                 patch('src.core.scanner.collect_from_ndp_cache'), \
                 patch('src.core.scanner.send_ipv6_all_nodes_multicast'), \
                 patch('src.core.scanner.get_self_mac', return_value=''), \
                 patch('src.core.scanner.detect_ap_isolation', return_value={}), \
                 patch('src.core.discovery.arp.get_self_mac', return_value='00:11:22:33:44:55'), \
                 patch('src.core.discovery.arp.srp', return_value=([], [])) as mock_srp:
                NetworkScanner.scan_full()

            mock_srp.assert_not_called()
        finally:
            NetworkScanner._DEVICE_HISTORY.clear()

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

if __name__ == '__main__':
    unittest.main()
