import {useLayoutEffect, useState} from 'react';
import {flushSync} from 'react-dom';
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from '../framewise-lite';

export type AsyncImageProps = {
  /** How long the simulated "fetch" takes. Kept well above renderer cold-start
   *  latency so the no-wait render reliably captures the unresolved state. */
  fetchDelayMs: number;
};

/**
 * A composition that depends on TWO async things:
 *   1. <Img> — a real image that must load over the (local) network.
 *   2. <SlowData> — a simulated fetch, gated by delayRender, that resolves only
 *      after `fetchDelayMs`. This is the deterministic discriminator: without a
 *      delayRender-aware renderer, frame 0 is captured before it resolves and
 *      shows "Loading…".
 *
 * Render it with the renderer's `--no-wait` flag vs. without to see the
 * difference at frame 0.
 */
export const AsyncImage = ({fetchDelayMs}: AsyncImageProps) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  // A frame-driven element so it's a real (animating) video, not a still.
  const barWidth = interpolate(frame, [0, durationInFrames - 1], [0, 100]);

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(135deg, #0f172a, #1e293b)',
        color: 'white',
        fontFamily: 'Inter, system-ui, sans-serif',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
      }}
    >
      <Img
        src={staticFile('photo.png')}
        width={320}
        height={320}
        style={{borderRadius: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.5)'}}
      />

      <SlowData fetchDelayMs={fetchDelayMs} />

      {/* frame-driven progress bar */}
      <div style={{width: 480, height: 8, background: '#334155', borderRadius: 4}}>
        <div
          style={{
            width: `${barWidth}%`,
            height: '100%',
            background: '#38bdf8',
            borderRadius: 4,
          }}
        />
      </div>
      <div style={{opacity: 0.5, fontSize: 18}}>frame {frame}</div>
    </AbsoluteFill>
  );
};

const SlowData = ({fetchDelayMs}: {fetchDelayMs: number}) => {
  const [headline, setHeadline] = useState<string | null>(null);

  useLayoutEffect(() => {
    const handle = delayRender('SlowData fetch');
    const timer = setTimeout(() => {
      // CRITICAL: commit the state synchronously BEFORE clearing the handle.
      // A plain setHeadline would commit asynchronously, so the renderer could
      // see pending===0 and screenshot the still-"Loading…" DOM.
      flushSync(() => setHeadline('Fetched headline ✨'));
      continueRender(handle);
    }, fetchDelayMs);

    return () => {
      clearTimeout(timer);
      continueRender(handle);
    };
  }, [fetchDelayMs]);

  return (
    <h1 style={{margin: 0, fontSize: 56, fontWeight: 800}}>
      {headline ?? 'Loading…'}
    </h1>
  );
};
