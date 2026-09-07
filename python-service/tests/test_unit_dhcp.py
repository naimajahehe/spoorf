"""
Unit Tests: Passive DHCP sniffer cache (smart-merge enrichment)
"""

import unittest

from src.core.discovery.dhcp import DHCPDiscoveredCache


class TestUnitDhcpCache(unittest.TestCase):

    def test_update_returns_merged_enriched_entry(self):
        """BUG-11: update() harus MENGEMBALIKAN entri hasil smart-merge (mempertahankan
        hostname/vendor_class lama saat paket baru kosong), agar callback dapat memancarkan
        data terkaya alih-alih entri mentah dari ACK telanjang (yang membuat badge
        vendor/OS/hostname di UI berkedip / terhapus)."""
        cache = DHCPDiscoveredCache()

        # 1. Paket kaya: ada hostname & vendor_class (Option 12 & 60)
        cache.update('aa:bb:cc:dd:ee:ff', '192.168.1.50', {
            'hostname': 'MyPhone',
            'vendor_class': 'android-dhcp-14',
            'message_type': 'REQUEST'
        })

        # 2. Paket ACK "telanjang" tanpa Option 12/55/60
        merged = cache.update('aa:bb:cc:dd:ee:ff', '192.168.1.50', {'message_type': 'ACK'})

        self.assertIsNotNone(merged, "update() harus mengembalikan entri merged, bukan None")
        self.assertEqual(merged['hostname'], 'MyPhone', "hostname lama harus dipertahankan")
        self.assertEqual(merged['vendor_class'], 'android-dhcp-14', "vendor_class lama harus dipertahankan")


if __name__ == '__main__':
    unittest.main()
