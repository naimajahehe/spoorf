# NetCut Sentinel (Spoorf) - API & WebSocket Specification

Dokumen ini memuat dokumentasi lengkap antarmuka pemrograman aplikasi (API) untuk **Python Microservice (FastAPI :8001)** dan **Node.js Orchestrator (:5000)** beserta skema event WebSocket.

---

## 0. Autentikasi & Model Keamanan (P1 — 2026-08-31)

Kedua service **bind ke loopback** (`127.0.0.1`) saja. Sebagai lapisan tambahan:

- **Node (:5000):** allowlist **Origin/Host exact-match** (anti drive-by & DNS-rebinding) + **IPC Bearer Token** opsional.
- **Python (:8001):** CORS terkunci (browser tidak boleh memanggil langsung) + **IPC Bearer Token** opsional.

**IPC Bearer Token** aktif **hanya bila** environment `SENTINEL_API_TOKEN` diset. Aplikasi Electron meng-generate token (`crypto.randomBytes(32)`) dan menyuntikkannya ke Node, Python, dan renderer. Saat aktif:

- Sertakan header **`x-sentinel-token: <token>`** pada setiap request REST.
- WebSocket Node (Socket.IO): kirim via `io(url, { auth: { token } })`. WebSocket Python: header `x-sentinel-token` atau query `?token=`.
- Endpoint **publik tanpa token**: `GET /health` (Node & Python) dan `GET /api/health` (Node) — untuk readiness probe.
- Tanpa token / token salah → **`401 Unauthorized`** (`{ "success": false, "error": "Unauthorized: ..." }`).

Pada mode dev (`npm run dev` tanpa Electron), `SENTINEL_API_TOKEN` tidak diset → guard **nonaktif** (kompatibel mundur).

---

## 1. Python FastAPI Microservice (`http://127.0.0.1:8001`)

### Endpoint Kesehatan & Status
- **`GET /health`**
  - **Deskripsi**: Memeriksa kesiapan layanan mikroservis Python.
  - **Response `200 OK`**:
    ```json
    { "status": "ok", "engine": "FastAPI Microservice (Modular v2.1)", "timestamp": 1724720000.0 }
    ```

- **`GET /api/wifi`**
  - **Deskripsi**: Mengambil status koneksi Wi-Fi natif Windows (SSID, sinyal, link-state).
  - **Response `200 OK`**:
    ```json
    {
      "success": true,
      "wifi": {
        "connected": true,
        "ssid": "naim's",
        "signal": "99%",
        "state": "connected"
      }
    }
    ```

- **`GET /api/telemetry`**
  - **Deskripsi**: Mengambil pembacaan telemetri riil dari `psutil` (kecepatan download/upload Mbps & latensi ping).
  - **Response `200 OK`**:
    ```json
    {
      "success": true,
      "telemetry": {
        "connected": true,
        "ssid": "naim's",
        "signal": "99%",
        "download": 1.45,
        "upload": 0.28,
        "latency": 14,
        "timestamp": 1724720000000
      }
    }
    ```

- **`GET /api/status`**
  - **Deskripsi**: Mengambil daftar sesi spoofing ARP aktif dan jumlah paket yang telah diinjeksi.

### Endpoint Pemindaian & Kontrol Akses
- **`POST /api/scan`**
  - **Deskripsi**: Menjalankan pemindaian jaringan multi-sensor di latar belakang (non-blocking thread pool).
  - **Response `200 OK`**:
    ```json
    {
      "success": true,
      "count": 4,
      "devices": [
        {
          "ip": "172.18.138.103",
          "mac": "aa:5b:40:a3:7e:d0",
          "hostname": "Gateway",
          "is_gateway": true,
          "is_online": true
        },
        {
          "ip": "172.18.138.150",
          "mac": "a8:3b:76:0c:dc:55",
          "hostname": "LAPTOP-80Q3FOMC",
          "is_gateway": false,
          "is_self": true,
          "is_online": true
        }
      ]
    }
    ```

- **`POST /api/spoof/start`**
  - **Body** (nama field aktual = `victim_*`, sesuai Pydantic `SpoofStartRequest`):
    ```json
    {
      "victim_ip": "172.18.138.116",
      "victim_mac": "8e:0b:7d:d3:64:43",
      "gateway_ip": "172.18.138.103",
      "gateway_mac": "aa:5b:40:a3:7e:d0",
      "speed_limit": 0,
      "victim_ipv6": null,
      "gateway_ipv6": null,
      "blackhole": false
    }
    ```
  - **Validasi (P1):** `victim_ip` & `gateway_ip` wajib RFC 1918; `victim_mac` & `gateway_mac` wajib format MAC 6-oktet; victim ≠ gateway ≠ controller. Gagal → `SpoofError` (HTTP 500 dengan pesan).
  - **Response `200 OK`**: `{ "success": true, "data": { "session_id": "192.168.1.116_1788160000" } }`

- **`POST /api/spoof/stop`**
  - **Body**: `{ "session_id": "192.168.1.116_1788160000" }`
  - **Response `200 OK`**: `{ "success": true, "message": "Session ... stopped" }`
  - **Response idempoten `200 OK`** untuk sesi yang tidak ada atau sudah
    dibersihkan: `{ "success": true, "already_stopped": true, "message": "Session ... already stopped" }`
  - **Semantik cleanup**: Sesi dihapus hanya setelah restorasi ARP berhasil.
    Bila restorasi gagal, endpoint mengembalikan error dan mempertahankan sesi
    nonaktif dengan ID yang sama agar panggilan `stop` berikutnya dapat
    mengulangi restorasi. `SessionNotFoundError` dari sesi yang tidak ada atau
    sudah berhasil dibersihkan dinormalisasi oleh endpoint menjadi respons
    sukses idempoten dengan `already_stopped: true`; kegagalan restorasi lain
    tetap dikembalikan sebagai error.

- **`POST /api/spoof/restore`**
  - **Body**: `{ "session_id": "192.168.1.116_1788160000" }` (model `SpoofStopRequest` — hanya `session_id`)
  - **Response `200 OK`**: `{ "success": true }`

- **`POST /api/spoof/stop_all`**
  - **Deskripsi**: Menghentikan semua sesi & memulihkan tabel ARP (dipanggil saat shutdown). Perhatikan **underscore** (`stop_all`), bukan `stop-all`.
  - **Response `200 OK`**: `{ "success": true }`

### WebSocket Python (`ws://127.0.0.1:8001/ws/events`)
- **Event `telemetry` (Setiap 1 Detik)**:
  ```json
  {
    "event": "telemetry",
    "data": {
      "connected": true,
      "ssid": "naim's",
      "signal": "99%",
      "download": 2.10,
      "upload": 0.45,
      "latency": 12,
      "timestamp": 1724720000000
    }
  }
  ```
- **Event `network_changed`**:
  ```json
  {
    "event": "network_changed",
    "data": { "old_gateway": "192.168.110.1", "new_gateway": "172.18.138.103" }
  }
  ```

---

## 2. Node.js Backend API (`http://localhost:5000`)

### Endpoint REST
| Method | Path | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/health`, `/api/health` | Pemeriksaan kesehatan server Node.js & engine (publik, tanpa token) |
| `GET` | `/api/wifi` | Informasi status Wi-Fi dengan fallback native Windows |
| `GET` | `/api/telemetry` | Data throughput download/upload riil & latensi |
| `GET` | `/api/devices` | Mengambil seluruh daftar perangkat di subnet aktif |
| `GET` | `/api/gateway` | Mengambil info gateway aktif saat ini |
| `GET` | `/api/scan` | Memicu pemindaian baru & menyelaraskan ke SQLite |
| `POST`| `/api/devices/:ip/block` | Memblokir akses internet perangkat target |
| `POST`| `/api/devices/:ip/unblock` | Memulihkan akses internet perangkat target |
| `DELETE` | `/api/devices/:mac` | Menghapus riwayat perangkat dari SQLite (*Forget Device*) |

> **Catatan:** Endpoint di atas hanyalah subset inti. Terdapat pula rute Shield (`/api/shield/*`), Gaming (`/api/gaming/*`), Transparent Gateway (`/api/gateway/*`), Bettercap Suite (`/api/bettercap/*`), L7 Interceptor (`/api/interceptor/*`), dan Auth/License (`/api/auth/*`). Semua (kecuali `/health` & `/api/health`) tunduk pada IPC token bila aktif (lihat §0).

### Bettercap DNS Configuration
- **`GET /api/bettercap/dns/rules`**
  - **Deskripsi**: Mengambil rules DNS serta konfigurasi spoof-all saat ini.
  - **Response `200 OK`**:
    ```json
    {
      "success": true,
      "rules": [],
      "spoof_all_enabled": false,
      "spoof_all_address": "",
      "default_ttl": 10
    }
    ```
  - Node meneruskan objek konfigurasi Python secara utuh. Field
    `spoof_all_enabled`, `spoof_all_address`, dan `default_ttl` tidak boleh
    dihilangkan saat meneruskan respons.

### Skema Event Socket.IO (`ws://localhost:5000`)
- **`devices`**: Dikirim saat klien browser baru terhubung (berisi list perangkat).
- **`devicesUpdate`**: Dikirim saat ada perubahan daftar perangkat hasil pemindaian.
- **`deviceUpdate`**: Dikirim saat satu perangkat berubah status (misal: terblokir / dipulihkan).
- **`deviceDisconnected`**: Dikirim saat perangkat menjadi offline.
- **`autoReblocked`**: Dikirim saat target terblokir terdeteksi kembali ke jaringan dan dicegat seketika.
- **`dhcpEvent`**: Aktivitas DHCP yang dinormalisasi; release berbentuk
  `{ "kind": "release", "mac": "...", "ip": "..." }`.
- **`shieldStatusChanged`**: Objek status Shield setelah enable/disable.
- **`arpThreatDetected`**: Objek threat ARP dari Shield.
- **`telemetryStream`**: Disiarkan setiap 1 detik berisi kecepatan Mbps unduh/unggah & latensi ms.
- **`wifiStatus`**: Disiarkan saat ada perubahan pada link-state Wi-Fi atau nama SSID.

### Graceful Shutdown

Node menggunakan satu handler cleanup yang sama untuk `SIGINT` dan `SIGTERM`.
Handler tersebut hanya berjalan sekali, mencoba `pythonBridge.stopAll()` agar
sesi ARP dipulihkan, lalu menghentikan bridge, menutup SQLite dan HTTP server.
Kegagalan cleanup saat proses berhenti dicatat sebagai peringatan agar langkah
cleanup berikutnya tetap dijalankan.
