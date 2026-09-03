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
from io import BytesIO
from unittest.mock import MagicMock, patch

from src.core.redirector.dns_spoofer import DNSSpoofer
from src.core.redirector.portal_server import (
    CaptivePortalServer,
    PortalRequestHandler,
    sanitize_redirect_url,
    DEFAULT_REDIRECT_URL,
)
from src.core.redirector.manager import RedirectManager
from src.exceptions.custom import SpoofError

class TestRedirector(unittest.TestCase):
    # ===== P2: Captive Portal XSS / Open-Redirect Hardening =====
    def test_sanitize_redirect_url_rejects_dangerous_schemes(self):
        """P2: hanya http/https absolut yang lolos; skema berbahaya → fallback aman."""
        self.assertEqual(sanitize_redirect_url("javascript:alert(1)"), DEFAULT_REDIRECT_URL)
        self.assertEqual(sanitize_redirect_url("data:text/html,<script>"), DEFAULT_REDIRECT_URL)
        self.assertEqual(sanitize_redirect_url(""), DEFAULT_REDIRECT_URL)
        self.assertEqual(sanitize_redirect_url("not-a-url"), DEFAULT_REDIRECT_URL)
        # URL sah dipertahankan
        self.assertEqual(sanitize_redirect_url("http://192.168.1.1/login"), "http://192.168.1.1/login")
        self.assertEqual(sanitize_redirect_url("https://example.com/x"), "https://example.com/x")

    def test_landing_html_escapes_injection(self):
        """P2: payload XSS pada URL & username tidak boleh lolos sebagai HTML/JS aktif."""
        # _render_landing_html tidak memakai `self`, aman dipanggil dengan None.
        body = PortalRequestHandler._render_landing_html(
            None,
            'https://evil.com/"><script>alert(1)</script>',
            '"><img src=x onerror=alert(1)>'
        ).decode("utf-8")
        # Tidak ada tag script mentah dari input yang tersuntik
        self.assertNotIn("<script>alert(1)</script>", body)
        self.assertNotIn("<img src=x onerror=alert(1)>", body)
        # Karakter berbahaya ter-escape
        self.assertIn("&lt;", body)
        self.assertIn("&gt;", body)

    def test_landing_html_rejects_js_scheme_url(self):
        """P2: redirect_url ber-skema javascript: di-fallback ke default (tidak muncul di output)."""
        body = PortalRequestHandler._render_landing_html(None, "javascript:alert(1)", "").decode("utf-8")
        self.assertNotIn("javascript:alert(1)", body)
        self.assertIn(DEFAULT_REDIRECT_URL, body)

    def test_landing_html_prevents_script_breakout_in_valid_https(self):
        """P2: `</script>` di dalam URL https VALID tidak boleh menutup blok <script>."""
        malicious = "https://evil.com/x</script><script>alert(1)</script>"
        body = PortalRequestHandler._render_landing_html(None, malicious, "").decode("utf-8")
        # Tidak ada </script> atau <script>alert mentah dari input di dalam konteks JS
        self.assertNotIn("</script><script>alert(1)", body)
        # Di konteks JS harus ter-escape menjadi \u003c/script...
        self.assertIn("\\u003c/script", body)

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
        """Uji handler HTTP 302 tanpa membuka server/socket sungguhan."""
        target_url = "https://www.instagram.com/sentinel_ops/"
        for path in ("/", "/generate_204", "/hotspot-detect.html"):
            with self.subTest(path=path):
                handler = PortalRequestHandler.__new__(PortalRequestHandler)
                handler.path = path
                handler.redirect_url = target_url
                handler.instagram_username = "sentinel_ops"
                handler.wfile = BytesIO()
                handler.send_response = MagicMock()
                handler.send_header = MagicMock()
                handler.end_headers = MagicMock()

                handler.do_GET()

                handler.send_response.assert_called_once_with(302)
                self.assertIn(
                    unittest.mock.call("Location", target_url),
                    handler.send_header.call_args_list,
                )

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

    @patch("src.core.redirector.manager.DNSSpoofer")
    @patch("src.core.redirector.manager.CaptivePortalServer")
    @patch("src.core.redirector.manager.set_ip_forwarding")
    @patch("src.core.redirector.manager.get_network_info")
    def test_redirect_validates_all_inputs_before_stopping_existing_session(
        self,
        mock_net_info,
        mock_set_forwarding,
        mock_portal_class,
        mock_dns_class,
    ):
        """Malformed victim/gateway inputs cannot disrupt an existing redirect."""
        mock_net_info.return_value = {"ip": "192.168.1.10", "gateway": "192.168.1.1"}
        mock_spoofer = MagicMock()
        mock_spoofer._self_mac = "a8:3b:76:0c:dc:55"
        manager = RedirectManager(mock_spoofer)
        victim_ip = "192.168.1.55"
        manager._sessions[victim_ip] = {"victim_ip": victim_ip}

        invalid_inputs = (
            {"victim_mac": "not-a-mac"},
            {"gateway_ip": "8.8.8.8"},
            {"gateway_mac": "not-a-mac"},
        )
        defaults = {
            "victim_ip": victim_ip,
            "victim_mac": "00:11:22:33:44:55",
            "gateway_ip": "192.168.1.1",
            "gateway_mac": "00:aa:bb:cc:dd:ee",
            "redirect_url": "https://www.instagram.com/sentinel_ops/",
        }

        with patch.object(manager, "_stop_session_unlocked") as mock_stop_existing:
            for invalid in invalid_inputs:
                with self.subTest(invalid=invalid):
                    args = {**defaults, **invalid}
                    with self.assertRaises(SpoofError):
                        manager.start_redirect(**args)

        mock_stop_existing.assert_not_called()
        mock_portal_class.assert_not_called()
        mock_spoofer.start.assert_not_called()
        mock_set_forwarding.assert_not_called()
        mock_dns_class.assert_not_called()

    @patch("src.core.redirector.manager.CaptivePortalServer")
    @patch("src.core.redirector.manager.get_network_info")
    def test_redirect_start_rolls_back_portal_when_spoofer_fails(
        self,
        mock_net_info,
        mock_portal_class,
    ):
        """A newly started portal is stopped if ARP spoof startup fails."""
        mock_net_info.return_value = {"ip": "192.168.1.10", "gateway": "192.168.1.1"}
        mock_spoofer = MagicMock()
        mock_spoofer._self_mac = "a8:3b:76:0c:dc:55"
        mock_spoofer._interface = "test-interface"
        mock_spoofer.start.side_effect = SpoofError("ARP start failed")
        portal = mock_portal_class.return_value
        portal._running = False
        manager = RedirectManager(mock_spoofer)

        with self.assertRaises(SpoofError):
            manager.start_redirect(
                victim_ip="192.168.1.55",
                victim_mac="00:11:22:33:44:55",
                gateway_ip="192.168.1.1",
                gateway_mac="00:aa:bb:cc:dd:ee",
                redirect_url="https://www.instagram.com/sentinel_ops/",
            )

        portal.stop.assert_called_once_with()
        self.assertIsNone(manager.portal_server)
        self.assertEqual(manager.get_sessions(), {})

    @patch("src.core.redirector.manager.DNSSpoofer")
    @patch("src.core.redirector.manager.CaptivePortalServer")
    @patch("src.core.redirector.manager.set_ip_forwarding", return_value=False)
    @patch("src.core.redirector.manager.get_network_info")
    def test_redirect_start_rolls_back_when_forwarding_enable_fails(
        self,
        mock_net_info,
        mock_set_forwarding,
        mock_portal_class,
        mock_dns_class,
    ):
        """A failed forwarding enable unwinds ARP and portal before raising."""
        mock_net_info.return_value = {"ip": "192.168.1.10", "gateway": "192.168.1.1"}
        mock_spoofer = MagicMock()
        mock_spoofer._self_mac = "a8:3b:76:0c:dc:55"
        mock_spoofer._interface = "test-interface"
        mock_spoofer._win_interface_name = "test-interface"
        mock_spoofer.start.return_value = "arp-1"
        portal = mock_portal_class.return_value
        portal._running = False
        manager = RedirectManager(mock_spoofer)

        with self.assertRaises(SpoofError):
            manager.start_redirect(
                victim_ip="192.168.1.55",
                victim_mac="00:11:22:33:44:55",
                gateway_ip="192.168.1.1",
                gateway_mac="00:aa:bb:cc:dd:ee",
                redirect_url="https://www.instagram.com/sentinel_ops/",
            )

        mock_set_forwarding.assert_called_once_with(True, "test-interface")
        mock_spoofer.stop.assert_called_once_with("arp-1")
        portal.stop.assert_called_once_with()
        mock_dns_class.assert_not_called()
        self.assertIsNone(manager.portal_server)
        self.assertEqual(manager.get_sessions(), {})

    @patch("src.core.redirector.manager.DNSSpoofer")
    @patch("src.core.redirector.manager.CaptivePortalServer")
    @patch("src.core.redirector.manager.set_ip_forwarding")
    @patch("src.core.redirector.manager.get_network_info")
    def test_redirect_start_rolls_back_resources_in_reverse_order(
        self,
        mock_net_info,
        mock_set_forwarding,
        mock_portal_class,
        mock_dns_class,
    ):
        """DNS startup failure unwinds DNS, ARP/forwarding, then portal."""
        events = []
        mock_net_info.return_value = {"ip": "192.168.1.10", "gateway": "192.168.1.1"}
        mock_spoofer = MagicMock()
        mock_spoofer._self_mac = "a8:3b:76:0c:dc:55"
        mock_spoofer._interface = "test-interface"
        mock_spoofer._win_interface_name = "test-interface"
        mock_spoofer.start.side_effect = lambda **_: events.append("spoofer.start") or "arp-1"
        mock_spoofer.stop.side_effect = lambda *_: events.append("spoofer.stop")
        portal = mock_portal_class.return_value
        portal._running = False
        portal.start.side_effect = lambda: events.append("portal.start")
        portal.stop.side_effect = lambda: events.append("portal.stop")
        mock_set_forwarding.side_effect = lambda *_: events.append("forwarding.enable") or True
        dns = mock_dns_class.return_value
        dns.start.side_effect = lambda: (
            events.append("dns.start"),
            (_ for _ in ()).throw(RuntimeError("DNS start failed")),
        )[-1]
        dns.stop.side_effect = lambda: events.append("dns.stop")
        manager = RedirectManager(mock_spoofer)

        with self.assertRaises(RuntimeError):
            manager.start_redirect(
                victim_ip="192.168.1.55",
                victim_mac="00:11:22:33:44:55",
                gateway_ip="192.168.1.1",
                gateway_mac="00:aa:bb:cc:dd:ee",
                redirect_url="https://www.instagram.com/sentinel_ops/",
            )

        self.assertEqual(
            events,
            [
                "portal.start",
                "spoofer.start",
                "forwarding.enable",
                "dns.start",
                "dns.stop",
                "spoofer.stop",
                "portal.stop",
            ],
        )
        self.assertIsNone(manager.portal_server)
        self.assertEqual(manager.get_sessions(), {})

    @patch("src.core.redirector.manager.get_network_info")
    def test_redirect_stop_retains_failed_cleanup_for_retry(self, mock_net_info):
        """Stop failures are explicit and retain only resources that still need cleanup."""
        mock_net_info.return_value = {"ip": "192.168.1.10", "gateway": "192.168.1.1"}
        mock_spoofer = MagicMock()
        dns = MagicMock()
        dns.stop.side_effect = [RuntimeError("DNS stop failed"), None]
        mock_spoofer.stop.side_effect = [SpoofError("ARP stop failed"), True]
        portal = MagicMock()
        portal._running = True
        manager = RedirectManager(mock_spoofer)
        manager.portal_server = portal
        victim_ip = "192.168.1.55"
        manager._sessions[victim_ip] = {
            "victim_ip": victim_ip,
            "victim_mac": "00:11:22:33:44:55",
            "gateway_ip": "192.168.1.1",
            "gateway_mac": "00:aa:bb:cc:dd:ee",
            "redirect_url": "https://www.instagram.com/old/",
            "instagram_username": "old",
            "arp_session_id": "arp-1",
            "dns_spoofer": dns,
            "started_at": 1.0,
        }

        with self.assertRaises(SpoofError) as ctx:
            manager.stop_redirect(victim_ip)

        self.assertIn("DNS stop failed", str(ctx.exception))
        self.assertIn("ARP stop failed", str(ctx.exception))
        self.assertIn(victim_ip, manager._sessions)
        self.assertIs(manager._sessions[victim_ip]["dns_spoofer"], dns)
        self.assertEqual(manager._sessions[victim_ip]["arp_session_id"], "arp-1")

        self.assertTrue(manager.stop_redirect(victim_ip))
        self.assertNotIn(victim_ip, manager._sessions)
        self.assertIsNone(manager.portal_server)
        self.assertEqual(dns.stop.call_count, 2)
        self.assertEqual(mock_spoofer.stop.call_count, 2)

    @patch("src.core.redirector.manager.CaptivePortalServer")
    @patch("src.core.redirector.manager.set_ip_forwarding", return_value=False)
    @patch("src.core.redirector.manager.get_network_info")
    def test_startup_rollback_retains_failed_arp_cleanup_for_stop_all(
        self,
        mock_net_info,
        mock_set_forwarding,
        mock_portal_class,
    ):
        """A failed startup rollback keeps its ARP handle until stop_all can retry it."""
        mock_net_info.return_value = {"ip": "192.168.1.10", "gateway": "192.168.1.1"}
        mock_spoofer = MagicMock()
        mock_spoofer._self_mac = "a8:3b:76:0c:dc:55"
        mock_spoofer._interface = "test-interface"
        mock_spoofer._win_interface_name = "test-interface"
        mock_spoofer.start.return_value = "arp-partial"
        mock_spoofer.stop.side_effect = [
            SpoofError("rollback ARP stop failed"),
            True,
        ]
        portal = mock_portal_class.return_value
        portal._running = False
        manager = RedirectManager(mock_spoofer)

        with self.assertRaises(SpoofError):
            manager.start_redirect(
                victim_ip="192.168.1.55",
                victim_mac="00:11:22:33:44:55",
                gateway_ip="192.168.1.1",
                gateway_mac="00:aa:bb:cc:dd:ee",
                redirect_url="https://www.instagram.com/sentinel_ops/",
            )

        self.assertEqual(mock_spoofer.stop.call_count, 1)
        manager.stop_all()
        self.assertEqual(mock_spoofer.stop.call_count, 2)
        self.assertFalse(manager.stop_redirect("192.168.1.55"))

    @patch("src.core.redirector.manager.CaptivePortalServer")
    @patch("src.core.redirector.manager.get_network_info")
    def test_reused_portal_target_is_restored_when_startup_fails(
        self,
        mock_net_info,
        mock_portal_class,
    ):
        """A failed new redirect cannot mutate the portal used by existing sessions."""
        mock_net_info.return_value = {"ip": "192.168.1.10", "gateway": "192.168.1.1"}
        mock_spoofer = MagicMock()
        mock_spoofer._self_mac = "a8:3b:76:0c:dc:55"
        mock_spoofer._interface = "test-interface"
        mock_spoofer.start.side_effect = SpoofError("ARP start failed")
        portal = MagicMock()
        portal._running = True
        portal.redirect_url = "https://www.instagram.com/existing/"
        portal.instagram_username = "existing"
        manager = RedirectManager(mock_spoofer)
        manager.portal_server = portal
        existing = {
            "victim_ip": "192.168.1.44",
            "victim_mac": "00:11:22:33:44:44",
            "gateway_ip": "192.168.1.1",
            "gateway_mac": "00:aa:bb:cc:dd:ee",
            "redirect_url": portal.redirect_url,
            "instagram_username": portal.instagram_username,
            "arp_session_id": "existing-arp",
            "dns_spoofer": MagicMock(),
            "started_at": 1.0,
        }
        manager._sessions[existing["victim_ip"]] = existing

        with self.assertRaises(SpoofError):
            manager.start_redirect(
                victim_ip="192.168.1.55",
                victim_mac="00:11:22:33:44:55",
                gateway_ip="192.168.1.1",
                gateway_mac="00:aa:bb:cc:dd:ee",
                redirect_url="https://www.instagram.com/new/",
                instagram_username="new",
            )

        self.assertEqual(
            portal.update_target.call_args_list,
            [
                unittest.mock.call("https://www.instagram.com/new/", "new"),
                unittest.mock.call(
                    "https://www.instagram.com/existing/",
                    "existing",
                ),
            ],
        )
        self.assertIs(manager.portal_server, portal)
        self.assertIs(manager._sessions[existing["victim_ip"]], existing)
        mock_spoofer.stop.assert_not_called()

    @patch("src.core.redirector.manager.DNSSpoofer")
    @patch("src.core.redirector.manager.CaptivePortalServer")
    @patch("src.core.redirector.manager.set_ip_forwarding")
    @patch("src.core.redirector.manager.get_network_info")
    def test_duplicate_redirect_start_preserves_existing_session(
        self,
        mock_net_info,
        mock_set_forwarding,
        mock_portal_class,
        mock_dns_class,
    ):
        """A replacement attempt is rejected before it can tear down the active redirect."""
        mock_net_info.return_value = {"ip": "192.168.1.10", "gateway": "192.168.1.1"}
        mock_spoofer = MagicMock()
        mock_spoofer._self_mac = "a8:3b:76:0c:dc:55"
        mock_spoofer._interface = "test-interface"
        portal = MagicMock()
        portal._running = True
        portal.redirect_url = "https://www.instagram.com/existing/"
        portal.instagram_username = "existing"
        manager = RedirectManager(mock_spoofer)
        manager.portal_server = portal
        victim_ip = "192.168.1.55"
        existing_dns = MagicMock()
        existing = {
            "victim_ip": victim_ip,
            "victim_mac": "00:11:22:33:44:55",
            "gateway_ip": "192.168.1.1",
            "gateway_mac": "00:aa:bb:cc:dd:ee",
            "redirect_url": portal.redirect_url,
            "instagram_username": portal.instagram_username,
            "arp_session_id": "existing-arp",
            "dns_spoofer": existing_dns,
            "started_at": 1.0,
        }
        manager._sessions[victim_ip] = existing

        with self.assertRaises(SpoofError):
            manager.start_redirect(
                victim_ip=victim_ip,
                victim_mac="00:11:22:33:44:55",
                gateway_ip="192.168.1.1",
                gateway_mac="00:aa:bb:cc:dd:ee",
                redirect_url="https://www.instagram.com/new/",
                instagram_username="new",
            )

        self.assertIs(manager._sessions[victim_ip], existing)
        existing_dns.stop.assert_not_called()
        mock_spoofer.stop.assert_not_called()
        mock_spoofer.start.assert_not_called()
        portal.update_target.assert_not_called()
        portal.stop.assert_not_called()
        mock_portal_class.assert_not_called()

    def test_portal_server_handle_error_resilience(self):
        """Uji apakah ThreadingHTTPServer.handle_error menangani ConnectionResetError tanpa NameError."""
        from src.core.redirector.portal_server import ThreadingHTTPServer, PortalRequestHandler

        server = ThreadingHTTPServer.__new__(ThreadingHTTPServer)
        # 1. Simulate ConnectionResetError in handle_error
        try:
            raise ConnectionResetError("Client dropped connection abruptly")
        except ConnectionResetError:
            server.handle_error(None, ("127.0.0.1", 12345))

        # 2. Simulate BrokenPipeError in handle_error
        try:
            raise BrokenPipeError("Broken pipe")
        except BrokenPipeError:
            server.handle_error(None, ("127.0.0.1", 12345))

if __name__ == "__main__":
    unittest.main()
