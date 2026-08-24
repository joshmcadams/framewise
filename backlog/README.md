# Backlog

Open work only. An item lives here until it ships; when it does, the item file
is deleted — the fix is in the code, the reasoning is in its `plans/` file, and
the history is in git. Nothing completed is summarized here.

Each item is a self-contained prompt: the problem with evidence, why it matters,
a fix shape, and acceptance criteria. Ordered most-impactful first.

**The queue is empty.** New findings go here as numbered prompt files following
the shape above.

## Working an item

1. Write a `plans/NNN-*.md` from the item file, following the existing plans.
2. Execute it; docs in the same commit (CLAUDE.md, "Docs are the product").
3. Delete the backlog item file and its row here.
4. Flip the plan's row in `plans/README.md`.

## Where finished work went

Items 01–22 all shipped. To find one: `git log --oneline -- backlog/` shows
when each was opened and closed, and the `plans/` file named in the closing
commit carries the full reasoning and measurements.
