# Plan 012: Test the Player's interactive surface; add opt-in height-fitting

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- src/framewise-lite/Player.tsx src/framewise-lite/Player.test.tsx`
> On drift, compare the "Current state" excerpts against the live code; a
> mismatch in the cited logic is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md
- **Category**: tests / bug
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

`Player.test.tsx` covers the clock well (wall-clock derivation, refresh-rate
independence, loop/stop) but none of the interactive surface users actually
touch: the scrubber, keyboard stepping, play/pause toggling, seek clamping, or
the rewind-on-replay path. A regression there ships silently. Separately, the
responsive scale is computed from container *width* only, so in a
height-constrained parent the scaled stage overflows vertically; because the
container's own height is content-driven (measuring it would feed back), the
right fix is an explicit opt-in `maxHeight` prop, not container-height
measurement.

## Current state

All in `src/framewise-lite/Player.tsx`:

- `seekTo` (lines 62-71): clamps to `[0, durationInFrames - 1]`, rounds, and
  re-baselines the clock refs.
- Keyboard (lines 115-129): space toggles; ArrowLeft/ArrowRight pause then
  step ±1 via `seekTo(frameRef.current ± 1)`.
- Replay-at-end (lines 81-84): pressing play at the last frame (not looping)
  rewinds to 0 first.
- Scrubber (lines 253-263): `<input type="range" min={0} max={durationInFrames - 1} value={frame}`
  with `onChange` → `setPlaying(false); seekTo(Number(e.target.value))`.
- Scale effect (lines 143-155):

  ```tsx
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    const observer = new ResizeObserver(() => {
      const available = el.clientWidth;
      setScale(Math.min(available / width, 1));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);
  ```

  The stage box is `width * scale × height * scale` (lines 169-177).
- `PlayerProps` (lines 14-20): `VideoConfig & {component, inputProps?, loop?, autoPlay?, controls?}`.
- Test harness to reuse (`Player.test.tsx`): rAF queue + mocked
  `performance.now` (lines 26-59), `ResizeObserverStub` (lines 12-16), `mount`
  helper (lines 68-82), frame probe via `[data-testid="frame"]`. Extend
  `mount` to accept `autoPlay: false` — the interactive tests mostly start
  paused. Note the existing `mount` hardcodes `autoPlay`; parameterize it.

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| This file | `npx vitest run src/framewise-lite/Player.test.tsx` | all pass |
| Full gate | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `src/framewise-lite/Player.tsx` (ONLY: add optional `maxHeight?: number`
  prop and include it in the scale computation)
- `src/framewise-lite/Player.test.tsx` (new cases; parameterize `mount`)
- `plans/README.md` (status row)

**Out of scope**:
- Controls markup/styling, the pending badge, CompositionHost wiring.
- Memoizing the controls subtree (explicitly rejected — see plans/README.md).
- `App.tsx` (no need to pass maxHeight anywhere yet).

## Git workflow

- Branch: `advisor/012-player-scale-and-controls`
- Commits: (1) tests for current behavior, (2) maxHeight + its tests.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Interactive-surface tests (current behavior — no source change)

Extend `Player.test.tsx` with a `describe('Player controls')` block. To
dispatch keys, target the outer container div (it has `tabIndex={0}` and
`onKeyDown`); with React 18+ use `act(() => { div.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true})); })`
— React's synthetic handler listens at the root, so `bubbles: true` is
required. For the scrubber, find `input[type="range"]` and use the native
setter pattern so React sees the change:

```tsx
const input = container.querySelector('input[type="range"]')!;
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
act(() => {
  setValue.call(input, '42');
  input.dispatchEvent(new Event('input', {bubbles: true})); // React range onChange listens to 'input'
});
```

Cases:
1. **ArrowRight steps forward one frame** (mounted paused at 0 → frame 1);
   ArrowLeft steps back.
2. **Seek clamps**: ArrowLeft at frame 0 stays at 0; scrubbing to the max
   value lands on `durationInFrames - 1`.
3. **Space toggles playback**: after space, `runFrames` advances the frame;
   after a second space, further `runFrames` do not.
4. **Scrubbing pauses**: start playing (`autoPlay`), scrub to 42 → frame is
   42 AND subsequent `runFrames` with no play do not advance it.
5. **Scrub re-baselines the clock**: scrub to 42 while paused, press space,
   `runFrames(30, t, t+1000)` → frame 42+30=72 (not 30) — asserts the
   `startFrameRef` re-baseline in `seekTo`.
6. **Replay from the end**: `durationInFrames: 10`, run to the stop (frame 9,
   playback halts), press space → playback restarts from 0 (frame < 9 after a
   short `runFrames`).

**Verify**: `npx vitest run src/framewise-lite/Player.test.tsx` → all pass
(4 existing + 6 new).

### Step 2: Opt-in height fitting

Add to `PlayerProps`: `/** Fit the stage within this height (px) as well as the container width. */ maxHeight?: number;`
In the scale effect, include it:

```tsx
const observer = new ResizeObserver(() => {
  const available = el.clientWidth;
  const widthScale = available / width;
  const heightScale = maxHeight !== undefined ? maxHeight / height : 1;
  setScale(Math.min(widthScale, heightScale, 1));
});
```

with `[width, height, maxHeight]` as the effect deps. Default behavior
(no `maxHeight`) is byte-identical to today.

Tests (jsdom's `clientWidth` is 0 and the stub ResizeObserver never fires, so
test via the observer callback — upgrade `ResizeObserverStub` to capture the
callback and expose a `trigger()`; set `el.clientWidth` via
`Object.defineProperty`):
7. width 1000 available for a 1280×720 comp, no maxHeight → scale 1000/1280;
   stage div style is `width: 1000px`.
8. same but `maxHeight={360}` → scale `min(1000/1280, 360/720) = 0.5` → stage
   `width: 640px; height: 360px`.

**Verify**: `npx vitest run src/framewise-lite/Player.test.tsx` → all pass.
**Verify**: `npm run verify` → exit 0.

## Test plan

Steps 1-2 are the test plan: 8 new cases in `Player.test.tsx`, following its
existing fake-rAF harness. Machine gate: `npm run verify`.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] ≥ 8 new Player tests pass; the 4 existing clock tests unchanged
- [ ] `Player.tsx` diff touches only the props type and the scale effect
- [ ] Default scaling behavior unchanged (case 7 pins it)
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- React's range-input `onChange` does not fire from the native-setter+`input`
  event pattern in your React version — try `change` as the event name; if
  neither works, report rather than switching to a different testing library.
- Keyboard events don't reach the handler (synthetic-event wiring differs) —
  same rule: two attempts, then report.
- The height fix seems to require measuring the container's height — it does
  not (feedback loop); the `maxHeight` prop IS the design. Report if you
  believe otherwise.

## Maintenance notes

- If a props editor lands in App.tsx later (a direction finding), these
  control tests are the safety net for the Player it embeds.
- Reviewers: check case 5 specifically — the re-baseline is the subtlest
  behavior and the most likely future regression.
