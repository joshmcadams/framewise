# 09 — Prop schemas → generated form controls

**Status:** ready — with the validation site corrected
**Effort:** M · **Depends on:** nothing
**Unblocks:** shareable templates; friendlier CLI errors; item 15's
`describe_composition`

## Audit verdict

Good item, right instinct on staying dependency-free, and the "form is a view
over the JSON textarea" decision is exactly right for avoiding dual-state drift.
One part is **not implementable as written**:

> "`render.mjs --props` validates against the schema when present"

`render.mjs` is Node and **cannot import `registry.ts`** — TypeScript, JSX, and
React imports. That is precisely why `--list` scrapes the registry with a regex
instead of importing it (`render-lib.mjs:44-57`, `render.mjs:174-184`), and why
`parseRegistryIds` needs a warning heuristic for its own fragility
(`render-lib.mjs:50-55`). Adding a second regex scraper for schemas would be
worse — schemas are structured values, not string literals.

**Correction: validate at page boot, not in the CLI.** `main-render.tsx` already
resolves and validates metadata before publishing anything
(`main-render.tsx:95-112`), and a failure there becomes `configError`, which the
renderer converts to an immediate named error (`render.mjs:446-452`). Schema
validation belongs in that same block, one step before `calculateMetadata`. The
user experience is identical — a fast, named, field-level error from the CLI —
and there is no second source of truth. Two seconds of browser boot is the
price, and it is the price already being paid for `calculateMetadata`.

## Design

### The builder (hand-rolled, zero deps)

```ts
import {p, propSchema} from '../framewise-lite';

schema: propSchema({
  title: p.string({label: 'Title', maxLength: 60}),
  seconds: p.number({min: 1, max: 60, step: 1}), // → slider
  theme: p.enum(['light', 'dark'] as const),
  accent: p.color(),
  loop: p.boolean({label: 'Loop the badge'}),
});
```

v1 is **scalars only** — string, number, boolean, enum, color. Arrays and
objects stay textarea-only, by design; say so rather than half-supporting them.

Each field descriptor is a plain serializable object:

```ts
type Field =
  | {type: 'string'; label?: string; maxLength?: number; default?: string}
  | {type: 'number'; label?: string; min?: number; max?: number; step?: number}
  | {type: 'boolean'; label?: string}
  | {type: 'enum'; label?: string; options: readonly string[]}
  | {type: 'color'; label?: string};

type PropSchema = {
  fields: Record<string, Field>;
  validate(
    props: Record<string, unknown>,
  ):
    | {ok: true; value: Record<string, unknown>}
    | {ok: false; errors: {field: string; message: string}[]};
};
```

**Serializability is a requirement, not an accident** — item 15's
`describe_composition` reads these over the page seam, so a field must be plain
JSON with no functions. Test it: `JSON.parse(JSON.stringify(schema.fields))`
deep-equals `schema.fields`.

### Where it plugs in

- `Composition` (`registry.ts:27-52`) gains optional `schema?: PropSchema`.
  Absent → today's behavior, unchanged. This is a purely additive type change.
- `main-render.tsx:95-112`: validate merged props against the schema **before**
  `calculateMetadata`; failure publishes `configError` with the field name:

  ```
  Countdown: props.seconds must be ≤ 60, got 90
  ```

- `App.tsx` `CompositionView` (`:70-168`): when a schema exists, render controls
  **above** the existing textarea. The controls write through
  `handlePropsChange` (`App.tsx:118-120`) — i.e. they edit the JSON text, which
  remains the single source of truth. That keeps the existing resolve effect
  (`App.tsx:85-106`) and its cancellation logic untouched, and sidesteps the
  fresh-object-in-deps trap the root `AGENTS.md` calls out.
- **Do not** add schema validation to `App.tsx`'s render path — derive it, like
  `parsed`/`editError` already are (`App.tsx:81-83`).
- Give two existing demos a schema: `Countdown` (number with min/max — it already
  has the matching `calculateMetadata` guard, `registry.ts:122-130`) and
  `HelloWorld` (two strings). That makes the schema/`calculateMetadata`
  relationship concrete instead of theoretical.

### Schema vs `calculateMetadata` — state the division of labour

- **Schema** = shape and range. Cheap, synchronous, drives UI, catches typos.
- **`calculateMetadata`** = semantics and derived config. May be async, may
  probe media (`registry.ts:142-146`), decides duration/dimensions.

They overlap on `Countdown.seconds` and that is fine — the schema stops the
slider at 60, the hook is still the authority. Document the overlap as
deliberate; a reader who sees two range checks will otherwise "fix" one.

## Files touched

New `src/framewise-lite/prop-schema.ts` + test (library, so it can be exported
to authors) **or** `src/render/prop-schema.ts` (registry-adjacent) — pick one and
justify; the barrel export argues for the former. `registry.ts` type + two demo
schemas, `src/App.tsx` controls component + test, `main-render.tsx` validation
hook.

## STOP — decisions the executor must not make alone

1. **Do not add Zod** (or any validation dependency). Zero runtime deps in the
   library is a stated project value; if a schema library is genuinely needed,
   that is a separate proposal.
2. **Do not make the form the source of truth.** The JSON textarea stays
   authoritative; the form is a view. Two-way binding here is how the drift bug
   gets in.
3. **Do not put schema validation in `render.mjs`.** See the audit verdict.

## Risks

- **Form ↔ textarea sync loops.** Mitigated by one-way flow (form → text) plus
  the documented React traps. Test: typing in the textarea updates the controls;
  moving a slider updates the textarea; neither loops.
- **A schema that disagrees with `defaultProps`.** Add a test asserting every
  registered composition's `defaultProps` validates against its own schema — a
  cheap gate that catches the mistake at `npm test` time.
- **Color values.** Pick one canonical form (`#rrggbb`) and normalize; `<input
type="color">` emits lowercase hex, but a user typing `red` into the textarea
  must produce a clear field error, not a silent pass.

## Verification

- pure: each field type's validate accept/reject cases, including boundary
  values and wrong-type inputs; error messages name the field
- serializability round-trip (above)
- every composition's `defaultProps` validates against its schema
- **round-trip:** form edit → JSON text → reload → identical resolved config
- **invalid input keeps the last-good config** (the existing banner flow,
  `App.tsx:98-102`) rather than blanking the Player
- **CLI:** `--comp Countdown --props '{"seconds":90}'` fails fast with the field
  name and a non-zero exit, _before_ any frame renders
- **crossings:** schematized comp × `--distributed`, × `--still`, ×
  `calculateMetadata` rejection (schema passes, hook still rejects → the hook's
  message wins, and that ordering is asserted)

**Does not cover:** a schema says nothing about whether the values make a _good_
video. `calculateMetadata` remains the semantic authority — repeat that in the
docs where a reader is most likely to conflate them.

## Docs

Tutorial props step gains a schema example (typecheck the snippet). Chapter 6
(demo & wiring) documents the new registry field and the validation ordering:
schema → `calculateMetadata` → render. Source-map entry.

## Definition of done

- [ ] five field types, hand-rolled, zero deps, fully unit-tested
- [ ] schemas are plain JSON (round-trip asserted) for item 15
- [ ] `Countdown` + `HelloWorld` schematized; defaults-validate gate green
- [ ] controls write through the textarea; no sync loop; last-good preserved
- [ ] CLI field-level error before any frame renders
- [ ] chapter 6 + tutorial updated; overlap with `calculateMetadata` documented
