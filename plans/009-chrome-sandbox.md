# Plan 009: Stop passing --no-sandbox to Chrome unconditionally

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff 985ca38..HEAD -- scripts/render.mjs | head -50`
> Plan 003 is expected to have landed (cleanup()/strict flags). Locate the
> LAUNCH_ARGS line in the live file; if the sandbox flag is already
> conditional, STOP (done elsewhere).

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW–MED (environment-dependent; mitigated by explicit fallback message)
- **Depends on**: plans/003-renderer-robustness.md (same-file churn; land 003 first)
- **Category**: security
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

Every render launches headless Chrome with `--no-sandbox` on every platform,
disabling Chrome's OS-level sandbox even where it works fine. Compositions can
load arbitrary remote URLs through `<Img>`/`<Video>` `src`, so rendered content
runs with no containment layer. The flag is genuinely needed only where the
sandbox cannot start (typically running as root or in containers without user
namespaces) — it should be an explicit opt-in or an automatic, *loudly logged*
fallback, not a silent default.

## Current state

- `scripts/render.mjs:34-36`:

  ```js
  // Identical for every browser (workers AND the config probe), so that a
  // sequential-vs-parallel determinism check can't differ for flag reasons.
  const LAUNCH_ARGS = ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'];
  ```

  Used at both launch sites: the config probe (`puppeteer.launch` inside
  `probeConfig`) and each chunk worker (`puppeteer.launch` inside
  `renderChunk`). The "identical for every browser" property must be
  preserved — compute the args ONCE.
- After plan 003, flags are parsed strictly via `readFlag`; boolean flags use
  `args.includes('--flag')` (see `--no-wait` at line 51).
- The dev machine for this repo is WSL2 (Linux); modern WSL2 kernels support
  user namespaces, so Chrome's sandbox normally works there — the default
  (sandboxed) path is locally testable.

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Tests     | `npm test` | all pass |
| Full gate | `npm run verify` | exit 0 |
| Sandboxed render (needs Chrome+ffmpeg) | `npm run render -- --comp HelloWorld --out out/p009.mp4` | completes without `--no-sandbox` |
| Opt-in    | `npm run render -- --comp HelloWorld --no-sandbox --out out/p009b.mp4` | completes; log line notes sandbox disabled |

## Scope

**In scope**:
- `scripts/render.mjs` (LAUNCH_ARGS computation + usage note in the flags
  header comment, lines 9-22)
- `README.md` (the render-prerequisites blockquote around lines 42-48: one
  sentence documenting `--no-sandbox` for root/container environments)
- `plans/README.md` (status row)

**Out of scope**:
- `--hide-scrollbars` / `--force-color-profile=srgb` (determinism flags — keep).
- Any auto-detection heavier than the root check below (no container
  sniffing via /proc — keep it simple and explicit).
- `scripts/render-lib.mjs` (no pure logic here worth extracting).

## Git workflow

- Branch: `advisor/009-chrome-sandbox`
- One commit: `Gate --no-sandbox behind an explicit flag or root fallback`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Compute launch args once, conditionally

Replace the constant:

```js
// Sandbox policy: keep Chrome's OS sandbox ON by default. It only has to be
// disabled where it cannot start — running as root (common in containers/CI).
// Explicit --no-sandbox opts out; running as root falls back with a warning.
// Args stay identical for every browser (workers AND the config probe), so a
// sequential-vs-parallel determinism check can't differ for flag reasons.
const disableSandbox =
  args.includes('--no-sandbox') ||
  (typeof process.getuid === 'function' && process.getuid() === 0);
if (disableSandbox) {
  console.warn('⚠ launching Chrome with --no-sandbox (explicit flag or running as root)');
}
const LAUNCH_ARGS = [
  ...(disableSandbox ? ['--no-sandbox'] : []),
  '--hide-scrollbars',
  '--force-color-profile=srgb',
];
```

Add `--no-sandbox` to the usage header comment (lines 9-22) with one line:
`// --no-sandbox      disable Chrome's sandbox (only for root/containers where it cannot start).`

**Verify**: `node --check scripts/render.mjs` → exit 0.

### Step 2: Improve the launch-failure message

Wrap ONLY the first browser launch (the config probe is the first launch a
render performs) so a sandbox-startup failure is actionable: catch the error
from `puppeteer.launch` in `probeConfig`, and if `disableSandbox` is false,
rethrow as:

```js
throw new Error(
  `Chrome failed to launch: ${e.message}\n` +
  `If you are in a container or otherwise cannot use Chrome's sandbox, retry with --no-sandbox.`,
);
```

(Do not blanket-catch worker launches — if the probe launched, workers will.)

**Verify**: `npm run verify` → exit 0.

### Step 3: Document and end-to-end check

Add one sentence to the README render-prerequisites blockquote: sandbox is on
by default; pass `--no-sandbox` in root/container environments.

**Verify** (needs Chrome+ffmpeg): the two render commands from the table —
default run completes WITHOUT the flag (confirm no `--no-sandbox` warning in
output), opt-in run completes WITH the warning line. If your environment
cannot launch sandboxed Chrome, that IS the fallback scenario: confirm the
Step 2 message appears, then report — do not silently revert the default.

## Test plan

No unit tests (the change is launch wiring). The end-to-end matrix in Step 3
is the gate; the `node --check` + `verify` runs guard syntax/types.

## Done criteria

- [ ] `grep -n "no-sandbox" scripts/render.mjs` → conditional construction only, no unconditional literal in LAUNCH_ARGS
- [ ] Warning line printed when (and only when) sandbox is disabled
- [ ] README documents the flag
- [ ] `npm run verify` exits 0
- [ ] Only `scripts/render.mjs`, `README.md`, `plans/README.md` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- A default (sandboxed) render fails on the WSL2 dev machine — the premise
  that the sandbox works locally is wrong; report the exact Chrome error.
- Plan 003 has not landed and this plan's edits collide with its restructuring.

## Maintenance notes

- If CI ever gains a render job (it runs as root in most containers), it will
  hit the root fallback — the warning line is the breadcrumb.
- Reviewers: confirm LAUNCH_ARGS is still computed once and shared by probe
  and workers (determinism property).
