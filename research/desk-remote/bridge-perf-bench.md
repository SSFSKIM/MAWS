# Bridge mod performance bench (sminos 1.1.1, Claude Code 2.1.304)

Measured 2026-10-20 06:00–06:45Z (2026-10-19 23:00–23:45 PDT) on the owner's MacBook (M1 Max, 10 cores).
Every session in this bench was isolated, the way `tests/mods/live-bridge-check.py` isolates one: a temporary
HOME and config dir, a temporary `SMINOS_HOME`, a staged copy of the plugin loaded with `--plugin-dir`, its own
tmux server, and the gateway keys passed in a 0600 env file. The owner's sessions, their bridge sockets and
the sminos daemon were not touched. The bench read `~/.claude/sminos/daemon.log` and three of the owner's
transcripts for their sizes and row timestamps, read-only, and printed none of their content. Scripts and raw
data are in `/private/tmp/bridge-bench/` (see "Reproduce" at the end).

Each claim is tagged **[M]** when it was measured in this bench and **[I]** when it was inferred from code
or from a log.

## Verdict

**The bridge hop is not what makes the desk slow.** The hop runs from the engine through the mod and the
child to one local subscriber.

- **At moderate load it is small.** At a 1-minute load of 14–17, a text delta reached a daemon-like
  subscriber 1.8 ms (p50), 5.7 ms (p95) and 14.5 ms (p99) after the mod stamped it. It arrived 0.6 ms (p50)
  and 3.0 ms (p95) after the same delta on the engine's own `stream-json` stdout **[M]**. That fits inside a
  16–33 ms producer-batching budget with room to spare. It is two orders of magnitude below one hub POST:
  a fresh HTTPS round trip to the hub took 140–230 ms **[M]**.
- **Under heavy load the hop stretches, but stays under the budget at the median.** At load 110–456 it was
  4–14 ms at p50, 19–62 ms at p95 and 34–114 ms at p99 **[M]**. The engine's own stdout path stretches the
  same way (p95 up to 88 ms) **[M]**.
- **The mod costs the engine nothing measurable.** Hooks on versus off showed no significant difference in
  time to first token, delta cadence, turn time or engine CPU (12 turns each) **[M]**.
- **The hop's largest share is on the engine side.** Most of it is the time from the mod's `emit()` to the
  child accepting the POST: the mod's poster waking on the session's event loop, the one post in flight, Bun
  `fetch`, and a new Unix connection. The child's own share is 0.3–1 ms **[M]**.

**The slowness the owner sees is the open path, and it is load-sensitive.** The open path is the plane's
snapshot plus the uplink. Production opens took 5.4 s, more than 19 s, and more than 51 s, the last two
abandoned by the browser. The bridge's part of an open measured milliseconds when warm and 0.2–0.4 s for a
freshly spawned child **[M]**. The rest is in the plane and the uplink.

- **The plane waits for a row the engine has not written yet.** An open made while an assistant message is
  streaming can wait until the message ends. A row is announced before it is on disk, and the engine writes
  a message's rows only when the message completes: 2.0–2.4 s later in this bench **[M]**. Past 5 s the plane
  ends the open with a discontinuity **[I]**.
- **The plane re-checks only on its 0.25 s poll** **[M]**.
- **A cold index costs CPU in proportion to the transcript.** CI-opt's 317 MB transcript takes 1.3 CPU-s
  **[M]**, which becomes tens of seconds when the machine is starved **[I]**.
- **One thread does all of the uplink's work.** It pumps every subscription, and it blocks on synchronous hub
  POSTs, which can hold it for up to 60 s **[I]**. The two production stalls sat inside a hub stream that was
  failing **[I]**.

So yes: the evidence supports the owner's sense that "the desk is slow". What is slow is the open path and
its load sensitivity, not the per-delta hop.

## Setup and caveats

- **Machine load.** The MacBook was CPU-starved for most of the bench. The 1-minute load average ran from 14
  to 475 on 10 cores, from other sessions' builds and tests plus nProtect. It never fell below the core
  count, so there was no quiet window. Every table gives the load of its run. The lowest-load reruns (Q1,
  P3/P4, the second child bench) ran at a 1-minute load of 14–44.
- **Production conditions.** The production desk runs on this same machine under this same load. So the
  heavy-load figures are the owner's real conditions, not an artefact of the bench.
- **Headless mode.** The mod does spawn its child in `claude -p` mode: an `--input-format stream-json` session
  served a bridge socket 1.5–7 s after launch **[M]**. That allowed a same-session comparison: stdout
  `stream-json --include-partial-messages` and the bridge subscription, read on one clock, delta matched to
  delta by text. Every delta matched (0 mismatches in 4,000+ pairs).
- **Interactive and background sessions.** Interactive tmux sessions were measured too, using the mod's `t`
  against arrival time. `claude --bg` was not measured separately: it runs the same engine and the same mod
  path **[I]**.
- **The `t` stamp.** `t` is `Date.now()` in whole milliseconds, so arrival − `t` overstates by about 0.5 ms on
  average. The stdout comparison has no such bias.
- **Timing probes.** Runs marked "shim" ran the staged copy's child under `bridge_shim.py`, which records the
  time of every accept, POST, ingest and dequeue. Its cost is a few clock reads and one log line per POST;
  that overhead was not measured on its own. The unshimmed ON runs are the production-like figures.
- **Debug log.** One run, Q2, also used `--debug-file` for the engine's `$.http.fetch` timings. Debug logging
  perturbs the engine.
- **Bytecode file in the plugin cache.** The first standalone child run imported `sminos.py` from the plugin
  cache and wrote `__pycache__/sminos.cpython-312.pyc` there, at 23:01. That is a bytecode cache file; no
  source changed. All later runs used `PYTHONDONTWRITEBYTECODE=1`.

## 1. Delta latency, engine to subscriber

### Same headless session: stdout versus bridge [M]

Haiku, one 450-word story per turn, one daemon-like subscriber. The daemon-like subscriber is an
`http.client` reader using `readline`, like `BridgeReader`. ON1–4 ran without the shim.

| run | load (1 min) | pairs | bridge − t  p50 / p95 / p99 / max (ms) | bridge − stdout  p50 / p95 / p99 | stdout − t  p50 / p95 |
|---|---|---|---|---|---|
| Q1 (shim) | 14–17 | 339 | 1.8 / 5.7 / 14.5 / 39.5 | 0.6 / 3.0 / 9.9 | 1.2 / 3.3 |
| ON1 | 136–143 | 817 | 3.9 / 19.1 / 33.9 / 91.9 | 1.8 / 14.7 / 24.1 | 1.9 / 6.9 |
| L1 (shim, thinking) | 110–142 | 420 | 8.2 / 47.0 / 98.7 / 187 | 4.6 / 31.9 / 66.8 | 2.7 / 17.5 |
| ON2 | 183–279 | 333 | 13.9 / 51.6 / 78.5 / 92.8 | 8.7 / 38.6 / 58.8 | 3.2 / 18.0 |
| ON3 | 264–332 | 358 | 13.7 / 56.1 / 96.2 / 238 | 9.3 / 43.4 / 67.9 | 3.5 / 17.4 |
| ON4 | 389–456 | 296 | 13.8 / 62.2 / 114 / 283 | 8.0 / 44.0 / 76.6 | 3.4 / 87.8 |

Thinking deltas behave like text deltas: 44 pairs in Q1, 0.1 ms p50 behind stdout.

### Interactive terminal sessions: the mod's t versus arrival [M]

| run | load | chunks | arrival − t  p50 / p95 / p99 / max (ms) |
|---|---|---|---|
| P3 | 27–38 | 256 | 1.9 / 3.8 / 6.2 / 15.6 |
| P4 | 18–28 | 476 | 1.8 / 4.5 / 17.0 / 34.8 |
| P2 | 46–63 | 260 | 2.4 / 7.1 / 10.3 / 34.6 |
| P1 | 253–384 | 142 | 21.6 / 72.9 / 88.0 / 116 |

### Where the hop goes [M]

At live rates each POST carries one event: batch p50 1, max 3, in single-stream turns. So the hop is one
`$.http.fetch` per delta.

| segment | Q1, load 15 (per post) | Q2, load 93–196 (debug log) |
|---|---|---|
| `emit()` → fetch starts (poster wake, one post in flight, event loop) | — | 3.0 / 14 / 21 ms |
| fetch starts → child accepts (Bun fetch, new Unix connection, child main-thread wake) | — | 2.1 / 8.9 / 14 ms |
| `emit()` → child accepts, the two together | 1.4 / 3.8 / 9.0 ms | — |
| child: accept → response sent (thread spawn, HTTP parse, `json.loads`, ingest, fan-out) | 0.32 / 1.0 / 2.4 ms | 0.97 / 5.1 / 11 ms |
| child's lock-held ingest itself | 0.02 / 0.06 ms | — |
| subscriber writer: dequeue → line read | 0.05 / 0.5 / 1.8 ms (from Q1's per-event pairing; see the note under this table) | — |
| engine-reported fetch duration | — | 5 / 18 / 48 ms |

Figures are p50 / p95 / p99.

The per-event pairing of shim dequeues to posts came out inconsistent in places: some segments were negative,
others implausibly large. So only the per-post figures above it are trusted, and the whole-hop totals in the
first table.

**The engine side dominates the hop** **[M]**. Of Q1's 1.8 ms median, about 1.4 ms passes before the child
accepts.

Under load, two things add to that segment:

- **One post in flight** **[M, I]**. Events emitted during the ~5 ms post queue behind it **[M]**. A busy
  session's JavaScript event loop delays the poster's wake **[I]**.
- **The child's GIL handoffs** **[I]**. These come from the handler thread, then the subscriber's writer
  thread.

## 2. The mod's cost to the engine [M]

The two arms ran as alternating sessions: hooks on (ON1–4) against hooks off (OFF1–4). Each arm had 3 turns
of the same prompt, 12 turns per arm, all at load 136–456. `p` is a two-sided permutation test on the
difference of medians.

| metric | hooks on p50 (p95) | hooks off p50 (p95) | p |
|---|---|---|---|
| time to first delta | 1,872 ms (3,270) | 1,442 ms (4,539) | 0.20 |
| inter-delta gap | 9.2 ms (420) | 8.3 ms (1,031) | 0.10 |
| turn time | 13.4 s (27.5) | 15.2 s (26.4) | 0.40 |
| engine CPU per turn | 0.70 s (1.22) | 0.57 s (1.88) | 0.57 |
| engine CPU per delta | 4.95 ms | 4.39 ms | 0.78 |

**Every difference is within noise.** Gateway and model variance dominate time to first token and cadence.
The mod's per-chunk work is synchronous and in-memory, sub-millisecond: `emit` stamps `t`, folds the chunk
into its state, pushes it and pumps. It is not visible at this sample size. The bridge child itself used
0.08 CPU-s per 450-word turn (p50) **[M]**.

## 3. Concurrency

### Live: one turn, parallel subagents streaming at once [M]

| run | load | peak events/s | posts | batch p50 / p95 / max | arrival − t, all events  p50 / p95 / p99 / max | child CPU for the turn | gaps / resyncs / subscriber cut-offs |
|---|---|---|---|---|---|---|---|
| C5 (5 subagents) | 344–355 | 285 | 491 | 2 / 10 / 25 | 20.8 / 63.3 / 107 / 210 ms | 0.35 s | 0 / 0 / 0 |
| C10 (10 subagents) | 370–375 | 518 | 595 | 2 / 16 / 39 | 12.0 / 57.8 / 105 / 203 ms | 0.35 s | 0 / 0 / 0 |

Notes on these runs:

- **Batching.** The poster's one-in-flight design batches by itself as the rate climbs: batches reached 39
  events.
- **No loss.** `lose` never fired: no `gap` event, no resync beyond the first, no subscriber cut off.
- **Snapshot size.** Mid-stream snapshot probes stayed small: at most 14.5 KB with 10 subagents, served in
  4 ms (p50) and 15 ms (max).
- **Subagents.** The engine prints no subagent deltas on stdout (0 in both runs). Subagent latency is
  therefore `t` against arrival only.

### The child's ceiling, standalone, no model calls [M]

The harness acts as the mod. It takes the child's hello nonce, posts a resync, then posts synthetic chunk
batches as the poster does: one in flight, up to 500 events each. 1, 5 or 20 subscriber processes are
attached. These figures come from the second run, at load 19–73; the first run, at load ~120, was similar.

| subscribers | offered events/s | produce → arrival  p50 / p95 / p99 (ms) | child CPU | outcome |
|---|---|---|---|---|
| 1 | 100 / 1,000 / 3,000 | 0.6 / 3.9 / 9.2 · 1.0 / 7.5 / 20 · 1.7 / 20 / 39 | 6% / 35% / 35% | keeps up |
| 1 | max (full batches) | ~12,800 events/s sustained | 72% | the GIL-bound ceiling |
| 5 | 1,000 / 3,000 | 1.1 / 23 / 46 · 2.0 / 26 / 94 | 45% / 60% | keeps up |
| 5 | ~10,000+ | — | 72–86% | every subscriber passes `SUBSCRIBER_BACKLOG` and is cut off |
| 20 | 500 / 1,000 | 1.5 / 13 / 29 · 5.1 / 50 / 99 | 55% / 67% | keeps up |
| 20 | 3,000 | 245 / 512 / 584 | 74% | falls behind: 60k lines/s is past the ceiling |

Other measurements from the standalone runs:

- **One event with nothing else running.** A POST took 0.53 ms (p50) and 1.3 ms (p95) end to end.
- **Child cost per POST.** The child spends about **0.45–0.55 CPU-ms per POST** with one subscriber, and
  0.65–0.9 ms with five. At live rates that is the cost per event.
- **Startup.** From spawn to hello took 150–300 ms: Python, plus importing the 433 KB `sminos.py`.

**Headroom.** The live peak, 518 events/s, is about 1/25 of the single-subscriber ceiling. It is also below
the point where 20 subscribers start to fall behind. Fan-out to a handful of subscribers is safe at live
rates. Fan-out to 20 or more falls apart once a session streams faster than about 1,000 events/s.

## 4. Command round trip [M]

`POST /command?wait=` with `{"op": "ping"}` goes as a line on the child's stdout. The engine reads it, the mod
answers with a `result` event through its poster, and the child hands that answer back to the waiting client.

| run | load | idle p50 / p95 / max | mid-stream p50 / p95 / max |
|---|---|---|---|
| L1 | 110–142 | 5.6 / 16.1 / 37.8 ms | 14.2 / 81.2 / 118 ms |
| C5 (5 subagents streaming) | 344–355 | 10.4 / 26.8 / 29.1 ms | 35.5 / 97.0 / 140 ms |

**A permission decided from outside (P4, load ~28).** The run was a Bash call `python3 -c 'print(...)'` with
its request raised on the stream:

- `POST /requests/<id>/decision` answered 200 in **0.9 ms**.
- The mod's long-poll took the decision 11 ms after the POST, by the mod's stamp.
- The `settled` event arrived **+18 ms** after the POST.
- The Bash result arrived +274 ms after the POST; that is mostly `python3`'s own startup under load.

So a decision takes about 20 ms to reach the engine, plus the tool's own run.

**The first permission of a fresh session is not raised.** It is left to the terminal: by design, the mod
raises no permission until a tool call has settled the bridge's place among the secrets guards **[M]**. In P1
the first tool call was the Bash call, and nothing was raised. Once a Read had run first, the Bash request was
raised.

## 5. Recovery

### What a resync costs a subscriber, standalone [M]

The child holds streaming text spread over 5 messages. The harness posts `gap` plus `resync`, which is what
`lose` queues. Every subscription ends, and each subscriber re-subscribes at once. Load was 106–158.

| streaming text | resync body | subscribers | fresh snapshot after the resync  p50 / max |
|---|---|---|---|
| 10 KB | 11 KB | 1 / 5 / 20 | 12 / 13 / 11 ms (max) |
| 100 KB | 101 KB | 1 / 5 / 20 | 3 / 28 / 29 ms (max) |
| 1 MB | 1.0 MB | 1 / 5 / 20 | 12 / 23 / 138 ms (max) |
| 4 MB | 4.0 MB | 1 / 5 / 20 | 33 / 148 / 238 ms (max) |

Building the snapshot under the child's lock took **0.01 ms (p50) and 0.12 ms (max)** across 83 live
subscriptions **[M]**. **The child side of a resync is cheap.**

Two risks remain:

- **The 4 MB limit.** `$.http.fetch` refuses a body over 4,194,304 characters (`yz` in the 2.1.300 bundle).
  A resync of a larger live state would be refused, counted as lost, and queued again as another resync,
  every 500 ms **[I]**. The live state grows past 4 MB if, for example, a huge Write tool input is
  streaming.
- **Production cost.** A resync ends the daemon's subscription with a discontinuity. The browser then
  subscribes again, which costs **a full plane open** (section 6) **[I]**.

### Live failure modes [M]

- **The child SIGKILLed mid-stream (P4).**
  - **Timeline.** The stream ended at +2 ms. Connects were refused every ~23 ms while the stale socket stood.
    The respawned child served a new snapshot at **+1,182 ms**, carrying the streaming message: 2,328
    characters so far. The next live chunk came at +1,217 ms (`chunkIndex` 98, continuing without a hole).
  - **What dominates.** Nearly all of this is the mod's fixed 1 s respawn delay (`RESPAWN_FIRST_MS`).
- **The child SIGSTOPped for 2 s mid-stream (P1).**
  - **During the stall.** The mod's poster held its one post, and 78 events queued.
  - **After SIGCONT.** The held post completed at +4 ms, and the next post carried 77 events at +11 ms. The
    stream was current again within about 22 ms.
  - **No loss.** There was no `gap` and no resync.

## 6. The open path: cold and warm, and where the gap goes

### What the production log holds [M]

Every `plane: open` line in this Mac's `daemon.log` is listed below. The log starts on 2026-10-17, and no open
line appears before 2026-10-20 05:02Z.

| time (Z) | session | outcome | N (s) | M, "the bridge's snapshot at" (s) | N − M (s) |
|---|---|---|---|---|---|
| 05:02:38 | a5b99a8b | session-ended, no transcript | 0.04 | — | — |
| 05:04:06 | a5b99a8b | session-ended, no transcript | 0.07 | — | — |
| 05:07:03 | a6dee14b | transcript-only, no bridge socket | 0.05 | — | — |
| 05:07:51 | a6dee14b (Resume) | bridge snapshot | **5.40** | 1.43 | **3.97** |
| 06:19:34 | a45b97a3 (CI-opt, busy) | unsubscribed before its snapshot | >19.33 | 16.15 | >3.18 |
| 06:22:02 | 04e0f278 (maws-83, idle) | unsubscribed before its snapshot | >51.58 | 35.97 | >15.61 |

**No distribution is possible from this log.** It holds only three bridged opens, and two of them were cut
short. They also cannot be split by cold versus warm.

**M is not a bridge measure, despite the log line's wording.** M is stamped when the plane's pump, on the
uplink's main thread, takes the snapshot off the `BridgeReader`'s queue. It is not stamped when the child sent
the snapshot. So M includes any time the main thread was not pumping **[I, from code]**.

### The same opens, isolated and timed phase by phase [M]

`plane_open.py` builds a `BridgeReader` and a `Subscription` exactly as `Plane.subscribe` does. It pumps them at
the uplink's cadence (on a wake, else every 0.25 s) with no hub POSTs, against an isolated live session. Each
phase is stamped: reader lines, the transcript locate, every `build` and its answer, `look`, `derive`, the
snapshot. There were 27 opens over runs P1–P4.

| situation | opens | N (s) | M (s) | builds that answered "waiting" |
|---|---|---|---|---|
| warm, idle (fresh session, between turns, or 2 s after a resume) | 17 | 0.00–0.03 | 0.00–0.02 | 0 |
| cold: `claude --resume`, opened as soon as the socket appeared | 1 | 0.00 | 0.00 | 0 |
| right after a prompt is submitted (one of them just after a resume) | 5 | 0.40–0.51 | 0.00 | 1 each |
| mid-stream, an earlier block of the message already noticed | 3 of 4 | **1.96 / 2.04 / 2.22** | 0.00–0.01 | 24 / 41 / 45 |
| mid-stream, before any block row was noticed | 1 of 4 | 0.00 | 0.00 | 0 |

**After the snapshot,** the plane added 1.9 ms (p50), 8.4 ms (p95) and 30 ms (p99) per chunk, from the bridge's
`t` to the plane's message, with no hub involved **[M]**.

### Mechanism 1: the snapshot's cut names a row that is not on disk yet [M]

The bridge's snapshot carries `cut`: for each loop, the last row notice it applied. The plane's build requires
that row in its index, and answers "waiting" until it is there. The engine announces a response row (the
mod's `session.append` hook returns its uuid, and the mod emits `block-row`) well before the row reaches the
transcript.

**Measured in P1.** The disk was polled every 2 ms and compared with the notices on the stream:

- **Most rows.** Of 32 notices, 25 prompt, attachment and notice rows reached disk 30–240 ms after their notice
  (p50 98 ms). That fits the engine's 100 ms transcript flush timer (`FLUSH_INTERVAL_MS = 100`). One attachment
  written during a tool call took 1.5 s.
- **The row of a message's first block.** A thinking block's row was announced at the end of that block, and
  reached disk only when the whole message ended: **2,445 ms and 2,319 ms later**. Both rows of the message
  were flushed together.

The production Resume fits the same pattern. Its transcript row timestamps (05:07:46.4 user, 05:07:49.45
thinking, 05:07:50.31 tool_use of the same message) show the session mid-turn during that open. That is
consistent with this wait, but not proven **[I]**.

**The risk when the message runs long [I, from code].** `NOTICE_WAIT = 5 s` bounds the wait. If a message
streams more than 5 s after its first block's row is announced, the open ends with a discontinuity: "the
snapshot's cut … never reached the transcript". This is common with long answers after a thinking block on a
slower model. The browser then subscribes again into the same wait.

### Mechanism 2: the re-check cadence [M]

A "waiting" answer does not wake the uplink. So the build is asked again only at the next pump: a reader line,
another wake, or the 0.25 s poll. With nothing streaming yet, as right after a prompt, the open costs about two
polls: **0.40–0.51 s**, measured 5 times, against a row that was on disk about 100 ms after its notice.

### Mechanism 3: a cold index costs CPU in proportion to the transcript [M]

On a subscription's first open of a transcript in a daemon process, the index is built by JSON-parsing every
row, feeding the jobs ledger and the chain, and then looking at every subagent meta. The index survives
neither a daemon restart nor eviction from the four-transcript LRU.

The same calls were timed read-only on the owner's real transcripts, at load ~63:

| transcript | size | rows indexed | index | look (metas) | total |
|---|---|---|---|---|---|
| acc-ask71 (a6dee14b) | 0.6 MB | 65 | 2.8 CPU-ms | ~0 | ~5 ms wall |
| maws-83 (04e0f278) | 0.8 MB | 191 | 4.1 CPU-ms | ~0 | ~7 ms wall |
| CI-opt (a45b97a3) | **317 MB** | 15,180 | **0.75 CPU-s** | **0.53 CPU-s** (136 metas) | 1.65 s wall |

**Under starvation this becomes tens of seconds.** At load 150–220 on 10 cores, CI-opt's 1.3 CPU-s becomes
roughly 20–30 s of wall time **[I]**.

**The build is not cancelled when the browser gives up.** The transcript's worker runs jobs one at a time, in
order. So an abandoned build keeps running, and a retry queues behind it **[I, from code]**.

**The daemon restarted repeatedly.** It restarted in place 7 times between 04:27Z and 06:06Z on 2026-10-20, and 38
times in the log since 2026-10-17 ("its code changed"), each time losing every index **[M, log]**.

**GIL contention between opens is small [M].** A small warm open, run beside a concurrent CI-opt build in the
same process, still took 0.01–0.03 s instead of 0.00 s.

### Mechanism 4: the uplink's single thread blocks on hub POSTs [I, from code and the log]

`serve_link` handles one batch of frames, then one `link.tick()`, on one thread. The tick:

- uploads, delivers and relays requests and RPCs;
- pumps every subscription;
- POSTs each batch of output with `post()`.

Each POST opens a **fresh HTTPS connection**, which costs 140–230 ms, TLS included, to this hub **[M, curl]**.
The hub then holds the answer until its replies are written to the browser's stream. A POST can block the
thread for up to `2 × POST_TIMEOUT` = 60 s before `NotDelivered`. While it blocks, nothing pumps, so M and N
both stretch.

The log is consistent with this:

- **15-minute cadence.** The uplink's hub stream ends with a held POST answered 503 "a reply to this POST could
  not be written to the stream" about every 15 minutes: 03:57, 04:12, 04:42, 04:57, 05:44, 06:22 and 06:37.
- **Timing of the stalls.** The two stalled opens (06:19, 06:22) fall in the last three minutes of stream 219,
  which ended in that 503 at 06:22:35.
- **The bridge side is ruled out.** A warm idle bridge serves its snapshot in milliseconds even with 20
  subscribers and 4 MB of state **[M]**. So maws-83's M of 35.97 s was the uplink's main thread not pumping,
  not the bridge **[I]**.

### Cold versus warm

| path | what it adds | where it lands | size |
|---|---|---|---|
| warm, idle bridge | the child's snapshot under its lock; the reader's line | M | 0.01–0.12 ms under the lock **[M]**; M = 0.00–0.02 s end to end **[M]** |
| cold bridge (just spawned, or a resume) | Python start and imports, then hello | M, or before it, while no socket exists | 150–300 ms **[M]** |
| | hello → the mod's first resync accepted | M | 6–112 ms (p50 12 ms, 11 cold starts, load up to 190) **[M]** |
| | `wait_ready` holds `GET /events` up to 5 s, then 503; the reader retries every 0.1 s for 5 s | M | not hit: in every run the socket answered ready within ~0.1 s of appearing **[M]** |
| either | locate, build, waiting for the cut's row, look, derive, page assembly | **N − M (the plane's)** | 0–30 ms idle; 0.4–0.5 s after a prompt; up to 5 s mid-message **[M]**; O(transcript) CPU on a cold index **[M]** |
| either | uplink ticks between those steps; hub POSTs | M and N − M | ≥140–230 ms per POST; up to 60 s when the hub holds one **[I]** |

**Everything the bridge child does for readiness happens before M. N − M is entirely the plane's.** So the
hypothesis that the 4 s gap belongs to a just-started bridge does not hold up **[I, from code]**. The isolated
cold resume opened in 0.00 s **[M]**. The isolated warm mid-message opens waited 2 s **[M]**.

### Load sensitivity: what is CPU-heavy in the snapshot path

| candidate | on the subscribe path? | cost | holds |
|---|---|---|---|
| the mod's resync, in the session's JavaScript event loop | only at a cold start or after `lose`, never on a subscribe | the first resync is accepted 6–112 ms after the child starts **[M]** | the session's event loop, briefly |
| the child's snapshot | every subscribe | 0.01–0.12 ms under the lock; serialization outside the lock: 4 MB to 20 subscribers ≤ 240 ms **[M]** | the child's lock, for microseconds |
| the plane's page assembly (index, rows, look, derive, snapshot JSON) | every open | ms for 1 MB transcripts; 1.3 CPU-s for CI-opt **[M]**; the snapshot message is up to ~150 KB here **[M]** | the transcript's worker; the GIL, shared with the pump |
| the uplink's tick (hub POSTs, member refresh, presence scans) | every pump | ≥140–230 ms per POST **[M]**; up to 60 s held **[I]** | **the only thread that pumps** |

## 7. Weaknesses and the change that fixes each

The list is ordered by how much each would improve what the owner sees.

1. **The uplink pumps and POSTs on one thread, and opens a new TLS connection for every POST.** Opens and live
   deltas wait behind every hub exchange; one held POST stalls every subscription for up to 60 s.
   - *Fix.* Move posting to a sender thread fed by a queue: the pump never waits on the network, and batches
     pipeline.
   - Keep one persistent connection up to the hub: HTTP keep-alive or HTTP/2, or carry frames up the stream's
     own socket (a WebSocket).
   - Do not hold a POST's answer until the browser has its reply; acknowledge on receipt.
2. **The plane's open waits for the cut's row to reach disk, up to `NOTICE_WAIT`, then fails.** That cost
   measured 0.4–2.2 s, and becomes a failed open whenever a message streams more than 5 s after its first
   block's row is announced.
   - *Fix.* Do not gate the snapshot on the cut row. Snapshot the history up to the newest row on disk at or
     before the cut. Treat the announced-but-unwritten rows as live; the pool and Tail already release rows
     past the cut in disk order.
   - Until then, at least have the worker poll the file itself every 10–20 ms instead of waiting for the next
     0.25 s pump, so each wait does not cost a whole poll.
3. **A cold open indexes the whole transcript, and the index dies with every daemon restart.** The cost is
   1.3 CPU-s for a 317 MB transcript, and tens of seconds under load.
   - *Fix.* Serve the snapshot from the tail: read backward from EOF for the newest `ROWS_BUDGET` of rows and
     the cut, which is O(page). Build the full index, ledger and chain lazily, off the open path, for paging
     and jobs.
   - Persist the offset index beside the transcript, keyed by inode, size and mtime, and extend it, so restarts
     do not rebuild it.
   - Cancel a transcript job when its subscription goes.
   - Give opens priority over background work: run builds in a separate process or at lower priority than the
     pump.
4. **The open-line log mislabels where time went.** `the bridge's snapshot at M` is stamped at the pump, so a
   stalled uplink looks like a slow bridge.
   - *Fix.* Have `BridgeReader` stamp each line's arrival. Log the arrival time, the pump time, how many builds
     answered "waiting", and the cut's uuid. Then every future open line says which of mechanisms 1–4 it hit.
5. **The bridge hop makes one HTTP request per event.** That means a new Unix connection, a new child thread and
   an HTTP parse per delta: about 0.5 CPU-ms in the child and ~5 ms of engine-side fetch under load **[M]**.
   Most of the hop's tail lives here and in the event loop. The hop is already small, so this matters most
   under starvation.
   - *Fix.* Keep one connection: answer `POST /events` with keep-alive instead of `Connection: close`. Or
     better, a single long-lived NDJSON stream from the mod to the child, so each event is one write.
   - Coalescing flushes per microtask (or `setImmediate`) would cut the request count further without adding
     latency, because the one-in-flight poster already batches under load.
   - *Bigger version.* Move the child's role into the daemon. The mod then posts straight to the daemon's
     socket; that removes the per-session Python process, its 150–300 ms cold start, one hop, and the GIL
     handoffs, and lets the plane read the bridge's state in-process.
6. **The child serializes for each subscriber and wakes a thread per event.** It runs `json.dumps` once per
   event per subscriber, makes one `write` per line, and hands off through a queue and the GIL. 20
   subscribers fall behind at about 3,000 events/s **[M]**.
   - *Fix.* Serialize once in `_fan_out` and share the bytes. Let each writer drain its queue and write every
     pending line in one `sendall`.
   - This matters only for fan-out beyond the daemon; production has one subscriber, so it is low priority.
7. **A child crash costs 1.2 s, almost all of it the fixed respawn delay** **[M]**.
   - *Fix.* Respawn the first time with no delay, and keep the doubling backoff for repeated failures.
8. **A resync over 4 MB cannot be posted** **[I]**. `$.http.fetch` refuses a body over 4,194,304 characters,
   and the refused resync is queued again every 500 ms.
   - *Fix.* Cap or elide large streaming blocks in `resyncEvent()`. For example, send the tail of a long
     `input` block and mark it truncated. Or split the resync across posts.

## Reproduce

The scripts are kept in `bridge-bench/` beside this file, copied from `/private/tmp/bridge-bench/`, where the raw data stayed (it is not kept):

- `benchlib.py` holds the isolation (it loads `live-bridge-check.py`'s `Live`), the headless runner and the
  timestamping readers.
- `bridge_shim.py` holds the child's timing probes.
- `live_headless.py` plus `analyze_live.py` produced runs L1, Q1, Q2, C5 and C10.
- `onoff.sh` plus `analyze_onoff.py` produced runs ON1–4 and OFF1–4.
- `live_plane.py` plus `plane_open.py` produced runs P1–P4: plane opens, notice versus disk, the stall, the
  permission, the kill and the resume.
- `child_bench.py` with `sub_proc.py` is the standalone ceiling. Its results are in `child_bench.json` (load
  ~120) and `child_bench_quiet.json` (load 19–73).
- `resync_bench.py` with `sub_resync.py` is the resync cost.
- `real_index.py` timed the read-only builds of the real transcripts; results are in `real_index.jsonl`.
- `contend.py` is the concurrent-build open.

Raw per-run data is in `<tag>.meta.json`, `.stdout.tsv`, `.bridge0.tsv`, `.shim.log` and `.open-*.json`.
