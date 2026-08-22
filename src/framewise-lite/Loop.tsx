import type {CSSProperties, ReactNode} from 'react';
import {Sequence} from './Sequence';
import {useCurrentFrame} from './VideoConfig';

/**
 * `<Loop>` repeats its children on a fixed cadence:
 *
 *   <Loop durationInFrames={30} times={3}><PulsingDot /></Loop>
 *
 * Iteration `i = floor(frame / durationInFrames)` renders the children inside
 * a `<Sequence from={i * durationInFrames} durationInFrames={durationInFrames}>`,
 * so the child's clock restarts at 0 every cycle and the whole loop unmounts
 * after `times` cycles (forever, if `times` is omitted). Like `<Series>`, all
 * the mechanics are inherited from `Sequence` — this is one line of arithmetic.
 */
export const Loop = ({
  durationInFrames,
  times = Infinity,
  layout = 'absolute-fill',
  style,
  children,
}: {
  /** Length of one iteration, in frames. */
  durationInFrames: number;
  /** How many times to repeat. Defaults to forever. */
  times?: number;
  /** Forwarded to the inner <Sequence>. */
  layout?: 'absolute-fill' | 'none';
  style?: CSSProperties;
  children: ReactNode;
}) => {
  if (!Number.isInteger(durationInFrames) || durationInFrames <= 0) {
    throw new Error(
      `<Loop> requires "durationInFrames" to be a positive whole number of frames, but got ${durationInFrames}.`,
    );
  }
  if (times !== Infinity && (!Number.isFinite(times) || times < 1)) {
    throw new Error(`<Loop> requires "times" to be a positive number, but got ${times}.`);
  }

  const frame = useCurrentFrame();
  const iteration = Math.floor(frame / durationInFrames);
  if (iteration >= times) {
    return null;
  }

  return (
    <Sequence
      from={iteration * durationInFrames}
      durationInFrames={durationInFrames}
      layout={layout}
      style={style}
    >
      {children}
    </Sequence>
  );
};
