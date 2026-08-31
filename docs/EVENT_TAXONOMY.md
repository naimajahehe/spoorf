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
Disiarkan instan saat Passive DHCP Sniffer menangkap paket DHCP dari perangkat baru.
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
    "last_seen": "2026-08-27 17:48:50"
  }
}
```

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
* **Payload:** `{ device: Device, message: string }`

### Event: `autoThrottled`
Dikirim ketika perangkat yang memiliki limit kecepatan terdeteksi tersambung ulang dan otomatis dibatasi.
* **Payload:** `{ device: Device, limit: number, message: string }`

### Event: `deviceUpdated`
Dikirim saat status perangkat berubah (misal pemblokiran manual, update alias, atau perubahan limit).
* **Payload:** Object `Device` terbaru.
