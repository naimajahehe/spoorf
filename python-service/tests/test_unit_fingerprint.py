"""
Unit Tests for Fingerprinting Subsystem (src.core.fingerprint)
Covers: Happy Path, Negative Tests, and Edge Cases
"""

import unittest
from unittest.mock import patch
from src.core.fingerprint import (
    assess_device_profile,
    canonicalize_vendor,
    is_randomized_mac,
    get_vendor,
    detect_os,
    detect_device_type,
    synthesize_ensemble_profile
)
from src.core.fingerprint.oui_registry import OUIRegistry, OUIRecord

class TestCoreFingerprint(unittest.TestCase):

    # ===== 1. is_randomized_mac =====
    def test_randomized_mac_happy_path(self):
        """Happy Path: Locally Administered MACs (second character: 2, 6, A, E)."""
        self.assertTrue(is_randomized_mac("02:11:22:33:44:55"))
        self.assertTrue(is_randomized_mac("c2:4e:ca:88:04:2d")) # Infinix randomized
        self.assertTrue(is_randomized_mac("a6:00:11:22:33:44"))
        self.assertTrue(is_randomized_mac("fa:bb:cc:dd:ee:ff"))
        self.assertTrue(is_randomized_mac("3e:12:34:56:78:90"))

    def test_randomized_mac_negative(self):
        """Negative Tests: Globally unique hardware factory MACs (OUI)."""
        self.assertFalse(is_randomized_mac("00:11:22:33:44:55")) # '0' -> false
        self.assertFalse(is_randomized_mac("a8:3b:76:0c:dc:55")) # '8' -> false
        self.assertFalse(is_randomized_mac("14:cc:20:00:11:22")) # '4' -> false
        self.assertFalse(is_randomized_mac("ac:bc:32:00:00:00")) # 'c' -> false

    def test_randomized_mac_edge_cases(self):
        """Edge Cases: Empty, None, Malformed short strings."""
        self.assertFalse(is_randomized_mac(""))
        self.assertFalse(is_randomized_mac(None))
        self.assertFalse(is_randomized_mac("x"))

    # ===== 2. get_vendor =====
    def test_get_vendor_happy_path(self):
        """Happy Path: Brand resolution from known OUI database."""
        self.assertEqual(get_vendor("00:03:93:11:22:33"), "Apple")
        self.assertEqual(get_vendor("00:07:ab:00:00:00"), "Samsung")
        self.assertEqual(get_vendor("00:9e:c8:aa:bb:cc"), "Xiaomi")
        self.assertEqual(get_vendor("28:bb:b2:00:11:22"), "Infinix")
        self.assertEqual(get_vendor("18:fe:34:11:22:33"), "Espressif (ESP8266/ESP32)")
        self.assertEqual(get_vendor("14:cc:20:00:11:22"), "TP-Link")

    def test_get_vendor_gateway_fallback(self):
        """Gateway flag returns Router / Gateway."""
        self.assertEqual(get_vendor("ff:ff:ff:00:00:00", is_gateway=True), "Router / Gateway")

    def test_get_vendor_edge_cases(self):
        """Edge cases: Empty MAC, unknown MAC, randomized MAC label."""
        self.assertEqual(get_vendor(""), "Unknown")
        self.assertEqual(get_vendor("c2:4e:ca:88:04:2d"), "Private Device (Randomized MAC)")
        self.assertEqual(get_vendor("99:88:77:66:55:44"), "Generic Device")

    @patch("src.core.fingerprint.vendors.get_oui_record")
    def test_get_vendor_uses_registry_hit(self, mock_get_oui_record):
        """Registry hits should return the organization name before generic fallback."""
        mock_get_oui_record.return_value = OUIRecord(
            organization="Example Networks",
            assignment="001122",
            prefix_bits=24
        )
        self.assertEqual(get_vendor("00:11:22:33:44:55"), "Example Networks")

    @patch("src.core.fingerprint.vendors.get_oui_record")
    def test_get_vendor_does_not_match_acer_inside_kronback_tracers(self, mock_get_oui_record):
        mock_get_oui_record.return_value = OUIRecord(
            organization="Kronback Tracers",
            assignment="001122",
            prefix_bits=24,
        )

        self.assertEqual(get_vendor("00:11:22:33:44:55"), "Kronback Tracers")

    @patch("src.core.fingerprint.vendors.get_oui_record")
    def test_get_vendor_does_not_match_acer_inside_apacer(self, mock_get_oui_record):
        mock_get_oui_record.return_value = OUIRecord(
            organization="Apacer Technology Inc.",
            assignment="001122",
            prefix_bits=24,
        )

        self.assertEqual(get_vendor("00:11:22:33:44:55"), "Apacer Technology Inc.")

    @patch("src.core.fingerprint.vendors.get_oui_record")
    def test_get_vendor_does_not_match_intel_inside_intelligent(self, mock_get_oui_record):
        mock_get_oui_record.return_value = OUIRecord(
            organization="Intelligent Technology Co., Ltd.",
            assignment="001122",
            prefix_bits=24,
        )

        self.assertEqual(
            get_vendor("00:11:22:33:44:55"),
            "Intelligent Technology Co., Ltd.",
        )

    @patch("src.core.fingerprint.vendors.get_oui_record")
    def test_get_vendor_preserves_intended_aliases(self, mock_get_oui_record):
        aliases = (
            ("Apple Computer, Inc.", "Apple"),
            ("Samsung Electronics Co., Ltd.", "Samsung"),
            ("TP-Link Corporation Limited", "TP-Link"),
        )

        for organization, expected in aliases:
            with self.subTest(organization=organization):
                mock_get_oui_record.return_value = OUIRecord(
                    organization=organization,
                    assignment="001122",
                    prefix_bits=24,
                )
                self.assertEqual(get_vendor("00:11:22:33:44:55"), expected)

    @patch("src.core.fingerprint.vendors.get_oui_record")
    def test_get_vendor_prefers_specific_multi_token_alias(self, mock_get_oui_record):
        mock_get_oui_record.return_value = OUIRecord(
            organization="Cisco Meraki LLC",
            assignment="001122",
            prefix_bits=24,
        )

        with patch(
            "src.core.fingerprint.vendors._VENDOR_ALIASES",
            (("cisco meraki", "Cisco Meraki"), ("cisco", "Cisco")),
        ):
            self.assertEqual(get_vendor("00:11:22:33:44:55"), "Cisco Meraki")

    def test_oui_registry_prefers_longest_registered_prefix(self):
        """Registry lookup should prefer MA-S over MA-M over MA-L."""
        registry = OUIRegistry.from_mapping({
            "24": {"001122": "Example Networks"},
            "28": {"0011223": "Example Mobile"},
            "36": {"001122334": "Example Camera"},
        })

        self.assertEqual(
            registry.lookup("00:11:22:33:4a:bc").organization,
            "Example Camera",
        )
        self.assertEqual(
            registry.lookup("00:11:22:3f:aa:bb").organization,
            "Example Mobile",
        )
        self.assertEqual(
            registry.lookup("00:11:22:ff:aa:bb").organization,
            "Example Networks",
        )

    def test_oui_registry_never_resolves_randomized_mac(self):
        """Locally administered MACs must never resolve through the OUI registry."""
        registry = OUIRegistry.from_mapping({
            "24": {"021122": "Must Not Match"},
            "28": {},
            "36": {},
        })
        self.assertIsNone(registry.lookup("02:11:22:33:44:55"))
        self.assertIsNone(registry.lookup("not-a-mac"))

    # ===== 3. detect_os =====
    def test_detect_os_happy_path(self):
        """Happy path: Windows, Android, Apple, and Linux detection."""
        # Windows via TTL 128 and port 445 (SMB)
        win = detect_os({'alive': True, 'ttl': 128}, {445: 'SMB'}, "Dell", "WIN-DESKTOP", False)
        self.assertEqual(win, "Windows")

        # Android via vendor and TTL 64
        android = detect_os({'alive': True, 'ttl': 64}, {}, "Samsung", "Galaxy-S21", False)
        self.assertEqual(android, "Android")

        # Apple iOS via vendor
        apple = detect_os({'alive': True, 'ttl': 64}, {}, "Apple", "iPhone-13", False)
        self.assertEqual(apple, "iOS (Apple)")

        # Gateway OS
        gw_os = detect_os({'alive': True, 'ttl': 64}, {}, "MikroTik", "Router", True)
        self.assertEqual(gw_os, "Linux / RouterOS")

    def test_detect_os_edge_cases(self):
        """Edge cases: Empty inputs, extreme TTLs, unknown hosts."""
        unknown = detect_os({'alive': False, 'ttl': 0}, {}, "", "", False)
        self.assertEqual(unknown, "Unknown OS")
        extreme = detect_os({'alive': True, 'ttl': 255}, {}, "Unknown", "", False)
        self.assertEqual(extreme, "Unknown OS")

    # ===== 4. detect_device_type =====
    def test_detect_device_type_happy_path(self):
        """Happy path: Category classification."""
        self.assertEqual(detect_device_type(True, "TP-Link", "Gateway", "Linux", {}), "Router / Gateway")
        self.assertEqual(detect_device_type(False, "Samsung", "Galaxy-S21", "Android", {}), "Android / iOS (Mobile)")
        self.assertEqual(detect_device_type(False, "Lenovo", "Laptop-ThinkPad", "Windows", {}), "PC / Laptop")
        self.assertEqual(detect_device_type(False, "Espressif", "ESP32-Lamp", "", {}), "IoT / Smart Home")

    def test_detect_device_type_edge_cases(self):
        """Edge cases: Blank strings fallback to Generic Client Device."""
        self.assertEqual(detect_device_type(False, "", "", "", {}), "Generic Client Device")

    # ===== 5. synthesize_ensemble_profile =====
    def test_ensemble_synthesis_dhcp_precedence(self):
        """Verify DHCP hostname and fingerprint override generic values."""
        dhcp_map = {
            "aa:bb:cc:dd:ee:ff": {
                "hostname": "Infinix-HOT-10",
                "vendor_class": "android-dhcp-9",
                "dhcp_fingerprint": "Android OS Signature"
            }
        }
        host, vendor, os_name, dev_type = synthesize_ensemble_profile(
            ip="192.168.1.50",
            norm_mac="aa:bb:cc:dd:ee:ff",
            is_gateway=False,
            vendor="Generic Device",
            hostname="",
            nb_info={},
            ping_info={'alive': True, 'ttl': 64},
            open_ports={},
            http_info={},
            dhcp_discovered=dhcp_map,
            ssdp_discovered={},
            mdns_discovered={}
        )
        self.assertEqual(host, "Infinix-HOT-10")
        self.assertEqual(os_name, "Android OS")
        self.assertEqual(dev_type, "Smartphone / Tablet")

    def test_extract_mobile_brand_from_hostname_patterns(self):
        """Happy & Edge: Brand keyword extraction with negative lookahead guard."""
        from src.core.fingerprint.ensemble import extract_mobile_brand_from_hostname

        # Positive mobile brands
        self.assertEqual(extract_mobile_brand_from_hostname("Galaxy-A52"), "Samsung Mobile")
        self.assertEqual(extract_mobile_brand_from_hostname("Redmi-Note-11"), "Xiaomi Mobile")
        self.assertEqual(extract_mobile_brand_from_hostname("POCO-X3-Pro"), "Xiaomi Mobile")
        self.assertEqual(extract_mobile_brand_from_hostname("Infinix-Smart-6"), "Infinix Mobile")
        self.assertEqual(extract_mobile_brand_from_hostname("vivo-1904"), "Vivo Mobile")
        self.assertEqual(extract_mobile_brand_from_hostname("OPPO-Reno-7"), "OPPO Mobile")
        self.assertEqual(extract_mobile_brand_from_hostname("iPhone-14-Pro"), "Apple iOS (Mobile)")

        # Negative lookahead guards: PC, Laptop, Vivobook, Smart TV MUST return None!
        self.assertIsNone(extract_mobile_brand_from_hostname("DESKTOP-VIVOBOOK"))
        self.assertIsNone(extract_mobile_brand_from_hostname("Asus-Vivobook-15"))
        self.assertIsNone(extract_mobile_brand_from_hostname("Samsung-QLED-TV"))
        self.assertIsNone(extract_mobile_brand_from_hostname("Galaxy-Book-Laptop"))
        self.assertIsNone(extract_mobile_brand_from_hostname("Work-PC-Desktop"))

    def test_ensemble_synthesis_asus_vivobook_guard(self):
        """Edge Case: Asus Vivobook with port 445 must be classified as Windows PC, never Vivo phone!"""
        host, vendor, os_name, dev_type = synthesize_ensemble_profile(
            ip="192.168.1.110",
            norm_mac="c2:4e:ca:88:04:2d", # Randomized MAC
            is_gateway=False,
            vendor="Generic Device",
            hostname="DESKTOP-VIVOBOOK",
            nb_info={},
            ping_info={'alive': True, 'ttl': 128}, # Windows TTL
            open_ports={445: 'microsoft-ds'},      # SMB port open
            http_info={},
            dhcp_discovered={},
            ssdp_discovered={},
            mdns_discovered={}
        )
        self.assertEqual(os_name, "Windows")
        self.assertEqual(dev_type, "PC / Laptop")
        self.assertNotEqual(vendor, "Vivo Mobile")

    def test_ensemble_synthesis_smart_tv_disambiguation(self):
        """Edge Case: Samsung TV must be classified as Smart TV, never Mobile phone!"""
        host, vendor, os_name, dev_type = synthesize_ensemble_profile(
            ip="192.168.1.115",
            norm_mac="c2:4e:ca:88:04:2e",
            is_gateway=False,
            vendor="Generic Device",
            hostname="Samsung-QLED-TV",
            nb_info={},
            ping_info={'alive': True, 'ttl': 64},
            open_ports={},
            http_info={},
            dhcp_discovered={},
            ssdp_discovered={},
            mdns_discovered={}
        )
        self.assertEqual(dev_type, "Smart TV / Multimedia")
        self.assertEqual(vendor, "Samsung")

    # ===== 6. explainable profile assessment =====
    def _assess(self, **overrides):
        inputs = {
            "ip": "192.168.1.200",
            "mac": "c2:4e:ca:88:04:2d",
            "is_gateway": False,
            "dhcp_info": {},
            "mdns_info": {},
            "ssdp_info": {},
            "netbios_info": {},
            "reverse_dns": "",
            "ttl": None,
            "open_ports": [],
            "services": [],
            "ipv6_info": {},
            "observed_at": "2026-09-04T08:00:00Z",
        }
        inputs.update(overrides)
        return assess_device_profile(**inputs)

    def test_profile_assessment_combines_independent_samsung_phone_evidence(self):
        result = self._assess(
            ip="192.168.1.20",
            mac="00:07:ab:11:22:33",
            dhcp_info={"hostname": "Galaxy-A07", "vendor_class": "android-dhcp-14"},
            mdns_info={"hostname": "Galaxy-A07.local", "model": "SM-A055F"},
            ttl=64,
            ipv6_info={"addresses": ["fe80::20"]},
        )

        self.assertEqual(result["vendor"], "Samsung")
        self.assertEqual(result["device_type"], "Smartphone / Tablet")
        self.assertEqual(result["profile_status"], "high")
        self.assertGreaterEqual(result["vendor_confidence"], 80)
        self.assertGreaterEqual(result["type_confidence"], 80)

    def test_vendor_canonicalization_preserves_unmapped_explicit_manufacturer(self):
        self.assertEqual(
            canonicalize_vendor("Example Networks Incorporated"),
            "Example Networks Incorporated",
        )

    def test_profile_assessment_keeps_randomized_silent_device_unknown(self):
        result = self._assess(ip="192.168.1.21")

        self.assertEqual(result["vendor"], "Unknown")
        self.assertEqual(result["device_type"], "Unknown")
        self.assertEqual(result["profile_status"], "unknown")

    def test_profile_assessment_does_not_promote_single_mdns_hostname_to_high(self):
        result = self._assess(
            mdns_info={"hostname": "Galaxy-Solo.local"},
            ttl=64,
        )

        self.assertEqual(result["vendor"], "Samsung")
        self.assertEqual(result["device_type"], "Smartphone / Tablet")
        self.assertNotEqual(result["profile_status"], "high")

    def test_profile_assessment_does_not_treat_intel_oui_as_laptop_brand(self):
        result = self._assess(
            ip="192.168.1.22",
            mac="00:02:b3:11:22:33",
            netbios_info={"hostname": "DESKTOP-58NKETL"},
            reverse_dns="DESKTOP-58NKETL",
            ttl=128,
            open_ports=[445],
            services=["SMB"],
        )

        self.assertEqual(result["device_type"], "PC / Laptop")
        self.assertNotEqual(result["vendor"], "Intel")
        self.assertNotEqual(result["profile_status"], "high")

    def test_profile_assessment_withholds_high_confidence_on_conflicting_explicit_identities(self):
        result = self._assess(
            ssdp_info={
                "manufacturer": "Apple Inc.",
                "model_name": "Apple TV 4K",
                "friendly_name": "Living Room TV",
            },
            mdns_info={
                "manufacturer": "Samsung Electronics",
                "model": "SM-S928B",
                "hostname": "Galaxy-S24.local",
            },
            ttl=64,
        )

        self.assertEqual(result["vendor"], "Unknown")
        self.assertEqual(result["device_type"], "Unknown")
        self.assertNotEqual(result["profile_status"], "high")

    def test_profile_assessment_keeps_broad_oui_only_identity_unknown(self):
        result = self._assess(mac="00:07:ab:44:55:66")

        self.assertEqual(result["vendor"], "Unknown")
        self.assertEqual(result["device_type"], "Unknown")
        self.assertEqual(result["vendor_confidence"], 55)
        self.assertEqual(result["profile_status"], "unknown")

    def test_profile_assessment_accepts_explicit_ssdp_printer_identity(self):
        result = self._assess(
            ssdp_info={
                "manufacturer": "Canon Inc.",
                "model_name": "PIXMA TS5350",
                "friendly_name": "Office Printer",
            },
            services=["IPP"],
        )

        self.assertEqual(result["vendor"], "Canon")
        self.assertEqual(result["device_type"], "Printer")
        self.assertEqual(result["hostname"], "Office Printer")
        self.assertEqual(result["profile_status"], "high")
        self.assertTrue(any(
            item["source"] == "SSDP"
            and item["value"] == "Canon Inc. / PIXMA TS5350"
            for item in result["profile_evidence"]
        ))

    def test_profile_assessment_correlates_dhcpv6_duid_without_guessing(self):
        result = self._assess(
            dhcp_info={
                "hostname": "iPhone-15",
                "vendor_class": "Apple iOS DHCPv6",
                "client_id": "00:01:00:01:aa:bb:cc:dd",
            },
            ipv6_info={
                "duid": "00:01:00:01:aa:bb:cc:dd",
                "hostname": "iPhone-15",
                "vendor_class": "Apple iOS",
                "addresses": ["fe80::15"],
            },
            ttl=64,
        )

        self.assertEqual(result["vendor"], "Apple")
        self.assertEqual(result["device_type"], "Smartphone / Tablet")
        self.assertEqual(result["profile_status"], "high")
        self.assertTrue(any(
            item["group"] == "dhcpv6_correlation"
            for item in result["profile_evidence"]
        ))

    def test_profile_assessment_preserves_exact_hostname(self):
        result = self._assess(
            dhcp_info={
                "hostname": "MiXeD-Case.Device.local",
                "vendor_class": "MSFT 5.0",
            },
            ttl=128,
            open_ports=[445],
            services=["microsoft-ds"],
        )

        self.assertEqual(result["hostname"], "MiXeD-Case.Device.local")

    def test_profile_assessment_marks_gateway_unknown_for_coverage(self):
        result = self._assess(
            mac="14:cc:20:00:11:22",
            is_gateway=True,
            ssdp_info={
                "manufacturer": "TP-Link Corporation Limited",
                "model_name": "Archer AX55",
                "friendly_name": "Home Router",
            },
            services=["DNS", "DHCP"],
        )

        self.assertEqual(result["device_type"], "Router / Gateway")
        self.assertEqual(result["profile_status"], "unknown")
        self.assertEqual(result["profile_version"], 1)
        self.assertEqual(result["profiled_at"], "2026-09-04T08:00:00Z")

if __name__ == '__main__':
    unittest.main()
