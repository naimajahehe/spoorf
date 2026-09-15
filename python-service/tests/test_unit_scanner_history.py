"""
Unit tests for NetworkScanner device-history lifecycle (ULTRAREVIEW #4).

The network watchdog wipes _DEVICE_HISTORY on every AP/network change while scanner
threads iterate it under _HISTORY_LOCK. A lock-free .clear() can interleave with a
locked list()/lookup and raise 'dictionary changed size during iteration'. clear_history()
must perform the wipe while holding _HISTORY_LOCK.
"""

import threading
import unittest

from src.core.scanner import NetworkScanner


class TestScannerHistoryClear(unittest.TestCase):

    def setUp(self):
        with NetworkScanner._HISTORY_LOCK:
            NetworkScanner._DEVICE_HISTORY.clear()

    def tearDown(self):
        # Never leave the shared lock held if an assertion aborted mid-test.
        if NetworkScanner._HISTORY_LOCK.locked():
            NetworkScanner._HISTORY_LOCK.release()
        with NetworkScanner._HISTORY_LOCK:
            NetworkScanner._DEVICE_HISTORY.clear()

    def test_clear_history_empties_dict(self):
        """clear_history() must empty the shared history map."""
        with NetworkScanner._HISTORY_LOCK:
            NetworkScanner._DEVICE_HISTORY['aa:bb:cc:dd:ee:ff'] = {
                'ip': '192.168.1.5', 'mac': 'aa:bb:cc:dd:ee:ff'
            }
        NetworkScanner.clear_history()
        self.assertEqual(NetworkScanner._DEVICE_HISTORY, {})

    def test_clear_history_acquires_lock(self):
        """clear_history() must block while _HISTORY_LOCK is held elsewhere — proving it
        takes the lock instead of mutating the dict lock-free."""
        with NetworkScanner._HISTORY_LOCK:
            NetworkScanner._DEVICE_HISTORY['aa:bb:cc:dd:ee:ff'] = {
                'ip': '192.168.1.5', 'mac': 'aa:bb:cc:dd:ee:ff'
            }

        cleared = threading.Event()

        def worker():
            NetworkScanner.clear_history()
            cleared.set()

        NetworkScanner._HISTORY_LOCK.acquire()
        held_by_us = True
        try:
            t = threading.Thread(target=worker, daemon=True)
            t.start()
            # While we hold the lock, clear_history must not complete or mutate.
            self.assertFalse(cleared.wait(0.3), 'clear_history ran without acquiring the lock')
            self.assertIn('aa:bb:cc:dd:ee:ff', NetworkScanner._DEVICE_HISTORY)
            # Release → the worker proceeds and clears under the lock.
            NetworkScanner._HISTORY_LOCK.release()
            held_by_us = False
            self.assertTrue(cleared.wait(1.0), 'clear_history did not proceed after lock release')
            t.join(timeout=1.0)
            self.assertEqual(NetworkScanner._DEVICE_HISTORY, {})
        finally:
            if held_by_us and NetworkScanner._HISTORY_LOCK.locked():
                NetworkScanner._HISTORY_LOCK.release()


if __name__ == '__main__':
    unittest.main()
