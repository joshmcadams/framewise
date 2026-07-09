import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill, FrameProvider, useCurrentFrame} from './VideoConfig';

/**
 * `<Sequence>` is the single most important compositional primitive in Framewise,
 * and it is almost deceptively small: it just shifts the frame number.
 *
 * A child inside `<Sequence from={30}>` sees frame 0 when the outer timeline is
 * at frame 30. So every animation can be written as if it starts at 0, and you
 * place it in time by wrapping it. Outside the window
 * `[from, from + durationInFrames)` the children are unmounted.
 *
 * `<Series>`, transitions, and most higher-level timing helpers are all built on
 * top of this one trick.
 */
export const Sequence = ({
  from = 0,
  durationInFrames = Infinity,
  layout = 'absolute-fill',
  style,
  children,
}: {
  from?: number;
  durationInFrames?: number;
  /** 'absolute-fill' wraps children in an AbsoluteFill; 'none' renders them as-is. */
  layout?: 'absolute-fill' | 'none';
  style?: CSSProperties;
  children: ReactNode;
}) => {
  const frame = useCurrentFrame();
  const shifted = frame - from;

  const isActive = shifted >= 0 && shifted < durationInFrames;
  if (!isActive) {
    return null;
  }

  const content =
    layout === 'none' ? <>{children}</> : <AbsoluteFill style={style}>{children}</AbsoluteFill>;

  return <FrameProvider value={shifted}>{content}</FrameProvider>;
};
