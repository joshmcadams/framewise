// Shared between delay-render.ts (in-browser runtime) and scripts/render.mjs
// (Node renderer). Plain .mjs so both can import it: the renderer runs as a
// raw ESM Node script and cannot import TypeScript files.
//
// Ordering contract — the four timeout layers must stay in this order:
//   30 s  in-app delayRender timeout: per-handle labeled console.error
//   35 s  in-page waitForPendingEmpty deadline (DEFAULT + MARGIN): rejects
//         with the stuck handles named — but its setTimeout poll dies with a
//         wedged main thread, so it only covers cooperative hangs
//   40 s  renderer's Node-side race backstop (DEFAULT + 2×MARGIN): immune to
//         a wedged page; fails with `renderer backstop: frame N never
//         returned` instead of a generic puppeteer ProtocolError
//   45 s  protocolTimeout (backstop + 5 s): puppeteer's ceiling, kept above
//         ours so its generic error is never what decides
// render.mjs derives both upper layers from these constants — no literals.
export const DEFAULT_DELAY_RENDER_TIMEOUT = 30_000;
// How much longer the renderer waits beyond the in-app timeout.
export const RENDERER_TIMEOUT_MARGIN_MS = 5_000;
