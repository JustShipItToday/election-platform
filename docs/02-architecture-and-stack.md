# 02 — Product Architecture, Information Architecture & Stack

## Name recommendation
**Elecia.** It reads as "election" without sounding bureaucratic, is soft and friendly (fits the sunny identity), is easy to say, and works as a mascot-friendly word. *Elec* feels like electronics/utilities; *Electia* sits close to existing pharma/health-sounding names and is clunkier to say. Caveat: I have **not** checked domain availability or trademarks for any of the three. Final call is yours (Decision D1).

## Information architecture
```
/                  → redirects into /2026/forecasting
/2026
  /forecasting     (default)  scope · research · one-by-one · map · makeup · save
  /endorsing                  one-by-one candidates + ballot questions
  /reconcile                  descriptive forecast-vs-endorsement stats
  /saved                      saved prediction maps + forecast maps (always viewable)
/about  /contact  /terms  /blog  /privacy   (each uniquely designed)
/api/*             server routes (tools, lifecycle time, ingest webhooks)
```
Only **2026** is top-level; Forecasting/Endorsing is a toggle inside it (Reconcile and Saved are secondary tabs inside 2026), avoiding a fragmented nav. After shutdown, `/2026/forecasting` and `/2026/endorsing` render a clear "closed" state with links to `/2026/saved`, and the results view appears at the results time.

## Layers
```
ingest/   provider adapters → raw_payloads (immutable) → normalized rows
db/       Postgres schema, migrations, RLS, lifecycle triggers
domain/   pure TS: scope compiler, polling methods, makeup, deferral queue, lifecycle, snapshots
tools/    AI tool contracts (zod in/out) wrapping domain+db; the ONLY path AI uses for data
agent/    prompt, policy guards, orchestration loop, output filters
app/      Next.js UI: map, cards, sidebar, tour, pages
```

## Stack options & recommendation (Decision D2)

| Option | Pros | Cons |
|---|---|---|
| **A. Next.js on Vercel + Supabase (Postgres/Auth/RLS/pg_cron/Edge Functions)** | Fastest to ship; one vendor for DB+auth+cron; SSR + API routes in one repo; huge ecosystem; RLS gives account security in the DB. | Vercel Hobby limits (⚠️ commercial-use clause, function time limits); cron sits in Supabase not Vercel. |
| B. Cloudflare Pages/Workers + D1 + R2 + Cron Triggers | Generous free limits, great global edge, cheap cron any frequency. | Next.js on Workers is more finicky; SQLite (D1) is a weaker fit for relational/analytical queries and RLS-style auth. |
| C. Self-managed (Fly/Render + Postgres) | Full control | More ops work; slowest to a safe launch. |

**Recommendation: A**, with static tiles served from the same CDN. Reason: the tonight timeline rewards the shortest path, Postgres suits the data model, and DB-enforced lifecycle rules (trigger using `now()`) work well in Supabase. ⚠️ I need to verify current free-tier limits and Vercel Hobby terms for a public site; if Hobby terms are a problem, Cloudflare Pages is the drop-in alternative for the frontend.

## Local vs cloud storage (explicit)
- **Guest (default):** everything in this browser (IndexedDB via Dexie): predictions, endorsements, deferrals, saved maps, settings, tour-seen flag. Never sent to our servers. Clearing site data erases it; UI says so plainly.
- **Account (optional):** same data synced to Postgres under RLS (`user_id = auth.uid()`). Magic-link email (+ optional Google). First login offers: *"Upload this browser's forecasts to your account?"* — never automatic.
- After shutdown: login and reading still work; **new** predictions are rejected by the DB. Local data stays viewable and can be exported (JSON).

## Performance strategy
- Map: MapLibre GL (WebGL), PMTiles vector tiles, zoom-dependent layers (states → districts → labels), `feature-state` for fills (no re-parse on update), debounced hover, `requestAnimationFrame` budgeting, no per-frame React re-renders.
- Adaptive tiers computed on load: `deviceMemory`, `hardwareConcurrency`, `connection.saveData`, `prefers-reduced-motion`, and a short measured-frame-time probe → **Full / Balanced / Lite**. Lite: no ambient animation, simplified boundaries, smaller images, no map labels at low zoom.
- Lists virtualized (race list can exceed 500 rows); images lazy + `srcset`; charts rendered lazily; AI panel code-split and not loaded if AI disabled.
- Cache: HTTP caching + SWR for static data, ETag for poll feeds; snapshotted JSON per race pre-aggregated by ingestion.

## Responsive strategy
Mobile-first deliberate layouts: phone = full-screen card flow with a bottom sheet for sidebar/filters and a map toggle; tablet = split view (map | card); desktop = three zones (scope sidebar | map | card + AI drawer). The one-by-one card is the primary mobile surface; the map is a tab.

## Accessibility strategy
WCAG 2.2 AA target. Every map has an equivalent sortable/filterable race table; keyboard map navigation (arrow-key focus between states/districts, Enter to open); outcomes encoded with color **plus** pattern/label/icon; `prefers-reduced-motion` honored; visible focus rings; live-region announcements for saved/deferred/closed states; tour is fully keyboard operable and dismissible.

## Security strategy
Secrets server-side only; RLS on all user tables; CSRF-safe cookie sessions; rate limiting per IP/user on `/api/agent`; input validation (zod) on every route; no raw HTML from news/bios (sanitize); outbound fetches for campaign sites use an allowlist-style fetcher with timeout/size caps and SSRF protection; dependency pinning and `npm audit` in CI; privacy-minimal analytics.

## Observability
Structured logs with request ids; ingest run table (`ingest_runs`) with counts, errors, durations; per-provider freshness dashboard (`/admin/health`, auth-gated); Sentry for errors; uptime ping on `/api/health`; alerts when a provider is stale beyond its SLA.
