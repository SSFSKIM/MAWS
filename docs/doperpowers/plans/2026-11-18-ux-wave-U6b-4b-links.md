# UX wave · U6, landing U6b-4b: every form of link, a refusal that says why, and localhost

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*): its item "O-37 · a linked file opens in MAWS, and a refusal says why" (the notice table, "Every form of link opens", the instructions' sentence), its item "l9-browser-delivery-03 · a localhost link opens in the in-app browser", and acceptance A5's rest and A6. Board ticket 673.
>
> **The cut:** `docs/doperpowers/plans/2026-11-14-ux-wave-U6b-cut.md`, section "U6b-4", decisions 1 to 7, cited below as *the cut*. Its decisions 8 to 10 ("Open in") were cut off as U6b-4a (`docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md`, on `ux-wave/U6b-4a`), by the cut's own line "Two parts that can be cut off again". This document is the rest: **U6b-4b**.
>
> **Parent pin:** `eb7f378ee8f8ca5fa5b944ade7b7e0ef8fc084b4`, the head of `ux-wave/U6b-2` (master `bf0b3d2a4` plus U6b-2), the commit every statement about the code below was checked against. The root and the child's file are read on the branch `ux-wave-spec` (`d7724650c`), which holds the owner's answers of 2026-11-15.
>
> **Revision 2 (2026-11-18).** The adversarial review of the first writing (`e753956ff`) returned fifteen findings, seven of the first rank; each was checked in the cited code and all are accepted (Decision Log 6). What moved: the window tells an inline link from an autolink by the node's own span, not by an index into the text; M1 also closes a fault the rule has had since U6c (a link in a table cell the window never draws); the desk's web app keeps drawing a `file:` link as text; a web call's receipt joins the opener; Retry also works on a tab with unsaved edits; an artifact's view is told apart by its mount, not by `entry.artifact`; the tables of what must stay refused say "adds no evidence" where they said "refused"; the older builds' rows and the terminal's scene are corrected; four more points are reported.
>
> **Branch:** `ux-wave/U6b-4b`, cut from `ux-wave/U6b-2`, because A5 as a whole needs U6b-2's drawn PDF and media. This document carries the constraints and the milestones; the design is the child's file and the cut. **Not in this landing:** "Open in" (U6b-4a); the two links the owner answered on 2026-11-15, a link inside a shown Markdown file and a link in a subagent's own transcript ("The two links", below: reported, with the reason).

## Purpose

A link the agent writes should open whatever form it takes, and when it cannot open, MAWS should say why in words a person can act on. Today a `file://` link is plain text, a relative path is always refused, a path in a side question's answer or in a mod's pane does nothing when clicked, a refusal is printed as the command's own words ("Refused: files.read: refused grade by machine …"), and the dev server an agent starts on this Mac opens in the system browser while the same link from an agent on another machine opens inside MAWS.

After this landing: a `file://` link with no host opens as a path link does; a relative path opens against the session's working folder, and inside a shown Markdown file against that file's own folder; a path in a side question's answer and in a mod's surface opens the file; a refusal is one of six plain notices, with Retry where trying again can help; an `http` or `https` link to a loopback host from a session on this Mac opens in the in-app browser beside the transcript, and ⌘-click sends it to the system browser; the agent's instructions say which files a link opens and which it must deliver.

How to see it working: in a session on this Mac, have the agent write `[report](file:///<an absolute path inside the folder>)`, `[notes](docs/notes.md)` and `[app](http://localhost:5173/)`. The first two open beside the chat; the third opens in the Browser side surface, and with ⌘ held in the system browser. Click a link to a path that does not exist: the tab reads "No file at this path." with the path under it. Acceptance L1 to L15 below is the whole list.

## Progress

- [x] (2026-11-18) The cut's section, the child's items and the code read against the pin; the document written; four statements of the cut corrected (Decision Log 2 to 5).
- [x] (2026-11-18) The adversarial review of the first writing (`e753956ff`): fifteen findings, all accepted; revision 2.
- [ ] The architect's rulings on the points reported (P1 to P12).
- [ ] M1 — The `file:` form: the rule and the window read it alike.
- [ ] M2 — A relative path, and the chips that did nothing.
- [ ] M3 — The notice.
- [ ] M4 — Localhost.
- [ ] M5 — The sentence, the scenes, the record, and the acceptance run.

## Words used in this document

- **Build F, build M.** The two older builds that bind (root UC-14): build F is `f1852de3a`, kept as the build to go back to; build M is `2c7044231`, the build in use. Both are read with `git show <sha>:<path>`.
- **The daemon.** The background process that reads and writes a session's files for the window (`src/services/files/`, registered in `src/services/checkouts-root.ts`). Main and the window never read a session's file themselves.
- **The folders.** The folders a session may read: its roots as `rootsOf` gives them (`src/services/files/allowlist.ts`).
- **A path link, a chip.** A Markdown link the window draws as a clickable path: `remarkTranscriptSources` (`src/renderer/src/transcript/view/markdown/sanitize.ts`) rewrites its destination to the window's own scheme `maws-path:`, and `TranscriptLink` (`markdown/Link.tsx`) draws a `span` with the role of a button, `data-chip="path"`, whose click calls the mount's `openFile` action. It is never an element's `href`.
- **The rule.** U6c's rule of a file the transcript names: on this Mac a file outside the folders is read when the session's own transcript writes its path whole in a form the window makes a file click from. Its pure half is `src/shared/files/named.ts` (`clickPath` reads one link destination as the click reads it; `linkPaths` finds the destinations in a text; `rowClaimSteps` applies them to one transcript record). Its search is `src/services/files/named.ts`, asked by `precheck` in `src/services/files/service.ts` for a request of this machine that carries `named: true`.
- **A counted form, a result form.** U6e's two classes of a name: a person's own message, the agent's own text and a tool call's input are counted and admit a read and a save; what a tool returned, or a message someone else wrote, is a result form and admits a read only.
- **The differential.** `src/renderer/src/tools/code/named-links.test.tsx`: it draws strings with the window's own Markdown, clicks every chip, and holds two directions: what a chip asks for is among `linkPaths` of the string, and (over seeded strings) every path the rule names is a chip the window draws.
- **The opener.** The `openExternal` action a web link's click calls. For a mounted transcript it is the one registered in `src/renderer/src/App.tsx` (the block "P5 O7 M3"); a Markdown surface outside any transcript has the host's default, which only asks main.
- **A loopback host.** What `isLoopbackLink` (`src/shared/machine/loopback-link.ts`) answers true for: `localhost`, any `*.localhost`, all of 127.0.0.0/8, `0.0.0.0`, `[::1]`, `[::]`, and an IPv4-mapped form of those. **Forwardable** is the narrower `loopbackPort`: `http` or `https` on `localhost`, `127.0.0.1`, `0.0.0.0`, `[::]` or `[::1]`, which is what a link of a session on another machine is forwarded for.
- **The notice.** What the file viewer draws in place of a file it could not read: today `Refused` in `src/renderer/src/tools/code/viewer/FileViewer.tsx`, "Refused: " and the command's message.

## The landing's edge

**In.**

1. The `file:` form of a link (the cut's decision 3): in the window and in the rule, by one shared reader.
2. A relative path (decision 4): resolved in the window before the open.
3. The chips that do nothing (decision 5): a side question's answer, a mod's surface outside a transcript.
4. The notice (decisions 1 and 2): the entry keeps what the classifier needs, one pure classifier over the child's table and the two ruled cases (the cut's X7), Retry, Copy path; the same sentences for the Files list's own notices and for the line under "Open externally".
5. Localhost (decision 7): a link in a transcript's Markdown, the address on a web call's receipt (`transcript/view/cells/WebDetail.tsx`), and a link in a terminal.
6. The instructions' sentence (decision 6), with its dated lines.
7. The charter's three dated amendments the child's "Rulings reversed" gives to this landing (the `file:` link, the loopback link, the instructions).

**Not in, and whose.** "Open in" (U6b-4a). PDF, HTML and media drawn (U6b-2, on this branch's base). Review's refusals (U5's; `RefusedPath` in `tools/code/review/ReviewShell.tsx` stays). A save's failure sentences (U6e's). The line "No session grants access to this file" (the child's "Not included"). A loopback link outside a transcript and a terminal (a shown Markdown file, a side question's answer) and one in a mod's surface, inside a transcript or not (the surface takes the click of an `a[href]` itself and asks `layout.openExternal` with no machine): each opens in the system browser as today, since A6 speaks of the transcript and a mod's press is the mod's. That a mod's loopback link in a session of another machine opens this Mac's loopback is a fault that stands before this landing; it is reported (P10) and gets a tracker row. The desk's web app: it draws a `file:` link as text, as it did (decision 17). A setting for where links open; `~` expanded; a path recognised in prose (the child's "Not included"). ⌘ on a path link inside a plan card or a question sheet (`request-card/variants/Plan.tsx`, `tools/maws/ask/`), which drop the option today: U1's files, left for a ticket.

**The two links: reported, not built here.** The child's file (O-37, "What became of U6c's list for U6b's design") says U6b-4 builds two links the owner answered on 2026-11-15: a link inside a shown Markdown file's own text, and a link drawn in a subagent's own transcript, each opening a file outside the folders. Neither is among the cut's decisions 1 to 7, which were written while both were cards, and neither is "one place" as the cut sketched it. What follows shows that each needs a design of its own; it does not claim to be that design:

- The daemon cannot find the Markdown file by itself, so something must tell it which file; and every later read of the same tab (shown again, restored after a relaunch, drawn in a frame, opened outside MAWS, saved) needs the same answer again. Done on the request, that is a new key on four commands of the files service, a wire minor, and a key stored with the tab: in a Files tab's params that is a key of U6's own, but a file moved to the main area is a stored tab of an existing kind in `main.tabs`, to which root UC-14 lets no field be added while build F can be gone back to.
- A session can have thousands of subagent transcripts (`src/engine-host/fs/subagents.ts`). The search holds one job for the whole daemon and a waiter's patience of 8 s (`NAMED_WAIT_MS`), and keeps one checkpoint per session and path. Reading every subagent file changes that search's bounds and its memory; naming the subagent in the request is the same new key as above.
- Two questions are the owner's or the architect's: whether a file that only a Markdown file's text links can be saved (the owner typed that it should be editable; the write rule ruled on the same day counts only a person's message, the agent's text and a tool call's input for a save), and whether a relative link in a Markdown file that itself stands outside the folders opens its sibling (the child's file says a relative link never names a file outside the folders, for a reason, "no folder to resolve it against", that does not hold for a file).

Built here instead: neither source adds evidence. A path either of them writes opens exactly when the daemon's existing evidence admits it for the session (its own transcript names it, the person chose it, the agent sent it, the Library holds it), as today; acceptance L14 pins that, so this landing's changes to the rule and to relative paths cannot widen them unseen. The owner's two answers stay registered and unbuilt until that landing. The tracker's row of 2026-11-13 (a link drawn inside a subagent's drill-in) stays open. Recommended: a landing of its own (U6b-4c) with its own design and panel. One place a ruling changes: this paragraph and L14.

## What the code holds today (at the pin)

- **A `file:` link is text.** `remarkTranscriptSources` turns only a scheme-less destination into `maws-path:`; `transcriptUrlTransform` keeps `https`, `http`, `mailto` and the three chip schemes, so a `file:` href is removed and the link is a `span`. `clickPath` answers null for any destination with a scheme (`SCHEME`), after it has resolved Markdown's backslash escapes.
- **A relative path is refused.** `openFile` (`src/renderer/src/tools/code/open-file.ts`) normalises a path lexically and leaves a relative one relative; `precheck` answers `path must be absolute`. `src/renderer/src/tools/code/files/tabs.test.tsx` pins it ("a relative path chip opens beside the chat as it opens in a main tab": the text `Refused: path must be absolutesrc/a.ts`).
- **A shown Markdown file** (`tools/code/viewer/MarkdownView.tsx`) gives its Markdown an `openFile` bound to the entry's session; a relative link there is refused like any other. The same component draws a File artifact's Markdown: `DrawnFile` in `tools/artifacts/viewers/ByteViewer.tsx` mounts `FileBody` with the artifact's path, and passes `artifact` only when it has no session, so `entry.artifact` does not tell an artifact's view from a file's tab.
- **The callers of `openFile`**, beside the transcript's link: a read's and an edit's chip, a person's anchored comment, `side/ThreadView.tsx`, `panel/summary/Sources.tsx`, the plan card and the two question sheets, the Files tree and Open File…, Review's `Stack`, Source control (`tools/scm/`), an artifact's view, the agents' "Open full log" (`tools/agents/actions.ts`, which passes no session, so the adapter takes the session in front), and `show_pane` (`tools/maws/panes/connect.ts`). `show_pane`'s target is already absolute when it reaches the window: the tool resolves it against the agent's folder and checks that it is a file (`src/engine-host/tool-server/show-pane.ts`).
- **The rule names a link in a table cell the window does not draw.** `blocksOf` in `src/shared/files/named.ts` makes a context of every cell of a table's body row (`row`, over `cellsOf`); its table state keeps the quote's depth alone. The window draws as many cells as the table's head has: `tableRow` in mdast-util-to-hast renders `align.length` cells. A row with more cells than its head therefore holds links that are named and never drawn. This has stood since U6c, for the scheme-less form.
- **Chips with no action.** `side/BtwView.tsx` (a side thread's questions) and `side/BtwCard.tsx` (a session's own `/btw` card, made by U4a after the cut) mount `Markdown` with no provider. A mod's surface (`engine-surface/SurfaceTree.tsx`) takes the click of an artifact mention and of an `a[href]` in a capture handler; a path chip is neither, so it falls to the context's `openFile`, which is the transcript's inside a transcript row and a no-op in a composer site (`composer/frame/PluginSites.tsx`) and in a mod's pane (`engine-surface/PaneTool.tsx`).
- **The viewer keeps the message alone.** `fail(tabId, message, reason)` in `tools/code/viewer/viewer-store.ts` stores `answer.error.message` in `ViewerEntry.error`; the `code` and `issues` of the `IpcError` (`src/shared/ipc/errors.ts`: `{ code, message, issues? }`) are dropped at every call. `Body` draws `<Refused path message>`: `role="alert"`, `data-refusal`, `VIEWER_COPY.refused(message)` and the path.
- **What a failed read carries.** Every failure of the files service is a plain `Error`, so it arrives with the code `internal` and its message: `path outside the session's directories` (`FILES_REFUSAL`), `not found: <path>`, `path must be absolute`, `unknown app session: <id>`, `not a regular file: <path>`, `changed while reading: <path>`. For a session on another machine `refusalError` (`src/main/machines/remote/dispatch.ts`) makes: `host_unavailable` for the link's `offline` and `unavailable`; `timeout`; a code of `IPC_ERROR_CODES` passed through with its message (so the remote service's refusal sentence arrives word for word); and for anything else `internal`, the message `<command>: refused <code> by machine <name>`, and `issues: { refusal: <code> }`. A session on this Mac gets `host_unavailable` or `timeout` from `src/shared/host/host-supervisor.ts` when the daemon is not answering.
- **Only a session on this Mac asks by name.** `readChunk` in the viewer store sends `named: true` when `machineOf(appSessionId) === client.localMachine`. Build M's viewer does the same on every read of a session on this Mac; build F's sends no `named`.
- **A terminal session on another machine has no record** (`src/renderer/src/lane-a/remote-session.ts`: "It has no record"; its address is the machine and the engine's session id), and `files.read` is offered for a session MAWS runs there (`src/endpoint/offers.ts`, `laneBMachine('call')` with the target `appSessionId`).
- **In both older builds the Files surface reads `params.path`**, not `params.file` (`FilesTool.tsx` at `f1852de3a` and at `2c7044231`); neither has U6b-1's file tabs beside the chat.
- **Retry exists.** `openAgain(tabId)` in the viewer store reads an entry again when it is `revisitable` (an error, a named file or a failed frame, with no read pending and no unsaved edit). `FrameBody.tsx` uses it for "Open again".
- **The Files list has two notices** (`tools/code/files/FilesTool.tsx`): `RootsFailure`, for a list of roots that failed, and the tree's row for a root or folder whose listing failed (`data-notice="refused" | "error"`, from `rowsOf` in `files/tree.ts`). Both print `Refused: …` or `Could not list: …` from the message alone (`files/store.ts` keeps `{ status: 'error', message }`).
- **A web link's click drops ⌘.** `TranscriptLink`'s `a` calls `actions.openExternal(href, session)`; `openExternal(url, appSessionId?)` has no third parameter. A web call's receipt (`WebDetail`) calls `actions.openExternal(url)` with no session at all, so its address opens in this Mac's system browser whatever machine the session is on. The opener in `App.tsx` is `if (appSessionId == null || !openForwardedLink(appSessionId, url)) DEFAULT_ACTIONS.openExternal(url, appSessionId)`: a session on this Mac always reaches the system browser. `openForwardedLink` (`tools/browser/comment/actions.ts`) opens a forwardable link of another machine's session through `openBrowserUrl` with a forward, and refuses, with a line, a loopback link of such a session that is not forwardable.
- **A terminal's link** (`src/renderer/src/terminal/registry.ts`) opens only on ⌘-click, asks the forwarder first (`terminals.forwardLinksWith(openForwardedLink)` in `App.tsx`), and otherwise goes to `pty.openLink`. The forwarder is registered by `App` alone: `e2e/terminal.spec.ts` runs the `#panel` harness, which does not mount `App`, so a terminal there has none.
- **Retry does nothing on a tab with unsaved edits.** `fail` keeps the document of an entry with unsaved edits and sets `status: 'error'`, so the refusal shows over the edits; `revisitable` then answers false for it. `reasonOf` already reads such an entry as a `change` load, the load a watch's event starts, under which the document and its baseline stand (E5's commit-time rule).
- **The instructions** (`MAWS_SERVER_INSTRUCTIONS`, `src/shared/maws/instructions.ts`) are 635 characters and name no file link; with the browser's paragraph, 980. `src/shared/maws/search-tools.test.ts` pins the text and the length, and `instructions.test.ts` the sum and the bound of 2,048.

## The trust rules

This landing changes what a link may open in three places. Each rule is stated with what it leaves alone and with the cases that must stay refused; every such case is a test, in the file named, with its control in the same test (the form that should be found is found by the same reader).

### R1 · The `file:` form names exactly what the scheme-less form names

**The rule.** One function, `fileUrlRest` (Interfaces §A), answers for a string what follows `file://` when, and only when, the string begins with `file://` (the scheme in any letter case) followed by a third `/`: the rest then begins with `/`. The window and the rule both call it on the destination as Markdown gives it (backslash escapes resolved), and both then treat the rest exactly as they treat a scheme-less destination: the window writes `maws-path:<rest>`, and `clickPath` continues with the rest. So `clickPath('file://' + d)` equals `clickPath(d)` for every `d` that begins with `/`, and everything U6c proved of the scheme-less form (the URL-parse step, the refused percent escapes, the line suffix, the bounds of the scan) holds for the new form with no second proof.

**Why this, and what lost.** Parsing the `file:` URL with `new URL` and taking its `pathname` lost: it would decode and normalise by another parser than the click's, and a difference between two parsers is how a rule comes to name a path the person never saw as a link. A regular expression in each place lost: two copies drift.

**Only an inline link.** An autolink (`<file:///a>`) stays text, as the rule already reads it as no link (`autolinkEnd`); a reference is no `link` node and stays as it is. The window tells an inline link from an autolink by the node's own positions and by nothing else: a `link` node is an autolink exactly when its span, `position.end.offset - position.start.offset`, equals `url.length + 2` (the URL between `<` and `>`, which Markdown does not decode). An inline link's span is at least `url.length + 4`: `[`, `](` and `)` are four characters, and a destination as written is never shorter than its decoded form. A node that lacks either offset stays text. The test reads no source text, because an offset is not an index into the string the transformer is handed: micromark drops a leading byte order mark before it counts (`micromark/lib/preprocess.js`). Where the test errs it can only draw a chip the rule does not name, which a click then finds refused.

**A table's surplus cells.** M1 closes the fault "What the code holds" describes, for both forms, since prepending `file://` to a form with a hole proves nothing: the table state of `blocksOf` keeps the head's cell count (`isTableHeader` already computes it), and a body row gives a context for its first that many cells and for no other.

**While a text is still arriving.** The window draws a streaming block through `holdBackTable` and Streamdown's repair of unfinished Markdown (`Markdown`'s `live`), and the differential draws everything with `live` false. The rule reads a transcript's record, which is written when a block is whole, so the finished drawing is the one that counts; the new form's fixed rows are nevertheless run with `live` true and false, and that the seeded direction is static only is said in the test's header and in a tracker row.

**What it leaves alone.** No other scheme. `transcriptUrlTransform` is unchanged: a `file:` URL that is not turned still loses its `href`. No element carries a `file:` or `maws-path:` `href`. A request from another machine never reaches the rule (`precheck`'s `!remote`). A `file:` link in a counted form admits a save as a scheme-less link in that form does (U6e's rule, by the same `clickPath`); in a result form, a read only. The other evidence of `firstEvidence` (a file the person chose, one the agent sent, a record of the Library) is untouched and independent of the form.

**The daemon's build says what is named.** The rule runs in the daemon, on its own copy of the reading; it has always been so. With this build's daemon under build M's window, M draws no chip for the `file:` form, yet a read M makes by another way (a restored tab, an agent's `show_pane`) for a path the transcript writes in that form is admitted, because M asks by name on every read. The transcript does write the path as a link; what M lacks is the drawing. This is accepted and reported (P8), not negotiated: a capability exchange would be a wire change for a file the person's own transcript links.

**Stays refused, as tests.**

| # | the string, or the case | must be | test file |
|---|---|---|---|
| N1.1 | `[r](file://host/work/x.md)`, `[r](file://localhost/work/x.md)` (a host) | no chip; the rule names nothing | `src/shared/files/file-url.test.ts`, `src/shared/files/named.test.ts`, `named-links.test.tsx` |
| N1.2 | `[r](file:/work/x.md)`, `[r](file:work/x.md)`, `[r](file://)` | the same | the same three |
| N1.3 | `<file:///work/x.md>` (an autolink), a bare `file:///work/x.md` in prose, the form inside a code span, a fence and `$$` math | no chip; nothing named | `named.test.ts`, `named-links.test.tsx` |
| N1.4 | `[r][l]` with `[l]: file:///work/x.md` (a reference) | no chip; nothing named | the same two |
| N1.5 | `[r](files:///work/x.md)`, `[r](xfile:///work/x.md)`, `[r](http://file:///work/x.md)`, `[r](maws-path:file:///work/x.md)` | not read as the `file:` form | `file-url.test.ts`, `named.test.ts` |
| N1.6 | `[r](file:///work/%41.md)`, `[r](file&colon;///work/x.md)` | the rule names nothing (U6c's listed refusals, unchanged), whatever the window draws | `named-links.test.tsx`, "listed refusals" |
| N1.7 | a transcript whose only mention of an outside file is N1.1 to N1.4 | `names` answers `false`; `files.read` with `named: true` is refused with the refusal sentence | `src/services/files/named.test.ts`, `src/services/files/service.test.ts` |
| N1.8 | `[r](file:///out/x.md)` only in an MCP tool's result | `names` answers `'result'`; `files.writeOutside` is refused | `service.test.ts` |
| N1.9 | any rendered string of the suite | no element with an `href` that begins `file:` or `maws-path:` | `markdown/sanitize.test.tsx` |
| N1.10 | a text that begins with a byte order mark and then `[r](file:///work/x.md)`; the same with `<file:///work/x.md>` | the first is a chip and is named; the second is neither | `named-links.test.tsx` |
| N1.11 | a table whose head has two cells and whose body row has three, a link (each form) in the third; the control, the same link in the second | no chip and nothing named for the third; a chip and a name for the second; `names` answers `false` for a transcript that writes the path there alone | `named.test.ts`, `named-links.test.tsx`, `src/services/files/named.test.ts` |
| N1.12 | with the switch of decision 17 off (the desk's state) | `[r](file:///work/x.md)` is a `span` with no `data-chip`; a scheme-less link is the chip it was | `markdown/sanitize.test.tsx` |

In N1.7 and N1.8 "refused" is said of a session with no other evidence for the file; each has its control, the same request admitted when the person chose the file, which no form of link takes away.

The differential gains the form in both directions: rows in "a path chip asks for a path the rule names" (`file:///…`, with `#L12`, with `%20`, in angle brackets with a space, `FILE:///…`, `file:////…`), each run with `live` true and false; and the fragments `file://`, `file:///`, `FILE:///`, `<file:///`, `file://h/`, a byte order mark, and a table's head, delimiter row and a body row one cell longer in the seeded generator's alphabet, so "every path the rule names is a chip the window draws" is run over strings that mix the new form with the old and that can form a table.

### R2 · A relative path is resolved in the window, and names nothing

**The rule.** `openFile` resolves a path that does not begin with `/` before anything else reads it: against `options.base` when the opener gives one (a shown Markdown file gives its own folder), else against the working folder of the session (`workingFolder(record).path`, root UC-4; ruled X5 in the cut). The resolution is lexical (`normalizeLexically` of base, `/`, path) and reads no disk; for a session on another machine it is the same, against that session's record, and the read is made there. With no base (no session, a record not yet known, an empty folder, and a terminal session on another machine, which has no record) the path is left as it is, and the read's refusal is the notice's last row. An opener that passes `base: null` asks for no resolution at all: an artifact's view does (decision 4). The folder is always that of the session the read is then made for, the one `openFile` is given: no other session's folder is consulted, so a path resolved against one session is never read under another's rule.

**What it leaves alone.** The daemon's rule is not touched: the transcript wrote a relative string, `clickPath` of it is a relative path, and a relative path never equals the absolute path a read asks for. So a relative link opens a file only inside the folders (or one the transcript also names whole, by its absolute link), and `../` can lead nowhere a person could not already reach.

**Stays refused, as tests.**

| # | the case | must be | test file |
|---|---|---|---|
| N2.1 | `linkPaths('[x](../../outside/secret.md)')` and `linkPaths('[x](notes/a.md)')` | hold no path that begins with `/` | `src/shared/files/named.test.ts` |
| N2.2 | a transcript that writes `[x](../../outside/secret.md)`, asked for the absolute path the window resolves it to, in a session with no other evidence for that file | `names` answers `false`; the read is refused. Control: the same read is admitted once the person has chosen the file (the relative link took nothing away and gave nothing) | `src/services/files/service.test.ts` |
| N2.3 | a relative link in a shown Markdown file that stands outside the folders, to its sibling | resolved against that file's folder and asked with `named: true` for the entry's session: one `files.read` with exactly that path. That the daemon then admits nothing on the Markdown file's word is N2.2's | `tools/code/viewer/viewer.test.tsx` |
| N2.4 | an absolute path given with a `base`; a relative path given `base: null` | the first never re-based; the second left relative | `tools/code/files/tabs.test.tsx` |
| N2.5 | a relative path with no session (`null`) | left relative; the tab reads "No session grants access to this file" and makes no read (`FileBody`'s early return) | `tabs.test.tsx` |
| N2.6 | a relative path for a session whose record is not loaded, while another session with a record is in front | left relative; one read for the asked session, refused; the session in front's folder is not used | `tabs.test.tsx` |
| N2.7 | a Markdown File artifact's view, with a session and without one | a relative link there is left relative in both | `tools/artifacts/viewers/viewers.test.tsx` |

### R3 · A loopback link of a session on this Mac opens in that session's in-app browser

**The rule.** `openLinkInApp` (Interfaces §D) is the one decision for a web link out of a transcript's Markdown, a web call's receipt, or a terminal (the mounts it does not reach are in "Not in, and whose"), in this order: a link of a session on another machine goes to `openForwardedLink` and is never looked at again (forwarded, or refused with its line; unchanged, with or without ⌘); else, unless ⌘ was held in a transcript, a link whose scheme is `http:` or `https:` and whose host is a loopback host (`isLoopbackLink`) opens through `openBrowserUrl(appSessionId, url)` with no forward; else it is left to the surface (`layout.openExternal`, `pty.openLink`), as today.

**What it changes, said plainly.** No new address is reached: the link opens what it would have opened in the system browser, by the person's click, and the in-app browser already admits any `http` or `https` address, loopback included (`validateBrowserUrl`, `src/shared/browser/url.ts`). What changes is who can then see the page and where its address is kept. The page is a tab of the session's browser, in that browser's partition and with its cookies, not the system browser's; a connection of that session's agent to the in-app browser can list the tab, read its live address and drive it (`src/main/browser/cua/connection.ts`), and a side thread reaches its parent's browser; the tab's address, query and fragment included, its title and its session are stored in the Browser's own store (`tabs.json`, `src/main/browser/persist.ts`) and come back after a relaunch. That is the purpose (the dev server's page beside the chat, where the agent that built it can look at it), it is what a forwarded link of another machine's session already does, and ⌘ keeps the system browser one key away. The open itself is the Browser tool's `browser.tabs.open`, whose failure the tool already says in its own notice.

**Stays as today, as tests** (`src/renderer/src/tools/browser/local-link.test.ts` unless named):

| # | the case | must be |
|---|---|---|
| N3.1 | `http://localhost.example.com/`, `http://127.0.0.1.example.com/`, `http://localhost:3000@example.com/`, `https://example.com/?u=http://localhost:3000` | left to the surface: `openBrowserUrl` not called |
| N3.2 | `ftp://localhost/`, `ws://127.0.0.1:9/`, `file:///a` (a terminal passes other schemes to the forwarder) | left to the surface |
| N3.3 | a session on another machine with `http://app.localhost:3000/` or `http://127.0.0.2/` (loopback, not forwardable) | refused with `openForwardedLink`'s line; neither browser opens it. The local branch tests the session's machine itself and does not rest on the order of the branches |
| N3.4 | a session on another machine with a forwardable link, ⌘ held | forwarded, as without ⌘ |
| N3.5 | a session on this Mac, ⌘ held, `http://localhost:5173/` | `openBrowserUrl` not called; `layout.openExternal` asked once |
| N3.6 | no session (`null`): a Markdown surface outside a transcript | the host's `openExternal`, as today (`markdown/links.test.tsx`) |
| N3.7 | a side thread's link | opens in its parent's browser (`browserSessionOf`), as a forwarded link does |
| N3.8 | a web call's receipt (`WebDetail`) in a session on another machine, its address `http://localhost:3000/` and `http://app.localhost:3000/` | the opener is called with the row's session: the first forwarded, the second refused with the line; this Mac's browsers open neither (`transcript/view/cells/WebDetail.test.tsx`, with `local-link.test.ts`) |
| N3.9 | a web call's receipt in a session on this Mac, with and without ⌘ | as a Markdown link: the in-app browser, and with ⌘ the system browser |

### R4 · A chip that gains an action asks for its own session, by the ordinary rule

A side question's answer and a mod's surface get `openFile` bound to the session they belong to (a side thread's own id in `BtwView`, the session's in `BtwCard`, `site.appSessionId` in a mod's surface). No click source is added to the daemon's rule: neither text is a row of a transcript, so a path outside the folders that the session's transcript does not write stays refused (the child's file, "What became of U6c's list"). These mounts add no evidence: what opens is what the daemon's existing evidence admits for that session. In a mod's surface the action is given by a provider round the surface's Markdown, so the chip's own click carries the path, the line, ⌘, the keyboard's activation and the guard against a click that ends a selection (`TranscriptLink` keeps the line only in its click's closure; a handler outside it could not recover it). Tests (`side/BtwCard.test.tsx`, `side/SideTool.test.tsx`, `engine-surface/SurfaceTree.test.tsx`): a chip `[a](/work/a.ts#L12)` there calls `openFile` once, with the path, line 12, that mount's session and `main` as ⌘ was held, also while another session is in front, and also where the surface stands inside a transcript row; a chip to an outside path makes one `files.read` for that session and no other.

## Decisions settled at authoring

1. **The shared reader lives in a file of its own**, `src/shared/files/file-url.ts`, importing nothing. `sanitize.ts` is read by the desk's web app (`apps/desk-web`, through `transcript/view/markdown/Markdown`), and `named.ts` imports the anchor, composer and engine readers; importing it from the Markdown pipeline would pull those into that package.
2. **The scheme is matched in any letter case**, since the window's own gate lower-cases a scheme before it compares; the rest is taken byte for byte.
3. **A relative path is resolved inside `openFile`**, not at each caller, because every surface opens a file through it (C8c's seam; "What the code holds" lists the callers). `show_pane` gains nothing: its target is absolute before the window sees it. One caller passes no session, the agents' "Open full log" for an edit, and so resolves against the session in front; an edit's path is absolute in practice, the read is made for that same session, and the caller is U8's file: left as it is, with a tracker row. A path beginning with `~` is relative by this rule and reads "No file at this path." (`~` is the child's "Not included").
4. **A shown Markdown file resolves against the folder of the path its tab holds**, not its real path: the tab's path is what the person sees. An artifact's view resolves nothing (`base: null`): its path may be the store's, and a link there is as today. It is told apart by its mount, since `entry.artifact` is empty whenever the view has a session: `DrawnFile` says so to `FileBody`, which hands it to `MarkdownView` (one optional prop, in memory; nothing is stored).
5. **A tab restored with a relative path** stored by an earlier build is read as it is and shows the notice's last row; a click on the link opens it resolved. No stored value is rewritten.
6. **The entry keeps the code and the refusal**, beside the message: `ViewerEntry.failure` (Interfaces §C). The message stays in `error`, which `isNotFound`, the `unknown app session` test and the existing tests read. Nothing new is sent: all three are in the `IpcError` already.
7. **Retry is one new act of the store, `retry(tabId)`** (Interfaces §C), not `revisit`, which is an opener's act and takes the session and the agent's mark. For an entry `openAgain` would read, it is `openAgain`. For an errored entry with unsaved edits, which `openAgain` passes over, it starts the `change` load a watch's event starts, under which the document and its baseline stand; `revisitable` itself is not loosened, so a click on the link still reloads nothing over edits. If that load proves not to keep an edit when started this way, the executor stops and reports; the fallback is no Retry on such a tab, and a tracker row. The Files list retries with its own refresh.
8. **`data-refusal` and `role="alert"` stay on the notice**, with `data-notice-cause` added: unit tests (`tools/code/files/tabs.test.tsx`, `shell/transfer-file.test.tsx`) and two scenes (`e2e/code-tools.spec.ts`, `e2e/remote.spec.ts`) select them without reading the words.
9. **One classifier, three places.** The viewer's notice, the Files list's two notices and the line under "Open externally" (`tools/code/viewer/ExternalRow.tsx`) call `classifyFailure`. A folder is called a folder: for the Files list the subject word is "folder" and the two sentences that speak of opening a file are left out (the sentences are in "The sentences a person reads").
10. **The classifier tests a remote `grade` first, then the two codes, then the two messages** (Interfaces §C gives the order). A link that ended mid-call (`issues.refusal` of `closed` or `removed`) and any other refusal code fall to the last row, as the child's table has it.
11. **Copy path is on the first row only**, where the child's table puts it; every row shows the path.
12. **The local loopback test is the child's**: `http` or `https`, and `isLoopbackLink`. It is a function of the new file `tools/browser/local-link.ts`; `src/shared/machine/loopback-link.ts` is not edited (Decision Log 2 says why the cut's `loopbackPort` is not the gate).
13. **⌘ reaches the opener as a third argument**, `openExternal(url, appSessionId, { external: true })`, optional, so every other mount and the desk's web app compile unchanged. The keyboard's Enter on a focused link is the browser's own click and carries the modifier.
14. **A terminal has no second gesture**: a link there opens only on ⌘-click, so a loopback link of a terminal on this Mac opens in the in-app browser, whose own "Open in external browser" takes it further (the child's file, l9-browser-delivery-03).
15. **The sentence** is appended to `MAWS_SERVER_INSTRUCTIONS` after one space, exactly as Interfaces §E gives it: 197 characters with the space, 832 in all, 1,177 with the browser's paragraph, under root UC-15's 2,048. It keeps to what holds on every machine (ruled 2026-11-13) and names no `file://` form.
16. **The probe's snapshot is not recorded again.** The first entry of `OLDER_IN_SNAPSHOT` in `search-tools.test.ts` already holds the text the fixtures were served, and the case compares the rest against the source; the entry's `reason` gains this landing and its date, and the list stays two entries (the case reads it by position).
17. **The desk's web app draws as it did.** It mounts this same Markdown (`apps/desk-web/src/views/conversation/StreamView.tsx`) and gives it no file action, so a `file:` link turned there would become a button that does nothing where text stood, and the wave may not change what the desk draws. The turn is therefore behind one switch of `sanitize.ts`, `turnFileLinks` (Interfaces §A), off until the window's own `transcript/view/default-actions.ts` turns it on as it loads; the desk never loads that file. A scheme-less link is not behind the switch: it is the chip it was, on the desk too. Lost: turning on the desk as well (P9 puts it to the architect).
18. **The terminal's scene runs in the app**, not in `e2e/terminal.spec.ts`, whose harness mounts no `App` and so no forwarder (Interfaces §G).

## The sequences that must hold

**S1 · Retry.** The notice's Retry calls `openAgain`. (a) While the read it started is pending, a second press starts none (`revisitable` needs `pending === 0`): a test holds the first read open, presses twice, and counts one `files.read`. (b) A read that fails again draws the notice of its own cause, which may differ from the first (the machine came back, and the file is not there). (c) A read that never answers ends as the route's `timeout` and draws row 3. (d) The tab closed, or the same path opened for another session, while the read is held: the answer lands nowhere (U6c's W2 case, unchanged; one case here holds a Retry's read across it). (e) A tab with unsaved edits whose re-read failed: Retry with the read held open shows the notice still and the edit still held; answered with the file, the editor shows the edited text, still unsaved; answered with a failure, the notice again and the edit still held. No press of Retry is a button that does nothing: where neither read can start (one is pending), the button is drawn disabled.

**S2 · A relative open before the layout or the record is read.** `openFile` keeps an open made before the layout is read and makes it later. The path is resolved when the request is built, with the record known then; an open kept with a path still relative is resolved again when it is made. A test makes a relative open before hydration, with the record arriving in between, and finds one tab at the absolute path.

**S3 · A click on a loopback link while its session is not in view.** `openBrowserUrl` adds the Browser tab to the link's session without bringing it forward and says where it opened (`commentOpenedElsewhere`), as a forwarded link does. Nothing awaits.

## What is stored and sent, and what each older build does with it

No key is added and nothing new is sent over the wire. No command, event, key or schema changes; the wire's minor does not move; no commit of this landing touches `src/shared/ipc/`, and L15 checks it. The cut's "one new read of the daemon's" was `files.admit`, which went with U6b-4a (Decision Log 4). Two things do change in what existing channels carry: a loopback link's page becomes a tab in the Browser's own store, and the text of the `maws` server's instructions, sent at a session's start, is one sentence longer.

| what changes | build F (`f1852de3a`) | build M (`2c7044231`) | this build, then the older one, then this build |
|---|---|---|---|
| a Files tab's `file` is absolute where a relative chip made it (the same key and type, under `panelTools.params`; U6b-1's, its Interfaces §A) | reads `params.path`, which this build does not write: it draws its Files tree, and keeps `file` through its own writes | the same | this build finds the tab and its absolute path again; nothing an older build wrote is rewritten |
| a main file tab opened by ⌘ on a relative link holds the absolute path (the existing `path` of a tab of kind `file`) | reads the file by that path, as any main file tab | the same | the same file in each. A relative `path` an older build stored is read as decision 5 says |
| a Browser tab opened by a loopback link (the Browser's `tabs.json`: address, title, session, as every tab the person or the agent opens) | restores it as any tab | the same | the same tab in each |
| this build's window on an older daemon of this Mac, a `file://` link to an outside file | F's daemon has no rule of names: refused | M's `clickPath` answers null for a scheme: refused | the window draws the notice's first row; inside the folders the link opens on every daemon |
| an older window on this build's daemon | draws no chip for `file:`, and sends no `named`: an outside file is refused | draws no chip; a read it makes by another way (a restored tab, `show_pane`) for a path the transcript writes in the `file:` form is admitted, since M asks by name on every read ("The daemon's build says what is named") | the file this build opened stays readable under M |
| a session on another machine | read there, by that machine's build; a path outside its folders is refused there as today | the same | the notice's sentences are the window's own |
| a session started before this build | keeps the instructions it was first given (a session keeps its paragraph across resumes) | the same | new sessions read the sentence |

No row joins the cross-build coverage table (root UC-14): no key is added. One existing cross-build assertion, of this build's window, reads the old words and changes; the older window's assertion beside it keeps them (Interfaces §G).

## Acceptance

Each item is a behaviour a person can check. "Unit" runs on the build VM; a scene runs on a Mac and is the architect's to start.

- **L1** (A5). `[r](file:///<path inside the folders>)` in the agent's text is drawn as a path link and opens the file beside the chat; with `#L12` or `:12` at line 12; ⌘-click opens it in the main area. The same for a terminal session on this Mac, and for a session MAWS runs on another machine, read there. A terminal session on another machine is not claimed: it has no record and no offered read (P7); what it shows is whichever notice its refusal classifies to.
- **L2** (A5, O-37). On this Mac `[r](file:///<path outside the folders>)` in the agent's text opens that file, and it can be saved (U6e's rule); written only in an MCP tool's result it opens read-only.
- **L3** (R1). `[r](file://host/a)`, `[r](file:/a)` and `<file:///a>` are plain text with no chip, and no element of the page has an `href` that begins `file:`.
- **L4** (A5). `[n](docs/notes.md)` in the agent's text opens `<working folder>/docs/notes.md`. In a shown Markdown file at `<folder>/docs/guide.md`, `[s](setup.md)` opens `<folder>/docs/setup.md`.
- **L5** (R2). In a session with no other evidence for that file, `[x](../../<a folder outside>/secret.md)` draws the first notice and opens nothing.
- **L6** (decision 5 of the cut). A path in a side question's answer (the session's card, and a side thread's view) and in a mod's pane or composer site opens the file beside the chat of its session.
- **L7** (the notice, row 1). On this Mac a path outside the folders for which the session has no evidence (its transcript does not write it, the person did not choose it, the agent did not send it) reads: "This file is outside the folders this session works in." "MAWS opens a file from elsewhere only when this session's transcript links it." "Ask the agent to send the file to see it here.", the path with Copy path, and the command's words in small type. No line begins with "Refused" or with a command's name.
- **L8** (row 2). A path with no file reads "No file at this path."
- **L9** (rows 1 to 5, another machine). With the machine stopped: "<machine> is not reachable." and Retry; started again, Retry shows the file. A path outside its folders: "This file is outside the folders this session works in on <machine>." "MAWS reads only those folders on another machine." "Ask the agent to send the file to see it here." A `grade` refusal reads "<machine> does not have this session on record right now." with Retry for the person's own session, and "Your access to this session on <machine> does not include its files." for someone else's.
- **L10** (the cut's X7). With this Mac's daemon not answering: "MAWS's service on this Mac is not answering." and Retry. A `grade` refusal for a session with no listing: "This file could not be opened." and Retry.
- **L11**. The Files list says the same sentences for a root or folder it cannot list ("This folder is outside the folders this session works in.", "No folder at this path.", "<machine> is not reachable."), and the line under "Open externally" reads the first sentence of the cause.
- **L12** (A6). In a session on this Mac a click on `http://localhost:<port>/` opens that page in the Browser side surface of that session, and nothing reaches the system browser; ⌘-click opens it in the system browser and no Browser tab; `http://app.localhost:<port>/` and `http://127.0.0.2:<port>/` behave the same; `https://example.com/` opens in the system browser. The address on a web call's receipt behaves as a link does. In a terminal on this Mac ⌘-click on a printed `http://127.0.0.1:<port>/` opens the in-app browser. For a session on another machine a loopback link is forwarded as before, with ⌘ too.
- **L13** (decision 6 of the cut; unit). `MAWS_SERVER_INSTRUCTIONS` ends with the sentence of Interfaces §E; `search-tools.test.ts` holds 832 characters and the named tools `artifact_read`, `artifact_search` and `send_file`; `instructions.test.ts` holds 1,177.
- **L14** (the two links add no evidence; unit). A path link drawn in a subagent's own transcript, and one in a shown Markdown file, to a file outside the folders: one `files.read` for the session with `named: true` and no other key; refused when the session has no evidence for the file, and opened when its own transcript writes the same path or the person chose the file. `src/services/files/named.test.ts` holds that a path written only in a subagent's transcript file (`<session>/subagents/agent-<id>.jsonl`, beside a main transcript that does not write it) is not named.
- **L15** (nothing sent). No commit of this landing's own touches `src/shared/ipc` (`git log --no-merges --first-parent --oneline eb7f378ee..HEAD -- src/shared/ipc` prints nothing), and `src/shared/ipc/wire.test.ts` passes with the fingerprint it had.

## Constraints that bind every milestone

- **The build brief binds** (the wave's common brief for building a child): nothing is typechecked, linted, tested, built or started on the owner's MacBook (root UC-10); every check runs on the build VM in a checkout of the pushed head, under a time limit; the gate runs Node 22 where the VM runs a newer one; the VM's known failures are read against the brief's list and never edited away.
- **Laws 1, 3 and 5 of the root**, and its contracts: UC-3 and UC-8 (every edit in a file another child owns is the insertion Interfaces §F names, and nothing more), UC-4 (the working folder is read through `workingFolder`; `test/one-working-folder.test.ts` holds it), UC-7 (each act says what it does for a session on another machine), UC-11 (public repository: invented names, paths, hosts and text in every test, fixture and scene), UC-14 (the table above), UC-15 (the instructions change by the exact string and its dated lines).
- **The rule stays one-directional.** Every path the rule names is a chip the window draws; where a reading cannot tell, it names nothing. No change here may make `clickPath` answer for a string the window does not turn.
- **No schema, no wire.** A milestone that finds it needs a key, a command or an event stops and reports.
- **A test that asserts an absence** (no chip, nothing named, no call, no `href`) over input it builds by hand carries its control in the same test.
- **Tokens only** in renderer source; a ticket or item number is written in words there (the tokens guard reads `#` and digits as a colour). Run `test/support/tokens-guard.test.ts` with any milestone that adds renderer source.
- **No wall time is asserted**; a scene waits on a state it names.
- **Other packages read the app's source.** `apps/desk-web` imports `transcript/view/context`, `transcript/view/markdown/Markdown` (and through it `sanitize.ts` and `Link.tsx`) and `tools/code/copy.ts`. M1, M3 and M4 add `pnpm --filter desk-web typecheck`, `pnpm --filter desk-web build` and `pnpm --filter desk-web test` to their proof; each milestone lists the importers again, following imports until no new file appears.
- **Merge, never rebase or force-push.** Never push master or `ux-wave-spec`.

## Plan of Work

Five milestones, built in this order. M1 to M4 share no source file, but they share test files (M1 and M2: `src/shared/files/named.test.ts` and `src/services/files/service.test.ts`; M2 and M3: `tools/code/files/tabs.test.tsx` and `tools/code/viewer/viewer.test.tsx`; M1 and M4: `markdown/links.test.tsx`), so none is built beside another. M5 is last. Each is red first: its tests are written and seen failing before its source changes.

### M1 — The `file:` form: the rule and the window read it alike

**At its end.** A `file:` URL with an empty host is a path link in every Markdown surface, and the daemon's rule names the path it writes; every other `file:` form is text and names nothing.

**Touches.** New: `src/shared/files/file-url.ts` and `file-url.test.ts`. `src/shared/files/named.ts` (`clickPath`; and in `blocksOf`, the table's state and `row`). `src/renderer/src/transcript/view/markdown/sanitize.ts` (`remarkTranscriptSources`, and the switch). `src/renderer/src/transcript/view/default-actions.ts` (one call that turns the switch on). Tests: `src/shared/files/named.test.ts`, `src/renderer/src/tools/code/named-links.test.tsx`, `markdown/sanitize.test.tsx`, `markdown/links.test.tsx`, `src/services/files/named.test.ts`, `src/services/files/service.test.ts`.

**Interfaces.** Exposes §A. Consumes nothing.

**Decisions.** R1 whole; decisions 1, 2 and 17. The header comment of `named.ts` and of `Link.tsx` gains the form. `clickPath`'s character-reference test stays first and on the whole destination. The table's fix is its own commit, red first by N1.11 on the scheme-less form, before the `file:` form is added.

**Does not touch.** `transcriptUrlTransform`, the harden options, every scanner of `named.ts` but `blocksOf`'s table rows, `src/services/files/named.ts` and `service.ts` (their tests gain cases; their source does not change), `Link.tsx`'s code, anything under `apps/`.

**Proves.** L1 to L3's unit half; N1.1 to N1.12; the differential green in both directions with the new fragments. The differential's seeded case runs up to 300 s: give its command a limit of 600.

### M2 — A relative path, and the chips that did nothing

**At its end.** A relative path opens against the working folder, or against a shown Markdown file's own folder; a path in a side question's answer and in a mod's surface opens the file.

**Touches.** `src/renderer/src/tools/code/open-file.ts` (the resolution, `OpenFileOptions.base`); `tools/code/viewer/MarkdownView.tsx` (its `openFile` gives the base); `tools/code/files/tabs.ts` (the comment on `FilesTabParams.file`); `tools/code/viewer/FileViewer.tsx` and `tools/artifacts/viewers/ByteViewer.tsx` (the prop of decision 4); `side/BtwView.tsx`, `side/BtwCard.tsx`, `engine-surface/SurfaceTree.tsx` (one provider each: Interfaces §F). Tests: `tools/code/files/tabs.test.tsx` (the describe that pins the relative refusal is rewritten to the resolved open), `tools/code/viewer/viewer.test.tsx`, `tools/artifacts/viewers/viewers.test.tsx`, `side/BtwCard.test.tsx`, `side/SideTool.test.tsx`, `engine-surface/SurfaceTree.test.tsx`, `src/shared/files/named.test.ts`, `src/services/files/service.test.ts` and `src/services/files/named.test.ts` (N2.1, N2.2, L14).

**Interfaces.** Exposes §B. Consumes nothing of M1.

**Decisions.** R2 and R4; decisions 3 to 5; S2. A mod's surface gives its Markdown a provider whose `openFile` calls the registered one with `site.appSessionId`; its capture handler keeps the artifact mention and the `a[href]` and is not given the chip.

**Does not touch.** The daemon's source. `Link.tsx`. The plan card and the question sheets. `tools/agents/actions.ts`. What a chip looks like. The notice: where a case here ends in a refusal it asserts the request made and that `[data-refusal]` is drawn, in today's words; the classified sentences are M3's.

**Proves.** L4 to L6 and L14's unit half; N2.1 to N2.7; R4's cases.

### M3 — The notice

**At its end.** A file that cannot be read shows one of the six notices, with Retry and Copy path where the table has them and the command's words in small type; the Files list and the line under "Open externally" say the same sentences.

**Touches.** New: `src/renderer/src/tools/code/viewer/notice.ts` and `notice.test.ts`. `tools/code/viewer/viewer-store.ts` (`ViewerEntry.failure`; `fail` takes the error; `retry`), `tools/code/viewer/FileViewer.tsx` (`Refused` becomes the notice), `tools/code/viewer/ExternalRow.tsx`, `tools/code/copy.ts` (the sentences), `tools/code/files/store.ts`, `files/tree.ts` and `files/FilesTool.tsx` (the two notices), `tools/code/code.css` if the small line needs a rule, `src/renderer/src/test-support/code.ts` (its `fail` helper takes a code and issues). Tests: `viewer/viewer.test.tsx` (the cases that read `Refused: …`), `viewer/ExternalRow.test.tsx`, `files/files.test.tsx`, `files/tabs.test.tsx`, and whichever of the suites that mount `FileBody` read a refusal's words (`tools/artifacts/viewers/`, `tools/code/editor/`, `tools/code/review/`, `tools/scm/`, `shell/transfer-file.test.tsx`, `panel/TabStrip.test.tsx`).

**Interfaces.** Exposes §C. Consumes nothing of M1 or M2.

**Decisions.** Decisions 6 to 11; S1; "The look". The machine's name comes from the roster as the window already reads it (`remoteMachineName` in `lane-a/remote-session.ts`, or `machineName` in `stores/org-projects.ts`); `mine` is `useSessions`'s `listed.get(appSessionId)?.mine`, and `null` when there is no listing. `notice.ts` imports no store: its caller hands it the name and `mine`, so its tests are a table.

**Does not touch.** `NoSession`. `saveError` and the save's sentences. `isNotFound` and the "File removed" notice. Review. `tools/maws/actions.ts` (a delivered file's row). The files service.

**Proves.** L7 to L11's unit half: the classifier's table (every row for this Mac and for another machine, `mine` true, false and absent, a file and a folder, and one case per message of "What a failed read carries"); S1 (a) to (e); R4's and L14's refused cases now read the first notice; a notice never begins with "Refused" or with `files.`.

### M4 — Localhost

**At its end.** A loopback web link of a session on this Mac opens in the in-app browser from a transcript and from a terminal; ⌘-click in a transcript opens the system browser.

**Touches.** New: `src/renderer/src/tools/browser/local-link.ts` and `local-link.test.ts`. `transcript/view/markdown/Link.tsx` (the web link's click passes ⌘), `transcript/view/cells/WebDetail.tsx` (the receipt's click passes the row's session and ⌘), `transcript/view/context.tsx` (`openExternal`'s third parameter), `src/renderer/src/App.tsx` (the opener and the terminal's forwarder call `openLinkInApp`). Tests: `markdown/links.test.tsx`, and a new `transcript/view/cells/WebDetail.test.tsx` (no suite draws the receipt today).

**Interfaces.** Exposes §D. Consumes nothing of M1 to M3.

**Decisions.** R3; decisions 12 to 14; S3. `openForwardedLink` and `openBrowserUrl` are called, not edited.

**Does not touch.** `src/shared/machine/loopback-link.ts`, `tools/browser/comment/actions.ts`, `tools/browser/forward.ts`, `src/main/open-external.ts`, `src/renderer/src/terminal/`, a mod's surface's own `openExternal`, `transcript/view/default-actions.ts`.

**Proves.** L12's unit half; N3.1 to N3.9.

### M5 — The sentence, the scenes, the record, and the acceptance run

**At its end.** The instructions carry the sentence; the scenes of Interfaces §G are written and typecheck; the charter holds its three amendments; the acceptance's unit half and the whole unit suite have run.

**Touches.** `src/shared/maws/instructions.ts` and its header comment; `src/shared/maws/search-tools.test.ts`, `src/shared/maws/instructions.test.ts`; `docs/charter.md` (§12 C6 *Streamdown configuration*, §12 C9 *Copy, paste and links*, §13 X9, and one dated entry in §19); `docs/tech-debt-tracker.md` (the rows of "The pull request"); the scene files of §G.

**Interfaces.** §E, §G.

**Decisions.** Decisions 15 and 16. The three amendments, exactly: at C6, "Amended 2026-11-12 (UX wave, O-37): a `file:` URL with no host is read as the path it names and drawn as a path link; it is still never an element's href."; at C9, after the sentence on `openExternalUrl`, "except an http(s) link to a loopback host from a session on this Mac, which opens in the in-app browser (UX wave, 2026-11-12)"; at X9, "Amended 2026-11-12 (UX wave, O-37; landed 2026-11-18): the `maws` server's instructions gain one sentence on file links: a link to an absolute path opens a file inside the session's folders, and a file from anywhere else is delivered with `send_file`." The dates are the child's ("Rulings reversed").

**Does not touch.** The probe's snapshot and fixtures (`spikes/protocol-probe/`). `src/shared/maws/tools.ts`. Any source of M1 to M4, but for what a scene's typecheck shows wrong.

**Proves.** L13 and L15; the acceptance L1 to L15 read once against the tests and scenes that hold each, with the list in the hand-back; the whole unit suite, once; the script tests (the diff touches `e2e/`).

## Concrete Steps

All commands are run from the worktree `…/.claude/worktrees/ux-wave-U6b-4b` on the MacBook, and every check through the helper, which runs it on the build VM in a checkout of the pushed head. `V` below stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b-4b --`. The helper's exit status is the command's; never pipe it into `tail` or `head` without `set -o pipefail`.

Once, before M1:

    git fetch origin master && git merge origin/master
    git push
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'

The first call installs dependencies and takes a few minutes. Expect no error. Then read "Statements to check again" against the merged head.

Per milestone, after `git push` (each line is one call; expect every test file named to pass and eslint to print nothing). The folders are those that import what the milestone changes (the opener and the viewer are imported from `tools/`, `shell/`, `panel/`, `side/` and `request-card/`); a milestone that edits a test in a folder not listed adds that folder. Several of these folders hold files the build brief lists as timing out under load on the VM: read a time-out against that list and show the file passing alone.

    # M1 (shared, daemon and window: both TypeScript projects)
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
    V 'timeout 900 pnpm exec vitest run src/shared/files/ src/services/files/ src/renderer/src/transcript/ test/support/tokens-guard.test.ts'
    V 'timeout 600 pnpm exec vitest run src/renderer/src/tools/code/named-links.test.tsx'
    V 'timeout 300 pnpm exec eslint src/shared/files src/services/files src/renderer/src/transcript/view src/renderer/src/tools/code/named-links.test.tsx'
    V 'timeout 1200 bash -c "pnpm --filter desk-web typecheck && pnpm --filter desk-web build && pnpm --filter desk-web test"'

    # M2 (the window, and the two daemon suites that gain cases: both projects)
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
    V 'timeout 1500 pnpm exec vitest run src/renderer/src/tools/ src/renderer/src/shell/ src/renderer/src/side/ src/renderer/src/engine-surface/ src/renderer/src/panel/ src/renderer/src/request-card/ src/shared/files/named.test.ts src/services/files/service.test.ts src/services/files/named.test.ts test/one-working-folder.test.ts test/support/tokens-guard.test.ts'
    V 'timeout 300 pnpm exec eslint src/renderer/src/tools/code src/renderer/src/tools/artifacts/viewers src/renderer/src/side src/renderer/src/engine-surface src/shared/files src/services/files'

    # M3
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
    V 'timeout 1500 pnpm exec vitest run src/renderer/src/tools/ src/renderer/src/shell/ src/renderer/src/panel/ test/support/tokens-guard.test.ts'
    V 'timeout 300 pnpm exec eslint src/renderer/src/tools src/renderer/src/test-support src/renderer/src/shell src/renderer/src/panel'
    V 'timeout 1200 bash -c "pnpm --filter desk-web typecheck && pnpm --filter desk-web build && pnpm --filter desk-web test"'

    # M4
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
    V 'timeout 900 pnpm exec vitest run src/renderer/src/tools/browser/ src/renderer/src/transcript/ src/renderer/src/terminal/ src/renderer/src/engine-surface/ test/support/tokens-guard.test.ts'
    V 'timeout 300 pnpm exec eslint src/renderer/src/tools/browser src/renderer/src/transcript/view src/renderer/src/App.tsx'
    V 'timeout 1200 bash -c "pnpm --filter desk-web typecheck && pnpm --filter desk-web build && pnpm --filter desk-web test"'

    # M5
    V 'timeout 1500 pnpm typecheck'
    V 'timeout 300 pnpm exec vitest run src/shared/maws/ src/main/catalog/agents.test.ts'
    V 'timeout 600 pnpm exec eslint e2e src/shared/maws'
    V 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
    V 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'
    V 'timeout 3600 pnpm test'
    git log --no-merges --first-parent --oneline eb7f378ee..HEAD -- src/shared/ipc | wc -l

The last line is git alone, run in the worktree, and prints `0` (L15: no commit of this landing's own touches the wire; the merges of master are not counted). The whole unit suite runs once, here; read a failure against the build brief's list of the VM's own failures, and show each such file passing alone or failing the same way at the branch's base before setting it aside. If the head has taken a merge of master since a milestone's proof, run that milestone's set again, not the whole suite.

Then stop and hand back to the architect: what exists, each command with its result, what is not verified, the decisions made, anything that contradicts this document or the child's file, and the scene list of §G with the groups that must run. The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e: class 1a, the review of the branch and the pull request are the architect's.

## Interfaces and Dependencies

### §A. The `file:` reader (M1; `src/shared/files/file-url.ts`, new, imports nothing)

    /** What follows `file://` in a `file:` URL whose host is empty: a string that begins with `/`. Null for every other string. */
    export function fileUrlRest(url: string): string | null;

It answers non-null exactly when `url` matches `/^file:\/\/(?=\/)/i`, and then `url.slice(7)`. `clickPath(destination)` (`src/shared/files/named.ts`): after `const url = destination.replace(BACKSLASH_ESCAPE, '$1')`, the string it goes on with is `fileUrlRest(url) ?? url`; nothing else in the function changes. `remarkTranscriptSources` (`sanitize.ts`), for a `link` node: a scheme-less `url` becomes `maws-path:<url>` as today; else, when the switch is on, `fileUrlRest(url)` is non-null, both `position.start.offset` and `position.end.offset` are numbers and their difference is not `url.length + 2`, `url` becomes `maws-path:<rest>`.

    /** Whether a `file:` link is turned into a path link. Off until the window's `default-actions.ts` turns it on; the desk's web app never does. */
    export function turnFileLinks(on: boolean): void; // sanitize.ts; read by the transformer each time it runs

`blocksOf` (`named.ts`): its table state becomes `{ quote: number; cells: number }`, `cells` the head's cell count; `row` pushes a context for the first `cells` cells of a body row and for no other. The head row itself has exactly that many.

### §B. The relative path (M2; `src/renderer/src/tools/code/open-file.ts`)

    export interface OpenFileOptions {
      main?: boolean;
      keep?: boolean;
      asked?: 'agent';
      base?: string | null; // an absolute folder a relative path is resolved against; absent, the session's working folder; null, no resolution
    }
    /** `path` when it begins with `/`, or when `base` is not an absolute path; else `base`, `/` and `path`, lexically normal. Reads no disk. */
    export function resolveRelative(base: string | null, path: string): string;

`openFile` and `openFileWhenRead` resolve before they build their request (and `makeKept` again for a kept open whose path is still relative: S2); the base is `options.base`, else `workingFolder(record).path` of `useSessions.getState().records.get(appSessionId)`, else `null`. `MarkdownView` passes `base: dirname(entry.path)` for a file's tab and `base: null` for an artifact's view; `FileBodyProps` gains `artifactView?: boolean`, which `DrawnFile` sets and `FileBody` hands on. `TranscriptActions.openFile`'s signature does not change.

### §C. The notice (M3; `src/renderer/src/tools/code/viewer/notice.ts`, new, pure)

    import type { IpcErrorCode } from '@shared/ipc/errors';
    export interface FileFailure { code: IpcErrorCode; message: string; refusal: string | null } // refusal: `issues.refusal` when it is a string
    export const failureOf: (error: { code: IpcErrorCode; message: string; issues?: unknown }) => FileFailure;
    export type NoticeCause = 'outside' | 'not-found' | 'unreachable' | 'not-on-record' | 'no-access' | 'other';
    export interface FileNotice {
      cause: NoticeCause;
      lines: readonly string[]; // the sentences, in order; the first is the headline
      retry: boolean;
      copyPath: boolean;
      detail: string; // the command's own words, drawn small
    }
    export function classifyFailure(failure: FileFailure, where: { machine: string | null; mine: boolean | null; subject: 'file' | 'folder' }): FileNotice;

`machine` is the display name of the session's machine, and `null` for a session on this Mac. The first test that holds decides:

| # | test | cause | Retry |
|---|---|---|---|
| 1 | `machine !== null`, `refusal === 'grade'`, `mine === true` | `not-on-record` | yes |
| 2 | `machine !== null`, `refusal === 'grade'`, `mine === false` | `no-access` | no |
| 3 | `machine !== null`, `refusal === 'grade'`, `mine === null` | `other` | yes |
| 4 | `code` is `host_unavailable` or `timeout` | `unreachable` | yes |
| 5 | `message === "path outside the session's directories"` (`REFUSAL` in `tools/code/copy.ts`) | `outside` | no |
| 6 | `message` begins `not found:` | `not-found` | no |
| 7 | anything else | `other` | no |

`ViewerEntry` gains `failure: FileFailure | null`, set wherever `error` is set and cleared wherever it is cleared; `fail(tabId, error, reason)` takes the `IpcError`. The store gains `retry(tabId): void` (decision 7; S1) and a selector the notice draws Retry's disabled state from, `canRetry(entry)`: false while a read of the entry is pending. The Files list's store keeps the same beside its `message`. The notice's element keeps `role="alert"` and `data-refusal`, and carries `data-notice-cause`; Retry is a button `data-notice-retry`, Copy path a button `data-notice-copy`, the small line `data-notice-detail`.

### §D. The link opener (M4; `src/renderer/src/tools/browser/local-link.ts`, new)

    /** `http:` or `https:`, on a loopback host (`isLoopbackLink`). */
    export function isLocalWebLink(url: string): boolean;
    /** The one decision for a web link out of a session's transcript or terminal. True: it was taken (forwarded, refused with its line, or opened in the in-app browser). False: the surface opens it as before. */
    export function openLinkInApp(appSessionId: AppSessionId, url: string, options?: { external?: boolean }): boolean;

`openLinkInApp`: when the session is on another machine (`isAddress(id) && machineOf(id) !== ipc.localMachine`), return `openForwardedLink(appSessionId, url)`; else when `options.external` is not true and `isLocalWebLink(url)`, call `openBrowserUrl(appSessionId, url)` and return true; else false. `TranscriptActions.openExternal` becomes `openExternal(url: string, appSessionId?: AppSessionId | null, options?: { external?: boolean }): void`; `TranscriptLink`'s `a` passes `{ external: true }` when the click's `metaKey` is set and nothing otherwise; `WebDetail`'s button passes `useRowSession()` as the session and the same option. In `App.tsx` the opener is `if (appSessionId == null || !openLinkInApp(appSessionId, url, options)) DEFAULT_ACTIONS.openExternal(url, appSessionId)`, and the terminal's forwarder is `(appSessionId, url) => openLinkInApp(appSessionId, url)`.

### §E. The sentence (M5; `src/shared/maws/instructions.ts`)

Appended to `MAWS_SERVER_INSTRUCTIONS`, after its last full stop, beginning with one space:

    " A Markdown link to a file's absolute path, [its name](/absolute/path), opens the file in MAWS when it is inside this session's folders; deliver a file from anywhere else with mcp__maws__send_file."

197 characters. `search-tools.test.ts`: the word-for-word case and `toHaveLength(832)`; the named tools become `artifact_read`, `artifact_search`, `send_file`; the first entry of `OLDER_IN_SNAPSHOT` keeps its `held` text and its `since`, and its `reason` ends "; UX wave U6b-4b (2026-11-18) appended the sentence on file links, which the fixtures were not served". `instructions.test.ts`: `toHaveLength(1177)`.

### §F. Files other children own, or that no table names (root UC-8)

| file | owner | the insertion | milestone |
|---|---|---|---|
| `transcript/view/markdown/sanitize.ts` | UC-3 | the `file:` branch in `remarkTranscriptSources`, its import, and `turnFileLinks` | M1 |
| `transcript/view/default-actions.ts` | UC-3; **not in X8** | one call, `turnFileLinks(true)` | M1 |
| `transcript/view/cells/WebDetail.tsx` | UC-3; **not in X8** | the click passes the row's session and ⌘ | M4 |
| `tools/artifacts/viewers/ByteViewer.tsx` | U10's folder; **not in X8** | `DrawnFile` passes `artifactView` | M2 |
| `transcript/view/markdown/Link.tsx` | UC-3 (the cut's X8) | the web link's click passes `{ external: true }` under ⌘; the header comment | M4 |
| `transcript/view/context.tsx` | UC-3 (X8) | the third parameter of `openExternal` | M4 |
| `side/BtwView.tsx` | U5, the `/btw` files U4's (X8) | one `TranscriptActionsProvider` round the answer's Markdown | M2 |
| `side/BtwCard.tsx` | the same row; **not in X8** (U4a made the card after the cut) | the same provider | M2 |
| `engine-surface/SurfaceTree.tsx` | no row; **not in X8** | one `TranscriptActionsProvider` round the Markdown of `MarkdownNode` and of `CodeNode`, whose `openFile` calls the registered one with `site.appSessionId`; the capture handler is not edited | M2 |
| `tools/browser/local-link.ts` (new) | U12's folder, "U6 (the link opener)" | the file | M4 |
| `src/renderer/src/App.tsx` | no row | the two calls of §D | M4 |
| `tools/code/copy.ts` | U5 and U6, each its strings | the notice's sentences | M3 |
| `src/renderer/src/test-support/code.ts` | no row | `fail` takes a code and issues | M3 |
| `src/shared/maws/instructions.ts` | UC-15 | the sentence | M5 |
| `e2e/cross-build.spec.ts` | the cross-build proof (U13a began its table) | a second constant for this build's window; `FILES_REFUSED` stays for the older window (§G) | M5 |

Tests in suites other children own gain cases or change a string where they read a refusal's words or draw a mount of this table; each such edit is listed in the milestone's hand-back. The five marked **not in X8** are reported to the architect with this document (P3); each is the smallest insertion.

### §G. The scenes (M5 writes them; the architect runs them on a Mac)

| group | spec | the scene |
|---|---|---|
| `e2e` | `e2e/sessions.spec.ts`, the case "a file the transcript links opens from outside the session's folder, …" | gains: a `file:///` link to the outside file opens it; `[r](file://host/…)` draws no chip; a relative link opens the file in the working folder; a path the transcript does not write shows the first notice's three sentences and Copy path, in the window (today the case asserts the refusal on the wire alone) |
| `e2e:code` | `e2e/code-tools.spec.ts` | "the Files tree and the viewer use tokens only in both themes": the Files row reads the folder's first sentence in place of `Refused: …`; a new case: a path with no file reads "No file at this path."; the viewer's refusal step keeps selecting `[data-refusal]` |
| `e2e:remote` | `e2e/remote.spec.ts`, the case "A reaches B's mawsd over RL2, …" | a file outside B's folders reads the sentence that names B; B stopped: "<B> is not reachable." and Retry; B started, Retry shows the file; the existing step "M3: a dev server …" passes unchanged, and once more with ⌘ held |
| `e2e:browser` | `e2e/browser.spec.ts` | a session on this Mac whose transcript holds `[app](http://localhost:<port>/)` (a page the scene serves itself): a click opens a Browser tab at that address in the session's side column and `seamLines` holds no `openExternal` line for it; ⌘-click writes `openExternal http://localhost:<port>/` and opens no tab. Where this spec's harness cannot stage a transcript row, the scene goes into `e2e/sessions.spec.ts` with the same assertions, and the hand-back says so |
| `e2e` | `e2e/sessions.spec.ts`, a new case in the app (not `e2e/terminal.spec.ts`: its `#panel` harness mounts no `App`, so no forwarder is registered there, and its case "copies a selection and opens links externally" stays as it is) | a session's Terminal side surface prints `http://127.0.0.1:<port>/` and `https://example.org`; ⌘-click on the first opens a Browser tab at that address and writes no `openExternal` line to the seam; ⌘-click on the second writes one. The link's cell is found and clicked as `terminal.spec.ts`'s case does it, its helper moved to `e2e/support/` if it lives in the spec |
| `e2e:side` | `e2e/side.spec.ts`, case 5 (`/btw`) | the staged answer holds a path inside the folders; a click opens the file beside the chat |
| `e2e:cross-build` | `e2e/cross-build.spec.ts`, "(outside file, on the peer's daemon) …" | this build's window on the peer's daemon reads the first notice's first sentence, from a new constant; the case "(an outside file, both ways) …" asserts the older window and keeps `FILES_REFUSED`. No new case |

No spec file is added, so the gate's counts of spec files do not move. `e2e:tools` and the paid live group hold no scene that reads the instructions' text at the pin (no match for "instructions" in `e2e/maws-tools.spec.ts` or `e2e/maws-tools-live.spec.ts`); the unit tests of §E are its proof, and "Proof that an executor does not run" offers the live look.

### §H. What a later landing may rely on, by name

`fileUrlRest`; `resolveRelative` and `OpenFileOptions.base`; `classifyFailure`, `failureOf`, `ViewerEntry.failure` and the notice's four data attributes; `openLinkInApp` and `isLocalWebLink`; `openExternal`'s third parameter. U6b-4c, if it is cut, adds its click sources beside R1 and consumes `ViewerEntry.failure` for nothing new.

## The look

The notice stands where `Refused` stands, in the same block and tokens: the headline in the normal text colour and weight of the block today; the further sentences under it, each a paragraph; the path in monospace on its own line, with Copy path as a small quiet button after it (row 1 only); Retry as the block's one ordinary button, under the sentences; the command's words last, in the small muted size the viewer's bar uses for secondary text. In the Files list the row keeps its height and reads the first sentence, with the path as today; `RootsFailure` reads the sentences and offers the list's own refresh as Retry. Nothing is coloured as an error beyond what the block is today.

## The sentences a person reads

`<machine>` is the machine's display name. A folder's forms are the Files list's.

| cause | this Mac | another machine |
|---|---|---|
| `outside`, a file | "This file is outside the folders this session works in." "MAWS opens a file from elsewhere only when this session's transcript links it." "Ask the agent to send the file to see it here." | "This file is outside the folders this session works in on <machine>." "MAWS reads only those folders on another machine." "Ask the agent to send the file to see it here." |
| `outside`, a folder | "This folder is outside the folders this session works in." | "This folder is outside the folders this session works in on <machine>." |
| `not-found` | "No file at this path." / "No folder at this path." | "No file at this path on <machine>." / "No folder at this path on <machine>." |
| `unreachable` | "MAWS's service on this Mac is not answering." | "<machine> is not reachable." |
| `not-on-record` | — | "<machine> does not have this session on record right now." |
| `no-access` | — | "Your access to this session on <machine> does not include its files." |
| `other` | "This file could not be opened." / "This folder could not be listed." | the same |

Buttons: "Retry", "Copy path". The file's sentences are the child's table and the cut's X7, word for word; the folder's forms and "This folder could not be listed." are this document's (decision 9).

## Points reported to the architect

Each has the default this document builds and the one place a ruling changes.

| # | the point | evidence | the default built | the one place |
|---|---|---|---|---|
| P1 | **The two links are not in this landing.** | "The two links", above | today's behaviour, pinned by L14; a landing of its own recommended | the edge and L14 |
| P2 | **The cut's gate for a local loopback link is narrower than the child's file.** | Decision Log 2 | the child's: `http` or `https`, and `isLoopbackLink` | `isLocalWebLink` |
| P3 | **Five insertions outside the cut's X8.** `side/BtwCard.tsx`, `engine-surface/SurfaceTree.tsx`, `transcript/view/default-actions.ts`, `transcript/view/cells/WebDetail.tsx`, `tools/artifacts/viewers/ByteViewer.tsx`. | Decision Log 3 and 6; §F | made, as the smallest | §F |
| P4 | **A folder is not "this file".** The cut says the Files list takes the same sentences; said of a folder they would be false. | `RootsFailure` and the tree's row list folders | the folder's forms of "The sentences a person reads" | that table |
| P5 | **After U6f the second sentence for another machine is false for a machine's owner**, who can then open a file outside the folders there ("MAWS reads only those folders on another machine."). | the child's O-37, "On another machine" | the table's sentence, as the child's file words it "until U6f lands" | the `outside` row, another machine |
| P6 | **The sentence's exact words** are this document's; the child's file gives its content only. | §E | §E | §E |
| P7 | **A5's fourth route has nothing to stand on.** The child's A5 names "a terminal session … on another machine". Such a session has no record, so no working folder, and `files.read` is offered there for a session MAWS runs. | `lane-a/remote-session.ts`; `src/endpoint/offers.ts` | not claimed: L1 says so; a click there shows the notice its refusal classifies to | L1 |
| P8 | **Under build M's window, this build's daemon admits a file M never drew a link for**, when the transcript writes it in the `file:` form and M asks by another way. | M's `readChunk` sends `named` on every read of a session on this Mac | accepted: the daemon's build says what is named; no wire change | R1, "The daemon's build says what is named" |
| P9 | **The desk's web app.** Turning the `file:` form there would draw a dead button where text stood; scheme-less links are such dead buttons there already. | `apps/desk-web/src/views/conversation/StreamView.tsx` gives no file action | the desk draws as it did, by the switch of decision 17 | `turnFileLinks` |
| P10 | **Two faults that stand before this landing and are not built here.** A mod's loopback link in a session of another machine opens this Mac's loopback (`SurfaceTree.tsx` asks `layout.openExternal` with no machine); the agents' "Open full log" for an edit opens for the session in front, not the cell's. | "Not in, and whose"; decision 3 | a tracker row each | the tracker |
| P11 | **The rule named links in table cells the window never draws**, since U6c. | "What the code holds" | fixed in M1, for both forms; the pull request says it changes what build M's rule would have admitted | R1, "A table's surplus cells" |
| P12 | **"Not reachable" also covers a machine that answered `unavailable`** (reached, but its service could not answer), and a link that ended mid-call reads "This file could not be opened." | `refusalError` maps `offline` and `unavailable` to `host_unavailable`, and `closed` and `removed` to `internal` with `issues.refusal` | the child's table, by code | the order of §C |

## Proof that an executor does not run

- **The scenes of §G, on a Mac**, under the load rule: `e2e` (the two cases of `sessions.spec.ts`), `e2e:code`, `e2e:remote`, `e2e:browser`, `e2e:side`, `e2e:cross-build`, and `e2e:terminal` once, to show its harness case unchanged. Each needs the pushed head that holds M5; `e2e:remote` and `e2e:cross-build` need what those groups always need (a second machine's build; the peer build).
- **Class 1a** (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b4b`) and, because three files the desk's web app reads change, the desk-web e2e on Linux.
- **The branch review**: the xhigh panel (Decision Log 1).
- **A live look at the sentence**, optional and paid: one new session asked to point at a file it wrote inside its folder and one outside; expected, a path link for the first and `send_file` for the second. Nothing waits for it.
- **The owner.** No answer is needed to build this document. A drawn example of the six notices (this Mac and another machine side by side) would let the owner see the words in place before M3 is built; it is advised, not required, since the words are the child's table. The two links (P1) carry two questions that are the owner's.

## Size and review

About 2,300 changed lines over about 58 files, tests and scenes included: M1 about 430 over 11 files, M2 about 420 over 16, M3 about 760 over 16, M4 about 270 over 8, M5 about 420 over 13 (six of them scene files). The branch takes the **xhigh panel**, as the cut's table names for U6b-4: by size it is past the mark, and it edits the rule of what a transcript names, which the root calls a security boundary; one reviewer of the panel reads R1 to R4 and their tables against the diff.

## Statements to check again on the head this landing is built on

The branch is cut from U6b-2 and merges master first. Landings that may be on that head and touch what this document rests on:

- **U6b-4a ("Open in")** adds controls to the file's bar in `FileViewer.tsx` and strings to `tools/code/copy.ts`: merge keeps both; `Refused` is not its.
- **The Office previews and any landing of U10 in `tools/artifacts/viewers/ByteViewer.tsx`**: read again how `DrawnFile` mounts `FileBody` (decision 4).
- **U6f (an outside file on another machine)** changes what a session on another machine may read and may change `readChunk`'s `local` test and the remote read's errors. Read again: "Only a session on this Mac asks by name"; the classifier's row 5 for another machine; and P5.
- **U6b-3 (Files' Changed group, Go to file)** edits `FilesTool.tsx`, `files/store.ts` and `files/tree.ts`: read again where the two notices are drawn and what the store keeps of an error.
- **U6b-5a (the keyboard)** gives the Files tab the keyboard: the notice's Retry must be reachable by Tab inside the tab's panel, and adds no key of its own.
- **Any landing of U5 or U4 in `side/`**, and of U2b in `engine-surface/`: read again where each mounts `Markdown`.
- `MAWS_SERVER_INSTRUCTIONS` is 635 characters and its browser paragraph 343: if another landing has moved either, the three numbers of §E move with it and the sum is reported.

## The pull request

Its body names the class 1a run, the panel's verdict and the residue, and carries the three dated amendments of M5 where they stand. It says that M1 narrows the rule (a link in a table cell the window does not draw is no longer named). Tracker rows it adds: the two links (a link inside a shown Markdown file; the row of 2026-11-13 for a subagent's drill-in is kept and pointed at the same place); ⌘ on a path link inside a plan card and a question sheet; a loopback link outside a transcript and a terminal opens in the system browser; P10's two faults; the differential's seeded direction is static only; P12's two wordings, if the architect leaves them.

## Surprises & Discoveries

- Observation: a session's own `/btw` no longer answers in `BtwView`; since U4a it answers in `BtwCard`, which mounts its answer's Markdown with no file action either.
  Evidence: `side/BtwView.tsx`'s header ("since a session's own `/btw` answers in its card (BtwCard.tsx), this view is a side thread's"); `session/SessionPane.tsx` mounts `BtwCard`.
- Observation: every failure of the files service arrives with the code `internal`; only the message tells an outside path from a missing one. The codes tell only the route's own failures.
  Evidence: `src/services/files/service.ts` throws plain `Error`s (`FILES_REFUSAL`, `not found: …`); `refusalError` in `src/main/machines/remote/dispatch.ts`.
- Observation: `loopbackPort` is narrower than `isLoopbackLink` in hosts as well as in schemes.
  Evidence: `FORWARDABLE_HOSTS` in `src/shared/machine/loopback-link.ts`; `loopback-link.test.ts` pins `http://app.localhost:3000` as loopback and not forwardable.
- Observation: a node's offset is not an index into the text a remark transformer is handed. Streamdown runs the processor as `runSync(parse(markdown), markdown)`, but micromark skips a leading byte order mark before it counts.
  Evidence: `streamdown` 2.6.0, `dist/chunk-YOKDWASO.js`; `micromark/lib/preprocess.js` (`if (value.charCodeAt(0) === 65279) startPosition++`).
- Observation: the rule has named, since U6c, a link the window never draws: one in a table body row's cell past the head's width.
  Evidence: `row` in `blocksOf` (`src/shared/files/named.ts`) pushes every cell of `cellsOf`; `tableRow` in `mdast-util-to-hast/lib/handlers/table-row.js` renders `align.length` cells.
- Observation: `e2e/terminal.spec.ts` cannot show a terminal's link opening inside the app.
  Evidence: it loads the `#panel` harness (`harness/main.tsx`: `PanelHarness`); `terminals.forwardLinksWith` is called from `App.tsx` alone.

## Decision Log

1. **2026-11-18 · The verification call.** This document gets an adversarial review before an executor starts (buildability and the trust rules). The branch gets the `doperpowers:review-code` xhigh panel, which the cut's table names for U6b-4 by size and because it edits the rule of what a transcript names. Class 1a on GitHub Actions is the gate of record; the scenes of §G run on a Mac.
2. **2026-11-18 · The cut's decision 7 corrected: the gate.** The cut says "`isLoopbackLink` also answers for other schemes, so the gate is `loopbackPort`'s". `loopbackPort` also drops `*.localhost` and the rest of 127.0.0.0/8, which the child's file names as opening in the in-app browser. Built: `http` or `https`, and `isLoopbackLink`. Lost: `loopbackPort`, which is the rule of what can be forwarded from another machine, not of what is this Mac's loopback.
3. **2026-11-18 · The cut's decision 5 corrected: the places.** The cut names `side/BtwView.tsx` and "a mod's pane or composer site". The session's own side questions are in `side/BtwCard.tsx` since U4a, and a mod's surface is one component, `engine-surface/SurfaceTree.tsx`, whose capture handler is where a chip's click is taken. Both get the action; both are insertions the cut's X8 does not name.
4. **2026-11-18 · The cut's "Stored and sent" and "Scenes" corrected for the cut-off.** "One new read of the daemon's (a wire minor)" was `files.admit`, and `e2e:panel` (the title bar's menu) was "Open in": both went with U6b-4a. This landing sends nothing new and moves no wire minor. `e2e:cross-build` joins the scenes: one of its assertions reads the old words.
5. **2026-11-18 · The cut's decisions 1 and 6 corrected in a word each.** Decision 1: Retry is the store's `openAgain`, which reads again with what the entry holds; `revisit` is the opener's act. Decision 6: the instructions are 635 characters at the pin (the cut wrote "699 today, 635 once U6d lands"), and the snapshot's list needs no new entry, because its first entry already holds what the fixtures were served; its reason gains the date.

6. **2026-11-18 · The adversarial review of the first writing (`e753956ff`): fifteen findings, each read in the cited code, all accepted.** First rank. (1) The rule names a link in a table cell the window does not draw: fixed in M1 for both forms (R1; N1.11; P11). (2) An offset is not an index into the transformer's text (a byte order mark): the inline test is the node's own span (R1; N1.10); the new rows also run while streaming. (3) Build M's window on this build's daemon: stated and accepted (R1; P8). (4) A web call's receipt passed no session: it joins the opener (R3; N3.8, N3.9); a mod's own link is left and reported (P10). (5) A terminal session on another machine has no record and no offered read: not claimed (L1; P7). (6) `entry.artifact` does not tell an artifact's view: told by its mount, with `base: null` (decision 4; N2.7). (7) A handler outside the chip cannot recover the line: a provider in a mod's surface (R4; §F). Second rank. (8) "Refused" confused with "adds no evidence": the tables and L5, L7, L14 are qualified, each with its admitted control; a null session makes no read (N2.5, N2.6). (9) R3 does change who can see the page and where its address is kept: said so. (10) The older builds read `params.path`; the cross-build constant is split. (11) Retry on a tab with unsaved edits: the store's `retry` (decision 7; S1 (e)). (12) The terminal's scene moves into the app (decision 18; §G). (13) The desk's web app: the switch (decision 17; P9). (14) M2 no longer proves M3's sentences; the commands follow the importers and both TypeScript projects. (15) `show_pane` is already absolute, and "Open full log" passes no session (decision 3; P10). The reviewer judged leaving the two links out sound, and that the first writing's reasons did not show its sketch to be the only design: the paragraph now says so.

## Outcomes & Retrospective

Pending — written at finish.
