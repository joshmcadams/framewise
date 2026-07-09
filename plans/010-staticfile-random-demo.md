# Plan 010: Make staticFile() and random() real — demo usage, walkthrough coverage, barrel hygiene

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- src/compositions src/framewise-lite/index.ts docs/code/README.md`
> Plan 006 should have landed (corrected docs map). Compare "Current state"
> excerpts on any drift; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/006-docs-composition-host.md (both edit `docs/code/README.md`)
- **Category**: docs / tech-debt
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

`staticFile()` and `random()` are exported public primitives (added in backlog
item 09) that **no composition uses and no walkthrough chapter teaches** — in a
repo whose demos are the documentation. `random()` in particular carries the
determinism story (why `Math.random()` would break the parallel-render
frame-hash guarantee) and currently exists only as a doc comment. Meanwhile the
barrel exports internal-only `subscribeToDelayRenders`. This plan wires both
primitives into the demos, adds walkthrough coverage, and tightens the barrel.

## Current state

- `src/framewise-lite/staticFile.ts` — `staticFile('photo.png')` → `'/photo.png'`
  (idempotent for already-rooted paths). `src/framewise-lite/random.ts` —
  seeded PRNG, `random(seed: number | string)` → deterministic `[0, 1)`;
  its header comment (lines 1-7) is the determinism rationale to teach.
- Hardcoded asset paths in compositions (the exact strings to replace):
  - `src/compositions/AsyncImage.tsx:49` — `<Img src="/photo.png" ...>`
  - `src/compositions/WithAudio.tsx:64` — `<Audio src="/bg.wav" volume={0.3} />`
  - `src/compositions/WithAudio.tsx:69` — `<Audio src="/blip.wav" volume={0.7} />`
  - `src/compositions/WithVideo.tsx:15` — `<Video src="/clip.mp4" ...>`
- `src/compositions/HelloWorld.tsx` — the flagship demo; `LoopingDot`
  (lines 105-131) is a white dot springing horizontally. It imports from
  `'../framewise-lite'` (the barrel) — follow that import style.
- `src/framewise-lite/index.ts:15-22` — the delay-render export block
  includes `subscribeToDelayRenders`; its only consumers are internal
  (`delay-render.ts` itself) and `delay-render.test.tsx`, which imports from
  `'./delay-render'` directly, NOT the barrel. Verify before removing:
  `grep -rn "subscribeToDelayRenders" src/ | grep -v "delay-render"` → must be empty.
- `docs/code/README.md` — chapter index + source-tree map (as corrected by
  plan 006). `docs/code/11-parallel-rendering.md` — the determinism chapter
  (byte-identical frame hash across concurrency) — natural home for the
  `random()` teaching. `docs/code/06-demo-and-wiring.md` — HelloWorld tour.
- Note: changing HelloWorld's rendered output is ACCEPTABLE (nothing pins the
  frame hash to a specific value; determinism means identical across workers,
  not immutable over time) — but keep the change visually small.

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Tests     | `npm test` | all pass |
| Full gate | `npm run verify` | exit 0 |
| Preview (manual) | `npm run dev` | demos look unchanged except the dot jitter |
| Determinism (needs Chrome+ffmpeg) | run twice: `npm run render -- --comp HelloWorld --concurrency 1 --out out/a.mp4` and `--concurrency 4 --out out/b.mp4` | identical `sha256` frame-hash lines |

## Scope

**In scope**:
- `src/compositions/AsyncImage.tsx`, `WithAudio.tsx`, `WithVideo.tsx`
  (staticFile for asset srcs — mechanical)
- `src/compositions/HelloWorld.tsx` (small `random()` usage)
- `src/framewise-lite/index.ts` (remove `subscribeToDelayRenders` from the barrel)
- `docs/code/06-demo-and-wiring.md`, `docs/code/11-parallel-rendering.md`,
  `docs/code/README.md` (teaching content + map annotations)
- `plans/README.md` (status row)

**Out of scope**:
- `staticFile.ts` / `random.ts` implementation changes.
- `scripts/render.mjs` (`assetPath` already agrees with the staticFile convention).
- New compositions or registry changes (keeps `--list` output stable).
- Removing `getPendingDelayRenders` or `useDelayRenderPending` from the barrel
  (both are genuinely public: renderer seam + Player badge).

## Git workflow

- Branch: `advisor/010-staticfile-random-demo`
- Commits: (1) compositions, (2) barrel, (3) docs.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Use `staticFile()` for every asset src

In the three compositions, import `staticFile` from `'../framewise-lite'` and
replace the four hardcoded strings, e.g.
`<Audio src={staticFile('bg.wav')} volume={0.3} />`. Since
`staticFile('bg.wav')` returns exactly `'/bg.wav'`, rendered output is
byte-identical — this is a pure convention refactor.

**Verify**: `grep -rn 'src="/' src/compositions/` → no matches.
**Verify**: `npm run verify` → exit 0.

### Step 2: Use `random()` in HelloWorld

Give `LoopingDot` a small deterministic per-cycle vertical jitter so the
primitive is visibly exercised:

```tsx
const cycle = Math.floor(frame / fps);
// Deterministic "randomness": same seed → same value in preview and in every
// parallel render worker. Math.random() here would break the frame-hash check.
const jitter = interpolate(random(`dot:${cycle}`), [0, 1], [-24, 24]);
```

and add `transform: translateX(${x}px) translateY(${jitter}px)` (adjust the
existing `transform`). Import `random` via the barrel alongside the existing
imports. Keep the comment — it's teaching material.

**Verify**: `npm run verify` → exit 0. Manual: `npm run dev`, HelloWorld's dot
jitters vertically once per second, identically on every replay of the same
frames (scrub back and forth — same frame, same position).

### Step 3: Barrel hygiene

Remove `subscribeToDelayRenders` from `src/framewise-lite/index.ts` (keep the
export in `delay-render.ts` itself — the hook and tests use it module-locally).
First run the guard grep from "Current state"; it must be empty.

**Verify**: `npm run verify` → exit 0 (typecheck catches any missed importer).

### Step 4: Walkthrough coverage

- `docs/code/06-demo-and-wiring.md`: where the chapter tours HelloWorld, add a
  short passage on the dot's `random('dot:' + cycle)` jitter — what
  `random(seed)` is and why compositions must never call `Math.random()`.
- `docs/code/11-parallel-rendering.md`: add a subsection ("Determinism needs
  seeded randomness") tying `random()` to the sha256 frame-hash guarantee —
  adapt the rationale from `random.ts:1-7`. Mention `staticFile()` briefly:
  assets resolve via the public-dir convention shared by Vite (serving) and
  `render.mjs`'s `assetPath` (mixing) — one sentence each, pointing at the
  source.
- `docs/code/README.md`: in the source-tree map, `staticFile.ts` and `random.ts`
  already exist (added by plan 006) but lack chapter annotations — add
  `(ch. 6, 11)` to each entry to match the style of other annotated entries.

**Verify**: `grep -rln "random(" docs/code/06-demo-and-wiring.md docs/code/11-parallel-rendering.md` → both files.
**Verify**: `grep -n "staticFile" docs/code/11-parallel-rendering.md` → ≥ 1 hit.

## Test plan

Existing suites cover both primitives (`staticFile.test.ts`, `random.test.ts`)
— no new unit tests required. The determinism render check (commands table) is
the integration gate where Chrome+ffmpeg exist; otherwise note the limitation.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `grep -rn 'src="/' src/compositions/` → empty
- [ ] `grep -rn "Math.random" src/ | grep -v "random.ts"` → empty (the only legitimate reference is the doc comment in `random.ts` explaining why NOT to use it)
- [ ] `grep -n "subscribeToDelayRenders" src/framewise-lite/index.ts` → empty
- [ ] Both docs chapters teach the respective primitive; map annotated
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The guard grep in Step 3 finds an external consumer of
  `subscribeToDelayRenders` — leave the barrel alone and report.
- `staticFile` and `assetPath` disagree for any current asset (they should
  not — both strip/add a single leading slash); if a render breaks on asset
  resolution, report rather than papering over.
- Plan 006 hasn't landed and your docs edits collide with its map rewrite.

## Maintenance notes

- Plan 016 (Easing) will also add demo usage to HelloWorld and a docs
  chapter — coordinate ordering via the index (this plan first).
- Reviewers: check the HelloWorld diff is visually small and the jitter is
  seeded by `cycle` (not by raw `frame`, which would flicker per frame).
