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

    @patch('src.core.discovery.liveness.subprocess.run')
    @patch('src.core.discovery.liveness.srp')
    def test_pulse_host_ipv6_vector_uses_correct_arg_order(self, mock_srp, mock_run):
        """BUG-1: vektor IPv6 harus memanggil verify_ipv6_alive(mac, ipv6_addr) sesuai
        signature-nya. Bila argumen tertukar, neighbor IPv6 yang hidup tak pernah terdeteksi.
        ARP & ICMP dimatikan agar HANYA vektor IPv6 yang bisa memenangkan race."""
        mock_srp.return_value = ([], [])                       # ARP: tak ada balasan
        mock_run.return_value = MagicMock(stdout='', returncode=1)  # ICMP ping: gagal

        target_mac = 'aa:bb:cc:dd:ee:11'
        target_v6 = 'fe80::aaaa'

        def fake_verify(mac, ipv6_addr, *args, **kwargs):
            # Neighbor IPv6 nyata HANYA menjawab bila di-probe dengan MAC & IPv6
            # pada slot yang benar-benar diharapkan verify_ipv6_alive.
            return mac == target_mac and ipv6_addr == target_v6

        with patch('src.core.discovery.liveness.verify_ipv6_alive', side_effect=fake_verify):
            res = pulse_host('192.168.1.88', target_mac, gateway_ip='192.168.1.1',
                             target_ipv6=target_v6, timeout=0.25)

        self.assertTrue(res['is_alive'], "Neighbor IPv6 hidup gagal terdeteksi (argumen tertukar?)")
        self.assertEqual(res['vector'], 'ipv6_ndp')

    @patch('src.core.discovery.liveness.subprocess.run')
    @patch('src.core.discovery.liveness.srp')
    def test_pulse_host_ping_probe_has_subprocess_timeout(self, mock_srp, mock_run):
        """BUG-12: subprocess ping WAJIB diberi timeout agar proses tak menggantung
        selamanya (menahan slot worker) saat stack TCP/IP Windows macet."""
        mock_srp.return_value = ([], [])
        mock_run.return_value = MagicMock(stdout='', returncode=1)

        pulse_host('192.168.1.77', 'aa:bb:cc:dd:ee:77', timeout=0.25)

        self.assertTrue(mock_run.called, "vektor ICMP ping harus memanggil subprocess.run")
        _, kwargs = mock_run.call_args
        self.assertIn('timeout', kwargs, "subprocess.run(ping) harus menyertakan timeout")
        self.assertGreater(kwargs['timeout'], 0)

    @patch('src.core.discovery.liveness.pulse_host')
    def test_pulse_batch_preserves_mac_on_failure(self, mock_pulse_host):
        """BUG-9: bila sebuah probe gagal/timeout, hasil batch harus TETAP membawa MAC
        target (bukan ''), agar Node tidak membuang event offline yang dijaga oleh MAC."""
        def boom(ip, mac, *args, **kwargs):
            raise RuntimeError("probe blew up")
        mock_pulse_host.side_effect = boom

        targets = [{'ip': '192.168.1.150', 'mac': '00:11:22:33:44:55'}]
        results = pulse_batch(targets, timeout=0.2)

        self.assertIn('192.168.1.150', results)
        self.assertFalse(results['192.168.1.150']['is_alive'])
        self.assertEqual(results['192.168.1.150']['mac'], '00:11:22:33:44:55',
                         "MAC target harus dipertahankan pada hasil gagal/timeout")

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
