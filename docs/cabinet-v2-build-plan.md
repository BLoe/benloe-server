# Cabinet v2 — Build Plan (loop-driven, three movements)

> The authoritative spec the `/loop` build follows. Durable across context
> compaction and plan-limit interruptions: the loop reads this file + the task
> list each iteration, so any restart resumes exactly where it left off.
> Design source: `docs/cabinet-v2-design.md`. Tour feedback locked the direction.

## Prime directives (never violate)
1. **Build the complete system.** No de-scoping, no "simplify for now," no
   "phase 1." The unit of work is the whole Cabinet v2. (See Ben's build
   philosophy — generate the full picture, then iterate whole versions.)
2. **Freeze the foundation before fanning out.** Movement 2 (parallel surfaces)
   MUST NOT start until every Movement 1 task is `completed` and the foundation
   build is green. Parallel work builds against real frozen code, never a prose
   spec — that's what keeps it coherent.
3. **Every task ends green and saved.** `tsc --noEmit` clean + `vitest` green +
   (for any UI) a Playwright screenshot at desktop AND mobile, then commit
   locally in `/srv/benloe` and `git push origin main`. A task isn't done until
   its acceptance criteria are met with evidence.
4. **Hand-roll per Ben's dependency philosophy;** deps only where we can't/
   shouldn't maintain them. Match the existing codebase idioms.
5. **Never** read/commit `/srv/benloe/.env`; never commit anything under
   `/srv/benloe/data/`. Cabinet's voice (SOUL.md/VOICE.md) governs all UI copy.

## Loop protocol (each iteration)
1. Read this file + run `TaskList`.
2. Claim the lowest-ID **unblocked** `pending` task; mark it `in_progress`.
3. Execute it fully to its acceptance criteria (see below).
4. Verify (tsc + vitest + visual where UI). Commit + push. Mark `completed`.
5. If blocked on something only Ben can provide, note it on the task and move to
   the next unblocked task. Otherwise continue until **A15** is `completed`.
6. Movements 1 & 3 are done **directly** (this model, with the browser for
   visual critique) — serial, coherence-critical. Movement 2 is run as **one
   background Workflow** that fans out per-surface/-endpoint agents against the
   frozen foundation, each self-verifying; Opus for design-carrying surfaces,
   Sonnet for Threads + endpoints.

---

## MOVEMENT 1 — Foundation (serial · this model · freeze the substrate)
Rebuild lives in `apps/cabinet/web` (new v2 surface); server changes in
`apps/cabinet/server/src/gateway`.

- **A1 · Design tokens & base styles.** Campaign-desk token system (walnut/brass/
  paper/patina/vermilion; serif/mono/sans; space/radius/motion) as CSS custom
  props + base reset, committed dark. *Accept:* tokens module + a specimen page
  screenshotted (swatches + type scale).
- **A2 · Instrument component library.** React components matching the mockup:
  `Dial`, `Rule`, `Ring`, `Sparkline`, `Gauge`, `Card`, `StatReadout`,
  `SectionLabel`. Each unit-tested (render + props) with a gallery story.
  *Accept:* vitest green, gallery screenshot showing the instrument family.
- **A3 · Shell components.** `AppShell` (rail + main + presence strip), `Rail`
  (5-surface nav + active state), `CommandBar` (⌘K open/close, intent input),
  `PresenceStrip` (idle/working states). *Accept:* renders, ⌘K works, tests
  green, screenshot desktop + mobile.
- **A4 · API contracts + typed mock client.** `web/src/lib/contracts.ts` (types
  for threads, domain summaries ×7, ops/audit feed, recall, memory) + a client
  that returns contract-valid mock data behind a flag, so surfaces build before
  endpoints are real. *Accept:* tsc clean; mock client typed end-to-end.
- **A5 · Gateway endpoint stubs (freeze the API).** Express routes matching the
  contracts: `/api/domains/:domain`, `/api/ops`, `/api/recall`, `/api/memory`
  (GET/PUT). Return contract-valid JSON (real where trivial from DB, typed
  placeholder otherwise). *Accept:* gateway vitest green; each route
  contract-valid. **This is the freeze line.**

## MOVEMENT 2 — Surfaces & endpoints (parallel · Workflow · against frozen A1–A5)
One Workflow, fan-out with per-item verify (tsc + tests + Playwright). Blocked
until A1–A5 all `completed`.

- **A6 · Today surface** *(Opus)* — briefing (Cabinet's voice) + attention cards
  + vitals instruments + overnight → Ops. Wired to contracts. *Accept:* tests +
  desktop/mobile screenshots.
- **A7 · Domains surface** *(Opus)* — the seven domains, each
  Instruments + Narrative + Log template; domain switcher. *Accept:* as above.
- **A8 · Ops surface** *(Opus)* — live action feed (from audit), filters, and a
  rollback affordance per reversible action. *Accept:* as above.
- **A9 · Brain surface** *(Opus)* — memory files as editable cards + unified
  recall search with provenance. *Accept:* as above.
- **A10 · Threads surface** *(Sonnet)* — searchable archive + thread view
  (restyle V1 chat rendering into the design system). *Accept:* as above.
- **A11 · Gateway endpoints — real** *(Sonnet)* — flesh A5 stubs into real
  DB-backed reads: domain summaries from domain tables, ops from `action_audit`,
  recall from episodic + facts, memory via `MemoryStore`. *Accept:* gateway
  vitest green; contract-valid against real data.

## MOVEMENT 3 — Integration · critique · polish (serial · this model · make quality)
- **A12 · Integration.** Assemble surfaces into the shell + routing; wire to the
  real endpoints; whole app builds and every route loads. *Accept:* prod build
  succeeds; all five routes render with real data.
- **A13 · Visual + voice critique.** Playwright-screenshot every surface at
  desktop + mobile; adversarially critique against the design system and
  SOUL/VOICE; fix cross-surface drift; polish spacing, motion, and copy.
  *Accept:* screenshots of all five surfaces + a short critique-and-fixes note.
- **A14 · Green + build.** Full `tsc` clean, all `vitest` green (server + web),
  production build of web succeeds. *Accept:* recorded test counts + build ok.
- **A15 · Acceptance report.** `docs/cabinet-v2-acceptance.md` with evidence
  (screenshot refs, test counts, what's live vs. Ben-gated: deploy to
  cabinet.benloe.com replacing the tour is Ben's call). *Loop ends here.*

## Dependencies
A1→A2→A3; A4→A5. A6–A11 depend on A1–A5 all done. A12 depends on A6–A11.
A13→A14→A15.

## Not in scope for the loop (Ben-gated)
- Deploying v2 live (cabinet.benloe.com cutover) — build it ready, Ben flips it.
- Flipping the running V1 process to autonomous mode.
