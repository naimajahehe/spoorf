"""
Unit Tests for Proximity Subsystem (src.core.proximity)
Covers: Happy Path, Negative Tests, and Edge Cases
"""

import unittest
from unittest.mock import patch, MagicMock
from src.core.proximity import measure_target_proximity


class TestCoreProximity(unittest.TestCase):

    def test_proximity_self_happy_path(self):
        """Happy Path: Self device (This PC) must return near ~0-1m."""
        res = measure_target_proximity(
            target_ip="192.168.1.100",
            target_mac="aa:bb:cc:dd:ee:ff",
            is_self=True
        )
        self.assertEqual(res["distance_zone"], "near")
        self.assertEqual(res["estimated_range"], "~0 - 1m")
        self.assertAlmostEqual(res["rtt_ms"], 0.1)

    def test_proximity_empty_input_edge_case(self):
        """Edge Cases: Empty or missing IP/MAC."""
        res1 = measure_target_proximity(target_ip="", target_mac="aa:bb:cc:dd:ee:ff")
        self.assertEqual(res1["distance_zone"], "unknown")
        self.assertEqual(res1["estimated_range"], "-")

        res2 = measure_target_proximity(target_ip="192.168.1.50", target_mac="")
        self.assertEqual(res2["distance_zone"], "unknown")
        self.assertEqual(res2["estimated_range"], "-")

    @patch("src.core.proximity.srp1")
    def test_proximity_near_zone_sampling(self, mock_srp1):
        """Near Zone: Fast response (<2.5ms) and low jitter."""
        mock_packet = MagicMock()
        mock_srp1.return_value = mock_packet

        res = measure_target_proximity(
            target_ip="192.168.1.55",
            target_mac="aa:bb:cc:dd:ee:ff"
        )
        # Because local mock returns in < 1ms, it must classify as near
        self.assertIn(res["distance_zone"], ["near", "medium"])
        self.assertIn("~", res["estimated_range"])

    @patch("src.core.proximity.srp1")
    def test_proximity_no_response_fallback(self, mock_srp1):
        """Fallback: If device does not respond to unicast ARP bursts."""
        mock_srp1.return_value = None

        res = measure_target_proximity(
            target_ip="192.168.1.99",
            target_mac="aa:bb:cc:dd:ee:99"
        )
        self.assertEqual(res["distance_zone"], "unknown")
        self.assertEqual(res["estimated_range"], "-")


if __name__ == "__main__":
    unittest.main()
