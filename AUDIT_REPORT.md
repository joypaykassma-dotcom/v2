# PRODUCTION READINESS AUDIT — DRAGON TIGER P2P v2

**Repository:** `joypaykassma-dotcom/v2` @ `33ef66b` (branch `arena/01a0df95-v2`)
**Audit date:** 2026-09-27
**Auditor scope:** full repository, 83 files / ~26,800 LOC, every file read or grep-mapped.

---

## 1. EXECUTIVE SUMMARY

- **Overall Rating: 1.5 / 10** (for *real-money readiness*. As a UI prototype it is a 6.5/10 — the front-end is genuinely impressive.)
- **Production Ready for Real Money? → NO. Emphatically, unconditionally NO.**

### Top 5 CRITICAL Risks

| # | Risk | One-line consequence |
|---|------|---------------------|
| 1 | **There is no database. All money lives in a JavaScript object in RAM** (`mockUsers`, `server.ts:136`). No Prisma client is even installed in the running app. | Every deposit, balance and bet is destroyed on process restart, crash, or redeploy. Total, unrecoverable loss of all customer funds. |
| 2 | **There is no authentication.** No JWT, no session token, no cookie is ever issued. Every endpoint trusts a `userId` string in the request body. | `curl -d '{"userId":"<victim>","action":"withdraw","amount":999999}' /api/wallet/action` drains any account. Zero authentication bypass required — there is nothing to bypass. |
| 3 | **`POST /api/wallet/action` mints real money on demand** (`server.ts:2162`) — unauthenticated, no payment gateway, no admin approval. `user.balance += numAmount`. | Infinite free balance for anyone with the URL. Instant bankruptcy on day one. |
| 4 | **Admin panel password is `admin` / `123456`, hardcoded in client-side JavaScript** (`src/components/AdminLogin.tsx:11`), and the gate is `sessionStorage.setItem("admin_authorized","true")`. Every `/api/admin/*` route has **zero** server-side checks. | Full admin takeover from the browser console. `POST /api/database/reset` (unauthenticated) wipes the entire platform. |
| 5 | **All money is IEEE-754 floating point**, with `Math.floor(matchedStake * 1.9)` (`server.ts:~705`). `minBet` is `0.00001`. | Payouts truncate to whole units — a ৳0.5 win pays ৳0. Float drift makes the ledger unauditable and unreconcilable. Direct violation of Business Rule 10. |

### Top 3 Immediate Fixes

1. **Take the app offline for real money. Do not process a single deposit.** Wire the *existing, good* `prisma/schema.prisma` to the running server and move every balance mutation into `prisma.$transaction()` with atomic conditional `UPDATE`.
2. **Build real auth**: bcrypt(cost 12) + access/refresh JWT + `requireAuth` and `requireRole('ADMIN'|'SUPER_ADMIN')` middleware applied to *every* mutating route. Delete the client-side admin password.
3. **Delete the entire referral rev-share engine** (`server.ts:147–200`, `1807–1899`) — it pays cash commission and is a hard violation of Business Rule 2 (Zero Monetary Bonuses).

### Honest Verdict

This repository is a **high-fidelity front-end prototype with a mock in-memory server**, dressed in production language ("STRICT AUTHENTICATION ENFORCED", "ADMIN CONSOLE (PRO)", `BUILD: v2.8.5-BUILD-2026.09.26.105`) that is not backed by any of the claimed engineering. Three parallel, mutually disconnected codebases exist; the only one that runs is the least safe one. Launching this with real money would not be risky — it would be an immediate and total loss of every deposit, through the front door, with no attacker skill required. **The good news: the Prisma schema and the game economics are genuinely correct, and the UI is strong. You have roughly 30% of a real platform — just not the 30% that holds the money.**

---

## 2. CODEBASE OVERVIEW

### Tech Stack Found

The repo contains **three separate, non-communicating codebases**. This is the single most important structural finding.

| # | Location | Stack | Status | Runs? |
|---|----------|-------|--------|-------|
| **A** | `/server.ts` + `/src/**` | Vite 8, React 19, Express 4, raw `ws`, Tailwind 4, `@google/genai` | **~5,500 LOC. All state in RAM.** This is the live app (`npm run dev` → `tsx server.ts`) | ✅ **YES — this is the product** |
| **B** | `/backend/**` | Fastify 4, Prisma 5, PostgreSQL, Redis/ioredis, BullMQ, socket.io, Zod, bcrypt, decimal.js, pino, redlock | **15 files: config + middleware + utils ONLY.** No routes, no services, no `server.ts`, no game engine, no matching engine, no settlement, no auth module. | ❌ **NO — cannot start; entry point does not exist** |
| **C** | `/frontend/**` | Next.js 14, Radix UI, zustand, socket.io-client | **4 config files. Zero pages, zero components, zero `app/` directory.** | ❌ **NO — empty shell** |

`prisma/schema.prisma` (713 lines, 22 models) and `prisma/seed.ts` belong to **B** and are **never imported by A**. The root `package.json` does not even list `@prisma/client` or `decimal.js` as dependencies. There are no migrations (`prisma/migrations/` does not exist).

> **The headline:** the production-grade architecture described in `TECHNICAL_BLUEPRINT.md`, `Architecture.md` and `FULL_CODEBASE_BLUEPRINT.md` **does not exist as executable code.** The documentation describes codebase B; codebase B is 15 utility files.

### Total Files Reviewed

| Category | Count |
|---|---|
| Total files in repo | 83 |
| Root app server (`server.ts`) | 1 file, **3,393 LOC** |
| React components (`src/components/`) | 36 files, ~16,700 LOC |
| React app/utils/types (`src/`) | 8 files, ~2,700 LOC |
| Fastify backend skeleton (`backend/src/`) | 15 files, ~900 LOC |
| Prisma (`schema.prisma` + `seed.ts`) | 2 files, 1,012 LOC |
| Next.js frontend skeleton (`frontend/`) | 4 config files |
| Markdown design docs | 8 files, 281 LOC |
| Config (tsconfig ×3, vite, package ×3, .env.example, .gitignore) | 9 files |
| **Total reviewed** | **83 / 83 (100%)** |

### Architecture Assessment: **POOR**

Not because any single piece is badly written — `PlayingCard.tsx`, `backend/src/utils/decimal.ts` and `schema.prisma` are all genuinely good. It is poor because **the three codebases are disconnected, the documentation describes the one that doesn't run, and the one that does run has no persistence, no auth and no transactional integrity.** A monolithic 3,393-line `server.ts` mixing HTTP routing, WebSocket broadcast, the game loop, the settlement engine, the duel engine and a Gemini API proxy is not a structure that can be safely evolved.

### Main Strengths (genuine — do not throw these away)

1. **`prisma/schema.prisma` is excellent.** 22 well-normalised models, `Decimal(18,2)` on every money column, `idempotencyKey @unique` on `Bet` and `Transaction`, `balanceBefore`/`balanceAfter` on `Transaction`, a proper `CompanyLedger` with `COMMISSION`/`TIE_REVENUE` types, `AuditLog` with `oldValues`/`newValues`/`ipAddress`/`userAgent`, `BetMatch` join table, sensible composite indexes. **This is the single most valuable asset in the repo. Build on it.**
2. **The core game economics are mathematically correct.** Matched pool = 2M where M = min(D,T). Winner gets `1.9 × matched`; company retains `2M − 1.9M = 0.1M` = exactly 5% of the total matched pool (`server.ts:~672`). Tie captures the full `2M` (`server.ts:~668`). Fold gives the pot minus 5% rake to the non-folder (`server.ts:~985`). **Rules 4, 5, 6 and 7 are conceptually implemented correctly** — the arithmetic just runs on floats instead of Decimals.
3. **Provably-fair derivation is textbook-correct** (`server.ts:39–101`): `crypto.randomBytes(32)` server seed, SHA-256 commitment published before the round, `HMAC-SHA512(serverSeed, clientSeed + ":" + nonce)`, and — impressively — **genuine modulo-bias rejection** at the `4294967292` boundary with chunk-advance. Card values correctly `A=1 … K=13`. This is better than most live casinos ship.
4. **`backend/src/utils/decimal.ts` and `crypto.ts` are production-quality.** `floorPayout` (ROUND_FLOOR for players) / `ceilFee` (ROUND_CEIL for company) is exactly the right asymmetry. AES-256-GCM with 96-bit IV and `iv:authTag:ciphertext` packing is correct. `verifyMerchantSignature` uses `timingSafeEqual`. **These files are unused — wire them in.**
5. **The front-end is legitimately good.** Rich, coherent, mobile-aware, with roadmap/bead-road, live bet feed, provably-fair modal, transparency charter, card-squeeze physics. This is real product work.

### Main Weaknesses

1. **Zero persistence.** `const mockUsers: Record<string, UserWallet> = {}` is the database.
2. **Zero authentication.** No token is ever minted. `userId` in the request body *is* the identity.
3. **Zero authorization.** Admin routes are indistinguishable from public routes.
4. **Zero transactionality.** Balance mutations are `user.balance += n` — non-atomic, no rollback, no audit trail, no idempotency.
5. **Floats everywhere.** 25 `Number(...)`/`parseFloat` call sites, 18 `toFixed`, `Math.floor`/`Math.round` on payouts.
6. **Business-rule violations shipped as features:** referral cash commission (Rule 2), an 8× house-banked Tie bet (Rule 3), `Math.random()`-fabricated round history (Rule 1 — fake liquidity).
7. **Documentation actively misleads.** Comments read `// 2. Betting API - STRICT AUTHENTICATION ENFORCED` directly above a function with no authentication.
8. **No tests. No CI. No migrations. No logging framework. No rate limiting. No helmet. No CORS policy. No Zod at runtime. 46 `console.*` calls. 35 `any` annotations. Root `tsconfig.json` has no `strict`.**

---

## 3. DETAILED ISSUE LIST

> Line numbers are from `33ef66b`. All "Fixed Code" is written against the **existing `prisma/schema.prisma`**, which already supports every fix below.

---

### 🔴 SECURITY

---

#### **SEC-001 — No authentication system exists whatsoever**
- **Severity:** CRITICAL · **Priority:** P0
- **File:** `server.ts` (entire file; representative sites `1311`, `1461`, `2150`, `2219`)

**Description.** The server never issues a JWT, session cookie, or any credential. `POST /api/auth/login` returns a bare user object. Every subsequent request identifies the caller by a `userId` string **supplied by the client in the request body**. The comment on line 1310 claims `STRICT AUTHENTICATION ENFORCED`; the check on line 1314 is `if (!userId || typeof userId !== "string")` — i.e. it verifies that the attacker remembered to send a string.

Every account is trivially and completely controllable by anyone who knows or guesses a `userId`. `userId`s are returned in plaintext by the public endpoints `GET /api/transparency/users` (`server.ts:2082`) and `GET /api/tables/:slug/bets` (`server.ts:1298`). **There is no bypass to find — the door has no lock.**

**Current Code** (`server.ts:1311–1325`):
```ts
// 2. Betting API - STRICT AUTHENTICATION ENFORCED
app.post("/api/game/bet", (req, res) => {
  const { userId, tableSlug, side, amount, balanceType = "real" } = req.body;

  // Strict check: Every player MUST be logged in
  if (!userId || typeof userId !== "string" || userId.trim() === "") {
    return res.status(401).json({ error: "Authentication required...", code: "AUTH_REQUIRED" });
  }
  const user = mockUsers[userId];
  if (!user) return res.status(401).json({ error: "Session expired...", code: "INVALID_USER" });
```

**Fixed Code** — create `src/server/middleware/auth.ts`:
```ts
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';

export interface AuthedRequest extends Request {
  auth?: { userId: number; role: 'PLAYER' | 'MERCHANT' | 'ADMIN' | 'SUPER_ADMIN'; sessionId: number };
}

const ACCESS_SECRET = (() => {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_ACCESS_SECRET missing or <32 chars — refusing to boot');
  return s;
})();

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }
  try {
    const payload = jwt.verify(header.slice(7), ACCESS_SECRET, {
      algorithms: ['HS256'], issuer: 'dragontiger', audience: 'dragontiger-api',
    }) as { sub: string; role: AuthedRequest['auth'] extends infer T ? any : never; sid: number };

    const user = await prisma.user.findUnique({
      where: { id: Number(payload.sub) },
      select: { id: true, role: true, status: true, selfExcludedUntil: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Account is not active', code: 'ACCOUNT_INACTIVE' });
    }
    if (user.selfExcludedUntil && user.selfExcludedUntil > new Date()) {
      return res.status(403).json({ error: 'Self-exclusion period active', code: 'SELF_EXCLUDED' });
    }
    const session = await prisma.session.findFirst({
      where: { id: payload.sid, userId: user.id, isActive: true, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!session) return res.status(401).json({ error: 'Session revoked', code: 'SESSION_REVOKED' });

    req.auth = { userId: user.id, role: user.role, sessionId: session.id };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_INVALID' });
  }
}

export function requireRole(...roles: Array<'PLAYER' | 'MERCHANT' | 'ADMIN' | 'SUPER_ADMIN'>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Insufficient privileges', code: 'FORBIDDEN' });
    }
    return next();
  };
}
```
Then **every** mutating route becomes, with `userId` taken *only* from `req.auth`:
```ts
app.post('/api/game/bet', requireAuth, betRateLimit, validate(placeBetSchema), async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;          // NEVER from req.body
  const { tableSlug, side, amount, balanceType, idempotencyKey } = req.body;
  ...
});
```

- **Impact:** Total compromise of every account and the entire bankroll by unauthenticated HTTP requests.

---

#### **SEC-002 — Admin password `admin`/`123456` hardcoded in client-side JS; all admin APIs unprotected**
- **Severity:** CRITICAL · **Priority:** P0
- **Files:** `src/components/AdminLogin.tsx:11`, `src/components/AdminDashboard.tsx:10–13`, `server.ts:2320, 2369, 2388, 2399, 1793, 3287`

**Description.** Three compounding failures:
1. The credential is compared **in the browser** and is therefore in the public JS bundle: `adminUsername === "admin" && adminPassword === "123456"`.
2. The resulting "session" is `sessionStorage.setItem("admin_authorized","true")` — any visitor can type that into DevTools and reload.
3. **It does not matter anyway**, because the server-side admin endpoints have no auth check at all. An attacker skips the UI entirely.

There is no `UserRole` check anywhere in `server.ts` — the string `SUPER_ADMIN` never appears in the running codebase. `POST /api/database/reset` (`server.ts:3287`) destroys every user, balance, transaction and ledger entry, unauthenticated.

**Current Code** (`src/components/AdminLogin.tsx:9–17`):
```tsx
const handleAdminLogin = (e: React.FormEvent) => {
  e.preventDefault();
  if (adminUsername === "admin" && adminPassword === "123456") {
    sessionStorage.setItem("admin_authorized", "true");
    onLoginSuccess();
  } else { setAuthError("ভুল অ্যাডমিন ইউজারনেম অথবা পাসওয়ার্ড!"); }
};
```
```ts
// server.ts:2320 — no guard
app.get("/api/admin/stats", (_req, res) => { ... });
// server.ts:3287 — no guard, destroys everything
app.post("/api/database/reset", (_req, res) => { ... });
```

**Fixed Code** — client does not decide anything:
```tsx
const handleAdminLogin = async (e: React.FormEvent) => {
  e.preventDefault();
  setLoading(true); setAuthError(null);
  try {
    const res = await fetch('/api/v1/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',           // refresh token lands in httpOnly cookie
      body: JSON.stringify({ username: adminUsername, password: adminPassword, totp }),
    });
    const data = await res.json();
    if (!res.ok) { setAuthError(data.error ?? 'Login failed'); return; }
    setAccessTokenInMemory(data.accessToken);   // memory only — never localStorage
    onLoginSuccess();
  } finally { setLoading(false); }
};
```
Server — mount a guarded router so no admin route can ever be added without protection:
```ts
const adminRouter = express.Router();
adminRouter.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), adminAuditLogger);

adminRouter.get('/stats', async (_req, res) => { /* ... */ });
adminRouter.post('/user/balance', requireRole('SUPER_ADMIN'), validate(adjustBalanceSchema), adjustBalance);

// DESTRUCTIVE: SUPER_ADMIN + non-production only + mandatory reason
adminRouter.post('/database/reset', requireRole('SUPER_ADMIN'), async (req: AuthedRequest, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Disabled in production' });
  }
  const { reason } = req.body;
  if (!reason || reason.trim().length < 10) {
    return res.status(400).json({ error: 'A reason of at least 10 characters is mandatory' });
  }
  await prisma.auditLog.create({ data: {
    userId: req.auth!.userId, action: 'DATABASE_RESET', entityType: 'System', entityId: 'global',
    newValues: { reason }, ipAddress: req.ip, userAgent: req.get('user-agent') ?? null,
  }});
  /* ... perform reset ... */
});

app.use('/api/v1/admin', adminRouter);
```
Also add `AdminLogin` → bcrypt verify + mandatory TOTP (schema already has `twoFactorEnabled`/`twoFactorSecret`) and an IP allowlist for `/admin/*`.

- **Impact:** Complete platform takeover and one-click destruction of all financial records by any visitor.

---

#### **SEC-003 — Password hashing uses unsalted-strength SHA-256, not bcrypt**
- **Severity:** CRITICAL · **Priority:** P0
- **File:** `server.ts:1620–1621`, `1696–1697`, `1711`

**Description.** Passwords are hashed with a single round of SHA-256 and an 8-byte salt. SHA-256 is a *fast* hash — commodity GPUs compute >10 billion/sec. An 8-byte salt prevents rainbow tables but does nothing against targeted brute force. The minimum password length is **4 characters** (`server.ts:1609`), so the entire keyspace of a 4-char password is exhausted in microseconds. Business rule requires bcrypt cost ≥ 12. Note `prisma/seed.ts:11` *correctly* uses `bcrypt.hash(pw, 12)` — the good practice exists in the dead codebase.

**Current Code:**
```ts
if (!password || typeof password !== "string" || password.length < 4) {
  return res.status(400).json({ success: false, error: "Password must be at least 4 characters" });
}
const salt = crypto.randomBytes(8).toString("hex");
const passwordHash = crypto.createHash("sha256").update(password + salt).digest("hex");
```

**Fixed Code:**
```ts
import bcrypt from 'bcrypt';
import { z } from 'zod';

const BCRYPT_COST = 12;

export const registerSchema = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/,
    'Username may contain only letters, numbers and underscores'),
  phone: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number in international format'),
  password: z.string()
    .min(10, 'Password must be at least 10 characters')
    .max(128)
    .regex(/[a-z]/, 'Include at least one lowercase letter')
    .regex(/[A-Z]/, 'Include at least one uppercase letter')
    .regex(/[0-9]/, 'Include at least one number'),
  otpToken: z.string().length(6),
});

const passwordHash = await bcrypt.hash(parsed.password, BCRYPT_COST);

// verify — always compare, even for unknown users, to avoid timing oracle
const DUMMY = '$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012';
const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY);
if (!user || !ok) return res.status(401).json({ error: 'Invalid username or password' });
```

- **Impact:** A single database leak exposes every customer password in minutes; those passwords are reused on the customers' banking and payment apps.

---

#### **SEC-004 — Login auto-registers an arbitrary password for any existing account (instant takeover)**
- **Severity:** CRITICAL · **Priority:** P0
- **File:** `server.ts:1688–1710`

**Description.** This is the most severe single defect in the repository. If a username exists in `mockUsers` but has no entry in `userCredentials` — which is the case for **every** account created via `GET /api/wallet/:userId` (line 1726, auto-vivifies users) or `POST /api/wallet/transfer` (line 2244, creates recipients out of thin air) — then logging in with **any password whatsoever** silently registers that password and returns the victim's full account.

An attacker enumerates usernames from the public `GET /api/transparency/users` endpoint and logs into each one with `"x"`.

**Current Code:**
```ts
const cred = userCredentials[normalizedUser];
if (!cred) {
  const existingMock = Object.values(mockUsers).find(u => u.username.toLowerCase() === normalizedUser);
  if (existingMock) {
    // Auto-register credential with this password for convenience
    const salt = crypto.randomBytes(8).toString("hex");
    const passwordHash = crypto.createHash("sha256").update(password + salt).digest("hex");
    userCredentials[normalizedUser] = { userId: existingMock.userId, username: existingMock.username, passwordHash, salt };
    existingMock.referral = ensureReferralData(existingMock.userId, existingMock.username);
    return res.json({ success: true, user: existingMock });   // ← full account handed over
  }
  return res.status(401).json({ success: false, error: "Account not found. Please click Sign Up to register." });
}
```

**Fixed Code** — accounts may only ever be created by an explicit, OTP-verified registration:
```ts
app.post('/api/v1/auth/login', loginRateLimit, validate(loginSchema), async (req, res) => {
  const { username, password } = req.body as { username: string; password: string };

  const user = await prisma.user.findUnique({
    where: { username: username.trim().toLowerCase() },
    select: { id: true, passwordHash: true, role: true, status: true, loginAttempts: true, lockedUntil: true },
  });

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    return res.status(423).json({ error: 'Account temporarily locked. Try again later.', code: 'ACCOUNT_LOCKED' });
  }

  const DUMMY = '$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012';
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY);

  if (!user || !ok) {
    if (user) {
      const attempts = user.loginAttempts + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: { loginAttempts: attempts,
                lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null },
      });
    }
    // identical response and timing whether or not the user exists
    return res.status(401).json({ error: 'Invalid username or password', code: 'INVALID_CREDENTIALS' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { loginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: req.ip },
  });
  return res.json(await issueTokenPair(user, req, res));
});
```

- **Impact:** One-request, zero-knowledge takeover of a large fraction of all accounts, including their real balances.

---

#### **SEC-005 — No refresh-token rotation, reuse detection, or session revocation**
- **Severity:** HIGH · **Priority:** P0 (implement alongside SEC-001)
- **File:** `server.ts` — feature entirely absent. Schema support exists: `Session` model (`prisma/schema.prisma`, `refreshTokenHash @unique`, `isActive`, `expiresAt`).

**Fixed Code** — `src/server/services/token.service.ts`:
```ts
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Response, Request } from 'express';
import { prisma } from '../db.js';

const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function issueTokenPair(
  user: { id: number; role: string }, req: Request, res: Response, replacesSessionId?: number,
) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: sha256(refreshToken),
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? null,
      deviceInfo: { fingerprint: req.get('x-device-fingerprint') ?? null },
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  if (replacesSessionId) {
    await prisma.session.update({ where: { id: replacesSessionId }, data: { isActive: false } });
  }

  const accessToken = jwt.sign(
    { sub: String(user.id), role: user.role, sid: session.id },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: ACCESS_TTL, algorithm: 'HS256', issuer: 'dragontiger', audience: 'dragontiger-api' },
  );

  res.cookie('rt', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: REFRESH_TTL_MS,
  });
  // access token returned in body → caller keeps it in memory ONLY
  return { accessToken, expiresIn: 900 };
}

/** Rotation with reuse detection: a replayed token nukes every session for that user. */
export async function rotateRefreshToken(req: Request, res: Response) {
  const presented = req.cookies?.rt;
  if (!presented) return res.status(401).json({ error: 'No refresh token', code: 'NO_REFRESH' });

  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: sha256(presented) },
    include: { user: { select: { id: true, role: true, status: true } } },
  });

  if (!session) return res.status(401).json({ error: 'Invalid refresh token', code: 'REFRESH_INVALID' });

  // REUSE DETECTED — the token was already rotated away. Assume theft.
  if (!session.isActive || session.expiresAt < new Date()) {
    await prisma.session.updateMany({ where: { userId: session.userId }, data: { isActive: false } });
    await prisma.auditLog.create({ data: {
      userId: session.userId, action: 'REFRESH_TOKEN_REUSE_DETECTED', entityType: 'Session',
      entityId: String(session.id), ipAddress: req.ip, userAgent: req.get('user-agent') ?? null,
    }});
    res.clearCookie('rt', { path: '/api/v1/auth' });
    return res.status(401).json({ error: 'Session security violation. All sessions revoked.', code: 'REUSE_DETECTED' });
  }

  if (session.user.status !== 'ACTIVE') return res.status(403).json({ error: 'Account not active' });
  return res.json(await issueTokenPair(session.user, req, res, session.id));
}
```

- **Impact:** Without this, a stolen token is valid for its full lifetime with no way to detect or revoke it.

---

#### **SEC-006 — No rate limiting on any endpoint**
- **Severity:** HIGH · **Priority:** P0
- **File:** `server.ts` — absent. (`@fastify/rate-limit` is declared in the dead `backend/package.json`.)

**Fixed Code** (Redis-backed so it survives multi-instance deployment):
```ts
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from './redis.js';

const store = (prefix: string) => new RedisStore({ prefix, sendCommand: (...a: string[]) => redis.call(...a) as any });
const keyByUser = (req: AuthedRequest) => (req.auth ? `u:${req.auth.userId}` : `ip:${req.ip}`);

export const loginRateLimit    = rateLimit({ store: store('rl:login:'),  windowMs: 15*60_000, limit: 5,   keyGenerator: r => r.ip!, message: { error: 'Too many login attempts. Try again in 15 minutes.' }, standardHeaders: true, legacyHeaders: false });
export const registerRateLimit = rateLimit({ store: store('rl:reg:'),    windowMs: 60*60_000, limit: 3,   keyGenerator: r => r.ip! });
export const betRateLimit      = rateLimit({ store: store('rl:bet:'),    windowMs: 10_000,    limit: 20,  keyGenerator: keyByUser });
export const withdrawRateLimit = rateLimit({ store: store('rl:wd:'),     windowMs: 60*60_000, limit: 5,   keyGenerator: keyByUser });
export const globalRateLimit   = rateLimit({ store: store('rl:all:'),    windowMs: 60_000,    limit: 300, keyGenerator: keyByUser });

app.set('trust proxy', 1);   // required for correct req.ip behind a proxy
app.use(globalRateLimit);
```

- **Impact:** Unlimited credential stuffing, OTP brute force, and bet-spam denial of service.

---

#### **SEC-007 — No Helmet, no CORS policy, no CSRF defence, no body-size limit**
- **Severity:** HIGH · **Priority:** P1
- **File:** `server.ts:14` — the entire middleware stack is `app.use(express.json())`.

**Current Code:**
```ts
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
app.use(express.json());
```

**Fixed Code:**
```ts
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';

const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? '').split(',').map(s => s.trim()).filter(Boolean);
if (process.env.NODE_ENV === 'production' && ALLOWED_ORIGINS.length === 0) {
  throw new Error('CORS_ORIGIN must be set in production');
}

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", ...ALLOWED_ORIGINS, 'wss:'],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
}));

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                   // same-origin / server-to-server
    return ALLOWED_ORIGINS.includes(origin)
      ? cb(null, true)
      : cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Device-Fingerprint'],
  maxAge: 600,
}));

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

// CSRF: refresh cookie is SameSite=Strict and path-scoped; additionally assert Origin on state change.
app.use((req, res, next) => {
  if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return res.status(403).json({ error: 'Cross-origin request rejected', code: 'CSRF_BLOCKED' });
    }
  }
  return next();
});
```

- **Impact:** Clickjacking, XSS escalation, cross-site request forgery against the money endpoints, JSON bomb DoS.

---

#### **SEC-008 — WebSocket server is entirely unauthenticated and broadcasts globally**
- **Severity:** HIGH · **Priority:** P1
- **File:** `server.ts:11`, `1220–1245`, `broadcast()` at `1108–1115`

**Description.** `new WebSocketServer({ server })` accepts every connection with no handshake verification and no origin check. `broadcast()` sends **every message to every connected client**. Chat messages are trusted verbatim from the client (`data.user`, `data.vipTier`) — any client can impersonate any player or claim Diamond VIP. There are no rooms or namespaces, so per-table and per-duel state is fanned out to all spectators.

**Fixed Code** (migrate to Socket.IO, already a dependency of the intended backend):
```ts
import { Server } from 'socket.io';

const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
  transports: ['websocket'],
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('AUTH_REQUIRED'));
    const p = jwt.verify(token, process.env.JWT_ACCESS_SECRET!, {
      algorithms: ['HS256'], issuer: 'dragontiger', audience: 'dragontiger-api',
    }) as { sub: string; role: string; sid: number };
    const user = await prisma.user.findUnique({
      where: { id: Number(p.sub) }, select: { id: true, username: true, role: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') return next(new Error('ACCOUNT_INACTIVE'));
    socket.data.user = user;                 // server-side identity — clients cannot forge it
    return next();
  } catch { return next(new Error('TOKEN_INVALID')); }
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  socket.join(`user:${user.id}`);            // private channel for this player's own cards & balance

  socket.on('table:join', (slug: string) => {
    if (!['express', 'classic', 'vip'].includes(slug)) return;
    for (const r of socket.rooms) if (r.startsWith('table:')) socket.leave(r);
    socket.join(`table:${slug}`);
  });

  socket.on('chat:send', chatRateLimiter(user.id, (text: string) => {
    const clean = sanitizeChat(text);        // strip HTML, enforce length, profanity filter
    if (!clean) return;
    io.to('lobby').emit('chat:message', {
      userId: user.id, username: user.username,   // identity from the SERVER, never the payload
      text: clean, at: new Date().toISOString(),
    });
  }));
});

// Public table state → table room. Private per-player data → user room.
io.to(`table:${slug}`).emit('round:tick', publicRoundState);
io.to(`user:${userId}`).emit('wallet:update', { realBalance, demoBalance, inPlay });
```

- **Impact:** Chat impersonation, information leakage of private game state, unbounded connection DoS.

---

#### **SEC-009 — Default cryptographic secrets committed and silently used as fallbacks**
- **Severity:** HIGH · **Priority:** P0
- **Files:** `.env.example:20–21, 28–29`; `backend/src/config/index.ts:58–66`

**Description.** `.env.example` ships real-looking 64-hex keys (`0123456789abcdef...`). Worse, `backend/src/config/index.ts` falls back to those exact literals if the env var is missing, so a misconfigured production deploy boots happily with publicly-known JWT signing keys and a publicly-known AES-256-GCM key protecting KYC documents and bank details.

**Current Code:**
```ts
jwt: {
  accessSecret: process.env.JWT_ACCESS_SECRET || 'default_jwt_access_secret_key_32_bytes_long_min',
  refreshSecret: process.env.JWT_REFRESH_SECRET || 'default_jwt_refresh_secret_key_32_bytes_long_min',
},
security: {
  seedEncryptionKey: process.env.SEED_ENCRYPTION_KEY || '0123456789abcdef...',
  sensitiveDataEncryptionKey: process.env.SENSITIVE_DATA_ENCRYPTION_KEY || 'abcdef0123456789...',
},
```

**Fixed Code** — fail closed, validate at boot:
```ts
import { z } from 'zod';

const hex64 = z.string().regex(/^[0-9a-f]{64}$/i, 'must be 64 hex characters (32 bytes)');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET:  z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  SEED_ENCRYPTION_KEY: hex64,
  SENSITIVE_DATA_ENCRYPTION_KEY: hex64,
  CORS_ORIGIN: z.string().min(1),
}).superRefine((env, ctx) => {
  const banned = ['0123456789abcdef'.repeat(4), 'abcdef0123456789'.repeat(4)];
  const check = (k: keyof typeof env) => {
    const v = String(env[k]).toLowerCase();
    if (banned.includes(v) || v.startsWith('default_')) {
      ctx.addIssue({ code: 'custom', path: [k], message: `${k} is a known example value — generate a real secret` });
    }
  };
  (['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','SEED_ENCRYPTION_KEY','SENSITIVE_DATA_ENCRYPTION_KEY'] as const).forEach(check);
  if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'Access and refresh secrets must differ' });
  }
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment configuration:\n' + JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);          // refuse to boot rather than run insecurely
}
export const env = parsed.data;
```
Replace the values in `.env.example` with `CHANGE_ME_RUN_openssl_rand_hex_32`.

- **Impact:** Forged JWTs for any user including SUPER_ADMIN; decryption of all stored KYC and bank data.

---

#### **SEC-010 — No Zod validation at runtime; `noImplicitAny` and `strict` disabled in the live tsconfig**
- **Severity:** MEDIUM · **Priority:** P1
- **Files:** `tsconfig.json:1–30` (no `strict`); `server.ts` — hand-rolled `if (!x)` checks only. `zod` is not a root dependency.

**Description.** The root `tsconfig.json` that actually compiles `server.ts` and `src/` omits `strict`, `noImplicitAny`, `strictNullChecks` and `noUnusedLocals`. (`backend/tsconfig.json` enables all of them — for code that never runs.) At runtime, validation is ad-hoc: `Number(amount)` accepts `"1e999"` → `Infinity`, and `NaN` checks are inconsistent across routes. 35 `any` annotations bypass what little typing exists.

**Fixed Code** — root `tsconfig.json`:
```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    /* ...existing options... */
  }
}
```
Shared money-safe schemas, `src/server/schemas/index.ts`:
```ts
import { z } from 'zod';

/** Money arrives as a STRING and stays a string until it becomes a Decimal. */
export const moneyString = z.string()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, 'Amount must be a positive number with at most 2 decimal places')
  .refine(v => Number(v) > 0, 'Amount must be greater than zero');

export const placeBetSchema = z.object({
  tableSlug: z.enum(['express', 'classic', 'vip']),
  side: z.enum(['DRAGON', 'TIGER']),          // TIE is not a valid side — pure P2P
  amount: moneyString,
  balanceType: z.enum(['REAL', 'DEMO']),
  roundId: z.number().int().positive(),        // prevents betting into the wrong round
  idempotencyKey: z.string().uuid(),
});

export const withdrawSchema = z.object({
  amount: moneyString,
  paymentMethod: z.enum(['UPI', 'BANK_TRANSFER', 'USDT']),
  accountDetails: z.record(z.string().max(200)),
  idempotencyKey: z.string().uuid(),
});

export const adjustBalanceSchema = z.object({
  userId: z.number().int().positive(),
  direction: z.enum(['CREDIT', 'DEBIT']),
  amount: moneyString,
  balanceType: z.enum(['REAL', 'DEMO']),
  reason: z.string().trim().min(10, 'A reason of at least 10 characters is mandatory'),
  idempotencyKey: z.string().uuid(),
});
```
```ts
export const validate = (schema: z.ZodTypeAny) =>
  (req: Request, res: Response, next: NextFunction) => {
    const r = schema.safeParse(req.body);
    if (!r.success) {
      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    req.body = r.data;
    return next();
  };
```

- **Impact:** Malformed and hostile payloads reach financial logic; `Infinity`/`NaN` corrupt balances.

---

#### **SEC-011 — KYC auto-approved at signup; no AES-256-GCM encryption of PII; no PII redaction in logs**
- **Severity:** HIGH · **Priority:** P1
- **Files:** `server.ts:1640` (`kycStatus: "verified"`), `server.ts:2259` (transfer recipients also `"verified"`), `server.ts:2388` (`/api/admin/user/status` sets any KYC status with no document check, no auth)

**Description.** Every new account is created **already KYC-verified**, with no document ever uploaded. The `KYCDocument` model and the working `CryptoUtil.encryptSensitive` AES-256-GCM helper both exist but are never called by the running server. `WithdrawalRequest.accountDetails` is commented `// Encrypted JSON` in the schema but nothing encrypts it. 46 `console.*` calls log raw objects including usernames and amounts.

**Current Code:**
```ts
const newUser: UserWallet = { /* ... */ kycStatus: "verified", /* ... */ };
```

**Fixed Code:**
```ts
// Registration: KYC starts at NONE. Always.
const user = await prisma.user.create({
  data: { username, phone, passwordHash, kycStatus: 'NONE', status: 'ACTIVE', referralCode: genCode() },
});

// KYC submission — encrypt the document number at rest
await prisma.kYCDocument.create({
  data: {
    userId, documentType,
    documentNumber: CryptoUtil.encryptSensitive(documentNumber),   // AES-256-GCM
    frontImageUrl, backImageUrl, selfieUrl, status: 'PENDING',
  },
});

// Withdrawal — encrypt bank/UPI details at rest
await prisma.withdrawalRequest.create({
  data: { userId, amount: new Prisma.Decimal(amount), paymentMethod,
          accountDetails: { enc: CryptoUtil.encryptSensitive(JSON.stringify(accountDetails)) },
          status: 'PENDING' },
});

// Only an admin may VERIFY, and only against a real submitted document
adminRouter.post('/kyc/:docId/verify', requireRole('ADMIN', 'SUPER_ADMIN'), async (req: AuthedRequest, res) => {
  const doc = await prisma.kYCDocument.findUnique({ where: { id: Number(req.params.docId) } });
  if (!doc || doc.status !== 'PENDING') return res.status(400).json({ error: 'No pending document' });
  await prisma.$transaction([
    prisma.kYCDocument.update({ where: { id: doc.id }, data: { status: 'VERIFIED', verifiedById: req.auth!.userId, verifiedAt: new Date() } }),
    prisma.user.update({ where: { id: doc.userId }, data: { kycStatus: 'VERIFIED' } }),
    prisma.auditLog.create({ data: { userId: req.auth!.userId, action: 'KYC_VERIFY', entityType: 'KYCDocument',
      entityId: String(doc.id), oldValues: { status: doc.status }, newValues: { status: 'VERIFIED' },
      ipAddress: req.ip, userAgent: req.get('user-agent') ?? null } }),
  ]);
  res.json({ success: true });
});
```
Structured logging with redaction — `src/server/logger.ts`:
```ts
import pino from 'pino';
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
      '*.password', '*.passwordHash', '*.documentNumber', '*.accountDetails',
      '*.serverSeed', '*.apiSecret', '*.refreshToken', '*.twoFactorSecret', '*.phone', '*.email',
    ],
    censor: '[REDACTED]',
  },
  formatters: { level: (label) => ({ level: label }) },
});
```
Then replace all 46 `console.*` calls with `logger.info/warn/error`.

- **Impact:** AML/KYC non-compliance (licence-ending), plaintext bank details in the database, PII in log aggregators.

---

### 🔴 FINANCIAL

---

#### **FIN-001 — No database. All balances are in-process memory and are destroyed on restart**
- **Severity:** CRITICAL · **Priority:** P0
- **File:** `server.ts:136` and ~200 mutation sites throughout

**Description.** This is the defect that makes every other financial issue moot.
```ts
const mockUsers: Record<string, UserWallet> = {};
```
This object is the ledger. `userCredentials`, `userBetHistories`, `globalTransactions`, `activeRooms`, `activeDuels`, `metrics` and `tables` are likewise plain in-memory objects. `prisma/schema.prisma` is never imported by `server.ts`; `@prisma/client` is not in the root `package.json`; `prisma/migrations/` does not exist.

Consequences: a crash, an OOM kill, a deploy, or a `kill -9` destroys every balance, deposit and transaction with **no backup and no recovery path**. Horizontal scaling is impossible (two instances = two divergent ledgers). There is no audit trail for a regulator or a chargeback dispute.

**Fixed Code** — `src/server/db.ts`:
```ts
import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from './logger.js';

export const prisma = new PrismaClient({
  log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
});
prisma.$on('warn',  (e) => logger.warn({ prisma: e }));
prisma.$on('error', (e) => logger.error({ prisma: e }));

export { Prisma };
export const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
```
Steps:
```bash
npm i @prisma/client decimal.js bcrypt jsonwebtoken zod helmet cors cookie-parser \
      express-rate-limit rate-limit-redis ioredis pino pino-http socket.io
npm i -D prisma @types/bcrypt @types/jsonwebtoken @types/cookie-parser
npx prisma migrate dev --name init          # creates prisma/migrations/
npx prisma generate
```
Add a DB-level safety net so a negative balance is impossible even if application logic fails — `prisma/migrations/<ts>_balance_guards/migration.sql`:
```sql
ALTER TABLE "User" ADD CONSTRAINT "user_real_balance_non_negative" CHECK ("realBalance" >= 0);
ALTER TABLE "User" ADD CONSTRAINT "user_demo_balance_non_negative" CHECK ("demoBalance" >= 0);
ALTER TABLE "Bet"  ADD CONSTRAINT "bet_amount_positive"            CHECK ("amount" > 0);
ALTER TABLE "Bet"  ADD CONSTRAINT "bet_matched_within_amount"      CHECK ("matchedAmount" >= 0 AND "matchedAmount" <= "amount");
ALTER TABLE "Transaction" ADD CONSTRAINT "tx_amount_non_negative"  CHECK ("amount" >= 0);
```

- **Impact:** Guaranteed total loss of all customer funds and all financial records at the first restart.

---

#### **FIN-002 — Balance mutations are non-atomic float arithmetic with no transaction, no ledger row, no idempotency**
- **Severity:** CRITICAL · **Priority:** P0
- **Files:** `server.ts:1367–1371` (bet debit), `1495` (cancel refund), `~632` (unmatched refund), `~735` (win credit), `2162/2189` (deposit/withdraw), `2269–2270` (transfer), `2380–2384` (admin adjust), `2726` (duel stake), `2940` (duel raise)

**Description.** Every single balance change is the same unsafe pattern:
```ts
if (activeBal < numAmount) return res.status(400).json({ error: "Insufficient balance for this bet" });
if (balanceType === "real") { user.balance -= numAmount; } else { user.demoBalance -= numAmount; }
```
Four fatal properties: **(a)** check-then-act is not atomic — two concurrent bets both pass the check and both debit, driving the balance negative; **(b)** no `Transaction` row is written, so there is no `balanceBefore`/`balanceAfter` audit trail; **(c)** no idempotency — a retried request double-debits; **(d)** float arithmetic.

The schema already has `Transaction.idempotencyKey @unique` and `Bet.idempotencyKey @unique`. They are unused.

**Fixed Code** — `src/server/services/wallet.service.ts`. The `updateMany` + `count === 1` guard is the atomic conditional debit required by the business rules:
```ts
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

export class InsufficientFundsError extends Error {
  constructor() { super('Insufficient balance'); this.name = 'InsufficientFundsError'; }
}

type Ctx = Prisma.TransactionClient;

/** ATOMIC conditional debit. Returns balanceBefore/After. Throws if funds are insufficient. */
export async function debit(
  tx: Ctx,
  opts: {
    userId: number; amount: Prisma.Decimal; balanceType: 'REAL' | 'DEMO';
    type: Prisma.TransactionCreateInput['type'];
    description: string; referenceId?: string; referenceType?: string; idempotencyKey: string;
  },
) {
  const col = opts.balanceType === 'REAL' ? 'realBalance' : 'demoBalance';

  // Idempotency: if this key already succeeded, replay the stored result.
  const existing = await tx.transaction.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
  if (existing) return { balanceBefore: existing.balanceBefore, balanceAfter: existing.balanceAfter, replayed: true };

  // Single atomic statement: decrement ONLY IF sufficient funds. Postgres row-locks for us.
  const affected: number = await tx.$executeRaw`
    UPDATE "User"
       SET ${Prisma.raw(`"${col}"`)} = ${Prisma.raw(`"${col}"`)} - ${opts.amount}
     WHERE "id" = ${opts.userId}
       AND ${Prisma.raw(`"${col}"`)} >= ${opts.amount}
  `;
  if (affected !== 1) throw new InsufficientFundsError();   // ← the mandated affected-rows check

  const after = await tx.user.findUniqueOrThrow({
    where: { id: opts.userId }, select: { realBalance: true, demoBalance: true },
  });
  const balanceAfter  = opts.balanceType === 'REAL' ? after.realBalance : after.demoBalance;
  const balanceBefore = balanceAfter.plus(opts.amount);

  await tx.transaction.create({ data: {
    userId: opts.userId, type: opts.type, amount: opts.amount,
    balanceBefore, balanceAfter, balanceType: opts.balanceType,
    status: 'COMPLETED', referenceId: opts.referenceId, referenceType: opts.referenceType,
    description: opts.description, idempotencyKey: opts.idempotencyKey, processedAt: new Date(),
  }});

  return { balanceBefore, balanceAfter, replayed: false };
}

/** ATOMIC credit. Same audit guarantees. */
export async function credit(tx: Ctx, opts: Parameters<typeof debit>[1]) {
  const col = opts.balanceType === 'REAL' ? 'realBalance' : 'demoBalance';

  const existing = await tx.transaction.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
  if (existing) return { balanceBefore: existing.balanceBefore, balanceAfter: existing.balanceAfter, replayed: true };

  const before = await tx.user.findUniqueOrThrow({
    where: { id: opts.userId }, select: { realBalance: true, demoBalance: true },
  });
  const balanceBefore = opts.balanceType === 'REAL' ? before.realBalance : before.demoBalance;

  await tx.$executeRaw`
    UPDATE "User"
       SET ${Prisma.raw(`"${col}"`)} = ${Prisma.raw(`"${col}"`)} + ${opts.amount}
     WHERE "id" = ${opts.userId}
  `;
  const balanceAfter = balanceBefore.plus(opts.amount);

  await tx.transaction.create({ data: {
    userId: opts.userId, type: opts.type, amount: opts.amount,
    balanceBefore, balanceAfter, balanceType: opts.balanceType,
    status: 'COMPLETED', referenceId: opts.referenceId, referenceType: opts.referenceType,
    description: opts.description, idempotencyKey: opts.idempotencyKey, processedAt: new Date(),
  }});

  return { balanceBefore, balanceAfter, replayed: false };
}
```
Idempotency middleware for every financial endpoint:
```ts
export function requireIdempotencyKey(req: Request, res: Response, next: NextFunction) {
  const key = req.get('Idempotency-Key');
  if (!key || !/^[0-9a-f-]{36}$/i.test(key)) {
    return res.status(400).json({ error: 'A valid Idempotency-Key header (UUID v4) is required', code: 'IDEMPOTENCY_KEY_REQUIRED' });
  }
  (req as any).idempotencyKey = key;
  return next();
}
```

- **Impact:** Negative balances, double-spend under concurrency, duplicate payouts on retry, and a ledger that cannot be reconciled or audited.

---

#### **FIN-003 — `POST /api/wallet/action` credits real money instantly with no payment gateway and no authentication**
- **Severity:** CRITICAL · **Priority:** P0
- **File:** `server.ts:2150–2214`

**Description.** The "deposit" path simply adds to the balance. No payment processor, no UTR, no proof, no admin approval, no auth. The `DepositRequest` model exists in the schema and is entirely unused. Withdrawal is equally instant — no KYC gate, no approval queue, no `WithdrawalRequest` row.

**Current Code:**
```ts
if (action === "deposit") {
  user.balance += numAmount;      // ← free money, unauthenticated
  ...
} else if (action === "withdraw") {
  if (user.balance < numAmount) return res.status(400).json({ error: "Insufficient balance for withdrawal" });
  user.balance -= numAmount;      // ← instant payout, no KYC, no approval
```

**Fixed Code** — split into request/approve, using the schema that already exists:
```ts
// PLAYER: create a PENDING deposit request. No balance moves.
app.post('/api/v1/wallet/deposit/request', requireAuth, requireIdempotencyKey,
  validate(depositRequestSchema), async (req: AuthedRequest, res) => {
  const { amount, paymentMethod, utrNumber, proofImageUrl } = req.body;
  const dep = await prisma.depositRequest.create({
    data: {
      userId: req.auth!.userId, amount: new Prisma.Decimal(amount), paymentMethod,
      utrNumber, proofImageUrl, status: 'PENDING',
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    },
  });
  res.status(201).json({ requestId: dep.uuid, status: dep.status });
});

// ADMIN: approve — credits inside ONE transaction, double-approval impossible.
adminRouter.post('/deposits/:uuid/approve', requireRole('ADMIN', 'SUPER_ADMIN'),
  requireIdempotencyKey, async (req: AuthedRequest, res) => {
  const { adminNote } = req.body;
  try {
    const out = await prisma.$transaction(async (tx) => {
      // Conditional status flip: only PENDING → APPROVED can ever succeed.
      const claimed = await tx.depositRequest.updateMany({
        where: { uuid: req.params.uuid, status: 'PENDING' },
        data: { status: 'APPROVED', processedById: req.auth!.userId, processedAt: new Date(), adminNote },
      });
      if (claimed.count !== 1) throw new Error('ALREADY_PROCESSED');

      const dep = await tx.depositRequest.findUniqueOrThrow({ where: { uuid: req.params.uuid } });

      const { balanceAfter } = await credit(tx, {
        userId: dep.userId, amount: dep.amount, balanceType: 'REAL', type: 'DEPOSIT',
        description: `Deposit approved (${dep.paymentMethod}${dep.utrNumber ? ` UTR ${dep.utrNumber}` : ''})`,
        referenceId: dep.uuid, referenceType: 'DepositRequest',
        idempotencyKey: `deposit:${dep.uuid}`,          // deterministic → replay-safe forever
      });

      await tx.auditLog.create({ data: {
        userId: req.auth!.userId, action: 'DEPOSIT_APPROVE', entityType: 'DepositRequest', entityId: dep.uuid,
        oldValues: { status: 'PENDING' }, newValues: { status: 'APPROVED', amount: dep.amount.toFixed(2), adminNote },
        ipAddress: req.ip, userAgent: req.get('user-agent') ?? null,
      }});
      return { balanceAfter };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.json({ success: true, newBalance: out.balanceAfter.toFixed(2) });
  } catch (e: any) {
    if (e.message === 'ALREADY_PROCESSED') {
      return res.status(409).json({ error: 'This deposit has already been processed', code: 'ALREADY_PROCESSED' });
    }
    throw e;
  }
});

// PLAYER: withdrawal request — KYC gate + funds locked immediately.
app.post('/api/v1/wallet/withdraw/request', requireAuth, withdrawRateLimit, requireIdempotencyKey,
  validate(withdrawSchema), async (req: AuthedRequest, res) => {
  const { amount, paymentMethod, accountDetails } = req.body;
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.auth!.userId }, select: { kycStatus: true },
  });
  if (user.kycStatus !== 'VERIFIED') {
    return res.status(403).json({ error: 'Complete KYC verification before withdrawing', code: 'KYC_REQUIRED' });
  }
  const wd = await prisma.$transaction(async (tx) => {
    // Debit now so the player cannot double-spend pending funds; refund on rejection.
    await debit(tx, {
      userId: req.auth!.userId, amount: new Prisma.Decimal(amount), balanceType: 'REAL',
      type: 'WITHDRAWAL', description: 'Withdrawal requested — funds locked',
      referenceType: 'WithdrawalRequest', idempotencyKey: (req as any).idempotencyKey,
    });
    return tx.withdrawalRequest.create({ data: {
      userId: req.auth!.userId, amount: new Prisma.Decimal(amount), paymentMethod,
      accountDetails: { enc: CryptoUtil.encryptSensitive(JSON.stringify(accountDetails)) },
      status: 'PENDING',
    }});
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  res.status(201).json({ requestId: wd.uuid, status: wd.status });
});
```

- **Impact:** Unlimited free balance creation. This alone bankrupts the operator on launch day.

---

#### **FIN-004 — `POST /api/wallet/transfer` allows unauthenticated draining and fabricates recipient accounts**
- **Severity:** CRITICAL · **Priority:** P0
- **File:** `server.ts:2219–2317`

**Description.** Two distinct critical flaws:
1. The sender is `req.body.fromUserId` with no auth — anyone can transfer anyone else's money to themselves.
2. If the recipient username does not exist, the server **creates a brand-new account** for it with `kycStatus: "verified"` (line 2259) and credits it. This is an unmonitored, KYC-free value-transfer rail — textbook money laundering infrastructure that will terminate a gaming licence.

**Current Code:**
```ts
const { fromUserId, toUsername, amount, note } = req.body;
const sender = mockUsers[fromUserId];                      // ← no auth
...
if (!recipient) {
  const targetUserId = `user_p2p_${Date.now()}`;
  targetRecipient = { userId: targetUserId, username: toUsername.trim(), balance: 0,
                      kycStatus: "verified", /* ... */ };  // ← account conjured, pre-verified
  mockUsers[targetUserId] = targetRecipient;
}
sender.balance -= numAmount;
targetRecipient.balance += numAmount;                      // ← no transaction, no atomicity
```

**Fixed Code — remove the feature.** Player-to-player cash transfer has no place in a P2P betting product; it is pure AML risk with zero product value. Delete `server.ts:2219–2317` and the corresponding UI in `src/components/WalletModal.tsx`.

If a business case is later proven, the only acceptable shape is:
```ts
app.post('/api/v1/wallet/transfer', requireAuth, transferRateLimit, requireIdempotencyKey,
  validate(transferSchema), async (req: AuthedRequest, res) => {
  const senderId = req.auth!.userId;                                  // identity from token only
  const { toUsername, amount } = req.body;

  const [sender, recipient] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: senderId }, select: { kycStatus: true, username: true } }),
    prisma.user.findUnique({ where: { username: toUsername.trim().toLowerCase() },
                             select: { id: true, status: true, kycStatus: true } }),
  ]);

  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });   // NEVER create
  if (recipient.id === senderId) return res.status(400).json({ error: 'Cannot transfer to yourself' });
  if (sender.kycStatus !== 'VERIFIED' || recipient.kycStatus !== 'VERIFIED') {
    return res.status(403).json({ error: 'Both accounts must be KYC verified', code: 'KYC_REQUIRED' });
  }
  if (recipient.status !== 'ACTIVE') return res.status(403).json({ error: 'Recipient account is not active' });

  const amt = new Prisma.Decimal(amount);
  await prisma.$transaction(async (tx) => {
    await debit(tx,  { userId: senderId,    amount: amt, balanceType: 'REAL', type: 'ADJUSTMENT',
                       description: `Transfer to @${toUsername}`, referenceType: 'Transfer',
                       idempotencyKey: `${(req as any).idempotencyKey}:out` });
    await credit(tx, { userId: recipient.id, amount: amt, balanceType: 'REAL', type: 'ADJUSTMENT',
                       description: `Transfer from @${sender.username}`, referenceType: 'Transfer',
                       idempotencyKey: `${(req as any).idempotencyKey}:in` });
    await tx.auditLog.create({ data: { userId: senderId, action: 'P2P_TRANSFER', entityType: 'User',
      entityId: String(recipient.id), newValues: { amount: amt.toFixed(2) },
      ipAddress: req.ip, userAgent: req.get('user-agent') ?? null } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  res.json({ success: true });
});
```

- **Impact:** Account draining; an AML rail that invites licence revocation and criminal liability.

---

#### **FIN-005 — All money is IEEE-754 float; payouts truncated with `Math.floor` to whole units**
- **Severity:** CRITICAL · **Priority:** P0
- **Files:** `server.ts:~705` (`Math.floor(matchedStake * 1.9)`), `~632` (`Math.floor(bet.amount * matchRatio)`), `~736` (`Math.floor(matchedStake * 0.9)`), `~985` (`Math.round(totalPot * 0.05)`), `2510` (`Math.round(...)`), plus 25 `Number(...)` and 18 `toFixed` sites

**Description.** Direct violation of Business Rule 10. Two separate harms:
1. **Float drift.** `0.1 + 0.2 !== 0.3`. Across millions of settlements the company ledger and the sum of player balances silently diverge, and no reconciliation is possible.
2. **Truncation to integers.** `Math.floor(x * 1.9)` discards the fractional part *entirely*, not to 2 dp. With `minBet: 0.00001` (`server.ts:480`), a matched stake of `0.5` pays `Math.floor(0.95) = 0` — **the player wins and receives nothing.** The discarded remainder is not booked to the company ledger either; it simply vanishes, so the books do not balance.

`backend/src/utils/decimal.ts` already implements exactly the right helpers (`floorPayout` ROUND_FLOOR, `ceilFee` ROUND_CEIL) and is never imported.

**Current Code:**
```ts
const matchedPart   = Math.floor(bet.amount * matchRatio);
const unmatchedPart = bet.amount - matchedPart;
...
bet.payout = Math.floor(matchedStake * 1.9);
const profit = Math.floor(matchedStake * 0.9);
...
round.commission = matchedM * 2 * 0.05;
round.tieRevenue = matchedM * 2;
```

**Fixed Code** — `src/server/services/money.ts`:
```ts
import { Prisma } from '@prisma/client';

export type Money = Prisma.Decimal;
export const D = (v: string | number | Money): Money => new Prisma.Decimal(v);

export const PAYOUT_MULTIPLIER = D('1.9');
export const COMMISSION_RATE   = D('0.05');

/** Player-facing amounts round DOWN to 2dp. Never award a fraction of a paisa. */
export const floorPayout = (v: Money): Money => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_FLOOR);
/** Company-facing amounts round UP to 2dp, so rounding dust accrues to the house, never to thin air. */
export const ceilFee     = (v: Money): Money => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_CEIL);

/**
 * Settlement maths for one decided (non-tie) round.
 * matchedPerSide M = min(dragonPool, tigerPool); total matched pool = 2M.
 * Winners are paid 1.9 x their matched stake; the house retains 2M - 1.9M = 0.1M = 5% of 2M.
 */
export function decidedRoundSplit(matchedPerSide: Money) {
  const totalMatchedPool = matchedPerSide.times(2);
  const commission       = ceilFee(totalMatchedPool.times(COMMISSION_RATE));
  const payoutPool       = totalMatchedPool.minus(commission);
  return { totalMatchedPool, commission, payoutPool };
}

/** Tie: the company retains 100% of the total matched pool. */
export function tieRoundSplit(matchedPerSide: Money) {
  const totalMatchedPool = matchedPerSide.times(2);
  return { totalMatchedPool, tieRevenue: totalMatchedPool, payoutPool: D(0) };
}

export const winnerPayout = (matchedStake: Money): Money => floorPayout(matchedStake.times(PAYOUT_MULTIPLIER));
```
Also raise `minBet` from `0.00001` to a sane `10.00` and store table limits as `Decimal` (the `GameTable` model already does).

> **Reconciliation invariant to assert in tests:** for every round,
> `Σ payouts + commission + tieRevenue + Σ refunds == Σ stakes`. Any residue from `floorPayout` must be explicitly booked to `CompanyLedger` as `ROUNDING_DUST`, never dropped.

- **Impact:** Players robbed of legitimate winnings; an unauditable, non-balancing ledger; guaranteed failure of any regulatory financial audit.

---

#### **FIN-006 — `CompanyLedger` is never written; revenue exists only as in-memory float counters**
- **Severity:** CRITICAL · **Priority:** P0
- **Files:** `server.ts:110–120` (`metrics`), `~669`, `~673`, `~1065`, `~1000`

**Description.** Business Rules 4 and 5 require commission and tie revenue to be tracked separately and durably. The schema provides `CompanyLedger` with `type` (`COMMISSION`/`TIE_REVENUE`), `balanceBefore`, `balanceAfter` and `roundId` — exactly right, and never used. Instead revenue accumulates in:
```ts
const metrics: SystemMetrics = { todayMatchedVolume: 0, todayCommission: 0, todayTieRevenue: 0, ... };
metrics.todayCommission += round.commission;
```
Floats, in RAM, reset to zero on restart, never reset at midnight despite the `today*` naming, and there is no per-round attribution. The admin dashboard reports these numbers as revenue.

**Fixed Code** — write a running-balance ledger row inside the settlement transaction:
```ts
async function postCompanyLedger(
  tx: Prisma.TransactionClient,
  entry: { type: 'COMMISSION' | 'TIE_REVENUE' | 'ROUNDING_DUST' | 'ADJUSTMENT';
           amount: Money; roundId?: number; description: string; metadata?: Prisma.InputJsonValue },
) {
  if (entry.amount.lte(0)) return null;
  const last = await tx.companyLedger.findFirst({ orderBy: { id: 'desc' }, select: { balanceAfter: true } });
  const balanceBefore = last?.balanceAfter ?? new Prisma.Decimal(0);
  return tx.companyLedger.create({ data: {
    type: entry.type, amount: entry.amount,
    balanceBefore, balanceAfter: balanceBefore.plus(entry.amount),
    roundId: entry.roundId, description: entry.description, metadata: entry.metadata ?? {},
  }});
}
```
Then the dashboard aggregates from the ledger, not from RAM:
```ts
const [commission, tieRevenue] = await Promise.all([
  prisma.companyLedger.aggregate({ _sum: { amount: true },
    where: { type: 'COMMISSION',  createdAt: { gte: startOfDay, lt: endOfDay } } }),
  prisma.companyLedger.aggregate({ _sum: { amount: true },
    where: { type: 'TIE_REVENUE', createdAt: { gte: startOfDay, lt: endOfDay } } }),
]);
```

- **Impact:** No durable record of company revenue; tax and licence reporting impossible; revenue figures lost on every restart.

---

#### **FIN-007 — Referral cash-commission engine violates Business Rule 2 (Zero Monetary Bonuses)**
- **Severity:** CRITICAL (compliance) · **Priority:** P0
- **Files:** `server.ts:147–200` (`UserReferralState`, `getReferralTier`), `1807–1899` (`/api/referral/:userId`, `/api/referral/claim`, `/api/referral/apply`), `~790–830` (turnover accrual in settlement); `src/components/ReferralModal.tsx` (670 LOC); `.env.example:34` (`REFERRAL_COMMISSION_RATE=0.01`); `prisma/schema.prisma` (`ReferralEarning` model, `TransactionType.REFERRAL_BONUS`, `User.referralCode`/`referredById`)

**Description.** Rule 2 forbids referral commission absolutely. The code implements a full four-tier revenue-share programme:
```ts
function getReferralTier(friendCount: number): { tier: ...; pct: number } {
  if (friendCount >= 50) return { tier: "Diamond", pct: 50 };
  if (friendCount >= 16) return { tier: "Gold",    pct: 40 };
  if (friendCount >= 6)  return { tier: "Silver",  pct: 30 };
  return { tier: "Bronze", pct: 20 };
}
```
with `totalCommissionEarned`, `unclaimedCommission`, and a `POST /api/referral/claim` endpoint that pays out. The `ReferralEarning.commissionAmount Decimal(18,2)` column and the `REFERRAL_BONUS` transaction type institutionalise it at the schema level. `.env.example` sets a 1% rate.

Note: the in-settlement accrual block at `server.ts:~790` is labelled "Zero-Cost Prestige Model" and currently only unlocks cosmetic titles — but `unclaimedCommission` and the claim endpoint remain live, and the UI advertises 20–50% revenue share. This is a monetary bonus programme in all but the final payout line.

**Fixed Code — delete, do not disable.** A commented-out bonus system will be re-enabled by a future developer.

1. `server.ts`: delete lines `147–200` and `1807–1899`; delete the referral accrual block inside settlement (`~790–830`); delete `userReferralData`, `referralCodeToUser`, `userReferrerMap`; remove the `refCode` branch from signup (`1653–1673`); remove `newUser.referral = ...`.
2. `src/components/ReferralModal.tsx`: delete the file; remove its import and nav entry from `src/App.tsx` and `src/components/SideNavDrawer.tsx`.
3. `src/types.ts`: delete `UserReferralState`, `ReferredFriend`, and `UserWallet.referral`.
4. `.env.example`: delete `REFERRAL_COMMISSION_RATE`.
5. `backend/src/config/index.ts`: delete `game.defaultReferralCommissionRate`.
6. `prisma/schema.prisma` — remove the model and the enum member:
```prisma
// DELETE model ReferralEarning { ... }
// DELETE from User: referralEarnings, referredEarnings, referredById, referrer, referrals, referralCode
// DELETE from GameRound: referralEarnings
// DELETE from Bet: referralEarnings

enum TransactionType {
  DEPOSIT
  WITHDRAWAL
  BET_PLACED
  BET_WIN
  BET_LOSS
  BET_REFUND
  BET_TIE_LOSS
  COMMISSION
  ADJUSTMENT
  // REFERRAL_BONUS  ← REMOVED: Business Rule 2 forbids all monetary bonuses
  MERCHANT_SETTLEMENT
  MERCHANT_DEPOSIT
  MERCHANT_WITHDRAWAL
}
```
7. Add a CI guard so it cannot come back — `scripts/check-no-bonuses.sh`:
```bash
#!/usr/bin/env bash
# Business Rule 2: ZERO MONETARY BONUSES. Fail the build if bonus concepts reappear.
set -euo pipefail
PATTERN='referralCommission|referral_bonus|REFERRAL_BONUS|welcomeBonus|depositBonus|cashback|freeBet|promoCode|prizePool|rakeback|unclaimedCommission|revShare'
if grep -rInE "$PATTERN" server.ts src/ backend/src/ prisma/ 2>/dev/null; then
  echo "❌ Business Rule 2 violation: monetary bonus logic detected above." >&2
  exit 1
fi
echo "✅ No monetary bonus logic found."
```

- **Impact:** Direct violation of a stated absolute business rule; uncontrolled liability; licence risk in jurisdictions that restrict affiliate inducements.

---

#### **FIN-008 — Admin manual balance adjustment requires no reason and writes no audit log**
- **Severity:** CRITICAL · **Priority:** P0
- **File:** `server.ts:2369–2386`

**Description.** Unauthenticated, no `reason`, no audit entry, no `Transaction` row, and `Math.max(0, ...)` silently swallows over-debits instead of rejecting them — so the amount actually removed differs from the amount recorded, with no record of either.

**Current Code:**
```ts
app.post("/api/admin/user/balance", (req, res) => {
  const { userId, type, amount, isDemo } = req.body;
  const user = mockUsers[userId];
  if (!user) return res.status(404).json({ error: "User not found" });
  const num = Number(amount);
  if (isNaN(num) || num < 0) return res.status(400).json({ error: "Invalid amount" });
  if (isDemo) {
    if (type === "add") user.demoBalance += num; else user.demoBalance = Math.max(0, user.demoBalance - num);
  } else {
    if (type === "add") user.balance += num;     else user.balance = Math.max(0, user.balance - num);
  }
  res.json({ success: true, balance: user.balance, demoBalance: user.demoBalance });
});
```

**Fixed Code:**
```ts
adminRouter.post('/user/balance', requireRole('SUPER_ADMIN'), requireIdempotencyKey,
  validate(adjustBalanceSchema), async (req: AuthedRequest, res) => {
  const { userId, direction, amount, balanceType, reason } = req.body;   // reason: min 10 chars, enforced by Zod
  const amt = new Prisma.Decimal(amount);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({
        where: { id: userId }, select: { realBalance: true, demoBalance: true, username: true },
      });

      const op = direction === 'CREDIT' ? credit : debit;
      const { balanceBefore, balanceAfter } = await op(tx, {
        userId, amount: amt, balanceType, type: 'ADJUSTMENT',
        description: `Manual ${direction.toLowerCase()} by admin #${req.auth!.userId}: ${reason}`,
        referenceType: 'AdminAdjustment', referenceId: String(req.auth!.userId),
        idempotencyKey: (req as any).idempotencyKey,
      });

      await tx.auditLog.create({ data: {
        userId: req.auth!.userId, action: 'ADMIN_BALANCE_ADJUST', entityType: 'User', entityId: String(userId),
        oldValues: { [balanceType]: balanceBefore.toFixed(2) },
        newValues: { [balanceType]: balanceAfter.toFixed(2), direction, amount: amt.toFixed(2), reason },
        ipAddress: req.ip, userAgent: req.get('user-agent') ?? null,
      }});

      // Company-side counter-entry keeps double-entry consistent.
      await postCompanyLedger(tx, {
        type: 'ADJUSTMENT',
        amount: direction === 'DEBIT' ? amt : amt.negated(),
        description: `Manual adjustment for @${before.username}: ${reason}`,
        metadata: { adminId: req.auth!.userId, userId, direction },
      });

      return { balanceAfter };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.json({ success: true, newBalance: result.balanceAfter.toFixed(2) });
  } catch (e) {
    if (e instanceof InsufficientFundsError) {
      // Never silently clamp — reject so the record matches reality.
      return res.status(400).json({ error: 'Adjustment would make the balance negative', code: 'INSUFFICIENT_FUNDS' });
    }
    throw e;
  }
});
```

- **Impact:** Untraceable insider fund movement — the single most common vector for internal fraud in gaming operations.

---

#### **FIN-009 — No in-play / locked balance tracking**
- **Severity:** HIGH · **Priority:** P1
- **File:** `src/types.ts` declares `lockedBalance` on `UserWallet`; `server.ts` sets it to `0` at creation and **never updates it**.

**Description.** Stakes are deducted straight from `balance`, so the player cannot distinguish "spendable" from "committed to an open bet or duel". The admin `totalEscrowLocked` figure (`server.ts:2330`) is recomputed by scanning arrays and, because duel stakes are already subtracted from `balance`, the site-liquidity total double-counts.

**Fixed Code** — derive in-play from the authoritative source rather than storing a mutable mirror:
```ts
export async function getWalletView(userId: number) {
  const [user, openBets, openDuels] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { realBalance: true, demoBalance: true } }),
    prisma.bet.aggregate({
      _sum: { amount: true },
      where: { userId, balanceType: 'REAL', status: { in: ['PENDING', 'MATCHED', 'PARTIALLY_MATCHED'] } },
    }),
    prisma.duelStake.aggregate({ _sum: { amount: true }, where: { userId, settledAt: null } }),
  ]);

  const inPlay = (openBets._sum.amount ?? new Prisma.Decimal(0))
    .plus(openDuels._sum.amount ?? new Prisma.Decimal(0));

  return {
    realBalance: user.realBalance.toFixed(2),   // already excludes staked funds (debited at stake time)
    demoBalance: user.demoBalance.toFixed(2),
    inPlay:      inPlay.toFixed(2),
    totalReal:   user.realBalance.plus(inPlay).toFixed(2),
  };
}
```

- **Impact:** Players and admins cannot see committed funds; liquidity reporting is wrong.

---

#### **FIN-010 — REAL and DEMO balances are not segregated in the duel engine**
- **Severity:** HIGH · **Priority:** P1
- **Files:** `server.ts:2726` (`acceptor.balance -= requiredAcceptorStake`), `2940` (`user.balance -= additionalCost`), `~990` (`winnerUser.balance += winnerPayout`), `2510`

**Description.** The table game honours `balanceType`. The entire 1v1 duel engine hardcodes `user.balance` — the **real-money** field. A player in demo mode who creates or accepts a duel has real funds debited. `metrics.todayMatchedVolume` and `todayCommission` also aggregate demo and real together, so revenue reporting is inflated by play money.

**Fixed Code:**
```ts
// Duel rooms carry an explicit balanceType and may never mix.
interface DuelRoom { id: string; balanceType: 'REAL' | 'DEMO'; /* ... */ }

if (room.balanceType !== req.body.balanceType) {
  return res.status(400).json({
    error: 'This duel is a ' + room.balanceType.toLowerCase() + '-money table',
    code: 'BALANCE_TYPE_MISMATCH',
  });
}

await prisma.$transaction(async (tx) => {
  await debit(tx, {
    userId: req.auth!.userId, amount: stake, balanceType: room.balanceType,   // ← never hardcoded
    type: 'BET_PLACED', description: `Duel stake — room ${room.id}`,
    referenceId: room.id, referenceType: 'DuelRoom',
    idempotencyKey: `duel:${room.id}:stake:${req.auth!.userId}`,
  });
});

// Revenue only ever counts REAL money.
if (room.balanceType === 'REAL') {
  await postCompanyLedger(tx, { type: 'COMMISSION', amount: commission, description: `Duel ${room.id} rake` });
}
```

- **Impact:** Real funds silently consumed during demo play; revenue figures contaminated by play money.

---

#### **FIN-011 — Duel ALL_IN has no side-pot logic and can exceed the opponent's stack**
- **Severity:** HIGH · **Priority:** P1
- **File:** `server.ts:2908–2910`, `2932–2940`

**Description.** `ALL_IN` sets `additionalCost = user.balance`, committing the player's entire balance with no cap at the opponent's remaining stack and no side pot. The opponent cannot call, so the excess is simply absorbed into `currentPot` and — on a loss — forfeited to a pot the opponent could never have matched. The 5% rake is then charged on the inflated pot.

Related: the raise cap is `duel.bettingRound < 2 && duel.raisesCount < 3` (line 2955), which caps *betting rounds* at 2, not raises at 3 as Rule 12 requires. `ALL_IN` never increments `raisesCount` (line 2949 only matches `action.includes("RAISE")`), so it bypasses the cap entirely.

**Current Code:**
```ts
} else if (action === "ALL_IN") {
  additionalCost = user.balance;                 // no cap against opponent stack
  nextRaiseVal = userBet + additionalCost;
}
...
if (action.includes("RAISE")) { duel.raisesCount += 1; }   // ALL_IN excluded
```

**Fixed Code:**
```ts
const MAX_RAISES_PER_HAND = 3;   // Business Rule 12

const opponentStack = await getAvailableBalance(opponentId, duel.balanceType);
const opponentCommitted = isCreator ? duel.acceptorBet : duel.creatorBet;
const opponentMaxTotal  = opponentCommitted.plus(opponentStack);

if (action === 'ALL_IN' || action.startsWith('RAISE')) {
  if (duel.raisesCount >= MAX_RAISES_PER_HAND) {
    return res.status(400).json({
      error: `Maximum ${MAX_RAISES_PER_HAND} raises per hand reached. You may only call, check or fold.`,
      code: 'RAISE_LIMIT_REACHED',
    });
  }
  duel.raisesCount += 1;                       // counts ALL_IN too
}

let additionalCost: Money;
if (action === 'ALL_IN') {
  const myStack = await getAvailableBalance(userId, duel.balanceType);
  const myMaxTotal = userBet.plus(myStack);
  // Cap the effective bet at what the opponent can actually cover — no dead money.
  const effectiveTotal = Prisma.Decimal.min(myMaxTotal, opponentMaxTotal);
  additionalCost = effectiveTotal.minus(userBet);
  if (additionalCost.lte(0)) {
    return res.status(400).json({ error: 'Opponent cannot cover any further raise', code: 'NO_ACTION_AVAILABLE' });
  }
}
```

- **Impact:** Players lose money into pots that could never be contested; rake overcharged on phantom stakes.

---

### 🔴 GAME LOGIC

---

#### **GAME-001 — Matching is pro-rata by pool ratio, not FIFO price-time priority; no `BetMatch` records**
- **Severity:** CRITICAL · **Priority:** P0
- **File:** `server.ts:~595–640`

**Description.** Business Rule states FIFO (price-time priority by `createdAt`). The implementation computes a single ratio and scales *every* bet on a side by it:
```ts
const matchedTotal      = Math.min(dragonTotal, tigerTotal);
const dragonMatchRatio  = dragonTotal > 0 ? Math.min(1, matchedTotal / dragonTotal) : 0;
const tigerMatchRatio   = tigerTotal  > 0 ? Math.min(1, matchedTotal / tigerTotal)  : 0;
const matchedPart       = Math.floor(bet.amount * matchRatio);
```
A player who bet in the first second of the round gets the same partial fill as one who bet in the last — the early bettor's queue priority is worth nothing. No `BetMatch` rows are created, so there is no record of **who was matched against whom**. That record is the legal substance of a P2P (exchange) model: without it you cannot prove to a regulator that players faced each other rather than the house, and you cannot resolve a disputed settlement. `BetMatch` exists in the schema, fully specified, unused.

Additionally, `Math.floor` on `matchedPart` inflates `unmatchedPart`, so `Σ matchedPart` can be strictly less than `matchedTotal` — the two sides' matched totals no longer agree, breaking the settlement invariant.

**Fixed Code** — `src/server/services/matching.engine.ts`:
```ts
import { Prisma } from '@prisma/client';
import { D, type Money } from './money.js';

interface Order { betId: number; userId: number; remaining: Money; createdAt: Date; }

/**
 * FIFO (price-time priority) matching for a binary Dragon/Tiger book.
 * - Strict createdAt ordering, id as deterministic tie-breaker.
 * - Self-matching prevented: a user's bets are never crossed against their own.
 * - Partial fills fully supported.
 * Returns the match set; the caller persists it inside the settlement transaction.
 */
export function matchFIFO(dragon: Order[], tiger: Order[]) {
  const d = [...dragon].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.betId - b.betId);
  const t = [...tiger ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.betId - b.betId);

  const matches: Array<{ dragonBetId: number; tigerBetId: number; amount: Money }> = [];
  const filled = new Map<number, Money>();
  const bump = (id: number, amt: Money) => filled.set(id, (filled.get(id) ?? D(0)).plus(amt));

  let i = 0, j = 0;
  while (i < d.length && j < t.length) {
    const a = d[i]!, b = t[j]!;

    if (a.remaining.lte(0)) { i++; continue; }
    if (b.remaining.lte(0)) { j++; continue; }

    // SELF-MATCH PREVENTION: skip the shallower side forward to find a genuine counterparty.
    if (a.userId === b.userId) {
      const k = t.findIndex((x, idx) => idx > j && x.userId !== a.userId && x.remaining.gt(0));
      if (k === -1) { i++; continue; }
      const c = t[k]!;
      const fill = Prisma.Decimal.min(a.remaining, c.remaining);
      a.remaining = a.remaining.minus(fill);
      c.remaining = c.remaining.minus(fill);
      matches.push({ dragonBetId: a.betId, tigerBetId: c.betId, amount: fill });
      bump(a.betId, fill); bump(c.betId, fill);
      continue;
    }

    const fill = Prisma.Decimal.min(a.remaining, b.remaining);
    a.remaining = a.remaining.minus(fill);
    b.remaining = b.remaining.minus(fill);
    matches.push({ dragonBetId: a.betId, tigerBetId: b.betId, amount: fill });
    bump(a.betId, fill); bump(b.betId, fill);

    if (a.remaining.lte(0)) i++;
    if (b.remaining.lte(0)) j++;
  }

  const totalMatchedPerSide = matches.reduce((s, m) => s.plus(m.amount), D(0));
  return { matches, filled, totalMatchedPerSide };
}
```
Persisted inside the settlement transaction:
```ts
await tx.betMatch.createMany({
  data: matches.map(m => ({ roundId, dragonBetId: m.dragonBetId, tigerBetId: m.tigerBetId, amount: m.amount })),
});
for (const bet of allBets) {
  const matched   = filled.get(bet.id) ?? D(0);
  const unmatched = bet.amount.minus(matched);
  await tx.bet.update({ where: { id: bet.id }, data: {
    matchedAmount: matched, unmatchedAmount: unmatched,
    status: matched.eq(0) ? 'REFUNDED' : matched.eq(bet.amount) ? 'MATCHED' : 'PARTIALLY_MATCHED',
  }});
}
```

- **Impact:** The platform is not a real P2P exchange. No provable counterparty record; unfair fills; settlement invariant broken by float truncation.

---

#### **GAME-002 — Server seed is revealed before the settlement transaction commits**
- **Severity:** CRITICAL · **Priority:** P0
- **File:** `server.ts:~665` and `~845`

**Description.** Business Rule 9 requires the seed be revealed **only after settlement is fully COMMITTED**. The code assigns the seed at the *start* of the settling phase, before any balance is touched:
```ts
round.status = "SETTLING";
round.serverSeed = tbl.secretServerSeed;   // ← REVEALED HERE, before any settlement work
// ... ~200 lines of balance mutation follow ...
round.status = "COMPLETED";
broadcast({ type: "ROUND_RESULT", tableSlug: slug, round: round, ... });   // seed goes out on the wire
```
Worse, the cards are derived and broadcast at `DEALING` (line ~652), a full 3 seconds *before* settlement even begins — and `round` is broadcast by reference, so `GET /api/tables` (line 1281) exposes `currentRound.serverSeed` the instant it is set. Because there is no database, a crash between reveal and settlement leaves a published seed with no settled round.

There is also a **fatal seed-reuse flaw**: the same `tbl.secretServerSeed` is used for the table round *and*, in the duel engine, `deriveCards(seed, "p2p_duel", Date.now())` (`server.ts:~2706`) uses `Date.now()` as the nonce with no pre-published commitment at all. A duel's outcome is therefore predictable by anyone who knows the (already-revealed) table seed and can guess the millisecond.

**Fixed Code:**
```ts
async function settleRound(roundId: number) {
  const revealed = await prisma.$transaction(async (tx) => {
    const round = await tx.gameRound.findUniqueOrThrow({ where: { id: roundId } });
    if (round.status !== 'DEALING') throw new Error('ROUND_NOT_READY');

    const serverSeed = await loadSealedSeed(round.id);              // decrypt from secure store
    const { dragonCard, tigerCard, result } = deriveCards(serverSeed, round.clientSeed, round.nonce);

    // ... FIFO matching, refunds, payouts, CompanyLedger, Bet updates — ALL inside this tx ...

    await tx.gameRound.update({ where: { id: roundId }, data: {
      status: 'COMPLETED',
      dragonCardValue: dragonCard.value, dragonCardSuit: dragonCard.suit,
      tigerCardValue:  tigerCard.value,  tigerCardSuit:  tigerCard.suit,
      result,
      serverSeed,                       // persisted, but not yet emitted to anyone
      settledAt: new Date(), completedAt: new Date(),
    }});

    return { serverSeed, dragonCard, tigerCard, result };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });

  // ── COMMIT HAS HAPPENED. Only now may the seed leave the server. ──
  io.to(`table:${slug}`).emit('round:completed', {
    roundId, result: revealed.result,
    dragonCard: revealed.dragonCard, tigerCard: revealed.tigerCard,
    serverSeed: revealed.serverSeed,
  });
}
```
And redact the seed from every read endpoint until completion:
```ts
const publicRound = (r: GameRound) => ({
  ...r,
  serverSeed: r.status === 'COMPLETED' ? r.serverSeed : null,   // never leak early
});
```
Each duel must get its own committed seed pair:
```ts
const serverSeed = crypto.randomBytes(32).toString('hex');
const room = await prisma.duelRoom.create({ data: {
  serverSeedHash: sha256(serverSeed),    // published at room creation
  serverSeedEnc: CryptoUtil.encryptSensitive(serverSeed),
  clientSeed, nonce: 0,
}});
// cards derived only at showdown; seed revealed only after the settlement tx commits
```

- **Impact:** Provably-fair guarantee is void. Duel outcomes are predictable. A crash mid-settlement leaves an unverifiable published seed.

---

#### **GAME-003 — Round history is fabricated with `Math.random()` (fake liquidity — violates Rule 1)**
- **Severity:** CRITICAL (integrity/compliance) · **Priority:** P0
- **File:** `server.ts:508–534` (`generateInitialRoadmap`), invoked at line 542 with `generateInitialRoadmap(45)`

**Description.** On every boot, each table is seeded with **45 fabricated historical rounds** produced by `Math.random()`, complete with plausible card faces and back-dated timestamps at 35-second intervals:
```ts
function generateInitialRoadmap(count = 35): RoadmapItem[] {
  for (let i = 1; i <= count; i++) {
    const dVal = Math.floor(Math.random() * 13) + 1;
    const tVal = Math.floor(Math.random() * 13) + 1;
    ...
    items.push({ roundNumber: 1000 + i, result, dragonCard: {...}, tigerCard: {...},
                 timestamp: new Date(Date.now() - (count - i) * 35000).toISOString() });
  }
  return items;
}
```
These fake rounds are served to players through the roadmap / bead-road UI, which is *the* feature pattern-betting players rely on. They have no server seed, no hash, and cannot be verified — yet they sit beside genuine rounds in the same strip, indistinguishable. This is presenting fabricated game history as real, and it violates Rule 1 (no fake liquidity) and the "Provably Fair" claim in `TransparencyCharterModal.tsx`.

Related fabrications: `server.ts:2570` picks a room side with `Math.random() > 0.5 ? "dragon" : "tiger"`; line 2580 fakes an `activityScore`; `RoomCapacityChart.tsx` and `src/utils/audio.ts` contain further random-driven display data.

**Fixed Code** — delete the generator entirely and serve only real, verifiable history:
```ts
// DELETE generateInitialRoadmap() and its call site.

app.get('/api/v1/tables/:slug/roadmap', async (req, res) => {
  const table = await prisma.gameTable.findUnique({
    where: { slug: req.params.slug }, select: { id: true },
  });
  if (!table) return res.status(404).json({ error: 'Table not found' });

  const rounds = await prisma.gameRound.findMany({
    where: { tableId: table.id, status: 'COMPLETED' },      // real, settled rounds only
    orderBy: { roundNumber: 'desc' },
    take: 60,
    select: {
      roundNumber: true, result: true,
      dragonCardValue: true, dragonCardSuit: true,
      tigerCardValue: true, tigerCardSuit: true,
      serverSeedHash: true, serverSeed: true, clientSeed: true, nonce: true,
      completedAt: true,
    },
  });

  // An empty history is the honest answer for a brand-new table.
  res.json({ rounds, isEmpty: rounds.length === 0 });
});
```
And in the UI, state it plainly rather than filling space:
```tsx
{rounds.length === 0 ? (
  <div className="py-6 text-center text-sm text-neutral-400">
    No completed rounds yet. History will appear here after the first round settles.
  </div>
) : (
  <BeadRoad rounds={rounds} />
)}
```

- **Impact:** Players make betting decisions on invented data. Directly contradicts the platform's own transparency claims; in most jurisdictions this is a deceptive-practice offence.

---

#### **GAME-004 — Round FSM runs on nested `setTimeout` with no `WAITING` state and no crash recovery**
- **Severity:** CRITICAL · **Priority:** P0
- **File:** `server.ts:1117–1215` — a `setInterval(..., 1000)` containing `setTimeout(1500)` → `setTimeout(3000)` → `setTimeout(4000)`

**Description.** Required FSM: `WAITING → BETTING → MATCHING → DEALING → SETTLING → COMPLETED`. Implemented: `BETTING → MATCHING → DEALING → SETTLING → COMPLETED` — **`WAITING` never occurs**; a new round is constructed directly in `BETTING` (line ~885). Phase transitions live in closures, so:
- A crash between `DEALING` and `COMPLETED` loses the round permanently, with stakes already debited and no settlement.
- Nothing is persisted, so no recovery job can find and finish an orphaned round.
- The engine is single-process by construction; two instances would run two independent games on the same table.
- An unhandled exception inside a `setTimeout` callback terminates the Node process (no `unhandledRejection` handler exists).

**Fixed Code** — persist the state machine and drive it from a durable scheduler:
```ts
type Phase = 'WAITING' | 'BETTING' | 'MATCHING' | 'DEALING' | 'SETTLING' | 'COMPLETED' | 'CANCELLED';

const LEGAL: Record<Phase, Phase[]> = {
  WAITING:   ['BETTING', 'CANCELLED'],
  BETTING:   ['MATCHING', 'CANCELLED'],
  MATCHING:  ['DEALING', 'CANCELLED'],
  DEALING:   ['SETTLING', 'CANCELLED'],
  SETTLING:  ['COMPLETED'],            // once settling starts it MUST finish
  COMPLETED: [],
  CANCELLED: [],
};

/** Atomic, guarded transition. Concurrent workers cannot double-advance a round. */
async function transition(tx: Prisma.TransactionClient, roundId: number, from: Phase, to: Phase) {
  if (!LEGAL[from].includes(to)) throw new Error(`Illegal transition ${from} -> ${to}`);
  const r = await tx.gameRound.updateMany({
    where: { id: roundId, status: from },
    data: { status: to, ...(to === 'DEALING' ? { dealtAt: new Date() } : {}),
                        ...(to === 'SETTLING' ? { settledAt: new Date() } : {}) },
  });
  if (r.count !== 1) throw new Error(`Round ${roundId} was not in ${from} — concurrent transition detected`);
}

// Durable scheduling via BullMQ (already a dependency of the intended backend).
await roundQueue.add('close-betting', { roundId }, {
  delay: bettingDurationMs, jobId: `close:${roundId}`, removeOnComplete: true,
});

// Boot-time recovery: finish or cancel anything left mid-flight by a crash.
export async function recoverOrphanedRounds() {
  const stuck = await prisma.gameRound.findMany({
    where: { status: { in: ['BETTING', 'MATCHING', 'DEALING', 'SETTLING'] },
             createdAt: { lt: new Date(Date.now() - 5 * 60_000) } },
  });
  for (const r of stuck) {
    logger.warn({ roundId: r.id, status: r.status }, 'Recovering orphaned round');
    if (r.status === 'SETTLING') await settleRound(r.id);       // idempotent — safe to re-run
    else                         await cancelRoundAndRefundAll(r.id, 'SYSTEM_RECOVERY');
  }
}

process.on('unhandledRejection', (err) => { logger.fatal({ err }, 'Unhandled rejection'); process.exit(1); });
process.on('uncaughtException',  (err) => { logger.fatal({ err }, 'Uncaught exception');  process.exit(1); });
```

- **Impact:** Rounds lost mid-settlement with player funds already debited and no automated recovery. Cannot scale beyond one process.

---

#### **GAME-005 — Both players' cards are broadcast to everyone in the table game (violates Rule 11)**
- **Severity:** HIGH · **Priority:** P1
- **File:** `server.ts:~652–660` (`ROUND_DEALING` broadcast), `1281` (`GET /api/tables`)

**Description.** Rule 11 requires each player see only their own card until the reveal phase. The duel engine handles this correctly (`server.ts:2816–2840` nulls the opponent's card pre-showdown — credit where due). The **table game does not**: `broadcast()` sends `dragonCard` and `tigerCard` to every connected socket the moment `DEALING` begins, and `GET /api/tables` returns the live `currentRound` object containing the cards. Because `broadcast()` has no room concept, spectators on other tables receive them too.

**Fixed Code:**
```ts
// Public: no card data until the round is COMPLETED.
io.to(`table:${slug}`).emit('round:dealing', { roundId, phase: 'DEALING', endsAt: dealEndsAt });

// Private: each participant receives only the card for the side they backed.
for (const bet of roundBets) {
  io.to(`user:${bet.userId}`).emit('round:your-card', {
    roundId,
    side: bet.side,
    card: bet.side === 'DRAGON' ? dragonCard : tigerCard,
  });
}

// Public reveal happens only after the settlement transaction commits (see GAME-002).
io.to(`table:${slug}`).emit('round:completed', { roundId, dragonCard, tigerCard, result, serverSeed });
```
And strip cards from the REST view while the round is live:
```ts
const publicRound = (r: GameRound) => ({
  ...r,
  dragonCardValue: r.status === 'COMPLETED' ? r.dragonCardValue : null,
  dragonCardSuit:  r.status === 'COMPLETED' ? r.dragonCardSuit  : null,
  tigerCardValue:  r.status === 'COMPLETED' ? r.tigerCardValue  : null,
  tigerCardSuit:   r.status === 'COMPLETED' ? r.tigerCardSuit   : null,
  serverSeed:      r.status === 'COMPLETED' ? r.serverSeed      : null,
});
```

- **Impact:** Violates a stated absolute rule; removes all card-reveal drama; leaks outcome before settlement.

---

#### **GAME-006 — Dead house-banked 8× Tie bet in the settlement path (violates Rule 3)**
- **Severity:** HIGH · **Priority:** P1
- **File:** `server.ts:~690–696`

**Description.** The bet endpoint correctly rejects `TIE` (line 1332). But the settlement engine still contains a live branch paying `matchedStake * 8` on a Tie bet:
```ts
if (isTie) {
  if (bet.side === "TIE") {
    bet.status = "WON";
    bet.payout = matchedStake * 8;        // ← house-banked liability, funded by nothing
    ...
```
This contradicts Rule 3 (pure P2P — no bets against the house) and Rule 5 (tie → 100% to company). It is currently unreachable, but `LiveBetRecord.side` is typed `"DRAGON" | "TIGER" | "TIE"` and the admin `POST /api/admin/table/config` plus any future code path could reintroduce a Tie bet, at which point the house owes 8× with no matched counterparty and no reserve.

**Fixed Code** — remove the branch and narrow the type so it cannot return:
```ts
// src/types.ts
export type BetSide = 'DRAGON' | 'TIGER';       // TIE is a RESULT, never a bet side

// settlement
if (result === 'TIE') {
  // Business Rule 5: the company retains 100% of the total matched pool.
  for (const bet of bets) {
    const matched = filled.get(bet.id) ?? D(0);
    if (matched.gt(0)) {
      await tx.bet.update({ where: { id: bet.id }, data: {
        status: 'TIE_LOSS', payout: D(0), profitLoss: matched.negated(), settledAt: new Date(),
      }});
    }
  }
  await postCompanyLedger(tx, {
    type: 'TIE_REVENUE', amount: totalMatchedPool, roundId,
    description: `Round #${roundNumber} TIE — 100% of matched pool retained`,
  });
}
```

- **Impact:** An unfunded 8× house liability one code change away from going live.

---

#### **GAME-007 — No duplicate-bet prevention, no idempotency, and a race on the betting-window check**
- **Severity:** HIGH · **Priority:** P1
- **File:** `server.ts:1311–1460`

**Description.** Three related gaps:
1. No `Idempotency-Key`; a double-tap or a retried request places two bets and debits twice. (`Bet.idempotencyKey @unique` exists in the schema, unused.)
2. `if (tbl.currentRound.status !== "BETTING")` is checked, then ~50 lines of work run before the balance is debited — a bet submitted in the final millisecond can land after the phase flips (late-bet acceptance).
3. The bet is never bound to a specific round id, so a request in flight across a round boundary is applied to the *next* round.

The schema's `@@unique([userId, roundId, side, balanceType])` on `Bet` is the right constraint and is not enforced anywhere in the running code.

**Fixed Code:**
```ts
app.post('/api/v1/game/bet', requireAuth, betRateLimit, requireIdempotencyKey,
  validate(placeBetSchema), async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const { tableSlug, side, amount, balanceType, roundId } = req.body;
  const amt = new Prisma.Decimal(amount);

  try {
    const out = await prisma.$transaction(async (tx) => {
      // Re-read the round INSIDE the transaction and bind to the client's intended round id.
      const round = await tx.gameRound.findUnique({
        where: { id: roundId },
        select: { id: true, status: true, bettingEndAt: true, tableId: true, roundNumber: true },
      });
      if (!round)                      throw new AppError('ROUND_NOT_FOUND', 'Round not found', 404);
      if (round.status !== 'BETTING')  throw new AppError('BETTING_CLOSED', 'Betting has closed for this round', 409);
      if (round.bettingEndAt && round.bettingEndAt <= new Date()) {
        throw new AppError('BETTING_CLOSED', 'Betting has closed for this round', 409);
      }

      const table = await tx.gameTable.findUniqueOrThrow({
        where: { id: round.tableId }, select: { minBet: true, maxBet: true, isActive: true, slug: true },
      });
      if (!table.isActive || table.slug !== tableSlug) throw new AppError('TABLE_UNAVAILABLE', 'Table unavailable', 409);
      if (amt.lt(table.minBet) || amt.gt(table.maxBet)) {
        throw new AppError('STAKE_OUT_OF_RANGE',
          `Stake must be between ${table.minBet.toFixed(2)} and ${table.maxBet.toFixed(2)}`, 400);
      }

      // Rule: a player may not hold positions on both sides of the same round.
      const opposite = await tx.bet.findFirst({
        where: { userId, roundId: round.id, balanceType, side: side === 'DRAGON' ? 'TIGER' : 'DRAGON' },
        select: { id: true },
      });
      if (opposite) throw new AppError('OPPOSING_BET', 'You already have a bet on the opposite side this round', 409);

      // Atomic debit (throws InsufficientFundsError on failure).
      await debit(tx, {
        userId, amount: amt, balanceType, type: 'BET_PLACED',
        description: `Bet ${side} on round #${round.roundNumber}`,
        referenceId: String(round.id), referenceType: 'GameRound',
        idempotencyKey: (req as any).idempotencyKey,
      });

      // @@unique([userId, roundId, side, balanceType]) — top up an existing position rather than duplicating.
      const bet = await tx.bet.upsert({
        where: { userId_roundId_side_balanceType: { userId, roundId: round.id, side, balanceType } },
        create: { userId, roundId: round.id, tableId: round.tableId, side, amount: amt,
                  balanceType, status: 'PENDING', idempotencyKey: (req as any).idempotencyKey },
        update: { amount: { increment: amt } },
      });
      return bet;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 8_000 });

    res.status(201).json({ betId: out.uuid, amount: out.amount.toFixed(2) });
  } catch (e) {
    if (e instanceof InsufficientFundsError) {
      return res.status(400).json({ error: 'Insufficient balance for this bet', code: 'INSUFFICIENT_FUNDS' });
    }
    if (e instanceof AppError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
});
```

- **Impact:** Double-charged players, bets accepted after the window closes, bets landing in the wrong round.

---

#### **GAME-008 — Game history is fully mutable after `COMPLETED`**
- **Severity:** HIGH · **Priority:** P1
- **File:** `server.ts` — `round` and `tbl.roadmap` are plain mutable objects; `POST /api/admin/table/config` (2399) and `POST /api/database/reset` (3287) can rewrite or erase history at will, unauthenticated.

**Fixed Code** — enforce immutability at the database level:
```sql
-- prisma/migrations/<ts>_immutable_history/migration.sql
CREATE OR REPLACE FUNCTION forbid_completed_round_update() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Round % is % and is immutable', OLD."id", OLD."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_gameround_immutable
  BEFORE UPDATE OR DELETE ON "GameRound"
  FOR EACH ROW EXECUTE FUNCTION forbid_completed_round_update();

CREATE OR REPLACE FUNCTION forbid_settled_bet_update() RETURNS trigger AS $$
BEGIN
  IF OLD."settledAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Bet % is settled and is immutable', OLD."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bet_immutable
  BEFORE UPDATE OR DELETE ON "Bet"
  FOR EACH ROW EXECUTE FUNCTION forbid_settled_bet_update();

-- Ledger and audit log are append-only.
CREATE RULE "companyledger_no_update" AS ON UPDATE TO "CompanyLedger" DO INSTEAD NOTHING;
CREATE RULE "companyledger_no_delete" AS ON DELETE TO "CompanyLedger" DO INSTEAD NOTHING;
CREATE RULE "auditlog_no_update"      AS ON UPDATE TO "AuditLog"      DO INSTEAD NOTHING;
CREATE RULE "auditlog_no_delete"      AS ON DELETE TO "AuditLog"      DO INSTEAD NOTHING;
```
Corrections are then made by posting a compensating `ADJUSTMENT` entry — never by editing history.

- **Impact:** History can be rewritten to hide fraud; destroys evidentiary value for disputes and audits.

---

#### **GAME-009 — 15-second auto-fold works, but the raise cap does not match Rule 12**
- **Severity:** MEDIUM · **Priority:** P2
- **File:** `server.ts:1183–1195` (auto-fold — **correct**), `2955` (raise cap — incorrect)

**Description.** Credit where due: the duel tick engine correctly implements Rule 12's 15-second inactivity auto-fold (`duel.secondsRemaining` decrements to 0 → `settleDuelOnFold(duel, foldingUserId)`), and the fold settlement correctly forfeits the folder's entire stake per Rule 7.

The raise cap is wrong. `if (duel.bettingRound < 2 && duel.raisesCount < 3)` conflates two limits: it caps *betting rounds* at 2 while Rule 12 specifies **max 3 raises per hand**. Combined with FIN-011 (`ALL_IN` not counted as a raise), the effective cap is unpredictable.

**Fixed Code:** see FIN-011 — enforce `raisesCount >= MAX_RAISES_PER_HAND` as a hard precondition on every aggressive action (`RAISE_2X`, `RAISE_3X`, `ALL_IN`), and drive round progression off "all players have acted and bets are level" rather than a hardcoded round counter. Also persist `secondsRemaining` as an absolute `actionDeadline: DateTime` so the timer survives a restart.

- **Impact:** Pots can grow beyond the intended risk envelope; inconsistent rule enforcement between hands.

---

### 🔴 ADMIN PANEL

*(See §4 for the full narrative audit. Issues below are the concrete defects.)*

---

#### **ADM-001 — Admin dashboard is a 67-line stub with three empty placeholder tabs**
- **Severity:** CRITICAL · **Priority:** P0
- **File:** `src/components/AdminDashboard.tsx:1–67`

**Description.** The file is 67 lines. The "Chat" tab renders the literal text *"Chat Moderation & Bad-word Filter Engine (Active)"*. The "Transactions" tab renders *"Deposit & Withdrawal Queue (Active)"*. Neither feature exists. The "Users" tab is not implemented at all — there is a `{/* ... Other tabs ... */}` comment where it should be. `stats` is typed `any`. There is no loading state, no error state, no pagination, no search, no confirmation modal, no toast, and no auto-refresh (`fetchStats()` runs once on mount).

**Current Code:**
```tsx
{activeAdminTab === "chat" && <div className="text-center p-10 text-neutral-500">Chat Moderation & Bad-word Filter Engine (Active)</div>}
{activeAdminTab === "transactions" && <div className="text-center p-10 text-neutral-500">Deposit & Withdrawal Queue (Active)</div>}
...
{/* ... Other tabs ... */}
```

**Fix:** the admin panel must be built. Required modules and their absence are itemised in §4. Labelling a non-existent feature "(Active)" is a correctness bug in its own right — remove those strings immediately even before the features are built.

- **Impact:** No operational capability. The business cannot process a deposit, approve a withdrawal, investigate a dispute, or ban a cheat.

---

#### **ADM-002 — `AuditLog` table is never written to**
- **Severity:** CRITICAL · **Priority:** P0
- **File:** `server.ts` — zero writes. Schema model is complete and correct.

**Fixed Code** — automatic capture on every admin mutation:
```ts
export function adminAuditLogger(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return next();

  const started = Date.now();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;                    // only log effective changes
    prisma.auditLog.create({ data: {
      userId: req.auth?.userId ?? null,
      action: `${req.method} ${req.baseUrl}${req.path}`,
      entityType: (res.locals.entityType as string) ?? 'Unknown',
      entityId:   String(res.locals.entityId ?? '-'),
      oldValues:  (res.locals.oldValues as Prisma.InputJsonValue) ?? undefined,
      newValues:  (res.locals.newValues as Prisma.InputJsonValue) ?? undefined,
      ipAddress:  req.ip,
      userAgent:  req.get('user-agent') ?? null,
    }}).catch(err => logger.error({ err }, 'Failed to write audit log'));
    logger.info({ adminId: req.auth?.userId, path: req.path, ms: Date.now() - started }, 'admin action');
  });
  return next();
}
```
Each handler sets `res.locals.entityType/entityId/oldValues/newValues`. Combined with the append-only DB rules in GAME-008, this yields a tamper-evident trail.

- **Impact:** Insider fraud is undetectable and unprovable. Fails every gaming-licence audit requirement.

---

#### **ADM-003 — Dashboard financial figures come from volatile RAM and are not reset daily**
- **Severity:** HIGH · **Priority:** P1
- **File:** `server.ts:2320–2367`, reading `metrics` (line 110)

**Description.** `todayMatchedVolume`, `todayCommission` and `todayTieRevenue` are floats that start at zero on boot and **never reset at midnight** despite the `today` prefix. They mix REAL and DEMO money (FIN-010) and include duel volume. Every number on the admin dashboard is therefore wrong in at least three distinct ways.

**Fixed Code:**
```ts
adminRouter.get('/dashboard', async (req, res) => {
  const tz = 'Asia/Dhaka';
  const startOfDay = zonedStartOfDay(new Date(), tz);      // real day boundary, operator timezone
  const endOfDay   = addDays(startOfDay, 1);
  const window = { gte: startOfDay, lt: endOfDay };

  const [commission, tieRevenue, wagered, newUsers, pendingDep, pendingWd, liveRounds] = await Promise.all([
    prisma.companyLedger.aggregate({ _sum: { amount: true }, where: { type: 'COMMISSION',  createdAt: window } }),
    prisma.companyLedger.aggregate({ _sum: { amount: true }, where: { type: 'TIE_REVENUE', createdAt: window } }),
    prisma.bet.aggregate({ _sum: { matchedAmount: true },
      where: { balanceType: 'REAL', createdAt: window, status: { notIn: ['CANCELLED', 'REFUNDED'] } } }),
    prisma.user.count({ where: { createdAt: window, role: 'PLAYER' } }),
    prisma.depositRequest.aggregate({ _sum: { amount: true }, _count: true, where: { status: 'PENDING' } }),
    prisma.withdrawalRequest.aggregate({ _sum: { amount: true }, _count: true, where: { status: 'PENDING' } }),
    prisma.gameRound.findMany({ where: { status: { in: ['BETTING', 'MATCHING', 'DEALING', 'SETTLING'] } },
      select: { id: true, roundNumber: true, status: true, tableId: true,
                totalDragonBets: true, totalTigerBets: true, bettingEndAt: true } }),
  ]);

  const z = new Prisma.Decimal(0);
  const c = commission._sum.amount ?? z;
  const t = tieRevenue._sum.amount ?? z;

  res.json({
    todayWagered:      (wagered._sum.matchedAmount ?? z).toFixed(2),
    todayCommission:   c.toFixed(2),                 // 5% — reported separately
    todayTieRevenue:   t.toFixed(2),                 // 100% — reported separately
    todayTotalRevenue: c.plus(t).toFixed(2),
    activePlayers:     await countConnectedSockets(),
    newRegistrations:  newUsers,
    pendingDeposits:    { count: pendingDep._count, amount: (pendingDep._sum.amount ?? z).toFixed(2) },
    pendingWithdrawals: { count: pendingWd._count,  amount: (pendingWd._sum.amount ?? z).toFixed(2) },
    liveRounds,
  });
});
```

- **Impact:** Every business decision, tax filing and revenue report is based on fabricated figures.

---

#### **ADM-004 — Missing admin modules: deposits, withdrawals, user management, game monitor, reports, merchants, settings**
- **Severity:** CRITICAL · **Priority:** P0/P1
- **Files:** do not exist.

Coverage against the audit brief:

| Module | Required | Present | Gap |
|---|---|---|---|
| D1 Admin auth & RBAC | ✅ | ❌ | Client-side `admin`/`123456`; no roles anywhere |
| D2 Dashboard | ✅ | ⚠️ 20% | Stub; wrong data (ADM-003); no live monitor; no auto-refresh |
| D3 User management | ✅ | ❌ 0% | No list, search, filters, detail page, ban, force-logout, notes |
| D4 Deposits/Withdrawals | ✅ | ❌ 0% | Placeholder text only. **Cannot operate a cashier.** |
| D5 Game management | ✅ | ❌ 5% | Table min/max/duration only. No monitor, no history, no verify tool, no cancel-round, no maintenance mode |
| D6 Finance reports | ✅ | ❌ 0% | No reports, no date filters, no CSV export |
| D7 Merchant management | ✅ | ❌ 0% | `POST /api/merchant/test` returns hardcoded fake JSON (`server.ts:2412`) |
| D8 System & security | ✅ | ❌ 0% | No audit log UI, no settings, no announcements |
| D9 Admin UI/UX | ✅ | ⚠️ 15% | Tab bar only; no tables, pagination, modals, toasts, loading states |

**Overall admin completeness: ~4%.**

Minimum viable structure to build:
```
src/app/(admin)/admin/
├── layout.tsx                    # sidebar + RBAC guard + audit banner
├── dashboard/page.tsx
├── users/page.tsx  ·  users/[id]/page.tsx        # tabs: wallet | transactions | bets | logins | KYC | notes
├── finance/deposits/page.tsx  ·  finance/withdrawals/page.tsx
├── finance/reports/commission/page.tsx           # 5% only
├── finance/reports/tie-revenue/page.tsx          # 100% only — MUST be separate
├── finance/reports/combined/page.tsx  ·  finance/reports/player-pl/page.tsx
├── games/live/page.tsx  ·  games/rounds/page.tsx  ·  games/rounds/[id]/page.tsx
├── games/verify/page.tsx                         # provably-fair verifier
├── games/settings/page.tsx
├── merchants/page.tsx  ·  merchants/[id]/page.tsx
└── system/audit-logs/page.tsx  ·  system/settings/page.tsx  ·  system/announcements/page.tsx
```

- **Impact:** The business is not operable. No deposit can be approved, no withdrawal paid, no dispute resolved.

---

### 🔴 FRONTEND

---

#### **UI-001 — Timer is a purely local countdown with no server synchronisation**
- **Severity:** HIGH · **Priority:** P1
- **Files:** `src/components/GameTable.tsx` (2,269 LOC), `src/components/OneOnOneArena.tsx` (2,494 LOC); server emits `TIMER_TICK` once per second (`server.ts:1128`)

**Description.** The server broadcasts a bare `secondsRemaining` integer every second. There is no `endsAt` timestamp, so a client that suspends (mobile background tab), drops a packet, or lags shows a wrong timer and lets the player attempt a bet after the window has closed — which then fails server-side with a confusing error. Broadcasting a tick per second per table to every connected socket is also needlessly expensive.

**Fixed Code** — send an absolute deadline plus a clock offset; interpolate locally:
```ts
// server: emit on phase change only, not every second
io.to(`table:${slug}`).emit('round:phase', {
  roundId, phase: 'BETTING',
  endsAt: round.bettingEndAt!.toISOString(),
  serverNow: new Date().toISOString(),
});
```
```tsx
// src/hooks/useServerClock.ts
export function useServerClock(socket: Socket) {
  const offsetRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      const t0 = Date.now();
      socket.emit('time:ping', null, (serverNow: number) => {
        if (cancelled) return;
        const rtt = Date.now() - t0;
        offsetRef.current = serverNow + rtt / 2 - Date.now();   // NTP-style single-sample estimate
      });
    };
    sync();
    const id = setInterval(sync, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [socket]);
  return useCallback(() => Date.now() + offsetRef.current, []);
}

// src/hooks/useRoundTimer.ts — rAF-driven, survives tab suspension
export function useRoundTimer(endsAt: string | null, serverNow: () => number) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!endsAt) { setRemaining(0); return; }
    const end = new Date(endsAt).getTime();
    let raf = 0;
    const tick = () => {
      setRemaining(Math.max(0, (end - serverNow()) / 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [endsAt, serverNow]);
  return remaining;   // fractional seconds → smooth circular progress ring
}
```

- **Impact:** Players lose bets to a timer that disagrees with the server; unnecessary bandwidth and battery drain.

---

#### **UI-002 — Client-side state trusted as the source of truth for balance**
- **Severity:** HIGH · **Priority:** P1
- **File:** `src/App.tsx` (548 LOC) — holds the full `UserWallet` including `balance`; components mutate and display it optimistically.

**Description.** The whole user object, including the real-money balance, is fetched once and held in React state. With no auth token, a user can call `/api/wallet/:userId` for **any** `userId` and render that account. Optimistic balance updates after a bet are never reconciled against a server-authoritative push, so the displayed balance drifts from the ledger.

**Fixed Code** — server-pushed, server-authoritative wallet:
```tsx
// src/stores/wallet.store.ts
export const useWallet = create<WalletState>((set) => ({
  realBalance: null, demoBalance: null, inPlay: null, status: 'loading',
  apply: (w) => set({ ...w, status: 'ready' }),
}));

// src/hooks/useWalletSync.ts
export function useWalletSync(socket: Socket) {
  const apply = useWallet(s => s.apply);
  useEffect(() => {
    socket.on('wallet:update', apply);              // authoritative push after every settlement
    socket.emit('wallet:sync');                     // and on reconnect
    return () => { socket.off('wallet:update', apply); };
  }, [socket, apply]);
}
```
Never mutate the balance locally after placing a bet — show a pending indicator and wait for `wallet:update`.

- **Impact:** Displayed balances diverge from reality; combined with SEC-001, any account can be viewed.

---

#### **UI-003 — No reconnect handling and no active-bet recovery**
- **Severity:** HIGH · **Priority:** P1
- **File:** `src/App.tsx` — a raw `new WebSocket(...)` with no `onclose` reconnection, no backoff, no offline banner, no state resync.

**Fixed Code:**
```tsx
export function useGameSocket(getAccessToken: () => string | null) {
  const [status, setStatus] = useState<'connecting'|'online'|'reconnecting'|'offline'>('connecting');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io('/', {
      transports: ['websocket'],
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10_000,   // exponential backoff with jitter
      randomizationFactor: 0.5,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('online');
      socket.emit('session:resync');   // server replays current round, my open bets, my balance
    });
    socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));
    socket.on('disconnect', () => setStatus('offline'));
    socket.on('connect_error', (e) => { if (e.message === 'TOKEN_INVALID') refreshAccessToken(); });

    return () => { socket.close(); };
  }, [getAccessToken]);

  return { socket: socketRef.current, status };
}
```
```tsx
{status !== 'online' && (
  <div role="status" aria-live="polite"
       className="fixed inset-x-0 top-0 z-50 bg-amber-500 py-2 text-center text-sm font-semibold text-black">
    {status === 'reconnecting' ? 'Reconnecting…' : 'Connection lost — your active bets are safe'}
  </div>
)}
```
Server side, `session:resync` replays authoritative state:
```ts
socket.on('session:resync', async () => {
  const userId = socket.data.user.id;
  const [wallet, openBets, rounds] = await Promise.all([
    getWalletView(userId),
    prisma.bet.findMany({ where: { userId, status: { in: ['PENDING','MATCHED','PARTIALLY_MATCHED'] } } }),
    getLiveRoundsPublic(),
  ]);
  socket.emit('session:state', { wallet, openBets, rounds });
});
```

- **Impact:** On any network blip the player sees a frozen screen and cannot tell whether their money is at risk.

---

#### **UI-004 — No double-submit protection on Place Bet**
- **Severity:** MEDIUM · **Priority:** P1
- **File:** `src/components/GameTable.tsx` — bet buttons have no disabled/in-flight state.

Combined with the missing idempotency key (GAME-007), a double-tap places two bets.

**Fixed Code:**
```tsx
const [inFlight, setInFlight] = useState(false);
const idemKeyRef = useRef<string | null>(null);

const placeBet = useCallback(async (side: 'DRAGON' | 'TIGER', amount: string) => {
  if (inFlight || phase !== 'BETTING' || remaining <= 0.4) return;   // small guard band
  setInFlight(true);
  idemKeyRef.current ??= crypto.randomUUID();                        // stable across retries
  try {
    const res = await api.post('/game/bet',
      { tableSlug, side, amount, balanceType, roundId },
      { headers: { 'Idempotency-Key': idemKeyRef.current } });
    toast.success(`Bet placed: ${formatMoney(amount)} on ${side}`);
    idemKeyRef.current = null;
  } catch (e) {
    toast.error(humanizeError(e));                                   // keep the key so retry is safe
  } finally {
    setInFlight(false);
  }
}, [inFlight, phase, remaining, tableSlug, balanceType, roundId]);

<button
  onClick={() => placeBet('DRAGON', stake)}
  disabled={inFlight || phase !== 'BETTING' || remaining <= 0.4}
  aria-busy={inFlight}
  className="… disabled:opacity-50 disabled:cursor-not-allowed"
>
  {inFlight ? <Spinner className="h-4 w-4" /> : 'Bet Dragon'}
</button>
```

- **Impact:** Accidental double stakes, especially on mobile.

---

#### **UI-005 — Mixed Bengali/English error copy, with rule text embedded in error strings**
- **Severity:** MEDIUM · **Priority:** P2
- **Files:** `server.ts:1332` (a 180-character Bengali paragraph as an error message), `1345`, `2670`, `2687`, `2691`; `src/components/AdminLogin.tsx:15`

**Description.** API error messages are long bilingual paragraphs with emoji, mixing user-facing copy, business-rule explanation and enforcement in one string. This is untranslatable, untestable, and leaks rule detail into machine-readable responses.

**Current Code:**
```ts
return res.status(400).json({
  error: "🚫 Tie-তে বাজি ধরা সম্পূর্ণ নিষিদ্ধ। শুধুমাত্র Dragon অথবা Tiger-এ বাজি ধরুন। টাই (Tie) হলে ক্যাসিনো রুলস অনুযায়ী উভয় পক্ষের বাজি বাজেয়াপ্ত (Loss) হবে এবং সম্পূর্ণ টাকা কোম্পানি ফান্ডে যাবে।",
});
```

**Fixed Code** — stable machine codes on the wire, localised copy on the client:
```ts
// server: code + neutral English fallback only
return res.status(400).json({ error: 'Tie bets are not accepted', code: 'TIE_BET_NOT_ALLOWED' });
```
```ts
// src/i18n/errors.ts
export const ERROR_COPY: Record<string, { en: string; bn: string }> = {
  TIE_BET_NOT_ALLOWED: {
    en: 'Tie bets are not available. Choose Dragon or Tiger.',
    bn: 'টাই-তে বাজি ধরা যাবে না। ড্রাগন অথবা টাইগার বেছে নিন।',
  },
  INSUFFICIENT_FUNDS: {
    en: 'Not enough balance. Add funds to continue.',
    bn: 'পর্যাপ্ত ব্যালেন্স নেই। চালিয়ে যেতে টাকা যোগ করুন।',
  },
  BETTING_CLOSED: {
    en: 'Betting has closed for this round. Your next bet will go to the next round.',
    bn: 'এই রাউন্ডের বেটিং বন্ধ হয়ে গেছে। পরের বাজি পরবর্তী রাউন্ডে যাবে।',
  },
  OPPOSING_BET:  { en: 'You already have a bet on the other side this round.', bn: 'এই রাউন্ডে আপনি অন্য পাশে বাজি ধরেছেন।' },
  KYC_REQUIRED:  { en: 'Complete KYC verification to withdraw.',               bn: 'টাকা তুলতে KYC সম্পন্ন করুন।' },
};

export const humanizeError = (e: unknown, lang: 'en' | 'bn' = 'bn') => {
  const code = (e as any)?.response?.data?.code as string | undefined;
  return (code && ERROR_COPY[code]?.[lang]) ?? ERROR_COPY.GENERIC[lang];
};
```
Explain the tie rule **before** the bet, in the rules panel and as a persistent note on the betting surface — not in a rejection.

- **Impact:** Poor UX; impossible to localise; error strings become an untested API contract.

---

#### **UI-006 — Sound defaults to ON, violating the stated requirement**
- **Severity:** LOW · **Priority:** P2
- **Files:** `prisma/schema.prisma` → `User.soundEnabled Boolean @default(true)`; `src/utils/useSoundManager.ts` (206 LOC); `src/utils/audio.ts` (659 LOC)

**Fixed Code:**
```prisma
soundEnabled Boolean @default(false)   // Requirement: sound defaults to MUTED
```
```ts
const [muted, setMuted] = useState<boolean>(() => {
  const saved = localStorage.getItem('sound:muted');
  return saved === null ? true : saved === 'true';     // default MUTED
});
```
Also gate `AudioContext` creation behind the first user gesture — browsers block autoplay and the current code will log console errors on load.

- **Impact:** Autoplaying casino audio on page load; browser autoplay warnings.

---

#### **UI-007 — No `inputMode="decimal"` on the stake field**
- **Severity:** LOW · **Priority:** P2
- **File:** `src/components/GameTable.tsx`, `src/components/WalletModal.tsx`

**Fixed Code:**
```tsx
<input
  type="text"
  inputMode="decimal"
  pattern="[0-9]*\.?[0-9]{0,2}"
  autoComplete="off"
  enterKeyHint="done"
  value={stake}
  onChange={(e) => {
    const v = e.target.value;
    if (v === '' || /^\d{0,9}(\.\d{0,2})?$/.test(v)) setStake(v);   // keep as STRING — never parseFloat
  }}
  aria-label="Stake amount"
  className="…"
/>
```

- **Impact:** Alphabetic keyboard on mobile; float conversion at the input boundary.

---

### 🔴 DATABASE

---

#### **DB-001 — Schema is orphaned: no migrations, no client, not imported by the running app**
- **Severity:** CRITICAL · **Priority:** P0
- **Files:** `prisma/schema.prisma` (713 LOC, unused), `prisma/seed.ts` (299 LOC, unused), no `prisma/migrations/`, `@prisma/client` absent from root `package.json`

**Fix:** see FIN-001. Generate the initial migration, add the CHECK constraints, add the immutability triggers (GAME-008), and import `prisma` into the server.

---

#### **DB-002 — `Bet` unique constraint prevents legitimate multiple bets; no `DuelRoom` model exists**
- **Severity:** MEDIUM · **Priority:** P2
- **File:** `prisma/schema.prisma` → `@@unique([userId, roundId, side, balanceType])` on `Bet`

**Description.** This constraint means a player can hold only one `Bet` row per side per round. That is a reasonable design (top up via `increment`, as in GAME-007's `upsert`), but it is incompatible with FIFO price-time matching (GAME-001), because a topped-up bet carries only its original `createdAt` — so a late top-up inherits early queue priority.

Separately, the entire 1v1 duel feature (`activeDuels`, `activeRooms`, `p2pRoomsHistory`) has **no schema representation at all**. Duels are the headline feature and are 100% ephemeral.

**Fixed Code:**
```prisma
model Bet {
  // ...
  // Allow multiple orders per side so each carries its own queue timestamp.
  // Idempotency is enforced by idempotencyKey, not by this composite key.
  @@index([roundId, side, createdAt])     // the FIFO matching index
  // REMOVE: @@unique([userId, roundId, side, balanceType])
}

model DuelRoom {
  id              Int          @id @default(autoincrement())
  uuid            String       @unique @default(uuid())
  creatorId       Int
  acceptorId      Int?
  tier            TableType
  balanceType     BalanceType  @default(REAL)
  status          DuelStatus   @default(OPEN)

  creatorRole     BetSide
  creatorCardValue Int?
  creatorCardSuit  CardSuit?
  acceptorCardValue Int?
  acceptorCardSuit  CardSuit?

  creatorStake    Decimal      @db.Decimal(18, 2)
  acceptorStake   Decimal      @default(0.00) @db.Decimal(18, 2)
  pot             Decimal      @default(0.00) @db.Decimal(18, 2)
  currentRaise    Decimal      @default(0.00) @db.Decimal(18, 2)
  raisesCount     Int          @default(0)
  bettingRound    Int          @default(1)
  turnRole        BetSide?
  actionDeadline  DateTime?                       // absolute — survives restart

  serverSeedHash  String                          // committed at room creation
  serverSeedEnc   String?                         // AES-256-GCM; decrypted only at settlement
  serverSeed      String?                         // populated only AFTER settlement commits
  clientSeed      String
  nonce           Int          @default(0)

  result          RoundResult?
  foldedById      Int?
  commission      Decimal      @default(0.00) @db.Decimal(18, 2)
  tieRevenue      Decimal      @default(0.00) @db.Decimal(18, 2)
  winnerPayout    Decimal      @default(0.00) @db.Decimal(18, 2)

  createdAt       DateTime     @default(now())
  matchedAt       DateTime?
  settledAt       DateTime?

  creator         User         @relation("DuelCreator",  fields: [creatorId],  references: [id])
  acceptor        User?        @relation("DuelAcceptor", fields: [acceptorId], references: [id])
  stakes          DuelStake[]

  @@index([status, createdAt])
  @@index([creatorId])
  @@index([acceptorId])
}

model DuelStake {
  id         Int       @id @default(autoincrement())
  duelRoomId Int
  userId     Int
  amount     Decimal   @db.Decimal(18, 2)
  action     String    // STAKE, CALL, RAISE_2X, RAISE_3X, ALL_IN
  settledAt  DateTime?
  createdAt  DateTime  @default(now())

  duelRoom   DuelRoom  @relation(fields: [duelRoomId], references: [id], onDelete: Cascade)
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, settledAt])
  @@index([duelRoomId])
}

enum DuelStatus { OPEN MATCHED PEEK_CARDS BETTING SHOWDOWN SETTLED CANCELLED EXPIRED }
```

---

#### **DB-003 — No `LoginHistory`, `DeviceFingerprint`, or `IdempotencyRecord` models**
- **Severity:** MEDIUM · **Priority:** P2

**Fixed Code:**
```prisma
model LoginHistory {
  id          BigInt   @id @default(autoincrement())
  userId      Int
  ipAddress   String
  userAgent   String?
  deviceHash  String?
  country     String?
  success     Boolean
  failReason  String?
  createdAt   DateTime @default(now())

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@index([ipAddress, createdAt])
  @@index([deviceHash])
}

model DeviceFingerprint {
  id           Int      @id @default(autoincrement())
  hash         String
  userId       Int
  firstSeenAt  DateTime @default(now())
  lastSeenAt   DateTime @updatedAt
  seenCount    Int      @default(1)
  isBlocked    Boolean  @default(false)

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([hash, userId])
  @@index([hash])          // → multi-account detection: same hash, many userIds
}

model IdempotencyRecord {
  key          String   @id
  userId       Int?
  endpoint     String
  requestHash  String
  responseBody Json
  statusCode   Int
  createdAt    DateTime @default(now())
  expiresAt    DateTime

  @@index([expiresAt])     // TTL sweep job
}
```

---

### 🔴 API

---

#### **API-001 — No versioning, no consistent envelope, no correlation id, no global error handler**
- **Severity:** MEDIUM · **Priority:** P2
- **File:** `server.ts` — routes are `/api/...`; the Next.js rewrite in `frontend/next.config.js` proxies `/api/v1/*`, so **the two halves of the repo disagree on the URL scheme**.

**Fixed Code:**
```ts
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message); this.name = 'AppError';
  }
}

app.use((req, _res, next) => {
  (req as any).correlationId = req.get('x-correlation-id') ?? crypto.randomUUID();
  next();
});

const apiV1 = express.Router();
/* ... mount all routes on apiV1 ... */
app.use('/api/v1', apiV1);

// 404 for unknown API paths (must precede the SPA catch-all)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found', code: 'NOT_FOUND' }));

// Global error handler — last middleware
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const cid = (req as any).correlationId;

  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, code: err.code, details: err.details, correlationId: cid });
  }
  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR',
      details: err.issues.map(i => ({ field: i.path.join('.'), message: i.message })), correlationId: cid });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Duplicate request', code: 'DUPLICATE', correlationId: cid });
    if (err.code === 'P2034') return res.status(409).json({ error: 'Conflict — please retry', code: 'TX_CONFLICT', correlationId: cid });
  }

  logger.error({ err, cid, path: req.path, method: req.method }, 'Unhandled error');
  // Never leak internals to the client.
  return res.status(500).json({ error: 'An unexpected error occurred', code: 'INTERNAL_ERROR', correlationId: cid });
});
```

---

#### **API-002 — Transparency endpoints leak PII and internal identifiers**
- **Severity:** HIGH · **Priority:** P1
- **File:** `server.ts:2053–2148`, `1298–1309`

**Description.** `GET /api/transparency/users`, `GET /api/transparency/users/:targetUserId` and `GET /api/tables/:slug/bets` are unauthenticated and return raw `userId` values, usernames, balances and full bet records. These `userId`s are precisely the credential that SEC-001 makes sufficient for account takeover, so these endpoints are the attacker's enumeration oracle.

Transparency is a good product instinct — but it must be anonymised.

**Fixed Code:**
```ts
/** Stable per-round pseudonym: unlinkable across rounds, consistent within one. */
const maskPlayer = (userId: number, roundId: number) =>
  'P' + crypto.createHmac('sha256', process.env.DISPLAY_SALT!)
    .update(`${roundId}:${userId}`).digest('hex').slice(0, 6).toUpperCase();

app.get('/api/v1/tables/:slug/bets', async (req, res) => {
  const round = await getCurrentRound(req.params.slug);
  if (!round) return res.status(404).json({ error: 'Table not found' });

  const bets = await prisma.bet.findMany({
    where: { roundId: round.id, balanceType: 'REAL' },        // never expose demo play as liquidity
    select: { id: true, userId: true, side: true, amount: true, matchedAmount: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  res.json({
    roundNumber: Number(round.roundNumber),
    dragonPool: round.totalDragonBets.toFixed(2),
    tigerPool:  round.totalTigerBets.toFixed(2),
    bets: bets.map(b => ({
      player: maskPlayer(b.userId, round.id),     // no real userId, no username
      side: b.side,
      amount: b.amount.toFixed(2),
      matched: b.matchedAmount.toFixed(2),
      at: b.createdAt.toISOString(),
    })),
  });
});
```
Delete `GET /api/transparency/users` and `/api/transparency/users/:targetUserId` outright — a per-user drill-down for the public has no legitimate purpose.

---

#### **API-003 — Gemini AI endpoint is unauthenticated and unthrottled**
- **Severity:** MEDIUM · **Priority:** P2
- **File:** `server.ts:3334–3380`; `@google/genai` is a production dependency

**Description.** `POST /api/ai-dealer` proxies to the Gemini API on the operator's key with no auth, no rate limit and a user-influenced prompt (`tableSlug`, `lastWinner`). Anyone can run up the API bill or attempt prompt injection. An "AI dealer" also sits uncomfortably beside Rule 1 (100% real players) — it should be clearly framed as cosmetic commentary, never as a participant.

**Fixed Code:**
```ts
app.post('/api/v1/ai-dealer', requireAuth,
  rateLimit({ store: store('rl:ai:'), windowMs: 60_000, limit: 6, keyGenerator: keyByUser }),
  validate(z.object({
    tableSlug: z.enum(['express', 'classic', 'vip']),
    lastWinner: z.enum(['DRAGON', 'TIGER', 'TIE']),
  })),
  async (req, res) => {
    const ai = getGeminiClient();
    // Static fallback keeps the feature degradable and the bill bounded.
    if (!ai) return res.json({ commentary: STATIC_LINES[req.body.lastWinner], source: 'static' });

    // Enum-constrained inputs only — no free text reaches the model.
    const prompt = buildDealerPrompt(req.body.tableSlug, req.body.lastWinner);
    try {
      const out = await withTimeout(ai.models.generateContent({ model: 'gemini-2.0-flash', contents: prompt }), 2_000);
      res.json({ commentary: sanitize(out.text).slice(0, 200), source: 'ai' });
    } catch {
      res.json({ commentary: STATIC_LINES[req.body.lastWinner], source: 'static' });
    }
  });
```

---

### 🔴 PERFORMANCE

---

#### **PERF-001 — `broadcast()` sends every message to every client**
- **Severity:** HIGH · **Priority:** P1
- **File:** `server.ts:1108–1115`

**Description.** Three tables each emit a `TIMER_TICK` every second to **all** connected sockets. At 5,000 concurrent users that is 15,000 messages/sec, 95% of them irrelevant to the recipient — plus a full `JSON.stringify` per message with no payload caching.

**Fixed Code:** rooms (SEC-008) + emit on phase change rather than per second (UI-001). This reduces steady-state traffic by roughly 97%:
```ts
// Before: 3 tables × 1/s × N clients
// After:  ~4 phase events per round × clients in that table's room only
io.to(`table:${slug}`).emit('round:phase', { roundId, phase, endsAt, serverNow });
```

---

#### **PERF-002 — Unbounded in-memory arrays and a monolithic 3,393-line module**
- **Severity:** MEDIUM · **Priority:** P2
- **Files:** `server.ts:2020` (`globalTransactions`), `userBetHistories`, `p2pRoomsHistory`, `activeDuels`

**Description.** `globalTransactions` and `p2pRoomsHistory` grow without bound — a slow memory leak ending in OOM. `activeDuels` entries are never garbage-collected after settlement. (`chatMessages` and `roadmap` *are* correctly capped — good.) `server.ts` at 3,393 lines with 25+ responsibilities cannot be safely unit-tested.

**Fixed Code** — target structure:
```
src/server/
├── index.ts                    # composition root: ~80 lines
├── app.ts                      # express + middleware wiring
├── db.ts · redis.ts · logger.ts · env.ts
├── middleware/                 # auth, rbac, validate, idempotency, rate-limit, audit, error
├── modules/
│   ├── auth/                   # controller · service · schema
│   ├── wallet/
│   ├── game/                   # round.fsm · matching.engine · settlement.service · provably-fair
│   ├── duel/
│   ├── admin/
│   └── merchant/
├── realtime/                   # socket.io gateway, rooms, emitters
└── jobs/                       # bullmq: round scheduler, webhooks, recovery, cleanup
```
With history read from Postgres (paginated) rather than held in RAM.

---

#### **PERF-003 — No Redis; horizontal scaling impossible**
- **Severity:** HIGH · **Priority:** P1
- **File:** `server.ts` — no Redis client. `ioredis`, `bullmq` and `redlock` are declared in the dead `backend/package.json`.

**Fixed Code:**
```ts
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import Redlock from 'redlock';

export const redis    = new Redis({ host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD,
                                    maxRetriesPerRequest: null, enableReadyCheck: true });
export const redisSub = redis.duplicate();

// Socket.IO across N instances
io.adapter(createAdapter(redis, redisSub));

// Distributed lock so exactly one instance settles a given round
export const redlock = new Redlock([redis], { retryCount: 3, retryDelay: 200 });

export async function withRoundLock<T>(roundId: number, fn: () => Promise<T>): Promise<T> {
  const lock = await redlock.acquire([`lock:round:${roundId}`], 30_000);
  try { return await fn(); } finally { await lock.release().catch(() => {}); }
}
```

---

### 🟡 ANTI-BOT & 100% REAL PLAYERS (Section G)

| Check | Status | Evidence |
|---|---|---|
| No "Play vs Bot" / vs AI code | ✅ **PASS** | No bot opponent logic found. Duels require two real `userId`s. **Credit: the core P2P rule is respected.** |
| No bot fallback on empty queue | ✅ **PASS** | Rounds settle with zero matched volume rather than injecting a house counterparty. Correct. |
| Phone OTP on registration | ❌ **FAIL** | Signup takes username + 4-char password only (`server.ts:1604`). `User.phone` exists in the schema, unused. |
| Device fingerprinting | ❌ **FAIL** | Absent entirely. |
| One phone per account | ❌ **FAIL** | No phone collected. `@unique` on `User.phone` exists but is never exercised. |
| One device per account | ❌ **FAIL** | Absent. |
| Behaviour analysis | ❌ **FAIL** | Absent. |
| "Searching for real player…" queue UI | ⚠️ **PARTIAL** | Lobby shows open rooms; no explicit searching state with a live counter. |
| No random bot usernames injected | ⚠️ **PARTIAL** | No fake *users* are created — but **fake round history is** (GAME-003), and `server.ts:2570` assigns room sides with `Math.random()`. |

**Fixed Code** — registration with OTP, device binding and multi-account detection:
```ts
app.post('/api/v1/auth/register', registerRateLimit, validate(registerSchema), async (req, res) => {
  const { username, phone, password, otpToken } = req.body;

  if (!await verifyOtp(phone, otpToken)) {
    return res.status(400).json({ error: 'Invalid or expired verification code', code: 'OTP_INVALID' });
  }

  const deviceHash = hashDevice(req);        // UA + accept headers + client-supplied FingerprintJS id
  const linked = await prisma.deviceFingerprint.findMany({
    where: { hash: deviceHash }, select: { userId: true },
  });
  if (linked.length >= 2) {
    await prisma.auditLog.create({ data: {
      action: 'MULTI_ACCOUNT_BLOCKED', entityType: 'Device', entityId: deviceHash,
      newValues: { existingUserIds: linked.map(l => l.userId), phone: '[REDACTED]' },
      ipAddress: req.ip, userAgent: req.get('user-agent') ?? null,
    }});
    return res.status(403).json({
      error: 'This device already has the maximum number of accounts. Contact support.',
      code: 'DEVICE_LIMIT_REACHED',
    });
  }

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: {
      username: username.toLowerCase(), phone,               // @unique enforces one account per phone
      passwordHash: await bcrypt.hash(password, 12),
      role: 'PLAYER', status: 'ACTIVE', kycStatus: 'NONE',
      realBalance: 0, demoBalance: 10000,                     // demo chips only — never real money
    }});
    await tx.deviceFingerprint.create({ data: { hash: deviceHash, userId: u.id } });
    return u;
  });

  res.status(201).json(await issueTokenPair(user, req, res));
});
```
Plus a behavioural job flagging: median action latency < 250 ms sustained, fold rate > 95%, identical stake sequences across accounts, and shared device/IP clusters.

---

## 4. ADMIN PANEL AUDIT REPORT

### 4.1 Security of the Admin Panel — **0 / 10**

The admin panel has no security whatsoever. Specifically:

- **The credential is `admin` / `123456`, compared in the browser** (`src/components/AdminLogin.tsx:11`) and therefore shipped in the public JS bundle. Any player can read it with View Source.
- **The session is `sessionStorage.admin_authorized = "true"`.** Typing that in DevTools grants access. There is no token, no expiry, no server involvement.
- **The server does not care.** Every `/api/admin/*` route is a bare `app.get`/`app.post` with no middleware. `AdminLogin.tsx` could be deleted and nothing would change for an attacker using `curl`.
- **No roles exist.** The schema defines `PLAYER | MERCHANT | ADMIN | SUPER_ADMIN`; the string `SUPER_ADMIN` never appears in `server.ts`. There is no separation between a Support agent who should read-only, a Finance officer who should approve withdrawals, and a Super Admin who should adjust balances.
- **No audit logging.** Not one write to `AuditLog`.
- **No 2FA**, despite `twoFactorEnabled`/`twoFactorSecret` existing in the schema.
- **No IP allowlist**, no admin session timeout (`AutoLogoutTimer.tsx` exists but is a player-side component), no forced re-authentication for destructive actions.
- **`POST /api/database/reset` is unauthenticated** and irreversibly destroys all users, balances, transactions and metrics.

This is the most severe area of the entire audit. An admin panel with no authentication on a real-money platform is not a vulnerability — it is an open cash drawer.

### 4.2 Completeness vs a real iGaming admin — **~4%**

Measured against the D1–D9 brief, 58 of the ~62 required capabilities are absent. The panel consists of a header, five tab buttons, and one partially-rendered tab (Tables, showing a name and a non-functional power button). Two tabs render hardcoded text claiming features are *"(Active)"* when no such code exists anywhere in the repository — Chat Moderation and the Deposit/Withdrawal Queue.

The single most consequential gap: **there is no way to approve a deposit or pay a withdrawal.** Even if every security issue were fixed, the business could not take a customer's money or return it. This makes launch impossible independent of the security findings.

### 4.3 Missing features vs a JILI-style admin

Beyond the D1–D9 brief, a licensed operator of this type is expected to have:

| Domain | Missing capability |
|---|---|
| **Risk & fraud** | Collusion detection (players repeatedly facing each other with one-sided outcomes — *critical for a P2P product*), chip-dumping detection, velocity rules, exposure caps per player/table, a real-time risk alert queue |
| **Responsible gaming** | Self-exclusion workflow (`selfExcludedUntil` exists in the schema, unused), deposit/loss/session limit administration (all three columns exist, unused), reality-check prompts, an underage/vulnerable-player flag |
| **AML/compliance** | Suspicious-transaction reporting, threshold alerts, source-of-funds tracking, sanctions/PEP screening, a regulator export pack |
| **Player operations** | Segmentation, cohort analytics, retention dashboards, a support-ticket inbox, communication history, per-player session replay |
| **Game operations** | Per-table RTP/margin monitoring, round-anomaly alerting, a seed-rotation schedule and audit, an emergency "void round and refund" workflow with dual approval |
| **Finance** | Payment-provider reconciliation, chargeback handling, a settlement calendar, multi-currency FX, a manual-journal facility with maker-checker |
| **Governance** | Maker-checker (four-eyes) on all balance adjustments and withdrawals above a threshold, granular permission matrix, admin activity heatmap, quarterly access review export |

Of these, **collusion detection is the one I would call non-negotiable for this specific product.** In a pure P2P exchange with a 5% rake, two colluding accounts can transfer value between themselves at a known 5% cost while the operator sees only normal volume. With `BetMatch` records absent (GAME-001), you currently have no data with which to detect it even retrospectively.

### 4.4 UI/UX of the admin — **2 / 10**

What exists is visually consistent with the main site (dark, amber accent) and the tab bar has a correct active state. That is the extent of the positives.

Missing: data tables of any kind, search, filters, pagination, sorting, loading skeletons, empty states, error states, confirmation modals for destructive actions, toast notifications, bulk actions, keyboard navigation, breadcrumbs, and a persistent sidebar. `stats` is typed `any`, so there is no type safety on any rendered field. `fetchStats()` runs once on mount with no polling, so the "live" dashboard is a snapshot that goes stale immediately. The destructive power button on each table row triggers nothing, but if wired would fire without confirmation.

### 4.5 Finance reports accuracy — **Wrong in four independent ways**

There are no reports. The dashboard numbers that do exist are incorrect because:
1. They are **floats in RAM**, lost on restart (FIN-006).
2. They **never reset at midnight** despite being labelled `today*` — they are lifetime-since-boot totals.
3. They **mix REAL and DEMO money**, because the duel engine ignores `balanceType` (FIN-010).
4. They are **not sourced from a ledger**, so they cannot be reconciled against player balances or drilled into.

Positively, the *conceptual* separation the brief requires — commission (5%) tracked distinctly from tie revenue (100%) — is present as `todayCommission` and `todayTieRevenue`, and the `CompanyLedger.type` column encodes the same split correctly. The model is right; the implementation is unpersisted.

### 4.6 Audit logging coverage — **0%**

The `AuditLog` model is well-designed and complete: `userId`, `action`, `entityType`, `entityId`, `oldValues`, `newValues`, `ipAddress`, `userAgent`, `createdAt`, with sensible indexes. It is never written to. Zero rows, ever. Combined with mutable game history (GAME-008) and unlogged balance adjustments (FIN-008), there is no mechanism to detect or prove insider fraud.

### 4.7 Suggestions — cleaner, faster, more professional

**Architecture.** Build the admin as a separate Next.js App Router surface (`frontend/` already has the dependency set: Radix UI, zustand, Recharts). Use React Server Components for the data-heavy list pages so filtering and pagination happen in Postgres, not the browser. A single `<DataTable>` primitive (TanStack Table) with server-side pagination, URL-synced filter state, column visibility and CSV export should back every list in the panel — users, deposits, withdrawals, rounds, audit logs. Build it once.

**Layout.** Persistent left sidebar grouped as Overview / Players / Finance / Games / Merchants / System, with the active route highlighted and the operator's role badge pinned at the bottom. A top bar carrying global search (jump to user by id/username/phone/email), a pending-actions counter (deposits + withdrawals awaiting approval), and the logged-in admin with a visible session timer.

**Safety ergonomics.** Every destructive action behind a confirmation dialog that requires typing the entity name, plus a mandatory free-text reason of ≥10 characters that is written to `AuditLog`. Balance adjustments and withdrawals above a configurable threshold should require maker-checker: one admin proposes, a second approves, both recorded.

**Real-time.** Put the admin on the same Socket.IO connection in an `admin` room. Push live round state, new deposit/withdrawal requests and risk alerts rather than polling. Fall back to a 10-second `revalidate` for aggregate tiles.

**Performance.** Pre-aggregate daily revenue into a `DailyRevenueSnapshot` table via a nightly job so reports over long ranges do not scan the full `CompanyLedger`. Add covering indexes for the common admin filters (`status + createdAt` already exists on both request tables — good).

**Visual polish.** Reduce the amber to a single accent used only for primary actions and active nav; the current all-amber headline styling reads as a template. Use a neutral slate scale for surfaces, semantic colour strictly for state (emerald = approved, amber = pending, red = rejected). Tabular figures (`font-variant-numeric: tabular-nums`) for all money columns, right-aligned, with the currency symbol in a muted tone. This alone makes a finance table look professionally built.

---

## 5. SITE IMPROVEMENTS SUGGESTION

### A) UI/UX Improvements

1. **Cut the game screen down.** `GameTable.tsx` is 2,269 lines and `OneOnOneArena.tsx` is 2,494 — both render far too much at once. The betting surface needs exactly four things in the primary viewport: the timer, the two side buttons with live pools, the stake control, and the player's own position. Everything else (roadmap, live feed, chat, leaderboard, stats) belongs in collapsible panels or a tab strip below the fold.
2. **Make the real/demo distinction unmissable.** Currently `balanceType` is a string toggle. Demo mode should change the *frame* of the app: a persistent slate-blue border around the viewport, a "DEMO — play money" pill locked next to the balance, and demo chips rendered in a desaturated palette. A player must never be able to wonder which mode they are in.
3. **Mobile: promote the betting panel to a bottom sheet.** `MobileBottomNav.tsx` and `MobileModalWrapper.tsx` exist as building blocks. The sheet should be reachable with the thumb, snap to two heights (collapsed showing balance + quick bet, expanded showing full controls), and never be covered by the OS keyboard when the stake field is focused.
4. **Show the matching state in plain language.** Replace internal terms with a single sentence that updates live: *"You bet ৳500 on Dragon. ৳320 matched against 2 players. ৳180 waiting — it will be refunded if nobody takes it."* Add a thin progress bar from matched → total. This is the single highest-value copy change in the product, because partial matching is the concept players most often misunderstand on an exchange.
5. **Add a visible Cancel Unmatched control** during `BETTING`, showing the exact refundable amount.
6. **Roadmap/bead road: label it honestly.** Keep the Baccarat-style grid (it is genuinely expected by this audience) but show only real completed rounds, and when history is empty say so rather than filling it with invention (GAME-003).
7. **Result banner with the money on it.** DRAGON WINS / TIGER WINS / TIE as a full-width band, and directly beneath it the player's own outcome in currency: `+৳950` in emerald or `−৳500` in red, with the matched/unmatched breakdown one tap away.

### B) User Experience Improvements

1. **Onboarding:** phone → OTP → username → password, three screens, with the demo table playable immediately and no deposit prompt until the player has completed at least one demo round.
2. **Human-readable errors** via the `code` → localised copy map in UI-005. Every error should say what happened *and* what to do next.
3. **Reconnect banner + automatic state resync** (UI-003), with explicit reassurance that open bets are safe — this is what players actually panic about.
4. **Active-bet recovery on reload.** On mount, `session:resync` restores the current round, the player's open positions and the authoritative balance.
5. **Bet confirmation for large stakes.** Above a configurable threshold (say 20% of balance), require a second tap. Cheap to build, prevents the most common support ticket.
6. **Repeat Last Bet / Double Last Bet** chips — `User.lastBetAmount` already exists in the schema.
7. **A real transaction history page** with type filter, date range, running balance and CSV export. `Transaction.balanceBefore`/`balanceAfter` make the running balance trivial to render and are exactly what a disputing player asks for.

### C) Conversion & Trust Improvements

1. **A persistent, honest trust bar** under the header: `100% Real Players · Provably Fair (HMAC-SHA512) · 5% Transparent Fee · Instant Unmatched Refund`. Each item links to a short proof page — not marketing copy.
2. **Make provably-fair verifiable in one click.** `ProvablyFairModal.tsx` (256 LOC) is a good start. Add, on every settled round in history, a "Verify" button that shows `serverSeedHash` (published before), `serverSeed` (revealed after), `clientSeed`, `nonce`, the resulting HMAC, and the derived cards — plus a copy-paste snippet the player can run themselves. Offer a third-party verifier link.
3. **Show the fee before the bet, not after.** On the bet slip: *"If you win: ৳950 (stake ৳500 × 1.9). Platform fee 5% is taken from the matched pool."* Transparency about the rake is a conversion *advantage* against opaque competitors — lead with it.
4. **Explain the tie rule up front,** prominently and calmly, on the betting surface and in the rules panel. Currently a player only learns about it via a 180-character error message or after losing (UI-005). This is the rule most likely to generate anger and chargebacks; surfacing it pre-bet is both fairer and commercially safer.
5. **Live "real players online" counter** derived from actual authenticated socket connections — and never inflated. If the number is small, showing it honestly still beats being caught inflating it.
6. **Publish the commission ledger in aggregate.** A public page showing total matched volume and total fees collected per day, sourced from `CompanyLedger`, would be genuinely differentiating for a P2P exchange and costs almost nothing to build once FIN-006 is done.

### D) Performance Improvements

1. **Socket rooms + phase-based events** instead of global per-second broadcast (PERF-001, UI-001) — roughly a 97% reduction in steady-state messages.
2. **Redis adapter** for multi-instance Socket.IO, plus Redlock for single-settler guarantees (PERF-003).
3. **Code-split the heavy components.** `GameTable.tsx`, `OneOnOneArena.tsx`, `WalletModal.tsx` and `TransparencyCharterModal.tsx` total ~5,900 lines and are almost certainly all in the initial bundle. Lazy-load every modal with `React.lazy` + `Suspense`.
4. **Cache aggregate reads in Redis** with short TTLs: table list 2s, leaderboard 30s, roadmap 5s, dashboard tiles 10s.
5. **Paginate all history endpoints** (cursor-based on `createdAt, id`). `GET /api/wallet/:userId/history` currently returns everything.
6. **Add DB indexes for the hot paths** — most already exist in the schema; add `Bet(roundId, side, createdAt)` for FIFO matching (DB-002).
7. **Replace the 1-second `setInterval` game loop** with BullMQ delayed jobs (GAME-004) — durable, distributable, and no busy-wait across three tables.

### E) Professional Look Improvements

The current design reads as AI-generated for four identifiable reasons, all fixable:

1. **Emoji in production UI and API responses** (🚫 in error strings, 🔒 on the admin login button). Remove every one. Use Lucide icons — already a dependency.
2. **Gradient overuse.** `bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600` on primary buttons, plus gradients on cards and headers. Premium casino UI uses flat, confident surfaces with one accent; gradients are reserved for a single hero element at most.
3. **Inconsistent type scale.** The codebase mixes `text-[11px]`, `text-xs`, `text-sm`, `text-lg`, `text-3xl` with `font-black` and `font-bold` applied semi-randomly. Define a six-step scale (`display / h1 / h2 / body / small / micro`) with one weight per step and use nothing else.
4. **Everything is amber.** A single accent applied to headings, buttons, borders, icons and active states flattens the hierarchy. Use a neutral slate scale for 90% of the surface, amber strictly for primary actions, and semantic colour only for state.

Concretely, adopt a design-token layer:
```ts
// src/design/tokens.ts
export const tokens = {
  surface: { base: '#0A0C10', raised: '#12151C', overlay: '#1A1E27', border: '#232834' },
  brand:   { primary: '#D4A017', primaryHover: '#E8B923', onPrimary: '#0A0C10' },
  side:    { dragon: '#C4453B', tiger: '#2F7BC4' },     // distinguishable for red-green colour blindness
  state:   { win: '#2E9E6B', loss: '#C4453B', pending: '#D4A017', info: '#4A7FB5' },
  text:    { primary: '#F0F2F5', secondary: '#9BA3B0', muted: '#6B7280' },
  radius:  { sm: '6px', md: '10px', lg: '14px' },
  type: {
    display: 'text-2xl font-semibold tracking-tight',
    h1:      'text-xl font-semibold',
    h2:      'text-base font-medium',
    body:    'text-sm font-normal',
    small:   'text-xs font-normal',
    money:   'text-sm font-medium tabular-nums',         // tabular figures for ALL currency
  },
} as const;
```
Two further details that disproportionately signal quality: **tabular numerals on every money value** (so digits do not jitter as balances update), and **a single easing curve** (`cubic-bezier(0.22, 1, 0.36, 1)`) applied to all transitions, with card flips at 400ms and UI state changes at 150ms. Respect `prefers-reduced-motion`.

---

## 6. PRIORITY ACTION PLAN

### ⚠️ Prerequisite: a realistic assessment of scope

The brief asks for a 24–72 hour Phase 1. I have to be straight with you: **that timeline is not achievable for this codebase, and pretending otherwise would be the least useful thing I could do.**

The reason is not the number of bugs — it is that **the money layer does not exist**. There is no database wired in, no auth, no transactions, no ledger. These are not fixes; they are the foundation, and they must be built before any of the 40 issues above can even be verified as fixed. Rewriting `server.ts`'s 3,393 lines onto Prisma with atomic transactions, then testing it to a standard where you would trust it with customer deposits, is **4–6 weeks of focused work for 2–3 experienced engineers**, plus an external security review before real money.

I have kept your phase structure and named what genuinely fits in each window.

---

### PHASE 0 — STOP THE BLEEDING (today, 2–4 hours)

Do this before anything else if any instance is publicly reachable.

| # | Action | File |
|---|---|---|
| 0.1 | **Take the public deployment offline.** Do not accept a single real deposit. | infra |
| 0.2 | Delete `POST /api/database/reset` | `server.ts:3287` |
| 0.3 | Delete `POST /api/wallet/action` and `POST /api/wallet/transfer` | `server.ts:2150`, `2219` |
| 0.4 | Delete the login auto-registration branch | `server.ts:1688–1710` |
| 0.5 | Delete `GET /api/transparency/users` and `/users/:targetUserId` | `server.ts:2082`, `2119` |
| 0.6 | Remove the hardcoded admin credential; disable the admin route entirely until rebuilt | `src/components/AdminLogin.tsx:11` |
| 0.7 | Rotate every secret in `.env.example`; replace with `CHANGE_ME_*` placeholders | `.env.example` |
| 0.8 | Remove the *"(Active)"* labels from unimplemented admin tabs | `src/components/AdminDashboard.tsx:47–48` |

---

### PHASE 1 — FOUNDATION: make money real (Weeks 1–2) — *blocks everything*

| # | Task | Issues resolved |
|---|---|---|
| 1.1 | Install Prisma + Decimal; generate the initial migration; add CHECK constraints and immutability triggers | FIN-001, DB-001, GAME-008 |
| 1.2 | Build `wallet.service.ts`: atomic `debit`/`credit` with affected-rows guard, `Transaction` rows, idempotency | FIN-002 |
| 1.3 | Build auth: bcrypt(12), access/refresh JWT, rotation + reuse detection, `Session` persistence | SEC-001, SEC-003, SEC-004, SEC-005 |
| 1.4 | `requireAuth` + `requireRole` on **every** mutating route; remove all `req.body.userId` identity | SEC-001, SEC-002 |
| 1.5 | Replace all float money with `Prisma.Decimal`; delete every `Math.floor`/`toFixed` from financial paths; raise `minBet` to 10.00 | FIN-005 |
| 1.6 | Write `CompanyLedger` entries for commission and tie revenue inside settlement | FIN-006 |
| 1.7 | **Delete the referral rev-share engine** + add the CI guard script | FIN-007 |
| 1.8 | Deposit/withdrawal request→approve flows with KYC gate and double-approval protection | FIN-003 |
| 1.9 | Helmet, CORS allowlist, cookie-parser, body limits, Zod on every POST/PATCH, env validation that fails closed | SEC-006, SEC-007, SEC-009, SEC-010 |
| 1.10 | `AuditLog` middleware on all admin mutations | ADM-002 |

**Exit criterion:** a scripted concurrency test — 100 parallel bets from one account with a balance sufficient for 10 — results in exactly 10 accepted bets, a balance of exactly zero, 10 `Transaction` rows, and no negative balance. Until this passes, do not proceed.

---

### PHASE 2 — GAME CORRECTNESS (Weeks 2–3)

| # | Task | Issues resolved |
|---|---|---|
| 2.1 | FIFO matching engine with self-match prevention, partial fills, persisted `BetMatch` rows | GAME-001 |
| 2.2 | Settlement in a single `Serializable` transaction; seed revealed **only after commit** | GAME-002 |
| 2.3 | Persisted round FSM with `WAITING`, guarded transitions, BullMQ scheduling, boot-time orphan recovery | GAME-004 |
| 2.4 | **Delete `generateInitialRoadmap()`**; serve only real completed rounds | GAME-003 |
| 2.5 | Per-player card privacy in the table game | GAME-005 |
| 2.6 | Remove the 8× Tie branch; narrow `BetSide` to `DRAGON \| TIGER` | GAME-006 |
| 2.7 | Idempotency + round binding + in-transaction phase re-check on bet placement | GAME-007 |
| 2.8 | `DuelRoom`/`DuelStake` models; duel engine on Prisma with per-duel committed seeds, `balanceType` respected, ALL_IN capped, 3-raise cap | FIN-010, FIN-011, GAME-009, DB-002 |
| 2.9 | Socket.IO with JWT handshake, rooms, server-derived chat identity | SEC-008, PERF-001 |
| 2.10 | Redis: adapter, Redlock, rate-limit store | PERF-003 |

**Exit criterion:** a 10,000-round simulation in which, for every round, `Σ payouts + commission + tieRevenue + Σ refunds == Σ stakes` to the paisa, and `CompanyLedger.balanceAfter` forms an unbroken chain.

---

### PHASE 3 — ADMIN PANEL (Weeks 3–5) — *blocks launch*

| # | Task |
|---|---|
| 3.1 | Admin auth: bcrypt + mandatory TOTP + IP allowlist + 15-min idle timeout + RBAC (SUPPORT / FINANCE / ADMIN / SUPER_ADMIN) |
| 3.2 | Shared `<DataTable>` primitive: server-side pagination, filters, URL-synced state, CSV export |
| 3.3 | Dashboard sourced from `CompanyLedger` with real day boundaries and REAL-only figures (ADM-003) |
| 3.4 | User management: list, search, filters, detail page (wallet / transactions / bets / logins / KYC / notes), ban/suspend, force-logout, balance adjust with mandatory reason + maker-checker (FIN-008) |
| 3.5 | Deposits & withdrawals queues: approve/reject with note, KYC gate, double-approval protection, processor attribution |
| 3.6 | Game management: live monitor, round history, round detail with full provably-fair data, in-admin verifier, table settings, cancel-round with reason + audit, maintenance mode |
| 3.7 | Finance reports: commission (5%) and tie revenue (100%) **as separate reports**, combined, player P&L, deposit/withdrawal summary, date-range filters, CSV export |
| 3.8 | Merchant management: CRUD, API key generation and rotation, IP allowlist, webhook config, API logs, settlement report |
| 3.9 | System: audit-log viewer with filters, settings, announcements |

---

### PHASE 4 — ANTI-FRAUD, COMPLIANCE & FRONTEND (Weeks 5–6)

| # | Task | Issues |
|---|---|---|
| 4.1 | Phone OTP registration, device fingerprinting, one-phone-per-account, multi-account detection | Section G |
| 4.2 | **Collusion detection** for the P2P book — repeated counterparty pairs with one-sided flow | §4.3 |
| 4.3 | KYC submission + admin verification; AES-256-GCM on documents and bank details; remove auto-verify | SEC-011 |
| 4.4 | Responsible gaming: self-exclusion, deposit/loss/session limits (schema columns already exist) | §4.3 |
| 4.5 | Pino logging with PII redaction; replace all 46 `console.*` | SEC-011 |
| 4.6 | Server-synced timer, reconnect banner, active-bet recovery, double-submit protection | UI-001, UI-003, UI-004 |
| 4.7 | Server-authoritative wallet via socket push | UI-002 |
| 4.8 | Error code → localised copy map; remove emoji from API responses | UI-005 |
| 4.9 | Sound defaults to MUTED; `inputMode="decimal"` on money inputs | UI-006, UI-007 |
| 4.10 | `strict: true` in root tsconfig; eliminate the 35 `any` annotations | SEC-010 |

---

### PHASE 5 — HARDENING & LAUNCH READINESS (Weeks 6–8)

| # | Task |
|---|---|
| 5.1 | Test suite: unit tests for money maths and the matching engine; integration tests for settlement; a concurrency suite; the reconciliation invariant as a property test |
| 5.2 | Decompose `server.ts` into the module structure in PERF-002; delete the dead `backend/` and `frontend/` skeletons or complete the migration into them |
| 5.3 | Load test: 5,000 concurrent sockets, 500 bets/sec sustained |
| 5.4 | **Independent third-party penetration test and provably-fair certification** — non-negotiable before real money |
| 5.5 | Observability: Prometheus metrics, Sentry, alerting on settlement failure, ledger imbalance, and negative-balance attempts |
| 5.6 | Operational runbooks: incident response, round-cancellation procedure, disaster recovery, PITR backups with a tested restore |
| 5.7 | Legal: licence, T&Cs, privacy policy, AML programme, jurisdiction geoblocking |

---

### Honest timeline summary

| Phase | Duration | Gate |
|---|---|---|
| Phase 0 | Today, 2–4 h | Nothing exploitable is reachable |
| Phase 1 | Weeks 1–2 | Concurrency test passes |
| Phase 2 | Weeks 2–3 | Reconciliation invariant holds over 10k rounds |
| Phase 3 | Weeks 3–5 | An operator can run a full deposit→play→withdraw cycle |
| Phase 4 | Weeks 5–6 | Fraud controls and compliance in place |
| Phase 5 | Weeks 6–8 | External pentest passed |

**Earliest responsible real-money soft launch: ~8 weeks** with 2–3 experienced engineers. A closed beta with capped stakes (max ৳500) and a hand-picked user group could begin after Phase 3, around week 5, with the explicit understanding that fraud controls are not yet complete.

---

## 7. PROMPT TO FIX ALL ISSUES

> Copy everything below into a fresh agent session, together with `AUDIT_REPORT.md`.

---

```
# ROLE
You are a Senior Backend Engineer specialising in real-money iGaming platforms.
You are fixing the Dragon Tiger P2P v2 codebase against the findings in AUDIT_REPORT.md.

# CONTEXT
Repository: joypaykassma-dotcom/v2
Read AUDIT_REPORT.md in the repository root FIRST, completely, before writing any code.

The repository contains THREE codebases:
  A. /server.ts + /src/**   → Vite + React 19 + Express + ws. ALL STATE IN MEMORY. This is the live app.
  B. /backend/**            → Fastify + Prisma skeleton. Config/middleware/utils only. Does NOT run.
  C. /frontend/**           → Next.js skeleton. Empty. Does NOT run.

prisma/schema.prisma (713 lines, 22 models) is CORRECT and is your target data model.
It is currently orphaned: no migrations, no @prisma/client in the root package.json,
never imported by server.ts.

# ABSOLUTE BUSINESS RULES — never violate, and actively remove any code that does
1.  100% REAL PLAYERS ONLY. No bots, AI opponents, house players, or fabricated liquidity.
    This includes fabricated ROUND HISTORY (see GAME-003).
2.  ZERO MONETARY BONUSES. No welcome/deposit bonus, cashback, referral commission,
    free bet, promo code, or prize pool. DELETE such code — never merely disable it.
3.  PURE P2P. Players bet against each other, never against the house.
4.  COMMISSION = 5% of the TOTAL MATCHED POOL on decided rounds (Win/Loss/Fold).
5.  TIE = 100% of the TOTAL MATCHED POOL to the company.
6.  PAYOUT = matched_amount x 1.9
7.  FOLD = the folding player loses all bets in that round/pot.
8.  UNMATCHED bets are fully refunded at betting close.
9.  PROVABLY FAIR: HMAC-SHA512. Publish serverSeedHash BEFORE the round.
    Reveal serverSeed ONLY AFTER the settlement transaction has COMMITTED.
10. ALL MONEY uses Prisma.Decimal / Decimal(18,2).
    NEVER Number, parseFloat, toFixed, Math.floor or Math.round in financial calculations.
    Money crosses API boundaries as a STRING.
11. Each player sees ONLY their own card until the reveal phase.
12. MAX 3 RAISES PER HAND. AUTO-FOLD after 15 seconds of inactivity.

# EXECUTION ORDER — strictly sequential. Do not start a phase until the previous one's gate passes.

## PHASE 0 — Stop the bleeding (do first, in one commit)
Delete outright:
  - server.ts:3287  POST /api/database/reset
  - server.ts:2150  POST /api/wallet/action
  - server.ts:2219  POST /api/wallet/transfer
  - server.ts:1688-1710  the login auto-registration branch
  - server.ts:2082, 2119  the /api/transparency/users endpoints
  - src/components/AdminLogin.tsx:11  the hardcoded "admin"/"123456" comparison
Replace all secrets in .env.example with CHANGE_ME_RUN_openssl_rand_hex_32.
Remove the "(Active)" labels from unimplemented admin tabs (AdminDashboard.tsx:47-48).

## PHASE 1 — Foundation (blocks everything else)
FIN-001, DB-001, GAME-008 — wire Prisma; create the initial migration;
  add CHECK constraints (non-negative balances) and immutability triggers
  (GameRound, Bet, append-only CompanyLedger and AuditLog).
FIN-002 — src/server/services/wallet.service.ts with debit()/credit():
  atomic conditional UPDATE, assert affected rows == 1, write a Transaction row
  carrying balanceBefore/balanceAfter, enforce idempotencyKey.
SEC-001/003/004/005 — bcrypt cost 12; access JWT 15m (memory only);
  refresh 7d in an httpOnly + Secure + SameSite=Strict cookie;
  rotation with reuse detection that revokes ALL sessions for that user.
SEC-002 — requireAuth + requireRole on every mutating route.
  Identity comes ONLY from req.auth. Never from req.body.
FIN-005 — replace all float money with Prisma.Decimal. Raise minBet to 10.00.
FIN-006 — write CompanyLedger rows for COMMISSION and TIE_REVENUE inside settlement.
FIN-007 — DELETE the referral rev-share engine entirely
  (server.ts:147-200, 1807-1899, the settlement accrual block, ReferralModal.tsx,
   the ReferralEarning model, the REFERRAL_BONUS enum member, REFERRAL_COMMISSION_RATE).
  Add scripts/check-no-bonuses.sh to CI.
FIN-003 — deposit/withdrawal request -> admin approve flows, KYC gate,
  double-approval impossible via conditional status update.
SEC-006/007/009/010 — helmet, CORS allowlist, rate limits, Zod on every
  POST/PATCH/PUT, env validation that exits non-zero on bad config.
ADM-002 — AuditLog middleware on every admin mutation.

GATE: 100 parallel bets from an account funded for 10 must yield exactly 10 accepted
bets, a final balance of exactly 0, 10 Transaction rows, and no negative balance.

## PHASE 2 — Game correctness
GAME-001 — FIFO matching (price-time priority), self-match prevention,
  partial fills, persisted BetMatch rows.
GAME-002 — settlement in ONE Serializable transaction; reveal the seed only
  after commit; redact serverSeed from every read endpoint until COMPLETED.
GAME-004 — persisted FSM WAITING->BETTING->MATCHING->DEALING->SETTLING->COMPLETED,
  guarded transitions, BullMQ scheduling, boot-time orphan recovery.
GAME-003 — DELETE generateInitialRoadmap(); serve only real COMPLETED rounds;
  render an honest empty state.
GAME-005 — per-player card privacy in the table game.
GAME-006 — remove the 8x Tie branch; narrow BetSide to 'DRAGON' | 'TIGER'.
GAME-007 — idempotency, round binding, in-transaction phase re-check on bet placement.
FIN-010/011, GAME-009, DB-002 — DuelRoom/DuelStake models; per-duel committed seeds;
  respect balanceType; cap ALL_IN at the opponent's stack; enforce max 3 raises
  (counting ALL_IN); persist actionDeadline as an absolute timestamp.
SEC-008, PERF-001 — Socket.IO with a JWT handshake, rooms (table:<slug>, user:<id>),
  server-derived chat identity.
PERF-003 — Redis adapter, Redlock, rate-limit store.

GATE: 10,000 simulated rounds in which every round satisfies
  sum(payouts) + commission + tieRevenue + sum(refunds) == sum(stakes)
exactly, and CompanyLedger.balanceAfter forms an unbroken chain.

## PHASE 3 — Admin panel (see section 4 of AUDIT_REPORT.md)
Build D1-D9 in full. Admin auth with mandatory TOTP, IP allowlist, idle timeout,
and RBAC (SUPPORT / FINANCE / ADMIN / SUPER_ADMIN).
Commission (5%) and Tie Revenue (100%) MUST be separate reports.
Every destructive action: confirmation dialog + mandatory reason (>=10 chars) + AuditLog.
Balance adjustments and large withdrawals: maker-checker (two distinct admins).

## PHASE 4 — Anti-fraud, compliance, frontend
Section G: phone OTP, device fingerprinting, one phone per account, multi-account detection.
Collusion detection over BetMatch (repeated counterparty pairs with one-sided flow).
SEC-011: real KYC flow, AES-256-GCM on documents and bank details, remove auto-verify,
  pino with PII redaction, replace all 46 console.* calls.
UI-001 to UI-007 as specified in the report.
Set "strict": true in the root tsconfig.json and remove all 35 `any` annotations.

## PHASE 5 — Hardening
Tests (unit / integration / concurrency / property), decompose server.ts per PERF-002,
load test, observability, runbooks.

# WORKING RULES
- Work phase by phase. After each phase, run `npx tsc --noEmit` and the test suite;
  report what passed and what failed before continuing.
- Do not break working behaviour. The provably-fair card derivation
  (server.ts:39-101) is CORRECT — preserve its algorithm exactly when porting.
  The settlement economics (5% of 2M; tie captures 2M; fold pays pot minus 5%)
  are CORRECT — preserve the maths, change only the numeric type.
- backend/src/utils/decimal.ts and crypto.ts are good. Reuse them; do not rewrite them.
- Never invent a file path. If a file referenced in the report does not exist, say so.
- Every financial code path must be covered by a test before you call it done.
- If a required fix conflicts with an absolute business rule, STOP and ask.
- Commit per issue ID with messages like: `fix(FIN-002): atomic balance mutations`.

# DELIVERABLE PER PHASE
1. Files created/modified/deleted, with issue IDs.
2. `npx tsc --noEmit` output.
3. Test results, including the phase gate.
4. Anything you could not fix, and why.
```

---

## APPENDIX — Issue index

| ID | Severity | Pri | Title |
|---|---|---|---|
| SEC-001 | CRITICAL | P0 | No authentication system exists |
| SEC-002 | CRITICAL | P0 | Admin password hardcoded client-side; admin APIs unprotected |
| SEC-003 | CRITICAL | P0 | SHA-256 password hashing instead of bcrypt |
| SEC-004 | CRITICAL | P0 | Login auto-registers any password for existing accounts |
| SEC-005 | HIGH | P0 | No refresh-token rotation or reuse detection |
| SEC-006 | HIGH | P0 | No rate limiting |
| SEC-007 | HIGH | P1 | No Helmet, CORS, CSRF defence, or body limits |
| SEC-008 | HIGH | P1 | WebSocket unauthenticated; global broadcast |
| SEC-009 | HIGH | P0 | Committed default secrets used as silent fallbacks |
| SEC-010 | MEDIUM | P1 | No runtime validation; `strict` disabled |
| SEC-011 | HIGH | P1 | KYC auto-approved; no PII encryption or log redaction |
| FIN-001 | CRITICAL | P0 | No database — balances in RAM |
| FIN-002 | CRITICAL | P0 | Non-atomic balance mutations, no ledger, no idempotency |
| FIN-003 | CRITICAL | P0 | Deposit endpoint mints money |
| FIN-004 | CRITICAL | P0 | Transfer endpoint drains accounts and fabricates recipients |
| FIN-005 | CRITICAL | P0 | Float money; payouts truncated to integers |
| FIN-006 | CRITICAL | P0 | CompanyLedger never written |
| FIN-007 | CRITICAL | P0 | Referral cash commission violates Rule 2 |
| FIN-008 | CRITICAL | P0 | Admin balance adjust: no reason, no audit |
| FIN-009 | HIGH | P1 | No in-play balance tracking |
| FIN-010 | HIGH | P1 | Duel engine ignores REAL/DEMO separation |
| FIN-011 | HIGH | P1 | ALL_IN has no side-pot logic |
| GAME-001 | CRITICAL | P0 | Pro-rata matching, not FIFO; no BetMatch records |
| GAME-002 | CRITICAL | P0 | Server seed revealed before commit |
| GAME-003 | CRITICAL | P0 | Fabricated round history (`Math.random()`) |
| GAME-004 | CRITICAL | P0 | setTimeout FSM; no WAITING; no crash recovery |
| GAME-005 | HIGH | P1 | Both cards broadcast to all (violates Rule 11) |
| GAME-006 | HIGH | P1 | Dead house-banked 8× Tie bet |
| GAME-007 | HIGH | P1 | No duplicate-bet prevention; late-bet race |
| GAME-008 | HIGH | P1 | History mutable after COMPLETED |
| GAME-009 | MEDIUM | P2 | Raise cap does not match Rule 12 |
| ADM-001 | CRITICAL | P0 | Admin dashboard is a 67-line stub |
| ADM-002 | CRITICAL | P0 | AuditLog never written |
| ADM-003 | HIGH | P1 | Dashboard figures from volatile RAM, never reset |
| ADM-004 | CRITICAL | P0/P1 | Seven admin modules missing entirely |
| UI-001 | HIGH | P1 | Timer not server-synced |
| UI-002 | HIGH | P1 | Client-side balance treated as truth |
| UI-003 | HIGH | P1 | No reconnect or active-bet recovery |
| UI-004 | MEDIUM | P1 | No double-submit protection |
| UI-005 | MEDIUM | P2 | Mixed-language rule text in error strings |
| UI-006 | LOW | P2 | Sound defaults ON |
| UI-007 | LOW | P2 | No `inputMode="decimal"` |
| DB-001 | CRITICAL | P0 | Schema orphaned; no migrations |
| DB-002 | MEDIUM | P2 | Bet unique constraint vs FIFO; no DuelRoom model |
| DB-003 | MEDIUM | P2 | No LoginHistory / DeviceFingerprint / Idempotency models |
| API-001 | MEDIUM | P2 | No versioning, envelope, or global error handler |
| API-002 | HIGH | P1 | Transparency endpoints leak PII and userIds |
| API-003 | MEDIUM | P2 | Gemini endpoint unauthenticated and unthrottled |
| PERF-001 | HIGH | P1 | Global broadcast to every client |
| PERF-002 | MEDIUM | P2 | Unbounded arrays; 3,393-line monolith |
| PERF-003 | HIGH | P1 | No Redis; cannot scale horizontally |

**Total: 51 issues — 20 CRITICAL, 17 HIGH, 9 MEDIUM, 2 LOW, 3 informational.**
