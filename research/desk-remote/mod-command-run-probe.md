# Driving slash commands from outside: `$.command.run`, `control.sock` `reply`, and PTY keys (measured)

Ran on **Claude Code 2.1.307**, the build installed on this Mac (`/Users/new/.local/share/claude/versions/2.1.307`), on 2026-10-21. The code reading the probe started from is the 2.1.300 reprint (`cli.pretty.js`, `SPEC/38`). Where 2.1.307 behaves differently, the 2.1.307 reprint (`/Users/new/claude-code-bundle/2.1.307/cli.pretty.js`) was checked; line numbers below refer to that file.

**M** = measured in this run (an observed result plus an independent check of the effect). **I** = inferred, from code or by analogy, not run.

## What it comes to

- **M** `$.command.run` drives almost every built-in a remote desk needs. It covers `/model`, `/effort`, `/mcp enable|disable|reconnect <server>`, `/rename`, `/plan`, `/branch`, `/resume <id>`, `/cd`, `/export`, `/compact`, `/clear`, `/config key=value`, `/color`, `/autocompact`, `/output-style`, `/reload-plugins`, `/background` and `/exit`.
- **M** The result rarely carries the output. Most built-ins are `local-jsx` commands and resolve to `{}` or `{ context }` even when the terminal prints a line, and a failure resolves the same way (`/model bogus` gives `{}`). Only `local` commands return `{ text }`. To know what happened, read the `<local-command-stdout>` row in `$.session.messages()` or check the effect itself.
- **M** A panel holds both the promise and the queue. A panel command resolves when the panel closes, not when it opens, and every queued command waits behind it. Closing it, or finishing what it asks, takes keys into the PTY.
- **M** Three argument forms still raise a dialog:
  - `/model <id>` after turns, when switching away from the model the cache is warm on ("Switch model?").
  - `/add-dir <path>` always asks for confirmation.
  - `/rewind` opens its picker.
- **M** `/plan` is a slash command that sets a permission mode (plan). Nothing else sets the current mode. `/config permissionMode=…` sets only the default for new sessions. Shift+Tab in the PTY cycles the mode, and through `claude attach` it does the same for a `--bg` job.
- **M** Through `reply`, mid-turn `/model`, `/effort`, `/rename` and `/usage` run at once, and `/model` asks nothing that way. Other slash commands, and every slash command sent while idle, are queued as human input and then behave exactly as typed: panels open in the job's PTY.
- **M** A `reply` answers AskUserQuestion. It cannot answer a permission prompt or the model-switch dialog. Worse, that text is queued and later sent to the model as a prompt.

## The table

"Resolves" is `$.command.run`'s settled value, or the control socket's answer for `reply`. "Effect" is the independent check. The mod path ran in an interactive TUI in tmux. The `reply` path ran against background jobs under an isolated supervisor: one from `/background`, one from `claude --bg`.

### Path: mod (`$.command.run`)

| Command | Resolves | Terminal (`capture-pane`) | Effect, as verified | Notes |
|---|---|---|---|---|
| `/model sonnet`, conversation still empty | `{}` in 52 ms | `Set model to Sonnet 5.5 and saved as your default for new sessions` | **M** `$.session.model()` → `claude-sonnet-5-5[1m]`; `settings.json` `model: "sonnet"` | No text. It also changes the default for new sessions. |
| `/model sonnet` after two turns | pending until the dialog is answered | `Switch model? … This conversation is cached for the current model…` 1. Yes / 2. No | **M** model unchanged until Enter in the PTY, then sonnet | `/model haiku` back to the model the cache holds did not ask. |
| `/model nonsense-model-xyz` | `{}` | `API error: 400 … · model not changed` | **M** model unchanged | Failure and success settle the same way. |
| `/model sonnet` mid-turn (Bash `sleep 12` running) | queued; ran after `turn.complete` (+15.0 s), then the dialog above | `› Prompt from the cmdprobe plugin` / `❯ /model sonnet` shown as queued | **M** `$.session.model()` still haiku mid-turn | It is queued even though `/model` is an `immediate` command when typed. |
| `/effort high` | `{}` in 32 ms | `Set effort level to high (saved as your default…)` | **M** footer `● high · /effort`; `settings.json` `modelSettings["claude-haiku-5-5"].effortLevel` | |
| `/mcp disable probe` | `{}` in 66 ms | `MCP server "probe" disabled` | **M** the server process exited (its own log); `mcp__probe__ping` left `$.tool.list()`; `.claude.json` `projects[cwd].disabledMcpServers: ["probe"]` | Persists per project. |
| `/mcp enable probe` | `{}` | `MCP server "probe" enabled` | **M** new pid, `initialize` + `tools/list` in the server log, tool back | |
| `/mcp reconnect probe` | `{}` | `Successfully reconnected to probe` | **M** old pid `exit`, new pid `start` | |
| `/mcp` (bare) | pending; `{}` after Esc | `Manage MCP servers` panel | **M** see PTY rows | |
| `/rename probe-one` | `{ context: ["<system-reminder>The user named this session \"probe-one\"…"] }` | `Session renamed to: probe-one`; name on the prompt bar | **M** transcript `custom-title` row; `sessions/<pid>.json` `name` | |
| `/plan` | `{}` | `Enabled plan mode` | **M** footer `⏸ plan mode on` | A second `/plan` prints `Already in plan mode. No plan written yet.` |
| `/plan <description>` | `{}` at +0.2 s, as the turn started | `Enabled plan mode`, then the model's answer | **M** `turn.start`/`turn.complete` events; footer plan mode | Resolves at turn start, not at turn end. |
| `/branch probe-branch` | `{}` | `Branched conversation "probe-branch". You are now in the new branch (session …)` | **M** `$.session.id()` changed; new transcript with `custom-title` probe-branch | Fires `session.end` (`reason: "resume"`) with no `session.start` after it. |
| `/resume <original id>` | `{}` | prompt bar back to `probe-one` | **M** `$.session.id()` back to the original | With an id, no picker. |
| `/add-dir <path>` | pending until the dialog is answered; `{}` | `Add directory to workspace` 1. Yes, for this session / 2. remember / 3. No | **M** after Enter in the PTY: `$.tool.check` Read inside it → `allow`, outside → `ask` | Does not skip its dialog. |
| `/context` | `{ context: ["## Context Usage …markdown table…"] }` in 650 ms | the coloured grid | **M** payload as shown | The model-facing markdown is the result; no `text`. |
| `/usage` | pending while open; `{}` on Esc | Settings panel, Usage tab | **M** Esc resolved it | Transcript: `Settings dialog dismissed`. |
| `/permissions` | same | Permissions panel (Allow/Ask/Deny/Workspace tabs) | **M** | |
| `/config` | same | settings list panel | **M** | |
| `/config verbose=true` | `{}` | `Set Verbose output to true` | **M** `settings.json` `verbose: true` | No panel. Keys are the `key`s of `$.config.list()` (38 rows here). |
| `/config permissionMode=acceptEdits` | `{}` | `Set Default permission mode to acceptEdits` | **M** `settings.json` `permissions.defaultMode`; the footer still showed manual | Sets the default only, not the session's mode. |
| `/rewind` | `{}` in 22 ms, while the picker stays open | `Rewind` picker of prompts | **M** see PTY rows | Defined as `type: "local"` in 2.1.307 (**I**), and it does not hold the promise. Whether it holds the queue was not measured. |
| `/clear` | `{ text: "" }` | header redrawn | **M** new `$.session.id()`; `session.end` `reason: "clear"` | |
| `/compact keep it to one line` | `{}` after 4.6 s, when compaction ended | `Compacted` | **M** `$.session.messages()` ≥20 → 7 | |
| `/cd <path>` | `{ context: ["…working directory has changed…"] }` | `Moved to …` | **M** `$.session.cwd()` and `root()` changed | |
| `/export <file>` | `{}` | `Conversation exported to: …` | **M** file written (5.4 KB) | |
| `/reload-plugins` | `{ text: "Reloaded: 1 plugin · 0 skills · …" }` | same line | **M** | A `local` command returns text. |
| `/output-style explanatory` | `{ text: "Output style set to Explanatory" }` | same | **M** | |
| `/color red` | `{}` | `Session color set to: red` | **M** transcript `agent-color` row | |
| `/autocompact 200000` | `{}` | `Auto-compact window for Haiku 5.5 set to 200k tokens` | **M** `modelSettings[…].autoCompactWindow: 200000` | |
| `/background` | `{}` at 0.5 s | the TUI exits (tmux session gone) | **M** the isolated supervisor's `list` holds the job (`source: "slash"`, name kept, new session id), conversation carried; the mod loaded again in the worker | |
| `/exit` | `{}` | process exits | **M** `session.end` `reason: "prompt_input_exit"` | |
| any unknown name | rejects `no command named /x in this session` | — | **M** | |
| `/effort medium` while `/usage` is open | pending until the panel was dismissed, then ran | — | **M** footer changed after Esc | The queue waits behind an open panel. |
| any, after Esc stopped a turn | rejects `the session was stopped and nobody has sent input since` | — | **M** | Typing a character, Shift+Tab ×4 and C-u did not clear it. Submitting a typed `/effort medium` cleared it, and so did a `reply` (bg). An Esc that only closes a panel, or "No" on a permission prompt, does not set it. |
| any, from a `tool.call` hook | rejects `called from a tool.call hook, it would wait on the turn this hook is holding…` | — | **M** | |
| `/effort low`, from a `turn.start` hook | `{}`; queued, ran after the turn | `/effort low` row after the answer | **M** settings changed after the turn | `turn.start` is not a held hook (see Contradictions). |

### Path: `reply` over `control.sock`

| Command / text | Answer | Job's PTY (`claude attach`) | Effect, as verified | Notes |
|---|---|---|---|---|
| `/effort low`, idle | `{ok:true}` | `Set effort level to low…`; footer `○ low` | **M** `settings.json` effortLevel low | Queued human input, run as a command. |
| `/model sonnet`, mid-turn | `{ok:true}` | `Set model to Sonnet 5.5…`, no dialog | **M** `$.session.model()` sonnet 1 s after, turn still running (ended +20 s); same on the `claude --bg` job | Immediate runner. The rest of that turn ran on sonnet. |
| `/rename bg-renamed`, mid-turn | `{ok:true}` | prompt bar changed mid-turn | **M** `jobs/<short>/state.json` `name` (`nameSource: "user"`); the control socket's `list` `name` stayed stale even after idle | Same on the `--bg` job. |
| `/effort high`, mid-turn | `{ok:true}` | applied mid-turn | **M** settings changed 1.2 s after, turn running | Immediate. |
| `/usage`, mid-turn | `{ok:true}` | printed as text rows, no panel | **M** | Immediate. These outputs are not in `$.session.messages()`. |
| `/mcp disable probe`, mid-turn | `{ok:true}` | queued, `ctrl+x ctrl+s to send now`; ran after the turn | **M** server pid alive 1 s after the reply, gone after the turn | Not on the allowlist. |
| `/usage`, idle | `{ok:true}` | Settings panel opened in the job | **M** | Needs Esc in the PTY. |
| `/model haiku`, idle, conversation cached on sonnet | `{ok:true}` | `Switch model?` dialog | **M** model unchanged until Enter in the PTY; on the `--bg` job, Down+Enter ("No") kept haiku | |
| `1` while that dialog was open | `{ok:true}` | `❯ 1` queued | **M** the dialog stayed open; once answered by key, `1` went to the model as a prompt | |
| AskUserQuestion (Red/Blue), `reply` `Blue` | `{ok:true}` | `User answered Claude's questions: → Blue`, model replied `Blue` | **M** `list` `needs: "answer: Which color do you prefer? (Red · Blue)"` while blocked; cleared after | Structured-question resolver. |
| Permission prompt (Bash `touch perm.txt`), `reply` `1` then `yes` | `{ok:true}` ×2 | dialog stayed; both queued as prompts | **M** file absent; `list` `needs: "approve Bash: touch perm.txt"`. Enter in the PTY approved it (file created), then `1` and `yes` reached the model | Reply cannot approve, and the stray text becomes a turn. |
| `permission-response` op (fake `requestId`, `allow: true`) | `{ok:true}` | dialog stayed | **M** no effect | Dead op, as SPEC 38 says. |
| `/effort low` with `nextTurn: true` | `{ok:true}` | text sent to the model as a prompt | **M** effortLevel unchanged | `nextTurn` skips slash parsing. |
| `/rewind`, idle | `{ok:true}` | picker in the job | **M** with PTY keys, messages 31 → 27 | |
| `/plan`, idle | `{ok:true}` | `Enabled plan mode`, footer plan mode | **M** | |
| `/clear`, idle | `{ok:true}` | cleared | **M** `$.session.id()` new; `list` `sessionId` stale | |
| any `reply`, after Esc stopped a turn | `{ok:true}` | — | **M** the mod's next `$.command.run` succeeded | A reply counts as human input. |

### Path: PTY (`tmux send-keys`)

| What | Keys | Effect, as verified |
|---|---|---|
| `/mcp` panel opened by `$.command.run` | Enter (server), Down Down Enter (Disable) | **M** server process exited, `◯ probe`. Then Enter, Enter (Enable): new pid, `✔ probe 1 tool`. Esc closed it and resolved the call `{}`. |
| `/rewind` picker opened by `$.command.run` | Up, Enter, Enter ("Restore conversation") | **M** `$.session.messages()` 28 → 20, rewound prompt put back in the input box, session id unchanged |
| `/add-dir` dialog | Enter ("Yes, for this session") | **M** `$.tool.check` Read in the dir → allow |
| `Switch model?` dialog | Enter | **M** model switched; the pending `$.command.run` resolved `{}` |
| Shift+Tab in the TUI | `BTab` | **M** footer cycled plan → auto → manual → accept edits → plan |
| Shift+Tab into a bg job via `claude attach` | `BTab` | **M** manual → accept edits; four presses back to manual |
| bg permission prompt via `claude attach` | Enter / `4` | **M** Enter approved (file created); `4` refused it (the turn was interrupted, file absent) |

## Method

**Isolation.** Each run had its own `/private/tmp/cmd-probe/run{1,2}`:
- a temporary `HOME` whose `.claude` is `CLAUDE_CONFIG_DIR`, onboarding and trust pre-set, and a git work dir;
- its own tmux server (`tmux -L cmdprobe-runN -f /dev/null`);
- the session started as `env -i bash -c '. <0600 env file>; exec 2.1.307 --plugin-dir <mod> --model haiku --permission-mode default'`.

The env file carried only `HOME`, `CLAUDE_CONFIG_DIR`, `PATH`/`TERM`/`LANG`/`USER`/`LOGNAME`/`SHELL`/`TMPDIR`, the gateway keys, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, `DISABLE_AUTOUPDATER=1` and the bus path. It was deleted at the end, and no remaining file holds the token (grepped).

The isolated settings set `daemonColdStart: "transient"`. The launchd label `com.anthropic.claude-daemon` is per user, not per config dir (cli:93334), so a service install from the isolated config would have taken the owner's slot. The isolated supervisor lived at `/tmp/cc-daemon-501/2c502e53` (sha256 of the isolated config path). When the run ended its jobs were killed, the supervisor got the `shutdown` op, and its directory was removed. Nothing of the owner's (sessions, `~/.claude/sminos/`, plugin cache) was touched. Their socket root was empty throughout.

**The mod.** `/private/tmp/cmd-probe/plugin/cmdprobe/hooks/register.ts`, loaded with `--plugin-dir`:
- A `$.clock.every(250)` timer started in `session.start` polls a file bus (`<run>/bus/<id>.req.json`). For each request it writes an ack, runs it without awaiting it in the timer, and writes `<id>.res.json` `{ok, value|error, t0, t1}`.
- Ops: `$.command.run`, `$.session.model/id/messages/cwd/root/usage`, `$.command.list`, `$.config.list`, `$.settings.read`, `$.tool.list`, `$.tool.check`, `$.mcp.call`.
- `turn.start`, `turn.complete` and `session.start`/`end` are logged to `bus/events/`.
- Two flag-gated hooks (`turn.start`, `tool.call` on Bash) try `$.command.run` from inside a hook.

**MCP server.** `/private/tmp/cmd-probe/mcp_probe_server.py` is a stdio JSON-RPC server with one tool (`ping`). It is configured as a user-scope server in the isolated `.claude.json` and logs `start`/`exit`/each method with its pid. Its state was checked through that log, `pgrep`, and `$.tool.list()`.

**Background path.**
- Jobs:
  - one came from `/background` (run by the mod);
  - one from `claude --bg --plugin-dir … 'Reply with just the word READY.'`.
- Ops sent to `control.sock`, as newline-delimited JSON with `proto: 1`: `list`, `subscribe`, `reply` (with `auth` from `daemon/control.key`), `kill`, `permission-response` and `shutdown`.
- The job's screen was read through `claude attach <short>` in a second tmux session. Keys sent to that session are what "PTY" means for a bg job.
- The mod loaded in the bg workers too, so `$.session.model()` and `$.session.id()` were read from inside the job.

**Model spend.** Haiku turns with one-line prompts, about 20 of them. A mid-turn `/model sonnet` made a few sonnet requests (about $0.015).

**Files.** In `/private/tmp/cmd-probe/`:
- the scripts (`harness.py`, the mod, the MCP server);
- raw bus traffic and events (`runN/bus/`);
- transcripts (`runN/home/.claude/projects/`);
- the command list (`run1-commands.json`, 92 commands).

The `$.command.run` calls made through the probe helper (34 of them), each with its result and the pane 1.5 s after and at settle, are in `pane-log.json`. The calls sent straight to the bus, the `reply` sends and the attach-pane reads were checked live and are not in that file.

**Not run** (all **I**):
- `/btw`, `/fork` and `/subtask` (model or agent spend).
- `/theme`, `/status`, `/hooks`, `/memory`, `/agents`, `/skills`, `/plugin` and `/tasks`. As `local-jsx` panels they should follow the `/usage` pattern.
- `/tui` (restarts), `/login`/`/logout`.
- `/copy`: not run because it writes the real clipboard.
- `/goal`, `/focus`, `/sandbox`.

## What contradicts the reading

1. **Panel commands resolve on close, not on open (M).** The promise stays pending while `/usage`, `/permissions`, `/config`, `/mcp` or the `/add-dir` and `/model` dialogs are up, and resolves `{}` when they close. Commands queued behind an open panel do not run until it closes. A desk that opens a panel through the mod cannot close it through the mod.
2. **"Text commands resolve to `{text}`" holds only for `type: "local"` commands (M).** Those are `/reload-plugins`, `/output-style`, and `/clear` (empty text). The one-line built-ins a desk cares most about are `local-jsx` and resolve `{}`: `/model`, `/effort`, `/mcp …`, `/plan`, `/add-dir`, `/export`, `/branch`, `/resume`, `/color`, `/autocompact`, `/compact`. `/rename`, `/cd` and `/context` resolve `{ context }`. The printed line exists only as a `<local-command-stdout>` row in the transcript. Errors are no different: `/model bogus` resolves `{}`.
3. **`/model <id>` does not reliably skip its panel (M).** With turns in the conversation, switching away from the model the cache is warm on opens "Switch model? … the full history gets re-read". Whether the cache's 5-minute TTL decides it was not isolated (**I**). Via `reply` mid-turn it never asks; via the mod it is queued until idle and then asks.
4. **`/add-dir <path>` always confirms (M).** It shows Yes for session / remember / No.
5. **`/rewind` resolves at once (M) while its picker stays open.** Its definition in 2.1.307 is `type: "local"` (**I** from code, cli:1052531 `zsr`), not a panel.
6. **A slash command does set a permission mode (M).** `/plan` and `/plan <description>` turn plan mode on. Leaving plan mode and reaching auto, manual or acceptEdits still takes Shift+Tab. `/config permissionMode=X` writes `permissions.defaultMode` only.
7. **Mid-turn, the mod path queues even `immediate` commands (M).** `/model` mid-turn waited for `turn.complete`. Only `reply` reaches the immediate runner.
8. **The held-hook refusal is narrower than "a hook the turn waits on" (M).** `turn.start` is not in the held set: called there, the command was accepted, queued, and ran after the turn. A `tool.call` hook is refused. **I**: the held set is `prompt.submit` plus `ULn` (cli:1098523: `classic.PreToolUse`, `tool.call`, `agent.spawn`, `session.send`, `prompt.section|context|attachment|mention|compose`, `tool.describe`, `command.run`, `command.describe`, `config.describe`, `config.set`) and other `classic.*` hooks.
9. **The Esc refusal (M) is set only by an Esc that stops a turn.** Typing, C-u and Shift+Tab don't clear it. Submitting input does, and so does a `control.sock` `reply`.
10. **`reply` text aimed at a non-question dialog is not dropped (M).** It is queued and later sent to the model as a prompt (`1`, `yes`). That goes beyond "cannot approve a permission prompt": a desk must not send keystroke-like text through `reply`.
11. **The supervisor's live record goes stale (M).** After `/rename` its `list` `name` keeps the old name, which `jobs/<short>/state.json` corrects. After `/clear` its `sessionId` stays the job's original id. Auto-naming of a `--bg` job did reach `list`.
12. **Not about slash commands, but it stalls a mod (M).** In default mode, `$.mcp.call` raised a permission dialog ("Tool use · from the cmdprobe plugin"), although the types say "No permission prompt".

What the reading got right (**M**):
- `$.command.run` queues and runs once idle, with origin plugin (the transcript tags it `› Prompt from the cmdprobe plugin`).
- `/mcp disable|enable|reconnect <server>`, `/rename [name]`, `/branch [name]`, `/effort <level>` and `/resume <id>` skip their panels.
- `/plan open|<description>` takes its forms.
- `/rewind` opens its picker.
- The `reply` immediate allowlist is `effort`, `model`, `rename`, `usage`; anything else is queued.
- The structured-question resolver answers AskUserQuestion.
- A reply cannot approve a permission prompt.
- `permission-response` is dead.
- `nextTurn` bypasses slash handling.

**Scripts kept.** `harness.py`, `mcp_probe_server.py` and the test plugin are copied into `cmd-probe/` beside this note; the raw runs stayed in `/private/tmp/cmd-probe/` and are not kept.
