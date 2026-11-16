# Word cut: Customize

> Part of `docs/doperpowers/specs/2026-11-16-word-cut-design.md`; read that first. This file is written by `render.py` from `items.json` beside it; a decision changes there and in the root document's Decision Log.

81 items: 40 cut, 5 reworded, 36 stay. Of the 45 that change, the owner saw 12 in a picture or ruled on them; 33 follow the pattern and were not seen.

Columns: **Id** is the item's id in `items.json`. **Where** is the place on the surface. **Today** is the text at the pin `2c7044231` (an example value where the text is built from data). **Decision** is `cut` (the text leaves the resting surface), `reword` (it changes) or `stays` (today's text is kept; the row is here so that nobody proposes it again). **After** says what the surface shows afterwards, as it was built on the scratch branch and shown in the pictures. **Basis** is how firm the decision is, in the words of the root document's "How firm each decision is". **Source** is the file and line at the pin.

## Customize, Plugins

### Plugins library, head

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P655 | /plugins dialog only: a bordered button right after the title "Plugins"; it closes the dialog and opens Customize › Plugins › Discover | Open Discover | cut | The /plugins head has no Open Discover button; Discover plugins is the first row of the + menu. | seen | `src/renderer/src/widgets/PluginsWidget.tsx:244` |
| P659 | /plugins dialog and Customize › Plugins tab, and the /skills dialog: first line inside the Show and Sort menus, repeating the tooltip of the icon just pressed. Other: "Sort by" (twice: plugins and skills) | Show | cut | The Show and Sort menus open straight onto their choices, with no repeated first line. | pattern | `src/renderer/src/widgets/plugins/LibraryHeader.tsx:113` |

### Plugins library, session line

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P663 | /plugins dialog and Customize › Plugins tab: after the count on the same line, when the session is running | Loaded now | stays | Stays. skipped: already cut elsewhere on the branch | not a cut | `src/renderer/src/sessions/observed.ts:29` |
| P664 | /plugins dialog and Customize › Plugins tab: after the count, when the session is not running (state: the count is from the last run) | Loaded last time, 2 days ago | cut | Where a session's last loaded list is shown (the session panel's Plugins summary, the plugin detail), it reads "as of 2 days ago" instead of "Loaded last time, 2 days ago". | pattern | `src/renderer/src/sessions/observed.ts:30` |
| P669 | /plugins dialog and Customize › Plugins tab: two accent text buttons at the right end of the line while the session is running | Reload plugins · Reload skills | stays | Stays. brought back on customize-plugins | brought back | `src/renderer/src/widgets/copy.ts:407` |
| P672 | /plugins dialog and Customize › Plugins tab, the /skills dialog, the /reload-plugins dialog and the session panel's Plugins section: the line after a reload finishes. Other: "Reloaded · 31 skills", "Reloaded" | Reloaded · 48 commands · 6 agents · 12 plugins · 0 errors | cut | After a reload the line reads "Reloaded", or "Reloaded · 1 error" when there are errors (skills too). | pattern | `src/renderer/src/widgets/copy.ts:398` |

### Plugins library, list

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P673 | /plugins dialog and Customize › Plugins tab, and the same headings over the skills list (/skills dialog, Customize › Skills): sticky group heads, each with a count. The five are "In this project", "Created by you", "Synced from claude.ai", "From Anthropic & Partners", "From marketplaces you added" | From marketplaces you added | stays | Stays. group heads by where a plugin came from, which the owner brought back (G212) | pattern | `src/renderer/src/widgets/copy.ts:498` |
| P678 | /plugins dialog and Customize › Plugins tab: centre of the list under Show › Loaded in this session when the session has no reading (state), with a bordered button. With no session at all the sentence is "Loaded plugins are unavailable without a running session." | What this session loaded is not observed yet. / Show all plugins | cut | Show › Loaded with nothing observed says "Not known yet" with "Show all" (with no session: "No running session"). | pattern | `src/renderer/src/widgets/copy.ts:513` |

### Plugins library, plugin row

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P683 | /plugins dialog and Customize › Plugins tab: second line of a row whose plugin has no description | 5 skills | reword | A plugin with no description shows "5 skills" as the line under its name only while its row is pointed at or focused, in the row itself. | pattern | `src/renderer/src/widgets/copy.ts:523` |
| P685 | /plugins dialog and Customize › Plugins tab, the plugin detail and the Manage marketplaces rows: tooltip of the three-dots button at a row's end | More actions for superpowers | cut | The three-dots tooltip reads "More" (row, detail, marketplaces); its name keeps "More actions for <name>". | pattern | `src/renderer/src/widgets/copy.ts:524` |

### Plugins library, MAWS mods rows

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P688 | /plugins dialog and Customize › Plugins tab, last group of the list: second line of the mod's row (the app's own description of its to-human mod) | Agents send you messages and ask questions you answer in place. | stays | Stays. skipped: drawn outside the copy files | not a cut | `src/shared/mods/registry.ts:17` |

### Plugin detail page

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P698 | /plugins dialog and Customize › Plugins tab, after pressing a plugin's row: in the line under the plugin's name, where the version would be | Version not reported | cut | No "Version not reported" in the detail's byline. | pattern | `src/renderer/src/widgets/copy.ts:569` |
| P703 | /plugins dialog and Customize › Plugins tab, after pressing a plugin's row: a line under the chips when this installation cannot be changed from here; the same words are the tooltip of the greyed switch and Update. The four: "Synced from claude.ai · change it there", "From your own folder · change it there", "In site · manage it from a session there", "In 3 other projects · manage it from a session there" | Synced from claude.ai · change it there | cut | No line under the chips about where it is changed; it stays the tooltip of the greyed switch and Update. | pattern | `src/renderer/src/widgets/copy.ts:579` |
| P704 | /plugins dialog and Customize › Plugins tab, after pressing a plugin's row, with the chip "N other projects" chosen: end of every row of the list of those installations (each row: project, "only you" for a local one, version) | manage it from a session there | cut | Other-project rows end without "manage it from a session there". | pattern | `src/renderer/src/widgets/copy.ts:578` |
| P706 | /plugins dialog and Customize › Plugins tab, after pressing a plugin's row: the tab and summary name for a plugin's connectors | MCP servers | cut | A plugin's connectors tab and summary are named "Connectors". | seen | `src/renderer/src/widgets/copy.ts:588` |
| P710 | /plugins dialog and Customize › Plugins tab, after pressing a plugin's row, Overview: second fact line when the plugin is on but the running session has not picked it up (state), followed by a "Reload plugins" text button | Not loaded in this session / Reload plugins | cut | That line reads "Not loaded yet" with a "Reload" button. | pattern | `src/renderer/src/widgets/copy.ts:584` |
| P712 | /plugins dialog and Customize › Plugins tab, after pressing a plugin's row, Overview: a heading over a bordered list with one row per kind ("Skills · 5 · a, b, c and 2 more"), each a link to that kind's tab | What’s inside | cut | No "What’s inside" heading over the summary list. | seen | `src/renderer/src/widgets/copy.ts:586` |
| P713 | /plugins dialog and Customize › Plugins tab, after pressing a plugin's row, Overview, in the What’s inside list: a faint sentence under each kind. The seven: "Services and tools Claude can reach.", "Helpers Claude can hand a longer job to.", "Run on their own during a session.", "Keep watch in the background during a session.", "Help Claude read and check code in a language.", "Shortcuts you type with a slash.", "Things Claude can do when you ask." | Helpers Claude can hand a longer job to. | cut | Same as G239: the faint kind sentences are gone. | seen | `src/renderer/src/widgets/copy.ts:590` |

### Plugin change, confirm sheet

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P720 | a sheet over the library after choosing Turn on or off, Update, Uninstall, Install (from Discover), or a marketplace action: the same grey line when nothing will be reloaded. Other: "Nothing to reload: an added marketplace loads no plugin" | No running session to reload | cut | The sheet says nothing when no session will be reloaded (nor for an added marketplace); "Reloads plugins in N running sessions" stays. | pattern | `src/renderer/src/widgets/copy.ts:439` |
| P723 | a sheet over the library after choosing Turn on or off, Update, Uninstall, Install (from Discover), or a marketplace action, inside Details on an install or update: one sentence after the file paths | and the cache directories of any dependencies the marketplace declares, from this or an allowlisted marketplace, each enabled in the settings file above | stays | Stays. kept: consent | not a cut | `src/renderer/src/widgets/copy.ts:433` |
| P724 | a sheet over the library after choosing Turn on or off, Update, Uninstall, Install (from Discover), or a marketplace action: a grey line while the app looks up the engine binary (state), during which the default button is greyed | Resolving the engine… | cut | While the engine is looked up the sheet shows a spinner where the grey line was; the default button stays greyed. (Partly applied on the scratch branch: The spinner is not inside the button: SheetForm (src/renderer/src/sessions/Sheet.tsx) takes a string label.) | pattern | `src/renderer/src/widgets/copy.ts:436` |
| P727 | a sheet over the library after choosing Turn on or off, Update, Uninstall, Install (from Discover), or a marketplace action, install asked from Discover: first line of the body | Installs superpowers from claude-plugins-official | stays | Stays. kept: consent | not a cut | `src/renderer/src/widgets/plugins/catalog-words.ts:8` |
| P729 | a sheet over the library after choosing Turn on or off, Update, Uninstall, Install (from Discover), or a marketplace action, install asked from Discover: a grey line when other sources list the same plugin | Also listed by X, Y | stays | Stays. "Also listed by X, Y" leaves the install sheet; provenance at the moment of installing sits near consent \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/widgets/plugins/catalog-words.ts:6` |

### Plugin change, result line

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P731 | under the row a change was made on (list row, detail, marketplace row, Add marketplace field, a Discover card), after the sheet is confirmed, on success (state): what the app appends after the engine's own message. Parts: "Done" (when the engine says nothing), "Reloaded in 2 sessions", "reflected", "No running session to reload" | Done · 1.4.1 → 1.4.2 · Reloaded in 2 sessions · reflected | cut | Under a changed row only the engine's message and the version change show ("Updated · 1.4.1 → 1.4.2"), plus any session where the reload fell short. | pattern | `src/renderer/src/widgets/copy.ts:447` |

### Reload plugins dialog

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P751 | the /reload-plugins command: a small dialog that reloads at once and then holds one text button and the result line | Reload plugins (title) · /reload-plugins · Reload plugins (button) · Reloaded · 48 commands · ... | cut | /reload-plugins shows a spinner while it reloads, then closes and says "Plugins reloaded" (or the error) as a toast. (Partly applied on the scratch branch: The command still opens its small dialog for the moment the reload runs (a spinner in it); making it a toast-only command would need the composer's widget dispatch (outside widgets/).) | pattern | `src/renderer/src/widgets/ReloadPluginsWidget.tsx:29` |

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G209 | a line under the toolbar while a session runs in the place | 6 plugins loaded in this session · Loaded now · Reload plugins · Reload skills | stays | Stays. brought back on customize-plugins | brought back | `src/renderer/src/widgets/copy.ts:532` |
| G212 | sticky grey heads that part the list by where a plugin came from, each with a count (In this project, Created by you, Synced from claude.ai, From Anthropic & Partners, From marketplaces you added, Other projects) | From Anthropic & Partners 12 | stays | Stays. brought back on customize-plugins | brought back | `src/renderer/src/widgets/copy.ts:502` |
| G213 | under the head "In this project" when it has none | No plugins installed for this project yet. | stays | Stays. empty state under a group head the owner brought back (G212) | pattern | `src/renderer/src/widgets/copy.ts:508` |
| G214 | a badge after a plugin's name, for fourteen days after it was added or updated | New | stays | Stays. brought back on customize-plugins | brought back | `src/renderer/src/widgets/copy.ts:519` |
| G215 | a badge after the name of a plugin that is off | Disabled | cut | Each plugin row ends with an on/off switch (greyed where it cannot be changed here); no Disabled badge, and the row menu has no Turn on/off. | seen | `src/renderer/src/widgets/copy.ts:521` |
| G216 | the second line of every plugin row | by <author> · <the plugin's description> | reword | A plugin row is its name at rest; pointing at it or focusing inside it shows "by <author> · <description>" as a line under the name in the row; no system tooltip. **Open with the owner; see the root document.** | brought back | `src/renderer/src/widgets/copy.ts:522` |
| G217 | a third line on a plugin installed in another project | In <project> · manage it from a session there | cut | A plugin of another project reads "In <project>". | pattern | `src/renderer/src/widgets/copy.ts:529` |
| G218 | the right end of every plugin row | 1.4.2 · 3d ago | reword | Version and date are off the row at rest and appear at the right end of the pointed row's description line ("1.4.2 · 3d ago"). **Open with the owner; see the root document.** | brought back | `src/renderer/src/widgets/plugins/PluginRow.tsx:151` |
| G220 | the page when no plugin is installed: a title and a sentence | Add your first plugins · Give Claude role-level expertise with plugins. Find them in Discover. | stays | Stays. the same empty page the owner brought back for skills (G249): "Add your first plugins" with its line (applied only in part on the scratch branch) | pattern | `src/renderer/src/widgets/copy.ts:509` |
| G211 | the same place when no session runs in the place shown (the usual case on "User configuration") | Loaded plugins are unavailable without a running session. | stays | Stays. the no-session form of the loaded-plugins line the owner brought back (G209); without it the place is blank | pattern | `src/renderer/src/widgets/plugins/session.ts:16` |

### Customize, built-in mods (foot of the Plugins list)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G223 | the head of the last group | MAWS mods · Built in | cut | The mods' head reads "Built in". | pattern | `src/renderer/src/widgets/copy.ts:505` |
| G224 | a badge after each mod's name, under that head | Built in | cut | No "Built in" badge after each mod's name. | pattern | `src/renderer/src/widgets/copy.ts:539` |
| G225 | the second line of each mod: what it does | <the mod's description> | reword | A mod row shows its name and switch at rest; pointing at it or focusing inside it shows its description as a line under the name; opening it shows version and this session's override. | pattern | `src/renderer/src/widgets/plugins/BuiltInMods.tsx:43` |
| G226 | the third line of each mod (four wordings) | MAWS gives the agent its instructions | cut | No "MAWS gives the agent its instructions" line on a mod, closed or open. | pattern | `src/renderer/src/widgets/copy.ts:554` |
| G227 | a fourth line on each mod while a session runs: a label and three choices | This session · Default (On) / On / Off | stays | Stays. a per-session On/Off control goes behind opening the mod's row; a control with a job, hidden \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/widgets/copy.ts:546` |
| G229 | the right end of each mod row, before the switch | Version 3 | cut | A mod's version shows only once its row is opened. | pattern | `src/renderer/src/widgets/copy.ts:542` |

### Customize, a plugin's own page

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G235 | first line of the Overview, under the description | Enabled for this project | cut | No "Enabled for this project" line ("Not enabled for this project" still shows). | seen | `src/renderer/src/widgets/copy.ts:581` |
| G236 | second line of the Overview while a session runs | Loaded in this session · Loaded now | stays | Stays. the loaded-in-this-session line the owner brought back in the list (G209), on the plugin's own page | pattern | `src/renderer/src/widgets/copy.ts:583` |
| G239 | in the Overview's list of what is inside: a grey sentence under each kind (seven wordings) | Skills · 4 · review, plan, ship and 1 more / Things Claude can do when you ask. | cut | No grey sentence under each kind in the Overview list. | seen | `src/renderer/src/widgets/copy.ts:589` |
| G240 | top of the Skills tab of a plugin | Invoke by typing / in chat, or let Claude use them automatically for relevant tasks. | cut | No "Invoke by typing /…" sentence atop a plugin's Skills tab. | pattern | `src/renderer/src/widgets/copy.ts:598` |

### Customize, sheets and dialogs

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G243 | the Add marketplace dialog: a field label, its helper, its placeholder | Source · A GitHub owner/repo, a Git repository URL or a folder on this Mac. · owner/repo, URL or folder | stays | Stays. a field's only words: with label, helper and placeholder all gone the Source field is unnamed on screen | pattern | `src/renderer/src/widgets/copy.ts:618` |
| G245 | the Manage marketplaces dialog: a sentence under its title | Marketplaces added with Claude Code on this computer. Removing one also uninstalls its plugins. | stays | Stays. kept: consent | not a cut | `src/renderer/src/widgets/copy.ts:610` |

## Customize, Discover

### Manage marketplaces dialog

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P739 | the sheet opened from + › Manage marketplaces: in place of the rows when there are none (state) | No marketplaces added yet. | cut | An empty marketplaces sheet says "None yet." | pattern | `src/renderer/src/widgets/copy.ts:611` |
| P740 | the sheet opened from + › Manage marketplaces: faint third line of each marketplace row | 3 plugins installed | cut | A marketplace row's third line reads "3 plugins". | pattern | `src/renderer/src/widgets/copy.ts:612` |

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G266 | the toolbar: a search field | Search all sources | stays | Stays. skipped: the label doubles as the accessible name | not a cut | `src/renderer/src/customize/discover/copy.ts:11` |
| G267 | the toolbar: a word button after the search | Refresh | cut | The Discover toolbar has no Refresh; the Sources popover keeps its own. | pattern | `src/renderer/src/customize/discover/copy.ts:12` |
| G268 | the toolbar: a second word button, which opens the list of sources | updated 3h ago | stays | Stays. the catalog's age leaves the Sources button, which becomes a glyph; ages came back elsewhere (W61) and the Customize pages were "too bare" \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/customize/discover/copy.ts:14` |
| G272 | the caption over the featured item | Featured · From Anthropic | cut | The caption over the featured item reads "Featured". | pattern | `src/renderer/src/customize/discover/copy.ts:30` |
| G275 | every card: a trust word after the publisher (six wordings), with a sentence on hover | Verified / Community / Listed by <vendor> / Added by you | stays | Stays. kept: consent | consent | `src/renderer/src/customize/discover/copy.ts:66` |
| G276 | every card: the foot line | 3 skills · MCP server · hooks · 12.3k installs | stays | Stays. Discover cards lose their contents and install count, the facts used to choose; close to the plugin descriptions the owner wants on pointing (G216); lean changed (show on the pointed card) \| no picture reached it in either round: today's words stay (was leaning changed) | unseen | `src/renderer/src/customize/discover/copy.ts:58` |
| G278 | a card already installed: a check and a word; or a line when it is installed elsewhere | ✓ Installed / Installed in another project | cut | An installed card shows the check alone ("Installed" is its accessible name and tooltip); one installed elsewhere says "In another project" (also on the item's page). | pattern | `src/renderer/src/customize/discover/copy.ts:52` |
| G280 | the top of the Skills catalog | Items whose contents are not known before install are under Plugins. | cut | The Skills catalog has no note about Plugins at its top. | pattern | `src/renderer/src/customize/discover/copy.ts:47` |
| G281 | a notice when the catalog changed while paging | The catalog changed, so the list started again from the top. | cut | When the catalog changes while paging, the list restarts without a notice. | pattern | `src/renderer/src/customize/discover/copy.ts:46` |

## Customize, Skills

### Skills library, head

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P742 | /skills dialog only: a bordered button at the right of the head, after search and sort | Reload skills | stays | Stays. "Reload skills", which the owner brought back with the loaded-plugins line (P669) | pattern | `src/renderer/src/widgets/copy.ts:408` |
| P744 | /skills dialog on a tab whose chat has not started (state): a grey line above the list | On disk for ~/work/site. The chat may load more once it starts. | cut | A new chat's /skills line says "On disk for <folder>". | pattern | `src/renderer/src/widgets/copy.ts:172` |

### Skills library, list

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P746 | /skills dialog only (Customize's list has no such button): a bordered button at the right end of every skill row, and again as the primary button of a skill's detail | Use in chat | cut | Use in chat shows on a skill row only under the pointer or keyboard focus; the detail keeps its button. | pattern | `src/renderer/src/widgets/copy.ts:627` |
| P748 | /skills dialog before the chat starts: the same tooltip while the settings are still being read (state) | Reading Settings › Sessions › Plugins in sessions… | stays | Stays. Use in chat is greyed with no reason while settings are read \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/widgets/copy.ts:630` |

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G247 | the toolbar: search field, a sort icon, and a word button | Search skills · Refresh | cut | The Skills toolbar holds the switcher, search and sort; no Refresh. | seen | `src/renderer/src/customize/CustomizeView.tsx:182` |
| G248 | every skill row: its name and, under it, its description; grouped under the same provenance heads as plugins | <skill> / <the skill's description> | reword | A skill row is its name (and plugin badge) at rest; pointing at it or focusing inside it shows its description as a line under the name in the row; no system tooltip. | pattern | `src/renderer/src/widgets/skills/SkillsLibrary.tsx:88` |
| G249 | the page when there are no skills: a title and two sentences | Add your first skills · Skills teach Claude how you work. Plugins bring them: Customize › Skills › Discover lists the plugins that carry skills. | stays | Stays. brought back on customize-skills | brought back | `src/renderer/src/widgets/copy.ts:631` |

## Customize, page head

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G199 | a word before the select at the right of the tabs | Showing | cut | The project select right of the Customize tabs has no "Showing" before it. | seen | `src/renderer/src/customize/CustomizeView.tsx:94` |
| G200 | the first option of that select | User configuration | stays | Stays. "User configuration" becomes "Yours"; a short form of the kind the owner sometimes rejected ("new", "In use") \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/customize/CustomizeView.tsx:96` |
| G201 | a second labelled select at the right of each tab's toolbar, whenever a session runs in the place shown | Live session · <session title> | stays | Stays. which live session the page reflects is not shown when only one runs \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/customize/CustomizeView.tsx:83` |
| G202 | a two-part switch at the left of each tab's toolbar | My items · Discover | stays | Stays. brought back on customize-plugins, customize-skills, customize-connectors | brought back | `src/renderer/src/widgets/copy.ts:567` |
| G203 | a line at the top of Skills and Connectors while the configuration is read | Reading configuration… | cut | While the configuration is read, Skills and Connectors show a small breathing dot; the words stay for screen readers. (The connector menu outside Customize still reads the words.) | pattern | `src/renderer/src/customize/InventoryState.tsx:5` |
| G205 | a second folded line at the top of Skills and Connectors, shown whenever the read carries its standing caveat | Inventory coverage | cut | The folded "Inventory coverage" line is not drawn. | pattern | `src/renderer/src/customize/InventoryState.tsx:14` |

## Customize, Connectors

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G251 | the heading of the first list, with a word button at the right | Configured on disk · Refresh | stays | Stays. brought back on customize-connectors | brought back | `src/renderer/src/customize/connectors/copy.ts:10` |
| G252 | after every connector's name | user scope · http | stays | Stays. brought back by the owner, though no picture's change list carries it | brought back | `src/renderer/src/customize/connectors/copy.ts:17` |
| G253 | after the scope, on a connector that works (two wordings) | Connected / No sign-in needed | stays | Stays. brought back on customize-connectors | brought back | `src/renderer/src/customize/connectors/copy.ts:50` |
| G254 | the second line of every connector row, in monospace | ~/.claude.json | stays | Stays. brought back by the owner, though no picture's change list carries it | brought back | `src/renderer/src/customize/connectors/ConnectorsSection.tsx:264` |
| G255 | a word button at the end of every connector row | Remove | stays | Stays. brought back by the owner, though no picture's change list carries it | brought back | `src/renderer/src/customize/connectors/copy.ts:15` |
| G256 | on a connector that needs the person: its state and its button | Sign in needed · Sign in | stays | Stays. a connector's state word; the owner brought back status words on connector rows (G253), and an exception keeps its word | pattern | `src/renderer/src/customize/connectors/copy.ts:51` |
| G261 | the list when nothing is configured | No connectors are configured here. | cut | An empty Connectors list says "No connectors yet". | seen | `src/renderer/src/customize/connectors/copy.ts:11` |
| G262 | the heading of the second list, with the Live session select beside it | Live in the attached session | stays | Stays. skipped: a merge of two lists, a redesign | not a cut | `src/renderer/src/customize/connectors/copy.ts:12` |
| G263 | each row of the second list | <connector> · connected · 12 tools · from user · scope user | stays | Stays. brought back on customize-connectors | brought back | `src/renderer/src/widgets/copy.ts:165` |
| G264 | in place of the second list when no session runs in the place shown | Connection state and tools are unavailable without a running session in this project. | stays | Stays. empty state: the live list's place would go blank on the "too bare" Connectors page (T206) | pattern | `src/renderer/src/customize/connectors/copy.ts:13` |
