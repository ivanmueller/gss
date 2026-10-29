# Grain Trading Platform

Canadian–U.S. physical grain trading operations platform. The repository has the Phase 0 tooling, CI and a staging deploy. On staging, one Cloudflare Worker serves the web app and the API:

- sign-in with an authenticator code, and a **Team** page where admins add people (the app makes their login), set names and roles, and suspend or reactivate them;
- the counterparty directory of buyers and sellers: added by hand or from a spreadsheet, edited, archived, with logos;
- its Mapbox map view, with coordinates looked up through Geocodio;
- **Bids & offers**: real bids and offers linked to counterparties, with a revision history that is never edited;
- a trading workspace (map and order book in CAD) showing those live bids and offers, or made-up demo data while the Demo data switch is on.

No FX connector (so USD prices are not yet in the order book), trading engine, saved scenarios or production deployment exists yet; `docs/HANDOFF.md` records the last merged state.

1. Read `MASTER_PROJECT_SPECIFICATION.md` for product and technical requirements.
2. Read `docs/BUILD_PLAN.md` for staged work and its early end-to-end demonstration path.
3. **Read `docs/AI_CODING_SYSTEM.md` for the October 2026 tool choices and practical multi-agent coding setup**; `docs/AI_WORKFLOW.md` describes Git/PR governance.
4. Every agent follows root `AGENTS.md` (Claude Code via `CLAUDE.md`, Gemini CLI via `.gemini/settings.json`; Cursor and Codex also recognize `AGENTS.md`). Verify instruction loading in your selected tool.
5. Use dedicated issue/PR branches and templates. The integration owner updates `docs/HANDOFF.md` **after** each verified merge, not separately in parallel feature branches.
6. See `docs/CHANGELOG.md` for changes made to this documentation pack.

**Initial AI workflow:** Evaluate Cursor 3 Agents Window as the primary hub, Claude for implementation, Codex for independent review, and Gemini for targeted alternate approaches. Claude Code or Google Antigravity 2.0 may replace the primary interface after a small controlled comparison. This is a **recommendation**, not a requirement or configured integration.

**Recommended stack:** React/Vite, TypeScript, Hono/Cloudflare Workers, Supabase PostgreSQL/PostGIS/Auth/Storage, Mapbox GL JS; pnpm, Vitest, Playwright.

**Important:** Do not publish live grain prices, counterparty contact data, geocoordinates of private farms, credentials, or real contract documents in a public repository or as unredacted prompts to AI tools.

## Quick start

Requires Node.js 22.13 or later and pnpm 10.28 (`corepack enable` picks up the version pinned in `package.json`).

```sh
pnpm install
pnpm check                      # format check, lint, typecheck, tests (CI also runs pnpm build)
pnpm --filter @grain/api dev    # API Worker: http://localhost:8787/api/v1/health
pnpm --filter @grain/web dev    # web app with hot reload: http://localhost:5173 (proxies /api to :8787)
pnpm preview:staging            # build, then serve web + API together as on staging: http://localhost:8787
pnpm e2e                        # build, then run the Playwright browser tests (desktop and phone)
```

`pnpm e2e` needs Chromium for Playwright 1.63.0 (`pnpm --filter @grain/e2e exec playwright install chromium`, once) and a local Supabase with its sign-in service: `supabase start`, then set the variables listed in `.env.example` from `supabase status -o env` and write `apps/api/.dev.vars.staging`. CI does exactly this in `.github/workflows/ci.yml`. Bids and offers entered by a run are never deleted, so before running `pnpm e2e` again on the same local database, reset it with `supabase db reset`.

## Sign-in

Email and password through Supabase Auth, plus a required authenticator-app code (TOTP). There is no self sign-up.

Adding a person (admins): **Team → Add a person** with their first and last name, email and role. The app makes their login and shows a temporary password once; give it to them in person or by phone. At their first sign-in they set up their authenticator app (on a computer they scan the QR code with their phone; on an iPhone they tap **Copy setup key** and paste it into Google or Microsoft Authenticator, or tap **Save in Apple Passwords**; on Android **Open in authenticator app** adds GSS directly) and choose their own password. A login made earlier in Supabase is added the same way (it keeps its password). Admins also change names and roles and suspend or reactivate people there; there is always at least one active admin, and admins cannot change their own role. Anyone who signs in without a name is asked for it first.

Making logins needs the Supabase secret key on the staging Worker (only for making logins and setting passwords; data still goes through row level security):

1. In Supabase (**Project Settings → API Keys → Secret keys**): create a secret key named "GSS app" and copy it (it starts with `sb_secret_`).
2. In Cloudflare (**Workers & Pages → grain-trading-api-staging → Settings → Variables and Secrets → Add**): type **Secret**, name `SUPABASE_SECRET_KEY`, paste the key, **Deploy**.

The profile menu (the icon at the top right) shows the user's first name and last initial, never the email. Admins set names on the **Team** page; without the app, in the Supabase SQL editor:

```sql
update auth.users
   set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                            || jsonb_build_object('first_name', 'First', 'last_name', 'Last')
 where email = 'user@example.com';
```

The same menu holds the **Demo data** and **Dark mode** switches (see "Workspace" below and `docs/DESIGN_SYSTEM.md`).

`pnpm format` rewrites code to the Prettier style. Markdown is not reformatted, so the specification pack stays as delivered.

## Workspace

The opening page shows a commodity picker and a seller/buyer filter above the map. Beside the map is an order book; the facility list is below. They show GSS's live bids and offers (firm or indicative, not expired, not withdrawn), fetched again every minute and whenever the page is shown again, so a bid entered or withdrawn elsewhere appears without reloading.

- **Order book:** for each commodity, sellers' asks in red boxes on the left and buyers' bids in green boxes on the right, best first, all in CAD per tonne. The gross spread (best bid minus best ask, before freight and basis) is in each commodity's heading. A dashed circle marks an indicative price; "FX" marks a price converted from USD.
- **Hiding the book:** the arrow tab on its left edge slides it away and back.
- **Map pins:** one per location quoted at that has coordinates (buyers green, sellers coral, hollow when approximate). Quotes without a location, or at one without coordinates, are in the book and the table only.
- **USD prices** are converted to CAD at the Bank of Canada's latest daily rate (CAD per USD), exactly, and placed among the CAD prices. Each carries "FX"; hovering it, or selecting the location, shows the USD price, the rate and its day, for example "USD 725.00/MT at 1.3912 CAD per USD, Bank of Canada, 28 Oct 2026". The book's footer names the rate in use.
- **Left out of the book, with a note:** USD prices when there is no Bank of Canada rate yet or the latest is more than four days old ("CAD/USD rate out of date"), and prices per bushel, short ton or hundredweight, which need a conversion factor not set up yet. Both stay in the facility table, as quoted. Nothing is converted at a made-up or old rate.
- **Demo data:** profile icon → **Demo data** shows made-up sellers, buyers and prices instead (never mixed with real ones). It is off until turned on, and the browser remembers the choice. While it is on, a yellow "Demo" tag sits beside GSS. The demo converts USD at the golden fixture's 1.360000, labelled synthetic.

## Exchange rate

The CAD/USD rate is the Bank of Canada's daily average (series FXUSDCAD), published by 16:30 Ottawa time on business days through its free Valet service, which needs no key or account. The Worker fetches it at 14:15 and 22:15 UTC every day (`apps/api/wrangler.jsonc`, triggers) and stores each new day once, with the time it was fetched; stored rates are never changed. A run that fails stores nothing, and the next run catches up on the days missed (it reads the last ten published days).

- **See it:** the order book's footer names the rate and day whenever a USD price is converted; `GET /api/v1/fx-quotes` lists the last ten days.
- **Check a run:** Cloudflare → Workers & Pages → grain-trading-api-staging → Logs: look for "Bank of Canada USD/CAD refreshed: … stored, … unchanged …" after 22:15 UTC, or "Bank of Canada USD/CAD not refreshed: …" with the reason.
- **Old rate:** a rate more than four calendar days old is out of date (a stopped feed); USD prices then stay out of the book until a new one arrives.
- **Before production:** check the Bank's terms of use for the data (`docs/DECISIONS.md`).

## Counterparties

Signed-in members see their organization's buyers and sellers under **Counterparties**, as a table, by logo or on a map, with **All / Buyers / Sellers** to show one side. Archived counterparties are hidden unless **Show archived** is ticked. Real records go only into the database, never into Git.

Operations and admin members can:

- **Add counterparty:** enter one by hand with the same details as the import (company, and optionally a first contact and location).
- **Import spreadsheet:** a CSV file (in Excel: Save As → "CSV UTF-8 (Comma delimited)"). Choose which of your columns fills each field (columns with known names are chosen already; the page lists the columns left unused), say whether the file holds buyers or sellers, review the result and import. Companies already in the list are skipped.
- On a counterparty's page: **Edit details**, **Archive** (and **Restore**), add, edit and remove contacts and locations, and upload a PNG, JPG or WebP logo (a JPG or WebP is saved as a PNG; a logo already there is changed under **Edit details**). Every change is recorded in the audit trail. If someone else changed the record after you opened it, your save is refused and you can load the latest version.

## Bids and offers

**Bids & offers** lists GSS's live bids and offers (tick **Include withdrawn and expired** for the rest), filtered by Bids or Offers and commodity. Each counterparty's page lists its own, with **New bid** / **New offer**.

Traders and admins can:

- **New bid or offer:** choose a bid (from a buyer or broker) or an offer (from a seller or broker), the counterparty, optionally one of its locations, and the commodity; then the terms: price as quoted (CAD or USD, per tonne, short ton, bushel or hundredweight), firm or indicative, grade, quantity, delivery basis and window, quoted and valid-until times (typed in local time, shown in UTC), source and notes.
- **Record new terms:** a change of price, quantity or timing is saved as a new revision; earlier revisions are kept and never edited. If someone recorded newer terms after you opened the quote, your save is refused and you can load them.
- **Withdraw:** for good; the quote stays readable with its history. A new price is entered as a new quote.

A quote past its valid-until time shows as expired. A location with quotes cannot be removed from its counterparty. The commodity list (20 grains, oilseeds and pulses) is set in the database; ask for others to be added.

## Map

**Counterparties → Map** shows the organization's counterparty locations on a Mapbox map (Mapbox GL JS, `docs/DECISIONS.md`), as street map or satellite: buyers green, sellers red, both (or brokers and carriers) blue; filled pins are exact locations, hollow pins approximate ones (such as a town). Clicking a pin shows the location; the list under the map links to each counterparty. Locations without coordinates cannot be shown, and the page says how many there are. Old links to `/map` open this view.

The map needs a Mapbox **public** token, built into the web app when staging deploys. It is not a secret (every visitor's browser receives it), so Mapbox limits where it works; it is still kept out of Git so it can be replaced. Never use a secret token (`sk.`): the build refuses one.

1. In Mapbox (account.mapbox.com → **Tokens** → **Create a token**): name it, keep only the public scopes, and under URL restrictions add `https://grain-trading-api-staging.ivan-mueller02.workers.dev`. Create it and copy the token (it starts with `pk.`).
2. In GitHub (**Settings → Secrets and variables → Actions → New repository secret**): name `MAPBOX_PUBLIC_TOKEN`, paste the token, **Add secret**.
3. Run **Actions → Deploy staging → Run workflow** (or merge any change), then open **Counterparties → Map** on staging.

Without the token, the page lists the locations and explains what is missing. To replace the token, update the secret and deploy again.

### Finding coordinates

Operations and admin members can turn addresses into map points: **Counterparties → Map → Find coordinates from addresses → Look up addresses**. The app sends only the addresses of locations without coordinates (street, town, province or state, postal code, country; never names or contacts) to Geocodio, shows what it found as exact or approximate, and saves only the results you leave ticked. Results in another province or state, or with low confidence, start unticked. Locations that already have coordinates are never changed. Geocodio's free plan covers 2,500 lookups a day.

The lookup needs a Geocodio API key, kept as a secret of the staging Worker in Cloudflare (the server does the lookups, so the key never reaches a browser):

1. In Geocodio (dash.geocod.io → **API Keys**), create a key for this app and copy it.
2. In Cloudflare (**Workers & Pages → grain-trading-api-staging → Settings → Variables and Secrets → Add**): type **Secret**, name `GEOCODIO_API_KEY`, paste the key, **Deploy**.

Secrets stay in place when staging deploys. Replacing the key voids looked-up results not yet saved; look the addresses up again.

## Staging database connection

The staging Worker reaches Supabase through Cloudflare Hyperdrive, which verifies Supabase's certificate (`docs/DECISIONS.md`). To create or update it: give the Cloudflare API token Hyperdrive and SSL and Certificates edit permissions, add the GitHub secret `SUPABASE_HYPERDRIVE_URL` (`postgresql://app_api.<project-ref>:<password>@<pooler-host>:5432/postgres`, Supabase's session pooler), then run **Actions → Set up Hyperdrive (staging)**. Its summary shows the configuration ID that `apps/api/wrangler.jsonc` binds as `HYPERDRIVE`. Locally, `wrangler dev --env staging` connects that binding to the database in `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (CI sets it to the throwaway database).

## Staging deploy

Each merge to `main` runs `.github/workflows/deploy-staging.yml`: it repeats `pnpm check`, builds the web app, deploys `apps/api` with `wrangler deploy --env staging` to `https://grain-trading-api-staging.<subdomain>.workers.dev` (the Worker serves `apps/web/dist` alongside the API), and checks `/api/v1/health`, the web page at `/`, and that unknown `/api/*` paths return 404. Until the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist, it skips with a notice. Staging holds the owner's real data (`docs/DECISIONS.md`); the trading workspace shows only made-up data, behind the Demo data switch.

## Database

Supabase Postgres. Migrations live in `supabase/migrations/` and pgTAP tests in `supabase/tests/`.

- **Pull requests:** CI starts a throwaway local Supabase, applies every migration from scratch and runs `supabase test db`.
- **Staging:** after a merge, the Deploy staging workflow runs `supabase db push` against the hosted `gss-staging` project (ref `nfwizbcpjpqxdoojfbdr`). It skips with a notice until the `SUPABASE_STAGING_DB_URL` repository secret exists.
- **Locally (optional):** with Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development), run `supabase db start` then `supabase test db`.

Application tables live in the private `app` schema, which the Supabase Data API does not expose; the API Worker reaches them as the least-privilege `app_api` role (`docs/DECISIONS.md`). On staging the Worker connects through the Hyperdrive binding ("Staging database connection" above). `DATABASE_URL` is only a fallback when there is no binding (local runs, CI), set in `apps/api/.dev.vars.staging`; the old Cloudflare `DATABASE_URL` secret is no longer used. `pnpm --filter @grain/api test:db` runs the API's database code as `app_api` against a database with the migrations applied (`API_TEST_ADMIN_DATABASE_URL`, `API_TEST_DATABASE_URL`).

## Layout

```
apps/api/            Hono API on Cloudflare Workers (health, /me, members, counterparties, map search, geocoding, commodities, quotes); serves apps/web on staging
apps/web/            React + Vite + Tailwind web app (workspace on live bids and offers or demo data; counterparties, map, bids and offers, team); design tokens in src/styles, shared components in src/components/ui (docs/DESIGN_SYSTEM.md)
tests/e2e/           Playwright browser tests against the staging Worker config
packages/domain/     shared code for web and API: validation (counterparty import rows, bid and offer terms, members, PNG check, regions), quote status, and exact money arithmetic (spreads, USD→CAD, rounding)
supabase/            database migrations, pgTAP tests and local CLI config
docs/                specification sections, AI coding system, decisions, handoff, changelog
.github/             CI workflow, Dependabot, issue and PR templates
```
