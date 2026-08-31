# SPEC-011: Future Innovations, Advanced Network Features & Viral Roadmap

> **Document Status:** Authoritative Roadmap Specification (Future Milestones)  
> **Target Version:** Spoorf Sentinel v2.22.0+ / Mobile Companion v1.0  
> **Scope:** Killer Network Features, Viral Growth Engine, Web Remote Companion, Notification Webhooks

---

## 1. Killer Network Innovations

### 1.1. Game Ping Guard & Zoom VIP Lane (One-Click Ping Stabilizer)
- **Problem Statement:** Saat pengguna sedang bermain game online kompetitif (Valorant, MLBB, Dota 2) atau meeting Zoom/Teams, lonjakan latency (ping spike > 300ms) kerap terjadi akibat perangkat lain di LAN memulai unduhan besar.
- **Architectural Solution:**
  - Background Telemetry mengukur jitter & ICMP gateway latency setiap 500ms.
  - Saat tombol *Gaming Mode* diaktifkan dan latency melampaui ambang batas (> 40ms): Engine secara otomatis menerapkan *Micro-PWM Throttling (25% duty cycle)* pada IP non-controller yang mengalami lonjakan throughput tertinggi.
  - Begitu latency kembali normal (< 25ms), pembatasan otomatis dilepaskan (*Self-Healing Flow*).

### 1.2. Smart Auto-Balancer (Fair-Share Bandwidth Distribution)
- **Problem Statement:** Memutus target secara total (*0% cut-off*) sering menimbulkan kecurigaan dan konflik antar pengguna di lingkungan kosan/kafe.
- **Architectural Solution:**
  - Mode *Auto-Balancer* mendeteksi total estimasi bandwidth gateway dan membagi rata alokasi kecepatan secara halus (misal: 1 - 2 Mbps per target) menggunakan perulangan PWM terdistribusi di Python engine.
  - Target tetap dapat melakukan chat/browsing ringan tanpa dapat memonopoli seluruh pipa bandwidth.

### 1.3. Ghost / Stealth Mode (Anti-Detection Engine)
- **Problem Statement:** Administrator jaringan profesional yang menggunakan router Mikrotik / Ubiquiti atau software Wireshark dapat melihat log peringatan banjir ARP (*ARP Poisoning Alarm*).
- **Architectural Solution:**
  - *Adaptive Pulse Timing:* Setelah target berhasil diputus dari gateway, interval injeksi paket ARP diturunkan dari 1 paket/detik menjadi hanya 1 paket per 5-10 detik (*Silent Keep-Alive*).
  - *Randomized Jitter & Micro-Delays:* Jeda antar paket diacak (misal 35ms - 85ms) untuk menyamarkan pola injeksi seperti lalu lintas ARP natural sistem operasi.

### 1.4. Scheduled Automation & Local Parental Control
- Aturan otomatis berbasis jadwal (Cron di backend Node.js):
  - Membatasi kecepatan atau memutus perangkat tertentu (Smart TV, iPad anak, konsol game) pada rentang waktu spesifik (misal: pukul 22.00 - 05.00 WIB).

---

## 2. Viral Growth & Modern Monetization Engine

### 2.1. Freemium Referral Engine (Ajak Teman = Pro 3 Hari)
- Setiap akun memiliki kode rujukan unik (`ref_code`).
- Ketika teman mengunduh desktop client dan login menggunakan kode rujukan:
  - Pengguna Pengajak (*Referrer*): Mendapatkan bonus **Pro Pass 3 Hari**.
  - Pengguna Baru (*Referee*): Mendapatkan bonus **Pro Pass 3 Hari**.
- Menciptakan efek viralitas organik di lingkungan kampus, asrama, dan komunitas gaming.

### 2.2. Micro-Transaction Daily Pass (QRIS Rp 2.000 / 24 Jam)
- Menjangkau segmen mahasiswa/pelajar yang membutuhkan akses Pro instan untuk kebutuhan mendesak (misal: unduh tugas/skripsi di kafe atau turnamen game):
  - **Daily Pass (24 Jam):** Rp 2.000 via QRIS instan.
  - **Monthly Pro Pass (30 Hari):** Rp 20.000 / bulan.
  - **Lifetime VIP License:** Rp 75.000 (Permanen).

---

## 3. Multi-Device Web Remote Companion (Kendali via HP)

```mermaid
flowchart LR
    A["💻 Laptop Operator (Desktop di Meja)"] <-->|Local Web Server :5000 (PIN Auth)| B["📱 Smartphone Pengguna (Browser di Tempat Tidur)"]
```

- **Fitur:** Desktop app menampilkan QR Code lokal di layar.
- **Penggunaan:** Pengguna cukup memindai QR Code dengan kamera smartphone (Android/iPhone).
- **Hasil:** Membuka Web Dashboard ringan (PWA) di browser HP dengan autentikasi PIN 4-digit. Pengguna dapat memantau host dan memutus perangkat pengganggu langsung dari smartphone tanpa perlu menyentuh laptop.

---

## 4. Telegram & Discord Bot Notification Webhook

- Pengguna dapat memasukkan Webhook ID Telegram / Discord di pengaturan:
  - **Peringatan Perangkat Asing:** Notifikasi instan saat ada perangkat baru / MAC tak dikenal yang bergabung ke Wi-Fi.
  - **Peringatan Rogue DHCP:** Notifikasi saat ada serangan Rogue DHCP atau Wi-Fi Evil Twin di jaringan.
  - **Action Button:** Tombol inline di Telegram untuk memutus perangkat penyusup secara remote.

---

## 5. Mini Floating Ping & Speedometer Overlay

- Widget transparan minimalis yang melayang di atas game/aplikasi layar penuh (seperti overlay Discord/Fraps):
  - Menampilkan: Ping Jaringan (ms), Kecepatan Download/Upload (Mbps), dan Tombol Cepat *"Boost My Wi-Fi"*.
