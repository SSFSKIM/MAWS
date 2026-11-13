# UX wave · U8c: the live working folder (2026-11-12)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave, a composite), child **U8**, third pull request (**U8c** in the root's "Ordering and dependency map"): contract UC-4's second landing. **Parent pin:** `6b58dd6532e2cbb95861d6174cc929341b38b314` (branch `ux-wave-spec`; the same files are on master since `89e25cb20`).
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U8-card-column-working-folder.md`: Contracts → "UC-4 (owned)", acceptance A10, the item "l5-code-14 · The card and the code surfaces follow the agent" (its *Second* landing and everything under it), and under "Probes and checks" the folder probe's outcomes and the open check on a transcript file that moves. Where that file and UC-4's statement in the root differ, the root binds. This document carries the constraints and the milestones, and of the design only what the child's file leaves open. U8a (on master), U8b (in build) and U8d are other landings of the same file.
> **Binding on this landing:** UC-4 (owned, second landing), UC-3 (the transcript's model has one writer at a time), UC-8 (who owns which files), UC-10, UC-11, UC-14 (what is stored, build F can still read); laws 1, 3, 4, 5, 6.
> **Branch:** `ux-wave/U8c`, from master `89e25cb20b437822676c5a8a52ea575e372c6217`. **Board:** #593. **Written against** that commit. Build F (the build on the owner's machines) is `f1852de3a`. Landings in flight were read on their branches at `f9b53723d` (U8b), `95d56a8ee` (U3a), `89e9ed067` (U9), `2fe7fd025` (U4a, its document only), `aa66cf2b9` (U5a), `8be4eb94f` (U13a), `d2b41c53f` (U7), `c4c846169` (U1a); each has moved since, which is why "To check again" exists.

## Purpose

The owner's agents usually move themselves into a git worktree soon after a session starts, by the engine's worktree tool or by a shell `cd` into a worktree made with `git worktree add`. Today the window keeps looking at the folder the session was launched in: the Environment card names it, Review and Source control diff it, Files lists it and a new terminal opens in it, while the agent works somewhere else. After this landing the card says where the agent is (the folder, the branch git reports there, and one muted line "moved from …"), Review, Source control and Files show that folder, a new terminal starts in it, and all of it returns when the agent comes back. It is the same for a session MAWS runs, a session started in a terminal, and a session on another machine.

How to see it working, on the wave's build: in a session whose repository has a worktree, have the agent enter it (by `EnterWorktree`, then again by `cd`); within the turn the Environment card shows the worktree's folder and branch with "moved from <the launch folder's name>", Review lists the worktree's changes, Files opens on it, a new terminal starts in it and a terminal opened before says it is still in the launch folder; have the agent leave, and all of it returns. In the suites: a test that moves a real transcript file under each reader (M1), a test that replays the probe's two recorded sessions through the index and asserts one answer for both (M2), and the suites named under each milestone.

## Progress

- [x] (2026-11-13) Document written against master `89e25cb20` and the branches named in the header: the open check read from the code (three findings, "What the code holds today" 1), the index's filing rule, the stored and sent fields against build F, the surfaces at the moment of a move, and the files other landings edit.
- [ ] Adversarial review of this document (the architect dispatches it), findings settled.
- [ ] The author's second pass over "To check again", once U8b (and U3a) are on master, before an executor starts.
- [ ] The architect's rulings on "Reported to the architect" (each changes one named place).
- [ ] M1 — A moved transcript keeps its readers.
- [ ] M1's cases on macOS (`unit:darwin`; the architect runs it).
- [ ] M2 — The record says where the agent is.
- [ ] M3 — What may be read there.
- [ ] M4 — The window follows.
- [ ] M5 — A shell row keeps its folder.
- [ ] M6 — The scenes, the record, and the acceptance run.
- [ ] Hand-back to the architect (class 1a, the branch's review and the pull request are the architect's).

## To check again once U8b and the others are on master

This document is written against code that is not on master yet. Each line below is a statement of this document about another landing's code; the author checks every one on the master the executor will start from, and corrects the place named.

1. **U8b, the card** (M4, Interfaces §G). `panel/summary/Summary.tsx` holds `RecordCards({ appSessionId, record })`, which computes `workingFolder(record).path` once and starts the card's git watch in one effect keyed `[machine, directory, appSessionId]`; `Environment({ appSessionId, record, directory, fold })` draws the folder row as `<Row action={<ToolButton toolId="files" …/>}><span className="block truncate" title={directory}>{directory}</span></Row>` and the branch row from the git store's status for `checkoutKey(machine, directory)`; the copy for a watch that has not answered is `SUMMARY_COPY.pending`; neither row has a test id; `panel/summary/Summary.test.tsx` pins the folder text, `⎇ main`, the change line and `git.watch` called with exactly one directory.
2. **U8b, the change line.** `tools/code/review/ReviewSummary.tsx` is a button named "Open changes" whose counts carry `data-testid="change-line"` on an inner span; it reads `useWorkingFolder(appSessionId)?.path`.
3. **U8b M6** (not built when this was written) edits `src/engine-host/fs/service.ts` and `chain-follower.ts` for the exit a gone terminal leaves. M1 edits `service.ts` at other functions (`summarizePath`, `locateFollows`, `relocateFollows`); whichever lands second merges master first.
4. **The wire minor.** `WIRE_MINOR` is 36 on master; U8b, U3a, U1a, U5a, U11a and U12a each take 37 on their branches and U4a plans one more. This landing's number is the next free one on the master it merges last (Concrete Steps, step 2 of M2 and the last step of M6).
5. **U3a, the file reader** (M5). `recordToEvents(record, ctx)` in `src/engine-host/fs/backfill.ts` builds a tool call's event in `assistantEvents(record, uuid, ctx, base, events)` with the whole row in scope; the `tool.use` event is `{ toolUseId, toolName, input, apiMessageId, messageUuid }` in `src/shared/graph/events.ts`; `eventsOf` in `src/renderer/src/lane-a/plane-transcript.ts` passes another machine's rows to the same function. U3a's M4 (not built) extends `NormalizerState`; this landing adds nothing to the live normaliser.
6. **U1a, the request's folder line** (M4). On U1a's branch the line is drawn only for `placement === 'hover'` in `request-card/RequestCard.tsx` (`title={record.directory}`), and unchanged in `sidebar/RequestPreview.tsx`; `preview/ProposedChange.tsx` reads `useWorkingFolder(appSessionId)?.path` and follows by itself.
7. **U4a** (document only) leaves the composer's folder line alone (its §M) and edits `composer/Composer.tsx`, `composer/frame/bindings.ts` and `session/controls/lane-a.ts` at other lines; its M3 may rename `QueueList.tsx`, which takes `cwd` as a prop today.
8. **U5a** adds one reader of the selector outside this document's lists, the export dialog's fallback folder in `src/main/app.ts` (`workingFolder(record).path`): it follows the agent after M2 and needs no edit. U5a edits no file under `tools/code/review/` or `tools/scm/`.
9. **U5b, if it is on master.** Its item l5-code-06 turns Source control into a page that runs no git; M4's decision 6 (Source control starts over on a move) then has nothing left to reset but the page's own reads, and the two gaps it names are gone. Its stacked Review keys the body, the viewed marks and the scroll anchor by folder (U5's file, "UC-4 (consumed)"); M4's decision 5 is then already true and only its test remains.
10. **U9** edits `src/endpoint/targets.ts` only at `Placing` and `laneB()`; `rootsOf`, `checkoutOf`, `CheckoutBounds` and `withinCheckout` are as on master. A record of another machine reaches this window whole through `session.get` and the checkout feed's `session.changed` (`src/main/lane-b/remote-session.ts`, `remote-checkout.ts`), read with the tolerant reader.
11. **U13a, the coverage table** (M6). It is a section of U13a's document (its M5, "The coverage of UC-14") and a comment block in `e2e/cross-build.spec.ts` under "U13a: what the wave stores, build F reads (UC-14)", with the columns `stored | F reads this build's value, and writes on | this build reads F's value`, and the scenes run with `--gates e2e:cross-build --peer f1852de3a`. U13a and U8b both edit the hydration call in `ipc/events.ts`; M4's edit there is in `connectPanelEvents` and `repoRootOf`'s neighbourhood.
12. **U7** changes neither the sidebar row's worktree mark (`sidebar/SessionRow.tsx`, `record.worktree !== null`) nor the hover card's place (`placeOf` in `sidebar/HoverCard.tsx`); U7a's `cutPrompt` is another function of `src/services/index/sessions.ts`.

## Reported to the architect

Each is a place where the code contradicts the section, or where a decision changes what the owner sees beyond the section's words. The recommended default is written into this document so that a ruling changes the one place named.

1. **The open check: two readers lose a moved transcript, and the record is told removed for an instant.** All three are today's behaviour on build F ("What the code holds today" 1). Fixed in M1. The first two are findings for the owner; the third is an improvement the section does not name (default: fix it; to drop it, strike M1's decision 4).
2. **A `relocated` row is not only the worktree tool's.** The engine also writes one when the person moves the session with `/cd` or a host sends `set_cwd` (engine `2.1.322`, `cli.pretty.js:381469` called from `:947458`; not probed). Stopping the launch folder on every such row would leave a session the person moved to another repository filed under the old one with nothing following. Default: the launch folder stops moving only for a relocation inside the launch project; any other files the record where it went, as today (M2, decision 2).
3. **"Neither may be taken from the newest row's `gitBranch`."** Read literally, the index would ask git at every summary, and a cold scan would relabel every past session with the branch its checkout is on today. Default: the record's branch is the row's wherever the engine's rows describe the working checkout (the launch folder, a worktree entered through the tool), and git's where they cannot (a `cd` into another checkout), which is the case the probe found wrong (M2, decision 4).
4. **What the launch folder's stop takes away.** On build F a session whose agent enters a worktree through the tool is re-filed under it, so its sidebar row gains the worktree mark and its hover card reads "worktree <name>". With the launch folder fixed, neither appears for a worktree the agent moved into; the card says it instead. UC-4 lists the hover card among the readers of the record. Default: both stay on the record (M4, "What it does not touch"). The other reading, the mark and the hover card following the agent, is a change of UC-4's list.
5. **More readers of the engine's status folder than the section names.** Besides the composer and the location chip: `composer/resubmit-seam.ts`, `widgets/SkillsWidget.tsx`, `widgets/PluginsWidget.tsx`, and the worktree occupancy count through `engine.sessions`. Default: the resubmit seam moves with the composer; the two widgets and the count stay (M4, decision 1).
6. **A shell row's folder on the live wire.** The engine's wire names a folder once per turn (`system/init`) and never per call; only the transcript's rows carry it. Default: a shell call shows its row's folder where rows are read (a session read from disk, a terminal session, another machine's rows) and "Session directory <launch folder>" where they are not (a session MAWS runs, while live), never the folder the agent is in now (M5). Carrying the folder on the live route would need a new journal row; law 4.
7. **Source control's acts are left with two named gaps** (M4, decision 6) because l5-code-06 removes every act; if U5b is not to land, the gaps need the service to be told the folder an act was made for.
8. **First run after build F: no forced re-read.** A session shows its working folder from its transcript's next row under this build; until then it reads as F filed it. Forcing every transcript to be read again at the first run (and after each stay in F) costs a cold scan each time. Default: not forced (M2, decision 6).
9. **Not recorded by the probe, and worth a check on the probe VM before M2 lands:** a fork (`--resume <id> --fork-session`) started from the launch folder of a session whose transcript sits in a worktree's project folder. The resume is recorded (`uxwave-folder-control-resume-from-launch-folder.jsonl`); with the launch folder fixed, MAWS starts both from the launch folder where build F started them from the worktree. If the fork fails, the fix is one place: the folder a resume or fork starts in takes the stored summary's `relocatedCwd` when that folder exists.
10. **New words on screen:** "moved from <name>" and "in <sub-folder>" on the card, and "working folder" beside a root in Files. See "The owner's look".

## The landing's edge

**In.** The proof that MAWS's readers follow a transcript the engine moves, and the fixes it needs. The signal (the folder of the main transcript's newest row) read by the transcript's summary and carried on the record as one optional field, the same on the three routes. The launch folder that stops moving. The selector's answer following the field. The folders a session's files may be read from, widened by the working folder under the checks every root passes. The card's rows, Review, Source control, Files, the composer's folder, the location chip and a request's kept folder line following it; a shell row keeping its own folder. The stored column and the wire's three optional keys, against build F in both directions. The e2e scenes and the cross-build row, written and not run.

**Out, left to U8's other landings or to other children.** The card column itself and its rows' shapes (U8b). A terminal session's subagents on this Mac (U8d). The name and the base of a worktree made by New chat's Worktree box; a move by a subagent; moving an open terminal (the section's "Not included"). Another repository: a folder outside the launch project is never the working folder. Review, Source control and Files themselves (U5, U6): this landing changes where they read and what they reset. The sidebar's row and hover card (U7; Reported 4).

## Words used here

- **The launch folder:** the folder a session's record names, `record.worktree?.path ?? record.directory`: where the session was started. In the selector, `launch`.
- **The working folder:** the checkout the agent's main loop is working in now (UC-4). In the selector, `path`. **The agent's folder:** the folder itself, which may be a sub-folder of that checkout; in the selector, `cwd`. **Moved:** `path !== launch`.
- **The selector:** `workingFolder(record)` in `src/shared/sessions/working-folder.ts` and the hook `useWorkingFolder(appSessionId)` in `src/renderer/src/sessions/working-folder.ts` (U8a). Every reader of the session's folder asks it.
- **A row:** one line of a session's transcript file (`<config home>/projects/<slug of a folder>/<session id>.jsonl`). Rows the engine writes for a message carry `cwd`; bookkeeping rows (`relocated`, titles, modes) do not. **The newest row's folder** is the `cwd` of the last row that carries one.
- **The home:** the folder the engine itself files the session under, the tail's last `relocated` row's `relocatedCwd`, else the first row's `cwd`. The engine moves it, and the transcript file with it, on `EnterWorktree`, `ExitWorktree` and a `/cd`; a shell `cd` does not.
- **A move by the tool / by `cd`:** the two ways the probe recorded (`spikes/protocol-probe/findings-uxwave-U8-working-folder.txt`). By the tool the home moves and the rows' `gitBranch` follows; by `cd` neither does, and only the rows' `cwd` says so.
- **The summary:** what the engine host reads of a transcript from its first and last 64 KiB (`summarize` in `src/engine-host/fs/summarize.ts`, `TranscriptSummary` in `src/shared/wire/store.ts`), sent as `fs.sessionChanged` on every change of the file. **The index:** the machine's SQLite store of session records (`src/services/index/`); `upsertFromSummary` in `sessions.ts` turns a summary into the record.
- **A follow:** the engine host reading one transcript forward and sending its rows as events (`Follow`, `ChainFollower`, `FsService` in `src/engine-host/fs/`).
- **The three routes** (law 5): a session MAWS runs; a terminal session; a session on another machine.
- **Build F:** `f1852de3a`, the build on the owner's machines, which may open the same profile again after this build has written to it.
- **The VM:** the wave's build machine, where every check of an executor runs. **Class 1a:** typecheck, lint, the unit suite and the probes on GitHub Actions through `scripts/ci-gate.sh`. **The Mac lane:** the gate's job `unit:darwin`, which runs on macOS the unit files that hold a case guarded `skipIf(process.platform !== 'darwin')` (`scripts/darwin-unit-files.sh` finds them by that text).

## Acceptance

A10 of the child's file, as written there, on the three routes. It is shown by these observations; the commands are in Concrete Steps.

1. A real transcript file moved between two project folders, with its session folder, is read on by the session's follow, by a follow of one of its agents and by a terminal session's job reader, and no removal of the session is told; the cases for the two losing readers and for the removal fail on master (M1). On macOS the same cases pass in the Mac lane.
2. Replayed through the summary and the index, the probe's two recorded sessions (headless: a session MAWS runs; terminal) give at every step one answer, the same for both: the launch folder never changes, and the working folder, the agent's folder and the branch are the table of Interfaces §E (M2).
3. A record that carries the field read through the link's codec gives the same selector answer; a record without it (build F's, or another machine's on build F) answers the launch folder (M2).
4. The files service lists and reads the working folder only when it is a registered worktree of the launch repository at the moment of the call, for this machine's window and for a caller on another machine, and refuses a folder that was unregistered or replaced since the record was written (M3).
5. With a record whose agent moved, the Environment card shows the working folder, the branch git reports there and "moved from <name>"; Review, Source control and Files show that folder; a new terminal starts in it and an open one is not moved; with the field gone, all of it returns (M4). Each sequence held open (a git watch that has not answered, a listing in flight, a diff loading) shows nothing of the folder left behind.
6. A shell call read from rows names the folder its row records; no shell call is labelled with a folder the agent moved to later (M5).
7. The whole unit suite passes on the VM but for the files that fail there on master; class 1a is green (the architect's run). The Electron scenes of M6 and the cross-build scene pass on a Mac (the architect's runs).

## Constraints that bind every milestone

- **The spec is not edited.** Where the code contradicts a statement this document rests on, or a change would alter what the owner sees beyond the section's words and beyond "Reported to the architect", the executor stops on the point and hands it back with the evidence.
- **Law 6.** Nothing here depends on an engine behaviour that is not in `spikes/protocol-probe/findings-uxwave-U8-working-folder.txt` and its fixtures under `spikes/protocol-probe/fixtures/pass3/uxwave/` (`uxwave-folder-*.jsonl`). Nobody runs an engine on the MacBook. Reported 9 is the one check still owed, and it is the architect's.
- **Law 5.** One producer and one field for the three routes (M2); where a route differs, the milestone says why (M5).
- **Other children's files (UC-8).** Every insertion is named in Interfaces §J with its owner. No other edit is made in a file another child owns.
- **UC-3.** M5 inserts in the transcript's model (`transcript/model/cells.ts`); the architect names its slot in UC-3's order before M5 starts.
- **UC-14.** Neither settings file and no stored layout key changes. The one stored addition is a nullable column added without moving the index's `user_version` (Interfaces §C).
- **Where checks run (UC-10).** The worktree on the MacBook has no `node_modules` and stays so: no typecheck, eslint, vitest, install, build or Electron there. Every check runs on the VM in a checkout of the pushed head:

      ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U8c -- '<command>'

  The helper's exit status is the command's; do not pipe it without `set -o pipefail`. While iterating, check one project (`pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null` for main, services, the engine host and shared code; `tsconfig.web.json` for the renderer; `tsconfig.e2e.json` for the specs). A milestone's proof is the typecheck of each project it changed, eslint on its changed files, and vitest over the folders named under it; the whole suite (`pnpm test`) runs once, in M6. On the VM these fail on master too and are not this landing's: `apps/desk-hub/test/deploy/{hub-reads,production-scripts,staging-scripts}.test.ts`, `src/services/machine/setup.test.ts`, `src/shared/machine/git-reads.test.ts`, `test/artifacts/portability.test.ts`; `src/renderer/src/sidebar/Sidebar.test.tsx` can time out under the full suite and pass alone. The gate runs Node 22 and the VM a newer one: a file whose behaviour could depend on it is run once with `npx -y -p node@22 node node_modules/vitest/vitest.mjs run <file>`.
- **The executor stops at the hand-back.** It runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. Class 1a, the Mac lane, the e2e runs, the cross-build run, the branch's review and the pull request are the architect's ("What the executor cannot run").
- **The repository is public (UC-11), and privacy.** Fixtures and test strings use invented folders (`/repo`, `/repo/.claude/worktrees/w1`) and invented text. Nothing of the owner's enters code, tests, fixtures, comments, commit messages or this document: no path, name, project, account, session text or screenshot. A fault is never reproduced by reading the content of a session or a document of the owner's: structure and counts only, and none of it is written into the repository. A fixture added or edited is followed by `node --test .github/scripts/maws-app-scan.test.mjs` on the VM.
- **Git.** Merge master, never rebase or force-push. Commit as the work goes and push the branch; never commit to master or to `ux-wave-spec`. No Co-Authored-By and no other attribution line; every commit message ends with the line the build brief gives (`Sminos-Session: …`).
- **Landing (UC-10).** Nothing lands on master without the owner's word; the session that keeps master lands the pull request by its gated merge. The pull request's body names its class 1a run, its review verdict and its residue. This landing reverses no ruling; at landing the register's row for l5-code-14 is updated.

## What the code holds today

Read at master `89e25cb20`; file names are under `src/` unless a path says otherwise. Nothing here was run: no engine and no suite on the MacBook.

**1. The open check: what each reader does when the engine moves the transcript.** On `EnterWorktree`, `ExitWorktree` and `/cd` the engine renames the session's transcript file into the project folder of the folder it moved to, renames the session's own folder beside it (`<slug>/<session id>/`, which holds its agents' transcripts), then appends a `relocated` row at the new place (engine `2.1.322`, `cli.pretty.js:381469-381548`; the probe's findings, "The transcript file moves"). A rename keeps the file's inode.

- *The session's follow in the engine host keeps reading, by the code.* `FsService` (`engine-host/fs/service.ts`) gives each follow a reader that opens `location.path` afresh at every read (`FsFileReader` in `follow.ts`); a transcript event re-summarises the path it names and then points the session's follows at the path the listing holds (`locateFollows`), and a rescan does the same (`relocateFollows`). The chain follower continues from its offset when the inode is the one it read (`sync` in `chain-follower.ts`). The quiet follow that serves a live session's older pages is found by the same two functions. One test moves a transcript today (`follow.test.ts`, "follows a relocated transcript to the surviving file…"), by writing a copy and deleting the original, which is a new inode and a reload; no test renames a session's transcript.
- *A follow of one of the session's agents loses the file.* `locateFollows` and `relocateFollows` re-point only follows whose `agentId` is null; an agent's follow keeps the path under the old project folder, and `onSidecarChange` pokes an agent's follow only when its stored path equals the changed file's, which now carries the new folder's slug. Its reads answer "absent" from then on. Seen when an agent's transcript is open, or its follow is still held, while the main loop enters or leaves a worktree (a background agent).
- *A terminal session's job reader loses the file.* `TranscriptJobs` (`services/lane-a/transcript-jobs.ts`) asks where the transcript is once (`this.path ??= await this.locate()`) and returns silently when that path is missing. After a move the session's Background tasks stop changing until its last watch ends and a new one starts. Build F has the same line.
- *The record is told removed, then back.* The old path's event summarises a missing file and `summarizePath` forgets the session (`fs.sessionRemoved`); the new path's event then lists it again. In the index the first archives the record and clears its transcript path (`markTranscriptRemoved`), the second lifts it (`upsertFromSummary`; `sessions.test.ts`, "a transcript that reappears after its removal is un-archived"). In between, a window lists the session as archived; tabs do not close (`ipc/events.ts` closes on the cause `update` only).
- *A session on another machine.* One MAWS runs there is read by that machine's engine host, the same `FsService`. A terminal session there is read by sminos's plane (outside this repository; `sminos_plane.py` `Tail.read` at 1.46.3), which ends the subscription as a discontinuity when the path changes; the endpoint ends the device's subscription `unavailable` (`endpoint/plane-a.ts`) and `main/lane-a/remote.ts` subscribes again with a backoff from one second and announces a pause meanwhile. It recovers by itself; it is not a reader this repository can fix.

**2. The index files a record by the home.** `upsertFromSummary` locates `summary.relocatedCwd ?? summary.directory` and writes its realpath as `directory`, its worktree root as `worktree_path`, and the newest row's `gitBranch` as `branch` (and as `worktree_branch` when in a worktree). `index/source.ts` warms the same folder before applying a summary (`locatedDirectory`). So a move by the tool re-files the record under the worktree and back; a move by `cd` changes nothing. `projects.test.ts` pins a relocation between two repositories ("a relocated session belongs where it was relocated to"). `locate` (`index/projects.ts`) answers `{ realpath, projectDirectory, worktreePath }`: a folder under `<X>/.claude/worktrees/<name>` by its path, a folder inside a linked worktree by `git worktree list` (asked once per folder for the life of the process), anything else as its own project directory.

**3. Five places work out where the transcript is from the record's directory:** `services/owner/register.ts` (`transcriptOf`), `services/owner/launch.ts` (`recordedOf`), `services/sessions/resume.ts`, `services/sessions/recovery.ts` (twice) and `services/sessions/setup.ts` (the rollback), each through `transcriptPathOf(env, directory, sessionId)` in `services/sessions/context.ts`. They are right today only because the record's directory moves with the file. Three others ask the index's stored summary first (`services/spine-root.ts`, `services/sessions/start-guards.ts`, `projectDirOf` in `record-actions.ts`).

**4. The record and the wire.** `SessionRecordSchema` (`shared/graph/session.ts`) and `TranscriptSummarySchema` are strict objects. A receiver whose peer may be another build reads with the tolerant reader (`shared/ipc/tolerant.ts`: an unknown key is dropped and the rest is validated strictly); build F has it. The renderer boundary validates strictly, after main has read. The index adds a nullable column without moving `user_version` through `ADDED_COLUMNS` (`index/migrations.ts`); F has that mechanism and reads and writes only the columns it names. The stored summary (`sessions.summary`, JSON) is read back unvalidated.

**5. The engine's status folder.** `status.cwd` is `tracker.engineCwd ?? spec.cwd` (`engine-host/session.ts`); `engineCwd` is set from every turn's `system/init` and by `noteCwd` after a `set_cwd` (`session.setCwd`, which no renderer code calls). On the wire only `system/init` frames carry a folder: in the probe's headless fixture, 15 of them and no `assistant` or `user` frame. Its readers in the window: `composer/Composer.tsx` (`status?.cwd ?? workingFolder(record).cwd`), `composer/frame/bindings.ts` (the chip: `status?.cwd ?? record?.directory`), `composer/resubmit-seam.ts`, `widgets/SkillsWidget.tsx`, `widgets/PluginsWidget.tsx`.

**6. The lists of a session's roots**, none of which reads the selector: `recordDirectories` (`shared/sessions/directories.ts`; its readers are the reveal guard of `settings.reveal` and `git.lsFiles`'s roots, which accept a folder inside a root), `rootsOf` in `services/files/allowlist.ts` (every `files.*` call, per call; for a caller on another machine less any root that is a home of the machine or above one), `rootsOf` and `CheckoutBounds` in `endpoint/targets.ts` (a remote `git.*` read and the checkout feed; the repositories kept per set of roots), `rootsFor` in `renderer/src/tools/code/files/tree.ts` (the roles of Files' roots), `underSession` in `renderer/src/tools/artifacts/viewers/model.ts` (whether "Open as file" is offered), `revealablePath` in `services/sessions/record-actions.ts` (exact match), `occupancyOf` in `services/sessions/holders.ts` (which sessions occupy a worktree before it is removed). `git.*` on this machine checks no session folder; `pty.spawn` takes the caller's `cwd` under the machine's shell grade, here and from another machine.

**7. The surfaces, when the folder they are given changes.** The card's git watch is released and started again, and the released entry is forgotten, so the branch row reads the pending copy until git answers, in both directions (`stores/git.ts`; late answers are dropped). The card's pull-request row reads `scm.status` and `scm.pr.state` keyed by session only, so it keeps the old checkout's answer until something invalidates it. Review's shell is keyed by session and folder and remounts; its view state (`tools/code/review/view-state.ts`: scope, selected file, scroll) is kept and applied to the new folder; its viewed marks are already keyed by folder and scope (`viewedKey`), in memory. Review has no comment authoring on master or on U5a. Source control's shell remounts too; its view state keeps an open Discard sheet, the commit message and the notice, and the service resolves the checkout from the record at each call (`services/scm/service.ts`, `checkout()`), so a sheet confirmed after a move acts on the same relative paths in the new folder. Files reads the record's roots, not the selector; it lists again only when the record's roots change, a roots answer in flight is applied and then replaced, and open file tabs are keyed by absolute path. The composer's `@` list keeps the previous folder's items while the query text is unchanged (`composer/mentions/AtMenu.tsx`). A terminal's start folder is read when its tab first gets a shell (`ensureTerminal` in `tools/terminal/index.ts`); an open terminal whose start folder differs from the session's shows "This terminal is in …; the session now runs in …" with "New terminal here" (`TerminalView.tsx`; `e2e/terminal.spec.ts`, "warns about the worktree"). A terminal session's controls are built again from the store's record at every render (`session/controls/controls-for.ts`), so its chip follows the record. A shell call's detail (`transcript/view/cells/ShellDetail.tsx`) shows its input's folder, which the engine's Bash input never has, else "Session directory" and the slot's folder, which is the selector's `cwd` (`TranscriptSlot.tsx`): every call, old or new, is labelled with one folder.

**8. Uploads** (`services/files/upload.ts`) are written under `<working folder>/.claude/desk-uploads/<session>/` and read back by id from the same expression at a later call (`files.readUploads`, a remote send's PDFs; parts of one remote upload are staged across calls). Each root is recorded in `<profile>/sessions/uploads.json` (`UploadRecords`), which can record and sweep and cannot list.

**Tests that pin today's behaviour and change:** `shared/sessions/working-folder.test.ts` (the case of a directory inside its worktree: `cwd`), `renderer/src/transcript/view/TranscriptSlot.test.tsx` and `view/cells/cells.test.tsx` (the shell call's folder), `renderer/src/composer/frame/bindings.test.ts` and `composer/Composer.test.tsx` (the status folder in front), `renderer/src/tools/code/files/files.test.tsx` (the default root; the listing key), `renderer/src/tools/code/review/review.test.tsx` and `tools/scm/view-state.test.ts` (what a remount keeps), `engine-host/fs/service.test.ts` ("a transcript that vanishes is reported removed": later by the settle), `test/one-working-folder.test.ts` (a second rule). Unchanged and still passing: every index suite (their summaries carry no newest folder and are filed by today's rule), `projects.test.ts`'s relocation between repositories, `follow.test.ts`'s relocation by copy, `test/endpoint/checkout-rule.test.ts`'s existing cases, `tools/terminal/terminal.test.tsx`. **E2e specs that cross the code:** `code-tools.spec.ts`, `scm.spec.ts`, `terminal.spec.ts`, `panel.spec.ts`, `ux2-shell.spec.ts`, `composer.spec.ts`, `transcript.spec.ts`, `lane-a.spec.ts`, `sessions.spec.ts`, `remote.spec.ts`, `cross-build.spec.ts`; none holds a `relocated` row or a move today.

## Plan of Work

Six milestones, in order. M1 stands alone: it changes no behaviour of the wave and could land by itself. M2 produces what M3, M4 and M5 consume. Each leaves the tree green. The six points the child's file hands this document ("For the second landing's document, from the first landing's") are settled where they belong: (1) the status folder, M4 decision 1; (2) a shell call that names no folder, M5; (3) Files' first root and the three displays of the record's directory, M4 decisions 3 and 4; (4) the lists of a session's roots, M3 decision 1; (5) the selector's parameter, M3 decision 2; (6) a terminal session's controls, M4 decision 9.

### M1 — A moved transcript keeps its readers

**What exists at its end.** When the engine moves a session's transcript and its folder to another project folder, in either direction, the session's follow, the quiet follow of its older pages, a follow of one of its agents and a terminal session's job reader go on reading, the session's agents are listed at their new paths, and the session is never told removed. Nothing else changes.

**What it touches.** `src/engine-host/fs/service.ts`; a new suite `src/engine-host/fs/move.test.ts`; `src/services/lane-a/transcript-jobs.ts` and `transcript-jobs.test.ts`; `src/engine-host/fs/service.test.ts` only where a removal's timing is asserted. This document's Progress, Surprises & Discoveries and Decision Log.

**Interfaces.** Exposes no name. Consumes nothing of this landing.

**Decisions.**

1. *The test moves the file as the engine does.* `move.test.ts` runs the real `FsService` over a real store (`StoreFixture`, as `follow.test.ts` does) with the platform's own watcher, binds a session, and then: makes the target project folder when the case wants a new one, renames the transcript into it (`fs.rename`: the inode stays), renames the session's folder beside it, and appends a `relocated` row and one message row at the new path. Each case does it into a project folder that did not exist and then back into the one that does, because the first raises a rescan (a new folder under `projects/`) and the second does not. Fixture rows are the suite's existing invented ones.
2. *The cases, and which are red on master.* (a) The session's follow delivers the row appended after each move, once, stays `following`, and its reader's path is the new file's: expected green on master ("What the code holds today" 1); if it is red, the fix is this milestone's and is recorded. (b) The quiet follow (`eventsSnapshot(…, quiet = true)`) answers a page that holds the appended row: expected green. (c) A follow of an agent (`fs.agentEvents`, over the suite's sidecar fixture) delivers a row appended to the agent's transcript at its new path: red. (d) After the move `fs.subagentsChanged` names each agent at its new path: red. (e) Across the move no `fs.sessionRemoved` is emitted, and one `fs.sessionChanged` names the new path: red. (f) *macOS only:* the move made right after the service starts, inside the watcher's settle time, is still found (the assertion is the outcome: the follow reads the appended row). `transcript-jobs.test.ts` gains: a job row appended after a rename is in `body()` once `locate` answers the new path (red: the path is asked once); a read while `locate` still names the missing path neither throws nor resets, and the next read catches up; a file replaced by another inode at the new path is read from its start.
3. *An agent's follow moves with its session's folder.* When the path the listing holds for a session changes, each follow of that session's agents takes the same relative path under the session's folder at the new project folder (a re-base of the string: the engine moves the folder whole), is poked, and the session's agent listing is walked for the new folder so that main is told the new paths. A follow whose re-based file is missing waits, as an agent's follow of a file not yet written waits today. Rejected: looking each agent up in the new listing first, which needs the walk to finish before a follow can read.
4. *A removal is told only after the file has stayed gone.* `summarizePath` no longer forgets a session the moment its listed path is missing: the removal waits `REMOVAL_SETTLE_MS` (250, the watcher's own settle time) and is dropped if a summary has listed the session at another path by then; if the listed path is still the missing one and the file is still missing, the session is forgotten as today. A removal that is real is told a quarter of a second later; `service.test.ts`'s cases poll for it within a second and stand. The forget a scan makes (`pass`) is not changed. Reported 1: an improvement the section does not name; to drop it, strike this decision and case (e).
5. *The job reader asks where the file is at every read.* `TranscriptJobs` calls `locate` each time; a path that differs from the one it read is read at the new place by the rule it already has for a file that changed under one path (the same inode and no shorter: on from its offset; otherwise from the start). A missing file returns, as today. Its `locate` in `services/spine-root.ts` already answers the index's current path and is not touched.
6. *Where the cases run.* Every case of `move.test.ts` runs on Linux in class 1a and on macOS in the Mac lane: the file enters that lane by its one guarded case (f), `it.skipIf(process.platform !== 'darwin')` with a `// macOS:` comment naming the fact (FSEvents starts its stream after `fs.watch` returns and reports nothing written in its first milliseconds; `watcher.ts`'s header). macOS reports a renamed folder as one event for the folder and coalesces events within its latency; Linux's watch tree reports both ends of a rename and must add a watch for a new folder. The cases assert outcomes only (rows delivered, paths, events absent), never an order of file events, so they hold on both. `transcript-jobs.test.ts` uses no watcher and needs no Mac.
7. *The move, as states and events.* State per session: the path the listing holds; a removal waiting, or none; each follow's location. Events: a transcript event at the listed path with the file missing starts the wait (decision 4); a transcript event at another path whose file is there summarises it, sets the listing to it, ends any wait, and re-points and pokes the session's follows and its agents' (decision 3); a rescan lists what is on disk and re-points the same way; the reconcile tick pokes every follow where it points. The listing's path for a session changes only when a summary of the new path has succeeded, whatever order the events come in; that is the one point the others hang from.

**What it does not touch.** The chain follower and the reader (`chain-follower.ts`, `follow.ts`): they are right by the code. The index and `markTranscriptRemoved` (the removal simply no longer arrives). The W7 contest check, which reads the path each event names. sminos's plane and `main/lane-a/remote.ts` (the remote terminal route recovers by a new subscription; "What the code holds today" 1). U8b's X-168 edits of `service.ts` and `chain-follower.ts` (To check again 3).

**What it proves.** Acceptance 1. Not proved here: the same cases on macOS, which the architect runs in the Mac lane after this milestone ("What the executor cannot run" 1).

### M2 — The record says where the agent is

**What exists at its end.** A session's record carries, when the agent is not in the folder the session was launched in, one optional field naming the checkout and the folder it is in, written by the index from the transcript's summary, the same for a session MAWS runs and a terminal session and carried whole to another machine's window. The record's launch folder no longer moves when the agent enters or leaves a worktree of the launch project. The selector answers from the field, the record's branch names the working folder's branch, and nothing derives the transcript's place from the record's directory alone. On screen, the surfaces that already ask the selector (the card's folder and git watch, Review, Source control, a new terminal) follow; what a move does to work in hand is M4's.

**What it touches.** `src/engine-host/fs/summarize.ts`; `src/shared/wire/store.ts`; `src/services/index/sessions.ts`, `projects.ts`, `migrations.ts`, `source.ts`; `src/shared/graph/session.ts`; `src/shared/sessions/working-folder.ts`; `src/services/sessions/context.ts`, `resume.ts`, `recovery.ts`, `setup.ts`; `src/services/owner/register.ts`, `launch.ts`; `src/shared/ipc/wire.ts` and the two generated wire files; `test/one-working-folder.test.ts`; a new `test/working-folder-routes.test.ts`; the suites beside each changed file (`summarize.test.ts`, `store.test.ts`, the index suites, `working-folder.test.ts` and the hook's, the services' suites); `test/support/index-fixture.ts` if the routes test wants a helper.

**Interfaces.** Exposes §A (the summary's field), §B (the index's rule), §C (what is stored and sent), §D (the record's field and the selector), §E (the answer per recorded step), §F (where a transcript is; the tree test's second rule). Consumes nothing of this landing.

**Decisions.**

1. *One producer for the three routes: the summary.* The engine host already re-reads the head and tail of every transcript that changes, whoever runs the session, and the index already turns that into the record; the newest row's folder is one more fact of the tail window (§A). So a session MAWS runs and a terminal session are served by the same code, and a session on another machine by that machine's copy of it, its record carried here as records are today. Rejected: the engine's per-turn `system/init` folder for a session MAWS runs (the section's own outcome 1 names the follower there): it exists on one route and is a turn late; the chain follower's facts: a follow exists only for a session someone has open.
2. *The launch folder stops moving for a relocation inside the launch project, and only for it* (§B; Reported 2). The record is filed by the folder of the transcript's first row whenever the home the tail names is in the same project (one of its worktrees, or its checkout); the working folder then carries the move. A home in another project files the record there, as today, and the working folder is judged against that. So the worktree tool no longer re-files a record, a `/cd` to another repository still does, and `projects.test.ts`'s relocation between two repositories passes unchanged. Rejected: reading the engine's `worktree-state` row for the folder the session entered from (a second bookkeeping row to trust, for the same answer); ignoring every `relocated` row (the section's words taken literally: a session the person moved elsewhere would stay filed under a folder its agent has left, with nothing following it).
3. *Which checkout a row's folder is in* is `checkoutIn(launch, folder)` (§B): the index's own `locate` decides worktrees, so the working folder is a worktree exactly where a session launched in that folder would be filed as in one. A folder that is gone, or in another project, gives no working folder: the record answers the launch folder.
4. *The record's branch is the working folder's* (§B; Reported 3): the newest row's `gitBranch` when the working checkout is the home's checkout (the engine read it there), else the branch `HEAD` names at the working checkout, read from git's own files when the summary is applied (no process: the index applies summaries inside its transactions, and a moved session's every row would otherwise spawn one). A session not written since keeps the branch its last row was applied with.
5. *What is stored: one nullable column, stamped* (§C). `sessions.agent_folder` holds the checkout and the folder with the transcript's size and mtime the same write stores. The record carries the field only while the stamp equals the row's stored size and mtime. Build F never writes the column and changes the size and mtime whenever it files a newer transcript, so a value F has overtaken is not believed; this build's next summary writes it again. Rejected: no stamp (after a stay in F the column would name a folder the agent left while F ran); deriving the field from the stored summary at every read (`locate` on every `get`).
6. *A record build F filed is left as F filed it until its transcript's next row* (Reported 8). On a first run of this build, a session F re-filed under a worktree keeps that worktree as its launch folder and has no working folder: the card names the worktree, which is where the agent is, without "moved from". Its next summary files it under the folder of its first row and gives it the worktree as working folder. A session that moved by `cd` under F shows its launch folder until its next row. When F runs again, F files by its own rule at each transcript's next change and leaves the column, whose stamp then no longer matches. No transcript is read again for this. Rejected: answering the engine host's scan with a stale mtime for every row not yet read by this build, which reads the whole store again at the first run and after every stay in F.
7. *A summary that does not say where the newest row is, is filed by today's rule.* `newestCwd` absent (an engine host of an older build; a stored summary applied again by a rebind or a refold) means the whole of today's rule and a null column: the launch folder moves only when the same summary can say where the agent is, so the two cannot disagree. `newestCwd` null (the tail window holds no row with a folder: its newest row alone is larger than the window) keeps the working folder the record has, re-stamped, while the launch folder is unchanged; the next row settles it.
8. *The selector* (§D). With no field: `path` and `launch` are the launch folder, `cwd` is `record.directory`, `moved` is false. U8a pinned `cwd` equal to `path` for a record whose directory lies inside its worktree and said the second landing changes it knowingly: it now answers the directory, the folder the engine itself is in, which is what the engine's status folder gave the composer. With the field: `path` is its checkout, `cwd` its folder, `moved` is `path !== launch`. It still validates nothing and imports nothing but the record's type.
9. *The record names two branches, and M4 chooses between them.* `record.branch` is the working folder's (decision 4); `record.worktree.branch` stays the launch worktree's. This milestone changes no reader of either.
10. *Where a transcript is* (§F): `knownTranscript` answers the stored summary's path for the engine session asked about; the five places of "What the code holds today" 3 try it before the path a launch in the record's directory would write, as `start-guards.ts` does. Without it, a session whose agent sits in a worktree entered through the tool would read as having no transcript in each of them.
11. *The tree test's second rule* (§F): a member access of the record's field outside the selector and a counted table fails, as the first rule fails a spelling of the folder.
12. *The common summary costs what it costs today.* A summary with no `relocated` row whose newest row is in its first row's folder is located once. `sessions.test.ts` holds a measured bound on 4,000 upserts in a case that runs in the Mac lane; the architect's run after this milestone reads it. `index/source.ts` warms every folder a summary will locate (the first row's, the home's, the newest row's) before applying it, as it warms the one today.
13. *The wire.* The record's field and the summary's are new optional keys of schemas the wire manifest holds (`session.get`, `session.list` and `session.changed`; `fs.sessionChanged`). `WIRE_MINOR` goes up by one from master's as merged at this milestone's start, with this landing's entry in its comment; `pnpm wire:manifest` on the VM regenerates `wire-manifest.json` and `wire-fingerprint.json`. M5 adds a third optional key and, because the manifest's test asks one number per recorded change, raises the number once more on the branch. M6's last step collapses the landing to one number, the next free one on the master it merges last: master's two generated files restored, `WIRE_MINOR` set one past master's, the files regenerated.
14. *A resume or a fork starts in the record's directory*, which is now the launch folder for a session whose agent sits in a worktree of the launch project. The probe recorded the resume from there (the engine finds the transcript and returns to the worktree); the fork is Reported 9.
15. *The routes test* (§E): `test/working-folder-routes.test.ts` builds, in a temporary folder, a git repository with the worktrees the probe used (`.claude/worktrees/pz-alpha` on the branch `worktree-pz-alpha`, and `.claude/worktrees/pz-beta` on the branch `pz-beta` with a `sub` folder), and for each `step_record` of `uxwave-folder-headless.jsonl` and `uxwave-folder-terminal.jsonl` writes the session's transcript as that step recorded it: the rows every step so far added, kept by their recorded index up to the step's total (a step lists a moved file's rows again; the terminal fixture's last step leaves four indexes no step recorded, which are left out), each with its recorded `type`, `cwd`, `gitBranch`, `isSidechain` and `relocatedCwd`, the recorded folders re-rooted, at the project folder the step found the file in. It summarises that file with `summarize` and applies it to one index in step order, and asserts §E's table for both fixtures, the same rows. Read from the fixtures while this was written: at every step the two sessions have the same first-row folder, home and newest folder, and the same newest `gitBranch`.

**What it does not touch.** The files allowlist and every list of roots (M3): until M3 a working folder outside the record's roots is refused by `files.*`, which is the safe side. The card's rows, Files, the composer and the request lines (M4). The engine host's status and its `engineCwd`. The chain follower's `facts`. The sidebar's row and hover card, the archive, delete and archived-session dialogs and the Resume picker's folder (they read the record). Any existing index test's expectation.

**What it proves.** Acceptance 2 and 3. Behaviours its suites pin beyond them: `summarize` takes the newest row's folder from the tail, skips a sidechain row and rows without one, and answers null, never the head's, when the tail holds none; §B's table over generated summaries (every combination of first-row folder, home and newest folder drawn from: the launch folder, a sub-folder of it, a worktree of the project, a sub-folder of that, a second worktree, a folder of another repository, a folder that is gone), with these holding throughout (the probe's outcome 4: the launch folder and the working folder never disagree): `moved` is `path !== launch`; `path` is the launch folder or a checkout of the launch project; a relocation inside the launch project changes neither `directory` nor `worktree`; one outside files the record there; a summary without `newestCwd` gives exactly today's record. The stamp: a row whose stored size or mtime differs from the column's answers a record without the field, and the same row written by a statement that names only build F's columns reads so. `index/source.ts`: a summary whose newest folder has not been located waits for its warm-up as one whose home has not, and a write about the same session applies it first, in the host's order, as today. The record's branch in each of decision 4's cases. `knownTranscript` for a summary of another engine session (null). The selector's four fields with and without the field. The tree test's samples (§F). A record with the field read by the link's codec and by the strict schema.

### M3 — What may be read there

**What exists at its end.** The working folder is among the folders a session's files may be read from, for this machine's window, for a terminal session's controls and for a caller on another machine, when and only when it is a registered worktree of the launch repository at the moment of the call. Every other list of a session's roots knows it. An upload is read back from where it was written.

**What it touches.** `src/shared/sessions/directories.ts`; `src/services/files/allowlist.ts`, `upload.ts`; `src/services/fs/upload-roots.ts`; `src/endpoint/targets.ts`; `src/services/sessions/record-actions.ts`, `holders.ts`; `src/renderer/src/tools/code/files/tree.ts` (the candidates only; Files' own behaviour is M4's); `src/renderer/src/tools/artifacts/viewers/model.ts`; their suites (`allowlist.test.ts`, `service.test.ts`, `upload.test.ts`, `test/endpoint/checkout-rule.test.ts`, `test/endpoint/feeds.test.ts`, the services' suites, `files.test.tsx` for the candidates).

**Interfaces.** Consumes §D. Exposes §G.

**Decisions.**

1. *Every list of a session's roots gains the working folder, each by its own rule* (point 4; §G's table). The three that are boundaries check it at the act; the four that label, offer or count take the record's word.
2. *The selector's parameter and the allowlist's record* (point 5). `workingFolder` takes `Pick<SessionRecord, 'directory' | 'worktree'> & Partial<Pick<SessionRecord, 'agentFolder'>>`; `AllowlistRecord` gains the same optional member, and the record `allowlistOf` builds from a setup intent has none, so a session that has not started reads its location as today and `upload.ts` compiles as it is.
3. *Registered, at the act, on the path the act uses* (§G). `rootsOf` in the files allowlist resolves the working folder's realpath as it resolves every root, and keeps it only if git's own files, read then, say that realpath is the root of a worktree of the repository the launch folder is in: the worktree's `.git` names an entry under the repository's `worktrees/`, and that entry names the worktree back. No process is started and nothing is kept between calls; the reads are a handful of small files. It is checked whether or not the folder already lies under another root (one rule, one table of cases). The home rule then applies to it as to any root.
4. *What a stale or forged folder gets.* A working folder that no longer resolves is dropped, as a root that does not resolve is today. One that resolves to something that is not a registered worktree of the launch repository (removed with `git worktree remove` and made again as a plain folder; replaced by a link to another place; a `.git` file copied into a folder git never registered) is not a root: `files.list` with no path does not list it and every path under it answers the service's refusal, "path outside the session's directories", unless another root holds it. The record keeps naming it until the transcript's next row; the card then shows the folder with git's own failure for it.
5. *The endpoint decides again, per request* (§G). `CheckoutBounds.of` adds the working folder to the record's roots when the machine's `git.worktree.list` at the launch folder, asked for that request and not kept, lists its realpath; it then passes the home rule, bounds git's reads and counts as the checkout Source control's output is judged by. Not listed, unreadable or unanswered: not a root, and the checkout is unknown, which today already withholds the session's Source control output from a remote reader. The narrowing of the untyped record (`folderReadable`, U8a) admits the field only as an object with two strings; any other shape answers null, as any value that is no record does.
6. *Each caller.* This machine's window: `files.*` through the files service, on the record the spine holds at the call. A terminal session's controls: its uploads go through lane A's `media` op, which takes the folder from the session's own bridge and is not touched; `files.upload` and the files tools for it go through the same files service. A caller on another machine: `files.*` and `scm.*` are placed on the machine's services (the files service with the home rule; Source control at the folder the record names, decision 8), `git.*` is bounded by the endpoint (decision 5), and a terminal's start folder is the caller's own under the machine's shell grade, as today.
7. *Uploads are written under the working folder and read back from wherever they were written.* The writer's folder is the selector's `path`, as U8a left it, which is where the engine can read without asking (a worktree it entered is its own folder; one reached by `cd` lies inside the launch folder). `UploadRecords` gains a read of the roots recorded for a session, and `files.readUploads` looks for an id under each, newest first, so an attachment made before a move is found after it. A remote upload whose parts straddle a move is refused "part out of order" by the staging's existing rule, with nothing saved; the sender attaches again.
8. *Source control acts at the folder the record names, with no check of its own at the act.* It does so for the launch folder today; the index wrote the working folder only after `locate` placed it in the launch project, and the files service and the endpoint, which are the boundary UC-4 names, check again. The review panel's first lens reads this decision.
9. *A session whose agent is in a worktree occupies it.* `occupancyOf` counts the working folder beside the record's directory and worktree, so a worktree an agent moved into is not offered for removal as empty; build F counted it for a move by the tool (the record was re-filed) and never for a `cd`.

**What it does not touch.** `git.*` on this machine and `pty.spawn` (no session folder is checked there today, and none is added). The files service's own steps after the roots are known. `main/lane-b/remote.ts`'s `models`. Files' default root and roles' labels (M4).

**What it proves.** Acceptance 4, by: `allowlist.test.ts` and `service.test.ts` over real git repositories in a temporary folder: a linked worktree outside the launch folder is listed and read while the record names it and it is registered, for a local and for a remote caller; refused once it is removed and made again as a plain folder, once it is replaced by a link, and when a `.git` file names an entry that does not name it back; a worktree under the launch folder is a root of its own; a working folder that is a home of the machine is dropped for a remote caller. `checkout-rule.test.ts`: the same cases through `CheckoutBounds.of` with a fake `git.worktree.list`, the answer asked again at each call, and `checkoutCovers` true whenever the working folder is not admitted. Each other list of §G with a moved record. `upload.test.ts`: an upload written before the record's folder changes is read back after; a part after the change is refused and leaves nothing.

### M4 — The window follows

**What exists at its end.** With a moved record the Environment card shows the working folder, the agent's folder inside it when that differs, the branch git reports there and "moved from <name>"; the card's pull-request row, Review, Source control and Files are the working folder's; the composer lists files and commands from the agent's folder; the location chip and a request's kept folder line name where the agent is. Each starts over cleanly at the moment of a move and again when the folder moves back, and nothing a person has in hand is applied to the other folder.

**What it touches.** U8b's `panel/summary/Summary.tsx`, `Environment.tsx` and their copy and suite; `tools/code/review/view-state.ts`, `ReviewTool.tsx`, `DiffTab.tsx`; `tools/scm/view-state.ts`, `ScmTool.tsx`; `tools/code/files/FilesTool.tsx`, `tree.ts`; `composer/Composer.tsx`, `composer/frame/bindings.ts`, `composer/resubmit-seam.ts`, `composer/mentions/AtMenu.tsx`; `request-card/RequestCard.tsx`, `sidebar/RequestPreview.tsx`; `ipc/events.ts`; `sessions/branch-label.ts`, `app/Toolbar.tsx`, `overview/SessionCard.tsx`, `session/controls/lane-a.ts`; the suites beside each, and `tools/terminal/terminal.test.tsx` and `session/controls/controls-for.test.ts` for one pinned case each. All under `src/renderer/src/`.

**Interfaces.** Consumes §D and §G. Exposes §H (the card's rows and words) and §I (what each surface does at a move).

**Decisions.**

1. *The record replaces the engine's status folder in the composer, the chip and the resubmit seam* (point 1; Reported 5). They read the selector whenever the window holds the session's record, and the status folder only while it holds none (a moment at start-up), where today's last fallback was the empty string. With the status in front, a session MAWS runs would list the launch folder's files in its `@` menu for the rest of the turn in which its agent moved, while the card and Review had already followed, and a terminal session would behave differently from it (law 5). What the status knows first (a host's `set_cwd` before any new row) has no caller in the window. `widgets/SkillsWidget.tsx` and `widgets/PluginsWidget.tsx` keep it: they ask which folder's settings the engine loaded, not where the agent is. The engine host keeps publishing it.
2. *The card* (§H). `RecordCards` computes the selector's answer once and hands the card what it draws. The folder row shows `path`; when `cwd` is deeper it adds, muted, "in <the part of `cwd` below `path`>"; while `moved` one muted line under the folder row reads "moved from <the launch folder's last segment>" with the whole launch folder as its title. The branch row is git's answer at `path`, as U8b has it. At a move the git watch is released and started on the new folder (U8b's effect does it), and until git answers the header and the branch row read the pending copy and the change line is absent: nothing of the folder left behind is drawn. The pull-request row's two reads are invalidated for the session when its working folder changes (`ipc/events.ts`: where a record's change is stored, compare the selector's `path` before and after).
3. *The three displays of the record's directory* (point 3). The location chip of a session MAWS runs reads the selector's `path`, as a terminal session's already does: the chip names the checkout and does not change with every `cd` inside it. A request's kept folder line (the hover card's and the sidebar's fallback preview's) reads `cwd`: it says where the call will run. Both equal what they show today for a session that has not moved, except the chip of a session MAWS runs whose directory lies inside its worktree, which now names the worktree's root as a terminal session's does.
4. *Files* (point 3; §I). The record's candidates gain the working folder with the role `working folder` (M3 lists it; here it is labelled). The root Files opens first is the listed root that is the working folder: the one whose path equals it, and only when none does, the one the tree's own match (`sameFile`, which folds case) gives; with no such root listed (the listing lags the record) the root in use stays; for a session that has not moved it is today's choice (the root whose role is `worktree`, else the first). The roots are listed again when the working folder changes. A changed first root is expanded once and nothing is collapsed; open rows, the selection and the scroll stay.
5. *Review starts over for the new folder and keeps its viewed marks per checkout* (§I). The view state resets when the session or its working folder changes (the scope is decided again, no file is selected, the scroll is at the top); the viewed marks are not touched, and since they are keyed by folder and scope the ones made in a folder are found on return. A diff tab does the same.
6. *Source control starts over for the new folder* (§I; Reported 7). Its view state resets on a change of folder as it does for another session: an open Discard, Push or pull-request sheet is closed, the selection, the notice and the last commit are cleared; the commit message is kept per session and folder, so one written for a checkout's changes is neither offered for another's nor lost. Two gaps are left and named, because l5-code-06 (U5b) removes every act from Source control: a push still running in the folder left behind cannot be cancelled from the new folder and its later output is appended without its heading; and a Stage, Discard or Commit confirmed in the instant between the machine's record changing and the window hearing of it (a tick and a round trip) acts in the new folder. An act already admitted finishes in the folder it started in (the service takes the checkout once per act).
7. *A terminal.* No code changes: an open terminal keeps its shell and its bar says where it is and offers "New terminal here"; a new one starts in the selector's `path`. One case is added to the terminal's suite with a moved record.
8. *The `@` list belongs to its folder.* `AtMenu.tsx` keeps the folder its items were listed for beside the query, and shows items only for the folder it is asked about now, so a list in flight when the agent's folder changes is never offered for the new one.
9. *A terminal session's controls are rebuilt from the record at every render* (point 6: checked, `session/controls/controls-for.ts`), so its chip's folder follows the record without an edit; one case pins it.
10. *Which branch a reader shows* (§D, `workingBranch`). The readers that say where the agent is show the working folder's branch: the title bar's chip (`toolbarTitle` in `app/Toolbar.tsx`), the Overview card (`overview/SessionCard.tsx`), and the two location chips' recorded branch (`composer/frame/bindings.ts`, `session/controls/lane-a.ts`), which git's own answer replaces once it has one. The readers of the record keep `recordBranch`: the sidebar's hover card, group labels and search, and the Resume picker. So a session launched in one worktree and working in another reads, on its hover card, the launch worktree's name with the launch worktree's branch, and in the title bar the branch the card shows. Rejected: changing `recordBranch` for every reader, which would pair the working folder's branch with the launch worktree's name on the hover card.

**What it does not touch.** The sidebar's row mark and the hover card's place, the dialogs and the Resume picker (they read the record; Reported 4). `PushState.tsx`'s content. `ReviewSummary.tsx` (it follows by the hook). The files viewer and editor: a file tab is its absolute path and is left alone. The terminal's code. U1a's `ProposedChange.tsx` and the question sheet's file picker (they read `path` and follow). The two widgets of decision 1. Review's and Source control's own content.

**What it proves.** Acceptance 5, by the suites of each surface with a record that gains and loses the field. Sequences held open, each with its test: a git watch that has not answered after a move (the card shows the new folder, the pending copy and no change line; the old folder's late answer changes nothing); a roots listing in flight at a move (the old answer lands, the new listing replaces it, and the first root is never one that is not listed); a diff loading at a move (its answer is dropped; the new folder's first file loads); an `@` list in flight at a change of folder (never shown for the new folder); a Discard sheet open at a move (closed; a confirm cannot be made). And: the pull-request row asks again when the folder changes; Review's viewed marks survive a move and a return; the commit message returns with its folder; the chip and the request line for a moved and an unmoved record; the composer's folder with a status that names another folder (the record's is used); the title bar's chip and the Overview card name the working folder's branch for a moved record, and the hover card's place does not change.

### M5 — A shell row keeps its folder

**What exists at its end.** A shell call drawn from transcript rows names the folder its own row records when that is not the launch folder, and "Session directory <launch folder>" otherwise; no call is labelled with the folder the agent is in now (point 2; Reported 6).

**What it touches.** `src/shared/graph/events.ts` (the `tool.use` event); `src/engine-host/fs/backfill.ts` (U3's; on a master that holds U3a); `src/renderer/src/transcript/model/cells.ts` and the cell's type (UC-3: the architect names the slot); `transcript/view/cells/ShellDetail.tsx`; `transcript/view/TranscriptSlot.tsx`; their suites and `lane-a/plane-transcript.test.ts`; `src/shared/ipc/wire.ts` and the two generated wire files again (M2 decision 13).

**Interfaces.** Consumes §D. Exposes §K.

**Decisions.**

1. *The row's folder rides on the call's event where rows are read.* `tool.use` gains an optional `cwd`; the file reader sets it from the row for a shell tool's call (`Bash`, `PowerShell`, `BashOutput`, `KillShell`, `Monitor`: the names the model's shell cell takes), and another machine's rows pass through the same function. The live normaliser sets nothing: the engine's wire names no folder per call. Rejected: the folder of the call's turn from `system/init` on the live route (a call made after the agent moved earlier in the same turn would be labelled with the folder it left, for the whole of a long turn); a journal row written by the engine host whenever the summary's folder changes (it would make the live label right, at the price of a stored row build F does not know and a normaliser that depends on it: law 4).
2. *What the detail shows.* The call's input folder if it names one; else the event's folder if it has one and it is not the launch folder, labelled as the input's is ("cwd"); else "Session directory" and the launch folder. The slot hands the detail the selector's `launch` in place of `cwd`. A session that never moves shows exactly today's line on every route.
3. *The routes differ, and why.* A session MAWS runs shows "Session directory <launch folder>" on its live rows even after its agent moved, and each row's own folder once it is read from disk (after the process ends, and for its older pages). The card says where the agent is meanwhile.

**What it does not touch.** The live normaliser and `NormalizerState` (U3a's M4). Any other event. The transcript's other cells. The model's session folder for Grep paths.

**What it proves.** Acceptance 6: the file reader over rows in two folders gives each shell call its row's folder and a non-shell call none; the model's shell cell carries it; the detail's three cases; a moved record changes no existing row's line.

### M6 — The scenes, the record, and the acceptance run

**What exists at its end.** The Electron scenes that show the landing are written and compile; the cross-build table has this landing's row and scene; the wire's number is the one free on the final master; the whole unit suite has run; the document's record is current and the branch is handed back.

**What it touches.** `e2e/code-tools.spec.ts`, `e2e/terminal.spec.ts`, `e2e/remote.spec.ts`, `e2e/cross-build.spec.ts` (§L); `src/shared/ipc/wire.ts` and the generated files once more; this document.

**Decisions.**

1. *The scenes need no engine.* A session is a transcript file with invented rows in the scratch store and a scratch git repository with a worktree the test makes; a move by `cd` is rows appended with another `cwd`; a move by the tool is the file and its folder renamed with a `relocated` row appended, as M1's test does. §L lists what each scene asserts.
2. *The cross-build row* is the index's column (§C, §L): the one thing this landing stores.
3. *The whole suite and the last merge.* After the last merge of master the wire's number is allocated again and the two files regenerated (M2 decision 13); then `pnpm typecheck`, eslint on the changed files, and `pnpm test` once.

**What it does not touch.** Any scene's run: the executor starts no Electron.

**What it proves.** Acceptance 7's unit half; the specs compile under `tsconfig.e2e.json`. The runs are the architect's.

## Concrete Steps

All commands are run from the worktree of branch `ux-wave/U8c`; `vmcheck` stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U8c --`, and each call tests the pushed head. `tsc-node` and `tsc-web` stand for `pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null` and the same with `tsconfig.web.json`. Every milestone opens with the merge and ends with its files committed and pushed, the typecheck of each project it changed, and `vmcheck 'pnpm exec eslint <the changed .ts and .tsx paths>'`, each expected to exit 0 with no message.

**Every milestone, first:**

    git fetch origin master && git merge origin/master

Merge, never rebase. After a merge, run the milestone's vitest set again, not the whole suite. A conflict in `src/shared/ipc/wire.ts` or the two generated wire files is settled by M2's step 2.

**M1.**

1. With `move.test.ts` and the new cases of `transcript-jobs.test.ts` committed and no source changed:

       vmcheck 'pnpm exec vitest run src/engine-host/fs/move.test.ts src/services/lane-a/transcript-jobs.test.ts'

   Expect cases (a) and (b) of M1's decision 2 to pass, (f) to be skipped (the VM is Linux), and these to fail: the agent's follow (c), the agents' new paths (d), no removal told (e), and the job reader's case after a rename. If (a) or (b) fails, the session's follow does lose the file: record it under Surprises & Discoveries with the failing assertion; its fix is this milestone's.
2. After the fixes, the same command passes with one case skipped. Then:

       vmcheck 'pnpm exec vitest run src/engine-host/fs src/services/lane-a src/services/index'

   Expect every file to pass with no case skipped that master runs. `tsc-node`.
3. Hand to the architect: "What the executor cannot run" 1.

**M2.**

1. With the routes test, the summary's and the index's new cases and the tree test's second rule committed, and no source changed:

       vmcheck 'pnpm exec vitest run test/working-folder-routes.test.ts'

   Expect it to fail at the step `s1-enter-worktree` of each fixture: the record's `directory` is the worktree where the table says the launch folder. That failure is the launch folder moving.
2. The wire, after the schemas are changed: set `WIRE_MINOR` in `src/shared/ipc/wire.ts` one past the number in the committed `wire-manifest.json`, add this landing's entry to its comment, commit and push, then regenerate the two files on the VM and bring them back:

       vmcheck 'pnpm wire:manifest >/dev/null; git diff -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json' > /tmp/u8c-wire.patch
       sed -n '/^diff --git/,$p' /tmp/u8c-wire.patch | git apply

   Expect a patch that touches those two files only. Commit them, push; `vmcheck 'pnpm exec vitest run src/shared/ipc'` then passes. After any merge of master that brings another landing's number: restore master's two generated files (`git checkout origin/master -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json`), set `WIRE_MINOR` one past master's with this landing's one entry in the comment, and regenerate the same way.
3. Green:

       vmcheck 'pnpm exec vitest run src/engine-host/fs/summarize.test.ts src/shared/wire src/shared/graph src/shared/sessions src/shared/ipc src/services/index src/services/sessions src/services/owner src/renderer/src/sessions test/one-working-folder.test.ts test/working-folder-routes.test.ts'

   Expect every file to pass; the tree test's table holds the counts its red run named. `tsc-node` and `tsc-web`.
4. Hand to the architect: "What the executor cannot run" 2 (the measured bound) and Reported 9.

**M3.**

    vmcheck 'pnpm exec vitest run src/services/files src/services/fs src/services/git src/services/sessions src/shared/sessions test/endpoint src/renderer/src/tools/code/files src/renderer/src/tools/artifacts'

Write the refusal cases first and see them fail for the right reason (the folder listed where it must be refused is impossible before the list gains it; so the red is: a registered worktree outside the launch folder refused). Expect all to pass after. `tsc-node` and `tsc-web`.

**M4.** After U8b is on master (To check again 1 and 2).

    vmcheck 'pnpm exec vitest run src/renderer/src/panel/summary src/renderer/src/tools/code/review src/renderer/src/tools/scm src/renderer/src/tools/code/files src/renderer/src/tools/terminal src/renderer/src/composer src/renderer/src/request-card src/renderer/src/sidebar src/renderer/src/ipc src/renderer/src/session/controls src/renderer/src/sessions'

Each held-open case of "What it proves" is written before its fix and seen red. `tsc-web`.

**M5.** After U3a is on master and the architect has named the slot in UC-3's order.

    vmcheck 'pnpm exec vitest run src/shared/graph src/shared/ipc src/engine-host/fs/backfill.test.ts src/renderer/src/lane-a src/renderer/src/transcript'

The wire as in M2's step 2, one number further on the branch. `tsc-node` and `tsc-web`.

**M6.**

1. The scenes of §L written; `vmcheck 'pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'` exits 0.
2. The last merge of master; the wire collapsed to one number (M2 decision 13; step 2 of M2 from master's two files).
3. Each its own call, so each exit status is read: `vmcheck 'pnpm typecheck'`; `vmcheck 'pnpm exec eslint <every changed .ts and .tsx path of the branch>'`; `vmcheck 'pnpm test'`. Expect no failure outside the files the Constraints name as failing on master there. The whole suite holds every unit observation of Acceptance (1 to 6); read each named suite's line in its output (`move.test.ts`, `working-folder-routes.test.ts`, `one-working-folder.test.ts`, the files and endpoint suites, the card's, `backfill.test.ts`) and record the counts in Progress. If a fixture or recorded file was added: `vmcheck 'node --test .github/scripts/maws-app-scan.test.mjs'`.
4. Progress, Surprises & Discoveries and the Decision Log brought up to date; commit, push, and stop. Hand back what "Hand-back" under "What the executor cannot run" lists.

## Interfaces and Dependencies

### §A. The summary's field (M2)

In `TranscriptSummarySchema` (`src/shared/wire/store.ts`):

    newestCwd: z.string().nullable().optional(),

The `cwd` of the newest row in the tail window that carries one and is not a sidechain row (`isSidechain !== true`); null when the tail window holds no such row; absent from a producer that does not read it. `summarize` takes it from the tail only, newest first, and never from the head: a head's newest folder in a long file is old. A last line still being written counts by its start, as the summary's other tail facts do. It is optional because the summary is sent between builds (`fs.sessionChanged`) and kept as JSON in the index.

### §B. The index's rule (M2)

`upsertFromSummary` reads three folders of a summary: `H`, its first row's (`directory`); `R`, its home's (`relocatedCwd`), which may be null; `C`, its newest row's (`newestCwd`).

- **`C` absent:** today's rule, all of it: the record is located at `R ?? H`; the column of §C is null.
- **`C` present** (a folder or null):
  - `head = locate(H)`, `home = locate(R ?? H)`. The record's **launch** location is `head` when `R` is not null and both locations name the same project directory (not null), else `home`. Everything the rule writes from a location today (`project_id`, `directory`, `worktree_path`) it writes from the launch location.
  - `C` a folder: the working folder is `checkoutIn(launch, C)`. `C` null: the stored working folder is kept if the row's stored `directory` and `worktree_path` are the launch location's, and re-stamped; else none.
  - The column is written only when there is a working folder and its `cwd` is not the launch location's realpath; otherwise it is null.
  - **Branch.** Let the home's checkout be `home.worktreePath ?? home.realpath` and the working checkout be the working folder's `checkout`, or the launch location's `worktreePath ?? realpath` when there is none. `branch` is the newest row's (`branchName(summary.gitBranch)`) when the two are the same folder, else `headBranch(working checkout)`. `worktree_branch` is null when the launch location has no worktree; the newest row's branch when the launch location's worktree is the home's checkout; else what the row already stores (null on a first sighting).

In `src/services/index/projects.ts`:

    export function checkoutIn(launch: Location, folder: string): { checkout: string; cwd: string } | null;
    export function headBranch(checkout: string): string | null;

`checkoutIn`, with `now = locate(folder)`:

| `now` | answer |
|---|---|
| its realpath is null (the folder is gone) | null |
| in a worktree (`now.worktreePath` not null) of the launch project (`now.projectDirectory === launch.projectDirectory`) | `{ checkout: now.worktreePath, cwd: now.realpath }` |
| in a worktree of another project | null |
| in no worktree, and at or under the launch location's `worktreePath ?? realpath` | `{ checkout: that folder, cwd: now.realpath }` |
| in no worktree, the launch location is a worktree, and `now` is at or under the launch project's directory | `{ checkout: launch.projectDirectory, cwd: now.realpath }` (the project's main checkout) |
| anything else | null |

"At or under" is at a segment boundary. `headBranch` reads the checkout's `.git` (a directory: its `HEAD`; a file: the `HEAD` of the git directory it names) and answers the name after `ref: refs/heads/`, or null (detached, unreadable, no repository). Both are synchronous, as `locate` is.

### §C. What is stored and what is sent, against build F (M2)

| key or field | where | build F meets this build's value | this build meets F's | this build, then F, then this build |
|---|---|---|---|---|
| `sessions.agent_folder` (new, `ADDED_COLUMNS`: `TEXT`, nullable; JSON `{ checkout, cwd, size, mtimeMs }`, the last two being what the same write stores as `transcript_size` and `transcript_mtime_ms`) | the index database of the profile | F opens the file (`user_version` unmoved), names its own columns and never reads or writes this one | a database F made has no such column: the opener adds it, null | F files each transcript that changes by its own rule (it re-files on a `relocated` row) and updates size and mtime; the column's stamp then differs and the record carries no field until this build's next summary of that transcript. A transcript F did not file keeps a column that is still true |
| `directory`, `worktree_path`, `worktree_branch`, `branch` (existing columns, written by a new rule) | the same | F reads them as a record's folder; a session this build kept under its launch folder is shown by F at the launch folder | a record F re-filed under a worktree reads as launched there, with no working folder, until its next summary (M2 decision 6) | the columns hold whichever build filed the transcript last; the two differ only for a session whose home is a worktree of its launch project |
| `newestCwd` inside the stored summary (`sessions.summary`, JSON) | the same | F parses the JSON unvalidated and names the fields it knows | a summary F stored has no such key: applied again it is filed by today's rule (§B) | as written by whoever summarised last |
| `SessionRecord.agentFolder` (new, optional) | `session.get`, `session.list`, `session.changed`, between builds on one machine and between machines | F's receiver drops the key (the tolerant reader) and shows the launch folder | absent: the launch folder | nothing is stored |
| `TranscriptSummary.newestCwd` (new, optional) | `fs.sessionChanged`, engine host to the spine | F's spine drops the key and files as F does | an engine host of build F sends none: today's rule | nothing is stored beyond the row above |
| `tool.use`'s `cwd` (new, optional; M5) | session events | F drops the key and shows "Session directory" and its own folder | absent: "Session directory <launch folder>" | nothing is stored: the file reader derives its events at each read, and the live route never sets the key |

Neither settings file and no layout key changes. The coverage table's row and scene are §L's.

### §D. The record's field and the selector (M2)

In `SessionRecordSchema` (`src/shared/graph/session.ts`):

    agentFolder: z.strictObject({ checkout: z.string(), cwd: z.string() }).optional(),

Present only when the newest row's folder is not the folder the record names as its directory: `checkout` is the root of the checkout of the launch project that holds it, `cwd` its realpath. The index is its one writer; `toRecord` emits it from the column only while the stamp matches (§C).

In `src/shared/sessions/working-folder.ts`, the interface unchanged (UC-4):

    export function workingFolder(record: Pick<SessionRecord, 'directory' | 'worktree'> & Partial<Pick<SessionRecord, 'agentFolder'>>): WorkingFolder {
      const launch = record.worktree?.path ?? record.directory;
      const at = record.agentFolder;
      return at === undefined ? { path: launch, cwd: record.directory, launch, moved: false } : { path: at.checkout, cwd: at.cwd, launch, moved: at.checkout !== launch };
    }

`useWorkingFolder(appSessionId)` is unchanged; its shallow comparison already gives a new object only when a field changes.

In `src/renderer/src/sessions/branch-label.ts` (M4), beside `recordBranch`, which is unchanged:

    export const workingBranch = (record: Parameters<typeof workingFolder>[0] & Pick<SessionRecord, 'branch'> | null | undefined): string | null;

`branchName(record.branch)` while `workingFolder(record).moved`, else `recordBranch(record)`; null for no record. It is the branch a reader shows for where the agent is before git has answered, and when it asks git nothing.

### §E. One answer on the three routes (M2)

**Where the field is produced, when it changes, how late.**

| route | produced by | changes | how late | between a resume and the first row |
|---|---|---|---|---|
| a session MAWS runs | this machine's engine host summarising the transcript the engine writes, and the spine's index (§B) | at the first row written after a move: the tool's own result row | the watcher's 50 ms after the file's last write, one read of two 64 KiB windows, the index's batch (a folder located for the first time asks git once, bounded at 2 s) and the 16 ms tick; a file event the system drops delays it to the file's next write; a newest row larger than the tail window delays it by one row | the stored field: right for a worktree entered through the tool (the engine returns to it); for a folder reached by `cd` it shows that folder until the first row, which names the launch folder |
| a terminal session | the same code, the same file | the same | the same | the same |
| a session on another machine | that machine's engine host and index; the record comes whole through `session.get` and the checkout feed's `session.changed` | the same, there | the same, plus the link | the same; a machine on build F sends no field and the session shows its folder as F files it |

**The table `test/working-folder-routes.test.ts` asserts**, for the headless and the terminal fixture alike (folders relative to the probe's scratch root; the launch folder is `work` at every step, and so are `record.directory` and a null `record.worktree`):

| steps | `path` | `cwd` | `moved` | `record.branch` |
|---|---|---|---|---|
| `s0-start` | `work` | `work` | false | `master` |
| `s1-enter-worktree`, `s2-run-there` | `work/.claude/worktrees/pz-alpha` | the same | true | `worktree-pz-alpha` |
| `s3-exit-keep`, `s3b-run-after-exit` | `work` | `work` | false | `master` |
| `s4-cd-second-worktree`, `s4b-run-after-cd` | `work/.claude/worktrees/pz-beta` | the same | true | `pz-beta` (git's; the rows say `master`) |
| `s5-cd-subfolder`, `s5b-run-after-subfolder` | `work/.claude/worktrees/pz-beta` | `…/pz-beta/sub` | true | `pz-beta` |
| `s6-cd-sibling-outside` and every later step (the engine undid the `cd`; the subagent steps; the terminal fixture's `s9-after-resume`) | `work` | `work` | false | `master` |

At each step it also asserts, from the same record, what the surfaces are given: the selector's `path` is the folder the card watches and Review, Source control and a new terminal use; `record.branch` is the last column, which M4's `workingBranch` shows. M3 adds to the same test that the files service's roots hold `path` at every step. The headless resume fixtures (`uxwave-folder-headless-resume.jsonl`, `uxwave-folder-resume-cd*.jsonl`) hold no step records of the same shape; their one fact (after a resume the first row names the launch folder) is the last row of the table for the terminal fixture and a case of the summary's suite for the headless one.

### §F. Where a transcript is; the tree test's second rule (M2)

In `src/services/sessions/context.ts`:

    export function knownTranscript(sessions: { summaryOf(appId: AppSessionId): TranscriptSummary | null }, appId: AppSessionId, sessionId: SessionId): string | null;

The stored summary's `transcriptPath` when the summary is of `sessionId`, else null. Callers ask whether that path exists and, if it is null or missing, the path `transcriptPathOf` gives for the record's directory, in that order: `services/owner/register.ts` (`transcriptOf`), `services/owner/launch.ts` (`recordedOf`), `services/sessions/resume.ts` (the failure's outcome), `services/sessions/recovery.ts` (both), `services/sessions/setup.ts` (the rollback). The three that already ask the summary first are not changed.

`test/one-working-folder.test.ts` gains: over every `.ts` and `.tsx` file under `src/` that is not a suite (`*.test.ts`, `*.test.tsx`) and not under a `test-support` folder, a member access of the field, `(?:\?\.|!\.|\.)\s*agentFolder\b` or `\[\s*['"]agentFolder['"]\s*\]`, outside `src/shared/sessions/working-folder.ts` and a counted table of exceptions, fails with the first rule's guidance. Expected exceptions, each with its exact count taken from the red run: `src/endpoint/targets.ts` (the narrowing of an untyped record). An object literal that sets the key (`agentFolder: …`) is not a read and is not counted; the index builds the record that way. The samples table gains one line that counts and one that does not for each form.

### §G. What may be read there (M3)

**The lists of a session's roots.**

| list | reader | gains | by |
|---|---|---|---|
| `rootsOf` in `src/services/files/allowlist.ts` | every `files.*` call, the anchored-comment screenshots | the working folder's realpath | registered at the call (below), then the home rule for a remote caller |
| `rootsOf` and `CheckoutBounds.of` in `src/endpoint/targets.ts` | a remote `git.*` read; the checkout feed | the same | the machine's `git.worktree.list` at the launch folder, asked per request and never kept; then the home rule |
| `recordDirectories` in `src/shared/sessions/directories.ts` | the reveal guard of `settings.reveal`; `git.lsFiles`'s roots | `workingFolder(r).path` when moved | the record's word |
| `rootsFor` in `renderer/src/tools/code/files/tree.ts` | the roles of Files' roots, its listing key | a candidate with the role `working folder` when moved | the record's word (the service lists the root or does not) |
| `underSession` in `renderer/src/tools/artifacts/viewers/model.ts` | whether "Open as file" is offered | the working folder | the record's word (the read itself is the files service's) |
| `revealablePath` in `src/services/sessions/record-actions.ts` | `session.revealPath` | the working folder, exact match as the others | the record's word |
| `occupancyOf` in `src/services/sessions/holders.ts` | whether a worktree is busy before it is removed | a session whose working folder is there | the record's word |

**Registered.** In `src/services/files/allowlist.ts`:

    export async function registeredWorktree(launch: string, real: string): Promise<boolean>;

True when `real` (a realpath) is the root of a work tree whose repository is the one `launch` is in and whose entry under that repository's `worktrees/` names it back, or is that repository's main work tree; read from git's files at the call. `src/shared/machine/git-reads.ts` already reads exactly this (`discoverRepo`, `worktreeList`) through a file-access interface; reuse it with plain file access rather than writing a second reader. Any failure to read answers false. `rootsOf(record, remoteHomes)` keeps its signature: when `workingFolder(record).moved`, it resolves `path`, asks `registeredWorktree(realpath of the launch folder, it)`, and appends it after the record's other roots.

**The endpoint.** `rootsOf(record)` in `targets.ts` stays the record's declared roots; `CheckoutBounds.of` adds the working folder as decision 5 of M3 says, outside what it keeps per set of roots, and `checkoutOf` is the checkout it judges Source control's output by.

### §H. The card (M4; U8b's `Environment`)

`RecordCards` computes `const folder = workingFolder(record)` once; the watch and every prop that was `directory` take `folder.path`. `Environment` is given what it needs to draw the two additions (the executor chooses the props). Words, added to the card's copy:

    movedFrom: (name: string) => `moved from ${name}`,   // name: the launch folder's last path segment; the element's title is the launch folder
    inside: (below: string) => `in ${below}`,             // below: cwd relative to path, when cwd is under path and differs

Rows, top to bottom, with a moved record `{ directory: '/repo', worktree: null, agentFolder: { checkout: '/repo/.claude/worktrees/w1', cwd: '/repo/.claude/worktrees/w1/src' } }`: the machine row as today; the folder row `/repo/.claude/worktrees/w1` with the Files button, and muted beside or under the path "in src"; a muted line "moved from repo" (title `/repo`); the branch row as U8b draws it, from git at `/repo/.claude/worktrees/w1`; the change line; the push row; the model row. The muted line is absent while `moved` is false; "in …" is absent while `cwd` equals `path`.

### §I. What each surface does at a move, and what a person in the middle of something sees (M4)

A move here is any change of the selector's `path` (into a worktree, between two, back). A change of `cwd` alone changes the folder row's "in …" and the composer's folder and nothing else.

| in hand | at the move | when the folder moves back |
|---|---|---|
| the card open | the folder row changes at once; the branch row and the header read the pending copy and the change line is absent until git answers for the new folder; the pull-request row asks again | the same, the other way; nothing is kept warm |
| a diff open in Review (the tool or a diff tab) | it is replaced: the scope is decided for the new folder, its first file is shown from the top; an answer still coming for the old folder is dropped | Review starts over again; files marked viewed in a folder are still marked there if they have not changed |
| a comment being written | Review has none to write on master or with U5a. A comment on a file's line belongs to the file tab (an absolute path) and stays. For U5b's line comments in Review the rule is U5's ("unsent Review comments belong to the session and stay"); a pass's key holds no folder | the same |
| Source control with a sheet open (Discard, Push, pull request) | the sheet closes; the selection, the notice and the last commit are cleared; the commit message is put away for that folder | the message written for a folder is there again |
| a push running | it runs on in the folder it started in; M4 decision 6's first gap | its output is found again by the tool's own ask for the checkout's last run |
| a file open with unsaved edits | nothing: the tab is its absolute path and keeps its text. Saving works while a root of the session holds the path: always for a file under the launch folder; for a file in a worktree outside it, only while the agent is there | after the agent leaves a worktree outside the launch folder, a save of a file in it answers the files service's refusal and the editor keeps the text unsaved |
| Files with rows open | the working folder is listed as a root labelled "working folder" and expanded; no row is collapsed, the selection and the scroll stay | the root leaves the list (it is still reachable under the launch folder when it lies there); the launch root is the first root again and is expanded |
| a listing that is loading | a roots answer in flight lands and is replaced by the new listing; the first root is never set to one that is not listed; a folder's listing in flight is that folder's and lands in it | the same |
| a search | Files has none. The composer's `@` list in flight is for the old folder and is not offered for the new one | the same |
| a terminal open | it keeps its shell; its bar reads "This terminal is in …; the session now runs in …" with "New terminal here" | the bar goes when the session's folder is the terminal's again |
| a question sheet's file picker; a proposed change's relative path (U1a) | the next one opens in, or is relative to, the new folder | the same |
| an upload sent before the move | read back from where it was written (M3 decision 7) | the same |

### §J. Files other children own or several landings edit (UC-8)

Insertions in files another child owns, each the smallest that does it:

| file | owner | this landing's insertion | milestone |
|---|---|---|---|
| `src/engine-host/fs/service.ts` | U3's row (the file reader's callers); U8b's M6 also edits it | the move's handling: the settle before a removal, the agents' follows and listing re-pointed | M1 |
| `src/engine-host/fs/backfill.ts` | U3 | one optional member on a shell tool's `tool.use` | M5 |
| `src/renderer/src/transcript/model/cells.ts`, `view/cells/ShellDetail.tsx`, `view/TranscriptSlot.tsx` | per UC-3 | the shell cell's folder; the detail's rule; the slot's `launch` | M5 |
| `src/renderer/src/composer/Composer.tsx`, `frame/bindings.ts`, `resubmit-seam.ts`, `mentions/AtMenu.tsx` | U4 | the folder read from the selector alone; the chip's path; the list kept with its folder | M4 |
| `src/renderer/src/request-card/RequestCard.tsx` | U1 | the hover line's expression | M4 |
| `src/renderer/src/app/Toolbar.tsx` | U7 | one call in `toolbarTitle`: `workingBranch` in place of `recordBranch` | M4 |
| `src/renderer/src/sidebar/RequestPreview.tsx` | U7 (U1 inserts `waits`) | the line's expression | M4 |
| `src/renderer/src/tools/code/review/view-state.ts`, `ReviewTool.tsx`, `DiffTab.tsx`; `tools/scm/view-state.ts`, `ScmTool.tsx` | U5 | the view starts over on a change of folder | M4 |
| `src/renderer/src/tools/code/files/FilesTool.tsx`, `tree.ts` | U6 | the candidate, its role, the first root, the listing key | M3, M4 |
| `src/services/owner/register.ts`, `launch.ts` | U2 | `knownTranscript` asked first | M2 |
| `src/endpoint/targets.ts` | the P5 work (the session that keeps master) | the working folder in `CheckoutBounds.of`; the narrowing | M3 |

In files no child owns, which other landings also edit; whoever lands second merges master first, and each hunk below is apart from the other's:

| file | also edited by | this landing's hunk |
|---|---|---|
| `src/shared/ipc/wire.ts`, `wire-manifest.json`, `wire-fingerprint.json` | U8b, U3a, U1a, U5a, U11a, U12a, U4a, U2a | one number, allocated last (M2 decision 13) |
| `src/shared/graph/events.ts` | U3a (`user.message`), U4a | `tool.use` |
| `src/renderer/src/ipc/events.ts` | U13a and U8b (the hydration call), U7a (the snapshot closure) | where a record's change is stored |
| `src/services/index/sessions.ts` | U7a (`cutPrompt`) | `upsertFromSummary`, `toRecord` |
| `src/services/sessions/recovery.ts`, `context.ts`, `record-actions.ts` | U5a; U9 | the transcript's place; the reveal list |
| `src/renderer/src/session/controls/lane-a.ts` | U5a, U1a, U4a | the chip's recorded branch (one call) |
| `e2e/cross-build.spec.ts`, `e2e/remote.spec.ts`, `e2e/code-tools.spec.ts` | U13a, U8b, U3a, U4a | this landing's scenes and row |

`src/renderer/src/overview/SessionCard.tsx` and `src/renderer/src/sessions/branch-label.ts` (M4: `workingBranch` and one call) are in no row of UC-8's table, and no landing read for this document edits them.

Consumed from the others, by the name each exposes: from U8a (on master) `workingFolder`, `useWorkingFolder`, `test/one-working-folder.test.ts`; from U8b `RecordCards`, `Environment`, `CardFold`, the card's copy object, `PushState({ directory, appSessionId, embedded })`; from U3a `recordToEvents` and its `assistantEvents`; from U13a the coverage table and its scenes' harness in `e2e/cross-build.spec.ts`; from U1a the hover placement's folder line. Nothing from U9, U4a, U5a or U7 by name. Exposed to siblings: §D (the field, the selector's answer, `workingBranch`), §G's `registeredWorktree`, §F's `knownTranscript`, §K.

### §K. A shell call's folder (M5)

In `src/shared/graph/events.ts`, the `tool.use` event gains `cwd: z.string().optional()`: the folder the call's row records, set by a producer that reads rows, for a shell tool's call only. The model's shell cell takes `input.cwd` when it is a string, else the event's. `ShellDetail` shows, in this order: the cell's folder when the input named it (label `DETAIL.cwd`); the cell's folder when the event carried it and it is not the transcript's `sessionDirectory`, compared as Files compares a root with a record's folder (`sameFile` in `tools/code/files/tree.ts`: equal, equal but for case, or equal but for macOS's `/private` prefix), so a session run through another spelling of its folder keeps today's line (the same label); else `DETAIL.sessionDirectory` and `sessionDirectory`, which `TranscriptSlot` now sets to the selector's `launch` (and still to null for a child agent's transcript).

### §L. The scenes and the cross-build row (M6)

Each scene uses a scratch config home, a scratch git repository the test makes with one worktree under `.claude/worktrees/` and one beside the repository, and transcripts of invented rows. None starts an engine.

1. **`e2e/code-tools.spec.ts`, "the card and the code surfaces follow the agent".** A session discovered from a transcript in the repository, opened. Rows appended whose `cwd` is the worktree under the repository: the card's folder row is the worktree, its branch row the worktree's branch, "moved from <repository's name>" shows; Review lists a change made in the worktree and not the repository's; Files' first root is the worktree, labelled "working folder"; a new terminal's status bar names the worktree; a terminal opened before shows the worktree warning. Rows appended in a sub-folder of the worktree: "in <sub-folder>" shows and nothing else changes. The transcript and its folder renamed into the worktree's project folder with a `relocated` row, as the tool does: the session's sidebar row stays where it is and is never absent. Rows appended in the repository: all of it returns.
2. **`e2e/terminal.spec.ts`:** "pinned tab keeps its shell across sessions and warns about the worktree" still passes as written.
3. **`e2e/remote.spec.ts`, "another machine's session that moved".** Through the spec's two-profile harness, if it can place a transcript on the far side (the executor says in the hand-back if it cannot): the card names the worktree, Files lists it, a git read at the worktree beside the repository passes the endpoint while it is registered and is refused once the test removes its registration.
4. **`e2e/cross-build.spec.ts`,** one row in U13a's table and one scene. Row: `the index: sessions.agent_folder` | F opens the profile, lists the session at the folder F files it under, and files on | this build shows the launch folder for a session F filed last, and the working folder again after the session's next row. Scene: this build shows a moved session's card with "moved from"; the peer opens the same profile and shows the session; the test appends a row while the peer runs; this build opens again and shows the session with no "moved from" until the test appends one more row, then shows it again. Proved by what each build draws, never by reading a key back. Skipped, with its reason, unless the peer is build F.

## The owner's look

The owner approved the section's reading: the surfaces follow, not only the display. What has not been seen is the card after a move: three new pieces of text on a card that is on screen all day, and where they sit. A drawn example is recommended before M4 is built; M1 to M3 do not wait for it. Drawing it is the architect's. With invented folders and branches it would show:

1. The Environment card of a session at its launch folder, as U8b draws it (for comparison).
2. After a move by the tool: the folder row naming the worktree, the branch row naming the worktree's branch, and "moved from <name>" under the folder row.
3. After a move by `cd` into a sub-folder of a worktree: the same with "in <sub-folder>".
4. The moment after a move: the folder row already changed, the branch row reading the pending copy, no change line.
5. The folded card's header in frames 2 and 4.
6. Files with the worktree as a root labelled "working folder" beside the launch root, and an open terminal's bar ("This terminal is in …; the session now runs in …", today's).
7. The sidebar row and hover card of the same session, which do not change (Reported 4), beside what build F shows there after `EnterWorktree`.

Questions it would put: where "moved from" sits (under the folder row, as drawn, or under the branch row); whether "in <sub-folder>" earns its place (law 3) or the folder row shows the agent's folder whole; and Reported 4.

## What the executor cannot run

Each is a step handed to the architect, with what it needs.

1. **M1's cases on macOS.** After M1 is pushed: the gate's Mac lane on the branch (`--gates unit:darwin`), which collects `src/engine-host/fs/move.test.ts` by its guarded case and runs every case of the file. Needs: the pushed head. Expected: every case passes, none skipped. A case that fails there and passes on Linux is a finding about macOS's file events and goes back to M1.
2. **The measured bound** of `src/services/index/sessions.test.ts` (4,000 upserts in one transaction), which is guarded for macOS: the same lane after M2. Needs: the pushed head.
3. **The engine check of Reported 9** (a fork started from the launch folder of a session inside a worktree it entered through the tool), on the probe VM with engine `2.1.322`, before M2 lands; and, if the architect wants `/cd` on record, the same session moved with `/cd` (which rows it writes). Needs: nothing of this branch.
4. **The Electron scenes** of §L, on a Mac under the load rule: `e2e/code-tools.spec.ts` (the new scene alone first), `e2e/terminal.spec.ts`, `e2e/remote.spec.ts`, and the groups that cross the changed code (`scm`, `panel`, `ux2-shell`, `composer`, `transcript`, `lane-a`, `sessions`). Needs: the complete branch.
5. **The cross-build run** with build F as the peer (`--gates e2e:cross-build --peer f1852de3a`; the run of record with the exact peer), after U13a's table is on master. A skipped scene is not evidence.
6. **Class 1a,** the branch's review (Decision Log 1) and the pull request.
7. **The owner's look** (above), and A10 in the owner's sitting on the three routes, which needs a live engine on a machine that is not the MacBook.

**Hand-back, by the executor of the last milestone:** what exists and how it was verified (each command and its result); what is not verified; the decisions it made; anything that contradicted this document or the spec; which scenes it could not write as §L says; what it left that deserves a ticket.

## Surprises & Discoveries

Found while writing this document, against master `89e25cb20`, and reported to the architect, who alone edits the spec.

- Observation: a terminal session's job reader and a follow of an agent both lose a transcript the engine moves; the session's own follow does not.
  Evidence: `src/services/lane-a/transcript-jobs.ts`, `this.path ??= await this.locate();` and `if (missing(error)) return;`; `src/engine-host/fs/service.ts`, `relocateFollows`: `for (const entry of this.follows.values()) if (entry.agentId === null) entry.location.path = …`, and `locateFollows`: `if (entry.sessionId !== sessionId || entry.agentId !== null || entry.location.path === path) return false;`. Build F holds the first line too.
- Observation: a moved transcript is told to the index as a removal and then a return, and the record is archived in between.
  Evidence: `summarizePath` in `service.ts`: `if (summary === null) { if (this.listed.get(sessionId)?.path === path) this.forget(sessionId); return; }`; `src/services/index/sessions.test.ts`: "Whole-branch review: a relocation arrives as `fs.sessionRemoved` then `fs.sessionChanged` for the same session."
- Observation: the engine writes a `relocated` row for a directory move by the person or the host as well as for the worktree tool.
  Evidence: engine `2.1.322`, `cli.pretty.js:381469` (the function that moves the transcript and stamps the row) is called at `:947458` from the function that serves `/cd` and `set_cwd` (`:947447`, telemetry `tengu_cd_command`), and at `:1073395` and `:1073498` from the worktree tools. Not probed.
- Observation: five places derive the transcript's path from the record's directory and would miss it once the launch folder stops moving.
  Evidence: "What the code holds today" 3.
- Observation: the engine's status folder has five readers in the window, not two.
  Evidence: `composer/resubmit-seam.ts` (`cwd: status?.cwd ?? ''`), `widgets/SkillsWidget.tsx` and `widgets/PluginsWidget.tsx` (`s.engine.get(appSessionId)?.cwd ?? s.records.get(appSessionId)?.directory`), beside the composer and the chip.
- Observation: on the live wire only `system/init` names a folder.
  Evidence: `spikes/protocol-probe/fixtures/pass3/uxwave/uxwave-folder-headless.jsonl`: 15 `system/init` frames carry `cwd`; none of the 42 `assistant` and 52 `user` frames does, and a Bash result's structured part is `{ interrupted, isImage, noOutputExpected, stderr, stdout }`.
- Observation: an open terminal already tells the person that the session works elsewhere and offers a terminal there.
  Evidence: `tools/terminal/TerminalView.tsx`, the "worktree warning" bar; `e2e/terminal.spec.ts`, "pinned tab keeps its shell across sessions and warns about the worktree".
- Observation: Source control resolves its checkout at each call and sends no folder, so a sheet opened for one folder acts in another after a move.
  Evidence: `src/services/scm/service.ts`, `private checkout(appSessionId)`; `tools/scm/view-state.ts` keeps the sheet across a remount.

## Decision Log

1. **2026-11-13 (the author, at writing): the verification call.**
   - This document gets an adversarial review before an executor starts (the architect dispatches it), and one more pass by its author over "To check again" once U8b and U3a are on master.
   - The branch gets `doperpowers:review-code` at the **xhigh panel**. The root names UC-4's second landing delicate and gives it "the review panel with a reviewer on that boundary"; by size it is over the line too: about 85 files and about 4,000 changed lines outside this document, more than half of them tests. Who runs the panel is the architect's to name; `src/endpoint/targets.ts` belongs to the session that keeps master, which reviews that hunk. Lenses: (1) the boundary: the files allowlist, the endpoint's bounds, a caller on another machine, a stale or forged folder, Source control acting at the record's folder (M3); (2) the index's rule and build F in both directions: the launch folder's stop, the stamp, a record F filed, the transcript's place (M2); (3) the three routes: the summary's tail window, how late, a moved transcript on macOS and Linux (M1, M2); (4) the window at a move: every awaited sequence held open, work in hand, what starts over (M4); (5) the wire and the transcript's model: the three optional keys, the tolerant reader, UC-3 (M2, M5).
   - Class 1a on GitHub Actions is the gate of record; the Mac lane is run after M1 and after M2.
   - The pull request's body names its class 1a run, its review verdict and its residue.

## Outcomes & Retrospective

Pending — written at finish.
