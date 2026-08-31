#!/usr/bin/env python3
"""
NetCut Sentinel Layer 7 Flow Lifecycle & Stream Manager
========================================================
Diadaptasi dari arsitektur Flow mitmproxy (`mitmproxy/flow.py`).
Menyediakan model data flow terpadu untuk HTTP, HTTPS, dan DNS.
"""

import time
import uuid
import threading
from collections import deque
from dataclasses import dataclass, field, asdict
from typing import Dict, Any, List, Optional, Callable

from ...utils.logger import logger


@dataclass
class L7Flow:
    """Representasi satu aliran transaksi Layer 7 (HTTP, HTTPS, atau DNS)."""
    id: str = field(default_factory=lambda: f"flow-{uuid.uuid4().hex[:8]}")
    timestamp: float = field(default_factory=time.time)
    client_ip: str = ""
    client_mac: Optional[str] = None
    scheme: str = "https"          # "http", "https", "dns", "portal"
    method: str = "GET"            # "GET", "POST", "PUT", "DELETE", "QUERY", "SNI"
    host: str = ""
    port: int = 443
    path: str = "/"
    status_code: Optional[int] = 200
    content_type: str = ""
    request_size: int = 0
    response_size: int = 0
    duration_ms: float = 0.0
    is_tls: bool = True
    headers: Dict[str, str] = field(default_factory=dict)
    is_blocked: bool = False
    rule_match: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class L7FlowManager:
    """Pengelola histori L7 Flow dalam memori dan penyiar event ke WebSocket."""

    def __init__(
        self,
        max_history: int = 1000,
        on_flow_broadcast: Optional[Callable[[Dict[str, Any]], None]] = None
    ):
        self.max_history = max_history
        self.on_flow_broadcast = on_flow_broadcast
        self._flows: deque = deque(maxlen=max_history)
        self._lock = threading.Lock()

    def record_flow(
        self,
        client_ip: str,
        host: str,
        scheme: str = "https",
        method: str = "GET",
        path: str = "/",
        port: int = 443,
        status_code: Optional[int] = 200,
        content_type: str = "",
        request_size: int = 0,
        response_size: int = 0,
        duration_ms: float = 0.0,
        is_tls: bool = True,
        headers: Optional[Dict[str, str]] = None,
        is_blocked: bool = False,
        rule_match: Optional[str] = None,
        client_mac: Optional[str] = None
    ) -> L7Flow:
        """Merekam satu L7 Flow baru dan memancarkannya ke WebSocket listener."""
        flow = L7Flow(
            client_ip=client_ip,
            client_mac=client_mac,
            scheme=scheme,
            method=method,
            host=host,
            port=port,
            path=path,
            status_code=status_code,
            content_type=content_type,
            request_size=request_size,
            response_size=response_size,
            duration_ms=duration_ms,
            is_tls=is_tls,
            headers=headers or {},
            is_blocked=is_blocked,
            rule_match=rule_match
        )

        flow_dict = flow.to_dict()

        with self._lock:
            self._flows.append(flow_dict)

        if self.on_flow_broadcast:
            try:
                self.on_flow_broadcast(flow_dict)
            except Exception as e:
                logger.debug(f"Notice on_flow_broadcast error: {e}")

        return flow

    def get_flows(
        self,
        limit: int = 100,
        search: Optional[str] = None,
        scheme: Optional[str] = None,
        method: Optional[str] = None,
        is_blocked: Optional[bool] = None
    ) -> List[Dict[str, Any]]:
        """Mengambil list flow dengan filter terstruktur."""
        with self._lock:
            flows = list(self._flows)

        flows.reverse()  # Urutan terbaru di awal

        filtered = []
        q = search.lower().strip() if search else None

        for f in flows:
            if q:
                target_str = f"{f.get('host', '')} {f.get('path', '')} {f.get('client_ip', '')}".lower()
                if q not in target_str:
                    continue

            if scheme and f.get("scheme", "").lower() != scheme.lower():
                continue

            if method and f.get("method", "").upper() != method.upper():
                continue

            if is_blocked is not None and f.get("is_blocked") != is_blocked:
                continue

            filtered.append(f)
            if len(filtered) >= limit:
                break

        return filtered

    def clear(self):
        """Mengosongkan riwayat flow."""
        with self._lock:
            self._flows.clear()

    def get_stats(self) -> Dict[str, Any]:
        """Statistik ringkas L7 flows."""
        with self._lock:
            flows = list(self._flows)

        total = len(flows)
        blocked = sum(1 for f in flows if f.get("is_blocked"))
        https_count = sum(1 for f in flows if f.get("scheme") == "https")
        http_count = sum(1 for f in flows if f.get("scheme") == "http")
        dns_count = sum(1 for f in flows if f.get("scheme") == "dns")

        return {
            "total_flows": total,
            "blocked_flows": blocked,
            "https_flows": https_count,
            "http_flows": http_count,
            "dns_flows": dns_count
        }
