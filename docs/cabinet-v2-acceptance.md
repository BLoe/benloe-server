# Cabinet v2 — Acceptance Report

> Built 2026-07-08 via the loop-driven three-movement plan
> (`docs/cabinet-v2-build-plan.md`). Design: `docs/pals-v2-design.md`.
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
   bug on every surface, a cramped mobile command bar, and stale PALS branding),
   cleared the dead V1 frontend, and landed full green.

## Evidence

- **Tests:** server **196** (13 files) · web **52** (10 files) — all green.
- **Typecheck:** `tsc --noEmit` clean in both `apps/pals/web` and
  `apps/pals/server`.
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
  `cabinet.benloe.com` currently serves the design tour; pointing it at the v2
  app (or replacing `pals.benloe.com`) is **Ben's decision**. To deploy: build
  `apps/pals/web`, serve `dist/`, set `VITE_CABINET_MOCK=false` so it uses the
  real gateway, and restart `pals-api` behind it.
- **Runs on mock data in dev** (`VITE_CABINET_MOCK` defaults true). The real
  endpoints exist and are tested; flip the flag on deploy.
- **Personality + autonomy** (SOUL/VOICE, execute-and-audit gate) are committed
  but only take effect on the running process at the next `pals-api` restart —
  also Ben-gated.

## Notes / residuals

- `marked` + `dompurify` are now unused deps (only the removed V1 markdown used
  them) — safe to drop from `apps/pals/web/package.json` at some point; harmless
  (tree-shaken from the build) until then.
- The Domains/Today attention + narrative copy is real-data-driven but the
  *voice* of narratives sharpens once the live agent (SOUL/VOICE) generates them
  rather than the endpoint's factual placeholders.
- Deploy cutover, the artanis chown hardening, and flipping autonomy on the live
  process remain Ben's calls (unchanged from prior residuals).
