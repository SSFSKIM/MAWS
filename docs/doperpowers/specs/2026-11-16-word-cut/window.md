# Word cut: Window, sidebar, sheets and overview

> Part of `docs/doperpowers/specs/2026-11-16-word-cut-design.md`; read that first. This file is written by `render.py` from `items.json` beside it; a decision changes there and in the root document's Decision Log.

105 items: 70 cut, 1 reworded, 34 stay. Of the 71 that change, the owner saw 20 in a picture or ruled on them; 51 follow the pattern and were not seen.

Against master (M0): 104 unchanged, 1 moot; none waits on the owner; 3 put to the owner (new rows included) and since ruled. M0 added 6 rows for the UX wave's new text (2 cut, 1 reworded, 3 stay), listed at the end.

Columns: **Id** is the item's id in `items.json`. **Where** is the place on the surface. **Today** is the text at the pin `2c7044231` (an example value where the text is built from data). **Decision** is `cut` (the text leaves the resting surface), `reword` (it changes) or `stays` (today's text is kept; the row is here so that nobody proposes it again). **After** says what the surface shows afterwards, as it was built on the scratch branch and shown in the pictures. **Basis** is how firm the decision is, in the words of the root document's "How firm each decision is". **Source** is the file and line at the pin. **M0** is what the re-reading against master found (see the root document's "M0's record"): `unchanged`, `moved`, `rewritten by the wave`, `gone` or `moot`, with the file and line on master, and for a rewritten row the text master shows and the row decided again by the five rules. **Build** is the milestone that builds the row and the scene whose before and after pictures show it.

## New chat

### New chat, the row above the message box

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C65 | tooltip of the project chip (two wordings) | Select a project to run your chat in | cut | The project chip's tooltip is the chosen folder's path (on another machine, "<project> on <machine>"); before a choice it has none. | pattern | `src/renderer/src/composer/frame/ProjectRow.tsx:282` | unchanged `src/renderer/src/composer/frame/ProjectRow.tsx:282` | M4 · no scene: needs the pointer on a control the rig does not hover (wanted: New chat with the pointer on the project chip (its tooltip)) |
| C66 | second chip, shown when another machine is reachable; tooltip "Where this chat runs" | This Mac | stays | Stays. which machine: "This Mac", which the owner brought back on the session card (P29); applied as a bare glyph (applied only in part on the scratch branch) | pattern | `src/renderer/src/composer/frame/MachineMenu.tsx:24` | unchanged `src/renderer/src/composer/frame/MachineMenu.tsx:24` | M4 · no scene: needs a session on another machine (wanted: New chat with a second machine reachable (the machine chip beside the project chip)) |
| C67 | line under the row once another machine is chosen | Lane B on mini · mini’s inference route | cut | No line under the project row once another machine is chosen; the machine chip names it. | pattern | `src/renderer/src/composer/frame/MachineMenu.tsx:27` | unchanged `src/renderer/src/composer/frame/MachineMenu.tsx:27` | M4 · no scene: needs a session on another machine (wanted: New chat with another machine chosen (the line under the row)) |

### New chat, project menu

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C70 | last action under the list | Don't work in a project | cut | The project menu's last action reads "No project". | pattern | `src/renderer/src/composer/frame/ProjectRow.tsx:46` | unchanged `src/renderer/src/composer/frame/ProjectRow.tsx:46` | M4 · no scene: needs that window, sidebar or banner state (wanted: New chat, the project menu open) |

### New chat, machine menu

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C71 | under the list while other machines are asked | Looking for this project on other machines… | cut | The machine menu says "Looking…" under the list while other machines are asked. | pattern | `src/renderer/src/composer/frame/MachineMenu.tsx:26` | unchanged `src/renderer/src/composer/frame/MachineMenu.tsx:26` | M4 · no scene: needs a session on another machine (wanted: New chat, the machine menu open while other machines are being asked) |

### New chat page

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W86 | centred heading above the message box | New chat in <project> | cut | The New chat page draws no heading above the message box (the heading stays for assistive tech). | seen | `src/renderer/src/sessions/NewSessionEmptyState.tsx:40` | unchanged `src/renderer/src/sessions/NewSessionEmptyState.tsx:40` | M4 · `new-chat` |
| W89 | a yellow-edged note under the heading after a failed start left a worktree behind, with two buttons | Worktree x-1a2b from the failed attempt is still this session’s: Send reuses it, and the location cannot change until you keep or discard it. | cut | The note after a failed start reads "Worktree x-1a2b is left from the failed start. Keep it or discard it." with its two buttons and the tick. | pattern | `src/renderer/src/sessions/RetainedWorktreeNote.tsx:49` | unchanged `src/renderer/src/sessions/RetainedWorktreeNote.tsx:49` | M4 · no scene: needs that window, sidebar or banner state (wanted: New chat after a failed start left a worktree behind) |

### New chat, trust card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W91 | body of the trust card, under the folder path | Loads its settings, hooks, MCP servers and plugins, exactly as the terminal does. Recorded in ~/.claude.json; the terminal will not ask again. | stays | Stays. kept: consent | consent | `src/renderer/src/sessions/TrustCard.tsx:68` | unchanged `src/renderer/src/sessions/TrustCard.tsx:68` | M4 · no scene: needs that window, sidebar or banner state (wanted: New chat in a folder Claude Code does not trust yet (the trust card)) |

### New chat, relay card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W96 | first line of the card titled "Relay not answering" | ClaudeUsage’s relay is not answering | cut | The relay card no longer repeats its title in a first line. | pattern | `src/renderer/src/sessions/RelayCard.tsx:55` | unchanged `src/renderer/src/sessions/RelayCard.tsx:55` | M4 · no scene: needs that window, sidebar or banner state (wanted: New chat with the relay not answering (the relay card)) |
| W97 | second line, in grey | Waiting for the relay · checked 5s ago · http://127.0.0.1:8787/api/hello · HTTP 503 | cut | The relay card's grey line reads "Checked 5s ago"; the address and HTTP status are under the pointer on that line. | pattern | `src/renderer/src/sessions/RelayCard.tsx:57` | unchanged `src/renderer/src/sessions/RelayCard.tsx:57` | M4 · no scene: needs that window, sidebar or banner state (wanted: New chat with the relay not answering (the relay card)) |
| W98 | three grey lines that each explain one of the buttons below them | Run direct: the engine’s own login for this session; no gateway models, and switching back later restarts the session. | cut | The relay card's three explaining lines are gone; each sentence is its button's tooltip (Run direct keeps "Pick a Claude model first" while it is greyed). The reason for a greyed control needs an owner that takes keyboard focus; see "What the cut builds" in the root document. | pattern | `src/renderer/src/sessions/RelayCard.tsx:62` | unchanged `src/renderer/src/sessions/RelayCard.tsx:62` | M4 · no scene: needs that window, sidebar or banner state (wanted: New chat with the relay not answering (the relay card)) |

## Title bar and tabs

### Title bar

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W3 | on the corner of the Overview button, only while a session waits for you | ◐3 | stays | Stays. brought back on session-approval | brought back | `src/renderer/src/app/Toolbar.tsx:136` | unchanged `src/renderer/src/app/Toolbar.tsx:146` | M4 · `session-approval` |
| W4 | left of the tabs, only when the window is wide enough: a folder icon and the current project | <project name> | cut | The title bar no longer shows the folder icon and project name left of the tabs; the tabs and surface icons take that room. | seen | `src/renderer/src/app/Toolbar.tsx:181` | unchanged `src/renderer/src/app/Toolbar.tsx:191` | M4 · `shell-tools` |
| W6 | where the tabs were, while Customize, Projects or Artifacts is open: a back arrow and the page name as a heading | Customize | reword | the page name in the title bar stays on the Projects page; Customize and Artifacts stay without it, as the owner left them | ruled | `src/renderer/src/app/Toolbar.tsx:206` | unchanged `src/renderer/src/app/Toolbar.tsx:216` Put to the owner: U7 O-40 / U11 O-14 fix that the page name stands once, in the title bar ("the name in the title bar is the page's heading"; Customize's own head does not repeat it); this row removes it from Customize and Artifacts. **Ruled by the owner, 2026-11-20, card 3: built as written.** | M4 · `customize-plugins` |

### Tab strip

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W9 | small grey text after a session tab's title, only when the open tabs are in more than one project or machine | <project> @<machine> | stays | Stays. which project and machine a tab belongs to, shown only when tabs span several (machine names came back, P29) | pattern | `src/renderer/src/main/Tab.tsx:192` | unchanged `src/renderer/src/main/Tab.tsx:196` | M4 · no scene: needs a session on another machine (wanted: Tab strip with session tabs of two projects open (one on a second machine)) |
| W10 | small grey text at the end of a tab whose session runs in a terminal or as a background job and is driven from here | Terminal | cut | A tab whose session runs in a terminal or as a background job shows the blue ⌁ glyph instead of the word; the word stays its accessible name and the hover still explains it. | pattern | `src/renderer/src/main/Tab.tsx:110` | unchanged `src/renderer/src/main/Tab.tsx:110` | M4 · no scene: needs a terminal-held session in that state (wanted: A session a terminal holds, driven from MAWS through its bridge, its tab open) |
| W13 | before the file name on a file tab, in blue monospace | ts | cut | A file tab shows a small file glyph before its name instead of the blue extension. | pattern | `src/renderer/src/main/Tab.tsx:178` | unchanged `src/renderer/src/main/Tab.tsx:182` | M4 · no scene: needs that window, sidebar or banner state (wanted: A file tab open in the main area (tab strip)) |

## Banners, toasts and the main area

### Main area

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W22 | centre of the window when no tab is open | No open tabs | cut | With no tab open the window centre shows only the Overview and New chat buttons. | pattern | `src/renderer/src/main/Pane.tsx:210` | unchanged `src/renderer/src/main/Pane.tsx:211` | M4 · `m0-empty-main` |
| W23 | first button under "No open tabs" | Overview ⌘0 | cut | The empty-window button reads Overview; its ⌘0 is in its tooltip. | pattern | `src/renderer/src/main/Pane.tsx:213` | unchanged `src/renderer/src/main/Pane.tsx:214` | M4 · `m0-empty-main` |
| W25 | a line across the top of a session that lives on another machine, while its link is down (or the middle of the tab if it never loaded) | <machine> is offline · this session reconnects when it’s back | cut | The strip on a session of an offline machine reads "<machine> is offline". | pattern | `src/renderer/src/app/machine-mark.ts:44` | unchanged `src/renderer/src/app/machine-mark.ts:44` | M4 · no scene: needs a session on another machine (wanted: A session on a second machine whose link is down) |

### Banner under the title bar

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W27 | full-width strip after an app update while old sessions still run, with a Restart now button | MAWS was updated. 3 sessions are still running on the previous version's supervisor; MAWS moves to the new one when they become idle. Sessions started meanwhile run on it too. | cut | The update banner reads "Updated. Finishes when 3 sessions go idle." with Restart now. | pattern | `src/renderer/src/app/copy.ts:72` | unchanged `src/renderer/src/app/copy.ts:72` | M4 · no scene: needs that window, sidebar or banner state (wanted: Supervisor update banner (updated while old sessions run, incompatible, or waiting for tool calls)) |
| W28 | same strip, when the update cannot talk to the old background process | MAWS was updated and cannot talk to the previous supervisor, which still runs 3 sessions. No session can start until it exits, which it does by itself once they go idle. | cut | The incompatible-update banner reads "Updated. New sessions start once 3 running ones go idle." with Restart now and Wait. | pattern | `src/renderer/src/app/copy.ts:74` | unchanged `src/renderer/src/app/copy.ts:74` | M4 · no scene: needs that window, sidebar or banner state (wanted: Supervisor update banner (updated while old sessions run, incompatible, or waiting for tool calls)) |
| W29 | buttons on those banners | Restart now | stays | Stays. kept: consent | consent | `src/renderer/src/app/copy.ts:75` | unchanged `src/renderer/src/app/copy.ts:75` | M4 · no scene: needs that window, sidebar or banner state (wanted: Supervisor update banner (updated while old sessions run, incompatible, or waiting for tool calls)) |
| W30 | same strip, while an update waits for tool calls | Waiting for MAWS tool calls to finish before updating the engine host (2 calls running). | cut | The banner while tool calls finish reads "Updating after 2 running calls" (also in the Diagnostics row and Settings status line, which share the words). | pattern | `src/renderer/src/app/copy.ts:67` | unchanged `src/renderer/src/app/copy.ts:67` | M4 · no scene: needs that window, sidebar or banner state (wanted: Supervisor update banner (updated while old sessions run, incompatible, or waiting for tool calls)) |

### Toast, bottom right

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W32 | after the background process that runs sessions crashed | The session supervisor stopped unexpectedly (exit 1); 2 sessions were interrupted. Their transcripts are on disk; open one to resume. | cut | The crash toast reads "2 sessions were interrupted. Open one to resume."; the re-adopted variant drops "Their transcripts are on disk". | pattern | `src/renderer/src/app/copy.ts:86` | unchanged `src/renderer/src/app/copy.ts:86` | M4 · no scene: needs that window, sidebar or banner state (wanted: Toast after the session supervisor crashed) |
| W33 | after trying to open a session something else holds, with an Attach button | Held by Terminal · pid 4312 | cut | The toast after opening a session held elsewhere reads "Running in Terminal" (or "Running as a background job"), with no pid or job id; its Attach button stays. | pattern | `src/renderer/src/sessions/holder-words.ts:27` | unchanged `src/renderer/src/sessions/holder-words.ts:27` | M4 · no scene: needs a terminal-held session in that state (wanted: Toast after opening a session a terminal holds (Attach button)) |
| W34 | after closing or replacing an unstarted chat that had a draft | The new chat’s draft is kept; ⌘⇧T or Reopen brings it back | cut | The toast after closing or replacing an unstarted chat with a draft reads "Draft kept", with its Reopen button. | pattern | `src/renderer/src/sessions/setup-actions.ts:298` | unchanged `src/renderer/src/sessions/setup-actions.ts:298` | M4 · no scene: needs that window, sidebar or banner state (wanted: Toast after closing an unstarted chat that has a draft) |

### Session held elsewhere

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W101 | grey text before those buttons when versions differ | Job on 2.1.4; attach runs the installed 2.1.9 | cut | No grey version line before the held-session buttons; a version mismatch is Attach's tooltip. | pattern | `src/renderer/src/sessions/HolderActions.tsx:53` | unchanged `src/renderer/src/sessions/HolderActions.tsx:57` | M4 · no scene: needs that window, sidebar or banner state (wanted: Held-session notice whose job runs another engine version than the installed one) |

## Sidebar

### Sidebar, top rows

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W37 | second row, opens the page that lists every project | Projects | stays | Stays. brought back on shell-tools | brought back | `src/renderer/src/sidebar/Sidebar.tsx:608` | unchanged `src/renderer/src/sidebar/Sidebar.tsx:610` | M4 · `shell-tools` |
| W40 | at the right end of the search field | ⌘K | cut | The search field shows no ⌘K at rest; the key appears while the pointer is over the field or it has focus. | seen | `src/renderer/src/sidebar/Search.tsx:33` | unchanged `src/renderer/src/sidebar/Search.tsx:33` | M4 · `shell-tools` |
| W41 | a row that appears under the search field while you type | Search in conversations for ‘<query>’ | cut | While typing in the search, the row under the field reads "Search inside conversations" without repeating the query. | pattern | `src/renderer/src/sidebar/Sidebar.tsx:481` | unchanged `src/renderer/src/sidebar/Sidebar.tsx:483` | M4 · `m0-sidebar-search` |
| W42 | a grey line under the search field, only while the hub cannot be reached | Hub unreachable | stays | Stays. "Hub unreachable", an exception, becomes a small warning glyph in the sidebar foot \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/sidebar/HubNotice.tsx:8` | unchanged `src/renderer/src/sidebar/HubNotice.tsx:8` | M4 · no scene: a transient wait no fixture holds (wanted: Sidebar while the hub is unreachable) |

### Sidebar, Needs you

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W43 | a whole section at the top of the list, only while a session waits: a heading and one row per waiting session, each of which is normally also in its project below | NEEDS YOU · 3 | stays | Stays. brought back on session-approval | brought back | `src/renderer/src/sidebar/NeedsYou.tsx:61` | unchanged `src/renderer/src/sidebar/NeedsYou.tsx:63` | M4 · `session-approval` |
| W44 | at the right end of each Needs-you row | <project name> | stays | Stays. the project on each Needs-you row: part of the section the owner brought back (W43), where rows from many projects mix | brought back | `src/renderer/src/sidebar/NeedsYou.tsx:146` | unchanged `src/renderer/src/sidebar/NeedsYou.tsx:151` | M4 · `session-approval` |

### Sidebar, project list

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W45 | small capitals above the project list, with three icons at its right | PROJECTS | stays | Stays. brought back on shell-tools, shell-tools-open, shell-tools-transcript-view | brought back | `src/renderer/src/sidebar/Sidebar.tsx:499` | unchanged `src/renderer/src/sidebar/Sidebar.tsx:501` | M4 · `shell-tools` |
| W49 | grey label at the top of the sort menu | Sort sessions by | cut | The sort menu holds just Priority and Recency, with no "Sort sessions by" label. | pattern | `src/renderer/src/sidebar/Sidebar.tsx:569` | unchanged `src/renderer/src/sidebar/Sidebar.tsx:571` | M4 · no scene: needs that window, sidebar or banner state (wanted: Sidebar sort menu open) |
| W52 | grey text at the right of a project row whose folders are on other machines | mini · studio offline | stays | Stays. which machine, and that one is offline (machine names came back with "This Mac", P29; an exception keeps its word) | pattern | `src/renderer/src/sidebar/ProjectRow.tsx:99` | unchanged `src/renderer/src/sidebar/ProjectRow.tsx:99` | M4 · no scene: needs a session on another machine (wanted: Sidebar project whose folders are on other machines (one offline)) |
| W53 | grey text at the right of a project row when teammates' sessions are not shown | +4 others | stays | Stays. a count turned into a dimmed mark, like the Overview count the owner brought back (W3) | pattern | `src/renderer/src/sidebar/ProjectRow.tsx:212` | unchanged `src/renderer/src/sidebar/ProjectRow.tsx:212` | M4 · no scene: needs that window, sidebar or banner state (wanted: Sidebar project row with teammates' sessions not shown (+N others)) |
| W58 | grey link at the very end of the list, when any project is hidden | Hidden projects… | stays | Stays. a way in (to hidden projects), like the Projects row and the Customize link the owner brought back (W37, G5) | pattern | `src/renderer/src/sidebar/Sidebar.tsx:524` | unchanged `src/renderer/src/sidebar/Sidebar.tsx:526` | M4 · no scene: needs that window, sidebar or banner state (wanted: Sidebar with a hidden project (the Hidden projects link)) |
| W59 | grey link at the very end of the list, always | Archived sessions… | cut | "Archived sessions…" at the end of the list shows only while the pointer or focus is in the sidebar; each project's archived sessions are in its right-click menu. (Partly applied on the scratch branch: Kept as a hover-revealed row rather than removed: the command palette has no Archived sessions command (adding one is src/renderer/src/palette/CommandPalette.tsx, outside this slice), and this row is the only door to the archived sessions of no project.) | seen | `src/renderer/src/sidebar/Sidebar.tsx:533` | unchanged `src/renderer/src/sidebar/Sidebar.tsx:535` | M4 · `shell-tools-open` |

### Sidebar, session row

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W61 | right end of every session row | 2m | stays | Stays. brought back on shell-tools | brought back | `src/renderer/src/sidebar/SessionRow.tsx:109` | unchanged `src/renderer/src/sidebar/SessionRow.tsx:109` | M4 · `shell-tools` |
| W62 | after the title, on a session that runs on another machine | @mini | stays | Stays. skipped: the machine chip is shared by nine surfaces | not a cut | `src/renderer/src/app/machine-mark.ts:126` | unchanged `src/renderer/src/app/machine-mark.ts:126` | M4 · no scene: needs a session on another machine (wanted: Sidebar session row of a session on another machine) |
| W64 | after the title, on a session you share with others | Ana, Ben | stays | Stays. who shares a session leaves the row; nothing at rest says it is shared; close to "who edited what" the owner brought back \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/sidebar/RowTitle.tsx:21` | unchanged `src/renderer/src/sidebar/RowTitle.tsx:21` | M4 · no scene: needs that window, sidebar or banner state (wanted: Sidebar session row of a session shared with others) |
| W65 | grey text taking up to half the row on a side thread or fork | ↳ side thread of <parent title> | stays | Stays. "side thread of <parent>" becomes "↳" alone; the parent's name is lost at rest \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/side/copy.ts:147` | unchanged `src/renderer/src/side/copy.ts:147` | M4 · no scene: needs that window, sidebar or banner state (wanted: Sidebar side-thread row) |
| W68 | hovering a greyed item in any of these menus | Not available here | cut | A greyed item in the sidebar's menus has no "Not available here" tooltip; an item with a real reason still shows it. | pattern | `src/renderer/src/sidebar/menus.tsx:80` | unchanged `src/renderer/src/sidebar/menus.tsx:84` | M4 · no scene: needs the pointer on a control the rig does not hover (wanted: Pointer on a greyed item in a sidebar menu) |

### Sidebar, session hover card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W69 | second line of the card that opens beside a hovered session | Working · 2m · ctx 43% | cut | The session hover card's second line is the age alone ("2m"); the state word is under the pointer on the glyph, and the context share appears only from 80% up. | seen | `src/renderer/src/sidebar/HoverCard.tsx:189` | unchanged `src/renderer/src/sidebar/HoverCard.tsx:192` | M4 · `sidebar-hover` |
| W70 | third line: the machine and how it is reached | mini · direct (tailnet) | cut | The sidebar hover card names the machine alone ("mini"), without how it is reached. | pattern | `src/renderer/src/app/machine-mark.ts:137` | unchanged `src/renderer/src/app/machine-mark.ts:137` | M4 · no scene: needs a session on another machine (wanted: Sidebar hover card of a session on another machine) |
| W71 | owners, one per line with their email | Ana Souza <email> | cut | The hover card lists owners by name only, without emails. | pattern | `src/renderer/src/sidebar/HoverCard.tsx:279` | unchanged `src/renderer/src/sidebar/HoverCard.tsx:282` | M4 · no scene: needs the pointer on a control the rig does not hover (wanted: Sidebar hover card of a session with owners) |
| W73 | where it runs | ⎇ feature/x · worktree x-1a2b | cut | The hover card's place line reads "⎇ feature/x"; the worktree folder is the line's tooltip (its name stands in when the branch is unknown). | pattern | `src/renderer/src/sidebar/HoverCard.tsx:160` | unchanged `src/renderer/src/sidebar/HoverCard.tsx:162` | M4 · no scene: needs the pointer on a control the rig does not hover (wanted: Sidebar hover card of a session in a worktree) |
| W77 | second line of the card for a teammate's listed session | Idle · updated 2h ago | cut | A teammate's listed session's hover card reads "2h ago" alone; the state word is under the pointer on the glyph. | pattern | `src/renderer/src/sidebar/HoverCard.tsx:249` | unchanged `src/renderer/src/sidebar/HoverCard.tsx:252` | M4 · no scene: needs the pointer on a control the rig does not hover (wanted: Sidebar hover card of a teammate's listed session) |
| W75 | on a session held by a terminal or background job | Terminal · pid 4312 | cut | The hover card's holder line reads "Running in Terminal"; a background job with no id reads "Background job". | seen | `src/renderer/src/attention/derive.ts:90` | unchanged `src/renderer/src/attention/derive.ts:90` | M4 · `overview-scrolled` |

### Sidebar, project hover card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W78 | counts line of the card beside a hovered project | 12 sessions · 0 waiting · 3 working | cut | The project hover card's counts line drops any zero part ("12 sessions · 3 working"), and the line is gone when all are zero. | seen | `src/renderer/src/sidebar/ProjectHoverCard.tsx:47` | unchanged `src/renderer/src/sidebar/ProjectHoverCard.tsx:47` | M4 · `sidebar-hover-project` |
| W79 | activity line | Last active 2h ago | cut | The project hover card's activity line reads "2h ago" ("Active now" under a minute) and is not drawn before any activity. | seen | `src/renderer/src/sidebar/ProjectHoverCard.tsx:61` | unchanged `src/renderer/src/sidebar/ProjectHoverCard.tsx:61` | M4 · `sidebar-hover-project` |

### Sidebar, project menu

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W85 | right-click on a project | Archive sessions older than a week | cut | The project menu item reads "Archive older than a week". | seen | `src/renderer/src/sidebar/project-actions.ts:11` | unchanged `src/renderer/src/sidebar/project-actions.ts:11` | M4 · `r2-project-menu` |

## Overview

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W102 | the title strip of the Overview layer, with a × at its right | Overview | cut | The Overview layer's top strip holds only its × (and still drags); the "Overview" title is kept for screen readers. | seen | `src/renderer/src/overview/OverviewPanel.tsx:206` | unchanged `src/renderer/src/overview/OverviewPanel.tsx:219` | M4 · `overview` |
| W104 | heading over the first group of cards | Needs you · 3 | cut | The first group of Overview cards has no "Needs you · 3" heading; project groups keep their names; the heading stays for screen readers. | seen | `src/renderer/src/overview/derive.ts:56` | unchanged `src/renderer/src/overview/derive.ts:56` | M4 · `overview` |
| W106 | a bordered chip on a card's first line | ⎇ feature/x | stays | Stays. which branch, which the owner brought back on the session card (P32) | pattern | `src/renderer/src/overview/SessionCard.tsx:79` | unchanged `src/renderer/src/overview/SessionCard.tsx:79` | M4 · `overview` |
| W107 | second line of a card when the session is not doing anything in particular | Idle | cut | An idle Overview card shows no activity line. | seen | `src/renderer/src/overview/derive.ts:92` | unchanged `src/renderer/src/overview/derive.ts:92` | M4 · `overview-scrolled` |
| W110 | last line of a card, in grey | ctx 43% · $0.42 since seen · 2 agents | cut | An Overview card has no grey footer; context, cost since seen and agents are in the card's tooltip. | seen | `src/renderer/src/overview/derive.ts:114` | unchanged `src/renderer/src/overview/derive.ts:114` | M4 · `overview-scrolled` |

### Floating session card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W174 | hovering an edge of the card | Drag to resize; arrow keys to adjust | cut | The floating card's resize edges have no tooltip; the cursor changes on them. | pattern | `src/renderer/src/shell/FloatingCard.tsx:297` | unchanged `src/renderer/src/shell/FloatingCard.tsx:295` | M4 · no scene: needs the pointer on a control the rig does not hover (wanted: Overview floating session card with the pointer on a resize edge) |

## Command palette

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W113 | the input at the top | Search sessions, projects and actions | cut | The palette input's placeholder reads "Search" (the Conversations scope keeps "Search in conversations"). | seen | `src/renderer/src/palette/CommandPalette.tsx:214` | unchanged `src/renderer/src/palette/CommandPalette.tsx:366` | M4 · `r2-palette` |
| W116 | a grey line under the scope buttons while conversations are searched | Searching conversations… | cut | While conversations are searched a small spinner turns at the right of the palette input; no line of text. | pattern | `src/renderer/src/palette/CommandPalette.tsx:227` | unchanged `src/renderer/src/palette/CommandPalette.tsx:379` | M4 · no scene: needs that window, sidebar or banner state (wanted: Command palette with conversation search running, indexing, incomplete, or over fifty matches) |
| W117 | same place, while the index is being built | Indexing conversations… Results will update. | cut | While the index builds the palette line reads "Indexing…". | pattern | `src/renderer/src/palette/CommandPalette.tsx:225` | unchanged `src/renderer/src/palette/CommandPalette.tsx:377` | M4 · no scene: needs that window, sidebar or banner state (wanted: Command palette with conversation search running, indexing, incomplete, or over fifty matches) |
| W118 | same place, when some conversations failed to index | Some conversations could not be indexed. Results may be incomplete. Indexing will retry after a restart or when those conversations change. | cut | The palette line reads "Some conversations are not indexed; results may be incomplete." | pattern | `src/renderer/src/palette/CommandPalette.tsx:226` | unchanged `src/renderer/src/palette/CommandPalette.tsx:378` | M4 · no scene: needs that window, sidebar or banner state (wanted: Command palette with conversation search running, indexing, incomplete, or over fifty matches) |
| W119 | same place, when a group has more than fifty matches | Showing the first 50 matches per group. Type to narrow results. | cut | Over fifty matches the palette line reads "First 50 shown". | pattern | `src/renderer/src/palette/CommandPalette.tsx:230` | unchanged `src/renderer/src/palette/CommandPalette.tsx:384` | M4 · no scene: needs that window, sidebar or banner state (wanted: Command palette with conversation search running, indexing, incomplete, or over fifty matches) |
| W122 | greyed action rows that can never be run from the palette, with their reason | Keyboard only, in a focused request | cut | The palette no longer lists the keyboard-only request and composer actions; Keyboard shortcuts still lists them. | pattern | `src/renderer/src/palette/CommandPalette.tsx:80` | moot: U6b-5a: the palette lists a row only when it can run ("nothing is drawn greyed"); the UNAVAILABLE map and the greyed rows were deleted from CommandPalette.tsx | — |
| W123 | the longest action names in the list (the same names appear in Keyboard shortcuts) | Next or Submit on a question; Implement on a plan | stays | Stays. long action names shortened to a generic word ("Accept" for "Next or Submit on a question; Implement on a plan"); the owner brought back the routing sentence over "In use" (W180) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/shared/keymap/actions.ts:101` | unchanged `src/shared/keymap/actions.ts:123` | M4 · `r2-shortcuts` |

## Menu bar and the shortcuts window

### Keyboard shortcuts window

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W125 | under the title | Your current bindings. Change them in Settings → Keyboard. | cut | Under the Keyboard shortcuts title: "Change in Settings" (plain text, not a link). | seen | `src/renderer/src/keymap/KeyboardShortcuts.tsx:32` | unchanged `src/renderer/src/keymap/KeyboardShortcuts.tsx:39` | M4 · `r2-shortcuts` |
| W126 | the search field | Search actions or shortcuts | cut | The Keyboard shortcuts search field's placeholder reads "Search"; its accessible name is unchanged. | seen | `src/renderer/src/keymap/KeyboardShortcuts.tsx:53` | unchanged `src/renderer/src/keymap/KeyboardShortcuts.tsx:60` | M4 · `r2-shortcuts` |
| W127 | when the search finds nothing | No shortcuts match your search. | cut | A search with no match says "Nothing matches". | pattern | `src/renderer/src/keymap/KeyboardShortcuts.tsx:66` | unchanged `src/renderer/src/keymap/KeyboardShortcuts.tsx:73` | M4 · no scene: needs that window, sidebar or banner state (wanted: Shortcuts window with a search that finds nothing) |

### Menu bar

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W185 | View menu, top level | Float conversation over surface | cut | View menu (and palette, shortcuts): "Float chat". | seen | `src/shared/keymap/actions.ts:62` | unchanged `src/shared/keymap/actions.ts:67` | M4 · `settings-keyboard` |
| W187 | View ▸ Tabs | Select Tab 1 | stays | Stays. a closed menu puts no words on screen, so the cut gains nothing here; U6a already folds the nine items into one Tabs submenu, and a menu is where keys are looked up (Help's search finds them). Kept, the owner's ruling of 2026-11-20 | ruled | `src/main/menu.ts:125` | unchanged `src/main/menu.ts:133` Put to the owner: U6a (keymap) fixes the View menu as "Tabs ▸ (the nine Select Tab items)"; this row's cut lists Next and Previous tab only. **Ruled by the owner, 2026-11-20, card 10: kept, not cut.** | M4 · no scene: The native menu bar is drawn by the OS outside the window, so no window screenshot shows it. |
| W188 | View ▸ Developer | Developer | stays | Stays. the Developer submenu is the way into diagnosis in the packaged build the owner uses daily; it is hidden only if MAWS is shipped to people who are not its developers. Kept, the owner's ruling of 2026-11-20 | ruled | `src/main/menu.ts:192` | unchanged `src/main/menu.ts:201` Put to the owner: U6a (keymap) fixes "Developer ▸" as the last View group; this row hides it in packaged builds. **Ruled by the owner, 2026-11-20, card 10: kept, not cut.** | M4 · no scene: The native menu bar is drawn by the OS outside the window, so no window screenshot shows it. |

## Projects, worktrees and archive

### Projects page

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W129 | grey sentence at the top of the list | Choose projects to keep in your sidebar. Hiding a project does not delete its sessions. | cut | The Projects page starts with its list; no explaining sentence. | seen | `src/renderer/src/projects/ProjectsView.tsx:54` | unchanged `src/renderer/src/projects/ProjectsView.tsx:54` | M4 · `projects` |
| W130 | heads over the three groups | Sidebar projects | cut | The project lists' group heads read In sidebar, Hidden and Discovered (the + list and the Projects page share them). | seen | `src/renderer/src/sidebar/project-groups.ts:10` | unchanged `src/renderer/src/sidebar/project-groups.ts:10` | M4 · `projects` |
| W131 | a button at the right of every row | Hide from sidebar | stays | Stays. Projects page: "Hide from sidebar" stays a named button, not a switch | brought back | `src/renderer/src/projects/ProjectsView.tsx:68` | unchanged `src/renderer/src/projects/ProjectsView.tsx:68` | M4 · `projects` |
| W132 | grey line under every project name | <the folder’s full path> | stays | Stays. Projects page: the folder path stays under each name | brought back | `src/renderer/src/projects/ProjectsView.tsx:76` | unchanged `src/renderer/src/projects/ProjectsView.tsx:76` | M4 · `projects` |

### Add project window (the + on the project list)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W135 | under the title | Your sidebar projects come first. Add a hidden or discovered project, or choose a folder. | cut | The Add project window shows no sentence under its title (kept as the dialog's description for assistive tech). | pattern | `src/renderer/src/sidebar/AddProject.tsx:49` | unchanged `src/renderer/src/sidebar/AddProject.tsx:49` | M4 · no scene: needs that window, sidebar or banner state (wanted: Add project window open (the + on the project list)) |
| W136 | grey tag on rows already in the sidebar | In sidebar | cut | Rows already in the sidebar carry no "In sidebar" tag; they stand greyed under the In sidebar head. | pattern | `src/renderer/src/sidebar/AddProject.tsx:56` | unchanged `src/renderer/src/sidebar/AddProject.tsx:56` | M4 · no scene: needs that window, sidebar or banner state (wanted: Add project window open (the + on the project list)) |

### Locate folder sheet

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W142 | under the title "Locate <folder> on <machine>" | It was at ~/old/app. Choose where the folder is now. | cut | The Locate folder sheet's line reads "Was at ~/old/app". | pattern | `src/renderer/src/sidebar/registry-copy.ts:54` | unchanged `src/renderer/src/sidebar/registry-copy.ts:54` | M4 · no scene: needs that window, sidebar or banner state (wanted: Locate folder sheet open) |

### Archived sessions window

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W151 | three buttons at the right of every archived session | Unarchive | cut | Each archived session shows Unarchive and a three-dot button; Remove worktree… and Delete… are in that menu. | pattern | `src/renderer/src/sessions/ArchivedSessionsDialog.tsx:200` | unchanged `src/renderer/src/sessions/ArchivedSessionsDialog.tsx:200` | M4 · no scene: needs that window, sidebar or banner state (wanted: Archived sessions window open) |

### Worktrees window

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W154 | second line of the empty state | Worktrees MAWS or Claude Code create in this repository appear here | cut | The Worktrees window's empty state reads "No worktrees yet" alone. | pattern | `src/renderer/src/sessions/WorktreesDialog.tsx:109` | unchanged `src/renderer/src/sessions/WorktreesDialog.tsx:109` | M4 · no scene: needs that window, sidebar or banner state (wanted: Worktrees window open (one worktree with no session, and the empty state)) |
| W155 | a grey label and a grey line on every worktree that has no session | Sessions No session | cut | A worktree with no session shows no Sessions label and no "No session" line. | pattern | `src/renderer/src/sessions/WorktreesDialog.tsx:167` | unchanged `src/renderer/src/sessions/WorktreesDialog.tsx:167` | M4 · no scene: needs that window, sidebar or banner state (wanted: Worktrees window open (one worktree with no session, and the empty state)) |

### New project on another machine sheet

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W166 | the paragraph under the title | Choose the folder on mini for the project, a git repository or not. Private folders macOS protects (Documents, Desktop, Downloads and the like) stay closed unless you open one, and opening one may show a privacy prompt on mini. | cut | The New project on another machine sheet has no paragraph under its title; the privacy warning still comes when a private folder is opened. The same paragraph is also gone from the Add project sheet's folder field. | pattern | `src/renderer/src/sessions/remote-setup.ts:66` | unchanged `src/renderer/src/sessions/remote-setup.ts:66` | M4 · no scene: needs a session on another machine (wanted: New project on another machine sheet open) |

## Sheets (rename, share, archive, delete)

### Rename sheet

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W143 | grey line under the title field | Generated by the engine from the first prompt | cut | The Rename sheet no longer says where the current name came from; Regenerate stays (for a live session). | pattern | `src/renderer/src/sessions/RenameDialog.tsx:24` | unchanged `src/renderer/src/sessions/RenameDialog.tsx:26` | M4 · no scene: needs that sheet opened (wanted: Rename sheet open) |
| W144 | second grey line | Kept in MAWS until the session runs again; a /rename in the terminal replaces it. | cut | The Rename sheet has no second grey line (neither "The engine records the new title." nor the terminal /rename warning). | pattern | `src/renderer/src/sessions/RenameDialog.tsx:100` | unchanged `src/renderer/src/sessions/RenameDialog.tsx:110` | M4 · no scene: needs that sheet opened (wanted: Rename sheet open) |

### Archive sheet

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W146 | the paragraph under "Archive “<title>”?" | Ends its engine process on mini and hides it from app. The transcript stays where Claude Code keeps it; resume it from Archived sessions or with claude --resume in the terminal. The worktree is not touched. | cut | The Archive sheet's paragraph reads "Stops it and hides it. Find it again under Archived sessions." | pattern | `src/renderer/src/sessions/ArchiveDialog.tsx:65` | unchanged `src/renderer/src/sessions/ArchiveDialog.tsx:65` | M4 · no scene: needs that sheet opened (wanted: Archive sheet open) |

### Share sheet

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W159 | a sentence under each of the four access levels, all four visible at once | Everyone in the org sees it listed and can message its agent. Only its owners and the people it’s shared with can read it. | stays | Stays. kept: consent | consent | `src/renderer/src/sessions/share/copy.ts:51` | unchanged `src/renderer/src/sessions/share/copy.ts:51` | M4 · no scene: needs that sheet opened (wanted: Share sheet open) |
| W160 | a sentence beside each person's access | They can read it and talk to its agent. | stays | Stays. kept: consent | consent | `src/renderer/src/sessions/share/copy.ts:60` | unchanged `src/renderer/src/sessions/share/copy.ts:60` | M4 · no scene: needs that sheet opened (wanted: Share sheet open) |
| W161 | grey line at the foot | What was already shared stays shared. | stays | Stays. kept: consent | consent | `src/renderer/src/sessions/share/copy.ts:75` | unchanged `src/renderer/src/sessions/share/copy.ts:75` | M4 · no scene: needs that sheet opened (wanted: Share sheet open) |

### Add owner sheet

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W164 | the paragraph under the title | An owner can do everything you can with this session, including changing who can reach it and adding owners. MAWS can’t remove an owner. | stays | Stays. kept: consent | consent | `src/renderer/src/sessions/share/copy.ts:144` | unchanged `src/renderer/src/sessions/share/copy.ts:144` | M4 · no scene: needs that sheet opened (wanted: Add owner sheet open (and after an owner was added)) |
| W165 | a grey line after an owner was added | Its row names them once mini lists the session again. | cut | After adding an owner, the sheet shows the outcome line alone, without the line about the next listing. | pattern | `src/renderer/src/sessions/share/copy.ts:154` | unchanged `src/renderer/src/sessions/share/copy.ts:154` | M4 · no scene: needs that sheet opened (wanted: Add owner sheet open (and after an owner was added)) |

### Confirmation sheets

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| W169 | under "Remove <project> from the sidebar?" | Its 12 sessions stay on disk and in the terminal. Show the project again from Hidden projects… at the end of the sidebar's list. | stays | Stays. kept: consent | consent | `src/renderer/src/sessions/actions.ts:62` | unchanged `src/renderer/src/sessions/actions.ts:62` | M4 · no scene: needs that sheet opened (wanted: Confirmation sheets (remove project from sidebar, archive a project's sessions, take over a session)) |
| W170 | under "Archive 12 sessions in <project>?" | Running sessions stop; transcripts stay where Claude Code keeps them, and every session can be unarchived from Archived sessions. Sessions on other machines are not archived from here. | stays | Stays. kept: consent | consent | `src/renderer/src/sessions/actions.ts:95` | unchanged `src/renderer/src/sessions/actions.ts:95` | M4 · no scene: needs that sheet opened (wanted: Confirmation sheets (remove project from sidebar, archive a project's sessions, take over a session)) |
| W171 | under "Take over this session?" | MAWS ends the terminal process that holds this session (pid 4312) and resumes the session here. A turn in progress there is lost. | stays | Stays. kept: consent | consent | `src/renderer/src/sessions/record-ops.ts:209` | unchanged `src/renderer/src/sessions/record-ops.ts:209` | M4 · no scene: needs that sheet opened (wanted: Confirmation sheets (remove project from sidebar, archive a project's sessions, take over a session)) |

## Usage ring and its popover

### Usage ring and popover

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| P468 | the popover the ring opens: its heading | Usage | stays | Stays. skipped: needs a change outside the copy | not a cut | `src/renderer/src/accounts/copy.ts:52` | unchanged `src/renderer/src/accounts/copy.ts:52` | M4 · `r2-usage-popover` |
| P471 | the popover, under a Codex account's name | Limits show in ClaudeUsage's own panel | stays | Stays. nothing says where a Codex account's limits are (or why none show); an explanation that is also the way to the missing numbers (applied only in part on the scratch branch) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/accounts/copy.ts:67` | unchanged `src/renderer/src/accounts/copy.ts:67` | M4 · `r2-usage-popover` |
| P469 | the popover, at the right of its heading | updated 2m ago | stays | Stays. skipped: needs a change outside the copy | not a cut | `src/renderer/src/accounts/copy.ts:56` | unchanged `src/renderer/src/accounts/copy.ts:56` | M4 · `r2-usage-popover` |

### Usage dialog (/usage)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| P591 | small head (drawn uppercase, as every group head in these dialogs is) over the account's limits; "Pinned account" when this session is pinned to one | Routing account | stays | Stays. which account requests route through, which the owner brought back over "In use" (W180) | pattern | `src/renderer/src/widgets/copy.ts:99` | unchanged `src/renderer/src/widgets/copy.ts:99` | M4 · no scene: needs that window, sidebar or banner state (wanted: Usage dialog (/usage) in a session that routes through the relay) |
| P592 | the same head on a session that does not go through the relay (state: direct session) | Direct · the engine’s own login | cut | A direct session's head reads "Direct". | pattern | `src/renderer/src/widgets/copy.ts:96` | unchanged `src/renderer/src/widgets/copy.ts:96` | M4 · no scene: needs that window, sidebar or banner state (wanted: Usage dialog (/usage) in a direct session) |
| P594 | a limit row's value just after its window reset (state: window reset, no reading since) | 0% · no reading since the window reset | cut | A limit row just after its reset reads "0%". | pattern | `src/renderer/src/widgets/copy.ts:106` | unchanged `src/renderer/src/widgets/copy.ts:106` | M4 · no scene: a transient wait no fixture holds (wanted: Usage dialog (/usage) with a limit whose window has just reset) |
| P596 | in place of the account line while the usage files are read (state: reading) | Reading ClaudeUsage… | cut | The account line is a spinner while the usage files are read. | pattern | `src/renderer/src/widgets/copy.ts:100` | unchanged `src/renderer/src/widgets/copy.ts:100` | M4 · no scene: a transient wait no fixture holds (wanted: Usage dialog (/usage) while the usage files are read (delayed fixture)) |
| P597 | second group: head "This session", then four label and value rows (Cost, API time, Wall time, Lines) | This session — Cost · API time · Wall time · Lines | cut | "This session" shows Cost only; API time, Wall time and Lines are behind Details. | pattern | `src/renderer/src/widgets/copy.ts:89` | unchanged `src/renderer/src/widgets/copy.ts:89` | M4 · no scene: needs that window, sidebar or banner state (wanted: Usage dialog (/usage) in a session that routes through the relay) |
| P598 | third group: head "Models", then one row per model with four token counts | Models — 12,400 in · 3,100 out · 88,000 cache read · 9,200 cache write | cut | Tokens per model are behind the same Details. | pattern | `src/renderer/src/widgets/copy.ts:92` | unchanged `src/renderer/src/widgets/copy.ts:92` | M4 · no scene: needs that window, sidebar or banner state (wanted: Usage dialog (/usage) in a session that routes through the relay) |
| P599 | the last line of the dialog, always there: a wire field in mono, then a sentence; the sentence is one of three (… through the relay; … for this login; the engine's own windows (a direct session)) | rate_limits_available: false · the engine reports no windows through the relay | cut | No last line about the engine's windows (no rate_limits_available). | pattern | `src/renderer/src/widgets/copy.ts:93` | unchanged `src/renderer/src/widgets/copy.ts:93` | M4 · no scene: needs that window, sidebar or banner state (wanted: Usage dialog (/usage) in a session that routes through the relay) |

## The UX wave's new text (M0)

Rows added by M0 for text the UX wave added after the pin. **Today** here is the text on master `028cecd10`, every row's basis is `pattern` (or `consent` for a consent text, or `ruled` where the owner has since ruled on it), and **Source** is the file and line on master.

### Menu bar and the shortcuts window

#### Toast

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N128 | the toast when "Toggle report and transcript" is used in a session the to-human mod draws | The to-human mod draws this session's view. Use its switch above the composer. | reword | The toast reads "The to-human mod draws this view. Use its switch." | pattern | `src/renderer/src/owner/view/copy.ts:31` | new `src/renderer/src/owner/view/copy.ts:31` | M4 · no scene: needs the to-human mod drawing the view; no fixture installs it |

#### Menu bar

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N156 | View ▸ More surfaces, the item that opens the surface; the same action title in the command palette, Settings › Keyboard and the shortcuts sheet | Subagents | cut | View ▸ More surfaces reads Agents, as the tab does. | pattern | `src/shared/keymap/actions.ts:75` | new `src/shared/keymap/actions.ts:76` | M3 · no scene: The native menu bar is drawn by the OS outside the window; the command palette's and Settings › Keyboard's rows are in the window (wanted: the command palette filtered to the surface's name, and Settings › Keyboard's View › More surfaces group) |
| N157 | View ▸ More surfaces, the item that opens the surface; the same action title in the command palette, Settings › Keyboard and the shortcuts sheet | Background tasks | cut | View ▸ More surfaces reads Background, as the tab does. | pattern | `src/shared/keymap/actions.ts:76` | new `src/shared/keymap/actions.ts:77` | M3 · no scene: The native menu bar is drawn by the OS outside the window; the command palette's and Settings › Keyboard's rows are in the window (wanted: the command palette filtered to the surface's name, and Settings › Keyboard's View › More surfaces group) |

### Banners, toasts and the main area

#### Toast

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N129 | the brief line that confirms a window zoom change | Zoom 110 % | stays | Stays. rule 2: a status that confirms something just done; it is the only feedback for ⌘+ and ⌘− | pattern | `src/renderer/src/stores/zoom.ts:17` | new `src/renderer/src/stores/zoom.ts:17` | M4 · no scene: needs that window, sidebar or banner state (wanted: the window zoomed in with the keyboard) |

### Window, floating chat

#### Floating chat bar over an artifact

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N154 | the small × button at the right of the floating chat bar; its tooltip | ×  (tooltip: Hide chat) | stays | Stays. rule 4: a glyph may replace a word where nobody can misread it, and × on a floating card is a window's own close; the tooltip names the action (accessible name "Hide chat"). Not the question card's ×, which is board #705 | pattern | `src/renderer/src/shell/FloatingPill.tsx:120` | new `src/renderer/src/shell/FloatingPill.tsx:120` | M4 · no scene: needs that window, sidebar or banner state (wanted: an artifact open with the floating chat bar showing (the Hide chat × at its right)) |

### Sidebar

#### Sidebar, session hover card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N155 | the status word in the first line of the hover card of a session another machine keeps as stopped (process ended, reopenable) | Stopped · updated 3m ago | stays | Stays. rule 2: orients with a non-default state; it replaced "Done" on the owner's decision of 2026-11-19. "Stopped" is not the default-state word rule 1 cuts | pattern | `src/renderer/src/attention/glyph.ts:90` | new `src/renderer/src/attention/glyph.ts:90` | M4 · no scene: needs a session on another machine (wanted: sidebar hover card on a listed session from another machine in the stopped state) |
