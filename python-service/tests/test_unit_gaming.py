import unittest
import time
from src.core.gaming import GamingEngine, parse_ping_rtt_ms

class TestGamingEngine(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.engine = GamingEngine(event_callback=lambda name, data: self.events.append((name, data)))

    def tearDown(self):
        self.engine.toggle(False)

    # ===== Ping RTT parser (akar masalah "ping tinggi saat gaming") =====
    # Ping harus diambil dari nilai ICMP asli (time=/waktu=) di output ping, BUKAN
    # wall-clock mengelilingi spawn subprocess — yang membengkak saat CPU sibuk
    # (banyak thread spoof-loop) dan membuat ping tampak tinggi palsu.
    def test_parse_ping_rtt_english(self):
        out = ("Pinging 1.1.1.1 with 32 bytes of data:\n"
               "Reply from 1.1.1.1: bytes=32 time=34ms TTL=54\n")
        self.assertEqual(parse_ping_rtt_ms(out), 34.0)

    def test_parse_ping_rtt_sub_millisecond(self):
        out = "Reply from 192.168.1.1: bytes=32 time<1ms TTL=64\n"
        self.assertEqual(parse_ping_rtt_ms(out), 1.0)

    def test_parse_ping_rtt_indonesian_locale(self):
        out = ("Menerima balasan dari 1.1.1.1: bita=32 waktu=41ms TTL=54\n")
        self.assertEqual(parse_ping_rtt_ms(out), 41.0)

    def test_parse_ping_rtt_timeout_returns_none(self):
        out = ("Pinging 1.1.1.1 with 32 bytes of data:\n"
               "Request timed out.\n")
        self.assertIsNone(parse_ping_rtt_ms(out))

    def test_initial_state(self):
        status = self.engine.get_status()
        self.assertFalse(status['is_enabled'])
        self.assertEqual(status['mode'], 'auto_airtime')
        self.assertGreaterEqual(status['target_ping_ms'], 5.0)

    def test_toggle_on_and_off(self):
        # 1. Toggle ON
        on_status = self.engine.toggle(True, mode="blackhole_priority", target_ping_ms=20.0)
        self.assertTrue(on_status['is_enabled'])
        self.assertEqual(on_status['mode'], 'blackhole_priority')
        self.assertEqual(on_status['target_ping_ms'], 20.0)
        self.assertTrue(self.engine.is_enabled())

        # Event emitted
        self.assertTrue(any(e[0] == 'gaming_status_changed' for e in self.events))

        # 2. Toggle OFF
        off_status = self.engine.toggle(False)
        self.assertFalse(off_status['is_enabled'])
        self.assertFalse(self.engine.is_enabled())

    def test_telemetry_fields(self):
        status = self.engine.get_status()
        self.assertIn('ping_ms', status)
        self.assertIn('jitter_ms', status)
        self.assertIn('packet_loss_pct', status)
        self.assertIn('uptime_seconds', status)
        self.assertIsInstance(status['ping_ms'], (int, float))
        self.assertIsInstance(status['jitter_ms'], (int, float))

if __name__ == '__main__':
    unittest.main()
