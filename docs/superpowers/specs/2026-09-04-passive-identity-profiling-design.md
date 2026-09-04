# Passive Identity Profiling Design

## Goal

Replace Technique 3B Method 3, currently presented as automatic Quick
Re-Auth through a simultaneous micro-cut, with a safe identity-enrichment
workflow that does not disconnect or impersonate another device.

The replacement profiles every online device visible to the controller from
fresh protocol evidence and a bundled local reference database. Its quality
target is at least 90% precision for results labeled high-confidence. Runtime
coverage remains an observed metric and is never forced to 90% by assigning
unsupported guesses.

## User-visible contract

Method 3 becomes **Automatic Passive Identity Profiling**.

The background listeners continuously collect normal advertisements. When a
new device first becomes visible, Node schedules one debounced enrichment for
that device. The button remains available to refresh all visible devices.

One manual invocation:

1. snapshots the currently visible online devices;
2. opens one bounded observation window;
3. collects passive advertisements and safe discovery responses;
4. correlates IPv4, IPv6, MAC, hostname, model, service, and DHCP evidence;
5. classifies vendor and device category with separate confidence values;
6. persists the evidence and returns one measured summary.

The workflow may identify names such as `DESKTOP-58NKETL`, `Galaxy-A07`, or
user-assigned names when a device advertises them through DHCP, DHCPv6, mDNS,
SSDP, LLMNR, NetBIOS, or local DNS. OUI data identifies a registered hardware
manufacturer; it cannot provide a hostname and must not be presented as one.

The UI must prefer `Unknown` over an unsupported vendor, type, or hostname.

## Accuracy and coverage definitions

Accuracy and coverage are separate:

- **Precision** is the proportion of emitted high-confidence labels that match
  ground truth.
- **Coverage** is the proportion of visible eligible devices that receive both
  a non-generic vendor and a non-generic device category at high confidence.
- **Hostname coverage** is reported separately because many clients suppress or
  randomize their advertised name.
- **Visibility** is the number of devices observable from the controller. It is
  not the total number of clients associated with an access point.

The acceptance target is:

- high-confidence vendor-and-category precision of at least 90% on a labeled
  benchmark corpus;
- no fixed production coverage claim;
- no claim that all users of a public access point are visible.

Expected engineering ranges, not guarantees:

| Environment or evidence | Expected result |
| --- | --- |
| Factory MAC plus explicit DHCP/mDNS/SSDP model | 90-97% combined vendor/type accuracy |
| Two independent evidence families | 85-95% combined vendor/type accuracy |
| OUI alone | 90-98% NIC registrant accuracy, but only 45-70% device-category accuracy |
| Randomized MAC plus explicit model/vendor-class evidence | 85-95% combined accuracy |
| Randomized MAC plus weak hostname/service evidence | 55-85% combined accuracy |
| Public Wi-Fi with client isolation | Coverage may remain 30-70% or lower |

Only benchmark measurements may be described as measured accuracy. Runtime
confidence is a classifier decision, not a substitute for ground truth.

## Safety constraints

- No ARP poisoning, NDP poisoning, DHCP spoofing, DHCP NAK, deauthentication,
  packet blackholing, route invalidation, or target disconnect.
- Never send an IPv6 Router Advertisement or forged Neighbor Advertisement.
- Never advertise the controller MAC as the gateway or another device.
- Never attempt to bypass AP or client isolation.
- Never query external profiling services or upload MAC addresses, hostnames,
  or packet metadata.
- Use only RFC 1918 IPv4 destinations, link-local IPv6 destinations, and
  addresses already observed on the current network.
- Apply strict timeouts, bounded concurrency, and per-invocation rate limits.
- Gateway and controller devices remain excluded from profiling coverage.
- A sensor failure is reported as failed or partial; it is never converted into
  a success-shaped response.
- This workflow never launches a broad port scan. It may reuse service metadata
  that a separate, explicitly authorized scan already discovered.

## Architecture

### Python evidence model

Add a structured evidence layer under `src/core/fingerprint/`. Each observation
has:

```python
{
    "source": "mdns",
    "field": "model",
    "value": "Galaxy A07",
    "reliability": "strong",
    "observed_at": "2026-09-04T08:00:00Z"
}
```

Each device assessment returns:

```python
{
    "vendor": "Samsung",
    "device_type": "Smartphone / Tablet",
    "hostname": "Galaxy-A07",
    "vendor_confidence": 94,
    "type_confidence": 96,
    "hostname_confidence": 90,
    "profile_status": "high",
    "evidence_sources": ["oui", "mdns", "dhcp_vendor_class"],
    "profiled_at": "2026-09-04T08:00:05Z",
    "profile_version": 1
}
```

The existing `synthesize_ensemble_profile()` compatibility surface remains
available while scanner callers migrate to the structured assessment.

### Fresh evidence

Each invocation can classify a device with no prior per-device profile:

- current ARP and NDP cache observations;
- DHCP and DHCPv6 messages observed within the bounded recent-evidence window;
- mDNS, SSDP, and LLMNR advertisements or responses;
- NetBIOS and reverse-DNS names where available;
- current TTL, already-discovered services, and safe liveness evidence;
- bundled local OUI and signature reference data.

Persisted profiles are output history, not required classifier input. A prior
label must not be counted as fresh evidence for the next run. Recent raw
protocol observations may be reused only when their timestamps remain within
the five-minute evidence freshness window. A manual refresh opens a five-second
observation window; the server clamps any future configurable value to three
through ten seconds.

### Local OUI and signature data

Replace the small hard-coded OUI map with a versioned, generated local artifact
derived from the official IEEE assignment registry. Runtime lookup is offline.
The artifact records its source version and generation date.

For a locally administered or randomized MAC:

- do not infer the manufacturer from its prefix;
- label the MAC property as randomized/private;
- require explicit protocol or model evidence before assigning a vendor;
- otherwise keep the vendor unknown.

OUI means the registered interface manufacturer. The classifier may map it to
an end-device vendor only when corroborated or when the vendor-to-product
relationship is unambiguous.

### Evidence fusion

Vendor, category, and hostname are scored independently. Evidence is grouped so
correlated observations do not inflate confidence:

1. explicit identity: DHCP vendor class/FQDN, mDNS model, SSDP manufacturer and
   model, or an equivalent device-originated field;
2. hardware registration: stable factory OUI;
3. service behavior: advertised service types and already-known service
   signatures;
4. naming behavior: hostname and model patterns;
5. weak network behavior: TTL and liveness characteristics.

Rules:

- high-confidence requires at least two independent evidence groups, except an
  explicit manufacturer/model identifier whose mapping is unambiguous;
- weak TTL or port evidence can support a result but cannot establish vendor;
- conflicting strong evidence lowers confidence or produces `Unknown`;
- `Generic Device`, `Private Device`, and similar fallbacks do not count as
  identified vendors;
- `Generic Client Device` and equivalent fallbacks do not count as identified
  categories;
- evidence reasons are returned so every label is explainable.

Raw scores are calibrated against the labeled benchmark. The UI uses status
bands rather than presenting an uncalibrated score as a literal probability.

### Safe IPv6 evidence collector

IPv6 is an additional evidence source, not a disruption mechanism. It may:

- read the local NDP neighbor cache;
- observe DHCPv6 messages;
- send one mDNS, SSDP, and LLMNR query burst over IPv4 and IPv6, then collect
  responses;
- resolve names for IPv6 addresses already observed;
- send a bounded Neighbor Solicitation or Echo request only to an already-known
  target when required for liveness correlation;
- correlate DUID, MAC, IPv4, IPv6, hostname, and service evidence.

It must not:

- send Router Advertisements;
- send forged Neighbor Advertisements;
- invalidate a default route;
- sweep the IPv6 address space;
- assume a privacy IPv6 interface identifier reveals a hardware MAC.

Per-target unicast discovery uses at most eight workers and one attempt per
protocol during an invocation. It never generates candidate IPv6 addresses or
probes an address that was not already observed.

IPv6 evidence is expected to improve hostname and category coverage for
responsive dual-stack devices by roughly 5-20 percentage points, but it does
not guarantee a complete profile.

## API design

Add the canonical endpoint:

```text
POST /api/network/profile-refresh
```

The Node route orchestrates one Python observation and one fresh merge. The
result includes:

```json
{
  "success": true,
  "data": {
    "visible_count": 12,
    "high_confidence_count": 9,
    "medium_confidence_count": 2,
    "unknown_count": 1,
    "hostname_count": 7,
    "coverage_percentage": 75,
    "ap_isolation": {
      "is_isolated": false,
      "percentage": 0
    },
    "sources": {
      "oui": 10,
      "dhcp": 4,
      "dhcpv6": 1,
      "mdns": 6,
      "ssdp": 2,
      "llmnr": 3,
      "netbios": 2,
      "ndp": 5
    },
    "partial_failures": [],
    "duration_ms": 4200,
    "devices": []
  }
}
```

Compatibility behavior:

- Node and Python retain `POST /api/network/quick-reauth`;
- the old endpoint becomes a deprecated alias for the safe profile refresh;
- it never calls `micro_cut_batch`;
- legacy request targets are ignored because the safe replacement profiles the
  controller's current visible-device snapshot;
- the response preserves `success` and `data` while adding
  `"deprecated": true`;
- legacy `quickReauthStarted` and `quickReauthDone` events are emitted alongside
  the new events with `operation: "profile_refresh"` and `deprecated: true`
  until a separately documented contract removal;
- new clients use `profileRefreshStarted` and `profileRefreshDone`.

The obsolete Method 3 call path to `ARPSpoofer.micro_cut_batch()` and its IPv6
NDP/RA companion is removed. No exposed route retains the disruptive behavior.

## Node orchestration

`DeviceManager.profileRefresh()`:

- uses one in-flight promise for concurrent callers;
- applies a short cooldown to duplicate requests;
- invalidates cached results when the network generation changes;
- profiles all visible online devices, excluding gateway and controller;
- performs one observation/enrichment cycle and one fresh merge;
- does not schedule a second frontend scan;
- persists profile fields and evidence atomically;
- returns partial sensor failures without discarding successful evidence;
- rejects a total collector failure.

When a previously unseen device or new protocol evidence arrives,
`DeviceManager` schedules one per-device enrichment after a short debounce. A
per-device cooldown prevents repeated advertisements from continuously
triggering work. The automatic path and manual full refresh share the same
classifier and persistence code.

The backend and frontend use one shared definition of:

- visible and eligible device;
- identified vendor;
- identified category;
- high-confidence profile;
- hostname evidence.

## Persistence

Add device fields:

- `profile_status`;
- `vendor_confidence`;
- `type_confidence`;
- `hostname_confidence`;
- `profile_evidence` as bounded JSON;
- `profiled_at`;
- `profile_version`.

Schema migration is additive. Existing vendor, type, hostname, alias, block,
redirect, profile-link, and DHCP fields remain intact. Evidence JSON stores
only normalized metadata already available locally and has a size limit.

Historical results may remain visible as last-known information, but they are
not counted as fresh evidence after expiration.

## Frontend design

Method 3 is relabeled **Automatic Passive Identity Profiling**.

The modal explains:

- no device will be disconnected;
- a profile is created from evidence the device exposes;
- names and vendors may remain unavailable on isolated or privacy-preserving
  networks;
- high confidence prioritizes correctness over filling every row.

The result panel shows:

- visible devices;
- high-confidence, medium, and unknown counts;
- actual high-confidence coverage;
- hostname coverage;
- evidence-source counts;
- AP-isolation warning;
- partial sensor failures;
- duration.

Device details display the confidence band and evidence sources. The UI does
not present a generic fallback as a successfully identified vendor or type.

## Error handling and concurrency

- Python validates every observed IPv4, IPv6, and MAC value before using it.
- Sensor errors remain scoped to that sensor and appear in
  `partial_failures`.
- If no collector can run, the endpoint fails rather than returning an empty
  success.
- Node does not catch and convert Python rejection into success.
- One frontend action creates one backend operation.
- Network changes cancel stale results.
- Concurrent callers share one operation.
- Timeouts cancel outstanding work; no background disruptive action can
  continue because the workflow contains no spoofing session.

## Impact

### Target devices

- no intentional packet loss;
- no ARP or NDP cache poisoning;
- no DHCP lease change;
- no Wi-Fi disconnect;
- no IPv6 default-route invalidation;
- only normal discovery traffic with bounded rate and timeout.

Some devices may log or ignore discovery requests. Devices behind client
isolation remain invisible.

### Application

- profiling becomes explainable and measurable;
- vendor coverage improves substantially for stable factory MACs;
- IPv6 can enrich responsive dual-stack devices;
- randomized/private clients remain honestly unknown unless they advertise
  useful identity;
- one run takes several seconds instead of claiming an instant result;
- the local OUI artifact adds a bounded amount of packaged data;
- database rows gain evidence and confidence metadata.

## Testing

### Python

- evidence normalization and independent-source grouping;
- deterministic vendor and category decisions;
- conflict handling and abstention;
- factory OUI and randomized-MAC behavior;
- DHCP, DHCPv6, mDNS, SSDP, LLMNR, NetBIOS, DNS, and NDP fixtures;
- IPv4/IPv6 destination validation and rate limits;
- partial and total collector failures;
- an assertion that profile refresh never calls ARP/NDP spoofing, sends Router
  Advertisements, or changes IP forwarding;
- compatibility endpoint behavior.

### Node

- one observation and one fresh merge;
- single-flight, cooldown, and network-generation invalidation;
- atomic persistence of profile and evidence fields;
- consistent eligible/high-confidence calculations;
- propagation of total failures and preservation of partial failures;
- old endpoint and event compatibility without micro-cut;
- no duplicate scan from live evidence events.

### Frontend

- shared coverage calculation;
- Generic/Private/Unknown values are not counted as identified;
- confidence and evidence rendering;
- AP-isolation and partial-failure messages;
- exactly one request per click;
- no post-result rescan;
- deprecated wording and micro-cut claims are absent.

### Benchmark

Create a labeled fixture corpus containing:

- Windows `DESKTOP-*` and custom names;
- Android and Galaxy model/name variants;
- Apple mobile and desktop devices;
- TVs, printers, cameras, IoT, servers, and network equipment;
- stable factory MACs and randomized MACs;
- missing, weak, and contradictory evidence.

The benchmark is split into rule-development fixtures and a holdout validation
set derived only from devices whose ground truth is known and authorized. It
reports a confusion matrix, precision, coverage, and unknown rate.
High-confidence combined vendor-and-category precision must be at least 90% on
the holdout set. Unknown cases remain in the coverage denominator. Synthetic
fixtures prove deterministic behavior but are not presented as real-world
accuracy.

Run the existing full Python, Node, and frontend checks after implementation.
No test sends real packets to the current network.

## Migration and rollout

1. Add evidence types, classifier, local OUI artifact, and fixture tests.
2. Add safe IPv4/IPv6 collectors and measured Python endpoint.
3. Add Node orchestration, persistence migration, and compatibility alias.
4. Replace Method 3 UI and remove duplicate scan behavior.
5. Remove the obsolete micro-cut call path and tests that describe it as DHCP
   re-authentication.
6. Run the benchmark and full regression suites.
7. Report measured precision and coverage separately.

## Out of scope

- profiling clients hidden by AP isolation;
- guaranteeing visibility of all access-point users;
- DHCP FORCERENEW without an authoritative DHCP server;
- access-point deauthentication or forced reassociation;
- router or AP administration APIs;
- cloud MAC/vendor lookup;
- deep probing of arbitrary public-network clients;
- claiming 90% production coverage without labeled ground truth.
