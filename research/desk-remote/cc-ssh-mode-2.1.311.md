# Claude Code 2.1.311: what its SSH plumbing supplies

This is for the MAWS–Desk merge (remote layer design, MAWS PR #183). It was read statically: no bundle, app or tool was executed. A sol-xhigh subagent of `remote-architecture` did the reading, and that session wrote this note from its hand-back.

**Short answer.** This bundle has SSH-aware plumbing inside the engine, not a remote-session service MAWS could switch on.
- **The useful part** is an unchanged Claude Code process on the remote machine, driven over the ordinary stream-json protocol.
- **`ANTHROPIC_UNIX_SOCKET`** can also route that process's model requests through a socket forwarder someone else supplies. It carries no prompts, no permission answers and no replay.
- **The other two names are not connection APIs.** `sshRemoteSessions` is Desktop configuration metadata, and `ssh_session_connect` is a telemetry feature name.
- **I**, [socket routing, 311:634526–634546](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L634526), [Desktop schema, 311:421868–421877](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L421868), [feature-name roster, 311:914044–914065](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L914044).

**For MAWS, under D-1:**
- Keep process ownership, reconnect and replay in MAWS's machine-side holder, outside Claude Code.
- Run an unpatched engine there and use its stream-json controls.
- Treat the Unix-socket inference route as an optional way to route credentials, not as the remote layer.
- Nothing here removes the need for an external process owner.
- **I**, a recommendation.

`311:L…` means `/Users/new/claude-code-bundle/2.1.311/cli.pretty.js:L…`, and `310:L…` the 2.1.310 reprint.

## 1. What the four names are

- **`ssh-remote` is a `CLAUDE_CODE_ENTRYPOINT` value.** It feeds two classifications: attended versus remote host, and remote-relay marking. In the auto-mode provider classifier, a first-party session using a Unix socket counts as first-party only with this marker. It is not an SSH login, and not proof of where the socket leads. **I**, [311:797937–797975](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L797937), [311:101172–101195](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L101172).
  - **A release boundary.** A thin-client SSH adapter remains. It expects a session object with `proc`, `createManager`, `getStderrTail` and optional `proxy.stop`. But the normal entrypoint sets its pending connect and SSH values to `undefined`, and the command builder registers no `ssh` command. So `claude ssh` isn't available in this executable, and the SSH launcher, tunnel and session manager can't be read here. **I**, [311:809614–809644](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L809614), [command registration, 311:809639–809743](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L809639), [adapter, 311:1096749–1096763](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L1096749).
- **`ANTHROPIC_UNIX_SOCKET` routes API traffic; it is not the session wire.** With it set, API fetches use Bun's `unix:<path>` instead of TCP, ahead of any proxy routing. **I**, [311:681157–681175](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L681157), [311:634526–634546](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L634526).
  - **The credential-proxy form** needs the socket plus exactly one of `CLAUDE_CODE_OAUTH_TOKEN=ssh-placeholder` or `ANTHROPIC_API_KEY=ssh-placeholder`, and no `ANTHROPIC_AUTH_TOKEN`. It then sends policy limits to `http://localhost/api/claude_code/policy_limits` over the socket, without local auth headers. **I**, [predicate, 311:1208241–1208245](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L1208241), [recognition, 311:1056648–1056654](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L1056648), [policy endpoint, 311:682551](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L682551), [policy connection, 311:688276–688388](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L688276).
- **`sshRemoteSessions`** is the `betaFeatureKey` on Desktop's `codeSurface` fields `sshHostAllowlist`, `sshClientPath` and `sshTransport`, all with `executionTarget: "desktop"`. **I**, [311:421868–421877](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L421868).
- **`ssh_session_connect`** is in the roster of feature names for `tengu_feature_ok`, `_bad` and `_sad` telemetry, beside `ssh_auth_proxy_start`, `ssh_deploy` and `ssh_probe`. It has no control handler. **I**, [311:914044–914065](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L914044).

## 2. Who drives what

**I.** The local terminal UI is a thin client. It gets a manager from the supplied SSH session object, and through it sends user messages, interrupts, permission answers and control requests. The remote engine sends back frames and permission requests. The agent loop, files and tools are the remote engine's. **I**, [311:1095275–1095304](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L1095275), [311:1095406–1095462](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L1095406), [311:1027429–1027442](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L1027429).

```text
Local machine                         SSH host
UI / SDK host  -- prompt + controls --> Claude Code engine (agent loop, tools, files)
               <-- JSONL events/asks --
                 [session channel]
auth forwarder <---- forwarded HTTP --- Unix socket <-- model/API requests
     +-- authenticated HTTPS --> Anthropic API
                 [separate inference channel]
```

**I, inferred.** The engine names the policy destination as the "local machine (via claude ssh tunnel)". The adapter records `hostUsesLocalCredentials`, and the launcher injects the credential. That is a split: local credentials, remote engine. No particular `ssh -R` command or daemon protocol is visible. **I**, [311:688282–688299](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L688282), [311:1096761](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L1096761), [311:689201–689229](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L689201).

## 3. Authentication: three boundaries

1. **The SSH host.** The external SSH client authenticates the connection and checks the host. Neither the entrypoint marker nor the socket does either.
2. **Model and API.** In the socket-proxy arrangement, the remote process holds `ssh-placeholder`, and the local forwarder authenticates. The placeholder is not a secret, and not a credential for the session channel. **I**, [311:908369–908383](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L908369), [311:688364–688389](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L688364).
3. **Org policy.** The forwarder may return `x-claude-code-tunnel-credential-epoch`. The engine uses it to notice a changed credential and fetch policy again. It is not a replay sequence. **I**, [311:901075–901087](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L901075).

**Two constraints.**
- `allowedProviders` can't admit a tunnelled Unix-socket session, because the destination can't be pinned. Machines that must accept such sessions need it unset. **I**, [311:899836–899838](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L899836).
- The route is set at launch. With the socket set, the settings-environment filter strips the socket, base-URL, key and token overrides, so a settings update can't repoint it. **I**, [311:926899–926907](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L926899).

## 4. Dropped links and restarts

**I. The socket route adds no durability.** It has no process owner, replay ring, input offsets or adoption.

| Event | What the unpatched engine supplies | What it doesn't |
|---|---|---|
| The client link drops while a machine-side holder keeps the engine alive | Turn and pending-ask state stay in the process. Re-`initialize` returns the pending permissions and dialogs ([311:507085–507099](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L507085)). | No replay of lost stdout. The holder must do it. |
| The inference tunnel drops | Ordinary API retry. A restored socket serves later requests. | No exactly-once handover of a request in flight. |
| The local UI restarts | No CLI SSH adoption is exposed. | Desktop's adoption isn't implied by the CLI's marker. |
| The remote engine restarts | `--resume` or `--continue` from the saved conversation ([311:925554–925557](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L925554), [311:810222–810243](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L810222)). | Not adoption of the live process. Its in-memory pending requests are gone. |

Reinitialize reconciles state with a survivor. Resume is a new process using saved state. Neither is a stdout replay protocol.

## 5. Relation to Desktop's `claude-ssh`

**I. It is not the same thing seen from the other end.** What the two share is the engine and its SDK protocol.
- **Desktop's helper** is a separate remote daemon. It serves JSON-RPC `process.spawn`, `process.stdin` and `process.reattach`, sends seq-numbered stdout, and mirrors transcripts over SFTP.
- **The CLI's Unix socket** is an inference path, not that daemon's `rpc.sock`.
- **Desktop's resilience** belongs to the helper: survivors across a dropped link or a Desktop quit, replay, stdin offsets, checkpoint adoption.
- **I**, [helper overview](desktop-ssh-helper-protocol.md#L37), [methods](desktop-ssh-helper-protocol.md#L97), [ownership and restart](desktop-ssh-helper-protocol.md#L76).

## 6. What MAWS can use without patching

| Piece | What it does | Usable unchanged? |
|---|---|---|
| A `claude -p` stream-json child on the machine | The real agent loop and tools | **Yes.** The machine daemon and holder own it. |
| Public control requests and the engine's permission and dialog requests | Session operations | **Yes**, with capability checks per the lane B map. |
| Pending requests redelivered on re-`initialize` | Pending asks of a live engine | **Yes.** De-duplicate by request id. |
| Transcript persistence and `--resume` | Restart from saved state | **Yes**, as a fallback, not as live adoption. |
| `ANTHROPIC_UNIX_SOCKET` | API fetches over a Unix socket | **Yes, through the launch env.** MAWS supplies and secures the forwarder. A possible route for per-member credentials on a shared machine. |
| The placeholder credential-proxy convention | The engine trusts a forwarder for credentials and policy | **On the engine side, yes.** The proxy is MAWS's to build, and org policy applies. |
| `CLAUDE_CODE_ENTRYPOINT=ssh-remote` | SSH-aware classification | **Recognized**, but not a transport or attestation. Don't use it to dodge policy. |
| `sshRemoteSessions` and the `ssh*` fields | Desktop config metadata | **No.** |
| `ssh_session_connect` | Telemetry name | **No.** |
| The CLI's internal SSH thin-client adapter | Drives the TUI from a supplied manager | **No.** It has no public activation path, and wiring into it would be an engine change. |
| Desktop's `claude-ssh` | External ownership, replay, adoption | **Not from the CLI.** A MAWS-owned equivalent is D-1-compatible; that is the holder design. |

## 7. Already in 2.1.310

**I.** Yes, all of these pieces were already there:
- `ssh-remote` classification: [310:168085](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L168085);
- socket routing: [310:744114](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L744114);
- the placeholder predicate: [310:53366](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L53366);
- the policy socket: [310:884068](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L884068);
- the Desktop metadata: [310:1149499](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L1149499);
- the telemetry roster: [310:103596](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L103596);
- the adapter: [310:1200029](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L1200029);
- the undefined SSH values at the entrypoint: [310:929117](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L929117).

The 2.1.311 changelog names no SSH change. It does fix `-p`/SDK transcript ordering and background-service restarts, which matter for lane B hosting ([changelog](/Users/new/claude-code-bundle/2.1.311/notes/changelog-2.1.311.md#L11)).

**Tool note.** `grep` in this shell resolves to ugrep. It missed identifiers on the reprint's very long lines and hit its complexity limit on wide patterns, while `/usr/bin/grep` found the exact names.
