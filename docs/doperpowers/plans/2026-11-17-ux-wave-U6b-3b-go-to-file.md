# UX wave · U6, the second half of U6b's third landing (U6b-3b): Go to file

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*). **The cut:** `docs/doperpowers/plans/2026-11-14-ux-wave-U6b-cut.md`, cited below as *the cut*: its section "U6b-3 · Files shows what changed, and finds a file by name". **The landing before it:** U6b-3a, `docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md`, cited below as *3a's document*. **Parent pin:** the head of U6b-3a when the architect cuts this landing's branch from it. Until then every statement about the code below was checked against `bdbfe863e6b2f59031c10f0c51873c4a0210b00b` (the chain's head through its fourth batch) and against 3a's document for what U6b-3a adds; "Statements to check again" lists what must be read once more on the real pin.
>
> **The landing.** The cut's U6b-3 is two landings since 2026-11-17 (Decision Log 3). U6b-3a builds what changed: the Changed group, the marks, the dimmed entries, the wire. **U6b-3b**, this document, builds Go to file, in the window but for one edit of the daemon's file lister (decision 14): no wire field, no stored value. In the chain: U6f, then U6b-3a, then U6b-3b, then U6b-5. Of the child's acceptance, this landing proves the second sentence of **A3** ("⌘P puts the keyboard in Files' filter from anywhere; typing part of a name lists matches; Enter opens the first; `name:42` lands on line 42") on all three routes, and **A13** for the row `files.goToFile`; U6b-3a proves A3's first sentence. Of item l5-code-09's "After", the fourth paragraph (Go to file, ⌘P) is built here and the first three there. With both landed the item is whole, and the register's row closes here.
>
> **The design** is the child's file, item "l5-code-09", its paragraph "Go to file, ⌘P", and the cut's decisions 2, 4 and 6. This document builds that design and does not reopen it. It carries what they left open: the filter's keys, what a request and its answer are, how an open filter stays true, where the keyboard goes, and ⌘P's edges.
>
> **Branch:** `ux-wave/U6b-3b`, cut by the architect from U6b-3a's head. **Board:** ticket 672, under ticket 592. **Not in this landing:** anything of the wire, and nothing of the daemon but the lister's one edit; the Changed group, the marks and the dimming (U6b-3a); search inside files, hiding dotfiles, a filter over the tree's own rows (the child's "Not included"); what ⇧⌘F does with the keyboard, Back and Forward, zoom, the palette's recent list (U6b-5); the words of a refusal in a file's tab (U6b-4).
>
> **How it was written (2026-11-17).** The first writing of U6b-3 (`5a73f8fa3`) held this landing as its third milestone. The adversarial review returned seven findings, all accepted (Decision Log 2); four are about Go to file and are fixed here: a request has a generation and only its own answer is taken (finding 3); Enter puts the keyboard in the file also when the file is open in the main area (finding 4); an open filter is asked again, and the sentence about ten seconds is corrected (finding 5); a repository git refuses shows the failure line, and only "not a repository" falls back to the walk in silence (finding 6).
>
> **Revision 2 (2026-11-17).** Three inputs (Decision Log 5 to 7). The owner answered the card: ⌘P shows a folded tree for the search and folds it again, which is what was built. The architect ruled on the drawn example's notes: the field is 33 px with its border, padded 8 px, with the app's own focus outline; in a narrow tab the "Files" bar stands above it; a result's folder is named from the working folder in the muted tone, cut at its start; a line wraps; a result has its path as its title. A delta review returned findings on both documents; here: a refresh that falls while an answer is awaited is owed and issued when that answer settles; a clean submodule is listed as the folder it is, by one edit of the daemon's lister; the list's `listbox` contract is M2's; B3 is proved in two halves; every scene runs alone on a Mac before any group.

## Purpose

After U6b-3a a person sees in Files what an agent changed. The only way to reach a file whose name is known is still to open folders one by one.

After this landing **Go to file**, ⌘P from anywhere in the window, puts the keyboard in a field above Files' tree. Typing part of a name replaces the tree with a ranked list of the working folder's files; Enter opens the first as a kept tab and puts the keyboard in the file; `name:42` lands on line 42; Esc empties the field and the tree is back, and Esc again gives the keyboard back to where it was. It holds for a session MAWS runs, a terminal session and a session on another machine, where the list is read on that machine by a command it already offers.

How to see it working: with the side column closed and the caret in the composer, press ⌘P. Files opens and the caret is in the field. Type `tree`: the tree gives way to a list of files, the best match highlighted. Press Enter: that file opens as a kept tab beside the chat and the caret is in it. Press ⌘P, type `store.ts:40`, Enter: that file opens at line 40. Open a file in the main area, go back to the composer, find the same file with ⌘P and Enter: the main tab comes forward and the caret is in its text. Press ⌘P and Esc twice: the tree is back where it was and the caret is in the composer.

## Progress

- [x] (2026-11-17) Written, from the first writing's third milestone and the review of it: `git.lsFiles` and its kept list (`src/services/git/ls-files.ts`), the `@` menu's own guard against a stale answer (`composer/mentions/AtMenu.tsx`), `focusPaneElement` (`main/pane-dom.ts`), `placeOpen` (`files/tabs.ts`), `FileViewer` and `FileBody` (`viewer/FileViewer.tsx`), the runner's "not a git repository" (`src/services/git/runner.ts`) and the action table read at `bdbfe863e` for the four findings; Claude Desktop `app-5.1231.2` read for its ⌘P and its filter's keys.
- [x] (2026-11-17) The review's findings 3 to 6 and the architect's rulings on R3, R5, R7, R9 and the card folded in (Decision Log 2 to 4).
- [x] (2026-11-17) U6b-3a built, and this landing's branch cut from its head (`05556372c`); "Statements to check again" read on it: every row holds (Decision Log 8).
- [x] (2026-11-17) The example drawn at real sizes by the architect and its 24 notes ruled; the owner's answer on the card ("Show it, then fold again"); a delta review of both documents and the rulings on it. Revision 2: all folded in (Decision Log 5 to 7).
- [x] (2026-11-17 15:10Z) M1 — The action and the field: ⌘P puts the keyboard above the tree. Commits `c663edbe1`..`fd49c9b7e`; task review clean after two fix rounds (Decision Log 9).
- [x] (2026-11-17 18:40Z) M2 — The search and the open: the list, its keys, the keyboard in the file. Commits `2c41c66b9`..`4fe467660`; task review clean after one fix round (Decision Log 10 to 12).
- [x] (2026-11-17 22:30Z) M3 — The scenes, the record, and the acceptance run. Commits `5e8b58c3a`..`e64f8c86d`; task review clean after one fix round (Decision Log 14). Scenes written and typechecked, not run (the Mac's); the whole unit suite ran once at `a69855420`: 48 failed of 45,814, all on the VM list or at the base (task 3's report, section 6).
- [ ] The proof an executor does not run ("Proof that an executor does not run", 1 to 7).

## Words used in this document

- **The daemon** is `mawsd`, the per-Mac background process that runs the machine's services; **main** is the Electron main process of the app and **the window** its page. Of the daemon one function is edited here (the lister's load, decision 14), and of main's own code the menu.
- **The working folder** is root UC-4's: the checkout the agent's main loop is working in now, answered by `useWorkingFolder(appSessionId)` (`src/renderer/src/sessions/working-folder.ts`). Its `path` is the one folder a search is made in.
- **The tree column** is the part of a Files tab that draws the tree (`[data-files-tree]`, `files/FilesTool.tsx`), built by U6b-1. `treePlace` (`files/tree-state.ts`) says where it is in a tab: `alone` (the tab holds no file), `beside` the file, `folded` away, or `instead` of the file (a tab too narrow for both, after its button was pressed).
- **The field** is Go to file's text field, above the tree in the tree column. **The list** is what is drawn in the tree's place while the field holds a query.
- **An ask** is one `git.lsFiles` call the window makes for the field's text. **A generation** is a number the finder counts up each time it decides to ask, or to stop waiting for what it asked. An answer or a failure belongs to the generation of the ask it answers.
- **A held Enter** is an Enter pressed before the answer for the text has come; it remembers the generation it was pressed in.
- **The set of a status's entries** is U6b-3a's `statusSet`: a working folder's changed paths with their letters. It changes when a file appears, goes, or changes its state.
- **A file's view** is `FileViewer` (`tools/code/viewer/FileViewer.tsx`), the one component that draws a file's tab, beside the chat and in the main area alike; its key is the id a main tab of the file has (`fileKey`, `file:<machine>:<path>`), and a window has one view per key.
- **Build F** is `f1852de3a` and **build M** is `2c7044231`: the two earlier builds a profile that runs this landing may have run before, or may be taken back to (root UC-14).

## The landing's edge

**In.**

- The action `files.goToFile`: "Go to file", ⌘P, a row of the Go menu, of the palette and of the shortcut sheet; registered only while it can end with the keyboard in the field.
- The field above the tree, its text kept for the session during the run, and the tree column shown for a search in a tab where it is folded or has no room.
- The search: one `git.lsFiles` of the working folder per ask, files only, the first 50, `name:42`; a submodule listed as a folder and so never a result; what the list says while it waits, when nothing matches, when the read fails and when the machine is offline.
- The keys: ↓ and ↑, Enter (also before the answer), Esc in its two steps, ⌘P again.
- The keyboard: into the field on ⌘P, into the file on Enter (beside the chat or in the main area), back where it was on Esc.
- An open filter asked again when the files change, and on ⌘P.
- The scenes on a Mac (written here, run by the architect) and the record: the register's row of l5-code-09, the tracker's rows.

**Not in, and whose.**

| not in | whose |
|---|---|
| the Changed group, the marks, the dimmed entries, the wire's two keys, the ignore check | U6b-3a |
| which element of Files takes the keyboard when ⇧⌘F shows it, and giving it back when a surface hides | U6b-5; it can use what this landing builds (Interfaces §E) |
| a file found in a folder the session added (`additionalDirectories`) | not built (R9): the child's file says the working folder's files, and `git.lsFiles` takes one folder |
| an input of `git.lsFiles` that asks for files only | not built (R7): a tracker row |
| a rebinding of ⌘P | not while build F can be gone back to (root UC-6) |
| search inside files; a filter over the tree's own rows | nobody's: the child's "Not included" |

## What the code holds today

Read at `bdbfe863e`; U6b-3a edits none of the files named here but `FilesTool.tsx`, `tree-state.ts`, `tree.ts`, `store.ts` and `copy.ts`, in the ways its document says.

- **`git.lsFiles`** (`src/services/git/ls-files.ts`) lists `ls-files --cached --others --exclude-standard` in the folder asked (tracked and untracked, ignored left out), ranks the list against the query with `rankPaths` (`src/shared/composer/fuzzy.ts`: a case-insensitive subsequence over the whole path, a bonus at a segment's start and for consecutive characters, ties to the shorter path) and answers the first `limit` (at most 200, in this build and in both older ones). **Its paths hold folders too**, each with a trailing `/`, ranked among the files, and the limit cuts before a caller can drop them. **It keeps a folder's list for ten seconds and loads it only when asked** (`CACHE_MS`; the age is checked when a request arrives, and nothing reloads by itself). **It falls back to a walk only for "not a git repository"**: the runner turns that one message into `NotARepositoryError` (`src/services/git/runner.ts`), `load` catches that one error and walks the folder (six levels, 20,000 entries, not into `node_modules`, `.git` or `dist`); every other failure of git (a repository another user owns, a configuration it cannot read) is thrown and the command fails. Its budget is 20 s (`COMMAND_BUDGETS_MS`). **It lists a submodule as a file:** `ls-files --cached` names a gitlink by its path with no trailing slash, and `withDirectories` adds a slash only to the folders above listed files.
- **The `@` menu** is its one caller (`composer/mentions/AtMenu.tsx`): a wait of 80 ms after the last keystroke, a "Searching files…" row until the answer for the text as it stands has come, and each call of its effect made void by the effect's cleanup (`live`), so that only the newest call's answer is ever taken.
- **The keymap.** `ACTIONS` (`src/shared/keymap/actions.ts`) has no `files.goToFile`; the table's test names it among the wave's defaults (`WAVE_DEFAULTS`, ⌘P) and not among the rows that must exist (`LANDED`). `palette.open` is the Go menu's first row and its only row of the group `palette`, so a separator follows it (`group`, `GROUP_OF_PREFIX`, `src/main/menu.ts`). `SHELL_FOCUS_ACTIONS` holds the actions that take the keyboard from a page of the in-app browser. A row whose id build F does not know takes no rebinding (`isRebindable`, `src/shared/keymap/build-f.ts`), and a stored rebinding that holds a chord takes it from the row whose default it is (`effectiveChord`). Nothing in the app handles ⌘P.
- **Showing Files.** `showFiles(appSessionId)` (`files/tabs.ts`) brings the session's Files tab last in view into view, else its tree-only tab, else adds one, and returns the tab's id; the panel host shows a hidden or collapsed side column for it. The tab it answers may not be drawn yet. The session the side column is about is `surfaceSession(state)` (`panel/surface-model.ts`). `toggleSurface` (`panel/SurfaceRow.tsx`) leaves an open page first (root UC-12). `connectOpenFile` (`files/open-chosen.ts`, connected in `editor/register.ts`) is the pattern of an action registered only while it can run.
- **The tree column** can be folded away in a tab that holds a file (a stored choice of the session), and in a tab too narrow for both it is drawn only in the file's place after its button was pressed (`treePlace`). `FilesMenu` wraps the tree's list, so a right-click there offers "Open File…".
- **Opening a file.** `openFile(appSessionId, path, line, { keep })` (`tools/code/open-file.ts`) answers `{ surface, tabId }`. When a main tab already shows the file it selects that tab and answers `surface: 'main'` (`placeOpen`, rule 2); otherwise the file opens or is selected in a Files tab beside the chat.
- **The keyboard and a file.** Nothing puts the keyboard in a file's view when its tab opens. Files' tool does not read the panel host's focus request. `focusPaneElement` (`main/pane-dom.ts`), which `pane.focusOther` uses, focuses the pane's selected **tab button**, never the file's text. `registerSideFile` and `focusedFile` (`editor/register.ts`) only answer whether the keyboard is in a file's column beside the chat.
- **Another machine.** `git.lsFiles` is offered under the checkout rule (`src/endpoint/offers.ts`) and sent with `pathTarget(machine, appSessionId)`. `useRemoteStanding(appSessionId)` (`lane-b/remote-standing.ts`, U9) answers the machine's name and its link's phase for a session reached over the link, and `disabledWords(command, standing, label)` (`src/shared/ipc/remote-unavailable.ts`) words an act that cannot run while a machine is offline.

## Where the cut's section no longer matches the code

| the cut says | the code | what this document does |
|---|---|---|
| decision 1: the filter field above the tree, in every Files tab | the tree column is not always drawn (folded, or no room) | ⌘P shows the column in the tab it lands in while the search lasts, and writes no stored fold (decision 9; the card) |
| decision 2: `git.lsFiles { directory, query, limit }`, "its limit allows the child's 50" | the answer holds folders among the files, cut at the limit before the window can drop them | the window asks 200 and shows the first 50 files (decision 1; R7) |
| decision 4: the handler "calls `showFiles` and puts the keyboard in the filter; Enter opens with `keep`" | `showFiles` can answer a tab not drawn yet; nothing puts the keyboard in a file that opens, and for a file in the main area the one helper there focuses a tab button | a request for the keyboard, taken by the field or by the file's view when it is drawn (decision 10; sequences S2 and S3) |
| the child: "a ranked list of the working folder's files" | git lists a submodule among the files, as a path with no slash | the lister lists it as a folder, one edit in the daemon (decision 14) |
| the child: "a ranked list of the working folder's files" for any folder | a repository git refuses fails the command; only "not a repository" walks | the failure line there, the walk only for no repository (decision 4; finding 6) |

## How Claude Desktop does the same, and where MAWS differs

Read in `app-5.1231.2` (root law 1); the paths are under `web/app/v1/`.

- **⌘P** opens the Files pane if it is closed, shows a collapsed side area, focuses the pane's filter and selects the text it holds (`c11959232-BDz9Nq4r.js:4786-4800`; `c9bd7af9c-DlJ4cmuC.js:7915-7935`); while an overlay is up the key does nothing. MAWS does the same.
- **The filter's keys** (`c9bd7af9c-DlJ4cmuC.js:8477-8512`). Enter with text opens the first result as a kept tab, and when the results for the text have not come yet it remembers the press and opens when they come, only if the remembered text is still the field's (`:8449-8459`, set at `:8512`). Esc with text empties the field and keeps the keyboard in it; Esc with the field empty gives the keyboard back to the element that had it before the filter. A blur cancels a remembered Enter. Nothing acts while the input method is composing. A single click on a result opens a preview tab and any other click count a kept one (`:9003-9005`). MAWS takes all of this. It differs in two places: after Enter the keyboard goes into the file (the child's words; Desktop leaves it in the filter), and ↓ and ↑ move a highlight while the keyboard stays in the field, as MAWS's palette does, where Desktop moves the keyboard into the rows.
- **The results** replace the tree with a flat list, files only, at most 50, with no line that says more exist; no match reads "No matching files" (`:9806`). The ranking is a subsequence over the whole path with bonuses for consecutive characters, word starts and short paths. MAWS's `rankPaths` is the same family; it has no bonus for a match at the file name's start and is never case-sensitive. Desktop parses no `name:42`; the child's file asks for it.
- **Another machine.** Desktop draws no filter for an SSH session. MAWS's three routes behave alike (root law 5).

## Decisions settled at authoring

Each is settled from the code, with what it beat. Where one changes what a person sees beyond the child's words it is also in "Reported to the architect, and ruled" or the card, and names its one place.

1. **What is asked.** `git.lsFiles { directory: workingFolder.path, query, limit: 200 }`, sent with `pathTarget(machine, appSessionId)`; after a change of the text, 80 ms after the last keystroke (the `@` menu's wait). From the answer the window drops every path that ends in `/`, a submodule's among them (decision 14), and shows the first 50. The ranking is the command's, unchanged: one ranking of a name, here and in the `@` menu. No line says that more exist, as in Desktop and as A8 takes the same line from the palette. *It beat* a scorer in the window that weighs the file's name (a second ranking of the same list, and the whole list sent to the window to feed it) and an input that asks for files only (R7: fewer than 50 can show while more match; a tracker row).
2. **`name:42`.** A trailing `:<digits>`, or `:<digits>:<digits>`, is the line: the first number, at least 1; a second is read and dropped. What stands before it is the query; when nothing does, the whole text is the query. The query is cut at the schema's 256 characters.
3. **An answer is taken only for the request that asked** (the review's finding 3). The finder counts a generation up at every decision to ask or to stop waiting: a change of the text, of the working folder, of the session or its machine; a retry; a refresh (decision 8); the link going offline or coming back; the field emptied. Each ask carries the generation current when it goes out, and its answer or its failure is taken only while that generation is still the finder's; any other is dropped, a success and a failure alike. A held Enter remembers its generation, and opens only on that generation's answer. *It beat* matching an answer by its text and folder (the first writing's rule): after `a`, `b`, `a`, the first ask's answer for `a` has the right text and is not the answer that was asked for, and a late failure of an earlier ask would overwrite a retry of the same text.
4. **What the list shows**, in place of the tree and of the Changed group, while the field holds a query:

   | state | drawn |
   |---|---|
   | the current ask's answer has come, with rows | the rows: a file's name, then its folder from the working folder in the muted colour, cut at its start when it does not fit and gone below two characters of room (3a's `folderFromEnd`); the row's title is its path from the working folder; no status letter; one row is highlighted |
   | it has come, empty | one line, "No matching files" |
   | it has not come yet, after a change of the text, and an earlier answer is drawn | the earlier rows, none highlighted, the list marked busy |
   | it has not come yet, and nothing is drawn | one line, "Searching files…" |
   | the answer is drawn and is being asked again (decision 8) | the rows as they are, usable; no mark |
   | the read failed | one line, "Files could not be searched."; ⌘P, the field taking the keyboard again, or a change of the text asks again |
   | the session's machine is offline (its link's phase, U9) | one line from `disabledWords`: "File search is unavailable while <machine> is offline."; nothing is asked, and the text is asked again when the phase changes |

   A line takes as many lines as its sentence needs: it wraps and is never clipped (as ruled on the drawn example, item 12; the offline sentence does not fit one line at either width).

   **A folder that is no repository** is searched by the command's walk and says nothing about it. **A repository git refuses to read** fails the command, and the list shows the failure line: the review's finding 6, as ruled. *It beat* walking a refused repository too: that is an edit of `git.lsFiles` for every caller, and a walk would list what git would have left out as ignored.
5. **The keys**, while the field has the keyboard and the input method is not composing:
   - **↓ and ↑** move the highlight among the rows of an answer that is drawn for the text as it stands, and stop at the ends. While the text's answer has not come they do nothing but end a held Enter.
   - **Enter**, with no modifier, opens the highlighted row with `openFile(…, line, { keep: true })` and puts the keyboard in the file (decision 10). Pressed while the text's answer has not come, it is held for that ask's generation: when that answer comes, its first row opens. A change of the text, an arrow, Esc, the field losing the keyboard, the read failing or the generation changing for any other reason ends the hold and opens nothing (sequence S1). With no row it does nothing.
   - **Esc**, not repeating: with text, empties the field, ends a held Enter, and the tree is back at the scroll offset it had; with the field empty, gives the keyboard back to the element that had it when ⌘P was pressed, when that element is still in the page, and otherwise leaves it in the field.
   - **⌘P again** selects the field's text, so that typing replaces it, and asks again (decision 8).

   The keyboard stays in the field while the highlight moves (`role="combobox"` with `aria-activedescendant`, as the palette's field). *It beat* Desktop's move of the keyboard into the rows: a person can go on typing after an arrow.
6. **A click on a result** is a tree row's click: the preview tab, a double-click keeps it, ⌘-click opens a main tab; at the line the text names. It moves no keyboard beyond what a click does.
7. **After an open the field keeps its text and the list stays**, as in Desktop; Esc brings the tree back, as the child's file says. The one place: `opened` in `files/finder.ts`.
8. **An open filter is asked again; nothing in it is frozen** (the review's finding 5). What is true of the daemon: it loads a folder's list of files when it is asked and holds none younger than ten seconds, and it never loads by itself. So an answer can lack a file written up to ten seconds before its ask, and a drawn answer is as old as its ask, however long it stays on screen. (The first writing's "missing for up to ten seconds" was wrong: nothing in the window expired.) Three things ask again while the text stands: **⌘P**; **the field taking the keyboard again** after it had lost it; and **the working folder's status changing its set of entries** (U6b-3a's `statusSet`: a file appeared, went, or changed its state). Each is a *refresh*: the text is asked at once, and once more `FINDER_AGAIN_MS` (10,500) later if the field still holds the same text, because the first of the two can be answered from a list the daemon loaded before the change and the second cannot. One later ask is pending at most; a new refresh moves it, a change of the text drops it.

   *What a refresh does to what is on screen.* The rows stay drawn and usable while it runs: the highlight, the arrows and Enter act on them at once, and Enter is not held, since a drawn answer is an answer to the text. When its answer comes the rows are replaced, and the highlight stays on the path it was on when that path is still among them, else it goes to the first row. When it fails, the drawn rows stay and nothing is said. A refresh that falls while the text's own answer is still awaited starts no ask then, so a held Enter keeps the generation it was pressed in; it is **owed**, and is issued when that answer settles, whether it came or failed (the delta review's finding 3). The later ask coming due in that state is owed the same way. A change of the text clears what is owed.

   *What no refresh sees*, and how it shows: a file written inside a folder the status lists whole as untracked, and any file in a folder that is no repository, change no status. Such a file is in the list at the next ask: the next keystroke, ⌘P, or the field taking the keyboard again. *It beat* a timer that asks every ten seconds while the field is open (asks with nobody looking, on every machine a session is on) and leaving the answer as it was (the review's case: a matching file written a minute ago, ⌘P pressed again, and still the old list).
9. **The tree column is shown for the search** (the card). ⌘P marks the tab it lands in as *finding*. While a tab is finding, `treePlace` answers `beside` where the tab has room for both, whatever the stored fold, and `instead` where it has not. Finding ends when a file is opened from the list, when Esc leaves the field, when the field loses the keyboard while it is empty, and when the tree's button is pressed; the column is then where the stored fold and the tab's width put it. Nothing is stored.
10. **Who gets the keyboard, when the thing that should take it may not be drawn yet** (the review's finding 4 for the file). One request at a time, held in `files/finder.ts`: `{ into: 'filter', tabId }` or `{ into: 'file', key }`. ⌘P makes one for the field of the tab `showFiles` answered. The filter's Enter makes one for the file it opened, by the file's key, **whether it opened beside the chat or was already open in the main area**: a window has one view per key, so the key names the one place. A taker that is drawn is told at once; one that is not takes the request when it draws; the person's next key press or pointer press anywhere drops it.

    *The file's view takes it in the file.* `FileViewer`'s body is given its key and becomes focusable; when it holds the request for its key and is in view, it takes the keyboard on itself and hands it to the file's editor at once when one is drawn, or as soon as one is drawn while the body itself still has the keyboard. While the file's read is on its way the keyboard is on the body; when the read fails, or the file is a kind with no editor, it stays there, which is inside the element ⌘S and the comment key look in. For a file in the main area, `openFile` has brought its tab forward; the keyboard goes to the same body, never to the tab's button, and `focusPaneElement` is not used. *It beat* the panel host's focus request, which every open of a tab raises (reading it here would move the keyboard on a click of a path link, which is U6b-5's question), and `focusPaneElement` for the main area (the first writing's choice: it focuses a tab button, so typing would not reach the file).
11. **The action.** `files.goToFile`, "Go to file", ⌘P, a menu row of Go directly under "Command palette" with no separator between them; in `SHELL_FOCUS_ACTIONS`; not rebindable while build F can be gone back to, and it gives ⌘P up to a stored rebinding that holds it (root UC-6, both by the table's own functions). Its handler is registered exactly while it can end with the keyboard in the field: the side column has a session (`surfaceSession`), and neither the Settings dialog nor the Overview is open. With a page open it leaves the page first (root UC-12: an act on the side column leaves a destination first), then shows Files, as ⇧⌘F does. With the side column closed or hidden it shows it, as `showFiles` does. Unregistered, the menu row is disabled and the key does nothing (R5, accepted as UC-12 has it). *It beat* closing the dialog or the Overview for a key that is about files.
12. **Another machine.** The list is read there by `git.lsFiles`, which every machine already offers; no offer and no capability is added. A slow link shows what decision 4 says for an answer that has not come. For a session reached over the link, an offline phase shows its line and asks nothing; any other failure is the failure line.
13. **A repository MAWS does not trust.** `git.lsFiles` runs in read mode, as the `@` menu's call does today in the same folders, trusted or not; this landing adds no git call.
14. **A submodule is a folder, for every caller of the lister** (the delta review's finding 5). Today a clean submodule comes from `git.lsFiles` as its path with no trailing slash, so it would be a result, and Enter on it would open a file's tab onto the files service's error for a folder. The lister is corrected where it reads git: its one `ls-files` call gains `--stage`, by which git writes each index entry's mode before its path, and an entry of mode `160000` (a gitlink) is listed with a trailing `/`, as every folder is. The window drops it with the other folders; the `@` menu, the lister's other caller, now shows it among its folders, last, where it showed it among its files. It is one place, `load` in `src/services/git/ls-files.ts`, with a case over real git that holds a clean submodule; the answer's schema and the wire do not move. *It beat* the fallback (Enter on such a row opens the folder in the tree): that leaves a row that is no file in a list of files, for every repository with a submodule; and dropping the gitlink outright, which would take a submodule's folder from the `@` menu, where a person may mean to name it. Seen on a scratch repository before it was written: with `--stage` the tracked entries come as `<mode> <id> <stage>`, a tab and the path, the untracked ones as the bare path, and a clean submodule as mode `160000`.

    **Its one limit** (Decision Log 8). An entry is told an index entry by its head alone, and git writes an untracked path bare: an untracked path whose own name begins with a mode, an object id, a stage and a tab (six octal digits, a space, hex digits, a space, a digit from 0 to 3, a tab) is read as an index entry, and listed as what follows its tab, with a trailing `/` where its mode is `160000`. Such a name is made on purpose, never by chance. It is accepted as today's reading, with a tracker row (M3 decision 5) and a unit case over real git that pins what the lister answers for such a name (M2 decision 8), so that a change of the reading is seen.

## Reported to the architect, and ruled

Of the first writing's nine points these are about Go to file; the others are in 3a's document. The rulings are of 2026-11-17 (UTC), also in Decision Log 4.

| # | The point | Evidence | The ruling | The one place |
|---|---|---|---|---|
| R3 | **The review rung.** | "Size and review" | **Ruled per landing:** this landing takes one reviewer at the high rung (ruled when it was the window only; since revision 2 it also edits one function of the daemon's lister, and the rung is the architect's to confirm); U6b-3a takes the panel | Decision Log 1 |
| R5 | **⌘P does nothing while the Settings dialog or the Overview is open, and leaves an open page first.** The child's file says "from anywhere". | root UC-12; `connectOpenFile` is disabled under the Overview for the same reason; a field under a modal layer cannot hold the keyboard | **Accepted as UC-12 has it** | `canGoToFile` in `files/finder.ts` |
| R7 | **Fewer than 50 files can be listed while more match.** `git.lsFiles` ranks folders among files and cuts at its limit (200 at most) before the window drops the folders. | `withDirectories`, `rankPaths(...).slice(0, limit)` | **Accepted, with a tracker row** (M3) | an optional input of `git.lsFiles` (files only), a wire field a later landing can add |
| R9 | **Go to file searches the working folder only.** A file in a folder the session added is not found. | the child's words; `git.lsFiles` takes one folder | **Accepted** | `useFinder`'s one `directory` |

### The adversarial review's findings, and where each is fixed

| # | The finding | In this document |
|---|---|---|
| 3 | Matching an answer by text and folder lets an earlier ask's answer satisfy a later one, a held Enter included | a generation per ask; stale successes and failures dropped; the held Enter bound to it (decision 3; S1; M2's tests of `a`, `b`, `a` and of a same-text retry, each order) |
| 4 | For a file already open in the main area the keyboard went to its tab button | the file's view takes the request by the file's key wherever it is drawn, with the pending and the failed read said (decision 10; S3; M2's test with the main tab present; scene G3) |
| 5 | An open filter kept its answer for ever, and "up to ten seconds" was untrue | the three refreshes, each asking at once and once more after the daemon's ten seconds; what they do to the highlight and a held Enter; what none sees (decision 8; S4; M2's test on a moved clock; scene G4) |
| 6 | B9 promised silence where the command fails | the failure line for a repository git refuses, the walk only for no repository (decision 4; B8; M2's test over real git beside a non-repository and a good repository). The silent half (the Changed group, the marks, the dimming) is 3a's |
| 1, 2, 7 | The check's process; dimming's currency; the cross-build scene | 3a's document |

The delta review of both documents (2026-11-17) and the rulings on it are Decision Log 5; the rulings on the drawn example's notes are Decision Log 6.

## The card for the owner

One in this landing, **answered**. **The owner's answer** (2026-11-17, recorded on ticket 672, comment 6943042432), verbatim: "Show it, then fold again (Recommended)". That is option A below, which is what was built already (decision 9; Decision Log 7). The card stays here as it was put, with its options; every name in the drawing is invented. Options B and C are not built; C was a sketch, and had it been chosen its look would have gone back to the architect.

### The card · ⌘P while the file tree is folded away

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

**Built:** A; it writes nothing to what is stored. **The one place:** the input `finding` of `treePlace` (`files/tree-state.ts`).

## The look

**It was drawn and looked at on 2026-11-17**, in the same drawing as U6b-3a's (nine frames at real sizes, kept outside the repository, with 24 notes): the field empty above the tree, with a query and results, "No matching files", the failure and the offline lines, a tab too narrow for both, and the card's options. The rulings on the notes are Decision Log 6 and are written into the decisions and the measurements below.

    ┌────────────────────────────┐   ┌────────────────────────────┐
    │ Go to file                 │   │ rate|                      │
    ├────────────────────────────┤   ├────────────────────────────┤
    │ ⌄ Changed 6                │   │ rates.ts   src/            │
    │   merge.ts   src/        ! │   │ rates.test.ts   src/       │
    │   cart.ts    src/        M │   │ pirate.md   docs/          │
    │ ⌄ harbor  directory      • │   │                            │
    │   › docs                   │   │                            │
    │   ⌄ src                  • │   │                            │
    │       cart.ts            M │   │                            │
    └────────────────────────────┘   └────────────────────────────┘

**The measurements.** The field: one row of 33 px with its bottom border (`border-border`), so that its line meets the file bar's line at the column's edge; outside the scrolling list and outside the tree's context menu; an `<input>` in `text-ui` with 8 px of padding at each side (the tree's root indent) and the placeholder in `text-fg-muted`; no icon and no clear button. With the keyboard it shows the app's own text-field outline, the classes every text field of the app has (`outline-accent focus-visible:outline-2`), drawn inside its box (`-outline-offset-2`), and never Chromium's default ring. In a tab too narrow for both, where the column stands in the file's place, the "Files" bar comes first and the field under it. A result row is the tree's row, 24 px (`FILES_ROW_HEIGHT`), at one level's indent: the name in `text-fg`, then the folder in `text-ui-sm text-fg-muted`, which gives way first when the row is narrow, cut at its start and gone below two characters of room; the name is cut next. The highlighted result has the tree's selected background (`bg-bg-active`). A line (no match, searching, failure, offline) is in the notice row's type, `text-ui-sm text-fg-muted`, the failure in `text-danger` as the tree's own "Could not list" is; it is a block of its own in the list's place that wraps to as many lines as it needs. Tokens only.

**The sentences a person reads** (exact strings are decisions; `FILES_COPY` in `src/renderer/src/tools/code/copy.ts`):

| where | text |
|---|---|
| the field's placeholder and its accessible name | `Go to file` |
| no result | `No matching files` |
| no answer yet, nothing drawn | `Searching files…` (the `@` menu's words) |
| the read failed | `Files could not be searched.` |
| the label handed to `disabledWords`, which answers "File search is unavailable while <machine> is offline." | `file search` |
| the menu, the palette, the shortcut sheet | `Go to file` |
| a result row's title | its path from the working folder |

## Routes (law 5)

| | a session MAWS runs | a terminal session | a session on another machine |
|---|---|---|---|
| the list | `git.lsFiles` of the working folder on this Mac's daemon | the same | on that machine, under its checkout rule; offline says so (decision 4) |
| the file Enter opens | read by this Mac's files service | the same | read on that machine, as every file of such a session |
| what asks an open filter again | this Mac's status, through U6b-3a's hold on the git store | the same | that machine's status, by its `git.changed`; nothing while the link is down |

The working folder is the selector's on every route (root UC-4). No act is added for another machine, so root UC-7 asks for no offer and no capability; its sentence for a read the link cannot carry is the offline line.

## What is stored and sent

**Stored:** nothing. The field's text, the finding tab, the request for the keyboard and the finder's states last for the run; `files.tree` keeps its shape and version and no layout key is added. No rebinding of `files.goToFile` can be stored (`isRebindable`), so neither settings file ever holds the id, which is what keeps build F's strict reader of `keymap` whole (root UC-14).

**Sent:** nothing new. `git.lsFiles { directory, query, limit }` is the command and the input both older builds have, with the same bound of 200 on `limit` (`git show <build>:src/shared/ipc/schema/git.ts`); its answer's shape is unchanged: a submodule's path now ends in `/` (decision 14), which is a value the schema always allowed and both older builds' callers already sort as a folder. The wire's minor does not move.

| | build M (`2c7044231`) | build F (`f1852de3a`) |
|---|---|---|
| this build's window asks an older daemon, on this Mac or another machine | `git.lsFiles` as that build serves it for its own `@` menu: the list works. That daemon still lists a clean submodule as a file: its row is a result there, and Enter on it opens a tab that shows the files service's error for a folder, until that machine is updated | the same |
| an older app on this build's daemon | it has no `files.goToFile`; its `@` menu gets a submodule as a folder, which it draws as it draws any folder | the same |
| a run of this build, then the older build, then this build | nothing is stored, so nothing is carried or lost | the same |

No cross-build scene is owed: the landing takes no wire minor and stores no form. The existing scenes of `e2e:cross-build` must pass as they do.

## Acceptance

Behaviour a person can see, or a run can show. *Unit* is run by the milestone's executor on the build VM; *scene* is written in M3 and run on a Mac by the architect; the names of the scenes and what each waits on are Interfaces §G. B1, B3, B5 and B7 together are the second sentence of the child's A3 on its three routes; B4 is A13 for this landing's row.

- **B1 · Go to file** (A3; unit and scene). With the side column closed and the keyboard in the composer, ⌘P opens Files with the keyboard in the field. Typing part of a name lists files only, at most 50, the first highlighted, a submodule never among them; ↓ moves the highlight; Enter opens the highlighted file as a kept tab. `name:42` then Enter lands on line 42. Esc with text empties the field and the tree is at the offset it had; Esc again puts the keyboard back in the composer. The same from a terminal that holds the keyboard.
- **B2 · Only the request that asked is answered** (unit). With asks for `a`, then `b`, then `a` again all on their way and Enter pressed after the last: the first ask's answer, landing first, opens nothing and draws nothing; the last ask's answer opens its own first row. In the other order the last ask's answer opens its row and the first ask's, landing after, changes nothing. The same for a retry of an unchanged text after a failure, and for the same text asked again after the link came back: an earlier ask's late success or late failure never replaces the newer ask's state.
- **B3 · A folded tree** (unit and scene). In a tab whose tree is folded, ⌘P shows the column and the field; after Enter the file has the whole tab, and the stored fold was never written. In a tab too narrow for both, the column stands in the file's place for the search.
- **B4 · The menu and the table** (A13; unit and scene). Go ▸ "Go to file" stands directly under "Command palette" with ⌘P and no separator between them; it is disabled with no session in the side column, with the Settings dialog open and with the Overview open; with a page open it leaves the page; the shortcut sheet lists it under Go; Settings ▸ Keyboard draws no control to change it; with a stored rebinding of another action to ⌘P the menu row has no accelerator. With the keyboard in a page of the in-app browser, the menu row puts it in the field.
- **B5 · The keyboard is in the file** (A3; unit and scene). After Enter the next typed character goes into the file's text: for a file that opens beside the chat, and for a file that was already open in the main area, whose tab comes forward. While the file is still being read the keyboard is on the file's view and moves into the text when it is drawn; a click elsewhere in between keeps it where the click put it; a file whose read fails keeps it on the view. It is never on a tab's button.
- **B6 · An open filter follows the files** (unit and scene). With a query's answer on screen and no key pressed, a file that matches is written in the working folder: it is in the list within the two asks of a refresh, the highlight still on the file it was on. ⌘P pressed again with the text unchanged asks again. With nothing changed and no act, nothing is asked.
- **B7 · Another machine** (unit and scene). For a session on another machine the list is that machine's files. With the link down the list reads "File search is unavailable while <the machine's name> is offline.", whole, on as many lines as it needs at 160 px, and nothing is asked; when the link is back the text is asked again.
- **B8 · No repository, and a repository git refuses** (unit, over real git). In a folder that is no repository the list holds its files from the walk and no line. In a repository whose configuration git cannot read, the list shows "Files could not be searched." Beside both, a good repository lists its files, and its clean submodule comes as a folder and not as a file.
- **B9 · Nothing stored, nothing sent** (unit). After every act of this landing the layout's stored keys and both settings files are what they were; `isRebindable('files.goToFile')` is false; the only command sent is `git.lsFiles` with the three keys both older builds know, and its answer has the shape it had.
- **B10 · Tokens, and the guards** (unit). `test/support/tokens-guard.test.ts` passes over the new renderer source; `src/shared/keymap/actions.test.ts` passes with the row among those that must exist.

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push. No `pnpm install`, typecheck, eslint, vitest, build, engine or Electron there. Every check runs on the wave's build VM in a checkout of the pushed head, through `vmcheck.sh` (Concrete Steps). An executor starts no Electron e2e, runs no `scripts/ci-gate.sh` and opens no pull request. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.
2. **The design is the child's and the cut's.** "Decisions settled at authoring" fills what they left. An executor who finds that one of them cannot hold stops and reports; a gap is resolved in the spirit of the nearest decision and recorded.
3. **The window, and one function of the daemon.** Under `src/services/`, `src/mawsd/` and `src/endpoint/` one thing is edited: `load` in `src/services/git/ls-files.ts`, with its tests (decision 14; M2). No schema of `src/shared/ipc/` changes and the wire's minor does not move. An executor who finds a need for more of either stops and reports.
4. **Nothing stored** (root UC-14): "What is stored and sent". No route stores a rebinding of the new action.
5. **U6b-3a's code is consumed, not edited** beyond the insertions Interfaces §F names in the files both landings touch (`FilesTool.tsx`, `tree-state.ts`, `copy.ts`). What U6b-3a's tests pin must still pass, unedited.
6. **Files other children own** (root UC-8). Interfaces §F lists every insertion with its owner. An executor who must edit another file of another child's stops and reports.
7. **Three routes** (law 5): "Routes" above.
8. **The repository is public** (root UC-11), and a person's content is never read. Tests, fixtures and scenes build their own repositories under a temporary folder (`test/support/git-fixture.ts`, with an empty home) with invented names. No fault is reproduced by reading the content of a session, a file, a settings file or a folder of a person's: structure and counts only, and none of it enters the repository. Nothing about any person's machines or installed software enters a document, a test or a commit.
9. **Guards that read source text.** In renderer source and its tests a ticket or item number is written in words ("ticket 672"); the tokens guard reads `#` and three to eight hex digits as a colour. Run that guard with M1 and M2. Components use tokens only. No component handles a ⌘ key in its own `keydown` (root UC-6).
10. **The level of proof.** A test that asserts an absence over input it builds by hand (no row opened, no ask sent, no state replaced, no keyboard moved) carries a control in the same test that shows the reader takes that input's form: the same held answer that does open when nothing intervenes, the same finder that does ask when a refresh is due, the same request that is taken when no key comes between. An asynchronous rule is asserted by a test that holds the awaited thing open and acts in between ("The sequences that must hold"), in both orders where two things are awaited. A scene says, in its description, what it waits on before it reads a position, a count or where the keyboard is. "The keyboard is in the file" is asserted on the document's active element being inside the file's text, never on a tab's button and never on a flag.
11. **No wall time is asserted.** The 80 ms wait, the later ask and a held answer are driven in tests by a clock and a bridge the test holds. A scene waits on a row, under a timeout long enough for the later ask.
12. **The base.** The branch takes master by merge, never by rebase or force-push.
13. **Disk.** If any command fails with "No space left on device": stop, report, delete nothing.

## The sequences that must hold

Each is an act that waits on something. For each: what happens when the person acts in between, and when the awaited thing fails or never comes; and the test that holds it open.

**S1 · The filter** (decisions 3, 4, 5 and 8). The finder holds the generation `g` and one state: `empty` (no query; the tree is drawn), `waiting(shown, held)` (the answer for the text has not come; `shown` is the earlier answer's rows or nothing; `held` says Enter was pressed in this generation), `answered(rows, at, refreshing)`, `failed`, `offline`. Every row below that says "g+1" makes every ask of an earlier generation stale at that instant.

| event | in | then |
|---|---|---|
| the text changes to a query | any | g+1; `waiting(the rows drawn now or nothing, held: no)`; the later ask and anything owed are dropped; the ask of this generation goes out 80 ms later, if `g` is still the same |
| the text becomes empty (typing, or Esc) | any | g+1; `empty`; the later ask is dropped |
| the working folder, the session or its machine changes | any with a query | g+1; `waiting(nothing, no)`; the ask goes out at once |
| an answer of generation `g` | `waiting` | `answered(the first 50 files, at: 0, refreshing: no)`; and if `held` and there is a row, row 0 opens in the same task |
| an answer of generation `g` | `answered`, refreshing | the rows are replaced; `at` stays on the path it was on when that path is among them, else 0; refreshing ends |
| a failure of generation `g` | `waiting` | `failed`; `held` is cleared and nothing opens |
| a failure of generation `g` | `answered`, refreshing | the rows stay; refreshing ends; nothing is said |
| an answer or a failure of any other generation | any | dropped: no state changes, nothing opens |
| ↓ or ↑ | `answered` (refreshing or not) | `at` moves by one and stops at the ends |
| ↓ or ↑ | `waiting` | `held` is cleared; nothing else |
| Enter, no modifier, not composing | `answered` with a row (refreshing or not) | the row at `at` opens |
| Enter, no modifier, not composing | `waiting` | `held: yes` |
| Enter | `empty`, `failed`, `offline`, or `answered` with no row | nothing |
| the field loses the keyboard | `waiting` | `held` is cleared |
| a refresh (⌘P; the field takes the keyboard again; the status's set changes) | `answered` | g+1; refreshing; the ask goes out at once; the later ask is set for `FINDER_AGAIN_MS` on |
| a refresh | `waiting` | no ask and no new generation (the text's own ask is on its way, and `held` stays bound to it); a refresh is **owed** |
| a refresh | `failed` | g+1; `waiting(nothing, no)`; the ask goes out at once |
| the later ask comes due | `answered` | g+1; refreshing; the ask goes out |
| the later ask comes due | `waiting` | a refresh is owed |
| the later ask comes due | `empty`, `failed`, `offline` | dropped |
| the outstanding ask of generation `g` settles while a refresh is owed | `waiting`, by the two rows above for an answer or a failure | first what those rows say (the rows drawn and a held Enter's open, or `failed`); then, in the same task, the owed refresh as a refresh in the state reached: from `answered`, g+1, refreshing, the ask goes out and the later ask is set; from `failed`, g+1, `waiting(nothing, no)`, the ask goes out |
| the machine's link becomes offline | any with a query | g+1; `offline`; nothing is asked; the later ask is dropped |
| the link leaves offline | `offline` | g+1; `waiting(nothing, no)`; the ask goes out at once |

*The answer never comes:* the command's own budget ends it as a failure (20 s for `git.lsFiles`), which is a failure of its generation. Tests (M2), each on asks the test holds open and a clock it moves: `a`, `b`, `a` with Enter after the last, resolved in each of the two orders (the control is the last ask's answer opening its own row); a failure, a retry by ⌘P, then the earlier ask's late success and late failure in each order against the retry's answer; offline and back with the earlier ask landing after; a refresh's answer keeping the highlight on its path, and moving it to the first row when the path is gone; a refresh's failure leaving the rows; a refresh during `waiting` sending no ask while a held Enter still opens on the text's answer, and then, with the clock moved past `FINDER_AGAIN_MS` before the original ask is resolved, the original ask resolved and a second ask going out for the same text (the owed refresh), in the case where it is answered and in the case where it fails; a change of the text between clearing what was owed, beside the case with no change, which asks; a composing Enter opening nothing beside a plain one that does.

**S2 · ⌘P and the field** (decision 10). The handler leaves an open page, shows Files (`showFiles`), marks the tab as finding, records the element that has the keyboard, and makes the request `{ into: 'filter', tabId }`. The field of that tab takes the request when it draws, or at once when it is drawn already: it takes the keyboard, selects its text, and is a refresh for the finder. *The person presses a key or a pointer before the field draws:* the request is dropped and the keyboard stays where that act put it. *The tab never draws* (another act hid the column first): the request is dropped by the next key or press, and a later showing of Files takes no keyboard by it. *⌘P twice:* the second request replaces the first; the element recorded for Esc is the first one's, since a field is never recorded. Tests (M1): a tab mounted after the request; a key pressed between, with the unpressed case as its control; two requests.

**S3 · Enter and the file** (decision 10; the review's finding 4). `openFile` answers where the file is; the request `{ into: 'file', key }` is made with the file's key; finding ends. The view with that key takes the keyboard on its body when it is drawn and in view, at once or when it draws. The editor takes it from the body when it is drawn already, or when it is first drawn while the body itself still has it. *The file was already open in the main area:* its tab is brought forward by `openFile`, its view is the taker, and the same holds; the tab's button never has the keyboard by this. *The read is on its way:* the keyboard is on the body until the editor draws. *The person clicks or types elsewhere before the editor draws:* the body no longer has the keyboard and the editor takes nothing. *The read fails, or the file is a kind with no editor:* the keyboard stays on the body. *The view never draws* (the tab was closed at once): the request is dropped by the next key or press. Tests (M2): a file opened beside the chat with its read held, the keyboard on the body until it lands and in the editor's text after; the same with a press in the composer between, the editor not focused (the control is the first case); **a main tab of the file already present**, not in front: after Enter the active element is inside that view's text and is not an element with `role="tab"`; the main tab's read held and then failed, the keyboard on the body.

**S4 · An open filter and the files** (decision 8; the review's finding 5). In `answered`, a status whose set differs lands: an ask goes out at once and the later ask is set; S1's rows say the rest. *The first ask is answered from the daemon's kept list:* the rows are what they were; the later ask brings the file. *The text changes before the later ask is due:* it is dropped; the new text's ask is as fresh as an ask is. *The tab is hidden before it is due:* the finder is unmounted with its timer. *Nothing changes and nobody acts:* no ask, however long the list is on screen. Test (M2), on a clock the test moves and a bridge whose answers it chooses: `answered` for a text; the set changes; the ask that goes out is answered with the old rows; the clock moves `FINDER_AGAIN_MS`; the ask that goes out is answered with one more file, and it is drawn with the highlight on the row the test had moved it to; and in the same test, before the set changed, the clock moved a minute with no ask sent (the absence, whose control is the ask that follows the change).

**S5 · The working folder moves** (U8c-2). S1's third row: an answer for the folder left is of an earlier generation and is dropped. Test (M2): a record whose `agentFolder` changes under an open filter with an ask on its way.

## Plan of Work

Three milestones, in order. M1 ends with ⌘P reaching a field that searches nothing yet, which is a state a person can be shown and a tree that is green; M2 makes the field search and open; M3 writes the scenes. The constraints above bind each; a milestone restates nothing of the design and points at it.

### M1 — The action and the field: ⌘P puts the keyboard above the tree

**What exists at its end.** ⌘P, Go ▸ "Go to file" and the palette's row show Files and put the keyboard in a field above the tree, in a tab whose tree is folded or has no room as well; Esc gives the keyboard back; the row is disabled where decision 11 says. The field holds text and lists nothing yet: with text in it the tree stays drawn.

**What it touches.** `src/shared/keymap/actions.ts` and `actions.test.ts`; `src/main/menu.ts` and `menu.test.ts`; `src/renderer/src/tools/code/files/finder.ts` (new) and its test; `files/Finder.tsx` (new) and its test; `files/tree-state.ts` (the field's text, the finding tab, `treePlace`) and its test; `files/FilesTool.tsx` (the field above the tree; `finding` into `treePlace`; the tree's button); `tools/code/editor/register.ts` (one connection beside `connectOpenFile`); `tools/code/copy.ts`; the keymap's other tests where they list every row (`settings-tab/keymap.test.ts`, `KeymapSection.test.tsx`, `palette/CommandPalette.test.tsx`).

**Interfaces.** Exposes §A and §C's `filter` half. Consumes `showFiles` (`files/tabs.ts`); `surfaceSession` (`panel/surface-model.ts`); `useLayout`'s `closeDestination`, `settings` and `overviewOpen`; `registerAction` (`keymap/actions-runtime.ts`); the tree column as U6b-3a leaves it.

**Decisions of this milestone alone.**

1. *The row* stands in `ACTIONS` directly after `palette.open` (§A). `GROUP_OF_PREFIX` gains `files: 'palette'`, so no separator falls between the two; `SHELL_FOCUS_ACTIONS` gains the id. `LANDED` in `actions.test.ts` gains it. It is not in `BUILD_F_ACTION_IDS` and that file is not edited.
2. *The handler* (`goToFile`) in this order: read the side column's session; leave an open page; record the element that has the keyboard, unless it is the document's body or a field of this kind; `showFiles`; mark the tab as finding; make the request for the field. `connectGoToFile` registers it while `canGoToFile(state)` holds and removes it otherwise, following the layout store as `connectOpenFile` does.
3. *The request for the keyboard* is module state of `finder.ts`, one at most, with its takers subscribed so that a drawn one is told at once. Its drop is a pair of one-shot capture listeners on the window for `keydown` and `pointerdown`, set when the request is made and removed when it is taken or dropped. The menu's own key reaches the page before the action does, so the listeners never see the ⌘P that made the request. M1 builds the `filter` half; the `file` half is M2's, on the same request.
4. *The field* is an `<input>` with `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`. Its key handler acts on Enter, Esc and the two arrows only, never on a ⌘ key (root UC-6), and on none of them while `isComposing` is set or the key code is 229. In M1 it acts on Esc alone. Its look is "The look": 33 px with its border, 8 px of padding, the app's own outline inside its box.
5. *The field stands outside the tree's context menu.* `FilesMenu` wraps the tree's list so that a right-click there offers "Open File…" (U6e); the field is drawn above that trigger, so a right-click in it is a text field's own menu. Where the tree stands in the file's place, the "Files" bar comes first and the field under it.
6. *The tree's button* in a file's bar ends finding before it does what it did.
7. *`copy.ts` is compiled by the desk's web app* (it reads `REVIEW_COPY`): the proof adds that package's typecheck, build and test project.

**What it does not touch.** The search, the list and the file's view (M2). `git.lsFiles`. The palette's own list. The panel host's focus request. The Settings ▸ Keyboard section's code: a row that is not rebindable already draws no control. Anything U6b-3a's tests pin.

**What it proves.** B4 in unit tests; of B3 the half that is M1's (⌘P shows the column in a folded and in a narrow tab, and the stored fold is not written); A13; B9's half for the settings and the layout; S2. B3's other half (after Enter the file has the tab and finding has ended) is M2's. Behaviours its tests pin: the menu's Go submenu with "Go to file" directly after "Command palette"; `canGoToFile` false with no session, with the Settings dialog and with the Overview, true with a page open, and the page closed by the handler; `effectiveChord('files.goToFile', …)` null under another action's stored ⌘P, and `isRebindable` false; the request taken by a field mounted later, dropped by a key between (beside the case with no key, which is taken), replaced by a second; a second ⌘P selecting the text; Esc's two steps and what it gives the keyboard back to, a repeating Esc doing nothing more; `treePlace` with `finding` at a roomy and a narrow width, and the stored fold not written (the store's write spied, beside a press of the tree's button that does write); a right-click in the field not opening "Open File…"; in a tab too narrow for both, the bar before the field; the field's focus classes; the tokens guard.

### M2 — The search and the open: the list, its keys, the keyboard in the file

**What exists at its end.** A query replaces the tree with the ranked files; the keys do what decision 5 says; Enter opens and the keyboard is in the file, beside the chat or in the main area; an open filter is asked again as decision 8 says. Acceptance B1, B2 and B5 to B8 hold in unit tests.

**What it touches.** `files/finder.ts` (`parseQuery`, `useFinder`, the request's `file` half) and its test; `files/Finder.tsx` (the list, the keys) and its test; `files/FilesTool.tsx` (the list in the tree's place); `tools/code/viewer/FileViewer.tsx` (the body takes the keyboard for its key); `tools/code/viewer/CodeView.tsx` (the editor takes it from the body); `tools/code/copy.ts`; `src/services/git/ls-files.ts` (`load`) and `ls-files.test.ts`.

**Interfaces.** Exposes §B and §C's `file` half. Consumes §A; 3a's `folderFromEnd`; `openFile` and its `Opened`; `fileKey` (`files/tabs.ts`); `useWorkingFolder`; `pathTarget` and `machineFor` (`ipc/machine.ts`); `useRemoteStanding` and `disabledWords` (U9); from U6b-3a, `statusSet` and the drawn tree's hold on the git store.

**Decisions of this milestone alone.**

1. *The search is one hook* (`useFinder`) that owns S1's states and the generation. The generation is a counter in a ref; every ask closes over the number it went out with, and the two handlers of its promise compare it before they touch anything. The 80 ms wait and the later ask are timers of the hook, cleared on unmount.
2. *The list is a `listbox`.* The list's element has `role="listbox"` and the id the field's `aria-controls` names; each result is a `role="option"` row with a stable id made from its index, which the field's `aria-activedescendant` names for the highlighted row and for no row while none is highlighted; the highlighted row, and it alone, has `aria-selected="true"`; the field's `aria-expanded` is true exactly while the list is drawn. A line (no match, searching, failure, offline) is no option and is announced as a status. The first writing had this contract under M1; it belongs with the list.
3. *Folders are dropped, then the cut:* from the answer's paths those ending in `/` go, the first `FINDER_LIMIT` stay, each joined to the working folder's path.
4. *A refresh's three sources* reach the hook as one call: ⌘P and the field taking the keyboard, from the field; the status's set, from an effect on the git store's entry for the working folder that compares `statusSet` with the one it last saw and keeps nothing when it has seen none. The hook takes no hold of its own on the git store: the drawn tree's stands while the list is in the tree's place.
5. *The file's view.* `FileViewer` gives `FileBody` the key it takes the keyboard under (its tab's id); `FileBody`'s root becomes focusable (`tabIndex={-1}`, the app's focus outline) and carries `data-file-keyboard`; the File artifact's own use of `FileBody` gives no key and nothing changes for it. The body takes a request for its key when it is in view (`inView`, which for the main area already says whether the main area is on screen). `CodeView`, when its editor is made, takes the keyboard if the body that holds it is the document's active element; the body, when it takes a request and an editor is already drawn in it, hands the keyboard on at once.
6. *Enter's open* is `openFile(appSessionId, path, line, { keep: true })`, then the request `{ into: 'file', key: fileKey(machineFor(appSessionId), path) }`, then finding ends. Nothing reads which surface it opened on.
7. *A submodule is listed as the folder it is* (decision 14). In `load`, the one call gains `--stage`; an entry of the answer that begins with a mode, an object id, a stage and a tab is an index entry, and what follows the tab is its path; an index entry of mode `160000` is listed with a trailing `/`; a path the index holds at several stages (a conflict) is listed once; an entry with no such head is an untracked path, as today. Nothing else of the module moves, and the answer's shape is what it was.
8. *The refused repository and the submodule are shown on real git.* Tests beside `git.lsFiles`' own (`src/services/git/ls-files.test.ts`, `GitFixture`) list through a `FileLister` with the real runner: a folder that is no repository answers `source: 'walk'`; one whose `.git/config` holds a line git cannot read throws, and not with `NotARepositoryError`; a good one answers `source: 'git'` with its files as before, an untracked file whose name holds a tab unharmed, a conflicted path once, and its clean submodule as `<path>/` and under no other spelling; and an untracked file whose name begins with an index entry's head, read as decision 14's limit says (listed as what follows its tab), the case that pins today's reading. The window's test then gives the hook a failed result and a walk's result and reads the two lists.

**What it does not touch.** `git.lsFiles`' ranking, its kept list, its roots and its walk. `open-file.ts`, `placeOpen` and `focusPaneElement`. The panel host's focus request and what ⇧⌘F does with the keyboard (U6b-5). The File artifact's view.

**What it proves.** B1, B2, B5, B6, B7, B8 in unit tests; B3's second half (after Enter from a folded and from a narrow tab the file has the tab, finding has ended, and the stored fold was never written); B9's half for what is sent; S1, S3, S4, S5. Also: the list's roles, ids and selected state as decision 2 has them, with `aria-activedescendant` following ↓ and ↑ and empty while an answer is awaited; a result's title; a folder cut at its start; a line wrapping in a 160 px column (its box no wider than the column's). Behaviours its tests pin: `parseQuery` for a plain name, `name:42`, `name:42:7`, `:42` alone, `name:0` and a 300-character text; folders dropped and the cut at 50, with an answer of 200 paths of which 60 are files; every row of S1's table, with the tests S1 names; the offline line with a machine's name and no ask sent, beside the same hook asking when the phase is up; S3's four tests; S4's test; B8's three folders; the one command sent and its three keys; the tokens guard.

### M3 — The scenes, the record, and the acceptance run

**What exists at its end.** The scenes of B1 and B3 to B7 are written and typechecked, the register's row of l5-code-09 and the tracker say what landed and what is left, and the whole unit suite has run once on the final head.

**What it touches.** `e2e/code-tools.spec.ts`, `e2e/ux2-shell.spec.ts`, `e2e/browser.spec.ts`, `e2e/remote.spec.ts` (Interfaces §G names each scene and what it waits on); `docs/tech-debt-tracker.md`; `docs/doperpowers/evidence/ux-wave-2026-11/register.md` (the row of l5-code-09); this document's Progress and record.

**Interfaces.** Consumes the markers of §A to §C. Exposes nothing.

**Decisions of this milestone alone.**

1. *Every scene this landing adds or edits is written to run alone.* It is run alone on a Mac's host lane at the landing's head before any whole group or union of groups ("Proof that an executor does not run", 3): a scene that needs another scene's leftovers is a fault of the scene. A scene that claims a position, a size or a pixel prints the boxes it measured in its failure message from its first writing.
2. *A scene waits on what it then reads.* Each scene's description in §G says what it waits on: the field being the active element, a row's presence by its marker, a tab's marker for the file, the active element being inside the file's text. No scene reads a count, a position or the keyboard's place after an act it did not wait for, and none sleeps.
3. *No scene asserts a time.* G4's wait on the new file's row has a timeout of 30 s, which covers the later ask; it asserts the row, not how long it took.
4. *A scene triggers Go to file by the menu row's own click* (`e2e/support/menu.ts`), which is what its accelerator does, and reads the accelerator from the menu.
5. *The tracker* gains R7's row (fewer than 50 shown while more match), R9's edge (the session's added folders are not searched), decision 8's two cases no refresh sees, a machine on an older build listing a clean submodule as a file (decision 14), decision 14's limit (an untracked path whose name begins with an index entry's head is read as one), and whatever the review defers.
6. *The acceptance run* is Concrete Steps 7.

**What it does not touch.** Product code. A scene that fails to typecheck against M1's or M2's markers is fixed in the scene; a product fault a scene's writing exposes goes back to its milestone's executor through the controller.

**What it proves.** That the scenes compile and the gate's own script tests pass over them; B10 whole; and the last unit run. The scenes themselves prove B1 and B3 to B7 when the architect runs them.

## Concrete Steps

Working directory for every command: the branch's worktree (the controller's brief names it). The VM sees only what is pushed. `vmcheck.sh` prints `vmcheck: ux-wave/U6b-3b at <short sha>`, then the command's own output, and exits with the command's status; do not pipe it into `tail` or `head` without `set -o pipefail`. Below, `vmcheck` stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b-3b --`. Its first call for the branch installs dependencies and can take twenty minutes. The remote command runs under `set -euo pipefail`: begin it with `set +e;` when every part's result is wanted. The VM is shared: a check that is slow is read against its load first. Every command there runs under `timeout <seconds>`.

1. **Before anything, once.** U6b-3a is in the branch:

       grep -n "export function statusSet" src/renderer/src/tools/code/files/changed.ts
       grep -n "data-files-changed" src/renderer/src/tools/code/files/FilesTool.tsx

   Expected: one line each. If either prints nothing: stop and report; this landing is not built on a head without U6b-3a. Then read "Statements to check again" against the tree.

2. **Before each milestone:**

       git fetch origin master && git merge origin/master
       git push origin ux-wave/U6b-3b

   A merge, never a rebase or a force-push. After a merge that brought changes, run the previous milestone's proof again (the same set, not the whole suite).

3. **The tests before the modules** (M1 and M2). Commit the cases of the milestone's "What it proves" with the new exports naming nothing; push; run them; the cases that assert the new behaviour fail and those that assert what stays pass. Then build.

4. **While building**, after each push:

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 pnpm exec eslint <the paths changed>'
       vmcheck 'timeout 900 pnpm exec vitest run <the test files touched>'

   The web project for both milestones; the node project for M1's edits of `src/shared/keymap` and `src/main`, and for M2's edit of `src/services/git/ls-files.ts`. A filter given to vitest is a substring of file paths: give paths, never a bare word.

5. **Each milestone's proof** is the typecheck of the projects it changed, eslint on its changed files, and vitest over the folders it touched and those that import what it changed:

   - M1: `src/shared/keymap src/main/menu.test.ts src/renderer/src/tools/code src/renderer/src/keymap src/renderer/src/palette src/renderer/src/settings-tab src/renderer/src/app test/support/tokens-guard.test.ts`
   - M2: `src/renderer/src/tools/code src/renderer/src/tools/artifacts src/renderer/src/panel src/renderer/src/shell src/renderer/src/composer/mentions src/services/git test/endpoint/checkout-rows.test.ts test/support/tokens-guard.test.ts`

   as `vmcheck 'timeout 1800 pnpm exec vitest run <the list>'`. Expected: every file passes but those the build brief lists as failing or timing out on the VM (the code viewer's follow-the-file case among them: shown passing alone). In every milestone, list the importers outside the project changed (`grep -rlE "src/(renderer|shared|services|artifacts)/" apps/*/src | xargs grep -lE "<the file's path without extension>"`, followed through the files it names until no new one appears). Known at authoring: the desk's web app reads `tools/code/copy.ts` directly. So M1 and M2 each add

       vmcheck 'timeout 900 pnpm --filter desk-web typecheck'
       vmcheck 'timeout 900 pnpm --filter desk-web build'
       vmcheck 'timeout 900 pnpm exec vitest run --project desk-web'

   to their proof; M2 adds them again if `FileViewer.tsx` or `CodeView.tsx` turns out to be reached from that package.

6. **A scene is typechecked, not run** (M3):

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 pnpm exec eslint e2e/code-tools.spec.ts e2e/ux2-shell.spec.ts e2e/browser.spec.ts e2e/remote.spec.ts'
       vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

   The third is the gate's own script tests, text guards over the scene files and the group lists: they read an `expect(<a time>).toBeLessThan(<a number>)` as a raw time bound, and a name that ends in `At` or `Ms` counts as a time. No scene of this landing has such a line.

7. **The acceptance run** (M3's last step), on the pushed head, after a last merge of master:

       vmcheck 'timeout 2400 pnpm typecheck'
       vmcheck 'timeout 1800 pnpm lint'
       vmcheck 'timeout 3600 pnpm test'

   Expected: each exits 0, apart from the files the build brief lists as failing or timing out on the VM, each of which is shown to pass alone (`pnpm exec vitest run <file> --testTimeout 60000`) or to fail on master there; vitest's summary names no other failed file. The whole unit suite runs this once, by M3's executor, and by no earlier milestone. Against these runs: B2, B8, B9 and B10 are the suites as each milestone's "What it proves" names them; B1 and B3 to B7 have a unit half there and a scene that is the architect's.

8. **Stop and hand back.** M3's executor writes into Progress what ran and what is left, pushes, and stops. Class 1a (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b-3b`), the branch review, the e2e runs and the pull request are the architect's.

## Interfaces and Dependencies

### §A. The action, the handler and the field (M1)

    // src/shared/keymap/actions.ts, directly after 'palette.open'
    'files.goToFile': { title: 'Go to file', chord: 'Cmd+P', sink: 'menu', menu: 'go', scope: 'app' },
    // src/main/menu.ts: GROUP_OF_PREFIX += files: 'palette'; SHELL_FOCUS_ACTIONS += 'files.goToFile'

    // src/renderer/src/tools/code/files/finder.ts (new)
    export function canGoToFile(state: LayoutState): boolean;      // decision 11 (R5): a session for the side column, no Settings dialog, no Overview
    export function goToFile(): void;                              // the handler
    export function connectGoToFile(): () => void;                 // keeps the action registered while `canGoToFile` holds

    // src/renderer/src/tools/code/files/tree-state.ts: SessionTree, this run's only
    filter: string;                          // the field's text, the session's
    finding: string | null;                  // the tab ⌘P chose, while the search lasts (decision 9)
    treePlace(input): TreePlace;             // today's five inputs, and `finding: boolean`
      // holdsFile false: 'alone'. Room for both: finding ? 'beside' : folded ? 'folded' : 'beside'. No room: finding || shown ? 'instead' : 'folded'.

**The marker:** `[data-files-filter]` on the field.

### §B. The search (M2)

    // src/renderer/src/tools/code/files/finder.ts
    export const FINDER_ASK = 200;           // git.lsFiles' limit, the command's most
    export const FINDER_LIMIT = 50;          // the files shown
    export const FINDER_WAIT_MS = 80;        // after the last keystroke, the `@` menu's
    export const FINDER_AGAIN_MS = 10_500;   // a refresh's later ask: just past the ten seconds the daemon keeps a folder's list (CACHE_MS, src/services/git/ls-files.ts)
    export function parseQuery(text: string): { query: string; line: number | null };   // decision 2
    export type FinderState =                                                           // S1
      | { status: 'empty' }
      | { status: 'waiting'; shown: readonly string[] | null; held: boolean }
      | { status: 'answered'; rows: readonly string[]; at: number; refreshing: boolean }
      | { status: 'failed' }
      | { status: 'offline'; words: string };
    export function useFinder(appSessionId: AppSessionId, directory: string | null, text: string): {
      state: FinderState;
      onKey(event: KeyboardEvent<HTMLInputElement>): void;                      // decision 5
      choose(index: number, how: { keep: boolean; main: boolean }): void;       // a row opened: Enter keeps; a click as decision 6
      refresh(): void;                                                          // decision 8: ⌘P, and the field taking the keyboard again
    };

`rows` are absolute paths: the working folder's path joined with the answer's. The generation and what is owed are the hook's own and are not exposed.

    // src/services/git/ls-files.ts, in `load` (decision 14): the one call becomes
    ['ls-files', '--cached', '--others', '--exclude-standard', '--stage', '-z']
    // an entry matching /^[0-7]{6} [0-9a-f]+ [0-3]\t/ is an index entry: its path follows the tab; mode 160000 is listed as `<path>/`; a path is listed once
    // `LsFilesSchema` and `LsFilesInputSchema` are not edited

**The markers:** `[data-files-results]` on the list, with `aria-busy` in `waiting` with rows shown; `[data-files-result]` on a row with `data-path` (absolute); `[data-files-line]` on a line, with `data-line` one of `none`, `searching`, `failed`, `offline`.

### §C. The request for the keyboard (M1 the `filter` half, M2 the `file` half)

    // src/renderer/src/tools/code/files/finder.ts
    export type KeyboardRequest = { into: 'filter'; tabId: string } | { into: 'file'; key: string };
    export function requestKeyboard(request: KeyboardRequest): void;     // replaces any earlier one; dropped by the next keydown or pointerdown
    export function takeKeyboard(request: KeyboardRequest): boolean;     // true once, for the taker the request names; false for any other
    export function useKeyboardRequest(request: KeyboardRequest | null): number;   // changes when a request for this taker is made, so a drawn taker runs its effect

    // src/renderer/src/tools/code/viewer/FileViewer.tsx
    FileBodyProps += takesKeyboard?: string;   // the key the body takes the keyboard under; FileViewer passes its tab's id, the File artifact's view passes none

**The marker:** `[data-file-keyboard]` on a file view's body that takes the keyboard, with `data-key`.

### §D. What is stored and sent

"What is stored and sent" above: nothing of either. This section exists so that a reader who looks for the wire in Interfaces finds the answer here: no schema of `src/shared/ipc/` is edited and `WIRE_MINOR` does not move.

### §E. What this landing consumes, and what a later landing may rely on

**Consumes from U6b-3a, by name:** `folderFromEnd` (`files/path-cut.ts`) for a result's folder; `statusSet` (`files/changed.ts`); the drawn tree's hold on the git store for the working folder (`SessionTree`), and the store's entry for it (`useGit`, `checkoutKey`); the tree column's one list, in whose place the list is drawn, with the Changed group's rows gone with the tree's while a query stands; `FILES_COPY` as it leaves it; the block "UX wave U6b-3a" and the scratch-repository block of `e2e/code-tools.spec.ts`. It consumes neither of 3a's wire keys.

**Consumes from the other landings, by the name each is exposed under:** from U6b-1, `showFiles`, `openFile` with `keep` and its `Opened`, `fileKey`, the tree column and `treePlace`, `useTreeState`; from U6b-2, `FileViewer`'s `host` and `inView`; from U8a and U8c-2, `useWorkingFolder` and `workingFolder`'s `path`; from U8b, `surfaceSession` and the side column's showing of a tab; from U7b, `closeDestination` and the dialog's and the Overview's state in the layout store (root UC-12); from U6a, the action table's shape, `effectiveChord`, `isRebindable` and the rule that a new id takes no rebinding; from U6e, the pattern of `connectOpenFile` and the tree's context menu; from U9, `useRemoteStanding`, `disabledWords` and the link's phases.

**A later landing may rely on:** `[data-file-keyboard]` and `requestKeyboard({ into: 'file', key })` as the one way to put the keyboard in a file's text wherever the file is drawn (U6b-5's question of what ⇧⌘F focuses, and of a file as a place, can use both); `goToFile` as the one way to the field; `useFinder`'s generation rule as the pattern for any other list that is asked while a person types.

### §F. Files other children own, or several landings edit (root UC-8)

| file | owner | this landing's insertion |
|---|---|---|
| `tools/code/files/FilesTool.tsx`, `tree-state.ts`; `tools/code/copy.ts` | U6; edited by U6b-3a just before | the field above the tree and the list in its place; two run-only fields and one input of `treePlace`; keys of `FILES_COPY` |
| `tools/code/viewer/FileViewer.tsx`, `CodeView.tsx` | U6; `FileViewer` edited by U6b-2 | one optional prop and the body's taking of the keyboard; the editor's taking it from the body |
| `tools/code/editor/register.ts` | U6 | one connection |
| `palette/CommandPalette.tsx` and its test | U6 | `files.goToFile` among the actions the palette runs after its close (`afterClose`), so that Esc's second step finds the palette's opener (Decision Log 9) |
| `src/services/git/ls-files.ts` and its test | no child | `load`: one flag on its one git call and the reading of its answer (decision 14); the tests of decision 4 and of a submodule |
| `e2e/remote.spec.ts`, `e2e/browser.spec.ts` | the P5 work; U12 | one scene each |
| `docs/tech-debt-tracker.md`, the register | the wave's record | rows |

Read and not edited: `src/renderer/src/stores/git.ts`; `files/changed.ts` (U6b-3a); `tools/code/open-file.ts`, `files/tabs.ts`; `src/shared/ipc/remote-unavailable.ts` and `lane-b/remote-standing.ts` (U9); `panel/` (U8); `stores/layout.ts` (U13); `main/pane-dom.ts`; `composer/mentions/AtMenu.tsx`, the lister's other caller; `src/services/git/runner.ts`; `src/shared/keymap/build-f.ts`. Everything else this landing edits is U6's by the root's table: `src/shared/keymap/`, `src/main/menu.ts`, `tools/code/files/`.

### §G. The e2e groups whose scenes cross this change

Written in M3, typechecked there, run by the architect on a Mac. Every repository a scene uses is made by the scene with invented names.

| group | file | the scene, and what it waits on before it reads |
|---|---|---|
| `e2e:code` | `e2e/code-tools.spec.ts`, a new block "UX wave U6b-3b" over a scratch repository | **G1** "Go to file from the composer: the field has the keyboard; a name lists files; ↓ and Enter open the second as a kept tab with the keyboard in the file; `name:line` lands on the line; Esc twice returns the tree and the keyboard". Waits on the field being the active element; on the list not busy and holding the expected row; on the file's tab marker and the active element being inside that file's text; on the line's witness the existing "jumps to the line" scene uses; on the tree's list being drawn again before it compares the offset read before ⌘P; on the composer's editor being the active element |
| | | **G2** "a folded tree is shown for the search and folded again; in a narrow tab the column stands in the file's place". Waits on `[data-files-tree][data-place]` at each step; reads `files.tree` through the layout's own read for the session's `folded`, true before and after |
| | | **G3** "a file already open in the main area: found and entered, its tab comes forward and typing goes into its text". Opens the file with ⌘-click, brings another tab in front, runs Go to file and Enter; waits on the main tab being selected and on the active element being inside `[data-file-keyboard]` with that file's key; then types one character and waits on the file's unsaved mark |
| | | **G4** "an open filter follows a new file". With a query's answer drawn, writes a matching file from the test's process, presses no key, and waits (30 s) on its row; the highlight's row is the one it was |
| | | the existing scene "the Files tree and the viewer use tokens only in both themes" gains the field, the list and each line |
| `e2e:layout` | `e2e/ux2-shell.spec.ts` | **G5** "Go ▸ Go to file stands under Command palette with ⌘P; disabled with no session, with Settings open and with the Overview open; enabled with a session; the sheet lists it under Go". Polls the menu item's `enabled` to the value each state calls for |
| `e2e:browser` | `e2e/browser.spec.ts` | **G6** "with the keyboard in a page of the in-app browser, Go to file puts it in Files' field". Waits on the page's own focus witness first, then on the field being the active element of the app's page |
| `e2e:remote` | `e2e/remote.spec.ts`, beside U6b-3a's scene | **G7** "a session on B: Go to file lists a file that exists on B alone; with B stopped the list says B is offline; with B back the text is asked again". Waits on the result's row; after B stops, on the link's offline mark before it reads the line; then sets the tree's column to 160 px and reads the offline sentence whole, the line's box no wider than the column and its text not clipped (the boxes printed on failure); after B starts, on the row again |

A scene of another landing's that crosses the code this one edits and must still pass: U6b-3a's block and U6b-1's block of `e2e/code-tools.spec.ts`, U6b-2's scenes of a framed file's tab (the file view's body is now focusable), U6e's scenes of the tree's context menu, U6a's scene of the three surface chords and the grouped menus in `e2e/ux2-shell.spec.ts`.

## Statements to check again

Twice over: this document is written before U6b-3a is built, and against a chain whose fourth batch is still in review. Before M1 starts, and at each merge of master, the executor reads each row against the tree it then has and reports a statement that no longer holds instead of building on it.

| the statement here | rests on | where it is used | at `05556372c` (2026-11-17) |
|---|---|---|---|
| `statusSet(status)` exists and is equal for two statuses with the same entries in the same states | U6b-3a's `files/changed.ts`, as built | decision 8; M2 | holds: `statusSet` (`files/changed.ts:112`) is the JSON of each entry's path, two letters and untracked flag, in the status's order |
| the drawn tree holds the git store's watch for the working folder, and stays mounted while another list stands in the tree's place | U6b-3a's `SessionTree` in `FilesTool.tsx`, as built | decision 8; M2 decision 4 | holds: `SessionTree` takes `useGit`'s watch of the working folder while it is mounted (`FilesTool.tsx:348`); the list is to be drawn where `SessionTree` keeps it mounted |
| the tree column draws one list under `FilesMenu`, and there is room for a row above it outside that trigger | `FilesTool.tsx` as U6b-3a, U6b-2 and U6e leave it | M1 | holds: `SessionTree` draws one `TreeList` inside `FilesMenu`; the column's `div[data-files-tree]` holds `SessionTree` alone, so a row above it stands outside the trigger |
| `treePlace` has five inputs and four answers | `files/tree-state.ts` as U6b-1 leaves it (U6b-3a adds only run-only fields beside it) | decision 9; §A | holds: `treePlace({ holdsFile, tabWidth, treeWidth, folded, shown })` answers `alone`, `beside`, `folded`, `instead` |
| `FileViewer` passes `FileBody` its tab's id, `host` and `inView`; `FileBody` is also the File artifact's body | `viewer/FileViewer.tsx` as U6b-2 leaves it | decision 10; M2 decision 5 | holds: `FileViewer` gives `FileBody` `tabId={tab.id}`, `host` and `inView`; `ByteViewer.tsx` (the File artifact) draws `FileBody` with no host |
| `openFile` answers `surface: 'main'` for a file a main tab already shows, and brings that tab forward | `tools/code/open-file.ts`, `files/tabs.ts` (`placeOpen`) | decision 10; S3 | holds: `place` answers `{ surface: 'main', tabId: key }` after `layout.openTab`, which activates an open tab unless `activate: false` |
| `registerEditor` is where `connectOpenFile` is connected | `tools/code/editor/register.ts` | M1 | holds: `registerEditor` connects `connectOpenFile()` (`editor/register.ts:125`) |
| `git.lsFiles` keeps a list ten seconds from its load, checks the age only at a request, and walks only for `NotARepositoryError`; `load` makes one `ls-files` call and splits its answer at NUL | `src/services/git/ls-files.ts`, `runner.ts` (not changed by the chain) | decisions 4, 8 and 14; `FINDER_AGAIN_MS` | holds: `CACHE_MS`, the age read in `list`, the one `ls-files … -z` call split at NUL, `NotARepositoryError` alone walked |
| `folderFromEnd(folder, room, measure)` exists and answers null under two characters | U6b-3a's `files/path-cut.ts`, as built | decision 4; "The look" | holds: `folderFromEnd(folder, room, measure)`, null when `00` does not fit |
| the `@` menu sorts a path that ends in `/` among its folders | `composer/mentions/AtMenu.tsx` | decision 14 | holds: `directory = path.endsWith('/')`, folders after files (`AtMenu.tsx:69-77`) |
| `disabledWords(command, standing, label)` words the offline phase for a command with no row of its own from the label | `src/shared/ipc/remote-unavailable.ts` as U4b's and U10b's rows leave it | decision 4 | holds: `git.lsFiles` has no row in `REMOTE_UNAVAILABLE`, `ACT_WORDS` or `REMOTE_NEEDS`, so the label words the offline phase |
| a text field's own keys are not taken by the page's dispatcher for a pane-scoped or composer-scoped row | `src/renderer/src/keymap/dispatcher.ts`, `useKeyChord.ts` as the chain leaves them | decision 5 | holds: `refusedByTarget` refuses a text entry for a pane-scoped row and anything outside `[data-key-sink="composer"]` for a composer-scoped one; the request card's claiming bindings claim only a press of their own prompt |
| `FILES_COPY` and `REVIEW_COPY` are two objects of `tools/code/copy.ts`, and the desk's web app reads the second | `copy.ts` as U6b-3a leaves it | M1, M2 | holds: both are exports of `copy.ts`; `apps/desk-web` imports `REVIEW_COPY` (`DiffPane.tsx`, `ReviewView.tsx`) |
| the scenes' anchors: U6b-3a's and U6b-1's blocks in `e2e/code-tools.spec.ts`; U6a's scene in `e2e/ux2-shell.spec.ts`; U6b-3a's scene in `e2e/remote.spec.ts` | those files | M3; §G | holds: "UX wave U6b-1: a file opens beside the chat" and "UX wave U6b-3a: Files shows what changed" in `code-tools.spec.ts`; U6a's ⌘J/⇧⌘D/⇧⌘F scene in `ux2-shell.spec.ts`; U6b-3a's G3 in `remote.spec.ts` |

## Size and review

Counted file by file from the code at `bdbfe863e` and from 3a's document, tests and scenes included; a new file is counted whole.

| milestone | files | changed lines, about | of which product code |
|---|---|---|---|
| M1 | 14 | 480 | 200 |
| M2 | 10, 5 of them not touched by M1 | 1,100 | 410 |
| M3 | 6 | 380 | none |
| **the landing** | **about 27** | **about 1,950**, between 1,700 and 2,200 | **about 610** |

M2 is the first writing's search grown by the review: a test per row of S1 in both orders, the file's view for the main area, the refresh.

**Review.** One reviewer at the high rung (`doperpowers:reviewer-high`), as ruled on R3: the landing is in the window but for one function of the daemon's lister, stores nothing and sends nothing new. By the count it stands near the mark for a panel (about twenty files, two thousand lines); if the build passes it, the architect rules again. The reviewer's attention belongs first on S1 (the generation) and S3 (where the keyboard ends up).

## Proof that an executor does not run

Each is a step with what it needs, handed to the architect.

1. **The branch**, cut from U6b-3a's head once that landing is built. Needs: 3a's final head.
2. **The owner's look and answer: done** (2026-11-17; Decision Log 6 and 7). If the build departs from the drawn frames in a way the measurements do not cover, the frame is drawn again before it is built.
3. **The scenes on a Mac** (§G). **Every scene this landing adds or edits runs alone first**, on the Mac's host lane at the landing's head: G1 to G7 and the tokens scene it extends, one at a time, before any whole group or union run. This is a binding rule of the wave: a batch's union showed five reds in scenes that had never run alone. Then `e2e:code`, `e2e:layout`, `e2e:browser` and `e2e:remote` whole on the final head. A scene that claims a position or a pixel prints its measured boxes when it fails. Needs: the final head; the load rule.
   Also the Mac lane's unit case: `src/services/git/ls-files.test.ts` runs real git, and a Mac's own git is another build of git than the VM's; decision 14's reading of `--stage` is to be shown there too.
4. **Hands on, in the owner's sitting:** ⌘P under the Korean input source (the child's probe 6 lists every new menu chord), and Korean typed into the field: a syllable still being composed must not be opened by the Enter that commits it. Needs: the wave's build on a machine with that input source. It joins the sitting's script; it holds no milestone.
5. **Class 1a** on GitHub Actions (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b-3b`), once, on the complete branch; **the branch review** and its fix waves. No cross-build run is owed by this landing; the group runs as the chain's rule has it, and its existing scenes pass.
6. **The chain's merge and the landing:** "Statements to check again" read once more; the pull request.
7. **The board:** ticket 672 and the register's row of l5-code-09 closed through the board scripts, U6b-3a being on master.

## The pull request

Opened by the architect when U6b-3a is on master. Its body is the short form the owner chose on 2026-11-17, and nothing longer: **the proof** (class 1a's run and the Mac runs with the commit each ran on, the review's verdict), **what differs from the plan** (each place the build departs from this document, with its Decision Log entry), **what is left over** (tracker rows, what was not run, what waits for the owner's hands or eyes). It ends with `Closes #672` (or the ticket the architect registers for this half), a blank line, and the session line of Constraint 1. It carries no amendment of a reversed ruling: the child's "Rulings reversed" names none for l5-code-09, and ⌘P was free (the child's table of collisions).

## Surprises & Discoveries

- Observation: `git.lsFiles` answers folders among its files, ranked with them, and cuts at its limit before a caller can leave them out.
  Evidence: `withDirectories` and `rankPaths(query, listing.paths).slice(0, limit)` in `src/services/git/ls-files.ts`; the `@` menu sorts `directory` rows last after the fact (`AtMenu.tsx`).
- Observation: the daemon's kept list of a folder's files has no expiry of its own: its age is read only when a request comes (the review's finding 5; the first writing claimed a bound it does not give).
  Evidence: `if (cached !== undefined && Date.now() - cached.at <= CACHE_MS && …) listing = cached; else … load` in `FileLister.list`; no timer in the module.
- Observation: `git.lsFiles` walks only where git says "not a git repository"; any other refusal of git fails the command (the review's finding 6).
  Evidence: `load` catches `NotARepositoryError` alone and rethrows the rest; `createGitRunner` makes that error from the one message.
- Observation: the `@` menu's guard against a stale answer is per call, not per text (the review's finding 3).
  Evidence: `let live = true; … return () => { live = false; }` in `useFiles`' effect (`AtMenu.tsx`): a later call of the effect makes every earlier call's answer void, whatever its text.
- Observation: nothing puts the keyboard in a file that opens, and the one helper for the main area focuses a tab's button (the review's finding 4).
  Evidence: `FilesTool.tsx` reads no `ctx.focusRequest`; `focusPaneElement` (`main/pane-dom.ts`) queries `[role="tab"][aria-selected="true"]`; `placeOpen` answers `{ to: 'main' }` when a main tab shows the file.
- Observation: Desktop's remembered Enter fires only if the remembered text is still the field's, and a blur or Esc forgets it.
  Evidence: `c9bd7af9c-DlJ4cmuC.js:8449-8459` (the effect), `:8512` (the press), `:8477-8495` (Esc), `:8660-8663` (blur).

- Observation: git lists a clean submodule among a repository's files, as its path with no trailing slash, and says what it is only with `--stage` (the delta review's finding 5).
  Evidence: a scratch repository on a Mac, with a tracked file, an untracked file whose name holds a tab, and a submodule: `ls-files --cached --others --exclude-standard -z` answers `…|a.txt|vendor/sub|`; with `--stage` the tracked entries are `100644 <id> 0`, a tab and the path, the untracked ones the bare path, and the submodule `160000 <id> 0`, a tab and `vendor/sub`.

- Observation (M1): the palette runs an action while its own input holds the keyboard; the actions that must start from the shell's own focus wait for its close (`afterClose`, `palette/CommandPalette.tsx`).
  Evidence: the red case "runs Go to file after the palette gives the keyboard back to its opener…" (`CommandPalette.test.tsx`), which saw the palette's input recorded for Esc.
- Observation (M1): the tree's first read of a run replaced a stored session's tree whole, run-only fields included, so a ⌘P made before it answered lost its finding tab and its text.
  Evidence: the red case added at `fbd580486` (`tree-state.test.ts`), fixed at `5b4499468` by carrying the two run-only fields over the read.
- Observation (M1): `showFiles` lands in a tab that holds a file only through `lastInViewOf`, which the panel host notes (`connectPanelHost`); a unit test that does not connect it gets a new tree-only tab.
  Evidence: `files/tabs.ts` `showFiles`; the M1 test commit `e0dcf5b2d`.
- Observation (M1): the narrow window's surface sheet closes on any window Esc that is not prevented (`PanelRegion`); the field prevents the Esc it acts on.
  Evidence: `SurfaceSheetDismissal` in `panel/`.
- Observation (M2): only the front main tab's body is mounted (`main/Pane.tsx`, `TabBody key={active.id}`), so a main tab brought forward by Enter reads its file afresh: the keyboard is on the body first, then in the editor.
  Evidence: `finder-open.test.tsx`'s main-tab case.
- Observation (M2): the file view's body is focusable now (`tabIndex={-1}`), so a click on a part of the view that takes no focus (the bar's empty space, a notice) puts the keyboard on the body rather than the page's body; ⌘S and the comment key then act there. U6b-2's framed-file scenes are read with this in mind.
  Evidence: `FileBody` in `viewer/FileViewer.tsx` at M2's head.

## Decision Log

1. **2026-11-17 (UTC) · The verification call.** The first writing of U6b-3, which held this landing as its third milestone, got an adversarial review before any executor started (entry 2); this document is its revision and goes to the architect, who decides whether the half as rewritten gets a second review. The branch gets `doperpowers:review-code` with one reviewer at the high rung, ruled on R3: the window and one function of the lister, nothing stored, nothing sent. Class 1a on GitHub Actions is the gate of record. The pull request's body is the short form: the proof, what differs from the plan, what is left over.
2. **2026-11-17 (UTC) · The adversarial review of the first writing (`5a73f8fa3`).** Seven findings, all P2, none P1; the architect read each cited place at that commit and all hold; all accepted. In this document: finding 3 (a request's identity) by a generation per ask, to which a held Enter is bound, stale successes and failures both dropped; finding 4 (the keyboard for a file in the main area) by the file's view taking the request by the file's key wherever it is drawn; finding 5 (an open filter's answer) by three refreshes that each ask at once and once more past the daemon's ten seconds, with the false bound corrected; finding 6 (a refused repository) by the failure line there and the walk only for no repository. Findings 1, 2 and 7 are fixed in 3a's document.
3. **2026-11-17 (UTC) · The split, ruled by the session that keeps master.** U6b-3 is two landings and no three: U6b-3a (what changed; built on `ux-wave/U6b-3`) and U6b-3b (this document; a branch the architect cuts from U6b-3a's head). Chain order: U6f, U6b-3a, U6b-3b, U6b-5. Moved here from the first writing, not copied: its decisions 16 to 25, its sequences S3 to S5 and the filter's half of S7, its acceptance B4 to B8 and the filter's half of B9, its second card, its third milestone and the scenes G3 to G6 with the filter's half of G7. The request for the keyboard and the focusable file view are built here, the landing that first needs them; U6b-3a builds neither.
4. **2026-11-17 (UTC) · Ruled on the reported points and the card.** R3: one reviewer at the high rung for this landing, the panel for U6b-3a. R5 accepted as UC-12 has it. R7 accepted, with a tracker row. R9 accepted. The card (⌘P while the tree is folded away) stays as written, built at its recommended option. R1, R2, R4, R6 and R8 are U6b-3a's.

5. **2026-11-17 (UTC) · The delta review of both documents at `a262a2436` (one reviewer, medium rung), and the rulings.** The architect read every cited place; all hold. In this document: (3) a refresh that falls while an answer is awaited is kept as owed and issued when that request settles, answered or failed, the held Enter bound as before; a test moves the clock past `FINDER_AGAIN_MS` before it resolves the original ask and shows the second ask go out (decision 8; S1); (5) a clean submodule came from the lister as a file: settled by the preferred route, the daemon's lister reads the mode (`--stage`) and lists a gitlink as a folder for every caller, one place with a case over real git, and the sentence "no change in the daemon" is corrected to "one function of the lister" wherever it stood (decision 14); (6) B3 is proved in two halves, the showing and the unwritten fold in M1, the open and the end of finding in M2; (7) the list's `listbox` of `option` rows, the ids `aria-activedescendant` names and the selected state are M2's contract again (M2 decision 2); (9) every scene the landing adds or edits runs alone on a Mac before any group or union, and a position claim prints its boxes. Findings 1, 2, 4 and 8 are U6b-3a's. Chosen within finding 5 and to be confirmed: the gitlink is listed as a folder, not dropped, so that the `@` menu keeps a way to name a submodule's folder.
6. **The architect's rulings on the drawn example's notes** (nine frames at real sizes and 24 notes, kept outside the repository), each a line of this log:
   - 2026-11-17 (UTC) · Note 6: the field takes the app's existing text-field focus style, `outline-accent focus-visible:outline-2`, inside its box, and no default ring; its horizontal padding is the tree's root indent, 8 px ("The look").
   - 2026-11-17 (UTC) · Note 7: in a tab too narrow for both, the "Files" bar, then the field under it ("The look").
   - 2026-11-17 (UTC) · Note 9: a result names its folder from the working folder, and U6b-3a's Changed rows now do the same (decision 4).
   - 2026-11-17 (UTC) · Notes 10 and 11: a folder that does not fit is cut at its start, and is not drawn below two characters of room; a result uses U6b-3a's `folderFromEnd` (decision 4).
   - 2026-11-17 (UTC) · Note 12: a line wraps to as many lines as its sentence needs; a scene at 160 px reads the offline sentence whole (decision 4; scene G7).
   - 2026-11-17 (UTC) · Note 13: the field is 33 px with its border, so its line meets the file bar's ("The look").
   - 2026-11-17 (UTC) · Notes 15 and 17: the folder in the list and the field's placeholder take `fg-muted`, not `fg-faint`; the decisions' word "muted" governs ("The look").
   - 2026-11-17 (UTC) · Note 23: a result row's title is its path from the working folder; a result carries no status letter (decision 4).
   - 2026-11-17 (UTC) · Notes 22 and 24: accepted as written and drawn (the field stands in every tree column, also at rest). Note 8: option C of the card was a sketch; it was not chosen.
   - Notes 1 to 5, 14, 16 and 18 to 21 are about the Changed group and the tree: U6b-3a's log.
7. **2026-11-17 (UTC) · The owner's answer on the card "⌘P while the file tree is folded away"** (recorded on ticket 672, comment 6943042432), verbatim: "Show it, then fold again (Recommended)". It is option A, which decision 9 built from the first writing on; nothing moves but the card's wording.
8. **2026-11-17 (UTC) · The parent pin, and decision 14's limit.** The branch is cut at U6b-3a's head `05556372c407df2cd92549d9b9fc785de3f16ec1`, which is this document's parent pin until the architect names a later head of 3a to merge. Concrete Steps 1 found U6b-3a in the tree, and every row of "Statements to check again" was read against it and holds (the table's last column). The architect asked for decision 14's one stated limit (an untracked path whose name begins with an index entry's head is read as one): it is written beside decision 14, with a tracker row (M3 decision 5) and a unit case that pins today's reading (M2 decision 8). The Observation on the submodule names no version of git.
9. **2026-11-17 (UTC) · M1's decisions** (executor's report, folded by the controller).
   - The field's component is `files/FinderView.tsx` (and `FinderView.test.tsx`), not `files/Finder.tsx`, wherever this document names `Finder.tsx`: beside `finder.ts` the two names differ only in case, and on a Mac's case-insensitive disk `import './Finder'` resolves `finder.ts`. M2's list goes in `FinderView.tsx`.
   - `treePlace`'s `finding` input is optional (absent is false), so U6b-1's cases stand unedited (Constraint 5); `FilesTab` always passes it.
   - ⌘P records the element that has the keyboard unless it is the body or the field, which keeps an earlier record (S2's "⌘P twice"); the Esc that uses a record consumes it.
   - The tree's button pressed while finding ends finding and hides the column it showed; with room for both it writes the fold only when the stored fold differs from hidden, so a tab the person folded writes nothing, and outside finding the button does what it did.
   - Finding ends when the field loses the keyboard while empty, and not when only the window loses focus (the field is still the active element).
   - The field calls `preventDefault` on every Esc it acts on, a repeating one included, so the narrow window's surface sheet does not close under it.
   - The field takes a request only while its tab is visible.
   - `KeyboardRequest` carries both halves from M1; M2 adds the file's taker on the same calls.
   - The two run-only fields (`filter`, `finding`) are carried over the tree's first read of a run.
   - The field also has `bg-transparent`, `text-fg`, `autoComplete="off"` and `spellCheck={false}`.
   - `palette/CommandPalette.tsx`: `files.goToFile` joins `afterClose` (U6's file, added to §F; the architect told), so that "Go to file" chosen in the palette records the palette's opener for Esc. Red first (`670af724c`), fixed at `e21424434`.
   - Until M2 draws the list, the field's `aria-controls` names an id no element has; M2 closes it.
   - From M1's task review (fixed at `8ae4f86a5`, red first): while finding, the tree's button prevents `mousedown`'s default, so a press leaves the keyboard in the field and the click acts on the column the person pressed (before, the empty field's blur ended finding first and the click unfolded and wrote the fold). Esc in an empty field ends finding synchronously (`flushSync`), so a file the search hid in a narrow tab is shown and no longer inert, and only then gives the keyboard back to the recorded element (`keyboardBefore`, once; null when it has left the page, and then the keyboard and the search stay in the field). Chromium's refusal of focus on a hidden or inert element is not modelled by the unit tests' DOM; scene G2 covers the narrow tab on a Mac.
10. **2026-11-17 (UTC) · M2's decisions** (executor's report, folded by the controller).
   - The S1 machine is one `Search` object that `useFinder` holds for its mount (read through `useSyncExternalStore`); the generation is its field, and each ask's two handlers compare it before they touch anything.
   - `useFinder` also answers `left()` (the field lost the keyboard: a held Enter ends), and `choose` answers `Opened | null`, so Files' double-click pair keeps a narrow tab's file on a row's second click. Any blur of the field ends a held Enter, the window's included (Desktop's rule); M1's end of finding still ignores a window blur.
   - While the machine is offline, a change of the text stays offline and asks nothing; emptied it is `empty`; when the link is back the text is asked at once (decision 4's "nothing is asked" over S1's "any").
   - A query in a session whose working folder the window does not know (no record) shows the failure line, "Files could not be searched." (a case the document did not foresee, with one of its fixed sentences; the architect told).
   - A refresh from `failed` sets no later ask (S1's row as written).
   - `parseQuery`: `name:0` is line 1; a line past the safe integer range is capped there (the tab's `line` is an integer); `:42` alone and `name:` are queries with no line.
   - Arrows and Enter with a modifier are the text field's own; a plain arrow is prevented in `answered` and `waiting`.
   - An earlier empty answer is no drawn rows: typing after "No matching files" shows "Searching files…" until the new answer.
   - `FinderColumn` (`FinderView.tsx`) draws the field and the list in each tree column; while the list stands, `SessionTree` stays mounted and draws nothing (its git and files holds stand) and `TreeList` unmounts, which saves and restores the tree's offset. A column drawn with text in the field asks at once.
   - The tree's row measures (`FILES_ROW_HEIGHT`, `indent`, `useWidth`, `rowFonts`) moved verbatim to `files/row-metrics.ts`, re-exported by `FilesTool.tsx`, so that `FinderView` imports no cycle.
   - While a tab is finding, the narrow tab's press of the tree's button (`shown`) is turned off, so after Enter the file is in the tab and can take the keyboard; Esc in that state gives the file back (decision 9's "where the stored fold and the tab's width put it").
   - The editor takes the keyboard from the body by a `CodeView` prop (`onEditor`), never by a focus listener on the body: a click in the bar's empty part focuses the body and does not jump into the text.
   - The result list stands outside `FilesMenu`; the listbox's accessible name is `FILES_COPY.goToFile` (no new sentence).
   - Above a gitlink the lister lists its parent folders too (`vendor/` for `vendor/sub/`), as for any path.
   - S3's cases are in `files/finder-open.test.tsx`, which draws the main area and the side column as the shell does; one sits a level below Enter, so that its red reads at its own line.
11. **2026-11-17 (UTC) · The architect's rulings on M2's report.**
   - The state "the field holds a query and the window knows no working folder for the side column's session (no record)" shows "Files could not be searched.": kept, one of the fixed sentences; the other two would say something false.
   - In a narrow tab, finding turns off the person's earlier press of the tree's button, under decision 9's "where the stored fold and the tab's width put it": accepted.
   - The file view's body is focusable with `tabIndex={-1}` (no new tab stop), and its outline is drawn under `focus-visible` only (`outline-accent focus-visible:outline-2 -outline-offset-2`), so a mouse click that lands the keyboard on it draws no ring: accepted on those two conditions, the classes pinned by a unit test. M3 names the U6b-2 framed-file scenes that click the bar or a notice, for the Mac run.
   - S1's red evidence is a mutation run on the VM (the generation compare removed and restored, never committed), and the composing Enter's the same where cheap.
   - M3 reads every e2e use of `[data-files-tree]` against the new column (the field, then the list or the tree's wrapper) and adapts each locator or measurement whose meaning changed, or says why it stands; `[data-files-tree]` stays on the column, and the wrapper takes an attribute of its own if a scene must measure the tree alone.
12. **2026-11-17 (UTC) · M2's task review and its fix** (`24ddf5439`..`4fe467660`, red first).
   - A read that fails for an unknown session draws its notice inside the same keyboard-taking body (one root element for both branches of `FileBody`), so the body that had the keyboard keeps it and a later request is taken. `FileViewer`'s own `NoSession` (a tab with no session) is unchanged: no request names such a tab.
   - A path the index holds at several stages is listed once, as `<path>/` when any of its stages is a gitlink and as a file otherwise (M2 decision 7 made whole for a conflict that mixes the two).
   - Every test of M2 that asserts an absence holds its control in the same case (Constraint 10).
   - S1's red evidence (Decision Log 11), three mutations on the VM, none committed. (a) Without the generation compare in `settle`, five S1 cases fail: S5's moved folder, both "landing before the retry's answer" rows, `a`, `b`, `a` with the first answer landing first, and offline-and-back. The "landing after" cases ("a, b, a in the other order", "… landing after the retry's answer") stay green under (a), because `settle`'s state guard drops an answer that lands in `answered` and not refreshing, whatever its generation: the generation compare is pinned by a stale answer that lands while `waiting`, and the state guard by those that land after. (b) Without the composing guard, the composing-Enter cases of `finder.test.ts` and `FinderView.test.tsx` fail. (c) Without decision 12's reset of `shown`, "too narrow, its tree shown in the file's place by the button before ⌘P…" fails.
13. **2026-11-17 (UTC) · M3's decisions added before its dispatch** (the architect's asks).
   - *Every e2e use of `[data-files-tree]` is read against the new column*: the field, then the list or the tree's wrapper. `[data-files-tree]` (with `data-place`) stays on the column, the element the scenes meant. Each locator or measurement whose meaning changed (a box read from the column, a child selector through it) is adapted; the wrapper takes an attribute of its own if a scene must measure the tree alone. Each use is listed as adapted or unchanged with its reason, in the hand-back.
   - *The U6b-2 framed-file scenes that click the file's bar or a notice* are named in the hand-back (the body is focusable now, Decision Log 11), for the Mac run.
   - *Every scene that reaches a shared e2e helper M3 changes* is listed, from a grep of the helper's callers, since each runs alone on the Mac first.
14. **2026-11-17 (UTC) · M3's decisions** (executor's report and its task review, folded by the controller).
   - The menu read the new scenes share (the row enabled with `Cmd+P`, then its click) is one new support file, `e2e/support/go-to-file.ts`, called by the new scenes only; `e2e/support/menu.ts` and every existing helper are unchanged, so no existing scene is reached through a changed helper.
   - Of the 11 e2e uses of `[data-files-tree]`, one is adapted: `sessions.spec.ts`'s "A3, K12" step measures the list (`[data-files-tree] [data-tool="files"]`, the menu's trigger and collision box) rather than the column, which now holds the field above it; the column keeps its least-width check, and prints its box. The other ten read visibility or descendant rows and stand. No product attribute was added: the list's wrapper already has `data-tool="files"`.
   - No U6b-2 framed-file scene clicks the bar's empty space or a notice; the two nearest the focusable body (deliverables' "a hostile PDF's link is a blocked navigation", a click inside the PDF frame; "a read that fails before a PDF's first byte…", Open again in the body) run alone first on the Mac.
   - G1 starts with the side column closed and proves Files opening; its offset check is a second pass with Files open and scrolled. G1b (new) is B1's terminal case: the terminal in the upper group, Files in the lower, the terminal's own textarea focus before Go to file and after Esc twice. G4 waits, with the field empty, on the scratch's own Changed row before it types, since the finder takes its first status as its baseline. G6 focuses the page by main's `webContents.focus()` on its view; G7 takes B's link down and back by the hub's cut and restore and waits on the link's offline phase.
   - The tokens scene draws the "none" and "failed" lines (the other two share the "none" line's classes); the failure line is made by an unreadable `.git/config`, restored in `finally`.
   - The register's row of l5-code-09 reads "built, not yet on master"; the tracker gains six rows (M3 decision 5's five and the palette case's act() warnings); desk-web's chunk-size advice already has a row.
   - The whole suite's one failure off the VM list, `src/engine-host/dashboards/read.test.ts` (a 5 s timeout under load; passes alone at the default), was ruled a load timeout by the architect and added to the VM list.
   - Deferred: `expectLandedOn` (`e2e/support/code-product.ts`) prints a normalised position rather than measured boxes when it fails; G1 uses it as the existing "jumps to the line" scene does.
15. **2026-11-17 (UTC) · The branch review (`doperpowers:reviewer-high`, on `dc95f58fb`..`aee5d1685`): two P2s in the narrow window's surface sheet, ruled by the architect.** A person sees both: in a narrow window, Esc twice and an Enter that lands in the main area close the Files sheet.
   - *Esc's second step in sheet geometry* (the shell narrower than 700 px, Files a surface sheet over an inert main). When the element recorded at ⌘P lies under the inert main, the second Esc ends finding and dismisses the sheet through the sheet's own path, `dismissSheet` (`panel/PanelRegion.tsx`, shared, not copied): the panel collapses and, on the next frame, with main no longer inert, the opener takes the keyboard, else the focused pane. Wherever the keyboard cannot be given back, the field lets Esc reach the sheet's dismissal rather than swallowing it. Decision 5's Esc is otherwise unchanged at full width.
   - *Enter on a file whose tab is in the main area, in sheet geometry.* When `openFile` answers `surface: 'main'` while the shell is a sheet, the sheet is dismissed (the panel collapsed) before the request for the keyboard, so the main tab is on screen and its view takes it (decision 10). A file that opens beside the tree is unchanged.

## Outcomes & Retrospective

**2026-11-17 (UTC), at the end of M3 and the merge of U6b-3a's final head.** Go to file is built in the window and the lister's one function, as designed: ⌘P (and Go ▸ Go to file, and the palette's row) puts the keyboard in a field above Files' tree, shown for the search in a folded or narrow tab and folded again after, with nothing stored; a query lists the working folder's files only (folders and submodules dropped, the first 50), with the keys, the held Enter bound to its ask's generation, the refreshes and what each line says; Enter opens a kept tab and the keyboard is in the file's text, beside the chat or in an existing main tab; Esc's two steps give the tree and then the keyboard back. No wire field moved and nothing is stored; the lister now reads `--stage` and lists a gitlink (and a conflict holding one) as a folder.

**What held, and what the build changed.** Every row of "Statements to check again" held at the branch's cut. The design held; the build settled what it left open (Decision Log 9 to 13): the field's component is `FinderView.tsx` (a case-only name pair with `finder.ts` breaks a Mac's disk); the palette runs Go to file after its close (`afterClose`), so Esc finds the palette's opener; the tree's first read keeps the run-only fields; finding resets a narrow tab's earlier press of the tree's button; a query with no working-folder record shows the failure line (ruled); the body is focusable at `tabIndex -1` with its ring under `focus-visible` only (ruled).

**The merge.** U6b-3a's final head `dc95f58fb` was merged in at `961a29c91` (three hunks, each kept both sides; the wire minor stays 3a's 55, since this landing changes no schema); the chain-merge checks passed there on the VM but for failures on the VM's list.

**What the reviews caught.** M1's: "Hide files" pressed while finding unfolded and wrote the fold (the empty field's blur ended finding before the click); Esc in a narrow tab could not give the keyboard back into the file the search had hidden; four absence tests without their control. M2's: an unknown-session read failure unmounted the body that held the keyboard; a conflict mixing a file and a gitlink was listed twice; absence tests whose control lived in a neighbouring case. M3's: G4 did not wait for the first git status before writing its new file, G1 did not start from a closed side column, B1's terminal case had no scene, and the menu read was copied into four spec files. Each was fixed, red first where a test could fail. The lesson worth keeping: in a keyboard-and-focus feature, unit tests that click with `fireEvent` miss the pointerdown-blur-click order a person's click has, and happy-dom does not refuse focus on a hidden or inert element; the first finding of both kinds came from a reviewer replaying the real event order.

**The red evidence.** S1 and the composing Enter had no older rule to fail against (the hook was new); three mutations on the VM, never committed, showed the tests catch the faults themselves (Decision Log 12), and named which S1 cases pin the generation compare and which `settle`'s state guard.

**Left for others.** Every scene (G1, G1b, G2 to G7, the tokens scene's extension, the sessions.spec adaptation) is written and typechecked and runs only on a Mac, each alone first; the Mac's own git for `ls-files.test.ts`; Korean typed into the field in the owner's sitting; class 1a; the branch review (one reviewer, high rung); the pull request. The tracker holds R7, R9, decision 8's two unseen kinds of new file, an older daemon's submodule, decision 14's limit and the palette case's act() warnings.
