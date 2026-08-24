# 12 — Batch rendering (`--props-file`)

**Status:** ready **after 00b**
**Effort:** M after 00b · **would be L and fragile before it**
**Depends on:** **00b** (callable pipeline), 04 (structured summaries)
**Unblocks:** personalization at scale — Revideo's core value proposition

## Audit verdict

The value is real and the design is mostly right. One line hides the entire
difficulty:

> "Rows run sequentially through ONE warm browser pool + vite server… (the big
> win vs process-per-row)"

That is only possible if the renderer is a function. It is not — see item 00bb's
table. Without 00 this item degrades into `spawn('node', ['render.mjs', …])`
per row, which _is_ process-per-row, which is the exact cost this item exists to
remove. **Do not start 12 before 00b.**

Two further corrections:

- **"Row with invalid props fails named, others still render" needs the failure
  to be isolated at the right level.** Today a failed chunk fails the whole run
  (`render.mjs:622-628`), and cleanup is global (`:496-517`). Per-row isolation
  means each row gets its own frames dir and its own browsers, with a
  catch-record-continue wrapper — which is exactly the "safe to call twice"
  contract item 00b already has to provide.
- **CSV "all values are strings" collides with `calculateMetadata`.**
  `Countdown` does `Number(props.seconds)` and demands an integer
  (`registry.ts:122-128`), so `"5"` works there by luck. `MediaSized` does
  `String(props.src)`, also fine. But a boolean column would arrive as `"true"`
  and silently become truthy everywhere. Decide the policy explicitly (below).

## Design

```bash
npm run render -- --comp Promo --props-file rows.csv \
  --out 'out/promo-{slug}.mp4' --concurrency 4
```

### Input

- `--props-file rows.jsonl` — one JSON object per line. **Recommended primary
  format**: types survive, no coercion question.
- `--props-file rows.csv` — headers map to field names.
  **Coercion policy (pick one, document it, test it):** _no_ coercion —
  every CSV value is a string, and a composition that needs a number must use a
  schema (item 09) or `calculateMetadata` to convert. This is the honest option
  and matches the first draft's instinct; the alternative (JSON-parse each cell)
  turns `NaN`, `null`, and `007` into surprises. If item 09 has landed, the
  schema is the natural coercion point and should be wired here.
- Each row is merged over `defaultProps` exactly like `--props`
  (`registry.ts:218`), so `resolveCompositionConfig` runs per row and
  `calculateMetadata` can adapt duration/dimensions per row as designed.
- CSV parsing needs real quoting support (embedded commas, quoted newlines,
  escaped quotes). Write it as a pure function in `scripts/rows.mjs` with a
  fixture suite; do not hand-roll `split(',')`.

### Output templating

- `--out` accepts `{index}` (0-based) and `{slug}` (a designated column, default
  `slug`, overridable with `--slug-field <name>`).
- **Validate every output path before rendering anything:** duplicate paths,
  paths escaping the output dir, empty slugs, and slugs containing path
  separators are all named errors _up front_. Rendering 200 videos and then
  discovering rows 7 and 92 collide is the failure this prevents.
- Sanitize slugs to a documented charset; do not silently mangle.

### Execution

- One `createRenderContext()` (item 00b) — one Vite server, one Chrome
  resolution — reused across rows.
- Rows run **sequentially**, each internally parallel at `--concurrency`. That is
  the right default: `-c 4` already saturates a laptop, and row-parallelism on
  top would fight for the same cores while multiplying peak disk use.
- Per-row isolation: own frames dir, own browsers, catch → record → continue.
  `--fail-fast` opts into stopping at the first failure.
- Disk ceiling: at most one row's frames exist at a time. State the number
  (`durationInFrames × frame size`) in the docs so a user can predict it.

### Summary

At `--log=info`, a table: row, slug, outFile, sha256 (short), wallclock, status.
At `--log=json`, one `{type:'row', …}` event per row plus a final
`{type:'batch-done', rows, ok, failed, seconds}`. Exit non-zero listing the
failed rows if any failed.

## Files touched

`scripts/render.mjs` (flag parsing + the row loop, calling item 00b's API), new
`scripts/rows.mjs` (JSONL + CSV parsing, out-template expansion — all pure,
all unit-tested), `scripts/render-lib.mjs` (out-template helper if it belongs
next to `planOutput`, `render-lib.mjs:257-289`).

## STOP — decisions the executor must not make alone

1. **Do not start before item 00b.** Restated because it is the whole point.
2. **Do not add row-level parallelism** (rendering N rows at once) in v1.
3. **Do not silently coerce CSV values.** Pick the documented policy above.
4. **Do not reuse one browser across rows** unless you also test composition
   state leakage (module-level caches — fonts, audio data, captions — all persist
   in a page). Fresh browsers per row is the safe default; if you want the perf,
   prove the isolation.

## Risks

- **Long-running memory growth** across hundreds of rows — the per-row temp dir
  must actually be removed each iteration; assert it in the test, since a slow
  leak is invisible until row 400.
- **Partial output on failure** — a row that fails mid-encode may leave a
  truncated file at its `--out` path. Write to a temp path and rename on
  success, so a failed row leaves no plausible-looking artifact.
- **Crossings:** `--props-file` × `--distributed`, × `--still` (allowed: one
  still per row), × `gif`/`webm`, × `--concurrency`.

## Verification

- pure: CSV quoting fixtures (embedded comma, quoted newline, escaped quote,
  CRLF, BOM, ragged row → named error); JSONL malformed-line → named error with
  the line number; out-template expansion incl. collision detection
- **3-row smoke:** three outputs exist, three distinct sha256s, summary table
  correct, exit 0
- **Failure isolation:** middle row has invalid props → it fails named, rows 1
  and 3 still render, exit ≠ 0, failed row listed, no temp dirs left behind
- **`--fail-fast`** stops after the failing row
- **The warm-pool claim, measured:** batch wallclock for 3 rows vs 3 separate CLI
  invocations. Report both numbers in the PR. If the win is smaller than
  expected, that is a finding about where cold-start cost actually lives — record
  it rather than dropping the claim quietly.
- `calculateMetadata` per row: a batch over `Countdown` with `seconds` 2/4/6
  produces three outputs of three different durations (`ffprobe` each) — this is
  what proves per-row resolution rather than one config reused

**Does not cover:** identical sha256s across rows would mean the props are not
reaching the compositions. Assert the hashes are **distinct**, which is the
cheap check that catches a props-plumbing bug.

## Docs

README usage block; chapter 7 "Batch rendering" section covering the coercion
policy, the isolation model, and the disk ceiling; tutorial closing recipe
(personalized promos) — the natural finale for the author-facing tutorial.

## Definition of done

- [ ] item 00b landed first
- [ ] JSONL + CSV parsing with fixtures; documented coercion policy
- [ ] output paths validated before the first render
- [ ] per-row isolation proven by the middle-row-fails test
- [ ] warm-pool speedup measured, numbers in the PR
- [ ] per-row `calculateMetadata` proven by three different `ffprobe` durations
- [ ] no temp dirs leak across rows
- [ ] chapter 7 + README + tutorial updated
