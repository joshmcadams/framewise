// Shared preview media sync for <Audio> and <Video>.
//
// During a render (playback === null) the element is never driven — audio is
// mixed by ffmpeg and video frames are seek-gated instead. In preview the
// Player holds the clock, and this hook roughly couples the live <audio>/<video>
// to it. Best-effort, not sample-accurate, by design.

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
      if (Math.abs(el.currentTime - mediaTime) > DRIFT_TOLERANCE_S) {
        el.currentTime = mediaTime;
      }
      void el.play().catch(() => {});
    } else {
      el.pause();
      el.currentTime = mediaTime; // scrub to the exact frame
    }
  }, [playback, playback?.playing, mediaTime, volume]);
}
