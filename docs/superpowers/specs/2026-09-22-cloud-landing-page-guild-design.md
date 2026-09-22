# Technical Design Specification: Spoorf Cloud Landing Page (Guild / Fleet Aesthetic)

**Document Version:** 1.0.0  
**Date:** 2026-09-22  
**Author:** Principal Systems Architect & Senior Front-End Engineer  
**Status:** Approved for Implementation  
**Governing Repositories:** `d:/spoorf-web-cloud/frontend`, `d:/spoorf` (Ecosystem integration)  
**Reference Design:** [Guild / Fleet Landing Kit](https://guild-landing-kit-qa-v1.21st.app/#)  

---

## 1. Executive Summary & Problem Statement

### 1.1 Background
The Spoorf Cloud Platform (`spoorf-web-cloud`) currently provides active session management, user authentication, and desktop client downloads. However, the root route (`/`) previously issued an immediate redirect to `/dashboard`. Prospective operators and network engineers visiting the cloud portal had no landing page explaining the platform's capabilities, architecture, or value proposition.

### 1.2 Objective
Design and implement an ultra-modern, high-conversion, editorial **Landing Page** at route `/` for `spoorf-web-cloud/frontend`. The landing page adopts 100% of the visual tokens, typography trinity, layout structure, and micro-interactions of the **Guild / Fleet Landing Kit (`https://guild-landing-kit-qa-v1.21st.app/#`)**.

### 1.3 Key Value Pillars
1. **Identical Visual Fidelity**: Warm tactile paper canvas (`#f4f3f1`), dark ink typography (`#0d0c11`), electric indigo brand accents (`#5b34e8`), and hairline borders with multi-layered soft elevations.
2. **Typography Trinity**: Google Fonts integration of `Geist` (clean modern sans), `Geist Mono` (technical metrics, IP/MAC monospaced), and `Instrument Serif` (italic editorial accents).
3. **Dynamic Sentinel Fleet Topology**: Animated floating node cards (`wander-x`, `wander-y`) connected to a central hub via pulsing dynamic SVG cubic Bezier curves.
4. **Auto-Advancing Interactive Showcase**: 4-pillar interactive feature tabs with synchronized progress timers and realistic UI preview widgets.
5. **Smart Auth Routing**: Seamless transition for guest visitors (`/login`, `/register`, `/download`) and authenticated operators (`/dashboard`).

---

## 2. Visual Identity & Design System

### 2.1 Typography Trinity
| Font Family | Style / Weights | Application |
| :--- | :--- | :--- |
| **`Geist Sans`** | 300, 400, 500, 600, 700 | Primary UI body text, buttons, subheadings, bento descriptions |
| **`Geist Mono`** | 400, 500, 600 | IP addresses (`192.168.1.84`), MAC addresses, packet telemetry, code badges |
| **`Instrument Serif`** | Italic (400) | Editorial headline emphasis (e.g., *"One control plane for your network fleet"*), mission quotes |

### 2.2 Color Tokens & CSS Variables
```css
:root {
  --background: #f4f3f1;          /* Warm tactile editorial paper */
  --foreground: #0d0c11;          /* Deep black ink */
  --card: #ffffff;                /* Pure white card surface */
  --card-foreground: #1d1b26;     /* Card ink text */
  --muted: #eae9e5;               /* Subdued warm paper */
  --muted-foreground: #110f1a8c;  /* Muted ink */
  --border: rgba(45, 42, 58, 0.14); /* Hairline card border */
  --primary: #14121c;             /* Primary solid button / badge */
  --brand: #5b34e8;               /* Guild electric violet / indigo */
  --brand-foreground: #ffffff;    /* Brand text */
  --status-running: #15803d;      /* Emerald active node */
  --status-running-bg: rgba(22, 163, 74, 0.08);
  --status-queued: #b45309;       /* Amber warning / throttled */
  --status-queued-bg: rgba(217, 119, 6, 0.09);
  --shadow-card: 0 0 0 0.5px rgba(45,42,58,0.14), 0 1px 2px rgba(45,42,58,0.04), 0 4px 10px rgba(45,42,58,0.05), 0 10px 24px rgba(45,42,58,0.06);
  --shadow-panel: 0 0 0 0.5px rgba(45,42,58,0.1), 0 2px 6px rgba(45,42,58,0.05), 0 18px 44px rgba(45,42,58,0.09);
}
```

### 2.3 Background Textures & Animations
- **`.bg-grid-paper`**: Linear grid pattern `104px x 104px` with `rgba(45, 42, 58, 0.06)` lines.
- **`.status-pulse`**: Expanding radar ripple effect on active network nodes.
- **`.wander-x` & `.wander-y`**: Smooth sinusoidal floating keyframe animations (`±4px` over 8–12s) for organic node card hovering.
- **`.texture-wash-mint` & `.texture-wash-brand`**: Organic radial gradient washes for highlighted bento cards.

---

## 3. Component Architecture & Hierarchy

```text
d:/spoorf-web-cloud/frontend/src/
├── pages/
│   └── LandingPage.tsx                     # Root page composer
└── components/
    └── landing/
        ├── LandingNavbar.tsx               # Floating pill glassmorphism navbar + Smart Auth
        ├── HeroTopology.tsx                # Hero copy + wandering nodes + SVG Bezier canvas
        ├── MissionLead.tsx                 # High-impact quote & 4-column metric ticker
        ├── InteractiveFeatureTabs.tsx      # 4-pillar tabs with auto-cycling progress bar
        ├── BentoFeatures.tsx               # Bento grid cards with mint/brand texture washes
        ├── FeatureMatrix.tsx               # Dense 3-column enterprise capability checklist
        ├── PricingTiers.tsx                # Free vs Pro vs VIP transparent tier cards
        └── LandingFooter.tsx               # CTA banner, category links & status pill
```

---

## 4. Detailed Component Specifications

### 4.1 `LandingNavbar.tsx`
- **Positioning**: Sticky floating pill centered horizontally at top (`top-4`, max-w-6xl).
- **Styling**: `bg-white/80 backdrop-blur-md border border-border/60 shadow-card rounded-full px-6 py-3`.
- **Left**: Typographic brand mark **SPOORF** with live emerald pulsing dot.
- **Center**: Navigation anchor links (`Product`, `Features`, `Architecture`, `Pricing`, `Download`).
- **Right**:
  - If unauthenticated: `Sign In` (`/login`) and brand button `Launch Console` (`/register`).
  - If authenticated: User email badge and `Buka Dashboard` (`/dashboard`).

### 4.2 `HeroTopology.tsx`
- **Announcement Pill**: `Sentinel v2.41 · Instant 30s Heartbeat & Remote Session Kick →`.
- **Editorial Headline**: `One control plane for your network <span className="font-serif italic font-normal text-brand">fleet</span>.`
- **Subheadline**: Explains autonomous Layer 2 discovery, precision PWM bandwidth limiting, and zero-collateral protection.
- **Action Buttons**: Solid brand button (`Launch Cloud Console →`) and tactile ghost button (`Download Desktop Agent`).
- **Canvas Showcase**:
  - Central Hub: **Core Sentinel Engine** (`Engine Armed`, `L2 Packet Injector`, `100k pkts/s`).
  - 4 Floating Wandering Node Cards:
    1. *This PC — Operator Host* (`192.168.1.5`, Invariant 2 Protected, Emerald status).
    2. *Fiber Gateway Router* (`192.168.1.1`, Invariant 1 Immune, Shield icon).
    3. *Unknown Guest Device* (`192.168.1.84`, PWM Throttled 25%, Amber status).
    4. *Cloud Fleet Hub* (`api.spoorf.app`, 30s Heartbeat Synced, Indigo cloud icon).
  - SVG Canvas: 4 dynamic cubic Bezier curves (`M x1 y1 C cx1 cy1, cx2 cy2, x2 y2`) with animated dash pulses.

### 4.3 `MissionLead.tsx`
- **Editorial Quote**: *“You cannot defend what you cannot <span className="font-serif italic text-brand font-normal">see</span>.”*
- **Supporting Narrative**: Explains the blind spot of Layer 2 unmonitored devices.
- **Metric Ticker**:
  - `< 1.0s` Sub-Second Host Discovery
  - `100k+` Layer 2 Injections / Sec Without Drops
  - `0ms` Gateway Disruption (Zero Collateral)
  - `30s` Sub-Minute Cloud Session Revocation

### 4.4 `InteractiveFeatureTabs.tsx`
- **4 Core Tabs**:
  1. *Autonomous L2 Discovery*: Raw ARP sweeps, passive DHCP Option 55/60 profiling, and NetBIOS probing.
  2. *Precision PWM Bandwidth Limiter*: Duty-cycle throttling without TCP drops (10%–90%).
  3. *Zero-Collateral Invariants*: Mathematical immunity for Gateway router and operator laptop.
  4. *Cloud Fleet & Remote Kick*: 30s heartbeat polling and sub-minute session revocation.
- **Interactivity**: 6-second auto-cycle interval with synchronized progress indicator bar, pause on hover, and manual tab selection.
- **Preview Widget**: Dynamic card matching the active tab with live mock telemetry, speed sliders, or device tables.

### 4.5 `BentoFeatures.tsx`
- **Card 1 (`texture-wash-brand`)**: Hybrid Microservices Architecture (Python 3.11 Scapy + Node.js 20 Orchestrator + React 18).
- **Card 2 (`texture-wash-mint`)**: Zero-HWID Privacy & Asymmetric Cryptographic Integrity (RS256 tokens, PostgreSQL).
- **Card 3 (`bg-slate-900 text-white`)**: Bettercap Arsenal & Captive Gateway (DNS sinkhole, leaf SSL certificates).
- **Card 4 (`.bg-grid-paper`)**: Continuous State Persistence (SQLite WAL local + PostgreSQL 17 Cloud).

### 4.6 `FeatureMatrix.tsx`
- **3-Column Enterprise Checklist**:
  - *Column 1*: Layer 2 Engine & Hardcoded Invariants.
  - *Column 2*: Cloud Fleet & Access Governance.
  - *Column 3*: Developer & System Standards (562 automated tests, Zod validation, Pino ECS logging).

### 4.7 `PricingTiers.tsx`
- **Free Tier ($0)**: 1 session, 5 cut quota, sub-second scanner, Invariants 1 & 2 protected.
- **Pro Tier ($19)**: 2 sessions, unlimited cuts, PWM limiter, captive portal, auto-reblock (*Most Popular* badge).
- **VIP Tier ($49)**: 5 sessions, full Bettercap arsenal, leaf SSL generator, deep OS fingerprinting.

### 4.8 `LandingFooter.tsx`
- **Closing CTA**: *“Take full command of your Layer 2 perimeter.”*
- **Footer Links**: Categorized into Product, Security, and Developers.
- **Live Status Indicator**: `All Systems Operational · Cloud Heartbeat Live`.

---

## 5. Routing & Integration Architecture

In [spoorf-web-cloud/frontend/src/App.tsx](file:///d:/spoorf-web-cloud/frontend/src/App.tsx):

```tsx
<Routes>
  {/* Public Landing Page */}
  <Route path="/" element={<LandingPage />} />

  {/* Auth & Console Pages */}
  <Route path="/login" element={<LoginPage />} />
  <Route path="/register" element={<RegisterPage />} />
  <Route
    path="/dashboard"
    element={
      <ProtectedRoute>
        <DashboardPage />
      </ProtectedRoute>
    }
  />
  <Route path="/download" element={<DownloadPage />} />

  {/* Wildcard Fallback */}
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>
```

---

## 6. Verification Plan & Success Criteria

1. **Build & Typecheck**:
   - `npm run build` in `d:/spoorf-web-cloud/frontend` must exit with code 0 (zero TypeScript errors).
2. **Backend API Stability**:
   - `npm test` in `d:/spoorf-web-cloud/backend` must pass all 29+ tests (100% green).
3. **Responsiveness & UX**:
   - Mobile, tablet, and desktop viewports tested with clean hamburger navigation and stacked bento cards.
   - Smooth 60fps animations for SVG curves and wandering nodes.
