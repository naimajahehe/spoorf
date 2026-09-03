#!/usr/bin/env python3
"""
Unit Tests for IPv6 NDP & RA Spoofer (Phase 4)
==============================================
Verifies:
1. IPv6 ICMPv6 Neighbor Advertisement & Router Advertisement packet crafting.
2. Core Invariants (Gateway Immunity, Controller Self-Protection).
3. Session lifecycle & Thread-Safe state management.
4. Clean Teardown restoration packet crafting.
"""

import unittest
from unittest.mock import patch, MagicMock
from scapy.all import Ether, IPv6, ICMPv6ND_NA, ICMPv6ND_RA, ICMPv6NDOptDstLLAddr
from src.core.spoofer_v6 import NDPSpoofer
from src.exceptions.custom import SpoofError, SessionNotFoundError


class TestUnitSpooferV6(unittest.TestCase):
    def setUp(self):
        refresh_patcher = patch.object(NDPSpoofer, 'refresh_interface')
        refresh_patcher.start()
        self.addCleanup(refresh_patcher.stop)
        self.spoofer = NDPSpoofer()
        self.spoofer._interface = "test-interface"
        self.spoofer._win_interface_name = "test-interface"
        self.spoofer._self_mac = "aa:bb:cc:dd:ee:ff"
        self.victim_ip = "fe80::100"
        self.victim_mac = "11:22:33:44:55:66"
        self.gateway_ip = "fe80::1"
        self.gateway_mac = "aa:11:22:33:44:55"

    def test_build_spoof_packets(self):
        """Uji apakah paket Scapy NA dan RA terformat dengan benar."""
        pkts = self.spoofer._build_spoof_packets(
            self.victim_ip,
            self.victim_mac,
            self.gateway_ip,
            self.gateway_mac,
            self.spoofer._self_mac
        )
        self.assertEqual(len(pkts), 3)

        # Paket 1: NA ke Korban
        p_vic = pkts[0]
        self.assertTrue(p_vic.haslayer(Ether))
        self.assertTrue(p_vic.haslayer(IPv6))
        self.assertTrue(p_vic.haslayer(ICMPv6ND_NA))
        self.assertEqual(p_vic[Ether].dst, self.victim_mac)
        self.assertEqual(p_vic[IPv6].dst, self.victim_ip)
        self.assertEqual(p_vic[ICMPv6ND_NA].tgt, self.gateway_ip)

        # Paket 3: RA drop (Router Lifetime = 0)
        p_ra = pkts[2]
        self.assertTrue(p_ra.haslayer(ICMPv6ND_RA))
        self.assertEqual(p_ra[ICMPv6ND_RA].routerlifetime, 0)

    def test_build_restore_packets(self):
        """Uji apakah paket restorasi resmi terbentuk sempurna."""
        pkts = self.spoofer._build_restore_packets(
            self.victim_ip,
            self.victim_mac,
            self.gateway_ip,
            self.gateway_mac
        )
        self.assertEqual(len(pkts), 2)
        # Paket 1 ke korban harus bersumber dari MAC asli gateway
        self.assertEqual(pkts[0][Ether].src, self.gateway_mac)
        self.assertEqual(pkts[0][ICMPv6ND_NA].R, 1)

    def test_gateway_immunity_invariant(self):
        """Uji bahwa Gateway IPv6 kebal dari manipulasi."""
        with self.assertRaises(SpoofError):
            self.spoofer.start_spoof(
                victim_ipv6=self.gateway_ip,
                victim_mac=self.gateway_mac,
                gateway_ipv6=self.gateway_ip,
                gateway_mac=self.gateway_mac
            )

    def test_self_protection_invariant(self):
        """Uji bahwa Controller Host kebal dari manipulasi IPv6."""
        with self.assertRaises(SpoofError):
            self.spoofer.start_spoof(
                victim_ipv6="fe80::controller",
                victim_mac=self.spoofer._self_mac,
                gateway_ipv6=self.gateway_ip,
                gateway_mac=self.gateway_mac
            )

    @patch('src.core.spoofer_v6.sendp')
    def test_session_lifecycle(self, mock_sendp):
        """Uji start, set_speed_limit, get_status, dan stop_spoof."""
        session_id = self.spoofer.start_spoof(
            victim_ipv6=self.victim_ip,
            victim_mac=self.victim_mac,
            gateway_ipv6=self.gateway_ip,
            gateway_mac=self.gateway_mac,
            speed_limit=50
        )
        self.assertTrue(session_id.startswith("v6_"))
        
        status = self.spoofer.get_status()
        self.assertEqual(status['active_sessions'], 1)
        self.assertIn(session_id, status['sessions'])
        self.assertEqual(status['sessions'][session_id]['speed_limit'], 50)

        # Update speed limit
        self.assertTrue(self.spoofer.set_speed_limit(session_id, 25))
        self.assertEqual(self.spoofer._sessions[session_id]['speed_limit'], 25)

        # Stop spoof
        self.spoofer.stop_spoof(session_id)
        self.assertEqual(len(self.spoofer._sessions), 0)

        # Stop non-existent raises SessionNotFoundError
        with self.assertRaises(SessionNotFoundError):
            self.spoofer.stop_spoof("non_existent_session")

    @patch('src.core.spoofer_v6.time.time', return_value=1725418980.0)
    @patch('src.core.spoofer_v6.threading.Thread')
    def test_same_second_recovery_sessions_keep_distinct_ipv6_ids(
        self, _mock_thread, _mock_time
    ):
        """Retained NDP cleanup state must survive a same-second restart."""
        _mock_thread.return_value.is_alive.return_value = False
        first_session_id = self.spoofer.start_spoof(
            victim_ipv6=self.victim_ip,
            victim_mac=self.victim_mac,
            gateway_ipv6=self.gateway_ip,
            gateway_mac=self.gateway_mac,
        )
        self.spoofer._sessions[first_session_id]['active'] = False

        recovery_session_id = self.spoofer.start_spoof(
            victim_ipv6=self.victim_ip,
            victim_mac=self.victim_mac,
            gateway_ipv6=self.gateway_ip,
            gateway_mac=self.gateway_mac,
        )

        self.assertNotEqual(first_session_id, recovery_session_id)
        self.assertTrue(first_session_id.startswith("v6_fe80__100_"))
        self.assertTrue(recovery_session_id.startswith("v6_fe80__100_"))
        self.assertEqual(len(self.spoofer._sessions), 2)
        self.assertTrue(self.spoofer._sessions[first_session_id]['active'] is False)
        self.assertTrue(self.spoofer._sessions[recovery_session_id]['active'])

    @patch('src.core.spoofer_v6.sendp')
    def test_ipv6_speed_limit_100_unrestricted_standby(self, mock_sendp):
        """Uji saat speed_limit=100%, sesi IPv6 berada dalam mode siaga tanpa mengirim paket racun."""
        session_id = self.spoofer.start_spoof(
            victim_ipv6=self.victim_ip,
            victim_mac=self.victim_mac,
            gateway_ipv6=self.gateway_ip,
            gateway_mac=self.gateway_mac,
            speed_limit=100
        )
        import time
        time.sleep(0.05)
        status = self.spoofer.get_status()
        self.assertEqual(status['active_sessions'], 1)
        self.assertEqual(status['sessions'][session_id]['speed_limit'], 100)
        self.spoofer.stop_spoof(session_id)

    @patch('src.core.spoofer_v6.sendp')
    def test_ipv6_restart_session_cleans_prior_zombie(self, mock_sendp):
        """Uji bahwa pemanggilan start_spoof ulang dengan target MAC yang sama membersihkan sesi lama."""
        sid1 = self.spoofer.start_spoof(
            victim_ipv6="fe80::100",
            victim_mac=self.victim_mac,
            gateway_ipv6=self.gateway_ip,
            gateway_mac=self.gateway_mac,
            speed_limit=50
        )
        self.assertEqual(self.spoofer.get_status()['active_sessions'], 1)

        # Start sesi kedua untuk MAC yang sama (misal target berganti IPv6 ke fe80::101)
        sid2 = self.spoofer.start_spoof(
            victim_ipv6="fe80::101",
            victim_mac=self.victim_mac,
            gateway_ipv6=self.gateway_ip,
            gateway_mac=self.gateway_mac,
            speed_limit=30
        )
        # Sesi lama harus terhapus, hanya menyisakan sesi baru
        self.assertNotEqual(sid1, sid2)
        status = self.spoofer.get_status()
        self.assertEqual(status['active_sessions'], 1)
        self.assertNotIn(sid1, status['sessions'])
        self.assertIn(sid2, status['sessions'])
        self.spoofer.stop_spoof(sid2)


if __name__ == '__main__':
    unittest.main()
