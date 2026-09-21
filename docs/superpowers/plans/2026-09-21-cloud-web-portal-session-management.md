# Cloud Web Portal & Active Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy the user-facing Web Portal SPA (`spoorf-web-cloud/frontend`) and supporting Session Management REST endpoints (`spoorf-web-cloud/backend`), enabling users to authenticate, inspect live desktop session statuses, revoke rogue/excess sessions remotely ("Kick Mechanism"), and download desktop installers.

**Architecture:** Decoupled SaaS architecture. The Cloud Backend (Express + Prisma + PostgreSQL 17) exposes authenticated Session & Download endpoints. The Web Portal (React 18 + Vite + Tailwind CSS + `react-router-dom`) consumes the API, maintains reactive authentication state via `AuthContext`, and renders Sentinel Cyber-Dark UI cards with strict `lucide-react` vector icons.

**Tech Stack:** Node.js 20+, Express, Prisma ORM, PostgreSQL 17, React 18, Vite 5, Tailwind CSS 3, `react-router-dom` v6, `lucide-react`, Axios, Jest / Supertest.

**Spec:** [`docs/superpowers/specs/2026-09-21-cloud-web-portal-session-management-design.md`](file:///d:/spoorf/docs/superpowers/specs/2026-09-21-cloud-web-portal-session-management-design.md)

## Global Constraints

- **Strict Lucide-React Icons:** ALL icons in the web frontend MUST strictly use vector components from `lucide-react`. NEVER use text emojis or default HTML/browser symbols.
- **Sentinel Cyber-Dark Theme:** Follow the Slate/Zinc-950 dark design system matching the desktop application, with emerald/cyan accent highlights for active statuses.
- **Multi-Tenant Isolation:** All session queries and mutations in backend MUST be strictly scoped to `req.user.id`. Probing other users' sessions must return 404/403.
- **Zero Network Telemetry Invariant:** The cloud server and web portal NEVER accept, store, or display local target IPs or sniffed LAN MACs. Only client hardware OS, app version, and public IP are displayed.
- **Desktop Zero-Regression Invariant:** Existing desktop test suites (562 tests: 430 Python + 132 Node.js) in `d:/spoorf` must remain 100% green.

---

### Task 1: Backend Session Service & Prisma Operations

**Files:**
- Create: `d:/spoorf-web-cloud/backend/src/services/sessionService.ts`
- Test: `d:/spoorf-web-cloud/backend/tests/session_service.test.ts`

**Interfaces:**
- Consumes: PrismaClient from `src/config/database.ts`, `AppError` subclasses (`NotFoundError`, `ForbiddenError`, `BadRequestError`) from `src/errors/AppError.ts`.
- Produces: `SessionService` with `getUserSessions(userId)`, `revokeSession(userId, identifier)`, and `revokeAllSessions(userId)`.

- [ ] **Step 1: Write the failing test for SessionService**

Create `d:/spoorf-web-cloud/backend/tests/session_service.test.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import { SessionService } from '../src/services/sessionService';
import { NotFoundError } from '../src/errors/AppError';

describe('SessionService Unit & Integration', () => {
  let db: PrismaClient;
  let service: SessionService;
  let testUserId: string;
  let otherUserId: string;

  beforeAll(async () => {
    db = new PrismaClient();
    service = new SessionService(db);

    // Clean test users
    await db.session.deleteMany({});
    await db.user.deleteMany({
      where: { email: { in: ['test_sess_user@spoorf.test', 'other_sess_user@spoorf.test'] } },
    });

    const u1 = await db.user.create({
      data: {
        email: 'test_sess_user@spoorf.test',
        passwordHash: 'hash',
        name: 'Session Test User',
      },
    });
    testUserId = u1.id;

    const u2 = await db.user.create({
      data: {
        email: 'other_sess_user@spoorf.test',
        passwordHash: 'hash',
        name: 'Other User',
      },
    });
    otherUserId = u2.id;
  });

  afterAll(async () => {
    await db.session.deleteMany({ where: { userId: { in: [testUserId, otherUserId] } } });
    await db.user.deleteMany({ where: { id: { in: [testUserId, otherUserId] } } });
    await db.$disconnect();
  });

  it('creates and lists user sessions with computed is_online status', async () => {
    await db.session.create({
      data: {
        userId: testUserId,
        sessionId: 'test-sess-live-1',
        deviceName: 'Laptop Test ROG',
        platform: 'win32',
        appVersion: '2.41.79',
        lastSeenAt: new Date(), // recent -> is_online: true
      },
    });

    await db.session.create({
      data: {
        userId: testUserId,
        sessionId: 'test-sess-idle-2',
        deviceName: 'Old Desktop',
        platform: 'win32',
        appVersion: '2.41.70',
        lastSeenAt: new Date(Date.now() - 15 * 60 * 1000), // 15 mins ago -> is_online: false
      },
    });

    const sessions = await service.getUserSessions(testUserId);
    expect(sessions.length).toBe(2);
    expect(sessions[0].sessionId).toBe('test-sess-live-1');
    expect(sessions[0].is_online).toBe(true);
    expect(sessions[1].sessionId).toBe('test-sess-idle-2');
    expect(sessions[1].is_online).toBe(false);
  });

  it('revokes a specific session and sets revokedReason', async () => {
    const res = await service.revokeSession(testUserId, 'test-sess-live-1');
    expect(res.success).toBe(true);

    const updated = await db.session.findUnique({ where: { sessionId: 'test-sess-live-1' } });
    expect(updated?.isRevoked).toBe(true);
    expect(updated?.revokedAt).not.toBeNull();
    expect(updated?.revokedReason).toContain('Web Dashboard');
  });

  it('rejects attempt to revoke another user session (multi-tenant guard)', async () => {
    await db.session.create({
      data: {
        userId: otherUserId,
        sessionId: 'other-user-sess-1',
        deviceName: 'Secret Laptop',
      },
    });

    await expect(service.revokeSession(testUserId, 'other-user-sess-1')).rejects.toThrow(
      NotFoundError
    );
  });

  it('revokes all active sessions for user', async () => {
    await db.session.create({
      data: {
        userId: testUserId,
        sessionId: 'test-sess-batch-3',
        deviceName: 'Batch Target 1',
        isRevoked: false,
      },
    });

    const batchRes = await service.revokeAllSessions(testUserId);
    expect(batchRes.revokedCount).toBeGreaterThanOrEqual(1);

    const activeRemaining = await db.session.count({
      where: { userId: testUserId, isRevoked: false },
    });
    expect(activeRemaining).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
cd d:/spoorf-web-cloud/backend
npm test -- tests/session_service.test.ts
```
Expected: FAIL with `Cannot find module '../src/services/sessionService'`.

- [ ] **Step 3: Implement SessionService**

Create `d:/spoorf-web-cloud/backend/src/services/sessionService.ts`:
```ts
import { PrismaClient, Session } from '@prisma/client';
import prisma from '../config/database';
import { NotFoundError } from '../errors/AppError';

export interface EnrichedSession extends Session {
  is_online: boolean;
}

export class SessionService {
  private db: PrismaClient;

  constructor(db: PrismaClient = prisma) {
    this.db = db;
  }

  /**
   * List all sessions for a specific user, ordered by lastSeenAt descending.
   * Computes is_online based on heartbeat within the last 5 minutes.
   */
  public async getUserSessions(userId: string): Promise<EnrichedSession[]> {
    const sessions = await this.db.session.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
    });

    const now = Date.now();
    const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

    return sessions.map((sess) => {
      const lastSeenTime = new Date(sess.lastSeenAt).getTime();
      const isOnline = !sess.isRevoked && now - lastSeenTime < ONLINE_THRESHOLD_MS;
      return {
        ...sess,
        is_online: isOnline,
      };
    });
  }

  /**
   * Soft-revoke a specific session by its database id or client sessionId.
   * Enforces multi-tenant ownership: returns NotFoundError if session doesn't belong to userId.
   */
  public async revokeSession(
    userId: string,
    identifier: string
  ): Promise<{ success: boolean; message: string }> {
    const session = await this.db.session.findFirst({
      where: {
        userId,
        OR: [{ id: identifier }, { sessionId: identifier }],
      },
    });

    if (!session) {
      throw new NotFoundError('Sesi tidak ditemukan atau bukan milik akun Anda.');
    }

    await this.db.session.update({
      where: { id: session.id },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
        revokedReason: 'Dicabut secara manual oleh pengguna melalui Web Dashboard',
      },
    });

    return {
      success: true,
      message: 'Sesi berhasil dicabut.',
    };
  }

  /**
   * Revoke all active, unrevoked sessions for the given user.
   */
  public async revokeAllSessions(
    userId: string
  ): Promise<{ success: boolean; revokedCount: number; message: string }> {
    const result = await this.db.session.updateMany({
      where: {
        userId,
        isRevoked: false,
      },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
        revokedReason: 'Dicabut massal oleh pengguna melalui Web Dashboard',
      },
    });

    return {
      success: true,
      revokedCount: result.count,
      message: `${result.count} sesi aktif berhasil dicabut.`,
    };
  }
}

export default new SessionService();
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
cd d:/spoorf-web-cloud/backend
npm test -- tests/session_service.test.ts
```
Expected: PASS (all 4 tests pass).

- [ ] **Step 5: Commit SessionService**

```powershell
cd d:/spoorf-web-cloud/backend
git add src/services/sessionService.ts tests/session_service.test.ts
git commit -m "feat(sessions): implement SessionService with multi-tenant soft revocation"
```

---

### Task 2: Backend Session & Download REST Controllers and Routes

**Files:**
- Create: `d:/spoorf-web-cloud/backend/src/controllers/sessionController.ts`
- Create: `d:/spoorf-web-cloud/backend/src/routes/sessionRoutes.ts`
- Create: `d:/spoorf-web-cloud/backend/src/controllers/downloadController.ts`
- Create: `d:/spoorf-web-cloud/backend/src/routes/downloadRoutes.ts`
- Modify: `d:/spoorf-web-cloud/backend/src/app.ts`
- Test: `d:/spoorf-web-cloud/backend/tests/session_api.test.ts`

**Interfaces:**
- Consumes: `SessionService` from `src/services/sessionService.ts`, `requireAuth` from `src/middlewares/authGuard.ts`.
- Produces: REST endpoints `GET /v1/sessions`, `POST /v1/sessions/:id/revoke`, `POST /v1/sessions/revoke-all`, `GET /v1/download/latest`.

- [ ] **Step 1: Write the failing API test for Session and Download routes**

Create `d:/spoorf-web-cloud/backend/tests/session_api.test.ts`:
```ts
import request from 'supertest';
import app from '../src/app';
import prisma from '../config/database';
import { getDefaultCryptoSigner } from '../src/utils/cryptoSigner';

describe('Session & Download REST API', () => {
  let tokenUser1: string;
  let tokenUser2: string;
  let user1Id: string;
  let user2Id: string;
  let session1Id: string;

  beforeAll(async () => {
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({
      where: { email: { in: ['api_sess_1@test.com', 'api_sess_2@test.com'] } },
    });

    const u1 = await prisma.user.create({
      data: { email: 'api_sess_1@test.com', passwordHash: 'hash', name: 'User 1' },
    });
    user1Id = u1.id;

    const u2 = await prisma.user.create({
      data: { email: 'api_sess_2@test.com', passwordHash: 'hash', name: 'User 2' },
    });
    user2Id = u2.id;

    const signer = getDefaultCryptoSigner();
    tokenUser1 = signer.signLicenseToken({
      userId: user1Id,
      email: u1.email,
      role: 'user',
      tier: 'pro',
      maxCuts: 15,
      canThrottle: true,
      canGateway: true,
      canAutoreblock: true,
      canArsenal: false,
      canDeepFingerprint: false,
      cloudSync: true,
      gracePeriodUntil: new Date(Date.now() + 86400000).toISOString(),
    });

    tokenUser2 = signer.signLicenseToken({
      userId: user2Id,
      email: u2.email,
      role: 'user',
      tier: 'free',
      maxCuts: 5,
      canThrottle: false,
      canGateway: false,
      canAutoreblock: false,
      canArsenal: false,
      canDeepFingerprint: false,
      cloudSync: false,
      gracePeriodUntil: new Date(Date.now() + 86400000).toISOString(),
    });

    const sess = await prisma.session.create({
      data: {
        userId: user1Id,
        sessionId: 'api-client-sess-1',
        deviceName: 'Workstation 1',
        platform: 'win32',
        appVersion: '2.41.79',
      },
    });
    session1Id = sess.id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: [user1Id, user2Id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [user1Id, user2Id] } } });
    await prisma.$disconnect();
  });

  it('GET /v1/sessions rejects unauthenticated access with 401', async () => {
    const res = await request(app).get('/v1/sessions');
    expect(res.status).toBe(401);
  });

  it('GET /v1/sessions returns user sessions for authenticated user', async () => {
    const res = await request(app)
      .get('/v1/sessions')
      .set('Authorization', `Bearer ${tokenUser1}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sessions.length).toBe(1);
    expect(res.body.sessions[0].deviceName).toBe('Workstation 1');
  });

  it('POST /v1/sessions/:id/revoke revokes session for owner', async () => {
    const res = await request(app)
      .post(`/v1/sessions/${session1Id}/revoke`)
      .set('Authorization', `Bearer ${tokenUser1}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /v1/sessions/:id/revoke rejects non-owner with 404', async () => {
    const res = await request(app)
      .post(`/v1/sessions/${session1Id}/revoke`)
      .set('Authorization', `Bearer ${tokenUser2}`); // User 2 trying to revoke User 1's session
    expect(res.status).toBe(404);
  });

  it('POST /v1/sessions/revoke-all revokes all sessions', async () => {
    await prisma.session.create({
      data: { userId: user1Id, sessionId: 'api-client-sess-extra', isRevoked: false },
    });
    const res = await request(app)
      .post('/v1/sessions/revoke-all')
      .set('Authorization', `Bearer ${tokenUser1}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /v1/download/latest returns desktop release metadata', async () => {
    const res = await request(app).get('/v1/download/latest');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.release.version).toBeDefined();
    expect(res.body.release.filename).toContain('.exe');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
cd d:/spoorf-web-cloud/backend
npm test -- tests/session_api.test.ts
```
Expected: FAIL with 404 on `/v1/sessions`.

- [ ] **Step 3: Implement SessionController, SessionRoutes, DownloadController, DownloadRoutes, and wire into app.ts**

Create `d:/spoorf-web-cloud/backend/src/controllers/sessionController.ts`:
```ts
import { Request, Response, NextFunction } from 'express';
import sessionService from '../services/sessionService';

export class SessionController {
  public async getSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user.userId;
      const sessions = await sessionService.getUserSessions(userId);
      res.status(200).json({
        success: true,
        sessions,
      });
    } catch (err) {
      next(err);
    }
  }

  public async revokeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user.userId;
      const { id } = req.params;
      const result = await sessionService.revokeSession(userId, id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  public async revokeAllSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user.userId;
      const result = await sessionService.revokeAllSessions(userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export default new SessionController();
```

Create `d:/spoorf-web-cloud/backend/src/routes/sessionRoutes.ts`:
```ts
import { Router } from 'express';
import sessionController from '../controllers/sessionController';
import { requireAuth } from '../middlewares/authGuard';

const router = Router();

router.get('/', requireAuth, sessionController.getSessions);
router.post('/revoke-all', requireAuth, sessionController.revokeAllSessions);
router.post('/:id/revoke', requireAuth, sessionController.revokeSession);

export default router;
```

Create `d:/spoorf-web-cloud/backend/src/controllers/downloadController.ts`:
```ts
import { Request, Response } from 'express';

export class DownloadController {
  public getLatestRelease(req: Request, res: Response): void {
    res.status(200).json({
      success: true,
      release: {
        version: '2.41.79',
        platform: 'windows-x64',
        filename: 'Spoorf Sentinel Setup 1.0.0.exe',
        downloadUrl: '/downloads/Spoorf%20Sentinel%20Setup%201.0.0.exe',
        fileSizeBytes: 98566144,
        releaseDate: '2026-09-21',
        releaseNotes:
          'Background heartbeat engine, 7-day sliding grace period window, remote kick reconciler, and anti-self-cut security guards.',
      },
    });
  }
}

export default new DownloadController();
```

Create `d:/spoorf-web-cloud/backend/src/routes/downloadRoutes.ts`:
```ts
import { Router } from 'express';
import downloadController from '../controllers/downloadController';

const router = Router();

router.get('/latest', downloadController.getLatestRelease);

export default router;
```

Modify `d:/spoorf-web-cloud/backend/src/app.ts` to mount the new routers:
```ts
// Add imports
import sessionRoutes from './routes/sessionRoutes';
import downloadRoutes from './routes/downloadRoutes';

// Mount routes
app.use('/v1/sessions', sessionRoutes);
app.use('/api/v1/sessions', sessionRoutes);
app.use('/v1/download', downloadRoutes);
app.use('/api/v1/download', downloadRoutes);
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
cd d:/spoorf-web-cloud/backend
npm test -- tests/session_api.test.ts
```
Expected: PASS (all 6 tests pass).

- [ ] **Step 5: Run full backend test suite to verify zero regression**

Run:
```powershell
cd d:/spoorf-web-cloud/backend
npm test
```
Expected: All tests pass.

- [ ] **Step 6: Commit backend session & download routes**

```powershell
cd d:/spoorf-web-cloud/backend
git add src/controllers/sessionController.ts src/routes/sessionRoutes.ts src/controllers/downloadController.ts src/routes/downloadRoutes.ts src/app.ts tests/session_api.test.ts
git commit -m "feat(api): add session management and desktop release download routes"
```

---

### Task 3: Frontend Dependencies, Type Contracts & API Client

**Files:**
- Modify: `d:/spoorf-web-cloud/frontend/package.json`
- Create: `d:/spoorf-web-cloud/frontend/src/types/auth.ts`
- Create: `d:/spoorf-web-cloud/frontend/src/types/session.ts`
- Create: `d:/spoorf-web-cloud/frontend/src/services/api.ts`
- Create: `d:/spoorf-web-cloud/frontend/src/services/sessionService.ts`

**Interfaces:**
- Consumes: Axios, `lucide-react`.
- Produces: Typed API clients for Auth and Sessions with automatic Bearer token injection and 401 redirection.

- [ ] **Step 1: Install react-router-dom**

Run:
```powershell
cd d:/spoorf-web-cloud/frontend
npm install react-router-dom@^6.23.1
```
Verify `react-router-dom` is added to `dependencies`.

- [ ] **Step 2: Create TypeScript type definitions**

Create `d:/spoorf-web-cloud/frontend/src/types/auth.ts`:
```ts
export type LicenseTier = 'free' | 'pro' | 'vip';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar_url?: string | null;
}

export interface LicenseInfo {
  tier: LicenseTier;
  max_cuts: number;
  can_throttle: boolean;
  can_gateway: boolean;
  can_autoreblock: boolean;
  can_arsenal: boolean;
  can_deep_fingerprint: boolean;
  cloud_sync: boolean;
  expires_at: string | null;
  grace_period_until: string;
}

export interface AuthResponse {
  status: string;
  token: string;
  user: UserProfile;
  license: LicenseInfo;
}
```

Create `d:/spoorf-web-cloud/frontend/src/types/session.ts`:
```ts
export interface DeviceSession {
  id: string;
  userId: string;
  sessionId: string;
  deviceName: string | null;
  platform: string | null;
  appVersion: string | null;
  ipAddress: string | null;
  isRevoked: boolean;
  revokedAt: string | null;
  revokedReason: string | null;
  lastSeenAt: string;
  createdAt: string;
  is_online: boolean;
}

export interface SessionListResponse {
  success: boolean;
  sessions: DeviceSession[];
}

export interface RevokeResponse {
  success: boolean;
  message: string;
}
```

- [ ] **Step 3: Create Axios client and Session API service**

Create `d:/spoorf-web-cloud/frontend/src/services/api.ts`:
```ts
import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/v1';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('spoorf_cloud_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('spoorf_cloud_token');
      localStorage.removeItem('spoorf_cloud_user');
      if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
```

Create `d:/spoorf-web-cloud/frontend/src/services/sessionService.ts`:
```ts
import api from './api';
import { SessionListResponse, RevokeResponse } from '../types/session';

export const sessionService = {
  async getSessions(): Promise<SessionListResponse> {
    const res = await api.get<SessionListResponse>('/sessions');
    return res.data;
  },

  async revokeSession(id: string): Promise<RevokeResponse> {
    const res = await api.post<RevokeResponse>(`/sessions/${id}/revoke`);
    return res.data;
  },

  async revokeAllSessions(): Promise<RevokeResponse & { revokedCount?: number }> {
    const res = await api.post<RevokeResponse & { revokedCount?: number }>('/sessions/revoke-all');
    return res.data;
  },
};

export default sessionService;
```

- [ ] **Step 4: Verify TypeScript compilation**

Run:
```powershell
cd d:/spoorf-web-cloud/frontend
npx tsc --noEmit
```
Expected: Exit code 0 (no errors).

- [ ] **Step 5: Commit frontend types & API layer**

```powershell
cd d:/spoorf-web-cloud/frontend
git add package.json package-lock.json src/types/ src/services/
git commit -m "feat(frontend): add react-router-dom, types contracts, and Axios session client"
```

---

### Task 4: AuthContext, ProtectedRoute, and Unified Cyber Navbar

**Files:**
- Create: `d:/spoorf-web-cloud/frontend/src/context/AuthContext.tsx`
- Create: `d:/spoorf-web-cloud/frontend/src/components/common/ProtectedRoute.tsx`
- Create: `d:/spoorf-web-cloud/frontend/src/components/layout/Navbar.tsx`

**Interfaces:**
- Consumes: `api` from `services/api.ts`, `lucide-react` icons (`Shield`, `LogOut`, `Laptop`, `Download`, `User`).
- Produces: `useAuth()` hook providing `user`, `license`, `token`, `login`, `register`, `logout`, `refreshProfile`.

- [ ] **Step 1: Implement AuthContext**

Create `d:/spoorf-web-cloud/frontend/src/context/AuthContext.tsx`:
```tsx
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api from '../services/api';
import { UserProfile, LicenseInfo, AuthResponse } from '../types/auth';

interface AuthContextType {
  user: UserProfile | null;
  license: LicenseInfo | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('spoorf_cloud_token'));
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshProfile = async () => {
    try {
      const res = await api.get<{ status: string; user: UserProfile; license: LicenseInfo }>('/auth/me');
      setUser(res.data.user);
      setLicense(res.data.license);
    } catch {
      logout();
    }
  };

  useEffect(() => {
    if (token) {
      refreshProfile().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [token]);

  const login = async (email: string, password: string) => {
    const res = await api.post<AuthResponse>('/auth/login', { email, password });
    const { token: newToken, user: newUser, license: newLicense } = res.data;
    localStorage.setItem('spoorf_cloud_token', newToken);
    setToken(newToken);
    setUser(newUser);
    setLicense(newLicense);
  };

  const register = async (email: string, password: string, name?: string) => {
    const res = await api.post<AuthResponse>('/auth/register', { email, password, name });
    const { token: newToken, user: newUser, license: newLicense } = res.data;
    localStorage.setItem('spoorf_cloud_token', newToken);
    setToken(newToken);
    setUser(newUser);
    setLicense(newLicense);
  };

  const logout = () => {
    localStorage.removeItem('spoorf_cloud_token');
    setToken(null);
    setUser(null);
    setLicense(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        license,
        token,
        isAuthenticated: !!token && !!user,
        isLoading,
        login,
        register,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
```

- [ ] **Step 2: Implement ProtectedRoute**

Create `d:/spoorf-web-cloud/frontend/src/components/common/ProtectedRoute.tsx`:
```tsx
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Shield } from 'lucide-react';

export const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-cyan-400">
        <Shield className="w-12 h-12 animate-pulse mb-4 text-cyan-500" />
        <p className="text-sm font-mono tracking-widest text-slate-400 uppercase">Mengautentikasi Sesi...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};
```

- [ ] **Step 3: Implement Navbar with Sentinel Cyber Theme & Strict Lucide Icons**

Create `d:/spoorf-web-cloud/frontend/src/components/layout/Navbar.tsx`:
```tsx
import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Shield, Laptop, Download, LogOut, User } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, license, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getTierBadge = () => {
    const tier = license?.tier || 'free';
    if (tier === 'vip') {
      return 'bg-purple-900/60 text-purple-300 border-purple-500/50 shadow-purple-500/20';
    }
    if (tier === 'pro') {
      return 'bg-emerald-900/60 text-emerald-300 border-emerald-500/50 shadow-emerald-500/20';
    }
    return 'bg-slate-800 text-slate-300 border-slate-600/50';
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 flex items-center justify-center group-hover:border-cyan-400 transition-colors shadow-lg shadow-cyan-950/50">
            <Shield className="w-5 h-5 text-cyan-400 group-hover:scale-110 transition-transform" />
          </div>
          <div>
            <span className="text-lg font-bold tracking-wider text-white font-mono flex items-center gap-1.5">
              SPOORF <span className="text-cyan-400 font-semibold">CLOUD</span>
            </span>
            <span className="block text-[10px] text-slate-400 font-mono tracking-widest uppercase">
              Sentinel Command Portal
            </span>
          </div>
        </Link>

        {/* Navigation & User Pill */}
        <div className="flex items-center gap-4">
          {isAuthenticated ? (
            <>
              <nav className="flex items-center gap-2">
                <Link
                  to="/dashboard"
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                    location.pathname === '/dashboard'
                      ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  <Laptop className="w-4 h-4" />
                  Dashboard
                </Link>
                <Link
                  to="/download"
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                    location.pathname === '/download'
                      ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  <Download className="w-4 h-4" />
                  Unduh Desktop
                </Link>
              </nav>

              <div className="h-6 w-px bg-slate-800" />

              {/* User Pill */}
              <div className="flex items-center gap-3 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-xl">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-400" />
                  <span className="text-xs text-slate-200 font-medium max-w-[140px] truncate">
                    {user?.name || user?.email}
                  </span>
                </div>
                <span
                  className={`text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-md border shadow-sm ${getTierBadge()}`}
                >
                  {license?.tier || 'FREE'}
                </span>
                <button
                  onClick={handleLogout}
                  title="Logout"
                  className="text-slate-400 hover:text-rose-400 transition-colors p-1 rounded-md hover:bg-slate-800"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Link
                to="/login"
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
              >
                Masuk
              </Link>
              <Link
                to="/register"
                className="px-4 py-2 text-sm font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors shadow-lg shadow-cyan-900/30"
              >
                Daftar Akun
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
```

- [ ] **Step 4: Verify TypeScript compilation**

Run:
```powershell
cd d:/spoorf-web-cloud/frontend
npx tsc --noEmit
```
Expected: Exit code 0.

- [ ] **Step 5: Commit AuthContext & Layout**

```powershell
cd d:/spoorf-web-cloud/frontend
git add src/context/ src/components/
git commit -m "feat(frontend): implement AuthContext, ProtectedRoute, and Sentinel Cyber Navbar"
```

---

### Task 5: Authentication Pages (LoginPage & RegisterPage)

**Files:**
- Create: `d:/spoorf-web-cloud/frontend/src/pages/LoginPage.tsx`
- Create: `d:/spoorf-web-cloud/frontend/src/pages/RegisterPage.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `context/AuthContext.tsx`, `lucide-react` (`Shield`, `Lock`, `Mail`, `User`, `AlertCircle`, `ArrowRight`).
- Produces: Visual login and register routes.

- [ ] **Step 1: Implement LoginPage**

Create `d:/spoorf-web-cloud/frontend/src/pages/LoginPage.tsx`:
```tsx
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Shield, Lock, Mail, AlertCircle, ArrowRight } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Gagal masuk. Periksa kembali email dan kata sandi Anda.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12 bg-slate-950">
      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 p-8 rounded-2xl shadow-2xl backdrop-blur-md">
        <div className="text-center mb-8">
          <div className="inline-flex p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 mb-3 shadow-lg shadow-cyan-950/50">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-wide font-mono">Masuk ke Portal Cloud</h1>
          <p className="text-sm text-slate-400 mt-1">Kelola lisensi dan sesi perangkat desktop Spoorf Anda</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 mb-2">
              Alamat Email
            </label>
            <div className="relative">
              <Mail className="w-5 h-5 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@sentinel.lan"
                className="w-full pl-11 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-sm font-mono transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 mb-2">
              Kata Sandi
            </label>
            <div className="relative">
              <Lock className="w-5 h-5 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-11 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-sm font-mono transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-cyan-950/50 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <span className="font-mono text-sm">Mengotentikasi...</span>
            ) : (
              <>
                <span>Masuk ke Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-slate-400">
          Belum memiliki akun?{' '}
          <Link to="/register" className="text-cyan-400 hover:text-cyan-300 font-medium transition-colors">
            Daftar sekarang
          </Link>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Implement RegisterPage**

Create `d:/spoorf-web-cloud/frontend/src/pages/RegisterPage.tsx`:
```tsx
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Shield, Lock, Mail, User, AlertCircle, ArrowRight } from 'lucide-react';

export const RegisterPage: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await register(email, password, name);
      navigate('/dashboard');
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Pendaftaran gagal. Silakan coba lagi.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12 bg-slate-950">
      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 p-8 rounded-2xl shadow-2xl backdrop-blur-md">
        <div className="text-center mb-8">
          <div className="inline-flex p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 mb-3 shadow-lg shadow-cyan-950/50">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-wide font-mono">Daftar Akun Spoorf</h1>
          <p className="text-sm text-slate-400 mt-1">Dapatkan paket Free standar otomatis setelah mendaftar</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 mb-2">
              Nama Lengkap / Panggilan
            </label>
            <div className="relative">
              <User className="w-5 h-5 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Operator Sentinel"
                className="w-full pl-11 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-sm font-mono transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 mb-2">
              Alamat Email
            </label>
            <div className="relative">
              <Mail className="w-5 h-5 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@sentinel.lan"
                className="w-full pl-11 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-sm font-mono transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 mb-2">
              Kata Sandi
            </label>
            <div className="relative">
              <Lock className="w-5 h-5 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 6 karakter"
                className="w-full pl-11 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-sm font-mono transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-cyan-950/50 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <span className="font-mono text-sm">Mendaftarkan...</span>
            ) : (
              <>
                <span>Buat Akun & Masuk</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-slate-400">
          Sudah memiliki akun?{' '}
          <Link to="/login" className="text-cyan-400 hover:text-cyan-300 font-medium transition-colors">
            Masuk di sini
          </Link>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Verify TypeScript compilation**

Run:
```powershell
cd d:/spoorf-web-cloud/frontend
npx tsc --noEmit
```
Expected: Exit code 0.

- [ ] **Step 4: Commit auth pages**

```powershell
cd d:/spoorf-web-cloud/frontend
git add src/pages/LoginPage.tsx src/pages/RegisterPage.tsx
git commit -m "feat(frontend): add Cyber-Dark LoginPage and RegisterPage"
```

---

### Task 6: Dashboard Page, ConfirmModal & Remote Kick Interaction

**Files:**
- Create: `d:/spoorf-web-cloud/frontend/src/components/common/ConfirmModal.tsx`
- Create: `d:/spoorf-web-cloud/frontend/src/pages/DashboardPage.tsx`

**Interfaces:**
- Consumes: `sessionService` from `services/sessionService.ts`, `useAuth()` from `context/AuthContext.tsx`, `lucide-react` (`AlertTriangle`, `Laptop`, `Monitor`, `PowerOff`, `RefreshCw`, `CheckCircle2`, `Wifi`, `WifiOff`, `Clock`, `Shield`, `Zap`).
- Produces: The complete active session management experience.

- [ ] **Step 1: Implement ConfirmModal**

Create `d:/spoorf-web-cloud/frontend/src/components/common/ConfirmModal.tsx`:
```tsx
import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Konfirmasi',
  cancelLabel = 'Batal',
  isDanger = true,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
        <div className="flex items-center gap-3 text-rose-400 mb-4">
          <div className="p-2.5 rounded-xl bg-rose-950/50 border border-rose-800/50">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white font-mono">{title}</h3>
        </div>

        <p className="text-sm text-slate-300 mb-6 leading-relaxed">{message}</p>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors shadow-lg ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/50'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-950/50'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Implement DashboardPage**

Create `d:/spoorf-web-cloud/frontend/src/pages/DashboardPage.tsx`:
```tsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import sessionService from '../services/sessionService';
import { DeviceSession } from '../types/session';
import { ConfirmModal } from '../components/common/ConfirmModal';
import {
  Laptop,
  Monitor,
  PowerOff,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Shield,
  Zap,
  Globe,
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const { user, license } = useAuth();
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Modal states
  const [targetToRevoke, setTargetToRevoke] = useState<DeviceSession | null>(null);
  const [isRevokeAllOpen, setIsRevokeAllOpen] = useState<boolean>(false);

  const fetchSessions = async () => {
    setIsLoading(true);
    try {
      const data = await sessionService.getSessions();
      setSessions(data.sessions);
    } catch {
      setFeedback({ type: 'error', message: 'Gagal memuat sesi perangkat.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleConfirmSingleRevoke = async () => {
    if (!targetToRevoke) return;
    try {
      await sessionService.revokeSession(targetToRevoke.id);
      setFeedback({
        type: 'success',
        message: `Akses perangkat "${targetToRevoke.deviceName || targetToRevoke.sessionId.substring(0, 8)}" berhasil dicabut.`,
      });
      fetchSessions();
    } catch {
      setFeedback({ type: 'error', message: 'Gagal mencabut sesi perangkat.' });
    } finally {
      setTargetToRevoke(null);
    }
  };

  const handleConfirmRevokeAll = async () => {
    try {
      const res = await sessionService.revokeAllSessions();
      setFeedback({
        type: 'success',
        message: res.message || 'Semua sesi aktif berhasil dicabut.',
      });
      fetchSessions();
    } catch {
      setFeedback({ type: 'error', message: 'Gagal mencabut semua sesi.' });
    } finally {
      setIsRevokeAllOpen(false);
    }
  };

  const getMaxSlots = () => {
    const tier = license?.tier || 'free';
    if (tier === 'vip') return 5;
    if (tier === 'pro') return 2;
    return 1;
  };

  const activeSessionsCount = sessions.filter((s) => !s.isRevoked).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Toast Feedback */}
      {feedback && (
        <div
          className={`mb-6 p-4 rounded-xl flex items-center justify-between text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-950/60 border border-emerald-800/60 text-emerald-300'
              : 'bg-rose-950/60 border border-rose-800/60 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-xs uppercase font-mono tracking-wider ml-4 opacity-70 hover:opacity-100">
            Tutup
          </button>
        </div>
      )}

      {/* Header Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Tier Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono uppercase tracking-widest text-slate-400">Paket Langganan</span>
            <Shield className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-white font-mono tracking-wide uppercase">
              {license?.tier || 'FREE'}
            </span>
            <span className="text-xs text-slate-400">PLAN</span>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Batas Pemutusan: <strong className="text-slate-200">{license?.max_cuts || 5} Perangkat</strong>
          </p>
        </div>

        {/* Slot Usage Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono uppercase tracking-widest text-slate-400">Slot Perangkat</span>
            <Laptop className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-white font-mono">
              {activeSessionsCount} <span className="text-slate-500 text-2xl font-normal">/ {getMaxSlots()}</span>
            </span>
            <span className="text-xs text-slate-400">Aktif</span>
          </div>
          <div className="w-full bg-slate-800 h-2 rounded-full mt-3 overflow-hidden">
            <div
              className={`h-full transition-all ${
                activeSessionsCount >= getMaxSlots() ? 'bg-amber-500' : 'bg-cyan-500'
              }`}
              style={{ width: `${Math.min(100, (activeSessionsCount / getMaxSlots()) * 100)}%` }}
            />
          </div>
        </div>

        {/* Capabilities Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono uppercase tracking-widest text-slate-400">Fitur Jaringan</span>
            <Zap className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="space-y-1.5 text-xs font-mono">
            <div className="flex items-center justify-between text-slate-300">
              <span>PWM Throttling:</span>
              <span className={license?.can_throttle ? 'text-emerald-400' : 'text-slate-500'}>
                {license?.can_throttle ? 'AKTIF' : 'TERKUNCI (PRO)'}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-300">
              <span>Sinkhole Gateway:</span>
              <span className={license?.can_gateway ? 'text-emerald-400' : 'text-slate-500'}>
                {license?.can_gateway ? 'AKTIF' : 'TERKUNCI (PRO)'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Sessions Section */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800 mb-6">
          <div>
            <h2 className="text-lg font-bold text-white font-mono flex items-center gap-2">
              <Laptop className="w-5 h-5 text-cyan-400" />
              Perangkat Terhubung & Sesi Desktop
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Daftar seluruh komputer yang menggunakan lisensi akun ini. Anda dapat mencabut akses perangkat dari jarak jauh.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchSessions}
              disabled={isLoading}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors disabled:opacity-50"
              title="Refresh Sesi"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            {activeSessionsCount > 0 && (
              <button
                onClick={() => setIsRevokeAllOpen(true)}
                className="px-3 py-2 bg-rose-950/60 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 rounded-xl text-xs font-mono flex items-center gap-2 transition-colors"
              >
                <PowerOff className="w-3.5 h-3.5" />
                Putuskan Semua Sesi
              </button>
            )}
          </div>
        </div>

        {/* Sessions Grid */}
        {sessions.length === 0 ? (
          <div className="text-center py-12 text-slate-500 font-mono text-sm">
            <Laptop className="w-12 h-12 mx-auto mb-3 opacity-30 text-slate-400" />
            <p>Belum ada sesi desktop yang terdaftar.</p>
            <p className="text-xs mt-1 text-slate-600">Login pada aplikasi desktop Spoorf untuk mendaftarkan sesi.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sessions.map((sess) => (
              <div
                key={sess.id}
                className={`p-5 rounded-xl border transition-all ${
                  sess.isRevoked
                    ? 'bg-slate-950/40 border-slate-900 opacity-60'
                    : 'bg-slate-950 border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
                      {sess.platform === 'win32' ? <Monitor className="w-5 h-5" /> : <Laptop className="w-5 h-5" />}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white font-mono">
                        {sess.deviceName || 'Perangkat Desktop Sentinel'}
                      </h4>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 font-mono">
                        <span>{sess.platform || 'Windows'}</span>
                        <span>·</span>
                        <span>v{sess.appVersion || '2.41.79'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Status Pill */}
                  <div>
                    {sess.isRevoked ? (
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-rose-950/60 border border-rose-800/60 text-rose-400">
                        Dicabut
                      </span>
                    ) : sess.is_online ? (
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Online
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-amber-950/60 border border-amber-800/60 text-amber-400">
                        Idle
                      </span>
                    )}
                  </div>
                </div>

                {/* Metadata & Last Seen */}
                <div className="space-y-1.5 text-xs text-slate-400 font-mono mb-4 bg-slate-900/50 p-2.5 rounded-lg border border-slate-800/40">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      Terakhir Aktif:
                    </span>
                    <span className="text-slate-300">
                      {new Date(sess.lastSeenAt).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      ({new Date(sess.lastSeenAt).toLocaleDateString('id-ID')})
                    </span>
                  </div>
                  {sess.ipAddress && (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-slate-500" />
                        IP Publik:
                      </span>
                      <span className="text-slate-300">{sess.ipAddress}</span>
                    </div>
                  )}
                  {sess.isRevoked && sess.revokedReason && (
                    <div className="text-[11px] text-rose-400/80 pt-1 border-t border-slate-800">
                      Alasan: {sess.revokedReason}
                    </div>
                  )}
                </div>

                {/* Kick Action Button */}
                {!sess.isRevoked && (
                  <button
                    onClick={() => setTargetToRevoke(sess)}
                    className="w-full py-2 bg-rose-950/30 hover:bg-rose-900/40 border border-rose-800/50 hover:border-rose-600 text-rose-300 rounded-lg text-xs font-mono flex items-center justify-center gap-2 transition-colors"
                  >
                    <PowerOff className="w-3.5 h-3.5" />
                    Putuskan Akses (Kick)
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmModal
        isOpen={!!targetToRevoke}
        title="Putuskan Akses Perangkat"
        message={`Apakah Anda yakin ingin mencabut sesi untuk "${targetToRevoke?.deviceName || targetToRevoke?.sessionId.substring(0, 8)}"? Aplikasi desktop pada perangkat tersebut akan otomatis diturunkan ke versi Free pada heartbeat berikutnya.`}
        confirmLabel="Ya, Putuskan Sesi"
        cancelLabel="Batal"
        onConfirm={handleConfirmSingleRevoke}
        onCancel={() => setTargetToRevoke(null)}
      />

      <ConfirmModal
        isOpen={isRevokeAllOpen}
        title="Putuskan Semua Sesi Aktif"
        message="Tindakan ini akan mencabut seluruh sesi perangkat desktop yang sedang aktif. Semua perangkat desktop akan otomatis diturunkan ke versi Free. Lanjutkan?"
        confirmLabel="Ya, Putuskan Semua"
        cancelLabel="Batal"
        onConfirm={handleConfirmRevokeAll}
        onCancel={() => setIsRevokeAllOpen(false)}
      />
    </div>
  );
};
```

- [ ] **Step 3: Verify TypeScript compilation**

Run:
```powershell
cd d:/spoorf-web-cloud/frontend
npx tsc --noEmit
```
Expected: Exit code 0.

- [ ] **Step 4: Commit DashboardPage**

```powershell
cd d:/spoorf-web-cloud/frontend
git add src/components/common/ConfirmModal.tsx src/pages/DashboardPage.tsx
git commit -m "feat(frontend): implement DashboardPage with active device cards and remote kick modal"
```

---

### Task 7: Download Page and Application Routing Wiring

**Files:**
- Create: `d:/spoorf-web-cloud/frontend/src/pages/DownloadPage.tsx`
- Modify: `d:/spoorf-web-cloud/frontend/src/App.tsx`

**Interfaces:**
- Consumes: `Download` icon, `Navbar`, `ProtectedRoute`, `LoginPage`, `RegisterPage`, `DashboardPage`, `DownloadPage`.
- Produces: Complete navigable application bundled via Vite.

- [ ] **Step 1: Implement DownloadPage**

Create `d:/spoorf-web-cloud/frontend/src/pages/DownloadPage.tsx`:
```tsx
import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Download, Shield, Laptop, CheckCircle2, AlertCircle } from 'lucide-react';

interface ReleaseInfo {
  version: string;
  platform: string;
  filename: string;
  downloadUrl: string;
  fileSizeBytes?: number;
  releaseNotes?: string;
}

export const DownloadPage: React.FC = () => {
  const [release, setRelease] = useState<ReleaseInfo>({
    version: '2.41.79',
    platform: 'windows-x64',
    filename: 'Spoorf Sentinel Setup 1.0.0.exe',
    downloadUrl: '/downloads/Spoorf%20Sentinel%20Setup%201.0.0.exe',
    releaseNotes: 'Background heartbeat loop, 7-day sliding grace period, and remote kick reconciler.',
  });

  useEffect(() => {
    api
      .get<{ success: boolean; release: ReleaseInfo }>('/download/latest')
      .then((res) => {
        if (res.data.success && res.data.release) {
          setRelease(res.data.release);
        }
      })
      .catch(() => {
        // Fallback to static release details
      });
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <div className="inline-flex p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 mb-4 shadow-lg shadow-cyan-950/50">
          <Download className="w-10 h-10" />
        </div>
        <h1 className="text-3xl font-black text-white font-mono tracking-wide">Unduh Spoorf Sentinel Desktop</h1>
        <p className="text-slate-400 mt-2 max-w-xl mx-auto text-sm">
          Aplikasi Layer 2 Network Discovery & Manipulation Engine resmi untuk sistem operasi Windows.
        </p>
      </div>

      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-8 border-b border-slate-800">
          <div className="flex items-center gap-4">
            <div className="p-4 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 text-cyan-400">
              <Laptop className="w-10 h-10" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold text-white font-mono">{release.filename}</h3>
                <span className="text-xs font-mono uppercase bg-cyan-950 text-cyan-400 border border-cyan-800 px-2 py-0.5 rounded-md">
                  v{release.version}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 font-mono">Platform: Windows 10/11 64-bit</p>
            </div>
          </div>

          <a
            href={release.downloadUrl}
            className="px-6 py-3.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-cyan-950/50 flex items-center gap-2 font-mono text-sm whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Unduh Installer (.exe)</span>
          </a>
        </div>

        {/* System Requirements & Notes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-8 text-xs font-mono">
          <div>
            <h4 className="text-slate-300 uppercase tracking-wider font-bold mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Persyaratan Sistem
            </h4>
            <ul className="space-y-2 text-slate-400">
              <li>• Windows 10 atau 11 (64-bit Architecture)</li>
              <li>• Npcap Driver (disertakan atau unduh dari npcap.com)</li>
              <li>• Akses hak Administrator (diperlukan untuk injeksi frame L2)</li>
              <li>• RAM minimal 4 GB (Disarankan 8 GB)</li>
            </ul>
          </div>

          <div>
            <h4 className="text-slate-300 uppercase tracking-wider font-bold mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-cyan-400" />
              Catatan Rilis
            </h4>
            <p className="text-slate-400 leading-relaxed">
              {release.releaseNotes ||
                'Versi ini dilengkapi dengan background heartbeat loop, 7-day sliding grace period, remote kick reconciler, dan anti-self-cut security guards.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Wire application routing in App.tsx**

Modify `d:/spoorf-web-cloud/frontend/src/App.tsx`:
```tsx
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Navbar } from './components/layout/Navbar';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { DownloadPage } from './pages/DownloadPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
          <Navbar />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
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
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </main>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
```

- [ ] **Step 3: Run production build check**

Run:
```powershell
cd d:/spoorf-web-cloud/frontend
npm run build
```
Expected: `tsc && vite build` succeeds with zero errors, producing production bundle in `dist/`.

- [ ] **Step 4: Commit frontend App routing & DownloadPage**

```powershell
cd d:/spoorf-web-cloud/frontend
git add src/pages/DownloadPage.tsx src/App.tsx
git commit -m "feat(frontend): wire full application routing and DownloadPage"
```

---

### Task 8: End-to-End Test Verification & Desktop Regression Audit

**Files:**
- Run: `spoorf-web-cloud/backend` automated test suite
- Run: `spoorf-web-cloud/frontend` build
- Run: `d:/spoorf` backend and python test suites

- [ ] **Step 1: Run Cloud Backend Test Suite**

Run:
```powershell
cd d:/spoorf-web-cloud/backend
npm test
```
Expected: All test suites (auth, session, crypto, errors) pass 100%.

- [ ] **Step 2: Run Cloud Frontend Build**

Run:
```powershell
cd d:/spoorf-web-cloud/frontend
npm run build
```
Expected: `✓ built in X.XXs` with clean output in `dist/`.

- [ ] **Step 3: Run Desktop Backend-Node Test Suite**

Run:
```powershell
cd d:/spoorf/backend-node
npm test
```
Expected: 132 passed, 0 failed.

- [ ] **Step 4: Run Desktop Python-Service Test Suite**

Run:
```powershell
cd d:/spoorf/python-service
.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
```
Expected: 430 passed, 0 failed.

- [ ] **Step 5: Git Status & Final Commit**

```powershell
cd d:/spoorf
git status
```
Verify working tree clean on `main`.
