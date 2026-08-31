"""
API & Route Tests for FastAPI Microservice (src.server)
Covers: Happy Path, Negative Tests, and Edge Cases
"""

import unittest
from unittest.mock import patch
from fastapi import HTTPException
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
    SpoofStartRequest,
    SpoofLimitRequest,
    SpoofStopRequest,
    SynScanRequest
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
    def test_stop_spoof_nonexistent_negative(self):
        """Negative: Stopping non-existent session ID must raise HTTPException 500."""
        req_stop = SpoofStopRequest(session_id="invalid_session_id_999")
        with self.assertRaises(HTTPException) as ctx:
            stop_spoof(req_stop)
        self.assertEqual(ctx.exception.status_code, 500)

    def test_update_limit_nonexistent_negative(self):
        """Negative: Updating limit for non-existent session must raise HTTPException 500."""
        req_limit = SpoofLimitRequest(session_id="invalid_session_id_999", speed_limit=50)
        res = update_spoof_limit(req_limit)
        self.assertFalse(res.get('success'))

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
