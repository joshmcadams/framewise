import {useSyncExternalStore} from 'react';

// delayRender / continueRender — the mechanism that makes asynchronous work
// BLOCK the render. A composition that needs to load something (an image, a
// font, data) calls delayRender() to say "don't capture this frame yet," does
// the async work, then calls continueRender(handle) when ready. The renderer
// waits until every outstanding handle is cleared before screenshotting.
//
// This one idea is what separates a toy screenshotter (Stage 2) from a real
// renderer: it turns "capture immediately, hope it's loaded" into "capture only
// when the frame is provably settled."

export type DelayRenderHandle = number;

type PendingEntry = {
  label: string;
  timeout: ReturnType<typeof setTimeout>;
};

const pending = new Map<DelayRenderHandle, PendingEntry>();
const listeners = new Set<() => void>();
let nextHandle = 1;

const notify = () => {
  for (const l of listeners) l();
};

/** Real Framewise defaults to 30s, after which the render fails. */
export const DEFAULT_DELAY_RENDER_TIMEOUT = 30_000;

/**
 * Block the render until the returned handle is passed to continueRender().
 * Returns a numeric handle. Starts a timeout so a forgotten continueRender()
 * surfaces loudly instead of hanging forever.
 */
export function delayRender(
  label = 'delayRender()',
  options?: {timeoutInMilliseconds?: number},
): DelayRenderHandle {
  const handle = nextHandle++;
  const timeoutMs =
    options?.timeoutInMilliseconds ?? DEFAULT_DELAY_RENDER_TIMEOUT;

  const timeout = setTimeout(() => {
    // In real Framewise this throws and fails the render. We log loudly; the
    // renderer's own waitForFunction timeout is the hard backstop.
    // eslint-disable-next-line no-console
    console.error(
      `delayRender(): handle ${handle} ("${label}") was not cleared within ${timeoutMs}ms`,
    );
  }, timeoutMs);

  pending.set(handle, {label, timeout});
  notify();
  return handle;
}

/** Clear a handle created by delayRender(). Idempotent. */
export function continueRender(handle: DelayRenderHandle): void {
  const entry = pending.get(handle);
  if (!entry) {
    return;
  }
  clearTimeout(entry.timeout);
  pending.delete(handle);
  notify();
}

/** The labels of all outstanding handles — read by the renderer each frame. */
export function getPendingDelayRenders(): {handle: DelayRenderHandle; label: string}[] {
  return [...pending.entries()].map(([handle, {label}]) => ({handle, label}));
}

/** Subscribe to changes in the pending set (used by the Player's loading badge). */
export function subscribeToDelayRenders(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** How many handles are currently outstanding. */
export function useDelayRenderPending(): number {
  return useSyncExternalStore(
    subscribeToDelayRenders,
    () => pending.size,
    () => 0,
  );
}
