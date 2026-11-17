# UX wave · U6, the first half of U6b's third landing (U6b-3a): Files shows what changed

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*). **The cut:** `docs/doperpowers/plans/2026-11-14-ux-wave-U6b-cut.md`, cited below as *the cut*: its section "U6b-3 · Files shows what changed, and finds a file by name" and its table "Points reported to the architect, and ruled". **Parent pin:** `bdbfe863e6b2f59031c10f0c51873c4a0210b00b`, the head of the wave's chain through its fourth batch: master `77af813a4` and eight landings that are in review and not on master yet, U6b-2 among them. Every statement about the code below was checked against it, and the root, the child's file and the cut are read at it.
>
> **The landing.** The cut's U6b-3 is two landings since 2026-11-17 (Decision Log 3). **U6b-3a**, this document: what changed. The daemon's ignore check with probe 8, both optional wire fields in one minor, the Changed group, the marks in the tree, the dimmed entries. **U6b-3b**, `docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md`: Go to file, in the window alone, built on a branch cut from this landing's head. In the chain: U6f, then U6b-3a, then U6b-3b, then U6b-5. Of the child's acceptance, this landing proves the first sentence of **A3** ("With uncommitted changes in the working folder, Files shows a "Changed" group on top with one row per changed file and its status letter; the tree shows the same letters, a dot on a folder that holds changes, and ignored entries dimmed") on all three routes; U6b-3b proves its second sentence (⌘P, the filter, Enter, `name:42`) and A13 for the row `files.goToFile`. Of item l5-code-09's "After", the first three paragraphs are built here (the Changed group, the marks, ignored entries dimmed) and the fourth there; "Routes" in each for its part. Neither claims the other's.
>
> **The design** is the child's file, item "l5-code-09 · Files shows what changed, and finds a file by name", and the cut's section, which fixes where it is drawn, what is asked of whom and the wire. This document builds that design and does not reopen it. It carries the constraints, what the cut left to this document (how the lists stay current, what each kind of changed entry shows and does, probe 8), the milestones and the interfaces.
>
> **Branch:** `ux-wave/U6b-3`, from `bdbfe863e`. **Board:** ticket 672, under ticket 592. **Not in this landing:** Go to file, its action, its field and every move of the keyboard (U6b-3b); search inside files, hiding dotfiles, a filter over the tree's own rows (the child's "Not included"); the notices' words, `file://` and relative links, "Open in" (U6b-4); Back and Forward, zoom, the palette's recent list (U6b-5).
>
> **Revision 2 (2026-11-17).** The first writing (`5a73f8fa3`) was one landing of four milestones. The adversarial review returned seven findings, no P1, all accepted (Decision Log 2); the session that keeps master ruled the split in two (Decision Log 3); the architect ruled on the nine reported points (Decision Log 4). What moved here: the third milestone of the first writing, with decisions 16 to 25, sequences S3 to S5, acceptance B4 to B8 and the second card, left for U6b-3b's document; the check's git runs are ended by the daemon's stop, and what holds after a crash is said (finding 1); a status whose set of entries changed lists the drawn directories again, and what stays stale is said (finding 2); the cross-build scene waits on a dirty submodule's status and on a second change's `git.changed`, with a same-build control (finding 7); a row for an entry outside the session's folders opens Review (R6, changed); a repository git refuses is "no group, no marks, no dimming, and no line in Files", and no more (finding 6, whose finder half is U6b-3b's).

## Purpose

Today Files is a tree and nothing else. A person who reviews what an agent did has to open Review to learn which files changed, and the tree gives build output and logs the same weight as source.

After this landing the Files tab beside the chat shows what changed. A **Changed** group on top of the tree lists every file git reports as changed in the session's working folder, with a status letter; the tree shows the same letters, a dot on a folder that holds a change, and the entries git ignores in a quieter colour. It holds for a session MAWS runs, a terminal session and a session on another machine, where the status and the listings are read on that machine by commands it already offers. Finding a file by its name is the next landing, U6b-3b.

How to see it working: in a session whose agent has edited two files and written a new one, press ⇧⌘F. Files shows "Changed 3" above the tree with three rows, `M`, `M` and `U`; the folders that hold them carry a dot; `node_modules` and the log folder are grey. Click a row: the file opens beside the chat. Delete a tracked file in a terminal: within about a second a fourth row appears with `D`, and a click on it opens Review at that file. Add a line to `.gitignore` that names the new file: its row leaves the group and its name turns grey in the tree.

## Progress

- [x] (2026-11-17) The first writing (`5a73f8fa3`), against `bdbfe863e`: the cut's section and the child's item checked in the code at that head; the two builds that bind read (`git show 2c7044231:…`, `git show f1852de3a:…`) for the listing's schema, the wire's minor and every place a daemon's answer is read; Claude Desktop `app-5.1231.2` read for its Files pane and its marks; `git check-ignore` tried on a scratch repository for the five facts decision 12 rests on.
- [x] (2026-11-17) The adversarial review (seven findings), the split in two landings, and the architect's rulings on R1 to R9 and on the cards (Decision Log 2 to 4).
- [x] (2026-11-17) Revision 2: this document cut to U6b-3a, findings 1, 2 and 7 fixed in it, R6 as ruled; `src/services/git/runner.ts` (`execGit`, `createGitRunner`'s `execFile`), `src/services/stop-parts.ts`, `src/services/files/watch.ts`, Review's `outside` and the cross-build scene's `withUnit` read again at the pin for them.
- [ ] The owner's look at the drawn example ("The look") and the answer on the card, before M2 starts.
- [ ] M1 — The daemon: the ignore check, probe 8, a submodule's mark, the wire's minor.
- [ ] **Stop.** Probe 8's verdict to the architect; M2 starts on the architect's word.
- [ ] M2 — The window: the Changed group, the marks, the dimmed entries.
- [ ] M3 — The scenes, the cross-build row, the record, and the acceptance run.
- [ ] The proof an executor does not run ("Proof that an executor does not run", 1 to 8).

## Words used in this document

- **The daemon** is `mawsd`, the per-Mac background process that runs the machine's services; the files service (`src/services/files/`) and the git service (`src/services/git/`) run in it (`src/services/checkouts-root.ts`). **Main** is the Electron main process of the app; **the window** is its page. Main and the window are always one build; the daemon, and a daemon on another machine, may be another.
- **The working folder** is root UC-4's: the checkout the agent's main loop is working in now, answered by `workingFolder(record)` (`src/shared/sessions/working-folder.ts`) and, in the window, `useWorkingFolder(appSessionId)` (`src/renderer/src/sessions/working-folder.ts`). Its `path` is the folder every git read of this landing is made in.
- **The tree column** is the part of a Files tab that draws the tree (`[data-files-tree]`, `src/renderer/src/tools/code/files/FilesTool.tsx`), built by U6b-1. It is not drawn in a tab whose tree is folded away. **A drawn listing** is a `files.list` answer the window holds for a directory that is open and shown in a drawn tree.
- **A status entry** is one element of `GitStatus.files` (`src/shared/ipc/schema/git.ts`): a path relative to the repository's root, the two characters of porcelain v2's XY field as `index` and `worktree`, `untracked`, and a rename's `oldPath`. A wholly untracked folder is one entry whose path ends in `/`.
- **The git store** is `useGit` (`src/renderer/src/stores/git.ts`): per machine and folder, the status `git.watch` answered, kept current by the event `git.changed`. **The set of a status's entries** is its list of paths, each with its letters; two statuses with the same set differ at most in when they were read. The session's summary card (`panel/summary/Summary.tsx`), Review (`review-store.ts`) and the Source control page hold it today, each through the store's own count.
- **Read mode** is how every git call of the read services runs (`gitEnv`, `src/services/git/runner.ts`): no hooks, no fsmonitor, no credential helper, no external diff, no pager, no transport, optional locks off, and git's own check of who owns the repository left on.
- **Build F** is `f1852de3a` (wire 3.33) and **build M** is `2c7044231` (wire 3.46): the two earlier builds a profile that runs this landing may have run before, or may be taken back to (root UC-14). Every machine runs build M today; build F is kept as the build to go back to.
- **A measured bound** is a number read from a run on a named class of machine. It is written with its label, the machine it holds on and what a miss means. No test of this landing asserts a wall time.

## The landing's edge

**In.**

- The Changed group: one row per entry `git.status` lists for the working folder, with its letter (M modified, A added, U untracked, D deleted, R renamed, ! conflict) and a heading that counts them; present only while there is at least one. A click opens the file as a tree row's click does; a row with nothing in the working tree to open, and a row for an entry outside the session's folders, opens Review at that file; a folder's row opens that folder in the tree.
- The marks in the tree: the letter on a changed file's row, a dot on a folder that holds a change, and the entries git ignores drawn in the muted colour.
- `files.list` answers, per entry, whether git ignores it; a status entry says when it is a submodule. Both keys in one wire minor.
- The ignore check's own lifetime: bounded, admitted four at once, ended by the daemon's stop.
- Probe 8 of the child's file: the ignore check's cost on a directory of 5,000 entries, measured on the build VM.
- The scenes of A3's first sentence on a Mac (written here, run by the architect), the cross-build row, and the record.

**Not in, and whose.**

| not in | whose |
|---|---|
| Go to file: the action `files.goToFile`, ⌘P, the field above the tree, the ranked list, its keys, `name:42`; the keyboard put into a file or a field | U6b-3b (`docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md`) |
| search inside files; hiding dotfiles; a filter over the tree's own rows | nobody's: the child's "Not included" |
| the words of a refusal in a file's tab ("Refused: " and the service's sentence) | U6b-4 |
| staging, discarding or committing from the Changed group | never: Source control's (U5) |
| a Changed group for a branch or a turn | never: Review's scopes |
| ending the other git reads (status, diff, log, `ls-files`) at the daemon's stop | not built: today's state, a tracker row (decision 13) |

## What the code holds today

Read at the pin; each line is a fact the milestones build on.

- **Files' tree.** `FilesTool.tsx` draws one virtual list of rows (`TreeList`) from `rowsOf` (`files/tree.ts`): the session's roots (the realpaths the files service listed for it), their entries as folders are opened, and notices. A row is a `<button role="treeitem">`; a click opens or closes a folder and opens a file in the session's preview tab (`openFile`), a double-click keeps it, ⌘-click opens a main tab. The tree is the session's (`useTreeState`, `files/tree-state.ts`): open folders, width and fold are stored under the layout key `files.tree`; the selection and the scroll offset last for the run. The row of the first root carries a Refresh button. Nothing in the tree handles an arrow key.
- **Listings.** `useFiles` (`files/store.ts`) holds a `files.list` answer per session and directory, watches each open directory (`files.watch`) and lists a directory again on a `files.changed` that names an entry in it. One flight per directory at a time, with one more queued.
- **`files.list`** (`src/services/files/service.ts`, `list`) opens the directory by the open-first boundary, reads its names, reads each entry's `lstat` at most 64 at once, confirms the directory once more, sorts (folders first, then by name) and answers at most `FILES_LIST_MAX_ENTRIES` (5,000) entries with `truncated`. Its answer stays private until the confirmation after its last read. The service runs no git and is given no runner. `FilesEntrySchema` is strict: `name`, `path`, `kind`, `size`, `mtimeMs`, `target`. The command has no entry in `COMMAND_BUDGETS_MS` (`src/services/command-budgets.ts`), so its budget is a host request's default, `REQUEST_TIMEOUT_MS` (10 s, `src/shared/host/host-supervisor.ts`).
- **Git status.** `GitService.status` runs `status --porcelain=v2 --branch -z --untracked-files=normal` in the repository's root; `parseStatus` (`src/services/git/porcelain.ts`) keeps the path, the XY characters and a rename's source, and drops the record's `sub` field, which says whether the entry is a submodule. `git.watch` answers the same status and holds a watcher on the repository (`watcher.ts`): a 250 ms trailing debounce capped at 1 s, one `git status`, and `git.changed` with the fresh status when anything of it moved (a listed file's size or time included); a root that ran out of watches is read every 5 s instead. None of the read commands is behind the trust rule: `scm.*` alone runs "only after you trust the folder in a session" (`src/services/scm/validate.ts`).
- **`git check-ignore`** already runs in read mode, for the watcher's prune on Linux (`src/services/git/ignored.ts`): one `check-ignore -z --stdin` per batch, exit code 1 accepted as "none".
- **A git run's lifetime.** `createGitRunner` (`src/services/git/runner.ts`) starts git as the leader of a process group of its own (`execGit`, `detached`) and bounds it with a timer in the daemon: SIGTERM to the group at the timeout, SIGKILL half a second later. A `GitRun` gives its caller no handle and no way to end it, and the checkouts' stop (`stop` in `src/services/checkouts-root.ts`, a list of synchronous parts run by `stopParts`) ends no git run. So a run alive when the daemon goes outlives it, with nothing left to bound it. The runner takes its spawn function as an option (`execFile`), which is how its tests give it a stand-in.
- **What a directory watch hears.** `files.watch` is one non-recursive watch per directory (`src/services/files/watch.ts`), and the window holds one only for a directory that is open and shown. A change of the index, or of a file above the session's folders, reaches no such watch.
- **Another machine.** `files.list` is offered as a session's call and `git.status` and `git.watch` under the checkout rule (`src/endpoint/offers.ts`); the window sends each with `pathTarget(machine, appSessionId)`.
- **Review and a path.** Review opened with `{ scope: 'uncommitted', path }` shows that file's section when the scope's list holds it, whatever folder of the repository it lies in; it draws its refusal only for an absolute path outside the repository (`outside`, `review/ReviewShell.tsx`).
- **Reading a daemon's answer.** In this build, in build M and in build F alike, a daemon's answer is read by `readCommandOutput`, the tolerant reader, at three places: main's supervisor of its own daemon (`src/shared/host/host-supervisor.ts`), a socket-linked machine (`src/main/machines/socket-link.ts`) and a machine over the link (`src/main/machines/remote/dispatch.ts`). The reader drops an object key the build does not know and logs it once per message and path, an array's index folded (`src/shared/ipc/tolerant.ts`, the same file in all three builds). The window's own read is strict (`validateCommandOutput`), and the window is always its main's build.

## Where the cut's section no longer matches the code

The cut was written against master `c6a22fe89`, before U6b-1 and U6b-2 were built. Its edge and its six decisions stand; these are the places, among those this landing builds, where the code now says more, or something else. U6b-3b's document has the rest (the tree column that is not always drawn, `git.lsFiles`' folders, the keyboard).

| the cut says | the code at the pin | what this document does |
|---|---|---|
| decision 2: `git.status { directory }` for the Changed group and the marks | `git.watch` answers the same status and keeps it current, through a store the window already has; a `git.status` asked once would go stale at the agent's next write | the git store (decision 1). `git.watch` and `git.changed` are offered to another machine as `git.status` is |
| decision 2: "a window of build F drops a key it does not know (`readTolerant`)" | it is main that drops it, at its read of the daemon's answer; the window reads strictly, and is its main's build | Interfaces §B states it per place and per build |
| decision 3: probe 8 against "the command's budget (`src/services/command-budgets.ts`)" | `files.list` is not in that table: its budget is the default, 10 s | the measurement is judged against a tenth of it, and the check has a bound of its own so that it can never spend the budget (decisions 12 and 13; "Probe 8"; R8, accepted) |
| decision 5: `panelHost.addTool('review', { params: { scope: 'uncommitted', path } })` | `addTool` takes the session with the params (`appSessionId`); Review's `path` is relative to the repository's root | the call as the code takes it (Interfaces §C) |
| "Stored and sent": one optional field on an answer | a changed submodule is a status entry the window cannot tell from a file: the parser drops the one field that says so | a second optional field in the same minor, `submodule` on a status entry (R2, accepted) |
| the size: about 1,500 changed lines over 22 files, one reviewer at the high rung | counted file by file from the code, the first writing came to about 3,100 over 44 | two landings (Decision Log 3): this one about 2,200 over 31, U6b-3b about 1,850 over 26 ("Size and review" in each) |

## How Claude Desktop does the same, and where MAWS differs

Read in `app-5.1231.2` (root law 1); the paths are under `web/app/v1/`. Its ⌘P and its filter are in U6b-3b's document.

- **The marks** (`:7076-7260`). M, A, U, R and `!` at the row's end in a fixed slot; modified in yellow, added, untracked and renamed in green, a conflict in red (`:7118-7124`); a folder that holds a change gets a dot in the colour of the weightiest change beneath it; a file under an untracked folder is marked untracked; a screen reader hears "Modified", "Contains changes". Old marks stay while a refresh runs, with no indicator.
- **Desktop has no Changed group in Files**: its changed files are a list of its Diff pane. The child's file puts the group in Files because the owner reviews what agents changed and opens Files to look at it (its "Why this, not that"). **Desktop does not ask git what is ignored**: it dims a fixed list of folder names (`c82492f2c-B1kvcJEb.js:2955-2972`) in its secondary text colour. The child's file asks git, so a project's own rules hold.
- **Another machine.** Desktop draws no marks for a cloud session. MAWS's three routes behave alike (root law 5).

## Decisions settled at authoring

Each is settled from the code, with what it beat. Where one changes what a person sees beyond the child's words it is also in "Reported to the architect, and ruled" or the card, and names its one place. Go to file's decisions are U6b-3b's.

### The Changed group and the marks

1. **What keeps them current: the git store.** While a session's tree is drawn, it holds `useGit.watch(machine, workingFolder.path, appSessionId)` and reads the entry's `status`. The daemon's watcher sends `git.changed` when the status moves, so the group and the marks follow the agent's writes with no act of the person's and no request of this landing's own. One cost comes with the store: while the status is dirty it also asks `git.diff` for the whole working tree, 250 ms after each change, for the summary card's line; Files adds that cost only in a window where no card, Review or Source control page already holds the same folder. *It beat* a `git.status` asked when Files opens and on every `files.changed`: Files watches only the folders that are open, so a change in a closed folder would never be heard; and a timer, which Desktop's marks use (a wait of one to five seconds after a folder's change) and MAWS does not need.
2. **Between a change on disk and the read a person sees the rows as they were.** The watcher gathers writes for 250 ms after the last one, at most 1 s, then reads the status once; on a root that fell back to polling the read comes every 5 s. Nothing is drawn while it runs: no spinner, no dimming of the group. A row whose file has gone meanwhile opens what the viewer says for a missing file. *It beat* an indicator: it would blink at every write of a working agent.
3. **No status, no group.** While the entry has no status (the watch has not answered, the folder is no repository, git refused, the daemon is away) there is no Changed group and no mark, and Files says nothing about it: the tree is whole without them. A status that was read stays drawn when a later read fails or the link to its machine drops (root UC-7: a side surface keeps its last content and draws no error for a read the link could not carry). *It beat* a line in Files for a git failure: the session's summary card and Review already word it, and "not a repository" is no failure.
4. **A row per path, a letter per row.** From a status entry, the first that applies: `!` when it is unmerged (Review's predicate, `unmerged`); `U` when untracked; `D` when the working tree has lost it (`worktree` is `D`, or `index` is `D` with the working tree unchanged); `R` when either character is `R`; `A` when `index` is `A` or `C`; else `M`. **On disk** is false for `D` and for a conflict both sides deleted (`DD`), true otherwise. When two entries name one path (a file deleted in the index and written again untracked), the one on disk stands. A **folder** row is an entry whose path ends in `/` (a wholly untracked folder) or that is a submodule (R2).
5. **The order:** conflicts first, then every row by its path. *It beat* git's own order (tracked, then untracked), which puts a new file far from its siblings.
6. **What a click does**, per kind:

   | the row | shows | a click | a double-click, ⌘-click |
   |---|---|---|---|
   | a file on disk: M, A, U, `!` | its name, then its folder in the muted colour, the letter at the row's end; the whole path as the title | opens it in the session's preview tab, as a tree row's click | keeps the tab; opens a main tab |
   | renamed, R | the new name and folder; the title "Renamed from" and the old path (Review's words) | opens the new path | as above |
   | not on disk: D, and `!` with both sides deleted | its name and folder, the letter | opens Review on Uncommitted at that file | the same: there is no file to keep or to move |
   | a folder: an untracked folder, a submodule | the folder's name with its `/`, the letter | opens that folder in the tree below (decision 7) | the same |
   | any entry outside the session's folders (a session started in a subfolder of its repository) | as its kind above; its title adds "Outside the folders this session works in" | opens Review on Uncommitted at that entry, as a deleted file's row does (R6, as ruled) | the same |

   *Outside the session's folders* means: under none of the roots the files service listed for the session (`expandTo` answers null). The row never opens the viewer onto a refusal. The Changed group is drawn once the roots' listing has answered, with the tree, so the question always has its answer when a row is clicked. *It beat*, for a folder: a row that does nothing (a dead row among live ones); listing the folder's files one by one (a change of `git.status` for every reader of it); opening the folder inside the group (a second tree).
7. **Opening a folder in the tree** (`reveal`): the folder and every folder above it are opened in the session's tree (the person's act, stored as a click on each would be), the folder becomes the selected row, and it is scrolled into view once, when its row is first in the list. The person's own scroll, or another selection, ends the wait (sequence S4).
8. **Paths.** A row shows the path relative to the repository's root, as Review does, and opens `repoRoot` joined with it.
9. **The marks in the tree.** A row whose path a Changed row names carries that row's letter. A row beneath an untracked folder carries `U`. A folder row (a root's included) with a Changed row beneath it and no letter of its own carries a dot. Paths are matched as `sameFile` matches them (the same string, the same but for case, or the `/private` spelling); a mark is drawn and grants nothing. The letter or the dot sits at the row's end in a fixed slot, so the name is cut before it; the letter is hidden from a screen reader, which hears the state after the name ("Modified", "Contains changes"). On the selected row the letter takes the row's own colour.
10. **The colours** (R1): `!` and `D` in `text-danger`, `M` in `text-warning`, `A`, `U` and `R` in `text-success`; the dot in the colour of the weightiest change beneath, in the order `!`, `M`, `D`, then the rest. Tokens only.
11. **Where the group is drawn:** wherever the tree is drawn, as the first rows of the tree's one virtual list, so a status of thousands of entries costs what the tree costs; a heading row "Changed" with the count, then the rows one level in. The heading is not a control (card 1). When the group gains or loses rows while a tree row is the first row in view, the list's offset moves by the same height, so the tree does not jump under the person's eyes as the agent writes (sequence S2).

### What git ignores

12. **The check** is one `git check-ignore -z --stdin`, in read mode, run in the listed directory itself, asked about the entries the answer will carry (after the sort and the cut at 5,000), each as `./<name>`; it runs after the entries' own reads and before the listing's last confirmation, so the listing is still private while it runs. An entry it names is answered with `ignored: true`; no entry ever carries `false`, so a listing with nothing ignored is byte for byte what it was. The roots' listing is never checked. Five facts of git it rests on, each seen on a scratch repository and pinned by M1's tests: the answer names a path as it was asked; a tracked file that matches a pattern is not named; an entry of an ignored folder, asked in that folder, is named; nothing ignored is exit code 1; outside a repository the call fails. *Why in the directory:* git then answers by the innermost repository that holds the directory, so a folder inside a submodule or a nested repository is judged by its own rules, and no path of the request can lie in a submodule (asked from above, one such path fails the whole call: the comment in `src/services/git/ignored.ts`). *Why `./`:* git reads these names as pathspecs, and the prefix keeps a name that begins with `:` or `-` a name. *It beat* the watcher's two whole-repository listings (`gitIgnored`): they answer folders only, and cost a walk of the repository per root.
13. **The check can only cost what it is allowed.** At most `IGNORED_CHECK_CONCURRENCY` (4) checks run at once in a daemon and the rest wait in order; a check answers within `IGNORED_CHECK_MS` (2,000) of being asked, its wait included, or it gives no answer. No answer for any reason (not a repository, another owner's repository, a timeout, git missing, an answer that cannot be read) is a listing with no entry marked, never a failed listing. So `files.list` can exceed what it costs today by 2 s at the very most, inside a budget of 10. *It beat* an unbounded check, which the first slow repository would turn into listings that time out; and a cache of answers per directory, which would have to follow every `.gitignore`.

    **The daemon's stop ends the checks** (the review's finding 1). The two-second bound is a bound on the answer, not on the process: a `GitRun` cannot be ended by its caller, and no part of the checkouts' stop ends one. So the check owns its runs. It is built over a runner of its own, made with the option the runner already has for its spawn function (`createGitRunner({ execFile })`), which it wraps to keep every child it starts until that child closes; the shared runner is not edited. Its `dispose`, a part of the checkouts' stop placed before the files service's, is synchronous: from then on every ask gets no answer, every ask that waits for a place gets no answer, and the process group of every run still alive is sent SIGKILL. **After a crash** (the daemon killed, or gone without its stop) nothing is disposed and the timer that bounds a run has gone with the daemon. A check alive then ends by itself: git reads its input to the end either way (the daemon wrote it and closed the pipe, or died and the pipe closed), answers into a pipe nobody reads, and exits. There are at most four per daemon that crashed; each holds no lock and writes no file; nothing bounds how long a git that is blocked in the filesystem takes to get there. *It beat* stating the limit and opening a ticket: this check is the one git read started for every folder a person opens, so it is the read most likely to be alive at a stop, and owning its runs costs about thirty lines and no interface of the runner's. The other callers of `createGitRunner` (status, diff, log, `ls-files`) still end no run at the stop; that is today's state, unchanged by this landing, and M3 writes its tracker row.
14. **How the dimming stays current** (the review's finding 2). It comes with each listing, and a directory is listed again as today: on a change in it, when it is opened again, on Refresh. Two rules are added in the window. **(a)** When a `files.changed` names an entry called `.gitignore`, every listing the session holds at or beneath that entry's directory is listed again. **(b)** When the status the git store holds for the working folder is replaced by one whose set of entries differs (a path appeared, went, or changed its letters; `statusSet`), every drawn listing of the session that lies in that repository is listed again. (b) follows the changes no directory watch hears: a file added to the index by force is ignored no longer, and its status entry appears; an ignore file above the session's folder changes which untracked files the status lists. A status that differs only in when it was read, or that came because a listed file was written again, lists nothing again, so an agent's repeated writes to the same files cost no listing. The first status a tree receives lists nothing again either. The lists go through the store's `list`, one flight and one waiting per directory, and the daemon admits four checks at once (decision 13); probe 8's `burst` measures this load.

    **What stays stale, how it shows, and the way out.** An entry keeps its muted or plain name after the rule that decides it has changed, when that change moves no status entry and is no `.gitignore` in a drawn directory. Those are two cases: a change of `.git/info/exclude` or of the person's global ignore file; and a further edit of an ignore file above the session's folder, when what it newly covers or uncovers lies inside a folder the status lists whole as untracked. The way out is the tree's Refresh, any change in that directory, or closing and opening it. And a listing asked again whose check gives no answer (decision 13) comes back with no entry marked, until its next listing. *It beat* listing every drawn directory on every `git.changed`: one git process per open folder for every write of the agent; and a watch on the index and on every ignore file above the folder, which is the daemon's watcher built a second time.
15. **Dimmed** is the muted text colour (`text-fg-muted`) on the entry's name, which is what a symbolic link's row already has; the selected row keeps its own colour. A screen reader hears "Ignored by git" after the name.

### Routes and repositories

16. **Another machine.** The status and the listings are read there, by `git.watch` and `files.list`, which every machine already offers; no offer and no capability is added. A dropped link keeps the Changed group and the tree as they were. A machine on an older build answers its listings without `ignored` and its status without `submodule`: nothing is dimmed there, a changed submodule's row is a file's row, and the rest works.
17. **A folder that is no repository, and a repository git refuses to read.** No Changed group, no marks, nothing dimmed, and no line of error in Files: the tree is whole without them, and the summary card and Review are where a git failure is worded. This silence covers these three and nothing else (the review's finding 6): what Go to file says in such a folder is U6b-3b's.
18. **A repository MAWS does not trust.** Trust gates what changes a repository (`scm.*`); every read of this landing runs in read mode, as Review's and the summary card's do today in the same folders, trusted or not. This landing adds one read, `check-ignore`, to a files service that ran no git; it executes nothing of the repository's (no hook, no filter, no fsmonitor, no external diff) and writes nothing. A repository another user owns is refused by git itself in read mode; that is decision 17's second case.
19. **What a caller on another machine learns.** `files.list` answers it one more bit for an entry it already lists. The check runs in the directory the boundary confirmed for that caller, under that caller's roots (a machine's home is never one), on names read from that directory. The rules git consults can lie above the session's root (a parent repository's `.gitignore`, the global file); none of their text is sent.

## Reported to the architect, and ruled

The first writing reported nine points, each with a default and one place. The rulings of 2026-11-17 (UTC) are in the fourth column and in Decision Log 4; R5, R7 and R9 are about Go to file and are in U6b-3b's document with theirs.

| # | The point | Evidence | The ruling | The one place |
|---|---|---|---|---|
| R1 | **The child's file asks for the marks "in the colours Review uses for added, changed and removed"; Review has two.** It draws added lines green and removed lines red, and a modified file's badge in the muted colour. | `FileSection.tsx` (`text-success`, `text-danger`, `Badge`); `tokens.css` has `--warning` | **Accepted:** Desktop's three tones (root law 1): modified in `text-warning`, added, untracked and renamed in `text-success`, deleted and a conflict in `text-danger`. The drawn example shows them to the owner | `LETTER_TONE` in `files/changed.ts` |
| R2 | **A second optional field in the same wire minor: `submodule` on a status entry.** A changed submodule is listed as an ordinary `M` entry whose path is a folder; opened as a file, its tab shows the files service's error for a folder ("not a regular file"). The parser drops the field that tells them apart. | `parseStatus` (`sub` is `parts[2]`, never read); `GitFileStatusSchema` | **Accepted:** the field, in the same minor, sent only when true; the row is a folder's row. With a daemon that does not send it the row is a file's | `GitFileStatusSchema` and `parseStatus` |
| R3 | **The size was past the cut's estimate, and past the mark for a single reviewer.** | "Size and review" | **Ruled per landing:** this landing takes the xhigh panel (the daemon's process handling and the wire); U6b-3b takes one reviewer at the high rung | Decision Log 1 of each document |
| R4 | **A click on an untracked folder's row.** The child's file says a click "opens the file as any tree row does"; a folder is no file. | `--untracked-files=normal` lists a new folder as one entry | **Accepted:** it opens that folder in the tree | the folder branch of `activateChanged` in `FilesTool.tsx` |
| R6 | **The Changed group lists the repository's entries, also those outside the session's folders** (a session started in a subfolder). | `git status` runs at the repository's root; Review lists the same | **Changed:** such a row opens Review at that entry, as a deleted file's row does; it never opens the viewer onto a refusal | the outside branch of `activateChanged` |
| R8 | **Probe 8's rule.** The child's file compares with "the command's budget"; `files.list` has only the default, 10 s. | `COMMAND_BUDGETS_MS` | **Accepted, corrected by the review's finding 1:** pass at a tenth of it on the build VM, the check bounded at 2 s in the product, a miss is a stop and the executor builds no fallback; the bound is on the answer, and the stop's disposal is what ends the process (decision 13) | "Probe 8" |

### The adversarial review's findings, and where each is fixed

Seven, all P2, each checked by the architect in the code at `5a73f8fa3`, all accepted.

| # | The finding | In this document |
|---|---|---|
| 1 | The check's process does not die with the daemon: a `GitRun` has no disposal, and the stop ends no git run | choice (a): the check owns and ends its runs at the daemon's stop; what holds after a crash is said; a test holds a process open (decision 13; S1; M1) |
| 2 | Dimming is not made current by an index-only change or by an ignore file above the session's folder | a status whose set of entries changed lists the drawn directories again; the two cases that stay stale are named with their effect and their way out (decision 14; S3; M1 and M2's tests; scene G2) |
| 3 to 6 | The filter's request generation; the keyboard in a file already in the main area; an open filter's frozen answer; a refused repository's failure line | U6b-3b's document. Of finding 6 this document holds the half that degrades in silence (decision 17; B5) |
| 7 | The cross-build scene could pass without the second field or the event path | a really dirty submodule, a second change after the watch, the witness of each in both directions, a same-build control, the serving daemon pinned (Interfaces §B and §F, scene G5; M3) |

## The card for the owner

One in this landing, accepted as written (Decision Log 4): the question as it can be put, the options with what each means in use, the recommended one first. It holds no milestone: the default named is built. Every name in the drawing is invented. The first writing's second card (⌘P while the tree is folded away) is U6b-3b's.

### The card · A long list of changed files

**The question.** "When an agent has changed many files, the Changed list above the file tree gets long and the tree starts far below it. Should the list fold?"

| option | in use |
|---|---|
| **A · It folds by its heading (recommended)** | a click on "Changed 48" folds the list to that one line and a second click opens it; it starts open in every session and is open again after a relaunch |
| B · Always whole | the list is always all its rows; the tree is reached by scrolling past it |
| C · The first ten, then "Show all 48" | short by default; one more line to read and one more thing to press |

    A, folded                 A and B, open              C
    ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
    │ ›  Changed 48        │  │ ⌄  Changed 48        │  │ Changed 48           │
    │ ⌄ harbor   directory │  │   cart.ts   src/   M │  │   cart.ts   src/   M │
    │   › docs             │  │   rates.ts  src/   M │  │   …eight more        │
    │   ⌄ src            • │  │   …46 more rows      │  │   tides.md  docs/  U │
    │       cart.ts      M │  │ ⌄ harbor   directory │  │   Show all 48        │
    └──────────────────────┘  └──────────────────────┘  │ ⌄ harbor   directory │
                                                        └──────────────────────┘

**Built until answered:** B, the child's words as they stand. **The one place:** the heading row (`ChangedHeading` in `FilesTool.tsx`) and one flag of the run in the session's tree state.

## The look

**The owner should see a drawn example before M2 starts**: the Changed group and the marks are new faces in a column that is 220 px wide by default and can be 160. What the drawing should show, at both widths and in both themes, with invented names: the tree with a Changed group of six rows, one of each letter in its tone (R1), a long path cut before its letter, a folder with a dot, a row under an untracked folder, two ignored entries, the selected row, and a row for an entry outside the session's folders. The architect draws it outside the repository from the measurements below, together with U6b-3b's field and list, which stand above the same tree.

    ┌────────────────────────────┐
    │ Changed 6                  │
    │   merge.ts   src/        ! │
    │   cart.ts    src/        M │
    │   rates.ts   src/        A │
    │   old.ts     src/        D │
    │   port.ts    src/lib/    R │
    │   notes/                 U │
    │ ⌄ harbor  directory      • │
    │   › docs                   │
    │   › node_modules   (muted) │
    │   › notes                U │
    │   ⌄ src                  • │
    │       cart.ts            M │
    │       rates.ts           A │
    │     debug.log      (muted) │
    └────────────────────────────┘

**The measurements.** Every row is the tree's row, 24 px (`FILES_ROW_HEIGHT`). The heading: "Changed" in `text-ui-sm text-fg-muted`, the count after it in `text-fg-faint`, at the tree's root indent. A Changed row: at one level's indent; the name in `text-fg`, then the folder in `text-ui-sm text-fg-faint`, which is what gives way first when the row is narrow; the name is cut next. The mark's slot: 16 px at the row's end, the letter in `text-ui-sm` and semibold, centred; the dot 6 px, round. Colours: decisions 10 and 15.

**The sentences a person reads** (exact strings are decisions; `FILES_COPY` in `src/renderer/src/tools/code/copy.ts`):

| where | text |
|---|---|
| the heading | `Changed`, then the count with the thousands separator |
| after a name, for a screen reader, and as the letter's title | `Modified`, `Added`, `Untracked`, `Deleted`, `Renamed`, `Conflict` (Review's words, `REVIEW_COPY.kinds`) |
| a folder with a dot | `Contains changes` |
| an ignored entry | `Ignored by git` |
| a Changed row's title | the path relative to the repository's root |
| a renamed row's title | `REVIEW_COPY.renamedFrom(old path)` |
| the title of a row for an entry outside the session's folders (R6) | the path, then ` · Outside the folders this session works in` |

## Routes (law 5)

| | a session MAWS runs | a terminal session | a session on another machine |
|---|---|---|---|
| the Changed group and the marks | `git.watch` of the working folder on this Mac's daemon | the same | `git.watch` on that machine, under its checkout rule; the last status stays while the link is down |
| ignored entries | `files.list`'s `ignored`, from this Mac's daemon | the same | from that machine's daemon; absent from an older build's answer, and then nothing is dimmed |
| the file a row opens | read by this Mac's files service | the same | read on that machine, as every file of such a session |
| a row that opens Review (deleted; outside the session's folders) | Review beside the chat | the same | the same; Review reads there |

The working folder is the selector's on every route (root UC-4). No act is added for another machine, so root UC-7 asks for no offer and no capability, and a read the link could not carry draws no error (decision 3).

## Acceptance

Behaviour a person can see, or a run can show. *Unit* is run by the milestone's executor on the build VM; *scene* is written in M3 and run on a Mac by the architect; the names of the scenes and what each waits on are Interfaces §F. Together B1 to B4 are the first sentence of the child's A3 on its three routes; its second sentence is U6b-3b's.

- **B1 · The Changed group** (A3; unit and scene). In a session whose working folder holds a modified file, a file added to the index, an untracked file, a deleted file, a renamed file, a conflict and an untracked folder, Files shows "Changed 7" above the tree and seven rows with `M`, `A`, `U`, `D`, `R`, `!` and `U`, the conflict first. A click on the modified row opens the file beside the chat in the preview tab; on the deleted row, Review on Uncommitted at that file; on the folder's row, that folder open and selected in the tree. In a session started in a subfolder of its repository, a changed file in another folder of the repository is listed, and a click on it opens Review at it and no file's tab. (This sentence is held by unit tests alone.) With a clean working folder there is no heading and no row.
- **B2 · The marks** (A3; unit and scene). The tree's rows for those files carry the same letters in their tones; each folder above one carries a dot; a file inside the untracked folder carries `U`. An ignored folder and an ignored file are drawn in the muted colour, and a tracked file whose name matches an ignore pattern is not.
- **B3 · They follow the disk** (A3; unit and scene). A file written in the working folder by another process appears in the Changed group with no act in the window; restored to its committed content, its row goes. A line added to `.gitignore` dims the entries it names in the open folders without Refresh. An ignored file added to the index by force loses its muted colour and gains `A` without Refresh, while another ignored entry beside it stays muted.
- **B4 · Another machine** (A3; unit and scene). For a session on another machine the Changed group lists that machine's changes, the tree carries their letters and that machine's ignored entries are muted. With the link down the group and the tree stay as they were and Files draws no error.
- **B5 · No repository, and a repository git refuses** (unit). In a folder that is no repository, and in a repository whose configuration git cannot read: no Changed group, no mark, nothing dimmed, no line of error in Files, and the tree lists as it does today. This is all B5 claims: what a search says there is U6b-3b's.
- **B6 · The two older builds** (unit and scene; Interfaces §B). This build's window on a daemon of build M or build F: the tree lists, nothing is dimmed, a dirty submodule is a file's row, and a second change reaches the Changed group. An app of build M or build F on this build's daemon, with an ignored entry and a dirty submodule in the folder: its tree lists every entry, its own surfaces follow a second change, and its log holds no refusal of an answer or of an event. Nothing is stored, so a run of an older build between two runs of this one leaves nothing behind and loses nothing.
- **B7 · Probe 8, the bound and the stop** (measured; unit). The probe's verdict is written in Surprises & Discoveries with the numbers, the machine and the versions. With a check that never answers, a listing answers all its entries, none marked, when the check's bound has passed on the test's own clock. With a real process held open by a check, the stop's disposal leaves no process of its group alive, and an ask after it gets no answer.
- **B8 · Tokens, and the guards** (unit). `test/support/tokens-guard.test.ts` passes over the new renderer source; the wire's manifest test passes at the new minor; `src/shared/machine` passes.

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push. No `pnpm install`, typecheck, eslint, vitest, build, engine or Electron there. Every check runs on the wave's build VM in a checkout of the pushed head, through `vmcheck.sh` (Concrete Steps). An executor starts no Electron e2e, runs no `scripts/ci-gate.sh` and opens no pull request. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.
2. **The design is the child's and the cut's, in the half this landing builds.** What is drawn where, the commands asked and the field on `files.list` are theirs; nothing of Go to file is built here, and nothing here moves the keyboard; "Decisions settled at authoring" fills what they left. An executor who finds that one of them cannot hold stops and reports; a gap is resolved in the spirit of the nearest decision and recorded.
3. **What is stored and sent** (root UC-14). Nothing is stored: no layout key, no field of `files.tree`, no settings key. What is sent is Interfaces §B, against build M and build F. The wire's minor moves once, in a commit of its own, to a stand-in number that the chain's merge takes again.
4. **Authorisation is checked where the act runs, on the value it uses.** The ignore check runs in the directory the files boundary confirmed for the caller, on the names read from it, and adds nothing a refused listing would answer. No new command reaches a session's folders; `git.watch` keeps its own rules, unedited.
5. **Read mode, and nothing else.** Every git call of this landing goes through `createGitRunner` with its default mode. No call writes, and none is added to the `scm` service. `src/services/git/runner.ts` is not edited: the check's hold on its processes is made with the runner's existing `execFile` option.
6. **Files other children own** (root UC-8). Interfaces §E lists every insertion with its owner. An executor who must edit another file of another child's stops and reports.
7. **Three routes** (law 5): "Routes" above.
8. **The repository is public** (root UC-11), and a person's content is never read. Tests, fixtures and scenes build their own repositories under a temporary folder (`test/support/git-fixture.ts`, with an empty home so that no global git configuration of a machine is read) with invented names. No fault is reproduced by reading the content of a session, a file, a settings file or a folder of a person's: structure and counts only, and none of it enters the repository. Nothing about any person's machines or installed software enters a document, a test or a commit.
9. **Guards that read source text.** In renderer source and its tests a ticket or item number is written in words ("ticket 672"); the tokens guard reads `#` and three to eight hex digits as a colour. Run that guard with M2. Components use tokens only.
10. **The level of proof.** A test that asserts an absence over input it builds by hand (no entry marked, no group, no listing asked again, no process alive) carries a control in the same test that shows the reader takes that input's form: the same listing with one entry that is marked, the same status with one more entry that makes a group, the same store with a status whose set did change and does list again, a process that is alive before the disposal. An asynchronous rule is asserted by a test that holds the awaited thing open and acts in between ("The sequences that must hold"). A scene says, in its description, what it waits on before it reads a position or a count. A rule about two builds is asserted in the cross-build scene, and a skipped scene is not evidence.
11. **No wall time is asserted.** Probe 8's numbers are measured, labelled and judged by hand against its table. The tests of the check's bound run on a clock the test moves; the test of the stop's disposal waits on the child's own `close`, not on a time.
12. **The base.** The branch takes master by merge, never by rebase or force-push.
13. **Disk.** If any command fails with "No space left on device": stop, report, delete nothing.

## The sequences that must hold

Each is an act that waits on something. For each: what happens when the person acts in between, and when the awaited thing fails or never comes; and the test that holds it open.

**S1 · A listing and its ignore check** (daemon). Order inside `list`: the open and its confirmation; the names; each entry's own read; the sort and the cut; **the check**; the last confirmation; the answer. *The check fails, is refused by git, or does not answer within its bound:* the listing answers every entry, none marked. *The directory is swapped for a link while the check runs:* the last confirmation refuses the listing, as it does today for a swap after the names were read. *More than four checks are asked at once:* the fifth waits; its bound runs from when it was asked, so a check that waited its whole bound never starts and gives no answer. *The daemon stops in order while checks run or wait:* the disposal answers each of them with no answer and kills each live run's process group in the same call, so the listings that asked answer unmarked or are cut off by the stop, and no git of a check is left; an ask that arrives after it gets no answer and starts nothing. *The daemon is killed:* decision 13's last paragraph; nothing here is promised beyond it. Tests (M1): a `run` that never settles, the listing answered on the test's clock at the bound; a swap at a new boundary point `before-ignored`; ten checks asked of a `run` that counts how many are live at once; **a real process held open** (a spawn function that starts a shell which starts a sleeping child and waits, in a group of its own, exactly as `execGit` starts git): the process and its child are alive before the disposal (the control), the disposal's promise settles, and then neither answers a signal 0; a check asked after the disposal starts no process.

**S2 · The Changed group across a read** (window). The rows are those of the status the store holds. *A `git.changed` lands:* the rows are replaced in one render; the tree's selected row and the scroll offset do not move by it (the list's height changes above them: the offset is corrected by the height the group gained or lost when the first visible row was a tree row). *The watch fails, the folder is no repository, or git refuses it:* no group. *The link drops:* the store keeps its status and the group stays. *A row is clicked whose file went since:* the viewer's own answer for a missing file. *A row is clicked before the roots' listing has answered:* it cannot be: the group is drawn with the tree (decision 6). Tests (M2): a status replaced while the list is scrolled into the tree, the first visible tree row the same before and after; a store entry with an error and no status; an entry whose status stays after a failed refresh.

**S3 · A status that changes what is ignored** (window; decision 14). The tree remembers the set of the last status it drew from. *A status with another set lands:* every drawn listing of the session under that repository's root is asked again, through the store's `list`. *A second such status lands while those are in flight:* each directory has one flight and at most one more waiting, so the second asks each once more and no third is queued. *A listing asked again fails:* the store shows what it shows today for a failed listing of that directory. *Its check gives no answer:* the entries come back unmarked (decision 14's last sentence). *The person collapses a folder meanwhile:* its listing is no longer drawn and its late answer lands nowhere (the store's existing rule for a released directory). Tests (M2): a status with a new entry asks `files.list` once for each drawn directory under the root and not for a drawn directory of another root (the control for the next); a status that differs only in its time asks nothing; the first status asks nothing; two set changes in a row with the first flight held: two asks per directory, never three.

**S4 · A folder opened in the tree** (window). `reveal` opens the folder and those above it, selects it, and notes the path. The list scrolls the row into view in the first render in which the row exists, and forgets the note. *The person scrolls (wheel, pointer or key in the list) or selects another row first:* the note is dropped. *A listing above it fails:* its notice row is drawn where the folder would be; the note stays until one of those acts. Tests (M2): the row arriving two listings later; a wheel between.

**S5 · The working folder moves** (window; U8c-2). The watch is keyed on the folder: the hold on the old one is released and one is taken on the new; the Changed group is the new folder's, and has no rows until its status comes; the set S3 remembers is forgotten, so the new folder's first status lists nothing again. Test (M2): a record whose `agentFolder` changes under a mounted tree.

## Probe 8 · the ignore check at size

The child's probe 8, designed here so that M1's executor only runs it. It is a measurement: its numbers are read by a person against the table below, and no test asserts them.

**The question.** Does a `files.list` of a directory of 5,000 entries, with the ignore check, stay inside the command's budget, with room to spare for a slower machine?

**The budget.** `files.list` has no entry in `COMMAND_BUDGETS_MS`, so its caller waits `REQUEST_TIMEOUT_MS`, 10,000 ms, and then reads `timeout`. The measurement is judged against a tenth of it, 1,000 ms: the build VM is a Linux machine with a fast disk and no other session's work in its checkout, and the listing must also hold on a loaded Mac and behind a link to another machine. The product does not depend on the verdict for safety: decision 13 bounds the check's answer at 2,000 ms whatever a repository does, and ends its process at the daemon's stop.

**What is built.** `src/services/files/ignored.measure.test.ts`, run only when asked, as `named.measure.test.ts` beside it is: `MAWS_IGNORED_MEASURE=1 pnpm exec vitest run src/services/files/ignored.measure.test.ts --testTimeout 600000`. It makes its fixtures with invented names under a temporary folder (`GitFixture`, an empty home), runs a real files service (`createFilesService`) in the test's process with the real check (`createIgnoreCheck({ env })`'s `names`) and once without the option, disposes of the check at its end, prints one line per label, and removes the fixtures. Its only assertions are counts: how many entries came back marked.

| fixture | what it is | what is run |
|---|---|---|
| `mixed` | a repository of 200 folders, each of 100 tracked files and five files a rule names (20,000 tracked files: the size of the index, which the check reads), a root `.gitignore` of 60 patterns, and one more folder of 5,000 entries with a `.gitignore` of its own of 20 patterns: 2,000 tracked files, 2,000 untracked files no rule names, 1,000 that a rule names (700 by an extension, 300 by name) | three listings of the folder to warm up, then 20 one after another, each timed; with the check and without |
| `all-ignored` | a folder of 5,000 entries inside a folder a rule ignores (what an installed dependency tree is) | the same |
| `no-repository` | a folder of 5,000 entries outside any repository | the same |
| `burst` | in the `mixed` repository, its 200 folders (105 entries each, five of them ignored) listed at once, which is what a tree restored after a relaunch can ask, and what decision 14's rule (b) asks when the status's set changes under a tree with many open folders | the whole burst timed, three times: with the check, with the check and no limit on how many run at once, and without it; each with the most git processes alive at once |

**What is printed**, one line each: `probe8.<fixture>.<with|without>.median_ms`, `.max_ms`, `probe8.<fixture>.marked` (the count of entries answered `ignored`, per listing), for `burst` also `probe8.burst.<with|unbounded|without>.total_ms`, `probe8.burst.<with|unbounded>.listings_marked` (how many of the 200 listings carried their marks) and `.live_max` (the most checks alive at once); and once `probe8.machine`: the processor count, the memory, the kernel, `git --version` and Node's version, as the run reads them.

**The verdict**, applied by the executor to the printed numbers:

| holds when | a miss means |
|---|---|
| `mixed`, `all-ignored` and `no-repository`: `with.max_ms` ≤ 1,000 | the check makes a large folder slow to open: **stop** |
| `mixed.marked` is 1,000 and `all-ignored.marked` is 5,000 in every timed listing | the check did not finish inside its own bound at this size, so large folders would stay undimmed: **stop** |
| `burst.with.total_ms` ≤ 5,000 and `burst.with.listings_marked` is 200 | the queue of four starves a restored tree, and a status change would strip the marks from the folders it lists again: **stop** |
| (recorded, not judged) `burst.unbounded` beside `burst.with` | the limit of four is a cause read from the code; these two lines are its measurement. If the unbounded burst is no slower and no heavier, the architect may rule the limit away: one constant |

On a pass the numbers, the machine line and the commit go into Surprises & Discoveries as a measured bound ("measured on the wave's build VM, <the machine line>; a miss would have meant …"), and M2 starts on the architect's word. On a miss the executor writes the same and stops; it does not tune the constants and builds no fallback.

**The fallback's shape, if the architect rules it** (the child's "the check runs only for the entries on screen"). `files.list` stops carrying `ignored`. A new read of the daemon's, `files.ignored { appSessionId, path, names }` answering `{ ignored: string[] }`, runs the same check for at most 200 names of one directory under the same boundary as a listing of it; the window asks it for the rows its virtual list draws, after the listing has come, and keeps the answer with the listing. A daemon of an older build answers `unknown_command` and nothing is dimmed. It changes Interfaces §A and §B, M1's schema commit and decision 14, and nothing of U6b-3b. It is a larger landing (a command, its offer to another machine, a store of answers per directory) and is not built from this document as it stands.

## Plan of Work

Three milestones, in order: M2 draws from what M1 answers, and M3 writes scenes against M2's markers. M1 ends with a stop for probe 8's verdict. The constraints above bind each; a milestone restates nothing of the design and points at it.

### M1 — The daemon: the ignore check, probe 8, a submodule's mark, the wire's minor

**What exists at its end.** A `files.list` of a directory answers `ignored: true` on the entries git ignores there, and is what it was in every other respect; a status entry that is a submodule carries `submodule: true`; the wire stands at its stand-in minor with its manifest; probe 8's numbers and verdict are written down. Nothing in the window reads either field yet.

**What it touches.** `src/services/files/ignored.ts` (new) and its test; `src/services/files/service.ts` (`list`, `FilesServiceOptions`, `BoundaryPoint`) and `service.test.ts`; `src/services/files/register.ts` (one option passed through); `src/services/checkouts-root.ts` (the option given, and one part of the stop); `src/services/files/ignored.measure.test.ts` (new); `src/shared/ipc/schema/files.ts` and `schema/git.ts` (one key each); `src/services/git/porcelain.ts` and its test; `src/shared/ipc/wire.ts`, `wire-manifest.json` and `wire-fingerprint.json`; `test/cross-build/files-schema.test.ts` and a new `test/cross-build/git-status-schema.test.ts`.

**Interfaces.** Exposes §A and §B. Consumes `createGitRunner` with its `execFile` option, `execGit`, `ExecFileFn` and `GitRun` (`src/services/git/runner.ts`), unedited.

**Decisions of this milestone alone.**

1. *The order.* The tests first, failing where they assert the new keys; then the modules; then the wire's minor as one commit of its own (Concrete Steps 4); then the measurement on the head that holds all of it.
2. *The check is handed to the service, not imported by it.* `createFilesService` takes `ignored?: (dir, names) => Promise<ReadonlySet<string> | null>` and `checkouts-root.ts` gives it the `names` of the one `createIgnoreCheck()` it makes. The service stays a module that starts no process of its own, and its tests give it a function. Without the option nothing is asked and nothing is marked, which is what every existing test of the service runs.
3. *Inside `list`* the sort and the cut move before the check (they need nothing the last confirmation gives), a new boundary point `before-ignored` stands between the entries' reads and the check for the tests' swap, and the last confirmation follows the check. The answer marks only names that were asked: a name the check's answer holds and the listing does not is dropped.
4. *The bound* is one deadline per check, taken when it is asked: the wait for one of the four places and the run share it. The check answers at the deadline whether or not git has ended (it does not wait for the runner's kill), and frees its place when the run really ends, so no more than four git processes of the check are alive.
5. *The check owns its runs* (decision 13; the review's finding 1). `createIgnoreCheck` makes its runner with a spawn function that calls the one it was given (`execGit` in the product) and keeps the child it returns in a set until the child's `close`. `dispose` sets a flag every `names` reads first, empties the queue with no answer for each, and sends SIGKILL to minus the pid of each kept child, a missing process being no error. It is one synchronous call, because `stopParts` awaits nothing; the promise it returns, settled when the kept set is empty, is for the tests. The runner's own timers for those runs are cleared by the runner when each child closes. In `checkouts-root.ts` the part stands before the files service's, so that no listing asks a check that is being ended.
6. *The `./` prefix is shown to matter, or said not to.* The real-repository test first asks the bare names and records what git answers for a name that begins with `:` and one that begins with `-`; the finding goes into Surprises & Discoveries. The prefix stays either way: it costs nothing and makes the answer independent of how a git build reads such a name.
7. *The log.* A check with no answer writes no path. Not a repository is silent. Any other reason writes one line to the daemon's log the first time that reason occurs in the daemon's run, naming the reason and no folder.
8. *A submodule* is a porcelain v2 record of type `1`, `2` or `u` whose third field begins with `S`; `parseStatus` adds `submodule: true` to it and to no other. The worktree service's own status read (`worktrees.ts`) goes through the same parser, and an added key changes nothing it reads.
9. *The older builds, at the schema.* `test/cross-build/files-schema.test.ts` already holds both builds' `schema/files.ts` as committed snapshots; it gains: this build's `files.list` answer with marked entries, read with the tolerant reader by each peer's schema, is the answer less exactly those keys; each peer's answer parses under this build's schema. The status entry has the same five fields in both builds (`git show <build>:src/shared/ipc/schema/git.ts`), so `git-status-schema.test.ts` holds that one schema copied literally and asserts the same two things for `git.status`'s answer and for `git.changed`.
10. *What else compiles these files.* The desk's web app compiles `src/shared/ipc/schema/files.ts`, `schema.ts` and `wire.ts` transitively (U6b-2's Decision Log 22) and reads `tools/code/review/review-model.ts`, which takes its types from `schema/git.ts`: this milestone's proof adds that package's typecheck, build and test project.

**What it does not touch.** The window. `src/services/git/runner.ts` and every other caller of it. What `git.watch` watches or when it emits. The endpoint and its offers. `COMMAND_BUDGETS_MS`: `files.list` keeps the default.

**What it proves.** B6's unit half, B7, B8's wire half, S1, and decision 14's two cases at the check itself. Behaviours its tests pin, each with its control where it asserts an absence:

- over a real repository: a file a pattern names, a folder a rule names, and an entry of an ignored folder asked in that folder are answered; a tracked file that matches a pattern is not, beside its untracked twin that is; a name that begins with `:` and one that begins with `-` are answered when a pattern names them; a folder of a nested repository is judged by that repository's rules, not the outer one's; nothing ignored is an empty set and not "no answer"; outside a repository there is no answer, and in a repository whose configuration git cannot read there is none either, beside a good repository that answers; an ignored file is named, then added to the index by force and named no longer, while its untracked twin still is; asked in a subfolder, a file that a rule of the ignore file above names is named, and is not once that rule is removed, while a file another rule names still is;
- the bound: a run that never settles gives no answer when the test's clock reaches the bound, and the listing that asked answers all its entries; ten checks asked at once never have more than four runs alive; a check that waited its whole bound never starts its run; S1's held process, with its control;
- the listing: `ignored: true` on exactly the names the function answered and on no other entry, and no entry carries the key when it answers nothing, when it is absent, and for the roots; the function is called with the directory's confirmed real path and the names the answer carries, at most 5,000; a directory swapped at `before-ignored` is refused; a listing with nothing ignored deep-equals what the service answered before;
- the parser: `submodule: true` on a submodule's record of each of the three types, and no key on an ordinary record in the same output;
- the wire: the manifest at the new minor holds both keys, and the two cross-build suites pass.

### M2 — The window: the Changed group, the marks, the dimmed entries

**What exists at its end.** With changes in a session's working folder, the tree column shows the Changed group above the tree, each row opens what decision 6 says, the tree's rows carry letters and dots, and ignored entries are muted; all of it follows the disk with no act. Acceptance B1 to B5 hold in unit tests.

**What it touches.** `src/renderer/src/tools/code/files/changed.ts` (new) and its test; `files/FilesTool.tsx`; `files/tree.ts` (two row kinds); `files/tree-state.ts` (the note of a folder to show) and its test; `files/store.ts` (decision 14's rule (a)) and its tests in `files.test.tsx`; `src/renderer/src/tools/code/copy.ts`.

**Interfaces.** Exposes §C. Consumes §A's two keys; `useGit` (`stores/git.ts`), `checkoutKey` and `machineFor` (`ipc/machine.ts`); `useWorkingFolder`; `openFile`; `panelHost.addTool`; from Review, by import and with no edit, `unmerged` (`review/review-model.ts`) and `REVIEW_COPY.kinds` and `.renamedFrom`.

**Decisions of this milestone alone.**

1. *The hold on the git store* is the drawn tree's (`SessionTree`): taken with the session's machine, the working folder's path and the session, released on unmount or when any of the three changes. A tab whose tree is folded away holds none.
2. *The rows.* The list's rows are the Changed section's followed by the tree's; `rowsOf` is not edited. The section's keys are distinct from every tree row's key for the same path. The heading is a `treeitem` of level 1 and its rows of level 2, so the list stays one tree for a screen reader.
3. *A mark is looked up, not stored on a row:* `marksOf(rows)` answers a letter for a path and a dot for a folder from maps keyed on a path's normal form (lower case, the `/private` spelling folded), built once per status.
4. *The scroll offset under a changing group* (S2): the adjustment is made in the layout effect that follows the change of the section's row count, and only when the first row in view was a tree row. The jump is a cause read from the code, and a test can run it: its case is written first and shown failing (the first row in view moves when the group grows) before the adjustment is built.
5. *Decision 14's two rules.* (a) is read from the event's path in the store's `applyChanged`. (b) is the drawn tree's: an effect on the store entry's status compares `statusSet` with the one it last saw for the same machine, folder and session, and on a difference calls the store's `list` for each drawn directory whose path lies under the status's `repoRoot` (matched as marks are). It keeps nothing when it has seen none. Both go through `list`, which already keeps one flight per directory.
6. *Outside the session's folders* (decision 6, R6) is `expandTo(the listed roots' paths, row.path) === null`, asked at the click; the row carries the answer as a marker and in its title. The Changed section's rows are made only once the roots' listing is `ok`.
7. *The muted name* is one class on the name's element and leaves the row's hover and selection as they are.
8. *`copy.ts` is compiled by the desk's web app* (it reads `REVIEW_COPY`): the proof adds that package's typecheck, build and test project, although the edit only adds keys to `FILES_COPY`.

**What it does not touch.** Anything of Go to file: no field, no list of results, no action, no menu row, no move of the keyboard, no change to `treePlace` (U6b-3b). `stores/git.ts`, Review's files, the summary card. The services. What a tab stores.

**What it proves.** B1, B2, B3's and B4's unit halves, B5, B8's tokens half, S2 to S5. Behaviours its tests pin: the letter and "on disk" for every XY pair of decision 4, two entries on one path, the order; a click of each kind of row (the file opened in the preview tab, Review added with the session, the scope and the relative path, the folder opened and selected); a file and a folder outside every listed root each add Review at their entry and open no file's tab, while the same test's file inside a root opens its tab; no Changed row before the roots' listing has answered, and the rows once it has; the letters on tree rows matched across the `/private` spelling and across case; `U` beneath an untracked folder; the dot's colour by the order of decision 10; no group and no mark for an entry with no status, beside the same tree with a status that makes one; the status kept after a failed refresh; the tree's first visible row unmoved by a group that grows; a `.gitignore` event listing again the listings beneath it and no other; S3's four cases; `ignored` muting a name, and an answer without the key muting none in the same listing; the tokens guard.

### M3 — The scenes, the cross-build row, the record, and the acceptance run

**What exists at its end.** The scenes of B1 to B4 and B6 are written and typechecked, the cross-build coverage table has this landing's row, the tracker and the register say what landed and what is left, and the whole unit suite has run once on the final head.

**What it touches.** `e2e/code-tools.spec.ts`, `e2e/remote.spec.ts`, `e2e/cross-build.spec.ts` (Interfaces §F names each scene and what it waits on); `docs/tech-debt-tracker.md`; this document's Progress and record. The register's row of l5-code-09 is closed by U6b-3b, which completes the item.

**Interfaces.** Consumes §C's markers. Exposes nothing.

**Decisions of this milestone alone.**

1. *A scene waits on what it then reads.* Each scene's description in §F says what it waits on: a row's presence by its marker, a tab's marker for the file, a row's attribute. No scene reads a count or a position after an act it did not wait for, and none sleeps.
2. *No scene asserts a time.* B3's "with no act" is a wait on the row, under the scene's ordinary timeout.
3. *The cross-build scene* (the review's finding 7) is §F's G4, with its same-build control. It runs both halves against every peer the gate uses: build F, build M, master at `b89d6d1d7` and the master this landing merges into. All four lack both keys and all four are builds whose app this build's daemon admits (each lists `machine.connectors`), so no half has a reason not to run: where the existing scenes annotate a half as not run for an app from before O4 (`appObeysConnectors`), this scene asserts that the peer is none and fails otherwise.
4. *The tracker* gains rows for what this landing leaves: the git reads other than the check that the daemon's stop does not end (decision 13); the two cases of decision 14 that stay stale until Refresh; and whatever the reviews defer.
5. *The acceptance run* is Concrete Steps 8.

**What it does not touch.** Product code. A scene that fails to typecheck against M2's markers is fixed in the scene; a product fault a scene's writing exposes goes back to its milestone's executor through the controller.

**What it proves.** That the scenes compile and the gate's own script tests pass over them; B8 whole; and the last unit run. The scenes themselves prove B1 to B4 and B6 when the architect runs them.

## Concrete Steps

Working directory for every command: the branch's worktree (the controller's brief names it). The VM sees only what is pushed. `vmcheck.sh` prints `vmcheck: ux-wave/U6b-3 at <short sha>`, then the command's own output, and exits with the command's status; do not pipe it into `tail` or `head` without `set -o pipefail`. Below, `vmcheck` stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b-3 --`. Its first call for the branch installs dependencies and can take twenty minutes. The remote command runs under `set -euo pipefail`: begin it with `set +e;` when every part's result is wanted. The VM is shared: a check that is slow is read against its load first. Every command there runs under `timeout <seconds>`.

**The order, with its stop.** M1; **stop** (step 5): probe 8's numbers and verdict go to the architect, and M2 starts on the architect's word, which also carries the owner's look at the drawn example. Then M2, M3, and the stop of step 9.

1. **Before each milestone:**

       git fetch origin master && git merge origin/master
       git push origin ux-wave/U6b-3

   A merge, never a rebase or a force-push. After a merge that brought changes, run the previous milestone's proof again (the same set, not the whole suite), and read "Statements to check again" against what arrived.

2. **The tests before the modules** (M1 and M2). Commit the cases of the milestone's "What it proves" with the new exports naming nothing; push; run them; the cases that assert the new behaviour fail and those that assert what stays pass. Then build.

3. **While building**, after each push:

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 pnpm exec eslint <the paths changed>'
       vmcheck 'timeout 900 pnpm exec vitest run <the test files touched>'

   The node project for M1; the web project for M2 and for M1's edits of `src/shared/`. A filter given to vitest is a substring of file paths: give paths, never a bare word.

4. **The wire's minor, one commit** (M1). With the schema's commit pushed and `N` the tree's number plus one (55 at the pin), the number is applied on the VM's checkout alone, the files are generated there, their diff is brought back and the VM's checkout restored:

       vmcheck 'sed -i "s/WIRE_MINOR: number = [0-9]*;/WIRE_MINOR: number = N;/" src/shared/ipc/wire.ts; pnpm wire:manifest >/dev/null || true; git diff -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json; git checkout -q -- src/shared/ipc/wire.ts src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json' | sed 1d > "$TMPDIR/u6b3-wire.patch"
       git apply "$TMPDIR/u6b3-wire.patch"

   Read the patch before applying it: it holds `ignored` under `files.list`'s entries, `submodule` wherever a status is answered or sent (`git.status`, `git.watch`, `git.changed`, and the `scm` answers that carry a status), the number, and nothing else. If it holds anything else, stop and report: this landing changes the wire by these two optional keys alone. The fingerprint covers the engine host's commands alone and is expected unchanged; if the patch changes it, stop and report. Then, in the worktree, the number and its note ("the UX wave's U6b-3: files.list's entries' ignored, a status entry's submodule") are written into `src/shared/ipc/wire.ts`, and the number and the manifest are committed once, with nothing else, and pushed; `vmcheck 'timeout 600 pnpm exec vitest run src/shared/ipc/wire.test.ts src/shared/ipc/wire-fingerprint.test.ts'` then passes. **The number is a stand-in:** the chain's minors are taken in landing order, and the chain's merge takes this one again by the same step.

5. **Probe 8, and the stop** (M1's last step), on the head that holds the check and the wire's commit:

       vmcheck 'timeout 1500 env MAWS_IGNORED_MEASURE=1 pnpm exec vitest run src/services/files/ignored.measure.test.ts --testTimeout 600000'

   Expected: the `probe8.*` lines of "Probe 8", and the file passing (its assertions are the counts). Apply the verdict's table. Write the lines, the verdict and the commit into Surprises & Discoveries, push, and **stop**: the controller gives the architect the numbers. A miss is a stop for a ruling, not a thing to build around.

6. **Each milestone's proof** is the typecheck of the projects it changed, eslint on its changed files, and vitest over the folders it touched and those that import what it changed:

   - M1: `src/services/files src/services/git src/services/scm src/shared/ipc src/shared/machine src/main/lane-b test/cross-build test/endpoint/checkout-rows.test.ts test/lane-b/offer-coverage.test.ts`, and every test file under `src/services` and `src/mawsd` that names `checkouts-root` (`grep -rl checkouts-root src test --include='*.test.ts'`)
   - M2: `src/renderer/src/tools/code src/renderer/src/tools/scm src/renderer/src/stores src/renderer/src/panel test/support/tokens-guard.test.ts test/one-working-folder.test.ts`

   as `vmcheck 'timeout 1800 pnpm exec vitest run <the list>'`. Expected: every file passes but those the build brief lists as failing on master on the VM too (`src/shared/machine/git-reads.test.ts` among M1's). In every milestone, list the importers outside the project changed (`grep -rlE "src/(renderer|shared|services|artifacts)/" apps/*/src | xargs grep -lE "<the file's path without extension>"`, followed through the files it names until no new one appears). Known at authoring: the desk's web app reads `tools/code/copy.ts` and `tools/code/review/review-model.ts` directly, and compiles `src/shared/ipc/schema/files.ts`, `schema/git.ts`, `schema.ts` and `wire.ts` through them. So M1 and M2 each add

       vmcheck 'timeout 900 pnpm --filter desk-web typecheck'
       vmcheck 'timeout 900 pnpm --filter desk-web build'
       vmcheck 'timeout 900 pnpm exec vitest run --project desk-web'

   to their proof. M1 also runs `vmcheck 'timeout 600 node --test .github/scripts/maws-app-scan.test.mjs'` if it adds any recorded file (the two cross-build suites add none: their peers' snapshots are already committed).

7. **A scene is typechecked, not run** (M3):

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 pnpm exec eslint e2e/code-tools.spec.ts e2e/remote.spec.ts e2e/cross-build.spec.ts'
       vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

   The third is the gate's own script tests, text guards over the scene files and the group lists: they read an `expect(<a time>).toBeLessThan(<a number>)` as a raw time bound, and a name that ends in `At` or `Ms` counts as a time. No scene of this landing has such a line.

8. **The acceptance run** (M3's last step), on the pushed head, after a last merge of master:

       vmcheck 'timeout 2400 pnpm typecheck'
       vmcheck 'timeout 1800 pnpm lint'
       vmcheck 'timeout 3600 pnpm test'
       vmcheck 'timeout 600 pnpm exec vitest run src/shared/machine'

   Expected: each exits 0, apart from the files the build brief lists as failing or timing out on the VM, each of which is shown to pass alone (`pnpm exec vitest run <file> --testTimeout 60000`) or to fail on master there; vitest's summary names no other failed file. The whole unit suite runs this once, by M3's executor, and by no earlier milestone. Against these runs: B5, B7's unit half and B8 are the suites as each milestone's "What it proves" names them; B1 to B4 and B6 have a unit half there and a scene that is the architect's.

9. **Stop and hand back.** M3's executor writes into Progress what ran and what is left, pushes, and stops. Class 1a (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b-3`), the Mac lane's unit cases, the branch review, the e2e runs and the pull request are the architect's.

## Interfaces and Dependencies

### §A. The ignore check and the two keys (M1)

    // src/shared/ipc/schema/files.ts
    FilesEntrySchema    += ignored: z.literal(true).optional()     // git ignores the entry; sent only when true; never on a root

    // src/shared/ipc/schema/git.ts
    GitFileStatusSchema += submodule: z.literal(true).optional()   // the entry is a submodule (porcelain v2's `sub` begins with S); sent only when true

    // src/services/files/ignored.ts (new)
    export const IGNORED_CHECK_MS = 2_000;          // one check's whole allowance, its wait for a place included
    export const IGNORED_CHECK_CONCURRENCY = 4;     // checks running at once in one daemon
    export interface IgnoreCheck {
      // The names among `names` that git ignores in `dir`; null when git gives no answer within the allowance, and after `dispose`.
      // One `git check-ignore -z --stdin` in `dir`, read mode, each name sent as `./<name>`, exit code 1 an empty set.
      names(dir: string, names: readonly string[]): Promise<ReadonlySet<string> | null>;
      // One synchronous call: later asks and waiting asks get null, and the process group of every live run gets SIGKILL.
      // The promise settles when every child the check started has closed (the tests wait on it; the stop does not).
      dispose(): Promise<void>;
    }
    // `execFile`: the spawn function the check's own runner is made with (`createGitRunner({ env, execFile })`), `execGit` when absent;
    // the check wraps it to keep each child until its `close`. `concurrency`, `allowanceMs`: the tests' and the measurement's.
    export function createIgnoreCheck(options?: { env?: NodeJS.ProcessEnv; execFile?: ExecFileFn; concurrency?: number; allowanceMs?: number }): IgnoreCheck;

    // src/services/files/service.ts
    FilesServiceOptions += ignored?: (dir: string, names: readonly string[]) => Promise<ReadonlySet<string> | null>;
    BoundaryPoint       += 'before-ignored'         // tests: between the entries' reads and the check

    // src/services/files/register.ts: FilesHandlerDeps += ignored?: FilesServiceOptions['ignored']
    // src/services/checkouts-root.ts
    const ignore = createIgnoreCheck();
    registerFilesHandlers(..., { ..., ignored: ignore.names });
    // and in `stop`'s parts, before ['files', …]:  ['ignore check', () => void ignore.dispose()]

No interface of `src/services/git/runner.ts` changes: `createGitRunner`'s `execFile` option, `execGit` and `ExecFileFn` are exported today.

### §B. What is stored and sent, and what each older build does with it

**Stored:** nothing. No layout key is added and `files.tree` keeps its shape and version; the note of a folder to show lasts for the run. Neither settings file is written.

**Sent:** the two keys of §A, in answers and in one event. No input changes, no command is added, and the window sends `git.watch` and `files.list` as both older builds know them.

| who sends, who reads | build M (`2c7044231`, minor 46) | build F (`f1852de3a`, minor 33) |
|---|---|---|
| **an older daemon answers this build's window** (this Mac's daemon in the moments before the app's build check replaces it, a daemon kept as a LaunchAgent, another machine not yet updated) | its `files.list` carries no `ignored`: the tree lists and nothing is dimmed. Its status carries no `submodule`: a changed submodule's row is a file's row, and its tab shows the files service's error for a folder. `git.watch` and `git.changed` are served as this build asks them | the same: both builds have the same six fields on an entry, the same five on a status entry, and the commands |
| **this build's daemon answers an older app** (the profile taken back to the older build while this build's daemon still runs; an older app reading a session of this machine) | its main reads the answer with the tolerant reader (`host-supervisor.ts` for its own daemon, `machines/socket-link.ts`, `machines/remote/dispatch.ts` for another machine's) and drops `ignored` from each entry that has it and `submodule` from each status entry; its window receives the listing and the status its build knows. One log line per kind of dropped key, the array's index folded | the same code at the same three places |
| **this build's daemon sends `git.changed` to an older app** | read by the tolerant event reader (`host-supervisor.ts`, `machines/socket-link.ts`, `lane-b/remote-checkout.ts`): `submodule` dropped, the event kept | the same |
| **a run of this build, then the older build, then this build** on one profile | nothing is stored, so nothing is carried: the older build draws its Files tree with no group and no marks, and this build draws them again from the next status | the same; build F draws its one Files surface |
| **the settings files** | not written by this landing | the same |

The manifest gains `ignored` on the entries of `files.list`'s output and `submodule` on a status entry wherever a status is answered or sent. Both are new optional properties of object schemas, which the wire's rule takes as a minor (`src/shared/ipc/wire.ts`). The wire's minor is a stand-in, one above the chain's at the pin (55 above 54), in a commit of its own, taken again at the chain's merge.

**The cross-build scene** is §F's G4. **Its row** in the coverage table of `e2e/cross-build.spec.ts` (U13a's block), in the table's own columns:

    | U6b-3a: nothing stored. On the wire,          | (what changed, both ways), after its same-build        | the second half: the peer's app on this build's    |
    | `files.list`'s entries' `ignored` and a       | control: on the peer's `mawsd` this build's window     | `mawsd` lists the folder, shows the dirty          |
    | status entry's `submodule`, in answers and    | lists the folder with nothing dimmed, draws the dirty  | submodule and then a second change in its own      |
    | in `git.changed`                              | submodule as a file's row, and a second change reaches | Review, refuses no answer and no event, and its    |
    |                                               | the Changed group by the peer's `git.changed`          | log names both keys as dropped                     |

**The cross-build runs owed** (the wave's rule for a landing that takes a wire minor): `e2e:cross-build` with `--peer-exact f1852de3a` and with `--peer-exact 2c7044231`, and against the two masters the gate also crosses, `b89d6d1d7` and the master this landing merges into. The scene, both of its halves and its control, must **pass, not skip**, against all four: none of them has either key, and each is a build whose app this build's daemon admits. Each on the final head or on the last head that changed anything of M1's or M2's. The architect's.

### §C. The window's model, the Changed group and the marks (M2)

    // src/renderer/src/tools/code/files/changed.ts (new; pure)
    export type ChangeLetter = 'M' | 'A' | 'U' | 'D' | 'R' | '!';
    export interface ChangedRow {
      path: string;            // absolute: the repository's root joined with `rel`, without a trailing slash
      rel: string;             // as the status lists it; a folder's with no trailing slash
      oldRel: string | null;   // a rename's source
      letter: ChangeLetter;    // decision 4
      folder: boolean;         // an untracked folder, or a submodule
      onDisk: boolean;         // false: D, and a conflict both sides deleted
    }
    export function changedRows(status: GitStatus): ChangedRow[];                    // decisions 4 and 5
    export interface Marks { letter(path: string): ChangeLetter | null; dot(dir: string): ChangeLetter | null }
    export function marksOf(rows: readonly ChangedRow[]): Marks;                      // decision 9; `dot` answers the weightiest letter beneath
    export const LETTER_TONE: Record<ChangeLetter, 'text-danger' | 'text-warning' | 'text-success'>;   // decision 10 (R1)
    // The set of a status's entries as one string: each path with its two letters and whether it is untracked, in the status's order.
    // Equal for two statuses that list the same entries in the same states, whatever else of them differs (decision 14 (b); U6b-3b reads it too).
    export function statusSet(status: GitStatus): string;

    // src/renderer/src/tools/code/files/tree.ts
    TreeRow |= { kind: 'changed-heading'; key: string; count: number }
             | { kind: 'changed'; key: string; row: ChangedRow }

    // src/renderer/src/tools/code/files/tree-state.ts: SessionTree, this run's only
    reveal: string | null;                                       // a folder to scroll into view once (S4)
    revealIn(appSessionId: AppSessionId, path: string, ancestors: readonly string[]): void;   // opens them (stored, as the person's toggles), selects, notes
    revealed(appSessionId: AppSessionId): void;                  // the note dropped: shown, or the person scrolled or selected

    // the open of a row that is not on disk, and of a row outside the session's folders (decision 6; R6), as the code takes it;
    // `path` is the entry's path as the status lists it, a folder's with its slash:
    panelHost.addTool('review', { appSessionId, params: { scope: 'uncommitted', path } });

**The markers** the tests and the scenes read: `[data-files-changed]` on the heading with `data-count`; `[data-changed-row]` on a row with `data-path` (absolute), `data-letter`, and `data-folder` and `data-outside` when they hold; on a tree row, beside today's `data-path` and `data-kind`, `data-letter`, `data-dot` (the dot's letter) and `data-ignored`.

### §D. What this landing consumes, and what a later landing may rely on

**Consumes, by the name each is exposed under:** from U6b-1, `openFile` and its `Opened`, the tree column, `useTreeState` and the tree's one virtual list; from U8a and U8c-2, `useWorkingFolder` and `workingFolder`'s `path`; from U8b, the side column's tabs as they are; from U5b, `unmerged`, `REVIEW_COPY.kinds` and `.renamedFrom`, and Review's `{ scope, path }` params; from U6e, the peers' schema snapshots under `test/cross-build/`; from U13a, the cross-build coverage table. Nothing of U6b-2's is consumed: a framed file's tab is a Files tab like any other.

**U6b-3b relies on** (its document names each as consumed): `statusSet` and the drawn tree's hold on the git store, by which an open filter learns that the set of files changed; the tree column's one list, in whose place its results are drawn, and the place above it where its field stands; `FILES_COPY`, which it adds to; the scratch-repository block of `e2e/code-tools.spec.ts` as this landing leaves it. This landing builds nothing only U6b-3b needs: the field, `treePlace`'s input for a search, the request for the keyboard and the focusable file view are all built there.

**Any later landing may rely on:** `FilesEntry.ignored` and `GitFileStatus.submodule`; `createIgnoreCheck` as the one place a listing asks git; `changedRows`, `marksOf` and `statusSet` for any other list of a session's changes.

### §E. Files other children own, or no child owns (root UC-8)

| file | owner | this landing's insertion |
|---|---|---|
| `src/services/files/service.ts`, `register.ts`; `src/services/checkouts-root.ts` | no child (the cut's X8 names the listing's `ignored`) | the option, its call in `list`, one boundary point; one option passed; one check made, given and disposed of at the stop. `ignored.ts` is new there |
| `src/services/git/porcelain.ts` | no child | one key on a submodule's entry (R2) |
| `src/services/git/runner.ts` | no child | none: read, and used through options it has |
| `src/shared/ipc/schema/files.ts`, `schema/git.ts` | no child for the wire's schemas | one optional key each |
| `src/shared/ipc/wire.ts` and the two generated files | no child | the minor, in a commit of its own |
| `e2e/cross-build.spec.ts` | the P5 work, U13a's block for the table | one scene with its control, and one row |
| `e2e/remote.spec.ts` | the P5 work | one scene |
| `test/cross-build/` | U6 (U6e made it) | cases in one suite, one new suite |
| `docs/tech-debt-tracker.md` | the wave's record | rows |

Read and not edited: `src/renderer/src/stores/git.ts`; `tools/code/review/review-model.ts`, `ReviewShell.tsx` and Review's part of `copy.ts` (U5); `panel/` (U8); `stores/layout.ts` (U13); `src/services/git/ignored.ts`. Everything else this landing edits is U6's by the root's table: `tools/code/files/` and the Files part of `tools/code/copy.ts`.

### §F. The e2e groups whose scenes cross this change

Written in M3, typechecked there, run by the architect on a Mac. Every repository a scene uses is made by the scene with invented names.

| group | file | the scene, and what it waits on before it reads |
|---|---|---|
| `e2e:code` | `e2e/code-tools.spec.ts`, a new block "UX wave U6b-3a" over a scratch repository | **G1** "the Changed group lists a modified, an added, an untracked, a deleted, a renamed and a conflicted file and an untracked folder with their letters; a click opens each where it should; the tree carries the letters, the dots and the muted entries". Waits on the heading with `data-count="7"` before it reads a row; on the file's tab marker after each open; on Review's section for the path after the deleted row; on the folder's tree row being selected after the folder's row |
| | | **G2** "the group and the dimming follow the disk". Writes a file from the test's process and waits on its row; restores it and waits on the row's absence while another row is still there (the control); appends a line to `.gitignore` and waits on `data-ignored` on the row it names; adds an ignored file to the index by force (the test's own `git add -f`) and waits on that row's `data-letter="A"` and on its `data-ignored` being gone, while a second ignored entry in the same folder still has it (the control) |
| | | the existing scene "the Files tree and the viewer use tokens only in both themes" gains the group and the marks |
| `e2e:remote` | `e2e/remote.spec.ts`, beside the U8c-2 scene | **G3** "a session on B: A's Files shows B's changed files and marks and what B's git ignores; with B stopped they stay and Files draws no error". Waits on the heading's count and on the muted row's marker; after B stops, on the link's offline mark before it reads the group and the tree |
| `e2e:cross-build` | `e2e/cross-build.spec.ts` | **G4** "(what changed, both ways)", §B's row; see below |

**G4, as the review's finding 7 has it.** The fixture, made by the scene: a repository with an ignored folder that holds a file, a tracked file `later.txt`, and a submodule (a second scratch repository added from its path, with the file protocol allowed for that one command) whose working tree then has a tracked file modified, so that the outer status lists the submodule as changed. Each daemon runs as the profile's unit and each half is pinned to it as the existing scenes are: `withUnit(s, <build>, <name>, …)`, and `s.ready(page, (st) => st.daemon?.pid === unit.pid)` before anything is read.

| step | what runs | what it waits on, and what that shows |
|---|---|---|
| the control | this build's app on this build's unit `mawsd` | the Changed row of the submodule with `data-folder` (the fixture's status carries `submodule`, and it is read); the ignored folder's tree row with `data-ignored` (the listing carries `ignored`); then the test writes `later.txt` and waits on its Changed row (a `git.changed` after the watch). Without this step the two halves' absences prove nothing |
| the first half | this build's app on the peer's unit `mawsd` | the Changed row of the submodule, present and without `data-folder`; the ignored folder's tree row, present and without `data-ignored`; then `later.txt` written, and its Changed row (the peer's `git.changed` is consumed). Then the logs: no refusal of an answer or an event in main's or the peer's daemon's |
| the second half | the peer's app (`s.launch(…, peer.root)`) on this build's unit `mawsd` | the peer's Files tree row for the ignored folder (the listing passed its reader); the peer's Review on Uncommitted listing the submodule's path (the watch's answer passed it); then `later.txt` written, and the peer's Review listing it (a `git.changed` whose status carries `submodule` passed the peer's event reader). Then the logs: no refusal; and the reader's own lines naming `ignored` dropped from `files.list`'s output and `submodule` dropped from the status, in an answer and in the event `git.changed`, which show both keys were sent on both paths |

A scene of another child's that crosses the code this landing edits and must still pass: U6b-1's block of `e2e/code-tools.spec.ts` (the tree column's places, a row's click and double-click) and U6e's scenes of the tree's context menu.

## Statements to check again once the chain's fourth batch is on master

This document is written against the chain's head, which holds eight landings that are in review. A review can still change them. Before M1 starts, and again at each merge of master, the executor reads each row against the tree it then has (`git diff bdbfe863e HEAD -- <the files>`), and reports a statement that no longer holds instead of building on it. The files are those that differ between master's tree and the pin among the ones this landing reads or edits.

| the statement here | rests on, as the chain holds it | where it is used |
|---|---|---|
| a Files tab draws its tree in one virtual list (`TreeList`) fed by `rowsOf`; `SessionTree` is the drawn tree and holds its directories' watches; `FilesMenu` wraps the list | `tools/code/files/FilesTool.tsx` as U6b-2 and U6e leave it | M2 |
| `unmerged` is exported by `review/review-model.ts`; Review's params are `{ scope, path, turnId, commit }` and `path` is relative to the repository's root for `uncommitted` | U5b-2's `review-model.ts`; `outside` in `review/ReviewShell.tsx` refuses only an absolute path outside the repository | M2; decision 6 (R6) |
| `FILES_COPY` and `REVIEW_COPY` are two objects of `tools/code/copy.ts`, and the desk's web app reads the second | `copy.ts` as U6b-2 and U5b-2 leave it | M2 |
| `list` reads names, then entries, confirms, sorts and cuts; `BoundaryPoint` is a union this landing can add to | `src/services/files/service.ts` as U6b-2 leaves it (its raw read added `after-read`) | M1 |
| `FilesEntrySchema` has six fields and `GitFileStatusSchema` five | `src/shared/ipc/schema/files.ts`, `schema/git.ts` as U6b-2 and U5b-2 leave them | M1; §A, §B |
| `parseStatus` reads `parts[1]` as XY and nothing of `parts[2]` | `src/services/git/porcelain.ts` as U5b-2 leaves it | M1 |
| `git.watch` and `git.status` are registered with no trust gate and answer `GitStatus` | `src/services/git/register.ts`, `service.ts` as U5b-2 leaves them | decisions 1 and 18 |
| `files.list` has no entry in `COMMAND_BUDGETS_MS` | `src/services/command-budgets.ts` as U5b-2 leaves it | "Probe 8" |
| the wire's minor is 54 and the stand-in is 55 | `src/shared/ipc/wire.ts` | Concrete Steps 4 |
| the scenes' anchors: U6b-1's block and the scratch-repository block in `e2e/code-tools.spec.ts`; the U8c-2 scene in `e2e/remote.spec.ts`; the coverage table's last row and the scene that pins its unit daemons with `withUnit` (U6b-2's) in `e2e/cross-build.spec.ts` | those three files | M3; §F |
| `createGitRunner` takes `execFile`; `execGit` returns the child it spawned; the checkouts' `stop` is a list of synchronous parts | `src/services/git/runner.ts`, `src/services/checkouts-root.ts`, `src/services/stop-parts.ts` (none changed by the chain) | M1; decision 13 |

## Size and review

Counted file by file from the code at the pin, tests and scenes included; a new file is counted whole.

| milestone | files | changed lines, about | of which product code |
|---|---|---|---|
| M1 | 17 | 780 | 140 |
| M2 | 9 | 960 | 420 |
| M3 | 5 | 450 | none |
| **the landing** | **about 31** | **about 2,200**, between 1,900 and 2,500 | **about 560** |

The cut estimated about 1,500 lines over 22 files for the whole of U6b-3; counted from the code the two halves together come to about 4,050 over 57 (this landing and U6b-3b's about 1,850 over 26), the review's findings included. What the cut did not count here: the scenes of the remote and cross-build groups; the two suites that hold the older builds at the schema; the measurement; the check's own lifetime; a submodule's mark.

**Review.** The xhigh panel (`doperpowers:review-code`), as ruled on R3: by size, and for what is delicate in it, the daemon's handling of a process it starts inside the files boundary and the wire. The reviewers' attention belongs first on M1: the check's bound, its disposal, and what an older build reads.

## Proof that an executor does not run

Each is a step with what it needs, handed to the architect.

1. **The owner's look at the drawn example and the answer on the card**, before M2 starts. Needs: the drawing "The look" describes, made outside the repository with invented names, at 220 and 160 px in both themes, the letters in their tones (R1).
2. **The ruling on probe 8's verdict**, after M1. Needs: the `probe8.*` lines and the machine line from Surprises & Discoveries.
3. **The Mac lane's unit cases.** `src/services/files/ignored.test.ts` runs real git and holds a real process: a Mac's own git is another build of git than the VM's, and a process group is ended by another kernel. The five facts of decision 12, decision 14's two cases and S1's held process are to be shown there too. With it the macOS-guarded cases of `src/services/files/service.test.ts`, which now pass through the check's place in `list`. Needs: a Mac under the load rule, the final head.
4. **The scenes on a Mac** (§F): G1 and G2 alone first (root UC-10), then `e2e:code` and `e2e:remote` whole on the final head. Needs: the final head; the load rule.
5. **The cross-build runs** (§B): `e2e:cross-build` against build F, build M, master at `b89d6d1d7` and the master this landing merges into; G4's control and both halves pass, not skip, against each. Needs: the final head or the last that changed M1's or M2's files.
6. **Class 1a** on GitHub Actions (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b-3a`), once, on the complete branch; **the panel** and its fix waves.
7. **The chain's merge and the landing:** the wire's minor taken again (Concrete Steps 4); "Statements to check again" read once more; the pull request.
8. **The board:** ticket 672 names U6b-3 whole. Whether this half gets a ticket of its own, or 672 stays open until U6b-3b lands, is the architect's; the register's row of l5-code-09 closes with U6b-3b.

## The pull request

Opened by the architect when the landing before this one in the chain (U6f) is on master. Its body is the short form the owner chose on 2026-11-17, and nothing longer: **the proof** (class 1a's run, the Mac runs and the cross-build runs with the commit each ran on, the panel's verdict), **what differs from the plan** (each place the build departs from this document, with its Decision Log entry), **what is left over** (tracker rows, what was not run, what waits for the owner's hands or eyes). It ends with the ticket's line as the architect settles it (step 8 above), a blank line, and the session line of Constraint 1. It carries no amendment of a reversed ruling: the child's "Rulings reversed" names none for l5-code-09.

## Surprises & Discoveries

- Observation: `files.list` has no budget of its own; the cut's "the command's budget" is the default of 10 s.
  Evidence: `COMMAND_BUDGETS_MS` names no `files.list`; "A command not named here answers within the default" (`src/services/command-budgets.ts`).
- Observation: the status parser drops the one field that tells a submodule from a file.
  Evidence: `RECORDS` in `src/services/git/porcelain.ts` counts `sub` among the fields before the path and `parseStatus` reads only `parts[1]`.
- Observation: Review has two colours for a change, not three; Desktop has three.
  Evidence: `text-success` and `text-danger` are the only tones in `review/FileSection.tsx`, and a modified file's badge is `text-fg-muted`; Desktop's `VT` (`c9bd7af9c-DlJ4cmuC.js:7118-7124`) maps modified to its yellow.
- Observation: Desktop's Files pane has no Changed group and does not ask git what is ignored.
  Evidence: its filter's menu holds five rows, none of them for changes (`c9bd7af9c-DlJ4cmuC.js:14610-14770`); its dimming is a set of folder names (`c82492f2c-B1kvcJEb.js:2955-2972`).
- Observation: both older builds read a daemon's answers and events with the tolerant reader, at the same places as this build, and the reader's file is the same in all three.
  Evidence: `git grep readCommandOutput` and `readEventPayload` at `f1852de3a` and `2c7044231`; `src/shared/ipc/tolerant.ts` has one checksum across the three trees.
- Observation: `git check-ignore -z --stdin`, asked with `./<name>` in the directory itself, behaves as decision 12 needs.
  Evidence: a scratch repository on a Mac, git 2.55.0: `./build` and `./x.log` answered as asked; `./tracked.log` (tracked, matching `*.log`) and a negated `./keep.log` not answered; `./out.js` answered when asked inside the ignored `build`; exit 1 with nothing ignored; exit 128 outside a repository; a file of a nested repository judged by the nested repository's rules when asked there. M1's tests pin each on the VM's git, and step 3 of "Proof that an executor does not run" on a Mac's.
- Observation: the two older builds' `files.*` schemas are already committed as snapshots for a unit suite.
  Evidence: `test/cross-build/peers/<build>/schema-files.ts`, made by `generate.sh` there (U6e).
- Observation: a git run cannot be ended by the service that asked for it, and the daemon's stop ends none (the review's finding 1; the first writing said the opposite).
  Evidence: `GitRun` is `(directory, args, options) => Promise<string>`; `execGit` spawns `detached` and `spawnGit`'s timer is the daemon's; `stop` in `src/services/checkouts-root.ts` lists five parts, none of them a runner's. `createGitRunner` does take `execFile`, and `execGit` returns its child, which is what decision 13 builds on.
- Observation: no directory watch of the window hears a change of the index or of a file above the session's folders (the review's finding 2).
  Evidence: `fs.watch(real, { persistent: false }, …)` with no `recursive` in `src/services/files/watch.ts`; the window watches `shown`, the open and shown directories (`FilesTool.tsx`).
- Observation: Review shows a file's section for a path relative to the repository's root wherever in the repository it lies, and refuses only an absolute path outside the repository.
  Evidence: `outside` in `review/ReviewShell.tsx`: `path.startsWith('/')` and not under `status.repoRoot`. It is what lets a row outside the session's folders open Review (R6).

## Decision Log

1. **2026-11-17 (UTC) · The verification call.** The first writing got an adversarial review before any executor started (entry 2). The branch gets `doperpowers:review-code` as the xhigh panel, ruled on R3: by size (about 31 files and 2,200 changed lines) and because the landing starts a process from inside the files boundary and moves the wire. Class 1a on GitHub Actions is the gate of record. The pull request's body is the short form: the proof, what differs from the plan, what is left over.
2. **2026-11-17 (UTC) · The adversarial review of the first writing (`5a73f8fa3`).** Seven findings, all P2, none P1; the architect read each cited place at that commit and all hold; all accepted. In this document: finding 1 (the check's process and the daemon) by choice (a), the check owns its runs and the stop ends them, with the state after a crash said and a test that holds a process open; finding 2 (dimming after an index-only change or a change above the session's folder) by a status whose set of entries changed listing the drawn directories again, with the two cases that stay stale named; finding 7 (the cross-build scene) by a dirty submodule, a second change after the watch, a same-build control and pinned unit daemons. Findings 3 to 6 are fixed in U6b-3b's document; of finding 6, the silent half is decision 17 and B5 here.
3. **2026-11-17 (UTC) · The split, ruled by the session that keeps master.** U6b-3 is two landings and no three: U6b-3a (the first writing's M1 and M2 with their scenes and the cross-build row; this document, built on `ux-wave/U6b-3`) and U6b-3b (its M3 with its scenes; `docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md`, built on a branch the architect cuts from this landing's head). Chain order: U6f, U6b-3a, U6b-3b, U6b-5. Moved out of this document, not copied: decisions 16 to 25 of the first writing, its sequences S3 to S5 and the filter's half of S7, acceptance B4 to B8, the second card, the request for the keyboard and the focusable file view. Nothing that only U6b-3b needs is built here; what it consumes of this landing is Interfaces §D.
4. **2026-11-17 (UTC) · Ruled on the nine reported points and the cards.** R1 accepted (three tones, shown to the owner in the drawn example). R2 accepted (`submodule` in the same minor, sent only when true). R3: this landing the xhigh panel, U6b-3b one reviewer at the high rung. R4 accepted. R5 accepted as UC-12 has it (U6b-3b's). R6 **changed**: a row for an entry outside the session's folders opens Review at that entry and never the viewer onto a refusal; the first writing opened the file's tab. R7 accepted with a tracker row (U6b-3b's). R8 accepted, corrected by finding 1. R9 accepted (U6b-3b's). The two cards stay as written, the long list's fold here and ⌘P while the tree is folded away in U6b-3b.

## Outcomes & Retrospective

Pending — written at finish.

