# 03 — Extract a shared "composition host" to stop the Player and renderer drifting

## Problem

The two frame sources — `<Player>` (preview) and `main-render.tsx` (export) —
each independently build the same provider stack around the composition. This is
the exact seam the whole project is about, yet the wiring is duplicated, so the
two paths can silently diverge (e.g. a new context provider added to one and
forgotten in the other).

- `src/framewise-lite/Player.tsx:194-201`:

  ```jsx
  <VideoConfigProvider value={config}>
    <FrameProvider value={frame}>
      <PlaybackProvider value={playbackValue}>
        <Component {...inputProps} />
      </PlaybackProvider>
    </FrameProvider>
  </VideoConfigProvider>
  ```

- `src/render/main-render.tsx:65-73`:

  ```jsx
  <VideoConfigProvider value={config}>
    <FrameProvider value={frame}>
      <Component {...comp.defaultProps} />
    </FrameProvider>
  </VideoConfigProvider>
  ```

The only intentional difference is that the renderer omits `PlaybackProvider`
(null playback == render mode). That distinction should be expressed in *one*
place, not reconstructed by hand in two.

## Goal

Introduce a single component that renders a composition given a frame + config,
and have both call sites use it. Suggested shape in `VideoConfig.tsx` (or a new
`CompositionHost.tsx`):

```jsx
export function CompositionHost({config, frame, playback, children}) {
  const tree = (
    <VideoConfigProvider value={config}>
      <FrameProvider value={frame}>{children}</FrameProvider>
    </VideoConfigProvider>
  );
  // Preview wraps with playback state; render mode passes playback={undefined}.
  return playback ? <PlaybackProvider value={playback}>{tree}</PlaybackProvider> : tree;
}
```

- `Player` passes `playback={playbackValue}`.
- `main-render` passes no `playback`, preserving the "context is null when
  rendering" contract that `Audio`/`Video` rely on.

This makes the provider order canonical and guarantees preview and export wrap
the component identically — which is the property the README sells as the core
idea ("the preview and the export run the identical component code").

## Secondary cleanup (optional, same theme)

- `PlayerProps` spreads `VideoConfig` plus extras; the renderer reads the same
  four fields off `Composition`. Consider having `Player` accept a `config:
  VideoConfig` object instead of four loose props so both sides pass the same
  shape. Lower priority — don't let it balloon this task.

## Acceptance criteria

- One component owns the provider stack; `Player.tsx` and `main-render.tsx` both
  delegate to it.
- `npm run build` (typecheck) passes; preview still plays audio/video, render
  still produces identical output (compare the frame sha256 the renderer prints
  before and after).
- No behavioral change to render mode (playback context still null there).
