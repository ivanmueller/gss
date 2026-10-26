# Grain Trading Platform — Specification Pack

This directory is a **repository-ready documentation and AI collaboration starter**, NOT application source code. It reflects the proposed design baseline as of October 26, 2026.

1. Read `MASTER_PROJECT_SPECIFICATION.md` for the complete product and technical requirements.
2. Read `docs/BUILD_PLAN.md` for the order of work, beginning with Phase 0.
3. AI coding agents use `AGENTS.md` (Claude via `CLAUDE.md`, Gemini CLI via `.gemini/settings.json`).
4. Keep project execution notes in `docs/HANDOFF.md` after each merged PR.
5. Use the included GitHub issue/PR templates to share scope and acceptance criteria across AI models.

**Recommended stack:** React/Vite, TypeScript, Hono/Cloudflare Workers, Supabase PostgreSQL/PostGIS/Auth/Storage, MapLibre; pnpm, Vitest, Playwright.

**Important:** Do not publish live grain prices, counterparty contact data, geocoordinates of private farms, credentials, or real contract documents in a public repository or as unredacted prompts to AI tools.
