#!/usr/bin/env python3
"""
NetCut Sentinel Dynamic TLS Certificate Authority & Leaf Generator
===================================================================
Diadaptasi dari arsitektur sertifikat mitmproxy (`mitmproxy/certs.py`).
Menyediakan pengelolaan Root CA dan pembuatan sertifikat SSL/TLS dinamis on-the-fly.
"""

import os
import sys
import subprocess
import datetime
import threading
from pathlib import Path
from typing import Dict, Tuple, Optional, Any

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID

from ...utils.logger import logger

# Masa berlaku CA: 10 Tahun, Leaf cert: 90 Hari, Validity backdate: 2 Hari
CA_EXPIRY_DAYS = 3650
CERT_EXPIRY_DAYS = 90
CERT_VALIDITY_OFFSET = datetime.timedelta(days=-2)


class SpoorfCertEngine:
    """Dynamic CA and TLS Certificate Generator terinspirasi dari mitmproxy."""

    def __init__(self, ca_dir: Optional[str] = None):
        if ca_dir is None:
            # Default ke folder 'certs' di root python-service
            base_dir = Path(__file__).resolve().parent.parent.parent.parent
            self.ca_dir = base_dir / "certs"
        else:
            self.ca_dir = Path(ca_dir)

        self.ca_dir.mkdir(parents=True, exist_ok=True)
        self.ca_key_path = self.ca_dir / "spoorf-ca-key.pem"
        self.ca_cert_path = self.ca_dir / "spoorf-ca.pem"
        self.ca_crt_path = self.ca_dir / "spoorf-ca.crt"

        self._lock = threading.Lock()
        self._leaf_cache: Dict[str, Tuple[bytes, bytes]] = {}
        self.ca_key: Optional[rsa.RSAPrivateKey] = None
        self.ca_cert: Optional[x509.Certificate] = None

        self._ensure_ca()

    def _ensure_ca(self):
        """Memastikan Root CA telah dibuat dan dimuat ke dalam memori."""
        with self._lock:
            if self.ca_key_path.exists() and self.ca_cert_path.exists():
                try:
                    with open(self.ca_key_path, "rb") as f:
                        self.ca_key = serialization.load_pem_private_key(f.read(), password=None) # type: ignore
                    with open(self.ca_cert_path, "rb") as f:
                        self.ca_cert = x509.load_pem_x509_certificate(f.read())
                    logger.info("🔑 [CertEngine] Root CA berhasil dimuat dari disk")
                    return
                except Exception as e:
                    logger.warning(f"Gagal memuat existing Root CA ({e}), membuat baru...")

            self._generate_ca()

    def _generate_ca(self):
        """Generate Self-Signed Root Certificate Authority (X.509 v3)."""
        logger.info("🔒 [CertEngine] Men-generate NetCut Sentinel Root CA (RSA 2048)...")
        self.ca_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048
        )

        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "ID"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "NetCut Sentinel Security"),
            x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "Traffic Interception Authority"),
            x509.NameAttribute(NameOID.COMMON_NAME, "NetCut Sentinel Root CA"),
        ])

        now = datetime.datetime.now(datetime.timezone.utc)
        self.ca_cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(self.ca_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now + CERT_VALIDITY_OFFSET)
            .not_valid_after(now + datetime.timedelta(days=CA_EXPIRY_DAYS))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    content_commitment=False,
                    key_encipherment=False,
                    data_encipherment=False,
                    key_agreement=False,
                    key_cert_sign=True,
                    crl_sign=True,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True
            )
            .add_extension(
                x509.SubjectKeyIdentifier.from_public_key(self.ca_key.public_key()),
                critical=False
            )
            .sign(self.ca_key, hashes.SHA256())
        )

        # Simpan PEM Private Key
        with open(self.ca_key_path, "wb") as f:
            f.write(self.ca_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption()
            ))
        # KEAMANAN (P2): batasi izin file private key ke pemilik saja (best-effort).
        # Catatan: enkripsi passphrase at-rest tetap Roadmap (butuh manajemen passphrase).
        self._restrict_key_permissions(self.ca_key_path)

        # Simpan PEM Certificate
        pem_bytes = self.ca_cert.public_bytes(serialization.Encoding.PEM)
        with open(self.ca_cert_path, "wb") as f:
            f.write(pem_bytes)

        # Simpan .CRT file untuk instalasi langsung di OS/Browser/Android
        with open(self.ca_crt_path, "wb") as f:
            f.write(pem_bytes)

        logger.info(f"✨ [CertEngine] NetCut Sentinel Root CA tersimpan di {self.ca_cert_path}")

    def _restrict_key_permissions(self, key_path: Path) -> None:
        """
        KEAMANAN (P2): Batasi izin file private key ke pemilik saja (best-effort).
        POSIX: chmod 0600. Windows: icacls (hapus inheritance, grant hanya user aktif).
        """
        try:
            if sys.platform == "win32":
                user = os.environ.get("USERNAME") or ""
                if user:
                    subprocess.run(
                        ["icacls", str(key_path), "/inheritance:r", "/grant:r", f"{user}:F"],
                        shell=False, capture_output=True, timeout=5,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
                    )
            else:
                os.chmod(key_path, 0o600)
        except Exception as e:
            logger.debug(f"Notice restricting CA key permissions: {e}")

    def generate_leaf_cert(self, domain: str) -> Tuple[bytes, bytes]:
        """
        Membuat sertifikat TLS dinamis on-the-fly untuk domain target.
        Mengembalikan tuple: (private_key_pem_bytes, cert_pem_bytes).
        """
        clean_domain = domain.strip().lower()

        with self._lock:
            if clean_domain in self._leaf_cache:
                return self._leaf_cache[clean_domain]

        if not self.ca_key or not self.ca_cert:
            self._ensure_ca()

        leaf_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048
        )

        # Build SAN list (Subject Alternative Names)
        san_names = [x509.DNSName(clean_domain)]
        if not clean_domain.startswith("*.") and "." in clean_domain:
            san_names.append(x509.DNSName(f"*.{clean_domain}"))

        subject = x509.Name([
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "NetCut Sentinel Interceptor"),
            x509.NameAttribute(NameOID.COMMON_NAME, clean_domain),
        ])

        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(self.ca_cert.subject) # type: ignore
            .public_key(leaf_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now + CERT_VALIDITY_OFFSET)
            .not_valid_after(now + datetime.timedelta(days=CERT_EXPIRY_DAYS))
            .add_extension(x509.SubjectAlternativeName(san_names), critical=False)
            .add_extension(
                x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
                critical=False
            )
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    content_commitment=False,
                    key_encipherment=True,
                    data_encipherment=False,
                    key_agreement=False,
                    key_cert_sign=False,
                    crl_sign=False,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True
            )
            .sign(self.ca_key, hashes.SHA256()) # type: ignore
        )

        key_pem = leaf_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption()
        )
        cert_pem = cert.public_bytes(serialization.Encoding.PEM)

        with self._lock:
            # Batasi cache 500 domain untuk efisiensi memori
            if len(self._leaf_cache) > 500:
                self._leaf_cache.clear()
            self._leaf_cache[clean_domain] = (key_pem, cert_pem)

        return key_pem, cert_pem

    def get_ca_cert_pem(self) -> bytes:
        """Mengambil isi sertifikat Root CA dalam format PEM string/bytes."""
        if not self.ca_cert_path.exists():
            self._ensure_ca()
        with open(self.ca_cert_path, "rb") as f:
            return f.read()

    def get_ca_info(self) -> Dict[str, Any]:
        """Mengambil metadata status Root CA."""
        if not self.ca_cert:
            self._ensure_ca()

        cert = self.ca_cert
        assert cert is not None

        return {
            "status": "ready",
            "common_name": "NetCut Sentinel Root CA",
            "organization": "NetCut Sentinel Security",
            "serial_number": str(cert.serial_number),
            "valid_from": cert.not_valid_before_utc.isoformat(),
            "valid_until": cert.not_valid_after_utc.isoformat(),
            "is_ca": True,
            "cert_path": str(self.ca_crt_path),
            "total_cached_leafs": len(self._leaf_cache)
        }
