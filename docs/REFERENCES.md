# Official technical references

# 18. Verification and reference documentation

Vendor capabilities were checked against public technical documentation available 26 October 2026; URLs are implementation references, not claims of any subscribed data feed or production service agreement.

- Cloudflare React/Vite Workers: https://developers.cloudflare.com/workers/framework-guides/web-apps/react/
- Cloudflare Hono Workers: https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/
- Cloudflare Hyperdrive to Supabase: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/
- Supabase PostGIS: https://supabase.com/docs/guides/database/extensions/postgis
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Mapbox GL JS: https://docs.mapbox.com/mapbox-gl-js/
- Geocodio API: https://www.geocod.io/docs/ (accuracy types: https://www.geocod.io/guides/accuracy-types-scores)
- Bank of Canada daily exchange rates: https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/ and the Valet API (series `FXUSDCAD`): https://www.bankofcanada.ca/valet-api-how-to/ (found by web search on 27 October 2026; the site was not reachable from the build sessions). Publication by 16:30 ET each business day, and late rates published the next business day, per the Bank's daily exchange rates page as quoted by web search on 29 October 2026; the Valet answer shape (`observations[].d`, `observations[].FXUSDCAD.v` as text) from third-party descriptions of it. Terms of use still to be checked before production
- Codex repository instructions: https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex
- Gemini CLI context configuration: https://geminicli.com/docs/reference/configuration/
- Cursor 3 agent environment: https://cursor.com/changelog/3-0
- Claude Code parallel worktrees: https://support.claude.com/en/articles/14554000-claude-code-power-user-tips
- Google Antigravity 2.0: https://www.antigravity.google/blog/introducing-google-antigravity-2-0
- Full agent-operating playbook and further references: `AI_CODING_SYSTEM.md`
- CFIA phytosanitary exports: https://inspection.canada.ca/en/exporting-food-plants-animals/plant-exports/phytosanitary-certificates

---

**Specification rule:** When a new business decision conflicts with an existing line of this document, update the relevant decision record, domain contract, acceptance test, and affected implementation in the *same approved pull request*. Never silently change the meaning of a historical trade calculation.

