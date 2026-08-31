# SPEC-008: Cloud Authentication, Desktop Licensing & Feature Gating

> **Document Status:** Authoritative Architectural Specification  
> **Target Version:** NetCut Sentinel Client v2.20.0+  
> **Module Scope:** Client Desktop App (`d:/spoorf`) <---> Cloud Platform (`spoorf-web-cloud`)  
> **Governing Invariants:** Gateway Immunity (`is_gateway: true`), Anti Self-Cut (`is_self: true`).

---

## 0. Status Implementasi vs Roadmap (Diperbarui 2026-08-31)

Dokumen ini menggambarkan **visi arsitektur cloud** yang lengkap. Implementasi klien saat ini baru sebagian:

| Kemampuan | Status | Catatan kode |
| :--- | :---: | :--- |
| Tier gating lokal (block/throttle/gateway) | ✅ Implemented | `licenseManager.ts` (`checkCanBlock/Throttle/Gateway`) + guard `deviceManager.ts`. |
| Offline grace via cache SQLite | ✅ Implemented | tabel `license_cache`, `licenseManager.init()`. |
| Login cloud (attempt) + fallback demo | ✅ Sebagian | `login()` menghubungi `api.spoorf.app`; **fallback demo digerbang** `SPOORF_ALLOW_DEMO_LICENSE=true` (nonaktif default). |
| Free tier `max_cuts` | ✅ = **5** | `DEFAULT_FREE_LICENSE.max_cuts = 5` (bukan 1). |
| Verifikasi token asimetris (RS256/Ed25519) offline | 🧭 Roadmap | Token **tidak** diverifikasi kripto; hanya di-cache. |
| Aktivasi key kriptografis | 🧭 Roadmap | `activateLicenseKey` menaikkan tier **berdasarkan prefix string** (`PRO`/`VIP`/`SENTINEL`) — mudah di-bypass; hanya cocok untuk dev/demo. |
| HWID slot enforcement, cloud sync, payment webhook | 🧭 Roadmap | Butuh Cloud API (`spoorf-web-cloud`) yang belum ada di repo ini. |
| Mandatory login gate | 🟡 UI-only | Digate di frontend (`AuthGateScreen.tsx`); backend **tidak** menolak request tanpa login. |

> Lisensi lokal **bukan** kontrol keamanan. Proteksi control-plane yang sebenarnya adalah bind loopback + exact-origin + IPC token (SPEC-010). Lihat [`docs/SECURITY_AUDIT.md`](../SECURITY_AUDIT.md).

---

## 1. System Vision & Module Separation

NetCut Sentinel is organized into two strictly decoupled systems:

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                  1. CLOUD WEB PLATFORM (spoorf-web-cloud - Server Publik)                 |
+───────────────────────────────────────────────────────────────────────────────────────────+
|  • Public Landing Page (Marketing, Value Proposition, Download .exe)                      |
|  • User Account Management (Register, Login, Email Verification, Forgot Password)         |
|  • Payment Gateway Integration (QRIS, Midtrans, Stripe) -> Subscription State             |
|  • License Server & Cryptographic Signing API (`/api/v1/auth`, `/api/v1/license`)         |
|  • Software Release & Auto-Update Registry (`/api/v1/updates`)                           |
+───────────────────────────────────────────────────────────────────────────────────────────+
                                              │
                                  (Signed HTTPS JWT Token)
                                              ▼
+───────────────────────────────────────────────────────────────────────────────────────────+
|                 2. CLIENT DESKTOP APPLICATION (d:/spoorf - PC / Laptop Pengguna)          |
+───────────────────────────────────────────────────────────────────────────────────────────+
|  • Frontend UI (React 18 + Tailwind + Framer Motion):                                     |
|    - Online Login Modal & Auth State Provider                                             |
|    - Subscription Tier Badges (`FREE`, `PRO`, `VIP`)                                      |
|    - Feature Gates (Lock Icons 🔒 on Pro Features, Upgrade Modals)                       |
|  • Local Orchestrator (Node.js 20 + SQLite WAL):                                         |
|    - Token Cache & Offline Grace Period (7 Hari)                                          |
|    - Server-Side Feature Limit Enforcement (Max Block Guard, Throttling Guard)            |
|  • Network Engine (Python 3.11 + Scapy + Npcap):                                          |
|    - Raw Layer 2 ARP Manipulation, Bandwidth Throttling, L2/L3 Packet Injection           |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 2. Feature Tiering Matrix (Pembagian Fitur & Kuota)

| Modul Fitur | 🥉 Free / Starter Tier | 🥇 Pro / Premium Tier | 👑 Enterprise / Lifetime VIP |
| :--- | :---: | :---: | :---: |
| **Pindai Host Jaringan (LAN Discovery)** | ✅ Penuh (ARP + ICMP) | ✅ Super Scan Multi-Threaded | ✅ Ultra-Fast Multi-Subnet |
| **Identifikasi Nama & Vendor** | ✅ Standar Vendor OUI | ✅ Deep DHCP + NetBIOS | ✅ AI OS & Multi-Vendor Host |
| **Pemutusan Akses (ARP Cut-Off)** | ⚠️ **Maksimal 5 Target Aktif** (`max_cuts=5`) | 🚀 **Tanpa Batas (Unlimited)** | 🚀 **Unlimited + One-Click Cut All** |
| **Pembatasan Bandwidth (Throttling)** | ❌ Terkunci (Gembok 🔒) | ✅ Kontrol PWM (1% - 99%) | ✅ Kontrol PWM (1% - 99%) |
| **Auto-Reblock (Anti Ganti MAC)** | ❌ Terkunci (Gembok 🔒) | ✅ Aktif (Perangkap Otomatis) | ✅ Aktif + Instant Re-Kill |
| **Smart Transparent Gateway (Sinkhole)**| ❌ Terkunci (Gembok 🔒) | ✅ DNS Sinkhole & Redirect | ✅ Regex Domain Filter |
| **Port Scanner & Web Preview** | ⚠️ Top 10 Port Standar | ✅ Top 100 Port + Iframe | ✅ Full 65535 Port + Banner |
| **Security Arsenal (CA / Sniffer)** | ❌ Terkunci (Gembok 🔒) | ❌ Terkunci (Gembok 🔒) | ✅ Full Security Suite |
| **Batas Aktivasi Perangkat (HWID)** | 1 Komputer / Laptop | 2 Komputer / Laptop | 5 Komputer / Bisnis |
| **Cloud Backup Alias & Profil** | ❌ Tersimpan Lokal Saja | ✅ Sinkronisasi Cloud Otomatis | ✅ Sinkronisasi Cloud Otomatis |

---

## 3. Communication & Token Security Protocol

### 3.1. Mandatory Login Gate (Gerbang Login Wajib)
- Saat aplikasi desktop pertama kali dijalankan (atau saat sesi SQLite lokal belum ada / expired), aplikasi menampilkan **Layar Login Wajib (Full Auth Gate)**.
- Seluruh engine pemindaian dan manipulasi paket Layer 2 **tidak diizinkan berjalan** sebelum pengguna berhasil masuk.

### 3.2. Frictionless Auto-HWID Device Binding (Pengikatan HWID Otomatis)
- **User-Friendly Experience:** Pengguna **TIDAK PERLU** mengetahui kode HWID atau menyalinnya secara manual.
- Pengguna hanya menginput `email` dan `password` (atau klik register di website).
- Desktop client secara senyap di background mengekstrak HWID unik (`SHA256(hostname + platform + arch + cpu_model + memory)`) dan mengirimkannya bersama kredensial login.
- Cloud Server memvalidasi kuota slot perangkat pengguna:
  - Jika HWID cocok atau slot perangkat masih tersedia (misal: Slot 1/1 untuk Pro, Slot 1/3 untuk Family): HWID otomatis diikat ke akun.
  - Jika kuota slot penuh karena login di komputer lain: Cloud memberikan opsi pemindahan lisensi ramah pengguna (*"Akun aktif di PC lain. Pindahkan lisensi ke perangkat ini?"*).

### 3.3. Authentication Request Payload (Desktop -> Cloud)
```http
POST https://api.spoorf.app/v1/auth/login
Content-Type: application/json

{
  "email": "budi@gmail.com",
  "password": "UserPassword123!",
  "hwid": "9f83a4b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9",
  "device_name": "Laptop Lenovo Legion",
  "app_version": "2.20.0",
  "platform": "win32"
}
```

### 3.4. Authentication Response (Cloud -> Desktop)
```json
{
  "status": "success",
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "usr_90218491",
    "name": "Budi Pratama",
    "email": "budi@gmail.com",
    "avatar_url": "https://cdn.spoorf.app/avatars/usr_90218491.png"
  },
  "license": {
    "tier": "pro",
    "max_cuts": 999,
    "can_throttle": true,
    "can_gateway": true,
    "can_autoreblock": true,
    "can_arsenal": false,
    "cloud_sync": true,
    "expires_at": "2027-08-29T00:00:00Z",
    "grace_period_until": "2026-09-05T18:00:00Z"
  }
}
```

---

## 4. Offline Resilience & Grace Period Mechanism

Karena pengguna sering mengaktifkan NetCut Sentinel saat koneksi internet Wi-Fi mereka sedang lambat atau terganggu oleh pengguna lain di LAN:
1. Token lisensi disimpan secara lokal di SQLite `license_cache`.
2. Token ditandatangani menggunakan **Asymmetric Cryptography (RS256 / Ed25519)** oleh Cloud Server.
3. Backend Node.js lokal memiliki *Public Key* server untuk memverifikasi keaslian token tanpa perlu koneksi internet (*Offline Verification*).
4. Token offline memiliki masa tenggang (**Grace Period 7 Hari**). Selama masa ini, aplikasi tetap berfungsi normal sesuai tingkatan tier yang sudah dibeli.
5. Saat koneksi internet kembali pulih, background scheduler memperbarui masa tenggang secara otomatis (*Silent Heartbeat*).

---

## 5. Client Enforcement Guard (Node.js Backend)

Pada `backend-node/src/services/deviceManager.ts` dan `routes.ts`:
1. **Block Enforcement:**
   ```typescript
   if (license.tier === 'free') {
       const activelyBlockedCount = Array.from(this.devices.values()).filter(d => d.is_blocked).length;
       if (activelyBlockedCount >= license.max_cuts && !targetDevice.is_blocked) {
           // max_cuts default = 5 untuk Free (lihat DEFAULT_FREE_LICENSE)
           throw new FeatureLimitError(`Akun Free dibatasi maksimal ${license.max_cuts} target terblokir. Upgrade ke Pro untuk memutus tanpa batas!`);
       }
   }
   ```
2. **Speed Limit Throttling Enforcement:**
   ```typescript
   if (!license.can_throttle && limit < 100) {
       throw new FeatureLockedError('Fitur Pembatasan Kecepatan (Throttling) khusus untuk pengguna PRO.');
   }
   ```

---

## 6. User Experience & In-App Upgrade Flows

1. **Mandatory Login Gate:**
   - Tampilan pembuka yang bersih dan fokus pada input Email & Password atau pendaftaran akun baru di Web Portal.
2. **Aesthetic Lock Indicators (Gembok Visual):**
   - Slider *Speed Throttling* pada tabel perangkat diberi badge kecil `PRO 🔒`.
   - Tombol *Smart Gateway* dan *Security Arsenal* di Sidebar memiliki tag badge `PRO`.
3. **Upgrade Trigger Modal (High-Conversion UX):**
   - Ketika pengguna gratis mengklik fitur yang terkunci, tampil modal penjelasan manfaat dengan tombol aksi satu-klik:
     `[ Upgrade ke Pro - Mulai Rp 15.000 ]`
   - Mengklik tombol otomatis membuka browser ke halaman checkout pembayaran QRIS/Midtrans di website cloud Anda dengan parameter `?user_id=...&plan=pro`.
4. **Instant Activation Webhook:**
   - Begitu pembayaran terkonfirmasi di server cloud, token lisensi pengguna diperbarui ke `pro`.
   - Desktop app menerima status baru pada *heartbeat* berikutnya (atau saat pengguna menekan tombol *"Refresh Status Lisensi"* di aplikasi desktop).
