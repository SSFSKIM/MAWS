# U6b-5a, the rest of the keyboard: the executor's report

Branch `ux-wave/U6b-5`. The execution document is `docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md` (its Progress, Decision Log 9 to 20, Surprises and Outcomes carry the detail). Written 2026-11-19 (UTC) at the hand-back, as the document's Concrete Steps 7 asks: no `scripts/ci-gate.sh`, no pull request, no Electron e2e from here.

## Status

All five milestones built. Each was reviewed clean at its frontier by a task reviewer (sol, xhigh), after its fix waves: M1 two, M2 three (plus one closing a race the executor named), M3 three, M4 four, M5 two. The branch review (the xhigh panel), class 1a, the Mac runs, the chain's and master's merges and the pull request are the coordinator's.

Range: `026103d78`..the head after `691454588` (the merge of `origin/ux-wave/U6b-3b` at `6ee3382a7` is `74baf7950`; this landing's own work is `74baf7950`..head). Master is not merged (the coordinator's ruling, 2026-11-18).

## Validation evidence (all on the build VM through `vmcheck.sh ux-wave/U6b-5`)

| claim | command | result |
|---|---|---|
| The whole project typechecks | `timeout 2400 pnpm typecheck` | exit 0 at `273ba4be9` |
| Lint | `timeout 1800 pnpm lint` | exit 0 at `273ba4be9` |
| Scenes typecheck | `tsc --noEmit -p tsconfig.e2e.json` | exit 0 at `691454588` |
| The gate's script tests | `node --test .github/scripts/*.test.mjs scripts/*.test.mjs` | 588 of 588 at `2f30d6210` |
| Machine coverage | `pnpm exec vitest run src/shared/machine` | 12 of 13 files; `git-reads.test.ts`, 2 cases, board ticket 756 (the brief's list) |
| The whole unit suite, once | `timeout 3600 pnpm test` at `4c097a617` | 20 files failed. On the brief's lists: the desk hub's three, `git-reads` and `setup` (ticket 756), `portability` (VM Node), `org/rows`, the deck's 500-slide case, `Sidebar`, `channel-feed`, `read-open`. Not on the lists, each a 5 s timeout under load that passes alone: `engine-host/conformance/json-wire`, `tools/code/review/stack-place`, `DesignWorkbench.dom`, `comments.dom`, `DocumentEditor.dom` (none in this diff; not shown failing at the base). This landing's: `transcript/view/rows/AnswerActions.test.tsx`, fixed in `ff372b52e` |
| After the fix, the touched directories | vitest over `tools/terminal`, `terminal`, `transcript/view/rows`, `composer`, the tokens guard | 139 files, 2,375 tests at `2f30d6210` |
| Desk-web, which imports the composer, the controller and `TerminalView.tsx` transitively | its typecheck, build and tests | exit 0, exit 0 (the chunk-size warning only), 801 of 801 at `2f30d6210` |
| The focus handler's late-restore order | vitest `src/renderer/src/app` plus the tokens guard | 40 files, 454 tests at `691454588` |

Each milestone's own proof set (Concrete Steps 4) is in its task report under `.doperpowers/sde/2026-11-17-ux-wave-U6b-5-rest-of-keyboard/` (gitignored).

Not verified: the whole suite after `ff372b52e` (one run per landing; the targeted set passes); every scene (the Mac's); the owner's hands (⇧⌘L against Services, the Korean input source) and ears (VoiceOver on ⇧Tab); class 1a.

## Scenes to run on a Mac

New or reworked, alone first, then each group whole: `e2e` and `e2e:layout` (`ux2-shell.spec.ts`: U6a's show-and-hide with the keyboard, the Edit and Go menus and the sheet, and U6b-5's Back and Forward; `shell.spec.ts`: Item 8, "a page beside the sidebar" with Forward after Back and after Esc, and "The Overview over a page" unedited, which pins P5; `palette.spec.ts`: the two reveal cases and "an artifact found by its title opens beside the chat"), `e2e:terminal` (the two Attach scenes, each launching the product itself), `e2e:composer` (⇧Tab says the mode), `e2e:lane-a` (nothing said on a terminal session), `e2e:code` (⌘[ and ⌘] in a file), `e2e:widgets` (the plugin's detail), `e2e:settings` (three rows with no control). The readers most likely to need adjusting on the Mac: the menu's separator shape, xterm keeping a selection on a right click, the stub session's box name, cmdk's group name for Recent, the indexed session's title in "Added to …", the side column's locator once hidden, xterm's textarea as the focused element, the shell evaluating `$((40 + 2))`. Back and Forward over the Overview and a split rest on a sync-lane commit that only Electron confirms (DL 11 (viii)).

## Decisions that reached the coordinator, all accepted

Decision Log 10 (Files answers only its key's request; B9 corrected for a terminal session; the keyboard returns a frame later), 12 (the Library opens as it stands on a step), 13 (iii) (`saveDraft` returns its port's answer, a named insertion in U4's file), 14 (six S1 findings fixed, S1's table revised), 15 (viii) and (ix) (the palette's selection follows the first row until the person moves it; Next and Previous tab leave ⌘K), 16 (iv) (route hints to a tracker row). For the pull request's "what a person will see change", the coordinator asked that both items of DL 15 be named.

## Confusions

None that the document did not settle. One environmental note: twice a `git pull` in this worktree failed on another session's lock (`MERGE_RR.lock` in the shared `.git/worktrees/ux-wave-U6b-5/`); a retry passed.

## Unresolved review findings

- **VM test noise, inherited:** stderr from the sidebar's `act()` warnings, one `TypeError` in `Shell.drag-edge.test.tsx`, thirty terminal-token lines in `App.test.tsx`, and desk-web's chunk-size warning. Each reproduced at the base by its executor; left.
- **`e2e/shell.spec.ts` Item 8** checks the enabled set for menu rows only; renderer rows of scope `app` get a structural check, and Recent's cap, order and the Library row are unit proof. Left to the unit suite.
- **The lane A step's positive control** is the composer scene of B9, not in the same test: nothing can produce the sentence on a terminal session (DL 10 (ix), DL 20 (vi)).
- **The widgets step** asserts `defaultPrevented` on ⌘[ as the harness's stand-in for "the tab in front is unchanged"; the place itself is the Mac's to check (DL 20 (v)).
- **The cycle's mechanism** behind `AnswerActions.test.tsx` (vitest's module runner) is a supported guess, not proven; `App.tsx` still imports `tools/terminal/attach.ts` statically, so the fix removes one static edge from that path and proves nothing about a production chunk.

## Residue

Each is also a row in `docs/tech-debt-tracker.md` (dated 2026-11-18) unless noted.

- **A late claim after a clear** (S1, "Left over"): a write in the claim form whose answer was lost can land after a later clear and put the block back; the hand-over then said `unconfirmed` or `added`. Needs this Mac's daemon to answer late by more than a clear.
- **Review answers no focus request** (P1): shown by its key it lands on F6's stop; its own answer belongs in U5's `ReviewShell.tsx`.
- **The side column's host asks for the keyboard on every open of a tab**, and Terminal and a mod's pane answer, so an agent's show of either takes the keyboard from the person (existing behaviour; `panel/host.ts`).
- **`library.list` answers publish artifact routes before the palette can drop a stale one** (DL 16 (iv)): a late answer for an id two machines share can redirect a later plain click on a link. The route table is `artifacts/machines.ts`, fed from `ipc/client.ts`.
- **`ipc/client.ts` passes a rejected `bridge().invoke` through** to callers that must say an outcome (DL 17 (vi)); the hand-over catches it, others do not.
- **An attached block's label** is a paste's ("Pasted text #1"); naming its terminal waits for ticket 733's design. **A block's text in a `/btw` question** is unframed; the rule is ticket 733b's.
- **Five unit files time out under load and pass alone**, not on the build brief's list (`json-wire`, `stack-place`, `DesignWorkbench.dom`, `comments.dom`, `DocumentEditor.dom`): for the brief's list, not a tracker row.

## The branch panel's fix wave (2026-11-19)

The coordinator's xhigh panel (`6ee3382a7..93b14470e`) returned "incorrect" with 21 findings. Ruled into six groups by mechanism. Each group was built red first, by the executor of its milestone. G3, G4 and G5 were built on branches of their own and merged at `a80e44303`, `92b747d2b` and `489ebfd93`. The rules are Decision Log 21 of the document.

- **G1, the draft's integrity** (`e0310f01d`, `5f7847a6f`, `1d3d4a847`). A draft read that fails is `UNREAD`, not "no draft", so an attach writes nothing into a box that could not read its draft. A failed immediate save leaves the pending write to the writer. Over the link, "Added" waits for the machine to take the save. A box that left after a refused save is not said to hold the block. The take-back hold is read at once.
- **G2, the keyboard after the restore wait.** The box checks again whether it can take the keyboard. If it cannot, the block is saved at the end and the line is shown.
- **G3, a surface's keyboard** (`99575b7b7`..`9d3ffb10d`). There is one hand-over at a time in `SurfaceRow.tsx`. A newer key act, any newer host request, or the person's press ends it, and nothing it scheduled runs afterwards. The side column's menus keep it while it lasts.
- **G4, history and the Overview** (`b7a16206f`..`5fd7abd52`). A change is classified before closed tabs are pruned. A step names its tab as the Overview's opener, and a step to a tab reveals the main area. One insertion is made in U13's `OverviewPanel.tsx`: `returnOverviewFocusTo`.
- **G5, the palette** (`a32814b6f`..`939107180`). `surface.*` rows run after the palette closes. The selection is always a drawn row, with a fallback to the first. A row the palette picks by itself is scrolled into view.
- **G6, the screen's text** (in `e0310f01d`). xterm's padding cell before a wrapped wide character is dropped, so `abcd界ef` reads `abcd界ef`. The cases include Hangul.
- **Not fixed here.** scalpel-4#5 and scalpel-5#3 are tracker rows (`3cd603bb8`). scalpel-5#2 is board ticket 783 (`f18093691`): artifacts are keyed by id alone in U10's files, the same cause as Decision Log 16 (iv).

Evidence:
- On the build VM at `489ebfd93`, the merged head: the web and e2e typechecks and eslint on every changed file exit 0. vitest over `panel`, `tools/code/files`, `keymap`, `overview`, `palette`, `composer`, `terminal`, `tools/terminal`, `lane-b`, `stores`, `app`, `transcript/view/rows` and the tokens guard: 295 files, 5,224 tests passed.
- At `1d3d4a847`, the whole `pnpm typecheck` exits 0. `test/lane-b`, `lane-b` and `composer` pass: 101 files, 1,797 tests.
- Class 1a, label `u6b5a-fix`. Run 44509654976 at `632dcbf43` was a failure: `pnpm typecheck` stopped on `tsconfig.node.json` not listing the new `unread.ts`, and on a test type, both fixed in `1d3d4a847`. Run **44513116221** at `1d3d4a847` was a **success**: static, unit 1 to 4, probes and e2e:cross-build.
- Desk-web, label `u6b5a-fix-dw`: run **44509682501** at `632dcbf43` was a **success**. `1d3d4a847` changes only `tsconfig.node.json` and `test/lane-b/drafts-enumerated.test.ts`, neither in desk-web's closure, so it was not run again.

New load timeouts seen in the group runs, which pass alone: `CommandPalette.test.tsx` "bounds mounted results for 3,279 sessions" (5.4 s), and desk-web's `hub/project-client.test.ts` once (it is on the brief's list).

## The delta review's fix wave (2026-11-19)

The coordinator's delta review (`93b14470e..6f2184934`) returned "incorrect", with 1 P1 and 8 P2. The coordinator ruled eight into one wave, red first, and sent one to the tracker. H1 to H4 and H7 were built by M2's executor on this branch (`b82bd375c`, `df8909643`, `26699a062`). H5 was built by M3's executor and H6 by M4's, each on a branch of its own; both were merged at `2fec3e141`. The rules are in Decision Log 21 of the document (`4833759ef` for H1's rule, `b7aa90334` for the rest).

- **H1, the remote save's acknowledgment** (P1 and P2). A round says `added` only when the store's own document holds the block. Over the link, the window's newest queued draft must hold it too. The queued draft is the document to keep, not proof that it was saved. Each ordinary queued save is answered by a write of its own draft, and a save passed over by a newer one answers false. An attach's immediate save no longer goes through the merging queue. It goes through the new `saveRemoteDraftNow` (`DraftPort.saveNow?`), which is answered by its own write alone.
- **H2.** A bridge that throws is a failed write. The save answers false, `out` is cleared, and the queue goes on.
- **H3.** The controller records per mount that one of its own saves was taken. A restore that answers `UNREAD` afterwards does not set the box unread again.
- **H4.** Where the keyboard was is sampled as the attach begins, before any wait for a first send. The check after the restore uses that sample (`FocusTarget.attachPasted` gains `atPress`).
- **H5.** Below 700 px, a step to a tab also folds a side sheet that covers the main area. It uses the store act under `dismissSheet` and keeps the sheet's tabs. `dismissSheet` itself is not called, because its frame would hand the keyboard back to its opener and compete with the step.
- **H6.** The palette's selection is always a drawn row, and there is no selection when no row is drawn. ⌘⏎ splits only on a drawn row.
- **H7.** xterm's blank last cell is dropped only before a wide continuation, so `abcdeX` with `e` erased reads `abcd X`.
- **Finding 6 is not fixed here.** It is a tracker row (`4833759ef`): SurfaceRow's cancel does not reach a tool's own consumers of focus.

**An edit in U4's file.** `useDraftPort` in `Composer.tsx` gains one forwarding member, `saveNow`, so that H1's attach save can reach the machine by its own write. Decision 9 kept `useDraftPort` unedited for the sake of `load`, which is untouched. Even so, this is an insertion in U4's file.

Evidence:
- Red, at `b82bd375c` for H1 to H4 and H7: 7 failed and 131 passed, one failure per finding as the cases expected. Red at `9e506f613` for H5: the sheet stayed open after Back at 600 px. Red at `5931034aa` for H6: both cases split the stale session, so two panes opened where one was expected.
- On the build VM at the merged head (`2fec3e141`, with `b7aa90334` as docs only): the whole `pnpm typecheck` (node, web, e2e, desk-hub, desk-web, org-protocol) exits 0. eslint on every `.ts`/`.tsx` changed since `6f2184934` exits 0.
- vitest over `keymap`, `panel`, `palette`, `composer`, `lane-b`, `test/lane-b`, `terminal`, `tools/terminal`, `app`, `overview`, `src/main` and the tokens guard ran 496 files: 8,001 tests passed, 58 were skipped and 1 failed. The failure was `src/main/org/rows.test.ts` "the marks > drop only when…", at the 5 s default. That file is unchanged on this branch. Run alone it passes 36/36, with the VM's load at 19.
- Earlier, at `26699a062`, desk-web's build passed and its tests passed 801/801.
- Class 1a, label `u6b5a-fix2`, at `b7aa90334`: run **44605466327**, **success**.
- Desk-web, label `u6b5a-fix2-dw`, at `b7aa90334`: run **44605459608**, **success**. The composer is in desk-web's import closure.

New load timeouts seen: `src/main/org/rows.test.ts` (above). H5's executor also saw six timeouts at the 5 s default while the VM's load was 17 to 50. None of those six takes a step, four of the files pass alone, and `session-navigation.test.ts`'s ⌘⇧T case passes in 7.8 s with a 60 s timeout.
