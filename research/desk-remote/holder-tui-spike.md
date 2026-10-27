# Plain Claude Code under our own PTY holder: spike findings

Written from the spike agent's hand-back. The agent's instructions barred it from writing report files, so the findings are reproduced here.

**Labels.** **M** = measured in this spike. **I** = inferred from the cited source or from the measurements, not exercised on its own.

- **M:** The binary exercised was `/Users/new/.local/share/claude/versions/2.1.308` ("2.1.308 (Claude Code)"), on 2026-10-22, macOS Darwin 25.6.0.
- **Source:** The engine-design reference is the **2.1.307** reprint, [cli.pretty.js](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js). Section A's code facts are not measurements of 2.1.308.
- **M:** The redirected experiments ran **plain Claude** inside a PTY owned by our own Python process, without `CLAUDE_CODE_SESSION_KIND=bg`. The engine's background supervisor is not on that path.
- **M:** The earlier `--bg` branch was discontinued after the owner chose our own holder. Its findings about sharing one PTY's size and input carry over, and were reproduced under our holder.

## Ranked differences from plain `claude`

1. **A reconnecting client can see a blank or malformed terminal, and main-screen scrollback is lost** unless the holder keeps terminal state.
   - A same-size SIGWINCH redraws neither layout.
   - A width jiggle restores the visible viewport, but not the terminal modes, the title, or earlier main-screen scrollback.
   - This is the largest everyday difference.
2. **Ctrl+Z and `fg` need a real stop/continue protocol and correct process groups.**
   - Passing the byte through a naive `pty.fork` holder made Claude release its terminal modes, but its orphaned process group did not stop.
   - A helper parent in the same session, with Claude in its own foreground process group, fixes this.
3. **A second interactive client changes the first client's layout and shares its input buffer.**
   - With last-attacher-wins sizing, a 70×20 client shrank the person's 120×35 view.
   - Alternating input from the two clients produced `A1B2` in one prompt.
   - A passive observer must not take resize or input ownership.
4. **The terminal no longer owns the session's lifetime.**
   - Closing an attach client, or restarting the manager, leaves Claude running. Closing the last PTY master ends it. `/exit` still ends Claude.
   - The holder must say clearly whether a session is detached, ended or stopped.
5. **Terminal capabilities and integrations have to be forwarded deliberately.** That covers modes, terminal query responses, the title, TERM and terminal-related environment, bracketed paste, mouse and focus events, window changes, and signal and exit behavior. Image clipboard paste and real IDE integration were not exercised.
6. **Routing the wrapper wrongly breaks CLI and pipeline semantics.**
   - `-p`/`--print`, SDK streams, non-TTY invocations and utility subcommands must bypass the PTY.
   - Ordinary session flags need no translation: keep argv, cwd and env unchanged.

No fundamental blocker was found. What remains is engineering: a strategy for terminal state and scrollback, ownership of input and resize, and stop/continue handling.

## A. The engine's design as a reference (2.1.307 source)

### A1. Who owns the PTY, and how re-adoption works

The durable unit is a **per-session PTY-host process**, not the supervisor.

- **Launch.** The supervisor launches `--bg-pty-host <socket> <cols> <rows> -- <executable> …` detached ([host launch](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L341906)).
- **The PTY host.** `runPtyHost` creates `new Bun.Terminal(...)`, so the PTY master lives in the PTY-host process. The host also keeps the child handle, an output ring, the socket clients, heartbeat and orphan accounting, and optional recording ([PTY creation](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L32550), [host state](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L32534)).
- **The supervisor** owns routing, attachers, leases, job state, a separate output ring, auth and reconnect, and the persisted roster. It reaches the PTY host over a socket and never receives the master fd.
- **The roster entry** records the host's pid and process-start identity, the session id, the PTY and rendezvous sockets, the child's pid and start identity, auth tokens, dispatch data, a terminal-mode snapshot, and any pending upgrade ([roster projection](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L342534)).
- **On restart** the supervisor adopts each surviving entry: it checks the pid and the process-start identity, rebuilds the handle, reconnects both sockets, and seeds the mode state. When the process identity can't be verified, it falls back to probing the socket ([adoption pass](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L1233415), [handle adoption](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L342419), [unverified fallback](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L342445)).
- **A normal manager `close()`** disposes connections only ([manager close](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L1233620), [handle stop](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L342614), [adapter dispose](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L341811)).

**For ours (I):** a tiny session process holds the master and the terminal state. A replaceable manager reconnects to it over a stable socket and verifies its identity. Re-adoption needs no fd transfer and no transcript resume.

### A2. Frame codec and the two socket layers

**The PTY-host socket** ([codec](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L891326)):
- **Frames.** A frame is a 4-byte big-endian length, a 1-byte kind (0 = raw PTY bytes, 1 = UTF-8 JSON control), then the payload, capped at 1 MiB.
- **Limits.** The ring target is 256 KiB, and the largest accepted dimension is 10,000.
- **On connect.** The host sends `hello` (with `replPid` and the version), the ring as data frames, then `live`, then heartbeats. A settled host also sends `exit` ([host connection](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L32598)).
- **Controls.** Clients send `auth`, `pong`, `resize` and `kill`. Data frames are gated by a token. A resize sets the PTY size and sends SIGWINCH. A `kill` sends SIGTERM and escalates after 5 s ([resize/kill](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L32564), [dispatch/auth](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L32606)).
- **Reconnect.** When the supervisor's adapter reconnects, it discards the replayed data until `live`, then asks for a redraw ([adapter](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L341612), [resume-to-repaint](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L342738)).

**The daemon's attach socket:**
- The client sends one NDJSON request carrying its size, attach identity and terminal capabilities.
- The daemon acknowledges in JSON with the terminal modes, then the raw stream follows.
- This is not the 5-byte codec ([request](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L364388), [ack](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94720), [input](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94859)).

### A3. What a new attacher receives, and what causes a repaint

**Interactive attach does not replay the ring.** Only exec jobs replay it; interactive sessions ask for a fresh render ([exec-only replay](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94825), [repaint call](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94854)). A fresh render takes these steps:
1. **Restore terminal modes.** The supervisor tracks DEC mode sequences (mouse, focus, bracketed paste, theme notifications) and puts that snapshot in the attach ack. The client sets up its own alternate screen and raw mode, then applies the snapshot ([mode tracker](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L391033), [client setup](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L364368)).
2. **Request the redraw.** `resizeForRepaint` sends `{type:"repaint"}` over the session's separate **rendezvous** connection. It waits up to 50 ms for completion, then falls back to width−1 and restores the width after 30 ms. Without a rendezvous connection, the fallback runs at once ([resizeForRepaint](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L342514)).
3. **The session redraws.** It calls `forceRedraw({flushReact:true})` and answers `{type:"repaint-done"}` ([handling](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L27029), [forceRedraw](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L27191)).
4. **`onRepaintDone`** is the supervisor's form of that ack. It confirms the renderer redrew, not that a physical terminal displayed the frame ([event](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L342942)).
5. **Waiting for the first frame.** The attacher buffers output until it sees a full-repaint start: `ESC[2J`, or `ESC[H` followed by `ESC[2K`. It then drops the deltas before that point, re-applies the modes, and emits. It also flushes on completion, after 500 ms, or past 64 KiB ([buffer](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94723), [flush](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94773), [constants](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L876306)).
6. **A booting resumed job** may first show a provisional frame rendered from its transcript ([cached frame](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94717)).

**For ours (I):** the engine has a private force-redraw channel, which a plain-Claude PTY wrapper does not have. SIGWINCH is not equivalent to it.

### A4. Multiple attachers, sizes and leases

- **Size.** There is one PTY size. Every attacher gets the same stream. A new attacher's size is applied, and when an attacher closes, the last remaining one's size returns ([registration](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94802), [initial size](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94854), [close fallback](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94867)).
- **Input.** Input from every attacher goes into the same PTY. Only the most recent input attacher is remembered, for targeted detach. There is no read-only or no-resize attach ([input](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94859), [targeted detach](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L342933)).
- **Leases.** Attach and subscribe take connection leases. Live jobs plus leases keep a transient supervisor alive; with neither, it exits after a 5 s idle grace ([leases](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94403), [subscribe](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94889), [idle](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L1234111), [keep-alive](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L1234288)).

### A5. What upgrade, crash and stall handling cost

- **Watchdogs.** The PTY host sends a heartbeat every 60 s and drops a peer that misses three. If its parent is gone and it has had no clients for 30 × 2 s, it kills the session, escalating after 5 s. So the engine's re-adoption window is bounded ([watchdogs](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L32647)).
- **The adapter** has reconnect backoff, process-start checks, backpressure and bounded queues. After enough failed recoveries it kills the process group ([bounds](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L341546), [failed reconnect](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L341695)).
- **Attach stalls.** The threshold is 5 s, or 12 s with a process wrapper. It retries redraws, may restart an interactive worker, and gives up after two restarts ([thresholds](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94362), [stall](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L94740)).
- **Exit classification and upgrades.** Worker exits are classified, and some lead to a respawn from the transcript ([exit policy](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L342787)). The supervisor also watches the binary's identity, refuses downgrades, defers upgrades while workers are busy, and re-adopts after an upgrade ([upgrade](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L1234219), [shutdown](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L1234379), [failed successor](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L1234901)).

**What ours needs (I):** stable ownership per session, identity and auth checks, bounded buffers and backpressure, an explicit lifetime policy, reconnect state, and proper job control.

**What not to copy (I):** job dispatch, transcript-based auto-respawn, exec-versus-interactive classification, spare claims, scheduled workers, service singleton ownership, binary-upgrade migration, prewarming, gateway credential migration, and reaping by task contract. In particular, a failed redraw must not restart a healthy plain-Claude session.

## B. Plain Claude under our own PTY (2.1.308)

### B1. Re-attach in both layouts (M)

The tests used fullscreen (`CLAUDE_CODE_NO_FLICKER=1`) and main-screen (`=0`) layouts at 120×35. The client was a separate process over Unix sockets, and the host relayed live bytes only, with no replay and no emulator.

| Test | Fullscreen | Main-screen |
|---|---|---|
| New same-size client, no replay | Blank, or only later deltas | Same |
| Same-size SIGWINCH | No repaint (0 bytes within 300 ms) | Same |
| Width 120→119→120, 150 ms apart | Viewport repainted | Viewport repainted |
| New client, modes not restored | Painted into the main screen instead of the alternate screen | Bracketed paste and focus missing, title wrong |
| Mode preamble restored, then jiggle | Alternate screen and mouse correct, viewport correct | Main screen correct, viewport correct |

- **The first client can miss output too.** The host can paint before any client connects, so even the first client needs a snapshot.
- **Scrollback.** After 20 `/rename` rows (no model calls), the original terminal's scrollback held all 20. A re-attach plus jiggle recovered only the 10 rows in the viewport; earlier main-screen scrollback did not return.
- **Input history and identity survive.** Up arrow after re-attach recalled the earlier typed `/effort low`, and the session id was unchanged.
- **The title is not restored.** It was in the captured OSC output, but a new client's pane kept its default title.

**Recommendation (I):** keep terminal state in the session host. A headless terminal emulator with bounded scrollback and a screen serializer is the strongest candidate. Mode restoration plus a jiggle is a fallback that every attached client sees.

### B2. Manager restart and the master fd (M)

| Layout | Host pid | Claude pid | Session id before and after a SIGKILL of the manager |
|---|---:|---:|---|
| Fullscreen | 44384 | 44523 | `e124ac15-…` unchanged |
| Main-screen | 94922 | 94941 | `7125f8f0-…` unchanged |

- **During the outage.** The mod kept answering while the manager was dead. The new manager reached the same host and the same Claude, with no resume.
- **Client connections.** Clients connected through the manager were closed when it died, because the prototype routed them through it.
- **Closing the last master** ended both sessions: `session.end` with reason `other` 9–13 ms later, then **exit 129**. A separate witness process confirmed the SIGHUP on master close. Claude's SIGHUP handler calls `shutdown(129)` ([source](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L998447)).

### B3. Two clients at different sizes (M)

- With a 120×35 client and a 70×20 client, both rendered one 70×20 layout; the large one showed unused area. When the small client closed, 120×35 came back with another repaint.
- Alternating writes (`A`, `1`, `B`, `2`) produced `A1B2` in the shared prompt.
- **For ours (I):** the holder should assign one active owner of size and input. Observers neither resize nor type.

### B4. Mods and plugin loading (M)

- **Explicit plugin.** The probe mod loaded through `--plugin-dir` in both layouts. `$.session.id/model`, `$.command.run` and env reads worked before and after the manager was replaced.
- **Installed plugin.** Installed at user scope in an isolated config, the plugin loaded without `--plugin-dir` through normal discovery.
- **Environment.** The child inherited `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. HOME, TERM, EDITOR and a sentinel variable survived. `CLAUDE_CODE_SESSION_KIND` was absent, and cwd was as requested.

### B5. Wrapper passthrough and job control

| Input | Result |
|---|---|
| `--model haiku` | M: the mod reported `claude-haiku-5-5[1m]` |
| `--permission-mode plan` | M: the footer showed plan |
| `-n name` | M: shown, and kept across resume |
| `--add-dir` | M: `$.tool.check(Read, path)` allowed it |
| `--resume <id>`, `--continue` | M: same id, earlier prompt recovered |
| env, cwd | M: survived. I: pass the whole launching shell environment, not an allowlist |

What the client and host must do (I):
- **At launch,** take cwd and env from the invocation that creates the session, not from the manager. Send the size before the first render. Match termios.
- **While attached,** forward bytes unchanged, including bracketed paste, focus and mouse events, extended keys and terminal query responses. Let only one client answer capability queries.
- **On detach,** restore the local terminal. Propagate the exit status.
- **Bypass the PTY** for `-p`/`--print`, SDK streams, non-TTY stdin or stdout, utility subcommands, and the existing background and cloud modes.

**Ctrl+Z:**
- **The failure (M).** Under a naive `pty.fork`, Claude was a session leader in an orphaned process group. On Ctrl+Z it released its modes and printed its suspend line, but stayed `Ss+`. Claude's handler restores termios and sends SIGTSTP to process group 0 ([source](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L166600)).
- **The fix (M).** A helper in the controlling-terminal session, Claude in a separate process group, made foreground with `tcsetpgrp`. With that, Ctrl+Z took the Claude process from `S+` to `T+`, and SIGCONT took it back to `S+`. The session id was unchanged, and `/exit` then gave 0.

## Method and limits

- **Isolation.** Temporary HOME and config, trusted temporary git dirs, our own tmux servers. The owner's gate cache was copied read-only. Gateway keys went through 0600 env files, all removed afterwards; retained files scan clean. Nothing of the owner's was touched.
- **Prototypes** are kept in `holder-tui/scripts/` beside this note (the probe plugin in `holder-tui/plugin/`); raw captures stayed in `/private/tmp/holder-tui/`. The scripts expect the spike's scratch layout there and are not runnable as-is. `pty_host.py` (per-session owner and fan-out), `pty_manager.py` (replaceable router), `pty_client.py` (raw client), the scenario scripts, `jobcontrol_*.py` and `hup_witness.py`. They are research probes. They have no emulator, no replay, no capability negotiation, and no production auth or backpressure.
- **Model spend.** The redirected tests made no completed model call; one short haiku prompt was interrupted to seed a resume transcript. The discarded `--bg` branch accidentally sent one shell-command string as a prompt, which ran **one Opus turn**. That branch also got one response that the provider reported as Sonnet, although haiku had been requested.
- **Not verified:**
  - image paste from the macOS clipboard;
  - real IDE integration;
  - capability negotiation across different physical terminals;
  - crash recovery of the per-session host itself;
  - an emulator or serializer implementation.
