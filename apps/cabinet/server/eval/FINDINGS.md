# Corpus measurements — 2026-08-10

Structural facts about the first month of Cabinet, measured before any prompt
changes. **Counts and shapes only — no transcript content.** This file is in a
public repo; the turns themselves live in the gitignored data tree.

Corpus: 2026-07-12 → 2026-08-10, 43 chats, 978 messages.

## 1. The desk register has never engaged

| `chat.register` | chats | chats with ≥1 real Ben turn |
|---|---|---|
| `counsel` | 9 | 9 |
| never set | 34 | 9 |
| `desk` | **0** | **0** |

Not "rare" — **zero, in a month**. Every chat Ben has actually talked in is
either `counsel` or has no register at all.

This matters more than a stale column would, because register is not
cosmetic: `runtime/register.ts` classifies, and the result drives effort and
the length rules in `VOICE.md` and `TURN_DISCIPLINE`. The entire desk half of
a deliberately two-register design has never run in production.

Two candidate causes, both in the code rather than the prompt, and the fix
differs:

- `classifyMessage` is documented as biased toward counsel because
  "misrouting counsel→desk is the costly failure". `COUNSEL_MARKERS` wins
  outright at any length, and `DESK_MAX_CHARS = 160`. The bias may simply be
  strong enough to be absolute.
- Or the classifier returns `desk` and nothing persists it. 34 never-set
  chats is consistent with a write that does not happen.

**Do not fix this by loosening the classifier until we know which.** They
have opposite remedies, and the second would make the first change harmful.

## 2. Replies are long, and the tail is extreme

Assistant message size (`parts` JSON, chars — a proxy, not token count):

| p25 | p50 | p90 |
|---|---|---|
| 396 | 844 | **47,153** |

In the 40-turn sample: median Ben turn 195 chars, median Cabinet reply 1,337 —
roughly **7×**.

Consistent with Anthropic's documented Opus 5 behaviour: *"its default
user-facing responses run longer than prior models', and raising or lowering
effort does not reliably change visible response length. Prompt explicitly for
conciseness instead."* Cabinet does prompt for it, in `TURN_DISCIPLINE` — but
that instruction is scoped to desk register, which per §1 never engages. The
length rule has no arm to apply to.

The p90 is a separate question from the median. A 47k-char reply is not a
verbose answer; it is a different kind of event, and worth identifying before
treating this as a tuning problem.

## 3. Three of forty turns got no reply

7.5% of sampled turns have no assistant message after them. Some will be Ben
sending two messages in a row; some will be crashed or abandoned turns. The
extractor keeps them (`reply: null`) precisely because dropping them would
hide the failures most worth studying.

Not yet diagnosed. `perf_span` and `pending-turn.json` should distinguish the
cases.

## 4. The corpus is smaller than the row count suggests

466 `role='user'` rows, but only **136** are Ben. The rest are heartbeat and
cron turns (NULL author) and a peer agent. Any analysis filtering on
`role='user'` alone is ~70% the system talking to itself.

136 turns is enough for error analysis. It is **not** enough to split into
train and held-out eval sets, so early eval cases will have to come from the
spec (`CHARTER`, `VOICE`, `PLAYBOOK`) rather than from held-out data.

## What this does not tell us

These are structural measurements, not quality judgements. Nothing here says a
single reply was *wrong* — that needs the labelling pass in `TAXONOMY.md`, and
Ben's own read of turns that were technically fine and still not what he
wanted.

The value of §1 is that it is a finding no amount of reading the prompt files
would have produced. `register.ts` looks well designed on the page. It has
just never done the thing it was designed to do.
