# eval — error analysis and, later, the eval harness

Cabinet's prompt architecture is being rewritten. This directory exists so
that rewrite is driven by what actually goes wrong rather than by anyone's
reading of the prompt files.

Order: **error analysis → eval dataset → redesign.** Not the reverse.

| File | What it is |
|---|---|
| `extract.mjs` | Pulls a deterministic stratified sample of Ben's real turns into the gitignored data tree |
| `TAXONOMY.md` | The labelling scheme, and what does *not* count as an error |
| `FINDINGS.md` | Corpus-level measurements — counts and shapes only |

```
node eval/extract.mjs          # → /srv/benloe/data/cabinet/eval/turns.jsonl
EVAL_LIMIT=80 node eval/extract.mjs
```

## Personal data

Every turn is Ben's health, money, and mood. **This repo is public.** Output
goes to `data/`, which is gitignored; nothing here may contain a real value,
including comments, tests, and fixtures — those are published documents too.
(The standing rule lives in Cabinet's own `PLATFORM.md`, in the gitignored
memory tree rather than in this repo, so it is restated rather than cited.)
There is deliberately no mode that prints a transcript to stdout, and
`assertSafeOutput` refuses any output path inside this repo —
`cabinet-deploy.sh` runs `git add apps/cabinet` on every self-deploy.
