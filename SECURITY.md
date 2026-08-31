# Security Policy — NetCut Sentinel (Spoorf)

> Terakhir diperbarui: **2026-08-31**. Ringkasan model ancaman, kontrol yang **sudah** diterapkan, dan cara melapor. Audit lengkap: [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md).

## Penggunaan yang Sah (Authorized Use Only)

Spoorf adalah alat kontrol akses jaringan Layer‑2 (ARP spoofing, DNS spoof, transparent gateway/MITM, port scan, credential sniffing). Alat ini **hanya** boleh dijalankan pada **jaringan milik sendiri atau yang Anda punya izin eksplisit** untuk mengujinya. Penyalahgunaan terhadap jaringan pihak lain dapat melanggar hukum (mis. UU ITE). Alat membutuhkan hak **Administrator** + driver **Npcap**.

## Batas Kepercayaan (Trust Boundary)

- **Node orchestrator** (`127.0.0.1:5000`) dan **Python engine** (`127.0.0.1:8001`) hanya bind ke **loopback**.
- Seluruh stack berjalan sebagai **Administrator** — karena itu setiap celah di control‑plane bernilai tinggi.
- **Lisensi lokal bukan kontrol keamanan.** Ia hanya menggerbang fitur (monetisasi), bukan melindungi pengguna.

## Kontrol Keamanan yang Diterapkan (Implemented)

| Kontrol | Lokasi |
| :--- | :--- |
| **Exact‑match Origin/Host** (anti drive‑by & DNS‑rebinding) | `backend-node/src/security.ts` (`isAllowedOrigin`, `isAllowedHost`) |
| **IPC Bearer Token** (`SENTINEL_API_TOKEN`) di Node & Python | `security.ts` (`apiTokenGuard`), `websocket/index.ts`, `server.py` (`api_token_guard`) |
| **Validasi input sebelum paket/OS** (victim **dan** gateway: RFC 1918 + MAC) | `python-service/src/core/spoofer.py`, `network.py` |
| **Eksekusi OS tanpa shell** (`subprocess` argument‑list, bukan `shell=True`) | `spoofer.py`, `shield.py` |
| **SQL parameterized** (better‑sqlite3, tanpa string‑interpolation) | `backend-node/src/services/database.ts` |
| **Electron hardening** (`contextIsolation: true`, `nodeIntegration: false`) | `desktop-electron/src/main.ts`, `preload.ts` |
| **Gateway/Self immunity** (anti self‑cut) & isolasi subnet | `spoofer.py`, `deviceManager.ts` |

### IPC Bearer Token — cara kerja
Aktif **hanya bila** env `SENTINEL_API_TOKEN` diset. Aplikasi Electron meng‑generate token (`crypto.randomBytes(32)`) tiap sesi dan menyuntikkannya ke Node, Python, dan renderer. Saat aktif, setiap request `/api/*` (kecuali `/health`, `/api/health`) wajib header `x-sentinel-token`; WebSocket mengirimnya via `auth`/header. Di mode dev tanpa Electron token tidak diset → guard nonaktif (kompatibel).

## Isu Terbuka yang Diketahui (Roadmap / OPEN)

Lihat [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) untuk detail. Ringkas:

- **Root CA key tanpa enkripsi at‑rest** (`python-service/certs/spoorf-ca-key.pem`) — lindungi ACL / enkripsi.
- **Verifikasi lisensi kriptografis** (RS256/Ed25519) belum ada; aktivasi key berbasis prefix string (dev/demo).
- **Anti clock‑tamper** (monotonic + NTP), **rate‑limit leaky‑bucket** eksplisit — belum ada.
- **Kebocoran pesan error** (`error.message`/`str(e)`) ke response — sebaiknya digeneralisasi.

## Melaporkan Kerentanan

Laporkan secara privat kepada pemilik repositori (jangan buka issue publik untuk kerentanan yang bisa dieksploitasi). Sertakan: komponen, langkah reproduksi minimal, dan dampak. Jangan sertakan exploit yang berfungsi penuh pada laporan publik.
