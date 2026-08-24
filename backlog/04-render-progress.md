# 04 — Render progress output + structured logs

**Status:** ready **after 00b**
**Effort:** S once item 00b has landed · **L-shaped and unpleasant before it**
**Depends on:** **00b** (the event emitter is defined there)
**Unblocks:** 08a (studio render button), 12 (batch summaries), 15 (MCP
streaming)

## Audit verdict

The design is right and the event schema was the most useful thing in the first
draft. But as written this item was going to be implemented by sprinkling emit
calls through a 770-line script that also parses argv and owns process signals.
Item 00b exists to make that unnecessary: **00b defines and emits the events; 04
formats them.** With that split this item is genuinely small — two formatters
and a TTY check — and it is the reason to do 00 first.

If 00 has not landed, do not start this by rewriting `console.log` calls in
place; you will do the work twice.

## Why this is worth building

`render.mjs` prints ad-hoc lines (`:414-423`, `:566`, `:629-643`, `:756-766`); a
long render gives coarse feedback and nothing machine-readable. Every downstream
consumer of the renderer — studio button, batch runner, MCP tools — needs
structured progress more than humans need a prettier bar.

## Design

### The flag

`--log=<silent|error|info|verbose|json>`, default `info`. **`info` output must
be byte-identical to today's** — that is the compatibility contract and item
00's golden transcripts already pin it.

| level     | behavior                                                            |
| --------- | ------------------------------------------------------------------- |
| `silent`  | nothing on stdout; errors still go to stderr; exit code unchanged   |
| `error`   | errors + warnings only                                              |
| `info`    | today's output, exactly                                             |
| `verbose` | adds per-frame timings, chunk boundaries, the full ffmpeg argv      |
| `json`    | newline-delimited JSON on stdout, one object per line; nothing else |

### JSON mode

One event per line, the union defined in item 00b. Rules that make it usable by a
program:

- **stdout carries only NDJSON.** Warnings that today go to `console.warn` become
  `{type:'warn'}` events; nothing else may write to stdout in this mode.
- Every event carries `t` (ms since start). `frame` events carry `worker`.
- Errors are `{type:'error', message, frame?, chunk?}` with the **message string
  verbatim** from the named-error ladder — a JSON wrapper must never reword an
  error whose exact text is a documented contract (invariant 5).
- `done` carries `outFile`, `sha256` (the full digest, not the 16-char prefix the
  human line shows at `render.mjs:643`), `frameCount`, `seconds`. This is what
  lets an automation assert determinism.
- Exactly one `meta` and at most one `done` per run.

### Human mode

- **TTY:** one rewritten status line — `frames done/total · elapsed · ETA ·
failed chunks`. ETA from a rolling mean of the last N frame durations, not a
  global average (chunks finish at different times and a global mean lies at the
  end).
- **Non-TTY (CI, pipes):** periodic plain lines, no cursor control, no ANSI. Test
  this — a CI log full of escape codes is the classic regression.
- Coalesce: at 60 fps a per-frame line is noise. Human mode emits at most ~4
  updates/second regardless of frame rate; JSON mode emits every frame and the
  docs state that cost.

## Files touched

- **New** `scripts/render-log.mjs` — pure formatters:
  `formatHuman(event, state) → string | null` and `formatJson(event) → string`.
  Pure means unit-testable with no spawning.
- `scripts/render.mjs` — `--log` parsing + wiring the formatter to the emitter
  from item 00b
- `scripts/render-lib.test.mjs` (or a new `render-log.test.mjs`) — schema and
  ordering tests

## STOP — decisions the executor must not make alone

1. **Do not change any existing stdout line at `--log=info`.** If a line is
   wrong, fix it in a separate commit so the transcript diff stays meaningful.
2. **Do not add a progress _bar_ library.** Zero-dependency is a project value;
   a rewritten line with `\r` is enough.

## Risks

- **Throughput cost of per-frame logging.** Measure it: render HelloWorld at
  `--log=info` and `--log=json`, report both wall times. If JSON costs more than
  ~2%, buffer the writes.
- **Interleaving from parallel chunks.** Events from 4 workers arrive
  interleaved; that is fine and expected for `frame` events, but `meta` must be
  first and `done` last and exactly once. Test with `-c 4`.
- **Backpressure.** `process.stdout.write` to a pipe can return `false`. In JSON
  mode at high frame counts this matters; either await `drain` or accept the
  buffering and say so.

## Verification

- **Schema + ordering snapshot** for a tiny comp (`--still` and a 6-frame comp):
  exact event sequence asserted, not just "contains"
- **Crossing:** `--log=json` × `-c 4` × `--distributed` — events interleave,
  `done` fires once, `sha256` matches the `-c 1` run
- **TTY vs pipe:** spawn the renderer with `stdio: 'pipe'` and assert **zero**
  ANSI escape sequences in the captured output; the TTY path is asserted by
  unit-testing the formatter with `isTTY: true` injected
- `--log=silent` → empty stdout, correct exit code, error still on stderr
- **`--log=json` output parses as NDJSON end-to-end**: every line
  `JSON.parse`s. This is the test that catches a stray `console.log`.

**Does not cover:** a green event stream says nothing about the encoded file.
`done.sha256` covers the _frame set_ only (it is computed pre-encode,
`render.mjs:641-643`) — state that in the docs next to the field, since
automations will be tempted to treat it as an output-file checksum.

## Docs

Chapter 7 gains "Machine-readable output" — the level table, the event union,
and the honest scope of `done.sha256`. README flag table. The event schema
doubles as the contract item 15's MCP server implements against, so write it as
a reference table, not prose.

## Definition of done

- [ ] `--log` implemented for all five levels; `info` transcript byte-identical
- [ ] NDJSON parse test green; ordering snapshot green at `-c 1` and `-c 4`
- [ ] no ANSI when stdout is a pipe
- [ ] json-vs-info wall-time delta measured and reported
- [ ] chapter 7 section + README table; `done.sha256` scope documented
