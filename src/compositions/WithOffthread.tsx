import {AbsoluteFill, OffthreadVideo, useCurrentFrame} from '../framewise-lite';

/**
 * Demo composition for <OffthreadVideo> — the ffmpeg-extraction sibling of
 * WithVideo. Same layout (clip full-frame + React overlay) so the two
 * compositions' outputs are directly comparable: the overlay proves true
 * compositing, the clip's burned-in frame counter proves frame accuracy.
 */
export const WithOffthread = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{background: 'black'}}>
      <OffthreadVideo src="/clip.mp4" />
      <div
        style={{
          position: 'absolute',
          bottom: 40,
          left: 40,
          padding: '12px 24px',
          background: 'rgba(0,0,0,0.65)',
          color: 'white',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 40,
          borderRadius: 8,
        }}
      >
        offthread · comp frame {frame}
      </div>
    </AbsoluteFill>
  );
};
