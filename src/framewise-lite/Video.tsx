import {useId, useLayoutEffect, useRef} from 'react';
import type {CSSProperties} from 'react';
import {useCurrentFrame, useVideoConfig} from './VideoConfig';
import {reportAudio} from './audio-registry';
import {continueRender, delayRender} from './delay-render';
import {usePlayback} from './playback';
import {resolveVolume, type VolumeProp} from './Audio';
import {useMediaSync} from './useMediaSync';

export type VideoProps = {
  src: string;
  /** 0..1 typical (>1 boosts); constant or a function of the local frame. */
  volume?: VolumeProp;
  /** Skip this many frames into the video file before starting. */
  startFrom?: number;
  /** Don't mix the video's audio track. */
  muted?: boolean;
  style?: CSSProperties;
};

/**
 * Embed a video, frame-accurately. This is the hardest primitive, because a
 * `<video>` element's frame has to be the RIGHT one in every screenshot, and
 * seeking is asynchronous. It plugs into both earlier mechanisms:
 *
 *  - VISUAL (render): each frame, seek to this frame's time and register a
 *    delayRender() handle that clears on the `seeked` event — so the renderer's
 *    Stage 3 "wait for pending handles" loop blocks the capture until the right
 *    video frame is decoded and painted. (requestVideoFrameCallback does NOT
 *    fire in headless Chrome, so we rely on `seeked` + the renderer's paint-wait,
 *    verified by a spike to be frame-accurate.)
 *  - AUDIO (render): report the file as an audio segment (Stage 4), so ffmpeg
 *    extracts and mixes the video's audio track — no renderer changes needed.
 *  - PREVIEW: drive a visible <video>, best-effort synced to the clock.
 */
export const Video = ({src, volume = 1, startFrom = 0, muted = false, style}: VideoProps) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const playback = usePlayback();
  const id = useId();
  const ref = useRef<HTMLVideoElement>(null);

  const mediaTime = (frame + startFrom) / fps;
  // Seek to the MIDDLE of the frame interval. Seeking to exactly N/fps is
  // ambiguous (the decoder may present frame N-1 or N); the half-frame nudge
  // lands squarely inside frame N. Verified frame-accurate by spike.
  const seekTarget = mediaTime + 0.5 / fps;
  const resolvedVolume = resolveVolume(volume, frame);

  // AUDIO: report the track for the mix (unless muted). No-deps so it fires on
  // every commit; reportAudio no-ops outside a render.
  useLayoutEffect(() => {
    if (!muted) {
      reportAudio({id, src, mediaTime, volume: resolvedVolume});
    }
  });

  // VISUAL — RENDER: seek and block the capture until the frame is ready.
  // No deps: runs every commit so a re-rendered same frame is handled.
  //
  // In-flight seek state survives re-commits via refs (not closure state):
  // a same-frame recommit must NOT resolve the handle — the capture would
  // unblock before `seeked`. A target change resolves the old handle and
  // starts a fresh seek. Unmount cleanup is handled by an empty-deps effect.

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
    if (playback) {
      return;
    }
    const el = ref.current;
    if (!el) {
      return;
    }

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

  // VISUAL — PREVIEW: element sync lives in useMediaSync — shared with <Audio>.
  useMediaSync(ref, playback, mediaTime, resolvedVolume);

  return (
    <video
      ref={ref}
      src={src}
      // In a render the element is never played, just seeked; mute it. In
      // preview, honor the prop so the soundtrack is audible.
      muted={playback ? muted : true}
      playsInline
      preload="auto"
      style={{width: '100%', height: '100%', objectFit: 'cover', ...style}}
    />
  );
};
