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

---

## 6. State Flapping (Osilasi Online ↔ Offline pada Host Mati / Stale ARP Cache)

### Gejala:
- Perangkat (seperti IP `10.40.151.1` atau host phantom/mati) terus menerus berganti status di UI antara **Online (Hijau)** dan **Offline (Abu-abu)**.
- Di terminal / log service muncul pola periodik berulang:
  ```text
  Watchdog detected offline device: 10.40.151.1 (4 miss berturut-turut)
  ...
  SCAN SELESAI! Ditemukan 3 perangkat aktif di jaringan
  ...
  Watchdog detected offline device: 10.40.151.1 (4 miss berturut-turut)
  ```

### Akar Masalah (Root Cause):
1. **Asumsi Keliru Scanner (`scanner.py` & `arp.py`)**:
   - `collect_from_arp_cache(discovered)` membaca cache kernel `arp -a` Windows secara pasif dan langsung memasukkan entri ke dalam daftar `discovered`.
   - Di `_build_device`, variabel `is_active_layer2` di-*hardcode* bernilai `True`. Akibatnya, meskipun host tidak membalas ICMP ping (`ping['alive'] == False`) dan tidak membalas port scan TCP/UDP, scanner tetap memvonis host tersebut `is_online: True`.
   - Node.js menerima hasil scan ini dan langsung memperbarui database SQLite (`is_online = 1`) serta UI menjadi **ONLINE**.
2. **Uji Nyata Fisik Watchdog (`liveness.py`)**:
   - `liveness_daemon` menjalankan `pulse_host` tiap 10 detik dengan balapan tri-vektor (ARP burst, ICMP, UDP/IPv6).
   - Karena host fisik mati atau tidak terhubung, semua 3 vektor gagal (`is_alive: False`).
   - Setelah 4 miss berturut-turut, Watchdog menembakkan event `device_offline_pulse` ke Node.js, mengubah status menjadi `is_online = 0` (UI berubah **OFFLINE**).
3. **Flapping Loop**:
   - Siklus scan berikutnya kembali membaca tabel `arp -a` Windows yang belum kedaluwarsa $\rightarrow$ memaksa status ONLINE lagi $\rightarrow$ Watchdog mendeteksi 4 miss lagi $\rightarrow$ memaksa OFFLINE.

### Solusi Arsitektural 100% (3 Pilar):
1. **Pilar 1 (Verifikasi Aktif untuk Entri Pasif ARP di `scanner.py`)**:
   - Entri dari `arp -a` kernel Windows adalah data pasif/historis.
   - Pada `_build_device`, jika host gagal di-ping (`ping['alive'] == False`) dan tidak memiliki bukti paket masuk aktif (bukan dari mDNS, SSDP, DHCP, atau IPv6 NDP), lakukan uji denyut Layer 2 cepat (`pulse_host` / ARP burst).
   - Jika host tidak membalas verifikasi aktif L2, perangkat ditandai `is_online: False` dan **tidak dimasukkan** ke dalam daftar `devices` aktif hasil scan.
2. **Pilar 2 (Sinergi State Database di `database.ts`)**:
   - Arsitektur Spoorf menetapkan bahwa `scan_full()` hanya mengembalikan perangkat yang **benar-benar aktif**.
   - Perangkat yang tidak ada dalam hasil scan otomatis ditandai `is_online = 0` oleh SQLite reconciliation (`syncScanResults`), namun data profil, MAC, alias, dan vendor tetap tersimpan di database dan tampil di tab Offline.
3. **Pilar 3 (Histeresis & Pembersihan Watchdog di `liveness.py`)**:
   - Karena perangkat mati tidak lagi dilaporkan oleh scanner, `liveness_daemon.update_tracked_devices()` otomatis menghentikan pemantauannya, mencegah miss berulang dan log spam.
   - Event `device_offline_pulse` hanya ditembakkan saat terjadi transisi status (`misses == self._offline_threshold`).
