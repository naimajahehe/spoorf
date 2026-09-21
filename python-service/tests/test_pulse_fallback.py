"""TDD for the power-save liveness pulse-fallback (option #1).

Problem (proven live): A55-milik-Hanif stays associated to Wi-Fi but answers ARP
only after ~587ms (power-save wake interval). The scan's candidate probe uses a
350ms timeout, so it misses the reply and marks the phone offline -> the device
flaps online/offline/online while physically connected.

Fix: when the cheap 350ms ARP probe misses a candidate that was RECENTLY online
(trust-fresh), fall back to the longer multi-vector pulse (which catches the
~587ms response) before declaring it offline. Dead / never-seen IPs are NOT
pulsed, so idle addresses stay offline cheaply without slowing the scan.
"""

import unittest

from src.core.discovery.liveness import (
    is_trust_fresh,
    verify_candidate_with_pulse_fallback,
)


class TestTrustFresh(unittest.TestCase):
    def test_recently_seen_is_fresh(self):
        now = 1000.0
        self.assertTrue(is_trust_fresh(now - 60, now, window=300))

    def test_stale_is_not_fresh(self):
        now = 1000.0
        self.assertFalse(is_trust_fresh(now - 600, now, window=300))

    def test_never_seen_is_not_fresh(self):
        self.assertFalse(is_trust_fresh(None, 1000.0, window=300))


class TestPulseFallback(unittest.TestCase):
    @staticmethod
    def _arp_hit(ip, mac, discovered, timeout):
        discovered[ip] = mac  # cheap 350ms probe found it

    @staticmethod
    def _arp_miss(ip, mac, discovered, timeout):
        pass  # cheap probe missed (power-save phone slow to wake)

    def test_fast_probe_hit_does_not_pulse(self):
        discovered, calls = {}, []
        pulse = lambda **kw: (calls.append(kw) or {"is_alive": True})
        verify_candidate_with_pulse_fallback(
            "192.168.110.2", "56:e9:8d:38:1c:97", "192.168.110.1", discovered,
            recently_online=True, pulse_fn=pulse, arp_probe_fn=self._arp_hit)
        self.assertIn("192.168.110.2", discovered)
        self.assertEqual(calls, [], "cheap probe won -> the expensive pulse must NOT run")

    def test_dead_ip_is_not_pulsed(self):
        discovered, calls = {}, []
        pulse = lambda **kw: (calls.append(kw) or {"is_alive": True})
        verify_candidate_with_pulse_fallback(
            "192.168.110.99", "aa:bb:cc:dd:ee:ff", "192.168.110.1", discovered,
            recently_online=False, pulse_fn=pulse, arp_probe_fn=self._arp_miss)
        self.assertNotIn("192.168.110.99", discovered)
        self.assertEqual(calls, [], "not trust-fresh -> no pulse -> no scan slowdown for idle IPs")

    def test_trust_fresh_dozing_host_caught_by_pulse(self):
        # THE A55 case: 350ms miss, but trust-fresh -> pulse (catches ~587ms) -> online.
        discovered = {}
        pulse = lambda **kw: {"is_alive": True, "resolved_mac": "56:e9:8d:38:1c:97"}
        verify_candidate_with_pulse_fallback(
            "192.168.110.2", "56:e9:8d:38:1c:97", "192.168.110.1", discovered,
            recently_online=True, pulse_fn=pulse, arp_probe_fn=self._arp_miss)
        self.assertIn("192.168.110.2", discovered)
        self.assertEqual(discovered["192.168.110.2"], "56:e9:8d:38:1c:97")

    def test_trust_fresh_but_truly_gone_stays_offline(self):
        discovered = {}
        pulse = lambda **kw: {"is_alive": False}
        verify_candidate_with_pulse_fallback(
            "192.168.110.2", "56:e9:8d:38:1c:97", "192.168.110.1", discovered,
            recently_online=True, pulse_fn=pulse, arp_probe_fn=self._arp_miss)
        self.assertNotIn("192.168.110.2", discovered)

    def test_pulse_exception_is_swallowed(self):
        discovered = {}
        def pulse(**kw):
            raise RuntimeError("engine busy")
        verify_candidate_with_pulse_fallback(
            "192.168.110.2", "56:e9:8d:38:1c:97", "192.168.110.1", discovered,
            recently_online=True, pulse_fn=pulse, arp_probe_fn=self._arp_miss)
        self.assertNotIn("192.168.110.2", discovered)  # no crash, stays offline


if __name__ == "__main__":
    unittest.main()
