# Task 4 Report: Persist Profile Confidence and Evidence Atomically

## Status

Complete. The Node contract, SQLite migration, atomic persistence path, scan
upsert, restart mapping, validation, and regression coverage are implemented.

## RED evidence

Command:

```powershell
Set-Location "C:\Users\LENOVO\.copilot\session-state\18f4a485-a6ee-45dc-8b78-0fb591d03e1e\files\spoorf-dhcp-refresh\backend-node"; npm test
```

Expected failure:

```text
AssertionError [ERR_ASSERTION]: Migration must add profile_status
...
TEST RESULTS: 30 PASSED | 1 FAILED
```

The new migration test failed because the profile columns did not yet exist.

## GREEN evidence

Command:

```powershell
Set-Location "C:\Users\LENOVO\.copilot\session-state\18f4a485-a6ee-45dc-8b78-0fb591d03e1e\files\spoorf-dhcp-refresh\backend-node"; npm test; if ($LASTEXITCODE -eq 0) { npm run build }; exit $LASTEXITCODE
```

Output:

```text
TEST RESULTS: 34 PASSED | 0 FAILED
ALL NODE.JS TESTS PASSED SUCCESSFULLY!

> netcut-backend@1.0.0 build
> tsc
```

Exit code: `0`.

Repository-wide Python verification used the existing main-checkout virtual
environment because this worktree has no local `python-service\venv`:

```powershell
Set-Location "C:\Users\LENOVO\.copilot\session-state\18f4a485-a6ee-45dc-8b78-0fb591d03e1e\files\spoorf-dhcp-refresh\python-service"; & "D:\spoorf\python-service\venv\Scripts\python.exe" -m unittest discover -s tests -p "test_*.py" -q
```

Output:

```text
Ran 291 tests in 11.390s
OK
development: precision=1.000 coverage=0.857 unknown=0.143 (3/21)
holdout: precision=1.000 coverage=0.889 unknown=0.111 (2/18)
```

## Files

- `backend-node/src/types/index.ts`
  - Added `ProfileStatus`, `ProfileEvidence`, `ProfileAssessment`,
    `ProfileRefreshResponse`, and `ProfileRefreshResult`.
  - Added optional profile fields to `Device`.
- `backend-node/src/services/database.ts`
  - Added the seven profile columns to the canonical schema.
  - Added additive, idempotent `PRAGMA table_info(devices)` migrations.
  - Added strict MAC/status/confidence/version/evidence validation and the
    32 KiB UTF-8 evidence bound.
  - Added transactional `updateDeviceProfileAssessment()`.
  - Added profile columns to SELECT, scan upsert, and row mapping paths.
  - Preserved last-known labels on generic/unknown refreshes while replacing
    freshness status, confidence, evidence, timestamp, and version.
- `backend-node/tests/unit_database.test.ts`
  - Added migration, persistence, state-preservation, validation, size-bound,
    rollback, restart, scan-reconciliation, and high-to-unknown coverage.

## Self-review

- Confirmed each `ALTER TABLE` is preceded by `PRAGMA table_info(devices)`;
  schema detection no longer relies on broad exception handling.
- Confirmed the profile update changes only IP/identity/profile freshness
  fields and leaves alias, block, redirect, speed-limit, profile-link,
  matching, session, and unrelated state untouched.
- Confirmed profile evidence is validated and serialized before entering the
  transaction, and a forced second-statement failure rolls back IP
  reconciliation.
- Confirmed ordinary scans preserve prior profile data when no assessment is
  supplied and persist a complete assessment when supplied.
- Confirmed `frontend-react/src/lib/theme.ts` was neither touched nor staged.
- `git diff --check` exited `0` with no output.

## Concerns

- The worktree has a pre-existing untracked
  `frontend-react/src/lib/theme.ts`; it remains untouched and uncommitted.
- No product-code concerns remain. No network operations were performed.
