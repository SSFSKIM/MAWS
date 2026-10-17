# P3-HD — The direct connector route

> Execution child of `docs/doperpowers/plans/2026-10-12-p3-co-work.md`, **P3-HD**, Decision Log 90; parent pin **blob a67a3345b6c346cc7d76c209ca73a88c9005e7ed at master e6b5912f9**. Owner dispatch: parent Decision Log 95, 2026-10-17. The design lives in that composite, P3-H's section and Decisions 24, 81–95, with journal hygiene added by 97. This document owns execution, not a second design. The architect alone changes the composite and interface ledger.

## Purpose

An artifact that has permission to read a configured connector should keep refreshing after its session's engine quits. MAWS will make its own MCP connection to a verified server, under the same artifact permission and visible-page lifetime as the existing engine route. For an HTTP connector requiring OAuth, the owner connects MAWS itself once; no Claude Code credential is borrowed. The owner can see the configuration source and disconnect MAWS without changing the engine's grant.

The observable path is the existing HTML artifact and its Connectors sheet: declare and Allow a fixture tool, read through the engine, stop the engine, then read through MAWS directly without another artifact grant. The new `e2e:connectors-direct` scene proves that transition, stdio and HTTP transport, and MAWS's own OAuth through a scratch authorization server. No real account or model turn is needed.

## Progress

- [x] (2026-10-17 03:16Z) Isolated worktree confirmed at e6b5912f9; binding parent decisions, H implementation/handoff, spike and gate rules read. Full interface-ledger orientation delegated and returned; E2's cited standalone document is absent from this pin, reported to architect.
- [x] (2026-10-17 03:19Z) One frozen/prefer-offline worktree install through the shared slot completed, exit 0.
- [ ] Execution document independently reviewed, residue rulings and proposed names recorded by architect.
- [ ] M1 — Attested source observations, conservative lookup and journal creation permissions.
- [ ] M2 — Host-local direct operations and bounded SDK stdio/HTTP connections.
- [ ] M3 — Main-owned OAuth custody, loopback flow and owner connection controls.
- [ ] M4 — Route integration, transitions and fixture acceptance.
- [ ] Whole-branch review, final gates with evidence and architect hand-back.

## Acceptance

1. **Same page, same permission.** The HTML fixture used by H declares and receives a read grant. With its eligible engine alive, `via.route` is `engine`. After that engine exits and no eligible engine is live, a refresh succeeds with `via.route` `direct`, no sessionId and the same grant fingerprint. Starting an eligible engine again restores E on the next refresh. Each refresh makes exactly one tool call; neither an in-flight failure nor a route change triggers a second submission. Engine/session counts prove no timer acquires or holds an engine.
2. **The existing lifecycle still applies.** Actual native hide/minimize plus surface visibility pauses direct calls and watches; showing catches up once. Revoke and delete stop queued calls and suppress late/retained results, including a consumed-once result. A duplicate and a restored version gain no grants. H's tests remain unchanged and pass. Call-log silence, not only UI labels, is the proof.
3. **Verified direct connections.** A stdio fixture and an unauthenticated HTTP fixture are reached from engine-reported, fingerprint-matched file entries. The trusted sheet names the verified file/scope, while unverifiable entries say engine-only. A changed file or ambiguous report does not silently connect a different server. MAWS's stdio PID is distinct from the engine's; its environment contains only the SDK minimal keys, it starts on demand, closes after the idle bound, and disappears when main disconnects or quits. No background token refresh or source calls continue without main.
4. **Own OAuth.** The toy protected MCP server and authorization server from the spike complete MAWS's first DCR/state/PKCE/resource-bound flow via an ephemeral listener bound only to `127.0.0.1`. A second connection and a scratch app relaunch use the encrypted stored grant without another browser or client registration. Refresh-token rotation is saved before another refresh can use the old token. Disconnect fences new direct work, attempts advertised revocation and forgets the local grant even if the revocation endpoint is unavailable. A different server or issuer never receives that token. Cold provenance is re-established by a scratch no-model engine observation after a host restart, never restored from disk.
5. **Authority at the write.** Tests pause immediately before stdio's stdin write and HTTP's actual fetch admission, revoke/delete/change mode while paused, and prove no tools/call reaches either fixture. Once grants admit at most one concurrent call. Cancelling during connection, authorization, refresh or transport preparation leaves no later send, resurrected credential or leaked fence. Already-transmitted remote effects are not claimed reversible; cancellation suppresses their result and never retries them automatically.
6. **Custody and bounds.** No new status/config/credential persistence or public broadcast; only encrypted OAuth records persist in MAWS userData. The direct host receives at most short-lived access credentials, not refresh tokens/client secrets. Missing/unavailable safeStorage fails closed, never plaintext. Loopback timeout, wrong state, duplicate callback, failed token exchange and app shutdown close the listener. Owner-only journal directory/files are created as 0700/0600, including rotated segments, without changing X8's faithful contents.

## Execution constraints and residue recommendations

H's ledger `docs/doperpowers/ledgers/2026-10-16-P3-H.md`, “Final as-built rows”, and the interface ledger's final X23 H row are authoritative over earlier provisional rows. Inherit X9/X23/X25/X29/X32 and X16's exact canonical-directory eligibility. Preserve H's portable success/refusal types, main-owned scheduler, 64-watch cap, 30 s–24 h interval, 128 declarations per lease, 64 KiB arguments, result bound, 180 s operation deadline, streaming-only starts and owner-targeted delivery. Read grants persist; write tools require Allow once and cannot be watched. Route D is not restricted to read calls; “read-only configuration” means MAWS never edits engine configuration.

The following are the executor's concrete recommendations for Decision 90's residue. They are sent to the architect before becoming shared contracts; implementing a disputed contract waits for its ruling, while the journal check and fixture grounding can proceed. No child consumes an unledgered name.

### Source truth and lifetime

Keep a bounded **host-memory observation cache**, populated only from a live `mcp_status` response tied to the exact session launch and canonical effective directory. A complete newer report replaces that launch's older set, including removal/disabled entries; late answers from replaced launches cannot repopulate it. Engine exit does not delete the last observation while main stays attached: that is what permits engine-less refresh. Main disconnect or host shutdown clears observations; no journal or persisted cache recovers them. A cold app therefore needs a live observation before D is available, even when an OAuth grant already exists. Explain that condition in the trusted sheet rather than falsely calling a saved credential a verified source.

Retain identity, tool annotations, observation generation/time, source locator and comparison digests, never raw headers, env or OAuth fields. Raw status is used locally and discarded; X8's pre-existing engine journal remains unchanged. Limit to 128 directory contexts and 256 servers per context; exceeding the bound refuses new direct observations rather than evicting an active identity into another meaning. Clear on main detach; no TTL timer performs external work. Multiple reports for the same directory/server must agree on source and identity before D may use one; conflicting reports mean engine-only, not last-writer precedence.

Scope labels are not paths. Current retained evidence (`spikes/p3-connectors/fixtures/engine-mcp-call.jsonl`, seq 5) names `source:user`, `project`, `dynamic`, and omits stdio env. Recommend supporting only user/local entries for which the **actual live launch's config-home path** makes one file and JSON location unambiguous (`mcpServers[name]` or `projects[exactCwd].mcpServers[name]`). The path must come from the trusted live launch, never today's process environment or a filesystem search. A project label alone cannot identify which ancestor `.mcp.json` won; plugin/dynamic/enterprise/managed/SDK/claude.ai remain engine-only unless later evidence identifies one file without resolution. A new no-model scratch probe grounds local scope and config-home behavior before promotion; a contrary result narrows admission rather than changing precedence.

Recommend refusing entries whose effective executable arguments/configuration cannot be matched because they require variable expansion, omitted env, helpers, manual OAuth options or unsupported transport fields. Plain stdio command/args and plain HTTP URL/header records are compared to the observed projection; headers are matched by in-memory digest and never enter H's grant fingerprint. Own OAuth is discovered from a plain HTTP entry and uses MAWS's registration, not omitted engine OAuth options. Read exactly the identified entry read-only before each connection/call; a missing, changed, symlink-retargeted, oversized or malformed source refuses D until a fresh live observation. Retain H's fingerprint algorithm unchanged so E↔D never re-grants merely for a route change. An additional full-entry digest invalidates cached direct connections when non-grant identity changes.

### Actual-write authority

Recommend the **SDK client and transport in the engine-host process**, commanded and scheduled by main. Main holds UI, leases, connection credentials and OAuth; the host holds the artifact store, once-consumption, direct operation and final synchronous fence. A main-side SDK client plus an IPC admission answer is rejected because revoke/delete can commit before main's later write. Moving the grant store into main is rejected because it breaks A/H authority and detached-host guarantees.

Use a separate direct operation table with the same start/take/cancel contract and result retention as E; do not weaken or mechanically refactor E to share a subtly different boundary. A fence is allocated before durable once authorization, checked after every async preparation, then checked at actual transport admission. It stays held through an untaken result and breaks on the same store events as H. Main disconnect closes operations, transports and transient credentials synchronously with invalidation; process closure can finish asynchronously within the shutdown bound. Register all cleanup with `onClientGone`, not only normal quit.

The SDK's cancellation alone is not proof of the final-write guarantee. The implementation must establish the write boundary from SDK 1.32.1 source and test it: stdio's immediate write, HTTP's injected fetch after asynchronous header/auth preparation. Each tools/call message is tied to its operation fence; notifications needed only for cancellation/closure do not grant another tool call. If the stock transport cannot expose an equivalent boundary, report before substituting an admit-over-IPC approximation. No automatic retry of tools/call after any ambiguous send; route changes affect the next request only.

MAWS-owned instances are pooled by canonical directory, verified source generation and server identity, never server name alone. Startup is demand-driven and shared for concurrent requests. Maximum 64 direct connections; an over-cap request is unavailable rather than spawning unboundedly. With no in-flight operation, close after 5 seconds; do not keep a process merely because a watch will be due later. Hidden/closed work releases its demand. Close prevents late startup from re-registering a client; shutdown aborts work, closes streams, terminates an uncooperative owned child within 5 seconds and proves PID exit. Exclusive-resource failures stay unavailable/engine-only in the trusted status, not a retry storm or a fallback engine acquisition. No change to engine-owned server lifetime.

### OAuth custody and owner controls

Recommend `@modelcontextprotocol/sdk` **1.32.1**, the spike's exact root dependency, not v2 split packages. Main implements the SDK provider using an encrypted, versioned record file under `<userData>/connectors/`; create directories/files owner-only and replace atomically. SafeStorage encryption availability is required for both save and read. Store identity binds canonical server resource URL, server/config identity and discovered issuer. SDK issuer binding, resource indicators and PKCE remain authoritative; callback state is explicitly validated by MAWS. Do not invent discovery or token parsing that the SDK already supplies.

Main alone holds refresh tokens, registration information, verifier and safeStorage access. Host receives an access token only for an attested server generation and operation/connection lifetime; no secret rides an event broadcast, journal, diagnostic error, page result or renderer IPC. Refresh occurs only on demand while main is connected, serialized per server and saved atomically before releasing the refresh lock. No proactive timer. Host transports do not own a refresh provider or initiate a browser. Authentication failures park D as unavailable; a watch never opens consent. Revoke/Disconnect increments an in-memory credential generation before any await; late refresh/flow responses cannot save or start work under the old generation.

Flow states: `disconnected → connecting → connected`; cancellation/timeout returns disconnected, stored-grant failure becomes `needsReconnect`, and Disconnect from any state cancels the flow, blocks D and deletes local state. Reconnect is an explicit replacement flow under a new generation; a failed replacement does not revive withdrawn credentials. Bind the callback listener to `127.0.0.1`, random port, one outstanding flow per server, 120 s timeout; exact callback path, method, state and single-use code. No wildcard or localhost listener. Only user-initiated Connect/Reconnect may invoke the system browser. DCR unsupported means owner-visible unavailable/engine-only; manual client IDs and hosted CIMD are outside this child.

Add trusted **per-server rows inside H's existing Connectors sheet**, separate from per-tool Allow/Revoke. They show source/scope and direct connection state, with Connect/Reconnect/Disconnect as appropriate. Disconnect does not revoke artifact tool grants or touch route E's OAuth; copy says it disconnects MAWS only. The visual stance is adopted from H and X7/X32: compact operational rows, token-only light-default surfaces, existing Sheet/button weights, text status and visible keyboard focus; no new Settings panel or design system. At narrow widths controls wrap below their identity rather than compressing names off-screen. The page runtime and portable ArtifactHost need no OAuth methods.

## Plan of Work

### M1 — Attested source observations and journal permissions

Create `src/engine-host/connectors/provenance.ts` and its tests. Reuse the status identity logic in `status.ts` without changing H's fingerprint output. Capture the trusted live launch context through a narrow host-only seam in `session.ts`/launch wiring; observe full successful reports from `ConnectorCalls` before they are discarded. Implement conservative exact-entry lookup, per-launch replacement, ambiguity refusal and the lifetime above, consuming the architect's source ruling. Add an isolated provenance probe in the new direct e2e group to record user/local/project/dynamic omission cases; no owner config is read. The new group is registered with the lane-file procedure, not left invisible to the final gate.

In `journal.ts` and its creation caller, explicitly create the journal root/session directories as 0700 and base/rotated files as 0600. Add HD-owned mode tests with a permissive umask and verify unchanged faithful contents. Do not redact, read or chmod the owner's existing journal. Inspect existing-file behavior and report any broader migration need separately.

This milestone exposes `ConnectorStatusCache` and `VerifiedConnectorSource` to M2. It proves acceptance 3's lookup/refusal and 6's journal hygiene using scratch files, report fixtures, a remote no-model probe and unchanged H status/calls tests. It does not create an SDK client, persist status, touch grants or build OAuth.

### M2 — Host-local direct operations and owned transport lifecycle

Admit the pinned root SDK dependency and lockfile through the static lane gate. Add `src/engine-host/connectors/direct-calls.ts` and `direct-client.ts`, main's `direct-route.ts`, and the private command schemas/registrations. M1 supplies the verified source. Connections perform initialize and tools/list on demand; the live direct tool must still exist, and `readOnlyHint` must remain true for persistent reads/watches. A cached engine annotation is not current tool authority. Grant identity stays H's identity.

Implement the operation fence at actual SDK transport admission, once-consumption, retained-result invalidation, cancellation, timeout and main-disconnect cleanup. Main's route resolution is metadata-only; connection startup occurs only after main's grant check. Preserve all E commands and tests. Pin lifecycle with fake-clock unit tests and real stdio/HTTP fixture tests remotely; reject a non-JSON/oversized result through existing enums. This produces `createDirectRoute` and the host direct command family for M3/M4, and proves acceptance 3 and 5 including a second stdio instance's distinct PID and bounded exit. No browser flow or secret persistence yet; protected HTTP is unavailable until M3.

### M3 — Own OAuth, sealed store and per-server owner controls

Add main-only `oauth-store.ts`, `oauth-flow.ts`, `oauth-provider.ts` and their tests. Use M1's source identity and M2's private transport to supply only transient access credentials. Build the loopback flow, strict callback validation, generation cancellation, serialized refresh and encrypted atomic storage, with no token in owner-visible output. Add main-owned owner commands and the narrow trusted renderer adapter; extend H's existing sheet/tab state with separate server status/actions without changing the portable page API.

Tests exercise wrong/duplicate state, timeout, issuer/resource mismatch, refresh rotation, concurrent refresh, Disconnect racing refresh/callback, unavailable safeStorage and reload from sealed storage. Remote scratch Electron acceptance uses real app safeStorage, not a fake cipher; dependency-injected unit crypto proves only error/atomic-write logic. The test browser opener may follow only the fixture's loopback authorization URL, never a real account. Main grants and host transient tokens are cleared/cancelled with their respective lifetimes. This proves acceptance 4 and 6 and produces the owner command/state family consumed by M4. No Settings, manual client ID, engine auth repair or real-account delivery.

### M4 — Engine-first route selection and complete acceptance

Wire `createDirectRoute` after `createEngineRoute` in `src/main/connectors/index.ts`, preserving the broker's first-match selection and no retry after target.call. Extract only the canonical artifact-directory resolution necessary to share H's eligibility policy; keep H's creator/Space/project decisions unchanged. If an eligible engine appears after D was selected but before D's first write, return unavailable and let the next scheduled/explicit refresh select E; do not issue both routes. Ownership events invalidate direct state without reviving hidden watches.

Add `e2e/connectors-direct.spec.ts` and HD-owned support/fixtures alongside H's untouched scene/tests. Execute acceptance 1–6 as actual product behavior: header grant, E→D→E single-call transition, engine-less stdio/open HTTP/OAuth, source display and engine-only refusal, hidden silence, revoke/delete, ordinary quit and crash cleanup, sealed-grant relaunch and Disconnect. Assert fixture call and process logs, zero model/user prompts, engine counts, callback bind address and credential-free public output. Reuse H's HTML body and fixture semantics; avoid modifying H's assertions to accommodate D.

The last milestone runs the branch-wide gates, then the independently reviewed branch goes to the architect with exact evidence and remaining limitations. It does not merge master or expand E3's dataset contract.

## Interfaces and Dependencies — proposed for architect registration

These names are proposals until recorded in the P3 interface ledger. Internal names may be adjusted before registration, not silently after another child consumes them.

- **Host observation types:** `ConnectorLaunchContext {appSessionId, launchId, cwd, configFile}`; `VerifiedConnectorSource {sourceId, generation, cwd, server, scope:'user'|'local', path, entryPath, observedAt, entryDigest}`. Public status receives only safe provenance/state; raw read configuration stays host-local. `ConnectorStatusCache.observe(context, answer)`, `.resolve(cwd, server, tool)`, `.clear()`; returned tool identity is H's fingerprint plus readOnly. `sourceId` is opaque and does not authorize a call.
- **Private host commands:** `connectors.directResolve {artifactId, directories, server, tool}` returns safe ready/source/fingerprint/readOnly or a closed unavailable reason; `connectors.directStart {operationId,artifactId,sourceId,generation,server,tool,arguments,fingerprint,mode,credential?}` acknowledges immediately; `connectors.directTake {operationId}` and `connectors.directCancel {operationId}` mirror H's outcome/cancel shapes. `connectors.directClose {sourceId?}` invalidates a server or all direct work. A dedicated completion event `connectors.directOperation {operationId}` broadcasts no opaque data. These commands are main-only; credentials never enter the renderer registry's callable surface.
- **Main route:** `createDirectRoute(deps): DirectRoute`, with H's `ConnectorRoute` resolve/call contract and operationEnded/reconcile/hostLost/stop lifecycle. `selectConnectorRoutes(engine,direct)` means E before D; no target-call fallback. Prefer the existing ordered array if a named selector adds no behavior; final as-built row records the actual seam.
- **OAuth main modules:** `ConnectorOAuthStore`, `ConnectorOAuthFlow`, `ConnectorOAuthProvider`; identity-keyed version-1 encrypted records in a dedicated file, no artifact-store schema change. `connectors.servers {artifactId,servers}` returns verified-source and MAWS connection status to the trusted owner; `connectors.connect`, `.reconnect`, `.disconnect` take artifact/server identity and resolve the source in main/host, never a caller-provided URL or path. Connect starts a flow and returns promptly; owner state is read again for completion. Portable refusal enums and `ArtifactHost` remain unchanged.
- **Dependency:** root `@modelcontextprotocol/sdk: 1.32.1`, already independently probed under `spikes/p3-connectors/`. The implementation verifies transport and auth API details against this pin's source, not guessed SDK behavior.

### Shared-file touches by existing ledger row

| Ledger contract | Planned additive touches | Boundary |
|---|---|---|
| X23 final H connector row / X9 amendment | shared connectors IPC names/schema, engine-host connector registration, main connector wiring | HD-marked additions; H commands, outcomes and page API unchanged |
| X23 grants / X15 schema 2 | consume `ArtifactStore` fence/authorization APIs | no grant schema or migration; request architect ruling before any store contract change |
| X16 / final H eligibility | host live-launch context, main directory facts | exact canonical directories; no acquisition, retention or new session policy |
| X32 H Connectors sheet | renderer connectors owner adapter, sheet and tab state | tab lifetime, existing tokens, no direct use by artifact pages; coordinate F1 if overlap emerges |
| X8 / parent Decision 97 | journal creation and HD mode tests | permissions only, faithful unredacted contents unchanged |
| §7 integration and lane files | package.json, pnpm-lock.yaml, gate.yml CLASS1_E2E, host/main wiring and mocks if required | preserve sibling additions; static gate before lane push; no parent/ledger/tracker edits |

## Concrete Steps and Verification

All work runs only in the harness's isolated checkout. Shells begin `export pnpm_config_verify_deps_before_run=false`. Let `W=/Users/new/Developer/GitHub/MAWS/.claude/worktrees/agent-aba89ce32ee1e567e`; use absolute `git -C "$W"` and `pnpm -C "$W"`. Only named-file vitest, typecheck and eslint run locally, through `/tmp/maws-review/with-slot.sh`. The setup install is already complete. No local build, engine, GUI, e2e or measured bound.

For each milestone, run its named new tests and the unchanged H suites covering the touched seam, with the actual list recorded in Progress at its tick. Examples of the allowed form:

```sh
export pnpm_config_verify_deps_before_run=false
/tmp/maws-review/with-slot.sh pnpm -C "$W" exec vitest run src/engine-host/connectors/provenance.test.ts src/engine-host/connectors/status.test.ts
/tmp/maws-review/with-slot.sh pnpm -C "$W" typecheck
/tmp/maws-review/with-slot.sh pnpm -C "$W" exec eslint <explicit-changed-files>
```

Expected: all named tests pass; no type/lint diagnostics. Testable logic follows red/green; a fence test must fail when the final write guard is removed, not merely assert a helper was called. Each milestone gets `doperpowers:task-executor` then `doperpowers:task-reviewer`; the controller owns this document and gates. Findings are fixed through a worker. At most four direct workers, one implementation worker in the shared branch. No attribution lines in commits.

Merge current master before every gate when it moved. Root SDK lockfile and workflow group registration are lane-file edits: obtain class-1a static evidence on the rebased tree before pushing the lane change to a landing branch. `ci-gate`'s temporary evidence ref is the verification vehicle, not the landing push. A development gate names only the groups it exercises:

```sh
export pnpm_config_verify_deps_before_run=false
nohup "$W/scripts/ci-gate.sh" "$W" --class1a pool --runner macos \
  --gates static,unit,probes,unit:darwin,e2e:connectors,e2e:connectors-direct \
  --evidence --label hd-m1 > /tmp/maws-review/gates/hd-m1-ci.log 2>&1 &
```

Await in a separate background shell using `until grep -qE '^ci-gate: run [0-9]+ [a-z_]+$' /tmp/maws-review/gates/hd-m1-ci.log; do sleep 30; done`; no hand polling. Add artifacts/panel only when their exercised seams change. Mini jobs run one at a time; a queue wait over 30 minutes goes to the architect with run id. Register the new package script as `scripts/e2e-build.sh plain && …` like its neighbours, with an explicit opt-in test guard; add `connectors-direct` to CLASS1_E2E via the lane procedure. H's soak is inherited evidence, not repeated by default; HD's own actual idle/disconnect bounds are measured remotely.

After whole-branch independent review is clean, run once with no `--gates`, `--class1a pool --runner macos --evidence --label hd-final`, obtaining class 1a, Darwin and the whole class-1b set. Report raw conclusions and any architect-accepted baseline dispositions separately. A post-accepted-gate fix follows gate-offload Decision 56's named-group rule. No paid run; any need for a model turn is a blocker requiring architect approval.

Hand-back includes final HEAD, merge-base, gate run ids/counts, cost (expected US$0), as-built names and explicit omissions. The architect owns landing; this child never merges to master.

## Surprises & Discoveries

- Current retained status evidence reports source labels, not paths. Evidence: spike engine-mcp-call.jsonl seq 5: `scope:user,source:user`; project/dynamic likewise. A project label alone cannot prove which ancestor file supplied it.
- Journal creation lacks explicit modes. Evidence: `JournalWriter` calls `mkdirSync(dir,{recursive:true})` and `openSync(path,'a')`, including rotation. Decision 97 requires an actual code/test addition, not a claim that the default umask is private.
- The requested E2 sibling execution document is absent at this worktree's pin. The full interface ledger was read by the orientation worker; E's available composite supplies consumer contracts while the architect supplies the sibling precedent. E3's direct-route acceptance depends on HD despite the older E2+H predecessor list; reported as parent impact.

## Decision Log

1. **2026-10-17 (P3-HD executor): verification.** One independent `doperpowers:adversarial-reviewer` reviews this execution document against the parent and H seams before disputed contracts are built. Per-milestone task reviews precede downstream consumption. Whole-branch review uses the high rung at minimum; if the integrated OAuth/IPC/transport diff warrants panel scope, send the range to the architect for xhigh review rather than pretending one reader covered a panel-sized branch. Acceptance and gates above remain mandatory. Rejected: treating the spike's SDK demonstration as production custody/fence proof.

## Outcomes & Retrospective

Pending — written at finish.
