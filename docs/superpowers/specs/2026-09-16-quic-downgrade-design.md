# QUIC Downgrade (Force TCP-443) Design

## Goal

Give the Transparent Gateway a way to make its existing per-domain sinkhole
actually bite against modern clients that deliver traffic over QUIC
(HTTP/3, UDP 443). The gateway today only inspects and acts on **TCP 443**
(`transparent_gateway.py:187`) and DNS; QUIC is invisible to it, so a
domain the operator sinkholes keeps working whenever the client uses QUIC
(observed live: `heads-fa-tls13.spotifycdn.com` streamed while the DNS/SNI
sinkhole was active).

QUIC Downgrade denies the target's UDP-443 so QUIC handshakes fail and the
client falls back to TCP-443, where the existing TLS-SNI sinkhole (RST
injection) enforces the operator's block list. It is a **blocking/limiting**
capability only — it never reads or decrypts traffic.

This mirrors an enforcement pattern the gateway already uses: the DoT reset
(`transparent_gateway.py:170`) resets TCP 853 to force DNS back onto
filterable UDP 53. QUIC Downgrade applies the same "deny the transport you
cannot filter, force the one you can" idea to QUIC.

## User-visible contract

A per-target toggle **"Force QUIC → TCP (block)"** appears in the Transparent
Gateway panel, available only while a Transparent Gateway session for that
target is active.

When enabled for a target:

1. the target's outbound UDP-443 (QUIC) is dropped at the controller;
2. the target's apps/browser fall back to TCP-443 (or fail — either outcome
   satisfies a block);
3. the existing TLS-SNI sinkhole cuts whichever domains are on the block
   list, now over the TCP path that QUIC was hiding from.

When disabled (or when the gateway session ends, or on network change), UDP-443
flows normally again.

The toggle is gated behind the same license capability as the Transparent
Gateway (`checkCanGateway`).

## Scope and honest limits

QUIC Downgrade is **blanket per target**: it drops *all* of that target's
UDP-443, not one app's. QUIC packets do not expose a plaintext SNI, so
per-domain selection is impossible at the QUIC layer; selection stays where it
already works — the TCP-SNI sinkhole. Consequence: while enabled, every app on
the target loses QUIC and falls back to TCP (slightly slower). This is the
intended trade-off, not a defect.

Expected blocking effectiveness is roughly 75–80%. Known residual failures,
which the spec does not attempt to solve:

- WinDivert unavailable or conflicting with Npcap on the host.
- The target reaches a service over a path the block list does not cover
  (non-443 ports, hard-coded IPs, a domain absent from the sinkhole set).
- Encrypted ClientHello (ECH) hides the SNI on the TCP fallback so the
  existing sinkhole cannot match (rare today).
- Already-established / buffered flows continue briefly before re-connect.

## Mechanism

Precondition: a Transparent Gateway session for the target is active, so the
target is ARP-poisoned and its packets are routed (forwarded) through the
controller. Only then does the target's UDP-443 traverse the controller where
it can be dropped.

Packet flow when enabled:

1. Target sends a QUIC Initial (UDP, dst port 443) toward a server; because of
   ARP poisoning the frame is delivered to the controller for forwarding.
2. A WinDivert handle on the **`NETWORK_FORWARD`** layer, with filter
   `udp and udp.DstPort == 443 and (ip.SrcAddr == <target_v4> or
   ipv6.SrcAddr == <target_v6>)`, diverts the packet.
3. The drop loop **does not re-inject** the packet — it is dropped. The narrow
   filter guarantees WinDivert diverts only the target's UDP-443; all other
   traffic is untouched by WinDivert and forwards normally.
4. The client retransmits the QUIC Initial; every retransmit is dropped; the
   handshake times out.
5. The client marks QUIC broken for that server and reconnects over TCP-443.
6. The TCP-443 ClientHello now passes the existing gateway sniffer; its SNI is
   extracted; if the domain is on the sinkhole set, the gateway injects a RST
   and the connection is cut.

All UDP-443 from the target is dropped, not only Initials, so an in-progress
QUIC connection (including QUIC connection migration) is also starved and
forced to re-establish over TCP.

WinDivert is required because scapy/Npcap only observes copies of forwarded
packets — the kernel has already forwarded the original. Dropping needs a hook
that can withhold the packet in the kernel; WinDivert on the forward layer does
exactly that, and for this feature it is used in its simplest form (divert then
discard) with no NAT, connection tracking, or return-path rewriting.

The controller's own QUIC is unaffected: host-originated traffic appears on the
`NETWORK` layer, not `NETWORK_FORWARD`, so the filter never matches it.

## Components

New module `python-service/src/core/redirector/quic_downgrade.py`, placed
alongside `transparent_gateway.py`. It is additive and does not touch
`spoofer.py` or the gateway sniffer hot path.

`QUICDowngradeManager`:

- `start(target_ip, target_ipv6=None)` — opens one WinDivert handle for the
  target and starts a daemon drop-loop thread.
- `stop(target_ip)` — sets the loop's stop event, closes the handle, joins.
- `stop_all()` — stops every active handle.
- `get_status()` — returns `{ available, active_targets, ... }` where
  `available` reflects whether WinDivert could be loaded.

State is `{ target_ip: { handle, thread, stop_event, started_at, target_ipv6 } }`
guarded by a lock, following the lifecycle-locking style of
`TransparentGatewayManager` (a dedicated op lock serialising start/stop so a
handle is never opened and closed concurrently for the same target).

A pure helper builds the WinDivert filter string from a target's IPv4 and
optional IPv6 address, so filter construction is unit-testable without the
driver.

## Lifecycle integration

- `start(target_ip)` validates that a Transparent Gateway session for that
  target exists; without it the target is not being forwarded through the
  controller and the drop would be a no-op, so the call returns a clear error.
- Teardown hooks into the existing gateway `_teardown_session` (stop the
  target's handle when its gateway session ends) and the network watchdog's
  `stop_all` path (network/interface change).
- DHCP address change: gateway sessions are keyed by target IP; when the IP
  changes the gateway session is replaced, and QUIC Downgrade is restarted for
  the new IP as part of that replacement. The manager never keeps a handle for
  a stale IP.
- The manager is a singleton constructed in `server.py`, like
  `transparent_gateway`; the gateway teardown path is given a reference so it
  can stop the matching QUIC handle.

## API and UI

Engine (`server.py`, FastAPI):

- `POST /api/gateway/quic-block/start` `{ victim_ip }`
- `POST /api/gateway/quic-block/stop` `{ victim_ip }`
- QUIC-downgrade state (per-target `active`, plus global `available`) is added
  to the existing `GET /api/gateway/status` payload.

Node backend proxies these through `pythonBridge` and exposes them on its
router, gated by `checkCanGateway` (the same gate the Transparent Gateway start
uses in `deviceManager`), so free-tier callers receive `FeatureLockedError`.

Frontend adds the per-target toggle to `TransparentGatewayView`, disabled when
`available` is false (WinDivert missing) with an explanatory tooltip.

## Failure handling and coexistence

- If `pydivert` cannot be imported or the WinDivert driver cannot load, the
  manager reports `available: false`, every `start` returns a clean
  "QUIC downgrade unavailable" error, and the rest of the engine (including the
  Transparent Gateway) keeps running. The feature never crashes the engine.
- WinDivert (a WFP callout driver) and Npcap (an NDIS lightweight filter)
  operate at different layers and are expected to coexist. Coexistence must be
  verified on a real host as part of implementation; if a conflict is found it
  is documented and the feature stays behind its `available` flag.
- Administrator privileges are already required by the engine (Npcap), so
  WinDivert's driver load introduces no new privilege requirement.

## Packaging

- Add `pydivert` (pinned) to `python-service/requirements.txt`.
- PyInstaller already ships `hook-pydivert` via `pyinstaller-hooks-contrib`,
  which collects the WinDivert DLL. The build must additionally confirm the
  WinDivert `.sys` driver is bundled and loadable from the packaged engine, and
  that the signed WinDivert 2.x driver loads without test-signing on target
  Windows versions. This is a packaging acceptance check, not runtime code.

## Privacy and authorization

QUIC Downgrade is an active enforcement capability that degrades another
device's connectivity. It is for operator-administered / authorised networks
only and must not run on public Wi-Fi, consistent with the project's
passive-only-on-public-Wi-Fi rule. It records no traffic content.

## Non-goals

- Reading, decrypting, or recording any traffic (that is the separate,
  not-recommended TLS interceptor).
- Per-domain QUIC selection (impossible without a visible SNI in QUIC).
- Blocking QUIC on ports other than UDP 443.
- Any change to `spoofer.py`, the ARP loop, or the gateway sniffer hot path.

## Testing

Test-driven; unit tests mock `pydivert` with a fake handle that yields packets.

- Manager lifecycle: `start` / `stop` / `stop_all` / `get_status`; op-lock
  serialisation; idempotent stop.
- Filter builder: correct WinDivert filter string for IPv4-only and dual-stack
  targets.
- Drop loop: packets received from the fake handle are consumed and **never**
  passed to `handle.send` (i.e. dropped); the loop exits promptly when the stop
  event is set.
- Absence path: simulated `pydivert` import/driver failure yields
  `available: false` and a clean error from `start`, with no exception escaping.
- Precondition: `start` without an active gateway session for the target
  returns the documented error.
- End-to-end (manual, requires a real WinDivert host and a target): confirm a
  QUIC flow to a test server dies, the client falls back to TCP-443, and a
  sinkholed domain is then RST-cut. Documented as a manual acceptance test
  because it needs kernel-level redirection.

Regression guard: the module is additive; existing spoofer and gateway tests
must remain green and unchanged.
