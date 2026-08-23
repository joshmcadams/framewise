import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from '../framewise-lite';

/**
 * A composition with a soundtrack:
 *  - a continuous background tone from frame 0 (volume 0.3) that fades out
 *    over the final second — per-frame volume automation via a callback
 *  - a short "blip" placed at frame 60 via <Sequence>, at volume 0.7
 *
 * The two volumes sum to 1.0 so the mix doesn't clip. The blip's offset is the
 * thing the render verification checks: the audio energy around 2.0s (frame 60)
 * must be higher than around 0.5s and 3.5s (background only).
 */
export const WithAudio = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  // Visual: a disc that pulses when the blip plays, so preview shows the sync.
  const blipLocal = frame - 60;
  const blipPulse =
    blipLocal >= 0 && blipLocal < 15 ? spring({frame: blipLocal, fps, config: {damping: 8}}) : 0;
  const discScale = 1 + interpolate(blipPulse, [0, 1], [0, 0.4]);

  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(circle at 50% 45%, #1e1b4b, #020617)',
        color: 'white',
        fontFamily: 'Inter, system-ui, sans-serif',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 36,
      }}
    >
      <div
        style={{
          width: 220,
          height: 220,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #818cf8, #38bdf8)',
          transform: `scale(${discScale})`,
          boxShadow: '0 0 80px rgba(129,140,248,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 64,
        }}
      >
        ♪
      </div>
      <div style={{fontSize: 28, opacity: 0.7}}>
        frame {frame} / {durationInFrames}
      </div>

      {/* Background tone for the whole video, fading out over the final
          second: the volume callback runs every frame, in preview AND render.
          Clamped so it holds 0.3 until the fade window starts. */}
      <Audio
        src={staticFile('bg.wav')}
        volume={(f) =>
          interpolate(f, [durationInFrames - 30, durationInFrames], [0.3, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
        }
      />

      {/* A blip at frame 60 (2.0s). The Sequence both times it and clips it to
          the blip's 15-frame (0.5s) length. */}
      <Sequence from={60} durationInFrames={15} layout="none">
        <Audio src={staticFile('blip.wav')} volume={0.7} />
      </Sequence>
    </AbsoluteFill>
  );
};
