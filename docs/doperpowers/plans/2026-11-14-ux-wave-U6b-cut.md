# UX wave · U6b: what is left of the child, cut into five landings

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*), its remaining landing **U6b** (board ticket 592). **Parent pin:** master `c6a22fe89722dcbed4f5ff1e5f290a7fdaeb2933`, the commit every statement about the code below was checked against; the root and the child's file are read at that commit.
>
> **What this document is.** U6b, "the rest" of the child, is too large for one pull request. This document lists, item by item, what is on master, what the artifact-link landing (U6d) builds and what is U6b's; cuts U6b's part into five landings; and gives each later landing a section (edge, items, dependencies, size, the decisions the code already forces) from which its execution document can be written without reading the whole child again. The first landing's execution document is `docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md`. This document carries no milestones of its own.
>
> **Branch:** `ux-wave/U6b`, from master `c6a22fe89`.
>
> **Revision 2 (2026-11-14).** The adversarial review of the first writing (`91994b8f2`) returned nine findings over the two documents, all accepted, and the architect ruled on them, on the cards and on the nine points (Decision Log 3 to 8). The cut into five landings stands as written. What moved here: U6b-2's section names what the route does not inherit from `files.read` and who owns a token; card C1 keeps today's behaviour until the owner answers; the Overview stays a place; a terminal's selection is stored in the session's draft before it is confirmed; U6b-5 is built on a head that holds U6b-1; the four cards are in final form, R8 with a drawing per option.

## Purpose

Three landings of U6 are on master or being built: the keymap's shape (U6a), a linked file opened read-only from outside the session's folders (U6c), and the artifact link (U6d, on `origin/ux-wave/U6d`). What is left is most of what a person would call this child: a file beside the chat, Files showing what changed, links that open whatever their form, PDF and media drawn in MAWS, "Open in", Back and Forward, zoom, the palette's recent list. Counted from the code it is about 14,000 changed lines over five areas that share few files. Landed as one pull request it could be neither reviewed in one reading nor run as one set of scenes, and its one delicate part, the route that serves a session's file to a frame, would be reviewed among forty unrelated files.

After the five landings: a file opens beside the chat and moves to the main area only when the person moves it; a PDF, an HTML file and media open inside MAWS by a path; Files shows what changed and finds a file by name; a link the agent writes opens whatever its form, a refusal says why, and "Open in" hands a file or the folder to an editor, a terminal or Finder; Back and Forward, zoom, the palette's recent list, and the keyboard returned to where it came from.

## Progress

- [x] (2026-11-14) The item-by-item list, the cut and the four later sections written against master `c6a22fe89`; the first landing's execution document written.
- [x] (2026-11-14) The adversarial review of both documents, and the architect's rulings on its nine findings, on the points and on the cards.
- [x] (2026-11-14) Revision 2: the rulings folded in, in place; master `b3253a098` merged (no file under `src/` moved).
- [ ] The owner's answers on the four cards (C1, C2, C3, R8). R8 holds the first landing's third milestone; the others hold nothing.
- [ ] U6b-1 — a file opens beside the chat (its own document).
- [ ] U6b-2 — a PDF, an HTML file and media by a path (document to write).
- [ ] U6b-3 — Files shows what changed, and Go to file (document to write).
- [ ] U6b-4 — every form of link, a refusal that says why, and "Open in" (document to write).
- [ ] U6b-5 — the rest of the keyboard (document to write).

## Item by item: on master, U6d's, or U6b's

Read against the code at `c6a22fe89`, not against the child's "Today" paragraphs, several of which other landings have overtaken.

| the child's item or part | on master | U6d builds | U6b's, and in which landing |
|---|---|---|---|
| **UC-6**, the row's shape, the grouped menus, the sheet, Settings ▸ Keyboard, the rebinding guard | whole (U6a) | — | — |
| UC-6's rows: `surface.terminal`, `surface.review`, `surface.files` with ⌘J, ⇧⌘D, ⇧⌘F | whole (U6a) | — | — |
| UC-6's rows: `files.goToFile` | — (named only in the test's list of rows to come) | — | U6b-3 |
| UC-6's rows: `terminal.attachSelection`, `go.back`, `go.forward`, `zoom.in`, `zoom.out`, `zoom.reset` | — | — | U6b-5 |
| UC-6, the file editor gives up ⌘[ and ⌘] | — (`defaultKeymap` whole in `tools/code/editor/editing.ts`) | — | U6b-5 |
| **l5-code-11**, a file opens beside the chat, the preview tab, the moves, the relaunch (A1, A2) | — (`openFile` opens a main tab) | — | U6b-1 |
| **l5-code-13's remainder**, the selected side tab kept in view; and from U8's O-36 the drags of a side tab | — | — | U6b-1 |
| **l5-code-09**, the Changed group, the marks, ignored entries dimmed, Go to file ⌘P (A3) | — | — | U6b-3 |
| **l5-code-10 · l9-browser-delivery-08**, "Open in" (A4) | — (no code finds or starts an editor) | — | U6b-4 |
| **O-37**, a file outside the folders that the transcript names, read-only, on this Mac | whole (U6c) | — | — |
| O-37, the refusal in plain words | — (`Refused: ` and the command's words) | — | U6b-4 |
| O-37, PDF, HTML and media drawn in the app; the route that serves the bytes | — (`externalKindOf` sends them to the row) | — | U6b-2 |
| O-37, `file://` links and relative links | — (a `file:` href is removed; a relative path is refused) | — | U6b-4 |
| O-37, the sentence in the instructions to the agent | — | U6d removes another sentence of the same text | U6b-4 |
| O-37, what the child leaves "For U6b's design" | — | — | decided or carded below; built by U6b-4 |
| **O-44**, an artifact mention is a link, and the agent opens no artifact by itself | — | whole | — |
| **l6-artifacts-01**, Word, PowerPoint and Excel previews | — | — | not U6b's: later landings of U6, designed outside the repository; they consume what "What the previews consume" names |
| **l9-browser-delivery-03**, a localhost link opens in the in-app browser (A6) | the other-machine half (as before) | — | U6b-4 |
| **l5-code-08**, the three chords showing and hiding (A7's first sentence) | whole (U6a) | — | — |
| l5-code-08, the surface takes the keyboard when shown and gives it back to the composer when hidden | in part: Terminal and Review take it when the column opens; nothing gives it back | — | U6b-5 |
| l5-code-08, "Attach selection to chat" and ⇧⌘L (the rest of A7) | — | — | U6b-5 |
| l5-code-08, a new terminal starts in the working folder | whole (U8a: `ensureTerminal` reads `workingFolder(session).path`) | — | — |
| **l7-shell-06**, the palette: Recent, Artifacts, ranking, no row that cannot run (A8) | in part: fixed rows are already left out (U6a) | — | U6b-5 |
| **l7-shell-07**, View and Go in groups, the sheet in the same groups (A9) | whole for the rows that exist (U6a) | — | the new rows join their menus with the landing that adds each |
| **l7-shell-08**, zoom (A10) | — | — | U6b-5 |
| **l7-shell-09**, Back and Forward (A11) | — (nothing records places) | — | U6b-5 |
| **l7-shell-13**, F6 over every region | whole: the page, each side group's strip and body, and the card column are stops (U8b, U7b) | — | — |
| l7-shell-13, the mode change said aloud (the rest of A12) | — | — | U6b-5 |
| **A13**, the table's test | holds for the rows that exist | — | each landing adds its ids to the rows that must exist |
| **Probe 1** (the refusal on the owner's second machine) | — | — | U14's list; U6b-4's notices are the stopgap the child names |
| **Probes 2 to 5** (zoom) | — | — | U6b-5, on a Mac |
| **Probe 6** (⇧⌘L against a Service; the chords under the Korean input source) | — | — | U6b-5, on the owner's machines |
| **Probe 7** (the file route) | — | — | U6b-2 |
| **Probe 8** (ignored entries at size) | — | — | U6b-3, measured on the build VM |
| **Probe 9** (Files where the agent moved) | closed by U8c-2 (the folders a session's files are read from follow the agent) | — | — |
| **Rulings reversed**: l5-code-08, the settings guard | recorded (U6a) | — | — |
| Rulings reversed: l5-code-11 (three sentences of the charter) | — | — | U6b-1 |
| Rulings reversed: O-37's `file:` link, l9-browser-delivery-03's line, the instruction's dated line | — | — | U6b-4 |

## The cut

| # | the landing | what a person has after it, and no more | needs | size (changed lines, tests and scenes included) | review |
|---|---|---|---|---|---|
| **U6b-1** | a file opens beside the chat | A1, A2: files beside the chat with the tree, the preview tab, the moves, the side strip's drags | master (U8b, U13a, U6c, U7b are on it) | about 5,300 over 55 files, five milestones | the panel, by size |
| **U6b-2** | a PDF, an HTML file and media by a path | the PDF half of A5: such a file is drawn in its tab, on every route, with no artifact made | U6b-1 (the same viewer files); ticket 662 on master | about 2,400 over 34 files | the panel: the root calls this route delicate |
| **U6b-3** | Files shows what changed, and Go to file | A3 | U6b-1 (the tree column) | about 1,500 over 22 files | one reviewer, high rung |
| **U6b-4** | every form of link, a refusal that says why, "Open in" | the rest of A5, A4, A6 | U6b-1 (the file's bar); U6b-2 for A5 as a whole | about 2,200 over 45 files | the panel, by size, and because it edits the rule of what a transcript names |
| **U6b-5** | the rest of the keyboard | A7's rest, A8, A10, A11, A12's rest, A13 whole | U6b-1 (the Files tool it gives the keyboard to); nothing of U6b-2 to U6b-4 | about 2,600 over 55 files | the panel, by size |

**Order.** The wave's branches land as a chain (root UC-10), so the landings land in the order of the table. Authoring need not wait. Building has one order beyond the chain's: every later landing is built on a head that holds U6b-1. U6b-5 was first written as needing no code of U6b-1; that was wrong in one place. Its work on the keyboard given to a surface decides which element of a Files tab takes it (the file's view when the tab holds one, else the tree), and that is written in the `FilesTool.tsx` U6b-1 rewrites; U6b-1's `focusedFile` is not consumed by U6b-5. Beyond that U6b-5 shares no file with U6b-2 to U6b-4 and can be built beside them; U6b-2 and U6b-3 share no file and can be built together.

**Why this cut.** Each landing is one thing a person can be shown, with one verification strategy. U6b-1 is first because every later landing draws into what it makes (a PDF in the file's tab, "Open in" in the file's bar, Go to file opening a kept tab): built first on the main-tab form, each would have its scenes rewritten when the tab moved. U6b-2 is second because the Office previews wait for it and for U6b-1 and for nothing else of U6b, and because the delicate route then gets a review of its own. Files (U6b-3) and links (U6b-4) follow in the order a reviewer of agents' work meets them. The keyboard (U6b-5) is last in the chain and depends on the least: on U6b-1 alone.

**What it beat.** One landing per item (twelve pull requests, each paying a Mac run set). The route together with the file's tab ("U6b's part" as the preview design counts it, about 7,700 lines): the route's review would be diluted and its landing held by the tab's drag scenes. Links and the route together: the notices and the link forms are small and visible, the route is delicate and invisible, and they share one file.

**Two parts that can be cut off again** if their landing's document counts past the panel mark: "Open in" from U6b-4 (nothing depends on it; the owner's words on it are "low cost to build, so why not"), and zoom from U6b-5 (all of its proof is on a Mac).

## U6b-2 · a PDF, an HTML file and media by a path

**Edge.** In: a session's file whose type is PDF, HTML, video or audio is drawn in the file's tab by the frames artifacts already use (`PdfFrame`, `HtmlFrame`, the media element of `frames/Media.tsx`), on every route, without creating an artifact; the route that serves its bytes; "Open externally" kept in the bar; the tracker's row of 2026-10-08 closed. Not in: the notices' words (U6b-4); Word, PowerPoint and Excel; any change to which files a session may read.

**The route, exactly.** These are the decisions the code forces; U6b-2's document builds them and may rename what is marked "name".

1. **The admission is `files.read` itself, at every request** (what it gives; what it does not give is below). Main has no files service of its own: the service runs in this Mac's daemon, and main reaches it over the machine socket (`hosts.dispatch('machine', 'files.read', …)`). The store's scheme handler (`createSchemeHandler`, `src/services/artifacts/scheme/scheme-handler.ts`) opens a path with plain `O_RDONLY` and follows links, which is safe only for paths the store itself named. So the route does not hand a path to that handler. For every range it serves, main asks `files.read { appSessionId, path, offset, length, named: true }` of the daemon, with the raw input named below, and answers with the bytes that call returned. The rule is therefore the child's first rule by construction, checked where the read runs and on the value that is used: a file is served exactly when `files.read` reads it for that session, which is a file under the session's roots (the record's folders and the two UC-4 admits), a file delivered to the session, or, on this Mac, a file the session's transcript names (U6c). The guarantee of probe 7 is `files.read`'s own, per call: the open follows no link on the way (`openNoLink`) and the descriptor is confirmed under the roots (`confirm`) before a byte is read. Lost: a descriptor handed from the daemon to main over a new socket (a new surface in `mawsd`, whose artifacts endpoint is kept off the spine on purpose); the store's handler with a session path (admission and read would be two acts).
2. **On which route** (law 5). A session MAWS runs and a terminal session on this Mac: the same files service in this Mac's daemon, which has no branch on who holds the session. A session on another machine: the file is fetched here as a copy by the ranged read "Open externally" uses (`fetchToFile`, `src/main/lane-b/remote-copy.ts`), up to `REMOTE_COPY_MAX_BYTES` (64 MiB), and served from the copy through a descriptor main keeps open for the copy's life; a larger file keeps today's row. That machine is asked `files.read` pages and nothing else, without `named` (its service refuses the key for a remote caller): nothing is sent that "Open externally" does not send today. This landing removes the copies it makes; the copies of "Open externally" are left as they are.
3. **The URL carries a token, never a path:** `maws-artifact://<token>/file`, the token 32 lower-case hex characters main draws for one mount of one file in one window. Main holds what the token stands for (the window, the session, the path, the type the files service answered). The token is not shaped like an artifact's id, so every reader that expects one already refuses it (`parseArtifactUrl`, `artifactIdOfUrl`, the daemon's endpoint). Any other path under the token, any other method than GET and HEAD, an unknown or released token: 404 or 405, naming nothing. A token is released when its viewer entry goes, when the file is read again after a change (a new token, a new URL), and when the window goes.
4. **The scheme is the store's, not a new one.** Every judge main has for a store frame keys off the prefix `maws-artifact://`: the request filter, the navigation guard, the download guard, the permission refusal, the exemption that lets Chromium's PDF viewer load, and the rule that a frame of one host reaches no other host (`isStoreUrl`, `ALLOWED_BENEATH`, `shouldCancelRequest`, `shouldBlockFrameNavigation`, `shouldCancelDownload`, `isStoreFramePermission`, `isCspExempt`, `crossesArtifacts` in `src/render/policies.ts`), and the window's own policy already names the scheme for frames and media (`PRODUCTION_CSP`, `src/main/csp.ts`). A token host is judged by all of them with no edit. Lost: a scheme of its own, which would need each of those predicates to learn a second prefix, where one missed predicate leaves the PDF frame, which has no sandbox, outside main's judgement. The cost: the store scheme's host is no longer always an artifact, so the responder sits in main's `first` chain ahead of the proxy to the daemon (`src/main/artifacts/index.ts`), built per partition so that the capture partition and the render host's partition serve no token ("Who owns a token", below).
5. **The command** that issues a token is main's own (name: `layout.frameFile { appSessionId, path }`, answering the URL and the type, or the refusal's words), with its release (name: `layout.releaseFrame`). Main's own commands are outside the wire's manifest, so the command itself moves no minor (the raw read below does). Its `appSessionId` adds a line to `src/shared/machine/address-paths.json`.
6. **Where a format is recognised:** `kindOf` in `tools/code/viewer/kinds.ts` gains a kind, `frame`, for the types `framedKindOf(mime)` answers (`pdf`, `html`, `video`, `audio`; name), from the type the files service answered, as an artifact's body is chosen (`bodyOf`). Images stay as they are.

**What the route does not inherit from `files.read`, and U6b-2's own document settles** (ruled on the review, Decision Log 4). `files.read` stays the admission rule. It was written to feed a viewer, not a frame, and four guarantees a frame needs are not its:

- **Exact byte ranges, for every kind.** `files.read` answers a text type as decoded text, and settles a chunk to a character and line-break boundary (`settleText`, `src/services/files/service.ts`), so for an HTML file (a text type) the range answered is not the range asked, and bytes that are not valid UTF-8 are not the file's. The route needs a raw read: the range as asked, as bytes, never re-cut and never decoded. That is a new optional input of `files.read` (name: `raw`), **and so one wire minor**. A daemon that does not know the key (build F's on this Mac, in the moments before it is replaced) drops it and answers as today; main recognises that (a text encoding where it asked for bytes) and serves nothing, and the file keeps today's row until a daemon that knows the key serves. Another machine is not asked for raw ranges: its copy is fetched by `fetchToFile`, which already proves the copy byte for byte or refuses.
- **One version of the file across the ranges of one response.** `files.read` answers no identity of the file it opened, and a hash only when asked and only up to 8 MiB. The route needs an identity that costs no read of the whole file and holds past that cap: what the confirmed descriptor already knows (device, inode, size, modification time), answered with each raw range (an optional field of the answer, in the same minor). Main fixes it at a response's first range and ends the response in an error when a later range answers another.
- **The type and the frame's policy are fixed when the token is issued:** the type the admission read answered, and the policy header that goes with it (none for a PDF, `STORE_FRAME_CSP` for everything else). No later range re-types an answer.
- **Recovery for a file no watch follows.** A file outside the folders that the transcript names has no watch, so no event re-issues its token after a response ended in an error. The document says what the tab then shows and how the person reads the file again (U6c's `revisit`: the tab shown again, or the link clicked again).

Its document names these tests: a file with bytes that are not valid UTF-8, served byte for byte; a range that begins or ends inside a multi-byte character; a replacement of the same size between two ranges of one response.

**Who owns a token.** Main issues a token to one window (one web contents) for one mount of one file, and releases it. The responder is installed on the app windows' partition only (Electron's default partition), and serves a token only to a request from the window it was issued to. A use from another window, a use on another partition, and a release asked by a window that does not own the token are each refused, with a test. The capture partition (`maws-capture`) and the render host's partition get no responder, and are proven to serve no token: a token URL asked there answers 404. Where this section says "session" it means a MAWS session; an Electron session is called a partition.

**What a frame served by the route can and cannot do, and the proof of each.**

| kind | how it is drawn | it can | it cannot | proof |
|---|---|---|---|---|
| PDF | `PdfFrame`: a frame with no `sandbox` attribute (Chromium's PDF viewer starts in no sandboxed frame) and an answer with no policy header, as a stored PDF's | show the document in Chromium's viewer | load anything but its own host, the viewer's extension and `chrome://resources`; navigate; download; hold any permission; reach another token or an artifact. Main's policies are its whole defence | `policies.test.ts` with a token host in every decision; a scene after the deliverables group's containment scene: a link in the PDF is a blocked navigation, its Download a blocked download, every frame URL under one of the three prefixes; probe 7's first part (the viewer loads the token URL) on a Mac |
| HTML | `HtmlFrame`: `sandbox="allow-scripts"`, `referrerPolicy="no-referrer"`, the answer byte for byte under `STORE_FRAME_CSP` unchanged, none of the frame's optional bridges passed | run its own inline script; draw what it carries as `data:` or `blob:` | load anything from the network or from beside it (a page that needs its neighbouring scripts or styles renders without them; the bar keeps "Open externally"); navigate; open a window; submit a form; keep storage (an opaque origin); ask the app anything (no preload runs in a frame); hold a permission; download | the handler's suite (the policy on every answer but a PDF's); the scene: a fetch fails, a web link is blocked by the policy, no server-reflexive ICE candidate, no download; ticket 662's net-log scene repeated on a file's frame |
| video, audio | a media element in the window's own document, its source the token URL | play, seek (ranges) | run anything: only bytes are loaded, and the window's policy admits the scheme for media alone | the kinds' suite; a scene that plays and seeks |

**What the route relies on from ticket 662.** An HTML page, by script or by markup alone, can make Chromium resolve a name through a `<link rel="dns-prefetch">`, and no policy, sandbox, request filter or permission rule sees that query (`spikes/viewer-frame/FINDINGS.md`). Only Blink's `dnsPrefetchingEnabled=false`, appended before the app is ready, closes it (`setBlinkSettings`; not on master at this document's pin, landed there on 2026-11-14 as pull request 669, master `2c7044231`). An HTML file by a path is a second kind of page that reaches that channel, and unlike an artifact it need not have been written by the session's agent (a page in a cloned repository). **U6b-2 does not land before ticket 662 is on master**, its document's first step checks it (`git log origin/master -- src/main/chromium-features.ts` shows `setBlinkSettings`), and its HTML scene asserts the closed channel on a file's frame.

**Stored and sent.** Nothing is stored. Sent: `files.read` with `named` to this Mac's daemon (exists since U6c; a daemon of build F, in the moments before it is replaced, drops the key and refuses a file outside the folders), and with the new raw input and the identity in its answer: one wire minor; `files.read` pages to another machine, as build F sends them, with neither. The command that issues a token is main's own and outside the wire's manifest.

**Sequences its document must hold open.** A token asked while the tab closes (released on the answer); a copy from another machine that never arrives (the link's timeout, then the notice); a file that changes between two ranges (the stream ends in an error and the entry reads again on `files.changed`); a token used after its release (404).

**Scenes.** `e2e:code` (`e2e/code-tools.spec.ts`: "a PDF is an Open externally row" turns into the PDF drawn; the binary row stays), `e2e:deliverables` (the containment scene's method on a file's frames; 662's scene), `e2e:remote` (an HTML file of the other machine drawn from its copy), `e2e` (`e2e/sessions.spec.ts`: U6c's PDF outside the folders is drawn). The macOS-guarded cases of `src/services/files/service.test.ts` run in the Mac lane.

**What an executor cannot run.** Probe 7 on a Mac; the containment scenes; the panel review; the look at a real PDF, a real video and a page with neighbouring files.

## U6b-3 · Files shows what changed, and finds a file by name

**Edge.** In: l5-code-09 as the child's file orders it (the Changed group; the marks in the tree; ignored entries dimmed; Go to file, ⌘P). Not in: search inside files, hiding dotfiles, a filter over the tree's own rows (the child's "Not included").

**Decisions the code forces.**

1. **Where it is drawn:** the tree column U6b-1 builds (`[data-files-tree]`, `tools/code/files/tree-state.ts`). The Changed group sits on top of the tree in every Files tab; the filter field above it.
2. **What is asked, of whom.** `git.status { directory }` for the Changed group and the marks, `git.lsFiles { directory, query, limit }` for the filter (its limit allows the child's 50), both of the working folder (UC-4: `useWorkingFolder`), both commands every machine already offers. "Ignored" is new: `files.list` answers one more optional fact per entry. Its schema is the daemon's (`FilesEntrySchema`, strict), so the wire minor is raised by one, and the field is absent-safe both ways: a daemon of an older build answers without it and nothing is dimmed; a window of build F drops a key it does not know (`readTolerant`). The check is made in the files service's listing (`src/services/files/`, no child's files: an insertion), in one batch per directory.
3. **Probe 8 is a measurement on the build VM,** in the landing's first milestone: a directory of 5,000 entries listed with the check stays inside the command's budget (`src/services/command-budgets.ts`); if it does not, the check runs only for the entries on screen, which the child's file already names as the fallback.
4. **⌘P.** The row `files.goToFile` (Go menu, after the palette's row; `GROUP_OF_PREFIX` gets an alias so that no separator falls between the two) joins `SHELL_FOCUS_ACTIONS` (`src/main/menu.ts`), or a page of the in-app browser keeps the keyboard. It takes no rebinding while build F can be gone back to, and yields ⌘P to a stored rebinding that holds it (UC-6, "Stored rebindings"). Its handler calls `showFiles` (U6b-1) and puts the keyboard in the filter; Enter opens with `keep`.
5. **A deleted file's row** opens Review at that file (`panelHost.addTool('review', { params: { scope: 'uncommitted', path } })`).
6. **Routes.** All three, read on the session's machine.

**Stored and sent.** Nothing stored. One optional field on an answer: a wire minor.

**Scenes.** `e2e:code` (the Files scenes of `e2e/code-tools.spec.ts`; a new one for A3), `e2e:layout` (the Go menu in `e2e/ux2-shell.spec.ts`), `e2e:remote` (the Changed group read on the other machine), `e2e:cross-build` (the update scene meets the new minor).

## U6b-4 · every form of link, a refusal that says why, and "Open in"

**Edge.** In: O-37's notice table; `file://` and relative links; what the child leaves "For U6b's design"; the sentence in the agent's instructions; l9-browser-delivery-03; l5-code-10 with l9-browser-delivery-08. Not in: PDF and media drawn (U6b-2); a remembered editor, JetBrains IDEs, another machine's folder in a local editor (the child's "Not included").

**Decisions the code forces.**

1. **The notice needs the error's code, which the viewer drops today.** `invoke` returns `{ code, message, issues? }`; the viewer store keeps the message alone. The entry gains what the classifier needs (the code, and `issues.refusal` for `grade`), read from what is already returned: nothing new is sent. The classifier is one pure function over the child's table. Retry is U6c's `revisit`. Files' own root notice takes the same sentences; Review's refusals are U5's and stay.
2. **Two cases the child's table does not have** (X7, ruled): the same codes arriving for a session on this Mac, and `grade` for a session with no signed listing.
3. **`file://`.** The window turns an inline link whose destination is a `file:` URL with no host into a path link (`remarkTranscriptSources`, `transcript/view/markdown/sanitize.ts`); it is still never an element's href. An autolink (`<file:///…>`) is not turned: U6c's rule reads only inline destinations, and the differential test (`tools/code/named-links.test.tsx`) holds the window and the rule equal. The rule (`clickPath`, `src/shared/files/named.ts`) reads the same form in the same change, so a `file://` link to a file outside the folders is named by the transcript that writes it.
4. **A relative path** is resolved in the window, before the open, against the session's working folder (UC-4), and in a rendered Markdown file against that file's own folder. It needs no rule when the result is inside the folders. A relative link is never a name for a file outside them: the rule has no folder to resolve against, and the owner's rule is a path the transcript writes whole.
5. **Dead chips.** A path chip in a side question's answer (`side/BtwView.tsx`) and in a mod's pane or composer site does nothing today, inside the folders too: the Markdown there is mounted with no file action. They get the session's `openFile`.
6. **The instructions' sentence** is appended as the child's file words it and as ruled on 2026-11-13 (the same on every machine): about 200 characters, inside root UC-15's budget (699 today, 635 once U6d lands, 343 for the browser's paragraph), with its dated line at X9. The probe's served snapshot is not recorded again: the difference joins the named, dated list U6d adds to `src/shared/maws/search-tools.test.ts`.
7. **Localhost.** ⌘ must reach the action: the web link's click passes it (`Link.tsx`, `view/context.tsx`; UC-3 files, insertions), and the opener registered in `App.tsx` sends an `http` or `https` loopback link of a session on this Mac to `openBrowserUrl` unless ⌘ is held. `isLoopbackLink` also answers for other schemes, so the gate is `loopbackPort`'s. The terminal's forwarder gets the same branch. Another machine's session is unchanged.
8. **"Open in" cannot be decided in main.** The admission UC-4 demands (`admittedFolder`, `src/services/files/allowlist.ts`) runs in the daemon only. So: one read of the daemon's (name: `files.admit`) answers the real path of an admitted folder or file, and main, which alone starts apps, launches with that path and never with a string from the window. A new command of the daemon's: the wire minor is raised by one; a daemon of build F answers "unknown command", which opens nothing. Lost: a new kind on the client port (a wire major); a parameter on `openExternal` (build F's main would ignore it and open the default app). The command is declared unavailable for a session on another machine (`src/shared/ipc/remote-unavailable.ts`, U9's file: an insertion).
9. **Finding the apps:** the pattern is `src/main/gateway/claude-usage-app.ts` (a Spotlight query by bundle identifier, cached; `open -b`). The identifiers and each editor's way of taking a line are external facts: U6b-4's document verifies each against the app and against Claude Desktop's list (`main-process/index.chunk-BjORVu2_.js:6114-6120`) before it names them. The e2e needs a seam for a launch, as `MAWS_E2E_OPEN_LOG` is for "Open externally".
10. **Where the item sits.** In the title bar it is a submenu inside "Session actions" (the top-level items of that overflow are pinned by `e2e/panel.spec.ts`); in the sidebar row's menu, a submenu. For a session on another machine the child's file wants the reason in the item's own words ("Open in (the folder is on <machine>)"); the menus draw a reason as a tooltip today, so this item's label carries it.

**Stored and sent.** Nothing stored. One new read of the daemon's (a wire minor). The rule's change is in the daemon and changes no schema.

**Scenes.** `e2e` (`e2e/sessions.spec.ts`: U6c's scene gains a `file://` link and the notice's words), `e2e:code` (the refusal scenes), `e2e:remote` (the machine stopped, then Retry; "Open in" disabled with its sentence; the forwarded link unchanged), `e2e:browser` (a local loopback link), `e2e:terminal`, `e2e:panel` (the title bar's menu), `e2e:side` (a side question's chip), `e2e:tools` and the paid live group where the instructions are read.

## U6b-5 · the rest of the keyboard

**Edge.** In: l5-code-08's rest (the keyboard given to a surface and returned; "Attach selection to chat"), l7-shell-06, l7-shell-08, l7-shell-09, l7-shell-13's announcement, the six rows of UC-6 still missing. Not in: a bottom drawer, a printable sheet, history across relaunches, pinch to zoom.

**Decisions the code forces.**

1. **The menu can only be told which actions have a handler** (`layout.setEnabledActions`). So Back, Forward and Actual Size are disabled at their ends by registering and unregistering their handlers, as `channel.open` does.
2. **Nothing records places.** The record is new: one subscriber over the place in front (`placeOf`, `stores/layout.ts`), 50 entries, for the run. It is shared with the palette's Recent, which also needs artifacts opened beside the chat (not places). A tab that closes leaves the record; a place shown by a quiet act of an agent's is recorded like any other; focusing the other pane of a split records nothing. The page's own title-bar Back (U7b) becomes this Back. The file editor gives up `Mod-[` and `Mod-]` (`tools/code/editor/editing.ts`).
3. **The Overview is a place, as the child's file names it** (ruled, Decision Log 6), though in the code it is a dialog over the strip that a tab change elsewhere leaves open. So a recorded visit to the Overview is a pair: the Overview, and the place beneath it when it opened. Going Back or Forward to it shows that place and opens the Overview over it. If that place is gone (its tab closed), the entry leaves the record with it, as any closed tab's does. Closing the Overview records the place beneath as shown again only if it differs from the entry before.
4. **Zoom runs in main** (a command of main's own; no menu action runs there today) and **cannot be stored in `window.main`** (X2, ruled: a key of main's own). Four placements assume a CSS pixel is a window point and need the window's factor: the in-app browser's view (`ViewManager.place`), the extension popups' anchors, the bookmarks menu's anchor, and the comment pin's position (`src/main/browser/`, U12's files: insertions the root's table does not name yet). Mark up's still, the comment crop and the screencast are already scaled or page-local. The presenter's window and the repair window load the app's own origin and would inherit the zoom (probe 5).
5. **Whether Chromium keeps the zoom by itself** is not known and decides what a stay on build F shows, since F has no item that returns to 100 %. U6b-5's first step is the measurement, before any zoom code: this build at 150 %, an ordinary quit and, separately, a forced exit (a reset at quit would not run there), then build F on the profile and its factor read (X3).
6. **"One pasted block whatever its length" needs an entry the composer does not have:** since U4a a paste under 20,000 characters stays inline, and the atom's maker (`insertPasted`, `composer/editor/controller.ts`) is private. Both that entry and what follows are insertions in U4's files beyond the live region the root's table names (X8).
   **A selection for a session whose composer is not mounted is stored in that session's draft before "Added to <title>" is shown** (ruled, Decision Log 7), so a reload keeps it. The draft store can hold it: `session.drafts.get` and `session.drafts.set { draft, replaces }` exist on every route; a draft is the composer's document and its attachments, and a pasted block is a node of that document (`pastedNode`, `composer/editor/doc.ts`), built without an editor. The attach reads the stored draft, appends the block, and saves it naming the draft it replaces (the store's own guard against a writer in between, `STALE_DRAFT_WORDS`), once more if that guard refuses; the line is shown only after the store has answered. Where the store does not take it (the guard refuses twice; a message being taken back is kept, `STAGED_DRAFT_WORDS`; the session has no index row; the other machine does not answer) nothing is confirmed: the line says the selection was not added, and the selection stays in the terminal. A composer that is mounted but not on screen takes the block itself and saves at once; the line waits for that save's answer too. The in-memory intake (`queueComposerAttachment`) is not used for this. Its document's test reloads the window after the line and before the composer mounts, and finds the block in the draft. **A named question U6b-5's execution document must answer by reading the code** (ruled, Decision Log 9): can a terminal belong to a session that has not started? Such a session keeps its draft in its setup intent, not in the draft store (`useDraftPort` in `composer/Composer.tsx`), and this path does not write the intent. If the answer is yes, the attach is refused there with a sentence and nothing is confirmed; if no, the document says by what the case cannot arise. The screen's text, for ⇧⌘L with nothing selected, needs one read on the terminal's renderer interface (`terminal/renderer.ts`, `xterm.ts`, `renderer.fake.ts`).
7. **The keyboard on show and hide.** Showing asks the tab for focus on every path (switching to a tab of an open column asks nothing today), Files answers the request, and the three `surface.*` ids join `SHELL_FOCUS_ACTIONS`; hiding returns the keyboard to the composer (`focusFocused`, `composer/ComposerAppKeys.tsx`) when it was inside the column. `toggleSurface` is in `panel/SurfaceRow.tsx` (U8's: an insertion).
8. **The palette.** Artifacts are asked with `library.list`'s existing `query` on this Mac and on the machines the conversation search already asks (`searchedMachines`): nothing new is sent. "Search the Library for …" sets the Library's query in its view (`setLibraryView`); the stored destination gains no field. Hiding rows that cannot run removes the palette's table of reasons, in which U1 and U4 have entries: their tests change with it.
9. **The announcement** is a polite live region that stays mounted in the composer (U4's file: the insertion the root names), written when the mode's change has been answered, with the mode that resulted.
10. **F6** needs nothing: every region the wave added is a stop on master.

**Stored and sent.** One layout key of main's own for the zoom. Nothing sent to another machine. The six rows take no rebinding while build F can be gone back to.

**Scenes.** `e2e:layout` (`e2e/shell.spec.ts`'s palette scene, which lists every action today; `e2e/ux2-shell.spec.ts`'s menus), `e2e` (`e2e/palette.spec.ts`), `e2e:terminal`, `e2e:browser` (the placement scene at 80 %, 125 % and 200 %: probe 2), `e2e:browser-comment`, `e2e:browser-chrome`, `e2e:presentations` (probe 5), `e2e:code` (⌘[ in a file), `e2e:widgets` (⌘[ in a plugin's detail stays its own), `e2e:composer`, `e2e:lane-a`, `e2e:settings`, `e2e:cross-build` (the zoom key).

**Order.** Built on a head that holds U6b-1: decision 7's "Files answers the request" is written in U6b-1's `FilesTool.tsx` (the file's view takes the keyboard when the tab holds a file, else the tree; once U6b-3 is on the head, ⌘P's filter is its own entry and unchanged by this). It needs nothing of U6b-2 to U6b-4.

**What an executor cannot run.** Probes 2 to 5 on a Mac; probe 6 on the owner's machines; the Chromium-zoom measurement of decision 5, with its forced exit.

## What the child leaves "For U6b's design"

| what may open a file from outside the session's folders | status | what is built, and the one place a ruling changes |
|---|---|---|
| a `file://` link the transcript writes | **decided** (a technical consequence): it names its path. The transcript writes the path whole, which is the owner's rule ("Files the transcript names"); only the form was unread. It beat keeping the refusal, which would refuse the form the child's file says must open | U6b-4, decision 3 |
| a relative link | **decided**: never a name outside the folders. The rule has no folder to resolve against and the path is not written whole; resolving in the daemon against a folder that moves with the agent lost | U6b-4, decision 4 |
| a link in a tool's result drawn as "generic" | **settled**, cited: ruled on 2026-11-13 on U6c's review ("Other tool results do not count"; the child's O-37, "What opens from outside the folders"). A tool's result can carry anyone's text | stays refused; U6c's tracker row stands |
| a side question's answer; a mod's own text | **decided**: stays refused. Neither is a row of any transcript file, so the daemon has nothing to check the path against, and admitting it would be taking the window's word, which the option the owner chose excludes ("the main process checks the path against the transcript before it reads, so the window cannot ask for other files"). Inside the folders they open (U6b-4, decision 5) | stays refused |
| the agent's `show_pane` for a file | **the owner's**: card C1. The owner kept the agent's file pane ("Keep all six", 2026-11-14) and allowed a file outside the folders "when you click their link"; an open by the agent is neither a click nor refused by those words | **today's behaviour is kept until the owner answers** (ruled, Decision Log 5), and today's behaviour is this: `show_pane` opens the file's tab through the same opener as a click, and the viewer reads with `named: true`, so a path the session's transcript has named (as a link or a file chip) opens read-only, and a path it never named is refused. The call's own `target` is not a form the rule reads, so the call does not name the path by itself. The first writing's "the refusal stays" is withdrawn: refusing a file the transcript already names would change today's behaviour, and the request carries nothing that tells an agent's open from a click. Narrowing needs that mark on the read's request (a new optional key); widening needs one more value form in `chipPath` (`src/shared/files/named.ts`) |
| a link inside a rendered Markdown file's own text | **the owner's**: card C2 | today's behaviour stays: inside the folders it opens; outside them it is refused unless the session's transcript names the same path. One place: the daemon's rule, which would read the Markdown file as it reads the transcript |
| a link drawn inside a subagent's drill-in | **the owner's**: card C3 (U6c left it refused unless the session's own transcript writes the link too) | today's behaviour stays. One place: which transcript files the search reads for a session (`src/services/files/named.ts`, its locator in `src/services/spine-root.ts`) |
| "U6b's design revisits the sentence" (the instructions) | **settled**, cited: ruled on 2026-11-13, the sentence stays as the child's file words it, because it holds on every machine and an agent does not know where its reader sits | U6b-4, decision 6 |

A destination the agent writes as `maws-path:` (U6c's Decision Log 13 left it open) stays refused: it is the window's own scheme, not a form an agent is told to write.

## The cards for the owner

Four cards, in final form: the question as it can be put, the options with what each means in use, the recommended one first. C1 to C3 hold no landing: today's behaviour is built until an answer says otherwise. R8 holds the first landing's third milestone. Every name and text in the drawings is invented.

### C1 · A file the agent opens by itself, from outside the session's folders

**Question.** "The agent can put a file's tab on screen without you clicking anything. For a file outside the folders its session works in, MAWS today opens it only when the conversation already links that file, and refuses one the conversation never linked. For example: an hour ago the agent wrote a link to a report in another folder; now it opens that report for you by itself, and it opens. A file it never linked would not. What should happen when the agent opens such a file by itself?"

1. **Keep it as it is (Recommended).** A file linked earlier in the conversation opens, read-only, also when the agent opens it. A file never linked shows "outside the folders this session works in"; the agent can write the link, and your click opens it. One rule for you and for the agent: what the conversation links can be opened.
2. **Only your click opens a file from elsewhere.** When the agent opens a file by itself, a file outside the folders is refused even if the conversation links it; the link still opens when you click it. The agent can never put a file from elsewhere in front of you; you sometimes click once more.
3. **Whatever the agent names opens.** The agent can show any file on this Mac beside the chat by itself, read-only, linked or not. The fewest clicks, and files from elsewhere can appear unasked.

No drawn example is needed.

### C2 · A link inside a Markdown file

**Question.** "When MAWS shows a Markdown file, the links the file itself contains can be clicked. If such a link points to a file outside the session's folders, should it open?"

1. **No; only inside the folders (Recommended).** A link to a file inside the session's folders opens. One that points outside says the file is outside the folders the session works in (unless the conversation links the same file, which opens it as today). A file's text is not the conversation: a README from a repository someone else wrote could point at any file on this Mac.
2. **Yes, read-only, when you click it.** Any file on this Mac that a shown Markdown file links opens, read-only, on your click. Convenient for notes that point at each other across folders; a file from elsewhere can then lead you to any other.

No drawn example is needed.

### C3 · A link in a subagent's own transcript

**Question.** "When you open a subagent's transcript, a link it wrote to a file outside the session's folders is refused unless the main conversation has the same link. Should it open like a link in the main conversation?"

1. **Yes, the same rule (Recommended).** A file the subagent linked opens read-only on your click, wherever on this Mac it is. The subagent is part of this session, and what it wrote is on disk for MAWS to check exactly as it checks the main conversation.
2. **No; only what the main conversation links.** A subagent's link to a file outside the folders stays refused until the main conversation links the file too. Narrower, and you may have to ask the agent to repeat a link you can already see.

No drawn example is needed.

### R8 · The file list beside a file, when the side column is too narrow for both

**Question.** "A file beside the chat has the Files list at its left. When the side column is too narrow to show both, the list folds away and a button in the file's bar brings it back. Where should the list appear when you press that button in a narrow column?"

Before, in every option (the narrow column, the file alone; `[=]` is the button, `[->]` is "Move to main area"):

    +--------------------------------------+
    | notes.md | report.md | Review     +  |
    +--------------------------------------+
    | [=] docs/notes.md       [->] [Wrap]  |
    +--------------------------------------+
    |  1  # Notes                          |
    |  2                                   |
    |  3  First point about the plan.      |
    |  4  Second point, a longer line      |
    |     that wraps here.                 |
    |  5                                   |
    +--------------------------------------+

1. **In the file's place (Recommended).** The list takes the whole tab; choosing a file, or pressing the button again, shows the file. Nothing overlaps and nothing else on screen moves; you see the list or the file, never a sliver of each.

        +--------------------------------------+
        | notes.md | report.md | Review     +  |
        +--------------------------------------+
        | [=] Files                            |
        +--------------------------------------+
        |  v project                           |
        |    v docs                            |
        |      > notes.md                      |
        |        report.md                     |
        |    > src                             |
        |      README.md                       |
        +--------------------------------------+

2. **Over the file.** The list slides over the left part of the file and goes away when you choose a file or click outside it. You keep the file in sight behind it, cut off; one more thing floats over another.

        +--------------------------------------+
        | notes.md | report.md | Review     +  |
        +--------------------------------------+
        | [=] docs/notes.md       [->] [Wrap]  |
        +----------------------+---------------+
        |  v project           | otes          |
        |    v docs            |               |
        |      > notes.md      | point about   |
        |        report.md     | d point, a l  |
        |    > src             | wraps here.   |
        |      README.md       |               |
        +----------------------+---------------+

3. **The column widens.** Pressing the button makes the side column wide enough for both, taking the room from the chat, and it stays that wide. You always see both; the chat gets narrower each time you ask for the list in a narrow column.

        +---------+----------------------------+
        | ...chat | notes.md | Review       +  |
        | two     +----------------------------+
        | files   | [=] docs/notes.md    [->]  |
        | were    +-----------+----------------+
        | written | v project |  1  # Notes    |
        |         |  v docs   |  2             |
        |         |   > notes |  3  First poi  |
        |         |     repor |  4  Second po  |
        | [write] |  > src    |  5             |
        +---------+-----------+----------------+

The drawings are the drawn example; each is 40 columns wide.

## Points reported to the architect, and ruled

Each was reported with a default and one place a ruling would change. The rulings of 2026-11-14 (UTC) are in the fourth column and in the Decision Log; each landing's document builds what is ruled. The first landing's own points (R1 to R9) are in its document.

| # | The point | Evidence | The ruling | The one place |
|---|---|---|---|---|
| X1 | **An HTML file by a path can reach a relay over TCP, as an HTML artifact can today.** `disable_non_proxied_udp` is set on the window; the dead proxy that closes the relay over TCP is the first Office preview landing's (the tracker's row of 2026-10-06). | `spikes/viewer-frame/FINDINGS.md`; `guardFrames`, `src/render/policies.ts` | **Accepted:** U6b-2 draws HTML as the child's file says, and the tracker's row names the file frame beside the artifact frame until the proxy lands | `framedKindOf` |
| X2 | **The zoom cannot be "kept with the window's saved bounds".** Build F parses `window.main` strictly and falls back to a centred default window on any extra field. | `WindowStateSchema`, `restoreWindowState` at `f1852de3a` | **Accepted:** a key of main's own, `window.zoom`, which F keeps and never reads | the key's name in U6b-5's document |
| X3 | **Whether Chromium itself keeps a window's zoom across a relaunch.** If it does, a stay on build F after a zoomed session shows F zoomed, with no item to undo it. | not measured; F has no zoom items | **Accepted, and the measurement includes a forced exit** (a reset at quit does not run there): this build at 150 %, an ordinary quit and a forced exit, build F on the profile, its factor read. Zoom is built only once the answer is known | U6b-5's first step |
| X4 | **The Overview as a place.** The child's file lists it among the places; in the code it is a dialog over the strip. | `overviewOpen`, `overview/OverviewPanel.tsx` | **The child's file is built:** the Overview is a place. A recorded visit is restored as the Overview shown over the place beneath it (U6b-5, decision 3). The first writing's default (not a place) is withdrawn | U6b-5, decision 3 |
| X5 | **What a relative link is relative to.** The child's file says the working folder (UC-4), which is the checkout; an agent that has moved into a subfolder writes paths relative to that folder. | `useWorkingFolder` answers `path` and `cwd` | **The working folder, as the child's file says** | `resolveRelative` in `tools/code/open-file.ts` |
| X6 | **A block attached for a session whose composer is not on screen** "waits in that session's draft" (the child's file); the intake that exists keeps it in the window's memory. | `queueComposerAttachment`, `stores/composer.ts`; `session.drafts.get` and `.set` | **The draft, before the confirmation:** the text is stored in that session's draft before "Added to …" is shown, so a reload keeps it; a test reloads before the composer mounts; nothing that can be lost is confirmed. The draft store can hold it (U6b-5, decision 6). The first writing's default (the in-memory intake) is withdrawn | U6b-5, decision 6 |
| X7 | **Two refusals outside the child's table.** `host_unavailable` and `timeout` for a session on this Mac; `grade` for a session with no signed listing. | `refusalError`, `src/main/machines/remote/dispatch.ts`; `listed` in `stores/sessions.ts` | **Accepted:** "MAWS's service on this Mac is not answering." with Retry; and for the unknown owner the table's last row, "This file could not be opened.", with Retry | the classifier in U6b-4's document |
| X8 | **Insertions the root's UC-8 table does not name yet.** U13's `stores/layout.ts` and `stores/layout-model.ts` (U6b-1: the pin's gate in `setPanelTabPinned`, hydration's call to the repair of file tabs and the repair itself, the ordered flush of a move's stored writes, the drag state's type; `reopenClosed` is authorised and not needed, its one caller being U6's own handler); U8's `panel/SurfaceRow.tsx` (U6b-1: the tab the Files icon's "Keep open for every session" acts on; U6b-5: the keyboard on show and hide), `panel/tool.ts` and `panel/host.ts` (U6b-1: `PanelTool.reuse` and its one question in `applyAdd`, so that a tree-only add never makes a second tree-only tab), `panel/PanelRegion.tsx`, `panel/PanelHost.tsx` and `panel/summary/Sources.tsx` (U6b-1); UC-15's `src/shared/maws/tools.ts` (U6b-1: the error text `paneNotReady`); U5's `side/ThreadView.tsx` (U6b-1) and `side/BtwView.tsx` (U6b-4); U12's `src/main/browser/` (the zoom's factor at four placements); U4's composer (the pasted-block entry and the draft's write, beyond the live region); U9's `remote-unavailable.ts` ("Open in"); `src/services/files/` (the raw, versioned read; the listing's `ignored`; the admit read); UC-3's `Link.tsx` and `view/context.tsx` (⌘ on a path link and on a web link). | each landing's section | **Accepted, with the pin and the history insertions added:** each is the smallest insertion; the table gains them in the spec's next batch | the root's table |
| X9 | **The child's file says U6b is one pull request** ("then U6b (#592), the rest"), and the preview design counts "U6b's part" as one landing. | the child's Edges, "Blocks"; the preview design's section (c) | **Accepted:** five landings; the Word preview waits for U6b-1 and U6b-2 | the child's "Blocks" paragraph and the board |

## What the previews consume

The design of the Word, PowerPoint and Excel previews (outside the repository) builds on U6b. By name, and from which landing:

- **The tab's host element:** `FileBody` in `tools/code/viewer/FileViewer.tsx` and its `Body` switch on the entry's kind. U6b-1 keeps it the one component for a file's body in a side tab, a main tab and the File artifact's view, so a preview drawn there appears wherever a file appears, beside the chat included.
- **The place a format is recognised:** `kindOf` in `tools/code/viewer/kinds.ts`, called by the viewer store with the name, the type, the size and the encoding of the first read. U6b-2 adds the kind `frame` there; an `office` kind joins it in the same function.
- **The admission rule:** what `files.read` reads for the session on its machine. The previews read their bytes through `files.read` in the window and so take the rule whole.
- **The route:** `maws-artifact://<token>/file`, issued by main for one mount of one file (U6b-2). The previews do not use it: their libraries take bytes, not a URL, and their page is served on a scheme of its own. They share with it only the policies' file.

Where that design's expectations of U6b differ from the child's file, the child's file governs. Three differences, all ruled in X1 and X9: it counts U6b's part as one landing; it lists `src/main/csp.ts` and `src/render/policies.ts` among the files U6b's part edits, and under the token host neither is edited (their tests gain cases); and it expects the tracker's row of 2026-10-06 to close with its own proxy, before which U6b-2 adds the file frame to that row. Nothing of the Office viewer is built by U6b: no session proxy, no guard on the window's session, no `maws-viewer:` scheme.

## Build F, landing by landing

Build F is `f1852de3a`. Neither settings file changes in any landing.

| landing | stored | sent | wire minor |
|---|---|---|---|
| U6b-1 | several Files tabs in `panel.<session>`, `{ file, line, preview? }` under `panelTools.params`, the new key `files.tree`: F draws its one Files surface and keeps all three through its writes (the first landing's Interfaces §A) | nothing | none |
| U6b-2 | nothing | `files.read` to this Mac's daemon with one new optional input (raw ranges) and one new optional field in its answer (the file's identity); to another machine's as today | one |
| U6b-3 | nothing | one optional field on `files.list`'s entries: an older daemon omits it, F's window drops it | one |
| U6b-4 | nothing | one new read of the daemon's: a daemon of F answers "unknown command" and nothing opens | one |
| U6b-5 | one key of main's own for the zoom, which F keeps and does not read (X2, X3) | nothing | none |

Every row a landing adds to the action table takes no rebinding while F can be gone back to (UC-6), so no landing writes an action id F does not know into the settings.

## Surprises & Discoveries

- Observation: the store's scheme handler follows links, and main has no files service of its own; a route that reused the handler with a session's path would not have `files.read`'s guarantee.
  Evidence: `createSchemeHandler` opens with `O_RDONLY | O_NONBLOCK`; `files.read` opens with `openNoLink` and confirms the descriptor (`src/services/files/service.ts`); `registerFilesHandlers` runs in the daemon (`src/services/checkouts-root.ts`).
- Observation: several of the child's "Today" statements are overtaken: a new terminal already starts in the working folder (U8a); F6 already stops at the page and at each side group's strip and body (U7b, U8b); probe 9 is closed (U8c-2).
  Evidence: `ensureTerminal` in `tools/terminal/index.ts`; `regionStops` in `keymap/shell-navigation.ts`.
- Observation: a path chip in a side question's answer and in a mod's pane does nothing at all today.
  Evidence: `side/BtwView.tsx` mounts its Markdown with no file action; the default is a no-op (`transcript/view/context.tsx`).

## Decision Log

1. **2026-11-14 (UTC) · The verification call.** This document and the first landing's get an adversarial review before an executor starts (the architect dispatches it). Each landing's branch gets the `doperpowers:review-code` rung "The cut" names; class 1a on GitHub Actions is each landing's gate of record.
2. **2026-11-14 (UTC) · The owner's answers this cut rests on.** On a link to a file outside the folders (2026-11-13): "Files the transcript names (Recommended)" and "Own small landing, now (Recommended)". On what the agent may still open by itself (2026-11-14): "Keep all six (Recommended)". Typed on 2026-11-14: "MAWS preview shouldn't be limited to PDF, and agent's artifact mention opens in the side panel." The newest answer on a point wins.

3. **2026-11-14 (UTC) · Ruled on the adversarial review.** Nine findings over the two documents, each checked by the architect in the cited code, all accepted. The cut into five landings (U6b-1 to U6b-5) is accepted as written. The five findings on the first landing are in its Decision Log (2 to 5).
4. **2026-11-14 (UTC) · Ruled: U6b-2's route.** `files.read` stays the admission rule. Not inherited from it, and settled by U6b-2's execution document: exact byte ranges for every kind (a raw read that never re-cuts or decodes: a new optional input, and so a wire minor); one version identity held across the ranges of one served file, files over the hash cap included, the response ending in an error when it changes; the type and the frame's policy fixed when the token is issued; recovery for a file with no watch. Also: who issues and releases a token, per window and per Electron partition; a wrong owner's use or release refused; the capture and render-host partitions proven to serve no token. Tests named: bytes that are not valid UTF-8, a range across a character boundary, a same-size replacement between two ranges.
5. **2026-11-14 (UTC) · Ruled: card C1.** Until the owner answers, today's behaviour is kept, and the document says exactly what it is: a path the transcript has named opens, one it never named is refused. "The refusal is built until answered" is withdrawn: it would change today's behaviour, and the request carries nothing that tells an agent's open from a click. The card asks whether to keep, narrow or widen. Cards C2 and C3 are handed over in final form.
6. **2026-11-14 (UTC) · Ruled: X4.** The child's file names the Overview as a place, and the child's file is built: a recorded Overview visit is restored as the Overview shown over the place beneath it.
7. **2026-11-14 (UTC) · Ruled: X6.** A terminal's selection for a session whose composer is not mounted is stored in that session's draft before "Added to …" is shown; a test reloads before the composer mounts; what can be lost is not confirmed.
8. **2026-11-14 (UTC) · Ruled: the rest.** X5: the working folder, as the child's file says. X1, X2, X7 and X9 accepted; X3 accepted with a forced exit in its measurement; X8 accepted with the pin and the history insertions added. U6b-5's "no code of U6b-1" is corrected: it is built on a head that holds U6b-1. This document revised once, in place, to these rulings.

9. **2026-11-14 (UTC) · Ruled on revision 2's four points; one amendment.** The first landing's Decision Log 10 holds the three that are its own (the fourth way to pin and `PanelTool.reuse`; Reopen closed tab as found; `paneNotReady`). Here: the unstarted session's draft is a named question U6b-5's execution document answers by reading the code; X8 gains `panel/host.ts`, `panel/tool.ts` and `src/shared/maws/tools.ts`. The four cards are accepted as written and go to the owner. Ticket 662 landed on master meanwhile (pull request 669), which U6b-2 waited for.

## Outcomes & Retrospective

Pending — written at finish.
