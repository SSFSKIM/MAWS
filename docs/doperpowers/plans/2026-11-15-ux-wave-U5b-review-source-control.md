# UX wave · U5b: Review as one scroll with comments on its lines; the branch, a commit, and Source control as a page to read (2026-11-15)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave, a composite), child **U5**, the child's second pull request (**U5b** in the root's "Ordering and dependency map"; board ticket 590). **Parent pin:** master `93905c9effbda94ead21518439800f8bcbd72d24`, which holds the spec through its batch 8 and every landing this one stands on.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U5-review-comments-source-control.md`: acceptance A6 to A14 and A19, the items l5-code-05, X-072, l5-code-03, l5-code-04, l5-code-12, l5-code-01 and l5-code-06, the Review rows of "UC-5 · One comment card", "UC-7 (consumed)", "Rulings reversed" and "Probes and checks" P2, P5 and P8. Where that file and a contract's statement in the root differ, the root binds. This document carries the constraints and the milestones, and of the design only what the child's file leaves open or what the code at the pin contradicts ("Reported to the architect").
> **Binding on this landing:** UC-5 (owned), UC-4 (the working folder, consumed), UC-7 (an act works on another machine or says why not), UC-8 (who owns which files), UC-10, UC-11, UC-14 (what is stored or sent, the builds on the owner's machines can still read); laws 1, 3, 4, 5, 7 and 8.
> **Branch:** `ux-wave/U5b`, from the parent pin. **Written against** that commit. **The builds that bind** (UC-14 as the wave runs it now): master `2c7044231`, which the owner's machines run, and `f1852de3a` (build F), which they keep to go back to. Whatever this landing stores or sends is stated against both (Interfaces §K).
> **Two pull requests** ("The landing's edge" says why): **U5b-1**, the stacked Review with line comments (milestones M1 to M6), and **U5b-2**, the branch, a commit, and Source control as a page (M7 to M12). Each leaves master releasable; the second is built on the first.

## Purpose

Today Review shows one file at a time under a list, has no way to say anything about a line, and loses its place when the window changes size. Its "This branch" compares a worktree with whatever the main checkout happens to have checked out, is switched off for a session in the main checkout, and leaves out uncommitted and new files. Source control is a pane for doing by hand what the agent does anyway (stage, discard, commit, push, open a pull request), and it never says which commits the branch holds, which of them are pushed, or which check of the pull request failed.

After this landing the owner reads an agent's whole change in one scroll: every changed file is a section with a header that stays at the top while its diff is under it, and a section folds. Pointing at a line shows an add-comment button; the comment is written in the wave's one comment card under that line, starts as "Send to main", and several comments go to the agent as one message that quotes each line. Review comes back to the file and line it was left at. "This branch" means one thing for every session: the working tree, new files included, against the merge base with the repository's default branch. Source control is a page that is read and changes nothing: where the work is, what is uncommitted, the branch's commits under "Not pushed" and "Pushed to …", and the pull request with its title, its state, whether it can merge and its checks by name. A commit's row opens that commit in Review, where it is read and commented on like any other change. The window no longer stages, discards, commits, pushes or opens a pull request.

How to see it working, on the wave's build: in a session whose agent changed several files and made a few commits, open Review and scroll through all of it without a click; comment on two lines, see "Send 2 comments", send, and find one message with two chips and the two quoted lines in the transcript; show another side surface, resize the window and come back to the same line. Open Source control: the four parts, in order; click a commit's row and read that commit in Review under a chip "Commit a1b2c3d"; click "This branch" and see the whole branch, the uncommitted edit and the new file included. Do the same for a terminal session on this Mac and for a session on another machine. In the suites: the unit tests named under each milestone and the e2e scenes of M6 and M12.

## Progress

- [x] (2026-11-15) Document written against master `93905c9ef`; the child's statements about the code checked ("What the code holds today"); seven points reported to the architect with their defaults ("Reported to the architect").
- [ ] The adversarial review of this document, and the architect's rulings on R1 to R7.
- [ ] The owner's look at the drawn example of the stacked Review and its line comment, and the answers to the cards ("For the owner").
- [ ] M1 — What a line comment says
- [ ] M2 — The stack's model
- [ ] M3 — The stack drawn
- [ ] M4 — The band, the place and the hunk counter
- [ ] M5 — Comments on lines
- [ ] M6 — U5b-1's scenes, record and acceptance
- [ ] U5b-1: the branch review, class 1a, the Mac runs, the owner's look at the stacked Review on a real change, the pull request (the architect).
- [ ] M7 — The three reads on a machine
- [ ] M8 — The reads over the machine link
- [ ] M9 — A side thread for a session on another machine
- [ ] M10 — "This branch", new files counted, and a commit in Review
- [ ] M11 — Source control's page
- [ ] M12 — The acting pane leaves; U5b-2's scenes, record and acceptance
- [ ] U5b-2: the branch review, class 1a, the Mac runs, the two cross-build runs, P5 and P8, the owner's sitting on the page, the pull request (the architect).
## What this document assumes about landings in flight

One list, checked again by the controller at each merge of master (Concrete Steps 1), so that either side can land first. Each row names what is assumed, what to look at once the other landing is on master, and who yields.

| landing (branch, head read on 2026-11-15) | what this document assumes | check again when it is on master |
|---|---|---|
| **U6b-1** (`origin/ux-wave/U6b`, `9401434e9`): a file opens beside the chat | `openFile(appSessionId, path, line?, options?)` in `tools/code/open-file.ts` keeps its first three parameters. This landing calls it with those three and reads nothing of what it returns, so "Open file ↗" follows wherever U6b-1 opens a file (a Files tab shown in Review's place, Review's tab staying in the strip). U6b-1 edits `tools/code/review/review.test.tsx` and `tools/scm/ScmShell.test.tsx` (its "Open file" cases), `panel/host.ts` and `panel/tool.ts` (`PanelTool.reuse?`), and appends one row and one scene block at the end of `e2e/cross-build.spec.ts`. It takes no wire minor. | M3 rewrites `review.test.tsx` and M11 rewrites `ScmShell.test.tsx`: U6b-1's "Open file" expectation (a side Files tab, no main file tab) is carried into the rewritten case, whichever lands second. `e2e/cross-build.spec.ts`: both append at the same two places; keep both blocks. |
| **U6e** (`origin/ux-wave/U6e`, `3adeb9a81`): files outside a session's folders editable, Open File… | It takes a wire minor (its branch says 47, which master's U11g holds, so it renumbers). It plans edits in `tools/code/copy.ts` (U6's strings beside `REVIEW_COPY`), `tools/code/open-file.ts` and `e2e/remote.spec.ts` (added assertions). It touches nothing under `tools/code/review/` or `tools/scm/`. | M7's wire minor is the next free number after master's at the merge (Concrete Steps 3); `copy.ts` merges by hunk (`REVIEW_COPY` is this landing's, the editor's and the files' objects are U6's); in `e2e/remote.spec.ts` keep U6e's assertions beside M12's rewritten Source control steps. |
| **U1b** (`origin/ux-wave/U1b`, `c6ff890e4`): requests drawn in the transcript | Its edits in `transcript/model/rows.ts`, `schema.ts` and `derive.ts` are on the `plan`, `question` and `ask` rows and do not touch the user row, `user-text.ts` or `view/rows/User.tsx`. This landing edits none of those files (a quoted line is part of a comment's words and is drawn by today's markdown). The card column gains "Waiting for you"; this landing draws nothing in the card column. | Nothing, unless this landing's executor finds it must touch the transcript after all: then UC-3's order binds and it is reported first. |
| **U2b** (`origin/ux-wave/U2b`, `df243c8d4`): the to-human view | No shared file: `owner/` and the transcript's fold. A comment sent from Review is a user message like any other, and the mod's view or MAWS's mirror draws it by the rule of its landing. | Nothing. |
| **U11c** (`origin/ux-wave/U11c`, `fb695b983`): Customize | No shared file. | Nothing. |

Also assumed of what is on master and may still move: `e2e/cross-build.spec.ts` is appended to by every landing that stores something (the coverage table is the comment block under "U13a: what the wave stores"; the scenes are appended at the end of the file); the wire minor on master is 47 (`src/shared/ipc/wire.ts`); the link's protocol is 1.14 (`RL2_PROTOCOL`, `apps/org-protocol/src/channel.ts`).
## The landing's edge

**In.** The child's second pull request: l5-code-05 (the stack), X-072 (the place Review returns to), l5-code-12 (four small slips), l5-code-01 (comments on lines), l5-code-03 ("This branch" against the default branch), l5-code-04 (new files counted), l5-code-06 (Source control as a page; a commit in Review; nothing by hand), UC-7's two insertions in U9's files (the reads' offers and the side thread's), A19's guard, and the dated amendments of the rulings these reverse. Acceptance A6 to A14 and A19.

**Two pull requests, and why.** The ticket leaves one cut to this document: whether l5-code-06 rides with the stack or follows it. It follows, as a pull request of its own, and takes l5-code-03 and l5-code-04 with it, because the three share their reads. The reasons are in the code:

1. *The two halves meet at five named points and nowhere else.* Review's scope and its one parameter (`ReviewUi`, `ReviewParams`); which command reads a held diff (`HeldDiffSpec`); the place of an unsent comment (which gains the commit); the request that opens Review; and `ReviewView`, which `tools/scm/ScmDiff.tsx` imports today. The first half leaves `ReviewView.tsx` untouched and builds the stack's section body beside it, so the acting pane keeps drawing its diff until the second half deletes both. Nothing else of `tools/scm/` reads Review's view.
2. *They are proven differently.* The first half is the window alone: the renderer, the comment card and the text of a comment. It adds no command, changes no command's input and stores nothing, so it takes no wire minor and no cross-build wire run. The second half crosses the git service, the wire, the endpoint's offers and the machine link, takes one wire minor and one step of the link's protocol, and owes two cross-build runs. One reviewer cannot hold both in one pass: together they are about 19,400 changed lines (rewritten and deleted files counted) in about 155 files ("Size and review").
3. *Every read this landing adds lands in one step.* The branch read, the commit read and the working-tree read (R1) sit behind one capability and one wire minor; a comment that names a commit can then only be made where the machine served that commit's diff, which is a machine that knows the anchor's new field (Interfaces §K). Cutting inside the second half would split that guarantee.
4. *Master is releasable between them.* After U5b-1: Review is the stack with line comments; "This branch" and the untracked rows are as today; Source control acts as today. Nothing is half-moved.
5. *The owner's two looks map one to one:* the stacked Review on a real change before U5b-1 lands, the sitting on the page before U5b-2 lands. The architect may hold both on U5b-2's build instead; the cut does not force two sittings.

What lost: one pull request (a review of a size nobody reads whole, with the stack held behind the endpoint's review); three (l5-code-03 and -04 before -06: they would take a wire minor and a capability of their own for one read that the third would then extend).

| pull request | items | acceptance | milestones |
|---|---|---|---|
| **U5b-1** (ticket 590) | l5-code-05, X-072, l5-code-12 (a) to (c), l5-code-01 without the commit | A6 (but for its sentence on a commit), A7 to A10, A13 (a) to (c) | M1 to M6 |
| **U5b-2** (a ticket the architect registers) | l5-code-03, l5-code-04, l5-code-06, l5-code-12 (d), the commit in a comment, UC-7's two insertions, A19's guard | A6's commit sentence, A11, A12, A13 (d), A14 (S1 to S22), A19 | M7 to M12 |

**Not built by either** (the child's "Not included", unchanged): l5-code-02's buttons; a comment on a range of lines; comments posted to GitHub; expanders for unchanged lines; a file rail; merging or closing from MAWS; a report from the watcher when the base ref moves; removing the ten `scm.*` commands and `scm.remote.output` from the services and the wire (they stay served for a window of an older build; a tracker row holds their removal for the next wire major); O-46, which waits for U14's reproduction.
## What the code holds today

The child's statements, read against master `93905c9ef`. Lines move; functions are named.

**They hold as written.** Review is a file list (at most 40 % of the height) above one file's diff, with the mode toggles, the hunk counter and the previous and next file buttons belonging to that one file (`ReviewShell.tsx`: `FileList`, `FileSection`). `ReviewView.tsx` is the vertical scroller of one file, assigns the saved `scrollTop` once at mount and draws `DiffView` with no widget. The base of "This branch" is `git.worktree.branch`'s `base`, the main checkout's branch (`lookupBase` in `review-store.ts`; `branch()` and `baseOf` in `src/services/git/worktrees.ts`), so the chip is off for a session in the main checkout (`REVIEW_COPY.mainWorktreeBranch`). An untracked file is a row with zero counts, listed under Uncommitted only (`gitScopeFiles`), drawn as added when selected through `git.diff`'s `untracked` scope (`FileSection`, `loadFile`). Last turn lists absolute paths (`turnScopeFiles`); the file header is one truncating span (`REVIEW_COPY.fileHeader`); the "Last turn" chip is drawn only while `turnId` is set (`ScopeChips`). A held diff re-reads 250 ms after a new status and when the tool is shown again (`statusChanged`, `HELD_DIFF_REFRESH_MS`; the effect on `visible` in `ReviewShell`); a failed scope or file is kept until the scope re-reads (`createHeldDiffs`). The watcher drops a move of a remote-tracking ref that is not the status's upstream and emits only when the status's projection moved (`refMatters` and the emit in `src/services/git/watcher.ts`). `readPrView` answers a remote that is not on GitHub with the first line of `gh`'s stderr as the error, where `planPr` maps the same failure to `no_remote` (`src/services/scm/pr-state.ts`, `plans.ts`). Source control is the acting pane the child describes (`ScmShell.tsx`), `ScmDiff.tsx` is the one importer of `ReviewView` outside Review's folder, and `git.status.isWorktree` has no reader in the renderer. A daemon reads a command's input with the tolerant reader, also inside a union's matched member (`src/shared/ipc/tolerant.ts`; `tolerant.test.ts`, "follows a discriminated union into the branch that matches"), and answers a name it does not know `unknown_command` (`src/mawsd/front.ts`).

**They no longer hold, or hold differently.**

| the child says | the code at the pin | what follows |
|---|---|---|
| A19: Review and Source control read the folder through U8's selector, and a rule keeps it so | Already so: `ReviewTool.tsx`, `DiffTab.tsx`, `ReviewSummary.tsx` and `ScmTool.tsx` read `workingFolder` or `useWorkingFolder`, and `test/one-working-folder.test.ts` fails on any file under `src/` that spells the folder itself. U8c-2's live folder is on master: `workingFolder(record).path` is the agent's checkout for a session MAWS runs, a terminal session on this Mac and a session MAWS runs on another machine; a terminal session on another machine has no record. A change of folder starts Review over there (`forSession`), and Source control draws no act while the agent is away from the launch folder (`acts={!folder.moved}`). | Nothing to build for A19 but that the new files keep to the selector (the existing test holds them). M11 removes `acts`: the page has no act, as U8c's own decision 6 foresaw for this landing. |
| "This branch" becomes the working tree, new files included, against the merge base; "the scope's read returns added-line counts for untracked text files" (l5-code-03, -04) | No read does either. `git.diff` with a `base` runs `<base>...HEAD`, the committed change alone; its other scopes diff against `HEAD` or the index; none lists an untracked file. The child's two new reads are a branch's commits and one commit's diff. | **R1**: a third read. |
| "A machine that lists no capability is sent neither read (a test on the device's half)" | Main checks `REMOTE_NEEDS` only inside the lane B adapter's `run`, for names the adapter handles (`src/main/lane-b/remote.ts`). A `git.*` read is not one: it goes from `routeLaneB` to the link's dispatch with no capability check. | M8 holds a path command that has a `REMOTE_NEEDS` entry in `routeLaneB`, before the round trip (decision 14). |
| The side thread's offer is "a fork with the thread's lineage … under Fork's authorisation" | `session.fork`'s handler branches on the caller's origin and, for another machine, checks the fork's ceiling and waits for the launch (`forkFromAnotherMachine`). `side.thread.open`'s handler does not look at the origin: `openSideThread` calls `forkIntentOf`, `putIntent` and `startFork` directly. Offered as it stands, a caller on another machine would start a fork at the source's permission mode with no ceiling check. | M9 gives the side thread its own branch for another machine, with the ceiling check on that path (decision 16; "Routes"). |
| `side.thread.open` "takes the pass's comments" for a session on another machine | Its `comment` member carries `screenshot` (and `more[i].screenshot`), a file path the machine side reads under `<userData>` and the session's roots (`src/services/side/content.ts`). A path from another machine's caller must not reach that read. | M9's offer row accepts only a null screenshot, on the comment and on every `more` (decision 16). |
| `side.thread.open` also opens a `/btw` promotion ("Continue as a side thread") | True, and its button is disabled for a session on another machine by the same `REMOTE_UNAVAILABLE` row this landing removes. | **R4**: the offer covers both kinds. |
| The Environment card's change line and Source control's Uncommitted line "never disagree" (S7) | They do not: both are `changeLine`. But `changeLine` leaves untracked lines out of its sums, and after l5-code-04 Review's totals count them. | **R3**. |
| "Every two minutes `scm.pr.state` reads … `mergeStateStatus` and every check with its name and link" | True; the schema is `ScmPrState` (`pr.title`, `baseRefName`, `mergeStateStatus`, `checks.items[]` with `name`, `bucket`, `state`, `link`). There is no string that names one check today: `checksText` in `pr-line.ts` counts buckets. | M11 adds the rows; the counts line reuses the card's words. |
| `review.test.tsx` is 1,153 lines | 1,237 lines, 59 cases; `harness/code/codeProbes.ts` and `api.ts` (the e2e harness of `e2e:code`) read Review's file list and buttons too. | M3 rewrites the harness probes with the suite. |
| P5 and P8 are owed before parts of l5-code-06 are fixed | Neither has run (no findings file under `spikes/protocol-probe/`). | "Probes": both are the architect's to arrange; the defaults are written. |
## Reported to the architect

Where the code contradicts the child's file, or a choice would change what the owner sees beyond its words. Each has the evidence, the default this document is written at, and the one place a different ruling changes.

**R1 · "This branch" and the count of new files need a third read.** The child defines "This branch" as the working tree, new files included, against the merge base (l5-code-03), has "the scope's read" return the added lines of untracked files (l5-code-04), and adds two reads: a branch's commits and one commit's diff. No read, old or new, diffs the working tree against a commit: `GitService.diff` with a `base` runs `<base>...HEAD`, which leaves the uncommitted change out; its other scopes diff against `HEAD` or the index; none lists an untracked file (`src/services/git/service.ts`). A committed range and an uncommitted diff cannot be joined into one diff in the window (a file changed in both has hunks numbered against different versions). `git.diff` cannot gain a field for it, by the child's own reason for two new commands: an older daemon's tolerant reader would drop the field and answer something else. Claude Desktop reads exactly this, in its main process: `git diff <merge base>` to the working tree, and the first 200 untracked files read and counted, 1 MiB each, a NUL byte meaning binary (`readable/app-5.1231.2/main-process/index.chunk-CgUL8Fja.js:743-785`, `:849-899`, `:416-563`). *Default:* a third command, `git.changesSince`, under the same grade, the same checkout rule and the same one capability; it also serves Uncommitted, so that new files are counted there. *What it touches beyond the child's words:* UC-7's sentence and UC-8's row name "two reads" and "two rows"; they would read three. *One place:* Interfaces §C, "git.changesSince", and the table of §E. Ruled out, the acceptance lines A11 and A12 cannot be met as written.

**R2 · On a machine that does not serve the reads, "This branch" is off.** A window of this build can face an older daemon on this Mac (`watchDaemon` leaves another bundle's daemon running) and an older machine over the link. There the base and the working-tree diff cannot be read. *Default:* the chip is disabled with "This branch needs a newer MAWS on `<machine>`" (S9's "older" case, said of a scope); Uncommitted is read as today, its new files listed without a count; Staged and Last turn are untouched. *Lost:* falling back to today's base (the main checkout's branch, committed changes only), because one chip would then mean two things by machine. *One place:* the table of §E, its last column. The cost is real: "This branch" works on such a pairing today and stops until that daemon is updated.

**R3 · After new files are counted, Review's totals and the card's sums differ.** The Environment card's change line and Source control's Uncommitted line are both `changeLine` (`panel/summary/derive.ts`), whose sums leave untracked lines out, by its own comment. Review's totals count them from M10 (A12). "Review ›" on "Uncommitted 3 · +48 −12" then opens a Review whose totals read "+60 −12". *Default:* as the child says, the card is not changed and S7 compares the card with the page; the difference is named in the pull request and gets a tracker row (the card's sum taking the counted lines is U8's row). *One place:* §H, the Uncommitted part's source.

**R4 · The side thread's offer also enables `/btw`'s "Continue as a side thread" on another machine.** `side.thread.open` carries two kinds, a comment's thread and a `/btw` promotion, and one `REMOTE_UNAVAILABLE` row disables both controls today (`e2e/remote.spec.ts` asserts the promotion's button disabled with that row's words). A command cannot be declared and offered at once (`test/lane-b/offer-coverage.test.ts`). *Default:* the offer's `accepts` takes both kinds; the promotion carries text alone, and is under the same owners' rule and ceiling. U4's `/btw` card changes in behaviour and in no file. *One place:* `isRemoteSideThread`, §D.

**R5 · Two pull requests, a second ticket, and where M9 rides.** "The landing's edge" cuts U5b in two; the second needs a board ticket. M9 (the side thread over the link) shares nothing with Review or the page but the link's protocol step, is the one milestone that lets a caller on another machine start a session, and could land alone under a review of its own. *Default:* U5b-1 and U5b-2, with M9 inside U5b-2 after M8. *One place:* the table at the end of "The landing's edge".

**R6 · "Before the change" is a line of the comment, not a part of the lead.** U5a's table words it "the lead's 'before the change'". A lead that changes for `side: 'old'` no longer equals the lead either older build regenerates, so on both the lead would stay in the bubble as text, and on `2c7044231` a message of several comments with one removed line would fail its framed reading whole. *Default:* the lead and the tag are unchanged; the comment's words open with the line "Before the change:" above the quoted line, which the person also reads in the transcript. A comment on a commit's old side does change the lead, as the child prescribes; no older build can read its tag in any case. *One place:* §A, `quotedComment`.

**R7 · U5b-1 owes no cross-build run, as written.** It takes no wire minor and stores nothing; the one persisted thing it touches is a comment's text, which both builds read as their own (§K). *Default:* no run. If the architect reads the quoted line as a stored form, the scene is §K's third one without the commit (a transcript holding a Review comment on a removed line; the peer draws its chip and the quote), run in the equal-wire mode against `2c7044231`. *One place:* the paragraph under §K's table.

**What the child's file says of Claude Desktop that the source words differently** (for the architect's record; none changes the design): "Changed files" is the file tree's accessible name, and the visible control reads "Show files" and "Hide files" (`readable/app-5.1231.2/web/app/v1/c44d00c7f-CP6SmyJb.js:11727`, `:15383-15403`); Desktop folds a large diff by changed lines (over 20,000, or 5,000 in a popout), not by bytes (`:14818-14847`); its Enter saves a diff comment and moves the keyboard to the composer, and ⌘Enter saves and submits the composer (`web/app/v1/cb39f8c62-h3Gl6FTr.js:1067-1076`); a comment on an old-side line reads "(before changes)" and a comment made on one commit's diff does not name the commit (`web/app/v1/c9543da06-DAeewRbi.js:2010-2072`); "the newest 50" commits is a limit of its window, the read itself is unbounded and ranges from the base, not the merge base (`main-process/heavy-work-worker/heavyWorkWorker.js:22649-22704`); its checks are one row a check with passed and skipped folded together, and a pending check is called "running" (`web/app/v1/ca9ee6f68-D-vPLWtv.js:4486-4775`); nothing in it restores the diff's scroll position (`c44d00c7f-CP6SmyJb.js:15249-15262`), so X-072 has no model there.
## For the owner: what to draw before it is built, and the choices the words do not settle

**The stacked Review has never been drawn at its real sizes.** The owner answered on a drawn example of Source control, whose frames 8 and 10 sketch a stack at 600 px. The side column is 280 px at its narrowest, 360 px for a narrow tool, and for Review 60 % of the room (about 720 px in a 1,440 px window). Two parts of the child's design are single lines that cannot hold their content at the narrow widths (cards 1 and 2), which is the kind of fault two earlier examples of this wave found only once drawn. So, before M3 starts, one example in the form of the earlier ones (an HTML page outside the repository, light theme, invented content), with these frames:

| frame | width | what it shows |
|---|---|---|
| 1 | 720 | Today: the list above one file, for comparison |
| 2 | 720 | The stack: the chips, the toolbar, three sections mid-scroll with the second's header stuck at the top; an Added and a Renamed badge; a section folded because it is Viewed |
| 3 | 360, 280 | The same two ways each, for cards 1 and 2: what the toolbar and a file's header do when they do not fit |
| 4 | 360 | "Collapse all": the list of headers, with a binary file, a pure rename reading `old → new`, a new file with "Untracked +12", a conflict |
| 5 | 720, 360 | A line comment: the add button on the pointed line; the card under the line with "Send to main" ticked (card 5); split mode with the card under a removed line |
| 6 | 720 | A pass of two: one unsent comment as a row under its line (card 6), the card open on another line and reading "Send 2 comments"; then the card closed and the toolbar's "2 unsent comments"; then the transcript's bubble after the send, with two chips and two quoted lines, one under "Before the change:" (card 4) |
| 7 | 720 | A file that changed under an open card: "This file changed · Refresh" in its header |
| 8 | 360 | A scope past the size cap: every file folded, one unfolded and loading, one whose read failed with Retry, one "Diff too large to display" |
| 9 | 720 | A commit: the chip "Commit a1b2c3d" pressed, the totals, the footer ending "· not on feature/csv-export now"; and "This branch" whose totals end "and 3 untracked files not counted" |

**Source control's page follows the frames the owner chose** (2 to 8 and the middle of 10 of `u5-source-control`). States that example did not draw, to be added to it as frames before M11: the list after "Show all 30 commits", with "10 older commits not shown" (card 3); "Commits · latest on main"; the four sentences of a read that failed, and the header ending "· offline"; a signed-out GitHub CLI on another machine for a reader without shell access; a pull request with a cancelled and a skipped check; the page at 280 px.

**The cards**, the most consequential first. Each default is built in one place, so an answer changes one file.

**Card 1 · Review's toolbar when the side column is narrow.** Under the scope chips, one line holds the totals ("12 files changed · +340 −120 · This branch"), the unsent-comments chip, "Collapse all", "Showing hunk 3 of 41" with its two arrows, and the View menu. At 360 px and below it does not fit. What should happen there?
- *Two lines (recommended).* The totals and the comments chip on the first line, the controls on the second. Every word stays as it is at any width; the toolbar is one line taller in a narrow column.
- *One line, shortened.* "12 files · +340 −120", "3 / 41", and "Collapse all" as a glyph with its words as a tooltip. Nothing moves, and the same control reads differently by width.
- *One line, and the hunk counter moves into the View menu when narrow.* The counter the owner marked `keep` is then one click away in a narrow column.
Default: two lines. Built in `Toolbar.tsx`.

**Card 2 · A file's header when the side column is narrow.** A header holds a fold mark, the path, a kind badge, the counts, Viewed and "Open file ↗", and stays at the top while its file is read. At 280 px the path would be left with no room. What gives way?
- *Words where they fit, glyphs where they do not (recommended).* In a narrow column Viewed is a check box and "Open file ↗" is "↗", each with its words as a tooltip; from about 520 px they are words as today. The path always keeps the room that is left, and its folder part shortens first.
- *Glyphs at every width.* One look everywhere, as Claude Desktop's header (a check icon and an arrow, each with a tooltip); today's words go.
- *Two lines when narrow.* The path on the first, the rest on the second; the header that stays at the top is then twice as tall.
Default: the first. Built in `FileSection.tsx`.

**Card 3 · After "Show all 30 commits".** The list is cut at eight rows so that the pull request stays in view. Once it is shown whole, what does that line become?
- *"Show fewer" (recommended).* One click folds the list back to eight rows.
- *Nothing.* The list stays whole until the page is left; the pull request is a scroll away.
Default: "Show fewer". Built in the Commits part of the page.

**Card 4 · The chip of a comment on a removed line.** In the transcript a Review comment has a chip naming the file and the line, then the quoted line, then the words. For a line the change removed, the quoted line stands under "Before the change:". Should the chip say so too?
- *No (recommended).* The chip reads `berth-csv.ts:32` like any other; the line under it says "Before the change:".
- *Yes.* The chip reads `berth-csv.ts:32 · before`; the same fact is said twice in one bubble.
Default: no. Built where the anchor's label is made (`fileLineAnchor`'s caller in Review).

**Card 5 · The card under a line, in a wide column.** The comment card opens in a row under the commented line. How wide is it there?
- *The card's usual width (recommended).* The same card as on a page or a document, starting at the code's left edge; the row's remaining width stays empty.
- *The row's whole width.* The field is as wide as the diff; the card looks different here from everywhere else.
Default: the usual width. Built in the `inline` layout of the card's host.

**Card 6 · An unsent comment under its line.** Each comment that waits to be sent is a row under its line, with Remove; a click opens it in the card. How much of it does the row show?
- *One line (recommended).* The first words, shortened; the diff keeps its density.
- *All of it.* Long comments push the diff apart while they wait.
Default: one line. Built in the row the stack gives the library.
## Words used here

- **The stack:** Review's one scroller holding every changed file of a scope as a *section* (a header and a body). **Folded:** a section drawn as its header alone.
- **The band:** the part of the stack whose bodies are drawn: the sections within two viewports of the scroll position.
- **The place:** where the stack's scroller was left: a file, a line of its diff and an offset. **The pending place:** the place the stack is still bringing into view (after a return, a request for a file, a hunk jump).
- **Scope:** what Review compares: Uncommitted, This branch, Last turn, Staged, and from M10 one commit.
- **The pass, a flight, the card's host, the place line:** U5a's terms (`side/card/store.ts`): every unsent comment one surface holds for one session; one send of them; the component a surface mounts for the card; the line the host draws after a send to the main conversation.
- **The quote:** the text of the commented diff line, sent inside the comment's words.
- **The reads:** the three new `git.*` commands of §C. **The branch read** answers the base and the branch's commits; **the commit read** one commit's diff; **the working-tree read** the working tree against a commit.
- **The base:** the ref "This branch" and the commit list are measured against, by the default-branch rule (§C). **The merge base:** the commit that ref and `HEAD` share.
- **The machine link, an offer, the checkout rule, a capability:** U9's terms. The link is the connection from this window to another machine's daemon; an offer is a row of `OFFERS` (`src/endpoint/offers.ts`) saying a command is accepted over it; the checkout rule admits a `git.*` read whose `directory` lies in a repository of the session the caller may view; a capability is a name a machine lists when its build serves something (`ENDPOINT_CAPABILITIES`).
- **The daemon:** `mawsd`, the process that serves a machine's commands; on this Mac it can be of an older build than the window.
- **The two builds that bind:** `2c7044231` and `f1852de3a` (§K).
- **Kept:** said of a commit's diff: read once and not read again while it is held.

## Constraints that bind every milestone

1. **The build brief binds** (`~/.local/share/maws-ux-wave/briefs/build-common.md`): no typecheck, lint, test, install, build or Electron on the MacBook; every check on the build VM through `vmcheck.sh`, each under a time limit; no pull request, no `scripts/ci-gate.sh` and no Electron e2e by an executor; commits end with the session line the brief gives and carry no other attribution; the tokens guard reads `#` and three to eight hex digits as a colour in renderer source, so a ticket or a commit hash in a comment or a test name there is written in words or without the `#`.
2. **The repository is public (UC-11).** Fixtures, tests, scratch repositories and scenes use invented names, paths, branches, commit subjects and comment text. A fault is never reproduced by reading a person's session, transcript, repository or settings; nothing about any person's machines goes into code, tests or this document.
3. **A persisted text does not move.** `commentsMessage` and `anchorLead` answer, for every input they take today, the bytes they answer today; `src/shared/anchor/message.test.ts` and `anchor.test.ts` are not edited to make a case pass.
4. **The wire changes only by addition** (`src/shared/ipc/wire.ts`). U5b-1 takes no minor. U5b-2 takes one, in M7, for three commands and one optional property (`commit` on the anchor); it removes nothing from the registry, and the ten `scm.*` commands and `scm.remote.output` stay served with their tests.
5. **Nothing is stored** (UC-14): no layout key, no settings key, no column. §K is the whole account of what is sent and persisted.
6. **Nothing here runs git by hand** (the owner's answer of 2026-11-13): no renderer file under `tools/scm/` or `tools/code/review/` calls a command that changes a repository; the git service gains only reads.
7. **`keep` means keep (law 8):** the hunk counter and its ↑ and ↓ stay, in today's words; the turn's Undo in the work divider's menu is not touched.
8. **Law 7:** today's tokens and shapes. The stack's header is today's file header row; a badge is today's kind word in the badge shape the app has; a commit's row takes the hover ground of today's file rows; a check's dot is the Background tasks row's 6 px dot; the commit's chip is Review's chip. No new colour, radius or shadow.
9. **UC-6:** no chord is added. A commit's row and every new control are reached by Tab and act on Enter or Space.
10. **Files other children own, or that no child owns (UC-8).** The insertions are these and no others, each the smallest that does the job:
    - **U9's** (reviewed by U9, UC-7.6): `src/endpoint/offers.ts`, `src/endpoint/capabilities.ts`, `src/shared/ipc/remote-unavailable.ts` and its test, `src/main/lane-b/remote.ts` and its test, `src/main/device/step-up.ts`, `test/lane-b/offer-coverage.test.ts` (no rule edited) (§D).
    - **The P5 work's, owned by the session that keeps master:** `src/endpoint/authorize.ts`, one name in `FORKS` (M9).
    - **U8's:** `src/renderer/src/panel/summary/PushState.test.tsx`: the import of `connectScmRunEnds` and its one case leave with the store they test (M12). `panel/summary/derive.ts`, `pr-line.ts`, `PushState.tsx` and `panel/copy.ts` are read and not edited.
    - **No child's:** `src/shared/ipc/schema/git.ts` and the tables of §C; `src/services/git/`; `src/services/scm/pr-state.ts` (l5-code-12 d) and `src/services/scm/service.ts` (its default-remote lookup calls the git service's, decision 13); `src/services/sessions/service-register.ts` and `service.ts` (M9); `src/services/command-budgets.ts`; `src/main/app.ts`, `src/main/machines/side-thread-peer.ts` and the new `git-reads-peer.ts`; `apps/org-protocol/src/channel.ts` and its test; `src/renderer/src/ipc/events.ts` (one line, §E); `src/renderer/src/App.tsx` (the import and the effect of `connectScmRunEnds` leave); `src/renderer/src/tools/maws/panes/connect.ts` (one branch, §H); `src/renderer/src/harness/code/` (the probes of `e2e:code`); `src/renderer/src/test-support/scm.ts`; `e2e/scm.spec.ts` with `e2e/support/scm-scratch.ts`, `e2e/code-tools.spec.ts` with `e2e/support/code-product.ts`, the Source control steps of `e2e/remote.spec.ts`, the scenes appended to `e2e/cross-build.spec.ts`.
    - **Not edited:** anything under `src/renderer/src/transcript/` (UC-3), `src/renderer/src/panel/` but the one test above, `tools/code/files/`, `viewer/`, `editor/`, `open-file.ts` (U6's), the `/btw` files in `side/` (U4's), `src/endpoint/targets.ts`, `src/services/git/watcher.ts`.
11. **Copy** goes through `REVIEW_COPY` and `SCM_COPY`; the strings are in §H and §I. A fact a neighbour already words is said in the neighbour's words.
## Decisions settled at authoring

Means the child's file leaves open. Each says why, and what lost. The Interfaces carry the shapes.

1. **Two pull requests; l5-code-03, -04 and -06 follow the stack together.** "The landing's edge".
2. **A removed line says so in the comment's words, not in the lead** (R6): both older builds then read a Review comment as their own.
3. **The quote travels inside the comment's words,** composed at the send by `quotedComment`. No command gains a field, no reader changes, and an older daemon cannot drop it. A `quote` field on `side.thread.open` and `side.comment.content` lost: a wire addition, a tolerant reader that would lose it silently, and a second writer of one text.
4. **Review's card host is mounted once per Review surface, in the toolbar, and the card is drawn through a portal into the row the surface names** (the layout `inline`). The host's registration is how `openCard` finds a pass, and its chip and place line need a home when no card is open; a host mounted inside the library's widget row would exist only while a card is open. Lost with it: a host per file.
5. **In Review a side thread opens in the Side pane and the card closes.** The card sits inside a diff that re-reads; a thread's transcript does not belong in a row of it (the child's UC-5).
6. **The band is a pure function fed by the scroller's own events,** not an `IntersectionObserver` per section: the unit test of A8 can count drawn bodies with stubbed heights, and the place's arithmetic reads the same offsets. Row virtualisation, which Claude Desktop does (`readable/app-5.1231.2/web/app/v1/ca7ba268c-BM2FRMly.js:6188-7110`), lost by law 4: the library MAWS pins draws whole files, a file past 2,000 changed lines is already not drawn, and the band bounds the rest.
7. **The place is a file, a row and an offset.** A10 asks for "the same file at the same line" after a resize; with Wrap on, a pixel offset inside a section lands on another line once the lines reflow. The row is read from the attributes the library puts on its rows, which `ReviewView` reads for hunks today.
8. **One pending place serves a return, a request that names a file, and a hunk jump,** released by the person's first input. Three mechanisms for one act (bring this into view while sections above still change height) is how X-072 came to be.
9. **Folding is the person's choice over a default** (Viewed, or a scope past the cap), kept per scope beside the marks. A separate "folded" flag written by Viewed lost: a mark that drops when its file changes would leave the file folded over a change nobody saw.
10. **A file's diff object is kept while its text is equal, and a file under an open card holds still** (P2; the child's item). The widget row is opened again by the surface after Refresh, the draft coming from the store.
11. **An unsent comment's row is placed from its quote at each refresh;** the anchor's line is where the search starts. A comment whose line left the diff stays in the pass and the chip and is drawn under no line.
12. **Names.** `git.branchCommits`, `git.commitDiff`, `git.changesSince`; the capability `rl2.git-reads`; the side thread's `rl2.side-threads`. Camel case after `git.lsFiles`; no `git.worktree.` prefix, which is the mutating worktree service's.
13. **The default-branch rule lives once, in the git service** (`default-base.ts`). Its first two steps exist today in `src/services/scm/service.ts` (which remote; the branch that remote's HEAD names): they move, and the scm service calls them where they now live, answering what it answers today (its tests unedited). The git rule adds the fallbacks after them. A second copy left in the scm service lost: two rules for one question is the difference l5-code-03 exists to remove.
14. **A path command that needs a capability is held where path commands are routed** (`routeLaneB`), by `REMOTE_NEEDS`, and this Mac's daemon lists the capability by its welcome's wire minor, as the project acts do. The window then asks one question for every machine. Making the three reads adapter-handled calls lost: the adapter's branch for a call re-dispatches on one channel and would have to learn the session a checkout read is made for.
15. **New files are counted by the service reading the files the fresh status lists,** under `lstat` and two caps, not by one git run a file (up to 200 process starts a read) and not by the window (up to 200 round trips, over the link for another machine). Claude Desktop does the same in its main process (R1's citation). The body of one new file is still today's `untracked` scope.
16. **The side thread over the link is its own path on the machine,** with the fork's ceiling check called on that path, the side thread's own rule for a running turn, the owners' row, the source's `view` check, an `accepts` that takes no screenshot path, and a capability of its own. Reusing `session.fork`'s row and handler lost: a side thread is allowed while a turn runs and a fork is not, and its first message is built on the machine from the comments. Carrying a screenshot's bytes in the thread's first message over the link is not built: a thread on another machine takes none and the card says so.
17. **A commit's diff is kept; a failed read is asked again by exactly three things** (§G). Re-reading it on every status, as every other scope is, lost: it cannot change, and over a link it is the largest read Review makes.
18. **One store holds the branch read for Review and the page,** asked on the schedule of §E. Two stores would answer two bases for a moment after a fetch, and one fact would have two values.
19. **A failed read is told apart by one function** (§H), on the path that produces it: a capability that is not listed, the answer's code, the refusal's word.
20. **`show_pane` for Source control with a file opens Review,** in `tools/maws/panes/connect.ts`, where the agent's request is turned into a tool and its `asked: 'agent'` is set. The tool's own `open()` lost: it would open a second tool without knowing who asked.
21. **Sign in on another machine is drawn by the `shell` right** (`MachineState.rights`): the button types into a terminal there, and a terminal there needs that right. No renderer code reads the right today; the Environment card's own button keeps the gap and gets a tracker row (the child's "Not included").
22. **Every e2e edit of a pull request is its last milestone's** (M6, M12). Between the first milestone that changes a surface and that one, the scenes of `e2e:code`, `e2e:scm` and `e2e:remote` over it are stale; nobody runs e2e in between.
23. **`ReviewView.tsx` is left untouched by U5b-1** and deleted in M12 with `ScmDiff.tsx`, its one importer outside Review. The stack's body is a new file. An adapter kept for the acting pane lost: it would be written to be deleted.
24. **A side thread that carries a commit is refused for an older daemon on this Mac** by the guard that refuses `more` (§K). By construction it cannot be made there; the guard costs one condition and covers a daemon replaced between the read and the send.
## Claude Desktop, re-read (law 1)

Where the child's file says an item follows Claude Desktop `app-5.1231.2`, how Desktop does it and where MAWS cannot do the same. Paths are under `readable/app-5.1231.2/`; every line here was re-read for this document.

| item | Desktop | MAWS |
|---|---|---|
| The stack (l5-code-05) | Every changed file is a block in one scroll region (`web/app/v1/c44d00c7f-CP6SmyJb.js:15790-15835`); a header that sticks (`:13826`) with the path, the counts, badges, a Viewed toggle and "Open file" (`:5205-5440`, `:5567-5700`); marking Viewed folds the file and a file that changed since unfolds (`:13387-13406`, `:8445-8464`); "Collapse all files" and "Expand all files" in the pane's menu (`web/app/v1/c9bd7af9c-DlJ4cmuC.js:6470-6530`) | Follows it in all four. Departs in what the child names (no file rail, the hunk counter kept, no expanders) and in one more that the code forces: Desktop windows a file's lines and its files (`web/app/v1/ca7ba268c-BM2FRMly.js:6188-7110`, `:12035-12069`), which its diff library provides; the library MAWS pins draws a file whole, so MAWS bounds the work by the band and by today's per-file cap (decision 6) |
| A comment on a line (l5-code-01) | The agent receives "In \`path\` at line N:", the snippet fenced, then the words; an old-side line adds "(before changes)"; several comments are grouped by file (`web/app/v1/c9543da06-DAeewRbi.js:1968-2073`) | Keeps the fenced line and the old side's words, in its own card and anchor (the child's departure); the order is the order made (UC-5) |
| "This branch" and new files (l5-code-03, -04) | `origin/<base>` before the local branch (`main-process/index.chunk-CgUL8Fja.js:592-607`); `git merge-base`, then `git diff <merge base>` to the working tree (`:743-785`, `:849-899`); the first 200 untracked files read, 1 MiB each, binary by a NUL byte (`:416-563`) | The same read (R1) and the same caps. The base is the remote's default branch by rule; Desktop's base is a branch the session or the person names, with a picker MAWS does not build ("Not included") |
| A branch's commits and one commit's diff (l5-code-06) | The newest 50 in a menu of the diff pane, subject and short hash (`web/app/v1/c9bd7af9c-DlJ4cmuC.js:4926-5111`); one commit against its first parent, a root commit against the empty tree (`main-process/heavy-work-worker/heavyWorkWorker.js:22705-22758`) | The same reading of a commit. The list is on Source control's page, grouped by whether a commit is pushed, which Desktop does not say; it ranges from the merge base, so that it lists the commits whose change "This branch" shows |
| The pull request's checks (l5-code-06) | A row a check with its state and a link; failing, cancelled and pending always listed, passing and skipped folded behind one line (`web/app/v1/ca9ee6f68-D-vPLWtv.js:4486-4775`) | The same order and fold, in the Environment card's words (passed, failed, cancelled, pending, skipped) |
| Returning to the same place (X-072) | Nothing restores the diff's scroll position; a change of scope scrolls to the top (`web/app/v1/c44d00c7f-CP6SmyJb.js:15249-15262`) | MAWS's own; the tracker row is the reason |
## Routes (law 5), and what crosses a machine link

The three routes are a session MAWS runs, a terminal session watched through its bridge, and a session on another machine. A terminal session on another machine has no record in this window: Review and Source control keep their "no session" sentences there, as today (this landing does not change which sessions have a record).

| acceptance | a session MAWS runs | a terminal session on this Mac | a session MAWS runs on another machine | what is drawn where a route does not carry it |
|---|---|---|---|---|
| A6, a comment on a line | ticked and unticked | unticked forks its conversation; ticked through the bridge while it is live | ticked: the composer's own send. Unticked: from M9 for an owner of a machine that lists `rl2.side-threads`; before M9, and for anyone else, locked | terminal, bridge not live: the checkbox is off with "Held by …" (U5a). Another machine, unticked not available: the checkbox is ticked and locked and its title is `useRemoteUnavailable`'s sentence |
| A7 to A10, the stack, the band, the counter, the place | yes | yes: git is read by the session's folder | yes: git is read on that machine through `pathTarget(machine, session)`, as today | — |
| A9, A13 (c), Last turn | yes | where the transcript's rows carry a turn's file list; else the chip is off with "No turn has changed files yet" | the same rule as a terminal session: by the rows the window holds | the disabled chip and its reason |
| A11, A12, "This branch" and counted new files | yes | yes | yes, read on that machine, where it lists `rl2.git-reads` | a machine or a local daemon that does not serve the reads: R2 |
| A13 (d), no raw `gh` line | yes | yes | where that machine's services are this build's | an older machine's services still answer `gh`'s line until it is updated (§K) |
| A14, the page and a commit | S1 to S22 | S9, S20: the same page; a commit opens. The pull request's immediate re-ask after the agent publishes comes from the engine's wire frame, which a terminal session's status may not carry: the page is then at most two minutes late, as the card is today | S9, S20: the same page, read there at grade `view`, the machine named in the header; Sign in by the `shell` right | S9's three cases; S10's sentences |
| A19 | yes | yes | yes | — |

**Nothing new is offered to a caller on another machine beyond UC-7's sentences, but for R1.** UC-7 names, for this child: the side thread ("a fork with the thread's lineage, under Fork's authorisation but the side thread's own rule for a running turn") and "two reads of a branch's commits and of one commit's diff (… calls under the checkout rule, one capability for the two)". This landing's whole change to `OFFERS` is four rows: the two reads, the working-tree read R1 asks for, and the side thread. The proof is a test, not this sentence: `test/lane-b/offer-coverage.test.ts` passes with no rule edited, and M12's acceptance run diffs the offered command names of `src/endpoint/offers.ts` against master's and expects exactly those four (Concrete Steps 7).

**The acts that cross a link, each with its row, its grade and its test.**

| act | offer row | grade and who | what is checked, where | its test |
|---|---|---|---|---|
| read a branch's commits, one commit's diff, the working tree against a commit | `checkout` (a call, executor `machine`, target `checkout`) | `view`: a member who may view the session | at the endpoint: the row exists (`not-offered` otherwise), the input holds to the schema strictly (a `commit` or `against` that is not a full hash is `malformed`), and `withinCheckout` holds the input's `directory` to a repository of that session (`no-target` otherwise). On the device: the capability, in `routeLaneB`, before anything is sent | `test/endpoint/checkout-rows.test.ts` (admitted at `view` inside the checkout, refused outside); the endpoint's `not-offered` test for an older table; `src/main/lane-b/remote.test.ts` (a peer without the capability is sent nothing) |
| open a side thread | an act, executor `machine`, target `appSessionId`, `owners: true`, `accepts: isRemoteSideThread` | `spawn`, and the machine's owners alone, who must also view the source (`FORKS`); stepped up as a fork is | at the endpoint: owners, then the grade, then the schema, then `accepts` on the input the act runs with (no screenshot path, on the comment or any `more`), then the source's view. **On the machine, where one command becomes another:** `side.thread.open`'s handler is not `session.fork`'s, and what it calls starts a fork by direct method calls with no second authorisation. So the ceiling check sits in the side thread's own branch for a caller on another machine (`openSideThreadFromAnotherMachine`), on the intent that branch is about to start, and is tested on that branch | the endpoint's row tests for `owners-only`, `grade`, a screenshot path and a malformed `from`; a services test on the side thread's path for the ceiling and for a running turn; the device test for a peer without `rl2.side-threads` |

No read of this landing returns a file's content that `git.diff` does not return today at the same grade: a commit's diff is content of the repository the reader may already diff, and the count of a new file's lines is less than the `untracked` scope's body. No act of this landing changes a repository on any route.
## Plan of Work

Twelve milestones in two pull requests. Every executor reads this whole document, the child's file and the code; a milestone points at the sections that carry its decisions. Tests are named by the behaviour they assert. Where an act awaits something, the milestone names the test that holds the sequence open.

### M1 — What a line comment says, and what the card takes

**At its end** a comment can be started on a host of kind `review` with a quote, its card is drawn in a row a surface names, and the sent text quotes the line. No surface uses it yet; the unit tests are the proof.

**Touches:** `src/shared/anchor/message.ts` and its tests; `src/renderer/src/tools/code/anchor/anchor.ts`; `src/renderer/src/side/card/store.ts`, `CardHost.tsx`, `src/renderer/src/side/actions.ts`, `copy.ts`, and their tests. **Exposes** §A's `quotedComment`, §B's kind, layout and `quote` to M5. **Consumes** U5a's card as §L names it.

**Does not touch** `leadParts`, `anchorTag`, `commentsMessage`'s framing, `AnchorSchema` (the `commit` field is M10's), `src/shared/ipc/schema/side.ts`, the sheet, or any other host.

**Proves** (part of A6): §A's tests for the quote; a comment opened with `placement.host: 'review'` and a `quote` joins the pass keyed by the session, with the checkbox ticked when the surface asked for main; a host with layout `inline` draws the card inside the element given as `row`, draws nothing of it when `row` is null and keeps the comment, and draws the chip and the place line in its own place; `sendPass` hands `sendComments` the words `quotedComment` made, for a ticked and an unticked pass alike; an unticked send of a `review` pass closes the card and reveals the thread in the Side pane; every existing case of `store.test.ts`, `CardHost.test.tsx`, `pass.test.tsx` and `actions.test.ts` passes unedited.

### M2 — The stack's model

**At its end** the pure model of the stack exists with its tests, and Review's view state holds folds, places and a hunk across files. The drawn Review is unchanged: the shell reads the old fields through M3.

**Touches:** `tools/code/review/` only: a new `stack-model.ts` with its test file; `view-state.ts`; `review-model.ts` (Last turn's paths relative to the repository when inside it, l5-code-12 a; the Conflict kind; the latest turn that changed files, l5-code-12 c). **Exposes** §E's `ReviewUi` and `placeKey`, §F's `bandOf`, `placeAt`, the fold rule and the hunk order to M3 and M4.

**Decisions of its own.** The model takes heights as numbers and never measures; an estimate for a body not yet measured is a function of its line count alone. `viewedKey` is renamed, not duplicated. The fields the model replaces (`selected`, the one-file `hunk`, `scrollTop`) stay until M3 removes their last reader, so the tree is green between the two.

**Does not touch** `ReviewShell.tsx`, `ReviewView.tsx`, `review-store.ts`'s reads, anything outside the folder.

**Proves** (the pure halves of A8, A9, A10 and A13 a and c): the band of 200 sections of known heights holds only those within two viewports, at the top, in the middle and at the end; a place survives a change of the heights above it and falls back to the section's top when its row is gone; the fold rule's four cases (the person's choice; Viewed; past the cap; a mark that dropped); "Collapse all" and "Expand all"; the hunk order skips Viewed and oversized files and crosses files; Last turn's file inside the repository reads relative and outside it absolute, its identity absolute in both; the latest turn with files is found, and none answers null.

### M3 — The stack drawn

**At its end** Review, in the panel and in a diff tab, is one scroller of sections with sticky headers, kind badges, folding, the toolbar and the always-listed Last turn chip. Every body is drawn (the band is M4's), the place is not yet kept, ↑ and ↓ move within the files that are drawn.

**Touches:** `tools/code/review/` (`ReviewShell.tsx` rewritten; new `Stack.tsx`, `FileSection.tsx`, `FileBody.tsx`, `Toolbar.tsx`; `ReviewTool.tsx`, `DiffTab.tsx`, `review-store.ts`, `view-state.ts`), `tools/code/copy.ts`, `tools/code/code.css`, `src/renderer/src/harness/code/codeProbes.ts` and `api.ts`, and `review.test.tsx` (its "review tool" and "review diff tab" suites are rewritten for the stack; "patch splitting", "review model" and "review store" stand). **Consumes** M2's model. **Exposes** the mounted stack and its sections (`[data-review-file]`, a header `[data-review-file-header]`, a body `[data-review-body]`) to M4, M5 and the harness.

**Decisions of its own.** §F: the header, the bodies, the toolbar, Last turn's chip, per-file data kept by text. The header's and the toolbar's narrow forms are cards 1 and 2 at their defaults. `ReviewView.tsx` is not edited (decision 23). A request that names a file sets `reveal`; M3 scrolls to that section once, M4 makes it a pending place. The harness's `review()` answers the stack (the scope, the files with their folds and marks, the hunk counter, the header and footer text), and `selectFile` becomes "bring this file's section into view".

**Does not touch** the reads (`held-diffs.ts`, `git.diff`'s inputs, `lookupBase`: "This branch" and the untracked rows are as today), `tools/scm/`, the card.

**Proves** (A7, A13 a to c, S11): every file of a scope is a section in the list's order; a header carries the path, a badge for each kind but Modified, the counts, Viewed and "Open file ↗", and no menu and no "Staged" badge; a click on a header folds and unfolds; Viewed folds; "Collapse all" then reads "Expand all"; a binary file reads "Binary file" and never has an empty body; a pure rename is a header reading `old → new` with no body; the kind badge is whole and the path shortens at the narrowest column (the classes that make it so are asserted, the look is the drawn example's); a scope past 8 MiB opens with every file folded and unfolding one asks for that file alone; Unified, Split and Wrap are in one menu and apply to every section; "Last turn" is listed with no turn set, shows the latest turn with files when chosen, and is disabled with its reason when there is none; a diff tab draws the same stack with no chips; "Open file ↗" calls `openFile` with the file's absolute path and the first changed line of the counter's hunk when that hunk is in this file, else of the file's first hunk.

### M4 — The band, the place and the hunk counter

**At its end** a scope of 200 files draws only what is near the scroll position; Review returns to the file and line it was left at after another side surface was shown, a resize, a zoom change or late highlighting; "Showing hunk n of m" counts across the stack and ↑ and ↓ cross files.

**Touches:** `tools/code/review/Stack.tsx`, `FileSection.tsx`, `FileBody.tsx`, `Toolbar.tsx`, `view-state.ts`; a new test file for the mounted stack with stubbed measures. **Consumes** M2's `bandOf`, `placeAt` and hunk order.

**Decisions of its own.** §F's table of the pending place is the whole state machine; the executor adds no state beside it. Measures come through one seam the tests replace (jsdom lays nothing out). The stack's own scroll writes are told from the person's by a flag set around the write, as `ReviewView` does today.

**Async, and its tests.** A hunk jump or a request into a section whose file is not read yet: the stack scrolls to the section by its estimate and shows "Loading"; when the read answers it scrolls once to the hunk's row; if the person scrolls, presses a key or a pointer first, the pending place ends and the answer moves nothing; if the read fails, the row reads "Diff unavailable: …" with Retry and the scroller stays. *The test holds the file's read open,* asserts the estimate's position, sends a wheel event, resolves the read, and asserts the scroller did not move; a second case resolves without input and asserts the row's position.

**Proves** (A8, A9, A10, and X-072's regression): with 200 files of stubbed heights, the count of drawn bodies stays within the band at the top, after a scroll to the middle and at the last file; a body that leaves the band becomes a spacer of its measured height and the scroll position does not jump; saved in the middle of the third file, the place is restored after a remount, restored again when a body above it grows (late highlighting), when the scroller's width changes (a resize) and when every height scales (a zoom change), and no longer after a wheel event (*this case fails on master's `ReviewView`, which assigns `scrollTop` once*); ↑ and ↓ move across files and unfold a folded file they land in; scrolling by hand moves the count; a hunk in the last screenful stands.

### M5 — Comments on lines

**At its end** pointing at a line of a diff in Review shows the add button; the card opens under the line with "Send to main" ticked; several comments go as one message that quotes each line; an unticked pass opens one side thread in the Side pane.

**Touches:** `tools/code/review/` (`FileBody.tsx`, `FileSection.tsx`, `Toolbar.tsx`, `Stack.tsx`, a new module for a comment's place and anchor with its tests), `tools/code/copy.ts`. **Consumes** M1 (§A, §B) and the stack. **Exposes** the comment's place `(commit | null, path, block, side, line)` to M10, which fills the commit.

**Decisions of its own.** §G: opening, the place, placed again from the quote, a file under an open card holds still. One `CommentCardHost` per Review surface (`hostId` the surface's own: the tool's tab id or the diff tab's id), `mode` `panel` or `tab` as the surface is. In a diff tab the card and the rows work as in the panel. Every scope takes comments; a comment is drawn in whichever scope shows its file and holds its quoted line on its side.

**Async, and its tests.** A send whose answer arrives after the file changed: the card closed at the send, the file's held hunks were released, and a refused send makes the host open the card again (U5a's rule); the surface then opens the widget at the comment's place as the new diff has it. *The test holds the send open,* delivers a re-read that moves the line down by two, refuses the send, and asserts the card is open under the line whose text is the quote, with its words. Refresh under an open card: the test clicks Refresh with a changed file and asserts the card is drawn again at the line's new number with the store's draft.

**Does not touch** `src/shared/anchor/` (M1 did), the transcript, `src/shared/ipc/`, `side/comment-form.ts` (the sheet), the commit (M10).

**Proves** (A6, but its sentence on a commit): the add button on a line of either side opens the card under that line, ticked; the anchor is the absolute path and the line, with `side: 'old'` for a removed line; Send hands the pass's comments to `sendPass`, and the text built for a removed line opens with "Before the change:" and the fenced line; two comments read "Send 2 comments" and go as one message; the other comment is a row under its line with its words, a click that edits it and Remove; with the card closed the toolbar's chip reads "1 unsent comment" and opens the card on it; a re-read that changes another file leaves the card's node in place (the file's data object is the same); a re-read that changes the card's file shows "This file changed · Refresh" and leaves the drawn hunks; a comment whose line left the diff is in the chip and under no line; switching the working folder keeps the pass; for a session on another machine the checkbox is ticked and locked with the hook's sentence.

### M6 — U5b-1's scenes, record and acceptance

**At its end** U5b-1 is ready for its branch review: the scenes of `e2e:code` follow the stack, one new scene of `e2e:side` covers a line comment, the record is amended, and the whole suite and typecheck are green.

**Touches:** `e2e/code-tools.spec.ts`, `e2e/support/code-product.ts`, `e2e/side.spec.ts`; the two hand-run specs' locators (`e2e/code-tools-live.spec.ts`, `e2e/c12-prerun.spec.ts`); `docs/charter.md`; `docs/doperpowers/plans/2026-09-28-c8c-code-tools.md`.

**The scenes** ("Size and review" lists them by line). Rewritten in `e2e/code-tools.spec.ts` for the stack, each asserting what it asserts today through the new probes: Last turn's files; split, unified and Wrap; hunk navigation, now across two files; the marks and the mode under a pin; the diff tab; both themes; the TypeScript file's line; the 2 MB file (its `within()` budget kept in that form); Uncommitted against numstat; Staged; "Open file"; `git.changed` keeping the place (it asserts the file and line at the scroller's top, not a pixel offset); the refused path; and the Review half of "the card and the code surfaces follow the agent". New, in `e2e/code-tools.spec.ts`: *the place survives* (scroll into the third file, show the Files tool and return, resize the window: the same file and line at the top). New, in `e2e/side.spec.ts` (group `e2e:side`, which runs a replayed engine and already sends comments and reads the transcript): *a line comment in Review* (over its scratch repository: two comments on two files, one on a removed line; "Send 2 comments"; the session's transcript shows one message with two chips and the two quoted lines, one under "Before the change:"; then one unticked comment, whose thread opens in the Side pane). No spec file is added, so no guard's count moves. No raw time bound is added.

**The record** (UC-10; the child's "Contracts amended"): a dated line under X10 in `docs/charter.md` ("2026-11 (UX wave, U5b, l5-code-01): a `file-line` anchor may carry `side`; a comment made on a line of a diff carries that line's text, fenced, at the head of its words, under the line 'Before the change:' for a removed line; Review asks for main") and under X21 ("the host `review` and the layout `inline`"); in the C8c execution document, a dated line that Review is one stack of sections with no file list and no previous and next file buttons, and that the hunk counter counts across it.

**Proves:** A6 to A10 and A13 (a) to (c) as U5b-1's "Acceptance" lists them, by the commands of Concrete Steps 6; the whole unit suite and the whole typecheck, once.

### M7 — The three reads on a machine

**At its end** a machine of this build answers `git.branchCommits`, `git.commitDiff` and `git.changesSince`, and its pull-request state answers `no_remote` for a remote that is not on GitHub. Nothing in the window asks them yet.

**Touches:** §C's list of tables; `src/services/git/service.ts`, `porcelain.ts`, a new `default-base.ts`, their tests; `src/services/scm/service.ts` (decision 13) and `pr-state.ts` with its test; `src/shared/ipc/wire.ts` and the regenerated manifest. **Exposes** §C to M8, M10 and M11.

**Decisions of its own.** §C. `readPrView` maps the failure `planPr` already maps (no GitHub repository resolved for the checkout) to `error: 'no_remote'`, by the same test of `gh`'s answer `plans.ts` uses, moved to one function both call. The wire minor is the next free number after master's at the merge before this milestone (Concrete Steps 3).

**Does not touch** `git.diff`, `git.log`, `git.worktree.branch`, `watcher.ts`, the ten acting `scm.*` commands and their tests, the endpoint.

**Proves** (S15; S21's services half; A12's count; A13 d): §C's tests over scratch repositories; `pr-state.test.ts`: a remote that is not on GitHub answers `no_remote` and an HTTP failure still answers its first line; `wire.test.ts` accepts the manifest as an addition; `command-budgets.test.ts`, `schema.test.ts`, `routes.test.ts`, `spine-root.test.ts` and the daemon's front test pass with the three names.

### M8 — The reads over the machine link

**At its end** a session on another machine of this build can be asked the three reads at grade `view`; a machine of an older build is asked none; this Mac's machine lists the capability when its daemon serves them.

**Touches:** §D, "The three reads" and "This Mac's daemon". **Consumes** M7. **Exposes** `rl2.git-reads` in every machine's `capabilities` to M10 and M11.

**Does not touch** `src/endpoint/targets.ts`, `authorize.ts`, the adapter's `run`.

**Proves** (S9's endpoint and device halves; the routes table's first act): §D's tests; `offer-coverage.test.ts` with no rule edited; the three names in `checkout-rows.test.ts` admitted at `view` inside the checkout and refused `no-target` outside; an endpoint whose table lacks the rows refuses `not-offered` before its services are reached; the device sends nothing to a peer without the capability and answers `internal` with the refusal's word `not-offered`; a peer whose capabilities are unknown is sent the read; the local machine's capabilities hold `rl2.git-reads` at `GIT_READS_MINOR` and not below it.

### M9 — A side thread for a session on another machine

**At its end** an owner of a machine that lists `rl2.side-threads` can send an unticked comment for a session there: the checkbox is free, the thread is forked on that machine and opens in this window. Everyone else sees the checkbox ticked and locked with one sentence.

**Touches:** §D, "A side thread" and "In the window". **Consumes** U9's fork as §L names it.

**Decisions of its own.** Decision 16; R4. The machine's branch for another machine's caller is written beside `forkFromAnotherMachine` and shares its ceiling check by calling one function, not by going through `session.fork`. In the window the answer is adopted as U9's fork of a session on another machine is (`forkSession` in `sessions/record-ops.ts`): `openThread` calls `adoptFork`, whose path for a child on another machine the executor reads against that before trusting it, and the Side pane must draw a thread whose session is on another machine as it draws a pane of one ("What could not be verified" names both).

**Async, and its test.** The act waits for the launch as the fork does. A launch that never comes answers a failure within the act's budget, the card shows the refusal with "Send to main instead", and the pass stays (U5a's flight). *A services test holds the launch open* and asserts the answer and that no second intent is stored.

**Does not touch** the side thread on this Mac (its handler's local branch is byte for byte today's), `forkRefusal`, `sideThreadRefusal`, the card's parts.

**Proves** (A6's last route; A1's "until U9's fork works there", which this closes): §D's six tests; in the window, `useRemoteUnavailable(id, 'side.thread.open')` answers null for an owner on a capable machine in phase `up`, the update sentence for a machine without the capability, the owners' sentence for a member who does not own it, and the offline sentence; an unticked pass for such a session calls `side.thread.open` with every screenshot null, and the card said "N screenshots are left out: …" before the send.

### M10 — "This branch", new files counted, and a commit in Review

**At its end** "This branch" is the working tree against the merge base with the default branch for every session; new files show their line counts and are part of it; a commit can be shown in Review as a scope of its own, kept once read, and a comment on its diff names it.

**Touches:** `tools/code/review/` (a new `branch-read.ts` and `reads.ts` with tests; `held-diffs.ts`, `review-store.ts`, `review-model.ts`, `view-state.ts`, the shell, the toolbar, the footer, the section's error row, the comment's place); `tools/code/copy.ts`; `src/shared/anchor/anchor.ts` and `message.ts` with tests; `tools/code/anchor/anchor.ts` (`commitLineAnchor`); `src/main/machines/side-thread-peer.ts` with its test; `src/renderer/src/ipc/events.ts` (one line); `review.test.tsx` ("review store" loses `lookupBase`'s cases and gains the reads'; "review model" gains the counts). **Consumes** M7, M8, M5. **Exposes** the branch read's store and `ReviewParams.commit` to M11.

**Decisions of its own.** §E (which read a scope takes; the branch read's transitions; the ref grammar), §G (kept; the three retries; the membership check), §A (the commit). The commit's chip is listed while `ReviewUi.commit` is set: set by a request that names a commit, replaced by another, dropped by `forSession`. Choosing another chip leaves it listed. A request that names a commit Review already shows changes nothing.

**Async, and its tests.** (1) The branch read: *the test holds the first ask open,* fires two `git.changed` with reason `head`, resolves, and counts exactly one more ask; a failure keeps the last answer. (2) Opening a commit: *the test holds the commit's read open,* chooses "This branch" (the chip stays listed, the branch is shown), resolves, chooses the chip, and counts one read in all; opening a second commit while the first reads replaces the chip, and the first answer is dropped with its hold. (3) The membership check: `head` changes twice while one is in flight: one more is asked, each with `patch: false`.

**Does not touch** `tools/scm/` (the page is M11's), the services, the endpoint.

**Proves** (A11, A12, A6's commit sentence, S13's Review half, S14, S16 to S19, S20's grammar, S21's Review half, S22): for a session in the main checkout on a feature branch the chip is enabled and the footer reads "`<branch>` · Since origin/`<default>`"; a worktree session has the same base; the list holds a committed change, an uncommitted edit and a new file; a new file of twelve lines shows "+12" beside "Untracked" and is in the totals, in Uncommitted and in This branch; past the caps the totals end "and N untracked files not counted"; where `servesReads` is false, Uncommitted is read with `git.diff` and "This branch" is disabled with its sentence, and while it is null nothing is asked; an answer with another merge base reads "This branch" again; S13's chip, totals and footer; S14; S16 with a fake clock; S17's footer from `onHead` alone; S18; S19, including two comments on one path and line in two commits drawn each in its own, and the amended commit's message naming the hash each comment was made on; `parseRef` reads `commit:<full hash>` and refuses a short one; S22's three retries, for the scope and for one file, and none of them asking a read that succeeded; `refuseUnservedSideThreads` refuses an anchor with `commit` below `GIT_READS_MINOR` and passes it at that minor.

### M11 — Source control's page

**At its end** Source control is the page of four parts that the owner chose, for a session on this Mac and on another machine; a commit's row opens that commit in Review; `show_pane` for it with a file opens Review. The acting components still exist as files and are no longer mounted.

**Touches:** `tools/scm/` (`ScmTool.tsx`, a new page and its parts, a new `page-model.ts`, `copy.ts`, `index.ts`; `ScmShell.test.tsx` and `ScmTool.test.tsx` rewritten; a new test that renders the card and the page together); `src/renderer/src/test-support/scm.ts`; `src/renderer/src/tools/maws/panes/connect.ts` with its test. **Consumes** M10's store and params, `changeLine`, `prLine`, `usePrState`, `useScmStatus`, `useMachineMark`.

**Decisions of its own.** §H. The page holds the git store's watch and the branch read while it is in view (`ctx.visible`), and nothing else: it does not call `useScm`, `resume`, or any command of constraint 6. The counts line of the checks is led by the muted word "Checks", as the chosen frame draws it. Card 3 at its default. The page reads the machine's `rights` from the machines store; with the rights absent it draws neither the button nor the sentence.

**Does not touch** `panel/summary/` (read only), `queries.ts`, the services, the files M12 deletes.

**Proves** (S1, S3 to S10, S13's row, S21's page half): S1 as written, the Uncommitted line equal to the card's change line for the same scripted state; S3 with a fake clock (asked on mount, on `git.changed` with `head` or `refs`, on coming into view, every two minutes in view, never out of view); S4's four cases; S5 and S6 from a scripted `scm.pr.state`, the failed check first and in the danger colour, "↗" opening its link and "Open on GitHub ↗" the pull request's through `layout.openExternal`; S7, one test over one scripted state that compares the card's two lines with the page's two parts; S8's two links and the pane request; S9's sentences, each produced by the answer that causes it (a machine without the capability and nothing asked; `unknown_command`; `internal` with `not-offered`; `host_unavailable` with something read and with nothing read; another refusal), the other three parts drawn in each; S10's cases, with a services-side reminder that no `gh pr view` starts in an untrusted checkout (the existing test, unedited); a commit's row is a button named "Open commit `<sha7>` in Review" that calls `addTool('review', …)` with the full hash; the pane holds no text field, no checkbox but the fold controls' buttons, and no element marked `data-scm-action`.

### M12 — The acting pane leaves; U5b-2's scenes, record and acceptance

**At its end** the window holds no code that stages, discards, commits, pushes or opens a pull request; one diff viewer is left; the scenes, the record and the cross-build scenes are written; the whole suite and typecheck are green.

**Touches (deleted):** under `tools/scm/`: `store.ts`, `view-state.ts`, `groups.ts`, `ScmDiff.tsx`, `ScmShell.tsx`, `plan-sheet.tsx`, `Notice.tsx`, `CommitForm.tsx`, `DiscardSheet.tsx`, `FileRow.tsx`, `Output.tsx`, `PushSheet.tsx`, `PrSheet.tsx`, `RemoteActions.tsx`, `remote-actions.ts`, `remote-run.ts`, and the twelve test files that pin them (`queries.test.ts` stays); `tools/code/review/ReviewView.tsx`; the `overtaken` hook of `held-diffs.ts`, which only Source control's store used. **Touches (edited):** `App.tsx`; `panel/summary/PushState.test.tsx` (constraint 10); a new `test/source-control-reads-only.test.ts` (§H); `e2e/scm.spec.ts`, `e2e/support/scm-scratch.ts`, `e2e/remote.spec.ts`, `e2e/code-tools.spec.ts`, `e2e/cross-build.spec.ts`; `docs/charter.md`, `docs/doperpowers/plans/2026-10-06-e6-source-control.md`, `docs/doperpowers/plans/2026-09-28-c8c-code-tools.md`, `docs/tech-debt-tracker.md`.

**Decisions of its own.** Deletion comes after M11 so that each of the two diffs is read alone. With `connectScmRunEnds` gone, a push or a pull request made by a window of an older build through the same daemon is followed by this window's refs listener and its two-minute poll, not by the run's end; that is named in the pull request. `src/services/scm/` and its 3,124 lines of tests are not touched.

**The scenes.** `e2e/scm.spec.ts` (group `e2e:scm`): the four acting scenes go (stage, discard and commit; push; the reload during a push; and the sheets' half of the pull request scene); *the page* replaces the first (the four parts over the scratch repository, the uncommitted count, two commits under "Not pushed", a commit made by `scratch.git('commit', …)` appearing first without a reload, a push moving it under "Pushed to …"); *a commit opens in Review* (a click on a row: the chip, the totals, the footer; "This branch" and back); the pull request scene keeps its state and checks half on the page (the fake `gh`'s `#7`, two passed and one pending, then Refresh and three passed, a failed check's row); the untrusted scene asserts the page's last part and keeps main's refusal of `scm.stage` (the command is still served); the tokens scene scans the page and Review's commit scope in both themes; the two Environment card scenes stand. `e2e/remote.spec.ts` (group `e2e:remote`): the step that reads Source control on B asserts the page's header (the machine named) and Uncommitted line in place of the group rows, and the step that committed through the tool commits with the spec's own `git()` on B and asserts the commit's row first under "Not pushed", then opens it in Review (its diff read on B); the spec's head comment follows. `e2e/code-tools.spec.ts` (group `e2e:code`): "the card and the code surfaces follow the agent" asserts the page's Where and Uncommitted lines for the worktree and then for the repository, in place of the rows and the "no acts" and "every act is back" checks; "Uncommitted matches numstat" expects the new file's lines in the totals; the hand-run `e2e/code-tools-live.spec.ts`'s step that asserts "This branch" disabled for a main checkout is inverted. `e2e/cross-build.spec.ts`: §K's three scenes and the table's row.

**The record.** `docs/charter.md`: the scope line of the Source control panel amended where it stands, dated, with the owner's words of 2026-11-13, and the Decision Log sentence the child gives; under X10, "a `file-line` anchor may carry `commit`, the full hash of the commit whose diff the comment was made on, and its `path` is then the path in that commit, relative to the repository". The E6 execution document: its acting half (Design §2 to §5 and §8) marked reversed by the owner's answers of 2026-11-13, its reading half standing, and one line that Source control has no list, no diff and no forms and gains the list of commits and the pull request in full. The C8c document: Review gains a commit's scope. `docs/tech-debt-tracker.md`: the ten `scm.*` commands and `scm.remote.output` to be removed at the next wire major; the Environment card's Sign in for a reader without the shell right on another machine (U8's row); the card's and the page's sums without new files' lines (R3).

**Proves** (S2, S11, S12, A19, and the whole of U5b-2's "Acceptance"): the new guard test; `test/one-working-folder.test.ts` unedited and green; the audits of Concrete Steps 7; the whole unit suite and the whole typecheck, once.
## Concrete Steps

Commands run from the worktree of branch `ux-wave/U5b`; `vmcheck` stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U5b --`. Each call tests the pushed head, runs under a time limit (`timeout <seconds> …`) and is its own call, so that its exit status is read. The build VM is shared with a landing in build: a slow or timed-out check is read against its load first.

1. **Base** (the controller: before M1, before M7 and before M12, and whenever master holds a landing of "What this document assumes"): `git fetch origin master && git merge origin/master` (merge, never rebase or force-push), then push, then walk that list's third column. U5b-2's milestones start on a head that holds U5b-1 (the chain: `ux-wave/U5b` continues, and U5b-2's pull request opens when U5b-1 is on master).
2. **While a milestone is built:** one TypeScript project at a time, `vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'` for the renderer and `-p tsconfig.node.json` for `src/shared`, `src/services`, `src/main`, `src/endpoint`, `src/mawsd`, `apps/org-protocol/src` and `test/` (that project is composite and lists the few renderer files its suites import by name: a node-side test that imports a new renderer file needs it listed there); `vmcheck 'timeout 300 pnpm exec eslint <the changed paths>'`; and the milestone's suites, each as `vmcheck 'timeout 900 pnpm exec vitest run <paths>'`:
   - M1: `src/shared/anchor src/renderer/src/side src/renderer/src/tools/code/anchor test/support/tokens-guard.test.ts`
   - M2: `src/renderer/src/tools/code/review test/support/tokens-guard.test.ts`
   - M3, M4: `src/renderer/src/tools/code src/renderer/src/harness src/renderer/src/tools/scm test/support/tokens-guard.test.ts test/one-working-folder.test.ts`
   - M5: `src/renderer/src/tools/code src/renderer/src/side test/support/tokens-guard.test.ts`
   - M7: `src/services/git src/services/scm src/services/command-budgets.test.ts src/services/spine-root.test.ts src/shared/ipc src/shared/machine src/mawsd test/endpoint`
   - M8: `src/endpoint test/endpoint test/lane-b src/main/lane-b src/main/machines src/shared/ipc`, and the `apps/org-protocol` package's own suite for `test/messages.test.ts` (it has its own vitest configuration)
   - M9: `src/services/sessions src/endpoint test/endpoint test/lane-b src/main/lane-b src/main/device src/shared/ipc src/renderer/src/side src/renderer/src/lane-b`
   - M10: `src/renderer/src/tools/code src/shared/anchor src/renderer/src/side src/renderer/src/ipc src/main/machines test/support/tokens-guard.test.ts`
   - M11: `src/renderer/src/tools/scm src/renderer/src/tools/code src/renderer/src/panel/summary src/renderer/src/tools/maws src/renderer/src/sessions test/support/tokens-guard.test.ts`

   Expect each to pass whole, but for the VM's known failures the build brief lists. A suite outside the list that a milestone breaks is that milestone's to fix before its review.
3. **M7's wire files.** After the merge of step 1, read `WIRE_MINOR` in `src/shared/ipc/wire.ts` (47 at the pin; U6e will take one too) and take the next number, with its comment; `GIT_READS_MINOR` (M8) and the guard's constant (M10) name the same number and are re-taken with it at every later merge that moves it. Regenerate on the VM and bring the result back:

       vmcheck 'timeout 600 pnpm wire:manifest >/dev/null; git diff -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json; git checkout -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json' > /tmp/u5b-wire.patch
       sed -n '/^diff --git/,$p' /tmp/u5b-wire.patch | git apply

   Expect a patch that touches `wire-manifest.json` only, adds the three commands and the minor, and at M10 adds `commit` wherever an anchor travels. If `wire.test.ts` says "breaking change", a schema moved that must not: stop and re-read constraint 4.
4. **M8's and M9's protocol step.** `RL2_PROTOCOL.minor` moves once for this pull request (1.14 to 1.15 at the pin; whoever lands second takes the next number), with the number and the capability names `apps/org-protocol/test/messages.test.ts` pins.
5. **At each milestone's end:** the typecheck of each project it changed, eslint on the files it changed, the suites of step 2, named in its report; after a merge of master, the same set again. The controller has the milestone reviewed and ticks Progress.
6. **M6** (U5b-1's last): `vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'`; `vmcheck 'timeout 300 pnpm exec eslint e2e'`; `vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'` (the diff touches `e2e/`); then the whole of it, once: `vmcheck 'timeout 2400 pnpm typecheck'` and `vmcheck 'timeout 3600 pnpm test'`. Expect no failure beyond the VM's known ones. The stale-name audit prints nothing: `grep -rnE 'previousFile|nextFile|role="listbox"' src/renderer/src/tools/code/review src/renderer/src/tools/code/copy.ts` (the file list and its two buttons are gone).
7. **M12** (U5b-2's last): step 6's five commands again, and `vmcheck 'timeout 600 pnpm exec vitest run src/shared/machine'` (commands' schemas changed). The audits, each printing nothing:
   - `grep -rnE "ReviewView|connectScmRunEnds|useScm\b|lookupBase|mainWorktreeBranch|data-scm-(group|row|action)" src e2e test`
   - `grep -rnE "'scm\.(stage|unstage|discard|commit|push|push\.plan|pr\.plan|pr\.create|remote\.cancel|remote\.last|remote\.output)'" src/renderer` (the services, the schema and their tests still name them, and are not searched)

   And the offers' proof: `git diff origin/master -- src/endpoint/offers.ts | grep -E "^\+ +'[a-z.A-Z]+':"` prints exactly four lines, `git.branchCommits`, `git.commitDiff`, `git.changesSince` and `side.thread.open`.
8. **The executor then stops and hands back** what exists and how it was verified, what is not verified, its decisions, and anything that contradicts this document. It runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. Class 1a, the branch reviews, the Mac runs, the cross-build runs, the probes and the pull requests are the architect's ("Proof that an executor does not run").
## Interfaces and Dependencies

Prescriptive where a name or a shape is a decision; everything else is the executor's.

### §A. The text of a line comment (`src/shared/anchor/`; M1, M10)

**A quoted line (M1).** A comment made on a line of a diff carries that line's text. It travels inside the comment's words, so no command, schema or reader changes (decision 3):

```ts
// src/shared/anchor/message.ts
export const QUOTE_MAX = 400; // UTF-16 units; a longer line is cut and ends with "…"
export const BEFORE_THE_CHANGE = 'Before the change:';
/** A comment's words as they are sent: the quoted line fenced above them; unchanged when `quote` is null. */
export function quotedComment(anchor: Anchor, quote: string | null, text: string): string;
```

The result is `<fence>\n<line>\n<fence>\n<text>`, and for a removed line outside a commit's scope (a `file-line` anchor with `side: 'old'` and no `commit`) the caption first: `Before the change:\n<fence>\n<line>\n<fence>\n<text>`. `<fence>` is a run of backticks one longer than the longest run in the line, three at least. The quote is one line (a line break or another control character but a tab is replaced by U+FFFD), cut to `QUOTE_MAX`; an empty line is still quoted. With an empty `text` nothing is sent (the pass sends only comments with text, as today).

The lead and the tag of a `file-line` anchor without a commit **do not change by a byte**: the caption is where a removed line "says before the change" (decision 2). The anchor carries `side: 'old'` for a removed line and no `side` otherwise; `AnchorSchema` and `TAG_FIELDS` hold `side` already, in this build and in both builds that bind, and `leadParts` ignores it for this kind in all three.

**A commit (M10).** `AnchorSchema` gains `commit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/).optional()`, and `TAG_FIELDS` gains `'commit'` after `'artifactTarget'`, so a tag without it is written as before. For a `file-line` anchor that has it, `path` is the path as that commit's diff names the file, relative to the repository, `side` is always given, and `leadParts` answers:

| `side` | the lead's parenthetical |
|---|---|
| `new` | `(file <path>, line <n>, new side, commit <full hash>)` |
| `old` | `(file <path>, line <n>, old side, the first parent of commit <full hash>)` |

The anchor's `label` is `<file name>:<line> · <sha7>` and its `locator` `<path>#L<line>@<full hash>`. `quotedComment` is used as in any scope, without the caption (the lead says the side). The producer is `commitLineAnchor` beside `fileLineAnchor` in `src/renderer/src/tools/code/anchor/anchor.ts`.

**Tests that pin it** (`src/shared/anchor/message.test.ts`, `anchor.test.ts`; no existing case is edited to pass): a `file-line` anchor with `side: 'old'` has the lead of the same anchor without `side`; `quotedComment` for a line holding three backticks, for an empty line, for a line over the cap; a message of two comments whose quoted line begins `<maws_anchor` reads back whole (the existing escape covers a quote, since it is part of the words); with `commit`, the two leads above, the tag's last attribute, and a round trip through `readAnchoredMessage`; a tag without `commit` byte for byte as before; a `commit` of 39 characters or with an upper-case letter refused by the schema.

### §B. The card takes Review (`src/renderer/src/side/`, `tools/code/anchor/anchor.ts`; M1)

```ts
// tools/code/anchor/anchor.ts
type CommentPlacement = | { kind: 'card'; host: 'browser' | 'artifact-page' | 'artifact' | 'review'; hostId?: string; rect?: CardRect } | …
interface CommentContext { …; quote?: string }   // the commented line's text, when the anchor cannot carry it (the child's shape)

// side/card/store.ts
type CardHostKind = 'browser' | 'artifact-page' | 'artifact' | 'review';
interface PassComment { …; quote: string | null }

// side/card/CardHost.tsx
type Layout = 'anchored' | 'docked' | 'margin' | 'inline';
interface Props { …; row?: HTMLElement | null }   // layout 'inline': the element the surface gives the card
```

- **`inline`** (decision 4). The host is mounted once by the surface, for as long as the surface is, where its chip and its place line belong (Review's toolbar). It draws the chip ("N unsent comments") and the line after a send there, as every host does. The card itself is drawn through a portal into `row`, in flow, at the row's width up to the card's usual maximum; with `row` null no card is drawn and the comment stays in its pass. Nothing is located or pinned. The host's registration (kind, subject, `holds: 'many'`) therefore exists before any card opens, which is how `openCard` finds the pass from a placement's `hostId`.
- **The pass** of Review is keyed `passKey('review', <appSessionId>, <appSessionId>)`: its subject is the session, so the panel's Review and a diff tab of one session share it, as two views of an artifact share theirs. `dropSession` ends it. A change of the working folder does not (UC-4).
- **The send.** `sendPass` composes each comment's words with `quotedComment(comment.anchor, comment.quote, text)` before `sendComments`; nothing else in the send changes. For a pass whose host is `review`, a side thread never becomes the card: `revealsThread` answers true and the card closes, so the thread opens in the Side pane (decision 5). The checkbox starts ticked because the surface passes `destination: 'main'`.
- **Nothing else moves:** the card's parts, the draft model, the flight and its settlements, the place line and the refusal row are U5a's and take the new kind as they are. `targetOf` answers null for a `file-line` anchor, so a Review card is never re-docked.

### §C. The three reads (`src/shared/ipc/schema/git.ts`, `src/services/git/`; M7)

All three: owner `machine`, grade `view`, in `PATH_COMMANDS`, addressed by `directory`. Their names are decision 12.

```ts
export const GIT_READS_CAPABILITY = 'rl2.git-reads';
export const UNTRACKED_COUNT_FILES = 200;          // P5 sets it; the starting value
export const UNTRACKED_COUNT_BYTES = 1024 * 1024;  // the per-file cap Review draws by
const FullHash = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);

// git.branchCommits: the branch read (l5-code-03's base and l5-code-06's list)
input  { directory: string; limit: number /* 1..200 */ }
output {
  base: { ref: string; mergeBase: string } | null;          // the default-branch rule below; null when none is found
  upstream: string | null;                                    // as git.status names it
  commits: Array<GitCommit & { pushed: boolean | null }>;     // <mergeBase>..HEAD, newest first, at most `limit`; with no base, the newest of HEAD
  counts: { all: number; notPushed: number | null; pushed: number | null } | null;   // of the whole range, whatever `limit` cut
  behind: number | null;                                      // commits the base ref holds that HEAD does not
}

// git.commitDiff: the commit read
input  { directory: string; commit: FullHash; path?: string; context?: number /* 0..20 */; patch?: boolean }
output { commit: GitCommit; onHead: boolean; patch: string; files: GitDiffFile[] }

// git.changesSince: the working-tree read (R1)
input  { directory: string; against: 'HEAD' | FullHash; path?: string; context?: number }
output { patch: string; files: GitDiffFile[]; untracked: Array<{ path: string; insertions: number | null; binary: boolean }> }
```

**The default-branch rule** (one function, `defaultBase`, in a new `src/services/git/default-base.ts`; decision 13). The remote is the branch's upstream remote, else `origin`, else the only remote. The base ref is the first of these that names a commit: the branch `refs/remotes/<remote>/HEAD` points to, as `<remote>/<name>`; `<remote>/main`; `<remote>/master`; local `main`; local `master`. It is null when none does, when it has no merge base with `HEAD`, and when it is a local branch that is the one `HEAD` is on (the default branch with no remote copy). `mergeBase` is `git merge-base <ref> HEAD`. A detached `HEAD` is compared like any other.

**`git.branchCommits`.** `pushed`: the upstream holds the commit; false with no upstream; null for every row, and null halves in `counts`, when the status names an upstream git cannot resolve. `counts` is of the whole range. With `base` null: `commits` are the newest `limit` of `HEAD`, `counts` and `behind` null. A repository with no commit answers no commits and a null base.

**`git.commitDiff`.** The commit against its first parent; a merge commit so too, never a combined diff; a commit with no parent with every line added. `path` reads one file of it. `patch: false` answers `commit` and `onHead` with an empty `patch` and no `files`, and reads no diff. `onHead` is whether `HEAD` holds the commit. A hash that names no commit is an error whose message says so. Pitfall seen while designing: the empty tree's id differs between a SHA-1 and a SHA-256 repository, so the root commit is read by a form that needs no literal id.

**`git.changesSince`.** The working tree against `against`, with `git.diff`'s arguments and prefixes (`patch`, then `files` from `--numstat -z`). `untracked` is filled only without `path`: for the first `UNTRACKED_COUNT_FILES` entries a fresh status lists as untracked files (a `dir/` entry is not one), in the status's order, the added-line count. It is read by the service itself, not by a git run per file (decision 15): the path is taken from the status and nowhere else; `lstat` must say a regular file of at most `UNTRACKED_COUNT_BYTES`; a NUL in its first 8,000 bytes makes it `binary` with a null count; otherwise `insertions` is the number of lines as `git diff --numstat` counts an added file. A symbolic link counts 1, as its diff shows one line. Anything else (too large, gone, not a regular file) has a null count. No file's content leaves the service through this read.

**What stays as it is.** `git.diff`, `git.log` and `git.worktree.branch` keep their meaning (the worktree clean-up dialog reads the last); the body of one untracked file is still `git.diff` with scope `untracked`. The service's opening comment gains `merge-base`, `rev-list` and `symbolic-ref`; all three only read. The service never fetches.

**Where a new `git.*` read is entered** (each beside `git.log`'s entry): `src/shared/ipc/names/git.ts`; `grades/git.ts` (`'view'`); `routes.ts` (`PATH_COMMANDS`); the `commands` table of `schema/git.ts`; `src/services/git/register.ts`; `src/services/command-budgets.ts` and its test's `EXPECTED` (a budget that covers the read's sequential runs: the table's `STATUS` class for the branch read); `test/support/spine-lists.ts` (`SPINE_COMMANDS` and `CHECKOUTS_COMMANDS`, sorted); `src/shared/ipc/schema.test.ts` (the pinned list of `git.*` keys); `src/shared/ipc/wire.ts` (`WIRE_MINOR`, its comment) and the regenerated `wire-manifest.json`. `src/shared/machine/address-paths.json` needs no entry: no input or output of the three carries a machine-bound id.

**Tests over a scratch repository** (`src/services/git/service.test.ts`, a new `default-base.test.ts`): S15 as written; the rule's five steps, each with the earlier ones absent; a worktree whose main checkout is on another branch answers the same base as the main checkout; the default branch with a remote copy answers that copy, and without one a null base; 60 commits since the base of which 55 are not pushed, read with `limit: 50`: 50 rows, `counts` 60, 55 and 5, and each row's `pushed` true exactly for a commit the upstream holds; no upstream; an upstream whose ref was deleted; S21's services half (after only `refs/remotes/origin/main` advances, the read answers the new `behind` and merge base, and `watcher.test.ts`'s exclusion case still passes unedited); `git.changesSince` against `HEAD` equals `git.diff`'s `all` scope for the same tree, and against a merge base lists a committed change, an uncommitted edit and, in `untracked`, a new file of twelve lines as 12; a binary untracked file; a symbolic link to a file outside the repository is counted 1 and never opened; file 201 has no entry; an `against` or a `commit` that starts with `-` or is not a full hash is refused by the schema before git runs.

### §D. The machine link (U9's files; M8, M9)

UC-7.6's five places, for each insertion. U9 reviews both.

**The three reads (M8).**
1. `src/endpoint/offers.ts`: `'git.branchCommits': checkout`, `'git.commitDiff': checkout`, `'git.changesSince': checkout`, beside `'git.log'`. The checkout rule needs nothing new: `withinCheckout` (`src/endpoint/targets.ts`) reads the input's `directory`, and a commit is any commit of that repository, which is the boundary a reader at `view` has today.
2. `src/main/lane-b/remote.ts`, `routeLaneB`: a command that has a `REMOTE_NEEDS` entry and that the adapter does not handle is answered `not-offered` (`refusalResult`) before the round trip when the machine's link lists its capabilities and not that one; with the capabilities unknown (the link is down) it goes on as today and fails as an unreachable machine does (decision 14). This is the one new check; it reads `REMOTE_NEEDS` and names no command.
3. `src/endpoint/capabilities.ts`: `'rl2.git-reads'` appended, with its comment; `REMOTE_NEEDS` (`src/shared/ipc/remote-unavailable.ts`): the three names; `RL2_PROTOCOL.minor` moved by one in `apps/org-protocol/src/channel.ts` with the number `apps/org-protocol/test/messages.test.ts` pins. One step serves this pull request's two capabilities.
4. Words: none in `ACT_WORDS` (a read is not an act); the page and Review word the three cases themselves (§H, "Refusals told apart").
5. Tests: `test/lane-b/offer-coverage.test.ts` passes with no edit of its rules; `src/shared/ipc/remote-unavailable.test.ts` (it pins `REMOTE_NEEDS`'s keys and values) gains the three; `test/endpoint/checkout-rows.test.ts` gains the three calls in `gitCalls`, so each is admitted for a reader at `view` inside the checkout and refused outside it; at the endpoint, an offer table without the three rows refuses each `not-offered` before a service is reached (S9 a); in `src/main/lane-b/remote.test.ts`, a peer that lists no `rl2.git-reads` is sent none of the three, and a peer whose capabilities are not known yet is sent it.

**This Mac's daemon** may be of an older build than the window (`watchDaemon` leaves another bundle's daemon running). A new `src/main/machines/git-reads-peer.ts`, in the shape of `project-acts-peer.ts`, exports `GIT_READS_MINOR` (the wire minor M7 takes) and a source that adds `rl2.git-reads` to the local machine's `capabilities` while the welcomed daemon's minor is at least that; `src/main/app.ts` composes it with `localProjectActsSource` at `localCapabilities`. The window then asks one question for every machine (§E, `servesReads`). No hook refuses the commands: a daemon that does not know a name answers `unknown_command` by itself.

**A side thread (M9).** Decision 16.
1. `offers.ts`: `'side.thread.open': { kind: 'act', executor: 'machine', target: 'appSessionId', owners: true, accepts: isRemoteSideThread }`. `isRemoteSideThread` holds the input to: `from.kind` `comment` with `screenshot: null` on the comment and on every `more[i]`, or `from.kind` `btw` (R4). `src/endpoint/authorize.ts`: `side.thread.open` joins `FORKS`, so the caller must also view the source (an insertion in a file the session that keeps master owns, as U9's was).
2. `src/main/lane-b/remote.ts`: the name in `MACHINE_ACTS`, `STEPPED_UP` and `BUDGETED_ACTS` beside `session.fork`; `src/main/device/step-up.ts`: in `OWNED_STARTS`; `src/services/command-budgets.ts`: `session.fork`'s budget.
3. Capability `'rl2.side-threads'` (`SIDE_THREADS_CAPABILITY`, `src/shared/ipc/schema/side.ts`), appended to `ENDPOINT_CAPABILITIES`; `REMOTE_NEEDS['side.thread.open']`; the protocol's minor is M8's step.
4. Words: the `'side.thread.open'` row leaves `REMOTE_UNAVAILABLE`; `ACT_WORDS` gains `{ act: 'open a side thread', done: 'opened' }`; the owners' sentence in `disabledWords` covers it as it covers the fork ("Only `<machine>`'s owners can open a side thread there."), and `refusalWords`' `owners-only` is as it is.
5. **Where the act runs** (`src/services/sessions/service-register.ts`, `service.ts`; files no child owns, which U9's fork edited): the handler of `side.thread.open` branches on the caller's origin as `session.fork`'s does. For a caller on another machine it runs a new `openSideThreadFromAnotherMachine`, which applies, on the intent it is about to start, the check `forkFromAnotherMachine` applies (`aboveCeiling` on the source's mode, refused as `CeilingRefused`), then the side thread's own rule (`sideThreadRefusal`: no turn check), then waits for the launch as the fork does. The ceiling check is one function both paths call; it is not reached through `session.fork`.
6. Tests: a row test at the endpoint for each refusal the row can give (a member who does not own the machine: `owners-only`; an owner who cannot view the source: `grade`; a comment with a screenshot path, on the comment and on a `more`: refused by `accepts`; a `from` of another shape: `malformed`); in the services, **on the side thread's own path**, a source above the caller's ceiling is refused and no intent is stored, and a source with a running turn is not refused; a device test that a peer without `rl2.side-threads` is sent nothing; `offer-coverage.test.ts` unedited.

**In the window (M9).** `side/comment-form.ts` already locks the checkbox by `useRemoteUnavailable(parent, 'side.thread.open')`; with the row gone that hook answers by capability, phase and ownership, so the lock lifts exactly where the act works, and its sentence is the checkbox's title. A side thread for a session on another machine carries no screenshot: `openThread` (`side/actions.ts`) sends `screenshot: null` there, and while unchecked the card says so before the send in the line U5a built for a route that takes fewer files ("N screenshots are left out: a side thread on `<machine>` takes none"). `/btw`'s "Continue as a side thread" reads the same hook and follows (R4).

### §E. Review's scopes and their reads (`tools/code/review/`; M2, M10)

```ts
// review-model.ts
type ReviewScope = 'uncommitted' | 'branch' | 'turn' | 'staged' | 'commit';   // 'commit' from M10
interface ReviewParams { scope?: ReviewScope; path?: string; turnId?: TurnId; commit?: string /* a full hash; M10 */ }

// view-state.ts: what replaces `selected`, `hunk` (of one file) and `scrollTop`
interface ReviewUi {
  session; directory; scope; turnId; mode; viewed; request; redecide;        // as today
  commit: { sha: string; subject: string | null } | null;                    // M10: the commit a chip is listed for
  folds: ReadonlyMap<string, ReadonlyMap<string, 'open' | 'closed'>>;        // placeKey → path → the person's own choice
  places: ReadonlyMap<string, StackPlace>;                                   // placeKey → where the scroller was left
  hunk: number;                                                              // across the stack, 0-based
  navigate: number;                                                          // bumped by ↑ and ↓
  reveal: { path: string; n: number } | null;                                // a request that named a file
}
interface StackPlace { path: string; row: { side: 'old' | 'new'; line: number } | null; offset: number }
const placeKey = (directory, scope, turnId, commit) => string;   // today's `viewedKey` with the commit's hash for scope 'commit'
```

`viewedKey` becomes `placeKey` and keys the marks, the folds and the place alike, so a commit's are its own (S18).

**Which read a scope takes** (`DiffTarget` gains `read`; `HeldDiffSpec` gains the command a target is read with, where it calls `git.diff` by name today):

| scope | where the machine serves the reads (`servesReads` true) | where it does not (R2) |
|---|---|---|
| Uncommitted | `git.changesSince` against `HEAD`; new files counted from `untracked` | `git.diff`, scope `all`, as today; new files listed uncounted |
| This branch | `git.changesSince` against the branch read's `mergeBase`; new files from the status, counted from `untracked` | the chip is off; its title is `REVIEW_COPY.branchNeedsReads(machine)` |
| Staged | `git.diff`, scope `staged`, as today | the same |
| Last turn | the transcript, as today | the same |
| Commit | `git.commitDiff`, kept (§G) | no row opens one; a diff tab whose ref names a commit reads `REVIEW_COPY.commitNeedsReads(machine)` |

`servesReads(machine): boolean | null` (a new `tools/code/review/reads.ts`) reads the machine's `capabilities` from the machines store, for this Mac as for another machine (§D): true when it lists `rl2.git-reads`, false when it lists capabilities without it, null while it lists none yet (the link is not up, or this Mac's daemon is not welcomed). While it is null, Uncommitted is read as in the last column, so that it is never later than today, and is read again with the working-tree read once the answer is true; "This branch" is not settled (its chip disabled with no title, as while its base is looked up today); none of the three reads is asked. A target's key holds its `read` and its `against`, so a merge base that moves, or a machine that turns out to serve the reads, is a new target and the scope is read again.

**The branch read in the window** (a new `tools/code/review/branch-read.ts`, one store that Review's "This branch" and Source control's Commits part both hold; decision 18). Keyed by machine and repository root; ref-counted by its holders *in view*. Its transitions:

| event | effect |
|---|---|
| the first holder in view | ask |
| `git.changed` with reason `head` or `refs` for the checkout (the listener in `renderer/src/ipc/events.ts` that re-asks the two `scm` reads; one line added there) | ask, if held |
| a holder comes into view again | ask |
| two minutes since the last answer, while held | ask |
| no holder in view | nothing is asked; the last answer is kept |
| an ask while one is in flight | one more ask when it answers, not two |
| an answer | replaces the last one; when `base.ref` or `base.mergeBase` differs, Review's target for "This branch" changes and that scope is read again |
| a failure | the last answer is kept, and `failure` says which of §H's three kinds it was; the next event asks again |

"This branch" is available when `servesReads` is true and the answer's `base` is not null; with a null base the chip's title is `REVIEW_COPY.noDefaultBranch`. The rule for which scope Review opens on is unchanged (`defaultScope`). `lookupBase` and its `bases` map leave `review-store.ts`.

**The ref grammar** (M10): `parseRef` and `formatRef` gain the scope word `commit:<full hash>`, with ` @ <path>` as for the others; a hash that is not full is refused (null). No product code opens a diff tab today, and none is added.

### §F. The stack (`tools/code/review/`; M2, M3, M4)

Files, by responsibility (names are the executor's but for the three exported to tests): `stack-model.ts` (pure: sections, folds, the band, the place, the hunk order), `Stack.tsx` (the one scroller), `FileSection.tsx` (a header and a body), `FileBody.tsx` (one file's `DiffView` blocks, the successor of `ReviewView.tsx`, which stays untouched until M12; decision 23), `Toolbar.tsx`, and `ReviewShell.tsx` (the chips, the toolbar, the stack, the footer).

**Order and folding.** Sections are the scope's files in the list's order. A section is folded when the person's own choice says so (`folds`), else when it is marked Viewed, else when the scope is past `REVIEW_SCOPE_BYTES_CAP`; a click on the header or its fold mark sets the choice. Marking Viewed removes the choice, so the mark folds the file; a mark that drops because the file changed unfolds it again unless the person folded it. "Collapse all" sets `closed` on every file; it reads "Expand all" while every file is folded, and then sets `open` on every file. A file's diff is read alone (`loadFile`) only when its section is unfolded, inside the band and has no hunks yet, so "Expand all" on a scope past the cap reads what is near the scroll position and no more.

**The band.** `bandOf(tops, heights, scrollTop, viewport)` answers the sections that intersect the viewport extended by two viewports above and below. A section outside the band, or folded, draws its header and a spacer of its last measured body height (before a first measure, an estimate from its line count). The component feeds the function from the scroller's scroll and resize and each drawn body's `ResizeObserver` (decision 6). A8's test stubs the measures and counts drawn bodies.

**The place** (X-072; decisions 7 and 8). `placeAt` answers the section at the scroller's top edge, the diff row at that edge (side and line, read from the row's `data-line-*` attributes) and the pixels below that row's top; with no row there (a folded or undrawn section) the offset is from the section's top. One *pending place* holds whatever the stack is trying to show:

| event | effect |
|---|---|
| mount, with a saved place for this `placeKey` | pending: that place |
| a request that names a file (`reveal`) | pending: that section's top; the section is unfolded |
| ↑ or ↓ | pending: the target hunk's first row; its section is unfolded (and read, if it has no hunks yet) |
| a layout change while pending (a body drew or changed height, the scroller resized, the zoom changed) | the scroller is set again from the pending place; a hunk or a file not drawn yet is scrolled to by its section's estimate, then exactly once it draws |
| the person's wheel, touch, key or pointer press inside the scroller | pending ends; from then on scrolling saves the place |
| a scroll event the stack caused itself | ignored |
| unmount | the last saved place stays in `places` |

**The hunk counter** counts the hunks of every loaded file that is not marked Viewed and not past the per-file cap, in stack order; scrolling by hand sets it to the hunk at the scroller's top edge; at the end of the scroller a hunk jumped to stands, as today. The words are today's `REVIEW_COPY.hunkOf`.

**The header** of a section (sticky at the scroller's top): the fold mark; the path, relative to the repository, the folder part shortening first (a rename reads `old → new`; for Last turn a file outside the repository keeps its absolute path); a kind badge for Added, Deleted, Renamed, Binary, Untracked and Conflict, and none for Modified (Conflict from the status's unmerged entry; the predicate moves here from `tools/scm/groups.ts`); the counts; Viewed; "Open file ↗" (absent for a deleted file). **The bodies:** a diff; "Binary file"; today's "Diff too large to display. Open the file"; nothing for a rename without a change; today's note for an untracked folder; "Diff unavailable: …" with **Retry** in the same row for a file whose own read failed (from M3 for every scope: a failed file read is asked again by Retry).

**The toolbar:** the totals; the unsent-comments chip and the place line (the card host, §B); "Collapse all"; the hunk counter with ↑ and ↓; one menu holding Unified, Split and Wrap, which are the stack's. What gives way at the side column's narrow widths is card 1 ("For the owner"); its default is `Toolbar.tsx`'s.

**Last turn's chip** (l5-code-12 c) is always listed. Chosen with no turn set, it shows the latest turn of the session's own transcript whose divider row lists files; with none it is disabled with `REVIEW_COPY.noTurnChangedFiles`. **A diff tab** is the same `ReviewShell` with `chips={false}`.

**Per-file data.** Each file's `DiffView` `data` object is kept while that file's hunks are text-equal (P2: a new object unmounts an open card), in a cache that lives with the mounted stack.

### §G. Comments on lines, and a commit's diff that is kept (`tools/code/review/`; M5, M10)

- **Opening.** The library's add button (`diffViewAddWidget`, `onAddWidgetClick`) on either side calls `openCommentComposer(anchor, { appSessionId, placement: { kind: 'card', host: 'review', hostId }, destination: 'main', quote })`. The anchor is `fileLineAnchor(<absolute path>, <line>)` with `side: 'old'` for a line of the old side; in a commit's scope `commitLineAnchor` (§A). The quote is the line's text without its diff prefix.
- **A comment's place** is `(commit | null, path, block, side, line)`; `block` is the edit's index in Last turn and 0 elsewhere. The surface opens the library's widget row at the place of the store's open card when that card is its own (`open.hostId`), hands the row's element to the host (`row`), and closes the widget when the card is another surface's or gone. Each other comment of the pass is an `extendData` row under its line: its words, a click to edit (`editComment`), Remove (`discardComment`).
- **Placed again at every refresh** (decision 11): `placeOf(comment, file)` finds, on the comment's side, the line whose text equals the quote, the nearest to the line the anchor names; a comment whose line is no longer in the diff is drawn under no line and stays in the pass and in the chip. In a commit's scope only comments made on that commit are drawn, and in every other scope only comments with no commit.
- **A file with an open card holds still** (decision 10): while the store's open card is on a file of this surface, that file's drawn hunks are the ones it had when the card opened. When the scope's re-read brings other hunks for it, its header shows one muted line, `REVIEW_COPY.fileChanged` with **Refresh**; the held hunks are replaced when the card is sent or closed, or at Refresh, after which the surface opens the widget again at the comment's place, the draft coming from the store and the keyboard returning to the field.
- **A commit's diff is kept** (decision 17). A target read with `git.commitDiff` is `kept`: once it answered, `reread` and `refresh` do not read it again, and neither does a change of status or the tab being shown again. A target, or one file of it read alone, that *failed* is asked again by three things and nothing else: **Retry** in its row; Review being shown again; the session's machine being heard again after its link was down (the machine's phase returning to `up`, U9's `useLinkPhase`). When the status's `head` changes while a commit is the scope or its chip is listed, exactly one `git.commitDiff` with `patch: false` is asked, and its `onHead` sets the footer's last words.

### §H. Source control's page (`tools/scm/`; M11)

`ScmTool.tsx` keeps `SCM_TOOL_ID`, the icon and the tool's registration; its state is the page's own two folds (the commit list shown whole; the passed checks listed), reset when the session or its working folder changes. `ScmShell.tsx` gives way to a page of four parts over a pure `page-model.ts`; `queries.ts` stays as it is; `copy.ts` is rewritten to the page's words. The page is not a wide tool (`WIDE_SURFACES` is not edited).

**What each part reads.** No part reads anything Source control does not read today, but for the branch read.

| part | source | notes |
|---|---|---|
| Where | the git store's status (`useGit`, the watch the page holds); `useMachineMark(appSessionId)`; `useWorkingFolder` | `⎇ <branch>` or `detached at <sha7>`; `· worktree` when `status.isWorktree`; `· <machine>` when the mark is not local, and `· <machine> · offline` when `mark.offline`; the folder's path as the line's title |
| Uncommitted | `changeLine(status, entry.uncommitted?.files ?? null)` (`panel/summary/derive.ts`), the function the card's line uses | "Uncommitted N" with `+A −R`; "· N conflicts" in the danger colour from the status's unmerged entries; "Review ›" opens Review with `{ scope: 'uncommitted' }`; clean: "Uncommitted 0" and no button |
| Commits | the branch read's store (§E), asked with `limit: 50`, held while the page is in view | below |
| Pull request | `usePrState` and `useScmStatus` (`queries.ts`) through `prLine` (`panel/summary/pr-line.ts`) for the part's state, and the answer's `pr` for its content | below; absent for `prLine`'s `hidden` kind (no remote, not a repository, detached, and from M7 a remote that is not on GitHub) |

**Commits.** Heading "Commits N since `<base.ref>`", "· N behind" when `behind > 0`, and "Review ›", which opens Review with `{ scope: 'branch' }`. Rows newest first under "Not pushed N" and "Pushed to `<upstream>` N", the numbers from `counts`; one group when the other is empty; no groups when `pushed` is null. Eight rows, then "Show all N commits"; shown whole, the rows the read answered and, when `counts.all` is larger, the last line "N older commits not shown". With a null `base`: "Commits · latest on `<branch>`" and eight rows. A row is a `<button>` with the subject (which shortens first), the seven-character hash and the age; its title is the author, the date and the full hash; its accessible name "Open commit `<sha7>` in Review"; a press calls `panelHost.addTool('review', { appSessionId, params: { scope: 'commit', commit: <sha> } })`. The age is minutes under an hour ("12m", at least "1m"), hours under a day, days after.

**Pull request.** The heading with `#<number>` and the refresh control (its title `checkedAt`'s words, its press `refreshPrState`); the title; one state line: `prState` (Open, Draft, Merged, Closed), "into `<baseRefName>`", the review decision in today's two phrases, and for an open pull request the merge words:

| `mergeStateStatus` | words | colour |
|---|---|---|
| `CLEAN`, `HAS_HOOKS` | Ready to merge | success |
| `DIRTY` | Conflicts with `<base>` | danger |
| `BEHIND` | Behind `<base>` | muted |
| `BLOCKED` | Merging is blocked | muted |
| anything else, or null | none | |

Then the checks, for an open pull request only: the counts line in the card's bucket words; one row for each check whose bucket is `fail`, `cancel` or `pending`, in that order (a 6 px dot, the name, the bucket's word, "↗" to `link` when it has one; a failed row's dot and word in the danger colour); and one folded line for the `pass` and `skipping` buckets in the same words ("3 passed", "3 passed · 1 skipped"), which lists them at a click. "Open on GitHub ↗" opens `pr.url` through `layout.openExternal`. No pull request: `noPr(branch)`. Untrusted, the GitHub CLI missing or signed out: the card's sentences, with the machine's name when it is not this Mac. **Sign in** (decision 21): on this Mac as the card's button; for another machine drawn only when the machine's `rights` are known and hold `shell`, else the sentence "Signing in needs shell access on `<machine>`", and while the rights are not known neither.

**Refusals told apart** (S9; one function, `readFailure`, in `page-model.ts`, used for the branch read here and for a commit's diff in Review; decision 19):

| what happened | kind | the Commits part | a commit's diff in Review |
|---|---|---|---|
| the machine lists its capabilities and not `rl2.git-reads` (nothing is asked); or an answer of `unknown_command`; or `internal` whose `issues.refusal` is `not-offered` | `older` | "Commits unavailable: `<machine>` runs an older MAWS"; for this Mac "Commits unavailable: this Mac's MAWS service is older than this window" | "Diff unavailable: `<machine>` runs an older MAWS", and the same for this Mac's service |
| `host_unavailable`, `timeout`, or the machine's phase is offline | `offline` | what was last read stays and no error is drawn; with nothing read yet "Commits are unavailable while `<machine>` is offline" | "Diff unavailable: `<machine>` is offline", with Retry |
| any other refusal (`issues.refusal` is set) | `refused` | "Commits unavailable: `<machine>` refused this read", the refusal's word as its title | "Diff unavailable: `<machine>` refused this read", with Retry |
| anything else (git failed) | `failed` | "Commits unavailable: `<message>`" | "Diff unavailable: `<message>`", with Retry |

The other three parts are drawn in every case. Outside a repository the page is "Not a git repository" alone; with no record, "Open a session to see its changes".

**`show_pane`** (decision 20; `src/renderer/src/tools/maws/panes/connect.ts`, a file no child owns): a request for `source-control` with a target opens Review with `{ path: <target> }`, `asked: 'agent'`, and the answer names Review's tab; without a target it opens the page.

**S2 and S12, held by one test** (a new `test/source-control-reads-only.test.ts`, in the shape of `test/one-working-folder.test.ts`): no file under `src/renderer/src/tools/scm/` or `tools/code/review/` holds any of the ten names `scm.stage`, `scm.unstage`, `scm.discard`, `scm.commit`, `scm.push.plan`, `scm.push`, `scm.pr.plan`, `scm.pr.create`, `scm.remote.cancel`, `scm.remote.last` or `scm.remote.output`; and no file outside `tools/code/review/` imports `ReviewView` (after M12 no file is named so; the rule also refuses an import of `FileBody` from outside the folder).

### §I. Copy

New strings, each a decision; they go in `REVIEW_COPY` (`tools/code/copy.ts`) and `SCM_COPY` (`tools/scm/copy.ts`), and where a neighbour already has the words, the neighbour's constant is used (`SUMMARY_COPY` for the pull request's states, buckets, sentences and "Not pushed").

| where | string |
|---|---|
| Review, a section's body | `Binary file` |
| Review, a held file's header (`REVIEW_COPY.fileChanged`) | `This file changed` · `Refresh` |
| Review, a failed row | `Retry` |
| Review, the toolbar | `Collapse all`, `Expand all`, `View` (the menu's name) |
| Review, Last turn's disabled chip (`noTurnChangedFiles`) | `No turn has changed files yet` |
| Review, totals with uncounted new files | `<N files changed> · +A −R, and N untracked files not counted · <scope>` |
| Review, "This branch" off | `noDefaultBranch`: `No default branch to compare with`; `branchNeedsReads(machine)`: `This branch needs a newer MAWS on <machine>`, and for this Mac `This branch needs this Mac's MAWS service to be updated` |
| Review, a diff tab that names a commit on a machine without the reads (`commitNeedsReads(machine)`) | `Diff unavailable: <machine> runs an older MAWS` |
| Review, a commit | chip `Commit <sha7>` (title: the subject); totals `… · Commit <sha7>`; footer `Commit <sha7> · <subject>`, then `· against its first parent` for a merge commit, then `· not on <branch> now` (`· not in HEAD now` on a detached `HEAD`) |
| a line comment's words | `Before the change:` (§A) |
| the card, a thread on another machine | `N screenshots are left out: a side thread on <machine> takes none` |
| Source control | as §H quotes them |

### §J. What other landings can code against

Stable from the milestone named; everything else in this document is internal.

- **A comment on a line of a diff** (M1, M5): `openCommentComposer(anchor, { appSessionId, placement: { kind: 'card', host: 'review', hostId }, destination: 'main', quote })`; a `file-line` anchor may carry `side: 'old'`; `quotedComment` in `src/shared/anchor/message.ts`. From M10 a `file-line` anchor may carry `commit`.
- **Opening Review** (M3, M10): `panelHost.addTool('review', { appSessionId, params })` with `ReviewParams { scope?, path?, turnId?, commit? }`; a `path` brings that file's section into view and unfolds it; a `commit` (a full hash) shows that commit. The DOM a scene or a probe may rely on: `[data-review]` with `data-scope`, `[data-chip="<scope>"]`, `[data-review-file="<path>"]`, `[data-review-file-header]`, `[data-review-body]`, `[data-review-hunk]`, `[data-review-footer]`.
- **The reads** (M7, M8): `git.branchCommits`, `git.commitDiff`, `git.changesSince` (§C); the capability `rl2.git-reads` in a machine's `capabilities`, this Mac's included; `servesReads(machine)` in `tools/code/review/reads.ts`.
- **A side thread on another machine** (M9): `useRemoteUnavailable(appSessionId, 'side.thread.open')` answers by capability (`rl2.side-threads`), phase and ownership; `/btw`'s promotion follows the same hook.
- **Source control** (M11): `SCM_TOOL_ID` and `registerScmTool` as today; `tools/scm/queries.ts` unchanged; the tool takes no params. Gone from M12: `useScm`, `connectScmRunEnds`, `groupsOf`, `ScmParams`.

### §K. What this landing stores and sends, and what the two builds that bind do with it

`F` is `f1852de3a` (wire 3.33, link 1.12); `C` is `2c7044231` (wire 3.46, link 1.14). Read with `git show <sha>:<path>`.

| what | this build writes or sends | F with it | C with it | this build with what they wrote |
|---|---|---|---|---|
| the layout file, both settings files, the index | nothing new: Review's and Source control's view state (mode, marks, folds, places, the commit's chip, the page's folds) lives in the window's memory, as today | — | — | — |
| a diff main tab's stored `ref` | never a `commit:` word: nothing opens such a tab (§E) | would keep the tab and draw "Diff unavailable: unknown ref", were one ever stored | the same | reads every ref F or C can store |
| a Review comment's text in an engine transcript, one comment (U5b-1) | today's text, whose words begin with a fenced quote (and "Before the change:" for a removed line); the tag carries `side="old"` for a removed line | reads it as its own: `side` is in F's schema and tag fields, F's lead for a `file-line` anchor ignores it, so the lead is stripped and the chip drawn; the quote is a code block in the bubble | the same | the same |
| a message of several Review comments (U5b-1) | U5a's framed form | as U5a's §J says of any framed message: one chip, the rest as text | reads it whole | — |
| a comment that names a commit (U5b-2) | the tag's `commit` attribute and the lead's new words | F's and C's strict schema refuse the tag, so the message is drawn as the text it is, with no chip; nothing is lost | the same | neither writes one |
| `git.branchCommits`, `git.commitDiff`, `git.changesSince` to a daemon of F or C on this Mac | never: the local machine does not list `rl2.git-reads` below `GIT_READS_MINOR` (§D) | were one sent: `unknown_command`, which reads as "older" (§H) | the same | a window of F or C never sends them |
| the same, to a machine on F or C over the link | never: its endpoint does not list the capability, and main holds the command (§D) | were one sent: `not-offered` at the endpoint, before its services | the same | — |
| `side.thread.open` over the link | only to a machine that lists `rl2.side-threads` | F lists neither that nor `rl2.session-acts`; the checkbox stays locked | C lists `rl2.session-acts` and not `rl2.side-threads`; locked | a window of F or C keeps the row declared and sends nothing |
| `side.thread.open` to this Mac's daemon with an anchor that carries `commit` | only where that daemon served the commit's diff, so it knows the field; and `refuseUnservedSideThreads` (`src/main/machines/side-thread-peer.ts`) refuses it below `GIT_READS_MINOR`, as it refuses `more` below its own minor, in case the daemon was replaced in between | a daemon of F would drop the key and open the thread without the commit; the guard refuses first, in the card's words, and "Send to main instead" stands | the same | — |
| the ten `scm.*` commands and `scm.remote.output` | never sent, never listened to | F's window still sends them to this build's daemon, which serves them as today | the same | — |
| `scm.pr.state` for a remote that is not on GitHub | `error: 'no_remote'` from this build's services | F's window hides the line on `no_remote`, as it already does for a repository with no remote | the same | this build's window with a daemon of F or C still gets `gh`'s first line and shows "PR state unavailable · …" there until that daemon is updated |

**U5b-1 takes no wire minor and changes no stored form** that either build reads differently from its own: by this table it owes no cross-build run (R7 puts that to the architect, with the one scene it would be). **U5b-2 takes one wire minor** (M7) and one step of the link's protocol, and owes two cross-build runs, one against each build. Its scenes are appended to `e2e/cross-build.spec.ts` with a block comment "UX wave U5b: … (UC-14)" and one line in the head comment; the coverage table's row for this landing reads "no stored key; the reads and the commit's tag, below". Each scene is guarded only by a probe of the peer's source, never by `sameWire`, so that it runs in the equal-wire mode as well:

1. *(reads, on the peer's daemon)* this build's window on the peer's daemon (the peer's source has no `git.branchCommits` in `src/shared/ipc/names/git.ts`): Source control draws its first two parts and the Pull request part, and the Commits part reads "Commits unavailable: this Mac's MAWS service is older than this window"; in Review, Uncommitted lists the scratch repository's files with the new file's badge and no count, and "This branch" is disabled with its title.
2. *(source control, from the peer)* the peer's window on this build's daemon (the peer's source has `src/renderer/src/tools/scm/CommitForm.tsx`): the peer's pane stages one file and commits it, and the scratch repository's `HEAD` moved. It proves the commands stay served. The scene that today drives build F's pane against this tree's daemon stays as it is.
3. *(a commit's comment, to the peer)* a session whose transcript holds a comment this build made on a commit's diff (the text written by this build's `commentsMessage`): the peer's window draws the message's words and the quoted line, and no chip.

### §L. Dependencies on other landings

All on master at the pin, each with its execution document under `docs/doperpowers/plans/2026-11-12-ux-wave-`.

| landing | what this one consumes, by the name it is exposed under |
|---|---|
| **U5a** (`…-U5a-comment-card.md`) | `openCommentComposer` and `CommentContext` (`tools/code/anchor/anchor.ts`); `CommentCardHost`, `CardFrame` (`side/card/CardHost.tsx`); the pass and its acts (`side/card/store.ts`: `openCard`, `registerCardHost`, `unsentOf`, `composingOf`, `editComment`, `discardComment`, `dropSession`, `passKey`); `sendPass`, `sendComments` (`side/actions.ts`); `commentsMessage`, `readAnchoredMessage`, `anchorLead`, `anchorTag` (`src/shared/anchor/message.ts`); the transcript's row for a message of comments, which draws each comment's words through the markdown pipeline (`transcript/view/rows/User.tsx`, `CommentParts`), so a fenced quote needs no edit there; `refuseUnservedSideThreads` (`src/main/machines/side-thread-peer.ts`). What it left for this landing, by its own table: the host kind `review`, the layout `inline`, `quote`, `side: 'old'`, the unsent rows, the toolbar's chip, a side thread that opens in the Side pane, and the offer for `side.thread.open`. |
| **U8a**, **U8c** (`…-U8a-working-folder.md`, `…-U8c-live-working-folder.md`) | `workingFolder(record)` (`src/shared/sessions/working-folder.ts`) and `useWorkingFolder(appSessionId)` (`sessions/working-folder.ts`): the live folder, for a session MAWS runs, a terminal session on this Mac and a session MAWS runs on another machine. `forSession` already starts Review over on a change of folder; the endpoint's `CheckoutBounds` already admit the working folder for a `git.*` read. `test/one-working-folder.test.ts` holds A19. |
| **U9** (`…-U9-other-machines.md`) | UC-7.6's five places (its §2); `OFFERS` and the `checkout` row (`src/endpoint/offers.ts`); `ENDPOINT_CAPABILITIES`; `REMOTE_NEEDS`, `REMOTE_UNAVAILABLE`, `ACT_WORDS`, `disabledWords`, `refusalWords` (`src/shared/ipc/remote-unavailable.ts`); `useRemoteUnavailable` (`lane-b/remote-unavailable.ts`); `routeLaneB`, `MACHINE_ACTS`, `STEPPED_UP`, `BUDGETED_ACTS` (`src/main/lane-b/remote.ts`); `OWNED_STARTS` (`src/main/device/step-up.ts`); the fork over the link, whose row, `FORKS` entry and `forkFromAnotherMachine` are the model for M9; `useMachineMark`, `useLinkPhase` (`app/machine-mark.ts`) and the one phase rule (`src/shared/machine/link-phase.ts`); `test/lane-b/offer-coverage.test.ts`. |
| **U3a** (`…-U3a-arrivals.md`) | Nothing by name. The transcript's model has one writer at a time (UC-3), and this landing edits no file under `transcript/`. |
| **U8b** (`…-U8b-column-and-tabs.md`) | `panelHost.addTool(toolId, { appSessionId, params, asked? })` (`panel/host.ts`): a tool that is opened is shown in place of the one in view, and goes to the group that already holds its tab; `WIDE_SURFACES` and `NARROW_AUTOMATIC_WIDTH` (`app/shell-geometry.ts`), read and not edited. |
| **U13a** (`…-U13a-one-strip.md`) | The cross-build spec and its coverage table (the comment block in `e2e/cross-build.spec.ts`), §K. |
| **U6a** (`…-U6a-keymap.md`) | Nothing: no action id is added (UC-6). |
## Probes

- **P2, the diff library in a stack: done** (`spikes/protocol-probe/findings-uxwave-u5-diffview.txt`). The card survives only while a file's `data` object is the same; `extendData` rows are remounted at every refresh and keyed by line number. Decisions 10 and 11 are its consequences. Left for the running app: a real input method's composition in the card, and the cost of a body that re-enters the band ("Proof that an executor does not run").
- **P5, the cost of the reads: not run.** Time `git.changesSince` against a merge base, `git.branchCommits` with `limit: 50` at its two-minute tick, and `git.commitDiff`, on the owner's largest repository, on this Mac and over the machine link; report durations, the counts of files and of untracked files, and nothing else of the repository. It sets `UNTRACKED_COUNT_FILES` (200 is the starting value) and says whether the branch read's two minutes can stand. It needs M7 on a machine, so it runs on U5b-2's build before the pull request; the architect arranges it.
- **P8, what `gh` says of a pull request that cannot merge: not run.** On a scratch GitHub repository, `gh pr view --json mergeStateStatus` for a pull request that is clean, behind its base, in conflict, blocked by a required review, and a draft. The table of §H is written at the values GitHub documents for the field (`CLEAN`, `HAS_HOOKS`, `DIRTY`, `BEHIND`, `BLOCKED`; `UNSTABLE`, `DRAFT` and `UNKNOWN` add no word); a value the probe finds otherwise changes that table and nothing else. The architect arranges it before M11's review; no engine is involved.
- **No engine probe is owed.** Nothing here depends on what the engine sends: a Review comment is U5a's text, whose delivery P1 and P7 proved, and the reads are git's.

## Acceptance

The child's lines, as its Edges assign them, each with where it is proven. A line is the child's text; this table adds nothing to it.

**U5b-1.**

| line | proven by |
|---|---|
| A6, but its sentence on a commit | M1 and M5's unit tests; `e2e:side`'s new scene; routes: M5's locked-checkbox case, and the terminal route by U5a's `sendToSession` tests, unedited |
| A7 | M3's suite; `e2e:code` |
| A8 | M4's count of drawn bodies over 200 files; M3's case of a scope past 8 MiB. "Does not freeze the window" at 200 real files: a look on a Mac ("Proof that an executor does not run") |
| A9 | M4; `e2e:code`'s hunk scene across two files. The turn's Undo: no file of the work divider's menu is in the diff (`git diff --stat origin/master -- src/renderer/src/transcript` prints nothing) |
| A10 | M4's regression case; `e2e:code`'s "the place survives" |
| A13 (a) to (c) | M2, M3 |

**U5b-2.**

| line | proven by |
|---|---|
| A6's sentence on a commit; S19 | M10 |
| A11, A12 | M7 (the reads over scratch repositories), M10 (the window), M8 (another machine: the rows and the capability); `e2e:code`, `e2e:remote` |
| A13 (d) | M7; the page having no Pull request part: M11 |
| A14, S1, S3 to S10 | M11; S9's endpoint and device halves in M8 |
| S2, S12 | M12's guard test |
| S11 | M3's header case, still green |
| S13, S14, S16 to S18, S20, S22 | M10 (Review), M11 (the row); `e2e:scm` and `e2e:remote` |
| S15 | M7 |
| S21 | M7 (services), M10 and M11 (the window, with a fake clock) |
| A14's sitting | the owner, on U5b-2's build |
| A19 | `test/one-working-folder.test.ts`, unedited, and M12's guard |

A15 and A16 are not built. A1 to A5, A17 and A18 are U5a's and landed.

## Proof that an executor does not run

Each line has an owner other than an executor.

| what | when it can start | what it needs | what comes back |
|---|---|---|---|
| **The adversarial review of this document** | now | the architect's dispatch | findings; this document revised on the rulings |
| **The rulings on R1 to R7** | now | the architect | each default confirmed or changed at its one place |
| **The drawn example of the stacked Review and its line comment** ("For the owner") | before M3 | the nine frames, drawn outside the repository with invented content, and cards 1, 2, 4, 5 and 6 put to the owner | the answers; a card answered otherwise changes its one place |
| **The added frames of Source control's example** | before M11 | the six states listed, and card 3 | the answer |
| **The owner's look at the stacked Review on a real change** | on U5b-1's build, before it lands | a session whose agent changed a dozen files, one of them new, one binary; the owner reads it in the stack, comments on two lines and sends, leaves and returns | the owner's word that the change reads in one scroll and the comments arrived as one message; anything seen differently |
| **A real input method in the card under a line** (P2's remainder) | with that look | a person typing a composition in the card while the agent changes another file, then the same file | the composition completes in the first case; in the second the file holds still and "This file changed · Refresh" is drawn |
| **A8 at real size** | with that look, or on a Mac under the load rule | a scratch repository with 200 changed files | scrolling to the last file does not freeze the window; the count of drawn diffs read from the page |
| **The e2e scenes of U5b-1** on a Mac under the load rule | after M6 is pushed | the new and reworked scenes alone first (`e2e/code-tools.spec.ts`'s rewritten scenes and "the place survives"; `e2e/side.spec.ts`'s line comment); then the groups `e2e:code` and `e2e:side`; `e2e:panel` and `e2e:layout`, whose scenes open Review as a tab and should stand; the hand-run `e2e/code-tools-live.spec.ts` once | green runs by id |
| **The branch review of U5b-1** | after M6 | `doperpowers:review-code`, the xhigh panel, over `origin/master...ux-wave/U5b` at M6's head | a verdict and findings; the fixes are one wave through the controller |
| **Class 1a for U5b-1** | once, on the head its pull request will carry | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u5b-1`, in the background | the run's id |
| **P5** | once M7 runs on a machine | "Probes" | durations and counts; the cap |
| **P8** | before M11's review | "Probes" | the five values |
| **The e2e scenes of U5b-2** on a Mac | after M12 is pushed | the new and reworked scenes alone first (`e2e/scm.spec.ts`'s page, commit and pull request scenes; `e2e/remote.spec.ts`'s Source control steps; `e2e/code-tools.spec.ts`'s follow-the-agent and numstat scenes); then the groups `e2e:scm`, `e2e:code`, `e2e:remote`, `e2e:side`; `e2e:panel` and `e2e:lane-a`, whose scenes read the Environment card's rows and should stand | green runs by id |
| **The two cross-build runs of U5b-2** | after M12 is pushed | `scripts/ci-gate.sh "$PWD" --gates e2e:cross-build --peer-exact f1852de3a --label u5b-xb-f` and the same with `--peer-exact 2c7044231`, each in the background | each run's id, with §K's three scenes named as run and green in each; a skipped scene is not evidence |
| **A side thread on another machine, by hand** | on U5b-2's build, two machines of this build | an owner of the second machine comments unticked on a session there; a member who does not own it tries the same | the thread opens there and here for the owner; the member's checkbox is locked with the owners' sentence |
| **The owner's sitting on Source control's page** (A14) | on U5b-2's build, before it lands | a real session in each of four states (work in progress with no pull request; a pull request with checks running; one with a failed check; one merged) and one session on another machine; two commits opened from the list in each | the owner's word, per state, whether the page told what was happening and whether a commit read as the stacked Review does |
| **The branch review of U5b-2** | after M12 | `doperpowers:review-code`, the xhigh panel, with U9's reviewer on §D's insertions (UC-7.6) | a verdict and findings |
| **Class 1a for U5b-2** | once, on the head its pull request will carry | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u5b-2`, in the background | the run's id |

## Size and review

Counted from the code at the pin: the files that change or go, at their line counts, and for new code the size of what it replaces or of its nearest neighbour. Added and removed lines; a rewritten file counts both.

| milestone | source | tests | scenes and record | files |
|---|---|---|---|---|
| M1 | +130 | +290 | | 10 |
| M2 | +430 −70 | +460 | | 6 |
| M3 | +900 −540 | +800 −640 | | 15 |
| M4 | +260 | +330 | | 6 |
| M5 | +360 | +460 | | 9 |
| M6 | | | +700 −540 | 7 |
| **U5b-1** | **+2,080 −610** | **+2,340 −640** | **+700 −540** | **about 42** |
| M7 | +410, and about 90 generated | +500 | | 17 |
| M8 | +100 | +280 | | 12 |
| M9 | +130 | +240 | | 12 |
| M10 | +820 −150 | +1,080 −160 | | 19 |
| M11 | +1,050 −480 | +1,070 −750 | | 14 |
| M12 | −1,890 | +70 −1,900 | +770 −600 | about 50 |
| **U5b-2** | **+2,510 −2,520** | **+3,240 −2,810** | **+770 −600** | **about 115** |

The fixed points under those numbers: Review's source is 1,621 lines today, of which `ReviewShell.tsx` (390), `ReviewView.tsx` (176) and `view-state.ts` (97) are replaced, and `review.test.tsx` is 1,237 lines, of which its two component suites (about 635 lines) are rewritten; the harness probes are 295 lines; Source control's source is 2,342 lines, of which 1,701 go, 497 are rewritten and 144 stay, and its tests 2,657 lines, of which 1,837 go and 746 are rewritten; `test-support/scm.ts` is 214 lines; `e2e/scm.spec.ts` is 470 lines and its support 237. The child's own estimate for l5-code-06 (2,175 added, 4,500 removed) counted neither l5-code-03 and -04, the link, the side thread, nor the cross-build scenes.

**Review rung.** Both pull requests take the `doperpowers:review-code` xhigh panel: each is far past twenty files and two thousand changed lines, and U5b-2 changes U9's offers, which the root calls delicate. Lenses:

- *U5b-1:* (1) the card's draft and flight contract on the new host: nothing typed is lost across a re-read, a refused send, a hidden surface; (2) the stack's scroll arithmetic: the band, the pending place, a jump into an unread file, and whether any path writes the scroller after the person's input; (3) the persisted text: no byte of a lead or a tag moves, and both older builds read a Review comment as their own; (4) keyboard and accessible names of the stack (sticky headers, fold buttons, the add button, the menu); (5) whether the harness probes and the rewritten scenes still assert what the old ones asserted.
- *U5b-2:* (1) the boundary: the four offer rows, the checks at the endpoint on the values the acts use, the side thread's ceiling on its own path, the screenshot path, revisions and paths that could read as git options, the service's own file reads for counts (symbolic links, paths outside the repository); (2) both builds: the capability on each path, the tolerant reader, the wire minor, the local daemon; (3) git's meaning: the base rule, merge bases, first parents, a root commit, counts past the limit, a detached `HEAD`, a deleted upstream, SHA-256 repositories; (4) the asynchronous reads: the branch read's schedule, kept diffs, the three retries, stale answers after a failure; (5) the removal: no caller of a removed thing remains, and nothing served changed; (6) one fact, one value: the card, the page and Review.

**The e2e groups whose scenes cross what moves** (by their names in `package.json`): `e2e:code` (`e2e/code-tools.spec.ts`: fourteen scenes rewritten in M6, two of them touched again in M12, one added in M6); `e2e:side` (one scene added in M6); `e2e:scm` (`e2e/scm.spec.ts`: three scenes deleted, three rewritten, two added, two standing, in M12); `e2e:remote` (the Source control steps of the first scene, in M12); `e2e:cross-build` (three scenes added in M12; the scene that drives build F's pane against this tree's daemon stands, since the commands stay served). Adjacent and expected to stand: `e2e:panel`, `e2e:layout`, `e2e:lane-a`, `e2e:p1-live` (its two comment sittings are on an artifact's card and do not change, so no paid run is owed). Hand-run and edited: `e2e/code-tools-live.spec.ts`, `e2e/c12-prerun.spec.ts`. `e2e:requests` and `e2e:discover` hold no scene over these surfaces.

## The pull requests

Opened on the architect's word, not by an executor. Each body opens with the composite's path, the child id (U5) and the parent pin, names its items and its board ticket, its class 1a run by id, the branch review's verdict and what was done with each finding, the e2e groups and scenes that ran and where, and its residue. Each ends with the session line the build brief gives.

- **U5b-1** (ticket 590): l5-code-05, X-072, l5-code-12 (a) to (c), l5-code-01. It carries the dated lines of M6's record. Residue to name: "This branch" and the untracked rows are unchanged until U5b-2; the acting pane still draws its own diff through the old `ReviewView`; a real input method in the card was looked at by hand; no cross-build run (R7).
- **U5b-2** (its own ticket): l5-code-03, l5-code-04, l5-code-06, l5-code-12 (d), the commit in a comment, UC-7's insertions. It carries the dated amendments of the rulings l5-code-06 reverses, where they stand (M12's record), and names its two cross-build runs by id, P5's and P8's results, and its residue: the ten `scm.*` commands and the event left on the wire; a machine of an older build keeps "This branch" off and `gh`'s raw line until it is updated (R2, §K); the card's and the page's sums leave new files' lines out (R3); a side thread on another machine takes no screenshot; the Environment card's Sign in for a reader without shell access; a push made from an older window is followed by the refs listener and the poll, not by its run's end.

## Surprises & Discoveries

- Observation: the child's "This branch" and its count of new files rest on a read no command provides; `git.diff` with a base reads `<base>...HEAD`.
  Evidence: `GitService.diff` in `src/services/git/service.ts`, the line that builds `range`; R1.
- Observation: `side.thread.open`'s handler does not look at the caller's origin, so the fork's ceiling check for another machine's caller is not on its path.
  Evidence: `src/services/sessions/service-register.ts` (the `session.fork` handler branches on `ctx.op`, the side thread's does not) and `openSideThread` in `service.ts`; decision 16.
- Observation: main holds `REMOTE_NEEDS` only for commands the lane B adapter handles; a `git.*` read crosses the link unchecked on the device.
  Evidence: `run` and `routeLaneB` in `src/main/lane-b/remote.ts`; decision 14.
- Observation: A19's rule is already held for the whole of `src/` by U8's test, and Review and Source control already read the live folder.
  Evidence: `test/one-working-folder.test.ts`; `ReviewTool.tsx`, `ScmTool.tsx`.
- Observation: both builds that bind accept `side` on a `file-line` anchor and ignore it in the lead, so a Review comment on a removed line reads as their own as long as the lead does not change.
  Evidence: `git show f1852de3a:src/shared/anchor/message.ts` and `git show 2c7044231:src/shared/anchor/message.ts`, `leadParts`, case `file-line`; R6.

## Decision Log

- **2026-11-15 · Verification.** This document gets an adversarial review before an executor starts (the architect dispatches it). Each pull request's branch gets the `doperpowers:review-code` xhigh panel ("Size and review" gives the size and the lenses; U5b-2 also because it changes U9's offers), with U9's reviewer on §D's insertions. Class 1a on GitHub Actions is the gate of record for each. U5b-2 owes two cross-build runs, one against each build that binds; U5b-1 owes none as written (R7).

## Outcomes & Retrospective

Pending — written at finish.
