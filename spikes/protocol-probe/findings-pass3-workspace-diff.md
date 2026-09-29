# Protocol probe, pass 3: `get_workspace_diff` against a dirty tree

Engine 2.1.283 by absolute path. Scenario `scenarios/pass3/workspace-diff-dirty.mjs` (`node run-pass3.mjs workspace-diff-dirty`), two launches, fixtures `fixtures/pass3/workspace-diff-dirty.jsonl` and `fixtures/pass3/workspace-diff-branch.jsonl`. No user turn: the read answers right after `initialize`. Fills the gap left by `fixtures/reads.jsonl` seq 81, which is all empty arrays because that tree was clean.

Repository: two commits on `main` (`alpha.txt` 30 lines, `beta.txt`, `gamma.md`, a tracked binary `pixel.bin`), then dirtied: two unstaged hunks in `alpha.txt`, a staged edit to `beta.txt`, `pixel.bin` rewritten, untracked `early.txt`/`early.bin` created before the engine started and `notes/late.txt`/`late.bin` created after `initialize`. Binary content starts with NUL bytes; a first attempt using purely random bytes had none, so both git and the engine treated it as text.

## Request

The request is `{subtype:"get_workspace_diff"}` with no parameters. The engine schema has no other key, SPEC 45 (§45 table) lists none, and SPEC 36 §10.1 shows none. Undocumented keys (`base`, `scope`, `staged`, `mode`) are accepted and ignored: dirty seq 13 is identical to seq 8. The only thing that changes the result is repository state, so the variants here are repository states:

| Variant | Fixture seq | `source` |
|---|---|---|
| on `main`, dirty | dirty 8 | `{kind:"working-tree"}` |
| same, undocumented keys | dirty 13 | same as seq 8 |
| checked out `feature` (one commit ahead of `main`) while the engine was running | dirty 18 | still `{kind:"working-tree"}` |
| fresh engine started on `feature`, dirty | branch 7 | `{kind:"branch",baseBranch:"main",baseRef:<merge-base sha>}` |
| same engine, tree stashed clean | branch 12 | `branch`, only the committed `feature.txt` |

## Response shape (every variant succeeded)

`response` is `{diff}`. `diff` has the keys `stats, perFileStats, hunks, skippedLarge, restricted, source`.

- `stats`: `{filesCount:number, linesAdded:number, linesRemoved:number}`
- `perFileStats[]` item, verbatim keys (dirty seq 10): `path` string, `added` number, `removed` number, `isBinary` boolean, `isUntracked` boolean. No `preSession`, `isLargeFile` or `isTruncated` on this surface.
- `hunks[]` item (dirty seq 10): `path` string, `hunks` array.
- `hunks[].hunks[]` item, the first hunk's keys verbatim: `oldStart` number, `oldLines` number, `newStart` number, `newLines` number, `lines` string[]. Each line is prefixed `" "`, `"-"` or `"+"`. There is no `@@` header line and no trailing newline. Context is 3 lines, and a file with two separated edits yields two hunks (`alpha.txt` 1,7→1,7 and 23,8→23,8).
- `skippedLarge`, `restricted`: string[] of paths (empty here).
- `source`: `{kind:"working-tree"}` or `{kind:"branch", baseBranch:string, baseRef:string}`.

## Staged, binary and untracked files

- Staged and unstaged edits are merged, both diffed against HEAD (or the merge-base). `beta.txt`'s staged edit appears like any other change, and nothing marks it as staged.
- A modified tracked binary appears as `{isBinary:true, added:0, removed:0}`, with no `hunks` entry and no `skippedLarge` membership. So "no hunks entry" has three causes: binary, skippedLarge, or restricted.
- An untracked file appears as `{added:0, removed:0, isBinary:false, isUntracked:true}` with no hunks. The untracked binary `late.bin` also reports `isBinary:false`, because untracked content is never inspected.
- **Untracked files whose mtime and ctime predate the engine's start are omitted entirely.** `early.txt` and `early.bin` are in `git status` but absent from `perFileStats` and `stats` (dirty seq 8). In the second launch all four untracked files predate the start and none appear (branch 7). The collector's `ls-files --others` result is filtered by session start (`preSession`) in `branch-point` mode.
- `stats.filesCount` counts the untracked rows (5 = 3 tracked + 2 late untracked), but `linesAdded`/`linesRemoved` count only tracked text (5/5).
- Row order: tracked working-tree rows in path order, then untracked rows, then committed-only branch rows (`feature.txt` last in branch 7). `hunks[]` follows the same order.

## Where this departs from the SPEC or the engine's own schema text

1. **The base branch is fixed at engine start.** The schema description ("merge-base with the base branch …, when HEAD is on another branch with commits beyond it") reads as if it were evaluated per request. After a mid-session `git checkout -b feature` plus a commit, dirty seq 18 still reports `working-tree` and omits `feature.txt`. A fresh engine on the same repository reports `branch` (branch 7). MAWS cannot rely on `source` after the session's HEAD branch changes.
2. **The SPEC does not mention that untracked files predating the session are dropped.** SPEC 15 §15.13.3 names only the 500-file scan cap. The engine's schema text ("all changes are untracked (stats only …)") likewise implies every untracked file is listed.
3. **Hunks are not git's hunks.** SPEC 15 §15.13.3 gives a git `diff` argv for hunks. On this surface, the hunks are computed in-process from blob contents, in the style of jsdiff's `structuredPatch`: the pure-addition hunk for `feature.txt` is `oldStart:1, oldLines:0` (branch 7), where git prints `-0,0`. A renderer that prints `@@ -oldStart,oldLines` must print 0 when `oldLines` is 0.
4. SPEC 36 §10.1 says the RC worker uses `branch-point` mode and does not fall back to a HEAD-only diff when the tree is dirty. The print worker behaves the same way (branch 7 carries both the uncommitted rows and `feature.txt`). This matches the SPEC; recorded here as confirmed.

For C3's schema: `perFileStats: z.array(z.object({path:z.string(), added:z.number().int(), removed:z.number().int(), isBinary:z.boolean(), isUntracked:z.boolean()}))` and `hunks: z.array(z.object({path:z.string(), hunks:z.array(z.object({oldStart, oldLines, newStart, newLines: z.number().int(), lines: z.array(z.string())}))}))`. This matches the engine's zod declaration (`kF` and `DF` in `chunk-9r9kpwh0.js`). `diff` is declared nullable: it is null outside a git repository or during a merge, rebase or cherry-pick (not exercised here).

The fixtures carry the pinned binary's path and `~/.claude/output-styles` under the home directory unredacted, as the sibling fixtures do; the harness redacts secrets and emails, not home paths.

Recorded 2026-09-28 by the probe agent; the findings text was saved by the architect because the agent's environment refused to write a `.md` file.
