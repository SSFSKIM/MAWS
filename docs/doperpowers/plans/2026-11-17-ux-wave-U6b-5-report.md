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
