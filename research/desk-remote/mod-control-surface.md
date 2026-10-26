# Mod-only remote control of an interactive Claude Code session

This inventory is for desk, MAWS #52. A terminal-started interactive `claude` process stays that process. Remote control goes through the bridge mod. There is no browser terminal, PTY key injection, or migration to `claude -p`.

The recommendation is to build typed web controls for the operations' effects rather than remotely opening terminal panels. The mod can already expose much more than the bridge exposes. It cannot, however, impersonate the person at every engine dialog.

## Evidence and scope

**M** means measured in the existing probes, on the version named. **I** means read from source or inferred from that source, not executed. No new runtime experiment or model request was made for this note. All new findings below are **I**, unless explicitly marked **M**.

“Public API” below means the typed, supported mod interface shipped in this build. It is a much safer dependency than internal bundle functions, not a promise of indefinite API stability.

Primary sources:

- [2.1.309 mod types](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt).
- [2.1.309 CLI reprint](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js).
- [2.1.307 mod types](/Users/new/claude-code-bundle/2.1.307/modules/claude-code.d.ts-2706c2b1.txt).
- [Prior parity inventory](rc-parity-research.ko.md#L275).
- [2.1.307 command measurements](mod-command-run-probe.md).
- [2.1.308 turn-fence measurements](reap-signal-spike.md).
- [Existing capability classification](session-holder-design.ko.md#L268).

The bridge source is [bridge.tsx](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge.tsx). At inspection, the repository was at `74e19630`; this file was byte-equal to `/Users/new/.claude/plugins/cache/doperpowers/sminos/1.8.1/hooks/mods/bridge.tsx`.

The main MAWS checkout was on `sminos-hub`, with no `apps` directory. Web/hub claims use the registered worktree `/private/tmp/maws-desk-deploy`, commit `5a4b93b4c`. Relevant files are [web command routing](/private/tmp/maws-desk-deploy/apps/desk-web/src/conversation/catalog.ts), [hub RPC contracts](/private/tmp/maws-desk-deploy/apps/desk-hub/src/protocol/rpc.ts), and [browser read contracts](/private/tmp/maws-desk-deploy/apps/desk-hub/src/protocol/browser.ts). These establish source capabilities, not the version running on any machine or at the public site.

## 1. What changed between 2.1.307 and 2.1.309

A full text diff of the two supplied declaration files found only these changes:

| Change | Meaning |
|---|---|
| `PromptFillArgs.cursor?: number` was added. | A remote draft editor can preserve or position the caret. It is an integer offset into the resulting whole draft, clamped and normalized around characters/chips. |
| `PromptFillInput.cursor?: number` was added. | A `prompt.fill` hook can propagate or change that requested caret position. |
| `PromptFilled.cursor` documentation changed. | It now describes the explicit cursor option as well as the default positions. |
| `TurnStepInput.model` documentation says aliases or full IDs are accepted. | This is a documentation clarification, not a new method or field. |

No public method, event, dialog-answer capability, permission-mode setter, MCP-status/auth operation, or rewind operation was added or removed in this diff. The new cursor fields are at [types L8952 onward](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L8952); the model clarification is at [L14365 onward](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L14365).

Several findings below correct the old capability inventory, but are not newly added APIs in 2.1.309. In particular, `config.set`, `model.fork`, replaceable compaction, and permission updates were already present in 2.1.307's types.

## 2. What the bridge and web expose today

The bridge advertises protocol 2 and these operations:

`ping`, `steer`, `interrupt`, `stop`, `model`, `compact`, `deliver`, `answer`, `read`, `command`.

Its implemented read kinds are only `status` and `catalog`. `status` returns version, model, cwd, root, repository remote with userinfo stripped, attached surfaces, and the bridge's model/effort override. `catalog` combines commands, model choices, environment aliases, and skill membership. It does not expose full settings, permissions, MCP status, or on-demand usage reads. The bridge does emit context/cost usage at main-turn completion.

Sources: [bridge operations](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge.tsx#L244), [reads](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge.tsx#L357), [catalog](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge-catalog.tsx), [turn-complete usage](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge.tsx#L1766).

The bridge already runs slash commands, contradicting the older parity note's “not yet exposed” statement. It checks a versioned route table and runs only enabled `run` and `run-prompt` routes. It serializes runs and reads back transcript output because many commands resolve without text. Panels, follow/session-identity operations, local-only operations, and dedicated-control routes are refused by `command`, even if their route entry says `enabled: true`.

The table is measured against 2.1.307. A newer engine selects the newest table at or below its version, so 2.1.309 currently inherits the 2.1.307 table; it is not independently measured on 2.1.309. See [route implementation](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge-commands.tsx) and [route table](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge-routes.tsx#L27).

Current enabled argument routes include rename, color, MCP enable/disable/reconnect, cd, goal, plan with a description, list-agents, reload commands, and various prompt commands. Clear, branch, resume, background and subtask have implementation-milestone holds. Bare plan is routed to a not-yet-built mode control. Config writes, autocompact and output-style writes are intentionally withheld because they persist defaults, not because the engine lacks an API.

The web's implemented dedicated widgets are model/effort and compact. Routes saying `read usage`, `read settings`, `btw`, or `fork` are plans, not implemented widgets. [web catalog L27–45](/private/tmp/maws-desk-deploy/apps/desk-web/src/conversation/catalog.ts#L27).

Permission answering is narrower than the public hook contract. The hub exposes allow/deny and question answers, not arbitrary `updatedPermissions` or general input edits. The bridge's `engineDecision` sends question answers or the original ExitPlanMode input, and otherwise a bare allow. It deliberately avoids general `updatedInput`: rewriting an ordinary ask can cause the engine to check it again and ask again. Sources: [hub RPCs](/private/tmp/maws-desk-deploy/apps/desk-hub/src/protocol/rpc.ts#L10), [engineDecision](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge-requests.tsx#L115).

The old “no local-answer notification” gap is also narrower now. The bridge uses `telemetry.log` collector `tool_decision` records to identify local versus hook decisions, with transcript/result fallbacks. This is implemented, but depends on the current engine's telemetry event contents rather than a dedicated public permission-settled API. [bridge request settlement](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge-requests.tsx#L23).

## 3. Operation inventory

In the tables, “Existing” describes the inspected bridge/web path. “Extend” means public mod pieces exist but the bridge lacks the operation. “Candidate” means the full composition needs measurement. “Closed” means no supported mod path to the exact operation was found.

### 3.1 Prompting, drafts, attachments and navigation

| Person's operation | Broadest mod path | Existing / limitation |
|---|---|---|
| Send a text prompt while idle | `$.prompt.submit({text, asUser:true})`. | Existing delivery machinery. The origin remains plugin-origin even with `asUser`; do not erase provenance. |
| Queue a new text turn while busy | The same `prompt.submit`; it queues until idle. | Existing delivery machinery is specialized. Expose explicit queued-turn intent separately from steer. Resolving the call is not turn completion. |
| Steer the current turn | `$.session.append({message:{type:'user',content:[{type:'text',text}]}})`. | Existing `steer`. A hidden user row is consumed by a later model request; it is not a typed prompt. |
| Send-now behavior | Append to steer, or abort then submit, according to an explicit UI action. | Partial. Neither is the exact TUI queue-drain operation. No public flush/reorder/cancel-queued-input API. |
| Inspect/edit the terminal draft | `$.prompt.read()` and `$.prompt.fill({text,mode,cursor})`. | Extend. Fill refuses while a dialog owns the composer. The read/fill pair is not an atomic compare-and-swap against local typing. |
| Newlines, editing, undo, stash, history search, external editor | Browser-native draft editor; optionally mirror committed draft text with `prompt.fill`. | Extend. There is no API for the TUI's undo stack, stash, history-search focus, editor lifecycle, or executing a history selection. |
| Suggestions/autocomplete | `prompt.suggest`; `prompt.autocomplete` hook; `command.list`; file lookup through filesystem/process APIs. | Command catalog exists. Suggestions are not submissions. No direct API to press Tab or take the engine's current completion. |
| `@file`, directory mentions, text attachments | Read/upload through controlled host file APIs and supply text or a path instruction. For deterministic native file reads, consider synthetic Read steps below. | Extend. **The old `@path` expansion hypothesis is false on 2.1.309.** Plugin-origin prompts default to `skipAttachments:'all'`. |
| Paste/upload image or PDF | No direct submit/append API. Candidate: save bytes safely, then synthesize a native Read tool step whose normal tool result carries the media. | Candidate, not shipped. A prompt saying “read this path” is a weaker model-mediated alternative. |
| Attach media while steering | No image block in `session.append`. A pending native Read step at the next `turn.step` is a candidate. | Candidate. It does not interrupt an already issued model request; permissions still apply. |
| Remove/select terminal attachment chips | No public attachment mutator. | Closed as a TUI operation. Browser-owned uploads can be managed before submission. |
| Voice/PTT and microphone selection | Browser capture/transcription can produce text; mod audio APIs play/speak, not capture the TUI microphone state. | Closed for native TUI voice controls. Reimplementation is a separate browser feature. |
| View/search/copy/export conversation | `session.messages`, `session.append` events, `turn.step` deltas; browser-native viewing and copying; `/export <path>` for native export. | Transcript viewing exists. `messages()` is capped at 4096 entries; a durable bridge transcript is needed for full history. |
| Scroll, expand transcript/tool groups, select text, clear terminal screen, diff navigation | Browser-native presentation. Mod `ui.scroll`, `ui.focus`, `ui.selection`, `ui.view` have ownership/person-input limits. | They are not general remote keyboard APIs. No need to mirror terminal viewport state. |
| Switch to a subagent's transcript | `agent.list` plus `session.messages({agentId})`; browser chooses its own view. | Extend. `ui.view` changes the terminal's active view only while answering person-origin input; a background RPC is not automatically such input. |

Attachment evidence: [types L9434](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L9434), [submit rejects attachments](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L640123), [plugin prompts skip attachment expansion](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L399411), [append media restrictions](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L11168).

The synthetic Read candidate is stronger than merely asking the model to read a path. A `turn.step` hook can yield a `tool` chunk, its `input` JSON chunks, and a `stop` with `stopReason:'tool_use'`, without calling `next`. The engine synthesizes a normal assistant tool call and runs it through the tool machinery. Returning a `toolUses` array alone does not run it: the streamed chunks are authoritative. This can insert one deterministic media-loading step before allowing the following model step. It must be visibly disclosed as a bridge-requested action, not attributed to a model choice. The API shape is public; this complete intake composition is unmeasured. Sources: [stream types](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L14330), [synthetic record construction](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L450635), [stream-to-tool conversion and no-request response](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L450947).

### 3.2 Interrupting, waiting, tools and background work

| Person's operation | Broadest mod path | Existing / limitation |
|---|---|---|
| Stop the main turn | `$.turn.abort({turnId})`. | Existing interrupt additionally stops Bash tasks moved to background. Abort alone is not complete Esc parity. |
| Stop a background shell/monitor | `$.tool.call({tool:'TaskStop',task_id})`. | Existing `stop`. Current bridge explicitly refuses IDs in `agent.list`; it does not expose general agent stopping. |
| Start background shell work | Native Bash tool call with its background option, or `process.spawn` for bridge-owned subprocesses. | Extend. These have different tracking and transcript semantics. |
| View background agent state | `agent.list`, spawn/turn events, `session.messages({agentId})`, tool results/notifications. | Partial. No single public API returns every engine task type. TaskList task records are not synonymous with the running background-task registry. |
| Start an agent/forked subagent | `agent.spawn` or the Agent tool through `tool.call`. | Extend. Spawning spends tokens and may be permission constrained. Agent lifecycle is not a separate persistent session fork. |
| Message/resume an agent | `session.send({to:{agentId},text})` through the engine's normal delivery. | Extend. Availability depends on the agent's lifecycle; not equivalent to arbitrary manipulation of its task record. |
| Ctrl+B background a foreground task | No general public “background this currently running task” operation. | Closed for exact transition; launch in background initially or use task-specific supported operations. |
| Kill all agents / task-panel actions | Enumerate available agents/tasks and invoke supported stops individually. | Partial; not a general TUI task-panel controller. |
| Schedule/loop/wakeup work | `tool.call` of available native scheduling tools; command/skill invocation when listed. | Extend. Discover the actual tool catalog; feature gates and notifications matter. |
| `!` shell command | `tool.call({tool:'Bash',command})`, or `process.run/spawn` with a shell explicitly named in argv. | Extend. Neither reproduces every `!`-mode transcript, cwd, auto-query, and safety behavior. Prefer native Bash for engine permission checks. A process API is host execution under mod authority, not human Bash mode. |
| Ask a side question (`/btw`) | `$.model.fork({prompt})` provides a tool-less completion over the main loop's last request. | Extend. Strong semantic substitute; no terminal panel or command queue. It is not native btw history/retry/panel state. It costs tokens and has `nothing-to-fork` before a first request or after clear. |
| Run the native `/btw <question>` | `command.run`. | Current bridge routes it away, with no widget yet. Native command can use a panel or a fullscreen/history path depending on mode; do not assume it is queue-free. |
| Pause before the next model request | Hold `turn.step`, or yield a disclosed refusal instead of `next`. | Candidate control. **M, 2.1.308:** this holds the request, including the `!`-origin case. `turn.start` does not. Failure before a request can fall through to the model. |
| Resume after human Esc stopped a turn | No supported mod operation to clear the plugin-input refusal latch. | Closed. Do not disable the latch or forge person-origin input. Human input or a new explicit Anthropic-authorized remote-input API is needed. |

`process.run` is argv-based, default timeout 30 seconds, maximum ten minutes; each stdout/stderr is bounded. `process.spawn` is tied to the stream/module lifetime and dies on unload. These are useful for file inspection and bridge-owned subprocesses, but not access to the parent engine's private objects. [types L3586](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L3586).

`model.fork` is not `/fork`: the former is one tool-less cached-context completion, the latter creates a separate session. [types L2670 onward](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L2670), [implementation L723690](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L723690).

### 3.3 Permissions, modes, model, effort and settings

| Person's operation | Broadest mod path | Existing / limitation |
|---|---|---|
| Approve/deny ordinary tool permission | `classic.PermissionRequest` returning `decision`. | Existing. Local and remote answers race. A stale remote answer must not authorize another call. |
| Deny with explanation or interrupt | `{behavior:'deny',message,interrupt:true}` in the hook. | Explanation exists; the bridge currently does not expose the full hook result shape. |
| Approve with edited tool input | `updatedInput` on an allow. | Public, not generally exposed. Revalidation can deny or reprompt; never report success from hook acceptance alone. |
| Approve and remember narrow rules | `updatedPermissions` with add/remove/replace rules and an explicit destination. | Extend. Current hub/bridge drops this capacity. Persisted rules affect future sessions. |
| Add/remove workspace directories | Permission update `addDirectories/removeDirectories`, destination `session` or a settings scope. | Extend/candidate. Avoid `/add-dir`'s confirmation panel. Validate paths and match native policy; check whether directory-added hooks and context refresh need additional handling. |
| AskUserQuestion choices, multiselect, Other | PermissionRequest allow with original questions and `answers`. | Existing, plus sminos ask integration. General dialog APIs are not needed for this specific tool. |
| Approve a plan | PermissionRequest allow carrying the original ExitPlanMode input. | Existing bridge special case. Bare allow is insufficient for this interaction-requiring tool. |
| Enter plan mode | `/plan`; alternatively native EnterPlanMode through `tool.call`. | **M, 2.1.307:** `/plan` sets the current mode. Bare form currently withheld by bridge routing; description form runs. EnterPlanMode has its own approval behavior. |
| Leave plan mode on demand | Candidate: invoke native ExitPlanMode through `tool.call`, present its actual plan/input remotely, answer through PermissionRequest. | Strong candidate. Source restores `prePlanMode`, checks auto availability and performs cleanup. It is plan approval, not a silent generic toggle; no plan and alternate plan-input variants need testing. |
| Set current default/manual, acceptEdits, dontAsk, plan, auto, bypassPermissions | PermissionRequest `updatedPermissions:[{type:'setMode',mode,destination:'session'}]`; when no ask exists, a narrowly scoped read-only ask carrier is a candidate. | Partial only. No standalone setter. See lifecycle caveat below. Bypass requires launch availability; do not evade it. |
| Set default mode for new sessions | `config.set({key:'permissionMode',value})` or `/config permissionMode=…`. | Public; bridge intentionally withholds persistence. **M:** this does not change the live session mode. |
| Read permission rules/settings | `settings.read({source})`, then construct a sanitized permissions view. `tool.check` answers a particular proposed call. | Extend. No full effective in-memory rule/mode/directory snapshot, including all session overrides. Never export raw settings: they include env/helper secrets. |
| Session-only main-loop model/effort | Rewrite `turn.step` input's model and effort. | Existing `model` operation. Does not change the engine's model setting, auxiliary requests, every spawned agent, or all model-dependent UI. |
| Change engine model and save default | `config.set({key:'model',value})`. | Public path, not currently exposed. Source updates app model and writes settings, without the `/model` warm-cache confirmation UI. Choice options/managed restrictions and usage-credit consent still apply. |
| Run native `/model <id>` without warm-cache confirmation | A scoped `classic.PreModelSwitch` allow sets `skipConfirm` for the model switch. | Candidate composed flow. Preserve managed denies/asks, bind to the exact remote choice, and account for self-reentry. Not a universal dialog answer; overage consent is separate. |
| Change persistent effort | `/effort <level>`; per-model configuration when available. | **M:** works and saves defaults. Bridge uses session-only override instead. Native effort picker may have cache-cost confirmation. |
| Fast/thinking/output style/autocompact/advisor/workflow settings | `config.list/set` for actual rows; argument-taking slash commands where supported; settings writes only where reload behavior is known. | Extend. Not all settings are rows, mutable, or session-local. `/fast` can have consent/eligibility behavior; bridge deliberately disables its route pending measurement. |
| View/edit settings panel | `config.list` provides row label, kind, current value, options, provider and lock; `config.set` invokes its writer. | Extend. This replaces most `/config` interaction without opening it. Some consent-gated and dialog-only rows refuse. |
| View/edit hooks, memory, skills, agents, plugins | Read appropriate project/user files with fs APIs; command catalog and context breakdown for listings; reload-skills/reload-plugins for supported refresh. | Partial. File edits reproduce configuration, not open panel state. `/agents` is removed in this build; edit definitions or register runtime agent types. |
| Session name, color, cwd | `/rename <name>`, `/color <color>`, `/cd <path>`. | Existing allowed routes. Rename/color persist transcript metadata; cd changes both cwd and session root. |
| Session-only settings overlay | `settings.read` hook can rewrite the merged settings that the engine reads. | Public extension, not shipped. No general “refresh this hook's answer now” API; take-effect timing follows settings/plugin reload. Not a reliable current-mode setter or a way to satisfy consent. |

The typed permission update union is at [L7689–7753](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L7689). The engine applies hook updates through [handleHookAllow](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1223420) and [OP/ju](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L88090).

A generic mode update is **not** proof of native mode-switch parity. Hook updates set `toolPermissionContext.mode` through `OP/ju`; the native remote setter `_T` validates availability and calls `QH` for transition bookkeeping. These are different paths. A mode label can change without proving correct auto-classifier activation, dangerous-rule stripping/restoration, or plan bookkeeping. Use native ExitPlanMode for leaving plan when its semantics fit, and request a proper mode API rather than claiming that a synthetic ask solves every mode. Sources: [native mode transition](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1227526), [ExitPlanMode](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L970690).

A read-only carrier, if explored, must be an explicit remote permission-management action: one nonce-bound, harmless call forced to ask by a narrowly matching `tool.check`, with only that call's PermissionRequest allowed to carry the updates. It must not manufacture a local human gesture, override policy, or silently approve an unrelated tool. The complete flow, rule filtering, and self-reentry are unmeasured.

`config.set(model)` evidence: [model row](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L193554), [writer](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L193216). The PreModelSwitch allow sets `skipConfirm` at [L709732](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L709732), consumed by the command at [L1057097](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1057097).

### 3.4 Slash commands, history and session changes

**M, 2.1.307:** `command.run` queues even commands whose typed form is immediate. A `local-jsx` panel generally holds the command promise and input queue until it closes. Its successful or failed result often is `{}`; text must be read from transcript command output. `/rewind` is exceptional: its call resolves while its picker remains open. See the [command probe](mod-command-run-probe.md#L20).

| Operation | Broadest mod path | Existing / limitation |
|---|---|---|
| List available commands and skills | `command.list`, context usage breakdown, command-description hooks. | Existing catalog. The live catalog is authoritative because availability is feature-, account-, plugin- and platform-dependent. |
| Run prompt commands/skills/MCP prompts | `command.run({command,args})`; Skill tool for appropriate prompt skills. | Existing guarded route. A skill can spend tokens or fork; command completion is not necessarily task completion. |
| Compact with instructions | `session.compact({instructions})` or `/compact <instructions>`. | Existing bridge compact supports instructions internally; inspected hub RPC/web widget does not expose them. |
| Clear | `/clear`. | **M:** changes session ID and emits session.end. Engine reachable; bridge follow support currently disabled. |
| Branch current conversation in the same process | `/branch [name]`. | **M:** changes session ID; emits session.end reason resume without a following session.start in the probe. Engine reachable; bridge disabled pending identity-follow logic. |
| Resume a known conversation | `/resume <id>`. | **M:** avoids picker. It changes this process's conversation, not another active process. Ownership must be checked. Bridge command route disabled. |
| Browse/select resume history | Browser lists stored sessions, then invoke known-ID resume. | Reproducible without opening native picker. File-format/version coupling and live ownership need care. |
| Fork into a separate background session | `/fork <directive>`. | Source creates a separate session and keeps parent, subject to persistence/launch restrictions. Bridge route points to a future control. This differs from `agent.spawn` and `model.fork`. |
| Rewind conversation to a selected message | No native selector API. Candidate: custom `session.compact` result retaining a selected prefix. | Partial substitute only; see below. |
| Rewind files, conversation+files, summarize from point, restore old draft/attachments | Native `/rewind` picker and engine rewind methods. | Closed for exact operation. No public checkpoint listing/restoration or rewind-state reconciliation API. |
| Export/copy | `/export <path>` or browser rendering; `ui.copy` affects a local supported surface. | Engine reachable; bridge labels these browser-local/future. Remote clipboard should use browser APIs, not the host clipboard. |
| Goal | `/goal <condition>` or `/goal clear`. | Existing allowed route. Bare goal is a panel; proposal approval is a separate dialog. |
| Background the whole session, exit, restart renderer/process | `/background`, `/exit`, `/restart`, `/tui …` as available. | Engine paths exist, but background changes process ownership and is excluded by the owner's keep-this-process decision. Exit may confirm live work and wait behind a panel. Restart is not transparent mod control. |

A compaction hook may return its own `messages` without `next`, so it can keep a chosen non-empty prefix and avoid summarizer inference. Engine handles preserve original message blocks during conversion. This is the strongest public candidate for “forget everything after here.” But replacement remints UUIDs, strips existing compact boundaries, creates a new boundary, clears read/memory state, and runs post-compact/session-start hooks. In fullscreen, earlier rows can remain visible outside active context. It does not run native rewind cleanup of tasks, queues, detached calls, fallback state, permission mode, or restored draft attachments. An empty prefix is invalid. Do not call it rewind or edit on-disk JSONL beneath a live session. Sources: [compaction contract](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L11327), [replacement and UUID handling](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L663175), [replacement side effects](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L682578), [TUI installation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L997555), [native rewind contrast](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L997400).

Self-reentry is an implementation constraint for all hook-assisted operations. A call made inside a registration can skip that registration while retaining other hooks; a detached call from the plugin's own code can skip that plugin's hooks for the event entirely. The bridge must measure the actual call origin of its transport loop before relying on its own PermissionRequest, PreModelSwitch, or session.compact hook to intercept a call it makes. A second in-process extension component with a distinct origin is a candidate if needed; it is not proof that today's single bridge module already works. [reentry selection](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L145286), [origin construction](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L716390).

### 3.5 MCP, files, context and accounting

| Operation | Broadest mod path | Existing / limitation |
|---|---|---|
| List active MCP tools | `tool.list()`; provenance on observed calls. | Partial catalog information. Names/tools do not reveal all servers, failed connections, auth state, or tool-less resource/prompt servers. |
| Enable/disable/reconnect MCP server | `/mcp enable|disable|reconnect <server>`; source also supports `all`, and enable/disable default to all when target is omitted. | Existing narrower route requires one non-space server argument. Broaden grammar carefully; names may contain spaces. |
| Connect a plugin-owned MCP server | `mcp.connect(server)` for a server in that plugin's manifest. | Extend. Not arbitrary connection to any configured server. |
| Invoke an MCP tool | `mcp.call(server,tool,args)` or `tool.call`. | Extend. **M, 2.1.307:** `mcp.call` raised a permission dialog despite documentation saying no prompt. Treat it as potentially blocking. |
| Inspect exact MCP connection/auth status | No public live-server snapshot API. Derive a partial view from config, tool inventory, and reconnect result. | Closed for exact parity. Do not label an inferred server status as authoritative. |
| OAuth authenticate, submit code, clear credentials | Native MCP panel/internal host control handlers; external OAuth helper plus native reconnect is a candidate. | No public mod API. Browser auth must remain an actual user-mediated flow; config/credential file edits are not a reliable equivalent. |
| MCP form/URL elicitation and waiting/retry | See dialog section. | Not currently bridged. Configured classic hooks can answer ordinary elicitation; typed mod answers cannot currently carry action/content. |
| MCP resource/prompt browsing | Listed MCP prompt commands and native resource tools when available; direct MCP call only addresses tools. | Partial. No general mod MCP resources/status transport. |
| Browse/read/upload/download files | `fs.read/list/stat/ancestors`, `process.run` for a bounded helper, tool calls when engine permissions are desired. | Extend. `fs.read/write` is bounded at 4 MiB; file APIs are mod authority, not automatically native tool-consent enforcement. |
| Working-tree diff | Bounded git process calls or existing daemon diff path. | Reproducible. Native diff pane focus/base/noise filters are UI state; implement browser equivalents. |
| Context window and category breakdown | `session.usage()`; `{breakdown:'summary'}` estimates locally; `'full'` uses token-count API. | Turn-complete summary exists; on-demand read is missing. Full counting is not a free local query. |
| Cost/rate limits | `session.usage`, `session.measure` events. | Existing cost/context only. Rate limits can be empty without a subscription/first reading; API/gateway limits need separate provider evidence. |
| Usage activity charts/day/week sorting | Session usage plus durable transcript aggregation or a separate account endpoint. | Not fully covered by `session.usage`; the `/usage` panel has more than the session counters. |
| Plan file, CLAUDE.md, memory and loaded skills | Filesystem reads and context breakdown's memory/skills information; `/plan` textual rendering where appropriate. | Extend. Keep storage backend differences and loaded-versus-on-disk content distinct. |

MCP argument handling: [L1190816–1190871](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1190816). MCP public surface: [types L2749](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L2749). Usage: [types L2879 onward](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L2879).

## 4. Complete native dialog-kind census

The 2.1.309 reprint contains **48 concrete `ds({kind:…})` dialog descriptors**. This is a census of the dialog broker's declared kinds, not a count of every screen. It includes 13 permission-renderer kinds and 35 other kinds. It is not interchangeable with the older SDK's “37 dialog kinds” count.

Many TUI panels and their nested confirmation/picker states are all `local_jsx`. Startup screens can also precede mod loading. There is no finite public mod dialog union containing every nested panel state.

Unless a row says otherwise, the existing bridge has no answer path for it.

### 4.1 Permission kinds

All of these have a permission-shaped result. `classic.PermissionRequest` is the public answer route **when the engine actually raises it and accepts hook answers**. A renderer kind alone does not prove hook answerability.

| Kind | Operation / mod reach |
|---|---|
| `permission_prompt` | Generic permission, including many MCP calls. Existing ordinary allow/deny path; person-only exceptions remain. |
| `permission_workflow` | Workflow script approval. Candidate ordinary hook route, subject to the workflow's required-person and input-validation rules. Not a generic script-panel controller. |
| `permission_ask_user_question` | Native questions. Existing updatedInput/answers path. |
| `permission_bash` | Shell approval, edited prefixes and suggested rules. Existing once/deny; rule/input extensions need bridge work. |
| `permission_browser` | Browser-related approval. Ordinary hook route where accepted; some browser/connector identities intentionally require the person. |
| `permission_enter_plan_mode` | EnterPlanMode approval. No promise that hook allow dismisses every interaction-requiring tool; verify this specific flow. |
| `permission_publish_plugin` | Publishing approval with its disclosure. Treat required-person/consent restrictions as closed unless this exact tool explicitly accepts a remote hook answer. |
| `permission_exit_plan_mode_v2` | Plan approval. Existing bridge carries original input; direct invocation is a useful spike. |
| `permission_file` | File read/edit/write/notebook permissions and diff display. Existing ordinary answer path; blocked outside reads/person-only checks differ. |
| `permission_monitor` | Monitor approval. Ordinary hook route; bridge already stops monitors through TaskStop. |
| `permission_powershell` | PowerShell approval. Ordinary hook route when available on the host. |
| `permission_skill` | Skill execution approval. Ordinary hook route, subject to source/author restrictions and rule filtering. |
| `permission_webfetch` | Fetch/domain approval. Ordinary hook route; persistent domain rules are not currently exposed. |

Descriptor locations: workflow [L221615](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L221615), generic [L835598](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L835598), specialized kinds [L1222791–1223197](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1222791).

The engine bypasses automated permission checks when `askIsPersonOnly` is true. Hook allows also have specific restrictions for interaction-requiring tools and certain MCP identities. Some reads outside the workspace do not take the ordinary hook path described by the older note. Background-agent checks have a limited early window before the local dialog; the current bridge uses three seconds. Sources: [person-only gate](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1222769), [hook allow checks](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1223420), [bridge background window](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge.tsx#L201).

### 4.2 Other concrete dialog kinds

| Kind | Meaning and broadest route |
|---|---|
| `it2_setup` | iTerm/tmux setup. No mod answer; local setup. |
| `mcp_url_elicitation` | MCP URL elicitation. Ordinary classic elicitation hooks may help; typed mod answer gap below. |
| `device_mcp_consent` | Share this device's MCP servers. Consent-only; no supported mod answer. |
| `unattended_serving_consent` | Allow unattended cloud-origin commands on this machine. Consent-only; no supported mod answer. |
| `mcp_elicitation` | Form or URL elicitation. Inputs can be observed; action/content cannot be returned through the current typed mod result codec. |
| `mcp_elicitation_waiting` | URL completion wait, dismiss/retry/cancel. No public mod resolver. |
| `chrome_install_upsell` | Browser extension installation choice. No mod resolver; separately perform explicit user-led setup. |
| `chrome_install_setup` | Installation/connection progress with continue/wait/skip. No mod resolver. |
| `computer_use_approval` | Application/access grants and denials. Not an ordinary PermissionRequest substitute; closed. |
| `local_jsx` | Slash panels and nested dialogs. Public commands can open these but cannot navigate or close arbitrary instances. Reproduce effects instead. |
| `auto_mode_server_fallback` | Classifier billing/fallback acknowledgment. No public mod answer. |
| `fable_overage_consent_prompt` | Usage-credit/overage consent, switch default, cancel. No mod consent path. |
| `ultraplan_choice` | Continue here or fresh with a plan. No generic mod resolver; mode/branch effects are separate operations. |
| `ultraplan_launch` | Approve launch/terms or cancel. No public mod resolver. |
| `refusal_fallback_prompt` | Retry on fallback model or edit prompt. No mod dialog answer; model overrides do not settle this pending choice. |
| `remote_callout` | Enable native Remote Control or dismiss. Not needed for desk; no generic mod dismissal. |
| `cold_resume_quota` | Resume, new conversation, dismiss after a cold-context quota warning. Resume/clear are separately reachable, not an answer to the open dialog. |
| `ide_onboarding` | IDE installation/onboarding. No mod resolver. |
| `left_arrow_confirm` | Leave view/session with running/retained work. No mod resolver. |
| `lsp_recommendation` | Install/reject/disable a recommended LSP plugin. Plugin configuration can reproduce some effects, not resolve the prompt. |
| `plugin_hint` | Install/reject/disable suggested plugin. Same distinction. |
| `auto_default_nudge` | Accept or decline auto mode as a default. No mod resolver; a default-setting write is not consent parity. |
| `effort_medium_nudge` | Accept/decline effort recommendation. Effort can be changed separately; dialog remains unanswerable. |
| `fullscreen_upsell` | Accept/dismiss fullscreen renderer offer. Renderer preference is a separate setting/restart. |
| `managed_settings_security` | Approve/reject security-sensitive managed-settings change. Intentionally not forgeable through a mod. |
| `sandbox_network_access` | Allow a host/port once or persist a rule. No general mod resolver. Authoring a permitted network rule for a future request is not answering the current ask. |
| `resume_return` | Compact, continue, dismiss, never on return. Compact is reachable independently; open prompt resolution is not. |
| `newer_model_offer` | Resume on newer model, keep, dismiss. Model controls reproduce the choice's effect, not the pending callback. |
| `peer_inbound_approval` | Approve/deny incoming peer message. `session.send` does not grant approval on behalf of the receiver. |
| `autocompact_offer` | Accept/keep threshold with stepper state. Threshold setting is reachable; callback is not. |
| `auto_mode_setup_review` | Review proposed classifier environment/rules. Files can be edited explicitly; no public acceptance callback. |
| `auto_mode_flagged_allow` | Select dangerous allow rules to remove. Rule updates reproduce removal; not dialog completion. |
| `cost_threshold` | Acknowledge session cost warning. No public resolver. |
| `goal_proposal` | Approve/decline model-proposed goal. Explicit `/goal` is separate; cannot fabricate approval of the pending proposal. |
| `auto_mode_outside_reads` | Allow outside reads, block them, or ask again. This is not just the generic file-permission card. No public mod resolver. |

Descriptor anchors: [L540](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L540), [L99399](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L99399), [L309970–310018](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L309970), [L340034](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L340034), [L503497](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L503497), [L529805](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L529805), [L561775](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L561775), [L655607](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L655607), [L665295](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L665295), [L668119–668192](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L668119), [L799106](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L799106), [L969818](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L969818), [L987149–987387](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L987149), [L990547–991097](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L990547), [L995293–996115](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L995293), [L1017829](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1017829), [L1024507–1025067](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1024507), [L1142105](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1142105), [L1223045](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1223045).

`enum_prompt` is additionally named in the host protocol and treated specially by SDK-host dialog routing. This build does not define a concrete `ds` TUI descriptor for it. It is not a hidden general-purpose mod dialog API. [constant L161864](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L161864), [host-only treatment L436289](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L436289).

### 4.3 The elicitation mismatch

`classic.Elicitation` and `classic.ElicitationResult` inputs are declared. Their descriptions say hooks may answer or override. But `ClassicResultFields` includes neither event, and `ClassicResult` has no elicitation `action` or `content`. The runtime mod conversion also does not carry elicitation responses: `rkt`, `Xeo` and `wkt` translate other result fields only.

By contrast, the configured classic-hook executor parses JSON `hookSpecificOutput:{hookEventName:'Elicitation',action,content}` and its ElicitationResult equivalent. Thus a plugin-owned classic command hook using the bridge transport can potentially solve ordinary MCP elicitation without a terminal, but it is an additional process/hook lane, not pure in-process mod answering. Do not cast an object to `any` and assume the fields will reach the server.

Some built-in-plugin server identities are stricter still: a hook's accept does not count as the person's accept; the question goes to the person, and result hooks can at most tighten the answer. This is an intentional boundary, not a missing JSON field to work around.

Sources: [input types L4003](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L4003), [result fields L1311–1425](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L1311), [mod codec L616017–616130](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L616017), [configured-hook parser L712904](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L712904), [person-only elicitation L337240](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L337240).

### 4.4 Panels, pickers and bootstrap screens beyond distinct kind names

The `local_jsx` loader table is the complete concrete handler-family checklist in this build. It includes:

- Workspace/context: `add-dir`, `cd`, `context`, `diff`, `memory`, `plan`, `skills`, `skill-doctor`, `import`, `export`, `copy`.
- Settings/control: `advisor`, `auto-mode-setup`, `autocompact`, `config`, `effort`, `fast`, `goal`, `hooks`, `model`, `output-style`, `permissions`, `sandbox`, `status`, `usage`, `privacy-settings`, `scroll-speed`, `vim`, `wellbeing`.
- Sessions/work: `background`, `daemon`, `exit`, `fork`, `loops`, `resume`, `session`, `stop`, `tasks`, `workflows`.
- Plugins/integrations: `artifacts`, `chrome`, `cloud-plugins`, `design-login`, `desktop`, `ide`, `install-github-app`, `plugin`, `remote-control`, `remote-env`, `teleport`, `terminal-setup`, `web-setup`.
- Remote/model work: `autofix-pr`, `ultrareview`.
- Account/help/commercial: `btw`, `bug`, `feedback`, `extra-usage`, `help`, `limit-reset`, `login`, `logout`, `mobile`, `passes`, `powerup`, `pro-trial-expired`, `rate-limit-options`, `release-notes`, `setup-bedrock`, `setup-vertex`, `theme`, `tui`, `upgrade`, `usage-credits`.

Presence in the loader is not a claim that a command is enabled for every session. Source: [local-jsx table L987022](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L987022).

Important nested states include the model/effort picker and warm-cache confirmation; add-directory path entry/session-or-persistent confirmation; MCP server list, server menu, tool list/detail, agent-only server menu, authentication/browser/code flow and reconnect progress; permission allow/ask/deny/workspace tabs; settings choices/search/usage period/retry; plugin marketplace/install/toggle/favorite; task selection/output/stop; resume selection; plan display/external edit; export file/clipboard choice; exit-with-background-work confirmation. These are not additional public answerable kind names.

`/rewind` is a separate local command with no target argument; it opens the message selector. The selector then offers conversation/file restoration and related actions. Its lack of a `local-jsx` promise does not give the mod access to selection callbacks.

Startup/account/environment trust prompts include onboarding/theme/terminal setup, sign-in/API-key/provider setup, workspace trust, external instruction-file trust, and unsafe-mode/security acknowledgments. Some occur before mods are available. Configuring already-authorized defaults can prevent some future prompts, but an untrusted session cannot use its unloaded mod to approve its own trust. Do not write approval/consent flags merely to suppress these screens.

The keyboard action registry also covers transcript/selection navigation, history search and scope switching, queue/send-now, draft undo/stash/external editor, mode/proactivity/effort controls, foreground-task backgrounding, diff sources/files/base/noise, plugin actions, pane focus/size/scroll, feedback ratings, voice PTT, agent grouping/pinning/rename, and terminal renderer/tab actions. There is no public “dispatch this native keybinding action” method. A mod Button's `action` binds a physical shortcut for that button; it does not invoke the engine action. [keyboard actions L474699–474753](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L474699).

Other non-panel commands in the command definitions include `clear`, `color`, `pause-memory`, `init`, `keybindings`, `design-consent`, `design-revoke`, `install-slack-app`, `voice`, `rename`, `team-onboarding`, `security-review`, `branch`, `subtask`, removed `agents`, `reload-plugins`, `reload-skills`, `rewind`/`checkpoint`/`undo`, hidden `heapdump`, `version`, `stickers`, `radio`, `schedule`, `restart`, `statusline`, `focus`, and internal remote-workflow commands. Use the live command catalog and an explicit reviewed route per form, not this source list as an allowlist. Definitions are concentrated at [L666797 onward](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L666797) and [L677644 onward](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L677644).

## 5. Which old “none” entries can shrink

| Old gap | Revised conclusion |
|---|---|
| `/usage` | Remove from blanket none. Session context, cost and rate limits have typed APIs. Account/activity-panel parity remains partial. |
| `/config` | Remove from blanket none. `config.list/set` covers most rows. Consent-only/dialog-only rows remain closed. |
| `/permissions` | Partial web equivalent is possible. Read sanitized settings; add/remove rules/directories through permission updates. No complete effective-state snapshot or free-standing mutation API. |
| Bare `/mcp` | Split it: toggles/reconnect and tool inventory are reachable; exact live state, OAuth, pending approval and elicitation remain partial/closed. |
| Leaving plan mode | Not intrinsically PTY-only. Native ExitPlanMode plus its supported hook answer is the strongest candidate. Generic mode switching remains incomplete. |
| Model-switch dialog | The effect has alternative public paths: config model writer or scoped PreModelSwitch allow. This does not generalize to other dialogs. |
| Rewind selection | Native rewind remains closed. A distinctly labeled context-truncation operation is plausible through replaceable compaction, with materially different semantics. |
| `/btw` | A native web side-question feature can use `model.fork`; it need not open the terminal command. |
| Fork/branch | The old impossible classification is too broad. Argument commands reach branch/resume and source reaches separate-session fork; bridge identity/ownership support is the remaining implementation work. |
| Attachments | The old @path expansion proposal is closed. Synthetic Read intake is a new, unmeasured alternative, not attachment API parity. |
| General dialogs | Still closed. Public UI hooks are not a generic dialog observation/resolution layer. |

## 6. Remaining gaps and ranked closure paths

### A. Arbitrary engine dialog observation, answer and dismissal

1. Request a public `dialog.list/subscribe/respond/cancel` API with IDs, typed payload/result schemas, revisions, cancellation and first-wins settlement, plus explicit capability restrictions for consent-only dialogs.
2. Meanwhile, use operation-specific public APIs instead of opening panels. This avoids a dialog; it does not settle one already open.
3. For ordinary MCP elicitation only, evaluate a bridge-owned classic configured hook if the owner accepts that extra lane. Otherwise request action/content support in mod classic results.
4. Do not depend on private dialog brokers, React callbacks, or native RC request handlers. No reachable public handle to them was found.

The mod runtime restricts imports to `claude-code` and its own relative files and confines those files to the plugin directory. It is not arbitrary JavaScript in the main engine module graph. `engine.create` adds plugin-defined interfaces; it does not expose the app store or dialog coordinator. [import restrictions L536835](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L536835). `ui.close` closes plugin panes, not engine dialogs; permission dialogs are explicitly engine-owned. [render contract L9830](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L9830).

### B. Permission-mode changes with full native semantics

1. Use native `/plan` to enter, and test native ExitPlanMode for approved exit.
2. Test nonce-bound permission-update carriers for ordinary rule/directory changes and simple modes. Do not ship auto/plan transitions merely because `.mode` changed.
3. Request `session.permissions.get/update/setMode` backed by the same native validation and transition routine, with policy restrictions and actual resulting state.
4. Persisted defaultMode or settings hooks are not equivalent. Directly altering private consent/availability flags is not an acceptable closure.

### C. Native rewind, file rollback and exact branch-at-point

1. Request checkpoint listing, preview/dry-run, restore-conversation/files/both, and atomic stale-boundary validation through the engine's existing rewind implementation.
2. Offer a separately named, constrained context-truncation feature only after the compaction spike establishes its semantics. Fence live work, require a valid selected prefix, and disclose retained filesystem effects.
3. A custom file-backup/restore feature is possible through fs/process APIs but is a new feature, not native file-history parity; it must reproduce path/symlink and partial-failure protections.
4. Editing live transcript files does not update in-memory state and can corrupt history. Binary patches/internal imports are not a supported solution.

### D. Exact MCP status, auth and pending approval

1. Request public MCP list/status/reconnect/toggle/auth-start/auth-complete/clear-auth methods and lifecycle events using the live engine connections.
2. Expose current public command toggles and a clearly labeled partial inventory now.
3. A separate OAuth/config helper followed by native reconnect is a candidate only for configurations whose storage/refresh behavior is understood. It must retain user consent and never export credentials.
4. Reading files alone cannot establish the current connection state or complete a pending in-memory auth dialog.

### E. Media submission and richer steering

1. Request a typed attachment-submission API supporting uploaded file handles/bytes, explicit provenance, size limits and mid-turn delivery semantics.
2. Spike synthetic native Read steps for files/images/PDFs. This uses public stream/tool pieces but changes transcript shape and consumes a tool step.
3. Use text/path instructions as an explicit weaker alternative when deterministic intake is unnecessary.
4. `asUser`, `prompt.fill`, `prompt.media`, or `session.append` cannot be used to smuggle new media or change origin. `prompt.media` is managed-mod-only reading of an in-flight attachment, not upload.

### F. Queue, task and lifecycle controls

1. Request structured queued-input list/cancel/reorder/flush; full background-task list/stop/background; current mode/state and dialog state.
2. Extend the bridge's existing task events and supported TaskStop operations, with task-kind-specific behavior.
3. Keep browser drafts separate from already-entered engine queue records. No delete API exists for those records.
4. A running process can be exited through native commands, but background migration/restart is not an answer to the owner's keep-this-process requirement.

### G. Human-only consent and the Esc latch

These are intentionally closed through current mod authority. Request a separately authorized remote-human consent channel from Anthropic, not an unprivileged mod impersonating a local gesture. The feature should preserve policy ceilings, exact disclosures, current request identity, and local-first cancellation. Raw configuration changes, fabricated UI events, or disabling the Esc input-refusal feature are not substitutes.

## 7. Highest-value spikes

**Results, 2026-10-25, on 2.1.310:**

- **Item 3, media intake: works.** See [media-intake-spike.md](media-intake-spike.md).
- **Item 2, context truncation: blocked.** The active context is cut correctly, but `--resume` duplicates kept assistant blocks and can bring excluded content back. See [truncation-spike.md](truncation-spike.md).
- **Lane B's control requests** for the same operations are mapped in [lane-b-control-map.md](lane-b-control-map.md).

All spikes should use owned isolated sessions and storage, never the owner's live sessions or daemon. No spike was run here. Use a fake/closed model endpoint for no-inference checks where possible; obtain a separate small spend allowance when a real model response is necessary.

1. **Plan exit and mode update transaction.** Invoke ExitPlanMode from the real bridge transport context; observe whether its PermissionRequest hook runs, approve original input, and inspect resulting mode, prePlanMode, auto activation/rule restoration and next tool behavior. Separately test a harmless read-only carrier for rules/directories and simple mode updates. Measure reentry, stale answers, local cancellation, policy ceilings, and auto/bypass rejection. Success is native behavioral equivalence, not a changed footer label.
2. **Context truncation through compaction.** Replace with a selected original-message prefix without calling the summarizer. Inspect UUIDs, active API context, visible transcript, persisted/resumed context, original media/thinking preservation, task/queue side effects and hook execution. Test empty/first-message bounds and local typing races. Decide whether a clearly named truncation feature is useful despite not being rewind.
3. **Deterministic media intake.** Queue one synthetic Read tool step for an uploaded image and a PDF, then inspect the next outbound request without spending inference. Confirm media blocks, tool permissions, provenance, reentry, duplicate prevention, mid-turn timing and local Esc behavior. Returning a result object without streamed chunks should be a negative control.
4. **Model writer and confirmation route.** Compare `config.set(model)`, `/model` plus a scoped PreModelSwitch allow, and existing `turn.step` overrides after a warm conversation. Measure persistent-default changes, hook policy, auxiliary/subagent model behavior, cache confirmation, consent prompts and concurrent local model selection.
5. **Elicitation contract.** Use a trivial local MCP form/URL server. Compare mod-returned action/content against a configured classic command hook, including decline/cancel, timeout, result override and URL waiting. Confirm that person-only server identities still require real user consent. This settles whether the strict mod-only architecture must wait for an API addition.
6. **Panel-free settings, usage and MCP reads.** Build only a probe RPC over the typed APIs, not a production UI. Verify config rows and locks, safe redaction, setting reload timing, usage summary versus full-count cost, rate-limit availability, server names with spaces, all-server toggle grammar, and the absence of an authoritative MCP status read. This validates the largest low-risk expansion of the bridge.

The first implementation wave should expose sanitized config/usage reads, supported config writes with persistence disclosed, structured permission suggestions, side questions through `model.fork`, and the already-reachable session/command effects after ownership-follow support. The spikes should decide plan-mode controls, context truncation and media intake. General dialog and consent parity should be an explicit upstream API request, not an undocumented-internals promise.
