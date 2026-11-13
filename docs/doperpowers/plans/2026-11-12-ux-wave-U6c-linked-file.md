# UX wave · U6, a landing of its own (U6c): a file the transcript names opens read-only from outside the session's folders

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6, a landing of its own (**U6c**), cut from item O-37 by the owner's answer of 2026-11-13. **Parent pin:** `6b58dd6532e2cbb95861d6174cc929341b38b314`, the head of branch `ux-wave-spec` this document was written against.
>
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *section*: its item "O-37 · a linked file opens in MAWS, and a refusal says why", whose paragraph "What stays refused" left one thing to the owner (its "Waiting", last entry). The owner has answered, and the section does not hold the answer yet (the spec's next batch will). Until then the record of the answer is this document's Decision Log, entries 1 and 2, copied from the board ticket's body; where the section's words and those entries differ, the entries hold. This document carries the constraints, the decisions the answer left to the design, the milestones and the interfaces. The root and the section are read on branch `ux-wave-spec`.
>
> **Branch:** `ux-wave/U6c`, from master `c0e7b2ae8`. **Board:** ticket 622, under epic 573. **Item:** O-37, the part the owner answered. **Not in this landing:** the rest of O-37 and of U6, which is U6b (ticket 592).

## Purpose

An agent often links a file by its absolute path, and the file is often outside the folders its session works in: another repository, a downloads folder, a temporary folder. Today a click on such a link opens a tab that says "Refused: path outside the session's directories", on every machine, because MAWS's files service reads only a session's own folders.

After this landing, on this Mac, that click opens the file, read-only, when the session's own transcript names the path. Text, code and images are drawn in the tab as a file inside the folders is drawn; a kind MAWS does not draw (a PDF) gets today's row, and its "Open externally" button works. The process that reads the file checks the path against the transcript before it reads, so the window cannot ask for other files. Nothing can be written through MAWS to such a file, and its folder is never listed or watched. A session on another machine keeps today's refusal.

How to see it working: in a session whose transcript holds a link to a text file outside its folders, click the link. The file's text shows in a file tab; typing changes nothing and the editor's title says the file is outside the session's folders. A link to a PDF outside the folders shows "PDF files open outside MAWS" with "Open externally". Asking for a path the transcript does not write still shows the refusal.

## Progress

- [x] (2026-11-13 09:35Z) Document written against master `c0e7b2ae8` and parent pin `6b58dd653`: the click's path grounded in the code at that head and in build F (`f1852de3a`); the siblings' documents read on their branches. Twelve points reported to the architect ("Reported to the architect").
- [ ] The adversarial review of this document, and the architect's rulings on the reported points.
- [ ] M1 — The rule and the search.
- [ ] M2 — The admission: the request's key, the service, the daemon's wiring, the wire.
- [ ] M3 — The window, the e2e scene, the record, and the acceptance run.

## The landing's edge

**In.**

- The admission of one file, read-only, for a caller on the machine that holds the session, when that session's transcript names its path: decided in the files service, where the read runs.
- The file drawn as a file inside the folders is drawn today (the same viewer, the same kinds, the same caps).
- "Open externally" working for the admitted file.
- Read-only in the window: no edit, no save, and the reason said in the editor's existing title.
- A file that could not be read, or that no watch keeps current, read again when the person asks for it again.
- The record: the charter's dated entry and the dated line where K1 stands ("The pull request").

**Not in, and left to U6b (ticket 592).** The refusal in plain words (the section's notice table); PDF, HTML and media drawn inside MAWS; `file://` links and relative links; the instruction sentence to the agent; the notices for a session on another machine. This landing changes no word of any notice: a refusal still reads "Refused: " and the service's sentence.

**Not in, and nobody's.** A session on another machine: unchanged (P5 Decision Log 237, `docs/doperpowers/plans/2026-10-27-p5-org.md`). `files.write`, `files.list`, `files.watch` and `files.reveal`: unchanged. A delivered file (`send_file`): admitted as today, by its own rule. Paths recognised in prose without a link, `~` expanded, DOCX and the like (the section's "Not included").

## Reported to the architect

Each point is a decision that changes what the owner sees beyond their words, a fact the spec states otherwise, or a follow-up in the spec's files. Each has the default this document is written on and the one place a different ruling changes.

1. **Which process checks.** The card's option says "the main process checks the path against the transcript". No launch composes the files service in Electron main any more (P5 O15 M2: `src/main/hosts/mode.ts`, "Every launch that reaches the app runs on the machine daemon, `mawsd`"); the read and the check run in `mawsd`. The owner's meaning (not the window) holds. The ticket's body already says "the process that reads the file". For the spec's words only; nothing here changes.
2. **A tool's result counts.** Decision 2 counts every row of type `user` or `assistant`, whole: the agent's text, a tool call's input, a tool's result, the person's message, an arrival. The card's option reads "any file whose path appears in that session's transcript, written by the agent or by you"; a tool's result is written by neither. Default: it counts, because the window draws links from results (a subagent's report is the `Agent` call's result; a peer's message is a row) and a link that is drawn and refused reads as a defect. A ruling against changes one function: `rowNames` (Interfaces §A).
3. **Rows the window draws from another file name nothing.** A subagent's own rows are in its own file beside the session's, and a side thread's rows are in the side thread's transcript. A link inside them opens only when the session's own transcript also writes the path (it usually does: the `Agent` call's result carries the report). Default: the session's own transcript file alone. A ruling for the agents' files changes the search's file list (Interfaces §B) and its cost: a long session holds thousands of agent files.
4. **The reason shown.** Read-only needs the person to know why typing does nothing. Default: the editor's existing read-only title (the tooltip on the content, which today says "Read-only: the file is not UTF-8" and two others) gains a fourth: "Read-only: the file is outside the folders this session works in". No element is added. A ruling against removes one copy key and one line (Interfaces §E).
5. **A file is read again when asked for again.** Today "nothing retries" a refused read: the tab keeps the refusal until it is closed. A link can be clicked while its message is still being written, before the engine has put the row in the transcript, and the read is then refused though the path is named a moment later. Default: a tab whose last read failed reads again when its tab is shown again or its link is clicked again; a file admitted by name, which no watch keeps current, is read again at the same two moments. This holds for every refusal, inside the folders too (a file that was not there and now is). A ruling against changes one method, `revisit` (Interfaces §E), and leaves the race as a refusal that stays.
6. **A named file that is gone says so.** Today a missing path outside the folders answers the refusal, so that the command says nothing of what exists elsewhere. Default: when the transcript names the path, the answer is `not found: <path>`, as inside the folders. A ruling against changes one branch of step 2 (Interfaces §C).
7. **Nothing more is withheld outside than inside.** Inside a session's folders the service withholds by shape only (a link as the last component, a directory, a special file, and for "Open externally" an executable or a kind off its list); it has no rule about names, so a `.env` or a key inside the folders opens. Default: the same outside, since the agent that named the path could have printed the file. A ruling for a filter would be a new rule in `precheck` and is not designed here.
8. **The search reads the newest 1 GiB.** A path named only in rows older than that is refused. The largest transcript the code speaks of is 625 MB. A ruling changes one constant (`NAMED_SCAN_BYTES`).
9. **A delivered file in a file tab still looks editable.** A file `send_file` delivered from outside the folders, opened by a path link, takes typing today and then fails its save with the refusal. This landing leaves it: its edge is the named file. The read-only state it adds to the viewer would serve a delivered file too, once the service's answer said so by a key of its own. Worth a tracker row.
10. **The cross-build run gets no scene.** Whether this build's window, served by a `mawsd` of build F, shows today's refusal is pinned by a unit test of the mechanism and by the reading of F's code (Interfaces §D). `e2e/cross-build.spec.ts` has no scene whose daemon is not the attaching app's build (its header: "none today"). Default: none is added.
11. **What follows in the spec's files** (the architect's, in the next batch). The section: "What stays refused"; Design inheritance, "Binds" ("this child changes neither"); "Not included" ("Any change to which folders a session may read"); acceptance A5's sentence on a file outside the folders; the notice table's first row and its second sentence ("Ask the agent to send the file to see it here"), which on this Mac now means the transcript does not write the path; "Both stay"'s instruction sentence, which says a link opens only inside the session's folders; "Waiting", last entry; "Rulings reversed" (this landing's two places, "The pull request"). The root: the "Rulings reversed" table; "Deferred and out of scope", the line "a linked file outside the session's folders (O-37; U6)"; UC-8's row for `src/shared/ipc/wire.ts`, which gains U6c; "Ordering and dependency map" and the Tracking map. UC-8 has no row for `src/services/files/`, which this landing and U8c-2 both edit (Interfaces §G).
12. **For U6b's design.** Two of its parts meet the rule of Interfaces §A: a `file://` link is not named by it (the character before the path is `/`), and a relative link resolved to a path outside the folders is not written in the transcript as the path asked. U6b extends the rule's start for `file://` and says what a relative link outside the folders does. Its route that serves a file to a frame asks the same check with the same key.

## What the code holds today

Read at master `c0e7b2ae8`; build F is `f1852de3a`.

1. **The click.** A Markdown link with no scheme becomes `maws-path:<url>` (`remarkTranscriptSources`, `src/renderer/src/transcript/view/markdown/sanitize.ts`). `TranscriptLink` (`markdown/Link.tsx`) draws it as a chip and on a click calls `actions.openFile(path, line, session)`: `path` is the href after `decodeURI`, less a trailing `#L<n>` or `:<n>`; `session` is the row's session (`useRowSession`, `view/context.tsx`), which for a subagent's rows is the parent's. Tool rows open files the same way (`ReadDetail.tsx`, `EditDetail.tsx`), with the path of the call's input.
2. **The tab.** `openFile` (`src/renderer/src/tools/code/open-file.ts`) collapses `.` and `..` without touching the disk (`normalizeLexically`) and calls `openTab({ kind: 'file', path, line, appSessionId, machine })`. The tab's id is `file:<machine>:<path>` (`tabId`, `src/shared/ipc/schema/layout.ts`): one tab per machine and path, whichever session opened it.
3. **The read.** `FileViewer` mounts `FileBody`, which mounts the tab's entry in the viewer store (`viewer/viewer-store.ts`). The store first takes a watch on the file's folder (`files.watch`, through the Files store), then reads: `files.read { appSessionId, path, offset, length, hash? }` (`readChunk`). For a file outside the folders the watch is refused and the read goes on. A failed read sets the entry to `error` with the message, drawn by `Refused` in `FileViewer.tsx` as `VIEWER_COPY.refused(message)`: "Refused: path outside the session's directories". Nothing reads again until the tab is closed and reopened (the store's header: "nothing retries it").
4. **The route.** Renderer client, preload, main's router (`src/main/ipc/router.ts`), which validates the input strictly and, for a session on this Mac, sends it to `mawsd` over `machine.sock`; `mawsd`'s front (`src/mawsd/front.ts`) reads the input with the tolerant reader and calls the handler `registerFilesHandlers` registered (`src/services/files/register.ts`) with the context `{ client }`. For a session on another machine main's lane B adapter sends the input as it is over the machine link (`src/main/lane-b/remote-files-read.ts`); that machine's endpoint checks it strictly against the schema (`src/endpoint/authorize.ts`) and its front calls the same handler with `remote: true` in the context, which only the front's two entries for the endpoint set (`front.ts`, `dispatch` and `intercepted`). What decides the route is the machine in the session's address. (A terminal session on another machine goes through the lane A route and the machines manager, which was not traced here; the window sends it nothing new either.)
5. **The process.** The files service runs in `mawsd` only. `startCheckouts` (`src/services/checkouts-root.ts`) composes it in the spine's root (`src/services/spine-root.ts`), which only `src/mawsd/spine-seam.ts` starts; the "embedded" binding is the suites'. (The comment at the head of `checkouts-root.ts` still names main.)
6. **Where the service decides.** `precheck` (`src/services/files/service.ts`): the path must be absolute and already normal; the session must have a record (or a setup intent: `allowlistOf`, `allowlist.ts`); `rootsOf` gives the real paths of the record's directory, added directories and worktree, less the machine's home for a remote caller; the path's real path must lie under a root, or, for `read`, `openExternal` and `reveal` only (`DELIVERED_TOO`), be a file the session's delivered files name (`fileAdmission`, `admission.ts`), which then stands as a root of one for the rest of the boundary; a path that ends in a link is refused. `write`, `list` and `watch` take roots only. A path that does not resolve answers `not found` only inside a root, else the refusal (`missing`). After the check `read` opens the real path with no link on its way, and confirms the opened object again under the roots (`openConfirmed`, `confirm`).
7. **The row that opens a file outside MAWS.** For a kind MAWS does not draw, `ExternalRow.tsx` offers "Open externally" when the name is on the list (`opensExternally`). It calls `openSessionFile` (`src/renderer/src/lane-b/open-copy.ts`, U9's file): `files.openExternal { appSessionId, path }` unless the session is a session MAWS runs on another machine (then a copy is fetched here). In `mawsd`, `openExternal` runs `precheck` with `DELIVERED_TOO` and no `remote` argument, requires a regular file with no execute bit, and asks the client port, which reaches main, where `shell.openPath` runs (`src/main/client/electron-port.ts`). The endpoint does not offer `files.openExternal` or `files.reveal` to another machine (`src/endpoint/offers.ts` has no row).
8. **A terminal session.** The same on every point above. The window reads its rows from the transcript file; the link, the tab, the request and the service's decision do not differ, and its record has the same three kinds of folder.
9. **Where a transcript is.** `<config home>/projects/<slug of the folder>/<engine session id>.jsonl`, one store for a session MAWS runs, a terminal session and an ended one. The spine finds it by one rule, spelled three times in `spine-root.ts`: the path the index keeps for the session (`index.sessions.summaryOf(appId)?.transcriptPath`, which the engine host reported), else `transcriptPathOf(engineEnv, record.directory, record.engineSessionId)` (`src/services/sessions/context.ts`). Three spine-side readers already open the file by that rule: `readRecentTurns` (the last 256 KiB), `readRestoredCost` (backwards in chunks, 16 MiB at most) and `TranscriptJobs` (the whole file, by offset).
10. **What a transcript holds.** One JSON object per line. The agent's text and a tool call's input are in `assistant` rows; the person's message, a tool's result (twice: in the message and in `toolUseResult`) and what arrives from elsewhere are in `user` rows. Non-ASCII is written as itself; a quote, a backslash and control characters are escaped. Other types hold no conversation: the `api-request` records the engine writes per model request (three types whose names begin so) repeat the conversation, and with `file-history-snapshot` are two thirds of a 625 MB transcript (`src/engine-host/fs/chain-follower.ts`); `TranscriptJobs` skips them unparsed by the line's first bytes, `{"type":"api-request`; `queue-operation` records hold a message as typed, also one that was taken back before the engine read it (`test/fixtures/transcripts/w1-steer-next-cancelled.jsonl`: the text of the cancelled message is in its `enqueue` record alone). A draft that was never sent has no row. A compaction appends a boundary and a summary and leaves the earlier rows in the file. A fork's file holds its parent's conversation rows again. `/clear` gives the app session a new engine session id and a new file.
11. **A transcript that moves.** When the agent enters or leaves a worktree the engine renames the file into another project folder (the inode stays) and the index learns the new path from the engine host. U8c-1 (`origin/ux-wave/U8c`) keeps the engine host's follows and `TranscriptJobs` reading across the move; it "exposes no name to a sibling".
12. **Build F and the wire.** Master's wire is major 3, minor 36; F's is minor 33. `files.read`'s input is a strict object. A `mawsd` of another build of the major serves this build's window from the connection until `watchDaemon`'s restart lands (`src/main/hosts/daemon.ts`, `checkBuild`), and for the whole launch when the profile's unit runs another bundle; the reverse holds for F's app on this build's `mawsd`. F's front reads a command's input with the tolerant reader (`git show f1852de3a:src/mawsd/front.ts`, `codec.readCommandInput`; `src/shared/ipc/tolerant.ts`, unchanged since F): a key it does not know is dropped and the rest is served. A command it does not know answers `unknown_command`. F's endpoint, strict, answers `malformed` to an input with a key it does not know.
13. **What pins today's behaviour and changes.** `src/renderer/src/tools/code/viewer/viewer.test.tsx` ("renders a refusal in words with the path, and reads no more than once"); every renderer test that asserts a read's exact input for a session on this Mac (`viewer.test.tsx`, `editor/editor.test.tsx`, `src/renderer/src/tools/artifacts/viewers/viewers.test.tsx`, through `src/renderer/src/test-support/code-disk.ts`); `ExternalRow.test.tsx` (the call's input); `src/services/files/service.test.ts` and `register.test.ts` (`openExternal`'s arguments); `src/shared/ipc/wire.test.ts` with the two generated files. E2e specs that cross the code: `e2e/code-tools.spec.ts` and `e2e/code-editor.spec.ts` (`e2e:code`), `e2e/deliverables.spec.ts` (`e2e:deliverables`), `e2e/remote.spec.ts` (`e2e:remote`, the read over the link), `e2e/sessions.spec.ts` (the default `e2e` group), which gains the scene.

## Decisions settled at authoring

Each names the alternative it beat. The numbers are cited as "decision N". The exact shapes are in Interfaces and Dependencies.

1. **A search of the transcript by the reading process; the request carries no place.** The request says only that the caller knows the rule (decision 6); `mawsd` finds the session's transcript itself and looks for the path in it. *Beat:* a row's or a message's id in the request, checked against that one row. The id buys nothing: the transcript has no index from an id to a place in the file, so finding the row costs the same pass as finding the path, and the window would be trusted with nothing less (it could name any row that writes the path).
2. **Which rows count.** A line of the session's own transcript file whose top-level `type` is `user` or `assistant` counts, with every string in it, at any depth. That is the agent's text, a tool call's input, a tool's result, the person's message and what arrives from elsewhere. No other type counts: the engine's request records (they repeat the conversation, are most of a large transcript's bytes, and what else of a request they carry the fixtures do not show), queue records (a message as typed, delivered or not, which is how a path typed and never sent is refused), attachments, snapshots, titles and summaries, system rows. Rows written before a compaction stay in the file and count. A fork's file holds its parent's conversation rows again, and they count for the fork. *Beat:* (a) every line of the file, which would admit a path written only in a message that was taken back, and would rest the admission on records whose content is not known; (b) only the agent's text, tool inputs and the person's messages, which ties the admission to the engine's block shapes and refuses links the window draws from a result (point 2 of "Reported to the architect").
3. **What "names" means.** The path, as the request gives it, occurs in a string of a counted row, or in that string with its `%XX` escapes decoded, at a place where neither side continues a path (Interfaces §A gives the two tests and their table). The comparison is of strings, byte for byte, and case-sensitive. A line suffix (`:42`, `#L42`) after the path is a boundary. *Why the escapes:* the window decodes a link's target before it asks (`decodeURI` in `Link.tsx`), so a link written with `%20` asks for the path with a space. *Why the two sides:* without them a transcript that names `…/key.pub` would name `…/key`, and one that names `/mnt/disk/home/x` would name `/home/x`. *Beat:* comparing real paths (each path-like string of the transcript resolved on disk and compared with the request's real path): it touches the disk for every such string, and it would admit a path the transcript never wrote, through a link that leads to the same file.
4. **What is compared and what is read.** Compared: the request's path string and the transcript's strings, as decision 3 says. Read: the object at the path's real path, through the boundary `files.read` already has. So a path through a folder that is a link (`/tmp` on macOS) is read where it leads, as inside the folders today; a path whose last component is a link is refused, as inside the folders today (the transcript names the link, not its target); on a volume that ignores case, a path the transcript writes in another case than the disk's is read, and the same path in a case the transcript does not write is not named. The admitted real path stands as a root of one for the rest of the boundary, as a delivered file's does, so every later confirmation holds for that file and nothing beside it.
5. **The cost of a click.** The search reads the transcript from its end backwards and stops at the first row that names the path (a link the person clicks is usually among the newest rows); it parses only the lines whose bytes hold a piece of the path that every naming row must hold; it reads back 1 GiB at most; a path once found stays found while the transcript is the same file and has not shrunk, so the reads that follow a click cost one `stat`; a path not found is searched again only in what was written since. A read inside the folders, and a delivered file, never open the transcript. *Beat:* the index's stored text of the session (`session_text`, cheap to ask): it holds prose only, no tool input or result, lags the file, and covers unarchived sessions alone. *Beat:* asking the engine host: its follow keeps no raw rows, it may be parked or restarting, and an ended session has no follow.
6. **The request's shape: one optional key on the existing commands.** `files.read` and `files.openExternal` take `named: true`; `files.read` answers `named: true` when the file was admitted by name. The key means "this caller knows the rule: admit a file the transcript names, and tell me when you did, because I hold it read-only". *Beat:* a command of its own. A `mawsd` of build F answers `unknown_command` to a command it does not know, which the window would have to turn into today's refusal; it drops an optional key it does not know and answers the plain read, which is today's refusal with no code here. A second command would also be a second boundary to keep equal to the first. *Beat:* no key, the service deciding for every caller. Build F's window, served by this build's `mawsd` (possible on one Mac, "What the code holds today" 12), would then open such files and show them as editable.
7. **The window sends the key only for a session on this Mac.** For a session on another machine the request is today's, to the byte. A key sent there would be refused as `malformed` by an endpoint of build F, an error where today's refusal belongs; and the answer there is the refusal whatever is sent (decision 8). The two call sites are the viewer's read and the "Open externally" button; no other reader of `files.read` in the window sends it.
8. **A caller from another machine is refused where the read runs, before the transcript is opened.** `precheck` reads `remote` from the handler's context (the value the roots are already computed with) and, when it is set, never asks whether the transcript names the path. `files.openExternal`'s handler starts passing the context's `remote` too; the endpoint offers that command to nobody, and the check does not rest on that.
9. **The three routes on this Mac are one.** A session MAWS runs, a terminal session and an ended or archived session whose transcript is still on disk are told apart by nothing in this landing: the rule needs the session's record, its engine session id and the file. A session with no engine session id yet, and one in launch mode `scenario` (whose sessions are a scenario's and whose index is not read), has no transcript and so no named file. One difference is real and is in decision 12: only for a session MAWS runs can the window draw a link before the engine has written its row.
10. **Which transcript.** The file the index keeps for the session when its name is `<the record's engine session id>.jsonl`, else `<config home>/projects/<slug of the record's directory>/<that id>.jsonl`: the rule `spine-root.ts` already uses for the three readers, with the name test added so that a session `/clear` has just given a new id is not read from its old file. It is asked at every search, so a transcript the engine moved is found where the index now says; between the move and the index's news the file is at neither place and the answer is the refusal until the next ask (decision 12 has the retry).
11. **Read-only, exactly.** In the service nothing changes for `write`, `list`, `watch` and `reveal`: they take roots only (and `reveal` a delivered file), so the admitted file cannot be written, its folder cannot be listed or watched, and a neighbour is refused unless the transcript names it too. In the window the entry of a file admitted by name is never editable, so the editor is read-only, no Save appears and `save` sends nothing; the reason is the editor's title (point 4). Kept, as for a file inside the folders: Wrap, Source, the image's zoom, Load more, "Open externally", and a comment on a line (it sends the path and the line to the session and reads nothing). Not kept: the watch (it is on the folder, and its events name the neighbours); decision 12 replaces it. The tab offers no Reveal and no Copy path today and gains none.
12. **Asked for again, read again.** `revisit`: when the entry's last read failed, or the entry is named, and no load of it is in flight, the file is read again: at once when its tab is mounted, else when it is next mounted. It runs when the tab is mounted again and when `openFile` opens a file whose tab is already open. *Why:* a refused read must not stay refused after its cause is gone (the row not yet written, the daemon restarting onto this build, the transcript mid-move), and a named file has no watch. *Beat:* the service waiting for the row when a turn is running: latency on every honest refusal, and a second source of truth about the session. *Beat:* a watch on the one file: a new kind of watch in the service for a file read on a click (law 4).
13. **A named path that is gone answers `not found`** (point 6); a directory the transcript names answers `not a regular file: <path>`, as a directory inside the folders does. A path that is not named answers the refusal whatever is or is not on disk, as today.
14. **Errors of the search are a refusal, and say nothing.** No transcript, an unreadable one, a line that does not parse, a locator that throws: the path is not named, the answer is the service's refusal sentence, and no message carries the transcript's path.
15. **What is withheld outside is what is withheld inside.** By shape: a path that ends in a link, a directory, a special file; for "Open externally", a file with an execute bit or a name off `opensExternally`'s list. Nothing by name, as inside the folders, where the service has no such rule (point 7).

## Acceptance

Observable behaviour; the proof of each is named in the milestone that carries it.

- **A1 · The click.** On this Mac, in a session whose transcript holds a link to a text file outside the session's folders, a click on the link opens a file tab that shows the file's text. Typing in it changes nothing, no Save appears, and the editor's title reads "Read-only: the file is outside the folders this session works in". A Markdown file is drawn rendered, an image inline, as inside the folders.
- **A2 · A kind MAWS does not draw.** A link to a PDF outside the folders shows "PDF files open outside MAWS" with its size and "Open externally"; the button hands that file to the system.
- **A3 · What stays refused.** Each answers "path outside the session's directories" and reads nothing: a path the transcript does not write; a path only another session's transcript writes; a path written only in a message that was typed and never delivered; a path whose last component is a link; a request without the key; a request from another machine, for which the transcript is not opened at all. A directory the transcript names answers "not a regular file".
- **A4 · Nothing beside the file.** With the file open, a listing or a watch of its folder, a read of a neighbour the transcript does not name, a reveal and a write of the file itself are refused, and the file's bytes are as they were.
- **A5 · The routes.** The same holds for a session MAWS runs, a terminal session and an ended or archived session. A session on another machine shows what it shows today, and its request is today's.
- **A6 · Another build.** This build's window served by a `mawsd` that does not know the key shows today's refusal, not an error. A window that does not send the key (build F's) is answered as today by this build's `mawsd`.
- **A7 · Asked again.** A link clicked before its row is written shows the refusal; once the row is written, clicking the link again, or showing the tab again, opens the file.
- **A8 · The cost.** After a path is found, the reads that follow open no transcript bytes; a path found in the newest rows is found without reading the older ones; after a miss, only what was written since is read.
- **A9 · Nothing gated got worse.** Typecheck, lint and the unit suite pass; the e2e groups that cross the code pass on a Mac.

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push; no `pnpm install`, typecheck, eslint, vitest, build or Electron. Every check runs on the wave's build VM in a checkout of the pushed head, through `vmcheck.sh` (Concrete Steps). An executor starts no Electron e2e, runs no `scripts/ci-gate.sh` and opens no pull request. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.
2. **The owner's words bind** (Decision Log 1 and 2): which files (the ones that session's transcript names), where the check runs (the process that reads, never the window), read-only, this Mac only, and how a PDF shows (the row, as inside the folders). P5 Decision Log 237 binds: a caller on another machine reaches nothing outside a session's roots.
3. **The boundary is not reopened.** Every guarantee `files.read` gives today holds for the admitted file by the same code: the open with no link on its way, the descriptor confirmed under the roots, the type judged after. The admission adds a root of one and nothing else. A change that needs another route to the bytes stops and reports.
4. **Stored and sent** (root UC-14). Nothing is stored: no layout key, no field of a stored tab, no settings key. What is sent is in Interfaces §D, with what build F does in both directions. The cross-build coverage table (U13a's M5) gains no row, because no stored value is added or relied on.
5. **Files other children own** (root UC-8). Interfaces §G lists every file and its owner. No file under `src/renderer/src/transcript/` is edited: the click's handler (`view/markdown/Link.tsx`) stays as it is, so nothing here meets U3a's or U2a's edits. No file under `src/renderer/src/lane-b/`, `src/main/lane-b/` or `src/endpoint/` (U9's and the P5 work's) is edited. An executor that finds one must change stops and reports.
6. **The repository is public** (root UC-11). Tests, fixtures and the e2e scene use invented paths under a temporary folder and invented text. The owner's screenshot showed a file's path; neither it nor the file's name is written anywhere. No fault is reproduced by reading a session or a document of the owner's.
7. **The wave's laws.** Law 3: no setting and no new element. Law 4: one mechanism, the search; no index, no second watch. Law 5: decision 9 states the routes; "not on another machine" has its reason in constraint 2. Law 6: the row shapes the rule rests on (`type`, and that a string in a row is the text as written) are read from the repository's fixtures, and the rule depends on no block shape.
8. **The base.** The branch takes master by merge, never by rebase or force-push. The landing is built on a master that holds U13a (the one strip; the board's order): a file tab is a tab of that strip, and the scene asserts one.
9. **Guards that read source text.** In renderer source and its tests a ticket number is written in words; the tokens guard (`test/support/tokens-guard.test.ts`) reads `#` and three to eight hex digits as a colour. A line suffix is written `#L42` there, which it does not match. Run that guard with M3's tests.
10. **The level of proof.** A refusal is asserted with what was not done: the transcript not opened (the reader's spy), the file not written (its bytes read back), nothing listed. An admission is asserted on real files in a temporary tree, through the service, not on the rule's function alone.

## The sequences that must hold

The acts that await something, what the person or the disk can do meanwhile, and the test that holds each open. The service's suite holds its points open with `BoundaryHooks` (it gains the point `before-named`); the search with its own hook; the window's suites with a client whose answers the test releases.

| # | sequence | what must hold | held open by |
|---|---|---|---|
| S1 | the search has answered "named"; before the open, the path's last component becomes a link | the refusal; nothing read | M2, `before-open` |
| S2 | the same, with a folder on the path swapped for a link to another place | the refusal at the confirmation (the root is the first real path alone) | M2, `before-open` |
| S3 | the search is in flight; the file at the path is replaced | what the path names at the open is read, or the refusal; never a file the path did not name at the open | M2, `before-named` |
| S4 | the transcript grows while it is searched | the ask answers for the file as it was when the search began; the next ask reads what was added | M1, the search's hook |
| S5 | the transcript is renamed into another folder between two asks | the found path stays found (the same file); a new search reads the file where the locator now says | M1 |
| S6 | the transcript is at neither place for a moment (mid-move), or has no file | not named: the refusal, no error | M1, M2 |
| S7 | two asks for one session and path at once (a read's chunks) | one search, both answered by it | M1 |
| S8 | a search that fails in the middle (a read error) | not named; the next ask searches again | M1 |
| W1 | the tab is closed while its read is in flight | the answer lands nowhere (the store's rule today) | M3 |
| W2 | the same path is opened from another session while the first session's read is in flight | the entry is the new session's; the first answer lands nowhere; a refusal under the new session shows none of the file | M3 |
| W3 | the read is refused because the row is not written; the row is written; the link is clicked again, or the tab shown again | the file is read again and opens | M3 |
| W4 | a named file is open; its tab is shown again after the file changed | the new content, with the "Updated" notice, as a watched file's | M3 |
| W5 | a named file is open; a later read answers the refusal (the transcript gone) | the refusal, and none of the earlier content | M3 |
| W6 | the session ends, or is archived, while the tab is open | nothing changes: the record and the transcript stay | (no code; decision 9) |

## Plan of Work

Three milestones, each built from this document, the section and the code, each green alone. M2 consumes M1's two exports; M3 consumes M2's key. Interfaces and Dependencies holds every shape named here.

### M1 — The rule and the search

**What exists at its end.** A module, `src/services/files/named.ts`, that answers whether a session's transcript names a path: the rule on one string, the rule on one row, and the search over the file with its bound and its memory. Nothing in the product calls it yet.

**What it touches.** `src/services/files/named.ts` and `named.test.ts`, both new. This document's Progress, Surprises & Discoveries and Decision Log.

**Interfaces.** Exposes §A (`namesPath`, `rowNames`, `percentDecoded`, `safeRun`) and §B (`createNamedPaths`, the constants). Consumes `StoreFixture` (`test/support/store-fixture.ts`) in the suite.

**Decisions.**

1. *The pattern to follow* is `readRestoredCost` (`src/services/sessions/restored-cost.ts`): a read-only handle per ask, the file read backwards in chunks, the head of a split line carried to the next read, an injectable `open` and bounds for the suite. No descriptor is held between asks. A located file that is not a regular file is not read.
2. *A line is parsed only when it can name the path.* A line whose bytes do not hold `safeRun(path)` is passed over; a line that begins `{"type":"api-request` is passed over whatever it holds (the engine's request records, skipped as `TranscriptJobs` skips them); a line longer than `NAMED_ROW_BYTES` is passed over and its bytes are not kept; a last line with no end is passed over and is not counted as searched. Every other candidate is parsed, and `rowNames` decides. The suite pins that the search and the rule agree: over generated rows, the search's answer is `rows.some(rowNames)` within the bound.
3. *What is remembered.* Per session and path, with the file's identity (device and inode): found, or not found up to an offset that is the end of a whole line. Found holds while the file has that identity and is no shorter than when it was found. Not found is searched again from that offset only. A file of another identity, or shorter, forgets both. At most `NAMED_CACHE_ENTRIES` entries, the least recently asked dropped first. One search per session and path at a time; a second ask waits for the first.
4. *Failures* are decision 14: every one answers `false`, none throws, none is remembered as found or as searched. A search is not cut short by time: `files.read` has the default ten seconds of a host request (`REQUEST_TIMEOUT_MS`; it has no row in `src/services/command-budgets.ts` and gains none), so a search that outlasts them is answered `timeout` by main while `mawsd` finishes it and remembers its answer, and the next ask is answered from memory. That takes a path with almost no plain ASCII in it (every row is then a candidate) in a transcript near the bound; the suite does not measure it.
5. *The rule's function is pure and has no notion of a row's block shapes.* `rowNames` reads `type` and walks strings; it does not know `message`, `content`, `tool_use` or `toolUseResult`.
6. *Tests fail first.* The table of Interfaces §A is written as the suite's first commit, with the module's exports as stubs that answer `false`, so that every "names" case is red and every "does not name" case is green before the rule exists; the same for the search's cases.

**What it does not touch.** The service, the schema, the wiring, the window. The engine host and the index.

**What it proves.** A8 whole; the rule's half of A1 and A3 (a path the transcript does not write; a path in a queue record alone; a path in a request record alone); S4 to S8. Behaviours its tests pin beyond those: a hit before a compaction boundary; a name with a quote, a backslash, a space, non-ASCII letters; a link written with `%20`; a transcript whose naming row is older than the bound is not named; a transcript of rows with the path inside a longer path, a longer name, a relative path and a `file://` URL is not named.

### M2 — The admission: the request's key, the service, the daemon's wiring, the wire

**What exists at its end.** `mawsd` answers `files.read` and `files.openExternal` for a file outside a session's roots when the request carries `named: true`, comes from this machine, and the session's transcript names the path; `files.read`'s answer then carries `named: true`. Every other request is answered as before. The window does not send the key yet, so nothing changes on screen.

**What it touches.** `src/shared/ipc/schema/files.ts`; `src/services/files/service.ts`, `register.ts` and their suites; `src/services/checkouts-root.ts`; `src/services/spine-root.ts` and its suite (the locator); `src/shared/ipc/wire.ts`, `wire-manifest.json`, `wire-fingerprint.json` (the minor, at the merge); the header comments of `service.ts`, `allowlist.ts` and `checkouts-root.ts`, which state the old rule or the old process. This document's record.

**Interfaces.** Exposes §C and §D. Consumes §A and §B.

**Decisions.**

1. *One place decides.* `precheck` gains the admission after the roots and after the delivered files, in the order of Interfaces §C. `read` and `openExternal` ask for it (`named` in the request); `reveal`, `write`, `list` and `watch` cannot.
2. *The remote test comes first and is on the context.* Decision 8. The suite asserts the reader's spy untouched for a remote request that carries the key.
3. *The locator is `spine-root.ts`'s rule*, passed into `startCheckouts` as a dependency (decision 10). The three places that spell the rule today may take the same function when the edit stays a substitution; they are not required to.
4. *`files.readResolved` keeps its input.* Its schema is derived from `files.read`'s; the new key is left out of it, as the session is.
5. *The wire's minor* is one past master's manifest at the last merge before the gate, and the two generated files are made again then (`pnpm wire:manifest`); other landings raise it too, and a merge conflict there is resolved by taking master's number plus one.
6. *The endpoint's tables.* Suites that classify the input keys of an offered command (`test/endpoint/checkout-rows.test.ts`, `test/lane-b/offer-coverage.test.ts`) may need the new key in an expectation. An edit in a file under `src/endpoint/` is not expected; one that proves needed is reported before it is made (constraint 5).
7. *Tests fail first:* the suite "files admission of named files" in `service.test.ts`, beside the delivered files' suite and in its shape, with a fake reader for the boundary's cases and the real `createNamedPaths` over a temporary store for the cases that claim the transcript decides.

**What it does not touch.** The window. `allowlist.ts`'s code (U8c-2's edit of `rootsOf` meets nothing here: the admission reads `rootsOf`'s answer as it is). `admission.ts`. `upload.ts`, `watch.ts`. The endpoint.

**What it proves.** A2's service half (the open log's line under `MAWS_E2E`), A3, A4, A6, and the service half of A1 and A5; S1 to S3 and S6. Behaviours its tests pin beyond those: a read inside the roots with the key answers no `named` and opens no transcript; a delivered file with the key is answered as today; every chunk and the hashed read of a named file carry `named`; a named file reached through a folder that is a link is read; on macOS, a path the transcript writes in another case than the disk's is read (a guarded case: `service.test.ts` is already among the macOS unit files); a named path that is gone answers `not found`, an unnamed one the refusal; a reader that does not know the key reads the request as the plain one (`readTolerant` over the input's schema without the key); the locator's four answers (the index's path, the computed path, none while the index is not read, none without an engine session id) and its name test.

### M3 — The window, the e2e scene, the record, and the acceptance run

**What exists at its end.** A1 to A7 on screen: the click opens the file, read-only, with its reason; the PDF's row opens it outside; a session on another machine is untouched; a refused or named file is read again when asked for again. The e2e scene is written and compiles. The charter and the C8 document carry their dated lines. The whole unit suite has run.

**What it touches.** `src/renderer/src/tools/code/viewer/viewer-store.ts`, `ExternalRow.tsx`, `src/renderer/src/tools/code/open-file.ts`, `src/renderer/src/tools/code/copy.ts`, with `viewer.test.tsx`, `ExternalRow.test.tsx` and the suites "What the code holds today" 13 names; `e2e/sessions.spec.ts` (one scene); `docs/charter.md` and `docs/doperpowers/plans/2026-09-28-c8-right-panel.md` (one dated line each, "The pull request"); this document's record.

**Interfaces.** Exposes §E. Consumes §D; from U13a, §F.

**Decisions.**

1. *Where the key is added:* in the viewer store's `readChunk` and in `OpenExternally`, each only when the session's machine is this one (`machineFor(appSessionId) === ipc.localMachine`, `src/renderer/src/ipc/machine.ts`). `OpenExternally` sends `files.openExternal` itself in that case and calls `openSessionFile` otherwise, so `lane-b/open-copy.ts` is not edited.
2. *`named` is the entry's, set by each load.* It comes from the read's answer, never from the tab or the path. An entry that is named is not editable; `readOnlyReason` answers `'outside'` for it, ahead of the file's own reasons.
3. *`revisit`* is decision 12. The mount of an entry that exists calls it; `openFile` calls it with `tabId` of the target it opened. A read again of a ready entry is a `change` load (the shown content stays until the new one is whole); of a failed entry, an `open` load. A `change` load of a kind read without a hash (an image, an external kind) that finds the same bytes lands nothing, so that showing a tab again does not flash "Updated" over a file that did not change.
4. *The scene* (Interfaces §E gives its steps) is in `e2e/sessions.spec.ts`, the spec whose cases already seed a transcript in a scratch store (`StoreFixture.addTranscript`) and open the discovered session: the group that holds real transcript files and needs no engine. `e2e/code-tools.spec.ts` runs in launch mode `scenario`, where no session has a transcript.
5. *Tests fail first:* W1 to W5 and the two call sites' inputs, red before the store changes.

**What it does not touch.** `FileViewer.tsx`'s structure and `CodeView.tsx` (the title reaches the editor through `readOnlyReason` and `EDITOR_COPY.readOnly`, which they already read). The Files store and its watch. The transcript's files. The layout store.

**What it proves.** A1, A2 and A7 in the window's suites and, on a Mac, by the scene; A5's "another machine" half; A9 by Concrete Steps. Not proved by an executor: the scene's run, the e2e groups, a live turn ("Proof that an executor does not run").

## Concrete Steps

Working directory for every command: the branch's worktree (the controller's brief names it). The VM sees only what is pushed.

1. **Before each milestone:**

       git fetch origin master && git merge origin/master
       git push origin ux-wave/U6c

   A merge, never a rebase or a force-push. Before M1, `git log --oneline origin/master -- src/renderer/src/main/tab-place.ts | head -1` must print a commit (the file is U13a's): if it prints nothing, U13a is not on master; stop and tell the architect.

2. **M1, the tests before the module.** Commit `named.test.ts` with the table of Interfaces §A and the search's cases, and `named.ts` with its exports answering `false`; push; run:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6c -- 'pnpm exec vitest run src/services/files/named.test.ts'

   Each call prints `vmcheck: ux-wave/U6c at <short sha>` and then the command's own output, and exits with the command's status; the first call for the branch installs dependencies and takes a few minutes. Expected at this commit: every "names" case and every search case that expects a hit fails, every "does not name" case passes. After the module is written, the same command passes whole.

3. **While building**, after each push (M1 and M2 change the node project, M3 the web project and the e2e project):

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6c -- 'pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6c -- 'pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6c -- 'pnpm exec eslint <the paths changed>'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6c -- 'pnpm exec vitest run <the test files touched>'

4. **M2's proof.** The suites of the folders touched and of those that import the schema and the service:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6c -- 'pnpm exec vitest run src/services/files src/services/spine-root.test.ts src/services/library src/shared/ipc src/mawsd src/main/ipc src/main/lane-b test/endpoint test/lane-b'

   Expected: every file passes but the ones the build brief lists as failing on master on the VM too. `service.test.ts`'s cases guarded for macOS are skipped there; they run in the Mac lane ("Proof that an executor does not run", 3).

5. **The wire's minor** (M2, and again after any later merge of master that moved it). Set `WIRE_MINOR` in `src/shared/ipc/wire.ts` one above master's, with its comment; commit; push; then make the two generated files on the VM and bring them back as a patch:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6c -- 'pnpm wire:manifest > /tmp/wire.log 2>&1 || { cat /tmp/wire.log; exit 1; }; git diff -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json; git checkout -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json' | sed 1d > "$TMPDIR/u6c-wire.patch"
       git apply "$TMPDIR/u6c-wire.patch"

   Commit the two files, push, and run `pnpm exec vitest run src/shared/ipc/wire.test.ts src/shared/ipc/wire-fingerprint.test.ts` on the VM: both pass. Before the bump is made, `wire.test.ts` fails with its own verdict, "bump WIRE_MINOR to <n> and …": that failure is the expected red.

6. **M3's proof.** The window's suites, the guard, and the e2e project's typecheck (the only check an executor has on the scene):

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6c -- 'pnpm exec vitest run src/renderer/src/tools/code src/renderer/src/tools/artifacts/viewers src/renderer/src/tools/maws src/renderer/src/transcript/view test/support/tokens-guard.test.ts'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6c -- 'pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'

7. **The acceptance run** (M3's last step), on the pushed head, after a last merge of master and step 5 if the minor moved:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6c -- 'pnpm typecheck'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6c -- 'pnpm lint'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6c -- 'pnpm test'

   Expected: each exits 0, apart from the files the build brief lists as failing on master on the VM too; vitest's summary names no other failed file. No fixture file is added (the suites build their rows in the test); if one is, also run `node --test .github/scripts/maws-app-scan.test.mjs` there. Acceptance against these runs: A3, A4, A6 and A8 are M1's and M2's suites; A1, A2, A5's "another machine" half and A7 are M3's suites; A9 is the three commands. The scene, the e2e groups and the live turn are the architect's.

8. **Stop and hand back.** The executor of M3 writes into Progress what ran and what is left, pushes, and stops. Class 1a (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6c`), the branch review, the e2e runs and the pull request are the architect's.

## Interfaces and Dependencies

### §A. The rule (M1; `src/services/files/named.ts`)

    export function safeRun(path: string): string;
    export function percentDecoded(text: string): string;
    export function namesPath(text: string, path: string): boolean;
    export function rowNames(row: unknown, path: string): boolean;

- **`safeRun(path)`**: the longest run of `path`'s characters from `[A-Za-z0-9._/-]`, the first on a tie. An absolute path has at least its `/`.
- **`percentDecoded(text)`**: `text` with each maximal run of `%XX` escapes replaced by what it decodes to as UTF-8. A run that is not valid UTF-8 stays as written, and so does a run whose decoded text holds a character of `safeRun`'s class. (That exception is what lets the search pass over a line by its bytes: a character of the class is never produced by decoding, so a string that names the path holds `safeRun(path)` as written.)
- **`namesPath(text, path)`**: true when `path` occurs in `text`, or in `percentDecoded(text)` when `text` holds a `%`, at an index where both tests pass. Let *b* be the character (code point) before the occurrence and *c* the one after, and a *name character* a letter, a mark or a digit (`\p{L}`, `\p{M}`, `\p{N}`), `_` or `-`.
  - *Before:* there is no *b*, or *b* is neither a name character nor one of `.` `~` `/` `%` `$` `}`.
  - *After:* there is no *c*; or *c* is neither a name character nor one of `/` `%` `~` `$` `{` `(` `[` `+` `@` `=` `&`, and, when *c* is `.`, what follows the `.` is nothing or a character that is neither a name character nor `/` (a full stop ends a sentence; `.bak` continues a name).
  - `:` and `#` are not in the second list, which is how `path:42` and `path#L42` name `path`.
- **`rowNames(row, path)`**: true when `row` is an object whose own `type` is the string `user` or `assistant` and some string value in it, at any depth of its objects and arrays, satisfies `namesPath`. Keys are not strings in this sense. A string that does not hold `safeRun(path)` need not be tested.

The table the suite holds, with the invented path `/work/out/report.md` (and `/work/out/my notes.md`, `/work/out/보고서.md` where said):

| the string | names it |
|---|---|
| `see /work/out/report.md` · `[r](/work/out/report.md)` · `` `/work/out/report.md` `` · `</work/out/report.md>` · `\"/work/out/report.md\"` (quotes escaped inside the string) · the whole string `/work/out/report.md` | yes |
| `[r](/work/out/report.md:12)` · `/work/out/report.md#L12` · `/work/out/report.md: done` · `saved /work/out/report.md.` · `saved /work/out/report.md...` · `/work/out/report.md, then` · `/work/out/report.md's head` | yes |
| `@/work/out/report.md` · `OUT=/work/out/report.md` · `host:/work/out/report.md` · `**/work/out/report.md**` | yes |
| `[n](/work/out/my%20notes.md)` and `"/work/out/my notes.md"`, for the path with the space; `/work/out/보고서.md` and `/work/out/%EB%B3%B4%EA%B3%A0%EC%84%9C.md`, for the path with those letters | yes |
| `/work/out/report.md.bak` · `/work/out/report.mdx` · `/work/out/report.md-old` · `/work/out/report.md_1` · `/work/out/report.md(1)` · `/work/out/report.md/x` · `/work/out/report.md~` | no |
| `/mnt/work/out/report.md` · `~/work/out/report.md` · `./work/out/report.md` · `$ROOT/work/out/report.md` · `${ROOT}/work/out/report.md` · `x/work/out/report.md` · `file:///work/out/report.md` | no |
| `/WORK/out/report.md` · `/work/out/report` (the string is shorter than the path) · `/work/out/%72eport.md` (a letter written as an escape) | no |
| for the path `/work/out/report`: `/work/out/report.md` · `/work/out/reports` | no |
| for the path `/work/out/my`: `/work/out/my notes.md` | yes: the recorded limit below |

Rows, with the path in the place named: a `user` row's `message.content` as a string, and as a text block; an `assistant` row's text block, its `tool_use` block's `input` at depth, its thinking block; a `user` row's `tool_result` block (a string, and blocks) and its top-level `toolUseResult`: each names. A `queue-operation` record's `content`; a line of type `api-request`, `attachment`, `file-history-snapshot`, `summary`, `ai-title`, `last-prompt`, `system`; a row with no `type`; a value that is not an object: none names.

**Recorded limits of the rule.** It reads strings, not meaning. (1) A name that ends where a longer name has a space is named by the longer one (`/work/out/my` by `/work/out/my notes.md`). (2) A path written for another machine (in the output of a remote shell) names the same path here. (3) A link whose target escapes a letter, a digit or one of `.` `_` `-` `/` as `%XX`, or uses Markdown's backslash escapes or character references inside the path, is not recognised and keeps the refusal. (4) `file://` before a path does not name it (point 12). (5) The window asks for a path with its `.`, `..` and doubled separators collapsed (`normalizeLexically`); a transcript that writes the path uncollapsed does not name the collapsed one. (6) Text that is escaped a second time inside a string (JSON quoted inside JSON) can put an escape's letter beside the path (`\n` before it), and the path is then not recognised there. Limits (3) to (6) fail towards the refusal. Limits (1) and (2) admit a file the transcript did not mean; they are what a reviewer of the rule should weigh.

One more test pins a fact the search rests on, read from the repository's fixtures (law 6): no line of `test/fixtures/transcripts/*.jsonl` writes `/` as `\/`, and the lines that hold non-ASCII hold it as itself.

### §B. The search (M1; `src/services/files/named.ts`)

    export const NAMED_SCAN_BYTES = 1024 ** 3;         // read back from the transcript's end, at most
    export const NAMED_CHUNK_BYTES = 4 * 1024 * 1024;   // one read
    export const NAMED_ROW_BYTES = 16 * 1024 * 1024;    // a longer line is passed over, its bytes not kept
    export const NAMED_CACHE_ENTRIES = 256;

    export interface NamedPathsOptions {
      transcript: (appSessionId: AppSessionId) => Promise<string | null>; // decision 10; null: the session has no transcript
      open?: OpenFile;                                                     // tests (`@shared/fs/read-tail`'s type, as `readRestoredCost` takes)
      bounds?: { scan?: number; chunk?: number; row?: number; entries?: number }; // tests
      hooks?: { at?(point: 'opened' | 'searched', appSessionId: AppSessionId): Promise<void> }; // tests: after the file is opened and its size read; after a search, before its answer is remembered
    }
    export interface NamedPaths {
      names(appSessionId: AppSessionId, path: string): Promise<boolean>;
    }
    export function createNamedPaths(options: NamedPathsOptions): NamedPaths;

`names` answers whether some line of the transcript, among the newest `NAMED_SCAN_BYTES`, satisfies `rowNames` for `path`, under M1's decisions 2 to 4. What it reads: only the session's own transcript file. What it never does: follow the transcript's folder, read an agent's file, write, throw, or put a path in a message. Memory at any moment: one chunk and one line no longer than `NAMED_ROW_BYTES`.

### §C. The admission (M2; `src/services/files/service.ts`, `register.ts`)

    export interface FilesServiceOptions {
      // … as today, and:
      // Whether the session's transcript names this path, as the request gave it (`createNamedPaths(...).names`). Asked
      // by `read` and `openExternal` alone, for a request that carries `named`, from this machine, for a path outside the
      // roots that no delivered file admits. Absent: nothing is admitted by name.
      named?: (appSessionId: AppSessionId, path: string) => Promise<boolean>;
    }
    export type BoundaryPoint = /* … as today */ | 'before-named';           // tests: awaited before `named` is asked

    interface FilesService {
      read(input: FilesReadInput, remote?: boolean): Promise<FilesReadOutput>; // `input.named`
      openExternal(appSessionId: AppSessionId, path: string, client: ClientRef | null, asked?: { named?: boolean; remote?: boolean }): Promise<FilesOpenExternalOutput>;
      // list, write, watch, unwatch, reveal, readResolved, release, watching, dispose: unchanged
    }

`precheck`, in order; a step not marked new is today's.

1. The path is absolute; the session has a record; the path is normal. As today.
2. The roots, less the home for a remote caller. As today.
3. **New.** *May a name admit?* Only when the operation is `read` or `openExternal`, the request carried `named`, a reader was given, and the request is not remote. This is settled here, from the request's own context, and nothing of the transcript has been touched.
4. The path's real path. When it does not resolve: the answer `missing` gives, as today (inside a root `not found`, else the refusal). **New:** when that answer is the refusal, the failure is one `missing` reads as absence (`ENOENT`, `ENOTDIR`), step 3 said yes and `named(appSessionId, path)` is true, the answer is `not found: <path>` instead.
5. The real path is under a root: go on, as today. Else a delivered file admits it: as today. Else, **new**, step 3 said yes and `named(appSessionId, path)` is true: the real path joins the roots as a root of one, and the result records that the name admitted it. Else the refusal.
6. A path whose last component is a link is refused. As today, and for a named path too.

`named` is asked with the path as the request gave it, never with the real path. It is asked at most once per `precheck`. The rest of the boundary (`openConfirmed`, `confirm`, the type's judgement) is unchanged and runs with the roots step 5 left. `read` puts `named: true` in every answer of a file the name admitted, and the key is absent otherwise. `openExternal` keeps its own tests (a regular file, no execute bit, a name on `opensExternally`'s list) for it.

`register.ts`: `files.read` passes the input as it does; `files.openExternal` passes `{ named, remote }`, with `remote` read from the handler's context by the function the other handlers use. `checkouts-root.ts`: `CheckoutsDeps` gains `transcript: (appSessionId: AppSessionId) => Promise<string | null>`, and `startCheckouts` builds one `createNamedPaths({ transcript })` and gives its `names` to the service as `named`. `spine-root.ts` passes the locator of decision 10: null while the index is not read (launch mode `scenario`), for a session with no record there or no engine session id; else the index's path when its file name is `<engine session id>.jsonl`, else the computed one.

### §D. What is sent, and what build F does with it (M2)

In `src/shared/ipc/schema/files.ts`:

    FilesReadInputSchema         gains  named: z.literal(true).optional()
    FilesReadOutputSchema        gains  named: z.literal(true).optional()
    FilesOpenExternalInputSchema =      SessionPathSchema.extend({ named: z.literal(true).optional() })   // `files.openExternal`'s input; `SessionPathSchema` itself is unchanged
    FilesReadResolvedInputSchema        leaves `named` out, as it leaves `appSessionId` out

All three are optional properties of object schemas: additive within the wire's major, one minor (`src/shared/ipc/wire.ts`'s rule). Nothing is stored.

| | the key in a request | the key in an answer |
|---|---|---|
| this build's window, served by F's `mawsd` on this Mac (until `watchDaemon`'s restart lands; a whole launch when the profile's unit runs another bundle) | F's front drops it (the tolerant reader) and serves the plain command: a file outside the folders answers today's refusal, and the window shows it as today. Once this build's `mawsd` serves, `revisit` reads again | never present |
| F's window, served by this build's `mawsd` on this Mac | never sent, so nothing is admitted by name: answered as today | never present: only a read that asked is answered with it |
| this build's window, a session on another machine of any build | never sent (decision 7); the request is today's to the byte | never present |
| a window on another machine, of this build or a later one, reading a session of this Mac | the endpoint's schema takes the key; the service sets it aside for `remote` at step 3: today's refusal, the transcript not opened | never present |

A run of this build, then F, then this build: a file tab of a named file is a `file` tab with today's fields. F restores it and shows its own refusal for it; this build restores it and reads it by the rule again. Nothing is lost and nothing stored is rewritten by either.

The proof an executor has: the suite's case that a reader without the key reads the request as the plain one (`readTolerant` over `FilesReadInputSchema` less `named`: the value read has no `named`, and one key is reported dropped); the service's case that a request without the key is refused though the transcript names the path; the window's case that a session on another machine's request has no `named`. F's own code was read, not run ("What the code holds today" 12).

### §E. The window (M3)

In `viewer/viewer-store.ts`:

    interface ViewerEntry { /* … as today, and: */ named: boolean }   // the last load's answer carried `named`: the file is outside the session's folders, admitted by the transcript
    interface ViewerStore { /* … as today, and: */ revisit(tabId: string, appSessionId?: AppSessionId | null): void } // decision 12
    readOnlyReason(entry): 'outside' | 'head' | 'encoding' | 'loading' | null       // 'outside' when `entry.named`, ahead of the others

- `readChunk` adds `named: true` to a `files.read` whose session is on this Mac, and to no other call. `editable` is false whenever `named` is true. `save` answers `'noop'` for a named entry and sends nothing.
- `revisit(tabId, appSessionId?)`: no entry, a load in flight, or a session given that is not the entry's (the mount that follows replaces such an entry): nothing. The entry's `status` is `error`, or the entry is `named`, and it has no unsaved edits: read again, now when the tab is mounted, else at its next mount (the store's `stale` set). The mount of an existing entry applies the same rule. `openFile` (`open-file.ts`) calls `useViewer.getState().revisit(tabId(target), appSessionId)` after `openTab`.
- `ExternalRow.tsx`, `OpenExternally`: for a session on this Mac, `ipc.invoke('files.openExternal', { appSessionId, path, named: true })`; for any other, `openSessionFile` as today.
- Copy, in `tools/code/copy.ts`: `EDITOR_COPY.readOnly.outside = 'Read-only: the file is outside the folders this session works in'` (point 4). No other string changes.

The scene, in `e2e/sessions.spec.ts`: "a file the transcript names opens read-only from outside the session's folder, and nothing else does". Seeded in the case's scratch: a repository (the session's folder); beside it, outside, a folder with `notes.txt`, `report.pdf` (a few bytes with a PDF's head), `unnamed.txt` and `typed-only.txt`, all with invented text; a transcript for session S whose `assistant` row's text links `notes.txt` and `report.pdf` by absolute path and which also holds a `queue-operation` record whose `content` writes `typed-only.txt`'s path; a transcript for session T that writes none of them. The launch sets `MAWS_E2E_OPEN_LOG`. (A text file and not a Markdown one: a rendered Markdown file has no editor inside the folders either, so it would show nothing of read-only.) Steps: open S; click the chip of `notes.txt`; the viewer of that path shows the file's text, with `data-editable="false"`; type into it: the text and `data-dirty="false"` stand, no `[data-editor-controls]`, and the content's title is the string above; click the chip of `report.pdf`: the row reads "PDF files open outside MAWS", and "Open externally" appends the file's real path to the open log. Then, through `window.maws.invoke`, each answering `{ ok: false, error: { code: 'internal', message: "path outside the session's directories" } }`: `files.read` of `unnamed.txt` under S with `named: true`; of `typed-only.txt` under S with `named: true`; of `notes.txt` under T with `named: true`; of `notes.txt` under S without the key; `files.list` of the outside folder under S; `files.write` of `notes.txt` under S, after which the file's bytes are read back unchanged.

### §F. What this landing consumes, and what a sibling may rely on

**Consumed.**

- **U13a** (on master before M3). The file tab as its strip holds it: `openTab(ref, opts?)` with its name and meaning; its §F's statement "A `file` tab is one per machine and path; opening it again takes the new line and the session that opened it", which is why W2 exists; `tabId` in `src/shared/ipc/schema/layout.ts`, which U13a does not change. The scene uses the strip's helpers in `e2e/support/shell.ts` as U13a leaves them. Nothing else, and no layout key.
- **U3a, U2a.** Nothing. The file that holds the link's click is `src/renderer/src/transcript/view/markdown/Link.tsx`. U3a's branch changes no file under `view/markdown/` and U2a's document names none; this landing does not edit it either, so there is no order to keep between them.
- **U8c-1.** Nothing by name (its M1 "exposes no name to a sibling"). The locator is asked at every search, which is the rule its job reader takes too.
- **U8c-2.** `rootsOf`'s answer, as it is. U8c-2 adds folders to the roots under its own checks (`admittedFolder`); this landing adds one file after the roots. The two sit so that neither weakens the other: a path under a root, U8c-2's included, never reaches the transcript; the name admits a file and never a folder, and never serves `list`, `watch` or `write`; a remote caller never reaches the name, so U8c-2's home rule for one is untouched. A folder the agent moved into that U8c-2 does not admit stays unlisted, and a file there opens by this landing's rule alone, read-only. Whichever lands second merges master first; the edits are in different functions.
- **U9.** Nothing. U9 owns what a session on another machine shows (`refusalWords` and `disabledWords` in `src/shared/ipc/remote-unavailable.ts`; `refusalError` in `src/main/machines/remote/dispatch.ts`). This landing sends nothing new there and changes no word there.
- **U6a, U8a, U8b.** Nothing. UC-4's selector is not read: where a transcript is filed is about the record, which UC-4 leaves on the record.

**For U6b, by name.** The key `named` on `files.read` and `files.openExternal`, and on the read's answer; `namesPath`, whose start test U6b extends for `file://`; `ViewerEntry.named` and `readOnlyReason`'s `'outside'`; `revisit`; the service's refusal sentence, `FILES_REFUSAL`, unchanged, which its notice table recognises; and the rule that its frame route asks the files service with the same key.

### §G. Files other children own, or several landings edit (UC-8)

| files | owner by UC-8 | this landing |
|---|---|---|
| `src/services/files/named.ts` (new), `service.ts`, `register.ts`, their suites; `src/services/checkouts-root.ts`, `spine-root.ts` | no row (U8c-2 inserts in `allowlist.ts` and reads `service.ts`) | the admission and its wiring |
| `src/shared/ipc/schema/files.ts` | no row | three optional keys, one derived schema |
| `src/shared/ipc/wire.ts`, `wire-manifest.json`, `wire-fingerprint.json` | no child; the row lists the landings that raise the minor | the minor, at the merge (the row gains U6c: point 11) |
| `src/renderer/src/tools/code/viewer/`, `tools/code/open-file.ts` | U6 | the window |
| `src/renderer/src/tools/code/copy.ts` | U5's and U6's strings in one file | one key under `EDITOR_COPY.readOnly` |
| `e2e/sessions.spec.ts` | no row; U8c-1 adds a scene there too | one scene; the second to land keeps both |
| `docs/charter.md`, `docs/doperpowers/plans/2026-09-28-c8-right-panel.md` | the record | one dated line each |
| `src/renderer/src/transcript/`, `src/renderer/src/lane-b/`, `src/main/lane-b/`, `src/endpoint/`, `src/services/files/allowlist.ts` (code), `admission.ts` | UC-3; U9; U9; the P5 work; U8c-2; nobody | not edited |

## Proof that an executor does not run

Each is a step for the architect, with what it needs.

1. **The scene, alone, then its group.** `e2e/sessions.spec.ts`, the new case alone and then the default `e2e` group, on a Mac under the load rule, from the branch's head on a master that holds U13a. Needs: the built app; nothing of the owner's (the case's scratch store and folders).
2. **The groups that cross the code.** `e2e:code` (the viewer and the editor), `e2e:deliverables` (a delivered file's read, open and reveal: the admission order), `e2e:remote` (a read over the link must be what it was, with the endpoint's schema now taking an optional key).
3. **The macOS unit files.** `src/services/files/service.test.ts` is among the files `scripts/darwin-unit-files.sh` lists; its guarded cases, old and new (the path written in another case), run in the Mac lane.
4. **Class 1a**, once, when the branch is complete: `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6c`.
5. **The branch review** (Decision Log 3): the panel, with its lenses.
6. **A live turn.** A session MAWS runs, with a real engine, on a Mac that is not the owner's MacBook: the agent writes a file outside the session's folder and links it; after the turn the click opens it read-only; a click while that message is still streaming shows the refusal and a second click opens the file. This is the one route the suites cannot show (under the replay transport no engine writes a transcript). Needs: the wave's build, an engine, a few cents. It may ride in the owner's sitting instead.
7. **The owner's look.** No drawn example is needed before this is built: no element is added, and the one new string is point 4's. In the sitting's scene script: A1, A2, and a session on another machine showing what it shows today.

## The pull request

Its body names its class 1a run, the review's verdict with what was dismissed or deferred, and its residue. It carries, dated, the rule this landing loosens where it stands (root UC-10, "The record"):

- **`docs/charter.md`, §19 (Decision log), one entry:** "2026-11-13 (owner; UX wave U6c, O-37): on the machine that holds a session, the files service (C8's K1) also reads one regular file outside the session's folders, read-only, when that session's own transcript writes its path. The daemon checks the transcript itself before it reads, for a caller on that machine alone; such a file is never written, and its folder is never listed or watched. The owner's answer: 'Files the transcript names'. For every other path, and for a caller from another machine (P5 Decision Log 237), K1's rule stands."
- **`docs/doperpowers/plans/2026-09-28-c8-right-panel.md`, at K1, one line:** "Amended 2026-11-13 (UX wave U6c; the owner's answer 'Files the transcript names'): `files.read` and `files.openExternal` also admit, for a caller on the session's own machine that asks with `named: true`, one regular file outside the roots whose path the session's transcript writes, checked by the daemon (`src/services/files/named.ts`); `files.write`, `files.list`, `files.watch` and `files.reveal` do not."

Other records that state the old rule and follow, none of them this pull request's: the section and the root (point 11, the architect's batch); the register's row for O-37, at landing. The debt tracker holds no row that states the rule; its row of 2026-10-08 (a PDF through the Files route) stays U6b's. In code, the header comments M2 names.

## Surprises & Discoveries

- Observation: the files service runs in `mawsd` and nowhere else; the card's "main process" and the comment at the head of `checkouts-root.ts` are older than that.
  Evidence: `src/main/hosts/mode.ts`, "Every launch that reaches the app runs on the machine daemon, `mawsd`"; `startSpine`'s one product caller is `src/mawsd/spine-seam.ts`.
- Observation: the boundary already admits one kind of file from outside the roots, and gives this landing its shape.
  Evidence: `precheck` in `src/services/files/service.ts`: `if (!admits || !(await admitted?.(appSessionId, real0))) throw new Refusal(); roots = [...roots, real0];`, for `read`, `openExternal` and `reveal` only.
- Observation: a transcript file holds text that is no part of the conversation: messages typed and taken back, and the engine's request records.
  Evidence: `test/fixtures/transcripts/w1-steer-next-cancelled.jsonl` (the cancelled message's text is in a `queue-operation` record and in no `user` row); `src/engine-host/fs/chain-follower.ts`, "66% of a 625 MB transcript measured".
- Observation: a daemon of build F serves an input with a key it does not know, less the key; an endpoint of build F refuses it.
  Evidence: `src/shared/ipc/tolerant.ts`'s header ("A newer peer may send an object key this build's schema does not know … the reader drops it"), used by `front.ts`'s `codec.readCommandInput` at `f1852de3a`; `src/endpoint/authorize.ts`, the strict `holdsToSchema`.
- Observation: a file tab belongs to a machine and a path, not to a session, so a file admitted under one session can be asked for under another through the same tab.
  Evidence: `tabId` in `src/shared/ipc/schema/layout.ts`: `` `file:${tab.machine}:${tab.path}` ``.
- Observation: the viewer watches the file's folder before it reads, and outside the roots that watch is refused while the read goes on; so a file outside the roots is never re-read.
  Evidence: `watchThenRead` in `viewer-store.ts`; the Files store's `ready` "settles when the watch has answered (installed or refused)".
- Observation: the charter's §12 C8 entry holds no sentence of the rule the section cites there; K1 stands in the C8 document, and the charter's own log carries its rulings.
  Evidence: `docs/doperpowers/plans/2026-09-28-c8-right-panel.md`, "K1 `files.*` read service"; `docs/charter.md` §19, the entries of 2026-09-28 and 2026-09-29 on K1.
- Observation: the viewer's e2e spec cannot hold the scene: its sessions are a scenario's and have no transcript.
  Evidence: `e2e/support/code-scratch.ts`, `MAWS_SESSION_SOURCE: stub:<scenario>`; `spine-root.ts` reads no index in that mode.

## Decision Log

1. **2026-11-13 (UTC) · The owner's words.** From the board ticket's body (ticket 622), verbatim. Typed, over a screenshot of the file viewer's notice "Refused: path outside the session's directories" for a PDF in the Downloads folder: "another small change idea:  can we just [Image #2] allow it".

2. **2026-11-13 (UTC) · The owner's answers on the question card.** From the same body, verbatim.
   - "Today a click on a link to a file outside a session's folders is refused (your screenshot: a PDF in Downloads). On this Mac, which files outside a session's folders should open, read-only, when you click their link in that session's transcript?" = "Files the transcript names (Recommended)" (the option's text: any file whose path appears in that session's transcript, written by the agent or by you, opens read-only; the main process checks the path against the transcript before it reads, so the window cannot ask for other files; a session on another machine keeps the refusal for files outside its folders).
   - "Opening a linked file outside a session's folders is now planned inside the second artifacts landing, which waits for four other landings. When should it be built?" = "Own small landing, now (Recommended)" (the option's text: its design starts today and it lands by itself after the tab strip landing; text, code and images outside the folders then open in the tab; a PDF shows the row that opens it in Preview, as a PDF inside the folders does today; PDFs drawn inside MAWS stay in the second artifacts landing).

3. **2026-11-13 · The verification call** (the author, at authoring). This document gets an adversarial review before an executor starts (the architect dispatches it). The branch gets the `doperpowers:review-code` panel (xhigh). By size it would not: about twenty files and fourteen hundred changed lines, half of them tests. It takes the panel because it opens a read boundary of the files service, which the root treats as delicate wherever a landing meets it (UC-4's second landing "takes the review panel with a reviewer on that boundary"; UC-10 lists "U6's route that serves a session's file to a frame"). The lenses: (a) the boundary: the order of `precheck`, the remote test before any transcript read, the root of one through the open and the confirmations, the link rules, and that `write`, `list`, `watch` and `reveal` cannot reach the admitted file; (b) the rule and the search: a string that names a path the transcript did not mean, a row that should not count, a line passed over that names the path, what is remembered across a moved, replaced or shortened file; (c) other machines and other builds: every pairing of §D's table, and that nothing new crosses the link; (d) the window: the entry's states across W1 to W5, read-only with no route to a write, the tab that changes session; (e) the public repository: fixtures and the scene hold nothing of the owner's. Class 1a on GitHub Actions is the gate of record.

The decisions made at authoring are in "Decisions settled at authoring", each with the alternative it beat, and the points that are the architect's in "Reported to the architect". Entries below this line record what moves after.

## Outcomes & Retrospective

Pending — written at finish.
