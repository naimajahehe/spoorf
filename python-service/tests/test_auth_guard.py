"""Unit tests for Fail-Closed Universal Auth Hardening (HTTP & WebSocket)."""

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from src.config import EngineSettings, verify_api_token


class TestAuthGuard(unittest.IsolatedAsyncioTestCase):
    def test_verify_api_token_when_token_configured(self):
        """When SENTINEL_API_TOKEN is set, valid token passes, invalid/missing fails."""
        cfg = EngineSettings(SENTINEL_API_TOKEN="secret-12345", ENVIRONMENT="development")

        # Valid
        ok, err = verify_api_token("secret-12345", cfg)
        self.assertTrue(ok)
        self.assertIsNone(err)

        # Wrong
        ok, err = verify_api_token("wrong-token", cfg)
        self.assertFalse(ok)
        self.assertIn("missing or invalid", err)

        # Missing
        ok, err = verify_api_token(None, cfg)
        self.assertFalse(ok)
        self.assertIn("missing or invalid", err)

    def test_verify_api_token_production_fail_closed(self):
        """In production environment without token, requests fail-closed unconditionally."""
        cfg = EngineSettings(SENTINEL_API_TOKEN=None, ENVIRONMENT="production")

        ok, err = verify_api_token(None, cfg)
        self.assertFalse(ok)
        self.assertIn("mandatory in production", err)

        # Even with an arbitrary header, it must fail because expected token is unset
        ok, err = verify_api_token("random", cfg)
        self.assertFalse(ok)
        self.assertIn("mandatory in production", err)

    def test_verify_api_token_dev_default_fail_closed(self):
        """In dev environment without token, requests fail-closed by default."""
        cfg = EngineSettings(
            SENTINEL_API_TOKEN=None,
            ENVIRONMENT="development",
            SENTINEL_ALLOW_INSECURE_DEV=False,
        )

        ok, err = verify_api_token(None, cfg)
        self.assertFalse(ok)
        self.assertIn("fail-closed auth enabled by default", err)

    def test_verify_api_token_dev_escape_hatch(self):
        """In dev environment with SENTINEL_ALLOW_INSECURE_DEV=True, requests pass."""
        cfg = EngineSettings(
            SENTINEL_API_TOKEN=None,
            ENVIRONMENT="development",
            SENTINEL_ALLOW_INSECURE_DEV=True,
        )

        ok, err = verify_api_token(None, cfg)
        self.assertTrue(ok)
        self.assertIsNone(err)

    async def test_http_middleware_health_path_public(self):
        """Readiness probe /health must always be public without token."""
        from src.server import api_token_guard

        # Configure fail-closed
        test_settings = EngineSettings(SENTINEL_API_TOKEN="strict-token")

        request = MagicMock(spec=Request)
        request.url.path = "/health"
        request.method = "GET"

        call_next = AsyncMock(return_value=Response(content="ok", status_code=200))

        with patch("src.server.settings", test_settings):
            response = await api_token_guard(request, call_next)
            self.assertEqual(response.status_code, 200)
            call_next.assert_awaited_once_with(request)

    async def test_http_middleware_options_public(self):
        """CORS preflight OPTIONS request must always be permitted."""
        from src.server import api_token_guard

        test_settings = EngineSettings(SENTINEL_API_TOKEN="strict-token")

        request = MagicMock(spec=Request)
        request.url.path = "/api/spoof/start"
        request.method = "OPTIONS"

        call_next = AsyncMock(return_value=Response(status_code=204))

        with patch("src.server.settings", test_settings):
            response = await api_token_guard(request, call_next)
            self.assertEqual(response.status_code, 204)
            call_next.assert_awaited_once_with(request)

    async def test_http_middleware_rejects_unauthorized_with_401(self):
        """Protected path returns 401 JSON when token verification fails."""
        from src.server import api_token_guard

        test_settings = EngineSettings(
            SENTINEL_API_TOKEN="secret-guard-token",
            ENVIRONMENT="development",
        )

        request = MagicMock(spec=Request)
        request.url.path = "/api/spoof/start"
        request.method = "POST"
        request.headers = {"x-sentinel-token": "wrong-token"}

        call_next = AsyncMock()

        with patch("src.server.settings", test_settings):
            response = await api_token_guard(request, call_next)
            self.assertEqual(response.status_code, 401)
            call_next.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
