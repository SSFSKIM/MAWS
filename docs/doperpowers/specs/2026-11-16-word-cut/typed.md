# Word cut: Dialogs opened by typed commands

> Part of `docs/doperpowers/specs/2026-11-16-word-cut-design.md`; read that first. This file is written by `render.py` from `items.json` beside it; a decision changes there and in the root document's Decision Log.

52 items: 43 cut, 0 reworded, 9 stay. Of the 43 that change, the owner saw 14 in a picture or ruled on them; 29 follow the pattern and were not seen.

Columns: **Id** is the item's id in `items.json`. **Where** is the place on the surface. **Today** is the text at the pin `2c7044231` (an example value where the text is built from data). **Decision** is `cut` (the text leaves the resting surface), `reword` (it changes) or `stays` (today's text is kept; the row is here so that nobody proposes it again). **After** says what the surface shows afterwards, as it was built on the scratch branch and shown in the pictures. **Basis** is how firm the decision is, in the words of the root document's "How firm each decision is". **Source** is the file and line at the pin.

## Dialogs from typed commands

### Side question dialog (/btw)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P415 | a dialog that opens from /btw only when the session cannot be asked at once: its title "Side question", then a label over the field | Ask a side question | cut | The side-question dialog has no visible label over its field (kept for screen readers). | pattern | `src/renderer/src/side/copy.ts:109` |
| P416 | in that dialog's field, and in the question field under a side thread | Asked beside the running turn; nothing is added to the conversation | cut | The side-question field's placeholder reads "Ask a quick question…". | pattern | `src/renderer/src/side/copy.ts:110` |

### Permissions dialog (/permissions)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P516 | the dialog's title, top-left | Permissions & rules | cut | The dialog is titled "Permissions". | seen | `src/renderer/src/widgets/copy.ts:19` |
| P580 | first line of the body, above the mode control: the word, the mode in bold, then a quiet tail | Effective Auto · from the init frame | cut | The mode control's checked row is the effective mode; no "Effective Auto · from the init frame" line above it (Session info keeps "Effective Auto" without the tail). | seen | `src/renderer/src/widgets/copy.ts:75` |
| P581 | under the mode line when the session holds approvals given from request cards (state: one or more session grants) | 2 session grants · re-applied after a resume | stays | Stays. how many session grants are in force leaves the /permissions dialog; permission facts sit near consent \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/widgets/copy.ts:82` |
| P582 | a quiet sentence under the mode control; 14 words, always there | The mode applies to this session only; rules are edited in their settings files | cut | The scope sentence is gone: "The mode applies to this session only" is the mode control's tooltip, "Rules are edited in their settings files" a rule source's. | seen | `src/renderer/src/widgets/copy.ts:83` |
| P584 | in place of the rule groups when there are no rules (state: no rules) | No rules · every tool asks as the mode decides | cut | No rules reads "No rules". | pattern | `src/renderer/src/widgets/copy.ts:74` |
| P586 | at the right of every rule row: where the rule comes from; one of seven: this session · grant, startup settings, .claude/settings.json · project, ~/.claude/settings.json · user, .claude/settings.local.json, managed, command line (the same seven label Config's Sources rows) | ~/.claude/settings.json · user | cut | A rule's source is one word (session, startup, project, user, local, managed, command line), the file under the pointer; Config's Sources rows use the same words. | seen | `src/renderer/src/widgets/copy.ts:63` |
| P587 | faint words at the end of the second line of every rule row, after the engine's description; one of three: this session, read-only here, in a settings file | in a settings file | cut | No "in a settings file" at the end of a rule's second line ("this session" and "read-only here" stay). | pattern | `src/renderer/src/widgets/copy.ts:72` |
| P588 | at the right of the first folder under Workspace | original directory | cut | No "original directory" note on the first workspace folder. | seen | `src/renderer/src/widgets/copy.ts:79` |

### Slash-command dialogs, the shared frame

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P517 | top-right of every dialog, in mono beside the close cross; one per dialog (/usage, /config, /mcp, /sandbox ... 16 in all) | /permissions | cut | No /name in mono beside the close cross on any dialog. | seen | `src/renderer/src/widgets/WidgetFrame.tsx:152` |
| P518 | the whole body of a dialog while the engine has not answered yet (state: reading); the same word stands inline in Permissions under the mode control and in Compact where the context line will be | Reading… | cut | A dialog waiting for the engine shows the app's small spinner (also inline in Permissions and Compact). | pattern | `src/renderer/src/widgets/copy.ts:44` |
| P519 | the body of any dialog opened on a session that is not running and has no earlier answer (state: session not running); it stands before the Load now button | Not read yet. | cut | A not-running session's dialog shows only the Load now button. | seen | `src/renderer/src/widgets/copy.ts:49` |
| P521 | above the content of a dialog showing an answer read before the session stopped (state: session not running, earlier answer kept) | Read 5 minutes ago | cut | An earlier answer is dated "5 min ago". | pattern | `src/renderer/src/widgets/copy.ts:52` |
| P522 | beside the age of an earlier answer (state: session not running, earlier answer kept) | Refresh | cut | Refresh beside an earlier answer's age (and on the plugins loaded line) is a circular-arrow glyph with "Refresh" under the pointer. | seen | `src/renderer/src/widgets/copy.ts:51` |
| P523 | in a dialog while its session is being started by Load now or Refresh (state: starting); also the model menu's status line | Starting… | cut | While a session starts, a spinner stands in place of the pressed button (dialogs, loaded line, model menu). | pattern | `src/renderer/src/widgets/copy.ts:53` |
| P525 | an amber line above content that is still shown after a later read failed (state: stale); it follows the error's own words | … · showing the last value it reported | cut | A stale dialog's amber line ends "· last reading shown". | pattern | `src/renderer/src/widgets/copy.ts:46` |

### Toasts after a typed command

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P558 | a toast after /model opus, /effort high, /fast off or /permissions acceptEdits is typed and applied without opening anything; the others: "Effort · High · set · …", "Effort · the model's default · set · …", "Fast mode · off · set · …", "Permission mode · Accept edits" | Model · Opus 5.5 · set · the next init frame confirms it | cut | The toast after a typed /model, /effort or /fast says only the name and new value ("Model · Opus 5.5"). | pattern | `src/renderer/src/widgets/copy.ts:385` |

### Connectors dialog (/mcp)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P559 | muted, beside the title "Connectors" | MCP servers | stays | Stays. the Connectors dialog keeps "MCP servers" beside its title | ruled | `src/renderer/src/widgets/copy.ts:158` |
| P562 | on every connected connector's line, in green after its name; the same word is the row's detail in the message box's + › Connectors menu and in Customize's live list | Connected | stays | Stays. "Connected" on connector rows, which the owner brought back (G253) | pattern | `src/renderer/src/widgets/connector-status.ts:12` |
| P563 | on the line of a connector that needs a sign-in, before its Sign in button (state: needs sign-in) | Sign in needed | stays | Stays. a connector's state word beside its button (status words came back, G253; an exception keeps its word) | pattern | `src/renderer/src/widgets/connector-status.ts:14` |
| P565 | on the line of a connector that is still connecting (state: connecting) | Connecting… | cut | A connecting connector shows the small spinner in the status place in the dialog and Customize's live list. | pattern | `src/renderer/src/widgets/connector-status.ts:18` |
| P570 | under a connector's row after its switch or Reconnect succeeded (state: just done); the three are Done, Reconnected, Applied after all | Done | cut | No "Done" or "Reconnected" under a connector after its switch or Reconnect succeeded; "Applied after all" and failures stay. | pattern | `src/renderer/src/widgets/copy.ts:463` |
| P573 | above the list in the dialog opened on a new chat with nothing sent (state: unstarted tab on this Mac); about 15 words | Configured for {place}. Connection state, and connectors from plugins, show once the chat starts. | cut | A new chat's Connectors dialog says "Configured for <place>". | pattern | `src/renderer/src/widgets/copy.ts:171` |
| P574 | in place of a status on every row of that unstarted list; also the row detail in the + › Connectors menu before the first message | user scope | stays | Stays. a connector's scope, which the owner brought back (G252) | pattern | `src/renderer/src/widgets/McpWidget.tsx:367` |
| P576 | under the list in the dialog of a session that runs in a terminal (state: terminal session); about 15 words | Only servers connected with tools are listed; the terminal’s /mcp shows every server | cut | The terminal session's connectors dialog ends with "Partial list · the terminal’s /mcp shows all". | pattern | `src/renderer/src/widgets/McpDriven.tsx:25` |
| P569 | under a connector's row while its switch or Reconnect is working (state: working); the terminal-session form of the dialog prints the same word | Working… | cut | A connector's switch knob or its Reconnect shows a spinner while working; the terminal form shows a spinner instead of "Working…". | pattern | `src/renderer/src/widgets/copy.ts:271` |

### Context dialog (/context)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P600 | first line of the body; the same line opens the Compact dialog | 48,200 of 200,000 · 24% · autocompact at 160,000 | stays | Stays. the Context dialog keeps "autocompact at N" on its top line | ruled | `src/renderer/src/widgets/copy.ts:117` |
| P602 | small uppercase head over the last group of rows | What loads with every request | cut | The last group's head reads "Every request". | seen | `src/renderer/src/widgets/copy.ts:121` |
| P603 | the rows of that group: Memory files, MCP tools, Agents, Commands, Skills, each with a count and a token figure ("none" when empty) | Skills 14 of 52 · 3,400 tokens | stays | Stays. the Context dialog rows keep the word "tokens" | brought back | `src/renderer/src/widgets/copy.ts:128` |

### Config dialog (/config)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P606 | under Effective when no setting differs from the defaults (state: defaults only) | No settings in effect beyond the defaults | cut | Effective reads "Defaults only" when nothing differs. | pattern | `src/renderer/src/widgets/copy.ts:135` |
| P607 | second line of a Sources row whose file sets nothing (state: empty source) | no keys | cut | A Sources row whose file sets nothing has no second line. | pattern | `src/renderer/src/widgets/copy.ts:138` |
| P608 | text button at the right of a Sources row; it shows the file in Finder (the path is its tooltip) | Open file | cut | The Sources row's button reads "Reveal". | pattern | `src/renderer/src/widgets/copy.ts:146` |
| P609 | third group: four label and value rows (Model, Effort, Advisor, Ultracode; values such as none, on, off) | Applied — Model · Effort · Advisor · Ultracode | cut | The Applied group shows only Advisor and Ultracode. | seen | `src/renderer/src/widgets/copy.ts:141` |

### Sandbox dialog (/sandbox)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P614 | under the reason when policy sets the sandbox (state: locked) | Set by your organization; it cannot be changed here | cut | A policy-locked sandbox says "Set by your organization". | pattern | `src/renderer/src/widgets/copy.ts:197` |
| P615 | at the right of each line under the head "Dependencies" (state: the engine reports dependency problems) | error / warning | stays | Stays. "error" and "warning" become red and amber dots; colour alone, and dots in place of words came back elsewhere (G214) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/widgets/SandboxWidget.tsx:77` |
| P617 | behind Details: three label and value rows that repeat the first read (In your settings on/off, Set by policy yes/no, Unsandboxed fallback allowed/not allowed) | Unsandboxed fallback allowed | cut | Details no longer repeats In your settings, Set by policy or Unsandboxed fallback; Auto-allow, Network and the lists remain. | pattern | `src/renderer/src/widgets/copy.ts:204` |

### Memory dialog (/memory)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P623 | at the right of a memory file that has not been created (state: file missing) | does not exist yet | cut | A missing memory file reads "not created". | seen | `src/renderer/src/widgets/copy.ts:236` |
| P624 | text button at the right of every file and folder row | Reveal | cut | Reveal shows on a memory file or folder row only under the pointer or keyboard focus. | seen | `src/renderer/src/widgets/copy.ts:58` |

### Agents dialog (/agents)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P627 | the body when the session lists no agents (state: none) | No agents in the catalogue | cut | An empty agents list says "No agents". | pattern | `src/renderer/src/widgets/copy.ts:239` |
| P628 | text button at the right of every agent row | Mention | cut | Mention shows on an agent row only under the pointer or keyboard focus. | seen | `src/renderer/src/widgets/copy.ts:239` |

### Compact dialog (/compact)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P629 | small label over the text field | Instructions | cut | No "Instructions" label; the field's placeholder says what it is (its name stays "Instructions"). | pattern | `src/renderer/src/widgets/copy.ts:471` |
| P631 | the filled button under the field | Compact now | cut | The button reads "Compact". | pattern | `src/renderer/src/widgets/copy.ts:473` |
| P633 | a quiet sentence under the button; 15 words, always there | Summarises the conversation for the turns after it; the transcript on disk keeps everything | stays | Stays. kept: consent | not a cut | `src/renderer/src/widgets/copy.ts:478` |

### Rename dialog (/rename)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P635 | small label over the field (the dialog is seen only where the app's own rename sheet is not used) | New title | cut | No "New title" label over the rename field (its name stays). | pattern | `src/renderer/src/widgets/copy.ts:483` |
| P637 | a line under the field after the rename took (state: renamed) | Renamed · {title} | cut | No "Renamed · <title>" line after a rename. | pattern | `src/renderer/src/widgets/copy.ts:485` |

### Export dialog (/export)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P638 | at the end of the preview line under the file name | · 1,240 lines | cut | The preview line ends without the line count. | pattern | `src/renderer/src/widgets/copy.ts:264` |
| P640 | beside the buttons after Copy (state: copied) | Copied | cut | After Copy the button shows a check for a moment; no "Copied" word. | pattern | `src/renderer/src/widgets/copy.ts:259` |

### Changes dialog (/diff)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P643 | first line of the body | 3 files · +42 −7 · working tree | cut | The first line reads "+42 −7", with "· against main" only for a branch comparison. | seen | `src/renderer/src/widgets/copy.ts:244` |
| P647 | the whole body when there is no diff to show (state: not a repository, or a merge is in progress); 15 words | No diff · not a git repository, or a merge, rebase or cherry-pick is in progress | cut | The body says "No diff", with the two reasons under the pointer. | pattern | `src/renderer/src/widgets/copy.ts:243` |

### Rewind dialog (/rewind, or Esc Esc)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P648 | the body when the person has sent nothing yet (state: no messages) | No message of yours to rewind to yet | cut | Rewind with nothing sent says "Nothing to rewind to". | pattern | `src/renderer/src/widgets/copy.ts:342` |
| P650 | a quiet sentence under the segment when file checkpoints are off (state: checkpointing off); the same sentence is also the tooltip of the greyed Files and Both | File checkpointing is off for this session, so its files cannot be rewound | cut | No sentence under the segment when checkpointing is off; it stays the tooltip of the greyed Files and Both. | pattern | `src/renderer/src/widgets/copy.ts:345` |
