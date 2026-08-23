# 15 — The delayRender backstop is now entirely in-page

**Type:** Regression (diagnostics) · **Severity:** Medium
**Introduced by:** plan 024 (`40a8e38`)

## Problem

The perf refactor folded render → wait → read into one CDP round trip. The wait
moved from Node-side `page.waitForFunction(fn, {timeout: DELAY_RENDER_TIMEOUT})`
to an in-page promise (`main-render.tsx:125-141`) that enforces its own deadline
with `setTimeout(tick, 10)`.

If a composition wedges the browser's main thread — an infinite loop, a
synchronous freeze — that timer never fires. The `page.evaluate` then hangs until
puppeteer's default `protocolTimeout` (confirmed `180_000` ms at
`node_modules/puppeteer-core/lib/puppeteer/cdp/Connection.js:38`) and surfaces a
generic `ProtocolError` instead of the named
`delayRender timeout at frame N; pending: …`.

Before the refactor the 35 s deadline was enforced from Node and always produced
the labeled error. CLAUDE.md invariant #5 and
`delay-render-defaults.mjs:5-8` both describe this ordering as load-bearing:

> the renderer's backstop must fire AFTER the in-app labeled error

The in-app 30 s `console.error` still wins in the normal case (30 s < 35 s <
180 s); only the *wedged-page* case regressed, from a clear 35 s failure to a
silent 180 s hang.

## Fix

Restore a Node-side backstop without giving back the round trip — race the
evaluate against a Node timer:

```js
const result = await Promise.race([
  page.evaluate(…),
  new Promise((_, rej) =>
    setTimeout(() => rej(new Error(`renderer backstop: frame ${f} never returned`)),
               DELAY_RENDER_TIMEOUT + RENDERER_TIMEOUT_MARGIN_MS)),
]);
```

Set `protocolTimeout` explicitly at launch too, so the puppeteer default is never
the thing that decides.

## Acceptance

- A composition with a `while (true) {}` in a layout effect fails within ~40 s
  with a framewise-named error, not a 180 s `ProtocolError`.
- The ordering comment in `delay-render-defaults.mjs` is updated to describe the
  three-layer ordering (in-app 30 s → in-page 35 s → Node backstop).
