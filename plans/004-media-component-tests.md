# Plan 004: Characterization tests for Img, Audio, Video, and CompositionHost

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- src/framewise-lite/`
> If Img.tsx, Audio.tsx, Video.tsx, CompositionHost.tsx, delay-render.ts, or
> audio-registry.ts changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md
- **Category**: tests
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

The delayRender-gated media components are the feature this tool exists for —
blocking the screenshot until assets are actually ready — and none of them has
a single test: no test imports `Img`, `Audio`, `Video`, or `CompositionHost`.
Their trickiest logic (StrictMode handle balancing, no-deps layout effects,
cleanup paths, the render-vs-preview mode contract) is precisely where handle
leaks or premature captures hide. These are also the **prerequisite
characterization tests for plan 005**, which changes Video's seek gating.
This plan writes tests against CURRENT behavior only — no source changes.

## Current state

All files below are in `src/framewise-lite/`.

- `Img.tsx:22-41` — layout effect keyed on `[src]`; skips entirely if the
  image is already decoded (`img.complete && img.naturalWidth > 0` — never
  true in jsdom, so tests always exercise the delaying path); otherwise
  creates `delayRender(\`<Img> ${src}\`)`, attaches imperative
  `load`/`error` listeners that `continueRender`, and the cleanup also calls
  `continueRender(handle)` (idempotent — `continueRender` on a cleared handle
  is a no-op, see `delay-render.ts:62-70`).
- `Audio.tsx:38-40` — no-deps layout effect reporting
  `{id, src, mediaTime, volume}` to the audio registry every commit;
  `mediaTime = (frame + startFrom) / fps` (line 33). `reportAudio` no-ops
  unless `beginAudioFrame()` armed collection (`audio-registry.ts:39-44`).
- `Video.tsx:63-104` — render-mode seek effect (no deps): bails if `playback`
  set (preview) or already parked (`el.readyState >= 2 &&
  Math.abs(el.currentTime - seekTarget) < 0.5 / fps`, line 74); otherwise
  `delayRender(\`<Video> seek ${src} @...\`)`, seeks when `readyState >= 1`
  else waits for `loadedmetadata`, clears the handle on `seeked` or cleanup.
  `seekTarget = (frame + startFrom) / fps + 0.5 / fps` (line 51). Also
  reports audio unless `muted` (lines 55-59).
- `CompositionHost.tsx:18-41` — wraps children in
  `VideoConfigProvider`/`FrameProvider`, and in `PlaybackProvider` ONLY when a
  `playback` prop is passed. Null playback context == render mode; that is how
  Audio/Video decide whether to touch the element.
- `audio-registry.ts:30-49` — module-global `Map` keyed by instance id,
  cleared only by `beginAudioFrame()`; `readAudioFrame()` returns its values.
  Known limitation (test it as characterization, do NOT fix): a within-frame
  re-render that *unmounts* an `<Audio>` leaves its stale report in the map.
- Test conventions (copy them): `// @vitest-environment jsdom` first line;
  `IS_REACT_ACT_ENVIRONMENT = true`; `createRoot` + `act` from `react`;
  drain the delayRender registry in `afterEach` — see
  `delay-render.test.tsx:17-21` and the mount pattern in `Player.test.tsx:45-82`.

## Commands you will need

| Purpose   | Command                        | Expected on success |
|-----------|--------------------------------|---------------------|
| Tests     | `npm test`                     | all pass; count grows |
| One file  | `npx vitest run src/framewise-lite/Img.test.tsx` | passes |
| Full gate | `npm run verify`               | exit 0              |

## Scope

**In scope** (create only — no source-file modifications):
- `src/framewise-lite/Img.test.tsx`
- `src/framewise-lite/Audio.test.tsx`
- `src/framewise-lite/Video.test.tsx`
- `src/framewise-lite/CompositionHost.test.tsx`
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- ANY non-test source file. If a test reveals a bug, record it in the test as
  a characterization comment (`// documents current behavior; see plan 005`)
  and report it — do not fix.
- `scripts/**`.

## Git workflow

- Branch: `advisor/004-media-component-tests`
- Commit per test file or one commit; short imperative summary.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

Shared setup across the four test files (mirror `Player.test.tsx` for the
mount/`act` harness; `delay-render.test.tsx:17-21` for the registry-draining
`afterEach` — drain BEFORE unmount so a test whose mount fails doesn't leak
handles into the next test):

```tsx
// FILE HEADER (every test file):
// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ReactNode} from 'react';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {getPendingDelayRenders, continueRender} from './delay-render';
import {CompositionHost} from './CompositionHost';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  // Drain FIRST: if a test failed mid-mount without clearing its handle,
  // subsequent tests inherit nothing. delay-render.test.tsx:17-21 drains
  // before any other cleanup for the same reason.
  for (const {handle} of getPendingDelayRenders()) continueRender(handle);
  act(() => root.unmount());
  container.remove();
});

// Render helper for render-mode tests (no `playback` — null PlaybackContext):
const renderAt = (frame: number, children: ReactNode) =>
  act(() => root.render(
    <CompositionHost config={{width: 100, height: 100, fps: 30, durationInFrames: 150}} frame={frame}>
      {children}
    </CompositionHost>,
  ));
```

Additional per-file imports listed in each step below.

### Step 1: `Img.test.tsx`

Additional import (beyond the shared setup above):

```tsx
import {StrictMode} from 'react';
import {Img} from './Img';
```

Cases:
1. Mounting `<Img src="/photo.png" />` via `renderAt(0, <Img src="/photo.png" />)`
   registers exactly one pending handle whose label contains `/photo.png`
   (`getPendingDelayRenders()`).
2. Dispatching `load` on the `<img>` element
   (`container.querySelector('img')!.dispatchEvent(new Event('load'))`, inside
   `act`) clears it → pending length 0.
3. Dispatching `error` also clears it (an image that fails must not hang the render).
4. Unmounting while pending clears it.
5. StrictMode balance — the double-invoked effect after StrictMode's
   mount/unmount/mount must not orphan a handle. Do NOT use `renderAt` for this
   test; render explicitly:

   ```tsx
   act(() => root.render(
     <StrictMode>
       <CompositionHost config={{width: 100, height: 100, fps: 30, durationInFrames: 150}} frame={0}>
         <Img src="/photo.png" />
       </CompositionHost>
     </StrictMode>,
   ));
   // After the double-mount settles, exactly one handle is pending.
   // (If StrictMode leaked the first handle, count would be 2.)
   const img = container.querySelector('img')!;
   act(() => img.dispatchEvent(new Event('load')));
   // Both invocations' handles must net to 0.
   expect(getPendingDelayRenders()).toHaveLength(0);
   ```

**Verify**: `npx vitest run src/framewise-lite/Img.test.tsx` → 5 tests pass.

### Step 2: `Audio.test.tsx`

Additional imports (beyond the shared setup):

```tsx
import {Audio} from './Audio';
import {beginAudioFrame, readAudioFrame} from './audio-registry';
import {Sequence} from './Sequence';
```

Because `audio-registry.ts:24`'s `collecting` flag is module-global, once any test
calls `beginAudioFrame()`, `collecting` stays `true` for the rest of the file.
That means the preview-mode test (case 4 below) can only prove that `reportAudio`
is a no-op when `collecting` is `false` if it runs **first**, before any other
test calls `beginAudioFrame()`. Order the `it` blocks accordingly.

Silence jsdom's "Not implemented: HTMLMediaElement.prototype.pause" warnings
for the preview test. jsdom provides stub `play`/`pause` methods that log
warnings — mock them silently in the test that exercises the preview path:

```tsx
const pauseStub = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
const playStub = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
// ... after the test assertion, or in your describe-block afterEach:
pauseStub.mockRestore();
playStub.mockRestore();
```

Cases:
1. **[MUST BE FIRST TEST]** Preview mode (pass `playback={{playing: false}}`
   to CompositionHost): `reportAudio` is a no-op because `beginAudioFrame` was
   never called — `readAudioFrame()` returns `[]`. Silence the pause/play
   stubs per above. (If this test runs after any test that called
   `beginAudioFrame()`, `collecting` will still be `true` and `readAudioFrame()`
   will have reports — a false failure.)
2. Render mode, frame 30: `beginAudioFrame(); renderAt(30, <Audio src="/bg.wav" volume={0.3} />)` →
   `readAudioFrame()` has one report with `src: '/bg.wav'`, `volume: 0.3`,
   `mediaTime` ≈ 30/30 = 1.0.
3. `startFrom={15}` at frame 30 → `mediaTime` ≈ (30+15)/30 = 1.5.
4. Inside `<Sequence from={60} durationInFrames={15} layout="none">`:
   at frame 59 → no report (Sequence unmounts children outside its window);
   at frame 60 → one report with `mediaTime` ≈ 0;
   at frame 74 → `mediaTime` ≈ 14/30.
5. Characterization of the known unmount limitation: `beginAudioFrame()`;
   render frame 30 WITH the Audio; re-render the SAME frame 30 WITHOUT it
   (different children); `readAudioFrame()` STILL contains the stale report.
   Comment: `// Known limitation: within-frame unmount leaves a stale report.
   // Deliberate characterization — see plans/README.md rejected/deferred list.`

**Verify**: `npx vitest run src/framewise-lite/Audio.test.tsx` → 5 tests pass.

### Step 3: `Video.test.tsx`

Additional imports (beyond the shared setup):

```tsx
import {Video} from './Video';
import {beginAudioFrame, readAudioFrame} from './audio-registry';
```

jsdom's `HTMLMediaElement` never loads media: `readyState` stays 0 (the default)
and `seeked`/`loadedmetadata` never fire on their own — dispatch them manually.
`currentTime` is a settable property in jsdom. Stub `play`/`pause` with the
`vi.spyOn(HTMLMediaElement.prototype, ...)` pattern from Audio Step 2 (same
"Not implemented" warnings in preview path — but all Video tests below are
render-mode only, so the preview effect is a no-op and the stubs are a pure
noise-cleanup; apply in the describe-block `beforeAll`/`afterAll` or per-test).

The parked-bail at `Video.tsx:74` checks two conditions:
`el.readyState >= 2 && Math.abs(el.currentTime - seekTarget) < 0.5 / fps`.
The `readyState` requirement means you must redefine it to ≥2 for any test that
wants the bail to fire. The `seekNow` path at line 93 only requires readyState
≥1. Where a test needs both paths at different points, redefine `readyState`
with `Object.defineProperty` at the right moment.

Cases (render mode):
1. Mounting `<Video src="/clip.mp4" />` at frame 30 registers a pending handle
   labeled `<Video> seek /clip.mp4 ...` (jsdom default `readyState` is 0, so
   the effect waits on `loadedmetadata`).
2. Drive the full seek lifecycle:
   a. Mount at frame 30 → 1 pending (readyState 0, waiting on `loadedmetadata`).
   b. `Object.defineProperty(el, 'readyState', {value: 1, configurable: true})`
      then dispatch `loadedmetadata` → the effect calls `seekNow()`, which sets
      `el.currentTime` to `seekTarget = (30+0)/30 + 0.5/30` ≈ 1.0167.
      Assert `el.currentTime` ≈ 1.0167.
   c. Dispatch `seeked` → pending length 0.
3. Unmount while a seek is pending → pending length 0 (cleanup clears it).
4. Audio side: `beginAudioFrame()`; mount unmuted at frame 30 →
   `readAudioFrame()` has one report with `mediaTime` ≈ 1.0; with `muted` →
   no report.
5. **Characterization of the plan-005 race** (THIS TEST DOCUMENTS THE BUG —
   assert *current* behavior and mark it). The race takes four state
   transitions; follow this exact sequence:

   a. **Park at frame 30.** Complete a seek for frame 30 as in case 2:
      defineProperty readyState to 1, dispatch loadedmetadata, dispatch
      seeked → 0 pending. (The element is seeked and parked for frame 30.)
   b. **Re-render at frame 31.** The new seekTarget differs by ~1/fps, so the
      parked bail fails. A new handle is registered → assert exactly 1 pending.
      The effect calls `seekNow()` because readyState ≥ 1, setting
      `el.currentTime` to frame 31's seekTarget.
   c. **Re-define readyState to ≥ 2.** The parked bail (`Video.tsx:74`)
      requires `readyState >= 2`. Redefine it NOW, before the next render:
      `Object.defineProperty(el, 'readyState', {value: 2, configurable: true})`.
   d. **Re-render frame 31 AGAIN** (same frame, before dispatching `seeked`).
      The previous effect's cleanup runs `finish()` → continueRender, clearing
      the handle (0 pending). The new effect hits the parked bail: readyState ≥ 2
      AND `el.currentTime` was already set to seekTarget in step (b). The bail
      returns without registering a replacement handle.
   e. **Assert**: `getPendingDelayRenders()` is EMPTY, even though no `seeked`
      ever fired for frame 31's target. The renderer would capture early.

   Comment: `// BUG (documented): a same-frame recommit mid-seek clears the
   // handle and registers no replacement — the renderer could capture early.
   // Plan 005 fixes this; it will flip this assertion.`

**Verify**: `npx vitest run src/framewise-lite/Video.test.tsx` → 5 tests pass.

### Step 4: `CompositionHost.test.tsx`

Additional imports (beyond the shared setup):

```tsx
import {useCurrentFrame, useVideoConfig} from './VideoConfig';
import {usePlayback} from './playback';
```

The shared setup already imports `CompositionHost`. Do not import `PlaybackProvider`
directly — probe it through `usePlayback()` return values.

Probe components using `useCurrentFrame()`, `useVideoConfig()` and
`usePlayback()`. Cases:
1. Children receive the `frame` and `config` passed in.
2. Without `playback` prop → `usePlayback()` returns null (render mode).
3. With `playback={{playing: true}}` → `usePlayback()` returns it.

**Verify**: `npx vitest run src/framewise-lite/CompositionHost.test.tsx` → 3 tests pass.

## Test plan

This plan IS the test plan: 18 new tests across four files, modeled on
`Player.test.tsx` (mount/act harness) and `delay-render.test.tsx`
(registry-draining afterEach). Verification: `npm run verify` → exit 0, total
tests ≥ 96 (78 existing on `985ca38` baseline + 18 new).

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] Four new test files exist; `npm test` shows ≥ 18 new tests, all passing
- [ ] `npm test` reports ≥ 96 total tests (78 baseline + 18 new)
- [ ] `git diff --name-only` contains ONLY the four test files and `plans/README.md`
- [ ] The Video race characterization (Step 3 case 5) and Audio stale-report
      characterization (Step 2 case 5) are present with their explanatory comments
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- jsdom's media elements behave differently than described (e.g. setting
  `currentTime` throws, or `readyState` cannot be redefined via
  `Object.defineProperty`) — report the actual behavior; do not restructure
  the component to accommodate the test.
- Any test can only pass by modifying a source file.
- The Step 3 case 5 race does NOT reproduce (pending is non-empty at the final
  assertion) — that would mean plan 005's premise is wrong; report it, don't
  force the assertion.
- Audio case 4 (preview-mode no-op) fails because `collecting` is already
  `true` from a prior test — the case ran out of order. Re-order it to be the
  FIRST test in the file and try again; if it still fails, report the actual
  `readAudioFrame()` result.

## Maintenance notes

- Plan 005 (Video seek race fix) MUST flip the Step 3 case 5 assertion — that
  test is its regression net. Plan 011 (useMediaSync extraction) relies on
  Steps 2-3 passing unchanged.
- Reviewers: check no source file changed, and that every test drains the
  delayRender registry (a leaked handle makes later tests flaky in the same
  process).
