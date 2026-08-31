# Troubleshooting & Runbook Guide

Panduan pemecahan masalah operasional dan perbaikan error runtime untuk pengembang dan AI coding agents.

---

## 1. Port Conflict / Zombie Process (`EADDRINUSE`)

### Gejala:
- Error: `[Errno 10048] error while attempting to bind on address ('127.0.0.1', 8001)`
- Error Node.js: `listen EADDRINUSE: address already in use :::5000`

### Solusi Windows PowerShell:
```powershell
# 1. Cari PID proses yang mengunci port (contoh: port 8001 atau 5000)
netstat -ano | findstr :8001
netstat -ano | findstr :5000

# 2. Matikan proses berdasarkan PID (ganti <PID> dengan nomor PID yang ditemukan)
taskkill /F /PID <PID>
```

---

## 2. Scapy Interface Not Detected / Npcap Missing

### Gejala:
- Log Python: `Gagal refresh interface: ..., fallback conf.iface`
- `sendp()` melempar pesan error bahwa antarmuka tidak ditemukan atau tidak memiliki izin raw socket.

### Solusi:
1. Pastikan driver **Npcap** terinstal dengan mode "WinPcap API-compatible Mode" di Windows.
2. Periksa daftar antarmuka yang terdeteksi oleh Scapy:
   ```powershell
   cd d:/spoorf/python-service
   .\venv\Scripts\python.exe -c "from scapy.all import ifaces; print(ifaces)"
   ```
3. Panggil metode `spoofer.refresh_interface()` secara manual untuk memperbarui referensi adapter Scapy.

---

## 3. Database SQLite (Embedded) — Tidak Perlu Server

> **Catatan:** Sejak migrasi ke **SQLite (`better-sqlite3`, WAL)**, tidak ada lagi koneksi PostgreSQL/port 5432. Error `ECONNREFUSED ...:5432` pada dokumen lama sudah tidak relevan.

### Gejala & Solusi:
- **`SQLITE_CANTOPEN` / gagal membuka `data/sentinel.db`:**
  - Pastikan proses punya izin tulis ke folder `backend-node/data/` (dibuat otomatis). Jika file gagal dibuka, backend **fallback ke `:memory:`** (data tidak persist) dan menampilkan peringatan — periksa log.
- **Database terkunci (`SQLITE_BUSY`):**
  - Pastikan tidak ada dua instance backend berjalan bersamaan pada file DB yang sama (Electron memakai `single instance lock`). WAL + `busy_timeout=5000ms` sudah diaktifkan.
- **Reset data:** hentikan aplikasi lalu hapus `backend-node/data/sentinel.db*` (termasuk file `-wal`/`-shm`), atau panggil `DELETE /api/devices/reset`.
- **401 Unauthorized saat memanggil API:** IPC token aktif (`SENTINEL_API_TOKEN`) — sertakan header `x-sentinel-token`, atau jalankan tanpa token di mode dev (lihat DEPLOYMENT §4.1).

---

## 4. Stale ARP Cache / Network Roaming Desync

### Gejala:
- Laptop berpindah Wi-Fi dari SSID `Home` ke `Office`, tetapi target di tabel masih menampilkan perangkat dari Wi-Fi lama.

### Solusi:
1. **Network Watchdog Otomatis**: Watchdog di `python-service/src/server.py` secara otomatis memeriksa pergantian gateway setiap 10 detik. Begitu gateway berubah, watchdog memanggil `spoofer.stop_all()` dan menyiarkan event `network_changed`.
2. **Manual Flush ARP Windows**:
   ```powershell
   arp -d *
   ```

---

## 5. Lock Contention / Freezing REST API

### Gejala:
- Endpoint `GET /api/status` atau `POST /api/scan` sempat macet (*hang*) selama 0,5 – 1 detik saat operator mengklik tombol unblock.

### Solusi Arsitektural (v2.1 Fix):
- Pastikan logika pada `python-service/src/core/spoofer.py` mempertahankan pola pemisahan mutasi state:
  ```python
  # BENAR:
  with self._lock:
      del self._sessions[session_id]
      stop_event.set()
  
  # Transmisi paket restorasi DI LUAR LOCK:
  for _ in range(6):
      sendp(pkt_restore)
  ```
