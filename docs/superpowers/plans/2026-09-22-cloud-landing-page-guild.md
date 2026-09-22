# Spoorf Cloud Landing Page (Guild / Fleet Aesthetic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, high-conversion, ultra-modern Landing Page at route `/` for `spoorf-web-cloud/frontend` faithfully replicating the typography, color palette, floating node topology, interactive tabbed showcase, and bento grid of the [Guild / Fleet Landing Kit](https://guild-landing-kit-qa-v1.21st.app/#).

**Architecture:** Modular React 18 component structure under `src/components/landing/`, styled with Tailwind CSS v3 using custom design tokens matching Guild (`#f4f3f1` warm paper, `#0d0c11` dark ink, `#5b34e8` electric brand indigo), Google Fonts typography trinity (`Geist`, `Geist Mono`, `Instrument Serif`), and lightweight native CSS keyframes + SVG Bezier curves.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3.4, Lucide-React, React Router DOM v6, Vite.

**Spec:** [docs/superpowers/specs/2026-09-22-cloud-landing-page-guild-design.md](file:///d:/spoorf/docs/superpowers/specs/2026-09-22-cloud-landing-page-guild-design.md)

## Global Constraints

- **Theme Palette**: Background `#f4f3f1`, foreground `#0d0c11`, brand `#5b34e8`, card surface `#ffffff`, border `rgba(45, 42, 58, 0.14)`.
- **Typography Trinity**: `font-sans` (`Geist`), `font-mono` (`Geist Mono`), `font-serif` (`Instrument Serif italic`).
- **Zero External Heavy Dependencies**: No Three.js, no framer-motion bloating the cloud frontend bundle; use lightweight native CSS keyframes (`.wander-x`, `.wander-y`, `.status-pulse`) and dynamic SVG Bezier curves.
- **Invariants Preservation**: Do not break or alter existing authenticated routes (`/dashboard`, `/login`, `/register`, `/download`) or backend contracts.
- **Strict Vector Icons**: Only pure `lucide-react` icons, zero emoji text in components.

---

### Task 1: Fonts, Design Tokens & CSS Background/Animation Foundation

**Files:**
- Modify: `d:/spoorf-web-cloud/frontend/index.html:1-14`
- Modify: `d:/spoorf-web-cloud/frontend/tailwind.config.js:1-13`
- Modify: `d:/spoorf-web-cloud/frontend/src/index.css:1-60`

**Interfaces:**
- Produces: Google Fonts link tags for `Geist`, `Geist Mono`, and `Instrument Serif`.
- Produces: Tailwind theme extensions for `brand`, `background`, `ink`, `shadow-card`, `shadow-panel`.
- Produces: CSS utilities `.bg-grid-paper`, `.texture-wash-mint`, `.texture-wash-brand`, `.status-pulse`, `.wander-x`, `.wander-y`.

- [ ] **Step 1: Embed Google Fonts in `index.html`**

Update `d:/spoorf-web-cloud/frontend/index.html` to add preconnect and Google Fonts stylesheet links:
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
```

- [ ] **Step 2: Configure Tailwind theme extensions in `tailwind.config.js`**

Update `d:/spoorf-web-cloud/frontend/tailwind.config.js` with Guild design tokens:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#f4f3f1',
        foreground: '#0d0c11',
        brand: {
          DEFAULT: '#5b34e8',
          hover: '#4a26d4',
          foreground: '#ffffff',
        },
        ink: {
          DEFAULT: '#2d2a3a',
          dark: '#0d0c11',
          muted: 'rgba(45, 42, 58, 0.65)',
        },
        surface: {
          card: '#ffffff',
          muted: '#eae9e5',
        },
        border: 'rgba(45, 42, 58, 0.14)',
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
        serif: ['Instrument Serif', 'ui-serif', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 0 0 0.5px rgba(45,42,58,0.14), 0 1px 2px rgba(45,42,58,0.04), 0 4px 10px rgba(45,42,58,0.05), 0 10px 24px rgba(45,42,58,0.06)',
        panel: '0 0 0 0.5px rgba(45,42,58,0.1), 0 2px 6px rgba(45,42,58,0.05), 0 18px 44px rgba(45,42,58,0.09)',
        'brand-glow': '0 8px 20px rgba(91, 52, 232, 0.3)',
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: Define utility classes and keyframe animations in `src/index.css`**

Add the `.bg-grid-paper`, `.wander-x/y`, `.status-pulse`, and `.texture-wash-*` rules to `d:/spoorf-web-cloud/frontend/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

.bg-grid-paper {
  background-image: linear-gradient(90deg, rgba(45, 42, 58, 0.06) 1px, transparent 1px),
    linear-gradient(rgba(45, 42, 58, 0.06) 1px, transparent 1px);
  background-size: 104px 104px;
}

@keyframes wander-x {
  0% { transform: translate3d(-4px, 0, 0); }
  100% { transform: translate3d(4px, 0, 0); }
}

@keyframes wander-y {
  0% { transform: translate3d(0, -5px, 0); }
  100% { transform: translate3d(0, 5px, 0); }
}

.wander-x {
  animation: wander-x 9s ease-in-out infinite alternate;
}

.wander-y {
  animation: wander-y 12s ease-in-out infinite alternate;
}

@keyframes status-pulse {
  0% { opacity: 0.7; transform: scale(1); }
  70% { opacity: 0; transform: scale(2.4); }
  100% { opacity: 0; transform: scale(2.4); }
}

.status-pulse {
  position: relative;
}
.status-pulse::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  background-color: currentColor;
  animation: status-pulse 2.5s ease-out infinite;
}

.texture-wash-mint {
  background-color: #e4f2ee;
  background-image: radial-gradient(56% 70% at 18% 30%, rgba(110, 200, 182, 0.45), transparent 70%),
    radial-gradient(48% 62% at 78% 22%, rgba(168, 220, 232, 0.5), transparent 72%),
    radial-gradient(60% 80% at 60% 85%, rgba(90, 175, 170, 0.32), transparent 70%);
}

.texture-wash-brand {
  background-color: #4a26d4;
  background-image: radial-gradient(55% 70% at 20% 25%, rgba(140, 108, 255, 0.55), transparent 70%),
    radial-gradient(50% 65% at 80% 30%, rgba(96, 52, 235, 0.6), transparent 72%),
    radial-gradient(65% 85% at 55% 90%, rgba(52, 22, 150, 0.55), transparent 75%);
}
```

- [ ] **Step 4: Verify frontend build passes**

Run: `npm run build` in `d:/spoorf-web-cloud/frontend`.  
Expected: Code 0, build passes without error.

- [ ] **Step 5: Commit changes**

```bash
git add index.html tailwind.config.js src/index.css
git commit -m "style(landing): configure Guild design tokens, fonts, and animation utilities"
```

---

### Task 2: Floating Pill Navbar Component with Smart Auth

**Files:**
- Create: `d:/spoorf-web-cloud/frontend/src/components/landing/LandingNavbar.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `../../context/AuthContext`
- Produces: `export const LandingNavbar: React.FC`

- [ ] **Step 1: Implement `LandingNavbar.tsx`**

Create `d:/spoorf-web-cloud/frontend/src/components/landing/LandingNavbar.tsx`:
- Render centered floating pill (`max-w-6xl w-full sticky top-4 z-50 px-4`).
- Glassmorphism container: `bg-white/85 backdrop-blur-md border border-border/80 shadow-card rounded-full px-6 py-3 flex items-center justify-between`.
- Logo on left: Monogram `SPOORF` with `font-sans font-bold tracking-tight text-foreground text-sm flex items-center gap-2`, plus a green `.status-pulse` dot.
- Center navigation: Links to `#showcase`, `#features`, `#architecture`, `#pricing`, and `/download`.
- Right actions:
  - If unauthenticated: Link to `/login` ("Sign in") + Button to `/register` ("Launch Console →" with `bg-brand hover:bg-brand-hover text-white shadow-brand-glow`).
  - If authenticated: Display user email + button to `/dashboard` ("Buka Dashboard →").
- Mobile menu toggle button (`Menu` / `X` icon) with dropdown sheet for small screens.

- [ ] **Step 2: Verify component compiles with `npm run build`**

Run: `npm run build` in `d:/spoorf-web-cloud/frontend`.  
Expected: Code 0, no TypeScript compilation errors.

- [ ] **Step 3: Commit changes**

```bash
git add src/components/landing/LandingNavbar.tsx
git commit -m "feat(landing): implement floating pill navbar with smart auth detection"
```

---

### Task 3: Hero Section with Dynamic Sentinel Fleet Topology Canvas

**Files:**
- Create: `d:/spoorf-web-cloud/frontend/src/components/landing/HeroTopology.tsx`

**Interfaces:**
- Consumes: `Link` from `react-router-dom`, Lucide icons (`Shield`, `Laptop`, `Radio`, `Cloud`, `Download`, `ArrowRight`, `Activity`)
- Produces: `export const HeroTopology: React.FC`

- [ ] **Step 1: Implement `HeroTopology.tsx`**

Create `d:/spoorf-web-cloud/frontend/src/components/landing/HeroTopology.tsx`:
- Top announcement badge:
  `Sentinel v2.41 · Instant 30s Heartbeat & Remote Session Kick →`
- Hero Headline:
  `One control plane for your network <span className="font-serif italic font-normal text-brand">fleet</span>.`
- Subheadline:
  `Sentinel gives every network node and operator an autonomous Layer 2 command center: sub-second discovery, precision PWM bandwidth throttling, zero-collateral defense, and cloud fleet synchronization.`
- CTA Button pair:
  - Primary button: `Launch Cloud Console →` (links to `/register`)
  - Ghost button: `Download Desktop Agent` (links to `/download`)
  - Micro-label: `Zero-HWID architecture. No credit card required. Free tier includes 5 active cuts.`
- **Dynamic Sentinel Fleet Topology Showcase**:
  - Container with `relative w-full max-w-5xl mx-auto h-[480px] mt-12 bg-white/60 border border-border/70 rounded-3xl shadow-panel overflow-hidden p-6`.
  - SVG overlay element (`absolute inset-0 w-full h-full pointer-events-none`) with 4 cubic Bezier paths:
    - Path 1: Top-Left to Center (`M 240 120 C 380 180, 420 220, 500 240`) with stroke `rgba(91, 52, 232, 0.4)` and stroke-dasharray.
    - Path 2: Top-Right to Center (`M 760 120 C 620 180, 580 220, 500 240`).
    - Path 3: Bottom-Left to Center (`M 240 380 C 380 320, 420 260, 500 240`).
    - Path 4: Bottom-Right to Center (`M 760 380 C 620 320, 580 260, 500 240`).
  - Center Node: **Core Sentinel Engine** (`Engine Armed`, `L2 Packet Injector`, `100k pkts/s live`, pulse dot).
  - 4 Wandering Node Cards with `.wander-x` & `.wander-y`:
    1. *Operator Host (`This PC`)* - IP `192.168.1.5`, Invariant 2 Protected.
    2. *Router Gateway* - IP `192.168.1.1`, Invariant 1 Immune.
    3. *Rogue / Guest Device* - IP `192.168.1.84`, PWM Throttled 25%.
    4. *Cloud Fleet Hub* - `api.spoorf.app`, 30s Heartbeat Synced.

- [ ] **Step 2: Verify component compiles with `npm run build`**

Run: `npm run build` in `d:/spoorf-web-cloud/frontend`.  
Expected: Code 0, no TypeScript compilation errors.

- [ ] **Step 3: Commit changes**

```bash
git add src/components/landing/HeroTopology.tsx
git commit -m "feat(landing): implement hero headline and dynamic sentinel fleet topology canvas"
```

---

### Task 4: Narrative Mission Lead & 4-Column Proof Ticker

**Files:**
- Create: `d:/spoorf-web-cloud/frontend/src/components/landing/MissionLead.tsx`

**Interfaces:**
- Produces: `export const MissionLead: React.FC`

- [ ] **Step 1: Implement `MissionLead.tsx`**

Create `d:/spoorf-web-cloud/frontend/src/components/landing/MissionLead.tsx`:
- Large editorial quote:
  `You cannot defend what you cannot <span className="font-serif italic text-brand font-normal">see</span>.`
- Accompanying narrative paragraph:
  `Unmonitored devices on Layer 2 are the blind spot of every private network: rogue occupants consuming bandwidth, spoofing attacks, and untracked sessions. Sentinel brings zero-collateral Layer 2 manipulation, real-time packet telemetry, and cloud fleet authorization under one neutral surface.`
- 4-column metric ticker card (`border-y border-border/80 py-10 my-16 grid grid-cols-2 md:grid-cols-4 gap-8 text-center`):
  1. `< 1.0s` — Sub-Second L2 Discovery
  2. `100k+` — Raw Injections / Sec
  3. `0ms` — Gateway Disruption
  4. `30s` — Resilient Cloud Sync

- [ ] **Step 2: Verify component compiles with `npm run build`**

Run: `npm run build` in `d:/spoorf-web-cloud/frontend`.  
Expected: Code 0, passes cleanly.

- [ ] **Step 3: Commit changes**

```bash
git add src/components/landing/MissionLead.tsx
git commit -m "feat(landing): implement mission narrative lead and 4-column metric ticker"
```

---

### Task 5: Auto-Advancing Interactive Feature Tabs Showcase

**Files:**
- Create: `d:/spoorf-web-cloud/frontend/src/components/landing/InteractiveFeatureTabs.tsx`

**Interfaces:**
- Consumes: React hooks (`useState`, `useEffect`, `useRef`), Lucide icons (`Search`, `Gauge`, `ShieldCheck`, `CloudLightning`)
- Produces: `export const InteractiveFeatureTabs: React.FC`

- [ ] **Step 1: Implement `InteractiveFeatureTabs.tsx`**

Create `d:/spoorf-web-cloud/frontend/src/components/landing/InteractiveFeatureTabs.tsx`:
- 4 Tabs state with active index (`0` to `3`):
  1. *Autonomous L2 Discovery*
  2. *Precision PWM Bandwidth Limiter*
  3. *Zero-Collateral Invariants*
  4. *Cloud Fleet & Remote Kick*
- Timer loop (6000ms per tab) with progress bar (`w-full bg-slate-200 h-1 rounded-full overflow-hidden`, inner bar growing 0% to 100%).
- Pause timer on user interaction / mouse hover.
- Live Preview Panel:
  - Tab 1: Render interactive network table with 3 discovered hosts (IP, MAC, Vendor, Status).
  - Tab 2: Render PWM duty-cycle speed slider with interactive throttle gauge.
  - Tab 3: Render Invariant Shield card with router protection bounce demo.
  - Tab 4: Render Cloud session card with interactive "Putuskan Akses (Kick)" trigger displaying a live "Sesi Telah Berakhir" alert modal.

- [ ] **Step 2: Verify component compiles with `npm run build`**

Run: `npm run build` in `d:/spoorf-web-cloud/frontend`.  
Expected: Code 0, passes cleanly.

- [ ] **Step 3: Commit changes**

```bash
git add src/components/landing/InteractiveFeatureTabs.tsx
git commit -m "feat(landing): implement auto-advancing 4-pillar interactive feature showcase"
```

---

### Task 6: Bento Features Grid, Feature Matrix & Pricing Tiers

**Files:**
- Create: `d:/spoorf-web-cloud/frontend/src/components/landing/BentoFeatures.tsx`
- Create: `d:/spoorf-web-cloud/frontend/src/components/landing/FeatureMatrix.tsx`
- Create: `d:/spoorf-web-cloud/frontend/src/components/landing/PricingTiers.tsx`

**Interfaces:**
- Produces:
  - `export const BentoFeatures: React.FC`
  - `export const FeatureMatrix: React.FC`
  - `export const PricingTiers: React.FC`

- [ ] **Step 1: Implement `BentoFeatures.tsx`**

Create multi-texture bento grid with 4 cards:
- Card 1: `texture-wash-brand` (Violet gradient) — Hybrid Microservices Architecture.
- Card 2: `texture-wash-mint` (Mint gradient) — Zero-HWID Privacy & Asymmetric Cryptography.
- Card 3: Slate card — Bettercap Arsenal & Captive Portal Redirection.
- Card 4: Paper grid card (`.bg-grid-paper`) — Continuous State Persistence (SQLite WAL + Postgres 17).

- [ ] **Step 2: Implement `FeatureMatrix.tsx`**

Create 3-column dense technical checklist:
- Column 1: Layer 2 Engine & Hardcoded Invariants.
- Column 2: Cloud Fleet & Access Governance.
- Column 3: Developer & System Standards (562 automated tests, Zod validation, Pino ECS logging).

- [ ] **Step 3: Implement `PricingTiers.tsx`**

Create 3 transparent tier cards:
- Free ($0): 1 session, 5 cut quota, Invariant 1 & 2, 30s heartbeat.
- Pro ($19): 2 sessions, unlimited cuts, PWM limiter, captive portal, auto-reblock (*Most Popular* badge with brand purple border & button).
- VIP ($49): 5 sessions, full Bettercap arsenal, leaf SSL generator, deep OS fingerprinting.

- [ ] **Step 4: Verify components compile with `npm run build`**

Run: `npm run build` in `d:/spoorf-web-cloud/frontend`.  
Expected: Code 0, passes cleanly.

- [ ] **Step 5: Commit changes**

```bash
git add src/components/landing/BentoFeatures.tsx src/components/landing/FeatureMatrix.tsx src/components/landing/PricingTiers.tsx
git commit -m "feat(landing): implement bento grid, feature matrix, and pricing tier cards"
```

---

### Task 7: Closing CTA Banner, Footer & Root Landing Page Composer

**Files:**
- Create: `d:/spoorf-web-cloud/frontend/src/components/landing/LandingFooter.tsx`
- Create: `d:/spoorf-web-cloud/frontend/src/pages/LandingPage.tsx`
- Modify: `d:/spoorf-web-cloud/frontend/src/App.tsx:1-41`

**Interfaces:**
- Produces: `export const LandingFooter: React.FC`
- Produces: `export const LandingPage: React.FC`
- Modifies: `App.tsx` router so `/` maps to `<LandingPage />` instead of redirecting to `/dashboard`.

- [ ] **Step 1: Implement `LandingFooter.tsx`**

Create `d:/spoorf-web-cloud/frontend/src/components/landing/LandingFooter.tsx`:
- Closing CTA card: `Take full command of your Layer 2 perimeter.` with dual buttons (`Launch Cloud Console →` and `Download Desktop Agent`).
- Footer links organized in 3 columns: Product, Security, Resources.
- Status pill: Emerald pulsing dot `All Systems Operational · Cloud Heartbeat Live`.
- Copyright notice: `© 2026 Spoorf NetCut Sentinel. Built for autonomous network defense.`

- [ ] **Step 2: Implement `LandingPage.tsx`**

Create `d:/spoorf-web-cloud/frontend/src/pages/LandingPage.tsx`:
- Wrap components in `<div className="min-h-screen bg-background text-foreground font-sans bg-grid-paper selection:bg-brand selection:text-white relative overflow-x-hidden">`.
- Compose in order:
  1. `<LandingNavbar />`
  2. `<section id="hero"><HeroTopology /></section>`
  3. `<section id="mission"><MissionLead /></section>`
  4. `<section id="showcase"><InteractiveFeatureTabs /></section>`
  5. `<section id="features"><BentoFeatures /></section>`
  6. `<section id="architecture"><FeatureMatrix /></section>`
  7. `<section id="pricing"><PricingTiers /></section>`
  8. `<LandingFooter />`

- [ ] **Step 3: Wire `/` route in `src/App.tsx`**

Update `d:/spoorf-web-cloud/frontend/src/App.tsx`:
```tsx
import { LandingPage } from './pages/LandingPage';

// Inside <Routes>:
<Route path="/" element={<LandingPage />} />
```
Ensure `/login`, `/register`, `/dashboard`, and `/download` remain functional.

- [ ] **Step 4: Run full verification suite**

Run:
```powershell
# 1. Test frontend production build
cd d:/spoorf-web-cloud/frontend
npm run build

# 2. Test backend API test suite
cd d:/spoorf-web-cloud/backend
npm test
```
Expected: Both exit code 0. Zero TypeScript errors, 100% backend tests passing.

- [ ] **Step 5: Commit changes**

```bash
git add src/components/landing/LandingFooter.tsx src/pages/LandingPage.tsx src/App.tsx
git commit -m "feat(landing): assemble LandingPage at root route with footer and full routing integration"
```
