# Plan 014: Upgrade React 18.3 → 19 (with matching types)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- package.json package-lock.json`
> If react/react-dom versions already changed, STOP (done elsewhere).

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (framework bump; mitigated by the plan-004 test coverage)
- **Depends on**: plans/004-media-component-tests.md (land the media tests first — they cover exactly the effect/flushSync paths a React bump could disturb)
- **Category**: migration
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

The repo teaches React patterns against React 18.3 — the bridge release whose
purpose is surfacing React 19 deprecations. Staying is safe but increasingly
dated for a teaching codebase. The APIs actually used all carry forward
(`createRoot`, `flushSync`, `useSyncExternalStore`, `useId`, layout effects),
so the blast radius is small; the main value is teaching against current React
and unblocking future ecosystem bumps. Low urgency — that is why this is P3.

## Current state

- `package.json:15-28` — `react`/`react-dom` `^18.3.1`; `@types/react`
  `^18.3.12`, `@types/react-dom` `^18.3.1`; `@vitejs/plugin-react` `^4.3.4`
  (React-19 compatible); `vitest` `^3.2.6` + `jsdom` `^29.1.1` (compatible).
- React API usage inventory (verified by reading; re-grep before starting):
  - `createRoot`: `src/main.tsx`, `src/render/main-render.tsx:69`, and the
    three jsdom test harnesses.
  - `flushSync`: `src/render/main-render.tsx:2,78`,
    `src/compositions/AsyncImage.tsx:2,82` — still exported from `react-dom`
    in 19.
  - `act` imported **from `react`** in tests (`Player.test.tsx:4`,
    `delay-render.test.tsx:3`) — already the React-19-preferred import; no
    change needed.
  - `IS_REACT_ACT_ENVIRONMENT` set in test files — unchanged in 19.
  - No `propTypes`, no `defaultProps` on function components (React-19
    removals) — `defaultProps` in this repo is a plain field on the
    composition registry (`src/render/registry.ts:21`), not the React feature;
    it is unaffected. Do not rename it.
  - No `ReactDOM.render`, no string refs, no legacy context.
- Known React 19 typing change that may bite: `useRef<T>(null)` now yields
  `RefObject<T | null>`; ref-prop variance is stricter. Files using element
  refs: `Player.tsx`, `Img.tsx`, `Audio.tsx`, `Video.tsx` (and
  `useMediaSync.ts` if plan 011 landed).

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Upgrade   | `npm install react@^19 react-dom@^19 @types/react@^19 @types/react-dom@^19` | exit 0, no peer errors |
| Full gate | `npm run verify` | exit 0 |
| Render smoke (needs Chrome+ffmpeg) | `npm run render -- --comp AsyncImage --out out/p014.mp4` | completes; frame 0 shows resolved content (the delayRender path still gates) |

## Scope

**In scope**:
- `package.json`, `package-lock.json` (the four packages above ONLY)
- Minimal type-level fixes the bump forces (ref types, event types) — no
  behavioral edits
- `plans/README.md` (status row)

**Out of scope**:
- Bumping vite/vitest/jsdom/puppeteer-core or any other dependency.
- Adopting new React 19 features (no `use()`, no ref-as-prop refactors, no
  Actions) — this is a compatibility bump, not a modernization.
- `docs/code/` chapters (no API this repo teaches changes name; if you find a
  chapter contradicting React 19 behavior, report it, don't edit).

## Git workflow

- Branch: `advisor/014-react-19-upgrade`
- Commits: (1) the dependency bump, (2) any forced type fixes.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Bump

Run the upgrade command from the table. Inspect `npm ls react react-dom` —
single copies, both 19.x.

**Verify**: `npm ls react react-dom` → one version each, `19.x`, no `invalid` markers.

### Step 2: Typecheck and fix forced type errors only

Run `npm run typecheck`. Expected classes of error and the sanctioned fixes:

- `RefObject<HTMLX | null>` mismatches → adjust the receiving signature (e.g.
  a hook parameter) to include `| null`; do NOT scatter non-null assertions.
- `React.KeyboardEvent` / event-type strictness in `Player.tsx` → adjust the
  annotation, not the logic.
- Anything else: apply the smallest type-level change; if a fix would change
  runtime behavior, STOP.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Test suite + StrictMode double-check

**Verify**: `npm test` → all pass (51+ tests, plus plans 004/012/013 additions
if landed). Pay attention to the delayRender/StrictMode balancing tests and
the Player fake-rAF tests — these are the React-behavior-sensitive ones. Then
`npm run verify` → exit 0.

### Step 4: Render smoke (if Chrome+ffmpeg available)

Run the AsyncImage render from the table. The `flushSync`-inside-`setTimeout`
pattern (`AsyncImage.tsx:78-84`) and the synchronous-commit guarantee that
`main-render.tsx:78` depends on are the two things a React major could subtly
change; the render completing with frame 0 showing "Fetched headline ✨" (not
"Loading…") proves both survived. If no Chrome/ffmpeg, say so in the report —
the jsdom delay-render tests are the fallback evidence.

## Test plan

No new tests — this plan rides on the existing suite (and is deliberately
sequenced after plan 004 so the media components are covered during the bump).

## Done criteria

- [ ] `npm ls react` → 19.x, single copy
- [ ] `npm run verify` exits 0
- [ ] Diff outside package.json/package-lock.json is type-annotation-only
- [ ] `plans/README.md` status row updated

## STOP conditions

- Peer-dependency conflict from `@vitejs/plugin-react` or `vitest` (would
  force bumping out-of-scope packages — report the version matrix instead).
- Any test failure whose fix is not a pure type annotation — especially in
  delay-render/StrictMode tests (that would be a real behavioral change in
  React worth reporting, not patching around).
- More than ~10 files need type fixes (the "small blast radius" premise was
  wrong).

## Maintenance notes

- `eslint-plugin-react-hooks` (plan 007) may warrant a bump for React-19 rule
  updates once this lands — note it in your report if lint warns.
- Reviewers: confirm no `use client`/new-feature creep; this is strictly a
  version bump.
