# Task 5 Report: Orchestrate One Safe Profile Refresh in Node

## Status

Complete. Node now calls only the canonical passive profile-refresh endpoint,
orchestrates full and automatic subset refreshes safely, persists and merges
assessments by normalized MAC, exposes the canonical route/events, and retains
deprecated aliases without invoking the old disruptive Python route.

## RED evidence

Command:

```powershell
Set-Location "C:\Users\LENOVO\.copilot\session-state\18f4a485-a6ee-45dc-8b78-0fb591d03e1e\files\spoorf-dhcp-refresh\backend-node"; npm test
```

Output:

```text
TSError: Unable to compile TypeScript:
tests/unit_deviceManager.test.ts(1434,31): error TS2339: Property 'profileRefresh' does not exist on type 'DeviceManager'.
...
tests/unit_deviceManager.test.ts(1523,32): error TS2339: Property 'runProfileRefresh' does not exist on type 'DeviceManager'.
...
Process exited with code 1
```

The new contract tests failed for the intended reason: the canonical bridge
and DeviceManager orchestration methods did not exist.

## GREEN evidence

Full Node tests and build:

```powershell
$root="C:\Users\LENOVO\.copilot\session-state\18f4a485-a6ee-45dc-8b78-0fb591d03e1e\files\spoorf-dhcp-refresh"; $backend=Join-Path $root "backend-node"; $stdout=Join-Path $root ".superpowers\sdd\2026-09-04-passive-identity-profiling\node-test-stdout.log"; $stderr=Join-Path $root ".superpowers\sdd\2026-09-04-passive-identity-profiling\node-test-stderr.log"; $npm=(Get-Command npm.cmd).Source; $test=Start-Process -FilePath $npm -ArgumentList @("test") -WorkingDirectory $backend -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Wait -PassThru; Write-Output ("TEST_EXIT=" + $test.ExitCode); Get-Content $stdout -Tail 7; if (Test-Path $stderr) { Get-Content $stderr -Tail 5 }; if ($test.ExitCode -ne 0) { exit $test.ExitCode }; Set-Location $backend; npm run build; if (-not $?) { exit 1 }
```

Output:

```text
TEST_EXIT=0
=====================================================
TEST RESULTS: 34 PASSED | 0 FAILED | 0.55s
=====================================================
ALL NODE.JS TESTS PASSED SUCCESSFULLY!

> netcut-backend@1.0.0 build
> tsc
```

Full Python regression suite:

The worktree has no local `python-service\venv`, so the first prescribed
command failed before running tests:

```powershell
Set-Location "C:\Users\LENOVO\.copilot\session-state\18f4a485-a6ee-45dc-8b78-0fb591d03e1e\files\spoorf-dhcp-refresh\python-service"; .\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
```

Output:

```text
.\venv\Scripts\python.exe : The term '.\venv\Scripts\python.exe' is not recognized
Process exited with code 1
```

The suite was then run with the available Python 3.11 interpreter while
keeping the worktree as the working directory:

```powershell
$root="C:\Users\LENOVO\.copilot\session-state\18f4a485-a6ee-45dc-8b78-0fb591d03e1e\files\spoorf-dhcp-refresh"; $stdout=Join-Path $root ".superpowers\sdd\2026-09-04-passive-identity-profiling\python-test-stdout.log"; $stderr=Join-Path $root ".superpowers\sdd\2026-09-04-passive-identity-profiling\python-test-stderr.log"; $python=(Get-Command python).Source; $process=Start-Process -FilePath $python -ArgumentList @("-m","unittest","discover","-s","tests","-p","test_*.py") -WorkingDirectory (Join-Path $root "python-service") -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Wait -PassThru; Write-Output ("EXIT=" + $process.ExitCode); Get-Content $stderr -Tail 8; Get-Content $stdout -Tail 8; exit $process.ExitCode
```

Output:

```text
EXIT=0
----------------------------------------------------------------------
Ran 291 tests in 9.760s

OK
development: precision=1.000 coverage=0.857 unknown=0.143 (3/21)
holdout: precision=1.000 coverage=0.889 unknown=0.111 (2/18)
```

## Implementation

- `PythonBridge.profileRefresh()` uses `fetchWithTimeout()`,
  `readMutationResponse()`, the canonical endpoint, and typed response data.
- Legacy `PythonBridge.quickReauth()` converts legacy target fields and
  delegates to the canonical method with a five-second observation window.
- `DeviceManager` filters and deduplicates the current online snapshot,
  preserves live state while merging by MAC, persists each unique assessment
  once, and does not run a follow-up scan.
- Full/subset single-flight behavior, 20-second manual cooldown, 60-second
  per-MAC automatic cooldown, network-generation invalidation, pending-MAC
  batching, and current-device re-read are implemented.
- Scan reconciliation and meaningful DHCP identity changes schedule targeted
  enrichment without recursive scheduling from assessment merges.
- Canonical and deprecated REST routes and Socket.IO event names are exposed.
  Legacy events include `operation: "profile_refresh"` and `deprecated: true`.

## Files

- `backend-node/src/services/pythonBridge.ts`
- `backend-node/src/services/deviceManager.ts`
- `backend-node/src/api/routes.ts`
- `backend-node/src/websocket/index.ts`
- `backend-node/tests/unit_pythonBridge.test.ts`
- `backend-node/tests/unit_deviceManager.test.ts`
- `backend-node/tests/api_routes.test.ts`
- `.superpowers/sdd/2026-09-04-passive-identity-profiling/task-5-report.md`

## Self-review

- Confirmed Node bridge source contains no call to the old Python
  `/api/network/quick-reauth` route.
- Confirmed gateway, controller, offline, malformed-MAC, and non-RFC1918
  devices are excluded before the Python request.
- Confirmed already-profiled eligible devices remain included.
- Confirmed full refreshes absorb automatic events, while manual calls wait
  for subset refreshes and bypass stale manual cooldown results afterward.
- Confirmed generic/Unknown labels use the same preservation rules as the DB,
  while current confidence/status/evidence/timestamp/version are replaced.
- Confirmed partial failures are returned intact and total Python failures
  reject.
- Confirmed token/error helpers and unrelated control-plane logic remain
  unchanged.
- Confirmed `git diff --check` exits `0`.
- Confirmed `frontend-react/src/lib/theme.ts` was not touched or staged.

## Concerns

- The supplied worktree does not contain `python-service\venv`; verification
  used the installed Python 3.11 interpreter successfully.
- The pre-existing untracked `frontend-react/src/lib/theme.ts` remains
  untouched and uncommitted.
- No network packets were sent; all new profile-refresh tests use mocks.

## Fix Round 1

### Review findings addressed

- Node now filters every outbound profile-refresh IPv6 list at both the
  manager snapshot and bridge boundary. Only syntactically valid `fe80::/10`
  link-local and `fc00::/7` ULA addresses are retained; whitespace and address
  case are normalized, while a valid scope ID is preserved for Python.
  Invalid/global entries are dropped individually so one bad address cannot
  reject the whole target batch.
- Profile assessments are now persisted and merged only after re-reading a
  current, online, non-gateway, non-controller device by normalized MAC and
  confirming that the in-memory IP key is still owned by that MAC. A same-MAC
  move is persisted with its current IP. Database profile updates no longer
  change `ip`, `last_ip`, `is_online`, or another MAC's IP ownership.
- Network generation is rechecked after every asynchronous profile persistence
  and immediately before cooldown/cache mutation, completion events, and the
  success return. A generation change during persistence rejects without
  setting `lastProfileRefresh`, per-MAC cooldowns, or emitting completion.
- The current legacy modal flow still accepts `onTriggerReScan` for Task 6
  compatibility, but no longer calls it after the safe refresh callback.
  Its source-level regression asserts one callback invocation and no post-result
  `onTriggerReScan()` call.
- The TypeScript response contract now matches Python:
  `partial_failures: Array<{ sensor: string; error: string; target?: string }>`.

### RED evidence

Node contract test before implementation:

```text
tests/unit_deviceManager.test.ts(1387,21): error TS2353:
Object literal may only specify known properties, and 'sensor' does not exist
in type '{ source: string; error: string; }'.
Process exited with code 1
```

Frontend source-level regression before implementation:

```text
AssertionError [ERR_ASSERTION]:
manual profile refresh must not schedule a second scan
true !== false
Process exited with code 1
```

### Verification evidence

Node full suite and build:

```powershell
Set-Location backend-node
npm test
npm run build
```

```text
TEST RESULTS: 34 PASSED | 0 FAILED | 0.65s
ALL NODE.JS TESTS PASSED SUCCESSFULLY!
> tsc
Exit code 0
```

Relevant frontend regression and production build:

```powershell
Set-Location frontend-react
npm run test:dhcp-profiling
npm run build
```

```text
DHCP profiling metric assertions passed
2724 modules transformed
built in 15.23s
Exit code 0
```

Python full regression suite:

```powershell
Set-Location python-service
python -m unittest discover -s tests -p "test_*.py"
```

```text
Ran 291 tests in 11.547s
OK
Exit code 0
```

### Added regression coverage

- Bridge filtering and normalization for scoped link-local, ULA, global, and
  malformed IPv6 values, including the deprecated bridge adapter.
- Manager-side IPv6 filtering without batch poisoning.
- Device release/IP reassignment during observation skips stale persistence and
  cannot overwrite the replacement occupant.
- Same-MAC IP churn persists and merges against the current address.
- A gated database write followed by `networkChanged` rejects and leaves
  profile cache, cooldowns, stale memory merges, and done events unset.
- Database assessment persistence cannot reassign or clear another MAC's IP.
- Frontend manual refresh invokes its callback once and performs no follow-up
  scan.

### Self-review

- Full/subset single-flight and waiting behavior were not changed.
- Manual and per-MAC cooldown durations remain 20 seconds and 60 seconds.
- REST paths, Socket.IO event names/payload compatibility, and token guards
  were not modified.
- Unknown/generic label merge preservation remains unchanged.
- Gateway/controller/offline/RFC1918 target exclusions remain in force.
- `git diff --check` exits `0`.
- No network operations were added; all new refresh regressions are mocked or
  use in-memory SQLite.
- `frontend-react/src/lib/theme.ts` was not modified or staged.

### Concerns

- The frontend production build still reports the pre-existing Vite warning
  that the main minified chunk exceeds 500 kB; the build succeeds.
- The supplied worktree still has no local `python-service\venv`; verification
  used the available Python interpreter.
- The pre-existing untracked `frontend-react/src/lib/theme.ts` remains
  untouched and must remain outside this commit.
