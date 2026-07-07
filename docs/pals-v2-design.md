# PALS v2 — Product, UX, Feature & Brand Design (Phase 2)

> Status: design proposal, 2026-07-07. Supersedes the V1 chat-only UI.
> V1 shipped the *engine* (agent runtime, memory, domains, proactivity,
> autonomy). V2 designs the *product* around it.

---

## 0. The reframe (read this first)

**V1's UI is a chat-thread list/detail. That is the wrong spine.** It looks like
ChatGPT or Claude.ai because it *is* structurally the same thing: a sidebar of
conversations and a message log. But PALS is not a general chatbot you visit to
ask questions. Underneath, it is already something far more specific:

- It **knows** — ~30 life-domain data models plus a three-layer memory of who
  you are.
- It **acts** — bash, code, deploys, domain loggers, and now autonomous
  execution.
- It's **always on** — heartbeat, morning briefing, evening check-in, weekly
  review, maintenance. It does work while you're not looking.
- It **runs on infrastructure you own** — it is the platform engineer for your
  server, including itself.

A message log expresses none of that. Proactive work is invisible until you
open a thread. Your life's structured state (macros, weight trend, tasks due,
money flags, med refills) is buried in scrollback. The agent's autonomous
actions are untraceable. The thing that makes PALS *PALS* is exactly what the
chat UI hides.

**The product metaphor for v2:** PALS is your **chief of staff**, and this app
is your **situation room** — not a chat window. You are the principal; PALS is
the staff that keeps your affairs, briefs you, watches the things you can't, and
executes on your behalf. Conversation is *one* way you direct it, always
available — but it is not the whole building.

Everything below follows from that reframe.

### On the name

`PALS` reads like a buddy-chatbot brand — friendly, generic, sits next to
"Clippy." The system deserves an identity that says *private operations console
run by a trusted staff*. Recommendation, in priority order:

1. **Cabinet** (recommended). Double meaning that fits exactly: the *cabinet*
   where you keep your records (memory + domain data), and the *cabinet* of
   ministers/advisors that runs your affairs on your behalf. You are the
   principal; PALS is your cabinet. Ownable, warm-but-capable, anti-chatbot.
   `cabinet.benloe.com`.
2. **Keep** the name PALS but re-base it from "pal/buddy" to
   "Personal Autonomous Life Steward" and elevate the brand. Zero infra churn.
3. **Steward** / **Chancery** — alternates in the same register.

Infra names (`pals-api`, service dirs) can stay internal regardless; this is a
*product/brand* rename, decoupled from deployment. **This doc uses "PALS" as a
placeholder;** the recommendation is Cabinet. Final call is Ben's — it's cheap
to keep PALS and the whole design works either way.

---

## 1. Product design — user stories

Format: *As Ben, I want ⟨capability⟩ so that ⟨outcome⟩.* Grouped by epic.
"The system" = PALS acting on its own.

### Epic A — Orientation & proactive briefing
- As Ben, I want a single "today" view the moment I open the app, so that I see
  what needs my attention without asking.
- As Ben, I want the morning briefing to be the hero of that view (not an email
  or a buried message), so that my day starts oriented.
- As Ben, I want the system to surface anomalies first (a missed med, a budget
  overrun, a lineup with an injured starter), so that the important thing isn't
  buried under the routine.
- As Ben, I want to dismiss, snooze, or act on each surfaced item inline, so
  that the briefing is a worklist, not a wall of text.
- As Ben, I want an evening check-in that reflects the day back (what I logged,
  what I skipped, tomorrow's shape), so that I close loops.
- As Ben, I want the system to tell me when there's genuinely nothing to do, so
  that silence is trustworthy, not ambiguous.

### Epic B — Directing the agent (conversation & command)
- As Ben, I want to issue an instruction from anywhere in the app via one
  keystroke, so that I never have to "go to the chat" to act.
- As Ben, I want to talk to the system *about the thing I'm looking at* (a
  domain, a card, a chart), so that context is implicit and I don't re-type it.
- As Ben, I want a conversation to be able to *produce durable objects* (a plan,
  a saved view, a scheduled job, a built app), so that chat isn't ephemeral.
- As Ben, I want to see the system's reasoning and its tool actions as it works,
  so that I trust and can interrupt it.
- As Ben, I want past conversations to be searchable and to resurface their
  outcomes, so that I can find "that thing we figured out."
- As Ben, I want to hand the system a long-running goal and walk away, so that
  it makes progress across days without me re-prompting.

### Epic C — Nutrition & food
- As Ben, I want to log a meal in natural language ("two eggs and toast") and
  have it estimate macros with a confidence band, so that logging is frictionless.
- As Ben, I want a glanceable macro ring for today vs. targets, so that I know
  where I stand at a glance.
- As Ben, I want the system to know my pantry and flag items expiring soon, so
  that I waste less food.
- As Ben, I want it to build a grocery list from a recipe or a week's plan, so
  that shopping is one tap.
- As Ben, I want it to notice patterns ("protein low on training days") and
  raise them in weekly review, so that I improve over time.

### Epic D — Training & body
- As Ben, I want to log workouts and sets quickly, so that training data
  accrues without ceremony.
- As Ben, I want a weight/body-metric trend chart with a sensible smoothing, so
  that noise doesn't spook me.
- As Ben, I want the system to correlate training, nutrition, sleep, and weight
  and narrate what it sees, so that I get coaching, not just charts.

### Epic E — Health, insurance & meds
- As Ben, I want medication refills tracked with a low-supply nudge, so that I
  never run out.
- As Ben, I want claims and prior-auths tracked against my HSA plan, so that I
  know what I owe and what's pending.
- As Ben, I want to drop a lab-result PDF and have values extracted and trended,
  so that my health data is mine and legible.
- As Ben, I want the system to flag when a claim looks wrong vs. my plan's SPD,
  so that I catch billing errors.

### Epic F — Money
- As Ben, I want to import transactions (CSV) and have them categorized, so that
  budgeting isn't manual.
- As Ben, I want budget-vs-actual per category with early overrun warnings, so
  that surprises are rare.
- As Ben, I want subscriptions tracked with renewal alerts, so that I kill zombie
  spend.
- As Ben, I want holdings tracked at a glance (not day-trading, just awareness),
  so that net worth is legible.
- As Ben, I want a price-watch on specific items to alert when a target hits, so
  that I buy well.

### Epic G — Life admin, tasks & people
- As Ben, I want tasks with due dates surfaced by urgency, so that nothing slips.
- As Ben, I want the system to turn a vague intent ("sort out the car
  registration") into a concrete task with steps and a deadline, so that
  planning happens for me.
- As Ben, I want a lightweight contacts/relationship memory (who, last contact,
  context), so that I keep up with people.
- As Ben, I want a reading list that the system can summarize and resurface, so
  that saved articles don't die.

### Epic H — Fantasy sports
- As Ben, I want lineup-deadline alerts when a starter is injured/inactive, so
  that I never take a zero.
- As Ben, I want the system to propose waiver/lineup moves with reasoning, so
  that I get an edge without living in the app.

### Epic I — Platform engineering (PALS operates the server)
- As Ben, I want to ask the system to build/modify an app on my server and watch
  it do it, so that I can build in public with an agent.
- As Ben, I want to see what's deployed, what's running, and what it changed, so
  that I have operational awareness.
- As Ben, I want the system to improve *itself* — its own features, UX, and
  security — and deploy the changes, so that it compounds.
- As Ben, I want a visible record of every action it took autonomously, so that
  I can audit and roll back.

### Epic J — Memory & recall (the second brain)
- As Ben, I want to inspect and edit what the system believes about me, so that
  its model of me stays correct.
- As Ben, I want corrections I make to become durable lessons, so that I never
  correct the same thing twice.
- As Ben, I want to ask "what do you know about X" across all my data and past
  conversations, so that recall is unified.
- As Ben, I want the system to cite where a belief came from, so that I can
  trust or challenge it.

### Epic K — Trust, autonomy & control
- As Ben, I want a live feed of what the system is doing and did, so that
  autonomy is transparent rather than opaque.
- As Ben, I want to set standing directives in plain language that shape all its
  behavior, so that I steer without micromanaging.
- As Ben, I want one-tap rollback of a recent action or deploy, so that
  recoverability is real and immediate.
- As Ben, I want to pause or redirect the agent mid-task, so that I stay in
  control.

### Epic L — Access & presence (single-user, always-on, mobile)
- As Ben, I want the app installable on my phone with the day's state on the
  home screen, so that it's ambient.
- As Ben, I want to be the only person who can ever reach it, so that it's
  genuinely private.
- As Ben, I want push notifications for the few things that truly need me, so
  that I can ignore the app until it matters.

---

## 2. UX strategy — from "chat app" to "situation room"

### 2.1 The paradigm

Replace the *thread-list spine* with a **five-surface console**. Chat is
demoted from "the app" to "a pervasive modality." The spine becomes:

```
┌────────────────────────────────────────────────────────────┐
│  ▸ command bar (⌘K from anywhere: type/speak an intent)     │
├──────────┬─────────────────────────────────────────────────┤
│          │                                                  │
│  RAIL    │   ACTIVE SURFACE                                 │
│          │                                                  │
│  Today   │   (Today | Domain | Ops | Brain | Threads)       │
│  Domains │                                                  │
│  Ops     │                                                  │
│  Brain   │                                                  │
│  Threads │                                                  │
│          │                                                  │
├──────────┴─────────────────────────────────────────────────┤
│  ▸ agent presence strip (what PALS is doing right now)      │
└────────────────────────────────────────────────────────────┘
```

The **five surfaces**:

1. **Today** (home / default). The proactive worklist: the current briefing as
   an interactive card stack, glanceable domain vitals, attention items you can
   act on inline. This is what opens. Answers "what needs me?" before you ask.

2. **Domains.** One deep view per life domain (Nutrition, Training, Health,
   Money, Admin, People, Play). Each is a *dashboard + narrative*: the
   structured data (rings, trends, ledgers) **plus** the agent's written read on
   it. This is where the ~30 data models finally have a home.

3. **Ops** (the trust surface). A live, filterable feed of everything the agent
   does and did — proactive jobs, tool calls, deploys, autonomous actions —
   with the audit trail, diffs, and **one-tap rollback**. In an autonomous
   system, *transparency replaces approval*. This surface is what makes
   "no permission gates" safe and legible.

4. **Brain.** What PALS knows about you: curated memory (editable), facts,
   lessons, and unified recall search across all data + past conversations, with
   provenance. Your second brain, inspectable.

5. **Threads.** Conversations, preserved as a *record* — searchable, with their
   produced artifacts attached. Not the spine; the archive.

### 2.2 The two pervasive elements

- **Command bar (⌘K / long-press on mobile).** The universal entry point. Type
  or speak an intent from any surface; it routes: a question → inline answer or
  thread; a log ("2 eggs") → domain write + confirmation; a build request →
  an Ops task you can watch; "show me…" → a domain view. *You never "go to the
  chat" to act.* Chat is what happens when an intent needs a conversation.

- **Agent presence strip.** A persistent, quiet strip showing what PALS is doing
  *right now* (idle / thinking / running a tool / deploying), expandable to the
  live action stream. Makes an always-on autonomous agent feel present and
  interruptible instead of hidden.

### 2.3 Interaction principles

- **Proactive-first.** The default screen shows what the system surfaced, not an
  empty prompt. The blank composer is not the front door.
- **Context is implicit.** Talking while looking at Nutrition is *about*
  nutrition. Cards carry their own "discuss / act" affordances.
- **Structured over prose.** Domain answers render as instruments (rings,
  trends, ledgers, worklists), not paragraphs — with prose as the *read*, not
  the data.
- **Every autonomous action is legible and reversible.** Ops feed + rollback is
  the price of autonomy and the thing that makes it comfortable.
- **Calm.** Notifications are rare and earned. Silence means "handled."
- **One person, every pixel.** No multi-user affordances, no onboarding, no
  generic empty states. This is a bespoke instrument for one expert.

---

## 3. Feature design — how each thing works

### 3.1 Today (home)
A vertical stack of **living cards**, ordered by urgency the agent computes:
- **Briefing card** — the morning/evening briefing rendered as sections, each
  with inline actions (snooze, done, "tell me more" → opens a thread seeded with
  that context).
- **Attention cards** — one per anomaly (low med supply, budget overrun, lineup
  risk, expiring pantry). Each is a *typed widget* with a primary action.
- **Vitals row** — compact instruments: macro ring, weight sparkline, tasks-due
  count, cash-flow arrow. Tap → the domain.
- **Ambient line** — "PALS also did 3 things overnight →" links to Ops.
Empty state is a *real* statement: "Nothing needs you. Last swept 6m ago."

### 3.2 Domain views (template)
Each domain view = **Instruments (top) + Narrative (mid) + Log (bottom)**:
- *Instruments*: the domain's key structured widgets (Nutrition: today's ring +
  week bars + pantry-expiry; Money: budget-vs-actual bars + subscription
  calendar + net-worth line).
- *Narrative*: the agent's current written read, regenerated on weekly review
  and on demand ("what's my training telling you?").
- *Log*: the raw entries, editable, with a natural-language add bar scoped to
  this domain.

### 3.3 Command bar routing
Intent classification (fast model) routes to one of: `answer` (inline),
`converse` (opens thread), `log` (domain write + toast), `navigate` (open a
view), `build/operate` (spawn an Ops task). Ambiguous → it asks, inline. Every
route is undoable.

### 3.4 Ops (autonomy's trust surface)
A reverse-chronological stream of **action records**, each: what, why (the
agent's reason), when, which surface/job triggered it, tier-label (from the
still-running classifier — now for *insight*, not gating), result, and diff
where applicable. Filters by domain / job / kind. **Rollback**: for reversible
actions (file edits, deploys, domain writes) a one-tap revert that uses git /
the backup snapshots / the audit inverse. This is the surface that lets Ben
sleep on full autonomy.

### 3.5 Brain
- *Memory files* rendered as editable cards (IDENTITY, PREFERENCES, GOALS,
  domain narratives) with edit-in-place → commits to the memory git repo.
- *Lessons* list with retire/promote.
- *Recall search*: one box over SQLite facts + episodic vectors + thread
  history, results grouped by source with provenance chips.

### 3.6 Threads
Conversation archive with full-text + semantic search. Each thread shows its
*produced artifacts* (built apps, saved plans, scheduled jobs) as attachments,
so a conversation's value outlives its scrollback. Auto-titled (already built).

### 3.7 Proactive plumbing → UI
The five jobs already exist; v2 gives them faces: heartbeat feeds the presence
strip and attention cards; briefings feed Today; weekly review regenerates
domain narratives and posts a "review ready" card; maintenance posts to Ops.

### 3.8 Notifications (PWA push)
Earned, rare, typed: refill-now, lineup-risk-within-3h, budget-overrun,
briefing-ready, action-needs-you (the rare non-reversible fork). Everything else
waits for the app.

---

## 4. Brand language (feeds Phase 4 / frontend-design)

**Concept: the campaign desk.** Not a sterile SaaS dashboard, not a chat
bubble stream — a **bespoke private operations desk**: the outfitted writing
desk of someone who runs things. Warm dark surfaces, brass and ink, paper
reserved for the few places you "sign," precision instruments (dials, rings,
rules) for data. It reads as *personal, owned, and capable* — the opposite of a
generic AI product. (V1's "night desk" tokens were an accidental step toward
this; v2 makes it deliberate and complete.)

- **Palette (draft):** deep walnut/ink ground; warm brass accent for the
  system's own voice and activity; aged-paper for signable/authored surfaces;
  a single alert vermilion. Two neutrals for text.
- **Type (draft):** a characterful humanist or transitional serif for headings
  and the system's "voice"; a precise grotesque/mono for data, labels, and
  instruments. The pairing itself is the personality — not Inter-on-everything.
- **Signature element:** the **instrument** — data rendered as a physical dial /
  ring / engraved rule, not a flat chart. The macro ring, the weight rule, the
  budget gauge are all members of one instrument family. This is what someone
  remembers.
- **Motion:** restrained and mechanical — the presence strip "breathes," an
  instrument needle settles, a card is "filed." No decorative flourish.

Design-system deliverables (Phase 4): tokens (color/type/space/radius/elevation),
an instrument component family, the card system, the command bar, the presence
strip, the five surface layouts — each with unit tests where logic warrants,
then the built v2.

---

## 5. What carries over vs. gets rebuilt

- **Keep (engine):** runtime, memory, domains, jobs, autonomy gate, SSE
  protocol, auto-titling, tier *classifier* (repurposed for Ops labeling).
- **Rebuild (product):** the entire web surface — from thread-list/detail to the
  five-surface console; introduce the command bar, presence strip, Today, Ops,
  Brain, and domain dashboards; new brand + instrument design system.
- **Add (gateway):** REST/SSE for domain reads (currently only chat/threads/
  approvals/events are exposed), an Ops/audit feed endpoint, recall search, and
  memory read/write. The UI needs data the API doesn't serve yet.

---

## 6. Open questions for Ben
1. **Name:** Cabinet (recommended), keep PALS, or another? Drives the brand.
2. **Surface priority:** is Today→Ops→Domains the right order of build, given you
   most want to *watch the autonomous system work*?
3. **Instrument aesthetic:** does "campaign desk / brass-and-ink instruments"
   resonate, or do you want a colder/high-contrast console instead? (Phase 4
   will mock both if unsure.)
