import {useId, useLayoutEffect, useRef} from 'react';
import {useCurrentFrame, useVideoConfig} from './VideoConfig';
import {reportAudio} from './audio-registry';
import {usePlayback} from './playback';

export type AudioProps = {
  src: string;
  /** 0..1, constant. (Per-frame volume functions are not implemented.) */
  volume?: number;
  /** Skip this many frames into the audio file before playing. */
  startFrom?: number;
};

/**
 * Play an audio file on the timeline. Place it in time by wrapping it in a
 * <Sequence>, exactly like a visual element — its mediaTime is derived from the
 * (re-based) current frame, so a <Sequence from={60}> starts the audio at frame
 * 60 with no special handling here.
 *
 * Two completely separate jobs, by mode:
 *  - RENDER: report {id, src, mediaTime, volume} every frame so the renderer can
 *    mix the audio in with ffmpeg. The <audio> element is never played.
 *  - PREVIEW: drive a hidden <audio> element, best-effort synced to the Player's
 *    clock. This is approximate (not sample-accurate) and is intentionally so.
 */
export const Audio = ({src, volume = 1, startFrom = 0}: AudioProps) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const playback = usePlayback();
  const id = useId();
  const ref = useRef<HTMLAudioElement>(null);

  const mediaTime = (frame + startFrom) / fps;

  // --- RENDER: collect this frame's audio. No deps: runs after EVERY commit, so
  // it reports even when the renderer re-renders the same frame number (e.g. the
  // initial frame 0). reportAudio() no-ops unless a render is collecting.
  useLayoutEffect(() => {
    reportAudio({id, src, mediaTime, volume});
  });

  // --- PREVIEW: keep the element roughly in sync with the clock. Disabled
  // entirely when there's no Player (i.e. during a headless render).
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

  return <audio ref={ref} src={src} preload="auto" />;
};
