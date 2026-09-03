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

## Residual Bypasses: RED to GREEN

### RED

Added Test 15 in `backend-node/tests/unit_gamingMode.test.ts`, then ran:

```powershell
cd backend-node
npm test
```

The unpatched implementation failed as expected:

```text
Gaming Mode Test Failed: AssertionError [ERR_ASSERTION]:
Missing expected rejection: a connected profile peer must remain protected by
the disconnected managed device snapshot
```

This reproduced the bypass: once the managed device was removed from
`this.devices`, deleting its profile peer reached SQLite and deleted the peer.

### GREEN

The restore-plan device snapshot now retains `profile_id`. Pending recovery
guards compare exact managed MAC, snapshotted IP, and snapshotted profile ID
without a database lookup. `deleteDevice()` rejects absent in-memory targets
before SQLite, rechecks resolved targets before teardown, and `clearAllDevices()`
is serialized and rejected while recovery is pending. `stopTransparentGateway()`
checks the snapshotted IP even after the device disappears.

Test 15 verifies all of the following:

- a disconnected managed device still protects an in-memory profile peer;
- an absent/DB-only deletion target produces zero SQLite calls;
- transparent-gateway stop by the snapshotted IP produces zero Python calls;
- clear-all produces zero SQLite calls, events, and device loss;
- unrelated in-memory speed mutation and deletion remain permitted.

GREEN command:

```powershell
cd backend-node
npm test
```

Result:

```text
✓ Recovery identity snapshots block disconnected targets without blocking unrelated devices
TEST RESULTS: 34 PASSED | 0 FAILED
```
