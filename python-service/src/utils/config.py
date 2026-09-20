"""Legacy configuration facade re-exporting centralized EngineSettings for backward compatibility."""

from ..config import EngineSettings, settings, verify_api_token  # noqa: F401

# Backward-compatible alias preserving exact legacy interface
config = settings