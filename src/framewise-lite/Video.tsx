import {useId, useLayoutEffect, useRef} from 'react';
import type {CSSProperties} from 'react';
import {useCurrentFrame, useVideoConfig} from './VideoConfig';
import {reportAudio} from './audio-registry';
import {continueRender, delayRender} from './delay-render';
import {usePlayback} from './playback';

export type VideoProps = {
  src: string;
  /** 0..1, constant. Mute the audio track with `muted`. */
  volume?: number;
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
export const Video = ({
  src,
  volume = 1,
  startFrom = 0,
  muted = false,
  style,
}: VideoProps) => {
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

  // AUDIO: report the track for the mix (unless muted). No-deps so it fires on
  // every commit; reportAudio no-ops outside a render.
  useLayoutEffect(() => {
    if (!muted) {
      reportAudio({id, src, mediaTime, volume});
    }
  });

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

  // VISUAL — PREVIEW: best-effort sync of the visible element to the clock.
  useLayoutEffect(() => {
    if (!playback) {
      return;
    }
    const el = ref.current;
    if (!el) {
      return;
    }
    el.volume = Math.max(0, Math.min(1, volume));
    if (playback.playing) {
      if (Math.abs(el.currentTime - mediaTime) > 0.3) {
        el.currentTime = mediaTime;
      }
      void el.play().catch(() => {});
    } else {
      el.pause();
      el.currentTime = mediaTime;
    }
  }, [playback, playback?.playing, mediaTime, volume]);

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
