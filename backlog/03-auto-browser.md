# 03 — Auto-managed browser download

**Status:** ready
**Effort:** S · **Depends on:** nothing
**Unblocks:** setup-free installs; CI render smoke (17); item 15 (agents on
fresh machines)

## Audit verdict

Correct and well-scoped. Two additions the first draft missed, one of which
matters a lot for this repo specifically:

1. **Pinning the browser build is load-bearing for invariant 1, not just for
   reproducible installs.** Text rasterization and image decoding differ between
   Chrome builds, so the frame-set sha256 is only comparable _within one browser
   build_. Today that is invisible because everyone uses whatever Chrome they
   have; the moment we download a pinned build, the pin becomes part of the
   determinism contract and must be documented and single-sourced.
2. **`chrome-headless-shell` and `chrome --headless` are different renderers.**
   Puppeteer 25's `headless: true` (`render.mjs:323`) is _new_ headless — real
   Chrome. `chrome-headless-shell` is the old shell. They do not produce
   identical pixels. Choose one deliberately (recommendation below) rather than
   letting the download and the launch disagree.

## Why this is worth building

The renderer requires a system Chrome and auto-detects well-known paths
(`render.mjs:190-244`) — and on the primary dev machine the system Chrome hangs
headless, forcing every contributor to know about `CHROME_PATH` + Chrome for
Testing (root `AGENTS.md`, "Environment quirks"). That is the #1 first-run
failure mode and it is documented as a _workaround_, which is a smell. Remotion
solved this by downloading a pinned browser; so should we.

## Design

### Recommendation: download `chrome` (Chrome for Testing), not `chrome-headless-shell`

Rationale: it is what this machine's working setup already uses, so the pin
inherits a known-good configuration; new headless is what
`puppeteer.launch({headless: true})` drives today, so nothing about the launch
path changes; and item 13 (alpha capture via `omitBackground`) and item 05
(`deviceScaleFactor`) are better-tested paths there. The cost is disk size
(~150 MB vs ~80 MB). If the executor disagrees, that is a STOP item below.

### Pin location

A single exported constant, next to the other single-sourced constants:

```js
// scripts/browser.mjs
export const PINNED_CHROME = {
  browser: 'chrome',
  buildId: '<exact build, e.g. 151.0.7922.34>',
};
```

Cache layout keyed by build id so two pins can coexist:

- macOS/Linux: `~/.cache/framewise-lite/browser/<buildId>/`
- Windows: `%LOCALAPPDATA%/framewise-lite/browser/<buildId>/`

### Resolution order (backward compatible — this is the contract)

1. explicit `--chrome <path>`
2. `$CHROME_PATH` / `$PUPPETEER_EXECUTABLE_PATH`
3. previously-downloaded cache, **exact build-id match**
4. OS auto-detect — today's behavior (`render.mjs:210-235`), kept as a fallback
5. download on demand, printing one line: build id + destination + size

Branch 4 staying _before_ 5 is deliberate: a machine with a working Chrome
should not silently spend 150 MB on first render. Branch 4 staying _at all_ is
also deliberate: it is the escape hatch for air-gapped machines that already have
a browser.

### New flags / env

- `--browser-cache <dir>` and `FRAMEWISE_BROWSER_CACHE`
- `FRAMEWISE_SKIP_BROWSER_DOWNLOAD=1` — skip step 5; if 1–4 all miss, fail with
  today's actionable message (`render.mjs:237-241`) plus a line saying the
  download was skipped by env
- honor `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`; on failure the error names the
  URL that could not be reached

### Where it plugs in

`resolveChromePath()` (`render.mjs:190-244`) becomes async and moves to
**new** `scripts/browser.mjs`, with the pure ordering logic testable via injected
`{existsSync, env, platform, cacheDir}`. `render.mjs:244`'s module-scope call
becomes an awaited call inside `main()` (see item 00bb — if 00b has landed, this is
a one-line change; if not, it is a small local restructure). Add
`@puppeteer/browsers` to `devDependencies` — **not** `dependencies`: the
published library (`package.json` `files: ["dist-lib"]`) must not pull a browser
installer.

## STOP — decisions the executor must not make alone

1. **Which browser and which build id.** Changing the pin changes every
   frame-set hash on every machine. Propose it, record the reasoning, get
   agreement, and put the decision in the chapter — not just in a constant.
2. **Do not remove the OS auto-detect fallback.** It looks redundant once the
   download works; it is the offline path.
3. **Do not download from a test.** Unit tests inject a fake installer. Exactly
   one manual/CI step exercises a real download.

## Risks

- **Download size + first-run surprise.** Print progress; one line, not a
  spinner (non-TTY safety — item 04's rule applies here too).
- **Version drift between cache entries.** Key by exact build id. Prune older
  build dirs only after a _successful_ render on the new one, and only ones this
  tool created.
- **Concurrent first runs** (two renders start on a cold cache): download into a
  temp dir and atomically rename, so a half-downloaded browser is never
  resolvable. Two racing installs must not corrupt each other.
- **Determinism ripple.** After this lands, the frame-set hash is a function of
  (composition, props, capture settings, **browser build**). Say so in chapter 7
  and in `backlog/README.md`'s invariant 1 note.

## Verification

- **Unit, all five branches**, with injected fs/env — including: cache hit with
  a _different_ build id must fall through, not use the stale browser
- **Fresh-cache integration (manual/CI):** empty cache + `CHROME_PATH` unset +
  auto-detect stubbed → downloads, renders HelloWorld; second run prints a cache
  hit and does not download. Record both wall times in the PR.
- **Crossing:** downloaded browser × `--concurrency 4` × `--distributed` — every
  worker must resolve the _same_ executable path (assert it, since each worker
  calls `launch` independently, `render.mjs:318-329`)
- `FRAMEWISE_SKIP_BROWSER_DOWNLOAD=1` on a cold cache with no system Chrome →
  the named, actionable failure, not a stack trace
- **The determinism claim itself:** render HelloWorld with the downloaded build
  and with this machine's Chrome for Testing at the same version; if the hashes
  differ, that is the finding, and it belongs in the chapter.

**Does not cover:** nothing here proves the pinned build renders _identically to
whatever the reader has installed_ — that is precisely why the pin is documented
as part of the determinism contract instead of assumed.

## Docs

Chapter 7 gains "Which browser renders your video" — the resolution order, the
cache location, the skip env, and the honest statement that the hash gate is
per-browser-build. README install section loses the `CHROME_PATH` prerequisite
for the default path (keep it documented as an override). Root `AGENTS.md`'s
"Environment quirks" entry gets updated to say the workaround is now the
fallback, not the requirement.

## Definition of done

- [ ] `scripts/browser.mjs` with the pin as a single exported constant
- [ ] all five resolution branches unit-tested with injected fs/env
- [ ] cold-cache download → render → warm-cache skip demonstrated, times in PR
- [ ] `--distributed -c 4` asserts one shared executable path
- [ ] `@puppeteer/browsers` in devDependencies only; `npm pack --dry-run` file
      list unchanged
- [ ] chapter 7 + README + root `AGENTS.md` updated; determinism scope stated
