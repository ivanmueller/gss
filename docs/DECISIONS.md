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
