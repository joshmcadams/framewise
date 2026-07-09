# Plan 007: Add ESLint (flat config) + Prettier, wire into verify and CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- package.json eslint.config.js .prettierrc.json .github`
> Plan 001 must have landed (`verify` script + CI exist). If `eslint.config.js`
> already exists, STOP (someone else did this).

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md
- **Category**: dx
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

This repo's code is teaching material — cleanliness is the product — yet there
is no linter or formatter at all: no ESLint, no Prettier, no `.editorconfig`.
There is even an orphaned `// eslint-disable-next-line no-console` directive at
`src/framewise-lite/delay-render.ts:50` that no tool reads, implying tooling
that doesn't exist. React-hooks linting matters specifically here: the codebase
uses deliberate no-deps layout effects (`Audio.tsx:38`, `Video.tsx:63`) that
future contributors could "fix" incorrectly — a configured linter with explicit
inline suppressions documents that they are intentional.

## Current state

- `package.json` devDependencies (post plan 001) contain no lint/format tools.
- Observed code style to encode, from reading the sources:
  - 2-space indent, semicolons, single quotes, trailing commas
  - `bracketSpacing: false` (`import {createServer} from 'vite'`)
  - line width ~90-100 (e.g. `spring.test.ts:38` is ~105 chars — set 100)
  - JSX uses double quotes for attributes (Prettier default)
- File inventory to lint: `src/**/*.{ts,tsx}`, `scripts/*.mjs`,
  `vite.config.ts`. Generated/vendored to ignore: `dist/`, `node_modules/`,
  `out/`, `plans/`, `docs/` (markdown), `backlog/`.
- The stale directive: `src/framewise-lite/delay-render.ts:50`:

  ```ts
      // eslint-disable-next-line no-console
      console.error(
  ```

  Decision (made for you): do NOT enable a global `no-console` rule —
  `scripts/render.mjs` logs by design and the library's loud
  `delayRender`-timeout error is intentional. Instead **remove the stale
  directive** and enable `reportUnusedDisableDirectives` so future stale
  directives fail loudly.
- CI (plan 001): `.github/workflows/ci.yml` runs `npm run verify`.

## Commands you will need

| Purpose   | Command                 | Expected on success |
|-----------|-------------------------|---------------------|
| Install   | `npm install -D <pkgs>` | exit 0              |
| Lint      | `npm run lint`          | exit 0, no errors   |
| Format check | `npm run format:check` | exit 0            |
| Full gate | `npm run verify`        | exit 0              |

## Scope

**In scope**:
- `eslint.config.js` (create), `.prettierrc.json` (create), `.prettierignore` (create)
- `package.json` (devDependencies + `lint`/`format`/`format:check` scripts; extend `verify`)
- `.github/workflows/ci.yml` (lint step — via the extended `verify`)
- `src/framewise-lite/delay-render.ts` (remove the one stale directive line)
- Mechanical, tool-generated changes from `prettier --write` and agreed lint
  fixes (see Step 4 rules)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- Any *behavioral* code change. Lint findings that need logic changes are
  reported, not fixed.
- Disabling `react-hooks/exhaustive-deps` globally — suppress per-site with a
  justifying comment instead (the no-deps effects are deliberate).

## Git workflow

- Branch: `advisor/007-eslint-prettier`
- Commit 1: tooling + config. Commit 2 (separate, mechanical): `prettier --write` output. Commit 3: lint suppressions/trivial fixes.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Install and configure

```bash
npm install -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks prettier
```

Create `eslint.config.js` (flat config, ESM — the package is `"type": "module"`):

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {ignores: ['dist/', 'out/', 'node_modules/', 'plans/', 'backlog/', 'docs/']},
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {'react-hooks': reactHooks},
    rules: {...reactHooks.configs.recommended.rules},
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {globals: {process: 'readonly', console: 'readonly', URL: 'readonly'}},
  },
  {linterOptions: {reportUnusedDisableDirectives: 'error'}},
);
```

Create `.prettierrc.json`:

```json
{
  "singleQuote": true,
  "bracketSpacing": false,
  "printWidth": 100,
  "trailingComma": "all"
}
```

Create `.prettierignore`: `dist`, `out`, `node_modules`, `package-lock.json`, `plans`, `backlog`.

Add scripts to `package.json`:

```json
"lint": "eslint .",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

and extend `verify` to `"tsc -b && eslint . && vitest run && vite build"`.

**Verify**: `npx eslint --version` → v9+; `npm run lint` runs (errors expected at this point — triaged next).

### Step 2: Remove the stale directive

Delete the `// eslint-disable-next-line no-console` line at
`src/framewise-lite/delay-render.ts:50` (keep the `console.error` itself and
the explanatory comment above it).

**Verify**: `grep -n "eslint-disable" src/framewise-lite/delay-render.ts` → no match.

### Step 3: Format (mechanical commit)

Run `npm run format`. Inspect the diff: it must be whitespace/quotes/commas
only. Commit it separately so reviewers can skip it.

**Verify**: `npm run format:check` → exit 0. `npm test` → all pass (formatting
cannot change behavior; this confirms it).

### Step 4: Triage lint findings

Run `npm run lint` and resolve per these rules:

- `react-hooks/exhaustive-deps` on the DELIBERATE no-deps effects
  (`Audio.tsx:38`, `Video.tsx:55` and `:63`, `Img` uses `[src]` and should be
  clean): add a line-scoped disable with the reason, e.g.
  `// eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: must re-run every commit (see comment above)`.
- `@typescript-eslint/no-explicit-any` on `src/render/registry.ts:16`
  (`ComponentType<any>` — heterogeneous composition props): line-scoped
  disable with reason, matching the audit's "justified `any`" verdict.
- Unused-var or trivially-safe findings: fix mechanically.
- ANY finding that would require restructuring logic: leave it, list it in
  your report, and if needed add a line-scoped disable marked `TODO`.

**Verify**: `npm run lint` → exit 0. `npm run verify` → exit 0.

## Test plan

No new tests. The gate is `npm run verify` green with the lint step included,
plus the existing 51+ tests unaffected by formatting.

## Done criteria

- [ ] `npm run lint` exits 0
- [ ] `npm run format:check` exits 0
- [ ] `npm run verify` (now including eslint) exits 0
- [ ] `grep -rn "eslint-disable" src/ | grep -v " -- "` → no undocumented suppressions (every disable carries a reason after ` -- `)
- [ ] CI workflow runs the lint (via `verify`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `eslint.config.js` already exists (drift).
- Lint triage would require changing runtime behavior anywhere.
- The Prettier diff includes anything other than formatting (inspect before
  committing).
- Peer-dependency conflicts on install (report versions; do not `--force`).

## Maintenance notes

- Plans executed after this one must pass `npm run lint`; their executors
  will match style automatically via Prettier.
- If plan 014 (React 19) lands later, `eslint-plugin-react-hooks` may warrant
  a version bump alongside it.
- Reviewers: the mechanical format commit should be reviewed with
  `git diff --ignore-all-space` (expect near-empty).
