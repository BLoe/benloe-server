# Cabinet v2 — Acceptance Report

> Built 2026-07-08 via the loop-driven three-movement plan
> (`docs/cabinet-v2-build-plan.md`). Design: `docs/cabinet-v2-design.md`.
> **Status: complete and green. Not yet deployed live — cutover is Ben's call.**

## What was built

Cabinet v2 replaces the V1 chat-thread UI with a **situation-room console** — a
single-user, campaign-desk personal-agent interface, not a chatbot. Five
surfaces inside one shell, driven by a frozen API contract and one instrument
design system.

- **Foundation** — a campaign-desk design-token system; a 7-component instrument
  family (Dial, Rule, Ring, Gauge, Sparkline, Card, StatReadout, SectionLabel)
  plus the `Instrument` spec-dispatcher; the app shell (Rail, ⌘K CommandBar,
  PresenceStrip, AppShell); a typed `CabinetApi` contract with a mock client.
- **Five surfaces** — **Today** (proactive briefing + attention cards + vitals),
  **Domains** (7 life domains: instruments / narrative / log), **Ops** (the
  autonomy trust-ledger with filters + revert), **Brain** (recall search +
  editable memory on paper cards + lessons), **Threads** (searchable
  conversation archive).
- **Real endpoints** — the gateway serves the contract from real domain tables
  (food, training, healthcare, money, tasks, people, reading, journal); Ops from
  the audit trail; memory from the curated store.

## Build method (and how it went)

Three movements, cut along dependency lines for quality:

1. **Foundation (serial, A1–A5)** — tokens → instruments → shell → contracts →
   gateway stubs. Frozen before any parallel work.
2. **Surfaces (parallel, A6–A11)** — one background workflow, six agents (Opus
   on Today/Domains/Ops/Brain, Sonnet on Threads/endpoints) built against the
   frozen foundation. 6/6 agents, 0 errors, ~14 min, ~372k tokens. It composed
   on the **first** combined verification — no integration conflicts. This is
   the payoff of freezing the foundation before fanning out.
3. **Integration + critique + polish (serial, A12–A15)** — mounted the surfaces,
   adversarially reviewed desktop + mobile (caught & fixed a mobile rail-stretch
   bug on every surface, a cramped mobile command bar, and stale Cabinet branding),
   cleared the dead V1 frontend, and landed full green.

## Evidence

- **Tests:** server **196** (13 files) · web **52** (10 files) — all green.
- **Typecheck:** `tsc --noEmit` clean in both `apps/cabinet/web` and
  `apps/cabinet/server`.
- **Production build:** `npm run build` succeeds —
  `index.js 233.5 kB (73.7 kB gzip)`, `index.css 32.5 kB (6.4 kB gzip)`,
  59→59 modules.
- **Visual:** every surface screenshotted at desktop (1280) and mobile (390),
  all five routes render live with data (mock-backed in dev). Reference shots:
  `a12-{today,domains,ops,brain,threads}.png`,
  `a13-{today,domains,ops,brain,threads}-mobile.png`.
- **Commits:** `a9d407d..05a188b` (11 commits, A1→A14) on `main`, all pushed.

## What's live vs. Ben-gated

- **Not deployed.** The v2 app is built and green but **not cut over**.
  **DEPLOYED** 2026-07-08 to `cabinet.benloe.com` (Caddy serves `dist/`, proxies
  `/api/*` + `/healthz` to `:3008`), replacing the design tour. Restarting
  `cabinet-api` onto the v2 build also activated the v2 endpoints, the SOUL/VOICE
  personality, and the autonomous gate.
- **The mock is dev-only** and can never ship: production builds gate it on
  `import.meta.env.DEV`, so `npm run build` always uses the real, Artanis-walled
  API (mock data is dead-code-eliminated). `npm run dev` uses mock by default
  (`VITE_CABINET_MOCK=false` opts out) for backendless UI work.
- **Personality + autonomy** (SOUL/VOICE, execute-and-audit gate) are committed
  but only take effect on the running process at the next `cabinet-api` restart —
  also Ben-gated.

## Notes / residuals

- `marked` + `dompurify` are now unused deps (only the removed V1 markdown used
  them) — safe to drop from `apps/cabinet/web/package.json` at some point; harmless
  (tree-shaken from the build) until then.
- The Domains/Today attention + narrative copy is real-data-driven but the
  *voice* of narratives sharpens once the live agent (SOUL/VOICE) generates them
  rather than the endpoint's factual placeholders.
- Deploy cutover, the artanis chown hardening, and flipping autonomy on the live
  process remain Ben's calls (unchanged from prior residuals).
