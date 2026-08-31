# Laporan Audit Keamanan & Kualitas Kode — NetCut Sentinel (Spoorf)

> **Tanggal:** 2026-08-31 · **Jenis:** Audit defensif menyeluruh (backend Node, engine Python, Electron, frontend) · **Status dokumen:** Living document.
>
> Penanda status: **`[FIXED]`** = sudah diperbaiki (Prioritas-1, sesi 2026-08-31) · **`[OPEN]`** = belum diperbaiki (butuh tindak lanjut) · **`[INFO]`** = catatan/positif.

---

## 1. Ringkasan Project

| Aspek | Detail |
| :--- | :--- |
| **Jenis** | Alat kontrol akses jaringan LAN: telemetri, ARP spoofing, DNS spoof, transparent gateway/MITM, port scan, credential sniffing, TLS interception |
| **Arsitektur** | React (Vite :5173) → Node/Express+Socket.IO (:5000) → Python/FastAPI (:8001); dibungkus Electron; **SQLite** (better-sqlite3, WAL) |
| **Hak akses** | Seluruh stack berjalan sebagai **Administrator** (wajib Npcap/ARP) — memperbesar dampak setiap celah control-plane |
| **Model keamanan** | Bind loopback + allowlist Origin/Host + (opsional) IPC token. Lisensi bersifat lokal (bukan kontrol akses) |
| **Cakupan audit** | Backend & Python dibaca mendalam pada jalur kritis (validasi input, subprocess/shell, auth, DB, injeksi). Modul discovery/fingerprint tertentu belum dibaca baris-demi-baris (lihat §7) |

---

## 2. File yang Diperiksa

`✅` dibaca penuh · `🔎` bagian kunci · `▫️` inventaris.

- **backend-node:** ✅ `app.ts` ✅ `security.ts` ✅ `api/routes.ts` ✅ `services/pythonBridge.ts` ✅ `services/database.ts` ✅ `services/licenseManager.ts` ✅ `services/deviceManager.ts` ✅ `websocket/index.ts` 🔎 `types/index.ts` ✅ `.env`/`.env.example`/`package.json`
- **python-service:** 🔎 `server.py` (models + rute + middleware) 🔎 `core/spoofer.py` 🔎 `core/shield.py` 🔎 `core/network.py` ✅ `core/interceptor/certs.py` ✅ `core/redirector/portal_server.py` ✅ `main.py` 🔎 `core/scanner.py` ✅ `requirements.txt` ▫️ `dhcp.py, arp.py, multicast.py, liveness.py, ipv6_ndp.py, fingerprint/*, telemetry.py, gaming.py, spoofer_v6.py, transparent_gateway.py, redirector/*, bettercap/*`
- **desktop-electron:** ✅ `main.ts` ✅ `preload.ts`
- **frontend-react:** ✅ `api/client.ts` 🔎 grep XSS-sink seluruh `src/` ▫️ komponen UI (~40 file)

---

## 3. Top 10 Masalah (dengan status)

| # | Prioritas | Status | Lokasi | Masalah | Solusi diterapkan / disarankan |
| :--: | :--: | :--: | :--- | :--- | :--- |
| 1 | 🔴 CRITICAL | **[FIXED]** | `security.ts` | Prefix-match origin mengizinkan `http://localhost.evil.com` → drive-by ke seluruh control-plane tanpa auth | Exact-match via `new URL()` + hostname eksak; tolak `null` |
| 2 | 🔴 CRITICAL | **[FIXED]** | `routes.ts`, `websocket/index.ts`, `server.py` | Control-plane tanpa autentikasi | IPC bearer token (`SENTINEL_API_TOKEN`) di Node & Python + WS |
| 3 | 🟠 HIGH | **[FIXED]** | `spoofer.py` `_ensure_host_gateway_locked` | Command injection: `gateway_ip`/`gateway_mac` tak divalidasi → `shell=True` netsh; engine admin | Validasi RFC1918/MAC di `start()` & fungsi; `subprocess` arg-list `shell=False` |
| 4 | 🟠 HIGH | **[FIXED]** | `shield.py` | `shell=True` dengan `gw_ip`/`gw_mac`/`iface_alias` | Validasi + arg-list + escape alias PowerShell |
| 5 | 🟡 MEDIUM | **[FIXED]** | `desktop-electron/src/main.ts` | Path `stop-all` (404) → ARP korban tak dipulihkan saat exit | Perbaiki ke `stop_all` (+ header token) |
| 6 | 🟡 MEDIUM | **[FIXED]** | `spoofer.py` | `subprocess` tak di-import → gateway ARP lock selalu `NameError` senyap | `import subprocess` |
| 7 | 🟠 HIGH | **[FIXED]** (P2) | `portal_server.py` `_render_landing_html` | `redirect_url`/username direfleksikan tanpa escape ke HTML/JS; `redirect_url` tak divalidasi http(s) → HTML/JS injection ke korban LAN | `sanitize_redirect_url` (whitelist http/https) + `html.escape` (atribut/teks) + `js_string_literal` (escape `< > &` untuk konteks `<script>`, cegah `</script>` breakout) |
| 8 | 🟠 HIGH | **[OPEN]** | `licenseManager.ts` `activateLicenseKey` | Aktivasi menaikkan tier hanya dari prefix string (`PRO`/`SENTINEL`), tanpa kripto | Verifikasi tanda tangan server (RS256/Ed25519) — butuh Cloud API (Roadmap) |
| 9 | 🟡 MEDIUM | **[PARTIAL]** (P2) | `interceptor/certs.py` | Private key Root CA disimpan tanpa enkripsi (`NoEncryption()`) | ✅ Izin file diperketat saat tulis (POSIX `chmod 600` / Windows `icacls`) + gitignore. 🧭 Enkripsi passphrase at-rest tetap Roadmap |
| 10 | 🟡 MEDIUM | **[FIXED]** (P2) | `routes.ts`, `server.py` | `error.message`/`str(e)` bocor ke response | Node `respondError()` (log penuh, pesan generik utk error tak terduga, pertahankan pesan operasional); Python `@app.exception_handler` men-scrub semua 5xx |

---

## 4. Security Findings (detail)

### 🔴 [FIXED] Drive-by protection bypass (CORS prefix-match)
**Sebelum:** `origin.startsWith('http://localhost')` cocok dengan `http://localhost.evil.com`; `hostGuard` lolos karena `fetch` ke `127.0.0.1:5000` mengirim `Host: 127.0.0.1:5000`; `credentials:true` di-echo → situs jahat membaca respons lintas-origin (termasuk `GET /api/bettercap/credentials`).
**Perbaikan:** `isAllowedOrigin` mem-parse URL & mencocokkan `hostname` eksak (`localhost`/`127.0.0.1`/`::1`), `file:` diizinkan, `null` ditolak. Regression test: `backend-node/tests/unit_security.test.ts`.

### 🔴 [FIXED] Control-plane tanpa autentikasi
**Sebelum:** Semua endpoint destruktif & pembacaan credential tanpa auth; loopback satu-satunya penghalang (ditembus oleh finding di atas dari browser, dan tak menghalangi proses lokal lain).
**Perbaikan:** IPC bearer token opsional (`SENTINEL_API_TOKEN`). Node: `apiTokenGuard` + `io.use` handshake. Python: `@app.middleware("http")` + guard WS. Electron auto-generate & inject; `/health` tetap publik. Nonaktif di dev (kompatibel).

### 🟠 [FIXED] Command injection via parameter gateway
**Sebelum:** `start()` memvalidasi `victim_ip`/`victim_mac` saja; `gateway_ip`/`gateway_mac` mengalir ke `f'netsh ... {gateway_ip} {norm_mac}'` dengan `shell=True`. Karena :8001 tanpa auth & engine admin → eksekusi perintah admin dari proses lokal.
**Perbaikan:** Validasi RFC1918/MAC untuk gateway di `start()` dan di dalam fungsi OS; seluruh `netsh`/PowerShell memakai argument-list (`shell=False`). Pola sama di `shield.py`. Test: `test_unit_spoofer.py` (`test_spoof_invalid_gateway_*`, `test_host_gateway_lock_skips_invalid_input`).

### 🟠 [FIXED] (P2) Reflected HTML/JS injection di captive portal
**Sebelum:** `_render_landing_html` menyisipkan `target_url` (=`redirect_url`) & username tanpa escape ke `<meta refresh>`, `window.location.href="{deep_link}"`, `<a href>`, dan `<title>`; `redirect_url` tak divalidasi skema.
**Perbaikan:** `sanitize_redirect_url()` mem-whitelist skema `http/https` (set-time + render + header `Location`); `html.escape(..., quote=True)` untuk konteks atribut/teks; `js_string_literal()` untuk konteks `<script>` — meng-escape `< > &` sehingga `</script>` di dalam URL valid pun tidak dapat menutup blok script (mencegah *script-breakout* yang lolos dari `json.dumps` biasa). Test: `test_redirector.py` (`test_landing_html_*`, `test_sanitize_redirect_url_*`).

### 🟟 [INFO] Sudah benar (positif)
- **SQL 100% parameterized** (`database.ts`) — tidak ada SQL injection (satu-satunya nilai non-parameter = konstanta numerik `OFFLINE_GRACE_SECONDS`).
- **Electron:** `contextIsolation:true`, `nodeIntegration:false`, preload minimal.
- **CORS Python** terkunci default (allowlist kosong, no credentials) → drive-by browser ke :8001 praktis tertutup.
- **Invariant** Gateway/Self immunity, RFC1918 victim, format MAC — sudah ada.
- **Frontend** tanpa `dangerouslySetInnerHTML`/`eval`/`innerHTML`.
- **network.py** subprocess sudah arg-list (bukan shell).

---

## 5. Bug & Potensi Error

1. **[FIXED]** Restorasi ARP saat exit gagal — `main.ts` path `stop-all` (404) → `stop_all`.
2. **[FIXED]** `spoofer.py` `subprocess` tak di-import → gateway kernel lock selalu gagal senyap.
3. **[FIXED]** (P3) `parseInt(req.query.limit)` tanpa guard NaN → helper `parsePositiveInt(value, fallback)` di `routes.ts`.
4. **[FIXED]** (P3) `database.ts` fallback diam ke `:memory:` → kini set flag `usingMemoryFallback`, log peringatan jelas, & di-surface di `GET /health` (`database_persistent: false` + `warnings[]`).
5. **[FIXED]** (P3) Duplikasi handler `ws.on('error')` di `pythonBridge.ts` dihapus.
6. **[FIXED]** (P3) Frontend `client.ts` kini membungkus `ip`/`id` path dengan `encodeURIComponent`.
7. **[OPEN]** Banyak `except:`/`except Exception` telanjang di engine Python. **Ditunda sengaja:** pada daemon jaringan, bare-except sering disengaja untuk ketahanan; perubahan blanket berisiko mengubah perilaku. Sebaiknya ditangani per-kasus dengan `logger.debug`.

---

## 6. Penilaian Kualitas Kode

| Dimensi | Skor (pra-audit → pasca-P1) | Alasan |
| :--- | :--: | :--- |
| Architecture | 8/10 | Pemisahan proses jelas; modular |
| Maintainability | 7/10 | `deviceManager.ts` (1408) & `App.tsx` (1944) besar; duplikasi wrapper |
| Readability | 8/10 | Penamaan deskriptif, komentar dwibahasa |
| **Security** | **4 → 8/10** | P1: drive-by ditutup, control-plane ber-auth, injeksi shell dihilangkan. P2: XSS portal ditutup, error di-sanitasi, izin CA key diperketat. Sisa: verifikasi lisensi kriptografis, enkripsi CA key at-rest, rate-limit/clock-tamper (Roadmap) |
| Performance | 8/10 | Prepared statements, transaksi, single-flight scan, debounce |
| Error Handling | 6/10 | Konsisten di API tapi bocor `error.message`; `except` telanjang |
| Testing | 7/10 | Suite luas (145 Python + 27 Node); kini ada test keamanan |

---

## 7. Rekomendasi (Roadmap sisa)

### Prioritas 2 — Important
1. ✅ **[FIXED]** Escape captive portal + whitelist skema `redirect_url` (`portal_server.py`).
2. 🧭 **[OPEN/Roadmap]** Lisensi: verifikasi tanda tangan server-side (hentikan aktivasi prefix string) — **butuh Cloud API + public key** yang belum ada di repo; tidak diterapkan agar tidak memblokir aktivasi offline user.
3. 🟡 **[PARTIAL]** Root CA key: ✅ izin file diperketat + gitignore; 🧭 enkripsi passphrase at-rest masih Roadmap; auth download CA masih Roadmap.
4. ✅ **[FIXED]** Jangan bocorkan `error.message`/`str(e)` ke klien (Node `respondError`, Python 5xx scrubber).
5. ✅ **[DONE]** `.gitignore` sudah lengkap & benar (secrets/artefak tak ter-track). Sisa opsional: hapus `DB_PASSWORD` usang dari `.env` lokal (gitignored, bukan risiko GitHub).

### Prioritas 3 — Improvement
6. Pecah `deviceManager.ts` & `App.tsx`; hapus duplikasi handler; guard NaN `parseInt`; `encodeURIComponent`; ganti `except:` telanjang dengan logging.
7. Review lanjutan modul Python yang belum dibaca baris-demi-baris (§2 `▫️`): fokus penyimpanan credential (`bettercap/*`), parsing paket tak-tepercaya (`dhcp.py`, `transparent_gateway.py`), potensi DoS.
8. Terapkan item SPEC-010 yang masih Roadmap: rate-limit leaky-bucket eksplisit, anti-clock-tamper (monotonic + NTP), verifikasi JWT asimetris.

---

## 8. Verifikasi Perbaikan (2026-08-31)

**P1:**
- `tsc --noEmit` bersih: `backend-node`, `frontend-react`, `desktop-electron`.
- `python -m py_compile` bersih untuk file yang diubah.
- Unit test Node termasuk `unit_security.test.ts` (exact-origin menolak `localhost.evil.com`, host allowlist, `apiTokenGuard`); Python termasuk 3 test validasi gateway.

**P2:**
- Portal: 4 test baru di `test_redirector.py` (sanitasi skema, escape HTML, tolak `javascript:`, cegah `</script>` breakout di URL https valid).
- CA key: izin diperketat saat generate (`_restrict_key_permissions`).
- Error sanitization: 48 situs Node → `respondError`; Python 5xx di-scrub via `@app.exception_handler`.

**Status akhir test:** **149/149** Python lulus · **27/27** Node lulus · `tsc` bersih di 3 proyek.
