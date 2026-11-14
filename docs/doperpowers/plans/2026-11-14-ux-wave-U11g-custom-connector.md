# UX wave · U11g · Add custom connector, and the Connectors dialog's true sentence (2026-11-14)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U11** (`docs/doperpowers/specs/2026-11-12-ux-wave/U11-settings-connectors-org.md`), landing **U11g**, parent pin master `3514e9cda12f70228e815c51bdf0c404455131b6`.
> **Where the design is.** This landing is the first of four that build one design: connector switches by scope, and custom connectors (the child's items l8-settings-05, #476 and the halves of l8-settings-04 and l8-settings-03 that waited). That design was drafted on 2026-11-14 outside the repository, reviewed adversarially, ruled on by the wave's architect and read by the P5 architect, who ruled that this first landing may be built now. This document was itself reviewed adversarially and revised once on the architect's nine rulings of the same day ("Ruled by the architect"; Decision Log). **The child's file gains the design in the spec's next batch; until then this document is the record of the part this landing builds**, and it carries that part in full ("The design of this landing"). An executor reads this document and the code, never the draft. The owner's two answers of 2026-11-14 for l8-settings-05: “Claude Code's config” (where a custom connector is written) and “the list MAWS keeps in Settings is retired” (what becomes of adding in Settings, which a later landing builds). In the root: Purpose, the wave's laws, UC-7, UC-8, UC-10, UC-11, UC-12, UC-14. Where this document and the root differ, the root binds.
> **Branch:** `ux-wave/U11g`, from the parent pin; master is merged in before anything is built (Concrete Steps, 1). **Stands on:** U11a (`docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md`, on master with its code).

## Purpose

Today a person can add a connector from Customize only when Anthropic's directory lists it, and only as a remote server with no request header. A server of their own (an internal HTTP or SSE endpoint that wants a header, or a program on this Mac started with arguments and environment variables) can be added in a terminal with `claude mcp add`, or as a bare name and URL in Settings, where only the chats MAWS starts ever see it.

After this landing, Customize › Connectors › My items has "Add custom connector…". It opens one sheet: a name, one of three types, the type's fields, and where to add it (all projects, this project only, or this project's shared `.mcp.json`). Add writes the connector into Claude Code's own configuration through the engine's own CLI, so the next chat MAWS starts has it and so does the next `claude` in a terminal. The row then appears in My items as any configured connector does.

And the head of a chat's Connectors dialog says what its switch really does. Today it reads "Off here is off for every session in <place>.", which claims sessions that are already open; the engine does not tell those. It becomes "A switch here is for this chat, and every session started in <place> afterwards."

How to see it working: Acceptance, G1 to G7.

## Progress

- [x] (2026-11-14) This document written against master `3514e9cda`; the code statements in "What the code says today" checked at that commit.
- [x] (2026-11-14) The adversarial review of this document: needs attention, five findings; none on the remote reach, the wire or the splitter. The architect ruled R1 to R9 and this document was revised once to them (Decision Log).
- [x] (2026-11-14) The owner's look: the sheet was drawn from this document and the architect ruled on what the drawing showed (R7). M2 is released at these defaults (R8); one question is with the owner, whether the value fields are masked ("The owner's look").
- [ ] M1 — The rules, the command, the check before the run, and what may leave the runner.
- [ ] M2 — The sheet and the action in Customize.
- [ ] M3 — The dialog's sentence, the record, the whole checks, the hand-back.
- [ ] The architect's: the e2e scenes on a Mac, the branch review, class 1a, the pull request (Proof, P2 to P4).

## The landing's edge

**In.** From l8-settings-05: where the action sits, the form's fields and checks, what Add writes, the rule that keeps a header's and a variable's value out of everything MAWS keeps, and what follows Add. From l8-settings-04: the head's sentence, which is true of today's switch with no other change.

**Not included, each a later landing of the same design** (named so that nobody builds it here):

| later landing | what it holds, and what this landing leaves alone for it |
|---|---|
| the move of MAWS's own list, on a press | The row "Move to Claude Code’s config…" for an entry of MAWS's own list, its clash read, its ordered steps. **The Settings row "MCP servers" keeps its fields and its behaviour in this landing**: adding there still works, and `engine.mcpServers` is neither read differently nor written. |
| the record, the default and the switches (#476) | The file `machine-connectors.json`; "off until switched on"; the two switches in Customize; the acts `connectors.scopes.*`; the hold of a launch's first message; the dialog's switch acting on every open chat of a place, with the head's other sentence; a new chat's switches. Here "All projects" in the form means only the engine's scope `user`: nothing is recorded beside the add, and the new row has no switch. |
| account connectors | Connectors that come with a Claude account: untouched. |
| U11c, Customize's new structure | "My items | Discover" outside and the kind as a filter is not built. The action sits at the head of today's Connectors section; U11c moves it to the head's right of My items. |

Also not included: an OAuth client id, secret or callback port in the form; editing a connector after it is added (remove it and add it again); import from Claude Desktop's configuration; a WebSocket type (the engine accepts `ws`; nobody asked); hiding a value from the person's own processes ("Secrets"); anything for a `${NAME}` whose name is set nowhere (the form cannot read the engine's environment); a "Sign in now" step in the sheet; any change to Discover's add sheet, to Remove, to sign-in, or to the Connectors card of the card column (U8's file).

## Words used here

- **Connector**: an MCP server as a person meets it. **Custom**: not taken from the directory.
- **Scope**: where the engine keeps a connector's definition. `user`: the top-level `mcpServers` of the engine's global config file (`~/.claude.json`, or `.claude.json` inside `CLAUDE_CONFIG_DIR`); every project has it. `local`: under `projects[<place>].mcpServers` of the same file; one project has it. `project`: the `.mcp.json` of the folder the CLI runs in; whoever checks the repository out has it.
- **Place**: the engine's key for a folder: a repository's main root, or the folder itself outside a repository.
- **The inventory**: what is configured on disk for a folder, read with no session running (`customization.inventory`, answered by the engine host; its reader is `readCustomizationInventory` in `src/engine-host/customization/inventory.ts`): connectors of the scopes `user`, `project`, `local`, and of MAWS's own list as scope `app`. Only a name, a scope, a file and a transport cross to a window, never a URL, a header or a variable.
- **MAWS's own list**: the HTTP servers added under Settings › Sessions › MCP servers (`engine.mcpServers`), passed at launch to the sessions MAWS runs.
- **The engine host**: the process that owns engine processes and runs the engine's CLI for Customize (`src/engine-host/`). **The runner**: its class `PluginsRunner` (`src/engine-host/plugins/runner.ts`), which spawns `claude plugin …` and `claude mcp …`, one mutation at a time, in one queue.
- **An operation**: one mutation the runner runs. A window gets a receipt `{ opId }`, then `plugins.operation` events: `started`, one `output` per line the CLI prints, `done` with the outcome.
- **A value slot**: the place in the form, and in the entry, that holds a request header's value or an environment variable's value. Its content is what this document treats as a secret. **A public field**: every other field of the form: the name, the type, the scope, the URL, the command, the arguments, a header's name, a variable's name.
- **The wire**: the commands and events between builds of MAWS's processes (`src/shared/ipc/wire.ts`); a change to it is additive (a minor) or breaking (a major).
- **Build F**: `f1852de3a`, the build on the owner's machines, which a trial of the wave's build may be followed by.

## The design of this landing

### The rule about values, said once

It is a rule about value slots. **MAWS never copies the content of a value slot into an event, a result, a log line, a journal or ledger row, a replay, or anything it draws.** Two things are outside it: the sheet's own fields while the sheet is open, and, in the open sheet, the name inside a `${NAME}` reference where "A name the engine empties" says so.

Public fields are exempt. The name, the type, the scope, the URL, the command, the arguments, header names and variable names are shown and kept as typed, also where their text happens to be the same as a value's.

What MAWS builds from the form (the command it shows, the request a window keeps after the send) is built by replacing the slots in the structure with `•••`, never by searching text.

The one place a value could come back from is text the engine's CLI wrote. For this command MAWS forwards none of the CLI's standard output, words the success itself from public fields, and forwards a line of the CLI's error output only when that line contains no slot's content, as written or as JSON escapes it. A line that contains one is not repaired: the whole line is replaced by a fixed sentence. So a value of one character, or a value that is part of the connector's name, costs the person the engine's wording of a refusal and never the value. A value the CLI printed in some third form would not be recognised; "Engine facts", 7, lists what this command can print and is the ground for calling that a residue and not a hole.

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
| Request headers | For the two remote types: rows of a name and a value, none by default, added with "Add header". A row whose name and value are both empty is not sent, and a line under the rows says so while there is one; a row with a value and no name is refused. |
| Command | For a local command: one line, taken whole as the program to run, with the spaces at its two ends dropped. It is not split, so a path with spaces needs no quotes. |
| Arguments | For a local command: one line, split the way a shell splits words (§A gives the rule), and **shown split under the field as the person types**, one box per argument, before Add. A line that ends inside a quote, or on a lone backslash, is refused with a sentence. One sentence stands under the field: arguments are shown and saved as typed and hidden nowhere, and a secret belongs in Environment. |
| Environment | For a local command: rows of a name and a value, as Request headers. |
| Add to | "All projects" (the scope `user`), "<project> only" (`local`), "<project>, shared in its .mcp.json" (`project`). The last two are offered only on a project's or a folder's page; "All projects" is chosen first. **On the user configuration's page the same field shows its one choice, "All projects"**, under the same label, and not the "Scope: User" line of today's sheets. `<project>` is the page's name for its place (the project's name, else the folder with the home abbreviated). |

Changing the type keeps what was typed for the other type while the sheet is open and sends only the chosen type's fields.

Add is enabled when every field holds, the engine's binary is resolved (as in today's sheets), and the name has been checked against a read of the inventory made after the sheet opened. While that read is out, or when it could not read every configuration that applies, Add waits and the sheet says why, with Retry (today's three sentences). So on a page whose folder is a linked worktree, where the inventory cannot read the `local` scope today, nothing can be added; that is today's rule for Discover's sheet too, and the resolver's fix belongs to the landing of the switches.

Behind Details, closed when the sheet opens, as in today's sheets: the command, with `•••` in each value slot, and the file it changes. The command wraps at spaces and commas where it can, and a `•••` is never split across two lines.

### What it writes

One run of the engine's own CLI by the runner, in the page's folder (the engine's configuration directory on the user configuration's page):

    claude mcp add-json <name> <json> --scope <user|local|project>

`<json>` is `{"type":"http"|"sse","url":…,"headers":{…}}` or `{"type":"stdio","command":…,"args":[…],"env":{…}}`. `headers` is left out when there is no header and `env` when there is no variable; `args` is always there. The engine takes all three types at all three scopes, with and without those keys, and writes each entry exactly as given (Engine facts, 1 and 6), so **there is no other form of the command and no fallback to `claude mcp add`**: a type that needed one does not exist. MAWS writes no file itself and stores nothing of its own.

**The name is checked again where the act runs.** The sheet's check is for the early refusal on screen. The one that counts is made by the engine host, inside the runner's queue and immediately before the CLI starts: it reads the inventory for the page's folder with the reader the sheet's answer came from, and refuses, with a fixed result that names the scope of the entry it found, when the name is configured in any scope that applies there or held by MAWS's own list; it refuses too when that read was not whole. Since the queue runs one mutation at a time, two adds of one name started together cannot both pass. What remains is an add made by another process (a `claude mcp add` in a terminal) between that read and the CLI's write: milliseconds, and the rows then say which entry the engine uses ("Shadowed by…").

### Secrets

A header's or a variable's value is written into Claude Code's configuration file in clear, because that is how the engine keeps it. The sheet says so once, under the rows, as soon as there is one: "Saved in Claude Code’s configuration file as written."

While the CLI runs, the values are in its arguments. A process of the same person on that Mac can read another's arguments (`ps`), so for the fraction of a second the CLI runs the values are readable by the person's own processes. **The design accepts that**: `add-json` takes its JSON only as an argument, and the alternative, MAWS writing the engine's configuration file itself, is not taken: the engine holds `.claude.json` in memory and rewrites it, so MAWS reads that file and never writes it. The CLI is spawned directly with an argument list, never through a shell, so no shell history holds them.

What MAWS guarantees is "The rule about values" and nothing wider: it copies no value slot's content into anything it keeps, sends or draws; it forwards the CLI's own words only when they contain none; and the window forgets the values at the send. On the recorded runs the CLI prints no value at all (its answer names the type, the name and the scope).

With "<project>, shared in its .mcp.json" chosen and any header or variable filled in, the sheet warns, directly under "Add to": "This file is usually committed with the repository. Write a secret as ${NAME}, with a name of your own, and set NAME under env in ~/.claude/settings.json or in the environment Claude Code starts with."

### A name the engine empties

The engine expands `${NAME}` when it loads an entry, but toward a remote server it reads a set of well-known names as empty, and tells the person nowhere they would look: the server still connects (Engine facts, 6). So, at any scope: when a remote entry's URL or a header's value holds `${NAME}` or `${NAME:-…}` and NAME is one of those, the field shows "Claude Code sends <NAME> to a remote server as empty. Use a name of your own." It does not block Add. The set is a fixed list in one named place (§A), taken from the engine's own explicit lists at 2.1.322, names beginning `OTEL_` included; the engine's patterns are not copied, and the list can fall behind a later engine. Nothing is built for a name that is set nowhere: the engine sends it as the text `${NAME}`, and the form cannot read the engine's environment.

### After Add

The sheet closes at once. While the CLI runs, and if the add fails, one line stands at the head of the list under the connector's name, in the form every operation's line has today (`OperationLine`: the words, then a code): the engine's own words when they hold no value ("MCP server <name> already exists in user config"), the fixed sentence when they do, or the engine host's refusal when the name was taken. When it succeeds the engine host says the configuration changed, the inventory is read again, and the row appears in My items as rows do today: its name, scope, transport and file, Remove, and, for a remote one, Sign in by the existing rule (through a ready session that holds it, else "Open a session, then sign in"). It has no switch. "Sessions started from now on load it; running sessions do not.", today's sentence, is in the sheet.

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

Three recorded probe passes on engine `2.1.322`: `spikes/protocol-probe/findings-uxwave-u11-connector-scopes.txt` (pass 1), `spikes/protocol-probe/findings-uxwave-u11-connector-scopes-2.txt` (pass 2) with its record `spikes/protocol-probe/fixtures/uxwave/u11-connector-scope2.ndjson`, and `spikes/protocol-probe/findings-uxwave-u11-connector-scopes-3.txt` (pass 3) with its record `spikes/protocol-probe/fixtures/uxwave/u11-connector-scope3.ndjson` (on master with that pass's pull request). "2:20" is line 20 of pass 2's record, the case `add-json`; "3:1" and "3:2" are the two lines of pass 3's. Nobody runs an engine on the MacBook or on the build VM for this landing; a fact the records do not hold goes to the architect.

1. **`add-json` takes all three types at all three scopes and writes each as given** (2:20, `adds`): nine calls `claude mcp add-json <name> '<json>' --scope <scope>`, `http` and `sse` with a header and `stdio` with arguments and a variable, each succeeded with one line, "Added <type> MCP server <name> to <scope> config", and each entry in the file equal to the JSON given: `user` in the top-level `mcpServers` of `.claude.json`, `local` under `projects[<root>].mcpServers`, `project` in `<root>/.mcp.json`. A session started afterwards read all nine connected.
2. **Its refusals** (2:20, `refusals`), each exit 1 with nothing written: a name with a colon, a dot or a space: "Invalid name <name>. Names can only contain letters, numbers, hyphens, and underscores."; a name already at `user` scope: "MCP server <name> already exists in user config"; a JSON with no `type`: "Invalid configuration: : Invalid input".
3. **What it does not check** (2:20, `refusals`): `{"type":"http","url":"not a url"}` was accepted and written; a name already defined at `user` scope was accepted at `local` scope, leaving one name with two definitions; type `ws` was accepted.
4. **Its default scope is `local`** (2:20, `mcpGetCliHelp`), so `--scope` is always given, as `mcp add`'s is today.
5. **Today's switch** (2:14, 2:18, 2:19): `mcp_toggle` changes the session that is told and the place's list; live sessions in the same repository keep the connector; new ones start from the list.
6. **`${NAME}`** (pass 3, alike at all three scopes).
   - `add-json` writes `${…}` unexpanded, and accepts a `stdio` entry with no `env` key and one with `args: []`; both were written as given and read connected (3:1 `adds`; 3:2).
   - A local-command entry receives the variable's value in its command, arguments and environment, whatever the name, except a name beginning `OTEL_` (3:2, `stdio`).
   - A remote entry receives a name of the person's own, credential-looking or not, and `GITHUB_TOKEN` and `GH_TOKEN` (3:2, `remote`).
   - A remote entry receives `NPM_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `ANTHROPIC_API_KEY`, `HTTPS_PROXY` and `OTEL_EXPORTER_OTLP_HEADERS` as empty strings, in a header and in the URL; the server still connects, and nothing on the wire, in `mcp_status` or on stderr says so (3:2).
   - A name set nowhere is sent as the literal text `${NAME}`; `${NAME:-fallback}` gives the fallback; a name set only under `env` in the user settings file is received (3:2).
7. **What `add-json` can print**, read in the engine's source (`cli.pretty.js` of 2.1.322, cited as `research/SOURCES.md` prescribes; the handler is at `:557935-557957`). On success it prints one line on stdout and exits 0 (`:557956`). Every refusal is an error thrown inside the handler, printed by `bo` (`:557954`, `:514707`) with `console.error` (`:514656`), exit 1 (`:514663`).

   | message | line | can it hold content of the entry? |
   |---|---|---|
   | `Added <type> MCP server <name> to <scope> config` | `:557956` | the type, the name, the scope: public |
   | `Invalid scope: <scope>. Must be one of: …` | `:477476` | the scope |
   | `Invalid name <name>. Names can only contain letters, numbers, hyphens, and underscores.` | `:476702` | the name |
   | `Cannot add MCP server "<name>": this name is reserved.` | `:476704` | the name |
   | enterprise configuration has exclusive control; managed settings allow only servers that plugins provide | `:476707`, `:476710` | nothing of the entry |
   | `Invalid configuration: <path>: <message>, …` | `:476714` | each issue's path is made of the entry's keys, so a header's or a variable's **name** can stand in it, and `args.<n>`; the messages are the schema's own ("Command cannot be empty", "url is too long", `:953142`) or the validator's defaults. A value slot is a plain string there (`headers` and `env` are records of strings, `:953142`), which no rule of that schema can fail, so no issue is raised on one. |
   | `Cannot add MCP server "<name>": type "<type>" servers are registered by the host application…`; `… type "claudeai-proxy" is used only by claude.ai connectors…` | `:476718`, `:476720` | the name, the type |
   | `Cannot add MCP server "<name>": server is explicitly blocked by enterprise policy`; `… not allowed by enterprise policy` | `:476723`, `:476726` | the name |
   | `MCP server <name> already exists in .mcp.json`; `… in user config`; `… in local config` | `:476732`, `:476737`, `:476742` | the name |
   | `Cannot add MCP server to scope: <scope>` | `:476746-476752`, `:476776` | the scope |
   | the folder is a connector-downloads folder; `--project-config-root` is in use | `:475880`, `:475891` | nothing |
   | `Failed to write to .mcp.json: <error>` | `:476761` | the file system's error for that write: a path |
   | `MCP server "<name>" was not saved to <file>…` | `:475654`, thrown at `:476799` | the name, the file, the place |
   | `MCP server "<name>" may not have been saved…: <file> could not be read to confirm the change (<reason>)…` | `:475658`, thrown at `:476792` | the name, the file, and `<reason>`: the error from reading back the configuration file the entry was just written into. **A parse error there can quote a fragment of that file**, in the form the file holds it, which is as JSON escapes it. |
   | `Server added, but the client secret could not be stored…` | `:557948` | reached only with `--client-secret` and an `oauth` key; this form sends neither |
   | "mcp add-json: user-provided JSON was empty, invalid, or null" | `:557941` | fixed; it goes to the engine's debug log, not to the terminal |

   So entry content can come back as public fields, and a value slot's content only through the read-back error, as written or as JSON escapes it: the two forms the rule tests. Not listed: what the CLI may print outside this handler (a notice at start-up, an error of a settings file); none of it reads the entry.

The runner runs whichever engine the launcher resolves (the person's installed Claude Code, or the binary chosen in Settings › Engine), which may be another version than the probes'. Nothing here reads a version: on an engine that refuses the command or an entry, the person reads that engine's own words on the add's line, under the same rule, and MAWS has written nothing.

## What the code says today (checked at the pin)

1. **Discover's add.** `connectors.add` (`src/shared/ipc/schema/connectors.ts`: `cwd`, `binary`, `name`, `scope`, `url`, `transport`) is answered by the engine host (`src/engine-host/ipc.ts`), which starts the runner's action `mcp-add`; `mcpCommandLine` (`src/shared/plugins/cli.ts`) builds `mcp add --transport <http|sse> <name> <url> --scope <scope>`. Its owner is `engine-host`, its grade `machine-admin` (`src/shared/ipc/grades/connectors.ts`), it is a path command (`PATH_COMMANDS` in `src/shared/ipc/routes.ts`), and it has no row in `src/endpoint/offers.ts` (`test/endpoint/artifact-rows.test.ts` pins `undefined`). The window sends it with `{ machine: ipc.localMachine }` (`widgets/plugins/operation.ts`).
2. **A new member of the runner's action list, or of an outcome's code list, is a wire major.** `plugins.operation`'s `action` is `z.enum(RUNNER_ACTIONS)`, an outcome's `error.code` is `z.enum(PLUGINS_ERROR_CODES)`, and the event is in the wire's manifest; `src/shared/ipc/wire.ts` classes "an added enum member" as breaking, "since an older reader refuses it". So a custom add is not a new action name and a new refusal is not a new code. `error.failureCode` is a free string.
3. **Where the runner hands a CLI's words on** (`src/engine-host/plugins/runner.ts`, `cli-result.ts`): (a) each non-empty line of stdout and stderr, trimmed, as an `output` event (`exec`'s `hear`, through `run`'s `emit`); (b) the outcome's `message`, read by `mcpOutcome` from stdout's first line on exit 0 (else built from the name), and on another exit from the last line of stderr or stdout; (c) `op.latest`, the last event of a running operation, sent again to a client that connects (`running()`); (d) the message of a failure the runner words from an error object: a spawn that threw or failed (Node's own message, which can quote an argument it refuses); (e) `console.warn` in `start`'s catch, with a thrown error's message, into the engine host's log. `finish` emits the `done` event directly, not through `run`'s `emit`. A failed operation is drawn as `<message> · <failureCode, else code>` (`OPERATION.failed` in `widgets/copy.ts`).
4. **The sheet's Details holds the argument list twice**: as text (`commandWords`) and as the attribute `data-plugins-argv` (`customize/connectors/ConnectorSheet.tsx`); both come from `argvOf` (`widgets/plugins/present.ts`), which only sheets call. The text is drawn with `break-all`.
5. **A window keeps the request of every operation it started** (`OperationBook.entries` in `widgets/plugins/operation.ts`), input included, for as long as the section stays mounted.
6. **A remote action cannot reach an engine-host command that names no session**: `host.op` answers `unavailable` when the input has no `appSessionId`, and `host.artifactOp` runs only its own closed list (`src/engine-host/ops.ts`). `plugins.operation` is not among the events the endpoint forwards to another device (`ADMIN_EVENTS` in `src/endpoint/artifacts-feed.ts`).
7. **The name check.** `existingOf` (`customize/connectors/present.ts`) finds a name among the inventory's servers for the page's folder, MAWS's own list included (scope `app`); `configuredOf` says whether that read was whole; the sheet reads `plugins.env` again at every opening but not the inventory, whose answer may be up to 30 s old (`INVENTORY_STALE_MS`) and does not hear a change made in a terminal. The engine host can read the same inventory itself: `readCustomizationInventory(cwd, deps)` is exported beside the command's handler. On the user configuration's page the CLI's `cwd` is the engine's configuration directory, not the page's folder, which is none.
8. **After a mutation** the runner calls `changed()` whatever the outcome; every reader of the inventory reads again (`useReadAgainAfterPluginsChange`). An MCP change reloads no session.
9. **The dialog's sentence** is `MCP.reach` in `widgets/copy.ts`, drawn once as the frame's note by `McpWidget` with `MCP.reachTip`. Pinned by `widgets/McpWidget.test.tsx` (eight expectations), `widgets/McpDriven.test.tsx` (one, of its absence), `e2e/widgets.spec.ts` (two) and `e2e/c11-live.spec.ts` (one).
10. **The tests' fake CLI.** `runner.test.ts` writes a shell script as the binary, whose behaviour each case sets. The stub CLI of the e2e groups `widgets`, `settings` and `ux2-shell` (`test/support/plugin-cli-stub.ts`) refuses every `mcp` verb; only the `discover` group runs the real engine's CLI, under a scratch configuration directory (`e2e/discover-connectors.spec.ts`).
11. **Build F reads such an entry.** Its inventory takes any entry's name, scope, file and `type` and ignores its other keys (`git show f1852de3a:src/engine-host/customization/inventory.ts`, the same three lines as today's).
12. **Where a command's input is validated on its way**: main's router (`dispatch` in `src/main/ipc/router.ts`, strict), the daemon's front (`src/mawsd/front.ts`, tolerant) and the host runtime (`src/shared/host/runtime.ts`, tolerant). A refusal carries the schema's issues (a path and a message); a tolerant reader drops a key it does not know and logs that key's name once (`tolerantLog`).

## Ruled by the architect (2026-11-14)

After the adversarial review. Each ruling is built where the last column says; a later change of one touches that place.

| | the ruling | where it is in this document |
|---|---|---|
| R1 | The secrecy rule is about value slots; public fields are exempt; what MAWS builds is built from the structure; the CLI's stdout is not forwarded, the success is MAWS's words, and a line of the CLI is forwarded whole or not at all. | "The rule about values"; §C; Engine facts, 7 |
| R2 | No issue on a value slot can echo it; one test at each of the three boundaries; no diagnostics machinery of the command's own. | §B; M1's tests; code, 12 |
| R3 | The name check runs where the act runs, in the runner's queue, immediately before the CLI. | "What it writes"; §B; §C |
| R4 | M1 may narrow the renderer's existing readers of the remote add's input, type-only, and proves the web project's typecheck. | M1 |
| R5 | The entry is validated once; the shown line is serialised with no bound on the substituted text. | §A |
| R6 | The order of the JSON's keys is not pinned. | §A |
| R7 | From the drawn sheet: one wording of the scope on both pages; how Details wraps; the warning under "Add to"; a sentence under Arguments; the two row states worded; a failed add's line in today's form; Details closed at opening; plain value fields unless the owner chooses otherwise. | "The form's fields"; §E; M2 |
| R8 | M2 is released at these defaults. | Progress; Plan of Work |
| R9 | The warning's sentence, and the note for a name the engine reads as empty toward a remote server. | "Secrets"; "A name the engine empties"; §A; §E |

Accepted as first written, without a ruling of their own: the new command `connectors.addJson` with the custom add running as the action `mcp-add`; a running or failed add's line at the head of the list; and that P4-R8's amendment goes with the landing that retires adding in Settings, this one carrying one dated line in U11a's execution document.

One interaction, said so that nobody removes it as a fault: R9's note draws a name taken from inside a value slot (`NPM_TOKEN` out of `${NPM_TOKEN}`). It is drawn only in the open sheet, beside the field it came from, and it is the second exception the rule names.

## Acceptance

Each is behaviour someone can check; the commands are in Concrete Steps, the runs an executor cannot make in Proof.

- **G1 · A custom local command is added for all projects, and nothing MAWS keeps holds its value.** In Customize › Connectors › My items, "Add custom connector…", Local command, a command, two arguments and one variable, Add to "All projects", Add: the sheet closes, the row appears with `user scope · stdio` and Remove, and the engine's configuration holds an entry of type `stdio` with that command, those two arguments and that variable under that name. A second add with no argument and no variable is written too. The engine's own `mcp list` names both. That the next chat and the next terminal session load such an entry is Engine facts, 1. No `plugins.operation` event, no line of the engine host's log and no text of the page holds the variable's value, also when the CLI itself prints it: M1's and M2's tests of the rule, which fail before and pass after.
- **G2 · A remote connector with a header, shared in the project.** On a project's page: Remote (HTTP), a URL, one header, Add to "<project>, shared in its .mcp.json". The warning about a committed file is shown under "Add to" once the header has a name, and the secrets sentence under the row. After Add the project's `.mcp.json` holds an entry of type `http` with that URL and that header, and the row reads `project scope · http` with Sign in by the existing rule. With Details open the command shows `•••` where the value is.
- **G3 · The form refuses what the engine would take, and so does the engine host.** A URL that is not `http` or `https` with a host; a name configured at any scope the page reads, or held by MAWS's own list, with that entry shown; `maws` and a name the engine reserves; arguments that end inside a quote; a value with no name: each disables Add and says why. While the configuration is being read, or could not be read whole, Add waits and says so. With the sheet held open while the name is added elsewhere, Add is pressed: the CLI is not started, and the line reads that the name is already configured, with its scope.
- **G4 · The arguments are shown as they will be passed.** Typing `--root "/tmp/my files" -v` shows three boxes: `--root`, `/tmp/my files`, `-v`. The entry written holds those three strings.
- **G5 · The dialog's sentence.** In a chat MAWS runs, "+" › Connectors › "Connectors in this chat…" shows once, in the head, "A switch here is for this chat, and every session started in <place> afterwards.", with today's tooltip; no row repeats it; a terminal session's dialog shows no such sentence. Nothing else of the dialog, and nothing of Discover's add, of Remove or of Settings › Sessions › MCP servers, behaves differently.
- **G6 · Only this machine, only this app's windows.** The new command has no offer over the machine link and answers a remote caller `not-offered`; a remote action naming it is answered `unavailable` by the engine host and leaves no ledger line.
- **G7 · A name the engine empties is said.** With `${NPM_TOKEN}` in a header's value, or in the URL, of a remote entry, the field shows "Claude Code sends NPM_TOKEN to a remote server as empty. Use a name of your own.", at any scope, and Add stays enabled. `${MYSERVICE_TOKEN}` shows nothing. A local command's variable shows nothing whatever its name.

## Constraints that bind every milestone

- **The design binds** as this document writes it. Stop and hand the point back to the architect, with the evidence, where the code contradicts a statement the work rests on, where the work needs an edit in a file another child owns, where a contract or another child would have to change, or where the owner would see something this document does not say. Everything else is decided in the spirit of the design and recorded in the Decision Log.
- **Law 6, and the engine.** Nothing depends on an engine behaviour that "Engine facts" does not hold. No executor runs an engine, the engine's CLI, `pnpm e2e:*` or anything that starts one, on the MacBook, on the VM or anywhere: the runner's tests use the fake CLI their file already writes. A missing fact goes to the architect.
- **Law 3 and UC-14.** No setting is added. Neither settings file changes its schema, its version or a value. No layout key is added. MAWS stores nothing for this landing.
- **Law 7.** Today's tokens and shapes only; the sheet is built from the parts today's connector sheet uses (`Sheet`, `SheetForm`, `FIELD`, `CHOICE`, `SheetDetails`).
- **What stays, and law 8.** Discover's add, Remove, sign-in and the Settings row behave as before: in their tests an assertion on what is sent or written is not edited. The plugin library inside a session is the owner's `keep` (l8-settings-10), and it shares `widgets/plugins/operation.ts` and `present.ts` with this work: for every request that is not a custom add, what those two files send, keep and show is what they send, keep and show today, and an executor who finds otherwise stops and reports.
- **The child's bindings 9, 11, 14, 15.** Customize reads and changes this Mac only. No test makes an engine sign-in or a Keychain write. Nothing under `src/endpoint` changes.
- **The rule about values** holds at every milestone's head, as "The rule about values" words it and §C builds it. A refusal, a thrown error, a test name and a log line name a field, never a slot's content.
- **The wire.** Additive only: one new command, one minor. No member is added to any enum of the wire (code, 2). `WIRE_MINOR` takes the next number on the master the branch last merged, with its comment, and the generated files are made again after every later merge of master that moved it (Concrete Steps, 3 and 5). The bounds of §B's schema are fixed for the wire's major once they land: changing one is a major.
- **UC-8.** Every file this landing edits is U11's by UC-8's table (`customize/`, `widgets/`) or is given to nobody (`src/shared/plugins/`, `src/shared/engine/app-mcp-servers.ts`, `src/engine-host/plugins/`, `src/engine-host/ipc.ts`, `src/engine-host/connectors/register.ts`, the connectors' names, schema, grades and routes under `src/shared/ipc/`, and the tests under `src/`, `test/` and `e2e/` named in the milestones, among them one new case each in `src/main/ipc/router.test.ts`, `src/mawsd/front.test.ts` and `src/shared/host/runtime.test.ts`). The wire's own files (`src/shared/ipc/wire.ts` and the generated four) are held by nobody and edited by each landing that moves the minor: this landing is one more, under that row's rule (merge master, then make them again right before the gate).
- **UC-11, the repository is public, and the privacy rule.** Nothing of the owner's enters code, tests, fixtures, comments, commit messages or this document. Test content is invented: names like `files-probe`, hosts under `example.test`, values like `value-one`. A test value is never shaped like a credential (no long random string, no `Bearer` followed by one): class 1a's static scan reads a long id beside a key named like a credential as a secret. A fault is never reproduced by reading the content of a person's session, settings file or configuration file: structure and counts only, and none of it goes into the repository. Every test that touches a configuration file runs under a scratch directory.
- **Renderer source** never writes a number sign followed by digits (a ticket is "ticket 476"): the tokens guard reads it as a colour.
- **Where checks run (UC-10).** The worktree on the MacBook carries no `node_modules`; nothing is installed, typechecked, linted, tested, built or launched there. Every check runs on the wave's build VM in a checkout of the pushed head, under a time limit. Class 1a, every Electron e2e run and every probe are the architect's. If a command fails with "No space left on device": stop, tell the architect, delete nothing.
- **Git.** Commit as you go and push `ux-wave/U11g`. Merge master, never rebase, never force-push. Never commit to master or to `ux-wave-spec`; never edit the spec's files. Every commit message ends with the `Sminos-Session:` line the dispatch gives, and carries no other attribution.

## Plan of Work

Three milestones. Each is one executor's from this document and the code, is reviewed at its boundary, and leaves the typecheck, lint and the tests it names green. M2 consumes M1's §A, §B and §C; M3 consumes nothing. All three are released (R8): M2 is built at this document's words, and an answer of the owner's that changes the value fields or a sentence is applied as a fix before the pull request. M3 can be built at any time and closes the landing.

Expected size, lines added plus removed, tests included: M1 about 1,000, M2 about 900, M3 about 120. About 2,000 lines over about 46 files, of which about fifteen are one-line registrations and generated files.

### M1 — The rules, the command, the check before the run, and what may leave the runner

**At its end** the engine host answers a new command, `connectors.addJson`: it checks the name against the configuration, runs `claude mcp add-json` as an operation, and says nothing to anyone that holds a value slot's content. No window calls it yet.

**Touches.** `src/shared/plugins/argv-split.ts` and `src/shared/plugins/remote-emptied-names.ts` (both new) with their tests; `src/shared/plugins/cli.ts` and `cli.test.ts`; `src/shared/engine/app-mcp-servers.ts` and its test (one exported predicate for the reserved names); `src/shared/ipc/schema/connectors.ts`, `names/connectors.ts`, `grades/connectors.ts`, `routes.ts`, `wire.ts` and the generated files; `src/engine-host/ipc.ts`, `src/engine-host/connectors/register.ts`, `src/engine-host/plugins/runner.ts`, `cli-result.ts` and their tests (`runner.test.ts`, `cli-result.test.ts`, `src/engine-host/ipc-e8.test.ts`); `src/engine-host/ops.test.ts`; one new case each in `src/main/ipc/router.test.ts`, `src/mawsd/front.test.ts` and `src/shared/host/runtime.test.ts`; every exact list that names `connectors.add` (`git grep -n "connectors.add"` shows them: among them `src/shared/ipc/schema.test.ts`, `test/support/cross-build-samples.test.ts`, where the new name joins `NOT_YET_NAMED`, and `test/endpoint/artifact-rows.test.ts`, where it joins the names with no offer); and, type-only, the renderer's readers of the remote add's input (below).

**Interfaces.** Exposes §A (the splitter, the entry and its rule, the command line, the value slots, the shown line, the emptied names) and §B (the command and its fixed results). Keeps §C.

**Decisions.**
- *One action, two inputs* (code, 2): `McpActionInputs['mcp-add']` is today's shape or `{ name, scope, entry }`; `mcpCommandLine` builds `add-json` for the second. `RUNNER_ACTIONS` is not touched. The alternative, an action `mcp-add-json` mapped back to `mcp-add` on the event, is a second name for one thing.
- *The tree stays green* (R4): widening that input breaks the renderer's readers that take it for the remote shape (`customize/connectors/ConnectorSheet.tsx`, `ConnectorsSection.tsx`, `present.ts`, `widgets/plugins/present.ts` where they read `url` or `transport`). M1 narrows them, type-only, behaviour unchanged, and its proof includes the web project's typecheck.
- *The outcome of a custom add is read by one pure function*, the entry's branch of `mcpOutcome` in `cli-result.ts`, by §C's rule: it never reads stdout; the success is worded from the input; a refusal is the CLI's last error line, whole, when `holdsValueSlot` says it holds none, and the fixed sentence otherwise. Nothing is replaced inside a line.
- *The same test, at the two other places a CLI's or the system's words pass*: a line of stderr becomes an `output` event only when it holds no slot's content, and is otherwise not emitted, so `op.latest` and the replay hold only such lines; the message of a spawn that failed, and the log line in `start`'s catch, are forwarded only when they hold none and are otherwise their fixed sentences. No stdout line of a custom add is emitted at all.
- *The check before the run* (R3): `start` takes an optional step that the runner awaits inside its queue, after `started` is said and before anything is spawned; it answers a failed outcome, which ends the operation there, or nothing. The engine host's handler passes one that reads `readCustomizationInventory(folder, …)` and answers §B's fixed results. A cancel or a stop that arrives during the step ends the operation `cancelled`, as during the runner's other preparations; a step that throws ends it with the result for a read that was not whole. The CLI's own words stay the backstop: "already exists" from the engine reads as before.
- *An empty slot is no slot*: an empty value is contained in every text, so it is left out of the test. A one-character value makes the test true for most lines; that costs the engine's wording and is left so (the rule).
- *The builder and the schema refuse with fixed words.* `mcpCommandLine`'s errors for an entry and the schema's one refinement name a field and a row. One rule, `mcpEntryProblem`, is read by the builder, the schema and (M2) the form, so the three cannot disagree. A value slot's own schema is a string with a length bound and nothing else, so no issue raised on one can carry its text (R2).
- *The shown line* (R5): the real input is validated once; the line is then serialised from the masked structure by `mcpEntryJson`, which applies no rule, so the text put in the slots cannot push an entry past a bound it was within.
- *Authorization is what `connectors.add` has*: owner `engine-host`, grade `machine-admin`, a path command, bridged to the window, no offer, no entry in `remote-unavailable.ts` (it is not an act on a session).
- *The wire*: after the schema, names, grades and routes are edited, Concrete Steps 3.
- *Pitfall*: `finish` emits `done` without passing `run`'s `emit`, and `op.latest` is set in `emit`; the rule has to hold on both paths.

**Does not touch.** The renderer's behaviour. `connectors.add`'s schema and line. `plugins.operation`'s schema. `src/endpoint/`. The inventory's reader. The e2e stub CLI.

**Proves** G6, G1's "nothing MAWS keeps holds its value" and G3's last sentence for the engine host. Its tests pin:
- the splitter's table (§A), every row, and that it expands nothing;
- the `add-json` argument list for each type: the entry given back by `JSON.parse` of its third argument, with and without headers, variables and arguments; today's `mcp add` and `mcp remove` lines unchanged;
- `mcpEntryProblem`: one case per rule of §A's table, and that the builder throws on each with a message that holds no slot's content;
- the shown line: `•••` in every slot and every public field as typed; and, for an entry within a few bytes of the JSON bound whose values are empty or one character long, that both the real line and the shown line are built (R5);
- the emptied names (§A): the five names the record proves, in a header's value and in a URL, bare and with a fallback; lower case; one of the person's own, `GITHUB_TOKEN` and `GH_TOKEN` answering nothing;
- the schema: the three types accepted; `ws`, an unknown key, a header on a local command, a variable on a remote one, each bound's first value over, a duplicate name, `maws` and a reserved name, `folder` null with a scope other than `user` refused;
- **the three boundaries** (R2), one case each in `router.test.ts`, `front.test.ts` and `runtime.test.ts`: an entry refused for a value too long, and one refused for a control character in a value, answer an error, and neither that error nor any captured log line, serialised, contains the value;
- the outcome of a custom add (`cli-result.test.ts`): exit 0 with stdout empty, and exit 0 with stdout holding a value, both answer the success worded from the input; exit 1 with a clean last error line answers that line; exit 1 with a line holding a value as written, and one holding it as JSON escapes it (a value with a quote and a backslash), answer the fixed sentence with the exit code and the shown command; a value that is part of the name, a one-character value, a value equal to `•••`, and two values of which one contains the other: each line that holds one is withheld whole, and the name, where it is shown, is shown as typed;
- the runner, with the fake CLI: the arguments received, one by one; `changed()` told; no reload asked; with the CLI printing its whole argument list on stdout and on stderr over several lines, no `plugins.operation` event of any phase, no answer of `running()` and no captured `console.warn` holds a slot's content;
- **held open**: the fake CLI prints an error line holding a value, then a clean one, and waits; `running()` asked at that moment answers the clean line or `started`, never the other; the CLI is released and the operation ends;
- a spawn that throws an error whose message quotes the argument list (through the `spawn` seam): the outcome is the fixed sentence for it, and the log holds no slot's content;
- **the check before the run**: with the inventory holding the name at the scope asked, at another scope, and in MAWS's own list, the operation ends with the fixed result naming that scope and the CLI is not started; with a read that was not whole, the other fixed result; **two custom adds of one name, at two scopes, started before the first finishes**: the first runs, the second is refused, the CLI was started once; a cancel during the step ends `cancelled` with nothing started;
- a cancel while it runs, the timeout and the overflow end with their own words, unchanged;
- `host.op` naming `connectors.addJson` answers `unavailable`, calls no handler and leaves no claim; the command has no offer, and a remote call of it answers `not-offered`.

### M2 — The sheet and the action in Customize

**At its end** a person can add a custom connector from Customize › Connectors › My items, as "The design of this landing" says, and sees its row.

**Touches.** `src/renderer/src/customize/connectors/` (the sheet as a new component beside `ConnectorSheet.tsx`, the form's rules as pure functions beside `present.ts`, `copy.ts`, `ConnectorsSection.tsx`, and their tests); `src/renderer/src/widgets/plugins/operation.ts` and `present.ts` with their tests; `src/renderer/src/customize/CustomizeView.test.tsx`; `e2e/discover-connectors.spec.ts` (one scene, written and typechecked here, run by the architect).

**Interfaces.** Consumes §A, §B and §C's results. Exposes §D.

**Decisions.**
- *The sheet reads its starting values from the request it is opened with* (`requestFor('mcp-add', { name: '', scope: 'user', entry: { type: 'http', url: '', headers: [] } }, null)`), as today's sheet reads the directory's. The later landing that moves an entry of MAWS's own list opens it filled in by the same way.
- *The form's rules are pure functions* the sheet and the tests read, as `present.ts`'s are: from the typed fields to an entry or to the first problem of each field. They call `splitArgs`, `mcpEntryProblem`, `isMcpName`, `isMcpUrl`, the reserved-name predicate, `existingOf` and `remoteEmptiedNamesIn`, and add no rule of their own. The one thing they change is the command, whose end spaces they drop (the field cannot trim as the person types, or a path with a space could not be typed); every other field goes into the entry as typed.
- *The name is checked on screen against a read made at this opening.* Opening the sheet reads the inventory again, and Add waits for an answer newer than the opening, under today's "Reading what is configured here…"; an older answer vouches for nothing (code, 7). This is the early refusal only; the engine host's check is the one that counts, and its refusal is drawn on the add's line. Discover's sheet is not changed.
- *The send* carries `folder`, the page's folder or null, beside the folder the CLI runs in (§B).
- *The command a sheet shows is the shown line.* `argvOf` (`widgets/plugins/present.ts`) answers §A's `mcpShownLine` for an MCP action, which equals today's line for every request but a custom add; so the text and the attribute `data-plugins-argv` of Details hold `•••` in each slot, and no code in the window builds the real argument list. In the custom sheet the command is drawn so that it wraps at spaces and commas where it can and breaks inside a word only where it must, and each `•••` is an element that does not wrap (R7); today's sheets keep `break-all`.
- *The window forgets the values at the send.* `OperationBook.run` sends the request's input and keeps `mcpShown` of it (code, 5), so what the book holds while the section is mounted holds no slot's content. The sheet's own state goes when it closes.
- *The value fields are plain text fields*, with spelling checks off, drawn by one small component of the sheet's file that the header rows and the variable rows both use: the one place a masked field with a reveal control would be made, if the owner chooses it ("The owner's look").
- *An add's line*: keyed `connector:add:<scope>:<name>`, drawn at the head of the list under the name while its operation is working or has failed, by the component a removed row's result uses (`Gone`), so that it has today's `OperationLine` form, with Cancel while it runs. A succeeded add draws nothing there: its row is the result. A failed line stays until an add of the same name and scope replaces it or the page changes.
- *Which command a request sends*: a request whose input holds an `entry` sends `connectors.addJson`; every other request sends what `COMMAND_OF` says today.
- *What is drawn by the rows*: the secrets sentence under the chosen type's rows while there is at least one row, filled or not; "An empty row is not added." while one of them has neither a name nor a value; the warning, directly under "Add to", while the scope is `project` and at least one row has a name or a value.
- *The note for an emptied name* stands under the URL field, and under the header's row, that holds the reference: one line per name. It is drawn for the two remote types only.
- *Pitfalls seen*: `forgetSignIn({ name, scope, cwd })` after a successful change stays as it is and serves a custom add too; the section is keyed by its folder, so choosing another project closes the sheet and drops the lines, while the operation runs on in the engine host and its row is there on return.

**Does not touch.** `ConnectorSheet.tsx`'s two sheets beyond the dispatch to the new one. `McpServersSettings.tsx`. `CustomizeView.tsx` (the section's props are enough). The e2e stub CLI, which keeps refusing `mcp`.

**Proves** G1 to G4 and G7 in the window. Its tests pin:
- the action is at the head of My items on the user configuration's page and on a project's page, not in Discover; it opens the sheet with Remote (HTTP), "All projects" and Details closed;
- for each type, the fields drawn, and that Add sends `connectors.addJson` with exactly `{ cwd, binary, name, scope, entry, folder }` to this machine; that a row with no name and no value is not sent; that the other type's fields are not sent;
- "Add to" on a project's page offers the three choices; on the user configuration's page it shows "All projects" under the same label, and no "Scope: User";
- each refusal of G3 with its sentence from §E, Add disabled; a value with no name refused; "An empty row is not added." drawn while a row is empty;
- **held open**: with an older inventory answer in hand and the opening's read still out, Add is disabled; when the read answers with the typed name in it, the name is refused and that entry shown; when it answers without it, Add is enabled; when it fails, Retry is offered and Add stays disabled;
- **held open**: the sheet is open and its read has answered without the name; the name is then added elsewhere; Add is pressed, and the engine host's refusal reads on the add's line with its scope, in today's line form;
- the split shown under Arguments for G4's line and for an empty argument; a line ending in a quote shows the sentence and no boxes; the sentence about arguments is under the field;
- the secrets sentence and the warning appear and leave by the rule above, the warning directly under "Add to";
- G7: the note under a header's row and under the URL for each of the five names the record proves, none for a name of the person's own, none under a variable of a local command; Add enabled throughout;
- with Details open, no text and no attribute of the sheet outside the value fields themselves holds a slot's content, the command reads `•••` in its place, and each `•••` is one element that does not wrap;
- **held open**: after Add the sheet is closed and the line reads "Working…"; an `output` event shows its line; a second add of another name is started; the first ends failed and its line reads its words and code while the second still works; the second ends well, its line leaves, and its row is drawn when the inventory answers;
- after the send, nothing the operations book holds contains a slot's content;
- a refused send (`unknown_command` from an engine host of an older build) reads the transport's words on the line and nothing else changes.

The scene added to `e2e/discover-connectors.spec.ts`, beside the `add` case and with its scratch configuration directory: G1 as written (the scratch configuration's entry compared as parsed, `mcp list` naming both adds, the row in My items), then G2's add at `project` scope on the page of the scratch project the group's harness already has (the `.mcp.json` compared as parsed, the warning and the masked command seen before Add), then the same name added again at another scope, which the engine host refuses on the line. Invented names and values; no sign-in, no Keychain item.

### M3 — The dialog's sentence, the record, the whole checks, the hand-back

**At its end** the Connectors dialog's head carries the new sentence, the landing's record is written, and the acceptance has been run as far as an executor can run it.

**Touches.** `src/renderer/src/widgets/copy.ts` (`MCP.reach`); `widgets/McpWidget.test.tsx`, `widgets/McpDriven.test.tsx`; `e2e/widgets.spec.ts`, `e2e/c11-live.spec.ts`; any comment that quotes the old sentence; this document; one dated line in `docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md`.

**Decisions.**
- `MCP.reach(place)` answers `A switch here is for this chat, and every session started in ${place} afterwards.`; `MCP.reachTip` and everything that draws them stay.
- The expectations follow the words and nothing else: the eight of `McpWidget.test.tsx` (the pattern becomes `/^A switch here is for this chat, and every session started in .+ afterwards\.$/`, the exact ones name the same places), the absence in `McpDriven.test.tsx` (of "A switch here"), the two patterns of `e2e/widgets.spec.ts` and the one of `e2e/c11-live.spec.ts`. `c11-live` has no gate group: its edit is typechecked and runs at the next live sitting.
- *The record*: under §C's table of U11a's execution document, one line: "2026-11-14, UX wave U11g: the head's sentence is now “A switch here is for this chat, and every session started in <place> afterwards.” (`docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md`); today's sentence claimed sessions that are open, which the engine does not tell." Nothing else of that document changes. P4-R8's amendment is not this landing's: adding in Settings is not retired here.
- Then Concrete Steps 5 and 6: master merged, the wire's files made again if the minor moved, the whole typecheck, lint, the whole unit suite once, the scan, the script tests, and the hand-back.

**Does not touch.** The dialog's rows, switch, place or tooltip. The Connectors card. The unstarted chat's dialog and its line.

**Proves** G5, and runs the acceptance: each of G1 to G7 by the tests that pin it, named in the hand-back with the command and its result, and what only the architect's runs can show named as such.

## Concrete Steps

From the worktree of branch `ux-wave/U11g`. `vmcheck` below stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U11g --`.

1. **Master first.**

       git fetch origin master && git merge origin/master

   Then, for each file this document names that the merge changed (`git diff --name-only 3514e9cda origin/master`), read it again against "What the code says today" before building on it. If master now holds U11c's Customize (no "Configured on disk" toolbar left in `customize/connectors/ConnectorsSection.tsx`), stop and report: "Where" then names a head that is gone.

2. **Each milestone**, tests first where a test can fail first. Push before every check: the VM sees only what is on origin.

       git push -u origin ux-wave/U11g
       vmcheck 'timeout 900 pnpm exec vitest run <the test files and folders the milestone names>'
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'   # main, the hosts and shared code
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'    # the renderer; tsconfig.e2e.json for e2e/
       vmcheck 'timeout 600 pnpm exec eslint <the paths the milestone changed>'

   Each call prints `vmcheck: ux-wave/U11g at <short sha>` and then the command's output; its exit status is the command's. At a tests-first commit vitest fails on the new assertions; at the milestone's head it prints `Test Files … passed` with no failure, and `tsc` and eslint print nothing. **M1 runs both typechecks** (R4), and `src/shared/plugins src/shared/engine src/shared/ipc src/shared/machine src/shared/host/runtime.test.ts src/main/ipc/router.test.ts src/mawsd/front.test.ts src/engine-host/plugins src/engine-host/ops.test.ts src/engine-host/ipc-e8.test.ts src/engine-host/ipc-e10.test.ts src/engine-host/supervision.test.ts src/renderer/src/customize/connectors src/renderer/src/widgets/plugins test/endpoint/artifact-rows.test.ts test/support/cross-build-samples.test.ts test/support/plugin-cli-stub.test.ts test/lane-b`. M2 runs `src/renderer/src/customize src/renderer/src/widgets test/lane-b/renderer-guards.test.ts test/support/tokens-guard.test.ts` and the e2e project's typecheck. M3 runs `src/renderer/src/widgets test/support/tokens-guard.test.ts` and the e2e project's typecheck before the whole checks of step 5.

3. **M1, the wire.** After the schema, names, grades and routes are edited, take the next `WIRE_MINOR` on the master last merged (47 at the pin; merge again first if master has moved), with its comment ("the UX wave's U11g: connectors.addJson"), then make the generated files again on the VM and bring the result back:

       G='src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json src/shared/ipc/routes.json src/shared/machine/address-paths.json'
       vmcheck "pnpm wire:manifest >/dev/null; MAWS_ROUTES_WRITE=1 pnpm exec vitest run src/shared/ipc/routes.test.ts >/dev/null; MAWS_ADDRESS_PATHS_WRITE=1 pnpm exec vitest run src/shared/machine/coverage.test.ts >/dev/null; git diff -- $G; git checkout -- $G" > /tmp/u11g-wire.patch
       sed -n '/^diff --git/,$p' /tmp/u11g-wire.patch | git apply

   Expect the patch to add `commands.connectors.addJson` and the minor to the manifest, one name to `routes.json` and a new value in `wire-fingerprint.json` (it covers every command the engine host owns), and nothing under `events.plugins.operation` and nothing in `address-paths.json` (the command names no session). A line under the event means an enum moved: undo it (code, 2). Then `vmcheck 'timeout 900 pnpm exec vitest run src/shared/ipc src/shared/machine test/lane-b/offer-coverage.test.ts'` passes.

4. **M1 and M2 add tests with keys named like credentials** (a header, a variable, the names of G7). Run the scan before each hand-back: `vmcheck 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'`. It passes; a failure names the file, and the cure is a plainer invented value, not an allow-list entry.

5. **M3, master again, then the whole checks.**

       git fetch origin master && git merge origin/master
       grep -n "export const WIRE_MINOR" src/shared/ipc/wire.ts | cut -c1-60

   If the merge conflicted in `wire.ts` or in a generated file, or master's minor is now this branch's or higher: keep master's comment, give this landing's addition the next number after master's, take master's side of the four generated files, and run step 3's regeneration again. Then:

       vmcheck 'timeout 900 pnpm typecheck'
       vmcheck 'timeout 900 pnpm exec eslint src/shared/plugins src/shared/engine src/shared/ipc src/shared/host/runtime.test.ts src/main/ipc/router.test.ts src/mawsd/front.test.ts src/engine-host/plugins src/engine-host/ipc.ts src/engine-host/connectors src/renderer/src/customize src/renderer/src/widgets e2e/discover-connectors.spec.ts e2e/widgets.spec.ts e2e/c11-live.spec.ts'
       vmcheck 'timeout 2400 pnpm test'
       vmcheck 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'
       vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

   Then the acceptance's own tests, named, so the hand-back can quote one result for G1 to G7:

       vmcheck 'timeout 900 pnpm exec vitest run src/shared/plugins src/engine-host/plugins src/engine-host/ipc-e8.test.ts src/engine-host/ops.test.ts src/main/ipc/router.test.ts src/mawsd/front.test.ts src/shared/host/runtime.test.ts test/endpoint/artifact-rows.test.ts src/renderer/src/customize/connectors src/renderer/src/customize/CustomizeView.test.tsx src/renderer/src/widgets/McpWidget.test.tsx src/renderer/src/widgets/McpDriven.test.tsx'

   It prints `Test Files … passed` with no failure. G1's rule about values, G3's check where the act runs and G6 are shown by the paths before `src/renderer`, G1 to G4 and G7 in the window by the next two, G5 by the last two; what the real engine writes (G1, G2) is the scene's, in Proof P2.

   `pnpm typecheck` takes about five minutes and prints no error. In `pnpm test` the files the build brief lists as failing on master too are not this landing's; any other failure is. The script tests pass: this landing adds no spec file and no time bound to a scene. Look at a run in the background before its limit has passed twice; a log that has stopped growing beside a process at full CPU is a loop, and a finding.

6. **Stop and hand back.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e, engine or probe. The hand-back says: what exists, with the command and result that showed it; the master and the wire minor the branch stands on; what is not verified (every e2e scene); the decisions made; anything that contradicts this document; the residue. Residue known at authoring, each a row for the debt tracker at landing:
   - a value is readable in the CLI's arguments by the person's own processes while it runs (accepted by the design);
   - a value the CLI printed in a form other than as written or as JSON escapes it would not be recognised, and its line would be forwarded; by Engine facts, 7, the one message of this command that can quote the configuration quotes it in the second of those forms;
   - a value of one character, or one that is part of the connector's name, costs the person the engine's wording of a refusal (the rule);
   - an argument, a URL and a command are public fields: a secret typed into one is shown back and kept as typed, which the sentence under Arguments says;
   - a caller that puts text into the name of a key is not this form; such a key's name is logged by the existing dropped-field line and named by the strict refusal, as for every command;
   - an add made by another process between the engine host's read and the CLI's write passes the name check;
   - a Cancel pressed after the CLI has written is not an undo: the row appears at the next read;
   - on a page whose folder is a linked worktree nothing can be added, at any scope, until the resolver's fix of the switches' landing;
   - the list of names the engine reserves (`src/shared/engine/app-mcp-servers.ts`) was written against engine 2.1.304 and is not re-read here; a name a later engine reserves is added and then not loaded;
   - the list of names the engine reads as empty toward a remote server is engine 2.1.322's explicit lists; a later engine's list can differ, its patterns are not copied, and a name set nowhere is not noted at all.

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
    export type McpPair = { name: string; value: string };       // `value` is a value slot; `name` is public
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

A problem names a field and a row, never a slot's content.

**The command line.**

    export interface McpActionInputs {
      'mcp-add': { name: string; url: string; transport: McpTransport; scope: PluginsScope } | { name: string; scope: PluginsScope; entry: McpEntry };
      'mcp-remove': { name: string; scope: PluginsScope };
    }
    export function mcpEntryJson(entry: McpEntry): string;

`mcpEntryJson` is a serialiser and applies no rule: `JSON.stringify` of an object that holds, for a remote entry, `type`, `url` and, only when there is at least one header, `headers` (each name to its value); for a local one `type`, `command`, `args` and, only when there is at least one variable, `env`. `mcpCommandLine('mcp-add', { name, scope, entry })` answers `['mcp', 'add-json', name, mcpEntryJson(entry), '--scope', scope]`, and throws, in fixed words, when the name fails `isMcpName` or the entry has a problem. For today's two inputs it answers what it answers today.

**The value slots, and what is built from the structure.**

    export const MCP_MASK = '•••';
    export function mcpValueSlotsOf(input: McpActionInputs[McpAction]): string[];   // the content of every header's and variable's value of an entry that is not empty; [] for any other input
    export function holdsValueSlot(text: string, slots: readonly string[]): boolean; // whether text contains a slot's content, as written or as JSON.stringify writes it inside a string
    export function mcpShown<I extends McpActionInputs[McpAction]>(input: I): I;     // the same input with MCP_MASK in every value slot, empty ones too; the input itself when it has no entry
    export function mcpShownLine<A extends McpAction>(action: A, input: McpActionInputs[A]): string[];
    export function mcpShownCommand(input: McpActionInputs['mcp-add']): string;      // `claude mcp add-json <name> '<json>' --scope <scope>` of the shown line, the JSON single-quoted for a shell

`mcpShownLine` validates the real input once, as `mcpCommandLine` does, and then serialises `mcpShown(input)` with `mcpEntryJson`: no rule is applied to the substituted text. `holdsValueSlot` is a test, and nothing replaces text inside a line.

**The names the engine empties** (`remote-emptied-names.ts`, new; the one named place):

    export const REMOTE_EMPTIED_NAMES: ReadonlySet<string>;
    export function remoteEmptiedNamesIn(text: string): string[];   // each such name once, in the order met, as the person wrote it

A reference is `${NAME}` or `${NAME:-…}`, by the engine's own pattern (`:388404`: a letter or underscore, then letters, digits and underscores, then optionally `:-` and anything up to the brace). A name counts when, put in upper case and with a leading `INPUT_` removed, it is in the set or begins with `OTEL_` (`:1012244`). The set is the names of four literal lists of engine 2.1.322, in upper case, 132 in all: `B1o` and `U1o` (`:388366`), `ui` (`:537479`) less the five of `j1o` (`:388366`), and `uKn` with `Hne` (`:956846`); the engine builds its remote set from them at `:388380-388384` and `:1012249-1012251`, each also under the prefix `INPUT_`. Not copied: the patterns of `RVe` (`:388367-388370`), the rules on a value's shape (`FVe`, `$Ve`, `:388393-388400`) and the names `Pcn` computes at run time. The file's header says which engine the list was read from.

**The reserved names** (`src/shared/engine/app-mcp-servers.ts`): one exported predicate, true for `maws` and for the names of that file's engine list, which the form and §B's schema read. The list itself is not edited.

### §B. The command (`src/shared/ipc/schema/connectors.ts`)

    'connectors.addJson': host(z.strictObject({ cwd: PluginsCwdSchema, binary: PluginsBinarySchema, name: <McpServerNameSchema, and not reserved>, scope: PluginsScopeSchema, entry: McpEntrySchema, folder: PluginsCwdSchema.nullable() }), OperationReceiptSchema)

`folder` is the page's folder, whose configuration the name is checked against; null on the user configuration's page, where the scope is `user` and `cwd` is the engine's configuration directory. With a folder, `cwd` is that folder. The schema refuses any other pairing.

`McpEntrySchema` is a strict union on `type` of the two shapes of `McpEntry`, each string and list with its bound from `MCP_ENTRY_BOUNDS`, with one refinement on the whole entry, `mcpEntryProblem(entry) === null`, under one fixed message. A value slot's schema is a string with its length bound and nothing else: no enum, literal or refinement stands on a slot, so no issue raised on one can carry what it received (R2). Owner `engine-host`; bridged to the window beside `connectors.add` (`names/connectors.ts`); grade `machine-admin`; in `PATH_COMMANDS`; no offer; not main-only.

The engine host answers it with a receipt at once, then `plugins.operation` with `action: 'mcp-add'` and `target` the name, `plugins.cancel` stopping it, as for `connectors.add`. The operation's outcomes, beyond the runner's own for a cancel, a timeout and an overflow (the enum of `error.code` cannot grow, so the new cases are told apart by `failureCode`; the words live in one table beside `mcpOutcome`):

| when | `code` | `failureCode` | `message` |
|---|---|---|---|
| it was added (exit 0) | — (`ok`) | — | `Added <type> MCP server <name> to <scope> config`, worded from the input; `result.name`, `result.scope` as today |
| the check before the run found the name | `spawn_failed` | `name_configured` | `<name> is already configured here (<scope> scope). Nothing was added.`; for MAWS's own list: `<name> is held by MAWS’s own list (Settings › Sessions › MCP servers). Nothing was added.` |
| the check's read was not whole, or failed | `spawn_failed` | `configuration_unread` | `Not every configuration here could be read, so the name can’t be checked. Nothing was added.` |
| the CLI exited with another code and its last error line holds no slot's content | `cli_failed` | none | that line |
| the same, and the line holds one | `cli_failed` | `message_withheld` | `Claude Code exited <code>. Its message repeats a header or variable value, so it is not shown. To read it, run this in a terminal with your values in place of •••: <mcpShownCommand>` |
| the CLI exited with another code and printed no error line | `no_result` | none | today's words |
| the CLI could not be started and the system's message holds a slot's content | `spawn_failed` | `message_withheld` | `The command could not be started. The system’s message repeats a header or variable value, so it is not shown.` |

`spawn_failed` is the code the runner already gives when nothing was started (a binary that changed, a folder that is gone).

A machine whose engine host is of an older build answers `unknown_command`; nothing ran.

### §C. What may leave the runner (`src/engine-host/plugins/runner.ts`, `cli-result.ts`)

An operation carries `slots: readonly string[]`, `mcpValueSlotsOf(input)` for an MCP action and empty otherwise. For an operation with none, everything is as today. **For an operation with slots:**

| what leaves | the rule |
|---|---|
| the receipt; the event's `opId`, `action`, `target` | public: `target` is the name, shown as typed |
| an `output` event | no line of stdout is emitted; a line of stderr is emitted, whole, only when `holdsValueSlot` is false for it, and is otherwise not emitted |
| the `done` event | §B's table; stdout is never read |
| `running()`'s replay | `op.latest` holds only events made by the two rows above |
| the engine host's log (`console.warn` in `start`) | the thrown error's message only when it holds no slot's content; otherwise that the message is withheld |

The operation's `input` and `argv` live in the engine host's memory until the operation ends and are handed to nothing but `spawn`. The check before the run (M1) reads the inventory and builds its result from public fields.

### §D. The window (`src/renderer/src/customize/connectors/`, `widgets/plugins/`)

- The sheet: a component of `customize/connectors/` that `ConnectorSheet` draws for a request with action `mcp-add` whose input holds an `entry`; it takes what `ConnectorSheet` takes (`request`, `env`, `onConfirm`, `onClose`) and confirms with a request whose input is `{ name, scope, entry }`.
- The form's rules: pure functions beside `present.ts` (from the typed fields, the page's folder and the configured servers to an entry or each field's problem), exported for the later landing that opens the sheet filled in.
- `argvOf(request)` answers the shown line (§A). The operations book sends `connectors.addJson` with `folder` for a request with an `entry`, and keeps `mcpShown` of that request.
- The add's key is `connector:add:<scope>:<name>`; its line is drawn at the list's head while it works or has failed.
- The value field: one component, the one place for the owner's answer on masking.

### §E. Words

Exact, with the apostrophes as each file writes them. "The design's" are given by the design; "ruled" by the architect on 2026-11-14 (the words themselves, or that there be such a sentence, this document wording it); "this document's" are its own. Each is in `customize/connectors/copy.ts` unless said; §B's fixed results are in §B.

| where | words | whose |
|---|---|---|
| the action at the head | Add custom connector… | the design's |
| the sheet's title | Add custom connector | this document's |
| the fields | Name · Type · URL · Request headers · Command · Arguments · Environment · Add to | the design's |
| the types | Remote (HTTP) · Remote (SSE) · Local command | the design's |
| the scope choices, on both kinds of page | All projects · <project> only · <project>, shared in its .mcp.json; the user configuration's page shows "All projects" alone, under "Add to" | the design's; ruled (R7) |
| under the rows, once | Saved in Claude Code’s configuration file as written. | the design's |
| `sharedFileWarning`, directly under "Add to" (one named place) | This file is usually committed with the repository. Write a secret as ${NAME}, with a name of your own, and set NAME under env in ~/.claude/settings.json or in the environment Claude Code starts with. | ruled (R9) |
| a name the engine empties, under the URL or the header's row | Claude Code sends <NAME> to a remote server as empty. Use a name of your own. | ruled (R9) |
| the Connectors dialog's head (`MCP.reach` in `widgets/copy.ts`) | A switch here is for this chat, and every session started in <place> afterwards. | the design's |
| the submit button, the name's three refusals, the URL's two, the three lines about what is configured here, "Sessions started from now on load it; running sessions do not." | today's (`W.submit['mcp-add']`, `nameRequired`, `nameRule`, `exists`, `urlRequired`, `urlScheme`, `serversReading`, `serversFailed`, `serversPartial`, `takesEffect`) | unchanged |
| under Arguments, always | Arguments are shown and saved as typed and are hidden nowhere. Put a secret in Environment. | ruled (R7), worded here |
| under the rows, while one has neither a name nor a value | An empty row is not added. | ruled (R7), worded here |
| a row with a value and no name | Enter a name for this header. · Enter a name for this variable. | ruled (R7), worded here |
| a reserved name | This name is reserved by Claude Code or by MAWS. | this document's |
| the row buttons, and a row's two fields | Add header · Add variable · Remove (with the row's name, or its number, as its accessible name) · Name · Value | this document's |
| an empty command | Enter the command. | this document's |
| a command that holds a space | Taken whole as the program to run, spaces included. Arguments go in Arguments. (a note, muted; it refuses nothing) | this document's |
| under Arguments, above the boxes | No arguments · 1 argument · <n> arguments; an empty argument's box reads (empty), muted | this document's |
| arguments ending inside a quote | The arguments end inside a quote. | this document's |
| arguments ending on a backslash | The arguments end with a backslash. | this document's |
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
| `plugins.operation` for a custom add | action `mcp-add` and the codes F's reader knows; a `failureCode` is a free string | an app on F that connects while one runs is sent its last event; F's window follows only operations it started and drops it | — | nothing is stored |
| the Connectors dialog's sentence | this window's copy | a session on a machine of build F shows it too, and it is true there: the switch is the same act | — | — |
| the machine link | nothing new crosses it | — | — | — |

### §G. What waits, and what happens meanwhile

| the act waits for | the person acts in between | it fails, or never comes | held open by |
|---|---|---|---|
| the sheet's opening: `plugins.env`, and the inventory read again | they type; Add is disabled; a later opening drops an earlier one's answers (today's `opening` counter) | the binary: its words, no Add. The inventory failed or partial: its sentence and Retry. Never: "Reading what is configured here…" stays and Cancel closes the sheet. | M2's first held-open test |
| the check before the run, in the runner's queue | the sheet is closed; the line reads "Working…"; a cancel ends it with nothing started; the name added elsewhere meanwhile is found by this read | the read not whole, or thrown: the fixed result, nothing started | M1's check tests; M2's second held-open test |
| the operation: a receipt, then events | another add can start under its own key and waits its turn; Cancel on the line stops the CLI; leaving the page drops the lines, not the operation | the engine's words on the line, or the fixed sentence. A send that is refused: the transport's words. Never: the runner ends it at its own ceiling (`CLI_TIMEOUT_MS`) with its words. | M2's third held-open test; M1's replay test |
| the row: the inventory read after `plugins.changed` | they can press Refresh | today's inventory failure line with Retry; the row appears when a read answers | M2's third held-open test, its last step |

### §H. Dependencies on other landings, and what this one exposes

Consumed, by the name each is exposed under. **U11a** (on master): `existingOf`, `configuredOf` and `ConfiguredServers`, `scopesFor`, `writesFor`, `serverKey`, the sentences of `CONNECTORS` named in §E, `useCustomizationInventory`, `readCustomizationInventory`, `MCP.reach` and `MCP.reachTip` with the frame's note, and §C's `<place>` of that document. **U7b** (on master): Customize is a page that `CustomizeView` fills; nothing is called by name. **U6a, U8a, U3a, U13a, U9, U8b**: nothing; no action id, no chord, no act on a session, no offer, no stored key.

Exposed to the later landings of this design and to U11c: `splitArgs`; `McpEntry`, `mcpEntryProblem`, `mcpEntryJson`, the entry input of `mcp-add`; `mcpValueSlotsOf`, `holdsValueSlot`, `mcpShown`, `mcpShownLine`, `mcpShownCommand`, `MCP_MASK`; `REMOTE_EMPTIED_NAMES` and `remoteEmptiedNamesIn`; the command `connectors.addJson` with its fixed results; the runner's step before the run and §C's rule, which any later command that carries a value inherits by putting it in an entry (the move, which adds a name MAWS's own list holds on purpose, will need the check to let that one entry through); the custom sheet and its form rules, opened from a request; the action's label, which U11c moves to the head's right of My items; the reserved-name predicate.

## Proof that an executor does not run

| | what | when | what it needs | what comes back, and what it decides |
|---|---|---|---|---|
| P1 | **The owner's answer on the value fields** ("The owner's look") | any time before the pull request | the architect's question to the owner | plain fields stay, or the one component of §D becomes a masked field with a reveal control, as a fix |
| P2 | **The e2e scenes**, on a Mac under the load rule | after M3's hand-back; M2's scene as soon as M2 is pushed | the new scene of `e2e/discover-connectors.spec.ts` alone first (the `discover` group: the real engine's CLI, whichever version that group runs, under a scratch configuration directory; the scene makes no sign-in and no Keychain write of its own; the run's record names the engine's version, since the facts here were recorded on 2.1.322); then the groups that hold what the change reaches: `discover`, `widgets` (the dialog's sentence), and `default` since the renderer changed | verdicts by group, and the screenshots of the sheet in its states beside the drawn ones. A red scene goes back as a fix. |
| P3 | **The branch review** | after M3 | `doperpowers:review-code`, the xhigh panel, over `origin/master...ux-wave/U11g` (Decision Log, with its lenses) | a verdict and findings; the fixes are one wave |
| P4 | **Class 1a** | on the head handed back; again on the final head if the review changed the branch | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u11g`, in the background | the run's id, which the pull request names |

No cross-build run is needed for this landing: §F stores nothing and relies on no read by build F. No probe is outstanding: the two facts first read only in the engine's source were run in pass 3 (Engine facts, 6).

## The owner's look

The architect drew the sheet from this document, with the app's tokens: the two remote types and the local command, the states (refusals, the split arguments, the warning), and the value fields; the drawings are kept outside the repository. What they showed is ruled (R7) and folded into "The form's fields", §E and M2: one wording of the scope on both kinds of page; how the command wraps behind Details; the warning directly under "Add to"; a sentence under Arguments; the two states of a row worded; a failed add's line in today's form; Details closed at opening.

One question is with the owner and holds nothing back: whether the value fields are masked, with a reveal control, or plain as built. M2 is built plain; the answer changes one component (§D).

## The pull request

Opened by the architect after the gate. Its body opens with the root's path, "U11, landing U11g" and the parent pin; says that the child's file gains this design in the spec's next batch and that this document is its record until then; names its class 1a run, its review verdict and its residue (Concrete Steps 6, with what the milestones add); names the later landings of the design that it leaves ("The landing's edge"); and lists the one dated line it carries in U11a's execution document. It ends with the `Sminos-Session:` line.

## Surprises & Discoveries

- Observation: a custom add cannot be a new runner action, and a new refusal cannot be a new error code; an added member of either enum of the event is a wire major.
  Evidence: `src/shared/ipc/wire.ts`, the compatibility rule ("an added enum member included, since an older reader refuses it"); `events.plugins.operation` in `src/shared/ipc/wire-manifest.json` lists the ten actions and the six codes.
- Observation: the runner hands a CLI's words on at five places, and one of them, the `done` event, does not pass the function the others pass.
  Evidence: `PluginsRunner.finish` calls `this.deps.emit` directly; `run`'s `emit` closure sets `op.latest` (code, 3).
- Observation: of everything `add-json` can print, one message can quote the configuration file: the error of reading it back after the write.
  Evidence: `cli.pretty.js:475658` of 2.1.322, thrown at `:476792` with the read's own error as its reason (Engine facts, 7).
- Observation: toward a remote server the engine reads a set of well-known variable names as empty and says so only in its debug file; the server still connects.
  Evidence: pass 3, `spikes/protocol-probe/fixtures/uxwave/u11-connector-scope3.ndjson` line 2, `remote`: `NPM_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `ANTHROPIC_API_KEY`, `HTTPS_PROXY`, `OTEL_EXPORTER_OTLP_HEADERS` read `empty` in headers and URL; `cli.pretty.js:388426`.

## Decision Log

- Decision: the verification this landing gets. This document gets an adversarial review before an executor starts; the architect dispatches it. Each milestone is reviewed at its boundary; M1's before M2 consumes it. The branch gets `doperpowers:review-code` at the xhigh panel: it is of panel size by its files (about forty-six, over the wave's threshold of about twenty, though fifteen are registrations and generated files) and near it by its lines, and its delicate part is small and easy to miss, the way a value slot's content could come back in the CLI's own words. The panel's lenses: (1) the rule about values: every row of §C; a CLI line forwarded whole or not at all; the success never read from stdout; the replay, the log and the failure messages; try a value the test misses and a line that slips past it; (2) the command's input on its way in: main's router, the daemon's front, the host runtime, their refusals and their logs; nothing logs or stores an input, no ledger can hold it, no offer reaches it; (3) the name check where the act runs: inside the queue, immediately before the spawn, with the reader the sheet uses; two adds queued; a cancel during it; (4) the form stands where the engine checks nothing: the URL, reserved names, the splitter against its table, the emptied names against the record's five; (5) the wire is additive only, no enum grew, and both pairings with build F do what §F says; (6) the window: the shown line everywhere a command is drawn, the book after the send, and the sentence true on every route that draws it. Class 1a on GitHub Actions is the gate of record.
  Rationale: the root gives the panel to a branch of panel size or a delicate change (UC-10); this is the first by count and the second in one path.
  Date/Author: 2026-11-14, the author of this document.
- Decision: revised once, on the adversarial review (needs attention; five findings) and the architect's rulings R1 to R9 of the same day ("Ruled by the architect"). What moved: the secrecy rule is restated as a rule about value slots, with public fields exempt, and replacement inside a line is dropped for forwarding a CLI line whole or not at all, the success worded by MAWS and stdout never read (R1); the entry's schema keeps every check off the value slots and three boundary tests pin that a refusal echoes none (R2); the name is checked again by the engine host inside the runner's queue, with a `folder` on the command for it and two fixed results (R3); M1 narrows the renderer's readers of the remote add's input and proves the web typecheck (R4); the shown line is serialised without bounds after one validation (R5); the JSON's key order is no longer pinned (R6); the drawn sheet's seven points (R7); M2 no longer waits for the owner (R8); the warning's sentence and the note for a name the engine empties, with its fixed list (R9). Engine facts gained the list of what `add-json` can print and pass 3's results; the two facts first read only in the source are run.
  Rationale: the first version promised that no value could leave in the CLI's words and built a search-and-replace that a short value or a value inside the name made either leaky or destructive; the rule now says exactly what is built. The name check at the sheet alone could be passed by a sheet held open.
  Alternative rejected: keeping replacement inside a line beside the whole-line test; two mechanisms for one promise, and the weaker one visible.
  Date/Author: 2026-11-14, the author of this document, on the architect's rulings.

## Outcomes & Retrospective

Pending — written at finish.
