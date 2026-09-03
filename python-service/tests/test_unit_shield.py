import unittest
import threading
from unittest.mock import patch, MagicMock
from scapy.all import ARP, Ether
from src.core.shield import SentinelShield
from src.exceptions.custom import SpoofError


REAL_THREAD = threading.Thread


class FakeWorker:
    def __init__(
        self,
        *,
        stop_event=None,
        state_lock=None,
        prior_workers=None,
        stops_on_join=True,
    ):
        self.stop_event = stop_event
        self.state_lock = state_lock
        self.prior_workers = prior_workers or []
        self.stops_on_join = stops_on_join
        self.started = False
        self.joined = False
        self.join_timeout = None
        self.join_timeouts = []
        self.stop_was_set_during_join = False
        self.lock_was_free_during_join = False
        self.started_after_prior_join = False

    def start(self):
        self.started_after_prior_join = all(worker.joined for worker in self.prior_workers)
        self.started = True

    def join(self, timeout=None):
        self.join_timeout = timeout
        self.join_timeouts.append(timeout)
        self.stop_was_set_during_join = self.stop_event.is_set()
        self.lock_was_free_during_join = self.state_lock.acquire(blocking=False)
        if self.lock_was_free_during_join:
            self.state_lock.release()
        self.joined = self.stops_on_join

    def is_alive(self):
        return self.started and not self.joined


class FailingStartWorker(FakeWorker):
    def start(self):
        self.started = True
        raise RuntimeError("worker start failed")


class TestSentinelShield(unittest.TestCase):
    def setUp(self):
        self.shield = SentinelShield()

        def make_worker(**kwargs):
            stop_event = {
                'shield-threat-sniffer': self.shield._sniffer_stop_event,
                'shield-clean-heartbeat': self.shield._heartbeat_stop_event,
                'shield-lan-healer': self.shield._healing_stop_event,
            }[kwargs['name']]
            return FakeWorker(stop_event=stop_event, state_lock=self.shield._lock)

        self.thread_patcher = patch(
            'src.core.shield.threading.Thread',
            side_effect=make_worker
        )
        self.thread_patcher.start()
        self.self_mac_patcher = patch(
            'src.core.shield.get_self_mac',
            return_value='00:11:22:33:44:55'
        )
        self.self_mac_patcher.start()

    def tearDown(self):
        with patch.object(self.shield, '_unlock_kernel_neighbor', return_value=True), \
             patch('src.core.shield.get_current_gateway', return_value=''):
            self.shield.disable()
        self.self_mac_patcher.stop()
        self.thread_patcher.stop()

    @patch('src.core.shield.get_network_info')
    @patch('src.core.shield.get_current_gateway')
    @patch('src.core.shield.SentinelShield._resolve_gateway_mac')
    @patch('src.core.shield.SentinelShield._lock_kernel_neighbor')
    def test_enable_and_status(self, mock_lock, mock_resolve_mac, mock_gw, mock_info):
        mock_info.return_value = {'ip': '192.168.110.99', 'interface': 'Wi-Fi'}
        mock_gw.return_value = '192.168.110.1'
        mock_resolve_mac.return_value = '98:4a:6b:0f:4a:97'
        mock_lock.return_value = True

        res = self.shield.enable(mode='host_lock', auto_retaliate=False)
        self.assertTrue(res['is_enabled'])
        self.assertEqual(res['mode'], 'host_lock')
        self.assertEqual(res['gateway_ip'], '192.168.110.1')
        self.assertEqual(res['gateway_mac'], '98:4a:6b:0f:4a:97')

        status = self.shield.get_status()
        self.assertTrue(status['is_enabled'])
        self.assertEqual(status['mode'], 'host_lock')

    @patch('src.core.shield.get_network_info')
    @patch('src.core.shield.get_current_gateway')
    @patch('src.core.shield.SentinelShield._resolve_gateway_mac')
    @patch('src.core.shield.SentinelShield._lock_kernel_neighbor')
    def test_enable_fails_when_gateway_mac_unresolved(
        self, mock_lock, mock_resolve_mac, mock_gw, mock_info
    ):
        mock_info.return_value = {'ip': '192.168.110.99', 'interface': 'Wi-Fi'}
        mock_gw.return_value = '192.168.110.1'
        mock_resolve_mac.return_value = ''

        with self.assertRaises(SpoofError):
            self.shield.enable()

        self.assertFalse(self.shield.get_status()['is_enabled'])
        mock_lock.assert_not_called()

    @patch('src.core.shield.get_network_info')
    @patch('src.core.shield.get_current_gateway')
    @patch('src.core.shield.SentinelShield._resolve_gateway_mac')
    @patch('src.core.shield.SentinelShield._lock_kernel_neighbor')
    def test_enable_fails_when_neighbor_lock_fails(
        self, mock_lock, mock_resolve_mac, mock_gw, mock_info
    ):
        mock_info.return_value = {'ip': '192.168.110.99', 'interface': 'Wi-Fi'}
        mock_gw.return_value = '192.168.110.1'
        mock_resolve_mac.return_value = '98:4a:6b:0f:4a:97'
        mock_lock.return_value = False

        with self.assertRaises(SpoofError):
            self.shield.enable()

        self.assertFalse(self.shield.get_status()['is_enabled'])

    @patch('src.core.shield.sys.platform', 'win32')
    @patch('src.core.shield.subprocess.run')
    def test_kernel_neighbor_lock_requires_successful_command(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=1),
            MagicMock(returncode=1),
        ]

        locked = self.shield._lock_kernel_neighbor(
            '192.168.110.1',
            '98:4a:6b:0f:4a:97',
            'Wi-Fi'
        )

        self.assertFalse(locked)

    @patch('src.core.shield.get_network_info')
    @patch('src.core.shield.get_current_gateway')
    @patch('src.core.shield.SentinelShield._resolve_gateway_mac')
    @patch('src.core.shield.subprocess.run')
    @patch('src.core.shield.sys.platform', 'linux')
    def test_enable_fails_closed_on_unsupported_platform(
        self, mock_run, mock_resolve_mac, mock_gw, mock_info
    ):
        mock_info.return_value = {'ip': '192.168.110.99', 'interface': 'Wi-Fi'}
        mock_gw.return_value = '192.168.110.1'
        mock_resolve_mac.return_value = '98:4a:6b:0f:4a:97'

        with self.assertRaises(SpoofError):
            self.shield.enable()

        self.assertFalse(self.shield.get_status()['is_enabled'])
        mock_run.assert_not_called()

    @patch('src.core.shield.get_network_info')
    @patch('src.core.shield.get_current_gateway')
    @patch('src.core.shield.SentinelShield._resolve_gateway_mac')
    @patch('src.core.shield.SentinelShield._lock_kernel_neighbor')
    def test_enable_runs_network_operations_outside_state_lock(
        self, mock_lock, mock_resolve_mac, mock_gw, mock_info
    ):
        def assert_lock_free(value):
            acquired = self.shield._lock.acquire(blocking=False)
            self.assertTrue(acquired)
            self.shield._lock.release()
            return value

        mock_info.side_effect = lambda: assert_lock_free({
            'ip': '192.168.110.99',
            'interface': 'Wi-Fi'
        })
        mock_gw.side_effect = lambda: assert_lock_free('192.168.110.1')
        mock_resolve_mac.side_effect = lambda _ip: assert_lock_free('98:4a:6b:0f:4a:97')
        mock_lock.side_effect = lambda *_args: assert_lock_free(True)

        self.shield.enable()

    @patch('src.core.shield.get_network_info')
    @patch('src.core.shield.get_current_gateway')
    @patch('src.core.shield.SentinelShield._resolve_gateway_mac')
    @patch('src.core.shield.SentinelShield._lock_kernel_neighbor')
    @patch('src.core.shield.SentinelShield._unlock_kernel_neighbor')
    def test_rapid_restart_joins_prior_workers_before_reusing_stop_events(
        self, mock_unlock, mock_lock, mock_resolve_mac, mock_gw, mock_info
    ):
        mock_info.return_value = {'ip': '192.168.110.99', 'interface': 'Wi-Fi'}
        mock_gw.return_value = '192.168.110.1'
        mock_resolve_mac.return_value = '98:4a:6b:0f:4a:97'
        mock_lock.return_value = True

        workers = []
        prior_by_name = {}

        def make_worker(**kwargs):
            name = kwargs['name']
            stop_event = {
                'shield-threat-sniffer': self.shield._sniffer_stop_event,
                'shield-clean-heartbeat': self.shield._heartbeat_stop_event,
                'shield-lan-healer': self.shield._healing_stop_event,
            }[name]
            worker = FakeWorker(
                stop_event=stop_event,
                state_lock=self.shield._lock,
                prior_workers=list(prior_by_name.get(name, [])),
            )
            prior_by_name.setdefault(name, []).append(worker)
            workers.append(worker)
            return worker

        with patch('src.core.shield.threading.Thread', side_effect=make_worker):
            self.shield.enable(mode='lan_healing')
            self.shield.disable()
            self.shield.enable(mode='lan_healing')

        prior_workers = workers[:3]
        replacement_workers = workers[3:]
        self.assertEqual(len(replacement_workers), 3)
        self.assertTrue(all(worker.joined for worker in prior_workers))
        self.assertTrue(all(worker.join_timeout is not None for worker in prior_workers))
        self.assertTrue(all(worker.stop_was_set_during_join for worker in prior_workers))
        self.assertTrue(all(worker.lock_was_free_during_join for worker in prior_workers))
        self.assertTrue(all(worker.started_after_prior_join for worker in replacement_workers))

    @patch('src.core.shield.SentinelShield._unlock_kernel_neighbor', return_value=True)
    @patch('src.core.shield.SentinelShield._lock_kernel_neighbor', return_value=True)
    @patch(
        'src.core.shield.SentinelShield._resolve_gateway_mac',
        return_value='98:4a:6b:0f:4a:97',
    )
    @patch('src.core.shield.get_current_gateway', return_value='192.168.110.1')
    @patch(
        'src.core.shield.get_network_info',
        return_value={'ip': '192.168.110.99', 'interface': 'Wi-Fi'},
    )
    def test_enable_fails_closed_when_prior_worker_survives_bounded_join(
        self, mock_info, mock_gateway, mock_resolve, mock_lock, mock_unlock
    ):
        prior_worker = FakeWorker(
            stop_event=self.shield._sniffer_stop_event,
            state_lock=self.shield._lock,
            stops_on_join=False,
        )
        prior_worker.started = True
        self.shield._sniffer_thread = prior_worker
        self.shield._is_enabled = True
        self.shield._gateway_ip = '192.168.110.1'

        self.shield.disable()

        with patch('src.core.shield.threading.Thread') as thread_factory, \
             patch.object(
                 self.shield._sniffer_stop_event,
                 'clear',
                 wraps=self.shield._sniffer_stop_event.clear,
             ) as sniffer_clear, \
             patch.object(
                 self.shield._heartbeat_stop_event,
                 'clear',
                 wraps=self.shield._heartbeat_stop_event.clear,
             ) as heartbeat_clear, \
             patch.object(
                 self.shield._healing_stop_event,
                 'clear',
                 wraps=self.shield._healing_stop_event.clear,
             ) as healing_clear:
            with self.assertRaisesRegex(SpoofError, "sebelumnya belum berhenti"):
                self.shield.enable()

        self.assertEqual(prior_worker.join_timeouts, [2.0, 2.0])
        self.assertTrue(prior_worker.is_alive())
        self.assertTrue(self.shield._sniffer_stop_event.is_set())
        self.assertTrue(self.shield._heartbeat_stop_event.is_set())
        self.assertTrue(self.shield._healing_stop_event.is_set())
        self.assertIs(self.shield._sniffer_thread, prior_worker)
        self.assertFalse(self.shield._is_enabled)
        mock_unlock.assert_called_once_with('192.168.110.1', 'Wi-Fi')
        mock_info.assert_not_called()
        mock_gateway.assert_not_called()
        mock_resolve.assert_not_called()
        mock_lock.assert_not_called()
        thread_factory.assert_not_called()
        sniffer_clear.assert_not_called()
        heartbeat_clear.assert_not_called()
        healing_clear.assert_not_called()

    @patch('src.core.shield.get_network_info')
    @patch('src.core.shield.get_current_gateway')
    @patch('src.core.shield.SentinelShield._resolve_gateway_mac')
    @patch('src.core.shield.SentinelShield._lock_kernel_neighbor')
    @patch('src.core.shield.SentinelShield._unlock_kernel_neighbor')
    def test_enable_and_disable_transitions_do_not_overlap(
        self, mock_unlock, mock_lock, mock_resolve_mac, mock_gw, mock_info
    ):
        enable_entered = threading.Event()
        release_enable = threading.Event()
        disable_started = threading.Event()
        disable_done = threading.Event()
        errors = []

        def blocking_network_info():
            enable_entered.set()
            release_enable.wait(1.0)
            return {'ip': '192.168.110.99', 'interface': 'Wi-Fi'}

        def run_enable():
            try:
                self.shield.enable()
            except Exception as exc:
                errors.append(exc)

        def run_disable():
            disable_started.set()
            try:
                self.shield.disable()
            except Exception as exc:
                errors.append(exc)
            finally:
                disable_done.set()

        mock_info.side_effect = blocking_network_info
        mock_gw.return_value = '192.168.110.1'
        mock_resolve_mac.return_value = '98:4a:6b:0f:4a:97'
        mock_lock.return_value = True
        enable_thread = REAL_THREAD(target=run_enable)
        disable_thread = REAL_THREAD(target=run_disable)

        enable_thread.start()
        self.assertTrue(enable_entered.wait(1.0))
        disable_thread.start()
        self.assertTrue(disable_started.wait(1.0))
        self.assertFalse(disable_done.wait(0.05))
        release_enable.set()
        enable_thread.join(1.0)
        disable_thread.join(1.0)

        self.assertFalse(enable_thread.is_alive())
        self.assertFalse(disable_thread.is_alive())
        self.assertEqual(errors, [])
        self.assertFalse(self.shield.get_status()['is_enabled'])
        mock_unlock.assert_called_once()

    @patch('src.core.shield.get_network_info')
    @patch('src.core.shield.get_current_gateway')
    @patch('src.core.shield.SentinelShield._resolve_gateway_mac')
    @patch('src.core.shield.SentinelShield._lock_kernel_neighbor')
    @patch('src.core.shield.SentinelShield._unlock_kernel_neighbor')
    def test_enable_rolls_back_lock_and_started_workers_when_start_fails(
        self, mock_unlock, mock_lock, mock_resolve_mac, mock_gw, mock_info
    ):
        mock_info.return_value = {'ip': '192.168.110.99', 'interface': 'Wi-Fi'}
        mock_gw.return_value = '192.168.110.1'
        mock_resolve_mac.return_value = '98:4a:6b:0f:4a:97'
        mock_lock.return_value = True
        sniffer = FakeWorker(
            stop_event=self.shield._sniffer_stop_event,
            state_lock=self.shield._lock,
        )
        heartbeat = FailingStartWorker(
            stop_event=self.shield._heartbeat_stop_event,
            state_lock=self.shield._lock,
        )

        with patch('src.core.shield.threading.Thread', side_effect=[sniffer, heartbeat]):
            with self.assertRaisesRegex(RuntimeError, "worker start failed"):
                self.shield.enable()

        self.assertTrue(sniffer.joined)
        self.assertTrue(heartbeat.joined)
        self.assertEqual(sniffer.join_timeout, 2.0)
        self.assertEqual(heartbeat.join_timeout, 2.0)
        self.assertTrue(sniffer.stop_was_set_during_join)
        self.assertTrue(heartbeat.stop_was_set_during_join)
        mock_unlock.assert_called_once_with('192.168.110.1', 'Wi-Fi')
        status = self.shield.get_status()
        self.assertFalse(status['is_enabled'])
        self.assertIsNone(status['locked_at'])

    @patch('src.core.shield.SentinelShield._unlock_kernel_neighbor')
    def test_disable(self, mock_unlock):
        self.shield._is_enabled = True
        self.shield._gateway_ip = '192.168.110.1'
        res = self.shield.disable()
        self.assertFalse(res['is_enabled'])
        self.assertIsNone(res['locked_at'])

    def test_threat_recording_and_clearing(self):
        self.shield._threats.append({
            'id': 'threat_1',
            'attacker_ip': '192.168.110.55',
            'attacker_mac': 'aa:bb:cc:dd:ee:ff',
            'target_ip': '192.168.110.99',
            'claimed_ip': '192.168.110.1',
            'type': 'gateway_arp_spoof'
        })
        self.assertEqual(len(self.shield.get_threats()), 1)
        self.shield.clear_threats()
        self.assertEqual(len(self.shield.get_threats()), 0)

    @patch('src.core.shield.sniff')
    def test_threat_event_keeps_attacker_identity_distinct_from_claimed_ip(self, mock_sniff):
        events = []
        self.shield.set_event_callback(events.append)
        self.shield._gateway_ip = '192.168.110.1'
        self.shield._gateway_mac = '98:4a:6b:0f:4a:97'
        self.shield._self_mac = '00:11:22:33:44:55'
        packet = (
            Ether(src='de:ad:be:ef:00:01')
            / ARP(
                op=2,
                hwsrc='aa:bb:cc:dd:ee:ff',
                psrc='192.168.110.1',
                pdst='192.168.110.99',
            )
        )

        def process_once(**kwargs):
            self.assertTrue(kwargs['lfilter'](packet))
            kwargs['prn'](packet)
            self.shield._sniffer_stop_event.set()

        mock_sniff.side_effect = process_once

        self.shield._threat_sniffer_loop()

        self.assertEqual(len(events), 1)
        threat = events[0]['data']
        self.assertIsNone(threat['attacker_ip'])
        self.assertEqual(threat['attacker_mac'], 'aa:bb:cc:dd:ee:ff')
        self.assertEqual(threat['claimed_ip'], '192.168.110.1')
        self.assertEqual(threat['target_ip'], '192.168.110.99')

    @patch('src.core.shield.get_current_gateway', return_value='')
    def test_set_mode(self, _mock_gateway):
        res = self.shield.set_mode('lan_healing', auto_retaliate=True)
        self.assertEqual(res['mode'], 'lan_healing')
        self.assertTrue(res['auto_retaliate'])

    def test_set_mode_keeps_status_when_stuck_healing_worker_cannot_stop(self):
        """A timed-out healer leaves the previously published mode intact."""
        stuck_healer = FakeWorker(
            stop_event=self.shield._healing_stop_event,
            state_lock=self.shield._lock,
            stops_on_join=False,
        )
        stuck_healer.started = True
        self.shield._is_enabled = True
        self.shield._mode = 'lan_healing'
        self.shield._auto_retaliate = True
        self.shield._gateway_ip = '192.168.1.1'
        self.shield._healing_thread = stuck_healer

        with patch('src.core.shield.threading.Thread') as thread_factory:
            with self.assertRaisesRegex(SpoofError, 'belum berhenti'):
                self.shield.set_mode('host_lock', auto_retaliate=False)

        status = self.shield.get_status()
        self.assertEqual(status['mode'], 'lan_healing')
        self.assertTrue(status['auto_retaliate'])
        self.assertIs(self.shield._healing_thread, stuck_healer)
        thread_factory.assert_not_called()

    def test_set_mode_restores_status_when_replacement_healer_fails_to_start(self):
        """A failed replacement start cannot publish its requested mode."""
        failed_healer = FailingStartWorker(
            stop_event=self.shield._healing_stop_event,
            state_lock=self.shield._lock,
        )
        self.shield._is_enabled = True
        self.shield._mode = 'host_lock'
        self.shield._auto_retaliate = False
        self.shield._gateway_ip = '192.168.1.1'

        with patch('src.core.shield.threading.Thread', return_value=failed_healer):
            with self.assertRaisesRegex(RuntimeError, 'worker start failed'):
                self.shield.set_mode('lan_healing', auto_retaliate=True)

        status = self.shield.get_status()
        self.assertEqual(status['mode'], 'host_lock')
        self.assertFalse(status['auto_retaliate'])
        self.assertIsNone(self.shield._healing_thread)
        self.assertTrue(failed_healer.joined)

if __name__ == '__main__':
    unittest.main()
