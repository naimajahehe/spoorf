import json
import logging
import unittest
from unittest.mock import AsyncMock, MagicMock

from fastapi import Request, Response
from src.utils.logger import (
    StructuredJSONFormatter,
    get_logger,
    request_id_ctx,
    logger as default_logger,
)


class TestEnterpriseLogging(unittest.IsolatedAsyncioTestCase):
    """Test suite for enterprise logging subsystem and HTTP request tracing."""

    def setUp(self):
        self.formatter = StructuredJSONFormatter()
        self.token = request_id_ctx.set(None)

    def tearDown(self):
        request_id_ctx.reset(self.token)

    def test_json_formatter_includes_source_metadata(self):
        """JSON output must include source file, line number, and function name."""
        record = logging.LogRecord(
            name="netcut.test",
            level=logging.INFO,
            pathname="d:/spoorf/src/core/spoofer.py",
            lineno=142,
            msg="Session started for %s",
            args=("192.168.1.50",),
            exc_info=None,
            func="start_spoof"
        )
        record.filename = "spoofer.py"
        record.funcName = "start_spoof"

        output = self.formatter.format(record)
        data = json.loads(output)

        self.assertEqual(data["level"], "INFO")
        self.assertEqual(data["logger"], "netcut.test")
        self.assertEqual(data["message"], "Session started for 192.168.1.50")
        self.assertIn("source", data)
        self.assertEqual(data["source"]["file"], "spoofer.py")
        self.assertEqual(data["source"]["line"], 142)
        self.assertEqual(data["source"]["function"], "start_spoof")

    def test_json_formatter_includes_context_extras(self):
        """Caller extras must be grouped cleanly under 'context' key."""
        record = logging.LogRecord(
            name="netcut.spoofer",
            level=logging.WARNING,
            pathname="spoofer.py",
            lineno=200,
            msg="Packet injection rate limited",
            args=(),
            exc_info=None,
        )
        record.target_ip = "192.168.1.77"
        record.limit_pct = 35

        output = self.formatter.format(record)
        data = json.loads(output)

        self.assertIn("context", data)
        self.assertEqual(data["context"]["target_ip"], "192.168.1.77")
        self.assertEqual(data["context"]["limit_pct"], 35)

    def test_json_formatter_includes_request_id_from_contextvars(self):
        """If request_id_ctx is set, it must be automatically included in the JSON payload."""
        request_id_ctx.set("trace-uuid-12345")

        record = logging.LogRecord(
            name="netcut.api",
            level=logging.INFO,
            pathname="server.py",
            lineno=50,
            msg="Processing API call",
            args=(),
            exc_info=None,
        )

        output = self.formatter.format(record)
        data = json.loads(output)

        self.assertEqual(data.get("request_id"), "trace-uuid-12345")

    def test_json_formatter_captures_full_exception_traceback(self):
        """Log records with exc_info must serialize full traceback into 'exception' field."""
        try:
            raise ValueError("Simulated network interface failure")
        except ValueError:
            import sys
            record = logging.LogRecord(
                name="netcut.error",
                level=logging.ERROR,
                pathname="network.py",
                lineno=99,
                msg="Operation crashed",
                args=(),
                exc_info=sys.exc_info(),
            )

        output = self.formatter.format(record)
        data = json.loads(output)

        self.assertIn("exception", data)
        self.assertIn("ValueError: Simulated network interface failure", data["exception"])
        self.assertIn("Traceback", data["exception"])

    def test_get_logger_hierarchical_scoping(self):
        """get_logger creates hierarchical child loggers that propagate to netcut root."""
        child_log = get_logger("spoofer")
        self.assertEqual(child_log.name, "netcut.spoofer")
        self.assertTrue(child_log.propagate)
        # Child does not add extra handlers, propagates to netcut root
        self.assertEqual(len(child_log.handlers), 0)

        # Calling with full prefix netcut.* preserves exact name
        full_child = get_logger("netcut.scanner")
        self.assertEqual(full_child.name, "netcut.scanner")

        # Calling without name returns root logger
        root = get_logger()
        self.assertEqual(root.name, "netcut")
        self.assertGreaterEqual(len(root.handlers), 1)

    def test_default_logger_backward_compatibility(self):
        """Module-level 'logger' instance remains fully functional."""
        self.assertIsNotNone(default_logger)
        self.assertEqual(default_logger.name, "netcut")

    async def test_http_request_tracing_middleware_propagates_incoming_id(self):
        """FastAPI middleware must preserve and return incoming x-request-id."""
        from src.server import request_tracing_middleware

        request = MagicMock(spec=Request)
        request.headers = {"x-request-id": "client-corr-id-777"}
        request.method = "GET"
        request.url.path = "/api/spoof/status"
        request.client = MagicMock(host="127.0.0.1")

        response = Response(content="ok", status_code=200)
        call_next = AsyncMock(return_value=response)

        res = await request_tracing_middleware(request, call_next)

        self.assertEqual(res.headers.get("x-request-id"), "client-corr-id-777")
        call_next.assert_awaited_once_with(request)

    async def test_http_request_tracing_middleware_generates_id_when_missing(self):
        """FastAPI middleware must generate an x-request-id if client did not supply one."""
        from src.server import request_tracing_middleware

        request = MagicMock(spec=Request)
        request.headers = {}
        request.method = "POST"
        request.url.path = "/api/spoof/start"
        request.client = MagicMock(host="127.0.0.1")

        response = Response(content="ok", status_code=200)
        call_next = AsyncMock(return_value=response)

        res = await request_tracing_middleware(request, call_next)

        generated_id = res.headers.get("x-request-id")
        self.assertIsNotNone(generated_id)
        self.assertGreaterEqual(len(generated_id), 8)


if __name__ == "__main__":
    unittest.main()
