#!/usr/bin/env python3
"""
Unit Tests for SpoorfCertEngine (Dynamic TLS CA & Leaf Generator)
================================================================
Governed by: docs/specs/SPEC-012_L7_INTERCEPTION_AND_MITMPROXY.md
Invariants:
- Root CA is generated with valid X.509 v3 extensions and CA:TRUE constraint.
- Leaf certificates are dynamically generated with matching SAN and signed by Root CA.
- Thread-safe caching of leaf certificates.
"""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding

from src.core.interceptor.certs import SpoorfCertEngine


class TestSpoorfCertEngine(unittest.TestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.engine = SpoorfCertEngine(ca_dir=self.test_dir)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_ca_initialization_happy_path(self):
        """Verify that Root CA is properly generated and saved on startup."""
        self.assertTrue(os.path.exists(self.engine.ca_key_path))
        self.assertTrue(os.path.exists(self.engine.ca_cert_path))
        self.assertTrue(os.path.exists(self.engine.ca_crt_path))

        info = self.engine.get_ca_info()
        self.assertEqual(info["status"], "ready")
        self.assertEqual(info["common_name"], "NetCut Sentinel Root CA")
        self.assertTrue(info["is_ca"])

    def test_ca_reloading_existing_keys(self):
        """Verify that existing CA files are reused upon re-instantiation."""
        first_info = self.engine.get_ca_info()
        # Instantiate second engine with same directory
        second_engine = SpoorfCertEngine(ca_dir=self.test_dir)
        second_info = second_engine.get_ca_info()
        self.assertEqual(first_info["serial_number"], second_info["serial_number"])

    def test_generate_leaf_cert_happy_path(self):
        """Verify dynamic leaf cert generation with SAN for target domain."""
        domain = "api.instagram.com"
        key_pem, cert_pem = self.engine.generate_leaf_cert(domain)

        self.assertIsNotNone(key_pem)
        self.assertIsNotNone(cert_pem)
        self.assertTrue(cert_pem.startswith(b"-----BEGIN CERTIFICATE-----"))

        # Parse generated certificate
        leaf_cert = x509.load_pem_x509_certificate(cert_pem)
        self.assertEqual(leaf_cert.issuer, self.engine.ca_cert.subject)

        # Verify SAN extensions
        san_ext = leaf_cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        names = [str(n.value) for n in san_ext.value]
        self.assertIn("api.instagram.com", names)
        self.assertIn("*.api.instagram.com", names)

    def test_leaf_cert_caching(self):
        """Verify that requesting the same domain returns cached certificate."""
        domain = "secure.bank.com"
        key1, cert1 = self.engine.generate_leaf_cert(domain)
        key2, cert2 = self.engine.generate_leaf_cert(domain)

        self.assertEqual(key1, key2)
        self.assertEqual(cert1, cert2)
        self.assertEqual(self.engine.get_ca_info()["total_cached_leafs"], 1)

    def test_wildcard_domain_leaf_cert(self):
        """Verify leaf cert generation for wildcard domain."""
        domain = "*.target.corp"
        key_pem, cert_pem = self.engine.generate_leaf_cert(domain)
        leaf_cert = x509.load_pem_x509_certificate(cert_pem)
        san_ext = leaf_cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        names = [str(n.value) for n in san_ext.value]
        self.assertIn("*.target.corp", names)


if __name__ == "__main__":
    unittest.main()
