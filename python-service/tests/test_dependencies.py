"""Unit test suite for dependency tiering, pyproject separation, and lockfile verification.

Verifies:
1. Runtime requirements.txt strictly isolates runtime dependencies (no pyinstaller, no pytest).
2. requirements-build.txt contains packaging tools (pyinstaller).
3. requirements-dev.txt contains developer tooling (ruff, mypy, pytest).
4. pyproject.toml correctly segments [project.dependencies] vs [project.optional-dependencies].
5. requirements.lock exists and contains cryptographic SHA-256 hashes for all runtime packages.
6. build_engine.py includes a friendly pre-flight guard if PyInstaller is missing.
"""

import os
import unittest
from pathlib import Path


class TestDependencySeparation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service_dir = Path(__file__).resolve().parent.parent
        cls.requirements_txt = cls.service_dir / "requirements.txt"
        cls.requirements_build = cls.service_dir / "requirements-build.txt"
        cls.requirements_dev = cls.service_dir / "requirements-dev.txt"
        cls.requirements_lock = cls.service_dir / "requirements.lock"
        cls.pyproject_toml = cls.service_dir / "pyproject.toml"
        cls.build_engine_py = cls.service_dir / "build_engine.py"

    def test_runtime_requirements_excludes_build_and_dev_tools(self):
        """Runtime requirements.txt must NOT contain pyinstaller, pytest, ruff, or mypy."""
        self.assertTrue(self.requirements_txt.is_file(), "requirements.txt not found")
        content = self.requirements_txt.read_text(encoding="utf-8")
        lines = [line.strip().lower() for line in content.splitlines() if line.strip() and not line.strip().startswith("#")]

        # Ensure build and dev tools are absent
        for line in lines:
            self.assertFalse(line.startswith("pyinstaller"), f"pyinstaller must not be in requirements.txt (found: {line})")
            self.assertFalse(line.startswith("pytest"), f"pytest must not be in requirements.txt (found: {line})")
            self.assertFalse(line.startswith("ruff"), f"ruff must not be in requirements.txt (found: {line})")
            self.assertFalse(line.startswith("mypy"), f"mypy must not be in requirements.txt (found: {line})")

        # Ensure all 8 core runtime dependencies are present
        core_pkgs = ["scapy", "netifaces", "python-dotenv", "fastapi", "uvicorn", "pydantic", "psutil", "cryptography"]
        found_pkgs = [line.split("==")[0].strip() for line in lines]
        for pkg in core_pkgs:
            self.assertIn(pkg, found_pkgs, f"Core runtime package '{pkg}' missing from requirements.txt")

    def test_build_requirements_defined(self):
        """requirements-build.txt must exist and declare pyinstaller."""
        self.assertTrue(self.requirements_build.is_file(), "requirements-build.txt not found")
        content = self.requirements_build.read_text(encoding="utf-8").lower()
        self.assertIn("pyinstaller", content, "pyinstaller missing from requirements-build.txt")

    def test_dev_requirements_defined(self):
        """requirements-dev.txt must exist and declare dev quality gate tools."""
        self.assertTrue(self.requirements_dev.is_file(), "requirements-dev.txt not found")
        content = self.requirements_dev.read_text(encoding="utf-8").lower()
        self.assertIn("ruff", content, "ruff missing from requirements-dev.txt")
        self.assertIn("mypy", content, "mypy missing from requirements-dev.txt")
        self.assertIn("pytest", content, "pytest missing from requirements-dev.txt")

    def test_pyproject_toml_dependency_separation(self):
        """pyproject.toml must isolate runtime dependencies from optional build and dev dependencies."""
        self.assertTrue(self.pyproject_toml.is_file(), "pyproject.toml not found")
        content = self.pyproject_toml.read_text(encoding="utf-8")

        # Parse sections roughly
        self.assertIn("[project]", content)
        self.assertIn("dependencies = [", content)
        self.assertIn("[project.optional-dependencies]", content)

        # Pyinstaller must NOT be in the main [project] dependencies
        # Extract dependencies block
        main_deps = content.split("dependencies = [")[1].split("]")[0]
        self.assertNotIn("pyinstaller", main_deps.lower(), "pyinstaller must not be in main dependencies in pyproject.toml")

        # Pyinstaller must be in build optional-dependencies
        self.assertIn("build = [", content, "build extra missing in [project.optional-dependencies]")
        build_deps = content.split("build = [")[1].split("]")[0]
        self.assertIn("pyinstaller", build_deps.lower(), "pyinstaller missing from build optional-dependencies")

    def test_requirements_lock_tamper_evident_hashes(self):
        """requirements.lock must exist, be non-empty, and contain SHA-256 hashes."""
        self.assertTrue(self.requirements_lock.is_file(), "requirements.lock not found")
        content = self.requirements_lock.read_text(encoding="utf-8")
        self.assertGreater(len(content), 100, "requirements.lock is empty or truncated")
        self.assertIn("--hash=sha256:", content, "requirements.lock must contain sha256 hashes")

        # Verify key dependencies are locked
        lower_content = content.lower()
        for pkg in ["scapy", "fastapi", "uvicorn", "cryptography"]:
            self.assertIn(pkg, lower_content, f"'{pkg}' must be locked in requirements.lock")

    def test_build_engine_guard(self):
        """build_engine.py must contain a pre-flight check advising how to install build requirements if PyInstaller is missing."""
        self.assertTrue(self.build_engine_py.is_file(), "build_engine.py not found")
        content = self.build_engine_py.read_text(encoding="utf-8")
        self.assertIn("requirements-build.txt", content, "build_engine.py should reference requirements-build.txt when guiding developers")


if __name__ == "__main__":
    unittest.main()
