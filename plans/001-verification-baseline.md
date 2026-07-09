# Plan 001: Establish a verification baseline — typecheck script, verify script, CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- package.json tsconfig.json .github`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests / dx
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

There is no single command, and nothing automated, that proves this repo is
green. Typechecking only happens as a side effect of `npm run build`, so a type
error passes `npm test` silently; no CI runs anything on push. Every other plan
in `plans/` assumes a working verification gate — this plan is the
prerequisite for all of them.

## Current state

- `package.json:7-14` — scripts today:

  ```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "render": "node scripts/render.mjs"
  }
  ```

  There is no `typecheck` script, no `verify` script, and no `engines` field —
  even though `scripts/render.mjs` uses top-level `await` (lines 85, 293) and
  modern `node:fs/promises` APIs.

- `tsconfig.json:20` — includes a file that does not exist (the Vitest config
  lives inside `vite.config.ts`):

  ```json
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
  ```

- No `.github/` directory exists — no CI of any kind.
- Baseline test result: `npm test` → 8 files, 51 tests, all passing, ~1.5s.
- `*.tsbuildinfo` is already gitignored, so `tsc -b` output stays untracked.
- The `render` script needs system Chrome + ffmpeg — CI must NOT run it.

## Commands you will need

| Purpose   | Command          | Expected on success |
|-----------|------------------|---------------------|
| Install   | `npm install`    | exit 0              |
| Tests     | `npm test`       | 51 tests pass (8 files) |
| Build     | `npm run build`  | exit 0, writes `dist/` |

## Scope

**In scope** (the only files you should modify/create):
- `package.json`
- `tsconfig.json`
- `.github/workflows/ci.yml` (create)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- Any file under `src/` or `scripts/` — this plan adds gates, not code changes.
- `README.md` — other plans handle docs; do not add a CI badge unless asked.

## Git workflow

- Branch: `advisor/001-verification-baseline`
- Commit style: short imperative summary, matching the repo (e.g. `Add
  typecheck/verify scripts, engines field, and CI workflow`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `typecheck`, `verify`, and `engines` to package.json

In `package.json`, add to `scripts`:

```json
"typecheck": "tsc -b",
"verify": "tsc -b && vitest run && vite build"
```

and add a top-level field (after `"type": "module"`):

```json
"engines": { "node": ">=20" }
```

**Verify**: `npm run typecheck` → exit 0, no output errors.
**Verify**: `npm run verify` → exit 0; output shows 51 tests passing then a vite build summary.

### Step 2: Fix the stale tsconfig include

In `tsconfig.json`, change the include array to:

```json
"include": ["src", "vite.config.ts"]
```

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Create the CI workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20.x, 22.x]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm run verify
```

Do not add a render job — rendering needs Chrome + ffmpeg and is out of scope.

**Verify**: `npx --yes yaml-lint .github/workflows/ci.yml 2>/dev/null || node -e "const fs=require('fs');const y=fs.readFileSync('.github/workflows/ci.yml','utf8');console.log(y.includes('npm run verify')?'ok':'missing verify')"` → prints `ok` (or the YAML linter exits 0). If neither tool is available, visually confirm the file matches the block above.

## Test plan

No new unit tests — this plan creates the harness that runs the existing 51.
The machine check is that `npm run verify` is a single green command.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run verify` exits 0 (51 tests pass, build succeeds)
- [ ] `tsconfig.json` no longer references `vitest.config.ts`
- [ ] `.github/workflows/ci.yml` exists and invokes `npm run verify`
- [ ] `package.json` has an `engines.node` field
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `npm run typecheck` fails on the *unmodified* codebase (the baseline has
  drifted — fixing type errors is not this plan's job).
- `npm test` does not report exactly 51 passing tests before your changes.
- Removing `vitest.config.ts` from the include array causes a typecheck error
  (it should be inert; if not, something else references it).

## Maintenance notes

- Plans 002, 004, 007, 012, 013, 016 all cite `npm run verify` as their gate;
  if you rename the script, update them.
- Plan 007 (ESLint/Prettier) will extend `verify` and the CI workflow with a
  lint step — reviewers should expect that follow-up.
- The CI matrix pins the supported-Node statement made by `engines`; keep them
  in sync.
