# Word cut: Settings

> Part of `docs/doperpowers/specs/2026-11-16-word-cut-design.md`; read that first. This file is written by `render.py` from `items.json` beside it; a decision changes there and in the root document's Decision Log.

115 items: 90 cut, 1 reworded, 24 stay. Of the 91 that change, the owner saw 56 in a picture or ruled on them; 35 follow the pattern and were not seen.

Columns: **Id** is the item's id in `items.json`. **Where** is the place on the surface. **Today** is the text at the pin `2c7044231` (an example value where the text is built from data). **Decision** is `cut` (the text leaves the resting surface), `reword` (it changes) or `stays` (today's text is kept; the row is here so that nobody proposes it again). **After** says what the surface shows afterwards, as it was built on the scratch branch and shown in the pictures. **Basis** is how firm the decision is, in the words of the root document's "How firm each decision is". **Source** is the file and line at the pin.

## Settings, Browser

### Settings, Browser section (words kept here)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T538 | beside an extension's switch while it changes, and a toast when the change failed (the rows are drawn by Settings; representative) | Turning on… | stays | Stays. skipped: drawn outside the copy files | not a cut | `src/renderer/src/tools/browser/import/copy.ts:167` |

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G64 | under the Search engine field | Use %s for the search text | cut | The Search engine row has no note at rest; "Use %s for the search text" shows when the field has focus (or the row is hovered). | seen | `src/renderer/src/settings-tab/copy.ts:329` |
| G67 | label of the fourth row | Links that open a new window | cut | The links row is labelled "New-window links". | seen | `src/renderer/src/settings-tab/copy.ts:332` |
| G68 | the two choices of that row | In MAWS / In the system browser | cut | Its two choices read "In MAWS" / "System browser". | seen | `src/renderer/src/settings-tab/copy.ts:333` |
| G69 | under those choices while "In MAWS" is chosen | In MAWS, such a link opens as a new tab of the same session. | cut | No sentence under the links choices while "In MAWS" is chosen. | seen | `src/renderer/src/settings-tab/copy.ts:334` |
| G70 | fifth row: a label and a text button that say the same thing | Chrome profile · Import a Chrome profile… | cut | The Chrome profile row's button reads "Import…" (its accessible name keeps "Import a Chrome profile…"). | seen | `src/renderer/src/settings-tab/copy.ts:341` |
| G71 | under the import button | A one-time copy of its history, cookies and extensions. Chrome is never changed. | stays | Stays. kept: consent | consent | `src/renderer/src/settings-tab/copy.ts:342` |
| G73 | one row per imported profile, under its name: the date and three or four text buttons | Imported 12 Nov · Show report · Sync bookmarks now · Remove imported profile | cut | An imported profile's row shows "Imported 12 Nov" and a "…" menu holding Show report, Sync bookmarks now and Remove imported profile (Remove in the danger colour); a failed bookmark sync still shows its warning line on the row. | pattern | `src/renderer/src/settings-tab/copy.ts:349` |
| G74 | under an imported profile's row: the import's summary in words | <summary of what was imported> | cut | The import's summary is not under the profile row; Show report (in the menu) holds it. | pattern | `src/renderer/src/settings-tab/copy.ts:345` |
| G76 | a sentence under that heading, once per imported profile | Extension popups can’t see the current tab here, so ad blockers and per-site toggles may not work. | cut | The popup-limit sentence is an ⓘ mark beside the Extensions heading; the sentence is its tooltip and accessible name. | pattern | `src/renderer/src/settings-tab/copy.ts:355` |
| G77 | each extension row: name, version, then a two-part control | On / Off | cut | Each extension row has a switch in place of the On / Off pair. | pattern | `src/renderer/src/settings-tab/copy.ts:356` |

## Settings, Usage

### Usage, account card

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| W177 | right of the account's email | Max · <rate-limit tier> | cut | Right of an account's email: the plan alone ("Max"). | seen | `src/renderer/src/accounts/AccountCard.tsx:24` |
| W178 | chips under the email | 12 requests · 80% cached · 2m ago | cut | An account card has no chips under its email; requests, cache and saved sessions are in the card's tooltip. | seen | `src/renderer/src/accounts/copy.ts:87` |
| W180 | under the limits of the account in use | ✓ Routing here · weekly resets soonest of the usable accounts | stays | Stays. brought back on settings-usage | brought back | `src/renderer/src/accounts/copy.ts:20` |
| W181 | in orange under an account that must sign in again | Needs reauthentication · the relay skips it until it is reconnected; readings are last known | cut | An account that must sign in again says "Sign in again" in orange. | seen | `src/renderer/src/accounts/copy.ts:26` |

### Settings, Usage panel

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P485 | under the "Codex accounts" heading: a sentence, and "No Codex accounts connected." when there are none | Used by GPT models routed through this app. | cut | Under "Codex accounts" there is no sentence. | seen | `src/renderer/src/accounts/copy.ts:65` |
| P488 | foot of the panel, under the relay line | Last 10 min: 42 requests · response start median 1.2 s, p95 3.4 s · no errors | cut | The panel foot shows the relay's last-ten-minutes line only when there was a stall, a connection error, a refusal or an unreachable; healthy, nothing. (Partly applied on the scratch branch: No Details step to reach the healthy line; that needs usage/UsagePanel.tsx.) | pattern | `src/renderer/src/accounts/copy.ts:92` |

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G112 | the panel's own title under the Usage heading, with a time at the right | Claude accounts · updated 12s ago | stays | Stays. skipped: drawn outside the copy files | not a cut | `src/renderer/src/accounts/copy.ts:55` |
| G113 | a sentence under the title | Usage includes all machines. Activity below is from this Mac. | stays | Stays. skipped: drawn outside the copy files | not a cut | `src/renderer/src/accounts/copy.ts:57` |
| G115 | chips on an account card | 3 saved sessions · 12 requests · 80% cached · 2m ago | cut | An account card shows no "3 saved sessions" or serving chips; they are in the card's tooltip. | seen | `src/renderer/src/accounts/copy.ts:31` |
| G116 | text buttons at the foot of every account card | Route requests here · Remove account… | stays | Stays. skipped: drawn outside the copy files | not a cut | `src/renderer/src/accounts/copy.ts:59` |
| G118 | under the cards: a button and a sentence beside it | Add account… · Signs in without changing what this Mac is using. | stays | Stays. kept: consent | consent | `src/renderer/src/accounts/copy.ts:63` |
| G119 | a second block: title, a sentence, and its empty line | Codex accounts · Used by GPT models routed through this app. · No Codex accounts connected. | cut | The Codex block has no sentence under its heading (see P485). (Partly applied on the scratch branch: Hiding the whole block while there are none needs usage/UsagePanel.tsx:146-148; "No Codex accounts connected." stays so the heading is not left alone.) | pattern | `src/renderer/src/accounts/copy.ts:64` |
| G120 | foot of the panel: a greyed, unusable checkbox with its label | Route Claude Code through this app | stays | Stays. skipped: drawn outside the copy files | not a cut | `src/renderer/src/accounts/copy.ts:68` |
| G121 | foot of the panel: the relay line again, and the last-ten-minutes line | ⇄ Relay listening on 127.0.0.1:8641 · checked 12s ago · 3 ms | cut | The Usage panel's foot no longer repeats the relay line and its health line (the Gateway section's Relay row says them); they return only when the relay is in trouble or degraded. | pattern | `src/renderer/src/usage/UsagePanel.tsx:171` |
| G122 | foot of the panel: two text buttons | Refresh · Open ClaudeUsage ↗ | stays | Stays. skipped: a merge, not a cut | not a cut | `src/renderer/src/accounts/copy.ts:6` |
| G124 | under the title while ClaudeUsage has no control route | Routing controls arrive when ClaudeUsage exposes its control route; use ClaudeUsage's own panel for now | cut | Under the title while ClaudeUsage has no control route: "Use ClaudeUsage's own panel to route or remove accounts" (also the disabled actions' hint). | seen | `src/renderer/src/accounts/copy.ts:58` |

## Settings, the page itself

### Settings, index column

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G1 | top of the left index column | Settings | cut | The Settings index has no "Settings" title; it starts at the search field. | seen | `src/renderer/src/settings-tab/copy.ts:25` |
| G3 | group heads in the index, above each run of section names (representative; the other is "Sessions & engine") | App | cut | The index shows no "App" / "Sessions & engine" group headings; a gap still parts the two runs of section names. | seen | `src/renderer/src/settings-tab/copy.ts:31` |
| G5 | last link of the index, under a rule | Customize › | stays | Stays. brought back on settings-appearance | brought back | `src/renderer/src/settings-tab/copy.ts:32` |
| G6 | foot of the index column, always there | Stored in MAWS's own Application Support folder. Nothing here writes into ~/.claude. | stays | Stays. came back with the Customize link on the same line (G5); the owner left the same reassurance cut at G85 ("Terminal sessions and your Claude Code settings files are not changed"), so this one may have ridden along; worth one question | brought back | `src/renderer/src/settings-tab/copy.ts:26` |
| G7 | in place of the page while settings load | Reading settings… | cut | While settings load, the body shows a breathing accent dot (its accessible name keeps "Reading settings…"). | pattern | `src/renderer/src/settings-tab/copy.ts:28` |
| G8 | in the index while a search has no result | No matching settings | cut | A search with no result says "No matches". | pattern | `src/renderer/src/settings-tab/copy.ts:36` |
| G9 | second line of a search result that is a whole section | Section | cut | A search result that is a whole section is one line, its name, with no "Section" under it. | pattern | `src/renderer/src/settings-tab/copy.ts:37` |

### Settings, every section

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G13 | under the control of a row, always visible; this one row stands for the 17 notes whose proposal is the plain one (the sentence waits for hover or focus). Representative: Sessions, Archive sessions inactive for. Notes proposed for something else (remove, keep, another step) have rows of their own below, with this pattern id. | Archived sessions can be restored from the sidebar. | cut | Every row's plain note is gone from the page at rest. Pointing at the row (after a short delay) or moving keyboard focus into it opens the note in the row itself, under the control; the row's accessible description carries it at all times. State lines and the lines the owner kept (Chrome import, Hooks, Stop all, Run direct, Stateful servers) stay in the page. | seen | `src/renderer/src/settings-tab/copy.ts:78` |
| G14 | a word-button at the end of the note line of twenty rows; pressing it opens a second sentence in place. This row stands for the 15 whose second sentence simply waits with the first; the 5 whose second sentence I would treat differently have rows of their own. | More | cut | No "More" button anywhere: the second sentence shows in the same row note, after the first. | seen | `src/renderer/src/settings-tab/copy.ts:43` |
| G15 | the same word-button once its note is open (one row for all twenty) | Less | cut | No "Less" button: the note closes when the pointer and the focus leave the row. | pattern | `src/renderer/src/settings-tab/copy.ts:43` |

## Settings, Appearance

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G19 | grey words to the right of the Theme choices | native chrome follows | cut | The Theme row shows only the Light / Dark / System choice, without "native chrome follows". | seen | `src/renderer/src/settings-tab/copy.ts:278` |
| G22 | under the Transcript width choices | Maximum width of the transcript and composer columns | cut | The Transcript width row has no note under it. | seen | `src/renderer/src/settings-tab/copy.ts:285` |
| G24 | inside the empty font field | the default stack (SF Mono) | cut | The empty font field's placeholder reads "SF Mono". | seen | `src/renderer/src/settings-tab/copy.ts:280` |

## Settings, Notifications

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G26 | first row: the label at the left and, beside the switch, a second name for the same thing | Messages to you · To-human | cut | The first Notifications row is "Messages to you" and its switch alone; "To-human" stays as the switch's accessible name only. | seen | `src/renderer/src/settings-tab/copy.ts:309` |
| G27 | behind More on the Messages to you row | The view follows at once; the instructions, the next time each session starts. | reword | Pointing at the "Messages to you" row opens its note with both sentences, the second "The view follows at once; the instructions, the next time each session starts."; no chip after a flip. | ruled | `src/renderer/src/settings-tab/copy.ts:311` |
| G28 | second row: the label at the left and, beside the switch, a sentence | When a session finishes or needs you · Notify when I am not looking at that session | cut | The second Notifications row is labelled "Notify me" with the switch alone (the old sentence is the switch's accessible name). | seen | `src/renderer/src/settings-tab/copy.ts:291` |
| G29 | a chip after the notify switch, once macOS has delivered one | macOS: allowed | stays | Stays. "macOS: allowed" goes; a passing status like Connected (brought back, G253) or a normal-state word like Idle (left cut) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/settings-tab/copy.ts:293` |
| G30 | the same chip when macOS did not deliver | macOS: not delivered · MAWS falls back to a dock bounce and a toast | cut | When macOS did not deliver, the chip reads "Blocked in macOS"; the fallback explanation is its tooltip. | pattern | `src/renderer/src/settings-tab/copy.ts:293` |
| G33 | grey words after the approvals checkbox | · permission requests, dialogs and MCP elicitations | cut | The approvals checkbox reads just "approvals"; "permission requests, dialogs and MCP elicitations" is its tooltip. | seen | `src/renderer/src/settings-tab/copy.ts:314` |
| G34 | an eighth checkbox, greyed and unusable, with its reason | held peer messages · Never notifies in this version | cut | The greyed "held peer messages · Never notifies in this version" checkbox is not drawn. | seen | `src/renderer/src/settings-tab/copy.ts:301` |
| G35 | fourth row: label, switch, and a word after the switch | Sound · on | cut | The Sound row is the label and its switch, with no "on"/"off" word. | seen | `src/renderer/src/settings-tab/copy.ts:317` |

## Settings, Keyboard

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G36 | grey sentence beside the Keyboard heading | ⇧Tab cycles permission mode as in the terminal | cut | The Keyboard heading stands alone, without the ⇧Tab sentence. | seen | `src/renderer/src/settings-tab/copy.ts:216` |
| G39 | the last cell of every rebindable row | Change | cut | "Change" on a key row is invisible until the row is hovered or the button has keyboard focus (pressing it still starts recording). | seen | `src/renderer/src/settings-tab/copy.ts:217` |
| G40 | in the key cap of an action with no shortcut | Unbound | cut | An action with no shortcut shows an empty dashed key cap (its accessible name and tooltip say "Unbound"); the same on Voice's Shortcut row. | seen | `src/renderer/src/settings-tab/copy.ts:220` |
| G44 | a text button under the table, greyed when nothing was changed | Reset to defaults | cut | "Reset to defaults" is drawn only once some binding differs from its default. | pattern | `src/renderer/src/settings-tab/copy.ts:226` |

## Settings, Voice

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G47 | text button after the key cap on the Shortcut row | Change in Keyboard | cut | The Voice Shortcut row's button reads "Change" (it still jumps to Keyboard). | seen | `src/renderer/src/settings-tab/copy.ts:239` |
| G50 | third row: a label and the helper program's path | Helper · Found at ~/Library/…/maws-voice-helper | cut | The Helper row is drawn only when the helper is missing or failed to start (or the probe failed). | pattern | `src/renderer/src/settings-tab/copy.ts:249` |
| G52 | fourth and fifth rows: the two macOS permissions, each a label and one word | Microphone · Allowed | stays | Stays. the Microphone and Speech rows vanish once allowed; a passing status like Connected (brought back) or a normal-state word (left cut) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/settings-tab/copy.ts:256` |
| G53 | a permission row before macOS has asked | Not asked yet · macOS asks the first time you dictate | cut | A permission macOS has not asked about reads "Not asked yet". | pattern | `src/renderer/src/settings-tab/copy.ts:260` |
| G55 | a permission or recognition row before the helper has answered | Unknown until the helper answers | cut | A permission the helper has not answered for reads "Unknown". | seen | `src/renderer/src/settings-tab/copy.ts:264` |
| G56 | sixth row: a label and where recognition runs | Recognition · On this Mac | cut | The Recognition row is drawn only when the chosen language has no on-device model. | seen | `src/renderer/src/settings-tab/copy.ts:269` |
| G58 | in four rows while the probe has not answered | Reading… | stays | Stays. while the probe reads, the Voice rows are not drawn at all; the owner's blank-reads-as-failed note bears on it (applied only in part on the scratch branch) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/settings-tab/copy.ts:255` |

## Settings, Artifacts

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G79 | text button after the field while it is empty | Use <account name> | cut | The Export author row has no "Use <account name>" button (the placeholder still shows the name a blank field uses). | seen | `src/renderer/src/settings-tab/copy.ts:369` |
| G83 | third row when there are no Spaces: a label with only a sentence | By Space · No Spaces yet. A Space can have its own default design system. | stays | Stays. brought back on settings-artifacts | brought back | `src/renderer/src/settings-tab/copy.ts:379` |

## Settings, Sessions and engine

### Settings, Sessions

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G85 | a sentence under the Sessions heading | For sessions MAWS runs. Terminal sessions and your Claude Code settings files are not changed. | cut | The line under the Sessions heading reads "For sessions MAWS runs." | seen | `src/renderer/src/settings-tab/copy.ts:70` |
| G87 | under the plugin list | Switch a plugin off to keep it out of the sessions MAWS runs. | cut | No line under the plugin list; its "More" sentence waits in the hover card. | seen | `src/renderer/src/settings-tab/copy.ts:84` |
| G91 | under the Hooks choices, whatever is chosen | None turns off every hook in the sessions MAWS runs, the to-human plugin's included. | stays | Stays. kept: consent | consent | `src/renderer/src/settings-tab/copy.ts:89` |
| G96 | under the Subagent model field | The model subagents use in new sessions; empty inherits. | cut | No line under the Subagent model field; the CLAUDE_CODE_SUBAGENT_MODEL sentence waits in the hover card. | seen | `src/renderer/src/settings-tab/copy.ts:73` |
| G98 | label of the sixth row, a select: Never, 7 days, 14 days, 30 days | Archive sessions inactive for | cut | The archive row is labelled "Archive after". | seen | `src/renderer/src/settings-tab/copy.ts:77` |

### Settings, Gateway

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G101 | grey text to the right of the route choices, the same on every machine | 127.0.0.1:8641 | cut | No 127.0.0.1:8641 beside the route choices. | seen | `src/renderer/src/settings-tab/GatewaySection.tsx:31` |
| G102 | under the route choices | New sessions start on this route. | cut | No "New sessions start on this route." line; the Session info / Machine's own explanation waits in the hover card. | seen | `src/renderer/src/settings-tab/copy.ts:192` |
| G104 | label of the second row, a select: Ask each time, Wait for the relay, Run direct | Relay unreachable at launch | cut | The second Gateway row is labelled "If the relay is down". | seen | `src/renderer/src/settings-tab/copy.ts:197` |
| G106 | third row: the label at the left and, beside the switch, a sentence | Per-session Direct · Offer "Switch to Direct…" in Session info | cut | The third Gateway row is labelled "Switch to Direct in Session info" with the switch alone. | seen | `src/renderer/src/settings-tab/copy.ts:200` |
| G107 | fourth row, a readout: label and the engine's login, or a sentence when none is known | Direct login · unknown until a Direct session runs | cut | An unknown Direct login reads "Unknown". | seen | `src/renderer/src/settings-tab/copy.ts:205` |
| G108 | under the Direct login readout: a note, then an instruction with a Copy button | Only Direct sessions use it. Sign in: run claude /login in a terminal · Copy | cut | Under the Direct login readout: just `claude /login` in mono and Copy; the token sentence waits in the hover card. | seen | `src/renderer/src/settings-tab/copy.ts:206` |
| G109 | fifth row, a readout: label, the relay's state in a sentence, and a text button | Relay · Relay listening on 127.0.0.1:8641 · checked 12s ago · 3 ms · Open ClaudeUsage | cut | Settings › Gateway's Relay row reads only its address ("127.0.0.1:8641") and Open ClaudeUsage; when it was checked and the latency are its tooltip. The Usage panel's foot also shows the address only. (Partly applied on the scratch branch: Reads disagreed; P487 (remove the healthy line on the Usage panel) needs usage/UsagePanel.tsx:171, outside this part.) | seen | `src/renderer/src/accounts/copy.ts:35` |

### Settings, Engine

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G125 | first row: label, the binary's full path, a version chip, a text button | Binary · ~/.local/bin/claude · 2.1.4 · Change… | cut | The Binary row shows the version chip, Change… and Update…; the binary's path is the chip's tooltip and is in the row's hover card. | seen | `src/renderer/src/settings-tab/copy.ts:47` |
| G126 | second row: a label and a text button that say the same thing | Update · Update Claude Code… | cut | No separate Update row: an "Update…" button sits on the Binary row beside Change… (accessible name "Update Claude Code…"). | seen | `src/renderer/src/settings-tab/copy.ts:56` |
| G127 | under the Update button | Runs claude update in a terminal tab. | cut | "Runs claude update in a terminal tab." is the Update… button's tooltip. | seen | `src/renderer/src/settings-tab/copy.ts:59` |
| G128 | third row, a readout: label, a path, a chip | Config home · ~/.claude · read-only to MAWS | cut | No Config home row: "Config home · ~/.claude · read-only to MAWS" shows in the Binary row's hover card. | seen | `src/renderer/src/settings-tab/copy.ts:62` |

### Settings, Supervisor

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G129 | first row, a readout: label and a status sentence | Status · Running since 14:02 · pid 4312 · 3 sessions · exits 30 min after the last session ends | cut | Supervisor Status reads "Running · 3 sessions"; the start time, pid, exit rule (and the machine daemon) are its tooltip. | seen | `src/renderer/src/settings-tab/copy.ts:147` |
| G130 | under the Status readout | Sessions run in this background process, so they can keep running after MAWS quits. | cut | No sentence under Status; "Sessions run in this background process…" is the Supervisor heading's tooltip. | seen | `src/renderer/src/settings-tab/copy.ts:159` |
| G133 | second row, a readout | Machine daemon · At login · pid 512 · machine s | cut | The Machine daemon row is drawn only while the daemon is not connected; otherwise its line is in the Status tooltip. | seen | `src/renderer/src/settings-tab/copy.ts:181` |
| G135 | under the Exit when idle field | With MAWS closed, the supervisor exits 30 min after its last session ends. | cut | No "With MAWS closed, the supervisor exits …" line under Exit when idle; its second sentence waits in the hover card. | seen | `src/renderer/src/settings-tab/copy.ts:168` |
| G136 | fourth row: a label and a text button that say the same thing | Stop all · Stop all sessions and the supervisor… | cut | The Stop all row is one button, "Stop all sessions…", with no visible label (the label stays its accessible name). | seen | `src/renderer/src/settings-tab/copy.ts:172` |
| G137 | under the Stop all button | Every session stops; Send resumes each from its transcript. | stays | Stays. kept: consent | consent | `src/renderer/src/settings-tab/copy.ts:174` |
| G139 | fifth row: the label at the left and, beside the switch, a sentence | Memory budget · Release idle sessions to stay under a memory limit | cut | The memory budget row is labelled "Release idle sessions over a memory limit" with the switch alone. | seen | `src/renderer/src/settings-tab/copy.ts:116` |
| G140 | under the Memory budget switch while it is off | Off: an engine process ends only on archive, quit or stop. | cut | No "Off: an engine process ends only…" line under the switch. | pattern | `src/renderer/src/settings-tab/copy.ts:118` |
| G142 | under the Limit field | Default: 25% of physical memory (8.0 GB). | cut | No "Default: 25% of physical memory (8.0 GB)." line under Limit (the field's placeholder still shows the size). | seen | `src/renderer/src/settings-tab/copy.ts:125` |

## Settings, Org

### Settings, Org (not signed in to an org)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G147 | the last section of Settings on a Mac that is in no org: a label with a sentence, then a code field with a button and a note | Org · This Mac isn’t signed in to an org. | cut | The Org section on a Mac in no org reads "Org · Not signed in · Sign in…". | seen | `src/renderer/src/settings-tab/copy.ts:395` |
| G148 | second row: label, an empty code field, a text button | Pairing code · Sign in | cut | The Pairing code row appears only after pressing Sign in… (or while a sign-in is pending or refused). | seen | `src/renderer/src/settings-tab/copy.ts:396` |
| G149 | under the code field | Get one from a device already in the org: an admin pairs it from their Org page (Pair a device), or deployment admin pair --class native-mac. | cut | The "Get one from a device already in the org…" note comes with the code field, behind Sign in…. | seen | `src/renderer/src/settings-tab/copy.ts:397` |
| G153 | in place of the section while the org is read, or when the read failed (two wordings) | Reading the org… | cut | While the org is read, the section shows a breathing dot; a failed read keeps its words. | pattern | `src/renderer/src/settings-tab/copy.ts:391` |

### Settings, Org page (signed in)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G156 | You: second row, a device id and a fingerprint | This Mac · a1b2c3d4 · fingerprint XXXX-XXXX | cut | The This Mac row shows only a disclosure chevron (and the "signs" chip); opening it shows the device id and fingerprint. | pattern | `src/renderer/src/settings-tab/copy.ts:408` |
| G157 | You: third row while everything is in order | Hub · Connected | stays | Stays. "Connected", the status the owner brought back for connectors (G253, P60); here for the hub | pattern | `src/renderer/src/settings-tab/copy.ts:411` |
| G159 | You: fourth row when there are none | Your other devices · None | stays | Stays. a settings row that says there are none, like "By Space · No Spaces yet" the owner brought back (G83) | pattern | `src/renderer/src/settings-tab/copy.ts:537` |
| G160 | every device line, on You and under each person: an 8-character id, its kind, and chips | a1b2c3d4 · Mac · root · this Mac | cut | A device line reads "Mac · root · this Mac"; the 8-character id is the kind's tooltip. | pattern | `src/renderer/src/settings-tab/org/parts.tsx:127` |
| G162 | People: text buttons on every person's row, for someone who may sign changes | Make admin… · Change email… · Remove person… | cut | A person's Make admin… / Change email… / Remove person… sit in one "…" menu on their row. | pattern | `src/renderer/src/settings-tab/copy.ts:549` |
| G163 | People: text buttons on every device line | Remove device… · Make a root… | cut | A device's Make a root… / Remove device… sit in one "…" menu on the device line. | pattern | `src/renderer/src/settings-tab/copy.ts:554` |
| G165 | People: a sentence under every other person who already has a device | Their next device is paired from one of their own devices, a flow not built yet. | cut | No "Their next device is paired from one of their own devices…" sentence under other people. | pattern | `src/renderer/src/settings-tab/copy.ts:559` |
| G166 | People: the same place for a person whose device signs | They pair their next device from their own Org page. | cut | No "They pair their next device from their own Org page." sentence. | pattern | `src/renderer/src/settings-tab/copy.ts:560` |
| G170 | People: foot of the list for someone who may not sign (the Machines and Delegations groups say the same in three more wordings) | Only a root signs org changes. The roots are <email> and <email>. | cut | For someone who may not sign, one line at the top of the Org page: "View only: <email> and <email> sign changes"; the People foot, the Enroll row and the New delegation row no longer say it in their own words. | pattern | `src/renderer/src/settings-tab/copy.ts:546` |
| G171 | Machines: every machine's row: name, state, chip, owners, key | <machine> · Up · this Mac · Owned by you and Kim · key 9f3a… | cut | A machine row reads "<machine> · • · this Mac · Owned by you and Kim": a green dot for Up (an offline machine keeps its word), the key behind a disclosure chevron. | pattern | `src/renderer/src/settings-tab/copy.ts:563` |
| G173 | Machines: text buttons on every machine's row | Grant… · Owners… · Re-enroll… · Drop… | cut | A machine's Grant… / Owners… / Re-enroll… / Drop… sit in one "…" menu on its row. | pattern | `src/renderer/src/settings-tab/copy.ts:572` |
| G174 | Machines: under a machine, one line per person granted rights | <person> · spawn, shell and machine-admin | cut | A grant line names rights in the page's words: "sessions, terminal, connectors". | pattern | `src/renderer/src/settings-tab/org/MachineRow.tsx:162` |
| G175 | Machines: under a machine nobody was granted rights on (two wordings) | Only its owners have rights on it, and they hold every one. | cut | No line under a machine nobody was granted rights on (neither wording). | pattern | `src/renderer/src/settings-tab/copy.ts:593` |
| G176 | Machines: under a machine certified through a delegation | Certified through delegation dc-: its owners are the delegation’s, and change with it. | cut | A delegation-certified machine says "Via delegation dc-". | pattern | `src/renderer/src/settings-tab/copy.ts:571` |
| G178 | Machines: last row, a label and a button that say the same thing | Enroll a machine · Enroll a machine… | cut | The Machines group ends with one "Enroll a machine…" button and no label. | pattern | `src/renderer/src/settings-tab/copy.ts:576` |
| G180 | Org group: four readout rows of identifiers | Org · <org id> / Roots · <key id> · <email> · device a1b2c3d4 (Mac) / Recovery key · <key id> | cut | The Org group's org id, roots and recovery key are behind a Details chevron beside the Org group heading. | pattern | `src/renderer/src/settings-tab/copy.ts:619` |
| G181 | Org group: the org state's age, and a note under it | Org state · Version 12 · 3 days old | stays | Stays. skipped: its note is consent wording | not a cut | `src/renderer/src/settings-tab/copy.ts:419` |
| G182 | Org group: under the Org state row | Machines stop taking requests once the org state is 30 days old. | stays | Stays. kept: consent | consent | `src/renderer/src/settings-tab/copy.ts:421` |
| G183 | Org group: the signer row on a Mac that signs | Signer · This Mac signs the org state. | cut | A root Mac's Signer row is gone; This Mac carries a "signs" chip. The Signer row still appears for the weekly re-sign, an outcome, or a Mac that is not a root. | pattern | `src/renderer/src/settings-tab/copy.ts:451` |
| G186 | Org group, Delegations: a delegation's row: prefix, expiry, uses, id, buttons, certified machines | dc- · expires in 23 days · used 2 of 10 · id 1a2b3c4d · Renew… · Drop… / Certified: dc-1 (live), dc-2 (retired) | stays | Stays. a delegation's Renew and Drop go behind opening the row; the owner brought back a connector's Remove that waited for the pointer (G255) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/settings-tab/copy.ts:800` |
| G187 | Org group, Delegations: when there are none, and the row that makes one (label and button the same words) | No delegations yet. / New delegation · Create a delegation… | cut | No "No delegations yet." line; the row that makes one is one "New delegation…" button with no label. | pattern | `src/renderer/src/settings-tab/copy.ts:884` |
| G188 | Org group, Delegations: the Code destination row: label, three small labelled fields, Save, and a note | Code destination · Project / Secret / Account · Save | cut | The Code destination form is behind a chevron beside the Delegations heading; it stays in view while the destination is unset or damaged, since nothing can be created without it. | pattern | `src/renderer/src/settings-tab/copy.ts:895` |
| G189 | Org group, Delegations: under the Code destination fields | A new delegation’s provisioning code is stored there as a new version of the Secret Manager secret, through this Mac’s gcloud signed in as the account. Devcloud’s next VM reads the latest version. | cut | The destination note comes with the form, behind the same chevron. | pattern | `src/renderer/src/settings-tab/copy.ts:896` |

### Settings, Org sheets (change, pair, enroll, grant, delegation)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G194 | the pairing sheet, beside Approve… | Once Touch ID is given and the signed state is kept, cancelling no longer withdraws it: it settles like any pending state, and Discard (Org › Pending) is the way back. | stays | Stays. kept: consent | consent | `src/renderer/src/settings-tab/copy.ts:669` |
| G196 | the create-delegation sheet: a note under each field and three sentences before Create… | The hub mints its key, Touch ID signs the delegation, then its code is stored. | stays | Stays. kept: consent | consent | `src/renderer/src/settings-tab/copy.ts:930` |
