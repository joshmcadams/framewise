// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {FrameProvider, useCurrentFrame} from './VideoConfig';
import {Sequence} from './Sequence';
import {Series} from './Series';

// Tell React we're in an act() environment so state updates flush synchronously
// and the "not configured to support act" warning goes away.
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

// A tagged probe child that surfaces the frame it sees (after the Series' and
// Sequence's shifts) so we can detect which clip is mounted at a given frame.
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

describe('<Series>', () => {
  it('mounts the first child at frame 0 with a rebased clock', () => {
    render(
      12,
      <Series>
        <Series.Sequence durationInFrames={30}>
          <Probe tag="a" />
        </Series.Sequence>
      </Series>,
    );
    expect(probe('a')?.getAttribute('data-frame')).toBe('12');
  });

  it('starts each child where the previous one ends (cumulative offsets)', () => {
    render(
      30,
      <Series>
        <Series.Sequence durationInFrames={30}>
          <Probe tag="a" />
        </Series.Sequence>
        <Series.Sequence durationInFrames={20}>
          <Probe tag="b" />
        </Series.Sequence>
      </Series>,
    );
    // Child A's window is [0, 30): unmounted now.
    expect(probe('a')).toBeNull();
    // Child B starts exactly at 30 and its clock reads 0.
    expect(probe('b')?.getAttribute('data-frame')).toBe('0');
  });

  it('hands off strictly: neighbors never overlap', () => {
    const timeline = (
      <Series>
        <Series.Sequence durationInFrames={10}>
          <Probe tag="a" />
        </Series.Sequence>
        <Series.Sequence durationInFrames={10}>
          <Probe tag="b" />
        </Series.Sequence>
      </Series>
    );

    render(9, timeline); // last frame of A
    expect(probe('a')).not.toBeNull();
    expect(probe('b')).toBeNull();

    render(10, timeline); // first frame of B
    expect(probe('a')).toBeNull();
    expect(probe('b')?.getAttribute('data-frame')).toBe('0');
  });

  it('inserts spacing gaps between children', () => {
    const timeline = (
      <Series spacing={5}>
        <Series.Sequence durationInFrames={10}>
          <Probe tag="a" />
        </Series.Sequence>
        <Series.Sequence durationInFrames={10}>
          <Probe tag="b" />
        </Series.Sequence>
      </Series>
    );

    render(10, timeline);
    // Frames [10, 15) are the gap: nothing is mounted.
    expect(probe('a')).toBeNull();
    expect(probe('b')).toBeNull();

    render(15, timeline);
    // Child B starts after the gap and its clock reads 0.
    expect(probe('b')?.getAttribute('data-frame')).toBe('0');
  });

  it('uses defaultDurationInFrames for children that omit their duration', () => {
    render(
      0,
      <Series defaultDurationInFrames={8}>
        <Series.Sequence>
          <Probe tag="a" />
        </Series.Sequence>
        <Series.Sequence>
          <Probe tag="b" />
        </Series.Sequence>
      </Series>,
    );
    expect(probe('a')?.getAttribute('data-frame')).toBe('0');

    render(
      8,
      <Series defaultDurationInFrames={8}>
        <Series.Sequence>
          <Probe tag="a" />
        </Series.Sequence>
        <Series.Sequence>
          <Probe tag="b" />
        </Series.Sequence>
      </Series>,
    );
    expect(probe('a')).toBeNull();
    expect(probe('b')?.getAttribute('data-frame')).toBe('0');
  });

  it('throws when a child omits duration and no default is set', () => {
    expect(() =>
      render(
        0,
        <Series>
          <Series.Sequence>
            <Probe />
          </Series.Sequence>
        </Series>,
      ),
    ).toThrow(/durationInFrames/);
  });

  it('throws on invalid durations', () => {
    for (const bad of [0, -5, 2.5]) {
      expect(() =>
        render(
          0,
          <Series>
            <Series.Sequence durationInFrames={bad}>
              <Probe />
            </Series.Sequence>
          </Series>,
        ),
      ).toThrow(/positive whole number/);
    }
  });

  it('throws on children that are not <Series.Sequence>', () => {
    expect(() =>
      render(
        0,
        <Series>
          <Probe />
        </Series>,
      ),
    ).toThrow(/only accepts <Series.Sequence>/);
  });

  it('throws when <Series.Sequence> is used outside <Series>', () => {
    expect(() =>
      render(
        0,
        <div>
          <Series.Sequence>
            <Probe />
          </Series.Sequence>
        </div>,
      ),
    ).toThrow(/direct child of <Series>/);
  });

  it('re-bases offsets of a nested Series against the enclosing Sequence', () => {
    const timeline = (
      <Series>
        <Series.Sequence durationInFrames={20}>
          <Series>
            <Series.Sequence durationInFrames={10}>
              <Probe tag="inner-a" />
            </Series.Sequence>
            <Series.Sequence durationInFrames={10}>
              <Probe tag="inner-b" />
            </Series.Sequence>
          </Series>
        </Series.Sequence>
      </Series>
    );

    // Outer local frame 5 → inner clip A sees 5.
    render(5, timeline);
    expect(probe('inner-a')?.getAttribute('data-frame')).toBe('5');

    // Outer local frame 15 → inner clip B (which starts at inner frame 10).
    render(15, timeline);
    expect(probe('inner-a')).toBeNull();
    expect(probe('inner-b')?.getAttribute('data-frame')).toBe('5');
  });

  it('forwards layout="none" so children render without the fill wrapper', () => {
    render(
      0,
      <Series layout="none">
        <Series.Sequence durationInFrames={10}>
          <Probe />
        </Series.Sequence>
      </Series>,
    );
    expect(probe()?.parentElement).toBe(container);

    render(
      0,
      <Series layout="absolute-fill">
        <Series.Sequence durationInFrames={10}>
          <Probe />
        </Series.Sequence>
      </Series>,
    );
    expect(probe()?.parentElement?.tagName).toBe('DIV');
    expect(probe()?.parentElement?.style.position).toBe('absolute');
  });

  it('still clips like a Sequence: children unmount after the whole timeline', () => {
    // Sanity anchor: an explicit Sequence behaves identically to what Series builds.
    render(
      10,
      <Sequence from={0} durationInFrames={10}>
        <Probe tag="seq" />
      </Sequence>,
    );
    expect(probe('seq')).toBeNull();
  });
});
