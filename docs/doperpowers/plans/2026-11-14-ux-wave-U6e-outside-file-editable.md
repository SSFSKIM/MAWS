# UX wave · U6, a landing of its own (U6e): a file from outside the session's folders is editable, and Open File…

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*), a landing of its own (**U6e**). **Parent pin:** master `2c70442319614be1a2d8b57d5b0224020bd49484`, the commit every statement about the code below was checked against; the root and the child's file are read at that commit. Build F is `f1852de3a`.
>
> **The design** is the owner's two answers of 2026-11-14 and the architect's condition on them (Decision Log 1 to 3), over the child's item O-37 as its landing U6c built it (`docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md`, cited below as *U6c*). The child's file does not hold this landing yet: where its O-37 says "read-only", the owner's newer answer holds, and "Reported to the architect" 12 lists the sentences that follow. This document carries the constraints, the decisions the answers leave to the design, the milestones and the interfaces.
>
> **Branch:** `ux-wave/U6e`, from master `2c7044231`. **Board:** ticket 675, under epic 573. **Stands on:** U6c, on master; and the first landing of U6b (`docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md`, cited below as *U6b-1*), which is being built and is not on master. M1 and M2 need master alone. M3 and M4 are written against U6b-1's interfaces and are built on a master that holds it; "Statements to check again once U6b-1 is on master" lists what to read again then.

## Purpose

On this Mac a file outside the folders a session works in opens today when the session's transcript links it (U6c), and only to be read: typing changes nothing, and the editor's title says "Read-only". A person who wants to fix a line in a note, a configuration file or a file of another repository has to leave MAWS for it. And a file that no link names cannot be opened at all, because nothing in MAWS shows a file chooser for one file.

After this landing both are possible. Any file MAWS shows from outside the session's folders can be edited and saved, and nothing is written until the person presses Save. The file's bar says that the file is outside the session's folders and shows its path, so the person knows what they are editing before they save. A new command, Open File… (File menu, ⌘O, and a row in the Files list's menu), shows the system's file chooser and opens the chosen file in a tab beside the chat, editable. Which files may *open* does not change here: a file opens from outside the folders when the session's transcript links it, or, new, when the person chose it in the chooser. MAWS's own files (its profile folder and its app) open read-only. A session on another machine is as it is today.

How to see it working: in a session whose transcript links a text file outside its folders, click the link. The bar of the file's tab reads "Outside this session's folders" before the path. Type a word: Save appears, and the file on disk is still what it was. Press ⌘S: the file on disk now holds the word. Then press ⌘O, choose a text file from any folder: it opens beside the chat with the same bar; edit and save it; quit and relaunch: the tab is there, shows the saved text, and saves again.

## Progress

- [x] (2026-11-15 01:40Z) Document written against master `2c7044231`: the write's path grounded in the code at that head and in build F (`f1852de3a`); U6c's and U6b-1's documents and the cut of U6b read in this worktree; the architect's four additions of 2026-11-15 folded in (Decision Log 3).
- [ ] The adversarial review of this document, and the architect's rulings on it and on the reported points.
- [ ] M1 — The daemon: the write outside the folders, the grants, MAWS's own folders, the wire.
- [ ] M2 — Main: the chooser's command, the sender's guard, the menu's row.
- [ ] U6b-1 on master (a stop before M3: Concrete Steps 6), and the owner's look at the drawn bar ("The look", before M3).
- [ ] M3 — The window: an outside file edits and saves, its bar says where it is, Open File….
- [ ] M4 — The scenes, the cross-build row, the record, and the acceptance run.
- [ ] The proof an executor does not run: the scenes and their groups on a Mac, the cross-build run with build F, the macOS unit files, class 1a, the branch's panel review, a live turn, the owner's look, the pull request.

## Words used here

- **The folders**: the folders a session works in, which the files service calls its roots (`rootsOf`, `src/services/files/allowlist.ts`): the session's directory, its added directories, its worktree, and the folders U8c-2 admits. **Outside**: a file whose real path is under none of them.
- **The daemon**: `mawsd`, the machine's background process. The files service (`src/services/files/`) runs there and nowhere else, and it is the only code that reads or writes a session's file for the window.
- **Main**: the app's Electron main process. Every command of the page passes its router (`src/main/ipc/router.ts`), which forwards a files command to the daemon.
- **The page**, or the window: the app window's renderer. **The top frame**: the page itself, as distinct from a frame inside it (an artifact's frame, a preview) and from a page of the in-app browser, which is another web contents.
- **Named**: the session's transcript writes the file's path whole as a link or a file chip (U6c's rule, `src/shared/files/named.ts`, searched by the daemon in `src/services/files/named.ts`).
- **A grant**: the daemon's record that the person chose one file, for one session, in the system's file chooser. **Chosen**: a file that has a grant.
- **The real path**: a path with every link on it resolved (`realpath`).

## The landing's edge

**In.**

- A file outside the folders that the daemon admits for reading on this Mac, because the transcript names it or the person chose it, is editable in its tab and is saved by `files.write`, under the rule of "The write rule".
- Open File…: the row `file.open` (File menu, ⌘O), the row in the Files list's menu, the system's chooser run by main, the grant the daemon keeps, the chosen file opened beside the chat as a kept tab.
- The bar of an outside file: that it is outside, and its path; the "Read-only" title gone wherever the file can be saved.
- MAWS's own files, read-only from outside the folders, with a sentence.
- After a relaunch: a restored tab of a chosen file reads and saves as before (the grants are a file of the profile).
- The record: one dated entry in the charter's §19, one dated line each at K1 in C8's document, at G1 in E5's document and in U6c's Decision Log ("The pull request").

**Not in, and another landing's.** Which further links *open* a file from outside the folders: a link inside a rendered Markdown file, a link in a subagent's own transcript, `file://` links (U6b-4, by the cut; the owner's answers on cards C1 to C3). When U6b-4 adds a form to the rule that names a file, a file it opens is editable with no further change here, because the write asks the same rule as the read (decision 1). PDF, HTML and media drawn in the tab (U6b-2). The refusal in plain words (U6b-4): a refusal still reads "Refused: " and the service's sentence.

**Not in, and nobody's.** A session on another machine: unchanged, and not offered Open File… (cards A and B). A file with no session: it still says "No session grants access to this file". Creating, renaming or deleting a file; a listing, a watch or Reveal outside the folders. A file the agent delivered with `send_file` from outside the folders: unchanged (card D). Any change to what an agent may write: the engine's own tools and permission rules are not touched, and no tool of MAWS writes a file through this route.

## The write rule

Five lines. Each has a test that tries to break it; the milestone that carries the test is named.

1. **The daemon writes a file outside a session's folders only when it holds, itself, evidence that admits the file for that session:** the session's transcript names the path, or the person chose the file in the system's chooser. *Tests (M1):* through `files.write`, a named file and a chosen file are written; a path with neither, a path only another session's transcript names, and a path only another session was granted are refused with the bytes unchanged.
2. **The request comes from the app window's own top frame, which sends it only when the person presses Save.** Main cannot see a press. What it checks is the sender: its router answers no command of a frame, of a web contents that is no window's page, or of a page at another origin; and it forwards a write of an outside file, and runs the chooser, only for a live page of an app window. *Tests (M2):* each such sender is refused `forbidden_sender` and nothing reaches the daemon; *(M3):* in the page, opening, typing, a re-read, an agent's open and a tab shown again send no `files.write`; Save, ⌘S, the close question's Save and the quit question's Save all do.
3. **The write names the real path the file had when it was shown, and is refused when the path no longer resolves there.** The daemon resolves the path again at the write, opens it with no link on the way, and compares the opened file's real path with the one the write names. *Tests (M1):* a folder on the path swapped for a link to a folder holding a file of the same name and the same bytes, and the last component swapped for a link, each between the read and the write and between the daemon's check and its open: refused, both files unchanged.
4. **The write carries the hash of the content the person was shown; other content on disk answers `conflict` and nothing is written.** This is the save inside the folders, unchanged. *Tests (M1):* a file changed on disk since it was read answers `conflict` with its bytes unchanged; *(M3):* the page then shows the merge view.
5. **Never:** for a caller from another machine; MAWS's own profile folder and app bundle; a write that does not say it is for an outside file (it takes the folders alone, as today); a file an agent delivered that nothing else admits; a create, a rename, a listing, a watch or a reveal outside the folders. *Tests (M1):* each refused; for another machine, with the transcript and the grants not asked at all.

**Which process holds each piece of evidence.**

| evidence | where it is | who writes it | who reads it, and when | why the page cannot make it |
|---|---|---|---|---|
| the transcript names the path | the engine's transcript file | the engine | the daemon, at each request (`named.ts`, U6c) | no command of the page writes a transcript. U6c's stated bound holds and now covers a write: a caller that can also send a message into the session can make the transcript name a path first; that message stays in the transcript |
| the person chose the file | `<profile>/sessions/file-grants.json`, and the daemon's memory of it | the daemon's `files.grant`, a command only main sends, once, after the system's chooser answered | the daemon, at each request | `files.grant` is main-only: the router refuses it from every page (`MAIN_ONLY_COMMANDS`), and the endpoint offers it to no other machine. The page sends `layout.openFile` with a session's id and no path; the path goes from the chooser to main to the daemon and comes back to the page only as the answer |
| the sender is the app window's top frame | Electron's `senderFrame` and main's list of app windows | — | main, at each command | it is not a value the page sends |
| the content and the real path the person was shown | the page's entry for the file (`hash`, `outside.real`), from the daemon's own answers | the daemon | the daemon, which compares both at the write | they bind the write to what was shown; they admit nothing |

**What the rule stops.** A frame of an artifact or of a preview, and a page of the in-app browser: they are not the top frame (line 2). A presentation window or the repair window: no app window (line 2). A path that hostile content hands the page (a link in a Markdown file or in an artifact's text, a mod's surface, the target of an agent's `show_pane`): the page only opens a path, the daemon reads it only on its own evidence, and nothing writes until Save. A caller on another machine (line 5). A made-up grant (line 1's table). A link swapped in (line 3). The agent: it can make the transcript name a file, which lets the person open it; it cannot press Save, and its own writes stay the engine's.

**What it does not stop.** A fault in the app window's own page code: such code can send a write for any file that stands admitted for a session (named or chosen), with content of its choosing, since it can read the file's hash first. It cannot write a file no evidence admits and cannot grant one. And a process of this user that holds the token of the daemon's socket (`machine.sock`): it already has the daemon's whole reach, the terminal host's included, and this landing neither widens nor narrows that.

## Reported to the architect

Each is a place where a choice shows on screen beyond the owner's words, where the code differs from what the dispatch assumed, or where the narrower choice was taken. Each names the default that is built and the one place a ruling changes.

| # | The point | Evidence | The default built | The one place |
|---|---|---|---|---|
| 1 | **"The Files list's menu" does not exist.** The owner's card promised "an Open File… row in the Files list's menu". | The Files tree has a Refresh button and no menu (`FilesTool.tsx`); U6b-1 adds a fold button, no menu. | A context menu on the tree (right-click, or ⇧F10 with the keyboard in the tree) with the one row "Open File…", built with the component the Files icon's menu uses (`ContextMenu`, `panel/SurfaceRow.tsx`). It is in "The look". | the trigger in `tools/code/files/FilesTool.tsx`; a "⋯" button beside Refresh, or the Files icon's own menu (`SurfaceRow.tsx`, U8's), would be the other homes |
| 2 | **A file the agent delivered from outside the folders** (`send_file`, "Open as file") is not made editable. The owner's "every outside file" could be read to include it; the tracker's row of 2026-11-13 calls it the owner's ruling. | `precheck` admits it for `read` by the Library's records (`fileAdmission`); who may put a path into those records (the agent's `send_file`; "Add a file…") was not traced here, so that admission is not shown to be evidence the page cannot make. | Unchanged: it opens as today, looks editable, and its save is refused (the tracker's row stands). A delivered file that the transcript also names, or that the person chose, is editable by that. Card D. | `OUTSIDE_WRITE` in `service.ts` (whether a delivered file's admission may carry a write), after the path's provenance is read |
| 3 | **The agent can show again, by `show_pane`, a file the person chose in that session.** The owner's rule for the agent is "only what the conversation links". | A read carries nothing that tells an agent's open from a click (the cut, card C1's row). | It opens: the grant is the session's, whoever opens the tab. A file chosen in another session does not. | a mark on the read's request for an open the agent asked for (a new optional key), then one condition where the grant is asked |
| 4 | **MAWS's own folders are held read-only only from outside the folders.** A session whose own folders contain the profile (a chat in the home folder) writes there today through `files.write`, and still does. | `rootsOf` has the home as a root for a caller on this machine. | Unchanged inside the folders. | where `write` reads `own`: for an outside admission only |
| 5 | **A grant lasts as long as its session's record**, up to 256 files a session; closing the tab does not end it. | Reopen closed tab and a relaunch must read the file again. | As said. Archiving keeps the grants; deleting the session drops them. | `src/services/files/grants.ts` (the bound, and when a grant goes) |
| 6 | **The two admissions the owner's card also names, a link inside a Markdown file and a link in a subagent's transcript, are not built here.** | The cut gives the link forms to U6b-4. | Such a link opens when the session's transcript also names the path (today's rule) or the person chose the file, and is then editable. | the rule, `named` (`src/shared/files/named.ts` and its search), in U6b-4 |
| 7 | **Sessions on another machine.** Open File… is not offered there, and a file outside the folders there stays refused for reading and writing. | P5's Decision Log 237; the chooser shows this Mac's disk; the files service of that session runs on the other machine. | As said. Cards A and B. | Card A: the registration of `file.open` (`connectOpenFile`) and main's test of the session's machine in `openChosenFile`. Card B: `remote` in `precheck` |
| 8 | **Evidence is asked before the delivered files.** U6c asked the delivered files first, so a file both delivered and named was answered as delivered, with no mark that it is outside. | `precheck`, the `admits` branch before the `nameAdmits` branch. | For a request that carries `named`: grants, then the transcript, then the delivered files. A delivered file that nothing else admits now costs one search of the transcript per ask (remembered as any miss is). U6c's sentence "a delivered file never opens the transcript" no longer holds for a request with the key. | the order in `precheck` |
| 9 | **The app bundle that is protected is the daemon's own.** | The daemon knows its executable (`process.execPath`), not the path of an app that attached to it from another bundle (a development run). | The outermost `.app` folder that holds the daemon's executable, when there is one. | `ownFolders` in `src/services/files/own.ts` |
| 10 | **Nothing else is withheld by name.** A shell profile, a key file, the engine's own settings and the session's own transcript are editable when they open, by the owner's words ("this includes files such as a shell profile or a key file if something links them"). | — | As said. | `ownFolders` |
| 11 | **The daemon's socket.** Said so that nobody is surprised: any process of this user that holds the token of `machine.sock` can send `files.grant` and `files.write` as main does. It can also start a terminal there. | `src/shared/host/socket-server.ts` checks the token and nothing else; `src/mawsd/front.ts` answers every `machine` command to every welcomed client. | Not changed, and line 2 of the rule does not rest on it. | none in this landing |
| 12 | **Sentences of the spec that follow** (the architect's batch). The child's file: O-37 "The file is read-only: no save, no edit" and "The editor's title says why the tab is read-only", A5's "opens it read-only", the notice table's first row, "Not included: any change to which folders a session may read beyond U6c's". The root: the entry of 2026-11-13 for U6c ("opens read-only"), "Contracts amended" for K1, a row in "Rulings reversed" for the read-only half, UC-8's rows for `src/services/files/`, `src/services/spine-root.ts` and the wire (each gains U6e) and a row for `src/main/files/`. The tracker's row of 2026-11-13 on a delivered file stays. | — | — | — |

## What the code holds today

Read at master `2c7044231`. Paths under `src/renderer/src/` are written from `tools/`, `panel/` or `stores/` where that is unambiguous.

1. **What opens from outside the folders** (U6c). `precheck` in `src/services/files/service.ts` admits, after the roots and after the delivered files, a file whose path the session's transcript names, for `read` and `openExternal` alone, when the request carries `named: true` and is not from another machine (`remote`, read from the handler's context in `register.ts`). The admitted real path stands as a root of one for the rest of the boundary. The read's every answer then carries `named: true`. The page sends `named` only for a session on this Mac (`readChunk` in `tools/code/viewer/viewer-store.ts`; `OpenExternally` in `viewer/ExternalRow.tsx`).
2. **Why it is read-only today.** In the daemon, `write` runs `precheck` with `ROOTS_ONLY`. In the page, an entry whose last load answered `named` is never `editable`, `save` answers `'noop'` for it, and `readOnlyReason` answers `'outside'`, which `CodeView.tsx` draws as the editor's title, `EDITOR_COPY.readOnly.outside` (`tools/code/copy.ts`).
3. **The save** (E5). `files.write { appSessionId, path, content, expectedHash }`: the daemon opens the file read-write through the same boundary as a read (the real path opened with no link on its way, the descriptor confirmed under the roots), compares the hash of what the file holds with `expectedHash` inside a section it holds per file, and writes in place through the descriptor or answers `conflict`. It never creates a file. One caller exists: `save` in `viewer-store.ts`. `save` is reached from the bar's Save button (`editor/EditorControls.tsx`), the action `file.save` (`saveFocusedFile`, `editor/register.ts`), the close question's Save (`guardFileClose`) and the quit question's Save all (`saveAll`); nothing saves by itself.
4. **A conflict.** A `conflict` answer makes the page read the file whole and show it against the document in the merge view ("Changed on disk since you opened it"); a file the editor cannot take says why (`conflicted`, `viewer-store.ts`). A file outside the folders has no watch (the watch is on the folder and is refused there), so it is read again only when its tab is shown again or its link is clicked again, and only while it has no unsaved edits (`revisit`).
5. **Who can reach the daemon's `files.write`.** The page, through the router's `route`, which first requires the sender to be the top frame of a `BrowserWindow` at the app's origin (`isAppSender`) and then forwards with the asking page's `ClientRef`. Main's own code (`invokeOwn`, `dispatchLocal`): no caller sends `files.write`. Another machine, through the endpoint, where `files.write` is offered as a `machine` act (`src/endpoint/offers.ts`) and arrives with `remote: true`. And a client of `machine.sock` (point 11).
6. **What `isAppSender` accepts.** Any window of the app whose top frame is at the app's origin: the app window, the two presentation windows (`src/main/presentations/present.ts`, the same preload and page) and the repair window (`src/main/repair/index.ts`, a page and preload of its own). Main's list of app windows is narrower: `appWindows()` (`src/main/windows.ts`) holds only what `createWindow` registered. A page's `ClientRef` leads back to its web contents while the page lives (`pageOf`, `src/main/ipc/clients.ts`).
7. **Commands only main sends.** `MAIN_ONLY_COMMANDS` (`src/shared/ipc/names.ts`): the router answers `forbidden_sender` to one from a page and from `dispatchLocal`, and `invokeOwn` sends it. `files.readResolved` is the files service's precedent. The endpoint offers a command to another machine only by a row of `OFFERS`.
8. **A chooser.** `layout.pickFiles` is main's own command: its handler asks the client port's `pick` (`src/main/client/electron-port.ts`), which shows the system's open panel on the asking page's window; under `MAWS_E2E=1` the seam `openDialogFor` (`src/main/client/e2e-pick.ts`) answers from `MAWS_E2E_PICK_PATHS` and never raises a panel. A request to the daemon has ten seconds (`REQUEST_TIMEOUT_MS`, `src/shared/host/host-supervisor.ts`), so a daemon command cannot wait for a person's choice.
9. **The profile.** The spine's root (`src/services/spine-root.ts`) knows the profile folder and keeps `sessions/uploads.json` there as a file under the spine's lock (`uploadRootsOf`), absent in a run refused the spine. Build F names `sessions/intents/`, `sessions/bootstraps/` and `sessions/uploads.json` in that folder and no other entry. The view tells when a session's record is removed (`view.on('record', (id, null))`).
10. **No session.** A file tab with no session draws "No session grants access to this file" (`NoSession`, `viewer/FileViewer.tsx`); the files service places every request by a session's record or setup intent.
11. **The bar** (`FileBody`, `viewer/FileViewer.tsx`): the path (`PathLead`: the folder part is cut first, the name stays whole, the title holds the whole path), the notices, the editor's controls, then Wrap and Source. The bar wraps to a second line where its parts do not fit.
12. **The keymap.** No row of `ACTIONS` (`src/shared/keymap/actions.ts`) holds ⌘O, no menu role does (`menu-roles.ts`), and no editor in the page takes it (CodeMirror's default keymap has Ctrl+O, another chord). The File menu's rows are New chat, Close tab, Reopen closed tab, Save file, Comment on this line, in table order with a separator between rows whose ids differ in their first part (`menuTemplate`, `src/main/menu.ts`). A menu row is enabled only while the page has a handler registered for it; `channel.open` is registered and removed as the tab in front changes (`connectChannelAction`, `channel/open-action.ts`). A row whose id build F does not know takes no rebinding (`isRebindable`).
13. **The Files tree** (`tools/code/files/FilesTool.tsx`): rows, a Refresh button, no menu.
14. **Build F and the wire.** Master's wire is major 3, minor 46. The daemon's front reads a command's input with the tolerant reader (an unknown key is dropped) and answers `unknown_command` to a name it does not know; an endpoint reads strictly. F's `write` takes the roots alone, F knows neither `named` nor a grant, and F's page sends neither.
15. **What pins today's behaviour and changes.** `src/services/files/service.test.ts` ("never writes, lists, watches or reveals the named file, nor reads its neighbour"; "asks nothing of the transcript for a path inside the roots, or a delivered file, and answers them as today"), `register.test.ts`; `tools/code/viewer/viewer.test.tsx` (the cases around `OUTSIDE_TITLE` and `readOnlyReason(...)` `'outside'`), `editor/editor.test.tsx` and `test-support/code-disk.ts` (the fake disk's write); `src/main/menu.test.ts` (the File menu's list of ids); `src/main/ipc/router.test.ts` (the main-only list); `src/shared/ipc/wire.test.ts` with the two generated files; `src/shared/machine/coverage.test.ts` with `address-paths.json`; `e2e/sessions.spec.ts` (U6c's scene asserts `data-editable="false"`, the title and a refused write).

## Decisions settled at authoring

Each names what it beat. The numbers are cited as "decision N". The exact shapes are in Interfaces and Dependencies.

1. **The write is the act, and its admission is the read's.** `files.write` asks the same question as `files.read`: is this path, outside the roots, admitted for this session by a grant or by the transcript. One function in `precheck` answers for both, so whatever a later landing teaches the rule to name is at once readable and writable, and nothing is writable that is not readable. This is the architect's reading of the condition (Decision Log 3), and it holds for a file the agent opened by itself: the agent's `show_pane` only opens a tab; the daemon reads the file because the transcript names it, and writes it when the page's top frame sends a save. *Beat:* making the open the act (a grant issued when a person's click opens the tab): the owner made a linked file the agent opened by itself editable too, and an open carries nothing that tells an agent's from a person's.
2. **The grant is held by the daemon and made by a command only main sends.** `files.grant { appSessionId, path }`: main-only, refused for a caller from another machine where it runs, answered by the files service, which resolves the path itself and records its real path. The process that decides (the daemon) reads the record itself. *Beat:* a file main writes and the daemon reads (two processes on one file with no order between them). *Beat:* a mark main adds to each request ("this path was chosen"): a key of a request's input is a key the page can set, and main would have to remove it from every page's request. *Beat:* a record in the page's stored layout: the page writes that.
3. **Main runs the chooser.** `layout.openFile { appSessionId }` is main's own command, as `layout.pickFiles` is: its handler shows the system's panel through the client port, then sends `files.grant`, then answers the page with the path. *Beat:* a daemon command that asks the client port for the pick: a request to the daemon has ten seconds, and a person takes longer.
4. **What a grant is.** One real path, for one session, with the time it was made. It admits that file and nothing beside it, for that session and no other, and it is asked only where the transcript is asked: a request that carries the key, on this machine. The grants are a file of the profile, `sessions/file-grants.json`, written whole and atomically by the daemon before its memory changes, read once at the spine's start; so a relaunch, of the app or of the daemon, changes nothing. A session holds at most `GRANTS_PER_SESSION_MAX` (256), the oldest going first; a session's grants go when its record is removed. A file the daemon cannot read as its own version is taken as holding nothing, is logged, and is left as it is until the next grant writes the file anew (it fails towards the refusal). *Beat:* a grant for the whole window: a session's agent could then show, by `show_pane`, a file the person chose in another session. *Beat:* ending a grant when its tab closes: Reopen closed tab and a tab another build restored would be refused.
5. **The keys.** A read keeps U6c's request key, `named`, whose meaning widens to "admit a file outside the folders that stands admitted for this session, and tell me". Its answer keeps `named: true` for any such file and gains `outside: { real, writable }`, which a page needs before it may offer Save. A write gains `outside: { real }`. A page that gets `named` without `outside` (a daemon of a build between U6c and this one) holds the file read-only, as U6c does. *Beat:* a second request key beside `named`: no caller would send the old one any more, and a dead key cannot leave the wire within its major. *Beat:* the daemon remembering which real path each read answered: state that a restart loses, where the write can simply say it.
6. **The real path is bound at the read and compared at the write.** The read's answer gives the real path it read. The page keeps it with the document: it is set by the load that puts the document's text on screen and is never replaced while the document has unsaved edits. The write sends it back, and the daemon refuses the write (`FILES_MOVED`) unless the file it opened, by a fresh `realpath` of the path whose `stat` is the descriptor's, is at that real path. For a chosen file the grant itself is keyed by the real path, so a path that resolves elsewhere has no grant. The answer is `FILES_MOVED` only for a file the daemon still admits (a named file whose path now leads elsewhere); a chosen file whose path leads elsewhere has no grant there, and a path whose last component became a link is refused before any of this, so both answer the service's refusal sentence and no answer says how an unadmitted path resolves. A refused save leaves the document and its edits in the tab; the save works again when the path leads back. *Why the page does not simply read again and save to the new place:* that would let a link swapped in redirect the write after one more press.
7. **Evidence before delivery** ("Reported to the architect" 8). For a request that carries the key and is not remote, a path outside the roots is asked of the grants (a lookup), then of the transcript (the search), and only then of the delivered files, whose answer carries no mark, as today.
8. **MAWS's own folders.** `ownFolders`: the real path of the profile folder, and of the outermost folder named `*.app` that holds the daemon's executable, when there is one. A file under one of them that is admitted from outside the folders is read as any other, its answer says `writable: false`, and a write of it is refused whatever admitted it. The page holds it read-only and says why in the editor's title and on the bar. *Why these two:* the profile holds the grants, the daemon's token and the settings, so a page that could write there could grant itself anything; the bundle is the code. The owner's words keep everything else editable ("Reported" 10).
9. **Main's guard on the sender.** `isAppSender` holds for every command and already refuses a frame and a foreign web contents. One hook before `files.write` (`beforeCommand`) adds: a write whose input carries `outside` is forwarded only when the asking client is a live page of a window in `appWindows()`; `layout.openFile`'s handler asks the same. So a presentation window, the repair window and main's own in-process callers cannot write an outside file or raise the chooser. *Beat:* a command of main's own for the outside save, forwarding a main-only write: two more names for what one condition does, and the save inside and outside the folders would stop being one call.
10. **No watch outside the folders; a change on disk is met at the save.** As U6c decided, a file outside the folders is read again when its tab is shown again or opened again, while it has no unsaved edits. A save over a file that changed meanwhile answers `conflict` and opens the merge view, which exists; nothing is overwritten unseen. *Beat:* a watch on the one file (U6c's decision 15 rejected it: a new kind of watch for a file read on a click).
11. **What the bar and the editor's title say** ("The look"). The bar of an outside file starts with a label, "Outside this session's folders", before the path; its tooltip names the real path a save writes. The editor's title is gone for a file that can be saved. A file of MAWS's own reads "Outside this session's folders · read-only" with the editor's title "Read-only: MAWS does not edit its own files". The path is drawn as for any file. *Beat:* a line under the bar: a second row for a fact one label carries (law 3). *Beat:* marking the tab's title in the strip: the strip is U8's and U6b-1's, and a tab is narrow.
12. **`list`, `watch` and `reveal` are not touched.** The code forces none: the tab reads one file, the save writes one, and the folder of an outside file stays unlisted and unwatched. Reveal in Finder stays what it is (a file inside the folders, or a delivered one).
13. **The chord is ⌘O.** Free in the table, in the menu's roles and in every editor of the page; the convention of macOS for Open; Claude Desktop's File ▸ "Open File…" has it (`main-process/index.chunk-BV3uOqbK.js:325087-325097` of `app-5.1231.2`; what its page then does was not traced). The row `file.open` stands before `file.save` in the table, so the File menu reads New chat; Close tab, Reopen closed tab; Open File…, Save file, Comment on this line. It takes no rebinding while build F can be gone back to (UC-6). It joins `SHELL_FOCUS_ACTIONS`, so that a page of the in-app browser does not keep the keyboard after the file opens.
14. **A kind MAWS does not draw, a folder, a package.** The chooser is asked for one file, so a folder cannot be chosen. A package (an app, a document bundle) can be chosen and is a directory: the daemon grants only a regular file, and the page says "Open File opens one file. A folder or an app's package cannot be opened here." Any regular file is granted and opens in its tab as that kind opens today: text and images drawn, a PDF or a video with its "open outside MAWS" row, a binary with its size.
15. **Where it is offered.** The row `file.open` is registered while the session in front (`shownSession()`) is a session on this Mac that the page knows, and is otherwise disabled as every unregistered action is. With no session in front (the Overview, a page, no sessions at all) there is nothing a file could be read under ("What the code holds today" 10). For a session on another machine the Files list's row is drawn disabled and reads "Open File… (this session runs on <machine>)" (UC-7; card A).
16. **How the chosen file opens.** `openFile(appSessionId, path, null, { keep: true })` (U6b-1): beside the chat, as a kept tab, since the person asked for this file by name. The path is the real path the daemon granted. A file chosen from inside the session's folders opens the same way; its grant is recorded and is not needed.
17. **Nothing changes for a write that does not say `outside`.** It takes the roots alone. So build F's page, a caller on another machine and the save of a file inside the folders are answered as today, to the byte.
18. **Errors say nothing more than today, and a refused save says what to do.** A refused outside write answers the service's refusal sentence, `not writable: <path>` for a file of MAWS's own, or `FILES_MOVED`; none names what is at another path. The evidence is asked at the write, so a file that was admitted when it was opened can be refused when it is saved: the session's conversation was cleared and its new transcript does not name the file, the path moved, or the transcript's search did not answer in time. The edits are then still in the tab, so the page words the refusal of an outside file's save as a way on: "Could not save: MAWS may no longer write this file for this session. Choose it with File ▸ Open File… to save it". Choosing the file grants it, and the same tab saves (when the link's path is the file's real path; otherwise the chosen file opens in a tab of its own, and the edits are copied by hand). A grant that cannot be recorded (the file cannot be written) fails the command, and nothing opens.

## The look

Drawn with invented paths; widths are schematic. This is what the owner sees before M3 is built (the architect's addition 4): the bar in a wide and a narrow tab, MAWS's own file, and the Files list's menu.

A linked or chosen file from outside the folders, with an unsaved edit, in a wide tab:

    ┌──────────────────────────────────────────────────────────────────────────────────┐
    │ ⟨Outside this session's folders⟩  /work/notes/plans/roadmap.md        [Save] [Wrap] │
    ├──────────────────────────────────────────────────────────────────────────────────┤
    │ 1  # Roadmap                                                                      │
    │ 2  Ship the editor first.▌                                                        │

The same in a tab beside the chat too narrow for one line (the bar wraps, as it does today):

    ┌────────────────────────────────────────┐
    │ ⟨Outside this session's folders⟩       │
    │ /work/notes/pla…roadmap.md             │
    │                         [Save] [Wrap]  │
    ├────────────────────────────────────────┤

Hovering the label: "This file is not in the folders this session works in. Save writes to /work/notes/plans/roadmap.md".

A file of MAWS's own (its profile folder or its app), opened by a link or by Open File…:

    ┌──────────────────────────────────────────────────────────────────────────────────┐
    │ ⟨Outside this session's folders · read-only⟩  /work/profile/settings.json    [Wrap] │
    ├──────────────────────────────────────────────────────────────────────────────────┤

Typing changes nothing there; the editor's title reads "Read-only: MAWS does not edit its own files".

The Files list's menu (right-click in the list):

    ▾ app                      ⟳
      ▸ src        ┌─────────────────────┐
      ▸ test       │ Open File…       ⌘O │
        README.md  └─────────────────────┘

For a session on another machine the row is grey and reads "Open File… (this session runs on studio)".

## The cards for the owner

In final form, for the architect to put. Each built default is the first option unless said.

### Card A · Open File… beside a chat whose session runs on another machine

**Question.** "Open File… shows this Mac's file chooser. When the chat in front belongs to a session that runs on another machine, what should Open File… do?"

1. **Not offered there (Recommended; built).** The File menu's item is grey, and the row in the Files list reads "Open File… (this session runs on studio)". That session's own files open from its Files list and its links, read on that machine, as today. A file of this Mac beside that chat would look like part of a place the agent there cannot see or change.
2. **Open this Mac's file beside that chat.** The chosen file opens in a tab beside the chat and is read and saved on this Mac; its bar says "On this Mac". The agent on the other machine cannot read it. You could keep your own notes next to a remote session.

Choosing a file *of the other machine* is not an option here: the system's chooser shows this Mac's disk, and a chooser of another machine's folders would be a surface of its own.

### Card B · A file outside the folders, on another machine

**Question.** "On this Mac a linked file from outside a session's folders now opens and can be edited. For a session that runs on another machine such a link is still refused there, and nothing outside the session's folders is edited there. Should the other machine follow?"

1. **Keep it to this Mac (Recommended; built).** On another machine MAWS reads and writes only the folders the session works in; a link that points elsewhere says so. A machine's other files are never reached from afar.
2. **Linked files open there too, read-only.** A file the conversation links on that machine opens from your Mac, to be read. Anyone who may view that session from another device could then read any file its conversation links on that machine.
3. **Linked files open and can be edited there too.** As on this Mac. Anyone who may manage that session from another device could then change any file its conversation links on that machine.

### Card D · A file the agent sent you

**Question.** "When the agent sends you a file from outside the session's folders (it shows as a card in the conversation and in the Library), 'Open as file' shows it in a tab. Today you can type there, and the save then fails. What should that tab be?"

1. **Editable, like any other file from outside (Recommended).** You can fix the file the agent sent where you read it; Save writes the original file. Copies MAWS keeps in its own store stay read-only.
2. **Read-only, with a sentence.** The tab says "Read-only: this file was sent by the agent"; to change it you open it in another app, or ask the agent to link it.

*Built until answered:* today's behaviour, unchanged; a sent file the conversation also links, or that you opened with Open File…, is editable by that. *For the architect before the card goes:* "Reported" 2, the provenance of a delivered path.

## Acceptance

Observable behaviour; the proof of each is named in the milestone that carries it. A linked file means a file outside the session's folders that the session's transcript names; a chosen file, one opened with Open File….

- **A1 · Editing a linked file.** On this Mac, click a link to a text file outside the session's folders. The tab's bar starts with "Outside this session's folders" and shows the path. Type: Save appears and the file on disk is unchanged. Press Save or ⌘S: the file on disk holds the text typed, and nothing beside it changed. The same for a file the agent opened by itself with `show_pane`, when the transcript names it.
- **A2 · Nothing is written without a press.** Opening the file, typing, switching tabs, showing the tab again, a re-read and an agent's open send no write; the file's bytes are as they were until Save, ⌘S, the close question's Save or the quit question's Save all.
- **A3 · Open File….** File ▸ Open File… (⌘O) shows the system's file chooser on the window. Choosing a file outside the session's folders opens it beside the chat as a kept tab, with the same bar; it edits and saves as in A1. The row "Open File…" in the Files list's menu does the same. Cancel changes nothing.
- **A4 · After a relaunch.** Quit and relaunch: the chosen file's tab is where it was, shows the saved text, and saves again. Reopen closed tab on it opens it again.
- **A5 · What stays refused.** Through `files.write` carrying `outside`, each answers "path outside the session's directories" and writes nothing: a path neither named nor chosen; a path only another session's transcript names; a path only another session chose; a path whose last component is a link. A write without `outside` of a named or chosen file is refused as today. A write from another machine is refused, and neither the transcript nor the grants are asked. `files.grant` from the page answers `forbidden_sender`. With the file open, a listing or a watch of its folder, a reveal of it and a read of its neighbour are refused.
- **A6 · The sender.** A `files.write` carrying `outside`, and `layout.openFile`, from a frame inside the window, from a web contents that is no window's page, from a presentation window and from the repair window each answer `forbidden_sender`, and nothing reaches the daemon and no chooser opens.
- **A7 · A path that moved, and evidence that went.** With an edit unsaved in a linked file, replace a folder on its path by a link to another folder that holds a file of the same name and bytes: Save shows "Could not save: the path no longer leads to the file that was opened". Replace the file itself by a link, or make the same swap under a chosen file, or clear the session's conversation so that its transcript no longer names the file: Save shows "Could not save: MAWS may no longer write this file for this session. Choose it with File ▸ Open File… to save it". In every case both files are unchanged and the edit is still in the tab. Put the path back, or choose the file with Open File…: Save works.
- **A8 · MAWS's own files.** A file in MAWS's profile folder, and one inside its app bundle, opened by a link or by Open File…, show their content; the bar reads "Outside this session's folders · read-only", typing changes nothing, the editor's title reads "Read-only: MAWS does not edit its own files", and a direct write of either is refused with the bytes unchanged.
- **A9 · Changed on disk meanwhile.** Edit an outside file, change it on disk by other means, press Save: the merge view opens with "Changed on disk since you opened it" and the file on disk is the other version, untouched, until the person resolves and saves.
- **A10 · Kinds.** Open File… on a PDF shows "PDF files open outside MAWS" with "Open externally", which opens it; on a binary, its size. A folder cannot be chosen; a package answers the sentence of decision 14 and opens nothing.
- **A11 · Where it is offered.** With no session in front, and with a session of another machine in front, File ▸ Open File… is disabled; the Files list's row of such a session is disabled and names the machine. A linked file outside the folders of a session on another machine shows today's refusal, and a save there sends today's request.
- **A12 · Another build.** This build's page on a daemon that does not know `files.grant` says "MAWS could not open the file just now. Try Open File again in a moment." and opens nothing; on a daemon that answers `named` without `outside` it holds the file read-only. Build F's page on this build's daemon cannot read or write an outside file. This build, then build F, then this build on one profile: F shows nothing of the chosen file (its Files tree where the tab beside the chat was; its refusal in a main tab) and leaves `sessions/file-grants.json` as it was; back on this build the tab reads and saves.
- **A13 · Nothing gated got worse.** Typecheck, lint and the unit suite pass on the build VM; the e2e groups that cross the code pass on a Mac.

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push; no `pnpm install`, typecheck, eslint, vitest, build or Electron. Every check runs on the wave's build VM in a checkout of the pushed head, through `vmcheck.sh` (Concrete Steps). An executor starts no Electron e2e, runs no `scripts/ci-gate.sh` and opens no pull request. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.
2. **The owner's words and the architect's condition bind** (Decision Log 1 to 3): every outside file MAWS shows is editable; nothing is written until Save; which files open does not change here; the write rule's five lines; MAWS's own folders; the bar. Where a choice is left, the narrower one is taken and said ("Reported to the architect"). P5's Decision Log 237 binds: a caller on another machine reaches nothing outside a session's roots.
3. **The boundary is not reopened.** A write outside the folders goes through the code a write inside them goes through: `precheck`, the open with no link on its way, the descriptor confirmed under the roots, the hash compared inside the file's section, the write in place through the descriptor. The admission adds a root of one and the comparison of the real path, and nothing else. A change that needs another route to the bytes stops and reports.
4. **Stored and sent** (root UC-14). Interfaces §A states every key, file and command, with what build F does in both directions. No field is added to a stored tab, to `main.tabs`, to `regions` or to the stored side surfaces; neither settings file is touched; the one stored thing is a file of the profile that F does not name.
5. **Files other children own** (root UC-8). Interfaces §F lists every file and every insertion with its owner. No file under `src/endpoint/`, `src/main/lane-b/`, `src/renderer/src/lane-b/`, `src/renderer/src/transcript/` or `src/engine-host/` is edited, and `src/main/ipc/router.ts` is not (the guard is a hook it already offers). An executor that finds one must change stops and reports.
6. **Three routes, one behaviour** (law 5; root UC-7). A session MAWS runs, a terminal session and an ended or archived one on this Mac are told apart by nothing here: the rule needs the session's record, and for a named file its transcript. A session on another machine: every request is today's to the byte, and Open File… is disabled with its sentence.
7. **The repository is public** (root UC-11), and a fault is never reproduced by reading a person's session, file, settings or folder: structure and counts only, none of it in the repository. Tests, fixtures and scenes use invented paths under a temporary folder and invented text; "MAWS's own folder" in a test is a temporary folder handed to the service as such.
8. **The wave's laws.** Law 3: one label and one menu row are added, no setting. Law 4: one admission function for read and write, no watch, no second route. Law 6: nothing about the engine is assumed; no engine runs on the MacBook, and an engine fact the recorded fixtures do not hold goes to the architect.
9. **Guards that read source text.** In renderer source and its tests a ticket or item number is written in words; the tokens guard (`test/support/tokens-guard.test.ts`) reads `#` and three to eight hex digits as a colour. Run that guard with M3. Components use tokens only.
10. **The base.** The branch takes master by merge, never by rebase or force-push.
11. **The level of proof.** A refusal is asserted with what was not done: the file's bytes read back, the transcript's and the grants' spies untouched, the host dispatcher not called. A write is asserted on the bytes on disk, through the service over real files in a temporary tree, not on a flag. "Nothing is written without a press" is asserted on the client's recorded calls and on the bytes.
12. **Disk.** If any command fails with "No space left on device": stop, report, delete nothing.

## The sequences that must hold

Each act below awaits something. For each: what happens when the person or the disk acts in between, what happens when the awaited thing fails or never comes, and the test that holds the sequence open. The service's suite holds its points with `BoundaryHooks` (`before-named`, `before-open`, `after-open`); main's and the page's suites with a port or a client whose answers the test releases.

| # | sequence | what must hold | held open by |
|---|---|---|---|
| S1 | the daemon found the file admitted for a write; before its open, the last component becomes a link | the refusal; nothing written, both files' bytes unchanged | M1, `before-open` |
| S2 | the same, with a folder on the path swapped for a link to a folder that holds a file of the same name and bytes | the refusal at the confirmation or `FILES_MOVED`; nothing written | M1, `before-open` |
| S3 | the swap of S2 made between the read and the write (the page holds the old real path) | `FILES_MOVED`; nothing written; a later write, after the path is put back, lands | M1 |
| S4 | the transcript's search for a write is in flight; the asking client ends | the write is refused and writes nothing (the waiter left: U6c's queue) | M1, `before-named` |
| S5 | two saves of one outside file at once (two tabs of two sessions that both admit it) | one `ok`, one `conflict`, the file the first one's content (the per-file section, as inside the folders) | M1 |
| S6 | a grant is made while a read of the same path waits for the transcript | each answers by its own evidence; the read admitted by the grant carries `outside` | M1 |
| S7 | the grants' file cannot be written | `files.grant` fails, the memory holds no grant, a read of the path is refused | M1 |
| S8 | the session's record is removed while its chosen file is open | the next read and the next write are refused ("unknown app session", as for any file of a removed session) | M1 |
| S9 | a named file was read; the session's transcript is then another file that does not name it (the conversation was cleared), or the search's queue is full | the write is refused with the service's sentence and writes nothing; after a grant of the same real path the same write lands | M1 |
| C1 | the chooser is open; the page reloads or the window closes | no grant is sent; nothing opens; the handler's late answer lands nowhere | M2 |
| C2 | the chooser is open; Open File… is asked again for the same page | the second ask answers `cancelled` at once; one chooser | M2 |
| C3 | the chooser answered; `files.grant` fails, is unknown to the daemon, or does not answer in its ten seconds | `refused: unavailable`; nothing granted is assumed, nothing opens | M2 |
| C4 | the chooser answered with a package or a folder | `refused: not-a-file`; no grant | M1, M2 |
| W1 | the answer of `layout.openFile` lands after its session left the page's records | nothing opens, no notice | M3 |
| W2 | a save of an outside file is in flight; the tab is closed | the answer lands nowhere (the store's rule today); the file is what the save wrote | M3 |
| W3 | an outside file with unsaved edits; a read answers another real path (a conflict's read after a swap) | the entry keeps the real path of the document it holds; the next save sends that one and is refused `FILES_MOVED` | M3 |
| W4 | an outside file with unsaved edits; a read answers without `named` (the file is inside the folders now) or with `writable: false` | without `named`: the save goes on, carrying the real path it holds; with `writable: false`: the entry is no longer editable, the document stands, and a save answers `'noop'` | M3 |
| W5 | a save answers `conflict` | the merge view, as inside the folders; nothing written | M3 |
| W6 | a load answers `named` without `outside` (an older daemon) | read-only, the editor's title U6c's | M3 |
| W7 | an outside file's save is answered the refusal sentence; the person chooses the same file with Open File… | the save error reads `outsideRefused`; the open selects the tab that holds the edits and reads nothing over them; the next save lands | M3 |

## Plan of Work

Four milestones. Each stands on this document and the code, has its own proof and leaves the tree green. M2 consumes M1's command and keys; M3 consumes both and U6b-1's opener; M4 consumes all. Sizes are estimates of changed lines, tests included.

### M1 — The daemon: the write outside the folders, the grants, MAWS's own folders, the wire

**What exists at its end.** `mawsd` answers `files.write` for a file outside a session's roots when the request carries `outside`, comes from this machine, the file stands admitted (the transcript names it, or a grant of the session holds its real path), the path still resolves to the real path the write names, and the file is not MAWS's own. `files.read` answers `outside` beside `named` for such a file. `files.grant` records a grant, which survives a restart of the daemon. Nothing sends the new keys yet, so nothing changes on screen.

**What it touches.** `src/shared/ipc/schema/files.ts`, `src/shared/ipc/names/files.ts`, `src/shared/ipc/grades/files.ts`; `src/services/files/service.ts`, `register.ts`, `grants.ts` (new), `own.ts` (new) and their suites; `src/services/checkouts-root.ts`; `src/services/spine-root.ts` and its suite; `src/shared/ipc/wire.ts`, `wire-manifest.json`, `wire-fingerprint.json` (the minor); `src/shared/machine/address-paths.json`; the header comments of `service.ts`, `allowlist.ts` and `schema/files.ts`, which state the old rule; the suites that classify an offered command's input keys (`test/endpoint/checkout-rows.test.ts`, `test/lane-b/offer-coverage.test.ts`), only where one asks for the new key. This document's record.

**Interfaces.** Exposes §A's sent half and §B. Consumes U6c's `createNamedPaths(...).names` as the service already has it.

**Decisions.** 1, 2, 4 to 8, 17, 18. In the code: one admission step in `precheck` serves `read`, `openExternal` and `write`; the purpose says whether the outside rule may admit (`write` only when its input carries `outside`), the request says whether it asked. The mark the boundary carries says what admitted the file (`'chosen'`, `'named'`, or none for a root or a delivered file), and only a marked file gets `named` and `outside` in a read's answer. `write` compares the real path after `openConfirmed`, on the confirmed real path, before it enters the file's section, and asks `own` there. A write that carries `outside` for a file under a root is an ordinary write, with the real path still compared. The grants follow `uploadRootsOf`'s pattern for a spine file: none in a run refused the spine, where `files.grant` is refused and nothing is chosen. Pitfalls seen: the early refusal for a session with no resolvable root must let a possible grant through as it lets a possible name through (U6c's Decision Log 14 b); `files.readResolved` answers with the read's output schema, so the manifest records the optional `outside` there too, and it is never set; the per-client signal of `register.ts` (`endOf`) is made for a request that asks by name, and a write that carries `outside` is one. Tests fail first: the suite "files writes outside the folders" in `service.test.ts`, beside "files admission of named files" and in its shape, with the real `createNamedPaths` over a temporary store for every case that claims the transcript decides, and a real grants file for every case that claims a grant does.

**What it does not touch.** The page; main. `allowlist.ts`'s code, `admission.ts`, `named.ts` (both), `upload.ts`, `watch.ts`. The endpoint's source.

**What it proves.** Lines 1, 3, 4 and 5 of the write rule; A5's service half, A7's service half, A8's service half, A12's daemon half; S1 to S9, C4's daemon half. Behaviours its tests pin beyond those: a named file and a chosen file written, the bytes on disk the content sent and the answer its hash; a write with `outside` of a path neither admits, of a path only another session's transcript names, of a path only another session chose, each refused with the bytes read back; a write without `outside` of a named and of a chosen file refused as today; a remote write with `outside`, with the transcript's and the grants' spies untouched; a delivered file that nothing else admits not written, and one the transcript also names written; a named file read, then refused at the write once the session's transcript is a file that does not name it, and written after a grant (S9); a file under the profile folder and one under the bundle read with `writable: false` and refused at the write, each admitted by a name and by a grant; the read's every chunk and its hashed read carrying `outside` with the same real path; `openExternal` admitting a chosen file; `list`, `watch` and `reveal` refused for a chosen file and its folder; a grant of a directory, of a package-shaped directory and of a special file refused `not-a-file`; a grant from a remote context refused; a grant of a link recorded as its target's real path; the grants read back after the store is opened again; the 257th grant of a session dropping the oldest; a removed record dropping its grants; a grants file that does not parse read as empty and left alone until the next grant; a reader that does not know the keys reading the requests as the plain ones (`readTolerant` over the schemas without them); `files.grant` among the main-only names; `ownFolders` over a path inside nested `.app` folders, and over one with none.

**Size.** About 330 lines of source and 820 of tests, over about 16 files.

### M2 — Main: the chooser's command, the sender's guard, the menu's row

**What exists at its end.** `layout.openFile` shows the system's chooser for the asking app window and answers the granted path, a cancel or a refusal. A `files.write` that carries `outside` is forwarded to the daemon only for a live page of an app window. The File menu holds "Open File… ⌘O", disabled until M3 registers its handler.

**What it touches.** `src/shared/ipc/schema/layout.ts`, `src/shared/ipc/names/layout.ts`; `src/main/files/open-file.ts` (new) and its suite; `src/main/app.ts` (two registrations); `src/main/ipc/router.test.ts` (the sender's cases); `src/shared/keymap/actions.ts` and `actions.test.ts`; `src/main/menu.ts` and `menu.test.ts`; `src/shared/machine/address-paths.json`; the keymap's other suites where a new row moves an expectation (`src/renderer/src/settings-tab/keymap.test.ts`, `KeymapSection.test.tsx`, `src/renderer/src/palette/CommandPalette.test.tsx`, `src/renderer/src/keymap/` suites).

**Interfaces.** Exposes §C. Consumes §B's `files.grant`.

**Decisions.** 3, 9, 13 to 15. In the code: the handler is registered as `layout.pickFiles` is (`registerMainHandler`), and sends the grant as main's own call (`invokeOwn`), the only sender a main-only name has. The guard is one `beforeCommand(['files.write'], …)`; it reads the validated input and the asker, and answers only for an input with `outside`. `isAppPage` is `pageOf(client)` among the web contents of `appWindows()`. The chooser is asked for one file, with no filter and no starting folder (the system remembers the last one); hidden files are shown as the system's panel shows them (⇧⌘. there). Under `MAWS_E2E=1` the port's seam answers from `MAWS_E2E_PICK_PATHS`, so no test raises a panel. Tests fail first: the sender's table and the handler's sequences, red before the module exists.

**What it does not touch.** `src/main/ipc/router.ts`, `src/main/windows.ts`, `src/main/client/` (the port's request has what is needed). The page.

**What it proves.** Line 2's main half; A6; A10's and A12's main halves; C1 to C4. Behaviours its tests pin beyond those: through the router with the host dispatcher spied, a `files.write` with `outside` from an app window's top frame is forwarded once with the input unchanged, and from a subframe of it, from a sender that is no window, from a page at another origin, from a window that is not in `appWindows()` and through `dispatchLocal` with a client that is no page it answers `forbidden_sender` with the dispatcher not called; the same write without `outside` from a window that is not in `appWindows()` is forwarded as today; `files.grant` from a page answers `forbidden_sender`; `layout.openFile` for a session whose address names another machine answers `refused: elsewhere` with the port not asked; each ending of the handler; the File menu's ids in order with `file.open` before `file.save`, its accelerator `Cmd+O`, disabled with no handler; `file.open` not rebindable; `file.open` in `SHELL_FOCUS_ACTIONS`.

**Size.** About 190 lines of source and 430 of tests, over about 13 files.

**After it: a stop.** M3 starts on the architect's word that U6b-1 is on master and that the drawn bar was shown, or is to be built as drawn (Concrete Steps 6).

### M3 — The window: an outside file edits and saves, its bar says where it is, Open File…

**What exists at its end.** A1 to A4 and A7 to A11 on screen: an outside file is editable and saves; its bar carries the label; MAWS's own file is read-only with its sentence; Open File… works from the menu, the chord and the Files list's menu, and is disabled where decision 15 says.

**What it touches.** `tools/code/viewer/viewer-store.ts`, `viewer/FileViewer.tsx`, `tools/code/copy.ts`; `tools/code/files/open-chosen.ts` (new), `tools/code/files/FilesTool.tsx` (the menu), `tools/code/editor/register.ts` (the registration's mount); `src/renderer/src/test-support/code-disk.ts`; the suites `viewer/viewer.test.tsx`, `editor/editor.test.tsx`, `editor/register.test.tsx`, `files/files.test.tsx`, and a suite for `open-chosen.ts`.

**Interfaces.** Exposes §D. Consumes §B's keys and §C's command; from U6b-1, by name: `openFile(appSessionId, path, line, { keep })` and `FileBody` as the one component that draws a file's bar beside the chat and in the main area (§E).

**Decisions.** 5, 6, 10, 11, 14 to 16. In the code: `outside` is the entry's, beside `named`, and follows decision 6's rule at every place a load's answer lands (`loadOnce`'s commit, `commitChange`'s two branches, `conflicted`, `loadMore`); `editable` and `readOnlyReason` read it; `save` adds the key. The label is drawn in `FileBody`'s bar ahead of the lead, so the side tab, the main tab and no File artifact view carry it (an artifact's read never answers `named`). The fake disk of the suites (`installDisk`, `code-disk.ts`) gains what the daemon gained, so that a suite can try a write without the key, with a wrong real path and of an own file. `connectOpenFile` follows `connectChannelAction`'s shape. A notice is a `toast` (`stores/notices`). Tests fail first: W1 to W7 and the two call shapes, red before the store changes.

**What it does not touch.** `CodeView.tsx`'s structure (the title reaches it through `readOnlyReason` and `EDITOR_COPY.readOnly`). `EditorControls.tsx`. The Files store and its watch. The strip (`panel/TabStrip.tsx`), `tools/code/files/tabs.ts` and `open-file.ts` beyond calling the opener. `ExternalRow.tsx` (it already asks with `named`, which now admits a chosen file). The transcript's files.

**What it proves.** Line 2's page half; A1 to A4, A7 to A11 as far as a unit test reaches; W1 to W7. Behaviours its tests pin beyond those: with a client that records every call, an outside entry's mount, its typing, a revisit, a tab shown again and an open that carries `asked: 'agent'` record no `files.write`, and Save, `file.save`, the close question's Save and Save all each record one, carrying `outside.real`; a session on another machine: the read carries no `named` and the write no `outside`, whichever kind of session it is; an entry of a file inside the folders sends today's write; the label's three texts by the entry's state and its absence for a file inside the folders; `data-editable` true for a writable outside file and false for an own one; `readOnlyReason` `'maws'`, and `'outside'` only without `outside`; an outside entry's save answered the refusal sentence showing `outsideRefused`, one answered `FILES_MOVED` showing that, and a refused save of a file inside the folders showing the service's words as today; the row "Open File…" in the list's menu calling `layout.openFile` with the tab's session, disabled with the machine's name for a remote session; `file.open` registered for a session of this Mac in front and removed with no session, with a session of another machine, and back; each answer of `layout.openFile` (opened: the opener called once with `keep`; cancelled: nothing; each refusal: its sentence, nothing opened).

**Size.** About 330 lines of source and 700 of tests, over about 13 files.

### M4 — The scenes, the cross-build row, the record, and the acceptance run

**What exists at its end.** The scenes of Interfaces §G are written and typecheck. The charter, C8's document and E5's document carry their dated lines; the tracker has its rows. The whole unit suite has run, and Progress says what is left for the architect.

**What it touches.** `e2e/sessions.spec.ts` (U6c's scene changed, one scene added); `e2e/cross-build.spec.ts` (one row, one scene); other specs only where §G says a scene reads differently; `docs/charter.md`, `docs/doperpowers/plans/2026-09-28-c8-right-panel.md`, `docs/doperpowers/plans/2026-10-05-e5-editor.md`, `docs/tech-debt-tracker.md` ("The pull request"); this document's record.

**Interfaces.** Consumes everything above and the e2e helpers as U6b-1 leaves them (§E).

**Decisions.** The scenes live in `e2e/sessions.spec.ts`, the spec whose cases seed a transcript in a scratch store and need no engine (U6c's M3 decision 4). A scene sets the chooser's answer through main's environment as the spec's other cases do (`MAWS_E2E_PICK_PATHS`). A scene asserts the file's bytes on disk, never only the page. It waits with `expect.poll` and asserts no duration (the gate's script tests read a compared time as a raw bound).

**What it does not touch.** `src/`, but for a marker a scene proves it needs, reported.

**What it proves.** A13 by Concrete Steps 8; the scenes' typecheck and the gate's script tests. Not proved by an executor: every scene's run ("Proof that an executor does not run").

**Size.** About 380 lines of scenes and 40 of documents, over about 8 files.

## Concrete Steps

Working directory for every command: the branch's worktree (the controller's brief names it). The VM sees only what is pushed. `vmcheck.sh` prints `vmcheck: ux-wave/U6e at <short sha>`, then the command's own output, and exits with the command's status; the first call for the branch installs dependencies and takes a few minutes. The VM is shared by three other builds: a check that is slow or times out is read against its load first. Every command there runs under a time limit sized to what it should take.

1. **Before each milestone:**

       git fetch origin master && git merge origin/master
       git push origin ux-wave/U6e

   A merge, never a rebase or a force-push. After a merge that brought changes, run the previous milestone's proof again (the same set, not the whole suite).

2. **The tests before the modules** (each milestone). Commit the suite of the milestone's "What it proves" with the new exports naming nothing; push; run it; the cases that assert the new behaviour fail and the ones that assert what stays pass. Then build.

3. **While building**, after each push (M1 and M2 change the node project; M3 the web project; `src/shared/` is compiled by both):

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6e -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6e -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6e -- 'timeout 600 pnpm exec eslint <the paths changed>'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6e -- 'timeout 900 pnpm exec vitest run <the test files touched>'

4. **Each milestone's proof** is the typecheck of the projects it changed, eslint on its changed files, and vitest over the folders it touched and those that import what it changed:

   - M1: `src/services/files src/services/spine-root.test.ts src/services/library src/shared/ipc src/shared/machine src/mawsd src/main/ipc src/main/lane-b test/endpoint test/lane-b test/mawsd`
   - M2: `src/main/files src/main/ipc src/main/menu.test.ts src/shared/keymap src/shared/ipc src/shared/machine src/renderer/src/settings-tab src/renderer/src/palette src/renderer/src/keymap`
   - M3: `src/renderer/src/tools/code src/renderer/src/tools/artifacts/viewers src/renderer/src/tools/maws src/renderer/src/panel test/support/tokens-guard.test.ts`

   as `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6e -- 'timeout 1800 pnpm exec vitest run <the list>'`. Expected: every file passes but the ones the build brief lists as failing on master on the VM too. `service.test.ts`'s cases guarded for macOS are skipped there and run in the Mac lane.

5. **The wire's minor** (M1, and again after any later merge of master that moved it). Set `WIRE_MINOR` in `src/shared/ipc/wire.ts` one above master's, with its comment; commit; push; then make the two generated files on the VM and bring them back as a patch:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6e -- 'pnpm wire:manifest > /tmp/wire.log 2>&1 || { cat /tmp/wire.log; exit 1; }; git diff -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json; git checkout -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json' | sed 1d > "$TMPDIR/u6e-wire.patch"
       git apply "$TMPDIR/u6e-wire.patch"

   Commit the two files, push, and run `pnpm exec vitest run src/shared/ipc/wire.test.ts src/shared/ipc/wire-fingerprint.test.ts src/shared/machine` on the VM: all pass. Before the bump, `wire.test.ts` fails with its own verdict, "bump WIRE_MINOR to <n> and …", and `src/shared/machine/coverage.test.ts` fails on the snapshot of addressed paths, which lacks the input of `files.grant` (M1) and of `layout.openFile` (M2): those failures are the expected red. The snapshot is written again on the VM with `MAWS_ADDRESS_PATHS_WRITE=1` on that test, after its diff is read (two lines, each a command's `.appSessionId`), and brought back as a patch the same way.

6. **When M2 is pushed and its proof is green: stop.** Tell the controller, who asks the architect. M3 starts only when both hold: `git log --oneline origin/master -- src/renderer/src/tools/code/files/tabs.ts | head -1` prints a commit (the file is U6b-1's; if it prints nothing, U6b-1 is not on master), and the architect has said that the bar is built as "The look" draws it or how it differs. Then read "Statements to check again once U6b-1 is on master" against the merged code before the first edit.

7. **A scene is typechecked, not run** (M4):

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6e -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6e -- 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

8. **The acceptance run** (M4's last step), on the pushed head, after a last merge of master and step 5 if the minor moved:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6e -- 'timeout 2400 pnpm typecheck'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6e -- 'timeout 1800 pnpm lint'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6e -- 'timeout 3600 pnpm test'

   Expected: each exits 0, apart from the files the build brief lists as failing on master on the VM too; vitest's summary names no other failed file. No fixture file is added (the suites build their files in the test); if one is, also run `node --test .github/scripts/maws-app-scan.test.mjs` there. The whole unit suite runs this once, by M4's executor. Acceptance against these runs: A5 to A8's daemon and main halves and A12 are M1's and M2's suites; A1 to A4 and A7 to A11 are M3's; A13 is the three commands; every scene is the architect's.

9. **Stop and hand back.** M4's executor writes into Progress what ran and what is left, pushes, and stops. Class 1a (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6e`), the branch review, the e2e runs and the pull request are the architect's.

## Interfaces and Dependencies

### §A. What is stored and sent, and what build F does with it (M1, M2)

Build F is `f1852de3a`. No field is added to a stored tab, to `main.tabs`, to `regions` or to the stored side surfaces; no version moves; neither settings file is touched.

**Stored.**

| what | what this landing writes | what build F does with it (read at `f1852de3a`) | what this build does with F's write | this build, then F, then this build |
|---|---|---|---|---|
| `<profile>/sessions/file-grants.json` (new) | `{ "version": 1, "sessions": { "<session>": [{ "real": "<real path>", "at": <ms> }] } }`, whole, atomically, mode 0600 | F's spine names `sessions/intents/`, `sessions/bootstraps/` and `sessions/uploads.json` and no other entry of that folder (`src/services/spine-root.ts` at F); it neither reads nor removes this file. M1's executor confirms by reading F's `FileIntentStore` that it lists `sessions/intents/` alone | F writes nothing there | read back whole: every grant stands |
| the tab of a chosen file | nothing new: a Files tab whose params hold `{ file, line }` (U6b-1's row of `panelTools.params`), or a main `file` tab | as U6b-1's rows say: F draws a tab beside the chat as its one Files surface with its tree, and a main `file` tab as its file tab; F's page reads without `named`, so a main tab of a file outside the folders shows F's refusal | as U6b-1's rows | the tab reads and saves as before the stay on F |
| `settings.json` | nothing: `file.open` takes no rebinding (UC-6), so no action id F does not know is stored | — | — | — |

**Sent.**

| | to whom | new in it | a peer that does not know it |
|---|---|---|---|
| `files.read`, `files.openExternal` | this Mac's daemon, with `named` as since U6c | the read's answer may carry `outside: { real, writable }` | a daemon of build F drops `named` and answers the plain read: an outside file is refused, as today. A daemon between U6c and this build answers `named` with no `outside`: the page holds the file read-only (W6) |
| `files.write` | this Mac's daemon | the input may carry `outside: { real }`, sent only for an entry whose read answered `outside` | never reached on a daemon that answers no `outside`; a daemon of F would drop the key and refuse the plain write |
| `files.grant` (new, main-only) | this Mac's daemon, from main alone | the command | a daemon that does not know it answers `unknown_command`; `layout.openFile` answers `refused: unavailable`, and the page says so (A12). Once this build's daemon serves, Open File… works |
| `layout.openFile` (new) | main | main's own command, outside the wire's manifest (`wire-manifest.json` holds no `layout.` entry) | — |

Build F's page served by this build's daemon sends none of the keys and never `files.grant`: it is answered as today, and a grant this build made earlier is not asked, since the read carries no `named`. A session on another machine, of any build: the page sends neither `named` nor `outside` and does not send `layout.openFile` (decision 15); main answers `refused: elsewhere` should it arrive. A page on another machine reading or writing a session of this Mac: the endpoint's schema takes the optional keys, and the service sets them aside for `remote` before the grants or the transcript are asked; `files.grant` has no row in `OFFERS`.

**The wire's minor** is one above master's manifest at the last merge before the gate: one optional key on an answer, one on an input, one command, all additive within the major. Each of `files.grant` and `layout.openFile` carries a session's id, so `src/shared/machine/address-paths.json` gains their lines (its coverage test names them).

**The coverage table** (`e2e/cross-build.spec.ts`, the comment block U13a's M5 began) gains one row, "U6e: `sessions/file-grants.json`, a profile file the peer does not know, and the tab of a chosen file", and one scene, **"(an outside file, both ways)"**: this build opens a session, chooses a text file outside its folders with Open File… (the pick seam), types, saves, and quits; the peer launches on the profile, draws its Files surface with its tree and nothing of the chosen file, refuses no layout value (the scene's existing `INVALID_LAYOUT` check), changes any layout value so that it writes, and quits; the grants file's bytes are what they were; this build shows the file's saved text in the restored tab, takes one more edit and saves it, and the file on disk holds it. The scene skips unless the peer is build F's shape, and a skipped scene is not evidence: the run of record uses `--peer-exact f1852de3a`. No rehearsal over the owner's layout files is owed: no reader of the stored layout changes.

### §B. The daemon (M1)

    // src/shared/ipc/schema/files.ts
    export const FILES_MOVED = 'the path no longer leads to the file that was opened';
    FilesReadOutputSchema   gains  outside: z.strictObject({ real: z.string(), writable: z.boolean() }).optional()
    FilesWriteInputSchema   gains  outside: z.strictObject({ real: z.string() }).optional()
    export const FilesGrantOutputSchema = z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('granted'), path: z.string() }),                  // the real path: what the tab opens
      z.strictObject({ status: z.literal('refused'), reason: z.literal('not-a-file') }),   // a directory, a package, a special file
    ]);
    'files.grant': { input: SessionPathSchema, output: FilesGrantOutputSchema, owner: 'machine' }
    // names/files.ts: 'files.grant' joins `mainOnlyCommands`; grades/files.ts: 'internal'

`named` keeps its two places. On a request it now means: admit a file outside the folders that stands admitted for this session, by a grant or by the transcript, and say so. On an answer: the file is outside the folders and was admitted so. `outside` is present exactly when `named` is, on a daemon of this build.

    // src/services/files/grants.ts (new)
    export const GRANTS_PER_SESSION_MAX = 256;
    export interface FileGrants {
      add(appSessionId: AppSessionId, real: string): void;    // the file first, then memory; the same real path again refreshes its time; throws when the file cannot be written
      has(appSessionId: AppSessionId, real: string): boolean; // memory
      drop(appSessionId: AppSessionId): void;                  // a removed session's
    }
    export function openFileGrants(file: string, options: { now?: () => number; log(line: string): void }): FileGrants;

    // src/services/files/own.ts (new)
    export function ownFolders(profile: string, execPath: string): string[];
    // the real path of `profile`; and of the outermost ancestor of `execPath` whose name ends in `.app`, when there is one. A folder that does not resolve is left out

    // src/services/files/service.ts
    export interface FilesServiceOptions {
      // … as today, and:
      grants?: Pick<FileGrants, 'add' | 'has'>;   // absent: nothing is chosen, and `grant` is refused
      own?: readonly string[];                     // MAWS's own folders, as real paths; absent: none
    }
    interface FilesService {
      write(input: FilesWriteInput, remote?: boolean, signal?: AbortSignal): Promise<FilesWriteOutput>;   // `input.outside`
      grant(appSessionId: AppSessionId, path: string, remote?: boolean): Promise<FilesGrantOutput>;
      // read, openExternal: as U6c, with the grants asked before the transcript; list, watch, unwatch, reveal, readResolved, release, watching, dispose: unchanged
    }

**`precheck`, in order**; a step not marked new is today's.

1. The path is absolute; the session has a record; the path is normal.
2. The roots, less the home for a remote caller.
3. *May the outside rule admit?* Only when the operation is `read`, `openExternal`, or, **new**, a `write` whose input carries `outside`; the request carried the key (`named` for a read and an open; `outside` for a write); and the request is not remote. Settled from the request's own context, before a grant or the transcript is touched.
4. The path's real path. When it does not resolve: the answer `missing` gives. When that is the refusal, the failure is one `missing` reads as absence, and step 3 said yes: `not found: <path>` when, **new**, the path as given is the real path of a grant of the session, or the transcript names it.
5. The real path is under a root: go on, unmarked. Else, step 3 said yes and, **new**, the session has a grant for this real path: a root of one, marked `chosen`. Else step 3 said yes and the transcript names the path as given: a root of one, marked `named`. Else, for `read`, `openExternal` and `reveal`, a delivered file admits it, unmarked, as today (**moved** after the two above for a request with the key: decision 7). Else the refusal.
6. A path whose last component is a link is refused.

The transcript is asked at most once per `precheck`, after everything that does not need it. The rest of the boundary (`openConfirmed`, `confirm`, the type's judgement) is unchanged and runs with the roots step 5 left.

**`read`.** For a marked file every answer carries `named: true` and `outside: { real, writable }`: `real` is the confirmed real path, and `writable` is false exactly when `real` is under one of `own`.

**`write`.** With `outside` in the input: `openConfirmed` for a write with the outside rule allowed; then, before the file's section: the confirmed real path must equal `outside.real`, else `FILES_MOVED`; and for a marked file, the real path must be under none of `own`, else `not writable: <path>`. Then the compare and the write, as today. Without `outside`: today's write, roots alone.

**`grant`.** In order: a remote caller is refused (the service's refusal); the path is absolute and normal and the session has a record, as `precheck`'s step 1; no grants were given: the refusal; `real = realpath(path)`, a path that is gone answers `not found: <path>`; `lstat(real)` is not a regular file: `{ status: 'refused', reason: 'not-a-file' }`; `grants.add(appSessionId, real)`; `{ status: 'granted', path: real }`. A file inside the session's roots, and one of MAWS's own, are granted like any other.

**The grants' file.** Read once when the store is opened. A file that is absent holds nothing. One that does not parse, or names another `version`, holds nothing for this run, is logged once (its size, never its content), and is replaced only by the next `add`. `add` drops the session's oldest entries past `GRANTS_PER_SESSION_MAX`, writes the whole file with `atomicWriteFileSync`, then changes memory.

**Wiring.** `register.ts`: `files.grant` calls `grant` with the context's `remote`; `files.write` passes the context's `remote` as today and, for an input with `outside`, the signal of its client's end (`endOf`). `checkouts-root.ts`: `CheckoutsDeps` gains `grants: FileGrants | null` and `own: readonly string[]`, handed to the service. `spine-root.ts`: `openFileGrants(join(sessionsDir, 'file-grants.json'), …)` in a run that has the spine and null in one refused it (as `uploadRoots`); `view.on('record', …)` drops a removed session's grants; `own` is `ownFolders(profile, process.execPath)`. `test/mawsd/checkouts-clients.test.ts` passes the two new dependencies.

### §C. Main (M2)

    // src/shared/ipc/schema/layout.ts
    export const OpenFileOutputSchema = z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('opened'), path: z.string() }),
      z.strictObject({ status: z.literal('cancelled') }),
      z.strictObject({ status: z.literal('refused'), reason: z.enum(['not-a-file', 'elsewhere', 'unavailable']) }),
    ]);
    'layout.openFile': { input: z.strictObject({ appSessionId: AppSessionIdSchema }), output: OpenFileOutputSchema, owner: 'main' }

    // src/main/files/open-file.ts (new)
    export function isAppPage(client: ClientRef): boolean;   // `pageOf(client)` is the web contents of a window in `appWindows()`
    export interface OpenFileDeps {
      port: Pick<ClientPort, 'pick'>;
      local: MachineRef;
      isAppPage(client: ClientRef): boolean;
      grant(input: { appSessionId: AppSessionId; path: string }): Promise<CommandResult<'files.grant'>>;   // main's own send (`invokeOwn`)
    }
    export function openChosenFile(input: { appSessionId: AppSessionId }, client: ClientRef, deps: OpenFileDeps): Promise<OpenFileOutput>;
    export function guardOutsideWrite(isAppPage: (client: ClientRef) => boolean): BeforeHook;   // registered with `beforeCommand(['files.write'], …)`

`openChosenFile`, in order: the asker is not an app page: `CommandFailure` with `forbidden_sender`. The session's address names another machine than `local`: `refused: elsewhere`, the port not asked. A chooser of this asker is open: `cancelled`. `port.pick(client, { kind: 'file', multiple: false })`: cancelled, no client, or no path: `cancelled`; a pick that throws: `refused: unavailable`. The asker is no longer an app page: `cancelled`, no grant sent. `grant({ appSessionId, path })`: `granted` answers `opened` with its path; `refused` answers `refused: not-a-file`; any error answers `refused: unavailable`.

`guardOutsideWrite`: for a `files.write` whose validated input holds `outside` and whose asker is not an app page, it answers `forbidden_sender` ("files.write outside the session's folders may only be invoked by the app window"); for every other call it answers nothing and the route goes on.

    // src/shared/keymap/actions.ts, the row before 'file.save'
    'file.open': { title: 'Open File…', chord: 'Cmd+O', sink: 'menu', menu: 'file', scope: 'app' },
    // src/main/menu.ts: 'file.open' joins SHELL_FOCUS_ACTIONS

### §D. The window (M3)

    // tools/code/viewer/viewer-store.ts
    interface ViewerEntry { /* … as today, and: */ outside: { real: string; writable: boolean } | null }
    readOnlyReason(entry): 'maws' | 'outside' | 'head' | 'encoding' | 'loading' | null

- `named` is as U6c leaves it: the last load's answer.
- `outside` is the answer of the load that put the entry's document on screen. A load that lands on an entry with no unsaved edits sets it from its answer (null when the answer has none). A load under unsaved edits sets it only when the entry has none; it never replaces one.
- `editable` is `!readOnly && isEditable(file) && (!named || outside?.writable === true)`.
- `readOnlyReason`: `'maws'` for a named entry whose `outside` is not writable; `'outside'` for a named entry with no `outside` (W6); then today's reasons.
- `save`: an entry with `outside` sends `files.write` with `outside: { real: entry.outside.real }`; a named entry that is not writable answers `'noop'` and sends nothing; an entry of a file inside the folders sends today's request. A session on another machine never carries the key (it never gets `named`). A save of an entry with `outside` that is answered the service's refusal sentence sets the entry's save error to `EDITOR_COPY.outsideRefused` (decision 18); every other failure keeps its own words, `FILES_MOVED` among them.
- `revisit` and the read's `named` key are U6c's.

Copy, in `tools/code/copy.ts` (exact strings):

    VIEWER_COPY.outside         = 'Outside this session’s folders'
    VIEWER_COPY.outsideReadOnly = 'Outside this session’s folders · read-only'
    VIEWER_COPY.outsideSaves    = (real: string) => `This file is not in the folders this session works in. Save writes to ${real}`
    VIEWER_COPY.outsideOwn      = 'MAWS does not edit its own files: its profile folder and its app'
    EDITOR_COPY.readOnly.maws   = 'Read-only: MAWS does not edit its own files'
    EDITOR_COPY.outsideRefused  = 'MAWS may no longer write this file for this session. Choose it with File ▸ Open File… to save it'
    // EDITOR_COPY.readOnly.outside stays, for W6 alone
    OPEN_FILE_COPY = {
      row: 'Open File…',
      elsewhere: (machine: string) => `Open File… (this session runs on ${machine})`,
      notAFile: 'Open File opens one file. A folder or an app’s package cannot be opened here.',
      unavailable: 'MAWS could not open the file just now. Try Open File again in a moment.',
    }

The label, in `FileBody`'s bar ahead of the lead, drawn when the entry is `named`: `[data-outside="writable"]` with `outside` and the tooltip `outsideSaves(real)`; `[data-outside="own"]` with `outsideReadOnly` and the tooltip `outsideOwn`; `[data-outside="read-only"]` with `outsideReadOnly` and the tooltip `EDITOR_COPY.readOnly.outside` (W6). It keeps its width; the path gives way first, as it does to the controls today.

    // tools/code/files/open-chosen.ts (new)
    export function openChosen(appSessionId: AppSessionId): Promise<void>;
    export function connectOpenFile(): () => void;

`openChosen` invokes `layout.openFile`; on `opened`, when the page still knows the session, `openFile(appSessionId, path, null, { keep: true })`; on `cancelled`, nothing; on a refusal, a notice with the sentence (`elsewhere` shows `unavailable`'s: the page does not ask for such a session). `connectOpenFile` keeps `file.open` registered, with a handler that calls `openChosen(shownSession())`, exactly while `shownSession()` is a session the page knows whose machine is this one; it is mounted by `registerEditor`. The Files list's menu: `[data-files-menu]`, opened by a right-click in the tree and by ⇧F10 with the keyboard in it, with one row `[data-open-file]`: `OPEN_FILE_COPY.row` calling `openChosen` with the tab's session, or, for a session on another machine (`useElsewhereMachine`), disabled with `elsewhere(machine)`.

### §E. What this landing consumes, and what a sibling may rely on

**Consumed.**

- **U6c** (on master). The key `named` on the two requests and on the read's answer; `createNamedPaths(...).names` as the service's `named`; `ViewerEntry.named`, `revisit`, the service's refusal sentence. This landing changes U6c's decisions 9 (the key's meaning), 14 (read-only) and 18 (what is withheld: MAWS's own folders now are, from a write), and its Interfaces §C (the order of `precheck`, `write`), §D (the answer, the write's input) and §E (`editable`, `readOnlyReason`, `save`).
- **U6b-1** (not on master; M3 and M4 wait for it). `openFile(appSessionId, path, line?, options?)` with `options.keep`, and its answer; `FileBody` as the one component that draws a file's bar; the Files tab's tree (`[data-files-tree]`) in `FilesTool.tsx`; `focusedFile` deciding what ⌘S saves; the scene helpers as its M5 leaves them. Nothing of its stored form is changed.
- **U8c-2** (on master). `rootsOf`'s answer as it is: a file under a folder it admits is inside the folders and never reaches the outside rule.
- **U9.** Nothing is edited. Open File… is disabled for a session on another machine, with its sentence in U6's own copy; if `test/lane-b/offer-coverage.test.ts` asks for a declared row for a new name, the row is one entry in U9's `REMOTE_UNAVAILABLE` and is reported before it is made.
- **U6a.** The action table's shape and the rule that an id build F does not know takes no rebinding.

**For the siblings, by name.**

- **U6b-4** (the link forms): a form it adds to `named` is editable at once (decision 1). Its notice table can recognise `FILES_MOVED` and `not writable: <path>` as it recognises the refusal sentence. Its "Open in" in a file's bar sits beside the label, not in its place.
- **U6b-2** (a file's bytes to a frame): its route asks `files.read` with `named`, which now also admits a chosen file; so a chosen PDF is drawn once U6b-2 lands, with no change there. It never sends `outside`: a frame writes nothing.
- **Whoever adds a kind of admission later:** the mark in `precheck` (`chosen`, `named`) is the one place that decides both the read's `outside` and the write.

### §F. Files other children own, or no child owns (UC-8)

| files | owner by UC-8 | this landing |
|---|---|---|
| `src/services/files/service.ts`, `register.ts`, `grants.ts` (new), `own.ts` (new), their suites; `src/services/checkouts-root.ts` | no child (the row lists U6c and U8c-2) | the outside rule for a write, the grants, the wiring (the row gains U6e in the architect's batch) |
| `src/services/spine-root.ts` and its suite | the P5 work, with the session that keeps master (U6c inserted the transcript's locator) | one insertion beside `uploadRoots`: the grants' file, the listener that drops a removed session's grants, `own` |
| `src/shared/ipc/schema/files.ts`, `names/files.ts`, `grades/files.ts` | no row | two optional keys, one command |
| `src/shared/ipc/schema/layout.ts`, `names/layout.ts` | by key; a command has no row | the command `layout.openFile` |
| `src/shared/ipc/wire.ts`, `wire-manifest.json`, `wire-fingerprint.json`, `src/shared/machine/address-paths.json` | no child; the row lists the landings that raise the minor | the minor, at the merge; the lines of the two commands |
| `src/main/files/open-file.ts` (new) and its suite | no row | the chooser's handler and the guard |
| `src/main/app.ts` | no child | two registrations: `registerMainHandler('layout.openFile', …)` and `beforeCommand(['files.write'], …)` |
| `src/main/ipc/router.test.ts` | no child | the sender's cases |
| `src/shared/keymap/actions.ts`, `src/main/menu.ts`, their suites | U6 | the row, and one id in `SHELL_FOCUS_ACTIONS` |
| `src/renderer/src/tools/code/viewer/`, `tools/code/files/`, `tools/code/editor/register.ts`, `test-support/code-disk.ts` | U6 (the fake disk: no row) | the window |
| `src/renderer/src/tools/code/copy.ts` | U5's and U6's strings in one file | the strings of §D |
| `e2e/sessions.spec.ts` | no row | U6c's scene changed, one scene added |
| `e2e/cross-build.spec.ts` | the P5 work; the table is U13a's | one row, one scene (§A) |
| `docs/charter.md`, `docs/doperpowers/plans/2026-09-28-c8-right-panel.md`, `docs/doperpowers/plans/2026-10-05-e5-editor.md`, `docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md`, `docs/tech-debt-tracker.md` | the record | one dated line each; the tracker's rows ("The pull request") |
| `src/main/ipc/router.ts`, `src/main/windows.ts`, `src/main/client/`, `src/endpoint/`, `src/main/lane-b/`, `src/renderer/src/lane-b/`, `src/renderer/src/transcript/`, `src/renderer/src/panel/`, `src/services/files/named.ts`, `allowlist.ts`, `admission.ts`, `src/shared/files/named.ts` | the router: no child; the rest as UC-8 names them | read, and not edited |

### §G. The e2e groups whose scenes cross this change

By the group's name in `package.json`; `e2e` is the default group (the specs no script lists).

| group | spec | scenes that change, or are added |
|---|---|---|
| `e2e` | `e2e/sessions.spec.ts` | **Changed:** U6c's scene, now "a file the transcript links opens from outside the session's folder, is edited, and is written only by Save; nothing else is". As U6b-1 leaves it, then: the bar's label `[data-outside="writable"]` and the path; `data-editable="true"` and no title on the content; type: `data-dirty="true"`, Save shown, the file's bytes on disk unchanged; ⌘S: the bytes are the typed text; change the file on disk, type, Save: the merge view, the bytes still the disk's. Through `window.maws.invoke`, each refused with the bytes read back: `files.write` with `outside` of `unnamed.txt`, of `key`, of `notes.txt` under session T, and of `notes.txt` without `outside`; `files.list` of the outside folder as before (that the page cannot send `files.grant` is the router's suite's: a main-only name is not on the page's bridge). **Added:** "Open File… opens a chosen file beside the chat, it saves, and a relaunch keeps it": with `MAWS_E2E_PICK_PATHS` unset, File ▸ Open File… changes nothing; set to a text file in a fresh folder outside the session's: the menu item (and, a second time, the Files list's row) opens it as a kept tab beside the chat with the label; type and ⌘S: the bytes on disk; relaunch on the same store: the tab, the text, one more save; then the pick set to a file under the launch's profile folder: `[data-outside="own"]`, `data-editable="false"`, typing changes nothing, the title of §D; with the Overview in front the menu's item is disabled |
| `e2e:code` | `e2e/code-editor.spec.ts`, `e2e/code-tools.spec.ts` | none is expected to change: a file inside the folders sends today's write and draws no label. Run because the store's `save`, `editable` and the bar are theirs; "the editor, the notice, the merge view and the conflict view use tokens only in both themes" is the tokens' check for the bar (the label is drawn only outside the folders, which that spec's scenario sessions cannot reach; the tokens guard and M3's suite cover it) |
| `e2e:deliverables`, `e2e:library` | `e2e/deliverables.spec.ts`, `e2e/library.spec.ts` | none is expected to change; run because the order of `precheck` moved for a delivered file read with the key (decision 7) |
| `e2e:remote` | `e2e/remote.spec.ts` | the steps that read and save a file of the other machine's checkout: added assertion, the write carries no `outside` and the read no `named`; a link outside the folders there shows today's refusal |
| `e2e:layout` | `e2e/ux2-shell.spec.ts`, `e2e/shell.spec.ts` | read by M4's executor for a scene that lists the File menu's items or the shortcut sheet's rows; changed only there |
| `e2e:settings` | `e2e/settings.spec.ts` | read for a scene that counts Settings › Keyboard's rows: "Open File…" is one more row, with no control to rebind it |
| `e2e:tools` | `e2e/maws-tools.spec.ts` | a replayed `show_pane` for a file: unchanged; read, since an agent's open now leads to an editable tab |
| `e2e:cross-build` | `e2e/cross-build.spec.ts` | added: "(an outside file, both ways)" (§A) |

Read by M4's executor and reported, not changed without the architect: the paid live specs that open a file by a click or by `show_pane` (`e2e/code-tools-live.spec.ts`, `e2e/p1-live.spec.ts`, `e2e/maws-tools-live.spec.ts`); whether a paid group runs is the architect's (root UC-10, "Paid live groups").

## Statements to check again once U6b-1 is on master

Each is a statement of this document that rests on U6b-1's document and not on code at the parent pin. M3's executor reads each against the merged code before the first edit, and reports a difference before building around it.

| # | the statement | where it is used | read it in |
|---|---|---|---|
| 1 | `openFile(appSessionId, path, line?, options?)` takes `{ main?, keep?, asked? }`, opens beside the chat for a known session, and `keep: true` makes a kept tab | decision 16; §D `openChosen` | `tools/code/open-file.ts` |
| 2 | An open made before the layout is read is kept and made later, so `openChosen`'s call needs no wait of its own | §D | `open-file.ts` (U6b-1's decision 10) |
| 3 | `FileBody` draws the bar of a file beside the chat and in a main tab, with `lead` and `controls`, and a File artifact's view passes no `lead` | decision 11; §D the label | `tools/code/viewer/FileViewer.tsx`, `tools/code/files/FilesTool.tsx` |
| 4 | The Files tree is one element (`[data-files-tree]`) in every Files tab, so one context menu on it serves all | "Reported" 1; §D | `FilesTool.tsx`, `tools/code/files/tree-state.ts` |
| 5 | ⌘S saves the file whose viewer holds the keyboard, else the main tab on screen (`focusedFile`); so an outside file beside the chat is saved by ⌘S only while it holds the keyboard | A1, A2; M3's cases of the four ways to save | `tools/code/editor/register.ts` |
| 6 | The viewer store's entry is keyed by the id a main tab of the file would have, and U6b-1's edits of `viewer-store.ts` (the prune's open keys, `holdKey`) meet none of the functions this landing edits | M3 | `tools/code/viewer/viewer-store.ts` |
| 7 | A file with unsaved edits whose session goes becomes a main tab (`keepUnsaved`); for an outside file its next save is then refused with the session unknown, as for any file | S8 | `tools/code/files/tabs.ts` |
| 8 | A tab's stored params are `{ file, line, preview? }` and nothing of them says where the file is; a restored tab learns `outside` from its read | §A | `tools/code/files/tabs.ts` |
| 9 | `shownSession()` is still the focused pane's active tab's session, a file tab's included | decision 15; `connectOpenFile` | `panel/host.ts` |
| 10 | U6c's scene in `e2e/sessions.spec.ts` as U6b-1's M5 leaves it (the file beside the chat, the main strip unchanged), and the helpers it uses | §G | `e2e/sessions.spec.ts`, `e2e/support/shell.ts` |
| 11 | Where the keyboard goes after a person's open; `file.open` is in `SHELL_FOCUS_ACTIONS` so that this holds from a page of the in-app browser too | decision 13 | `FilesTool.tsx`, `src/main/menu.ts` |
| 12 | U6b-1 takes no wire minor and stores no profile file, so §A's rows are this landing's alone | §A | U6b-1's Interfaces §A |

## Proof that an executor does not run

Each is a step for the architect, with what it needs.

1. **The two scenes of `e2e/sessions.spec.ts`, each alone, then the default `e2e` group**, on a Mac under the load rule, from the branch's head. Needs: the built app; nothing of the owner's (the cases' scratch store, folders and profile).
2. **The groups that cross the code** (§G): `e2e:code`, `e2e:deliverables`, `e2e:library`, `e2e:remote`, `e2e:layout`, `e2e:settings`, `e2e:tools`.
3. **The cross-build run** with build F as the exact peer (`e2e:cross-build`, `--peer-exact f1852de3a`), on the final head: the scene "(an outside file, both ways)".
4. **The macOS unit files.** `src/services/files/service.test.ts` is among the files `scripts/darwin-unit-files.sh` lists; its guarded cases, old and new (the swaps under `O_NOFOLLOW_ANY`), run in the Mac lane.
5. **Class 1a**, once, when the branch is complete: `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6e`.
6. **The branch review** (Decision Log 4): the panel, with its lenses.
7. **A live turn**, on a Mac that is not the owner's MacBook, with a real engine: the agent writes a file outside the session's folder, links it, and opens it by itself with `show_pane`; the person edits and saves it in MAWS; the agent then edits the same file with its own tool, and the person's next save meets the merge view. This is the one route the suites cannot show (no engine writes a transcript under the replay transport). Needs: the wave's build, an engine, a few cents. It may ride in the owner's sitting instead.
8. **The owner's look.** Before M3: "The look" as drawn (the bar in a wide and a narrow tab, MAWS's own file, the Files list's menu), with cards A, B and D. In the sitting's scene script: A1, A3, A4, A8, A9, and a session on another machine showing what it shows today with Open File… grey.

## The pull request

Its body names its class 1a run, the review's verdict with what was dismissed or deferred, the cross-build run, and its residue. It carries, dated, the rulings this landing reverses where they stand (root UC-10, "The record"):

- **`docs/charter.md`, §19 (Decision log), one entry:** "2026-11-14 (owner; UX wave U6e, O-37): on the machine that holds a session, a file outside the session's folders that the files service reads there (C8's K1 as amended 2026-11-13) can also be edited and saved, and the person can open one with Open File…, which records their choice for that session. The owner's words: 'I'd go even further to make it editable too', then 'Every outside file' and, on Open File, 'Yes, add it'. The daemon writes such a file only when its own evidence admits it (the session's transcript names it, or the person chose it in the system's file chooser), only for the app window's page, only while the path still resolves to the file that was shown, and with the hash check of every save; never for a caller from another machine (P5 Decision Log 237), and never MAWS's own profile folder or app. This reverses 'such a file is never written' of the entry of 2026-11-13; its folder is still never listed or watched."
- **`docs/doperpowers/plans/2026-09-28-c8-right-panel.md`, at K1, one line under U6c's:** "Amended 2026-11-14 (UX wave U6e; the owner's answer 'Every outside file'): `files.write` also admits, for a caller on the session's own machine that sends `outside`, one regular file outside the roots that the session's transcript names or that a grant of the session holds (`src/services/files/grants.ts`, made by the main-only `files.grant` after the system's chooser); `files.list`, `files.watch` and `files.reveal` do not."
- **`docs/doperpowers/plans/2026-10-05-e5-editor.md`, at G1, one line:** "Amended 2026-11-14 (UX wave U6e): `files.write` is confined as `files.read` is, the file outside the roots that U6c's and U6e's rules admit included, when the write says so (`outside`) and names the real path it was read at."
- **U6c's document, Decision Log 27** (written with this document): the read-only half of the owner's choice of 2026-11-13 is reversed by the owner's answer of 2026-11-14.

`docs/tech-debt-tracker.md`: the row of 2026-11-13 on a delivered file stays, with card D named as its exit. It gains: a session rooted in a folder that holds MAWS's profile can still write MAWS's own files from inside its folders ("Reported" 4); a presentation window and the repair window pass the router's sender check for every other command (`isAppSender`), found while reading it; the protected bundle is the daemon's own ("Reported" 9).

What the pull request tells the owner, beyond the two answers: a file of MAWS's own opens read-only with its sentence; a file the agent sent is unchanged until card D is answered; Open File… is not offered for a session on another machine until card A is answered.

## Surprises & Discoveries

- Observation: the daemon cannot tell main's requests from those of any other client of its socket, so "the app window's top frame" is a fact only main can check, and it checks it in two places: the router's sender check for every command, and one hook for the outside write.
  Evidence: `src/shared/host/socket-server.ts` (the hello's token, checked with `tokenMatches`; `appPid` and the capabilities are what the client says of itself); `answer` in `src/mawsd/front.ts` serves every `machine` command to every welcomed client.
- Observation: the router's sender check accepts more than the app window: any window of the app whose top frame is at the app's origin, which a presentation window and the repair window are.
  Evidence: `isAppSender` in `src/main/ipc/router.ts` (`BrowserWindow.fromWebContents`, the top frame, the origin; for a built app, the `file:` protocol); `src/main/presentations/present.ts` and `src/main/repair/index.ts` each make a `BrowserWindow` with a preload; `appWindows()` in `src/main/windows.ts` holds only what `createWindow` registered.
- Observation: a daemon command cannot wait for the person's choice in a chooser, so main runs it, as it does for the composer's file pick.
  Evidence: `REQUEST_TIMEOUT_MS = 10_000` in `src/shared/host/host-supervisor.ts`; `layout.pickFiles` in `src/main/app.ts` and `src/main/files/pick.ts`.
- Observation: the write's boundary already resolves the path at the write and opens it with no link on the way; what it lacks for the architect's addition 2 is the real path of the admission to compare with, which only the read's answer or a grant can give.
  Evidence: `precheck`, `openNoLink` and `confirm` in `src/services/files/service.ts`; `FilesReadOutputSchema` holds no path.
- Observation: U6c asks the delivered files before the transcript, so a file that is both delivered and named is answered with no `named`, looks like a file inside the folders, and its save is refused.
  Evidence: `precheck`: `if (admits && (await admitted?.(appSessionId, real0))) roots = [...roots, real0]; else if (nameAdmits && (await namesIt())) …`; the tracker's row of 2026-11-13 on a delivered file.
- Observation: the Files tree has no menu, at the parent pin or in U6b-1's document; the owner's card names one.
  Evidence: `TreeList` and `RefreshButton` in `src/renderer/src/tools/code/files/FilesTool.tsx`; U6b-1's Interfaces §C (the fold button is the tree's one new control).
- Observation: a file tab with no session reads nothing, so Open File… has to act for a session.
  Evidence: `NoSession` in `tools/code/viewer/FileViewer.tsx` ("No session grants access to this file"); `precheck`'s `unknown app session`.
- Observation: ⌘O is free in MAWS and is Claude Desktop's chord for the same menu item.
  Evidence: no `Cmd+O` in `src/shared/keymap/actions.ts` or `menu-roles.ts`; CodeMirror's default keymap binds Ctrl+O; `main-process/index.chunk-BV3uOqbK.js:325087-325097` of Claude Desktop `app-5.1231.2` (File ▸ "Open File…", accelerator `Cmd+O`).

## Decision Log

1. **2026-11-14 · The owner's words** (from the dispatch, verbatim; the owner's day). Asked whether a link inside a shown Markdown file may open a file outside the folders, the owner typed: "I'd go even further to make it editable too. There are lots of situations where I have to open a file from external folder that need to be edited or be looked at. I don't see a good reason to block it from editing or reading."

2. **2026-11-14 · The owner's answers on the two cards** (from the dispatch). How far editing goes: "Every outside file (Recommended)", which the card described as: any file MAWS shows from outside the folders can be edited and saved (one linked in the conversation, in a subagent's transcript or inside a Markdown file, and a linked file the agent opened by itself); nothing is written until Save is pressed; the "Read-only" title goes away; this includes files such as a shell profile or a key file if something links them; which files may open stays as answered (the person's click opens anything linked; the agent by itself only what the conversation links). And an Open File command: "Yes, add it (Recommended)", described as: a command in the File menu with a shortcut, and an "Open File…" row in the Files list's menu; the file picked opens beside the chat, editable. This reverses the read-only half of the owner's choice of 2026-11-13 recorded in U6c's Decision Log 2; the newer answer wins, and U6c's Decision Log 27 says so there.

3. **2026-11-15 (UTC) · The architect's condition, its reading, and four additions.** The condition: "An outside file becomes writable only as the person's own act, i.e. a file they opened through a user gesture in that window, held as a per-file grant main issues, never as a path a renderer, an artifact frame or a preview names. Agent writes stay with the engine's permission rules, untouched by this." Its reading, confirmed by the architect: the act is the save, and the open is only what lets the file in; a write is admitted when the file stands admitted for that session by evidence the deciding process reads itself, and the save comes from the app's own window with the expected-content check. The additions: (1) main cannot verify a gesture, so the rule is "only the app window's top frame, which saves only on a person's press", and the test is on the sender; (2) the path is resolved at the admission and again at the write, and the write is refused when the two differ, with a test that swaps a link in; (3) MAWS's profile folder and the app bundle are never writable through this, however the file was admitted, and the person sees the file read-only with a sentence; (4) an outside file's tab shows that it is outside, with its path, in a form designed here and shown to the owner. "The write rule" and decisions 6, 8, 9 and 11 are their places.

4. **2026-11-15 (UTC) · The verification call** (the author, at authoring). This document gets an adversarial review before an executor starts (the architect dispatches it). The branch gets the `doperpowers:review-code` panel (xhigh): by size it is past the panel's threshold (about 45 files and 3,200 changed lines, two thirds of them tests and scenes), and it takes the panel in any case because it widens what the files service writes, which the root treats as delicate wherever a landing meets that boundary (UC-10; U6c's Decision Log 3). The lenses: (a) the boundary: the one admission step for read and write, the remote test before any grant or transcript is asked, the root of one through the open and the confirmations, the real path compared on the confirmed descriptor, MAWS's own folders, and that `list`, `watch` and `reveal` reach nothing new; (b) the grants: who can make one, the file's writes and reads across a restart, the bound, a removed session, a file that does not parse; (c) main: the sender's guard for every way a request can enter, the chooser's sequences, the main-only name; (d) other machines and other builds: every pairing of §A, and that nothing new crosses a link; (e) the window: `outside` across every place a load lands, no route to a write but the four presses, the label's states; (f) the public repository: fixtures and scenes hold nothing of the owner's. Class 1a on GitHub Actions is the gate of record.

The decisions as they stand are in "Decisions settled at authoring", each with what it beat. Entries below this line record what moves after.

## Outcomes & Retrospective

Pending — written at finish.
