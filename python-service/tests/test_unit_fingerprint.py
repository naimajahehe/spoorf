"""
Unit Tests for Fingerprinting Subsystem (src.core.fingerprint)
Covers: Happy Path, Negative Tests, and Edge Cases
"""

import unittest
from unittest.mock import patch
from src.core.fingerprint import (
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
        self.assertEqual(dev_type, "Android / iOS (Mobile)")

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
        self.assertEqual(vendor, "Samsung (Smart TV / Audio)")

if __name__ == '__main__':
    unittest.main()
