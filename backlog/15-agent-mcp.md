# 15 — Agent skill + MCP server

**Status:** ready **after 00b, 03, 04**
**Effort:** M · **Depends on:** 00 (callable pipeline), 03 (fresh-machine
browser), 04 (streamable events); 09 makes `describe_composition` much better
**Unblocks:** agentic video creation — and it is the item that best exploits
what makes this repo unusual

## Audit verdict

The strategic argument is the strongest in the backlog and worth restating
plainly: **determinism makes agent-generated video verifiable.** An agent that
renders twice and gets the same sha256 has proof it did not hallucinate a
non-deterministic composition. Nothing else in this space offers that.

Three corrections:

1. **`describe_composition` must read the page seam, not parse TypeScript.**
   Same constraint as item 09: Node cannot import `registry.ts`. Config,
   `defaultProps`, and schema come from `window.framewiseLite`
   (`main-render.tsx:146-170`), which means booting the render page — cheap,
   and already how `--list`'s richer sibling would have to work.
   `list_compositions` can stay on the regex path (`render.mjs:174-184`) since
   it needs no browser and that is a genuine feature.
2. **"Two concurrent render_video jobs serialize safely (single vite port
   policy)"** — the current server binds port 0 (`render.mjs:472`), so each run
   already gets its own port; there is no port conflict. The real concurrency
   question is CPU and memory: two renders at `-c 4` on a laptop is eight
   browsers. Serialize by policy with a queue, and say why (resources, not
   ports).
3. **The security posture needs to be stated, not implied.** An MCP server that
   spawns local processes and writes files is a real capability. It must not
   accept arbitrary paths or arbitrary code, and the boundaries belong in the
   README and in the tool descriptions, where a user reviewing permissions will
   see them.

## Design

### MCP server (`scripts/mcp-server.mjs`, stdio)

Thin wrapper over item 00b's API — **no new render logic**. Four tools:

| Tool                              | Returns                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `list_compositions()`             | ids + declared statics (no browser needed)                                                              |
| `describe_composition(id)`        | resolved config, `defaultProps`, prop schema (item 09), timeline summary (item 07, when present)        |
| `render_still(id, frame, props?)` | PNG path + dimensions — the fast visual feedback loop                                                   |
| `render_video(id, props?, opts?)` | job id; streams item-04 events as progress notifications; result carries `outFile`, `sha256`, `seconds` |

Design rules:

- **`render_still` is the primary loop.** An agent iterating on a composition
  should check single frames, not render 150. Make it fast and make the skill
  doc say so — that is the single highest-leverage instruction in the skill.
- Long renders: stream progress via MCP notifications from item 04's events;
  return the job id immediately. Document the timeout honestly and name it, in
  the same spirit as the delayRender ladder.
- **Bound the output surface**: renders write under a configured output
  directory only; reject absolute paths and `..` (reuse the containment thinking
  in `assetPath`, `render-lib.mjs:24-34`). Reject `--chrome`/`--public-dir`
  overrides from tool arguments entirely.
- Queue `render_video` jobs (concurrency 1 by default, configurable) for the
  resource reason above.
- Tools accept an `abort` for a running job (item 00b's `AbortSignal`).

### Skill doc (`skills/framewise-lite/SKILL.md`)

The workflow: read the relevant chapter → edit or add a composition → register
it → `render_still` at a few frames → full render → assert the reported hash.

Include the traps an agent will otherwise hit, each with the file that enforces
it:

- `interpolate` defaults to **extend**, not clamp (`interpolate.ts:3`, defaults at `:289-290`) — the
  single most common source of a wrong-looking animation
- `spring` at frame 0 is not 0-velocity-from-rest in the way people assume; read
  chapter 3 before tuning
- **the pinned composition-id list** (`render-lib.test.mjs:288-306`) must be
  updated whenever `registry.ts` changes — the failing test _is_ the reminder,
  and an agent that "fixes" the test by weakening it has broken the guard
- `random(seed)` not `Math.random()` (`random.ts:24-37`) — determinism
- `useVideoConfig()` throws outside a composition (`VideoConfig.tsx:44-49`)
- new composition → new chapter/section, per "docs are the product"

The skill doubles as user-facing documentation. Write it for a human first.

## Files touched

New `scripts/mcp-server.mjs` + test, new `skills/framewise-lite/SKILL.md`,
README section, `package.json` script (`mcp`) and the MCP SDK as a
**devDependency** — the published library must not carry it. Possibly a small
CLI affordance so tools stay thin (e.g. still-path in the `done` event).

## STOP — decisions the executor must not make alone

1. **Do not let tools take arbitrary filesystem paths or shell arguments.**
2. **Do not add a tool that writes composition source files.** Let the agent's
   own file tools do that; an MCP tool that edits code is a much larger trust
   surface and duplicates what the agent already has.
3. **Do not ship the MCP SDK as a runtime dependency** of the library.
4. **Do not weaken the pinned id-list test to make an agent flow smoother.**

## Risks

- **Long renders blocking tool calls** — streaming + job ids, documented
  timeouts.
- **Resource exhaustion** from concurrent jobs — the queue.
- **Agents defeating the guards** — the pinned test is the one an agent is most
  likely to "fix". Call it out in the skill _and_ keep the test's failure message
  explanatory.
- **Trust model** — the server spawns local processes and trusts the local user,
  exactly like the renderer. Say it in the README rather than leaving it implied.

## Verification

- **All four tools end-to-end against HelloWorld**, with the key assertion:
  `render_video`'s reported sha256 **equals a direct CLI run** of the same
  options. That is what proves there is one pipeline (invariant 3's spirit).
- `render_still` returns a real PNG of the declared dimensions (`ffprobe` it).
- `describe_composition('Countdown')` with `{"seconds": 3}` reports the derived
  90-frame duration — proving it went through `resolveCompositionConfig`
  (`registry.ts:211-250`) rather than reading statics.
- **Fresh-machine simulation:** empty browser cache (item 03) → first tool call
  downloads and renders.
- **Two concurrent `render_video` calls** queue rather than launching eight
  browsers; both succeed; hashes correct.
- **Containment:** `render_video` with `out: '/etc/x.mp4'` and with
  `out: '../../x.mp4'` are both rejected named.
- **Determinism claim, demonstrated:** render the same composition twice through
  the tool and assert identical hashes — this is the demo that justifies the
  whole item, so make it an actual test.

**Does not cover:** none of this evaluates whether the agent's _video is good_.
The skill should tell agents to render stills and look at them, because the hash
proves reproducibility, not quality.

## Docs

README "Using with coding agents" — what the server exposes, the trust model,
and how to run it. The skill file is itself the docs for the workflow.
`AGENTS.md` gains a pointer so a non-MCP agent finds the same guidance.

## Definition of done

- [ ] four tools implemented over item 00b's API, no duplicated render logic
- [ ] tool hash equals CLI hash for identical options (asserted)
- [ ] path containment enforced and tested for both escape shapes
- [ ] job queue prevents concurrent renders; abort works
- [ ] skill doc written, including the pinned-id-list trap
- [ ] MCP SDK is a devDependency; `npm pack --dry-run` unchanged
- [ ] README trust-model section
