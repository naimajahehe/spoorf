import socket
import unittest
from contextlib import ExitStack
from unittest.mock import patch

from src.core.discovery.profile_observation import (
    MAX_PROFILE_WORKERS,
    ProfileCollectorUnavailableError,
    ProfileRefreshValidationError,
    _fresh_dhcp_snapshot,
    _reverse_dns,
    collect_profile_refresh,
)


class TestProfileObservation(unittest.TestCase):
    def _collector_patches(
        self,
        *,
        arp=None,
        ndp=None,
        dhcp_snapshots=None,
        multicast=None,
        assess=None,
    ):
        if arp is None:
            arp = {
                "192.168.1.1": "00:aa:bb:cc:dd:ee",
                "192.168.1.20": "00:07:ab:11:22:33",
            }
        if ndp is None:
            ndp = {
                "00:07:ab:11:22:33": {
                    "mac": "00:07:ab:11:22:33",
                    "link_local": "fe80::20",
                    "global": None,
                    "addresses": ["fe80::20"],
                }
            }
        if dhcp_snapshots is None:
            dhcp_snapshots = [{}, {}]
        if multicast is None:
            multicast = {
                "delivery": {
                    "attempted": 6,
                    "succeeded": 6,
                    "failed": 0,
                    "protocols": {},
                    "errors": [],
                },
                "ssdp": {},
                "mdns": {},
                "llmnr": {},
                "partial_failures": [],
            }

        stack = ExitStack()
        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.get_network_info",
                return_value={
                    "ip": "192.168.1.100",
                    "network": "192.168.1.0/24",
                    "gateway": "192.168.1.1",
                },
            )
        )
        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.get_current_gateway",
                return_value="192.168.1.1",
            )
        )
        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.get_self_mac",
                return_value="00:11:22:33:44:55",
            )
        )

        def fill_arp(result, **_kwargs):
            result.update(arp)

        def fill_ndp(result, **_kwargs):
            result.update(ndp)

        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.collect_from_arp_cache",
                side_effect=fill_arp,
            )
        )
        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.collect_from_ndp_cache",
                side_effect=fill_ndp,
            )
        )
        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.get_mac_from_arp",
                return_value=arp.get("192.168.1.1", ""),
            )
        )
        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.dhcp_cache.get_unique_snapshot",
                side_effect=dhcp_snapshots,
            )
        )
        multicast_mock = stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.collect_identity_multicast",
                return_value=multicast,
            )
        )
        stack.enter_context(
            patch("src.core.discovery.profile_observation.time.sleep")
        )
        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.query_netbios",
                return_value={"hostname": "", "workgroup": "", "user": ""},
            )
        )
        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation._reverse_dns",
                return_value="",
            )
        )
        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.verify_ipv6_alive",
                return_value=True,
            )
        )
        if assess is not None:
            stack.enter_context(
                patch(
                    "src.core.discovery.profile_observation.assess_device_profile",
                    side_effect=assess,
                )
            )
        return stack, multicast_mock

    def test_profile_refresh_collects_once_without_spoofing(self):
        targets = [{
            "ip": "192.168.1.20",
            "mac": "00:07:ab:11:22:33",
            "ipv6_addresses": ["fe80::20"],
        }]
        assessment = {
            "vendor": "Samsung",
            "device_type": "Smartphone / Tablet",
            "hostname": "Galaxy-A07",
            "os": "Android",
            "vendor_confidence": 94,
            "type_confidence": 96,
            "hostname_confidence": 90,
            "profile_status": "high",
            "profile_evidence": [],
            "profiled_at": "2026-09-04T08:00:00Z",
            "profile_version": 1,
        }
        stack, multicast = self._collector_patches(
            assess=lambda **_kwargs: assessment,
        )
        with stack, patch(
            "src.core.spoofer.ARPSpoofer.start"
        ) as arp_start, patch(
            "src.core.spoofer_v6.NDPSpoofer.start_spoof"
        ) as ndp_start, patch(
            "src.core.spoofer.sendp"
        ) as arp_sendp, patch(
            "src.core.spoofer_v6.sendp"
        ) as ndp_sendp:
            result = collect_profile_refresh(targets, observation_seconds=3)

        multicast.assert_called_once()
        arp_start.assert_not_called()
        ndp_start.assert_not_called()
        arp_sendp.assert_not_called()
        ndp_sendp.assert_not_called()
        self.assertEqual(result["high_confidence_count"], 1)
        self.assertEqual(result["visible_count"], 1)

    def test_profile_refresh_deduplicates_targets_by_normalized_mac(self):
        targets = [
            {
                "ip": "192.168.1.20",
                "mac": "00:07:AB:11:22:33",
                "ipv6_addresses": ["fe80::20"],
            },
            {
                "ip": "192.168.1.20",
                "mac": "00-07-ab-11-22-33",
                "ipv6_addresses": ["fe80::20"],
            },
        ]
        calls = []

        def assess(**kwargs):
            calls.append(kwargs)
            return {
                "vendor": "Unknown",
                "device_type": "Unknown",
                "hostname": "",
                "os": "Unknown",
                "vendor_confidence": 0,
                "type_confidence": 0,
                "hostname_confidence": 0,
                "profile_status": "unknown",
                "profile_evidence": [],
                "profiled_at": kwargs["observed_at"],
                "profile_version": 1,
            }

        stack, _ = self._collector_patches(assess=assess)
        with stack:
            result = collect_profile_refresh(targets, observation_seconds=3)

        self.assertEqual(len(calls), 1)
        self.assertEqual(len(result["devices"]), 1)
        self.assertEqual(result["devices"][0]["mac"], "00:07:ab:11:22:33")

    def test_profile_refresh_rejects_invalid_ipv4_mac_and_target_count(self):
        cases = [
            [{
                "ip": "203.0.113.20",
                "mac": "00:07:ab:11:22:33",
                "ipv6_addresses": [],
            }],
            [{
                "ip": "192.168.1.20",
                "mac": "not-a-mac",
                "ipv6_addresses": [],
            }],
            [
                {
                    "ip": "192.168.1.20",
                    "mac": f"00:07:ab:11:{index // 256:02x}:{index % 256:02x}",
                    "ipv6_addresses": [],
                }
                for index in range(301)
            ],
        ]
        for targets in cases:
            with self.subTest(target_count=len(targets)):
                stack, multicast = self._collector_patches()
                with stack, self.assertRaises(ProfileRefreshValidationError):
                    collect_profile_refresh(targets, observation_seconds=3)
                multicast.assert_not_called()

    def test_profile_refresh_rejects_controller_gateway_and_outside_cidr(self):
        cases = [
            ("192.168.1.100", "00:07:ab:11:22:33"),
            ("192.168.1.20", "00:11:22:33:44:55"),
            ("192.168.1.1", "00:07:ab:11:22:33"),
            ("192.168.1.20", "00:aa:bb:cc:dd:ee"),
            ("192.168.2.20", "00:07:ab:11:22:33"),
        ]
        for ip, mac in cases:
            with self.subTest(ip=ip, mac=mac):
                stack, multicast = self._collector_patches()
                with stack, self.assertRaises(ProfileRefreshValidationError):
                    collect_profile_refresh(
                        [{"ip": ip, "mac": mac, "ipv6_addresses": []}],
                        observation_seconds=3,
                    )
                multicast.assert_not_called()

    def test_profile_refresh_requires_observed_safe_ipv6_pair(self):
        cases = [
            ("2001:db8::20", {
                "00:07:ab:11:22:33": {
                    "addresses": ["2001:db8::20"],
                }
            }),
            ("fe80::20", {}),
            ("fd00::20", {
                "00:07:ab:11:22:34": {
                    "addresses": ["fd00::20"],
                }
            }),
        ]
        for ipv6, ndp in cases:
            with self.subTest(ipv6=ipv6):
                stack, multicast = self._collector_patches(ndp=ndp)
                with stack, self.assertRaises(ProfileRefreshValidationError):
                    collect_profile_refresh(
                        [{
                            "ip": "192.168.1.20",
                            "mac": "00:07:ab:11:22:33",
                            "ipv6_addresses": [ipv6],
                        }],
                        observation_seconds=3,
                    )
                multicast.assert_not_called()

    def test_profile_refresh_ignores_dhcp_evidence_older_than_five_minutes(self):
        stale = {
            "c2:4e:ca:88:04:2d": {
                "mac": "c2:4e:ca:88:04:2d",
                "ip": "192.168.1.20",
                "hostname": "Galaxy-Stale",
                "vendor_class": "android-dhcp-14",
                "last_seen_ts": 600.0,
            }
        }
        arp = {
            "192.168.1.1": "00:aa:bb:cc:dd:ee",
            "192.168.1.20": "c2:4e:ca:88:04:2d",
        }
        stack, _ = self._collector_patches(
            arp=arp,
            ndp={},
            dhcp_snapshots=[stale, stale],
        )
        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.time.time",
                side_effect=[1000.0, 1000.0, 1000.1],
            )
        )
        with stack:
            result = collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "c2:4e:ca:88:04:2d",
                    "ipv6_addresses": [],
                }],
                observation_seconds=3,
            )

        self.assertEqual(result["devices"][0]["hostname"], "Unknown")
        self.assertEqual(result["hostname_count"], 0)
        self.assertNotIn("DHCP", result["sources"])

    def test_profile_refresh_preserves_fresh_current_cache_evidence(self):
        fresh = {
            "c2:4e:ca:88:04:2d": {
                "mac": "c2:4e:ca:88:04:2d",
                "ip": "192.168.1.20",
                "hostname": "Galaxy-Current",
                "vendor_class": "android-dhcp-14",
                "last_seen_ts": 900.0,
            }
        }
        arp = {
            "192.168.1.1": "00:aa:bb:cc:dd:ee",
            "192.168.1.20": "c2:4e:ca:88:04:2d",
        }
        stack, _ = self._collector_patches(
            arp=arp,
            ndp={},
            dhcp_snapshots=[fresh, fresh],
        )
        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.time.time",
                side_effect=[1000.0, 1000.0, 1000.1],
            )
        )
        with stack:
            result = collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "c2:4e:ca:88:04:2d",
                    "ipv6_addresses": [],
                }],
                observation_seconds=3,
            )

        self.assertEqual(result["devices"][0]["hostname"], "Galaxy-Current")
        self.assertEqual(result["sources"]["DHCP"], 1)

    def test_profile_refresh_does_not_count_static_oui_as_visibility(self):
        arp = {"192.168.1.1": "00:aa:bb:cc:dd:ee"}
        stack, _ = self._collector_patches(
            arp=arp,
            ndp={},
            dhcp_snapshots=[{}, {}],
        )
        with stack:
            result = collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "00:07:ab:11:22:33",
                    "ipv6_addresses": [],
                }],
                observation_seconds=3,
            )

        self.assertEqual(result["visible_count"], 0)
        self.assertFalse(result["devices"][0]["visible"])

    def test_profile_refresh_reports_partial_sensor_failure(self):
        multicast = {
            "delivery": {
                "attempted": 6,
                "succeeded": 5,
                "failed": 1,
                "protocols": {"ssdp_ipv6": False},
                "errors": [{"protocol": "ssdp_ipv6", "error": "unavailable"}],
            },
            "ssdp": {},
            "mdns": {},
            "llmnr": {},
            "partial_failures": [{
                "sensor": "ssdp_ipv6",
                "error": "unavailable",
            }],
        }
        stack, _ = self._collector_patches(multicast=multicast)
        with stack:
            result = collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "00:07:ab:11:22:33",
                    "ipv6_addresses": ["fe80::20"],
                }],
                observation_seconds=3,
            )

        self.assertEqual(len(result["devices"]), 1)
        self.assertIn(
            {"sensor": "ssdp_ipv6", "error": "unavailable"},
            result["partial_failures"],
        )

    def test_profile_refresh_uses_validated_ipv6_multicast_evidence(self):
        captured = {}

        def assess(**kwargs):
            captured.update(kwargs)
            return {
                "vendor": "Unknown",
                "device_type": "Unknown",
                "hostname": kwargs["netbios_info"].get("hostname", ""),
                "os": "Unknown",
                "vendor_confidence": 0,
                "type_confidence": 0,
                "hostname_confidence": 0,
                "profile_status": "unknown",
                "profile_evidence": [],
                "profiled_at": kwargs["observed_at"],
                "profile_version": 1,
            }

        multicast = {
            "delivery": {"attempted": 6, "succeeded": 6, "failed": 0},
            "ssdp": {
                "192.168.1.20": {"server": "IPv4 server"},
                "fe80::20": {"friendly_name": "IPv6 television"},
            },
            "mdns": {
                "192.168.1.20": {"hostname": "Living-Room"},
                "fe80::20": {"model": "Samsung"},
            },
            "llmnr": {"fe80::20": {"hostname": "IPV6-HOST"}},
            "partial_failures": [],
        }
        stack, _ = self._collector_patches(
            multicast=multicast,
            assess=assess,
        )
        with stack:
            collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "00:07:ab:11:22:33",
                    "ipv6_addresses": ["fe80::20"],
                }],
                observation_seconds=3,
            )

        self.assertEqual(captured["ssdp_info"]["server"], "IPv4 server")
        self.assertEqual(
            captured["ssdp_info"]["friendly_name"],
            "IPv6 television",
        )
        self.assertEqual(captured["mdns_info"]["hostname"], "Living-Room")
        self.assertEqual(captured["mdns_info"]["model"], "Samsung")
        self.assertEqual(captured["netbios_info"]["hostname"], "IPV6-HOST")

    def test_profile_refresh_zero_multicast_delivery_uses_live_arp_fallback(self):
        multicast = {
            "delivery": {
                "attempted": 6,
                "succeeded": 0,
                "failed": 6,
                "protocols": {},
                "errors": [{"protocol": "ssdp_ipv4", "error": "no route"}],
            },
            "ssdp": {},
            "mdns": {},
            "llmnr": {},
            "partial_failures": [{
                "sensor": "ssdp_ipv4",
                "error": "no route",
            }],
        }
        stack, _ = self._collector_patches(multicast=multicast)
        with stack:
            result = collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "00:07:ab:11:22:33",
                    "ipv6_addresses": ["fe80::20"],
                }],
                observation_seconds=3,
            )

        self.assertEqual(result["visible_count"], 1)
        self.assertIn("ARP", result["devices"][0]["observed_sources"])
        self.assertIn(
            {"sensor": "ssdp_ipv4", "error": "no route"},
            result["partial_failures"],
        )

    def test_profile_refresh_zero_multicast_delivery_uses_ndp_fallback(self):
        multicast = {
            "delivery": {"attempted": 6, "succeeded": 0, "failed": 6},
            "ssdp": {},
            "mdns": {},
            "llmnr": {},
            "partial_failures": [],
        }
        stack, _ = self._collector_patches(
            arp={"192.168.1.1": "00:aa:bb:cc:dd:ee"},
            multicast=multicast,
        )
        with stack:
            result = collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "00:07:ab:11:22:33",
                    "ipv6_addresses": ["fe80::20"],
                }],
                observation_seconds=3,
            )

        self.assertEqual(result["visible_count"], 1)
        self.assertIn("NDP", result["devices"][0]["observed_sources"])

    def test_profile_refresh_zero_multicast_delivery_uses_fresh_dhcp_fallback(self):
        fresh = {
            "c2:4e:ca:88:04:2d": {
                "mac": "c2:4e:ca:88:04:2d",
                "ip": "192.168.1.20",
                "hostname": "Galaxy-Renewed",
                "last_seen_ts": 900.0,
            }
        }
        multicast = {
            "delivery": {"attempted": 6, "succeeded": 0, "failed": 6},
            "ssdp": {},
            "mdns": {},
            "llmnr": {},
            "partial_failures": [],
        }
        stack, _ = self._collector_patches(
            arp={"192.168.1.1": "00:aa:bb:cc:dd:ee"},
            ndp={},
            dhcp_snapshots=[fresh, fresh],
            multicast=multicast,
        )
        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.time.time",
                side_effect=[1000.0, 1000.0, 1000.1],
            )
        )
        with stack:
            result = collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "c2:4e:ca:88:04:2d",
                    "ipv6_addresses": [],
                }],
                observation_seconds=3,
            )

        self.assertEqual(result["visible_count"], 1)
        self.assertIn("DHCP", result["devices"][0]["observed_sources"])

    def test_profile_refresh_rejects_true_total_collector_failure(self):
        multicast = {
            "delivery": {
                "attempted": 6,
                "succeeded": 0,
                "failed": 6,
                "protocols": {},
                "errors": [],
            },
            "ssdp": {},
            "mdns": {},
            "llmnr": {},
            "partial_failures": [],
        }
        stack, _ = self._collector_patches(
            arp={"192.168.1.1": "00:aa:bb:cc:dd:ee"},
            ndp={},
            dhcp_snapshots=[{}, {}],
            multicast=multicast,
        )
        with stack, self.assertRaises(ProfileCollectorUnavailableError):
            collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "00:07:ab:11:22:33",
                    "ipv6_addresses": [],
                }],
                observation_seconds=3,
            )

    def test_profile_refresh_records_sanitized_arp_cache_failure(self):
        stack, _ = self._collector_patches()
        error = OSError("arp\r\ncache\x00 failed")
        with stack, patch(
            "src.core.discovery.profile_observation.collect_from_arp_cache",
            side_effect=error,
        ) as collect_arp:
            result = collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "00:07:ab:11:22:33",
                    "ipv6_addresses": [],
                }],
                observation_seconds=3,
            )

        collect_arp.assert_called_once_with({}, strict=True)
        self.assertIn(
            {"sensor": "arp_cache", "error": "arp cache failed"},
            result["partial_failures"],
        )

    def test_profile_refresh_records_sanitized_ndp_cache_failure(self):
        stack, _ = self._collector_patches()
        with stack, patch(
            "src.core.discovery.profile_observation.collect_from_ndp_cache",
            side_effect=OSError("ndp\ncache failed"),
        ) as collect_ndp:
            result = collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "00:07:ab:11:22:33",
                    "ipv6_addresses": [],
                }],
                observation_seconds=3,
            )

        collect_ndp.assert_called_once_with({}, strict=True)
        self.assertIn(
            {"sensor": "ndp_cache", "error": "ndp cache failed"},
            result["partial_failures"],
        )

    def test_profile_refresh_records_nonzero_ndp_command_and_keeps_arp_evidence(self):
        from src.core.discovery.ipv6_ndp import (
            collect_from_ndp_cache as real_collect_from_ndp_cache,
        )

        stack, _ = self._collector_patches()
        failed_result = unittest.mock.MagicMock(
            returncode=87,
            stdout="",
            stderr="Bad\r\n parameter\x00" + ("!" * 400),
        )
        with stack, patch(
            "src.core.discovery.profile_observation.collect_from_ndp_cache",
            side_effect=real_collect_from_ndp_cache,
        ) as collect_ndp, patch(
            "src.core.discovery.ipv6_ndp.subprocess.run",
            return_value=failed_result,
        ), patch("sys.platform", "win32"):
            result = collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "00:07:ab:11:22:33",
                    "ipv6_addresses": [],
                }],
                observation_seconds=3,
            )

        collect_ndp.assert_called_once_with({}, strict=True)
        self.assertEqual(result["visible_count"], 1)
        self.assertIn("ARP", result["devices"][0]["observed_sources"])
        failure = next(
            item for item in result["partial_failures"]
            if item["sensor"] == "ndp_cache"
        )
        self.assertIn("netsh failed with exit code 87: Bad parameter", failure["error"])
        self.assertNotIn("\r", failure["error"])
        self.assertNotIn("\n", failure["error"])
        self.assertNotIn("\x00", failure["error"])
        self.assertLessEqual(len(failure["error"]), 200)

    def test_profile_refresh_records_sanitized_netbios_failure(self):
        stack, _ = self._collector_patches()
        with stack, patch(
            "src.core.discovery.profile_observation.query_netbios",
            side_effect=OSError("netbios\tfailed"),
        ) as netbios:
            result = collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "00:07:ab:11:22:33",
                    "ipv6_addresses": [],
                }],
                observation_seconds=3,
            )

        netbios.assert_called_once_with("192.168.1.20", strict=True)
        self.assertIn(
            {
                "sensor": "netbios",
                "target": "192.168.1.20",
                "error": "netbios failed",
            },
            result["partial_failures"],
        )

    def test_profile_refresh_records_sanitized_reverse_dns_failure(self):
        stack, _ = self._collector_patches()
        with stack, patch(
            "src.core.discovery.profile_observation._reverse_dns",
            side_effect=OSError("dns\r\nfailed"),
        ) as reverse_dns:
            result = collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "00:07:ab:11:22:33",
                    "ipv6_addresses": [],
                }],
                observation_seconds=3,
            )

        reverse_dns.assert_called_once_with("192.168.1.20", strict=True)
        self.assertIn(
            {
                "sensor": "reverse_dns",
                "target": "192.168.1.20",
                "error": "dns failed",
            },
            result["partial_failures"],
        )

    def test_profile_refresh_records_sanitized_ipv6_liveness_failure(self):
        stack, _ = self._collector_patches()
        with stack, patch(
            "src.core.discovery.profile_observation.verify_ipv6_alive",
            side_effect=OSError("ndp\r\nprobe failed"),
        ) as liveness:
            result = collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "00:07:ab:11:22:33",
                    "ipv6_addresses": ["fe80::20"],
                }],
                observation_seconds=3,
            )

        liveness.assert_called_once_with(
            "00:07:ab:11:22:33",
            "fe80::20",
            self_mac="00:11:22:33:44:55",
            timeout=0.35,
            retries=0,
            strict=True,
        )
        self.assertIn(
            {
                "sensor": "ipv6_liveness",
                "target": "fe80::20",
                "error": "ndp probe failed",
            },
            result["partial_failures"],
        )

    def test_reverse_dns_strict_mode_preserves_default_compatibility(self):
        with patch(
            "src.core.discovery.profile_observation.socket.gethostbyaddr",
            side_effect=OSError("resolver unavailable"),
        ):
            self.assertEqual(_reverse_dns("192.168.1.20"), "")
            with self.assertRaisesRegex(OSError, "resolver unavailable"):
                _reverse_dns("192.168.1.20", strict=True)

    def test_dhcp_renewal_advances_freshness_timestamp_and_then_expires(self):
        from src.core.discovery.dhcp import DHCPDiscoveredCache

        cache = DHCPDiscoveredCache()
        mac = "02:aa:bb:cc:dd:ee"
        with patch(
            "src.core.discovery.dhcp.time.time",
            side_effect=[100.0, 500.0],
        ):
            cache.update(
                mac,
                "192.168.1.20",
                {"hostname": "Renewing-Host"},
            )
            first_seen = cache.get(mac)["last_seen_ts"]
            cache.update(
                mac,
                "192.168.1.20",
                {"hostname": "", "message_type": "RENEW"},
            )

        renewed = cache.get_unique_snapshot()
        self.assertEqual(first_seen, 100.0)
        self.assertEqual(renewed[mac]["last_seen_ts"], 500.0)
        self.assertIn(mac, _fresh_dhcp_snapshot(renewed, 800.0))
        self.assertNotIn(mac, _fresh_dhcp_snapshot(renewed, 800.1))

    def test_profile_refresh_uses_bounded_worker_pool(self):
        created_worker_counts = []

        class ImmediateFuture:
            def __init__(self, value):
                self._value = value

            def result(self):
                return self._value

        class ImmediateExecutor:
            def __init__(self, max_workers):
                created_worker_counts.append(max_workers)

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def submit(self, function, *args, **kwargs):
                return ImmediateFuture(function(*args, **kwargs))

        stack, _ = self._collector_patches()
        stack.enter_context(
            patch(
                "src.core.discovery.profile_observation.ThreadPoolExecutor",
                ImmediateExecutor,
            )
        )
        with stack:
            collect_profile_refresh(
                [{
                    "ip": "192.168.1.20",
                    "mac": "00:07:ab:11:22:33",
                    "ipv6_addresses": ["fe80::20"],
                }],
                observation_seconds=3,
            )

        self.assertEqual(created_worker_counts, [MAX_PROFILE_WORKERS])


if __name__ == "__main__":
    unittest.main()
