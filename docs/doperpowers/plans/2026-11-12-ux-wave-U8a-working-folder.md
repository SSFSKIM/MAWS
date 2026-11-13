# UX wave · U8a: the working folder's selector, with today's behaviour (2026-11-12)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave, a composite), child **U8**, first landing (**U8a** in the root's "Ordering and dependency map", step 0). **Parent pin:** `25942f5d1`, the commit of the composite this document was written from. The composite is on master since; the architect's corrections to it for the differences recorded under Surprises & Discoveries land there.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U8-card-column-working-folder.md`: Contracts → "UC-4 (owned): the session's working folder", acceptance A9, and the item "l5-code-14" (its "First" landing). Where that file and the root's UC-4 differ, the root binds (the child's own header says so). This document carries the constraints and the one milestone, and nothing of the design.
> **Binding on this landing:** UC-4 (first landing only), UC-8 (who owns which files), UC-10 (building and landing), UC-11 (the repository is public), UC-14 (nothing stored changes); law 8 (keep means keep).
> **Branch:** `ux-wave/U8a`, from master `85e934368`. **Written against** that commit; every count and path below was read there. Master has since gained the wave's documents and nothing else (no file outside `docs/` differs between `85e934368` and `48619c824`, its head at this revision); the executor merges it first (Concrete Steps, step 1). **Board:** #575 (the root's Tracking map).

## Purpose

Twenty-one lines in twenty files each work out for themselves which folder a session works in, by writing `record.worktree?.path ?? record.directory`. The wave's later work (U8's second landing, U5, U6) needs that answer to come from one place, so that when the answer starts following the agent into a worktree, Review, Source control, Files, the terminal and the Environment card all follow together and none is left on the old folder.

After this landing one function gives the answer, the eighteen readers of Interfaces §B ask it, and a test fails the day a file works it out for itself again. Nothing on screen changes: the function returns exactly what each reader computed before.

How to see it working: the test that reads the source tree fails while the readers are as master has them, naming twenty files, and passes on the finished branch with four named exceptions; no existing test case changes, and the suites of the surfaces whose readers moved pass as they were.

## Progress

- [x] (2026-11-12 22:28Z) Document written against master `85e934368`: the readers inventoried and sorted, the recogniser's three patterns run over `src/` (24 files, 26 spellings), the services' and the endpoint's needs checked.
- [x] (2026-11-12) Adversarial review of this document: the inventory, the recogniser (26 matches in 24 files, every sample as stated), each reader's field and its handling of a missing record, and the suites' paths and vitest projects confirmed; one decision broken (Files' default root).
- [x] (2026-11-12 22:45Z) Revised on the architect's rulings (Decision Log 2): Files' default root leaves the landing; decision 7's inputs corrected and pinned by a case; the merge of master added as the first step.
- [x] (2026-11-12 22:44Z) M1, step 1: master `48619c824` merged into the branch (`cb6bf6d33`), no conflict; `git diff --name-only 85e934368 origin/master | grep -v '^docs/'` printed nothing.
- [x] (2026-11-12 22:47Z) M1, step 2: the selector, the renderer hook, their two suites, and the tree test committed and pushed (`5d6ccf182`), red on the VM with the list in Concrete Steps exactly. The run, as it came out: the two selector suites passed (5 and 3 cases; the hook's suite in both the `renderer` and `renderer-compiled` projects) and the recogniser's table passed (17 cases); the tree scan failed (`Tests 1 failed | 28 passed (29)`), its received list:

      src/renderer/src/app/StoreDiagnostics.tsx 1
      src/renderer/src/composer/Composer.tsx 1
      src/renderer/src/harness/code/codeProbes.ts 1
      src/renderer/src/ipc/events.ts 1
      src/renderer/src/panel/summary/Summary.tsx 1
      src/renderer/src/session/controls/lane-a.ts 1
      src/renderer/src/stores/git.ts 1
      src/renderer/src/tools/code/review/DiffTab.tsx 1
      src/renderer/src/tools/code/review/ReviewShell.tsx 1
      src/renderer/src/tools/code/review/ReviewSummary.tsx 1
      src/renderer/src/tools/code/review/ReviewTool.tsx 1
      src/renderer/src/tools/maws/ask/AskSheetTool.tsx 1
      src/renderer/src/tools/maws/ask/HoverAsk.tsx 1
      src/renderer/src/tools/scm/ScmShell.tsx 1
      src/renderer/src/tools/scm/ScmTool.tsx 1
      src/renderer/src/tools/terminal/TerminalView.tsx 1
      src/renderer/src/transcript/view/TranscriptSlot.tsx 1
      src/services/files/upload.ts 2
      src/services/scm/service.ts 2
      src/shared/ipc/schema/scm.ts 1

  Twenty files, 22 spellings, the same as step 2's list.
- [x] (2026-11-12 22:50Z) M1, step 3: the readers of Interfaces §B moved, the five comments reworded, the endpoint suite's case added (`d050a640a`); on the VM the three suites passed whole (`Test Files 4 passed (4)`, `Tests 29 passed (29)`), the tree test with exactly the four exceptions.
- [x] (2026-11-12 23:24Z) M1, step 4 (Concrete Steps 4 and 5), on the VM at `d050a640a`:
  - The diff's test files are exactly the four of Concrete Steps step 4; `test/endpoint/checkout-rule.test.ts` numstat `17 0`.
  - (22:52Z) The surfaces' suites: exit 0, `Test Files 78 passed (78)`, `Tests 1653 passed | 9 skipped (1662)`. The nine skipped are `it.skipIf(process.platform !== 'darwin')` cases in `src/services/files/{service,allowlist,watch}.test.ts`, files this landing does not change; master skips them on Linux as well.
  - (22:59Z) `pnpm typecheck`: exit 0 (the three projects and the three workspace packages).
  - (22:59Z) `pnpm exec eslint` over the 28 changed `.ts`/`.tsx` paths: exit 0, no message.
  - (23:21Z) `pnpm test`: exit 1, `Test Files 8 failed | 2481 passed | 26 skipped (2515)`, `Tests 44 failed | 35882 passed | 142 skipped (36068)`. None is this landing's (Surprises & Discoveries): the same six files fail 42 cases on master on the VM, and the two others are timeouts under the suite's load that pass alone on the branch (23:24Z, `Test Files 4 passed (4)`, `Tests 280 passed (280)`).
- [ ] Class 1a on GitHub Actions, once, on the complete branch.
- [ ] `doperpowers:review-code` on the branch (Decision Log 1), findings settled.
- [ ] Hand-back to the architect.

## Words used here

- **The session's folder, spelled by hand:** an expression that picks a record's worktree path when it has a worktree and its directory otherwise: `record.worktree?.path ?? record.directory` and its other forms (Interfaces §C). A file that contains one *spells* it.
- **The selector:** `workingFolder(record)` in `src/shared/sessions/working-folder.ts`, and its renderer hook `useWorkingFolder(appSessionId)` in `src/renderer/src/sessions/working-folder.ts`. Their shapes are the contract's (the child's file, UC-4, "The selector").
- **A reader:** a place that needs to know where the agent is working now. **An exception:** a place that is about the session's record and not about where the agent is (the contract's list: the archive, delete and archived-sessions dialogs, the Resume picker, the sidebar's hover card, the index's own writes, a session that has not started).
- **The launch folder:** the folder the record names, `record.worktree?.path ?? record.directory`. The record's `directory` is the folder the engine was started in; `worktree.path` is the root of the linked worktree that folder is in, when it is in one (so for a session found on disk whose folder lies inside a worktree, the two differ, and the launch folder is the worktree's root).
- **The second landing** (U8c in the root's ordering): the live signal, built later by another executor. It is named here only where it decides how this landing is cut.
- **The VM:** the wave's build machine, where every check of this landing runs (Constraints). **Class 1a:** typecheck, lint, the unit suite and the probes on GitHub Actions through `scripts/ci-gate.sh`; the gate of record.

## Acceptance

A9 of the child's file, as written there. It is shown by four observations, with their commands in Concrete Steps:

1. On the branch with the selector and the test but before any reader moves, the tree test fails and its message names the twenty files of Concrete Steps step 2, with their counts.
2. On the finished branch the tree test passes, and its exception list holds exactly the four entries of Interfaces §D.
3. No existing test case is changed: the diff against master holds three new test files and one existing one, `test/endpoint/checkout-rule.test.ts`, with lines added and none removed (decision 7's case).
4. The suites of Review, Source control, Files, the terminal, the card, the composer, the transcript's slot, the question sheet, the terminal session's controls, the renderer's events, the uploads and the endpoint's checkout rule and feeds pass unchanged, and so does the whole unit suite.

## Constraints that bind the milestone

- **Today's behaviour (UC-4, first landing).** `path`, `cwd` and `launch` are equal and `moved` is false, for every record. For every record the schema admits (`SessionRecordSchema`), no reader may show, watch, read or write a different folder than it does on master: there is no exception, and a difference the executor finds is a stop (below). The only values that answer differently are not records (decision 7).
- **Nothing of the second landing.** No new field on the record, no reading of a transcript row or of the engine's status inside the selector, no change to which folders a session's files may be read from (`recordDirectories` in `src/shared/sessions/directories.ts`, `src/services/files/allowlist.ts`, `rootsOf` in `src/endpoint/targets.ts`): that is a security boundary and the second landing's, under its own review.
- **The spec is not edited.** Stop and hand back to the architect, with the evidence, when the code contradicts a statement of the child's file or the root; when the work needs more than a one-site edit in a file another child owns (UC-8); when a contract would have to change; or when a change would alter what the person sees.
- **Other children's files (UC-8; the root's step 0).** Review and Source control are U5's, the terminal U6's, the composer U4's, the question sheet U1's, and the transcript's files have one writer at a time (UC-3). This landing's edit in each is the site of Interfaces §B and its import, nothing else in the file; it lands before those children branch, which is why it may make them.
- **Where checks run (UC-10).** The worktree on the MacBook has no `node_modules` and stays so: no typecheck, eslint, vitest, install, build or Electron there. Commit, push, then run on the VM, in a checkout of the pushed head:

      ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U8a -- '<command>'

  The first call installs dependencies and takes a few minutes. The whole `pnpm typecheck` takes about five minutes; while iterating, check one project (`pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null` for the renderer, `-p tsconfig.node.json` for services, the endpoint, shared code and `test/`). The helper's exit status is the command's: piping it into `tail` or `head` without `set -o pipefail` reads a failure as success.
- **The gate.** Class 1a, once, when the branch is complete, from the worktree: `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u8a`, started in the background (it waits for its run, up to half an hour, and its end is notified). The Actions and GitHub API budgets are shared: the gate is not a compiler and a run is never polled in a loop.
- **Electron e2e** is not the executor's to start. The specs that exercise the moved readers are listed under M1, "What it proves", for the architect.
- **The repository is public (UC-11).** Fixtures and test strings use invented folders (`/repo`, `/repo/.claude/worktrees/w1`); no home path, account, project name or text of the owner's.
- **Git.** Commit as the work goes and push the branch; never commit to master or to `ux-wave-spec`. No Co-Authored-By and no other attribution line; each commit message and the pull request's body end with the wave's session line, `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)`. A pull request is opened only when the dispatch says so; its body opens by citing the composite's path, the child id and the parent pin, and names what Decision Log 1 lists.
- **Landing (UC-10).** Nothing lands on master without the owner's word; the session that keeps master lands the pull request by its gated merge.
- **The record.** This landing reverses no ruling, stores nothing (UC-14) and closes no row of the register: l5-code-14 stays open until the second landing.

## Plan of Work

### M1 — The selector, its readers, and the test that keeps them

**What exists at its end.** `workingFolder(record)` and `useWorkingFolder(appSessionId)`; eighteen files that ask them where they worked the session's folder out themselves (Interfaces §B); five comments that name the selector in place of the old spelling; a test over `src/` that fails on any spelling outside the selector's module and four counted exceptions. The app behaves as master does.

**What it touches.** New: `src/shared/sessions/working-folder.ts` and its suite `working-folder.test.ts` beside it; `src/renderer/src/sessions/working-folder.ts` and its suite `working-folder.test.tsx`; `test/one-working-folder.test.ts`. Changed: the eighteen files of Interfaces §B, the four comment-only files named under it, and `test/endpoint/checkout-rule.test.ts`, which gains one case (decision 7). This document's Progress, Surprises & Discoveries and Decision Log.

**Interfaces.** Exposes the selector and the hook (Interfaces §A) to U5, U6 and U8's later landings; consumes nothing new.

**Decisions.**

1. *A reader passes the record it already holds.* A reader that has a record in hand (a tool's `ctx.session`, a prop, the spine view's record, the files allowlist's record) calls `workingFolder` on that same object. A reader that has only an id and selects from the sessions store today (`ReviewSummary.tsx`, `DiffTab.tsx`, `TranscriptSlot.tsx`) calls the hook. Reasons: existing suites mount tools with a record that is not always in the store, so they pass unchanged only if each reader keeps its source; and the second landing's signal is to ride on the record as one optional field (the child's file, probe outcome 1), so a record in hand already carries it and no call site changes then. For the same reason no reader builds the selector's argument by hand (decision 7 is the one narrowing). Rejected: every renderer reader through the hook, which re-sources tools from the store and breaks those suites.
2. *Which field a reader reads* is in Interfaces §B. The rule: `path` where the reader names a checkout (to git, to a new shell, to a picker, in a label); `cwd` where it stands in for the folder the agent's own commands ran in (the composer's mentions and commands; a shell call that names no folder). The three are equal today, so the choice changes nothing now; it is made now so that the second landing changes the selector and not the readers. `launch` and `moved` have no reader in this landing.
3. *The hook returns the same object while the four fields are equal.* It selects through `useSessions` with `useShallow` (`zustand/react/shallow`, as `TranscriptSlot.tsx` already does). zustand 5 requires a selector's result to be cached, and an object built inside a selector is new on every store change; readers also key effects on these strings. Its suite pins it: a record replaced with only `unread` changed gives the identical object; a changed worktree gives a new one. It returns null when the window holds no record of the session.
4. *The selector validates nothing.* A record whose `directory` is the empty string (the index writes that when it knows none) answers the empty string in all three fields, as each reader computed before. `cwd` equals `path` even for a record whose `directory` lies inside its worktree: the contract says equal for this landing. The selector's suite pins both cases with literal paths, so the second landing changes them knowingly.
5. *The terminal's helper goes.* `sessionDirectory` in `tools/terminal/TerminalView.tsx` is removed; its two callers (`TerminalView.tsx`'s `shownDirectory`, `tools/terminal/index.ts`'s default `cwd` in `ensureTerminal`) call the selector. A second name for the same answer is how a spelling comes back. Nothing else imports it.
6. *Files has no reader in this landing.* The child's list names `tools/code/files/tree.ts` (the tree's roots); the root's UC-4 says the roots are not such a reader and binds, so `tree.ts` is not touched. The place in Files that picks one folder is `SessionTree`'s `defaultRoot` in `FilesTool.tsx` (the listed root whose role is `worktree`, else the first listed root), and it is not touched either: the architect's ruling of 2026-11-12, after the adversarial review (Decision Log 2). It chooses among the roots the files service listed, by the role `rootsFor` and `roleOf` gave each, and a search for the listed root that is `workingFolder(session).path` does not equal that choice for every input. Two inputs the review found: `sameFile` folds case on every path, so with `directory: '/repo'`, `additionalDirectories: ['/wt']`, `worktree.path: '/WT'` and the listed roots `/repo`, `/wt`, `/WT`, today's choice is `/repo` and the search answers `/wt`, which is not the working checkout; and `SessionTree` reads the record and the listing separately, the listing arriving later, so when the record's directory becomes `/extra` while the listing still holds `/old`, `/extra`, today's choice is `/old` and the search answers `/extra`. This landing's promise is equality, and equality cannot be shown by pinning one case. The default root moves with the second landing, where Files following the agent is designed and tested.
7. *The endpoint's copy moves too.* `checkoutOf(record: unknown)` in `src/endpoint/targets.ts` is a third spelling (`typeof worktree === 'string' ? worktree : directory`, over the untyped answer of `session.get`), documented there as "as the scm service reads it"; the contract's list does not name it, and the child's file says the endpoint needs the same answer. It narrows the value first (an object whose `directory` is a string and whose `worktree` is null, absent or an object with a string `path`), passes that same object to `workingFolder`, and answers its `path` when absolute. The same object, not a rebuilt one, so that when the second landing changes what the selector reads, the endpoint and the scm service still agree by construction, and a working folder that is not yet among the endpoint's roots is refused, not admitted. A value of any other shape answers null, which the caller (`CheckoutBounds.of`) already reads as a checkout it cannot vouch for: `checkoutCovers` is true, and a remote reader's feed then withholds the session's source-control output (fail closed). For every valid record the answer is today's. The values that answer differently are none of them a `SessionRecord` (`session.get`'s declared answer is one or null, `src/shared/ipc/schema/session.ts`): where today answers the directory, a `worktree` that is `{}`, one whose `path` is null or not a string, and a `worktree` that is a primitive other than null; where today answers the worktree's path, a string `worktree.path` beside a `directory` that is no string. Each now answers null and fails closed. The endpoint's suite pins one: a case added to `test/endpoint/checkout-rule.test.ts`, beside its case for a root in no repository, in which `CheckoutBounds.of` given that root as `directory` and `worktree: {}` answers `checkoutCovers: true` with the same `within`, `roots` and `dropped` as for `worktree: null`. It fails on master, where the answer is `false`. `rootsOf` beside it is not touched.
8. *The composer keeps the engine's status in front.* `Composer.tsx` reads `status?.cwd` first and falls back to the record; only the fallback moves (`workingFolder(record).cwd`). The engine host sets that status folder from every turn's `system/init` (`systemInit` in `src/engine-host/session-status.ts`), so for a session MAWS runs it is the fresher of the two and dropping it would change what the composer resolves against today. Whether the live signal makes it redundant is the second landing's.
9. *The tree test: what it recognises, what it scans, how exceptions are kept.* Interfaces §C and §D hold the patterns and the list. It scans the raw text of every `.ts` and `.tsx` file under `src/`, suites and comments included, except the selector's module: no suite under `src/` spells the folder today, so including them costs nothing and stops a test from pinning the old answer; a comment that spells it teaches the next author the old way and would be false after the second landing. Exceptions are a table in the test, path to exact count with one line of reason, compared whole: a new spelling in any file fails, one more spelling in an excepted file fails, and an entry whose spelling is gone fails until it is removed. The table is in the test file and not marked at each site, so that adding an exception is an edit to a file U8 owns and shows in review as one (UC-8). The same file holds a table of sample strings the recogniser must and must not match, so its reach is itself pinned. Skip a file that does not contain `worktree` before running the patterns: the scan then takes about a second for the 4,300 files, inside the node project's five-second default. Rejected: an ESLint rule with a scratch-source test, as `test/one-locale.test.ts` does (A9 asks for a unit test that reads the tree, and linting the tree inside a unit test is too slow); walking a syntax tree (it sees the same forms as the three patterns at several times the code).
10. *What the recogniser cannot see.* A spelling spread over statements (`if (record.worktree !== null) return f(record.worktree.path); … f(record.directory)`) or made through other names. Master holds four such places: `placeOf` in `sidebar/HoverCard.tsx` and `folderBadge` in `resume/model.ts` (both exceptions by the contract and left as they are), `defaultRoot` in `FilesTool.tsx` (left to the second landing, decision 6), and `checkoutOf` in the endpoint (moved, decision 7). The test's message and this decision say so; the rule for an author is the contract's ("no file reads the session's folder except through the selector"), and the test is its net for the usual forms.
11. *Comments.* Five comments spell the folder: the `directory` prop's in `tools/code/review/ReviewShell.tsx` and `tools/scm/ScmShell.tsx`, the `entries` key's in `stores/git.ts`, and the header's in `src/shared/ipc/schema/scm.ts` and `src/services/scm/service.ts`. Each is reworded to name the session's working folder (`workingFolder(record).path`); nothing else in those files changes.
12. *Order.* Merge master first. Then write the selector and the tree test and run it red: its list is the work list (Concrete Steps, step 2). Then move the readers.

**What it does not touch.** The four exception files (Interfaces §D), `placeOf` and `folderBadge`; all of Files: `tree.ts`, whose roots are no reader, and `defaultRoot` in `FilesTool.tsx`, for decision 6's two reasons (its choice folds case through `sameFile`, and it reads the record and a later listing separately, so no search by the selector's path equals it for every input); the files allowlist and every list of a session's roots; `composer/frame/bindings.ts` (a MAWS-run session's location chip reads `status?.cwd ?? record?.directory`) and the folder line of `request-card/RequestCard.tsx` and `sidebar/RequestPreview.tsx` (both `record.directory`): none is the contract's spelling, moving any of them changes the folder shown for a record whose directory lies inside its worktree, and the architect ruled on 2026-11-12 that they stay, as readers the second landing sorts; `models` in `main/lane-b/remote.ts`, which matches a models query to a live session by folder and is no reader of where the agent is; the engine host, the index and the record's schema; the stored layout; any existing test case (one case is added to the endpoint's suite, decision 7); the Environment card's rows (the "moved from" line is the second landing's, the rest U8's second pull request).

**What it proves.** A9, by the four observations under Acceptance. Behaviours the new suites pin beyond A9's words: the selector's four fields for a record with no worktree, with a worktree, with a directory inside its worktree, and with an empty directory; the hook's null for an unknown session and its stable object (decision 3); the recogniser's table (Interfaces §C); the endpoint's answer for a value that is no record (decision 7). Not proved by this milestone: Electron e2e. The specs that exercise the moved readers, for the architect to arrange: `e2e/code-tools.spec.ts` (Review, a diff tab, the change line), `e2e/scm.spec.ts`, `e2e/terminal.spec.ts` (the start folder; "warns about the worktree"), `e2e/panel.spec.ts` and `e2e/ux2-shell.spec.ts` (the card and the side surfaces), `e2e/composer.spec.ts` (the `@` and `/` menus), `e2e/maws-tools.spec.ts` (the question sheet and the hover card's form), `e2e/lane-a.spec.ts` (a terminal session's location and its uploads), `e2e/sessions.spec.ts` (worktree sessions), `e2e/remote.spec.ts` (source control, a terminal and uploads through the endpoint, its checkout rule included), and the live ones `e2e/code-tools-live.spec.ts` and `e2e/c12-prerun.spec.ts` (Review and a terminal in a worktree). No scene is added: there is nothing new to see until the second landing.

## Concrete Steps

All commands are run from the worktree of branch `ux-wave/U8a`; `vmcheck` stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U8a --`, and each call tests the pushed head.

1. **Master first.** The branch starts at `85e934368`; master has moved since, by the wave's documents only.

       git fetch origin master && git merge origin/master

   Expect a merge with no conflict that brings in files under `docs/` and nothing else (`git diff --name-only 85e934368 origin/master | grep -v '^docs/'` prints nothing; if it prints a path under `src/`, re-run step 2's scan and compare its list before trusting this document's counts). After it the spec's files are in the tree and the pull request is against today's master. Push.

2. **Red.** With the selector, the hook, their suites and the tree test committed and pushed, and no reader moved:

       vmcheck 'pnpm exec vitest run test/one-working-folder.test.ts src/shared/sessions/working-folder.test.ts src/renderer/src/sessions/working-folder.test.tsx'

   Expect the two selector suites and the recogniser's table to pass, and the tree scan to fail naming these twenty files and counts (22 spellings) as not in the exception list:

       src/renderer/src/app/StoreDiagnostics.tsx 1
       src/renderer/src/composer/Composer.tsx 1
       src/renderer/src/harness/code/codeProbes.ts 1
       src/renderer/src/ipc/events.ts 1
       src/renderer/src/panel/summary/Summary.tsx 1
       src/renderer/src/session/controls/lane-a.ts 1
       src/renderer/src/stores/git.ts 1
       src/renderer/src/tools/code/review/DiffTab.tsx 1
       src/renderer/src/tools/code/review/ReviewShell.tsx 1
       src/renderer/src/tools/code/review/ReviewSummary.tsx 1
       src/renderer/src/tools/code/review/ReviewTool.tsx 1
       src/renderer/src/tools/maws/ask/AskSheetTool.tsx 1
       src/renderer/src/tools/maws/ask/HoverAsk.tsx 1
       src/renderer/src/tools/scm/ScmShell.tsx 1
       src/renderer/src/tools/scm/ScmTool.tsx 1
       src/renderer/src/tools/terminal/TerminalView.tsx 1
       src/renderer/src/transcript/view/TranscriptSlot.tsx 1
       src/services/files/upload.ts 2
       src/services/scm/service.ts 2
       src/shared/ipc/schema/scm.ts 1

   A different list means `src/` moved under the branch or the patterns differ from Interfaces §C: find which before going on, and record it under Surprises & Discoveries.

3. **Green.** After the readers and comments are moved, the same command passes whole. Two sites the scan does not name move as well: `tools/terminal/index.ts` (the removed helper's caller) and `src/endpoint/targets.ts` (decision 7, with its case in the endpoint's suite).

4. **The surfaces' suites, unchanged.**

       git diff --name-only origin/master...HEAD -- '*.test.ts' '*.test.tsx'
       git diff --numstat origin/master...HEAD -- test/endpoint/checkout-rule.test.ts

   The first prints exactly `src/renderer/src/sessions/working-folder.test.tsx`, `src/shared/sessions/working-folder.test.ts`, `test/endpoint/checkout-rule.test.ts` and `test/one-working-folder.test.ts`; the second shows lines added and `0` removed. Then:

       vmcheck 'pnpm exec vitest run src/renderer/src/panel/summary src/renderer/src/tools/code/review src/renderer/src/tools/code/files src/renderer/src/tools/scm src/renderer/src/tools/terminal src/renderer/src/tools/maws/ask src/renderer/src/transcript/view/TranscriptSlot.test.tsx src/renderer/src/composer/Composer.test.tsx src/renderer/src/session/controls src/renderer/src/ipc src/services/scm src/services/files test/endpoint/checkout-rule.test.ts test/endpoint/checkout-rows.test.ts test/endpoint/checkouts.test.ts test/endpoint/feeds.test.ts'

   Expect every file to pass with no test skipped that master runs.

5. **Whole checks on the VM,** each its own call so that each exit status is read: `vmcheck 'pnpm typecheck'`; `vmcheck 'pnpm exec eslint <the changed .ts and .tsx paths>'`; `vmcheck 'pnpm test'`. Expect no error from any.

6. **The gate,** once, in the background: `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u8a`. Its last lines name the run and its conclusion (`ci-gate: run <id> success`); keep the run id for the pull request's body.

## Interfaces and Dependencies

### A. The selector and the hook

The contract's signatures, unchanged (the child's file, UC-4, "The selector"): `WorkingFolder { path; cwd; launch; moved }`, `workingFolder(record: Pick<SessionRecord, 'directory' | 'worktree'>): WorkingFolder` in `src/shared/sessions/working-folder.ts`, and `useWorkingFolder(appSessionId: AppSessionId): WorkingFolder | null` in `src/renderer/src/sessions/working-folder.ts`.

What its three kinds of caller need from the shared module, checked in the code:

- It imports nothing but the record's type (`@shared/graph/session`): it is bundled into the renderer, the main process, the daemon and the endpoint, and all three TypeScript projects compile `src/shared/` (`tsconfig.node.json`, `tsconfig.web.json`, `tsconfig.e2e.json`), so it may use neither DOM nor Node types. The hook's module is the renderer's alone: only components import it, and the readers outside React (`ipc/events.ts`, `session/controls/lane-a.ts`, `tools/terminal/index.ts`, `harness/code/codeProbes.ts`) call the pure function.
- **The services** may import it: the services library's boundary (`eslint.config.js`, `SERVICES_BOUNDARY`; `test/services/boundary.test.ts`) refuses main, the daemon, the renderer, the preload and Electron, not `@shared`. `src/services/scm/service.ts` holds a whole `SessionRecord` from the spine's view. `src/services/files/upload.ts` holds an `AllowlistRecord` (`src/services/files/allowlist.ts`: a `Pick` of `directory`, `additionalDirectories` and `worktree`, which for a session not yet started is built from its setup intent with `worktree: null`). The selector's parameter must therefore stay a `Pick` that an `AllowlistRecord` satisfies; a later field it reads must be optional in that `Pick`, or `upload.ts` stops compiling.
- **The endpoint** may import it (`src/endpoint/targets.ts` already imports from `@shared`); it holds an untyped value and narrows it first (decision 7).

### B. The readers that move

| file | the site | holds | reads |
|---|---|---|---|
| `src/renderer/src/panel/summary/Summary.tsx` | `SessionSummary`'s `directory`: the card's folder, its git watch, what Environment and Context are handed | the record (prop) | `path` |
| `src/renderer/src/tools/code/review/ReviewTool.tsx` | `ReviewBody`'s `directory` (the shell's folder and key) | `ctx.session` | `path` |
| `src/renderer/src/tools/code/review/ReviewSummary.tsx` | the store selection behind the change line | an id: the hook | `path` |
| `src/renderer/src/tools/code/review/DiffTab.tsx` | the store selection behind a diff tab's shell | an id: the hook | `path` |
| `src/renderer/src/tools/scm/ScmTool.tsx` | `ScmBody`'s `directory` | `ctx.session` | `path` |
| `src/services/scm/service.ts` | the private `checkout()`; the header comment | the view's record | `path` |
| `src/renderer/src/tools/terminal/TerminalView.tsx` | `shownDirectory`; the export `sessionDirectory` is removed | `ctx.session` | `path` |
| `src/renderer/src/tools/terminal/index.ts` | `ensureTerminal`'s default `cwd` | `shown.session` | `path` |
| `src/renderer/src/transcript/view/TranscriptSlot.tsx` | `sessionDirectory`, the folder shown on a shell call whose input names none; still null for a child agent's transcript | an id: the hook | `cwd` |
| `src/renderer/src/composer/Composer.tsx` | the fallback of `cwd`, after `status?.cwd` (decision 8) | `record` | `cwd` |
| `src/renderer/src/tools/maws/ask/AskSheetTool.tsx` | `Sheet`'s `directory`, where a question's file picker opens | `ctx.session` | `path` |
| `src/renderer/src/tools/maws/ask/HoverAsk.tsx` | the `directory` handed to each question | `record` | `path` |
| `src/renderer/src/session/controls/lane-a.ts` | `bindings()`'s `location.path`, a terminal session's location | the `record` argument | `path` |
| `src/renderer/src/ipc/events.ts` | `repoRootOf`'s `checkout` | the store's record | `path` |
| `src/services/files/upload.ts` | the two `base` folders, the writer's and the reader's | the allowlist's record | `path` |
| `src/renderer/src/app/StoreDiagnostics.tsx` | a row's `directory` for the git diagnostics | the record | `path` |
| `src/renderer/src/harness/code/codeProbes.ts` | the probe's `directory` | the store's record | `path` |
| `src/endpoint/targets.ts` | `checkoutOf` (decision 7) | an untyped value, narrowed | `path` |

Each keeps its own handling of a missing record (`null`, `''`, the `scm.status` answer) exactly as it is. Comment only (decision 11): `tools/code/review/ReviewShell.tsx`, `tools/scm/ScmShell.tsx`, `stores/git.ts` (all under `src/renderer/src/`), `src/shared/ipc/schema/scm.ts`.

### C. What the tree test recognises

Three patterns over a file's whole text, so that a spelling wrapped over two lines is seen. `CHAIN` is a member chain that may be empty; a file's count is the sum of the three patterns' matches.

    const CHAIN = String.raw`(?:[A-Za-z_$][\w$]*\s*(?:\?\.|!\.|\.)\s*)*`;
    const WORKTREE_PATH = String.raw`worktree\s*(?:\?\.|!\.|\.)\s*path`;
    const SPELLINGS = [
      // a fallback: x.worktree?.path ?? x.directory, with || too, with any receiver or none
      new RegExp(String.raw`${CHAIN}${WORKTREE_PATH}\s*(?:\?\?|\|\|)\s*${CHAIN}directory\b`, 'g'),
      // a conditional, the worktree first: … ? x.worktree.path : x.directory
      new RegExp(String.raw`(?<![?.])\?(?![?.])\s*${CHAIN}${WORKTREE_PATH}\s*:\s*${CHAIN}directory\b`, 'g'),
      // a conditional, the directory first: … ? x.directory : x.worktree.path
      new RegExp(String.raw`(?<![?.])\?(?![?.])\s*${CHAIN}directory\s*:\s*${CHAIN}${WORKTREE_PATH}\b`, 'g'),
    ];

Run over `src/` at master `85e934368` they match 26 times in 24 files: the twenty of Concrete Steps step 2 and the four of §D. The table of samples in the test holds at least these. Each must count once: `record.worktree?.path ?? record.directory`; `record?.worktree?.path ?? record?.directory ?? null`; `ctx.session.worktree?.path ?? ctx.session.directory`; `worktree?.path ?? directory`; the first again with a line break after `??`; `r.worktree?.path || r.directory`; `record.worktree ? record.worktree.path : record.directory`; `record.worktree !== null ? record.worktree.path : record.directory`; `record.worktree === null ? record.directory : record.worktree.path`; a comment that holds the first. Each must count zero: `record.worktree?.path ?? null`; `intent.progress.worktree?.path ?? location.repoRoot`; a list of roots, `[r.directory, ...r.additionalDirectories, ...(r.worktree ? [r.worktree.path] : [])]`; `isHere(r.directory) || (r.worktree !== null && isHere(r.worktree.path))`; an object literal with `worktree_path: init.worktree?.path ?? null,` and `directory: init.directory` on its next line; `status?.cwd ?? record?.directory`; `workingFolder(record).path`.

The failing message names each file and count that differs from the table, says to read the folder through `workingFolder` or `useWorkingFolder`, and says what an exception is (about the record, not about where the agent is) and that adding one is an edit to this file with its reason.

### D. The exceptions

| file | spellings | why it stays on the record |
|---|---|---|
| `src/renderer/src/sessions/ArchiveDialog.tsx` | 1 | whether another session's record still names the worktree being archived: records compared with each other |
| `src/renderer/src/sessions/ArchivedSessionsDialog.tsx` | 1 | the folder an archived record names, in the list of archived sessions |
| `src/renderer/src/sessions/DeleteDialog.tsx` | 1 | the folder of the record about to be deleted |
| `src/renderer/src/resume/ResumeChooser.tsx` | 1 | the Resume picker's folder badge: where a past session was |

The contract's other exceptions (the sidebar's hover card, the index's writes, a session that has not started) do not match the patterns and need no entry.

## Surprises & Discoveries

Found while writing this document, against master `85e934368`, and reported to the architect, who alone edits the spec. The architect ruled on each on 2026-11-12 and is correcting the child's file and the root; the ruling is noted with each. None is resolved by this document.

- Observation: the "21 lines in 20 files" count is every spelling, the four excepted ones included; the readers that move by the child's list are 17 lines in 16 files, and five comments spell it as well.
  Evidence: the three patterns of Interfaces §C over `src/`: 26 matches in 24 files, of which 5 are comments and 4 are the files of §D.
  Ruled 2026-11-12: accepted; the count's wording is corrected in the spec.
- Observation: `tools/code/files/tree.ts`, which the child's list names, spells no single folder; `rootsFor` there builds the list of roots. The root's UC-4 says the roots are not such a reader. The place in Files that picks one folder is `defaultRoot` in `FilesTool.tsx`.
  Evidence: `rootsFor` adds `record.directory`, each additional directory, then `record.worktree.path`; `FilesTool.tsx`: `rootEntries.find((root) => roles.get(root.path) === 'worktree')?.path ?? rootEntries[0]?.path ?? null`.
  Ruled 2026-11-12: accepted for `tree.ts`. This document first moved `defaultRoot` onto the selector and declared one input where the result differed; the adversarial review found two more (decision 6), so the architect struck the move, and `defaultRoot` joins the second landing's list.
- Observation: the endpoint has its own spelling, which neither list of the contract names.
  Evidence: `src/endpoint/targets.ts`, `checkoutOf`: `const checkout = typeof worktree === 'string' ? worktree : directory;`, under the comment "A record's scm checkout, as the scm service reads it".
  Ruled 2026-11-12: accepted; it moves in this landing (decision 7), and the contract's lists gain the endpoint.
- Observation: for a session MAWS runs, the engine host's status folder already follows the agent, one turn late. The child's item l5-code-14 ("Today") says it is kept from the first frame only.
  Evidence: `src/engine-host/session-status.ts`: `case 'init': if (isSubagentFrame(frame)) return; this.systemInit(frame, at);` and, in `systemInit`, `if (typeof frame.cwd === 'string') this.engineCwd = frame.cwd;`; the probe's findings (`spikes/protocol-probe/findings-uxwave-U8-working-folder.txt` on branch `ux-wave/probe-folder-memory`): "Each turn's `system/init` frame carries the main loop's cwd at the turn's start (it is repeated every turn under MAWS's launch)". Two readers take it ahead of the record: `Composer.tsx` and `composer/frame/bindings.ts`.
  Ruled 2026-11-12: accepted; the item's "Today" is corrected in the spec. This landing keeps the status in front (decision 8).
- Observation: the transcript slot's folder is not a base for file links, as the child's list calls it; its one reader labels a shell call whose input names no folder.
  Evidence: `sessionDirectory` leaves `TranscriptSlot.tsx` through the transcript's context and is read only in `transcript/view/cells/ShellDetail.tsx`; `tools/code/open-file.ts` leaves a relative path relative.
  Ruled 2026-11-12: accepted; the reader's description is corrected in the spec. It moves as Interfaces §B has it.
- Observation: three places show where a session is from `record.directory` alone, outside both of the contract's lists: `composer/frame/bindings.ts` (`status?.cwd ?? record?.directory`, the location chip of a session MAWS runs; its terminal-session twin in `session/controls/lane-a.ts` is on the contract's list), `request-card/RequestCard.tsx` and `sidebar/RequestPreview.tsx` (a request's folder line).
  Evidence: the lines named; for a record whose `directory` lies inside its worktree they show the directory where the selector answers the worktree's root.
  Ruled 2026-11-12: they stay unmoved in this landing, and UC-4 gains them as readers the second landing sorts. `models` in `main/lane-b/remote.ts` stays as well.
- Observation: a session's roots are listed in more places than the contract's second-landing list names (`recordDirectories`, the files allowlist, the endpoint's `rootsOf`).
  Evidence: `rootsFor` in `tools/code/files/tree.ts` (the roots' roles), `underSession` in `tools/artifacts/viewers/model.ts` (whether Open as file is offered), `revealablePath` in `src/services/sessions/record-actions.ts` (what `session.revealPath` may reveal), `occupancyOf` in `src/services/sessions/holders.ts` (which sessions occupy a worktree before it is removed).
  Ruled 2026-11-12: accepted, for the second landing's list. Nothing of it is this landing's.

Found while executing (2026-11-12, the executor):

- Observation: the whole unit suite fails on the VM, on master as on the branch, for reasons of the VM's environment.
  Evidence: on the branch (`d050a640a`) 44 cases fail in 8 files: `apps/desk-hub/test/deploy/{hub-reads,production-scripts,staging-scripts}.test.ts` (38; the deploy scripts reach for a hub, devcloud and a doperpowers checkout the VM does not have), `src/shared/machine/git-reads.test.ts` (2) and `src/services/machine/setup.test.ts` (1) (the VM's git writes a tab where the suites expect a space), `test/artifacts/portability.test.ts` (1, a second lint message), and two 5-second timeouts, `src/renderer/src/sidebar/Sidebar.test.tsx` (785 sessions) and `src/renderer/src/tools/code/viewer/viewer.test.tsx`. The eight files run on master `48619c824` on the VM: `Test Files 6 failed | 4 passed (10)`, `Tests 42 failed | 383 passed (425)`, the same six files and cases; the two timed-out files pass alone on the branch (`Tests 280 passed (280)`). Class 1a on Actions is the record for the whole suite. Logged in the owner's friction tracker (the build VM's unit suite on master).

## Decision Log

1. **2026-11-12 (the author, at writing): the verification call.**
   - This document gets an adversarial review before the executor starts; the architect dispatches it.
   - The branch gets `doperpowers:review-code` at **medium** before it lands, or the **xhigh panel** if the session that keeps master asks for it. It asks at about twenty changed files or a couple of thousand changed lines. Expected here, as revised under entry 2: **29 files** (5 new; 18 with a reader moved; 4 with one comment reworded; the endpoint's suite, with one case added; this document) and about 350 changed lines outside this document, most of them in the three new suites. Each of the 22 existing source files changes at one site and its import, three of them at two sites (`upload.ts`, `services/scm/service.ts`, `TerminalView.tsx`). By files the landing is over that line and by lines far under it, so the choice is that session's to make. One of the files is the endpoint's `targets.ts`, one function of it (decision 7); the architect has told the session that keeps master.
   - Class 1a on GitHub Actions is the gate of record (Constraints, "The gate").
   - The pull request's body names its class 1a run, its review verdict and its residue (what was found and left, with where it is logged).

2. **2026-11-12: the revision after the adversarial review.**
   - Decision: Files' default root leaves this landing. Decision 6 now says why; its row in Interfaces §B, its mention in Concrete Steps and the exception it gave "today's behaviour" in Constraints are gone, and `defaultRoot` is named under "What it does not touch".
     Rationale: the review found two inputs beyond the one this document had declared where a search by the selector's path differs from today's choice by role (a case-folded match on another root; a record that changed before its listing did). The landing's promise is equality, which one pinned case cannot show. Rejected: keeping the move with its differences declared, which this document did at first.
     Date/Author: 2026-11-12, the architect's ruling; written by the author.
   - Decision: decision 7 stands, with its statement of which values answer differently corrected (four shapes, none a valid record, each failing closed) and one of them pinned by a case added to the endpoint's suite.
     Rationale: the review found no change for a valid record and found the earlier sentence ("the one input") incomplete.
     Date/Author: 2026-11-12, the architect's ruling; written by the author.
   - Without a change of decision: the three `record.directory` displays and `main/lane-b/remote.ts` stay unmoved, as they were; the six differences from the spec are recorded as ruled (Surprises & Discoveries); Concrete Steps opens with the merge of master, which has gained the wave's documents since the branch was cut.

3. **2026-11-12 (the executor): means the document left open.**
   - `TranscriptSlot.tsx` calls `useWorkingFolder(appSessionId)` on every render and applies the child-agent rule to its answer (`agentId === undefined ? (folder?.cwd ?? null) : null`). Rationale: a hook cannot be called conditionally; the answer is the same as the old selector's for both kinds of transcript.
   - The endpoint's narrowing is a type guard, `folderReadable(value)`, over the same value `checkoutOf` receives, which is then passed to `workingFolder` as it is (decision 7: the same object, not a rebuilt one). It checks only the fields the selector reads (`directory` a string; `worktree` null, absent, or an object with a string `path`), not `branch`. Rationale: the guard's claim is what the selector needs; the endpoint reads nothing else of the value here.
   - The endpoint's case is its own `it` beside the root-in-no-repository case, not an assertion inside it, so that no existing line of the suite changes (Acceptance 3). It compares the bounds of one plain root with `worktree: {}` against the same with `worktree: null`. Its failure on master's `checkoutOf` was run, not assumed: a scratch branch of master `48619c824` with only this suite's change (`f501fad2e`, branch `ux-wave/U8a-scratch`, deleted after) failed on the VM with `checkoutCovers` received `false`, expected `true`.
   - The tree test gathers every file whose count differs from its exception entry into one list and asserts it `toEqual([])`, with the guidance as the assertion's message, so a failure names every file and count at once.
   - The two header comments reworded under decision 11 (`src/services/scm/service.ts`, `src/shared/ipc/schema/scm.ts`) are rewrapped as their paragraph to the files' width; their other words are unchanged. The removed terminal helper's comment survives as a trailing comment on `shownDirectory`.

## Outcomes & Retrospective

M1 is built and checked on the VM up to the gate (2026-11-12, the executor; the class 1a run, the branch's review and the pull request are the architect's). `workingFolder` and `useWorkingFolder` exist with the contract's shapes; the eighteen readers of Interfaces §B ask them, each passing the record it held before, so each returns what it computed on master; the terminal's `sessionDirectory` is gone; the five comments name the selector; the endpoint's `checkoutOf` reads the selector over the value it narrowed, and its one new case passes here and fails on master's code. The tree test was red with this document's twenty files and 22 spellings, as predicted to the line, and is green with the four exceptions. `FilesTool.tsx` and `tree.ts` are untouched.

Against Acceptance: 1 and 2 shown by the red and green runs (Progress); 3 by the diff (four test files, the endpoint suite `17 0`); 4 by the surfaces' suites passing as they were, and the whole suite failing only where master fails on the VM (Surprises & Discoveries), so 4's "the whole unit suite" waits on class 1a for its record. Not verified here: Electron e2e (the specs are listed under M1, "What it proves") and the macOS-guarded unit cases of `src/services/files/`, which this landing does not change.

What went as planned: the inventory, the recogniser and every count in this document held exactly; nothing in the code contradicted a decision. What cost time: telling the VM's own failures from the branch's in the whole suite.
