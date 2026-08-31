"""
Unit Tests for Core Network Subsystem (src.core.network)
Covers: Happy Path, Negative Tests, and Edge Cases
"""

import unittest
from src.core.network import (
    is_valid_private_ip,
    is_valid_mac,
    get_self_mac,
    get_current_gateway,
    get_network_info,
    get_wifi_info,
    is_network_changed
)

class TestCoreNetwork(unittest.TestCase):

    # ===== 1. is_valid_private_ip =====
    def test_valid_private_ip_happy_path(self):
        """Happy Path: Standard RFC 1918 Private IPv4 Addresses."""
        self.assertTrue(is_valid_private_ip("192.168.1.1"))
        self.assertTrue(is_valid_private_ip("192.168.100.254"))
        self.assertTrue(is_valid_private_ip("10.0.0.1"))
        self.assertTrue(is_valid_private_ip("10.255.255.254"))
        self.assertTrue(is_valid_private_ip("172.16.0.1"))
        self.assertTrue(is_valid_private_ip("172.31.255.254"))

    def test_valid_private_ip_negative(self):
        """Negative Tests: Public, Loopback, Multicast, Link-Local, and Malformed IPs."""
        self.assertFalse(is_valid_private_ip("8.8.8.8"))        # Public Google DNS
        self.assertFalse(is_valid_private_ip("1.1.1.1"))        # Public Cloudflare DNS
        self.assertFalse(is_valid_private_ip("127.0.0.1"))      # Loopback
        self.assertFalse(is_valid_private_ip("169.254.1.10"))   # APIPA / Link-local
        self.assertFalse(is_valid_private_ip("224.0.0.1"))      # Multicast
        self.assertFalse(is_valid_private_ip("not-an-ip"))      # Invalid string
        self.assertFalse(is_valid_private_ip("999.999.999.999"))# Out of range

    def test_valid_private_ip_edge_cases(self):
        """Edge Cases: Empty, None, Boundary IPs, Extreme Lengths, Whitespace."""
        self.assertFalse(is_valid_private_ip(""))
        self.assertFalse(is_valid_private_ip(None))
        self.assertFalse(is_valid_private_ip("0.0.0.0"))
        self.assertFalse(is_valid_private_ip("255.255.255.255"))
        self.assertFalse(is_valid_private_ip(" " * 50))
        self.assertFalse(is_valid_private_ip("192.168.1.1" + "a" * 1000))
        # Whitespace trimmed should be recognized correctly
        self.assertTrue(is_valid_private_ip("  192.168.1.1  "))

    # ===== 2. is_valid_mac =====
    def test_valid_mac_happy_path(self):
        """Happy Path: Standard 6-octet MAC addresses with colons and hyphens."""
        self.assertTrue(is_valid_mac("aa:bb:cc:dd:ee:ff"))
        self.assertTrue(is_valid_mac("AA:BB:CC:DD:EE:FF"))
        self.assertTrue(is_valid_mac("00:11:22:33:44:55"))
        self.assertTrue(is_valid_mac("00-11-22-33-44-55"))
        self.assertTrue(is_valid_mac("a8:3b:76:0c:dc:55"))

    def test_valid_mac_negative(self):
        """Negative Tests: Incorrect lengths, non-hex characters, invalid formats."""
        self.assertFalse(is_valid_mac("00:11:22:33:44"))       # 5 octets
        self.assertFalse(is_valid_mac("00:11:22:33:44:55:66")) # 7 octets
        self.assertFalse(is_valid_mac("gg:hh:ii:jj:kk:ll"))    # Non-hex characters
        self.assertFalse(is_valid_mac("not-a-mac-address"))
        self.assertFalse(is_valid_mac("192.168.1.1"))

    def test_valid_mac_edge_cases(self):
        """Edge Cases: Empty string, None, Extreme Length, Whitespace."""
        self.assertFalse(is_valid_mac(""))
        self.assertFalse(is_valid_mac(None))
        self.assertFalse(is_valid_mac(" " * 20))
        self.assertFalse(is_valid_mac("00:11:22:33:44:55" * 10))
        self.assertTrue(is_valid_mac("  00:11:22:33:44:55  "))

    # ===== 3. Interface & Gateway Discovery =====
    def test_get_self_mac_structure(self):
        """Verify get_self_mac returns valid MAC structure."""
        mac = get_self_mac()
        self.assertIsInstance(mac, str)
        self.assertTrue(is_valid_mac(mac))

    def test_get_current_gateway_structure(self):
        """Verify get_current_gateway returns non-empty string."""
        gw = get_current_gateway()
        self.assertIsInstance(gw, str)
        self.assertGreater(len(gw), 6)

    def test_get_network_info_structure(self):
        """Verify get_network_info returns required dictionary keys."""
        info = get_network_info()
        self.assertIsInstance(info, dict)
        for key in ['ip', 'netmask', 'network', 'gateway', 'interface']:
            self.assertIn(key, info)
            self.assertIsInstance(info[key], str)

    def test_get_wifi_info_structure(self):
        """Verify get_wifi_info returns standardized keys."""
        wifi = get_wifi_info()
        self.assertIsInstance(wifi, dict)
        self.assertIn('connected', wifi)
        self.assertIsInstance(wifi['connected'], bool)
        self.assertIn('ssid', wifi)

    # ===== 4. is_network_changed =====
    def test_network_changed_logic(self):
        """Verify network change detection logic."""
        curr_gw = get_current_gateway()
        info = get_network_info()
        curr_iface = info.get('interface', '')
        
        # When comparing to current values, should not be changed
        self.assertFalse(is_network_changed(curr_gw, curr_iface))
        
        # When comparing to different values, should detect change
        self.assertTrue(is_network_changed("10.99.99.99", curr_iface))
        self.assertTrue(is_network_changed(curr_gw, "Virtual-Adapter-XYZ"))

if __name__ == '__main__':
    unittest.main()
