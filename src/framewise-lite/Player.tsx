import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {ComponentType} from 'react';
import {type VideoConfig} from './VideoConfig';
import {useDelayRenderPending} from './delay-render';
import {CompositionHost} from './CompositionHost';

export type PlayerProps<P extends Record<string, unknown>> = VideoConfig & {
  component: ComponentType<P>;
  inputProps?: P;
  loop?: boolean;
  autoPlay?: boolean;
  controls?: boolean;
  maxHeight?: number;
};

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

const formatTime = (frame: number, fps: number) => {
  const totalSeconds = frame / fps;
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/**
 * Plays a composition in the browser. The Player is just a *frame source*: it
 * owns a clock, computes the current frame, and hands it to the composition via
 * context. The composition itself has no idea a clock exists — it only calls
 * useCurrentFrame(). That is exactly the seam a renderer would plug into.
 */
export function Player<P extends Record<string, unknown>>({
  component: Component,
  inputProps,
  width,
  height,
  fps,
  durationInFrames,
  loop = false,
  autoPlay = false,
  controls = true,
  maxHeight,
}: PlayerProps<P>) {
  const [frame, setFrameState] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);

  // Refs let the rAF loop read the latest values without re-subscribing.
  const frameRef = useRef(0);
  const startTimeRef = useRef(0);
  const startFrameRef = useRef(0);

  const setFrame = useCallback((f: number) => {
    frameRef.current = f;
    setFrameState(f);
  }, []);

  const seekTo = useCallback(
    (f: number) => {
      const clamped = clamp(Math.round(f), 0, durationInFrames - 1);
      setFrame(clamped);
      // Re-baseline the clock so playback resumes from where we scrubbed to.
      startTimeRef.current = performance.now();
      startFrameRef.current = clamped;
    },
    [durationInFrames, setFrame],
  );

  // The clock. Note: frame is derived from elapsed *wall-clock* time, never
  // incremented per tick. Incrementing per tick would tie playback speed to the
  // display's refresh rate (a 30fps comp would run at 2x on a 120Hz screen).
  useEffect(() => {
    if (!playing) {
      return;
    }

    // Starting from the end? Rewind so pressing play again replays.
    if (!loop && frameRef.current >= durationInFrames - 1) {
      setFrame(0);
    }

    startTimeRef.current = performance.now();
    startFrameRef.current = frameRef.current;

    let raf = 0;
    const tick = () => {
      const elapsedMs = performance.now() - startTimeRef.current;
      const framesElapsed = (elapsedMs * fps) / 1000;
      const exact = startFrameRef.current + framesElapsed;

      if (loop) {
        setFrame(Math.floor(exact % durationInFrames));
      } else if (exact >= durationInFrames) {
        setFrame(durationInFrames - 1);
        setPlaying(false);
        return;
      } else {
        setFrame(Math.floor(exact));
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, fps, durationInFrames, setFrame]);

  const toggle = useCallback(() => setPlaying((p) => !p), []);

  // Keyboard: space = play/pause, arrows = step.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowLeft') {
        setPlaying(false);
        seekTo(frameRef.current - 1);
      } else if (e.key === 'ArrowRight') {
        setPlaying(false);
        seekTo(frameRef.current + 1);
      }
    },
    [toggle, seekTo],
  );

  const config = useMemo<VideoConfig>(
    () => ({width, height, fps, durationInFrames}),
    [width, height, fps, durationInFrames],
  );

  // Playback state for preview-only media sync (<Audio>). Memoized so it only
  // changes on play/pause, not every frame.
  const playbackValue = useMemo(() => ({playing}), [playing]);

  // Responsive scaling: render the stage at native size, then scale to fit.
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    const observer = new ResizeObserver(() => {
      const available = el.clientWidth;
      const widthScale = available / width;
      const heightScale = maxHeight !== undefined ? maxHeight / height : 1;
      setScale(Math.min(widthScale, heightScale, 1));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, height, maxHeight]);

  // Reflect outstanding delayRender handles in the preview, just as the renderer
  // waits on them. The composition shows its own loading UI; this is a badge so
  // you can see the mechanism is active.
  const pending = useDelayRenderPending();

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{outline: 'none', userSelect: 'none'}}
    >
      <div
        style={{
          position: 'relative',
          width: width * scale,
          height: height * scale,
          background: '#000',
          overflow: 'hidden',
          borderRadius: 8,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width,
            height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <CompositionHost config={config} frame={frame} playback={playbackValue}>
            {/* The composition. It sees only the frame + config. */}
            <Component {...((inputProps ?? {}) as P)} />
          </CompositionHost>
        </div>

        {pending > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'rgba(0,0,0,0.6)',
              color: 'white',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#fbbf24',
              }}
            />
            delayRender · {pending} pending
          </div>
        )}
      </div>

      {controls && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 10,
            fontFamily: 'ui-monospace, monospace',
            fontSize: 13,
            color: '#222',
          }}
        >
          <button
            onClick={toggle}
            style={{
              width: 40,
              height: 32,
              cursor: 'pointer',
              borderRadius: 6,
              border: '1px solid #ccc',
              background: '#fff',
            }}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? '❚❚' : '►'}
          </button>

          <input
            type="range"
            min={0}
            max={durationInFrames - 1}
            value={frame}
            onChange={(e) => {
              setPlaying(false);
              seekTo(Number(e.target.value));
            }}
            style={{flex: 1, cursor: 'pointer'}}
          />

          <span style={{whiteSpace: 'nowrap'}}>
            {formatTime(frame, fps)} / {formatTime(durationInFrames, fps)}
          </span>
          <span style={{whiteSpace: 'nowrap', color: '#888'}}>
            f{frame}/{durationInFrames}
          </span>
        </div>
      )}
    </div>
  );
}
