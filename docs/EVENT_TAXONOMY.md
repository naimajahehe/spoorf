# WebSocket & Socket.IO Event Taxonomy

Katalog resmi seluruh event real-time yang mengalir di antara ketiga lapisan sistem:
**Python Microservice (:8001)** $\longleftrightarrow$ **Node.js Orchestrator (:5000)** $\longleftrightarrow$ **React Frontend (:5173)**.

---

## 1. Python Microservice $\rightarrow$ Node.js Orchestrator
* **Protokol:** Native WebSocket (`ws://127.0.0.1:8001/ws/events`)
* **Format:** JSON Object `{ "event": string, "data": object }`

### Event: `telemetry`
Disiarkan setiap 1 detik oleh background sampler thread.
```json
{
  "event": "telemetry",
  "data": {
    "connected": true,
    "ssid": "Teman Kenangan",
    "signal": "75%",
    "download": 12.45,
    "upload": 1.82,
    "latency": 9,
    "timestamp": 1787823571555
  }
}
```

### Event: `dhcp_device_discovered`
Disiarkan instan saat Passive DHCP Sniffer menangkap aktivitas DHCP, termasuk
discovery/renew dan release.
```json
{
  "event": "dhcp_device_discovered",
  "data": {
    "mac": "c2:4e:ca:88:04:2d",
    "ip": "192.168.110.120",
    "hostname": "Infinix-HOT-10",
    "vendor_class": "android-dhcp-10",
    "dhcp_fingerprint": "Android OS Signature",
    "client_id": "01:c2:4e:ca:88:04:2d",
    "fqdn": "Infinix-HOT-10.local",
    "message_type": "REQUEST",
    "message_type_code": 3,
    "is_release": false,
    "last_seen": "2026-08-27 17:48:50"
  }
}
```

Untuk release, native payload menggunakan `message_type_code: 7` dan
`is_release: true`. Node juga menerima bentuk kompatibilitas `kind: "release"`;
setiap salah satu dari tiga penanda tersebut menandai release. Node meneruskan
release ke Socket.IO sebagai `dhcpEvent` dengan payload
`{ kind: "release", mac, ip }`.

### Event: `device_offline_pulse`
Disiarkan oleh liveness watchdog saat pulse menemukan perangkat tidak aktif.
```json
{
  "event": "device_offline_pulse",
  "data": {
    "ip": "192.168.110.120",
    "mac": "c2:4e:ca:88:04:2d",
    "vector": "arp"
  }
}
```
PythonBridge memetakannya secara aditif ke event internal
`deviceLivenessChanged` dengan `is_online: false`; DeviceManager kemudian
menyiarkan pembaruan perangkat melalui nama Socket.IO yang sudah ada.

### Event: `arp_threat_detected`
Disiarkan Sentinel Shield ketika mendeteksi ARP yang mengklaim gateway.
```json
{
  "event": "arp_threat_detected",
  "data": {
    "id": "threat_1787823571555",
    "timestamp": "2026-09-04 05:42:50",
    "attacker_ip": null,
    "attacker_mac": "c2:4e:ca:88:04:2d",
    "target_ip": "192.168.110.99",
    "claimed_ip": "192.168.110.1",
    "type": "gateway_arp_spoof",
    "action_taken": "mitigated_by_shield",
    "details": "..."
  }
}
```
`attacker_mac` berasal dari sumber perangkat keras ARP, `claimed_ip` adalah
alamat protokol sumber yang diklaim (`ARP.psrc`), dan `target_ip` adalah target
ARP (`ARP.pdst`). Field kompatibilitas `attacker_ip` bernilai `null` ketika
alamat IP host penyerang tidak dapat ditentukan dari frame dan tidak boleh
disimpulkan dari `claimed_ip`.

Nama Socket.IO publiknya adalah `arpThreatDetected`, dengan payload yang sama.

### Event: `shield_status_changed`
Disiarkan setelah Shield berhasil diaktifkan atau dinonaktifkan.
```json
{
  "event": "shield_status_changed",
  "data": { "is_enabled": true }
}
```
Payload adalah objek status Shield yang sama seperti endpoint status. Nama
Socket.IO publiknya adalah `shieldStatusChanged`, dengan payload yang sama.

### Event: `network_changed`
Disiarkan ketika Watchdog mendeteksi perubahan IP Gateway atau nama interface adapter.
```json
{
  "event": "network_changed",
  "success": false,
  "error": "NETWORK_CHANGED",
  "message": "Gateway changed to 192.168.1.1",
  "data": {
    "new_gateway": "192.168.1.1",
    "new_interface": "Wi-Fi"
  }
}
```

---

## 2. Node.js Orchestrator $\rightarrow$ React Frontend
* **Protokol:** Socket.IO (`http://localhost:5000`)
* **Format:** Event Name + Argument Payload

### Event: `telemetryStream`
Meneruskan data throughput dan sinyal ke komponen grafik `NetworkLiveChart.tsx`.
* **Payload:** Object telemetri (download, upload, latency, signal, ssid).

### Event: `autoReblocked`
Dikirim ketika perangkat yang pernah diblokir terdeteksi tersambung ulang dan otomatis dicegat.
* **Payload:** Object `Device`.

### Event: `devices`
Dikirim sekali untuk setiap koneksi baru.
* **Payload:** array `Device` saat ini. Event ini menggantikan pernyataan lama
  bahwa koneksi menerima event `initialState`.

### Event: `deviceUpdate`
Dikirim saat status perangkat berubah (misal pemblokiran manual, update alias, atau perubahan limit).
* **Payload:** Object `Device` terbaru.

### Event: `deviceDisconnected`
Dikirim ketika perangkat menjadi offline.
* **Payload:** Object `Device` yang diperbarui.

### Event: `dhcpEvent`
Dikirim untuk aktivitas DHCP yang telah dinormalisasi.
* **Payload release:** `{ kind: "release", mac?: string, ip?: string }`.

### Event: `shieldStatusChanged`
Meneruskan status Shield setelah transisi enable/disable yang berhasil.
* **Payload:** objek status Shield.

### Event: `arpThreatDetected`
Meneruskan peringatan ARP dari Shield.
* **Payload:** objek threat dengan `attacker_mac`, `attacker_ip`, `target_ip`,
  `claimed_ip`, `type`, `action_taken`, dan metadata terkait. `attacker_ip`
  dapat bernilai `null` dan tidak boleh disimpulkan dari `claimed_ip`.

### Event: `profileRefreshStarted`
Dikirim saat satu pass **profiling identitas pasif** dimulai (endpoint kanonik
`POST /api/network/profile-refresh`). Operasi ini murni mengumpulkan bukti —
tidak ada perangkat yang diputus, tidak ada renewal/re-auth DHCP yang dipaksa.
* **Payload:** `{ operation: "profile_refresh", scope, count }`.

### Event: `profileRefreshDone`
Dikirim saat pass profiling selesai, membawa ringkasan hasil.
* **Payload:** `ProfileRefreshResult` + `{ operation: "profile_refresh", scope, count }`
  (`visible_count`, `high_confidence_count`, `medium_confidence_count`,
  `unknown_count`, `hostname_count`, `coverage_percentage`, `sources`,
  `ap_isolation`, `partial_failures`, `duration_ms`).

### Event kompatibilitas: `quickReauthStarted` / `quickReauthDone` (usang)
Backend masih mencerminkan kedua event ini untuk kompatibilitas, tetapi menandainya
`deprecated: true` dan `operation: "profile_refresh"`. Konsumen baru **harus**
mendengarkan `profileRefresh*`; entri aktivitas duplikat dari event usang ini
ditekan di frontend. Tidak ada perilaku micro-cut yang terkait dengannya.
