# Plan 008: Author CLAUDE.md — agent guidance for a repo developed by agents

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `ls CLAUDE.md AGENTS.md 2>/dev/null`
> If either file already exists, STOP — reconcile with its author instead of
> overwriting.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (content assumes plan 001's scripts; see Step 1 note)
- **Category**: dx
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

This repo is developed largely via agent-executed plans (see `backlog/README.md`
— nine completed review items — and `plans/`). There is no `CLAUDE.md`/`AGENTS.md`,
so every agent re-derives the build/test/render commands, the "frame is a pure
function" invariant, the docs-mirror-code contract, and the deliberate fidelity
deviations from scratch — and risks "fixing" intentional behavior (no-deps
effects, extend-by-default interpolate). One file ends that.

## Current state

Facts to encode (all verified at `985ca38` — re-verify the command list
against the live `package.json` before writing):

- **What this is**: framewise-lite, a minimal educational reimplementation of
  Framewise's core ("a video is a pure function of the frame number").
  Library in `src/framewise-lite/`, compositions in `src/compositions/`,
  registry + render entry in `src/render/`, Node renderer in
  `scripts/render.mjs`, teaching chapters in `docs/code/` (11 chapters).
- **Commands**: `npm run dev` (Vite preview app), `npm test` (vitest),
  `npm run build` (tsc + vite build), `npm run render -- --comp <id> --out
  <path>` (needs system Chrome + ffmpeg; `--list` needs neither). If plan 001
  landed: `npm run typecheck`, `npm run verify`. If plan 007 landed:
  `npm run lint`, `npm run format`.
- **Architecture invariants** (the things an agent must not break):
  1. `useCurrentFrame()` only reads context; it knows nothing about clocks.
  2. Preview and export MUST render through the same `CompositionHost`
     (`src/framewise-lite/CompositionHost.tsx`); preview passes `playback`,
     render passes none — a null PlaybackContext is how `<Audio>`/`<Video>`
     detect render mode.
  3. Determinism: a frame is a pure function of its number. Compositions use
     `random(seed)` (never `Math.random()`); the renderer verifies a sha256
     frame-set hash, identical at any `--concurrency`.
  4. The no-deps `useLayoutEffect`s in `Audio.tsx`/`Video.tsx` and the
     layout-effect (not useEffect / not useState-initializer) pattern in
     `Img.tsx` are load-bearing — the file comments explain why; don't
     "fix" them to satisfy lint instincts.
  5. `delayRender` timeout constants have a single source of truth:
     `src/framewise-lite/delay-render-defaults.mjs` (+ `.d.mts`), shared by TS
     and `render.mjs`; the renderer's backstop must fire AFTER the in-app
     labeled error (ordering contract).
- **Deliberate fidelity decisions** (documented, do not "correct"):
  `interpolate` defaults to `extend`, not clamp; `spring` is verbatim upstream
  math except `overshootClamping` clamps in output space (documented
  deviation); `posterize` is an extension not in upstream.
- **Docs-lockstep rule**: `docs/code/` chapters mirror the source; a change to
  a module with a chapter updates the chapter in the same commit; new
  primitives get a chapter/section and an entry in the `docs/code/README.md`
  map.
- **Test conventions**: vitest globals on; DOM suites start with
  `// @vitest-environment jsdom` and set `IS_REACT_ACT_ENVIRONMENT`; tests
  colocated as `src/**/X.test.ts(x)`; drain the delayRender registry in
  `afterEach` (see `delay-render.test.tsx:17-21`).
- **Plans workflow**: implementation plans live in `plans/` with a status
  index at `plans/README.md`; executors update their row when done.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Sanity  | `npm test` | all pass (no code touched) |
| Content check | `grep -c "npm run" CLAUDE.md` | ≥ 4 |

## Scope

**In scope**: `CLAUDE.md` (create), `plans/README.md` (status row).

**Out of scope**: everything else. No source, no docs/code changes, no README
changes.

## Git workflow

- Branch: `advisor/008-claude-md`
- One commit: `Add CLAUDE.md with commands, invariants, and conventions`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write CLAUDE.md

Structure (keep it under ~120 lines — an agent context file, not a novel):

```markdown
# CLAUDE.md

## What this is
(two sentences + the one idea: video = pure function of frame)

## Commands
(table: dev / test / typecheck / verify / build / render / lint — with the
Chrome+ffmpeg prerequisite note for render. BEFORE WRITING, check which
scripts actually exist in package.json and list only those.)

## Architecture invariants — do not break these
(the five invariants from Current state, each 1-3 lines with file pointers)

## Deliberate decisions — do not "fix" these
(the fidelity list; one line each, pointing at the source comments)

## Docs are the product
(the lockstep rule; where the map lives)

## Testing conventions
(the four conventions, with delay-render.test.tsx cited as the exemplar)

## Plans
(one paragraph: plans/ + status index + executors update their row)
```

Every claim must carry a `file` or `file:line` pointer so future agents can
verify instead of trusting.

**Verify**: `grep -c "src/" CLAUDE.md` → ≥ 8 (pointers present).
**Verify**: every `npm run X` mentioned exists: `node -e "const p=require('./package.json').scripts; for (const m of require('fs').readFileSync('CLAUDE.md','utf8').matchAll(/npm run ([a-z:]+)/g)) if(!p[m[1]]) {console.error('missing script: '+m[1]); process.exit(1)}; console.log('ok')"` → `ok`.

### Step 2: Sanity

**Verify**: `npm test` → unchanged, all pass. `git status` → only `CLAUDE.md`
and `plans/README.md` changed.

## Test plan

None — content file. The two grep/node checks above are the gates.

## Done criteria

- [ ] `CLAUDE.md` exists at repo root, ≤ ~150 lines
- [ ] All referenced npm scripts exist (Step 1 node check prints `ok`)
- [ ] All five invariants and the three fidelity decisions appear
- [ ] Only `CLAUDE.md` + `plans/README.md` modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `CLAUDE.md` or `AGENTS.md` already exists.
- You cannot verify a claim from this plan against the live code (e.g. a file
  was renamed) — write only what you verified; report the mismatch.

## Maintenance notes

- When plans 001/007 land (if not already), extend the Commands table with
  `verify`/`lint` — whichever executor lands last reconciles.
- Reviewers: check the invariants section against the actual file comments —
  CLAUDE.md must summarize them, not contradict them.
