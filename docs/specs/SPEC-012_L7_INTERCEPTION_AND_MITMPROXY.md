# SPEC-012: LAYER 7 TRAFFIC INTERCEPTION & DYNAMIC TLS CA PIPELINE

> **Governing Spec**: `SPEC-012_L7_INTERCEPTION_AND_MITMPROXY.md`  
> **Status**: APPROVED & IMPLEMENTED  
> **Author**: Antigravity Autonomous Agent  
> **Target Version**: NetCut Sentinel v2.2.0  
> **Catatan (2026-08-31):** Sebelumnya salah bernomor `SPEC-008` (bentrok dengan Cloud Auth). Dinormalkan menjadi **SPEC-012**.
>
> **Keamanan CA (lihat SECURITY_AUDIT [OPEN]):** Private key Root CA (`certs/spoorf-ca-key.pem`) saat ini disimpan **tanpa enkripsi** (`serialization.NoEncryption()` di `certs.py`). CA ini di-install ke trust store perangkat korban, jadi kebocoran key = kemampuan MITM. Lindungi ACL file & pertimbangkan enkripsi at-rest.

---

## 1. Overview & Architectural Motivation

Sistem Transparent Gateway di NetCut Sentinel sebelumnya beroperasi pada Layer 2 dan Layer 3/4 dasar (ARP redirection + Windows Kernel Forwarding + passive DNS UDP 53 sniffing + passive TLS SNI sniffing). 

Berdasarkan analisa mendalam terhadap arsitektur **mitmproxy** (`d:/mitmproxy`), SPEC-012 mendefinisikan subsistem **Layer 7 Interceptor** yang memperluas kemampuan Spoorf:
1. **Dynamic Certificate Authority (CA)**: Menggunakan engine kriptografi berbasis X.509 (`cryptography`) untuk men-generate Root CA dan membuat sertifikat TLS dinamis *on-the-fly* dengan Subject Alternative Names (SAN) yang sesuai dengan domain target.
2. **L7 Flow Lifecycle**: Model data flow standar (`L7Flow`) yang mengkapsulasi seluruh atribut HTTP/HTTPS/DNS (method, path, status, latency, content-type, payload size, security attributes).
3. **Real-Time Streaming Bridge**: Mengalirkan event `traffic:l7_flow` melalui WebSocket ke Node.js Orchestrator dan React Dashboard.

---

## 2. Dynamic TLS Certificate Authority Specification

### 2.1. Root CA Architecture (`SpoorfCertEngine`)
- **Key Type**: RSA 2048-bit (Public Exponent `65537`).
- **Validity**: 10 Tahun (3650 hari) dengan backdating validity offset 2 hari untuk mengatasi perbedaan clock perangkat.
- **Extensions**:
  - `BasicConstraints(ca=True, path_length=None)` (Critical)
  - `KeyUsage(key_cert_sign=True, crl_sign=True)` (Critical)
  - `SubjectKeyIdentifier` (Non-critical)
- **File Storage**:
  - `python-service/certs/spoorf-ca-key.pem` (Private key)
  - `python-service/certs/spoorf-ca.pem` (PEM Certificate)
  - `python-service/certs/spoorf-ca.crt` (DER/PEM Certificate untuk instalasi perangkat)

### 2.2. Dynamic Leaf Certificate Generation (`generate_leaf_cert`)
- **Common Name**: Hostname domain target (contoh: `api.target.com`).
- **Subject Alternative Names (SAN)**:
  - `DNS:api.target.com`
  - `DNS:*.api.target.com`
- **Extended Key Usage**: `[ServerAuth]`.
- **Validity**: 90 hari.
- **Signature**: Ditandatangani langsung menggunakan Root CA Private Key dengan algoritma `SHA256`.

---

## 3. L7 Flow Data Structure & Lifecycle

```json
{
  "id": "flow-8f4b-4891-b1e0",
  "timestamp": 1787934200.125,
  "client_ip": "192.168.1.55",
  "client_mac": "3c:22:fb:11:22:33",
  "scheme": "https",
  "method": "GET",
  "host": "api.instagram.com",
  "port": 443,
  "path": "/v1/feed",
  "status_code": 200,
  "content_type": "application/json",
  "request_size": 450,
  "response_size": 12840,
  "duration_ms": 42.5,
  "is_tls": true,
  "headers": {
    "user-agent": "Instagram/10.0 Android",
    "host": "api.instagram.com"
  },
  "is_blocked": false,
  "rule_match": null
}
```

---

## 4. REST API & WebSocket Event Taxonomy

| Endpoint / Event | Type | Protocol | Deskripsi |
| :--- | :---: | :---: | :--- |
| `GET /api/interceptor/ca` | REST | HTTP | Mendapatkan metadata dan status Root CA |
| `GET /api/interceptor/ca/cert` | REST | HTTP | Mengunduh file publik `spoorf-ca.crt` |
| `GET /api/interceptor/flows` | REST | HTTP | Mengambil histori L7 flows (dengan filter & limit) |
| `DELETE /api/interceptor/flows` | REST | HTTP | Mengosongkan buffer memori L7 flows |
| `traffic:l7_flow` | WS Event | JSON | Streaming real-time flow L7 ke UI Dashboard |

---

## 5. Invariants & Safety Guarantees

1. **Gateway Immunity (`is_gateway: true`)**: Router default tidak boleh menjadi target intersepsi L7.
2. **Anti Self-Cut (`is_self: true`)**: Host pengawas dilarang diintersepsi.
3. **Zero Lock Contention**: Penyimpanan flow dan pembuatan sertifikat berjalan di luar mutex packet sending loop.
4. **Backward Compatibility**: Sesi Transparent Gateway eksisting tetap berfungsi normal tanpa degradasi performa.
