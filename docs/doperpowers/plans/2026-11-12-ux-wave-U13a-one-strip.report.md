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

### M5's third fix round and the round trip with F

`a45780aad` changes only `e2e/cross-build.spec.ts`. In `(layout, to the peer)`, the peer now brings the page's tab forward from its own library row, as build F does. The fix's checks are the e2e tsc and eslint, both passing. The re-review of the scene was clean: every assertion proves the read or write it names.

The round trip with build F at `a45780aad` is the run of record: run 43389572773, `--peer-exact f1852de3a`. It passed 6, skipped 7 and failed none. The three U13a scenes all ran and passed. The skipped scenes are the daemon-shape ones, which do not apply to this pair. Since that run, `e2e/cross-build.spec.ts` has not changed.

### e2e

No executor runs e2e. The scenes to run alone first, the groups, and the cross-build run of record with F are in the execution document's Progress (the hand-over line of 2026-11-13).

### Not verified

- A whole unit suite with no failure outside the known set. The VM's runs were noisy under load, and every other failure passes rerun alone. Class 1a is the record.
- Not every e2e scene has been seen green on a real build yet. The groups at `4206f9520` passed `code`, `default`, `machines`, `panel` and `remote`; `layout` failed. At `6b6cb77fa` (run 43389400800) `default` passed and `layout` passed 15 of 16; the one failure was `ux2-shell.spec.ts:612`, fixed at `11da6c82a` (below). Nothing after `6b6cb77fa` has been run as an e2e group yet.

## After the hand-over: the place, the ux2-shell scene and the branch review (2026-11-13)

### The ux2-shell scene (`11da6c82a`)

`e2e/ux2-shell.spec.ts:612`, the compact file-tab scene, is a scene this branch never edited. It broke on M4's markup: the title now sits inside a box it shares with the place. The fix is scene-only. The title selector is now `:scope > span > span.truncate`. The product code is unchanged.

### A tab's place, readable or not drawn (`0b0144484`)

The architect looked at the narrow-width screenshots and found the places squeezed to "c." and "c…". The ruling: a place is drawn only while a readable part of it fits, meaning its whole text or at least its first four characters before the ellipsis; otherwise it is not drawn. The fix is pure CSS on tokens, with no measuring in JavaScript:

- The title and the place share a one-line box that wraps and clips what wraps (`flex h-[1lh] min-w-0 flex-wrap overflow-hidden`).
- The title does not shrink.
- The place asks for its whole text or 5em (`max-w-max min-w-0 grow basis-[5em] truncate`). When that does not fit beside the title, the place wraps onto the clipped second line and is not seen.

A unit test pins the classes. The one-strip scene checks, at every width step, that each place is either whole or at least four characters before its ellipsis, or else not drawn.

### The branch review's five findings (`8b3d4a147` red, `84745874b`)

The architect ran an xhigh panel over `c0e7b2ae8..a45780aad`. Its verdict was "incorrect", with five findings, each confirmed by its verifier. The architect's rulings are in the execution document's Decision Log ("The branch review …"). One executor, the M3 executor, fixed all five:

1. **(P1)** A chat with a write of its draft still in flight looked empty and could be discarded. `patchIntent` now counts unanswered intent writes per session, and `isEmptyChat` is false while that count is above zero. There is no wire or IPC change.
2. **(P2)** `isEmptyChat` is now the one definition of empty, read by every caller: the reuse, the close of the other empty chats, and the relaunch sweep. It also counts a queued prefill and a queued attachment as content.
3. **(P2)** `closeEmptyChat` takes the tab out in the same synchronous run. What the session holds beside it (`dropSession`) is dropped only after main answers yes. A refusal or an error restores the tab and its pin.
4. **(P2)** `rowOf` resolves a listed session with no record, in either lane, to its listing's row.
5. **(P2)** `subscribeTransfer` now also subscribes to what `sessionRow` reads, through the new `subscribeSessionRows`.

The executor's checks on the VM:

- at `8b3d4a147` (red): 19 failures, each for the expected reason;
- at `84745874b`: web tsc 0, eslint on the 8 changed files 0, and the touched directories plus `tokens-guard`: 274 files and 3896 tests passed.

The execution document's Outcomes now carries the lesson's third instance: "empty" must be decided by one function that reads every place content can wait, in-flight writes included.

**Build F.** None of the five fixes, and neither the place fix nor the scene fix, touches what build F reads from a stored layout or the settings files. `e2e/cross-build.spec.ts` is unchanged since `a45780aad`. The round trip of record (run 43389572773) therefore stands, and no rerun is needed.

### The wave's task review

The task review of `cff5750f3..84745874b` approved the wave. It found no Critical or Important issues. The reviewer traced the editor's cleanup path: the count rises in the same tick that the live draft disappears, and `session.intent.patch` has one caller. It also confirmed that the `finally` covers every exit, so the count cannot leak.

It found seven Minor issues:

- **Fixed now:**
  - (1) The one-strip scene stopped at the first width where a place gives way, so the readable-or-not-drawn check never saw 700 and 600 px. It now visits every width, and a place counts as drawn only on the box's first line. That fix went to the M4 executor.
  - (3) A doc comment was misplaced above `subscribeSessionRows`.
  - (5) The `writing` count had no test reset, and the answered and rejected paths had no test. Fixes 3 and 5 went to the M3 executor.
- **Left for the branch reviewer** (also under "Unresolved review findings" below):
  - (2) `basis-[5em]` holds four characters plus the ellipsis for Latin and full-width CJK. It does not for colour emoji, which are wider than 1em. This is an edge case of names; the remedy would be about `5.5em`.
  - (4) In `rowOf`, `rowOfListed ?? orgKey ?? machineKey` copies the private `setKeyOfListed` in `stores/org-projects.ts`, a file outside this landing. Exporting that function is one line, for whoever next owns that file.
  - (6) The put-back on a refusal follows §E (`openTab(..., { activate: false })`): an unpinned chat comes back at the end of the strip, not where it was. A tab the person reopens from the sidebar during the pending window is closed by `dropSession` when main says yes; before this wave the same sequence left a tab whose intent had been discarded. Whether the chat should get its position back is a spec question.
  - (7) In the directory runs, files this wave did not touch print stderr: `Composer.test.tsx` and `Editor.test.tsx` act and flushSync warnings, `PushState.test.tsx` "no tool registered", plus `Tab.test.tsx`, `resource.test.tsx` and `useSetupIntent.test.tsx`. This looks like existing debt and was not checked against the base.

Fix commits: `9b97f3749` (the comment and the count's reset, plus answered and rejected cases), and `125a3ff36` (the scene, now at every width).
- At `9b97f3749` the M3 executor ran, on the VM: web tsc 0, eslint 0 on its 4 files, and vitest on `empty-chats.test.ts`, the 21 files that import `setup-actions` or `test-support/setup-intents`, and `keymap/`: 49 files and 1200 tests passed.
- At `125a3ff36` the M4 executor ran the e2e project's tsc and eslint on `e2e/shell.spec.ts`; both passed. No e2e was run.
- I read both diffs against the findings and did not dispatch another task review for them: each is a few lines, and each does what its finding asked.

The head is `125a3ff36`, plus this record. Master has not moved since `f8f8fda67`. `git diff --quiet a45780aad HEAD -- e2e/cross-build.spec.ts` exits 0, and no schema, settings or layout file changed after `a45780aad`.

### Unresolved review findings (for the branch reviewer)

The delta review over `a45780aad..469819693` returned correct, with no findings. The architect then ruled on the four below: the first three became tracker rows in `docs/tech-debt-tracker.md`, the third also accepted as built; the fourth goes to the test-hygiene ticket.


- **The place and emoji** (`src/renderer/src/main/Tab.tsx:198`). `basis-[5em]` holds four glyphs and the ellipsis only while a glyph is at most 1em wide. Four colour emoji would show as three and the ellipsis. This is an edge case of names. The remedy is about `5.5em`.
- **A duplicated formula** (`src/renderer/src/keymap/actions-runtime.ts:387`). `rowOfListed ?? orgKey ?? machineKey` copies the private `setKeyOfListed` (`stores/org-projects.ts:162`). Exporting that is a one-line change, but in a file outside this landing.
- **Where a refused discard puts the chat back** (`actions-runtime.ts:202-215`). An unpinned chat returns at the strip's end, because §E's put-back is `openTab(..., { activate: false })`. A tab reopened from the sidebar during the pending window is closed by `dropSession` on yes, which is no worse than before the wave. Whether the chat gets its position back is a spec question.
- **stderr noise from untouched files.** `Composer.test.tsx` and `Editor.test.tsx` print act and flushSync warnings, and `PushState.test.tsx` prints "no tool registered". `Tab.test.tsx`, `resource.test.tsx` and `useSetupIntent.test.tsx` also print. This looks like existing debt; nobody checked it against the base.

## Residue

- **A pinned tool cannot be pinned or unpinned while a tab that is not a session's is in front.** In `src/renderer/src/panel/SurfaceRow.tsx`, the session tools' icons are `disabled={!session && !tab}`, and their folded items under "More surfaces" are disabled the same way. With the library, a page or Diagnostics in front, a person has no way to reach the tool's "Unpin from toolbar". Found while the cross-build scene was being fixed, and not for this landing to change. The architect registered it as board ticket 620.
- **Three tech-debt rows** (2026-11-13, `docs/tech-debt-tracker.md`, owner UX wave U13 (U13a)):
  - a place drawn with colour emoji against `basis-[5em]`;
  - `rowOf` repeating `setKeyOfListed`;
  - a refused discard putting an unpinned chat back at the strip's end, accepted.
- **stderr noise** from test files this wave did not touch: in the architect's test-hygiene ticket, not this landing's.
