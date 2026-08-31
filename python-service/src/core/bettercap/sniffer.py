#!/usr/bin/env python3
"""
Bettercap-Style Protocol Dissector & Packet Sniffer
===================================================
Inspeksi paket jaringan terpusat terinspirasi dari dissectors Bettercap `net.sniff`:
- HTTP Authorization Basic & Bearer token dissector
- HTTP POST Form parameter parser (Username, Password, Tokens)
- HTTP Cookie & Session ID extractor (JSESSIONID, PHPSESSID, auth_token, dll.)
- Cleartext Service dissector (FTP, Telnet, POP3, IMAP, SMTP)
- In-memory ring buffer & callback streaming real-time
"""

import time
import base64
import urllib.parse
import re
import threading
from collections import deque
from typing import Dict, Any, List, Optional, Callable
from dataclasses import dataclass, asdict

from ...utils.logger import logger


@dataclass
class SniffedCredential:
    id: str
    timestamp: float
    client_ip: str
    server_ip: str
    protocol: str  # 'HTTP-POST' | 'HTTP-BASIC' | 'HTTP-COOKIE' | 'FTP' | 'TELNET' | 'MAIL'
    host: str
    port: int
    data_type: str  # 'Credential' | 'Token' | 'Session'
    username: Optional[str] = None
    password: Optional[str] = None
    token: Optional[str] = None
    url: Optional[str] = None
    raw_snippet: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class BettercapPacketDissector:
    """Dissector paket multi-protokol untuk telemetri keamanan dan audit autentikasi."""

    def __init__(self, max_history: int = 500, on_credential_callback: Optional[Callable[[Dict[str, Any]], None]] = None):
        self._history: deque = deque(maxlen=max_history)
        self._lock = threading.RLock()
        self.on_credential_callback = on_credential_callback

        # Regex pola form post password/user
        self._user_regex = re.compile(r'(?:user(?:name)?|login|email|usr|account|id)=(.*?)(?:&|$)', re.IGNORECASE)
        self._pass_regex = re.compile(r'(?:pass(?:word)?|pwd|secret|pin|token)=(.*?)(?:&|$)', re.IGNORECASE)
        self._token_regex = re.compile(r'(?:token|auth_token|access_token|session_id|jwt)=(.*?)(?:&|$)', re.IGNORECASE)

    def dissect_http_payload(self, client_ip: str, server_ip: str, port: int, payload_str: str) -> Optional[SniffedCredential]:
        """Ekstraksi kredensial, token auth, dan session cookie dari muatan HTTP."""
        if not payload_str:
            return None

        lines = payload_str.split("\r\n")
        if not lines:
            return None

        first_line = lines[0]
        method = "UNKNOWN"
        url = ""
        host = server_ip

        parts = first_line.split(" ")
        if len(parts) >= 2:
            method = parts[0].upper()
            url = parts[1]

        headers: Dict[str, str] = {}
        body = ""
        in_body = False

        for i, line in enumerate(lines[1:]):
            if not in_body:
                if line == "":
                    in_body = True
                    body = "\r\n".join(lines[i + 2:])
                    break
                h_parts = line.split(":", 1)
                if len(h_parts) == 2:
                    headers[h_parts[0].strip().lower()] = h_parts[1].strip()

        if "host" in headers:
            host = headers["host"]

        # 1. HTTP Basic Authorization
        if "authorization" in headers:
            auth_val = headers["authorization"]
            if auth_val.lower().startswith("basic "):
                try:
                    b64_str = auth_val[6:].strip()
                    decoded = base64.b64decode(b64_str).decode("utf-8", errors="ignore")
                    if ":" in decoded:
                        u, p = decoded.split(":", 1)
                        return self._record_credential(
                            client_ip=client_ip,
                            server_ip=server_ip,
                            protocol="HTTP-BASIC",
                            host=host,
                            port=port,
                            data_type="Credential",
                            username=u,
                            password=p,
                            url=url,
                            raw_snippet=auth_val[:80]
                        )
                except Exception:
                    pass
            elif auth_val.lower().startswith("bearer "):
                bearer_tok = auth_val[7:].strip()
                return self._record_credential(
                    client_ip=client_ip,
                    server_ip=server_ip,
                    protocol="HTTP-BEARER",
                    host=host,
                    port=port,
                    data_type="Token",
                    token=bearer_tok,
                    url=url,
                    raw_snippet=auth_val[:80]
                )

        # 2. HTTP POST Form Data Credentials
        if method == "POST" and body:
            content_type = headers.get("content-type", "")
            if "application/x-www-form-urlencoded" in content_type:
                u_match = self._user_regex.search(body)
                p_match = self._pass_regex.search(body)

                if u_match or p_match:
                    user_val = urllib.parse.unquote_plus(u_match.group(1)) if u_match else None
                    pass_val = urllib.parse.unquote_plus(p_match.group(1)) if p_match else None
                    return self._record_credential(
                        client_ip=client_ip,
                        server_ip=server_ip,
                        protocol="HTTP-POST",
                        host=host,
                        port=port,
                        data_type="Credential",
                        username=user_val,
                        password=pass_val,
                        url=url,
                        raw_snippet=body[:100]
                    )

        # 3. HTTP Session Cookie Detection
        if "cookie" in headers:
            cookie_val = headers["cookie"]
            # Cari sensitive session cookie tokens
            if any(k in cookie_val.lower() for k in ("session", "token", "auth", "jwt", "sid")):
                return self._record_credential(
                    client_ip=client_ip,
                    server_ip=server_ip,
                    protocol="HTTP-COOKIE",
                    host=host,
                    port=port,
                    data_type="Session",
                    token=cookie_val[:120],
                    url=url,
                    raw_snippet=cookie_val[:120]
                )

        return None

    def dissect_raw_tcp(self, client_ip: str, server_ip: str, dport: int, raw_bytes: bytes) -> Optional[SniffedCredential]:
        """Dissect protokol TCP umum (FTP, POP3, SMTP, Telnet)."""
        try:
            text = raw_bytes.decode("utf-8", errors="ignore").strip()
            if not text:
                return None

            # FTP (Port 21)
            if dport == 21:
                if text.upper().startswith("USER "):
                    return self._record_credential(
                        client_ip=client_ip, server_ip=server_ip, protocol="FTP", host=server_ip, port=dport,
                        data_type="Credential", username=text[5:].strip(), raw_snippet=text
                    )
                elif text.upper().startswith("PASS "):
                    return self._record_credential(
                        client_ip=client_ip, server_ip=server_ip, protocol="FTP", host=server_ip, port=dport,
                        data_type="Credential", password=text[5:].strip(), raw_snippet="PASS *****"
                    )

            # POP3 / SMTP / IMAP
            if dport in (110, 143, 25, 587):
                if text.upper().startswith("USER "):
                    return self._record_credential(
                        client_ip=client_ip, server_ip=server_ip, protocol="MAIL", host=server_ip, port=dport,
                        data_type="Credential", username=text[5:].strip(), raw_snippet=text
                    )
                elif text.upper().startswith("PASS "):
                    return self._record_credential(
                        client_ip=client_ip, server_ip=server_ip, protocol="MAIL", host=server_ip, port=dport,
                        data_type="Credential", password=text[5:].strip(), raw_snippet="PASS *****"
                    )

            # HTTP (Port 80, 8080, 8000)
            if dport in (80, 8080, 8000, 8888, 3000, 5000):
                return self.dissect_http_payload(client_ip, server_ip, dport, text)

        except Exception as e:
            logger.debug(f"Notice in raw TCP dissector: {e}")
        return None

    def _record_credential(
        self,
        client_ip: str,
        server_ip: str,
        protocol: str,
        host: str,
        port: int,
        data_type: str,
        username: Optional[str] = None,
        password: Optional[str] = None,
        token: Optional[str] = None,
        url: Optional[str] = None,
        raw_snippet: Optional[str] = None
    ) -> SniffedCredential:
        now_ts = time.time()
        cred_id = f"cred-{int(now_ts * 1000)}-{len(self._history) + 1}"
        cred = SniffedCredential(
            id=cred_id,
            timestamp=now_ts,
            client_ip=client_ip,
            server_ip=server_ip,
            protocol=protocol,
            host=host,
            port=port,
            data_type=data_type,
            username=username,
            password=password,
            token=token,
            url=url,
            raw_snippet=raw_snippet
        )

        with self._lock:
            # Cegah duplikasi langsung dalam window 2 detik
            for existing in reversed(self._history):
                if now_ts - existing.timestamp > 2.0:
                    break
                if (existing.client_ip == client_ip and existing.host == host and
                    existing.username == username and existing.password == password and
                    existing.token == token):
                    return existing
            self._history.append(cred)

        logger.info(f"🔑 [Bettercap Dissector] Captured {protocol} from {client_ip} -> {host}:{port} ({data_type})")

        if self.on_credential_callback:
            try:
                self.on_credential_callback(cred.to_dict())
            except Exception as e:
                logger.debug(f"Notice in credential callback: {e}")

        return cred

    def get_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        with self._lock:
            items = list(self._history)
            return [c.to_dict() for c in reversed(items[-limit:])]

    def clear(self):
        with self._lock:
            self._history.clear()
            logger.info("🧹 [Bettercap Dissector] Cleared captured credentials buffer")
