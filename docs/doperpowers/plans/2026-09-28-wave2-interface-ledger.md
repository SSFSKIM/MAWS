# Wave-2 interface ledger

Reconciliation of the shared surface across the five wave-2 execution documents of `docs/charter.md` (children C3, C4, C5, C6, C9; parent pin `87f8c7881119ea670901205dae35917d3751459c`), written 2026-09-28 by the coordinator after the five were authored in parallel. The canonical shared types remain the Interfaces section of `docs/doperpowers/plans/2026-09-28-c1-foundations.md` (X1 graph, X2 registry composed from `src/shared/ipc/schema/*.ts`, host protocol) until C1's code lands; C1's document was not edited. Each of the five documents was edited minimally to agree with this ledger and carries a dated Decision Log line pointing here.

Architect rulings applied (decided, not re-litigated): (1) `attention.*` is main's, implemented by C3's attention service in main, broker items arrive from the engine host as an internal event, persistence through an `AttentionStore` port C4's index implements, the key is `appSessionId` everywhere; (2) `session.events` snapshot with `lastSeq`, `session.eventBatch` stream; (3) `session.rewindFiles`; (4) `layout.openTab` is a renderer store action, `layout.openExternal` a main command; (5) C6 deduplicates by event `id`, never by `seq`; (6) additive X1/X3/X7 changes accepted, each child adds its own names in its own file and renames nothing; (7) shared files carry delimited blocks and merge to master in the order C3, C4, C5, C6, C9, a later child rebasing over the earlier block; (8) C5's asks of C4 settled under C4's `session.projects.*` names plus the minimal additions below; (9) C9's PTY-host milestone states the migration of C1's `pty.*` entries and smoke; (10) §4.4 as amended: queued messages and grants in C3's per-session state file, layout in C5's `layout.json`, the index keeps projects, sessions, attention items, drafts, replay fixtures.

Owner process vocabulary is C1's `Owner`: `main`, `engine-host`, `pty-host`. "Defines" is the child whose schema module carries the entry; "Consumes" lists wave-2 consumers first, later children after a semicolon. Status is one of `agreed`, `renamed-from`, `added-for-consumer`, `conflict-resolved`, with the reason after a colon where it matters.

## (a) X2 commands and events

| Name | Kind | Owner | Defines | Consumes | Payload (one line) | Status |
|---|---|---|---|---|---|---|
| `settings.get` | command | main | C1 | C5 renderer | void → `SettingsState` (schema now version 2, C5) | agreed |
| `settings.set` | command | main | C1 (C5 extends) | C5 | `SettingsPatch` → `SettingsState` | agreed: C5 bumps `SettingsSchema` to version 2 (`keymap`, `notifications`) with a store migration |
| `settings.changed` | event | main | C1 | C5, C6 (theme), C9 (terminal theme) | `SettingsState` | agreed |
| `engine.ping` | command | engine-host | C1 | C1 smoke | void → `HostPing` | agreed |
| `engine.hostState` | command + event | main | C1 | C5 diagnostics | `HostState` | agreed |
| `engine.binaryInfo` | command | engine-host | C3 | ; C11 | void → `{ path, expectedVersion, version, ok, error }` | agreed |
| `engine.relayHealth` | command | engine-host | C3 | ; C11 | `{ force }` → `RelayHealth` | agreed |
| `engine.sessions` | command | engine-host | C3 | C3 e2e; C8, C12 | void → `EngineSessionStatus[]` | agreed |
| `engine.shutdown` | command | engine-host | C3 | C5 quit guard | `{ graceMs }` → `{ stopped, forced }` | agreed |
| `session.launch` | command | engine-host | C3 | C3 e2e; C10, C11 | `{ spec: LaunchSpec }` → `launching | relay_unreachable | refused` | agreed |
| `session.status` | command | engine-host | C3 | C5 read model; C8 | `{ appSessionId }` → `EngineSessionStatus` | agreed |
| `session.status` | event | engine-host | C3 | C5 (read model, `sessions.engine`), C4 (`IndexSessionSource` applies `toSessionRecordPatch`), main attention service | `{ appSessionId, status }` | agreed; C4's subscription added-for-consumer (see d.14) |
| `session.events` | command | engine-host | C3 | C6 `ipcSource`; C4 delegation for non-live sessions | `{ appSessionId, afterSeq: number | null, limit: number | null }` → `{ events, lastSeq, complete }` | agreed (ruling 2); C6 gains `lastSeq` |
| `session.eventBatch` | event | engine-host | C3 (C4 emits the same for backfill, tail, replay) | C6, C5 read model fold, main attention service (C3), C4 diagnostics | `{ appSessionId, events: SessionEvent[] }`, ≤ 500 per batch | agreed (ruling 2) |
| `session.send` | command | engine-host | C3 | ; C7 | `{ appSessionId, content }` → `{ messageUuid, disposition, queueId }` | agreed |
| `session.steer` | command | engine-host | C3 | ; C7 | `{ appSessionId, content }` → `{ messageUuid }` | agreed |
| `session.queue.list` | command | engine-host | C3 | ; C7 | `{ appSessionId }` → `{ entries, paused }` | agreed |
| `session.queue.edit` | command | engine-host | C3 | ; C7 | `{ appSessionId, queueId, content }` → `QueueEntry` | agreed |
| `session.queue.remove` | command | engine-host | C3 | ; C7 | `{ appSessionId, queueId }` → void | agreed |
| `session.queue.promote` | command | engine-host | C3 | ; C7 | `{ appSessionId, queueId }` → `{ messageUuid }` | agreed |
| `session.queue.setPaused` | command | engine-host | C3 | ; C7 | `{ appSessionId, paused }` → void | agreed |
| `session.queue` | event | engine-host | C3 | ; C7 | `{ appSessionId, entries, paused }` | agreed |
| `session.interrupt` | command | engine-host | C3 | ; C7 | `{ appSessionId, cancelEngineQueued }` → `{ stillQueued, cancelled }` | agreed |
| `session.answer` | command | engine-host | C3 | C5 hover card (allow once / plain deny); C7 | `{ appSessionId, requestId, answer: RequestAnswer }` → `{ outcome }` | conflict-resolved: C5's deny answer drops `message: null` (C3's schema has `message` optional, not nullable) |
| `session.setPermissionMode` | command | engine-host | C3 | ; C7 | `{ appSessionId, mode }` → `{ effective, refusal, error }` | agreed |
| `session.setModel` | command | engine-host | C3 | ; C7, C11 | `{ appSessionId, model }` → `{ ok, error, code }` | agreed |
| `session.setEffort` | command | engine-host | C3 | ; C7 | `{ appSessionId, effort }` → void | agreed |
| `session.setThinking` | command | engine-host | C3 | ; C7 | `{ appSessionId, maxThinkingTokens, display }` → void | agreed |
| `session.applyFlagSettings` | command | engine-host | C3 | ; C11 | `{ appSessionId, settings }` → void | agreed |
| `session.stopTask` | command | engine-host | C3 | ; C8 | `{ appSessionId, taskId }` → void | agreed |
| `session.rewind` | command | engine-host | C3 | ; C7 | `{ appSessionId, targetMessageUuid, lastSeenMessageUuid, files }` → `RewindOutcome` | agreed |
| `session.rewindFiles` | command | engine-host | C3 | C6 receipt Undo/Reapply | `{ appSessionId, userMessageUuid, dryRun }` → `RewindFilesOutcome` (`ok`, `enabled`, `message`, +counts) | renamed-from `engine.rewindFiles` (C6; ruling 3) |
| `session.bash` | command | engine-host | C3 | ; C7 | `{ appSessionId, command }` → `{ commandUuid }` | agreed |
| `session.memoryAppend` | command | engine-host | C3 | ; C7 | `{ appSessionId, text, target }` → `{ path, created }` | agreed |
| `session.setCwd` | command | engine-host | C3 | ; C10 | `{ appSessionId, path, trust }` → `SetCwdResponse` | agreed |
| `session.renameSession` | command | engine-host | C3 | ; C10 | `{ appSessionId, title }` → void | agreed |
| `session.generateTitle` | command | engine-host | C3 | ; C10 | `{ appSessionId, description, persist }` → `{ title }` | agreed |
| `session.reloadPlugins` | command | engine-host | C3 | ; C11 | `{ appSessionId }` → `ReloadPluginsResponse` | agreed |
| `session.mcpReconnect` | command | engine-host | C3 | ; C8, C11 | `{ appSessionId, serverName }` → void | agreed |
| `session.mcpToggle` | command | engine-host | C3 | ; C8, C11 | `{ appSessionId, serverName, enabled }` → void | agreed |
| `session.sideQuestion` | command | engine-host | C3 | ; P1 | `{ appSessionId, question }` → `{ text }` | agreed |
| `session.getUsage` | command | engine-host | C3 | ; C7, C11 | `{ appSessionId }` → `GetUsageResponse` | agreed |
| `session.getContextUsage` | command | engine-host | C3 | ; C7 | `{ appSessionId, detail }` → `GetContextUsageResponse` | agreed |
| `session.getSettings` | command | engine-host | C3 | ; C11 | `{ appSessionId }` → `GetSettingsResponse` | agreed |
| `session.listPermissionRules` | command | engine-host | C3 | ; C8, C11 | `{ appSessionId }` → `ListPermissionRulesResponse` | agreed |
| `session.getHooksListing` | command | engine-host | C3 | ; C11 | `{ appSessionId }` → `GetHooksListingResponse` | agreed |
| `session.getMemoryDialog` | command | engine-host | C3 | ; C7, C11 | `{ appSessionId }` → `GetMemoryDialogResponse` | agreed |
| `session.getSkillsDialog` | command | engine-host | C3 | ; C11 | `{ appSessionId }` → `GetSkillsDialogResponse` | agreed |
| `session.getSandboxDialog` | command | engine-host | C3 | ; C11 | `{ appSessionId }` → `GetSandboxDialogResponse` | agreed |
| `session.getWorkspaceDiff` | command | engine-host | C3 | ; C8 | `{ appSessionId }` → `GetWorkspaceDiffResponse` | agreed |
| `session.exportConversation` | command | engine-host | C3 | ; C11 | `{ appSessionId }` → `ExportConversationResponse` | agreed |
| `session.getStatus` | command | engine-host | C3 | ; C8, C11 | `{ appSessionId }` → `GetStatusResponse` | agreed |
| `session.mcpStatus` | command | engine-host | C3 | ; C8 | `{ appSessionId }` → `McpStatusResponse` | agreed |
| `session.listModels` | command | engine-host | C3 | ; C7, C11 | `{ appSessionId }` → `ListModelsResponse` | agreed |
| `session.getSessionCost` | command | engine-host | C3 | ; C8 | `{ appSessionId }` → `GetSessionCostResponse` | agreed |
| `session.getBinaryVersion` | command | engine-host | C3 | ; C11 | `{ appSessionId }` → `GetBinaryVersionResponse` | agreed |
| `session.stop` | command | engine-host | C3 | ; C10 | `{ appSessionId, reason: 'stop' | 'archive' }` → `{ exited, code, signal }` | agreed |
| `session.brokerItems` | event | engine-host | C3 | main attention service (C3, in main); no renderer consumer | `{ appSessionId, items: AttentionItem[] }`, the broker's whole list for the session (kinds permission, question, plan, dialog, elicitation) | added-for-consumer: ruling 1's internal event from the broker to main; registered in X2 so C1's envelope validates it, consumed through `HostSupervisor.onEvent`; re-emitted to the renderer by C1's supervisor as every host event is, but nothing there listens |
| `session.pendingRequest` | command | engine-host | C3 | main's `attention.request` handler | `{ appSessionId, requestId }` → `{ event: SessionEvent | null }` (the originating `*.requested` event of a pending or delivered broker item) | added-for-consumer: ruling 1 ("`attention.request` is answered by main by asking the engine host") |
| `session.list` | command | main | C4 | C5 renderer stores, C4 diagnostics | `{ includeArchived?: boolean }` → `{ sessions: SessionRecord[], revision }` | conflict-resolved: C4 and C5 had each dropped their definition in favour of the other's; the index owner (C4, §4.4) defines and answers; `SessionListItem`'s `summary` is dropped because the index-only columns reach the read model through C4's `SessionSource`, not the renderer |
| `session.get` | command | main | C4 | C5 | `{ appSessionId }` → `SessionRecord | null` | conflict-resolved: as `session.list` |
| `session.update` | command | main | C4 | C5 (pin, archive, mark read, "Mark all read"); C10 (rename, archive) | `{ appSessionId, patch: { title?: { text, source: 'user' \| 'tool' } \| null, pinned?, archived?, unread?, lastSeen? } }` → `SessionRecord` | conflict-resolved: replaces C5's first-draft `session.setPinned`/`session.markRead` and C4's interim handlers for them; `title` narrowed 2026-09-28 (C4 fix wave, finding 5): it sets the MAWS-side override, `null` clears it, `generated` is never set by a caller (engine titles are facts the index reads from disk) |
| `session.changed` | event | main | C4 | C5 stores and read model, C4 diagnostics | `{ record: SessionRecord, cause: 'discovered' | 'facts' | 'holder' | 'update' | 'live' | 'replay', revision }` | conflict-resolved: emitted by the index (C4), not by C5's read model; `revision` per C5's snapshot rule |
| `session.removed` | event | main | C4 | C5 (closes the session's tabs) | `{ appSessionId, revision }` | conflict-resolved: as `session.changed` |
| `session.projects.list` | command | main | C4 | C5 | void → `{ projects: ProjectRecord[], revision }` | added-for-consumer: C5 read it, C4 had only add/update/remove |
| `session.projects.add` | command | main | C4 | C5 ("+" and "Add project"; wired by C10) | `{ directory }` → `ProjectRecord` | agreed (C4's proposal accepted, ruling 8) |
| `session.projects.update` | command | main | C4 | C5; C10 | `{ id, patch: { name?, order? } }` → `ProjectRecord` | agreed (ruling 8) |
| `session.projects.remove` | command | main | C4 | C5; C10 | `{ id }` → void (hides; rediscovery does not resurrect) | agreed (ruling 8) |
| `session.projects.changed` | event | main | C4 | C5 project tree | `{ projects: ProjectRecord[], revision }` (whole list) | renamed-from `session.projectsChanged` (C5's ask) and C5's first-draft `session.projectChanged`/`projectRemoved` (ruling 8) |
| `session.digests` | command | main | C5 | C5 renderer | void → `{ digests: SessionDigest[] }` | agreed |
| `session.digest` | event | main | C5 | C5 renderer | `SessionDigest` (`appSessionId`, phase, activity, lastAssistantLine, context, cost, childAgents, pendingRequests, revision) | agreed; key renamed `appId` → `appSessionId` (ruling 1) |
| `session.setVisible` | command | main | C5 | C5 renderer (read model forwards to `SessionSource.onSetVisible`) | `{ appSessionId, visible }` → void | agreed; C5's ask for an index API `sessions.setVisible` is settled as `SessionSource.onSetVisible` (d.5) |
| `session.drafts.get` | command | main | C4 | ; C7 | `{ appSessionId }` → `Draft | null` | agreed |
| `session.drafts.set` | command | main | C4 | ; C7 | `{ appSessionId, draft }` → void | agreed |
| `session.replay.start` | command | main | C4 | C4 diagnostics; C12 | `{ source, speed }` → `{ appSessionId, sessionId, totalRows, spanMs }` | agreed; main allocates the ids and the `kind: 'replay'` record, dispatches `session.replay.launch`, and removes the record again on any dispatch error, rethrowing it (C4 fix wave, finding 4) |
| `session.replay.launch` | command | engine-host | C4 | main's `session.replay.start` handler only; no renderer caller | `{ appSessionId, sessionId, source, speed }` → `{ totalRows, spanMs }`; `IpcError internal` with `replay source not found: <path>`, `replay source unreadable: <path>: <errno>`, `replay source empty: <path>`, `replay source is not a journal: <path>: line <n>`, `replay source is not a transcript: <path>`, `replay already live: <appSessionId>`, all raised before any event or binding | added-for-consumer (2026-09-28, C4 fix wave, finding 4): no registered engine-host command carried the source, speed and allocated ids from main to the runner; the host binds the ids itself, so `fs.bind` is not sent for replay runs |
| `session.replay.control` | command | engine-host | C4 | C4 diagnostics | `{ appSessionId, action?, speed? }` → void | agreed |
| `session.replay.fixtures` | command | main | C4 | C4 diagnostics | void → `{ fixtures: ReplayFixture[] }` | agreed |
| `session.replay.progress` | event | engine-host | C4 | C4 diagnostics; C12 | `{ appSessionId, state, index, total, at, speed, message }` | agreed |
| `fs.state` | command | engine-host | C4 | C4 diagnostics | void → `FsState` | agreed |
| `fs.scan` | command | engine-host | C4 | main (`IndexSessionSource`) | `{ known? }` → `{ projects, sessions, changed, durationMs }` | agreed |
| `fs.bind` | command | engine-host | C4 | main (`IndexSessionSource`) | `{ bindings: { sessionId, appSessionId }[] }` → void | agreed |
| `fs.unfollow` | command | engine-host | C4 | C6 (tab close), main | `{ appSessionId, agentId: AgentId | null }` → void | agreed |
| `fs.subagents` | command | engine-host | C4 | ; C8 | `{ appSessionId }` → `{ agents: SubagentEntry[] }` | agreed |
| `fs.agentEvents` | command | engine-host | C4 | C6 child `ipcSource`; C8 drill-in | `{ appSessionId, agentId }` → `{ events, complete }` | agreed: C6's name, C4 adds `complete` (additive) |
| `fs.workflows` | command | engine-host | C4 | ; C8 | `{ appSessionId }` → `{ runs: WorkflowRun[] }` | agreed |
| `fs.tasks` | command | engine-host | C4 | ; C8 | `{ listId }` → `{ tasks: PersistedTask[] }` | agreed |
| `fs.readSpill` | command | engine-host | C4 | C6 spill loader; C8 | `{ path, offset?, length? }` → `{ content, bytes, offset, truncated }`; path must realpath under `projects/`, `tasks/`, `jobs/` | agreed: C6's name and fields, C4 adds `offset` (additive) |
| `fs.sessionChanged` | event | engine-host | C4 | main (`IndexSessionSource`), C4 diagnostics | `{ summary: TranscriptSummary, appSessionId: AppSessionId | null }` | agreed |
| `fs.sessionRemoved` | event | engine-host | C4 | main | `{ sessionId, appSessionId | null }` | agreed |
| `fs.holderChanged` | event | engine-host | C4 | main | `{ sessionId, appSessionId | null, holder, registry, job }` | agreed |
| `fs.followState` | event | engine-host | C4 | C4 diagnostics; C8 | `{ appSessionId, agentId | null, state, chainLength, leafUuid, gap, skippedLines, message }` | agreed |
| `fs.subagentsChanged` | event | engine-host | C4 | ; C8 | `{ appSessionId, agents }` | agreed |
| `fs.workflowChanged` | event | engine-host | C4 | ; C8 | `{ appSessionId, runId }` | agreed |
| `fs.tasksChanged` | event | engine-host | C4 | ; C8 | `{ listId }` | agreed |
| `fs.scanProgress` | event | engine-host | C4 | C4 diagnostics | `{ scanned, total }` | agreed |
| `git.status` | command | main | C4 | C4 diagnostics; C7, C8 | `{ directory }` → `GitStatus` | agreed |
| `git.branches` | command | main | C4 | ; C8, C10 | `{ directory }` → `{ current, branches }` | agreed |
| `git.diff` | command | main | C4 | ; C8 | `{ directory, scope, base?, path?, context? }` → `{ patch, files }` | agreed |
| `git.log` | command | main | C4 | ; C8 | `{ directory, limit, path? }` → `{ commits }` | agreed |
| `git.watch` | command | main | C4 | ; C7, C8 | `{ directory }` → `GitStatus` (ref-counted) | agreed |
| `git.unwatch` | command | main | C4 | ; C7, C8 | `{ directory }` → void | agreed |
| `git.changed` | event | main | C4 | ; C7, C8 | `{ repoRoot, status, reason }` | agreed |
| `attention.list` | command | main | C3 | C5 attention store | void → `AttentionItem[]` (every session's pending and delivered items) | conflict-resolved: owner was engine-host in C3 and C5; main per ruling 1, implemented by C3's attention service |
| `attention.changed` | event | main | C3 | C5 (attention store, read model, notifier), C4 persists behind it | `{ appSessionId, items: AttentionItem[] }`, the session's whole list | conflict-resolved: owner main (ruling 1); key `appSessionId` (C5 wrote `appId`) |
| `attention.request` | command | main | C3 | C5 hover card and Overview card; C7 | `{ appSessionId, requestId }` → `{ event: SessionEvent | null }` | conflict-resolved: C5 proposed owner engine-host; main answers by dispatching `session.pendingRequest` (ruling 1); defined in C3's `attention.ts` beside `list` and `changed` |
| `attention.notified` | event | main | C5 | C5 renderer (fallback toast), C5 smoke | `{ appSessionId, attentionId, delivery: 'os' | 'fallback', at }` | agreed |
| `attention.navigate` | event | main | C5 | C5 renderer | `{ appSessionId, attentionId | null, source: 'notification' | 'menu' }` | agreed |
| `layout.get` | command | main | C5 | C5 renderer | `{ key }` → `{ value: unknown | null }` | conflict-resolved: C5 had assigned these to C4's index and C4 had dropped them; C5 owns them over `<userData>/layout.json` (ruling 10) |
| `layout.set` | command | main | C5 | C5 renderer | `{ key, value }` → void | conflict-resolved: as `layout.get` |
| `layout.list` | command | main | C5 | C5 renderer, C5 acceptance | void → `{ keys: string[] }` | conflict-resolved: as `layout.get` |
| `layout.openExternal` | command | main | C5 | C6 markdown links, C5; C9's `pty.openLink` shares its helper | `{ url }` → void; `http`, `https`, `mailto` only | agreed (ruling 4) |
| `layout.action` | event | main | C5 | C5 renderer | `{ action: ActionId, arg: number | null }` | agreed |
| `pty.hostState` | command + event | main | C1 | C9 registry | `HostState` | agreed |
| `pty.ping` | command | pty-host | C1 | C1 smoke | void → `HostPing` | agreed |
| `pty.spawn` | command | pty-host | C9 (replaces C1's) | C9 registry, C1 smoke (migrated by C9 M2) | `{ appSessionId, label, cwd, cols, rows, shell?, args?, command? }` → `{ ptyId, pid }`; `env` removed | agreed (C1 handed `pty.*` to C9); migration stated in C9 M2 (ruling 9) |
| `pty.write` | command | pty-host | C1 / C9 | C9 | `{ ptyId, data: string }` → void | agreed |
| `pty.resize` | command | pty-host | C1 / C9 | C9 | `{ ptyId, cols, rows }` → void | agreed |
| `pty.kill` | command | pty-host | C1 / C9 | C9 | `{ ptyId, signal? }` → void (SIGHUP default) | agreed |
| `pty.ack` | command | pty-host | C9 | C9 registry | `{ ptyId, offset }` → void | agreed |
| `pty.attach` | command | pty-host | C9 | C9 registry | `{ ptyId }` → `{ info: PtyInfo, replay: Uint8Array, nextOffset }` | agreed |
| `pty.list` | command | pty-host | C9 | C9 registry, harness | void → `{ ptys: PtyInfo[] }` | agreed |
| `pty.foreground` | command | pty-host | C9 | C9 tool | `{ ptyId }` → `{ process, busy }` | agreed |
| `pty.openLink` | command | main | C9 | C9 tool | `{ url }` → `{ opened }` | conflict-resolved: kept as ruling 9 lists it, but its handler calls the one scheme-checked `shell.openExternal` helper C5 lands for `layout.openExternal` (d.11), so the check is implemented once |
| `pty.data` | event | pty-host | C9 (replaces C1's) | C9 registry (sole subscriber), C1 smoke via Diagnostics (migrated) | `{ ptyId, offset, data: Uint8Array }` | agreed; migration stated in C9 M2 (ruling 9) |
| `pty.exit` | event | pty-host | C1 / C9 | C9 registry | `{ ptyId, exitCode, signal }`; nulls mean the host died | agreed |

Counts: 101 distinct command names and 27 distinct event names defined or consumed across the five documents (126 table rows; `engine.hostState` and `pty.hostState` are both a command and an event; C1's entries appear where a wave-2 child consumes or migrates them). Status totals: 107 agreed, 13 conflict-resolved, 2 renamed-from, 4 added-for-consumer. Added for consumers: `session.brokerItems` and `session.pendingRequest` (ruling 1), `session.projects.list` (ruling 8), `session.replay.launch` (C4 fix wave 2026-09-28, finding 4; the `session.update` title payload was narrowed in the same wave, finding 5). Renamed: `session.rewindFiles` (from C6's `engine.rewindFiles`, ruling 3), `session.projects.changed` (from C5's `session.projectsChanged`, ruling 8).

## (b) Additive changes to X1, X3, X7 and shared test support

| Contract | Change | Owning child | File | Notes |
|---|---|---|---|---|
| X1 | `SessionRecord.gateway` becomes `{ routed: boolean; baseUrl: string | null; autoModeServer: 'enabled' | 'disabled' | 'unknown' }` | C3 | `src/shared/graph/session.ts` | additive; C4 fills `null` / `'unknown'` for discovered sessions and adds two columns (ruling 6) |
| X1 (wire) | typed request/response payloads for every control subtype C3 uses (`InitializeRequest` … `PermissionUpdate`) | C3 | `src/shared/wire/control.ts` | additive to C1's file; loose objects |
| X1 (wire, new) | store record shapes `LiveSessionRecord`, `JobState`, `PersistedTask`, `WorkflowSnapshot`, `WorkflowJournalRow`, `TranscriptSummary`, `Holder` | C4 | `src/shared/wire/store.ts` | new file; C1's `TranscriptRecord`, `LastPromptAnchor`, `AgentMeta` stay in `transcript.ts` |
| X1 (event ids) | disk-derived and replayed events carry `seq: null` and deterministic ids `<uuid>`, `<uuid>#<n>`, `anchor:<offset>`, `session:<id>:started`; live events `${appSessionId}:${launchId}:${seq}:${i}` | C4 (disk), C3 (live) | `src/engine-host/fs/backfill.ts`, `src/engine-host/normalizer.ts` | the reason for ruling 5: consumers deduplicate by `id`, never by `seq` |
| X8 loader | `FixturePass` gains `'pass3'`; `listJournals('pass3')` reads `fixtures/pass3/*.jsonl` | C3 | `test/support/fixtures.ts` | additive; the pass-3 fixtures are `rewind-files.jsonl`, `plan-outcomes.jsonl` (C3 M6) |
| X8 loader | `loadTranscriptFixture(name)` over `test/fixtures/transcripts/*.jsonl` | C4 | `test/support/fixtures.ts` | additive; note C4's directory is `test/fixtures/transcripts/` and C6's is `test/fixtures/transcript/` (distinct, deliberately kept) |
| X8 loader | `listSyntheticJournals()`, `loadSyntheticJournal(name)`, `loadEventFixture(name)` over `test/fixtures/transcript/**` | C6 | `test/support/fixtures.ts` | additive; the wire round-trip suite in `src/shared/wire/frames.test.ts` gains the synthetic directory |
| X3 | the presentation model: row kinds, `Cell`, `CellDetail`, `TurnSummary`, `ToolClassification` (X3's five fields plus `hidden`, `safeguard`, `humanDecision`), `TOOL_CATEGORIES` with the catch-all `other` phrased only when it is the sole category, deterministic row ids | C6 (owner) | `src/renderer/src/transcript/model/{rows,keys,classify,reduce,derive,copy}.ts`; public surface `src/renderer/src/transcript/index.ts` | canonical X3 files once landed |
| X7 | 21 token names: `--term-bg`, `--term-fg`, `--term-cursor`, `--term-cursor-fg`, `--term-selection`, `--term-ansi-<name>` and `--term-ansi-bright-<name>` for `black red green yellow blue magenta cyan white` | C9 | `src/renderer/src/styles/tokens.css`, `mockups/tokens.css`, `mockups/tokens-light.css` | accepted (ruling 6); values advisory; not mapped into `@theme inline` (the adapter reads computed values) |
| X7 (utilities) | `@source` lines for Streamdown and its plugins, `@custom-variant dark` keyed on `[data-theme="dark"]`, a token bridge for the shadcn names Streamdown's dist uses | C6 | `src/renderer/src/styles/app.css` | additive block; C9 does not touch `app.css` |
| X2 settings | `SettingsSchema` version 2 adds `keymap: Partial<Record<ActionId, Chord | null>>` (`z.partialRecord`: overrides only, `{}` valid, unknown keys rejected) and `notifications: { enabled, sound }`; store migration v1 → v2 | C5 | `src/shared/ipc/schema/settings.ts`, `src/main/settings/store.ts` | C11 extends further; C5 review finding 2 (zod 4's enum-keyed `z.record` is exhaustive) |
| Host protocol | `HostSupervisor.onEvent<N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void): () => void`, main-side subscription to validated host events beside `onState` | C3 (adds), C4 (consumes) | `src/main/hosts/supervisor.ts` | additive to C1's file; needed by C3's attention service and C4's `IndexSessionSource` (d.9) |
| Router | `interceptCommand(name, handler): () => void`, consulted before the main handler or `dispatchToHost` for that name; installed only by C5's stub source | C5 | `src/main/ipc/router.ts` | renamed from C5's `interceptHostCommand` because `attention.list` and `attention.request` are main-owned now |
| Main helper | `openExternalUrl(url): boolean`, the one scheme-checked `shell.openExternal` (`http`, `https`, `mailto`) | C5 (adds), C9 (reuses) | `src/main/open-external.ts` | d.11 |
| X6 capture | `captureShellEnvironment()` moves from `src/engine-host/shell-env.ts` to `src/shared/host/shell-env.ts` so the PTY host runs the same capture | C3 (adds), C9 (consumes) | `src/shared/host/shell-env.ts` | d.12 |
| e2e support | `launch({ env })`: the smoke's launch helper accepts extra environment variables | C3 (adds), C5, C6, C9 (reuse) | `e2e/support/launch.ts` | one change instead of three |

## (c) Shared files and merge order

Merge order to master: **C3, C4, C5, C6, C9** (ruling 7). Each addition to a shared file is a separate, clearly delimited block (a comment naming the child at both ends, or a self-contained function or entry); a later child in the order rebases over the earlier child's block and never edits inside it. Files two or more wave-2 children touch:

| File | C1 | C3 | C4 | C5 | C6 | C9 | Merge note |
|---|---|---|---|---|---|---|---|
| `package.json` | scaffold | `live` vitest project, `test:live` script | `NODE_OPTIONS=--disable-warning=ExperimentalWarning` on `test` | `dev:stub` script, deps radix-ui, cmdk, user-event | `dev:harness`, `e2e:transcript` scripts, deps streamdown + plugins, katex, react-virtual | xterm packages (exact), ghostty-web dev dep during M1 | scripts and dependencies are naturally separate keys; C6 and C9 both add `radix-ui` if C5 has not (same range) |
| `src/main/index.ts` | app lifecycle, supervisor start | start the attention service (one line) | open the index, start `IndexSessionSource` and the git service (additive) | source selection, menu, quit guard, layout store start | — | — | order C3, C4, C5; each a delimited block after the supervisor start |
| `src/main/hosts/supervisor.ts` | supervisor | `onEvent(name, listener)` (additive) | consumes `onEvent`; its worktree carries an identical block until rebase | — | — | — | one method, signature fixed in (b) |
| `src/main/ipc/router.ts` | router | — | — | `interceptCommand` seam | — | one line registering `pty.openLink` | order C5, C9 |
| `src/main/window.ts` | window, CSP | — | — | `trafficLightPosition`, minimum size, focus/blur wiring for the notifier | load `harness.html` when `MAWS_HARNESS=1` | CSP builder takes harness-only extra sources; creates `/tmp/maws-harness/{a,b}` under `MAWS_HARNESS=1` | order C5, C6, C9; C6 lands the `MAWS_HARNESS` load switch, C9 reuses it |
| `electron.vite.config.ts` | scaffold | — | — | — | `harness.html` renderer input, `server.fs.allow` for fixtures | reuses C6's input (its worktree carries the same block until rebase) | C6 lands; C9 adds nothing after rebase |
| `src/renderer/harness.html`, `src/renderer/src/harness/main.tsx` | — | — | — | — | the entry and the hash router: `#transcript` (default) → `Harness.tsx` | adds routes `#probe` → `terminal/Probe.tsx`, `#panel` → `terminal/PanelHarness.tsx` | C6 lands the router; C9 adds two routes as a block; each page assigns `window.__maws_harness` on mount (only one page is mounted per load); C9's harness files live under `src/renderer/src/harness/terminal/` so `metrics.ts` and the pages never collide with C6's flat files |
| `src/renderer/src/styles/app.css` | `@theme inline` map | — | — | — | `@source` lines, `@custom-variant dark`, Streamdown token bridge | — (tokens go to `tokens.css`) | C6 only in practice; listed because the task flagged C9 |
| `src/renderer/src/styles/tokens.css` | X7 values | — | — | — (values may move under §7.5, not here) | — | `--term-*` tokens | C9 only |
| `src/renderer/src/app/Diagnostics.tsx` | strip | — | mounts the Store section (`StoreDiagnostics.tsx`) | becomes the content of the `diagnostics` tab; counts line | — | echo test spawns with `appSessionId`/`label` and decodes bytes | order C4, C5, C9 |
| `src/renderer/src/stores/sessions.ts` | — | — | — (no renderer session store; C4 has `stores/store-diagnostics.ts`) | authors it: records, projects, digests, engine statuses, selectors | — | — | C5 only; C5's comment that C4 authors it is corrected |
| `src/shared/ipc/schema/session.ts` | empty | lifecycle and control entries, `session.brokerItems`, `session.pendingRequest` | record side (`list`, `get`, `update`, `projects.*`, `changed`, `removed`, `projects.changed`), `drafts.*`, `replay.*` | `digests`, `setVisible`, `digest` | — (consumes; its worktree may carry proposed entries under a `// proposed by C6` comment, dropped at rebase) | — | order C3, C4, C5; the registry prefix-and-count test holds after each |
| `src/shared/ipc/schema/attention.ts` | empty | `attention.list`, `attention.changed`, `attention.request` (owner main) | — (implements the `AttentionStore` port) | `attention.notified`, `attention.navigate` | — | — | order C3, C5 |
| `src/shared/ipc/schema/layout.ts` | empty | — | — | everything (`get`, `set`, `list`, `openExternal`, `action`, value shapes) | — | — | C5 only |
| `src/shared/ipc/schema/settings.ts` | v1 | — | — | v2 (`keymap`, `notifications`) | — | — | C5 only; C11 later |
| `src/shared/ipc/schema/engine.ts` | `engine.ping`, `engine.hostState` | `binaryInfo`, `relayHealth`, `sessions`, `shutdown` | — | — | — | — | C3 only |
| `src/shared/ipc/schema/fs.ts`, `git.ts` | empty | — | everything | — | — | — | C4 only |
| `src/shared/ipc/schema/pty.ts` | five commands, two events | — | — | — | — | replaces C1's entries (migration in C9 M2) | C9 only |
| `src/shared/wire/control.ts` | frames | typed control payloads (additive) | — | — | — | — | C3 only |
| `src/shared/wire/frames.test.ts` | round trip | — | — | — | gains `test/fixtures/transcript/**` (additive) | — | C6 only |
| `src/shared/graph/session.ts` | X1 record | `gateway` extension | — | — | — | — | C3 only |
| `src/shared/host/shell-env.ts` | — | `captureShellEnvironment()` | — | — | — | consumed by `src/pty-host/env.ts` `baseEnvironment()` | C3 adds; C9 consumes |
| `src/engine-host/index.ts` | `engine.ping` | replaces the body: `runHost` + `registerEngineIpc` | one line `registerFs(on, emit)` | — | — | — | order C3, C4 |
| `src/engine-host/ipc.ts` | — | X2 handlers | `session.events` delegates to `FsService.eventsSnapshot` for an `appSessionId` with no live process (one seam; C4's `register.ts` carries a temporary `session.events` handler only in C4's worktree, deleted at rebase) | — | — | — | order C3, C4 |
| `src/main/attention/` (directory) | — | `service.ts`, `store.ts` (the `AttentionStore` port), `file-attention-store.ts` | — | `notifier.ts` | — | — | different files; no merge conflict |
| `src/main/open-external.ts` | — | — | — | `openExternalUrl` | — | consumed by the `pty.openLink` handler | C5 adds; C9 consumes |
| `test/support/fixtures.ts` | loader | `FixturePass` gains `'pass3'` | `loadTranscriptFixture` | — | `listSyntheticJournals`, `loadSyntheticJournal`, `loadEventFixture` | — | order C3, C4, C6; each a delimited block of exports |
| `e2e/support/launch.ts` | launch helper | `launch({ env })` option (passes `MAWS_ENGINE_REPLAY=1`) | — | reuses `env` (`MAWS_E2E`, `MAWS_SESSION_SOURCE`, …) | reuses | reuses (`MAWS_HARNESS=1`) | C3 lands the option; nobody else edits the file |
| `e2e/smoke.spec.ts` | smoke | — | — | opens Help › Diagnostics before asserting the strip | — | payload migration where it reads `pty.data` or invokes `pty.spawn` | order C5, C9 |
| `test/fixtures/` (directory) | `transcript-rewind.jsonl` | — | `transcripts/{rewind-real,subagent-parent,torn-tail}.jsonl` | `shell/*.json` | `transcript/*.jsonl`, `transcript/events/*.events.jsonl` | — | distinct subdirectories; `transcripts/` (C4) and `transcript/` (C6) are different directories |
| `e2e/*.spec.ts` | `smoke.spec.ts` | `engine-replay.spec.ts` | — | `shell.spec.ts` | `transcript.spec.ts` | `terminal.spec.ts` | distinct files |

Not shared after reconciliation: `src/main/layout/store.ts` (C5 only, permanent, ruling 10), `src/renderer/src/panel/tool.ts` (C9 adds, C5 reads), `src/renderer/src/panel/{PanelRegion.tsx,host-slot.ts}` (C5), `src/pty-host/**` (C9), `src/engine-host/fs/**` (C4), `src/main/index/**`, `src/main/git/**` (C4), `src/main/sessions/**`, `src/main/layout/**`, `src/main/menu.ts`, `src/main/window-state.ts`, `src/main/lifecycle/**` (C5), `src/renderer/src/transcript/**`, `src/renderer/src/stores/transcript.ts` (C6), `src/renderer/src/terminal/**`, `src/renderer/src/tools/terminal/**`, `src/renderer/src/stores/terminals.ts` (C9).

## (d) Asks between siblings and how each was settled

1. **C6 → C3, C4: event name and snapshot.** C6 asked for `session.eventBatch` (event) and `session.events` (snapshot). C3 adopted both and added `lastSeq`; C4 emits `session.eventBatch` for backfill, tail and replay and answers `session.events` for non-live sessions through `FsService.eventsSnapshot`. C5's document still named the stream `session.events`; corrected to `session.eventBatch`. Settled per ruling 2.
2. **C6 → C3: `engine.rewindFiles`.** C3 renamed it `session.rewindFiles` with a superset output; C6's table, `RewindInterface` comment and residue now use the new name. Settled per ruling 3.
3. **C6 → C5: `layout.openTab`, `layout.openExternal`.** `openTab` is the renderer store action `openTab(ref, opts)` in C5's layout store, reached by C6 through its `TranscriptActions.openFile` adapter; `layout.openExternal` is a main command. C6's table and residue corrected. Settled per ruling 4.
4. **C4 → C6: dedup by `seq`.** C6's `ipcSource` dropped batches by `seq`; disk events carry `seq: null`. C6 now deduplicates by event `id` against the snapshot; the M5 decision and pin are rewritten. Settled per ruling 5.
5. **C5 → C4: `sessions.setVisible` on the index API.** Settled without a new index method: C5's `SessionSource` port gains `onSetVisible(appSessionId, visible)`; C4's `IndexSessionSource` keeps the visible set and applies the unread rule (`setUnread` when `lastRecordAt` advances for a non-visible session, `markSeen` in the same step for a visible one), for every session including MAWS-owned ones (the engine appends the JSONL, so the disk rule covers live turns and the "holder is not `self`" clause is dropped). C5's read model no longer sets `unread` itself; it reports visibility and keeps `costAtSeen`. Pin and mark-read are `session.update` patches, so `onMarkRead` and `onSetPinned` leave the port. Ruling 8.
6. **C5 → C4: project change event.** `session.projects.changed { projects, revision }` (whole list), plus `session.projects.list` which C5 already read and C4 had not written. Ruling 8.
7. **C4 ↔ C5: the record side of `session.*` had no owner.** Each document had dropped its own `session.list`/`get`/`update`/`changed`/`removed` in favour of the other's. Resolved for the index owner (C4, §4.4): C4 defines and answers them and emits the events with a `revision`; C5 consumes. `SessionListItem` is dropped (records only; index-only columns reach the read model through the port). C4's "interim handler" language and C5's first-draft names (`session.setPinned`, `session.markRead`, `session.projectChanged`, `session.projectRemoved`, `attention.removed`) are removed. `ReadModelWriter` gains `observeProject`/`observeProjectRemoved` so C4's source can push projects (the notifier titles need project names); C4's `upsertProject`/`upsertSession`/`removeSession` become C5's `observeProject`/`observeRecord`/`observeRemoved`.
8. **C4 ↔ C5: `layout.*` had no owner.** C5 had assigned the key/value store to C4's index and C4 had dropped it for C5's `layout.json`. Per ruling 10, C5 owns `layout.get`, `layout.set`, `layout.list` over `<userData>/layout.json` permanently; the "shim replaced at merge" language is removed from C5. No `layout.changed` event: the renderer is the only writer and hydrates from the snapshot; C8 or C12 may add one when a second consumer exists.
9. **C4 → C1: `HostSupervisor.onEvent`.** C4 proposed it; C3 now needs it first (main's attention service subscribes to `session.brokerItems`, `session.eventBatch`, `session.status`). C3 adds it in the merge order; C4 consumes it and carries an identical block in its worktree until rebase. Signature in (b).
10. **C5 → C3: `attention.request`.** C5 proposed an engine-host-owned command; ruling 1 makes it main's. C3 defines `attention.request` beside `attention.list` and `attention.changed` in `attention.ts` and implements all three in main's attention service; the service answers `attention.request` by dispatching the new host command `session.pendingRequest`. C5's `attention.answer` (already dropped in C5's Surprises) is removed from its Repository map. C5's stub source intercepts `attention.list`, `attention.request` and `session.answer` through the renamed seam `interceptCommand`, which now covers main-owned names.
11. **C9 ↔ C5: two `shell.openExternal` implementations.** `layout.openExternal` (C5) and `pty.openLink` (C9) both scheme-check and open a URL. Both names stay (ruling 9 lists `pty.openLink`; the terminal wants `{ opened }` back), but the check is implemented once: C5 lands `openExternalUrl(url): boolean` in `src/main/open-external.ts`; C9's handler calls it.
12. **C9 → C3: `baseEnvironment()` swap.** C9 expected C3 to "swap" the PTY host's base environment for X6's captured login-shell environment, but the PTY host is a separate utility process and C3 lands first. Settled by placing C3's capture in `src/shared/host/shell-env.ts` (`captureShellEnvironment()`), which both hosts call once at start; C9's `baseEnvironment()` uses it with `process.env` as the fallback. The charter's "captures once" becomes once per host; benign, noted here.
13. **C6 ↔ C9: two harnesses.** Both add `src/renderer/harness.html`, `src/renderer/src/harness/{main.tsx,metrics.ts}`, the `MAWS_HARNESS=1` load switch in `src/main/window.ts`, the `electron.vite.config.ts` input and a `window.__maws_harness` global. Settled: one entry; C6 lands `harness.html`, `main.tsx` as a hash router (`#transcript` default), the window switch and the config input; C9 adds routes `#probe` and `#panel` and keeps its pages and its own `metrics.ts` under `src/renderer/src/harness/terminal/`; each page assigns `window.__maws_harness` on mount; C9 adds only the harness-only CSP sources to the CSP builder. C6's `?fixture=`, `?speed=`, `?theme=` query parameters are unchanged.
14. **C3 ↔ C4: who applies `toSessionRecordPatch`.** C4 named "C3's main-side glue", which C3 had not planned (C3 touched nothing under `src/main/`). Settled: C4's `IndexSessionSource` also subscribes to `session.status` through `onEvent`, calls `SessionStore.applyEngineStatus` for a known `appSessionId` and `bindEngineId` when `engineSessionId` first appears (then `fs.bind`). `createForLaunch` keeps no wave-2 caller; C10 is its consumer.
15. **C3 ↔ C5 ↔ C4: attention ownership and the non-broker kinds.** Ruling 1. C3's broker emits `session.brokerItems` (permission, question, plan, dialog, elicitation) and returns `{ lost }` from `processExited()`; main's attention service (C3, `src/main/attention/service.ts`) derives `interrupted` (from `process.exited.lostAttentionCount`, summary `Session interrupted, N approval(s) lost`), `error` (`turn.ended.isError` or a hard terminal reason, `task.notification { status: 'failed' }`), `auto_mode_unavailable` (`tool.result.denial === 'automode-unavailable'`) and `held_peer_message` (`session.status.heldPeerMessages`, expiring), merges per session, persists through the `AttentionStore` port (`list`, `replaceForSession`, `retireForSession`, as C4 already wrote its `Index.attention`), emits `attention.changed` and answers `attention.list` and `attention.request`. Not covered by the rulings and decided here: a non-broker `error` or `interrupted` item retires when the session's next human turn starts or the session is stopped or archived. C3's live tests, which run at the host level without main, assert `session.brokerItems` and `process.exited.lostAttentionCount` instead of `attention.changed`; the e2e (with main) keeps `attention.changed`.
16. **C5's `appId` payload keys.** Renamed to `appSessionId` throughout C5 (digest, `session.setVisible`, `attention.*`, `TabRef`, `PanelHostProps`, slot props, scenario files, selectors) and in C4's Concrete Steps and Acceptance (`session.setPinned { appId }` → `session.update { appSessionId, patch: { pinned: true } }`). C1's `SessionRecord.appId` field and C4's `app_id` column and store parameter names are C1's and C4's internals and stay. Ruling 1.
17. **C5 → C3: hover-card deny payload.** `{ kind: 'permission', decision: 'deny', message: null }` fails C3's strict schema (`message` is optional, not nullable). C5 now sends `{ kind: 'permission', decision: 'deny' }`.
18. **C4 → C1: `test/fixtures/transcript-rewind.jsonl` anchor.** C4 found the synthetic anchor inverted (`leafUuid` should be the preceding assistant `a1`, `lastPrompt` the rewound-away prompt, `explicit: true`). C1 is off limits to this pass; `[architect]` to relay to C1 (or to C1's review). C4's row stays as written; nothing else depends on it (`currentChain` is unaffected).
19. **C3's `SessionStateStore` file and C5's `layout.json` versus §4.4.** Both were `[parent-impact]` in C4; the charter's §4.4 was amended on 2026-09-28. C3, C4 and C5 now cite the amended text instead of raising it. Ruling 10.
20. **C9 → C1: `--term-*` token names into X7.** Accepted under ruling 6; C9's "once C1 accepts them" is replaced by the acceptance.
21. **C6 → owners: proposed schema entries in C6's worktree.** Under the merge order C6 lands after C3, C4 and C5, so C6 adds nothing to `src/shared/ipc/schema/*`; its worktree may carry the entries it consumes under a `// proposed by C6` comment and drops them at rebase, recording any drift in its Decision Log.
22. **C9's `pty.spawn` requires `appSessionId` and `label`.** C1's Diagnostics echo test and smoke spawn without them; C9 M2 migrates both (ruling 9).

`[architect]` items: d.18 only (a correction to C1's synthetic fixture, outside the five documents).
