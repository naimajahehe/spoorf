"""
Unit Tests for Core Network Subsystem (src.core.network)
Covers: Happy Path, Negative Tests, and Edge Cases
"""

import unittest
from unittest.mock import patch
from src.core.network import (
    is_valid_private_ip,
    is_valid_private_network,
    is_valid_mac,
    get_self_mac,
    get_current_gateway,
    get_network_info,
    get_wifi_info,
    has_ipv6_connectivity,
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

    def test_private_network_validator_rejects_public_cidr(self):
        self.assertFalse(is_valid_private_network("203.0.113.0/24"))
        self.assertTrue(is_valid_private_network("192.168.1.0/24"))

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
        iface = type('Iface', (), {'ips': ['192.168.1.20'], 'mac': '00:11:22:33:44:55'})()
        with patch(
            'src.core.network.get_network_info',
            return_value={'ip': '192.168.1.20'}
        ), patch.dict('src.core.network.ifaces', {'mock': iface}, clear=True):
            mac = get_self_mac()
        self.assertIsInstance(mac, str)
        self.assertTrue(is_valid_mac(mac))

    def test_get_current_gateway_structure(self):
        """Verify get_current_gateway returns non-empty string."""
        with patch(
            'src.core.network.netifaces.gateways',
            return_value={'default': {2: ('192.168.1.1', 'Ethernet')}}
        ):
            gw = get_current_gateway()
        self.assertIsInstance(gw, str)
        self.assertGreater(len(gw), 6)

    def test_get_current_gateway_rejects_public_default(self):
        with patch(
            'src.core.network.netifaces.gateways',
            return_value={'default': {2: ('203.0.113.1', 'Ethernet')}}
        ), patch('src.core.network.sys.platform', 'linux'):
            self.assertEqual(get_current_gateway(), '')

    def test_get_network_info_structure(self):
        """Verify get_network_info returns required dictionary keys."""
        with patch('src.core.network.get_active_ip', return_value='192.168.1.20'), \
             patch('src.core.network.get_current_gateway', return_value='192.168.1.1'), \
             patch('src.core.network.netifaces.interfaces', return_value=['Ethernet']), \
             patch(
                 'src.core.network.netifaces.ifaddresses',
                 return_value={2: [{'addr': '192.168.1.20', 'netmask': '255.255.255.0'}]}
             ):
            info = get_network_info()
        self.assertIsInstance(info, dict)
        for key in ['ip', 'netmask', 'network', 'gateway', 'interface']:
            self.assertIn(key, info)
            self.assertIsInstance(info[key], str)

    def test_get_network_info_rejects_public_default_interface(self):
        with patch('src.core.network.get_active_ip', return_value='203.0.113.10'), \
             patch('src.core.network.get_current_gateway', return_value='203.0.113.1'), \
             patch('src.core.network.netifaces.interfaces', return_value=['Ethernet']), \
             patch(
                 'src.core.network.netifaces.ifaddresses',
                 return_value={2: [{'addr': '203.0.113.10', 'netmask': '255.255.255.0'}]}
             ), patch(
                 'src.core.network.netifaces.gateways',
                 return_value={'default': {2: ('203.0.113.1', 'Ethernet')}}
             ):
            info = get_network_info()

        self.assertEqual(info, {
            'ip': '',
            'netmask': '',
            'network': '',
            'gateway': '',
            'interface': ''
        })

    def test_get_network_info_rejects_missing_netmask(self):
        with patch('src.core.network.get_active_ip', return_value='192.168.1.20'), \
             patch('src.core.network.get_current_gateway', return_value='192.168.1.1'), \
             patch('src.core.network.netifaces.interfaces', return_value=['Ethernet']), \
             patch(
                 'src.core.network.netifaces.ifaddresses',
                 return_value={2: [{'addr': '192.168.1.20'}]}
             ), patch('src.core.network.netifaces.gateways', return_value={}):
            info = get_network_info()

        self.assertEqual(info['network'], '')
        self.assertEqual(info['netmask'], '')

    def test_get_wifi_info_structure(self):
        """Verify get_wifi_info returns standardized keys."""
        with patch('src.core.network.sys.platform', 'linux'):
            wifi = get_wifi_info()
        self.assertIsInstance(wifi, dict)
        self.assertIn('connected', wifi)
        self.assertIsInstance(wifi['connected'], bool)
        self.assertIn('ssid', wifi)

    # ===== 4. is_network_changed =====
    def test_network_changed_logic(self):
        """Verify network change detection logic."""
        curr_gw = '192.168.1.1'
        curr_iface = 'Ethernet'
        with patch('src.core.network.get_current_gateway', return_value=curr_gw), \
             patch('src.core.network.get_network_info', return_value={'interface': curr_iface}):
            self.assertFalse(is_network_changed(curr_gw, curr_iface))
            self.assertTrue(is_network_changed("10.99.99.99", curr_iface))
            self.assertTrue(is_network_changed(curr_gw, "Virtual-Adapter-XYZ"))

    # ===== IPv6 capability detection (local, no packets) =====
    def _fake_addr(self, family, address):
        class _A:
            pass
        a = _A()
        a.family = family
        a.address = address
        return a

    def test_has_ipv6_true_when_global_address_present(self):
        import socket as _s
        addrs = {
            'Wi-Fi': [
                self._fake_addr(_s.AF_INET, '192.168.1.10'),
                self._fake_addr(_s.AF_INET6, 'fe80::1%14'),          # link-local → tak dihitung
                self._fake_addr(_s.AF_INET6, '2404:8000:1024::45e1'), # global → dihitung
            ]
        }
        with patch('psutil.net_if_addrs', return_value=addrs):
            self.assertTrue(has_ipv6_connectivity())

    def test_has_ipv6_false_when_only_link_local(self):
        import socket as _s
        addrs = {
            'Wi-Fi': [
                self._fake_addr(_s.AF_INET, '192.168.110.5'),
                self._fake_addr(_s.AF_INET6, 'fe80::770f:1975:aee2:cec%14'),  # hanya link-local
            ]
        }
        with patch('psutil.net_if_addrs', return_value=addrs):
            self.assertFalse(has_ipv6_connectivity())

    def test_has_ipv6_false_when_no_ipv6(self):
        import socket as _s
        addrs = {'Wi-Fi': [self._fake_addr(_s.AF_INET, '10.80.45.139')]}
        with patch('psutil.net_if_addrs', return_value=addrs):
            self.assertFalse(has_ipv6_connectivity())


if __name__ == '__main__':
    unittest.main()
