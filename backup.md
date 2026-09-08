# DOKUMEN BACKUP: RIWAYAT COMMIT & PERBAIKAN SEBELUM ROLLBACK

> **Tanggal Dibuat:** 2026-09-07 22:57:00 +08:00  
> **Titik Rollback Target:** `8b5aadd149fcb22262ef58897aa048a1d7cbe22b`  
> *Pesan Commit Target:* `feat(ipv6): gate IPv6 discovery on local capability + show IPv4/IPv6 label under Wi-Fi name` (5 September 2026)  
> **Branch Cadangan Pemulihan (Git Recovery Branch):** `backup-pre-rollback-all-fixes` (HEAD: `b721dbd`)  

---

## 1. Ringkasan Tindakan & Tujuan Rollback

Pengguna meminta pengembalian repositori secara murni (*pure rollback*) ke titik sebelum implementasi pembatasan fitur scan manual dan Auto Scan berdasarkan tier pengguna (`free`, `pro`, `vip`).
Implementasi pembatasan tier scan dimulai pada commit `6d27a27` (*feat(scan): make Auto Scan a real gated feature; free tier is scan-only*).

Dokumen ini mencatat secara menyeluruh seluruh **31 commit perbaikan dan fitur besar** yang berada di atas commit `8b5aadd` agar sewaktu-waktu dapat dipulihkan atau di-*cherry-pick* kembali. Seluruh commit ini juga tersimpan aman di branch lokal Git: **`backup-pre-rollback-all-fixes`**.

---

## 2. Rangkuman Perbaikan & Fitur Besar yang Dilepas

Berikut adalah rekapitulasi subsistem penting yang ada di commit-commit ini dan akan kembali ke kondisi 5 September 2026 setelah rollback:

### A. Performa Scanner & Discovery
1. **Percepatan Scan L2 dari 59 Detik ke ~2 Detik (`e2409f1`):**
   * *Sebelum commit ini (di `8b5aadd`):* Scanner Scapy menggunakan broadcast `srp(Ether/ARP)` yang memakan waktu 59 detik pada subnet `/24` dan memicu latensi tinggi.
   * *Setelah commit ini:* Menggunakan kernel ARP table cache Windows via PowerShell/Get-NetNeighbor dan thread pool yang selesai dalam ~2 detik.
2. **Dynamic Interface Alias & GUID Resolver (`66eccc0`, `f18dd3c`):**
   * Menyelesaikan masalah nama adapter Npcap GUID vs Windows friendly alias untuk Windows Netsh Shield.

### B. Efektivitas ARP Spoofing & L2 Traffic Control
1. **Dual-Opcode Poison Injection (`ca50ef9`):**
   * Menginjeksi dua jenis opcode secara bersamaan: `is-at` (ARP Reply) dan `who-has` (ARP Request).
   * Ponsel modern (Android 11+, iOS 14+) menolak paket *unsolicited ARP reply* standar (`arp_accept=0`). Tanpa `who-has`, ponsel Android/iOS modern sering **kebal terhadap blokir**.
2. **Mode Blackhole Anti-Lag (`ca50ef9`):**
   * Saat memblokir total (*full block*), racun ARP diarahkan ke alamat MAC hantu (*locally administered unicast*). Router me-drop frame langsung di Access Point, sehingga laptop operator terhindar dari banjir paket (anti-lag).
3. **Pemberhentian Sesi Zombie & Dedup MAC (`e4cd62e`, `9991858`, `13b58d0`):**
   * Memastikan sesi lama dimatikan saat perangkat berganti IP/jaringan atau saat engine Python restart (`9a3eaaa`).

### C. Ketahanan Identitas Perangkat & MAC Randomization
1. **Serialisasi DUID Hardware (Option 61) (`be3e726`):**
   * Mengekstrak dan mencocokkan DUID-LLT dari paket DHCP secara presisi untuk membedakan perangkat fisik meskipun MAC-nya berotasi acak.
2. **Real-time Identity Re-Block on DHCP (`a7c3c39`):**
   * Menangkap paket DHCP dari perangkat yang mengacak MAC dan langsung memicu auto-reblock instan tanpa menunggu siklus scan berikutnya.
3. **Penyembuhan Nama Profil Hostname (`f48d07c`):**
   * Memulihkan profil perangkat yang bernama `Unknown` menjadi nama hostname unik asli (misal `A55-milik-Hanif`).
4. **Perbaikan Supresi Auto-Reblock & Scoring Mobile (`b721dbd`):**
   * Menghapus supresi `currentDev.session_id` dan menaikkan bobot kontinuitas disconnect (+15 poin).

### D. Stabilitas Watchdog & Liveness
1. **Watchdog Hysteresis & Wave Scaling (`6bd8e78`, `5a19b74`):**
   * Mencegah *false-offline flood* dan perangkat *flapping* (online/offline terus-menerus) saat HP masuk ke mode hemat daya (*power-save*).

### E. Keamanan, Desain UI, & Kontrol Tombol
1. **Sequential Internet-Cut Lock (`10b5308`):**
   * Tombol potong internet (`busyToggleIp`) mengunci tombol perangkat lain selama proses spoofing sedang berlangsung untuk mencegah race condition.
2. **Audit Keamanan P0/P1 (`17e9211`):**
   * Mencegah timing attack pada token API, proteksi SSRF, dan pembersihan proses saat shutdown.
3. **Light Mode Token Palette (`8887479`, `424d07c`):**
   * Dukungan tema terang yang presisi pada tabel, kartu, dan grafik bandwidth.

---

## 3. Daftar Lengkap 31 Commit yang Dicadangkan

| # | Commit Hash | Tanggal | Penulis | Pesan Singkat Commit |
|---|---|---|---|---|
| 1 | `b721dbd` | 2026-09-07 22:56 | Muhammad Naim | fix(reblock): resolve auto-reblock suppression, zombie session leaks, and mobile scoring |
| 2 | `17e9211` | 2026-09-07 22:07 | Muhammad Naim | fix(security): resolve audit P0/P1 issues (shutdown hang, preload token, SSRF, timing attacks, and schema drift) |
| 3 | `0453784` | 2026-09-07 21:52 | Muhammad Naim | fix: optimize scan speed, enforce RFC 826/4861, fix virtual ghost laptop, and support MAC unblock |
| 4 | `f48d07c` | 2026-09-07 20:56 | Muhammad Naim | fix(profile): heal generic/Unknown profile names from personalized device hostnames |
| 5 | `a7c3c39` | 2026-09-07 20:18 | Muhammad Naim | feat(netcut): real-time identity re-block on DHCP for MAC-rotating devices (FASE 3) |
| 6 | `be3e726` | 2026-09-07 20:13 | Muhammad Naim | fix(identity): serialize DUID-LLT to real bytes + guard TIER-1 against placeholder client-ids (FASE 2) |
| 7 | `9a3eaaa` | 2026-09-07 20:08 | Muhammad Naim | fix(netcut): re-establish blocks after Python engine restart (reconcile on reconnect) |
| 8 | `6bd8e78` | 2026-09-07 18:38 | Muhammad Naim | fix(liveness): hysteresis on watchdog offline events (stop power-save device flapping) |
| 9 | `5a19b74` | 2026-09-07 18:18 | Muhammad Naim | fix(liveness): scale watchdog pulse_batch wait window to waves (stop false-offline flood) |
| 10 | `e2409f1` | 2026-09-07 17:52 | Muhammad Naim | perf(scan): L2 discovery via kernel ARP path, not Scapy srp broadcast (59s -> ~2s) |
| 11 | `13b58d0` | 2026-09-07 16:52 | Muhammad Naim | fix(netcut): re-block on DHCP renew (SP-1) + clear stale session_ids on Python reconnect (SP-2) |
| 12 | `ca50ef9` | 2026-09-07 16:45 | Muhammad Naim | fix(spoofer,network): dual-opcode poison, blackhole full-block, IPv6 route gate (SP-3, D/SP-5, SP-4) |
| 13 | `e4cd62e` | 2026-09-07 16:27 | Muhammad Naim | fix(spoofer): correct scapy interface match, dedup by MAC, broadcast stop_all (A, C, E) |
| 14 | `66eccc0` | 2026-09-07 16:18 | Muhammad Naim | fix(shield): use friendly interface alias, not netifaces GUID (fixes BUG-8 regression) |
| 15 | `2d5e078` | 2026-09-07 15:59 | Muhammad Naim | fix(identity): key offline devices by identity, not empty IP (BUG-17 + BUG-19 selection) [Plan A Phase 1] |
| 16 | `b0f7edc` | 2026-09-07 15:49 | Muhammad Naim | fix(redirector): release DNS/ARP teardown outside the manager lock (BUG-16 sibling) |
| 17 | `f18dd3c` | 2026-09-07 13:31 | Muhammad Naim | fix(telemetry,dhcp,shield): active-NIC counters (BUG-15), enriched DHCP callback (BUG-11), dynamic shield alias (BUG-8) |
| 18 | `15c5583` | 2026-09-07 13:22 | Muhammad Naim | fix(redirector,discovery): teardown gateway outside lock (BUG-16) + join multicast group (BUG-18) |
| 19 | `5908d36` | 2026-09-07 13:16 | Muhammad Naim | fix(discovery): ping timeout (BUG-12), preserve MAC on probe failure (BUG-9), mDNS suffix (BUG-13), NDP restore race (BUG-7) |
| 20 | `9991858` | 2026-09-07 13:04 | Muhammad Naim | fix(netcut): prefer online gateway (BUG-5) + clear stale session_ids on network change (BUG-6) |
| 21 | `cbcddf5` | 2026-09-07 12:57 | Muhammad Naim | fix(ipv6): correct NDP probe arg order (BUG-1) + forward IPv6 on auto-reblock/throttle (BUG-2) |
| 22 | `424d07c` | 2026-09-07 08:47 | Muhammad Naim | style(theme): make bandwidth chart theme-aware + frame gaming arena in light mode |
| 23 | `8887479` | 2026-09-07 06:51 | Muhammad Naim | style(theme): adopt branch light-mode token palette with full raw-utility coverage |
| 24 | `e9c5380` | 2026-09-07 06:15 | Muhammad Naim | fix(netcut): re-apply pre-flight trust-fresh bypass onto main (TDD) |
| 25 | `10b5308` | 2026-09-07 06:11 | Muhammad Naim | feat(netcut): re-apply sequential internet-cut lock (busyToggleIp) onto main |
| 26 | `27fe9b0` | 2026-09-06 19:40 | Muhammad Naim | fix: address bugs found in the cross-layer bug hunt (has_ipv6 gate, network-change flood, dup event) |
| 27 | `4295417` | 2026-09-05 23:37 | Muhammad Naim | feat(scan): split Profiling button, icon-only select, and +1 device level-up effect |
| 28 | `682d5e1` | 2026-09-05 23:26 | Muhammad Naim | feat(scan): make Auto Scan background scans visually silent |
| 29 | `039742b` | 2026-09-05 23:17 | Muhammad Naim | fix(scan): close race where a stale Auto Scan pref could enable background scans before tier enforcement |
| 30 | `5e634d5` | 2026-09-05 23:13 | Muhammad Naim | test(scan): add regression guard proving the watchdog respects the Auto Scan gate |
| 31 | `6d27a27` | 2026-09-05 23:11 | Muhammad Naim | feat(scan): make Auto Scan a real gated feature; free tier is scan-only |

---

## 4. Cara Memulihkan / Mengambil Kembali Fitur (Instruksi Git)

Jika di kemudian hari Anda ingin memulihkan satu atau beberapa perbaikan di atas ke dalam branch Anda:

1. **Melihat isi branch cadangan:**
   ```powershell
   git log backup-pre-rollback-all-fixes --oneline -n 35
   ```

2. **Mengambil satu perbaikan tertentu (*Cherry-pick*):**
   Misalnya mengambil percepatan scan 2 detik (`e2409f1`):
   ```powershell
   git cherry-pick e2409f1
   ```
   Atau mengambil dual-opcode poison (`ca50ef9`):
   ```powershell
   git cherry-pick ca50ef9
   ```

3. **Kembali sepenuhnya ke kondisi sebelum rollback:**
   ```powershell
   git checkout backup-pre-rollback-all-fixes
   ```
