"""
Unit Tests for IPv6 Neighbor Discovery Protocol (NDP) & Multicast Sensor
========================================================================
Covers: Validation, Categorization, NDP Cache Parsing, and Scanner Enrichment.
"""

import unittest
from unittest.mock import patch, MagicMock
from scapy.all import IPv6, ICMPv6ND_NA
from src.core.discovery.ipv6_ndp import (
    is_valid_ipv6,
    categorize_ipv6,
    collect_from_ndp_cache,
    send_ipv6_all_nodes_multicast,
    verify_ipv6_alive
)
from src.core.scanner import NetworkScanner

class TestIPv6Discovery(unittest.TestCase):

    # ===== Active liveness verification (anti stale-NDP false online) =====
    @patch('src.core.discovery.ipv6_ndp.srp')
    def test_verify_ipv6_alive_no_reply_is_false(self, mock_srp):
        """Tidak ada Neighbor Advertisement balasan -> perangkat dianggap MATI (False)."""
        mock_srp.return_value = ([], None)
        self.assertFalse(verify_ipv6_alive("aa:bb:cc:dd:ee:ff", "fe80::1", "11:22:33:44:55:66"))
        self.assertTrue(mock_srp.called)

    @patch('src.core.discovery.ipv6_ndp.srp')
    def test_verify_ipv6_alive_with_na_reply_is_true(self, mock_srp):
        """Ada balasan ber-layer ICMPv6ND_NA -> perangkat HIDUP (True)."""
        reply = IPv6(src="fe80::1") / ICMPv6ND_NA()
        mock_srp.return_value = ([(MagicMock(), reply)], None)
        self.assertTrue(verify_ipv6_alive("aa:bb:cc:dd:ee:ff", "fe80::1", "11:22:33:44:55:66"))

    @patch('src.core.discovery.ipv6_ndp.srp')
    def test_verify_ipv6_alive_invalid_input_no_probe(self, mock_srp):
        """Input MAC/alamat tidak valid -> False tanpa mengirim paket sama sekali."""
        self.assertFalse(verify_ipv6_alive("bad-mac", "fe80::1", ""))
        self.assertFalse(verify_ipv6_alive("aa:bb:cc:dd:ee:ff", "::1", ""))       # loopback
        self.assertFalse(verify_ipv6_alive("aa:bb:cc:dd:ee:ff", "192.168.1.1", "")) # bukan IPv6
        self.assertFalse(mock_srp.called)

    def test_is_valid_ipv6_happy_path(self):
        """Happy Path: Standard Link-Local and Global IPv6 addresses."""
        self.assertTrue(is_valid_ipv6("fe80::1"))
        self.assertTrue(is_valid_ipv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334"))
        self.assertTrue(is_valid_ipv6("2404:8000:1024:3ab::45e1"))

    def test_is_valid_ipv6_with_scope_id(self):
        """Scope ID Suffix: Windows & Linux zone indexes must be handled cleanly."""
        self.assertTrue(is_valid_ipv6("fe80::1%14"))
        self.assertTrue(is_valid_ipv6("fe80::4e14:adff:fe14:ad87%Wi-Fi"))

    def test_is_valid_ipv6_negative(self):
        """Negative Tests: Loopback, unspecified, IPv4, and invalid strings must return False."""
        self.assertFalse(is_valid_ipv6("::1")) # Loopback
        self.assertFalse(is_valid_ipv6("::")) # Unspecified
        self.assertFalse(is_valid_ipv6("192.168.1.1")) # IPv4
        self.assertFalse(is_valid_ipv6("not-an-ip"))
        self.assertFalse(is_valid_ipv6(None))
        self.assertFalse(is_valid_ipv6(""))

    def test_categorize_ipv6(self):
        """Categorization: Correctly distinguish link-local vs global vs ULA."""
        self.assertEqual(categorize_ipv6("fe80::4e14:adff:fe14:ad87"), "link_local")
        self.assertEqual(categorize_ipv6("fe80::1%12"), "link_local")
        self.assertEqual(categorize_ipv6("2001:db8::1"), "global")
        self.assertEqual(categorize_ipv6("2404:6800:4003:c02::64"), "global")
        self.assertEqual(categorize_ipv6("fd00::1234"), "ula")
        self.assertEqual(categorize_ipv6("ff02::1"), "multicast")

    @patch('subprocess.run')
    def test_collect_from_ndp_cache_windows(self, mock_run):
        """Mocked netsh output on Windows must correctly populate MAC-to-IPv6 mapping."""
        mock_output = """
Interface 14: Wi-Fi

Internet Address                              Physical Address   Type
--------------------------------------------  -----------------  -----------
fe80::4e14:adff:fe14:ad87%14                  4e-e1-14-14-ad-87  Reachable
2404:8000:1024:3ab::45e1                      4e-e1-14-14-ad-87  Permanent
        """
        mock_run.return_value = MagicMock(returncode=0, stdout=mock_output)

        discovered: dict = {}
        with patch('sys.platform', 'win32'):
            collect_from_ndp_cache(discovered)

        norm_mac = "4e:e1:14:14:ad:87"
        self.assertIn(norm_mac, discovered)
        self.assertEqual(discovered[norm_mac]['link_local'], "fe80::4e14:adff:fe14:ad87")
        self.assertEqual(discovered[norm_mac]['global'], "2404:8000:1024:3ab::45e1")
        self.assertEqual(len(discovered[norm_mac]['addresses']), 2)

    @patch('subprocess.run')
    def test_collect_from_ndp_cache_windows_nonzero_is_strict_only(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=5,
            stdout="",
            stderr="Access\r\n denied\x00" + ("!" * 400),
        )

        with patch('sys.platform', 'win32'):
            discovered = {}
            collect_from_ndp_cache(discovered)
            self.assertEqual(discovered, {})

            with self.assertRaises(OSError) as raised:
                collect_from_ndp_cache({}, strict=True)

        message = str(raised.exception)
        self.assertIn("netsh", message)
        self.assertIn("exit code 5", message)
        self.assertIn("Access denied", message)
        self.assertNotIn("\r", message)
        self.assertNotIn("\n", message)
        self.assertNotIn("\x00", message)
        self.assertLessEqual(len(message), 200)

    @patch('subprocess.run')
    def test_collect_from_ndp_cache_unix_nonzero_is_strict_only(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=2,
            stdout="",
            stderr="Permission\tdenied\x00" + ("!" * 400),
        )

        with patch('sys.platform', 'linux'):
            discovered = {}
            collect_from_ndp_cache(discovered)
            self.assertEqual(discovered, {})

            with self.assertRaises(OSError) as raised:
                collect_from_ndp_cache({}, strict=True)

        message = str(raised.exception)
        self.assertIn("ip -6 neigh show", message)
        self.assertIn("exit code 2", message)
        self.assertIn("Permission denied", message)
        self.assertNotIn("\t", message)
        self.assertNotIn("\x00", message)
        self.assertLessEqual(len(message), 200)

    def test_scanner_build_device_dual_stack(self):
        """Scanner enrichment must attach IPv6 properties and flag is_dual_stack."""
        ipv6_snapshot = {
            "4e:e1:14:14:ad:87": {
                "mac": "4e:e1:14:14:ad:87",
                "link_local": "fe80::4e14:adff:fe14:ad87",
                "global": "2404:8000:1024:3ab::45e1",
                "addresses": ["fe80::4e14:adff:fe14:ad87", "2404:8000:1024:3ab::45e1"]
            }
        }

        dev = NetworkScanner._build_device(
            ip="172.18.138.139",
            mac="4e:e1:14:14:ad:87",
            gateway_ip="172.18.138.103",
            is_active_layer2=True,
            ipv6_snapshot=ipv6_snapshot
        )

        self.assertIsNotNone(dev)
        self.assertEqual(dev['ipv6_link_local'], "fe80::4e14:adff:fe14:ad87")
        self.assertEqual(dev['ipv6_global'], "2404:8000:1024:3ab::45e1")
        self.assertTrue(dev['is_dual_stack'])
        self.assertEqual(len(dev['ipv6_addresses']), 2)

if __name__ == '__main__':
    unittest.main()
