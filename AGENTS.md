# AGENTS.md

Guidance for AI agents working in this repo (opencode, Codex, Cursor, …).
Claude Code loads the same content via `CLAUDE.md`; the two are companions,
not duplicates:

- **[`CLAUDE.md`](CLAUDE.md) is the canon**: architecture invariants,
  deliberate decisions ("do not fix"), the numbered-plan pattern
  (`plans/`, no backlog folder anymore), testing conventions, and the rule
  that docs chapters update in the same commit. Read it before changing code.
- This file holds what CLAUDE.md doesn't: environment quirks and
  cross-cutting working habits proven out in real sessions.
- Directory-specific playbooks: [`scripts/`](scripts/AGENTS.md) (renderer +
  audio measurement), [`src/framewise-lite/`](src/framewise-lite/AGENTS.md)
  (component authoring + test traps).

## Environment quirks (this machine)

- The system Chrome install hangs headless here. Always point the renderer at
  Chrome for Testing:
  `CHROME_PATH="/Users/jmcadams/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"`
  or pass `--chrome <path>`. (`--list` needs neither.)
- ffmpeg 8.0 is on PATH; renderer preflights it.
- Node 22; `npx tsc -b` / `npm run typecheck` is fast enough to run between edits.

## Working habits that paid off

- **Typecheck doc/tutorial snippets before publishing them.** Assemble every
  code example into a scratch `.tsx` under `src/`, run `npm run typecheck`,
  delete the file. This caught two broken examples pre-publication in
  `docs/tutorial.md` (a volume envelope that silently extrapolated past its
  range; an easing form that needed confirming).
- **Gates are fixed, not silenced** (from CLAUDE.md, repeated because agents
  trip on it): an eslint-disable must be single-line with a comment saying why
  the pattern is safe _here_.
- **When a lint rule forces a restructure**, prefer deriving state during
  render or setting state only inside async callbacks over disabling the rule
  — see `CompositionView`'s `settledText` pattern in `src/App.tsx` for the
  worked example.
- **Never put freshly-created objects in effect dependency arrays** (e.g. the
  result of `parsePropsInput`) — new identity per render means the effect loops
  forever. Depend on primitives and re-parse inside the effect body.
- **The queue is gone**: review findings go straight through the plan pattern
  — write `plans/NNN-*.md`, execute, flip the row in `plans/README.md`.
