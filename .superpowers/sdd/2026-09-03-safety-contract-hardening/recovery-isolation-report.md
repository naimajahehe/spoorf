# Gaming Disable Recovery Isolation: RED to GREEN

## Contract

When `toggleGamingMode(false)` has a retained recovery plan after a persistence
failure, a conflicting network-state mutation for a managed device must fail
closed. It must perform no Python or SQLite operation, mutate no local device
state, and emit no state event. The same operation is allowed after a successful
disable retry clears the plan.

## RED

Command:

```powershell
cd backend-node
npm test
```

Result: failed as expected before the recovery-isolation guard existed.

```text
Gaming Mode Test Failed: AssertionError [ERR_ASSERTION]:
The input did not match the regular expression
/Gaming disable recovery is pending for a managed device.../

Input:
'Error: controlled persistence failure'

at DeviceManager._blockDeviceImpl (.../backend-node/src/services/deviceManager.ts:879:23)
```

The controlled SQLite failure left `pendingGamingDisable` active. A subsequent
`blockDevice` reached `setDeviceBlocked`, proving that `runExclusive` alone did
not prevent the immutable recovery plan from being overwritten.

## GREEN

Added Test 14 in `backend-node/tests/unit_gamingMode.test.ts`. It creates a
pending disable through a controlled `setDeviceBlocked` failure, then verifies:

- `blockDevice`, `unblockDevice`, `setSpeedLimit`, redirect start/stop, and
  transparent-gateway start/stop reject before Python or SQLite calls.
- Deleting a profile peer rejects when that profile includes the managed device.
- Neither managed nor profile-peer state changes, and no state event is emitted.
- Retrying `toggleGamingMode(false)` completes recovery and clears the pending
  plan; the previously rejected speed-limit mutation then succeeds.

Command:

```powershell
cd backend-node
npm test
```

Result:

```text
✓ Recovery isolation: pending Gaming disable blocks mutations until retry completes
TEST RESULTS: 34 PASSED | 0 FAILED
```

## Implementation

`DeviceManager._assertNoPendingGamingRecoveryConflict()` is the single guard
for pending-plan MAC identity. Each covered mutation resolves its in-memory
target first and invokes the guard before any Python/SQLite call, local mutation,
or event emission. Profile deletion expands its in-memory target set by
`profile_id` before its database lookup, so it is also fail-closed.
