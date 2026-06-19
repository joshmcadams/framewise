// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {
  continueRender,
  delayRender,
  getPendingDelayRenders,
  subscribeToDelayRenders,
  useDelayRenderPending,
} from './delay-render';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

// The pending registry is module-global. Each test clears whatever it created;
// this guard also drains anything a failing test might have leaked.
afterEach(() => {
  for (const {handle} of getPendingDelayRenders()) continueRender(handle);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('delayRender / continueRender', () => {
  it('tracks an outstanding handle with its label, then clears it', () => {
    expect(getPendingDelayRenders()).toHaveLength(0);

    const handle = delayRender('loading thing');
    const pending = getPendingDelayRenders();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({handle, label: 'loading thing'});

    continueRender(handle);
    expect(getPendingDelayRenders()).toHaveLength(0);
  });

  it('is idempotent: continueRender on an already-cleared handle is a no-op', () => {
    const handle = delayRender();
    continueRender(handle);
    expect(() => continueRender(handle)).not.toThrow();
    expect(getPendingDelayRenders()).toHaveLength(0);
  });

  it('notifies subscribers when the pending set changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToDelayRenders(listener);

    const handle = delayRender();
    expect(listener).toHaveBeenCalledTimes(1); // add
    continueRender(handle);
    expect(listener).toHaveBeenCalledTimes(2); // remove

    unsubscribe();
    delayRender(); // no longer subscribed
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('logs loudly if a handle is never cleared within the timeout', () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    delayRender('forgotten', {timeoutInMilliseconds: 100});
    expect(err).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0][0]).toMatch(/forgotten/);
    expect(err.mock.calls[0][0]).toMatch(/100ms/);
  });

  it('does not log when the handle is cleared before the timeout', () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handle = delayRender('quick', {timeoutInMilliseconds: 100});
    continueRender(handle);
    vi.advanceTimersByTime(200);
    expect(err).not.toHaveBeenCalled();
  });
});

describe('useDelayRenderPending', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('reflects the live pending count in a component', () => {
    const Probe = () => <span data-testid="count">{useDelayRenderPending()}</span>;
    act(() => root.render(<Probe />));
    const read = () => container.querySelector('[data-testid="count"]')?.textContent;

    expect(read()).toBe('0');

    let handle = 0;
    act(() => {
      handle = delayRender();
    });
    expect(read()).toBe('1');

    act(() => continueRender(handle));
    expect(read()).toBe('0');
  });
});
