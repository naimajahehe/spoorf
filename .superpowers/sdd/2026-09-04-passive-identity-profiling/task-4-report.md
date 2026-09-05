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

## Fix Round 1

### Review findings addressed

1. Scan reconciliation now normalizes each incoming MAC once before using it
   for lookup keys, SQLite inserts/conflicts, returned scan targets, and
   profile-linked MACs. Uppercase and lowercase sightings therefore reconcile
   to one canonical lowercase row without splitting alias, control, session,
   profile-link, or assessment state.
2. Reconciliation now uses an internal device lookup that includes archived
   rows. Public `getAllDevices()` semantics remain unchanged. When an archived
   high-confidence device returns with an Unknown assessment, it is unarchived,
   retains its last-known vendor/type/hostname/OS labels, and receives the
   current Unknown status, zero confidence, evidence, timestamp, and version.

### RED evidence

Focused in-memory database regressions failed before the implementation:

```text
AssertionError: Case-variant scans must reconcile into one SQLite row
2 !== 1
```

```text
AssertionError: Unknown refresh must preserve archived last-known vendor
actual: 'Generic Device'
expected: 'Samsung'
```

### GREEN evidence

Focused database tests:

```powershell
Set-Location backend-node
.\node_modules\.bin\ts-node.cmd -e "import { runDatabaseTests } from './tests/unit_database.test'; runDatabaseTests().catch(error => { console.error(error); process.exit(1); });"
```

Result: exit `0`, including both new reconciliation regressions.

Full Node verification:

```powershell
npm test
npm run build
```

Result:

```text
TEST RESULTS: 34 PASSED | 0 FAILED
ALL NODE.JS TESTS PASSED SUCCESSFULLY!
tsc
```

Relevant repository-wide Python regression:

```powershell
& "D:\spoorf\python-service\venv\Scripts\python.exe" -m unittest discover -s tests -p "test_*.py" -q
```

Result:

```text
Ran 291 tests in 11.885s
OK
development: precision=1.000 coverage=0.857 unknown=0.143 (3/21)
holdout: precision=1.000 coverage=0.889 unknown=0.111 (2/18)
```

### Files

- `backend-node/src/services/database.ts`
  - Added a private archived-inclusive reconciliation read path.
  - Canonicalized incoming scan MACs before all reconciliation operations.
  - Reused the canonical MAC during embedded assessment validation.
- `backend-node/tests/unit_database.test.ts`
  - Added in-memory case-variant reconciliation coverage.
  - Added archived high-to-Unknown refresh coverage.

### Preserved constraints

- Public archived-device filtering remains unchanged.
- Profile persistence remains transactional.
- PRAGMA-based additive migration and the 32 KiB evidence bound remain intact.
- Alias, block, redirect, speed-limit, profile-link, session, and last-known
  identity semantics remain intact.
- `frontend-react/src/lib/theme.ts` was not touched or staged.
- No network operations were performed.

### Concerns

- The worktree still contains the pre-existing untracked
  `frontend-react/src/lib/theme.ts`; it remains excluded from this change.
- No product-code concerns remain.

## Fix Round 3

### Review finding addressed

- Legacy MAC repair now maps `NULL`, `undefined`, blank, non-finite, and
  out-of-range stored speed limits to the established unrestricted value
  `100`, while preserving valid numeric limits from `0` through `100`.
- Duplicate-case repair continues to choose the most restrictive valid limit,
  so a valid active throttle is no longer overwritten by `Number(null) === 0`.

### RED evidence

Focused database command:

```powershell
Set-Location backend-node
.\node_modules\.bin\ts-node.cmd -e "import { runDatabaseTests } from './tests/unit_database.test'; runDatabaseTests().catch(error => { console.error(error); process.exit(1); });"
```

Before the implementation, the uppercase legacy row seeded with
`speed_limit=NULL` failed during initialization:

```text
AssertionError [ERR_ASSERTION]: Legacy NULL speed limit must map to unrestricted
0 !== 100
```

### GREEN evidence

The same focused database command exited `0`, including:

```text
✓ Legacy MAC repair: uppercase primary keys canonicalize before lowercase scan upserts
✓ Duplicate MAC repair: NULL speed preserves the active valid control limit
```

Full Node verification:

```powershell
Set-Location backend-node
npm test
npm run build
```

Result:

```text
TEST RESULTS: 34 PASSED | 0 FAILED | 0.49s
ALL NODE.JS TESTS PASSED SUCCESSFULLY!
> netcut-backend@1.0.0 build
> tsc
```

Relevant Python regression:

```powershell
Set-Location python-service
& "D:\spoorf\python-service\venv\Scripts\python.exe" -m unittest discover -s tests -p "test_*.py" -q
```

Result:

```text
Ran 291 tests in 10.498s
OK
development: precision=1.000 coverage=0.857 unknown=0.143 (3/21)
holdout: precision=1.000 coverage=0.889 unknown=0.111 (2/18)
```

### Regression coverage

- A raw uppercase legacy row with `speed_limit=NULL` is canonicalized to one
  lowercase row with `speed_limit=100`; identity, profile, control, redirect,
  archive, observation, assessment, and linked-MAC state remain covered.
- A case-duplicate pair with one `NULL` limit and one active `35` percent
  throttle merges to one lowercase row retaining the active session and limit.

### Self-review

- Normalization occurs before the existing minimum-limit merge, preserving
  valid `0` cut-off, `1..99` throttle, and `100` unrestricted semantics.
- The implementation explicitly guards nullish and non-finite inputs rather
  than relying on JavaScript numeric coercion.
- Existing MAC repair ordering, identity selection, safety flags, session
  selection, transactions, and linked-MAC repair were not changed.
- `git diff --check` exited `0` with no output.
- `frontend-react/src/lib/theme.ts` was neither touched nor staged.
- No network operations were performed.

### Concerns

- The worktree still contains the pre-existing untracked
  `frontend-react/src/lib/theme.ts`; it remains excluded from this change.
- No product-code concerns remain.

## Fix Round 2

### Review finding addressed

- Database initialization now runs an idempotent, transactional legacy-MAC
  repair before scan reconciliation. Existing primary-key MACs are normalized
  to lowercase, so a later lowercase scan cannot create a case-distinct row.
- If uppercase and lowercase rows already coexist, the repair deterministically
  retains the newest observation, earliest `first_seen`, newest coherent
  assessment, non-empty identity/profile fields, active block/session/redirect
  intent, the most restrictive speed limit, and a non-archived state when
  either duplicate is active.
- `device_profiles.linked_macs` values are normalized and case-deduplicated,
  while malformed JSON is left untouched rather than destructively rewritten.

### RED evidence

Focused database command:

```powershell
Set-Location backend-node
.\node_modules\.bin\ts-node.cmd -e "import { runDatabaseTests } from './tests/unit_database.test'; runDatabaseTests().catch(error => { console.error(error); process.exit(1); });"
```

Before the implementation, the direct pre-initialization SQLite seed failed:

```text
AssertionError [ERR_ASSERTION]: Legacy uppercase primary key must be canonicalized during initialization
actual: '00:07:AB:11:22:80'
expected: '00:07:ab:11:22:80'
```

Strengthening the duplicate seed with newer generic labels also failed before
generic labels were treated as empty identity evidence:

```text
AssertionError [ERR_ASSERTION]: Non-empty identity must survive
actual: 'Unknown'
expected: 'Galaxy-Duplicate'
```

### GREEN evidence

The same focused database command exited `0` and included:

```text
✓ Legacy MAC repair: uppercase primary keys canonicalize before lowercase scan upserts
✓ Duplicate MAC repair: case variants merge idempotently with intent and newest observations preserved
```

Full Node verification:

```powershell
Set-Location backend-node
npm test
npm run build
```

Result:

```text
TEST RESULTS: 34 PASSED | 0 FAILED
ALL NODE.JS TESTS PASSED SUCCESSFULLY!
tsc
```

Relevant Python regression:

```powershell
Set-Location python-service
& "D:\spoorf\python-service\venv\Scripts\python.exe" -m unittest discover -s tests -p "test_*.py" -q
```

Result:

```text
Ran 291 tests in 10.903s
OK
development: precision=1.000 coverage=0.857 unknown=0.143 (3/21)
holdout: precision=1.000 coverage=0.889 unknown=0.111 (2/18)
```

### Regression coverage

- Seeds a true uppercase legacy primary key directly through
  `better-sqlite3` before `DatabaseService.init()`, verifies every requested
  state field survives canonicalization, then scans the lowercase equivalent
  and proves exactly one row remains.
- Seeds true uppercase/lowercase duplicates directly before initialization and
  verifies deterministic merging of identity, profile, control, redirect,
  archive, IP history, assessment, and linked-MAC state.
- Re-runs initialization to prove the repair is idempotent, then scans again to
  prove reconciliation remains single-row.

### Self-review

- The repair is a native SQLite transaction and executes after additive schema
  migration but before `initialized` is set or scan upserts can run.
- `getAllDevices()` and its archived-row filter were not changed.
- Task 4 assessment validation, evidence bounds, and profile-update transaction
  were not changed.
- Single-row canonicalization preserves all stored columns exactly except the
  canonical lowercase primary key and linked-MAC casing.
- Duplicate merge policy keeps safety flags (`is_gateway`, `is_self`) if either
  row has them and does not overwrite malformed linked-MAC JSON.
- `frontend-react/src/lib/theme.ts` was neither touched nor staged.
- No network operations were performed.

### Concerns

- The worktree still contains the pre-existing untracked
  `frontend-react/src/lib/theme.ts`; it remains excluded from this change.
- No product-code concerns remain.
