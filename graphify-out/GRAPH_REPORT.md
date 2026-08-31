# Graph Report - spoorf  (2026-08-28)

## Corpus Check
- 108 files · ~59,155 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 960 nodes · 1520 edges · 76 communities (60 shown, 16 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.58)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- PythonBridge
- scanner.py
- App.tsx
- server.py
- compilerOptions
- devDependencies
- devDependencies
- ARPSpoofer
- pull-to-refresh.tsx
- compilerOptions
- NetCut Sentinel (Spoorf) - Database Schema Specification
- AnimatedSidebar.tsx
- manager.py
- MotionSwitch.tsx
- NetworkActivityChart.tsx
- client.ts
- scroll-progress.tsx
- AnimatedSidebarMenuButton
- useIsMobile
- shared-layout-bg.tsx
- .agents/rules/graphify.md
- .agents/workflows/graphify.md
- python-service/.agents/rules/graphify.md
- python-service/.agents/workflows/graphify.md
- MotionSwitch
- MotionSwitch
- Device
- TestCoreDiscovery
- fingerprint/__init__.py
- is_valid_mac
- get_network_info
- Troubleshooting & Runbook Guide
- Device
- bouncy-accordion.tsx
- cn
- ._build_device
- is_valid_private_ip
- deviceSort.ts
- smooth-scroll.tsx
- 2. Node.js Orchestrator $\rightarrow$ React Frontend
- Changelog & Architecture Evolution
- SPEC-001: Multi-Vector Network Discovery & Profiling Pipeline
- SPEC-002: Passive DHCP Sniffer Daemon & Option 53 Zero-Second Profiling
- SPEC-005: Real-Time Hardware Telemetry & Network Watchdog
- app.ts
- AGENTS.MD: Autonomous Agent Operational Guide
- SPEC-003: High-Performance ARP Spoofing & PWM Bandwidth Throttling
- SPEC-007: Automated Testing Architecture & Quality Assurance
- SPEC-006: Modern Frontend UI, Motion Tabs & Action Tooltips
- .start_redirect
- NetCut Sentinel (Spoorf) - Master Technical Specification
- SPEC-004: Database State Persistence, Device Aliasing & Auto-Reblock
- DatabaseService
- NetCut Sentinel (Spoorf) - Technical Specifications Catalog
- spec_interaction.md
- tests/__init__.py
- deviceManager.ts
- PortalRequestHandler
- Ether
- run_tests.ts
- TestCoreSpoofer
- TestCoreFingerprint
- ThreadingHTTPServer
- get_hostname_info
- DeviceTable.tsx
- scroll-reveal.tsx
- ._stop_session_unlocked

## God Nodes (most connected - your core abstractions)
1. `cn()` - 38 edges
2. `Device` - 25 edges
3. `DeviceManager` - 22 edges
4. `PythonBridge` - 22 edges
5. `Device` - 22 edges
6. `get_network_info()` - 22 edges
7. `ARPSpoofer` - 20 edges
8. `DatabaseService` - 16 edges
9. `compilerOptions` - 16 edges
10. `is_valid_private_ip()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `App()` --indirect_call--> `sortDevices()`  [INFERRED]
  frontend-react/src/App.tsx → frontend-react/src/lib/deviceSort.ts
- `BouncyAccordionRow()` --calls--> `cn()`  [EXTRACTED]
  frontend-react/src/components/motion/bouncy-accordion.tsx → frontend-react/src/lib/utils.ts
- `RefreshBuddy()` --calls--> `cn()`  [EXTRACTED]
  frontend-react/src/components/motion/pull-to-refresh.tsx → frontend-react/src/lib/utils.ts
- `TestCoreDiscovery` --uses--> `DHCPDiscoveredCache`  [INFERRED]
  python-service/tests/test_unit_discovery.py → python-service/src/core/discovery/dhcp.py
- `TestCoreSpoofer` --uses--> `ARPSpoofer`  [INFERRED]
  python-service/tests/test_unit_spoofer.py → python-service/src/core/spoofer.py

## Import Cycles
- None detected.

## Communities (76 total, 16 thin omitted)

### Community 1 - "scanner.py"
Cohesion: 0.11
Nodes (29): collect_from_arp_broadcast(), collect_from_arp_cache(), get_mac_from_arp(), ARP Discovery & Subnet Sweeping Subsystem, Sweep cepat seluruh IP di subnet menggunakan soket non-blocking. Memaksa kernel…, Ambil MAC address untuk IP tertentu dari ARP cache kernel OS., Kumpulkan IP & MAC dari tabel ARP lokal OS (< 0.05s)., Active Layer 2 ARP Request Broadcast ke seluruh subnet via Scapy srp(). (+21 more)

### Community 2 - "App.tsx"
Cohesion: 0.19
Nodes (10): App(), FilterTab, AgentScanProgress(), SCAN_PHRASES, AnimatedSidebar, InstagramRedirectModal(), SecurityTelemetrySidebar(), TelemetryData (+2 more)

### Community 3 - "server.py"
Cohesion: 0.07
Nodes (42): BaseModel, get, on_event, post, NetworkTelemetrySampler, ConnectionManager, get_redirect_status(), get_status() (+34 more)

### Community 4 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, isolatedModules, jsx, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+14 more)

### Community 5 - "devDependencies"
Cohesion: 0.05
Nodes (40): dependencies, cors, dotenv, express, pg, socket.io, ws, description (+32 more)

### Community 6 - "devDependencies"
Cohesion: 0.05
Nodes (36): autoprefixer, axios, framer-motion, dependencies, axios, framer-motion, lucide-react, react-dom (+28 more)

### Community 7 - "ARPSpoofer"
Cohesion: 0.13
Nodes (8): Event, ARPSpoofer, Any, Bangun paket pemulihan (Restore) ganda (Dual-Opcode Restore): 1. ARP Reply…, Loop spoofing dengan Initial Burst kondisional dan TCP-Friendly PWM Throttling., Hentikan sesi spoofing. LOCK CONTENTION TERATASI: Operasi I/O sendp dan sleep…, Dapatkan interface Scapy yang valid dan nama alias Windows-nya., Bangun paket spoofing ganda (Dual-Opcode Injection): 1. ARP Reply (op='is-at'):…

### Community 8 - "pull-to-refresh.tsx"
Cohesion: 0.10
Nodes (26): CALM_PULSE, CHARACTER_LOOP, EMPTY_GESTURE, Gesture, LABEL_SWAP, PullToRefresh(), PullToRefreshProps, PullToRefreshStatus (+18 more)

### Community 9 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, module, outDir, resolveJsonModule, rootDir, skipLibCheck, strict (+6 more)

### Community 10 - "NetCut Sentinel (Spoorf) - Database Schema Specification"
Cohesion: 0.05
Nodes (33): 1. Python FastAPI Microservice (`http://127.0.0.1:8001`), 2. Node.js Backend API (`http://localhost:5000`), Endpoint Kesehatan & Status, Endpoint Pemindaian & Kontrol Akses, Endpoint REST, NetCut Sentinel (Spoorf) - API & WebSocket Specification, Skema Event Socket.IO (`ws://localhost:5000`), WebSocket Python (`ws://127.0.0.1:8001/ws/events`) (+25 more)

### Community 11 - "AnimatedSidebar.tsx"
Cohesion: 0.05
Nodes (38): AnimatedSidebarClose, AnimatedSidebarCloseProps, AnimatedSidebarContent, AnimatedSidebarContext, AnimatedSidebarContextValue, AnimatedSidebarFooter, AnimatedSidebarGroup, AnimatedSidebarGroupContent (+30 more)

### Community 12 - "manager.py"
Cohesion: 0.14
Nodes (11): DNSSpoofer, Worker thread yang mendengarkan paket UDP 53, TCP 853, dan ARP target., Mulai DNS Spoofer di background thread., Hentikan DNS Spoofer secara mulus., Redirector Sub-Package ====================== DNS Spoofing & Captive Portal…, RedirectManager, CaptivePortalServer, patch (+3 more)

### Community 22 - "scroll-progress.tsx"
Cohesion: 0.29
Nodes (8): CommonProps, PROGRESS_SPRING, ScrollProgressBar(), ScrollProgressBarProps, ScrollProgressCircle(), ScrollProgressCircleProps, ScrollProgressProps, useProgressValue()

### Community 23 - "AnimatedSidebarMenuButton"
Cohesion: 0.40
Nodes (5): AnimatedSidebarMenuButton(), AnimatedSidebarMenuSubButton(), MobileSidebar(), useAnimatedSidebar(), useAnimatedSidebarPanel()

### Community 24 - "useIsMobile"
Cohesion: 0.40
Nodes (5): AnimatedSidebarProvider(), getMobileSnapshot(), getServerMobileSnapshot(), subscribeToMobileQuery(), useIsMobile()

### Community 34 - "Device"
Cohesion: 0.12
Nodes (13): AnimatedSidebarProps, Props, Props, Props, Props, InstagramIcon(), Props, LiveTelemetryPoint (+5 more)

### Community 35 - "TestCoreDiscovery"
Cohesion: 0.14
Nodes (7): Edge Case: 20 threads simultaneously writing and reading from cache., Happy Path: Storing and retrieving DHCP metadata with message types., Happy Path: ACK with empty hostname must NOT overwrite existing hostname., Anti-Contamination: IP reassignment must cleanly switch to new MAC without…, Edge Case: Cache capacity bounds check (dropping oldest entry)., Negative: 0.0.0.0 or empty IP string must NEVER be stored as a key., TestCoreDiscovery

### Community 36 - "fingerprint/__init__.py"
Cohesion: 0.15
Nodes (19): extract_mobile_brand_from_hostname(), Any, Multi-Sensor Ensemble Profile Synthesizer…, Ekstrak merek smartphone dari hostname secara defensif. - Cek kata kunci…, Korelasikan temuan seluruh sensor untuk menentukan Hostname, Vendor, OS, dan…, synthesize_ensemble_profile(), Fingerprint Subsystem Exports, detect_device_type() (+11 more)

### Community 37 - "is_valid_mac"
Cohesion: 0.10
Nodes (13): is_valid_mac(), Validasi format alamat MAC 6-oktet., Happy Path: Standard RFC 1918 Private IPv4 Addresses., Negative Tests: Public, Loopback, Multicast, Link-Local, and Malformed IPs., Edge Cases: Empty, None, Boundary IPs, Extreme Lengths, Whitespace., Happy Path: Standard 6-octet MAC addresses with colons and hyphens., Negative Tests: Incorrect lengths, non-hex characters, invalid formats., Edge Cases: Empty string, None, Extreme Length, Whitespace. (+5 more)

### Community 38 - "get_network_info"
Cohesion: 0.15
Nodes (16): Logger, get_current_gateway(), get_network_info(), get_wifi_info(), is_network_changed(), Any, Network Subsystem & Adapter Management =======================================…, Ambil status koneksi Wi-Fi asli Windows melalui netsh wlan. (+8 more)

### Community 39 - "Troubleshooting & Runbook Guide"
Cohesion: 0.12
Nodes (16): 1. Port Conflict / Zombie Process (`EADDRINUSE`), 2. Scapy Interface Not Detected / Npcap Missing, 3. PostgreSQL Database Connection Error (`ECONNREFUSED`), 4. Stale ARP Cache / Network Roaming Desync, 5. Lock Contention / Freezing REST API, Gejala:, Gejala:, Gejala: (+8 more)

### Community 41 - "bouncy-accordion.tsx"
Cohesion: 0.18
Nodes (11): BouncyAccordion(), BouncyAccordionClassNames, BouncyAccordionItem, BouncyAccordionProps, BouncyAccordionRow(), CHEVRON_TRANSITION, CONTENT_CLOSE_TRANSITION, CONTENT_OPEN_TRANSITION (+3 more)

### Community 42 - "cn"
Cohesion: 0.13
Nodes (18): Ctx, listClasses, Tabs(), TabsContent(), TabsCtx, TabsList(), TabsTrigger(), transition (+10 more)

### Community 43 - "._build_device"
Cohesion: 0.16
Nodes (12): get_http_info(), ping_fast(), Any, Probing: ICMP Ping, TCP Port Scan, HTTP Web Title Banner Grabber, Kirim ICMP Ping berkecepatan tinggi via Scapy sr1., Scan port-port umum secara cepat dengan socket connect_ex., Ambil HTTP server banner dan <title> untuk port web yang terbuka., scan_ports() (+4 more)

### Community 44 - "is_valid_private_ip"
Cohesion: 0.17
Nodes (10): DHCPDiscoveredCache, _handle_dhcp_packet(), Any, Passive DHCP Sniffer Daemon (UDP 67/68) =======================================…, Callback parser paket DHCP Scapy., Thread-safe & Anti-Contamination Cache untuk temuan passive DHCP sniffer. -…, Mencari entri berdasarkan MAC address terlebih dahulu, lalu via mapping IP., Snapshot dictionary kompatibel untuk seluruh consumer (keyed by MAC dan IP). (+2 more)

### Community 45 - "deviceSort.ts"
Cohesion: 0.36
Nodes (8): react, DeviceTable(), getDeviceCategory(), hasDeviceName(), ipToNumber(), isDeviceOnline(), sortDevices(), react

### Community 46 - "smooth-scroll.tsx"
Cohesion: 0.29
Nodes (11): readMetrics(), resolveTop(), ScrollSource, ScrollTarget, ScrollToOptions, ScrollTopButton(), SmoothScroll(), SmoothScrollApi (+3 more)

### Community 47 - "2. Node.js Orchestrator $\rightarrow$ React Frontend"
Cohesion: 0.18
Nodes (10): 1. Python Microservice $\rightarrow$ Node.js Orchestrator, 2. Node.js Orchestrator $\rightarrow$ React Frontend, Event: `autoReblocked`, Event: `autoThrottled`, Event: `deviceUpdated`, Event: `dhcp_device_discovered`, Event: `network_changed`, Event: `telemetry` (+2 more)

### Community 48 - "Changelog & Architecture Evolution"
Cohesion: 0.10
Nodes (20): Added:, Added:, Added:, Added:, Added:, Added:, Added & Optimized:, Changed: (+12 more)

### Community 49 - "SPEC-001: Multi-Vector Network Discovery & Profiling Pipeline"
Cohesion: 0.15
Nodes (13): 1. Executive Summary, 2. Arsitektur Pipeline, 3.1 Sensor Layer 2 (ARP Discovery), 3.2 Sensor Multicast & Device Profiling, 3.3 Heuristik MAC Randomization & Klasifikasi, 3. Spesifikasi Teknis Komponen, 4. Skema Data & Kontrak API, 5. Keamanan, Batasan, & Edge Cases (+5 more)

### Community 51 - "SPEC-002: Passive DHCP Sniffer Daemon & Option 53 Zero-Second Profiling"
Cohesion: 0.25
Nodes (8): 1. Executive Summary, 2. Alur Interaksi & Siklus Hidup DHCP, 3.1 Heuristik Parameter Request List (PRL), 3. Spesifikasi Parsing DHCP Options, 4. Keamanan, Anti-Kontaminasi & Thread-Safety (v2.2.0 Defensive Guardrails), 5. Event Stream & Integrasi WebSocket, SPEC-002: Passive DHCP Sniffer Daemon & Option 53 Zero-Second Profiling, WebSocket Event Payload: `dhcp_device_discovered`

### Community 52 - "SPEC-005: Real-Time Hardware Telemetry & Network Watchdog"
Cohesion: 0.25
Nodes (8): 1. Executive Summary, 2. Arsitektur Telemetri & Siklus Watchdog, 3.1 Throughput Download & Upload, 3.2 Gateway Ping Latency, 3. Spesifikasi Perhitungan Throughput & Latensi, 4. Skema Data Event Telemetri, SPEC-005: Real-Time Hardware Telemetry & Network Watchdog, WebSocket Payload: `telemetry`

### Community 53 - "app.ts"
Cohesion: 0.16
Nodes (8): createRouter(), app, databaseService, deviceManager, pythonBridge, server, wsManager, WebSocketManager

### Community 54 - "AGENTS.MD: Autonomous Agent Operational Guide"
Cohesion: 0.29
Nodes (6): 1. System Overview & Service Ports, 2. Core Invariants (Non-Negotiable Rules), 3. Automated Test Verification, 4. Architecture Directory Map, 5. Common Pitfalls & Agent Gotchas, AGENTS.MD: Autonomous Agent Operational Guide

### Community 55 - "SPEC-003: High-Performance ARP Spoofing & PWM Bandwidth Throttling"
Cohesion: 0.29
Nodes (7): 1. Executive Summary, 2. Arsitektur ARP Spoofing Layer 2, 3. Spesifikasi Dual-Opcode Injection & Restoration, 4. Algoritma Pembatasan Bandwidth (TCP-Friendly PWM Duty-Cycle), 5. Model Konkurensi Bebas Lock Contention, Formula Matematis Time-Slicing v2.3.0, SPEC-003: High-Performance ARP Spoofing & PWM Bandwidth Throttling

### Community 56 - "SPEC-007: Automated Testing Architecture & Quality Assurance"
Cohesion: 0.29
Nodes (7): 1. Executive Summary, 2. Matriks Cakupan Pengujian (53 Test Cases), 3.1 Python Service Test Suite (40 Tests), 3.2 Node.js Backend Test Suite (13 Tests), 3. Rincian Modul Pengujian, 4. Panduan Eksekusi Pengujian, SPEC-007: Automated Testing Architecture & Quality Assurance

### Community 57 - "SPEC-006: Modern Frontend UI, Motion Tabs & Action Tooltips"
Cohesion: 0.33
Nodes (6): 1. Executive Summary, 2. Struktur Desain Komponen Antarmuka, 3. Spesifikasi BeUI Motion Tabs, 4. Spesifikasi BeUI Action Tooltip, 5. Standar Visual & Konsistensi Ikon, SPEC-006: Modern Frontend UI, Motion Tabs & Action Tooltips

### Community 58 - ".start_redirect"
Cohesion: 0.25
Nodes (5): Aktifkan atau nonaktifkan IP forwarding di level OS kernel., set_ip_forwarding(), Any, Dapatkan ringkasan seluruh sesi redirect yang aktif., Memulai sesi redirect Walled Garden ke akun Instagram untuk target IP.

### Community 59 - "NetCut Sentinel (Spoorf) - Master Technical Specification"
Cohesion: 0.40
Nodes (5): 1. Ikhtisar Arsitektur Sistem (System Architecture), 2. Katalog Spesifikasi Teknis Rinci (Detailed Specifications), 3. Matriks Protokol Jaringan & Standar RFC, 4. Prinsip Keamanan & Ketahanan Sistem (*Safety Guardrails*), NetCut Sentinel (Spoorf) - Master Technical Specification

### Community 60 - "SPEC-004: Database State Persistence, Device Aliasing & Auto-Reblock"
Cohesion: 0.18
Nodes (11): 1. Executive Summary, 2. Skema Relasional Database (PostgreSQL), 3. Pipeline Rekonsiliasi Data & Auto-Reblock Engine, 4. Keamanan & Perlindungan Data, 5.1 Matriks Penilaian, 5.2 Keputusan Ambang Batas (*Threshold Decisions*), 5. Multi-Factor Fingerprint Scoring & Anti-Collateral Protection (v2.2.0), 6.1 Mekanisme Auto-Archiving pada Database (+3 more)

### Community 62 - "NetCut Sentinel (Spoorf) - Technical Specifications Catalog"
Cohesion: 0.67
Nodes (3): Indeks Spesifikasi Teknis (Technical Specifications), NetCut Sentinel (Spoorf) - Technical Specifications Catalog, Standar Format & Struktur Dokumentasi

### Community 65 - "deviceManager.ts"
Cohesion: 0.23
Nodes (8): calculateProfileMatchScore(), GENERIC_EXACT_BLACKLIST, GENERIC_FACTORY_PATTERNS, isGenericFactoryHostname(), isIpInSameSubnet(), PythonCommand, PythonResponse, SpoofSession

### Community 67 - "Ether"
Cohesion: 0.25
Nodes (4): Ether, Proses paket masuk: Reactive ARP, DoT Port 853 RST, dan DNS Port 53., Uji apakah domain Instagram di-whitelist dan domain lain di-spoof., Happy & Edge: Option 51 (Lease) and Option 3 (Gateway) parsing.

### Community 68 - "run_tests.ts"
Cohesion: 0.39
Nodes (4): runApiRoutesTests(), main(), runDatabaseTests(), runDeviceManagerTests()

### Community 69 - "TestCoreSpoofer"
Cohesion: 0.11
Nodes (16): Exception, NetworkError, ScanError, SessionNotFoundError, SpoofError, patch, Unit Tests for Spoofer Engine (src.core.spoofer) Covers: Happy Path, Negative…, Verify _build_restore_packets creates both 'is-at' and 'who-has' for victim and… (+8 more)

### Community 70 - "TestCoreFingerprint"
Cohesion: 0.07
Nodes (15): Happy & Edge: Brand keyword extraction with negative lookahead guard., Edge Case: Asus Vivobook with port 445 must be classified as Windows PC, never…, Edge Case: Samsung TV must be classified as Smart TV, never Mobile phone!, Happy Path: Locally Administered MACs (second character: 2, 6, A, E)., Negative Tests: Globally unique hardware factory MACs (OUI)., Edge Cases: Empty, None, Malformed short strings., Happy Path: Brand resolution from known OUI database., Gateway flag returns Router / Gateway. (+7 more)

### Community 71 - "ThreadingHTTPServer"
Cohesion: 0.40
Nodes (3): HTTPServer, ThreadingHTTPServer, ThreadingMixIn

### Community 72 - "get_hostname_info"
Cohesion: 0.32
Nodes (7): get_hostname_info(), query_mdns(), query_netbios(), NetBIOS (NBNS) & mDNS Name Resolution, Query NetBIOS Name Service (port 137 UDP) untuk Windows/Samba., Query mDNS / Bonjour (port 5353 UDP) untuk Apple, Android, Linux., Dapatkan nama host melalui NetBIOS, mDNS, dan Reverse DNS.

### Community 73 - "DeviceTable.tsx"
Cohesion: 0.47
Nodes (3): Side, Tooltip(), TooltipProps

### Community 74 - "scroll-reveal.tsx"
Cohesion: 0.33
Nodes (4): ScrollReveal(), ScrollRevealProps, ScrollRevealRowProps, EASE_OUT

### Community 75 - "._stop_session_unlocked"
Cohesion: 0.33
Nodes (3): Hentikan satu sesi tanpa mengambil lock lagi (internal)., Hentikan sesi redirect untuk target IP., Hentikan semua sesi redirect yang aktif.

## Knowledge Gaps
- **279 isolated node(s):** `name`, `version`, `description`, `main`, `dev` (+274 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `name`, `version`, `description` to the rest of the system?**
  _279 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `PythonBridge` be split into smaller, more focused modules?**
  _Cohesion score 0.1286549707602339 - nodes in this community are weakly interconnected._
- **Should `scanner.py` be split into smaller, more focused modules?**
  _Cohesion score 0.11428571428571428 - nodes in this community are weakly interconnected._
- **Should `server.py` be split into smaller, more focused modules?**
  _Cohesion score 0.07305669199298656 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.047619047619047616 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._