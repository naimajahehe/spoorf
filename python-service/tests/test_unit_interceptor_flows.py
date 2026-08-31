#!/usr/bin/env python3
"""
Unit Tests for L7FlowManager (Layer 7 Flow Lifecycle & Filters)
==============================================================
Governed by: docs/specs/SPEC-012_L7_INTERCEPTION_AND_MITMPROXY.md
Invariants:
- Thread-safe flow recording and deque capacity bounds.
- Structured filter queries (by search query, scheme, method, blocked flag).
- Accurate stats aggregation.
"""

import unittest
from src.core.interceptor.flow import L7Flow, L7FlowManager


class TestL7FlowManager(unittest.TestCase):

    def setUp(self):
        self.broadcast_events = []
        self.manager = L7FlowManager(
            max_history=5,
            on_flow_broadcast=lambda f: self.broadcast_events.append(f)
        )

    def test_record_flow_happy_path(self):
        """Verify recording flow and broadcast callback triggering."""
        flow = self.manager.record_flow(
            client_ip="192.168.1.55",
            host="api.github.com",
            scheme="https",
            method="GET",
            path="/user",
            status_code=200,
            duration_ms=35.2
        )

        self.assertEqual(flow.client_ip, "192.168.1.55")
        self.assertEqual(flow.host, "api.github.com")
        self.assertEqual(len(self.broadcast_events), 1)
        self.assertEqual(self.broadcast_events[0]["host"], "api.github.com")

    def test_flow_capacity_bounding(self):
        """Verify that circular buffer does not exceed max_history."""
        for i in range(10):
            self.manager.record_flow(
                client_ip=f"192.168.1.{i}",
                host=f"site{i}.com"
            )

        flows = self.manager.get_flows(limit=100)
        self.assertEqual(len(flows), 5)
        # Verify latest is at front
        self.assertEqual(flows[0]["host"], "site9.com")

    def test_filter_by_search_and_scheme(self):
        """Verify searching by keyword and filtering by scheme."""
        self.manager.record_flow(client_ip="192.168.1.10", host="google.com", scheme="https", method="GET")
        self.manager.record_flow(client_ip="192.168.1.20", host="facebook.com", scheme="https", method="POST")
        self.manager.record_flow(client_ip="192.168.1.30", host="google.com", scheme="dns", method="QUERY")

        # Search google
        google_flows = self.manager.get_flows(search="google")
        self.assertEqual(len(google_flows), 2)

        # Filter https only
        https_flows = self.manager.get_flows(scheme="https")
        self.assertEqual(len(https_flows), 2)

        # Filter POST only
        post_flows = self.manager.get_flows(method="POST")
        self.assertEqual(len(post_flows), 1)
        self.assertEqual(post_flows[0]["host"], "facebook.com")

    def test_stats_aggregation(self):
        """Verify accurate calculation of flow statistics."""
        self.manager.record_flow(client_ip="192.168.1.10", host="a.com", scheme="https", is_blocked=False)
        self.manager.record_flow(client_ip="192.168.1.11", host="ad.doubleclick.net", scheme="https", is_blocked=True)
        self.manager.record_flow(client_ip="192.168.1.12", host="b.com", scheme="http", is_blocked=False)
        self.manager.record_flow(client_ip="192.168.1.13", host="c.com", scheme="dns", is_blocked=False)

        stats = self.manager.get_stats()
        self.assertEqual(stats["total_flows"], 4)
        self.assertEqual(stats["blocked_flows"], 1)
        self.assertEqual(stats["https_flows"], 2)
        self.assertEqual(stats["http_flows"], 1)
        self.assertEqual(stats["dns_flows"], 1)

    def test_clear_flows(self):
        """Verify clearing flows resets history and stats."""
        self.manager.record_flow(client_ip="192.168.1.10", host="a.com")
        self.manager.clear()
        self.assertEqual(len(self.manager.get_flows()), 0)
        self.assertEqual(self.manager.get_stats()["total_flows"], 0)


if __name__ == "__main__":
    unittest.main()
