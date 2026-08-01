# HANDOFF: Cabinet v2 persona stack — integration brief

You are Claude Code, working in Ben's benloe-server monorepo. This bundle
contains eight seed files (in ./seeds/) designed in a long collaborative
session with Ben: a full replacement of Cabinet's persona/prompt stack
(charter, voice, adaptive tuning, daily rhythm, playbook, distilled user
biography, health plan, slimmed onboarding). Your job is mechanical
integration; the content is final — do not rewrite, editorialize, or
"improve" the seed prose. Work on branch `cabinet-v2-persona`, commit in
the logical units below, run the test suite, and open a PR with `gh`.

All paths below are relative to `apps/cabinet/`.

## 1. Replace templates (server/src/memory/templates.ts)
In `MEMORY_TEMPLATES`:
- REPLACE the values of these keys with the corresponding seeds/ files,
  verbatim (escape backticks/`${` for template literals as the file
  already does):
  - 'VOICE.md'      ← seeds/VOICE.md
  - 'USER.md'       ← seeds/USER.md
  - 'ONBOARDING.md' ← seeds/ONBOARDING.md
- ADD new keys:
  - 'CHARTER.md'    ← seeds/CHARTER.md
  - 'PLAYBOOK.md'   ← seeds/PLAYBOOK.md
  - 'RHYTHM.md'     ← seeds/RHYTHM.md
  - 'TUNING.md'     ← seeds/TUNING.md
  - 'plans/health.md' ← seeds/plans/health.md
    (follows the existing 'domains/*.md' nested-key pattern)
- DELETE the 'SOUL.md' key. CHARTER.md replaces it.
- REWRITE 'IDENTITY.md' to a compact ~15-line operational identity card,
  derived strictly from seeds/CHARTER.md (who Cabinet is, prime
  directive, hard lines in one line each). Rationale: heartbeats build
  their minimal system prompt from IDENTITY.md + HEARTBEAT.md
  (assemblePrompt in runtime/prompt.ts), so IDENTITY must stand alone
  for that path; interactive sessions get the full CHARTER via
  promptCore. No butler language survives anywhere.

## 2. Prompt core order (server/src/memory/index.ts, promptCore())
Change the `order` array to:
  ['CHARTER.md', 'VOICE.md', 'TUNING.md', 'RHYTHM.md', 'USER.md',
   'PLAYBOOK.md', 'PREFERENCES.md', 'GOALS.md', 'STANDING_ORDERS.md',
   'PLATFORM.md']
(IDENTITY.md drops out of interactive prompts — CHARTER supersedes it;
it remains for heartbeats. SOUL.md is gone.) Update the §9.3 comment.

## 3. profileGap rewrite (server/src/domains/profile.ts)
Per the engineering note at the bottom of seeds/ONBOARDING.md:
- New completion criteria: plans/health.md exists and differs from its
  template; ≥1 goal row exists; dietary AND physical constraint
  categories answered (rows or confirmedNone sentinel — keep the
  existing sentinel mechanism); height + baseline body metrics present.
- The injected string must name OUTCOMES, never enumerate form fields
  (the agent recites whatever this line says — that's the v1 bug).
  Example shape: "Profile gap: no confirmed health plan yet — counsel
  conversation, not a form." Keep the null-when-complete contract and
  the existing call sites unchanged.

## 4. Router (server/src/runtime/router.ts) — separate commit
Flip `USER_TURN_ROUTE` from 'default' to 'deep' (Opus for the main user
loop; effort stays xhigh). This is a deliberate one-week experiment Ben
agreed to; note that in the commit message so it's easy to revert.

## 5. Live-memory sync — the deployment gotcha (investigate, then solve)
Templates seed the memory dir only where files don't already exist, so
the DEPLOYED Cabinet's memory will not pick up any of this on its own.
Find how MemoryStore materializes templates, then add an idempotent
sync path (script or startup step) that, for this release: writes the
new files (CHARTER, PLAYBOOK, RHYTHM, TUNING, plans/health.md),
replaces VOICE.md / USER.md / ONBOARDING.md / IDENTITY.md, and removes
SOUL.md — preserving any files the live agent has since modified that
aren't part of this release. Ben's existing live USER.md/GOALS.md may
contain post-seed edits from his onboarding chat: DO NOT clobber
silently — if live content differs from the OLD template (i.e., the
agent wrote real data), stage the replacement and list the diff in the
PR description for Ben to resolve.

## 6. Verify + PR
- `npm run build` and `npm test` (workspace root of apps/cabinet).
- Grep the repo for remaining references to SOUL.md or butler-era
  phrasing ("steward", "old-world") in code, docs/AgentArchitectureV2.md
  §s that describe the persona, and web/ UI strings; update doc
  references so the spec matches the code.
- Open the PR with a description summarizing: what changed, the
  live-memory sync behavior, the router experiment, and any staged
  diffs from step 5 needing Ben's eyes.

Content questions are already settled with Ben — if something is
genuinely ambiguous mechanically, prefer the smallest faithful change
and flag it in the PR description rather than blocking.
