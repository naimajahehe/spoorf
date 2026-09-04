# Passive Identity Profiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace disruptive Quick Re-Auth micro-cuts with safe, fresh IPv4/IPv6 evidence collection and an explainable device profiler whose high-confidence vendor-and-category results reach at least 90% precision on an authorized labeled holdout corpus.

**Architecture:** Python owns the local OUI registry, evidence collection, and deterministic classifier. Node owns single-flight orchestration, automatic per-device scheduling, persistence, compatibility aliases, and WebSocket events. React presents measured coverage, confidence, evidence, AP-isolation limitations, and no longer triggers a second scan.

**Tech Stack:** Python 3.11, FastAPI, Scapy, Python `unittest`, Node.js 20, TypeScript, Express, Socket.IO, `better-sqlite3`, React 18, Vite.

**Spec:** `docs/superpowers/specs/2026-09-04-passive-identity-profiling-design.md`

## Global Constraints

- Never use ARP poisoning, NDP poisoning, DHCP spoofing, DHCP NAK, deauthentication, packet blackholing, or target disconnect for profiling.
- Never send IPv6 Router Advertisements or forged Neighbor Advertisements from the profiling workflow.
- Never upload MAC addresses, hostnames, packet metadata, or profile evidence to an external service.
- Only use RFC 1918 IPv4 addresses, link-local/private IPv6 addresses already observed on the active network, and standard multicast discovery destinations.
- The workflow itself must not launch a broad port scan; it may reuse service metadata already present in the current device snapshot.
- One manual action produces one bounded observation/enrichment operation and no frontend follow-up scan.
- Concurrent requests share one in-flight operation, repeated requests observe a cooldown, and network changes invalidate cached results.
- High-confidence precision and runtime coverage are separate metrics. Unknown devices remain in the coverage denominator.
- `POST /api/network/quick-reauth` remains as a deprecated, non-disruptive compatibility alias.
- Existing gateway immunity, controller self-protection, token guards, and REST/WebSocket contracts remain intact.
- All network-facing tests use mocks or packet fixtures; never test against the current public network.
- Do not add a runtime dependency for vendor lookup. Ship a generated local registry artifact and use Python standard-library tooling to refresh it.

---

### Task 1: Add the Versioned Local OUI Registry

**Files:**
- Create: `python-service/src/core/fingerprint/oui_registry.py`
- Create: `python-service/src/core/fingerprint/data/oui_registry.json`
- Create: `python-service/scripts/update_oui_registry.py`
- Modify: `python-service/src/core/fingerprint/vendors.py`
- Modify: `python-service/src/core/fingerprint/__init__.py`
- Modify: `python-service/tests/test_unit_fingerprint.py`

**Interfaces:**
- Produces: `OUIRecord`, `OUIRegistry.from_mapping()`, `OUIRegistry.from_file()`, `OUIRegistry.lookup(mac)`, and `get_oui_record(mac)`.
- Preserves: `get_vendor(mac, is_gateway=False) -> str` and `is_randomized_mac(mac) -> bool`.
- Consumers: Task 2 uses `get_oui_record()` and the record's `organization`, `assignment`, and `prefix_bits`.

- [ ] **Step 1: Write failing registry tests**

Add tests that use an injected mapping so tests never download data:

```python
from src.core.fingerprint.oui_registry import OUIRegistry

def test_oui_registry_prefers_longest_registered_prefix(self):
    registry = OUIRegistry.from_mapping({
        "24": {"001122": "Example Networks"},
        "28": {"0011223": "Example Mobile"},
        "36": {"001122334": "Example Camera"},
    })

    self.assertEqual(
        registry.lookup("00:11:22:33:4a:bc").organization,
        "Example Camera",
    )
    self.assertEqual(
        registry.lookup("00:11:22:3f:aa:bb").organization,
        "Example Mobile",
    )
    self.assertEqual(
        registry.lookup("00:11:22:ff:aa:bb").organization,
        "Example Networks",
    )

def test_oui_registry_never_resolves_randomized_mac(self):
    registry = OUIRegistry.from_mapping({
        "24": {"021122": "Must Not Match"},
        "28": {},
        "36": {},
    })
    self.assertIsNone(registry.lookup("02:11:22:33:44:55"))
    self.assertIsNone(registry.lookup("not-a-mac"))
```

Extend the existing `get_vendor` tests to assert that a stable registry hit
returns the organization, while unknown stable and randomized MACs preserve
their existing fallback labels.

- [ ] **Step 2: Run the tests and confirm the missing module failure**

Run:

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest tests.test_unit_fingerprint.TestCoreFingerprint -v
```

Expected: FAIL because `src.core.fingerprint.oui_registry` does not exist.

- [ ] **Step 3: Implement normalization and longest-prefix lookup**

Use a local immutable record and check MA-S, MA-M, then MA-L:

```python
from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Dict, Optional

@dataclass(frozen=True)
class OUIRecord:
    organization: str
    assignment: str
    prefix_bits: int

class OUIRegistry:
    def __init__(self, assignments: Dict[int, Dict[str, str]]):
        self._assignments = assignments

    @classmethod
    def from_mapping(cls, data: Dict[str, Dict[str, str]]) -> "OUIRegistry":
        return cls({
            int(bits): {
                prefix.upper(): organization.strip()
                for prefix, organization in entries.items()
                if prefix and organization.strip()
            }
            for bits, entries in data.items()
        })

    @classmethod
    def from_file(cls, path: Path) -> "OUIRegistry":
        payload = json.loads(path.read_text(encoding="utf-8"))
        return cls.from_mapping(payload["assignments"])

    def lookup(self, mac: str) -> Optional[OUIRecord]:
        normalized = re.sub(r"[:-]", "", mac or "").upper()
        if not re.fullmatch(r"[0-9A-F]{12}", normalized):
            return None
        if int(normalized[:2], 16) & 0x02:
            return None
        for bits, digits in ((36, 9), (28, 7), (24, 6)):
            assignment = normalized[:digits]
            organization = self._assignments.get(bits, {}).get(assignment)
            if organization:
                return OUIRecord(organization, assignment, bits)
        return None
```

Load `data/oui_registry.json` lazily and cache the registry. `get_vendor()`
must call `get_oui_record()` before returning `Generic Device`; gateway and
randomized-MAC behavior remains unchanged.

- [ ] **Step 4: Add the deterministic registry update script**

Implement `scripts/update_oui_registry.py` with `urllib.request`, `csv`, and
`json`. Fetch these exact public registries:

```python
SOURCES = {
    24: "https://standards-oui.ieee.org/oui/oui.csv",
    28: "https://standards-oui.ieee.org/oui28/mam.csv",
    36: "https://standards-oui.ieee.org/oui36/oui36.csv",
}
```

Normalize `Assignment` to uppercase hexadecimal without separators, map it to
the trimmed `Organization Name`, sort every mapping by assignment, and write:

```json
{
  "generated_at": "ISO-8601 UTC timestamp",
  "sources": {
    "24": "https://standards-oui.ieee.org/oui/oui.csv",
    "28": "https://standards-oui.ieee.org/oui28/mam.csv",
    "36": "https://standards-oui.ieee.org/oui36/oui36.csv"
  },
  "assignments": {
    "24": {},
    "28": {},
    "36": {}
  }
}
```

Use an atomic temporary-file replacement so an interrupted update cannot
truncate the packaged database.

- [ ] **Step 5: Generate the bundled artifact and rerun tests**

Run:

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' scripts\update_oui_registry.py
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest tests.test_unit_fingerprint.TestCoreFingerprint -v
```

Expected: registry tests and all existing fingerprint tests PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git add python-service/src/core/fingerprint/oui_registry.py `
        python-service/src/core/fingerprint/data/oui_registry.json `
        python-service/scripts/update_oui_registry.py `
        python-service/src/core/fingerprint/vendors.py `
        python-service/src/core/fingerprint/__init__.py `
        python-service/tests/test_unit_fingerprint.py
git commit -m "feat(profile): add local OUI registry" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Build the Explainable Evidence-Fusion Classifier

**Files:**
- Create: `python-service/src/core/fingerprint/evidence.py`
- Create: `python-service/src/core/fingerprint/profile_rules.py`
- Create: `python-service/tests/fixtures/profile_benchmark.json`
- Create: `python-service/tests/test_profile_benchmark.py`
- Modify: `python-service/src/core/fingerprint/ensemble.py`
- Modify: `python-service/src/core/fingerprint/__init__.py`
- Modify: `python-service/src/core/scanner.py`
- Modify: `python-service/tests/test_unit_fingerprint.py`

**Interfaces:**
- Consumes: `get_oui_record(mac)` from Task 1.
- Produces `canonicalize_vendor()`, `vendor_candidates()`, and
  `device_type_candidates()` from `profile_rules.py`.
- Produces:

```text
assess_device_profile(
    *,
    ip: str,
    mac: str,
    is_gateway: bool,
    dhcp_info: dict,
    mdns_info: dict,
    ssdp_info: dict,
    netbios_info: dict,
    reverse_dns: str,
    ttl: int | None,
    open_ports: list[int],
    services: list[str],
    ipv6_info: dict,
    observed_at: str,
) -> dict
```

The returned dictionary contains:

```python
{
    "vendor": str,
    "device_type": str,
    "hostname": str,
    "os": str,
    "vendor_confidence": int,
    "type_confidence": int,
    "hostname_confidence": int,
    "profile_status": "high" | "medium" | "unknown",
    "profile_evidence": list[dict],
    "profiled_at": str,
    "profile_version": 1,
}
```

- Preserves the existing `synthesize_ensemble_profile` parameters and its
  `tuple[str, str, str, str]` return contract.

- [ ] **Step 1: Write failing classifier tests**

Add table-driven tests for these exact behaviors:

```python
def test_profile_assessment_combines_independent_samsung_phone_evidence(self):
    result = assess_device_profile(
        ip="192.168.1.20",
        mac="00:07:ab:11:22:33",
        is_gateway=False,
        dhcp_info={"hostname": "Galaxy-A07", "vendor_class": "android-dhcp-14"},
        mdns_info={"hostname": "Galaxy-A07.local", "model": "SM-A055F"},
        ssdp_info={},
        netbios_info={},
        reverse_dns="",
        ttl=64,
        open_ports=[],
        services=[],
        ipv6_info={"addresses": ["fe80::20"]},
        observed_at="2026-09-04T08:00:00Z",
    )
    self.assertEqual(result["vendor"], "Samsung")
    self.assertEqual(result["device_type"], "Smartphone / Tablet")
    self.assertEqual(result["profile_status"], "high")
    self.assertGreaterEqual(result["vendor_confidence"], 80)
    self.assertGreaterEqual(result["type_confidence"], 80)

def test_profile_assessment_keeps_randomized_silent_device_unknown(self):
    result = assess_device_profile(
        ip="192.168.1.21",
        mac="c2:4e:ca:88:04:2d",
        is_gateway=False,
        dhcp_info={},
        mdns_info={},
        ssdp_info={},
        netbios_info={},
        reverse_dns="",
        ttl=None,
        open_ports=[],
        services=[],
        ipv6_info={},
        observed_at="2026-09-04T08:00:00Z",
    )
    self.assertEqual(result["vendor"], "Unknown")
    self.assertEqual(result["device_type"], "Unknown")
    self.assertEqual(result["profile_status"], "unknown")

def test_profile_assessment_does_not_treat_intel_oui_as_laptop_brand(self):
    result = assess_device_profile(
        ip="192.168.1.22",
        mac="00:02:b3:11:22:33",
        is_gateway=False,
        dhcp_info={},
        mdns_info={},
        ssdp_info={},
        netbios_info={"hostname": "DESKTOP-58NKETL"},
        reverse_dns="DESKTOP-58NKETL",
        ttl=128,
        open_ports=[445],
        services=["SMB"],
        ipv6_info={},
        observed_at="2026-09-04T08:00:00Z",
    )
    self.assertEqual(result["device_type"], "PC / Laptop")
    self.assertNotEqual(result["profile_status"], "high")
```

Also cover conflicting strong evidence, OUI-only evidence, explicit SSDP
manufacturer/model, DHCPv6 DUID correlation, exact hostname preservation, and
gateway/controller exclusion from coverage.

- [ ] **Step 2: Run the classifier tests and confirm failure**

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest tests.test_unit_fingerprint.TestCoreFingerprint -v
```

Expected: FAIL because `assess_device_profile` and structured evidence do not
exist.

- [ ] **Step 3: Implement evidence records and independent-group scoring**

Define:

```python
from dataclasses import asdict, dataclass
from typing import Literal

EvidenceStrength = Literal["weak", "medium", "strong", "explicit"]
ProfileStatus = Literal["high", "medium", "unknown"]

@dataclass(frozen=True)
class ProfileEvidence:
    source: str
    group: str
    field: str
    value: str
    strength: EvidenceStrength
    observed_at: str

    def to_dict(self) -> dict:
        return asdict(self)
```

Use separate vendor, type, and hostname candidate maps. Add no more than one
score contribution per evidence group for a candidate:

| Evidence | Vendor points | Type points | Hostname points |
| --- | ---: | ---: | ---: |
| Unambiguous manufacturer-and-model identifier from SSDP or mDNS | 85 | 85 | 45 |
| Manufacturer or model alone from SSDP or mDNS | 60 | 60 | 35 |
| DHCP/DHCPv6 vendor class, FQDN, or hostname | 45 | 50 | 60 |
| Stable OUI registration | 55 | 25 | 0 |
| NetBIOS or reverse DNS name | 0 | 35 | 55 |
| Advertised service signature | 0 | 35 | 0 |
| Hostname/model pattern | 35 | 35 | 20 |
| TTL/liveness behavior | 0 | 10 | 0 |

Clamp scores to 100. Assign:

```python
high = (
    vendor_score >= 80
    and type_score >= 80
    and (
        len(vendor_groups) >= 2
        or "explicit_identity" in vendor_groups
    )
    and (
        len(type_groups) >= 2
        or "explicit_identity" in type_groups
    )
)
medium = vendor_score >= 60 or type_score >= 60
status = "high" if high else "medium" if medium else "unknown"
```

Do not emit a vendor from OUI when the MAC is locally administered. Treat
`Generic Device`, `Private Device (Randomized MAC)`, and `Router / Gateway` as
non-identified values for non-gateway clients.

Implement canonicalization and category rules in `profile_rules.py`, not as
ad-hoc branches inside the scorer:

```python
COMPONENT_ONLY_VENDORS = {
    "Intel",
    "Realtek",
    "MediaTek",
    "Foxconn",
    "Qualcomm",
    "AzureWave",
    "Lite-On",
}

DEVICE_TYPE_RULES = {
    "Smartphone / Tablet": {
        "vendor_tokens": {
            "samsung", "xiaomi", "redmi", "poco", "oppo", "realme",
            "vivo", "infinix", "tecno", "oneplus", "iphone", "ipad",
        },
        "identity_tokens": {
            "android-dhcp", "galaxy", "iphone", "ipad", "pixel",
            "sm-a", "sm-s", "redmi", "poco",
        },
        "service_tokens": {"_companion-link._tcp", "_apple-mobdev2._tcp"},
    },
    "PC / Laptop": {
        "identity_tokens": {
            "desktop-", "laptop-", "macbook", "imac", "msft 5.0",
        },
        "service_tokens": {"smb", "microsoft-ds", "_workstation._tcp"},
    },
    "Smart TV / Multimedia": {
        "identity_tokens": {
            "qled", "bravia", "smart tv", "chromecast", "android tv",
            "roku", "soundbar", "airplay",
        },
        "service_tokens": {
            "_googlecast._tcp", "_airplay._tcp", "_raop._tcp",
        },
    },
    "Printer": {
        "identity_tokens": {"printer", "laserjet", "deskjet", "epson"},
        "service_tokens": {"ipp", "_ipp._tcp", "_printer._tcp"},
    },
    "IP Camera / IoT": {
        "identity_tokens": {
            "camera", "webcam", "esp32", "esp8266", "tuya",
        },
        "service_tokens": {"rtsp", "mqtt", "_hap._tcp"},
    },
    "Network Infrastructure": {
        "identity_tokens": {
            "router", "access point", "openwrt", "routeros",
        },
        "service_tokens": {"snmp", "dns", "dhcp"},
    },
}
```

Canonical vendor aliases use a reviewed allowlist for Apple, Samsung, Xiaomi,
Google, Microsoft, Lenovo, Dell, HP, ASUS, Acer, Sony, LG, TP-Link, MikroTik,
Ubiquiti, Huawei, OPPO, Realme, Vivo, Infinix, Tecno, OnePlus, Espressif,
Raspberry Pi, Epson, Canon, Brother, and HP Printer. Preserve the raw
organization/model value in evidence.

An OUI hit in `COMPONENT_ONLY_VENDORS` is useful hardware evidence but cannot
be emitted as the device vendor without an independent explicit identity
source. A broad consumer vendor token such as Samsung or Apple is supporting
evidence only; explicit model, hostname, and service evidence takes precedence
so a Samsung TV is not classified as a phone. Generic port 80/443 evidence
never determines a category.

- [ ] **Step 4: Preserve the tuple API and enrich scanner output**

Add `synthesize_profile_assessment()` to `ensemble.py`. Make the old
`synthesize_ensemble_profile()` delegate to it and return only:

```python
(
    assessment["hostname"],
    assessment["vendor"],
    assessment["os"],
    assessment["device_type"],
)
```

Update `NetworkScanner._build_device()` to include all structured profile
fields in its returned device dictionary. Do not change existing REST keys.

- [ ] **Step 5: Add a labeled benchmark with a true holdout split**

`profile_benchmark.json` must contain at least 40 cases:

- 8 Windows PC/laptop cases;
- 8 Android phone/tablet cases;
- 6 Apple mobile/desktop cases;
- 6 TV/printer/media cases;
- 6 IoT/camera cases;
- 3 network-infrastructure cases;
- 3 deliberately ambiguous or silent randomized-MAC cases.

Each row contains `split` (`development` or `holdout`), `input`,
`expected_vendor`, `expected_device_type`, and `expect_high`. At least one
third of the rows must be holdout cases. The test computes:

```python
precision = correct_high / emitted_high if emitted_high else 0.0
coverage = emitted_high / eligible if eligible else 0.0
self.assertGreaterEqual(precision, 0.90)
```

Unknown holdout cases stay in `eligible`; they are not removed to improve
coverage. Document in the fixture metadata whether a case is synthetic or
captured from an authorized test device.

- [ ] **Step 6: Run targeted tests**

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest `
  tests.test_unit_fingerprint `
  tests.test_profile_benchmark -v
```

Expected: PASS with holdout high-confidence precision at or above 0.90.

- [ ] **Step 7: Commit Task 2**

```powershell
git add python-service/src/core/fingerprint/evidence.py `
        python-service/src/core/fingerprint/profile_rules.py `
        python-service/src/core/fingerprint/ensemble.py `
        python-service/src/core/fingerprint/__init__.py `
        python-service/src/core/scanner.py `
        python-service/tests/test_unit_fingerprint.py `
        python-service/tests/test_profile_benchmark.py `
        python-service/tests/fixtures/profile_benchmark.json
git commit -m "feat(profile): add explainable evidence fusion" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Add Safe IPv4 and IPv6 Profile Observation

**Files:**
- Create: `python-service/src/core/discovery/profile_observation.py`
- Create: `python-service/tests/test_unit_profile_observation.py`
- Modify: `python-service/src/core/discovery/multicast.py`
- Modify: `python-service/src/core/discovery/__init__.py`
- Modify: `python-service/src/server.py`
- Modify: `python-service/tests/test_api_server.py`
- Modify: `python-service/tests/test_unit_discovery.py`
- Modify: `python-service/src/core/spoofer.py`
- Modify: `python-service/tests/test_unit_spoofer.py`

**Interfaces:**
- Consumes: `assess_device_profile()` from Task 2 and existing DHCP, mDNS,
  SSDP, ARP, NDP, NetBIOS, reverse-DNS, and liveness helpers.
- Produces:

```text
collect_identity_multicast(timeout: float = 0.8) -> dict

collect_profile_refresh(
    targets: list[dict],
    observation_seconds: float = 5.0,
) -> dict
```

`collect_profile_refresh()` returns:

```python
{
    "visible_count": int,
    "high_confidence_count": int,
    "medium_confidence_count": int,
    "unknown_count": int,
    "hostname_count": int,
    "coverage_percentage": int | None,
    "sources": dict[str, int],
    "ap_isolation": dict,
    "partial_failures": list[dict],
    "duration_ms": int,
    "devices": list[dict],
}
```

- Adds Python endpoint: `POST /api/network/profile-refresh`.
- Converts Python `POST /api/network/quick-reauth` into a safe deprecated
  alias.

- [ ] **Step 1: Write failing collector tests**

Create tests for validation, one discovery burst, current-cache evidence,
bounded concurrency, IPv6 correlation, and partial failures:

```python
def test_profile_refresh_collects_once_without_spoofing(self):
    targets = [{
        "ip": "192.168.1.20",
        "mac": "00:07:ab:11:22:33",
        "ipv6_addresses": ["fe80::20"],
    }]
    with patch(
        "src.core.discovery.profile_observation.collect_identity_multicast",
        return_value={
            "delivery": {"attempted": 6, "succeeded": 6, "failed": 0},
            "ssdp": {},
            "mdns": {},
            "llmnr": {},
            "partial_failures": [],
        },
    ) as multicast, patch(
        "src.core.discovery.profile_observation.assess_device_profile",
        return_value={
            "vendor": "Samsung",
            "device_type": "Smartphone / Tablet",
            "hostname": "Galaxy-A07",
            "os": "Android",
            "vendor_confidence": 94,
            "type_confidence": 96,
            "hostname_confidence": 90,
            "profile_status": "high",
            "profile_evidence": [],
            "profiled_at": "2026-09-04T08:00:00Z",
            "profile_version": 1,
        },
    ), patch("src.core.spoofer.ARPSpoofer.start") as arp_start, patch(
        "src.core.spoofer_v6.NDPSpoofer.start_spoof"
    ) as ndp_start:
        result = collect_profile_refresh(targets, observation_seconds=3)

    multicast.assert_called_once()
    arp_start.assert_not_called()
    ndp_start.assert_not_called()
    self.assertEqual(result["high_confidence_count"], 1)
```

In `test_unit_discovery.py`, verify query and receive use the same sockets:

```python
import socket
from src.core.discovery.multicast import collect_identity_multicast

class FakeDiscoverySocket:
    def __init__(self):
        self.sent = []
        self.received_after_send = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def setsockopt(self, *_args):
        return None

    def settimeout(self, _timeout):
        return None

    def sendto(self, payload, destination):
        self.sent.append((payload, destination))
        return len(payload)

    def recvfrom(self, _size):
        self.received_after_send = bool(self.sent)
        raise socket.timeout()

def test_identity_multicast_receives_on_the_query_sockets(self):
    sockets = [FakeDiscoverySocket(), FakeDiscoverySocket()]
    with patch(
        "src.core.discovery.multicast.socket.socket",
        side_effect=sockets,
    ):
        result = collect_identity_multicast(timeout=0.01)

    self.assertTrue(all(sock.received_after_send for sock in sockets))
    self.assertEqual(result["delivery"]["attempted"], 6)
```

Add packet fixtures for one SSDP response, one mDNS response, and one LLMNR
response so normalization is tested without opening a real socket.

Add cases that reject public IPv4, non-link-local/non-ULA IPv6, malformed
MACs, more than 300 targets, and a total collector failure. A per-sensor
failure must appear in `partial_failures` without discarding successful
assessments. Add a DHCP fixture older than five minutes and assert that it is
not used as fresh identity evidence. Add tests that reject the gateway,
controller, an IPv4 target outside the active private CIDR, and an IPv6 address
whose MAC/address pair is absent from the current NDP snapshot.

- [ ] **Step 2: Run the collector tests and confirm failure**

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest `
  tests.test_unit_profile_observation `
  tests.test_unit_discovery -v
```

Expected: FAIL because `profile_observation.py` and
`collect_identity_multicast()` do not exist.

- [ ] **Step 3: Implement the bounded collector**

Normalize and deduplicate targets by lowercase MAC. Enforce:

```python
MAX_PROFILE_TARGETS = 300
MAX_PROFILE_WORKERS = 8
MIN_OBSERVATION_SECONDS = 3.0
MAX_OBSERVATION_SECONDS = 10.0
DEFAULT_OBSERVATION_SECONDS = 5.0
EVIDENCE_MAX_AGE_SECONDS = 300
```

Perform this sequence:

1. resolve the active controller IP, MAC, gateway, and private CIDR, then
   validate every target before network I/O;
2. capture current ARP/NDP data and DHCP/DHCPv6 entries no older than five
   minutes;
3. call `collect_identity_multicast()` exactly once;
4. wait using `time.sleep()` inside the executor-owned worker, never the
   FastAPI event loop;
5. capture final fresh DHCP/DHCPv6 entries;
6. run per-target reverse-DNS, NetBIOS, and known-address IPv6 liveness
   collection in a `ThreadPoolExecutor(max_workers=8)`;
7. call `assess_device_profile()` once per normalized MAC;
8. summarize high, medium, unknown, hostname, source counts, AP isolation,
   partial failures, and duration.

Implement `collect_identity_multicast()` in `multicast.py`. Each SSDP, mDNS,
and LLMNR IPv4/IPv6 query must be sent at most once, and each response must be
read on the same socket that sent its query. Return structured delivery,
normalized per-run data, and per-protocol failures. The returned SSDP, mDNS,
and LLMNR maps must contain only responses observed during the current call;
they may also update the existing compatibility caches. Preserve
`send_multicast_wakeup()`, `collect_ssdp_sensors()`, and
`collect_mdns_sensors()` for existing Method 1 and scanner callers.

Do not call `scan_ports()`, `sweep_subnet_for_arp()`, `ARPSpoofer`,
`NDPSpoofer`, `sendp()`, or any Router Advertisement builder.

Reject gateway/controller targets by both IP and normalized MAC. Require every
IPv4 address to belong to the active private CIDR. For IPv6, accept only
link-local or ULA addresses whose normalized address is already mapped to the
same target MAC in the current NDP snapshot; request input alone is not proof
that an IPv6 target was observed.

- [ ] **Step 4: Write failing API compatibility and safety tests**

Import `profile_refresh`, the existing `quick_reauth_profiling` handler,
`ProfileRefreshRequest`, and `ProfileRefreshTarget` in `test_api_server.py`.
Add:

```python
def test_profile_refresh_rejects_public_target_before_collection(self):
    request = ProfileRefreshRequest(targets=[
        ProfileRefreshTarget(ip="203.0.113.20", mac="00:11:22:33:44:55")
    ])
    with patch("src.server.collect_profile_refresh") as collect:
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(profile_refresh(request))
    self.assertEqual(ctx.exception.status_code, 400)
    collect.assert_not_called()

def test_legacy_quick_reauth_is_safe_alias(self):
    request = QuickReauthRequest(targets=[
        QuickReauthTarget(
            victim_ip="192.168.1.20",
            victim_mac="00:11:22:33:44:55",
            gateway_ip="192.168.1.1",
            gateway_mac="00:aa:bb:cc:dd:ee",
        )
    ])
    safe_result = {"visible_count": 1, "high_confidence_count": 0}
    with patch("src.server.collect_profile_refresh", return_value=safe_result), \
         patch.object(spoofer, "start") as start_spoof:
        response = asyncio.run(quick_reauth_profiling(request))
    self.assertTrue(response["success"])
    self.assertTrue(response["deprecated"])
    start_spoof.assert_not_called()
```

- [ ] **Step 5: Add the canonical endpoint and safe alias**

Add Pydantic models with bounded lists and observation time:

```python
from pydantic import BaseModel, Field

class ProfileRefreshTarget(BaseModel):
    ip: str
    mac: str
    ipv6_addresses: List[str] = Field(default_factory=list, max_length=8)

class ProfileRefreshRequest(BaseModel):
    targets: List[ProfileRefreshTarget] = Field(max_length=300)
    observation_seconds: float = Field(default=5.0, ge=3.0, le=10.0)
```

Run `collect_profile_refresh()` in the existing executor. Return HTTP 400 for
invalid topology, 422 for model validation, 503 when no collector can run, and
200 with `partial_failures` when at least one source produced evidence.

The legacy handler converts `QuickReauthTarget` fields into
`ProfileRefreshTarget` values, ignores gateway fields for profiling, delegates
to the same safe helper, and returns `deprecated: true`.

- [ ] **Step 6: Remove the obsolete micro-cut implementation**

Delete `ARPSpoofer.micro_cut_batch()` and its two old unit tests. Verify no
production path references it:

```powershell
rg "micro_cut_batch" python-service/src backend-node/src frontend-react/src
```

Expected: no matches.

- [ ] **Step 7: Run Python profile and API tests**

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest `
  tests.test_unit_profile_observation `
  tests.test_api_server `
  tests.test_unit_spoofer -v
```

Expected: PASS, with assertions proving no spoofing or RA path is invoked.

- [ ] **Step 8: Commit Task 3**

```powershell
git add python-service/src/core/discovery/profile_observation.py `
        python-service/src/core/discovery/multicast.py `
        python-service/src/core/discovery/__init__.py `
        python-service/src/server.py `
        python-service/src/core/spoofer.py `
        python-service/tests/test_unit_profile_observation.py `
        python-service/tests/test_api_server.py `
        python-service/tests/test_unit_discovery.py `
        python-service/tests/test_unit_spoofer.py
git commit -m "feat(profile): replace micro-cut with safe observation" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Persist Profile Confidence and Evidence Atomically

**Files:**
- Modify: `backend-node/src/types/index.ts`
- Modify: `backend-node/src/services/database.ts`
- Modify: `backend-node/tests/unit_database.test.ts`

**Interfaces:**
- Produces TypeScript types:

```typescript
export type ProfileStatus = 'high' | 'medium' | 'unknown';

export interface ProfileEvidence {
    source: string;
    group: string;
    field: string;
    value: string;
    strength: 'weak' | 'medium' | 'strong' | 'explicit';
    observed_at: string;
}

export interface ProfileAssessment {
    mac: string;
    ip: string;
    vendor: string;
    device_type: string;
    hostname: string;
    os: string;
    vendor_confidence: number;
    type_confidence: number;
    hostname_confidence: number;
    profile_status: ProfileStatus;
    profile_evidence: ProfileEvidence[];
    profiled_at: string;
    profile_version: number;
}

export interface ProfileRefreshResponse {
    visible_count: number;
    high_confidence_count: number;
    medium_confidence_count: number;
    unknown_count: number;
    hostname_count: number;
    coverage_percentage: number | null;
    sources: Record<string, number>;
    ap_isolation: Record<string, unknown>;
    partial_failures: Array<{ source: string; error: string }>;
    duration_ms: number;
    devices: ProfileAssessment[];
}

export interface ProfileRefreshResult
    extends Omit<ProfileRefreshResponse, 'devices'> {
    success: true;
    devices: Device[];
    cached: boolean;
    cooldown_remaining_ms: number;
}
```

- Adds `DatabaseService.updateDeviceProfileAssessment(profile)`.
- Consumers: Task 5 orchestration and Task 6 frontend contract.

- [ ] **Step 1: Write failing SQLite migration and persistence tests**

Use an in-memory database and assert:

```typescript
await db.updateDeviceProfileAssessment({
    mac: '00:07:ab:11:22:33',
    ip: '192.168.1.20',
    vendor: 'Samsung',
    device_type: 'Smartphone / Tablet',
    hostname: 'Galaxy-A07',
    os: 'Android',
    vendor_confidence: 94,
    type_confidence: 96,
    hostname_confidence: 90,
    profile_status: 'high',
    profile_evidence: [{
        source: 'mdns',
        group: 'explicit_identity',
        field: 'model',
        value: 'SM-A055F',
        strength: 'explicit',
        observed_at: '2026-09-04T08:00:00Z'
    }],
    profiled_at: '2026-09-04T08:00:05Z',
    profile_version: 1
});

const [stored] = await db.getAllDevices();
assert.strictEqual(stored.profile_status, 'high');
assert.strictEqual(stored.vendor_confidence, 94);
assert.strictEqual(stored.profile_evidence?.[0].source, 'mdns');
```

Also test transaction rollback, malformed evidence rejection, evidence JSON
size enforcement, and preservation of alias/block/session state. Add a
high-to-unknown refresh case: the last-known vendor/type/hostname remain
visible, but `profile_status`, confidence, evidence, and `profiled_at` update
to the fresh unknown assessment.

- [ ] **Step 2: Run the database tests and confirm failure**

```powershell
Set-Location backend-node
npm test
```

Expected: FAIL because profile assessment fields and persistence do not exist.

- [ ] **Step 3: Add shared types and additive schema migration**

Extend `Device` with optional assessment fields. Add device columns:

```sql
profile_status TEXT DEFAULT 'unknown',
vendor_confidence INTEGER DEFAULT 0,
type_confidence INTEGER DEFAULT 0,
hostname_confidence INTEGER DEFAULT 0,
profile_evidence TEXT DEFAULT '[]',
profiled_at TEXT,
profile_version INTEGER DEFAULT 1
```

Use `PRAGMA table_info(devices)` to determine missing columns before issuing
each `ALTER TABLE`; do not use broad exception handling to infer schema state.

- [ ] **Step 4: Implement atomic assessment persistence**

Validate:

- normalized MAC is present;
- confidence values are finite integers clamped to 0-100;
- status is exactly `high`, `medium`, or `unknown`;
- evidence is an array and serialized JSON is no larger than 32 KiB;
- `profile_version` is a positive integer.

Execute one transaction that updates identity and assessment fields while
leaving alias, block, redirect, speed-limit, profile-link, and session fields
unchanged. Replace vendor, type, or hostname only when the fresh assessment
contains a non-generic value. Always replace profile status, confidence,
evidence, timestamp, and version. Therefore a last-known label may remain
visible after a silent refresh, but it cannot count as fresh because its
current `profile_status` is not `high`.

Update all SELECT, upsert, and row-mapping paths so the fields survive restart
and scan reconciliation.

- [ ] **Step 5: Run database tests and TypeScript build**

```powershell
Set-Location backend-node
npm test
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit Task 4**

```powershell
git add backend-node/src/types/index.ts `
        backend-node/src/services/database.ts `
        backend-node/tests/unit_database.test.ts
git commit -m "feat(profile): persist confidence and evidence" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Orchestrate One Safe Profile Refresh in Node

**Files:**
- Modify: `backend-node/src/services/pythonBridge.ts`
- Modify: `backend-node/src/services/deviceManager.ts`
- Modify: `backend-node/src/api/routes.ts`
- Modify: `backend-node/src/websocket/index.ts`
- Modify: `backend-node/tests/unit_pythonBridge.test.ts`
- Modify: `backend-node/tests/unit_deviceManager.test.ts`
- Modify: `backend-node/tests/api_routes.test.ts`

**Interfaces:**
- Consumes: Python `POST /api/network/profile-refresh` from Task 3 and
  `DatabaseService.updateDeviceProfileAssessment()` from Task 4.
- Produces:

```typescript
PythonBridge.profileRefresh(
    targets: Array<{ ip: string; mac: string; ipv6_addresses: string[] }>,
    observationSeconds?: number
): Promise<ProfileRefreshResponse>

DeviceManager.profileRefresh(): Promise<ProfileRefreshResult>

DeviceManager.runProfileRefresh(
    targetMacs: Set<string> | null,
    scope: 'all' | 'subset'
): Promise<ProfileRefreshResult>
```

- Preserves: `DeviceManager.quickReauthProfiling()` as a deprecated method that
  delegates to `profileRefresh()`.

- [ ] **Step 1: Write failing PythonBridge contract tests**

Mock `fetch` and assert:

```typescript
const result = await bridge.profileRefresh([{
    ip: '192.168.1.20',
    mac: '00:07:ab:11:22:33',
    ipv6_addresses: ['fe80::20']
}], 5);

assert.strictEqual(request.url.endsWith('/api/network/profile-refresh'), true);
assert.deepStrictEqual(JSON.parse(request.body || '{}'), {
    targets: [{
        ip: '192.168.1.20',
        mac: '00:07:ab:11:22:33',
        ipv6_addresses: ['fe80::20']
    }],
    observation_seconds: 5
});
assert.deepStrictEqual(result, responsePayload.data);
```

Add a test that HTTP 503 rejects through `readMutationResponse()` instead of
returning an empty success.

- [ ] **Step 2: Write failing DeviceManager orchestration tests**

Cover:

- concurrent calls share one Python request;
- a manual call arriving during an automatic subset waits and then runs one
  fresh full refresh;
- an automatic event arriving during a full refresh does not launch another
  operation;
- one cooldown result is reused;
- network changes invalidate cooldown;
- all online visible devices are included, including already-profiled devices;
- gateway and controller are excluded;
- no call to `scanNetwork()` occurs after the Python result;
- partial failures survive the bridge;
- total failures reject;
- returned assessments merge by normalized MAC;
- every assessment is persisted exactly once;
- a fresh unknown assessment preserves last-known display labels but removes
  the device from high-confidence coverage;
- new-device scheduling is debounced and has a per-MAC cooldown;
- a device newly added by scan reconciliation schedules enrichment once;
- a DHCP event with new identity evidence schedules enrichment once;
- the deprecated method delegates without calling `python.quickReauth()`.

Use a gated mock promise, matching the existing Method 1 single-flight tests:

```typescript
const first = manager.profileRefresh();
const second = manager.profileRefresh();
await new Promise(resolve => setImmediate(resolve));
assert.strictEqual(profileCalls, 1);
releaseObservation();
assert.deepStrictEqual(await first, await second);
assert.strictEqual(scanCalls, 0);
```

- [ ] **Step 3: Run Node tests and confirm failure**

```powershell
Set-Location backend-node
npm test
```

Expected: FAIL because the bridge and orchestrator methods do not exist.

- [ ] **Step 4: Implement the bridge method**

Use the existing authenticated `fetchWithTimeout()` and
`readMutationResponse()` helpers:

```typescript
async profileRefresh(
    targets: Array<{ ip: string; mac: string; ipv6_addresses: string[] }>,
    observationSeconds = 5
): Promise<ProfileRefreshResponse> {
    const timeoutMs = Math.ceil(observationSeconds * 1000) + 15000;
    const res = await this.fetchWithTimeout(
        `${this.baseUrl}/api/network/profile-refresh`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targets,
                observation_seconds: observationSeconds
            })
        },
        timeoutMs
    );
    const payload = await this.readMutationResponse(res, 'Profile refresh');
    return payload.data;
}
```

Make `quickReauth(targets, _holdMs)` convert each legacy
`victim_ip`/`victim_mac`/`victim_ipv6` value into the canonical target shape,
delegate to `profileRefresh(convertedTargets, 5)`, and return the same safe
result. Ignore the legacy hold duration because the safe observation window is
clamped by Python. It must not contact the old Python route.

- [ ] **Step 5: Implement single-flight orchestration and automatic scheduling**

Add:

```typescript
private inFlightProfileRefresh: Promise<ProfileRefreshResult> | null = null;
private inFlightProfileRefreshScope: 'all' | 'subset' | null = null;
private profileRefreshGeneration = 0;
private lastProfileRefresh: {
    completedAt: number;
    result: ProfileRefreshResult;
} | null = null;
private pendingProfileMacs = new Set<string>();
private profileEnrichmentTimer: NodeJS.Timeout | null = null;
private profileEnrichmentCooldowns = new Map<string, number>();
```

Use a 20-second manual cooldown and a 60-second per-MAC automatic cooldown.
Increment `profileRefreshGeneration`, clear the cached result, and cancel
pending per-MAC timers on `networkChanged`.

`profileRefresh()` must:

1. snapshot all online devices;
2. exclude gateway, controller, malformed MACs, and missing or non-private
   IPv4;
3. deduplicate by normalized MAC;
4. call `python.profileRefresh()` once;
5. reject when Python rejects;
6. merge assessments by MAC without clearing live state;
7. persist each assessment atomically;
8. emit new and compatibility events;
9. return measured counts, failures, duration, devices, and cooldown metadata.

The automatic path schedules only the new/changed MAC and shares the same
underlying persistence and merge function. It must not recursively schedule
itself when assessment fields are merged. Call
`scheduleProfileEnrichment(mac, 1500)` after scan reconciliation discovers a
new online device and after `_handleDhcpEvent()` receives new identity
evidence. The scheduler must re-read the current device by MAC before running,
so IP churn cannot target a stale address.

Batch pending automatic MACs behind one timer. If a full manual refresh is
already running, clear the pending set because that operation includes every
visible device. If a subset refresh is running, keep pending MACs and drain
them after it finishes. If a manual refresh arrives during a subset refresh,
await the subset and then start one fresh full refresh; never satisfy the
manual request with a subset result.

- [ ] **Step 6: Update routes and Socket.IO events**

Add:

```typescript
router.post('/api/network/profile-refresh', async (_req, res) => {
    try {
        const result = await deviceManager.profileRefresh();
        res.json({ success: true, data: result });
    } catch (err: any) {
        respondError(res, err);
    }
});
```

Change `/api/network/quick-reauth` to call the same method and add
`deprecated: true`. Emit:

- `profileRefreshStarted`;
- `profileRefreshDone`;
- legacy `quickReauthStarted`;
- legacy `quickReauthDone`.

Every legacy payload includes:

```typescript
{ operation: 'profile_refresh', deprecated: true, count: visibleCount }
```

- [ ] **Step 7: Run Node tests and build**

```powershell
Set-Location backend-node
npm test
npm run build
```

Expected: all tests pass and TypeScript emits no errors.

- [ ] **Step 8: Commit Task 5**

```powershell
git add backend-node/src/services/pythonBridge.ts `
        backend-node/src/services/deviceManager.ts `
        backend-node/src/api/routes.ts `
        backend-node/src/websocket/index.ts `
        backend-node/tests/unit_pythonBridge.test.ts `
        backend-node/tests/unit_deviceManager.test.ts `
        backend-node/tests/api_routes.test.ts
git commit -m "feat(profile): orchestrate safe identity refresh" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Replace the Method 3 Frontend Experience

**Files:**
- Create: `frontend-react/src/lib/profileCoverage.ts`
- Create: `frontend-react/scripts/test-profile-coverage.mjs`
- Modify: `frontend-react/package.json`
- Modify: `frontend-react/src/types/index.ts`
- Modify: `frontend-react/src/hooks/useWebSocket.ts`
- Modify: `frontend-react/src/components/DhcpReconnectModal.tsx`
- Modify: `frontend-react/src/App.tsx`

**Interfaces:**
- Consumes: `POST /api/network/profile-refresh` and
  `profileRefreshStarted/profileRefreshDone`.
- Produces:

```typescript
export function isIdentifiedVendor(device: Device): boolean
export function isIdentifiedType(device: Device): boolean
export function isHighConfidenceProfile(device: Device): boolean
export function calculateProfileCoverage(devices: Device[]): ProfileCoverage
```

- Replaces hook callback `quickReauth()` with `profileRefresh()`.

- [ ] **Step 1: Write failing pure-function frontend assertions**

Compile `profileCoverage.ts` using the existing no-new-dependency test pattern.
Assert:

```javascript
assert.equal(isIdentifiedVendor({ vendor: 'Generic Device' }), false);
assert.equal(isIdentifiedVendor({ vendor: 'Private Device (Randomized MAC)' }), false);
assert.equal(isIdentifiedVendor({ vendor: 'Samsung' }), true);
assert.equal(isIdentifiedType({ device_type: 'Generic Client Device' }), false);
assert.equal(isHighConfidenceProfile({
    vendor: 'Samsung',
    device_type: 'Smartphone / Tablet',
    profile_status: 'high',
    vendor_confidence: 94,
    type_confidence: 96
}), true);
```

For a unique-MAC sample containing gateway, controller, offline, high, medium,
and unknown devices, assert exact visible/high/medium/unknown counts and
coverage. Unknown devices must remain in the denominator.

- [ ] **Step 2: Run the script and confirm failure**

Add:

```json
"test:profile-coverage": "node scripts/test-profile-coverage.mjs"
```

Then run:

```powershell
Set-Location frontend-react
npm run test:profile-coverage
```

Expected: FAIL because `profileCoverage.ts` does not exist.

- [ ] **Step 3: Implement shared profile coverage helpers**

Return:

```typescript
export interface ProfileCoverage {
    visible: number;
    highConfidence: number;
    mediumConfidence: number;
    unknown: number;
    hostnameCount: number;
    coveragePercentage: number | null;
}
```

Normalize MACs, exclude offline/gateway/controller rows, deduplicate, and count
high confidence only when vendor and type are both identified and their
confidence values meet the backend contract.

- [ ] **Step 4: Replace hook API and event copy**

Implement:

```typescript
const profileRefresh = async () => {
    const res = await apiFetch('/api/network/profile-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.success === false) {
        throw new Error(payload.error || 'Gagal menjalankan profiling perangkat');
    }
    return payload.data;
};
```

Listen for the new events. Keep legacy listeners only as compatibility input
and suppress duplicate activity entries when `operation ===
'profile_refresh'`.

- [ ] **Step 5: Replace Method 3 UI**

In `DhcpReconnectModal.tsx`:

- rename props and state from quick re-auth to profile refresh;
- remove the obsolete `onTriggerReScan` prop from the modal and its `App.tsx`
  caller;
- remove all `Micro-Cut`, `memutus`, `reconnect`, `DHCP REQUEST baru`, `100%`,
  and instant-success wording;
- call the endpoint exactly once;
- do not call `onTriggerReScan()` after success;
- show visible, high, medium, unknown, hostname, coverage, duration, AP
  isolation, source counts, and partial failures;
- explain that Unknown is intentional when evidence is insufficient.

Update `App.tsx` to pass `profileRefresh`. Extend the frontend `Device` type
with Task 4's confidence and evidence fields.

- [ ] **Step 6: Add source-level safety assertions**

The frontend test script must read the modal and hook source and assert:

```javascript
assert.equal(modalSource.includes('Micro-Cut'), false);
assert.equal(modalSource.includes('memutus akses'), false);
assert.equal(modalSource.includes('onTriggerReScan'), false);
assert.equal(hookSource.includes('/api/network/profile-refresh'), true);
```

- [ ] **Step 7: Run frontend tests and build**

```powershell
Set-Location frontend-react
npm run test:dhcp-profiling
npm run test:refresh-sequencer
npm run test:profile-coverage
npm run build
```

Expected: all scripts pass and Vite build exits 0.

- [ ] **Step 8: Commit Task 6**

```powershell
git add frontend-react/src/lib/profileCoverage.ts `
        frontend-react/scripts/test-profile-coverage.mjs `
        frontend-react/package.json `
        frontend-react/src/types/index.ts `
        frontend-react/src/hooks/useWebSocket.ts `
        frontend-react/src/components/DhcpReconnectModal.tsx `
        frontend-react/src/App.tsx
git commit -m "feat(profile): replace quick re-auth UI" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Update Contracts, Documentation, and Final Safety Checks

**Files:**
- Modify: `docs/API_SPEC.md`
- Modify: `docs/EVENT_TAXONOMY.md`
- Modify: `docs/specs/SPEC-001_NETWORK_DISCOVERY_PIPELINE.md`
- Modify: `docs/specs/SPEC-002_DHCP_PASSIVE_PROFILING.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Documents the canonical profile-refresh endpoint, compatibility alias,
  confidence semantics, automatic enrichment events, safety constraints, and
  measured accuracy terminology.

- [ ] **Step 1: Update API documentation**

Document:

- `POST /api/network/profile-refresh`;
- exact request and response fields;
- five-second default observation window;
- partial versus total failure behavior;
- deprecated `/api/network/quick-reauth` alias;
- no DHCP-renewal or re-authentication claim.

- [ ] **Step 2: Update event and discovery documentation**

Add `profileRefreshStarted` and `profileRefreshDone`, including the compatibility
event payload. Document IPv6 evidence collection and explicitly prohibit RA/NA
forging in the profiling workflow.

Update SPEC-002 so Method 3 describes identity enrichment rather than
micro-cut. Add the accuracy-versus-coverage definitions from the design spec.

- [ ] **Step 3: Run source-contract checks**

```powershell
rg -n "Micro-Cut|memutus akses|memancing DHCP REQUEST|profil diperbarui via handshake DHCP" `
  frontend-react/src backend-node/src
rg -n "micro_cut_batch" python-service/src backend-node/src frontend-react/src
rg -n "profile-refresh|profileRefreshStarted|profileRefreshDone" `
  python-service/src backend-node/src frontend-react/src docs
```

Expected:

- obsolete Method 3 claims have no production/UI matches; historical design
  documents may still mention the retired term while explaining that it is
  prohibited;
- `micro_cut_batch` has no production match;
- canonical endpoint and events appear in all three layers and documentation.

- [ ] **Step 4: Run the complete Python suite**

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest discover -s tests -p "test_*.py" -v
```

Expected: all tests pass with zero failures.

- [ ] **Step 5: Run complete Node checks**

```powershell
Set-Location backend-node
npm test
npm run build
```

Expected: all tests and the TypeScript build pass.

- [ ] **Step 6: Run complete frontend checks**

```powershell
Set-Location frontend-react
npm run test:dhcp-profiling
npm run test:refresh-sequencer
npm run test:profile-coverage
npm run build
```

Expected: all assertions and the Vite build pass.

- [ ] **Step 7: Verify the final diff**

```powershell
Set-Location ..
git diff --check
git status --short
```

Expected: no whitespace errors in files changed by this feature. The only
untracked baseline file may remain `frontend-react/src/lib/theme.ts`; do not
stage or modify it unless the build requires the existing local copy.

- [ ] **Step 8: Commit Task 7**

```powershell
git add docs/API_SPEC.md `
        docs/EVENT_TAXONOMY.md `
        docs/specs/SPEC-001_NETWORK_DISCOVERY_PIPELINE.md `
        docs/specs/SPEC-002_DHCP_PASSIVE_PROFILING.md `
        CHANGELOG.md
git commit -m "docs: document passive identity profiling" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 9: Request final review**

Run a focused review against the commit before Task 1 and the final feature
head. Require the reviewer to check:

- no route reaches ARP/NDP spoofing for profiling;
- confidence does not count generic/private labels as identified;
- no historical profile is treated as fresh evidence;
- no duplicate observation or scan is scheduled;
- API and event compatibility are preserved;
- failures cannot be reported as success;
- the benchmark does not misrepresent synthetic fixtures as field accuracy.
