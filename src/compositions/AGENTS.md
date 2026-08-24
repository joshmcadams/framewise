# AGENTS.md — src/compositions/ (demo compositions)

Read root [`AGENTS.md`](../../AGENTS.md) first. Demos here are not sample
code — they are the documentation's executable half, which raises the bar.

## A demo ships in five places, same commit

1. The component file (this directory).
2. `src/render/registry.ts` entry (id, statics, defaultProps, optional
   calculateMetadata) — plus the pinned id list in
   `scripts/render-lib.test.mjs`.
3. `docs/code/README.md` source map + demo table.
4. `docs/OVERVIEW.md` tree/demo rows.
5. A chapter mention where the feature it demonstrates lives.

`npm run render -- --list` must show it; render it end-to-end before
flipping any plan row.

## Editing an existing demo can break pinned hashes

Determinism claims cite HelloWorld's frame-set sha256 (invariant 3, ch. 7,
ch. 11, several plans). Change HelloWorld's pixels and every citation goes
stale — either don't touch its visuals, or re-render at all concurrencies and
update every cited value in the same commit.

## Statics vs derived metadata

Statics (`width/height/fps/durationInFrames`) are what renders before
calculateMetadata lands — keep them valid so preview never breaks. When a
hook derives a value, consider making the static DELIBERATELY wrong (see
MediaSized; rationale in `../render/AGENTS.md`).

## Prop validation

Validate in `calculateMetadata` by throwing a named error early — it surfaces
on the render page and in the preview props editor. Never validate inside the
component: by then the frame loop is already running.
