# DHCP Discovery Refresh Design

## Goal

Replace Technique 3B Method 1's unreliable "DHCP trigger" claim with a safe,
measured discovery refresh that sends one multicast burst, observes naturally
occurring DHCP traffic, performs one scan, and reports the actual enrichment
delta.

## User-visible contract

Method 1 becomes **Discovery Refresh & DHCP Observation**.

It may:

- wake mDNS, SSDP, and LLMNR responders;
- refresh ARP, NDP, and service discovery through one normal scan;
- observe DHCP messages that occur naturally during a four-second window;
- report new and updated DHCP evidence.

It does not claim to force a DHCP renewal. When no DHCP event is observed, the
result explicitly recommends Method 2 target reconnect.

## Safety constraints

- The endpoint rejects missing, public, or inconsistent IPv4 topology before
  opening any network socket.
- All active destinations remain RFC1918 or link-local multicast.
- No packet advertises the gateway IP with the controller MAC.
- No micro-cut, spoof session, DHCP NAK, deauthentication, or target disconnect
  is part of Method 1.
- One user invocation produces one multicast burst and one full scan.
- A failed send is counted and exposed; zero successful datagrams is an
  operational failure, not success.
- Existing REST paths remain unchanged.

## Python design

### Structured multicast delivery

`send_multicast_wakeup()` returns:

```python
{
    "attempted": 6,
    "succeeded": 5,
    "failed": 1,
    "protocols": {
        "ssdp_ipv4": True,
        "mdns_ipv4": True,
        "llmnr_ipv4": True,
        "ssdp_ipv6": False,
        "mdns_ipv6": True,
        "llmnr_ipv6": True,
    },
    "errors": [
        {"protocol": "ssdp_ipv6", "error": "unavailable"}
    ],
}
```

Socket setup or `sendto` failures are recorded per protocol. Error strings are
operational summaries and contain no credentials or packet payloads.

### Unique DHCP snapshots and deltas

`DHCPDiscoveredCache.get_unique_snapshot()` returns one entry per normalized
MAC. `diff_dhcp_profiles(before, after)` compares:

- IP;
- hostname;
- vendor class;
- DHCP fingerprint;
- client ID;
- FQDN.

It returns new, updated, unchanged, and total unique MAC counts. Profile counts
never use the compatibility snapshot containing both MAC and IP lookup keys.

### Observation endpoint

`POST /api/dhcp/wakeup`:

1. validates active private CIDR, controller IP, and gateway membership;
2. captures the unique baseline;
3. sends one structured multicast burst;
4. fails with HTTP 503 if no datagram was transmitted;
5. waits four seconds without blocking the event loop;
6. captures the unique final snapshot;
7. returns delivery and DHCP delta.

### Scan multicast suppression

`POST /api/scan` accepts an optional body:

```json
{ "skip_multicast_wakeup": true }
```

The default remains `false`, preserving all existing callers. Technique 3B uses
`true` because its observation endpoint already sent the burst.

`NetworkScanner.scan_full(include_multicast_wakeup=True)` skips only the wakeup
send when false; SSDP/mDNS collection and the rest of the normal scan still run.

### Safe unicast ARP

Replace the gateway-disguised probe with a normal unicast ARP request whose
sender protocol address and hardware address both belong to the controller.
The old internal helper name remains as a compatibility alias during this
change, but scanner code uses the truthful new name.

### DHCP parser accuracy

PRL classification converts Option 55 to `list[int]` and `set[int]`; matching
uses ordered prefixes or integer-set subsets, never substring search.

DHCP renewal IP resolution ignores `0.0.0.0` candidates and falls through in
this order:

1. requested address;
2. offered address;
3. current client address.

## Node design

`PythonBridge.scan({ skipMulticastWakeup?: boolean })` preserves the no-argument
default and sends the optional scan body.

`DeviceManager.optimizeDhcpProfiling()`:

- coalesces concurrent calls into one promise;
- returns the most recent result during a 20-second cooldown;
- calls Python observation once;
- performs one scan with multicast wakeup suppressed;
- returns delivery, DHCP delta, devices, cached/cooldown status, and duration.

The existing route remains `POST /api/network/optimize-dhcp`.

### Live DHCP persistence

For an existing device, the DHCP callback:

- replaces blank, IP-like, or `Unknown*` hostnames;
- merges vendor class, fingerprint, client ID, and FQDN;
- persists all DHCP fields and the current IP in one database transaction;
- emits the updated device;
- schedules one short, coalesced enrichment scan only when meaningful DHCP
  evidence changed.

The scanner in-place merge also copies every `dhcp_*` field so memory and
SQLite converge without restart.

## Frontend design

Create `src/lib/dhcpProfiling.ts` with pure helpers:

- `hasDhcpEvidence(device)`;
- `hasAnyProfileEvidence(device)`;
- `calculateDhcpCoverage(devices)`.

Coverage rules:

- exclude gateway and controller;
- include only online devices;
- count unique normalized MAC addresses;
- DHCP evidence requires fingerprint, vendor class, client ID, or FQDN;
- zero eligible devices returns `percentage: null`, rendered as `N/A`.

The modal displays:

- Discovery coverage;
- DHCP evidence coverage;
- datagrams transmitted and failed;
- new and updated DHCP profiles;
- explicit "no DHCP handshake observed" copy;
- target reconnect recommendation.

The frontend parses the endpoint response and does not call
`onTriggerReScan()` after success. The backend result already contains the one
scan.

Method 2 copy removes "100%" and "0 seconds". It states that reconnect normally
improves capture probability but remains dependent on AP visibility and client
DHCP behavior.

## Expected outcome

These are engineering targets, not measured production guarantees:

- device rediscovery on a private non-isolated LAN: 60-90%;
- mDNS/SSDP/ARP metadata enrichment: 35-70%;
- new DHCP evidence without target reconnect: 0-10%;
- truthful workflow reporting: 95-99%;
- zero target disruption caused by Method 1.

## Testing

Python tests cover:

- private-topology rejection before sockets;
- per-protocol send accounting and zero-send failure;
- unique MAC snapshots and profile deltas;
- scan multicast suppression;
- safe unicast ARP sender identity;
- exact integer PRL matching;
- renewal `ciaddr` fallback.

Node tests cover:

- one observation call and one scan;
- optional scan body;
- concurrent coalescing and cooldown reuse;
- complete live DHCP field persistence;
- enrichment scan only on meaningful delta;
- scanner merge preserving all DHCP fields.

Frontend tests cover:

- self/gateway exclusion;
- unique-MAC counting;
- DHCP evidence distinct from generic hostname evidence;
- `N/A` for no eligible devices;
- response-result rendering inputs.

## Out of scope

- forcing DHCP renewal from a client laptop;
- router-specific DHCP APIs;
- Method 3 Quick Re-Auth redesign;
- bypassing client/AP isolation;
- field accuracy claims without a ground-truth capture study.
