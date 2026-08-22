import {useId, useLayoutEffect} from 'react';
import {useCurrentFrame, useVideoConfig} from './VideoConfig';
import {reportAudio} from './audio-registry';
import {Img} from './Img';
import {usePlayback} from './playback';
import {Video, type VideoProps} from './Video';

/**
 * The production-grade sibling of `<Video>` (chapter 10's "honest
 * alternative"). Same props, same audio behavior — different visual path in a
 * render:
 *
 *  - PREVIEW: renders a real `<Video>` (live element, best-effort sync) —
 *    exactly what interactive scrubbing wants.
 *  - RENDER: never seeks an element. Instead it renders the frame as an image,
 *    extracted on demand by ffmpeg (seeking to exactly `frame / fps`) and
 *    served by the renderer at /__framewise_extract/…; that `<Img>` participates
 *    in delayRender like any other image, so the capture waits for the exact
 *    frame. Frame-accurate by construction — no compositor dependency.
 *
 * The audio track still rides Stage 4: identical reportAudio call as `<Video>`,
 * so ffmpeg muxes it with zero renderer changes.
 */
export const OffthreadVideo = ({
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

  const mediaTime = (frame + startFrom) / fps;

  // AUDIO: same contract as <Video>. Inert in preview (reportAudio no-ops
  // outside a render) and when muted.
  useLayoutEffect(() => {
    if (!muted) {
      reportAudio({id, src, mediaTime, volume});
    }
  });

  if (playback) {
    // PREVIEW: delegate to the live element.
    return <Video src={src} volume={volume} startFrom={startFrom} muted={muted} style={style} />;
  }

  // RENDER: serve this video frame as an extracted PNG. The URL is cache-
  // stable per (source, frame) so parallel workers dedupe naturally.
  const videoFrame = frame + startFrom;
  const key = btoa(src).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const extractUrl = `/__framewise_extract/${key}/${videoFrame}.png?fps=${fps}`;

  return (
    <Img
      src={extractUrl}
      // The extraction is sized to the composition box; cover keeps any aspect
      // mismatch visually consistent with <Video>'s default.
      style={{width: '100%', height: '100%', objectFit: 'cover', ...style}}
    />
  );
};
