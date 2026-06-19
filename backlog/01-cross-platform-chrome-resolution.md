# 01 — Make the renderer find Chrome on every OS (not just macOS)

## Problem

`scripts/render.mjs:23` hardcodes the macOS Chrome path:

```js
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
```

`puppeteer-core` does **not** ship a browser, so this single string is the only
thing telling it what to launch. On Linux (including this repo's WSL
environment) and Windows the path does not exist, so every `npm run render`,
`probeConfig`, and `renderChunk` call fails immediately with `spawn ... ENOENT`.

This breaks the project's headline feature — "a Puppeteer + ffmpeg renderer that
turns a composition into an `.mp4`" — for anyone not on a Mac. The README's
render examples cannot run as written on this machine.

## Goal

Resolve the Chrome/Chromium executable at runtime with this precedence:

1. `--chrome <path>` CLI flag (highest priority, for explicit override).
2. `PUPPETEER_EXECUTABLE_PATH` or `CHROME_PATH` environment variable.
3. A per-platform list of well-known install locations, returning the first that
   exists on disk:
   - **darwin**: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
     plus the Chromium and Chrome Canary equivalents.
   - **linux**: `google-chrome`, `google-chrome-stable`, `chromium`,
     `chromium-browser` resolved via `PATH` (use `which`/`node:child_process`),
     and `/usr/bin/...` fallbacks.
   - **win32**: `%ProgramFiles%`, `%ProgramFiles(x86)%`, and
     `%LocalAppData%\Google\Chrome\Application\chrome.exe`.

If nothing is found, exit with a clear, actionable error that names the env var
and the `--chrome` flag rather than a raw `ENOENT`.

## Implementation notes

- Add a `resolveChromePath()` helper near the top of `scripts/render.mjs` and
  replace the `CHROME` constant with its result. Both `puppeteer.launch` call
  sites (`probeConfig` line ~93 and `renderChunk` line ~107) already read the
  same constant, so one change covers both.
- Use `node:fs.existsSync` for absolute candidates and `command -v` / `which`
  (via the existing `spawn` helper or `node:child_process.execFileSync`) for
  bare command names on Linux.
- Keep `LAUNCH_ARGS` identical across the probe and all workers, as the comment
  at line 25 requires (determinism check).

## Acceptance criteria

- `npm run render -- --comp HelloWorld --out out/hello.mp4` produces an mp4 on
  Linux/WSL when Chrome or Chromium is installed.
- With no browser installed, the command fails with a message telling the user
  to install Chrome or set `CHROME_PATH` / pass `--chrome`.
- macOS behavior is unchanged (the existing path is still in the candidate list).
- Update `README.md` to mention `CHROME_PATH` / `--chrome` for non-default
  installs.
