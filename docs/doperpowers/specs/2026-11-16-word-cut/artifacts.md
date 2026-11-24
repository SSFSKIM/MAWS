# Word cut: Artifacts: the library and an opened artifact

> Part of `docs/doperpowers/specs/2026-11-16-word-cut-design.md`; read that first. This file is written by `render.py` from `items.json` beside it; a decision changes there and in the root document's Decision Log.

62 items: 33 cut, 1 reworded, 28 stay. Of the 34 that change, the owner saw 4 in a picture or ruled on them; 30 follow the pattern and were not seen.

Against master (M0): 60 unchanged, 2 rewritten by the wave; none waits on the owner; 1 put to the owner (new rows included) and since ruled. M0 added 15 rows for the UX wave's new text (6 cut, 1 reworded, 8 stay), listed at the end.

Columns: **Id** is the item's id in `items.json`. **Where** is the place on the surface. **Today** is the text at the pin `2c7044231` (an example value where the text is built from data). **Decision** is `cut` (the text leaves the resting surface), `reword` (it changes) or `stays` (today's text is kept; the row is here so that nobody proposes it again). **After** says what the surface shows afterwards, as it was built on the scratch branch and shown in the pictures. **Basis** is how firm the decision is, in the words of the root document's "How firm each decision is". **Source** is the file and line at the pin. **M0** is what the re-reading against master found (see the root document's "M0's record"): `unchanged`, `moved`, `rewritten by the wave`, `gone` or `moot`, with the file and line on master, and for a rewritten row the text master shows and the row decided again by the five rules. **Build** is the milestone that builds the row and the scene whose before and after pictures show it.

## An opened artifact

### Artifact header, Send to action

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T129 | the same action after a send has succeeded, for as long as the receipt is kept | Sent to Notion | stays | Stays. "Sent to Notion" becomes a tick on "Send to…", and the library row stops saying where and when it was sent; close to the who-did-what-when facts the owner brought back (G299) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/delivery/copy.ts:19` | unchanged `src/renderer/src/delivery/copy.ts:19` | M5 · no scene: needs a document or artifact fixture in that state (wanted: a document whose Send to Notion has succeeded (header action reads Sent to Notion; library row shows the receipt)) |

### Send to sheet

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T131 | under the Notion / Google Drive choice | MAWS sends it itself: no session, no Claude turn. | cut | The Send to sheet no longer says 'MAWS sends it itself: no session, no Claude turn.' | pattern | `src/renderer/src/delivery/copy.ts:22` | unchanged `src/renderer/src/delivery/copy.ts:22` | M5 · `m5-artifact-send-to` |
| T132 | under the connection box when Notion is chosen | As a Notion page, its headings, lists and tables kept. | cut | With Notion chosen, the sheet no longer says 'As a Notion page, its headings, lists and tables kept.' | pattern | `src/renderer/src/delivery/copy.ts:23` | unchanged `src/renderer/src/delivery/copy.ts:23` | M5 · no scene: needs a document or artifact fixture in that state (wanted: the Send to sheet open on a document, Notion chosen and a connector reachable) |
| T134 | the bordered connection box when the service is ready; 3 forms | Connected through MAWS: “notion” in your user settings. | reword | When the service is ready the Send to sheet's connection box shows one short line: "Connected" for Notion, the Google account (or "Connected" when gws names none) for Drive. | pattern | `src/renderer/src/delivery/copy.ts:50` | unchanged `src/renderer/src/delivery/copy.ts:50` | M5 · no scene: needs a document or artifact fixture in that state (wanted: the Send to sheet open on a document, Notion chosen and a connector reachable) |
| T135 | the connection box when something must be done first; 8 sentences of 12 to 41 words (connect Notion once, sign-in needs renewing, a sign-in is under way, add Notion's MCP server, gws not installed, gws needs an OAuth client, gws not signed in, gws sign-in expired, no Drive access) | gws’s Google sign-in has expired. Signing in again gives gws a new one that covers Google Drive alone, in place of the old; add other services by signing gws in from a terminal. gws keeps the sign-in, MAWS stores nothing. | stays | Stays. kept: consent | consent | `src/renderer/src/delivery/copy.ts:66` | unchanged `src/renderer/src/delivery/copy.ts:66` | M5 · no scene: the Notion half (no connector) is m0-send-to’s picture; Google Drive’s states need a gws stub on the PATH (not installed, no client, not signed in, expired, no Drive access), which no launch has |
| T137 | the connection box while it checks; 2 forms | Looking for your Notion connector… | cut | While the connection is checked the box says 'Checking…' for both services. | pattern | `src/renderer/src/delivery/copy.ts:44` | unchanged `src/renderer/src/delivery/copy.ts:44` | M5 · no scene: the connection check is a wait of a moment; no fixture holds it open |
| T139 | above the status line when this artifact was sent before | Last sent to Notion · 2h ago | cut | Above the status line a previous send reads 'Sent 2h ago'. | pattern | `src/renderer/src/delivery/copy.ts:42` | unchanged `src/renderer/src/delivery/copy.ts:42` | M5 · no scene: needs a document or artifact fixture in that state (wanted: the Send to sheet reopened on a document already sent once) |
| T140 | the status line while sending and after | Exporting and sending to Notion… | cut | The status line reads 'Sending…' while sending and 'Sent as “Q3 plan”' after. | pattern | `src/renderer/src/delivery/copy.ts:43` | unchanged `src/renderer/src/delivery/copy.ts:43` | M5 · no scene: a transient wait no fixture holds (wanted: the Send to sheet after Send is pressed (sending, then sent)) |

### HTML page or file artifact, opened (viewer)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T567 | beside the title in the artifact's header, always | Read-only | cut | An HTML or file artifact's header no longer says "Read-only" beside the title. | pattern | `src/renderer/src/tools/artifacts/viewers/ByteViewer.tsx:476` | unchanged `src/renderer/src/tools/artifacts/viewers/ByteViewer.tsx:485` | M5 · `m5-artifact-html` |
| T570 | version picker at the left of the bar under the header, present when the artifact has two or more versions | v3 · latest | stays | Stays. the version picker stops marking the latest version, so an older one is not told apart from the current at a glance \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/artifacts/viewers/copy.ts:11` | unchanged `src/renderer/src/tools/artifacts/viewers/model.ts:30` | M5 · `m5-artifact-html` |
| T571 | chip at the right of the same bar when the page logged errors or warnings (state: console output) | 2 console errors / 1 console warning | cut | The console chip says "2 errors" / "1 warning". | pattern | `src/renderer/src/tools/artifacts/viewers/copy.ts:20` | unchanged `src/renderer/src/tools/artifacts/viewers/copy.ts:20` | M5 · `m5-artifact-html` |
| T573 | in the body while the artifact is read (state: loading) | Loading… | cut | While an HTML or file artifact is read its body is empty for half a second, then shows a small spinner. | pattern | `src/renderer/src/tools/artifacts/viewers/copy.ts:8` | unchanged `src/renderer/src/tools/artifacts/viewers/copy.ts:8` | M5 · no scene: the viewer waits for the artifact read for a moment; no fixture holds it open |
| T575 | pill at the top of the page after pressing Comment (state: picking an element) | Click an element to comment on it · Esc cancels | cut | The picking pill says "Click an element · Esc cancels". | pattern | `src/renderer/src/tools/artifacts/viewers/copy.ts:18` | unchanged `src/renderer/src/tools/artifacts/viewers/copy.ts:18` | M5 · no scene: Comment on an HTML page is drawn only where a reader session can take the comment (a panel beside a session); the library’s tab has none |

### Export, any artifact

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T579 | tail of the same toast when a document with comments was exported (state: done) | · Comments credited to {name}; change in Settings › Artifacts. | cut | The export toast ends "· Comments credited to {name}", without the Settings pointer. | pattern | `src/renderer/src/tools/artifacts/viewers/copy.ts:30` | unchanged `src/renderer/src/tools/artifacts/viewers/copy.ts:30` | M5 · no scene: the export’s toast lasts seconds after a header export writes its file; a `last` step on a document with comments could raise it, not built here |

### Connectors sheet of an HTML page artifact

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T582 | paragraph under the sheet's title (two variants: 37 and 48 words) | This page asks to use these tools. An allowed tool runs through a live session’s connection, or MAWS’s own connection to a server a session reported, while the page is on screen, and never while it is hidden or closed. | stays | Stays. kept: consent | consent | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:106` | unchanged `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:106` | M5 · no scene: needs a document or artifact fixture in that state (wanted: an HTML page artifact with the Connectors sheet open: tools not yet allowed, one read, servers listed) |
| T584 | state line under each tool's name, for a tool not yet allowed | Not allowed | stays | Stays. kept: consent | consent | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:31` | unchanged `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:31` | M5 · no scene: needs a document or artifact fixture in that state (wanted: an HTML page artifact with the Connectors sheet open: tools not yet allowed, one read, servers listed) |
| T587 | after the state on a tool's line, once the page has called it | · Read at 14:02 | stays | Stays. when the page last called a tool ("Read at 14:02") moves to hover; a time fact, and near consent (a page using your tools) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:33` | unchanged `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:33` | M5 · no scene: needs a document or artifact fixture in that state (wanted: an HTML page artifact with the Connectors sheet open: tools not yet allowed, one read, servers listed) |
| T589 | a boxed row under the tools when no live session can run them (state: no session; two variants) | Neither a live session nor MAWS’s own connection reaches these tools’ server. Start the artifact’s session to read live data; no message is sent. | cut | The no-session box says "No live session reaches these tools. Starting one sends no message." (the session-only variant: "No live session has these tools. Starting one sends no message."). | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:113` | unchanged `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:113` | M5 · no scene: needs a document or artifact fixture in that state (wanted: the Connectors sheet of an HTML page artifact while no live session is running) |
| T591 | status beside Start session while it works (state: starting) | Starting… / Starting the session… / The session is ready | cut | Beside Start session the status reads "Starting…" for both phases, then "Ready". | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:51` | unchanged `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:51` | M5 · no scene: needs a document or artifact fixture in that state (wanted: the Connectors sheet after Start session is pressed (starting, then ready)) |
| T594 | sentence under the Servers head | MAWS’s own connections. Disconnect affects MAWS only: sessions keep their own sign-in, and allowed tools stay allowed. | stays | Stays. kept: consent | consent | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:115` | unchanged `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:115` | M5 · no scene: needs a document or artifact fixture in that state (wanted: an HTML page artifact with the Connectors sheet open: tools not yet allowed, one read, servers listed) |
| T595 | under the Servers head while they are read (state: loading) | Reading MAWS’s connections… | cut | While the Servers are read a quiet spinner shows under the heading, after half a second. | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:116` | unchanged `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:116` | M5 · no scene: the servers are read in a moment; no fixture holds the read open |
| T596 | after each server's name | · HTTP / · local command | stays | Stays. a server's transport, which the owner brought back for connectors (G252) | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:120` | unchanged `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:120` | M5 · no scene: needs a document or artifact fixture in that state (wanted: the Connectors sheet with servers listed: an HTTP one, a local-command one, a session-only one) |
| T597 | second line of each server row (representative) | User config · {path to the configuration file} | stays | Stays. a server's scope and configuring file, which the owner brought back for connectors (G254) | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:121` | unchanged `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:121` | M5 · no scene: needs a document or artifact fixture in that state (wanted: the Connectors sheet with servers listed: an HTTP one, a local-command one, a session-only one) |
| T598 | third line of a server row that works | MAWS can reach it directly / Connected through MAWS | stays | Stays. "Connected" on a working server, which the owner brought back for connectors (G253) | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:128` | unchanged `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:128` | M5 · no scene: needs a document or artifact fixture in that state (wanted: the Connectors sheet with servers listed: an HTTP one, a local-command one, a session-only one) |
| T600 | third line of a server only a session can use (representative of ten reasons) | Session only: Its configuration needs something only a session has (a ${…} reference, or a source MAWS doesn’t read) | cut | A session-only server's line says "Session only"; the reason shows under the pointer on that line. | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:63` | unchanged `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:63` | M5 · no scene: needs a document or artifact fixture in that state (wanted: the Connectors sheet with servers listed: an HTTP one, a local-command one, a session-only one) |
| T601 | after a server's status, the outcome of the last Connect or Disconnect (success forms) | · Connected · 3 tools listed / · Disconnected / · Disconnected and revoked | cut | After Connect the row says "3 tools"; after Disconnect "Disconnected" (also when revoked). | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:138` | unchanged `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:138` | M5 · no scene: a transient wait no fixture holds (wanted: the Connectors sheet right after Connect and after Disconnect on a server) |
| T605 | paragraph under the server rows after an unreadable saved connection was dropped (state: recovery) | An unreadable saved MAWS connection was forgotten, so until MAWS relaunches it won’t reach a server without its own MAWS sign-in. Connect signs a server in now; one that needs no sign-in works again after a relaunch. | cut | After an unreadable saved connection was dropped the note says "A saved connection couldn't be read and was forgotten. Connect to sign in again, or relaunch MAWS." | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:119` | unchanged `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:119` | M5 · no scene: needs a document or artifact fixture in that state (wanted: the Connectors sheet after an unreadable saved connection was dropped (a failing profile fixture)) |

### Document, presentation, design or dashboard, opened (header)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T607 | beside the title, whenever nothing is pending (the deck's toolbar prints "Saved") | All changes saved | stays | Stays. the owner keeps the saved status in view: the editor header keeps "All changes saved" | ruled | `src/renderer/src/tools/document/header.ts:66` | unchanged `src/renderer/src/panel/editor-host.ts:46` | M5 · `m5-doc-saved` |

### Document artifact, opened

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T608 | before the title in the header, when the document is in no Space | General / | cut | A document in no Space has no "General /" before its title. | seen | `src/renderer/src/tools/document/DocumentPanel.tsx:79` | unchanged `src/renderer/src/tools/document/DocumentPanel.tsx:90` | M5 · `m5-doc-rest` |
| T609 | before the title in the header, after the Space | Design: {design system name} / | stays | Stays. skipped: no place to move it to | not a cut | `src/renderer/src/tools/document/DocumentPanel.tsx:81` | unchanged `src/renderer/src/tools/document/DocumentPanel.tsx:92` | M5 · `m5-doc-rest` |
| T610 | before the title in the header while the Spaces are read (state: loading) | Loading Space… / | cut | While the Spaces are read the header shows no "Loading Space… /". | pattern | `src/renderer/src/tools/document/DocumentPanel.tsx:81` | unchanged `src/renderer/src/tools/document/DocumentPanel.tsx:92` | M5 · no scene: the Spaces are read in a moment; no fixture holds the read open |
| T612 | a worded, greyed button in the header while an export runs (state: exporting) | Exporting Markdown… | cut | While an export runs the greyed header button says "Exporting…". | pattern | `src/renderer/src/tools/document/header.ts:75` | unchanged `src/renderer/src/tools/document/header.ts:123` | M5 · no scene: a transient wait no fixture holds (wanted: a document whose header export is running (the export held open)) |
| T614 | the header's Export menu | Markdown (.md) / Web page (.html) / Word (.docx) / Word, A4 (.docx) / PDF (.pdf) / PDF, A4 (.pdf) | stays | Stays. skipped: a rename and menu restructure | not a cut | `src/renderer/src/tools/document/header.ts:47` | rewritten by the wave `src/renderer/src/tools/document/header.ts:73`: now "Markdown (.md) / Web page (.html) / Word (.docx) / PDF (.pdf), a separator, then Letter / A4 / Compact as checked items; a dashboard keeps the six rows" | M5 · `m5-doc-export-menu` |
| T615 | centred in the body while the artifact opens (the same line for a document, a presentation and a design) | Opening the document… | cut | While a document, presentation or design opens the body is blank, then a small spinner. | pattern | `src/renderer/src/tools/document/DocumentPanel.tsx:169` | unchanged `src/renderer/src/tools/document/DocumentPanel.tsx:180` | M5 · no scene: the artifact opens in a moment; no fixture holds the open |
| T617 | centred in the body of a document with no first page (state: empty, old document) | This document has no content yet: it was created before MAWS gave every new document its first page. | cut | An old empty document says "This document is empty." | pattern | `src/renderer/src/tools/document/DocumentPanel.tsx:170` | unchanged `src/renderer/src/tools/document/DocumentPanel.tsx:181` | M5 · `m5-artifact-doc-empty` |
| T621 | the small card that stands where a comment's card will be while its session starts (state: starting) | Starting a session for this comment… | cut | The placeholder card says "Starting a session…". | pattern | `src/renderer/src/tools/document/comment-session.tsx:38` | unchanged `src/renderer/src/tools/document/comment-session.tsx:38` | M5 · no scene: a transient wait no fixture holds (wanted: a comment added on a document with no session running (the placeholder card while the session starts)) |
| T624 | at the end of each row of the @-mention picker (representative: "Session" and the seven kind names) | Session / Document / HTML page | stays | Stays. skipped: needs a file outside the part | not a cut | `src/renderer/src/tools/document/mentions.ts:31` | unchanged `src/renderer/src/tools/document/mentions.ts:31` | M5 · no scene: the @-mention picker lists the live sessions; launch 16 has none, and a launch with sessions has no document fixture yet |

### Dashboard artifact, opened

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T626 | a strip above the dashboard when a dataset's source file changed or went missing (state: source changed; two forms) | {file} changed. Showing the saved data. | cut | The source strip says "{file} changed" or "{file} is unavailable", with Reread beside it. | pattern | `src/renderer/src/tools/dashboard/FileSources.tsx:65` | unchanged `src/renderer/src/tools/dashboard/FileSources.tsx:65` | M5 · no scene: needs a file dataset an agent bound from its session folder, the file then changed on disk (the source strip reads the folder) |
| T629 | the whole body of a dashboard made in the old format (state: legacy dashboard): two paragraphs around a list of its files | This dashboard was made before dashboards were documents, so it is kept read-only, exactly as it is. It holds these files: … To keep working on it, ask an agent to read its files and create a new dashboard from them, then delete this one. | cut | A legacy dashboard says "An older dashboard, kept read-only. To keep working on it, ask an agent to rebuild it from these files:" above its file list, and nothing below. | pattern | `src/renderer/src/tools/dashboard/DashboardPanel.tsx:86` | unchanged `src/renderer/src/tools/dashboard/DashboardPanel.tsx:86` | M5 · `m5-artifact-legacy-dashboard` |

### Design artifact, opened

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T632 | sheet shown when a board is too large to export at full size (state: export too large) | Export “{board}” at 42%? · “{board}” is 20000 × 9000 px. A PNG can be at most 8192 px on a side, so MAWS exports the whole board at 42% (8192 × 3686 px); nothing is cropped. · Export at 42% | cut | The too-large sheet: title "Export “Hero” at 42%?", body "Too large for a PNG at full size.", button "Export at 42%". | pattern | `src/renderer/src/tools/design/exports.ts:109` | unchanged `src/renderer/src/tools/design/exports.ts:109` | M5 · `m5-artifact-design-too-large` |

### Presentation artifact, opened

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T635 | a worded menu button in the deck's toolbar | Deck actions ▾ | stays | Stays. skipped: drawn outside the part | not a cut | `src/renderer/src/tools/presentation/DeckBody.tsx:89` | unchanged `src/renderer/src/tools/presentation/DeckBody.tsx:89` | M5 · `r2-deck` |
| T636 | items of that menu | Theme / Check against the design system | cut | The deck's action reads "Check design" (Theme unchanged). | pattern | `src/renderer/src/tools/presentation/header.ts:43` | unchanged `src/renderer/src/tools/presentation/header.ts:43` | M5 · `m5-artifact-deck` |

### Right column, editor header row

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| P23 | same place, while a save is in flight | Saving… | cut | While a save runs the editor header shows a small spinner ("Saving…" under the pointer). | pattern | `src/renderer/src/panel/editor-host.ts:45` | unchanged `src/renderer/src/panel/editor-host.ts:47` | M5 · no scene: a save finishes within a frame; no fixture holds one open |
| P24 | same place, when there are edits not yet saved | Unsaved changes | cut | Unsaved edits show as a dot in the editor header ("Unsaved changes" under the pointer). (Partly applied on the scratch branch: The dot is in the header, not on the tab: the tab strip has no access to the editor's saved state without a new store read.) | pattern | `src/renderer/src/panel/editor-host.ts:46` | unchanged `src/renderer/src/panel/editor-host.ts:48` | M5 · no scene: the unsaved state lasts until the next save; no fixture holds it open |

## Artifacts library

### Artifacts, page head

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| G283 | the title at the left of the head | Artifacts | cut | The head no longer prints 'Artifacts'; the heading stays for assistive tech. Artifacts is a page, not a tab: with W6 the title bar draws no name for it either, so the page names itself nowhere but in the sidebar's highlighted row, which the owner accepted on 2026-11-20 (W6). | seen | `src/renderer/src/library/copy.ts:86` | unchanged `src/renderer/src/library/copy.ts:94` | M5 · `artifacts-library` |
| G284 | a button after the title, shown when other machines are known; its menu lists them | This Mac ▾ | stays | Stays. which machine the library shows (the owner brought back "This Mac", P29), and a way in | pattern | `src/renderer/src/library/copy.ts:95` | unchanged `src/renderer/src/library/copy.ts:103` | M5 · no scene: needs a session on another machine (wanted: the Artifacts library with a second machine known (the machine button after the title)) |
| G285 | a four-part switch in the head | All · General · Pinned · By Space | stays | Stays. brought back on artifacts-library | brought back | `src/renderer/src/library/copy.ts:87` | unchanged `src/renderer/src/library/copy.ts:95` | M5 · `artifacts-library` |
| G287 | a button after the search; its menu lists the seven kinds with counts | All types ▾ | cut | 'All types' is gone from the head; the kinds (with counts) are the second group of the funnel menu, and a chosen kind stands beside the search as a chip with its glyph that clears it. | seen | `src/renderer/src/library/copy.ts:91` | unchanged `src/renderer/src/library/copy.ts:99` | M5 · `m5-library-kind` |
| G289 | a bordered button at the right end of the head | + New Space | cut | '+ New Space' is gone from the head; 'New Space…' is the last row of the + menu (and still in a row's Move to Space menu). | seen | `src/renderer/src/library/copy.ts:92` | unchanged `src/renderer/src/library/copy.ts:100` **Not built: not built (M5 task 1, 2026-11-23): its After puts "New Space…" in a "+ menu" master's library head does not have, and a bare "+" is against rule 4. The one menu that already makes things in the library, the "Make something new" strip's More, is drawn only under All, General and a narrowed Space with no search, while the head's New Space is drawn under Pinned, By Space and a search too; moving it there would remove the named way in from those views (rule 3), so the worded button stays.** | M5 · `m5-library-head-more` |

### Artifacts, "Make something new" strip

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| G290 | a small heading over the strip, with the place it will file into | Make something new · General | stays | Stays. brought back on artifacts-library | brought back | `src/renderer/src/library/copy.ts:96` | unchanged `src/renderer/src/library/copy.ts:104` | M5 · `artifacts-library` |
| G291 | seven cards always at the top of the list, each with a kind's name and two word buttons (Document, Presentation, Design, Design system, Dashboard, HTML page, File) | Document · New · Ask Claude | stays | Stays. brought back on artifacts-library | brought back | `src/renderer/src/library/copy.ts:98` | rewritten by the wave `src/renderer/src/library/MakeSomethingNew.tsx:162`: now "four cards, each the kind's name, its one-line blurb (Notes, specs and reports / A slide deck / Charts bound to data / Artboards on a canvas) and a Blank button; a More menu holds Design system, HTML page and Add a file…"; decided again (ruled): stays, The Make something new strip keeps its four cards (name, one-line blurb, Blank) and More as the wave draws them. Put to the owner: Spec names G291: U10b l6-artifacts-08 redrew the strip as four cards that ask, so the row's buttons (New, Ask Claude) are gone and the wave's text stands; any cut of the card blurbs would change text the wave fixed, so recorded for the owner, not built. **Ruled by the owner, 2026-11-20, card 3: kept, not cut (the four cards stay as the wave draws them).** | M5 · `artifacts-library` |

### Artifacts, the list

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| G295 | after a Space's name in its group head, when the Space is linked to a folder | Mirrored to ~/code/app/artifacts | stays | Stays. a Space's mirrored folder becomes a link glyph with the path on hover; the owner brought back a connector's path that had moved to hover (G254) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/library/copy.ts:111` | unchanged `src/renderer/src/library/copy.ts:126` | M5 · `m5-library-space` |
| G296 | every row, second line, first word: the kind (seven wordings) | Document | stays | Stays. part of the library row's second line ("HTML page · General · Edited now by You") the owner brought back; only G299 was recorded for that change | brought back | `src/renderer/src/library/copy.ts:6` | unchanged `src/renderer/src/library/copy.ts:7` | M5 · `artifacts-library` |
| G297 | every row, second line: its Space as a small button, or the word General | General | stays | Stays. part of the library row's second line the owner brought back (see G296); only G299 was recorded | brought back | `src/renderer/src/library/Row.tsx:157` | unchanged `src/renderer/src/library/Row.tsx:157` | M5 · `artifacts-library` |
| G298 | every row, second line: the project it came from | <project> | stays | Stays. part of the library row's second line, which the owner brought back (G299) | pattern | `src/renderer/src/library/Row.tsx:163` | unchanged `src/renderer/src/library/Row.tsx:163` | M5 · `artifacts-library` |
| G299 | every row, second line: who edited it and when | Edited 2h ago by Claude | stays | Stays. brought back on artifacts-library, artifacts-library-hover | brought back | `src/renderer/src/library/copy.ts:117` | unchanged `src/renderer/src/library/copy.ts:132` | M5 · `artifacts-library` |
| G302 | every row: chips naming the sessions that touched it, up to three and then a count | <session title> · <session title> · +2 | stays | Stays. brought back by the owner, though no picture's change list carries it | brought back | `src/renderer/src/library/copy.ts:119` | unchanged `src/renderer/src/library/copy.ts:134` | M5 · `artifacts-library` |

### Artifacts, empty and failed states

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| G308 | the list when the library is empty | Nothing here yet. Documents, decks, HTML pages and the files your sessions send land here, and so does anything you make above. | stays | Stays. a whole page's empty state keeps its explanation, as the owner brought back for skills (G249); the library was "too bare" | pattern | `src/renderer/src/library/copy.ts:104` | unchanged `src/renderer/src/library/copy.ts:119` | M5 · no scene: the library is never empty: the design systems are seeded into every profile, so the emptyAll line has no state to show |
| G309 | By Space, when there are no Spaces | A Space is a named folder for artifacts. Link it to a project folder and its artifacts are copied, read-only, into that folder’s artifacts/ directory, where agents can read them. | stays | Stays. the empty By Space view still says empty and what a Space is, but drops how to make one ("link it to a project folder"); the owner brought back the settings row with the same sentence (G83) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/library/copy.ts:106` | unchanged `src/renderer/src/library/copy.ts:121` | M5 · `m5-library-spaces-none` |
| G310 | the Pinned view and an empty Space (three wordings) | Pin an artifact from its menu to keep it here. | stays | Stays. empty state with what to do ("Pin an artifact from its menu…"), like G249 and T384 | pattern | `src/renderer/src/library/copy.ts:105` | unchanged `src/renderer/src/library/copy.ts:120` | M5 · `m5-library-pinned` |

### Artifact tab (the page around an editor)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| G317 | in place of the editor while it opens | Opening… | cut | While an artifact opens, a breathing dot stands where the editor will be; 'Opening…' is its accessible name only. | pattern | `src/renderer/src/library/copy.ts:27` | unchanged `src/renderer/src/library/copy.ts:28` | M5 · no scene: the tab waits for the artifact read for a moment; no fixture holds it open |
| G319 | in place of the editor when the artifact is gone | Artifact not found · This artifact was deleted, or it is not in the library. | cut | A deleted artifact's tab says one sentence, 'This artifact was deleted.' (Partly applied on the scratch branch: The tab's title 'Artifact not found' stays: it is the tab's only name.) | pattern | `src/renderer/src/library/copy.ts:31` | unchanged `src/renderer/src/library/copy.ts:32` | M5 · `m5-artifact-deleted` |

## The UX wave's new text (M0)

Rows added by M0 for text the UX wave added after the pin. **Today** here is the text on master `028cecd10`, every row's basis is `pattern` (or `consent` for a consent text, or `ruled` where the owner has since ruled on it), and **Source** is the file and line on master.

### An opened artifact

#### Document artifact, Export menu

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N95 | three checked rows after the four formats in the header's Export menu, below a rule | Letter / A4 / Compact | stays | Stays. rule 3: structure; the page size and density the export prints on, shown as checks. No rule cuts them. Doubt for the owner: "Compact" alone does not say what it compacts out of context (rule 4), and the rule line is not a heading. | pattern | `src/renderer/src/tools/document/header.ts:80` | new `src/renderer/src/tools/document/header.ts:80` | M5 · `m5-doc-export-menu` |
| N96 | the header's failure line when an export starts before the last change is acknowledged | The last change is not saved yet. Try again in a moment. | stays | Stays. rule 5: an error keeps its cause and its way out in one sentence. | pattern | `src/renderer/src/tools/document/header.ts:61` | new `src/renderer/src/tools/document/header.ts:61` | M5 · no scene: needs the host to hold back its acknowledgement for the export's 5 s wait |

#### Dashboard artifact, opened (header)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N191 | beside the title of a dashboard made in the old format (state: legacy dashboard) | Read-only | cut | A legacy dashboard's header draws no saved state; its notice says it is kept read-only. | pattern | `src/renderer/src/tools/dashboard/DashboardPanel.tsx:80` | new `src/renderer/src/tools/dashboard/DashboardPanel.tsx:80` | M5 · `m5-artifact-legacy-dashboard` |

#### Dashboard artifact, opened

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N192 | Reread, in the strip above the dashboard, while a changed source is read again | Rereading… | cut | Reread keeps its word, with the quiet spinner named "Rereading…" beside it (`WaitingWords`), and says it is busy. | pattern | `src/renderer/src/tools/dashboard/FileSources.tsx:66` | new `src/renderer/src/tools/dashboard/FileSources.tsx:66` | M5 · no scene: a transient wait no fixture holds (wanted: a dashboard whose CSV changed on disk, Reread pressed with the reread held) |

#### Send to sheet

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N195 | the connection box while a sign-in is under way in the browser (Notion's Connect, gws's sign-in) | Finish connecting in your browser… / Finish signing in in your browser. If you declined, cancel here. | stays | Stays. rule 5: a state the person must act on keeps what to do (finish in the browser, or cancel here); no spinner stands in for an instruction | pattern | `src/renderer/src/delivery/copy.ts:59` | new `src/renderer/src/delivery/copy.ts:59` | M5 · no scene: a sign-in held open in a browser (wanted: Connect pressed on a Notion connector that needs MAWS's sign-in, the browser not answered) |

#### Artifact header, Send to action

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N196 | the same action while a send of the artifact runs | Sending to Notion… | stays | Stays. rule 2 and T129: the header's Send to is the delivery's receipt, naming the service; while it runs it says where it is going, as "Sent to Notion" says where it went | pattern | `src/renderer/src/delivery/copy.ts:18` | new `src/renderer/src/delivery/copy.ts:18` | M5 · no scene: a transient wait no fixture holds (wanted: a document whose Send to Notion is held mid-send) |

#### Connectors sheet of an HTML page artifact

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N197 | a server row's status while an action on it runs (connecting, disconnecting, forgetting) | Connecting… / Disconnecting… / Forgetting… | stays | Stays. rule 2: the live status of one row among several, as M3 kept "Answering…" (N166); a spinner would leave the row without its state | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:142` | new `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:142` | M5 · no scene: a transient wait no fixture holds (wanted: Disconnect pressed on a connected server with the disconnect held) |

### Artifacts library

#### Artifacts, "Make something new" strip

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N150 | the design system chooser at the right of the strip's heading, and its first menu choice | MAWS · default | stays | Stays. rule 2: it says which design system will govern what is made (orients); "· default" looks like the default-state word rule 1 cuts, but without it the choice is just a name and the person cannot tell it from a picked system | pattern | `src/renderer/src/library/copy.ts:113` | new `src/renderer/src/library/copy.ts:113` | M5 · `m5-library-system-menu` |
| N193 | after the strip's heading, in a narrowed Space, while the Spaces are read | · Loading Space… | cut | The quiet spinner, named "Loading Space…", stands where the Space's name will be; "· <Space>" once the Spaces are read ("· General" outside a Space, as G290). | pattern | `src/renderer/src/library/MakeSomethingNew.tsx:280` | new `src/renderer/src/library/MakeSomethingNew.tsx:280` | M5 · no scene: a transient wait no fixture holds (wanted: By Space narrowed to a Space with `library.spaces` held) |

#### Space instructions sheet

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N151 | the sentence over the field of a Space's instructions sheet | Every agent on this Mac that makes or opens an artifact in this Space is given these, and whoever can read its session can read them. | stays | Stays. says who receives and can read what is typed: a disclosure the person agrees to by saving. Wordy; never cut | consent | `src/renderer/src/library/copy.ts:188` | new `src/renderer/src/library/copy.ts:188` | M5 · `m5-library-space-instructions` |

#### Artifact tab (the page around an editor)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N152 | the notice over an editor open on an artifact an agent deleted (with Undo at its right) | An agent deleted this artifact. It takes no edits until it is restored. | reword | The notice reads "An agent deleted this artifact." with Undo; the editor shows read-only as it already does. | pattern | `src/renderer/src/library/copy.ts:35` | new `src/renderer/src/library/copy.ts:35` | M5 · `m5-artifact-agent-deleted` |
| N153 | the same notice while the editor holds an edit the host never took | An agent deleted this artifact. Your last edit is not saved; restoring the artifact saves it. | stays | Stays. rule 5: a state the person must act on keeps its reason; the second sentence says the edit is not saved and what saves it (data at stake) | pattern | `src/renderer/src/library/copy.ts:36` | new `src/renderer/src/library/copy.ts:36` | M5 · no scene: needs the document port’s frames held across the agent’s delete (library.spec’s `__maws_docFrames`) and an edit typed meanwhile, a scene of its own |
| N200 | in place of the editor when the host has no such artifact and no record of its deletion (an id nothing answers to) | Artifact not found · This artifact was deleted, or it is not in the library. | cut | "This artifact isn’t in the library." The tab's title 'Artifact not found' stays; a deletion the host knows of says "This artifact was deleted." (G319). | pattern | `src/renderer/src/library/copy.ts:36` | new `src/renderer/src/library/copy.ts:36` | M5 · no scene: needs a document or artifact fixture in that state (wanted: an artifact link whose id no record answers to, as e2e/maws-tools.spec.ts opens) |

#### Artifacts, empty and failed states

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N190 | the list while the library is first read (no earlier answer to keep on screen) | Reading the library… | cut | The quiet spinner, named "Reading the library…", stands in the note's place with the note's height; a failed read keeps its words and Try again. | pattern | `src/renderer/src/library/copy.ts:115` | new `src/renderer/src/library/copy.ts:115` | M5 · no scene: a transient wait no fixture holds (wanted: the Artifacts page opened with `library.list` held) |

#### Design system in use sheet

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N194 | under the sheet's sentence while the titles of the artifacts that use the system are read | Finding them… | cut | The quiet spinner, named "Finding them…", stands where the list will be. | pattern | `src/renderer/src/library/copy.ts:159` | new `src/renderer/src/library/copy.ts:159` | M5 · no scene: a transient wait no fixture holds (wanted: Delete… on a design system in use, with `library.get` held) |
