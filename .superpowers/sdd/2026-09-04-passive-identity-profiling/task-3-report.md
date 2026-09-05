# Task 3 Report: Safe IPv4 and IPv6 Profile Observation

## Status

Complete. Commit message: `feat(profile): replace micro-cut with safe observation`.
The final commit hash is reported by the coordinating agent after this report is
included in the commit.

## Implementation

- Added `collect_profile_refresh()` with strict active topology validation,
  normalized MAC-based deduplication, a 300-target cap, an eight-worker pool, and
  a bounded 3–10 second observation window.
- Enforced controller and gateway immunity by both IP and MAC before opening
  multicast or per-target sockets.
- Enforced active RFC 1918 CIDR membership for every IPv4 target.
- Accepted only link-local/ULA IPv6 addresses already paired with the target MAC
  in the current NDP snapshot.
- Added five-minute freshness filtering for DHCP/DHCPv6 identity evidence.
- Added one dual-stack SSDP/mDNS/LLMNR identity burst. Each protocol is sent at
  most once per address family, and responses are received on the sending socket.
- Kept returned multicast maps current-call-only while retaining optional mDNS
  compatibility cache updates.
- Added bounded per-target NetBIOS, reverse-DNS, and known-address IPv6 liveness
  collection, followed by one `assess_device_profile()` call per normalized MAC.
- Added summary counts, source counts, passive AP-isolation context, factual
  partial failures, duration, and per-device results.
- Added `POST /api/network/profile-refresh`.
- Converted `POST /api/network/quick-reauth` to a deprecated safe alias that
  ignores legacy gateway fields and delegates to the passive collector.
- Removed `ARPSpoofer.micro_cut_batch()` and its obsolete unit tests without
  changing block, throttle, redirect, restore, or forwarding behavior.
- Preserved existing Method 1 `send_multicast_wakeup()`,
  `collect_ssdp_sensors()`, and `collect_mdns_sensors()` behavior.

## TDD Evidence

### RED 1: collector and multicast APIs absent

Command:

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest `
  tests.test_unit_profile_observation `
  tests.test_unit_discovery -v
```

Observed result:

```text
ModuleNotFoundError: No module named 'src.core.discovery.profile_observation'
ImportError: cannot import name 'collect_identity_multicast'
Ran 2 tests in 0.000s
FAILED (errors=2)
```

The failure was expected because neither new collector API existed.

### RED 2: canonical API absent

Command:

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest `
  tests.test_api_server -v
```

Observed result:

```text
ImportError: cannot import name 'profile_refresh' from 'src.server'
Ran 1 test in 0.000s
FAILED (errors=1)
```

The failure was expected because the canonical endpoint and request models had
not been implemented.

### RED 3: static OUI evidence incorrectly counted as live visibility

Command:

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest `
  tests.test_unit_profile_observation.TestProfileObservation.test_profile_refresh_does_not_count_static_oui_as_visibility -v
```

Observed result:

```text
AssertionError: 1 != 0
Ran 1 test in 0.124s
FAILED (failures=1)
```

Root cause: `visible` was calculated after adding static classifier evidence
such as OUI. The fix snapshots live observation sources first; OUI may remain in
the explanatory source summary but cannot make a device visible.

### GREEN: collector and multicast

Command:

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest `
  tests.test_unit_profile_observation `
  tests.test_unit_discovery -q
```

Observed result:

```text
Ran 43 tests in 1.544s
OK
```

### GREEN: focused profile, discovery, API, and spoofer regression

Command:

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest `
  tests.test_unit_profile_observation `
  tests.test_unit_discovery `
  tests.test_api_server `
  tests.test_unit_spoofer -q
```

Observed result:

```text
Ran 97 tests in 4.547s
OK
```

This includes the isolated visibility regression after its RED run.

## Full Verification

### Python

Command:

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest discover `
  -s tests -p 'test_*.py' -v
```

Observed result:

```text
Ran 271 tests in 9.070s
OK
development: precision=1.000 coverage=0.857 unknown=0.143 (3/21)
holdout: precision=1.000 coverage=0.889 unknown=0.111 (2/18)
```

### Node regression

Command:

```powershell
Set-Location backend-node
npm test
```

Observed result:

```text
TEST RESULTS: 34 PASSED | 0 FAILED | 0.38s
ALL NODE.JS TESTS PASSED SUCCESSFULLY!
```

### Syntax and diff checks

Commands:

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m py_compile `
  src\core\discovery\profile_observation.py `
  src\core\discovery\multicast.py `
  src\server.py `
  src\core\spoofer.py

Set-Location ..
git diff --check
```

Observed result:

```text
Exit code 0; no output.
```

## Source Safety Assertions

Command:

```powershell
$forbidden = Select-String `
  -Path 'python-service\src\core\discovery\profile_observation.py' `
  -Pattern 'scan_ports|sweep_subnet_for_arp|ARPSpoofer|NDPSpoofer|sendp|ICMPv6ND_RA|set_ip_forwarding'

$production = Get-ChildItem `
  'python-service\src','backend-node\src','frontend-react\src' `
  -Recurse -File
$micro = $production | Select-String -Pattern 'micro_cut_batch'

& 'D:\spoorf\python-service\venv\Scripts\python.exe' -c `
  "import ast,pathlib; p=pathlib.Path('python-service/src/server.py'); s=p.read_text(encoding='utf-8'); t=ast.parse(s); n=next(x for x in t.body if isinstance(x,(ast.FunctionDef,ast.AsyncFunctionDef)) and x.name=='quick_reauth_profiling'); body=ast.get_source_segment(s,n); bad=[x for x in ('micro_cut_batch','spoofer.start','send_multicast_wakeup') if x in body]; assert not bad,bad; print('PASS: quick_reauth_profiling delegates without spoofing or wakeup calls')"
```

Observed result:

```text
PASS: profile_observation.py contains no forbidden active/spoofing calls
PASS: no production micro_cut_batch references
PASS: quick_reauth_profiling delegates without spoofing or wakeup calls
```

All new network-facing tests use fake sockets, packet byte fixtures, or mocked
helpers. No live network test was performed.

## Files

- Added `python-service/src/core/discovery/profile_observation.py`
- Added `python-service/tests/test_unit_profile_observation.py`
- Modified `python-service/src/core/discovery/multicast.py`
- Modified `python-service/src/core/discovery/__init__.py`
- Modified `python-service/src/server.py`
- Modified `python-service/tests/test_api_server.py`
- Modified `python-service/src/core/spoofer.py`
- Modified `python-service/tests/test_unit_spoofer.py`
- Modified `python-service/tests/test_unit_discovery.py`
- Added this report.

`frontend-react/src/lib/theme.ts` was not touched or staged.

## Self-Review

- Re-read the Task 3 safety rules against the implementation and tests.
- Verified target validation precedes identity multicast and per-target socket
  operations.
- Verified IPv4 subnet membership and controller/gateway IP/MAC exclusions.
- Verified IPv6 request text alone is insufficient; the current NDP MAC/address
  pair is mandatory.
- Verified multicast sends are bounded to six attempted datagrams and receive on
  the same two family sockets.
- Verified profile collection contains no port scan, subnet sweep, spoofing,
  packet injection, RA construction, or forwarding mutation.
- Verified the deprecated handler does not call the spoofer or Method 1 wakeup.
- Verified static OUI evidence cannot inflate `visible_count`.
- Verified existing spoof lifecycle tests still cover block/throttle/redirect
  behavior after removal of only the obsolete micro-cut method.
- Verified only Task 3 files are selected for commit; the unrelated theme file
  remains untracked and unstaged.

## Concerns

- Test startup still emits pre-existing Wireshark manufacturer-database and
  Scapy/Cryptography TripleDES deprecation warnings; they do not affect results.
- IPv6 multicast delivery can legitimately be reported as a partial failure on
  hosts without a usable IPv6 multicast route. IPv4 evidence remains usable, and
  zero successful identity requests correctly produces HTTP 503.
