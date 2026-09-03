import unittest
import time
from unittest.mock import patch
from src.core.gaming import GamingEngine, parse_ping_rtt_ms


class FakeWorker:
    def __init__(self, *, stop_event=None, state_lock=None, prior_workers=None):
        self.stop_event = stop_event
        self.state_lock = state_lock
        self.prior_workers = prior_workers or []
        self.started = False
        self.joined = False
        self.join_timeout = None
        self.stop_was_set_during_join = False
        self.lock_was_free_during_join = False
        self.started_after_prior_join = False

    def start(self):
        self.started_after_prior_join = all(worker.joined for worker in self.prior_workers)
        self.started = True

    def join(self, timeout=None):
        self.join_timeout = timeout
        self.stop_was_set_during_join = self.stop_event.is_set()
        self.lock_was_free_during_join = self.state_lock.acquire(blocking=False)
        if self.lock_was_free_during_join:
            self.state_lock.release()
        self.joined = True

    def is_alive(self):
        return self.started and not self.joined


class TestGamingEngine(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.engine = GamingEngine(event_callback=lambda name, data: self.events.append((name, data)))
        self.thread_patcher = patch(
            'src.core.gaming.threading.Thread',
            side_effect=lambda **kwargs: FakeWorker(
                stop_event=self.engine._stop_event,
                state_lock=self.engine._lock,
            )
        )
        self.thread_patcher.start()

    def tearDown(self):
        self.engine.toggle(False)
        self.thread_patcher.stop()

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

    def test_rapid_restart_joins_prior_worker_before_reusing_stop_event(self):
        workers = []

        def make_worker(**_kwargs):
            worker = FakeWorker(
                stop_event=self.engine._stop_event,
                state_lock=self.engine._lock,
                prior_workers=list(workers),
            )
            workers.append(worker)
            return worker

        with patch('src.core.gaming.threading.Thread', side_effect=make_worker):
            self.engine.toggle(True)
            self.engine.toggle(False)
            self.engine.toggle(True)

        self.assertEqual(len(workers), 2)
        self.assertTrue(workers[0].joined)
        self.assertIsNotNone(workers[0].join_timeout)
        self.assertTrue(workers[0].stop_was_set_during_join)
        self.assertTrue(workers[0].lock_was_free_during_join)
        self.assertTrue(workers[1].started_after_prior_join)

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
