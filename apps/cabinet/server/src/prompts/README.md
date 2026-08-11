# Repo-sourced prompt layers

Markdown that goes into Cabinet's system prompt and lives **here**, under
review, rather than in the private memory directory at
`/srv/benloe/data/cabinet/memory/`.

The split is by privacy, not by importance:

| here (`src/prompts/`) | there (`data/cabinet/memory/`) |
|---|---|
| who Cabinet is, how this environment works | who Ben is, what he wants, what he has corrected |
| generic — nothing personal | personal — never in a public repo |
| changed by PR, diffable, revertible with the code that reads it | changed by Cabinet as it learns, committed to its own git repo |

`memory/index.ts`'s `PROMPT_CORE` is the manifest: an ordered list naming each
layer and which of the two roots it comes from. Adding a file here does
nothing until it appears in that list. The order in the list is the order the
model reads them in, and it is load-bearing — see the note on `CORRECTIONS.md`.

**This directory is empty of prompt content on purpose.** The loader landed
first, deliberately separate from any change to what Cabinet actually says, so
that moving a layer from `data/` to here is a one-line manifest edit whose
effect on the assembled prompt can be read in a diff. See
`docs/prompt-architecture.md`.

`README.md` is not a prompt layer and is never loaded — only files named in
the manifest are.

## Build

Copied to `dist/prompts/` by `npm run build`, the same way `db/migrations` is.
Paths resolve through `import.meta.dirname`, so the same code finds them when
running from source under `tsx` and from `dist/` in production. If you add a
file here and it is missing in production, check that the build's `cp` step
ran.
