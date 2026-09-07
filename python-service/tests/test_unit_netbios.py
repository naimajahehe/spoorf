"""
Unit Tests: NetBIOS / mDNS hostname resolver
"""

import unittest
from unittest.mock import patch, MagicMock

from src.core.fingerprint.netbios import query_mdns


class TestUnitNetbios(unittest.TestCase):

    @patch('src.core.fingerprint.netbios.sr1')
    def test_query_mdns_does_not_eat_hostname_chars(self, mock_sr1):
        """BUG-13: str.rstrip('.local.') memperlakukan argumen sebagai HIMPUNAN karakter
        {'.','l','o','c','a'}, jadi 'Nicola.local.' terpotong jadi 'Ni'. Harus memakai
        removesuffix agar hanya akhiran '.local.' yang dibuang."""
        ans = MagicMock()
        ans.haslayer.return_value = True
        dns_layer = MagicMock()
        dns_layer.ancount = 1
        dns_layer.an.rdata = 'Nicola.local.'
        ans.__getitem__.return_value = dns_layer
        mock_sr1.return_value = ans

        result = query_mdns('192.168.1.10')
        self.assertEqual(result, 'Nicola')

    @patch('src.core.fingerprint.netbios.sr1')
    def test_query_mdns_strips_only_local_suffix(self, mock_sr1):
        """Nama tanpa karakter jebakan tetap benar, dan '.local.' tetap dibuang."""
        ans = MagicMock()
        ans.haslayer.return_value = True
        dns_layer = MagicMock()
        dns_layer.ancount = 1
        dns_layer.an.rdata = 'Coca-Cola.local.'
        ans.__getitem__.return_value = dns_layer
        mock_sr1.return_value = ans

        result = query_mdns('192.168.1.11')
        self.assertEqual(result, 'Coca-Cola')


if __name__ == '__main__':
    unittest.main()
