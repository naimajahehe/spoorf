"""
Unit Tests: Passive DHCP sniffer cache (smart-merge enrichment)
"""

import unittest

from src.core.discovery.dhcp import DHCPDiscoveredCache, _serialize_duid, dhcp_cache


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


class TestAuthoritativeDhcpIpSelection(unittest.TestCase):

    def setUp(self):
        dhcp_cache.clear()

    def test_dhcpack_authoritative_yiaddr_overrides_requested_addr(self):
        """Uji bahwa DHCPACK dari router menggunakan yiaddr resmi dan mengabaikan requested_addr lama."""
        from scapy.all import Ether, IP, UDP, BOOTP, DHCP
        from src.core.discovery import dhcp as dhcp_mod

        captured_entry = {}
        def _cb(entry):
            nonlocal captured_entry
            captured_entry = entry

        orig_cb = dhcp_mod._dhcp_callback
        dhcp_mod._dhcp_callback = _cb
        try:
            # Simulasi paket DHCPACK dari router: yiaddr=192.168.110.8, requested_addr=192.168.110.254
            pkt = (
                Ether(src='00:11:22:33:44:55', dst='aa:bb:cc:dd:ee:ff') /
                IP(src='192.168.110.1', dst='192.168.110.8') /
                UDP(sport=67, dport=68) /
                BOOTP(op=2, chaddr=b'\xaa\xbb\xcc\xdd\xee\xff' + b'\x00' * 10, yiaddr='192.168.110.8') /
                DHCP(options=[('message-type', 5), ('requested_addr', '192.168.110.254'), 'end'])
            )
            dhcp_mod._handle_dhcp_packet(pkt)
            self.assertEqual(captured_entry.get('ip'), '192.168.110.8', "Harus mengutamakan yiaddr resmi dari ACK")
        finally:
            dhcp_mod._dhcp_callback = orig_cb

    def test_dhcpnak_does_not_bind_rejected_ip(self):
        """Uji bahwa DHCPNAK (penolakan server) tidak pernah menetapkan IP target ke cache."""
        from scapy.all import Ether, IP, UDP, BOOTP, DHCP
        from src.core.discovery import dhcp as dhcp_mod

        captured_entry = {}
        def _cb(entry):
            nonlocal captured_entry
            captured_entry = entry

        orig_cb = dhcp_mod._dhcp_callback
        dhcp_mod._dhcp_callback = _cb
        try:
            pkt = (
                Ether(src='00:11:22:33:44:55', dst='aa:bb:cc:dd:ee:ff') /
                IP(src='192.168.110.1', dst='255.255.255.255') /
                UDP(sport=67, dport=68) /
                BOOTP(op=2, chaddr=b'\xaa\xbb\xcc\xdd\xee\xff' + b'\x00' * 10, yiaddr='0.0.0.0') /
                DHCP(options=[('message-type', 6), ('requested_addr', '192.168.110.254'), 'end'])
            )
            dhcp_mod._handle_dhcp_packet(pkt)
            self.assertEqual(captured_entry.get('ip'), '', "DHCPNAK tidak boleh menetapkan IP target")
        finally:
            dhcp_mod._dhcp_callback = orig_cb

    def test_dhcprequest_with_option50_does_not_set_unconfirmed_ip(self):
        """Uji bahwa DHCPREQUEST klien dengan Option 50 (requested_addr) tidak menetapkan IP hantu."""
        from scapy.all import Ether, IP, UDP, BOOTP, DHCP
        from src.core.discovery import dhcp as dhcp_mod

        captured_entry = {}
        def _cb(entry):
            nonlocal captured_entry
            captured_entry = entry

        orig_cb = dhcp_mod._dhcp_callback
        dhcp_mod._dhcp_callback = _cb
        try:
            # Klien smartphone mengirimkan DHCPREQUEST broadcast dengan Option 50 meminta IP lama
            pkt = (
                Ether(src='aa:bb:cc:dd:ee:ff', dst='ff:ff:ff:ff:ff:ff') /
                IP(src='0.0.0.0', dst='255.255.255.255') /
                UDP(sport=68, dport=67) /
                BOOTP(op=1, chaddr=b'\xaa\xbb\xcc\xdd\xee\xff' + b'\x00' * 10, ciaddr='0.0.0.0', yiaddr='0.0.0.0') /
                DHCP(options=[
                    ('message-type', 3),
                    ('requested_addr', '192.168.110.254'),
                    ('hostname', 'A55-milik-Hanif'),
                    ('vendor_class_id', 'android-dhcp-16'),
                    'end'
                ])
            )
            dhcp_mod._handle_dhcp_packet(pkt)
            self.assertEqual(captured_entry.get('ip'), '', "DHCPREQUEST dengan Option 50 tidak boleh menetapkan IP sebelum disetujui server")
            self.assertEqual(captured_entry.get('hostname'), 'A55-milik-Hanif', "Metadata hostname tetap diserap")
            self.assertEqual(captured_entry.get('vendor_class'), 'android-dhcp-16', "Metadata vendor class tetap diserap")
        finally:
            dhcp_mod._dhcp_callback = orig_cb

    def test_dhcp_cache_does_not_resurrect_stale_ip_on_rebind(self):
        """Uji bahwa DHCPDiscoveredCache tidak membangkitkan IP usang saat perangkat me-rebind tanpa IP sah."""
        cache = DHCPDiscoveredCache()
        # 1. Sesi lama tercatat di 192.168.110.254
        cache.update('aa:bb:cc:dd:ee:ff', '192.168.110.254', {
            'hostname': 'A55-milik-Hanif',
            'message_type_code': 5,
            'message_type': 'ACK'
        })
        self.assertEqual(cache.get('aa:bb:cc:dd:ee:ff')['ip'], '192.168.110.254')

        # 2. Perangkat re-bind via DHCPREQUEST (message_type_code=3) dengan IP kosong
        merged = cache.update('aa:bb:cc:dd:ee:ff', '', {
            'hostname': 'A55-milik-Hanif',
            'message_type_code': 3,
            'message_type': 'REQUEST'
        })
        self.assertEqual(merged.get('ip'), '', "IP lama tidak boleh diresurreksi saat rebind baru berlangsung")
        self.assertEqual(merged.get('hostname'), 'A55-milik-Hanif', "Metadata tetap terjaga")

    def test_dhcp6_packet_does_not_wipe_ipv4_cache(self):
        """Uji bahwa paket DHCPv6 SOLICIT/REQUEST (code 1 / 3) TIDAK menghapus alamat IPv4 yang sudah sah di cache."""
        cache = DHCPDiscoveredCache()
        # 1. Klien dual-stack telah memperoleh IPv4
        cache.update('aa:bb:cc:dd:ee:ff', '192.168.1.50', {
            'hostname': 'DualStackPhone',
            'message_type_code': 5,
            'message_type': 'ACK'
        })
        self.assertEqual(cache.get('aa:bb:cc:dd:ee:ff')['ip'], '192.168.1.50')

        # 2. Klien mengirim DHCPv6 SOLICIT (msg_type_code=1) tanpa IPv4
        merged = cache.update('aa:bb:cc:dd:ee:ff', '', {
            'hostname': 'DualStackPhone',
            'message_type_code': 1,
            'message_type': 'SOLICIT',
            'is_dhcp6': True,
            'ipv6': 'fe80::1'
        })
        self.assertEqual(merged.get('ip'), '192.168.1.50', "DHCPv6 SOLICIT tidak boleh menghapus IPv4 klien dual-stack")
        self.assertEqual(merged.get('ipv6'), 'fe80::1', "IPv6 harus tersimpan")

    def test_fqdn_wire_format_and_plain_decoding(self):
        """Uji dekoder RFC 4702 Option 81 FQDN: format DNS wire (panjang byte) & plain ASCII."""
        from src.core.discovery.dhcp import _decode_fqdn
        # Wire format (E-bit set 0x04): \x07android\x03lan\x00
        wire_payload = b'\x04\x00\x00\x07android\x03lan\x00'
        self.assertEqual(_decode_fqdn(wire_payload), 'android.lan')

        # Plain text format (E-bit cleared 0x00): my-host.lan\x00
        plain_payload = b'\x00\x00\x00my-laptop.lan\x00'
        self.assertEqual(_decode_fqdn(plain_payload), 'my-laptop.lan')

        # Malformed / truncated
        self.assertEqual(_decode_fqdn(b'\x00'), '')

    def test_option12_null_byte_stripped(self):
        """Uji bahwa Option 12 dengan trailing null byte \\x00 dibersihkan tanpa merusak string."""
        from scapy.all import Ether, IP, UDP, BOOTP, DHCP
        from src.core.discovery import dhcp as dhcp_mod

        captured_entry = {}
        def _cb(entry):
            nonlocal captured_entry
            captured_entry = entry

        orig_cb = dhcp_mod._dhcp_callback
        dhcp_mod._dhcp_callback = _cb
        try:
            pkt = (
                Ether(src='aa:bb:cc:dd:ee:11', dst='ff:ff:ff:ff:ff:ff') /
                IP(src='0.0.0.0', dst='255.255.255.255') /
                UDP(sport=68, dport=67) /
                BOOTP(op=1, chaddr=b'\xaa\xbb\xcc\xdd\xee\x11' + b'\x00' * 10) /
                DHCP(options=[
                    ('message-type', 1),
                    ('hostname', b'DESKTOP-ABC\x00'),
                    ('vendor_class_id', b'MSFT 5.0\x00'),
                    ('router', b'\xc0\xa8\x01\x01'),
                    'end'
                ])
            )
            dhcp_mod._handle_dhcp_packet(pkt)
            self.assertEqual(captured_entry.get('hostname'), 'DESKTOP-ABC')
            self.assertEqual(captured_entry.get('vendor_class'), 'MSFT 5.0')
            self.assertEqual(captured_entry.get('router_ip'), '192.168.1.1', "Option 3 byte 4-octets harus terurai menjadi IP valid")
        finally:
            dhcp_mod._dhcp_callback = orig_cb

    def test_dhcp6_oro_exact_set_no_collision(self):
        """Uji bahwa Option Request Option (ORO) DHCPv6 menggunakan perbandingan set integer, bukan substring."""
        from scapy.all import Ether, IPv6, UDP
        from scapy.layers.dhcp6 import DHCP6_Solicit, DHCP6OptOptReq, DHCP6OptClientId, DUID_LLT
        from src.core.discovery import dhcp as dhcp_mod

        captured_entry = {}
        def _cb(entry):
            nonlocal captured_entry
            captured_entry = entry

        orig_cb = dhcp_mod._dhcp_callback
        dhcp_mod._dhcp_callback = _cb
        try:
            # Client requesting ORO [144, 244] - substring '44' must NOT match Microsoft Windows
            duid = DUID_LLT(lladdr='aa:bb:cc:dd:ee:22', timeval=100)
            pkt = (
                Ether(src='aa:bb:cc:dd:ee:22', dst='33:33:00:01:00:02') /
                IPv6(src='fe80::22', dst='ff02::1:2') /
                UDP(sport=546, dport=547) /
                DHCP6_Solicit() /
                DHCP6OptClientId(duid=duid) /
                DHCP6OptOptReq(reqopts=[144, 244])
            )
            dhcp_mod._handle_dhcp_packet(pkt)
            self.assertNotIn("Microsoft Windows", captured_entry.get('dhcp_fingerprint', ''),
                             "ORO 144/244 tidak boleh cocok parsial dengan Windows (44/47)")
        finally:
            dhcp_mod._dhcp_callback = orig_cb

    def test_prl_android_calibration_does_not_misclassify_linux(self):
        """Uji bahwa PRL {28, 51, 58} tanpa Option 26 / Android vendor class tidak salah diklasifikasikan sebagai Android."""
        from scapy.all import Ether, IP, UDP, BOOTP, DHCP
        from src.core.discovery import dhcp as dhcp_mod

        captured_entry = {}
        def _cb(entry):
            nonlocal captured_entry
            captured_entry = entry

        orig_cb = dhcp_mod._dhcp_callback
        dhcp_mod._dhcp_callback = _cb
        try:
            # Generic Linux with PRL [1, 3, 6, 28, 51, 58]
            pkt = (
                Ether(src='aa:bb:cc:dd:ee:33', dst='ff:ff:ff:ff:ff:ff') /
                IP(src='0.0.0.0', dst='255.255.255.255') /
                UDP(sport=68, dport=67) /
                BOOTP(op=1, chaddr=b'\xaa\xbb\xcc\xdd\xee\x33' + b'\x00' * 10) /
                DHCP(options=[
                    ('message-type', 1),
                    ('param_req_list', [1, 3, 6, 28, 51, 58]),
                    'end'
                ])
            )
            dhcp_mod._handle_dhcp_packet(pkt)
            self.assertNotEqual(captured_entry.get('dhcp_fingerprint'), "Android OS Signature",
                                "PRL [1, 3, 6, 28, 51, 58] tanpa Option 26 tidak boleh diklasifikasi sebagai Android")
        finally:
            dhcp_mod._dhcp_callback = orig_cb


if __name__ == '__main__':
    unittest.main()
