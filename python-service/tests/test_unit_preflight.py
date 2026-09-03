"""
Unit Tests for the Port Pre-Bind Guard (src.utils.preflight)

Melindungi engine dari crash-loop akibat tabrakan bind port 8001
(WinError 10048 / EADDRINUSE). Bila engine Spoorf lain sudah memegang port,
entrypoint kedua harus keluar dengan tenang (exit 0) alih-alih menjalankan
startup lifespan lalu gagal bind — yang memicu respawn tanpa henti oleh
supervisor Electron. Bila port dipakai proses non-Spoorf, keluar dengan pesan
actionable (exit 1).
"""

import socket
import unittest

from src.utils.preflight import (
    decide,
    preflight,
    is_port_free,
    PreflightResult,
    PROCEED,
    EXIT_OK,
    EXIT_ERROR,
)


class TestDecide(unittest.TestCase):
    """Logika keputusan murni (tanpa I/O)."""

    def test_engine_alive_exits_gracefully(self):
        """Engine Spoorf lain aktif -> keluar tenang (exit 0), jangan respawn."""
        self.assertEqual(decide(engine_alive=True, port_free=False), (EXIT_OK, 0))

    def test_engine_alive_wins_even_if_port_probe_says_free(self):
        """Sinyal engine hidup lebih otoritatif daripada tebakan port bebas."""
        self.assertEqual(decide(engine_alive=True, port_free=True), (EXIT_OK, 0))

    def test_port_taken_by_other_process_is_error(self):
        """Port dipakai proses non-Spoorf -> error actionable (exit 1)."""
        self.assertEqual(decide(engine_alive=False, port_free=False), (EXIT_ERROR, 1))

    def test_port_free_proceeds(self):
        """Port bebas -> lanjut startup normal (exit 0)."""
        self.assertEqual(decide(engine_alive=False, port_free=True), (PROCEED, 0))


class TestPreflight(unittest.TestCase):
    """Orkestrasi preflight dengan probe yang di-inject (tanpa socket nyata)."""

    def test_sibling_engine_present_returns_exit_ok(self):
        result = preflight(
            "127.0.0.1", 8001,
            port_free_fn=lambda h, p: False,
            engine_probe_fn=lambda h, p: True,
        )
        self.assertIsInstance(result, PreflightResult)
        self.assertEqual(result.action, EXIT_OK)
        self.assertEqual(result.exit_code, 0)
        self.assertTrue(result.message)

    def test_engine_probe_skipped_when_port_free(self):
        """Bila port bebas, jangan repot memprobe /health; langsung proceed."""
        probed = {"called": False}

        def _probe(h, p):
            probed["called"] = True
            return True

        result = preflight(
            "127.0.0.1", 8001,
            port_free_fn=lambda h, p: True,
            engine_probe_fn=_probe,
        )
        self.assertEqual(result.action, PROCEED)
        self.assertEqual(result.exit_code, 0)
        self.assertFalse(probed["called"])

    def test_foreign_process_on_port_returns_exit_error(self):
        result = preflight(
            "127.0.0.1", 8001,
            port_free_fn=lambda h, p: False,
            engine_probe_fn=lambda h, p: False,
        )
        self.assertEqual(result.action, EXIT_ERROR)
        self.assertEqual(result.exit_code, 1)
        self.assertTrue(result.message)


class TestIsPortFree(unittest.TestCase):
    """Deteksi ketersediaan port nyata pada loopback."""

    def test_false_when_port_is_listening(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        s.listen(1)
        _, port = s.getsockname()
        try:
            self.assertFalse(is_port_free("127.0.0.1", port))
        finally:
            s.close()

    def test_true_when_port_is_available(self):
        # Ambil port ephemeral lalu lepaskan (tanpa listen -> tanpa TIME_WAIT).
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        _, port = s.getsockname()
        s.close()
        self.assertTrue(is_port_free("127.0.0.1", port))


if __name__ == "__main__":
    unittest.main()
