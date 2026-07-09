# Plan 011: Extract the duplicated preview media-sync effect into useMediaSync()

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- src/framewise-lite/Audio.tsx src/framewise-lite/Video.tsx`
> Plans 004 and 005 are expected to have landed (tests exist; Video's render
> effect was restructured). Locate the preview effects in the LIVE files —
> line numbers will have shifted; the code shape below is the anchor.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW–MED (shared by both media primitives; guarded by plan 004's tests)
- **Depends on**: plans/004-media-component-tests.md, plans/005-video-seek-race.md (ordering: land after 005 to avoid churn in Video.tsx)
- **Category**: tech-debt
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

The preview-mode media sync effect is duplicated near-verbatim between
`<Audio>` and `<Video>`: same volume clamp, same 0.3s drift-correction
threshold, same play/pause/scrub branches, same dependency list. Tuning the
drift threshold or fixing the clamp in one and not the other is a silent-drift
bug waiting to happen. One hook ends the duplication and gives the constant a
single home.

## Current state

- `src/framewise-lite/Audio.tsx:44-63` (at `985ca38`):

  ```tsx
  useLayoutEffect(() => {
    if (!playback) {
      return; // render mode — never touch the element
    }
    const el = ref.current;
    if (!el) {
      return;
    }
    el.volume = Math.max(0, Math.min(1, volume));
    if (playback.playing) {
      // Correct drift only when it's drifted noticeably, to avoid stutter.
      if (Math.abs(el.currentTime - mediaTime) > 0.3) {
        el.currentTime = mediaTime;
      }
      void el.play().catch(() => {});
    } else {
      el.pause();
      el.currentTime = mediaTime; // scrub to the exact frame
    }
  }, [playback, playback?.playing, mediaTime, volume]);
  ```

- `src/framewise-lite/Video.tsx:107-125` — identical body (only the ref type
  differs: `HTMLVideoElement` vs `HTMLAudioElement`; both satisfy
  `HTMLMediaElement`).
- Both components keep their distinct doc comments explaining preview
  behavior — preserve the explanations, moving the shared mechanics into the
  hook's own header comment.
- `playback` comes from `usePlayback()` (`./playback`), type
  `Playback | null` = `{playing: boolean} | null`.
- Tests guarding this refactor: `Audio.test.tsx` / `Video.test.tsx` from plan
  004 (preview-mode cases stub `HTMLMediaElement.play/pause`).
- Convention: library files carry a top-of-file block comment explaining the
  *why* (see `audio-registry.ts:1-12` for tone).

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Tests     | `npm test` | all pass, count unchanged |
| Full gate | `npm run verify` | exit 0 |
| Preview (manual) | `npm run dev` → WithAudio / WithVideo | audio/video track the scrubber; pausing freezes at the exact frame |

## Scope

**In scope**:
- `src/framewise-lite/useMediaSync.ts` (create)
- `src/framewise-lite/Audio.tsx`, `src/framewise-lite/Video.tsx` (replace the
  preview effect with the hook call)
- `plans/README.md` (status row)

**Out of scope**:
- The render-mode effects in both files (audio reporting; Video's seek gating
  as restructured by plan 005). Do not touch them.
- The barrel (`index.ts`) — the hook is internal; do NOT export it.
- Changing the 0.3s threshold or any behavior. Pure extraction.

## Git workflow

- Branch: `advisor/011-use-media-sync`
- One commit: `Extract shared preview media-sync into useMediaSync()`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the hook

`src/framewise-lite/useMediaSync.ts`:

```tsx
import {useLayoutEffect} from 'react';
import type {RefObject} from 'react';
import type {Playback} from './playback';

// How far (seconds) the element may drift from the clock during playback
// before we snap it back. Large enough to avoid stutter from constant
// re-seeking, small enough that A/V stays visibly in sync.
const DRIFT_TOLERANCE_S = 0.3;

/**
 * PREVIEW-ONLY sync of a live media element to the Player clock, shared by
 * <Audio> and <Video>. No-op in render mode (playback === null): during a
 * render the element is never driven — audio is mixed by ffmpeg and video
 * frames are seek-gated instead. Best-effort, not sample-accurate, by design.
 */
export function useMediaSync(
  ref: RefObject<HTMLMediaElement | null>,
  playback: Playback | null,
  mediaTime: number,
  volume: number,
): void {
  useLayoutEffect(() => {
    /* body moved verbatim from Audio.tsx, with 0.3 → DRIFT_TOLERANCE_S */
  }, [playback, playback?.playing, mediaTime, volume]);
}
```

Move the effect body verbatim from **Audio.tsx** (its copy has the drift-correction
and scrub-to-frame inline comments that the Video copy lacks). The only edits
are the named constant and reading `ref.current` (already the shape both callers use).

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Adopt in Audio and Video

Replace each component's preview effect with
`useMediaSync(ref, playback, mediaTime, volume);` and delete the duplicated
body. Keep each component's existing "PREVIEW:" comment, shortened to point at
the hook (e.g. `// PREVIEW: element sync lives in useMediaSync — shared with <Video>.`).
Note `Video` must pass `muted ? 0 : volume`? — NO: check the live file; at
`985ca38` Video's preview effect uses `volume` directly and mute is handled by
the element attribute (`muted={playback ? muted : true}`, `Video.tsx:133`).
Preserve exactly what the live code does.

**Verify**: `npm test` → all pass (plan 004's preview cases are the net).
**Verify**: `grep -c "DRIFT_TOLERANCE_S\|0.3" src/framewise-lite/Audio.tsx src/framewise-lite/Video.tsx` → 0 occurrences of the literal `0.3` remain in either component.

### Step 3: Manual preview check

`npm run dev` → open WithAudio and WithVideo: play/pause, scrub. Behavior
identical to before (audio follows scrubs; pause freezes video at the frame).

## Test plan

No new tests required — plan 004's Audio/Video preview-mode tests plus the
full suite are the regression net. If plan 004's preview coverage turns out
not to exercise the hook path (e.g. only render-mode cases landed), add one
test per component: with `playback={{playing: false}}` and frame N, the
element's `currentTime` equals `mediaTime` after commit.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `src/framewise-lite/useMediaSync.ts` exists; NOT exported from `index.ts`
- [ ] The literal `0.3` appears only in `useMediaSync.ts` (as the named constant)
- [ ] `git diff` in Audio.tsx/Video.tsx shows only the preview-effect replacement
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The live preview effects in Audio.tsx and Video.tsx have *diverged* since
  `985ca38` (they were identical then) — divergence means one side changed
  deliberately; report which lines differ instead of unifying them blind.
- Plan 005 has not landed (Video.tsx churn collision).
- Any existing test fails after the extraction.

## Maintenance notes

- Future per-frame volume automation (a named README "deliberately omitted"
  item) will land in exactly this hook — that's the point of having one home.
- Reviewers: diff each component against the hook body to confirm verbatim
  movement; check the hook is internal (not in the barrel).
