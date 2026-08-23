import {useId, useLayoutEffect, useRef} from 'react';
import {useCurrentFrame, useVideoConfig} from './VideoConfig';
import {reportAudio} from './audio-registry';
import {usePlayback} from './playback';
import {useMediaSync} from './useMediaSync';

/**
 * Constant volume, or a function of the current (re-based) frame — so wrapping
 * in a <Sequence> shifts the whole curve, exactly like every other animation
 * input. Compose with interpolate() for fades:
 *
 *   <Audio src volume={(f) => interpolate(f, [0, 30], [0, 1], {extrapolateRight: 'clamp'})} />
 */
export type VolumeProp = number | ((frame: number) => number);

export type AudioProps = {
  src: string;
  /** 0..1 typical (>1 boosts); constant or a function of the local frame. */
  volume?: VolumeProp;
  /** Skip this many frames into the audio file before playing. */
  startFrom?: number;
};

/** Resolves a VolumeProp against this commit's frame. Shared by media components. */
export const resolveVolume = (volume: VolumeProp, frame: number): number =>
  typeof volume === 'function' ? volume(frame) : volume;

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
  const resolvedVolume = resolveVolume(volume, frame);

  // --- RENDER: collect this frame's audio. No deps: runs after EVERY commit, so
  // it reports even when the renderer re-renders the same frame number (e.g. the
  // initial frame 0). reportAudio() no-ops unless a render is collecting.
  useLayoutEffect(() => {
    reportAudio({id, src, mediaTime, volume: resolvedVolume});
  });

  // --- PREVIEW: element sync lives in useMediaSync — shared with <Video>.
  useMediaSync(ref, playback, mediaTime, resolvedVolume);

  return <audio ref={ref} src={src} preload="auto" />;
};
