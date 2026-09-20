"""Unit tests for Structured JSON Logging & Idempotent Logger Setup."""

import json
import logging
import unittest
from unittest.mock import MagicMock, patch


class TestStructuredLogging(unittest.TestCase):
    def test_structured_json_formatter_standard_fields(self):
        """StructuredJSONFormatter outputs valid JSON containing standard metadata."""
        from src.utils.logger import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="test_logger",
            level=logging.INFO,
            pathname=__file__,
            lineno=20,
            msg="Hello Structured Log",
            args=(),
            exc_info=None,
        )

        formatted = formatter.format(record)
        data = json.loads(formatted)

        self.assertIn("timestamp", data)
        self.assertEqual(data["level"], "INFO")
        self.assertEqual(data["logger"], "test_logger")
        self.assertEqual(data["message"], "Hello Structured Log")
        self.assertNotIn("context", data)
        self.assertNotIn("exception", data)

    def test_structured_json_formatter_context_extras(self):
        """StructuredJSONFormatter captures extra kwargs into context dictionary."""
        from src.utils.logger import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="netcut",
            level=logging.WARNING,
            pathname=__file__,
            lineno=45,
            msg="ARP attack mitigated",
            args=(),
            exc_info=None,
        )
        record.victim_ip = "192.168.1.50"
        record.victim_mac = "aa:bb:cc:dd:ee:ff"
        record.action = "spoof_block"

        formatted = formatter.format(record)
        data = json.loads(formatted)

        self.assertIn("context", data)
        self.assertEqual(data["context"]["victim_ip"], "192.168.1.50")
        self.assertEqual(data["context"]["victim_mac"], "aa:bb:cc:dd:ee:ff")
        self.assertEqual(data["context"]["action"], "spoof_block")

    def test_structured_json_formatter_non_serializable_safe(self):
        """StructuredJSONFormatter safely serializes non-JSON objects via default=str without raising."""
        from src.utils.logger import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="netcut",
            level=logging.DEBUG,
            pathname=__file__,
            lineno=60,
            msg="Packet captured",
            args=(),
            exc_info=None,
        )
        # Mock complex non-serializable object (like Scapy packet or custom class)
        class CustomPacket:
            def __str__(self):
                return "<Ether/IP/ARP who-has>"

        record.packet = CustomPacket()
        record.raw_bytes = b"\x00\x01\x02"

        formatted = formatter.format(record)
        data = json.loads(formatted)

        self.assertIn("context", data)
        self.assertEqual(data["context"]["packet"], "<Ether/IP/ARP who-has>")
        self.assertEqual(data["context"]["raw_bytes"], "b'\\x00\\x01\\x02'")

    def test_structured_json_formatter_exception_traceback(self):
        """StructuredJSONFormatter captures exception stack trace in exception field."""
        from src.utils.logger import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        try:
            raise ValueError("Test error for traceback")
        except ValueError:
            import sys
            exc_info = sys.exc_info()

        record = logging.LogRecord(
            name="netcut",
            level=logging.ERROR,
            pathname=__file__,
            lineno=95,
            msg="Operation failed",
            args=(),
            exc_info=exc_info,
        )

        formatted = formatter.format(record)
        data = json.loads(formatted)

        self.assertIn("exception", data)
        self.assertIn("ValueError: Test error for traceback", data["exception"])

    def test_setup_logger_idempotency(self):
        """Calling setup_logger multiple times does not add duplicate handlers."""
        from src.utils.logger import setup_logger

        test_log = setup_logger("test_idempotency")
        initial_handlers_count = len(test_log.handlers)
        self.assertGreaterEqual(initial_handlers_count, 1)

        # Re-run setup_logger on the same logger
        re_test_log = setup_logger("test_idempotency")
        self.assertEqual(len(re_test_log.handlers), initial_handlers_count)


if __name__ == "__main__":
    unittest.main()
