# Lane B control map for the desk (MAWS #52)

**Short answer.** Write the desk contracts path-neutral, but do not make them aliases for SDK requests. Lane B can supply most of the planned effects, with adapters and per-operation capabilities. It has exact MCP state, native side questions, permission answers, task stopping, media input and native rewind. It does **not** have SDK `config.list` rows, a `compact` control request, or working `send_task_message` in either inspected build. A read-only mod can fill the config-row gap; an observe-only mod must not fill a missing mutation by becoming a second controller. **I**, [309 common handlers, including the message stub](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1129088), [310 same stub](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L293339), [mod config reader](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L716514), [compact's noninteractive command declaration](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L640391).

Scope update from the owner, 2026-10-25: **the desk writes no persistent defaults**. Config, default model/effort, autocompact and output style are read-only. The session model/effort control stays. `update_settings` is documented below only as an engine capability, not a proposed desk RPC. This does not remove the separately authorized, pending-ask-scoped permission rule destination `localSettings`.

## Proposed shared shapes

These are proposed **desk** names, not names to send unchanged to Claude Code. **I — recommendations from the implementation differences cited in the item sections below.** Keep the existing sealed RPC envelope, session binding, nonce and pending-request digest. Do not pass raw stdio or raw settings through the hub.

```ts
type Capability = { available: boolean; reason?: string };
// A missing entry means unavailable. Each key is independent.
type ControlCapabilities = Partial<Record<
  | 'read.usage' | 'read.config' | 'read.settings' | 'read.mcp'
  | 'btw' | 'compact' | 'model'
  | 'mcp.enable' | 'mcp.disable' | 'mcp.reconnect'
  | 'decide' | 'decide.scope' | 'decide.interrupt'
  | 'decide.addDirectory' | 'stop-agent' | 'tell'
  | 'media' | 'forget' | 'rewind-files' | 'elicitation.answer', Capability>>;

type SuggestionScope = {
  suggestion: number; sha256: string;
  destination: 'session' | 'localSettings';
};
type McpTarget = { all: true } | { name: string }; // omitted target means all
```

| Read / op | Proposed shared request and result fields | Which lane fills what |
|---|---|---|
| `read usage` | args `{breakdown?: 'summary'|'full'}`; default `summary`. Result `{startedAt?, context: {tokens?, window?, percent?, breakdown?}, cost?: {usd}, rateLimits?: [{kind, percentUsed?, resetsAt?}], rateLimitsAvailable?, sessionTotals?}`. Add `breakdownDetail: 'summary'|'full'`. | A keeps its `SessionUsage` fields. B projects `get_context_usage` and `get_usage`. `startedAt` is optional: those B controls do not supply A's original-launch timestamp. `sessionTotals` preserves B's extra accounting. Do not equate breakdown `totalTokens` with last-response input tokens or compaction window with raw model capacity. |
| `read config` | `{rows: [{key,label,description?,kind:'boolean'|'choice'|'text'|'number',value,options?,provider,isLocked}], readOnly:true}` | A uses `config.list`; B can use its read-only mod for the same rows. SDK-only B must advertise unavailable, not synthesize row kinds/options/locks from settings keys. `isLocked` describes engine policy, not the desk's read-only product policy. |
| `read settings` | Keep `{permissions:{allow,ask,deny,additionalDirectories,defaultMode,bySource},hooks:{[event]:[{matcher,commands}]}}`; add `permissionsExact:boolean`, `livePermissions?: {rules:[{behavior,source,rule,editability,notInEffect?}],workspaceDirectories:[{path,source}],managedOnly}` | A's settings-file projection is not a live session-rule snapshot: `permissionsExact:false`. B can add the native live view and set true. Source keys must be extensible; normalize `flagSettings` to existing `cliArg` spelling explicitly, not by dropping it. |
| `read mcp` | `{exact:boolean, servers:[{name,status:'connected'|'disabled'|'pending'|'failed'|'needs-auth'|'unknown',tools?:number,source?,scope?,transport?,serverInfo?,error?,errorCode?}]}` | A sets `exact:false`; B sets `exact:true` for the engine snapshot. `tools` is optional: not connected is not proof of zero known tools. Keep unknown/future statuses safely displayable. Never relay native `config` in this sanitized read. |
| `btw` | `{session,prompt,history?:[{question,response,fallbackNotice?}]}` → `{started:true,id}`; outcome `{id,text?:string|null,usage?,synthetic?,reason?,refusalFallback?}` | A has token `usage` and can fail `nothing-to-fork`. B has native history/retry progress, nullable answer, `synthetic` and refusal fallback; its control response omits token usage. Make those fields optional. |
| `compact` | `{session,instructions?}` → `{at:'now'|'turn-end',id?}`; separate outcome `{id?,state:'done'|'skipped'|'failed',reason?,tokensBefore?,tokensAfter?}` | A uses existing deferred compact machinery. B queues `/compact <instructions>` as user input. Neither acceptance nor a command's queue event proves compaction succeeded. |
| `model` | `{session,model?,effort?}` → `{model:string|null,effort:string|null,scope:'session'}` | A reports its main-loop override. B uses session-scoped controls and reports applied values. Keep the read-only default-model config row separate. B's engine setting affects more than A's per-request rewrite. |
| MCP mutation | `{session,action:'enable'|'disable'|'reconnect',target?:McpTarget}` → accepted/outcome `{results:[{name,ok,error?}],persistence:'project'|'session'|'none'|'unknown'}` | A adapts to slash grammar; B enumerates and sends one control per name. Omission/all is a desk grammar, not B's native request. Spaces stay inside `name`. Toggle persistence must be disclosed. This is the existing MCP operation's project effect, not a new config/default-writing RPC. |
| `decide` / scoped allow | `{session,digest,decision:'allow'|'deny',message?,scope?:SuggestionScope,interrupt?:boolean}` → existing empty acceptance; settle on request id | Both support rule updates and deny+interrupt. `scope` is allow-only; `interrupt` is deny-only. Do not add unrestricted `updatedPermissions` or arbitrary directories to the web contract. |
| Add directory | Same `decide.scope`, only when the selected pending suggestion is `addDirectories` | Both can carry that suggestion in the permission answer. No standalone local-path `add_directory` RPC is implied. `decide.addDirectory` is separate from arbitrary directory management. |
| `stop-agent` | Keep `{session,agentId:string}` (documented id **or name**, not description) → `{agentId,accepted:true,resolvedAgentId?}` | A may resolve the actual id before stopping. B's native success is `{}` and may be idempotent even for an absent id: echo the requested spelling, not a fabricated resolved id or proof that a live agent was killed. |
| `tell` | Keep `{session,agentId,text}` → `{sent:true}` only after delivery/queue acceptance | A uses `session.send`. B advertises `tell.available:false` in these builds. No successful native message result exists to normalize. |
| Media, wave 2 | `{session,text?,attachments:[{name,mediaType,data:string}],delivery:'queued-turn'}`; `data` is base64. Result `{queued:true,id?,intake:'native-message'|'native-read',paths?}` | B supplies image/document blocks directly. A's saved-file + synthetic Read route is a distinct intake, not native user-message media; it is **M** on 2.1.310 ([media-intake-spike.md](media-intake-spike.md)), and its result should also say when the media reached a request, since A acknowledges saved / Read completed / sent as separate states. Keep `intake` and per-lane capability visible; do not impose the old 1 MiB RPC ceiling as an engine media limit. |
| Forget, wave 2 | `{session,firstDiscardedMessageId,lastSeenUserMessageId?,interruptIfRunning?,allowSummarizedTarget?}` → `{applied:boolean,method:'native-rewind'|'prefix-compaction',targetMessageId?,prefillText?:string|null,precedingAssistantId?:string|null,resolution?:'after-summary',reason?}` | B uses native rewind **before** the target; A's candidate replacement compaction keeps a prefix. A cannot promise native cleanup, stable ids, or arbitrary empty-prefix support. **A's route is blocked on 2.1.310:** after `--resume`, kept assistant blocks are duplicated and excluded content can return ([truncation-spike.md](truncation-spike.md)), so A advertises `forget.available:false` with that reason. A genuine “keep this row, discard after it” UI must translate to a valid first discarded boundary. |

The old spec's `stop-agent` id/name regex excludes spaces. Do not copy that restriction into a general name field when the engine's resolver supports names; prefer canonical ids from the agent tree, and distinguish `agentId`'s historical name from its documented id-or-name semantics. Likewise a named MCP server `all` is unambiguous in `{name:'all'}` even though the slash grammar treats the string `all` as a wildcard. **I**, [stop resolver](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L498109), [MCP grammar](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1190858).

## Evidence and boundaries

**I** means read from code, or a recommendation/inference explicitly grounded in that code; nothing in this note was runtime-tested. No Claude session was launched. Below, `309:L…` means `/Users/new/claude-code-bundle/2.1.309/cli.pretty.js:L…`, and `310:L…` means `/Users/new/claude-code-bundle/2.1.310/cli.pretty.js:L…`. `mod-types:L…` means `/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt:L…`.

The MAWS sources were read through `git show origin/master`, resolving to `24eb6903ad43a1f0cd6ecd979f8d77f1f84e6b6f`. References to `MAWS@24eb6903:path:L…` below are that immutable tree, not the main checkout's branch. Relevant files are `docs/doperpowers/specs/2026-10-22-desk-control-surface-design.md` (Interfaces L1673 onward), `apps/desk-hub/src/protocol/rpc.ts` and `apps/desk-hub/src/protocol/browser.ts`. The existing RPC file has `decide`, `compact`, `model`, `stop` and `command`, not the proposed expanded wave-1 shapes. The spec's proposed reads and RPC additions are at L1717–1733 and L1866–1884. **I**, those files at that revision.

The bridge checkout is exactly doperpowers `8794692cbc1857dd5587442d565eae99bbf43c25`. Its advertised operations are still the existing set, not all of the extensions discussed here. **I**, [bridge.tsx:L247](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge.tsx#L247).

Important correction to the supplied locator: `309:L455431` is a **cloud-hosted-session routing policy**, not the local `-p` stream-json dispatcher. The latter is at L855088 onward; shared control implementation is L1128134 onward. A subtype appearing in a list is not proof of support: `send_task_message` is the counterexample. **I**, [cloud mapper](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L455431), [print dispatcher](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855088), [stub](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1129088).

Lane B here is a **local stdio child controlled by the machine's daemon**, not Anthropic Remote Control or a cloud-hosted agent. The holder design deliberately gives its bridge read/observation duties only. A public mod API being technically callable does not authorize a second controller. **I**, [holder design §3.3–3.5](session-holder-design.ko.md#L161), [stdio transport identifies itself as non-remote](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L458906).

### Wire convention and initialization

**I.** For host-originated operations, the wire is one JSON line:

```ts
{type:'control_request', request_id:string, request:{subtype:string, ...args}}
// Success: payload may be absent, not necessarily {}.
{type:'control_response', response:{subtype:'success',request_id:string,response?:Payload}}
{type:'control_response', response:{subtype:'error',request_id:string,error:string}}
```

`can_use_tool`, `elicitation` and `request_user_dialog` go the other way: the **engine** issues a control request, and the daemon answers its request id. They are not standalone host RPC subtypes to send at an arbitrary time. The print loop handles incoming controls during a running turn; individual operations below can still require idle, defer, or reject. **I**, [dispatcher](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855088), [shared response construction](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L438685), [Query's incoming-request handling](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L412525).

**I.** Initialize with the capabilities the daemon actually implements, notably `supportedDialogKinds:string[]` and `perTaskStopAffordance:true`. The latter is meaningful only with working individual task-stop UI: for open stdin it lets Interrupt spare background agents/workflows; absence fails closed and kills background work. Closing stdin still invokes one-shot cleanup. Dialog kinds are opt-in; do not advertise a kind without an answer UI. Reinitialize returns pending permission and dialog requests for reconciliation. These controls are not a promise that every native dialog is available. **I**, [initialize implementation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L857580), [current schema and stop-affordance semantics](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L913882).

## W1. Reads

### Usage: summary by default, full only on ask

**I. Native requests and payloads.** There are three different reads, not one SDK counterpart of `SessionUsage`:

```ts
{subtype:'get_context_usage', detail?:'summary'|'full'}
// -> ContextBreakdown, described below; omission defaults to FULL.
{subtype:'get_usage', skip_behaviors?:boolean}
// -> {session:{total_cost_usd,total_api_duration_ms,total_duration_ms,
//              total_lines_added,total_lines_removed,model_usage},
//     subscription_type:string|null,rate_limits_available:boolean,
//     rate_limits:object|null,behaviors:object|null}
{subtype:'get_session_cost'}
// -> {text:string} // formatted, ANSI-stripped cost report, not structured counters
```

`ContextBreakdown` contains `categories:[{id,name,tokens,color,kind,isDeferred?}]`, `totalTokens`, `maxTokens`, `rawMaxTokens`, `autocompactSource`, `percentage`, `gridRows`, `model`, `memoryFiles`, `mcpTools`, `agents`, `isAutoCompactEnabled`, `apiUsage` (last response or null), `messageBreakdown`, and optional `mcpInstructions`, `slashCommands`, `skills`, `autoCompactThreshold`. In this implementation `deferredBuiltinTools`, `systemTools` and `systemPromptSections` are explicitly undefined. `messageBreakdown` has tool-call/result, attachment, assistant/user, redirected and unattributed token totals plus `toolCallsByType` and `attachmentsByType`. **I**, [handlers](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1128134), [breakdown construction](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L681400), [return fields](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L681487), [structured usage](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1231425).

**I. Handling/gates.** All three are served by `-p`. Explicitly send `detail:'summary'`: the implementation defaults to `full`, whose counter uses the token-count API (with local fallback/caching; optional bulk-count feature flag `tengu_context_usage_bulk_counts`). Summary uses local estimates and last API usage. `get_usage` is a separate plan-usage/ledger read and can fetch subscription utilization; by default it also scans recent local transcripts for behavior analysis. Use `skip_behaviors:true` for the desk's ordinary summary, rather than accidentally scanning seven days of transcripts. No idle-only gate or initialize opt-in is imposed on these reads. **I**, [summary/full counter](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L681171), [default](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L681400), [scan opt-out schema](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L913882), [async scheduling](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855113).

**I. Difference and source recommendation.** Mod `session.usage({breakdown})` already returns the SDK breakdown shape, but wraps it in `{startedAt,context,rateLimits,cost}` and distinguishes the model window from the compaction window. SDK `get_usage` rate limits and A's last-response rate-limit readings are not identical freshness sources. Preserve null/missing readings. A B observe-only mod could supply the same read-only wrapper; recommend daemon SDK reads for B, and make `startedAt`, detailed accounting and rate-limit availability optional rather than inventing them. **I**, [mod usage contract](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L12335), [window distinction](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L11521).

### Config rows: read-only

**I. Native SDK gap.** No `config.list` control is dispatched. `get_settings` is a merged-settings/per-source read, not a row catalog and cannot supply row kind, choice options, plugin provider or managed lock. The exact row source is `$.config.list()`; it resolves the engine's config row handles and passes them through `config.describe` hooks. Row shape is `{key,label,description?,kind,value,options?,provider,isLocked}`; **there is no public row `lockReason` field**. Its private handle has a lock reason, but the public reader drops it. **I**, [mod row path](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L716514), [row projection](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L193860), [public ConfigRow](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L2027), [SDK settings handler](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L856793).

**I. Handling and recommendation.** The mod API resolves against a bound session, including a built headless session; it is not inherently TUI-only. Its read can run under B's observe-only policy. Recommend this one read-only mod supplement for exact `config.list` parity. Without it, set `read.config` unavailable; do not fabricate rows from `get_settings`. Keep every row read-only at the desk, including `model`. **I**, [headless binding check](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L640007), [row generation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L193894), [mod read](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L716540).

### Sanitized settings: permissions and hook shapes

**I. Native requests and payloads.**

```ts
{subtype:'get_settings'}
// -> {effective:Settings,sources:[{source,settings:Settings}],
//     remote_control_policy_lock_reason?,
//     applied:{model,effort:string|null,advisor:string|null,
//              ultracode,ultracodeRequested,ultracodeAvailable},errors?}
{subtype:'list_permission_rules'}
// -> {state:{rules:[{behavior,source,rule,description?,
//                   editability:'persistent'|'session'|'readonly',notInEffect?}],
//            workspaceDirectories:[{path,source}],originalCwd,managedOnly,errors?}}
{subtype:'get_hooks_listing'}
// -> {events:[{name,summary,supportsMatcher,hookCount}],hooks:[HookRow],
//     eventCatalog:[{name,summary,supportsMatcher}],policy,safeMode?,bareMode?,errors?}
```

`HookRow` includes `event`, `matcher`, `source`, `sourceLabel`, `type`, and **commandText**, display text and sometimes **editable.config**, plus optional plugin/condition/timeout/status/background/disabled metadata. `get_settings` returns raw settings including settings keys the desk must not export. No native request returns the desk's sanitized allowlist directly. **I**, [handlers](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L856793), [raw settings reader](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L228684), [permission state projection](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L389314), [hook rows and listing](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L395013).

**I. Handling/gates and differences.** Local stdio handles these reads while busy or idle; the print path refuses them on its redacting persisted lane (`Rp(e)`), which is not synonymous with local `-p`. B's permission listing is stronger than A's settings-file read: it sees live/session rules, extra working directories, source/editability and inactive rules under managed-only policy. `defaultMode` remains a settings default, not the current mode. For the shared old shape, parse native rule strings into `PermissionRuleValue` and explicitly normalize source names; optionally retain the richer `livePermissions` view. **I**, [read gates](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L856793), [live rules](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L389336).

**I. Recommendation / mod alternative.** Sanitize on the machine using an explicit allowlist: permission rules/directories/defaultMode and hook event/matcher/count only. Never forward `effective`, per-source raw settings, `env`, MCP configuration, hook command text or `editable`. B's read-only mod could do A's settings-file projection, but cannot turn that into the native live permission context. Prefer daemon SDK reads, native live rules and native hook listing, then the shared projection. **I**, [raw settings shape](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L228684), [unsafe-to-forward hook fields](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L395013), [A settings read limitation](mod-control-surface.md#L130).

### MCP: exact, not just inferred

**I. Native request.** `{subtype:'mcp_status',liveReply?:boolean}` → `{mcpServers:[{name,status,serverInfo?,error?,error_code?,config?,transport,sessionProxied?,urlHost?,scope?,source,tools?,capabilities?}]}`. Tools, when present, are an array of `{name,annotations:{readOnly?,destructive?,openWorld?},_meta?}` rather than a count. `cached` engine rows are deliberately projected as `pending`. The snapshot filters internal non-user-facing servers; exact means exact engine-reported state within that projection, not a network health probe. **I**, [status and projection](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1128134), [MCP fields](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1128161), [cached mapping](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L494968).

**I. Handling/gates.** Local stdio handles this without idle-only or initialization gating. Leave `liveReply` absent: it is for CCR clients that receive unsequenced live-only responses; stdio remains an ordinary control response. Source can include configurations with command/args or URLs/headers/OAuth fields. Strip that data even though exact status is wanted. **I**, [dispatch](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855113), [liveReply schema](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L913882), [config projection](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1128164).

**I. Recommendation / mod alternative.** Use SDK status for B, `exact:true`, retain `pending`, `failed`, `needs-auth`, error/source fields and optional tool counts. A, or B's read-only mod alone, can infer a partial tool/config view only; use `exact:false`, not invented connected/auth status. **I**, [mod MCP API ceiling](mod-control-surface.md#L175), [native status return](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1128186).

## W2. Operations

### Side question (`btw`)

**I. Native request and response.**

```ts
{subtype:'side_question',question:string,
 history?:[{question:string,response:string,fallback_notice?:string}]}
// -> {response:string|null,synthetic:boolean,
//     refusal_fallback?:{original_model,fallback_model,content}}
// Progress frame: {type:'system',subtype:'control_request_progress',
//   request_id,uuid,session_id,status:'started'|'api_retry',
//   attempt?,max_retries?,retry_delay_ms?,error_status?:number|null}
```

It runs asynchronously while the main turn continues, or idle. It can use the last request's cache-safe parameters **or build fallback parameters from the session**. No prior main request can yield `{response:null,synthetic:false}` if no parameters can be built; it is not A's fixed `nothing-to-fork` contract. It is tool-less, one response, no main-transcript write, and takes caller-supplied history without updating native terminal btw history (`threadHistory:false`). Cancellation/error are control errors; the print handler has a deadline and joins duplicate deliveries of the same in-flight request id. No initialize or feature-flag gate surrounds this branch. **I**, [print branch](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L856887), [parameter selection/response](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L138495), [one-response execution](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1113234), [Query helper](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L412853).

**I. Difference / recommendation.** `model.fork` has no native side-question prompt/history/progress contract and returns `{isAnswered,text?,reason?,usage?,status?,error?}`, including `nothing-to-fork`, `aborted`, `api-error`, `empty-reply`. B's helper discards `wRt`'s token usage when forming the control response. Therefore the proposed desk `btw` outcome must not require usage. Use `side_question` for B; although its mod could technically call `model.fork`, that spends tokens and is an active operation, not observation. **I**, [model.fork](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L723690), [native usage omitted](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L138503).

### Compact with instructions

**I. There is no `compact` control subtype.** Send an ordinary stream-json user message instead:

```ts
{type:'user',uuid?:string,session_id:string,parent_tool_use_id:null,
 message:{role:'user',content:'/compact '+instructions}}
```

The command is explicitly `supportsNonInteractive:true`, disabled by `DISABLE_COMPACT`, and trims its custom instructions. It uses the normal prompt queue; during a turn it waits for a safe command slot. Its outcome is streamed command output/compaction status/boundary events, not an immediate compact control payload. Hooks may skip it, and an empty conversation or failed summary can fail. **I**, [command declaration](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L640391), [instruction handling](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L568189), [status/outcome events](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L568221), [user queue](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L857393).

**I. Difference / recommendation.** A's `session.compact` rejects mid-turn and the bridge deliberately defers it, returning `at:'turn-end'`; it has a direct structured result. B's daemon should implement the same acceptance-plus-outcome facade around its native queued command, not invent `{subtype:'compact'}` and not treat command acceptance as success. Its mod could call `session.compact` technically but that would violate observation-only control ownership. **I**, [mod rejection](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L640437), [existing bridge compact](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge.tsx#L915).

### MCP enable / disable / reconnect

**I. Native requests.** `{subtype:'mcp_toggle',serverName:string,enabled:boolean}` and `{subtype:'mcp_reconnect',serverName:string}`. Success has no substantive payload (absent or empty), failure is a control error. These handle exact strings, including spaces; there is no native omitted target or wildcard expansion. A name of `all` is just a server name on this wire. Changes validate enterprise policy/approval and connection state. Ordinary stdio handles them, including during a turn; reconnection may take time, so do not infer completion from dispatch. **I**, [toggle/reconnect implementation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1128671), [success/error formation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1128734), [print dispatch](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855113).

**I. Grammar difference.** A's command parser consumes the whole remaining string as the target. Native enable/disable omit → `all`; native reconnect requires a nonempty target and recognizes explicit `all`. Thus “omitted reconnect means all” is a **new desk normalization**, not something already supplied by either native path. For B enumerate the SDK snapshot and issue one named request per server, preserving per-server failures and exact names. **I**, [parser](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1190858).

**I. Persistence / recommendation.** Toggle calls the same project toggle writer (`Xje` → `mat`) that maintains enabled/disabled server lists; it is not guaranteed session-only. Reconnect is a connection operation, not a default-model/config write. Keep the existing MCP persistence disclosure: retaining MCP enable/disable in this map does not turn it into a session-only setting. Prefer B's SDK controls; a mod slash invocation would be an active control, not allowed for B's observe-only mod. **I**, [toggle calls](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1128702), [disable](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1128756), [writer](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L721122).

### Session model/effort; persistent settings are not W2

**I. Session control.** `{subtype:'set_model',model?:string}` → `{model:string}` (error may additionally carry a code/current model). The implementation validates catalog/organization/entitlement/hooks and updates the active session. For session effort use `{subtype:'apply_flag_settings',settings:{effortLevel:string}}` → empty success. `apply_flag_settings` writes the session flag layer, not the persistent settings writer; it also accepts model settings, but keep native `set_model` validation for model switching. Neither operation is the default-model row. A's existing override rewrites main-loop `turn.step`; that is narrower than B's actual engine model/effort state. **I**, [model handler](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855295), [switch validation/application](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L435682), [flag application/effort](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L856659), [effort metadata](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L856762), [A override distinction](mod-control-surface.md#L131).

**I. Engine capability only — do not expose a desk write.**

```ts
{subtype:'update_settings',source:'localSettings',settings:{outputStyle:string}}
{subtype:'update_settings',source:'userSettings',settings:{effortLevel:string}}
// -> {} or control error
```

The exact allowlist is local `outputStyle` and user `effortLevel`. It rejects all other keys, non-string values, empty objects, deletion, disabled `--setting-sources`, and remote transports. Local stdio works. User effort saves the current model's default (the schema explicitly says max is not persisted), not the live level; use session flags for live effort. This is **not** arbitrary `config.set`, and cannot write the default model or autocompact row. The older 0.3.259 declaration, which allows only local outputStyle, is stale here. The observe-only mod should not write either. **I**, [allowlist and gate](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L852288), [writer branch](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L856818), [current schema](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L913882), [310 same allowlist](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L1035354).

## W3. Pending requests

### Permission answers, suggestions and scope

**I. Engine-originated request.** `can_use_tool` carries `tool_name`, `input`, `tool_use_id`, optional `agent_id`, `permission_suggestions:PermissionUpdate[]`, `blocked_path`, decision reason/type/code, MCP provenance, display metadata, `suppress_always_allow_rule`, `default_to_no`, `requires_user_interaction` and other ask metadata. The daemon must retain the **actual** pending request and bind its desk digest and suggestion hash to it. **I**, [request construction](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1191770), [Query callback options/requestId](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L412528).

**I. Response payload, inside the success control-response envelope.**

```ts
{behavior:'allow',updatedInput?:object,updatedPermissions?:PermissionUpdate[],
 toolUseID?:string,decisionClassification?:'user_temporary'|'user_permanent'|'user_reject'}
// or
{behavior:'deny',message:string,interrupt?:boolean,toolUseID?:string,
 decisionClassification?:'user_temporary'|'user_permanent'|'user_reject'}
```

The Query wrapper pins `toolUseID` from the request. At the desk boundary, validate the pending digest and selected suggestion hash again; permit `localSettings` only when that suggestion offered it, never by widening a session-only suggestion. SDK allow input is optional in current code; it need not be invented just to answer once. Suggestions use the same union as the mod: `addRules|replaceRules|removeRules` with `{rules:[{toolName,ruleContent?}],behavior,destination}`, `setMode` with `{mode,destination}`, and `addDirectories|removeDirectories` with `{directories,destination}`. The engine union admits `userSettings|projectSettings|localSettings|session|cliArg`. That is broader than the desk's measured/authorized `session|localSettings`: do not expose the other destinations merely because B accepts them. **I**, [current response parser](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1191515), [Query pins toolUseID](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L412532), [permission update union](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L7718).

**I. Handling/differences.** This works while a pending ask blocks a tool, not as an idle settings RPC. The SDK handler filters updates against the tool/policy and applies live context and persistence through native permission machinery. A successful answer is not proof every requested rule was adopted. Strict remote-execution permission handling differs from ordinary local launcher handling; the latter is the lane-B case here. Preserve request cancellation/racing settlements, never replay an old allow into a new ask. No supportedDialogKinds opt-in is required for ordinary `can_use_tool`; a `canUseTool` callback is required in Query (a missing callback errors). **I**, [permission update application](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1191525), [allow/strict handling](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1191550), [Query requirement](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L412528).

**I. Recommendation / mod alternative.** Use daemon-owned SDK answers for B. The mod could answer a classic PermissionRequest, but under B's observe-only policy it must pass through rather than race the daemon. A's current bridge is narrower than the public union and needs the planned scope extension; keep the shared suggestion index/hash/destination shape, not arbitrary permission patches. **I**, [classic hooks race SDK answer](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1191758), [bridge answer construction](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge-requests.tsx#L115), MAWS@24eb6903:control-surface spec:L1873–1884.

### Deny with message; deny-and-stop

**I.** Answer the pending `can_use_tool` with `{behavior:'deny',message,interrupt:true}` for deny-and-stop; omit `interrupt` for ordinary denial. The engine aborts the tool's turn controller when the flag is true. Do not translate this into a separately racing global Interrupt after settling the ask. SDK denial requires a message, unlike the optional message in the mod's classic-hook type, so fill an explicit default if the shared desk request omits one. **I**, [deny parser](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1191515), [abort](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1191573), [mod hook shape](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L26420). Same pending-only and observe-only rules as above.

### Adding a directory, only via a pending suggestion

**I.** Use a selected native `{type:'addDirectories',directories:string[],destination:'session'|'localSettings'}` suggestion in the pending allow's `updatedPermissions`. Keep the desk's “only a suggestion offered by this ask” restriction; B does not require loosening it. SDK and mod permission updates share that union. **I**, [union](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L7740), [native update application](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1191525).

**I. Do not use the similarly named control.** B also dispatches `{subtype:'add_directory',mount_path:string}` → `{staged_path,directory}` (or `{}` on the redacted lane), but this is **cloud file-store staging**, not “allow this local directory.” It requires `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` and staging credentials/session identity; it stages a mount, updates directory state and reloads memory/skills. `register_repo_root {directory,reload_claude_md?,reload_plugins?,reload_skills?}` is another narrower operation for a strict descendant of an existing root; it is not unrestricted add-dir approval. The observe-only mod must not apply either mutation. **I**, [add_directory implementation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L854963), [staging session requirement](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L101233), [register_repo_root schema](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L913882).

## W4. Agents

### Stop one subagent

**I. Native request.** `{subtype:'stop_task',task_id:string}` → `{}` or control error. It delegates to the normal task-stop service with `source:'client'`, not a shell-only stop. The resolver first checks an id, then resolves a named agent; ambiguity can error. This is not description matching. It can run mid-turn, including on foreground work; task type/ownership/lifecycle still matter. **I**, [control](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1129059), [id/name resolver](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L498109), [tool's documented spelling](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L498259).

**I. Important result difference.** The wrapper treats not-found and already-terminal tasks idempotently as success. Native source-driven stopping records `stoppedByUser` and a user stop count, persists agent-stop state, and has native cascade/cleanup behavior. The control drops the underlying resolved id/task-type result. Therefore success means the request was accepted/settled, not “a running agent of that id was found and killed.” Use the task tree and subsequent events for that stronger claim. `perTaskStopAffordance` changes the *global Interrupt's* behavior, not whether `stop_task` exists. **I**, [idempotence](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L498202), [stop bookkeeping](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L498240), [cascade](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L498163), [control return](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1129063).

**I. A difference / recommendation.** A's planned TaskStop bridge needs the explicit parent note saying the person stopped the agent and not to respawn/re-do it without a request; keep that requirement instead of assuming task termination communicates intent. This is documented in the desk spec, not a new observation made here. B's native client-stop bookkeeping is stronger, but is not proof a model will never choose to spawn a new agent. Use SDK stop for B, not an observe-only mod mutation. **I**, MAWS@24eb6903:docs/doperpowers/specs/2026-10-22-desk-control-surface-design.md:L864–876; [native stop state](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L498240).

### Send a message to one subagent

**I. Not supported by the named SDK control in these builds.** `send_task_message` is registered in the shared handler table, but its handler unconditionally throws `unsupported…send_task_message` in both 309 and 310. The scheduling predicate inspects `task_id`; it does **not** make the operation work. There is no successful request/message/response schema to promise from this code. In particular do not invent `{task_id,message}` → `{sent:true}` from the subtype's name. **I**, [309 stub and table](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1129088), [310 stub](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L293339).

**I. Alternative and boundary.** Public mod `$.session.send({to:{agentId},text})` has the desired behavior and returns `{isDelivered:true}` or `{isDelivered:false,reason}`; delivered means queued, not read, and a finished subagent can resume from its transcript. A should use it. B's in-session mod could technically use it, but **not while remaining observe-only**. Recommend `tell` unavailable on B until a native control is implemented or the owner approves a narrowly defined single-owner control extension. Injecting an instruction asking the parent model to send a message is not the same RPC. **I**, [send contract](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L12137), [queue result](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L12241), [observe-only design](session-holder-design.ko.md#L193).

## Wave 2

### Image / PDF intake

**I. Use user-message media, not a control subtype.** Local stream-json preserves array content into the queued prompt. A native input can be:

```ts
{type:'user',uuid?:string,session_id:string,parent_tool_use_id:null,
 message:{role:'user',content:[
   {type:'image',source:{type:'base64',media_type:'image/png',data:base64}},
   {type:'document',source:{type:'base64',media_type:'application/pdf',data:base64}},
   {type:'text',text:'Read these.'}
 ]}}
```

This is a queued turn, not a completed-input RPC response. During a turn it enters the engine's normal queue/intake policy; it cannot retroactively change an API request already sent. There is no media-specific initialize capability. Host admission/byte bounds and the model's media limits still apply. **I**, [local content preserved](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1139628), [intake/queued value](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L857393), [PDF block construction](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1055161), [image/document recognition](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L176615).

**I. Staging is not the local upload API.** `stage_file` is handled by the print loop, but its file-store mount operation requires cloud session identity (`CLAUDE_CODE_REMOTE_SESSION_ID` when not provided an explicit alternate staging context); synced-file paths have further runner-kind gates. Do not copy cloud `file_attachments`/mount protocols into a local stdio upload without their backend. For B, direct image/PDF content is the simpler route. **I**, [stage dispatch](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L856134), [staging gate](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L101233).

**I. A / mod difference.** A's submit/append APIs cannot directly attach these blocks; its saved-file + synthetic native Read composition is now measured on 2.1.310 and works ([media-intake-spike.md](media-intake-spike.md)). B's observe-only mod may observe intake, not synthesize a tool or submit a competing prompt. Do not force B through A's path instruction or synthetic Read workaround. **I**, [submit rejects attachments](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L640123), [append text-only contract](/Users/new/claude-code-bundle/2.1.309/modules/claude-code.d.ts-fef75c83.txt#L2949), [unmeasured synthetic-Read composition and its source references](mod-control-surface.md#L90).

### “Forget after this point”

**I. Native request.**

```ts
{subtype:'rewind_conversation',target_message_uuid:string,
 last_seen_user_message_uuid?:string,interrupt_if_running?:boolean,
 allow_summarized_target?:boolean,allow_assistant_target?:boolean,
 refuse_if_usage_limited?:boolean,
 refuse_missing_target_if_usage_limited?:boolean,expires_at?:string}
// success payload:
{rewound:true,targetMessageUuid:string,prefillText:string|null,
 precedingAssistantUuid:string|null,resolution?:'after_summary'}
// refusal is usually SUCCESS envelope with this payload, not a control error:
{rewound:false,prefillText:null,precedingAssistantUuid:null,
 error:string,reason:string,isolation_latch?:'web'|'connectors'|null,
 target_not_found?:true}
```

These are fields actually read/returned by the print handler, not copied from the older SDK declaration. The ordinary target is a user row; the cut is **before that target**, returning its draft text for prefill. `allow_assistant_target` only permits the engine's supported safe assistant boundary, not arbitrary transcript surgery. With `allow_summarized_target`, the engine may resolve against a summary anchor and reports `after_summary`, not an exact invisible old row. It checks stale/unseen later turns, split tool calls and delivered poll results. **I**, [print handler](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855654), [cut selection](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L851271), [refusal fields](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L851225).

**I. Handling/gates.** Local `-p` handles it; no initialize capability or general feature flag surrounds the branch. Busy/queued/pending-ask states can refuse. `interrupt_if_running:true` attempts to stop and settle the current work, but races can still yield `turn_running` or `state_changed`. The handler persists the anchor, revalidates, cleans up tasks/queued work/detached-call state and installs the shortened conversation; failure to persist is a refusal, not a cosmetic UI cut. Rewind is not secure erasure of external effects or on-disk history and does not by itself restore files. **I**, [running-turn handling](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855679), [persistence and cleanup](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855730), [native file rewind is separate](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855631).

**I. A / mod difference and recommendation.** A's candidate returns a retained nonempty prefix from `session.compact`. It creates a compaction boundary, remints ids and runs compaction effects; it does not run native rewind cleanup. Do not label both results simply `rewound:true`. Use `method:'native-rewind'|'prefix-compaction'`, make restoration/prefill fields optional and require capability before offering the A candidate. **M, 2026-10-25:** the A candidate is blocked on 2.1.310. Its active context is cut correctly, but resume's sibling recovery joins old and replacement rows that share an API `message.id`, which duplicates kept blocks and can restore excluded ones ([truncation-spike.md](truncation-spike.md)). Whether native `rewind_conversation` survives `--resume` cleanly was not measured; check it before B's `forget` ships. B should use SDK rewind; its observe-only mod should not perform replacement compaction. **I**, [replacement remints ids and removes old boundaries](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L663235), [replacement compaction side effects](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L682578), [native cleanup](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855741).

## Where B is strictly stronger — leave room in the web contracts

- **I. Native rewind and native file rollback are separate capabilities.** `{subtype:'rewind_files',user_message_id:string,dry_run?:boolean}` returns `{canRewind:boolean,error?,filesChanged?,insertions?,deletions?,skippedLinks?}`. Dry-run produces the preview; actual rollback commonly returns only `canRewind` plus optional skipped-link count. It requires file checkpointing and an existing checkpoint; SDK file checkpointing is enabled by `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING` (the SDK option sets that env), and can be disabled. No idle check surrounds the print branch, so the daemon should serialize against conflicting edits rather than assume native busy refusal. Do not couple `forget` and `rewind-files` into one all-or-nothing option. [Handler](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855631), [rollback/preview](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L857668), [checkpoint gate](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L658429), [SDK launch option](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L413458).
- **I. Elicitation answers.** Engine request `{subtype:'elicitation',mcp_server_name,message,mode?:'form'|'url',url?,elicitation_id?,requested_schema?,property_order?,title?,display_name?,description?}` accepts `{action:'accept'|'decline'|'cancel',content?:object}`. Query requires an `onElicitation` handler for a real answer (otherwise it declines; returning null stays silent). This is not restricted to the mod's limited dialog answer shape. [Producer](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L459990), [response schema](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L913882), [Query handler](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L412550).
- **I. General native user-dialog transport.** `{subtype:'request_user_dialog',dialog_kind,payload,tool_use_id?}` is engine-originated; answer payload is dialog-kind-specific. Declare only kinds the daemon/web can render via `initialize.supportedDialogKinds`, retain cancellation/deadline semantics, and do not answer an undeclared kind with “cancelled.” A's ceilings should not become a closed web dialog enum. [Producer](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L460001), [current opt-in/cancellation schema](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L913882), [Query stays silent without handler](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L412557).
- **I. Native media user turns, exact MCP errors/auth state and live permission rules.** Keep their optional richer fields instead of reducing B to path instructions, `unknown` MCP statuses and settings-file rules. [Media intake](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L857393), [MCP](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1128161), [rules](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L389336).
- **I. Native permission-mode transition and task controls.** B has a real `set_permission_mode {mode,...}` handler that validates modes/availability and performs engine transition bookkeeping; A's pending permission update is not general mode-switch parity. It also has `background_tasks {tool_use_id?}` and task output, in addition to stop. Their existence is not authorization to add them to wave 1, but the contract vocabulary should leave separate capabilities for them. [Mode setter](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855263), [background/output handlers](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1129066).
- **I. Native conversation fork is not `btw`.** `fork_conversation` is separately dispatched to the native session-fork implementation, with busy restrictions; neither A's `model.fork` nor B's `side_question` is a persistent conversation fork. Reserve a separate capability rather than overloading the side-question result with session ids. [Fork dispatch](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L855757), [model.fork implementation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L723690).

## Installed 2.1.310 check

**I. No lane-parity-changing difference was found in the inspected wave-1 handlers.** 310 retains the summary/full context split, structured usage, exact MCP projection, named toggles/reconnects, side-question branch, limited settings writer, native permission/rewind paths, and the **unsupported message stub**. Source order and obfuscated names changed substantially, so 309 line offsets cannot be reused for 310. This is a focused source comparison, not a whole-build equivalence claim. Evidence: [310 usage/MCP projection](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L292385), [task stop and message stub](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L293310), [settings allowlist](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L1035354), [native rewind handler](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L1038719), [native side question](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L1039960).

The most consequential corrections are therefore not a 309→310 feature addition: a named control can be a stub; compact is a noninteractive **command**, not a control request; `add_directory` is not local permission management; and a full context read is costly unless the daemon explicitly asks for summary. **I**, the respective sources above.
