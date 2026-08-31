# SPEC-010: Deep Security Architecture, Threat Modeling & Compliance

> **Document Status:** Authoritative Architectural Specification  
> **Target Version:** Spoorf Sentinel Enterprise v2.21.0+  
> **Scope:** Full-Stack Security (Kernel L2, OS Privilege, Inter-Process, Cloud Auth, Cryptography & Compliance)  
> **Governing Standards:** RFC 1918, OWASP Desktop Application Top 10, Zero-Trust Architecture

---

## 0. Status Implementasi vs Roadmap (Diperbarui 2026-08-31)

Dokumen ini bersifat **arsitektural/aspiratif**. Tabel berikut memisahkan apa yang **sudah ada di kode** dari yang masih **rencana**, agar dokumentasi jujur terhadap implementasi. Diselaraskan setelah audit keamanan & perbaikan Prioritas-1.

| Kontrol Keamanan | Status | Bukti / Catatan |
| :--- | :---: | :--- |
| **Exact-match Origin/Host anti drive-by** | ✅ Implemented (P1) | `backend-node/src/security.ts` — `isAllowedOrigin` parse URL & cocokkan `hostname` eksak (menutup bug prefix `http://localhost.evil.com`). |
| **Validasi parameter Gateway + eksekusi tanpa shell** | ✅ Implemented (P1) | `spoofer.py::start` & `_ensure_host_gateway_locked`, `shield.py` — `is_valid_private_ip`/`is_valid_mac` + `subprocess` arg-list (bukan `shell=True`). |
| **Ephemeral IPC Bearer Token (§2.4 / §3)** | ✅ Implemented (P1) | Di-generate `crypto.randomBytes(32)` di Electron `main.ts`; enforced di Node (`apiTokenGuard`, WS `io.use`) & Python (`api_token_guard` middleware + guard WS). Aktif saat `SENTINEL_API_TOKEN` diset. |
| **Bind loopback (127.0.0.1) Node & Python** | ✅ Implemented | `app.ts` (HOST 127.0.0.1), `main.py` (uvicorn 127.0.0.1:8001). |
| **SQL Injection prevention (parameterized)** | ✅ Implemented | `database.ts` — 100% prepared statement `better-sqlite3` (`?`). |
| **Gateway/Self immunity (anti self-cut)** | ✅ Implemented | Invariants di `spoofer.py::start` + guard `deviceManager.ts`. |
| **Crash-resilient un-spoofing (restore saat exit)** | ✅ Implemented | `pythonBridge.stopAll` + `main.ts` (path `/api/spoof/stop_all` — diperbaiki dari `stop-all`) + `@app.on_event("shutdown")`. ARP dikirim tanpa flag permanent (natural expiry). |
| **PWM jitter pacing (anti broadcast storm)** | 🟡 Sebagian | Jitter/`time.sleep` di `spoofer.py` (mis. baris ~248, ~320) — belum leaky-bucket 15–25 pps yang eksplisit. |
| **Verifikasi kriptografis lisensi (RS256/Ed25519)** | 🧭 Roadmap | Kode saat ini: lisensi lokal, token tidak diverifikasi kripto; aktivasi berbasis prefix string (lihat SPEC-008). |
| **Anti Clock-Tamper (monotonic + NTP)** | 🧭 Roadmap | Grace period memakai `Date.now()` langsung; belum ada monotonic/NTP. |
| **HWID slot enforcement server-side** | 🧭 Roadmap | Butuh Cloud API; belum diimplementasi. |
| **Root CA key encryption at-rest** | 🧭 Roadmap (OPEN) | `certs.py` menyimpan key tanpa enkripsi (`NoEncryption()`). |

> Rincian temuan & sisa item terbuka: [`docs/SECURITY_AUDIT.md`](../SECURITY_AUDIT.md).

---

## 1. Executive Threat Modeling Matrix

Aplikasi manipulasi Layer 2 berbasis desktop memiliki vektor serangan unik yang berbeda dari web application standar:

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                           7 VEKTOR ANCAMAN UTAMA & MITIGASINYA                            |
+───────────────────────────────────────────────────────────────────────────────────────────+
| 1. Time-Travel / Clock Tampering      ──► Monotonic Timestamp Tracker + NTP Validation    |
| 2. DLL Hijacking & Search Order        ──► Absolute System32 Directory Pinning for Npcap   |
| 3. Memory Scanning & Live Patching    ──► On-Demand Cryptographic Token Signature Check   |
| 4. Local Inter-Process Hijacking      ──► Dynamic Ephemeral IPC Bearer Secret Token       |
| 5. Router Denial of Service (DoS)     ──► Adaptive Leaky Bucket Packet Rate Limiter       |
| 6. Account Sharing & Concurrent Abuse ──► Single Active Device Slot + Realtime Revocation  |
| 7. Privacy & Wiretapping Liability    ──► Zero Cloud Telemetry of Network Traffic/Payload |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 2. Rincian Pertimbangan Keamanan Lanjutan

### 🕒 2.1. Serangan Manipulasi Waktu Sistem (Time-Travel / Clock Tampering)
- **Vektor Serangan:**
  Pengguna memundurkan jam kalender Windows (misal diubah ke tahun 2020) agar masa langganan atau masa tenggang offline (*7-day offline grace period*) tidak pernah habis (*never-expires*).
- **Mitigasi Teknis:**
  1. **Monotonic Timestamp Tracking:** Menyimpan kolom `last_verified_timestamp` di SQLite setiap kali aplikasi berjalan. Jika waktu sistem saat ini `< last_verified_timestamp` (waktu melompat ke masa lalu), aplikasi mendeteksi anomali *Clock Tampering* dan membatalkan status lisensi lokal secara instan.
  2. **NTP Public Time Fallback:** Saat ada akses internet keluar, desktop memvalidasi waktu terhadap server waktu publik (`pool.ntp.org` / `time.google.com`) sebagai sumber kebenaran waktu utama.

---

### 🛡️ 2.2. DLL Hijacking & Windows Search Order Vulnerability
- **Vektor Serangan:**
  Driver Npcap memuat library `wpcap.dll` dan `Packet.dll`. Jika penyerang menaruh file `wpcap.dll` berbahaya di direktori lokal aplikasi atau folder `%PATH%`, Windows dapat memuat DLL palsu tersebut dengan hak istimewa Administrator (*Privilege Escalation*).
- **Mitigasi Teknis:**
  - **Explicit Path Loading:** Backend Python dan Node.js memuat DLL Npcap secara eksplisit dari jalur absolut Windows System32:
    `C:\Windows\System32\Npcap\wpcap.dll`
  - Memanggil Windows API `SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32)`.

---

### 🧠 2.3. Proteksi Memori Proses (Memory Scanning & Patching Attack)

> **Status: 🧭 Roadmap.** Belum diimplementasi. Saat ini otorisasi fitur (`blockDevice`, `setSpeedLimit`) memakai pemeriksaan boolean lisensi lokal (`licenseManager`), **belum** verifikasi tanda tangan JWT asimetris dinamis. Lihat SPEC-008 & SECURITY_AUDIT.
- **Vektor Serangan:**
  Pengguna teknis menggunakan alat seperti *Cheat Engine*, *Frida*, atau debugger *x64dbg* untuk mencari dan mengubah variabel boolean di RAM (misal mengubah `user.tier = "free"` menjadi `"pro"`).
- **Mitigasi Teknis:**
  - **Dynamic Cryptographic Verification:** Otorisasi fitur kritis (seperti `blockDevice()`, `setSpeedLimit()`) **TIDAK HANYA** memeriksa variabel boolean di memori, melainkan memverifikasi ulang tanda tangan kriptografis token JWT menggunakan Public Key secara dinamis pada saat eksekusi fungsi.
  - Jika signature tidak sah, eksekusi Layer 2 ditolak seketika (`SpoofError`).

---

### 🚦 2.4. Pencegahan Badai Paket & Router Crash (Broadcast Storm Limiting)

> **Status: 🟡 Sebagian.** `spoofer.py` sudah menerapkan *jitter*/`time.sleep` acak pada loop injeksi (mengurangi laju), namun **leaky-bucket 15–25 pps per target** yang eksplisit belum ada.
- **Vektor Serangan:**
  Jika operator memutus 50 perangkat sekaligus atau terjadi bug perulangan injeksi paket ARP, router murah (seperti router rumahan ISP standar) dapat mengalami kepenuhan buffer (*buffer overflow*) dan mengalami hang/reboot total.
- **Mitigasi Teknis:**
  - **Adaptive Leaky Bucket Rate Limiting:** Python engine membatasi laju injeksi ARP maksimal **15 - 25 paket per detik per target** dengan *random jitter* (30-50ms delay).
  - Melindungi router agar tidak mendeteksi banjir paket sebagai serangan DoS fisik pada CPU router.

---

### 👥 2.5. Anti-Account Sharing & Concurrent Device Enforcer
- **Vektor Serangan:**
  1 akun Pro dibagikan ke forum publik sehingga digunakan oleh puluhan orang secara serentak.
- **Mitigasi Teknis:**
  - **Single Active HWID Slot:** Cloud Server membatasi jumlah HWID aktif untuk setiap tier lisensi (Free = 1, Pro = 1 atau 2, VIP = 5).
  - **Session Invalidation / Kick Older Device:** Jika Akun A login di Laptop 2, Server Cloud mencabut (*revoke*) token di Laptop 1 pada *heartbeat* berikutnya. Pengguna Laptop 1 menerima notifikasi: *"Akun Anda telah masuk di perangkat lain"*.

---

### ⚖️ 2.6. Privasi Pengguna & Kepatuhan Hukum Penyadapan (Privacy & Legal Compliance)
- **Vektor Resiko Hukum:**
  Modul Smart Gateway & Security Arsenal mampu menangkap lalu lintas data HTTP, domain DNS, dan kredensial plaintext di jaringan LAN. Jika data ini terkirim ke Server Cloud Anda, Anda dapat terjerat pelanggaran UU PDP / UU ITE (Penyadapan tanpa hak).
- **Mitigasi Arsitektur (*Zero Cloud Data Telemetry*):**
  - **100% Local Retention:** Seluruh log DNS, nama domain yang dikunjungi target, riwayat port scanning, dan payload jaringan **HANYA** disimpan di memori RAM atau SQLite lokal laptop pengguna.
  - Server Cloud Anda **SAMA SEKALI TIDAK PERNAH** menerima payload jaringan dari pengguna. Server Cloud hanya mengelola akun, email, pembayaran, dan HWID.

---

### 🔄 2.7. Pemulihan Jaringan Bersih Saat Crash (Crash Resilient Un-Spoofing)
- **Vektor Resiko:**
  Jika laptop operator tiba-tiba kehabisan baterai (*blue screen* / mati mendadak) saat sedang memutus 10 perangkat, target-target tersebut akan tetap kehilangan akses internet karena tabel ARP di router belum dipulihkan.
- **Mitigasi Teknis:**
  - **ARP Cache Natural Expiry:** Frame ARP spoofing dikirim tanpa flag *permanent*. Tabel ARP router akan otomatis pulih secara alami dalam rentang 30 - 60 detik setelah controller mati.
  - **OS Process Traps (`atexit`, `SIGINT`, `SIGTERM`):** Mengirimkan burst 5 paket restorasi ARP resmi (*official gateway MAC*) sebelum proses benar-benar ditutup oleh sistem.

---

## 3. Matriks Rekomendasi Tech Stack Keamanan

| Domain Keamanan | Pilihan Teknologi Standar Industri | Fungsi & Implementasi |
| :--- | :--- | :--- |
| **Kriptografi Lisensi** | `jose` / `node-jose` (Node.js) | Verifikasi asimetris JWT Ed25519 / RS256 |
| **Obfuskasi Node.js** | `bytenode` | Kompilasi JS ke V8 Bytecode (`.jsc`) |
| **Obfuskasi Python** | `Nuitka` / `PyInstaller` | Kompilasi Python ke Native C++ Machine Binary |
| **Komunikasi IPC Lokal** | `crypto.randomBytes(32)` | Dynamic Shared Secret Bearer Token |
| **Verifikasi Waktu** | `pool.ntp.org` client + Monotonic SQLite | Anti-Time Travel / Clock Rollback Detector |
| **Proteksi Cloud API** | Cloudflare WAF + Upstash Redis | Anti-DDoS, Brute Force Protection, Bot Mitigation |
| **Code Signing Windows** | Microsoft Authenticode (EV Certificate) | Menghilangkan SmartScreen warning pada `.exe` |

---

## 4. Analisis Risiko, Efek Samping & Dampak Kedepannya (Risks, Side Effects & Future Impacts)

Implementasi lapisan keamanan yang ketat memiliki konsekuensi teknik dan operasional yang harus dipahami dan dikelola secara matang:

### ⚠️ 4.1. Risiko terhadap Aplikasi (Risks to the Application)
1. **Risiko False Positive Antivirus (Heuristic Detection):**
   - *Penyebab:* Penggunaan low-level packet injection (Npcap/Scapy) yang digabung dengan binary packer (PyInstaller/Nuitka) sering memicu deteksi heuristik antivirus (misal Windows Defender melabeli sebagai *HackTool* atau *Generic Trojan*).
   - *Mitigasi:* Menggunakan **Windows Authenticode Code Signing Certificate (EV)** resmi dan mendaftarkan hash installer ke Microsoft Security Intelligence Whitelist.
2. **Risiko HWID Flapping / Invalidation (Hardware ID Berubah Tanpa Sengaja):**
   - *Penyebab:* Jika HWID bergantung pada MAC address Wi-Fi (yang bisa berubah karena fitur *Random Hardware Addresses* di Windows 11) atau perubahan driver saat update BIOS, lisensi pengguna bisa tiba-tiba terkunci dan dianggap "ganti komputer".
   - *Mitigasi:* Membangun HWID secara eksklusif dari parameter hardware statis permanen (Motherboard UUID + CPU Serial + Windows Machine GUID di Registry).
3. **Risiko False Clock Tampering Lockout (Baterai CMOS Drop):**
   - *Penyebab:* Pada laptop lama dengan baterai CMOS habis, jam sistem bisa reset ke tahun 2000 saat laptop menyala offline.
   - *Mitigasi:* Berikan batas toleransi waktu wajar (misal tidak langsung memblokir permanen, melainkan memicu *Clock Sync Warning* dan verifikasi ulang begitu terhubung ke jaringan).

### ⚡ 4.2. Efek Samping Operasional & Pengguna (Side Effects)
1. **Waktu Kompilasi & Build Pipeline Lebih Lama:**
   - Proses kompilasi kode Python ke C++ native via Nuitka dan enkripsi bytecode Node.js via Bytenode membutuhkan waktu build installer 5-10 menit (lebih lama daripada standard packaging).
2. **Ketergantungan Akses Internet di Awal (Initial Activation Dependency):**
   - Meskipun ada *7-Day Offline Grace Period*, pengguna tetap **wajib memiliki koneksi internet minimal 1 kali di awal** saat pertama kali login akun.
3. **Peningkatan Beban Customer Support (Ganti Komputer):**
   - Pengguna yang menjual laptop lamanya dan pindah ke PC baru akan membutuhkan tombol *Self-Service Device Reset* di Web Portal agar tidak membebani CS.

### 📈 4.3. Dampak Jangka Panjang (Long-Term Strategic Impacts)
1. **Dampak Finansial & Bisnis (Positif):**
   - **Zero Revenue Leakage (Anti-Cracking):** Penggunaan asimetris Ed25519 JWT dan HWID binding mencegah pembajakan lisensi, memastikan seluruh pengguna Pro membayar resmi.
   - **Infrastruktur Cloud Ultra-Murah (Hemat Biaya Server):** Karena server cloud hanya memvalidasi JWT & HWID (tanpa menampung lalu lintas paket LAN pengguna), biaya server Cloud Anda sangat murah (cukup VPS $5 - $10 / bulan).
2. **Dampak Hukum & Reputasi (Positif):**
   - **Kepatuhan Mutlak UU PDP / ITE:** Kebijakan *Zero Cloud Data Telemetry* menjamin Anda aman secara hukum dari tuduhan penyadapan data pengguna.
3. **Dampak Pemeliharaan (Maintenance):**
   - **Wajib Sistem Auto-Update Desktop:** Wajib menyertakan sistem pembaruan otomatis (`electron-updater`) agar pengguna selalu mendapatkan patch keamanan terbaru tanpa perlu download manual berulang kali.

---

## 5. Evaluasi Komparatif: Mode Offline vs Wajib Always-Online (Strategic Decision)

Apakah lebih baik **Wajib Always-Online** atau **Mode Hybrid (Offline Grace Period)**?

| Parameter Evaluasi | ❌ Opsi A: Wajib Always-Online (Tiap Detik Cek Cloud) | 🏆 Opsi B: Hybrid Offline Grace Period (7 Hari) *(Rekomendasi)* |
| :--- | :--- | :--- |
| **Konteks Penggunaan NetCut** | **Sangat Buruk:** Pengguna biasanya menyalakan NetCut saat **internet Wi-Fi sedang macet/mati**. Jika wajib online, aplikasi gagal terbuka justru saat paling dibutuhkan! | **Sangat Baik:** Aplikasi tetap dapat memindai dan memotong target di LAN lokal meskipun koneksi internet ke luar sedang down total. |
| **Keamanan dari Pembajakan** | Sangat Tinggi (Real-time check) | **Sangat Tinggi:** Dilindungi kriptografi Ed25519 JWT + HWID binding. Tidak bisa dimanipulasi di SQLite lokal. |
| **Ketergantungan Server Cloud (Uptime Risk)** | **Tinggi:** Jika server cloud Anda mengalami gangguan/maintenance, seluruh pengguna sedunia tidak bisa membuka aplikasi. | **Zero Downtime Risk:** Jika cloud down beberapa jam, pengguna tidak terdampak sama sekali. |
| **Beban & Biaya Server Cloud** | **Tinggi:** Server harus melayani jutaan *polling heartbeat* per menit dari seluruh aplikasi desktop yang menyala. | **Sangat Ringan:** Cloud hanya dihubungi saat login dan refresh periodik di latar belakang. |
| **Standar Industri Internasional** | Jarang digunakan untuk utility software | **Standar Emas Industri:** Digunakan oleh software profesional seperti *Adobe Creative Cloud, JetBrains IDEs, Microsoft 365, Spotify Desktop*. |

### 🎯 Keputusan Arsitektur:
Model yang paling unggul dan tepat untuk Spoorf Sentinel adalah **Opsi B (Hybrid / 7-Day Offline Grace Period)**:
1. **Login Awal Wajib Online**: Mengikat HWID dan mengunduh token kriptografis berjangka.
2. **Operasi Bebas Offline 7 Hari**: Pengguna bebas memotong pengunduh liar di Wi-Fi lokal meskipun internet sedang mati total.
3. **Silent Background Refresh**: Setiap kali laptop mendeteksi akses internet, masa berlaku 7 hari diperbarui otomatis di latar belakang tanpa mengganggu pengguna.


