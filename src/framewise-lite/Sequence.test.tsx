// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {FrameProvider, useCurrentFrame} from './VideoConfig';
import {Sequence} from './Sequence';

// Tell React we're in an act() environment so state updates flush synchronously
// and the "not configured to support act" warning goes away.
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

// A probe child that surfaces the frame it sees (after the Sequence's shift)
// and tags itself so we can detect whether it mounted at all.
const Probe = () => {
  const frame = useCurrentFrame();
  return <span data-testid="probe" data-frame={frame} />;
};

let container: HTMLDivElement;
let root: Root;

const render = (outerFrame: number, node: React.ReactNode) => {
  act(() => {
    root.render(<FrameProvider value={outerFrame}>{node}</FrameProvider>);
  });
};

const probe = () => container.querySelector('[data-testid="probe"]');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('<Sequence>', () => {
  it('rebases the child frame to 0 at the sequence start', () => {
    render(30, <Sequence from={30}><Probe /></Sequence>);
    expect(probe()?.getAttribute('data-frame')).toBe('0');
  });

  it('shifts the child frame by `from` inside the window', () => {
    render(45, <Sequence from={30}><Probe /></Sequence>);
    expect(probe()?.getAttribute('data-frame')).toBe('15');
  });

  it('does not mount the child before `from`', () => {
    render(29, <Sequence from={30}><Probe /></Sequence>);
    expect(probe()).toBeNull();
  });

  it('mounts on the first frame of the window and unmounts at the end (half-open)', () => {
    // Window is [from, from + durationInFrames) = [30, 40).
    render(30, <Sequence from={30} durationInFrames={10}><Probe /></Sequence>);
    expect(probe()?.getAttribute('data-frame')).toBe('0');

    render(39, <Sequence from={30} durationInFrames={10}><Probe /></Sequence>);
    expect(probe()?.getAttribute('data-frame')).toBe('9');

    // Frame 40 is outside the half-open window: unmounted.
    render(40, <Sequence from={30} durationInFrames={10}><Probe /></Sequence>);
    expect(probe()).toBeNull();
  });

  it('wraps children in an AbsoluteFill by default and not with layout="none"', () => {
    render(0, <Sequence from={0}><Probe /></Sequence>);
    // Default layout adds a positioned wrapper div around the probe.
    const wrapper = probe()?.parentElement;
    expect(wrapper?.tagName).toBe('DIV');
    expect(wrapper?.style.position).toBe('absolute');

    render(0, <Sequence from={0} layout="none"><Probe /></Sequence>);
    // No wrapper div: the probe is a direct child of the container.
    expect(probe()?.parentElement).toBe(container);
  });
});
