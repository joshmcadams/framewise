// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ReactNode} from 'react';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {getPendingDelayRenders, continueRender} from './delay-render';
import {CompositionHost} from './CompositionHost';
import {Audio} from './Audio';
import {beginAudioFrame, readAudioFrame} from './audio-registry';
import {Sequence} from './Sequence';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  for (const {handle} of getPendingDelayRenders()) continueRender(handle);
  act(() => root.unmount());
  container.remove();
});

const renderAt = (frame: number, children: ReactNode) =>
  act(() => root.render(
    <CompositionHost config={{width: 100, height: 100, fps: 30, durationInFrames: 150}} frame={frame}>
      {children}
    </CompositionHost>,
  ));

describe('Audio', () => {
  it('in preview mode, reportAudio is a no-op because beginAudioFrame was never called', async () => {
    const pauseStub = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const playStub = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());

    act(() => root.render(
      <CompositionHost config={{width: 100, height: 100, fps: 30, durationInFrames: 150}} frame={0} playback={{playing: false}}>
        <Audio src="/bg.wav" />
      </CompositionHost>,
    ));

    expect(readAudioFrame()).toEqual([]);

    pauseStub.mockRestore();
    playStub.mockRestore();
  });

  it('in render mode, reports audio with the correct mediaTime at frame 30', async () => {
    beginAudioFrame();
    await renderAt(30, <Audio src="/bg.wav" volume={0.3} />);
    const reports = readAudioFrame();
    expect(reports).toHaveLength(1);
    expect(reports[0].src).toBe('/bg.wav');
    expect(reports[0].volume).toBe(0.3);
    expect(reports[0].mediaTime).toBeCloseTo(1.0, 5);
  });

  it('accounts for startFrom in mediaTime', async () => {
    beginAudioFrame();
    await renderAt(30, <Audio src="/bg.wav" startFrom={15} />);
    const reports = readAudioFrame();
    expect(reports).toHaveLength(1);
    expect(reports[0].mediaTime).toBeCloseTo(1.5, 5);
  });

  it('only reports when the Sequence window is active', async () => {
    beginAudioFrame();
    await renderAt(59, (
      <Sequence from={60} durationInFrames={15} layout="none">
        <Audio src="/bg.wav" />
      </Sequence>
    ));
    expect(readAudioFrame()).toHaveLength(0);

    beginAudioFrame();
    await renderAt(60, (
      <Sequence from={60} durationInFrames={15} layout="none">
        <Audio src="/bg.wav" />
      </Sequence>
    ));
    let reports = readAudioFrame();
    expect(reports).toHaveLength(1);
    expect(reports[0].mediaTime).toBeCloseTo(0.0, 5);

    beginAudioFrame();
    await renderAt(74, (
      <Sequence from={60} durationInFrames={15} layout="none">
        <Audio src="/bg.wav" />
      </Sequence>
    ));
    reports = readAudioFrame();
    expect(reports).toHaveLength(1);
    expect(reports[0].mediaTime).toBeCloseTo(14 / 30, 5);
  });

  it('known limitation: within-frame unmount leaves a stale report', async () => {
    beginAudioFrame();
    await renderAt(30, <Audio src="/bg.wav" />);
    expect(readAudioFrame()).toHaveLength(1);

    await renderAt(30, <span>no audio</span>);
    // Known limitation: within-frame unmount leaves a stale report.
    // Deliberate characterization — see plans/README.md rejected/deferred list.
    expect(readAudioFrame()).toHaveLength(1);
  });
});
