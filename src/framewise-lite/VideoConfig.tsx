import {createContext, useContext} from 'react';
import type {CSSProperties, ReactNode} from 'react';

/**
 * The metadata that describes a video. Mirrors Framewise's video config.
 */
export type VideoConfig = {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

/**
 * The two contexts are intentionally separate and intentionally "dumb":
 *
 *  - `FrameContext` holds nothing but the current frame number.
 *  - `VideoConfigContext` holds the static metadata.
 *
 * Crucially, NOTHING in this file knows about a clock, requestAnimationFrame,
 * or playback. `useCurrentFrame()` only ever *reads* the frame. Whoever renders
 * the tree decides what the frame is — the `<Player>` drives it from a wall
 * clock, but a renderer could just as well set frame=0, screenshot, set frame=1,
 * screenshot, and so on. That decoupling is the whole point of Framewise: the
 * preview and the export run the identical component code.
 */
const FrameContext = createContext<number>(0);
const VideoConfigContext = createContext<VideoConfig | null>(null);

export const FrameProvider = FrameContext.Provider;
export const VideoConfigProvider = VideoConfigContext.Provider;

/**
 * Returns the current frame. A component re-renders whenever the frame changes.
 */
export const useCurrentFrame = (): number => {
  return useContext(FrameContext);
};

/**
 * Returns the static video metadata (width, height, fps, durationInFrames).
 */
export const useVideoConfig = (): VideoConfig => {
  const config = useContext(VideoConfigContext);
  if (config === null) {
    throw new Error(
      'useVideoConfig() was called outside of a composition. Render your component inside a <Player> (or another provider of VideoConfig).',
    );
  }

  return config;
};

const absoluteFillStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};

/**
 * A `<div>` that fills its positioned parent. The default building block for
 * full-screen layers, exactly like Framewise's `<AbsoluteFill>`.
 */
export const AbsoluteFill = ({
  children,
  style,
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) => {
  return <div style={{...absoluteFillStyle, ...style}}>{children}</div>;
};
