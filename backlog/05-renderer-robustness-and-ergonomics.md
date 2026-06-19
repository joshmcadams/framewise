# 05 — Renderer: preflight checks, configurable output, and asset-path resolution

## Problem

`scripts/render.mjs` works for the demo's happy path but is brittle and
inflexible in ways that bite real use:

1. **No preflight for `ffmpeg`.** If ffmpeg isn't on `PATH`, the failure surfaces
   only at the final stitch step (`run('ffmpeg', ...)`, line ~210/230) after
   minutes of rendering, as a raw spawn error. Same for a missing Chrome (see
   backlog 01).
2. **Hardcoded encode settings.** `libx264 / yuv420p` and `aac / 192k` are
   baked in (lines 210, 230-237). There's no way to set CRF/quality, change the
   codec, or pick a container without editing the script.
3. **Asset paths assume `public/`.** Audio inputs are resolved as
   `join('public', seg.src.replace(/^\//,''))` (line 215). Any composition that
   references an asset by a different URL, or run from a different cwd, breaks.
   There is no `staticFile()`-style indirection (see backlog 09 for the helper).
4. **No props passthrough.** `defaultProps` from the registry are the only inputs
   a rendered comp can get; you can't parametrize a render from the CLI the way
   real Framewise takes `--props`.

## Goal

- **Preflight.** Before launching browsers, verify `ffmpeg -version` succeeds and
  the resolved Chrome path exists; fail fast with an actionable message.
- **Configurable output.** Add flags with sensible defaults:
  - `--crf <n>` (default 18) → `-crf`,
  - `--codec <libx264|libx265|...>` (default libx264),
  - `--audio-bitrate <k>` (default 192k).
  Keep `-pix_fmt yuv420p` for broad player compatibility unless overridden.
- **Asset resolution.** Centralize the `src` → filesystem-path mapping in one
  function (default `public/`), and make the base dir overridable with
  `--public-dir <path>`. Reuse it everywhere a `seg.src` becomes an ffmpeg input.
- **Props passthrough.** Accept `--props '<json>'`, parse it, and merge over the
  composition's `defaultProps` before injecting into `window.framewiseLite`.
  (Requires `main-render.tsx` to read an injected props blob rather than only
  `comp.defaultProps`.)

## Implementation notes

- The arg parser (`flag()`, lines 31-34) only supports `--name value`; extend it
  or add a small typed-flag layer. Watch the existing edge case: `flag` returns
  the fallback when the value is falsy/missing.
- Keep the determinism guarantees intact — encode flags must be identical across
  all workers (they already share `LAUNCH_ARGS`), and the frame-count + sha256
  integrity check (lines 185-191) should stay.

## Acceptance criteria

- Running with ffmpeg missing prints a clear "install ffmpeg" error before any
  rendering work begins.
- `--crf 28 --codec libx265` changes the encode; default behavior is unchanged.
- `--props '{"title":"Hi"}'` overrides `HelloWorld`'s title in the output.
- Asset base dir is set in exactly one place and overridable.
