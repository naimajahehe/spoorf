"""Pydantic Request and Response Schemas for NetCut Sentinel Network Engine."""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ===== SHIELD MODELS =====
class ShieldToggleRequest(BaseModel):
    enabled: bool
    mode: Optional[str] = "host_lock"
    auto_retaliate: Optional[bool] = False
    lan_targets: Optional[List[Dict[str, str]]] = None


class ShieldModeRequest(BaseModel):
    mode: str
    auto_retaliate: Optional[bool] = False


# ===== DISCOVERY & LIVENESS MODELS =====
class LivenessPulseRequest(BaseModel):
    targets: List[Dict[str, Any]]
    gateway_ip: Optional[str] = None
    timeout: Optional[float] = 3.0


class ScanRequest(BaseModel):
    skip_multicast_wakeup: bool = False


class DeepPortScanRequest(BaseModel):
    ip: str
    ports: Optional[List[int]] = None


class ProfileRefreshTarget(BaseModel):
    ip: str
    mac: str
    ipv6_addresses: List[str] = Field(default_factory=list, max_length=8)


class ProfileRefreshRequest(BaseModel):
    targets: List[ProfileRefreshTarget] = Field(max_length=300)
    observation_seconds: float = Field(default=5.0, ge=3.0, le=10.0)


class QuickReauthTarget(BaseModel):
    victim_ip: str
    victim_mac: str
    gateway_ip: str
    gateway_mac: str
    victim_ipv6: Optional[str] = None
    gateway_ipv6: Optional[str] = None


class QuickReauthRequest(BaseModel):
    targets: List[QuickReauthTarget]
    hold_ms: int = 1500


# ===== SPOOFING MODELS =====
class SpoofStartRequest(BaseModel):
    victim_ip: str
    victim_mac: str
    gateway_ip: str
    gateway_mac: str
    speed_limit: int = 0
    victim_ipv6: Optional[str] = None
    gateway_ipv6: Optional[str] = None
    blackhole: bool = False  # True (Gaming) -> racun ke MAC hantu, bukan ke operator


class SpoofLimitRequest(BaseModel):
    session_id: str
    speed_limit: int


class SpoofStopRequest(BaseModel):
    session_id: str


# ===== REDIRECTOR & GATEWAY MODELS =====
class RedirectStartRequest(BaseModel):
    victim_ip: str
    victim_mac: str
    gateway_ip: str
    gateway_mac: str
    redirect_url: str
    instagram_username: str = ""


class RedirectStopRequest(BaseModel):
    victim_ip: str


class GatewayStartRequest(BaseModel):
    victim_ip: str
    victim_mac: str
    gateway_ip: str
    gateway_mac: str


class GatewayStopRequest(BaseModel):
    victim_ip: str


class SinkholeDomainRequest(BaseModel):
    domain: str


# ===== INTERCEPTOR MODELS =====
class LeafCertRequest(BaseModel):
    domain: str


# ===== BETTERCAP MODELS =====
class DnsSpoofAddRequest(BaseModel):
    domain: str
    target_ip: str = "192.168.1.1"
    action: str = "spoof"
    is_enabled: bool = True


class DnsSpoofUpdateRequest(BaseModel):
    domain: Optional[str] = None
    target_ip: Optional[str] = None
    action: Optional[str] = None
    is_enabled: Optional[bool] = None


class DnsSpoofAllRequest(BaseModel):
    enabled: bool
    address: str = ""


class DnsHostsRequest(BaseModel):
    path: Optional[str] = None
    content: Optional[str] = None
    default_address: str = ""
    action: str = "spoof"  # 'sinkhole' untuk daftar blokir


class DnsTtlRequest(BaseModel):
    ttl: int = 10


class SynScanRequest(BaseModel):
    target_ip: str
    ports: Optional[List[int]] = None
    profile: str = "top-20"


# ===== GAMING MODELS =====
class GamingToggleRequest(BaseModel):
    enabled: bool
    mode: Optional[str] = "auto_airtime"
    target_ping_ms: Optional[float] = 25.0
