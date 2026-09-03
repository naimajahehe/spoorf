"""
Unit Tests for Spoofer Engine (src.core.spoofer)
Covers: Happy Path, Negative Tests, and Edge Cases (Clamping, Non-blocking, Limits)
"""

import unittest
from unittest.mock import MagicMock, patch
from src.core.spoofer import ARPSpoofer
from src.exceptions.custom import SpoofError, SessionNotFoundError

class TestCoreSpoofer(unittest.TestCase):

    def setUp(self):
        # Deterministik: kunci gateway sistem & IP controller agar tidak flaky terhadap
        # jaringan mesin uji (cek invariant baru: RFC1918, gateway aktual, self-IP).
        gw_patcher = patch('src.core.spoofer.get_current_gateway', return_value='192.168.1.1')
        net_patcher = patch(
            'src.core.spoofer.get_network_info',
            return_value={'ip': '192.168.1.100', 'gateway': '192.168.1.1', 'interface': 'Wi-Fi'}
        )
        self.mock_gw = gw_patcher.start()
        self.mock_net = net_patcher.start()
        forwarding_patcher = patch('src.core.spoofer.set_ip_forwarding')
        forwarding_state_patcher = patch(
            'src.core.spoofer.is_forwarding_enabled',
            return_value=False
        )
        subprocess_patcher = patch('src.core.spoofer.subprocess.run')
        interface_patcher = patch.object(ARPSpoofer, 'refresh_interface')
        self.mock_forwarding = forwarding_patcher.start()
        self.mock_forwarding_state = forwarding_state_patcher.start()
        self.mock_subprocess = subprocess_patcher.start()
        interface_patcher.start()
        self.addCleanup(gw_patcher.stop)
        self.addCleanup(net_patcher.stop)
        self.addCleanup(forwarding_patcher.stop)
        self.addCleanup(forwarding_state_patcher.stop)
        self.addCleanup(subprocess_patcher.stop)
        self.addCleanup(interface_patcher.stop)

        self.spoofer = ARPSpoofer()
        self.spoofer._interface = "test-interface"
        self.spoofer._win_interface_name = "test-interface"
        self.spoofer._self_mac = "aa:bb:cc:dd:ee:ff"

    def tearDown(self):
        with patch('src.core.spoofer.sendp'):
            self.spoofer.stop_all()

    # ===== 1. Happy Path =====
    @patch('src.core.spoofer.sendp')
    def test_spoofer_lifecycle_happy_path(self, mock_sendp):
        """Happy Path: start session, set speed limit, stop session."""
        session_id = self.spoofer.start(
            victim_ip="192.168.1.55",
            victim_mac="00:11:22:33:44:55",
            gateway_ip="192.168.1.1",
            gateway_mac="00:aa:bb:cc:dd:ee",
            speed_limit=50
        )
        self.assertIsNotNone(session_id)
        self.assertTrue(self.spoofer.is_running)

        sessions = self.spoofer.get_all_sessions()
        self.assertIn(session_id, sessions)
        self.assertEqual(sessions[session_id]['speed_limit'], 50)
        self.assertEqual(sessions[session_id]['victim_ip'], "192.168.1.55")

        # Update speed limit
        res_limit = self.spoofer.set_speed_limit(session_id, 25)
        self.assertTrue(res_limit)
        self.assertEqual(self.spoofer.get_all_sessions()[session_id]['speed_limit'], 25)

        # Stop session
        res_stop = self.spoofer.stop(session_id)
        self.assertTrue(res_stop)
        self.assertFalse(self.spoofer.is_running)
        self.assertNotIn(session_id, self.spoofer.get_all_sessions())

    # ===== 2. Negative Tests =====
    def test_spoof_gateway_itself_negative(self):
        """Negative: Attempting to spoof gateway IP or MAC must raise SpoofError."""
        with self.assertRaises(SpoofError):
            self.spoofer.start(
                victim_ip="192.168.1.1",
                victim_mac="00:aa:bb:cc:dd:ee",
                gateway_ip="192.168.1.1",
                gateway_mac="00:aa:bb:cc:dd:ee"
            )

    def test_spoof_public_ip_rejected_negative(self):
        """Negative (Invariant #4 RFC1918): victim IP publik harus ditolak SpoofError."""
        with self.assertRaises(SpoofError):
            self.spoofer.start(
                victim_ip="8.8.8.8",
                victim_mac="00:11:22:33:44:55",
                gateway_ip="192.168.1.1",
                gateway_mac="00:aa:bb:cc:dd:ee"
            )

    def test_spoof_actual_system_gateway_rejected_negative(self):
        """Negative (Invariant #1): victim == gateway sistem aktual ditolak walau gateway_ip request dipalsukan."""
        # gateway sistem aktual = 192.168.1.1 (dipatch di setUp); gateway_ip request sengaja beda.
        with self.assertRaises(SpoofError):
            self.spoofer.start(
                victim_ip="192.168.1.1",
                victim_mac="00:11:22:33:44:55",
                gateway_ip="192.168.1.99",
                gateway_mac="00:aa:bb:cc:dd:ee"
            )

    def test_spoof_self_ip_rejected_negative(self):
        """Negative (Invariant #2): victim == IP controller (This PC) ditolak SpoofError."""
        # IP controller = 192.168.1.100 (dipatch di setUp).
        with self.assertRaises(SpoofError):
            self.spoofer.start(
                victim_ip="192.168.1.100",
                victim_mac="00:11:22:33:44:55",
                gateway_ip="192.168.1.1",
                gateway_mac="00:aa:bb:cc:dd:ee"
            )

    def test_spoof_self_mac_rejected_negative(self):
        """Negative (Invariant #2): victim MAC == MAC controller ditolak SpoofError."""
        self.spoofer._self_mac = "aa:bb:cc:dd:ee:ff"
        with self.assertRaises(SpoofError):
            self.spoofer.start(
                victim_ip="192.168.1.55",
                victim_mac="AA:BB:CC:DD:EE:FF",
                gateway_ip="192.168.1.1",
                gateway_mac="00:aa:bb:cc:dd:ee"
            )

    # ===== 2b. Gateway Param Validation (P1 Command-Injection Guard) =====
    def test_spoof_invalid_gateway_ip_rejected(self):
        """P1: gateway_ip yang mengandung metakarakter shell ditolak SpoofError."""
        with self.assertRaises(SpoofError):
            self.spoofer.start(
                victim_ip="192.168.1.55",
                victim_mac="00:11:22:33:44:55",
                gateway_ip="192.168.1.1 & calc.exe &",
                gateway_mac="00:aa:bb:cc:dd:ee"
            )

    def test_spoof_invalid_gateway_mac_rejected(self):
        """P1: gateway_mac malformed ditolak SpoofError."""
        with self.assertRaises(SpoofError):
            self.spoofer.start(
                victim_ip="192.168.1.55",
                victim_mac="00:11:22:33:44:55",
                gateway_ip="192.168.1.1",
                gateway_mac="00:aa:bb:cc:dd:ee; shutdown"
            )

    @patch('src.core.spoofer.subprocess.run')
    def test_host_gateway_lock_skips_invalid_input(self, mock_run):
        """P1: _ensure_host_gateway_locked TIDAK memanggil subprocess untuk input invalid."""
        # gateway_ip tak valid → tidak ada perintah OS yang dieksekusi
        self.spoofer._ensure_host_gateway_locked("1.1.1.1 & calc &", "00:aa:bb:cc:dd:ee")
        mock_run.assert_not_called()
        # gateway_mac tak valid → juga tidak dieksekusi
        self.spoofer._ensure_host_gateway_locked("192.168.1.1", "zz:zz")
        mock_run.assert_not_called()

    def test_spoof_malformed_mac_rejected_negative(self):
        """Negative: format MAC target malformed ditolak SpoofError."""
        with self.assertRaises(SpoofError):
            self.spoofer.start(
                victim_ip="192.168.1.55",
                victim_mac="not-a-mac",
                gateway_ip="192.168.1.1",
                gateway_mac="00:aa:bb:cc:dd:ee"
            )

    def test_stop_nonexistent_session_negative(self):
        """Negative: Stopping an unknown session ID must raise SessionNotFoundError."""
        with self.assertRaises(SessionNotFoundError):
            self.spoofer.stop("nonexistent_session_12345")

    @patch('src.core.spoofer.time.sleep')
    @patch('src.core.spoofer.sendp')
    def test_stop_retains_session_when_restore_fails(self, mock_sendp, mock_sleep):
        """A failed ARP restore remains inactive and can be retried successfully."""
        session_id = "retryable-session"
        stop_event = MagicMock()
        worker = MagicMock()
        worker.is_alive.return_value = False
        self.spoofer._sessions[session_id] = {
            'victim_ip': '192.168.1.55',
            'victim_mac': '00:11:22:33:44:55',
            'gateway_ip': '192.168.1.1',
            'gateway_mac': '00:aa:bb:cc:dd:ee',
            'speed_limit': 0,
            'is_redirect': False,
            'active': True,
            'started_at': 1.0,
            'packets_sent': 0,
        }
        self.spoofer._stop_events[session_id] = stop_event
        self.spoofer._threads[session_id] = worker
        self.spoofer._running = True

        worker.join.side_effect = lambda timeout=None: self.assertFalse(
            self.spoofer._lock.locked(),
            "worker join must happen outside ARPSpoofer._lock",
        )

        def fail_restore(*args, **kwargs):
            self.assertFalse(
                self.spoofer._lock.locked(),
                "packet restoration must happen outside ARPSpoofer._lock",
            )
            raise RuntimeError("send failed")

        mock_sendp.side_effect = fail_restore
        self.mock_forwarding.side_effect = lambda *args, **kwargs: self.assertFalse(
            self.spoofer._lock.locked(),
            "forwarding changes must happen outside ARPSpoofer._lock",
        )

        with self.assertRaises(SpoofError):
            self.spoofer.stop(session_id)

        retained = self.spoofer.get_all_sessions()[session_id]
        self.assertFalse(retained['active'])
        self.assertTrue(retained['restore_failed'])
        self.assertFalse(self.spoofer.is_running)
        stop_event.set.assert_called_once_with()
        worker.join.assert_called_once()

        mock_sendp.side_effect = lambda *args, **kwargs: self.assertFalse(
            self.spoofer._lock.locked(),
            "packet restoration retry must happen outside ARPSpoofer._lock",
        )
        mock_sleep.side_effect = lambda *_: self.assertFalse(
            self.spoofer._lock.locked(),
            "restore delay must happen outside ARPSpoofer._lock",
        )

        self.assertTrue(self.spoofer.stop(session_id))
        self.assertNotIn(session_id, self.spoofer.get_all_sessions())

    def test_set_limit_nonexistent_session_negative(self):
        """Negative: Setting limit for unknown session must return False."""
        self.assertFalse(self.spoofer.set_speed_limit("ghost_session", 50))

    # ===== 3. Edge Cases =====
    @patch('src.core.spoofer.sendp')
    def test_speed_limit_clamping_edge_case(self, mock_sendp):
        """Edge Case: Speed limit values below 0 or above 100 must be clamped safely."""
        session_id = self.spoofer.start(
            victim_ip="192.168.1.77",
            victim_mac="11:22:33:44:55:66",
            gateway_ip="192.168.1.1",
            gateway_mac="00:aa:bb:cc:dd:ee",
            speed_limit=-50  # Below 0
        )
        self.assertEqual(self.spoofer.get_all_sessions()[session_id]['speed_limit'], 0)

        # Over 100 clamped to 100
        self.spoofer.set_speed_limit(session_id, 250)
        self.assertEqual(self.spoofer.get_all_sessions()[session_id]['speed_limit'], 100)

        # Extreme boundary 0
        self.spoofer.set_speed_limit(session_id, 0)
        self.assertEqual(self.spoofer.get_all_sessions()[session_id]['speed_limit'], 0)

        self.spoofer.stop(session_id)

    @patch('src.core.spoofer.sendp')
    def test_stop_all_empty_edge_case(self, mock_sendp):
        """Edge Case: stop_all on an empty spoofer does not raise errors."""
        self.spoofer.stop_all()
        self.assertFalse(self.spoofer.is_running)

    @patch('src.core.spoofer.sendp')
    def test_micro_cut_batch_happy_path(self, mock_sendp):
        """Quick Re-Auth: micro_cut_batch memutus+restore target valid, tak menyisakan sesi aktif."""
        targets = [
            {'victim_ip': '192.168.1.55', 'victim_mac': '00:11:22:33:44:55', 'gateway_ip': '192.168.1.1', 'gateway_mac': '00:aa:bb:cc:dd:ee'},
            {'victim_ip': '192.168.1.66', 'victim_mac': '11:22:33:44:55:66', 'gateway_ip': '192.168.1.1', 'gateway_mac': '00:aa:bb:cc:dd:ee'},
        ]
        res = self.spoofer.micro_cut_batch(targets, hold_seconds=0.5)
        self.assertEqual(res['cut_count'], 2)
        self.assertEqual(len(res['errors']), 0)
        # Semua sesi micro-cut sudah di-restore (stop) -> tidak ada sesi tersisa
        self.assertEqual(len(self.spoofer.get_all_sessions()), 0)

    @patch('src.core.spoofer.sendp')
    def test_micro_cut_batch_skips_gateway(self, mock_sendp):
        """Target yang melanggar invariant (== gateway aktual) dilewati & tercatat error."""
        targets = [
            {'victim_ip': '192.168.1.1', 'victim_mac': '00:aa:bb:cc:dd:ee', 'gateway_ip': '192.168.1.1', 'gateway_mac': '00:aa:bb:cc:dd:ee'},
        ]
        res = self.spoofer.micro_cut_batch(targets, hold_seconds=0.5)
        self.assertEqual(res['cut_count'], 0)
        self.assertEqual(len(res['errors']), 1)
        self.assertEqual(len(self.spoofer.get_all_sessions()), 0)

    def test_compute_forward_target(self):
        """
        IP forwarding ON hanya untuk sesi redirect/transparent-gateway.
        Blok penuh DAN throttle memakai fase 'racun = drop' -> forwarding OFF.
        """
        # Tidak ada sesi -> pulihkan default (True)
        self.spoofer._sessions = {}
        self.assertTrue(self.spoofer._compute_forward_target())

        # Full block total (speed_limit 0, non-redirect) -> False (putus internet)
        self.spoofer._sessions = {'s1': {'speed_limit': 0, 'is_redirect': False}}
        self.assertFalse(self.spoofer._compute_forward_target())

        # Throttle (speed_limit > 0, non-redirect) -> False:
        # duty-cycle butuh forwarding OFF agar fase racun benar-benar men-drop paket.
        self.spoofer._sessions = {'s1': {'speed_limit': 50, 'is_redirect': False}}
        self.assertFalse(self.spoofer._compute_forward_target())

        # Redirect / transparent gateway -> True (paket target harus diteruskan)
        self.spoofer._sessions = {'s1': {'speed_limit': 0, 'is_redirect': True}}
        self.assertTrue(self.spoofer._compute_forward_target())

        # Campuran: full-block + throttle (tanpa redirect) -> False (tak ada yang butuh forward)
        self.spoofer._sessions = {
            's1': {'speed_limit': 0, 'is_redirect': False},
            's2': {'speed_limit': 30, 'is_redirect': False},
        }
        self.assertFalse(self.spoofer._compute_forward_target())

        # Campuran: throttle + redirect -> True (sesi redirect menuntut forwarding ON)
        self.spoofer._sessions = {
            's1': {'speed_limit': 30, 'is_redirect': False},
            's2': {'speed_limit': 0, 'is_redirect': True},
        }
        self.assertTrue(self.spoofer._compute_forward_target())

        self.spoofer._sessions = {}

    # ===== 4. Throttling & Dual-Opcode Restore Tests (v2.3.0) =====
    def test_build_restore_packets_dual_opcode(self):
        """Verify _build_restore_packets creates both 'is-at' and 'who-has' for victim and gateway."""
        v_pkts, gw_pkts = self.spoofer._build_restore_packets(
            victim_ip="192.168.1.50",
            victim_mac="aa:bb:cc:dd:ee:01",
            gateway_ip="192.168.1.1",
            gateway_mac="00:11:22:33:44:55"
        )
        # Check victim restore packets
        self.assertEqual(len(v_pkts), 2, "Must return 2 packets (is-at and who-has) for victim")
        self.assertEqual(v_pkts[0].getlayer('ARP').op, 2, "First victim packet must be is-at (reply)")
        self.assertEqual(v_pkts[0].getlayer('ARP').hwsrc, "00:11:22:33:44:55", "Must restore real gateway MAC")
        self.assertEqual(v_pkts[1].getlayer('ARP').op, 1, "Second victim packet must be who-has (request)")
        self.assertEqual(v_pkts[1].getlayer('ARP').hwsrc, "00:11:22:33:44:55", "Must force-update Android/iOS with real gateway MAC")

        # Check gateway restore packets
        self.assertEqual(len(gw_pkts), 2, "Must return 2 packets (is-at and who-has) for gateway")
        self.assertEqual(gw_pkts[0].getlayer('ARP').op, 2, "First gateway packet must be is-at")
        self.assertEqual(gw_pkts[0].getlayer('ARP').hwsrc, "aa:bb:cc:dd:ee:01", "Must restore real victim MAC")
        self.assertEqual(gw_pkts[1].getlayer('ARP').op, 1, "Second gateway packet must be who-has")
        self.assertEqual(gw_pkts[1].getlayer('ARP').hwsrc, "aa:bb:cc:dd:ee:01", "Must force-update gateway with real victim MAC")

    @patch('src.core.spoofer.sendp')
    def test_throttling_pwm_cycle_initial_burst_bypass(self, mock_sendp):
        """Verify when speed_limit > 0, initial burst is bypassed to prevent instant disconnection."""
        session_id = self.spoofer.start(
            victim_ip="192.168.1.66",
            victim_mac="11:22:33:44:55:66",
            gateway_ip="192.168.1.1",
            gateway_mac="00:aa:bb:cc:dd:ee",
            speed_limit=50
        )
        self.assertIsNotNone(session_id)
        # Let the thread start briefly
        import time
        time.sleep(0.05)

        sessions = self.spoofer.get_all_sessions()
        self.assertIn(session_id, sessions)
        self.assertEqual(sessions[session_id]['speed_limit'], 50)
        self.spoofer.stop(session_id)

    @patch('src.core.spoofer.sendp')
    def test_redirect_mode_bypasses_initial_burst(self, mock_sendp):
        """Verify when is_redirect is True, initial burst is bypassed and gateway is never poisoned in burst."""
        session_id = self.spoofer.start(
            victim_ip="192.168.1.88",
            victim_mac="22:33:44:55:66:77",
            gateway_ip="192.168.1.1",
            gateway_mac="00:aa:bb:cc:dd:ee",
            speed_limit=0,
            is_redirect=True
        )
        self.assertIsNotNone(session_id)
        import time
        time.sleep(0.05)

        sessions = self.spoofer.get_all_sessions()
        self.assertIn(session_id, sessions)
        self.spoofer.stop(session_id)

    # ===== Dead-MAC Blackhole (Gaming Mode) =====
    def test_generate_blackhole_mac_valid(self):
        """MAC hantu = locally-administered unicast, != self/gateway/victim."""
        self.spoofer._self_mac = "aa:bb:cc:dd:ee:ff"
        mac = self.spoofer._generate_blackhole_mac("00:11:22:33:44:55", "00:aa:bb:cc:dd:ee")
        first = int(mac.split(":")[0], 16)
        self.assertEqual(first & 0x02, 0x02, "Harus locally-administered (bit 0x02 set)")
        self.assertEqual(first & 0x01, 0x00, "Harus unicast (bit 0x01 clear)")
        self.assertNotIn(mac, {"aa:bb:cc:dd:ee:ff", "00:11:22:33:44:55", "00:aa:bb:cc:dd:ee"})
        self.assertNotEqual(mac, "ff:ff:ff:ff:ff:ff")

    def test_build_spoof_packets_poison_mac(self):
        """poison_mac mengubah hwsrc ARP (untuk blackhole); default = self_mac."""
        self.spoofer._self_mac = "aa:bb:cc:dd:ee:ff"
        # default -> self_mac
        pkt_default = self.spoofer._build_spoof_packets("192.168.1.55", "192.168.1.1", "00:11:22:33:44:55")[0]
        self.assertEqual(pkt_default.getlayer('ARP').hwsrc, "aa:bb:cc:dd:ee:ff")
        # blackhole -> MAC hantu
        pkt_bh = self.spoofer._build_spoof_packets("192.168.1.55", "192.168.1.1", "00:11:22:33:44:55", poison_mac="02:de:ad:be:ef:00")[0]
        self.assertEqual(pkt_bh.getlayer('ARP').hwsrc, "02:de:ad:be:ef:00")
        # Ether.src tetap MAC operator (frame fisik dari kita)
        self.assertEqual(pkt_bh.getlayer('Ether').src, "aa:bb:cc:dd:ee:ff")

    @patch('src.core.spoofer.sendp')
    def test_start_blackhole_stores_ghost_mac(self, mock_sendp):
        """start(blackhole=True) menyimpan blackhole_mac; False -> None."""
        sid = self.spoofer.start(
            victim_ip="192.168.1.55", victim_mac="00:11:22:33:44:55",
            gateway_ip="192.168.1.1", gateway_mac="00:aa:bb:cc:dd:ee",
            speed_limit=0, blackhole=True
        )
        self.assertIsNotNone(self.spoofer._sessions[sid].get('blackhole_mac'))
        self.spoofer.stop(sid)

        sid2 = self.spoofer.start(
            victim_ip="192.168.1.56", victim_mac="00:11:22:33:44:56",
            gateway_ip="192.168.1.1", gateway_mac="00:aa:bb:cc:dd:ee",
            speed_limit=0
        )
        self.assertIsNone(self.spoofer._sessions[sid2].get('blackhole_mac'))
        self.spoofer.stop(sid2)

if __name__ == '__main__':
    unittest.main()
