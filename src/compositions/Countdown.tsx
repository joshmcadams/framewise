import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '../framewise-lite';

export type CountdownProps = {
  seconds: number;
};

/**
 * A countdown whose LENGTH comes from its props: the registry entry declares
 * calculateMetadata so `props.seconds` derives durationInFrames at load time
 * (`--props '{"seconds":3}'` renders a 90-frame video; the default 5 renders
 * 150). The component itself only reads the frame — it never knows how long
 * the video is beyond what useVideoConfig reports.
 */
export const Countdown = ({seconds}: CountdownProps) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  // Ceiling so "5" is displayed during the whole first second, …2 during
  // frames 60–89, and the last shown number is 1 (never 0).
  const secondsLeft = Math.max(0, Math.ceil((durationInFrames - frame) / fps));

  // Pop each new number in as it appears.
  const secondIndex = Math.floor(frame / fps);
  const intoSecond = frame % fps;
  const pop = spring({frame: intoSecond, fps, config: {damping: 11}});

  // Progress bar drains across the whole video.
  const progress = interpolate(frame, [0, durationInFrames], [100, 0]);

  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(circle at 50% 45%, #172554, #020617)',
        color: 'white',
        fontFamily: 'Inter, system-ui, sans-serif',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{position: 'absolute', top: 60, fontSize: 30, opacity: 0.7}}>
        {seconds} second{seconds === 1 ? '' : 's'} · {durationInFrames} frames
      </div>
      <h1
        key={secondIndex}
        style={{
          fontSize: 320,
          margin: 0,
          lineHeight: 1,
          transform: `scale(${pop})`,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {secondsLeft}
      </h1>
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          left: '50%',
          width: 600,
          marginLeft: -300,
          height: 10,
          borderRadius: 5,
          background: 'rgba(255,255,255,0.15)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #38bdf8, #818cf8)',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
