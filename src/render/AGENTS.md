# AGENTS.md — src/render/ (registry + page boot + probing)

Read root [`AGENTS.md`](../../AGENTS.md) first — canon lives there. This file
is only what this directory specifically requires.

## Adding or reordering compositions

`scripts/render-lib.test.mjs` pins the EXACT id list and order via
`parseRegistryIds(registry.ts)` (it reads the source statically so `--list`
works even bare). A new composition means updating registry.ts AND that test
in the same commit — the failing test is the reminder, don't weaken it.

## The page-boot contract (main-render.tsx)

The renderer waits on exactly one thing: `window.framewiseLite.config ||
configError`. Everything else follows:

- Resolve metadata BEFORE publishing anything. Until then neither field is set
  and the 60 s ready-wait in `render.mjs openWorker` is covering you.
- A rejecting `calculateMetadata` publishes `configError` fast and named.
- A HUNG hook is bounded by `orTimeout(…, CALCULATE_METADATA_TIMEOUT_MS)`
  whose deadline MUST stay below the ready-wait, so failures are named before
  generic ("calculateMetadata did not settle", not "page never became
  ready"). Same ordering contract as invariant 5's delayRender ladder.
- Publish the API even on failure — `readConfigFromPage` turns configError
  into an immediate thrown error instead of a timeout.

`resolveCompositionConfig` is ASYNC (plan 040); both callers await it. New
callers must too — preview resolves inside a cancellable effect, never during
render.

## probe-media.ts

Reads duration via a detached `<video>` element; works on both paths because
dev AND the render page serve `public/` statically. Unit tests can NEVER run
it for real (jsdom loads no media) — `vi.mock('./probe-media')` at module
level; prove real files live with an actual render.

## Demo metadata trick

When a hook derives metadata (MediaSized), make the STATIC value deliberately
wrong so a correct output proves the hook ran; a silent fallback announces
itself in output length. Comment the wrongness inline so nobody "fixes" it.
