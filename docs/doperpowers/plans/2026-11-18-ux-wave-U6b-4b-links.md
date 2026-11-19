# UX wave · U6, landing U6b-4b: every form of link, a refusal that says why, and localhost

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*): its item "O-37 · a linked file opens in MAWS, and a refusal says why" (the notice table, "Every form of link opens", the instructions' sentence), its item "l9-browser-delivery-03 · a localhost link opens in the in-app browser", and acceptance A5's rest and A6. Board ticket 673.
>
> **The cut:** `docs/doperpowers/plans/2026-11-14-ux-wave-U6b-cut.md`, section "U6b-4", decisions 1 to 7, cited below as *the cut*. Its decisions 8 to 10 ("Open in") were cut off as U6b-4a (`docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md`, on `ux-wave/U6b-4a`), by the cut's own line "Two parts that can be cut off again". This document is the rest: **U6b-4b**.
>
> **Parent pin:** `eb7f378ee8f8ca5fa5b944ade7b7e0ef8fc084b4`, the head of `ux-wave/U6b-2` (master `bf0b3d2a4` plus U6b-2), the commit every statement about the code below was checked against. The root and the child's file are read on the branch `ux-wave-spec` (`d7724650c`), which holds the owner's answers of 2026-11-15.
>
> **Branch:** `ux-wave/U6b-4b`, cut from `ux-wave/U6b-2`, because A5 as a whole needs U6b-2's drawn PDF and media. This document carries the constraints and the milestones; the design is the child's file and the cut. **Not in this landing:** "Open in" (U6b-4a); the two links the owner answered on 2026-11-15, a link inside a shown Markdown file and a link in a subagent's own transcript ("The two links", below: reported, with the reason).

## Purpose

A link the agent writes should open whatever form it takes, and when it cannot open, MAWS should say why in words a person can act on. Today a `file://` link is plain text, a relative path is always refused, a path in a side question's answer or in a mod's pane does nothing when clicked, a refusal is printed as the command's own words ("Refused: files.read: refused grade by machine …"), and the dev server an agent starts on this Mac opens in the system browser while the same link from an agent on another machine opens inside MAWS.

After this landing: a `file://` link with no host opens as a path link does; a relative path opens against the session's working folder, and inside a shown Markdown file against that file's own folder; a path in a side question's answer and in a mod's surface opens the file; a refusal is one of six plain notices, with Retry where trying again can help; an `http` or `https` link to a loopback host from a session on this Mac opens in the in-app browser beside the transcript, and ⌘-click sends it to the system browser; the agent's instructions say which files a link opens and which it must deliver.

How to see it working: in a session on this Mac, have the agent write `[report](file:///<an absolute path inside the folder>)`, `[notes](docs/notes.md)` and `[app](http://localhost:5173/)`. The first two open beside the chat; the third opens in the Browser side surface, and with ⌘ held in the system browser. Click a link to a path that does not exist: the tab reads "No file at this path." with the path under it. Acceptance L1 to L15 below is the whole list.

## Progress

- [x] (2026-11-18) The cut's section, the child's items and the code read against the pin; the document written; four statements of the cut corrected (Decision Log 2 to 5).
- [ ] The adversarial review of this document, and the architect's rulings on it and on the points reported.
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
5. Localhost (decision 7), in a transcript and in a terminal.
6. The instructions' sentence (decision 6), with its dated lines.
7. The charter's three dated amendments the child's "Rulings reversed" gives to this landing (the `file:` link, the loopback link, the instructions).

**Not in, and whose.** "Open in" (U6b-4a). PDF, HTML and media drawn (U6b-2, on this branch's base). Review's refusals (U5's; `RefusedPath` in `tools/code/review/ReviewShell.tsx` stays). A save's failure sentences (U6e's). The line "No session grants access to this file" (the child's "Not included"). A loopback link outside a transcript and a terminal (a shown Markdown file, a side question's answer, a mod's surface): it opens in the system browser as today, since A6 speaks of the transcript. A setting for where links open; `~` expanded; a path recognised in prose (the child's "Not included"). ⌘ on a path link inside a plan card or a question sheet (`request-card/variants/Plan.tsx`, `tools/maws/ask/`), which drop the option today: U1's files, left for a ticket.

**The two links: reported, not built here.** The child's file (O-37, "What became of U6c's list for U6b's design") says U6b-4 builds two links the owner answered on 2026-11-15: a link inside a shown Markdown file's own text, and a link drawn in a subagent's own transcript, each opening a file outside the folders. Neither is among the cut's decisions 1 to 7, which were written while both were cards, and neither can be built as "one place" the way the cut sketched:

- The daemon cannot find the Markdown file by itself, so the read must name it; and every later read of the same tab (shown again, restored after a relaunch, drawn in a frame, opened outside MAWS, saved) must name it again. That is a new key on four commands of the files service, a wire minor, and a key stored with the tab: in a Files tab's params that is a key of U6's own, but a file moved to the main area is a stored tab of an existing kind in `main.tabs`, to which root UC-14 lets no field be added while build F can be gone back to.
- A session can have thousands of subagent transcripts (`src/engine-host/fs/subagents.ts`). The search holds one job for the whole daemon and a waiter's patience of 8 s (`NAMED_WAIT_MS`), and keeps one checkpoint per session and path. Reading every subagent file changes that search's bounds and its memory; naming the subagent in the request is the same new key as above.
- Two questions are the owner's or the architect's: whether a file that only a Markdown file's text links can be saved (the owner typed that it should be editable; the write rule ruled on the same day counts only a person's message, the agent's text and a tool call's input for a save), and whether a relative link in a Markdown file that itself stands outside the folders opens its sibling (the child's file says a relative link never names a file outside the folders, for a reason, "no folder to resolve it against", that does not hold for a file).

Built here instead: both keep today's behaviour, which acceptance L14 pins, so this landing's changes to the rule and to relative paths cannot widen them unseen. The tracker's row of 2026-11-13 (a link drawn inside a subagent's drill-in) stays open. Recommended: a landing of its own (U6b-4c) with its own design and panel. One place a ruling changes: this paragraph and L14.

## What the code holds today (at the pin)

- **A `file:` link is text.** `remarkTranscriptSources` turns only a scheme-less destination into `maws-path:`; `transcriptUrlTransform` keeps `https`, `http`, `mailto` and the three chip schemes, so a `file:` href is removed and the link is a `span`. `clickPath` answers null for any destination with a scheme (`SCHEME`), after it has resolved Markdown's backslash escapes.
- **A relative path is refused.** `openFile` (`src/renderer/src/tools/code/open-file.ts`) normalises a path lexically and leaves a relative one relative; `precheck` answers `path must be absolute`. `src/renderer/src/tools/code/files/tabs.test.tsx` pins it ("a relative path chip opens beside the chat as it opens in a main tab": the text `Refused: path must be absolutesrc/a.ts`).
- **A shown Markdown file** (`tools/code/viewer/MarkdownView.tsx`) gives its Markdown an `openFile` bound to the entry's session; a relative link there is refused like any other.
- **Chips with no action.** `side/BtwView.tsx` (a side thread's questions) and `side/BtwCard.tsx` (a session's own `/btw` card, made by U4a after the cut) mount `Markdown` with no provider. A mod's surface (`engine-surface/SurfaceTree.tsx`) takes the click of an artifact mention and of an `a[href]` in a capture handler; a path chip is neither, so it falls to the context's `openFile`, which is the transcript's inside a transcript row and a no-op in a composer site (`composer/frame/PluginSites.tsx`) and in a mod's pane (`engine-surface/PaneTool.tsx`).
- **The viewer keeps the message alone.** `fail(tabId, message, reason)` in `tools/code/viewer/viewer-store.ts` stores `answer.error.message` in `ViewerEntry.error`; the `code` and `issues` of the `IpcError` (`src/shared/ipc/errors.ts`: `{ code, message, issues? }`) are dropped at every call. `Body` draws `<Refused path message>`: `role="alert"`, `data-refusal`, `VIEWER_COPY.refused(message)` and the path.
- **What a failed read carries.** Every failure of the files service is a plain `Error`, so it arrives with the code `internal` and its message: `path outside the session's directories` (`FILES_REFUSAL`), `not found: <path>`, `path must be absolute`, `unknown app session: <id>`, `not a regular file: <path>`, `changed while reading: <path>`. For a session on another machine `refusalError` (`src/main/machines/remote/dispatch.ts`) makes: `host_unavailable` for the link's `offline` and `unavailable`; `timeout`; a code of `IPC_ERROR_CODES` passed through with its message (so the remote service's refusal sentence arrives word for word); and for anything else `internal`, the message `<command>: refused <code> by machine <name>`, and `issues: { refusal: <code> }`. A session on this Mac gets `host_unavailable` or `timeout` from `src/shared/host/host-supervisor.ts` when the daemon is not answering.
- **Only a session on this Mac asks by name.** `readChunk` in the viewer store sends `named: true` when `machineOf(appSessionId) === client.localMachine`.
- **Retry exists.** `openAgain(tabId)` in the viewer store reads an entry again when it is `revisitable` (an error, a named file or a failed frame, with no read pending and no unsaved edit). `FrameBody.tsx` uses it for "Open again".
- **The Files list has two notices** (`tools/code/files/FilesTool.tsx`): `RootsFailure`, for a list of roots that failed, and the tree's row for a root or folder whose listing failed (`data-notice="refused" | "error"`, from `rowsOf` in `files/tree.ts`). Both print `Refused: …` or `Could not list: …` from the message alone (`files/store.ts` keeps `{ status: 'error', message }`).
- **A web link's click drops ⌘.** `TranscriptLink`'s `a` calls `actions.openExternal(href, session)`; `openExternal(url, appSessionId?)` has no third parameter. The opener in `App.tsx` is `if (appSessionId == null || !openForwardedLink(appSessionId, url)) DEFAULT_ACTIONS.openExternal(url, appSessionId)`: a session on this Mac always reaches the system browser. `openForwardedLink` (`tools/browser/comment/actions.ts`) opens a forwardable link of another machine's session through `openBrowserUrl` with a forward, and refuses, with a line, a loopback link of such a session that is not forwardable.
- **A terminal's link** (`src/renderer/src/terminal/registry.ts`) opens only on ⌘-click, asks the forwarder first (`terminals.forwardLinksWith(openForwardedLink)` in `App.tsx`), and otherwise goes to `pty.openLink`.
- **The instructions** (`MAWS_SERVER_INSTRUCTIONS`, `src/shared/maws/instructions.ts`) are 635 characters and name no file link; with the browser's paragraph, 980. `src/shared/maws/search-tools.test.ts` pins the text and the length, and `instructions.test.ts` the sum and the bound of 2,048.

## The trust rules

This landing changes what a link may open in three places. Each rule is stated with what it leaves alone and with the cases that must stay refused; every such case is a test, in the file named, with its control in the same test (the form that should be found is found by the same reader).

### R1 · The `file:` form names exactly what the scheme-less form names

**The rule.** One function, `fileUrlRest` (Interfaces §A), answers for a string what follows `file://` when, and only when, the string begins with `file://` (the scheme in any letter case) followed by a third `/`: the rest then begins with `/`. The window and the rule both call it on the destination as Markdown gives it (backslash escapes resolved), and both then treat the rest exactly as they treat a scheme-less destination: the window writes `maws-path:<rest>`, and `clickPath` continues with the rest. So `clickPath('file://' + d)` equals `clickPath(d)` for every `d` that begins with `/`, and everything U6c proved of the scheme-less form (the URL-parse step, the refused percent escapes, the line suffix, the bounds of the scan) holds for the new form with no second proof.

**Why this, and what lost.** Parsing the `file:` URL with `new URL` and taking its `pathname` lost: it would decode and normalise by another parser than the click's, and a difference between two parsers is how a rule comes to name a path the person never saw as a link. A regular expression in each place lost: two copies drift.

**Only an inline link.** The window turns a `link` node only when the character at the node's start offset in the Markdown it was parsed from is `[` (the transformer's second argument is the file; Streamdown hands the block's own text, which the positions index). An autolink (`<file:///a>`) starts with `<` and stays text; a node with no position stays text. The rule already reads an autolink as no link (`autolinkEnd`), and a reference definition as no chip.

**What it leaves alone.** No other scheme. `transcriptUrlTransform` is unchanged: a `file:` URL that is not turned still loses its `href`. No element carries a `file:` or `maws-path:` `href`. A request from another machine never reaches the rule (`precheck`'s `!remote`). A `file:` link in a counted form admits a save as a scheme-less link in that form does (U6e's rule, by the same `clickPath`); in a result form, a read only.

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

The differential gains the form in both directions: rows in "a path chip asks for a path the rule names" (`file:///…`, with `#L12`, with `%20`, `FILE:///…`, `file:////…`), and the fragments `file://`, `file:///`, `FILE:///`, `<file:///`, `file://h/` in the seeded generator's alphabet, so "every path the rule names is a chip the window draws" is run over strings that mix the new form with the old.

### R2 · A relative path is resolved in the window, and names nothing

**The rule.** `openFile` resolves a path that does not begin with `/` before anything else reads it: against `options.base` when the opener gives one (a shown Markdown file gives its own folder), else against the working folder of the session (`workingFolder(record).path`, root UC-4; ruled X5 in the cut). The resolution is lexical (`normalizeLexically` of base, `/`, path) and reads no disk; for a session on another machine it is the same, against that session's record, and the read is made there. With no base (no session, a record not yet known, an empty folder) the path is left as it is, and the read's refusal is the notice's last row.

**What it leaves alone.** The daemon's rule is not touched: the transcript wrote a relative string, `clickPath` of it is a relative path, and a relative path never equals the absolute path a read asks for. So a relative link opens a file only inside the folders (or one the transcript also names whole, by its absolute link), and `../` can lead nowhere a person could not already reach.

**Stays refused, as tests.**

| # | the case | must be | test file |
|---|---|---|---|
| N2.1 | `linkPaths('[x](../../outside/secret.md)')` and `linkPaths('[x](notes/a.md)')` | hold no path that begins with `/` | `src/shared/files/named.test.ts` |
| N2.2 | a transcript that writes `[x](../../outside/secret.md)`, asked for the absolute path the window resolves it to | `names` answers `false`; the read is refused | `src/services/files/service.test.ts` |
| N2.3 | a relative link in a shown Markdown file that stands outside the folders, to its sibling | resolved against that file's folder, asked with `named: true`, refused (this is "The two links") | `tools/code/viewer/viewer.test.tsx` |
| N2.4 | an absolute path given with a `base` | never re-based | `tools/code/files/tabs.test.tsx` |
| N2.5 | a relative path with no session, and one whose session has no record | left relative; one read, refused; no folder of another session is used | `tabs.test.tsx` |

### R3 · A loopback link of a session on this Mac opens in that session's in-app browser

**The rule.** `openLinkInApp` (Interfaces §D) is the one decision for a web link out of a transcript or a terminal, in this order: a link of a session on another machine goes to `openForwardedLink` and is never looked at again (forwarded, or refused with its line; unchanged, with or without ⌘); else, unless ⌘ was held in a transcript, a link whose scheme is `http:` or `https:` and whose host is a loopback host (`isLoopbackLink`) opens through `openBrowserUrl(appSessionId, url)` with no forward; else it is left to the surface (`layout.openExternal`, `pty.openLink`), as today.

**Why it adds no reach.** The link opens the address it would have opened in the system browser, by the person's click. The in-app browser is the session's own, which its agent can already navigate to any `http` or `https` address under its own permission rule (`validateBrowserUrl`, `src/shared/browser/url.ts`, admits any `http` or `https` address, loopback included). What changes is that the page is then a tab the agent can read; that is the purpose (a dev server's page beside the chat), and ⌘ keeps the other browser one key away.

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

### R4 · A chip that gains an action asks for its own session, by the ordinary rule

A side question's answer and a mod's surface get `openFile` bound to the session they belong to (a side thread's own id in `BtwView`, the session's in `BtwCard`, `site.appSessionId` in a mod's surface). No click source is added to the daemon's rule: neither text is a row of a transcript, so a path outside the folders that the session's transcript does not write stays refused (the child's file, "What became of U6c's list"). Tests: a chip there to a file inside the folders calls `openFile` with that session and the path; a chip to an outside path draws the notice of row 1 and one `files.read` for that session and no other (`side/BtwCard.test.tsx`, `side/SideTool.test.tsx`, `engine-surface/SurfaceTree.test.tsx`).

## Decisions settled at authoring

1. **The shared reader lives in a file of its own**, `src/shared/files/file-url.ts`, importing nothing. `sanitize.ts` is read by the desk's web app (`apps/desk-web`, through `transcript/view/markdown/Markdown`), and `named.ts` imports the anchor, composer and engine readers; importing it from the Markdown pipeline would pull those into that package.
2. **The scheme is matched in any letter case**, since the window's own gate lower-cases a scheme before it compares; the rest is taken byte for byte.
3. **A relative path is resolved inside `openFile`**, not at each caller, because every surface opens a file through it (C8c's seam): the transcript's link, a read's or an edit's chip, a plan card, `show_pane`. An agent's `show_pane` with a relative target therefore opens too. A path beginning with `~` is relative by this rule and reads "No file at this path." (`~` is the child's "Not included").
4. **A shown Markdown file resolves against the folder of the path its tab holds**, not its real path: the tab's path is what the person sees. A File artifact's view (`entry.artifact` set) gives no base: its path is the store's, and a link there is as today.
5. **A tab restored with a relative path** stored by an earlier build is read as it is and shows the notice's last row; a click on the link opens it resolved. No stored value is rewritten.
6. **The entry keeps the code and the refusal**, beside the message: `ViewerEntry.failure` (Interfaces §C). The message stays in `error`, which `isNotFound`, the `unknown app session` test and the existing tests read. Nothing new is sent: all three are in the `IpcError` already.
7. **Retry is the store's `openAgain(tabId)`**, not `revisit`: `revisit` is an opener's act and takes the session and the agent's mark; `openAgain` is the same read with what the entry already holds, and exists for a framed file. The Files list retries with its own refresh.
8. **`data-refusal` and `role="alert"` stay on the notice**, with `data-notice-cause` added: unit tests (`tools/code/files/tabs.test.tsx`, `shell/transfer-file.test.tsx`) and two scenes (`e2e/code-tools.spec.ts`, `e2e/remote.spec.ts`) select them without reading the words.
9. **One classifier, three places.** The viewer's notice, the Files list's two notices and the line under "Open externally" (`tools/code/viewer/ExternalRow.tsx`) call `classifyFailure`. A folder is called a folder: for the Files list the subject word is "folder" and the two sentences that speak of opening a file are left out (the sentences are in "The sentences a person reads").
10. **The classifier tests a remote `grade` first, then the two codes, then the two messages** (Interfaces §C gives the order). A link that ended mid-call (`issues.refusal` of `closed` or `removed`) and any other refusal code fall to the last row, as the child's table has it.
11. **Copy path is on the first row only**, where the child's table puts it; every row shows the path.
12. **The local loopback test is the child's**: `http` or `https`, and `isLoopbackLink`. It is a function of the new file `tools/browser/local-link.ts`; `src/shared/machine/loopback-link.ts` is not edited (Decision Log 2 says why the cut's `loopbackPort` is not the gate).
13. **⌘ reaches the opener as a third argument**, `openExternal(url, appSessionId, { external: true })`, optional, so every other mount and the desk's web app compile unchanged. The keyboard's Enter on a focused link is the browser's own click and carries the modifier.
14. **A terminal has no second gesture**: a link there opens only on ⌘-click, so a loopback link of a terminal on this Mac opens in the in-app browser, whose own "Open in external browser" takes it further (the child's file, l9-browser-delivery-03).
15. **The sentence** is appended to `MAWS_SERVER_INSTRUCTIONS` after one space, exactly as Interfaces §E gives it: 197 characters with the space, 832 in all, 1,177 with the browser's paragraph, under root UC-15's 2,048. It keeps to what holds on every machine (ruled 2026-11-13) and names no `file://` form.
16. **The probe's snapshot is not recorded again.** The first entry of `OLDER_IN_SNAPSHOT` in `search-tools.test.ts` already holds the text the fixtures were served, and the case compares the rest against the source; the entry's `reason` gains this landing and its date, and the list stays two entries (the case reads it by position).

## The sequences that must hold

**S1 · Retry.** The notice's Retry calls `openAgain`. (a) While the read it started is pending, a second press starts none (`revisitable` needs `pending === 0`): a test holds the first read open, presses twice, and counts one `files.read`. (b) A read that fails again draws the notice of its own cause, which may differ from the first (the machine came back, and the file is not there). (c) A read that never answers ends as the route's `timeout` and draws row 3. (d) The tab closed, or the same path opened for another session, while the read is held: the answer lands nowhere (U6c's W2 case, unchanged; one case here holds a Retry's read across it).

**S2 · A relative open before the layout or the record is read.** `openFile` keeps an open made before the layout is read and makes it later. The path is resolved when the request is built, with the record known then; an open kept with a path still relative is resolved again when it is made. A test makes a relative open before hydration, with the record arriving in between, and finds one tab at the absolute path.

**S3 · A click on a loopback link while its session is not in view.** `openBrowserUrl` adds the Browser tab to the link's session without bringing it forward and says where it opened (`commentOpenedElsewhere`), as a forwarded link does. Nothing awaits.

## What is stored and sent, and what each older build does with it

Nothing is stored and nothing new is sent. No command, event, key or schema changes; the wire's minor does not move; `src/shared/ipc/` is not in the diff, and L15 checks it. The cut's "one new read of the daemon's" was `files.admit`, which went with U6b-4a (Decision Log 4).

| what changes | build F (`f1852de3a`) | build M (`2c7044231`) | this build, then the older one, then this build |
|---|---|---|---|
| a Files tab's `file` is absolute where a relative chip made it (the same key and type, `panelTools.params`) | keeps and reads a string | the same | the tab reads the same file in each; a relative value an older build stored is read as decision 5 says |
| this build's window on an older daemon of this Mac, a `file://` link to an outside file | F's daemon has no rule of names: refused | M's `clickPath` answers null for a scheme: refused | the window draws the notice's first row; inside the folders the link opens on every daemon |
| an older window on this build's daemon | draws no chip for `file:`; asks nothing | the same | nothing |
| a session on another machine | read there, by that machine's build; a path outside its folders is refused there as today | the same | the notice's sentences are the window's own |
| a session started before this build | keeps the instructions it was first given (a session keeps its paragraph across resumes) | the same | new sessions read the sentence |

No row joins the cross-build coverage table (root UC-14): no key is added. One existing cross-build assertion reads the old words and changes (Interfaces §G).

## Acceptance

Each item is a behaviour a person can check. "Unit" runs on the build VM; a scene runs on a Mac and is the architect's to start.

- **L1** (A5). `[r](file:///<path inside the folders>)` in the agent's text is drawn as a path link and opens the file beside the chat; with `#L12` or `:12` at line 12; ⌘-click opens it in the main area. The same for a terminal session, and for a session on another machine, read there.
- **L2** (A5, O-37). On this Mac `[r](file:///<path outside the folders>)` in the agent's text opens that file, and it can be saved (U6e's rule); written only in an MCP tool's result it opens read-only.
- **L3** (R1). `[r](file://host/a)`, `[r](file:/a)` and `<file:///a>` are plain text with no chip, and no element of the page has an `href` that begins `file:`.
- **L4** (A5). `[n](docs/notes.md)` in the agent's text opens `<working folder>/docs/notes.md`. In a shown Markdown file at `<folder>/docs/guide.md`, `[s](setup.md)` opens `<folder>/docs/setup.md`.
- **L5** (R2). `[x](../../<a folder outside>/secret.md)` draws the first notice and opens nothing.
- **L6** (decision 5 of the cut). A path in a side question's answer (the session's card, and a side thread's view) and in a mod's pane or composer site opens the file beside the chat of its session.
- **L7** (the notice, row 1). On this Mac a path outside the folders that the transcript does not write reads: "This file is outside the folders this session works in." "MAWS opens a file from elsewhere only when this session's transcript links it." "Ask the agent to send the file to see it here.", the path with Copy path, and the command's words in small type. No line begins with "Refused" or with a command's name.
- **L8** (row 2). A path with no file reads "No file at this path."
- **L9** (rows 1 to 5, another machine). With the machine stopped: "<machine> is not reachable." and Retry; started again, Retry shows the file. A path outside its folders: "This file is outside the folders this session works in on <machine>." "MAWS reads only those folders on another machine." "Ask the agent to send the file to see it here." A `grade` refusal reads "<machine> does not have this session on record right now." with Retry for the person's own session, and "Your access to this session on <machine> does not include its files." for someone else's.
- **L10** (the cut's X7). With this Mac's daemon not answering: "MAWS's service on this Mac is not answering." and Retry. A `grade` refusal for a session with no listing: "This file could not be opened." and Retry.
- **L11**. The Files list says the same sentences for a root or folder it cannot list ("This folder is outside the folders this session works in.", "No folder at this path.", "<machine> is not reachable."), and the line under "Open externally" reads the first sentence of the cause.
- **L12** (A6). In a session on this Mac a click on `http://localhost:<port>/` opens that page in the Browser side surface of that session, and nothing reaches the system browser; ⌘-click opens it in the system browser and no Browser tab; `http://app.localhost:<port>/` and `http://127.0.0.2:<port>/` behave the same; `https://example.com/` opens in the system browser. In a terminal on this Mac ⌘-click on a printed `http://127.0.0.1:<port>/` opens the in-app browser. For a session on another machine a loopback link is forwarded as before, with ⌘ too.
- **L13** (decision 6 of the cut; unit). `MAWS_SERVER_INSTRUCTIONS` ends with the sentence of Interfaces §E; `search-tools.test.ts` holds 832 characters and the named tools `artifact_read`, `artifact_search` and `send_file`; `instructions.test.ts` holds 1,177.
- **L14** (the two links, unchanged; unit). A path link drawn in a subagent's own transcript, and one in a shown Markdown file, to a file outside the folders: refused with the first notice unless the session's own transcript writes the same path, and then opened. `src/services/files/named.test.ts` holds that a path written only in a subagent's transcript file (`<session>/subagents/agent-<id>.jsonl`, beside a main transcript that does not write it) is not named.
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

**Touches.** New: `src/shared/files/file-url.ts` and `file-url.test.ts`. `src/shared/files/named.ts` (`clickPath` alone). `src/renderer/src/transcript/view/markdown/sanitize.ts` (`remarkTranscriptSources` alone). Tests: `src/shared/files/named.test.ts`, `src/renderer/src/tools/code/named-links.test.tsx`, `markdown/sanitize.test.tsx`, `markdown/links.test.tsx`, `src/services/files/named.test.ts`, `src/services/files/service.test.ts`.

**Interfaces.** Exposes §A. Consumes nothing.

**Decisions.** R1 whole; decisions 1 and 2. The header comment of `named.ts` and of `Link.tsx` gains the form. `clickPath`'s character-reference test stays first and on the whole destination.

**Does not touch.** `transcriptUrlTransform`, the harden options, `linkSteps` and every scanner of `named.ts`, `src/services/files/named.ts` and `service.ts` (their tests gain cases; their source does not change), `Link.tsx`'s code.

**Proves.** L1 to L3's unit half; N1.1 to N1.9; the differential green in both directions with the new fragments. The differential's seeded case runs up to 300 s: give its command a limit of 600.

### M2 — A relative path, and the chips that did nothing

**At its end.** A relative path opens against the working folder, or against a shown Markdown file's own folder; a path in a side question's answer and in a mod's surface opens the file.

**Touches.** `src/renderer/src/tools/code/open-file.ts` (the resolution, `OpenFileOptions.base`); `tools/code/viewer/MarkdownView.tsx` (its `openFile` gives the base); `tools/code/files/tabs.ts` (the comment on `FilesTabParams.file`); `side/BtwView.tsx`, `side/BtwCard.tsx`, `engine-surface/SurfaceTree.tsx` (one provider or one branch each: Interfaces §F). Tests: `tools/code/files/tabs.test.tsx` (the describe that pins the relative refusal is rewritten to the resolved open), `tools/code/viewer/viewer.test.tsx`, `side/BtwCard.test.tsx`, `side/SideTool.test.tsx`, `engine-surface/SurfaceTree.test.tsx`, `src/shared/files/named.test.ts`, `src/services/files/service.test.ts` and `src/services/files/named.test.ts` (N2.1, N2.2, L14).

**Interfaces.** Exposes §B. Consumes nothing of M1.

**Decisions.** R2 and R4; decisions 3 to 5; S2. A mod's surface opens a chip with the registered actions and `site.appSessionId`, as it opens an artifact mention; where the surface is inside a transcript row the row's own action already answers, and the chip must open once.

**Does not touch.** The daemon's source. `Link.tsx`. The plan card and the question sheets. What a chip looks like.

**Proves.** L4 to L6 and L14's unit half; N2.1 to N2.5; R4's cases.

### M3 — The notice

**At its end.** A file that cannot be read shows one of the six notices, with Retry and Copy path where the table has them and the command's words in small type; the Files list and the line under "Open externally" say the same sentences.

**Touches.** New: `src/renderer/src/tools/code/viewer/notice.ts` and `notice.test.ts`. `tools/code/viewer/viewer-store.ts` (`ViewerEntry.failure`; `fail` takes the error), `tools/code/viewer/FileViewer.tsx` (`Refused` becomes the notice), `tools/code/viewer/ExternalRow.tsx`, `tools/code/copy.ts` (the sentences), `tools/code/files/store.ts`, `files/tree.ts` and `files/FilesTool.tsx` (the two notices), `tools/code/code.css` if the small line needs a rule, `src/renderer/src/test-support/code.ts` (its `fail` helper takes a code and issues). Tests: `viewer/viewer.test.tsx` (the eight cases that read `Refused: …`), `viewer/ExternalRow.test.tsx`, `files/files.test.tsx`, `files/tabs.test.tsx` (one exact text).

**Interfaces.** Exposes §C. Consumes nothing of M1 or M2.

**Decisions.** Decisions 6 to 11; S1; "The look". The machine's name comes from the roster as the window already reads it (`remoteMachineName` in `lane-a/remote-session.ts`, or `machineName` in `stores/org-projects.ts`); `mine` is `useSessions`'s `listed.get(appSessionId)?.mine`, and `null` when there is no listing. `notice.ts` imports no store: its caller hands it the name and `mine`, so its tests are a table.

**Does not touch.** `NoSession`. `saveError` and the save's sentences. `isNotFound` and the "File removed" notice. Review. `tools/maws/actions.ts` (a delivered file's row). The files service.

**Proves.** L7 to L11's unit half: the classifier's table (every row for this Mac and for another machine, `mine` true, false and absent, a file and a folder, and one case per message of "What a failed read carries"); S1 (a) to (d); a notice never begins with "Refused" or with `files.`.

### M4 — Localhost

**At its end.** A loopback web link of a session on this Mac opens in the in-app browser from a transcript and from a terminal; ⌘-click in a transcript opens the system browser.

**Touches.** New: `src/renderer/src/tools/browser/local-link.ts` and `local-link.test.ts`. `transcript/view/markdown/Link.tsx` (the web link's click passes ⌘), `transcript/view/context.tsx` (`openExternal`'s third parameter), `src/renderer/src/App.tsx` (the opener and the terminal's forwarder call `openLinkInApp`). Tests: `markdown/links.test.tsx`.

**Interfaces.** Exposes §D. Consumes nothing of M1 to M3.

**Decisions.** R3; decisions 12 to 14; S3. `openForwardedLink` and `openBrowserUrl` are called, not edited.

**Does not touch.** `src/shared/machine/loopback-link.ts`, `tools/browser/comment/actions.ts`, `tools/browser/forward.ts`, `src/main/open-external.ts`, `src/renderer/src/terminal/`, a mod's surface's own `openExternal`, `transcript/view/default-actions.ts`.

**Proves.** L12's unit half; N3.1 to N3.7.

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

Per milestone, after `git push` (each line is one call; expect every test file named to pass and eslint to print nothing):

    # M1
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
    V 'timeout 600 pnpm exec vitest run src/shared/files/ src/services/files/named.test.ts src/services/files/service.test.ts src/renderer/src/transcript/view/markdown/'
    V 'timeout 600 pnpm exec vitest run src/renderer/src/tools/code/named-links.test.tsx'
    V 'timeout 300 pnpm exec eslint src/shared/files src/renderer/src/transcript/view/markdown src/renderer/src/tools/code/named-links.test.tsx src/services/files'
    V 'timeout 1200 bash -c "pnpm --filter desk-web typecheck && pnpm --filter desk-web build && pnpm --filter desk-web test"'

    # M2
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
    V 'timeout 900 pnpm exec vitest run src/renderer/src/tools/code/files/ src/renderer/src/tools/code/viewer/ src/renderer/src/side/ src/renderer/src/engine-surface/ src/shared/files/named.test.ts src/services/files/service.test.ts src/services/files/named.test.ts test/one-working-folder.test.ts test/support/tokens-guard.test.ts'
    V 'timeout 300 pnpm exec eslint src/renderer/src/tools/code src/renderer/src/side src/renderer/src/engine-surface'

    # M3
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
    V 'timeout 900 pnpm exec vitest run src/renderer/src/tools/code/ src/renderer/src/shell/transfer-file.test.tsx test/support/tokens-guard.test.ts'
    V 'timeout 300 pnpm exec eslint src/renderer/src/tools/code src/renderer/src/test-support'
    V 'timeout 1200 bash -c "pnpm --filter desk-web typecheck && pnpm --filter desk-web build && pnpm --filter desk-web test"'

    # M4
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
    V 'timeout 600 pnpm exec vitest run src/renderer/src/tools/browser/ src/renderer/src/transcript/view/markdown/ src/renderer/src/terminal/registry.test.ts test/support/tokens-guard.test.ts'
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

It answers non-null exactly when `url` matches `/^file:\/\/(?=\/)/i`, and then `url.slice(7)`. `clickPath(destination)` (`src/shared/files/named.ts`): after `const url = destination.replace(BACKSLASH_ESCAPE, '$1')`, the string it goes on with is `fileUrlRest(url) ?? url`; nothing else in the function changes. `remarkTranscriptSources` (`sanitize.ts`), for a `link` node: a scheme-less `url` becomes `maws-path:<url>` as today; else, when `fileUrlRest(url)` is non-null and the node is an inline link (its `position.start.offset` is a number and the character there in the transformer's file is `[`), `url` becomes `maws-path:<rest>`.

### §B. The relative path (M2; `src/renderer/src/tools/code/open-file.ts`)

    export interface OpenFileOptions {
      main?: boolean;
      keep?: boolean;
      asked?: 'agent';
      base?: string; // an absolute folder a relative path is resolved against; without it, the session's working folder
    }
    /** `path` when it begins with `/`, or when `base` is not an absolute path; else `base`, `/` and `path`, lexically normal. Reads no disk. */
    export function resolveRelative(base: string | null, path: string): string;

`openFile` and `openFileWhenRead` resolve before they build their request (and `makeKept` again for a kept open whose path is still relative: S2); the base is `options.base`, else `workingFolder(record).path` of `useSessions.getState().records.get(appSessionId)`, else `null`. `MarkdownView` passes `base: dirname(entry.path)` for a session's file and none for an artifact's. `TranscriptActions.openFile`'s signature does not change.

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

`ViewerEntry` gains `failure: FileFailure | null`, set wherever `error` is set and cleared wherever it is cleared; `fail(tabId, error, reason)` takes the `IpcError`. The Files list's store keeps the same beside its `message`. The notice's element keeps `role="alert"` and `data-refusal`, and carries `data-notice-cause`; Retry is a button `data-notice-retry`, Copy path a button `data-notice-copy`, the small line `data-notice-detail`.

### §D. The link opener (M4; `src/renderer/src/tools/browser/local-link.ts`, new)

    /** `http:` or `https:`, on a loopback host (`isLoopbackLink`). */
    export function isLocalWebLink(url: string): boolean;
    /** The one decision for a web link out of a session's transcript or terminal. True: it was taken (forwarded, refused with its line, or opened in the in-app browser). False: the surface opens it as before. */
    export function openLinkInApp(appSessionId: AppSessionId, url: string, options?: { external?: boolean }): boolean;

`openLinkInApp`: when the session is on another machine (`isAddress(id) && machineOf(id) !== ipc.localMachine`), return `openForwardedLink(appSessionId, url)`; else when `options.external` is not true and `isLocalWebLink(url)`, call `openBrowserUrl(appSessionId, url)` and return true; else false. `TranscriptActions.openExternal` becomes `openExternal(url: string, appSessionId?: AppSessionId | null, options?: { external?: boolean }): void`; `TranscriptLink`'s `a` passes `{ external: true }` when the click's `metaKey` is set and nothing otherwise. In `App.tsx` the opener is `if (appSessionId == null || !openLinkInApp(appSessionId, url, options)) DEFAULT_ACTIONS.openExternal(url, appSessionId)`, and the terminal's forwarder is `(appSessionId, url) => openLinkInApp(appSessionId, url)`.

### §E. The sentence (M5; `src/shared/maws/instructions.ts`)

Appended to `MAWS_SERVER_INSTRUCTIONS`, after its last full stop, beginning with one space:

    " A Markdown link to a file's absolute path, [its name](/absolute/path), opens the file in MAWS when it is inside this session's folders; deliver a file from anywhere else with mcp__maws__send_file."

197 characters. `search-tools.test.ts`: the word-for-word case and `toHaveLength(832)`; the named tools become `artifact_read`, `artifact_search`, `send_file`; the first entry of `OLDER_IN_SNAPSHOT` keeps its `held` text and its `since`, and its `reason` ends "; UX wave U6b-4b (2026-11-18) appended the sentence on file links, which the fixtures were not served". `instructions.test.ts`: `toHaveLength(1177)`.

### §F. Files other children own, or that no table names (root UC-8)

| file | owner | the insertion | milestone |
|---|---|---|---|
| `transcript/view/markdown/sanitize.ts` | UC-3 | the `file:` branch in `remarkTranscriptSources`, and its import | M1 |
| `transcript/view/markdown/Link.tsx` | UC-3 (the cut's X8) | the web link's click passes `{ external: true }` under ⌘; the header comment | M4 |
| `transcript/view/context.tsx` | UC-3 (X8) | the third parameter of `openExternal` | M4 |
| `side/BtwView.tsx` | U5, the `/btw` files U4's (X8) | one `TranscriptActionsProvider` round the answer's Markdown | M2 |
| `side/BtwCard.tsx` | the same row; **not in X8** (U4a made the card after the cut) | the same provider | M2 |
| `engine-surface/SurfaceTree.tsx` | no row; **not in X8** | one branch in `MarkdownNode`'s capture handler: a click on `[data-chip="path"]` outside a transcript row opens with the registered actions and `site.appSessionId` | M2 |
| `tools/browser/local-link.ts` (new) | U12's folder, "U6 (the link opener)" | the file | M4 |
| `src/renderer/src/App.tsx` | no row | the two calls of §D | M4 |
| `tools/code/copy.ts` | U5 and U6, each its strings | the notice's sentences | M3 |
| `src/renderer/src/test-support/code.ts` | no row | `fail` takes a code and issues | M3 |
| `src/shared/maws/instructions.ts` | UC-15 | the sentence | M5 |
| `e2e/cross-build.spec.ts` | the cross-build proof (U13a began its table) | one string, `FILES_REFUSED`, where this build's app reads a refusal from the peer's daemon | M5 |

The two marked **not in X8** are reported to the architect with this document; each is the smallest insertion.

### §G. The scenes (M5 writes them; the architect runs them on a Mac)

| group | spec | the scene |
|---|---|---|
| `e2e` | `e2e/sessions.spec.ts`, the case "a file the transcript links opens from outside the session's folder, …" | gains: a `file:///` link to the outside file opens it; `[r](file://host/…)` draws no chip; a relative link opens the file in the working folder; a path the transcript does not write shows the first notice's three sentences and Copy path, in the window (today the case asserts the refusal on the wire alone) |
| `e2e:code` | `e2e/code-tools.spec.ts` | "the Files tree and the viewer use tokens only in both themes": the Files row reads the folder's first sentence in place of `Refused: …`; a new case: a path with no file reads "No file at this path."; the viewer's refusal step keeps selecting `[data-refusal]` |
| `e2e:remote` | `e2e/remote.spec.ts`, the case "A reaches B's mawsd over RL2, …" | a file outside B's folders reads the sentence that names B; B stopped: "<B> is not reachable." and Retry; B started, Retry shows the file; the existing step "M3: a dev server …" passes unchanged, and once more with ⌘ held |
| `e2e:browser` | `e2e/browser.spec.ts` | a session on this Mac whose transcript holds `[app](http://localhost:<port>/)`: a click opens a Browser tab at that address in the session's side column and `seamLines` holds no `openExternal` line for it; ⌘-click writes `openExternal http://localhost:<port>/` and opens no tab. Where this spec's harness cannot stage a transcript row, the scene goes into `e2e/sessions.spec.ts` with the same assertions, and the hand-back says so |
| `e2e:terminal` | `e2e/terminal.spec.ts`, beside "copies a selection and opens links externally" | ⌘-click on a printed `http://127.0.0.1:<port>/` opens the in-app browser and the stub of `shell.openExternal` is not called; `https://example.org` still reaches the stub |
| `e2e:side` | `e2e/side.spec.ts`, case 5 (`/btw`) | the staged answer holds a path inside the folders; a click opens the file beside the chat |
| `e2e:cross-build` | `e2e/cross-build.spec.ts`, "(outside file, on the peer's daemon) …" | the string of §F; no new case |

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
| P3 | **Two insertions outside the cut's X8.** `side/BtwCard.tsx` and `engine-surface/SurfaceTree.tsx`. | Decision Log 3; §F | made, as the smallest | §F |
| P4 | **A folder is not "this file".** The cut says the Files list takes the same sentences; said of a folder they would be false. | `RootsFailure` and the tree's row list folders | the folder's forms of "The sentences a person reads" | that table |
| P5 | **After U6f the second sentence for another machine is false for a machine's owner**, who can then open a file outside the folders there ("MAWS reads only those folders on another machine."). | the child's O-37, "On another machine" | the table's sentence, as the child's file words it "until U6f lands" | the `outside` row, another machine |
| P6 | **The sentence's exact words** are this document's; the child's file gives its content only. | §E | §E | §E |
| P7 | **"Not reachable" also covers a machine that answered `unavailable`** (reached, but its service could not answer), and a link that ended mid-call reads "This file could not be opened." | `refusalError` maps `offline` and `unavailable` to `host_unavailable`, and `closed` and `removed` to `internal` with `issues.refusal` | the child's table, by code | the order of §C |

## Proof that an executor does not run

- **The scenes of §G, on a Mac**, under the load rule: `e2e` (the one case of `sessions.spec.ts`), `e2e:code`, `e2e:remote`, `e2e:browser`, `e2e:terminal`, `e2e:side`, `e2e:cross-build`. Each needs the pushed head that holds M5; `e2e:remote` and `e2e:cross-build` need what those groups always need (a second machine's build; the peer build).
- **Class 1a** (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b4b`) and, because three files the desk's web app reads change, the desk-web e2e on Linux.
- **The branch review**: the xhigh panel (Decision Log 1).
- **A live look at the sentence**, optional and paid: one new session asked to point at a file it wrote inside its folder and one outside; expected, a path link for the first and `send_file` for the second. Nothing waits for it.
- **The owner.** No answer is needed to build this document. A drawn example of the six notices (this Mac and another machine side by side) would let the owner see the words in place before M3 is built; it is advised, not required, since the words are the child's table. The two links (P1) carry two questions that are the owner's.

## Size and review

About 1,900 changed lines over about 50 files, tests and scenes included: M1 about 300 over 9 files, M2 about 340 over 12, M3 about 650 over 14, M4 about 200 over 6, M5 about 380 over 13 (seven of them scene files). The branch takes the **xhigh panel**, as the cut's table names for U6b-4: by size it is at the mark, and it edits the rule of what a transcript names, which the root calls a security boundary; one reviewer of the panel reads R1 to R4 and their tables against the diff.

## Statements to check again on the head this landing is built on

The branch is cut from U6b-2 and merges master first. Landings that may be on that head and touch what this document rests on:

- **U6b-4a ("Open in")** adds controls to the file's bar in `FileViewer.tsx` and strings to `tools/code/copy.ts`: merge keeps both; `Refused` is not its.
- **U6f (an outside file on another machine)** changes what a session on another machine may read and may change `readChunk`'s `local` test and the remote read's errors. Read again: "Only a session on this Mac asks by name"; the classifier's row 5 for another machine; and P5.
- **U6b-3 (Files' Changed group, Go to file)** edits `FilesTool.tsx`, `files/store.ts` and `files/tree.ts`: read again where the two notices are drawn and what the store keeps of an error.
- **U6b-5a (the keyboard)** gives the Files tab the keyboard: the notice's Retry must be reachable by Tab inside the tab's panel, and adds no key of its own.
- **Any landing of U5 or U4 in `side/`**, and of U2b in `engine-surface/`: read again where each mounts `Markdown`.
- `MAWS_SERVER_INSTRUCTIONS` is 635 characters and its browser paragraph 343: if another landing has moved either, the three numbers of §E move with it and the sum is reported.

## The pull request

Its body names the class 1a run, the panel's verdict and the residue, and carries the three dated amendments of M5 where they stand. Tracker rows it adds: the two links (a link inside a shown Markdown file; the row of 2026-11-13 for a subagent's drill-in is kept and pointed at the same place); ⌘ on a path link inside a plan card and a question sheet; a loopback link outside a transcript and a terminal opens in the system browser; P7's two wordings, if the architect leaves them.

## Surprises & Discoveries

- Observation: a session's own `/btw` no longer answers in `BtwView`; since U4a it answers in `BtwCard`, which mounts its answer's Markdown with no file action either.
  Evidence: `side/BtwView.tsx`'s header ("since a session's own `/btw` answers in its card (BtwCard.tsx), this view is a side thread's"); `session/SessionPane.tsx` mounts `BtwCard`.
- Observation: every failure of the files service arrives with the code `internal`; only the message tells an outside path from a missing one. The codes tell only the route's own failures.
  Evidence: `src/services/files/service.ts` throws plain `Error`s (`FILES_REFUSAL`, `not found: …`); `refusalError` in `src/main/machines/remote/dispatch.ts`.
- Observation: `loopbackPort` is narrower than `isLoopbackLink` in hosts as well as in schemes.
  Evidence: `FORWARDABLE_HOSTS` in `src/shared/machine/loopback-link.ts`; `loopback-link.test.ts` pins `http://app.localhost:3000` as loopback and not forwardable.
- Observation: Streamdown runs the processor as `runSync(parse(markdown), markdown)`, so a remark transformer's second argument holds the text the node positions index.
  Evidence: `streamdown` 2.6.0, `dist/chunk-YOKDWASO.js`.

## Decision Log

1. **2026-11-18 · The verification call.** This document gets an adversarial review before an executor starts (buildability and the trust rules). The branch gets the `doperpowers:review-code` xhigh panel, which the cut's table names for U6b-4 by size and because it edits the rule of what a transcript names. Class 1a on GitHub Actions is the gate of record; the scenes of §G run on a Mac.
2. **2026-11-18 · The cut's decision 7 corrected: the gate.** The cut says "`isLoopbackLink` also answers for other schemes, so the gate is `loopbackPort`'s". `loopbackPort` also drops `*.localhost` and the rest of 127.0.0.0/8, which the child's file names as opening in the in-app browser. Built: `http` or `https`, and `isLoopbackLink`. Lost: `loopbackPort`, which is the rule of what can be forwarded from another machine, not of what is this Mac's loopback.
3. **2026-11-18 · The cut's decision 5 corrected: the places.** The cut names `side/BtwView.tsx` and "a mod's pane or composer site". The session's own side questions are in `side/BtwCard.tsx` since U4a, and a mod's surface is one component, `engine-surface/SurfaceTree.tsx`, whose capture handler is where a chip's click is taken. Both get the action; both are insertions the cut's X8 does not name.
4. **2026-11-18 · The cut's "Stored and sent" and "Scenes" corrected for the cut-off.** "One new read of the daemon's (a wire minor)" was `files.admit`, and `e2e:panel` (the title bar's menu) was "Open in": both went with U6b-4a. This landing sends nothing new and moves no wire minor. `e2e:cross-build` joins the scenes: one of its assertions reads the old words.
5. **2026-11-18 · The cut's decisions 1 and 6 corrected in a word each.** Decision 1: Retry is the store's `openAgain`, which reads again with what the entry holds; `revisit` is the opener's act. Decision 6: the instructions are 635 characters at the pin (the cut wrote "699 today, 635 once U6d lands"), and the snapshot's list needs no new entry, because its first entry already holds what the fixtures were served; its reason gains the date.

## Outcomes & Retrospective

Pending — written at finish.
