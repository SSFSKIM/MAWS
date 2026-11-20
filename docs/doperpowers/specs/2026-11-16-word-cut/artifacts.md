# Word cut: Artifacts: the library and an opened artifact

> Part of `docs/doperpowers/specs/2026-11-16-word-cut-design.md`; read that first. This file is written by `render.py` from `items.json` beside it; a decision changes there and in the root document's Decision Log.

62 items: 33 cut, 1 reworded, 28 stay. Of the 34 that change, the owner saw 4 in a picture or ruled on them; 30 follow the pattern and were not seen.

Columns: **Id** is the item's id in `items.json`. **Where** is the place on the surface. **Today** is the text at the pin `2c7044231` (an example value where the text is built from data). **Decision** is `cut` (the text leaves the resting surface), `reword` (it changes) or `stays` (today's text is kept; the row is here so that nobody proposes it again). **After** says what the surface shows afterwards, as it was built on the scratch branch and shown in the pictures. **Basis** is how firm the decision is, in the words of the root document's "How firm each decision is". **Source** is the file and line at the pin.

## An opened artifact

### Artifact header, Send to action

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T129 | the same action after a send has succeeded, for as long as the receipt is kept | Sent to Notion | stays | Stays. "Sent to Notion" becomes a tick on "Send to…", and the library row stops saying where and when it was sent; close to the who-did-what-when facts the owner brought back (G299) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/delivery/copy.ts:19` |

### Send to sheet

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T131 | under the Notion / Google Drive choice | MAWS sends it itself: no session, no Claude turn. | cut | The Send to sheet no longer says 'MAWS sends it itself: no session, no Claude turn.' | pattern | `src/renderer/src/delivery/copy.ts:22` |
| T132 | under the connection box when Notion is chosen | As a Notion page, its headings, lists and tables kept. | cut | With Notion chosen, the sheet no longer says 'As a Notion page, its headings, lists and tables kept.' | pattern | `src/renderer/src/delivery/copy.ts:23` |
| T134 | the bordered connection box when the service is ready; 3 forms | Connected through MAWS: “notion” in your user settings. | reword | When the service is ready the Send to sheet's connection box shows one short line: "Connected" for Notion, the Google account (or "Connected" when gws names none) for Drive. | pattern | `src/renderer/src/delivery/copy.ts:50` |
| T135 | the connection box when something must be done first; 8 sentences of 12 to 41 words (connect Notion once, sign-in needs renewing, a sign-in is under way, add Notion's MCP server, gws not installed, gws needs an OAuth client, gws not signed in, gws sign-in expired, no Drive access) | gws’s Google sign-in has expired. Signing in again gives gws a new one that covers Google Drive alone, in place of the old; add other services by signing gws in from a terminal. gws keeps the sign-in, MAWS stores nothing. | stays | Stays. kept: consent | consent | `src/renderer/src/delivery/copy.ts:66` |
| T137 | the connection box while it checks; 2 forms | Looking for your Notion connector… | cut | While the connection is checked the box says 'Checking…' for both services. | pattern | `src/renderer/src/delivery/copy.ts:44` |
| T139 | above the status line when this artifact was sent before | Last sent to Notion · 2h ago | cut | Above the status line a previous send reads 'Sent 2h ago'. | pattern | `src/renderer/src/delivery/copy.ts:42` |
| T140 | the status line while sending and after | Exporting and sending to Notion… | cut | The status line reads 'Sending…' while sending and 'Sent as “Q3 plan”' after. | pattern | `src/renderer/src/delivery/copy.ts:43` |

### HTML page or file artifact, opened (viewer)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T567 | beside the title in the artifact's header, always | Read-only | cut | An HTML or file artifact's header no longer says "Read-only" beside the title. | pattern | `src/renderer/src/tools/artifacts/viewers/ByteViewer.tsx:476` |
| T570 | version picker at the left of the bar under the header, present when the artifact has two or more versions | v3 · latest | stays | Stays. the version picker stops marking the latest version, so an older one is not told apart from the current at a glance \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/artifacts/viewers/copy.ts:11` |
| T571 | chip at the right of the same bar when the page logged errors or warnings (state: console output) | 2 console errors / 1 console warning | cut | The console chip says "2 errors" / "1 warning". | pattern | `src/renderer/src/tools/artifacts/viewers/copy.ts:20` |
| T573 | in the body while the artifact is read (state: loading) | Loading… | cut | While an HTML or file artifact is read its body is empty for half a second, then shows a small spinner. | pattern | `src/renderer/src/tools/artifacts/viewers/copy.ts:8` |
| T575 | pill at the top of the page after pressing Comment (state: picking an element) | Click an element to comment on it · Esc cancels | cut | The picking pill says "Click an element · Esc cancels". | pattern | `src/renderer/src/tools/artifacts/viewers/copy.ts:18` |

### Export, any artifact

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T579 | tail of the same toast when a document with comments was exported (state: done) | · Comments credited to {name}; change in Settings › Artifacts. | cut | The export toast ends "· Comments credited to {name}", without the Settings pointer. | pattern | `src/renderer/src/tools/artifacts/viewers/copy.ts:30` |

### Connectors sheet of an HTML page artifact

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T582 | paragraph under the sheet's title (two variants: 37 and 48 words) | This page asks to use these tools. An allowed tool runs through a live session’s connection, or MAWS’s own connection to a server a session reported, while the page is on screen, and never while it is hidden or closed. | stays | Stays. kept: consent | consent | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:106` |
| T584 | state line under each tool's name, for a tool not yet allowed | Not allowed | stays | Stays. kept: consent | consent | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:31` |
| T587 | after the state on a tool's line, once the page has called it | · Read at 14:02 | stays | Stays. when the page last called a tool ("Read at 14:02") moves to hover; a time fact, and near consent (a page using your tools) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:33` |
| T589 | a boxed row under the tools when no live session can run them (state: no session; two variants) | Neither a live session nor MAWS’s own connection reaches these tools’ server. Start the artifact’s session to read live data; no message is sent. | cut | The no-session box says "No live session reaches these tools. Starting one sends no message." (the session-only variant: "No live session has these tools. Starting one sends no message."). | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:113` |
| T591 | status beside Start session while it works (state: starting) | Starting… / Starting the session… / The session is ready | cut | Beside Start session the status reads "Starting…" for both phases, then "Ready". | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:51` |
| T594 | sentence under the Servers head | MAWS’s own connections. Disconnect affects MAWS only: sessions keep their own sign-in, and allowed tools stay allowed. | stays | Stays. kept: consent | consent | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:115` |
| T595 | under the Servers head while they are read (state: loading) | Reading MAWS’s connections… | cut | While the Servers are read a quiet spinner shows under the heading, after half a second. | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:116` |
| T596 | after each server's name | · HTTP / · local command | stays | Stays. a server's transport, which the owner brought back for connectors (G252) | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:120` |
| T597 | second line of each server row (representative) | User config · {path to the configuration file} | stays | Stays. a server's scope and configuring file, which the owner brought back for connectors (G254) | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:121` |
| T598 | third line of a server row that works | MAWS can reach it directly / Connected through MAWS | stays | Stays. "Connected" on a working server, which the owner brought back for connectors (G253) | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:128` |
| T600 | third line of a server only a session can use (representative of ten reasons) | Session only: Its configuration needs something only a session has (a ${…} reference, or a source MAWS doesn’t read) | cut | A session-only server's line says "Session only"; the reason shows under the pointer on that line. | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:63` |
| T601 | after a server's status, the outcome of the last Connect or Disconnect (success forms) | · Connected · 3 tools listed / · Disconnected / · Disconnected and revoked | cut | After Connect the row says "3 tools"; after Disconnect "Disconnected" (also when revoked). | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:138` |
| T605 | paragraph under the server rows after an unreadable saved connection was dropped (state: recovery) | An unreadable saved MAWS connection was forgotten, so until MAWS relaunches it won’t reach a server without its own MAWS sign-in. Connect signs a server in now; one that needs no sign-in works again after a relaunch. | cut | After an unreadable saved connection was dropped the note says "A saved connection couldn't be read and was forgotten. Connect to sign in again, or relaunch MAWS." | pattern | `src/renderer/src/tools/artifacts/viewers/connectors/copy.ts:119` |

### Document, presentation, design or dashboard, opened (header)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T607 | beside the title, whenever nothing is pending (the deck's toolbar prints "Saved") | All changes saved | stays | Stays. the owner keeps the saved status in view: the editor header keeps "All changes saved" | ruled | `src/renderer/src/tools/document/header.ts:66` |

### Document artifact, opened

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T608 | before the title in the header, when the document is in no Space | General / | cut | A document in no Space has no "General /" before its title. | seen | `src/renderer/src/tools/document/DocumentPanel.tsx:79` |
| T609 | before the title in the header, after the Space | Design: {design system name} / | stays | Stays. skipped: no place to move it to | not a cut | `src/renderer/src/tools/document/DocumentPanel.tsx:81` |
| T610 | before the title in the header while the Spaces are read (state: loading) | Loading Space… / | cut | While the Spaces are read the header shows no "Loading Space… /". | pattern | `src/renderer/src/tools/document/DocumentPanel.tsx:81` |
| T612 | a worded, greyed button in the header while an export runs (state: exporting) | Exporting Markdown… | cut | While an export runs the greyed header button says "Exporting…". | pattern | `src/renderer/src/tools/document/header.ts:75` |
| T614 | the header's Export menu | Markdown (.md) / Web page (.html) / Word (.docx) / Word, A4 (.docx) / PDF (.pdf) / PDF, A4 (.pdf) | stays | Stays. skipped: a rename and menu restructure | not a cut | `src/renderer/src/tools/document/header.ts:47` |
| T615 | centred in the body while the artifact opens (the same line for a document, a presentation and a design) | Opening the document… | cut | While a document, presentation or design opens the body is blank, then a small spinner. | pattern | `src/renderer/src/tools/document/DocumentPanel.tsx:169` |
| T617 | centred in the body of a document with no first page (state: empty, old document) | This document has no content yet: it was created before MAWS gave every new document its first page. | cut | An old empty document says "This document is empty." | pattern | `src/renderer/src/tools/document/DocumentPanel.tsx:170` |
| T621 | the small card that stands where a comment's card will be while its session starts (state: starting) | Starting a session for this comment… | cut | The placeholder card says "Starting a session…". | pattern | `src/renderer/src/tools/document/comment-session.tsx:38` |
| T624 | at the end of each row of the @-mention picker (representative: "Session" and the seven kind names) | Session / Document / HTML page | stays | Stays. skipped: needs a file outside the part | not a cut | `src/renderer/src/tools/document/mentions.ts:31` |

### Dashboard artifact, opened

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T626 | a strip above the dashboard when a dataset's source file changed or went missing (state: source changed; two forms) | {file} changed. Showing the saved data. | cut | The source strip says "{file} changed" or "{file} is unavailable", with Reread beside it. | pattern | `src/renderer/src/tools/dashboard/FileSources.tsx:65` |
| T629 | the whole body of a dashboard made in the old format (state: legacy dashboard): two paragraphs around a list of its files | This dashboard was made before dashboards were documents, so it is kept read-only, exactly as it is. It holds these files: … To keep working on it, ask an agent to read its files and create a new dashboard from them, then delete this one. | cut | A legacy dashboard says "An older dashboard, kept read-only. To keep working on it, ask an agent to rebuild it from these files:" above its file list, and nothing below. | pattern | `src/renderer/src/tools/dashboard/DashboardPanel.tsx:86` |

### Design artifact, opened

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T632 | sheet shown when a board is too large to export at full size (state: export too large) | Export “{board}” at 42%? · “{board}” is 20000 × 9000 px. A PNG can be at most 8192 px on a side, so MAWS exports the whole board at 42% (8192 × 3686 px); nothing is cropped. · Export at 42% | cut | The too-large sheet: title "Export “Hero” at 42%?", body "Too large for a PNG at full size.", button "Export at 42%". | pattern | `src/renderer/src/tools/design/exports.ts:109` |

### Presentation artifact, opened

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T635 | a worded menu button in the deck's toolbar | Deck actions ▾ | stays | Stays. skipped: drawn outside the part | not a cut | `src/renderer/src/tools/presentation/DeckBody.tsx:89` |
| T636 | items of that menu | Theme / Check against the design system | cut | The deck's action reads "Check design" (Theme unchanged). | pattern | `src/renderer/src/tools/presentation/header.ts:43` |

### Right column, editor header row

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P23 | same place, while a save is in flight | Saving… | cut | While a save runs the editor header shows a small spinner ("Saving…" under the pointer). | pattern | `src/renderer/src/panel/editor-host.ts:45` |
| P24 | same place, when there are edits not yet saved | Unsaved changes | cut | Unsaved edits show as a dot in the editor header ("Unsaved changes" under the pointer). (Partly applied on the scratch branch: The dot is in the header, not on the tab: the tab strip has no access to the editor's saved state without a new store read.) | pattern | `src/renderer/src/panel/editor-host.ts:46` |

## Artifacts library

### Artifacts, page head

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G283 | the title at the left of the head | Artifacts | cut | The head no longer prints 'Artifacts' (the tab already says it); the heading stays for assistive tech. | seen | `src/renderer/src/library/copy.ts:86` |
| G284 | a button after the title, shown when other machines are known; its menu lists them | This Mac ▾ | stays | Stays. which machine the library shows (the owner brought back "This Mac", P29), and a way in | pattern | `src/renderer/src/library/copy.ts:95` |
| G285 | a four-part switch in the head | All · General · Pinned · By Space | stays | Stays. brought back on artifacts-library | brought back | `src/renderer/src/library/copy.ts:87` |
| G287 | a button after the search; its menu lists the seven kinds with counts | All types ▾ | cut | 'All types' is gone from the head; the kinds (with counts) are the second group of the funnel menu, and a chosen kind stands beside the search as a chip with its glyph that clears it. | seen | `src/renderer/src/library/copy.ts:91` |
| G289 | a bordered button at the right end of the head | + New Space | cut | '+ New Space' is gone from the head; 'New Space…' is the last row of the + menu (and still in a row's Move to Space menu). | seen | `src/renderer/src/library/copy.ts:92` |

### Artifacts, "Make something new" strip

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G290 | a small heading over the strip, with the place it will file into | Make something new · General | stays | Stays. brought back on artifacts-library | brought back | `src/renderer/src/library/copy.ts:96` |
| G291 | seven cards always at the top of the list, each with a kind's name and two word buttons (Document, Presentation, Design, Design system, Dashboard, HTML page, File) | Document · New · Ask Claude | stays | Stays. brought back on artifacts-library | brought back | `src/renderer/src/library/copy.ts:98` |

### Artifacts, the list

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G295 | after a Space's name in its group head, when the Space is linked to a folder | Mirrored to ~/code/app/artifacts | stays | Stays. a Space's mirrored folder becomes a link glyph with the path on hover; the owner brought back a connector's path that had moved to hover (G254) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/library/copy.ts:111` |
| G296 | every row, second line, first word: the kind (seven wordings) | Document | stays | Stays. part of the library row's second line ("HTML page · General · Edited now by You") the owner brought back; only G299 was recorded for that change | brought back | `src/renderer/src/library/copy.ts:6` |
| G297 | every row, second line: its Space as a small button, or the word General | General | stays | Stays. part of the library row's second line the owner brought back (see G296); only G299 was recorded | brought back | `src/renderer/src/library/Row.tsx:157` |
| G298 | every row, second line: the project it came from | <project> | stays | Stays. part of the library row's second line, which the owner brought back (G299) | pattern | `src/renderer/src/library/Row.tsx:163` |
| G299 | every row, second line: who edited it and when | Edited 2h ago by Claude | stays | Stays. brought back on artifacts-library, artifacts-library-hover | brought back | `src/renderer/src/library/copy.ts:117` |
| G302 | every row: chips naming the sessions that touched it, up to three and then a count | <session title> · <session title> · +2 | stays | Stays. brought back by the owner, though no picture's change list carries it | brought back | `src/renderer/src/library/copy.ts:119` |

### Artifacts, empty and failed states

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G308 | the list when the library is empty | Nothing here yet. Documents, decks, HTML pages and the files your sessions send land here, and so does anything you make above. | stays | Stays. a whole page's empty state keeps its explanation, as the owner brought back for skills (G249); the library was "too bare" | pattern | `src/renderer/src/library/copy.ts:104` |
| G309 | By Space, when there are no Spaces | A Space is a named folder for artifacts. Link it to a project folder and its artifacts are copied, read-only, into that folder’s artifacts/ directory, where agents can read them. | stays | Stays. the empty By Space view still says empty and what a Space is, but drops how to make one ("link it to a project folder"); the owner brought back the settings row with the same sentence (G83) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/library/copy.ts:106` |
| G310 | the Pinned view and an empty Space (three wordings) | Pin an artifact from its menu to keep it here. | stays | Stays. empty state with what to do ("Pin an artifact from its menu…"), like G249 and T384 | pattern | `src/renderer/src/library/copy.ts:105` |

### Artifact tab (the page around an editor)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G317 | in place of the editor while it opens | Opening… | cut | While an artifact opens, a breathing dot stands where the editor will be; 'Opening…' is its accessible name only. | pattern | `src/renderer/src/library/copy.ts:27` |
| G319 | in place of the editor when the artifact is gone | Artifact not found · This artifact was deleted, or it is not in the library. | cut | A deleted artifact's tab says one sentence, 'This artifact was deleted.' (Partly applied on the scratch branch: The tab's title 'Artifact not found' stays: it is the tab's only name.) | pattern | `src/renderer/src/library/copy.ts:31` |
