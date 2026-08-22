import {
  AbsoluteFill,
  Easing,
  interpolate,
  Loop,
  Series,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '../framewise-lite';

/**
 * Demo composition for the timeline helpers:
 *  - <Series> plays three cards back-to-back — no hand-computed `from` values.
 *  - The middle card nests its own <Series> (offsets re-base automatically).
 *  - The last card uses <Loop> to pulse a dot every half second, three times.
 */

const Card = ({hue, children}: {hue: number; children: React.ReactNode}) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(circle at 50% 40%, hsl(${hue} 70% 24%), hsl(${hue + 40} 80% 8%))`,
      justifyContent: 'center',
      alignItems: 'center',
      color: 'white',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}
  >
    {children}
  </AbsoluteFill>
);

const TitleCard = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const scale = spring({frame, fps, config: {damping: 12}});
  return (
    <Card hue={220}>
      <h1 style={{fontSize: 96, margin: 0, transform: `scale(${scale})`, letterSpacing: -2}}>
        one after another
      </h1>
    </Card>
  );
};

const Chip = ({label}: {label: string}) => {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [0, 12], [30, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div
      style={{
        padding: '12px 28px',
        margin: 10,
        fontSize: 36,
        borderRadius: 999,
        background: 'rgba(255,255,255,0.14)',
        opacity: interpolate(frame, [0, 12], [0, 1], {extrapolateRight: 'clamp'}),
        transform: `translateY(${y}px)`,
      }}
    >
      {label}
    </div>
  );
};

// A card that is itself a timeline: its chips play back-to-back via a nested
// <Series>, whose offsets are computed against this card's already-shifted clock.
const ChipsCard = () => (
  <Card hue={260}>
    <Series layout="none">
      <Series.Sequence durationInFrames={15}>
        <Chip label="first" />
      </Series.Sequence>
      <Series.Sequence durationInFrames={15}>
        <Chip label="then" />
      </Series.Sequence>
      <Series.Sequence durationInFrames={15}>
        <Chip label="last" />
      </Series.Sequence>
    </Series>
  </Card>
);

const PulsingDot = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const scale = spring({frame, fps, config: {damping: 8}});
  return (
    <div style={{textAlign: 'center'}}>
      <div
        style={{
          width: 90,
          height: 90,
          borderRadius: '50%',
          background: 'white',
          transform: `scale(${scale})`,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
      />
      <p style={{fontSize: 34, color: 'rgba(255,255,255,0.85)'}}>pulsing on a half-second beat</p>
    </div>
  );
};

// <Loop> restarts its child's clock every 15 frames (three times), so the dot
// pops fresh each cycle without any reset logic here.
const LoopsCard = () => (
  <Card hue={300}>
    <Loop durationInFrames={15} times={3}>
      <PulsingDot />
    </Loop>
  </Card>
);

export const WithSeries = () => (
  <Series>
    <Series.Sequence durationInFrames={60}>
      <TitleCard />
    </Series.Sequence>
    <Series.Sequence durationInFrames={45}>
      <ChipsCard />
    </Series.Sequence>
    <Series.Sequence durationInFrames={45}>
      <LoopsCard />
    </Series.Sequence>
  </Series>
);
