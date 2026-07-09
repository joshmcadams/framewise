// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ComponentType} from 'react';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {useCurrentFrame} from './VideoConfig';
import {Player} from './Player';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver, which the Player uses for responsive scaling.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const Probe = (() => {
  const frame = useCurrentFrame();
  return <span data-testid="frame">{frame}</span>;
}) as ComponentType<Record<string, unknown>>;

let container: HTMLDivElement;
let root: Root;
let now: number;
let rafQueue: FrameRequestCallback[];

const frame = () => Number(container.querySelector('[data-testid="frame"]')?.textContent);

// Drive the rAF loop the way a real display would: run `ticks` animation
// frames while wall-clock time moves linearly from `fromMs` to `toMs`. The
// Player reschedules exactly one rAF per tick, so the queue stays length 1.
const runFrames = (ticks: number, fromMs: number, toMs: number) => {
  for (let i = 1; i <= ticks; i++) {
    now = fromMs + ((toMs - fromMs) * i) / ticks;
    const callbacks = rafQueue;
    rafQueue = [];
    act(() => {
      for (const cb of callbacks) cb(now);
    });
  }
};

beforeEach(() => {
  now = 0;
  rafQueue = [];
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = (props: Partial<{durationInFrames: number; loop: boolean}> = {}) => {
  act(() => {
    root.render(
      <Player
        component={Probe}
        width={100}
        height={100}
        fps={30}
        durationInFrames={props.durationInFrames ?? 300}
        loop={props.loop ?? false}
        autoPlay
      />,
    );
  });
};

describe('Player clock', () => {
  it('derives the frame from elapsed wall-clock time, not the rAF tick count', () => {
    mount();
    expect(frame()).toBe(0);

    // Simulate a 120Hz display for one full second: 120 animation frames,
    // but at 30fps the composition must advance exactly 30 frames.
    runFrames(60, 0, 500);
    expect(frame()).toBe(15); // half a second in

    runFrames(60, 500, 1000);
    expect(frame()).toBe(30); // a full second -> 30 frames, NOT 120 ticks
  });

  it('runs at the comp fps regardless of refresh rate (30 ticks reach the same frame)', () => {
    mount();
    // A 30Hz display: 30 ticks across the same one second.
    runFrames(30, 0, 1000);
    expect(frame()).toBe(30);
  });

  it('stops at the last frame when not looping', () => {
    mount({durationInFrames: 10, loop: false});
    // Push well past the end (2 seconds of a 10-frame, 30fps comp).
    runFrames(40, 0, 2000);
    expect(frame()).toBe(9); // durationInFrames - 1, then playback halts
  });

  it('wraps around when looping', () => {
    mount({durationInFrames: 10, loop: true});
    // 10 frames = 1/3s at 30fps. At 0.5s we're at frame floor(15 % 10) = 5.
    runFrames(30, 0, 500);
    expect(frame()).toBe(5);
  });
});
