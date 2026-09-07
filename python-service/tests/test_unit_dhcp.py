"""
Unit Tests: Passive DHCP sniffer cache (smart-merge enrichment)
"""

import unittest

from src.core.discovery.dhcp import DHCPDiscoveredCache, _serialize_duid


class TestUnitDuidSerialization(unittest.TestCase):

    def test_duid_llt_serialized_to_real_bytes_not_placeholder(self):
        """BUG DUID-LLT: str(objek DUID Scapy) menghasilkan label 'DUID_LLT', membuang byte
        identitas → semua DUID-LLT kolaps ke nilai sama (tak terlacak + ranjau false-fusi).
        Harus di-serialize ke byte asli (colon-hex): type+hwtype+time+LL yang STABIL."""
        from scapy.layers.dhcp6 import DUID_LLT
        duid = DUID_LLT(lladdr='56:e9:8d:38:1c:97', timeval=1000)
        result = _serialize_duid(duid)
        self.assertNotEqual(result, 'DUID_LLT', 'tak boleh menyimpan placeholder label')
        self.assertIn('56:e9:8d:38:1c:97', result, 'harus memuat LL(MAC) stabil dari DUID-LLT')
        self.assertTrue(all(c in '0123456789abcdef:' for c in result), 'harus colon-hex')

    def test_serialize_duid_bytes_input(self):
        self.assertEqual(_serialize_duid(b'\x00\x01\xaa'), '00:01:aa')

    def test_serialize_duid_none_empty(self):
        self.assertEqual(_serialize_duid(None), '')
        self.assertEqual(_serialize_duid(b''), '')


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
