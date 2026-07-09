# Plan 005: Fix the Video render-seek race (same-frame recommit can unblock the capture early)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- src/framewise-lite/Video.tsx src/framewise-lite/Video.test.tsx`
> Plan 004 MUST have landed (Video.test.tsx exists with the race
> characterization). If it hasn't, STOP. If Video.tsx changed beyond plan 004,
> compare excerpts before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/004-media-component-tests.md
- **Category**: bug
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

`<Video>`'s whole job is frame accuracy: every screenshot must show the RIGHT
decoded video frame, guaranteed by a `delayRender` handle that clears only on
the `seeked` event. Two flaws break that guarantee when the tree re-commits for
the *same* frame while a seek is in flight (which happens: `main-render.tsx:90`
renders frame 0 at module load and the renderer immediately calls
`renderFrame(0)` again; any delayRender-gated `flushSync(setState)` — the
`AsyncImage` pattern — also re-commits between `renderFrame()` and the
renderer's pending check):

1. The effect's cleanup (`Video.tsx:99-103`) unconditionally calls `finish()`
   → `continueRender(handle)`, resolving the pending seek handle even though
   `seeked` never fired.
2. The re-run effect then takes the "already parked" bail (`Video.tsx:74`)
   because setting `el.currentTime` updates the property synchronously —
   before decode completes — so no replacement handle is registered.

Net: zero pending handles while the seek is still in flight → the renderer
screenshots a stale/undecoded frame, silently. Plan 004 landed a
characterization test asserting this buggy behavior; this plan fixes the
component and flips that test.

## Current state

`src/framewise-lite/Video.tsx:61-104` — the render-mode seek effect:

```tsx
  // VISUAL — RENDER: seek and block the capture until the frame is ready.
  // No deps: runs every commit, so a re-rendered same frame is handled too.
  useLayoutEffect(() => {
    if (playback) {
      return; // preview is handled by the effect below
    }
    const el = ref.current;
    if (!el) {
      return;
    }

    // Already parked on this frame (e.g. the duplicate frame-0 render)? Don't
    // create a handle that would never get a fresh `seeked`.
    if (el.readyState >= 2 && Math.abs(el.currentTime - seekTarget) < 0.5 / fps) {
      return;
    }

    const handle = delayRender(`<Video> seek ${src} @${mediaTime.toFixed(3)}s`);
    let cleared = false;
    const finish = () => {
      if (!cleared) {
        cleared = true;
        continueRender(handle);
      }
    };

    const onSeeked = () => finish();
    const seekNow = () => {
      el.addEventListener('seeked', onSeeked, {once: true});
      el.currentTime = seekTarget;
    };

    if (el.readyState >= 1) {
      seekNow();
    } else {
      el.addEventListener('loadedmetadata', seekNow, {once: true});
    }

    return () => {
      el.removeEventListener('seeked', onSeeked);
      el.removeEventListener('loadedmetadata', seekNow);
      finish();
    };
  });
```

Context you need:
- `seekTarget = (frame + startFrom) / fps + 0.5 / fps` (`Video.tsx:47-51`) —
  the half-frame nudge is deliberate and verified; keep it.
- `continueRender` is idempotent (`delay-render.ts:62-70`): clearing an
  already-cleared handle is a no-op. Stray late listeners are therefore safe.
- The preview effect (`Video.tsx:107-125`) and audio report effect
  (`Video.tsx:55-59`) are OUT of scope — do not modify them.
- `Video.test.tsx` (from plan 004) has the race characterization as its case 5,
  plus the seek-lifecycle tests (cases 1-3) that must keep passing.

## Commands you will need

| Purpose   | Command                                          | Expected on success |
|-----------|--------------------------------------------------|---------------------|
| This file | `npx vitest run src/framewise-lite/Video.test.tsx` | all pass          |
| Tests     | `npm test`                                       | all pass            |
| Full gate | `npm run verify`                                 | exit 0              |
| E2E (only if Chrome+ffmpeg present) | `npm run render -- --comp WithVideo --out out/p005.mp4` | completes; per-frame logs show no `pending at capture` lines |

## Scope

**In scope**:
- `src/framewise-lite/Video.tsx` (the render-mode seek effect only)
- `src/framewise-lite/Video.test.tsx` (flip the case-5 characterization; add
  the new regression cases below)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- The preview-sync effect and the audio-report effect in Video.tsx.
- `Img.tsx` (its unconditional cleanup-continue is CORRECT for images — a
  loaded image doesn't regress; do not "align" it with this change).
- `delay-render.ts` — the registry semantics are settled.
- `main-render.tsx` / the renderer script.

## Git workflow

- Branch: `advisor/005-video-seek-race`
- One commit; summary like `Fix <Video> seek race: keep the pending handle across same-frame recommits`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Restructure the seek state to survive same-frame recommits

Required semantics (this is the contract; the exact code may vary):

1. A **same-target recommit** while a seek is in flight must leave the
   in-flight handle pending and must NOT start a new seek.
2. A **target change** while a seek is in flight must resolve the old handle
   (idempotent) and start a new seek with a new handle.
3. The **parked bail** must require a *completed* seek for this exact target
   (a `seeked` event was observed for it), not just `currentTime` equality.
4. **Unmount** must resolve any in-flight handle (never hang the renderer).

Target shape — persistent refs instead of per-effect closure state:

```tsx
  // In-flight seek state survives re-commits; a same-frame recommit must NOT
  // resolve the handle (the capture would unblock before `seeked`).
  const seekStateRef = useRef<{handle: number; target: number; el: HTMLVideoElement} | null>(null);
  const lastSeekedTargetRef = useRef<number | null>(null);

  // Unmount-only: never leave a handle pending after the element is gone.
  useLayoutEffect(() => {
    return () => {
      if (seekStateRef.current) {
        continueRender(seekStateRef.current.handle);
        seekStateRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (playback) return;
    const el = ref.current;
    if (!el) return;

    const inFlight = seekStateRef.current;
    if (inFlight && inFlight.target === seekTarget && inFlight.el === el) {
      return; // same-frame recommit mid-seek: keep blocking the capture
    }
    if (inFlight) {
      // Target (or element) changed: the old seek no longer matters.
      continueRender(inFlight.handle);
      seekStateRef.current = null;
    }
    if (lastSeekedTargetRef.current === seekTarget && el.readyState >= 2) {
      return; // genuinely parked: a seek to THIS target already completed
    }

    const handle = delayRender(`<Video> seek ${src} @${mediaTime.toFixed(3)}s`);
    seekStateRef.current = {handle, target: seekTarget, el};

    const onSeeked = () => {
      lastSeekedTargetRef.current = seekTarget;
      if (seekStateRef.current?.handle === handle) {
        seekStateRef.current = null;
      }
      continueRender(handle); // idempotent — safe even if superseded
    };
    const seekNow = () => {
      el.addEventListener('seeked', onSeeked, {once: true});
      el.currentTime = seekTarget;
    };
    if (el.readyState >= 1) {
      seekNow();
    } else {
      el.addEventListener('loadedmetadata', seekNow, {once: true});
    }

    return () => {
      // Deliberately do NOT remove the seeked/loadedmetadata listeners and do
      // NOT resolve the handle here: on a same-frame recommit the next effect
      // run keeps this seek, and its {once:true} listeners must stay armed.
      // Stale listeners are harmless: continueRender is idempotent, and a
      // superseded seek's late `seeked` only marks lastSeekedTarget stale for
      // one commit. Unmount cleanup is handled by the []-deps effect above.
    };
  });
```

Preserve the existing explanatory comment block at lines 61-62 (updated to
describe the new invariants) and the file's overall comment style. Delete the
now-unused `finish`/`cleared` closure.

**Why listeners are not removed in cleanup**: the cleanup of commit N runs
before the effect of commit N+1; at that point it cannot know whether N+1 is
the same frame. Removing the `{once: true}` `seeked` listener would deadlock a
kept-alive seek (handle pending, nobody listening). Leaving it attached is
safe because `continueRender` is idempotent and the listener fires at most once.

**Verify**: `npx vitest run src/framewise-lite/Video.test.tsx` → existing
cases 1-4 still pass; case 5 now FAILS (expected — fix it in Step 2).

### Step 2: Flip the characterization and add regression tests

In `Video.test.tsx`:

1. **Flip case 5**: after the same-target recommit mid-seek, assert
   `getPendingDelayRenders()` has exactly ONE pending handle (the original
   seek), and that dispatching `seeked` then empties it. Remove the
   `// BUG (documented)` comment; reference this plan instead.
2. **New — target change mid-seek**: start a seek for frame 30 (1 pending);
   re-render at frame 31 before `seeked`; assert exactly 1 pending (new
   handle, old one resolved: total pending is 1, not 2); dispatch `seeked` →
   0 pending.
3. **New — parked bail requires a completed seek**: complete a full
   seek-with-`seeked` for frame 30; re-render frame 30 → 0 pending (no new
   handle — the bail works); then re-render frame 31 → 1 pending (parked
   state doesn't leak across targets).
4. **New — unmount mid-seek** still resolves: start a seek, unmount → 0
   pending (this is case 3 from plan 004; confirm it still passes with the
   new structure — the unmount-only effect owns it now).

**Verify**: `npx vitest run src/framewise-lite/Video.test.tsx` → all pass.

### Step 3: Full gate + optional end-to-end

**Verify**: `npm run verify` → exit 0.
**Verify** (only if Chrome+ffmpeg are installed): `npm run render -- --comp
WithVideo --out out/p005.mp4` → completes; then
`npm run render -- --comp WithVideo --concurrency 4 --out out/p005b.mp4` →
completes and prints the same `sha256` frame-hash line as a `--concurrency 1`
run of the same command (determinism preserved). If Chrome or ffmpeg is
missing, note it in your report — the unit gate is authoritative.

## Test plan

Covered in Step 2 — four seek-lifecycle regressions in `Video.test.tsx`,
modeled on the plan-004 harness (jsdom media element, manual
`loadedmetadata`/`seeked` dispatch, `readyState` via `Object.defineProperty`).

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `Video.test.tsx`: same-target recommit mid-seek keeps exactly 1 pending handle until `seeked`
- [ ] `Video.test.tsx`: target change mid-seek nets exactly 1 pending handle
- [ ] `Video.test.tsx`: unmount mid-seek → 0 pending
- [ ] `grep -n "finish" src/framewise-lite/Video.tsx` → no hits in the render-seek effect
- [ ] Only `Video.tsx`, `Video.test.tsx`, `plans/README.md` modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 004's Video tests don't exist or don't pass before your change.
- The plan-004 case-5 characterization already shows a pending handle (the
  race doesn't reproduce) — the premise is wrong; report instead of "fixing".
- Keeping listeners attached across commits provably breaks a preview-mode
  test or leaks handles in the jsdom suite after your Step 2 tests.
- You need to modify `Img.tsx`, `delay-render.ts`, or the renderer to make
  the tests pass.

## Maintenance notes

- Plan 011 extracts the *preview* effect into a shared hook and will touch
  this file — land 005 first (this plan owns the render effect; 011 must not).
- Reviewers should scrutinize: (a) the no-cleanup-listener rationale comment
  survives, (b) `lastSeekedTargetRef` is only written in `onSeeked`, (c) the
  unmount-only effect stays `[]`-deps.
- Future work that adds `startFrom` animation or src swapping mid-render will
  exercise the "target change" path — the Step 2 test 2 is the canary.
