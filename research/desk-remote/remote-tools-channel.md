# The engine's remote-tools channel, and whether MAWS can use it

This is for the MAWS–Desk merge. In the remote layer design (MAWS PR #183, §3.1), a lane B session's Query runs on the session's own machine. A few MAWS tools belong to the client app, though: the agent-driven in-app browser tab, its screenshots, and notifications. The question was whether the engine's remote-tools channel could offer those from an attached app. MAWS does not patch the engine (charter D-1).

This is code reading on the 2.1.309 reprint, with 2.1.310 and 2.1.311 checked. Nothing was run. A sol-xhigh subagent of `remote-architecture` did the reading, and that session wrote this note from its hand-back. The admission gate was spot-checked at 309 L852241.

## Short answers

1. **The channel exists, but an ordinary local SDK host can't use it in these builds.**
   - **What it is.** An admitted cloud worker can learn about tools served by an attached client process. The wire operation is `remote_tools_announce`. It registers a client `instance_id`, a machine description and three tool lists, and the worker addresses calls to that instance over the session channel. The announcement carries no network endpoint, so a hop from the MAWS daemon to the app would still be MAWS's own.
   - **Why MAWS can't use it.** The local print dispatcher refuses the operation unless the launch was admitted as a managed cloud worker. The embedded SDK Query also leaves the four serving-side request types unanswered.
   - **I**, [announcement schema](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L913882), [admission](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L852241), [production inputs](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L852522), [local dispatcher](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L857184), [the Query's deliberate non-handler](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L412525).
2. **Withdrawing removes the tools; going silent doesn't, at least not at once.**
   - **Withdrawal.** An empty announcement withdraws the old instance. It settles that instance's outstanding legs as host-gone, withdraws its inherited requests, and ends its pending permission asks.
   - **Displacement.** A new instance announcing the same machine displaces the old one.
   - **Silent loss.** The roster stays. Calls and liveness probes time out, the machine is marked offline, and uncertain calls can be settled by outcome queries. There is no lease that expires an announcement.
   - **Recovery.** Re-announcement, process identity and two separate epochs prevent several stale-owner and restart mistakes.
   - **I**, [registry](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L34147), [withdraw and displace effects](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L203209), [transport liveness and deadlines](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L606705), [outcome interpretation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L440399).
3. **A call is a correlated, permission-aware, versioned exchange, not a generic callback.**
   - A stable `call_id` runs across delivery, permission legs and outcome queries, and each leg has its own control `request_id`.
   - The serving side validates the envelope, the input, refused fields, the session binding, the deadline and its own permission policy.
   - It may answer `needs_approval`, and the session then sends a second leg carrying the answer.
   - Native tools, MCP passthrough tools and plumbing have different roles.
   - **I**, [call schema](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L913882), [protocol and result union](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L195845), [serving admission](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L887141), [permission legs](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L157917).
4. **It is gated several ways, and no initialize capability opens it.**
   - **Launch.** The first gate needs an SDK URL and a remote session id, with no environment kind, an allowed entrypoint, the session channel on, and a non-hermetic launch.
   - **Forwarding.** The admitted handler then needs the forwarding switch and an account flag.
   - **Ingress and adoption.** Cloud ingress checks device attestation, and MCP passthrough adoption has policy checks of its own.
   - These gates are all still there in 2.1.310 and 2.1.311.
   - **I**, [309 admission](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L852241), [switches](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L22917), [account flag and policy](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L203285), [attestation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1139258), [310 admission](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L1035307), [311 admission](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L501685).

**What this means for MAWS.** Don't make this private cloud-serving channel a dependency of the daemon-local Query.
- Under D-1, advertise the transport as unavailable. Don't patch admission, present a local session as a managed cloud worker, or assume that setting the forwarding flag is enough.
- An ordinary MCP adapter in MAWS's own tool server, relaying to the attached app, is a separate candidate. The remote layer design adopts it (§3.1). This inspection didn't implement or verify it.
- **I**, a recommendation grounded in the launch admission and Query behaviour above.

## Evidence and boundaries

**I** means inspected code, or an inference explicitly grounded in it. Nothing here was measured at runtime: no spike ran and no Claude session was launched. 309, 310 and 311 below mean the respective `/Users/new/claude-code-bundle/2.1.xxx/cli.pretty.js` reprints.

**Locators.** `309:L455548` is the cloud host-routing mapper, not the local print dispatcher ([lane-b-control-map.md](lane-b-control-map.md#L48)). The print branch is `309:L857184`. It exists, but behind an admission gate. A subtype appearing in a schema or mapper doesn't prove a local SDK host can use it. **I**, [cloud mapper](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L455542), [print branch](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L857184).

**Which SDK.** The Query examined is the one embedded in the bundle. Its `processControlRequest` stays silent on purpose for `remote_tool_call`, `remote_plumbing_call`, `remote_tools_probe` and `remote_tools_reannounce`, because another attached serving client is meant to answer them. **I**, [request set](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L245107), [Query](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L412525).

## Announcing and publishing tools

The announcement is an ordinary control-request envelope. This is a wire sketch, not a public SDK method:

```ts
{
  subtype: 'remote_tools_announce',
  instance_id: string,
  worker_epoch?: number,
  host: {
    name: string, kind: 'personal_machine' | 'sandbox',
    platform: string, working_dir: string, epoch: string,
    limits: { max_call_ms: number, max_request_bytes: number, max_in_flight: number /* , optional others */ },
  },
  tools: [{name, refused_input_fields, protocol_versions, description?, input_schema?}],
  passthrough: [{name, local_name, input_schema, description?, annotations?, hints?}],
  plumbing: string[]
}
```

**Validation.**
- All three lists are required. All three empty means withdrawal; an omitted list is a parse error.
- `host.epoch` is required.
- The announcement is capped at 1 MiB and depth 32.
- At most 16 native descriptors are accepted. At most 256 passthrough descriptors are kept, from an input capped at 1024.
- The acknowledgement carries `status`, `worker_epoch`, the negotiated `protocol_version` (or null), and the adoption and ignored-tool fields.
- **I**, [schema](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L913882), [validation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L203220), [entry parser and limits](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L196016).

**The three lists have different roles.**
- **Native `tools`** are only the engine's recognized remotely executable built-ins. Giving an arbitrary name a schema doesn't make it executable. **I**, [native-name set](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L34065), [registry filter](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L34168).
- **`passthrough`** describes the serving machine's own MCP tools, named `<server>__<tool>`, with `local_name` naming the serving-side tool. The worker builds model-facing MCP tools from them and routes their calls back. The worker-side implementation throws if routing is bypassed. The app's browser, screenshot and notification tools would belong here, if the channel were available. **I**, [parser](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L196029), [publication](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L203158), [serving-side MCP execution](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L788392).
- **`plumbing`** is never shown to the model. It is engine machinery; the caller recognizes `sync_files`. It is not an open RPC registry. **I**, [recognized plumbing](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L34065), [caller restriction](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L606651).

## When the serving app goes away

- **Explicit withdrawal.** The client re-announces with all three lists empty.
  - The registry removes the machines that instance owns and advances its tool generation. An old instance cannot remove a machine a newer instance now holds.
  - The worker cancels outstanding legs with the host-gone reason, withdraws inherited requests, and ends pending permission asks.
  - None of this rolls back effects that already happened on the client.
  - **I**, [registry ownership](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L34168), [worker cleanup](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L203209), [pending-request cancellation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L459904).
- **Silent disappearance.** Nothing deletes an announcement on disconnect, and it has no TTL. Online state and tool membership are separate.
  - Before a call, the transport probes a machine that is offline, stale, or unheard from for over 60 s, with a 10 s probe deadline. A missed probe marks it away.
  - Feature-gated recovery checks run about 30 s, 2 min and 5 min after that, with 20% jitter.
  - **I**, [liveness](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L606705), [probe](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L607029), [registry state](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L34216), [away rechecks](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L441280).
- **What the model sees.** Publication doesn't filter offline passthrough entries. After a silent loss their definitions stay visible, next to context saying the machine is unreachable. After a withdrawal they leave the next tool list, but nothing rewrites history. **I**, [publication](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L203158), [offline status context](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L441567), [passthrough routing](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L158397).
- **Calls in flight.**
  - The defaults are 4,128,768 maximum request bytes and a 58,000 ms leg deadline.
  - The delivery states are kept apart: queued or unsent, refused, unresolved upload, dropped stream, answered, timed out.
  - A host advertising `progress_checks` can leave a delivered call standing at the deadline while the session asks `outcome_of`, instead of replaying it. The defaults are 20 s intervals, two misses, a 30 s reconciliation budget and a 120 s ask lapse.
  - A timeout never proves that nothing ran.
  - **I**, [transport defaults and delivery states](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L606705), [deadline settling](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L606843), [standing calls](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L440246), [progress defaults](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L195661).
- **Three identities.**
  - `instance_id` is the serving process. It stays the same across that process's reconnects, and a new instance takes over the machine.
  - `worker_epoch` is the engine worker's life. A mismatch gets `stale_worker_epoch`. A replacement worker can ask once for a re-announcement, at most once per 10 s.
  - `host.epoch` is the serving runtime's life. An `unknown_call` under the same epoch means the call wasn't received. Under a different epoch it means the host restarted, which proves nothing about effects.
  - **I**, [replacement](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L203278), [epoch check](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L203233), [re-announce request](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L222456), [client checks](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L143916), [restart warning](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L440630).
- **The bundled client's choices.** It re-announces on worker init, on reconnect and on tool changes. It waits 15 s, with bounded backoff, and withdraws on a best-effort 1.5 s wait. These are the client's choices, not a lease on the worker side. **I**, [announcer](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L143504), [withdrawal](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L143662).

## Lifecycle of one call

1. **The session routes and validates.** It checks gates and protocol, parses the input, and applies its own permission rules, which can refuse or ask before the machine is contacted. **I**, [routing](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L158302), [ask-first path](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L157814).
2. **A leg is sent.** `remote_tool_call` carries `{instance_id, host, name, input, envelope, tool_use_id, issued_at, deadline_ms}`.
   - `call_id` equals the tool-use id and is the run-at-most-once key.
   - Clients that don't own the addressed instance stay silent.
   - **I**, [wire construction](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L606810), [parser](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L196061).
3. **The serving client admits it or not.** It checks size, protocol, tool, session binding, trust and attestation, readiness and capacity.
   - A delivery's age comes from the session service's clock.
   - A late new leg is refused as stale. The grace is 5 s for a first leg and 30 s for others.
   - **I**, [age handling](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L148445), [serving wrapper](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L148621), [admission](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L887141).
4. **Refused fields and permissions.**
   - A truthy refused input field is rejected, and false or empty values are stripped. `_host` is refused if it reaches the serving tool.
   - The serving machine's own permission rules and hooks still apply, and it may suspend with `needs_approval`.
   - **I**, [schema omission](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L887467), [field check](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L266680), [ask suspension](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L886942).
5. **A second leg carries the approval.** It is `approval: {ask_id, decision, updated_input?, feedback?, permission_updates?}`.
   - The server checks the ask, call and input fingerprints, so an approval can't be turned into a different call.
   - Denial, or a missing prompt handler, never authorizes the call.
   - **I**, [ask payload](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L218157), [session handling](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L157917), [approval validation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L886725).
6. **The result comes back as `{result: CallToolResult}`,** with the envelope under `structuredContent['anthropic/remoteToolExecution']`.
   - The outcomes are `completed`, `refused`, `failed`, `needs_approval`, `acknowledged` and `in_progress`.
   - A malformed reply, a mismatched reply, or an error-shaped control response doesn't count as an answer.
   - Outcome queries never re-run the call.
   - **I**, [result union](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L195875), [reply acceptance](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L606923), [result parsing](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L196088).

**Protocol versions.** The call-envelope protocol is v1, negotiated by intersection. With no common version, the machine stays listed but can't be called. **I**, [wire constants](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L195656), [negotiation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L195924).

## Gates

| Gate | Behaviour |
|---|---|
| Worker launch | An SDK URL, `CLAUDE_CODE_REMOTE_SESSION_ID` set, and `CLAUDE_CODE_ENVIRONMENT_KIND` absent. Otherwise `not_managed_cloud_worker`. |
| Entrypoint | Absent, or one of `remote`, `remote_projects`, `remote_desktop`, `sdk-cli`, `''` or `remote_mobile`. |
| Channel / hermetic | The session channel must be on. Hermetic launches are refused. |
| Forwarding | `CLAUDE_CODE_REMOTE_TOOLS_FORWARD` true, plus the account flag `tengu_violin_wood`. An unsettled flag answers `remote_tools_not_ready` after up to 5 s. |
| Passthrough | The MCP adoption switch, org MCP policy, server state, sendable schemas, and admissible names. |
| Cloud ingress | Service-provided device attestation. Announcements below the floor are dropped unanswered. |
| Initialize | No opt-in exists. `attachServeRequest` is specific to Desktop's `--attach-serve` helper. |

**I**, [launch and entrypoint](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L852241), [entrypoint set](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1139492), [forward switch](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1221821), [channel and adoption switches](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L22947), [account and policy](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L203285), [attestation](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L1139258).

## 2.1.310 and 2.1.311

**I.** No opening for local hosts was found. Both builds keep these unchanged:
- the admission gate and the print branch's refusal;
- the schemas;
- the Query's silence on serving requests;
- the withdrawal logic;
- the 58 s deadline;
- the fingerprint check on approvals.

| Surface | 2.1.310 | 2.1.311 |
|---|---|---|
| Admission | [L1035307](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L1035307) | [L501685](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L501685) |
| Print announce branch | [L1040257](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L1040257) | [L506681](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L506681) |
| Announce worker and policy | [L463775](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L463775) | [L640961](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L640961) |
| Schemas | [L796051](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L796051) | [L335502](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L335502) |
| Query skips serving requests | [L581491](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L581491) | [L211115](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L211115) |
| Session transport and defaults | [L802755](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L802755) | [L865537](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L865537) |
| Approval cannot change the call | [L1046341](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L1046341) | [L56447](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L56447) |

One publication difference: 310 and 311 add a conditional pinned `standardKey` on composed passthrough tools. It doesn't touch the gates. **I**, [309](/Users/new/claude-code-bundle/2.1.309/cli.pretty.js#L203176), [310](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L463753), [311](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L640939).

## Spike plan (not run)

### Stage 1: test the real MAWS launch for the gate

This small test decides whether the channel can serve the design at all.

1. **The harness.** Put it beside, not inside, engine data, using [media-spike/harness.py](media-spike/harness.py#L30) as the local SSE stub example. Run it with `python3 -I` from a neutral directory, and never patch or import `cli.pretty.js`.
2. **The run root.** Use a fresh `/private/tmp/maws-remote-tools-<id>`, holding `home`, `config`, `work`, logs and captures. Launch the installed 2.1.310 and 2.1.311 by absolute path, recording the hash and argv.
3. **The environment.** `env -i`, with:
   - an isolated `HOME`, `CLAUDE_CONFIG_DIR` and `TMPDIR`;
   - a dummy key, `ANTHROPIC_BASE_URL` pointing at the stub, and `ANTHROPIC_MAX_RETRIES=0`;
   - updater, telemetry, error reporting and nonessential traffic off;
   - a dead loopback proxy, with `NO_PROXY` set to loopback;
   - no inherited OAuth tokens, plugins, MCP servers or hooks.

   The owner's daemon and sockets stay untouched.
4. **The stub** records every request and answers with canned SSE. Unexpected paths fail closed. Any request leaving loopback fails the run.
5. **The session.** Spawn `--print --input-format stream-json --output-format stream-json --verbose` with stdin open, initialize it, and send controls with unique ids.
6. **The announcement.** Send a valid one: host `maws_app`, the limits and epoch, empty native and plumbing lists, and one passthrough `maws__probe` (`local_name: 'mcp__maws__probe'`). Test separately:
   - an all-empty withdrawal;
   - a recognized native descriptor;
   - an unknown native descriptor.
7. **The matrix.** Repeat the valid case with the forwarding switch on and off, and with an allowed entrypoint. Keep the SDK URL and remote identity absent in the primary matrix. One case may set only a synthetic remote id, to show that alone is not enough. It must contact no service.
8. **The tool list.** Capture the next request body and confirm that no app tool entered `tools[]`. Optionally return a canned tool-use naming it, and confirm the app is never invoked.

**Keep for every case:** the argv and environment allowlist, the binary identity, the control request and response, its latency, the initialize result, every stub body, the published tool names, and the app's invocation count.

**Pass or fail.**
- **Pass:** the source reading holds if the local stdio launch returns `remote_tools_disabled: not_managed_cloud_worker`, publishes no app tool, and sends nothing to the app. That closes the channel as MAWS's transport.
- **Inconclusive:** a malformed announcement, a feature-flag dependency, or an unexpected HTTP dependency.
- **Falsified:** a genuine local success would contradict this note. Trace it before relying on anything.

### Stage 2: the lifecycle matrix, only if an unpatched, legitimate path admits it

Stop and record "blocked" in either case:
- the admission would need a hosted account, device attestation, a patch or forged attestation;
- inference would leave the stub.

A serving fixture journals every call id, so duplicate execution shows. Test:
- the published tool list;
- protocol mismatch and unknown or bad entries;
- permission allow, deny and the no-handler case;
- refused fields;
- redelivery and outcome queries;
- idle withdrawal, withdrawal mid-call, and withdrawal mid-approval;
- silent loss of the fixture process;
- late responses, at the 58 s deadline and with `progress_checks`;
- reattaching as the same instance and as a new one;
- worker restart, epochs and the re-announce rate limit;
- serving restart;
- flags and policy turned off.

A row passes only when both the control semantics and the observed effects match.

### Cleanup and the decision

Stop only the pids the harness recorded, close the stub, and remove env files. Touch only a daemon socket derived from the run's own config dir. Keep captures under the run root.

If stage 1 confirms the source, this candidate is closed for the unpatched engine, and the plain MCP proxy to the attached app is evaluated on its own.
