// Shared between delay-render.ts (in-browser runtime) and scripts/render.mjs
// (Node renderer). Plain .mjs so both can import it: the renderer runs as a
// raw ESM Node script and cannot import TypeScript files.
//
// Ordering contract: the renderer's waitForFunction timeout must fire AFTER the
// in-app delayRender timeout so the per-handle console.error (which names the
// stuck handle's label) reaches the user before Puppeteer throws a generic
// TimeoutError. render.mjs adds RENDERER_TIMEOUT_MARGIN_MS to guarantee this.
export const DEFAULT_DELAY_RENDER_TIMEOUT = 30_000;
// How much longer the renderer waits beyond the in-app timeout.
export const RENDERER_TIMEOUT_MARGIN_MS = 5_000;
