# UX wave · U6, the third landing of U6b (U6b-3): Files shows what changed, and finds a file by name

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*), the third of the five landings U6b is cut into (**U6b-3**). **The cut:** `docs/doperpowers/plans/2026-11-14-ux-wave-U6b-cut.md`, cited below as *the cut*: its section "U6b-3 · Files shows what changed, and finds a file by name" and its table "Points reported to the architect, and ruled". **Parent pin:** `bdbfe863e6b2f59031c10f0c51873c4a0210b00b`, the head of the wave's chain through its fourth batch: master `77af813a4` and eight landings that are in review and not on master yet, U6b-2 among them. Every statement about the code below was checked against it, and the root, the child's file and the cut are read at it.
>
> **The design** is the child's file, item "l5-code-09 · Files shows what changed, and finds a file by name", with acceptance A3, and the cut's section, which fixes where it is drawn, what is asked of whom and the wire. This document builds that design and does not reopen it. It carries the constraints, what the cut left to this document (how the lists stay current, what each kind of changed entry shows and does, the filter's keys, ⌘P's edges, probe 8), the milestones and the interfaces. Where the code at the pin contradicts a sentence of the cut or of the child's file, the point is in "Reported to the architect" with the default this document writes and the one place a ruling changes.
>
> **Branch:** `ux-wave/U6b-3`, from `bdbfe863e`. **Board:** ticket 672, under ticket 592. **Not in this landing:** search inside files, hiding dotfiles, a filter over the tree's own rows (the child's "Not included"); the notices' words, `file://` and relative links, "Open in" (U6b-4); which element of Files takes the keyboard when a side-surface key shows it, Back and Forward, zoom, the palette's recent list (U6b-5).

## Purpose

Today Files is a tree and nothing else. A person who reviews what an agent did has to open Review to learn which files changed, the tree gives build output and logs the same weight as source, and the only way to reach a file whose name is known is to open folders one by one.

After this landing the Files tab beside the chat answers the two questions a reviewer brings to it. A **Changed** group on top of the tree lists every file git reports as changed in the session's working folder, with a status letter; the tree shows the same letters, a dot on a folder that holds a change, and the entries git ignores in a quieter colour. **Go to file**, ⌘P from anywhere in the window, puts the keyboard in a filter field above the tree; typing part of a name replaces the tree with a ranked list of the working folder's files, Enter opens the first as a kept tab with the keyboard in it, and `name:42` lands on line 42. It holds for a session MAWS runs, a terminal session and a session on another machine, where every list is read on that machine by commands it already offers.

How to see it working: in a session whose agent has edited two files and written a new one, press ⇧⌘F. Files shows "Changed 3" above the tree with three rows, `M`, `M` and `U`; the folders that hold them carry a dot; `node_modules` and the log folder are grey. Click a row: the file opens beside the chat. Delete a tracked file in a terminal: within about a second a fourth row appears with `D`, and a click on it opens Review at that file. Press ⌘P from the composer, type `tree`, press Enter: the best match opens as a kept tab and the caret is in it. Press ⌘P, type `store.ts:40`, Enter: that file opens at line 40. Press ⌘P and Esc twice: the tree is back where it was, and the keyboard is in the composer again.

## Progress

- [x] (2026-11-17) Document written against `bdbfe863e`: the cut's section and the child's item checked sentence by sentence in the code at that head; the two builds that bind read (`git show 2c7044231:…`, `git show f1852de3a:…`) for the listing's schema, the wire's minor and every place a daemon's answer is read; Claude Desktop `app-5.1231.2` read for its Files pane, its filter's keys and its marks; `git check-ignore` tried on a scratch repository for the five facts decision 12 rests on.
- [ ] The adversarial review of this document, and the architect's rulings on it, on R1 to R9 and on the two cards.
- [ ] The owner's look at the drawn example ("The look"), before M2 starts.
- [ ] M1 — The daemon: the ignore check, probe 8, a submodule's mark, the wire's minor.
- [ ] **Stop.** Probe 8's verdict to the architect; M2 starts on the architect's word.
- [ ] M2 — The window: the Changed group, the marks, the dimmed entries.
- [ ] M3 — Go to file: the action, the filter, the keyboard.
- [ ] M4 — The scenes, the cross-build row, the record, and the acceptance run.
- [ ] The proof an executor does not run ("Proof that an executor does not run", 1 to 9).

## Words used in this document

- **The daemon** is `mawsd`, the per-Mac background process that runs the machine's services; the files service (`src/services/files/`) and the git service (`src/services/git/`) run in it (`src/services/checkouts-root.ts`). **Main** is the Electron main process of the app; **the window** is its page. Main and the window are always one build; the daemon, and a daemon on another machine, may be another.
- **The working folder** is root UC-4's: the checkout the agent's main loop is working in now, answered by `workingFolder(record)` (`src/shared/sessions/working-folder.ts`) and, in the window, `useWorkingFolder(appSessionId)` (`src/renderer/src/sessions/working-folder.ts`). Its `path` is the folder every git read of this landing is made in.
- **The tree column** is the part of a Files tab that draws the tree (`[data-files-tree]`, `src/renderer/src/tools/code/files/FilesTool.tsx`), built by U6b-1. `treePlace` (`files/tree-state.ts`) says where it is in a tab: `alone` (the tab holds no file), `beside` the file, `folded` away, or `instead` of the file (a tab too narrow for both, after its button was pressed).
- **A status entry** is one element of `GitStatus.files` (`src/shared/ipc/schema/git.ts`): a path relative to the repository's root, the two characters of porcelain v2's XY field as `index` and `worktree`, `untracked`, and a rename's `oldPath`. A wholly untracked folder is one entry whose path ends in `/`.
- **The git store** is `useGit` (`src/renderer/src/stores/git.ts`): per machine and folder, the status `git.watch` answered, kept current by the event `git.changed`. The session's summary card (`panel/summary/Summary.tsx`), Review (`review-store.ts`) and the Source control page hold it today, each through the store's own count.
- **Read mode** is how every git call of the read services runs (`gitEnv`, `src/services/git/runner.ts`): no hooks, no fsmonitor, no credential helper, no external diff, no pager, no transport, optional locks off, and git's own check of who owns the repository left on.
- **Build F** is `f1852de3a` (wire 3.33) and **build M** is `2c7044231` (wire 3.46): the two earlier builds a profile that runs this landing may have run before, or may be taken back to (root UC-14). Every machine runs build M today; build F is kept as the build to go back to.
- **A measured bound** is a number read from a run on a named class of machine. It is written with its label, the machine it holds on and what a miss means. No test of this landing asserts a wall time.

## The landing's edge

**In.**

- The Changed group: one row per entry `git.status` lists for the working folder, with its letter (M modified, A added, U untracked, D deleted, R renamed, ! conflict) and a heading that counts them; present only while there is at least one. A click opens the file as a tree row's click does; a row with nothing in the working tree to open opens Review at that file; a folder's row opens that folder in the tree.
- The marks in the tree: the letter on a changed file's row, a dot on a folder that holds a change, and the entries git ignores drawn in the muted colour.
- `files.list` answers, per entry, whether git ignores it; a status entry says when it is a submodule (R2). One wire minor.
- Probe 8 of the child's file: the ignore check's cost on a directory of 5,000 entries, measured on the build VM.
- Go to file: the action `files.goToFile` (Go menu, ⌘P), the filter field above the tree, the ranked list, its keys, `name:42`.
- The scenes of A3 on a Mac (written here, run by the architect), the cross-build row, and the record.

**Not in, and whose.**

| not in | whose |
|---|---|
| search inside files; hiding dotfiles; a filter over the tree's own rows | nobody's: the child's "Not included" |
| what the keyboard does when ⇧⌘F shows Files (the file's view, else the tree) and when it hides | U6b-5; this landing moves the keyboard only for ⌘P and for the filter's Enter and Esc |
| the words of a refusal in a file's tab ("Refused: " and the service's sentence) | U6b-4 |
| a file found in a folder the session added (`additionalDirectories`) | not built: the child's file says the working folder's files, and `git.lsFiles` lists one folder |
| staging, discarding or committing from the Changed group | never: Source control's (U5) |
| a Changed group for a branch or a turn | never: Review's scopes |

## What the code holds today

Read at the pin; each line is a fact the milestones build on.

- **Files' tree.** `FilesTool.tsx` draws one virtual list of rows (`TreeList`) from `rowsOf` (`files/tree.ts`): the session's roots, their entries as folders are opened, and notices. A row is a `<button role="treeitem">`; a click opens or closes a folder and opens a file in the session's preview tab (`openFile`), a double-click keeps it, ⌘-click opens a main tab. The tree is the session's (`useTreeState`, `files/tree-state.ts`): open folders, width and fold are stored under the layout key `files.tree`; the selection and the scroll offset last for the run. The row of the first root carries a Refresh button. Nothing in the tree handles an arrow key.
- **Listings.** `useFiles` (`files/store.ts`) holds a `files.list` answer per session and directory, watches each open directory (`files.watch`) and lists a directory again on a `files.changed` that names an entry in it. One flight per directory at a time, with one more queued.
- **`files.list`** (`src/services/files/service.ts`, `list`) opens the directory by the open-first boundary, reads its names, reads each entry's `lstat` at most 64 at once, confirms the directory once more, sorts (folders first, then by name) and answers at most `FILES_LIST_MAX_ENTRIES` (5,000) entries with `truncated`. Its answer stays private until the confirmation after its last read. The service runs no git and is given no runner. `FilesEntrySchema` is strict: `name`, `path`, `kind`, `size`, `mtimeMs`, `target`. The command has no entry in `COMMAND_BUDGETS_MS` (`src/services/command-budgets.ts`), so its budget is a host request's default, `REQUEST_TIMEOUT_MS` (10 s, `src/shared/host/host-supervisor.ts`).
- **Git status.** `GitService.status` runs `status --porcelain=v2 --branch -z --untracked-files=normal` in the repository's root; `parseStatus` (`src/services/git/porcelain.ts`) keeps the path, the XY characters and a rename's source, and drops the record's `sub` field, which says whether the entry is a submodule. `git.watch` answers the same status and holds a watcher on the repository (`watcher.ts`): a 250 ms trailing debounce capped at 1 s, one `git status`, and `git.changed` with the fresh status when anything of it moved (a listed file's size or time included); a root that ran out of watches is read every 5 s instead. None of the read commands is behind the trust rule: `scm.*` alone runs "only after you trust the folder in a session" (`src/services/scm/validate.ts`).
- **`git.lsFiles`** (`src/services/git/ls-files.ts`) lists `ls-files --cached --others --exclude-standard` in the folder asked (tracked and untracked, ignored left out), or outside a repository a bounded walk (six levels, 20,000 entries, never into `node_modules`, `.git`, `dist`), keeps the list ten seconds, ranks it against the query with `rankPaths` (`src/shared/composer/fuzzy.ts`: a case-insensitive subsequence over the whole path, a bonus at a segment's start and for consecutive characters, ties to the shorter path) and answers the first `limit` (at most 200). **Its paths hold folders too**, each with a trailing `/`, ranked among the files, and the limit cuts before a caller can drop them. The composer's `@` menu is its one caller (`composer/mentions/AtMenu.tsx`): a debounce of 80 ms, and a "Searching files…" row until the answer for the text as it stands has come.
- **`git check-ignore`** already runs in read mode, for the watcher's prune on Linux (`src/services/git/ignored.ts`): one `check-ignore -z --stdin` per batch, exit code 1 accepted as "none".
- **The keymap.** `ACTIONS` (`src/shared/keymap/actions.ts`) has no `files.goToFile`; the table's test names it among the wave's defaults (`WAVE_DEFAULTS`, ⌘P) and not among the rows that must exist (`LANDED`). `palette.open` is the Go menu's first row and its only row of the group `palette`, so a separator follows it (`group`, `GROUP_OF_PREFIX`, `src/main/menu.ts`). `SHELL_FOCUS_ACTIONS` holds the actions that take the keyboard from a page of the in-app browser. A row whose id build F does not know takes no rebinding (`isRebindable`, `src/shared/keymap/build-f.ts`). Nothing in the app handles ⌘P.
- **Showing Files.** `showFiles(appSessionId)` (`files/tabs.ts`) brings the session's Files tab last in view into view, else its tree-only tab, else adds one, and returns the tab's id; the panel host shows a hidden or collapsed side column for it. The session the side column is about is `surfaceSession(state)` (`panel/surface-model.ts`). `toggleSurface` (`panel/SurfaceRow.tsx`) leaves an open page first (root UC-12). `connectOpenFile` (`files/open-chosen.ts`) is the pattern of an action registered only while it can run: it follows the layout store and registers or removes its handler, and the menu draws an unregistered action disabled.
- **The keyboard and a file beside the chat.** Files' tool does not read the panel host's focus request, and nothing puts the keyboard in a file's view when its tab opens: the file's column (`registerSideFile`) only says whether the keyboard is in it (`focusedFile`).
- **Another machine.** `files.list` is offered as a session's call and `git.status`, `git.watch` and `git.lsFiles` under the checkout rule (`src/endpoint/offers.ts`); the window sends each with `pathTarget(machine, appSessionId)`. `useRemoteStanding(appSessionId)` (`src/renderer/src/lane-b/remote-standing.ts`, U9) answers the machine's name and its link's phase, and `disabledWords(command, standing, label)` (`src/shared/ipc/remote-unavailable.ts`) words an act that cannot run while a machine is offline.
- **Reading a daemon's answer.** In this build, in build M and in build F alike, a daemon's answer is read by `readCommandOutput`, the tolerant reader, at three places: main's supervisor of its own daemon (`src/shared/host/host-supervisor.ts`), a socket-linked machine (`src/main/machines/socket-link.ts`) and a machine over the link (`src/main/machines/remote/dispatch.ts`). The reader drops an object key the build does not know and logs it once per message and path, an array's index folded (`src/shared/ipc/tolerant.ts`, the same file in all three builds). The window's own read is strict (`validateCommandOutput`), and the window is always its main's build.

## Where the cut's section no longer matches the code

The cut was written against master `c6a22fe89`, before U6b-1 and U6b-2 were built. Its edge and its six decisions stand; these are the places where the code now says more, or something else.

| the cut says | the code at the pin | what this document does |
|---|---|---|
| decision 1: the Changed group sits on top of the tree in every Files tab, the filter field above it | the tree column is not always drawn: in a tab that holds a file it can be folded away (a stored choice of the session), and in a tab too narrow for both it is drawn only in the file's place after its button is pressed (card R8's answer, `treePlace`) | ⌘P shows the tree column in the tab it lands in, for as long as the search lasts, and changes no stored fold (decision 22; card 2) |
| decision 2: `git.status { directory }` for the Changed group and the marks | `git.watch` answers the same status and keeps it current, through a store the window already has; a `git.status` asked once would go stale at the agent's next write | the git store (decision 1). `git.watch` and `git.changed` are offered to another machine as `git.status` is |
| decision 2: `git.lsFiles { directory, query, limit }`, "its limit allows the child's 50" | the answer holds folders among the files, and the limit is applied before the window can leave them out | the window asks for 200, the command's most, and shows the first 50 files (decision 16; R7) |
| decision 2: "a window of build F drops a key it does not know (`readTolerant`)" | it is main that drops it, at its read of the daemon's answer; the window reads strictly, and is its main's build | Interfaces §B states it per place and per build |
| decision 3: probe 8 against "the command's budget (`src/services/command-budgets.ts`)" | `files.list` is not in that table: its budget is the default, 10 s | the measurement is judged against a tenth of it, and the check has a bound of its own so that it can never spend the budget (decisions 12 and 13; "Probe 8") |
| decision 4: the handler "calls `showFiles` and puts the keyboard in the filter; Enter opens with `keep`" | `showFiles` can return a tab that is not drawn yet, and nothing puts the keyboard in a file that opens (the child's file says Enter "puts the keyboard in it") | one small request for the keyboard, taken by the field or by the file's column when it draws (decision 23; sequences S4 and S5) |
| decision 5: `panelHost.addTool('review', { params: { scope: 'uncommitted', path } })` | `addTool` takes the session with the params (`appSessionId`); Review's `path` is relative to the repository's root | the call as the code takes it (Interfaces §C) |
| "Stored and sent": one optional field on an answer | a changed submodule is a status entry the window cannot tell from a file: the parser drops the one field that says so | a second optional field in the same minor, `submodule` on a status entry, reported as R2 |
| the size: about 1,500 changed lines over 22 files, one reviewer at the high rung | counted file by file from the code: about 3,100 over 44, of which about 950 are product code ("Size and review") | reported as R3 |

## How Claude Desktop does the same, and where MAWS differs

Read in `app-5.1231.2` (root law 1); the paths are under `web/app/v1/`.

- **⌘P** opens the Files pane if it is closed, shows a collapsed side area, focuses the pane's filter and selects the text it holds (`c11959232-BDz9Nq4r.js:4786-4800`; `c9bd7af9c-DlJ4cmuC.js:7915-7935`); while an overlay is up the key does nothing. MAWS does the same.
- **The filter's keys** (`c9bd7af9c-DlJ4cmuC.js:8477-8512`). Enter with text opens the first result as a kept tab, and when the results for the text have not come yet it remembers the press and opens when they come (`:8449-8459`, set at `:8512`). Esc with text empties the field and keeps the keyboard in it; Esc with the field empty gives the keyboard back to the element that had it before the filter. A blur cancels a remembered Enter. Nothing acts while the input method is composing. A single click on a result opens a preview tab and any other click count a kept one (`:9003-9005`). MAWS takes all of this. It differs in two places: after Enter the keyboard goes into the file (the child's words; Desktop leaves it in the filter), and ↓ and ↑ move a highlight while the keyboard stays in the field, as MAWS's palette does, where Desktop moves the keyboard into the rows.
- **The results** replace the tree with a flat list, files only, at most 50, with no line that says more exist; no match reads "No matching files" (`:9806`). The ranking is a subsequence over the whole path with bonuses for consecutive characters, word starts and short paths. MAWS's `rankPaths` is the same family; it has no bonus for a match at the file name's start and is never case-sensitive. Desktop parses no `name:42`; the child's file asks for it.
- **The marks** (`:7076-7260`). M, A, U, R and `!` at the row's end in a fixed slot; modified in yellow, added, untracked and renamed in green, a conflict in red (`:7118-7124`); a folder that holds a change gets a dot in the colour of the weightiest change beneath it; a file under an untracked folder is marked untracked; a screen reader hears "Modified", "Contains changes". Old marks stay while a refresh runs, with no indicator.
- **Desktop has no Changed group in Files**: its changed files are a list of its Diff pane. The child's file puts the group in Files because the owner reviews what agents changed and opens Files to look at it (its "Why this, not that"). **Desktop does not ask git what is ignored**: it dims a fixed list of folder names (`c82492f2c-B1kvcJEb.js:2955-2972`) in its secondary text colour. The child's file asks git, so a project's own rules hold.
- **Another machine.** Desktop draws no marks for a cloud session and no filter for an SSH one. MAWS's three routes behave alike (root law 5).

## Decisions settled at authoring

Each is settled from the code, with what it beat. Where one changes what a person sees beyond the child's words it is also in "Reported to the architect" or a card, and names its one place.

### The Changed group and the marks

1. **What keeps them current: the git store.** While a session's tree is drawn, it holds `useGit.watch(machine, workingFolder.path, appSessionId)` and reads the entry's `status`. The daemon's watcher sends `git.changed` when the status moves, so the group and the marks follow the agent's writes with no act of the person's and no request of this landing's own. *It beat* a `git.status` asked when Files opens and on every `files.changed`: Files watches only the folders that are open, so a change in a closed folder would never be heard; and a timer, which Desktop's marks use (a wait of one to five seconds after a folder's change) and MAWS does not need.
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

   A file outside the session's folders (a session started in a subfolder of its repository) is listed, because the status lists it and Review lists it; its tab shows what the viewer says of a file it may not read. A folder outside every listed root is listed and does nothing on a click. *It beat*, for the folder: a row that does nothing (a dead row among live ones); listing the folder's files one by one (a change of `git.status` for every reader of it); opening the folder inside the group (a second tree).
7. **Opening a folder in the tree** (`reveal`): the folder and every folder above it are opened in the session's tree (the person's act, stored as a click on each would be), the folder becomes the selected row, and it is scrolled into view once, when its row is first in the list. The person's own scroll, or another selection, ends the wait (sequence S6).
8. **Paths.** A row shows the path relative to the repository's root, as Review does, and opens `repoRoot` joined with it.
9. **The marks in the tree.** A row whose path a Changed row names carries that row's letter. A row beneath an untracked folder carries `U`. A folder row (a root's included) with a Changed row beneath it and no letter of its own carries a dot. Paths are matched as `sameFile` matches them (the same string, the same but for case, or the `/private` spelling); a mark is drawn and grants nothing. The letter or the dot sits at the row's end in a fixed slot, so the name is cut before it; the letter is hidden from a screen reader, which hears the state after the name ("Modified", "Contains changes"). On the selected row the letter takes the row's own colour.
10. **The colours** (R1): `!` and `D` in `text-danger`, `M` in `text-warning`, `A`, `U` and `R` in `text-success`; the dot in the colour of the weightiest change beneath, in the order `!`, `M`, `D`, then the rest. Tokens only.
11. **Where the group is drawn:** as the first rows of the tree's one virtual list, so a status of thousands of entries costs what the tree costs; a heading row "Changed" with the count, then the rows one level in. The heading is not a control (card 1). When the group gains or loses rows while a tree row is the first row in view, the list's offset moves by the same height, so the tree does not jump under the person's eyes as the agent writes (sequence S2).

### What git ignores

12. **The check** is one `git check-ignore -z --stdin`, in read mode, run in the listed directory itself, asked about the entries the answer will carry (after the sort and the cut at 5,000), each as `./<name>`; it runs after the entries' own reads and before the listing's last confirmation, so the listing is still private while it runs. An entry it names is answered with `ignored: true`; no entry ever carries `false`, so a listing with nothing ignored is byte for byte what it was. The roots' listing is never checked. Five facts of git it rests on, each seen on a scratch repository and pinned by M1's tests: the answer names a path as it was asked; a tracked file that matches a pattern is not named; an entry of an ignored folder, asked in that folder, is named; nothing ignored is exit code 1; outside a repository the call fails. *Why in the directory:* git then answers by the innermost repository that holds the directory, so a folder inside a submodule or a nested repository is judged by its own rules, and no path of the request can lie in a submodule (asked from above, one such path fails the whole call: the comment in `src/services/git/ignored.ts`). *Why `./`:* git reads these names as pathspecs, and the prefix keeps a name that begins with `:` or `-` a name. *It beat* the watcher's two whole-repository listings (`gitIgnored`): they answer folders only, and cost a walk of the repository per root.
13. **The check can only cost what it is allowed.** At most `IGNORED_CHECK_CONCURRENCY` (4) checks run at once in a daemon and the rest wait in order; a check answers within `IGNORED_CHECK_MS` (2,000) of being asked, its wait included, or it gives no answer. No answer for any reason (not a repository, another owner's repository, a timeout, git missing, an answer that cannot be read) is a listing with no entry marked, never a failed listing. So `files.list` can exceed what it costs today by 2 s at the very most, inside a budget of 10. *It beat* an unbounded check, which the first slow repository would turn into listings that time out; and a cache of answers per directory, which would have to follow every `.gitignore`.
14. **How the dimming stays current.** It comes with each listing, and a directory is listed again as today: on a change in it, when it is opened again, on Refresh. One rule is added in the window: when a `files.changed` names an entry called `.gitignore`, every listing the session holds at or beneath that entry's directory is listed again. A change of `.git/info/exclude` or of the person's global ignore file shows at the next listing. *It beat* listing every open directory again on every `git.changed`: one git process per open folder for every write of the agent.
15. **Dimmed** is the muted text colour (`text-fg-muted`) on the entry's name, which is what a symbolic link's row already has; the selected row keeps its own colour. A screen reader hears "Ignored by git" after the name.

### Go to file

16. **What is asked.** `git.lsFiles { directory: workingFolder.path, query, limit: 200 }`, 80 ms after the last keystroke (the `@` menu's wait), sent with `pathTarget(machine, appSessionId)`. From the answer the window drops every path that ends in `/` and shows the first 50. The ranking is the command's, unchanged: one ranking of a name, here and in the `@` menu. No line says that more exist, as in Desktop and as A8 takes the same line from the palette. *It beat* a scorer in the window that weighs the file's name (a second ranking of the same list, and the whole list sent to the window to feed it) and an input that asks for files only (R7).
17. **`name:42`.** A trailing `:<digits>`, or `:<digits>:<digits>`, is the line: the first number, at least 1; a second is read and dropped. What stands before it is the query; when nothing does, the whole text is the query. The query is cut at the schema's 256 characters.
18. **What the list shows**, in place of the tree and of the Changed group, while the field holds a query:

    | state | drawn |
    |---|---|
    | the answer for the text as it stands has come, with rows | the rows: a file's name, then its folder in the muted colour; the first is highlighted |
    | it has come, empty | one line, "No matching files" |
    | it has not come yet, and an earlier answer is drawn | the earlier rows, none highlighted, the list marked busy |
    | it has not come yet, and nothing is drawn | one line, "Searching files…" |
    | the read failed | one line, "Files could not be searched."; the next keystroke, or ⌘P, asks again |
    | the session's machine is offline (its link's phase, U9) | one line from `disabledWords`: "File search is unavailable while <machine> is offline."; nothing is asked, and the text is asked again when the phase changes |

    An answer for a text that is no longer the field's, or for a folder that is no longer the working folder, is dropped (the `@` menu's rule).
19. **The keys**, while the field has the keyboard and the input method is not composing:
    - **↓ and ↑** move the highlight among the rows of the answer for the text as it stands, and stop at the ends. With no such answer they do nothing.
    - **Enter** opens the highlighted row with `openFile(…, line, { keep: true })` and puts the keyboard in the file (decision 23). Pressed before the answer for the text has come, it is held: when that answer comes, its first row opens. A change of the text, an arrow, Esc, the field losing the keyboard, or the read failing ends the hold and opens nothing (sequence S3). With no row it does nothing. With a modifier held it does nothing.
    - **Esc**, not repeating: with text, empties the field, ends a held Enter, and the tree is back at the scroll offset it had; with the field empty, gives the keyboard back to the element that had it when ⌘P was pressed, when that element is still in the page, and otherwise leaves it in the field.
    - **⌘P again** selects the field's text, so that typing replaces it, and asks a failed read again.

    The keyboard stays in the field while the highlight moves (`role="combobox"` with `aria-activedescendant`, as the palette's field). *It beat* Desktop's move of the keyboard into the rows: a person can go on typing after an arrow.
20. **A click on a result** is a tree row's click: the preview tab, a double-click keeps it, ⌘-click opens a main tab; at the line the text names.
21. **After an open the field keeps its text and the list stays**, as in Desktop; Esc brings the tree back, as the child's file says. The one place: `opened` in `files/finder.ts`.
22. **The tree column is shown for the search** (card 2). ⌘P marks the tab it lands in as *finding*. While a tab is finding, `treePlace` answers `beside` where the tab has room for both, whatever the stored fold, and `instead` where it has not. Finding ends when a file is opened from the list, when Esc leaves the field, when the field loses the keyboard while it is empty, and when the tree's button is pressed; the column is then where the stored fold and the tab's width put it. Nothing is stored.
23. **Who gets the keyboard, when the thing that should take it is not drawn yet.** One request at a time, held in `files/finder.ts`: `{ tabId, into: 'filter' | 'file' }`. ⌘P makes one for the filter of the tab `showFiles` answered; the filter's Enter makes one for the file of the tab `openFile` answered (for a file that opened in the main area, the pane takes the keyboard as `pane.focusOther` gives it). The field, or the file's column, takes the request when it draws and finds it; the person's next key press or pointer press anywhere drops it. The file's column takes the keyboard on itself (it becomes focusable) and hands it to the file's editor when one is drawn, or as soon as one is drawn while the column still has it; a file whose read fails leaves it on the column (sequences S4 and S5). *It beat* the panel host's focus request, which every open of a tab raises: reading it here would move the keyboard on a click of a path link, which is U6b-5's question.
24. **The action.** `files.goToFile`, "Go to file", ⌘P, a menu row of Go directly under "Command palette" with no separator between them; in `SHELL_FOCUS_ACTIONS`; not rebindable while build F can be gone back to, and it gives ⌘P up to a stored rebinding that holds it (root UC-6, both by the table's own functions). Its handler is registered exactly while it can end with the keyboard in the field: the side column has a session (`surfaceSession`), and neither the Settings dialog nor the Overview is open. With a page open it leaves the page first (root UC-12: an act on the side column leaves a destination first), then shows Files, as ⇧⌘F does. Unregistered, the menu row is disabled and the key does nothing. *It beat* closing the dialog or the Overview for a key that is about files (R5).
25. **An open filter and a change on disk.** The list is the answer to the text; it is not asked again when the status moves. The daemon keeps a folder's list of files for ten seconds, so a file written a moment ago can be missing from an answer for up to that long. When the working folder itself changes (the agent moved to another worktree, U8c-2) the text is asked again for the new folder. *It beat* asking again on every `git.changed`: the answer would come from the same kept list, and rows would move under the highlight.

### Routes and repositories

26. **Another machine.** The status, the listings and the search are read there, by `git.watch`, `files.list` and `git.lsFiles`, which every machine already offers; no offer and no capability is added. A slow link shows what decision 18 says for an answer that has not come. A dropped link keeps the Changed group and the tree as they were, and the filter says the machine is offline. A machine on an older build answers its listings without `ignored`: nothing is dimmed there, and the rest works.
27. **A folder that is no repository.** No Changed group, no marks, nothing dimmed. The filter works: `git.lsFiles` walks the folder (six levels, 20,000 entries, not into `node_modules`, `.git` or `dist`).
28. **A repository MAWS does not trust.** Trust gates what changes a repository (`scm.*`); every read of this landing runs in read mode, as Review's and the summary card's do today in the same folders, trusted or not. This landing adds one read, `check-ignore`, to a files service that ran no git; it executes nothing of the repository's (no hook, no filter, no fsmonitor, no external diff) and writes nothing. A repository another user owns is refused by git itself in read mode; that is "no status" and "no answer": no group, nothing dimmed, no error.
29. **What a caller on another machine learns.** `files.list` answers it one more bit for an entry it already lists. The check runs in the directory the boundary confirmed for that caller, under that caller's roots (a machine's home is never one), on names read from that directory. The rules git consults can lie above the session's root (a parent repository's `.gitignore`, the global file); none of their text is sent.

## Reported to the architect

Each with the default this document builds and the one place a ruling changes.

| # | The point | Evidence | Built by default | The one place |
|---|---|---|---|---|
| R1 | **The child's file asks for the marks "in the colours Review uses for added, changed and removed"; Review has two.** It draws added lines green and removed lines red, and a modified file's badge in the muted colour. | `FileSection.tsx` (`text-success`, `text-danger`, `Badge`); `tokens.css` has `--warning` | Desktop's three tones (root law 1): modified in `text-warning`, added, untracked and renamed in `text-success`, deleted and a conflict in `text-danger` | `LETTER_TONE` in `files/changed.ts` |
| R2 | **A second optional field in the same wire minor: `submodule` on a status entry.** A changed submodule is listed as an ordinary `M` entry whose path is a folder; opened as a file, its tab shows the files service's error for a folder ("not a regular file"). The parser drops the field that tells them apart. | `parseStatus` (`sub` is `parts[2]`, never read); `GitFileStatusSchema` | the field, sent only when true; the row is a folder's row. With a daemon that does not send it the row opens as a file's | `GitFileStatusSchema` and `parseStatus`; without them `changedRows` reads no submodule |
| R3 | **The size is past the cut's estimate, and past the mark for a single reviewer.** | "Size and review" | the count, and the panel as the rule's letter has it; the stakes alone would take a high reviewer | "Size and review" and Decision Log 1 |
| R4 | **A click on an untracked folder's row.** The child's file says a click "opens the file as any tree row does"; a folder is no file. | `--untracked-files=normal` lists a new folder as one entry | it opens that folder in the tree (a tree row's click on a folder opens the folder) | the folder branch of `activateChanged` in `FilesTool.tsx` |
| R5 | **⌘P while the Settings dialog or the Overview is open does nothing; with a page open it leaves the page.** The child's file says "from anywhere". | UC-12; `connectOpenFile` is disabled under the Overview for the same reason; a field under a modal layer cannot hold the keyboard | as said | `canGoToFile` in `files/finder.ts` |
| R6 | **The Changed group lists the repository's entries, also those outside the session's folders** (a session started in a subfolder). | `git status` runs at the repository's root; Review lists the same | listed; a click shows the viewer's refusal | a filter in `changedRows` |
| R7 | **Fewer than 50 files can be listed while more match.** `git.lsFiles` ranks folders among files and cuts at its limit (200 at most) before the window drops the folders. | `withDirectories`, `rankPaths(...).slice(0, limit)` | the window asks 200 and shows the first 50 files; a longer text narrows it | an optional input of `git.lsFiles` (files only), a wire field a later landing can add |
| R8 | **Probe 8's rule.** The child's file compares with "the command's budget"; `files.list` has only the default, 10 s. | `COMMAND_BUDGETS_MS` | pass at a tenth of it on the build VM, the check bounded at 2 s in the product, and a miss is a stop: the executor builds no fallback | "Probe 8" |
| R9 | **Go to file searches the working folder only.** A file in a folder the session added is not found. | the child's words; `git.lsFiles` takes one folder | as the child's file says | `useFinder`'s one `directory` |

## The cards for the owner

Two, in final form: the question as it can be put, the options with what each means in use, the recommended one first. Neither holds a milestone: the default named is built. Every name in the drawings is invented.

### Card 1 · A long list of changed files

**The question.** "When an agent has changed many files, the Changed list above the file tree gets long and the tree starts far below it. Should the list fold?"

| option | in use |
|---|---|
| **A · It folds by its heading (recommended)** | a click on "Changed 48" folds the list to that one line and a second click opens it; it starts open in every session and is open again after a relaunch |
| B · Always whole | the list is always all its rows; the tree is reached by scrolling past it, or a file by ⌘P |
| C · The first ten, then "Show all 48" | short by default; one more line to read and one more thing to press |

    A, folded                 A and B, open              C
    ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
    │ Go to file           │  │ Go to file           │  │ Go to file           │
    ├──────────────────────┤  ├──────────────────────┤  ├──────────────────────┤
    │ ›  Changed 48        │  │ ⌄  Changed 48        │  │ Changed 48           │
    │ ⌄ harbor   directory │  │   cart.ts   src/   M │  │   cart.ts   src/   M │
    │   › docs             │  │   rates.ts  src/   M │  │   …eight more        │
    │   ⌄ src            • │  │   …46 more rows      │  │   tides.md  docs/  U │
    │       cart.ts      M │  │ ⌄ harbor   directory │  │   Show all 48        │
    └──────────────────────┘  └──────────────────────┘  │ ⌄ harbor   directory │
                                                        └──────────────────────┘

**Built until answered:** B, the child's words as they stand. **The one place:** the heading row (`ChangedHeading` in `FilesTool.tsx`) and one flag of the run in the session's tree state.

### Card 2 · ⌘P while the file tree is folded away

**The question.** "Go to file's field is above the file tree. When you have folded the tree away to give a file the whole tab, what should ⌘P do?"

| option | in use |
|---|---|
| **A · Show the tree for the search, then fold it again (recommended)** | ⌘P brings the column with the field; when you open a result or press Esc, the file has the whole tab again. In a tab too narrow for both, the column takes the file's place for the search |
| B · Unfold the tree and leave it | ⌘P is also "show the tree"; you fold it again by its button |
| C · A field over the file | a small field floats over the file with its results under it; the tree stays folded. A second place where files are listed |

    before ⌘P                  A and B, while searching     A after Enter (B: the column stays)
    ┌────────────────────────┐ ┌─────────┬──────────────┐  ┌────────────────────────┐
    │ ▯ tides.md             │ │ rat|    │ ▯ tides.md   │  │ ▯ rates.ts             │
    │                        │ ├─────────┤              │  │                        │
    │ # Tides                │ │ rates.ts│ # Tides      │  │ export const rates = { │
    │                        │ │ ratio.ts│              │  │                        │
    └────────────────────────┘ └─────────┴──────────────┘  └────────────────────────┘

**Built until answered:** A; it writes nothing to what is stored. **The one place:** the input `finding` of `treePlace` (`files/tree-state.ts`).

## The look

**The owner should see a drawn example before M2 starts**: the Changed group, the marks and the filter are new faces in a column that is 220 px wide by default and can be 160. What the drawing should show, at both widths and in both themes, with invented names: (1) the tree with a Changed group of six rows, one of each letter, a long path cut before its letter, a folder with a dot, a row under an untracked folder, two ignored entries, the selected row; (2) the filter with a query, five results, the first highlighted; (3) "No matching files"; (4) a tab too narrow for both, where the column stands in the file's place while searching. The architect draws it outside the repository from the measurements below.

    ┌────────────────────────────┐   ┌────────────────────────────┐
    │ Go to file                 │   │ rate|                      │
    ├────────────────────────────┤   ├────────────────────────────┤
    │ Changed 6                  │   │ rates.ts   src/            │
    │   merge.ts   src/        ! │   │ rates.test.ts   src/       │
    │   cart.ts    src/        M │   │ pirate.md   docs/          │
    │   rates.ts   src/        A │   │                            │
    │   old.ts     src/        D │   │                            │
    │   port.ts    src/lib/    R │   │                            │
    │   notes/                 U │   │                            │
    │ ⌄ harbor  directory      • │   │                            │
    │   › docs                   │   │                            │
    │   › node_modules   (muted) │   │                            │
    │   › notes                U │   │                            │
    │   ⌄ src                  • │   │                            │
    │       cart.ts            M │   │                            │
    │       rates.ts           A │   │                            │
    │     debug.log      (muted) │   │                            │
    └────────────────────────────┘   └────────────────────────────┘

**The measurements.** The field: one row of 32 px at the column's top, outside the scrolling list, an `<input>` in `text-ui` with the placeholder in `text-fg-faint`, a bottom border in `border-border`, no icon and no clear button. Every other row is the tree's row, 24 px (`FILES_ROW_HEIGHT`). The heading: "Changed" in `text-ui-sm text-fg-muted`, the count after it in `text-fg-faint`, at the tree's root indent. A Changed row and a result row: at one level's indent; the name in `text-fg`, then the folder in `text-ui-sm text-fg-faint`, which is what gives way first when the row is narrow; the name is cut next. The mark's slot: 16 px at the row's end, the letter in `text-ui-sm` and semibold, centred; the dot 6 px, round. The highlighted result has the tree's selected background (`bg-bg-active`). Colours: decisions 10 and 15.

**The sentences a person reads** (exact strings are decisions; `FILES_COPY` in `src/renderer/src/tools/code/copy.ts`):

| where | text |
|---|---|
| the field's placeholder and its accessible name | `Go to file` |
| the heading | `Changed`, then the count with the thousands separator |
| after a name, for a screen reader, and as the letter's title | `Modified`, `Added`, `Untracked`, `Deleted`, `Renamed`, `Conflict` (Review's words, `REVIEW_COPY.kinds`) |
| a folder with a dot | `Contains changes` |
| an ignored entry | `Ignored by git` |
| a renamed row's title | `REVIEW_COPY.renamedFrom(old path)` |
| no result | `No matching files` |
| no answer yet, nothing drawn | `Searching files…` (the `@` menu's words) |
| the read failed | `Files could not be searched.` |
| the label handed to `disabledWords` | `file search` |
| the menu, the palette, the shortcut sheet | `Go to file` |

## Routes (law 5)

| | a session MAWS runs | a terminal session | a session on another machine |
|---|---|---|---|
| the Changed group and the marks | `git.watch` of the working folder on this Mac's daemon | the same | `git.watch` on that machine, under its checkout rule; the last status stays while the link is down |
| ignored entries | `files.list`'s `ignored`, from this Mac's daemon | the same | from that machine's daemon; absent from an older build's answer, and then nothing is dimmed |
| Go to file | `git.lsFiles` of the working folder | the same | on that machine; offline says so (decision 18) |
| the file a row opens | read by this Mac's files service | the same | read on that machine, as every file of such a session |
| a deleted file's row | Review beside the chat | the same | the same; Review reads there |

The working folder is the selector's on every route (root UC-4). No act is added for another machine, so root UC-7 asks for no offer and no capability; its sentence for a read the link cannot carry is decision 18's last row.

## Acceptance

Behaviour a person can see, or a run can show. *Unit* is run by the milestone's executor on the build VM; *scene* is written in M4 and run on a Mac by the architect; the names of the scenes and what each waits on are M4's.

- **B1 · The Changed group** (A3; unit and scene). In a session whose working folder holds a modified file, a file added to the index, an untracked file, a deleted file, a renamed file, a conflict and an untracked folder, Files shows "Changed 7" above the tree and seven rows with `M`, `A`, `U`, `D`, `R`, `!` and `U`, the conflict first. A click on the modified row opens the file beside the chat in the preview tab; on the deleted row, Review on Uncommitted at that file; on the folder's row, that folder open and selected in the tree. With a clean working folder there is no heading and no row.
- **B2 · The marks** (A3; unit and scene). The tree's rows for those files carry the same letters; each folder above one carries a dot; a file inside the untracked folder carries `U`. An ignored folder and an ignored file are drawn in the muted colour, and a tracked file whose name matches an ignore pattern is not.
- **B3 · They follow the disk** (scene). A file written in the working folder by another process appears in the Changed group with no act in the window; restored to its committed content, its row goes. A line added to `.gitignore` dims the entries it names in the open folders without Refresh.
- **B4 · Go to file** (A3; unit and scene). With the side column closed and the keyboard in the composer, ⌘P opens Files with the keyboard in the field. Typing part of a name lists files only, at most 50, the first highlighted; ↓ moves the highlight; Enter opens the highlighted file as a kept tab with the keyboard in it. `name:42` then Enter lands on line 42. Esc with text empties the field and the tree is at the offset it had; Esc again puts the keyboard back in the composer. The same from a terminal that holds the keyboard.
- **B5 · Enter before the answer** (unit). With an earlier list drawn, the text changed and Enter pressed before the new answer: the new answer's first row opens when it comes, and no row of the earlier list ever does. A change of the text after the Enter, an arrow, Esc or a blur before the answer: nothing opens.
- **B6 · A folded tree** (unit and scene). In a tab whose tree is folded, ⌘P shows the column and the field; after Enter the file has the whole tab, and the stored fold was never written. In a tab too narrow for both, the column stands in the file's place for the search.
- **B7 · The menu and the table** (A13; unit and scene). Go ▸ "Go to file" stands directly under "Command palette" with ⌘P and no separator between them; it is disabled with no session in the side column, with the Settings dialog open and with the Overview open; the shortcut sheet lists it under Go; Settings ▸ Keyboard draws no control to change it; with a stored rebinding of another action to ⌘P the menu row has no accelerator. With the keyboard in a page of the in-app browser, the menu row puts it in the field.
- **B8 · Another machine** (unit and scene). For a session on another machine the Changed group lists that machine's changes and the filter that machine's files. With the link down the group stays as it was and the list reads "File search is unavailable while <the machine's name> is offline."
- **B9 · No repository, and a repository git refuses** (unit). In a folder that is no repository: no Changed group, no mark, nothing dimmed, and the filter lists files from the walk. In a repository git refuses to read: the same, and no line of error in Files.
- **B10 · The two older builds** (unit and scene; Interfaces §B). This build's window on a daemon of build M or build F: the tree lists and nothing is dimmed. An app of build M or build F on this build's daemon, with an ignored entry in the folder it lists: its tree lists every entry and its log holds no refusal of the answer. Nothing is stored, so a run of an older build between two runs of this one leaves nothing behind and loses nothing.
- **B11 · Probe 8** (measured; "Probe 8"). The verdict is written in Surprises & Discoveries with the numbers, the machine and the versions. And, unit: with a check that never answers, a listing answers all its entries, none marked, when the check's bound has passed on the test's own clock.
- **B12 · Tokens, and the guards** (unit). `test/support/tokens-guard.test.ts` passes over the new renderer source; the wire's manifest test passes at the new minor; `src/shared/machine` passes.

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push. No `pnpm install`, typecheck, eslint, vitest, build, engine or Electron there. Every check runs on the wave's build VM in a checkout of the pushed head, through `vmcheck.sh` (Concrete Steps). An executor starts no Electron e2e, runs no `scripts/ci-gate.sh` and opens no pull request. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.
2. **The design is the child's and the cut's.** What is drawn where, the commands asked and the field on `files.list` are theirs; "Decisions settled at authoring" fills what they left. An executor who finds that one of them cannot hold stops and reports; a gap is resolved in the spirit of the nearest decision and recorded.
3. **What is stored and sent** (root UC-14). Nothing is stored: no layout key, no field of `files.tree`, no settings key, no rebinding of the new action. What is sent is Interfaces §B, against build M and build F. The wire's minor moves once, in a commit of its own, to a stand-in number that the chain's merge takes again.
4. **Authorisation is checked where the act runs, on the value it uses.** The ignore check runs in the directory the files boundary confirmed for the caller, on the names read from it, and adds nothing a refused listing would answer. No new command reaches a session's folders; `git.watch` and `git.lsFiles` keep their own rules, unedited.
5. **Read mode, and nothing else.** Every git call of this landing goes through `createGitRunner()` with its default mode. No call writes, and none is added to the `scm` service.
6. **Files other children own** (root UC-8). Interfaces §F lists every insertion with its owner. An executor who must edit another file of another child's stops and reports.
7. **Three routes** (law 5): "Routes" above.
8. **The repository is public** (root UC-11), and a person's content is never read. Tests, fixtures and scenes build their own repositories under a temporary folder (`test/support/git-fixture.ts`, with an empty home so that no global git configuration of a machine is read) with invented names. No fault is reproduced by reading the content of a session, a file, a settings file or a folder of a person's: structure and counts only, and none of it enters the repository. Nothing about any person's machines or installed software enters a document, a test or a commit.
9. **Guards that read source text.** In renderer source and its tests a ticket or item number is written in words ("ticket 672"); the tokens guard reads `#` and three to eight hex digits as a colour. Run that guard with M2 and M3. Components use tokens only.
10. **The level of proof.** A test that asserts an absence over input it builds by hand (no entry marked, no group, no row opened, no request sent) carries a control in the same test that shows the reader takes that input's form: the same listing with one entry that is marked, the same status with one more entry that makes a group, the same held answer that does open when nothing intervenes. An asynchronous rule is asserted by a test that holds the awaited thing open and acts in between ("The sequences that must hold"). A scene says, in its description, what it waits on before it reads a position, a count or where the keyboard is. A rule about two builds is asserted in the cross-build scene, and a skipped scene is not evidence.
11. **No wall time is asserted.** Probe 8's numbers are measured, labelled and judged by hand against its table. The tests of the check's bound, of the debounce and of the held Enter run on a clock the test moves.
12. **The base.** The branch takes master by merge, never by rebase or force-push.
13. **Disk.** If any command fails with "No space left on device": stop, report, delete nothing.

## The sequences that must hold

Each is an act that waits on something. For each: what happens when the person acts in between, and when the awaited thing fails or never comes; and the test that holds it open.

**S1 · A listing and its ignore check** (daemon). Order inside `list`: the open and its confirmation; the names; each entry's own read; the sort and the cut; **the check**; the last confirmation; the answer. *The check fails, is refused by git, or does not answer within its bound:* the listing answers every entry, none marked. *The directory is swapped for a link while the check runs:* the last confirmation refuses the listing, as it does today for a swap after the names were read. *More than four checks are asked at once:* the fifth waits; its bound runs from when it was asked, so a check that waited its whole bound never starts and gives no answer. *The daemon ends while one runs:* the runner's process group dies with it. Tests (M1): a `run` that never settles, the listing answered on the test's clock at the bound; a swap at a new boundary point `before-ignored`; ten checks asked of a `run` that counts how many are live at once.

**S2 · The Changed group across a read** (window). The rows are those of the status the store holds. *A `git.changed` lands:* the rows are replaced in one render; the highlight of the tree's selected row and the scroll offset do not move by it (the list's height changes above them: the offset is corrected by the height the group gained or lost when the first visible row was a tree row). *The watch fails or the folder is no repository:* no group. *The link drops:* the store keeps its status and the group stays. *A row is clicked whose file went since:* the viewer's own answer for a missing file. Tests (M2): a status replaced while the list is scrolled into the tree, the first visible tree row the same before and after; a store entry with an error and no status; an entry whose status stays after a failed refresh.

**S3 · The filter** (window). States: `empty` (no query; the tree is drawn), `waiting(q, shown, held)` (the answer for `q` has not come; `shown` is the earlier answer's rows or nothing; `held` says Enter was pressed for `q`), `answered(q, rows, at)`, `failed(q)`, `offline(q)`.

| event | in | then |
|---|---|---|
| the text changes to a query `q` | any | `waiting(q, the rows drawn now or nothing, held: false)`; the ask goes out 80 ms after the last change |
| the text becomes empty (typing, or Esc) | any | `empty`; nothing is asked; an answer still on its way is dropped when it lands |
| an answer lands for the text and the folder it was asked for | `waiting(q, …)`, the same text and the same working folder | `answered(q, the first 50 files, at: 0)`; and if `held` and there is a row, row 0 opens in the same task |
| an answer lands for another text or another folder | any | dropped |
| the read fails | `waiting(q, …)` for that ask | `failed(q)`; `held` is cleared and nothing opens |
| ↓ or ↑ | `answered` | `at` moves by one and stops at the ends |
| ↓ or ↑ | `waiting` | `held` is cleared; nothing else |
| Enter, no modifier, not composing | `answered` with a row | the row at `at` opens |
| Enter, no modifier, not composing | `waiting` | `held: true` |
| Enter | `empty`, `failed`, `offline`, or `answered` with no row | nothing |
| the field loses the keyboard | `waiting` | `held` is cleared |
| the machine's link becomes offline | any with a query | `offline(q)`; nothing is asked |
| the link leaves offline; ⌘P in `failed(q)`; the working folder changes | any with a query | `waiting(q, nothing, held: false)` and the ask goes out |

*The answer never comes:* the command's own budget ends it as a failure (20 s for `git.lsFiles`), which is the row above. Tests (M3), each on a held answer: B5's two halves in one test (the control is the half that opens); an answer for an older text landing after a newer one; a failure after a held Enter; a composing Enter.

**S4 · ⌘P and the field** (window). The handler shows Files (`showFiles`), marks the tab as finding, records the element that has the keyboard, and makes the request `{ tabId, into: 'filter' }`. The field of that tab takes the request when it draws, or at once when it is drawn already: it takes the keyboard and selects its text. *The person presses a key or a pointer before the field draws:* the request is dropped and the keyboard stays where that act put it. *The tab never draws* (another act hid the column first): the request is dropped by the next key or press, and a later showing of Files takes no keyboard by it. *⌘P twice:* the second request replaces the first; the element recorded for Esc is the first one's, since the field itself is not recorded. Tests (M3): a tab mounted after the request; a key pressed between; two requests.

**S5 · Enter and the file** (window). `openFile` answers the tab; the request `{ tabId, into: 'file' }` is made; finding ends. The tab's file column takes the keyboard when it draws with that file. The editor takes it from the column when it is drawn already, or when it is first drawn while the column itself still has it. *The person clicks or types elsewhere before the editor draws:* the column no longer has the keyboard and the editor takes nothing. *The read fails or the file is a kind with no editor:* the keyboard stays on the column, which is where ⌘S and the comment key look for a file. *The file opened in the main area* (a main tab already shows it): the pane that shows it takes the keyboard. Tests (M3): a viewer whose read is held, the keyboard on the column until it lands and in the editor after; the same with a press in the composer between, the editor not focused (the control is the first case).

**S6 · A folder opened in the tree** (window). `reveal` opens the folder and those above it, selects it, and notes the path. The list scrolls the row into view in the first render in which the row exists, and forgets the note. *The person scrolls (wheel, pointer or key in the list) or selects another row first:* the note is dropped. *A listing above it fails:* its notice row is drawn where the folder would be; the note stays until one of those acts. Tests (M2): the row arriving two listings later; a wheel between.

**S7 · The working folder moves** (window; U8c-2). The watch is keyed on the folder: the hold on the old one is released and one is taken on the new; the Changed group is the new folder's, and empty of rows until its status comes. The filter follows S3's last row. Test (M2, M3): a record whose `agentFolder` changes under a mounted tree and an open filter.

## Probe 8 · the ignore check at size

The child's probe 8, designed here so that M1's executor only runs it. It is a measurement: its numbers are read by a person against the table below, and no test asserts them.

**The question.** Does a `files.list` of a directory of 5,000 entries, with the ignore check, stay inside the command's budget, with room to spare for a slower machine?

**The budget.** `files.list` has no entry in `COMMAND_BUDGETS_MS`, so its caller waits `REQUEST_TIMEOUT_MS`, 10,000 ms, and then reads `timeout`. The measurement is judged against a tenth of it, 1,000 ms: the build VM is a Linux machine with a fast disk and no other session's work in its checkout, and the listing must also hold on a loaded Mac and behind a link to another machine. The product does not depend on the verdict for safety: decision 13 bounds the check at 2,000 ms whatever a repository does.

**What is built.** `src/services/files/ignored.measure.test.ts`, run only when asked, as `named.measure.test.ts` beside it is: `MAWS_IGNORED_MEASURE=1 pnpm exec vitest run src/services/files/ignored.measure.test.ts --testTimeout 600000`. It makes its fixtures with invented names under a temporary folder (`GitFixture`, an empty home), runs a real files service (`createFilesService`) in the test's process with the real check (`ignoredNames(createGitRunner(...))`) and once without the option, prints one line per label, and removes the fixtures. Its only assertions are counts: how many entries came back marked.

| fixture | what it is | what is run |
|---|---|---|
| `mixed` | a repository of 200 folders, each of 100 tracked files and five files a rule names (20,000 tracked files: the size of the index, which the check reads), a root `.gitignore` of 60 patterns, and one more folder of 5,000 entries with a `.gitignore` of its own of 20 patterns: 2,000 tracked files, 2,000 untracked files no rule names, 1,000 that a rule names (700 by an extension, 300 by name) | three listings of the folder to warm up, then 20 one after another, each timed; with the check and without |
| `all-ignored` | a folder of 5,000 entries inside a folder a rule ignores (what an installed dependency tree is) | the same |
| `no-repository` | a folder of 5,000 entries outside any repository | the same |
| `burst` | in the `mixed` repository, its 200 folders (105 entries each, five of them ignored) listed at once, which is what a tree restored after a relaunch can ask | the whole burst timed, three times: with the check, with the check and no limit on how many run at once, and without it; each with the most git processes alive at once |

**What is printed**, one line each: `probe8.<fixture>.<with|without>.median_ms`, `.max_ms`, `probe8.<fixture>.marked` (the count of entries answered `ignored`, per listing), for `burst` also `probe8.burst.<with|unbounded|without>.total_ms`, `probe8.burst.<with|unbounded>.listings_marked` (how many of the 200 listings carried their marks) and `.live_max` (the most checks alive at once); and once `probe8.machine`: the processor count, the memory, the kernel, `git --version` and Node's version, as the run reads them.

**The verdict**, applied by the executor to the printed numbers:

| holds when | a miss means |
|---|---|
| `mixed`, `all-ignored` and `no-repository`: `with.max_ms` ≤ 1,000 | the check makes a large folder slow to open: **stop** |
| `mixed.marked` is 1,000 and `all-ignored.marked` is 5,000 in every timed listing | the check did not finish inside its own bound at this size, so large folders would stay undimmed: **stop** |
| `burst.with.total_ms` ≤ 5,000 and `burst.with.listings_marked` is 200 | the queue of four starves a restored tree: **stop** |
| (recorded, not judged) `burst.unbounded` beside `burst.with` | the limit of four is a cause read from the code; these two lines are its measurement. If the unbounded burst is no slower and no heavier, the architect may rule the limit away: one constant |

On a pass the numbers, the machine line and the commit go into Surprises & Discoveries as a measured bound ("measured on the wave's build VM, <the machine line>; a miss would have meant …"), and M2 starts on the architect's word. On a miss the executor writes the same and stops; it does not tune the constants and builds no fallback.

**The fallback's shape, if the architect rules it** (the child's "the check runs only for the entries on screen"). `files.list` stops carrying `ignored`. A new read of the daemon's, `files.ignored { appSessionId, path, names }` answering `{ ignored: string[] }`, runs the same check for at most 200 names of one directory under the same boundary as a listing of it; the window asks it for the rows its virtual list draws, after the listing has come, and keeps the answer with the listing. A daemon of an older build answers `unknown_command` and nothing is dimmed. It changes Interfaces §A and §B, M1's schema commit and decision 14, and nothing of M3. It is a larger landing (a command, its offer to another machine, a store of answers per directory) and is not built from this document as it stands.

## Plan of Work

Four milestones, in order: each later one draws into what the one before made, and M2 and M3 edit the same component. M1 ends with a stop for probe 8's verdict. The constraints above bind each; a milestone restates nothing of the design and points at it.

### M1 — The daemon: the ignore check, probe 8, a submodule's mark, the wire's minor

**What exists at its end.** A `files.list` of a directory answers `ignored: true` on the entries git ignores there, and is what it was in every other respect; a status entry that is a submodule carries `submodule: true`; the wire stands at its stand-in minor with its manifest; probe 8's numbers and verdict are written down. Nothing in the window reads either field yet.

**What it touches.** `src/services/files/ignored.ts` (new) and its test; `src/services/files/service.ts` (`list`, `FilesServiceOptions`, `BoundaryPoint`) and `service.test.ts`; `src/services/files/register.ts` (one option passed through); `src/services/checkouts-root.ts` (the option given); `src/services/files/ignored.measure.test.ts` (new); `src/shared/ipc/schema/files.ts` and `schema/git.ts` (one key each); `src/services/git/porcelain.ts` and its test; `src/shared/ipc/wire.ts`, `wire-manifest.json` and `wire-fingerprint.json`; `test/cross-build/files-schema.test.ts` and a new `test/cross-build/git-status-schema.test.ts`.

**Interfaces.** Exposes §A and §B. Consumes `createGitRunner` and its `GitRun` (`src/services/git/runner.ts`), unedited.

**Decisions of this milestone alone.**

1. *The order.* The tests first, failing where they assert the new keys; then the modules; then the wire's minor as one commit of its own (Concrete Steps 4); then the measurement on the head that holds all of it.
2. *The check is handed to the service, not imported by it.* `createFilesService` takes `ignored?: (dir, names) => Promise<ReadonlySet<string> | null>` and `checkouts-root.ts` gives it `ignoredNames(createGitRunner())`. The service stays a module that starts no process of its own, and its tests give it a function. Without the option nothing is asked and nothing is marked, which is what every existing test of the service runs.
3. *Inside `list`* the sort and the cut move before the check (they need nothing the last confirmation gives), a new boundary point `before-ignored` stands between the entries' reads and the check for the tests' swap, and the last confirmation follows the check. The answer marks only names that were asked: a name the check's answer holds and the listing does not is dropped.
4. *The bound* is one deadline per check, taken when it is asked: the wait for one of the four places and the run share it. `ignoredNames` answers at the deadline whether or not git has ended (it does not wait for the runner's kill), and frees its place when the run really ends, so no more than four git processes of the check are alive.
5. *The `./` prefix is shown to matter, or said not to.* The real-repository test first asks the bare names and records what git answers for a name that begins with `:` and one that begins with `-`; the finding goes into Surprises & Discoveries. The prefix stays either way: it costs nothing and makes the answer independent of how a git build reads such a name.
6. *The log.* A check with no answer writes no path. Not a repository is silent. Any other reason writes one line to the daemon's log the first time that reason occurs in the daemon's run, naming the reason and no folder.
7. *A submodule* is a porcelain v2 record of type `1`, `2` or `u` whose third field begins with `S`; `parseStatus` adds `submodule: true` to it and to no other. The worktree service's own status read (`worktrees.ts`) goes through the same parser, and an added key changes nothing it reads.
8. *The older builds, at the schema.* `test/cross-build/files-schema.test.ts` already holds both builds' `schema/files.ts` as committed snapshots; it gains: this build's `files.list` answer with marked entries, read with the tolerant reader by each peer's schema, is the answer less exactly those keys; each peer's answer parses under this build's schema. The status entry has the same five fields in both builds (`git show <build>:src/shared/ipc/schema/git.ts`), so `git-status-schema.test.ts` holds that one schema copied literally and asserts the same two things for `git.status`'s answer and for `git.changed`.
9. *What else compiles these files.* The desk's web app compiles `src/shared/ipc/schema/files.ts`, `schema.ts` and `wire.ts` transitively (U6b-2's Decision Log 22) and reads `tools/code/review/review-model.ts`, which takes its types from `schema/git.ts`: this milestone's proof adds that package's typecheck, build and test project.

**What it does not touch.** The window. `git.lsFiles`. What `git.watch` watches or when it emits. The endpoint and its offers. `COMMAND_BUDGETS_MS`: `files.list` keeps the default.

**What it proves.** B10's unit half, B11, B12's wire half, S1. Behaviours its tests pin, each with its control where it asserts an absence:

- over a real repository: a file a pattern names, a folder a rule names, and an entry of an ignored folder asked in that folder are answered; a tracked file that matches a pattern is not, beside its untracked twin that is; a name that begins with `:` and one that begins with `-` are answered when a pattern names them; a folder of a nested repository is judged by that repository's rules, not the outer one's; nothing ignored is an empty set and not "no answer"; outside a repository there is no answer;
- the bound: a run that never settles gives no answer when the test's clock reaches the bound, and the listing that asked answers all its entries; ten checks asked at once never have more than four runs alive; a check that waited its whole bound never starts its run;
- the listing: `ignored: true` on exactly the names the function answered and on no other entry, and no entry carries the key when it answers nothing, when it is absent, and for the roots; the function is called with the directory's confirmed real path and the names the answer carries, at most 5,000; a directory swapped at `before-ignored` is refused; a listing with nothing ignored deep-equals what the service answered before;
- the parser: `submodule: true` on a submodule's record of each of the three types, and no key on an ordinary record in the same output;
- the wire: the manifest at the new minor holds both keys, and the two cross-build suites pass.

### M2 — The window: the Changed group, the marks, the dimmed entries

**What exists at its end.** With changes in a session's working folder, the tree column shows the Changed group above the tree, each row opens what decision 6 says, the tree's rows carry letters and dots, and ignored entries are muted; all of it follows the disk with no act. Acceptance B1, B2 and B9 hold in unit tests; the field and ⌘P do not exist yet.

**What it touches.** `src/renderer/src/tools/code/files/changed.ts` (new) and its test; `files/FilesTool.tsx`; `files/tree.ts` (two row kinds); `files/tree-state.ts` (the note of a folder to show) and its test; `files/store.ts` (decision 14's rule) and its tests in `files.test.tsx`; `src/renderer/src/tools/code/copy.ts`.

**Interfaces.** Exposes §C. Consumes §A's two keys; `useGit` (`stores/git.ts`), `checkoutKey` and `machineFor` (`ipc/machine.ts`); `useWorkingFolder`; `openFile`; `panelHost.addTool`; from Review, by import and with no edit, `unmerged` (`review/review-model.ts`) and `REVIEW_COPY.kinds` and `.renamedFrom`.

**Decisions of this milestone alone.**

1. *The hold on the git store* is the drawn tree's (`SessionTree`): taken with the session's machine, the working folder's path and the session, released on unmount or when any of the three changes. A tab whose tree is folded away holds none.
2. *The rows.* The list's rows are the Changed section's followed by the tree's; `rowsOf` is not edited. The section's keys are distinct from every tree row's key for the same path. The heading is a `treeitem` of level 1 and its rows of level 2, so the list stays one tree for a screen reader.
3. *A mark is looked up, not stored on a row:* `marksOf(rows)` answers a letter for a path and a dot for a folder from maps keyed on a path's normal form (lower case, the `/private` spelling folded), built once per status.
4. *The scroll offset under a changing group* (S2): the adjustment is made in the layout effect that follows the change of the section's row count, and only when the first row in view was a tree row. The jump is a cause read from the code, and a test can run it: its case is written first and shown failing (the first row in view moves when the group grows) before the adjustment is built.
5. *`.gitignore`* (decision 14) is read from the event's path in `applyChanged`; the lists it starts go through `list`, which already keeps one flight per directory.
6. *The muted name* is one class on the name's element and leaves the row's hover and selection as they are.
7. *`copy.ts` is compiled by the desk's web app* (it reads `REVIEW_COPY`): the proof adds that package's typecheck, build and test project, although the edit only adds keys to `FILES_COPY`.

**What it does not touch.** The field, the list of results, the keymap and the menu (M3). `stores/git.ts`, Review's files, the summary card. The services. What a tab stores.

**What it proves.** B1, B2, B9 (the group, the marks and the dimming; the filter's half is M3's), S2, S6, S7's first half. Behaviours its tests pin: the letter and "on disk" for every XY pair of decision 4, two entries on one path, the order; a click of each kind of row (the file opened in the preview tab, Review added with the session, the scope and the relative path, the folder opened and selected); a folder outside every root does nothing while the same test's folder inside one opens; the letters on tree rows matched across the `/private` spelling and across case; `U` beneath an untracked folder; the dot's colour by the order of decision 10; no group and no mark for an entry with no status, beside the same tree with a status that makes one; the status kept after a failed refresh; the tree's first visible row unmoved by a group that grows; a `.gitignore` event listing again the listings beneath it and no other; `ignored` muting a name, and an answer without the key muting none in the same listing; the tokens guard.

### M3 — Go to file: the action, the filter, the keyboard

**What exists at its end.** ⌘P, Go ▸ "Go to file", and the palette's row put the keyboard in a field above the tree; a query replaces the tree with the ranked files; the keys do what decision 19 says; a folded tree is shown for the search. Acceptance B4 to B8 hold in unit tests.

**What it touches.** `src/shared/keymap/actions.ts` and `actions.test.ts`; `src/main/menu.ts` and `menu.test.ts`; `src/renderer/src/tools/code/files/finder.ts` (new) and its test; `files/Finder.tsx` (new) and its test; `files/tree-state.ts` (the filter's text, the finding tab, `treePlace`) and its test; `files/FilesTool.tsx` (the field above the tree, the list in the tree's place, the file's column); `tools/code/viewer/CodeView.tsx` (the editor takes the keyboard from the column); `tools/code/editor/register.ts` (one connection beside `connectOpenFile`); `copy.ts`; the keymap's other tests where they list every row.

**Interfaces.** Exposes §D. Consumes §C; `showFiles` (`files/tabs.ts`); `surfaceSession` (`panel/surface-model.ts`); `useLayout`'s `closeDestination`, `settings` and `overviewOpen`; `registerAction` (`keymap/actions-runtime.ts`); `useRemoteStanding` and `disabledWords` (U9); `pathTarget`; `focusPaneElement` (`main/pane-dom.ts`).

**Decisions of this milestone alone.**

1. *The row* stands in `ACTIONS` directly after `palette.open`: `'files.goToFile': { title: 'Go to file', chord: 'Cmd+P', sink: 'menu', menu: 'go', scope: 'app' }`. `GROUP_OF_PREFIX` gains `files: 'palette'`, so no separator falls between the two; `SHELL_FOCUS_ACTIONS` gains the id. `LANDED` in `actions.test.ts` gains it. It is not in `BUILD_F_ACTION_IDS` and that file is not edited.
2. *The handler* (`goToFile`) in this order: read the side column's session; leave an open page; record the element that has the keyboard, unless it is the document's body or a filter field; `showFiles`; mark the tab as finding; make the request for the filter. `connectGoToFile` registers it while `canGoToFile(state)` holds and removes it otherwise, following the layout store as `connectOpenFile` does.
3. *The request for the keyboard* is module state of `finder.ts`, one at most. Its drop is a pair of one-shot capture listeners on the window for `keydown` and `pointerdown`, set when the request is made and removed when it is taken or dropped. The menu's own key reaches the page before the action does, so the listeners never see the ⌘P that made the request.
4. *The field* is an `<input>` with `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`; the list is a `listbox` of `option` rows. Its key handler acts on Enter, Esc and the two arrows only, never on a ⌘ key (root UC-6), and on none of them while `isComposing` is set or the key code is 229.
5. *The search* is one hook (`useFinder`) that owns S3's states. Each ask carries the text and the folder it was made for, and an answer is taken only when both are still current. The 80 ms wait and a held answer are driven in tests by a clock and a bridge the test holds.
6. *The file's column* (`[data-file-column]`) becomes focusable (`tabIndex={-1}`, no ring of its own beyond the app's focus outline) and takes a request made for its tab's file. `CodeView`, when its editor is made, takes the keyboard if the column that holds it is the document's active element; the column, when it takes a request and an editor is already drawn in it, hands the keyboard on at once.
7. *The tree's button* in a file's bar ends finding before it does what it did.
8. *The field stands outside the tree's context menu.* `FilesMenu` wraps the tree's list so that a right-click there offers "Open File…" (U6e); the field is drawn above that trigger, so a right-click in it is a text field's own menu.

**What it does not touch.** `git.lsFiles` and its ranking. The palette's own list. The panel host's focus request and what ⇧⌘F does with the keyboard (U6b-5). The Settings ▸ Keyboard section's code: a row that is not rebindable already draws no control.

**What it proves.** B4 to B8 in unit tests, A13, S3, S4, S5, S7's second half. Behaviours its tests pin: `parseQuery` for a plain name, `name:42`, `name:42:7`, `:42` alone, `name:0` and a 300-character text; folders dropped from an answer and the cut at 50, with an answer of 200 paths of which 60 are files; every row of S3's table, the held Enter in both halves; a composing Enter that opens nothing beside a plain one that does; Esc's two steps and what it gives the keyboard back to; a second ⌘P selecting the text; the offline line with a machine's name and no ask sent, beside the same hook asking when the phase is up; the request taken by a field mounted later, dropped by a key between, replaced by a second; the column and the editor in S5's two cases; `treePlace` with `finding` at a roomy and a narrow width, and the stored fold not written (the store's write spied, beside a press of the tree's button that does write); the menu's Go submenu with "Go to file" directly after "Command palette"; `canGoToFile` false with no session, with the Settings dialog and with the Overview, true with a page open, and the page closed by the handler; `effectiveChord('files.goToFile', …)` null under another action's stored ⌘P; the tokens guard.

### M4 — The scenes, the cross-build row, the record, and the acceptance run

**What exists at its end.** The scenes of B1 to B8 and B10 are written and typechecked, the cross-build coverage table has this landing's row, the tracker and the register say what landed, and the whole unit suite has run once on the final head.

**What it touches.** `e2e/code-tools.spec.ts`, `e2e/ux2-shell.spec.ts`, `e2e/browser.spec.ts`, `e2e/remote.spec.ts`, `e2e/cross-build.spec.ts` (Interfaces §G names each scene and what it waits on); `docs/tech-debt-tracker.md`; `docs/doperpowers/evidence/ux-wave-2026-11/register.md` (the row of l5-code-09); this document's Progress and record.

**Interfaces.** Consumes the markers of §C and §D. Exposes nothing.

**Decisions of this milestone alone.**

1. *A scene waits on what it then reads.* Each scene's description in §G says what it waits on: a row's presence by its marker, the field being the active element, a tab's marker for the file. No scene reads a count, a position or the keyboard's place after an act it did not wait for, and none sleeps.
2. *No scene asserts a time.* B3's "with no act" is a wait on the row, under the scene's ordinary timeout.
3. *The cross-build scene* is one, "(ignored marks, both ways)", written so that it runs against every peer the gate uses and skips for none: build F, build M, master at `b89d6d1d7` and the master this landing merges into all lack the key. A half that cannot run against a peer (this build's daemon refusing that peer's hello) is written into the table as "not run: <the reason>" for that peer.
4. *The tracker* gains rows for what this landing leaves: R7's limit, R9's edge, and whatever the reviews defer.
5. *The acceptance run* is Concrete Steps 8.

**What it does not touch.** Product code. A scene that fails to typecheck against M2's or M3's markers is fixed in the scene; a product fault a scene's writing exposes goes back to its milestone's executor through the controller.

**What it proves.** That the scenes compile and the gate's own script tests pass over them; B12 whole; and the last unit run. The scenes themselves prove B1 to B8 and B10 when the architect runs them.

## Concrete Steps

Working directory for every command: the branch's worktree (the controller's brief names it). The VM sees only what is pushed. `vmcheck.sh` prints `vmcheck: ux-wave/U6b-3 at <short sha>`, then the command's own output, and exits with the command's status; do not pipe it into `tail` or `head` without `set -o pipefail`. Below, `vmcheck` stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b-3 --`. Its first call for the branch installs dependencies and can take twenty minutes. The remote command runs under `set -euo pipefail`: begin it with `set +e;` when every part's result is wanted. The VM is shared: a check that is slow is read against its load first. Every command there runs under `timeout <seconds>`.

**The order, with its stop.** M1; **stop** (step 5): probe 8's numbers and verdict go to the architect, and M2 starts on the architect's word, which also carries the owner's look at the drawn example. Then M2, M3, M4, and the stop of step 9.

1. **Before each milestone:**

       git fetch origin master && git merge origin/master
       git push origin ux-wave/U6b-3

   A merge, never a rebase or a force-push. After a merge that brought changes, run the previous milestone's proof again (the same set, not the whole suite), and read "Statements to check again" against what arrived.

2. **The tests before the modules** (M1 to M3). Commit the cases of the milestone's "What it proves" with the new exports naming nothing; push; run them; the cases that assert the new behaviour fail and those that assert what stays pass. Then build.

3. **While building**, after each push:

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 pnpm exec eslint <the paths changed>'
       vmcheck 'timeout 900 pnpm exec vitest run <the test files touched>'

   The node project for M1 and for M3's edits of `src/shared/keymap` and `src/main`; the web project for M2, M3 and any milestone that edits `src/shared/`. A filter given to vitest is a substring of file paths: give paths, never a bare word.

4. **The wire's minor, one commit** (M1). With the schema's commit pushed and `N` the tree's number plus one (55 at the pin), the number is applied on the VM's checkout alone, the files are generated there, their diff is brought back and the VM's checkout restored:

       vmcheck 'sed -i "s/WIRE_MINOR: number = [0-9]*;/WIRE_MINOR: number = N;/" src/shared/ipc/wire.ts; pnpm wire:manifest >/dev/null || true; git diff -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json; git checkout -q -- src/shared/ipc/wire.ts src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json' | sed 1d > "$TMPDIR/u6b3-wire.patch"
       git apply "$TMPDIR/u6b3-wire.patch"

   Read the patch before applying it: it holds `ignored` under `files.list`'s entries, `submodule` wherever a status is answered or sent (`git.status`, `git.watch`, `git.changed`, and the `scm` answers that carry a status), the number, and nothing else. The fingerprint covers the engine host's commands alone and is expected unchanged; if the patch changes it, stop and report. Then, in the worktree, the number and its note ("the UX wave's U6b-3: files.list's entries' ignored, a status entry's submodule") are written into `src/shared/ipc/wire.ts`, and the number and the manifest are committed once, with nothing else, and pushed; `vmcheck 'timeout 600 pnpm exec vitest run src/shared/ipc/wire.test.ts src/shared/ipc/wire-fingerprint.test.ts'` then passes. **The number is a stand-in:** the chain's minors are taken in landing order, and the chain's merge takes this one again by the same step.

5. **Probe 8, and the stop** (M1's last step), on the head that holds the check and the wire's commit:

       vmcheck 'timeout 1500 env MAWS_IGNORED_MEASURE=1 pnpm exec vitest run src/services/files/ignored.measure.test.ts --testTimeout 600000'

   Expected: the `probe8.*` lines of "Probe 8", and the file passing (its assertions are the counts). Apply the verdict's table. Write the lines, the verdict and the commit into Surprises & Discoveries, push, and **stop**: the controller gives the architect the numbers. A miss is a stop for a ruling, not a thing to build around.

6. **Each milestone's proof** is the typecheck of the projects it changed, eslint on its changed files, and vitest over the folders it touched and those that import what it changed:

   - M1: `src/services/files src/services/git src/shared/ipc src/shared/machine src/main/lane-b test/cross-build test/endpoint/checkout-rows.test.ts test/lane-b/offer-coverage.test.ts`
   - M2: `src/renderer/src/tools/code src/renderer/src/tools/scm src/renderer/src/stores src/renderer/src/panel test/support/tokens-guard.test.ts test/one-working-folder.test.ts`
   - M3: `src/shared/keymap src/main/menu.test.ts src/renderer/src/tools/code src/renderer/src/keymap src/renderer/src/palette src/renderer/src/settings-tab src/renderer/src/app test/support/tokens-guard.test.ts`

   as `vmcheck 'timeout 1800 pnpm exec vitest run <the list>'`. Expected: every file passes but those the build brief lists as failing on master on the VM too (`src/shared/machine/git-reads.test.ts` among M1's). In every milestone, list the importers outside the project changed (`grep -rlE "src/(renderer|shared|services|artifacts)/" apps/*/src | xargs grep -lE "<the file's path without extension>"`, followed through the files it names until no new one appears). Known at authoring: the desk's web app reads `tools/code/copy.ts` and `tools/code/review/review-model.ts` directly, and compiles `src/shared/ipc/schema/files.ts`, `schema/git.ts`, `schema.ts` and `wire.ts` through them. So M1, M2 and M3 each add

       vmcheck 'timeout 900 pnpm --filter desk-web typecheck'
       vmcheck 'timeout 900 pnpm --filter desk-web build'
       vmcheck 'timeout 900 pnpm exec vitest run --project desk-web'

   to their proof. M1 also runs `vmcheck 'timeout 600 node --test .github/scripts/maws-app-scan.test.mjs'` if it adds any recorded file (the two cross-build suites add none: their peers' snapshots are already committed).

7. **A scene is typechecked, not run** (M4):

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 pnpm exec eslint e2e/code-tools.spec.ts e2e/ux2-shell.spec.ts e2e/browser.spec.ts e2e/remote.spec.ts e2e/cross-build.spec.ts'
       vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

   The third is the gate's own script tests, text guards over the scene files and the group lists: they read an `expect(<a time>).toBeLessThan(<a number>)` as a raw time bound, and a name that ends in `At` or `Ms` counts as a time. No scene of this landing has such a line.

8. **The acceptance run** (M4's last step), on the pushed head, after a last merge of master:

       vmcheck 'timeout 2400 pnpm typecheck'
       vmcheck 'timeout 1800 pnpm lint'
       vmcheck 'timeout 3600 pnpm test'
       vmcheck 'timeout 600 pnpm exec vitest run src/shared/machine'

   Expected: each exits 0, apart from the files the build brief lists as failing or timing out on the VM, each of which is shown to pass alone (`pnpm exec vitest run <file> --testTimeout 60000`) or to fail on master there; vitest's summary names no other failed file. The whole unit suite runs this once, by M4's executor, and by no earlier milestone. Against these runs: B5, B9, B11's unit half and B12 are the suites as each milestone's "What it proves" names them; B1 to B4, B6 to B8 and B10 have a unit half there and a scene that is the architect's.

9. **Stop and hand back.** M4's executor writes into Progress what ran and what is left, pushes, and stops. Class 1a (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b-3`), the Mac lane's unit cases, the branch review, the e2e runs and the pull request are the architect's.

## Interfaces and Dependencies

### §A. The ignore check and the two keys (M1)

    // src/shared/ipc/schema/files.ts
    FilesEntrySchema    += ignored: z.literal(true).optional()     // git ignores the entry; sent only when true; never on a root

    // src/shared/ipc/schema/git.ts
    GitFileStatusSchema += submodule: z.literal(true).optional()   // the entry is a submodule (porcelain v2's `sub` begins with S); sent only when true

    // src/services/files/ignored.ts (new)
    export const IGNORED_CHECK_MS = 2_000;          // one check's whole allowance, its wait for a place included
    export const IGNORED_CHECK_CONCURRENCY = 4;     // checks running at once in one daemon
    // The names among `names` that git ignores in `dir`, or null when git gives no answer within the allowance.
    // One `git check-ignore -z --stdin` in `dir`, read mode, each name sent as `./<name>`, exit code 1 an empty set.
    export function ignoredNames(run: GitRun, options?: { concurrency?: number; allowanceMs?: number }): (dir: string, names: readonly string[]) => Promise<ReadonlySet<string> | null>;
    // `options`: the tests' and the measurement's; the product passes none

    // src/services/files/service.ts
    FilesServiceOptions += ignored?: (dir: string, names: readonly string[]) => Promise<ReadonlySet<string> | null>;
    BoundaryPoint       += 'before-ignored'         // tests: between the entries' reads and the check

    // src/services/files/register.ts: FilesHandlerDeps += ignored?: FilesServiceOptions['ignored']
    // src/services/checkouts-root.ts: registerFilesHandlers(..., { ..., ignored: ignoredNames(createGitRunner()) })

### §B. What is stored and sent, and what each older build does with it

**Stored:** nothing. No layout key is added and `files.tree` keeps its shape and version; the filter's text, the finding tab and the note of a folder to show last for the run. No rebinding of `files.goToFile` can be stored (`isRebindable`), so neither settings file ever holds the id.

**Sent:** the two keys of §A, in answers and in one event. No input changes, no command is added, and the window sends `git.watch`, `git.lsFiles` and `files.list` as both older builds know them.

| who sends, who reads | build M (`2c7044231`, minor 46) | build F (`f1852de3a`, minor 33) |
|---|---|---|
| **an older daemon answers this build's window** (this Mac's daemon in the moments before the app's build check replaces it, a daemon kept as a LaunchAgent, another machine not yet updated) | its `files.list` carries no `ignored`: the tree lists and nothing is dimmed. Its status carries no `submodule`: a changed submodule's row is a file's row, and its tab shows the files service's error for a folder. `git.watch`, `git.changed` and `git.lsFiles` are served as this build asks them | the same: both builds have the same six fields on an entry, the same five on a status entry, and the three commands |
| **this build's daemon answers an older app** (the profile taken back to the older build while this build's daemon still runs; an older app reading a session of this machine) | its main reads the answer with the tolerant reader (`host-supervisor.ts` for its own daemon, `machines/socket-link.ts`, `machines/remote/dispatch.ts` for another machine's) and drops `ignored` from each entry that has it and `submodule` from each status entry; its window receives the listing and the status its build knows. One log line per kind of dropped key, the array's index folded | the same code at the same three places |
| **this build's daemon sends `git.changed` to an older app** | read by the tolerant event reader (`host-supervisor.ts`, `machines/socket-link.ts`, `lane-b/remote-checkout.ts`): `submodule` dropped, the event kept | the same |
| **an older window on this build's daemon presses its own keys** | it has no `files.goToFile`; nothing of this landing is reachable from it | the same |
| **a run of this build, then the older build, then this build** on one profile | nothing is stored, so nothing is carried: the older build draws its Files tree with no group and no marks, and this build draws them again from the next status | the same; build F draws its one Files surface |
| **the settings files** | not written by this landing; the action's id never enters `keymap` | the same, which is what keeps build F's strict reader whole (root UC-14) |

The manifest gains `ignored` on the entries of `files.list`'s output and `submodule` on a status entry wherever a status is answered or sent. Both are new optional properties of object schemas, which the wire's rule takes as a minor (`src/shared/ipc/wire.ts`). The wire's minor is a stand-in, one above the chain's at the pin (55 above 54), in a commit of its own, taken again at the chain's merge.

**The cross-build scene** is §G's last. **Its row** in the coverage table of `e2e/cross-build.spec.ts` (U13a's block), in the table's own columns:

    | U6b-3: nothing stored. On the wire,           | (ignored marks, both ways): on the peer's `mawsd` this | the second half: the peer's app on this build's    |
    | `files.list`'s entries' `ignored` and a       | build's window draws the tree with nothing dimmed and  | `mawsd` lists a folder that holds an ignored entry |
    | status entry's `submodule`                    | the Changed group from the peer's status               | and a submodule, draws every entry, and refuses    |
    |                                               |                                                        | no answer. Where this build's `mawsd` refuses the  |
    |                                               |                                                        | peer's hello: "not run: <reason>", held by         |
    |                                               |                                                        | test/cross-build/files-schema.test.ts              |

**The cross-build runs owed** (the wave's rule for a landing that takes a wire minor): `e2e:cross-build` with `--peer-exact f1852de3a` and with `--peer-exact 2c7044231`, and against the two masters the gate also crosses, `b89d6d1d7` and the master this landing merges into. The scene must **pass, not skip**, against all four: none of them has either key, so nothing excuses a skip. Each on the final head or on the last head that changed anything of M1's or M2's. The architect's.

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

    // src/renderer/src/tools/code/files/tree.ts
    TreeRow |= { kind: 'changed-heading'; key: string; count: number }
             | { kind: 'changed'; key: string; row: ChangedRow }

    // src/renderer/src/tools/code/files/tree-state.ts: SessionTree, this run's only
    reveal: string | null;                                       // a folder to scroll into view once (S6)
    revealIn(appSessionId: AppSessionId, path: string, ancestors: readonly string[]): void;   // opens them (stored, as the person's toggles), selects, notes
    revealed(appSessionId: AppSessionId): void;                  // the note dropped: shown, or the person scrolled or selected

    // a deleted row's open (decision 6), as the code takes it:
    panelHost.addTool('review', { appSessionId, params: { scope: 'uncommitted', path: row.rel } });

**The markers** the tests and the scenes read: `[data-files-changed]` on the heading with `data-count`; `[data-changed-row]` on a row with `data-path` (absolute) and `data-letter`; on a tree row, beside today's `data-path` and `data-kind`, `data-letter`, `data-dot` (the dot's letter) and `data-ignored`.

### §D. Go to file (M3)

    // src/shared/keymap/actions.ts, directly after 'palette.open'
    'files.goToFile': { title: 'Go to file', chord: 'Cmd+P', sink: 'menu', menu: 'go', scope: 'app' },
    // src/main/menu.ts: GROUP_OF_PREFIX += files: 'palette'; SHELL_FOCUS_ACTIONS += 'files.goToFile'

    // src/renderer/src/tools/code/files/finder.ts (new)
    export const FINDER_ASK = 200;           // git.lsFiles' limit, the command's most
    export const FINDER_LIMIT = 50;          // the files shown
    export const FINDER_WAIT_MS = 80;        // after the last keystroke, the `@` menu's
    export function parseQuery(text: string): { query: string; line: number | null };   // decision 17
    export function canGoToFile(state: LayoutState): boolean;                          // decision 24 (R5): a session for the side column, no Settings dialog, no Overview
    export function goToFile(): void;        // the handler
    export function connectGoToFile(): () => void;   // keeps the action registered while `canGoToFile` holds
    export function requestKeyboard(request: { tabId: string; into: 'filter' | 'file' }): void;   // decision 23
    export function takeKeyboard(tabId: string, into: 'filter' | 'file'): boolean;     // true once, for the tab it was made for
    export type FinderState =                                                           // S3
      | { status: 'empty' }
      | { status: 'waiting'; query: string; shown: readonly string[] | null; held: boolean }
      | { status: 'answered'; query: string; rows: readonly string[]; at: number }
      | { status: 'failed'; query: string }
      | { status: 'offline'; query: string; words: string };
    export function useFinder(appSessionId: AppSessionId, directory: string | null, text: string): {
      state: FinderState;
      onKey(event: KeyboardEvent<HTMLInputElement>): void;                      // decision 19
      choose(index: number, how: { keep: boolean; main: boolean }): void;       // a row opened: Enter keeps; a click as decision 20
    };

    // src/renderer/src/tools/code/files/tree-state.ts: SessionTree, this run's only
    filter: string;                          // the field's text, the session's
    finding: string | null;                  // the tab ⌘P chose, while the search lasts (decision 22)
    treePlace(input): TreePlace;             // today's five inputs, and `finding: boolean`
      // holdsFile false: 'alone'. Room for both: finding ? 'beside' : folded ? 'folded' : 'beside'. No room: finding || shown ? 'instead' : 'folded'.

**The markers:** `[data-files-filter]` on the field; `[data-files-results]` on the list, with `aria-busy` while an earlier answer is drawn; `[data-files-result]` on a row with `data-path` (absolute); `[data-file-column]` on a tab's file column.

### §E. What this landing consumes, and what a later landing may rely on

**Consumes, by the name each is exposed under:** from U6b-1, `showFiles`, `openFile` with `keep` and its `Opened`, the tree column and `treePlace`, `useTreeState`; from U8a and U8c-2, `useWorkingFolder` and `workingFolder`'s `path`; from U8b, `surfaceSession` and the side column's showing of a tab; from U7b, `closeDestination` and the dialog's and the Overview's state in the layout store (root UC-12); from U6a, the action table's shape, `effectiveChord`, `isRebindable` and the rule that a new id takes no rebinding; from U6e, the pattern of `connectOpenFile` and the peers' schema snapshots under `test/cross-build/`; from U9, `useRemoteStanding`, `disabledWords` and the link's phases; from U5b, `unmerged`, `REVIEW_COPY.kinds` and `.renamedFrom`, and Review's `{ scope, path }` params; from U13a, the cross-build coverage table. Nothing of U6b-2's is consumed: a framed file's tab is a Files tab like any other.

**A later landing may rely on:** `[data-file-column]` being focusable and where a file beside the chat holds the keyboard, and `requestKeyboard` for a tab drawn later (U6b-5's question of what ⇧⌘F focuses can use both); `FilesEntry.ignored` and `GitFileStatus.submodule`; `changedRows` and `marksOf` for any other list of a session's changes; `goToFile` as the one way to the field.

### §F. Files other children own, or no child owns (root UC-8)

| file | owner | this landing's insertion |
|---|---|---|
| `src/services/files/service.ts`, `register.ts`; `src/services/checkouts-root.ts` | no child (the cut's X8 names the listing's `ignored`) | the option, its call in `list`, one boundary point; one option passed; one option given. `ignored.ts` is new there |
| `src/services/git/porcelain.ts` | no child | one key on a submodule's entry (R2) |
| `src/shared/ipc/schema/files.ts`, `schema/git.ts` | no child for the wire's schemas | one optional key each |
| `src/shared/ipc/wire.ts` and the two generated files | no child | the minor, in a commit of its own |
| `e2e/cross-build.spec.ts` | the P5 work, U13a's block for the table | one scene and one row |
| `e2e/remote.spec.ts`, `e2e/browser.spec.ts` | the P5 work; U12 | one scene each |
| `test/cross-build/` | U6 (U6e made it) | cases in one suite, one new suite |
| `docs/tech-debt-tracker.md`, the register | the wave's record | rows |

Read and not edited: `src/renderer/src/stores/git.ts`; `tools/code/review/review-model.ts` and Review's part of `copy.ts` (U5); `src/shared/ipc/remote-unavailable.ts` and `lane-b/remote-standing.ts` (U9); `panel/` (U8); `stores/layout.ts` (U13); `src/services/git/ls-files.ts`, `runner.ts` and `ignored.ts`; `src/shared/keymap/build-f.ts`. Everything else this landing edits is U6's by the root's table: `tools/code/files/`, `tools/code/viewer/`, `tools/code/editor/register.ts`, `src/shared/keymap/`, `src/main/menu.ts`, and the Files part of `tools/code/copy.ts`.

### §G. The e2e groups whose scenes cross this change

Written in M4, typechecked there, run by the architect on a Mac. Each scene triggers Go to file by the menu row's own click (`e2e/support/menu.ts`), which is what its accelerator does, and reads the accelerator from the menu. Every repository a scene uses is made by the scene with invented names.

| group | file | the scene, and what it waits on before it reads |
|---|---|---|
| `e2e:code` | `e2e/code-tools.spec.ts`, a new block "UX wave U6b-3" over a scratch repository | **G1** "the Changed group lists a modified, an added, an untracked, a deleted, a renamed and a conflicted file and an untracked folder with their letters; a click opens each where it should; the tree carries the letters, the dots and the muted entries". Waits on the heading with `data-count="7"` before it reads a row; on the file's tab marker after each open; on Review's section for the path after the deleted row; on the folder's tree row being selected after the folder's row |
| | | **G2** "the group and the dimming follow the disk". Writes a file from the test's process and waits on its row; restores it and waits on the row's absence while another row is still there (the control); appends a line to `.gitignore` and waits on `data-ignored` on the row it names |
| | | **G3** "Go to file from the composer: the field has the keyboard; a name lists files; ↓ and Enter open the second as a kept tab with the keyboard in the file; `name:line` lands on the line; Esc twice returns the tree and the keyboard". Waits on the field being the active element; on the list not busy and holding the expected row; on the file's tab marker and the editor being the active element; on the line's witness the existing "jumps to the line" scene uses; on the tree's list being drawn again before it compares the offset read before ⌘P; on the composer's editor being the active element |
| | | **G4** "a folded tree is shown for the search and folded again; in a narrow tab the column stands in the file's place". Waits on `[data-files-tree][data-place]` at each step; reads `files.tree` through the layout's own read for the session's `folded`, true before and after |
| | | the existing scene "the Files tree and the viewer use tokens only in both themes" gains the group, the marks and the list |
| `e2e:layout` | `e2e/ux2-shell.spec.ts` | **G5** "Go ▸ Go to file stands under Command palette with ⌘P; disabled with no session, with Settings open and with the Overview open; enabled with a session; the sheet lists it under Go". Polls the menu item's `enabled` to the value each state calls for |
| `e2e:browser` | `e2e/browser.spec.ts` | **G6** "with the keyboard in a page of the in-app browser, Go to file puts it in Files' field". Waits on the page's own focus witness first, then on the field being the active element of the app's page |
| `e2e:remote` | `e2e/remote.spec.ts`, beside the U8c-2 scene | **G7** "a session on B: A's Files shows B's changed files and marks and what B's git ignores, and Go to file lists a file that exists on B alone; with B stopped the group stays and the list says B is offline". Waits on the heading's count; on the result's row; after B stops, on the link's offline mark before it reads the group and the line |
| `e2e:cross-build` | `e2e/cross-build.spec.ts` | **G8** "(ignored marks, both ways)", §B's row. Waits on the tree's row for the ignored entry in each half before it reads its marker; reads the peer's and the daemon's logs for a refused answer after the listing is drawn |

A scene of another child's that crosses the code this landing edits and must still pass: U6b-1's block of `e2e/code-tools.spec.ts` (the tree column's places, a row's click and double-click), U6e's scenes of the tree's context menu, U6a's scene of the three surface chords and the grouped menus in `e2e/ux2-shell.spec.ts`.

## Statements to check again once the chain's fourth batch is on master

This document is written against the chain's head, which holds eight landings that are in review. A review can still change them. Before M1 starts, and again at each merge of master, the executor reads each row against the tree it then has (`git diff bdbfe863e HEAD -- <the files>`), and reports a statement that no longer holds instead of building on it. The files are those that differ between master's tree and the pin among the ones this landing reads or edits.

| the statement here | rests on, as the chain holds it | where it is used |
|---|---|---|
| a Files tab draws its tree in a column whose place is `treePlace`'s; `FilesMenu` wraps the tree's list; the tab's file column is the element given to `registerSideFile` | `tools/code/files/FilesTool.tsx` as U6b-2 and U6e leave it | M2, M3; decisions 22 and 23 |
| `registerEditor` is where `connectOpenFile` is connected | `tools/code/editor/register.ts`, `tools/code/index.ts` | M3 |
| `unmerged` is exported by `review/review-model.ts`; Review's params are `{ scope, path, turnId, commit }` and `path` is relative to the repository's root for `uncommitted` | U5b-2's `review-model.ts` | M2; decision 6 |
| `FILES_COPY` and `REVIEW_COPY` are two objects of `tools/code/copy.ts`, and the desk's web app reads the second | `copy.ts` as U6b-2 and U5b-2 leave it | M2, M3 |
| `list` reads names, then entries, confirms, sorts and cuts; `BoundaryPoint` is a union this landing can add to | `src/services/files/service.ts` as U6b-2 leaves it (its raw read added `after-read`) | M1 |
| `FilesEntrySchema` has six fields and `GitFileStatusSchema` five | `src/shared/ipc/schema/files.ts`, `schema/git.ts` as U6b-2 and U5b-2 leave them | M1; §A, §B |
| `parseStatus` reads `parts[1]` as XY and nothing of `parts[2]` | `src/services/git/porcelain.ts` as U5b-2 leaves it | M1 |
| `git.watch` and `git.status` are registered with no trust gate and answer `GitStatus` | `src/services/git/register.ts`, `service.ts` as U5b-2 leaves them | decisions 1 and 28 |
| `files.list` has no entry in `COMMAND_BUDGETS_MS` | `src/services/command-budgets.ts` as U5b-2 leaves it | "Probe 8" |
| the wire's minor is 54 and the stand-in is 55 | `src/shared/ipc/wire.ts` | Concrete Steps 4 |
| `disabledWords(command, standing, label)` words the offline phase for a command with no row of its own from the label | `src/shared/ipc/remote-unavailable.ts` as U4b's and U10b's rows leave it | decision 18 |
| a text field's own keys are not taken by the page's dispatcher for a pane-scoped or composer-scoped row | `src/renderer/src/keymap/dispatcher.ts`, `useKeyChord.ts` as the chain leaves them | M3, decision 19 |
| the scenes' anchors: U6b-1's block and the scratch-repository block in `e2e/code-tools.spec.ts`; the U8c-2 scene in `e2e/remote.spec.ts`; the coverage table's last row (U6b-2's) in `e2e/cross-build.spec.ts` | those three files | M4; §G |

## Size and review

Counted file by file from the code at the pin, tests and scenes included; a new file is counted whole.

| milestone | files | changed lines, about | of which product code |
|---|---|---|---|
| M1 | 16 | 680 | 110 |
| M2 | 9 | 860 | 390 |
| M3 | 16, 12 of them not touched before | 1,070 | 440 |
| M4 | 7 | 520 | none |
| **the landing** | **about 44** | **about 3,100**, between 2,700 and 3,400 | **about 950** |

The cut estimated about 1,500 lines over 22 files. What it did not count: the scenes of four groups beyond `e2e:code`; the two suites that hold the older builds at the schema; the measurement; the filter's states, which need a test per row of S3; the keyboard's request, which U6b-1 did not build; a submodule's mark.

**Review.** By the wave's rule a branch of about twenty files or two thousand changed lines takes the panel (`doperpowers:review-code` at xhigh), and this one is past both marks, so that is what Decision Log 1 records. On stakes alone a single reviewer at the high rung would do, which is what the cut named: the landing adds no command, stores nothing, and its one new process is a read-mode git call behind a boundary that already exists. The architect rules (R3). Whichever it is, the reviewer's attention belongs first on M1: a process started from inside the files boundary, its bound, and what an older build reads.

## Proof that an executor does not run

Each is a step with what it needs, handed to the architect.

1. **The adversarial review of this document**, before M1 starts. Needs: this file at its commit.
2. **The owner's look at the drawn example**, before M2 starts. Needs: the drawing "The look" describes, made outside the repository with invented names, at 220 and 160 px in both themes; and the two cards.
3. **The ruling on probe 8's verdict**, after M1. Needs: the `probe8.*` lines and the machine line from Surprises & Discoveries.
4. **The Mac lane's unit cases.** `src/services/files/ignored.test.ts` runs real git, and a Mac's own git is another build of git than the VM's: the five facts of decision 12 are to be shown there too. With it the macOS-guarded cases of `src/services/files/service.test.ts`, which now pass through the check's place in `list`. Needs: a Mac under the load rule, the final head.
5. **The scenes on a Mac** (§G): each new scene alone first (root UC-10), then `e2e:code`, `e2e:layout`, `e2e:browser` and `e2e:remote` whole on the final head. Needs: the final head; the load rule.
6. **The cross-build runs** (§B): `e2e:cross-build` against build F, build M, master at `b89d6d1d7` and the master this landing merges into; G8 passes, not skips, against each. Needs: the final head or the last that changed M1's or M2's files.
7. **Hands on, in the owner's sitting:** ⌘P under the Korean input source (the child's probe 6 lists every new menu chord), and Korean typed into the field: a syllable still being composed must not be opened by the Enter that commits it. Needs: the wave's build on a machine with that input source. It joins the sitting's script; it holds no milestone.
8. **Class 1a** on GitHub Actions (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b-3`), once, on the complete branch; **the branch review** and its fix waves.
9. **The chain's merge and the landing:** the wire's minor taken again (Concrete Steps 4); "Statements to check again" read once more; the pull request; ticket 672 and the register's row of l5-code-09 closed through the board scripts.

## The pull request

Opened by the architect when the landing before this one in the chain is on master. Its body is the short form the owner chose on 2026-11-17, and nothing longer: **the proof** (class 1a's run, the Mac runs and the cross-build runs with the commit each ran on, the review's verdict), **what differs from the plan** (each place the build departs from this document, with its Decision Log entry), **what is left over** (tracker rows, what was not run, what waits for the owner's hands or eyes). It ends with `Closes #672`, a blank line, and the session line of Constraint 1. It carries no amendment of a reversed ruling: the child's "Rulings reversed" names none for l5-code-09, and ⌘P was free (the child's table of collisions).

## Surprises & Discoveries

- Observation: `git.lsFiles` answers folders among its files, ranked with them, and cuts at its limit before a caller can leave them out.
  Evidence: `withDirectories` and `rankPaths(query, listing.paths).slice(0, limit)` in `src/services/git/ls-files.ts`; the `@` menu sorts `directory` rows last after the fact (`AtMenu.tsx`).
- Observation: `files.list` has no budget of its own; the cut's "the command's budget" is the default of 10 s.
  Evidence: `COMMAND_BUDGETS_MS` names no `files.list`; "A command not named here answers within the default" (`src/services/command-budgets.ts`).
- Observation: the status parser drops the one field that tells a submodule from a file.
  Evidence: `RECORDS` in `src/services/git/porcelain.ts` counts `sub` among the fields before the path and `parseStatus` reads only `parts[1]`.
- Observation: Review has two colours for a change, not three; Desktop has three.
  Evidence: `text-success` and `text-danger` are the only tones in `review/FileSection.tsx`, and a modified file's badge is `text-fg-muted`; Desktop's `VT` (`c9bd7af9c-DlJ4cmuC.js:7118-7124`) maps modified to its yellow.
- Observation: Desktop's Files pane has no Changed group and does not ask git what is ignored.
  Evidence: its filter's menu holds five rows, none of them for changes (`c9bd7af9c-DlJ4cmuC.js:14610-14770`); its dimming is a set of folder names (`c82492f2c-B1kvcJEb.js:2955-2972`).
- Observation: nothing puts the keyboard in a file that opens beside the chat.
  Evidence: `FilesTool.tsx` reads no `ctx.focusRequest`; `registerSideFile` and `focusedFile` (`editor/register.ts`) only answer whether the keyboard is in a file's column.
- Observation: both older builds read a daemon's answers and events with the tolerant reader, at the same places as this build, and the reader's file is the same in all three.
  Evidence: `git grep readCommandOutput` and `readEventPayload` at `f1852de3a` and `2c7044231`; `src/shared/ipc/tolerant.ts` has one checksum across the three trees.
- Observation: `git check-ignore -z --stdin`, asked with `./<name>` in the directory itself, behaves as decision 12 needs.
  Evidence: a scratch repository on a Mac, git 2.55.0: `./build` and `./x.log` answered as asked; `./tracked.log` (tracked, matching `*.log`) and a negated `./keep.log` not answered; `./out.js` answered when asked inside the ignored `build`; exit 1 with nothing ignored; exit 128 outside a repository; a file of a nested repository judged by the nested repository's rules when asked there. M1's tests pin each on the VM's git, and step 4 of "Proof that an executor does not run" on a Mac's.
- Observation: the two older builds' `files.*` schemas are already committed as snapshots for a unit suite.
  Evidence: `test/cross-build/peers/<build>/schema-files.ts`, made by `generate.sh` there (U6e).

## Decision Log

1. **2026-11-17 (UTC) · The verification call.** This document gets an adversarial review before an executor starts (the architect dispatches it). The branch gets `doperpowers:review-code` as the xhigh panel, by size: about 44 files and about 3,100 changed lines, past both of the rule's marks; on stakes alone it would be one reviewer at the high rung, which is what the cut named, and the architect rules which (R3). Class 1a on GitHub Actions is the gate of record. The pull request's body is the short form: the proof, what differs from the plan, what is left over.

## Outcomes & Retrospective

Pending — written at finish.
