"""Unit tests for Centralized Configuration Engine (src.config)."""

import os
import unittest
from unittest.mock import patch


class TestEngineSettings(unittest.TestCase):
    def setUp(self):
        # Bersihkan env var yang mungkin mengotori test
        self.env_patcher = patch.dict(os.environ, {}, clear=False)
        self.env_patcher.start()

    def tearDown(self):
        self.env_patcher.stop()

    def test_default_values(self):
        """Verifikasi seluruh nilai default sesuai spesifikasi."""
        from src.config import EngineSettings

        settings = EngineSettings()
        self.assertEqual(settings.HOST, "127.0.0.1")
        self.assertEqual(settings.PORT, 8001)
        self.assertEqual(settings.APP_VERSION, "2.41.66")
        self.assertEqual(settings.ENVIRONMENT, "development")
        self.assertEqual(settings.LOG_LEVEL, "INFO")
        self.assertEqual(settings.LOG_FORMAT, "text")
        self.assertEqual(settings.MAX_WORKERS, 5)
        self.assertIsNone(settings.SENTINEL_API_TOKEN)
        self.assertFalse(settings.SENTINEL_ALLOW_INSECURE_DEV)
        self.assertEqual(settings.PY_CORS_ORIGINS, "")
        self.assertEqual(settings.cors_origins, [])
        self.assertFalse(settings.is_production)
        self.assertEqual(settings.ARP_TIMEOUT, 3)
        self.assertEqual(settings.SPOOF_INTERVAL, 1)

    def test_env_overrides(self):
        """Verifikasi pembacaan override dari environment variables."""
        from src.config import EngineSettings

        with patch.dict(
            os.environ,
            {
                "ENGINE_HOST": "0.0.0.0",
                "ENGINE_PORT": "9000",
                "APP_VERSION": "3.0.0",
                "SENTINEL_ENV": "production",
                "LOG_LEVEL": "DEBUG",
                "LOG_FORMAT": "json",
                "MAX_WORKERS": "10",
                "SENTINEL_API_TOKEN": "my-secret-token",
                "SENTINEL_ALLOW_INSECURE_DEV": "true",
                "PY_CORS_ORIGINS": "http://localhost:3000, http://127.0.0.1:3000 ",
                "ARP_TIMEOUT": "5",
                "SPOOF_INTERVAL": "2",
            },
        ):
            settings = EngineSettings.from_env()
            self.assertEqual(settings.HOST, "0.0.0.0")
            self.assertEqual(settings.PORT, 9000)
            self.assertEqual(settings.APP_VERSION, "3.0.0")
            self.assertEqual(settings.ENVIRONMENT, "production")
            self.assertEqual(settings.LOG_LEVEL, "DEBUG")
            self.assertEqual(settings.LOG_FORMAT, "json")
            self.assertEqual(settings.MAX_WORKERS, 10)
            self.assertEqual(settings.SENTINEL_API_TOKEN, "my-secret-token")
            self.assertTrue(settings.SENTINEL_ALLOW_INSECURE_DEV)
            self.assertEqual(
                settings.cors_origins,
                ["http://localhost:3000", "http://127.0.0.1:3000"],
            )
            self.assertTrue(settings.is_production)
            self.assertEqual(settings.ARP_TIMEOUT, 5)
            self.assertEqual(settings.SPOOF_INTERVAL, 2)

    def test_log_level_normalization(self):
        """Verifikasi normalisasi LOG_LEVEL (lowercase dan nilai tak dikenal)."""
        from src.config import EngineSettings

        s1 = EngineSettings(LOG_LEVEL="debug")
        self.assertEqual(s1.LOG_LEVEL, "DEBUG")

        s2 = EngineSettings(LOG_LEVEL="unknown_level")
        self.assertEqual(s2.LOG_LEVEL, "INFO")

    def test_log_format_normalization(self):
        """Verifikasi normalisasi LOG_FORMAT (uppercase dan nilai tak dikenal)."""
        from src.config import EngineSettings

        s1 = EngineSettings(LOG_FORMAT="JSON")
        self.assertEqual(s1.LOG_FORMAT, "json")

        s2 = EngineSettings(LOG_FORMAT="yaml")
        self.assertEqual(s2.LOG_FORMAT, "text")

    def test_cors_origins_empty_and_whitespace(self):
        """Verifikasi parsing cors_origins ketika kosong atau spasi."""
        from src.config import EngineSettings

        s = EngineSettings(PY_CORS_ORIGINS="   ,  , ")
        self.assertEqual(s.cors_origins, [])

    def test_backward_compatibility_facade(self):
        """Verifikasi backward compatibility import dari src.utils.config."""
        from src.utils.config import config

        self.assertTrue(hasattr(config, "LOG_LEVEL"))
        self.assertTrue(hasattr(config, "ARP_TIMEOUT"))
        self.assertTrue(hasattr(config, "SPOOF_INTERVAL"))
        self.assertEqual(config.LOG_LEVEL, "INFO")
        self.assertEqual(config.ARP_TIMEOUT, 3)
        self.assertEqual(config.SPOOF_INTERVAL, 1)


if __name__ == "__main__":
    unittest.main()
