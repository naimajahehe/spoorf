"""
Unit Tests for Core Network Subsystem (src.core.network)
Covers: Happy Path, Negative Tests, and Edge Cases
"""

import unittest
from unittest.mock import patch
from src.core.network import (
    is_valid_private_ip,
    is_valid_private_network,
    is_valid_mac,
    get_self_mac,
    get_current_gateway,
    get_active_ip,
    get_network_info,
    get_wifi_info,
    clear_wifi_cache,
    parse_netsh_wlan_interfaces,
    has_ipv6_connectivity,
    is_network_changed
)

class TestCoreNetwork(unittest.TestCase):

    # ===== 1. is_valid_private_ip =====
    def test_valid_private_ip_happy_path(self):
        """Happy Path: Standard RFC 1918 Private IPv4 Addresses."""
        self.assertTrue(is_valid_private_ip("192.168.1.1"))
        self.assertTrue(is_valid_private_ip("192.168.100.254"))
        self.assertTrue(is_valid_private_ip("10.0.0.1"))
        self.assertTrue(is_valid_private_ip("10.255.255.254"))
        self.assertTrue(is_valid_private_ip("172.16.0.1"))
        self.assertTrue(is_valid_private_ip("172.31.255.254"))

    def test_valid_private_ip_negative(self):
        """Negative Tests: Public, Loopback, Multicast, Link-Local, and Malformed IPs."""
        self.assertFalse(is_valid_private_ip("8.8.8.8"))        # Public Google DNS
        self.assertFalse(is_valid_private_ip("1.1.1.1"))        # Public Cloudflare DNS
        self.assertFalse(is_valid_private_ip("127.0.0.1"))      # Loopback
        self.assertFalse(is_valid_private_ip("169.254.1.10"))   # APIPA / Link-local
        self.assertFalse(is_valid_private_ip("224.0.0.1"))      # Multicast
        self.assertFalse(is_valid_private_ip("not-an-ip"))      # Invalid string
        self.assertFalse(is_valid_private_ip("999.999.999.999"))# Out of range

    def test_valid_private_ip_edge_cases(self):
        """Edge Cases: Empty, None, Boundary IPs, Extreme Lengths, Whitespace."""
        self.assertFalse(is_valid_private_ip(""))
        self.assertFalse(is_valid_private_ip(None))
        self.assertFalse(is_valid_private_ip("0.0.0.0"))
        self.assertFalse(is_valid_private_ip("255.255.255.255"))
        self.assertFalse(is_valid_private_ip(" " * 50))
        self.assertFalse(is_valid_private_ip("192.168.1.1" + "a" * 1000))
        # Whitespace trimmed should be recognized correctly
        self.assertTrue(is_valid_private_ip("  192.168.1.1  "))

    def test_private_network_validator_rejects_public_cidr(self):
        self.assertFalse(is_valid_private_network("203.0.113.0/24"))
        self.assertTrue(is_valid_private_network("192.168.1.0/24"))

    # ===== 2. is_valid_mac =====
    def test_valid_mac_happy_path(self):
        """Happy Path: Standard 6-octet MAC addresses with colons and hyphens."""
        self.assertTrue(is_valid_mac("aa:bb:cc:dd:ee:ff"))
        self.assertTrue(is_valid_mac("AA:BB:CC:DD:EE:FF"))
        self.assertTrue(is_valid_mac("00:11:22:33:44:55"))
        self.assertTrue(is_valid_mac("00-11-22-33-44-55"))
        self.assertTrue(is_valid_mac("a8:3b:76:0c:dc:55"))

    def test_valid_mac_negative(self):
        """Negative Tests: Incorrect lengths, non-hex characters, invalid formats."""
        self.assertFalse(is_valid_mac("00:11:22:33:44"))       # 5 octets
        self.assertFalse(is_valid_mac("00:11:22:33:44:55:66")) # 7 octets
        self.assertFalse(is_valid_mac("gg:hh:ii:jj:kk:ll"))    # Non-hex characters
        self.assertFalse(is_valid_mac("not-a-mac-address"))
        self.assertFalse(is_valid_mac("192.168.1.1"))

    def test_valid_mac_edge_cases(self):
        """Edge Cases: Empty string, None, Extreme Length, Whitespace."""
        self.assertFalse(is_valid_mac(""))
        self.assertFalse(is_valid_mac(None))
        self.assertFalse(is_valid_mac(" " * 20))
        self.assertFalse(is_valid_mac("00:11:22:33:44:55" * 10))
        self.assertTrue(is_valid_mac("  00:11:22:33:44:55  "))

    # ===== 3. Interface & Gateway Discovery =====
    def test_get_self_mac_structure(self):
        """Verify get_self_mac returns valid MAC structure with list ips mock."""
        iface = type('Iface', (), {'ips': ['192.168.1.20'], 'mac': '00:11:22:33:44:55'})()
        with patch(
            'src.core.network.get_network_info',
            return_value={'ip': '192.168.1.20'}
        ), patch.dict('src.core.network.ifaces', {'mock': iface}, clear=True):
            mac = get_self_mac()
        self.assertIsInstance(mac, str)
        self.assertTrue(is_valid_mac(mac))

    def test_get_self_mac_scapy_dict_ips(self):
        """Verify get_self_mac matches Windows Scapy dict ips {4: [ip], 6: []}."""
        iface = type('Iface', (), {'ips': {4: ['192.168.1.50'], 6: []}, 'mac': 'aa:bb:cc:dd:ee:ff'})()
        with patch(
            'src.core.network.get_network_info',
            return_value={'ip': '192.168.1.50'}
        ), patch.dict('src.core.network.ifaces', {'mock': iface}, clear=True):
            mac = get_self_mac()
        self.assertEqual(mac, 'aa:bb:cc:dd:ee:ff')

    def test_get_current_gateway_structure(self):
        """Verify get_current_gateway returns non-empty string."""
        with patch(
            'src.core.network.netifaces.gateways',
            return_value={'default': {2: ('192.168.1.1', 'Ethernet')}}
        ):
            gw = get_current_gateway()
        self.assertIsInstance(gw, str)
        self.assertGreater(len(gw), 6)

    def test_get_current_gateway_rejects_public_default(self):
        with patch(
            'src.core.network.netifaces.gateways',
            return_value={'default': {2: ('203.0.113.1', 'Ethernet')}}
        ), patch('src.core.network.sys.platform', 'linux'):
            self.assertEqual(get_current_gateway(), '')

    def test_get_network_info_structure(self):
        """Verify get_network_info returns required dictionary keys."""
        with patch('src.core.network.get_active_ip', return_value='192.168.1.20'), \
             patch('src.core.network.get_current_gateway', return_value='192.168.1.1'), \
             patch('src.core.network.netifaces.interfaces', return_value=['Ethernet']), \
             patch(
                 'src.core.network.netifaces.ifaddresses',
                 return_value={2: [{'addr': '192.168.1.20', 'netmask': '255.255.255.0'}]}
             ):
            info = get_network_info()
        self.assertIsInstance(info, dict)
        for key in ['ip', 'netmask', 'network', 'gateway', 'interface']:
            self.assertIn(key, info)
            self.assertIsInstance(info[key], str)

    def test_get_network_info_rejects_public_default_interface(self):
        with patch('src.core.network.get_active_ip', return_value='203.0.113.10'), \
             patch('src.core.network.get_current_gateway', return_value='203.0.113.1'), \
             patch('src.core.network.netifaces.interfaces', return_value=['Ethernet']), \
             patch(
                 'src.core.network.netifaces.ifaddresses',
                 return_value={2: [{'addr': '203.0.113.10', 'netmask': '255.255.255.0'}]}
             ), patch(
                 'src.core.network.netifaces.gateways',
                 return_value={'default': {2: ('203.0.113.1', 'Ethernet')}}
             ):
            info = get_network_info()

        self.assertEqual(info, {
            'ip': '',
            'netmask': '',
            'network': '',
            'gateway': '',
            'interface': ''
        })

    def test_get_network_info_rejects_missing_netmask(self):
        with patch('src.core.network.get_active_ip', return_value='192.168.1.20'), \
             patch('src.core.network.get_current_gateway', return_value='192.168.1.1'), \
             patch('src.core.network.netifaces.interfaces', return_value=['Ethernet']), \
             patch(
                 'src.core.network.netifaces.ifaddresses',
                 return_value={2: [{'addr': '192.168.1.20'}]}
             ), patch('src.core.network.netifaces.gateways', return_value={}):
            info = get_network_info()

        self.assertEqual(info['network'], '')
        self.assertEqual(info['netmask'], '')

    def test_get_wifi_info_structure(self):
        """Verify get_wifi_info returns standardized keys."""
        with patch('src.core.network.sys.platform', 'linux'):
            wifi = get_wifi_info()
        self.assertIsInstance(wifi, dict)
        self.assertIn('connected', wifi)
        self.assertIsInstance(wifi['connected'], bool)
        self.assertIn('ssid', wifi)

    # ===== 4. is_network_changed =====
    def test_network_changed_logic(self):
        """Verify network change detection logic."""
        curr_gw = '192.168.1.1'
        curr_iface = 'Ethernet'
        with patch('src.core.network.get_current_gateway', return_value=curr_gw), \
             patch('src.core.network.get_network_info', return_value={'interface': curr_iface}):
            self.assertFalse(is_network_changed(curr_gw, curr_iface))
            self.assertTrue(is_network_changed("10.99.99.99", curr_iface))
            self.assertTrue(is_network_changed(curr_gw, "Virtual-Adapter-XYZ"))

    def test_network_changed_via_gateway_mac_same_ip(self):
        """Dua jaringan berbeda ber-IP gateway SAMA harus terdeteksi lewat MAC gateway; pembacaan
        MAC kosong (transient) & prev-MAC belum diketahui TIDAK memicu perubahan palsu."""
        gw = '192.168.1.1'; iface = 'Wi-Fi'
        with patch('src.core.network.get_current_gateway', return_value=gw), \
             patch('src.core.network.get_network_info', return_value={'interface': iface}):
            # MAC gateway berbeda (kedua diketahui) → jaringan berganti walau IP & iface sama
            with patch('src.core.discovery.arp.get_mac_from_arp', return_value='bb:bb:bb:bb:bb:bb'):
                self.assertTrue(is_network_changed(gw, iface, 'aa:aa:aa:aa:aa:aa'))
            # MAC gateway sama → tidak berganti
            with patch('src.core.discovery.arp.get_mac_from_arp', return_value='aa:aa:aa:aa:aa:aa'):
                self.assertFalse(is_network_changed(gw, iface, 'aa:aa:aa:aa:aa:aa'))
            # MAC saat ini kosong (ARP miss transient) → JANGAN memicu perubahan palsu
            with patch('src.core.discovery.arp.get_mac_from_arp', return_value=''):
                self.assertFalse(is_network_changed(gw, iface, 'aa:aa:aa:aa:aa:aa'))
            # prev-MAC belum diketahui → tak bisa dibandingkan → tidak berganti
            with patch('src.core.discovery.arp.get_mac_from_arp', return_value='bb:bb:bb:bb:bb:bb'):
                self.assertFalse(is_network_changed(gw, iface, ''))
            # Backward-compat 2-arg (tanpa MAC) → perilaku lama, MAC tak diperiksa
            with patch('src.core.discovery.arp.get_mac_from_arp', return_value='zz:zz:zz:zz:zz:zz'):
                self.assertFalse(is_network_changed(gw, iface))

    # ===== IPv6 capability detection (local, no packets) =====
    def _fake_addr(self, family, address):
        class _A:
            pass
        a = _A()
        a.family = family
        a.address = address
        return a

    def test_has_ipv6_true_when_global_address_present(self):
        import socket as _s
        addrs = {
            'Wi-Fi': [
                self._fake_addr(_s.AF_INET, '192.168.1.10'),
                self._fake_addr(_s.AF_INET6, 'fe80::1%14'),          # link-local → tak dihitung
                self._fake_addr(_s.AF_INET6, '2404:8000:1024::45e1'), # global → dihitung
            ]
        }
        with patch('psutil.net_if_addrs', return_value=addrs):
            self.assertTrue(has_ipv6_connectivity())

    def test_has_ipv6_false_when_only_link_local(self):
        import socket as _s
        addrs = {
            'Wi-Fi': [
                self._fake_addr(_s.AF_INET, '192.168.110.5'),
                self._fake_addr(_s.AF_INET6, 'fe80::770f:1975:aee2:cec%14'),  # hanya link-local
            ]
        }
        with patch('psutil.net_if_addrs', return_value=addrs), \
             patch('src.core.network.netifaces.gateways', return_value={}):
            self.assertFalse(has_ipv6_connectivity())

    def test_has_ipv6_false_when_no_ipv6(self):
        import socket as _s
        addrs = {'Wi-Fi': [self._fake_addr(_s.AF_INET, '10.80.45.139')]}
        with patch('psutil.net_if_addrs', return_value=addrs), \
             patch('src.core.network.netifaces.gateways', return_value={}):
            self.assertFalse(has_ipv6_connectivity())

    def _fake_stats(self, isup):
        class _S:
            pass
        s = _S()
        s.isup = isup
        return s

    def test_has_ipv6_false_for_vpn_ula_adapter(self):
        """VPN/WSL/Docker adapters carry ULA (fd00::/7) — must NOT count as internet IPv6."""
        import socket as _s
        addrs = {'Tailscale': [self._fake_addr(_s.AF_INET6, 'fd7a:115c:a1e0::1')]}
        stats = {'Tailscale': self._fake_stats(True)}
        with patch('psutil.net_if_addrs', return_value=addrs), \
             patch('psutil.net_if_stats', return_value=stats), \
             patch('src.core.network.netifaces.gateways', return_value={}):
            self.assertFalse(has_ipv6_connectivity())

    def test_has_ipv6_false_when_global_on_down_interface(self):
        """A DOWN interface's stale global IPv6 must NOT count."""
        import socket as _s
        addrs = {'Ethernet': [self._fake_addr(_s.AF_INET6, '2404:8000:1024::45e1')]}
        stats = {'Ethernet': self._fake_stats(False)}
        with patch('psutil.net_if_addrs', return_value=addrs), \
             patch('psutil.net_if_stats', return_value=stats), \
             patch('src.core.network.netifaces.gateways', return_value={}):
            self.assertFalse(has_ipv6_connectivity())

    def test_has_ipv6_true_when_ipv6_default_route_present(self):
        """SP-4: bila operator TAK punya IPv6 global tapi jaringan menyediakan IPv6 (router RA →
        ada RUTE DEFAULT IPv6), gerbang harus True agar penemuan+NDP-spoof IPv6 korban tetap
        jalan (link-local NDP cukup, operator tak perlu alamat global). Tanpa ini, trafik korban
        bocor lewat IPv6 (Happy Eyeballs) meski IPv4 diblokir 100%."""
        import socket as _s
        # Operator hanya punya link-local (tak ada global).
        addrs = {'Wi-Fi': [
            self._fake_addr(_s.AF_INET, '192.168.1.10'),
            self._fake_addr(_s.AF_INET6, 'fe80::abcd%14'),
        ]}
        stats = {'Wi-Fi': self._fake_stats(True)}
        # Router mengirim RA → OS memasang rute default IPv6 via link-local router.
        gateways = {'default': {_s.AF_INET6: ('fe80::1', 'Wi-Fi')}}
        with patch('psutil.net_if_addrs', return_value=addrs), \
             patch('psutil.net_if_stats', return_value=stats), \
             patch('src.core.network.netifaces.gateways', return_value=gateways):
            self.assertTrue(has_ipv6_connectivity())

    # ===== 5. Anti-Flapping, Multi-Interface, and Robust Fallback Tests =====
    def test_parse_netsh_wlan_interfaces_single_connected(self):
        sample_output = """There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : RZ616 Wi-Fi 6E 160MHz
    State                  : connected
    SSID                   : Office_5G
    AP BSSID               : 9a:4a:6b:15:75:e8
    Radio type             : 802.11ax
    Channel                : 36
    Signal                 : 85%
"""
        parsed = parse_netsh_wlan_interfaces(sample_output)
        self.assertTrue(parsed.get('connected'))
        self.assertEqual(parsed.get('ssid'), 'Office_5G')
        self.assertEqual(parsed.get('interface'), 'Wi-Fi')
        self.assertEqual(parsed.get('signal'), '85%')

    def test_parse_netsh_wlan_interfaces_multi_adapter_prioritizes_connected(self):
        """Uji output dengan 2 antarmuka: Wi-Fi aktif + Virtual Wi-Fi Direct terputus."""
        multi_output = """There are 2 interfaces on the system:

    Name                   : Wi-Fi
    Description            : RZ616 Wi-Fi 6E 160MHz
    State                  : connected
    SSID                   : MyHomeWiFi
    AP BSSID               : 11:22:33:44:55:66
    Radio type             : 802.11ac
    Channel                : 44
    Signal                 : 90%

    Name                   : Local Area Connection* 9
    Description            : Microsoft Wi-Fi Direct Virtual Adapter
    State                  : disconnected
    Radio type             : 802.11ac
"""
        parsed = parse_netsh_wlan_interfaces(multi_output)
        # Antarmuka primer yang connected harus terpilih, BUKAN tertimpa oleh antarmuka kedua yang disconnected!
        self.assertTrue(parsed.get('connected'))
        self.assertEqual(parsed.get('ssid'), 'MyHomeWiFi')
        self.assertEqual(parsed.get('interface'), 'Wi-Fi')

    def test_parse_netsh_wlan_interfaces_rejects_disconnected(self):
        """Pastikan substring 'disconnected' TIDAK dianggap 'connected'."""
        disconn_output = """There is 1 interface on the system:

    Name                   : Wi-Fi
    State                  : disconnected
"""
        parsed = parse_netsh_wlan_interfaces(disconn_output)
        self.assertFalse(parsed.get('connected'))

    def test_parse_netsh_wlan_interfaces_supports_indonesian_locale(self):
        """Uji dukungan bahasa Indonesia (Keadaan: terhubung / terputus)."""
        id_output_conn = """Ada 1 antarmuka pada sistem:

    Nama                   : Wi-Fi
    Keadaan                : terhubung
    SSID                   : Warkop_Kopi
    Sinyal                 : 75%
"""
        parsed = parse_netsh_wlan_interfaces(id_output_conn)
        self.assertTrue(parsed.get('connected'))
        self.assertEqual(parsed.get('ssid'), 'Warkop_Kopi')

        id_output_disconn = """Ada 1 antarmuka pada sistem:

    Nama                   : Wi-Fi
    Keadaan                : terputus
"""
        parsed_dis = parse_netsh_wlan_interfaces(id_output_disconn)
        self.assertFalse(parsed_dis.get('connected'))

    def test_get_wifi_info_windows_fallback_to_psutil_when_netsh_timeout(self):
        """Bila netsh timeout pada kartu Wi-Fi, fallback psutil harus mendeteksi Wi-Fi sebagai connected."""
        import subprocess as _sp
        import socket as _s
        clear_wifi_cache()

        addrs = {
            'Wi-Fi': [
                self._fake_addr(_s.AF_INET, '192.168.1.150'),
            ]
        }
        stats = {'Wi-Fi': self._fake_stats(True)}

        with patch('src.core.network.sys.platform', 'win32'), \
             patch('subprocess.check_output', side_effect=_sp.TimeoutExpired(['netsh'], 3.0)), \
             patch('src.core.network.get_current_gateway', return_value='192.168.1.1'), \
             patch('psutil.net_if_stats', return_value=stats), \
             patch('psutil.net_if_addrs', return_value=addrs):
            wifi = get_wifi_info()
            self.assertTrue(wifi['connected'])
            self.assertEqual(wifi['interface_type'], 'wifi')
            self.assertEqual(wifi['state'], 'connected')

    def test_get_wifi_info_anti_flapping_retains_cache_when_gateway_alive(self):
        """Bila cache sebelumnya connected, dan sample sesaat menghasilkan disconnected saat gateway masih ada,
        anti-flapping harus mempertahankan status connected."""
        import socket as _s
        clear_wifi_cache()

        # 1. Seed cache awal: connected
        with patch('src.core.network.sys.platform', 'win32'), \
             patch('subprocess.check_output', return_value="Name : Wi-Fi\nState : connected\nSSID : SolidWiFi\nSignal : 80%\n"), \
             patch('src.core.network.get_current_gateway', return_value='192.168.1.1'):
            first = get_wifi_info()
            self.assertTrue(first['connected'])
            self.assertEqual(first['ssid'], 'SolidWiFi')

        # 2. Paksa expire cache TTL
        import src.core.network as _net
        _net._WIFI_INFO_CACHE_TIME = 0.0

        # 3. Sample kedua: netsh gagal dan psutil kosong (glitch sesaat), TAPI gateway masih aktif di OS
        with patch('src.core.network.sys.platform', 'win32'), \
             patch('subprocess.check_output', return_value="Name : Wi-Fi\nState : disconnected\n"), \
             patch('psutil.net_if_stats', return_value={}), \
             patch('src.core.network.get_current_gateway', return_value='192.168.1.1'):
            second = get_wifi_info()
            # Anti-flapping mempertahankan state connected
            self.assertTrue(second['connected'])
            self.assertEqual(second['ssid'], 'SolidWiFi')

    def test_get_active_ip_offline_router_fallback(self):
        """Bila 8.8.8.8 gagal di-connect (intranet offline), get_active_ip harus fallback ke gateway lokal."""
        with patch('src.core.network.get_current_gateway', return_value='192.168.10.1'):
            mock_sock = unittest.mock.MagicMock()
            def fake_connect(addr):
                if addr[0] == '8.8.8.8':
                    raise OSError("No route to host")
                elif addr[0] == '192.168.10.1':
                    return None
                raise OSError("Refused")

            mock_sock.connect.side_effect = fake_connect
            mock_sock.getsockname.return_value = ('192.168.10.55', 0)
            mock_sock.__enter__.return_value = mock_sock

            with patch('src.core.network.socket.socket', return_value=mock_sock):
                ip = get_active_ip()
                self.assertEqual(ip, '192.168.10.55')

    def test_network_changed_ignores_empty_curr_interface(self):
        """Bila curr_interface kosong (glitch pembacaan transien), jangan memicu network_changed."""
        curr_gw = '192.168.1.1'
        prev_iface = 'Wi-Fi'
        with patch('src.core.network.get_current_gateway', return_value=curr_gw), \
             patch('src.core.network.get_network_info', return_value={'interface': ''}):
            self.assertFalse(is_network_changed(curr_gw, prev_iface))


if __name__ == '__main__':
    unittest.main()
