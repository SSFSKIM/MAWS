# Word cut: Panels beside the conversation

> Part of `docs/doperpowers/specs/2026-11-16-word-cut-design.md`; read that first. This file is written by `render.py` from `items.json` beside it; a decision changes there and in the root document's Decision Log.

314 items: 210 cut, 6 reworded, 98 stay. Of the 216 that change, the owner saw 47 in a picture or ruled on them; 169 follow the pattern and were not seen.

Columns: **Id** is the item's id in `items.json`. **Where** is the place on the surface. **Today** is the text at the pin `2c7044231` (an example value where the text is built from data). **Decision** is `cut` (the text leaves the resting surface), `reword` (it changes) or `stays` (today's text is kept; the row is here so that nobody proposes it again). **After** says what the surface shows afterwards, as it was built on the scratch branch and shown in the pictures. **Basis** is how firm the decision is, in the words of the root document's "How firm each decision is". **Source** is the file and line at the pin.

## Browser

### Mark-up toolbar (over a page or artifact being marked up)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T123 | the toolbar: tooltips on five colour dots (Red, Blue, Green, Black, White) | Red | cut | The colour dots show no tooltip; each keeps its colour name for screen readers. | pattern | `src/renderer/src/markup/MarkupLayer.tsx:84` |
| T124 | the toolbar: tooltips on the undo and clear icons; while disabled they read "Nothing to undo yet" and "Nothing to clear yet" | Nothing to undo yet | cut | The undo and clear icons' tooltips read Undo and Clear whether or not they are greyed. | pattern | `src/renderer/src/markup/session.ts:29` |
| T125 | the toolbar: tooltip on its drag handle | Drag to move; arrow keys to adjust | cut | The drag handle's tooltip reads Move; its accessible name still says it moves the toolbar. | pattern | `src/renderer/src/markup/MarkupLayer.tsx:338` |

### Browser panel

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T408 | centred in the panel when no session is shown (state: no session) | Open a session to browse beside it | stays | Stays. empty state with what to do ("Open a session…"), like G249 and T384 the owner brought back | pattern | `src/renderer/src/tools/browser/copy.ts:11` |

### Browser, empty page

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T409 | heading under the globe glyph, in the middle of a tab that has not navigated | Start browsing | cut | A tab that never navigated shows the globe alone, with no heading. | seen | `src/renderer/src/tools/browser/copy.ts:15` |
| T410 | sentence under that heading | Enter a URL to open a page | cut | The sentence under the globe is gone; the address field's placeholder "Search or enter a URL" is the only instruction. | seen | `src/renderer/src/tools/browser/copy.ts:15` |

### Browser, unloaded tab

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T412 | primary button in the middle of a restored tab that has not loaded yet; the page's title and icon sit above it and its address is in the address field | Open https://example.com/long/path | cut | A restored, unloaded tab shows its icon and title over a button that reads "Load"; the address is in the button's tooltip and the address field. | pattern | `src/renderer/src/tools/browser/copy.ts:16` |
| T413 | small line under that button | Tabs are restored unloaded | cut | The "Tabs are restored unloaded" line under the button is gone. | pattern | `src/renderer/src/tools/browser/copy.ts:16` |

### Browser, page that failed to load

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T415 | heading of the error page that replaces a page that did not load | This site can't be reached | cut | The error page's heading is the summary itself ("example.com refused to connect"); the "This site can't be reached" line is gone. | seen | `src/renderer/src/tools/browser/copy.ts:23` |
| T417 | under the summary, for every cause but a certificate's: a label and two bullets, the second a link that opens four tips | Try: · Checking the connection · Checking the proxy, firewall, and DNS configuration | stays | Stays. the failed page keeps "Try:" and its two tips | brought back | `src/renderer/src/tools/browser/copy.ts:32` |
| T418 | opened by the second bullet: four headed tips, about 95 words (representative: the first) | Check your Internet connection / Check any cables and restart any routers, modems, or other network devices you may be using | stays | Stays. the failed page keeps its four network tips | brought back | `src/renderer/src/tools/browser/copy.ts:35` |

### Browser, tab row

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T426 | tooltip of a tab's ×, which appears under the pointer | Close Example Domain | cut | Hovering a tab's × shows "Close"; its accessible name still names the tab. | pattern | `src/renderer/src/tools/browser/copy.ts:56` |
| T429 | badge inside a tab that shows another machine's localhost through a forwarded port (state: forwarded tab); its tooltip says "Port 3000 on devbox, forwarded to this Mac" | forwarded from devbox | reword | A forwarded tab carries a small badge with the machine's name ("devbox"); hovering it gives "Port 3000 on devbox, forwarded to this Mac". | pattern | `src/renderer/src/tools/browser/copy.ts:140` |

### Browser, navigation row

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T433 | first rows of the list that drops from the address field while typing; each has its own icon (an arrow, a magnifier) | Go to https://example.com · Search for “example” | cut | The typed rows of the address list show the address or the query alone beside their arrow or magnifier; "Go to"/"Search for" stay as the options' accessible names. | pattern | `src/renderer/src/tools/browser/copy.ts:64` |
| T434 | the round pill right of the address, on every tab that uses no imported Chrome profile: an avatar and this word | Default | stays | Stays. the default case still named, like "This Mac" the owner brought back (P29): which profile a tab browses as | pattern | `src/renderer/src/tools/browser/copy.ts:67` |
| T436 | right of the pill while the agent is driving the shown tab: a pulsing dot and these words (state: agent has the tab) | Agent is browsing | stays | Stays. kept: consent | consent | `src/renderer/src/tools/browser/copy.ts:68` |
| T441 | tooltip of that chip | Viewport: 390 × 844 | cut | The viewport chip's tooltip reads "Viewport"; the size is on the chip and in its accessible name. | pattern | `src/renderer/src/tools/browser/copy.ts:91` |

### Browser, ⋯ menu

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T444 | three rows of that menu | Zoom in · Zoom out · Reset zoom | cut | Browser options has one zoom row: "Zoom" with − 100% + on it; the level resets, and the menu stays open while stepping. | pattern | `src/renderer/src/tools/browser/copy.ts:73` |
| T445 | in a browser that is a main tab, the row that moves the page to the right column | Show in side surface | stays | Stays. skipped: a rename, not applied in this cut | not a cut | `src/renderer/src/tools/browser/copy.ts:77` |
| T446 | last row of that menu | Close tab | cut | Close tab is no longer in Browser options; the tab's × closes it. | pattern | `src/renderer/src/tools/browser/copy.ts:80` |

### Browser, bookmarks and extensions

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T449 | tooltip of a folder on the bookmarks bar: the folder's own name again | Work | cut | A bookmarks-bar folder has no tooltip. | pattern | `src/renderer/src/tools/browser/copy.ts:211` |

### Browser, zoom row

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T452 | a full-width row under the navigation row whenever the page is not at 100 % (state): the level, then three word buttons | 125% · Zoom out · Zoom in · Reset | cut | The full-width zoom row under the navigation row is gone; while the page is not at 100% a "125%" chip sits in the navigation row beside the size chip and opens − Reset +. | pattern | `src/renderer/src/tools/browser/copy.ts:94` |

### Browser, find row

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T454 | count right of the find field while there is text | 3 / 12 results | cut | The find count reads "3 / 12". | pattern | `src/renderer/src/tools/browser/copy.ts:99` |
| T455 | the same place when nothing matches | 0 results | cut | With no match the find count reads "0". | pattern | `src/renderer/src/tools/browser/copy.ts:100` |

### Browser, notice lines

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T462 | a line that appears for four seconds when the app unloaded a tab to stay under its limits (two forms; representative) | At most 8 pages stay loaded at once, so a tab was left unloaded | cut | When a tab is left unloaded at the page cap (count or memory form) no line appears; the tab's chip is already greyed. | pattern | `src/renderer/src/tools/browser/copy.ts:120` |
| T463 | the same when an extension's options page could not open for that reason | At most 8 pages stay loaded at once, so the options of uBlock could not open | cut | The line reads "Too many pages are loaded to open uBlock's options". | pattern | `src/renderer/src/tools/browser/copy.ts:121` |
| T464 | a four-second line after Copy URL or Copy screenshot (representative) | URL copied to clipboard | cut | Copy URL and Copy screenshot both flash "Copied". | pattern | `src/renderer/src/tools/browser/copy.ts:126` |
| T467 | a four-second line when a download the agent started was refused | A download the agent started was refused; downloads are yours to start | cut | The line reads "Blocked a download the agent started". | pattern | `src/renderer/src/tools/browser/copy.ts:125` |
| T470 | a four-second line when a link to another machine's own loopback cannot be forwarded | This link points at devbox’s own loopback and can’t be forwarded (only http(s) on localhost, 127.0.0.1, 0.0.0.0, [::] or [::1]) | cut | The line reads "This link is local to devbox and can't be opened from here". | pattern | `src/renderer/src/tools/browser/copy.ts:147` |
| T476 | a line under the whole chrome for as long as the session's agent has no browser on its machine (state), with the machine's reason when it gave one | The agent has no browser here: Chrome is not installed | stays | Stays. "the agent has no browser here" (and why) becomes a struck-through glyph; an exception the person must act on, moved to hover \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/browser/copy.ts:13` |

### Browser, profile popover

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T478 | line under an imported profile's name | Signed in as Ada Lovelace · <email> | cut | Under an imported profile's name the popover shows "Ada Lovelace · <email>". | pattern | `src/renderer/src/tools/browser/copy.ts:220` |
| T479 | the same line for a Chrome profile with no account | Not signed in to Chrome | cut | A Chrome profile with no account shows no line under its name. | pattern | `src/renderer/src/tools/browser/copy.ts:221` |
| T480 | small heading over the list of other profiles, with a faint caption at its right | Switch profile / Applies to new tabs | cut | The list of other profiles is headed "New tabs as", with no caption at its right. | pattern | `src/renderer/src/tools/browser/copy.ts:222` |
| T481 | tooltip of each profile in that list | Open a new tab as Work | cut | Profiles in that list have no tooltip; "Open a new tab as Work" is their accessible name. | pattern | `src/renderer/src/tools/browser/copy.ts:224` |
| T483 | row for an imported profile with bookmarks; while it runs it reads "Syncing bookmarks…" | Sync bookmarks now | cut | The row reads "Sync bookmarks" ("Syncing bookmarks…" while it runs). | pattern | `src/renderer/src/tools/browser/copy.ts:225` |
| T484 | second line of that row | Last synced 5m ago | cut | The row's second line reads "5m ago". | pattern | `src/renderer/src/tools/browser/copy.ts:227` |
| T486 | row under the sync row | Re-import this profile… | cut | The row reads "Re-import…". | pattern | `src/renderer/src/tools/browser/copy.ts:232` |

### Browser, the agent's tabs on another machine

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T490 | after that label while the agent has no tab open | No agent browser tabs | stays | Stays. the agent's tab strip says nothing when the agent has no tab; the label stays, so it is not blank, but nothing says "none" \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/browser/copy.ts:159` |
| T491 | after that label while the link is being made | Connecting to devbox | cut | While connecting, the "Agent on devbox" label is dimmed with a small spinner beside it. | pattern | `src/renderer/src/tools/browser/copy.ts:160` |
| T493 | right end of the row under the tabs whenever the person is looking at the agent's tab and has not taken control: a bordered badge beside a Take control button | View only | cut | The "View only" badge is gone; Take control stands alone at the row's end. | pattern | `src/renderer/src/tools/browser/copy.ts:178` |
| T497 | word button at the end of that line | Dismiss | stays | Stays. Dismiss becomes ×; the owner brought back Dismiss on questions (C106) because × and Dismiss do different jobs there; on a notice line they may be the same job \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/browser/remote/View.tsx:248` |
| T498 | middle of the picture before the first frame arrives | Waiting for the agent’s page… | cut | Before the first frame, the middle of the picture shows a spinner. | pattern | `src/renderer/src/tools/browser/copy.ts:173` |

## Session cards (the default right column)

### Right column summary card, Subagents section

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T143 | under the row of agent glyphs, whenever the session has started an agent | 3 working · 2 done | stays | Stays. how many agents are working and done (the owner brought back the counts that orient: waiting, connected, loaded); per-agent marks stop counting past four | pattern | `src/renderer/src/tools/agents/copy.ts:234` |
| T144 | end of the same line, when agents are known only from files on disk; state: agents known only from disk | 4 on disk | stays | Stays. how many agents are known from disk leaves the summary card; a count that orients, said in where-from terms \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/agents/copy.ts:235` |
| T145 | the section's only line while the session has started no agent; state: no agents | No subagents yet | stays | Stays. empty state: the Subagents row would be drawn empty (T206) | pattern | `src/renderer/src/tools/agents/copy.ts:236` |
| T146 | bordered button at the right end of the section's row; representative of three (Subagents row, Background tasks row, the Tasks heading inside the Background tasks panel) | Open | stays | Stays. a bordered Open becomes the row as the press target; the row names where it leads, unlike the Files and Session info replacements the owner rejected (P30, P50) (applied only in part on the scratch branch) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/agents/copy.ts:248` |

### Right column summary card, Background tasks section

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T147 | the section's line while the session is live and something runs | 2 shells · 1 workflow · 1 monitor | stays | Stays. kind words become kind glyphs beside their numbers; the numbers stay, but the glyphs (terminal, agents, panel) are not ones people already know \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/agents/copy.ts:237` |
| T148 | the section's line while the session is live and nothing runs; state: nothing running | Nothing running | stays | Stays. "Nothing running", the same words the owner brought back in the Background panel (T206); here the summary row would go blank | pattern | `src/renderer/src/tools/agents/copy.ts:245` |
| T149 | first line of the section for a session that is not running here; state: session not live | 2 workflow runs on disk | stays | Stays. how many runs are on disk for a session not running here leaves the summary card; a count that orients, said in where-from terms \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/agents/copy.ts:246` |
| T150 | the section's line while the session is starting; state: session starting | Starting… | reword | While the session starts, the summary's Background row shows the agents tool's small spinner (PendingMark), "Starting…" as its accessible name and tooltip. | pattern | `src/renderer/src/tools/agents/copy.ts:247` |
| T151 | second line of the section for a session that is not running here; state: session not live | Shells and monitors are known only while the session runs here | stays | Stays. the sentence that says why a non-local session's shells are not listed (see T207); lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/tools/agents/background/BackgroundSummary.tsx:59` |

### Right column summary, changes line

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T364 | the tail of the changes line in the session's summary card (the rest of the line belongs to the right column) | · 2 staged | cut | The summary card's changes line ends at its counts, files, untracked and binary; "· 2 staged" is gone. | seen | `src/renderer/src/tools/code/copy.ts:108` |

### Session cards, Environment

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P28 | the first card of the right column when no panel is in view; open by default. The whole card: machine, folder, branch, changes, push state, pull request, model | Environment | stays | Stays. skipped: redesign, not a word cut | not a cut | `src/renderer/src/panel/summary/Environment.tsx:34` |
| P29 | first row of the open card | This Mac | stays | Stays. brought back on shell-tools | brought back | `src/renderer/src/panel/summary/Environment.tsx:35` |
| P30 | second row: the folder path with a "Files" button at its right | Files | stays | Stays. brought back on shell-tools | brought back | `src/renderer/src/panel/summary/Environment.tsx:36` |
| P32 | third row of the open card, with a branch glyph | ⎇ main | stays | Stays. brought back on session-running-cards | brought back | `src/renderer/src/panel/copy.ts:30` |
| P33 | in the heading's right end and again as a row, when the folder is not a repository or git did not answer; forms "Not a git repository", "Git unavailable", and "…" while waiting | Not a git repository | stays | Stays. came back with its card (P29, P30, P50); the second "Git unavailable" is said twice, so the owner may want only the machine, the Files and the Session info buttons | brought back | `src/renderer/src/panel/copy.ts:32` |
| P35 | the change line under the branch, when nothing is changed (drawn by the card itself only when the Review panel is not registered; Review's own line is listed with the Review panel) | Clean | stays | Stays. "Clean" goes: a passing status like the Connected and saved status the owner brought back, or a normal-state word like Idle that the owner left cut \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/panel/copy.ts:35` |
| P36 | the change line, when files changed: the two counts, then "across N files", then " · N untracked" and " · N binary" | +12 −3 across 4 files · 2 untracked · 1 binary | cut | The change line reads "+12 −3 · 4 files"; the untracked and binary counts show under the pointer. | seen | `src/renderer/src/panel/copy.ts:36` |
| P38 | the push row, when the branch is level with its remote | Up to date with origin/main | stays | Stays. "Up to date with origin/main" goes; same question as P35 \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/panel/copy.ts:46` |
| P39 | the push row, when there are commits not pushed; " · N behind" is added when the remote has moved | 2 ahead of origin/main · 1 behind | cut | The push row shows "↑2 ↓1"; the sentence with the remote's name shows under the pointer. | seen | `src/renderer/src/panel/copy.ts:45` |
| P42 | a bordered button at the right of the push row, when the remote is GitHub | Open on GitHub | stays | Stays. a way in: as built, Open on GitHub becomes unreachable when the branch is level with no PR (the owner brought back ways in, P30 and P50) (applied only in part on the scratch branch) | pattern | `src/renderer/src/panel/copy.ts:48` |
| P43 | the pull request row, when the branch has no pull request | No PR for main | cut | A branch with no PR draws no PR row. | pattern | `src/renderer/src/panel/copy.ts:56` |
| P44 | the pull request row, when there is one: the number as a link, then its state, the review decision and the checks counted in words. States: Open, Draft, Merged, Closed; decisions: Approved, Changes requested; checks: passed, failed, cancelled, pending, skipped | PR #12 Open · Changes requested · 3 passed, 1 pending | cut | The PR row reads "PR #12 · Changes requested · 1 pending": no "Open", no passed or skipped counts; Draft, Merged, Closed, failed, cancelled and pending stay. | pattern | `src/renderer/src/panel/summary/pr-line.ts:62` |
| P45 | the end of the pull request row, when checks have not started or could not be read: "No checks reported yet" or "Checks unavailable" | No checks reported yet | cut | "No checks reported yet" and "Checks unavailable" are gone from the PR row. | pattern | `src/renderer/src/panel/copy.ts:62` |
| P50 | last row of the open card: the model and effort, with a "Session info" button at its right. When the model is not known the row reads "model unknown" | Session info | stays | Stays. brought back on shell-tools | brought back | `src/renderer/src/panel/copy.ts:41` |

### Session cards, Context

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P51 | second card, folded by default: its heading with the percentage at the right end | Context | stays | Stays. skipped: redesign, not a word cut | not a cut | `src/renderer/src/panel/summary/Context.tsx:19` |
| P52 | at the right of the folded Context heading, and of the Connectors heading, for a session that has reported nothing | Not reported | cut | A session that reported nothing shows no "Not reported" in the Context and Connectors headings. | seen | `src/renderer/src/panel/summary/Context.tsx:19` |
| P53 | after the percentage in the folded heading, when the session is not running | 42% · last | stays | Stays. that a context figure is a stale last reading is shown only by fainter ink \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/panel/summary/Context.tsx:19` |
| P55 | inside the opened card, for a session that is not running: "Last reading, 2h ago", or "Last sampled context" when the time is not known, or "Not observed yet" when there is no figure | Last sampled context | cut | Inside the opened Context card a not-running session reads "as of 2h ago", and nothing when the time is not known. | pattern | `src/renderer/src/panel/summary/Context.tsx:24` |
| P57 | inside the opened card, under "Sources": at the right of a file row, its extension in capitals | TSX | cut | Source file rows no longer end with the extension in capitals. | pattern | `src/renderer/src/panel/summary/Sources.tsx:80` |
| P58 | inside the opened card, under "Sources": at the right of a row for a connector's tool | Source only | cut | A connector tool source row no longer says "Source only" (the words are its tooltip). | pattern | `src/renderer/src/panel/copy.ts:78` |

### Session cards, Connectors

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P60 | third card, folded by default: its heading with a count at the right end; "N last reported" when the session is not running | Connectors 3 connected | stays | Stays. brought back on session-running-cards | brought back | `src/renderer/src/panel/summary/Connectors.tsx:16` |
| P61 | inside the opened card, at the right of each connector's name: the engine's status word | connected | stays | Stays. "connected" on each connector, which the owner brought back in Customize (G253) and on this card's head (P60) | pattern | `src/renderer/src/panel/summary/Connectors.tsx:25` |
| P62 | inside the opened card: "Connector status not reported" when nothing is known (the heading already says "Not reported"), and "Last reported by this session" when it is not running (the heading already says "N last reported") | Connector status not reported | cut | "Connector status not reported" and "Last reported by this session" are gone from the opened card. | seen | `src/renderer/src/panel/summary/Connectors.tsx:19` |
| P63 | inside the opened card: two buttons, "Manage connectors…" and "Plugins…"; under the pointer "Manage this session's MCP servers" and "Manage plugins and skills" | Manage connectors… | cut | The buttons read "Manage…" and "Plugins…" with no enabled-state tooltips (the disabled-state reason stays; "Manage connectors…" stays the accessible name). | seen | `src/renderer/src/panel/summary/Connectors.tsx:31` |
| P65 | inside the opened card, under a rule: a line counting the plugins, then "Loaded now" or "Loaded last time, 2 days ago", then the two reload buttons (listed with the Plugins dialog) | Plugins · 3 loaded Loaded now | cut | The plugins line reads "3 plugins"; "Loaded now" is gone, the age shows only when it is not now. | seen | `src/renderer/src/panel/copy.ts:80` |

### Session cards, Subagents

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P66 | a card that appears under the three while an agent runs: its heading | Subagents | cut | The Subagents card is headed "Agents". | seen | `src/renderer/src/panel/copy.ts:27` |
| P67 | at the right of that heading, and of the Background tasks heading | 3 running | cut | The running cards' heading count is the number alone ("3"); "3 running" under the pointer. | seen | `src/renderer/src/panel/copy.ts:70` |

### Session cards, Background tasks

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P72 | a card that appears last while a background command, workflow or monitor runs: its heading | Background tasks | cut | The Background tasks card is headed "Background". | seen | `src/renderer/src/panel/copy.ts:27` |

## Panel tabs and their icons

### Right column, panel tab titles

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T152 | the tab's name and the name in the panel menu | Subagents | cut | The panel tab and the panel menu read Agents. | seen | `src/renderer/src/tools/agents/copy.ts:16` |
| T153 | the tab's name and the name in the panel menu | Background tasks | cut | The panel tab and the panel menu read Background. | seen | `src/renderer/src/tools/agents/copy.ts:115` |
| T154 | the tab's name and the name in the panel menu | Tasks | stays | Stays. skipped: a rename, not applied in this cut | not a cut | `src/renderer/src/tools/agents/copy.ts:191` |

### Right column panels pinned with no session shown

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T180 | centre of a pinned panel while no session is on screen; representative of six (Subagents, Background tasks, Tasks, Session info, Questions, Terminal: "Open a session to start a terminal"); state: pinned tab, no session shown | Open a session to see its subagents | stays | Stays. empty state with what to do ("Open a session…"), like G249 and T384 the owner brought back (applied only in part on the scratch branch) | pattern | `src/renderer/src/tools/agents/copy.ts:47` |

### Toolbar, panel icons

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P3 | under the pointer, on the "…" icon at the end of that row | More surfaces | stays | Stays. skipped: needs a tooltip-only prop | not a cut | `src/renderer/src/panel/SurfaceRow.tsx:94` |
| P4 | in the "…" menu, when there is nothing else to list | No other surfaces | stays | Stays. the … menu with nothing to list no longer says so; whether the menu then opens empty is not clear from the log \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/panel/SurfaceRow.tsx:109` |
| P6 | in the "…" menu, for a saved tab whose tool this build no longer has; a submenu with three rows: "Show saved surface", "Keep with this session only" or "Keep open for every session", "Close saved tab" | review (unavailable) | stays | Stays. skipped: a behaviour change, not a cut | not a cut | `src/renderer/src/panel/SurfaceRow.tsx:100` |
| P8 | right-click on a panel icon whose tab is open; its opposite is "Keep with this session only". The same two rows are in the unavailable tab's submenu | Keep open for every session | cut | The pin rows read "Pin tab" / "Unpin tab" (right-click menu and the unavailable tab's submenu). | pattern | `src/renderer/src/panel/SurfaceRow.tsx:133` |
| P9 | right-click on a panel icon; its opposite is "Hide surface" | Open surface | cut | The right-click menu no longer offers "Open surface"; "Hide surface" shows while it is open, and an icon with nothing to offer opens no menu. | pattern | `src/renderer/src/panel/copy.ts:14` |

### Right column, tab strip

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P11 | under the pointer, on the pin glyph a tab shows when pointed at; with "Unpin <title>" and "Close <title>" on the close glyph | Pin Terminal | cut | The tab glyphs' tooltips read "Pin" / "Unpin" / "Close"; their accessible names keep the tab's title. | pattern | `src/renderer/src/panel/copy.ts:9` |
| P14 | in the "+" menu, as its only row, when every tool already has a tab; the other form is "No tools registered yet" | Every tool is already open here | stays | Stays. the + is greyed with no menu saying every tool is open; a greyed control's reason, never shown \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/panel/copy.ts:7` |
| P19 | under the pointer, on the three icons at the right end of the strip. First icon: "Float conversation over surface", "Dock session", "Open session card", or disabled with "Select a session's tab to float it". Second: "Expand surface" or "Restore surface". Third: "Hide side column" | Float conversation over surface | stays | Stays. skipped: needs a tooltip-only prop; the rename was left | not a cut | `src/renderer/src/panel/PanelHeader.tsx:212` |

### Right column, tab names

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P209 | the Review tab's title; the same thing is called "Changes" by the /diff dialog, "Open changes" by the session cards' line and "Changes" in the Layers side column | Review | stays | Stays. skipped: a rename, not applied in this cut | not a cut | `src/renderer/src/tools/code/copy.ts:60` |

## Subagents panel

### Subagents panel, the lists

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T158 | head of the third folding section, for agents the app knows only from files left on disk; state: agents known only from disk | On disk 4 | cut | The third section's heading reads Earlier 4. | seen | `src/renderer/src/tools/agents/copy.ts:26` |
| T159 | one line at the top of the panel for a session that is not running here; state: session not live | Status is known only while the session runs here | stays | Stays. "Status is known only while the session runs here" stays shown in the agents panel | ruled | `src/renderer/src/tools/agents/copy.ts:51` |
| T160 | error line at the top of the panel; state: reading agent files failed | Sidecars unavailable: <message> | cut | The error line at the top of the panel reads Couldn't read agents: <message>. (Partly applied on the scratch branch: The two reads disagreed; the fuller one (a warning mark on the Earlier heading, message under the pointer) was not taken because a failed read usually leaves no Earlier section to carry the mark, so the error would vanish.) | pattern | `src/renderer/src/tools/agents/copy.ts:53` |
| T161 | second line of a running agent's row when the engine has given no activity or summary | Working | stays | Stays. a running agent's row keeps its second line ("Working", or what it is doing now) | brought back | `src/renderer/src/tools/agents/copy.ts:34` |
| T162 | second line of a finished agent's row (Done section, open); behind: the Done section | finished · 3m ago | cut | A finished agent's second line reads 3m ago. | seen | `src/renderer/src/tools/agents/copy.ts:39` |
| T163 | second line of a failed agent's row, in red; behind: the Done section | finished with errors · 3m ago | cut | A failed agent's second line reads failed · 3m ago (and failed alone when no end time is known). | pattern | `src/renderer/src/tools/agents/copy.ts:40` |
| T165 | second line of an agent whose session ended while it ran; behind: the Done section | ended with the session | cut | An agent whose session ended while it ran reads session ended. | pattern | `src/renderer/src/tools/agents/copy.ts:42` |
| T166 | second line of a row, in the warning colour, when the agent waits on a permission; state: the agent waits on the person | Approval needed | cut | A row waiting on a permission shows an orange disc beside its glyph and keeps its normal second line; Approval needed is under the pointer on the row. | pattern | `src/renderer/src/tools/agents/copy.ts:38` |
| T167 | second line of every row in the On disk section; behind: the On disk section | status unavailable | cut | Rows in the Earlier section have no second line. | seen | `src/renderer/src/tools/agents/copy.ts:48` |
| T168 | right end of a running row whose start time is unknown; state: no start time known | elapsed unavailable | cut | A running row whose start time is unknown shows no elapsed time. | pattern | `src/renderer/src/tools/agents/copy.ts:49` |
| T169 | after the outcome word of an agent that has ended while tasks it started still run; state: ended agent with running tasks | · 2 background tasks running | cut | An ended agent with running work reads … · 2 tasks running. | pattern | `src/renderer/src/tools/agents/copy.ts:28` |
| T170 | after a row's title when its parent agent is not in the list; state: child of an unlisted agent | · nested | stays | Stays. "nested" becomes an indent arrow, a new mark no picture showed \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/agents/copy.ts:35` |
| T174 | under a section's first eight or ten rows; state: more rows than shown | Show 5 more | cut | The button under a long section reads 5 more. | pattern | `src/renderer/src/tools/agents/copy.ts:33` |
| T175 | small head over the teammates group in Running; state: the session leads a team | Team · led by this session | cut | The teammates' group head reads Team. | pattern | `src/renderer/src/tools/agents/copy.ts:70` |
| T176 | second line of a teammate's row; state: the session leads a team | <role> · listed 3m ago | cut | A teammate's second line reads <role> · 3m ago. | pattern | `src/renderer/src/tools/agents/copy.ts:73` |
| T177 | tooltip on a teammate's row (it does not open) | Named by the team listing; no transcript of it is known here | cut | A teammate row's tooltip reads No transcript here. | pattern | `src/renderer/src/tools/agents/copy.ts:74` |
| T178 | foot of the panel, beside a green dot, whenever the session is live and has agents | Live activity · includes nested agents | cut | The Live activity · includes nested agents footer is gone. | seen | `src/renderer/src/tools/agents/copy.ts:50` |

### Subagents panel, one agent's page

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T183 | in that same line when a value is missing; representative of three (model unknown, elapsed unavailable, tokens unavailable); state: a value is not known | tokens unavailable | cut | A missing model, elapsed or token count drops out of the agent page's line. | seen | `src/renderer/src/tools/agents/copy.ts:58` |
| T184 | third line of the head | Dispatched by <session> | cut | The agent page's head no longer has the Dispatched by <session> line. | seen | `src/renderer/src/tools/agents/copy.ts:59` |
| T189 | centre of the page opened from a transcript chip before the agent has started; state: agent not started yet | Waiting for the agent to start | cut | The page opened before the agent starts shows a spinner; the words are its accessible name and tooltip. | pattern | `src/renderer/src/tools/agents/copy.ts:67` |

### Subagents panel, one agent's page, the message box at the foot

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T190 | small label above the message field | Relay via <session> | cut | The label above the message field is gone (kept for screen readers); the placeholder reads Message <agent> via <session>…. | seen | `src/renderer/src/tools/agents/copy.ts:81` |
| T191 | small label above the field for a terminal-driven session | Message <agent> | cut | A terminal-driven session's message box has no visible label (kept for screen readers). | pattern | `src/renderer/src/tools/agents/copy.ts:107` |
| T193 | bordered button under the field | Send | cut | The message box's Send is the round accent button with an up arrow, as in the main message box; Send stays as hidden text and tooltip. | seen | `src/renderer/src/tools/agents/copy.ts:83` |
| T194 | placeholder of the disabled field once the agent has ended; representative of four (This agent has finished, was stopped, ended with the session, Known only from disk); state: the agent has ended | This agent has finished | stays | Stays. why a field is closed (the agent has finished); without it a blank disabled field reads as broken | pattern | `src/renderer/src/tools/agents/copy.ts:89` |
| T195 | placeholder of the disabled field for a foreground agent; state: foreground agent | <session> is waiting on this agent and reads messages only after it returns | cut | A foreground agent's closed field reads <session> is waiting on this agent. | pattern | `src/renderer/src/tools/agents/copy.ts:86` |
| T199 | the same line when the parent is mid-turn; representative of two (the other: "… is inside a long tool call; it forwards when that call returns or this turn ends"); state: a message is on its way, parent busy | Asked <session> to relay · 12s · <session> forwards at its next tool boundary or when this turn ends | cut | While the parent is mid-turn the line reads Asked <session> to relay · 12s, with no clause about when it forwards (both variants). | pattern | `src/renderer/src/tools/agents/copy.ts:96` |
| T200 | the same line once the parent has forwarded it; state: message forwarded | <session> sent it with SendMessage after 2 parent rounds · <agent> gets it at its next tool round | cut | After forwarding the line reads Sent · <agent> reads it at its next step. | pattern | `src/renderer/src/tools/agents/copy.ts:100` |
| T201 | the same line when the agent ended first; state: agent ended before delivery | <agent> finished before <session> forwarded it · a SendMessage now would resume it | cut | The line reads <agent> finished before the message reached it. | pattern | `src/renderer/src/tools/agents/copy.ts:99` |
| T203 | the line above the field for a terminal-driven session after a send; state: message sent | Sent to <agent> | cut | After a send in a terminal-driven session the line reads Sent. | pattern | `src/renderer/src/tools/agents/copy.ts:108` |

### Right column, Subagents panel

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P75 | section heading over the finished agents (folded at first), naming how many failed and how many were stopped | Done 5 · 1 failed · 2 stopped | stays | Stays. the stopped count leaves the Done heading; a count of an exception \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/agents/copy.ts:22` |

### Right column, Subagents panel, one agent opened

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P97 | under the agent's name: model, elapsed time, tokens; each cell falls back to words when its value is missing ('model unknown', 'elapsed unavailable', 'tokens unavailable') | model unknown · elapsed unavailable · tokens unavailable | cut | The line under an agent's name shows only the values it has; a missing model, elapsed or token count leaves no words. | seen | `src/renderer/src/tools/agents/copy.ts:57` |

## Background tasks, Tasks and Log

### Background tasks panel

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T205 | after the Done head's count; state: finished tasks exist | · 1 workflow · 2 shells · 1 monitor | cut | The Done heading reads Done 4, with no kinds after it. | pattern | `src/renderer/src/tools/agents/copy.ts:122` |
| T206 | where the Running section would be, while nothing runs; state: nothing running | Nothing running | stays | Stays. brought back on panel-background | brought back | `src/renderer/src/tools/agents/copy.ts:166` |
| T207 | one line at the top of the panel for a session that is not running here; state: session not live | Shells and monitors are known only while the session runs here | stays | Stays. the sentence that says why a non-local session's shells are not listed; the owner's T206 note (empty versus not loading) bears on it; lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/tools/agents/copy.ts:165` |
| T209 | top of the panel after following a link to a run the app has not read yet (also the body of that run's page); state: run not read yet | Run not found yet | cut | Following a link to a run not read yet shows a spinner (at the panel's top and on the run's page); Loading run… is its accessible name and tooltip. | pattern | `src/renderer/src/tools/agents/copy.ts:179` |
| T210 | second line of a workflow's card and of its page's head | workflow release-notes · 4m 02s · 3 agents · 38.1k tokens | cut | A workflow's second line reads release-notes · 4m 02s · 3 agents, with no workflow word and no tokens. | pattern | `src/renderer/src/tools/agents/copy.ts:135` |
| T212 | third line of a workflow's card, and the body of its page, before the first progress arrives; state: no progress yet | Phases arrive with the first progress frame | cut | Before the first progress, a workflow's card and page show a spinner in place of the sentence. | pattern | `src/renderer/src/tools/agents/copy.ts:143` |
| T213 | top right of a finished workflow's card; state: workflow finished | completed | cut | A finished workflow's card and page show a green check in place of completed; failed and stopped keep their word. | pattern | `src/renderer/src/tools/agents/copy.ts:139` |
| T215 | button on a running workflow's card and page; state: workflow runs | Stop workflow | cut | The button on a running workflow's card and page reads Stop. | pattern | `src/renderer/src/tools/agents/copy.ts:144` |
| T216 | after the description on a running shell, monitor or task row | · running 4m 02s | cut | A running shell, monitor or task row reads <description> · 4m 02s. | seen | `src/renderer/src/tools/agents/copy.ts:152` |
| T217 | after the description on a running row with no start time; state: no start time known | · running · elapsed unavailable | cut | A running row with no start time shows its description alone. | pattern | `src/renderer/src/tools/agents/copy.ts:153` |
| T218 | after the description on a finished row; behind: the Done section | · completed 3m ago | cut | A finished row reads <description> · 3m ago; failed and stopped rows keep their word. | pattern | `src/renderer/src/tools/agents/copy.ts:154` |
| T219 | bordered button at the right of every running shell, monitor and task row | Stop | stays | Stays. kept: consent | consent | `src/renderer/src/tools/agents/copy.ts:145` |
| T220 | bordered button on every shell row, before Stop | Output | stays | Stays. a word button replaced by "pressing the row opens it", which the owner rejected at P30 and P50 | pattern | `src/renderer/src/tools/agents/copy.ts:156` |

### Background tasks panel, Scheduled section

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T222 | bordered button at the right of a scheduled job's first line | Open creating turn | cut | Open creating turn is a small arrow at the row's right that appears under the pointer (and on focus); the words are its tooltip and hidden text. | pattern | `src/renderer/src/tools/agents/copy.ts:213` |
| T223 | second line of each job, before its prompt; representative of the six combinations (recurring or one-shot; durable · this session, durable · another session, session-only) | recurring · durable · this session | stays | Stays. a scheduled job's facts (recurring, durable, this session) leave the row; the owner brought some second lines back (artifacts, plugins on hover) and left others (Overview card footers) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/agents/copy.ts:203` |
| T224 | third line of each job | Next ≈ 14:30 (in 3m) | cut | A job's next run reads 14:30 · in 3m. | pattern | `src/renderer/src/tools/agents/copy.ts:206` |
| T226 | third line of a job whose schedule the app cannot read; state: unreadable schedule | next run unknown | cut | A job whose schedule cannot be read has an empty next-run line. | pattern | `src/renderer/src/tools/agents/copy.ts:207` |
| T227 | end of each job's third line; representative of two (Expires <date>, Last ran <ago>) | · Expires Nov 20 · Last ran 2h ago | stays | Stays. "Last ran 2h ago" and the expiry date leave the row; a row's age came back for sessions (W61) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/agents/copy.ts:209` |

### Background tasks panel, Tasks section; and the Tasks panel

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T230 | after the Tasks head for a session that is not running here; state: session not live | session list | cut | The Tasks heading and the Tasks panel no longer show session list. | pattern | `src/renderer/src/tools/agents/copy.ts:159` |
| T231 | under the open tasks; state: completed tasks are folded | 3 earlier tasks completed | cut | The fold under the open tasks reads 3 done. | pattern | `src/renderer/src/tools/agents/copy.ts:158` |
| T232 | first line of the Tasks panel | 3 of 7 completed | cut | The Tasks panel's first line reads 3/7. | pattern | `src/renderer/src/tools/agents/copy.ts:193` |
| T233 | body of the Tasks panel before the engine has named a list; state: no list yet | Tasks unavailable until the engine reports its list | reword | Before the engine names a task list, the Tasks panel body reads "No list yet". | pattern | `src/renderer/src/tools/agents/copy.ts:160` |
| T234 | body of the Tasks panel when the list is empty; state: empty list | The engine is not creating task lists in this session | cut | An empty list reads No tasks. | pattern | `src/renderer/src/tools/agents/copy.ts:164` |

### Background tasks panel, a workflow's page

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T237 | head row of the agents table | Agent Model State Time Tokens | stays | Stays. a table loses its column heads; whether the values read without them was never shown \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/agents/copy.ts:142` |
| T238 | State cell of each agent row, beside a check or a spinner | done | cut | In a workflow's agent table the State cell shows the check or the spinner alone; other engine words (queued, failed…) still show. | pattern | `src/renderer/src/tools/agents/background/RunWidget.tsx:240` |
| T239 | in place of the table for a phase with no agents; state: phase has no agents | No agents in this phase yet | reword | A workflow phase with no agents shows "No agents yet" in the table's place. | pattern | `src/renderer/src/tools/agents/copy.ts:178` |

### Log panel (a command's full output)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T241 | bordered button at the right of the head | Refresh | cut | The Log panel's Refresh is a circular-arrow icon; the word is its tooltip and hidden text. | pattern | `src/renderer/src/tools/agents/copy.ts:222` |
| T244 | beside the disabled Load more at the end of the file; state: end reached | End of file | stays | Stays. "End of file" is why Load more is greyed; the owner accepted a greyed button's reason moving to its tooltip (T391) but here it is removed \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/agents/copy.ts:224` |
| T246 | centre of the panel when a cell has no output file; state: no output file | No file to open: the engine reported no output file for this cell; the transcript shows what was kept | cut | A cell with no output file reads No output file for this cell. | pattern | `src/renderer/src/tools/agents/copy.ts:225` |

### Right column, Background tasks panel

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P126 | after the command on an ended row whose outcome is not known, and as a card's badge | status unavailable | cut | An ended row or card whose outcome is unknown shows no status word. | pattern | `src/renderer/src/tools/agents/copy.ts:139` |
| P140 | right end of the Tasks heading; opens the Tasks panel | Open | cut | The Tasks heading's Open appears only under the pointer on the heading (and on keyboard focus). | pattern | `src/renderer/src/tools/agents/copy.ts:194` |

## Session info

### Session info panel

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T249 | head of the fifth group | Context, usage, cost | cut | The fifth group's head reads "Usage". | seen | `src/renderer/src/tools/session-info/copy.ts:22` |
| T252 | the whole panel: six groups and about twenty-five rows shown at once | Engine · Model · Gateway · Permissions · Context, usage, cost · Hooks and MCP | cut | Every group shows only its head with a › chevron; a press opens it with the app's disclosure motion. Permissions and Usage start open. | seen | `src/renderer/src/tools/session-info/SessionInfoView.tsx:161` |
| T253 | after a value, in quiet ink; representative of six source notes (effective, from the init frame; from ClaudeUsage, shared by every session; from the engine; CLAUDE_CODE_SUBAGENT_MODEL, chosen at launch; passed through from your shell; on · ENABLE_TOOL_SEARCH, needed behind a base URL) | from ClaudeUsage, shared by every session | cut | The source notes (Mode's "effective, from the init frame", Subagents' "CLAUDE_CODE_SUBAGENT_MODEL, chosen at launch", Overrides' "passed through from your shell", the Main row's "set · the next init frame confirms it", and "Last observed <ago>" on a dormant session's rows) are the value's tooltip. | seen | `src/renderer/src/tools/session-info/copy.ts:110` |
| T254 | value of the Auto-mode lane row; representative of six sentences (Server · reviews ride on the main request · no charge · model chosen server-side; Local · Sonnet 5 through <account> · counted as usage · the engine's notice is in the transcript; Local (expected) · a GPT route carries no Anthropic verdict; … · fast mode is on; … · the server lane is disabled for this session; Auto mode is off · <mode>) | Server · reviews ride on the main request · no charge · model chosen server-side | cut | The Auto-mode lane row reads "Server", "Local" or "Off"; the whole sentence is under the pointer. A refusal and "Not read yet" keep their words. | seen | `src/renderer/src/tools/session-info/copy.ts:14` |
| T255 | after the lane's value | 12 tool calls evaluated, 1 flagged | cut | After the lane: "12 reviewed · 1 flagged". | pattern | `src/renderer/src/tools/session-info/copy.ts:16` |
| T256 | value of the Route row; representative of two (Gateway · ClaudeUsage relay · <url>; Direct · engine's own login · <login>) | Direct · engine's own login · <login> | cut | Route reads "Direct · <login>", "Direct", or "Gateway · <url>". | pattern | `src/renderer/src/tools/session-info/copy.ts:84` |
| T258 | note of the Route row before the route is checked; representative of two waits (not verified yet; "· the rules are not read yet" after the grants count); state: not read yet | not verified yet | cut | An unverified route shows "Route unverified" with no note until checked (a mismatch keeps its sentence); the grants-only Rules value drops "· the rules are not read yet". | seen | `src/renderer/src/tools/session-info/copy.ts:87` |
| T259 | note of the Account row; representative of two (pinned for this session, routing now) | pinned for this session | cut | The Account row's note reads "pinned" (or "routing now"). | pattern | `src/renderer/src/tools/session-info/copy.ts:95` |
| T264 | value of the Cost row | $1.20 this session · $0.30 since you last looked | cut | Cost reads "$1.20 · $0.30 new". | seen | `src/renderer/src/tools/session-info/copy.ts:114` |
| T266 | an extra group for a terminal session driven through its bridge: one row per control that cannot be used here, up to twenty-seven, each with its reason; state: terminal-driven session | Not available here | cut | A bridged terminal session's "Not available here" group is folded to its head with the count beside it; a press lists the controls and reasons. | pattern | `src/renderer/src/tools/session-info/copy.ts:38` |

### Session info panel (words kept here)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T539 | a row of the Session info panel, drawn by that tool: label and value | Browser tabs: 3 loaded · 120 MB · outside the engine budget | cut | Session info's row reads "Browser tabs: 3 loaded · 120 MB". | pattern | `src/renderer/src/tools/browser/copy.ts:248` |
| T540 | the same row when the session has no page loaded | Browser tabs: No tabs loaded | cut | Session info has no Browser tabs row while no page is loaded; with pages loaded it reads "2 loaded · 412 MB". | pattern | `src/renderer/src/tools/browser/copy.ts:249` |

### Switch route sheet (from Session info)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C146 | first paragraph under the title "Switch this session to Direct?" | The engine process restarts and resumes the same session: the transcript and session grants are kept, and queued messages are kept and sent after the restart; a running turn is stopped first. | stays | Stays. kept: consent | not a cut | `src/renderer/src/gateway/copy.ts:50` |
| C149 | sheet that follows when the machine's relay is down: title "This machine’s relay isn’t answering. Switch anyway?" and this body | This machine’s own settings send its requests to ClaudeUsage’s relay, which isn’t answering, so the first turn may fail. The session is stopped: Cancel leaves it so, to resume on the route it was on. | stays | Stays. kept: consent | not a cut | `src/renderer/src/gateway/copy.ts:89` |

### Right column, Session info panel

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P162 | after a row's value, where it came from: 'effective, from the init frame' (Mode), 'from ClaudeUsage, shared by every session' or 'from the engine' (Usage), 'CLAUDE_CODE_SUBAGENT_MODEL, chosen at launch' (Subagents), 'passed through from your shell' (Overrides), '· outside the engine budget' (Browser tabs), 'set · the next init frame confirms it' (Main), 'Last observed <ago>' on each row of a session not running | effective, from the init frame | cut | The source notes are gone from the rows at rest. (Partly applied on the scratch branch: P162 says remove; T253 (same notes) says hover, so they were moved to the value's tooltip rather than deleted. The at-rest screen is the same.) | pattern | `src/renderer/src/tools/session-info/copy.ts:100` |
| P163 | value of the Tool search row on a routed session | on · ENABLE_TOOL_SEARCH, needed behind a base URL | cut | Tool search reads "on". | pattern | `src/renderer/src/tools/session-info/copy.ts:90` |
| P176 | the Context, Usage and Pace rows: '152,000 of 200,000 · 76% · autocompact at 180,000', '5h 42% · resets in 2h · Weekly 18% · resets in 3d' with its source note, and the pace line | 5h 42% · resets in 2h · Weekly 18% · resets in 3d | cut | The Context and Usage rows are gone from Session info (the context and usage displays show those numbers); the Usage group keeps Cost, and Pace when a window runs short. (Partly applied on the scratch branch: Pace kept: it is shown nowhere else since the status line went (gateway/routing-facts.ts paceLine has no other caller). The context read the panel still makes (SessionInfoView.tsx) now feeds nothing visible.) | seen | `src/renderer/src/tools/session-info/copy.ts:108` |
| P174 | values that stand for something not known yet: 'Not observed yet', 'Not read yet', 'not verified yet', 'no account yet' | Not observed yet | cut | Every surface that said "Not observed yet" (Session info values, the Context summary, the compact widget, the plugin detail) shows a dash instead. | seen | `src/renderer/src/sessions/observed.ts:33` |

## Terminal

### Terminal panel

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T267 | top left of the blank terminal for about half a second; state: shell starting | Starting shell… | stays | Stays. the terminal is blank for about half a second while its shell starts; a short wait, but the owner's blank-reads-as-failed note bears on it \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/terminal/TerminalView.tsx:158` |
| T268 | bar above a restored tab while it looks for its shell; state: reconnecting after reload | Reconnecting to this tab’s shell… | cut | The bar over a restored tab looking for its shell reads "Reconnecting…". | pattern | `src/renderer/src/tools/terminal/copy.ts:7` |
| T269 | bar above the terminal after a relaunch, with a × to dismiss; representative of two (the other: "The previous shell no longer runs on <machine>"); state: after relaunch | The previous shell closed when MAWS quit | reword | After a relaunch the bar above the terminal is back with its × and reads "Previous shell closed at quit" (another machine's: "Previous shell no longer runs on devbox"); a lossy reattach shows the "Reconnected; earlier output was not kept" bar again. | pattern | `src/renderer/src/tools/terminal/copy.ts:3` |
| P182 | the same bar when the app could not learn what is running | The terminal service did not say what is running. Close anyway? | stays | Stays. kept: consent | consent | `src/renderer/src/tools/terminal/TerminalView.tsx:91` |

## Questions panel

### Questions panel (the agent's structured questions)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T276 | under the ask's title while the agent is blocked on it | The agent is waiting for these answers. | cut | A blocking ask has no line under its title. | pattern | `src/renderer/src/tools/maws/ask/copy.ts:28` |
| T277 | under the ask's title when the agent has gone on working | The agent keeps working; your answers reach it as its next message. | cut | A non-blocking ask says "Not blocking" under its title. | pattern | `src/renderer/src/tools/maws/ask/copy.ts:29` |
| T278 | under every question, left | Add note | stays | Stays. Add note under every question shows only on the pointed question; row buttons on hover were left at T379 and G39 but a connector's Remove on hover came back (G255), and Skip is one of the answers \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/maws/ask/copy.ts:45` |
| T280 | under every question, right, after Decide for me | Skip | stays | Stays. Skip under every question shows only on the pointed question (see T278) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/maws/ask/copy.ts:32` |
| T284 | in the preview pane beside the options when the focused option has none; state: option without a preview | No preview for this option | stays | Stays. empty state: the preview pane would go blank | pattern | `src/renderer/src/tools/maws/ask/copy.ts:49` |
| T285 | under the "Build one with me" option of a design-system question | The agent works out a new design system with you. | cut | "Build one with me" has no line under it. | pattern | `src/renderer/src/tools/maws/ask/copy.ts:71` |
| T286 | under each design system's name in a design-system question; representative of six origins (Built in, Adopted from …, Derived from …, Imported from Claude, Started blank, Copy of …) | Adopted from <source> | stays | Stays. each design system's origin moves to hover; close to the plugin author the owner wants shown in the row when pointed at (G216) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/maws/ask/copy.ts:85` |
| T292 | centre of the panel with no question open, second line; state: no open question | When the agent asks you something, it shows here. | cut | The empty Questions panel says only "No open questions". | pattern | `src/renderer/src/tools/maws/ask/copy.ts:23` |

### Questions panel, an ask opened from the transcript after the fact

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T294 | under the title of an answered ask; behind: an old ask from the transcript | Answered | stays | Stays. same state word as T96 in the Questions panel; kept by the owner's round-2 call on the card | pattern | `src/renderer/src/tools/maws/ask/copy.ts:62` |
| T296 | under the title of an ask the app no longer holds; state: ask no longer held | MAWS no longer holds this ask, so it cannot be answered here. | cut | An ask MAWS no longer holds says "Can no longer be answered here". | pattern | `src/renderer/src/tools/maws/ask/copy.ts:63` |
| T298 | small label over the note the person left; behind: an old ask from the transcript | Note | cut | An old ask's note shows without its "Note" label (kept for screen readers). | pattern | `src/renderer/src/tools/maws/ask/copy.ts:68` |

## Files and the file tab

### Files, Review and Source control panels

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T301 | the whole panel body when no session is on screen; representative of three (Review: "Open a session to review its changes", Source control: "Open a session to see its changes") | Open a session to see its files | stays | Stays. empty state with what to do ("Open a session…"), like G249 and T384 the owner brought back (applied only in part on the scratch branch) | pattern | `src/renderer/src/tools/code/copy.ts:23` |

### File viewer, Review, Source control

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T302 | in place of the content while a file, a list or a diff is read; representative, the same word in three tools (about nine places) | Loading | cut | In the file viewer and Review, a read shows nothing for its first 400 ms and then a small quiet spinner where the word "Loading" was (its accessible name stays "Loading"). (Partly applied on the scratch branch: Applied in the code tools' places only; the same word in the other tools (Source control and others) is in their own folders.) | pattern | `src/renderer/src/tools/code/viewer/FileViewer.tsx:82` |

### File tab, the bar over the code

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T305 | right end of the bar, whenever the file is shown as code | Wrap | cut | The file viewer's Wrap button is gone from the bar; Wrap is a check item in the same view menu behind the sliders glyph. | pattern | `src/renderer/src/tools/code/viewer/FileViewer.tsx:194` |

### Files panel, tree

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T314 | after the name of a root folder, for the session's own folder | directory | cut | The session's own folder at the root of Files shows its name alone; "additional directory", "worktree" and "working folder" still follow the roots they tell apart. | seen | `src/renderer/src/tools/code/files/FilesTool.tsx:320` |
| T316 | after the name of a symbolic link | Symbolic link → ../shared/config | cut | A symbolic link's row reads its name then "→ ../shared/config". | pattern | `src/renderer/src/tools/code/copy.ts:25` |
| T317 | a line under an opened folder that holds nothing | Empty directory | stays | Stays. brought back by the owner, though no picture's change list carries it | brought back | `src/renderer/src/tools/code/copy.ts:26` |

### File tab, the bar over the file

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T322 | in the bar when a file is larger than the viewer holds, beside "Load more" | Showing the first 1.0 MB of 5.2 MB | cut | A file past the viewer's cap reads "1.0 MB of 5.2 MB" beside Load more. | pattern | `src/renderer/src/tools/code/copy.ts:39` |
| T324 | in the bar while a long file is still arriving in pieces | Loading 1.0 MB of 5.2 MB | cut | While a long file arrives the bar shows a small progress ring filling up; the two sizes show under the pointer (the ring's accessible name keeps "Loading 1.0 MB of 5.2 MB"). | pattern | `src/renderer/src/tools/code/copy.ts:42` |

### File tab, body

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T327 | centred in the tab for a file MAWS does not draw (PDF, HTML, Audio, Video, an oversized Image), with its size under it and the button | PDF files open outside MAWS | cut | A file MAWS does not draw shows one line, "PDF · 2.3 MB", above Open externally (the separate size line is gone). | pattern | `src/renderer/src/tools/code/copy.ts:37` |
| T328 | centred in the tab for a binary file | Binary file · 12.4 KB | cut | A binary file's tab reads "Binary · 12.4 KB". | pattern | `src/renderer/src/tools/code/copy.ts:38` |

### File tab, the bar over an image

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T333 | two text buttons after − 100% + in the bar of an image | Actual size Fit | stays | Stays. word buttons (Actual size, Fit) replaced by "press the percent", the shape the owner rejected at P30 and P50 | pattern | `src/renderer/src/tools/code/viewer/MediaZoom.tsx:117` |

### File tab, code

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T336 | the find bar that ⌘F opens over the code; its words are the editor library's own (next, previous, all, match case, regexp, by word, replace, replace all) | next previous all match case regexp by word | cut | The ⌘F find bar shows ↓ and ↑ for next and previous and Aa, .*, ab\| as toggles (pressed when on, their boxes hidden); each keeps its word as its tooltip and accessible name. "all", "replace", "replace all" are unchanged. | pattern | `src/renderer/src/tools/code/viewer/CodeView.tsx:85` |

### File tab, the bar, with unsaved edits

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T338 | tooltip of the Save button | Save · ⌘S | cut | The Save button's tooltip is the chord alone ("⌘S"), none when no chord is bound. | pattern | `src/renderer/src/tools/code/editor/EditorControls.tsx:84` |

### File tab, the bar, comparing with the disk

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T341 | the notice in the bar once the two versions are compared, or after a save found the disk changed | Changed on disk since you opened it | cut | After Compare, or a save that found the disk changed, the notice reads "Changed on disk". | pattern | `src/renderer/src/tools/code/copy.ts:117` |
| T342 | a count beside ↑ ↓ arrows, right of the notice | 3 changes from disk | cut | The count beside the merge view's ↑ ↓ reads "3 changes". | pattern | `src/renderer/src/tools/code/copy.ts:124` |

### File tab, the bar, disk version cannot be merged

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T343 | a warning notice in the bar (three reasons: too large, no longer text, no longer UTF-8) | Changed on disk: now larger than the editor’s cap, so it cannot be merged | cut | The warning reads "Changed on disk · too large to merge" (and "· not text, can’t merge", "· not UTF-8, can’t merge"). | pattern | `src/renderer/src/tools/code/copy.ts:120` |

### Comment placeholder sheet

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T352 | a sheet that stood in for the comment composer before it existed; the composer is registered now, so the app never opens it | The comment composer arrives with side threads (E3). This anchor will open it: | cut | The placeholder sheet (unreachable) no longer carries the build-plan sentence; its title, the anchor's fields and Close remain. | pattern | `src/renderer/src/tools/code/copy.ts:138` |

### File tab, merge and conflict buttons

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P280 | small buttons drawn in the code: on each difference from disk "Keep mine" / "Take theirs"; over each git conflict block "Accept mine" / "Accept theirs" / "Accept both", with the labels "mine (<name>)", "base", "theirs (<name>)" | Accept mine · Accept theirs · Accept both | stays | Stays. skipped: a vocabulary merge, not a cut | not a cut | `src/renderer/src/tools/code/copy.ts:127` |

## Review

### Review and Source control, over a diff

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T303 | a row of three text buttons over every diff, at rest; representative of Review's row (Source control has the same three) | Unified Split Wrap | cut | Review's diff no longer has a row of Unified / Split / Wrap buttons: those settings sit in a view menu behind a sliders glyph at the end of the diff's bar, after the hunk counter and its arrows. (Partly applied on the scratch branch: Source control's same three buttons are in src/renderer/src/tools/scm/ (outside my folders). The diff's bar is now only the counter, ↑ ↓ and the glyph, right-aligned; folding it into the file header row above would save the row but moves controls, so it was not done.) | seen | `src/renderer/src/tools/code/review/ReviewShell.tsx:294` |
| T306 | right of the mode buttons, beside the ↑ ↓ arrows; representative of two (Review and Source control) | Showing hunk 2 of 5 | cut | The hunk counter reads "2 / 5"; "Hunk 2 of 5" shows under the pointer. (Partly applied on the scratch branch: Source control's counter is in src/renderer/src/tools/scm/, outside my folders.) | seen | `src/renderer/src/tools/code/review/ReviewShell.tsx:305` |

### Review and Source control, selected file's header

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T307 | after the path in the header over the diff, for a file that was simply edited; representative of two | · Modified | cut | The header over a simply edited file's diff shows the path alone; Added, Deleted, Renamed from …, Untracked and Binary still follow it. | seen | `src/renderer/src/tools/code/review/ReviewShell.tsx:271` |
| T309 | a text button right of the path over the diff; representative of two (Source control's rows also carry the same ↗ under the pointer) | Open file ↗ | cut | Over the diff the open-file control is the ↗ alone; "Open file" is its tooltip and accessible name. | seen | `src/renderer/src/tools/code/review/ReviewShell.tsx:280` |

### Review and Source control

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T312 | two panels of the right column that each list the changed files with a diff under the list: Review reads (scopes, viewed marks), Source control acts (stage, commit, push) | Review / Source control | stays | Stays. skipped: redesign, not a word cut | not a cut | `src/renderer/src/tools/code/review/ReviewTool.tsx:70` |

### Review panel and diff tab

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T356 | the bold line under the chips | 3 files changed · +12 −4 · Uncommitted | cut | Under the chips the bold line reads "3 files · +12 −4" (no "changed", no scope word), and over an empty scope there is no line at all. | seen | `src/renderer/src/tools/code/copy.ts:63` |
| T357 | the faint line at the very bottom (four forms, one per scope; "detached at abc1234" stands for the branch when there is none) | main · Working tree against HEAD | cut | No faint line at the foot of Review; "main · Working tree against HEAD" (and the other scopes' forms) shows under the pointer on the pressed scope chip, or on the bold line in a diff tab. | seen | `src/renderer/src/tools/code/copy.ts:95` |
| T362 | in place of the list when the scope has no changes (four forms: "No uncommitted changes", "Nothing on feat beyond main", "Nothing staged", "This turn changed no files") | No uncommitted changes | cut | An empty scope reads "No changes" for Uncommitted, Staged and Last turn; the branch form keeps "Nothing on feat beyond main". | pattern | `src/renderer/src/tools/code/copy.ts:71` |

### Review panel, file list

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T358 | at the end of a file's row, where the +N −N would be, for a file git does not track | Untracked | stays | Stays. brought back on panel-review | brought back | `src/renderer/src/tools/code/review/ReviewShell.tsx:157` |

### Review panel, selected file's header

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T360 | a toggle right of the path; reads "Viewed" once pressed | Mark viewed | stays | Stays. the owner brought "Mark viewed" back on the Review picture: the checkbox alone does not say what it does | brought back | `src/renderer/src/tools/code/review/ReviewShell.tsx:275` |

### Review panel, the diff area

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T361 | in place of a diff for an untracked folder | Untracked file · not in the diff | cut | An untracked folder's diff area reads "Untracked folder". | pattern | `src/renderer/src/tools/code/copy.ts:79` |

### Review panel, scope chips

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P288 | tooltip of the disabled Staged chip | Index matches HEAD | cut | The disabled Staged chip's tooltip reads "Nothing staged". | pattern | `src/renderer/src/tools/code/copy.ts:67` |

## Source control

### Source control, over the selected file's diff

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T304 | the same row of three text buttons as Review's | Unified Split Wrap | cut | The diff bar over the selected file has no Unified / Split / Wrap buttons; one view glyph at the end of the bar opens a menu with Unified, Split and Wrap. | pattern | `src/renderer/src/tools/scm/ScmDiff.tsx:140` |

### Source control panel, top line

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T366 | after the branch name, always, even at zero ("0 ahead"); "N behind" follows when behind | · 2 ahead · 1 behind | cut | The top line shows "⎇ main ↑2 ↓1", and nothing after the branch when it is even. | pattern | `src/renderer/src/tools/scm/ScmShell.tsx:142` |
| T367 | between the branch and the ahead count | · origin/main | cut | A branch tracking its own name shows no upstream on the line; the upstream is the line's tooltip. An unusual upstream is still written out. | pattern | `src/renderer/src/tools/scm/ScmShell.tsx:142` |
| T368 | after the branch name of a branch never pushed | · no upstream | cut | A never-pushed branch shows its name alone (the button beside it says Publish). | pattern | `src/renderer/src/tools/scm/copy.ts:19` |
| T371 | the same two buttons while they are off: nothing to push, or not pushed yet | Push Open PR (both greyed) | cut | Push and Open PR are absent while they would be greyed (nothing to push, not pushed yet, behind, no remote, trust being read); they appear when they can act. | seen | `src/renderer/src/tools/scm/RemoteActions.tsx:61` |

### Source control panel, groups

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T377 | three section heads that are always there, each with a count badge, even at zero | Staged 0 Unstaged 0 Untracked 0 | cut | A group with no files is not drawn; a clean tree shows only "No changes". | pattern | `src/renderer/src/tools/scm/ScmShell.tsx:117` |
| T379 | text buttons at the right of each group's head, always shown while the group has files | Discard all… Stage all | cut | Discard all…, Stage all, Delete all… and Unstage all appear on a group's head only under the pointer or keyboard focus. | seen | `src/renderer/src/tools/scm/ScmShell.tsx:163` |
| T381 | tooltip of the Staged group's "Unstage all" button | Unstage all | cut | Unstage all has no tooltip (its accessible name stays). | pattern | `src/renderer/src/tools/scm/ScmShell.tsx:159` |

### Source control panel, a file's row

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T383 | tooltips of the small glyph buttons that appear on a row under the pointer (−, ↺, +, ×, ✓, ↗), each naming the row's whole path | Discard changes to src/app/keys.ts | cut | A row's glyph buttons have verb-only tooltips: Unstage, Discard…, Stage, Delete…, Mark resolved, Open file. | pattern | `src/renderer/src/tools/scm/FileRow.tsx:76` |

### Source control panel, the diff area

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T384 | under the lists while no file is selected | Select a file to see its changes | stays | Stays. brought back on panel-source-control | brought back | `src/renderer/src/tools/scm/copy.ts:72` |
| T387 | in place of a diff for an untracked folder | An untracked directory: Stage adds every file in it | cut | An untracked folder's diff area reads "Stage adds every file in this folder". | pattern | `src/renderer/src/tools/scm/copy.ts:74` |

### Source control panel, commit form

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T390 | a checkbox with its label, left of the Commit button, always | Skip hooks (--no-verify) | cut | The Skip hooks checkbox is gone; a ⌄ beside Commit opens a menu with "Commit without hooks", which commits once with --no-verify. | seen | `src/renderer/src/tools/scm/CommitForm.tsx:63` |
| T391 | faint words left of the greyed Commit button; the button's tooltip says the same | Write a commit message | cut | "Write a commit message" no longer stands beside Commit; it is the greyed button's tooltip. | seen | `src/renderer/src/tools/scm/CommitForm.tsx:69` |

### Source control panel, Output

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T394 | a collapsed row at the panel's foot that stays after a push or PR has finished well, until the next one | Output Push · Done | stays | Stays. a push that went well leaves no Output row, only a brief check; a receipt, but also the only way back to the push's output \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/scm/Output.tsx:60` |
| T395 | the row's state while a command runs | Pull request · Running… | cut | While a command runs the Output head reads "Pull request" (or "Push") followed by the app's spinner. | pattern | `src/renderer/src/tools/scm/copy.ts:164` |
| T397 | the last line under the opened output, repeating the state the row's head shows | Done | cut | The opened Output has no closing state line; the head says how it ended. | pattern | `src/renderer/src/tools/scm/Output.tsx:88` |
| T400 | tooltip of that Cancel button | Cancel the running command | cut | Cancel in the Output head has no tooltip (its accessible name stays). | pattern | `src/renderer/src/tools/scm/copy.ts:171` |

### Push and pull-request sheets

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T405 | in place of the rows while the command is prepared | Preparing the command… | cut | While the Push or PR sheet prepares its plan, a spinner stands where the rows will be. | pattern | `src/renderer/src/tools/scm/copy.ts:137` |

### Source control, Review and Files panels, no session

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P210 | centre of the panel when it is pinned and no session is shown; representative, the others are "Open a session to review its changes" and "Open a session to see its files" | Open a session to see its changes | stays | Stays. empty state with what to do ("Open a session…"), like G249 and T384 | pattern | `src/renderer/src/tools/scm/copy.ts:10` |

### Source control, Review and file viewer, while reading

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P211 | where the list, the diff or the file will be while git or the file is read; one word used in eight places across the three (panel body, selected diff, lazy diff view, Review list, Review file, file tab) | Loading | cut | Where Source control said "Loading" (panel body, selected diff, lazy diff view), nothing shows at first, then a quiet spinner. | pattern | `src/renderer/src/tools/scm/copy.ts:11` |

### Source control panel, remote actions

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P219 | tooltip of an enabled Push, Publish or Open PR button; the others are "Publish <branch>" and "Open a pull request for <branch>" | Push 2 commits to origin/main | stays | Stays. the Push tooltip carried where and how many (origin/main, 2 commits), not a repeat of the button \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/scm/copy.ts:120` |

### Source control panel, untrusted folder

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P223 | beside Commit and as tooltips of Push and Open PR in the same state; the others are "Trust the folder to push", "Trust the folder to open a pull request" | Trust the folder to commit | stays | Stays. kept: consent | consent | `src/renderer/src/tools/scm/copy.ts:101` |

### Source control panel, notice line

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P224 | red line under the top line after a git action failed, before the system's own words; the other prefix is "git failed: " | Failed: <message> | stays | Stays. "Failed:" goes before git's own message, so git's refusals read like the app's errors; errors were never in a picture \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/scm/copy.ts:90` |

### Source control panel, change groups

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P228 | text buttons at the right of each group heading, always visible; the others are "Unstage all", "Discard all…", "Delete all…" | Stage all | cut | Group actions show under the pointer or focus only (same change as T379). | seen | `src/renderer/src/tools/scm/copy.ts:24` |

### Source control panel, file row

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P231 | tooltips of the glyph buttons (− ↺ + × ✓ ↗) that appear on a row under the pointer; the others are "Unstage <path>", "Discard changes to <path>", "Delete <path>", "Mark <path> resolved", "Open <path>" | Stage src/app/main.ts | cut | Row action tooltips are the verb alone (same change as T383); Open is "Open file". | pattern | `src/renderer/src/tools/scm/copy.ts:32` |

### Source control and Review, selected file's header

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P234 | above the diff, after the file's path; the same in both panels and in a diff tab ("Added", "Deleted", "Untracked", "Binary" and the conflict words likewise) | src/app/main.ts · Modified | cut | The selected file's header is the path alone, or "path · Renamed from <old>" / "Copied from <old>". | pattern | `src/renderer/src/tools/scm/copy.ts:69` |
| P235 | text button at the right of the selected file's header, in both panels | Open file ↗ | cut | The header's Open file is a lone ↗ with "Open file" as its tooltip. | pattern | `src/renderer/src/tools/scm/copy.ts:81` |

### Source control and Review, diff toolbar

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P236 | second line above the diff, at the right; same sentence in both panels and in a diff tab | Showing hunk 2 of 5 | cut | The hunk counter reads "2 / 5"; "Showing hunk 2 of 5" is its tooltip. | pattern | `src/renderer/src/tools/scm/copy.ts:85` |

### Source control, Review and file viewer, Wrap

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P238 | a toggle in each diff toolbar and in every file tab's bar (one setting shared by all code views) | Wrap | cut | Wrap is an item of the diff bar's view menu (same change as T304). | pattern | `src/renderer/src/tools/scm/copy.ts:84` |

### Source control panel, commit box

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P243 | faint text beside the disabled Commit button, always there until a commit is possible; the other is "Write a commit message". Both are also the button's tooltip | Nothing staged | cut | "Nothing staged" no longer stands beside Commit; it is the greyed button's tooltip. | pattern | `src/renderer/src/tools/scm/copy.ts:103` |

### Source control, Push sheet

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P249 | first row of the sheet when the checkout has a single remote (with several it is a picker) | Remote origin | cut | With one remote the Push sheet has no Remote row; with several it is the picker. | seen | `src/renderer/src/tools/scm/copy.ts:138` |
| P250 | a row of the sheet when the branch already has its upstream | Commits 2 commits | cut | The Push sheet has no Commits row; its button reads "Push 2 commits" (plain "Push" when the push sets an upstream). | seen | `src/renderer/src/tools/scm/copy.ts:144` |

## Browser, importing a Chrome profile

### Import a Chrome profile, sheet

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T503 | step 1: in place of the list, or under it, while reading (two forms; representative) | Reading Chrome's profiles… | cut | Step 1 shows a spinner in the list's place while Chrome's profiles are read, and a spinner under the list while a profile is inspected. | pattern | `src/renderer/src/tools/browser/import/copy.ts:95` |
| T507 | step 2: under History | 1,204 pages. Read from a copy; needs no password. Shown in the address bar's suggestions. | stays | Stays. kept: consent | consent | `src/renderer/src/tools/browser/import/copy.ts:104` |
| T508 | step 2: under Cookies, about fifty words | 3,412 cookies (120 partitioned). macOS will ask once for Chrome's Safe Storage password from your login keychain; choose Allow. MAWS reads it once, keeps it in memory only while the cookies are decrypted, and never writes it anywhere. Nothing is written back to Chrome. | stays | Stays. kept: consent | consent | `src/renderer/src/tools/browser/import/copy.ts:108` |
| T510 | step 2: under Bookmarks, about thirty-five words | 86 bookmarks. Shown in a bar under the address field and in its suggestions, and read again from Chrome each time this profile opens. Nothing is written to Chrome. | stays | Stays. kept: consent | consent | `src/renderer/src/tools/browser/import/copy.ts:114` |
| T511 | step 2: a fifth checkbox row, always disabled | Saved passwords — a credential store comes later | cut | Step 2 lists four categories; the disabled Saved passwords row is gone. | pattern | `src/renderer/src/tools/browser/import/copy.ts:111` |
| T512 | step 2: under Extensions | 4 extensions. Copied into MAWS and loaded in this profile's tabs. | stays | Stays. kept: consent | consent | `src/renderer/src/tools/browser/import/copy.ts:112` |
| T516 | step 2: two more chips under an extension | MV2 · No background | cut | Extensions in step 2 no longer carry MV2 or No background chips. | pattern | `src/renderer/src/tools/browser/import/copy.ts:122` |
| T527 | step 4: a line whenever partitioned cookies were imported | 120 partitioned cookies set, 118 confirmed in the partition | cut | The partitioned-cookies line shows only when some were not confirmed; otherwise the report says nothing about them. | pattern | `src/renderer/src/tools/browser/import/copy.ts:141` |
| T530 | step 4: a chip beside each imported extension that loaded (three forms; representative) | Loaded · background running | stays | Stays. "Loaded" leaves every imported extension; the owner brought back "Connected" on every connector row (G253) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/browser/import/copy.ts:196` |
| T533 | step 4: last line when the imported profile is the one new tabs use | New tabs browse as Work. Change in Settings › Browser. | cut | The last line reads "New tabs browse as Work." | pattern | `src/renderer/src/tools/browser/import/copy.ts:159` |

### Chrome profile import dialog, running

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P385 | open: the line over the progress bar, one per phase. One representative; the others: Preparing the profile's browser storage…, Importing cookies…, Confirming partitioned cookies…, Importing bookmarks…, Importing extensions…, Cleaning up…, Starting… | Importing browsing history… | cut | Over the progress bar the sheet names the category being imported (History, Cookies, Bookmarks, Extensions) and nothing during starting, preparing, confirming and cleaning up; the Keychain line still says to choose Allow. | pattern | `src/renderer/src/tools/browser/import/copy.ts:37` |

### Chrome profile import dialog, report

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P388 | open: the first line of the finished report, composed from what was imported and what was skipped (also "Nothing imported") | 312 cookies, 1,204 history entries, 86 bookmarks, 5 extensions · 14 skipped: 12 expired, 2 rejected by Chromium | cut | The report's first line ends at "· 14 skipped"; the reasons stay in the collapsed lines under it. | pattern | `src/renderer/src/tools/browser/import/copy.ts:137` |
| P394 | open, state: a chip beside an imported extension that is switched on but not loaded yet | On · loads when a tab next opens in this profile | cut | An extension switched on but not loaded yet shows an "On" chip. | pattern | `src/renderer/src/tools/browser/import/copy.ts:201` |
| P398 | open, state: under "Nothing … was kept" on a cancelled or failed import; a grey line with the whole summary of what had been reached | Before it stopped: 312 cookies, 400 history entries | cut | A cancelled or failed import shows only "Nothing … was kept" (and the failure), without the grey "Before it stopped" line. | pattern | `src/renderer/src/tools/browser/import/copy.ts:138` |

## Artifacts tab

### Side panel, Artifacts tab (the list)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T544 | top right of the list, a worded button | Open library | stays | Stays. a way into the library becomes a small arrow glyph; the owner brought back ways in (Customize link G5, Files P30) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/artifacts/copy.ts:8` |
| T545 | in place of the list when no session is shown (state: no session open) | Open a session to see its artifacts | stays | Stays. empty state with what to do ("Open a session…") | pattern | `src/renderer/src/tools/artifacts/copy.ts:9` |
| T546 | in place of the list when "This session" is chosen and the session has made nothing (state: empty) | Nothing made in this session yet. The pages, documents and files its agent makes land here. | cut | An empty This session list says "Nothing made yet". | pattern | `src/renderer/src/tools/artifacts/copy.ts:10` |
| T550 | the button under that error (state: error) | Try again | stays | Stays. skipped: a rename, not applied in this cut | not a cut | `src/renderer/src/tools/artifacts/copy.ts:15` |
| T551 | sticky group head above each kind's rows (representative: one per kind present, seven kinds) | Documents | stays | Stays. group headings over a list, which the owner brought back in Customize (G212) | pattern | `src/renderer/src/tools/artifacts/List.tsx:190` |
| T552 | second line under each row's title when "This session" is chosen (representative; the verb is Created, Edited or Read) | Created · 3m ago | stays | Stays. who did what when on an artifact row ("Created · 3m ago"), which the owner brought back in the library (G299) | pattern | `src/renderer/src/tools/artifacts/List.tsx:221` |
| T554 | second line under each row's title when "All" is chosen (representative) | Edited 2h ago by Claude | stays | Stays. the same "Edited 2h ago by Claude" line the owner brought back in the library (G299) | pattern | `src/renderer/src/tools/artifacts/List.tsx:222` |
| T555 | start of the second line on a built-in design system's row when "All" is chosen | Built in · Edited 2h ago by Claude | stays | Stays. the edit line on a built-in row, brought back in the library (G299); "Built in" stays | pattern | `src/renderer/src/tools/artifacts/List.tsx:223` |
| T548 | in place of the list while it is first read (state: loading) | Reading… | reword | While the Artifacts list is first read, a quiet spinner appears below the scope row after half a second ("Reading…" its accessible name). | pattern | `src/renderer/src/tools/artifacts/copy.ts:12` |

### Side panel, Artifacts tab (one artifact open)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T556 | left end of the thin bar above the opened artifact | Back | cut | The record bar's Back is a left chevron with "Back to list" as its tooltip and name. | pattern | `src/renderer/src/tools/artifacts/copy.ts:16` |
| T557 | right end of the same bar, a worded button | Move to tab | stays | Stays. kept: consent | consent | `src/renderer/src/tools/artifacts/copy.ts:27` |

### Tab menus and drop targets (words defined with the Artifacts tool, drawn by the tab strips)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T560 | a main tab's menu and the panel tab's context menu; the label over a drop target while dragging | Move to side surface / Move to main area / Open in split | stays | Stays. skipped: a rename, not applied in this cut | not a cut | `src/renderer/src/tools/artifacts/copy.ts:26` |

### Side panel summary, Artifacts section

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T562 | the section's one line, under its "Artifacts" head | 3 artifacts · {latest title} | cut | The summary's Artifacts line shows the latest title with the bare count at the line's end; the whole line opens the list. | pattern | `src/renderer/src/tools/artifacts/copy.ts:18` |
| T563 | the section's line when the session has made nothing (state: empty) | Nothing made yet | stays | Stays. empty state: the Artifacts section would have a head and nothing under it | pattern | `src/renderer/src/tools/artifacts/copy.ts:19` |
| T565 | worded button at the end of the section's line | Open | stays | Stays. a worded Open becomes the line as the press target (see T146) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/tools/artifacts/copy.ts:20` |

## Side chat, side threads and comments

### Side chat card (/btw)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P405 | under the pointer on that pill; on the open card's two header icons: "Fold side chat", "Close side chat" | Open side chat | cut | The folded side-chat chip's tooltip reads "Open". (Partly applied on the scratch branch: The open card's Fold and Close are IconButtons whose label is both tooltip and accessible name; needs src/renderer/src/app/IconButton.tsx.) | pattern | `src/renderer/src/side/copy.ts:120` |
| P408 | under the field of the open card, at the right; a bordered button, greyed until there is an answer | Continue as a side thread | cut | "Continue as thread" shows only once there is an answer to continue. | pattern | `src/renderer/src/side/copy.ts:128` |
| P409 | under the field of the open card, at the left; greyed until there is something to clear | Clear | cut | Clear shows only once there is an exchange, rather than greyed. | pattern | `src/renderer/src/side/copy.ts:127` |
| P413 | under a question, in place of an answer | The engine answered with no text | cut | An empty answer reads "No answer". | pattern | `src/renderer/src/side/copy.ts:125` |

### Side panel (side threads)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P418 | the tab's title in the right column | Side | stays | Stays. skipped: a rename, not applied in this cut | not a cut | `src/renderer/src/side/copy.ts:89` |
| P419 | middle of the panel when the session has no side thread | No side threads yet. Comment on a line, or type /btw in the composer. | cut | An empty Side panel reads "Comment on a line to start a thread." | pattern | `src/renderer/src/side/copy.ts:91` |
| P420 | middle of the panel when no session is open | Open a session to see its side threads. | stays | Stays. empty state with what to do ("Open a session…"), like G249 and T384 (applied only in part on the scratch branch) | pattern | `src/renderer/src/side/copy.ts:92` |
| P422 | the thread's header, right end: a small button in the code face that opens the thread's own side questions under it; under the pointer "Side questions" | /btw | cut | The thread header's questions toggle reads "Questions" in the normal face (accessible name "Questions: /btw side questions"). | pattern | `src/renderer/src/side/copy.ts:102` |
| P424 | in place of the thread, when it is already open as a tab: a sentence over a button "Go to tab". The same pair for a thread shown in a card under a page: "Shown in the card under the page" over "Show here" | Shown in the main area | cut | A thread shown elsewhere draws only its "Go to tab" / "Show here" button; the sentence is the button's tooltip. | pattern | `src/renderer/src/side/copy.ts:94` |
| P426 | middle of the question view under a thread, before the first question; the field below it carries eleven more words on the same point | Ask about the conversation without adding to it. The model answers beside the running turn, with no tools. | stays | Stays. the question view is blank before the first question; the field below may be enough, or it reads as not loaded \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/side/copy.ts:122` |

### Comment card

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P428 | a card that opens beside a line of code, a passage or a page element when the person comments on it: in its field | What should the agent look at or change here? | cut | The comment field's placeholder reads "Comment…". | pattern | `src/renderer/src/side/copy.ts:13` |
| P432 | the same button while the send runs: "Starting…" or "Sending…"; also the reply field's placeholder and the line under the first message of a thread that is starting | Sending… | cut | The comment card's Send keeps its word and shows a spinner while it goes; the echo under a starting thread's first message is a spinner. (Partly applied on the scratch branch: The comment sheet's button (SheetForm in src/renderer/src/sessions/Sheet.tsx takes words only) and the reply field's placeholder still read "Starting…"/"Sending…".) | pattern | `src/renderer/src/side/copy.ts:28` |
| P434 | over the field, when the comment carries a picture of the element: a thumbnail, or these words when it cannot be drawn, with a "Remove screenshot" button | Screenshot · 640 × 480 | cut | Without a thumbnail the comment shows "Screenshot" (size under the pointer); removing it is an × ("Remove screenshot" its name). | pattern | `src/renderer/src/side/copy.ts:31` |
| P438 | a small line where the card was, after a send to the main conversation: "Sent to <title>"; variants "Sent to <title>; read at the next step" and "Queued for <title>; it sends when the queue resumes" | Sent to Fix flaky upload test; read at the next step | cut | After a send the card's place reads "Sent to <title>" or "Queued for <title>". | pattern | `src/renderer/src/side/copy.ts:41` |
| P440 | the card once it holds a thread: a strip over the reply field when the thread waits on the person. Twelve forms, among them "Waiting for your permission", "Asked you a question", "Waiting for you to review a plan", "Waiting for you to trust this folder", "Waiting for your input", "Waiting for you", "Hit an error", "Was interrupted", "Could not start", "The relay is not answering", "Held by <who>", "Auto mode is unavailable" | Waiting for your permission | cut | The needs-you strip shows the orange disc and a noun: Permission, Question, Plan, Input, Trust this folder; error and held forms keep their words. | pattern | `src/renderer/src/side/copy.ts:78` |
| P442 | in the thread card's reply field | Reply to this thread | cut | The thread reply field's placeholder reads "Reply…". | pattern | `src/renderer/src/side/copy.ts:60` |
| P443 | beside a message of the person's in the thread card, once the engine has taken it | Sent to Claude | cut | A delivered message in the thread card shows "✓" instead of "Sent to Claude". (Partly applied on the scratch branch: The transcript draws the mark as caption text (src/renderer/src/transcript/view/rows/User.tsx), so it is a text check with no hover name.) | pattern | `src/renderer/src/side/copy.ts:69` |

## Channel

### Channel tab

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P447 | on every message sent to the whole project, after the sender's name; also at the end of a folded run ("12 messages from <name> to everyone") | to everyone | cut | "to everyone" is gone from messages to the whole project and from folded broadcast runs ("<name> · 12"). | pattern | `src/renderer/src/channel/copy.ts:19` |
| P448 | a folded run of messages between two sessions: a chevron, these words, the two names joined by "and", a time | 12 messages between | cut | A folded run reads "<name> and <name> · 12", then its time. | pattern | `src/renderer/src/channel/copy.ts:17` |
| P454 | top of the stream, once per machine whose app is too old to share its sessions' messages | devbox can't share its sessions' messages here: its MAWS is older | cut | An older machine's line reads "devbox: update MAWS there to see its sessions". | pattern | `src/renderer/src/channel/copy.ts:28` |
| P455 | middle of the stream when the channel has no message | Nothing in this channel yet. | stays | Stays. empty state: an empty channel would show nothing (T206) | pattern | `src/renderer/src/channel/copy.ts:31` |
| P457 | in place of the stream while it loads | Reading the channel… | cut | A spinner stands in place of "Reading the channel…". | pattern | `src/renderer/src/channel/copy.ts:33` |
| P459 | in the message box at the foot of the channel | Message everyone, or start with @alias to address a session | stays | Stays. the placeholder loses how to address one session (@alias), a hidden gesture like the composer's hint the owner brought back (C3); lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/channel/copy.ts:58` |
| P460 | the message box's button; "Sending…" while it goes | Send | cut | The send button is the session message box's round arrow (a spinner while it goes); "Send" is its name and tooltip. | pattern | `src/renderer/src/channel/copy.ts:59` |
| P461 | at the right of the person's own message while it is on its way | sending | stays | Stays. a message on its way is shown only by quieter ink; a pending state no picture showed \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/channel/copy.ts:42` |

## Messages to you (the report view)

### Report view (the agent's messages to the owner)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P496 | the same bar, when the engine runs another output style than the app expected | The engine uses the output style “Explanatory”, not “MAWS” as MAWS read it. The next start follows the engine. | cut | The output-style notice reads "Output style is “Explanatory”"; the full sentence under the pointer. | pattern | `src/renderer/src/owner/report/copy.ts:20` |
| P497 | a small bold label over each card of the report: "Message", "Must read", "Question", "Insight" | Message | stays | Stays. report cards lose their kind labels; once read, a Must read looks like a plain message \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/owner/report/copy.ts:5` |
| P498 | foot of a Must read card: a "Mark read" button while unread, the word "Read" after | Read | stays | Stays. "Read" goes; with P497, a read Must read is indistinguishable from a plain message \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/owner/report/copy.ts:51` |
| P501 | foot of a Question card: "Reply" opens a field labelled "Your answer", with "Send" and "Close" | Your answer | cut | The reply field has no visible "Your answer" label (it stays the field's name). | pattern | `src/renderer/src/owner/report/copy.ts:38` |
| P503 | under a Question card once it is answered, before the answer's text | Answered: | cut | An answered Question shows a check before the answer. | pattern | `src/renderer/src/owner/report/copy.ts:32` |
| P504 | under a Question card after choosing, while the agent is busy: these words and a "Cancel" button | Queued — sends when the agent reaches a pause | cut | A queued answer reads "Queued" with Cancel; why under the pointer. | pattern | `src/renderer/src/owner/report/copy.ts:27` |
| P505 | under a Question card while its answer goes: "Sending…" or "Starting…" | Sending… | cut | While an answer goes a spinner stands in place of "Sending…" / "Starting…". (Partly applied on the scratch branch: The spinner is in the status line, not on the chosen option: the card does not keep which option was chosen.) | pattern | `src/renderer/src/owner/report/copy.ts:36` |
| P509 | between the report's cards: a folded row for everything the agent did that was not addressed to the owner, with counts after it; three dots while it works | Working record · 12 tool calls · 3 messages | stays | Stays. the folded line above a message to you keeps "Working record · N tool calls · N messages" | brought back | `src/renderer/src/owner/report/copy.ts:11` |
| P510 | the same row once it is open with no divider of its own | Fold to report | cut | The opened record's fold reads "Fold". | pattern | `src/renderer/src/owner/report/copy.ts:12` |

## Panels drawn by plugins

### Plugin pane

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P511 | a right-column tab a plugin opened, before the plugin has drawn anything: two centred lines | Nothing to show yet | cut | An undrawn plugin pane shows one line, "<plugin> has not drawn here yet". | pattern | `src/renderer/src/engine-surface/PaneTool.tsx:23` |
