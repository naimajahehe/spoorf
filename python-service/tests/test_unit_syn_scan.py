"""
Unit Tests for FastSYNScanner port sanitizer & RFC1918 hardening (F-05).
"""

import unittest
from unittest.mock import patch
from src.core.bettercap.syn_scan import FastSYNScanner, MAX_CUSTOM_PORTS


class TestSynScanSanitizer(unittest.TestCase):

    def test_sanitize_filters_out_of_range(self):
        """Port di luar 1..65535 dan non-integer harus dibuang."""
        result = FastSYNScanner._sanitize_ports([0, -5, 70000, 80, 443, 'x', None, 65535, 1])
        self.assertEqual(result, [80, 443, 65535, 1])

    def test_sanitize_dedupes_preserving_order(self):
        """Duplikat dibuang dengan menjaga urutan kemunculan pertama."""
        result = FastSYNScanner._sanitize_ports([22, 22, 80, 80, 443, 22])
        self.assertEqual(result, [22, 80, 443])

    def test_sanitize_caps_maximum(self):
        """Jumlah port di-cap ke MAX_CUSTOM_PORTS untuk mencegah exhaustion."""
        big = list(range(1, 5000))  # 4999 port unik valid
        result = FastSYNScanner._sanitize_ports(big)
        self.assertEqual(len(result), MAX_CUSTOM_PORTS)
        self.assertEqual(result, list(range(1, MAX_CUSTOM_PORTS + 1)))

    @patch.object(FastSYNScanner, '_probe_port', return_value=None)
    def test_scan_host_respects_cap(self, _mock_probe):
        """scan_host dengan daftar port raksasa tetap hanya memindai <= cap (tanpa network nyata)."""
        scanner = FastSYNScanner()
        res = scanner.scan_host('192.168.1.50', ports=list(range(1, 9000)))
        self.assertLessEqual(res['total_scanned'], MAX_CUSTOM_PORTS)
        self.assertEqual(res['total_scanned'], MAX_CUSTOM_PORTS)

    @patch.object(FastSYNScanner, '_probe_port', return_value=None)
    def test_scan_host_preset_profile_unaffected(self, _mock_probe):
        """Profil preset (top-20) tetap 20 port, tidak terpengaruh sanitizer."""
        scanner = FastSYNScanner()
        res = scanner.scan_host('192.168.1.50', ports=None, profile='top-20')
        self.assertEqual(res['total_scanned'], 20)


if __name__ == '__main__':
    unittest.main()
