# NetCut Sentinel (Spoorf) - Technical Specifications Catalog

Selamat datang di katalog spesifikasi teknis resmi sistem **NetCut Sentinel (Spoorf)**. Seluruh dokumen spesifikasi di bawah disusun mengikuti standar dokumentasi arsitektur perangkat lunak (*RFC / Engineering Architecture Best Practices*).

---

## Indeks Spesifikasi Teknis (Technical Specifications)

| Spec ID | Judul Fitur / Spesifikasi | Komponen / Subsystem | Status |
| :--- | :--- | :--- | :---: |
| [**SPEC-001**](./SPEC-001_NETWORK_DISCOVERY_PIPELINE.md) | **Multi-Vector Network Discovery & Profiling Pipeline** | `python-service` (ARP, SSDP, mDNS, NetBIOS) | `Approved` |
| [**SPEC-002**](./SPEC-002_DHCP_PASSIVE_PROFILING.md) | **Passive DHCP Sniffer Daemon & Option 53 Profiling** | `python-service`, `backend-node` | `Approved` |
| [**SPEC-003**](./SPEC-003_ARP_SPOOFING_AND_THROTTLING.md) | **High-Performance ARP Spoofing & PWM Throttling** | `python-service` (Scapy L2, PWM Duty-Cycle) | `Approved` |
| [**SPEC-004**](./SPEC-004_STATE_PERSISTENCE_AND_AUTOREBLOCK.md) | **Database State Persistence & Auto-Reblock Pipeline** | `backend-node` (SQLite / better-sqlite3, DeviceManager) | `Approved` |
| [**SPEC-005**](./SPEC-005_REALTIME_TELEMETRY_AND_WATCHDOG.md) | **Real-Time Hardware Telemetry & Network Watchdog** | `python-service` (psutil, netsh, Watchdog) | `Approved` |
| [**SPEC-006**](./SPEC-006_FRONTEND_UI_AND_INTERACTION.md) | **Modern Frontend UI, Motion Tabs & Action Tooltips** | `frontend-react` (BeUI Motion, Framer Motion) | `Approved` |
| [**SPEC-007**](./SPEC-007_AUTOMATED_TESTING_SUITE.md) | **Automated Testing Architecture & Quality Assurance** | `python-service/tests`, `backend-node/tests` | `Approved` |
| [**SPEC-008**](./SPEC-008_CLOUD_AUTH_AND_DESKTOP_LICENSING.md) | **Cloud Authentication, Desktop Licensing & Feature Gating** | `backend-node`, `frontend-react`, Cloud API | `Approved` |
| [**SPEC-009**](./SPEC-009_ELECTRON_DESKTOP_PACKAGING.md) | **Electron Desktop Packaging & Distribution Pipeline** | `desktop-electron`, PyInstaller, NSIS | `Approved` |
| [**SPEC-010**](./SPEC-010_DEEP_SECURITY_AND_THREAT_MODELING.md) | **Deep Security Architecture, Threat Modeling & Compliance** | Full-Stack, Crypto, Anti-Tamper, Legal | `Approved` |
| [**SPEC-011**](./SPEC-011_FUTURE_INNOVATIONS_AND_VIRAL_ROADMAP.md) | **Future Innovations, Advanced Network Features & Viral Roadmap** | Ecosystem, Mobile Remote, QoS, Webhooks | `Approved` |
| [**SPEC-012**](./SPEC-012_L7_INTERCEPTION_AND_MITMPROXY.md) | **L7 Traffic Interception & Dynamic TLS CA (mitmproxy-style)** | `python-service` (interceptor, certs), `backend-node` | `Approved` |

> **Catatan penomoran (2026-08-31):** Spesifikasi L7 Interception sebelumnya salah bernomor `SPEC-008` (bentrok dengan Cloud Auth) dan tidak terdaftar di indeks. Kini dinormalkan menjadi **SPEC-012**.
>
> **Status keamanan:** Perbaikan keamanan Prioritas-1 (exact-origin anti drive-by, validasi parameter gateway + eksekusi tanpa shell, IPC bearer token) didokumentasikan di **SPEC-010** dan diaudit di [`docs/SECURITY_AUDIT.md`](../SECURITY_AUDIT.md).

---

## Standar Format & Struktur Dokumentasi

Setiap dokumen spesifikasi (*SPEC*) mematuhi struktur standar berikut:
1. **Metadata Header**: Dokumen ID, status, versi, subsistem, protokol terkait, dan file implementasi kode.
2. **Executive Summary**: Ringkasan masalah, tujuan rekayasa, dan deskripsi fungsionalitas.
3. **Architecture & Flow Diagrams**: Diagram alur sekuensial dan relasi modul berbasis Mermaid.
4. **Technical Implementation**: Formula matematika (KaTeX), algoritma penanganan paket, dan model konkurensi thread.
5. **Data Contracts & Protocols**: Skema payload REST API dan WebSocket stream.
6. **Security, Safety & Edge Cases**: Mekanisme proteksi kegagalan (*fail-safe*) dan pencegahan celah keamanan.
7. **Verification & Testing**: Matriks pengujian (Happy Path, Negative Test, Edge Cases) untuk validasi fungsionalitas.
