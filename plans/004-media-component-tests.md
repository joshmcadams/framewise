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

Shared setup for all four files (mirror `Player.test.tsx`): jsdom pragma,
`IS_REACT_ACT_ENVIRONMENT`, fresh `container`/`root` per test, and an
`afterEach` that unmounts and drains pending handles:

```tsx
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const {handle} of getPendingDelayRenders()) continueRender(handle);
});
```

To render in **render mode**, wrap in `CompositionHost` with no `playback`:

```tsx
const renderAt = (frame: number, children: ReactNode) =>
  act(() => root.render(
    <CompositionHost config={{width: 100, height: 100, fps: 30, durationInFrames: 150}} frame={frame}>
      {children}
    </CompositionHost>,
  ));
```

### Step 1: `Img.test.tsx`

Cases:
1. Mounting `<Img src="/photo.png" />` registers exactly one pending handle
   whose label contains `/photo.png` (`getPendingDelayRenders()`).
2. Dispatching `load` on the `<img>` element
   (`container.querySelector('img')!.dispatchEvent(new Event('load'))`, inside
   `act`) clears it → pending length 0.
3. Dispatching `error` also clears it (an image that fails must not hang the render).
4. Unmounting while pending clears it.
5. StrictMode balance: render inside `<StrictMode>`, dispatch `load`, assert
   pending ends at 0 (the double-invoked effect must not orphan a handle).

**Verify**: `npx vitest run src/framewise-lite/Img.test.tsx` → 5 tests pass.

### Step 2: `Audio.test.tsx`

Use `beginAudioFrame()`/`readAudioFrame()` from `./audio-registry` directly.
Cases:
1. Render mode, frame 30: `beginAudioFrame(); renderAt(30, <Audio src="/bg.wav" volume={0.3} />)` →
   `readAudioFrame()` has one report with `src: '/bg.wav'`, `volume: 0.3`,
   `mediaTime` ≈ 30/30 = 1.0.
2. `startFrom={15}` at frame 30 → `mediaTime` ≈ (30+15)/30 = 1.5.
3. Inside `<Sequence from={60} durationInFrames={15} layout="none">` (import
   from `./Sequence`): at frame 59 → no report (Sequence unmounts children
   outside its window); at frame 60 → one report with `mediaTime` ≈ 0; at
   frame 74 → `mediaTime` ≈ 14/30.
4. Preview mode (pass `playback={{playing: false}}` to CompositionHost):
   `reportAudio` is a no-op because `beginAudioFrame` was never called —
   `readAudioFrame()` unchanged. (Note: jsdom logs "Not implemented:
   HTMLMediaElement.prototype.pause" warnings from the preview effect — they
   are warnings, not failures; silence by stubbing
   `HTMLMediaElement.prototype.pause`/`play` with `vi.spyOn(...).mockImplementation(...)`.)
5. Characterization of the known unmount limitation: `beginAudioFrame()`;
   render frame 30 WITH the Audio; re-render the SAME frame 30 WITHOUT it
   (different children); `readAudioFrame()` STILL contains the stale report.
   Comment: `// Known limitation: within-frame unmount leaves a stale report.
   // Deliberate characterization — see plans/README.md rejected/deferred list.`

**Verify**: `npx vitest run src/framewise-lite/Audio.test.tsx` → 5 tests pass.

### Step 3: `Video.test.tsx`

jsdom's `HTMLMediaElement` never loads media: `readyState` stays 0 and
`seeked`/`loadedmetadata` never fire on their own — dispatch them manually.
`currentTime` is a plain settable property in jsdom. Stub `play`/`pause` as in
Step 2 to avoid not-implemented noise.

Cases (render mode):
1. Mounting `<Video src="/clip.mp4" />` at frame 30 registers a pending handle
   labeled `<Video> seek /clip.mp4 ...` (readyState 0 → waits on `loadedmetadata`).
2. Drive the full seek: set `Object.defineProperty(el, 'readyState', {value: 1, configurable: true})`,
   dispatch `loadedmetadata` (the effect then sets `el.currentTime` to
   `seekTarget = (30 + 0)/30 + 0.5/30` — assert `el.currentTime` ≈ 1.0167),
   then dispatch `seeked` → pending length 0.
3. Unmount while the seek is pending → pending length 0 (cleanup cleared it).
4. Audio side: `beginAudioFrame()`; mount unmuted at frame 30 →
   `readAudioFrame()` has a report with `mediaTime` ≈ 1.0; with `muted` → no report.
5. Characterization of the plan-005 race (THIS TEST DOCUMENTS THE BUG —
   assert *current* behavior and mark it): complete a seek for frame 30 as in
   case 2 so the element is "parked" (`readyState` ≥ 2 via defineProperty,
   `currentTime` == seekTarget). Then re-render the SAME frame 30. Current
   behavior: cleanup runs `finish()` (a no-op, handle already cleared) and the
   new effect takes the parked bail → 0 pending. Now instead simulate the
   race: park the element at frame 30's target, re-render at frame 31 (new
   seek starts, 1 pending), then re-render frame 31 AGAIN *before* dispatching
   `seeked`, with `readyState` ≥ 2 — assert `getPendingDelayRenders()` is EMPTY
   even though no `seeked` ever fired for frame 31's target. Comment:
   `// BUG (documented): a same-frame recommit mid-seek clears the handle and
   // registers no replacement — the renderer could capture early. Plan 005
   // fixes this; it will flip this assertion.`

**Verify**: `npx vitest run src/framewise-lite/Video.test.tsx` → 5 tests pass.

### Step 4: `CompositionHost.test.tsx`

Probe components using `useCurrentFrame()`, `useVideoConfig()` (from
`./VideoConfig`) and `usePlayback()` (from `./playback`). Cases:
1. Children receive the `frame` and `config` passed in.
2. Without `playback` prop → `usePlayback()` returns null (render mode).
3. With `playback={{playing: true}}` → `usePlayback()` returns it.

**Verify**: `npx vitest run src/framewise-lite/CompositionHost.test.tsx` → 3 tests pass.

## Test plan

This plan IS the test plan: 18 new tests across four files, modeled on
`Player.test.tsx` (mount/act harness) and `delay-render.test.tsx`
(registry-draining afterEach). Verification: `npm run verify` → exit 0, total
tests ≥ 69.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] Four new test files exist; `npm test` shows ≥ 18 new tests, all passing
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
- The Step 3 case 5 race does NOT reproduce (pending is non-empty) — that
  would mean plan 005's premise is wrong; report it, don't force the assertion.

## Maintenance notes

- Plan 005 (Video seek race fix) MUST flip the Step 3 case 5 assertion — that
  test is its regression net. Plan 011 (useMediaSync extraction) relies on
  Steps 2-3 passing unchanged.
- Reviewers: check no source file changed, and that every test drains the
  delayRender registry (a leaked handle makes later tests flaky in the same
  process).
