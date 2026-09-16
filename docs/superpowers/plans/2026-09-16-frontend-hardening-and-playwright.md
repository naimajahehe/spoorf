# Frontend Hardening, Optimization & Playwright Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menguatkan arsitektur frontend NetCut Sentinel (`frontend-react`), memasang React Error Boundary, mengoptimalkan siklus re-render tabel virtual, memecah bundle monolitik 1,06 MB dengan `React.lazy()` code-splitting, memperbaiki akurasi labeling Gateway OS, membersihkan dead code, dan memverifikasi seluruh fungsionalitas UI secara end-to-end menggunakan Playwright.

**Architecture:** Menerapkan pertahanan berlapis pada UI layer: Error Boundary bertema Sentinel di root aplikasi, stabilisasi referensi fungsi callback via `useCallback` di `App.tsx` dan `useWebSocket.ts` untuk memulihkan `React.memo(DeviceTable)`, pemisahan modul halaman sekunder ke dalam chunk asinkron via `Suspense` + `React.lazy()`, dan suite uji otomatis Playwright untuk memvalidasi interaksi UI nyata tanpa regresi.

**Tech Stack:** React 18, Vite 4, TypeScript 5, Tailwind CSS, TanStack Virtual, Lucide React, Socket.IO Client, Playwright E2E (`@playwright/test`).

**Spec:** `docs/specs/SPEC-006_FRONTEND_UI_AND_INTERACTION.md`

## Global Constraints

- **Invariants:** Default gateway (`is_gateway: true`) & controller (`is_self: true`) tetap terlindungi dari aksi pemutusan/limit L2 di UI.
- **Backward Compatibility:** REST API endpoints dan nama event WebSocket tidak boleh diubah.
- **Zero Lint / Type Errors:** `npx tsc --noEmit` wajib lulus tanpa error pada setiap task.
- **Existing Test Coverage:** Semua 379 tes Python, 48 tes Node.js, dan 3 script validasi frontend wajib tetap 100% hijau.

---

### Task 1: Resilience — React Error Boundary

**Files:**
- Create: `frontend-react/src/components/ErrorBoundary.tsx`
- Modify: `frontend-react/src/main.tsx`

- [ ] **Step 1: Buat komponen ErrorBoundary.tsx**
  Implementasikan error boundary React dengan UI Fallback bernuansa Sentinel: judul error, pesan teknis, tombol salin stack trace, dan tombol "Muat Ulang Aplikasi".
- [ ] **Step 2: Bungkus root di main.tsx**
  Bungkus `<NetworkProvider><App /></NetworkProvider>` dengan `<ErrorBoundary>`.
- [ ] **Step 3: Jalankan typecheck**
  Jalankan `npx tsc --noEmit` untuk memastikan tidak ada error kompilasi.

---

### Task 2: Performance — Callback Memoization & DeviceTable Protection

**Files:**
- Modify: `frontend-react/src/hooks/useWebSocket.ts`
- Modify: `frontend-react/src/App.tsx`

- [ ] **Step 1: Bungkus action methods di useWebSocket.ts dengan useCallback**
  Bungkus `block`, `unblock`, `deleteDevice`, `updateAlias`, `setSpeedLimit`, `scan`, `setAutoScan` dalam `useCallback`.
- [ ] **Step 2: Bungkus handler DeviceTable di App.tsx dengan useCallback**
  Bungkus `handleToggleInternet`, `handleToggleSelect`, `handleToggleSelectAll`, `handleManualCheckWifi`, `fetchApIsolation`, `handleRefreshApIsolation` dengan `useCallback`.
- [ ] **Step 3: Jalankan typecheck & frontend script assertions**
  Jalankan `npx tsc --noEmit` dan 3 script test di `frontend-react/scripts/`.

---

### Task 3: Code-Splitting & Bundle Optimization

**Files:**
- Modify: `frontend-react/src/App.tsx`

- [ ] **Step 1: Konversi import statis view sekunder menjadi React.lazy**
  Ubah import `BettercapArsenalView`, `TransparentGatewayView`, `DocumentationView`, `SettingsView`, `ActivityLogView`, dan `GamingModeWidget` menjadi `React.lazy()`.
- [ ] **Step 2: Tambahkan Suspense fallback di App.tsx**
  Bungkus rendering tampilan dengan `<Suspense fallback={...}>`.
- [ ] **Step 3: Uji build dan verifikasi pemecahan chunk bundle**
  Jalankan `npm run build` dan pastikan chunk utama turun di bawah 500 kB.

---

### Task 4: Business Logic — Gateway OS Badge Correction

**Files:**
- Modify: `frontend-react/src/components/DeviceOsBadge.tsx`

- [ ] **Step 1: Perbaiki logika formatDeviceOs**
  Hapus hardcode unconditional `return 'RouterOS'` untuk gateway. Gunakan OS jika terdeteksi, atau `${vendor} Gateway` jika vendor valid, atau fallback `Router Gateway`.
- [ ] **Step 2: Verifikasi typecheck**
  Jalankan `npx tsc --noEmit`.

---

### Task 5: Dead Code Removal & Minor Security Hardening

**Files:**
- Delete: `frontend-react/src/components/AuthGateScreen.tsx`
- Delete: `frontend-react/src/components/motion/pull-to-refresh.tsx`
- Delete: `frontend-react/src/components/motion/scroll-progress.tsx`
- Delete: `frontend-react/src/components/motion/smooth-scroll.tsx`
- Delete: `frontend-react/src/components/ui/card.tsx`
- Delete: `frontend-react/src/components/ui/checkbox.tsx`
- Modify: `frontend-react/src/App.css`
- Modify: `frontend-react/src/components/WebPreviewModal.tsx`
- Modify: `frontend-react/src/components/UpgradeProModal.tsx`

- [ ] **Step 1: Hapus file tidak terpakai**
- [ ] **Step 2: Hapus @import duplikat di App.css**
- [ ] **Step 3: Lepas allow-same-origin di WebPreviewModal.tsx dan tambah noopener di UpgradeProModal.tsx**
- [ ] **Step 4: Jalankan typecheck dan build produksi**

---

### Task 6: Playwright E2E Automated Verification

**Files:**
- Create: `frontend-react/playwright.config.ts`
- Create: `frontend-react/tests/e2e/frontend.spec.ts`

- [ ] **Step 1: Install @playwright/test**
- [ ] **Step 2: Konfigurasi playwright.config.ts**
- [ ] **Step 3: Buat skenario pengujian e2e lengkap**
  - Boot & mount smoke test
  - Error boundary recovery test
  - Code-splitting & navigasi 8 tampilan
  - Device table rendering & toggle selection
  - Command palette Ctrl+K
  - Theme toggle (Dark / Light)
- [ ] **Step 4: Jalankan Playwright tests dan pastikan 100% PASS**

---

### Task 7: Full Regression Verification

- [ ] **Step 1: Jalankan seluruh test suite**
  - Frontend: Playwright + Unit scripts + `tsc --noEmit` + `npm run build`
  - Backend: `npm test` di `backend-node`
  - Python: `unittest discover` di `python-service`
- [ ] **Step 2: Update CHANGELOG.md**
