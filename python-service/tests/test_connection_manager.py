"""Regression test for ConnectionManager.broadcast() WebSocket fan-out.

Bug (ruff B023, loop-variable late-binding): the per-connection done-callback closed
over the loop variable `target_conn` by reference. Because broadcast() is always called
from a background thread while the callbacks fire later on the event-loop thread (after
the sync for-loop has finished), every callback observed only the LAST connection. On a
failing send that meant `disconnect()` removed the WRONG (healthy, last) socket instead
of the one that actually failed — silently dropping a live client while retaining a dead
one. This test locks in that each callback disconnects ITS OWN connection.
"""

import asyncio
import threading
import time
import unittest

from src.container import ConnectionManager


class _FakeWS:
    def __init__(self, name: str, fail: bool):
        self.name = name
        self.fail = fail
        self.sent = 0

    async def send_json(self, message):
        # Defer completion so the future is NOT done when broadcast() registers its
        # done-callback (mirrors production, where the loop is busy and the coroutine
        # finishes AFTER the sync registration loop). This is what surfaces the
        # late-binding bug deterministically instead of racing on an idle loop.
        await asyncio.sleep(0.05)
        if self.fail:
            raise RuntimeError(f"dead socket {self.name}")
        self.sent += 1


class TestConnectionManagerBroadcast(unittest.TestCase):
    def setUp(self):
        # Real event loop on a background thread (mirrors production: broadcast is called
        # from worker threads, the loop runs elsewhere -> callbacks fire after the loop).
        self.loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self._thread.start()
        for _ in range(200):
            if self.loop.is_running():
                break
            time.sleep(0.005)

    def tearDown(self):
        self.loop.call_soon_threadsafe(self.loop.stop)
        self._thread.join(timeout=2)
        self.loop.close()

    def _wait_until(self, predicate, timeout=2.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if predicate():
                return
            time.sleep(0.01)

    def test_broadcast_disconnects_failing_connection_not_last(self):
        cm = ConnectionManager(loop=self.loop)
        dead = _FakeWS("A_dead", fail=True)          # first: send fails
        healthy = _FakeWS("B_healthy", fail=False)   # last: send succeeds
        cm.active_connections = [dead, healthy]

        cm.broadcast({"event": "probe"})

        # Wait until a disconnect has happened (list shrinks from 2).
        self._wait_until(lambda: len(cm.active_connections) < 2)

        self.assertNotIn(dead, cm.active_connections,
                         "the connection whose send FAILED must be the one disconnected")
        self.assertIn(healthy, cm.active_connections,
                      "the healthy (last) connection must NOT be wrongly disconnected")

    def test_broadcast_all_healthy_keeps_all_connections(self):
        cm = ConnectionManager(loop=self.loop)
        a = _FakeWS("A", fail=False)
        b = _FakeWS("B", fail=False)
        cm.active_connections = [a, b]

        cm.broadcast({"event": "probe"})
        self._wait_until(lambda: a.sent and b.sent)

        self.assertIn(a, cm.active_connections)
        self.assertIn(b, cm.active_connections)
        self.assertEqual((a.sent, b.sent), (1, 1))


if __name__ == "__main__":
    unittest.main()
