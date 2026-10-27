# Open decisions and risk register

Status: proposed defaults only. Commercial owner signs off before release 1 production use.

# 15. Design decisions requiring commercial sign-off

These are **not implementation blockers for Phase 0–2**, but must be decided before asserting production-grade scenario actionability:

1. **Default pricing conventions:** Which commodities/grades, quote units, and reference standards are first, and which conversion tables/authorities are approved?
2. **Commercial basis vocabulary:** Preferred delivery-term taxonomy; when are origin handling, delivered freight, or unloading included in buyer/seller prices?
3. **Firm quote standard:** What human evidence is needed to mark a bid/offer firm, and for how long is it valid?
4. **FX policy:** Manual deal rate, executable bank quote, or feed reference; what should happen when an FX quote ages out?
5. **Loss/dockage and quality adjustments:** Which charges/quantity basis apply to specific commodities and grades?
6. **Border/compliance ownership:** Who is importer of record, who arranges customs broker, and which cost placeholders are required before trade approval?
7. **Data rights:** Which external prices/data are licensed for storage, commercial display and derivative modeling?
8. **Internal confidentiality:** Whether exact farm addresses or farmer private contacts can be viewed by all employees.
9. **Multi-tenant branding:** Will white-label mean separate company databases/domains or one strictly isolated database with branded organizations?
10. **Release governance:** Who can approve new trade economics and database/schema production changes?

**Proposed safe defaults:** CAD per MT reporting, manually verified quote data, manual freight, zero loss *only if explicitly acknowledged*, no automatic execution, one internal organization initially, and an organization-aware schema.

# 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Stale buyer prices look executable | Quote status, timestamps, explicit owner verification, hard actionability gate |
| Wrong unit/FX conversion creates imaginary margin | Canonical typed values, source conversion table, exact decimal golden tests |
| Freight double-counting from delivery bases | Explicit cost inclusion and basis compatibility validator |
| AI introduces unreviewed financial logic | Pure engine, independent agent reviewer + human review, CI and versioned snapshots |
| Tenant data leakage | API membership checks, grants/RLS, authorization integration tests |
| Invalid geocoding exposes private farms | Confidence/precision, location redaction/generalization policies |
| Commercial feeds prohibited from reuse | Provenance and licensing registry before ingest |
| Over-building AI/automation before product-market fit | Phase gates; human-in-the-loop; no proprietary orchestration framework initially |
| Inability to restore critical trading records | Separate environments, backup verification and restore drills |
| Vendor lock-in | Standard Postgres, domain package isolated from Workers, MapLibre, provider adapters |

# Dated architecture decisions

Proposed by the implementing agent; the owner accepts or reverses each one.

**2026-10-26 — TypeScript pinned to 6.0.x.** TypeScript 7.0 (the native compiler) is the current npm release, but typescript-eslint 8.72.1, the latest, declares `typescript >=4.8.4 <6.1.0`. Type-checked linting matters more than the newer compiler. Revisit when typescript-eslint supports 7.x.

**2026-10-26 — pnpm pinned to 10.28.0.** It is the version available and verified in the bootstrap environment; pnpm 12 is current. Upgrading is a separate, tested change.

**2026-10-26 — Prettier does not format Markdown.** Reformatting would rewrite the tables in the specification pack. Code, JSON, YAML and config files are formatted and checked in CI.

**2026-10-26 — API unit tests run in Node through Hono `app.request`.** No code uses Worker bindings yet, so Workers-runtime tests (`@cloudflare/vitest-pool-workers`) are deferred until it does; `wrangler dev` serves as the runtime smoke check. Worker globals are typed with `@cloudflare/workers-types` until bindings exist, then with `wrangler types` output, which Cloudflare now recommends.

**2026-10-26 — Staging deploys from GitHub Actions on each merge to `main`.** The workflow repeats the CI checks, runs `wrangler deploy --env staging` and smoke-tests `/api/v1/health`. The Cloudflare token and account ID are GitHub repository secrets read only by this push-triggered workflow, never by `pull_request` jobs, so pull requests from forks cannot reach them. Production gets a separate, approval-gated workflow when it is needed.

**2026-10-27 — One Worker serves the web app and the API.** On staging, `apps/api` serves the built `apps/web/dist` as static assets, with `/api/*` always routed to the Worker and other unknown paths falling back to `index.html`. One origin means no CORS and simpler session cookies when auth arrives. The top-level Worker config stays API-only for local development.

**2026-10-27 — shadcn/ui conventions set up by hand.** The shadcn registry was unreachable from the build session, so the `cn` helper, CSS-variable theme tokens and the two components in use (`Badge`, `Tabs` on Radix) were written in shadcn's style. `components.json`, the CLI and the `@/` import alias are added when the registry is first used.

**2026-10-27 — Narrow screens get a facility list, not the table.** Below Tailwind's `lg` breakpoint (1024 px) the workspace shows List and Map tabs and a stacked facility list, per the spec's "accessible list alternative", so prices never scroll off-screen.

**2026-10-27 — Timestamps display in UTC.** Every quoted and valid-until time shows as `YYYY-MM-DD HH:MM UTC` until a display time-zone policy is decided.

**2026-10-27 — Web view types are provisional.** `apps/web/src/data/types.ts` serves the GT-010 shell only. The shared quote/facility contract is agreed and moved to `packages/domain` before quote work (GT-030) or the thin slice begins.

**2026-10-27 — Browser tests run in the required CI job.** Playwright tests in `tests/e2e` (desktop and phone) run against the built app served by `wrangler dev --env staging`, inside the existing `check` job, so branch protection covers them without a settings change. `@playwright/test` is pinned to 1.63.0 to match the Chromium preinstalled in the agent environment; CI installs the matching Chromium.

**2026-10-27 — Dependabot skips TypeScript 6.1 and later.** Its first npm run failed with `update_not_possible` because TypeScript 7 conflicts with typescript-eslint's supported range (see the 2026-10-26 TypeScript decision). Minor and patch npm updates are grouped into one weekly pull request.

**2026-10-27 — Supabase environments.** One hosted project, `gss-staging` (ref `nfwizbcpjpqxdoojfbdr`), on the free plan. Development and CI use a throwaway local Supabase started by the CLI, which `MASTER_PROJECT_SPECIFICATION.md` §4.4 allows. Production needs a further project, so a paid Supabase plan (which also adds daily backups and no idle pausing) is required before real trading data; the §10.4 restore drill comes with it.

**2026-10-27 — Database access model.** Application tables live in a private `app` schema that the Supabase Data API does not expose; browsers use Supabase only to sign in. The API Worker connects as `app_api`, a role with no superuser, no RLS bypass and only the grants each migration gives it. After verifying the caller's Supabase JWT, the Worker sets `app.user_id` for the transaction (`set_config(..., true)`), and row level security policies admit only rows of organizations where that user is an active member of an active organization. The database therefore trusts the Worker to set the user from a verified token; the Worker also filters by organization explicitly (§4.3). `app_api` is created without login; each environment enables it with its own password when the Worker first connects. If a role named `app_api` already exists with superuser, RLS bypass, role-creation, database-creation or replication rights, or with any role membership, the migration stops rather than reuse it. Database owners and administrator roles (`postgres`, `supabase_admin`) are outside this boundary and can read everything, so their credentials stay with operators and CI secrets only. How the Worker connects (Hyperdrive or the Supabase pooler) is decided with that work.

**2026-10-27 — Staging migrations from CI with a project-scoped secret.** After each merge, the Deploy staging workflow applies new migrations with `supabase db push --db-url`, using the `SUPABASE_STAGING_DB_URL` secret (the session-pooler connection string). This needs only that project's database password, not an account-wide Supabase access token that could reach other projects.

**2026-10-27 — Real data in `gss-staging` for now (owner's decision).** The owner chose to load the real buyer list into the one hosted project rather than buy a paid plan for a separate production project. Consequences accepted: no self-service backups on the free plan (the source spreadsheet stays the backup), the project pauses after about a week idle, and future migrations reach the real data directly after merge (each is still tested from scratch in CI first). Revisit before more users or data arrive; §10.4's restore drill remains outstanding.

**2026-10-27 — Sign-in: email, password and required TOTP, verified by Supabase Auth.** Supabase Auth with no self sign-up; administrators create users in the dashboard. Every user must enrol an authenticator app (TOTP) on first sign-in. The web app keeps the Supabase session and sends its access token to the API. The Worker checks each token by calling Supabase Auth (`GET /auth/v1/user`), which verifies the signature and that the session is still live, then requires the token's `aal` claim to be `aal2`, so skipping MFA in the browser does not get past the API. `/api/v1/health` is the only public API route; all others, including unknown ones, require sign-in. One Auth call per request is the cost; verifying against the project's signing keys (JWKS) with caching can replace it when traffic warrants.

**2026-10-27 — Worker to Postgres: postgres.js through the Supabase transaction pooler.** One short-lived connection per request (no prepared statements, TLS with certificate and host-name verification except for local databases), closed when the response is ready. The `DATABASE_URL` Worker secret, set in the Cloudflare dashboard and never in Git, holds the `app_api` pooler URL. Every query runs in a transaction that first sets `app.user_id` to the verified user, so row level security decides what is returned; a missing secret answers 500 `MISCONFIGURED` and a database failure 503 `DATABASE_UNAVAILABLE`. Cloudflare Hyperdrive can replace the per-request connection when latency matters.


**2026-10-27 — Counterparty directory and spreadsheet import (owner's request).** The owner asked to load their buyer list before the thin trade slice, which `docs/BUILD_PLAN.md` would otherwise put first; the import is kept minimal. Tables: `counterparties`, `counterparty_contacts`, `facilities`, `counterparty_logos`, `import_batches`. Any active member reads the organization's directory; operations and org_admin members create records (§2.1 "Edit counterparties"); nothing is edited or deleted through the API yet except replacing a logo. A legal name is unique per organization and country, ignoring case, so a re-import skips companies already listed instead of duplicating or changing them, and the same validated content cannot be imported twice. Rows with the same legal name and country become one counterparty with several contacts and locations. v1 accepts Canada and the United States only, with province and state codes. Instead of §9's staging table, the operator review is a server-side dry run shown in the app before anything is written; every row is validated by the same code in the browser and the Worker (`packages/domain`). Deferred: `risk_flags`, contacts' confidential scope, editing, and geocoding.

**2026-10-27 — Logos are PNG files stored in Postgres.** A logo is a `bytea` column next to its counterparty, so it is covered by the same row level security and audit trail as the record, with no second storage system. Only PNG up to 512 KB and 4096 px is accepted, checked by file structure (signature, IHDR, IEND) in the Worker and by signature and size in the database; logos are served as `image/png` with `nosniff` and a sandboxing CSP, so an uploaded file cannot run as a page. SVG is not accepted. The browser fetches each logo with the user's token once per checksum, only when it scrolls into view. Supabase Storage can take over if logos grow larger or more numerous.

**2026-10-27 — Facility locations: latitude and longitude, plus a PostGIS point.** Coordinates are stored as entered (six decimals) with a required precision, `exact` or `approximate` (§6 location governance); imported coordinates are `approximate` unless the file says otherwise. A generated `geography(Point, 4326)` column with a GiST index serves later map queries. PostGIS is installed in the `extensions` schema.

**2026-10-27 — Audit trail starts with the directory (GT-016, minimal).** `app.audit_events` gets one row per insert, update or delete on directory tables, written by a trigger in the same transaction: organization, actor (`app.user_id`), action, entity, entity id, names of changed columns (never values) and the request id (`app.request_id`, also sent as the `X-Request-Id` response header). `app_api` has no access to it, so the API can neither read nor erase it. An audit view for admins (`GET /api/v1/audit`) and quote-revision auditing come later.

**2026-10-27 — Database TLS is verified (Codex review of ivanmueller/gss#11).** postgres.js `ssl: 'require'` encrypts but accepts any certificate in Node, so the API now uses `verify-full` (chain and host name), with a test against an impostor server presenting a self-signed certificate for another name. In the Workers runtime postgres.js hands TLS to `startTls()`, which verifies the certificate itself (checked locally in workerd: an impostor's certificate is refused before any credentials are sent), so this changes nothing on staging. Errors no route handles are now logged by type and request id only, and a malformed `DATABASE_URL` answers 500 `MISCONFIGURED` without being logged, because URL errors carry the whole string, password included.
