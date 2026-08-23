# Plan 026 — `assetPath` containment check

**Status:** DONE (2026-08-23) — `assetPath` now resolves the target against
`publicDir` and throws "resolves outside the public dir — path traversal is
not allowed" on escape; return shape unchanged for legitimate paths. The
traversal characterization test was flipped to expect the throw, plus deep
(`a/../../…`), absolute-with-traversal, and positive nested-path cases.
Verify green at 277 tests; WithAudio still-render sanity-checked live
(staticFile assets flow through ffmpeg inputs as before). Phase 3 complete.
**Priority:** P3 · **Effort:** S · **Risk:** LOW (one function; behavior changes only for traversal attempts)
**Depends on:** none open
**Category:** direction (Phase 3 item 3 in `docs/OVERVIEW.md` §14; audit note "strips only a leading `/`")

## Why

`assetPath()` strips a leading slash then joins onto `publicDir`, so a crafted
composition asset reference like `../etc/passwd` resolves OUTSIDE the public
dir (pinned by characterization test). Local-CLI threat model only — but the
check is one line, the audit flagged it, and OffthreadVideo now feeds these
paths to ffmpeg on every frame.

## Change

After stripping the leading slash, resolve the target against `publicDir` and
require it to stay within it; throw with an actionable message otherwise.
Return shape for legitimate paths is unchanged (all callers keep working).

## Steps

1. Implement the check in `render-lib.mjs`.
2. Flip the traversal characterization test to expect a throw; add deep/sneaky
   traversal cases and a positive nested-path case.
3. `npm run verify`; confirm a live render still works (any comp using
   `staticFile`, e.g. WithAudio still).
4. OVERVIEW Phase 3 row ✅ (Phase 3 complete); plans row DONE.

## STOP conditions

- Any caller needing the old escape behavior → stop and report.

## Done means

Containment enforced + tested; verify green; live render sanity-checked;
plan header + row DONE; Phase 3 fully complete.
