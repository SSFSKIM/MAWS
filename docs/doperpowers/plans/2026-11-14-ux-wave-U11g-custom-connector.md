# UX wave · U11g · Add custom connector, and the Connectors dialog's true sentence (2026-11-14)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U11** (`docs/doperpowers/specs/2026-11-12-ux-wave/U11-settings-connectors-org.md`), landing **U11g**, parent pin master `3514e9cda12f70228e815c51bdf0c404455131b6`.
> **Where the design is.** This landing is the first of four that build one design: connector switches by scope, and custom connectors (the child's items l8-settings-05, #476 and the halves of l8-settings-04 and l8-settings-03 that waited). That design was drafted on 2026-11-14 outside the repository, reviewed adversarially, ruled on by the wave's architect and read by the P5 architect, who ruled that this first landing may be built now. **The child's file gains the design in the spec's next batch; until then this document is the record of the part this landing builds**, and it carries that part in full ("The design of this landing"). An executor reads this document and the code, never the draft. The owner's two answers of 2026-11-14 for l8-settings-05: “Claude Code's config” (where a custom connector is written) and “the list MAWS keeps in Settings is retired” (what becomes of adding in Settings, which a later landing builds). In the root: Purpose, the wave's laws, UC-7, UC-8, UC-10, UC-11, UC-12, UC-14. Where this document and the root differ, the root binds.
> **Branch:** `ux-wave/U11g`, from the parent pin; master is merged in before anything is built (Concrete Steps, 1). **Stands on:** U11a (`docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md`, on master with its code).

## Purpose

Today a person can add a connector from Customize only when Anthropic's directory lists it, and only as a remote server with no request header. A server of their own (an internal HTTP or SSE endpoint that wants a header, or a program on this Mac started with arguments and environment variables) can be added in a terminal with `claude mcp add`, or as a bare name and URL in Settings, where only the chats MAWS starts ever see it.

After this landing, Customize › Connectors › My items has "Add custom connector…". It opens one sheet: a name, one of three types, the type's fields, and where to add it (all projects, this project only, or this project's shared `.mcp.json`). Add writes the connector into Claude Code's own configuration through the engine's own CLI, so the next chat MAWS starts has it and so does the next `claude` in a terminal. The row then appears in My items as any configured connector does.

And the head of a chat's Connectors dialog says what its switch really does. Today it reads "Off here is off for every session in <place>.", which claims sessions that are already open; the engine does not tell those. It becomes "A switch here is for this chat, and every session started in <place> afterwards."

How to see it working: Acceptance, G1 to G6.

## Progress

- [x] (2026-11-14) This document written against master `3514e9cda`; the code statements in "What the code says today" checked at that commit.
- [ ] The adversarial review of this document (the architect dispatches it); its findings folded in.
- [ ] The owner's look at the drawn sheet (Proof, P1). M2 waits for it; M1 and M3 do not.
- [ ] M1 — The rules, the command and the runner that keeps values out of every line.
- [ ] M2 — The sheet and the action in Customize.
- [ ] M3 — The dialog's sentence, the record, the whole checks, the hand-back.
- [ ] The architect's: the e2e scenes on a Mac, the branch review, class 1a, the pull request (Proof, P2 to P4).

## The landing's edge

**In.** From l8-settings-05: where the action sits, the form's fields and checks, what Add writes, how header and variable values are kept out of everything MAWS keeps, and what follows Add. From l8-settings-04: the head's sentence, which is true of today's switch with no other change.

**Not included, each a later landing of the same design** (named so that nobody builds it here):

| later landing | what it holds, and what this landing leaves alone for it |
|---|---|
| the move of MAWS's own list, on a press | The row "Move to Claude Code’s config…" for an entry of MAWS's own list, its clash read, its ordered steps. **The Settings row "MCP servers" keeps its fields and its behaviour in this landing**: adding there still works, and `engine.mcpServers` is neither read differently nor written. |
| the record, the default and the switches (#476) | The file `machine-connectors.json`; "off until switched on"; the two switches in Customize; the acts `connectors.scopes.*`; the hold of a launch's first message; the dialog's switch acting on every open chat of a place, with the head's other sentence; a new chat's switches. Here "All projects" in the form means only the engine's scope `user`: nothing is recorded beside the add, and the new row has no switch. |
| account connectors | Connectors that come with a Claude account: untouched. |
| U11c, Customize's new structure | "My items | Discover" outside and the kind as a filter is not built. The action sits at the head of today's Connectors section; U11c moves it to the head's right of My items. |

Also not included: an OAuth client id, secret or callback port in the form; editing a connector after it is added (remove it and add it again); import from Claude Desktop's configuration; a WebSocket type (the engine accepts `ws`; nobody asked); hiding a value from the person's own processes ("Secrets"); a "Sign in now" step in the sheet; any change to Discover's add sheet, to Remove, to sign-in, or to the Connectors card of the card column (U8's file).

## Words used here

- **Connector**: an MCP server as a person meets it. **Custom**: not taken from the directory.
- **Scope**: where the engine keeps a connector's definition. `user`: the top-level `mcpServers` of the engine's global config file (`~/.claude.json`, or `.claude.json` inside `CLAUDE_CONFIG_DIR`); every project has it. `local`: under `projects[<place>].mcpServers` of the same file; one project has it. `project`: the `.mcp.json` of the folder the CLI runs in; whoever checks the repository out has it.
- **Place**: the engine's key for a folder: a repository's main root, or the folder itself outside a repository.
- **The inventory**: what is configured on disk for a folder, read with no session running (`customization.inventory`, answered by the engine host): connectors of the scopes `user`, `project`, `local`, and of MAWS's own list as scope `app`. Only a name, a scope, a file and a transport cross to a window, never a URL, a header or a variable.
- **MAWS's own list**: the HTTP servers added under Settings › Sessions › MCP servers (`engine.mcpServers`), passed at launch to the sessions MAWS runs.
- **The engine host**: the process that owns engine processes and runs the engine's CLI for Customize (`src/engine-host/`). **The runner**: its class `PluginsRunner` (`src/engine-host/plugins/runner.ts`), which spawns `claude plugin …` and `claude mcp …`, one mutation at a time.
- **An operation**: one mutation the runner runs. A window gets a receipt `{ opId }`, then `plugins.operation` events: `started`, one `output` per line the CLI prints, `done` with the outcome.
- **A value**: the value of a request header or of an environment variable in the form. These are the strings this document treats as secrets. A URL, a command and an argument are not: the sheet shows them back.
- **The wire**: the commands and events between builds of MAWS's processes (`src/shared/ipc/wire.ts`); a change to it is additive (a minor) or breaking (a major).
- **Build F**: `f1852de3a`, the build on the owner's machines, which a trial of the wave's build may be followed by.

## The design of this landing

### Where

"Add custom connector…" is a button at the right of the head of Customize › Connectors › My items (the toolbar that holds "Configured on disk" and Refresh today, `data-customize-toolbar="mcp"` in `customize/connectors/ConnectorsSection.tsx`), before Refresh. It is drawn in My items only, on the user configuration's page and on a project's or a folder's page. It is a button and nothing else: no key, no row in the keymap's action table, no palette entry.

Why there: the owner chose Claude Code's configuration over a list that only MAWS's sessions see, so one place adds a connector and every session has it, and Customize is where connectors are added already. The alternative, more fields in the Settings row, keeps the list only MAWS's sessions see.

### The form's fields

One sheet, titled "Add custom connector". Nothing runs before Add.

| field | rule |
|---|---|
| Name | The engine's own name for the connector: letters, digits, hyphens and underscores, at most 128 (`isMcpName`). Not `maws`, and not a name the engine reserves (the list in `src/shared/engine/app-mcp-servers.ts`). **The form itself refuses a name already configured in any scope that applies on this page, or held by MAWS's own list, and shows that entry** (today's `existingOf` and its sentence): the engine accepts a name already used at another scope, and one name then has two definitions (Engine facts, 3). There is no display name apart from this one: the engine has one name, and a second would need a store of MAWS's own. |
| Type | "Remote (HTTP)", "Remote (SSE)" or "Local command"; Remote (HTTP) chosen first. |
| URL | For the two remote types. **The form itself checks it**: `http` or `https`, a host, no surrounding space (`isMcpUrl`). The engine checks no URL at all (Engine facts, 3). |
| Request headers | For the two remote types: rows of a name and a value, none by default, added with "Add header". |
| Command | For a local command: one line, taken whole as the program to run, with the spaces at its two ends dropped. It is not split, so a path with spaces needs no quotes. |
| Arguments | For a local command: one line, split the way a shell splits words (§A gives the rule), and **shown split under the field as the person types**, one box per argument, before Add. A line that ends inside a quote, or on a lone backslash, is refused with a sentence. |
| Environment | For a local command: rows of a name and a value, none by default, added with "Add variable". |
| Add to | "All projects" (the scope `user`), "<project> only" (`local`), "<project>, shared in its .mcp.json" (`project`). The last two are offered only on a project's or a folder's page; "All projects" is chosen first. On the user configuration's page the one choice is a plain line. `<project>` is the page's name for its place (the project's name, else the folder with the home abbreviated). |

Changing the type keeps what was typed for the other type while the sheet is open and sends only the chosen type's fields. A row with neither a name nor a value is not sent.

Add is enabled when every field holds, the engine's binary is resolved (as in today's sheets), and the name has been checked against a read of the inventory made after the sheet opened. While that read is out, or when it could not read every configuration that applies, Add waits and the sheet says why, with Retry (today's three sentences). So on a page whose folder is a linked worktree, where the inventory cannot read the `local` scope today, nothing can be added; that is today's rule for Discover's sheet too, and the resolver's fix belongs to the landing of the switches.

Behind Details, closed at every opening as in today's sheets: the command, with every value replaced by dots, and the file it changes.

### What it writes

One run of the engine's own CLI by the runner, in the page's folder (the engine's configuration directory on the user configuration's page):

    claude mcp add-json <name> <json> --scope <user|local|project>

`<json>` is `{"type":"http"|"sse","url":…,"headers":{…}}` or `{"type":"stdio","command":…,"args":[…],"env":{…}}`. `headers` is left out when there is no header and `env` when there is no variable; `args` is always there. The engine takes all three types at all three scopes and writes each entry exactly as given (Engine facts, 1), so **there is no other form of the command and no fallback to `claude mcp add`**: a type that needed one does not exist. MAWS writes no file itself and stores nothing of its own.

### Secrets

A header's or a variable's value is written into Claude Code's configuration file in clear, because that is how the engine keeps it. The sheet says so once, under the rows, as soon as there is one: "Saved in Claude Code’s configuration file as written."

While the CLI runs, the values are in its arguments. A process of the same person on that Mac can read another's arguments (`ps`), so for the fraction of a second the CLI runs the values are readable by the person's own processes. **The design accepts that**: `add-json` takes its JSON only as an argument, and the alternative, MAWS writing the engine's configuration file itself, is not taken: the engine holds `.claude.json` in memory and rewrites it, so MAWS reads that file and never writes it. The CLI is spawned directly with an argument list, never through a shell, so no shell history holds them.

What MAWS guarantees is about what it keeps and shows. **No value enters any event, any log line, any journal or ledger row, or any line a window draws.** Every line the CLI prints, on success or failure, has each value replaced by `•••` before it leaves the runner (§C names every exit); the sheet's Details shows the command with the same replacement; the window forgets the values when the sheet closes. On the recorded runs the CLI prints no value (its answer names the type, the name and the scope); the replacement is for the lines no run recorded: a parse error, a later engine.

With "<project>, shared in its .mcp.json" chosen and any header or variable filled in, the sheet warns: "This file is usually committed with the repository. Write a secret as ${NAME} and set NAME in your environment."

### After Add

The sheet closes at once. While the CLI runs, and if it fails, one line stands at the head of the list under the connector's name, in the engine's own words ("MCP server <name> already exists in user config"), as a removed row's result stands there today. When it succeeds the engine host says the configuration changed, the inventory is read again, and the row appears in My items as rows do today: its name, scope, transport and file, Remove, and, for a remote one, Sign in by the existing rule (through a ready session that holds it, else "Open a session, then sign in"). It has no switch. "Sessions started from now on load it; running sessions do not.", today's sentence, is in the sheet.

### The Connectors dialog's sentence

The head of a chat's Connectors dialog reads "A switch here is for this chat, and every session started in <place> afterwards." in place of "Off here is off for every session in <place>." Nothing else of the dialog changes: `<place>` as U11a's §C gives it, the tooltip "The engine records it in ~/.claude.json.", the switch waiting for the sentence, the act `session.mcpToggle`.

Why: today's sentence claims sessions that are open. The engine switches the one session that is told and writes the place's list; every other live session keeps what it has until it is told or restarted, and a new one starts from the list (Engine facts, 5). And the switch turns a connector on for a place as often as off. The new sentence is true of today's switch on every route that draws it, which is why it can land before the switches of #476.

### Routes (law 5), and other machines

Customize is not a session surface. It reads and changes this Mac only (the child's bindings 9 and 14), and **today it cannot show another machine at all**: its project list is cut to this machine's (`machineOf(id) === ipc.localMachine` in `customize/CustomizeView.tsx`), and its inventory read and its operations are sent with `{ machine: ipc.localMachine }`. So the add runs on this machine only, into this machine's configuration. The new command has no offer over the machine link, so no window on another machine can run it here either (G6).

What each route has after an add on this Mac:

| route | after the add |
|---|---|
| a session MAWS runs on this Mac | the next one started (a new chat, a resume, a fork) loads it: at `user` scope in any folder, at `local` or `project` scope in that project. A session already running does not, as the sheet says. |
| a terminal session on this Mac | the same: the next `claude` started reads the same configuration. |
| a session on another machine | nothing: that machine's configuration is its own, and nothing of this Mac's is shown as that machine's. |

The dialog's sentence: a session MAWS runs, here or on another machine, on this build or on build F, shows the new sentence, since this window draws the dialog and the switch is the same act everywhere. A terminal session's dialog (`widgets/McpDriven.tsx`) has no such sentence today and gains none: its Enable and Disable are the terminal's own `/mcp`.

### Departure from Claude Desktop (law 1)

Desktop's "Add custom connector" is two steps and remote only: a name and an `https` URL, with local addresses refused because Anthropic's servers make the connection, then how to sign in, with request headers. MAWS's is one sheet, takes a local command and a scope, and offers no "Sign in now": here the engine on the machine makes the connection and signs in through a session.

## Engine facts this landing rests on

Two recorded probe passes on engine `2.1.322`, both on master: `spikes/protocol-probe/findings-uxwave-u11-connector-scopes.txt` (pass 1) and `spikes/protocol-probe/findings-uxwave-u11-connector-scopes-2.txt` (pass 2), with pass 2's record `spikes/protocol-probe/fixtures/uxwave/u11-connector-scope2.ndjson`. "2:20" is line 20 of that record, the case `add-json`. Nobody runs an engine on the MacBook or on the build VM for this landing; a fact the records do not hold goes to the architect (Proof, P5).

1. **`add-json` takes all three types at all three scopes and writes each as given** (2:20, `adds`): nine calls `claude mcp add-json <name> '<json>' --scope <scope>`, `http` and `sse` with a header and `stdio` with arguments and a variable, each succeeded with one line, "Added <type> MCP server <name> to <scope> config", and each entry in the file equal to the JSON given: `user` in the top-level `mcpServers` of `.claude.json`, `local` under `projects[<root>].mcpServers`, `project` in `<root>/.mcp.json`. A session started afterwards read all nine connected.
2. **Its refusals** (2:20, `refusals`), each exit 1 with nothing written: a name with a colon, a dot or a space: "Invalid name <name>. Names can only contain letters, numbers, hyphens, and underscores."; a name already at the same scope: "MCP server <name> already exists in <scope> config"; a JSON with no `type`: "Invalid configuration: : Invalid input".
3. **What it does not check** (2:20, `refusals`): `{"type":"http","url":"not a url"}` was accepted and written; a name already defined at `user` scope was accepted at `local` scope, leaving one name with two definitions; type `ws` was accepted.
4. **Its default scope is `local`** (2:20, `mcpGetCliHelp`), so `--scope` is always given, as `mcp add`'s is today.
5. **Today's switch** (2:14, 2:18, 2:19): `mcp_toggle` changes the session that is told and the place's list; live sessions in the same repository keep the connector; new ones start from the list.

The runner runs whichever engine the launcher resolves (the person's installed Claude Code, or the binary chosen in Settings › Engine), which may be another version than the probes'. Nothing here reads a version: on an engine that refuses the command or an entry, the person reads that engine's own words on the add's line, and MAWS has written nothing.

Read in the engine's source and **not run** (`cli.pretty.js` of 2.1.322, cited as `research/SOURCES.md` prescribes); each is named in "Reported to the architect":

- A `stdio` entry's `args` defaults to an empty list and its `env` is optional (`:953142`). The recorded runs gave both. G1's scene runs an entry with no variable and no argument on the real engine at the gate.
- `${NAME}` and `${NAME:-default}` in a configured entry's command, arguments, variables, URL and headers are expanded from the environment of the engine's process; a name that is not set is left as written (`:475677-475700`, `:388401-388428`). Toward a remote server, variables the engine classes as credentials are read as empty, with a line in its debug output only (`:388405`, `:388426`). The `.mcp.json` warning's advice rests on this reading.

## What the code says today (checked at the pin)

1. **Discover's add.** `connectors.add` (`src/shared/ipc/schema/connectors.ts`: `cwd`, `binary`, `name`, `scope`, `url`, `transport`) is answered by the engine host (`src/engine-host/ipc.ts`), which starts the runner's action `mcp-add`; `mcpCommandLine` (`src/shared/plugins/cli.ts`) builds `mcp add --transport <http|sse> <name> <url> --scope <scope>`. Its owner is `engine-host`, its grade `machine-admin` (`src/shared/ipc/grades/connectors.ts`), it is a path command (`PATH_COMMANDS` in `src/shared/ipc/routes.ts`), and it has no row in `src/endpoint/offers.ts` (`test/endpoint/artifact-rows.test.ts` pins `undefined`). The window sends it with `{ machine: ipc.localMachine }` (`widgets/plugins/operation.ts`).
2. **A new member of the runner's action list is a wire major.** `plugins.operation`'s `action` is `z.enum(RUNNER_ACTIONS)` and the event is in the wire's manifest; `src/shared/ipc/wire.ts` classes "an added enum member" as breaking, "since an older reader refuses it". So a custom add cannot be a new action name. It runs as the action `mcp-add` with another input, behind a new command, which is additive (§B).
3. **Where the runner hands a CLI's words on** (`src/engine-host/plugins/runner.ts`, `cli-result.ts`): (a) each non-empty line of stdout and stderr, trimmed, as an `output` event (`exec`'s `hear`, through `run`'s `emit`); (b) the outcome's `message`, read by `mcpOutcome` from stdout's first line on exit 0, else from the last line of stderr or stdout; (c) `op.latest`, the last event of a running operation, sent again to a client that connects (`running()`); (d) the message of a failure the runner words from an error object: a spawn that threw or failed (Node's own message, which can quote an argument it refuses); (e) `console.warn` in `start`'s catch, with a thrown error's message, into the engine host's log. `finish` emits the `done` event directly, not through `run`'s `emit`.
4. **The sheet's Details holds the argument list twice**: as text (`commandWords`) and as the attribute `data-plugins-argv` (`customize/connectors/ConnectorSheet.tsx`); both come from `argvOf` (`widgets/plugins/present.ts`), which only sheets call.
5. **A window keeps the request of every operation it started** (`OperationBook.entries` in `widgets/plugins/operation.ts`), input included, for as long as the section stays mounted.
6. **A remote action cannot reach an engine-host command that names no session**: `host.op` answers `unavailable` when the input has no `appSessionId`, and `host.artifactOp` runs only its own closed list (`src/engine-host/ops.ts`). `plugins.operation` is not among the events the endpoint forwards to another device (`ADMIN_EVENTS` in `src/endpoint/artifacts-feed.ts`).
7. **The name check.** `existingOf` (`customize/connectors/present.ts`) finds a name among the inventory's servers for the page's folder, MAWS's own list included (scope `app`); `configuredOf` says whether that read was whole; the sheet reads `plugins.env` again at every opening but not the inventory, whose answer may be up to 30 s old (`INVENTORY_STALE_MS`) and does not hear a change made in a terminal.
8. **After a mutation** the runner calls `changed()` whatever the outcome; every reader of the inventory reads again (`useReadAgainAfterPluginsChange`). An MCP change reloads no session.
9. **The dialog's sentence** is `MCP.reach` in `widgets/copy.ts`, drawn once as the frame's note by `McpWidget` with `MCP.reachTip`. Pinned by `widgets/McpWidget.test.tsx` (eight expectations), `widgets/McpDriven.test.tsx` (one, of its absence), `e2e/widgets.spec.ts` (two) and `e2e/c11-live.spec.ts` (one).
10. **The tests' fake CLI.** `runner.test.ts` writes a shell script as the binary, whose behaviour each case sets. The stub CLI of the e2e groups `widgets`, `settings` and `ux2-shell` (`test/support/plugin-cli-stub.ts`) refuses every `mcp` verb; only the `discover` group runs the real engine's CLI, under a scratch configuration directory (`e2e/discover-connectors.spec.ts`).
11. **Build F reads such an entry.** Its inventory takes any entry's name, scope, file and `type` and ignores its other keys (`git show f1852de3a:src/engine-host/customization/inventory.ts`, the same three lines as today's).

## Reported to the architect

None of these stops the build; each is written here at its recommended default, and a ruling changes the one place named.

| | what | the default built | the one place |
|---|---|---|---|
| 1 | The `.mcp.json` warning advises `${NAME}`. That the engine expands it is read in its source, not run, and the same source reads some credential-named variables as empty toward a remote server. | The sentence as the design gives it. | `CONNECTORS.sharedFileWarning` (§E). A probe case would be: an entry added with a header `${X_PROBE}` at `project` scope, the variable set, the header the stub server receives. |
| 2 | A `stdio` entry with no `env` key, or with `args: []`, is read in the source, not run. | `env` and `headers` left out when empty; `args` always sent. G1's scene runs it on the real engine at the gate. | `mcpEntryJson` (§A). |
| 3 | The design gives the labels, the three types, the three scope choices, the secrets sentence, the warning and the head's sentence. It gives no words for the sheet's title, the refusals of a field, or the note under Command. | §E's rows marked "this document's". | §E. |
| 4 | Where a running or failed add says so: the design names the row that appears, not the time before it. | One line at the head of the list, under the connector's name, as a removed row's result stands today. | M2's decisions. |
| 5 | The value fields show what is typed. The design asks for no masked field. | Plain text fields. | M2's decisions. |
| 6 | No ruling listed for this design is reversed by this landing alone: adding in Settings is not retired here, so P4-R8's amendment belongs to the landing that retires it. The sentence U11a built stands in U11a's execution document. | One dated line at that document's §C; no other amendment. | M3, "The record". |
| 7 | The custom add is the runner's action `mcp-add` behind a new command, not a new action (code, 2). | As §B. | §B. |

## Acceptance

Each is behaviour someone can check; the commands are in Concrete Steps, the runs an executor cannot make in Proof.

- **G1 · A custom local command is added for all projects, and nothing MAWS keeps holds its value.** In Customize › Connectors › My items, "Add custom connector…", Local command, a command, two arguments and one variable, Add to "All projects", Add: the sheet closes, the row appears with `user scope · stdio` and Remove, and the engine's configuration holds exactly `{"type":"stdio","command":…,"args":[…,…],"env":{…}}` under that name. A second add with no argument and no variable is written too. The engine's own `mcp list` names both. That the next chat and the next terminal session load such an entry is Engine facts, 1. No `plugins.operation` event, no line of the engine host's log and no text of the page holds the variable's value: M1's and M2's sentinel tests, which fail before and pass after.
- **G2 · A remote connector with a header, shared in the project.** On a project's page: Remote (HTTP), a URL, one header, Add to "<project>, shared in its .mcp.json". The warning about a committed file is shown once the header has a name, and the secrets sentence under the row. After Add the project's `.mcp.json` holds `{"type":"http","url":…,"headers":{…}}`, and the row reads `project scope · http` with Sign in by the existing rule. With Details open the command shows `•••` where the value is.
- **G3 · The form refuses what the engine would take.** A URL that is not `http` or `https` with a host; a name configured at any scope the page reads, or held by MAWS's own list, with that entry shown; `maws` and a name the engine reserves; arguments that end inside a quote: each disables Add and says why. While the configuration is being read, or could not be read whole, Add waits and says so.
- **G4 · The arguments are shown as they will be passed.** Typing `--root "/tmp/my files" -v` shows three boxes: `--root`, `/tmp/my files`, `-v`. The entry written holds those three strings.
- **G5 · The dialog's sentence.** In a chat MAWS runs, "+" › Connectors › "Connectors in this chat…" shows once, in the head, "A switch here is for this chat, and every session started in <place> afterwards.", with today's tooltip; no row repeats it; a terminal session's dialog shows no such sentence. Nothing else of the dialog, and nothing of Discover's add, of Remove or of Settings › Sessions › MCP servers, behaves differently.
- **G6 · Only this machine, only this app's windows.** The new command has no offer over the machine link and answers a remote caller `not-offered`; a remote action naming it is answered `unavailable` by the engine host and leaves no ledger line.

## Constraints that bind every milestone

- **The design binds** as this document writes it. Stop and hand the point back to the architect, with the evidence, where the code contradicts a statement the work rests on, where the work needs an edit in a file another child owns, where a contract or another child would have to change, or where the owner would see something this document does not say. Everything else is decided in the spirit of the design and recorded in the Decision Log.
- **Law 6, and the engine.** Nothing depends on an engine behaviour that "Engine facts" does not hold. No executor runs an engine, the engine's CLI, `pnpm e2e:*` or anything that starts one, on the MacBook, on the VM or anywhere: the runner's tests use the fake CLI their file already writes. A missing fact goes to the architect.
- **Law 3 and UC-14.** No setting is added. Neither settings file changes its schema, its version or a value. No layout key is added. MAWS stores nothing for this landing.
- **Law 7.** Today's tokens and shapes only; the sheet is built from the parts today's connector sheet uses (`Sheet`, `SheetForm`, `FIELD`, `CHOICE`, `SheetDetails`).
- **What stays, and law 8.** Discover's add, Remove, sign-in and the Settings row behave as before: in their tests an assertion on what is sent or written is not edited. The plugin library inside a session is the owner's `keep` (l8-settings-10), and it shares `widgets/plugins/operation.ts` and `present.ts` with this work: for every request that is not a custom add, what those two files send, keep and show is what they send, keep and show today, and an executor who finds otherwise stops and reports.
- **The child's bindings 9, 11, 14, 15.** Customize reads and changes this Mac only. No test makes an engine sign-in or a Keychain write. Nothing under `src/endpoint` changes.
- **The values.** §C's rule holds at every milestone's head. A refusal, a thrown error, a test name and a log line name a field, never a value.
- **The wire.** Additive only: one new command, one minor. No member is added to any enum of the wire. `WIRE_MINOR` takes the next number on the master the branch last merged, with its comment, and the generated files are made again after every later merge of master that moved it (Concrete Steps, 3 and 5). The bounds of §B's schema are fixed for the wire's major once they land: changing one is a major.
- **UC-8.** Every file this landing edits is U11's by UC-8's table (`customize/`, `widgets/`, `sessions/Sheet.tsx` if at all) or is given to nobody (`src/shared/plugins/`, `src/shared/engine/app-mcp-servers.ts`, `src/engine-host/plugins/`, `src/engine-host/ipc.ts`, `src/engine-host/connectors/register.ts`, the connectors' names, schema, grades and routes under `src/shared/ipc/`, the tests under `test/` and `e2e/` named in the milestones). The wire's own files (`src/shared/ipc/wire.ts` and the generated four) are held by nobody and edited by each landing that moves the minor: this landing is one more, under that row's rule (merge master, then make them again right before the gate).
- **UC-11, the repository is public, and the privacy rule.** Nothing of the owner's enters code, tests, fixtures, comments, commit messages or this document. Test content is invented: names like `files-probe`, hosts under `example.test`, values like `value-one`. A test value is never shaped like a credential (no long random string, no `Bearer` followed by one): class 1a's static scan reads a long id beside a key named like a credential as a secret. A fault is never reproduced by reading the content of a person's session, settings file or configuration file: structure and counts only, and none of it goes into the repository. Every test that touches a configuration file runs under a scratch directory.
- **Renderer source** never writes a number sign followed by digits (a ticket is "ticket 476"): the tokens guard reads it as a colour.
- **Where checks run (UC-10).** The worktree on the MacBook carries no `node_modules`; nothing is installed, typechecked, linted, tested, built or launched there. Every check runs on the wave's build VM in a checkout of the pushed head, under a time limit. Class 1a, every Electron e2e run and every probe are the architect's. If a command fails with "No space left on device": stop, tell the architect, delete nothing.
- **Git.** Commit as you go and push `ux-wave/U11g`. Merge master, never rebase, never force-push. Never commit to master or to `ux-wave-spec`; never edit the spec's files. Every commit message ends with the `Sminos-Session:` line the dispatch gives, and carries no other attribution.

## Plan of Work

Three milestones. Each is one executor's from this document and the code, is reviewed at its boundary, and leaves the typecheck, lint and the tests it names green. M2 consumes M1's §A and §B; M3 consumes nothing. M1 can start at once; M2 waits for the owner's look (Proof, P1) unless the architect releases it at §E's defaults; M3 can be built at any time and closes the landing.

Expected size, lines added plus removed, tests included: M1 about 750, M2 about 800, M3 about 120. About 1,650 lines over about 40 files, of which about fifteen are one-line registrations and generated files.

### M1 — The rules, the command and the runner that keeps values out of every line

**At its end** the engine host answers a new command, `connectors.addJson`, by running `claude mcp add-json` as an operation, and nothing that operation says to anyone holds a header's or a variable's value. No window calls it yet.

**Touches.** `src/shared/plugins/argv-split.ts` (new) and its test; `src/shared/plugins/cli.ts` and `cli.test.ts`; `src/shared/engine/app-mcp-servers.ts` and its test (one exported predicate for the reserved names); `src/shared/ipc/schema/connectors.ts`, `names/connectors.ts`, `grades/connectors.ts`, `routes.ts`, `wire.ts` and the generated files; `src/engine-host/ipc.ts`, `src/engine-host/connectors/register.ts`, `src/engine-host/plugins/runner.ts`, `cli-result.ts` and their tests; `src/engine-host/ops.test.ts`; and every exact list that names `connectors.add` (`git grep -n "connectors.add"` shows them: among them `src/shared/ipc/schema.test.ts`, `test/support/cross-build-samples.test.ts`, where the new name joins `NOT_YET_NAMED`, and `test/endpoint/artifact-rows.test.ts`, where it joins the names with no offer).

**Interfaces.** Exposes §A (the splitter, the entry, the command line, the values, the replacement, the shown line) and §B (the command). Keeps §C.

**Decisions.**
- *One action, two inputs* (code, 2): `McpActionInputs['mcp-add']` is today's shape or `{ name, scope, entry }`; `mcpCommandLine` builds `add-json` for the second. `RUNNER_ACTIONS` is not touched. The alternative, an action `mcp-add-json` mapped back to `mcp-add` on the event, is a second name for one thing.
- *The replacement is made on the CLI's text before anything reads it*, and again on every message the runner did not word itself. Before, because the reader trims each line and `mcpOutcome` picks lines: a value with a space at its end, printed at a line's end, would no longer match after the trim. So: each raw line as the reader assembles it, and the whole of stdout and of stderr before the outcome is read; then the message of a failed spawn and of a thrown error; then the log line. An operation with no value (every plugin verb, `mcp add`, `mcp remove`) passes its text through untouched, and the existing cases stay as they are.
- *A value never spans lines*: §B's schema refuses a control character in any string of an entry, so a value holds no line break and the line reader's own joining of chunks is enough.
- *What is replaced* (§A): each value as written and as JSON writes it inside a string, longest first, in one pass. Not replaced: a value the CLI printed in some other encoding. No run shows the CLI printing a value at all.
- *A short value* ("1") is replaced wherever it stands, also inside the engine's own words; over-replacing is the safe side and is left so.
- *The builder and the schema refuse with fixed words.* `mcpCommandLine`'s errors for an entry and the schema's `refine` messages name the field. One rule, `mcpEntryProblem`, is read by the builder, the schema and (M2) the form, so the three cannot disagree.
- *Authorization is what `connectors.add` has*: owner `engine-host`, grade `machine-admin`, a path command, bridged to the window, no offer, no entry in `remote-unavailable.ts` (it is not an act on a session).
- *The wire*: after the schema, names, grades and routes are edited, Concrete Steps 3.
- *Pitfall*: `finish` emits `done` without passing `run`'s `emit`; `op.latest` is set in `emit`. Both must hold cleaned text, or a client that connects mid-run is sent the raw line again.

**Does not touch.** The renderer. `connectors.add`'s schema and line. `plugins.operation`'s schema. `src/endpoint/`. The e2e stub CLI.

**Proves** G6, and G1's "nothing MAWS keeps holds its value" for the engine host. Its tests pin:
- the splitter's table (§A), every row, and that it expands nothing;
- the exact `add-json` argument list for each type, with and without headers, variables and arguments, the key order of the JSON, and today's `mcp add` and `mcp remove` lines unchanged;
- `mcpEntryProblem`: one case per rule of §A's table, and that the builder throws on each with a message that holds no value;
- the schema: the three types accepted; `ws`, an unknown key, a header on a local command, a variable on a remote one, a control character, each bound's first value over, a duplicate name, `maws` and a reserved name refused; and that the `invalid_input` answer for an entry whose refused value is a sentinel does not hold the sentinel;
- the runner, with the fake CLI: the command received, argument by argument; the outcome on exit 0 and on exit 1 in the CLI's words; `changed()` told; no reload asked;
- **the sentinel cases** (fake CLI; values that hold a quote, a backslash, a regular-expression character, and one with a space at each end): the CLI prints its whole argument list on stdout and on stderr over several lines, as its first stdout line, and, in a second case, exits 1 with the JSON as its last stderr line: no `plugins.operation` event of any phase, no answer of `running()` and no captured `console.warn` holds a sentinel, while the rest of each line is kept with `•••` in place;
- **held open**: the fake CLI prints a line holding a value and then waits; `running()` asked at that moment answers the cleaned line; the CLI is released and the operation ends;
- a spawn that throws an error whose message quotes the argument list (through the `spawn` seam): the outcome is `spawn_failed` and its message and the log hold no sentinel;
- a cancel while it runs, the timeout and the overflow end with their own words, unchanged;
- `host.op` naming `connectors.addJson` answers `unavailable`, calls no handler and leaves no claim; the command has no offer, and a remote call of it answers `not-offered`.

### M2 — The sheet and the action in Customize

**At its end** a person can add a custom connector from Customize › Connectors › My items, as "The design of this landing" says, and sees its row.

**Touches.** `src/renderer/src/customize/connectors/` (the sheet as a new component beside `ConnectorSheet.tsx`, the form's rules as pure functions beside `present.ts`, `copy.ts`, `ConnectorsSection.tsx`, and their tests); `src/renderer/src/widgets/plugins/operation.ts` and `present.ts` with their tests; `src/renderer/src/customize/CustomizeView.test.tsx`; `e2e/discover-connectors.spec.ts` (one scene, written and typechecked here, run by the architect).

**Interfaces.** Consumes §A and §B. Exposes §D.

**Decisions.**
- *The sheet reads its starting values from the request it is opened with* (`requestFor('mcp-add', { name: '', scope: 'user', entry: { type: 'http', url: '', headers: [] } }, null)`), as today's sheet reads the directory's. The later landing that moves an entry of MAWS's own list opens it filled in by the same way.
- *The form's rules are pure functions* the sheet and the tests read, as `present.ts`'s are: from the typed fields to an entry or to the first problem of each field. They call `splitArgs`, `mcpEntryProblem`, `isMcpName`, `isMcpUrl`, the reserved-name predicate and `existingOf`, and add no rule of their own. The one thing they change is the command, whose end spaces they drop (the field cannot trim as the person types, or a path with a space could not be typed); every other field goes into the entry as typed.
- *The name is checked against a read made at this opening.* Opening the sheet reads the inventory again, and Add waits for an answer newer than the opening, under today's "Reading what is configured here…"; an older answer vouches for nothing, since a connector added in a terminal a moment ago is not in it (code, 7). Discover's sheet is not changed. Two adds of one name at two scopes started at the same moment from two windows both pass; the rows then show which one the engine uses ("Shadowed by…"), and nothing more is built for it.
- *The command a sheet shows is the shown line.* `argvOf` (`widgets/plugins/present.ts`) answers §A's `mcpShownLine` for an MCP action, which equals today's line for every request but a custom add; so the text and the attribute `data-plugins-argv` of Details hold `•••` for each value, and no code in the window builds the real argument list.
- *The window forgets the values at the send.* `OperationBook.run` sends the request's input and keeps the request with its values replaced by `MCP_MASK` (code, 5), so what the book holds while the section is mounted holds no value. The sheet's own state goes when it closes.
- *The value fields are plain text fields* (Reported, 5), with spelling checks off, as the sheet's other fields are.
- *An add's line* (Reported, 4): keyed `connector:add:<scope>:<name>`, drawn at the head of the list under the name while its operation is working or has failed, by the component a removed row's result uses (`Gone`), with Cancel while it runs as every operation line has. A succeeded add draws nothing there: its row is the result. A failed line stays until an add of the same name and scope replaces it or the page changes.
- *Which command a request sends*: a request whose input holds an `entry` sends `connectors.addJson`; every other request sends what `COMMAND_OF` says today.
- *The warning and the secrets sentence* are drawn by the chosen type's rows: the secrets sentence under them while there is at least one row, filled or not; the warning while the scope is `project` and at least one row has a name or a value.
- *Pitfalls seen*: `forgetSignIn({ name, scope, cwd })` after a successful change stays as it is and serves a custom add too; the section is keyed by its folder, so choosing another project closes the sheet and drops the lines, while the operation runs on in the engine host and its row is there on return.

**Does not touch.** `ConnectorSheet.tsx`'s two sheets beyond the dispatch to the new one. `McpServersSettings.tsx`. `CustomizeView.tsx` (the section's props are enough). The e2e stub CLI, which keeps refusing `mcp`.

**Proves** G1 to G4 in the window. Its tests pin:
- the action is at the head of My items on the user configuration's page and on a project's page, not in Discover; it opens the sheet with Remote (HTTP) and "All projects";
- for each type, the fields drawn, and that Add sends `connectors.addJson` with exactly `{ cwd, binary, name, scope, entry }` to this machine; that a row with no name and no value is not sent; that the other type's fields are not sent;
- each refusal of G3 with its sentence from §E, Add disabled; the three scope choices on a project's page and the plain line on the user configuration's;
- **held open**: with an older inventory answer in hand and the opening's read still out, Add is disabled; when the read answers with the typed name in it, the name is refused and that entry shown; when it answers without it, Add is enabled; when it fails, Retry is offered and Add stays disabled;
- the split shown under Arguments for G4's line and for an empty argument; a line ending in a quote shows the sentence and no boxes;
- the secrets sentence and the warning appear and leave by the rule above;
- with Details open, no text and no attribute of the sheet outside the value fields themselves holds a sentinel, and the command reads `•••` in its place;
- **held open**: after Add the sheet is closed and the line reads "Working…"; an `output` event shows its line; a second add of another name is started; the first ends failed and its line reads the engine's words while the second still works; the second ends well, its line leaves, and its row is drawn when the inventory answers;
- after the send, nothing the operations book holds contains a sentinel;
- a refused send (`unknown_command` from an engine host of an older build) reads the transport's words on the line and nothing else changes.

The scene added to `e2e/discover-connectors.spec.ts`, beside the `add` case and with its scratch configuration directory: G1 as written (the scratch configuration's entry compared whole, `mcp list` naming both adds, the row in My items), then G2's add at `project` scope on the page of the scratch project the group's harness already has (the `.mcp.json` compared whole, the warning and the masked command seen before Add). Invented names and values; no sign-in, no Keychain item.

### M3 — The dialog's sentence, the record, the whole checks, the hand-back

**At its end** the Connectors dialog's head carries the new sentence, the landing's record is written, and the acceptance has been run as far as an executor can run it.

**Touches.** `src/renderer/src/widgets/copy.ts` (`MCP.reach`); `widgets/McpWidget.test.tsx`, `widgets/McpDriven.test.tsx`; `e2e/widgets.spec.ts`, `e2e/c11-live.spec.ts`; the comments in `widgets/` that quote the old sentence; this document; one dated line in `docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md`.

**Decisions.**
- `MCP.reach(place)` answers `A switch here is for this chat, and every session started in ${place} afterwards.`; `MCP.reachTip` and everything that draws them stay.
- The expectations follow the words and nothing else: the eight of `McpWidget.test.tsx` (the pattern becomes `/^A switch here is for this chat, and every session started in .+ afterwards\.$/`, the exact ones name the same places), the absence in `McpDriven.test.tsx` (of "A switch here"), the two patterns of `e2e/widgets.spec.ts` and the one of `e2e/c11-live.spec.ts`. `c11-live` has no gate group: its edit is typechecked and runs at the next live sitting.
- *The record* (Reported, 6): under §C's table of U11a's execution document, one line: "2026-11-14, UX wave U11g: the head's sentence is now “A switch here is for this chat, and every session started in <place> afterwards.” (`docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md`); today's sentence claimed sessions that are open, which the engine does not tell." Nothing else of that document changes.
- Then Concrete Steps 5 and 6: master merged, the wire's files made again if the minor moved, the whole typecheck, lint, the whole unit suite once, the scan, the script tests, and the hand-back.

**Does not touch.** The dialog's rows, switch, place or tooltip. The Connectors card. The unstarted chat's dialog and its line.

**Proves** G5, and runs the acceptance: each of G1 to G6 by the tests that pin it, named in the hand-back with the command and its result, and what only the architect's runs can show named as such.

## Concrete Steps

From the worktree of branch `ux-wave/U11g`. `vmcheck` below stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U11g --`.

1. **Master first.**

       git fetch origin master && git merge origin/master

   Then, for each file this document names that the merge changed (`git diff --name-only 3514e9cda origin/master`), read it again against "What the code says today" before building on it. If master now holds U11c's Customize (no "Configured on disk" toolbar left in `customize/connectors/ConnectorsSection.tsx`), stop and report: "Where" then names a head that is gone.

2. **Each milestone**, tests first where a test can fail first. Push before every check: the VM sees only what is on origin.

       git push -u origin ux-wave/U11g
       vmcheck 'timeout 900 pnpm exec vitest run <the test files and folders the milestone names>'
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'   # main, the hosts and shared code; tsconfig.web.json for the renderer; tsconfig.e2e.json for e2e/
       vmcheck 'timeout 600 pnpm exec eslint <the paths the milestone changed>'

   Each call prints `vmcheck: ux-wave/U11g at <short sha>` and then the command's output; its exit status is the command's. At a tests-first commit vitest fails on the new assertions; at the milestone's head it prints `Test Files … passed` with no failure, and `tsc` and eslint print nothing. M1 runs `src/shared/plugins src/shared/engine src/shared/ipc src/shared/machine src/engine-host/plugins src/engine-host/ops.test.ts src/engine-host/ipc-e8.test.ts src/engine-host/ipc-e10.test.ts src/engine-host/supervision.test.ts test/endpoint/artifact-rows.test.ts test/support/cross-build-samples.test.ts test/support/plugin-cli-stub.test.ts test/lane-b`. M2 runs `src/renderer/src/customize src/renderer/src/widgets test/lane-b/renderer-guards.test.ts test/support/tokens-guard.test.ts` and the e2e project's typecheck. M3 runs `src/renderer/src/widgets test/support/tokens-guard.test.ts` and the e2e project's typecheck before the whole checks of step 5.

3. **M1, the wire.** After the schema, names, grades and routes are edited, take the next `WIRE_MINOR` on the master last merged (47 at the pin; merge again first if master has moved), with its comment ("the UX wave's U11g: connectors.addJson"), then make the generated files again on the VM and bring the result back:

       G='src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json src/shared/ipc/routes.json src/shared/machine/address-paths.json'
       vmcheck "pnpm wire:manifest >/dev/null; MAWS_ROUTES_WRITE=1 pnpm exec vitest run src/shared/ipc/routes.test.ts >/dev/null; MAWS_ADDRESS_PATHS_WRITE=1 pnpm exec vitest run src/shared/machine/coverage.test.ts >/dev/null; git diff -- $G; git checkout -- $G" > /tmp/u11g-wire.patch
       sed -n '/^diff --git/,$p' /tmp/u11g-wire.patch | git apply

   Expect the patch to add `commands.connectors.addJson` and the minor to the manifest, one name to `routes.json` and a new value in `wire-fingerprint.json` (it covers every command the engine host owns), and nothing under `events.plugins.operation` and nothing in `address-paths.json` (the command names no session). A line under the event means an enum moved: undo it (code, 2). Then `vmcheck 'timeout 900 pnpm exec vitest run src/shared/ipc src/shared/machine test/lane-b/offer-coverage.test.ts'` passes.

4. **M1 and M2 add tests with keys named like credentials** (a header, a variable). Run the scan before each hand-back: `vmcheck 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'`. It passes; a failure names the file, and the cure is a plainer invented value, not an allow-list entry.

5. **M3, master again, then the whole checks.**

       git fetch origin master && git merge origin/master
       grep -n "export const WIRE_MINOR" src/shared/ipc/wire.ts | cut -c1-60

   If the merge conflicted in `wire.ts` or in a generated file, or master's minor is now this branch's or higher: keep master's comment, give this landing's addition the next number after master's, take master's side of the four generated files, and run step 3's regeneration again. Then:

       vmcheck 'timeout 900 pnpm typecheck'
       vmcheck 'timeout 900 pnpm exec eslint src/shared/plugins src/shared/engine src/shared/ipc src/engine-host/plugins src/engine-host/ipc.ts src/engine-host/connectors src/renderer/src/customize src/renderer/src/widgets e2e/discover-connectors.spec.ts e2e/widgets.spec.ts e2e/c11-live.spec.ts'
       vmcheck 'timeout 2400 pnpm test'
       vmcheck 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'
       vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

   Then the acceptance's own tests, named, so the hand-back can quote one result for G1 to G6:

       vmcheck 'timeout 900 pnpm exec vitest run src/shared/plugins src/engine-host/plugins src/engine-host/ops.test.ts test/endpoint/artifact-rows.test.ts src/renderer/src/customize/connectors src/renderer/src/customize/CustomizeView.test.tsx src/renderer/src/widgets/McpWidget.test.tsx src/renderer/src/widgets/McpDriven.test.tsx'

   It prints `Test Files … passed` with no failure. G1's values and G6 are shown by the first four paths, G1 to G4 in the window by the next two, G5 by the last two; what the real engine writes (G1, G2) is the scene's, in Proof P2.

   `pnpm typecheck` takes about five minutes and prints no error. In `pnpm test` the files the build brief lists as failing on master too are not this landing's; any other failure is. The script tests pass: this landing adds no spec file and no time bound to a scene. Look at a run in the background before its limit has passed twice; a log that has stopped growing beside a process at full CPU is a loop, and a finding.

6. **Stop and hand back.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e, engine or probe. The hand-back says: what exists, with the command and result that showed it; the master and the wire minor the branch stands on; what is not verified (every e2e scene; Reported 1 and 2); the decisions made; anything that contradicts this document; the residue. Residue known at authoring, each a row for the debt tracker at landing:
   - a value is readable in the CLI's arguments by the person's own processes while it runs (accepted by the design);
   - a value the CLI printed in an encoding other than as written or as JSON writes it would not be replaced (no run shows the CLI printing one);
   - two adds of one name at two scopes from two windows at the same moment both pass the name check;
   - a Cancel pressed after the CLI has written is not an undo: the row appears at the next read;
   - on a page whose folder is a linked worktree nothing can be added, at any scope, until the resolver's fix of the switches' landing;
   - the list of names the engine reserves (`src/shared/engine/app-mcp-servers.ts`) was written against engine 2.1.304 and is not re-read here; a name a later engine reserves is added and then not loaded;
   - an argument is not treated as a value: a secret passed as an argument is shown back and is in the configuration, as typed.

7. **The architect's, after the hand-back.** Proof P2 to P4.

## Interfaces and Dependencies

### §A. The shared rules (`src/shared/plugins/`; pure, zod-free, read by the window and the engine host)

**The splitter** (`argv-split.ts`, new):

    export type ArgvSplit = { ok: true; args: string[] } | { ok: false; problem: 'open-single-quote' | 'open-double-quote' | 'trailing-backslash' };
    export function splitArgs(line: string): ArgvSplit;

It splits one line into words as a POSIX shell does, and does nothing else a shell does:

| in the line | reads as |
|---|---|
| spaces and tabs outside quotes | separate words; any number is one separator; none at the ends makes a word |
| `'…'` | its content exactly; no escape inside, so a single quote cannot be inside |
| `"…"` | its content; inside, a backslash before `"`, `\`, `$` or a backquote gives that character; a backslash before any other character stays, with that character |
| `\x` outside quotes | the character `x`, whatever it is (`\ ` is a space inside the word) |
| quoted and unquoted parts with no space between | one word (`a"b c"d` is `ab cd`) |
| `''` or `""` standing alone | one empty word |
| `$NAME`, `${NAME}`, `*`, `~`, a backquote | themselves: nothing is expanded (the engine expands `${NAME}` when it loads the entry) |
| a line that ends inside `'…` or `"…`, or on a lone `\` | refused, with the problem named |
| an empty line, or only spaces | no words |

**The entry and its one rule** (`cli.ts`):

    export const MCP_ENTRY_TYPES = ['http', 'sse', 'stdio'] as const;
    export type McpPair = { name: string; value: string };
    export type McpEntry =
      | { type: 'http' | 'sse'; url: string; headers: McpPair[] }
      | { type: 'stdio'; command: string; args: string[]; env: McpPair[] };
    export const MCP_ENTRY_BOUNDS = { headers: 64, env: 128, args: 256, pairName: 256, value: 8192, command: 4096, arg: 8192, url: 4096, json: 32768 } as const;
    export type McpEntryProblem = { field: 'url' | 'command' | 'args' | 'headers' | 'env' | 'entry'; index: number | null; code: 'url' | 'empty' | 'space' | 'name' | 'duplicate' | 'control' | 'too-long' | 'too-many' | 'too-large' };
    export function mcpEntryProblem(entry: McpEntry): McpEntryProblem | null;   // the first problem, or null

| rule | code |
|---|---|
| the URL holds for `isMcpUrl` and is at most 4,096 characters | `url`, `too-long` |
| the command is not empty, has no space at either end, at most 4,096 | `empty`, `space`, `too-long` |
| at most 256 arguments, each at most 8,192 (an empty one is allowed) | `too-many`, `too-long` |
| at most 64 headers and 128 variables | `too-many` |
| a header's name is 1 to 256 characters of an HTTP token (letters, digits and ``!#$%&'*+-.^_`|~``); a variable's name is 1 to 256 of a letter or underscore, then letters, digits and underscores; neither is `__proto__`, which a JSON object cannot carry as an ordinary key | `name` |
| no two headers share a name, case ignored; no two variables share a name | `duplicate` |
| a value is at most 8,192 characters; it may be empty | `too-long` |
| no string of the entry holds a control character (U+0000 to U+001F, U+007F) | `control` |
| the JSON text is at most 32,768 bytes of UTF-8 | `too-large`, field `entry` |

A problem names a field and a row, never a value.

**The command line.**

    export interface McpActionInputs {
      'mcp-add': { name: string; url: string; transport: McpTransport; scope: PluginsScope } | { name: string; scope: PluginsScope; entry: McpEntry };
      'mcp-remove': { name: string; scope: PluginsScope };
    }
    export function mcpEntryJson(entry: McpEntry): string;

`mcpEntryJson` is `JSON.stringify` of an object with its keys in this order: for a remote entry `type`, `url`, then `headers` (name to value, in the rows' order) only when there is at least one; for a local one `type`, `command`, `args`, then `env` only when there is at least one. `mcpCommandLine('mcp-add', { name, scope, entry })` answers `['mcp', 'add-json', name, mcpEntryJson(entry), '--scope', scope]`, and throws, in fixed words, when the name fails `isMcpName` or the entry has a problem. For today's two inputs it answers what it answers today.

**The values, and their replacement.**

    export const MCP_MASK = '•••';
    export function mcpSecretsOf(input: McpActionInputs[McpAction]): string[];     // every non-empty header and variable value of an entry; [] for any other input
    export function withoutSecrets(text: string, secrets: readonly string[]): string;
    export function mcpShownLine<A extends McpAction>(action: A, input: McpActionInputs[A]): string[];

`withoutSecrets` replaces, in one pass over the text and longest first, every occurrence of each secret as written and as `JSON.stringify` writes it inside a string, by `MCP_MASK`; with no secret it answers the text itself. The mask has one length whatever the value's. `mcpShownLine` is `mcpCommandLine` of the same input with every header and variable value, empty ones too, set to `MCP_MASK`: the line a sheet shows, built by the one builder, so the two cannot drift.

**The reserved names** (`src/shared/engine/app-mcp-servers.ts`): one exported predicate, true for `maws` and for the names of that file's engine list, which the form and §B's schema read. The list itself is not edited.

### §B. The command (`src/shared/ipc/schema/connectors.ts`)

    'connectors.addJson': host(z.strictObject({ cwd: PluginsCwdSchema, binary: PluginsBinarySchema, name: <McpServerNameSchema, and not reserved>, scope: PluginsScopeSchema, entry: McpEntrySchema }), OperationReceiptSchema)

`McpEntrySchema` is a strict union on `type` of the two shapes of `McpEntry`, each string and list with its bound from `MCP_ENTRY_BOUNDS`, refined by `mcpEntryProblem(entry) === null` under one fixed message. Owner `engine-host`; bridged to the window beside `connectors.add` (`names/connectors.ts`); grade `machine-admin`; in `PATH_COMMANDS`; no offer; not main-only. The engine host answers it with `plugins.start('mcp-add', { name, scope, entry }, cwd, binary)`: a receipt at once, then `plugins.operation` with `action: 'mcp-add'` and `target` the name, `plugins.cancel` stopping it, as for `connectors.add`. On exit 0 the outcome's message is the CLI's first line; on a refusal, its last line.

A machine whose engine host is of an older build answers `unknown_command`; nothing ran.

### §C. The runner's rule (`src/engine-host/plugins/runner.ts`)

An operation carries `secrets: readonly string[]`, `mcpSecretsOf(input)` for an MCP action and empty otherwise. **For an operation with secrets, no string that leaves the runner holds one.** The exits, all of them (code, 3):

| exit | made clean by |
|---|---|
| an `output` event's `line` | the raw line is passed through `withoutSecrets` before it is trimmed or read |
| the `done` event's outcome (`result.message`, `error.message`) | stdout and stderr are passed through it whole before the outcome is read; a message worded from an error object is passed through it too |
| `running()`'s replay | `op.latest` only ever holds an event already clean |
| the engine host's log (`console.warn` in `start`) | the message is passed through it |
| the receipt, the event's `opId`, `action`, `target` | hold no value by their shape (`target` is the name) |

The operation's `input` and `argv` live in the engine host's memory until the operation ends and are handed to nothing but `spawn`.

### §D. The window (`src/renderer/src/customize/connectors/`, `widgets/plugins/`)

- The sheet: a component of `customize/connectors/` that `ConnectorSheet` draws for a request with action `mcp-add` whose input holds an `entry`; it takes what `ConnectorSheet` takes (`request`, `env`, `onConfirm`, `onClose`) and confirms with a request whose input is `{ name, scope, entry }`.
- The form's rules: pure functions beside `present.ts` (from the typed fields, the page's folder and the configured servers to an entry or each field's problem), exported for the later landing that opens the sheet filled in.
- `argvOf(request)` answers the shown line (§A). The operations book sends `connectors.addJson` for a request with an `entry` and keeps that request with its values masked.
- The add's key is `connector:add:<scope>:<name>`; its line is drawn at the list's head while it works or has failed.

### §E. Words

Exact, with the apostrophes as each file writes them. "The design's" are given by the design; "this document's" are this document's defaults (Reported, 3), each in `customize/connectors/copy.ts` unless said.

| where | words | whose |
|---|---|---|
| the action at the head | Add custom connector… | the design's |
| the sheet's title | Add custom connector | this document's |
| the fields | Name · Type · URL · Request headers · Command · Arguments · Environment · Add to | the design's |
| the types | Remote (HTTP) · Remote (SSE) · Local command | the design's |
| the scope choices | All projects · <project> only · <project>, shared in its .mcp.json | the design's |
| under the rows, once | Saved in Claude Code’s configuration file as written. | the design's |
| `sharedFileWarning` | This file is usually committed with the repository. Write a secret as ${NAME} and set NAME in your environment. | the design's |
| the Connectors dialog's head (`MCP.reach` in `widgets/copy.ts`) | A switch here is for this chat, and every session started in <place> afterwards. | the design's |
| the submit button, the scope line of a single choice, the name's three refusals, the URL's two, the three lines about what is configured here, "Sessions started from now on load it; running sessions do not." | today's (`W.submit['mcp-add']`, `nameRequired`, `nameRule`, `exists`, `urlRequired`, `urlScheme`, `serversReading`, `serversFailed`, `serversPartial`, `takesEffect`) | unchanged |
| a reserved name | This name is reserved by Claude Code or by MAWS. | this document's |
| the row buttons, and a row's two fields | Add header · Add variable · Remove (with the row's name, or its number, as its accessible name) · Name · Value | this document's |
| an empty command | Enter the command. | this document's |
| a command that holds a space | Taken whole as the program to run, spaces included. Arguments go in Arguments. (a note, muted; it refuses nothing) | this document's |
| under Arguments | No arguments · 1 argument · <n> arguments, then the boxes; an empty argument's box reads (empty), muted | this document's |
| arguments ending inside a quote | The arguments end inside a quote. | this document's |
| arguments ending on a backslash | The arguments end with a backslash. | this document's |
| a row with a value and no name | Enter a name for this header. · Enter a name for this variable. | this document's |
| a header's name refused | Use letters, digits and hyphens in a header name, without spaces. | this document's |
| a variable's name refused | Use letters, digits and underscores in a variable name, not starting with a digit. | this document's |
| two rows share a name | Two headers are named <name>. · Two variables are named <name>. | this document's |
| a control character in any field | This field can’t hold a line break or a control character. | this document's |
| a field over its bound, too many rows, the whole too large | This is too long to add. · Too many rows to add. · This configuration is too large to add. | this document's |

### §F. What is stored or sent, and what build F does with it

This landing stores no key of MAWS's own, so it adds no row and no scene to the cross-build coverage table, and relies on build F reading nothing MAWS wrote.

| stored or sent | this landing | build F meeting it | this landing meeting F's | this build, then F, then this build |
|---|---|---|---|---|
| a connector's entry in Claude Code's configuration (the three places of "Scope") | written by the engine's own CLI, as given | **In F's Customize** › Connectors › My items it is a row with its scope, transport and file (F's inventory reads any entry's name and `type` and ignores headers, variables, command and arguments), with Remove (the engine's `mcp remove`) and, for a remote one, Sign in by F's rule; F's Discover sheet refuses its name as configured. F has no way to add one. **In F's sessions** it loads as in this build's: the same engine reads the same file; F's Connectors dialog lists it with its switch. | F writes only the directory's entries (`mcp add`), rows as today | the entry stays as written; a Remove made on F removes it for both |
| `settings.json`, `machine-settings.json`, `layout.json` | nothing: no key, value or version | — | — | unchanged |
| the command `connectors.addJson`; the wire's minor, higher; the wire's fingerprint, changed | sent by this build's window to this Mac's engine host | an engine host of F (a host outlives the app that started it until it is idle) answers `unknown_command`: the add's line reads the transport's words and nothing was written. An app on F never sends it. F speaks the wire by its major and minor and does not read the fingerprint. | — | both pairings are this row |
| `plugins.operation` for a custom add | action `mcp-add`, a value F's reader knows; its lines clean | an app on F that connects while one runs is sent its last event; F's window follows only operations it started and drops it | — | nothing is stored |
| the Connectors dialog's sentence | this window's copy | a session on a machine of build F shows it too, and it is true there: the switch is the same act | — | — |
| the machine link | nothing new crosses it | — | — | — |

### §G. What waits, and what happens meanwhile

| the act waits for | the person acts in between | it fails, or never comes | held open by |
|---|---|---|---|
| the sheet's opening: `plugins.env`, and the inventory read again | they type; Add is disabled; a later opening drops an earlier one's answers (today's `opening` counter) | the binary: its words, no Add. The inventory failed or partial: its sentence and Retry. Never: "Reading what is configured here…" stays and Cancel closes the sheet. | M2's first held-open test |
| the operation: a receipt, then events | the sheet is closed; the line reads "Working…", then the CLI's lines; another add can start under its own key; Cancel on the line stops the CLI; leaving the page drops the lines, not the operation | the engine's words on the line. A send that is refused: the transport's words. Never: the runner ends it at its own ceiling (`CLI_TIMEOUT_MS`) with its words. | M2's second held-open test; M1's replay test |
| the row: the inventory read after `plugins.changed` | they can press Refresh | today's inventory failure line with Retry; the row appears when a read answers | M2's second held-open test, its last step |

### §H. Dependencies on other landings, and what this one exposes

Consumed, by the name each is exposed under. **U11a** (on master): `existingOf`, `configuredOf` and `ConfiguredServers`, `scopesFor`, `writesFor`, `serverKey`, the sentences of `CONNECTORS` named in §E, `useCustomizationInventory`, `MCP.reach` and `MCP.reachTip` with the frame's note, and §C's `<place>` of that document. **U7b** (on master): Customize is a page that `CustomizeView` fills; nothing is called by name. **U6a, U8a, U3a, U13a, U9, U8b**: nothing; no action id, no chord, no act on a session, no offer, no stored key.

Exposed to the later landings of this design and to U11c: `splitArgs`; `McpEntry`, `mcpEntryProblem`, `mcpEntryJson`, the entry input of `mcp-add`; `mcpSecretsOf`, `withoutSecrets`, `mcpShownLine`, `MCP_MASK`; the command `connectors.addJson`; the runner's rule §C, which any later command that carries a value inherits by putting it in an entry; the custom sheet and its form rules, opened from a request (the move opens it filled in); the action's label, which U11c moves to the head's right of My items; the reserved-name predicate.

## Proof that an executor does not run

| | what | when | what it needs | what comes back, and what it decides |
|---|---|---|---|---|
| P1 | **The owner's look at the drawn sheet** ("The owner's look") | before M2 | the drawing, made by the architect, and the owner's answers | each answer changes the row of §E or the decision of M2 it names. Without it, M2 is built at this document's defaults only on the architect's word. |
| P2 | **The e2e scenes**, on a Mac under the load rule | after M3's hand-back; M2's scene as soon as M2 is pushed | the new scene of `e2e/discover-connectors.spec.ts` alone first (the `discover` group: the real engine's CLI, whichever version that group runs, under a scratch configuration directory; the scene makes no sign-in and no Keychain write of its own; the run's record names the engine's version, since the facts here were recorded on 2.1.322); then the groups that hold what the change reaches: `discover`, `widgets` (the dialog's sentence), and `default` since the renderer changed | verdicts by group. The scene's entry with no variable and no argument answers Reported 2 on a real engine. A red scene goes back as a fix. |
| P3 | **The branch review** | after M3 | `doperpowers:review-code`, the xhigh panel, over `origin/master...ux-wave/U11g` (Decision Log, with its lenses) | a verdict and findings; the fixes are one wave |
| P4 | **Class 1a** | on the head handed back; again on the final head if the review changed the branch | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u11g`, in the background | the run's id, which the pull request names |
| P5 | **A probe case, only if the architect wants Reported 1 run** | any time | engine 2.1.322 off the MacBook: an entry added with `add-json` at `project` scope whose header is `${X_PROBE}`, the variable set in the launch's environment, and what the stub server receives; once more with a name the engine classes as a credential | the sentence stands, or its advice is reworded in §E's one row |

No cross-build run is needed for this landing: §F stores nothing and relies on no read by build F.

## The owner's look

**Recommended, before M2 is built.** The sheet is a new surface with a dozen sentences of this document's own and several choices the design leaves to the drawing: the order of the fields, how the rows of a header and a variable sit, how the split arguments read, where the secrets sentence and the warning stand. The owner's bar is "nothing hasty", and a drawing costs less than a rebuilt sheet. It holds nothing back but M2: M1 has nothing to look at, and M3's sentence is the design's own words.

What it would show, with invented names and values (UC-11): the head of Connectors › My items with the action; the sheet as it opens on a project's page (Remote (HTTP), no header, "All projects" chosen among three); Remote (SSE) with two headers and the secrets sentence; Local command with a command, a line of arguments with the boxes under it, and two variables; the same with "shared in its .mcp.json" chosen and the warning; the refusals (a name already configured with its entry shown, arguments ending inside a quote, a command holding a space with its note); Details open with the dots in the command and the file it changes; the user configuration's page, where "Add to" is one plain line; after Add, the line of a failed add at the list's head and the new row; and the Connectors dialog's head with the new sentence. Questions it would put: whether the value fields show what is typed; the words marked "this document's" in §E.

## The pull request

Opened by the architect after the gate. Its body opens with the root's path, "U11, landing U11g" and the parent pin; says that the child's file gains this design in the spec's next batch and that this document is its record until then; names its class 1a run, its review verdict and its residue (Concrete Steps 6, with what the milestones add); names the later landings of the design that it leaves ("The landing's edge"); and lists the one dated line it carries in U11a's execution document. It ends with the `Sminos-Session:` line.

## Surprises & Discoveries

- Observation: a custom add cannot be a new runner action; an added member of the event's `action` enum is a wire major.
  Evidence: `src/shared/ipc/wire.ts`, the compatibility rule ("an added enum member included, since an older reader refuses it"); `events.plugins.operation` in `src/shared/ipc/wire-manifest.json` lists the ten actions.
- Observation: the runner hands a CLI's words on at five places, and one of them, the `done` event, does not pass the function the others pass.
  Evidence: `PluginsRunner.finish` calls `this.deps.emit` directly; `run`'s `emit` closure sets `op.latest` (code, 3).
- Observation: the engine reads some `${NAME}` references as empty toward a remote server.
  Evidence: `cli.pretty.js:388426` of 2.1.322, "MCP server config references credential variable(s) that are never expanded toward a remote server: … (read as empty)", written to its debug output only. Read, not run (Reported, 1).

## Decision Log

- Decision: the verification this landing gets. This document gets an adversarial review before an executor starts; the architect dispatches it. Each milestone is reviewed at its boundary; M1's before M2 consumes it. The branch gets `doperpowers:review-code` at the xhigh panel: it is of panel size by its files (about forty, over the wave's threshold of about twenty, though fifteen are registrations and generated files), and its delicate part is small and easy to miss, the path a header's or a variable's value takes. The panel's lenses: (1) no value leaves the runner: every exit of §C, the text before the trim, the replay, the log, the failure messages; try a value that defeats the replacement; (2) the command's input on its way in: main's router, the supervisor's link, the daemon's front, the validation's refusals; nothing logs or stores an input, no ledger can hold it, no offer reaches it; (3) the form stands where the engine checks nothing: the URL, a name at another scope and in MAWS's own list, reserved names, the splitter against its table, the name checked against a read made at the opening; (4) the wire is additive only and both pairings with build F do what §F says; (5) the window: the shown line everywhere a command is drawn, the book after the send, and the sentence true on every route that draws it. Class 1a on GitHub Actions is the gate of record.
  Rationale: the root gives the panel to a branch of panel size or a delicate change (UC-10); this is the first by count and the second in one path.
  Date/Author: 2026-11-14, the author of this document.

## Outcomes & Retrospective

Pending — written at finish.
