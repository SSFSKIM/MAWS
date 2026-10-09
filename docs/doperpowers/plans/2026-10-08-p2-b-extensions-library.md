# P2-B — Extensions library: execution document

> **Parent:** `docs/doperpowers/plans/2026-10-08-p2-daily-driver.md` (the P2 composite spec), child id **`P2-B`**, parent pin git blob `3df342b90afe4b41358bc38980cfd07d22223215` (master bba95867). Interface ledger `docs/doperpowers/plans/2026-10-08-p2-interface-ledger.md`, pinned as blob `ab381a34b8830c50d99835b1c2cdeab524e9805f`. Root spec: `docs/charter.md`. Sibling read for what B inherits: P2-A's execution document `docs/doperpowers/plans/2026-10-08-p2-a-sessions-available.md` (§5.5, §5.6, §5.7, §7, §10 Q2) as merged at d3de8868. The design this child inherits lives in the parent's §4.8 and its section "P2-B" and is cited, never restated; this document carries the residue design those leave open, the constraints, the milestones and the record. Authored 2026-10-09 by P2-B's author (an author pass: no implementation).

## 1. Purpose

Today `/plugins` is a 560 px dialog of four stacked sections (Installed, Marketplaces, Available, Loaded) that prints one row per installation record: on the owner's machine 130 rows for 29 plugins, with absolute project paths, "unknown" versions and three competing buttons on every row. `/skills` is an undifferentiated list of slash names with Use links. The owner chose Claude Desktop's plugin library as the composition to port, as it is (consolidated plan §3.B; report E §1). After this child:

- `/plugins` opens a library-sized centred dialog, Desktop's composition: "My items" and "Browse" beside the title, then search, filter, sort and an Add menu. My items lists each plugin once, under "In this project", "From Anthropic & Partners" or "From marketplaces you added", with its display name, author, description and date. Selecting one opens its detail: what it is, who made it, its version and source, the scopes it is installed at as chips, the enable control for the selected scope, Update, Uninstall behind E8's confirmation, whether it is enabled for this project and whether it is loaded in this session (with when that was observed), and what is inside it (commands, skills, agents, hooks, MCP servers), read from the installed files without running any of them.
- Browse shows what the engine's configured sources offer, one card per plugin, truthfully marked installed or not, with an install count only where the engine supplies one.
- The Add menu holds Add marketplace and Manage marketplaces; the latter is Desktop's sheet, where removing a marketplace says it uninstalls its plugins.
- `/skills` is the same kind of library: grouped rows with the plugin a skill comes from, "Use in chat" as the primary action, Reload kept.
- `/sandbox` keeps telling the truth and offers no toggle.
- When P2-C's built-in to-human mod exists, My items lists it under "MAWS mods · Built in" with its switch.

Every change still runs the engine's own CLI after E8's confirm sheet; MAWS writes nothing under `~/.claude`.

How to see it working: open a session, type `/plugins` (a wide dialog opens; My items lists each plugin once, grouped); select a plugin (its detail shows the scope chips, "Enabled for this project", "Loaded in this session · Loaded now" or "Loaded last time, 2 days ago", and What's inside); switch to Browse (cards from the configured marketplaces, installed ones marked); open Add › Manage marketplaces (the sheet); type `/skills` (the skills library replaces the plugins one; "Use in chat" puts `/<skill> ` into the composer). §6.3 gives the exact runs.

## 2. Progress

- [x] (2026-10-09 07:10Z) Grounding read: the parent §1 to §9 and Decision Log 12 and 17, the ledger, A's document §5.5 to §5.7, §7, §10, seed B, owner report E, the consolidated plan §3.B and §4, review 1 findings 5, 6 and 14, E8's document, and the code named in §5.
- [x] (2026-10-09 07:41Z) **M1 — U3 run** (read-only inspection of the owner's `~/.claude/plugins/`, then the CLI and one no-prompt stream-json run under a scratch home on the installed 2.1.295): `installCount` is populated for `claude-plugins-official` only; findings `spikes/protocol-probe/findings-pass3-p2-b-u3.txt` (b24e5382), owner files identical.
- [x] (2026-10-09) Residue design written (§5), with Claude Desktop's composition read from its shipped source.
- [ ] Adversarial review round of this document (Opus) and its verification.
- [ ] M2 — the data and the manifest service (host, shared).
- [ ] M3 — the library shell and My items.
- [ ] M4 — the detail.
- [ ] M5 — Browse, Add marketplace, Manage marketplaces.
- [ ] M6 — `/skills`, `/sandbox`, the built-in section, the acceptance run.

## 3. Inheritance (pre-landed design; not re-litigated)

Binding, from the parent: **§4.8** (library dialogs): widgets gain a second size, library, for `/plugins` and `/skills`, still centred over the window, still one open widget with focus returning to the composer, charter §5.4 standing; the F2a copy rule (no provenance footers; the person's words); the sizes are advisory. The section **"P2-B"** (§5): purpose, G1 to G8 and the E8 regressions (the mutation sheets, the automatic reload after a mutation, the live `e2e:plugins-live` cases keep passing), edges (blocked-by nothing; C.G7's entry in B's section or the old widget, whichever lands second adapting; B owns `PluginsWidget.tsx`, `SkillsWidget.tsx`, `SandboxWidget.tsx`, A edits none of them; "Loaded now" conditional on A.G2, reading X17 only), contracts (owns X19; hosts X20; extends `schema/plugins.ts` and `cli-result.ts` additively with `installedAt`, `lastUpdated`, `source`, `installCount`; one host read `plugins.manifest`). Contracts §6: **X19** (owner B: `size: 'utility' | 'library'` on the slash widget, consumer D), **X20** (owner C; B lists `mods.list`'s rows, hidden while empty), **X17** (A's observed facts, through `useLoadedPlugins`), **X16** (A's acquisition, through `useLoadedPlugins().refresh` and `WidgetFrame`'s states), **X15** (a settings version only if the library keeps a preference). The owner's consolidated plan §4 decision 5 (Browse from the engine's configured sources only; sandbox toggles deferred to a separate decision on writing settings) and §3.B ("Desktop's composition as-is"). Decision Log 12 (a second widget size, not a new dialog host) and 17 (A's answers: one dated hunk in `PluginsWidget.tsx`'s Loaded section if A lands first, which this rewrite absorbs). The standing rules: the engine is never patched (D-1); MAWS never writes under `~/.claude` or `~/.claude.json` (E8: every change runs the engine's CLI after a confirm sheet, D-1 to D-21 of E8's document stand). Advisory: report E §4.1 (the element-to-data mapping) and §4.2 (the matrix); Claude Desktop 2.16120.0's plugin library as the composition (§5 cites it).

From P2-A (resolved in the ledger, §1): `useLoadedPlugins(appSessionId) → {plugins, errors, warnings, freshness, refresh()}` and `Freshness` (`src/renderer/src/sessions/observed.ts`); `ReadState`'s `dormant | starting | unavailable` and `WidgetFrame` owning them for every widget from its `appSessionId`; `session.acquire` reached only through `refresh` and `WidgetFrame`'s Load now; `SessionDigest.availability`; `EngineSessionStatus.pluginsObservedAt`. U1's verdict (A §5.7, branch Y): `reload_plugins` answers before any turn, so `refresh()` is acquire then `reload_plugins`.

## 4. Acceptance (observable; refines G1 to G8)

Each item names the gate it proves. "The scratch home" is a `CLAUDE_CONFIG_DIR` under `/tmp` built as §6.3 says; "the stub" is E8's CLI stub (`test/support/plugin-cli-script.js`) as M2 extends it.

1. **(G1, X19)** `/plugins` opens a dialog centred over the window, `min(960px, 100vw − 48px)` wide and `min(85vh, 720px)` tall whatever its content, with "Plugins" and a "My items | Browse" switch at the left of its header and, at the right, Search, Filter, Sort and Add (Add marketplace, Manage marketplaces). Esc closes it and the composer has the keyboard; `/skills` typed while it is open replaces it (one open widget); every other widget, `/sandbox` included, opens at 560 px as today.
2. **(G2)** On the stub's owner-shaped registry (29 plugin ids, 130 installation records over 50 projects, 10 of them "unknown" versions), My items shows one row per plugin relevant here (installed for the user or for this session's project), grouped "In this project", "From Anthropic & Partners", "From marketplaces you added" in that order, an empty group hidden; a row shows the plugin's display name, its author when the manifest names one, its description when the manifest has one, and its date ("Updated Oct 3" or "Added Sep 30"); no row shows a version, an absolute path or the word "unknown"; a plugin not enabled for this project carries "Disabled". A plugin installed only for other projects is absent until Filter › "Other projects" is chosen, and then it is read-only.
3. **(G3)** Selecting a row opens its detail in place of the list (Back returns to the list with its search and scroll): icon tile, display name, author, version ("Version not reported" when the engine has none), source (the marketplace), the scopes it is installed at as chips ("User", "This project", "This project · only you", "2 other projects"), the enable switch for the selected chip's scope (its sheet is E8's, scope preselected), Update in the header, Uninstall in the overflow behind E8's destructive sheet; the facts "Enabled for this project" or "Not enabled for this project" and, from A's `useLoadedPlugins`, "Loaded in this session" with its freshness ("Loaded now", "Loaded last time, 2 days ago", "Not observed yet") or "Not loaded in this session"; and What's inside with Commands, Skills, Agents, Hooks and MCP servers (counts, names and descriptions; empty kinds hidden), read by `plugins.manifest`. No hook or MCP command line, environment value, header value or URL query is shown anywhere.
4. **(G4)** Browse (read on the click that opens it, never on opening `/plugins`) shows one card per plugin across the engine's configured sources (the built-in directory and every added marketplace), a plugin listed by both the directory and an Anthropic marketplace folded into one card; installed plugins carry "Installed" instead of Install; on the scratch home with `claude-plugins-official` added, its cards read "1.3M installs" style counts and the directory's and third-party cards read none.
5. **(G5)** Add › Manage marketplaces opens Desktop's sheet: "Marketplaces added with Claude Code on this computer. Removing one also uninstalls its plugins.", one row per marketplace with its source, Check for updates and Remove… in its overflow, "No marketplaces added yet" when empty; Remove… opens E8's destructive sheet naming the plugins it uninstalls. Add › Add marketplace opens a focused sheet (owner/repo, URL or folder; Choose folder…) that confirms through E8's sheet.
6. **(G6)** `/skills` opens the library-sized dialog with "Skills", Search, Filter, Sort and Reload skills; rows are grouped like My items by where the skill comes from (the plugin's group for a plugin's skill, with the plugin named beside the skill; "In this project" for project skills; "Personal" for the user's own; "Built in" for the engine's), each with its description; "Use in chat" closes the dialog and puts `/<skill> ` at the composer's caret, sending nothing. On an exited session it shows A's dormant state (Load now) and starts nothing until clicked.
7. **(G7)** `/sandbox` on 2.1.295's answer (U3 F4) reads "Sandbox off" and "Not turned on in your settings", with Details beneath; it offers no control that writes settings.
8. **(G8)** With P2-C's `mods.list` answering `[{id: 'maws.to-human', …}]`, My items ends with "MAWS mods · Built in" listing To-human with its switch and no Uninstall; with `mods.list` absent or empty the section is not drawn.
9. **(E8 regressions)** Every mutation still opens E8's confirm sheet (binary, exact argv, writes, the reload line, scope, the destructive acknowledgement); the stub's `calls.log` holds exactly the argv the sheet showed; after a successful mutation the running sessions reload and the result line names them; `e2e:widgets`' plugin cases (reworked onto the library) and the live `e2e:plugins-live` run (sixteen steps, scratch home, owner file identical) pass.
10. **(A's G2, `/plugins` half)** On an exited session that MAWS ran before, opening `/plugins` starts no engine and My items' loaded line reads "N plugins loaded in this session · Loaded last time, <relative>" with Refresh; Refresh shows "Starting…" and then "Loaded now". On a terminal-only session it reads "Not observed yet".
11. **(U3)** The findings are committed (M1, done).

## 5. Residue design

### 5.1 Terms

- **Installation** — one record of `claude plugin list --json`: a plugin id (`name@marketplace`) at one scope (`user`, `project`, `local`, or a pseudo-scope the engine lists: `session` for `--plugin-dir` folders, `synced` for claude.ai sync, and skills-directory plugins `name@skills-dir`), with its project for project and local scope. E8's identity `(id, scope, projectPath)`; unchanged.
- **Plugin identity** — a plugin id. The library draws one row per identity, whatever its number of installations (the owner's doperpowers has 47).
- **Here** — this session's directory as the CLI sees it: the CLI runs with `cwd` = the session's directory (E8 D-16), its `enabled` field is the plugin's effective state in the settings that directory reads, and an installation is "here" when its `projectPath` is that directory (both realpaths; U3 F1 shows `projectPath` is the realpath while a cwd may not be).
- **Library** — the second widget size (X19) and the composition drawn in it: a header, a list pane that scrolls on its own, and a detail that replaces the list.
- **Source group** — where an identity's marketplace comes from: Anthropic-published, or added by the owner from elsewhere (§5.4).
- **Manifest view** — what `plugins.manifest` answers for one installation: the plugin's own description of itself and an inventory of its components, read from files, nothing executed (§5.5).

### 5.2 The library size (X19)

`SlashWidget` (`src/renderer/src/composer/mentions/widgets.ts`) gains `size?: 'utility' | 'library'`, utility by default; `/plugins` and `/skills` register `library`. `WidgetDialogHost` (`src/renderer/src/composer/WidgetDialog.tsx`) keeps its one Radix dialog, its one open widget, its overlay and its `onCloseAutoFocus` (focus back to the session's composer) and only chooses the content box by size, from one exported table so P2-D's chooser host can reuse the library box: utility `w-[min(560px,calc(100vw-48px))] max-h-[85vh]` (today's); library `w-[min(960px,calc(100vw-48px))] h-[min(85vh,720px)]`. The library height is fixed, not a maximum, so switching tabs, filtering to nothing or drilling into a detail never resizes the dialog under the pointer (Desktop's library behaves as a fixed modal; §5.6 cites it). `WidgetFrame` gains `size` (default utility): utility keeps its body's `max-h-[60vh]` scroll; library gives the body the remaining height (`min-h-0 flex-1`) with no scroll of its own, since the library's list pane and detail scroll inside it while the header stays put. The frame's head (title and `/name`) stays as every widget has it.

Keyboard, unchanged in rule (charter §5.4): Esc anywhere in the library closes the dialog and hands the keyboard to the composer (the frame's handler); a layer drawn above it (the Add menu, the Filter and Sort menus, the Manage marketplaces sheet, E8's confirm sheet) takes its own Esc first, which is why every such layer is drawn beside the frame, not inside a row (E8 D-16's Radix pitfall). On open the search field has focus, so typing filters at once; Back (a button, and ⌘[) returns from a detail to the list with its search, filter and scroll intact.

Rejected: a separate library host (a second dialog store would need its own one-open rule and focus return; the parent's Decision Log 12); a maximum height (the dialog would jump as the list grows and shrinks); a right-panel or tab destination (a §5.4 amendment the owner did not ask for; report E §4.3).

### 5.3 The data: what the CLI gives and what MAWS keeps

`claude plugin list --json` rows carry `installedAt` and `lastUpdated` (U3 F1), which `installedOf` (`src/engine-host/plugins/cli-result.ts`) drops; `--available` rows carry `source` and, for one marketplace, `installCount` (U3), which `availableOf` drops. The reductions keep them, additively:

- `InstalledPlugin` gains `installedAt: string | null`, `lastUpdated: string | null` (ISO times as the CLI printed them; null when absent) and `here: boolean` (§5.1, computed in the host, which has the realpath of both; E8's renderer compared strings). Nothing else of the row crosses: the row's `mcpServers` carries header and environment values verbatim (U3 F1) and stays dropped.
- `AvailablePlugin` gains `source: PluginSourceRef | null` (the marketplace entry's source reduced to `{kind, url, repo, path}`, or the relative path string an in-repository entry has) and `installCount: number | null` (only the CLI's own number; null when the row has none).
- `Marketplace` is unchanged (its `source` kind and `locator` already decide the source group).

The version shown is the CLI's (`version`), never "unknown": a row reading `unknown` or nothing has no version; the detail says "Version not reported". A version that is a 12-character commit prefix (2.1.295 writes one for a manifest without a version, U3 F1) is shown as the engine reports it. No version is ever inferred from a directory name or a marketplace entry.

### 5.4 Plugin identity and grouping

A pure module, `src/renderer/src/widgets/plugins/library.ts`, turns the three reads into the list: `identitiesOf(installed, marketplaces, manifests)` → one `PluginIdentity` per id with all its installations, and `myItems(identities, view)` → the groups. Rules:

- **Relevance.** An identity is listed when it has a `user` installation, an installation `here`, or a pseudo-scope installation (a `--plugin-dir` folder, a skills directory, claude.ai sync). One installed only for other projects is listed only under Filter › "Other projects" (§5.6), read-only as E8's whole-branch review made it ("manage it from a session there"), because the CLI reports its enabled state as this directory sees it. (The owner's registry: 13 user and 117 project or local records over 50 projects; the default list shows what can run here.)
- **Group.** In order: **"In this project"** — an identity with an installation `here` (project or local scope), whatever else it has; **"From Anthropic & Partners"** — otherwise, an identity whose marketplace is the engine's built-in directory (`anthropic-plugin-directory`) or a marketplace whose locator is a GitHub repository of the `anthropics` organisation (source `github` with `repo` `anthropics/…`, or `git` with a `github.com/anthropics/` URL); **"From marketplaces you added"** — every other marketplace; **"Other sources"** — pseudo-scope installations (folders loaded with `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS`, skills directories, claude.ai sync), each with its scope word. An empty group is not drawn. The Anthropic test reads the locator, not a list of names: the engine itself refuses its reserved official names to any repository outside `github.com/anthropics/` (U3 F5), so the locator is the stronger and simpler signal and needs no copy of the engine's private list. "& Partners" is Desktop's label for Anthropic's marketplace, which lists partners' plugins (Supabase, 42Crunch); MAWS adds no partner test of its own. (§10 Q1.)
- **What a row shows** (G2): the display name (the manifest's `displayName`, else its `name`, else the id's name), the author (the manifest's `author.name`; omitted when absent), the description (the manifest's; omitted when absent), the date: "Updated <Mon D>" from the latest `lastUpdated` among the relevant installations when it is later than their earliest `installedAt`, else "Added <Mon D>" (a year appended when not this year); "Disabled" when the CLI's `enabled` is false here; an icon tile (§5.6: the engine's manifest has no icon field, U3 F2, so every tile is the neutral initial). Never a version, a path or "unknown".
- **Order inside a group**: Sort › "Name" (the default) or "Recently updated" (the row's date, newest first). **Search** matches the display name, the id, the author and the description, case-insensitive. **Filter**: All (default), Enabled here, Disabled here, Loaded in this session (§5.7), Other projects.

Sort and filter live in the library's own store for the app run (they survive closing and reopening the dialog, not a restart), so the library keeps no setting and needs no X15 version (§4.9; the ledger's row for B becomes "none"). Rejected: persisting them in settings (a version slot and a migration for two transient choices Desktop does not persist either).

### 5.5 The manifest service (`plugins.manifest`)

A narrow host-owned read that answers, for the installations the renderer names, what each plugin says about itself and what it contains, by reading files only: no plugin code is loaded or run, no hook or server is started, nothing is written.

**Where.** `src/engine-host/plugins/manifest.ts` (a reader with injectable `fs`), registered in `src/engine-host/ipc.ts` beside E8's handlers; owner `engine-host`, like every `plugins.*` read (E8 D-2), so it needs no second resolution of the config home.

**Input and admission.** `{cwd, installations: [{id, scope, projectPath}]}` (at most 256). The renderer never names a path: the host resolves each installation to the `installPath` that its own last `plugin list --json` for that `cwd` reported (it keeps the last listing per `cwd` from `plugins.list`; with none it runs the listing first). An installation the listing does not name answers `{state: 'unknown'}`. The listing's `installPath` is the trust anchor (the engine says this directory is the plugin); every file read below is confined to the realpath of that directory (a symlink resolving outside it is skipped and recorded as a problem). Rejected: the renderer passing `installPath` (a path from the renderer would need the same check against the listing anyway); reading `installed_plugins.json` directly (E8 D-12: one reader of the engine's registry, the CLI).

**What it reads.** `.claude-plugin/plugin.json` (at most 256 KiB; parsed with a tolerant schema that keeps only `name`, `displayName`, `version`, `description`, `author {name}`, `homepage`, `repository`, `license`, `keywords` and the component fields; unknown keys ignored). Components, each following the manifest's own paths where it declares them and the engine's default directories otherwise (U3 F2: supabase's `agents/` folder is not an agents directory; its manifest names `./agents/claude/.mcp.json` for MCP):

| Kind | Default location | Item |
|---|---|---|
| Commands | `commands/**/*.md` (nested directories are `dir:name`) | name from the path, description from front matter |
| Skills | `skills/*/SKILL.md` | name and description from front matter, else the directory name |
| Agents | `agents/*.md` | name and description from front matter, else the file name |
| Hooks | `hooks/hooks.json` plus the manifest's `hooks` (path, object or array) | the event name and the matcher; a hooks module (`modules`) counted as one "hooks module" |
| MCP servers | `.mcp.json` plus the manifest's `mcpServers` (path or object) | the server name and its transport (`stdio`, `http`, `sse`, `ws`) |
| LSP servers | the manifest's `lspServers` | the server name |

Front matter is read from the first 8 KiB of a Markdown file by a small reader of the leading `---` block (plain, quoted and `>`/`|` block scalars for `name` and `description`; anything else reads as no description); no YAML dependency. Bounds: 4,000 files and 3 s per call (past either the answer carries `partial: true` and what it read); 200 items per kind per plugin; a file over 256 KiB is skipped as a problem.

**Redaction (G3's "secrets redacted").** The answer carries names, descriptions and kinds only. Never: a hook's command, an MCP server's `command`, `args`, `env`, `headers` or URL, an LSP server's command, `userConfig` values, any value read from settings. Descriptions are plain text, drawn as text (never Markdown or HTML), so a plugin's words cannot become a link or an action. Rejected: showing an MCP server's URL host (a self-hosted URL can carry a token in its path; the name and transport suffice for "What's inside").

**Output** (`PluginManifestView`, §7): `{id, scope, projectPath, state: 'read' | 'missing' | 'unknown', name, displayName, version, description, author, homepage, repository, license, keywords, components: {commands, skills, agents, hooks, mcpServers, lspServers}, partial, problems}`. `missing`: the listing names it but its directory or manifest is gone (an uninstall in flight); the row then shows the id's name and nothing invented.

**Rejected: `claude plugin details <name>`** (U3 F3): it is the engine's own inventory, but text only with no `--json`, so MAWS would parse prose that may change any release; and it counts a `commands/` file as a skill, while G3 names commands. Rejected: the engine's catalog cache (`plugin-catalog-cache.json`) for uninstalled plugins' contents: an engine-private file, covering one marketplace; an uninstalled plugin's detail says "What's inside is listed once it is installed" (report E §2.4's "Not available until installed").

**When it is read.** My items asks for the relevant installations' views in one call when the list first renders and again on `plugins.changed`; the renderer caches by `(cwd, id, scope, projectPath, lastUpdated)`, so an update rereads and an unchanged plugin does not.

### 5.6 My items: the list

Composition, Desktop's (Claude Desktop 2.16120.0, `readable/app-2.16120.0/web/app/v1/c27f32a39-QZ0BG6_X.js`, the grouped library renderer and its row component; report E §3.1): the header row holds the title with the "My items | Browse" switch, and at the right Search (an always-visible field), Filter, Sort and the Add menu; under it the list pane, groups as section headings with their rows; a row is a full-width target (the whole row opens the detail) with the icon tile, the name with its badges, the author and description on a second line, the date at the trailing edge and a reserved overflow column. The row's overflow holds "Turn on"/"Turn off" (the enable switch's action for the row's own scope, through E8's sheet) and "Uninstall…", so the row never shows three buttons. Empty states: no plugin installed ("No plugins installed yet" with Browse plugins), no match ("No plugins match" with Clear search), a failed read (the read's words with Try again), each distinct, never a spinner standing in for an empty list. A later failed read keeps the last list with one line saying it is the last one read (E8's rule).

**The loaded line** (A's G2 `/plugins` half and §2 item 1). Under the header, one line about this session: "N plugins loaded in this session" with `useLoadedPlugins`' freshness ("Loaded now"; "Loaded last time, <relative>"; "Not observed yet"), then, on a ready session, Reload plugins and Reload skills (E8's `ReloadControls`, unchanged), and on a session with no ready process, Refresh (A's `refresh()`: acquire, then `reload_plugins`, showing "Starting…" from `WidgetFrame`'s state, A §5.6). The count is a button that applies Filter › "Loaded in this session", which lists the loaded plugins, including those that are not installed identities (the engine's `@builtin` plugins and session folders) as plain read-only rows ("Built into Claude Code", "Loaded from a folder"). Plugin problems from the last init (A's `errors`, `warnings`) show as "N problems" on the same line, opening the same filter with each problem under its plugin. Opening `/plugins` never acquires (nothing calls `refresh` on mount, A's G5).

**The built-in section** goes last (§5.12).

Until A's `useLoadedPlugins` is on master, M3 consumes a stand-in with the same signature in B's own file, reading the live status only (`now` when the process is ready, else `unknown`, no `refresh`), and the line shows Reload plugins only when ready; A's hook replaces it at the rebase that brings it (§6.1). If A landed first with its dated hunk in the old widget's Loaded section (ledger §6 exception), this rewrite removes that section and the hunk with it.

### 5.7 The detail: enabled here, loaded in this session

The detail replaces the list pane (Desktop's drill-in; `readable/app-2.16120.0/web/app/v1/c24c8737b-BY-86Rbf.js`, the detail with its enable and update controls and the "What's inside" navigation; report E §3.1). Top: Back; the icon tile, the display name and the author; the description; Update in the header (shown for an installation the selected chip names; it runs E8's update sheet) and an overflow with Uninstall… (E8's destructive sheet) and, when the manifest names them, Homepage and Repository (opened through the app's existing external-link path). Below:

- **Facts**: version ("Version not reported" when none), source (the marketplace's name and, for an added one, its locator), installed and updated dates, and the license when the manifest names one.
- **Scopes as chips**: one chip per relevant installation, "User", "This project" (project scope here), "This project · only you" (local scope here), a pseudo-scope's word, and "N other projects" when there are any (opening a read-only list of those projects, each with its version and E8's words). Selecting a chip selects the installation the controls act on; the first chip is the narrowest scope here (local, then project, then user), the engine's own precedence.
- **The enable control**: a switch labelled "Enabled for this project", its position the CLI's `enabled` (the effective state here, U3 F1), never an outcome's (E8's read-back rule); toggling opens E8's sheet for `enable` or `disable` at the selected chip's scope. When the selected scope is wider than an override here, E8's result line already says "a project setting may override it".
- **Enabled for this project and Loaded in this session**, two lines that never merge: "Enabled for this project" / "Not enabled for this project" from the CLI; and from `useLoadedPlugins` the plugin whose `source` is this id: present → "Loaded in this session" with its freshness ("Loaded now" or "Loaded last time, <relative>"); the list known and the plugin absent → "Not loaded in this session", with "Reload plugins to load it" (ready) or Refresh (dormant) when it is enabled here; the list unknown → "Not observed yet". The plugin's problems from the last init sit under them.
- **What's inside**: one section per non-empty kind of §5.5's table in that order, its count in the heading, each item's name and description; a hook as "<event> · <matcher>"; an MCP server as "<name> · <transport>". `partial` adds "Some files could not be read"; `missing` shows "This plugin's files are not on disk" and no inventory.

Rejected: rendering the plugin's README in the detail (a README is the plugin author's text with links and instructions; Desktop renders one, but drawing it safely needs the link policy and a Markdown surface the widget does not have; §10 Q6 defers it); one switch per scope (the CLI reports only the effective state, so a per-scope switch position would be a guess).

### 5.8 Browse

Browse reads `plugins.available` on the click that opens it (E8 D-7: the listing refreshes the engine's catalogue caches, so it runs on a gesture) and keeps the answer for the dialog's life, rereading on `plugins.changed` while open. Cards, Desktop's card anatomy (`readable/app-2.16120.0/web/app/v1/cfd5b0526-BW7Lg5RU.js`; report E §3.1): the icon tile, the name, two lines of description, the source line and, at the trailing edge, Install or "Installed".

- **Sources** (owner decision 5): the engine's configured sources only, which is exactly what `--available` lists, the built-in directory and every added marketplace; no remote feed, no editorial strips (Desktop's Trending, New and Most installed come from claude.ai's service, which MAWS does not use).
- **Folding** (the engine's own rule, U3 F5): an entry of the built-in directory and an entry of an Anthropic-published marketplace whose sources name the same repository and path are one card, the directory's, with "Also listed in <marketplace>" in its detail and the install count of whichever carries one. The source key (`src/shared/plugins/source-key.ts`): a `git-subdir` or `url` source's URL normalised (host lowercased, `https://` and `.git` and a trailing `/` dropped) plus its path; a relative source (`./plugins/x`) resolved against its marketplace's GitHub repository from `marketplaces.list`; no key, no fold. 251 names are listed by both on the scratch home (U3 e), so without the fold a quarter of Browse would be doubled.
- **Installed state**: `--available` leaves installed plugins out (E8's live run; U3 e); Browse adds a card for every installed identity of a configured source, marked "Installed", whose click opens its My items detail; the directory entry the engine already hides for an installed plugin stays hidden. A card is never marked installed from a name alone.
- **Install count**: "N installs" (compact: "3.4k", "1.3M") only when the row's `installCount` is a number (U3: `claude-plugins-official` only); never derived, summed across folded entries or shown as 0.
- **Order and filter**: Sort › "Most installed" (the default; cards without a count follow, by name) or "Name"; Filter by source (each marketplace, the directory); Search over name, id and description. The list is virtualised (`@tanstack/react-virtual`, already a dependency): about 3,300 cards on the scratch home.
- **Card detail**: the card opens a detail in place (as My items' does) with the description, the source, the version when the row has one, the count, "Also listed in …", and "What's inside is listed once it is installed"; Install opens E8's install sheet (scope chosen there, user by default) from the card or its detail.

### 5.9 Add marketplace and Manage marketplaces

The Add menu (a Radix dropdown beside Sort) holds exactly "Add marketplace" and "Manage marketplaces" (Desktop's local entries, `readable/app-2.16120.0/web/app/v1/c6a2a31c4-DlHruLy-.js`; its cloud-only entries, such as upload and create, are not drawn).

- **Add marketplace** opens a focused sheet ("Add marketplace"; one field, "owner/repo, URL or folder", Choose folder…, Add), whose Add opens E8's `marketplace-add` confirm sheet; the field and its rules are E8's `AddMarketplace` (`isPluginsArgument`, `sourceKindOfTyped`).
- **Manage marketplaces** opens Desktop's sheet: title "Manage marketplaces", the line "Marketplaces added with Claude Code on this computer. Removing one also uninstalls its plugins." (`c6a2a31c4-DlHruLy-.js`, report E §4.1), then one row per `marketplaces.list` entry (name; its source kind and locator beneath; the number of installed plugins from it), each with an overflow holding "Check for updates" (E8's `marketplace-update`) and "Remove…" (E8's `marketplace-remove`, its destructive sheet listing the installations it uninstalls, `uninstallsOf`); "No marketplaces added yet" when the list is empty; the row's operation line under it (E8's `OperationLine`). The built-in directory is no row (the engine never lists it as a marketplace, U3 d, so there is nothing to refresh or remove). The sheet is a `Sheet` drawn beside the frame; E8's confirm sheet stacks above it.

### 5.10 `/skills`

The same library box and header vocabulary (title "Skills", Search, Filter by group, Sort by name, Reload skills at the right; no My items | Browse switch, since the engine offers no catalogue of skills that are not installed and owner decision 5 binds Browse to configured sources; more skills come from Browse in `/plugins`, §10 Q5).

- **Data**: `get_skills_dialog` (`session.getSkillsDialog`), which 2.1.295 answers before any turn with each skill's `name`, `display_name`, `description`, `source` (`plugin`, `project`, `user`, `built-in`, `mcp`, `managed`, …), `state` and aliases (U3 F4); the existing fallback to the catalogue's skills (names and command descriptions) stays for an engine that answers it empty, every row then in one group "Skills".
- **Groups**: a plugin's skill (`source: 'plugin'`, the name `plugin:skill`) joins its plugin's group from §5.4 (the plugin found through the loaded list's `source` id, else the installed list by name), with the plugin's display name as a badge beside the skill; `project` (and `project, gitignored`) → "In this project"; `user` → "Personal"; `built-in` → "Built in"; any other source → a group named by the engine's word. Same order as My items, then Personal and Built in.
- **Row**: the skill's name (the part after `plugin:` when a badge names the plugin), the badge, the description (two lines), and "Use in chat" at the trailing edge. **"Use in chat"** closes the dialog and inserts `/<name> ` (the qualified name, which the engine resolves uniquely) at the composer's caret through `insertComposerText`, sending nothing (today's Use, renamed). A row's click opens a small detail (full description, source, the plugin, "Use in chat" as its primary button).
- **States**: the read is A's `useEngineRead`, so an exited session shows `WidgetFrame`'s dormant state ("Not read yet." with Load now) and starts nothing until clicked (A §5.6); Reload skills is E8's `session.reloadSkills` on a ready session.

### 5.11 `/sandbox`

No behaviour change: utility size, F2a's first read ("Sandbox on"/"Sandbox off" with the reason, the excluded commands, the policy lock, dependency problems, Details), no toggle (owner decision 5). 2.1.295's answer adds `mode`, `overrides_locked`, `no_sandbox_allowed`, `unix_sockets`, `allow_all_unix_sockets` and `ignored_glob_patterns` (U3 F4); none changes the first read's truth, so B adds no field and pins the 2.1.295 answer in a unit test. A's frame states reach it through `WidgetFrame` with no edit here.

### 5.12 MAWS mods · Built in (X20)

The last group of My items, headed "MAWS mods · Built in", lists X20's rows from `mods.list`: the mod's name ("To-human"), its description, the badge "Built in", a switch bound to X20's `enabled` through P2-C's write command, and, when the row's `perSession` is `on` or `off`, a second line "This session: on|off". No overflow, no Uninstall (X20: never uninstallable through the engine's CLI), no detail. Hidden while the read is absent, refused or empty.

Landing order (the parent: whichever of B and C lands second adapts): B ships the section component (`src/renderer/src/widgets/plugins/BuiltInMods.tsx`) and its data hook `useBuiltInMods()` in `src/renderer/src/widgets/plugins/builtin-mods.ts`. If C has not landed, the hook's body answers no rows (the section is not drawn) and C, landing second, fills that one function with `mods.list` and its write. If C landed first (its G7 entry then sits in the old widget), B's hook reads `mods.list` and calls C's write, and B's rewrite drops C's section from the old widget. Either way one file carries the seam.

### 5.13 What does not change

E8's runner, its argument lists, `writesOf`, the confirm sheet and its second sheet, the scope choice, the serialised mutation queue, the settle-and-verify reload after a mutation and its per-session words, `plugins.changed`, the passive harness policy for CLI reads, and every refusal in the engine's own words. The panel's Plugins summary (A's file this wave). `/reload-plugins` (its own widget). No MAWS write under the config home. No settings, index or sidecar version.

## 6. Execution

### 6.1 Constraints binding every milestone

- The parent's §4.8 and the section "P2-B" as cited in §3; contracts X19 (owned), X20 (hosted), X17 and X16 (consumed through A's names only), X2 additions named in §7 and the ledger; owner decisions 5 and "Desktop's composition as-is".
- The engine is the unmodified installed binary (D-1). MAWS never writes under `~/.claude` or `~/.claude.json`; every mutation is E8's CLI run after E8's sheet. The manifest service reads files only and executes nothing.
- Names: only those in §7 and the ledger. Shared files take appended, dated blocks (ledger §6): `src/renderer/src/widgets/WidgetFrame.tsx` (A's M3 edits it for the dormant states; B adds `size`), `src/renderer/src/widgets/copy.ts`, `src/shared/ipc/schema/plugins.ts` and `names/plugins.ts`, `src/engine-host/ipc.ts` (append after E8's block), `src/renderer/src/composer/mentions/widgets.ts`. B owns `PluginsWidget.tsx`, `SkillsWidget.tsx`, `SandboxWidget.tsx` and everything under `src/renderer/src/widgets/plugins/` and the new `src/renderer/src/widgets/skills/`.
- A's names: `useLoadedPlugins`, `Freshness`, `ReadState`'s three states and `WidgetFrame`'s handling of them. Before A's M2 is on master, M3 uses the stand-in of §5.6 behind the same signature; before A's M3, `refresh` is absent and the loaded line offers Reload plugins only when ready. Each is replaced, not kept beside A's, at the rebase that brings A's.
- Copy: the person's words; no provenance footers (F2a); the engine's own `message` and `failureCode` verbatim (E8). The strings in §5 are proposals (§10 Q9). Light theme default; tokens only.
- No settings, index or sidecar version (§5.4). No new npm dependency.
- Live runs only under P1's harness rules: a scratch `CLAUDE_CONFIG_DIR`, the owner-file check (A-15) before and after, `--max-budget-usd` ≤ 1 where a turn runs; never `~/.claude`, `dist/`, the owner's MAWS, its user data or index database.
- Heavy runs through the slot script, one e2e group at a time (P1 A-13).

### 6.2 Plan of Work

#### M1 — U3 (spike; done during authoring)

Question: does the installed engine's `--available` carry `installCount`, and from where. Run read-only against the owner's `~/.claude/plugins/` (no CLI there) and with the CLI under a scratch home. Verdict (`spikes/protocol-probe/findings-pass3-p2-b-u3.txt`): populated for `claude-plugins-official` from the engine's catalog when that marketplace is added, absent for the built-in directory and third parties; promoted into §5.8's rule (a count only where a row carries one). The findings' F1 to F5 shaped §5.1, §5.3, §5.4, §5.5, §5.8, §5.10 and §5.11. Proves acceptance 11.

#### M2 — The data and the manifest service (host, shared)

At its end the host's `plugins.list` rows carry `installedAt`, `lastUpdated` and `here`, `plugins.available` rows carry `source` and `installCount`, and `plugins.manifest` answers manifest views for named installations; no renderer change beyond types.
- **Touches:** `src/engine-host/plugins/cli-result.ts` (+ test), `src/engine-host/plugins/manifest.ts` (new, + test), `src/engine-host/plugins/front-matter.ts` (new, + test), `src/engine-host/ipc.ts` (the handler appended after E8's block; the last listing per `cwd` kept for admission), `src/shared/ipc/schema/plugins.ts` and `src/shared/ipc/names/plugins.ts` (additive fields; `plugins.manifest`), `src/shared/ipc/schema.test.ts` (the namespace pin), `src/shared/plugins/source-key.ts` (new, + test), `test/support/plugin-cli-script.js` and `plugin-cli-stub.ts` (rows carry `installedAt`, `lastUpdated`, `projectEnabled`; `--available` rows carry `source` and, for a marketplace the state marks, `installCount`; an install writes a small plugin tree with `.claude-plugin/plugin.json`, one command, one skill, one agent, `hooks/hooks.json` and `.mcp.json` under its `installPath`, so the e2e reads real files; an owner-shaped seed state of 29 ids and 130 records).
- **Interfaces:** produces `InstalledPlugin.installedAt|lastUpdated|here`, `AvailablePlugin.source|installCount`, `PluginSourceRef`, `plugins.manifest`, `PluginManifestView`, `sourceKey` (§7).
- **Decisions:** §5.3 and §5.5 own them. `here` compares `fs.promises.realpath` of both sides (a project that no longer exists is not here). The admission map is replaced, not merged, by each listing for its `cwd`, so an uninstalled plugin's path stops being readable at the next listing. The reader never follows a symlink out of the plugin root (realpath each file and check it is under the root's realpath, `src/main/files/allowlist.ts`'s segment-boundary rule as the model), never reads a FIFO or device (regular files only, by `lstat`), and stops at the bounds of §5.5. Hooks: read event names and matchers from the hooks JSON shapes the engine accepts (an object keyed by event of `[{matcher, hooks}]`); `modules` counts as one hooks module; the command strings are never copied into the answer, not even truncated.
- **Does not touch:** the renderer's components, the runner, `writesOf`, the confirm sheet.
- **Proves:** acceptance 3's data half, 4's count rule, 9's argv half (the stub's `calls.log` unchanged in shape). Tests: `installedOf` keeps the times and computes `here` through realpaths (a `/tmp` and a `/private/tmp` spelling are one project); `availableOf` keeps `installCount` only when it is a number and reduces `source` (both object shapes and the relative string); the manifest reader on fixture trees: a manifest with `displayName` and author, one with none (name falls back), supabase's shape (manifest paths over default folders; `agents/claude/` not read as agents), nested commands, a skill without front matter, front-matter forms (plain, quoted, `>` and `|` blocks), a symlink to `/etc` inside `skills/` skipped as a problem, an oversized file skipped, invalid JSON (`state: 'read'` with a problem, no throw), a missing directory (`missing`), an installation the listing does not name (`unknown`), an MCP server with `env`, `headers` and a tokenised URL whose values never appear in the serialised answer, a hook command never in the answer, the bounds producing `partial: true`; `sourceKey` equalities (git-subdir vs relative-in-official, `.git` and case) and a non-key; `plugins.manifest` is listed in the plugins namespace pin.

#### M3 — The library shell and My items

At its end `/plugins` opens library-sized with the header, My items' grouped list with search, filter and sort, the loaded line, the empty and error states, the row overflow's Turn on/off and Uninstall… through E8's sheets. Browse and the detail do not exist yet and nothing stands in for them: the My items | Browse switch is first drawn in M5 and a row's click does nothing until M4.
- **Touches:** `src/renderer/src/composer/mentions/widgets.ts` (`size`), `src/renderer/src/composer/WidgetDialog.tsx` (`WIDGET_DIALOG_BOX`), `src/renderer/src/widgets/WidgetFrame.tsx` (`size`; + test), `src/renderer/src/widgets/index.ts` (`/plugins` and `/skills` register `size: 'library'`; `/skills` keeps its body until M6), `src/renderer/src/widgets/PluginsWidget.tsx` (rewritten as the library shell; `present`/`PluginsBody` move to the loaded filter or go), `src/renderer/src/widgets/plugins/library.ts` (new: §5.4's pure model, + test), `src/renderer/src/widgets/plugins/LibraryHeader.tsx`, `MyItems.tsx`, `PluginRow.tsx`, `LoadedLine.tsx`, `library-store.ts` (new: tab, search, filter, sort, scroll, selected identity, per app run), `src/renderer/src/widgets/plugins/loaded.ts` (the stand-in of §5.6 only while A's hook is absent), `src/renderer/src/widgets/plugins/builtin-mods.ts` and `BuiltInMods.tsx` (§5.12), `src/renderer/src/widgets/copy.ts` (a `LIBRARY` table appended), the old `Installed.tsx` (removed once My items covers its cases), `src/renderer/src/widgets/PluginsWidget.test.tsx`, `e2e/widgets.spec.ts` (the plugins describe reworked onto the library: rows by identity, actions through the row overflow, data attributes kept where they still name the same thing: `data-widget="plugins"`, `data-plugin-row="<id>"`, `data-plugins-sheet`, `data-plugins-argv`, `data-plugin-result`).
- **Interfaces:** consumes M2's fields and `plugins.manifest`; A's `useLoadedPlugins` and `Freshness` (or the stand-in); produces `SlashWidget.size`, `WIDGET_DIALOG_BOX`, `WidgetFrameProps.size`, `PluginIdentity`, `identitiesOf`, `myItems`, `useLibraryStore`, `useBuiltInMods` (§7).
- **Decisions:** §5.2, §5.4, §5.6 own them. Reuse E8's `useManageState`, `ConfirmSheet`, `usePluginOperations`, `OperationLine`, `Gone` and `usePluginsRead` unchanged; a row's operation key stays the installation's (`installedKey`), since a mutation acts on one installation. Pitfalls in the code: `PluginsWidget` derives `cwd` from the status or the record (keep it: it is the CLI's cwd and `here`'s reference); the frame's `state` follows the installed read (keep: a session with no process still manages plugins); A's frame states reach `/plugins` only through the loaded line, since the frame state is the CLI read's; Radix `DropdownMenu` content must be portalled beside the frame (Esc).
- **Does not touch:** `SkillsWidget.tsx` beyond its registration size, `SandboxWidget.tsx`, the host, Browse, the detail.
- **Proves:** acceptance 1, 2, 8 (with a fake `mods.list` in a unit test), 10's `/plugins` half. Tests: the grouping table (`library.test.ts`): relevance (user, here, pseudo-scope, other-project-only), each group's rule including a `github` `anthropics/…` marketplace, a `git` URL under `github.com/anthropics/`, a fork named `claude-plugins-official` at another owner (not Anthropic), the directory; one row per identity for 47 installations; the date rule; "unknown" and a commit-prefix version never in a row; search and each filter; the Esc and focus rules (the frame test: Esc closes and the composer's `focusEditor` is called; an open Add menu takes the first Esc); the dialog box class by size; the loaded line's three freshness states and its filter; opening `/plugins` on an exited session issues no `session.acquire` (A's resource test extended to `/plugins`); the widgets e2e on the owner-shaped seed (29 rows), enable and uninstall from the overflow with `calls.log` equal to the sheet's argv.

#### M4 — The detail

At its end selecting a row opens its detail with every element of §5.7, Update and Uninstall live there, and Back restores the list.
- **Touches:** `src/renderer/src/widgets/plugins/PluginDetail.tsx`, `ScopeChips.tsx`, `WhatsInside.tsx` (new), `library-store.ts` (selection), `copy.ts` (`LIBRARY`), `e2e/widgets.spec.ts` (update, enable at a chosen scope, other-project chips read-only), `PluginsWidget.test.tsx`.
- **Interfaces:** consumes M2's `PluginManifestView`, M3's identity model and store, A's `useLoadedPlugins` (with `refresh` when A's M3 is on master).
- **Decisions:** §5.7 owns them. The chip default is the narrowest scope here; the switch's sheet passes the selected chip's scope explicitly (E8 D-16: a project-scoped plugin changed at user scope fails `not_installed`); an identity whose installations are all other projects' shows no switch, no Update and no Uninstall (E8's whole-branch rule). Homepage and Repository open only `https:` URLs through the existing external-link handler; anything else is shown as text.
- **Does not touch:** the host, Browse, `/skills`.
- **Proves:** acceptance 3 and 9's detail half. Tests: Enabled and Loaded never merge (the four combinations: enabled and loaded now; enabled, list known, absent; disabled and loaded last time; unknown list); a dormant session's Refresh calls `refresh` once and nothing calls it on mount; the chip order and default; a switch toggle opens the sheet at the chip's scope; What's inside hides empty kinds and shows `partial` and `missing`; no detail text contains a hook command or an MCP env value (rendered from M2's redaction fixtures).

#### M5 — Browse, Add marketplace, Manage marketplaces

At its end the My items | Browse switch is drawn, Browse lists folded cards with truthful installed state and counts, and the Add menu's two sheets work.
- **Touches:** `src/renderer/src/widgets/plugins/Browse.tsx`, `BrowseCard.tsx`, `browse.ts` (new: folding, installed join, order; + test), `AddMenu.tsx`, `AddMarketplaceSheet.tsx`, `ManageMarketplaces.tsx` (new; the old `Available.tsx` and `Marketplaces.tsx` removed once covered), `LibraryHeader.tsx` (the switch, the Add menu), `copy.ts` (`LIBRARY`), `e2e/widgets.spec.ts` (Available's cases move to Browse: the read only on the Browse click — `calls.log` has no `--available` before it; install from a card; the marketplace add, refresh and remove cases through the sheets), `e2e/plugins-live.spec.ts` and `e2e/support/plugins-live.ts` (the sixteen steps re-pointed at the library's controls; the audit unchanged).
- **Interfaces:** consumes M2's `source`, `installCount` and `sourceKey`; M3's header and store; M4's detail (an installed card opens it).
- **Decisions:** §5.8 and §5.9 own them. The count's compact form uses `Intl.NumberFormat('en', {notation: 'compact'})`. A card's install target is the card's own `pluginId` (the directory's when folded, as the engine's terminal installs it, U3 F5).
- **Does not touch:** the host, `/skills`, `/sandbox`.
- **Proves:** acceptance 4, 5, and 9 (the live run). Tests: the fold (a directory entry and an official entry with one repository and path → one card with the official count; different paths → two cards; a third-party marketplace never folds), an installed identity's card marked Installed and the engine's hidden duplicate staying hidden, counts only where a number is present (none on directory cards), the order with and without counts, the read only after the Browse click, the Manage sheet's rows, its copy, its empty state, Remove's sheet naming the uninstalls, the built-in directory never a row.

#### M6 — `/skills`, `/sandbox`, the built-in section, the acceptance run

At its end `/skills` is the skills library, `/sandbox` is pinned against 2.1.295's answer, the built-in section is final for whichever of B and C landed first, and §4 is run as written.
- **Touches:** `src/renderer/src/widgets/SkillsWidget.tsx` (rewritten), `src/renderer/src/widgets/skills/SkillsLibrary.tsx`, `skills.ts` (new: grouping; + test), `src/renderer/src/widgets/SkillsWidget.test.tsx`, `src/renderer/src/widgets/SandboxWidget.test.tsx` (new or extended: the 2.1.295 answer), `src/renderer/src/widgets/plugins/builtin-mods.ts` (to `mods.list` if C is on master), `e2e/widgets.spec.ts` (the skills case: groups, Use in chat inserts and sends nothing), `copy.ts`.
- **Interfaces:** consumes `session.getSkillsDialog`, A's `useEngineRead` states, M3's group rule (`groupOfMarketplace`), C's `mods.list` when present.
- **Decisions:** §5.10, §5.11, §5.12 own them. The skills dialog's answer is parsed per skill (`parseEach`), unknown `source` words kept as group names; the catalogue fallback is unchanged.
- **Does not touch:** the host; `/plugins` beyond the built-in hook.
- **Proves:** acceptance 6, 7, 8 (final), and the whole of §4 as the last step (§6.3's acceptance run).

### 6.3 Concrete Steps

Working directory: the child's worktree (absolute paths; `pnpm -C <worktree>`).

```
pnpm -C <worktree> install --frozen-lockfile
pnpm -C <worktree> typecheck                     # no output, exit 0
pnpm -C <worktree> lint                          # exit 0
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C <worktree> test --maxWorkers=4   # every suite passes; the new ones per milestone
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C <worktree> e2e:widgets           # the plugins and skills cases by name, all passing
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C <worktree> e2e:panel             # unchanged, passing (the panel's Plugins summary)
```

The scratch home (as U3 built it; no CLI against `~/.claude`):

```
export S=/tmp/p2b-live-$(date +%s); mkdir -p $S/home/.claude $S/proj
env -i HOME=$S/home CLAUDE_CONFIG_DIR=$S/home/.claude PATH=/usr/bin:/bin DISABLE_AUTOUPDATER=1 TERM=dumb \
  /Users/new/.local/share/claude/versions/<installed> plugin marketplace add anthropics/claude-plugins-official --json
```

The live run (M5, the E8 sixteen steps on the library; spends about $0.05):

```
python3 -c "import json;d=json.load(open('$HOME/.claude.json'));print(sorted(k for k in d.get('projects',{}) if k.startswith('/tmp') or k.startswith('/private/tmp')))" > /tmp/p2b-ownerfile-before.txt
MAWS_HARNESS=1 /tmp/maws-review/with-slot.sh pnpm -C <worktree> exec electron-vite build
unset MAWS_E2E; MAWS_E8_LIVE=1 /tmp/maws-review/with-slot.sh pnpm -C <worktree> exec playwright test e2e/plugins-live.spec.ts --reporter=line
python3 -c "…same…" > /tmp/p2b-ownerfile-after.txt && diff /tmp/p2b-ownerfile-before.txt /tmp/p2b-ownerfile-after.txt && echo identical
```

Expected: `1 passed`, the evidence under `docs/doperpowers/evidence/p2-b/`, `identical`.

The acceptance run (M6's last step), in a development build against the scratch home (an agent stands in for the owner, `MAWS_LIVE=1` rules) or at P2-F's sitting: `/plugins` → the dialog measures 960 by 720 at a 1440 by 900 window and the composer regains focus on Esc; My items' groups and rows as acceptance 2 (on the scratch home with code-review at user scope, frontend-design at project scope here and a third plugin installed for another directory: two rows, the third only under Other projects); a detail's two facts and What's inside as acceptance 3; Browse after its click with "1.3M installs" on frontend-design-like official cards and none on directory-only cards; Manage marketplaces as acceptance 5; `/skills` with a user, a project and a plugin skill in three groups and Use in chat inserting `/frontend-design:frontend-design `; `/sandbox` "Sandbox off"; on an exited session `/plugins`' loaded line "Loaded last time, …" with Refresh → "Starting…" → "Loaded now", and no `session.launch` before the click.

## 7. Interfaces and Dependencies

Shared and host:

```ts
// src/shared/ipc/schema/plugins.ts (P2-B block, additive)
InstalledPluginSchema gains: installedAt: z.string().nullable(), lastUpdated: z.string().nullable(), here: z.boolean()
export const PluginSourceRefSchema = z.union([z.string(), z.strictObject({ kind: z.string(), url: z.string().nullable(), repo: z.string().nullable(), path: z.string().nullable() })]);
AvailablePluginSchema gains: source: PluginSourceRefSchema.nullable(), installCount: z.number().int().nonnegative().nullable()

const ManifestItemSchema = z.strictObject({ name: z.string(), description: z.string().nullable() });
export const PluginManifestViewSchema = z.strictObject({
  id: z.string(), scope: z.string(), projectPath: z.string().nullable(),
  state: z.enum(['read', 'missing', 'unknown']),
  name: z.string().nullable(), displayName: z.string().nullable(), version: z.string().nullable(),
  description: z.string().nullable(), author: z.string().nullable(), homepage: z.string().nullable(), repository: z.string().nullable(),
  license: z.string().nullable(), keywords: z.array(z.string()),
  components: z.strictObject({
    commands: z.array(ManifestItemSchema), skills: z.array(ManifestItemSchema), agents: z.array(ManifestItemSchema),
    hooks: z.array(z.strictObject({ event: z.string(), matcher: z.string().nullable() })), hookModules: z.number().int().nonnegative(),
    mcpServers: z.array(z.strictObject({ name: z.string(), transport: z.enum(['stdio', 'http', 'sse', 'ws', 'unknown']) })),
    lspServers: z.array(z.strictObject({ name: z.string() })),
  }),
  partial: z.boolean(), problems: z.array(z.string()), // a problem names a relative path and what was wrong, never a file's content
});
'plugins.manifest': host(z.strictObject({ cwd: PluginsCwdSchema, installations: z.array(z.strictObject({ id: PluginsArgumentSchema, scope: z.string(), projectPath: z.string().nullable() })).max(256) }),
                         z.strictObject({ manifests: z.array(PluginManifestViewSchema) })),
// names/plugins.ts: 'plugins.manifest' appended to `commands`

// src/shared/plugins/source-key.ts
export function sourceKey(source: PluginSourceRef | null, marketplace: { source: string; locator: string | null } | null): string | null;

// src/engine-host/plugins/manifest.ts
export interface ManifestReaderDeps { fs?: Pick<typeof import('node:fs/promises'), 'lstat' | 'realpath' | 'readFile' | 'readdir' | 'open'>; now?: () => number; budgetMs?: number }
export function readManifestView(root: string, installation: { id: string; scope: string; projectPath: string | null }, deps?: ManifestReaderDeps): Promise<PluginManifestView>;
// src/engine-host/plugins/front-matter.ts
export function frontMatter(text: string): { name: string | null; description: string | null };
```

Renderer:

```ts
// src/renderer/src/composer/mentions/widgets.ts — SlashWidget gains
size?: 'utility' | 'library'; // X19; utility by default
// src/renderer/src/composer/WidgetDialog.tsx
export type WidgetSize = 'utility' | 'library';
export const WIDGET_DIALOG_BOX: Record<WidgetSize, string>; // the content box classes; P2-D's chooser host reuses 'library'
// src/renderer/src/widgets/WidgetFrame.tsx — WidgetFrameProps gains size?: WidgetSize

// src/renderer/src/widgets/plugins/library.ts
export type SourceGroup = 'here' | 'anthropic' | 'added' | 'other';
export interface PluginIdentity { id: string; name: string; marketplace: string; installations: InstalledPlugin[]; relevant: InstalledPlugin[]; group: SourceGroup | null /* null: other projects only */; enabledHere: boolean; installedAt: string | null; lastUpdated: string | null; manifest: PluginManifestView | null }
export function groupOfMarketplace(marketplace: string, marketplaces: readonly Marketplace[]): 'anthropic' | 'added';
export function identitiesOf(installed: readonly InstalledPlugin[], marketplaces: readonly Marketplace[], manifests: ReadonlyMap<string, PluginManifestView>): PluginIdentity[];
export function myItems(identities: readonly PluginIdentity[], view: { search: string; filter: LibraryFilter; sort: LibrarySort; loaded: ReadonlySet<string> | null }): { group: SourceGroup | 'otherProjects'; rows: PluginIdentity[] }[];
export type LibraryFilter = 'all' | 'enabled' | 'disabled' | 'loaded' | 'otherProjects';
export type LibrarySort = 'name' | 'updated';
// src/renderer/src/widgets/plugins/library-store.ts
export const useLibraryStore: UseBoundStore<StoreApi<{ plugins: LibraryView; skills: SkillsView }>>; // per app run
// src/renderer/src/widgets/plugins/builtin-mods.ts
export interface BuiltInModRow { id: string; name: string; description: string; enabled: boolean; perSession: 'inherit' | 'on' | 'off' | null }
export function useBuiltInMods(): { rows: BuiltInModRow[]; setEnabled: ((id: string, enabled: boolean) => Promise<void>) | null };
// src/renderer/src/widgets/plugins/browse.ts
export interface BrowseCard { pluginId: string; name: string; description: string | null; marketplace: string; alsoListedIn: string[]; installCount: number | null; version: string | null; installed: PluginIdentity | null }
export function browseCards(available: readonly AvailablePlugin[], identities: readonly PluginIdentity[], marketplaces: readonly Marketplace[]): BrowseCard[];
// src/renderer/src/widgets/skills/skills.ts
export function skillGroups(dialog: GetSkillsDialogResponse, catalog: SessionCatalog, loaded: ObservedPlugin[], identities: readonly PluginIdentity[]): { group: string; rows: { name: string; plugin: string | null; description: string; source: string }[] }[];
```

Consumed from P2-A (ledger §1): `useLoadedPlugins`, `Freshness`, `ObservedPlugin`, `ReadState`'s `dormant | starting | unavailable`, `WidgetFrame`'s states. From P2-C (ledger §1): `mods.list` and its X20 row; the toggle's write command as C names it. Dependencies: nothing new from npm (`@tanstack/react-virtual`, `radix-ui`, `zod` are present).

## 8. Hand-back: ledger proposals (the architect records)

1. §1 `plugins.manifest`: the final shape is a batch over installations, `{cwd, installations: [{id, scope, projectPath}]} → {manifests: PluginManifestView[]}` (owner engine-host; P2-B, M2), the host admitting only `installPath`s its own last `plugin list --json` for that `cwd` reported; no `icon` (the engine's manifest schema has none, U3 F2); components `commands, skills, agents, hooks (event, matcher), hookModules, mcpServers (name, transport), lspServers`; redaction as §5.5.
2. §1 a new row: the additive fields `InstalledPlugin.installedAt`, `lastUpdated`, `here` and `AvailablePlugin.source` (`PluginSourceRef`), `installCount`, P2-B M2.
3. §1 a new row: X19's names, `SlashWidget.size?: 'utility' | 'library'`, `WidgetSize` and `WIDGET_DIALOG_BOX` in `src/renderer/src/composer/WidgetDialog.tsx` (P2-D's chooser host reuses the library box), `WidgetFrameProps.size`; the library box `w-[min(960px,calc(100vw-48px))] h-[min(85vh,720px)]`.
4. §1 `mods.list`: B consumes it through `useBuiltInMods()` in `src/renderer/src/widgets/plugins/builtin-mods.ts`, the one function the second lander of B and C fills or re-points; B needs C's toggle write named beside `mods.list`.
5. §4 X15: P2-B needs **no** version (sort and filter are per app run, §5.4).
6. §6: B's new directories `src/renderer/src/widgets/plugins/` (existing, B's) and `src/renderer/src/widgets/skills/`; `WidgetFrame.tsx` shared with A's M3 (B appends `size` in a dated block); `src/engine-host/ipc.ts` B's block after E8's.

**Charter lines at B's landing (the architect writes):** a dated §19 line under D-20 and §5.4: slash widgets have two sizes, utility (560 px, every widget) and library (about 960 px by 85 % of the window, at most 720 px tall, centred), the library for `/plugins` and `/skills` and for P2-D's chooser by X19; one open widget, Esc closing and focus returning to the composer, unchanged; `/plugins` ports Claude Desktop's plugin library composition (My items and Browse, source-grouped rows one per plugin, the drill-in detail, Manage marketplaces as Desktop's sheet) over E8's CLI management, superseding E8's four-section `/plugins` (E8 M2's section order) while E8's sheets, reload and refusal rules stand; Browse lists the engine's configured sources only, with install counts only where the engine supplies them (owner decision 5). §13: X2 gains `plugins.manifest` and the additive plugin fields; X19 recorded as landed (promoted at P2's close by P2-F).

## 9. Risks

- **The manifest reader as an attack surface.** Plugin directories are third-party content. Mitigation: files only, nothing executed, admission by the CLI's own listing, realpath confinement, regular files only, size and count bounds, text-only rendering, redaction tested against fixtures that carry secrets.
- **The engine's component layout moves.** Defaults and manifest fields are the engine's and change with releases (2.1.295 already counts commands as skills in `plugin details`). Mitigation: What's inside says what the files declare; unknown manifest shapes read as no items plus a problem, never a throw; a fixture of real installed plugins (code-review, supabase, frontend-design) pins today's shapes.
- **Browse's size.** About 3,300 cards and a 2 MB listing. Mitigation: read on the Browse click only, virtualised list, filtering in memory, the host's reduction unchanged in cost.
- **Folding wrongly.** A fold on a bad key merges two plugins. Mitigation: fold only directory entries with Anthropic-published marketplace entries, only on an exact normalised repository-and-path key; no key, no fold; tests with near-misses.
- **A and C landing order.** `WidgetFrame.tsx` and the loaded data are A's; the built-in rows are C's. Mitigation: §6.1's stand-ins replaced at rebase; §5.12's one-function seam; the ledger's dated blocks.
- **The live run's rewiring.** E8's sixteen live steps locate controls in the old sections. Mitigation: M5 re-points them with the audit unchanged, and the stub e2e covers every action first.
- **Copy and taste drift from Desktop.** Mitigation: the composition cites Desktop's renderer per element; the owner's sitting (P2-F M4) compares light and dark side by side with Desktop's library.

## 10. Open questions for the architect (B proceeds on each recommendation)

1. **(owner, taste) "From Anthropic & Partners".** The rule: a marketplace whose locator is a GitHub repository of the `anthropics` organisation, or the engine's built-in directory. Recommendation: yes (the engine enforces the same boundary for its reserved names; no name list to keep).
2. **(owner, taste) Plugins installed only for other projects.** Hidden from the default list, shown read-only under Filter › "Other projects". Recommendation: yes (the owner's complaint was 132 rows with paths; what cannot run here is one filter away).
3. **(owner, taste) The fourth group "Other sources"** for `--plugin-dir` folders, skills directories and claude.ai sync. Recommendation: yes, after the three named groups.
4. **(owner, taste) The row's date.** "Updated <Mon D>" when updated after install, else "Added <Mon D>". Recommendation: yes.
5. **(owner, taste) `/skills` without a Browse tab.** Recommendation: yes; skills arrive through plugins (Browse in `/plugins`), and the engine offers no catalogue of uninstalled skills.
6. **(owner, taste) README in the detail.** Recommendation: defer (a tracker row): What's inside and the description first; rendering a plugin author's Markdown needs the link policy.
7. **(owner, taste) Dialog dimensions.** `min(960px, 100vw−48px)` by `min(85vh, 720px)`, fixed. Recommendation: as written; the sitting adjusts against Desktop.
8. **(owner, taste) Browse's default order.** "Most installed" (counts first, then by name). Recommendation: yes.
9. **(owner, copy)** The strings of §5: "My items", "Browse", "In this project", "From Anthropic & Partners", "From marketplaces you added", "Other sources", "MAWS mods · Built in", "Other projects", "Updated <date>", "Added <date>", "Disabled", "Enabled for this project", "Not enabled for this project", "Loaded in this session", "Not loaded in this session", "Not observed yet", "N plugins loaded in this session", "What's inside", "Version not reported", "This project", "This project · only you", "N other projects", "Installed", "N installs", "Also listed in <marketplace>", "What's inside is listed once it is installed", "Manage marketplaces", "Marketplaces added with Claude Code on this computer. Removing one also uninstalls its plugins.", "No marketplaces added yet", "Check for updates", "Use in chat", "Personal", "Built in". Recommendation: as listed; the sitting adjusts.

## 11. Surprises & Discoveries

- Observation: the engine's catalog carries install counts for one marketplace only, keyed by `<name>@claude-plugins-official`, so the built-in directory's 3,231 entries never get one even when they are the same plugins.
  Evidence: `findings-pass3-p2-b-u3.txt` Method 3a and 3c; 2.1.292 `n_t` :795914.
- Observation: the engine's manifest schema has no icon field; "icon where the manifest has one" can never be met from a manifest.
  Evidence: U3 F2 (`qp`, 2.1.292 :673281).
- Observation: `get_skills_dialog` answers on 2.1.295 before any turn with a source per skill, where C11's recordings had it empty.
  Evidence: U3 F4.
- Observation: `projectPath` is a realpath while the CLI's cwd may not be; E8's renderer compared the strings.
  Evidence: U3 F1 (`/private/tmp/p2b-u3/proj` for a cwd of `/tmp/p2b-u3/proj`); `src/renderer/src/widgets/plugins/Installed.tsx` (`plugin.projectPath !== cwd`).
- Observation: `claude plugin details <name>` exists (text only) and counts a commands file as a skill.
  Evidence: U3 F3.
- Observation: 251 plugin names are listed by both the built-in directory and `claude-plugins-official`; the engine's terminal folds them, its `--available` does not.
  Evidence: U3 3e and F5.

## 12. Decision Log

- Decision: the verification call. This document gets one independent review round by the `doperpowers:adversarial-reviewer` agent on Opus (the astra route limited until 2026-10-13, P1 P-26), on the residue design and the execution section's buildability (five milestones after the spike), and the reviewer's verification of the fixes, before the first executor starts; each milestone gets the task-reviewer at its frontier (M2 alone; M3 then M4; M5; M6); the whole branch gets `doperpowers:review-code` at **medium** (a renderer port over an existing management service; the one new trust boundary, the manifest reader, is pinned by M2's fixtures and named for the reviewer's attention).
  Rationale: the risk concentrates in the manifest reader and in the E8 regressions, both covered by tests the plan names; the rest is composition the owner's sitting judges.
  Date/Author: 2026-10-09, P2-B's author.
- Decision: residue rulings §5.2 to §5.12 as written (the library box fixed in height from one exported table; `here` computed in the host by realpath; the Anthropic group by locator; one row per identity with other-project-only plugins behind a filter; sort and filter per app run, so no version; the manifest service as a batch over installations admitted by the CLI's own listing, files only, redacted to names and kinds, with its own front-matter reader; Enabled from the CLI and Loaded from A's hook, never merged; Browse folded by the engine's own rule with installed cards joined and counts only from the row; the Manage sheet over E8's operations; `/skills` from the populated skills dialog grouped by source with no Browse; `/sandbox` unchanged; the built-in seam in one function). Each section names the alternative rejected.
  Rationale: each is a technical consequence of the section, §4.8, the code and U3; the forks that change what the owner sees are §10's.
  Date/Author: 2026-10-09, P2-B's author.
- Decision: U3 was run during authoring (M1), as P2-A ran U1, so the design rests on the measured engine rather than on the grounding's inference.
  Rationale: the count rule, the skills grouping and the manifest's fields all changed with the measurement (one marketplace only; a populated skills dialog; no icon field).
  Date/Author: 2026-10-09, P2-B's author.

## 13. Outcomes & Retrospective

Pending — written at finish.
