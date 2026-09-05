import json
import unittest
from pathlib import Path

from src.core.fingerprint import assess_device_profile


class TestProfileBenchmark(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_path = Path(__file__).parent / "fixtures" / "profile_benchmark.json"
        cls.fixture = json.loads(fixture_path.read_text(encoding="utf-8"))

    def test_fixture_has_required_categories_holdout_and_provenance(self):
        cases = self.fixture["cases"]
        category_minimums = {
            "windows_pc": 8,
            "android_mobile": 8,
            "apple": 6,
            "tv_printer_media": 6,
            "iot_camera": 6,
            "network_infrastructure": 3,
            "ambiguous": 3,
        }

        self.assertGreaterEqual(len(cases), 40)
        for category, minimum in category_minimums.items():
            count = sum(case["category"] == category for case in cases)
            self.assertGreaterEqual(count, minimum, category)
        self.assertGreaterEqual(
            sum(case["split"] == "holdout" for case in cases),
            len(cases) / 3,
        )
        self.assertEqual(
            set(self.fixture["metadata"]["ground_truth_kinds"]),
            {"synthetic_fixture", "authorized_test_device"},
        )
        self.assertTrue(all(
            case["ground_truth_kind"] in self.fixture["metadata"]["ground_truth_kinds"]
            for case in cases
        ))

    def test_profile_benchmark_reports_precision_coverage_and_unknown(self):
        base_input = {
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
        split_metrics = {}
        for split in ("development", "holdout"):
            eligible = emitted_high = correct_high = unknown = 0
            for case in self.fixture["cases"]:
                if case["split"] != split:
                    continue

                profile_input = dict(base_input)
                profile_input.update(case["input"])
                result = assess_device_profile(**profile_input)
                if not case.get("eligible", True):
                    continue

                eligible += 1
                if result["profile_status"] == "unknown":
                    unknown += 1
                if result["profile_status"] == "high":
                    emitted_high += 1
                    if (
                        result["vendor"] == case["expected_vendor"]
                        and result["device_type"] == case["expected_device_type"]
                    ):
                        correct_high += 1
                if case["expect_high"]:
                    self.assertEqual(result["profile_status"], "high", case["id"])
                else:
                    self.assertNotEqual(result["profile_status"], "high", case["id"])

            precision = correct_high / emitted_high if emitted_high else 0.0
            coverage = emitted_high / eligible if eligible else 0.0
            unknown_rate = unknown / eligible if eligible else 0.0
            split_metrics[split] = {
                "eligible": eligible,
                "emitted_high": emitted_high,
                "correct_high": correct_high,
                "precision": precision,
                "coverage": coverage,
                "unknown_rate": unknown_rate,
            }
            print(
                f"{split}: precision={precision:.3f} coverage={coverage:.3f} "
                f"unknown={unknown_rate:.3f} ({unknown}/{eligible})"
            )

        self.assertGreaterEqual(split_metrics["holdout"]["precision"], 0.90)
        self.assertGreater(split_metrics["holdout"]["eligible"], 0)
        self.assertGreater(split_metrics["holdout"]["unknown_rate"], 0)


if __name__ == "__main__":
    unittest.main()
