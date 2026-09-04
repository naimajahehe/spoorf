# Public Wi-Fi Safe Mode Design

## Status

Approved in-chat design awaiting written-spec review.

## Goal

Protect the operator's own Windows device on untrusted Wi-Fi while preventing
Spoorf from scanning, controlling, intercepting, or persisting information about
other clients unless the active network has been explicitly trusted.

Safe Mode is a cross-layer policy boundary. It is enforced by Python and Node,
not merely represented by disabled React controls.

## Clear Product Purpose

The feature has three concrete purposes:

1. **Protect the operator on networks they do not own.** Spoorf audits the local
   Windows device, observes gateway and DNS consistency, reports exposure, and
   offers a self-only emergency disconnect.
2. **Prevent Spoorf itself from becoming a risk.** On a public or unidentified
   network, the application cannot actively discover, control, redirect,
   throttle, intercept, or retain information about other clients.
3. **Separate trusted administration from public self-protection.** Existing LAN
   management remains available only when the complete active-network
   fingerprint matches a profile the operator explicitly trusted.

Expected user journey:

```text
Connect to a new Wi-Fi network
  -> network identity is unknown
  -> Safe Mode activates automatically
  -> cross-device actions are blocked in React, Node, and Python
  -> Spoorf audits only the operator device and displays risk reasons
  -> operator can re-check, mark the network public, trust the full fingerprint,
     or disconnect their own Wi-Fi
```

The feature is not intended to determine who owns another device, prove that an
anomaly is an attack, bypass client isolation, or make public-network device
control acceptable.

## End-to-End User Flow

### 1. Start the application

The user opens Spoorf. Until the Python engine, active adapter, and current
network identity have been checked, the global state is:

```text
UNKNOWN NETWORK - SAFE MODE ACTIVE
```

The dashboard remains usable for local status and diagnostics, but controls that
could affect another device are disabled. If Administrator privileges are not
available, the UI explains which self-protection actions are unavailable rather
than treating the entire application as broken.

### 2. Connect to a public Wi-Fi network

Spoorf observes the new network generation and:

1. stops and restores sessions associated with the previous network;
2. clears ephemeral public-session observations;
3. reads SSID, BSSID, gateway IP/MAC, subnet, interface, DNS, and local Windows
   security posture;
4. builds the network fingerprint;
5. checks whether that exact fingerprint is already trusted;
6. calculates the risk score and allowed capabilities.

For a new or incomplete fingerprint, the result is `unknown`, with Safe Mode
active.

### 3. Review the Safety Center

The user sees:

- `PUBLIC NETWORK - SAFE MODE ACTIVE` or
  `UNKNOWN NETWORK - SAFE MODE ACTIVE`;
- risk score and evidence for every contribution;
- current SSID, BSSID, gateway, subnet, DNS, and interface;
- local exposure checks such as firewall, discovery, SMB, RDP, sharing, and
  listening services;
- incident timeline;
- actions: `Mark Public`, `Trust This Network`, `Re-check`, and
  `Disconnect Now`.

Existing device-control features remain visible but disabled. Hovering or
opening the control shows which capability is denied and why.

### 4. Choose how to classify the network

#### Mark Public

The network profile is stored as `public`. Safe Mode remains active every time
that fingerprint is seen. Spoorf continues self-only monitoring and does not
persist public-session device, DNS, credential, or L7 content.

#### Trust This Network

The action is available only when all required fingerprint fields are present.
The confirmation dialog displays:

- SSID and BSSID;
- gateway IP and MAC;
- subnet;
- interface type;
- capabilities that will become available.

After explicit confirmation, the exact fingerprint becomes `trusted`. Existing
LAN-management features become available. Trusting one fingerprint never trusts
another access point merely because it uses the same SSID.

#### Re-check

Spoorf discards the current posture snapshot, collects it again, and recomputes
the fingerprint, score, and capability set. Re-check does not grant trust.

#### Disconnect Now

Spoorf attempts truthful cleanup, clears ephemeral data, and disconnects only
the operator's Wi-Fi adapter. If cleanup or disconnect fails, the UI lists the
unfinished stages and remains in a restricted recovery state.

### 5. Operate while Safe Mode is active

The user can:

- watch connection health;
- inspect their own exposure;
- receive gateway, DHCP, DNS, and ARP anomaly alerts;
- view incident history;
- re-check posture;
- manage trust profiles;
- disconnect their own Wi-Fi.

The user cannot:

- actively scan other clients;
- block or throttle another device;
- start Gaming isolation;
- redirect traffic;
- start Transparent Gateway, DNS spoofing, or L7 interception;
- enable LAN healing or retaliation against other clients.

Attempts through UI, REST, Socket.IO, or direct Python access all receive the
same policy-denied result.

### 6. Handle a network anomaly

If the gateway MAC, BSSID, subnet, or another trust-critical field changes:

1. Spoorf invalidates the current trusted authorization;
2. existing network-affecting sessions are stopped through the recovery-safe
   lifecycle;
3. Safe Mode becomes active;
4. an incident records the old and new non-sensitive identities;
5. the user sees the reason and may re-check, forget the old profile, or
   explicitly trust the new complete fingerprint.

Spoorf never labels another user as an attacker solely from the identity change.

### 7. Leave or switch networks

On disconnect, sleep/resume, adapter switch, or Wi-Fi roaming:

1. the prior generation is invalidated;
2. in-flight status refreshes are cancelled;
3. public-session data is cleared;
4. the new network begins as `unknown`;
5. a matching complete trusted fingerprint may restore trusted capabilities
   only after fresh posture verification.

### 8. Return to a trusted home or office network

When the complete observed fingerprint matches the stored trusted profile, the
global badge changes to:

```text
TRUSTED NETWORK
```

Normal Spoorf capabilities become available. A mismatch in gateway, BSSID, or
subnet returns the network to Safe Mode instead of silently inheriting trust.

## Product Principles

1. Unknown networks fail closed.
2. Public mode is self-protection and read-only observability only.
3. Manual trust binds to a network fingerprint, not an SSID alone.
4. Security decisions are deterministic and explainable.
5. A policy rejection is explicit and distinguishable from an offline engine.
6. Public-session observations are ephemeral by default.
7. Existing trusted-network features and public API paths remain compatible.

## Network Trust Profile

### Trust levels

- `trusted`: explicitly approved network fingerprint; existing LAN-management
  capabilities may be enabled.
- `public`: explicitly marked untrusted or selected for self-protection only.
- `unknown`: incomplete identity, first observation, changed identity, or
  unavailable engine data. It receives the same restrictive policy as `public`.

### Fingerprint inputs

The fingerprint uses all available stable fields:

- SSID;
- BSSID;
- gateway IPv4 address;
- gateway MAC address;
- IPv4 subnet;
- physical interface type.

SSID alone never grants trust. Missing BSSID or gateway identity produces
`unknown`. A gateway identity change invalidates current trust until reviewed.

### Persistence

SQLite table `network_profiles` stores:

- deterministic fingerprint ID;
- display SSID;
- BSSID;
- gateway IP and MAC;
- subnet;
- interface type;
- trust level;
- first-seen and last-seen timestamps;
- trusted-at timestamp and optional operator note.

The table contains network identity and trust decisions only. It does not store
packet payloads, captured credentials, or public-session device inventories.

## Capability Policy

Node exposes an authoritative capability set:

- `active_discovery`;
- `device_control`;
- `traffic_interception`;
- `host_protection`;
- `read_only_observability`.

Policy matrix:

| Trust level | Active discovery | Device control | Traffic interception | Host protection | Read-only observability |
|---|---:|---:|---:|---:|---:|
| `trusted` | Allowed | Allowed | Allowed | Allowed | Allowed |
| `public` | Denied | Denied | Denied | Allowed | Allowed |
| `unknown` | Denied | Denied | Denied | Allowed when identity is sufficient | Allowed |

The denied groups include:

- active device scan and deep port scan;
- block, throttle, redirect, and Gaming isolation;
- Transparent Gateway, DNS spoofing, sinkhole changes, and L7 interception;
- LAN healing or retaliatory Shield modes affecting other clients;
- remote control actions against another device.

The allowed groups include:

- local adapter, firewall, sharing, and listening-service inspection;
- connection-health telemetry;
- gateway/DNS consistency observations;
- self-only Shield host lock when gateway identity is verified;
- incident viewing, trust management, and panic disconnect.

Every Node REST and Socket.IO mutation passes through one capability guard.
Python also enforces the trust policy on network-affecting endpoints so direct
access to port 8001 cannot bypass Node.

## Architecture

### Python: `SecurityPostureCollector`

Read-only collector for:

- active interface and Wi-Fi encryption/authentication information;
- Windows firewall profile and state;
- network discovery, file sharing, printer sharing, SMB, and RDP exposure;
- local listening ports and owning service metadata;
- gateway IP/MAC and DNS resolver consistency;
- captive-portal indication;
- Shield and network anomaly signals.

The MVP does not automatically modify Windows firewall or sharing settings.

Python receives the current policy snapshot from Node or derives the restrictive
default when policy is absent/stale. Network-affecting endpoints reject denied
capabilities before packet construction or OS mutation.

### Node: `NetworkTrustService`

Separate service rather than additional `DeviceManager` responsibility. It:

- constructs canonical network fingerprints;
- persists trust profiles;
- calculates risk score and reasons;
- derives capabilities;
- tracks current network generation;
- records security incidents;
- gates REST and Socket.IO actions;
- broadcasts `safeModeStatus`.

The service treats missing or stale Python posture as `unknown`.

### SQLite: security records

`network_profiles` stores durable trust decisions.

`security_incidents` stores metadata-only events:

- event type;
- severity;
- network fingerprint ID;
- timestamp;
- human-readable reason;
- structured non-payload details.

No credential values, packet payloads, DNS response bodies, or intercepted
content are stored in this table.

### React: Public Wi-Fi Safety Center

The frontend consumes the authoritative status from Node. It never independently
decides that a network is trusted.

Global status badge:

- `TRUSTED NETWORK`;
- `PUBLIC NETWORK - SAFE MODE ACTIVE`;
- `UNKNOWN NETWORK - SAFE MODE ACTIVE`.

Denied controls remain visible but disabled, with the policy reason. This avoids
confusing a deliberate Safe Mode restriction with an engine failure.

## State and Data Flow

```text
network_changed
  -> stop and restore existing network sessions
  -> invalidate prior network generation and trust snapshot
  -> collect fresh local security posture
  -> construct canonical network fingerprint
  -> load matching trust profile
  -> calculate risk score and capabilities
  -> broadcast safeModeStatus
  -> rehydrate React state for the new generation
```

No active discovery begins until the new generation is both RFC1918-valid and
`trusted`.

## Explainable Risk Score

The score ranges from 0 to 100, where a higher score means higher risk. Each
contribution produces a reason code, weight, observed value, and recommendation.

Initial deterministic signals:

- open or weak Wi-Fi authentication;
- incomplete network identity;
- gateway MAC changed from the trusted profile;
- rogue DHCP signal;
- conflicting gateway ARP signal;
- DNS resolver changed unexpectedly;
- captive portal detected;
- Windows firewall using a permissive/private profile on public Wi-Fi;
- SMB, RDP, file sharing, printer sharing, or network discovery exposed;
- sensitive local listening services bound beyond loopback;
- engine or posture data unavailable.

The same normalized input must always produce the same score and reasons. No
machine-learning classifier is used for enforcement.

## Self Exposure Audit

The audit inspects only the operator's machine. Results include:

- firewall profile and enabled state;
- network discovery state;
- file and printer sharing state;
- SMB and RDP exposure;
- listening TCP/UDP services and bind scope;
- unexpected public-interface listeners;
- DNS and gateway identity consistency;
- recommended manual remediation.

MVP recommendations are informational. Automatic remediation is a separate,
future design requiring per-setting rollback and Administrator consent.

## Gateway Trust Pinning

For a trusted profile, Node compares the observed gateway MAC with the pinned
identity. A mismatch:

1. ends active Spoorf sessions through the existing truthful cleanup flow;
2. changes the current trust state to `unknown`;
3. denies network-affecting capabilities;
4. creates a security incident;
5. asks the operator to re-check or forget the profile.

A mismatch is an anomaly, not automatic proof of attack.

## Panic Disconnect

`Disconnect Now` is self-only:

1. invoke truthful stop-all and recovery flows;
2. clear ephemeral public-session data;
3. disconnect the operator's current Wi-Fi adapter;
4. report partial cleanup failures instead of claiming success.

It never sends a control operation to another host.

## Ephemeral Public Sessions

For `public` and `unknown` networks:

- discovered-device state is memory-only and minimized;
- credential capture and traffic interception are unavailable;
- gateway DNS logs and L7 flows are not durably stored;
- session data is cleared on network generation change, disconnect, or exit;
- security incidents retain metadata only.

Trusted-network persistence retains current behavior.

## API and Event Contract

New Node read endpoints:

- `GET /api/safety/status`;
- `GET /api/safety/posture`;
- `GET /api/safety/incidents`;
- `GET /api/safety/profiles`.

New Node mutations:

- `POST /api/safety/trust`;
- `POST /api/safety/mark-public`;
- `DELETE /api/safety/profiles/:fingerprint`;
- `POST /api/safety/recheck`;
- `POST /api/safety/disconnect`.

New Socket.IO event:

```json
{
  "event": "safeModeStatus",
  "data": {
    "generation": 12,
    "fingerprint": "sha256:...",
    "trust_level": "public",
    "safe_mode": true,
    "risk_score": 72,
    "reasons": [],
    "capabilities": {
      "active_discovery": false,
      "device_control": false,
      "traffic_interception": false,
      "host_protection": true,
      "read_only_observability": true
    }
  }
}
```

Existing paths and events are not renamed. Denied existing actions return:

- HTTP `409 Conflict` with `code: "SAFE_MODE_POLICY_DENIED"`;
- corresponding Socket.IO error payload with the same code and capability.

## Failure Behavior

- Missing SSID, BSSID, gateway, or subnet: `unknown`, Safe Mode enabled.
- Python engine offline: cached trusted state cannot authorize an action.
- Changed network identity: invalidate generation and freeze active capability.
- Failed cleanup during network change: remain restricted with
  `recovery_required: true`.
- Policy status older than the active network generation: Python rejects
  network-affecting operations.
- SQLite unavailable: trust cannot be granted or restored; remain `unknown`.
- Risk-score calculation failure: Safe Mode remains enabled and exposes an
  operational error.

## User Experience

Safety Center displays:

- trust badge and Safe Mode state;
- risk score with individual reasons;
- SSID, BSSID, gateway, subnet, and observation timestamps;
- self-exposure checklist;
- security incident timeline;
- `Trust This Network`, `Mark Public`, `Forget Trust`, `Re-check`, and
  `Disconnect Now` actions.

Trust actions require explicit confirmation showing the full fingerprint.

## Implementation Order

1. P0: network fingerprint, `NetworkTrustService`, durable profiles, and
   capability guards in Node and Python.
2. P0: Safe Mode global badge, disabled-control explanations, and automatic
   transition on network change.
3. P1: `SecurityPostureCollector` and deterministic risk score.
4. P1: incident timeline and ephemeral-session cleanup.
5. P2: privacy-preserving JSON/PDF report export.
6. P3: read-only mobile companion for status and alerts.

## Out of Scope

- automatic Windows firewall or sharing mutation;
- stealth or anti-detection behavior;
- credential capture on public networks;
- remote actions against public-network clients;
- Telegram/Discord action buttons that control another host;
- referral, payments, or monetization;
- bypassing AP/client isolation.

## Testing Strategy

### Python

- denied capabilities reject before packet or OS operations;
- stale/missing generation fails closed;
- posture collection is read-only and handles unavailable Windows commands;
- public/unknown mode never starts active discovery or interception.

### Node

- canonical fingerprints are stable and reject incomplete identity as unknown;
- every existing mutation maps to the correct capability;
- direct REST and Socket.IO calls cannot bypass the policy;
- gateway change invalidates trust and invokes truthful cleanup;
- trust storage failure leaves the network unknown;
- public-session data cleanup is complete and retryable.

### Frontend

- denied controls remain visible with reasons;
- reconnect and network changes cannot restore stale trusted capabilities;
- trust confirmation displays the full network identity;
- engine-offline and policy-denied errors remain distinguishable.

### Acceptance Criteria

- `public` and `unknown` networks cannot perform active scan, device control, or
  traffic interception through React, Node REST, Socket.IO, or direct Python.
- A matching `trusted` fingerprint retains existing LAN-management behavior.
- SSID, BSSID, gateway, or subnet changes invalidate authorization.
- Safe Mode remains active when Python or SQLite is unavailable.
- Public-session device, DNS, L7, and credential data is absent after disconnect.
- Risk scoring is deterministic and includes explainable reason codes.
- Panic disconnect never targets another device and never hides cleanup failure.

## Accuracy and Success Targets

There is no honest single "accuracy percentage" for this feature. It contains
deterministic policy enforcement, network-identity matching, local posture
inspection, anomaly detection, and OS operations. Each must be measured
separately.

The following values are release targets, not current measured results:

| Capability | Release target | Meaning |
|---|---:|---|
| Policy enforcement coverage | **100% of known mutation surfaces** | Every React, REST, Socket.IO, and direct Python path in the capability matrix has an automated allow/deny test. |
| Safe failure rate | **>= 99%** | Missing, stale, contradictory, or unavailable identity/policy data results in Safe Mode rather than an unsafe authorization. |
| Complete-fingerprint network matching | **>= 95%** | Reconnecting to the same tested network produces the same profile, while materially different networks do not inherit trust. |
| Gateway-change detection | **>= 95% when gateway MAC is observable** | A changed pinned gateway identity produces an anomaly and trust invalidation. It does not claim to prove an attack. |
| Supported Windows exposure-audit coverage | **>= 90%** | The collector accurately reports the supported firewall, sharing, SMB, RDP, discovery, and listener checks in the test matrix. |
| Risk-score determinism | **100%** | Identical normalized inputs produce exactly the same score, reason codes, and recommendations. |
| Ephemeral-data cleanup | **100% in automated failure/reconnect tests** | Forbidden public-session device, DNS, L7, and credential data is absent after generation change, disconnect, and exit. |
| Panic-disconnect completion | **>= 95% on supported Windows test machines** | Cleanup and self-disconnect complete; permission or adapter failures are explicitly reported rather than hidden. |

### Expected MVP outcome

For Windows 10/11 with Npcap, an observable gateway, and complete Wi-Fi identity,
the expected end-to-end MVP success range is **90-95%** across the supported test
matrix. The safety objective is higher than the classification objective:
uncertain cases deliberately become `unknown` and remain restricted.

This creates an intentional bias:

- false `unknown/public` classification is inconvenient but safe;
- false `trusted` classification is unacceptable;
- anomaly detection may warn about legitimate router replacement or AP roaming,
  so warnings always include evidence and never automatically accuse another
  user.

### Required validation matrix

Before release, the targets must be measured across:

- WPA2 and WPA3 private networks;
- open and captive-portal Wi-Fi;
- multiple access points sharing one SSID;
- gateway replacement and legitimate BSSID roaming;
- incomplete SSID/BSSID/gateway data;
- Python engine and SQLite unavailable;
- Administrator and non-Administrator Windows sessions;
- reconnect, sleep/resume, adapter switch, and application restart.

If measured complete-fingerprint matching is below 95%, trust remains disabled
for the failing topology until the fingerprint model is revised. If any policy
bypass is found, the feature does not meet its release gate regardless of the
average score.
