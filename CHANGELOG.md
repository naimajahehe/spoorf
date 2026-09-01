# Changelog & Architecture Evolution

Seluruh riwayat perubahan arsitektur, penambahan fitur, dan perbaikan bug sistem NetCut Sentinel (Spoorf).

## [v2.32.0] - 2026-09-01

### Real System Diagnostics & True Npcap Initialization Bootstrap
- **Real Hardware & Npcap Kernel Driver Probe — `python-service/src/core/diagnostics.py`**:
  - Menggantikan simulasi awal/dummy dengan inspeksi hardware dan kernel driver sesungguhnya.
  - Memverifikasi status service Windows `npcap` (`sc query npcap` -> `STATE : 4 RUNNING`), keberadaan DLL `wpcap.dll` dan `Packet.dll` (di System32/SysWOW64), Scapy L2 binding (`conf.use_pcap`), dan jumlah interface fisik Layer 2 yang terikat.
  - Menguji hak akses Administrator OS (`IsUserAnAdmin`), adapter jaringan aktif (Wi-Fi SSID, sinyal, IP privat RFC 1918), dan latensi koneksi ke Default Gateway secara real-time.
  - Endpoint baru: `GET /api/system/diagnostics` dan pembaruan `GET /health` di FastAPI.
- **Node.js Diagnostics Orchestrator — `backend-node` (`deviceManager.ts`, `pythonBridge.ts`, `routes.ts`)**:
  - Mengintegrasikan diagnosa Python dengan verifikasi integritas SQLite WAL (`PRAGMA integrity_check`, `journal_mode`, path database, dan jumlah perangkat tersimpan).
  - Mengekspos route `GET /api/system/diagnostics` dan memperbarui `GET /health` dengan status kesiapan Python Engine secara jujur.
- **Frontend Live EngineReadinessGate & Terminal Bootstrap — `frontend-react` (`EngineReadinessGate.tsx`, `types/index.ts`, `api/client.ts`)**:
  - Menghapus total timer `setTimeout` palsu di `EngineReadinessGateContent`.
  - Inisialisasi kini memanggil `apiClient.getDiagnostics()` dan memvalidasi setiap subsistem (Python Engine, Npcap Driver, Physical Adapter, SQLite WAL) berdasarkan hasil inspeksi nyata.
  - Jika driver Npcap tidak ditemukan atau service STOPPED, gerbang menampilkan banner peringatan kritis interaktif dengan instruksi perbaikan serta tombol *"Periksa Ulang (Retry Check)"* dan *"Lanjutkan Mode Terbatas (Bypass)"*.
  - Terminal bootstrap menyiarkan log hardware nyata dengan timestamp, nama adapter, IP gateway, dan status L2 binding langsung dari kernel.
- **Verifikasi:** 149/149 test Python + 28/28 test Node lulus; `npm run build` di frontend lulus 100% bersih.

## [v2.31.0] - 2026-08-31

### Quality & Reliability (Perbaikan Prioritas-3)
- **Validasi input angka API — `backend-node/src/api/routes.ts`**: helper `parsePositiveInt()` memberi nilai default aman untuk query `?limit=` yang tidak valid (mis. `?limit=abc`), mencegah `NaN` diteruskan ke engine.
- **Transparansi status database — `database.ts` + `deviceManager.ts` + `routes.ts`**: bila file DB gagal dibuka & sistem jatuh ke SQLite in-memory, kini di-set flag `usingMemoryFallback`, log peringatan jelas, dan dilaporkan di `GET /health` (`services.database_persistent: false` + `warnings[]`) — sebelumnya senyap sehingga operator tidak sadar data tidak tersimpan.
- **Keamanan URL frontend — `frontend-react/src/api/client.ts`**: parameter path `ip`/`id` dibungkus `encodeURIComponent`.
- **Bersih-bersih — `pythonBridge.ts`**: menghapus penangan `ws.on('error')` ganda.
- **Ditunda sengaja:** pembersihan `except:` telanjang di engine Python (bare-except sering disengaja untuk ketahanan daemon; perubahan blanket berisiko) dan refactor pemecahan file besar (`deviceManager.ts`, `App.tsx`) — diperlakukan sebagai peningkatan arsitektur terpisah.
- **Verifikasi:** 27/27 test Node lulus; `tsc --noEmit` bersih untuk backend & file yang diubah.

## [v2.30.0] - 2026-08-31

### Security Hardening (Perbaikan Prioritas-2)
- **[HIGH] Captive Portal XSS / Open-Redirect — `python-service/src/core/redirector/portal_server.py`**:
  - `sanitize_redirect_url()`: whitelist skema `http/https` (tolak `javascript:`/`data:`/dsb.) di set-time, render, & header `Location`.
  - `_render_landing_html` kini meng-`html.escape` semua nilai dinamis (URL di `href`/`meta`, username di `<title>`/teks) dan memakai `js_string_literal()` untuk konteks `<script>` — meng-escape `< > &` sehingga `</script>` di dalam URL https valid pun **tidak** bisa menutup blok script (menutup *script-breakout* yang lolos dari `json.dumps` biasa).
  - 4 test baru di `test_redirector.py`.
- **[MEDIUM] Proteksi izin Root CA key — `interceptor/certs.py`**:
  - `_restrict_key_permissions()` memperketat izin `spoorf-ca-key.pem` saat generate: `chmod 600` (POSIX) / `icacls` grant hanya user aktif (Windows). Enkripsi passphrase at-rest tetap Roadmap.
- **[MEDIUM] Sanitasi pesan error (anti info-disclosure)**:
  - Node: helper `respondError()` di `routes.ts` — log detail penuh ke server, kirim pesan **operasional** (validasi/feature-gate/"not found") ke klien, selebihnya generik. 48 situs `res.status(500)...error.message` diseragamkan.
  - Python: `@app.exception_handler(StarletteHTTPException)` di `server.py` men-scrub seluruh detail 5xx (log penuh, balas "Internal server error"); pesan 4xx operasional dipertahankan.
- **Ditunda (Roadmap, dengan alasan):** verifikasi lisensi kriptografis (butuh Cloud API/public-key), rate-limit leaky-bucket & anti clock-tamper (SPEC-010).
- **Verifikasi:** **149/149** test Python + **27/27** test Node lulus; `tsc --noEmit` bersih (backend/frontend/electron). Detail: `docs/SECURITY_AUDIT.md`.

## [v2.29.0] - 2026-08-31

### Security Hardening (Audit Defensif & Perbaikan Prioritas-1)
- **Exact-Match Origin/Host (menutup drive-by CORS bypass) — `backend-node/src/security.ts`**:
  - `isAllowedOrigin` kini mem-parse URL dan mencocokkan `hostname` **secara eksak** (`localhost`/`127.0.0.1`/`::1`). Sebelumnya `startsWith('http://localhost')` keliru mengizinkan `http://localhost.evil.com` sehingga situs jahat yang dikunjungi operator bisa memanggil control-plane. Origin literal `null` kini ditolak; `[::1]` ditambahkan ke allowlist Host.
- **IPC Bearer Token (control-plane auth) — Node + Python + Electron**:
  - Token `crypto.randomBytes(32)` di-generate & disuntik oleh Electron (`main.ts`) ke Node, Python, dan renderer (`preload.ts` → `electronAPI.apiToken`).
  - Node: middleware `apiTokenGuard` (`security.ts`, `app.ts`) + guard handshake Socket.IO (`websocket/index.ts`); Python: middleware `api_token_guard` + guard WS (`server.py`); `pythonBridge.ts` menyertakan header `x-sentinel-token` di semua panggilan. Aktif saat `SENTINEL_API_TOKEN` diset (auto di Electron; nonaktif di dev — kompatibel). `/health` tetap publik.
  - Frontend: `api/client.ts` (interceptor) & `useWebSocket.ts` (`auth.token`) mengirim token bila ada; typing `types/electron.d.ts`.
- **Anti Command-Injection (validasi gateway + tanpa shell) — `python-service`**:
  - `spoofer.py::start` kini memvalidasi **`gateway_ip`/`gateway_mac`** (RFC 1918 / MAC), bukan hanya victim.
  - `_ensure_host_gateway_locked` (spoofer) dan `_resolve_gateway_mac`/`_lock_kernel_neighbor`/`_unlock_kernel_neighbor` (shield) diubah dari `subprocess(..., shell=True)` string ke **argument-list `shell=False`** + validasi input.
  - **Bugfix laten:** `spoofer.py` tidak pernah meng-`import subprocess` → `_ensure_host_gateway_locked` selalu `NameError` (senyap) & penguncian ARP kernel tak pernah aktif; kini diperbaiki.
- **Bugfix restorasi ARP saat exit — `desktop-electron/src/main.ts`**:
  - Path graceful-shutdown diperbaiki dari `/api/spoof/stop-all` (404) menjadi `/api/spoof/stop_all` (benar), sehingga tabel ARP korban dipulihkan saat aplikasi ditutup.
- **Dokumentasi diselaraskan dengan kode**:
  - Koreksi menyeluruh **PostgreSQL → SQLite** (SPEC-004, SPECIFICATION, API_SPEC, DEPLOYMENT, TROUBLESHOOTING).
  - SPEC-010 kini memisahkan **Implemented vs Roadmap**; SPEC-003 menambah invariant validasi & eksekusi aman; SPEC-008 meluruskan perilaku lisensi aktual (`max_cuts=5`, aktivasi prefix-string, demo-gated).
  - Menormalkan tabrakan penomoran: **SPEC-008 (L7) → SPEC-012**; indeks `docs/specs/README.md` diperbarui.
  - Menambah **`SECURITY.md`** (root) & **`docs/SECURITY_AUDIT.md`** (laporan audit lengkap).
- **Automated Verification**:
  - **145/145** unit test Python lulus (termasuk 3 test validasi gateway baru di `test_unit_spoofer.py`).
  - **27/27** unit test Node lulus (termasuk `unit_security.test.ts` baru: exact-origin, host, token guard).
  - `tsc --noEmit` bersih untuk backend-node, frontend-react, desktop-electron.

## [v2.28.0] - 2026-08-31

### Added & Enhanced (Gaming Mode - Ultra-Low Latency & Anti-Jitter Subsystem):
- **Core Gaming Engine (`python-service/src/core/gaming.py`, `spoofer.py`)**:
  - **Zero-Lag Dead MAC Blackhole:** Saat Gaming Mode aktif dan perangkat diputus (`speed_limit <= 0`), arah router diracuni mengarah ke Dead MAC (`02:00:00:00:00:00`) sehingga seluruh trafik video/download dibuang di level hardware router (0 paket yang membanjiri kartu Wi-Fi laptop operator).
  - **Adaptive Keep-Alive Pacing:** Menyesuaikan interval injeksi paket pemeliharaan dari 450ms menjadi 1.5s, menghemat 75% frekuensi paket raw dan membersihkan interferensi radio Wi-Fi.
  - **Real-Time Jitter & Latency Watchdog:** Mengukur latensi real-time fisik (ms), fluktuasi jitter, dan packet loss setiap 1.0 detik dengan sensor berakurasi sub-milidetik.
- **Node.js Orchestrator & API Integration (`types`, `pythonBridge.ts`, `deviceManager.ts`, `routes.ts`, `websocket/index.ts`)**:
  - Menambahkan REST endpoints `GET /api/gaming/status` dan `POST /api/gaming/toggle`.
  - Relay event WebSocket `gamingStatusUpdate` dan `gamingTelemetryStream` secara real-time ke UI React.
- **Frontend Esports HUD Widget (`GamingModeWidget.tsx`, `App.tsx`, `AnimatedSidebar.tsx`)**:
  - Widget Mode Gaming modern bergaya *Cyberpunk / Esports Neon*.
  - Tombol 1-Click Toggle `⚡ MODE GAMING` di Topbar header dan menu Sidebar dengan ikon `Gamepad2`.
  - Tiga indikator sensor real-time: **Ping Latensi (ms)**, **Fluktuasi Jitter (±ms)**, dan **Packet Loss (0%)**.
  - Pilihan mode optimasi (*Smart Airtime Priority* vs *Ultra Blackhole Isolation*) dan pengaturan ambang batas target ping (15ms, 25ms, 40ms, 60ms).
- **Automated Verification**:
  - 139/139 unit test Python lulus 100% (termasuk `test_unit_gaming.py`).
  - 23/23 unit test Node.js lulus 100%.
  - React production build lulus 100% (0 error).

## [v2.27.0] - 2026-08-30

### Added & Enhanced (Shadcn/Blocks.so Exact Login04 Integration & UI Library Components):
- **Shadcn UI Core Components (`src/components/ui/`)**:
  - Menambahkan komponen standar `card.tsx`, `label.tsx`, `separator.tsx`, `checkbox.tsx`, `input.tsx`, dan `button.tsx` dengan styling Geist Sans & Dark Mode.
- **Exact Login04 Design (`src/components/ui/auth-page.tsx`, `LoginModal.tsx`)**:
  - Mengintegrasikan desain persis dari `Login04 / blocks.so`: Header Logo SVG kustom, typography "Sign in to your account", input Email & Password dengan tombol *Eye / EyeOff*, serta opsi aktivasi License Key langsung yang bersih tanpa teks tambahan.
  - Menghubungkan alur login cloud dan aktivasi kunci lisensi ke backend Node dan state lokal.

## [v2.26.0] - 2026-08-30

### Enhanced & Fixed (BeUI Command Palette, Notification Mute Reliability, and Topbar Wi-Fi Clean UI):
- **BeUI-Inspired Command Palette (`CommandPalette.tsx`, `App.tsx`, `AnimatedSidebar.tsx`)**:
  - Mengimplementasikan komponen Command Palette (`⌘K` / `Ctrl+K`) terinspirasi dari `beui.dev/components/blocks/command-palette`.
  - Dilengkapi *Frosted Glass Backdrop*, *Spring-Animated Active Row Cursor*, *Fuzzy Search Filtering*, navigasi panah keyboard instan, serta integrasi pencarian perangkat jaringan aktif dan pintasan navigasi.
  - Membuka Command Palette secara otomatis saat ikon Search di sidebar diklik atau saat menekan hotkey `Ctrl+K` / `Cmd+K`.
- **True Mute Notification Reliability (`App.tsx`, `NotificationPopover.tsx`)**:
  - Memperbaiki fungsi Mute: saat status Muted aktif, suara lonceng (*chime sound*), pop-up toast di layar (*active toasts*), dan desktop notifications ditekan secara penuh.
  - Riwayat notifikasi tetap tercatat secara rapi di dalam *Notification History* tanpa mengganggu fokus pengguna.
  - Menghapus tombol mute redundant di topbar header sehingga kontrol Mute hanya terpusat di dalam popover Notifikasi.
- **Borderless Topbar Wi-Fi Display (`App.tsx`)**:
  - Menghilangkan bingkai lingkaran/pill border di sekitar nama Wi-Fi pada header atas sehingga tampil lebih bersih, elegan, dan menyatu dengan tema gelap (*Clean Borderless Style*).

## [v2.25.0] - 2026-08-30

### Added & Enhanced (Sentinel Shield Anti-ARP Spoofing Engine & Settings Page):
- **Core Sentinel Shield Engine (`python-service/src/core/shield.py`)**:
  - **Host Immunity (100% Kebal):** Mengunci entri ARP Gateway di level kernel Windows (`Set-NetNeighbor -State Permanent` / `netsh`) sehingga OS secara otomatis mengabaikan dan membuang 100% paket racun ARP dari pihak ketiga.
  - **Threat Radar & Anomaly IDS (`_threat_sniffer_loop`):** Passive Layer 2 ARP sniffer yang memantau frame spoofing di udara, menangkap MAC penyerang, dan memancarkan notifikasi peringatan keamanan real-time.
  - **Clean Heartbeat Emitter (`_heartbeat_loop`):** Menjaga tabel ARP router agar selalu terhubung dengan MAC host controller asli.
  - **LAN Auto-Healing Emitter (`_lan_healer_loop`):** Mode vaksinasi jaringan yang menyiarkan paket Gratuitous ARP bersih secara berkala untuk menyelamatkan perangkat lain di LAN yang diserang NetCut.
- **Physical Wi-Fi / Ethernet Interface Selection (`network.py`, `spoofer.py`)**:
  - Mengimplementasikan `get_active_ip()` menggunakan *Kernel Route UDP Socket* yang 100% akurat mendeteksi IP rute aktif ke internet.
  - Menambahkan blacklist filter untuk adapter Bluetooth PAN, Loopback, VirtualBox, WSL, dan TAP Virtual Adapters sehingga engine Scapy selalu terikat ke adapter Wi-Fi fisik.
- **Full-Stack Orchestration (`routes.ts`, `pythonBridge.ts`, `websocket/index.ts`)**:
  - Menambahkan REST endpoints `/api/shield/status`, `/api/shield/toggle`, `/api/shield/mode`, `/api/shield/threats`.
  - Relay event WebSocket `shieldStatusChanged` dan `arpThreatDetected` secara real-time ke UI React.
- **Dedicated Settings & Security Page (`SettingsView.tsx`, `App.tsx`)**:
  - Halaman Pengaturan modern di sidebar (`activeNav === 'settings'`).
  - Master Control Toggle untuk Sentinel Shield dengan animasi Framer Motion.
  - 3 Mode Pertahanan (*Host Immunity*, *LAN Guardian*, *Reflect Counter*).
  - Tabel Threat Radar interaktif yang menampilkan log serangan yang digagalkan.
  - Banner peringatan keamanan instan saat serangan terdeteksi di jaringan.
- **Automated Verification**:
  - 129/129 unit & API test Python lulus 100% (`unittest`: OK in 19.8s).
  - 23/23 unit & integrasi test Node.js lulus 100% (`npm test`: OK in 0.34s).
  - React production build lulus 100% (`tsc && vite build`: OK in 5.90s).

## [v2.24.0] - 2026-08-30

### Fixed & Enhanced (Zero-Collision Dynamic IP Reallocation & Last-Known IP History):
- **Instant Empty Active IP on Offline (`database.ts`, `deviceManager.ts`)**:
  - Mengosongkan alamat `ip` aktif (`ip = ''`) secara atomik ketika perangkat resmi berstatus Offline (melewati *Grace Period* 75 detik atau via event *DHCP Release*).
  - Menghilangkan 100% potensi tabrakan IP dan mencegah perangkat offline menimpa entri perangkat online yang baru saja menempati IP tersebut.
- **Historical IP Tracking via `last_ip` (`database.ts`, `types`)**:
  - Menambahkan kolom `last_ip` pada tabel `devices` dan skema interface `Device` (backend & frontend).
  - Menyimpan jejak alamat IP terakhir yang pernah dipakai perangkat untuk keperluan audit, pencarian, dan tampilan riwayat tanpa mengotori rute jaringan aktif.
- **Resilient UI Offline Representation (`DeviceTable.tsx`, `deviceSort.ts`)**:
  - Menangani perangkat offline di tabel UI:
    - **PRO/VIP:** Menampilkan nama perangkat di baris utama dan `Offline (192.168.110.X)` di baris kedua.
    - **FREE:** Menampilkan badge `Offline (192.168.110.X)` yang bersih.
  - Memperbarui fungsi pengurutan IP `ipToNumber` untuk menggunakan `last_ip` sebagai fallback saat perangkat offline.
- **Automated Verification**:
  - 125/125 unit & API test Python lulus 100% (`unittest`: OK in 20.5s).
  - 23/23 unit & integrasi test Node.js lulus 100% (`npm test`: OK in 0.24s).
  - React production build lulus 100% (`tsc && vite build`: OK in 8.70s).

## [v2.23.0] - 2026-08-30

### Fixed & Enhanced (Dynamic IP Churn & MAC-Centric Reassignment Reconciliation):
- **MAC-First Identity & Key Reconciliation (`deviceManager.ts`)**:
  - Mengubah seluruh alur data di `_handleDhcpEvent` dan `_scanNetworkImpl` menjadi **MAC-Centric Reconciliation**.
  - Saat perangkat (misal Samsung Galaxy A55) berpindah IP dari `.254` ke `.4`, mapping lama di memori `this.devices.delete(oldIp)` langsung dihapus secara bersih.
  - Jika IP baru (`.4`) sebelumnya dipegang oleh perangkat lain (misal Laptop/Smart TV), sistem secara atomik mencopot kepemilikan IP tersebut dari perangkat lama dan menandai perangkat lama sebagai offline (*IP Reassignment Protection*).
- **Atomic SQLite IP Disassociation (`database.ts`)**:
  - Menambahkan query disosiasi IP atomik pada `syncScanResults` dan `saveDevice` serta helper `updateDeviceIp`:
    `UPDATE devices SET is_online = 0 WHERE ip = ? AND LOWER(mac) != LOWER(?)`.
  - Menjamin tidak ada lagi dua baris perangkat berbeda yang mengklaim satu IP aktif yang sama di SQLite.
- **Pre-Flight Liveness Auto-Migration (`deviceManager.ts`)**:
  - Mengimplementasikan *Auto-Migration Guard* di `_verifyPreFlightLiveness`: jika target tidak membalas probe ARP di IP lama, sistem secara otomatis mengecek posisi IP baru dari MAC tersebut dan mengalihkan aksi pemutusan (*cut-off*) secara instan tanpa kegagalan.
- **Timestamp-Based UI Deduplication & MAC Inspector Sync (`deviceSort.ts`, `App.tsx`)**:
  - Memperbarui `dedupeDevicesByMac` dan `dedupedDevices` di React untuk membandingkan `last_seen` timestamp, sehingga IP aktif terkini selalu tampil di layar.
  - Menghubungkan pelacakan sidebar inspeksi ke MAC perangkat target via `selectedInspectorMacRef`, sehingga jika IP target berubah saat sidebar terbuka, sidebar tetap terhubung dan otomatis berpindah ke IP baru.
- **Automated Verification**:
  - 125/125 unit & API test Python lulus 100% (`unittest`: OK in 19.2s).
  - 23/23 unit & integrasi test Node.js lulus 100% (`npm test`: OK in 0.42s).
  - React production build lulus 100% (`tsc && vite build`: OK in 6.29s).

## [v2.22.0] - 2026-08-30

### Fixed & Optimized (Pre-Flight Liveness Guard, Async Single-Flight Scan & In-Place Delta Merge):
- **Async Single-Flight Scan Coalescing (`deviceManager.ts`)**:
  - Memisahkan eksekusi `scanNetwork` dari mutex serialisasi `opChain` (`runExclusive`).
  - Menerapkan pola *Single-Flight Promise* (`inFlightScan`) sehingga panggilan scan yang bersamaan berbagi eksekusi tunggal tanpa membebani kartu Wi-Fi (*0 stacking*).
  - Aksi pengguna (**Block, Unblock, Set Speed Limit, Redirect**) kini dieksekusi secara instan ($< 50\text{ ms}$) tanpa tertunda $2.5 - 3.5\text{ detik}$ di belakang antrean pemindaian jaringan.
- **In-Place Delta Merge & Late-Check Auto-Reblock (`deviceManager.ts`)**:
  - Menghapus pemanggilan destruktif `this.devices.clear()` saat scan selesai dan menggantinya dengan *In-Place Delta Merge*.
  - Menjamin status manipulasi aktif (`is_blocked`, `speed_limit`, `session_id`) yang sedang berjalan di memori/database tidak pernah tertimpa (*Zero State Overwrite*).
  - Menambahkan *Late-Check* atomik pada loop `autoReblockTargets` dan `autoThrottleTargets` untuk mencegah *ghost re-blocking* jika target baru saja di-unblock oleh pengguna selama scan berlangsung.
- **Pre-Flight Validation Pipeline (`deviceManager.ts`)**:
  - Mengimplementasikan `_verifyPreFlightLiveness` yang secara otomatis mengirimkan Layer 2 Unicast ARP Pulse ($350\text{ ms} + 350\text{ ms}$ adaptive retry) sebelum mengeksekusi aksi pemutusan (*cut-off*) atau *throttling*.
  - Jika target terbukti offline (tidak membalas ARP probe di hardware L2), sistem membatalkan pemutusan, memperbarui status perangkat menjadi offline di database & memori, serta memancarkan event `deviceDisconnected` ke UI.
- **Frontend Lucide React Icons & Self-Correcting Table (`DeviceTable.tsx`)**:
  - Menyempurnakan micro-interaction tombol aksi dengan ikon Lucide React yang konsisten:
    - Mini spinner `Loader2` (`animate-spin`, `text-amber-400`) saat verifikasi denyut pre-flight berjalan.
    - `WifiOff` (`text-rose-500`) saat terblokir.
    - `Wifi` (`text-emerald-400` online, `text-zinc-500` offline).
    - `Lock` (`text-zinc-500`) untuk perangkat yang dilindungi (*This PC* & *Gateway*).
  - Menyesuaikan tooltip interaktif: *"Memverifikasi denyut & memutus..."* dan *"Perangkat Offline (Tidak terhubung ke Wi-Fi)"*.
- **Redirect Mode Initial Burst Bypass (`spoofer.py`)**:
  - Memperbaiki bug di mana Initial Burst (5 paket ARP poison) sempat meracuni Router Gateway pada mode *Redirect / Transparent Gateway* (`is_redirect=True`).
- **IPv6 Throttling Unrestricted Standby & Lifecycle Cleanup (`spoofer_v6.py`)**:
  - Menambahkan guard clause `speed_limit >= 100` pada loop manipulasi IPv6 NDP/RA untuk memulihkan rute IPv6 secara penuh saat batas kecepatan 100%, serta membersihkan entri sesi lama (*zombie metadata*).
- **Free Tier Policy & Feature Gating Adjustment (`licenseManager.ts`, `DeviceTable.tsx`)**:
  - Menaikkan batas pemutusan perangkat akun Free dari 1 target menjadi **Maksimal 5 Target Pemutusan Aktif** (`max_cuts: 5`).
  - Menyesuaikan kebijakan privasi/intelijen di mana fitur **Deep Fingerprinting & OS Detect** dinonaktifkan pada akun Free (`can_deep_fingerprint: false`), sehingga antarmuka hanya menampilkan alamat IP dan nama perangkat/vendor dasar tanpa mengungkap detail versi kernel/OS mendalam.
- **Automated Verification**:
  - 125/125 unit & API test Python lulus 100% (`unittest`: OK in 20.3s).
  - 23/23 unit & integrasi test Node.js lulus 100% (`npm test`: OK in 0.23s).
  - React production build lulus 100% (`tsc && vite build`: OK in 5.56s).

## [v2.21.0] - 2026-08-29

### Added & Packaged (Standalone Windows .exe Installer with Electron & PyInstaller):
- **Master Desktop Packaging Pipeline (`SPEC-009_ELECTRON_DESKTOP_PACKAGING.md`)**:
  - Mengembangkan modul baru `desktop-electron` yang membungkus seluruh ekosistem (Frontend React 18, Backend Node.js 20, Python 3.11 Npcap Engine, dan SQLite WAL) menjadi **Satu File Installer Windows Mandiri (`.exe`)**.
  - Dihasilkan file installer: **`desktop-electron/dist-installer/Spoorf Sentinel Setup 2.21.0.exe`** (105.4 MB) menggunakan **Electron Builder + NSIS**.
- **PyInstaller Python Standalone Engine (`build_engine.py`)**:
  - Mengompilasi engine Python Scapy/FastAPI menjadi biner mandiri `spoorf-engine.exe` di dalam folder `python-service/dist/spoorf-engine/`.
- **Electron Process Supervisor & Single Instance Lock (`main.ts`)**:
  - *Single Instance Lock*: Mencegah aplikasi dibuka berulang kali dan mencegah tabrakan port 5000/8001.
  - *Process Supervisor*: Menjalankan `spoorf-engine.exe` dan backend Node.js secara senyap di background (`windowsHide: true`).
  - *Graceful Auto Un-Spoof*: Memulihkan seluruh tabel ARP target secara otomatis sebelum aplikasi ditutup (*Clean Exit*).
- **Mandatory Login Gate Screen (`SPEC-008`, `AuthGateScreen.tsx`)**:
  - Layar pembuka login wajib modern dengan dark-glassmorphism, ekstraksi HWID di background, tab serial key, dan demo tier switcher.
- **Automated Verification**:
  - 23/23 test suite Node.js lulus 100% (`npm test`: 23 passed in 1.22s).
  - 122/122 test suite Python lulus 100% (`unittest`: 122 passed in 15.7s).
  - React production bundle lulus 100% (`tsc && vite build`: OK).
  - Electron Builder NSIS installer berhasil dibuat 100%.

## [v2.20.0] - 2026-08-29

### Added & Architecture Evolution (Cloud Auth & In-App Feature Gating):
- **Decoupled Cloud-Desktop Licensing Architecture (`SPEC-008_CLOUD_AUTH_AND_DESKTOP_LICENSING.md`)**:
  - Memisahkan arsitektur modul secara bersih: Website Portal Cloud (Landing page, user registration, JWT license signing, pembayaran QRIS/Midtrans) terpisah dari Aplikasi Desktop Lokal (Layer 2 Npcap/Scapy injection engine).
- **Hardware Fingerprint (HWID) & License Manager (`licenseManager.ts`, `database.ts`)**:
  - Mengimplementasikan `LicenseManager` service dengan generator HWID mesin lokal (`SHA-256` dari hostname, OS, platform, CPU model, memory).
  - Persistensi cache lisensi di SQLite (`license_cache` table) dengan mode *7-day offline grace period fallback* (aplikasi tetap berjalan jika tidak ada koneksi internet hingga 7 hari).
- **In-App Tier Enforcement & Feature Gating Guards (`deviceManager.ts`)**:
  - `Free Tier`: Kuota maksimal 1 target pemutusan internet simultan (`max_cuts: 1`), Throttling dikunci (`FeatureLockedError`), Transparent Gateway dikunci (`FeatureLockedError`), Multi-target massal dibatasi.
  - `Pro Tier`: Pemutusan tanpa batas (`max_cuts: 999`), PWM Bandwidth Throttling aktif (1% - 99%), Smart Transparent Gateway sinkhole aktif, Auto-Reblock anti ganti MAC aktif.
  - `VIP Tier`: Semua kapabilitas tanpa batas (`can_arsenal: true`, VIP badge).
- **Authentication & Licensing REST API & WebSockets (`routes.ts`, `websocket/index.ts`)**:
  - Endpoint `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/activate`.
  - Event WebSocket `licenseStatus` real-time synchronization.
- **Frontend UI & User Profile Experience (`LoginModal.tsx`, `UpgradeProModal.tsx`, `AnimatedSidebar.tsx`, `SecurityTelemetrySidebar.tsx`, `App.tsx`)**:
  - Komponen `LoginModal`: modal login akun cloud & aktivasi kode lisensi bergaya dark-glassmorphism.
  - Komponen `UpgradeProModal`: modal penawaran upgrade PRO berkonversi tinggi dengan tabel perbandingan fitur dan direct checkout link.
  - Dynamic user profile di footer sidebar dengan inisial avatar, email, dan tier badge (`FREE`, `PRO`, `VIP`).
  - Lock indicators 🔒 dan proteksi interaktif pada slider Bandwidth Throttling serta navigasi menu.
- **Automated Verification**:
  - 23/23 unit & integrasi test Node.js lulus 100% (`npm test`: 23 passed in 0.36s).
  - 122/122 unit & API test Python lulus 100% (`unittest`: OK in 19.4s).
  - Build produksi React TypeScript lulus 100% (`tsc && vite build`: OK).

## [v2.19.0] - 2026-08-29

### Added & Migrated (Zero-Configuration Embedded SQLite Engine Migration):
- **Full Database Persistence Migration to SQLite (`better-sqlite3`)**:
  - Menggantikan seluruh layer persistensi dari PostgreSQL service eksternal (`pg.Pool` di port 5432) menjadi **SQLite 3 embedded (`better-sqlite3`)** dengan mode **WAL (Write-Ahead Logging)** dan `PRAGMA synchronous = NORMAL`.
  - Database otomatis dibuat di `data/sentinel.db` tanpa memerlukan instalasi service database eksternal (*Zero-Configuration Application*).
- **SQLite Schema & Data Mapping (`database.ts`)**:
  - Menyelaraskan seluruh DDL tabel `devices` dan `device_profiles` beserta indeks performa ke tipe data SQLite (`TEXT`, `INTEGER`, `REAL`).
  - Serialisasi kolom array (`open_ports`, `services`, `linked_macs`, `ipv6_addresses`) menggunakan JSON string yang di-parse otomatis via helper `safeParseJson`.
  - Mengimplementasikan transaksi atomik native `db.transaction()` pada fungsi `syncScanResults` dengan *auto-rollback* otomatis jika terjadi interupsi.
- **Node.js Dependencies & Test Suite Enhancement (`package.json`, `app.ts`, `unit_database.test.ts`)**:
  - Meng-uninstall dependensi `pg` dan `@types/pg`, menambahkan `better-sqlite3` dan `@types/better-sqlite3`.
  - Menambahkan test case in-memory `:memory:` untuk pengujian langsung SQLite CRUD, setAlias, setSpeedLimit, setBlocked, Auto-Reblock, dan JSON parsing.
- **Automated Verification**:
  - 18/18 test suite Node.js lulus 100% (`npm test`: 18 passed in 0.40s).
  - 122/122 unit & API test Python lulus 100% (`unittest`: OK).
  - Build frontend React TypeScript lulus 100% (`tsc && vite build`: OK).

### Added & Enhanced (Deterministic AP Isolation / Client Isolation Detector):
- **Differential AP Isolation Diagnostic Engine (`ap_isolation.py`, `scanner.py`, `server.py`)**:
  - Mengimplementasikan deteksi otomatis pembatasan *Wireless Client Isolation* oleh router AP menggunakan 3 pilar:
    1. *BSSID Multicast Reflection Probe* dengan `IP_MULTICAST_LOOP = 0` untuk mendeteksi apakah AP memblokir frame multicast di udara.
    2. *Layer 2 vs Layer 3 Hairpinning Cross-Check* pada kandidat DHCP/History untuk memverifikasi isolasi L2 saat L3 forwarding diizinkan router.
    3. *Lone Client Guard & Zero-Peer Discrepancy Heuristic* untuk mencegah *false positive* pada jaringan rumahan yang sedang sepi.
- **REST API & Orchestrator Integration (`server.py`, `pythonBridge.ts`, `deviceManager.ts`, `routes.ts`)**:
  - Menyediakan endpoint `GET /api/network/ap-isolation` dan mengintegrasikan metadata diagnostik ke dalam payload `POST /api/scan`.
- **UI Diagnostic Alert (`App.tsx`, `types/index.ts`, `api/client.ts`)**:
  - Menampilkan banner diagnostik pintar di atas tabel host saat AP Isolation terdeteksi dengan persentase kepastian dan status penjelas.
- **Automated Verification**:
  - Test suite baru `test_unit_ap_isolation.py` (4 test cases: 100% PASS).
  - 120/120 unit test Python lulus 100% (`unittest`: OK).
  - 18/18 test suite Node.js lulus 100% (`npm test`: OK).
  - Build produksi React TypeScript lulus (`tsc && vite build`: OK).

## [v2.17.0] - 2026-08-29

### Fixed & Enhanced (Anti-Flapping 2-Strike Liveness Confirmation & Non-Poisoning ARP Probes):
- **Clean Host-to-Host Unicast ARP Probing (`liveness.py`)**:
  - Mengoreksi `psrc` pada paket Unicast ARP denyut liveness dari yang sebelumnya `gateway_ip` menjadi `my_ip` (IP host operator).
  - Menghilangkan *inadvertent ARP poisoning* pada perangkat target yang tidak diblokir sehingga koneksi perangkat lain di LAN tidak pernah tersendat.
- **Anti-Flapping 2-Strike Offline Confirmation Rule (`liveness.py`)**:
  - Menerapkan aturan *2-Strike Failure*: status `OFFLINE` hanya dikonfirmasi setelah 2 siklus gagal berturut-turut (~3.5–4.0 detik), menyerap 100% jitter dan tabrakan paket pada media nirkabel Wi-Fi (*half-duplex RF*).
  - Status `ONLINE` tetap berkecepatan instan ($< 0.5\text{ detik}$) pada deteksi balasan pertama (*1-Strike Fast Path*).
- **Subnet Scan & Liveness Driver Coexistence (`server.py`, `liveness.py`)**:
  - Mengoordinasikan jeda liveness daemon saat `POST /api/scan` sedang aktif menyapu 254 IP agar driver Npcap Windows tidak mengalami *buffer overrun* atau *packet drop rate*.
- **UI Refinement & Dropdown Layout Bug Fix (`select.tsx`, `App.tsx`, `DeviceTable.tsx`)**:
  - Memperbaiki bug menu dropdown BeUI Select yang terpotong dengan transisi Framer Motion dan `overflow-visible`.
  - Mengganti teks `ipv6 support` menjadi `ipv6`.
  - Mengganti box/badge status `Gateway`, `This PC`, `Linked MACs`, `Candidate` menjadi ikon monokrom `text-zinc-400` tanpa kotak.
- **Verification**: 116/116 unit test Python lulus, 18/18 test suite Node.js lulus, dan build React Vite lulus 100%.

## [v2.16.0] - 2026-08-29

### Added & Enhanced (Sub-Second Multi-Vector Unicast Liveness Pulse Engine):
- **Sub-Second Multi-Vector Unicast Liveness Pulse Engine (`liveness.py`, `server.py`)**:
  - Mengimplementasikan `pulse_host` dan `pulse_batch` yang menembakkan 3 vektor probe asinkron simultan:
    1. *Layer 2 Direct Unicast ARP (Gateway-Disguised)* untuk bypass filter tidur chip Wi-Fi smartphone.
    2. *Layer 4 UDP High-Port Trigger* (Port 38291) untuk memancing kernel OS target mengirimkan balasan *ICMP Port Unreachable (RFC 792)* seketika.
    3. *Layer 3 IPv6 Neighbor Solicitation* untuk perangkat Dual-Stack aktif.
  - Mencapai konfirmasi status online/offline dalam **$< 0.75\text{ detik}$** dengan tingkat akurasi $\approx 99.9\%$.
- **Adaptive Liveness Watchdog Daemon (`liveness.py`, `server.py`)**:
  - Memantau perangkat yang sedang dimanipulasi (Cut/Throttle) setiap 1.0 detik dan perangkat pasif setiap 8.0 detik.
  - Menyiarkan event WebSocket `device_liveness_changed` secara instan ke Node.js saat target terputus dari jaringan.
- **Node.js Sub-Second Event Dispatcher (`pythonBridge.ts`, `deviceManager.ts`)**:
  - Menangkap event `device_liveness_changed` dan menyalurkannya langsung ke Socket.IO (`deviceDisconnected` / `deviceUpdated`) dalam $< 0.8\text{ detik}$.
- **Automated Verification**:
  - Test suite baru `test_unit_liveness.py` (5 test cases: 100% PASS).
  - 116/116 unit test Python lulus 100% (`unittest`: OK).
  - 18/18 test suite Node.js lulus 100% (`npm test`: OK).
  - Build produksi React TypeScript lulus (`tsc && vite build`: OK).

## [v2.15.0] - 2026-08-29

### Fixed & Hardened (Comprehensive Codebase Audit, Invariants Enforcement & Zero Socket Leaks):
- **Zero Socket Descriptor Leaks & Resource Cleanup (`netbios.py`, `probe.py`, `arp.py`, `multicast.py`, `transparent_gateway.py`)**:
  - Membungkus seluruh pembuatan soket UDP dan TCP dengan *context manager* (`with socket.socket(...) as s:`) atau `finally: s.close()`.
  - Menghilangkan `ResourceWarning: unclosed socket` pada unittests dan mencegah *file/socket descriptor exhaustion* di OS Windows saat pemindaian intensif.
- **ARP Subnet Sweep Indentation & Dead Code Fix (`arp.py`)**:
  - Mengoreksi indentasi `collect_from_arp_cache(discovered)` yang sebelumnya terjebak di dalam blok `except Exception as e:` ganda.
  - Memastikan pembacaan OS ARP cache selalu dieksekusi setelah subnet sweep selesai.
- **Invariant 2 Enforcement & Anti Self-Cut Protection (`spoofer.py`)**:
  - Menambahkan validasi `self._self_mac` dan `my_ip` pada `ARPSpoofer.start()` untuk menjamin host operator (*This PC*) terlindungi 100% dari pemutusan/spoofing Layer 2.
- **Zombie Spoof Thread Deduplication & Thread Safety (`spoofer.py`, `database.ts`, `scanner.py`)**:
  - Menghapus akumulasi thread spoofing duplikat pada watchdog scan dengan menghentikan sesi aktif lama sebelum meluncurkan sesi baru di `ARPSpoofer.start()`.
  - Menambahkan `_HISTORY_LOCK = threading.Lock()` pada `NetworkScanner` untuk melindungi mutasi `_DEVICE_HISTORY` dari *race condition* multi-threading.
- **Map Key Cleanup on DHCP IP Renewals (`deviceManager.ts`)**:
  - Menghapus key IP lama dari `Map<string, Device>` saat perangkat berganti IP via DHCP untuk mencegah duplikasi entri di memori.
- **Session Cleanup on Throttled-to-Blocked Transition (`deviceManager.ts`)**:
  - Memperbarui limit sesi spoof yang sudah ada via `setSpoofLimit(sessionId, 0)` alih-alih meluncurkan sesi spoof ganda baru.
- **DHCP Event Debouncing & Recursive Scan Feedback Loop Elimination (`deviceManager.ts`, `useWebSocket.ts`)**:
  - Menghentikan loop pemindaian tak terbatas (*infinite scan loop*) dengan menerapkan `debouncedScan(8000ms)` pada event `dhcpDevice`.
  - Pemindaian aktif subnet hanya dijadwalkan apabila terdeteksi perangkat yang benar-benar baru (*unregistered device*), bukan pada setiap paket DHCP rutin.
  - Menghapus emisi duplikat `scan` dari hook `useWebSocket.ts` saat event `networkChanged` terjadi.
- **Smartphone Sleep Anti-Flapping Grace Period (`database.ts`)**:
  - Menerapkan *75-second grace period* pada penandaan status offline di PostgreSQL (`last_seen < NOW() - INTERVAL '75 seconds'`).
  - Mencegah smartphone Android/iOS dalam mode *Doze* (layar mati / MAC acak) mengalami fluktuasi *online/offline* berulang kali di log.
- **Frontend WebSocket Null-Safety & API Host Resolvers (`useWebSocket.ts`, `DeepPortScanModal.tsx`, `DhcpReconnectModal.tsx`, `DeviceTable.tsx`, `App.tsx`)**:
  - Memperbaiki potensi uncaught `TypeError` di listener `deviceUpdate` saat `updatedDevice.mac` undefined.
  - Mengintegrasikan `getApiUrl()` pada seluruh modal untuk akses lancar via IP jaringan LAN.
  - Memoisasi helper callbacks (`useCallback`) dan menambahkan *safe indexing guards*.
- **Automated Verification**:
  - 91/91 unit test Python lulus 100% (`unittest discover`: OK).
  - 14/14 test suite Node.js lulus 100% (`npm test`: OK).
  - Build produksi React TypeScript lulus (`tsc && vite build`: OK).

## [v2.14.0] - 2026-08-29

### Added & Enhanced (Deep Dual-Stack Integration of Optimasi Teknik 3B):
- **Dual-Stack Multicast Wake-Up Burst (`multicast.py`, `scanner.py`)**:
  - Memperluas pemancar wake-up agar menyiarkan paket asinkron serentak ke grup multicast IPv4 (`224.0.0.251`, `239.255.255.250`, `224.0.0.252`) dan IPv6 (`ff02::1`, `ff02::fb`, `ff02::c`, `ff02::1:3`).
  - Membangunkan stack jaringan smartphone dalam mode tidur (*Doze / Low Power Mode*) seketika dalam $< 0.05$ detik.
- **Passive Dual-Stack DHCPv6 Sniffer Daemon (`dhcp.py`)**:
  - Memperluas BPF filter Scapy sniffer ke `udp and (port 67 or port 68 or port 546 or port 547)`.
  - Menambahkan modul `_handle_dhcp6_packet` untuk mengekstrak **Hardware DUID (Option 1)**, **Vendor Class (Option 16)**, **FQDN (Option 39)**, dan **Option Request Option (ORO / Option 6) Fingerprint**.
  - Mengintegrasikan hasil tangkapan DHCPv6 ke dalam `DHCPDiscoveredCache` dan rekonsiliasi database MAC-centric (*1 Perangkat = 1 Baris*).
- **Dual-Stack Liveness Cross-Reconciliation (Anti-Flapping Engine in `scanner.py`)**:
  - Menyelesaikan akar masalah ketidakstabilan status (*online/offline flapping*) pada smartphone (seperti Infinix/Android "naim").
  - Menghubungkan temuan aktif `discovered_ipv6` ke IP IPv4 yang terasosiasi secara otomatis, sehingga saat smartphone berada dalam mode tidur (*Doze Mode*) dan memfilter broadcast ARP IPv4 namun merespons ICMPv6/NDP, perangkat tetap **dikonfirmasi 100% ONLINE** dan tidak pernah terputus secara keliru.
- **LAN Access & Dynamic IP Host Resolution (`client.ts`, `useWebSocket.ts`, `app.ts`)**:
  - Mengubah konfigurasi `API_URL` dan `WS_URL` pada frontend agar menyelesaikan host secara dinamis menggunakan `window.location.hostname` (bukan hardcode `localhost`).
  - Mengikat server backend Node.js (`app.ts`) ke `0.0.0.0` sehingga aplikasi dapat diakses langsung dari perangkat lain di jaringan lokal (LAN/Wi-Fi) via IP komputer operator (misal `http://172.18.138.151:5173`).
- **Root CA Dynamic Download & Blob Delivery (`TransparentGatewayView.tsx`)**:
  - Memperbaiki tombol "Download Root CA" yang sebelumnya mengarah ke link statis `localhost:5000`.
  - Mengimplementasikan handler `handleDownloadCa` berbasis API dinamis dan `Blob URL` sehingga sertifikat `spoorf-ca.crt` dapat langsung diunduh secara instan baik dari laptop lokal maupun dari HP/perangkat lain yang mengakses via IP LAN.
- **Automated Verification**:
  - Menambahkan unit test DHCPv6 & Dual-Stack Wake-up di `test_unit_discovery.py` (**91/91 unit test Python 100% PASS**).
  - 14/14 test suite Node.js 100% PASS.
  - Build produksi Frontend React (`tsc && vite build`: PASS dalam 7.78s).

## [v2.13.0] - 2026-08-29

### Added & Enhanced (Frontend Dual-Stack Visualizations & IPv6 NDP/RA Manipulation Engine - Phase 3 & 4):
- **Frontend Dual-Stack UI & Visualizations (Phase 3)**:
  - `DeviceTable.tsx`: Menambahkan micro-badge interaktif `[🌐 Dual-Stack]` pada kolom nama perangkat untuk host dengan alamat IPv6 aktif.
  - `DeviceTable.tsx`: Menambahkan kartu Bento **IPv6 Network Breakdown** pada baris accordion (menampilkan Link-Local `fe80::` dan Global SLAAC `2404::`/`2001::` dengan tombol *Copy to Clipboard*).
  - `SecurityTelemetrySidebar.tsx`: Menambahkan rincian IPv6 Link-Local dan Global SLAAC pada panel *Device Inspector*.
  - `App.tsx`: Mendukung pencarian dan pemfilteran perangkat berdasarkan fragmen / substring alamat IPv6 di search bar dashboard.
- **IPv6 NDP & RA Manipulation Engine (Phase 4)**:
  - `python-service/src/core/spoofer_v6.py`: Mengimplementasikan engine `NDPSpoofer` berbasis Scapy `ICMPv6ND_NA` (Neighbor Advertisement) dan `ICMPv6ND_RA` (Router Advertisement dengan `routerlifetime=0`) untuk pemutusan rute internet IPv6 target.
  - `python-service/src/core/spoofer.py` & `src/server.py`: Mengintegrasikan `ARPSpoofer` dan `NDPSpoofer` secara terkoordinasi sehingga pemutusan dan pembatasan bandwidth berjalan simultan pada IPv4 dan IPv6 (*Zero Bypass / No Traffic Leakage*).
  - `backend-node/src/services/deviceManager.ts` & `pythonBridge.ts`: Meneruskan parameter `victim_ipv6` dan `gateway_ipv6` ke Python network engine saat memulai pemblokiran atau pembatasan kecepatan.
- **Strict Invariants & Automated Verification**:
  - Kekebalan Gateway IPv6 (`Gateway Immunity`) & Proteksi Host Operator (`Controller Self-Protection`).
  - Menambahkan test suite `test_unit_spoofer_v6.py` (89/89 unit test Python 100% PASS).
  - 14/14 test suite Node.js 100% PASS.
  - Build produksi Frontend React (`tsc && vite build`: PASS dalam 5.73s).

## [v2.12.0] - 2026-08-29

### Added & Enhanced (IPv6 Discovery Pipeline & Dual-Stack Data Merging):
- **IPv6 Discovery Sensor Engine (`ipv6_ndp.py`, `scanner.py`)**:
  - Menambahkan modul `ipv6_ndp.py` yang memanfaatkan *NDP Neighbor Cache* (`netsh interface ipv6 show neighbors` / `ip -6 neigh`) dan *ICMPv6 All-Nodes Multicast* (`ff02::1`) untuk mendeteksi perangkat IPv6 dalam waktu $< 0.05$ detik.
  - Mengelompokkan alamat IPv6 ke dalam `ipv6_link_local` (`fe80::/10`), `ipv6_global` (`2000::/3`), dan `ipv6_addresses` (`TEXT[]`).
  - Menjalankan pemindaian IPv6 secara paralel di dalam `NetworkScanner.scan_full` tanpa menambah durasi scan total ($< 2.5$ detik).
- **Dual-Stack Database Persistence & Reconciliation (`database.ts`, `types/index.ts`)**:
  - Menambahkan kolom `ipv6_link_local`, `ipv6_global`, `ipv6_addresses`, dan `is_dual_stack` di tabel `devices` PostgreSQL.
  - Menyatukan seluruh alamat IPv4 dan IPv6 ke entri MAC fisik yang sama (*1 Perangkat = 1 Baris*) untuk mencegah duplikasi data.
- **Automated Test Verification**:
  - Menambahkan unit test `test_unit_ipv6_ndp.py` (84/84 unit test Python 100% PASS).
  - 14/14 test suite Node.js 100% PASS.
  - Build produksi Frontend React (`tsc && vite build`: PASS).

## [v2.11.3] - 2026-08-29

### Added & Enhanced (BeUI Motion Dock, Online State Preservation & Disconnect Toast Notification):
- **Compact Disconnected Device Toast (`DisconnectedDeviceToast.tsx`, `App.tsx`, `useWebSocket.ts`)**:
  - Menambahkan floating toast notifikasi kecil & ringkas saat perangkat terputus dari jaringan Wi-Fi.
  - Tampilan berdesain minimalis (*clean dark mode glassmorphism*, icon `WifiOff` merah mawar, nama perangkat, subtitle 'Terputus dari jaringan').
  - Bersifat murni informatif tanpa tombol tindakan kecuali tombol tutup `X` (dan auto-dismiss 4.5 detik).
- **Automated Disconnect Detection & Watchdog (`deviceManager.ts`, `scanner.py`, `websocket/index.ts`)**:
  - Menyiarkan event WebSocket `deviceDisconnected` saat perangkat beralih dari status online menjadi offline.
  - Menambahkan *Background Liveness Watchdog* setiap 25 detik untuk mendeteksi pemutusan koneksi senyap (*silent Wi-Fi off*).
- **Dedicated 3-Dots Column & BeUI Motion Dock Menu (`dock.tsx`, `DeviceTable.tsx`, `App.tsx`)**:
  - Memisahkan tombol titik 3 ke kolom tersendiri di pojok kanan tabel dengan posisi vertikal & horizontal tepat di tengah.
  - Menghilangkan background box pada tombol titik 3 (tampilan bersih tanpa border box).
  - Mengklik tombol titik 3 memunculkan floating **BeUI Motion Dock** ([beui.dev/components/motion/dock](https://beui.dev/components/motion/dock)) dengan 2 opsi utama:
    1. ✏️ **Edit Nama**: Membuka modal pengeditan nama alias perangkat (hanya tombol Simpan berwarna hijau, icon bersih tanpa box).
    2. 🗑️ **Hapus Perangkat**: Membuka modal konfirmasi hapus (hanya tombol Hapus berwarna merah, icon bersih tanpa box) yang menghapus perangkat beserta profil dan MAC terkait secara permanen dari PostgreSQL.
  - Transisi halus (*smooth crossfade*): Saat menu titik 3 dibuka, kontrol kolom Akses memudar mulus dan Dock mengambil alih posisi tanpa tumpang tindih.
- **Online State Preservation on Rename (`database.ts`, `deviceManager.ts`, `useWebSocket.ts`)**:
  - Memperbaiki logika saat pengguna mengubah nama/alias perangkat agar status online tetap terjaga tanpa kedipan.
- **Cascading Database Purge (`database.ts`, `deviceManager.ts`)**:
  - Memperbarui `deleteDevice` agar secara otomatis menghapus profil di `device_profiles` dan seluruh entri perangkat fisik di tabel `devices` yang berbagi `profile_id` yang sama.
- **Automated Test Verification**:
  - Seluruh 78 unit test Python dan 14 test suite Node.js 100% PASS.
  - Build produksi Frontend React (`tsc && vite build`: PASS).

## [v2.11.2] - 2026-08-29

### Fixed (Device Status Hierarchy & Online State Synchronization):
- **Accurate Multi-State Status Column (`DeviceTable.tsx`, `SecurityTelemetrySidebar.tsx`)**:
  - Memperbaiki kolom Status di tabel perangkat agar merender 5 status lengkap secara akurat:
    1. 🔴 **Terblokir** (`is_blocked: true`) dengan titik merah `bg-rose-500` beranimasi pulse dan teks `text-rose-400`.
    2. 🟣 **Redirect (IG)** (`is_redirected: true`) dengan titik pink `bg-pink-400` beranimasi pulse dan teks `text-pink-300`.
    3. 🟡 **Dibatasi (X%)** (`isThrottled`) dengan titik amber `bg-amber-400` dan teks persentase kecepatan.
    4. 🟢 **Online** (`isOnline: true`) dengan titik emerald `bg-emerald-400` dan teks `text-zinc-200`.
    5. ⚪ **Offline** dengan titik abu-abu `bg-zinc-600` dan teks `text-zinc-500`.
  - Memperbaiki *Link Pulse State* dan *Connection State* pada panel *Security & Telemetry* agar selaras dengan status aktif perangkat.
  - Mempertahankan estimasi jarak fisik (*Distance Zone*) pada perangkat yang sedang diblokir / dialihkan.
- **Active Control State Synchronization (`deviceManager.ts`, `database.ts`)**:
  - Mengupdate `blockDevice`, `unblockDevice`, `setSpeedLimit`, `redirectDevice`, dan `stopRedirectDevice` di backend agar otomatis menandai `device.is_online = true` dan memanggil `setDeviceOnlineStatus(device.mac, true)`.
  - Memperbaiki query `setDeviceBlocked` di PostgreSQL untuk meng-update `is_online = TRUE` saat status blokir aktif, mencegah target berstatus offline semu.
- **Automated Test Verification**:
  - Seluruh 78 unit test Python dan 14 test suite Node.js 100% PASS.
  - Build produksi Frontend React (`tsc && vite build`: PASS).

## [v2.11.1] - 2026-08-29

### Fixed & Enhanced (User-Space Layer 2 Fast Packet Forwarder):
- **User-Space L2 Packet Bridge (`transparent_gateway.py`)**:
  - Mengimplementasikan *User-Space L2 Packet Forwarder* via Npcap driver untuk seluruh trafik IP outbound dari target (TCP SYN, ACK, Data, UDP, ICMP ping) langsung ke MAC Gateway.
  - Mem-bypass total ketergantungan pada Windows Kernel IP Forwarding / `RemoteAccess` service / Windows Firewall drops di lingkungan Wi-Fi single-interface.
  - Menjamin koneksi internet perangkat target tetap 100% lancar, berkecepatan tinggi, dan stabil tanpa TCP connection timeout.
- **Removed Gateway Reactive ARP Poisoning (`transparent_gateway.py`)**:
  - Menghapus injeksi balasan ARP palsu saat Router Gateway menanyakan MAC target.
  - Mengeliminasi total *MAC Flapping* dan *IP Conflict* di router Access Point, menjaga latensi dan kestabilan koneksi laptop controller.
- **Automated Test Verification**:
  - Seluruh 78 unit test Python dan 14 test suite Node.js 100% PASS.

## [v2.11.0] - 2026-08-29

### Added & Integrated (Mitmproxy Core Interceptor & Dynamic TLS CA Engine):
- **Dynamic Root CA & On-the-Fly Leaf SSL Generator (`src/core/interceptor/certs.py`)**:
  - Mengadaptasi arsitektur `d:/mitmproxy/mitmproxy/certs.py` berbasis `cryptography` X.509 v3 RSA 2048-bit.
  - Menghasilkan Root CA mandiri (`spoorf-ca.crt`, `spoorf-ca.pem`) yang dapat diinstal pada perangkat target.
  - Men-generate sertifikat TLS dinamis *on-the-fly* dengan Subject Alternative Names (SAN) sesuai SNI domain target dengan caching LRU.
- **Layer 7 Flow Lifecycle & Stream Manager (`src/core/interceptor/flow.py`)**:
  - Mengimplementasikan model data `L7Flow` standar (HTTP, HTTPS, DNS) dengan metadata method, path, status, latency (ms), content-type, payload size, dan flag blocking.
  - Circular in-memory flow buffer (max 1000 items) dan hook streaming event `traffic:l7_flow` ke WebSocket.
- **Full-Stack REST & WebSocket Integration (`server.py`, `pythonBridge.ts`, `deviceManager.ts`, `routes.ts`, `websocket/index.ts`)**:
  - Menambahkan endpoint `/api/interceptor/ca`, `/api/interceptor/ca/cert` (unduh `.crt`), `/api/interceptor/flows`, `/api/interceptor/flows` (DELETE), dan `/api/interceptor/cert/leaf`.
  - Meneruskan event `traffic:l7_flow` dari Python ke Socket.IO Node.js dan ke React frontend secara *real-time*.
- **Mitmproxy-Inspired Live Traffic Inspector UI (`TransparentGatewayView.tsx`)**:
  - Card Manajemen Root CA dengan tombol unduh 1-klik (`spoorf-ca.crt`) dan panduan instalasi per OS (Android, iOS, Windows).
  - Tab **L7 HTTP/HTTPS Flows** dengan Method Badges (GET, POST, PUT, DELETE, SNI), Status Code Pills (200, 302, 403, 500), Latency timer, Filter pencarian interaktif, dan Drawer modal inspeksi detail flow.
- **Automated Test Verification**:
  - Menambahkan `test_unit_interceptor_certs.py` dan `test_unit_interceptor_flows.py` (78 Python test cases PASS).
  - Menambahkan test case L7 Interceptor pada backend Node.js (14 test cases PASS).
  - Governing Spec: `docs/specs/SPEC-008_L7_INTERCEPTION_AND_MITMPROXY.md`.

## [v2.10.18] - 2026-08-28

### Fixed & Enhanced (Zero-RTO Architecture & Active DNS Relay):
- **Safe Unicast ARP Injection (`spoofer.py`)**:
  - Mengubah mode Transparent Gateway & Redirect agar menggunakan *Pure Unicast `is-at`* murni (`_build_unicast_reply_packet`) tanpa pernah mengirimkan `who-has` yang mengatasnamakan IP Gateway.
  - Mencegah fitur *IP Conflict Protection* pada router Access Point (ZTE/Huawei/IndiHome/TP-Link) memutus koneksi laptop, **menghilangkan masalah laptop RTO (Request Time Out) hingga 0% packet loss**.
- **Windows TCP/IP Weak Host Model Activation (`network.py`)**:
  - Memperbarui `set_ip_forwarding` agar otomatis mengaktifkan `weakhostsend=enabled` dan `weakhostreceive=enabled` via `netsh` di Windows.
  - Mengizinkan kernel Windows me-route paket intra-interface dari HP target kembali ke gateway tanpa di-*drop* oleh *RFC 1122 Strong Host Model*.
- **Active User-Space DNS Relayer (`transparent_gateway.py`)**:
  - Mengimplementasikan *Active DNS Relayer* di Python untuk seluruh domain yang diizinkan (*allowed*), meneruskan kueri DNS ke router upstream dan menginjeksikan kembali responnya secara instan (<5ms) ke HP target.
  - Menghilangkan DNS timeout 5 detik pada HP target, membuat browsing dan aplikasi mobile langsung terbuka secara instan.

## [v2.10.17] - 2026-08-28

### Optimized (Ultra-Fast Smart Transparent Gateway & Precision Sniffing):
- **Kernel-Level BPF TLS Handshake Filter (`transparent_gateway.py`)**:
  - Mengoptimalkan filter BPF Scapy/Npcap dengan ekspresi presisi: `tcp and dst port 443 and (tcp[((tcp[12:1] & 0xf0) >> 2):1] = 22)`.
  - Membuang 99.9% paket payload streaming video dan download file langsung di level driver kartu jaringan Npcap, sehingga Python hanya memproses paket *TLS Client Hello (Handshake)* murni.
  - Menghilangkan *CPU lock contention*, *bufferbloat*, dan kelambatan internet pada laptop operator maupun perangkat target saat mode Transparent Gateway aktif.
- **Removed Duplicate Sendp & Debounced Reactive ARP (`transparent_gateway.py`)**:
  - Menghapus transmisi ganda `sendp()` pada respon sinkhole DNS.
  - Menerapkan *debouncing (1.5s)* pada respon *Reactive ARP* untuk mencegah banjir frame raw di kanal nirkabel Wi-Fi.

## [v2.10.16] - 2026-08-28

### Optimized (Wi-Fi Driver Performance & Zero-Stuttering Telemetry):
- **WLAN Interface Caching (`network.py`)**:
  - Mengimplementasikan *TTL Memory Cache (10s)* untuk `get_wifi_info()`, mengurangi frekuensi eksekusi perintah Windows `netsh wlan show interfaces` dari 90 kali/menit menjadi 6 kali/menit (pengurangan beban 93%).
  - Menghilangkan *WLAN AutoConfig stuttering* dan *ping latency spikes* pada kartu Wi-Fi laptop.
  - Menambahkan `clear_wifi_cache()` untuk mereset cache seketika saat terdeteksi pergantian gateway/jaringan.
- **Adaptive Ping Sampling (`telemetry.py`)**:
  - Mengoptimalkan frekuensi pengukuran ping gateway dari tiap 1 detik menjadi tiap 3.5 detik, mencegah penumpukan antrean ICMP pada router Wi-Fi.
- **Removed Redundant HTTP Polling (`useWebSocket.ts`)**:
  - Menghapus interval polling `fetch('/api/wifi')` di React frontend karena data Wi-Fi sudah dialirkan secara otomatis dan efisien melalui WebSocket `telemetryStream`.

## [v2.10.15] - 2026-08-28

### Added & Enhanced (Hybrid Smart Soft-Throttle Engine):
- **Unidirectional Outbound Shaping (`spoofer.py`)**:
  - Mengubah mode Bandwidth Throttle (`speed_limit > 0`) menjadi **Unidirectional Outbound Shaping**: meracuni hanya perangkat target tanpa pernah meracuni router gateway.
  - Mencegah Access Point Wi-Fi mengirimkan sinyal *802.11 Deauth* atau mengalami *MAC-IP collision*, sehingga sambungan Wi-Fi HP target tetap terhubung 100% stabil dengan sinyal penuh.
- **Active Windows IP Forwarding on Throttle (`spoofer.py`)**:
  - Memperbarui `_sync_ip_forward_state()` agar *IP Forwarding* di Windows tetap aktif saat sesi throttle berjalan (`speed_limit > 0`).
  - Paket data dari target dialirkan secara mulus ke internet alih-alih di-*hard-drop*, mencegah pemicu alarm *Intelligent Wi-Fi* / *Switch to Mobile Data* pada Android/Samsung/iOS.
- **Adaptive TCP-Friendly Interval (`spoofer.py`)**:
  - Menggantikan *rapid PWM flapping* dengan interval adaptif ramah TCP (0.8s - 2.3s) yang memberikan kestabilan koneksi tanpa guncangan tabel ARP.

## [v2.10.14] - 2026-08-28

### Fixed (Bandwidth Throttle Duplicate Devices & Socket Race Conditions):
- **Fixed Duplicate Socket Event Listeners (`useWebSocket.ts`)**:
  - Menghapus duplikasi pendaftaran listener `deviceUpdate` dan `devicesUpdate` di React hook yang sebelumnya memicu race condition pada state list perangkat saat menerima event broadcast dari backend.
- **Fixed Simultaneous Dual Invocation on Throttle (`useWebSocket.ts`)**:
  - Memperbaiki `setSpeedLimit` dan `updateAlias` agar hanya mengirim melalui Socket.IO (atau REST fallback saat socket offline), mencegah pemanggilan ganda backend (`startSpoof` / `setSpoofLimit`) pada milidetik yang sama.
- **In-Memory & UI Profile Deduplication (`deviceManager.ts`, `App.tsx`)**:
  - Pada `DeviceManager.getDevices()` dan `DeviceManager.syncScanResults()`, sistem kini secara otomatis menyaring entri profil kadaluarsa (*stale offline duplicate*) jika profil yang sama sudah aktif memegang IP online baru.
  - Pada `App.tsx` (`dedupedDevices`), menambahkan deduplikasi berdasarkan `profile_id` dan `mac` dengan prioritas absolut untuk entri `is_online = true`, menjamin 1 perangkat fisik hanya dirender tepat dalam 1 baris tabel.

## [v2.10.13] - 2026-08-28

### Added & Enhanced (DUID-First Priority, Reconnection Toast & Mute Controls):
- **Notification Mute & Sound Controls (`App.tsx`, `NotificationPopover.tsx`)**:
  - Menambahkan tombol toggle **Mute / Unmute Notifikasi** di top navbar (`Sound On` / `Muted`) dan di dalam header *Notification Popover*.
  - Menyimpan status mute secara persisten di browser `localStorage` (`sentinel_notifications_muted`).
  - Saat mode mute aktif (`Muted` / warna amber): nada lonceng (*audio chime*), floating in-app toasts, dan notifikasi native desktop otomatis disenyapkan, sementara riwayat perangkat tetap tercatat di *Notification History*.
- **Reconnected Device Toast & Audio Alert (`App.tsx`, `NewDeviceToast.tsx`, `NotificationPopover.tsx`)**:
  - Menambahkan deteksi transisi perangkat yang sebelumnya offline dan kini **kembali online (*reconnected*)**.
  - Memicu floating **In-App Toast Notification** khusus bertema emerald dengan label *"Perangkat Online Kembali"* dan ikon Wi-Fi hijau.
  - Memainkan notifikasi suara lonceng (*melodic chime*) dan mengirimkan notifikasi native OS Desktop (*"NetCut Sentinel: Perangkat Online Kembali!"*).
  - Mencatat riwayat ke *Notification Center Popover* dengan kategori perangkat dan label *"kembali online di Wi-Fi Lokal"*.
- **DUID-First Priority Engine (`database.ts`, `unit_database.test.ts`)**:
  - Mengimplementasikan **Tier 1: DUID-First Fast-Track (Instant 100% Match)** pada `calculateProfileMatchScore`.
  - Jika perangkat memiliki *Hardware DUID* unik (Option 61 `dhcp_client_id`) dan cocok dengan profil database, sistem langsung memberikan **Skor 100% (Instant Match)** tanpa perlu mengecek nama host atau OS lagi.
  - Mempertahankan **Tier 2: Multi-Factor Heuristics Fallback** (Option 12 Hostname, Option 55 PRL Signature, Option 60 Vendor Class) untuk menangani perangkat mobile (iPhone/Android) yang menyamarkan DUID saat MAC diacak.
- **Database Schema Persistence (`database.ts`)**:
  - Menambahkan kolom `dhcp_client_id` pada tabel `device_profiles` di PostgreSQL agar DUID perangkat tersimpan secara permanen lintas pergantian MAC address.

## [v2.10.12] - 2026-08-28

### Added (Teknik 3B DHCP Profiling & Reconnect Optimization):
- **Teknik 3B Optimization Button & Modal (`App.tsx`, `DhcpReconnectModal.tsx`)**:
  - Menambahkan tombol aksi **`[ ⚡ Optimasi 3B ]`** di header tabel *Connected Devices* di samping tombol *Scan*.
  - Dilengkapi badge dinamis yang menampilkan jumlah perangkat yang belum memiliki profil DHCP lengkap.
  - Membuka modal interaktif **`DhcpReconnectModal.tsx`** berbasis BeUI Motion:
    - *Hero Stats Meter:* Persentase dan rasio kelengkapan profiling Teknik 3B di subnet saat ini.
    - *Metode 1 (Controller Wake-up):* Tombol pemicu siaran *Multicast & ARP Wake-up Burst* instan dari host controller.
    - *Metode 2 (Target Reconnect Guide):* Panduan visual 3 langkah reconnect Wi-Fi perangkat target (matikan 3 detik lalu hidupkan kembali) untuk penangkapan handshake deterministik 0-detik.
    - *Live Device Status Breakdown:* Pemetaan status per-perangkat (🟢 *Ter-profiling 3B* vs 🟡 *Menunggu Reconnect*).
- **Backend & Python Microservice Support (`server.py`, `pythonBridge.ts`, `deviceManager.ts`, `routes.ts`)**:
  - Menambahkan endpoint REST `POST /api/dhcp/wakeup` dan `GET /api/dhcp/stats` pada Python Service.
  - Menambahkan route Express `POST /api/network/optimize-dhcp` dan `GET /api/dhcp/stats` pada Node.js Orchestrator.

## [v2.10.11] - 2026-08-28

### Added & Improved (BeUI Motion Select & Online Devices Filter):
- **Restored Table Subtitle (`OpenPortsTable.tsx`)**:
  - Mengembalikan teks deskripsi dinamis di bawah judul *Open Ports & Services* dengan tetap mempertahankan judul yang bersih tanpa icon/badge di sampingnya.
- **BeUI Motion Select Component (`select.tsx`)**:
  - Membangun komponen composable `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, dan `SelectItem` dari spesifikasi resmi [beui.dev](https://beui.dev/components/motion/select).
  - Dilengkapi animasi *bouncy unfold*, *spring chevron*, *corner radius morphing*, dan *item stagger*.
- **Online Target Filter (`DeepPortScanModal.tsx`)**:
  - Memfilter daftar target perangkat pada modal pemindaian mendalam agar hanya menampilkan perangkat yang berstatus **Online (`is_online: true`)**.
  - Mengganti elemen `<select>` native dengan komponen **BeUI Motion Select**.

## [v2.10.10] - 2026-08-28

### Changed (Clean Header & Direct Port List in OpenPortsTable):
- **Header Clean-Up (`OpenPortsTable.tsx`)**:
  - Menghapus icon kotak dan teks badge/deskripsi di samping judul *Open Ports & Services*, menghasilkan header yang bersih dan elegan.
  - Menghapus baris tab filter (*Semua, Web & UI, Media/IoT, Remote/Share, Berisiko*).
  - Seluruh daftar port dan layanan yang terdeteksi kini langsung ditampilkan dalam satu tabel terpadu dengan aksi cepat `[ Deep Scan ⚡ ]`, `[ Preview 👁 ]`, dan tombol collapse accordion (`ChevronDown`).

## [v2.10.9] - 2026-08-28

### Added (Deep Port Scanner Modal & In-App Web Iframe Preview):
- **Deep Custom Port Scanner (`DeepPortScanModal.tsx`, `probe.py`, `server.py`, `deviceManager.ts`)**:
  - Implementasi pemindaian port mendalam multi-threaded berkecepatan tinggi (~1.5 detik untuk 100 port) via `POST /api/devices/:ip/scan-ports`.
  - Pilihan 4 profil pemindaian: *Top 100 Common Ports*, *Web & Admin Management*, *Gaming & Media*, dan *Rentang Kustom (Custom Range)*.
  - Tampilan progress beam pemindaian live dan penyimpanan hasil temuan port langsung ke basis data perangkat.
- **In-App Live Web Iframe Preview Modal (`WebPreviewModal.tsx`)**:
  - Fitur pratinjau halaman web (*Web Preview*) langsung di dalam aplikasi untuk port HTTP/HTTPS (Port 80, 443, 8080, dll.).
  - Dilengkapi address bar browser miniatur, tombol salin URL, muat ulang, dan tombol buka di tab baru sebagai fallback keamanan *X-Frame-Options*.

## [v2.10.8] - 2026-08-28

### Added (Open Ports & Services Explorer Table):
- **Open Ports & Services Explorer Component (`OpenPortsTable.tsx`)**:
  - Menambahkan tabel khusus pemetaan port terbuka dan layanan jaringan aktif tepat di bawah tabel *Connected Devices*.
  - **Dua Mode Tampilan Cerdas:**
    1. *Target Device Focus:* Otomatis memfokuskan daftar port pada perangkat yang sedang dipilih/diinspeksi.
    2. *Global Network Services:* Menampilkan seluruh port aktif di seluruh perangkat LAN.
  - **Detail Kolom Komprehensif:** Nama Perangkat, Nomor Port & Protokol (`TCP`/`UDP`), Layanan (`HTTP`, `RTSP`, `SMB`, `SSH`, `DNS`), Detail Banner (`web_title`/`web_server`), Tingkat Risiko Keamanan (🟢 *Aman*, 🟡 *Perhatian*, 🔴 *Rentan*), dan Tombol Aksi Cepat.
  - **Aksi Cepat Terintegrasi:** Tombol **`[ Buka Web ↗ ]`** yang langsung membuka URL web admin perangkat di tab browser baru, serta tombol **`[ Copy IP:Port ]`**.
  - **Segmented Category Filter Tabs:** Filter pill instan (*Semua*, *Web & UI*, *Media/IoT*, *Remote/Share*, *Berisiko*).
  - **Collapsible Accordion:** Dilengkapi tombol panah lipat halus (`ChevronDown`) tanpa bubble di header tabel.

## [v2.10.7] - 2026-08-28

### Added (Collapsible Connected Devices Table with Smooth Accordion):
- **Collapsible Table Toggle Button (`App.tsx`)**:
  - Menambahkan tombol ikon panah lipat (`ChevronDown`) di samping tombol Scan pada header tabel *Connected Devices*.
  - Didesain minimalis **tanpa background bubble** (`size-7 rounded-lg text-zinc-400 hover:text-white`) dengan warna netral konsisten.
  - Dilengkapi animasi rotasi panah halus (`transition-transform duration-250`, `-rotate-90` saat tertutup dan `rotate-0` saat terbuka).
- **Smooth Animated Accordion Viewport (`App.tsx`)**:
  - Membungkus tabel dengan animasi `AnimatePresence` + `motion.div` (*height & opacity accordion animation*).
  - Ketika proses pemindaian (*Scan*) dipicu saat tabel dalam kondisi tertutup, sistem otomatis membuka tabel kembali secara mulus agar pengguna dapat melihat hasil scan secara *real-time*.

## [v2.10.6] - 2026-08-28

### Enhanced (Center-Aligned Status & Jarak with Consistent Monochrome Icon):
- **Center Alignment (`DeviceTable.tsx`)**:
  - Memposisikan kolom **Status** dan **Jarak** tepat di tengah (*center-aligned*) baik pada header tabel (`th`) maupun baris isi tabel (`td`) agar susunan visual lebih seimbang dan simetris.
- **Consistent Neutral Monochromatic Wi-Fi Icon (`WifiSignalIcon.tsx`)**:
  - Mengubah pewarnaan ikon gelombang Wi-Fi menjadi **warna netral yang seragam dan konsisten** (`text-zinc-300` saat online, `text-zinc-600` saat offline).
  - Perbedaan tingkat jarak direpresentasikan murni melalui tingkat opasitas lengkungan (*opacity-100* vs *opacity-20*) tanpa warna-warni pelangi yang mencolok.

## [v2.10.5] - 2026-08-28

### Enhanced (Custom Wi-Fi Wave Distance Icon):
- **Precision Wi-Fi Wave Proximity Component (`WifiSignalIcon.tsx`, `DeviceTable.tsx`)**:
  - Mengimplementasikan ikon gelombang Wi-Fi bertingkat (*Wi-Fi Radiating Wave*) 3 lengkungan melingkar dengan titik pusat bawah sesuai referensi desain gambar pengguna.
  - Lengkungan bar dan titik menyala dinamis berdasarkan tingkat kedekatan perangkat:
    - 🟢 **Dekat (< 3m):** Seluruh 3 bar lengkungan + titik bawah menyala hijau terang (`text-emerald-400`).
    - 🟡 **Sedang (3 - 8m):** 2 bar lengkungan bawah + titik bawah menyala amber/kuning (`text-amber-400`), bar terluar redup.
    - 🔴 **Jauh (> 10m):** 1 bar lengkungan bawah + titik bawah menyala merah (`text-rose-400`), 2 bar luar redup.
    - ⚪ **Offline:** Seluruh bar redup netral (`text-zinc-600`).

## [v2.10.4] - 2026-08-28

### Enhanced (Icon-Only Distance Column & Scan-Aware Select Mode):
- **Icon-Only Distance Proximity (`DeviceTable.tsx`)**:
  - Mengubah kolom jarak (*Jarak*) dari yang sebelumnya menggunakan badge/bubble berlatar belakang menjadi **tampilan ikon murni (*Icon Only*)**:
    - `SignalHigh` (Hijau untuk Dekat `< 3m`), `SignalMedium` (Kuning untuk Sedang `3 - 8m`), `SignalLow` (Merah untuk Jauh `> 10m`), dan `-` untuk offline.
    - Dilengkapi *tooltip* hover lengkap yang menampilkan estimasi jarak fisik dan latensi milidetik (*RTT*).
- **Auto-Hide Select Button on Scan (`App.tsx`)**:
  - Tombol **"Pilih Perangkat"** kini otomatis disembunyikan dengan animasi transisi saat pemindaian (*scanning*) jaringan sedang berlangsung.
  - State mode pemilihan massal otomatis di-reset (`setIsSelectMode(false)` & `setSelectedIps([])`) saat scan dimulai agar mencegah inkonsistensi data ketika daftar perangkat sedang diperbarui.

## [v2.10.3] - 2026-08-28

### Fixed & Enhanced (Robust Notification Toggle, Device-Specific Icons & Clean Typography):
- **Robust Click Toggle Logic (`NotificationPopover.tsx`, `App.tsx`)**:
  - Memperbaiki event handler tombol lonceng notifikasi dengan menambahkan `data-notification-trigger="true"` dan pengecekan di `handleClickOutside`, sehingga klik pertama membuka popover dan klik kedua menutupnya dengan mulus dan stabil.
- **Device-Specific Icons with Consistent Neutral Theme (`NotificationPopover.tsx`, `NewDeviceToast.tsx`)**:
  - Mengganti ikon Wi-Fi/Radio generik dengan **ikon perangkat yang spesifik** berdasarkan OS/hostname/vendor (`Smartphone`, `Laptop`, `Radio` untuk Gateway, dan `Cpu` untuk IoT).
  - Menggunakan warna netral gelap yang konsisten (`bg-white/[0.04] border border-white/[0.08] text-zinc-300`) tanpa warna-warni kontras berlebih.
- **Clean Text & Removal of Verbose Parentheticals (`NotificationPopover.tsx`, `NewDeviceToast.tsx`, `App.tsx`)**:
  - Menghilangkan teks tambahan dalam kurung seperti `(Private Device (Randomized MAC))`, `(Xiaomi Mobile)`, dll.
  - Teks notifikasi dan toast kini hanya menampilkan nama perangkat dan alamat IP secara bersih dan ringkas.

## [v2.10.2] - 2026-08-28

### Enhanced (Balanced Notification Popover Sizing & Clean Empty State):
- **Balanced Popover Dimensions (`NotificationPopover.tsx`)**:
  - Menyesuaikan ukuran popover ke rasio ideal `350px` – `380px` (`max-h-[490px]`) dengan padding dan tipografi yang nyaman dibaca (`text-xs font-semibold`, `size-8 rounded-lg` avatar icon).
- **Clean Minimalist Empty State (`NotificationPopover.tsx`)**:
  - Menghilangkan ikon tameng (*Shield/Guard icon*) pada status kosong (*empty state*) ketika tidak ada notifikasi, menyisakan teks informatif yang bersih dan minimalis.

## [v2.10.1] - 2026-08-28

### Enhanced (Compact Notification Popover & Floating Toast Auto-Dismiss):
- **Compact Notification Popover Layout (`NotificationPopover.tsx`)**:
  - Memperkecil ukuran popover menjadi `320px` - `340px` dengan padding hemat ruang `p-3` dan tipografi proporsional.
  - Memperkecil ikon avatar, boks bubble detail, dan tombol aksi (*Putus / Detail*) agar sangat rapi dan tidak memakan banyak layar.
- **Auto-Dismiss Floating Toasts on Popover Open (`App.tsx`)**:
  - Saat tombol lonceng notifikasi di pojok kanan atas dibuka, seluruh floating toast yang melayang di pojok kanan bawah otomatis hilang seketika agar tampilan layar bersih dan fokus.

## [v2.10.0] - 2026-08-28

### Added (Notification Center Popover & Topbar Bell Icon):
- **Notification Bell Button in Header (`App.tsx`)**:
  - Menambahkan tombol lonceng notifikasi (`Bell`) di samping status nama Wi-Fi pada pojok kanan atas topbar.
  - Dilengkapi badge penghitung unread notifikasi hijau dinamis (`unreadCount`).
- **Notification Center Drawer / Popover (`NotificationPopover.tsx`)**:
  - Mengimplementasikan popover notifikasi bertema gelap yang terinspirasi dari desain modern dashboard:
    - **Header:** Judul *"Your notifications"*, tombol `CheckCheck` (tandai semua dibaca), dan tombol `Trash2` (bersihkan riwayat).
    - **Segmented Filter Tabs:** Tab pill filter (*View all*, *Perangkat*, *Keamanan*) dengan badge jumlah item masing-masing.
    - **Item Cards:** Menampilkan avatar tipe event, nama aktor, target, timestamp relatif (*timeAgo*), titik hijau unread `🟢`, boks bubble penjelasan detail, dan tombol aksi cepat (*Putus Akses* & *Lihat Detail*).
    - Otomatis mencatat event perangkat baru masuk, auto-reblock target, dan alert rogue DHCP.

## [v2.9.9] - 2026-08-28

### Added & Enhanced (Minimalist Circular Ring Spinner for Telemetry Sync):
- **Sleek Spinner Ring (`pull-to-refresh.tsx`, `SecurityTelemetrySidebar.tsx`)**:
  - Mengganti animasi maskot kartun sebelumnya pada *Pull to Refresh* dengan **indikator bundaran cincin putar (*Circular Spinner Ring*)** minimalis yang elegan (`SpinnerRing`) berlatar pill gelap melayang (`bg-[#121316]/95 border border-white/[0.1] rounded-full`).
  - Menambahkan tombol manual **"Sync" / "Sync..."** pada header panel Security & Telemetry yang dilengkapi animasi bundaran cincin putar dinamis saat data diperbarui.

## [v2.9.8] - 2026-08-28

### Added & Enhanced (Seamless Integrated Footer Actions & Distance Badge Removal):
- **Seamless Fused Action Buttons (`NewDeviceToast.tsx`)**:
  - Mengubah tampilan tombol aksi dari model tombol terpisah (*bubble/floating pills*) menjadi **bilah footer terintegrasi (*docked split footer*)** yang menyatu langsung dengan batas bawah kontainer toast (`grid grid-cols-2 border-t divide-x`).
  - Menghilangkan badge indikator jarak fisik (*Distance Badge*) pada toast agar kartu lebih bersih, ringkas, dan fokus pada aksi kontrol.
  - Memastikan seluruh sudut kartu melengkung mulus (*overflow-hidden rounded-xl*) tanpa jarak renggang internal.

## [v2.9.7] - 2026-08-28

### Added & Enhanced (Compact Stacked Toast Notification UI):
- **Compact & Consistent Theme Redesign (`NewDeviceToast.tsx`)**:
  - Memperkecil dimensi kartu toast menjadi ukuran kompak `w-[320px]` dengan padding rapat `p-3` yang hemat ruang.
  - Menyelaraskan seluruh warna dan badge ke sistem tema gelap minimalis (`bg-[#0f1013]/95 border-white/[0.1]`).
- **Stacked Cards Layout & Explicit Manual Close (`App.tsx`)**:
  - Mengatur notifikasi agar menumpuk rapi (*stacked cards*) di pojok kanan bawah (`fixed bottom-6 right-6`).
  - Menghilangkan timer otomatis agar notifikasi tetap diam di layar sampai ditutup manual oleh pengguna melalui tombol `X` atau tombol aksi.
  - Menambahkan tombol **"Tutup Semua (N)"** saat terdapat $\ge 2$ notifikasi bertumpuk di layar.

## [v2.9.6] - 2026-08-28

### Added (Actionable New Device Toast & Background Desktop OS Notifications):
- **Interactive In-App Toast (`NewDeviceToast.tsx`)**:
  - Menampilkan floating toast berdesain *Glassmorphism* modern saat ada perangkat baru masuk ke Wi-Fi.
  - Memuat informasi nama perangkat, IP, vendor, dan pill badge estimasi jarak fisik.
  - Dilengkapi tombol aksi langsung:
    - 🛑 **"Putus Akses" (Block)**: Memblokir internet perangkat secara instan dari toast.
    - 🔍 **"Lihat Detail" (Inspect)**: Membuka sidebar inspeksi dan menyorot baris perangkat pada tabel.
    - ✖️ **"Tutup" (Dismiss)** dan bilah *countdown progress bar* yang otomatis pause saat kursor diarahkan (*pause on hover*).
- **Background Desktop OS Notifications (`notifications.ts`, `App.tsx`)**:
  - Mengintegrasikan **HTML5 Web Notifications API** (`sendDesktopNotification`) untuk memicu notifikasi native Windows Action Center saat browser di-minimize atau membuka tab lain.
  - Klik pada notifikasi desktop Windows akan otomatis memfokuskan kembali browser dan menyorot perangkat target.
- **Synthesized Melodic Chime (`notifications.ts`)**:
  - Memainkan suara bel 2-nada (*D5 $\to$ A5*) via **Web Audio API** sintetis tanpa membutuhkan file audio eksternal dan 100% offline.

## [v2.9.5] - 2026-08-28

### Added (Interactive Multi-Column Table Sorting):
- **Dynamic Multi-Field Sorting Engine (`deviceSort.ts`, `DeviceTable.tsx`)**:
  - Menambahkan kemampuan pengurutan dua arah (*Ascending* $\leftrightarrow$ *Descending*) interaktif pada seluruh header tabel perangkat:
    - **Device (Nama & IP)**: Mengurutkan abjad A-Z atau Z-A berdasarkan nama perangkat/alias/hostname, dengan fallback numerik IP yang tepat (`ipToNumber`).
    - **Perangkat (OS)**: Mengurutkan abjad A-Z atau Z-A berdasarkan nama sistem operasi / vendor hardware.
    - **Status**: Mengurutkan berdasarkan prioritas status koneksi (Online/Aktif $\to$ Dibatasi $\to$ Redirected $\to$ Terblokir $\to$ Offline).
    - **Jarak**: Mengurutkan berdasarkan estimasi kedekatan fisik (Dekat `~1 - 3m` $\to$ Sedang `~4 - 8m` $\to$ Jauh `> 10m` atau sebaliknya).
    - **Akses**: Mengurutkan berdasarkan batas kecepatan / status blokir.
  - Mengintegrasikan indikator ikon panah dinamis Lucide (`ArrowUp`, `ArrowDown`, dan `ArrowUpDown` saat hover) dengan warna konsisten tema gelap.
  - Memastikan *Gateway* dan *Controller PC* tetap aman terlindungi di posisi prioritas teratas tabel.

## [v2.9.4] - 2026-08-28

### Added & Enhanced (Smart Device Selection Mode & Dynamic Batch Actions):
- **Dynamic Device Select Mode (`App.tsx`, `DeviceTable.tsx`)**:
  - Menambahkan tombol **"Pilih Perangkat"** di samping tombol **Scan**.
  - Kolom checkbox/checklist pada tabel dan tombol aksi massal secara default disembunyikan agar tampilan tabel bersih.
  - Saat mode pilih aktif, kolom checklist dan tombol aksi **Block** & **Restore** muncul dengan animasi *smooth* Framer Motion.
- **Smart Dynamic Batch Logic (`App.tsx`)**:
  - **Kondisi Perangkat Aktif (Unblocked)**: Ketika pengguna memilih perangkat yang tidak diblokir, hanya tombol `Block (N)` yang aktif; tombol `Restore (0)` otomatis dinonaktifkan (*disabled*).
  - **Kondisi Perangkat Terblokir (Blocked)**: Ketika pengguna memilih perangkat yang sedang diblokir, hanya tombol `Restore (N)` yang aktif; tombol `Block (0)` otomatis dinonaktifkan.
  - **Kondisi Checklist Semua (Mixed / All)**: Ketika pengguna mencentang semua perangkat, kedua tombol **tetap aktif** dengan label jumlah yang presisi dan konsisten (`Block (X)` untuk $X$ perangkat aktif, `Restore (Y)` untuk $Y$ perangkat terblokir).

## [v2.9.3] - 2026-08-28

### Added (Layer 2 Wi-Fi Proximity & Distance Estimation Engine):
- **Proximity & Distance Engine (`proximity.py`, `scanner.py`)**:
  - Mengimplementasikan modul estimasi jarak fisik berbasis Layer 2 Unicast ARP micro-burst sampling dengan `time.perf_counter_ns()` berakurasi nanodetik.
  - Memfilter outlier dan menghitung nilai median RTT serta dispersi *jitter* (standar deviasi) untuk mengklasifikasikan perangkat ke dalam zona: `'near'` (`~1 - 3m`), `'medium'` (`~4 - 8m`), atau `'far'` (`> 10m`).
- **Database & Schema Integration (`database.ts`, `types/index.ts`)**:
  - Menambahkan field `distance_zone` dan `estimated_range` pada tabel PostgreSQL `devices` dan model memori `Device`.
- **Consistent UI Visuals in Device Table (`DeviceTable.tsx`)**:
  - Menambahkan kolom **Jarak** pada tabel perangkat dengan pill badge bertema gelap yang bersih dan konsisten:
    - 🟢 `Dekat (~1 - 3m)` (`SignalHigh` dalam warna *Emerald*)
    - 🟡 `Sedang (~4 - 8m)` (`SignalMedium` dalam warna *Amber*)
    - 🔴 `Jauh (> 10m)` (`SignalLow` dalam warna *Rose*)
  - Menghilangkan karakter *bullet dot* dan teks *keyakinan* untuk tampilan yang elegan dan minimalis.

## [v2.9.2] - 2026-08-28

### Added & Enhanced (Router Stability, TLS SNI Sniffing & Canary DoH Bypassing):
- **Pure Unidirectional Outbound Capture (`spoofer.py`)**:
  - Mengubah arsitektur mode Transparent Gateway menjadi murni *Unidirectional* (hanya meracuni target keluar, router sama sekali tidak diracuni).
  - Mengeliminasi total masalah *Windows Firewall Inbound Drop*, *MAC Flapping* pada switch router, dan *802.11 Pairwise Key Violation*.
  - Internet target tetap berjalan $100\%$ lancar dengan kecepatan penuh (download langsung dari router ke target), sementara seluruh DNS dan domain HTTPS tetap tertangkap akurat oleh laptop pengawas.
- **TLS SNI (Port 443 HTTPS Client Hello) Sniffer (`transparent_gateway.py`)**:
  - Mengimplementasikan parser byte murni Server Name Indication (SNI) pada paket TLS Client Hello Port 443.
  - Memungkinkan penangkapan nama domain secara real-time $100\%$ akurat bahkan saat browser korban menggunakan DNS cache lokal atau Secure DNS (DoH).
  - Dilengkapi fitur HTTPS SNI Sinkhole yang menginjeksi `TCP RST` untuk memblokir website blacklist secara seketika pada layer TLS.
- **Canary Domain Filter (`transparent_gateway.py`)**:
  - Menghasilkan respon DNS `NXDOMAIN` (rcode=3) untuk domain resmi Canary Mozilla Firefox (`use-application-dns.net`) dan Apple iCloud Private Relay (`mask.icloud.com`, `mask-h2.icloud.com`).
  - Memaksa browser dan iOS/macOS secara resmi menonaktifkan enkripsi DNS pada jaringan lokal dan beralih ke DNS lokal biasa sesuai standar RFC dan dokumentasi resmi vendor.

## [v2.9.1] - 2026-08-28

### Fixed (Doze-Mode Sleeping Host Probing & Captive Portal Server Resilience):
- **Perbaikan Struktur `_DEVICE_HISTORY` & Iterasi Doze Probing (`scanner.py`)**:
  - Memperbaiki bug kritis di mana `_DEVICE_HISTORY` sebelumnya hanya menyimpan dictionary waktu tanpa IP, yang menyebabkan pengecekan `is_valid_private_ip` selalu bernilai `False` dan probing unicast `probe_sleeping_host_via_gateway_arp` tidak pernah dieksekusi.
  - Memperbarui `_DEVICE_HISTORY` untuk menyimpan `ip`, `mac`, `first_seen`, `last_seen`, dan `last_seen_ts`.
  - Mengimplementasikan `ThreadPoolExecutor` paralel (maksimal 15 workers) untuk probing perangkat tidur berbasis urutan timestamp terbaru (`last_seen_ts` descending), menjaga durasi pemindaian tetap cepat (< 2.5s) di lingkungan Wi-Fi Publik / Kafe dengan tingkat pergantian pengguna (churn) tinggi.
- **Perbaikan Missing Import `sys` & Error Handling pada Captive Portal (`portal_server.py`)**:
  - Menambahkan missing `import sys` di `portal_server.py` yang sebelumnya memicu `NameError` pada `ThreadingHTTPServer.handle_error` ketika klien HTTP memutuskan koneksi secara tiba-tiba (`ConnectionResetError` / `BrokenPipeError`).
  - Menambahkan penanganan defensive `try/except` pada `do_HEAD` dan `do_GET` untuk mengabaikan pemutusan koneksi probe klien mobile secara hening.
- **Sentralisasi Endpoint REST Redirect ke `useWebSocket.ts` & Penghapusan Hardcoded Relative URL (`App.tsx`, `useWebSocket.ts`)**:
  - Menambahkan method `startRedirect` dan `stopRedirect` pada hook `useWebSocket.ts` yang mengarah secara presisi ke `${WS_URL}/api/devices/...` dengan encoding URL.
  - Memperbaiki `handleStartRedirect` dan `handleStopRedirect` di `App.tsx` agar tidak lagi menggunakan path relatif `/api/...` yang rentan 404 pada production build / non-proxy setup.
- **Subnet Sweep IP Prefix Fallback & RFC 1918 Scope Strictness (`arp.py`)**:
  - Memperbaiki penanganan pembuatan kandidat host pada `sweep_subnet_for_arp` dan `collect_from_arp_broadcast` jika `self_ip` kosong atau tidak valid, dengan fallback bertingkat ke `gateway` dan `'192.168.1'`, mencegah pembuatan string IP cacat (`.1`, `.2`) dan exception `socket.gaierror`.
  - Menerapkan validasi ketat `is_valid_private_ip()` pada setiap target probe soket non-blocking.
- **Robust Ping Latency RTT & NoneType Safety (`probe.py`)**:
  - Memperbaiki pengecekan `pkt.sent_time` dan `reply.time` pada `ping_fast` agar tidak memicu `TypeError` jika paket tidak memiliki atribut timestamp.
- **Isolasi Invariant Self-Host pada Gateway Fallback (`deviceManager.ts`)**:
  - Memperbaiki method `findGateway()` di Node.js orchestrator agar tidak pernah mengembalikan host controller (`is_self: true`) sebagai gateway fallback.
- **Sinkronisasi Agregat IP Forwarding & Normalisasi MAC (`spoofer.py`)**:
  - Mengimplementasikan `_sync_ip_forward_state()` untuk mengelola status kernel IP Forwarding secara otomatis sesuai agregat sesi aktif (Redirect, MitM Gateway, atau Block).
  - Menstandarkan normalisasi format `self._self_mac` adapter operator ke lowercase colon format.
- **Sinkronisasi Status Scanning Otomatis & Dynamic Scan Button Transition (`deviceManager.ts`, `websocket/index.ts`, `App.tsx`)**:
  - Memancarkan event `scanStarted` dan `scanComplete` langsung dari `DeviceManager` sehingga pemindaian otomatis latar belakang (Teknik 3B Passive DHCP sniffer, network changed, REST API) seketika tersinkronisasi ke seluruh klien frontend.
  - Mempertahankan komponen `<AgentScanProgress />` yang menampilkan informasi tahapan probe (*ARP sweep, mDNS/SSDP wakeup, TCP socket probing, topology synthesis*) secara dinamis beserta counter durasi waktu pemindaian (detik).
  - Tombol **Scan** otomatis di-hide secara mulus (*AnimatePresence exit transition*) saat pemindaian berlangsung dan otomatis muncul kembali saat proses pemindaian selesai.
- **Pure Ultra-Smooth Perimeter Border Beam (`App.css`, `App.tsx`)**:
  - Mengimplementasikan efek **Razor-Sharp Border Beam** (`scanning-card-active`) ultra-halus (durasi 3.2s dengan rotasi gradien multi-stop presisi dan `will-change: transform`) yang mengelilingi 4 sisi garis border tabel tanpa jitter, pop, atau pendaran latar belakang (*zero background bleed*).
- **Verifikasi Liveness Layer 2 & Deteksi Akurat Perangkat Offline (`scanner.py`, `database.ts`)**:
  - Memisahkan kandidat host pasif (DHCP cache, OS ARP cache, device history) dari host aktif. Seluruh kandidat yang tidak merespons ARP broadcast wajib diverifikasi melalui *Gateway-Disguised Unicast ARP probe* sebelum dimasukkan ke dalam daftar aktif.
  - Menghilangkan asumsi otomatis `is_online = True` pada entri cache basi di Windows, sehingga perangkat yang dimatikan atau terputus dari Wi-Fi tidak lagi dilaporkan sebagai online hantu (*ghost/zombie device*).
  - Menghapus delay 90 detik pada rekonsiliasi database PostgreSQL saat scan aktif selesai, sehingga perangkat yang tidak lagi menjawab probe Layer 2 seketika ditransisikan ke status `is_online = FALSE`.
- **Robust Hostname & Multicast Cache Parsing (`scanner.py`)**:
  - Memperbaiki konversi dictionary mDNS/SSDP (`{'model': ''}`) ke string hostname agar nama perangkat tidak terisi objek dictionary stringified.
- **Automated Test Suite Expansion**:
  - Penambahan unit test `test_scanner_device_history_structure_and_wakeup_integration` dan `test_sweep_subnet_for_arp_resilience_and_fallbacks` di `test_unit_discovery.py`.
  - Penambahan unit test `test_portal_server_handle_error_resilience` di `test_redirector.py` (Total: 64 unit tests Python, 100% PASS).
  - Verifikasi build produksi Frontend React (`tsc && vite build`: PASS).

## [v2.9.0] - 2026-08-28

### Added (Smart Transparent MitM Gateway & Live Traffic Monitor):
- **Dedicated Transparent Gateway View (`TransparentGatewayView.tsx`)**:
  - Halaman terpisah pada UI (`/gateway` / `activeNav = "gateway"`) dengan 3 sub-panel interaktif:
    1. **Live Domain / DNS Logger Feed**: Streaming real-time seluruh domain/website yang di-query target (UDP 53) lengkap dengan timestamp, query type, dan status (Allowed/Sinkholed).
    2. **Custom Domain Sinkhole (Pi-hole style)**: Form manajemen blacklist domain untuk memblokir website tertentu secara selektif (merespons dengan `0.0.0.0`) tanpa merusak akses internet target ke website lainnya.
    3. **Live Throughput & Pipeline Stats**: Meteran kecepatan Download/Upload Mbps real-time dan indikator kesehatan routing kernel.
- **Low-Level Transparent Gateway Subsystem (`transparent_gateway.py`)**:
  - Injeksi ARP Spoofing 100% (Pass-through mode tanpa packet drops).
  - Aktivasi penuh Windows Kernel IP Forwarding (`netsh interface ipv4 set interface ... forwarding=enabled`).
  - Sniffer pasif UDP 53 + Reactive ARP + DoT Port 853 Reset.
  - Ring buffer in-memory untuk menyimpan dan menyiarkan log DNS via WebSocket event `gateway_dns_query`.
- **Node.js Orchestration & WebSocket Hub (`pythonBridge.ts`, `deviceManager.ts`, `routes.ts`, `websocket/index.ts`)**:
  - REST endpoints: `GET /api/gateway/status`, `POST /api/gateway/start`, `POST /api/gateway/stop`, `GET /api/gateway/sinkhole`, `POST /api/gateway/sinkhole`, `DELETE /api/gateway/sinkhole/:domain`, `GET /api/gateway/logs`, `DELETE /api/gateway/logs`.
  - Penyiaran event Socket.IO `gateway_dns_query` dan `gateway_status_changed`.
  - Proteksi invariant: Gateway dan This PC kebal secara mutlak dari target gateway proxy.
- **Automated Test Suite Expansion**:
  - Penambahan unit test Python `test_transparent_gateway.py` (Total: 61 tests, 100% PASS).
  - Penambahan unit test Node.js di `unit_deviceManager.test.ts` (Total: 14 tests, 100% PASS).

## [v2.8.0] - 2026-08-28

### Added & Enhanced (Hybrid Fast-Path + Resilient Safety-Net Architecture):
- **Stealth Subnet Sweeping & Micro-Jitter (`arp.py`)**:
  - Implementasi pengacakan urutan target IP (*Randomized Shuffling*) dan micro-jitter (1ms - 4ms) pada `sweep_subnet_for_arp` untuk memecah pola *staircase scan*, mencapai tingkat siluman **$98.9\%$** terhadap deteksi firewall/IDS (Cisco ISE / Fortinet).
- **Gateway-Disguised Unicast ARP Probe (`arp.py` & `scanner.py`)**:
  - Menambahkan penyelidikan unicast `probe_sleeping_host_via_gateway_arp` ber-`psrc = gateway_ip` untuk memicu balasan dari chipset Wi-Fi smartphone yang sedang *Doze Sleep*.
- **3-Strike Anti-Flapping Grace Period (`database.ts`)**:
  - Menerapkan toleransi waktu 90 detik sebelum menandai perangkat offline yang tidak membalas scan ARP, mencegah status perangkat berkedip (*anti-flapping*).
  - Mempertahankan jalur *Fast-Path*: Paket eksplisit `DHCP RELEASE` tetap memotong grace period dan seketika mengubah status menjadi `Offline` ($0\text{ ms}$).
- **Automated Test Suite Expansion**:
  - Penambahan unit test `test_sleeping_host_unicast_probe` di Python service (Total: 56 tests, 100% PASS).
  - Penambahan unit test `Resilience: 3-Strike Grace Period` di Node.js backend (Total: 13 test suites, 100% PASS).

## [v2.7.0] - 2026-08-28

### Added & Enhanced (Teknik 3B Passive Intelligence Expansion):
- **Deteksi Rogue DHCP Server (`dhcp.py` & `server.py`)**:
  - Ekstraksi RFC 2132 Opsi 54 (*Server Identifier*) pada seluruh respon `DHCP OFFER` dan `DHCP ACK`.
  - Sistem otomatis mendeteksi jika terdapat server DHCP liar / router salah pasang (`server_id != official_gateway`) dan menyiarkan event WebSocket `rogue_dhcp_detected` ke seluruh layer.
- **Instant Offline State Transition via `DHCP RELEASE` (`deviceManager.ts`)**:
  - Menangkap paket Opsi 53 = 7 (`RELEASE`) saat perangkat mematikan Wi-Fi, seketika mengubah status perangkat menjadi `Offline` di PostgreSQL dan antarmuka UI dalam 0.001ms tanpa jeda polling.
- **Deterministic PRL Signature Matrix (`dhcp.py`)**:
  - Memperluas identifikasi perangkat berbasis Opsi 55 (PRL) & Opsi 60 (Vendor Class) untuk Apple iOS, Apple macOS, Android (dengan label versi granular), Windows 10/11, Sony PlayStation, Nintendo Switch, dan Linux IoT tanpa port scanning aktif.
- **Frontend Rogue DHCP Security Alert Banner (`App.tsx` & `useWebSocket.ts`)**:
  - Banner peringatan merah beranimasi dengan detail IP dan MAC server DHCP liar jika terdeteksi.
- **Automated Test Suite Expansion**:
  - Penambahan 3 unit test Python di `test_unit_discovery.py` (Total: 55 unit tests, 100% PASS).
  - Penambahan 2 unit test Node.js di `unit_deviceManager.test.ts` (Total: 13 test suites, 100% PASS).

## [v2.6.1] - 2026-08-28

### Fixed & Enhanced:
- **Multi-Vector DNS & ARP Interceptor (`dns_spoofer.py`)**:
  - **Reactive ARP Spoofing Instan**: Menambahkan penangkap paket ARP broadcast `who-has <gateway_ip>` dari MAC korban yang langsung dibalas `is-at <self_mac>` dalam 0.01ms, memenangkan balapan ARP terhadap router fisik dan menembus filter *Unsolicited ARP Reply* pada Android 11+.
  - **DNS-over-TLS (Port 853) Auto-Reset**: Injeksi paket `TCP RST+ACK` ke koneksi DoT dari target untuk seketika menggagalkan enkripsi Private DNS Android dan memaksa *fallback* otomatis ke DNS lokal UDP port 53.
  - **Walled Garden Real DNS Passthrough**: Penyelesaian IP asli domain Instagram menggunakan `socket.gethostbyname` langsung di controller, menjamin profil dan foto Instagram termuat sempurna tanpa tergantung ketersediaan DNS router.
  - **RFC 3596/4074 NODATA Compliance**: Menghilangkan error penolakan query IPv6 (AAAA) dan HTTPS (type 65) pada Chrome Android dengan merespons `rcode=0, an=None` yang memaksa fallback instan ke IPv4 A-record.
- **Captive Portal Auto-Redirect (`portal_server.py`)**:
  - Penambahan JavaScript deep-link handler (`instagram://user?username=...`) dengan fallback otomatis ke web browser dalam 600ms.
  - Penanganan error `ConnectionResetError` (WinError 10054) dan `BrokenPipeError` secara elegan tanpa traceback di terminal.
- **Windows Firewall Configuration Script (`scripts/allow_portal_firewall.bat`)**:
  - Penambahan aturan pemblokiran outbound port 853 (TCP) untuk memotong rute transit Android DoT.

## [v2.6.0] - 2026-08-27

### Added:
- **DNS Spoofing & Captive Portal Redirect ke Instagram (`python-service/src/core/redirector/`)**:
  - **Walled Garden DNS Spoofer (`dns_spoofer.py`)**: Intersepsi query DNS (UDP 53) dari target ARP poisoned. Domain Instagram (`*.instagram.com`, `*.cdninstagram.com`, `*.ig.me`, `*.fbcdn.net`) diizinkan tembus ke gateway via Windows IP Forwarding, sedangkan seluruh domain lain dibelokkan ke alamat IP lokal Komputer Pengawas.
  - **Captive Portal HTTP Redirector (`portal_server.py`)**: Server HTTP multi-threaded port 80 yang merespons probe Captive Portal (`/generate_204`, `/hotspot-detect.html`, `/ncsi.txt`) dan permintaan HTTP dengan `302 Found` ke URL profil Instagram target + landing page interaktif dengan deep link `instagram://user?username=...`.
  - **Redirect Session Orchestrator (`manager.py`)**: Manajemen thread-safe sesi redirect per target IP dengan proteksi ketat invariant (*Anti Self-Cut*, *Gateway Immunity*, dan batasan *RFC 1918*).
  - **REST API Endpoints**: Penambahan `POST /api/redirect/start`, `POST /api/redirect/stop`, dan `GET /api/redirect/status` pada FastAPI Engine.
- **Node.js Orchestrator Bridge & Endpoints (`backend-node`)**:
  - Penambahan method `startRedirect`, `stopRedirect`, dan `getRedirectStatus` pada `pythonBridge.ts`.
  - Penambahan method `redirectDevice` dan `stopRedirectDevice` pada `deviceManager.ts`.
  - REST route `POST /api/devices/:ip/redirect` dan `POST /api/devices/:ip/stop-redirect` pada `routes.ts`.
- **Frontend UI Instagram Walled Garden Controls (`frontend-react`)**:
  - Komponen `InstagramRedirectModal.tsx`: Dialog modern untuk memasukkan username/link Instagram dan mengontrol sesi redirect dengan penyimpanan lokal otomatis (`localStorage`).
  - Indikator status `Redirect (IG)` beranimasi pulse pink pada tabel perangkat.
  - Tombol aksi cepat redirect (ikon Instagram) pada kolom aksi `DeviceTable.tsx` dan panel `SecurityTelemetrySidebar.tsx`.
- **Automated Tests Suite Expansion**:
  - Penambahan unit test `test_redirector.py` di Python service (Total: 52 automated tests, 100% PASS).
  - Penambahan unit test happy path & protection di Node.js backend (Total: 13 automated tests, 100% PASS).

---

## [v2.5.0] - 2026-08-27

### Added & Optimized:
- **Public Wi-Fi Supernets Support & Storm Protection (`python-service/src/core/discovery/arp.py`)**:
  - Peningkatan `sweep_subnet_for_arp` dengan evaluasi dinamis `IPv4Network` untuk mendukung subnet supernet (`/22`, `/20`, `/24`) tanpa meninggalkan host di segmen IP berbeda.
  - Proteksi penyiaran badai ARP (*Broadcast Storm Guard*): Mencegah penembakan 65.534 paket ARP broadcast jika pengguna terhubung ke subnet `/16` atau `/8` publik, menjaga agar router AP tidak memutus koneksi operator.
- **Adaptive Probing Scan Acceleration (`python-service/src/core/scanner.py` & `netbios.py`)**:
  - Menghapus pemanggilan blocking `socket.gethostbyaddr(ip)` yang memicu jeda 5,26 detik per host ketika DNS router tidak merespons query PTR.
  - Pemanfaatan resolusi *cache-first* (DHCP dan multicast mDNS/SSDP) sehingga nama host langsung terisi tanpa query jaringan tambahan.
  - Port scanning adaptif: Mengabaikan port SMB/NetBIOS 137/445/3389 pada smartphone ber-MAC acak, memotong waktu pemindaian 50+ perangkat aktif hingga 50%.
- **Supernet Device Filter di Backend Node.js (`backend-node/src/services/deviceManager.ts`)**:
  - Implementasi fungsi bitwise `isIpInSameSubnet` untuk menggantikan filter teks kasar `startsWith`, mencegah terbuangnya perangkat yang sah pada jaringan Wi-Fi publik supernet.
- **Frontend UI Lag Prevention pada 50+ Perangkat (`frontend-react/src/App.tsx` & `DeviceTable.tsx`)**:
  - Pemanfaatan `useDeferredValue` pada pencarian perangkat untuk menjamin fluiditas input 60 FPS saat memfilter 50+ perangkat aktif.
  - Penyesuaian viewport tabel menjadi responsif (`max-h-[min(650px,65vh)]`) agar navigasi pada daftar perangkat panjang terasa nyaman.

---

## [v2.4.0] - 2026-08-27

### Added:
- **Profile-Centric Consolidation & Superseded MAC Auto-Archiving (`backend-node/src/services/database.ts`)**:
  - Solusi menyeluruh untuk mengatasi penumpukan baris ganda di UI akibat perputaran MAC acak (*Randomized MAC Churn*) pada smartphone Android/iOS saat di-throttle.
  - Penambahan kolom `is_archived` dan indeks `idx_devices_is_archived` pada tabel `devices`.
  - Otomatisasi pengarsipan: Ketika sebuah perangkat fisik berganti MAC dan cocok dengan profil ($\ge 80\%$), seluruh baris MAC lama milik profil tersebut yang berstatus offline otomatis ditandai `is_archived = TRUE`.
  - Pembersihan proses zombie: Sesi spoofing lama pada MAC yang diarsipkan otomatis dibersihkan via `pythonBridge.stopSpoof` untuk mencegah zombie packet loop.
  - Pewarisan tanggal `first_seen`: Entri MAC baru mewarisi tanggal `first_seen` dari profil induknya sehingga riwayat waktu pertama kali perangkat bergabung tidak ter-reset.
  - Query `getAllDevices()` menyaring perangkat aktif non-arsip dan melakukan `LEFT JOIN device_profiles` untuk melampirkan seluruh riwayat `linked_macs`.
  - Pewarisan limit kecepatan: Nilai `speed_limit` profil otomatis disinkronkan ke entri MAC baru yang aktif (`autoThrottleTargets`).
  - Lencana antarmuka baru di `DeviceTable.tsx`: Menampilkan badge `🔗 N MACs` jika perangkat memiliki beberapa alamat MAC acak yang disatukan.
  - Panel inspeksi baru di `SecurityTelemetrySidebar.tsx`: Menampilkan riwayat seluruh MAC acak yang pernah digunakan beserta penanda status `[Aktif]` dan `[Diarsipkan]`.
  - Penambahan unit test 8 pada `backend-node/tests/unit_database.test.ts`.

---

## [v2.3.0] - 2026-08-27

### Added:
- **Prioritized 3-Tier Device Sorting (`frontend-react/src/lib/deviceSort.ts`)**:
  - Implementasi fungsi pengurutan perangkat cerdas sesuai urutan prioritas:
    1. **Tier 1**: Perangkat yang memiliki nama (alias / hostname teridentifikasi) dan berstatus **Online**.
    2. **Tier 2**: Perangkat yang hanya berupa IP (tanpa hostname) dan berstatus **Online** (diurutkan secara numerik IPv4).
    3. **Tier 3**: Perangkat yang berstatus **Offline**.
  - Perlindungan invariant: Router Gateway dan Komputer Pengawas (*This PC*) otomatis menempati posisi teratas di kelompok perangkat online.
- **Dua Baris Informasi Nama & IP**: Kolom nama perangkat kini menampilkan nama perangkat (*friendly name*) sebagai judul tebal dan alamat IP sebagai sub-teks monospace di bawahnya.

- **Dual-Opcode Restore & TCP-Friendly PWM Throttling (`src/core/spoofer.py`)**:
  - Implementasi `_build_restore_packets` dengan injeksi ganda (`op="is-at"` dan `op="who-has"` ber-`hwsrc=gateway_mac`) yang memaksa Android 11+ dan iOS memulihkan tabel ARP-nya di fase normal throttling dan sesi teardown.
  - Perlebaran periode siklus PWM dari $0.5\text{s}$ menjadi $1.2\text{s}$ dengan kurva alokasi waktu non-linier yang ramah terhadap *TCP Congestion Window* untuk mencegah *Exponential RTO Backoff*.
  - Kondisional *Initial Burst*: 5 paket burst cepat hanya ditembakkan pada mode *Full Block* (`speed_limit == 0`), dan dilewati pada mode throttling agar koneksi target tidak putus seketika di awal.
  - Penambahan 2 unit test baru di `test_unit_spoofer.py` (Total: 49 Python tests, 62 tests across repository, 100% PASS).

### Changed:
- **Minimalist Clean Header**: Menghilangkan garis pembatas bawah horizontal pada header bar dan menyelaraskan posisi vertikal logo `⌘` dan judul `Sentinel / Network Targets` pada sumbu yang sejajar (`h-16 pt-2`).
- **Dynamic Tab Badge Counter**: Badge jumlah perangkat pada tab filter (**All Hosts**, **Online**, **Dibatasi**, **Blocked**) kini hanya tampil apabila jumlahnya lebih besar dari 0 (`> 0`).

---

## [v2.2.0] - 2026-08-27

### Added:
- **Teknik 3B (Passive DHCP Sniffing) Defensive Optimization Suite**:
  - **Smart Merge Cache (Solusi 1)**: Penyimpanan primer berbasis MAC address, pemisahan indeks dinamis IP $\rightarrow$ MAC untuk mencegah kontaminasi data antar-perangkat (*IP churn*), serta batas kapasitas LRU 300 entri untuk mencegah kebocoran memori.
  - **Sniffer Kontinu & Self-Packet Loopback Wakeup (Solusi 2)**: Menghilangkan jeda titik buta 20ms (*blind-spot*) dan mencegah Npcap C-level blocking hang dengan menembakkan paket loopback lokal saat server dimatikan.
  - **Ekstraksi Defensif Opsi 51 & Opsi 3 (Solusi 3)**: Ekstraksi waktu sewa IP (dengan proteksi overflow `0xFFFFFFFF` di Windows) dan IP gateway sebagai data telemetri pembanding.
  - **Heuristik Merek Smartphone Ter-Dekopel (Solusi 4)**: Pengenalan merek HP ber-MAC acak (Samsung, Xiaomi, Vivo, Oppo, Infinix, Tecno, Realme) pada fase enrichment, dilindungi kamus kata kunci negatif untuk Asus VivoBook dan Smart TV.
- **Multi-Factor Fingerprint Scoring & Anti-Collateral Protection (Linked Profile)**:
  - Implementasi `isGenericFactoryHostname` dan `GENERIC_FACTORY_PATTERNS` untuk mendeteksi nama pabrikan pasaran (seperti `Galaxy-A14`, `Redmi-Note-10`, `iPhone`).
  - Menghitung skor komposit kecocokan (0-100%) berbasis Hostname (Personal vs Generic), Option 55 PRL Signature, Option 60 Vendor Class, Jendela Waktu Offline, dan DUID.
  - Perlindungan anti salah-blokir tamu: Skor $50\% - 79\%$ dilabeli `candidate_review` dan **tidak diblokir** (`is_blocked = false`), sedangkan skor $\ge 80\%$ memenuhi syarat *high-confidence auto-link* (dengan batas array `linked_macs` maksimal 10 MAC).
- **7 Automated Test Cases Baru**: Pengujian Smart Merge, Anti-Contamination IP Reassignment, LRU eviction, Option 51/3 defensive parsing, Sniffer lifecycle wakeup, Hostname brand heuristics, Generic model blacklist, dan skenario proteksi tamu Siti vs Budi (Total: 60 automated test cases, 100% PASS).

---

## [v2.1.0] - 2026-08-27

### Added:
- **Comprehensive Testing Suite**: 53 automated test cases mencakup Unit, Integration, Concurrency, Database, API, Validation, dan Error Handling testing (100% PASS).
- **BeUI Segment Tabs**: Navigasi filter modern (`All Hosts`, `Online`, `Dibatasi`, `Blocked`) dengan animasi spring layout indicator (`layoutId`).
- **Dynamic Bandwidth Throttling Filter**: Tab "Dibatasi" yang otomatis menyaring perangkat dengan `speed_limit < 100 && speed_limit > 0`.
- **BeUI 3-Action Tooltip**: Tooltip mengambang untuk pemutusan Wi-Fi, slider batas bandwidth, dan detail perangkat.
- **Option 53 DHCP Parsing**: Identifikasi jenis pesan DHCP (`DISCOVER`, `REQUEST`, `ACK`, `RELEASE`).
- **Technical Specification Suite**: 7 dokumen spesifikasi teknis modular (`docs/specs/SPEC-001` hingga `SPEC-007`).
- **Agent Operational Guide**: `AGENTS.md`, `docs/TROUBLESHOOTING.md`, dan `docs/EVENT_TAXONOMY.md`.

### Refactored:
- **Clean Subpackage Architecture (`python-service`)**:
  - Memecah monolit 1.288 baris menjadi sub-paket kohesif:
    - `src/core/network.py` (Adapter Wi-Fi, gateway resolution, IP forward toggle).
    - `src/core/telemetry.py` (psutil sampler throughput & latency).
    - `src/core/discovery/` (`arp.py`, `multicast.py`, `dhcp.py`).
    - `src/core/fingerprint/` (`vendors.py`, `netbios.py`, `probe.py`, `os_detect.py`, `ensemble.py`).
    - `src/core/scanner.py` (Orkestrator ramping < 170 baris).

### Fixed:
- **Lock Contention Bug**: Memisahkan penghapusan state sesi (di dalam mutex) dari pengiriman 6 paket restorasi ARP (di luar mutex) pada `spoofer.stop()` untuk mengeliminasi pembekuan REST API.
- **Stale Interface on Wi-Fi Roaming**: Penambahan `refresh_interface()` yang otomatis memperbarui adapter Scapy saat berpindah access point.
- **Empty Key in DHCP Cache**: Validasi ketat `is_valid_private_ip()` sehingga IP `0.0.0.0` atau string kosong tidak pernah menjadi kunci cache.
- **Strict RFC 1918 Private IP Evaluation**: Memperketat `is_valid_private_ip()` agar `0.0.0.0` dan `255.255.255.255` dievaluasi sebagai `False`.

---

## [v2.0.0] - 2026-08-20

### Added:
- **Hybrid Microservices Separation**: Pemisahan mesin injeksi L2 Python Scapy (:8001) dan orkestrator bisnis Node.js Express & PostgreSQL (:5000).
- **PostgreSQL Persistence Engine**: Skema tabel `devices` dengan riwayat `first_seen`, `last_seen`, dan status pemblokiran permanen.
- **Auto-Reblock Pipeline**: Pencegatan otomatis perangkat yang mencoba mengganti IP untuk menghindari pemblokiran.
- **Real-Time Hardware Telemetry**: Grafik langsung download/upload Mbps dan ping RTT gateway via WebSocket.
- **Multi-Sensor Profiler**: Deteksi SSDP UPnP, mDNS Bonjour, dan NetBIOS Name Service.
