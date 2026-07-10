import {
  AbsoluteFill,
  Easing,
  interpolate,
  random,
  spring,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from '../framewise-lite';

export type HelloWorldProps = {
  title: string;
  subtitle: string;
};

/**
 * A demo composition that exercises every primitive:
 *  - useCurrentFrame / useVideoConfig
 *  - spring() for the title pop-in
 *  - interpolate() for fades, motion, and color
 *  - <Sequence> for timing the subtitle and the looping dot
 */
export const HelloWorld = ({title, subtitle}: HelloWorldProps) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  // Spring-driven scale for the title (overshoots, then settles).
  const scale = spring({frame, fps, config: {damping: 12, stiffness: 120}});

  // Background hue drifts across the whole video via interpolate.
  const hue = interpolate(frame, [0, durationInFrames], [220, 320]);

  // Title fades in over the first 15 frames, then out over the last 20.
  const titleOpacity = interpolate(
    frame,
    [0, 15, durationInFrames - 20, durationInFrames],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, hsl(${hue} 70% 22%), hsl(${
          hue + 40
        } 80% 8%))`,
        justifyContent: 'center',
        alignItems: 'center',
        color: 'white',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <h1
        style={{
          fontSize: 110,
          fontWeight: 800,
          margin: 0,
          transform: `scale(${scale})`,
          opacity: titleOpacity,
          letterSpacing: -2,
        }}
      >
        {title}
      </h1>

      {/* The subtitle is its own clip: it appears at frame 25 and slides up. */}
      <Sequence from={25}>
        <Subtitle text={subtitle} />
      </Sequence>

      {/* A looping accent dot, re-timed by a nested Sequence. */}
      <Sequence from={40}>
        <LoopingDot />
      </Sequence>
    </AbsoluteFill>
  );
};

const Subtitle = ({text}: {text: string}) => {
  // Inside the Sequence, frame is re-based to 0 at the parent's frame 25.
  const frame = useCurrentFrame();
  const y = interpolate(frame, [0, 20], [40, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const opacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 140,
        fontSize: 40,
        fontWeight: 500,
        opacity,
        transform: `translateY(${y}px)`,
        color: 'rgba(255,255,255,0.85)',
      }}
    >
      {text}
    </div>
  );
};

const LoopingDot = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  // A spring that re-triggers every second by feeding it frame % fps.
  const bounce = spring({
    frame: frame % fps,
    fps,
    config: {damping: 8},
  });
  const x = interpolate(bounce, [0, 1], [-120, 120]);

  const cycle = Math.floor(frame / fps);
  // Deterministic "randomness": same seed → same value in preview and in every
  // parallel render worker. Math.random() here would break the frame-hash check.
  const jitter = interpolate(random(`dot:${cycle}`), [0, 1], [-24, 24]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 90,
        left: '50%',
        width: 16,
        height: 16,
        marginLeft: -8,
        borderRadius: '50%',
        background: 'white',
        transform: `translateX(${x}px) translateY(${jitter}px)`,
      }}
    />
  );
};
