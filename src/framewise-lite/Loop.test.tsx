// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {FrameProvider, useCurrentFrame} from './VideoConfig';
import {Loop} from './Loop';

// Tell React we're in an act() environment so state updates flush synchronously
// and the "not configured to support act" warning goes away.
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const Probe = ({tag = 'probe'}: {tag?: string}) => {
  const frame = useCurrentFrame();
  return <span data-testid={tag} data-frame={frame} />;
};

let container: HTMLDivElement;
let root: Root;

const render = (outerFrame: number, node: React.ReactNode) => {
  act(() => {
    root.render(<FrameProvider value={outerFrame}>{node}</FrameProvider>);
  });
};

const probe = (tag = 'probe') => container.querySelector(`[data-testid="${tag}"]`);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('<Loop>', () => {
  it('shows the child rebased to the iteration start', () => {
    render(
      7,
      <Loop durationInFrames={30}>
        <Probe />
      </Loop>,
    );
    expect(probe()?.getAttribute('data-frame')).toBe('7');
  });

  it('restarts the child clock every cycle', () => {
    render(
      32,
      <Loop durationInFrames={30}>
        <Probe />
      </Loop>,
    );
    // Iteration 1 began at frame 30, so the child sees frame 2 again.
    expect(probe()?.getAttribute('data-frame')).toBe('2');
  });

  it('repeats indefinitely when times is omitted', () => {
    render(
      300,
      <Loop durationInFrames={30}>
        <Probe />
      </Loop>,
    );
    expect(probe()?.getAttribute('data-frame')).toBe('0');
  });

  it('unmounts after `times` iterations at the half-open boundary', () => {
    const loop = (
      <Loop durationInFrames={10} times={3}>
        <Probe />
      </Loop>
    );

    render(29, loop); // last frame of the third iteration
    expect(probe()?.getAttribute('data-frame')).toBe('9');

    render(30, loop); // one past the end: unmounted
    expect(probe()).toBeNull();
  });

  it('composes with nesting: inner loops re-time within their parent iteration', () => {
    const nested = (
      <Loop durationInFrames={40} times={2}>
        <Loop durationInFrames={10}>
          <Probe />
        </Loop>
      </Loop>
    );

    // Outer iteration 1 starts at frame 40; inner sees local frame 5.
    render(45, nested);
    expect(probe()?.getAttribute('data-frame')).toBe('5');

    // Inner has cycled once inside this outer iteration: local 12 → inner frame 2.
    render(52, nested);
    expect(probe()?.getAttribute('data-frame')).toBe('2');
  });

  it('throws on invalid durationInFrames', () => {
    for (const bad of [0, -3, 4.5]) {
      expect(() =>
        render(
          0,
          <Loop durationInFrames={bad}>
            <Probe />
          </Loop>,
        ),
      ).toThrow(/positive whole number/);
    }
  });

  it('throws on invalid times', () => {
    expect(() =>
      render(
        0,
        <Loop durationInFrames={10} times={0}>
          <Probe />
        </Loop>,
      ),
    ).toThrow(/positive number/);
  });
});
