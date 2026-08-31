#!/usr/bin/env python3
"""
Unit & Integration Tests for Redirector Module
==============================================
Menguji:
1. Whitelist filter Instagram Walled Garden pada DNSSpoofer.
2. Captive Portal HTTP Server (HTTP 302 & Probe endpoints).
3. Invariant Protections pada RedirectManager (Anti-Self, Gateway Immunity, RFC 1918).
"""

import unittest
import urllib.request
import time
from unittest.mock import MagicMock, patch

from src.core.redirector.dns_spoofer import DNSSpoofer
from src.core.redirector.portal_server import CaptivePortalServer
from src.core.redirector.manager import RedirectManager
from src.exceptions.custom import SpoofError

class TestRedirector(unittest.TestCase):
    def test_dns_whitelist_matching(self):
        """Uji apakah domain Instagram di-whitelist dan domain lain di-spoof."""
        # Whitelisted domains
        self.assertTrue(DNSSpoofer.is_whitelisted("instagram.com"))
        self.assertTrue(DNSSpoofer.is_whitelisted("www.instagram.com"))
        self.assertTrue(DNSSpoofer.is_whitelisted("scontent.cdninstagram.com"))
        self.assertTrue(DNSSpoofer.is_whitelisted("ig.me"))
        self.assertTrue(DNSSpoofer.is_whitelisted("static.xx.fbcdn.net"))

        # Non-whitelisted domains (harus di-spoof ke controller)
        self.assertFalse(DNSSpoofer.is_whitelisted("google.com"))
        self.assertFalse(DNSSpoofer.is_whitelisted("connectivitycheck.gstatic.com"))
        self.assertFalse(DNSSpoofer.is_whitelisted("captive.apple.com"))
        self.assertFalse(DNSSpoofer.is_whitelisted("youtube.com"))
        self.assertFalse(DNSSpoofer.is_whitelisted("detik.com"))

    def test_captive_portal_http_responses(self):
        """Uji apakah Portal Server mengembalikan HTTP 302 Found ke URL Instagram."""
        test_port = 18088
        target_url = "https://www.instagram.com/sentinel_ops/"
        server = CaptivePortalServer(port=test_port, redirect_url=target_url, instagram_username="sentinel_ops")
        server.start()
        time.sleep(0.3)

        try:
            # Custom HTTP redirect handler agar tidak otomatis mengikuti URL eksternal
            class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
                def http_error_302(self, req, fp, code, msg, headers):
                    return fp

            opener = urllib.request.build_opener(NoRedirectHandler)

            # 1. Test standard GET /
            req = urllib.request.Request(f"http://127.0.0.1:{test_port}/")
            with opener.open(req) as resp:
                self.assertEqual(resp.status, 302)
                self.assertEqual(resp.headers.get("Location"), target_url)

            # 2. Test Android Captive Portal Probe /generate_204
            req_probe = urllib.request.Request(f"http://127.0.0.1:{test_port}/generate_204")
            with opener.open(req_probe) as resp:
                self.assertEqual(resp.status, 302)
                self.assertEqual(resp.headers.get("Location"), target_url)

            # 3. Test iOS Captive Portal Probe /hotspot-detect.html
            req_apple = urllib.request.Request(f"http://127.0.0.1:{test_port}/hotspot-detect.html")
            with opener.open(req_apple) as resp:
                self.assertEqual(resp.status, 302)
                self.assertEqual(resp.headers.get("Location"), target_url)

        finally:
            server.stop()

    @patch("src.core.redirector.manager.get_network_info")
    def test_redirect_invariants_enforced(self, mock_net_info):
        """Uji proteksi invariant: Gateway, This PC, dan RFC 1918 wajib ditolak."""
        mock_net_info.return_value = {"ip": "192.168.1.10", "gateway": "192.168.1.1"}
        mock_spoofer = MagicMock()
        mock_spoofer._self_mac = "a8:3b:76:0c:dc:55"

        manager = RedirectManager(mock_spoofer)

        # 1. Reject This PC (Anti Self-Cut)
        with self.assertRaises(SpoofError) as ctx:
            manager.start_redirect(
                victim_ip="192.168.1.10",
                victim_mac="a8:3b:76:0c:dc:55",
                gateway_ip="192.168.1.1",
                gateway_mac="00:11:22:33:44:55",
                redirect_url="https://www.instagram.com/my_user/"
            )
        self.assertIn("This PC", str(ctx.exception))

        # 2. Reject Gateway (Gateway Immunity)
        with self.assertRaises(SpoofError) as ctx:
            manager.start_redirect(
                victim_ip="192.168.1.1",
                victim_mac="00:11:22:33:44:55",
                gateway_ip="192.168.1.1",
                gateway_mac="00:11:22:33:44:55",
                redirect_url="https://www.instagram.com/my_user/"
            )
        self.assertIn("Gateway", str(ctx.exception))

        # 3. Reject non-RFC 1918
        with self.assertRaises(SpoofError) as ctx:
            manager.start_redirect(
                victim_ip="8.8.8.8",
                victim_mac="aa:bb:cc:dd:ee:ff",
                gateway_ip="192.168.1.1",
                gateway_mac="00:11:22:33:44:55",
                redirect_url="https://www.instagram.com/my_user/"
            )
        self.assertIn("RFC 1918", str(ctx.exception))

    def test_portal_server_handle_error_resilience(self):
        """Uji apakah ThreadingHTTPServer.handle_error menangani ConnectionResetError tanpa NameError."""
        from src.core.redirector.portal_server import ThreadingHTTPServer, PortalRequestHandler
        import sys

        server = ThreadingHTTPServer(("127.0.0.1", 0), PortalRequestHandler)
        try:
            # 1. Simulate ConnectionResetError in handle_error
            try:
                raise ConnectionResetError("Client dropped connection abruptly")
            except ConnectionResetError:
                # Should cleanly return without throwing NameError
                server.handle_error(None, ("127.0.0.1", 12345))

            # 2. Simulate BrokenPipeError in handle_error
            try:
                raise BrokenPipeError("Broken pipe")
            except BrokenPipeError:
                # Should cleanly return without throwing NameError
                server.handle_error(None, ("127.0.0.1", 12345))
        finally:
            server.server_close()

if __name__ == "__main__":
    unittest.main()
