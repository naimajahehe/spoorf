#!/usr/bin/env python3
"""
Unit tests for Core Engine & Reliability Fixes:
1. ConnectionManager WebSocket future exception handling & dead socket pruning.
2. DNSSpoofer resolve_cached_domain TTL cache hit & expiry.
3. TransparentGateway rollback on sniffer startup failure & IP forwarding lifecycle.
"""

import asyncio
import time
import unittest
from concurrent.futures import Future
from unittest.mock import MagicMock, patch

from src.server import ConnectionManager
from src.core.redirector.dns_spoofer import resolve_cached_domain, _DNS_RESOLVE_CACHE, _DNS_RESOLVE_CACHE_LOCK
from src.core.redirector.transparent_gateway import TransparentGatewayManager, GatewayDNSSniffer
from src.exceptions.custom import SpoofError


class TestCoreReliabilityFixes(unittest.TestCase):

    # ===== 1. WebSocket Future Exception Handling =====
    def test_connection_manager_prunes_dead_connection_on_future_exception(self):
        """Verify that when a broadcast future errors, ConnectionManager._safe_send_done prunes it."""
        cm = ConnectionManager()
        mock_ws = MagicMock()
        cm.active_connections.append(mock_ws)

        self.assertEqual(len(cm.active_connections), 1)

        # Create a future with an exception
        err_fut = Future()
        err_fut.set_exception(RuntimeError("Client disconnected unexpectedly"))

        cm._safe_send_done(err_fut, mock_ws)

        # Connection should be cleanly removed
        self.assertEqual(len(cm.active_connections), 0)

    def test_connection_manager_retains_connection_on_future_success(self):
        """Verify that when a broadcast future succeeds, connection remains active."""
        cm = ConnectionManager()
        mock_ws = MagicMock()
        cm.active_connections.append(mock_ws)

        ok_fut = Future()
        ok_fut.set_result(None)

        cm._safe_send_done(ok_fut, mock_ws)
        self.assertEqual(len(cm.active_connections), 1)

    # ===== 2. DNS Cache (TTL) =====
    def test_dns_cache_hit_and_expiry(self):
        """Verify resolve_cached_domain caches IP and respects TTL."""
        domain = "test-cache-domain.local"

        with _DNS_RESOLVE_CACHE_LOCK:
            _DNS_RESOLVE_CACHE.pop(domain, None)

        with patch("socket.gethostbyname", return_value="157.240.1.35") as mock_gethost:
            # 1. First call: miss, queries socket.gethostbyname
            ip1 = resolve_cached_domain(domain, ttl=2.0)
            self.assertEqual(ip1, "157.240.1.35")
            self.assertEqual(mock_gethost.call_count, 1)

            # 2. Second call immediately: hit, uses cache without calling socket
            ip2 = resolve_cached_domain(domain, ttl=2.0)
            self.assertEqual(ip2, "157.240.1.35")
            self.assertEqual(mock_gethost.call_count, 1)

            # 3. Simulate expiry by backdating the cache entry
            with _DNS_RESOLVE_CACHE_LOCK:
                _DNS_RESOLVE_CACHE[domain] = ("157.240.1.35", time.time() - 10)

            # Third call: expired, calls socket again
            mock_gethost.return_value = "157.240.1.36"
            ip3 = resolve_cached_domain(domain, ttl=2.0)
            self.assertEqual(ip3, "157.240.1.36")
            self.assertEqual(mock_gethost.call_count, 2)

    # ===== 3. Transparent Gateway Startup Rollback =====
    @patch("src.core.redirector.transparent_gateway.get_network_info")
    @patch("src.core.redirector.transparent_gateway.set_ip_forwarding")
    def test_transparent_gateway_rolls_back_spoofer_on_sniffer_error(self, mock_fwd, mock_net_info):
        """Verify that if GatewayDNSSniffer fails, spoofer session is rolled back immediately."""
        mock_net_info.return_value = {
            "ip": "192.168.1.100",
            "gateway": "192.168.1.1",
            "interface": "Wi-Fi"
        }

        mock_spoofer = MagicMock()
        mock_spoofer._self_mac = "a8:3b:76:0c:dc:55"
        mock_spoofer._interface = "mock_iface"
        mock_spoofer._win_interface_name = "Wi-Fi"
        mock_spoofer.start.return_value = "arp_sess_rollback_123"

        mgr = TransparentGatewayManager(mock_spoofer)

        with patch.object(GatewayDNSSniffer, "start", side_effect=RuntimeError("Sniffer failed to bind")):
            with self.assertRaises(RuntimeError):
                mgr.start_gateway(
                    victim_ip="192.168.1.77",
                    victim_mac="aa:bb:cc:dd:ee:77",
                    gateway_ip="192.168.1.1",
                    gateway_mac="00:11:22:33:44:55"
                )

        # Spoofer stop must have been called to roll back
        mock_spoofer.stop.assert_called_once_with("arp_sess_rollback_123")
        self.assertEqual(len(mgr._sessions), 0)


if __name__ == '__main__':
    unittest.main()
