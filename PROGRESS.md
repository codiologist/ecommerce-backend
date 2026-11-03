# ecommerce-backend — Progress

| Phase                     | Status                                       |
| ------------------------- | -------------------------------------------- |
| 0. Setup (backend)        | ✅ Done (2026-11-03)                         |
| 1. Auth & Users (backend) | ✅ Done (2026-11-03) — frontend part pending |
| 2–10                      | ⏳ Not started                               |

---

## Phase 0 — Setup (backend)

### Built

- **Project:** ESM (`"type": "module"`), Node `>=26` (`.nvmrc` = 26), exact version pins + `package-lock.json`.
- **TypeScript:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `nodenext`.
- **Lint/format:** ESLint 10 flat config (`typescript-eslint` strict + stylistic type-checked, `import-x/order`,
  `no-console`, and a ban on `$queryRawUnsafe` / `$executeRawUnsafe`), Prettier, Husky pre-commit
  (`lint-staged` + type-check).
- **Env:** `src/config/env.ts` validates every variable with Zod at startup. The app refuses to start if
  anything is invalid and prints variable names only, never values. CORS origins must be exact origins with
  no wildcard, and https in production. Phase 1+ variables are optional for now.
- **Prisma 6.19.3** (`prisma` + `@prisma/client` pinned to the same version), `prisma-client-js`,
  `url` + `directUrl`, singleton in `src/lib/prisma.ts`, `prisma generate` in `postinstall` and `build`.
  No models yet.
- **Supabase lockdown:** `prisma/sql/001_supabase_lockdown.sql` does the following:
  - creates the private `app` schema
  - creates the least-privilege `app_user` runtime role
  - revokes all access for `anon` / `authenticated`
  - enables RLS on every `app` table with a single policy scoped to `app_user` (deny-all for API roles)
  - adds an event trigger so tables created by future migrations get the same treatment
- **Express 5 skeleton** (`src/app.ts`, no `listen`; `src/server.ts` listens and shuts down gracefully):
  - `x-powered-by` disabled, `trust proxy` = exact hop count from `TRUST_PROXY_HOPS`, simple query parser
  - `requestId` (generates one, or accepts a safe incoming `X-Request-Id`) → pino-http (logs only id,
    method, url and status; redacts auth headers, cookies, passwords, tokens and card data)
  - helmet: API CSP `default-src 'none'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
    `Referrer-Policy: no-referrer`, HSTS with preload in production
  - CORS: allowlist from env, `credentials: true`; disallowed origin → 403 `CORS_ORIGIN_DENIED`
  - 30s request timeout, `Content-Type` check (415 for non-JSON bodies), `express.json({ limit: '100kb' })`,
    `cookie-parser`, `hpp`, `Cache-Control: no-store`
  - Central error handler using the §6 error shape, including `requestId`. Never sends stack traces or
    Prisma details. Maps Zod errors → 422, malformed JSON → 400, oversized body → 413.
- **Endpoint:** `GET /api/v1/health` returns 200 `{status:"ok"}` or 503 `{status:"degraded"}` with
  `checks.database`, using a `SELECT 1` through the Prisma tagged `$queryRaw` with a 2s timeout.
  Layering: routes → controller → service → repository.
- **Tests (Vitest + Supertest, 18 passing):** health up/down (no leaks), security headers, request-id
  generation/echo/sanitising, 404 envelope, malformed JSON, 413, 415, CORS allow/deny, env validation.
  The DB is mocked; no test touches a real database.
- **CI:** `.github/workflows/ci.yml` runs `npm ci`, lint, format check, type-check, test,
  `npm audit --audit-level=high` and build, with dummy DB URLs.

### Decisions / deviations (please review)

1. **TypeScript 7 + typescript-eslint.** `typescript-eslint@8.72.1` peer-requires `typescript <6.1`, and
   TS 7's `typescript` package has no classic compiler API. npm resolves peers from the root, so scoped
   `overrides` don't work. Setup:
   - `"typescript": "npm:@typescript/typescript6@6.0.2"`: what `require('typescript')` resolves to; used by
     ESLint, Prisma and other tools
   - `"typescript7": "npm:typescript@7.0.2"`: the real compiler. `npm run typecheck` / `build` call
     `node node_modules/typescript7/bin/tsc` explicitly, because `.bin/tsc` is linked to the TS 6 package.
   - Revisit this when typescript-eslint supports TS 7, then make `typescript@7` the root package again.
2. **Prisma 6 + `deepmerge-ts` advisory (high, GHSA-ggr8-5vv4-36mx).** It comes in through `@prisma/config`
   in the Prisma CLI. npm's only automatic fix is Prisma 7, which needs approval (§1). Instead I added an
   override, `"deepmerge-ts": "8.0.2"`. Prisma only uses the `deepmerge` export; `prisma validate`,
   `prisma generate` and runtime client loading were checked on Node 26.0.0. `npm audit --audit-level=high`
   now passes.
3. **`minimatch` advisory (moderate, GHSA-g3hv-75wg-m249) left open.** It is dev-only (ESLint toolchain).
   The fix, minimatch 11, removed `makeRe` and breaks `eslint-plugin-import-x`; it was also published less
   than a week ago. This is below the CI threshold. Recheck when ESLint/import-x move to minimatch 11.
4. **Separate `app` schema** (not `public`) chosen for Prisma tables, selected with `?schema=app` on both
   DB URLs. RLS is enabled anyway.
5. **No `BYPASSRLS`** for `app_user` (Supabase doesn't let `postgres` grant it). An `app_user`-only policy
   on each table is used instead.
6. **Cookies:** `__Secure-` prefixes are applied only in production (`COOKIE_NAMES` in
   `src/config/cookies.ts`), because browsers reject them over plain-HTTP localhost.
7. Prisma 6 runs on Node 26, so there was no need to fall back to Node 24.

### Pending (Phase 0)

- [x] Supabase project created; lockdown SQL applied and verified (2026-11-03): `app` schema, `app_user`
      role, RLS event trigger confirmed working on Supabase.
- [x] `.env` connected (health reports `database: "up"`). Runtime still uses the `postgres` role by
      choice; switching `DATABASE_URL` to `app_user` (password not yet set) is deferred.
- [x] Separate test database: Docker Postgres 17 (Phase 1).
- [x] GitHub remote: https://github.com/codiologist/ecommerce-backend
- [ ] Enable Dependabot/Renovate (§4.2) in the GitHub repo settings.

---

## Phase 1 — Auth & Users (backend)

### Built

- **Models** (migration `20261103170252_phase1_auth_users`, `app` schema):
  - `User`: role enum CUSTOMER / STAFF / ADMIN / SUPER_ADMIN, status ACTIVE / BLOCKED, soft delete,
    `emailVerifiedAt`
  - `Session`: SHA-256 `tokenHash`, `familyId`, absolute `expiresAt`, `revokedAt` / `revokedReason`,
    `reauthAt`, `twoFactorVerified`
  - `EmailVerificationToken` and `PasswordResetToken`: hashed, single-use
  - `TwoFactorSecret`: AES-256-GCM encrypted secret, `lastUsedTimeStep`, hashed backup codes
  - `AuditLog`
  - Indexes on every FK, status/role, `createdAt` and expiry columns.
- **Endpoints:**
  - Auth: `GET /auth/csrf`, `POST /auth/register`, `/auth/verify-email`, `/auth/resend-verification`,
    `/auth/login`, `/auth/login/2fa`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`,
    `/auth/forgot-password`, `/auth/reset-password`, `/auth/reauth`, `/auth/2fa/setup`,
    `/auth/2fa/enable`, `/auth/2fa/disable`
  - Users: `GET|PATCH /users/me`, `POST /users/me/change-password`, `GET /users/me/sessions`,
    `DELETE /users/me/sessions/:id`
  - Admin: `GET /admin/session`
  - Docs: OpenAPI 3.1 generated from the Zod schemas at `/api/docs` (Swagger UI) and `/api/docs.json`;
    non-production only.
- **Cookies (§3):**
  - `access_token`: 15-min HS256 JWT; `alg`, `iss`, `aud`, `exp`, `sub`, `sid` and `iat` are verified, and
    `alg: none` is rejected. HttpOnly, Lax, `Path=/`.
  - `refresh_token`: opaque 256-bit value. HttpOnly, Strict, `Path=/api/v1/auth`.
  - In production both names get the `__Secure-` prefix and the `Secure` flag.
  - `csrf_token`: non-HttpOnly, signed double-submit token. Rotated on login and logout.
- **Sessions:**
  - Rotation on every refresh, with an absolute lifetime from login: 14 days, or 12h for staff and
    admins.
  - **Reuse detection:** a rotated token presented again after the grace window revokes the whole family,
    with an audit entry and a warning log.
  - **10s grace window**, so two tabs refreshing at once aren't treated as theft. The second tab gets a
    fresh access token but no new refresh token.
  - `authenticate` reloads the session and user from the DB on every request, so revocation, blocking and
    role changes take effect immediately.
- **CSRF:** on every non-GET `/api/v1` request, an Origin/Referer allowlist check plus a timing-safe
  header-equals-cookie check plus an HMAC signature check.
- **Brute force (Redis):**
  - Rate limits (`429` + `Retry-After`): global 300/min per IP, `/auth/*` 100 per 15 min, login 30 per
    15 min per IP, email-sending endpoints and register 10/h per IP.
  - Per account (hashed email): progressive delay of 250ms × 2ⁿ, capped at 2s; Turnstile required after
    3 failures; a 15-minute lockout after 10. Unknown emails behave identically.
- **No enumeration:**
  - Register, forgot-password and resend-verification give identical responses; the email work runs in a
    background job.
  - A dummy argon2 verify runs for unknown emails.
  - `ACCOUNT_BLOCKED` is only revealed after a correct password.
- **Passwords:**
  - Argon2id (64 MiB, t=3, p=1).
  - Length 8–128.
  - Rejected if in the 49k common-password list (`@zxcvbn-ts/language-common`), a single repeated
    character, or contains the email's local part.
  - Change password revokes other sessions. Reset (15-min single-use token; only the latest is valid)
    revokes all sessions and verifies the email.
- **2FA (TOTP, otplib):**
  - Setup returns an otpauth URI, a QR code and the secret; enabling returns 10 backup codes once.
  - Replay protection via `lastUsedTimeStep`, ±30s drift.
  - The login challenge lives in Redis for 5 minutes and allows 5 attempts.
  - Backup codes are single-use (atomic).
  - Disabling needs reauth and is refused for staff and admins.
- **RBAC:** `requireRole`, `requireAdminTwoFactor` (staff and above get 403 `TWO_FACTOR_SETUP_REQUIRED` /
  `TWO_FACTOR_REQUIRED`), `requireReauth` (5 min) and `requireVerifiedEmail` (for checkout in Phase 5).
  `/admin/*` is protected at router level.
- **Audit log:** register, login success/failure, lockout, blocked-user login, logout(-all), token reuse,
  email verified, reset requested/done, password changed, reauth, 2FA enable/disable/failure, backup code
  used, session revoked.
- **Mailer:** Nodemailer over SMTP (see "Email: Nodemailer + Mailpit" below); captured in memory in unit
  and integration tests. HTML and text templates, with values escaped.
- **Turnstile:** server-side siteverify, failing closed. Required in production; skipped with a warning in
  dev and test when no key is set.
- **Seed:** `npm run db:seed` creates the SUPER_ADMIN from `SEED_SUPER_ADMIN_*` (password ≥ 14 characters,
  policy-checked). It's idempotent and never resets an existing password. 2FA must be set up at first login.
- **Local services:** `docker-compose.yml` runs Postgres 17 (port 54329) and Redis 7 (port 63799).
  `npm run db:up` / `db:down`.
- **Tests: 83 passing** (unit + Supertest integration against Docker Postgres and Redis; `tests/global-setup.ts`
  refuses non-local DBs). They cover:
  - CSRF (missing, forged, bad origin)
  - register (mass assignment, enumeration, password policy, CAPTCHA)
  - email verification (single use)
  - login (cookie attributes, identical errors, CAPTCHA after 3 failures, lockout after 10, unknown-email
    lockout, blocked users)
  - rate-limit 429
  - refresh rotation, grace, reuse → family revoked and audited
  - tampered and `alg: none` JWTs; blocking applies immediately
  - logout and logout-all; session list and revoke; **IDOR** (another user's session → 404)
  - **permission denied:** CUSTOMER → 403 on admin routes, no role escalation via `PATCH /users/me`, staff
    without 2FA → 403
  - 2FA setup/enable/login, replayed code, challenge exhaustion, backup codes single-use
  - reauth; 2FA disable rules; change and reset password
  - Mutation-checked: disabling the reuse revocation or the role check makes the tests fail.
- **CI:** Postgres and Redis service containers added.
- **Verified live** on Supabase + Docker Redis: register → login → `/users/me` → refresh → 403 on admin →
  logout → 401.

### Changes to Phase 0 code (additive)

- `env.ts`: new auth variables, with `REDIS_URL`, `JWT_ACCESS_SECRET`, `CSRF_SECRET` and
  `TOTP_ENCRYPTION_KEY` now **required**; Turnstile and SMTP (`SMTP_HOST`, `MAIL_FROM`) are required in
  production.
- `app.ts`: global rate limit, CSRF and docs mounted.
- `errorHandler.ts`: Prisma P2002 → 409, plus `ApiError.headers` (e.g. `Retry-After`).
- `server.ts`: drains background jobs and closes Redis on shutdown.
- `cookies.ts`: rewritten with the real cookie definitions.
- `types/express.d.ts`: switched to the `declare global { namespace Express }` form, which TypeScript 6
  (used by ESLint) didn't pick up in the old form.
- Tests moved to `tests/unit` and `tests/integration`.

### Decisions / deviations (please review)

1. **Refresh-token grace window (10s).** Strict reuse detection would log users out when two tabs refresh
   at once. Within 10s the replay only gets a new access token, with no new refresh token and no
   revocation. After 10s the whole family is revoked.
2. **Access tokens are checked against the DB on every request** (one indexed query). This gives instant
   revocation and role changes. It can be cached in Redis in Phase 10 if needed.
3. **Login lockout and failure counters live in Redis**, not on `User`, so unknown emails behave the same.
   A Redis flush resets counters; that's acceptable.
4. **No auto-login after registration**: it would reveal whether the email was new.
5. **Background jobs are in-process** (`src/lib/jobs.ts`), which is enough for emails now. Move to a durable
   queue (e.g. BullMQ on the same Redis) if email reliability matters (Phase 5+).
6. **CSRF Origin check:** requests with neither `Origin` nor `Referer` (non-browser clients) are allowed
   through to the token check. Browsers always send `Origin` on cross-site POSTs.
7. **Backup codes** are 10 characters from a 31-character alphabet (about 49 bits each), stored as SHA-256
   (they're high-entropy and single-use, so a slow hash isn't needed).
8. **TOTP issuer** is `TOTP_ISSUER` (default "Store"); set it to the store name.
9. Your local `.env` was given generated `JWT_ACCESS_SECRET`, `CSRF_SECRET` and `TOTP_ENCRYPTION_KEY`
   values plus the Docker `REDIS_URL` (backup in `.env.bak`). **Production must use its own secrets.**
10. The migration was applied to the Supabase dev DB; all 6 new tables were confirmed to have RLS plus the
    `app_user`-only policy, with no `anon` access.

### Pending

- [ ] Phase 1 **frontend**: auth pages, `useMe()`, protected routes, admin 2FA UI, Turnstile widget,
      CSRF bootstrap (`GET /auth/csrf`).
- [ ] Production: SMTP provider credentials + a verified sender domain for `MAIL_FROM` (SPF/DKIM),
      Turnstile keys, Redis (e.g. Upstash, `rediss://`).
- [ ] Optional later: Google OAuth (§3).

### Scripts

`dev`, `build`, `start`, `typecheck`, `lint`, `format`, `format:check`, `test`, `audit:ci`,
`prisma:generate`, `prisma:migrate`, `prisma:deploy`, `db:up`, `db:down`, `db:seed`.

---

## Email: Nodemailer + Mailpit (2026-11-04, change requested after Phase 1)

Replaced **Resend** with **Nodemailer** (SMTP), as requested; both are allowed by §1.

- `src/lib/mailer.ts`: `createSmtpTransport()` uses Nodemailer 10.3.1. It pools connections (3) and has
  bounded connect/greeting/socket timeouts and TLS ≥ 1.2. **In production `requireTLS` is on**, so a
  server that can't upgrade to TLS is refused, unless `SMTP_SECURE=true` (implicit TLS, port 465).
  - With no `SMTP_HOST` (dev only), each email is logged as **one line with the link(s)** instead of
    being sent.
- `env.ts`: `RESEND_API_KEY` was removed. Added `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE`,
  `SMTP_USER`, `SMTP_PASS` (both or neither) and `MAIL_FROM`. Production requires `SMTP_HOST` and
  `MAIL_FROM`.
- `docker-compose.yml`: **Mailpit v1.33.0**, a local SMTP server (127.0.0.1:1025) with a web inbox at
  **http://localhost:8025**. Development emails arrive there; nothing leaves the machine.
- Your local `.env` now points at Mailpit (`SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`); backup in
  `.env.bak2`.
- Tests: `tests/integration/mailer.test.ts` sends through the real SMTP transport into Mailpit and reads
  the message back (link, HTML escaping, sender). It also checks that `requireTLS` refuses a non-TLS
  server. Mailpit was added as a CI service. **85 tests passing.**
- Verified end to end on the running dev servers: register in the browser → email in Mailpit → click the
  link → "Verify my email" → the account shows **Verified**.
- `resend` was uninstalled. Nodemailer ships its own types, so there's no `@types/nodemailer`.
