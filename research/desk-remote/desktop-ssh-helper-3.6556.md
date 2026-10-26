# Claude Desktop SSH mode: changes in 3.6556.2

**Short answer.** Yes, there are material changes since the 2026-10-19 reference. Desktop 3.6556.2 pins a new helper, hardens RPC framing, changes how OpenSSH links are judged silent, persists undelivered interrupts, and adds recovery and deployment safeguards. The core sequence-number replay, stdin-offset de-duplication and line-aligned checkpoint contract has not materially changed. Keep that part of the reference for the MAWS–Desk remote layer; update its liveness, adoption and deployment sections.

## Build and method

Compared the installed `/Applications/Claude.app` **3.6556.2** with the reference's **app-2.42304.0**, not with the intervening 2.42304.2 build.

- Copied the installed asar to `/Users/new/claude-desktop-re/ssh-3.6556.2-20261026/archive/app.asar` and extracted its packed files into the separate, initially empty `extracted/` directory beside it. Asar sha256: `b2dfbbb40325d978dcb7561ad12a6f9bc199f8f46b7d3d2897af74ce8965d68a`. The installed app was not modified. Eight unpacked/link entries were not materialized; they are outside the JavaScript comparison.
- All **491 JavaScript files** in the newly extracted `.vite/build/` are byte-identical to the earlier 3.6556.2 extraction under `/Users/new/claude-desktop-re/extracted/app-3.6556.2/`. The citations below therefore use that build's existing readable tree. This is a source-file comparison, not an assertion that the earlier archive itself has the same hash.
- Downloaded the new pinned linux-amd64 helper, checked its compressed sha256 and size, and inspected ELF strings, Go function names and disassembly. **Neither helper was executed.** The new artifacts are under `/Users/new/claude-ssh-helper-inspect/be1c1ca-20261026/{download,binary,static}/`.
- Static analysis only. Extracted/downloaded contents were treated as data; Python ran with `-I`. JavaScript comparison used the trusted parser outside the extracted trees. Native instruction comparisons disregard relocation addresses; they do not establish runtime interoperability. No remote host, Windows helper, or newly pinned remote CLI was run.

**Citation prefixes.** New files are under `/Users/new/claude-desktop-re/readable/app-3.6556.2/main-process/`; `old` means the corresponding file in `readable/app-2.42304.0/main-process/`.

| Prefix | Readable file |
|---|---|
| R | [index.chunk-CyQStuDv.js](/Users/new/claude-desktop-re/readable/app-3.6556.2/main-process/index.chunk-CyQStuDv.js) — RPC client, remote process, controller |
| D | [index.chunk-DiYrspRo.js](/Users/new/claude-desktop-re/readable/app-3.6556.2/main-process/index.chunk-DiYrspRo.js) — SSH engines and deployment |
| S | [index.chunk-DNPOm2Zc.js](/Users/new/claude-desktop-re/readable/app-3.6556.2/main-process/index.chunk-DNPOm2Zc.js) — session manager and held sends |
| A | [index.chunk-CnJGgnqv.js](/Users/new/claude-desktop-re/readable/app-3.6556.2/main-process/index.chunk-CnJGgnqv.js) — adoption decision |
| V | [index.chunk-DBIg6EBr.js](/Users/new/claude-desktop-re/readable/app-3.6556.2/main-process/index.chunk-DBIg6EBr.js) — session-record validation and owed interrupts |
| P | [index.chunk-jPKPzV-P.js](/Users/new/claude-desktop-re/readable/app-3.6556.2/main-process/index.chunk-jPKPzV-P.js) — pins and feature constants |
| BIN | `/Users/new/claude-ssh-helper-inspect/be1c1ca-20261026/static/{syms,dis,strings}.txt`; symbols below omit `github.com/anthropics/claude-ssh/internal/` |

## 1. Pins

| | Reference | 3.6556.2 |
|---|---|---|
| Helper commit/version | `683cc6a9cd1d99430efd762587e02dd076fd5ada` | `be1c1ca50b7b27c5f9341e4cbabc2039588fe597` |
| linux-amd64 `claude-ssh.zst` sha256 | `385678d25ecfe342642a14b0f90357ebe928ccea24c7b63a2282428aca2759de` | `de868c3e08217de7edc4e0785f22a99e68e20d870ab56493cc0169493f9a2c25` |
| Compressed size | 2,912,875 bytes | 2,929,890 bytes |
| Remote CLI pin | 2.1.299 | 2.1.308 |

Evidence: old `index.chunk-muI2IV6k.js:97809–97929`; P:101492–101622. The helper checksums for all six platforms changed. The verified new URL was `https://downloads.claude.ai/claude-ssh-releases/be1c1ca50b7b27c5f9341e4cbabc2039588fe597/linux-amd64/claude-ssh.zst`. Its **decompressed** binary is 8,278,200 bytes, sha256 `81bfff0aa692c907f39720be082b9f926418e3cf306e048a3081fb5e22d5689c`; this is not the manifest's compressed hash.

## 2. Desktop ↔ helper RPC

### Desktop calls more of the existing helper surface

Two methods absent from the reference's Desktop call table are now called. They already existed in the old helper; these are new Desktop uses, not new process-protocol methods.

- **`files.realpath`** is used when SFTP is unavailable, including `{path, missingLeaf:true}` and the result fields `{exists, real, wouldBe}`. `callRealpath` retries `too_many_links` up to five attempts, 100 ms apart, within the original deadline. R:12721–12774, 12820 onward.
- **`server.shutdown`** is called with a 5 s timeout if deployment fell back to an older helper that lacks required capabilities. The shutdown is under `!pt`: the connect started the daemon rather than reattaching to an existing one. This is not a new policy of shutting down every old daemon. R:9099–9127.
- **`files.read`** can now send `real:true`; Desktop checks the returned `real` against the requested name and can report that it moved. It also recognizes the existing `files.read.real` feature. R:12579–12603; P:229278. The old helper already contains this feature string.

### The envelope and reader are harder to confuse

- **Normal request IDs are no longer bare integers.** Each connection has a random 32-byte key. `wireId(N)` is `HMAC-SHA256(key, String(N))[:32] + "-" + N`. Replies must reproduce a locally generated ID; an object with a `method` is rejected as an echoed request, not accepted as its response. Old client: `id:N` at old `index.chunk-DK8QSLgC.js:1391–1409`; new R:1205, 1661–1682, 1863–1929.
- **Before the first valid reply, shell noise can precede a complete RPC response**, not just a peer-refusal message. `readBehindNoise` parses the suffix beginning at the last `{"jsonrpc"`; foreign IDs are ignored and counted. R:1748–1766, 1845–1929; replaces old `noteRefusalBehindNoise` at DK:1532.
- **An unterminated oversized line now closes the link deliberately.** The default bound is `buffer.constants.MAX_STRING_LENGTH - 12 MiB`. A matching response can invoke an `onTooLong` hook; an oversized `files.list` response marks that folder as too large to list again until app restart. R:1164–1166, 1723–1734, 1826–1843, 12630–12658.

These harden the same newline-delimited JSON transport; they do not replace it.

## 3. Checkpoint, replay and adoption

**No material change found to the core checkpoint/replay contract.** The line-aligned `{seq,skipBytes}` checkpoint, checkpoint-before-stdin barrier, `process.reattach{id,fromSeq}`, exact/gap/skipped handling and stdin offsets remain. The compared process methods retain their logic, apart from the stdin in-flight accounting below: R:2732–2748, 2967–3145, 3540–3748, 4024–4104. On the helper side, normalized instruction comparisons found no change in `process.(*frameSink).emit/attach`, `process.(*Manager).writeStdin`, `process.(*Seal).Reattach` or `server.(*ConnWriter).Supersede`. This is the portion of the reference the merge can still borrow without redesign.

The changes are around deciding whether to keep a survivor and remembering what the person had asked it to do.

### An interrupt can outlive Desktop

Previously a queued interrupt lived in the live Query/stdin path. Desktop now saves **`sshReattach.stopOwedAt`** when handing an interrupt to a running adoptable SSH process. It defers settling the pane/turn until delivery and clears the mark when the interrupt completes or all relevant stdin writes are known accepted. `stdinAllAccepted` requires offset support, an empty buffer and zero in-flight sends; `sendStdin` now counts those sends. S:30906–30931, 96821, 98425–98434; V:25640–25716; R:2950–2953, 4049–4056.

An adoption record carrying `stopOwedAt` is rejected as **`reap_only`**, even if its state still says `adoptable`. Thus a relaunch does not silently adopt and continue work the person already asked to interrupt. Launch preconnect also includes hosts with an owed stop from the last seven days, subject to its policy gates. A:143–149; S:73692–73695; validator V:23798, 23931–23934. Neither field nor mechanism exists in the reference build.

### A first-start session ID is saved before the CLI reports it

Eligible fresh SSH starts now choose a CLI session UUID in advance and store **`namedCliSessionId`** in the adoption record. If Desktop closed before learning the CLI's session ID, it can recover the preassigned ID for a matching mid-turn process with input sent, unless another session already uses it. If that process cannot be adopted and may not yet have saved its first message, Desktop leaves it running until a person sends another message, rather than immediately replacing it. S:63193–63273, 96225–96228, 26202–26204. This closes a first-message recovery hole; it is not a change to the output checkpoint format.

### Eligibility and completed adoption are stricter

- The `spawn_policy` comparison no longer accepts the extra **bare-CLI policy signature**. It accepts only the current signature or the earlier-build signature. A:193–200 versus old `index.chunk-DBPLojse.js:205–209`; the extra argument is also removed from `configureSSHSpawn`, S:96214–96215.
- Desktop now tracks **`knownToThisRun`** separately from being attached. Fresh processes start known; an adopted process is marked known only when the same Query/process has completed the hooks, permission-mode and Remote Control checks. Same-live-link sharing checks require attached-and-known and no adoption still concluding. R:2557, 2604, 2955–2962, 10204–10209; S:26144–26163, 50288–50295, 98103.

## 4. Held sends

The existing persisted held-message mechanism was not replaced. The material addition is recovery when the **host is connected but no process exists to take the held input**.

- `noteKeptInputHasNoProcess` marks delivery stalled. With `startOnce`, `startOnceForKeptInput` queues one automatic start for the person's not-yet-tried held UUIDs. Starts are serialized per host. Before starting, it rechecks the host, connection, session identity, held UUIDs, competing starts and recovery gates. If that one start fails, the messages wait for Retry or the person's next message; it does not spin up an unbounded start loop. S:42954–43065; `deliverColdHolds` now also notices already-stalled sessions without a cold hold, S:42819–42825.
- After qualifying sign-in refusals, the controller now declines most fresh unattended connects and SSH commands until sign-in succeeds or the local sign-in state changes. The reconnect loop, held-message delivery, scheduled tasks and direct person demands retain designated routes to try; a rejected key can also get one opening-time attempt. This reduces repeated authentication attempts by incidental background work without discarding held input. R:6349–6464. Transcript sync recognizes `signInFailed` rather than continuing its other fallback work after that failure, S:75156–75203.

## 5. Liveness

The reference's simple **“two missed heartbeat pings” is no longer the whole default OpenSSH rule**. With reconnect timing enabled, OpenSSH heartbeats and controller probes share an `askLink` decision. Concurrent asks join the same decision; a caller can make it impatient. A late successful reply to an earlier ping in that decision still proves life. R:1384–1538, 1586–1632, 1892–1901; controller wiring R:8979–8997, 12399 onward.

| New constant / rule | Value and use |
|---|---|
| Silence wait budget | **15 s**, checked after unanswered ping attempts; not an exact wall-clock cutoff (`rt`, R:1164, 1494–1501) |
| `MOST_PINGS_IN_A_WAIT` | **64**, a second bound on that loop (R:1193–1195) |
| `PROVEN_LINK_TICKS` | **2**; the heartbeat's new path requires `_aliveMs ≥ (2−0.5) × heartbeatInterval` (R:1196–1198, 1558–1559, 2061–2063) |
| `STREAMING_BEFORE_FREEZE_MS` | **10 s**, used to decide whether waiting patiently after a freeze makes sense (R:1199–1200, 1561–1577, 2117–2122) |

Patient decisions repeat pings until a pong, qualifying stream traffic/bytes, closure, freeze or a bound resolves them. User-triggered probes and resumes with pre-freeze stream traffic can be impatient. A freeze during the decision resets stale ping state; a freeze beyond the daemon's connection window can produce `dead_frozen`. R:1424–1538, 2112–2165, 12325–12468.

The existing heartbeat/probe/backoff constants have not broadly been retuned: the important change is this decision procedure around them, not a replacement of 7 s/2 s/2 by three new heartbeat numbers. The fallback two-miss path remains in R:2065–2105.

## 6. Deployment and host compatibility

### SFTP is no longer mandatory for setup

Desktop has a command-based file-operations path when SFTP is unavailable, unsupported, or sees a different filesystem tree. It probes usable base64 decoders and SHA-256 tools and guards staged writes with file identity and size checks. Deployment and CLI-upload fallback can use those operations; connected path resolution can use `files.realpath` (§2). D:474–650, 18163–18373, 20328–20339; R:9143–9154, 12721 onward. The reference's unconditional “upload over SFTP” description is now too narrow.

A server refusal caused by **sshd `MaxSessions`** can trigger a reconnect with a separate connection/sign-in for each channel, remembered for **seven days** after success. Discrete mode existed before; this automatic fallback is new. R:9481–9494, 8218–8244.

### The probed home is checked again before setup commands

The new code validates the probed home, tracks a confirmed remembered home, and guards later shell commands against a changed `$HOME`. A mismatch can refuse execution with `HOME_CHANGED` rather than deploying into another account/home. POSIX home paths must be absolute, UTF-8, one line, and at most 255 bytes; Windows homes must be on a local drive. D:15850–15910, 19719–19724, 19871–19880; R:8964–8965. This is a deployment precondition, not a new RPC auth token.

### Managed-launcher starts have an extra initialization gate

When a managed launcher supplies `argv`, Desktop now appends **`--await-initialize`** to the CLI arguments. It also arranges one `{"type":"keep_alive"}` JSONL input after both the owner's first stdin write and a confirmed fresh spawn. That extra input is not sent merely because an existing process was adopted. R:13278–13300, 2631–2637, 3910–3930; old DK:12056–12073 had neither. This is a CLI-start contract layered on `process.spawn`, not a new helper RPC.

### Replacement and failed upgrades preserve more work

- The pure helper-replacement decision now distinguishes a **turn eligible for launch-time re-adoption** from merely recent session records. With no attached processes, those turns can defer replacement for **14 days**, rather than reaching the seven-day record-based replacement point. Attached processes still protect the daemon. The host-work check also changes with the age of the deferral. R:107–126 (`N=7d`, `P=2N`, `F`), 8330–8390, 9227–9233; compare old DK's deployment decision used at 7647 onward.
- If a new helper cannot be downloaded/deployed, the connect can continue with a suitable older binary already on the host. The fallback checks its build time against **2026-10-02T23:02:29Z** and then checks mandatory `server.peer_check` and `git.shadow_dir` features; without SFTP it also needs `files.realpath`. D:18273–18339; P:229270–229271; R:9099–9127. This is distinct from simply reattaching to an old daemon because it has live work.
- A failed CLI install can report **`cliRemoved`**. If the failure is no-space and the helper removed older CLI versions, Desktop makes one more installation attempt. D:19084–19118. The new helper adds `install.noRoom` and `install.pruneVersions`; `install.ensureCli` calls them around decompression. This changes space-pressure recovery, not the `--install --cli-keep 3` interface.

### The helper supports longer Unix socket paths

The new helper routes bridge, daemon listen, stop and handoff dialing through a new **`sockpath`** package instead of calling `net.Dial/Listen` directly. It tries a descriptor-based path, with a directory-relative fallback. Evidence: BIN `daemon.Bridge` at `0x65c880` → `sockpath.DialTimeoutAlone`; `daemon.runChild` at `0x65ade0` → `sockpath.ListenAlone`; `sockpath.reach`, `throughDescriptor`, `fromWithin` at `0x5560e0` onward, including `os.Chdir`/`(*File).Chdir` calls.

The orphan check is adjusted too: if the socket cannot be dialled because its path is too long but the socket file is unmodified since bind, it does not declare itself orphaned. BIN `server.(*Server).exitWhenOrphaned` and the new literal **“socket path %s is too long for this daemon to dial, but its file is unmodified since this daemon bound it; not orphaned”**. This is a new safeguard around socket reachability, not a changed 30-day abandonment timer.

## Consequence for the merge

Retain the reference's sequence/offset/checkpoint transport model. The changes worth carrying into the MAWS–Desk design are the separation of attachment from checked adoption, durable undelivered interrupts, first-start session identity, bounded held-input restart, and a shared patient/impatient liveness decision. Do not treat the old pin, the two-miss summary, or SFTP-only deployment as current contracts.
