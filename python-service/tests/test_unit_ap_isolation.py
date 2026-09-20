import unittest
from unittest.mock import patch, MagicMock
from src.core.discovery.ap_isolation import (
    detect_ap_isolation,
    probe_multicast_bssid_reflection,
    probe_l3_hairpinning,
    test_multicast_bssid_reflection as legacy_multicast_probe,
    test_l3_hairpinning as legacy_l3_probe
)

class TestUnitApIsolation(unittest.TestCase):
    """Test suite unit untuk AP Isolation Detector."""

    def test_probe_backward_compatibility_aliases(self):
        """Pastikan alias legacy tetap merujuk ke fungsi probe yang sama."""
        self.assertIs(legacy_multicast_probe, probe_multicast_bssid_reflection)
        self.assertIs(legacy_l3_probe, probe_l3_hairpinning)

    def test_probe_l3_hairpinning_invalid_inputs_returns_false(self):
        """Uji probe_l3_hairpinning langsung menolak IP atau MAC invalid."""
        self.assertFalse(probe_l3_hairpinning("invalid-ip", "00:11:22:33:44:55"))
        self.assertFalse(probe_l3_hairpinning("192.168.1.50", "invalid-mac"))
        self.assertFalse(probe_l3_hairpinning("8.8.8.8", "00:11:22:33:44:55"))

    @patch('src.core.discovery.ap_isolation.socket.socket')
    def test_multicast_reflection_joins_group(self, mock_socket_cls):
        """BUG-18: rx socket WAJIB IP_ADD_MEMBERSHIP ke 224.0.0.1. Tanpa join, di Windows
        recvfrom selalu timeout -> test selalu return False -> skor isolasi keliru +35
        (false positive 'AP Isolation' saat pengguna hanya sendirian di jaringan)."""
        import socket as syssock
        rx = MagicMock()
        tx = MagicMock()
        rx.recvfrom.side_effect = syssock.timeout()
        mock_socket_cls.side_effect = [rx, tx]

        probe_multicast_bssid_reflection(timeout=0.05)

        joined = any(
            len(c.args) >= 2 and c.args[1] == syssock.IP_ADD_MEMBERSHIP
            for c in rx.setsockopt.call_args_list
        )
        self.assertTrue(joined, "rx socket harus join grup multicast 224.0.0.1 (IP_ADD_MEMBERSHIP)")

    @patch('src.core.discovery.ap_isolation.get_current_gateway', return_value='192.168.1.1')
    @patch('src.core.discovery.ap_isolation.get_network_info', return_value={'ip': '192.168.1.100', 'network': '192.168.1.0/24'})
    @patch('src.core.discovery.ap_isolation.get_self_mac', return_value='a8:3b:76:0c:dc:55')
    def test_normal_network_multiple_peers_zero_percent(self, mock_self, mock_net, mock_gw):
        """Uji jaringan normal (ada peer L2 lain): skor isolasi wajib 0%."""
        discovered = {
            '192.168.1.1': '00:11:22:33:44:55',
            '192.168.1.100': 'a8:3b:76:0c:dc:55',
            '192.168.1.50': 'aa:bb:cc:dd:ee:01',
            '192.168.1.51': 'aa:bb:cc:dd:ee:02'
        }
        res = detect_ap_isolation(discovered)
        self.assertFalse(res['is_isolated'])
        self.assertEqual(res['percentage'], 0)
        self.assertEqual(res['confidence'], 0.0)
        self.assertEqual(res['status'], 'normal')
        self.assertEqual(res['indicators']['l2_peers_found'], 2)

    @patch('src.core.discovery.ap_isolation.get_current_gateway', return_value='192.168.1.1')
    @patch('src.core.discovery.ap_isolation.get_network_info', return_value={'ip': '192.168.1.100', 'network': '192.168.1.0/24'})
    @patch('src.core.discovery.ap_isolation.get_self_mac', return_value='a8:3b:76:0c:dc:55')
    @patch('src.core.discovery.ap_isolation.probe_multicast_bssid_reflection', return_value=False)
    def test_isolated_network_lone_client_guard(self, mock_mcast, mock_self, mock_net, mock_gw):
        """Uji kondisi zero-peer dengan multicast diblokir (tanpa kandidat history): capped di 70%."""
        discovered = {
            '192.168.1.1': '00:11:22:33:44:55',
            '192.168.1.100': 'a8:3b:76:0c:dc:55'
        }
        res = detect_ap_isolation(discovered)
        self.assertTrue(res['is_isolated'])
        self.assertEqual(res['percentage'], 70)
        self.assertEqual(res['status'], 'probable')
        self.assertTrue(res['indicators']['multicast_echo_blocked'])

    @patch('src.core.discovery.ap_isolation.get_current_gateway', return_value='192.168.1.1')
    @patch('src.core.discovery.ap_isolation.get_network_info', return_value={'ip': '192.168.1.100', 'network': '192.168.1.0/24'})
    @patch('src.core.discovery.ap_isolation.get_self_mac', return_value='a8:3b:76:0c:dc:55')
    @patch('src.core.discovery.ap_isolation.probe_multicast_bssid_reflection', return_value=False)
    @patch('src.core.discovery.ap_isolation.probe_l3_hairpinning', return_value=True)
    def test_isolated_network_confirmed_via_l3_hairpinning(self, mock_l3, mock_mcast, mock_self, mock_net, mock_gw):
        """Uji kondisi terkonfirmasi 100% via L3 Hairpinning pada kandidat DHCP/History."""
        discovered = {
            '192.168.1.1': '00:11:22:33:44:55',
            '192.168.1.100': 'a8:3b:76:0c:dc:55'
        }
        candidates = {
            '192.168.1.55': 'de:ad:be:ef:00:55'
        }
        res = detect_ap_isolation(discovered, candidates=candidates)
        self.assertTrue(res['is_isolated'])
        self.assertEqual(res['percentage'], 100)
        self.assertEqual(res['confidence'], 1.0)
        self.assertEqual(res['status'], 'confirmed')
        self.assertTrue(res['indicators']['l3_hairpinning_confirmed'])

    @patch('src.core.discovery.ap_isolation.get_current_gateway', return_value='')
    def test_gateway_unresponsive(self, mock_gw):
        """Uji saat gateway tidak merespons."""
        res = detect_ap_isolation({})
        self.assertFalse(res['is_isolated'])
        self.assertEqual(res['confidence'], 0.0)

if __name__ == '__main__':
    unittest.main()
