# UX wave · U6, the second landing of U6b (U6b-2): a PDF, an HTML file and media drawn by a path

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*), the second of the five landings U6b is cut into (**U6b-2**). **The cut:** `docs/doperpowers/plans/2026-11-14-ux-wave-U6b-cut.md`, cited below as *the cut*: its section "U6b-2 · a PDF, an HTML file and media by a path", its Decision Log 3 to 8 and its table rows X1 and X9. **Parent pin:** `281ef5a6c0b73f7bfa116879e541c1fbbe1b6278`, the head of U6b-1 (a file opens beside the chat), which holds master `ef1d659ad`; every statement about the code below was checked against it, and the root, the child's file and the register are read at it.
>
> **The design** is the child's file, item "O-37 · a linked file opens in MAWS, and a refusal says why", paragraph "PDF, HTML and media are drawn in the app", with the PDF half of acceptance A5; and the cut's section, which fixes the route. This document builds that design and does not reopen it. It carries the constraints, what the cut left to this document (the four guarantees `files.read` does not give a frame, the token's owner, the sequences), the milestones and the interfaces. Where the code at the pin contradicts a sentence of the cut, the point is in "Reported to the architect" with the default this document writes and the one place a ruling changes.
>
> **Branch:** `ux-wave/U6b-2`, from `281ef5a6c`. **Board:** ticket 671, under ticket 592. **Not in this landing:** the notices' words, `file://` and relative links, "Open in" (U6b-4); Files' Changed group and Go to file (U6b-3); the keyboard (U6b-5); Word, PowerPoint and Excel; any change to which files a session may read.

## Purpose

Today a PDF, an HTML page, a video or a sound that a session's file path names is not drawn in MAWS: its tab shows "PDF files open outside MAWS" and a button, while the same kinds delivered as artifacts are drawn in the app. The debt tracker has held the difference since 2026-10-08.

After this landing such a file is drawn in its own tab, beside the chat or in the main area, by the frames artifacts already use: Chromium's PDF viewer, a sandboxed frame for an HTML page, the media player. No artifact is made, so a click writes nothing to the Library. "Open externally" stays in the file's bar. It holds on every route: for a session MAWS runs and for a terminal session on this Mac the bytes are read by the daemon's files service at every request; for a session on another machine the file is copied here by the read "Open externally" already uses and drawn from the copy, up to 64 MiB.

How to see it working: in a session, click a path link to a PDF inside the session's folder. The PDF is drawn at the right of the chat, the transcript has not moved, and the Library holds nothing new. Click a `.html` file in Files' tree: the page is drawn and its inline script has run; a page that needs a stylesheet beside it is drawn without that style, and "Open externally" in the bar hands the file to the system. Click a video: it plays and seeks. Change the PDF on disk: the tab draws the new one.

The route that serves these bytes is the delicate part (root UC-10): a frame loads `maws-artifact://<token>/file`, a URL that names no path, and main answers it only after the files service has read that file for that session, at every request. A PDF and an HTML page by a path need not have been written by the session's agent (a file of a cloned repository), so this document states, per kind, what a hostile file can and cannot do and which test and which scene on a Mac shows each.

## Progress

- [x] (2026-11-15) Document written against `281ef5a6c`: the cut's section checked sentence by sentence in the code at that head; the two builds that bind read (`git show 2c7044231:…`, `git show f1852de3a:…`); Electron 44.4.5's typings read on the build VM for what a scheme handler is told of its request; Claude Desktop `app-5.1231.2` read for how it draws the same kinds; the branches in flight read for the files they share with this landing.
- [ ] The adversarial review of this document, and the architect's rulings on the points reported.
- [ ] The owner's answers on the four cards ("The cards for the owner"). None holds a milestone: each has a built default.
- [ ] M1 — Spike: Chromium's PDF viewer on a token URL, and who asks.
- [ ] The spike's run on a Mac (the architect's), and the ruling on R1 and R4 at its verdict. **A real stop: M4 does not start before it.**
- [ ] M2 — The raw read: exact ranges and one version; the wire's minor.
- [ ] M3 — The tokens, the byte sources and the responder.
- [ ] M4 — The commands, the owner's check and the partitions.
- [ ] M5 — The window: the kind, the entry's frame, the bar.
- [ ] M6 — The scenes, the cross-build row, the record, and the acceptance run.
- [ ] The proof an executor does not run: the scenes and their groups on a Mac, the two cross-build runs, the Mac lane's unit cases, class 1a, the branch's panel review, the owner's look, the pull request.

## Words used in this document

- **Session** always means a MAWS session (an agent's conversation with its folders). An Electron session, the browser-side store of cookies, handlers and filters that a window belongs to, is called a **partition**: the app windows use Electron's default partition; captures use `maws-capture` (`CAPTURE_PARTITION`, `src/render/capture.ts`); the render host is a separate process with partitions of its own.
- **The daemon** is `mawsd`, the per-Mac background process that runs the machine's services; the files service (`src/services/files/`) runs in it. **Main** is the Electron main process of the app; it has no files service and reaches the daemon's through the router (`invokeOwn`, `src/main/ipc/router.ts`).
- **The store's scheme** is `maws-artifact:`, registered once as a standard, secure, streamed scheme with no fetch (`registerStoreSchemes`, `src/render/scheme.ts`). Today its host is always an artifact's id (a UUID). **A store frame** is a frame whose URL has that scheme.
- **A framed kind** is one of `pdf`, `html`, `video`, `audio`. **The frame** of a file is what draws it: an `<iframe>` for a PDF or an HTML page, a media element for the other two.
- **A token** is 32 lower-case hexadecimal characters that main draws at random and uses as the host of a URL, `maws-artifact://<token>/file`. **A token host** is a URL host of that shape. Main holds what a token stands for; the URL holds nothing else.
- **A raw read** is a `files.read` that answers the bytes of exactly the range asked, never decoded and never re-cut. **The identity** of a file, as a raw read answers it, is a string made from what the opened descriptor knows (device, inode, size, modification time, change time); two reads that answer the same identity read the same version of the file.
- **A viewer entry** is the record the window keeps per open file (`ViewerEntry`, `src/renderer/src/tools/code/viewer/viewer-store.ts`), under the key a main tab of the file has (`fileKey`, `file:<machine>:<path>`). U6b-1 keeps an entry while any tab holds its file, in view or not, and across a move.
- **A watched file** is one inside the session's folders: the entry holds a watch on its folder and reads again on `files.changed`. **A named file** is one outside the folders that the session's transcript names (U6c): no watch follows it, and it is read again by `revisit`, when its tab is shown again or its link is clicked again.
- **Build F** is `f1852de3a` (root UC-14) and **build M** is master `2c7044231`: the two earlier builds a profile that runs this landing may have run before, or may be taken back to. Whatever this landing sends is stated against both.

## The landing's edge

**In.**

- The kind `frame` for a file whose type is PDF, HTML, video or audio, decided from the type the files service answered, and its drawing in the file's tab wherever a file's tab is (beside the chat, in the main area).
- The raw read of the files service, with the identity in its answer: one optional input and one optional answer field of `files.read`, and so one wire minor.
- Main's route: the tokens, the two commands that issue and release one, the event that says a response ended in an error, the responder on the app windows' partition, the check of the asking window, the copy for a session on another machine and its removal.
- "Open externally" in the file's bar for a drawn file.
- A video's or a sound's position kept across a move and a hide.
- The record: the tracker's row of 2026-10-08 closed; the row of 2026-10-06 naming the file frame beside the artifact frame (the cut, X1); the cross-build coverage table's row.

**Not in, and a later landing of U6b:** the words of a refusal and of the row a file keeps (U6b-4; this landing changes one sentence of no notice and adds one, "The sentences a person reads"); a `file://` link and a relative link (U6b-4).

**Not in, and nobody's.**

- A Source view of an HTML file (card 1 asks).
- Drawing a framed file larger than 64 MiB from another machine, or any file a session's read refuses today.
- A page's neighbouring files: an HTML page that needs a stylesheet or a script beside it is drawn without them (the child's file).
- A change to `STORE_FRAME_CSP`, to the sandbox of the HTML frame, or to any existing predicate of `src/render/policies.ts`.
- The dead proxy that closes a relay over TCP (the first Office preview landing's; the cut, X1).
- The frames of an artifact: `ByteViewer` draws them as it does today.

## What this document assumes of landings in flight

One list, to be read again when this document's branch meets each on master. Each line says what this landing does when the assumption holds, and the one place that changes when it does not.

| landing | what it changes that this landing meets | what this document assumes, and the one place |
|---|---|---|
| **U6e** (`origin/ux-wave/U6e` at `a5fe86761`: outside files editable, Open File…) | `files.read` gains the input `agent` and the answer fields `outside` and `own` (`src/shared/ipc/schema/files.ts`); `read`, `precheck` and `readOpened` of `src/services/files/service.ts` are reworked for grants; the viewer's `readChunk` sends `agent` for a tab the agent opened; the file's bar is regrouped in `FileViewer.tsx` and `OpenExternally` takes `agent`; `src/main/ipc/router.ts` gains a guard; `src/shared/ipc/schema/layout.ts` gains commands; it takes a wire minor | The route asks `files.read` with the keys the entry's own reads carry. At the pin that is `named` alone. When U6e is on the branch, `agent` joins it for an entry that holds the agent's mark, `layout.frameFile`'s input gains `agent: z.literal(true).optional()`, and the bar's `OpenExternally` of a drawn file passes `agent`. **One place:** `frameAsk(entry)` in the viewer store and `FrameAsk` in main (Interfaces §D, §E). A file U6e's grant admits is drawn with no edit here, because the admission is `files.read` itself. The raw branch sits in `readOpened`, after everything U6e adds to the admission; the conflicts in `service.ts`, `files.ts` and `wire.ts` are textual. |
| **U10b-2** (`origin/ux-wave/U10b-2`: an agent's delete and its Undo) | `src/renderer/src/artifacts/host.ts`; a wire minor; `e2e/cross-build.spec.ts`, `e2e/remote.spec.ts`, the tracker | No file of this landing's design. The wire's number and the two scene files meet as text. |
| **U5b** (`origin/ux-wave/U5b`: Review as one scroll) | `src/renderer/src/tools/code/copy.ts` (Review's words), `e2e/code-tools.spec.ts` | This landing adds one key to `VIEWER_COPY` and changes the PDF scenes of that spec; neither meets Review's. |
| **U1b** (`origin/ux-wave/U1b`) | `e2e/cross-build.spec.ts`, `e2e/remote.spec.ts`, `src/renderer/src/panel/SurfaceRow.tsx` | Text only. |
| **The chain's wire minors** | master holds 48; three landings ahead in the chain take 49 to 51 | This branch writes the next free number at its own head and the architect takes it again at the chain merge (M2, decision 6). |

## Reported to the architect

Each point has the default this document writes and the one place a ruling changes. None is resolved here beyond its default.

| # | The point | Evidence | The default written | The one place |
|---|---|---|---|---|
| **R1** | **The responder cannot tell which window asks.** The cut says the responder "serves a token only to a request from the window it was issued to", and that no predicate of `src/render/policies.ts` is edited. Under Electron 44.4.5 a scheme handler is given a `Request` and nothing of its sender: no web contents, no frame. The one addition is `request.initiatorOrigin`, an origin, which is the same for every app window. The asking window is known only to the partition's request filter, `installFramePolicies`, the one `onBeforeRequest` listener, whose details carry `webContentsId` and `frame`. | `node_modules/electron/electron.d.ts` at 44.4.5, read on the build VM: `handle(scheme: string, handler: (request: GlobalRequest) => …)`, and `OnBeforeRequestListenerDetails { webContentsId?: number; frame?: WebFrameMain \| null; initiatorOrigin?: string; … }` | The ruled guarantee is kept and enforced where the window is known: one new pure predicate, `shouldCancelForOwner`, and one optional argument of `installFramePolicies`, consulted first. No existing predicate changes. The responder still answers 404 to a token it does not hold. The other reading (ownership at issue and release only, a token being unguessable and never told to another window) would leave "a use from another window is refused" without a truthful test. | Interfaces §D, "The owner's check" |
| **R2** | **The window's policy admits the scheme for more than media.** The cut's table says of a media file: "the window's policy admits the scheme for media alone". `PRODUCTION_CSP` names `maws-artifact:` for `img-src`, `font-src`, `frame-src` and `media-src`. What holds, and what the proof needs, is that `script-src` and `connect-src` do not name it: the window's document can show a token's bytes as a frame, an image, a font or media, and can neither run them nor fetch them. | `src/main/csp.ts`, `directives` | The security table says that, and `src/main/csp.test.ts` gains the case "admits the store's scheme where bytes are shown, and nowhere a script runs or a page fetches". | "What a frame can and cannot do", the media row |
| **R3** | **An event the cut does not name.** The cut gives main two commands. For "what the tab then shows" after a response ended in an error, the window has to learn that it did: a frame of another origin reports no failed load to the page that holds it. | `PdfFrame.tsx`, `HtmlFrame.tsx`: an `<iframe>` has `onLoad` only | A third name of main's own, the event `layout.frameFailed { token }`, sent to the owning window's page alone (`emitTo`, `src/main/ipc/events.ts`). Outside the wire's manifest, as the commands are. | Interfaces §D |
| **R4** | **What a PDF's own script and actions can do is not in the cut's table.** PDFium runs a document's JavaScript and acts on its actions (an alert, a print request, a form's submit, a launch, a go-to in another file). The table covers navigation, download, permissions and requests. A stored PDF artifact has had the same frame since E2; what is new is that a PDF by a path need not be the agent's. No source in the repository says what Electron does with each. | `PdfFrame.tsx`: no `sandbox`; `src/main/window.ts`: `plugins: true`; nothing under `src/` names PDF script | Not decided by reading. M1's spike measures each (table "What the spike measures") and the ruling follows its verdict. The default built is the stored PDF's frame unchanged, with one tracker row per behaviour the spike finds reachable. If a native dialog, a print dialog or a launch is reachable without the person's click, that is a stop before M4. | M1; the security table's PDF row |
| **R5** | **A terminal session on another machine.** A5 names "each on another machine". At the pin `files.read` is offered by another machine's endpoint for a session MAWS runs there (`laneBMachine('call')`, `src/endpoint/offers.ts`), and a session id that is not such a session is placed `unknown` and refused `grade`. So for a terminal session on another machine the viewer's first read is refused, the entry is an error before any kind is known, and no frame is asked for. This landing changes nothing there, and cannot draw what is not read. | `src/endpoint/offers.ts`, `src/endpoint/targets.ts` (`laneB`); not run | The routes table says so. If the architect knows a route by which such a session's file is read today, the frame follows it with no edit, since a frame is asked only for an entry whose read succeeded. | "Routes" |
| **R6** | **The size.** The cut counts about 2,400 changed lines over 34 files. Counted from the code with every refusal a named test: about 4,300 over about 55 files, and a spike of about 500 lines beside them ("Size and review"). The part that could be cut off is the route's copy for another machine (about 420 lines with its scene); cut off, a framed file of another machine would keep today's row for one landing, which breaks "on every route". | "Size and review" | One landing, six milestones, as the cut's edge says. | "Size and review" |
| **R7** | **The spike runs Electron.** No Electron runs on the MacBook. M1's harness is run by its executor on the build VM under `xvfb-run`, as the viewer-frame spike was (`spikes/viewer-frame/FINDINGS.md`, "Linux"), for a first reading; the run of record is on a Mac and is the architect's. If an executor may not run Electron on the VM either, M1 ends at the pushed harness and the architect runs both. | the build brief; `spikes/viewer-frame/FINDINGS.md` | The executor runs it on the VM. | Concrete Steps 5 |
| **R8** | **Small corrections of the cut's sentences, none changing the design.** (a) "Open externally kept in the bar": at the pin the button is in the row, in the file's body, and in the bar only for a text shown as a bounded head; for a drawn file it moves into the bar. (b) "its service refuses the key for a remote caller": the service does not refuse `named` from a remote caller, it answers the plain read without asking the transcript (`nameAdmits`, `service.ts`); `raw` is treated the same way. (c) A main-owned command that names a session on another machine is refused by the router unless it is listed (`SAVED_HERE_FOR_ANY_MACHINE`, `src/main/ipc/router.ts`): `layout.frameFile` joins that list, an insertion the cut does not name. (d) "A token is released when its viewer entry goes": since U6b-1 an entry lives while any tab holds its file, in view or not, so a token lives as long as its tab. | the files named | Built as stated here. | Interfaces §D, §E, §G |

Every other sentence of the cut's section about the code was read again at the pin and holds: main has no files service and the store's handler follows links (items 6 and 9 of "What the code holds today"); every reader of an artifact's id refuses a token's shape (item 7); `kindOf` is called with the name, type, size and encoding of the first read, and `FileBody` is the one body of a file in a side tab, a main tab and the File artifact's view (items 1 and 2, after U6b-1's rewrite of the Files tool); `fetchToFile` proves a copy byte for byte or refuses (item 11); ticket 662's switch is on the branch (item 13); the scenes the cut names exist under the names it gives (`e2e/code-tools.spec.ts`, "a PDF is an Open externally row"; `e2e/sessions.spec.ts`, U6c's scene; `e2e/remote.spec.ts`, the step on a page of the other machine).

## What the code holds today

Read at `281ef5a6c`. Paths under `src/renderer/src/` are written from `tools/`.

1. **Where a format is recognised.** `kindOf` (`tools/code/viewer/kinds.ts`) answers `'code' | 'markdown' | 'image' | 'external' | 'head'` from the name, type, size and encoding of an entry's first read. `externalKindOf` sends `application/pdf`, `text/html`, `audio/*` and `video/*` to the row (`ExternalRow.tsx`), which reads "PDF files open outside MAWS", the size, and "Open externally" where `opensExternally(path)` holds. An `external` entry reads nothing past its first chunk.
2. **The viewer.** `FileBody` (`tools/code/viewer/FileViewer.tsx`) is the one component that draws a file's body, in a side tab (`FilesTab` in `tools/code/files/FilesTool.tsx`), in a main tab and in the File artifact's view (`DrawnFile` in `tools/artifacts/viewers/ByteViewer.tsx`, which is reached only for a name `bodyOf` types as none of the framed kinds). Its `Body` switches on the entry's kind; its bar holds the notices and `Controls`.
3. **What is mounted.** The side column draws the body of one tab per group (`PanelHost.tsx`, `ToolBody` keyed by the tab in view); a pane draws its active tab. A tab not in view has no body mounted. Its viewer entry stays (U6b-1: `prune` keeps every key a side tab holds, and `holdKey` keeps a key across a move). The store drops an entry when no tab holds its file (a close, a reuse of the preview tab for another file), and past 20 entries the least recently used ones that are not mounted.
4. **Reading again.** A watched entry reads again on `files.changed` (`applyChanged`); a named entry or a failed one reads again when it is mounted again or opened again (`revisit`, `revisitable`). A re-read of an `external` entry lands after an event and is taken as unchanged on a revisit when type and size are the same (`sameUnhashed`).
5. **The artifact frames.** `PdfFrame` is an `<iframe>` with no `sandbox` attribute; `HtmlFrame` is `sandbox="allow-scripts"` with `referrerPolicy="no-referrer"` and four optional bridges (pick, locate, the connector port, the console clear) that do nothing unless passed; `Media` is a `<video>` or an `<audio>` with `controls` and `preload="metadata"`, a video under a zoom bar of its own (`tools/artifacts/viewers/frames/`). Three listeners in the window read `message` events: `windowDocPorts` (only a message whose source is the window itself) and two in `HtmlFrame` (only while picking, or while a locate is asked).
6. **The store's handler** (`createSchemeHandler`, `src/services/artifacts/scheme/scheme-handler.ts`) opens the path its resolver names with `O_RDONLY | O_NONBLOCK`, follows links, and answers `nosniff`, `inline`, `no-store`, `Accept-Ranges`, a 206 for one `bytes=` range, and `STORE_FRAME_CSP` on every answer but a PDF's. `rangeOf` there is module-private.
7. **Main's chain** (`startArtifacts`, `src/main/artifacts/index.ts`): one handler for the default partition and the capture partition alike: the presenter's embeds, the remote responder by placement, then this Mac's store (the daemon's artifact endpoint while its welcome lists it, else main's files), then the remote responder by referrer after a local 404. Every one of them reads an artifact's id with a UUID test (`parseArtifactUrl`, `artifactIdOfUrl`) and answers null or 404 for any other host.
8. **Main's policies** (`src/render/policies.ts`) key off the prefix `maws-artifact://`. `installStorePolicies` installs the request and download filter on both partitions before the first window loads (`src/main/app.ts`); `guardFrames` and `guardWindowNavigation` are installed per window (`src/main/window.ts`). The render host installs the same filter on its own capture partition and proxies the scheme to the daemon (`src/render-host/root.ts`).
9. **`files.read`** (`src/services/files/service.ts`). `precheck` settles the roots and, for a request with `named` from this machine, asks whether the transcript names the path; `openNoLink` opens with no link anywhere on the way; `confirm` confirms the descriptor under a root; `readOpened` reads. A text type is answered as `utf8` text settled to a character and line-break boundary (`settleText`); another type as `base64`. One call reads at most 8 MiB. A hash is answered only when asked and only up to that size. For a caller on another machine (`context.remote`) the roots leave out the machine's home and `named` is not asked. A remembered answer of the transcript's search is proven again from its row at every use (`src/services/files/named.ts`), so a repeated read of a named file costs one short read of the transcript, not a search.
10. **Across builds.** A daemon reads its inputs with the tolerant reader (`readTolerant`, `src/shared/ipc/tolerant.ts`): a key it does not know is dropped and the rest is validated strictly. Main reads a daemon's answers the same way. `WIRE_MINOR` is 48 at the pin, 46 on build M, 33 on build F. Build M's `files.read` knows `named`; build F's does not.
11. **A file of another machine.** `fetchToFile` (`src/main/lane-b/remote-copy.ts`) pages `files.read` over the machine's link into a file, up to a maximum, written beside its final name and renamed over it; a file sent as text is copied only when its bytes are proven, else refused with `notByteForByte`. "Open externally" there is `remote.openCopy`, which keeps its copy under `<temp>/maws-remote-copies/`. The link is found by `deps.remote(machine)` in `src/main/lane-b/remote-artifacts.ts`.
12. **Who asks main.** The router accepts a command only from the top frame of an app window at the app's origin (`isAppSender`); a handler is told the asking page as `ctx.client`, a `ClientRef` that ends when the page is destroyed, crashes or navigates its main frame (`src/main/ipc/clients.ts`), and `pageOf(client)` answers its web contents.
13. **Ticket 662** is on the branch: `STARTUP_BLINK_SETTINGS` holds `dnsPrefetchingEnabled=false` and `setBlinkSettings` appends it before the app is ready (`src/main/chromium-features.ts`).

Tests that pin today's behaviour and change: `tools/code/viewer/viewer.test.tsx` (the kinds table; the four cases that find "PDF files open outside MAWS"); `tools/code/viewer/ExternalRow.test.tsx`; `src/services/files/service.test.ts` and `src/shared/ipc/schema/files.test.ts` (gain cases); `src/render/policies.test.ts`, `src/main/csp.test.ts`, `src/main/artifacts/index.test.ts` (gain cases); `src/shared/ipc/routes.test.ts` and `src/shared/machine/coverage.test.ts` (their snapshots); `src/shared/ipc/wire.test.ts` (the manifest). E2e: "The e2e groups whose scenes cross this change".

## How Claude Desktop draws the same files, and where MAWS differs

Read in `readable/app-5.1231.2/` (law 1).

- **A PDF** is drawn by Chromium's own viewer in a native view of its own, on a partition of its own, loading `cowork-file://preview/<path>`: the scheme and partition at `main-process/index.chunk-BV3uOqbK.js:294608` and `:294610`, the view's preferences at `:375050`, the handler at `:294707`, its per-answer policy (none of `sandbox` for a PDF) at `:294753`.
- **An HTML file** is drawn in a sandboxed `<iframe>` whose page is served from the vendor's own remote origin, and the file's text is posted into it: `web/app/v1/cc61d0d63-BtF30gww.js:3319` to `:3331` (`sandbox`, `referrerPolicy="no-referrer"`), the sandbox value at `:1517`, the origin at `web/app/v1/shared-46-B-KgctpG.js:285`. Files beside the page are not loaded.
- **A video or a sound** is a native element whose source is a URL with a random token, `claude-media://v/<token>`, which main maps to the file and checks again at each request, answering ranges: `main-process/index.chunk-BV3uOqbK.js:404442` and `:404528`; the elements at `web/app/v1/cd2efac6e-DJ0bDCna.js:12828` and `:12839`.
- **Anything else** shows "Preview isn't available for this file" with ways out (`web/app/v1/cd2efac6e-DJ0bDCna.js:10443`).

MAWS takes the token and the check at every request from the media route and uses them for all four kinds. It departs in three places, each on purpose. A PDF is drawn in a frame of the window, not in a native view, because the file's tab moves between the side column and the main area and a native view does not move with the page's layout (the viewer-frame spike could not show a view following its rectangle: `spikes/viewer-frame/FINDINGS.md`, row B1). The URL never carries a path, where `cowork-file:` carries one, because the cut rules that a frame is told nothing it could change to ask for another file. An HTML page is served from this Mac with no network at all, where Claude Desktop's is hosted on a remote origin MAWS has none of.

## Decisions settled at authoring

The cut fixes the edge and the route. These are what it left to this document, each with its reason and what it beat.

1. **Exact byte ranges: `raw`.** `files.read` gains the optional input `raw: true`. A raw read answers `encoding: 'base64'` whatever the file's type, the bytes of exactly `[offset, min(offset + length, size))`, and never settles a chunk. It changes nothing of the admission: the same `precheck`, `openNoLink` and `confirm` run first. It is honoured for a caller on this machine only; for a caller on another machine the key is passed over and the plain read answered, as `named` is, so nothing new is offered to another machine. Lost: a second command for raw bytes, which would be a second admission path to keep equal to the first.
2. **One version across a response: `identity`, checked on both sides.** A raw read answers `identity`, a string of the descriptor's device, inode, size, modification time and change time in nanoseconds. The service reads the descriptor's state before the bytes and again after them, and refuses the read (`changed while reading: <path>`) when the two differ, so one answer never holds bytes of two versions. Main fixes the identity at a response's first read and ends the response in an error when a later read answers another. The change time joins the four values the cut names because a writer can set a modification time back and cannot set a change time; a false alarm costs one reload. Lost: a hash, which costs a read of the whole file per range and stops at 8 MiB.
3. **The type and the policy are main's, fixed at issue.** `layout.frameFile` makes one raw read of the file's first byte and takes the type that read answered. `framedKindOf` of that type decides the frame, the `Content-Type` and the policy header (none for a PDF, `STORE_FRAME_CSP` for the other three), and all three stay with the token until it is released. The window draws the frame main names, not the one its own read suggested. For a copy from another machine the type is the one the other machine answered for the first page of the copy that was written. A file whose type is no framed kind by then answers `row: 'unframed'`. Lost: the type the window read, which would be the window's word on which answer goes without a sandbox.
4. **The token lives with the viewer entry, and the store asks for it.** The entry gains `frame`, and the viewer store, not a component, asks main when a read of a framed file lands. So a tab that is hidden and shown again, and a file moved between the side column and the main area, keep their token and their URL. A component that asked at each mount would issue at every show and could not release after its tab closed mid-ask. Lost: a token per mounted frame, which the cut's words "one mount" could also be read as; "released when its viewer entry goes" decides.
5. **One ask in flight per entry.** A read that lands while an ask is unanswered marks the entry for one more ask after the answer. An answer is applied only to the entry that asked (the same incarnation) and only when it is that entry's latest ask; any other answer's token is released at once. For a file of another machine this bounds the copies in flight to one per entry however fast the file changes.
6. **A re-read re-issues.** A landed re-read of a framed entry asks for a new token, after a `files.changed` and after a revisit alike: the new URL is what makes the frame load again. The frame already drawn stays until the new URL is ready; then the old token is released. After an event the entry flashes "Updated" as a row does today; a revisit that finds the same type and size flashes nothing.
7. **What the tab shows when a response ended in an error.** Main tells the owning window (`layout.frameFailed`), and the entry's frame is marked failed: the body draws one sentence in the frame's place ("The sentences a person reads"), and the bar keeps "Open externally". For a watched file the change that caused it arrives as `files.changed` and decision 6 draws the new version, so the sentence shows for a moment at most. For a named file nothing arrives: the person reads the file again by showing its tab again or clicking its link again (U6c's `revisit`), which re-issues. No button is added (the cut; law 3). Lost: reading again automatically after a failure, which would loop for a file that keeps changing.
8. **A file of another machine.** `layout.frameFile` with another machine as its target copies the file here with `fetchToFile`, up to `REMOTE_COPY_MAX_BYTES`, into `<temp>/maws-frame-copies/<random name>`, opens the copy read-only, removes its name at once, and serves from the open descriptor until the token is released. So no name of the copy outlives the open, a crash leaves nothing readable under a name, and the folder is emptied at every start. A larger file answers `row: 'too-large'`; a file the other machine sends only as text that is not valid UTF-8 fails with `fetchToFile`'s own sentence. The admission is the other machine's, page by page, at the copy; what is drawn afterwards is the copy, as a copy opened externally stays readable. The copies of "Open externally" are left as they are.
9. **Bounds.** A window holds at most `FRAME_TOKENS_MAX` (32) tokens; the viewer keeps at most 20 entries that are not mounted, so only a fault in the window reaches the bound, and an ask past it fails. The space the copies can take is therefore bounded by the tabs a person keeps open on another machine's large files, 64 MiB each. A file on this Mac has no size bound, as a stored file's frame has none: media is read by range as it plays.
10. **A token is never a number.** A token is drawn again when it holds no letter from `a` to `f`: Chromium reads a host made of digits alone as an IPv4 address and refuses one that large (not measured at authoring; M1 measures it). Three in ten million tokens would otherwise never load.
11. **The owner's check is in the request filter** (R1). `shouldCancelForOwner` cancels a request for a token host unless it comes from the web contents the token was issued to. A request with no web contents (one the browser itself started) is cancelled too. It is consulted before a web contents' own filter, so the export's printer window is judged as well.
12. **Media.** A video or a sound that the element cannot play (an `error` of the element with no failure told by main) draws today's row in its place and releases its token (card 3). Its position is kept across a move and a hide: the element's time is written to the entry's view state as it plays and set again when the element next loads, paused. A video's zoom stays the artifact player's own bar, since the cut names that component.
13. **Nothing of the window's bridges is passed to a file's HTML frame**: no pick, no locate, no connector port. A file by a path carries no bridge script (it is served byte for byte), and its page is not the agent's by any rule.

## Who owns a token

Main issues a token to one page of one app window, for one viewer entry. The page is the `ClientRef` the router handed the command's handler; its web contents' id is recorded with it.

| act | by whom | answer |
|---|---|---|
| issue | `layout.frameFile` from the top frame of an app window (the router's sender check) | the token, to that page only |
| use | a request on the default partition from the owning web contents | served |
| use from another web contents, or from none | | cancelled by the request filter before any handler runs |
| use on the capture partition | | cancelled by the filter there (no capture window owns a token), and the partition's chain has no responder: the store's own path answers 404 |
| use in the render host | | its process holds no tokens and proxies to the daemon, whose endpoint answers 404 for a host that is no artifact's id |
| release | `layout.releaseFrame` from the owning page | released; later uses answer 404 |
| release by another page, or of an unknown token | | the same failure for both, naming nothing; the token, if it lives, still serves its owner |
| the page ends (closed, crashed, reloaded) | main, on the client's end | every token of that page released, every copy's descriptor closed |
| the app quits | main | all released |

The window releases a token when its entry is removed (the tab closed, the preview tab reused for another file, the entry pruned), when a newer token for the entry is ready, when the entry's frame turns into a row, and on the answer of an ask whose entry is gone or has asked again.

## What a frame keeps and loses

| | kept | lost |
|---|---|---|
| **A move** between the side column and the main area | the entry, its token and URL (the key is the same, and U6b-1's `holdKey` keeps the entry across the move); a video's or a sound's position | the frame's own state: the element is made again in its new place and loads again from the route. A PDF is at its first page and Chromium's default zoom; an HTML page has started again; media is paused. The frame cannot be read from outside (another origin, by design), so a PDF's page cannot be carried over. |
| **A hide** (another tab of the group in view, or the pane showing another tab) | the same | the same; while hidden nothing of the file runs or plays. On show a named file is read again (`revisit`), so it gets a new token and the current bytes. |
| **A reuse of the preview tab** for another file | nothing of the old file: its key is held by no tab, the store drops its entry and releases its token | |
| **A close** of the tab | nothing | |
| **A relaunch** | which files are open (U6b-1) | every token: each is issued again when its tab is first shown |

A2 of the child's file ("the same scroll position") is about an editor's file; for a framed file the second column is the limit, and the pull request says so.

## Routes (law 5)

| route | how the bytes are read | what is drawn where it is not |
|---|---|---|
| **A session MAWS runs, on this Mac** | every range by a raw `files.read` of this Mac's daemon, with `named`, as the page that owns the token | — |
| **A terminal session, on this Mac** | the same: the files service has no branch on who holds the session | — |
| **A session MAWS runs, on another machine** | a copy fetched once per token by `fetchToFile`, up to 64 MiB, then the copy's descriptor | a larger file: today's row. The link down or slow past its own timeout: the viewer's refusal with the link's words, read again at the next show or click. A named file: not a route (the other machine admits no file outside the folders). |
| **A terminal session, on another machine** | not read today (R5): the entry is an error before any kind is known | today's refusal; no frame is asked for |

Per acceptance line: B1 to B5, B7 and B8 on the first two routes; B6 on the third; B9 to B11 on the first route and, for the HTML frame's containment, on the third as well (the page drawn from a copy is the same frame under the same policies); B12 to B14 have no route.

**Nothing new is asked of or offered to another machine.** Asked: the pages `fetchToFile` sends today for "Open externally", `files.read { appSessionId, path, offset, length }` and, for a text file whose bytes must be proven, `hash`; never `raw`, never `named`, and after U6e never `agent`. A test spies the link and compares the keys of every page with that set. Offered: a remote caller's `raw` is passed over (decision 1), with a test that the answer is the plain read's, byte for byte, and carries no `identity`. What differs from "Open externally" is when the pages are sent: at an open of the file's tab and at each change of the file while its tab lives, not only at a press of the button; decision 5 bounds it to one copy in flight per open file.

## What a frame can and cannot do, and the proof of each

A file by a path is treated as hostile: it may come from a cloned repository, and its path may be written into the transcript by anything the agent read.

| kind | it can | it cannot | the test that holds it | the scene that shows it on a Mac |
|---|---|---|---|---|
| **PDF** (`PdfFrame`: no `sandbox`; the answer has no policy header) | be drawn by Chromium's viewer; run what PDFium runs of a document's script inside the viewer's own process (R4) | load anything but its own host, the viewer's extension and `chrome://resources`; navigate itself or the window; download; hold a permission; reach an artifact or another token; be asked for by another window. Main's policies are its whole defence. Whether a script's dialog, a print request or a launch reaches the person is R4's to measure. | `policies.test.ts`, the cases of "Main's decisions, each with a token host" below; the responder's suite | `e2e:deliverables`, "a file by a path: a hostile PDF's link is a blocked navigation, its Download a blocked download, and every frame beneath it is the scheme's, the viewer's or chrome://resources" |
| **HTML** (`HtmlFrame`: `sandbox="allow-scripts"`, `referrerPolicy="no-referrer"`; the answer byte for byte under `STORE_FRAME_CSP`; no bridge passed) | run its own inline script; draw what it carries as `data:` or `blob:`; play a sound it carries; use its own process's time until its tab is hidden or closed; reach a TURN relay over TCP by WebRTC, as an HTML artifact can today (the cut, X1; the tracker's row of 2026-10-06 names the file frame until the dead proxy lands) | load anything from the network or from beside it; resolve a name by a prefetch hint (ticket 662); navigate itself, its parent or the window; open a window; submit a form; keep storage (an opaque origin); ask the app anything (no preload runs in a frame, and the router refuses a sender that is not a window's top frame); be heard by the window (no listener reads its messages); hold a permission; download; reach an artifact or another token | the responder's suite ("every answer but a PDF's carries the store's frame policy, byte for byte"); `policies.test.ts` as above; `FrameBody.test.tsx` ("an HTML file's frame is given no bridge") | `e2e:deliverables`, "a file by a path: a hostile page's fetch fails, its link is refused, it gathers no server-reflexive candidate, saves nothing, and its messages change nothing"; and "ticket 662 on a file's frame: its dns-prefetch links ask the resolver for nothing" |
| **video, audio** (a media element in the window's own document) | play and seek by range | run anything: only bytes are loaded, into an element. The window's policy names the scheme where bytes are shown (frames, media, images, fonts) and not for `script-src` or `connect-src` (R2), so a token's bytes can neither run in the window nor be fetched by it. | `csp.test.ts` ("admits the store's scheme where bytes are shown, and nowhere a script runs or a page fetches"); the responder's suite (ranges) | `e2e:code`, "a video by a path plays and seeks, and a sound plays" |

**Main's decisions, each with a token host.** No existing predicate is edited; each gains a case in `src/render/policies.test.ts` whose URL is `maws-artifact://<32 hex>/file`. The names are the cases'.

| decision | predicate (`src/render/policies.ts` unless said) | what it answers for a token host | the case |
|---|---|---|---|
| is this a store frame, or beneath one | `beneathStoreFrame` | true for the token's frame and for the PDF viewer's extension frame beneath it | "finds a token's frame and the viewer beneath it, and nothing in the app beside them" |
| a request from within the frame | `shouldCancelRequest` | cancelled for `http`, `https`, `ws`, `wss` and `file`; passed for its own host, the viewer's files and `chrome://resources` | "cancels a request from a token's frame, or from beneath it, for anything outside the scheme and the viewer" |
| a request for another host of the scheme | `crossesArtifacts`, through `shouldCancelRequest` and `shownArtifact` | cancelled from a token's frame for an artifact, from an artifact's frame for a token, and from one token's frame for another; passed for the app's own origin | "refuses a token's frame an artifact, an artifact's frame a token, and one token's frame another's" |
| which window asks (new) | `shouldCancelForOwner` | cancelled unless the request's web contents is the token's owner; a host that is no token is not judged | "cancels a token asked by another web contents, by none, and after its release; passes its owner's; leaves an artifact's id alone" |
| a frame's navigation | `shouldBlockFrameNavigation` | blocked to `https:`, `data:`, `blob:`, `about:blank`, an artifact and another token; the first load and its own host pass (any path but `/file` then answers 404) | "prevents a token's frame from navigating anywhere but its own host" |
| the window's own navigation (a PDF's link) | `guardWindowNavigation` (not keyed by scheme) | refused | today's case holds; the PDF scene shows it |
| a download | `shouldCancelDownload` | cancelled for a token URL anywhere in the chain, and for the viewer's save | "cancels a download of a token's URL and of the viewer's save from it" |
| a permission | `isStoreFramePermission` | denied when any origin Electron reports is a token's | "names a token's frame by any origin Electron reports" |
| the app-wide policy's exemption | `isCspExempt` | exempt, so the answer's own policy is the one in force and the PDF viewer loads. The consequence is the responder's to hold: every answer but a PDF's carries `STORE_FRAME_CSP` | "exempts a token's answer"; and the responder's suite |
| console attribution | `artifactConsoleMessageOf` | null: a file's frame logs to no artifact | "reads no artifact from a token frame's message" |
| WebRTC | `guardFrames` (per window, not keyed) | `disable_non_proxied_udp` holds | today's case; the HTML scene's candidate check |
| the remote responder | `artifactIdOfUrl` (`src/main/artifacts/remote-scheme.ts`) | null at both stages, also with a remote artifact's page as the referrer: a token URL is never sent to another machine | in `remote-scheme.test.ts`: "answers null for a token host at both stages, whatever the referrer" |
| the store's own path and the daemon's endpoint | `parseArtifactUrl`, through `artifactResolver` (`src/services/artifacts/scheme/artifact-handler.ts`) | 404 | in `artifact-handler.test.ts`: "answers 404 for a token host" |
| the presenter's embeds | `parseArtifactUrl` (`src/main/presentations/present-embeds.ts`) | null | covered by the chain's case in `src/main/artifacts/index.test.ts` |
| the window's policy | `PRODUCTION_CSP` (`src/main/csp.ts`) | R2's statement | in `csp.test.ts`, the case named above |

**The refusals of the route**, each a named case of `src/main/file-frames/responder.test.ts` unless another file is named: "answers 404 for a token it does not hold"; "answers 404 for a released token"; "answers 404 for any path but /file, a query included"; "answers 405 for a method that is neither GET nor HEAD"; "answers null for a host that is no token, so an artifact is the next responder's"; "answers 416 for a range that starts past the end"; "ends the response in an error when a later page answers another identity, and tells the owner"; "ends the response in an error when a page is refused, and tells the owner"; "serves nothing when the daemon answers no identity"; in `tokens.test.ts`: "a release by another page fails and the token still serves", "a release of an unknown token fails with the same words", "a page's end releases every token it owns and closes every copy", "an issue past the bound fails", "an issue whose page ended meanwhile records nothing"; in `src/main/artifacts/index.test.ts`: "the default partition's chain asks the file responder first, and the capture partition's chain has none: a live token asked there answers 404"; in `src/render-host/root.test.ts`: "the render host installs the frame policies with no owner's lookup and hands a token host to the daemon's endpoint, which answers 404"; in `src/main/file-frames/index.test.ts`: "frameFile refuses a path the files service refuses, with its words", "frameFile for another machine sends that machine nothing but fetchToFile's pages", "frameFile answers too-large past the copy's bound and leaves no file", "frameFile fails when the machine is not connected", "a copy that does not arrive fails with the link's words and leaves no file and no token".

**The cut's three named tests**, in `src/services/files/service.test.ts` for the read and in `responder.test.ts` for the route: "a raw read answers bytes that are not valid UTF-8 byte for byte, where the plain read answers replacement characters"; "a raw range that begins and ends inside a multi-byte character is answered as asked, where the plain read moves its end"; "a replacement of the same size between two ranges answers another identity: by a rename over the file, and by a write into it", with the route's half, "a same-size replacement between two ranges of one response ends it in an error".

**Probe 7 of the child's file**, part by part: that Chromium's viewer loads the route's URL in the frame is M1's spike and the PDF scene; that a request for anything but the admitted file is refused is the refusals above; that a file swapped for a link between admission and read is refused is `files.read`'s own guarantee, held for a raw read by two cases that run on macOS alone (`it.skipIf(process.platform !== 'darwin')`, beside the cases they copy): "a raw read refuses an ancestor swapped outside before the open" and "a raw read of a named file refuses a link put in its place after the transcript's answer".

## Acceptance

Each is behaviour a person or a test can see. B1 to B8 are A5's "shows the PDF in MAWS; the same for a video and for a self-contained HTML page", route by route; B9 to B14 are what the cut and root UC-10 add for the route.

- **B1 · A PDF.** In a session on this Mac, a click on a path link to a PDF inside the session's folder, and a click on its row in Files' tree, show the PDF beside the chat in Chromium's viewer. The bar holds "Open externally", which hands the file to the system. No row "PDF files open outside MAWS" is drawn.
- **B2 · Media.** A video inside the folder plays and seeks to a time not yet loaded; a sound plays. Neither starts by itself.
- **B3 · An HTML page.** A self-contained page is drawn and its inline script has run. A page that names a stylesheet and a script beside it is drawn without them, and "Open externally" opens it whole in the system's browser.
- **B4 · Outside the folders.** On this Mac, a PDF outside the session's folders that the transcript names is drawn the same way; one the transcript does not name shows today's refusal.
- **B5 · A terminal session on this Mac.** B1 to B4 hold for it.
- **B6 · Another machine.** For a session MAWS runs on another machine, an HTML file and a PDF of its checkout are drawn here from a copy; "Open externally" still opens a copy; a file larger than 64 MiB shows today's row.
- **B7 · A file that changes.** While a PDF is drawn, replace it on disk: the tab draws the new one and flashes "Updated". For a named PDF, show its tab again or click its link again: the new one is drawn.
- **B8 · Nothing is created.** After B1 to B7 the Library lists no new item, `artifacts.list` for the session answers what it answered before, and nothing is written under the profile's artifacts folder.
- **B9 · A hostile page.** Drawn by a path: its `fetch` fails; a click on its web link leaves the window where it was; it gathers no server-reflexive ICE candidate; its download link saves nothing; its `dns-prefetch` links ask the resolver for nothing; a message it posts in the shape of the frame bridge's changes nothing in the window.
- **B10 · A hostile PDF.** Its link is a blocked navigation; the viewer's Download is a blocked download; every frame beneath it has a URL of the scheme, the viewer or `chrome://resources`.
- **B11 · The token.** `maws-artifact://<token>/other` answers 404; a POST answers 405; the URL of a closed tab answers 404; a second app window that is told the URL gets nothing; a request on the capture partition gets nothing, and with the filter set aside (the unit test of the chain) that partition's handler answers 404.
- **B12 · The read.** The three named tests fail before M2 and pass after it.
- **B13 · An older daemon.** With this build's window on a daemon of build M or build F, a PDF shows today's row, nothing is refused in either log, and the PDF is drawn once a daemon of this build serves and the tab is shown again.
- **B14 · The wire.** `src/shared/ipc/wire.test.ts` holds the manifest at the new minor with `raw` and `identity` as the only additions; `files.readResolved` and `library.read` take no `raw`.

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push. No `pnpm install`, typecheck, eslint, vitest, build, engine or Electron there. Every check runs on the wave's build VM in a checkout of the pushed head, through `vmcheck.sh` (Concrete Steps). An executor starts no Electron e2e, runs no `scripts/ci-gate.sh` and opens no pull request. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.
2. **The design is the cut's.** The admission is `files.read` at every request; the URL carries a token and never a path; the scheme is the store's; the HTML frame's sandbox and `STORE_FRAME_CSP` are unchanged; no existing predicate of `src/render/policies.ts` is edited. An executor who finds that one of these cannot hold stops and reports.
3. **What is stored and sent** (root UC-14). Nothing is stored: no layout key, no field of a stored tab, no settings key. What is sent is Interfaces §B, against build M and build F. The wire's minor moves once, in a commit of its own, and never to pass a gate.
4. **Authorisation is checked where the act runs, on the value it uses.** Main stores the session and the path the command gave and uses those same two values for every read; the daemon admits or refuses each. Nothing the window says later changes them.
5. **Files other children own** (root UC-8). Interfaces §G lists every insertion with its owner. An executor who must edit another file of another child's stops and reports.
6. **Three routes** (law 5): "Routes" above. No act is added for another machine, so no offer and no capability.
7. **The repository is public** (root UC-11), and a person's content is never read. Tests, fixtures and scenes use invented paths under a temporary folder and invented bytes: a PDF built by the scene's own helper, a page written in the test, a clip the deliverables scene already generates. No fault is reproduced by reading the content of a session, a transcript, a journal, a document or a settings file of a person's: structure and counts only, and none of it enters the repository. Nothing about any person's machines or installed software enters a document, a test or a commit.
8. **Guards that read source text.** In renderer source and its tests a ticket or item number is written in words; the tokens guard (`test/support/tokens-guard.test.ts`) reads `#` and three to eight hex digits as a colour, and a token in a test is 32 hex digits with no `#` before it. Run that guard with M5. Components use tokens only.
9. **The base.** The branch takes master by merge, never by rebase or force-push.
10. **The level of proof.** A refusal is asserted on the answer a requester gets, with a token that is live at that moment for another owner or another path, not on a flag. An asynchronous rule is asserted by a test that holds the awaited thing open and acts in between ("The sequences that must hold"). A rule about two builds is asserted in the cross-build scene, and a skipped scene is not evidence.
11. **Disk.** If any command fails with "No space left on device": stop, report, delete nothing.

## The sequences that must hold

The states, the events and where each takes effect are fixed here, before the code.

**The entry's frame, in the window** (`entry.frame`; Interfaces §E). States: *none* (the kind is not `frame`, or no read has landed); *asking* (an ask is unanswered; what was drawn before stays drawn); *ready* (a token and its URL; `failed` or not); *row* (with why).

| event | none | asking | ready | row |
|---|---|---|---|---|
| **L**: a read of the entry landed as a framed kind (an open, a change, a revisit) | ask; *asking* | mark "again" | ask; *asking*, the frame still drawn | ask; *asking* |
| **A+**: the ask answered ready | | the latest ask of a living entry: *ready* with the new token, the one before released; marked "again": ask once more. Any other answer: its token released | | |
| **A0**: the ask answered a row | | *row*; the token before released | | |
| **A×**: the ask failed | | the entry fails as a read fails, with the failure's words (so `revisit` reads it again); the token before released | | |
| **F**: main says the response of this token ended in an error | | marks the frame still drawn | `failed` | |
| **U**: the media element reports an error and no F came for its token | | | *row*, why `unplayable`; the token released | |
| **M**: the entry is mounted again | | | | why `unserved`: ask; *asking* |
| **X**: the entry is removed | | nothing now; the answer's token is released when it comes | the token released | |

An answer takes effect in one synchronous step of the store. Main records a token only after the admission read or the copy has completed, in one synchronous step that first checks that the asking page still lives.

1. **A token asked while the tab closes.** The ask is held open; the tab closes and the entry goes; the ask is answered ready. Then `layout.releaseFrame` is called with that token and no entry exists. Test (store): "an answer for an entry that is gone releases its token".
2. **A change during an ask.** The ask is held open; `files.changed` lands a read. No second ask starts. The first is answered: the store asks once more, and when that answers, the first token is released. Test: "a read that lands during an ask is followed by one more ask, never two in flight".
3. **The swap.** A frame is drawn; a change lands; while the new ask is open the old URL is still the frame's; on the answer the frame has the new URL and the old token is released, in that order. Test: "the frame drawn stays until the new token is ready, and the old one is released after".
4. **A file that changes between two ranges.** The route's first page is answered with one identity; the second is held open and answered with another. The response's stream errors, main emits `layout.frameFailed` to the owner's page, and no further page is asked. Test (responder), with the read stub held open; and the window's half: "frameFailed marks the entry's frame; a change that lands after it draws the new version".
5. **A token used after its release.** 404. Also for a response in flight at the release: its next page is not read and the stream errors. Test: "a release ends a response in flight".
6. **A copy from another machine that never arrives.** The link's own timeout answers the page; `fetchToFile` fails; the command fails with those words; no token is recorded, the copies folder holds no file, and the entry is an error that `revisit` reads again. Test (main), with a link whose page is held open until its timeout under fake timers.
7. **The page ends during an issue.** The admission read, or the copy, is held open; the page reloads; the read is answered. Nothing is recorded; a copy is closed and gone. Test: "an issue whose page ended meanwhile records nothing".
8. **A move.** A framed file beside the chat is moved to the main area. No release and no ask are made, and the frame mounted in the new place has the same URL. Test (store, with `holdKey`): "a move keeps the token".
9. **The daemon restarts during a response.** A page answers `host_unavailable`: the stream errors and the owner is told. A later show asks again and is served. Covered by sequence 4's second case ("a page is refused").
10. **A file changed within one read.** The service finds another descriptor state after the bytes than before them and refuses the read. Test (service), with the service's test hook between the two: "a raw read whose file changed while it was read is refused".
11. **A media position across a hide.** The element reports its time; the tab is hidden and shown; the new element is set to that time once its metadata has loaded, paused. Test: "a hidden and shown video is at the time it left, paused".

## Plan of Work

Six milestones. M1 is a spike whose deliverable is knowledge. M2 is the daemon's read; M3 and M4 are main; M5 is the window; M6 is the scenes and the record. Each consumes only what an earlier one produced and was reviewed for: M3 the read of M2 (Interfaces §B), M4 the modules of M3 (§C), M5 the commands of M4 (§D). M1 and M2 share nothing and may be built together. **M4 does not start before the architect has M1's verdict from a Mac** (R1, R4).

### M1 — Spike: Chromium's PDF viewer on a token URL, and who asks

**A prototyping milestone.** Its deliverable is `spikes/file-frame/FINDINGS.md`; nothing of it is imported by the product, and it has no tests.

**The question.** Three facts the design rests on and no file of the repository shows: that Chromium's PDF viewer draws a document from `maws-artifact://<token>/file` when the answer is a stream that arrives page by page (probe 7 of the child's file, first part); which web contents, frame and initiator each request for a token host carries, the viewer's own range requests included (R1); and what a hostile PDF's script and actions reach (R4).

**What to build.** A harness in the shape of `spikes/viewer-frame/`: `main.mjs` (an Electron main that registers the store's scheme with the privileges `registerStoreSchemes` gives it, opens a `file:` window page under the production policy of `src/main/csp.ts` with `plugins: true`, sandboxed and context-isolated as `src/main/window.ts` makes a window, and answers the token host from bytes in memory with the headers of Interfaces §C, each page after a short pause), `window/` (the page: an `<iframe>` with no `sandbox` for a PDF, one with `sandbox="allow-scripts"` for a page, a `<video>`), `pdf.mjs` (builds each PDF from text, invented content), `run.mjs` (one Electron launch per suite, `RESULT {json}` lines merged into one line per row), and `FINDINGS.md`. It imports nothing from `src/`.

**What the spike measures.**

| row | what is done | what is recorded |
|---|---|---|
| a | a PDF of several pages and about 5 MiB loaded in the frame, the answer streamed in pages; once answering ranges, once answering every request whole | whether the viewer drew it (the extension's frame present and its viewer element sized); the number of requests, each one's `Range` |
| b | the same load, with the partition's `onBeforeRequest` recording every request for the token host | per request: `webContentsId`, `resourceType`, the frame's URL, `initiatorOrigin`, and whether the id is the window's |
| c | row a again with the owner's rule in the filter (cancel unless the id is the window's; cancel when there is none); then a second window given the same URL in a frame, and as a media source | whether the first window still draws the PDF; what the second window got |
| d | a token of 32 digits and no letter | whether the URL loads at all |
| e | one PDF per behaviour: an open action that calls `app.alert`; one that calls `this.print()`; a form with a submit action to an `https:` URL; a launch action; a go-to in another file by a path; an attached file opened from the viewer | for each: what main is told (a dialog, a navigation, a cancelled request, a download, a window asked for) and, on a Mac, what appears on screen without a click |
| f | an HTML page of non-ASCII text with no charset declared, served as `text/html` | how the text is drawn |
| g | a `.mov` and a `.mkv` clip (generated, a second each) as a media source with the type the files service answers for the name | plays, or the element's error code |

**Promote or discard.** The harness and the findings stay under `spikes/file-frame/`. The verdict, routed into Surprises & Discoveries with the criteria applied:

- Row a fails: stop. The route as designed draws no PDF; report with the requests recorded.
- Row b records no request for the token host at all: the filter does not see the scheme, so the owner's check cannot be made there. Report; it would also mean today's rule that one artifact's frame cannot ask for another's is not enforced where the code says it is.
- Rows b and c: every request carries the window's id and the second window gets nothing: R1's default stands. A request of the viewer's carries no id, so the rule breaks the PDF: report. The candidate rulings are to pass a request with no web contents when the frame the details name lies beneath the token's own frame in the owner's window, or to judge a PDF's token at issue and release only.
- Row d: the URL fails to load: decision 10 stands. It loads: decision 10 is dropped, with its test.
- Row e: nothing reaches the person without a click and nothing leaves the machine: the PDF frame lands as a stored PDF's does, with one tracker row per behaviour that is reachable by a click. Anything else: stop before M4, with the list, for a ruling (the PDF kind can be left a row by one condition in `framedKindOf`'s caller, Interfaces §E).
- Rows f and g are recorded for the look and for card 3; neither decides.

**What it does not touch.** Anything under `src/` or `e2e/`.

### M2 — The raw read: exact ranges and one version; the wire's minor

**What exists at its end.** The daemon's `files.read`, asked with `raw: true` by a caller on its own machine, answers the bytes of exactly the range asked as `base64`, with the file's `identity`; refuses a read whose file changed under it; and answers a caller on another machine, or a caller that sent no `raw`, exactly as before. The wire's manifest records the two additions at a new minor.

**What it touches.** `src/shared/ipc/schema/files.ts`; `src/services/files/service.ts` (`read`, `readOpened`, one test-only boundary point); `src/shared/ipc/wire.ts` and the two generated files beside it; `src/services/files/service.test.ts`, `src/shared/ipc/schema/files.test.ts`.

**Interfaces.** Exposes §B to M3. Consumes nothing.

**Decisions.**

1. The raw branch is inside `readOpened`, after the open is confirmed, so every admission path in front of it is the plain read's. `read` passes `raw` only when the request is not remote; `readResolved` never does, and `FilesReadResolvedInputSchema` omits the key as it omits `named`. `library.read`'s input picks three named keys of the read's and so takes none.
2. A raw read's `encoding` is `base64` and its `length` is the count of bytes answered. `mime`, `bytes`, `offset`, `truncated`, `named` are as the plain read's. `hash`, when asked with `raw`, is answered as today; no caller of this landing asks both.
3. `identity` is `identityOf(stat)` (Interfaces §B) of the confirmed descriptor. After the bytes are read the descriptor's state is read again; when `identityOf` of the two differs the read throws `changed while reading: <path>`, with the path as the request gave it, as `not found:` names it. What remains is a write that leaves all five values as they were, which needs a file system whose times do not move; accepted, and said in the pull request.
4. A new boundary point for tests, `after-read`, awaited between the bytes and the second state (sequence 10); it joins `BoundaryPoint` and is reached only by a raw read.
5. A plain read's answer carries no `identity`, so its shape is byte for byte today's. Pinned by a case that compares a plain read's answer before and after with `toEqual`.
6. *The wire's minor.* After the schema's commit come two adjacent commits that hold nothing else: `WIRE_MINOR`'s number with its note ("the UX wave's U6b-2: files.read's raw, and its answer's identity (N)"), pushed so that the VM can generate from it; then the regenerated `wire-manifest.json` (and `wire-fingerprint.json` if `pnpm wire:manifest` moves it). They are the "commit of its own" the wave asks for, in the form U8b and U8c made it, since the VM sees only what is pushed and a pushed commit is never amended. The number is one past the tree's at this milestone's start. It is provisional: the chain's landings ahead take theirs first, and the architect sets these two commits aside at the chain merge and makes them again. The manifest also records the optional `identity` on the outputs of `files.readResolved` and `library.read`, which share the read's output schema and never set it; that is the same one minor.
7. `test/endpoint/checkout-rows.test.ts` and `test/lane-b/offer-coverage.test.ts` are run and expected to pass unchanged, as they did for `named`: nothing under `src/endpoint/` is edited.

**What it does not touch.** `precheck`, `openNoLink`, `confirm`, the allowlist, the transcript's search, `files.openExternal`, any other command.

**What it proves.** B12 (the read's half), B14, sequence 10, and these cases of `service.test.ts` beside the three named ones: "a raw read of a text file answers base64 and the range as asked, with no settling at a CRLF"; "a raw read answers the identity, and two reads of an unchanged file answer the same one"; "a raw read past the end answers no bytes and the file's size"; "a remote caller's raw is passed over: the answer equals the plain read's and carries no identity"; "a plain read's answer is what it was"; "a raw read of a file outside the folders is admitted and refused exactly as the plain read with named"; "a raw read whose file changed while it was read is refused"; the two macOS cases of probe 7. In `files.test.ts`: "a reader that does not know raw reads the request as the plain one" (`readTolerant` over the input's schema less `raw`), "an answer with identity is read by a reader that does not know it as the answer without it", "files.readResolved refuses raw".

### M3 — The tokens, the byte sources and the responder

**What exists at its end.** Three modules of main with no Electron import, proven by their own suites: a table of tokens with their owners; a source of bytes for a file on this Mac (raw reads) and one for a copy (a descriptor); and a responder that answers a request for a token host from a source, range by range, holding one identity. Nothing calls them yet.

**What it touches.** New: `src/shared/files/framed.ts`, `src/main/file-frames/tokens.ts`, `source.ts`, `responder.ts`, each with its test file. Edited: `src/services/artifacts/scheme/scheme-handler.ts` (`rangeOf` exported, nothing else); `src/main/lane-b/remote-copy.ts` (`fetchToFile` tells its caller the type and size of the first page of the pass that was written).

**Interfaces.** Exposes §C to M4 and `framedKindOf` to M5. Consumes §B.

**Decisions.**

1. The responder answers a request in this order: a host that is no token: null. A method other than GET and HEAD: 405. A token it does not hold, or any path but `/file`, a query included: 404, as `text/plain`, `no-store`, the body "not found". Then the first read.
2. *The first read fixes the response.* For a request with no `Range`, or a range with a start, the first read is at that start for at most one page; it answers the file's size and the identity. For a suffix range the first read is of one byte at offset 0, to learn the size. A range that starts past the end: 416 with `Content-Range: bytes */<size>`. A multi-range or a malformed one: the whole file, as the store's handler answers.
3. *The body* is a stream that reads one page of at most `FRAME_PAGE_BYTES` per pull, so a frame that stops reading stops the reads. Before each page it checks that the token is still held; a page whose identity differs from the first, a refused page and a released token each error the stream and, for the first two, call `failed(token)` once per response.
4. A daemon that answers a page with no `identity` (it does not know `raw`) is never served from: the source throws `unserved`. At a response's first read that answers 404; at issue it answers the row (M4).
5. The headers are the store's (`Content-Type` from the token, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Cache-Control: no-store`, `Accept-Ranges: bytes`), with `Content-Security-Policy` from the token, and no `Access-Control-Allow-Origin`: nothing loads a file's frame across origins, and the scheme admits no fetch.
6. The copy's source reads the descriptor at a position and answers a fixed identity; closing it closes the descriptor. Its size is the descriptor's at the open.
7. A token is 16 random bytes as hex (`randomBytes`), drawn again while it holds no letter (decision 10) or is already held.
8. `fetchToFile` gains an optional last argument, `seen?: (first: { mime: string; bytes: number }) => void`, called with the first page of each pass; the caller keeps the last call's value when the answer is `written`. Its two callers of today pass nothing and behave as before.

**What it does not touch.** Electron, the router, the policies, any renderer file.

**What it proves.** The refusals named for `responder.test.ts` and `tokens.test.ts` in "The refusals of the route"; B12's route half; sequences 4, 5 and 9. Beside them, in `responder.test.ts`: "serves a file larger than one page as the pages' bytes in order, reading the next page only when the body is pulled"; "answers a range with 206, its Content-Range and exactly those bytes"; "answers a suffix range from the end"; "answers HEAD with the headers and no body"; "a PDF's answer carries no policy header and an HTML file's, a video's and a sound's carry the store's frame policy"; "every byte of one response is from reads that answered one identity"; "a release ends a response in flight". In `source.test.ts`: "a local read asks files.read with raw, named and the page that owns the token, and nothing else"; "an answer with no identity is unserved"; "an answer in a text encoding is unserved"; "a copy's source reads the descriptor and closes it". In `framed.test.ts`: the four kinds from their types, null for every other type, an image and `application/octet-stream` among them; a token's shape; `frameUrl` and `frameTokenOf` are each other's inverse and `frameTokenOf` answers null for an artifact's id.

### M4 — The commands, the owner's check and the partitions

**Starts only on the architect's word that M1's verdict leaves R1 and R4 as written, or with the ruling that replaces them.**

**What exists at its end.** Main issues a token for a session's file on `layout.frameFile`, releases it on `layout.releaseFrame`, tells the owning page when a response ended in an error, serves it on the default partition to the owning web contents alone, and removes every copy it made. The window does not ask yet: the proof is the suites.

**What it touches.** `src/shared/ipc/schema/layout.ts` (two commands, one event); new `src/main/file-frames/index.ts` with its test; `src/render/policies.ts` (`shouldCancelForOwner`, the fourth argument of `installFramePolicies`); `src/main/artifacts/index.ts` (`installStorePolicies` passes the owner's lookup; `startArtifacts` gives the default partition's chain the responder first); `src/main/app.ts` (the tokens made before `installStorePolicies`; the handlers; the copies folder emptied at start; everything released at quit); `src/main/ipc/router.ts` (`layout.frameFile` joins `SAVED_HERE_FOR_ANY_MACHINE`); `src/main/lane-b/remote-artifacts.ts` and `src/main/lane-b/remote.ts` (one member that copies a session's file over a machine's link); the snapshots `src/shared/ipc/routes.json` and `src/shared/machine/address-paths.json`; cases in `src/render/policies.test.ts`, `src/main/csp.test.ts`, `src/main/artifacts/index.test.ts`, `src/render-host/root.test.ts`, `src/main/artifacts/remote-scheme.test.ts`, `src/services/artifacts/scheme/artifact-handler.test.ts`, `src/main/ipc/router.test.ts`, `src/shared/ipc/schema/layout.test.ts`.

**Interfaces.** Exposes §D to M5. Consumes §C, and from U9 the link of a machine as `remote-artifacts.ts` finds it.

**Decisions.**

1. *`layout.frameFile` on this Mac* (`ctx.target` is this machine; the input and the target are read as `remote.openCopy`'s handler in `src/main/app.ts` reads its own): one raw read of one byte at offset 0, asked through `invokeOwn` as the asking page, with the frame's keys (`FrameAsk`). Refused: the command fails with the service's words. No `identity` in the answer: `row: 'unserved'`. `framedKindOf` of the answer's type null: `row: 'unframed'`. Else the token is recorded with a local source, if the page still lives and its bound is not reached.
2. *On another machine* (`ctx.target` is not this machine): no link: the command fails `host_unavailable`, "layout.frameFile: machine <ref> is not connected". Else `fetchToFile` into the copies folder with `REMOTE_COPY_MAX_BYTES`: `too-large`: `row: 'too-large'`; a failure: the command fails with it; `written`: the copy is opened read-only, its name removed, and the token recorded with the copy's source and the type `seen` reported, or the descriptor closed and `row: 'unframed'` when that type is no framed kind.
3. The folder is `<temp>/maws-frame-copies`, made with mode 0700; a copy's name is random and carries nothing of the file's. It is removed whole at every start of the app, before the first window, and its removal failing is logged and nothing more.
4. `layout.releaseFrame` fails `invalid_input` with "layout.releaseFrame: no frame of this window" for a token the asking page does not own, known or not.
5. `layout.frameFailed` is emitted with `emitTo` to `pageOf(owner)` alone, never broadcast: a token told to another window would be a token another window holds.
6. *The partitions.* `startArtifacts` builds two chains where it builds one: the default partition's is the file responder, then today's; the capture partition's is today's. `installStorePolicies` passes the tokens' `ownerOf` to `installFramePolicies` on both partitions; the render host's call passes none and is unchanged.
7. *The owner's check* is the first thing the request listener does, before a web contents' own filter and before the frame policies.
8. Main writes no token to a log, and names a frame in a log line by its session and its kind, never by its path; a failed copy is logged as `fetchToFile` logs one today.
9. The handlers are registered with `registerMainHandler`. `layout.frameFile`'s input holds an `AppSessionIdSchema`, so `address-paths.json` gains its line, and both commands join `routes.json`; each snapshot is made again on the VM and its diff brought back (Concrete Steps 4).

**What it does not touch.** Any existing predicate of `policies.ts`; `src/main/csp.ts`; `STORE_FRAME_CSP`; the capture and export code; the renderer.

**What it proves.** B11; the cases named for `policies.test.ts`, `csp.test.ts`, `index.test.ts` of the artifacts and of the file frames, `remote-scheme.test.ts` and `artifact-handler.test.ts` in the security section; sequences 6 and 7; "Nothing new is asked of or offered to another machine" (its first test). Beside them: in `policies.test.ts`, "asks the owner's check before a web contents' own filter, on the real listener"; in `router.test.ts`, "layout.frameFile for a session of another machine is answered here with that machine as its target" and "a frame's sender is refused both commands" (today's sender check, with the two names); in `layout.test.ts`, the three schemas accept what Interfaces §D shows and refuse a token of another shape.

### M5 — The window: the kind, the entry's frame, the bar

**What exists at its end.** A file whose type is PDF, HTML, video or audio has the kind `frame`; its entry asks main for a token when a read lands, draws the frame main names, and releases what it no longer shows. The bar of a drawn file holds "Open externally". A media position survives a move and a hide. In the unit suites, with main's two commands and its event stubbed, every row of "The sequences that must hold" for the window passes.

**What it touches.** `src/renderer/src/tools/code/viewer/kinds.ts`, `viewer-store.ts`, `FileViewer.tsx`, new `FrameBody.tsx`; `src/renderer/src/tools/artifacts/viewers/frames/Media.tsx` (three optional props); `src/renderer/src/tools/code/copy.ts` (one sentence); `src/renderer/src/ipc/events.ts` (one subscription); tests: `viewer.test.tsx`, new `FrameBody.test.tsx`, `frames/Media.test.tsx`, `tools/code/files/tabs.test.tsx` (the move).

**Interfaces.** Consumes §D and `framedKindOf`. Exposes §E.

**Decisions.**

1. `kindOf` answers `frame` for a type `framedKindOf` knows, after the inline-image test and before `external`. `externalKindOf` is unchanged and still names the row's kind.
2. A read that lands with the kind `frame` reads nothing past its first chunk, as an `external` one does today, and then asks (event L). An entry read by its artifact alone (no session) asks nothing and draws the row: `ByteViewer` never mounts such an entry for a framed name, and the branch exists so that no command is sent without a session.
3. `FrameBody` draws, by the entry's frame: *asking* with nothing drawn before: "Loading". *ready*: `PdfFrame`, `HtmlFrame` (with `url` and `title` and no other prop) or `Media`, each keyed by the URL so that a new URL makes a new element. *ready* and failed: the sentence. *row*: `ExternalRow`, which holds its own "Open externally".
4. The bar's `Controls` gains `OpenExternally` for an entry of kind `frame` whose frame is not a row, placed where a head's is today.
5. `Media` gains `onError?()`, `startAt?: number` and `onTime?(seconds: number)`. The store keeps the position in the entry's view state (`viewState(key)`), which already outlives a view; `Media` sets `currentTime` once on `loadedmetadata` and never plays by itself.
6. The viewer's data attributes for scenes: `[data-file-viewer]` gains `data-frame`, one of `loading`, `pdf`, `html`, `video`, `audio`, `failed`, `row`, or empty for another kind.
7. The frame's `title` is the file's base name.
8. The store's `reset()` releases every token it holds (tests, and a hot reload).

**What it does not touch.** `ByteViewer.tsx`, `PdfFrame.tsx`, `HtmlFrame.tsx`, `ExternalRow.tsx`, `tools/code/files/`, the openers, any notice's words.

**What it proves.** The window's half of B1 to B7 and B13; sequences 1 to 4 (their window halves), 8 and 11. The cases named in the sequences, and: in `viewer.test.tsx`, the kinds table with the four types as `frame` and an image, a binary, a `.tiff` and an oversized image as before; "a framed entry asks main once its read lands, with the session, the path and the read's keys"; "an entry read by its artifact asks nothing and draws the row"; "an ask that fails makes the entry an error that revisit reads again"; "a row for a daemon that does not serve asks again when the entry is mounted again"; "a revisit of a named file asks again and flashes nothing when type and size are the same"; "the removal of an entry releases its token"; "reset releases every token". In `FrameBody.test.tsx`: one case per state of decision 3; "an HTML file's frame is given no bridge"; "a new URL makes a new frame element"; "a media error with no failure from main draws the row and releases the token"; "Open externally is in the bar of a drawn file and not beside a row's own". In `Media.test.tsx`: "sets the start time once the metadata has loaded and reports the time as it plays".

### M6 — The scenes, the cross-build row, the record, and the acceptance run

**What exists at its end.** The scenes of Interfaces §H written and typechecked, none run; the cross-build scene and its row; the tracker's rows; this document's Progress and record brought up to date; the whole unit suite run once.

**What it touches.** `e2e/code-tools.spec.ts`, `e2e/deliverables.spec.ts`, `e2e/remote.spec.ts`, `e2e/sessions.spec.ts`, `e2e/cross-build.spec.ts`, a helper under `e2e/support/` if two specs share the hostile files; `docs/tech-debt-tracker.md`.

**Decisions.**

1. The hostile page and the hostile PDF are the deliverables scene's own (`DELIVERED_PAGE`, `minimalPdf`), written into the session's folder as files instead of being seeded as artifacts, so the two kinds of frame are held to the same assertions.
2. A scene waits with `expect.poll` and asserts no duration (the gate's script tests read a raw time bound in a scene as a defect).
3. *The cross-build scene*, "(file frame, both ways)", after U6b-1's block. This build's app on the peer's `mawsd`, run as the profile's LaunchAgent (`installUnitDaemon`), opens a PDF of the session's folder: the row is drawn, no frame, "Open externally" reaches the seam, and neither log holds a refusal of what the other sent. Then the peer's app on this build's `mawsd` opens the same PDF: its row, as it always drew it. Each half is skipped, saying so, where this build's `mawsd` refuses the peer's hello or the peer knows `raw`; the run of record is counted only with the first half run. Its row in the coverage table: Interfaces §B.
4. The tracker: the row of 2026-10-08 ("Opening a PDF or an MP4 through the Files route…") is closed with this landing's name. The row of 2026-10-06 (E2, the relay over TCP) gains "and a file's HTML frame (UX wave U6b-2), until the dead proxy of the first Office preview landing". New rows: whatever M1 found reachable by a click (R4); "a framed file moved or hidden returns to its start: a PDF's page and an HTML page's state are not carried" ; "the space the copies of another machine's framed files take is bounded only by the tabs open (64 MiB each)".

**What it does not touch.** Product source, unless a scene finds a defect, which goes back to its milestone's owner through the controller.

**What it proves.** The acceptance run of Concrete Steps 8.

## Concrete Steps

Working directory for every command: the branch's worktree (the controller's brief names it). The VM sees only what is pushed. `vmcheck.sh` prints `vmcheck: ux-wave/U6b-2 at <short sha>`, then the command's own output, and exits with the command's status. Below, `vmcheck` stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b-2 --`. The VM is shared: a check that is slow is read against its load first. Every command there runs under `timeout <seconds>`.

1. **Before anything, once.** Ticket 662 is on the branch:

       git log --oneline -1 -- src/main/chromium-features.ts
       grep -n "dnsPrefetchingEnabled=false" src/main/chromium-features.ts

   Expected: a commit, and one line of `STARTUP_BLINK_SETTINGS`. If the second prints nothing: stop and report; this landing does not go on without it.

2. **Before each milestone:**

       git fetch origin master && git merge origin/master
       git push origin ux-wave/U6b-2

   A merge, never a rebase or a force-push. After a merge that brought changes, run the previous milestone's proof again (the same set, not the whole suite), and read "What this document assumes of landings in flight" against what arrived.

3. **The tests before the modules** (M2 to M5). Commit the cases of the milestone's "What it proves" with the modules' exports naming nothing; push; run them; the cases that assert the new behaviour fail and those that assert what stays pass. Then build.

4. **While building**, after each push:

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 pnpm exec eslint <the paths changed>'
       vmcheck 'timeout 900 pnpm exec vitest run <the test files touched>'

   The node project for M2 to M4 (and for M5's use of `src/shared/`); the web project for M5 and for any milestone that edits `src/shared/`. A generated file is made on the VM and its diff brought back, the VM's checkout restored:

       vmcheck 'pnpm wire:manifest >/dev/null || true; git diff -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json; git checkout -q -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json' | sed 1d > "$TMPDIR/u6b2-wire.patch" && git apply "$TMPDIR/u6b2-wire.patch"

   (M2, run at the pushed commit that holds the new number; the patch is the second of the two commits of M2's decision 6.) For M4, the same way with `MAWS_ROUTES_WRITE=1 pnpm exec vitest run src/shared/ipc/routes.test.ts` and `MAWS_ADDRESS_PATHS_WRITE=1 pnpm exec vitest run src/shared/machine/coverage.test.ts` over `src/shared/ipc/routes.json` and `src/shared/machine/address-paths.json`. Read each diff before applying it: the wire's holds `raw` and `identity` and the number; the routes' two names; the address paths' one line.

5. **M1.** The harness is run on the VM under `xvfb-run`, as `spikes/viewer-frame/run.mjs` runs itself (R7):

       vmcheck 'cd spikes/file-frame && timeout 900 node run.mjs'

   Expected: one line per row of M1's table, `PASS`, `FAIL` or `RECORD`, and the per-request records under `runs/` (ignored by git). The findings are written into `spikes/file-frame/FINDINGS.md` with the commands that made them. Then **stop**: tell the controller that the harness is ready for a Mac ("Proof that an executor does not run", 1).

6. **Each milestone's proof** is the typecheck of the projects it changed, eslint on its changed files, and vitest over the folders it touched and those that import what it changed:

   - M2: `src/services/files src/shared/ipc src/shared/files src/main/lane-b src/renderer/src/tools/code/viewer test/endpoint/checkout-rows.test.ts test/lane-b/offer-coverage.test.ts`
   - M3: `src/main/file-frames src/shared/files src/services/artifacts/scheme src/main/lane-b src/main/artifacts src/main/library`
   - M4: `src/main/file-frames src/main/artifacts src/main/ipc src/main/csp.test.ts src/render src/render-host src/services/artifacts/scheme src/shared/ipc src/shared/machine src/main/lane-b src/main/presentations`
   - M5: `src/renderer/src/tools/code src/renderer/src/tools/artifacts src/renderer/src/ipc src/renderer/src/panel src/renderer/src/shell test/support/tokens-guard.test.ts`

   as `vmcheck 'timeout 1800 pnpm exec vitest run <the list>'`. Expected: every file passes but those the build brief lists as failing on master on the VM too. M2 also runs the macOS cases' file on the VM (they are skipped there, which is expected; their run is the architect's). M5 edits `tools/code/copy.ts`, which the desk's web app imports (`apps/desk-web/src/depth/view/DiffPane.tsx` reads `REVIEW_COPY` from it): M5's proof adds that package's typecheck, build and test project, run as the static gate runs them, although the edit only adds a key.

7. **A scene is typechecked, not run** (M6):

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

   The second is the gate's own script tests, text guards over the scene files and the group lists.

8. **The acceptance run** (M6's last step), on the pushed head, after a last merge of master:

       vmcheck 'timeout 2400 pnpm typecheck'
       vmcheck 'timeout 1800 pnpm lint'
       vmcheck 'timeout 3600 pnpm test'
       vmcheck 'timeout 600 pnpm exec vitest run src/shared/machine'

   Expected: each exits 0, apart from the files the build brief lists as failing or timing out on the VM, each of which is shown to pass alone or to fail on master there; vitest's summary names no other failed file. No fixture file is added; if one is, also `vmcheck 'timeout 600 node --test .github/scripts/maws-app-scan.test.mjs'`. The whole unit suite runs this once, by M6's executor, and by no earlier milestone. Against these runs: B8 (its unit half), B11, B12 and B14 are the suites as each milestone's "What it proves" names them; B1 to B7, B9, B10 and B13 are the architect's scenes.

9. **Stop and hand back.** M6's executor writes into Progress what ran and what is left, pushes, and stops. Class 1a (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b-2`), the Mac lane's unit cases, the branch review, the e2e runs and the pull request are the architect's.

## Interfaces and Dependencies

### §A. The framed kinds and the frame's URL (M3; `src/shared/files/framed.ts`, new, compiled by main and by the window)

    export type FramedKind = 'pdf' | 'html' | 'video' | 'audio';
    export function framedKindOf(mime: string): FramedKind | null;   // 'application/pdf'; 'text/html'; 'video/…'; 'audio/…'; null for every other type
    export const FRAME_TOKEN = /^[0-9a-f]{32}$/;
    export function frameUrl(token: string): string;                 // `maws-artifact://<token>/file`
    export function frameTokenOf(url: string): string | null;        // the host when it has a token's shape, whatever the path; null for an artifact's id and for another scheme

No Node import: the window bundles it. `bodyOf` (`tools/artifacts/viewers/model.ts`) keeps its own four tests of a name; it is U10's and is not edited.

### §B. The raw read, what is sent, and what each older build does (M2)

    // src/shared/ipc/schema/files.ts
    FilesReadInputSchema  += raw: z.literal(true).optional()        // the bytes of exactly the range asked, as base64, never decoded and never re-cut; honoured for a caller on this machine alone
    FilesReadOutputSchema += identity: z.string().min(1).optional() // present exactly in the answer to a raw read: the version of the file the bytes are of
    FilesReadResolvedInputSchema = FilesReadInputSchema.omit({ appSessionId: true, named: true, raw: true })

    // src/services/files/service.ts
    export const identityOf: (stat: BigIntStats) => string;         // `${dev}:${ino}:${size}:${mtimeNs}:${ctimeNs}`
    // BoundaryPoint += 'after-read'   (tests: between a raw read's bytes and its second look at the descriptor)
    // a raw read that finds the descriptor changed throws new Error(`changed while reading: ${path}`)

**Stored:** nothing. **Sent:** the two keys above, between this Mac's main and this Mac's daemon, and nothing else.

| who sends, who reads | build M (`2c7044231`, minor 46) | build F (`f1852de3a`, minor 33) |
|---|---|---|
| **this build's main asks an older daemon** with `raw` (the moments before the app's build check replaces a private daemon of another build; a daemon kept as a LaunchAgent) | the daemon's tolerant reader drops `raw` and answers the plain read: no `identity`. Main serves nothing and answers `row: 'unserved'`; the tab shows today's row | the same; build F's daemon drops `named` as well, so a named file is refused there as it always was |
| **an older window asks this build's daemon** | it never sends `raw`; the answer is the plain read's and carries no `identity`; the window draws its row | the same |
| **this build's daemon answers a raw read to a main that does not know `identity`** | cannot arise: only this build's main sends `raw`. Were it to, main's tolerant reader would drop the key | the same |
| **a run of this build, then the older build, then this build** on one profile | nothing is stored, so nothing is carried: the older build draws its row for a PDF, and this build draws the PDF again | the same |
| **this build and another machine**, whatever build it runs | sent to it: `fetchToFile`'s pages, as today. Received from it: a `raw` in its request is passed over (the plain read, no `identity`) | the same |

The manifest gains `raw` on `files.read`'s input and `identity` on the outputs of `files.read`, `files.readResolved` and `library.read` (one shared schema). The two main-owned commands and the event are outside the manifest (`src/shared/ipc/wire.ts`: main-to-renderer traffic stays out), and the window and main are always one build.

**The cross-build scene** is M6's decision 3. **Its row** in the coverage table of `e2e/cross-build.spec.ts` (U13a's block), in the table's own columns:

    | U6b-2: nothing stored. On the wire,           | (file frame, both ways): on the peer's `mawsd` this   | the second half: the peer's app on this build's    |
    | `files.read`'s `raw` and its answer's         | build's window draws the PDF's row and no frame; the  | `mawsd` draws its row; this build's daemon answers |
    | `identity`                                    | peer's daemon drops `raw` and refuses nothing         | it the plain read, with no `identity`              |

**Two cross-build runs are owed** (the wave's rule for a landing that takes a wire minor): `e2e:cross-build` with `--peer-exact f1852de3a` and with `--peer-exact 2c7044231`, each on the final head or on the last head that changed anything of M2's or M5's. The architect's.

### §C. The tokens, the sources and the responder (M3; `src/main/file-frames/`, no Electron import)

    // tokens.ts
    export const FRAME_TOKENS_MAX = 32;                              // per page
    export interface FrameFixed { framed: FramedKind; mime: string; csp: string | null; source: ByteSource }   // fixed at issue: csp is null for a PDF, STORE_FRAME_CSP otherwise
    export interface FrameToken extends FrameFixed { token: string; owner: ClientRef; contentsId: number }
    export interface FrameTokens {
      issue(owner: ClientRef, contentsId: number, fixed: FrameFixed): FrameToken | 'full' | 'gone';   // 'gone': the page has ended; either way the source is closed by the caller
      get(token: string): FrameToken | null;
      ownerOf(host: string): number | null | undefined;             // undefined: no token's shape (an artifact's id); null: a token nobody holds; else the owning web contents' id
      release(token: string, by: ClientRef): boolean;               // false: not this page's, known or not
      releaseAll(owner: ClientRef): void;                           // called on the page's end
      releaseEverything(): void;                                    // the app's quit
    }
    export function createFrameTokens(random?: () => string): FrameTokens;   // a release closes the token's source

    // source.ts
    export const FRAME_PAGE_BYTES = 1024 * 1024;
    export interface Page { bytes: Uint8Array; size: number; identity: string }   // size: the file's
    export interface ByteSource { read(offset: number, length: number): Promise<Page>; close(): Promise<void> }
    export class FrameReadError extends Error { readonly why: 'unserved' | 'refused' }   // refused: the read's own failure, its words kept as the message
    export interface FrameAsk { named: true }                       // the keys every read of the frame carries; U6e adds `agent?: true` ("What this document assumes")
    export type RawRead = (input: FilesReadInput, as: ClientRef) => Promise<CommandResult<'files.read'>>;
    export function localSource(read: RawRead, as: ClientRef, target: { appSessionId: AppSessionId; path: string }, ask: FrameAsk): ByteSource;
    export function copySource(handle: FileHandle, size: number): ByteSource;

    // responder.ts
    export function fileFrameResponder(tokens: Pick<FrameTokens, 'get'>, failed: (token: FrameToken) => void): SchemeResponder;
    // null for a host that is no token; else always a Response (M3, decisions 1 to 5)

`SchemeResponder` is `src/services/artifacts/scheme/artifact-handler.ts`'s. `localSource` asks `{ appSessionId, path, offset, length, raw: true, ...ask }` and nothing else, and throws `unserved` for an answer with no `identity` or with a text encoding.

### §D. The commands, the event, the owner's check and the partitions (M4)

    // src/shared/ipc/schema/layout.ts (two commands, owner 'main'; one event)
    'layout.frameFile':    { input: z.strictObject({ appSessionId: AppSessionIdSchema, path: z.string().min(1) }),
                             output: z.discriminatedUnion('status', [
                               z.strictObject({ status: z.literal('ready'), token: z.string().regex(FRAME_TOKEN), url: z.string(), framed: z.enum(['pdf', 'html', 'video', 'audio']) }),
                               z.strictObject({ status: z.literal('row'), why: z.enum(['too-large', 'unserved', 'unframed']) }),
                             ]), owner: 'main' }
    'layout.releaseFrame': { input: z.strictObject({ token: z.string().regex(FRAME_TOKEN) }), output: z.void(), owner: 'main' }
    events: 'layout.frameFailed': z.strictObject({ token: z.string().regex(FRAME_TOKEN) })

A failure of `layout.frameFile` is the command's failure, with the words of what refused: the files service's (`path outside the session's directories`, `not found: <path>`, …), the link's, `fetchToFile`'s, or main's own two ("layout.frameFile: machine <ref> is not connected"; "layout.frameFile: too many file frames in this window").

    // src/main/file-frames/index.ts
    export const FRAME_COPIES_DIR = 'maws-frame-copies';            // under the temporary directory
    export interface FileFramesDeps {
      local: MachineRef;
      read: RawRead;                                                // invokeOwn('files.read', input, { client, target: local })
      copy(machine: MachineRef, source: { appSessionId: AppSessionId; path: string }, to: string, max: number, seen: (first: { mime: string; bytes: number }) => void): Promise<Result<'written' | 'too-large'> | null>;   // null: no link reaches the machine
      page(client: ClientRef): { id: number; send(name: 'layout.frameFailed', payload: { token: string }): void } | null;   // pageOf, emitTo
      tempDir(): string;
      register: typeof registerMainHandler;
      log(line: string): void;
    }
    export function startFileFrames(deps: FileFramesDeps): { tokens: FrameTokens; responder: SchemeResponder; sweep(): Promise<void>; stop(): void };

**The owner's check** (R1), in `src/render/policies.ts`:

    export type StoreHostOwner = (host: string) => number | null | undefined;   // FrameTokens['ownerOf']
    export function shouldCancelForOwner(details: { url: string; webContentsId: number | undefined; ownerOf: StoreHostOwner }): boolean;
    // false for a URL outside the scheme and for a host `ownerOf` answers undefined for; else true unless the answer is `webContentsId`
    export function installFramePolicies(session: Session, env: SeamEnv, appOrigin?: string | null, ownerOf?: StoreHostOwner): void;
    // the listener asks shouldCancelForOwner first, when `ownerOf` is given; everything after it is today's

`installStorePolicies(env, appUrl, ownerOf)` passes it for both partitions. `startArtifacts` takes the responder as one more dependency (`fileFrames?: SchemeResponder`) and builds the default partition's chain as `inOrder(fileFrames, embeds, remote 'placed')` and the capture partition's as today's.

**From U9's files**, one member: `RemoteArtifacts.copyFile(machine, source, to, max, seen)` in `src/main/lane-b/remote-artifacts.ts`, which finds the link as `openCopy` does and calls `fetchToFile`, null when no link reaches the machine; and its name in the `artifacts` pick that `src/main/lane-b/remote.ts` exposes.

### §E. The window (M5)

    // tools/code/viewer/kinds.ts
    export type ViewerKind = 'code' | 'markdown' | 'image' | 'frame' | 'external' | 'head';

    // tools/code/viewer/viewer-store.ts
    export type EntryFrame =
      | { status: 'asking'; shown: ReadyFrame | null }               // `shown`: what stays drawn until the answer
      | ReadyFrame
      | { status: 'row'; why: 'too-large' | 'unserved' | 'unframed' | 'unplayable' };
    export interface ReadyFrame { status: 'ready'; token: string; url: string; framed: FramedKind; failed: boolean }
    // ViewerEntry += frame: EntryFrame | null
    // ViewState   += mediaAt: number                                // a video's or a sound's position, seconds
    // ViewerStore += frameFailed(token: string): void               // from the event
    //             += frameUnplayable(tabId: string): void           // from the media element's error
    const frameAsk = (entry: ViewerEntry) => ({ appSessionId: entry.appSessionId!, path: entry.path });   // the one place U6e's `agent` joins

    // tools/code/viewer/FrameBody.tsx (new)
    export function FrameBody({ entry }: { entry: ViewerEntry }): ReactNode;

    // tools/artifacts/viewers/frames/Media.tsx: three optional props, each a no-op when absent
    onError?(): void; startAt?: number; onTime?(seconds: number): void;

The markers: `[data-file-viewer][data-kind="frame"]` with `data-frame` (M5, decision 6); inside it the frames keep the markers they have as an artifact's (`[data-artifact-frame="pdf"]`, `[data-artifact-frame="html"]`, `[data-artifact-media]`), so a scene tells a file's frame from an artifact's by the viewer around it.

### §F. What this landing consumes, and what a later landing may rely on

Consumed, by the name each exposes. From U6b-1: `FileBody` and its `Body` switch, the entry's key (`fileKey`), `holdKey`, the prune that keeps a side tab's entry, `[data-files-tab]` and `[data-file-viewer][data-path]`. From U6c: `named` on the read and on its answer, `revisit`. From U9: `fetchToFile`, `REMOTE_COPY_MAX_BYTES`, the link of a machine. From ticket 662: `STARTUP_BLINK_SETTINGS`. From the artifact store: `PdfFrame`, `HtmlFrame`, `Media`, `STORE_FRAME_CSP`, `inOrder`, `SchemeResponder`.

Exposed. To the Office previews: the kind `frame` in `kindOf`, where an `office` kind joins; `framedKindOf`; the policies' file with one more predicate. They do not use the route (the cut, "What the previews consume"). To U6b-4: the row a framed file keeps is `ExternalRow` with the entry's `frame.why`, which its document words; the failure of `layout.frameFile` reaches the viewer as a read's failure does, so its classifier of refusals sees it. To U6e: `frameAsk` and `FrameAsk`.

### §G. Files other children own, or several landings edit (root UC-8)

| file | owner | this landing's insertion |
|---|---|---|
| `tools/code/viewer/`, `tools/code/copy.ts`, `src/shared/files/` | U6 | this landing's own |
| `src/shared/ipc/schema/files.ts`, `src/services/files/service.ts` | no child (U6c and U8c-2 inserted; U6e is inserting) | the optional `raw` and `identity`; the raw branch of `readOpened`, `identityOf`, one boundary point |
| `src/shared/ipc/wire.ts` and the two generated files | no child | the minor (M2, decision 6) |
| `src/shared/ipc/schema/layout.ts` | by key (root UC-8) | two commands and one event of main's own; no layout key |
| `src/render/policies.ts` | no row of the table names it | one new predicate and one optional argument (R1); no existing predicate edited |
| `src/main/artifacts/index.ts` | no row | one argument of `installStorePolicies`; the default partition's chain |
| `src/services/artifacts/scheme/scheme-handler.ts` | no row | `rangeOf` exported |
| `src/main/ipc/router.ts` | no row (U6e is inserting a guard) | one name in `SAVED_HERE_FOR_ANY_MACHINE` |
| `src/main/app.ts` | no row | the wiring of M4 |
| `src/main/lane-b/remote-copy.ts`, `remote-artifacts.ts` | no row | `fetchToFile`'s optional last argument; `copyFile` |
| `src/main/lane-b/remote.ts` | U9 | one name in the `artifacts` pick |
| `tools/artifacts/viewers/frames/Media.tsx` | no row (the frames are the artifact store's) | three optional props |
| `src/renderer/src/ipc/events.ts` | no child | one subscription, beside the one for `files.changed` |
| `e2e/cross-build.spec.ts` | the P5 work | one block and one row of the coverage table |
| `docs/tech-debt-tracker.md` | shared | M6's rows |

Whoever lands second in a shared file merges master first. Nothing is edited under `src/endpoint/`, `src/main/csp.ts`, `tools/code/files/` or `src/artifacts/`.

### §H. The e2e groups whose scenes cross this change

By the group's name in `package.json`; `e2e` is the default group (the specs no script lists). Every group that loads a `maws-artifact:` URL crosses the request filter's new first question and the default partition's chain, so the last row names them: their scenes are not edited, and they run on the final head.

| group | spec | scenes that change, or are added |
|---|---|---|
| `e2e:code` | `e2e/code-tools.spec.ts` | "a PDF is an Open externally row" becomes "a PDF is drawn in its tab: Chromium's viewer in the frame, Open externally in the bar, nothing new in the Library" (B1, B8). Added: "an HTML file by a path runs its own script and is drawn without the stylesheet beside it" (B3); "a video by a path plays and seeks, and a sound plays; moved to the main area it is at the time it left" (B2); "a PDF replaced on disk is drawn again" (B7). "a binary is an Open externally row" stays. "the Files tree and the viewer use tokens only in both themes": its `doc.pdf` entry is found by the frame's viewer and judged by the bar. |
| `e2e:deliverables` | `e2e/deliverables.spec.ts` | Added, after the delivered files' scene and by its helpers: "a file by a path: a hostile page's fetch fails, its link is refused, it gathers no server-reflexive candidate, saves nothing, and its messages change nothing" (B9); "a file by a path: a hostile PDF's link is a blocked navigation, its Download a blocked download, and every frame beneath it is the scheme's, the viewer's or chrome://resources" (B10); "ticket 662 on a file's frame: its dns-prefetch links ask the resolver for nothing" (B9); "a token's URL: another path is 404, a POST is 405, a closed tab's is 404, and neither a second window nor the capture partition gets a byte of it" (B11; the second window through the seam `__maws_documents.openWindow`; how the capture partition is asked, a frame of a capture window or the partition's own request, is the executor's, and the assertion is that no byte of the file arrives). Unchanged and run: every scene of the spec, since `Media.tsx` and the filter are theirs too. |
| `e2e` | `e2e/sessions.spec.ts` | U6c's scene, "a file the transcript links opens read-only from outside the session's folder, and nothing else does": the linked PDF is drawn, its "Open externally" is the bar's, and a PDF the transcript does not name keeps the refusal (B4). |
| `e2e` | `e2e/layout-transfer.spec.ts` | Unchanged; run, since a file's move now carries a frame. |
| `e2e:remote` | `e2e/remote.spec.ts` | The step that opens `PAGE_ON_B`: the page is drawn here from a copy (the frame's script has run), "Open externally" is the bar's and still opens a copy under `maws-remote-copies`, and no file is left under `maws-frame-copies`. Added step: a file one byte past 64 MiB shows the row (B6). |
| `e2e:lane-a` | `e2e/lane-a.spec.ts` | Added step, where the spec has a terminal session with a folder: a PDF of that folder is drawn (B5). If the spec's sessions have no file a scene can open, the step goes to the sitting's script and M6's executor reports it. |
| `e2e:cross-build` | `e2e/cross-build.spec.ts` | Added: "(file frame, both ways)" (B13). |
| `e2e:artifacts`, `e2e:library`, `e2e:presentations`, `e2e:render-host`, `e2e:design`, `e2e:design-systems`, `e2e:document-app`, `e2e:panel`, `e2e:side`, `e2e:tools`, `e2e:dashboard`, `e2e:browser`, `e2e:connectors-direct` | the specs of each that name the store's scheme or its frames (the spec files under `e2e/` in which a search for `maws-artifact`, `data-artifact-frame` or `data-artifact-media` finds a line) | Unchanged; run on the final head: each loads the store's scheme through the filter and the chain this landing reorders. |

Read by M6's executor and reported, not changed without the architect: `e2e/maws-tools-live.spec.ts` and `e2e/p1-live.spec.ts`, paid live scenes that press "Open externally" on a file's row; whether a paid group runs is the architect's (root UC-10).

## The look

Law 7: today's tokens and shapes; nothing new is styled. Five states should be drawn at their real sizes, with invented files, before M5 is built, because each is decided by a width or by Chromium and not by a token.

| state | what the drawing would show |
|---|---|
| **A PDF in a narrow side tab** | the file's column at about 360 px with the tree folded: the bar wrapped to two lines (the tree's button, the path with its name whole, "Open externally", "Move to main area"), and under it Chromium's own toolbar and a page fitted to the width. It answers whether the two bars leave the page readable at that width. |
| **An HTML page that lost its neighbouring styles** | the same page twice: as its author meant it, and as the tab draws it, unstyled, with "Open externally" in the bar and nothing else said. It answers whether silence is enough (the child's file says the bar's button is the way out). With M1's row f: a page with no charset declared, as drawn. |
| **A media file** | a video in a side tab with the artifact player's zoom row under the file's bar, and a sound's small player in the middle of the body. |
| **The row a file keeps** | today's row, for a file of another machine past 64 MiB: "PDF files open outside MAWS", the size, "Open externally" with "on <machine>" (card 2). |
| **A response that ended in an error** | the body with the one sentence in the frame's place and the bar's button; and the frame half-drawn as Chromium leaves it, beside it, to show what the sentence replaces. |

The executor does not draw. The architect decides which of these go to the owner with the cards.

## The sentences a person reads

Every sentence this landing shows, once. New:

| where | the sentence |
|---|---|
| the body of a file whose response ended in an error (`VIEWER_COPY.frameChanged`) | "This file changed while it was loading. Open it again to see it." |

Reused as they are: "Open externally" (the bar's button; its title for another machine, "Opens a copy of this file from <machine> on this Mac", and "on <machine>" beside it); "Loading" (while a token is asked, the copy from another machine included); "Updated"; "File removed"; the row's "PDF files open outside MAWS" (and HTML, Audio, Video) with the size, for a file that is not drawn; "Refused: " and "Not opened: " before a failure's words.

A failure's words, printed after "Refused: " until U6b-4 words the refusals: the files service's and the link's own, unchanged; `fetchToFile`'s "<machine> sends this file only as text that isn't valid UTF-8, so it can't be copied here byte for byte" (exists); and main's "layout.frameFile: machine <ref> is not connected". Two more exist for a fault only and are not meant to be read: "layout.frameFile: too many file frames in this window", "layout.releaseFrame: no frame of this window".

Accessible names: a frame's `title` is the file's base name. No other name is added.

## The cards for the owner

Four choices a person sees that the child's file, the cut and the register do not settle. Each has a built default, so none holds a milestone. The most consequential first.

### Card 1 · An HTML file: the page alone, or the page and its source

**The question.** When you open an `.html` file in MAWS, it is now drawn as a page. Should its tab also let you see the file's code?

| option | what it means in use |
|---|---|
| **The page alone (recommended)** | The tab shows the page. To read or change its code you open it in an editor ("Open externally" today, "Open in" after U6b-4). It is what the item asks for, and before this landing the tab showed neither. |
| **Rendered and Source, as a Markdown file has** | The bar gains the two-way switch. Source shows the code, and inside the session's folders it can be edited and saved there; Rendered draws the saved file. More to build and to prove (a second read of the file as text, the editor's rules on a framed kind). |

**Built by default:** the page alone. **One place:** `hasSource` in `FileViewer.tsx` and the read a framed entry makes (M5, decision 2).

### Card 2 · What a PDF, a page or a clip says when it is still not drawn

**The question.** A file of another machine larger than 64 MiB is not drawn and keeps its row. The row says "PDF files open outside MAWS", which no longer reads true beside PDFs that are drawn. What should it say?

| option | what it means in use |
|---|---|
| **Today's words until the notices are worded together (recommended)** | The row is unchanged in this landing. U6b-4, which words every notice, gives it its sentence with the others, so the words are chosen once. |
| **A sentence of its own now** | For example "Too large to show here: MAWS copies at most 64 MB from another machine." It is truer at once, and is one more sentence U6b-4 may change again. |

**Built by default:** today's words. **One place:** `ExternalRow.tsx`, by the entry's `frame.why`.

### Card 3 · A video or a sound MAWS cannot play

**The question.** Some clips are in a format the built-in player does not play. What should the tab show?

| option | what it means in use |
|---|---|
| **The row, with "Open externally" (recommended)** | The tab shows the size and the button, as it does today for every video. Nothing looks broken. |
| **The player as it is** | A grey player that does not start, with "Open externally" in the bar above it. Nothing is hidden, and it can read as a fault. |

**Built by default:** the row. **One place:** `frameUnplayable` in the viewer store.

### Card 4 · The Download button inside a PDF

**The question.** Chromium's PDF viewer has its own toolbar, with a Download button. MAWS blocks every download from a file's frame, so the button does nothing, as it does today on a PDF delivered as an artifact. Keep the toolbar?

| option | what it means in use |
|---|---|
| **Keep the toolbar (recommended)** | Zoom, the page number and fit stay. Download does nothing and says nothing; "Open externally" in the bar above is how the file leaves MAWS. The same as a delivered PDF today. |
| **Hide the toolbar** | No dead button. Zoom is by pinch and the keyboard only, and the page number is gone. |

**Built by default:** the toolbar kept. **One place:** the URL `FrameBody` gives `PdfFrame` (a `#toolbar=0` fragment, which never reaches main).

## Size and review

Counted from the code at the pin, by the files each milestone names and the size of their nearest neighbours (the store's handler and its suite, the remote responder and its suite, the viewer's suite).

| milestone | source | unit tests | scenes | files |
|---|---|---|---|---|
| M1 (spike; not product) | — | — | about 500 lines of harness and findings | 6 |
| M2 the raw read | 75 | 290 | — | 7 |
| M3 tokens, sources, responder | 450 | 760 | — | 11 |
| M4 commands, owner's check, partitions | 260 | 560 | — | 19 |
| M5 the window | 380 | 720 | — | 11 |
| M6 scenes and record | — | — | 760, and about 40 of tracker and generated lines | 7 |
| **the landing** | **about 1,170** | **about 2,330** | **about 800** | **about 55** |

About 4,300 changed lines over about 55 files, the spike beside them (R6). Two thirds are tests and scenes: every refusal and every sequence above is a named case.

**The branch review is the xhigh panel** (`doperpowers:review-code`), because the root names this route delicate (UC-10) and by size. Its lenses:

1. **Admission.** Every byte served was read by `files.read` for that session at that request, with the session and the path the command gave; nothing is served from a path main built or from a value the window said later.
2. **Containment.** Each decision of main's policies with a token host; what a hostile page and a hostile PDF reach; the three partitions; that a file's HTML frame is given no bridge.
3. **Bytes and versions.** Raw ranges at character boundaries and with invalid UTF-8; the identity across a response and inside one read; the range arithmetic and the headers.
4. **Lifetimes.** The entry's frame through every event of the table; no token, descriptor or copy left behind on any path (a close mid-ask, a page's end, a failed copy, a quit).
5. **Other machines and other builds.** Nothing new asked of or offered to another machine; what build M and build F do in each direction; the minor alone in its commits.
6. **What the person sees.** The kinds table, the bar, the row and its reasons, a move and a hide, the one new sentence.

## Proof that an executor does not run

Each is a step for the architect, with what it needs.

1. **The spike on a Mac, before M4** (a real stop; R1, R4). What to run: `cd spikes/file-frame && node run.mjs` on a Mac, with a person watching the screen for row e. Needs: a Mac under the load rule; nothing of the owner's. What each outcome means: M1's "Promote or discard". The verdict and the rulings on R1 and R4 go into this document's Decision Log before M4 starts.
2. **The Mac lane's unit cases** (probe 7, third part): `scripts/ci-gate.sh <worktree> --gates unit:darwin --runner macos` on a head that holds M2; the two raw cases of `src/services/files/service.test.ts` are among those the lane runs.
3. **The new and reworked scenes, each alone, then their groups**, on a Mac under the load rule: Interfaces §H. The containment scenes and the token scene of `e2e:deliverables` first, since a failure there holds the landing.
4. **The two cross-build runs:** `e2e:cross-build` with `--peer-exact f1852de3a` and with `--peer-exact 2c7044231`, the new scene among those run and not skipped in its first half. They load a LaunchAgent and so run in CI alone.
5. **Class 1a**, once, when the branch is complete: `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b-2`.
6. **The branch review:** the panel, with the six lenses.
7. **A look by hand, on a Mac, with invented files:** a real PDF of many pages (scroll, zoom, a link, Download, print from the viewer's toolbar); a page with a stylesheet and a script beside it, and one with non-ASCII text and no charset declared; a long video (seek far ahead, move the tab to the main area and back, hide and show it); a sound; a file of another machine's session; a PDF outside the folders that the transcript names, replaced on disk and shown again.
8. **The owner's cards and drawn states** ("The cards for the owner", "The look"), if the architect sends them.
9. **Three routes.** A terminal session's PDF (B5) in `e2e:lane-a` or the sitting's script; no engine runs for this landing, since no engine fact is used (law 6 has nothing to verify here).

## The pull request

Its body names its class 1a run, the Mac lane's unit run, the review's verdict with what was dismissed or deferred, the two cross-build runs with their exact peers, the Mac runs of §H's groups, the spike's verdict, and its residue. This landing reverses no ruling of the owner's, so it carries no amendment of the charter. It carries:

- **`docs/tech-debt-tracker.md`:** M6's decision 4.
- **The coverage table** in `e2e/cross-build.spec.ts`: the row of §B.

What the pull request tells the owner beyond the item: a PDF or a page moved to the main area, or hidden and shown again, starts from its beginning (only a video's or a sound's position is kept); the Download button inside a PDF does nothing, as on a delivered PDF; an HTML page is drawn without the files beside it and without any network; a file of another machine is drawn from a copy of at most 64 MiB, fetched again when the file changes; and a PDF or a page by a path can come from anywhere the agent read, so its frame is held to the same limits as a delivered artifact's, with the one relay over TCP the tracker already names.

## Surprises & Discoveries

- Observation: Electron 44.4.5 tells a scheme handler nothing of the window that asks; the asking web contents is known only to the partition's request filter.
  Evidence: `electron.d.ts` on the build VM at `281ef5a6c`: `handle(scheme: string, handler: (request: GlobalRequest) => (GlobalResponse) | (Promise<GlobalResponse>)): void`, its one addition "`request.initiatorOrigin` is set to the origin that issued the request"; `interface OnBeforeRequestListenerDetails { … webContentsId?: number; … frame?: (WebFrameMain) | (null); … }`. Hence R1.
- Observation: the window's policy names the store's scheme for images and fonts as well as for frames and media.
  Evidence: `src/main/csp.ts`: `['img-src', "'self'", 'data:', 'blob:', 'maws-artifact:']`, `['font-src', "'self'", 'data:', 'maws-artifact:']`. Hence R2.
- Observation: at the pin an `.html` file opened by a path shows neither its page nor its code: `externalKindOf` sends `text/html` to the row before the text kinds are considered.
  Evidence: `tools/code/viewer/kinds.ts`, `kindOf`. Hence card 1.
- Observation: a main-owned command whose input names a session on another machine is refused by the router unless its name is in one of four lists.
  Evidence: `src/main/ipc/router.ts`, the test before `remote(target, …)` in `dispatch`. Hence R8 (c).

## Decision Log

1. **2026-11-15 (UTC) · The verification call.** This document gets an adversarial review before an executor starts (the architect dispatches it). The branch gets `doperpowers:review-code` at the **xhigh panel**, because the root calls the route that serves a session's file to a frame delicate (UC-10) and by size (about 4,300 changed lines over about 55 files); its lenses are the six of "Size and review". Class 1a on GitHub Actions is the gate of record; the Mac lane runs the two macOS-only cases of the raw read; two cross-build runs are owed, with build F and with build M as the exact peer.

## Outcomes & Retrospective

Pending — written at finish.
