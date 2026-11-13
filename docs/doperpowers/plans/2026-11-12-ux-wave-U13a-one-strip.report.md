# UX wave U13a (one strip): execution report

Board #578. Execution document: `docs/doperpowers/plans/2026-11-12-ux-wave-U13a-one-strip.md`. This report covers M1 to M5. M1 was dispatched alone. M2 to M5 followed once the architect's rehearsal on real layout files had passed (2026-11-13); step 0 was not waited for, and master was merged at each milestone boundary instead.

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
| `pnpm test` (whole), on the loaded build VM (load 12 to 19) | `486980b20` | exit 1: 25 files failed (65 tests), 2462 files passed. See below. |
| the 18 files outside the known set, rerun with `--testTimeout=60000 --hookTimeout=60000` on a second, quiet build VM (load under 5) | `486980b20` | 24 of 26 file runs passed. The other two, `src/pty-host/detached.test.ts` and `src/shared/host/detached-transport.test.ts`, failed in the group run. |
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

## M2 to M5 (2026-11-13)

Each milestone had one executor and an independent task review. Every Critical and Important finding was fixed and re-reviewed. The execution document's Decision Log and Progress carry each decision and tick; its Outcomes & Retrospective sums the landing up. Every check below ran on the build VM through `vmcheck.sh ux-wave/U13a`.

### Master merges

| at | brings | checks after it |
|---|---|---|
| `4141b9cb1` | U8a | none run separately; M2's checks ran over the merged tree |
| `d76a8d41a` | U6a | `pnpm typecheck` exit 0; vitest over `stores/ shell/ main/ keymap/ panel/ sidebar/ app/ ipc/ shared/ipc/schema/ shared/keymap/`: 152 files, 2268 tests passed |
| `3958e7df4` | `d3c7edce3`, the gate's `--peer-exact` | the acceptance run below ran on top of it |
| `438a8d116` | `80dcc59af`, `scripts/ci-gate.sh` only | `bash -n scripts/ci-gate.sh` passes |
| `f8f8fda67` | `c0e7b2ae8`, U10a (#618: the document editor; none of U13a's files) | `pnpm typecheck` exit 0; vitest over the token guard, the layout schema, `stores/` and `tools/document/`: 46 files, 698 tests passed |

No merge conflicted. `3958e7df4` carries git's default merge message, without the session line.

### Milestones

**M2: one strip in the store, and the current project.**
- Commits: `67c8ba4bf..4cf52c4dc`, review fix `0041b10cc..1d744f9cd`. Two review rounds.
- The finding: a background `openTab` moved the focus. §B was revised.
- Checks:
  - `pnpm typecheck` exit 0;
  - eslint on 56 paths exit 0;
  - 32 touched test files passed (1448 tests);
  - the whole `pnpm test` at `3daeac9be` exited 1 with 19 files failing: the known set, `Sidebar.test.tsx` under load (passes alone), one real failure fixed in `4cf52c4dc`, and ten files that pass alone with `--testTimeout=60000`;
  - after the review fix: the web tsc, eslint, and vitest over five directories passed (1302 tests).
- One edit outside UC-8's list, which you confirmed: `panel/host.ts`, type only.

**M3: New chat, with Q1.**
- Commits: `fd5f60831..275685451`, review fixes `7e00e152b..c9e5b9d25` and `97adaff64..9cecb61bc`. Three review rounds.
- The findings: the relaunch sweep could discard a chat of this run. The fix is that creation now waits for the sweep. A refused close also lost its pin.
- Last checks, at `9cecb61bc`:
  - web tsc exit 0;
  - eslint exit 0;
  - vitest over `sessions/ keymap/ main/ overview/ sidebar/ app/`: 119 files, 1769 tests passed.

**M4: the tabs' places, Close tabs to the right, the chip.**
- Commits: `02ed34550..04e4b080b`. One review round, clean.
- The review's Minor, a pinned tab to the right of the menu's tab, became a unit case in M5.
- Checks:
  - web tsc exit 0;
  - eslint exit 0;
  - vitest over eleven directories: 153 of 156 files passed. The three failures were time-outs; the forty-tab case was given its own budget, and the rerun passed 16 files, 397 tests.

**M5: the e2e scenes, the record, the acceptance run.**
- Commits: `4a31bd4d8..4206f9520`, review fixes `dca21b066`, `5003003a0` and `9dce99e62`. Three review rounds.
- Your trial cross-build runs found the tool pin hidden behind a folded icon, then behind a disabled one. The review found two assertions that could pass without proving F's write or a relaunch with no notice.
- The acceptance run at `8be4eb94f`:
  - `pnpm typecheck` exit 0, which covers `e2e/`;
  - `pnpm lint` exit 0;
  - `pnpm test` exited non-zero with 10 files failing:
    - the known set of six;
    - `journal`, `org/rows` and `document-perf`, which pass rerun alone;
    - `test/support/tokens-guard.test.ts`, which read `#497` as a colour. It was reworded on your ruling and the guard passes.
- Fix checks:
  - web and e2e tsc exit 0;
  - eslint exit 0;
  - the guard and the touched test files: 5 files, 76 tests passed.
- A12: `git diff origin/master...HEAD -- src/shared/keymap/actions.ts` prints nothing.

### e2e

No executor runs e2e. The scenes to run alone first, the groups, and the cross-build run of record with F are in the execution document's Progress (the hand-over line of 2026-11-13).

### Not verified

- A whole unit suite with no failure outside the known set. The VM's runs were noisy under load, and every other failure passes rerun alone. Class 1a is the record.
- Every e2e scene on a real build. Your trial runs passed `(layout, from the peer)` and `(settings, both ways)`. `(layout, to the peer)` has been fixed twice since and has not been run since.

## Residue

- **A pinned tool cannot be pinned or unpinned while a tab that is not a session's is in front.** In `src/renderer/src/panel/SurfaceRow.tsx`, the session tools' icons are `disabled={!session && !tab}`, and their folded items under "More surfaces" are disabled the same way. With the library, a page or Diagnostics in front, a person has no way to reach the tool's "Unpin from toolbar". Found while the cross-build scene was being fixed, and not for this landing to change. It needs a tracker row.
