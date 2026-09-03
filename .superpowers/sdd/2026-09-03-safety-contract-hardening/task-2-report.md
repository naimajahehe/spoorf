# Task 2 Report: Truthful Shield and Worker Lifecycle

## Status

Completed and committed as:

`9d154e1 fix(shield): make activation and worker lifecycle truthful`

## Implementation

- Removed the hard-coded gateway MAC fallback from Shield activation.
- Added explicit RFC 1918 gateway and gateway MAC validation.
- Made Shield activation raise `SpoofError` when gateway resolution or kernel
  neighbor locking fails.
- Made kernel neighbor locking inspect both command return codes and report
  success only when at least one command succeeds.
- Moved Shield discovery, neighbor lock/unlock, thread joins, thread starts,
  and status callbacks outside the Shield state lock.
- Added bounded joins for Shield sniffer, heartbeat, and healing workers before
  their shared stop events can be cleared for a replacement activation.
- Added a bounded Gaming watchdog join before its stop event can be reused.
- Prevented Shield and Gaming activation from starting a replacement while a
  prior worker remains alive after the bounded join.
- Kept REST paths and event payloads unchanged.

## Files

- `python-service/src/core/shield.py`
- `python-service/src/core/gaming.py`
- `python-service/tests/test_unit_shield.py`
- `python-service/tests/test_unit_gaming.py`

## RED

Command:

```powershell
D:\spoorf\python-service\venv\Scripts\python.exe -m unittest tests.test_unit_shield tests.test_unit_gaming -v
```

Expected failure summary:

```text
AssertionError: SpoofError not raised
AssertionError: SpoofError not raised
AssertionError: False is not true
AssertionError: True is not false
AssertionError: False is not true
AssertionError: False is not true
Ran 17 tests in 0.047s
FAILED (failures=6)
```

The failures proved the fallback MAC, ignored neighbor-command return codes,
network operations under the Shield lock, and missing Shield/Gaming joins.

## GREEN

Command:

```powershell
D:\spoorf\python-service\venv\Scripts\python.exe -m unittest tests.test_unit_shield tests.test_unit_gaming -v
```

Result:

```text
Ran 17 tests in 0.013s
OK
```

## Full Python Suite

Command:

```powershell
D:\spoorf\python-service\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
```

Result:

```text
176 tests discovered
Process completed with exit code 0
```

The existing Scapy `TripleDES` deprecation warnings and Wireshark manufacturer
database warning were present; there were no test failures.

## Self-Review

- Confirmed all touched Shield tests patch gateway discovery, self-MAC lookup,
  neighbor commands, packet-worker threads, or teardown operations as needed.
- Confirmed all touched Gaming tests replace the watchdog thread, so no ping
  subprocess is started.
- Confirmed stop events are set during joins, joins have finite timeouts, and
  replacement workers start only after prior workers have terminated.
- Confirmed Shield activation mutates enabled state only after validation and a
  successful neighbor lock.
- Confirmed final disable status events are emitted after unlock and worker
  joins, without holding the state lock.
- Confirmed no REST path or public event payload was changed.
- `git diff --check` passed.
- No Task 2 defect was found during final review.

## Fix Round 1

### Reviewer Findings Addressed

- Non-Windows Shield activation now fails closed because the Windows-only
  neighbor lock reports failure without invoking unsupported OS commands.
- Shield `enable`, `disable`, and `set_mode` transitions use a lifecycle mutex
  separate from the state lock; Gaming `toggle` uses the same separation.
- Shield activation failure during worker construction/start signals and
  bounded-joins attempt workers, releases the acquired neighbor lock, clears
  enabled/locked state, and re-raises the original exception.
- Gaming worker-start failure signals and bounded-joins the attempted worker,
  restores disabled state, clears activation time, and re-raises.
- `test_set_mode` now patches `get_current_gateway`, so it cannot reach live
  gateway resolution.
- Focused tests cover unsupported-platform activation, deterministic concurrent
  transition gating, and worker-start rollback without live OS/network actions.

### RED

Command:

```powershell
D:\spoorf\python-service\venv\Scripts\python.exe -m unittest tests.test_unit_shield tests.test_unit_gaming -v
```

Result before implementation:

```text
Ran 22 tests in 0.040s
FAILED (failures=5)
```

The five expected failures covered unsupported-platform activation, overlapping
Shield and Gaming transitions, and missing Shield and Gaming start rollback.

### GREEN

Focused command:

```powershell
D:\spoorf\python-service\venv\Scripts\python.exe -m unittest tests.test_unit_shield tests.test_unit_gaming -v
```

Result:

```text
Ran 22 tests in 0.154s
OK
```

Full Python command (run once for Fix Round 1):

```powershell
D:\spoorf\python-service\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
```

Result:

```text
Ran 181 tests in 21.426s
OK
```

Existing Scapy `TripleDES` deprecation warnings and the Wireshark manufacturer
database warning remained; there were no test failures.

## Fix Round 2

### Finding Addressed

- Extended the Shield and Gaming fake workers so `join(timeout=...)` can return
  while `is_alive()` remains true.
- Added regression tests that disable each service with a non-terminating prior
  worker and then attempt to enable it again.
- Both tests verify the two joins remain bounded at 2 seconds, all relevant stop
  events remain set, the stale worker reference is retained, no replacement
  thread is constructed, and the enable raises the explicit operational error.
- Shield gateway discovery, MAC resolution, neighbor locking/unlocking, thread
  construction, and Gaming subprocess execution are mocked in these tests.
- The production fail-closed guards from the prior Task 2 rounds already
  satisfied the newly exercised behavior, so no production-code change was
  necessary.

### RED

Because the required production guards were already present, RED was verified
with a temporary mutation that bypassed each post-join `is_alive()` guard. The
mutation was reverted immediately after the run and is not part of the commit.

Command:

```powershell
D:\spoorf\python-service\venv\Scripts\python.exe -m unittest tests.test_unit_shield tests.test_unit_gaming -v
```

Result with the temporary mutation:

```text
FAIL: test_enable_fails_closed_when_prior_worker_survives_bounded_join
      (tests.test_unit_shield.TestSentinelShield)
AssertionError: SpoofError not raised

FAIL: test_enable_fails_closed_when_prior_worker_survives_bounded_join
      (tests.test_unit_gaming.TestGamingEngine)
AssertionError: RuntimeError not raised

Ran 24 tests in 0.132s
FAILED (failures=2)
```

### GREEN

After restoring the existing fail-closed guards:

```powershell
D:\spoorf\python-service\venv\Scripts\python.exe -m unittest tests.test_unit_shield tests.test_unit_gaming -v
```

Result:

```text
Ran 24 tests in 0.146s
OK
```

### Full Python Suite

Run once:

```powershell
D:\spoorf\python-service\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
```

Result:

```text
183 tests discovered
Process completed with exit code 0
```

The existing Scapy `TripleDES` deprecation warnings and Wireshark manufacturer
database warning remained; there were no test failures.
