"""Unit test suite verifying the modular APIRouter architecture, DI via Depends, and Lifespan."""

import inspect
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import Depends, Request
from src.api.deps import auto_inject, get_container, get_spoofer
from src.api.routes import (
    ALL_ROUTERS,
    bettercap_router,
    discovery_router,
    gaming_router,
    interceptor_router,
    redirector_router,
    shield_router,
    spoof_router,
    system_router,
    telemetry_router,
    websocket_router,
)
from src.container import EngineContainer, get_default_container
from src.server import app, container, spoofer


class TestModularArchitecture(unittest.TestCase):
    def test_all_domain_routers_registered(self):
        """All 10 domain routers must be defined in ALL_ROUTERS."""
        expected_routers = [
            system_router,
            discovery_router,
            spoof_router,
            redirector_router,
            telemetry_router,
            interceptor_router,
            bettercap_router,
            shield_router,
            gaming_router,
            websocket_router,
        ]
        self.assertEqual(len(ALL_ROUTERS), 10)
        for r in expected_routers:
            self.assertIn(r, ALL_ROUTERS)

    def test_app_includes_all_endpoints(self):
        """Root app must register all 53 endpoints across all subrouters."""
        all_routes = []
        for r in app.routes:
            if hasattr(r, "path"):
                all_routes.append(r.path)
            elif hasattr(r, "original_router"):
                for sub_r in r.original_router.routes:
                    all_routes.append(sub_r.path)

        custom_routes = [
            p for p in all_routes
            if not p.startswith("/openapi") and not p.startswith("/docs") and not p.startswith("/redoc")
        ]
        self.assertEqual(len(custom_routes), 53, f"Expected 53 endpoints, found {len(custom_routes)}")

        # Check critical paths from each domain
        self.assertIn("/health", custom_routes)
        self.assertIn("/api/system/diagnostics", custom_routes)
        self.assertIn("/api/status", custom_routes)
        self.assertIn("/api/scan", custom_routes)
        self.assertIn("/api/spoof/start", custom_routes)
        self.assertIn("/api/redirect/start", custom_routes)
        self.assertIn("/api/gateway/start", custom_routes)
        self.assertIn("/api/telemetry", custom_routes)
        self.assertIn("/api/interceptor/ca", custom_routes)
        self.assertIn("/api/bettercap/status", custom_routes)
        self.assertIn("/api/shield/status", custom_routes)
        self.assertIn("/api/gaming/status", custom_routes)
        self.assertIn("/ws/events", custom_routes)

    def test_lifespan_is_configured_on_app(self):
        """App must use lifespan context manager (replacing deprecated on_event)."""
        self.assertIsNotNone(app.router.lifespan_context)

    def test_container_singleton_and_services(self):
        """EngineContainer encapsulates all required services."""
        default_c = get_default_container()
        self.assertIsInstance(default_c, EngineContainer)
        self.assertIsNotNone(default_c.spoofer)
        self.assertIsNotNone(default_c.scanner)
        self.assertIsNotNone(default_c.redirect_manager)
        self.assertIsNotNone(default_c.transparent_gateway)
        self.assertIsNotNone(default_c.connection_manager)
        self.assertIsNotNone(default_c.telemetry_sampler)
        self.assertIsNotNone(default_c.cert_engine)
        self.assertIsNotNone(default_c.flow_manager)
        self.assertIsNotNone(default_c.bettercap_dns)
        self.assertIsNotNone(default_c.bettercap_dissector)
        self.assertIsNotNone(default_c.bettercap_syn_scanner)
        self.assertIsNotNone(default_c.shield_engine)
        self.assertIsNotNone(default_c.gaming_engine)
        self.assertIsNotNone(default_c.liveness_daemon)
        self.assertIsNotNone(default_c.executor)

    def test_auto_inject_resolves_depends_in_direct_call(self):
        """@auto_inject decorator must resolve Depends defaults in direct Python calls."""
        def dummy_dep():
            return "injected_value"

        @auto_inject
        def my_fn(val: int, injected: str = Depends(dummy_dep)):
            return f"{val}-{injected}"

        # Direct call without specifying 'injected'
        result = my_fn(42)
        self.assertEqual(result, "42-injected_value")

        # Explicit override
        result_override = my_fn(42, injected="manual")
        self.assertEqual(result_override, "42-manual")

    def test_get_spoofer_from_request_state(self):
        """get_spoofer resolves from request.app.state if available."""
        mock_spoofer = MagicMock()
        mock_request = SimpleNamespace(
            app=SimpleNamespace(state=SimpleNamespace(container=None, spoofer=mock_spoofer))
        )
        resolved = get_spoofer(mock_request)
        self.assertIs(resolved, mock_spoofer)


if __name__ == "__main__":
    unittest.main()
