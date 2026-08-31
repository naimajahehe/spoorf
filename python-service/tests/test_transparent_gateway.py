#!/usr/bin/env python3
"""
Unit & Integration Tests for Transparent Gateway Module
=========================================================
Menguji:
1. Sinkhole domain matching & filtering.
2. Invariant protections (RFC 1918, Anti-Self Cut, Gateway Immunity).
3. Lifecycle start, status reporting, and safe teardown.
4. Log ring-buffer manipulation (add, query, clear).
"""

import unittest
from unittest.mock import MagicMock, patch

from src.core.redirector.transparent_gateway import TransparentGatewayManager, GatewayDNSSniffer
from src.exceptions.custom import SpoofError


class TestTransparentGateway(unittest.TestCase):
    def setUp(self):
        self.mock_spoofer = MagicMock()
        self.mock_spoofer._self_mac = "a8:3b:76:0c:dc:55"
        self.mock_spoofer._interface = "mock_iface"
        self.mock_spoofer._win_interface_name = "Wi-Fi"
        self.mock_spoofer.start.return_value = "arp_sess_test_123"

        self.gateway_mgr = TransparentGatewayManager(self.mock_spoofer)

    def test_sinkhole_domain_matching(self):
        """Uji apakah domain sinkhole cocok dengan domain langsung maupun subdomain."""
        sinkhole_set = {"doubleclick.net", "tiktok.com", "analytics.google.com"}
        sniffer = GatewayDNSSniffer(
            target_ip="192.168.1.50",
            target_mac="aa:bb:cc:dd:ee:50",
            gateway_ip="192.168.1.1",
            controller_ip="192.168.1.100",
            interface="mock_iface",
            self_mac="a8:3b:76:0c:dc:55",
            sinkhole_domains=sinkhole_set
        )

        # Blocked / Sinkholed
        self.assertTrue(sniffer.is_sinkholed("doubleclick.net"))
        self.assertTrue(sniffer.is_sinkholed("ad.doubleclick.net"))
        self.assertTrue(sniffer.is_sinkholed("tiktok.com"))
        self.assertTrue(sniffer.is_sinkholed("v16.tiktok.com"))
        self.assertTrue(sniffer.is_sinkholed("analytics.google.com"))

        # Allowed
        self.assertFalse(sniffer.is_sinkholed("google.com"))
        self.assertFalse(sniffer.is_sinkholed("wikipedia.org"))
        self.assertFalse(sniffer.is_sinkholed("youtube.com"))

    @patch("src.core.redirector.transparent_gateway.get_network_info")
    @patch("src.core.redirector.transparent_gateway.set_ip_forwarding")
    def test_start_gateway_lifecycle_happy_path(self, mock_fwd, mock_net_info):
        """Happy path: Memulai sesi transparent gateway berhasil."""
        mock_net_info.return_value = {
            "ip": "192.168.1.100",
            "gateway": "192.168.1.1",
            "interface": "Wi-Fi"
        }

        with patch.object(GatewayDNSSniffer, "start") as mock_sniff_start:
            res = self.gateway_mgr.start_gateway(
                victim_ip="192.168.1.55",
                victim_mac="aa:bb:cc:11:22:33",
                gateway_ip="192.168.1.1",
                gateway_mac="00:11:22:33:44:55"
            )

            self.assertEqual(res["victim_ip"], "192.168.1.55")
            self.assertEqual(res["arp_session_id"], "arp_sess_test_123")
            self.mock_spoofer.start.assert_called_once_with(
                victim_ip="192.168.1.55",
                victim_mac="aa:bb:cc:11:22:33",
                gateway_ip="192.168.1.1",
                gateway_mac="00:11:22:33:44:55",
                speed_limit=100,
                is_redirect=True
            )
            mock_fwd.assert_called_once_with(True, "Wi-Fi")
            mock_sniff_start.assert_called_once()

            status = self.gateway_mgr.get_status()
            self.assertEqual(status["active_count"], 1)
            self.assertIn("192.168.1.55", status["active_sessions"])

            # Stop gateway
            stopped = self.gateway_mgr.stop_gateway("192.168.1.55")
            self.assertTrue(stopped)
            self.mock_spoofer.stop.assert_called_once_with("arp_sess_test_123")

    @patch("src.core.redirector.transparent_gateway.get_network_info")
    def test_invariant_anti_self_cut_negative(self, mock_net_info):
        """Invariant: Komputer pengawas dilarang menjadi target."""
        mock_net_info.return_value = {
            "ip": "192.168.1.100",
            "gateway": "192.168.1.1",
            "interface": "Wi-Fi"
        }

        with self.assertRaises(SpoofError):
            self.gateway_mgr.start_gateway(
                victim_ip="192.168.1.100",  # Controller itself!
                victim_mac="a8:3b:76:0c:dc:55",
                gateway_ip="192.168.1.1",
                gateway_mac="00:11:22:33:44:55"
            )

    @patch("src.core.redirector.transparent_gateway.get_network_info")
    def test_invariant_gateway_immunity_negative(self, mock_net_info):
        """Invariant: Gateway router dilarang menjadi target."""
        mock_net_info.return_value = {
            "ip": "192.168.1.100",
            "gateway": "192.168.1.1",
            "interface": "Wi-Fi"
        }

        with self.assertRaises(SpoofError):
            self.gateway_mgr.start_gateway(
                victim_ip="192.168.1.1",  # Gateway itself!
                victim_mac="00:11:22:33:44:55",
                gateway_ip="192.168.1.1",
                gateway_mac="00:11:22:33:44:55"
            )

    def test_sinkhole_and_logs_manipulation(self):
        """Uji manipulasi sinkhole domain dan log DNS buffer."""
        # Add sinkhole
        self.assertTrue(self.gateway_mgr.add_sinkhole_domain("customblock.com"))
        domains = self.gateway_mgr.get_sinkhole_domains()
        self.assertIn("customblock.com", domains)

        # Remove sinkhole
        self.assertTrue(self.gateway_mgr.remove_sinkhole_domain("customblock.com"))
        self.assertNotIn("customblock.com", self.gateway_mgr.get_sinkhole_domains())

        # DNS query logs
        self.gateway_mgr._on_dns_query({
            "timestamp": 1234567890,
            "target_ip": "192.168.1.55",
            "domain": "example.com",
            "qtype": "A",
            "status": "allowed"
        })

        logs = self.gateway_mgr.get_dns_logs()
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["domain"], "example.com")

        self.gateway_mgr.clear_dns_logs()
        self.assertEqual(len(self.gateway_mgr.get_dns_logs()), 0)


if __name__ == "__main__":
    unittest.main()
