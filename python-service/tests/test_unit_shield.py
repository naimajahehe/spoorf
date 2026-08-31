import unittest
from unittest.mock import patch, MagicMock
from src.core.shield import SentinelShield

class TestSentinelShield(unittest.TestCase):
    def setUp(self):
        self.shield = SentinelShield()

    def tearDown(self):
        self.shield.disable()

    @patch('src.core.shield.get_network_info')
    @patch('src.core.shield.get_current_gateway')
    @patch('src.core.shield.SentinelShield._resolve_gateway_mac')
    @patch('src.core.shield.SentinelShield._lock_kernel_neighbor')
    def test_enable_and_status(self, mock_lock, mock_resolve_mac, mock_gw, mock_info):
        mock_info.return_value = {'ip': '192.168.110.99', 'interface': 'Wi-Fi'}
        mock_gw.return_value = '192.168.110.1'
        mock_resolve_mac.return_value = '98:4a:6b:0f:4a:97'
        mock_lock.return_value = True

        res = self.shield.enable(mode='host_lock', auto_retaliate=False)
        self.assertTrue(res['is_enabled'])
        self.assertEqual(res['mode'], 'host_lock')
        self.assertEqual(res['gateway_ip'], '192.168.110.1')
        self.assertEqual(res['gateway_mac'], '98:4a:6b:0f:4a:97')

        status = self.shield.get_status()
        self.assertTrue(status['is_enabled'])
        self.assertEqual(status['mode'], 'host_lock')

    @patch('src.core.shield.SentinelShield._unlock_kernel_neighbor')
    def test_disable(self, mock_unlock):
        self.shield._is_enabled = True
        self.shield._gateway_ip = '192.168.110.1'
        res = self.shield.disable()
        self.assertFalse(res['is_enabled'])
        self.assertIsNone(res['locked_at'])

    def test_threat_recording_and_clearing(self):
        self.shield._threats.append({
            'id': 'threat_1',
            'attacker_ip': '192.168.110.55',
            'attacker_mac': 'aa:bb:cc:dd:ee:ff',
            'target_ip': '192.168.110.99',
            'claimed_ip': '192.168.110.1',
            'type': 'gateway_arp_spoof'
        })
        self.assertEqual(len(self.shield.get_threats()), 1)
        self.shield.clear_threats()
        self.assertEqual(len(self.shield.get_threats()), 0)

    def test_set_mode(self):
        res = self.shield.set_mode('lan_healing', auto_retaliate=True)
        self.assertEqual(res['mode'], 'lan_healing')
        self.assertTrue(res['auto_retaliate'])

if __name__ == '__main__':
    unittest.main()
