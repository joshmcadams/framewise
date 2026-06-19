import type {ReactNode} from 'react';
import {FrameProvider, VideoConfigProvider, type VideoConfig} from './VideoConfig';
import {PlaybackProvider, type Playback} from './playback';

/**
 * The single canonical wrapper that puts a composition under the context it
 * needs: the static video config and the current frame. Both frame sources use
 * it — the `<Player>` (preview) and the render entry (export) — so the two paths
 * can't drift. That equivalence ("the preview and the export run the identical
 * component code") is the whole point of Framewise, and centralizing the
 * provider stack here is what guarantees it.
 *
 * The ONE intentional difference between the two modes lives here too: preview
 * passes a `playback` value, render passes none. When `playback` is undefined the
 * PlaybackContext stays null, which is exactly how `<Audio>`/`<Video>` detect
 * "we're rendering, don't touch the live element." See playback.ts.
 */
export function CompositionHost({
  config,
  frame,
  playback,
  children,
}: {
  config: VideoConfig;
  frame: number;
  /** Preview supplies this; the renderer omits it (null context == render mode). */
  playback?: Playback;
  children: ReactNode;
}) {
  const tree = (
    <VideoConfigProvider value={config}>
      <FrameProvider value={frame}>{children}</FrameProvider>
    </VideoConfigProvider>
  );

  return playback ? (
    <PlaybackProvider value={playback}>{tree}</PlaybackProvider>
  ) : (
    tree
  );
}
