// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ComponentType} from 'react';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {useCurrentFrame} from './VideoConfig';
import {Player} from './Player';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver, which the Player uses for responsive scaling.
let resizeCallback: (() => void) | null = null;

class ResizeObserverStub {
  constructor(cb: () => void) {
    resizeCallback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const triggerResize = () => {
  if (resizeCallback) resizeCallback();
};

const Probe = (() => {
  const frame = useCurrentFrame();
  return <span data-testid="frame">{frame}</span>;
}) as ComponentType<Record<string, unknown>>;

let container: HTMLDivElement;
let root: Root;
let now: number;
let rafQueue: {id: number; cb: FrameRequestCallback}[];
let nextRafId: number;
let cancelledIds: Set<number>;

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
      for (const {id, cb} of callbacks) {
        if (!cancelledIds.has(id)) cb(now);
      }
    });
  }
};

beforeEach(() => {
  now = 0;
  rafQueue = [];
  nextRafId = 0;
  cancelledIds = new Set();
  resizeCallback = null;
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = ++nextRafId;
    rafQueue.push({id, cb});
    return id;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
    cancelledIds.add(id as number);
  });

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

const mount = (props: Partial<{durationInFrames: number; loop: boolean; autoPlay: boolean; controls: boolean; width: number; height: number; maxHeight: number}> = {}) => {
  act(() => {
    root.render(
      <Player
        component={Probe}
        width={props.width ?? 100}
        height={props.height ?? 100}
        fps={30}
        durationInFrames={props.durationInFrames ?? 300}
        loop={props.loop ?? false}
        autoPlay={props.autoPlay ?? true}
        controls={props.controls ?? true}
        maxHeight={props.maxHeight}
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

describe('Player controls', () => {
  const keydown = (key: string) => {
    const div = container.firstChild as HTMLDivElement;
    act(() => {
      div.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true}));
    });
  };

  const scrubTo = (val: number) => {
    const input = container.querySelector('input[type="range"]')!;
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;
    act(() => {
      setValue.call(input, String(val));
      input.dispatchEvent(new Event('input', {bubbles: true}));
    });
  };

  it('ArrowRight steps forward one frame, ArrowLeft steps back', () => {
    mount({autoPlay: false});
    expect(frame()).toBe(0);

    keydown('ArrowRight');
    expect(frame()).toBe(1);

    keydown('ArrowLeft');
    expect(frame()).toBe(0);
  });

  it('clamps ArrowLeft at start and clamps scrub beyond max', () => {
    mount({autoPlay: false, durationInFrames: 10});
    expect(frame()).toBe(0);

    keydown('ArrowLeft');
    expect(frame()).toBe(0);

    scrubTo(99);
    expect(frame()).toBe(9);
  });

  it('Space toggles playback on and off', () => {
    mount({autoPlay: false});
    expect(frame()).toBe(0);

    keydown(' ');
    runFrames(30, 0, 1000);
    expect(frame()).toBe(30);

    keydown(' ');
    runFrames(30, 1000, 2000);
    expect(frame()).toBe(30);
  });

  it('scrubbing pauses and subsequent time does not advance', () => {
    mount({autoPlay: true, durationInFrames: 300});
    runFrames(30, 0, 1000);
    expect(frame()).toBe(30);

    scrubTo(42);
    expect(frame()).toBe(42);

    runFrames(30, 1000, 2000);
    expect(frame()).toBe(42);
  });

  it('scrub re-baselines the clock so playback resumes from scrubbed position', () => {
    mount({autoPlay: false});
    expect(frame()).toBe(0);

    scrubTo(42);
    expect(frame()).toBe(42);

    keydown(' ');
    runFrames(30, 0, 1000);
    expect(frame()).toBe(72);
  });

  it('replays from the beginning when pressing play at the last frame', () => {
    mount({autoPlay: true, durationInFrames: 10});
    runFrames(40, 0, 2000);
    expect(frame()).toBe(9);

    keydown(' ');
    runFrames(5, 2000, 2100);
    const f = frame();
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(9);
  });
});

describe('Player scale', () => {
  it('scales by width only when no maxHeight is set', () => {
    mount({width: 1280, height: 720, autoPlay: false, controls: false});

    const outerDiv = container.firstChild as HTMLDivElement;
    Object.defineProperty(outerDiv, 'clientWidth', {value: 1000, configurable: true});
    act(() => {
      triggerResize();
    });

    const stageDiv = outerDiv.firstChild as HTMLDivElement;
    expect(stageDiv.style.width).toBe('1000px');
  });

  it('scales by min of width and maxHeight when maxHeight is set', () => {
    mount({width: 1280, height: 720, maxHeight: 360, autoPlay: false, controls: false});

    const outerDiv = container.firstChild as HTMLDivElement;
    Object.defineProperty(outerDiv, 'clientWidth', {value: 1000, configurable: true});
    act(() => {
      triggerResize();
    });

    const stageDiv = outerDiv.firstChild as HTMLDivElement;
    expect(stageDiv.style.width).toBe('640px');
    expect(stageDiv.style.height).toBe('360px');
  });
});
