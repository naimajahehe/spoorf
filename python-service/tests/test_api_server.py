"""
API & Route Tests for FastAPI Microservice (src.server)
Covers: Happy Path, Negative Tests, and Edge Cases
"""

import unittest
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from pydantic import ValidationError
from src.exceptions.custom import SpoofError
from src.core.discovery.profile_observation import (
    ProfileCollectorUnavailableError,
    ProfileRefreshValidationError,
)
import src.core.spoofer_v6 as spoofer_v6

# The server owns singleton spoofers, whose normal constructors inspect adapters.
# Keep the production route tests hermetic before importing those singletons.
with patch.object(spoofer_v6.NDPSpoofer, 'refresh_interface'), \
     patch('src.core.spoofer.ARPSpoofer.refresh_interface'):
    from src.server import (
        health_check,
        get_wifi_status,
        get_telemetry,
        get_status,
        start_spoof,
        update_spoof_limit,
        stop_spoof,
        stop_all_spoof,
        run_bettercap_syn_scan,
        scan_network,
        trigger_dhcp_wakeup,
        profile_refresh,
        quick_reauth_profiling,
        shutdown_event,
        SpoofStartRequest,
        SpoofLimitRequest,
        SpoofStopRequest,
        SynScanRequest,
        ProfileRefreshRequest,
        ProfileRefreshTarget,
        QuickReauthRequest,
        QuickReauthTarget,
        spoofer,
    )

class TestServerAPI(unittest.TestCase):

    def tearDown(self):
        with patch('src.core.spoofer.sendp'):
            stop_all_spoof()

    # ===== 1. GET Endpoints (Happy Path) =====
    def test_health_check_happy_path(self):
        """GET /health returns status ok."""
        res = health_check()
        self.assertIsInstance(res, dict)
        self.assertEqual(res.get('status'), 'ok')
        self.assertIn('timestamp', res)

    def test_wifi_status_happy_path(self):
        """GET /api/wifi returns success and wifi dictionary."""
        res = get_wifi_status()
        self.assertTrue(res.get('success'))
        self.assertIn('wifi', res)
        self.assertIsInstance(res['wifi'], dict)

    def test_telemetry_happy_path(self):
        """GET /api/telemetry returns throughput and latency."""
        res = get_telemetry()
        self.assertTrue(res.get('success'))
        self.assertIn('telemetry', res)
        self.assertIn('download', res['telemetry'])
        self.assertIn('upload', res['telemetry'])

    def test_status_happy_path(self):
        """GET /api/status returns interface and session count."""
        res = get_status()
        self.assertTrue(res.get('success'))
        self.assertIn('status', res)
        self.assertIn('active_count', res['status'])

    # ===== 2. POST Spoof Endpoints (Happy Path) =====
    @patch('src.core.spoofer.sendp')
    def test_spoof_api_lifecycle_happy_path(self, mock_sendp):
        """Start, update limit, and stop spoofing session via route functions."""
        req_start = SpoofStartRequest(
            victim_ip="192.168.1.88",
            victim_mac="00:11:22:33:44:55",
            gateway_ip="192.168.1.1",
            gateway_mac="00:aa:bb:cc:dd:ee",
            speed_limit=50
        )
        res_start = start_spoof(req_start)
        self.assertTrue(res_start.get('success'))
        session_id = res_start['data']['session_id']
        self.assertIsNotNone(session_id)

        # Update limit
        req_limit = SpoofLimitRequest(session_id=session_id, speed_limit=25)
        res_limit = update_spoof_limit(req_limit)
        self.assertTrue(res_limit.get('success'))
        self.assertEqual(res_limit.get('speed_limit'), 25)

        # Stop spoof
        req_stop = SpoofStopRequest(session_id=session_id)
        res_stop = stop_spoof(req_stop)
        self.assertTrue(res_stop.get('success'))

    # ===== 3. Security Invariants di Boundary HTTP =====
    @patch('src.core.spoofer.sendp')
    def test_start_spoof_public_ip_rejected_boundary(self, mock_sendp):
        """Boundary: start_spoof menolak victim IP publik (RFC1918) -> HTTPException 500."""
        req = SpoofStartRequest(
            victim_ip="8.8.8.8",
            victim_mac="00:11:22:33:44:55",
            gateway_ip="192.168.1.1",
            gateway_mac="00:aa:bb:cc:dd:ee"
        )
        with self.assertRaises(HTTPException) as ctx:
            start_spoof(req)
        self.assertEqual(ctx.exception.status_code, 500)

    @patch('src.core.spoofer.sendp')
    def test_start_spoof_gateway_victim_rejected_boundary(self, mock_sendp):
        """Boundary: start_spoof menolak victim == gateway (Gateway Immunity) -> HTTPException 500."""
        req = SpoofStartRequest(
            victim_ip="192.168.1.1",
            victim_mac="00:aa:bb:cc:dd:ee",
            gateway_ip="192.168.1.1",
            gateway_mac="00:aa:bb:cc:dd:ee"
        )
        with self.assertRaises(HTTPException) as ctx:
            start_spoof(req)
        self.assertEqual(ctx.exception.status_code, 500)

    def test_syn_scan_public_ip_rejected_boundary(self):
        """Boundary: syn-scan menolak target IP publik -> HTTPException 400 (F-05)."""
        req = SynScanRequest(target_ip="8.8.8.8", profile="top-20")
        with self.assertRaises(HTTPException) as ctx:
            run_bettercap_syn_scan(req)
        self.assertEqual(ctx.exception.status_code, 400)

    # ===== 4. Negative Tests =====
    def test_stop_spoof_nonexistent_is_successfully_idempotent(self):
        """Boundary: an absent session is a successful, explicitly marked stop."""
        req_stop = SpoofStopRequest(session_id="invalid_session_id_999")
        response = stop_spoof(req_stop)

        self.assertTrue(response.get('success'))
        self.assertTrue(response.get('already_stopped'))

    @patch('src.server.spoofer.stop', side_effect=SpoofError('restore packets failed'))
    def test_stop_spoof_restore_failure_remains_an_http_error(self, _mock_stop):
        """Boundary: retained restore-failed sessions must not be reported as stopped."""
        req_stop = SpoofStopRequest(session_id="restore_failed_session")

        with self.assertRaises(HTTPException) as ctx:
            stop_spoof(req_stop)

        self.assertEqual(ctx.exception.status_code, 500)

    @patch('src.server.spoofer.stop_all', side_effect=SpoofError('member restore failed'))
    def test_stop_all_spoof_failure_remains_an_http_error(self, _mock_stop_all):
        """Boundary: aggregate stop-all failure must never return a success payload."""
        with self.assertRaises(HTTPException) as ctx:
            stop_all_spoof()

        self.assertEqual(ctx.exception.status_code, 500)

    def test_shutdown_event_runs_all_cleanup_stages_after_multiple_failures(self):
        """A failed shutdown stage must not skip later safety cleanup."""
        calls = []

        def cleanup(name, fail=False):
            def run(*_args, **_kwargs):
                calls.append(name)
                if fail:
                    raise RuntimeError(f'{name} failed')
            return run

        with patch('src.server.shield_engine.disable', side_effect=cleanup('shield', True)), \
             patch('src.server.gaming_engine.toggle', side_effect=cleanup('gaming')), \
             patch('src.server.liveness_daemon.stop', side_effect=cleanup('liveness', True)), \
             patch('src.server.NetworkScanner.stop_dhcp_sniffer', side_effect=cleanup('dhcp')), \
             patch('src.server.redirect_manager.stop_all', side_effect=cleanup('redirect')), \
             patch('src.server.transparent_gateway.stop_all', side_effect=cleanup('gateway', True)), \
             patch('src.server.spoofer.stop_all', side_effect=cleanup('spoofer')), \
             patch('src.server.executor.shutdown', side_effect=cleanup('executor')):
            try:
                shutdown_event()
            except RuntimeError:
                pass

        self.assertEqual(
            calls,
            ['shield', 'gaming', 'liveness', 'dhcp', 'redirect', 'gateway', 'spoofer', 'executor'],
        )

    def test_update_limit_nonexistent_negative(self):
        """Negative: Updating limit for non-existent session must raise HTTPException 500."""
        req_limit = SpoofLimitRequest(session_id="invalid_session_id_999", speed_limit=50)
        res = update_spoof_limit(req_limit)
        self.assertFalse(res.get('success'))

    def test_dhcp_wakeup_rejects_public_topology_before_sending(self):
        """Method 1 must fail closed before opening multicast sockets."""
        with patch(
            'src.server.get_network_info',
            return_value={
                'ip': '203.0.113.10',
                'network': '203.0.113.0/24',
                'gateway': '203.0.113.1',
            },
            create=True,
        ), patch(
            'src.server.get_current_gateway',
            return_value='203.0.113.1',
            create=True,
        ), patch('src.server.send_multicast_wakeup') as mock_wakeup:
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(trigger_dhcp_wakeup())

        self.assertEqual(ctx.exception.status_code, 400)
        mock_wakeup.assert_not_called()

    def test_dhcp_wakeup_rejects_zero_successful_datagrams(self):
        """An HTTP success must mean at least one discovery datagram was sent."""
        with patch(
            'src.server.get_network_info',
            return_value={
                'ip': '192.168.1.100',
                'network': '192.168.1.0/24',
                'gateway': '192.168.1.1',
            },
            create=True,
        ), patch(
            'src.server.get_current_gateway',
            return_value='192.168.1.1',
            create=True,
        ), patch(
            'src.server.send_multicast_wakeup',
            return_value={
                'attempted': 6,
                'succeeded': 0,
                'failed': 6,
                'protocols': {},
                'errors': [],
            },
        ):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(trigger_dhcp_wakeup())

        self.assertEqual(ctx.exception.status_code, 503)

    def test_dhcp_wakeup_reports_observed_profile_delta(self):
        """The observation response must compare unique DHCP profiles after the wait."""
        before = {
            '00:11:22:33:44:55': {
                'mac': '00:11:22:33:44:55',
                'ip': '192.168.1.100',
                'hostname': 'Controller-Old',
            },
            'aa:bb:cc:dd:ee:01': {
                'mac': 'aa:bb:cc:dd:ee:01',
                'ip': '192.168.1.20',
                'vendor_class': '',
            }
        }
        after = {
            '00:11:22:33:44:55': {
                'mac': '00:11:22:33:44:55',
                'ip': '192.168.1.100',
                'hostname': 'Controller-New',
            },
            '00:aa:bb:cc:dd:ee': {
                'mac': '00:aa:bb:cc:dd:ee',
                'ip': '192.168.1.1',
                'hostname': 'Gateway',
            },
            'aa:bb:cc:dd:ee:01': {
                'mac': 'aa:bb:cc:dd:ee:01',
                'ip': '192.168.1.20',
                'vendor_class': 'android-dhcp-14',
            },
            'aa:bb:cc:dd:ee:02': {
                'mac': 'aa:bb:cc:dd:ee:02',
                'ip': '192.168.1.21',
                'dhcp_fingerprint': 'Microsoft Windows Signature',
            },
        }
        delivery = {
            'attempted': 6,
            'succeeded': 5,
            'failed': 1,
            'protocols': {'ssdp_ipv4': True},
            'errors': [{'protocol': 'ssdp_ipv6', 'error': 'unavailable'}],
        }

        with patch(
            'src.server.get_network_info',
            return_value={
                'ip': '192.168.1.100',
                'network': '192.168.1.0/24',
                'gateway': '192.168.1.1',
            },
            create=True,
        ), patch(
            'src.server.get_current_gateway',
            return_value='192.168.1.1',
            create=True,
        ), patch(
            'src.server.get_self_mac',
            return_value='00:11:22:33:44:55',
            create=True,
        ), patch(
            'src.server.dhcp_cache.get_unique_snapshot',
            side_effect=[before, after],
        ), patch(
            'src.server.send_multicast_wakeup',
            return_value=delivery,
        ), patch('src.server.asyncio.sleep', new=AsyncMock()) as mock_sleep:
            response = asyncio.run(trigger_dhcp_wakeup())

        self.assertTrue(response['success'])
        self.assertEqual(response['data']['delivery'], delivery)
        self.assertEqual(response['data']['dhcp_delta']['new_count'], 1)
        self.assertEqual(response['data']['dhcp_delta']['updated_count'], 1)
        self.assertEqual(response['data']['dhcp_profiled_count'], 2)
        mock_sleep.assert_awaited_once()

    def test_profile_refresh_rejects_public_target_before_collection(self):
        request = ProfileRefreshRequest(targets=[
            ProfileRefreshTarget(
                ip="203.0.113.20",
                mac="00:11:22:33:44:55",
            )
        ])
        with patch("src.server.collect_profile_refresh") as collect:
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(profile_refresh(request))

        self.assertEqual(ctx.exception.status_code, 400)
        collect.assert_not_called()

    def test_profile_refresh_runs_safe_collector_in_executor(self):
        request = ProfileRefreshRequest(
            targets=[
                ProfileRefreshTarget(
                    ip="192.168.1.20",
                    mac="00:11:22:33:44:55",
                    ipv6_addresses=["fe80::20"],
                )
            ],
            observation_seconds=3,
        )
        safe_result = {
            "visible_count": 1,
            "high_confidence_count": 0,
            "partial_failures": [],
        }
        with patch(
            "src.server.collect_profile_refresh",
            return_value=safe_result,
        ) as collect:
            response = asyncio.run(profile_refresh(request))

        self.assertTrue(response["success"])
        self.assertEqual(response["data"], safe_result)
        collect.assert_called_once_with(
            [{
                "ip": "192.168.1.20",
                "mac": "00:11:22:33:44:55",
                "ipv6_addresses": ["fe80::20"],
            }],
            3.0,
        )

    def test_profile_refresh_maps_collector_failures_to_http_statuses(self):
        request = ProfileRefreshRequest(targets=[
            ProfileRefreshTarget(
                ip="192.168.1.20",
                mac="00:11:22:33:44:55",
            )
        ])
        cases = [
            (ProfileRefreshValidationError("outside active CIDR"), 400),
            (ProfileCollectorUnavailableError("no collector"), 503),
        ]
        for error, expected_status in cases:
            with self.subTest(expected_status=expected_status), patch(
                "src.server.collect_profile_refresh",
                side_effect=error,
            ):
                with self.assertRaises(HTTPException) as ctx:
                    asyncio.run(profile_refresh(request))
            self.assertEqual(ctx.exception.status_code, expected_status)

    def test_legacy_quick_reauth_is_safe_alias(self):
        request = QuickReauthRequest(targets=[
            QuickReauthTarget(
                victim_ip="192.168.1.20",
                victim_mac="00:11:22:33:44:55",
                gateway_ip="203.0.113.1",
                gateway_mac="not-used",
            )
        ])
        safe_result = {"visible_count": 1, "high_confidence_count": 0}
        with patch(
            "src.server.collect_profile_refresh",
            return_value=safe_result,
        ) as collect, patch.object(spoofer, "start") as start_spoof:
            response = asyncio.run(quick_reauth_profiling(request))

        self.assertTrue(response["success"])
        self.assertTrue(response["deprecated"])
        self.assertEqual(response["data"], safe_result)
        collect.assert_called_once_with(
            [{
                "ip": "192.168.1.20",
                "mac": "00:11:22:33:44:55",
                "ipv6_addresses": [],
            }],
            3.0,
        )
        start_spoof.assert_not_called()

    def test_profile_refresh_models_bound_targets_observation_and_ipv6(self):
        target = ProfileRefreshTarget(
            ip="192.168.1.20",
            mac="00:11:22:33:44:55",
        )
        with self.assertRaises(ValidationError):
            ProfileRefreshRequest(targets=[target] * 301)
        with self.assertRaises(ValidationError):
            ProfileRefreshRequest(targets=[target], observation_seconds=2.9)
        with self.assertRaises(ValidationError):
            ProfileRefreshTarget(
                ip="192.168.1.20",
                mac="00:11:22:33:44:55",
                ipv6_addresses=[f"fe80::{index}" for index in range(9)],
            )

    def test_scan_endpoint_can_suppress_multicast_wakeup(self):
        """The optional scan flag must be forwarded to NetworkScanner."""
        request = SimpleNamespace(skip_multicast_wakeup=True)
        with patch('src.server.scanner.scan_full', return_value=[]) as mock_scan:
            response = asyncio.run(scan_network(request))

        self.assertTrue(response['success'])
        mock_scan.assert_called_once_with(include_multicast_wakeup=False)

    def test_scan_endpoint_default_keeps_multicast_wakeup(self):
        """Existing no-body scan callers retain the legacy default behavior."""
        with patch('src.server.scanner.scan_full', return_value=[]) as mock_scan:
            response = asyncio.run(scan_network())

        self.assertTrue(response['success'])
        mock_scan.assert_called_once_with(include_multicast_wakeup=True)

    # ===== 4. Edge Cases =====
    @patch('src.core.spoofer.sendp')
    def test_edge_limits_spoof(self, mock_sendp):
        """Edge Cases: Speed limit 0 (cut-off) and 100 (unrestricted)."""
        req_start = SpoofStartRequest(
            victim_ip="192.168.1.99",
            victim_mac="11:22:33:44:55:66",
            gateway_ip="192.168.1.1",
            gateway_mac="00:aa:bb:cc:dd:ee",
            speed_limit=0
        )
        res_start = start_spoof(req_start)
        session_id = res_start['data']['session_id']

        # Update to 100
        req_100 = SpoofLimitRequest(session_id=session_id, speed_limit=100)
        res_100 = update_spoof_limit(req_100)
        self.assertEqual(res_100.get('speed_limit'), 100)

        # Clean up
        stop_spoof(SpoofStopRequest(session_id=session_id))

if __name__ == '__main__':
    unittest.main()
