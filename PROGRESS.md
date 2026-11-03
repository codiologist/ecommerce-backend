# ecommerce-backend — Progress

| Phase              | Status                                                                              |
| ------------------ | ----------------------------------------------------------------------------------- |
| 0. Setup (backend) | ✅ Done (2026-11-03) — real Supabase connection still to be verified, see "Pending" |
| 1. Auth & Users    | ⏳ Not started                                                                      |
| 2–10               | ⏳ Not started                                                                      |

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
6. **Cookies:** `__Secure-` prefixes are applied only in production (`cookieName()`), because browsers reject
   them over plain-HTTP localhost. The cookies themselves are defined in Phase 1.
7. Prisma 6 runs on Node 26, so there was no need to fall back to Node 24.

### Pending / for you to do

- [ ] Create the Supabase project, run `prisma/sql/001_supabase_lockdown.sql` as `postgres`, set the
      `app_user` password, and make sure `app` is **not** an exposed schema under Data API settings (or
      disable the Data API). Confirm Supabase accepts the event trigger; if it doesn't, call
      `SELECT public.app_enable_rls_on_all_tables();` after every migration.
- [ ] Create `.env` from `.env.example`, using `app_user` on the pooled URL (`:6543`,
      `?pgbouncer=true&connection_limit=5&schema=app`) and `postgres` on the direct URL
      (`?schema=app`). Then `npm run dev` → `GET /api/v1/health` should report `database: "up"`.
- [ ] Set up a **separate test database** for Phase 1 integration tests (§9).
- [ ] Add a git remote, then Dependabot/Renovate (§4.2) once the repo is on GitHub.
- [ ] Frontend Phase 0 (`ecommerce-frontend`) has not been started.

### Not done on purpose (later phases)

Redis, rate limiting, CSRF, auth/RBAC middlewares, the `validate` middleware, mailer, OpenAPI docs
(`/api/docs`), seed script and all models start in Phase 1 or later.

### Scripts

`dev`, `build`, `start`, `typecheck`, `lint`, `format`, `format:check`, `test`, `audit:ci`,
`prisma:generate`, `prisma:migrate`, `prisma:deploy`.
