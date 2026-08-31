"""
Unit Tests: Multi-Vector Asynchronous Unicast Liveness Pulse Engine (< 0.75s)
"""

import unittest
from unittest.mock import patch, MagicMock
import time

from src.core.discovery.liveness import pulse_host, pulse_batch, LivenessWatchdogDaemon
from scapy.all import Ether, ARP

class TestUnitLiveness(unittest.TestCase):

    def test_pulse_host_invalid_inputs(self):
        """Uji bahwa input IP/MAC tidak valid langsung ditolak secara aman."""
        res1 = pulse_host("0.0.0.0", "aa:bb:cc:dd:ee:ff")
        self.assertFalse(res1['is_alive'])
        self.assertEqual(res1['vector'], 'none')

        res2 = pulse_host("192.168.1.50", "invalid-mac")
        self.assertFalse(res2['is_alive'])

        res3 = pulse_host("8.8.8.8", "aa:bb:cc:dd:ee:ff") # Non-RFC1918
        self.assertFalse(res3['is_alive'])

    @patch('src.core.discovery.liveness.srp')
    @patch('src.core.discovery.liveness.get_self_mac', return_value='a8:3b:76:0c:dc:55')
    def test_pulse_host_unicast_arp_success(self, mock_self_mac, mock_srp):
        """Uji deteksi instan saat target membalas Unicast ARP."""
        # Mocking Scapy ARP Reply
        mock_reply = Ether(src="aa:bb:cc:dd:ee:11", dst="a8:3b:76:0c:dc:55") / ARP(
            op=2,
            hwsrc="aa:bb:cc:dd:ee:11",
            psrc="192.168.1.88"
        )
        mock_srp.return_value = ([(None, mock_reply)], [])

        res = pulse_host("192.168.1.88", "aa:bb:cc:dd:ee:11", gateway_ip="192.168.1.1", timeout=0.25)
        self.assertTrue(res['is_alive'])
        self.assertEqual(res['vector'], 'unicast_arp')
        self.assertGreater(res['rtt_ms'], 0)
        self.assertEqual(res['ip'], '192.168.1.88')
        self.assertEqual(res['mac'], 'aa:bb:cc:dd:ee:11')

    @patch('src.core.discovery.liveness.srp')
    def test_pulse_host_offline_timeout(self, mock_srp):
        """Uji saat target offline / tidak membalas seluruh vektor probe."""
        mock_srp.return_value = ([], []) # No reply

        res = pulse_host("192.168.1.99", "aa:bb:cc:dd:ee:99", gateway_ip="192.168.1.1", timeout=0.1, retry=False)
        self.assertFalse(res['is_alive'])
        self.assertEqual(res['vector'], 'none')

    @patch('src.core.discovery.liveness.pulse_host')
    def test_pulse_batch_concurrency(self, mock_pulse_host):
        """Uji batch pulse mengeksekusi banyak host secara paralel."""
        mock_pulse_host.side_effect = lambda ip, mac, *args, **kwargs: {
            'ip': ip,
            'mac': mac,
            'is_alive': True if ip.endswith('1') else False,
            'vector': 'unicast_arp' if ip.endswith('1') else 'none',
            'rtt_ms': 1.5,
            'timestamp': time.time()
        }

        targets = [
            {'ip': '192.168.1.101', 'mac': '00:11:22:33:44:01'},
            {'ip': '192.168.1.102', 'mac': '00:11:22:33:44:02'},
            {'ip': '192.168.1.103', 'mac': '00:11:22:33:44:03'}
        ]

        results = pulse_batch(targets, gateway_ip='192.168.1.1', max_workers=5, timeout=0.5)
        self.assertEqual(len(results), 3)
        self.assertTrue(results['192.168.1.101']['is_alive'])
        self.assertFalse(results['192.168.1.102']['is_alive'])

    def test_liveness_daemon_lifecycle(self):
        """Uji lifecycle daemon latar belakang (start, update, stop)."""
        events = []
        daemon = LivenessWatchdogDaemon(event_callback=lambda evt: events.append(evt))

        devices = [
            {'ip': '192.168.1.50', 'mac': 'aa:bb:cc:dd:ee:50', 'is_blocked': True, 'is_online': True},
            {'ip': '192.168.1.1', 'mac': 'aa:bb:cc:dd:ee:01', 'is_gateway': True}, # must be skipped
            {'ip': '192.168.1.2', 'mac': 'aa:bb:cc:dd:ee:02', 'is_self': True} # must be skipped
        ]

        daemon.update_tracked_devices(devices)
        self.assertIn('192.168.1.50', daemon._devices)
        self.assertNotIn('192.168.1.1', daemon._devices)
        self.assertNotIn('192.168.1.2', daemon._devices)

        daemon.start()
        self.assertTrue(daemon._running)
        time.sleep(0.6)
        daemon.stop()
        self.assertFalse(daemon._running)

if __name__ == '__main__':
    unittest.main()
