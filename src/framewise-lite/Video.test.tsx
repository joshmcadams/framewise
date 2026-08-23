// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ReactNode} from 'react';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {getPendingDelayRenders, continueRender} from './delay-render';
import {CompositionHost} from './CompositionHost';
import {Video} from './Video';
import {beginAudioFrame, readAudioFrame} from './audio-registry';

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
  act(() =>
    root.render(
      <CompositionHost
        config={{width: 100, height: 100, fps: 30, durationInFrames: 150}}
        frame={frame}
      >
        {children}
      </CompositionHost>,
    ),
  );

const pauseStub = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
const playStub = vi
  .spyOn(HTMLMediaElement.prototype, 'play')
  .mockImplementation(() => Promise.resolve());

describe('Video', () => {
  afterAll(() => {
    pauseStub.mockRestore();
    playStub.mockRestore();
  });

  it('registers a pending seek handle on mount', async () => {
    await renderAt(30, <Video src="/clip.mp4" />);
    const pending = getPendingDelayRenders();
    expect(pending).toHaveLength(1);
    expect(pending[0].label).toContain('<Video> seek /clip.mp4');
  });

  it('drives the full seek lifecycle: loadedmetadata → seek → seeked', async () => {
    await renderAt(30, <Video src="/clip.mp4" />);
    expect(getPendingDelayRenders()).toHaveLength(1);

    const el = container.querySelector('video')!;
    Object.defineProperty(el, 'readyState', {value: 1, configurable: true});
    await act(() => el.dispatchEvent(new Event('loadedmetadata')));

    const expectedSeekTarget = (30 + 0) / 30 + 0.5 / 30;
    expect(el.currentTime).toBeCloseTo(expectedSeekTarget, 5);

    await act(() => el.dispatchEvent(new Event('seeked')));
    expect(getPendingDelayRenders()).toHaveLength(0);
  });

  it('clears the pending handle on unmount while seeking', async () => {
    await renderAt(30, <Video src="/clip.mp4" />);
    expect(getPendingDelayRenders()).toHaveLength(1);

    await act(() => root.unmount());
    expect(getPendingDelayRenders()).toHaveLength(0);
  });

  it('reports unmuted audio; does not report muted audio', async () => {
    beginAudioFrame();
    await renderAt(30, <Video src="/clip.mp4" />);
    let reports = readAudioFrame();
    expect(reports).toHaveLength(1);
    expect(reports[0].mediaTime).toBeCloseTo(1.0, 5);

    beginAudioFrame();
    await renderAt(30, <Video src="/clip.mp4" muted />);
    reports = readAudioFrame();
    expect(reports).toHaveLength(0);
  });

  it('same-frame recommit mid-seek keeps the pending handle (plan-005 fix)', async () => {
    const fps = 30;

    await renderAt(30, <Video src="/clip.mp4" />);
    const el = container.querySelector('video')!;

    Object.defineProperty(el, 'readyState', {value: 1, configurable: true});
    await act(() => el.dispatchEvent(new Event('loadedmetadata')));
    await act(() => el.dispatchEvent(new Event('seeked')));
    expect(getPendingDelayRenders()).toHaveLength(0);

    await renderAt(31, <Video src="/clip.mp4" />);
    expect(getPendingDelayRenders()).toHaveLength(1);
    const expectedSeekTarget31 = (31 + 0) / fps + 0.5 / fps;
    expect(el.currentTime).toBeCloseTo(expectedSeekTarget31, 5);

    Object.defineProperty(el, 'readyState', {value: 2, configurable: true});

    await renderAt(31, <Video src="/clip.mp4" />);
    // Plan 005: the same-frame recommit no longer clears the handle mid-seek.
    expect(getPendingDelayRenders()).toHaveLength(1);

    await act(() => el.dispatchEvent(new Event('seeked')));
    expect(getPendingDelayRenders()).toHaveLength(0);
  });

  it('target change mid-seek resolves the old handle and registers a new one', async () => {
    await renderAt(30, <Video src="/clip.mp4" />);
    const el = container.querySelector('video')!;

    Object.defineProperty(el, 'readyState', {value: 1, configurable: true});
    await act(() => el.dispatchEvent(new Event('loadedmetadata')));
    expect(getPendingDelayRenders()).toHaveLength(1);
    const handle30 = getPendingDelayRenders()[0].handle;

    await renderAt(31, <Video src="/clip.mp4" />);
    const pending = getPendingDelayRenders();
    expect(pending).toHaveLength(1);
    expect(pending[0].handle).not.toBe(handle30);

    await act(() => el.dispatchEvent(new Event('seeked')));
    expect(getPendingDelayRenders()).toHaveLength(0);
  });

  it('parked bail requires a completed seek, not just currentTime equality', async () => {
    await renderAt(30, <Video src="/clip.mp4" />);
    const el = container.querySelector('video')!;

    Object.defineProperty(el, 'readyState', {value: 1, configurable: true});
    await act(() => el.dispatchEvent(new Event('loadedmetadata')));
    await act(() => el.dispatchEvent(new Event('seeked')));
    expect(getPendingDelayRenders()).toHaveLength(0);

    Object.defineProperty(el, 'readyState', {value: 2, configurable: true});

    await renderAt(30, <Video src="/clip.mp4" />);
    expect(getPendingDelayRenders()).toHaveLength(0);

    await renderAt(31, <Video src="/clip.mp4" />);
    expect(getPendingDelayRenders()).toHaveLength(1);

    await act(() => el.dispatchEvent(new Event('seeked')));
    expect(getPendingDelayRenders()).toHaveLength(0);
  });

  it('unmount mid-seek resolves the pending handle via the unmount-only effect', async () => {
    await renderAt(30, <Video src="/clip.mp4" />);
    const el = container.querySelector('video')!;

    Object.defineProperty(el, 'readyState', {value: 1, configurable: true});
    await act(() => el.dispatchEvent(new Event('loadedmetadata')));
    expect(getPendingDelayRenders()).toHaveLength(1);

    await act(() => root.unmount());
    expect(getPendingDelayRenders()).toHaveLength(0);
  });

  it('reports a volume callback evaluated at the current frame', async () => {
    beginAudioFrame();
    await renderAt(30, <Video src="/clip.mp4" volume={(f) => 1 - f / 60} />);
    const reports = readAudioFrame();
    expect(reports).toHaveLength(1);
    expect(reports[0].volume).toBeCloseTo(0.5, 5);
  });
});
