# UX wave U13a (one strip): execution report

Board #578. Execution document: `docs/doperpowers/plans/2026-11-12-ux-wave-U13a-one-strip.md`. This report covers M1, the milestone the architect dispatched. M2 to M5 wait for the rehearsal on real layout files and for step 0 to reach master.

## M1: the stored form and its reader

**Status:** done and reviewed clean. The branch is pushed.

**Commits.** `7fbf15772` was the base: a merge of master and the document's dispatch entry. The work:

- `4a4f915d1`: the tests, red.
- `95bd21fb2`: the implementation.
- `d07608d6c`: type fixes.
- `0c147f02f`: the review fixes.

Interleaved with these are commits to the execution document only: `48a6c0450`, `f5da3bf9a`, `d913e539d` and `486980b20`.

**What exists.** Every item below is additive. No existing schema, export or `LAYOUT_DEFAULTS` changed, and no file under `src/renderer/` was touched.

- In `src/shared/ipc/schema/layout.ts`: `Strip`, `EMPTY_STRIP`, `storedMain(strip)` and `stripOf(stored)` (Interfaces §A). Their tests are in `layout.test.ts`.
- The A7 test, `src/main/layout/one-strip.test.ts`. It runs main's `sessionsInTabs` and `remoteSessionsInTabs` before and after the conversion, with each machine taken as the local one in turn.
- `test/layout/rehearsal.ts`: the rehearsal's one boundary. `test/layout/rehearsal.test.ts`: sentinel tests for leaks and for every outcome word. `test/layout/owner-files.test.ts`: the gated runner.

**Size.** 650 lines added and 1 removed, over 6 files (`git diff --shortstat 7fbf15772 0c147f02f -- src test`):

| file | added | removed |
|---|---|---|
| `layout.ts` | 60 | 0 |
| `layout.test.ts` | 109 | 1 |
| `one-strip.test.ts` | 62 | 0 |
| `rehearsal.ts` | 237 | 0 |
| `rehearsal.test.ts` | 168 | 0 |
| `owner-files.test.ts` | 14 | 0 |

The plan estimated about 520. The rehearsal's leak tests account for the rest.

## Checks (VM, through `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U13a -- '<command>'`)

| command | head | result |
|---|---|---|
| `pnpm exec vitest run src/shared/ipc/schema/layout.test.ts src/main/layout/one-strip.test.ts test/layout/` | `4a4f915d1` | red as intended: 4 files failed, `stripOf is not a function`, and `./rehearsal` was missing |
| same | `d913e539d` | exit 0: 3 files passed, 1 skipped (`owner-files.test.ts`); 53 tests passed, 1 skipped |
| `pnpm exec eslint src/shared/ipc/schema/layout.ts src/shared/ipc/schema/layout.test.ts src/main/layout/one-strip.test.ts test/layout/` | `d913e539d` | exit 0 |
| `pnpm typecheck` (whole, all six stages) | `d07608d6c` | exit 0, taken without a pipe |
| `pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null` | `0c147f02f` | exit 0 (the executor's run after the review fix, which touched only `layout.ts` and the test files) |
| `node --test .github/scripts/maws-app-scan.test.mjs` | `d07608d6c` | 8 passed. M1 adds no fixture file; this was a precaution. |
| `pnpm test` (whole), on the loaded VM dc-uxwave-6506 (load 12 to 19) | `486980b20` | exit 1: 25 files failed (65 tests), 2462 files passed. See below. |
| the 18 files outside the known set, rerun with `--testTimeout=60000 --hookTimeout=60000` on the quiet VM dc-uxwave3-38fa (load under 5) | `486980b20` | 24 of 26 file runs passed. The other two, `src/pty-host/detached.test.ts` and `src/shared/host/detached-transport.test.ts`, failed in the group run. |
| those two alone, at the base `7fbf15772` and at `486980b20` | both | exit 0: 108 tests passed at each commit |

The whole suite, outside the known set:

- Every failure is a 5 s timeout, a load-bound assertion, or the deploy scripts' missing Access token. None of the failing files imports anything M1 added.
- Rerun with long timeouts on the quiet VM, every one of those files passes. The two detached-host files pass only when run alone; together with the others they failed.
- The known set failed as the brief says: the desk-hub deploy tests, `setup.test.ts`, `git-reads.test.ts`, `portability.test.ts`, and `Sidebar.test.tsx` under load. In the quiet rerun `Sidebar.test.tsx` passed.

## The rehearsal

The command, from a checkout of the branch with dependencies installed:

    MAWS_LAYOUT_REHEARSAL=<a directory outside any repository> pnpm exec vitest run test/layout/owner-files.test.ts

Its output on invented files, at `486980b20`. One file was version 3 with four sets over two machines, a split, a pin and contexts; the other was version 1. Exit 0:

    file 1 of 2  main.tabs v3: 4 sets, 9 tabs, 8 distinct (session 7, file 1, artifacts 1), 2 pinned, 1 closed, 0 reader warnings
                 -> strip: 8 tabs, 2 panes, merged yes, canonical no; missing 0, added 0, twice 0; 2 machine views: held here 6 = 6, held elsewhere 6 = 6; contexts 3 -> 1   pass
    file 2 of 2  main.tabs v1: 1 set, 2 tabs (session 2), 0 pinned, 0 closed, 0 reader warnings
                 -> strip: 2 tabs, 1 pane, merged no, canonical no; missing 0, added 0, twice 0; 1 machine view: held here 2 = 2, held elsewhere 0 = 0; contexts absent   pass

The same run with a third file that is not JSON fails, as it should. It exits 1, prints `file 3 of 3  not-json`, and its assertion reads `layout files that did not pass the rehearsal: expected 1 to be +0`.

How to read the output:

- **The words.** A file that does not pass shows its label and one word from the closed list: `pass`, `unreadable`, `not-json`, `not-a-layout`, `main-tabs-absent`, `main-tabs-rejected`, `surfaces-rejected`, `tab-missing`, `tab-added`, `tab-twice`, `sessions-differ`, `not-stored-form`, `internal`.
- **A run that proves nothing fails.** A directory that cannot be read prints `directory unreadable`, and one with no `*.json` prints `no layout files`; both count as not passed.
- **Machine views.** Each machine ref named by a session or agent tab is taken as the local machine once; for a version-1 or version-2 file there is one view, under a placeholder ref. Each view must match on its own, and "held here" and "held elsewhere" are sums over the views.
- **`contexts n -> m`** is information only, not a pass condition.
- **Files are labelled in name order.** The architect keeps the list of names.
- **Quote only the `file N of M` lines in a pull request.** vitest's own `RUN` header prints the checkout's absolute path, a home path on the owner's machine. The `stdout | test/layout/owner-files.test.ts > …` header names the test file only.

## Review

`doperpowers:task-reviewer`, two rounds. The verdict on the fix range `f5da3bf9a..0c147f02f` is approved: no Critical or Important finding remains.

The first round found two Important issues, both fixed in `0c147f02f` with a regression test each:

1. **`stripOf` could read a base set through the object prototype.** `current: 'constructor'` passes the key schemas and threw after parsing. The base is now taken only from an own key, so such a value starts an empty strip.
2. **The rehearsal accepted a conversion that adds a tab.** Ids are now compared both ways, and a new closed-list word, `tab-added`, reports the failure. The document's closed list was revised to hold it.

The executor added two things on its own judgment, and the re-review accepted both. The rehearsal reads `main.tabs`, `panelTools.surfaces` and the showing set's `contexts` entry as own keys only. The strip line prints `added 0`.

One Minor finding is kept as residue: the whole suite has not been green on the VM (above). Class 1a is the record.

## Decisions

All are in the execution document's Decision Log, under the entries of 2026-11-12 23:40Z and 2026-11-13.

- **How the branch takes master.** It merges master instead of rebasing, on the architect's word, and never rebases or force-pushes. Master was merged at `eeba4e916`, documents only.
- **The rehearsal's local machine.** It parses with a placeholder ref and compares once per machine view.
- **How the counts sum.** "Held here" and "held elsewhere" are sums over the views. `contexts n -> m` counts the keys stored, then whether the showing set has an entry.
- **The output line.** It adds `N distinct` and `added N`, and plurals follow the count.
- **The order of checks:** `tab-missing`, `tab-added`, `tab-twice`, `sessions-differ`, `not-stored-form`.
- **An empty or unreadable directory fails.**
- **The runner's one assertion** lives in `runRehearsal`, so the tests exercise exactly what the runner asserts.
- **A `focusedPane` that names a missing pane.** `stripOf` appends to pane 0 and leaves the repair to `repairMain`.
- **`stripOf` takes its base from an own key only.**

## Against the spec and the document

Nothing in the code contradicted the document. `layout.ts` gained additions only: the diff against `7fbf15772` removes no line, and the schemas that `f1852de3a` reads are byte for byte unchanged. M1 changes nothing that F reads from a stored layout or from a settings file.

The document deviates from its Concrete Steps 1 and its constraint 9 in one way: the branch merges master instead of rebasing onto it. The Decision Log records this.

## Not verified

- A whole unit suite with no failure outside the known set. On the loaded VM it was not green; the failing files pass when rerun with long timeouts on a quiet VM. Class 1a has not been run.
- The rehearsal over the owner's real layout files. That is the architect's run.
- Electron e2e. M1 touches no e2e spec and needs no scene.

## For later milestones

- **Q1.** The owner answered Q1 (2026-11-12, per the coordinator): a New chat with nothing typed does not come back after a relaunch. M3 records it in the Decision Log and Progress, settles §E's last paragraph, and builds that branch with its tests, its e2e clause and its dated amendment. M1 does not act on it.
- **M2's hydration** should give the same `contexts` m as the rehearsal prints for a file.

## Residue

None beyond the whole-suite qualification above, which class 1a settles.
