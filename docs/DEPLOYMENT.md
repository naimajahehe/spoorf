# NetCut Sentinel (Spoorf) - Setup & Deployment Guide

Panduan instalasi, konfigurasi, dan pengoperasian **NetCut Sentinel** di lingkungan pengembangan maupun produksi (Windows OS).

---

## 1. Prasyarat Sistem (*System Requirements*)

| Komponen | Spesifikasi Minimum | Keterangan |
| :--- | :--- | :--- |
| **Sistem Operasi** | Windows 10 / 11 (64-bit) | Membutuhkan hak akses Administrator untuk injeksi paket L2 |
| **Driver Jaringan** | **Npcap 1.70+** | **Wajib diinstal** dengan opsi *"Support raw 802.11 traffic"* dicentang |
| **Python** | Python 3.10 atau 3.11 (64-bit) | Terpasang modul `scapy`, `fastapi`, `uvicorn`, `psutil` |
| **Node.js** | Node.js 18 LTS atau 20+ | Runtime backend Express dan Socket.IO |
| **Database** | **SQLite (embedded)** | Zero-config via `better-sqlite3` (WAL). Tidak perlu server/port; file otomatis dibuat di `data/sentinel.db` |

> [!IMPORTANT]
> **Pemasangan Driver Npcap:**
> Scapy dan packet sniffer membutuhkan Npcap untuk mengirim paket ARP kustom. Unduh installer resmi di [npcap.com](https://npcap.com/#download) dan pastikan opsi **"Install Npcap in WinPcap API-compatible Mode"** aktif.

---

## 2. Langkah-Langkah Instalasi

### Langkah 1: Database (SQLite — Zero-Config)
Tidak ada langkah instalasi database. Backend Node memakai **SQLite embedded** (`better-sqlite3`, WAL) dan **otomatis membuat** file `data/sentinel.db` beserta skema tabel saat pertama kali dijalankan. Lokasi file dapat di-override via env `DB_FILE` atau `SENTINEL_DB_PATH`.

---

### Langkah 2: Setup Python Microservice (`python-service`)
1. Masuk ke direktori `python-service`:
   ```bash
   cd python-service
   ```
2. Buat dan aktifkan virtual environment:
   ```powershell
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   ```
3. Pasang seluruh dependensi (versi ter-pin di `requirements.txt`):
   ```bash
   pip install -r requirements.txt
   ```

---

### Langkah 3: Setup Node.js Backend (`backend-node`)
1. Masuk ke direktori `backend-node`:
   ```bash
   cd ..\backend-node
   ```
2. Pasang dependensi npm:
   ```bash
   npm install
   ```
3. Buat file `.env` (salin dari `.env.example`). SQLite tidak perlu kredensial DB:
   ```ini
   PORT=5000
   HOST=127.0.0.1
   PYTHON_SERVICE_URL=http://127.0.0.1:8001

   # Keamanan (P1) — origin browser tambahan (selain loopback yang sudah diizinkan)
   ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
   # Lisensi demo/uji (JANGAN true di produksi)
   SPOORF_ALLOW_DEMO_LICENSE=false

   # (Opsional) lokasi file SQLite; default data/sentinel.db
   # DB_FILE=data/sentinel.db
   ```
   > **DB_PASSWORD / DB_HOST / DB_PORT tidak lagi dibaca** (sisa migrasi PostgreSQL). Hapus dari `.env` bila masih ada.
4. Kompilasi TypeScript:
   ```bash
   npm run build
   ```

---

### Langkah 4: Setup Frontend React (`frontend-react`)
1. Masuk ke direktori `frontend-react`:
   ```bash
   cd ..\frontend-react
   ```
2. Pasang dependensi npm:
   ```bash
   npm install
   ```
3. Kompilasi production bundle:
   ```bash
   npm run build
   ```

---

## 3. Cara Menjalankan Aplikasi (*Run Guide*)

Jalankan terminal **sebagai Administrator** (*Run as Administrator*):

### Opsi A: Mode Otomatis (Node.js Meluncurkan Python Otomatis)
Cukup jalankan backend Node.js, sistem akan otomatis mendeteksi dan meluncurkan microservice Python:
```bash
cd d:\spoorf\backend-node
npm start
# atau
node dist/app.js
```

### Opsi B: Menjalankan Servis Secara Terpisah (Disarankan untuk Debugging)
1. **Terminal 1 (Python Microservice - Port 8001)**:
   ```powershell
   cd d:\spoorf\python-service
   .\venv\Scripts\python.exe -m src.main
   ```
2. **Terminal 2 (Node.js Backend - Port 5000)**:
   ```powershell
   cd d:\spoorf\backend-node
   npm start
   ```
3. **Terminal 3 (Frontend React - Port 5173)**:
   ```powershell
   cd d:\spoorf\frontend-react
   npm run dev
   ```

Buka peramban di **`http://localhost:5173`** (atau port server yang aktif).

---

## 4. Konfigurasi Keamanan & Environment (P1)

### 4.1. IPC Bearer Token (`SENTINEL_API_TOKEN`)
Control-plane (Node :5000 & Python :8001) dikunci token bearer lokal **bila** env `SENTINEL_API_TOKEN` diset.

- **Aplikasi Electron (produksi):** token **otomatis di-generate** (`crypto.randomBytes(32)`) tiap sesi dan disuntikkan ke Node, Python, dan renderer — tidak perlu konfigurasi manual.
- **Mode dev (3 terminal terpisah):** secara default token **tidak diset** → guard nonaktif (kompatibel). Untuk menguji auth secara manual, set env yang **sama** di ketiga proses, mis.:
  ```powershell
  $env:SENTINEL_API_TOKEN = "dev-token-uji-123"   # jalankan di tiap terminal sebelum start
  ```
  Klien lalu wajib mengirim header `x-sentinel-token: dev-token-uji-123` (browser dev biasa tidak memilikinya, jadi biarkan kosong saat dev normal).

### 4.2. `.gitignore` (Wajib sebelum `git init`)
Repo ini belum berupa git repo. Sebelum meng-commit, buat `.gitignore` yang mengecualikan file sensitif/berat:
```gitignore
# Secrets & data
**/.env
python-service/certs/            # Private key Root CA — JANGAN pernah di-commit
backend-node/data/*.db*          # SQLite (WAL/SHM)
# Dependencies & build artifacts
**/node_modules/
python-service/venv/
**/dist/
desktop-electron/dist-installer/
desktop-electron/dist-electron/
```

---

## 5. Panduan Mengatasi Masalah (*Troubleshooting*)

- **Layar Siaga "Koneksi Wi-Fi Diperlukan" Muncul Padahal Sudah Online:**
  - Pastikan adapter Wi-Fi Windows aktif dan terbaca di `netsh wlan show interfaces`.
  - Jika baru saja berpindah jaringan (SSID baru), tekan tombol **`Periksa Ulang Wi-Fi`**.
- **Error Npcap / Scapy Permission Denied:**
  - Pastikan terminal PowerShell dijalankan sebagai **Administrator**.
- **Konflik Port 8000 / 8001:**
  - Microservice Python berjalan secara default di port **`8001`**. Jika ingin mengubah, sesuaikan variabel `PYTHON_SERVICE_URL` di `backend-node/.env`.
