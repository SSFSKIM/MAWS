# The desk — the project's place on the web (2026-10-15)

> **Parent:** root — an independent product grown from `.smns` alone
> (owner, 2026-10-15; §1). It lives in the MAWS repository as two apps of
> its pnpm workspace. **Level name:** Phase 1. **Consumes:** the
> `.smns` project log as built in doperpowers 7.153.0
> (`docs/doperpowers/specs/2026-10-13-smns-project-log-design.md`, cited
> below as *smns §n*); the MAWS renderer (`SSFSKIM/MAWS`, `src/renderer/`)
> as a UX source; the Arkho board service's API, as an outside source, for
> phase 2. Children dispatch per their grain hint, each carrying its
> section as its spec; each child's artifact opens by citing this document
> (path + child id + parent pin). This document is
> doperpowers:brainstorming's approved design (2026-10-15) extended in
> place: design up top, roadmap below. It was written in doperpowers and
> moved here, to the MAWS repository, when DC3 started (2026-10-15); the
> doperpowers children (DC2, DC4, DC7) cite it at this path. A path names
> its repository by its root: `skills/`, `hooks/`, `tests/sminos/`,
> `tests/mods/`, and the two files it cites under `docs/doperpowers/specs/`
> (the `.smns` design and DC1's findings) are doperpowers
> (`SSFSKIM/doperpowers`); `src/`, `apps/`, `scripts/ci-gate.sh`, and
> `docs/charter.md` are MAWS. Its child and contract ids carry a `D` (DC1–DC9, DX1–DX8)
> because MAWS's own charter already binds C1–C12 and X1–X8 in that
> repository.
>
> **Superseded in part, 2026-10-27.** The owner folded the desk into MAWS (MAWS P5, `docs/doperpowers/plans/2026-10-27-p5-org.md`). That retires this document's "not MAWS's web edition" ruling (§1). Its security model (one shared org key; §6, DX7) is replaced by the remote layer (`docs/doperpowers/specs/2026-10-26-remote-layer-design.md`). Desk Web keeps only the phone's cards (P5 §9). What P5 does not change stays in force.

## Purpose

The owner runs software projects as the host of a swarm: several
long-lived Claude Code sessions per project, each in charge of one part, on
more than one machine, with the human deciding, answering, and directing.
`.smns` made the project the unit — one identity, one append-only log of
everything that crosses sessions, a family with no join step, a daemon per
machine. What is still missing is the place where the human works with
that project. Today it is a terminal tab per session per machine, and SSH.

After this unit, a browser tab per project is that place at the desk, and
the same app on the phone's home screen carries what needs the owner when
they are away from it. The owner opens
the desk, sees every project with its machines and how many sessions are
working and waiting on them, opens one, and works there: a group chat of
everything the project's sessions said to the human, each session in depth
(its live transcript streaming token by token, its subagents, the diff of
its working tree), answering questions and permission prompts in place,
sending, steering, and interrupting as in the terminal, starting a session
on any machine and retiring one. One owner uses it; the data model is an
org from day one (an org of one), so collaborators, and later the product
for teachers that MAWS's co-work phase imagines, can follow without a
rewrite.

**To see it working.** With the daemon enrolled on two Macs and a project
whose `.smns` names the hub: open the hub's URL, sign in, open the project.
A `<message>` a session writes on one Mac appears in `# <project>` within
two seconds. Ask a session on the other Mac something that makes it call
AskUserQuestion; the question appears with its choices; click one, and the
session continues while the dialog in its terminal closes by itself.

### The scene at its best

Open MAWS: on the left `# MAWS`, then the sessions as direct channels
grouped by "waiting on you", "working", "idle", each with its machine and
what it is in charge of. The group chat streams: `maws-fe` reports a merged
migration; `maws-45` asks which column name to keep, with the choices as
buttons; a permission prompt from `cua_repl@mini` to run `pnpm e2e` sits
with Allow and Deny. You click a choice; `maws-45` resumes within a second.
Agent-to-agent traffic is one folded row, "4 messages between agents".
Open `maws-45`: your exchange with it, the work between your messages
folded as its working record; unfold it and the transcript streams, its
subagent tree beside it, the diff of its worktree one tab over. You type a
correction while it works and it reads it at its next step, without losing
the command it is running. "+ Session" asks for a machine, a checkout, a
worktree, a brief; seconds later the new session is in the sidebar, an
ordinary `claude --bg` job you could also attach to from that machine's
terminal. Later, laptop closed, the phone buzzes: `maws-45` asks something.
The notification only says so; tapping it opens the question's card in the
app, and the answer from the phone moves the session on the mini.

### What it must not be

- **A second copy of what sessions and repositories already hold.**
  Transcripts stay on the machine that ran them and are relayed on demand,
  never stored by the hub; git, PRs, and the board are read from their
  sources.
- **A host that changes how sessions run.** Sessions stay ordinary Claude
  Code sessions (terminal or `--bg`) on the unmodified engine, with every
  setting, hook, plugin, and skill exactly as in the terminal.
- **A log viewer with a send box.** Depth per session is this phase's
  scene.
- **Dependent on Anthropic's Remote Control**, which refuses a custom
  `ANTHROPIC_BASE_URL` and so cannot run behind the owner's gateway, and
  whose client endpoints are unpublished.
- **An open remote-execution surface.** The machine decides what it
  executes and verifies who asked; the hub routes.
- **Another project's child.** It is not part of Arkho, and it is not
  MAWS's web edition (owner, 2026-10-15). Arkho stays the board's service,
  read here like any other outside source; MAWS stays the local deep
  workstation, lends its agent UX, and hosts the code; afleet's Slack-like
  presentation (2026-09-03) is the taste precedent; Arkho's board UI and
  its A6 terminal-gateway design are prior art.

## Parent-Level Acceptance

Phase 1 closes when all of the following hold on the owner's two Macs and phone, with
the hub deployed, checked by hand and recorded with evidence in Outcomes.

1. **Projects.** Signed in through Access, the grid lists every project
   whose `.smns` names the hub; each card's machines-online and
   working/waiting counts match `sminos list` run on each machine (but for
   a session holding an open async question, which `sminos list` reads as
   busy and the grid counts as waiting too: DX3's grid, 2026-10-18), within
   2 seconds of a change, but for a machine whose stream dropped, which
   reads offline within two heartbeats, about 15 seconds on the deployed
   hub (MAWS #57's grace; the owner, 2026-10-21).
2. **Messages.** A `<message>` span written by a session on machine A is in
   the project's group chat within 2 seconds of the session's turn writing
   it, attributed to the session's alias and machine.
3. **Questions.** A session on machine B calls the native AskUserQuestion;
   the question and its choices appear in the group chat and in the
   session's channel; choosing one from the web makes the session continue
   with that answer, the terminal's dialog on B closes, and the transcript
   records the answer. The same for an async question from the ask mod.
4. **Permissions.** A session on machine A in `default` permission mode
   reaches a Bash call that needs approval; the prompt appears in the group
   chat with Allow and Deny; Deny from the web stops that call, the
   terminal's dialog closes, the transcript shows the denial, and the
   decision with who made it is in the hub's audit record. Answering in the
   terminal instead removes the prompt from the web within 2 seconds.
5. **Depth.** Opening a session's channel shows its live transcript with
   the model's text streaming as it is generated, a running subagent's text
   streaming in the subagent tree, and the diff of the session's working
   tree against its base branch.
6. **The three verbs.** Steer, typed while the session runs
   `python3 -c 'import time; time.sleep(60)'` (the engine blocks a long
   foreground `sleep`), does not stop the call, and the model acts on it at its next
   request; interrupt stops the running turn within 2 seconds; send to an
   idle session starts a turn whose prompt is the sent text, read by the
   model as the human's words.
7. **Spawn, retire, resume.** "+ Session" on machine B, choosing a known
   checkout and a brief, starts a `claude --bg` job that is in the sidebar
   within 10 seconds, carries the brief as its in-charge line, and can be
   attached with `claude attach` on B; retiring it from the web ends it and
   records `retired` with the owner as `by`. A terminal session the owner
   closed keeps its channel and history; a message sent to it shows as
   recorded, not delivered; Resume brings it back on its machine as a
   `--bg` job with the same session id, and it rejoins.
8. **The machine decides.** Each of these, placed at the hub without the
   org key (simulated by writing into the project's Durable Object
   directly), is refused by every daemon, and the refusal shows in the web:
   a `human` event, a `say` under another machine's writer, and an RPC. An
   Allow whose request card the hub altered (a different command shown than
   the one pending) is refused because its digest does not match. A spawn
   into a directory that is not a known checkout of the project on that
   machine is refused. On a machine set read-only, a send to a live session
   and to a stopped seat starts nothing and shows as not delivered.
9. **Offline.** With machine B's daemon stopped, B's sessions show their
   depth and presence as unavailable, everything they sent is still in the
   group chat, and an RPC to B fails at once with "machine offline".
10. **No loss across restarts.** Redeploying the Worker, restarting a
    daemon, and reloading the browser lose no log events and duplicate
    none: the counts of events per writer agree between each machine's log
    files and the hub after reconnection.
11. **The desk.** The owner works a day across the two Macs without
    opening a terminal for anything the sessions needed from them, and says
    so (a verdict, recorded in Outcomes with what still sent them to one).
12. **The phone.** With the laptop closed and the app installed to the
    phone's home screen, a question and a permission prompt raised by a
    session on the mini each push a notification to the phone; tapping one
    opens its card; answering from the phone continues the session, and
    the mini's terminal dialog closes.

## Design

Terms used throughout:

- **Hub** — the cloud service: a Cloudflare **Worker** (a serverless
  function that serves HTTP and holds connections) plus **Durable Objects**
  (Cloudflare's single-threaded stateful objects, each with its own SQLite
  storage and connection handling; one is addressed by a name, here the
  project id).
- **Access** — Cloudflare Access, the identity gate in front of the
  Worker; a **service token** is Access's credential for a non-human
  client.
- **Daemon** — `sminos daemon` (smns §8), one per machine, a launchd agent
  on macOS, a systemd user service on Linux (doperpowers #203, 7.159.0,
  proven on an Ubuntu VM against a local hub: logout with lingering, reboot,
  restart on new code); its **uplink** is the part that talks to the hub.
- **Bridge** — the doperpowers mod (a function-hook module the engine loads
  into every session when `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`) that gives
  the daemon control of the session it is loaded in.
- **Log plane** / **session plane** — §4.
- **RPC** — a request from the web to one machine that returns `done` or
  `failed` at once (§4).
- **SSE** — Server-Sent Events, a one-way HTTP stream from server to
  client.

### 1. Where it stands among the owner's projects, and what changes in `.smns`

**[binding — owner, 2026-10-15]** This is an independent product whose
root is `.smns` alone: not a child of Arkho, not bound to Arkho's roadmap,
and not MAWS's web edition. It shares a great deal with MAWS, so
convergences — a cloud-hosted web MAWS, the product for teachers — are
open possibilities, not commitments. For now it lives in the MAWS
repository, as two apps of MAWS's pnpm workspace (§2, Web client), and
follows MAWS's CI and rules there. The owner's earlier control surfaces
stay what they are and lend what they proved:
- **Arkho** (2026-08-04 on) is the board: its service (A1), plugin
  adapter (A2), board web UI (A3, live on Render since 2026-09-06),
  GitHub mirrors (A4), and cutover (A5) have landed, and its A6 design
  (approved 2026-09-13) bridges `claude attach` to a browser terminal
  through a per-host gateway. Its roadmap recorded "the human does not
  steer live sessions"; this product is built for steering them, which is
  how the owner works now (sminos seats, MAWS, `.smns`). Phase 2's board
  view reads the board service's API as an outside source; A6's design is
  prior art for phase 2's web terminal.
- **afleet** (2026-09-03) is the taste precedent for the Slack-like layout.
- **MAWS** (2026-09-28 on) stays the local deep workstation and lends its
  agent UX; its own P4 seed names "a cloud and web-hosted MAWS" and the
  product for teachers.
- **sminos hub** (2026-10-15, written in parallel in the MAWS repository)
  is discarded (owner); four of its ideas were imported (Decision Log).

`.smns` says twice that remote control of a session's process is not part
of it (smns §2, §9). This unit adds that control as a layer beside the log,
not inside it: the log stays what crosses between sessions and humans, and
control travels on the session plane.

### 2. Architecture

```
browser ──wss── Worker (web app, Access) ── Durable Object per project
                                              (log, presence, pending, routing, audit)
                       HTTPS, outbound only from each machine
     machine A: sminos daemon (uplink) ── unix socket ── bridge in each session
     machine B: sminos daemon (uplink) ── unix socket ── bridge in each session
```

**Hub.** The Worker serves the web app, admits humans through Access and
machines through service tokens, and routes connections to Durable Objects.
One Durable Object per project stores the project's log, holds its live
presence and pending requests in memory, routes RPCs and session-plane
subscriptions to the right machine, fans events out to browsers, and keeps
the audit record of decisions. A registry (one Durable Object per org)
holds the org, its members and roles, its machines, and its projects, and
streams the grid's per-project summaries, which project objects report to
it. One Durable Object per enrolled machine holds that machine's
connection; a project object reaches a machine through it (DC3's plan,
2026-10-15).

Cloudflare's limits shape the hub (Durable Objects documentation, read
2026-10-15): 1,000 requests per second per object (soft), 30 seconds of CPU
per request by default, 10 GB of storage per object, 2 MB per stored row
or string, 32 MiB per received WebSocket message; hibernation only when the
object is a WebSocket server, and on eviction "in-memory state is reset".
A deploy does not cut connections at once (measured, DC3's M5, 2026-10-15):
new requests reach the new version within seconds, but an object holding a
connection keeps running the previous one for about five minutes (+314 to
+329 s in three observations), and an object created soon after a deploy
can still read the previous deploy's variables. Then the objects restart:
browser WebSockets close, while a machine's SSE stream can stay open and
beating from the old instance as every POST reaches the new one and is
refused `stale-generation`. So:

- **Presence, the pending set, and delivery outcomes are kept in the
  object's storage**, not only in memory. A hibernating object can be
  evicted while its sockets stay connected; no reconnect follows, so no
  daemon republishes, and state held only in memory would be gone. The
  daemon's republish on reconnect still reconciles what storage holds.
  The same holds for each browser socket's identity, visibility, and
  subscriptions, which ride on the socket (its attachment) so a woken
  object can route again.
- **A machine is online while its lease is fresh**, renewed by its
  connection's heartbeat and fenced by a connection generation, not while
  a flag that a close callback would clear is set: an object can restart
  without running any cleanup, and the close it would have reported never
  arrives.
- **Every frame is bounded at 1 MiB**; a larger payload (a big tool result
  in a transcript row, a snapshot) is split into numbered parts.
- **After a deploy** browsers reconnect with backoff when their socket
  closes, and a daemon reconnects as soon as a POST of its stream is
  refused (`409 stale-generation` or `503 delivery-failed`, an `hb-ack`'s
  included), even while that stream still beats; it then republishes
  presence, pending requests, and unacknowledged RPC results (DX2, DX6).
  A deploy's new behavior reaches a busy object only when the object
  restarts, so a change that must take effect at once would end each
  machine's stream after the deploy (not built for phase 1).

**Daemon uplink.** **[binding — the hub never connects into a machine,
which is what makes the machine's own policy the execution boundary]** Each
machine's daemon holds the machine's only connection to the hub, opened
outbound and multiplexing the machine's projects: it syncs each project's
log, serves the session plane, and executes RPCs. The daemon's loop is
serial today (`cmd_run` and `tick_all` in
`skills/sminos/scripts/sminos_daemon.py`: git phases with 30-second bounds,
delivery, derivation, then sleep), so the uplink does not live inside it:
the daemon becomes concurrent, and an event that arrives from the hub
nudges delivery (`daemon/nudge` exists) instead of waiting for the next
tick. A thread in the daemon or a process beside it is DC4's call. The
transport is an HTTP pair, SSE down and POST up, which a Durable Object
holds as well as a WebSocket and which stdlib Python speaks without a
hand-written RFC 6455 client (fixed in DX2 by DC3's plan, 2026-10-15);
browsers use WebSockets.

**Bridge.** At session start it spawns a child for the session's life
(`$.process.spawn` of `sminos bridge --session <id>`), which serves the
session's endpoint on `$SMINOS_HOME/bridge/<session-id>.sock` in an
owner-only directory; the mod reads commands from the child's output line
by line, at any point in a turn, and streams the session's live events to
the child with `$.http.fetch` over that `socketPath`, where local clients —
the CLI, the daemon — send commands and subscribe (DC2's residue,
2026-10-15: local control then works without the daemon running, and the
daemon finds bridges by listing the directory): `turn.step` chunks for the
main loop and every subagent (`turn.step` is the only source of subagent
token deltas anywhere in the harness; the SDK wire streams the main thread
only), tool calls and results, turn boundaries, subagent lifecycle, usage,
and pending requests. **[binding — DC1's findings, measured on 2.1.300]**
- **Requests from outside go through `classic.PermissionRequest`**, which
  long-polls the daemon (looped under `$.http.fetch`'s 30-second bound; a
  `$` call in flight stops the hook's 10-second budget) while the
  terminal's own dialog stays open; a web answer closes the terminal's
  dialog within a second. A native AskUserQuestion is answered the same
  way, returning `updatedInput: {questions, answers}`: answering it from a
  `tool.call` hook instead ends the turn `aborted` under the doperpowers ask
  mod, and the `PermissionRequest` path works with or without it, so the
  order of the two mods' hooks no longer matters.
- **The bridge withdraws a request the terminal answered.** The engine
  does not tell the hook when the terminal answers first: the poll would
  run on and a late web answer would be silently ignored. The bridge
  watches for the request's end itself — the session record leaving
  `waiting`, the matching `tool.call` settling, `turn.complete` — then
  stops polling and settles the request with the terminal as the winner.
- **A background subagent's prompt gets a bounded window.** For a
  background subagent the engine awaits the hooks before it draws the
  dialog (no dialog for 40 seconds of polling in DC1), so the bridge waits
  at most 3 seconds there, publishes that deadline with the request, and
  after it the prompt is the terminal's alone.
- **A person-only prompt never reaches the hooks**; the web shows it as
  waiting in the terminal, from the session record.
- **A prompt the bridge submits** is drawn in the terminal as "› Prompt
  from the doperpowers plugin"; the model reads it as the human's words
  (`asUser`), and the web draws it as the human's.

The strongest alternative, inbox frames consumed by a `session.receive`
hook, lost: frames drain only at the next tool round, so a frame cannot
answer the permission prompt that blocks that round.

**Why a bridge and not an SDK host.** **[binding — owner, 2026-10-15]** A
per-machine host running sessions on the SDK stream-json wire (MAWS's engine
host) gives full control, but its sessions cannot be held by a terminal,
sessions opened in a terminal become read-only "foreign" sessions, and an
SDK-built product on subscription credentials sits near Anthropic's
February 2026 terms. The bridge keeps every session an ordinary Claude Code
session and reaches nearly the same control (§5), with more streaming than
the SDK wire gives.

*Revised 2026-10-19 (owner; Decision Log):* the terms leg no longer holds.
The owner confirmed that an SDK product on subscription credentials is fine
under the terms as of October. The terminal-holdable leg stands, and it is
why the bridge stays: it is how the web reaches sessions that the engine or
a terminal holds (lane A). Under #52 the web also serves MAWS's SDK-host
sessions (lane B), controlled by the MAWS daemon.

**Web client.** React, its skeleton copied from MAWS's renderer (React 19,
Zustand stores, TanStack Query; the transcript and its presentation model,
the request card, the composer, the attention model, the subagents panel,
the diff review). MAWS's presentation model reads stream-json; an adapter
turns transcript rows, `turn.step` chunks, and presence into the shape it
expects. **Where the code lives [binding — owner, 2026-10-15]:** the MAWS
repository, whose `pnpm-workspace.yaml` gains a `packages` list with two
apps beside the root Electron package — `apps/desk-hub` (the Worker and
its Durable Objects) and `apps/desk-web` (the web app). A MAWS component
kept free of Electron, Node, and `window.maws` (as `src/artifacts/` is,
lint-enforced) is imported as it stands; an entangled one is copied and
adapted. MAWS's gates (`scripts/ci-gate.sh`, its lint and typecheck) cover
the two apps. The strongest alternative, a new repository, lost: it would
copy everything and leave a later convergence to gather the copies back.

**Without the bridge.** A session has a bridge when its endpoint socket
answers; a live session in the registry with no answering endpoint after
a short grace takes the fallback. A `--bg`
seat keeps a great deal through the engine's supervisor (`control.sock`,
same-uid plus `~/.claude/daemon/control.key`): `reply` sends as the human,
queued for the next step, and answers a pending AskUserQuestion; presence,
spawn, and retire need no bridge. It loses permission decisions,
interrupt, model changes, and token streaming. A terminal session without
the bridge is read-only plus delivery as a cross-session frame (smns §4).

### 3. The two planes

**[binding — this split is what lets the log stay a record of facts while
control stays bound to the moment it was given]**

**The log plane** is durable and replicated: the `.smns` log (smns §3),
with the hub as its mirror. It carries what crosses between sessions and
humans: `human`, `say`, `message`, `question`, `answered`, and the
lifecycle (`joined`, `retired`, `in-charge`, `status`, `renamed`, `state`,
`titled`).
The group chat and the direct channels are drawn from it.

- **Sync** between a daemon and the hub is a version-vector handshake:
  each side sends `{writer: max seq}` per project, the other streams the
  missing suffix of each writer in seq order, inserts are idempotent on
  `(writer, seq)`, a gap (`seq` not one past the last) asks for a resend,
  and the connection then tails live. The project's Durable Object stamps
  every event it stores with a project **offset** (a counter in arrival
  order); browsers resume after an offset and never see writer vectors.
  This is Secure Scuttlebutt's feed replication without the gossip; it
  needs no conflict resolution because every file has one writer.
- **One writer per feed, enforced.** The git mirror's machine-name claim
  (smns §8, `check_claim` in `sminos_daemon.py`) runs inside git
  integration, which hub projects no longer use, so the hub replaces it: a
  machine enrolls under a name unique in the org (DX7), its daemon writes
  only under that name, the hub accepts from a machine's connection only
  events whose writer begins with that name, and an event arriving at an
  existing `(writer, seq)` with a different payload is refused and
  reported, never silently dropped. Two installations sharing a host name
  cannot both enroll it; the second picks another name.
- **Hub projects sync only through the hub.** **[binding — owner,
  2026-10-15]** A project whose `.smns` names a hub stops using the git
  mirror as a live path; the log is archived to the project's git remote
  on a schedule, and a new machine bootstraps from the hub. Two live
  transports writing the same writer files would bring back the conflicts
  one file per writer removed. A project without a hub keeps the git
  mirror as smns §8 built it. The cost: two machines on one LAN with the
  internet down no longer see each other's events. The archive is written
  by one machine the owner designates for the project (recorded in the
  registry, DX7), because a Worker cannot run git and the GitHub API would
  bind the archive to GitHub; that daemon copies the log files into an
  archive clone kept apart from the log directory and pushes, so git never
  feeds the live log. If the machine is retired, the owner designates
  another; one designated writer needs no lease.
- **Web writes.** A human on the web writes through the hub into a
  hub-held feed, writer `hub/<member-id>`, sequenced by the project's
  Durable Object (its one writer). `from` stays `"human"`, as everywhere in
  `.smns`, so every member still sees one host; `member` names which of the
  org's people wrote it. Every event the hub carries, from any writer,
  carries an authentication code (§6).
- **Sending to a session** is the existing `human` event, delivered by
  `deliver_next` (smns §4) with the bridge as its last hop
  (`$.prompt.submit({asUser: true})`). Delivery stays at least once, so the
  push carries the event's `(writer, seq)` and the bridge drops a repeat
  before submitting. A `human` addressed to a member that is no longer live
  follows smns §4 as built: a seat is resumed; a session sminos did not
  spawn, such as a terminal session the owner closed, is never resumed by
  a message (`push_member`: "it is the human's to reopen") — the message is
  recorded and the web shows it as not delivered. The session's channel
  offers Resume instead, an RPC that brings it back on its machine (§5):
  the human's explicit act of reopening.
- **Liveness of messages.** The bridge exports `<message>` spans and async
  questions as they complete, not at Stop. The Stop hook's `sminos record`
  stays as the fallback for sessions without the bridge, and the existing
  `(kind, src)` idempotency de-duplicates the two.

**The session plane** is live, served on demand, and not replicated.

- **Depth:** a session's transcript rows, its subagent tree and their
  transcripts, the streaming chunks, context use, and the diff of its
  working tree. When a browser opens a session, the hub asks its machine;
  the daemon answers from the transcript files (the engine flushes them
  every 100 ms), `subagents/*.meta.json`, and the bridge's stream, and the
  hub relays it, keeping at most a reconnect buffer in memory.
  **[binding — the hub never stores transcripts]**
- **Presence:** each session's `status` (busy, shell, idle, waiting),
  `waitingFor`, and `needs`, which the engine writes to
  `~/.claude/sessions/<pid>.json` the moment they change; the daemon
  watches those files and publishes changes at once. The sidebar's
  grouping and a card's counts read presence. The log's `state` events,
  written only after two ticks of persistence (smns §8), remain the record
  for a machine that is offline.
- **Pending requests:** a permission prompt or a question that is waiting.
  The bridge reports it, the project's Durable Object keeps the pending set
  in memory, and the daemon republishes its pending requests on reconnect,
  since the sessions are still blocked. The group chat shows a pending
  request in place; once answered it leaves the pending set and the
  transcript holds the outcome. Questions are also log events (`question`,
  `answered`, as smns §3 has them); permission prompts are not. Who decided
  what, and from where, is the Durable Object's audit record, not the log.
- **RPCs** are requests to one machine that return `done` or `failed` at
  once. **[binding — an interrupt, an approval, or an answer is only
  meaningful against the moment it was given]** An RPC to a machine that is
  offline fails immediately; nothing waits to run later. Spawn and retire
  record their effect as the `joined` and `retired` events they already
  write, with `by`.

A machine that is offline shows its sessions' depth and presence as
unavailable; everything they sent the human is still in the log.

### 4. The web, phase 1

- **Projects.** The home is the grid of the org's projects.
  **[2026-10-19, owner]** By default it shows the active ones: a project
  with a live session (`live`, DX3's grid) or waiting on you. Below the
  tiles, "Show all (N)", N every project, reveals the rest and becomes
  "Show active"; the browser keeps the choice in `localStorage`
  (`desk.grid.all`, beside `desk.depth`). The sort, "All sessions", the
  org's waiting count and the badge read every project either way, and a
  machine project follows the same rule. A tile online with nothing
  working or waiting says how many of its sessions are idle ("Quiet" with
  none).
- **A project.** Left: `# <project>`, then the sessions as direct
  channels, grouped by waiting on you / working / idle / ended (a session
  holding a pending request, or an open async question while its process
  runs, is waiting on you, its state word unchanged: 2026-10-18), each named
  by its title — the harness's "Session name", which its machine publishes
  as `titled` (smns §3, §5) — with its machine and whether that is online
  after it, and under it, muted, its alias, the name `@` addresses (alias
  and machine on one line while it has no title); then its in-charge line;
  "+ Session". Center: the selected
  channel — wherever its machine is online, the session view (§9; on the
  phone too since 2026-10-18). Right, on a desktop: the selected session's
  depth (subagents, background jobs, diff, session info: machine, cwd,
  worktree, model, context, cost; amended 2026-10-17, §9: the transcript
  tab moved to the center).
- **The group chat** shows what is addressed to the human: messages,
  questions (answerable in place), permission prompts while pending
  (decidable in place), lifecycle as system lines, and what humans posted.
  Traffic between agents folds into one row per run, expandable. Posting
  follows `sminos say` (smns §4): untagged is a record that wakes no one,
  `@alias` delivers, `@all` wakes every live member. **Amended 2026-10-19
  (owner):** it is drawn with the session view's rendering, and works as
  a group chat on top of it. The rows sit in MAWS's reading column with
  its typography. A session's message is MAWS's answer prose through its
  Markdown; a sender's consecutive messages, questions and requests within
  five minutes stand under one header (the title, the alias beside it only
  where it differs, the machine, the time of the first). The owner's own
  message is MAWS's user bubble on the right, each recipient's DX4 outcome
  in the bubble's foot under a hairline with the tail foot's glyphs, the
  bubble tinted only when every recipient's machine held it back or
  failed; a record kept for no one says so in the foot, untinted; another
  member's or a machine's human's message is a bubble on the left under
  who they are. A question is the session's request card while a request
  for it is pending here, and MAWS's question receipt otherwise — one
  line per question, "header (or the question) → answer", the answers
  read from the log's `answered` with MAWS's reader of the engine's
  summary and the headers from the request where this browser saw it —
  with a foot for what it waits on, or how its request was settled
  without an answer. Lifecycle is a quiet run: a session's consecutive
  events on one muted line, its words joined; a run past three lines
  folds behind "N updates · who"; a rename reads "old is now new" and a
  rename to the name the session has says nothing; a session's stop and
  restart stay in the quiet lines, never a line of their own between two
  messages (only a change between running and not is recorded at all).
  Traffic between agents is MAWS's lifecycle line for a message between
  sessions, a run of one drawn whole, more behind their count. A day
  separator stands where the calendar day changes, as the session view's
  time rows do. The composer's hint names the grammar in words, not the
  log's vocabulary ("Mention @alias to deliver, @all to wake every live
  session; untagged is kept here, delivered to no one").
- **A direct channel** is one session's exchange with the human — its
  messages, questions, and permission prompts, and what the human sent it —
  with the working record between them folded. **Amended 2026-10-17 (§9):**
  wherever its machine is online it is the session view, the MAWS report
  over the session's own transcript, folded per turn, with a Report ·
  Transcript toggle; the channel built from the log, as the to-human mod
  draws a session in the terminal, remains for a machine that is offline
  or serves no transcript, and the group chat is unchanged. **Amended
  2026-10-18:** this holds on the phone too (the phone, below); until then
  the phone drew only the log-built channel. An ended
  session's channel keeps its history, back to its first line, and offers
  Resume. A message the bridge submitted as the human's words is drawn as
  the human's.
- **The composer** has the terminal's three verbs. **Send** queues the text
  for when the session is idle. **Steer** puts it into the running turn at
  the next model request, without stopping the tool that is running, as
  typing mid-turn does in the terminal. **Interrupt** stops the turn. Beside
  them: model and compact. The strongest alternative, "steer = interrupt
  then send", lost: it kills the running tool, which the terminal does not.
- **The phone.** **[binding — owner, 2026-10-15]** The web app is also a
  PWA (a web app installed to the home screen, with a manifest and a
  service worker). On a phone it draws the loop of seeing what needs the
  owner and answering it: the grid with its waiting counts, the group chat,
  a direct channel, and request cards answerable in place. Session depth
  (the subagent tree, the background jobs, the diff) stays desktop-only.
  **[binding — owner, 2026-10-18]** A direct channel on the phone is the
  session view, as on a desktop (§9.1): the report with its per-turn
  working records unfolding in place, each tool call opening on a tap, the
  running turn streaming, the sends and request cards at its tail, and the
  desktop's fallbacks. This reverses the transcript clause above and its
  2026-10-17 reaffirmation, under which the phone kept messages only, its
  folds the label "Working record · on a computer", and never mounted the
  transcript: after a working day from the desk, that working record was
  the one thing that still sent the owner to a terminal (Decision Log).
- **Notifications are Web Push.** A push fires when a question or a
  permission prompt is raised, or a `<message>` arrives, and no browser of
  that member has the project open and visible. Each member device's push
  subscription is stored in the registry (DX7). The Worker sends with VAPID
  (ES256) and RFC 8291 payload encryption on WebCrypto; the npm `web-push`
  package depends on Node's crypto and does not run there. **A push only
  points to a card**: the service worker draws its text without the org
  key, so a notification carries no Allow or Deny; tapping opens the app,
  which checks the code and the digest as everywhere else. Actions on the
  notification would put the org key in the service worker, a §6 decision
  not taken. iOS delivers web push only to an app installed to the home
  screen (16.4 and later).

Visual design follows MAWS's tokens and density (Codex-density chrome,
Claude-style transcript typography, light first); the Slack-like layout is
afleet's. Taste-heavy surfaces are reviewed as mockups in the web children.

### 5. Control

| From the web | Plane | Path |
| --- | --- | --- |
| Send | log | the owner's `human` event → `deliver_next` → the bridge: idle, `$.prompt.submit({asUser: true})`; while a turn runs, `$.session.append` of a row read at the loop's next request, with one `[sminos bridge]` wake if the turn answers first; refused after an Esc, the session's inbox frame (doperpowers #233). A peer's event never takes this path: it goes to the session's inbox socket as a peer message closed by its reply line (doperpowers #236) |
| Steer | RPC | bridge `$.session.append` of a user row, read at the loop's next request: the owner's words under the line `[sminos steer from human]` [2026-10-18]; refused when no turn is running (the web offers Send instead); a turn that answers before any request read the steer gets one wake prompt, at most once per turn (DX5) |
| Interrupt | RPC | bridge `$.turn.abort` (the main loop's turn), then `TaskStop` through `$.tool.call` on each Bash of that turn the abort moved to the background, the main loop's and its foreground subagents' (a background subagent's never), as Esc kills it in the terminal; the result names the tasks stopped and any still running, and a task still running means the interrupt is incomplete |
| Answer a question | RPC | bridge: `classic.PermissionRequest` returning `updatedInput: {questions, answers}` for a native AskUserQuestion; the ask mod's external-answer path for an async one |
| Allow / deny | RPC | bridge `classic.PermissionRequest`, racing the terminal's dialog |
| Model, effort | RPC | bridge rewrites `model` and `effort` on each of the session's main-loop requests in `turn.step` (this session only; subagents untouched). The rewrite reaches the API verbatim, so `model` is a model id, a family alias the session's `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` maps, or `default`; an alias it does not map is refused, and the web offers ids. `$.config.set({key: 'model'})` was rejected: it also saves the model as the user's default in `settings.json` (DC1) |
| Compact | RPC | bridge `$.session.compact()`; asked during a turn, the bridge holds it and runs it at `turn.complete` (the engine refuses it mid-turn). It answers at once, queued or started; the outcome follows as the session's `compact` events (DX5) |
| Spawn | RPC | daemon runs `sminos spawn` (`claude --bg`) with brief, model, effort |
| Retire | RPC | daemon runs `sminos retire` |
| Resume an ended session | RPC | daemon runs `claude --bg --resume <session>` in the session's working directory with no other flags (a flag makes the engine start a copy, `claude_args` in `sminos.py`), serialized per session, after checking it is live nowhere; then verifies the session the engine reports is the same id and, if the engine started a copy (the owner reopened it in a terminal meanwhile), stops the copy and fails — the postcondition `resume_session` in `sminos.py` already checks for seats; it rejoins (smns §2) |

**[binding — one path means one behavior and one test surface]** Every
control goes through the bridge, for every kind of session. The owner's
sessions are mostly terminal sessions, for which the bridge is the only
path; the bridge is required regardless for permissions, interrupt, model,
and streaming. The supervisor's `control.sock` serves `--bg` seats only
when the bridge is absent (§2). The strongest alternative, routing send and
answer for seats through `control.sock` for its human-origin provenance,
lost: the model reads `asUser` text as the human's words, the web draws it
as the human's, and it would make a second internal, versioned surface
primary beside the mod API.

Every RPC that answers or decides a pending request carries the digest of
the request as the browser drew it, and the daemon executes it only if the
digest matches the request still pending in the session (§6).

**What each kind of session can do.** **[binding — the web reads this
table to show what a session cannot do and why, instead of failing when a
button is pressed; the acceptance timings cite it]**

| | bridged (terminal or `--bg`) | `--bg` seat, no bridge | terminal, no bridge | machine offline |
| --- | --- | --- | --- | --- |
| Send | log → `deliver_next` → `$.prompt.submit` when idle, `$.session.append` at the next model request when busy, the inbox frame after an Esc | `control.sock` `reply`, at the next step | cross-session frame, at the next tool round | in the log; delivered when the daemon reconnects |
| Steer | `$.session.append`, at the next model request | `reply`, at the next step | as send | fails at once |
| Interrupt | `$.turn.abort` and `TaskStop`, within 2 s | no | no | fails at once |
| Question | native: `PermissionRequest` racing the dialog; async: the ask mod's external path | terminal only: the supervisor's `reply` goes out with `nextTurn`, which queues a prompt rather than answering, and no path sends one without it in phase 1; async: none (the ask mod is itself a mod) | terminal only | shown, not answerable |
| Allow / deny | `PermissionRequest` racing the dialog; a background subagent's prompt within its 3 s window, then terminal only; a person-only prompt terminal only | terminal only | terminal only | shown, not answerable |
| Model / compact | per request / at the turn's end | no | no | fails at once |
| Stop a job **[DC10]** | `TaskStop` through `$.tool.call`, within 2 s | no | no | fails at once |
| Messages to the human | as each span completes | at Stop (the record hook) | at Stop | already in the log |
| Presence | the session record, within 1 s | same | same | the last `state` event, with its age |
| Depth | rows (100 ms flush) and `turn.step` chunks, subagents included | rows | rows | unavailable |
| Retire | `--bg`: `claude stop`; terminal: `retired` recorded, the process stays the human's | `claude stop` | `retired` recorded, the process stays the human's | fails at once |
| Resume (ended) | Resume RPC | Resume RPC | Resume RPC | fails at once |

**[2026-10-19]** The web offers Resume only once the session's machine is
known to serve its transcript (rows on the session's subscription; an empty
snapshot says nothing, since the plane sends one for a running session whose
transcript it cannot find): until then it is drawn disabled, and where the
machine answers that it holds none (`end {session-ended}` at n 0) it is not
offered, since
`claude --bg --resume` of a session with no transcript starts an empty one
(the owner's desk: a `--bg` copy that had taken a seat's name was resumed into
nothing).

Spawn is a machine RPC, not a session's; it fails at once for a machine
that is offline.

Not in phase 1, because the mod API cannot do them reliably: switching a
live session's permission mode, interrupting one subagent, rewind, and
fork.

### 6. Security, phase 1

- **Humans** sign in through Access in front of the Worker. The registry
  holds one org with the owner as its admin.
- **Machines** enroll with a one-time code the browser generates and the
  owner pastes into `sminos hub enroll` on the machine, which reads it from
  a hidden prompt or from stdin and refuses it as an argument: the code
  carries the org key, and an argument stays in the process listing and the
  shell's history. The code carries
  the hub's URL, a one-time token the hub exchanges for the machine's
  Access service token, the machine name to claim (§3), and the org key
  (below). The hub sees the token, never the key. Token and key live under
  `$SMINOS_HOME/daemon/` (mode 0600). The machine connects outbound only.
- **The daemon is the execution boundary.** It accepts only the RPCs of §5.
  It spawns only into checkouts of the project already known on that
  machine (the working directories its members joined from), with a
  permission mode no looser than the machine's ceiling (default: the mode
  the user's own settings give), and passes no arbitrary flags,
  environment, or shell. A machine's owner can set it **read-only**: it
  then executes no RPC and delivers nothing that came from outside it — a
  `human` or `say` written on another machine or on the hub is recorded in
  its log, settled undelivered, and shown in the web as not delivered,
  while events written on the machine itself are delivered as before.
- **Everything the hub carries that can cause execution is authenticated
  with a key the hub never holds.** **[binding — owner, 2026-10-15: web
  writes are signed; the spec review showed that signing only web writes
  still lets the hub forge peer messages, which drive delivery and resume
  just as `human` does (`_owed`, `push_event`, `push_member` in
  `sminos.py`)]**
  - *The org key* is a 256-bit secret drawn at random in the owner's
    browser when the org's first unlock method is set up. The hub keeps it
    only wrapped, once per unlock method, each copy under a key derived
    from the owner's passkey through the WebAuthn PRF extension, or from a
    passphrase where PRF is unavailable (DX7's wrapped keys); a browser
    holding any one method unwraps the same org key, and adding a method
    takes one already held. **[owner, 2026-10-15: one random key, locked
    per method, so a passkey and a passphrase open the same key.]** It
    reaches each machine only inside the enrollment code, by the owner's
    hand.
  - *What carries a code:* every log event on the hub, from any writer (the
    daemon adds the code when it uploads its machine's events; the browser
    when it writes a `human`); every RPC; every pending request and its
    settlement (DX4). The code is HMAC-SHA256 over canonical JSON (DX1, DX4,
    DX6). Daemons verify before importing an event into their log or acting
    on an RPC; browsers verify before drawing a log event or a request card.
    What fails is refused, reported, and kept out of the log.
  - *Approvals are bound to what was shown.* An answer or a decision RPC
    carries the digest of the request as the browser drew it (session,
    tool-use id, tool name, SHA-256 of the input), and the daemon executes
    it only if the digest matches the request still pending in the session,
    as the bridge reports it locally.
  - *Freshness.* An RPC older than 60 seconds is refused, and a daemon
    refuses a nonce it has seen; a web `human` event, which may arrive late
    after an outage, carries the nonce check only.
  - *Why a shared key and not per-member signatures:* the daemon is stdlib
    Python, which has no Ed25519, and phase 1 is one owner whose browser
    and machines are one trust domain. Accepted residual: an enrolled
    machine that is compromised can forge any writer, and it can already
    execute as the owner. The org phase moves to per-member asymmetric keys
    and an admin-signed member list.
  - *What remains:* a compromised deployment of the web app could read the
    key from the page. Session depth (transcripts, streams, diffs) is
    relayed without codes: it is display, and what the human approves is
    bound by digest.
  - *Alternatives rejected:* Access alone for one owner (the owner's
    ruling); end-to-end encryption of the log (Happy Coder's shape), because
    the hub must read `to` and `kind` to route and the org phase would need
    group key distribution.
- **The bridge's channel** is the session's endpoint socket in an
  owner-only directory; commands never travel as inbox frames.
- **No redaction layer**, as `.smns` ruled (smns §3). Transcripts pass
  through the hub and are not stored there.

### 7. Phases

1. **The desk** — this unit.
2. **The repository** — source control (worktrees, branches, commits,
   diffs), pull requests, the board view over the Arkho board service's API, and a
   web terminal in a session's working directory for break-glass, opened
   behind a step-up check (owner, 2026-10-15; until then SSH and
   `claude attach`).
3. **The org** — invitations, roles (viewer, member, operator, admin),
   signed member lists, people's presence, direct-channel privacy, and a
   review of what several people operating one member's subscription-backed
   sessions means under Anthropic's terms.
4. **Beyond** — convergence with MAWS's artifacts (documents, design
   systems) and the product for teachers, which the owner can picture
   merging with this (2026-10-15); the chief-of-staff agent; a native
   mobile app, wherever A7 sits (the web app is on the phone from phase
   1).

Phases 2–4 are this product's later units, each cut at its dispatch.

### 8. Delegated unknowns

1. **The bridge, live** (DC1) — **resolved 2026-10-15**: every primitive
   works on 2.1.300 in a terminal session and a `--bg` job; six work
   differently than v1 assumed, and §2 and §5 now say how (the findings
   file, `docs/doperpowers/specs/2026-10-15-arkho-desk-c1-findings.md`).
   The terminal does not draw a row appended by `$.session.append`, so the
   bridge mirrors each steer as a `$.ui.log` line and both surfaces show
   the same conversation.
2. **The uplink's concurrency** (DC4): thread against process. The
   transport was fixed at DX2 by DC3's plan (2026-10-15): the HTTP pair. Against SSE: an object holding a
   machine's open stream never hibernates and is billed for the whole time
   the stream is open; acceptable for a few machines, and the trade is
   recorded with the choice.
3. **Durable Object throughput** (DC3): streaming chunks from several active
   sessions through one project's object, measured (DC3.G6). **Resolved
   2026-10-15 (DC3's M5):** once a POST's frames for one project reach it in
   one call (MAWS `ebde4565`; before that a serial RPC per frame, about
   9 ms each, saturated a project at about 117 relayed chunks/s), a project
   object held chunk p95 ≤ 1 s up to 3,814 relayed messages/s and broke at
   twice that. The threshold, at half: **1,900 relayed messages/s per
   project object**, counted as each streaming session's chunks/s times its
   subscribed browsers (about four sessions at 150 chunks/s, three browsers
   each). One object per session is not the fallback: at the limit the
   project used about a quarter of one core, and what broke was the
   machine's uplink, whose serial POSTs carry about 600–750 frames/s. The
   lever past that is one shared stream per session in place of one per
   browser (a DX4 change), in the backlog.
4. **WebAuthn PRF and Access on the phone** (DC5): PRF support in the
   owner's browsers with an iCloud Keychain passkey, and inside an iOS
   home-screen app, whose storage is separate from Safari's, so the key is
   unwrapped again there; Cloudflare Access sign-in inside the standalone app
   (the identity provider's redirect leaves the app's scope, so the Access
   cookie must land in the standalone context); Access session lifetime
   against a push tapped hours later. The passphrase path covers missing
   PRF. Resolved by the owner's walk against the deployment (2026-10-15/16):
   a passkey with PRF unlocks the org key in Safari and Chrome on the Mac and
   in the iOS home-screen app; Access sign-in carries into the standalone app
   (it opened signed in); the passphrase unlocks in about 3 s on the Mac and
   the iPhone; a push arrives in about 5 s and its tap lands on the request
   card, where the answer reaches the machine; tapped 23 hours after the
   phone's last session, the app was still signed in, landed on the card, and
   the key was still unlocked. The phone is on iOS 26 or older, without
   native scroll anchoring (the channel's fallback, Decision Log).
5. **The path to watch.** The engine's channel servers (an MCP server
   declaring `claude/channel` that pushes messages into a session, which
   replies through a tool) are the engine's own shape for "an outside
   service talks to a session"; they are gated behind a flag and an
   Anthropic allowlist today. If they open, the send-and-answer half of the
   bridge can become a small server with native provenance.

### 9. The session view, history to the first line, and jobs (2026-10-17)

Found during the walk's Part I — the owner working a day from the desk
(acceptance 11) — and designed against a read-only survey of the code
(`docs/doperpowers/specs/2026-10-17-desk-session-view-survey.md`, 2026-10-17). Four gaps and one closed
door shape it:

1. Opening a session shows the log-built channel, whose folds unfold into
   a raw transcript box, while the component the desk already renders
   (MAWS's `Transcript`) carries MAWS's own report view, switched off only
   because the desk never passes `ownerLane`
   (`src/renderer/src/transcript/view/Transcript.tsx:286-298`,
   `apps/desk-web/src/depth/view/TranscriptPane.tsx:159`).
2. History stops at the join, because the direct channel reads the log and
   the log starts at `joined` (`sminos.py`'s `position_init` sets the Stop
   hook's export position to the transcript's end at SessionStart; the
   bridge exports spans only as they are written after it loads). The
   plane pages the transcript from disk, but each page re-parses the whole
   file on the uplink's thread (`sminos_plane.py` `page`, `rows_of`;
   `sminos_uplink.py:685-691`), and an ended session's subscription ends
   at the newest 512 KB (`finish`, `END_GRACE`): 2.15 s per full parse of
   a 156 MB, 12,704-row transcript measured; about 300 pages to its start,
   roughly 11 minutes of stalled uplink.
3. Every subagent that ran before the bridge loaded, and every nested one,
   has status "unknown" and sits under "On disk / status unavailable"
   (`task-graph.ts:416-421`, `:594`; `SubagentTree.tsx:41-45`), because
   only the held rows give a status and a nested agent's spawn row is in
   its parent's transcript; the plane also drops the bridge's agent state
   (`event()` handles chunk, block-row, row-seen, step, turn, usage, gap
   and nothing of `agent`, while the child keeps `agents` and puts it in
   every snapshot, `sminos_bridge.py:617, 661-667, 773`).
4. The desk shows no background shell, monitor or MCP server: no `$` API
   lists them (`$.mcp` has `call` and `connect` only; `$.agent.list()` is
   agents), MAWS's backfill emits task events for agents alone
   (`src/engine-host/fs/backfill.ts:255-284`), and a result carrying
   `backgroundTaskId` only patches a node that already exists
   (`task-graph.ts:314-320`).
5. **Closed:** the desk as a remote mod surface (9.6).

**9.1 The session view.** Opening a session whose machine is online, on
a desktop or (since 2026-10-18, §4) a phone, shows MAWS's report: `<Transcript>` over the session's
main subscription with its owner lane on, so `<message>` spans and
questions by default, one "Working record · N tool calls · M messages" row
per marked turn right after its prompt, with running dots while the turn
works (`owner/report/project.ts:44-73`, `OwnerRecordRow.tsx`, the labels of
`owner/report/copy.ts`), persistent rows kept in view (prompts, questions,
asks, boundaries, errors; `transcript/model/derive.ts:126-129`), an
unmarked turn drawn whole, and a Report · Transcript toggle. **[binding —
owner, 2026-10-17]** The fold is MAWS's per-turn shape. Rejected: the
terminal's cross-turn folds, which the log-built channel mimics today (a
run of working record between two rows the human reads, bounded by log
`src`s, `conversation/stream.ts:161-165`); they cost a subscription per
opened fold (`depth/connect.ts:12-14`) and a span-granularity clip of the
transcript (`depth/source/range.ts`), and with MAWS's shape the desk and
the desktop app draw a session alike by construction, one model behind
both, so a later change to the shape lands in both. It is one subscription and one virtualized
list; the parser already reads `<message>` (`shared/owner/to-human-parser.ts:120`).

Three pieces of MAWS's report do not come along, and the desk supplies
them: `ReportBar` returns null unless the owner-channel store, fed over
IPC, has the lane on (`stores/owner-channel.ts`, `ReportBar.tsx`), so the
desk's toggle is its own, calling `useTranscriptStore.getState().setView`;
mark states (answered, read) also ride IPC, so cards draw without them;
and MAWS classifies only `AskUserQuestion` and `mcp__maws__ask` as
questions (`transcript/model/classify.ts:38,41`), so doperpowers' ask tool
folds into the working record until one entry is added to that shared
table (9.5).

What only the log or the hub knows joins the transcript:
- **A send not yet in the transcript** — an outbox item, or a `human`
  event addressed to the session whose user row has not been observed —
  is a tail row: MAWS's user bubble with the delivery state in its foot,
  under a hairline, and the whole bubble tinted when the send will not
  arrive (`recorded`, `refused-read-only`, `failed`), a long reason in its
  tooltip. The owner chose it (2026-10-17) over a caption under MAWS's
  held-prompt shape (`derive.ts:131-135`, `heldRow`): a send that will not
  arrive is visible from a scroll away. The foot is a component of its
  own beside an unchanged bubble, since the owner means to suggest the
  same style to the MAWS app. **Delivered is not "the
  row exists"** (the review, 2026-10-17): the bridge answers `submitted`
  before `$.prompt.submit` resolves (`hooks/mods/bridge.tsx:451-476`; the
  submit is not awaited, and a `drop` comes later as `refused`), and the
  daemon maps that to DX4 `delivered` (`sminos_outcomes.py`, "pushed to
  the live session"), so a `delivered` outcome says the text entered the
  session's queue, not that its row is on disk. The tail row therefore
  stays, whatever the delivery state says, until a matching user row of
  the transcript is observed, and only then gives way to it. Matching is
  one to one — each send consumes at most one row, each row matches at
  most one send — and uses the event's identity first: the delivery frame
  the bridge submits names the event in its first line, `[sminos chat
  <project> <writer_short>:<seq> from human → @you…]` (`compose_chat_frame`,
  `event_ref`, `writer_short` in `sminos.py`; `hub/<member>:<seq>` for a web
  send, since a `hub/` writer has no session part), so a row whose frame
  names the send's `(writer, seq)` is its row; the only other match is an
  exact row id, the bridge's optional `delivered.uuid` (9.7). **A row
  without a frame never matches a web send** (the review's round 2,
  2026-10-17): a prompt typed in the terminal, a text that entered another
  way, is not the send's, however equal its text — a text-containment
  fallback was dropped, since "continue" typed and "continue" sent would
  take each other's row. So the tail row stays visible, with its state
  (sent; delivered, waiting for its row), until its own framed row or its
  named uuid arrives, and if none ever does — the session ends first, the
  frame never reaches the transcript — it stays as a delivered entry at
  the tail, ahead of the session's end marker, never silently hidden. A
  send whose delivery ends `failed`, `refused-read-only` or `recorded`
  keeps its tail row with that state; one whose submission the engine
  later refuses (`drop`) gets a second outcome for the same key, `failed`
  with the bridge's reason — the bridge's `delivered {outcome: "refused"}`
  reaches no DX4 outcome today (the child keeps `submitted` keys alone,
  `sminos_bridge.py:642-646`), so DC8 relays it — and the tail row shows
  that state; its row never comes. A row consumes a send only with
  affirmative delivery provenance: a bridge row whose origin is `plugin`
  or `asUser`, or an inbox queued command from `peer` or `plugin`. A typed
  or origin-less row never does, even when it carries the whole frame
  line; web sends exist only on engines that write the origin (DC9's M4
  review, 2026-10-17). On a reopened session whose history is not all
  held, a `queued`, `delivered` or `uncertain` send older than the oldest
  held row stays off the tail until the history is paged to its start
  (`more` false), and shows then if its row never came. Its row may be in
  the history not yet paged, and drawing it at the tail would misplace
  every past send. A `failed`, `refused-read-only` or `recorded` send has
  no row, so it always stays (DC9's M4, 2026-10-17). The accepted
  residual: a delivered send whose row never came before the session
  ended shows only once the reader pages to the start. Rejected:
  reconciling against rows not yet loaded, which needs the whole
  transcript on the web or a new DX4 lookup.
- **Pending requests** are request cards at the transcript's tail, after
  any tail sends, scrolling with it — the cards the channel draws today
  from the hub's pending set, so a request is answered in the session view
  as in the channel — with a "N waiting ↓" pill that jumps to them while
  the reader is scrolled up. The owner chose it (2026-10-17) over a band
  above the composer, which kept them in reach at any scroll but took
  about half the center with two open. They come after the last working
  record, so a request is never folded inside one. Rejected:
  synthesizing `permission.requested` and `question.requested` events into
  the source so MAWS draws `request_slot` rows at the call
  (`Transcript.tsx:229`, `derive.ts:1320-1323`): `request_slot` is a work
  row in MAWS's derivation (`derive.ts:743`), hidden under a closed
  working record in the report, so the request a turn is blocked on could
  sit folded; making it persistent is a change to MAWS's own report view
  with no evidence behind it. The cards are the channel's own, so the
  fallback channel draws them unchanged, and the phone draws them at the
  session view's tail as a desktop does.
- **An async question** (the ask mod's, `mcp__doperpowers__AskUserQuestion`)
  draws from its transcript row once classified; the log's `question` and
  `answered` events overlay it, joined by the event's `src`, the call's
  tool-use id (`stream.ts:7-8`). [2026-10-18, MAWS #49] Its answer draws
  where it reached the model, as a dim line `answered: <header> →
  <answer> · …` (`Skipped` for a declined dialog), on each of the ask
  mod's three routes: the plugin prompt of an idle session, never drawn
  as the engine's "The doperpowers plugin sent a message" bubble, and the
  context on a tool result or on the next prompt after a stop. The
  question's row takes the answer by call id when the log has none.
- **Lifecycle** stays in the header and the sidebar; the channel keeps an
  ended or retired session's end as one marker row at the tail.
- **Fallbacks.** An offline machine serves no transcript
  (`TranscriptPane.tsx:21`): the channel falls back to the log-built
  stream, which still says "everything it sent stays here"
  (`ChannelView.tsx:63-66`), its folds drawn as labels ("Working record ·
  <machine> is offline"), never as buttons. A subscription that ends at
  `n` 0 (no transcript for the session on that machine: a daemon older
  than DC8, a `/clear` that left the history under an old id) falls back
  the same way and says why. The phone has these two fallbacks and no
  other (§4 [binding], 2026-10-18; until then it always drew the log-built
  stream with "Working record · on a computer"); the group chat is
  unchanged.

**Streaming in the report** (the review, 2026-10-17). DC6 draws a
streaming block as a tail row with `turnId: null`
(`depth/view/streaming-rows.ts:14-20`), and the report reads turns: its
projection groups rows by `turnId` and reads live marks from the open
turn's live buffers (`owner/report/project.ts:33-48`), and a marked text
folds by its row's `turnId` (`transcript/surface/Rows.tsx:63-66`), so a
turnless streaming row is neither folded with its turn nor seen as a live
mark. DC9 bridges DX4's streaming identities into the report's turn and
live-buffer model: a main-loop block (`turnId, agentId null, step, index`)
belongs to the turn of the latest prompt row, and its text is the turn's
live buffer for that block, so the turn folds and the mark shows while it
streams; block settlement and de-duplication are unchanged — the
`block-row`'s row replaces the live row, and a settled block's chunks are
ignored. A subagent's block never reaches the main view (DX4). The means
is DC9's; the acceptance (DC9.G1) is the behaviour.

**The subscription moves.** The depth column owns the session's main
subscription today (`DepthColumn.tsx:40`), and its Subagents, Diff and
Info tabs are fed by it (`desk-transcript.ts:22-31, 401-409`). It moves
into one per-session owner that the center's session view and the column
share — one `DeskTranscript` per (machine, session) while any view holds
it; MAWS's store already shares one attachment per key
(`stores/transcript.ts:51`). `openSubagent` (`DepthColumn.tsx:51-64`)
becomes a small shared store, so an Agent row in the center opens the
column's Subagents tab; the status word (`:73-75`) moves to the center's
header. The column's Transcript tab goes; Subagents, Diff and Info stay;
a background-jobs view joins them (9.4). With the folds gone, these
retire: `FoldTranscript`, `depth/source/range.ts`, `export-marks.ts`,
`depth/view/unfold-turns.ts`, and DX8's `transcript` slot. Acceptance 5's
scene (the live transcript streaming, a subagent streaming in the tree,
the diff) is met by the session view's Transcript toggle and the column.

**9.2 History to the first line.** The plane already serves older rows
from disk; three changes make them reachable:
- **An offset index per transcript.** When a subscription first parses
  its transcript (`Tail.read` from offset 0 at `open`), the plane records
  each row's uuid, byte offset and length in file order, and extends the
  index as rows are flushed; one index per transcript file, shared by
  every subscription on it (two browsers on one session parse once), and
  dropped when the file is replaced or shrinks (`Reset`). `page(before)`
  then finds `before`, takes the newest rows before it that fit `limit`
  and `ROWS_BUDGET`, seeks to the first and reads through the last: a
  page costs its own bytes, not the file's. The index needs each row's
  uuid and byte span, not its parse; whether the build reads less than
  `json.loads` of every line is DC8's to measure (a tool result's own JSON
  can carry a nested `uuid` key, so a regex over the line is not a
  parse). Rejected: reading backward in blocks per page without an index,
  as the bridge child's `last_row` does for one row (`sminos_bridge.py:282-317`):
  each page would re-find `before` from the end, and the uuid set the
  plane keeps for de-duplication (`emitted`) is the index's cost already.
- **Pages and the open-time parse off the uplink's thread**, as `diff`
  runs (`sminos_plane.py:964-981`): a thread reads and parses the page's
  bytes, or builds the index and the snapshot at `open`, and hands the
  body to a queue; `tick` numbers and posts it. The open moves too because
  the session view subscribes whenever a session is opened, and on the
  MacBook one subscribe to a 254 MB transcript held the uplink's thread
  about 4 s (2026-10-17, measured on a copy of the machine's state), which
  with a slow tick is what starved its heartbeat answers before the
  acker thread (doperpowers #214) took them off that thread. Rejected:
  keeping the open on the thread because the index is built once per file
  — the first open of each large session is exactly the view's common case.
- **An ended session's subscription stays pageable.** Today `finish`
  sends `end {session-ended}` one second after the process is gone, `tick`
  drops the subscription, the hub forgets its route on `end`
  (`objects/project.ts`, `relay`), and `rows` for a sub the hub does not
  hold is passed over — so an ended session can never show more than its
  newest 512 KB (`desk-transcript.ts:354-357`, `:300-306`). Instead the
  subscription stays open and idle and answers `rows` until unsubscribed
  or ended by the machine going offline or a discontinuity; liveness comes
  from presence (`record` null: not running), which the web already reads
  (`TranscriptPane.tsx:21`). This amends DX4's `end {session-ended}`,
  which keeps only its `n` 0 meaning (no transcript for the session here).
  A session Resume brings back is a transcript-only subscription whose
  bridge now answers, which the plane already ends `discontinuity` for a
  fresh streaming one (`tick`). Rejected: a hub-side reconnect buffer or
  stored history (**[binding — the hub never stores transcripts]**, §3);
  and re-subscribing per page after `session-ended`, a snapshot's cost per
  page.

Sessions with no bridge are covered on two conditions: the session joined
the project from that machine, since the plane's `here` set comes from the
log (`sminos_plane.py:832-845, 926-930`), and the machine runs the current
daemon. Without an endpoint the subscription is transcript-only — reader
None, streaming empty, usage null (`:931-941`) — and the transcript is
found by session id (`sminos.py` `transcript_path`). Not covered: an
offline machine, an old daemon, history left under an old session id after
`/clear`. A session without the to-human style has no marks and draws as a
full transcript, as MAWS draws an unmarked turn.

**9.3 Subagents with real status.** One plane-side jobs index, built from
the parse `open` already does and kept current from the rows the
subscription releases, gives a status to everything whose start lies
outside the held rows; deriving it on the web cannot, since the web sees
only the rows it holds and a nested agent's spawn is in its parent's
transcript. Its sources, per transcript:
- the loop's rows: a `tool_result` for the meta's `toolUseId` (for a
  background agent the result is its start, and only a notification or a
  `task_status` ends it); a task-notification (a user row's
  `queued_command` attachment with `commandMode: "task-notification"`, or
  a plain user row whose text is the notification, the form the engine
  writes when it starts a turn on one — both read (DC9, 2026-10-17); a
  plain row counts only when its `origin.kind` is `task-notification` and
  its text is the notification, or, in a subagent's transcript, the
  engine's fixed `[SYSTEM NOTIFICATION - NOT USER INPUT]` preamble, a
  blank line, then the notification (DC8, 2026-10-17):
  `<task-id>`, `<tool-use-id>`, `<output-file>`, `<status>`, `<summary>`);
  a `task_status` attachment (`{taskId, taskType, description, status,
  deltaSummary, outputFilePath}`, observed for `local_agent`);
- a nested agent's outcome from its parent agent's transcript file
  (`subagents/agent-<parent>.jsonl`), where the nested call's result row
  and notification live: the `tool_result` for the nested `toolUseId`,
  read like the other disk facts, only when the parent file's size or
  mtime changed (the review, 2026-10-17);
- the bridge's agent state — DX5's `agent` spawn and stop events and the
  child's `agents` list with `running` — which the plane forwards instead
  of dropping; and, so agents that predate the module are in it, the
  bridge seeds that state from `$.agent.list()` at load and refreshes it
  while agents run, as `hooks/mods/agents.tsx:328-345` does (mandatory in
  DC8; the review, 2026-10-17);
- disk facts per agent transcript (`size`, `mtimeMs`, first and last row
  timestamps), read only when size or mtime changed: the plane already
  opens and parses every meta file twice a second (`metas`, `METAS_EVERY`),
  and the coordinator session's 158 agent files total 1.1 GB, so the index
  caches metas and file facts by (size, mtime) and each check is a stat.

The engine's raw status words are normalized by one table (DX4), the one
MAWS applies (`backfill.ts` `parseTaskNotification`, `task-graph.ts`
`statusOfPatch`), and evidence has a precedence (DX4; the review's round
2): an explicit terminal outcome in a row first; then known process death
— the session's process gone, the parent agent ended, the bridge
reporting the agent stopped without a terminal word — as `exited`; then
`running` or `pending` evidence from the rows or the bridge, which stops
counting once the session's process is gone; then `unknown`. A cold
reconstruction (a subscribe to an ended session) and a view that was open
while it ended reach the same status. `unknown` is allowed
only where no evidence exists, and those cases are named: a nested agent
whose parent is not over and whose parent transcript is gone or
unreadable; an agent of a running session without a bridge (no function
hooks) whose call has no result, notification or `task_status` yet; a meta
with no `toolUseId` and no spawn record (a loop the engine tracks as an
agent with no `agent.spawn`, such as a forked skill, per the mod API's
`$.agent.list()` note). The result rides in the existing `subagents` body,
widened (DX4), in the snapshot and in each `subagents` message, so the hub,
which relays it without reading it, changes nothing; the web patches a
node's unknown status from these facts on the desk side
(`depth/agents/task-feed.ts`), not in MAWS's `mergeSidecars`, which MAWS's
own store uses. Rejected: changing `mergeSidecars` (the desktop app's
sidecar semantics, that a sidecar says nothing of status, are right there);
polling the engine from the plane (no API lists another process's agents;
the bridge, inside the process, can).

**9.4 Background jobs.** Shells and monitors are read from the rows through
the same index — a Bash result whose `toolUseResult.backgroundTaskId` is
set, with "Output is being written to: <path>" in its text (MAWS's
`parseOutputPath`, `task-graph.ts:201-205`); a Monitor result's
`toolUseResult {taskId, timeoutMs, persistent}`; a task-notification or a
`task_status` for the task; a `TaskStop` call naming it (the bridge's own
interrupt makes that call, `bridge.tsx:322`) — and drawn with MAWS's
`ShellRow` and `MonitorRow` (`tools/agents/background/TaskRows.tsx`, which
import no IPC) in the column's jobs view. A shell's output is read on
request: DX3 and DX2 gain `output {taskId, tail}`, answered as a new DX4
kind `output` on the subscription, reading the task's output file — the
engine writes them under `<realpath of CLAUDE_CODE_TMPDIR or /tmp>/claude-<uid>/<project
slug>/<session id>/tasks/<task id>.output` (engine SPEC ch. 20, "the
shared per-uid temp root"; `/private/tmp/claude-501/…` as the
`task_status`, the notification and the Bash result each name it here) —
only for a task the loop's index holds, only at the path the session's own
rows named for it, and only when the resolved path of what is opened is
exactly `<taskId>.output` under one of the resolved canonical roots the
machine derives for that session from its own state (the engine's temp rule, the uid, the slugs of
the transcript's project directory and of the session's working
directories, the session id; DX4), besides carrying the
`<session id>/tasks/<taskId>.output` suffix. A symlink that keeps the
suffix but points elsewhere, and one to a file of another name, are both
refused (the review, 2026-10-17); an agent task's `.output`, which the
engine makes a symlink into the agent's transcript (SPEC ch. 20), is
refused the same way, since an agent's transcript is read through its own
subscription. The answer has explicit shapes for what is absent — a task
the index does not hold, a file that is gone or not yet named, a refusal
with its reason (DX4) — and a job's `outputFile` is null until a row names
one (a monitor names none at its start): asked for such a task, the
machine answers `missing` with no path, never `refused`, which stays the
containment refusal. The hub refuses a frame
it does not know (`objects/project.ts` `dispatch`, `bad-shape`) and a
session message of a kind it does not list (`:391-392`,
`SUBSCRIPTION_KINDS`), and the uplink passes an unknown frame by
(`sminos_uplink.py:587`), so the hub ships before any uplink answers
`output`, and an old daemon under a new hub simply never answers. A job's
output opens under its row in the column, a few lines high, the list
staying in view (the owner, 2026-10-17, over the column's whole pane).
Stopping a job from the web is not in this round: MAWS's rows draw Stop
on a running job, and the desk draws it disabled with its reason,
"Stopping a job runs from its terminal" (§5); web Stop (DX6 RPC → bridge
command → `$.tool.call({tool: 'TaskStop', task_id})`, the call the bridge
already makes) is the first follow-up once DC8 and DC9 land (the owner,
2026-10-17); it is DC10. MCP servers appear by name only, from the rows'
`mcp_instructions_delta` attachments (`addedNames`, `removedNames`); their
status needs the SDK host's `mcp_status` (MAWS `engine-host/controls.ts`),
so it is deferred.

**9.5 Shared MAWS edits**, each a small separate PR to MAWS, since each
changes the desktop app too: the classify entry, so
`mcp__doperpowers__AskUserQuestion` is a question
(`transcript/model/classify.ts`); and shell and monitor starts in MAWS's
backfill (`engine-host/fs/backfill.ts`: a Bash result with
`backgroundTaskId` as `task.started` of `local_bash`, a Monitor result's
`taskId` as `task.started` of a monitor, `task_status` read), so MAWS's own
disk-only sessions gain them. **The second left DC9 (2026-10-17):** its
review found backfill alone delivers nothing — the desktop app's
background-task store reads only sidecars and workflow runs for a
disk-only session, rejects events without a `seq`, and BackgroundTool
hides a job without an engine status, by C8b's documented line "shells
and monitors are known only while the session runs here". Delivering it
is a product change to the MAWS app (a disk-only `session.events` read,
an exited rule, the live gate dropped, Stop hidden for a reconstructed
job), its architect's to decide, and the desk does not need it (its jobs
come from DC8's body), so the backfill branch (`desk-backfill-jobs`) is
parked for that follow-up rather than landed without a consumer.

**9.6 Rejected: the desk as a remote mod surface.** MAWS's engine host
attaches as surface `"desktop"` over `ui_attach` and asks `ui_render` per
row (`src/engine-host/surface.ts:1-75`, `controls.ts:107-119`,
`renderer/src/engine-surface/site.ts:15-55`). That protocol is part of the
engine's stream-json control channel, advertised only when the session is
not on a remote transport (`docs/doperpowers/evidence/ux-2026-10-01/r6-claude-mods.txt:21,
279-280`), and only the process's SDK host holds it: a terminal `claude`
session or a seat exposes nothing the uplink could attach to, and from
inside the session the bridge cannot stand in, since `$.ui` has no `render`
(`ui.render` is an event in `EventCalls`, never a method on `$`; mod API
declarations 2.1.300). Were it possible it would cost a round trip per row
through browser → hub → uplink → engine, serve live sessions only (no
history for ended or offline ones), and `ui_press` would run mod handlers
from the web, a new trust surface under §6. Reuse of the MAWS model already
in the bundle is the route. Revisit only if the engine adds a render call a
mod can make, or a surface transport for terminal sessions.

**9.7 Optional**, in DC8 if its cost is small: the bridge's `delivered
{key, outcome: "entered", uuid}`, emitted once the submitted prompt's row
is named by `session.append` (`PromptSubmitResult` carries no row id), for
an exact match of a delivered send to its row where the frame's identity
(9.1) is not enough. DC8 built it and leaves it on the bridge's stream
(2026-10-17): the frame's `(writer, seq)` matched all 174 bridge
deliveries in this machine's transcripts, so the uuid matters only where
the engine rewrites a frame, and carrying it to the web needs a contract
change — a `row` on DX4's sealed `delivery`, a hub change, or a relay
message on the main subscription — deferred; meanwhile such a send's tail
row stays, visible, as §9.1 says. The `$.agent.list()` seed, optional in the first
draft, is mandatory (9.3; the review, 2026-10-17): without it an agent that
predates the module has no evidence while it runs.

## Children

### DC1: Bridge spike — spike (findings, never a merge)

- **Purpose:** Prove, in real sessions on 2.1.300, that a mod can do what
  §2 and §5 assume, before two children build on it.
- **Acceptance:** findings recorded in
  `docs/doperpowers/specs/2026-10-15-arkho-desk-c1-findings.md` and folded
  into this spec's Surprises & Discoveries, with evidence, for each of: a
  session-lifetime child started with `$.process.spawn` whose output lines
  reach the mod at any point in a turn (idle, mid-model-call, mid-Bash);
  `$.prompt.submit({asUser: true})` from a timer starting a turn in an idle
  session; `$.session.append` mid-turn read at the next request, and whether
  the terminal draws it; `$.turn.abort` stopping a running turn; a
  `classic.PermissionRequest` hook long-polling a local socket and
  answering while the dialog is open, and what happens when the terminal
  answers first; the same for a background subagent's prompt, whose hooks
  the engine awaits before it opens the dialog
  (`awaitAutomatedChecksBeforeDialog`, SPEC 2.1.287 ch. 18), so a long poll
  there hides the terminal's dialog, and what bound keeps it visible; that
  a prompt marked person-only never reaches the hooks (SPEC ch. 24); a
  `tool.call` hook answering a native AskUserQuestion with
  the dialog open; `$.config.set` switching the model; `$.session.compact()`
  between turns and during one; `turn.step` chunk rate with two subagents
  running; all of it in a terminal session and in a `--bg` job. Verdict per
  item: promote, promote with a change to this design, or discard with the
  fallback.
- **Edges:** blocks DC2.
- **Contracts:** —
- **Design inheritance:** §2 Bridge, §5, §8 unknown 1.
- **Required:** required.
- **Status:** landed (2026-10-15; findings folded).

### DC2: The bridge — plan

- **Purpose:** Every session on a machine becomes controllable by that
  machine's daemon, and the daemon sees its live events and its pending
  requests: the mod, its session-lifetime child, and the daemon's local
  endpoint, usable from the CLI before the hub exists.
- **Acceptance:**
  - **G1 (local protocol):** DX5 written into Interfaces and reviewed; DC7
    may start on it.
  - **G2 (local control):** on one machine, without a hub, sminos verbs
    drive a terminal session and a `--bg` job: `sminos steer`, `sminos
    interrupt`, `sminos answer`, `sminos decide`, `sminos model`, `sminos
    compact` act as §5 says, a compact asked during a turn running at its
    end, an interrupt also ending a Bash the abort backgrounded, a model
    change staying in this session (the user's `settings.json` untouched),
    a steer mirrored in the terminal; `sminos
    answer` also answers an async question from the ask mod, through an
    external-answer path added to `hooks/mods/ask.tsx`; `sminos watch
    <member>` prints the live stream (text chunks, subagents included); a
    `human` delivered by `deliver_next` to a bridged session arrives as the
    human's words, once, under redelivery; a session without the bridge
    falls back per §2.
  - **G3 (settlement):** every request the bridge reports as raised is
    followed by a settlement naming the side whose answer the engine used,
    in four cases: answered from the CLI first, answered in the terminal
    first, both at once, and the daemon reconnecting after the request was
    answered.
  - **G4 (export):** `<message>` spans and async questions reach the log as
    they complete, de-duplicated against the Stop hook's export.
- **Edges:** blocked-by: DC1; blocks: DC7.
- **Contracts:** DX5 (owner), DX4 (producer), DX1 (writer of `message` and
  `question`).
- **Design inheritance:** §2 Bridge and Without the bridge [binding], §3
  sending and liveness of messages, §5 [binding], §6 bridge channel.
  Advisory: `hooks/mods/bridge.tsx` beside the other mods, registered in
  `hooks/mods/register.tsx`; DC1's probe (`/tmp/c1probe`, kept as evidence)
  is a working starting point for the child, the stand-in daemon, and the
  drivers (`/tmp/c1tools`). DC1's measured rates bound DX5: 50–70 chunks a
  second per streaming subagent, a post to the daemon p50 1–3 ms, p95 at
  most 35 ms.
- **Required:** required.
- **Status:** merged (2026-10-15; PR #195, `a6c90a13`, 7.155.0).

### DC3: The hub — plan

- **Purpose:** The cloud side: the Worker, the project Durable Objects, the
  registry, Access for humans and service tokens for machines, enrollment
  and machine names, log storage with sync, the session-plane relay, RPC
  routing, the pending set, the audit record, Web Push sending and push
  subscriptions, and a fake machine for the web children.
- **Acceptance:**
  - **G1 (protocols):** DX2, DX3, the DX4 envelope, the DX6 shapes, and DX7
    written into Interfaces and reviewed; DC4 and DC5 may start on them.
  - **G2 (log):** a fake machine speaking DX2 syncs a project's log in and
    out across reconnects and Worker redeploys with no loss and no
    duplicates; a browser client resumes after its offset; an event under
    another machine's name is refused at that connection; an event at an
    existing `(writer, seq)` with a different payload is refused and
    reported.
  - **G3 (routing and requests):** RPCs reach the named machine's
    connection and return `done` or `failed`; an RPC to a machine without a
    connection fails at once; session subscriptions relay to the subscribing
    browsers; a settlement removes its request from the pending set, and a
    request the daemon no longer republishes after a reconnect is dropped;
    the audit record holds the side that actually won, from the settlement,
    not the web's attempt; the latest delivery outcome per event and
    recipient is kept and returned to a browser that reconnects; an RPC
    whose machine dropped after forwarding is `uncertain` until the daemon's
    republished result resolves it; presence and the pending set survive
    the object's eviction while sockets stay open; a raised question or
    permission prompt, or a `<message>`, sends one Web Push to each of the
    member's subscribed devices when no browser of theirs has the project
    visible, and none when one has.
  - **G6 (measured):** three fake machines streaming chunks every 100 ms
    into one project, with several browsers subscribed; the report gives
    chunks per second per object, the fan-out cost, and the threshold at
    which the session plane moves to one object per session. **[measured
    2026-10-15]** 1,900 relayed messages/s per project object; the nearer
    limit is a busy machine's uplink, not the object (§8 unknown 3).
  - **G4 (deployed):** deployed to the owner's Cloudflare account behind
    Access; enrollment issues a service token and claims a machine name,
    refusing a name already enrolled; the designated archive machine is
    recorded per project; the fake machine works against the deployment.
  - **G5 (fake machine):** a tool that replays a recorded session
    (transcript JSONL, presence, pending requests and their settlements,
    delivery outcomes, two subagents) through DX2 under the DX4 subscription
    semantics, with the org key, including a chunk that arrives while a
    snapshot is being built, so DC5 and DC6 develop and test against the real
    protocol without a Mac.
- **Edges:** blocks: DC4, DC5 (start at G1; acceptance needs G5), DC6
  (acceptance needs G5).
- **Contracts:** DX2, DX3, DX7, the DX4 envelope, the DX6 shapes (owner); DX1
  (stores, never alters).
- **Design inheritance:** §2 Hub, §3 [binding parts], §6, §8 unknown 3.
- **Required:** required.
- **Status:** merged (2026-10-15; MAWS PR #14, `c4d4458e`; deployed `hub@b11ea5f8 web@smns-erb-web.3de8a15e`).

### DC4: The uplink — plan

- **Purpose:** The machine's connection to the hub and the log plane over
  it: the daemon becomes concurrent, enrolls, syncs hub projects' logs with
  authentication codes, and writes the archive.
- **Acceptance:**
  - **G1 (enroll):** `sminos hub enroll`, given the code at its prompt or on stdin, enrolls a machine under its
    claimed name and stores the token and the org key; `sminos project init
    --hub` writes the `hub` field; a second installation with the same host
    name is refused at enrollment and told how to pick another name.
  - **G2 (sync):** a hub project's log is identical (per-writer event
    counts, last seq, and payload) between two machines and the hub after
    each of: a burst of `say` on both, a daemon restart, a dropped
    connection; a fresh machine bootstraps the project from the hub; the
    daemon never fetches git for a hub project; an event without a valid
    code is refused before it enters the log, including a forged `say`
    under another machine's writer, an authentic event of one project
    replayed into another project's feed, and a `hub/` event with a field
    its code does not cover (such as `via` or `msg_id`); a hub-less
    project's git mirror behaves as before (the existing sminos suite
    passes).
  - **G3 (archive):** the designated machine writes the log to the
    project's git remote on schedule from a clone outside the log
    directory; no other machine pushes it.
  - **G4 (concurrency):** a slow git phase of a hub-less project or a
    derivation does not delay the uplink; an event arriving from the hub
    nudges delivery at once.
- **Edges:** blocked-by: DC3.G1; blocks: DC7.
- **Contracts:** DX1 (verifier and uploader), DX2 (consumer), DX7 (consumer).
- **Design inheritance:** §2 Daemon uplink [binding: outbound only, sole
  connection], §3 log plane [binding parts], §6 org key, §8 unknown 2.
- **Required:** required.
- **Status:** merged (2026-10-15; PR #194, `9e7d3d30`, 7.156.0).

### DC5: The web — projects and the conversation — plan

- **Purpose:** The web app's shell and everything drawn from the log plane:
  sign-in, the org key, the project grid, the project view, the group chat,
  direct channels, the composer's three verbs and model and compact,
  request cards for questions and permissions, the spawn, retire, and
  resume actions, notifications.
- **Acceptance:**
  - **G1 (shell):** MAWS's renderer skeleton copied and building as a web
    app served by the Worker, with DX8 written into Interfaces; the grid and
    the project view against DC3's fake machine.
  - **G2 (conversation):** group chat and direct channels draw a replayed
    project's log as §4 says (folding, the addressing grammar, system
    lines, an ended session's channel with Resume, controls a session
    cannot use shown disabled with the §5 table's reason, an `uncertain`
    RPC drawn as such and retried with its nonce); composer verbs and
    request cards issue authenticated DX1 events and DX6 RPCs, request cards
    carry the digest of what they drew, and results render; an event or a
    request whose code fails is not drawn; a send shows its DX4 delivery
    outcome per recipient, including after a reload; when the fake machine
    disconnects, its sessions' presence and depth show as unavailable while
    the conversation stays.
  - **G3 (the key):** the org key is drawn at random once and kept at the
    hub wrapped per unlock method (DX7); a passkey through PRF or a
    passphrase unwraps the same key in any of the owner's browsers, a
    method is added only by a browser that already holds the key, and the
    enrollment code it produces enrolls a machine through DC4.
  - **G4 (the phone):** installed to an iPhone's home screen, the app signs
    in through Access, unwraps the org key, and draws the grid, the group
    chat, a direct channel, and request cards in mobile layouts; a question
    raised by the fake machine pushes a notification that opens its card,
    and the answer from the phone reaches the fake machine authenticated.
- **Edges:** blocked-by: DC3.G1 to start, DC3.G5 for G2; blocks: DC6 (at G1).
- **Contracts:** DX8 (owner); DX3, DX4, DX7 (consumer); DX1, DX6 (author, with
  codes).
- **Design inheritance:** §4, §5, §6 [binding], §8 unknown 4. Advisory:
  taste-heavy surfaces (the grid card, the folded agent-traffic row, the
  request cards) go to the owner as mockups before polish.
- **Required:** required.
- **Status:** merged (2026-10-16; MAWS PR #13, `76b1de782`). Amended
  2026-10-17: on a desktop browser whose machine is online the direct
  channel's center becomes DC9's session view; the log-built channel stays
  for the phone, an offline machine, and the group chat (§9). Amended
  2026-10-18 (MAWS #55): the phone takes the session view too; the
  log-built channel stays for an offline machine, a subscription that ends
  at `n` 0, and the group chat (§4).

### DC6: The web — session depth — plan

- **Purpose:** The right-hand depth of a session: the live transcript with
  streaming through the adapter into MAWS's presentation model, the
  subagent tree with each subagent's transcript and stream, the diff of the
  working tree, session info.
- **Acceptance:** against DC3's fake machine replaying a recorded session
  with two subagents: the transcript streams and settles into the same
  rows a reload shows; the subagent tree matches the session's
  `subagents/*.meta.json`; the diff renders; a reconnect mid-response, a hub
  restart, and a chunk arriving during the snapshot each end with no gap
  and no duplicated text, in the main thread and in a subagent.
- **Edges:** blocked-by: DC5.G1 (DX8), DC3.G1 to start, DC3.G5 for acceptance.
- **Contracts:** DX8, DX3, DX4 (consumer).
- **Design inheritance:** §2 Web client (the adapter), §3 session plane, §4
  right panel.
- **Required:** required.
- **Status:** merged (2026-10-16; MAWS PR #12, `1a06f2d9`). Amended
  2026-10-17: DC9 lifts the main subscription out of the column, retires
  the Transcript tab, the fold (`FoldTranscript`, `range.ts`,
  `export-marks.ts`, `unfold-turns.ts`) and DX8's `transcript` slot, and
  adds the jobs view (§9).

### DC7: The machine's controls — plan

- **Purpose:** The session plane and the RPCs on the machine side: presence
  from the engine's session records, subscriptions served under the DX4
  semantics, pending requests and settlements relayed with codes, the RPCs
  of §5 verified and executed through the bridge, the machine's policy, and
  Resume.
- **Acceptance:**
  - **G1 (session plane):** presence changes reach the hub within 1
    second; a subscribed session's snapshot and live stream follow DX4,
    verified by a reconnect mid-response, a Worker restart overlapping
    transcript flushes, and a chunk arriving while the snapshot is being
    built, each including a subagent stream; pending requests
    and their settlements reach the hub with codes and are republished on
    reconnect.
  - **G2 (RPCs):** each RPC of §5 executes through DC2's protocol; an RPC
    without a valid code, older than 60 seconds, or with a seen nonce is
    refused and the refusal reported; an answer or decision whose digest
    differs from the pending request is refused; cutting the connection
    after execution, or restarting the daemon between execution and report,
    shows `uncertain` on the hub and then resolves, the RPC executed once; a
    spawn retried with its nonce after a cut yields one session.
  - **G3 (policy):** a spawn outside the known checkouts or above the
    ceiling is refused; on a read-only machine every RPC is refused, and a
    `human` or `say` from outside the machine, addressed to a live session
    and to a stopped seat, starts nothing and settles undelivered; every
    delivery of an outside-origin event produces its DX4 `delivery`
    outcome (delivered, recorded for a closed terminal session,
    refused-read-only, uncertain), which the web shows; a message recorded
    for a closed terminal session is delivered when Resume brings it back,
    and its outcome turns `delivered`.
  - **G4 (resume):** Resume brings an ended terminal session back on its
    machine as a `--bg` job with the same session id, which rejoins; it is
    refused while the session is live anywhere and on a read-only machine;
    two Resumes at once start one session; a Resume racing the owner
    reopening the session in a terminal ends with one session holding that
    id, any copy stopped, and the RPC failed with the reason.
- **Edges:** blocked-by: DC2.G1, DC4; blocks: — (integration at
  recomposition).
- **Contracts:** DX6 policy (owner); DX4 (producer); DX5, DX2 (consumer); DX1,
  DX6 (verifier).
- **Design inheritance:** §3 session plane [binding], §5 [binding], §6
  [binding: the daemon as boundary, codes, digests, read-only].
- **Required:** required.
- **Status:** merged (2026-10-15; PR #196, `af3a5573`, 7.157.0).

### DC8: The machine — history and jobs — plan

- **Purpose:** The session plane serves a session's whole history and knows
  what the session is running: an offset index per transcript, pages and
  the open-time build off the uplink's thread, an ended session's subscription that stays
  pageable, the jobs index (agents, shells, monitors, MCP names) carried in
  the widened `subagents` body, the bridge's agent state forwarded and
  seeded from `$.agent.list()`, a submission refused after `submitted`
  reported as a `failed` delivery, and the `output` request; optionally
  the bridge's `delivered.uuid` (§9.7).
- **Acceptance:**
  - **G1 (pages):** on a transcript of at least 150 MB and 10,000 rows (the
    coordinator session's, 156 MB and 12,704 rows, where one full parse
    measured 2.15 s), with a subscription open: each `rows` page is
    answered within 200 ms of the frame reaching the daemon, measured over
    paging from the newest row to the first line; the uplink's heartbeat
    answers and presence keep their bounds (DX2; DC7.G1's 1 s) throughout;
    the index is built once per transcript file — a second subscription on
    the same transcript builds nothing — within the time of one full parse
    today, the measured figure recorded, and off the uplink's thread: a
    subscribe to that transcript leaves the heartbeat answers, presence and
    deliveries within their bounds while its snapshot is built; a transcript replaced or shrunk
    drops its index and ends its subscriptions `discontinuity` as today;
    live rows flushed after the open are pageable in their turn.
  - **G2 (ended sessions):** a session that ends while subscribed sends no
    `end`: its last flushed rows arrive, the subscription stays idle and
    answers `rows` back to the first line, `presence` says the session is
    not running within 1 s, and `unsubscribe` ends it; a subscribe to a
    session with no process (a closed terminal session, a stopped seat) is
    served a snapshot from disk and pages the same way; a session Resume
    brings back ends its transcript-only subscription `discontinuity` and
    the fresh one streams; `end {session-ended}` is sent only at `n` 0,
    for a session whose transcript the machine does not hold.
  - **G3 (status):** for a session with agents that ran before the bridge
    loaded (the module reloaded mid-session), nested agents whose parent
    still runs and nested agents whose parent is over, and agents running
    now, every entry of `subagents` carries a `status` other than
    `unknown` within 1 s of its evidence being written, in DX4's order —
    `completed`, `failed` or `stopped` from the call's result, the
    notification or the `task_status`, a nested agent's from its parent's
    transcript file; else `exited` for any agent of a session whose
    process is gone, a nested agent whose parent has ended, or an agent
    the bridge reports stopped without a terminal word; else `running`
    from the bridge (seeded from `$.agent.list()` for agents the module
    did not see spawn) or from a row — with its evidence, the engine's raw
    word normalized by DX4's one table, and the agent's spawn record and
    file facts; a nested agent names its parent; `unknown` appears only in
    the cases §9.3 names (a parent transcript gone or unreadable while the
    parent is not over; a running session without a bridge whose agent's
    call has no outcome yet; a meta with no `toolUseId` and no spawn
    record), each shown as such; a cold subscribe to an ended session and
    a subscription that was open while it ended show the same statuses (a
    `running` held from the bridge turns `exited` when the process is
    gone); the 158 agent files of a large session are stat'ed, not read,
    on each check, read only when size or mtime changed. The shared
    fixture pins the module-reload case, the nested-agent-whose-parent-
    still-runs case, a cold open of an ended session holding an agent with
    a `running` status and no completion notification (`exited`), a nested
    agent under an ended parent (`exited`), and each raw status word of
    DX4's table.
  - **G4 (jobs and output):** a background Bash and a Monitor started
    before the subscription opened appear in `jobs` with kind, command or
    description, start time, status and output path (null for the monitor
    until a row names one), and end on their notification, `task_status`
    or `TaskStop`; `output {taskId, tail}` answers `ok` with the last
    `tail` bytes of the task's file, `missing` with the path when the file
    is gone and `missing` with `path: null` for a known task no row has
    named a file for yet (the fixture's monitor; the same request after a
    row names its path answers `ok` or `missing` with that path, never
    `refused`), `unknown-task` for a task the index does not hold, and
    `refused` with its reason for any path other than the one the
    session's rows named, for a path whose resolved target is not exactly
    `<taskId>.output` under one of the resolved canonical roots the
    machine derives (DX4), including a symlink to another task's file
    under the same root, a
    symlink whose target keeps all three suffix components (`…/<same
    session>/tasks/<same task>.output` elsewhere) and an ordinary symlink
    to a file of another name; MCP names from the rows; the machine side
    proved by the plane's tests with the frames DX2 names, and end to end
    on the deployment once DC9's hub is deployed (the hub ships first,
    DX4). The shared fixture holds an unknown task, a deleted file, and a
    monitor just started with no path.
  - **G5 (deliveries):** a web send whose submission the engine refuses
    after the bridge answered `submitted` (a `drop`) gets a second DX4
    `delivery` for the same key, `failed` with the bridge's reason, within
    the delivery path's next pass; the first outcome, `delivered`, is
    unchanged in meaning (the text entered the session's queue).
  - **G6 (optional):** `delivered {outcome: "entered", uuid}` names the
    delivered prompt's row.
- **Edges:** blocked-by: DC7 (merged); blocks: — (DC9 builds against the
  contract and the fake machine; the two meet on the deployment at the
  walk's Part I, run again).
- **Contracts:** DX4 (producer; the amendments of 2026-10-17), DX2
  (consumer of `output`), DX5 (consumer of `agent` and `resync.agents`;
  owner of the `$.agent.list()` seed, the refused-delivery report, and
  G6's `delivered.uuid`).
- **Design inheritance:** §9.1 (delivered is not the row), §9.2–9.4 and
  9.7; §3 session plane [binding: the hub never stores transcripts]; §6
  [the daemon as boundary: `output` reads one directory the machine
  derives and the rows name]. Advisory: `sminos_plane.py` (the index
  beside `Tail`, the thread and queue as `diff`'s, `finish` and `tick` for
  G2, `event()` for the agent state), `sminos_bridge.py` and
  `hooks/mods/bridge.tsx` for the seed, the refusal report and G6,
  `sminos_outcomes.py` for G5; a fixture of rows → expected `subagents`
  body shared with DC9's fake machine pins the two derivations and the
  normalization table, as DX1's vectors pin the two code implementations.
- **Required:** required (G6 optional).
- **Status:** cut 2026-10-17; not started.

### DC9: The web — the session view — plan

- **Purpose:** Opening a session shows the MAWS report over its own
  transcript: the session view with its toggle, the sends not yet
  delivered as tail rows, pending requests answerable in place, the
  log-built channel as the fallback for an offline machine (and, until the
  owner's reversal of 2026-10-18, MAWS #55, for the phone);
  the main subscription lifted into a per-session owner shared with the
  depth column, whose Transcript tab goes and whose Subagents gain real
  status and a jobs view; the hub's `output` frame and kind and the fake
  machine's widened bodies; the two shared MAWS edits as separate PRs.
- **Acceptance:** against DC3's fake machine replaying a recording that
  holds a `<message>` turn, two subagents, a nested agent, a background
  Bash and a Monitor with their notifications, an async question from the
  ask mod, and a send recorded undelivered (recorded anew with
  `fake-machine/record.py`, or the committed `two-subagents` extended with
  synthesized rows — DC9's call), and on the deployment:
  - **G1 (the view):** a session's channel on a desktop draws the report —
    its `<message>` spans and questions, one "Working record · N tool
    calls · M messages" per marked turn with running dots while it works,
    an unmarked turn whole — and the toggle shows the full transcript and
    back; the text streams per content block as DC6's did; a reload shows
    the same rows; the ask mod's question row draws as a question with the
    log's answer overlaid; a send is a tail row with its delivery state
    until its framed row (or the row its `delivered.uuid` names) is
    observed, and then the row replaces it without a double, in five
    cases: the `delivered` outcome arrives before the row (a long-running
    turn: the tail row stays, saying delivered, until the row lands); two
    identical sends in a row (each takes the row whose frame names its
    `(writer, seq)`); an earlier terminal-typed prompt "continue" exists
    and a web send "continue" is acknowledged while the session is busy
    (the web send stays visible until its framed row arrives; the typed
    row is never taken for it); a submission delayed and then refused (the
    tail row stays and shows the `failed` state); a send whose row never
    arrives because the session ends first (it stays as a delivered entry
    at the tail, ahead of the end marker); a pending permission and a
    pending question are answered from their cards at the tail and the cards leave; the
    ended session's channel shows its end marker and Resume. Streaming in
    the report: a marked response folds its turn and shows the mark live
    before its first row flush; unmarked streaming text later in an
    already-marked turn stays inside the record; settlement leaves no
    double (the live row gone when the `block-row`'s row lands).
  - **G2 (history):** against a recording of more than one page, scrolling
    to the top pages older rows until the first row, on a live session and
    on one that ended while open (the fake machine's `session-ended` at
    `n` 0 only), with no stall of the view; a session whose subscription
    ends at `n` 0 falls back to the log-built channel with the reason.
  - **G3 (fallbacks):** with the fake machine disconnected the channel is
    the log-built stream with its folds as labels; on the phone layout no
    transcript chunk loads until a session channel opens, and never the
    depth column's (the grid and the group chat load no script holding
    MAWS's Transcript, SessionView or TranscriptPane; a session channel
    then loads the session view's; MAWS's Markdown, with its KaTeX and
    shiki chunks, stays with the project view, since the log-built channel
    has drawn `<message>` bodies through it since DC5; amended 2026-10-17,
    DC9's M6, and 2026-10-18, MAWS #55, `e2e/phone-load.spec.ts`); the
    phone's channel is the session view with the desktop's fallbacks; the
    group chat is unchanged against DC5's tests.
  - **G4 (the column):** the Transcript tab is gone; Subagents shows the
    nested agent under its parent and every recorded agent with the
    status DX4 carries, none under "On disk / status unavailable"; an
    Agent row in the center opens the column's Subagents tab on that
    agent; the jobs view draws the shell and the monitor with `ShellRow`
    and `MonitorRow`, the shell's Output opens its tail through `output`,
    and the MCP names are listed; Diff and Info work as before over the
    shared subscription (DC6's tests pass or are moved); `FoldTranscript`,
    `range.ts`, `export-marks.ts`, `unfold-turns.ts` and the `transcript`
    slot are deleted, and DX8 is amended.
  - **G5 (hub and fake machine):** the hub takes `output {sub, taskId,
    tail}` up and `output` down (`protocol/session.ts`, `browser.ts`,
    `machine.ts`, `objects/project.ts`), relaying it as `rows`; the fake
    machine answers `rows` for a session after its replay ends and serves
    `output` from a recording's `tasks/<taskId>.output`, with each DX4
    variant (`ok`, `missing`, `unknown-task`, `refused`); it carries the
    widened `subagents` body derived from its recording's rows by DX4's
    rules, normalization table and precedence, pinned by the fixture DC8
    shares (the module-reload and nested-parent-still-runs cases, a cold
    open of an ended session with a `running` agent and no notification,
    a nested agent under an ended parent, each raw status word, an unknown
    task, a deleted file, a monitor with no path answering `missing` with
    `path: null`);
    `test/session-plane.test.ts` covers the new frame and kind.
  - **G6 (shared edits):** one MAWS PR, reviewed on its own:
    `mcp__doperpowers__AskUserQuestion` classified as a question, with
    MAWS's own tests. (The backfill edit left DC9 for a MAWS-app
    follow-up, §9.5.)
- **Edges:** blocked-by: DC5, DC6 (merged), this document's DX4 and DX8
  amendments (written 2026-10-17); blocks: — (DC8's `output` is proved end
  to end once the hub is deployed).
- **Contracts:** DX8 (owner of the amendment), DX3 and DX2 (`output`
  frames; the module is in MAWS), DX4 (consumer; the hub's kind list and
  the fake machine), DX1 and DX6 (as DC5).
- **Design inheritance:** §9.1, 9.3 (the web's half), 9.4 (the view and
  the hub's frame), 9.5; §4 as amended [binding: the phone, its direct
  channel the session view since 2026-10-18]; §5 table
  (what a session cannot do stays shown as disabled). Advisory:
  `apps/desk-web/src/depth/` and `views/`; the per-session owner is a small
  store, the toggle about twenty lines calling the transcript store's
  `setView`; taste surfaces (the tail row's delivery line, the band, the
  end marker, the jobs view) go to the owner as mockups before polish, as
  DC5's did; the owner's verdicts (2026-10-17): the delivery state in the
  bubble's foot, requests inline at the tail, a job's output under its
  row, Stop disabled, the end marker as drawn.
- **Required:** required.
- **Status:** merged and deployed 2026-10-18 (tracking row).

### DC10: Stop a job from the web — machine and web

- **Purpose:** A running background job of a bridged session is stopped
  from the desk's Jobs tab. That covers a shell or a monitor, the main
  loop's or a subagent's. Stop has drawn disabled since DC9, "Stopping a
  job runs from its terminal". The owner approved building it right
  after DC8 and DC9 (2026-10-17).
- **Acceptance:**
  - **G1 (stop):** on a bridged session with a running background shell
    and a running monitor, Stop on each row sends DX6 `stop`. The bridge
    runs `TaskStop` through `$.tool.call`, the RPC answers `done`, and the
    row reads `stopped` from the session's own DX4 body within 2 s. The
    body learns it from the bridge's stop note: `$.tool.call` writes no
    row, so on success the bridge appends a meta row whose whole text is
    `Task <id>, a background task, was stopped from the desk: it is not
    running.` The derivation reads that row as `stopped` (amended at the
    machine half, 2026-10-18). This is proved against
    a real bridge on the machine side (the bridge's tests and one live
    check) and against the fake machine on the web side.
  - **G2 (what cannot):** on a session without a bridge, on a machine
    that is offline or read-only, and on a job that is not running, Stop
    stays disabled with its reason (§5's table). Forced through anyway,
    the RPC is refused `unsupported`, `machine-offline` or `read-only`.
  - **G3 (which task):** the daemon refuses a `taskId` that the session's
    own jobs index does not hold as running with `unknown-task`, before it
    claims the nonce. A retried nonce is answered from the ledger and
    never stops anything twice.
  - **G4 (failure shown):** a `TaskStop` the engine answers with an error
    fails the RPC `failed` with the engine's message, and the row shows
    the message inline while it keeps its status.
- **Edges:** blocked-by: DC8 and DC9 (merged). The two halves build in
  parallel against this section, and the machine half lands first. A hub
  that knows `stop` under a daemon that does not gets `bad-shape` from
  the daemon, shown as a failure, so either deploy order is safe.
- **Contracts:** DX6 (`stop`), DX5 (the bridge's `stop` command), §5's
  table (its Stop row), DX3 (the browser's RPC call; no new frame).
- **Design inheritance:** §9.4 (the jobs view as DC9 built it; output
  stays as it is). Background agents are out: their rows draw no Stop
  today, and stopping one is a separate decision. Advisory: the bridge
  already calls `TaskStop` for an interrupt (`hooks/mods/bridge.tsx`),
  `sminos_rpc.py` holds the RPCs, `sminos_jobs.py` the jobs index, and
  `apps/desk-web/src/depth/` the jobs view.
- **Grain:** two executors, one per repository, one milestone each.
- **Required:** required.
- **Status:** cut 2026-10-18.

## Cross-Child Contracts

The clauses below bind now. Where a contract's full shapes are delegated,
the owner writes them into Interfaces (below) at the named gate, and its
consumers start after that gate.

- **DX1 — Log events (owner: this document; complete here).** smns §3's
  events, extended and nothing more:
  - web writes use writer `hub/<member-id>`, sequenced by the project's
    Durable Object;
  - a `human` event from the web carries `from: "human"` and `member:
    "<member-id>"`;
  - every event on the hub carries `mac: {"nonce": "<128-bit random,
    base64url>", "value": "<HMAC-SHA256 with the org key, base64url>"}`.
    The code covers the bytes `smns-hub-log-v1\n<project id>\n` followed by
    the canonical JSON (RFC 8785, JCS: sorted keys, no whitespace, UTF-8;
    vectors in Interfaces pin the Python and TypeScript implementations
    to the same bytes) of **the event with `mac` reduced to its
    `nonce`** — every field but the code's own value — and, for a `hub/`
    writer only, without `writer`, `seq`, and `ts`, which the hub assigns
    after the browser computed the code. The nonce is covered because a
    `hub/` event's position is not: a hub that re-sequenced a web `human`
    under a fresh nonce would otherwise pass every daemon's seen-nonce
    check. So no field can ride along unauthenticated (the
    delivery path reads more than the text: `frame_of` and
    `compose_frame` in `sminos.py` interpolate `msg_id` and `via`), an event
    cannot be moved to another position in its feed, and an event cannot be
    transplanted into another project of the org, where its seqs and
    delivery cursors would be fresh. A web event carries `created` and the
    `mac` nonce, and daemons refuse a nonce they have seen. A daemon
    verifies against the project it is importing into; events it has
    stored keep their `mac`, and the archive carries it;
  - the hub adds nothing inside an event except a `hub/` event's `writer`,
    `seq`, and `ts`: the project offset travels beside the event in DX3's
    frames, so a stored event's code verifies as it did on arrival;
  - what the code leaves out is checked by shape before anything is stored
    or delivered: a `hub/` event's `writer` is exactly `hub/` and its own
    `member` (32 lowercase hex, which the code covers), its `seq` a
    positive integer, and its `ts` an ISO 8601 UTC time with milliseconds.
    Daemons and browsers refuse an event that fails, as they refuse a bad
    code: the delivery path interpolates the writer into the frame a
    session reads (`writer_short`, `event_ref`, `frame_of` in
    `sminos.py`), so an unchecked writer would carry text no code covers;
  - `.smns` gains `"hub": {"url": "<https url>", "org": "<org id>"}`;
  - no new log kinds for permission prompts or RPCs (§3).
  Binds DC2 (writes `message` and `question` as today), DC3 (stores, never
  alters), DC4 (adds codes on upload, verifies on import), DC5 (writes
  `human`, verifies before drawing).
- **DX2 — Machine ↔ hub protocol (owner DC3, at DC3.G1).** Outbound from the
  machine; one connection per machine, admitted by its service token and
  bound to its enrolled name; per project the version-vector handshake of
  §3, then live tail both ways; RPC requests down and results up; session
  subscriptions down and DX4 messages up; machine and session presence and
  the pending set republished on every reconnect, with every RPC result
  the hub has not acknowledged. A machine's lease is renewed only by
  traffic from the daemon — its answer to each heartbeat, fenced by the
  stream's generation — never by the hub's own heartbeat, so a suspended
  daemon or a half-open stream lapses within the lease. A daemon that
  refuses an event it was sent (a bad code, a seen nonce, a writer that
  fails its shape) reports the refusal up, naming the project, the event's
  position and nonce when it carried them (never a position the daemon
  made up), and the reason; the hub keeps it in the audit record
  and shows it to the project's browsers (acceptance 8), apart from the
  hub's own refusals of uploads. Binds DC4, DC7.
- **DX3 — Browser ↔ hub protocol (owner DC3, at DC3.G1).** Resume by project
  offset for the log; subscriptions for the session plane, each scoped to
  a session and an `agentId` (null for the main transcript), which DX2
  carries to the machine and which binds the subscription's snapshot and
  older-row pages to that one transcript; log events,
  presence, the pending set, and DX4 messages down; authenticated `human`
  events and RPCs up, with their results. Binds DC5, DC6. Amended
  2026-10-17 (§9): `output {sub, taskId, tail}` up, answered as DX4
  `output`; binds DC9 (builds it in the hub) and DC8 (answers it).
- **DX4 — Session-plane messages (envelope owner DC3, at DC3.G1; producers DC2
  and DC7; semantics complete here).** An envelope `{project, machine,
  session, kind, sub, n, body}` around the engine's own shapes, passed
  through rather than re-modelled:
  - transcript rows are the engine's JSONL rows verbatim; a stream chunk is
    `{turnId, agentId, step, chunkIndex, chunk}`, with `turn.step`'s chunk
    object verbatim under `chunk` (nested, not merged, since the chunk
    carries an index field of its own; `step` is the model request's
    ordinal in the turn); session presence is the `status`,
    `waitingFor`, and `needs` fields of `~/.claude/sessions/<pid>.json`
    plus whether a bridge is connected; the subagent tree is each
    `subagents/*.meta.json` verbatim; the diff is unified diff text against
    the session's base branch; machine presence is online, policy
    (read-only, ceiling), and the known checkouts per project (path,
    branch), which the spawn sheet offers;
  - **a subscription** (`sub`) delivers a snapshot, then live messages
    numbered `n` from 1. The snapshot is the latest transcript rows up to
    the last flushed row, newest first, as many as fit the frame budget
    (older rows come on request, as the reader scrolls, read from disk), the
    subagent tree, presence, and, for every
    message still streaming, its identity (`turnId`, `agentId`, `step`),
    its partial text, and `upTo`, the index of the last chunk that text
    includes. The live part is the bridge's (DX5): its endpoint takes each
    message's partial text and `upTo` and adds the subscriber under the one
    lock that applies chunks, so its snapshot and its live events neither
    overlap nor leave a gap. The daemon subscribes to the bridge and starts
    tailing the transcript before it reads the rows, then drops tailed rows
    the snapshot already holds (by row uuid) and chunks at or below their
    message's `upTo` — subscribe before snapshot, as MAWS's hydration does
    (`src/renderer/src/transcript/source/hydrate.ts`), with the watermark
    standing in for event ids that aggregated text lacks. Streaming is
    tracked per content block, since one API response is several rows, one
    per block, and the mod sees no API message id: a `block-row {uuid,
    turnId, agentId, step, index}` message, sent when the engine writes the
    row for block `index` of that step, names the row that settles the
    block, and arrives before the row itself; a row whose `uuid` a
    `block-row` named settles that block's partial text, chunks for a
    settled block are ignored, and a snapshot's `streaming` holds only
    unsettled blocks. Any discontinuity — a gap in `n`, a hub restart, a
    dropped connection, or a gap in the bridge's own stream (DX5's `gap`)
    — ends the subscription (`end`), and the browser subscribes again and
    takes a fresh snapshot; nothing is resumed from a hub buffer, which is
    an optimization only;
  - every `mac` here is computed as DX1's is, with its own domain string
    and its nonce covered;
  - **a pending request** is `raised {request: <tool-use id>, session,
    tool, input, agentId?, truncated?, mac}` (`agentId` the subagent that
    asked, absent for the main thread; `truncated: true` when the bridge
    capped the input it shows, and the digest is over that capped input on
    both sides), followed by exactly one `settled {request, winner:
    "web" | "terminal" | "other", outcome, by, mac}`, where the bridge names
    the side whose answer the engine used. The hub removes the request on
    `settled` and writes its audit record from it, once per request: a
    `settled` for a request it has already settled (a daemon relaying a
    settlement again after a restart) is taken without a second broadcast
    or audit record, unless the request was raised again since (once per
    raise, 2026-10-19, Decision Log), which holds because the daemon never
    sends a `settled` after a later `raised` of the same request; after a
    reconnect it drops any request the daemon does not republish;
  - **a delivery outcome** is `delivery {event: {writer, seq}, session,
    outcome: "delivered" | "recorded" | "refused-read-only" | "uncertain" |
    "failed", reason, mac}`, produced by the daemon when `deliver_next`
    settles an event for a recipient on its machine, one per event and
    recipient, with one exception: an event owed to a closed terminal
    session is reported `recorded` without being settled, and stays owed
    as smns §4 has it, so when Resume brings the session back and the
    event is delivered, a `delivered` outcome follows for the same key.
    `uncertain` is a push whose frame was taken but never answered (the
    ladder's `sent?` or `woken?`): settled, never pushed again, and drawn
    as possibly delivered. It is how the web knows that a send reached the
    session, or was only recorded (a closed terminal session) or held back
    (a read-only machine). The hub keeps the latest outcome per key and
    returns it to a browser that reconnects. It is kept apart from `settled`, which is
    about a session's pending request, not a log event.
  The hub interprets presence, pending requests, and delivery outcomes;
  everything else it relays.
  Binds DC2 and DC7 (produce), DC3 (relays, implements the semantics in its
  fake machine), DC5 and DC6 (consume). Amended 2026-10-17 (§9): a
  subscription outlives its session and pages its transcript to the first
  line (`end {session-ended}` keeps its `n` 0 meaning only); `subagents`
  is widened with each agent's status and evidence, the loop's `jobs`, and
  `mcp` names; a new kind `output` answers a task's output tail at a path
  the session's rows named under its `tasks/` directory. Binds DC8
  (produces), DC9 (consumes; carries the kind through the hub and the fake
  machine). The hub ships before any uplink answers `output`.
- **DX5 — Local bridge protocol (owner DC2, at DC2.G1).** The session
  endpoint's API (`$SMINOS_HOME/bridge/<session-id>.sock`): the bridge's
  event stream into it and the subscription out of it, the command lines
  the child relays to the mod, the long-poll for answers and decisions, the bridge-presence
  signal, the redelivery key for `human`, and the pending request's current
  content for the daemon's digest check. Binds DC7.
- **DX6 — RPCs (shapes owner DC3, at DC3.G1; policy owner DC7).** The RPC set
  of §5, each with its arguments, result, and errors, authenticated like DX1
  over `{"args", "created", "machine", "member", "nonce", "project",
  "rpc"}`; an answer or decision carries in `args` the digest
  `{session, request, tool, input_sha256}` of the request as drawn. The
  policy DC7 enforces: known checkouts, permission ceiling, read-only (RPCs
  and outside-origin delivery), 60-second freshness, digest match.
  **An RPC runs at most once.** Its nonce is its id. The daemon keeps a
  durable ledger under `$SMINOS_HOME/daemon/`: it claims the nonce there
  (`claimed`) before the RPC has any effect, then records the outcome —
  `done` with what the RPC produced (the spawned session's id, the steer's
  row uuid) or `failed` with the reason — before the result is sent, and
  keeps the entry for a day, well past the freshness window and a
  reconnect. A nonce the ledger knows is answered from the ledger and never
  executed again, a check made before the freshness check. A nonce left
  `claimed` with no outcome (the daemon stopped between the two writes) is
  not executed again either: it is reconciled from the action's own trace
  where one exists (a spawned seat carries the nonce that started it; a
  steer's answer from the mod is kept by the bridge child under the nonce)
  and otherwise answered `failed: interrupted`, for the human to look at. An unknown nonce older than 60
  seconds is refused. The hub marks an RPC `uncertain` when
  the machine's connection drops after the RPC was forwarded and before its
  result arrived, and resolves it from the results the daemon republishes
  on reconnect (DX2); a browser retry reuses the nonce. This matters for
  spawn (two sessions) and steer (the text twice); it queues nothing for an
  offline machine, because `uncertain` applies only to an RPC the machine
  already received. RPC states: `done | failed | uncertain`. Binds DC5
  (issues, draws `uncertain`), DC3 (routes, marks and resolves `uncertain`),
  DC7 (verifies, executes, keeps the ledger).
- **DX7 — Identity (owner DC3, at DC3.G1).** The registry's org, member,
  machine, and project records; machine names unique in the org; the
  project's designated archive machine; each member device's push
  subscription; Access for members, service tokens
  for machines; the enrollment code (hub URL, one-time token, machine name,
  org key), generated in the browser so the hub never sees the key. Binds
  DC4, DC5, DC7. Written to outlive this unit: the org phase extends it.
- **DX8 — The web shell's slots (owner DC5, at DC5.G1).** The slot, layout,
  session, and transcript-store interfaces the depth panel plugs into,
  copied from MAWS's `src/renderer/src/app/slots.ts` and
  `src/renderer/src/transcript/shell.tsx`. Binds DC6; DC9 (2026-10-17: the
  `transcript` slot retires, `Subscription` gains `output`, the depth
  tabs change).

## Interfaces

Filled by the contract owners at their gates: DX2, DX3, the DX4 envelope, the
DX6 shapes, and DX7 by DC3 at G1; DX5 by DC2 at G1; DX8 by DC5 at G1. Each lands as a subsection
here, reviewed with its gate, and a later change to one is a Decision Log
entry that flags its consumers.

DX1's vectors, DX2, DX3, the DX4 envelope, the DX6 shapes, and DX7 are
folded verbatim from DC3's M1 (MAWS `140c834b`, reviewed) and replaced
by its G1 amendment (MAWS `29294260`, reviewed), which carries the
Interfaces review's fixes; DX2, DX3, and DX7 are then replaced whole by
DC3's M2 (MAWS `4de85ff9`, reviewed), which builds the log plane and
enrollment, fixes every part the amendment marked provisional, and adds
the local hub's run instructions after DX7. Their
reference is the protocol module `apps/desk-hub/src/protocol/` (exported
as `desk-hub/protocol`) with its vectors
`apps/desk-hub/src/protocol/vectors/codes.json`, written by `generate.py`
beside them, a stdlib-Python implementation independent of the
TypeScript one: where this text and the module ever differ, the module's
tests decide and the text is corrected. Each subsection ends with what
DC3's later milestones extend. DX5 is DC2's; DX8 is DC5's.
The 2026-10-17 amendments (§9; DC8 and DC9) are marked **[2026-10-17]**
in place: DX2's and DX3's `output` frame, DX4's history, `subagents` and
`output` rows, and DX8's slot retirement; DX4's module and the fake machine
are DC9's to align, DX4's producer DC8's.

Conventions throughout: hub-owned multi-word fields are snake_case (as smns's log and DX6's `input_sha256`); fields
that pass through from the engine keep the engine's camelCase (`turnId`, `agentId`, `upTo`, `waitingFor`). Times are
ISO 8601 UTC with milliseconds. A nonce is 128 bits, base64url without padding (22 characters), never repeated under
one org key: random from a browser and for every RPC; for a machine's own log events, random or derived as the first
16 bytes of HMAC-SHA256 with the org key over `smns-hub-nonce-v1\n<project id>\n<JCS of the event without mac>` (DX1's
framing under a domain of its own), so that an upload resent after a lost answer carries the same bytes. A verifier
cannot tell the two apart and needs not to.

### DX1 — The authentication code and its vectors (owner: this document; written by DC3 at G1)
**The rule, for every shape that carries a code** (DX1 log events; DX4 `raised`, `settled`, `delivery`; DX6 RPCs).
The code is HMAC-SHA256, keyed with the 256-bit org key, over the bytes

    <domain> LF <project id> LF <RFC 8785 canonical JSON of the covered object>

all UTF-8, where `<project id>` is the `.smns` id of the project the verifier serves and the domain is the shape's own:

| shape | domain |
| --- | --- |
| log event | `smns-hub-log-v1` |
| RPC | `smns-hub-rpc-v1` |
| `raised` | `smns-hub-raised-v1` |
| `settled` | `smns-hub-settled-v1` |
| `delivery` | `smns-hub-delivery-v1` |

The covered object is the shape without the code's own value:
- a shape whose `mac` is `{"nonce", "value"}` (log events, `raised`, `settled`, `delivery`) is covered with `mac`
  reduced to `{"nonce": …}`, every other field included, unknown ones too;
- a log event whose `writer` begins `hub/` is covered without `writer`, `seq`, and `ts` as well (the hub assigns them
  after the browser computed the code); every other writer's event is covered with them;
- an RPC carries its nonce as its own top-level field (`nonce`, its id) and the value alone as `mac` (a string): it is
  covered without `mac`, i.e. exactly `{"args", "created", "machine", "member", "nonce", "project", "rpc"}`.

`mac.value` (and an RPC's `mac`) is the 32-byte HMAC, base64url without padding (43 characters). A verifier compares
in constant time, and treats a shape with no usable nonce, a value that is not base64url, or anything the canonical
form refuses as failing.

**What the code leaves out is checked by shape.** A `hub/` event's `writer`, `seq`, and `ts` are assigned by the hub
after the browser computed the code, so the code does not cover them, and sminos's delivery writes the writer into
the frame a session reads (`writer_short`, `event_ref`, `frame_of` in `sminos.py`). A verifier — a daemon before it
imports an event, a browser before it draws one — refuses a `hub/` event as it refuses a bad code unless all of these
hold:
- `writer` is exactly `hub/` followed by the event's own `member`, and `member` is 32 lowercase hex characters (the
  code covers `member`, so the writer is bound to it);
- `seq` is a JSON number whose value is a positive integer no larger than 2^53 − 1 (`3.0` is the number 3, as
  `JSON.parse` reads it; a string or a boolean is not a number);
- `ts` is `YYYY-MM-DDTHH:MM:SS.mmmZ` in ASCII digits, naming a real calendar day (Gregorian leap years), an hour below
  24, and minutes and seconds below 60. These rules are checked as written, not through a date library: Python's
  `datetime` starts years at 1 and its `strptime` admits second 60.

The module's `verify` applies this to every `hub/` log event (`isHubPosition` in `log.ts`), so a browser gets the
check with the code; `is_hub_position` in `generate.py` is the Python reference. The hub assigns positions that pass
it.

**Base64url has one spelling per value.** Every base64url string DX1–DX7 carry — a code's value, a nonce, the org key
in an enrollment code — is written without padding, and the unused low bits of its last character are zero. Any other
spelling is refused as a bad code, before any HMAC, and never normalized: a hub or importer that normalized would store
bytes its writer did not send. A code's value is the canonical spelling of 32 bytes (43 characters) and a nonce of 16
(22 characters). The vectors' negatives say which check refuses each (`fails_by`: `encoding`, then `position`, then
`code`, in the order an importer applies them); `b64url_decode_strict` and `failure` in `generate.py` are the Python
reference.

**Canonical JSON (RFC 8785, JCS), as the implementations must agree byte for byte.** No whitespace. Object keys sorted
by their UTF-16 code units — not by code point, which is what Python's `sort_keys` does: `"😀"` (U+1F600, units
D83D DE00) sorts before `"\ue000"` (U+E000); sort by `key.encode("utf-16-be")` in Python. Strings as ECMAScript's
`JSON.stringify` writes them: `\"` and `\\`, the short escapes `\b \f \n \r \t`, every other code point below U+0020
as `\u00xx` in lowercase hex, and everything else as itself (no escape for `/`, U+007F, U+2028, U+2029, or non-ASCII;
Python's `json.dumps(s, ensure_ascii=False)` agrees). A string holding a lone surrogate is refused. A key whose
value is absent is absent (the TypeScript side drops `undefined`, as `JSON.stringify` does on the wire).

**Numbers (RFC 8785 §3.2.2.3).** Every number, integral or not, is the IEEE-754 double nearest it, written as
ECMAScript's Number::toString writes that double — which is what `JSON.stringify` does. Tool inputs (`raised.input`,
and the `input_sha256` an RPC's digest carries) are arbitrary JSON, so fractions, exponents, and integers past 2^53
all reach the code. The layout, for a positive double with shortest round-trip digits `s` (`k` of them) and value
`0.s × 10^n`: `s` followed by `n − k` zeros when `k ≤ n ≤ 21`; `s` with a point after its first `n` digits when
`0 < n ≤ 21`; `0.` then `−n` zeros then `s` when `−6 < n ≤ 0`; otherwise `d[.ddd]e±(n−1)` (exponent sign always
written, `e+21`, `e-7`). Zero, negative zero included, is `0`; a negative number is `-` and its magnitude; NaN and the
infinities are refused. **In Python:** convert every `int` and `float` with `float()` — never `str(int)`, which keeps
digits a double cannot hold (2^53 + 1 must become `9007199254740992`); take the digits and exponent from
`repr(x)` (the shortest string that round-trips, as ECMAScript's digits are; `decimal.Decimal(repr(x)).as_tuple()`
gives both) and apply the layout above. `es_number` in `generate.py` is that reference, checked against the table
below.

**The request digest** an answer or decision RPC carries (DX6) is `{session, request, tool, input_sha256}`, where
`input_sha256` is the lowercase hex SHA-256 of the UTF-8 canonical JSON of the tool input as the browser drew it.

**Vectors.** The same cases, machine-readable, with the covered bytes also in hex, are
`apps/desk-hub/src/protocol/vectors/codes.json`; DC4 tests its Python against that file or this text.

All cases use the org key `AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8` (the 32 bytes 0x00 to 0x1f, base64url).

**Numbers.** Each JSON text, parsed and canonicalized, gives the canonical text beside it:

| JSON | canonical | case |
| --- | --- | --- |
| `0.5` | `0.5` | a fraction |
| `-0` | `0` | negative zero, as an integer literal |
| `-0.0` | `0` | negative zero, as a fraction literal |
| `100` | `100` | an integer |
| `1e20` | `100000000000000000000` | the largest power of ten written plainly |
| `1e21` | `1e+21` | the smallest power of ten written with an exponent |
| `123456789012345680000` | `123456789012345680000` | a large integral value, plainly |
| `1.2345678901234568e21` | `1.2345678901234568e+21` | a large integral value, past the plain range |
| `1e-6` | `0.000001` | the smallest power of ten written plainly |
| `1e-7` | `1e-7` | the largest power of ten below 1 written with an exponent |
| `-1.5e-7` | `-1.5e-7` | a negative fraction with an exponent |
| `9007199254740992` | `9007199254740992` | 2^53, the last integer every double holds |
| `9007199254740993` | `9007199254740992` | 2^53 + 1, which no double holds: it becomes 2^53 |
| `333333333.33333329` | `333333333.3333333` | RFC 8785's sample: the shortest digits that round-trip |
| `4.50` | `4.5` | RFC 8785's sample: trailing zeros go |
| `2e-3` | `0.002` | RFC 8785's sample |
| `1E30` | `1e+30` | RFC 8785's sample |
| `0.000000000000000000000000001` | `1e-27` | RFC 8785's sample |
| `5e-324` | `5e-324` | the smallest subnormal |
| `1.7976931348623157e308` | `1.7976931348623157e+308` | the largest double |

**Digests** (`input_sha256` over the canonical JSON of a tool input):

- **bash-input**: input `{"command": "pnpm e2e", "description": "Run the e2e suite"}`, canonical `{"command":"pnpm e2e","description":"Run the e2e suite"}`, `input_sha256` `8294a36b488d0be1f3033e6f1c6d7c22eccefd6717f1d6552f6604feef65024e`.
- **input-with-fraction**: input `{"command": "python3 -c 'import time; time.sleep(0.5)'", "timeout": 0.5, "budget": 1e+21, "id": 9007199254740993}`, canonical `{"budget":1e+21,"command":"python3 -c 'import time; time.sleep(0.5)'","id":9007199254740992,"timeout":0.5}`, `input_sha256` `5866483371fad05cc4e773dbcb9e2c6e11506ce7c80c5d680942b1e92daee06b`.

**say-ascii** (domain `smns-hub-log-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`)

- input (as stored, with its code; JSON, non-ASCII written as escapes):

  ```json
  {"ts": "2026-10-15T08:01:02.123Z", "writer": "SK.local/e0ad139c-18bc-45bd-9489-be8653145f80", "seq": 42, "kind": "say", "from": "doperpowers-1e", "to": [{"session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "alias": "maws-45"}], "text": "your change renames a column I read", "mac": {"nonce": "AQEBAQEBAQEBAQEBAQEBAQ", "value": "qqDqpjy4rH_1vmjD-dlpiPrQIfbyLKb1IIsbbyuJ9qk"}}
  ```
- covered bytes, UTF-8, written as a JSON string (so every escape is visible; the hex is in codes.json):

  ```json
  "smns-hub-log-v1\n6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f\n{\"from\":\"doperpowers-1e\",\"kind\":\"say\",\"mac\":{\"nonce\":\"AQEBAQEBAQEBAQEBAQEBAQ\"},\"seq\":42,\"text\":\"your change renames a column I read\",\"to\":[{\"alias\":\"maws-45\",\"session\":\"67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b\"}],\"ts\":\"2026-10-15T08:01:02.123Z\",\"writer\":\"SK.local/e0ad139c-18bc-45bd-9489-be8653145f80\"}"
  ```
- code: `qqDqpjy4rH_1vmjD-dlpiPrQIfbyLKb1IIsbbyuJ9qk`

**message-unicode** (domain `smns-hub-log-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`)

- input (as stored, with its code; JSON, non-ASCII written as escapes):

  ```json
  {"ts": "2026-10-15T08:02:03.456Z", "writer": "mini/9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a", "seq": 7, "kind": "message", "from": "maws-45", "to": "host", "text": "\uceec\ub7fc \uc774\ub984\uc740 `user_id`\ub85c \uc720\uc9c0\ud560\uac8c\uc694 \ud83d\ude42\n\tquote \" backslash \\ nul \u0000 unit-sep \u001f bs \b ff \f del \u007f ls \u2028 \ub05d", "src": "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a:0", "mac": {"nonce": "AgICAgICAgICAgICAgICAg", "value": "kY1lxWBlgUQhtE7M5FYsanYsu4eZ5bBxeX3qGlanu18"}}
  ```
- covered bytes, UTF-8, written as a JSON string (so every escape is visible; the hex is in codes.json):

  ```json
  "smns-hub-log-v1\n6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f\n{\"from\":\"maws-45\",\"kind\":\"message\",\"mac\":{\"nonce\":\"AgICAgICAgICAgICAgICAg\"},\"seq\":7,\"src\":\"5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a:0\",\"text\":\"\uceec\ub7fc \uc774\ub984\uc740 `user_id`\ub85c \uc720\uc9c0\ud560\uac8c\uc694 \ud83d\ude42\\n\\tquote \\\" backslash \\\\ nul \\u0000 unit-sep \\u001f bs \\b ff \\f del \u007f ls \u2028 \ub05d\",\"to\":\"host\",\"ts\":\"2026-10-15T08:02:03.456Z\",\"writer\":\"mini/9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a\"}"
  ```
- code: `kY1lxWBlgUQhtE7M5FYsanYsu4eZ5bBxeX3qGlanu18`

**hub-human** (domain `smns-hub-log-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`)

- input (as stored, with its code; JSON, non-ASCII written as escapes):

  ```json
  {"ts": "2026-10-15T08:05:00.000Z", "writer": "hub/4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "seq": 3, "kind": "human", "from": "human", "member": "4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "to": [{"session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "alias": "maws-45"}], "text": "keep user_id", "created": "2026-10-15T08:04:59.870Z", "mac": {"nonce": "AwMDAwMDAwMDAwMDAwMDAw", "value": "NE9MrZ6PlMIlulrJzoHRH8gj4cZnaFF2erR0QaVpEP8"}}
  ```
- covered bytes, UTF-8, written as a JSON string (so every escape is visible; the hex is in codes.json):

  ```json
  "smns-hub-log-v1\n6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f\n{\"created\":\"2026-10-15T08:04:59.870Z\",\"from\":\"human\",\"kind\":\"human\",\"mac\":{\"nonce\":\"AwMDAwMDAwMDAwMDAwMDAw\"},\"member\":\"4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c\",\"text\":\"keep user_id\",\"to\":[{\"alias\":\"maws-45\",\"session\":\"67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b\"}]}"
  ```
- code: `NE9MrZ6PlMIlulrJzoHRH8gj4cZnaFF2erR0QaVpEP8`

**nested-object** (domain `smns-hub-log-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`)

- input (as stored, with its code; JSON, non-ASCII written as escapes):

  ```json
  {"ts": "2026-10-15T08:06:00.001Z", "writer": "SK.local/e0ad139c-18bc-45bd-9489-be8653145f80", "seq": 43, "kind": "say", "from": "doperpowers-1e", "to": "*", "text": "every field is covered, unknown ones too", "meta": {"z": [1, -2, 0, 9007199254740991, true, false, null, {"b": "", "a": []}], "\u00e9": "e-acute (U+00E9)", "\ud83d\ude00": "an astral key: UTF-16 orders it before U+E000, code points after", "\ue000": "a private-use key (U+E000)", "A": "upper", "a": "lower", "": "the empty key"}, "mac": {"nonce": "BAQEBAQEBAQEBAQEBAQEBA", "value": "gvC-Es0bMfkLUM5mNlu750OrDozy_8wNYnVn-onWII0"}}
  ```
- covered bytes, UTF-8, written as a JSON string (so every escape is visible; the hex is in codes.json):

  ```json
  "smns-hub-log-v1\n6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f\n{\"from\":\"doperpowers-1e\",\"kind\":\"say\",\"mac\":{\"nonce\":\"BAQEBAQEBAQEBAQEBAQEBA\"},\"meta\":{\"\":\"the empty key\",\"A\":\"upper\",\"a\":\"lower\",\"z\":[1,-2,0,9007199254740991,true,false,null,{\"a\":[],\"b\":\"\"}],\"\u00e9\":\"e-acute (U+00E9)\",\"\ud83d\ude00\":\"an astral key: UTF-16 orders it before U+E000, code points after\",\"\ue000\":\"a private-use key (U+E000)\"},\"seq\":43,\"text\":\"every field is covered, unknown ones too\",\"to\":\"*\",\"ts\":\"2026-10-15T08:06:00.001Z\",\"writer\":\"SK.local/e0ad139c-18bc-45bd-9489-be8653145f80\"}"
  ```
- code: `gvC-Es0bMfkLUM5mNlu750OrDozy_8wNYnVn-onWII0`

**rpc-decide** (domain `smns-hub-rpc-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`)

- input (as stored, with its code; JSON, non-ASCII written as escapes):

  ```json
  {"rpc": "decide", "project": "6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f", "machine": "mini", "member": "4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "created": "2026-10-15T08:07:00.000Z", "nonce": "BQUFBQUFBQUFBQUFBQUFBQ", "args": {"session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "decision": "allow", "digest": {"session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "request": "toolu_01QmZ7wq3V8nEXAMPLE", "tool": "Bash", "input_sha256": "8294a36b488d0be1f3033e6f1c6d7c22eccefd6717f1d6552f6604feef65024e"}}, "mac": "gbTIjG4zE2Zd6Gxpc1FxarxfVDufsjEwKg-K_L1pepQ"}
  ```
- covered bytes, UTF-8, written as a JSON string (so every escape is visible; the hex is in codes.json):

  ```json
  "smns-hub-rpc-v1\n6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f\n{\"args\":{\"decision\":\"allow\",\"digest\":{\"input_sha256\":\"8294a36b488d0be1f3033e6f1c6d7c22eccefd6717f1d6552f6604feef65024e\",\"request\":\"toolu_01QmZ7wq3V8nEXAMPLE\",\"session\":\"67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b\",\"tool\":\"Bash\"},\"session\":\"67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b\"},\"created\":\"2026-10-15T08:07:00.000Z\",\"machine\":\"mini\",\"member\":\"4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c\",\"nonce\":\"BQUFBQUFBQUFBQUFBQUFBQ\",\"project\":\"6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f\",\"rpc\":\"decide\"}"
  ```
- code: `gbTIjG4zE2Zd6Gxpc1FxarxfVDufsjEwKg-K_L1pepQ`

**raised** (domain `smns-hub-raised-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`)

- input (as stored, with its code; JSON, non-ASCII written as escapes):

  ```json
  {"request": "toolu_01QmZ7wq3V8nEXAMPLE", "session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "tool": "Bash", "input": {"command": "pnpm e2e", "description": "Run the e2e suite"}, "mac": {"nonce": "BgYGBgYGBgYGBgYGBgYGBg", "value": "EOZ2HgjEWZHiuKlv6wZ5CYduHZtbNIMEmqdXDrEo48M"}}
  ```
- covered bytes, UTF-8, written as a JSON string (so every escape is visible; the hex is in codes.json):

  ```json
  "smns-hub-raised-v1\n6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f\n{\"input\":{\"command\":\"pnpm e2e\",\"description\":\"Run the e2e suite\"},\"mac\":{\"nonce\":\"BgYGBgYGBgYGBgYGBgYGBg\"},\"request\":\"toolu_01QmZ7wq3V8nEXAMPLE\",\"session\":\"67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b\",\"tool\":\"Bash\"}"
  ```
- code: `EOZ2HgjEWZHiuKlv6wZ5CYduHZtbNIMEmqdXDrEo48M`

**raised-fraction** (domain `smns-hub-raised-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`)

- input (as stored, with its code; JSON, non-ASCII written as escapes):

  ```json
  {"request": "toolu_01FracTi0nEXAMPLE", "session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "tool": "Bash", "input": {"command": "python3 -c 'import time; time.sleep(0.5)'", "timeout": 0.5, "budget": 1e+21, "id": 9007199254740993}, "mac": {"nonce": "CwsLCwsLCwsLCwsLCwsLCw", "value": "pVCnkJvM-Mtsc_48DN0yt1oG_XxdU_iLe4bVg6Rij2c"}}
  ```
- covered bytes, UTF-8, written as a JSON string (so every escape is visible; the hex is in codes.json):

  ```json
  "smns-hub-raised-v1\n6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f\n{\"input\":{\"budget\":1e+21,\"command\":\"python3 -c 'import time; time.sleep(0.5)'\",\"id\":9007199254740992,\"timeout\":0.5},\"mac\":{\"nonce\":\"CwsLCwsLCwsLCwsLCwsLCw\"},\"request\":\"toolu_01FracTi0nEXAMPLE\",\"session\":\"67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b\",\"tool\":\"Bash\"}"
  ```
- code: `pVCnkJvM-Mtsc_48DN0yt1oG_XxdU_iLe4bVg6Rij2c`

**settled** (domain `smns-hub-settled-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`)

- input (as stored, with its code; JSON, non-ASCII written as escapes):

  ```json
  {"request": "toolu_01QmZ7wq3V8nEXAMPLE", "winner": "web", "outcome": "allow", "by": "4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "mac": {"nonce": "BwcHBwcHBwcHBwcHBwcHBw", "value": "8Wd8vAKTYnP3JIM_7yRz8iMKOFW-Xu1R0m06MAxQ-J0"}}
  ```
- covered bytes, UTF-8, written as a JSON string (so every escape is visible; the hex is in codes.json):

  ```json
  "smns-hub-settled-v1\n6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f\n{\"by\":\"4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c\",\"mac\":{\"nonce\":\"BwcHBwcHBwcHBwcHBwcHBw\"},\"outcome\":\"allow\",\"request\":\"toolu_01QmZ7wq3V8nEXAMPLE\",\"winner\":\"web\"}"
  ```
- code: `8Wd8vAKTYnP3JIM_7yRz8iMKOFW-Xu1R0m06MAxQ-J0`

**delivery** (domain `smns-hub-delivery-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`)

- input (as stored, with its code; JSON, non-ASCII written as escapes):

  ```json
  {"event": {"writer": "hub/4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "seq": 3}, "session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "outcome": "recorded", "reason": "a terminal session the human closed", "mac": {"nonce": "CAgICAgICAgICAgICAgICA", "value": "emPX__7S4fcpC5kDiBl02XYIHeSlyer3ht4ZdBIqw8Q"}}
  ```
- covered bytes, UTF-8, written as a JSON string (so every escape is visible; the hex is in codes.json):

  ```json
  "smns-hub-delivery-v1\n6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f\n{\"event\":{\"seq\":3,\"writer\":\"hub/4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c\"},\"mac\":{\"nonce\":\"CAgICAgICAgICAgICAgICA\"},\"outcome\":\"recorded\",\"reason\":\"a terminal session the human closed\",\"session\":\"67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b\"}"
  ```
- code: `emPX__7S4fcpC5kDiBl02XYIHeSlyer3ht4ZdBIqw8Q`

**Negative vectors** — each must fail verification under the domain and project given. In `codes.json` each carries `fails_by`: `code` when its code fails, `position` when its code verifies and only the position check above refuses it.

- **hub-human-fresh-nonce** (the hub re-sequenced a web human under a fresh nonce; verify under `smns-hub-log-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`, altered from `hub-human`):

  ```json
  {"ts": "2026-10-15T08:05:00.000Z", "writer": "hub/4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "seq": 3, "kind": "human", "from": "human", "member": "4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "to": [{"session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "alias": "maws-45"}], "text": "keep user_id", "created": "2026-10-15T08:04:59.870Z", "mac": {"nonce": "CQkJCQkJCQkJCQkJCQkJCQ", "value": "NE9MrZ6PlMIlulrJzoHRH8gj4cZnaFF2erR0QaVpEP8"}}
  ```
- **say-text-changed** (a covered field changed; verify under `smns-hub-log-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`, altered from `say-ascii`):

  ```json
  {"ts": "2026-10-15T08:01:02.123Z", "writer": "SK.local/e0ad139c-18bc-45bd-9489-be8653145f80", "seq": 42, "kind": "say", "from": "doperpowers-1e", "to": [{"session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "alias": "maws-45"}], "text": "your change renames a column I write", "mac": {"nonce": "AQEBAQEBAQEBAQEBAQEBAQ", "value": "qqDqpjy4rH_1vmjD-dlpiPrQIfbyLKb1IIsbbyuJ9qk"}}
  ```
- **hub-human-other-project** (a hub/ event moved to another project; verify under `smns-hub-log-v1`, project `0d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a59`, altered from `hub-human`):

  ```json
  {"ts": "2026-10-15T08:05:00.000Z", "writer": "hub/4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "seq": 3, "kind": "human", "from": "human", "member": "4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "to": [{"session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "alias": "maws-45"}], "text": "keep user_id", "created": "2026-10-15T08:04:59.870Z", "mac": {"nonce": "AwMDAwMDAwMDAwMDAwMDAw", "value": "NE9MrZ6PlMIlulrJzoHRH8gj4cZnaFF2erR0QaVpEP8"}}
  ```
- **rpc-nonce-changed** (an RPC replayed under another nonce; verify under `smns-hub-rpc-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`, altered from `rpc-decide`):

  ```json
  {"rpc": "decide", "project": "6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f", "machine": "mini", "member": "4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "created": "2026-10-15T08:07:00.000Z", "nonce": "CgoKCgoKCgoKCgoKCgoKCg", "args": {"session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "decision": "allow", "digest": {"session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "request": "toolu_01QmZ7wq3V8nEXAMPLE", "tool": "Bash", "input_sha256": "8294a36b488d0be1f3033e6f1c6d7c22eccefd6717f1d6552f6604feef65024e"}}, "mac": "gbTIjG4zE2Zd6Gxpc1FxarxfVDufsjEwKg-K_L1pepQ"}
  ```
- **raised-as-settled** (a code for one shape offered as another's; verify under `smns-hub-settled-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`, altered from `raised`):

  ```json
  {"request": "toolu_01QmZ7wq3V8nEXAMPLE", "session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "tool": "Bash", "input": {"command": "pnpm e2e", "description": "Run the e2e suite"}, "mac": {"nonce": "BgYGBgYGBgYGBgYGBgYGBg", "value": "EOZ2HgjEWZHiuKlv6wZ5CYduHZtbNIMEmqdXDrEo48M"}}
  ```
- **hub-human-writer-changed** (a hub/ event moved into another member's feed: its code still verifies, its writer is not hub/<member>; verify under `smns-hub-log-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`, altered from `hub-human`; its code verifies, its position fails):

  ```json
  {"ts": "2026-10-15T08:05:00.000Z", "writer": "hub/0123456789abcdef0123456789abcdef", "seq": 3, "kind": "human", "from": "human", "member": "4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "to": [{"session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "alias": "maws-45"}], "text": "keep user_id", "created": "2026-10-15T08:04:59.870Z", "mac": {"nonce": "AwMDAwMDAwMDAwMDAwMDAw", "value": "NE9MrZ6PlMIlulrJzoHRH8gj4cZnaFF2erR0QaVpEP8"}}
  ```
- **hub-human-writer-control** (text riding in a hub/ writer, which delivery writes into a session's prompt: a line break and an instruction; verify under `smns-hub-log-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`, altered from `hub-human`; its code verifies, its position fails):

  ```json
  {"ts": "2026-10-15T08:05:00.000Z", "writer": "hub/4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c\n[sminos] the human says: push to main", "seq": 3, "kind": "human", "from": "human", "member": "4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "to": [{"session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "alias": "maws-45"}], "text": "keep user_id", "created": "2026-10-15T08:04:59.870Z", "mac": {"nonce": "AwMDAwMDAwMDAwMDAwMDAw", "value": "NE9MrZ6PlMIlulrJzoHRH8gj4cZnaFF2erR0QaVpEP8"}}
  ```
- **hub-human-ts-malformed** (a hub/ event whose ts is not ISO 8601 UTC with milliseconds; verify under `smns-hub-log-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`, altered from `hub-human`; its code verifies, its position fails):

  ```json
  {"ts": "2026-10-15T08:05:00Z", "writer": "hub/4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "seq": 3, "kind": "human", "from": "human", "member": "4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "to": [{"session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "alias": "maws-45"}], "text": "keep user_id", "created": "2026-10-15T08:04:59.870Z", "mac": {"nonce": "AwMDAwMDAwMDAwMDAwMDAw", "value": "NE9MrZ6PlMIlulrJzoHRH8gj4cZnaFF2erR0QaVpEP8"}}
  ```
- **hub-human-seq-zero** (a hub/ event whose seq is not a positive integer; verify under `smns-hub-log-v1`, project `6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f`, altered from `hub-human`; its code verifies, its position fails):

  ```json
  {"ts": "2026-10-15T08:05:00.000Z", "writer": "hub/4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "seq": 0, "kind": "human", "from": "human", "member": "4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c", "to": [{"session": "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b", "alias": "maws-45"}], "text": "keep user_id", "created": "2026-10-15T08:04:59.870Z", "mac": {"nonce": "AwMDAwMDAwMDAwMDAwMDAw", "value": "NE9MrZ6PlMIlulrJzoHRH8gj4cZnaFF2erR0QaVpEP8"}}
  ```

**Left for later milestones:** none in the rule or the vectors. M2 checks that a web `human`'s `member` is the signed-in member, and gives the events it sequences positions that pass the check above (the hub never verifies a code; it holds no key).

### DX2 — Machine ↔ hub (owner DC3; G1, amended; the log plane built at M2, the session plane at M3)

**Transport.** One connection per machine, opened outbound and multiplexing its projects, as an HTTP pair:

- **Down:** `GET /machine/stream`, a Server-Sent Events stream held by the machine's `Machine` object (one per
  enrolled machine, named `<org>:<machine name>`). Each event is `event: <t>` and one `data:` line holding the frame's
  JSON (which never holds a line break), then a blank line.
- **Up:** `POST /machine/frames`, `Content-Type: application/x-ndjson`, one JSON frame per line, at most 4 MiB a
  body, with the header `X-Desk-Generation: <n>` naming the stream the POST belongs to. The Worker routes each frame
  to its project's `Project` object (`<org>:<project id>`).
- **Admission.** The daemon sends its service token (`CF-Access-Client-Id`, `CF-Access-Client-Secret`) on every
  request; Access turns it into the assertion whose `common_name` is the client id, and the Worker maps that client id
  to the enrolled machine through the `Registry` (DX7). A client id the registry never enrolled is refused
  (`403 {"error": "not-enrolled"}`) though Access admitted it, since Access's service-auth policy admits any service
  token of the account.

**The stream.** The first frame is `welcome {org, machine, generation, heartbeat_ms}`. `generation` counts the
machine's streams (1, 2, …, kept in the object's storage): a new stream ends the previous one, and every later frame
and POST belongs to the newest. The object writes `hb {at}` every `heartbeat_ms` (configuration: 15 000 deployed; the machine's lease is three
periods), and the daemon answers each
with `hb-ack {generation, at}` (the stream's generation and the answered heartbeat's `at`). The daemon treats a stream
silent for three periods as dead and reconnects with backoff, and a refused POST likewise (below). A client closing the stream reaches the object at once
(the request's abort, compatibility flag `enable_request_signal`) when deployed and on the suites' runtime; under the
local command (`wrangler dev`, whose own proxy closes its hop gracefully, and workerd notices a graceful close only
when a later write fails) it reaches the object within one heartbeat, which the local command sets short (2 000 by
default) [2026-10-15, DC3, from DC5's real-hub suite]. A half-open client is bounded by the lease in either runtime.

**Frames down** (`DownFrame`):

| `t` | fields | meaning |
| --- | --- | --- |
| `welcome` | `org`, `machine`, `generation`, `heartbeat_ms` | first on every stream |
| `hb` | `at` | heartbeat; the daemon answers `hb-ack` |
| `have` | `project`, `have` (vector), `archive` (bool) | the answer to `hello`: the hub's `{writer: max seq}` for the project, and whether this machine writes its archive |
| `events` | `project`, `events` (log events) | events the machine lacks, each writer's in seq order, then live as they arrive |
| `resend` | `project`, `writer`, `from` | a gap: upload `writer` again from seq `from` |
| `refused` | `project`, `refusal` | an uploaded event refused (below) |
| `rpc` | `rpc` | an RPC for this machine (DX6) |
| `rpc-ack` | `project`, `nonce` | the hub recorded this result; stop republishing it |
| `subscribe` | `project`, `session`, `agentId`, `sub` | serve a DX4 subscription scoped to one transcript: the session's main one (`agentId` null) or one subagent's |
| `unsubscribe` | `project`, `sub` | end it: its browser unsubscribed or went, or a message came for a sub no browser holds; the machine answers `end {reason: "unsubscribed"}`, which the hub, having dropped the sub's route first, discards |
| `rows` | `project`, `session`, `agentId`, `sub`, `before`, `limit` | older rows of the sub's transcript, before row `before` |
| `diff` | `project`, `session`, `sub` | the browser's DX3 `diff` on a main-transcript sub: answer with DX4 `diff` on that sub (M3) |
| `output` | `project`, `session`, `agentId`, `sub`, `taskId`, `tail` | **[2026-10-17]** the browser's DX3 `output` on the sub: answer with DX4 `output` on that sub, the last `tail` bytes of the task's output file under the containment rule DX4 states. A daemon older than DC8 passes the frame by (its frame handler logs an unknown `t`), and nothing follows |
| `part` | `id`, `index`, `count`, `data` | a slice of a larger frame (below) |

**Frames up** (`UpFrame`):

| `t` | fields | meaning |
| --- | --- | --- |
| `hb-ack` | `generation`, `at` | the answer to each `hb`; the only traffic that renews the machine's lease |
| `hello` | `project`, `name`, `have` (vector) | opens a project on this stream: the machine's `{writer: max seq}`, and the project's name from `.smns` |
| `events` | `project`, `events` | the machine's own writers' events, each writer's in seq order |
| `rejected` | `project`, `event` (`{writer, seq}` or null), `nonce?`, `reason`, `message?` | an event the hub sent that the daemon refused on import (below) |
| `rpc-result` | `project`, `nonce`, `outcome` | a result from the daemon's ledger (DX6) |
| `session` | `message` | a DX4 message |
| `pending` | `project`, `raised` (list) | the machine's complete pending set for the project |
| `part` | as down | |

`Refusal` is `{reason, writer?, seq?, message}`, `reason` one of `writer-not-yours` (a writer outside `<machine>/`,
or `legacy/` from a machine that is not the project's archive machine), `conflict` (a payload at an existing
`(writer, seq)` whose canonical form differs), `bad-shape`, `too-large`, `not-open` (any frame but `hello` for a
project the current stream has not opened with `hello`), `stale-generation`, and `gap` (kept in the type, never
sent: a gap is answered by `resend`). The hub reports a refusal down the stream and records it in the project's audit
record (DX3), `gap` excepted.

**What the hub checks of an uploaded event**, holding no key: a JSON object; `writer` of the form `<prefix>/<feed>`, at
most 256 characters, without control characters; `seq` a positive integer; `ts` and `kind` strings; `mac` with a
`nonce` and a `value` each in canonical base64url of 16 and 32 bytes (DX1); a form RFC 8785 admits; at most 1 MiB as
canonical JSON. One that fails is refused `bad-shape` (`too-large` for the size), naming its `writer` and `seq` when it
had them. Then, writer by writer in the order the batch gives: a writer the machine may not write is refused
`writer-not-yours` — the machine writes `<its enrolled name>/…`, matched exactly, and `legacy/…` only while it is the
project's archive machine; a `hub/` writer never; a `seq` at or below the writer's last is passed over when its
canonical form equals the stored event's and refused `conflict` otherwise (the stored one stays); the next `seq` is
stored; a later one is a gap, answered `resend {writer, from: <last + 1>}`. A writer's first refusal or gap in a batch
stops that writer for the rest of the batch, a `bad-shape` or `too-large` event that still names its writer included;
other writers go on. Stored events go out at once to the project's
browsers that follow the log and to every other machine that opened the project on its current stream.

**Upward refusals.** A daemon that refuses an event the hub sent it — its code fails (which includes a `hub/` event
whose position fails DX1's shape check, and an event transplanted from another project), its nonce was seen, or it is
not a log event the daemon can read — keeps it out of its log and reports `rejected` with the project, `reason`
(`bad-code`, `seen-nonce`, `bad-shape`, or `conflict`: its code verifies, but the daemon already holds a different
event at that `(writer, seq)`, which in a `hub/` feed means the hub re-sequenced one), an optional `message`, and the
event named by what it carried, never by anything the daemon makes up:
- `event` is `{writer, seq}` exactly as they arrived when `writer` was a string and `seq` a number, however wrong
  otherwise (a `hub/` writer failing its shape is reported as it came, control characters and all), and **null** when
  either was missing or of another type — written out as null, not left out;
- `nonce` is its `mac.nonce` exactly as it arrived when that was a string, and absent otherwise.

So an event may be named by its position, by its nonce alone, by both, or by neither; an event that carried neither is
still reported (`event: null`, no `nonce`), so its refusal shows, and `message` says what it was. The hub keeps the
report in the project's audit record and shows it to the project's browsers (DX3 `rejected`), apart from its own
refusals of uploads (`refused`). This is how a forgery placed at the hub shows in the web (the composite's acceptance
8).

**A refused position is spent on that daemon.** The daemon records the `(writer, seq)` of an event it refused, and its
`hello` vector moves past it, so the hub does not send it again and the writer's later events are imported across the
hole. Without this, one forged web `human` (the hub stores what a member's browser sends, since it cannot verify)
would block every later message from that member on every daemon. A spent position in a `hub/` feed is a refused web
event the project's browsers see as `rejected`; in a machine's feed it can only come from a hub that lied. sminos's
readers keep a per-writer high-water mark and tolerate the hole.

**The log handshake, per project.** The daemon sends `hello` with its vector; the hub answers `have` with its own and
then streams, as `events`, every writer's suffix the machine lacks. The daemon uploads, as `events`, the suffix of
its own writers (`<machine>/…`, sminos's `writer_id`) beyond the hub's vector; the archive machine also uploads the
project's `legacy/` feeds (pre-`.smns` chats, frozen, so the one-payload rule keeps them intact). Inserts are
idempotent on `(writer, seq)`; then both directions tail live. A machine sending `hello` for a project id the
registry does not know registers it, under the `name` it sent; any enrolled machine of the org may. `hello` is `{t,
project, name, have}`, `name` 1 to 200 characters and `have` an object of non-negative integers; anything else is
refused `bad-shape`. A machine joins the project's fan-out in the same step the hub reads its backlog, so an event
stored after it reaches the machine behind the backlog and none falls between; the backlog is every writer's events
past the `hello`'s vector, the machine's own included (a fresh machine bootstraps them), each writer's in seq order,
in `events` frames of about 256 KiB. `have.archive` is read from the registry at each `hello`: a designation made later
reaches the machine at its next `hello`. A `hello` for a project already open on the stream is allowed and idempotent:
the hub answers it with a fresh `have` and the backlog past that `hello`'s vector (events the machine already holds
import idempotently), and the machine's place in the fan-out is unchanged. The daemon re-sends `hello` for each open
project once per archive period, so a designation made or cleared later reaches a machine whose stream never drops. What a project sends a machine is fenced by the generation the project was
opened on: a newer stream receives nothing of a project until the machine sends `hello` for it on that stream.

**The POST's answer and the replies.** The hub writes its replies to a POST's frames — `have` and the backlog after a
`hello`, `resend`, `refused` — down the stream, in frame order, and answers the POST only after they are written:
`200 {"ok": true, "frames": <frames applied>, "refused": [{"index": <n>, "reason": <reason>}]}`. So when a POST
returns, its replies are already on the stream ahead of anything later. **[2026-10-20, MAWS #88; `test/session-plane.test.ts`]** `refused` names, in
POST order, each frame the hub refused whole: one for a project the stream has not opened (`not-open`), and one it
cannot read (`bad-shape`, a frame naming no project id among them). `index` is the frame's place among the POST's
frames from 0, in the numbering `frames` counts (each non-blank line is one frame, each `part` one, and a set joined in
this POST is named by its last part); `reason` is the stream refusal's. `refused` is `[]` when the hub refused none, so
a machine tells that from a hub older than #88, whose answer has no `refused`; `frames` counts refused frames as
applied, as before. Each such frame is still refused down the stream too (a session-plane frame's refusal on the
control lane, unawaited), for machines that read only the stream; the answer is what lets a machine act on a refusal in
the same exchange rather than whenever the stream's arrives. An upload some of whose events were refused
(`writer-not-yours`, `conflict`, one event's `bad-shape`) is not refused whole: those go down the stream alone. The
`409` and `503` answers below that count `frames` carry `refused` for those frames too. The POST itself is refused
whole, with nothing applied, as `409 {"error": "stale-generation"}` when
`X-Desk-Generation` is not the machine's current stream (or it has none: open the stream first), `413 {"error":
"too-large"}` over 4 MiB or for a frame over 1 MiB (with its `line`), and `400 {"error": "bad-shape", "line":
<0-based>}` for a line that is not a JSON object with a string `t`. Blank lines are skipped. A frame naming no `.smns`
project id (a lowercase uuid) is refused `bad-shape` down the stream. `part` frames may span POSTs of one stream; a
set is joined when its last part arrives. The stream is checked again once the body has been read and before each
run of frames for one project (a run reaches its project in one call), and a project stops a run before a frame once
a newer stream of the machine has reached it: when a newer stream opened meanwhile, the POST stops there with `409 {"error":
"stale-generation", "frames": <frames applied>}`, and nothing it would still apply reaches the newer stream's
projects (a `hello` that was already on its way never takes a newer stream's place in the project). When a reply
could not be written for a reason other than the stream having gone, the hub ends the stream and answers `503
{"error": "delivery-failed", "frames": <frames applied>}`: reconnect, send `hello` again, and the handshake heals
whatever was missed. A live event the hub could not deliver to a stream likewise ends that stream. A machine should
post serially: two POSTs in flight are applied interleaved, which the handshake heals (a gap is resent) but costs a
round. A `409 stale-generation` or `503 delivery-failed` on any POST, an `hb-ack`'s included, means the stream the
daemon holds is not the one the hub serves, even while it is still open and beating (after a deploy an old instance
can keep it so, §2): the daemon drops it and reconnects (a new stream, `hello`, the handshake). [2026-10-15, DC3's
M5; DC4's uplink already does this: a POST not answered 200 ends its stream.] The `409` carries `"replaced": true` when
the POST names the generation the object last opened and the object holds no stream: Cloudflare replaced the object
under the stream (a deploy's rollover about five minutes after it, a runtime update, a move). The instance holding a
stream does not wait for that POST: every second it asks which instance the object's own id reaches, and ends its
stream once it is another (the client reads the end as a clean end of stream), so the machine reconnects within about
a second of the replacement. An exception out of an object call reaches the client as JSON (`503 {"error":
"hub-unavailable"}` when Cloudflare marks it retryable or overloaded, `500 {"error": "hub-error"}` otherwise, each with
the error's `message`), never as the runtime's bare `1101`. [2026-10-18, MAWS #57.]

**The session plane, up.** Every frame below needs the project opened on the current stream (`not-open` otherwise),
and one the hub cannot read is refused `bad-shape` down the stream and recorded in the audit record, as an upload's is.
- `rpc-result {project, nonce, outcome}`: `outcome` is DX6's `{state: "done", result: object}` or `{state: "failed",
  error: {code, message, winner?, by?, terminalOnly?}}`. The hub passes a failed outcome's `error` through unchanged
  (live and from its record on a retry of the nonce), refusing `bad-shape` only a wrong type of those three (`winner`
  not one of `web`, `terminal`, `other`; `by` not a string; `terminalOnly` not exactly `true`); fields beyond them are
  kept as received. The hub answers every well-formed one with `rpc-ack {project, nonce}`, so the daemon stops
  republishing it; it applies the outcome only to an RPC it forwarded to this machine and that has no result yet
  (`forwarded` or `uncertain`), and a result for any other nonce (unknown, another machine's, already resolved) is
  acknowledged and changes nothing.
- `pending {project, raised: [Raised]}`: the machine's complete set for the project. The hub drops every request of
  this machine's it held that the set does not name (by `session` and `request`), keeps the rest, and adds the new
  ones; a request new to the hub is pushed (DX7), a republished one is not.
- `session {message}`: a DX4 message for this project and this machine (`project` and `machine` must be theirs). The
  hub keeps `presence` (per session), `machine` (per machine, its `online` replaced by the lease's), `raised` (into the
  pending set: one per `session` and `request`, its `session` the envelope's), `settled` (out of the pending set, into
  the audit record), and `delivery` (the latest per `event` and recipient session); it relays `compact` to every
  browser of the project, and each subscription kind to the one browser that holds the `sub`. What it keeps or relays
  it carries as received, rebuilt only as the envelope `{project, machine, session, kind, sub, n, body}`. A
  subscription message whose `sub` no browser holds is answered `unsubscribe {project, sub}` (except an `end`), so the
  machine stops serving it.
- What the hub checks of an interpreted body, holding no key: `raised` is `{request, session, tool, input, deadline?,
  async?, mac}` with `request` at most 512 characters, `input` an object, `deadline` ISO 8601 UTC with milliseconds
  (the bridge's DX5 epoch milliseconds converted), `async` true when present, and `mac` canonical (DX1); `settled` is
  `{request, winner, outcome, by, mac}` with DX4's values; `delivery` is `{event: {writer, seq}, session, outcome,
  reason, mac}`, its `session` the envelope's; `machine` is `{online, policy: {read_only, ceiling}, checkouts: [{path,
  branch}]}` with `session` null; `presence` is `{record: object | null, bridge}`. Fields beyond these are kept as
  received, since a code covers them.

**After every (re)connect** the daemon sends, per project: `hello`; `pending` with its complete set (the hub drops any
request of that machine's the set no longer holds); every `rpc-result` the hub has not acknowledged; and its
presence as DX4 `machine` and `presence` messages.

**Liveness is a lease**: a `Project` holds a machine online only while its lease is fresh. The lease starts at the
`hello` that opens the project on a stream, for that stream's generation, and lasts `LEASE_MS` (45 seconds, three
heartbeat periods: the span after which the daemon gives a silent stream up). Only traffic from the daemon renews it
— an `hb-ack` naming the stream's `generation`, which the `Machine` object hands to every project the stream opened —
never the hub's own heartbeat, so a suspended daemon or a half-open stream lapses within the lease. An `hb-ack`
naming another generation renews nothing. A renewal or close from an older generation is ignored, and a `hello` on a
newer stream replaces the older stream's lease (its work ends as below). A close of a newer generation than the
project's lease (the stream's first `hello` there still waits on the registry) leaves a closed lease of that
generation, so the `hello` opens nothing. When the current generation's stream closes (the `Machine` object tells each
project the stream opened, at once), what the stream carried ends: each of its subscriptions ends at its browser
(`end {reason: "machine-offline"}`, numbered one past the last `n` relayed on it) and its forwarded RPCs without a
result become `uncertain` (DX6). The lease, closed (nothing of that generation renews it again), holds the machine
online for a grace of one heartbeat period, no longer than the lease had left, for the machine's next stream to take it
over at its `hello` without the machine ever reading offline. In the grace a browser's `subscribe`, and a new RPC
(recorded `forwarded`), wait for that stream and are carried to it at its `hello`; a retry of an `uncertain` RPC is
answered from its record. When the
lease lapses (found by the project's alarm, and before anything else at each entry — a renewal, any frame a machine
posts, a browser's request — whether or not the alarm ran yet; a closed lease lapses when its grace runs out), the
machine is offline: what its stream carried ends as above, a subscription that waited ends too (at `n` 0), an RPC
that waited fails `machine-offline` (it never reached the machine), DX3's
`machines` shows it offline, and its sessions' stored presence is no longer handed to a browser as current (DX3).
[2026-10-18, MAWS #57: the grace; before it a close put the machine offline at once.] A later renewal of the same generation (a daemon back from a
suspension on a stream that held) puts it online again, after the lapse has ended the old work; its subscriptions do
not come back, and browsers subscribe again. A session's `presence` the machine posts while its lease is not fresh is
kept and not shown; when the machine is online again, each of its sessions' kept presence goes to the browsers.

**Frame bound.** Every frame on the wire, either direction, is at most 1 MiB of UTF-8, measured before it is read; a
browser's larger frame is refused `too-large`, unread. A larger frame travels as `part` frames, and a joined set is
one logical frame, which may be larger than 1 MiB (the bound is the wire's):
each holds a slice of the frame's JSON text (`data`), all with one random `id` and the set's `count`, `index` from 0;
the receiver joins the slices in index order when the last arrives, in whatever order they came, and parses the
whole. A slice never splits a surrogate pair. (`toWire` and `PartAssembler` in `parts.ts`.) A receiver's unfinished
sets are bounded, one assembler per machine stream and per browser socket: at most 16 MiB of part data held across
its sets, at most 64 sets open, an `id` of at most 128 characters (the hub's own are 22, a 128-bit nonce), and a set
waiting more than 60 s for its other parts is dropped (a late part of it starts a set of its own). A part that would
pass the byte budget or open a 65th set is refused `too-large` (a machine's POST `413`, a browser's `refused`) and its
set dropped; a longer `id` is `bad-shape` [2026-10-15, DC3's panel wave]. One browser set is bounded too: it joins to
at most 4 MiB (`BROWSER_SET_LIMIT`: four times the largest frame a browser sends, a `human` or an RPC, each at most
1 MiB) in at most 9 parts (`BROWSER_SET_PARTS`: what a frame of 4 MiB takes cut at 1 MiB, a slice at most doubling as a
part escapes it). A part whose `count` is larger is refused `too-large` before anything of its set is held, and one
past which its set would join to more is refused `too-large` and its set dropped. Such a refusal names no request,
since the frame was never read, so a browser sends no frame past the bound: the web ends a `human` or an RPC that large
itself, as the hub ends one too large [2026-10-21, before the org admits members other than its owner].

**Measured (M1's probe on the owner's account, 2026-10-15):** an SSE stream held by a Durable Object for 11 minutes
with 15-second heartbeats, never evicted; a second stream idle 150 seconds between heartbeats also held, so the
15-second period is margin, not a requirement found on `workers.dev`; a write from another object's RPC reached the
stream (RPC 43–134 ms); the client's close reached the object at once through the request's abort.

**Built at M2:** the stream, the POST, `hello`/`have` with registration and the archive flag, the backlog, `events`
both ways, `resend`, `refused`, and `rejected` with the audit record (proved on the local runtime by
`test/log.test.ts`: two machines and a `hub/` writer interleaving, a gap, a cut mid-backlog, a runtime restart between
uploads, forged writers, a conflict, a respelled code, a stale POST, an unopened project). **Built at M3:** the
lease with its length, `hb-ack` renewing it and the stream's close ending it, `rpc` forwarding and `rpc-ack`, the
subscription frames down (`subscribe`, `unsubscribe`, `rows`, `diff`), and the session plane up (`rpc-result`,
`pending`, every DX4 kind), proved on the local runtime by `test/session-plane.test.ts`; a `rejected` with reason
`conflict`, a daemon whose vector moved past a refused seq never sent it again, and a repeated `hello` answered with a
fresh `have` (the archive flag as it is now) and the backlog past its vector, the machine in the fan-out once
(`test/log.test.ts`).

**For DC9 [2026-10-17]:** the `output` frame down, relayed as `rows` is (the route's machine, session, `agentId` and
`sub`), with `taskId` and `tail` passed through; the hub's `test/session-plane.test.ts` covers it.

### DX3 — Browser ↔ hub (owner DC3; G1, amended; the log plane built at M2, the session plane at M3)

**Transport.** WebSockets, JSON text frames, behind Access (the browser's Access session becomes the assertion on the
upgrade request like any other):
- `GET /api/projects/<project id>/socket` — a project's view, held by its `Project` object with the Hibernation API.
  Each socket's member, visibility, log mark, and subscription ids (each with the `n` its browser expects next) ride
  in its attachment, and each subscription's route (machine, session, `agentId`, the stream it was set up on) is in
  the object's storage under the socket's own tag, so a woken object routes again before it handles anything.
  A project id the registry does not hold is refused, `404 {"error": "unknown-project"}`; a project is registered by
  the first machine that sends `hello` for it (DX2).
- `GET /api/registry/socket` — the grid, held by the org's `Registry`, a member's only.
- `GET /api/me` — `{org: OrgRecord, member: MemberRecord}` for the signed-in member (DX7); `403 {"error":
  "not-a-member"}` for a person Access admitted whom the org does not hold.

**Frames up** on a project socket (`ProjectUp`). A frame the hub cannot read is refused `bad-shape` (a `refused` entry,
below); a frame naming a `sub` this socket does not hold (one that just ended, say) is passed over quietly.

| `t` | fields | meaning |
| --- | --- | --- |
| `resume` | `after` | the events with an offset above `after` (0 is the start), one page of four `log` frames; then `caught-up` and live, or `more` when events remain |
| `human` | `event` (a sealed `HumanEvent`) | a web `human`; the hub assigns `writer` `hub/<member>`, `seq`, `ts` and answers `human-ack` |
| `rpc` | `rpc` | a sealed RPC (DX6); answered by `rpc-state` (below) |
| `subscribe` | `machine`, `session`, `agentId`, `sub` | a DX4 subscription scoped to one transcript (`agentId` null for the main one); `sub` is the browser's own random id, 128 bits in canonical base64url (`newNonce()`), unique at the machine. At most 32 per socket |
| `unsubscribe` | `sub` | carried to the machine; the hub forgets the sub at once, so no `end {unsubscribed}` follows |
| `rows` | `sub`, `before`, `limit` | older rows of the subscription's transcript, `limit` 1 to 1000 |
| `diff` | `sub` | the session's working-tree diff against its base branch, answered as DX4 `diff` on that sub; only on a main-transcript subscription (`agentId` null: an agent-scope sub's is refused `bad-shape`). Computed on request, never pushed, since it costs the machine a git run whether or not a view is open |
| `output` | `sub`, `taskId`, `tail` | **[2026-10-17]** the last `tail` bytes of a background task's output file, answered as DX4 `output` on that sub; `taskId` a task id as the engine spells it (`[A-Za-z0-9_-]{1,64}`, else `bad-shape`), `tail` 1 to 524288 bytes (else `bad-shape`), so the answer fits one frame. Valid on a main-scope or an agent-scope sub: a job belongs to the loop whose rows started it. Read on request, never pushed; what is absent or refused comes back as the answer's own variant (DX4 `output`: `ok`, `missing`, `unknown-task`, `refused`), never as a hub refusal |
| `visibility` | `visible` | whether this tab shows the project; a visible tab holds back its member's pushes (DX7). A socket starts not visible. While visible, the browser repeats `visibility {visible: true}` every 30 s, and the hub counts a socket visible only while that frame is under 90 s old, so a phone that sleeps or is swiped away before its hidden frame arrives stops holding back pushes within 90 s |
| `part` | as DX2 | |

`HumanDraft` is `{kind: "human", from: "human", member, to: "*" | [{session, alias}], text, created, wake?}`; the
browser seals it as a log event (DX1), so `HumanEvent` is that plus `mac`. The hub accepts it only when `member` is
the signed-in member (else `refused` `writer-not-yours`), and only as a draft: one that names its own `writer`, `seq`,
or `ts` is refused `bad-shape`, as is one whose fields are not those above (`to` `"*"` or `[{session, alias}]`, `member`
a member id, `mac` canonical as DX1 has it), or `too-large` over 1 MiB. The hub stores it as received with `ts`,
`writer` `hub/<member>`, and the next `seq` added — a position DX1's check admits — answers `human-ack` with its offset,
writer, and seq, and sends it to every browser that follows the log (the sender too, if it does) and to every
machine syncing the project. A `human` whose `mac.nonce` this member's feed already holds is not stored again: the hub
answers `human-ack` with the stored event's offset, writer, and seq, so a browser that lost its answer resends the same
sealed event safely; the same nonce with a different payload is refused `conflict`.

**Resume.** `resume {after}` (a non-negative integer) makes the socket follow the log, a mark kept in its attachment
across hibernation: the hub sends the events with an offset above `after` in `log` frames of about 256 KiB, one page
of four frames at a time. A frame holds at least one event and an event is at most 1 MiB, so a page is about 1 MiB
and at most about 4 MiB. When the page reaches the head, `caught-up {offset}` follows with the head, then each new
event live as it is stored; a page that sends nothing (`after` at or above the head) is just `caught-up`. When events
remain, the page ends with `more {offset}` (the last offset the page sent) instead, and the browser sends `resume
{after: offset}` for the next page; a socket gets live `log` frames only from its `caught-up` on, and a later page
carries what was stored meanwhile. The hub keeps no cursor, so a browser that never asks for the next page stays not
following and holds nothing at the hub. The browser's requests pace the backlog, so a long-lived project's first open
never buffers its whole log in the object or the socket [2026-10-15, DC3's panel wave, scalpel-5#3]. A socket that
has not resumed gets no `log` frames. Resuming again sends the backlog again from the new `after`, and the socket gets
nothing live until that resume's `caught-up`. `welcome.head` is the latest offset when the
socket opened.

**On connect**, in this order: `welcome`; `machines`; one `session` frame per session carrying its latest `presence`,
for every session of a machine that is online now (a machine whose lease lapsed has its sessions' presence withheld:
it is unknown, not what was last reported); `pending`; and `deliveries` (one frame or more, `[]` when there are none).

**Frames down** on a project socket (`ProjectDown`):

| `t` | fields | meaning |
| --- | --- | --- |
| `welcome` | `project`, `member`, `head` | first on every socket: whom the hub admitted, and the project's latest offset |
| `log` | `events`: `[{offset, event}]` | log events with their project offset beside them (never inside: a stored event's code verifies as it did on arrival) |
| `caught-up` | `offset` | the backlog after `resume` is sent; live from here |
| `more` | `offset` | this page of the backlog ends at `offset` and more remain: send `resume {after: offset}` |
| `human-ack` | `nonce`, `offset`, `writer`, `seq` | the web `human` with this `mac.nonce` is stored |
| `session` | `message` | a DX4 message. Outside subscriptions, to every socket of the project: `presence` (on connect as above, then as a machine posts it), `raised`, `settled`, `delivery`, `compact`. A subscription's kinds go to the one socket that holds its `sub`, as the machine numbered them; the hub's own `end` for a sub carries the next `n` the browser expects (0 for one it ends before anything was relayed) |
| `pending` | `requests`: `[{machine, raised, terminal_only}]` | the project's whole pending set, on connect and whenever it changes (a raise, a settlement, a machine's republish, a `deadline` passing); `terminal_only` (below) |
| `deliveries` | `deliveries` | the latest DX4 `delivery` per event and recipient, on connect; later ones arrive as `session` messages |
| `machines` | `machines`: `[{machine} + MachinePresence]` | every machine that has reported its DX4 `machine` presence to the project, `online` the hub's from the lease; on connect and whenever a machine's presence or lease changes |
| `rpc-state` | `nonce`, `state`, `outcome?` | `forwarded`, `done`, `failed`, or `uncertain` (DX6); `outcome` with `done` and `failed` |
| `refused` | `refusal`: DX2's `Refusal` with `id`, `at`, and `machine?` (a machine's upload), or `member?` and `nonce?` (a browser's frame) | a refusal of the hub's own, recorded in the audit record: to every browser of the project, the sender included |
| `rejected` | `rejection`: DX2's `Rejection` with `id`, `at`, `machine` | a daemon's report of an event it refused (DX2 `rejected`), recorded in the audit record: to every browser of the project |
| `decided` | `decision`: `{id, at, machine, session, settled, raised}` | a decision on a pending request, recorded in the audit record from the bridge's `settled` (verbatim, its code intact), with the `raised` it settled (verbatim, or null when the hub no longer held it): to every browser of the project |
| `part` | as DX2 | |

**RPCs.** The hub answers a browser's `rpc` with `rpc-state` and never queues one. At once, without a record and to
the sender alone, it answers `failed` with DX6's hub codes: `bad-shape` (not an RPC of this project with DX6's
fields, a nonce and a code in canonical base64url, or a nonce already used for another RPC), `not-member` (`member` is
not the signed-in member), `stale` (`created` more than 60 seconds ago by the hub's clock), `machine-offline` (no fresh
lease). Otherwise it records the RPC by its nonce as `forwarded`, writes it to the machine's stream (DX2 `rpc`), and
sends `rpc-state` — `forwarded`, then `done` or `failed` with the daemon's outcome, or `uncertain` when the machine
dropped after forwarding (DX6) — to every socket of the issuing member, wherever it is open. A nonce the hub has
recorded (kept a day) is answered from its record and never forwarded beside its first: a browser that lost an answer,
or reconnected, sends the same sealed RPC again for its current state, and an `uncertain` one is forwarded again once
its machine is back, for the daemon's ledger to answer. So a browser keeps an RPC until it holds a final state
(`done` or `failed`), not merely `forwarded`.

**The audit record.** Every `refused`, `rejected`, and `decided` is an entry of the project's audit record, kept in the
object's storage: `id` is its place in the record (rising; an entry seen twice is one entry) and `at` when the hub
recorded it. An entry goes to every browser of the project as it is recorded, whether or not the browser follows the
log; and after each `caught-up`, the hub replays the record's latest 100 entries as `refused`, `rejected`, and
`decided` frames, oldest first, so a browser that was not connected when something happened still sees it. A decision
is written from `settled` alone — the side the bridge says the engine used, who answered, and when — never from the
web's attempt, and its `settled` carries the bridge's code for the browser to check.

**A raise against a settlement [2026-10-19, MAWS #71].** A request raised again after its settlement (DX4 `settled`,
once per raise) is pending again, and the browser orders the two by its socket's order, which is the hub's: a
settlement is sent (`session` `settled`, then `decided`) before the `pending` set without its request, so a `pending`
set that holds a request came after every settlement of it the socket carried; and a decision replayed after
`caught-up` was recorded before the connection's own `pending` set (on connect, ahead of any `resume`), or was sent to
this socket live behind its `settled`. So a `raised`, or a `pending` set holding the request, ends the settlement the
browser holds for it (and the browser's own decisions on the raise that settlement ended), and a `decided` for a
request its latest `pending` set holds is passed over: it settled an earlier raise, or repeats the `settled` just taken.

**`terminal_only`** is the hub's, computed by its own clock: a background subagent's request whose `raised.deadline`
has passed. Such a request stays pending (nothing is settled at the deadline) but only the terminal can answer it, and
the web draws it as waiting in the terminal, without Allow or Deny. The web reads it from `pending` and never compares
`deadline` with its own clock; the hub's alarm sends `pending` again when the deadline passes.

**Grid** (`GridDown`, registry socket): `grid {projects: [ProjectSummary]}` on connect, then `summary {project}` for
each change — a project registered, or a project's counts moving. `ProjectSummary` is `{id, name, machines,
machines_online, working, waiting, live}`: `machines` every machine that has opened the project or reported its presence
there, `machines_online` those with a fresh lease, `working` the sessions of online machines whose presence `status` is
`busy` or `shell`, `waiting` those whose `status` is `waiting` (the session record's own words, as `sminos list`
reads them). **[2026-10-18, owner]** `waiting` also counts, once, a session of an online machine holding an open async
question, while its `status` stays `busy` (its engine works on, and it counts as `working` too): a pending request the
bridge raised `async`, or a log `question` (from the session's feed, `src` the ask's id) with no `answered` of the same
`src` from the session since, asked since the session's latest `retired` (an ask dies with its process), that the plane
has not settled (a bridge's ask is the request its call's id names). A log question counts only while its session's
process lives: a session whose kept presence says `record: null` (no process, as a stopped seat's, which never
retires) is not counted for it, and counts again once it runs, as a bridge's ask is withdrawn when its process ends;
the web reads it the same way and keeps such a session under ended. The hub keeps the log's open questions as it
stores each event (`log-store.ts` `open_questions`; events stored before that table are not read into it), and reports
the summary again when a `question`, `answered` or `retired` moves them, or the pending set moves. Blocking questions
and permission requests count as before, by presence. **[2026-10-19, owner]** `live` counts the sessions whose kept
presence names a process (`record` not null) on every machine that holds the project, online or offline: a sleeping
laptop's sessions are still where they are (its tile reads Offline), and a machine gone for good is revoked, which drops
its sessions. A follower's presence is not counted. The Registry keeps it in `summaries.live`; a report without it (a
`Project` on the version before) leaves the stored count. The web shows a project with `live` or `waiting` by default
(§4). Each `Project` reports its counts to the `Registry` when they change. The grid takes nothing up. A frame above the frame bound (a `grid` of many
projects) comes down as DX2 `part` frames, which the browser reassembles as it does on the project socket.

**Built at M2:** the socket's admission (a registered project), `welcome.head`, `resume`, `log`, `caught-up`, `human`
and `human-ack`, `refused` and `rejected` with the audit record and its replay, `session` frames carrying
`presence`, and `part` frames up (a part set a socket sends is lost with a hibernation, as a half-sent frame would
be). **Built at M3:** the session plane — `rpc` and `rpc-state`, `subscribe`, `unsubscribe`, `rows`, `diff`, the
relay, `pending` with `terminal_only`, `deliveries`, `machines`, `visibility`, `decided` in the audit record, presence
withheld after a lease lapses, the attachment's subscription ids and the stored routes — and the registry socket with
its summaries, proved on the local runtime by `test/session-plane.test.ts`, including two real hibernations of the
`Project` while sockets stay open (Miniflare's `unsafeEvictDurableObject`) and a `Machine` terminated under its stream
(`ctx.abort()`; workerd will not evict an object holding a streaming request).

**For DC9 [2026-10-17]:** `output` up, checked by shape and routed by `ownRoute` as `rows` is, refused `bad-shape` for
`taskId` or `tail` out of form; carried to the machine as DX2 `output`. A hub older than DC9 refuses the frame
`bad-shape` (`dispatch`'s default), which is why the hub ships before the web asks and before any uplink answers.

### DX4 — The session-plane envelope (owner DC3; G1; the relay built at M3)

2026-10-22: extended by the desk control surface (`docs/doperpowers/specs/2026-10-22-desk-control-surface-design.md`, its Interfaces' DX4, DX3 and DX2): the session
presence's `capabilities` and `mode`, the machine presence's `desk`, the subscription kinds `read` and `catalog`,
the session-wide `op`, the browser's `read` frame carried to the machine, and DX2 `welcome.kinds`. Where the two
differ, that spec's shapes (written once, in `apps/desk-hub/src/protocol/`) hold.

```ts
type Envelope<K, Session, Sub, N> = {
  project: string;            // .smns id
  machine: string;            // the enrolled name
  session: Session;
  kind: K;
  sub: Sub;
  n: N;
  body: SessionBodies[K];
};
// Discriminated by kind; each kind's invariants are in its type:
type SessionMessage =
  | Envelope<'snapshot', string, string, 0>                                                       // a sub's first message
  | Envelope<'row' | 'chunk' | 'block-row' | 'step-end' | 'rows' | 'subagents' | 'diff' | 'usage' | 'output' | 'end', string, string, number>   // then n = 1, 2, … (`end` may come first, at n 0); `output` [2026-10-17]
  | Envelope<'presence' | 'raised' | 'settled' | 'delivery' | 'compact', string, null, null>     // to every browser, outside subs
  | Envelope<'machine', null, null, null>;                                                         // names no session
```

(`session.ts` writes it as a mapped type over the kinds, one `Envelope` per kind, so a `chunk` without a sub or a
`machine` message with a session fails to typecheck.)

**An `end` may be a sub's first message**, at `n` 0, when the subscription ends before its snapshot could be taken: an
unknown session, a bridge not ready yet, a cut row that never reached disk (DX5). It carries the reason it would carry
later; on `discontinuity` at `n` 0 the browser subscribes again after a short backoff rather than at once. The hub
relays it as it relays any `end` of a sub it holds, and forgets the sub.

**A subscription's scope** is one transcript, named when the browser subscribes (DX3) and carried to the machine
(DX2): the session's main transcript (`agentId` null) or one subagent's. The snapshot's rows and every `rows` page
come from that transcript alone. A main-scope sub also carries every agent's chunks and `block-row`s, and the
subagent tree; since it carries no subagent's rows, a subagent's `block-row` there settles that block at once, and the
browser drops its partial text (the row is drawn by that agent's own sub). An agent-scope sub carries that agent's rows, chunks, and `block-row`s, and its snapshot's `subagents`
and `streaming` are that agent's own.

| `kind` | in a sub | body |
| --- | --- | --- |
| `snapshot` | yes (`n` 0) | `{rows, more, subagents, presence, streaming, usage, jobs, mcp}` (**[2026-10-17]** `subagents` entries widened, `jobs` and `mcp` added, as the `subagents` row below): `usage` is the bridge's last `usage` (DX5) on a main-transcript subscription, null when the session has no bridge or none has come yet, and absent on a subagent's; rows of the sub's transcript newest first up to the last flushed row, as many as fit the frame budget; `more` whether older rows exist; `streaming`: the bridge's snapshot entries (DX5) passed through, one per model request still streaming, `{turnId, agentId, step, model?, upTo, blocks: [{index, kind, text, upTo, id?, name?}]}` holding only its content blocks without a `block-row` yet, below (`step` the model request's ordinal in the turn; `model` what the request was sent with, absent when its start was not seen; the entry's `upTo` the `chunkIndex` of the last chunk applied to the message, -1 for none, and **the watermark**: `chunkIndex` counts across the whole message, so a chunk at or below it is already in the text, whichever block it belongs to; `index` the content block's, the same `index` its chunks and its `block-row` carry; `kind` one of `text`, `thinking` (redacted thinking included), `tool`; `text` the partial text, a tool block's being its argument JSON streamed so far, unparsed until its row; a block's `upTo` informational only; `id` and `name` the call's `tool_use_id` and tool name, on a tool block only). An entry whose `blocks` is empty can remain until its step ends and is skipped. **[2026-10-18]** `offChain: string[]` lists the uuids among `rows` that are off the session's live chain. It is always present and may be empty (the live chain, below) |
| `row` | yes | `{row, agentId, offChain?, onChain?}`: a transcript row verbatim; `agentId` the subagent whose transcript holds it, or null. **[2026-10-18]** `offChain` lists the rows this row took off the live chain: the rows left behind by a branch it starts, oldest first, plus the row itself when it is written off the chain. `onChain` lists the rows it put back. Each is present only when non-empty |
| `chunk` | yes | `{turnId, agentId, step, chunkIndex, chunk, t?}`: DX5's chunk event, the `turn.step` chunk object verbatim under `chunk` (nested, since it has an index field of its own), `chunkIndex` its index in its message from 0. **[2026-10-18, MAWS #57]** `t`, a number, is the bridge's DX5 event stamp in ms since the epoch on the machine's clock: the plane passes it through, and the hub relays it verbatim. The web uses it only for its chunk-to-drawn latency readout, which compares two clocks. Producers older than doperpowers #246 (7.183.3) don't send it, and the web records nothing for those chunks |
| `block-row` | yes | `{uuid, turnId, agentId, step, index}`: the engine wrote the row `uuid` for content block `index` of that step; sent before the row itself arrives |
| `step-end` | yes | `{turnId, agentId, step, t?, model?, effort?}`: that model request ended — finished, aborted, or cut off by its turn's end — from DX5's `step end` or `turn complete`; sent after every `block-row` of the step, so a block of it still without one never gets one, and the browser drops its partial text. **[2026-10-29, sminos 1.27.12]** Each optional field is present only when the producer knows it, never null for unknown, and the hub relays them verbatim: `t`, a number, the bridge's DX5 stamp of the event that ended the step (its `step end`, or the `turn complete` that cut it off), ms since the epoch on the machine's clock as a `chunk`'s `t`; `model` and `effort`, what the step's DX5 `step start` carried, so the main loop's carry a model or effort chosen through the bridge, and `effort` is null when the request named none. A subscription that began mid-step carries its snapshot entry's `model` and no `effort`, which the entry does not keep; a step it knows only by its chunks carries neither. Producers older than that send none of the three |
| `rows` | yes | `{rows, before, more, offChain}`: older rows of the sub's transcript, newest first, answering a `rows` request; **[2026-10-18]** `offChain` as in the snapshot, for the page's rows |
| `subagents` | yes | `{subagents: [{agentId, meta, status, evidence, running?, spawn?, outcome?, file?}], jobs: [Job], mcp: [{name}]}` **[2026-10-17]**: each `meta` a `subagents/*.meta.json` verbatim (a main-scope sub's the session's tree, an agent-scope sub's that agent's own, as before); `status` one of `running \| completed \| failed \| stopped \| exited \| unknown` (MAWS's `TaskStatus` words, so the web patches without a mapping) and `evidence` what it rests on, `bridge \| rows \| parent \| session \| none` (below); `running` the bridge's, present while the bridge holds the agent; `spawn` the bridge's spawn record, `{parentAgentId, subagentType, description, name, background, model, toolUseId}` (DX5 `agent` spawn, or the `$.agent.list()` seed's `{parentAgentId, subagentType, description, name?}` for an agent the module did not see spawn — `name` when the engine's list gives one (DC8, 2026-10-17)), present when it holds one; `outcome` from the rows — the loop's, or for a nested agent its parent agent's transcript — `{status, raw, at, summary?, outputFile?}`, `raw` the engine's own word before the normalization table below; `file` the agent transcript's `{size, mtimeMs, firstAt, lastAt}`, read only when size or mtime changed. `jobs`: the loop's background shells and monitors, `{taskId, kind: "shell" \| "monitor", toolUseId, startedAt, description, command?, outputFile: string \| null, status, endedAt?, summary?}`, `status` as above less `unknown`, `outputFile` null until a row names one (a Monitor's result names none; a notification or a `task_status` may). `mcp`: the server names the loop's `mcp_instructions_delta` attachments added and did not remove, in order; names only. Sent in the snapshot and whenever any of it changes (the metas today, every `METAS_EVERY`; now also a status, a job, a name). A consumer older than DC9 reads `subagents[*].agentId` and `meta` and ignores the rest; a producer older than DC8 sends the two fields alone, and the web then shows an agent as it does today |
| `diff` | yes | `{base, text}`: unified diff of the working tree against the base branch |
| `output` | yes | **[2026-10-17]** `{taskId, result, …}`, answering an `output` request, one of four variants by `result`: **`ok`** `{taskId, result: "ok", path, size, from, text, truncated}` — `path` the output file as the session's rows named it, `size` the file's bytes, `text` its last `tail` bytes decoded UTF-8 with replacement, cut forward to the first line break inside the window when the window does not start the file, `from` the byte offset `text` starts at, `truncated` whether anything precedes it; **`missing`** `{taskId, result: "missing", path: string \| null}` — the task is known and there is nothing to read: `path` a string when the rows named a file, it passed containment, and no file is there (the engine writes them under the temporary directory), or null when no row has named a file for the task yet (a monitor just started; `Job.outputFile` null) — never `refused`, which is the containment refusal alone (the review's round 2); **`refused`** `{taskId, result: "refused", path, reason}` — the path the rows named fails containment (below), `reason` a sentence for the human; **`unknown-task`** `{taskId, result: "unknown-task"}` — the loop's index holds no such task. No variant carries a field another variant's rule leaves out. The consumer: `ok` draws the tail, with how many bytes precede it when `truncated`; `missing` says the file is gone, or that the task has no output file yet when `path` is null, leaves the row's own summary standing, and stays retry-eligible — when a later `subagents` supplies or changes the task's `outputFile`, the web may ask again; `refused` draws as a warning with `reason` and offers no retry; `unknown-task` waits for the next `subagents` to carry the task (the request raced the index) and otherwise says the task is unknown to the machine. Read on the thread that reads pages |
| `usage` | yes | `{context: {tokens?, window, percent?}, cost: {usd} \| null}`: the bridge's `usage` event (DX5) verbatim (`tokens` and `percent` absent until a response has reported the window's fill; `cost` null where the engine keeps no ledger), after each main turn, on main-transcript subscriptions only. It is the one source of a session's context use and cost on the web: the transcript's rows do not carry them (the engine's `cost-state` records have no `uuid` and are not rows here), so a session without a bridge shows both as unavailable |
| `end` | yes | `{reason: "unsubscribed" \| "machine-offline" \| "session-ended" \| "discontinuity" \| "error", message?}`. **[2026-10-17]** `session-ended` is sent at `n` 0 only, for a session whose transcript the machine does not hold; a subscription whose session ends is not ended (below) |
| `presence` | no | `{record, bridge}`: `record` is `status`, `waitingFor`, `needs` of `~/.claude/sessions/<pid>.json` verbatim, null when no process is live |
| `machine` | no (`session` null) | `{online, policy: {read_only, ceiling}, checkouts: [{path, branch}]}`; `online` is the hub's, from the lease (a producer sends true) |
| `raised` | no | `{request, session, tool, input, agentId?, truncated?, deadline?, async?, toolUseId?, mac}`: `request` the call's tool-use id where the engine gives one (`toolu_…`; an ask-mod question's `toolu_plugin_…`), otherwise a synthetic `request-…`, opaque to every consumer, the DX6 digest included; `toolUseId` the transcript's tool-use id of the call the request belongs to, a non-empty string of at most 512 characters (else `bad-shape`), present only where it differs from `request` (the ask mod's blocking question, whose `request` is the engine dialog it opens inside its own call, a call no transcript row names), so `toolUseId ?? request` is always the id a transcript row carries, or a synthetic id no row carries; `deadline` ISO 8601 UTC with milliseconds (the producer converts DX5's epoch milliseconds); `async: true` for the ask mod's async question, answered or withdrawn, never denied; `agentId` the subagent that asked (absent for the main thread), a non-empty string; `truncated: true` when the bridge capped the input it shows, and the DX6 digest is over that capped input on both sides. The code covers every field, and the hub keeps and relays them as received; another form of `agentId`, `truncated`, `deadline`, or `async` is refused `bad-shape` |
| `settled` | no | `{request, winner: "web" \| "terminal" \| "other", outcome, by, mac}`; taken once per request: the hub removes the request and records its decision from the first, and a `settled` for a request it already settled (a daemon that restarted between sending and recording it) is accepted without a second broadcast or decision; the settled ids are in storage, kept a month, so this holds across an eviction. **[2026-10-19, MAWS #65]** Once per raise: a request raised again after its settlement (the open ask a resumed session's bridge raises under its call's id) is pending again, and the next `settled` for it removes it and records its decision; the daemon sends that `settled` though it sent one for the id before, and never sends a `settled` after a later `raised` of the same request (a raise drops from its outbox any settlement of that request still unsent), so a `settled` that finds its request pending is of that raise, never an earlier one sent again. The browser orders a raise against a settlement as DX3 has it (a raise against a settlement, MAWS #71) |
| `delivery` | no | `{event: {writer, seq}, session, outcome: "delivered" \| "recorded" \| "refused-read-only" \| "uncertain" \| "failed", reason, mac}`; a `recorded` for a closed terminal session can be followed by `delivered` for the same key after Resume; `uncertain` is a push whose frame was taken but never answered |
| `compact` | no | `{rpc, phase: "start" \| "end", tokensBefore?, tokensAfter?, skip?, error?}`: a compaction's progress, from the bridge's DX5 `compact` events; `rpc` the nonce of the DX6 `compact` that asked for it, or null for one the session started itself; on `end`, `tokensBefore` and `tokensAfter` (null when the engine recorded none), or `skip` (a hook vetoed it), or `error` (the engine refused it) |

`raised`, `settled`, and `delivery` carry codes under their own domains (DX1). The hub interprets `presence`,
`machine`, `raised`, `settled`, and `delivery`; it relays every other kind, `block-row` included, without reading its
body.

**The live chain [2026-10-18, doperpowers #239; plane `Chain` in `sminos_plane.py`].**
- **What it is.** The engine reads only the chain from a transcript's leaf back through `parentUuid`. An Esc-rewind, a `/rewind`, or a response the engine dropped leaves rows on a dead branch, and the engine no longer holds them.
- **Where the marks are read.** The machine marks those rows off its own copy of the chain, fed in the order the subscription's messages go, so a page never contradicts a `row` sent before it.
- **Compatibility.** The fields are additive: an older desk ignores them, and the hub relays them unread.
- **Consumer rule.** Apply the marks in message order; the latest wins. A snapshot or page sets on or off for each of its rows. A `row` adds its `offChain` and removes its `onChain`. A uuid in `offChain` may name a row not paged in yet; the page that later brings it carries its own mark.
- **The engine's rules (2.1.300), as the plane mirrors them:**
  - A tool result names its issuing assistant (`sourceToolAssistantUUID`), not the leaf, and stays on while that assistant is on the chain.
  - Any other row parented off the leaf starts a branch. The rows after the branch point go off, except those the resume loader recovers: response siblings and their results, and attachment, system and meta-user rows.
  - Rows a branch had taken off come back with their responses, in file order.
  - A child written before its parent waits for it.
  - A null parent (a compaction boundary) continues the chain, so history before a compaction stays drawn.
  - One deliberate divergence from the loader: a plain user row delivered between a call and its result stays on. The live engine read it; the loader drops it on resume.
- **Checked offline** on 1,500 local transcripts (about 667k rows, about 2 µs a row): 870 branches, each a re-sent prompt, a `/rewind` or a dropped response, and every final chain matched the loader apart from that divergence.
- **Known gaps** (doperpowers TECH-DEBT):
  - A retraction lands with the branch's first row, not at the Esc. The interactive engine writes nothing when it hands a prompt back.
  - An Esc that empties the conversation (a session's first prompt) leaves no branch, so the desk keeps #42's frame-line fold for that delivery.
  - A row whose parent never appears stays unmarked (1 in 1,500 transcripts).

**Streaming is per content block.** One API response becomes several transcript rows, one per content block, and the
mod sees no API message id, so a streaming block is settled by row uuid. A `block-row` touches two parties at two
moments, kept apart:
- **The producer** (the bridge's endpoint; the fake machine) removes the block from its snapshot state when it applies
  the block's `block-row`, or its step's end, under the same lock that takes snapshots and adds subscribers. So a
  snapshot's `streaming` holds only blocks of a live step without a `block-row` yet, and never a block whose
  `block-row` or `step-end` was already sent to that subscriber: an aborted block reaches no later subscriber, which
  would have no `step-end` coming to drop it.
- **The browser** keeps drawing the block's partial text after the `block-row` until the `row` whose `uuid` it named
  arrives; that row settles the block, and the browser drops the partial text then. Chunks for a settled block are
  ignored. A block whose step ended (`step-end`) without a `block-row` for it — a response aborted mid-block — is
  dropped then, so no partial text outlives its request. The bridge holds a step's end until that step's notices are
  posted, for at most 1 s, and once a step's end is out its pairing is closed: a later row of the step is named by
  `row-seen`, never `block-row` (DX5's M4 extension). So a `step-end` is final, and the row of an aborted block
  arrives as any other row.

Together with the daemon dropping tailed rows the snapshot already holds (by uuid) and chunks at or below their
entry's `upTo`, the snapshot and the live part neither overlap nor leave a gap. A row no `block-row` named (a server
tool's, whose block streamed as none of the three kinds) settles nothing and is simply drawn.

**Discontinuity.** A gap in `n`, a hub restart, or a dropped connection makes the browser subscribe again for a fresh
snapshot. A gap in the bridge's own stream (DX5's `gap`), and the end of a DX5 subscription the daemon holds (the
child ends every open one when it applies any `resync` after its first: a module reload, a replacement child), each
end every DX4 subscription they touch with `end {reason: "discontinuity"}`, and the browser does the same. Nothing is
resumed from a hub buffer.

**History and ended sessions [2026-10-17, §9.2; DC8 produces, DC9 consumes].** A subscription outlives its session.
Once the session's process is gone and what it flushed is drawn (the machine's grace, 1 s today), the machine sends no
`end`: the subscription stays open and idle, carries nothing live, and answers `rows` (and `output`) until the browser
unsubscribes, the machine goes offline, or a discontinuity ends it — a bridge answering for the session again, as
Resume brings it back, ends a transcript-only subscription `discontinuity`, and the fresh one streams. A subscribe to
a session with no process is served the same way: a snapshot from disk, then pages. The browser reads whether the
session runs from `presence` (`record` null: not running), never from the subscription; `session-ended` after a
snapshot means a daemon older than DC8, and the browser treats it as it did. **Pages** come from an index the machine
builds once per transcript file when it first parses it (at a subscription's open) and extends as rows are flushed —
each row's uuid, byte offset and length, in file order — shared by every subscription on that transcript and dropped
when the file is replaced or shrinks (`discontinuity`, as today). A page reads and parses only the rows it returns,
the newest before `before` that fit `limit` and the 512 KB budget, and that read runs off the uplink's thread, so a
page costs its own bytes, not the file's: the measured 2.15 s a full parse of a 156 MB transcript takes is paid once,
at the open, never per page. The web pages a live or an ended session to its first row. The hub changes nothing for
this; the fake machine already keeps its sessions pageable after a replay and sends `session-ended` at `n` 0 alone.

**Jobs and agent status [2026-10-17, §9.3–9.4; DC8 produces, DC9 consumes].** The widened `subagents` body is built
on the machine from the rows the subscription already parses — at the open and as rows are released — joined with the
bridge's agent state (DX5's `agent` spawn and stop events, and `resync.agents`, which DC7 dropped and DC8 forwards)
and disk facts about each agent's transcript. The rows read, as the engine writes them (2.1.300–2.1.301; engine
internals, Risks): a `tool_result` for a call; a user row's `queued_command` attachment with `commandMode:
"task-notification"`, or a plain user row whose text is the notification — the form the engine writes when it starts
a turn on one (76 of 300 recent transcripts; DC9, 2026-10-17) — both read, a plain row only when it is a user row
whose `origin.kind` is `task-notification` and whose text starts with `<task-notification>` or, in a subagent's
transcript, with the engine's fixed `[SYSTEM NOTIFICATION - NOT USER INPUT]` preamble and the notification after the
blank line (the shared fixture's `about`; a typed prompt or a peer message never carries that origin), carrying
`<task-id>`, `<tool-use-id>`, `<output-file>`, `<status>` and `<summary>`; a user row's `task_status` attachment `{taskId, taskType, description, status, deltaSummary,
outputFilePath}`; the bridge's notes that a task was stopped, each a doperpowers plugin meta row matched on its whole
text — `Task <id>, a background task, was stopped from the desk: it is not running.` (DC10's Stop) and the interrupt
note's `Task <id>, the Bash command the interrupt moved to the background, was then stopped: …` line — read as
`stopped`, since `TaskStop` through `$.tool.call` writes no row and, for a main-loop task, queues no notification
(DC10, 2026-10-18; fixture case 16); a Bash result whose `toolUseResult.backgroundTaskId` is set, its text naming the file after
"Output is being written to:"; a Monitor result's `toolUseResult {taskId, timeoutMs, persistent}`; a `TaskStop` call
(`input.task_id`) with a result that is not an error; `mcp_instructions_delta` (`addedNames`, `removedNames`). A
nested agent's result row and notification are in its parent agent's transcript, not the loop's: the producer reads
them there, for the nested `toolUseId`, as a disk fact of the parent's file, re-read only when that file's size or
mtime changed. The bridge's agent state covers agents the module did not see spawn: at load it seeds `agents` from
`$.agent.list()` (`{id, description, type, status, parentId}`) and refreshes while any runs, so a module reloaded
mid-session still names the agents running then (the review, 2026-10-17).

**One normalization table**, applied by both producers (the plane, the fake machine) to every raw status word the
rows carry — a notification's `<status>`, a `task_status`'s `status`, a `task.updated` patch's — built from MAWS's own
two mappings (`backfill.ts` `parseTaskNotification`; `task-graph.ts` `statusOfPatch`):

| raw | DX4 `status` | terminal |
| --- | --- | --- |
| `completed` | `completed` | yes |
| `failed`, `error` | `failed` | yes |
| `stopped`, `killed`, `cancelled`, `interrupted` | `stopped` | yes |
| `running`, `pending` | `running` | no |
| anything else | no change; kept in `outcome.raw` | — |

A result row is terminal: `completed`, or `failed` when `is_error`; a `TaskStop` with a non-error result is `stopped`.
A monitor's expiry notice is terminal (DC8, 2026-10-17): a task-notification for a task the index holds as a
monitor, with no `<status>`, whose `<event>` begins `[Monitor expired after ` or is `[Monitor timed out` (engine 2.1.300,
`dEr`) is `completed` with raw `expired`, `endedAt` the notice's time and `summary` its `<event>` — the word MAWS's
backfill lands on for a notification without `<status>` (`backfill.ts:678-682`); a monitor's other statusless event
notices are no evidence, so a monitor that expired never stays `running` until its session ends.

**Precedence** (the review's round 2, 2026-10-17), highest first — better evidence is never overridden by worse:
(1) an explicit terminal outcome in a row — `completed`, `failed` or `stopped` after the table, the newest in row
order (`evidence: rows`; for a background agent, the result row is its start and does not count). An agent is known as
background by `meta.requestShape`, `spawn.background`, the persisted call's `input.run_in_background` (`true` or
`"true"`; `false` proves nothing, since calls flagged false were launched async), or its result's exact launch text
(`Async agent launched successfully.` followed by a line `agentId: …`, or a fork's `Fork started — processing in
background`), read only on a result row with no `toolUseResult` that is not `is_error` — where one is present its status decides, since a
foreground agent's own answer may begin with that text. Either text is `async_launched` running evidence at (3), and a
launch without a `toolUseResult` names no `outputFile` (the panel, DC8, 2026-10-17: older launches and all forks carry no `toolUseResult`, so without these a
cold open read them `completed` while the live view read `exited`). (2) known process death, `exited`: the session's process is gone (`session`), the parent
agent (`meta.parentAgentId` or `spawn.parentAgentId`) has ended — a terminal status or `exited` of its own
(`parent`) — or the bridge reports the agent stopped without a terminal word (`bridge`); (3) `running` or `pending`
evidence, `running`: the bridge's word on an agent it holds (true from spawn, the seed or a refresh; `bridge`) or a
row's non-terminal word (`rows`), a background agent's launch result (`toolUseResult.status` `async_launched`)
among them, as `outcome {status: running, raw: async_launched}` (DC8, 2026-10-17: without it a background agent of
a running session without a bridge would be `unknown` with a result in hand, none of the named cases) — and cached bridge-running evidence stops counting once the session's process is
gone, so (2) holds then; (4) `unknown` (`none`), only with no evidence, the cases §9.3 names: a parent transcript gone
or unreadable while the parent is not over; a running session without a bridge whose agent's call has no result,
notification or `task_status` yet; a meta with no `toolUseId` and no spawn record. An unrecognized raw word changes
nothing at any level. **The same status from cold and from live:** a subscription opened on an ended session
(reconstruction from disk alone) and one that was open while the session ended reach the same statuses, so the
producer re-derives every entry when the process goes (presence `record` null) and sends a `subagents` message for
what changed; a `running` held from the bridge turns `exited` then. Accepted residual: a background agent resumed
after its notification shows `completed` until its next notification, since a row's terminal word outranks the
bridge's `running`. A job is `running` from its start row, ends on its notification, `task_status` or `TaskStop`
through the same table, and is `exited` once the session's process is gone. The web patches these onto MAWS's task
graph on the desk side (`task-feed.ts`), never in MAWS's `mergeSidecars`. One fixture of rows and the body they yield
pins the plane's and the fake machine's derivations, as DX1's vectors pin its two code implementations (doperpowers
`tests/sminos/dx4-jobs.json`, run by `jobs_parity.py`; its `about` field is normative where this prose is silent —
unrecognized words, an Agent result's raw word, ties within a level, a job's times and summary, MCP removals before
additions, an output window without a line break); it holds the
module-reload case, a nested agent whose parent still runs, a cold open of an ended session holding an agent with a
`running` status and no completion notification (`exited`), a nested agent under an ended parent (`exited`), each raw
word of the table, a background agent of a bridgeless running session with only its `async_launched` result
(`running`), an unknown task, a deleted output file (`missing` with its path), a monitor just started with no path
(`missing` with `path: null`), and an output path under the original working directory's slug for a session whose
transcript lives under another (`ok`).

**`output` [2026-10-17, §9.4].** The browser asks `output {sub, taskId, tail}` (DX3); the hub carries it (DX2); the
machine answers `output` on the sub. **Containment** (the review, 2026-10-17): the machine first derives the
**canonical roots** for the session from its own state, never from a row — the engine's tasks directories,
`<resolved tmp>/claude-<uid>/<slug>/<session id>/tasks/`, where `<resolved tmp>` is the realpath of
`CLAUDE_CODE_TMPDIR` or `/tmp` as the engine resolves it (SPEC ch. 20, "the shared per-uid temp root"; `/private/tmp`
on macOS), `<uid>` the daemon's own, `<session id>` the subscription's, and `<slug>` each of: the name of the
transcript's project directory (`~/.claude/projects/<slug>/<session id>.jsonl`), the engine's slug (SPEC §35.2.1) of
the working directory the session joined the log with, and the engine's slug of its session record's `cwd`. A shell
a `--bg` takeover adopted from another session writes under that session's root, which nothing on the machine names
(`adoptShellOutputRoot` is the engine's in-process takeover state in 2.1.300, not a setting; DC8, 2026-10-17): its
output is refused, a known refusal, never a root read from a row. A set, not one
root (DC8, 2026-10-17): the engine's temp directory takes the slug of the session's original working directory,
so a session that moved into a worktree writes its outputs under one slug while its transcript lives under another
(a family coordinator session's rows named 387 output paths under the first and 137 under the second); one root
taken from the transcript directory would refuse most of its shells. It then serves only a task the loop's index
holds (`unknown-task` otherwise), only at the path the session's own rows named for it — a `task_status`'s
`outputFilePath`, a notification's `<output-file>`, a Bash result's "Output is being written to:" — and only when
**both** hold: the path carries the suffix `<session id>/tasks/<taskId>.output`, and the realpath of the target as
opened (symlinks resolved) equals `<realpath of one root>/<taskId>.output` exactly and is a regular file — exact, not a
component prefix, which would accept a symlink to another task's file under the same root (DC8, 2026-10-17); the check runs again on the opened descriptor (its path, `F_GETPATH` on macOS, `/proc/self/fd` on Linux), so nothing swapped in between check and open is read, and a descriptor that cannot be named is refused. So a symlink under the root whose target keeps all three suffix
components elsewhere (`…/<same session>/tasks/<same task>.output` under another root) is refused, an ordinary
symlink to a file of another name is refused, and an agent task's `.output` — a symlink the engine makes into the
agent's transcript under `~/.claude/projects/` (SPEC ch. 20) — is refused, the agent being read through its own
subscription. A refusal is the answer's `refused` variant with its reason; a path that passes and is not there is
`missing`. It reads the last `tail` bytes backward from the end, as the bridge child reads a tail, on the thread that
reads pages; it never follows a path the rows did not name and never lists the directory. The deploy order: the hub
ships before the web asks and before any uplink answers (the hub refuses an unknown frame and an unlisted kind
`bad-shape`, the uplink passes an unknown frame by).

**Settlement (confirmed by DC2, DX4's producer).** `settled.outcome` is one of `allow`, `deny`, `answered`,
`withdrawn`. `winner` and `by` name who decided: `web` with `by` the member id; `terminal` with `by` `"terminal"`;
`other` with `by` `"cli"` for an answer from the local CLI. A request that ends with no answer used — the turn was
aborted, the session ended, or the call settled another way — is `outcome: "withdrawn", winner: "other", by:
"bridge"`. `"terminal"` and `"bridge"` are reserved: no member id is either. A decision that reaches the bridge after
another side has won, or within 200 ms of a background request's deadline, is refused there (DX5's 409, naming the
winner, or `terminalOnly`), and the RPC fails at the daemon (DX6's `not-pending` fits; the mapping is DC7's), its
error carrying what the refusal knew: `winner` and `by` from an `already settled` 409's `settled`, `by` alone from a 409
that names who answered first, `terminalOnly` from the closed window (DX6). The request's own `settled` says who won. The hub refuses no decision itself: the bridge alone knows.

**The relay (the hub's part).** The hub reads a subscription message's envelope, never its body: it checks that the
message names this project and machine, a session, a `sub` and a non-negative integer `n`, and passes it to the one
socket that holds the `sub` as the machine numbered it, so `n` runs on unbroken across a hub hibernation or eviction.
It keeps no reconnect buffer: every discontinuity is a fresh snapshot, which the rules above already make whole, so a
buffer would only save a snapshot's cost (G6 measures whether that matters). The hub ends a subscription itself only
when the machine can no longer serve it — its lease lapsed or its stream closed (`machine-offline`) — or when it cannot
take it on (`machine-offline` for a machine without a fresh lease, `error` for a `sub` in use or a socket over 32); a
`subscribe` that comes while the machine is between streams (its closed stream's grace, DX2) waits for the next stream
and is carried to it at its `hello`, or ends `machine-offline` at `n` 0 if the grace runs out first;
that `end` carries the next `n` the browser expects, 0 when nothing was relayed yet, so a client that checks `n`
reads it as the end it is, not as a gap.

**A background subagent's deadline.** `raised.deadline` (optional) is when the web's window on a background
subagent's prompt closes (§2's 3 seconds). Nothing is settled then: the request stays in the pending set, no longer
answerable from outside, until the terminal answers, which settles it with `winner: "terminal"` and the real outcome.
The hub keeps it pending and marks it `terminal_only` in DX3's `pending` (decided here: an explicit flag computed by
the hub, not a comparison the web makes with its own clock, which would be subject to skew).

**Built at M3:** the relay, `end` on a lapsed lease or a closed stream, and the interpreted kinds (`presence`,
`machine`, `raised`, `settled`, `delivery`; DX2 says how each is kept), with `compact` relayed, and an `end` at `n` 0
passed through as a sub's first message, and `step-end` relayed unread as `block-row` is; no reconnect buffer. **For M4:** the fake machine producing all of it,
`block-row` for its rows included (a subagent's `block-row` in a main-scope sub settling that block at once),
`step-end` after every step's `block-row`s, aborted steps included, an `end`
at `n` 0 for a subscribe it cannot serve, and a DX5 subscription the child ends (`end {discontinuity}`).

**For DC8 and DC9 [2026-10-17]:** the hub lists `output` among the subscription kinds and relays it unread, as it does
`diff`; the fake machine carries the widened `subagents` body from its recording's rows, answers `output` from a
recording's `tasks/<taskId>.output`, and keeps answering `rows` after a replay ends (DC9's G5); the plane produces
all of it (DC8).

### DX5 — Local bridge protocol (owner DC2; version 1 with its M2, M3 and M4 extensions and its final review, folded 2026-10-15)

2026-10-22: from the desk control surface's M0 on, DX5 is kept in `docs/doperpowers/specs/2026-10-22-desk-control-surface-design.md`, its Interfaces'
DX5 (the bridge's `capabilities`, the ops `read` and `command`, the `run` event, the route table): this copy
stands as folded and is amended there, not here.

Folded from DC2's plan (doperpowers `0afc902f`, as merged in PR #195,
`docs/doperpowers/plans/2026-10-15-arkho-desk-c2-bridge.md`): version 1 as
built at DC2's M1 and amended by its review's fix waves; the M2 extension,
reviewed clean after two fix waves (`75faba58`, `7842ae4e`); and the M3
extension (requests from outside and their settlement), reviewed clean
after two fix waves (`10f913d5`, `4b13cb9e`); and the M4 extension (the
live export, row order with notices and the seeded cut, the step-end hold,
readiness, the fence), reviewed clean after two fix waves (`1d55316f`,
`f0242560`); and the whole branch's review, clean after two fix waves
(`5003ca2e`, `27c46947`, rows marked **[final-review wave]** and the
"Final-review wave 2" subsection). Rows marked [fw1] or [fw2] changed in
the fix waves of the milestone that built them; rows marked [M2], [M3]
or [M4] were built or changed there. DC2 has closed, so this copy is the
contract: a later change to the bridge's protocol lands here first.
Paths in this subsection are doperpowers'.

Rows changed by fix wave 1 are marked **[fw1]**.

The session endpoint of a bridged session. **Built at M1** unless marked
**reserved (M2)** or **reserved (M3)**; reserved shapes are proposals the
milestone that builds them fixes and sends as an extension.

#### Parties

- **The mod**, `hooks/mods/bridge.tsx`, inside the session.
- **The child**, `sminos bridge --session <session-id>`
  (`skills/sminos/scripts/sminos_bridge.py`), spawned by the mod with
  `$.process.spawn` for the session's life; a direct child of the session process.
- **Local clients**: the CLI (`sminos watch` now; the control verbs at M2/M3) and the
  daemon (DC7).

#### The endpoint and presence (built)

- **Path:** `$SMINOS_HOME/bridge/<session-id>.sock`; the directory is mode 0700, the socket
  0600. The path must fit a Unix socket (at most 103 bytes; the child exits 1 otherwise).
- **Transport:** HTTP/1.1 over the socket, JSON bodies, `Connection: close` on every
  response (one request per connection).
- **Placement:** the child binds `.<first 8 of id>.<pid>.sock` in the directory, listens,
  sets 0600, and renames it onto the path; then it writes `hello` on stdout. So the path
  never names a socket that is not yet listening. **[fw1]** A child's identity is the
  inode of its own socket, read from the temporary name before the rename (never from
  the path after it, where a newer child's socket may already stand).
- **Presence:** a session has a bridge when `GET /status` on its path answers 200 with its
  session id. (DX4's "bridge connected".)
- **Stale rule:** a socket file whose connect fails is stale; whoever finds it removes it,
  having checked its inode is the same before the connect and before the unlink
  (`sminos_bridge.remove_stale`). A starting child replaces a stale file by its rename.
- **Discovery (DC7):** list `$SMINOS_HOME/bridge/*.sock` (skip names beginning with `.`, a
  child's temporary bind) and probe each.
- **One child per session:** a newer child takes the path over; an older one exits within
  0.5 s of finding the path's inode no longer its own, without unlinking. A child also
  exits when its parent process is gone (the session ended or was killed), on SIGTERM or
  SIGHUP, or when its stdout breaks; it unlinks the path only if the inode is still its own.
- **When the mod spawns one:** at `session.start`; again after a module reload (the reload
  kills the child and runs `session.start` again); again after a child ends on its own
  (1 s, doubling to 60 s, back to 1 s once a child lived 30 s); and under the new id when
  the session id changes. **[fw1]** A `/clear` is seen at its `session.end` (reason
  `clear`): from then nothing more goes to the old child, the new id is looked for every
  100 ms (up to 5 s), and once found the old child is given up to 1 s to receive what was
  already queued for it, then stopped, and a child for the new id started. The heartbeat
  (every 5 s) is the fallback for a change of id with no `session.end`. Never in a session
  with `SMNS_INTERNAL` set.

#### Routes

| Route | Built | Body | Answer |
| --- | --- | --- | --- |
| `GET /status` | M1 | — | 200 `{session, pid, protocol: 1, socket, started, subscribers, mod: {events, last}}` (`last`: epoch seconds of the mod's last post) |
| `POST /events` | M1 (the mod's) | a JSON array of events, oldest first (a single object is accepted) | 204; 400 when an item is not an object with a string `type` |
| `GET /events` | M1 | — | 200 `application/x-ndjson`, close-delimited: one snapshot line, then every event, each with `n` (below) |
| `POST /command[?wait=ms]` | M1 | `{op, ...args}` | `wait` absent or 0: 202 `{id, status: "sent"}`; `wait` 1–25000: 200 `{id, ok, result?, error?}` once the mod answered, 504 `{id, error}` on time-out; 400 for no string `op` or `op: "hello"`; 503 when the child can no longer write to the mod |
| any other | — | — | 404 `{error}` |
| `GET /requests/<request>/wait?ms=` | **reserved (M3)** | — | the mod's long-poll for a decision on a pending request (held ≤ 20 s, under the 30 s fetch bound): 200 the decision, 204 nothing yet, 410 withdrawn/settled |
| `GET /requests/<request>` | **reserved (M3)** | — | the pending request's current content for DC7's digest check: `{request, session, tool, input, agentId, deadline?}`; 404 when not pending, 410 settled (with the settlement) |
| `POST /requests/<request>/decision` | **reserved (M3)** | `{behavior: "allow"\|"deny", message?, updatedInput?, by}` (an answer is `allow` with `updatedInput: {questions, answers}`) | 200 accepted (the settlement follows on the stream); 409 already settled, naming the winner |

#### The child's stdout: lines for the mod (built)

One JSON object per line, flushed:

- First, once the socket answers:
  `{"op": "hello", "session": "<id>", "pid": <child pid>, "socket": "<path>", "protocol": 1}`.
  The mod posts nothing before it. **[fw1]** Its first post to a child is always the
  session's `start` then a `resync`; events queued while no child answered are not sent
  (the resync holds their effect on the live state).
- Then one line per command: `{"id": "<32 hex, minted by the child>", "op": "<op>", ...args}`,
  `id` first, the client's other fields as given (a client's own `id` is replaced). The mod
  answers every command with a `result` event (below) carrying the same `id`; an op it does
  not know is answered `{ok: false, error: "unknown op: <op>"}`.

| Op | Built | Arguments | Result |
| --- | --- | --- | --- |
| `ping` | M1 | — | `{pong: true, state: {mainTurn: <turnId or null>, isStreaming: <a main-loop model request streaming>, tools: [<tool names running>]}}` |
| `steer` | **reserved (M2)** | `{text}` | `{row: <uuid of the appended user row>}` (mirrored with `$.ui.log`) |
| `interrupt` | **reserved (M2)** | — | `{turnId, stopped: [<task ids TaskStop ended>]}` |
| `model` | **reserved (M2)** | `{model, effort?}` | `{model, effort}` in force; kept in `$SMINOS_HOME/bridge/<id>.json` |
| `compact` | **reserved (M2)** | `{instructions?}` | `{queued: true}` mid-turn, else the compaction's outcome |
| `deliver` | **reserved (M2)** | `{key: {writer, seq}, text}` | `{submitted: true}` or `{duplicate: true}`; the **delivery key** is the log event's `(writer, seq)`, remembered in `<id>.json` across reloads |

#### Events (the mod's posts; the stream's lines)

Every event is an object with `type` and `t` (the mod's clock, epoch ms). `agentId` is
`null` on the main loop and the subagent's id otherwise.

| `type` / `phase` | Built | Fields |
| --- | --- | --- |
| `session` / `start` | M1 | `session, cwd, surface, isInteractive, model, version` |
| `session` / `end` | M1 | `reason` (the engine's; `clear` for a /clear) — best effort, the process exits next. **[fw1]** After a `clear` end, the old child gets nothing more; the next session's events go to its own child |
| `turn` / `start` | M1 | `turnId, agentId, text` (the prompt), `truncated?` **[fw1]** |
| `turn` / `complete` | M1 | `turnId, agentId, reason` (`answer`, `aborted`, `refusal`, `error`), `usage` (the turn's, or null) |
| `step` / `start` | M1 | `turnId, agentId, step` (the request's index in the turn), `model, effort, messageCount` |
| `step` / `end` | M1 | `turnId, agentId, step, stopReason, usage` |
| `chunk` | M1 | `turnId, agentId, step, chunkIndex, chunk` — **DX4's chunk:** `chunk` is `turn.step`'s chunk object verbatim (`text`, `thinking`, `tool`, `input`, `stop`; `engine` items are not sent); the three tags are `turnId`, `agentId`, and `chunkIndex`, the chunk's index in its message from 0; a message is identified by `(turnId, agentId, step)` |
| `tool` / `call` | M1 | `toolUseId, tool, agentId, input` (the tool's own arguments), `truncated?` |
| `tool` / `result` | M1 | `toolUseId, tool, agentId, isError, denied?, text?, truncated?` |
| `agent` / `spawn` | M1 | `agentId, parentAgentId, subagentType, description, name, background, model, toolUseId` |
| `agent` / `stop` | M1 | `agentId, agentType` |
| `usage` | M1 | `context: {tokens?, window, percent?}, cost: {usd} \| null` — the engine's `$.session.usage()` context and cost as it returns them (tokens and percent absent before the first response; cost null without a ledger) — after each main turn |
| `heartbeat` | M1 | `state` (as `ping`'s) — every 5 s |
| `result` | M1 | `id, op, ok, result?, error?` — the mod's answer to a command |
| `gap` | M1 | `dropped` — events that reached no child (a failed post, an overflowing queue). **[fw1]** Always followed at once by a `resync`; a live subscriber may also resubscribe |
| `resync` | M1 **[fw1]** | `turns: [{turnId, agentId, t}], streaming: [{turnId, agentId, step, model, text, thinking, upTo}], agents: [...]` — the mod's own copy of the session's live state, whole; the child replaces its turns, streaming messages and subagents with it. Sent as the first post to every child (after the session's start) and right after every `gap`; after it, chunks follow on from each message's `upTo` |
| `command` | M1 (the child's own) | `id, op` — a command relayed to the mod |
| `raised` | **reserved (M3)** | `request` (the tool-use id), `tool, input, agentId, deadline?` (a background subagent's 3 s bound) — DX4's pending request |
| `settled` | **reserved (M3)** | `request, winner` (DX4's: the side whose answer the engine used), `outcome, by` (`cli`, `terminal`, later `web`) — exactly one per `raised` |
| `delivered` | **reserved (M2)** | `key: {writer, seq}, outcome: "submitted" \| "duplicate"` |

**[fw1]** Every string in a tool's input, at any depth, a result's text, a denial, and a
prompt is held to 65,536 characters, and the event carrying any cut says `truncated: true`. Events reach the child in the order they
happened: the mod keeps one post in flight, batches of up to 500.

#### Subscription (`GET /events`, built)

- **Line 1, the snapshot:**
  `{"type": "snapshot", "session", "protocol": 1, "pid", "sessionInfo": {...the session start, "ended"?}, "turns": [{turnId, agentId, t}], "streaming": [{turnId, agentId, step, model?, text, thinking, upTo}], "agents": [{agentId, ...the spawn's fields, agentType?, running}], "usage": <the last usage event or null>, "pending": [], "settled": []}`.
  `streaming` holds every message still streaming: its partial text and thinking and
  `upTo`, the `chunkIndex` of the last chunk they include (-1 for none). A message leaves
  it at its step's end or its turn's end. **[fw1]** A snapshot never claims an `upTo` its
  text does not cover: a chunk that does not follow its message's `upTo` (one was lost, or
  the message began before this child) takes the message out of `streaming` until the
  next `resync` puts it back whole.
  **`pending` and `settled` are reserved (M3)**: the requests pending now and the ones
  settled recently, so a subscriber that arrives after a request settled sees it settled
  (the plan's G3 fourth case).
- **Then every event** as posted, with `n` added, from 1 and one past the last.
- **No gap, no duplicate:** the child applies an event to its state and hands it to every
  subscriber under one lock, and takes a snapshot and adds the subscriber under the same
  lock (subscribe before snapshot, DX4).
- **Discontinuity:** the stream ends when the child ends or the subscriber falls 10,000
  events behind; a client subscribes again and takes a fresh snapshot. Nothing is resumed.

#### `sminos watch <member> [--json]` (built)

`<member>` is a member name as the other verbs take it, or a session id. Prints the stream:
the conversation as it streams (`[main] …`, `[<type> <agentId>] …` for a subagent), one
line per turn, tool call, failed tool, subagent start and stop, and command result; with
`--json`, the lines as the endpoint sends them. Exit: 4 when the member has no bridge on
this machine (a stale socket is removed), is unknown, holds no session, or runs on another
machine; 1 when the bridge ended and none answers again within 5 s; 0 when the session
ended or on Ctrl-C. A bridge that comes back within 5 s (a module reload) is followed:
"· the bridge restarted; reconnected", and a fresh snapshot.
**[fw2]** On a `gap`, the human view says so, subscribes again at once, and prints the fresh
snapshot, each streaming message whole, then follows on (DX4's rule on a discontinuity).
With `--json`, the `gap` and its `resync` are passed through for the reader to act on.

#### M2 extension (as reviewed clean; rows changed by its fix waves marked [fw1]/[fw2])

Every DX5 row M2 built or changed, as it should now read (rows fix waves 1 and 2 changed are also marked **[fw1]** and **[fw2]**). Rows not listed here stand as
M1 left them (with fw1/fw2). Changed rows are marked **[M2]**.

##### Parties

- **Local clients**: the CLI (`sminos watch`; `steer`, `interrupt`, `model`, `compact`;
  the log's delivery, `deliver_next` and `send`, through `push_live`) and the daemon
  (DC7). **[M2]**

##### What the child keeps (built, M2) **[M2]**

- **File:** `$SMINOS_HOME/bridge/<session-id>.json`, mode 0600, written whole
  (temporary name, then rename) whenever it changes:
  `{"override": {"model": <id or null>, "effort": <effort or null>} | null, "delivered": {"<writer>": <seq>}}`.
- **Written from the mod's events:** `model` (sets `override`; null when both are null),
  `delivered` with outcome `submitted` (raises the writer's seq), `resync` (replaces
  `override` and `delivered` with the mod's copy).
- **[fw1] A failed write is not taken as kept.** The child holds the mod's copy in memory and
  writes it whole whenever it differs from what the file holds; what the file holds moves
  only after a write succeeds. **[fw2]** The write is made at the end of every batch of the
  mod's events (`POST /events`), whatever the batch carries, so a failed write is retried by
  any later event — a duplicate `delivered`, a heartbeat — not only by one that changes what
  is kept. Writing that starts to fail is said once as the child's own `kept {ok: false}`
  event, and writing that works again as `kept {ok: true}` (below).
- **Lifetime:** outlives the child (a module reload) and the session's process (a session
  resumed under its id goes on with both). Discovery (DC7) lists `*.sock` only.

##### The child's stdout: lines for the mod

- First, once the socket answers:
  `{"op": "hello", "session": "<id>", "pid": <child pid>, "socket": "<path>", "protocol": 1, "kept": {"override": …, "delivered": {…}}}`
  **[M2]** `kept` is what the child keeps for the session (above). A module that holds no
  kept state yet (fresh, after a reload) takes it; one that already holds its own (a child
  restarted, a /clear) keeps its own and hands it to the child in the resync. The mod's
  first post is still the session's `start` then a `resync` (fw1).

| Op | Built | Arguments | Result |
| --- | --- | --- | --- |
| `steer` | M2 **[M2]** **[fw1]** | `{text}` | `{row: <uuid of the appended user row>}`. During the main turn: `$.session.append` of a user row (one text block), read at the main loop's next model request; the running tool goes on; mirrored as the transcript line `steer: <text>` (`$.ui.log`). **[2026-10-18, doperpowers #240, 7.180.0]** The block is the line `[sminos steer from human]`, then `\n` and the text verbatim (`STEER_LINE`): the row names itself a steer, so the desk knows it positively, and no text reads as one of the bridge's other rows; the marker and note refusals #225 and DC10 added are dropped. Refused idle (`ok: false`, "no turn is running to steer: send it instead"). **[fw1]** The steer is bound to the main turn it was given in before the append is awaited. When that turn ends with `answer` and no main-loop request of it began after the row was in (or the turn ended while the append was pending, and the row then lands), the bridge submits **one wake prompt** (`asUser`) that does not repeat the steer. **[fw2]** The wake is owned by the originating turn: it is decided once the turn has ended *and* every append given in it has settled (in, refused, or failed), and is issued at most once per turn: "I added a note to the conversation while you were finishing your answer. Read it and act on it." (`STEER_WAKE`); the next request reads the row. A turn ending `aborted`/`error`/`refusal` wakes nothing. One wake per turn, however many steers |
| `interrupt` | M2 **[M2]** **[fw1]** | — | `{turnId, stopped: [<task ids>], running: [<task ids>]}`: `$.turn.abort` on the main turn, then `TaskStop` (`$.tool.call`) on each Bash call **attributable to that turn** and running at the abort whose result names the background task the abort moved it to (`running in background with ID: <id>`; their results awaited at most 3 s). **[fw1]** Attributable: a main-loop call made during that turn, or a call of a foreground subagent spawned in it (nested foreground subagents inherit their parent's turn); a background subagent's calls never are. **[fw1]** `running` names each task whose TaskStop failed (an `isError` result or a rejection): the interrupt is incomplete when it is not empty. Idle: `{turnId: null, stopped: [], running: []}` |
| `model` | M2 **[M2]** | `{model, effort?}` — `model` an id, a family alias, `"default"` or null; `effort` one of `low medium high xhigh max`, or null | `{model, effort}` now in force (null: the session's own). Rewritten on every **main-loop** `turn.step` request, subagents untouched; never `$.config.set`. A family alias (`haiku`, `sonnet`, `opus`, `fable`) is resolved through the session's `ANTHROPIC_DEFAULT_<FAMILY>_MODEL`; one it does not map is refused, naming the id to use. Emits `model`; kept by the child |
| `compact` | M2 **[M2]** | `{instructions?}` | During the main turn `{queued: true, turnId}`: held, and run inside that turn's `turn.complete` (a second while one is held keeps the first). Idle `{started: true}`: run at once. Either way the outcome follows on the stream as `compact` events carrying this command's `id` |
| `deliver` | M2 **[M2]** **[fw1]** | `{key: {writer, seq}, text}` | `{submitted: true}` or `{duplicate: true}`. `text` is submitted with `$.prompt.submit({text, asUser: true})` (queued until the session is idle; not awaited). **The delivery key** is the log event's `(writer, seq)` — for a push carrying several events of one writer, the last. A key whose seq is at or below the highest already submitted for its writer is a duplicate and dropped (delivery goes per writer in seq order). The per-writer seqs are kept by the child across reloads; a /clear starts them anew (a new id is a new recipient). **[fw1]** The `delivered` event is emitted before the submission is made, so it is the next thing posted. Deduplication across a module reload is **best effort when the reload lands mid-submission**: a key submitted whose `delivered` had not reached the child is not kept, and a redelivery of it may submit again (a residual of at-least-once delivery, §3) |

##### Events (the mod's posts; the stream's lines)

| `type` / `phase` | Built | Fields |
| --- | --- | --- |
| `step` / `start` | M1, **[M2]** | `turnId, agentId, step, model, effort, messageCount` — **[M2]** `model` and `effort` are what the request was sent with, after the bridge's rewrite |
| `resync` | M1 **[fw1]**, **[M2]** | `turns, streaming, agents` (fw1) **and `override, delivered`** — what the child keeps, which it replaces with these |
| `model` | M2 **[M2]** | `model, effort` — the choice now in force (null: the session's own) |
| `compact` / `start` | M2 **[M2]** | `id` — the `compact` command's id |
| `compact` / `end` | M2 **[M2]** | `id`, and one of: `tokensBefore, tokensAfter` (null when the engine recorded none); `skip` (a hook vetoed it); `error` (the engine refused it, as during a turn) |
| `delivered` | M2 **[M2]** (was reserved) | `key: {writer, seq}, outcome: "submitted" \| "duplicate" \| "refused"`, `reason?` — `refused` follows a `submitted` when the engine later dropped or rejected the prompt |
| `kept` | M2 **[fw1]** **[fw2]** (the child's own) | `ok: false, error` when writing `<id>.json` starts to fail (said once, however many batches it keeps failing; retried at the end of every batch); `ok: true` when a write works again after a failure |

##### Subscription (`GET /events`)

- **Line 1, the snapshot** gains **`"override": {model, effort} | null`** **[M2]**: the
  session's model choice made through the bridge (the session start's `model` stays the
  launch model).

##### The control verbs (built, M2) **[M2]**

`<member>` resolves as for `watch` (a name, `alias#short`, a seat, or a session id; exit 4
for unknown, seatless, or another machine's).

| Verb | Bridged | No bridge | Exit |
| --- | --- | --- | --- |
| `sminos steer <member> <text>` | op `steer` | live `--bg` job: the supervisor's `reply` (raw text, human origin, `nextTurn`); else a live session: inbox frame `[sminos steer from human]\n<text>`; not live: exit 4 | 0; 1 refused (idle) or no answer |
| `sminos interrupt <member>` | op `interrupt`; prints the stopped tasks, or "idle: nothing to interrupt". **[fw1]** A non-empty `running` is printed as "incomplete: background task(s) … still running (TaskStop failed)" and exits 1 | refused, exit 4 "no bridge" | 0; 1 |
| `sminos model <member> <model\|default> [--effort E]` | op `model` | refused, exit 4 | 0; 1; 2 bad effort |
| `sminos compact <member> [instructions]` | subscribes, then op `compact`; queued: says so and exits; started: waits (≤ 300 s from the command, **[fw1]** a monotonic deadline, not reset by other events) for its `compact` end and prints the counts | refused, exit 4 | 0; 1 error or no outcome |

##### Delivery's last hop (`push_live`, built, M2) **[M2]**

For a live recipient, `deliver_next` (through `push_member`) and `send` (through
`send_to_seat` / `send_to_member`) push the frame text the inbox would carry, in this
order:

1. **The bridge**, when the push carries a log event: op `deliver` keyed by the last event
   (wait 10 s). Answered `ok` (submitted or duplicate): delivered (`sent`). No bridge
   answering: next path. Refused (nothing submitted): a warning, next path. Taken and not
   answered: uncertain (`sent?`, settled, never pushed again).
2. **The engine supervisor**, for a `human` event to a live `--bg` job (the engine record's
   `kind: "bg"` and 8-hex `jobId`): `{"proto": 1, "op": "reply", "short", "text", "auth":
   <~/.claude/daemon/control.key>, "nextTurn": true}` on
   `/tmp/cc-daemon-<uid>/<sha256(abspath(~/.claude))[:8]>/control.sock`. `ok`: delivered;
   refused or unreachable: next path; written and unanswered: uncertain.
3. **The inbox frame**, as before.

A push with no log event (a seat outside any project, the raw session-name route) goes
straight to the inbox frame.

##### Reserved for M3 (unchanged)

The `/requests/…` routes, the `raised` and `settled` events, and the snapshot's `pending`
and `settled` stand as M1 reserved them.

#### M3 extension (as reviewed clean; rows changed by its fix waves marked [fw1]/[fw2])

Every DX5 row M3 built or changed, as it should now read. Rows not listed stand as M1
and M2 left them. Changed rows are marked **[M3]**; rows fix wave 1 changed are also marked **[fw1]**.

##### Parties

- **Local clients**: the CLI (`watch`; `steer`, `interrupt`, `model`, `compact`;
  **`decide`, `answer`**; the log's delivery) and the daemon (DC7). **[M3]**

##### Routes

| Route | Built | Body | Answer |
| --- | --- | --- | --- |
| `GET /requests` | M3 **[M3]** | — | 200 `{pending: [<raised>…], settled: [<settlement>…]}` (the snapshot's two lists) |
| `GET /requests/<request>` | M3 **[M3]** | — | 200 the pending request's `raised` fields plus `session` (DC7's digest check); 404 `{error}` when not pending; 410 `{error: "settled", settled}` once settled |
| `GET /requests/<request>/wait?ms=` | M3 **[M3]** **[fw1]** (the mod's) | — | Held up to `min(ms, 20000)`. 200 `{decision: {behavior, message?, updatedInput?}, by}`: a client's decision, handed out once. 410 `{reason: "terminal"}`: the terminal answered it (the session record left `waiting`); this only ends the poll and closes the request to new decisions, and settles nothing. 410 `{reason: "settled", settled}`: settled. 204: nothing yet (an unknown request is held too, since its `raised` may still be in flight). **[fw1]** `watch=1` is gone: once its hook stops polling, nothing watches a request; the engine's record settles it |
| `POST /requests/<request>/decision` | M3 **[M3]** | `{behavior: "allow"\|"deny", message?, updatedInput?: {answers: {<question>: <answer>}}, by}`. `by` is `cli` or a member id (`terminal` and `bridge` are reserved). `updatedInput` only for a question, whose allow requires `answers` keyed by its questions. An async question cannot be denied | 200 `{accepted: true, request}`: the settlement follows on the stream. 400 `{error}`: malformed or not allowed. 404: not pending. 409 `{error: "already settled", settled}`. 409 `{error: "already answered by <by>; …", by}` (`by` added after DC2's close, below). 409 `{error: "the window … closed; the terminal answers it", terminalOnly: true}`: past a background deadline minus 200 ms. 409 `{error: "the terminal answered it; …", winner: "terminal", by: "terminal"}` (likewise). For an async question, the child relays it as op `answer` (wait 5 s); the mod's refusal is a 409 carrying its error |

##### The child's stdout: lines for the mod

| Op | Built | Arguments | Result |
| --- | --- | --- | --- |
| `answer` | M3 **[M3]** | `{request, answers: {<question>: <answer>}, by}`: an async question's answer, relayed from `POST …/decision` | `{answered: true}` once the ask mod took it, which delivers it as tool-result context or as a plugin prompt when the session is idle; `ok: false` with the ask mod's reason otherwise (not pending, already answered, its dialog is up, not serving) |

##### Events

| `type` / `phase` | Built | Fields |
| --- | --- | --- |
| `raised` | M3 **[M3]** (was reserved) | `request` (the call's tool-use id; `toolu_plugin_…` for the ask mod's dialog; `request-<base36>-<n>` for a call no check named), `tool`, `input` (strings capped, fw1), `agentId`, `deadline?` (epoch ms, only for a background subagent: raise + 3000), `async?: true` (an ask mod async question, tool `mcp__doperpowers__AskUserQuestion`), `truncated?`, **`toolUseId?`** (added after DC2's close, by DC7: the outer `mcp__doperpowers__AskUserQuestion` call's tool-use id when `request` is the ask mod's dialog, whose own `tool/call` and `tool/result` are not posted either, since no transcript row holds them). DX4's pending request. Raised only when the settings hooks beneath did not decide. A person-only prompt raises nothing |
| `settled` | M3 **[M3]** (was reserved), **[fw1]** | `request, winner, outcome, by`. `outcome` ∈ `allow \| deny \| answered \| withdrawn`. `winner` ∈ `terminal \| other \| web`. `by` is `terminal` when the terminal's answer was used, `cli` when the CLI's was (winner `other`), the member id when the web's was (winner `web`), and `bridge` for `withdrawn` (winner `other`). A passed deadline settles nothing: the request stays pending, answerable only in the terminal, until the terminal's answer settles it as `terminal` with its real outcome. Exactly one per `raised`. **[fw1] Evidence, all tied to the call's own id:** (1) the engine's `tool_decision` record for the call, which arrives at decision time: source `hook` with the bridge's handed-out decision of the same behavior means the decider; `user_temporary`, `user_permanent` or `user_reject` means the terminal, with the record's real outcome (accept is `allow`/`answered`, reject is `deny`); anything else (`user_abort`, `config`, a hook's decision the bridge did not hand out) means `withdrawn` by `bridge`. A request the bridge's interrupt aborted is `withdrawn` whatever the record says. (2) With no record within 1 s of a real call's result row, the call's transcript (its subagent's own for a subagent) once the result row is in it: a `hook_permission_decision` mark carrying the call's `toolUseID` means the hook's answer was used (then as (1) with source `hook`); none means the terminal's, with the outcome the result shows. (3) Neither available (the ask mod's dialog keeps no rows; the transcript unreadable or the result never written within about 2 s): `withdrawn` by `bridge`. A turn's end and the session's end withdraw as before. An async question answered through a dialog a press opened settles with that dialog's request: `answered` by its `by` (or `withdrawn` when the dialog's was) |
| `block-row` | M3 **[M3]** | `uuid, turnId, agentId, step, index`: the transcript row `uuid` holds block `index` of that message. Posted from `session.append` for each response row, paired by the row's block type and the order of the step's block starts (a tool row by its call id), never by position. The child removes the block from `streaming` under the lock; later chunks of that block are ignored. A row whose block never streamed (a server tool) names none |
| `chunk` | M1, **[M3]** | Unchanged on the wire. The child now folds each chunk into its **block** (`chunk.index`) |
| `resync` | M1 fw1, M2, **[M3]**, **[fw1]** | `turns, streaming` (per block, as the snapshot's, **[fw1]** each entry also carrying `settled: [<index>…]`, the blocks a `block-row` settled), `agents, override, delivered`, **`pending`** (each `raised`'s fields with `t`), **`settled`** (recent settlements). The child replaces its pending set with `pending` (keeping a request's decided/closed state) and merges `settled` with its own. **[fw1]** The child keeps an entry's `settled` blocks out of the message and ignores their late chunks, and a block it saw settled itself stays settled across the resync, even when the copy does not name it (the snapshot's `streaming` entry shape is unchanged: `settled` is never shown). **[DC8]** **`refused`**: `[{key, reason}]`, each delivery refusal the mod holds until the child has answered a post that carried it; the child records each key once, as it would the `delivered {outcome: "refused"}` event, so a refusal whose post failed still becomes the `failed` outcome (the panel, 2026-10-17). A `/clear` forgets them as it forgets `delivered` |

**The mod's evidence [fw1].** The mod hooks `telemetry.log` (`{to: "collector"}`) and
reads the engine's `tool_decision` records: `attributes.tool_use_id`, `source`, `decision`.
The engine raises them to plugins whether or not an OTel collector is configured. This
was confirmed live on 2.1.300, including with `DISABLE_TELEMETRY=1` and
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` both set, so no machine yet known runs the
transcript fallback. Should a release stop raising them, the fallback (2) above runs for
real calls, and the ask mod's dialogs settle `withdrawn` (3). DC7 and the web will see
that difference. The live check pins the records.

**Posting [M3].** The mod's posts all begin in one poster loop started at
`session.start`. Events emitted inside any hook are queued and the loop is woken. A post
begun inside another hook's dispatch would be aborted with it (an Esc, an interrupt).
Order, batching (≤ 500) and one post in flight are unchanged.

##### Subscription (`GET /events`)

- **Line 1, the snapshot** **[M3]**:
  - `"streaming": [{turnId, agentId, step, model?, upTo, blocks: [{index, kind, text, upTo, id?, name?}]}]`.
    One entry per message still streaming. `blocks` are its blocks with no
    `block-row` yet, in index order.
    - `kind` is `text`, `thinking` or `tool`.
    - `text` is the block's partial text (for a tool, its streamed argument JSON;
      `id` and `name` are the call's).
    - A block's `upTo` is the last chunk folded into it.
    - The message's `upTo` is the last chunk of the message applied, and is the fw1
      continuity check: a chunk that does not follow it takes the message out until
      the next `resync`.
  - `"pending": [<raised fields>…]`: the requests pending now.
  - `"settled": [{request, winner, outcome, by, t}…]`: the last 100 settlements, so a
    subscriber that arrives after a request settled sees it settled (G3's fourth case),
    and a late answer is refused as already settled.
- `sminos watch` prints a raised request as `· [<loop>] permission: <tool> <summary> — request <id>`
  (or `question: …` with its options, `async question: …`, and ", answerable from outside
  until HH:MM:SS" for a window), its settlement as `· request <id> settled: <outcome> (<by>)`, and the
  snapshot's pending requests and per-block text.

##### The verbs (built, M3) **[M3]**

| Verb | Bridged | No bridge | Exit |
| --- | --- | --- | --- |
| `sminos decide <member> <request> allow\|deny [--message M]` | Subscribes and finds the request in the snapshot (by exact id or a unique prefix). Then `POST …/decision` `{behavior, message?, by: "cli"}`, then waits up to 30 s for its `settled`. Prints "<member>: request <id> settled from here: <outcome>" | exit 4 "no bridge" | 0 the engine used this answer; 1 already settled (snapshot or 409), not pending, window closed, terminal answered, another side's answer used (naming it), or no settlement; 2 a 400 |
| `sminos answer <member> <request> <answer>…` | As `decide`, with `allow` and `updatedInput.answers`: one answer per question, in order. An answer is an option's number or label (any case), a multi-select's labels comma-separated, or free text | exit 4 | as `decide`; 2 also for a count that does not match the questions, or a request that asks no question |

#### M4 extension (as reviewed clean after fix waves 1–2)

Every DX5 row M4 built or changed, as it should now read (fix wave 1 included). Rows not
listed stand as M1–M3 left them. Changed rows are marked **[M4]**.

##### The child's hello [M4]

`{"op": "hello", session, pid, socket, protocol: 1, kept, nonce, seed}`:

- **`nonce`** **[M4, fix wave 1]**: minted by this child, said only in its hello. Every
  `POST /events` carries it as `X-Bridge-Nonce`; a post without it, or with another, gets
  409 and changes nothing (no cut, override, delivered, readiness or subscription moves).
  A mod whose post gets 409 under the nonce it still holds stops for good: it posts nothing
  more, its heartbeat stops, its child is stopped and never respawned. (A module reload's
  old instance is fenced off this way. A 409 under an older nonce, from the module's own
  child restarting, is only a lost post.)
- **`seed`** **[M4, fix wave 1]**: `{"main": <uuid>, "<agentId>": <uuid>, …}`, each loop's
  last whole row in the session's transcripts (under `CLAUDE_CONFIG_DIR`, or
  `~/.claude`: `projects/*/<session>.jsonl` and `<session>/subagents/agent-<id>.jsonl`)
  as the child read them, read backward from the end, a half-written last line passed
  over. A loop with no row is left out. Read just before the hello is written.

##### Routes

| Route | Built | Body | Answer |
| --- | --- | --- | --- |
| `GET /status` | M1, **[M4]** | — | 200 `{session, pid, protocol: 1, socket, started, ready, subscribers, mod: {events, last}}`. **[M4]** `ready`: the mod's first `resync` to this child has been applied |
| `POST /events` | M1, **[M4]** | the mod's events, with `X-Bridge-Nonce: <the hello's nonce>` | 204; **[M4]** 409 `{error}` without the nonce (the post is another module instance's) |
| `GET /events` | M1, **[M4]** | — | **[M4]** Held until `ready`, at most 5 s (`SMINOS_BRIDGE_READY_WAIT`), else 503 `{error}`. Then 200 `application/x-ndjson`: the snapshot line, then every event with `n`. **[M4]** The stream ends (the connection closes) when the child applies any resync after its first, or when the subscriber falls 10,000 behind. That is the one discontinuity: a subscriber never sees a `resync` line, and subscribes again for a fresh snapshot |

##### Events (the mod's posts)

| `type` | Built | Fields |
| --- | --- | --- |
| `block-row` | M3, **[M4]** | `uuid, turnId, agentId, step, index` — **[M4]** also the response row's **notice**: emitted in the `session.append` hook once the append resolves (the row is written), so notice order is write order within a loop. The child moves the loop's cut to `uuid` in the same step that settles the block |
| `row-seen` | **[M4]** | `uuid, agentId, door` — the notice of every other row the session keeps, once its append resolves: <ul><li>any door but `response` and `queue`;</li><li>a response row whose block never streamed, the rows of an excluded request (the seed, below) included: nothing of theirs ever streamed;</li><li>door `note` (a plugin's own append) only once kept, never when refused;</li><li>the bridge's own steer row from the append's returned uuid (door `note`), after it is written.</li></ul> None for door `queue`, and none for a `hook_success` with no text (raised but never written by 2.1.300). **[#78]** A manual compaction's rows (the person's `/compact`, a command run, any plugin's `$.session.compact`, the bridge's own included) pass no `session.append` hook, so once the compaction stands the mod holds its poster, reads the loop's rows past its cut from the child (`GET /rows`) until the summary row is on disk, and names each unnamed one `row-seen` with `door: "compaction"`, in disk order, ahead of anything later of its loop. An automatic compaction's rows pass the hook and are named as they are written. The engine's reload line passes `session.append` (door `notice`) and is named by the new module |
| `step` (`phase: "end"`) | M1, **[M4, fix wave 1]** | unchanged fields. **Ordered after every `block-row` of its step**: the engine can append a response row after the request's result (it withholds a refusal or max-output row until the stream is done, and closes a block the stream left open), so the mod holds the end until each block that streamed has its row named, at most 1 s (`STEP_END_WAIT_MS`), and posts it before anything later of its loop (the next request, the turn's end, the subagent's stop). **[fix wave 2]** Once a step's end is out, whichever released it, the step's pairing is closed: a row of it that comes later is named by `row-seen`, never a `block-row` after its step's end. DX4's `step-end` relies on this order. **The child removes the step's whole message from `streaming` at its end, under the lock that applies events (as M1 said; M3's per-block settling did not change it), whether or not a `block-row` came for each block**, so a block aborted mid-response is in no later snapshot; a turn's `complete` removes its messages too |
| `turn` (`phase: "start"`) | M1, **[final-review wave]** | may carry **`recovered: true`** with `text: null`: a main turn the module saw no `turn.start` of (it was reloaded while the turn ran), taken from the turn's next main-loop request (`turn.step`'s `turnId`, the id `turn.complete` and `$.turn.abort` use). The turn's own `complete` follows as usual |
| `export` | **[M4]** | `records: [{type: "assistant"\|"user", uuid, message: {content}}]` — main-loop rows as the transcript keeps them: <ul><li>a text row that may hold a mark (its text blocks; not sent past 65,536 characters);</li><li>an async ask's call row with its result row.</li></ul> **Consumed by the child, never handed to subscribers.** The child appends their host events to the project's log with `sminos.export_live`: the Stop hook's writer, `host_events` and `(kind, src)` dedup (`message`: `<row uuid>#<span index>`; `question`: the call id). Membership on sight; one export at a time, in order, off the stream's lock |
| `resync` | M1–M3, **[M4]** | gains **`cut`**: `{"main": <uuid>\|null, "<agentId>": <uuid>, …}`, each loop's last notice, seeded as below. `null` (or a loop it does not name): this loop had no rows before the module loaded, and none noticed since. The child replaces its cut with it. A loop it does not name is gone. **[final-review wave]** also gains **`sessionInfo`** `{session, cwd, surface, isInteractive, model, version}`, what the session started as: the child takes it as its `sessionInfo` (an `ended` it already had stays), so a child whose `session` start was lost with the first post still has the export's `cwd` |

##### Subscription (`GET /events`)

- **[M4, fix wave 2] No snapshot before the seeded resync.**
  - Every child serves no snapshot until the mod's first `resync` to it has been applied:
    on a first start, after a module reload, and for a replacement child (one that ended
    and was respawned, or one for a new id after `/clear`). Only a `resync` makes a child
    ready (`_apply`, then `ready = True`). Other posts, the `session` start included, do
    not. A post refused by the fence (409) is never applied.
  - Meanwhile `GET /events` is held with no response line at all, for at most 5 s
    (`SMINOS_BRIDGE_READY_WAIT`), then answered 503 `{"error": "the session's state has
    not reached its bridge yet"}`. `GET /status` answers `ready: false`. `sminos watch` retries a
    503 within its reconnect window; **[final-review wave]** `decide`, `answer` and
    `compact` retry it (every 0.1 s after each 5 s hold) until their first snapshot's
    8 s window runs out.
  - That first resync always carries every loop's cut. At a module's first hello the mod
    adopts the hello's `seed` before it queues `[session start, resync]`. A replacement
    child gets the module's current cut (seeded at the first hello, moved by notices since).
    After `/clear` the cut is cleared, so each loop is `null`: the new id had no rows.
  - The wait runs from the child's spawn to its hello (the Python start, then the tail
    read), then to the mod's first post (one post in flight, so it can wait behind a post
    to the path that is failing or refused). Pinned by bridge_order.py `readiness`: the
    request is held, then opens with a snapshot whose `cut` is the resync's; with a 1 s
    wait it gets 503. Also pinned by the mod's "the first hello's seed is each loop's
    cut".

- **Line 1, the snapshot** gains **`"cut": {"main": <uuid>|null, "<agentId>": <uuid>, …}`**
  **[M4]**. It is each loop's last notice applied, taken under the lock that applies events
  and guards `streaming`. Every row at or before a loop's cut has had its notice applied,
  so no block in `streaming` has its row at or before the cut.

##### The seed rule [M4, fix wave 1] (for DC7)

Each loop's cut is seeded at load, so `null` means only "this loop had no rows before the
module loaded":

- A loop that **pre-dates the module** — after a **module reload**, in a **resumed
  session**, or a **subagent already running at load** — holds rows no notice of this
  module named. Its first cut is its transcript tail, the hello's `seed` (unless the mod
  noticed a row of it before the hello: the notice wins, and the loop's rows past the seed
  are each noticed in turn).
- In such a loop, a model request whose step began before the mod read the hello (the
  hello is written after the tail read returns, so this is stricter than the read's
  completion) **never enters `streaming`**: its chunks reach no subscriber, as for a
  message that began before the child. It surfaces only through its rows, at or before
  the seed in history, or past the cut and released live. Its rows are named by
  `row-seen`, never `block-row`, since nothing of theirs streamed. Accepted cost: no
  partial text for a message streaming at a module load.
- A loop the mod **saw from its first row** takes no seed and holds nothing back: the main
  loop of a session the module started with (no message in `$.session.messages()` at
  `session.start`), and a subagent whose `agent.spawn` the mod saw. Its cut is its notices
  alone, so a fresh `--bg` job or seat streams its first reply.
- Invariant: no block of a loop enters `streaming` before that loop's cut is seeded, and
  no block in `streaming` has its row at or before the cut.

##### The consumer rule [M4] (DX5's, for DC7)

As the plan's Decision Log states it (M4 review, agreed with the composite's writer), with
fix wave 2's precision that the 2 s run from when each row was first seen on disk (so rows
written together come out together, not 2 s apart):

> History waits until each loop's cut row is on disk (5 s, else a discontinuity) and reads
> up to and including it; live, disk rows are emitted strictly in disk order, a row past
> the cut released on whichever comes first — its own notice, a notice for any later row
> of the same loop (a row passed over is unnamed), or 2 s after it was first seen on disk
> with neither — and every later row waits behind it. A notice whose row is not on disk within 5 s, and a `block-row` for
> a uuid already released unnamed, end the subscription; a `row-seen` for an already
> released uuid is ignored.

**Notice order is the engine's append order, not strictly disk order.** The engine's disk
writer can put a row ahead of its own parentUuid chain within one batch (2.1.300, observed
in a first prompt's attachments: `agent_listing_delta` written before the `environment` and
`model` rows it follows in the chain). The hook's `session.append` resolves before the
write, which the REPL does not await. The rule absorbs it: the passed-over row is
released unnamed, and its late `row-seen` is ignored.

**The guarantee DC7 relies on:** a response row's `block-row` is never preceded by a
notice for a row written after it on disk. The engine writes response rows one at a time
while the request streams, each append awaited. The live walk fails on any such break,
and reports `row-seen` breaks by kind and count.

**Step end after its block-rows:** a step's `block-row`s are posted before its `step`
end (the events table above). The hold is at most 1 s, and is released early by the
loop's next request, the turn's end, or the subagent's stop. A response row follows the
request's result in three engine cases (2.1.300): a refusal or max-output row the loop
withholds until the stream is done; the `turn.step` tail closing a block a hook left open
(no `stop` chunk); and a hook answering without a request (its rows released after the
chain ends).

With the seed: a loop whose cut is `null`, or that the cut does not name, has an empty
history (it had no rows before the module loaded), and all its rows are live. A row is a
transcript line carrying a `uuid`. The stream ending is the other discontinuity: the reader
subscribes again and starts over from the fresh snapshot.

Known rows with no notice, released unnamed (on the next notice of their loop, or 2 s when
last on disk), since doperpowers #202 (7.158.3) only the compactions the mod cannot place: one
whose summary row is not on disk within 1.5 s, one before the module's first hello, one whose
cut lies more than 4 MiB back, one whose result carries no row handles (a hook answered it
with messages of its own), and the person's `/compact` where an organization manages Claude
Code (the engine runs no `session.compact` hook of a person-installed plugin there).

`tests/sminos/bridge_order.py` (`Consumer`) is the reference implementation, run against
the real child.

##### `sminos watch` and the verbs [M4]

- `watch` follows a stream that ended while the endpoint still answers:
  - the same child: "· the session's state was sent again; resubscribed";
  - another child: "· the bridge restarted; reconnected";
  - `--json` gets the fresh snapshot line.
  - A 503 (not ready) is retried within the reconnect window.
- `decide`, `answer` and `compact` follow the same child across an ended stream, and read a
  settlement that fell in between from the fresh snapshot's `settled`. Their first-snapshot
  wait is 8 s.

##### Endpoint [M4]

The stale rule reads: a socket file refused 3 times, 0.1 s apart, is stale (a listener with
a full backlog refuses too). The child's listen backlog is 128.

#### Final-review wave 2 (unknown turn state after a load; supersedes rows above where they differ)

- **The child's hello** gains `presence`: the session's engine record
  (`<config>/sessions/<pid>.json`).
- **Commands `steer`, `interrupt`, `compact`** gain the refusal `{ok: false, error: "turn
  state unknown since the bridge reloaded; retry after the next model request"}`. It is
  given while the mod cannot know whether a main turn runs (after a load into an existing
  conversation, until a main turn starts, completes or is recovered from its next
  request, or the session record says idle).
- **`ping`'s and `heartbeat`'s `state`** gain `isTurnUnknown: true` while unknown (absent
  otherwise).
- **Verbs:** `sminos interrupt|steer|compact` exit 1 with that reason. Before this wave,
  interrupt said "idle: nothing to interrupt" with exit 0, compact ran at once, and steer
  was refused as idle.

#### For DC8 [2026-10-17] (owner DC8; §9, the review's findings 1 and 3)

- **`resync.agents` and the `agent` events** cover agents the module did not see spawn:
  at load the mod seeds its agent state from `$.agent.list()` (`id`, `description`,
  `type`, `status`, `parentId`) and refreshes it while any agent runs, as
  `hooks/mods/agents.tsx` does, emitting `agent` spawn and stop for what it learns; the
  child's `agents` carries them with `running`. DC8 forwards that state in DX4's widened
  `subagents`.
- **`delivered`** gains the outcome the daemon needs: a `refused` (the engine dropped the
  submitted prompt, `PromptSubmitResult.drop`) after a `submitted` is kept by the child
  with its key and reason, and reported to the daemon, which records a second DX4
  `delivery` for the key, `failed` with that reason (the child keeps `submitted` keys
  alone today). `delivered {outcome: "entered", uuid}`, the row the submitted prompt
  became, stays optional (DC8.G6).
- **As built at DC8's M3 [2026-10-17]:** a seeded agent still running is `agent` spawn
  `{agentId, parentAgentId, subagentType, description, name?}` (`name` when the engine's
  list gives one: `AgentInfo.name?`, 2.1.300); one already over at load is a spawn then a
  stop. The list's `completed`, `failed`, `killed` are over; `pending`, `running`,
  `waiting`, `idle` are running; an agent that leaves the list is over. The list refreshes
  every 500 ms while any agent runs, at each heartbeat, and when an unknown loop starts a
  turn. The child keeps the last 100 refusals in its `<id>.json` as `refused`, each reason
  capped at 1,000 characters; the daemon's `deliver_owed`, under the session's delivery
  lock and for settled events only, records the second `delivery` once per key (ledger
  `refused/<session>.json`): `failed`, "the session dropped it after taking it, so it
  never entered the conversation: <the bridge's reason>" — after a `delivered` or an
  `uncertain` alike, since the text never entered. `delivered {outcome: "entered",
  uuid}` is emitted when a main-loop prompt row this plugin submitted as the human's words
  has a first text block equal to exactly one waiting delivery's text, nothing when
  ambiguous or rewritten; it stays on the bridge's stream (§9.7).

### DX6 — RPC shapes (owner DC3; G1; the hub's record built at M3)

2026-10-22: extended by the desk control surface (`docs/doperpowers/specs/2026-10-22-desk-control-surface-design.md`, its Interfaces' DX6): the RPC
`command {session, name, args?}`, answered at once `{queued, route, id}`, its outcome an `op` on the stream
under the RPC's nonce.

```ts
type Rpc<N> = {
  rpc: N;               // the name
  project: string;      // the .smns id; also the code's project
  machine: string;      // the enrolled name that executes it
  member: string;       // the member who issued it
  created: string;      // ISO time; older than 60 s → not forwarded, refused by the daemon
  nonce: string;        // 128 bits base64url: the RPC's id
  args: RpcArgs[N];
  mac: string;          // HMAC (DX1, domain smns-hub-rpc-v1) over the RPC without `mac`
};
```

| `rpc` | `args` | result (`done`) |
| --- | --- | --- |
| `steer` | `{session, text}` | `{row}` — the uuid of the appended user row, or null when the session has no bridge (the steer went as a `--bg` seat's `reply` or as a send, §5, which append no row the machine can name); refused `idle` when no turn is running |
| `interrupt` | `{session}` | `{turnId, stopped, running}` — the aborted turn (null when idle), the background tasks stopped, and those whose stop failed; a non-empty `running` is an incomplete interrupt, drawn as such |
| `answer` | `{session, digest, answers}` — `answers` maps each question's text to the chosen label (several joined by `", "`) | `{}` |
| `decide` | `{session, digest, decision: "allow" \| "deny", message?}` | `{}` |
| `model` | `{session, model?, effort?}` (at least one) — `model` an id, a family alias the session maps, or `"default"` (§5) | `{model, effort}` now in force, null for the session's own |
| `compact` | `{session}` | `{at: "now" \| "turn-end"}` — answered at once; the compaction's outcome follows as the session's `compact` events (DX5), carried on the session plane by DC7 |
| `spawn` | `{checkout, worktree?, brief, model?, effort?, permission_mode?}` | `{session, alias}`; the log's record of the spawn carries the RPC's `member` as `by` |
| `retire` | `{session}` | `{}`; the log's `retired` carries the RPC's `member` as `by` (acceptance 7), never sminos's operator `""` |
| `resume` | `{session}` | `{session}` — the same id |
| `stop` **[DC10, 2026-10-18]** | `{session, taskId}` — a background shell's or monitor's task id, `[A-Za-z0-9_-]{1,64}` | `{taskId}`; refused `unsupported` without a bridge, `unknown-task` when the session's jobs index does not hold the task as running (checked before the claim), `failed` with the engine's message when `TaskStop` errs. The job's `stopped` arrives on the session's DX4 body, not in the result |

`digest` is `{session, request, tool, input_sha256}` (DX1), `request` as the `raised` named it, opaque; `input_sha256` is
over the `raised`'s `input` as sent, the capped input when it is `truncated`. An outcome is
`{state: "done", result}` or `{state: "failed", error: {code, message, winner?, by?, terminalOnly?}}` (desk-hub's
`RpcError`): a refused `decide` or `answer` carries `winner` and `by` as DX4's `settled` names them, or `by` alone when
the bridge knows who answered first but not yet how it settles, and `terminalOnly: true` when the window closed.
They come only from the bridge's own record: its 409s, or the `settled` record its pending snapshot reports when the
daemon's digest check finds the request already settled (the common case). The hub's record of an RPC adds `forwarded`
(written to the machine's stream, no result yet) and `uncertain` (the machine's lease lapsed, or its stream closed,
after forwarding and before a result).

**The hub's record** (built at M3; DX3 says what the browser sees). The hub checks an RPC's shape (at most 1 MiB as
canonical JSON, as a DX1 event is, else `bad-shape` [2026-10-21]), its `member`
against the signed-in member, its age (60 seconds by the hub's clock), and its machine's lease, in that order, and
fails it at once on the first that does not hold, with no record and nothing queued. An RPC that passes is recorded
by its nonce (`forwarded`, with the stream generation it went to) and written to that stream. It becomes `done` or
`failed` with the first `rpc-result` the machine sends for it; it becomes `uncertain` when that machine's lease lapses
or its stream closes first, and an `uncertain` RPC resolves from the result the daemon republishes after it
reconnects. A write the machine's stream refused because it was already gone fails the RPC `machine-offline`; a write
whose fate is unknown makes it `uncertain`. The record answers a retry of the nonce for a day, and an `uncertain` one
is forwarded again on a retry once its machine is back (the daemon's ledger answers it without executing twice). The
hub never checks a code (it holds no key) and never reads `args` beyond their being an object.

**Bound to where it runs.** Every enrolled machine holds the org key, so a valid code does not say which machine
should act. Right after the code verifies, the daemon refuses an RPC whose `machine` is not its own enrolled name
(`wrong-machine`), whose `project` is not a hub project of this machine with the org it enrolled in
(`unknown-project`), or whose session is not a session of that project on this machine (`no-session`), before the
ledger, before freshness, and before anything else. It never relies on the hub's routing for this.

**Error codes.** The hub's: `machine-offline` (no fresh lease: fails at once, nothing queued; an RPC that waited out a
closed stream's grace for the next stream fails so too), `stale` (older than 60
seconds), `not-member` (`member` is not the signed-in member), `bad-shape`. The daemon's, before it executes:
`bad-code`, `wrong-machine`, `unknown-project`, `read-only`, `bad-shape` (arguments malformed, or a decision that does not
fit its request: a deny on an async question, an `answer` to a permission prompt, an allow on a question without its
answers, answers keyed by anything but the request's own questions; caught with the digest check, from the pending
request the bridge reports, and the bridge's own 400 for the same misfit, should one get past, is `bad-shape` too, after
the claim), `digest-mismatch`, `not-pending` (the request is no longer pending), `unknown-checkout`,
`above-ceiling`, `no-session`, `unknown-task` (a `stop` whose task the session's jobs index does not hold as a running
shell or monitor; DC10), `unsupported` (the session's kind cannot, per §5's table), `session-live` (a Resume of
a session live on its machine: a session's transcript lives on the machine that ran it, so "live anywhere" means any
process of this machine holding the session, terminal or `--bg`), `idle` (a steer while no turn is running: the web offers Send instead). After a claim: `copy-started` (a Resume raced the owner reopening the session; the copy is
stopped), `interrupted` (below), `failed` (execution failed; `message` says how).

**At most once.** The nonce is the RPC's id. The daemon claims it in its ledger (`claimed`) before the RPC has any
effect, records the outcome before sending the result, and keeps the entry a day. A nonce the ledger knows is answered
from the ledger, before the freshness check, and never executed again. A nonce left `claimed` with no outcome (the
daemon stopped between the two writes) is not executed again either: it is reconciled from the action's own trace
where one exists (a spawned seat carries its nonce; a steer carries its nonce to the bridge child, which keeps the
mod's answer under it, the last 100, in its kept file; a Resume's kept job is checked for the session, and a job
running another session is a copy, stopped and answered `copy-started`), and otherwise answered `failed` with
`interrupted`, at once for a claim whose job was never kept. A browser retry reuses the nonce; the hub answers it from its record or forwards it again
once the machine is back. Results reach the hub as DX2 `rpc-result` frames, republished until `rpc-ack`.

**Built at M3:** forwarding, the record per nonce, `uncertain` on a lapsed lease or a closed stream, `rpc-ack`, and
the retry rules above (`test/session-plane.test.ts`). The policy (DC7) is unchanged by these shapes.

### DX7 — Identity (owner DC3; G1, amended; enrollment built at M2; wrapped keys and Web Push at M3)

**Access.** Members sign in through Access; the Worker verifies `Cf-Access-Jwt-Assertion` on every request (RS256
against the team's certificate endpoint, the application's AUD, the team's issuer, `exp` and `nbf`) and names a
person by `email` (with `sub`), a service token by `common_name`, its client id. The `Registry` then answers who that
is: a member (by email, case-insensitive), an enrolled machine (by client id), or no one (refused). No configuration
switches verification off; the Worker refuses everything while its deploy configuration is incomplete: `ORG_ID`,
`ORG_NAME`, `ORG_ADMIN_EMAIL`, `ACCESS_ISSUER`, `ACCESS_AUD`, `ACCESS_CERTS_URL`, `CF_API_URL`, `CF_ACCOUNT_ID`, the
secret `CF_API_TOKEN` — those three the API through which it mints and deletes machines' service tokens (Cloudflare's
API deployed; the local stand-in for Access locally) — and the secret `VAPID_KEY`, the hub's key for Web Push (below).
The one path that takes no assertion is enrollment's redemption (below), which Access does not guard either. Outside
the Worker's routes, the web app's manifest and icons (`/manifest.webmanifest`, `/icons/*`) are public static assets
with an Access bypass of their own (M5's deployment), because iOS fetches them for a home-screen app without the
Access cookie; they carry nothing of the org.

**The org** is made from deploy configuration on first use, with `ORG_ADMIN_EMAIL` as its admin — never by whoever
signs in first. A stored org whose id is not the configured one (made under a previous deploy's variables, which
Durable Objects can keep for a while after a deploy) takes the configured id and name while nothing was built on it
(no machine, enrollment, project, or wrapped key) [2026-10-15, DC3's M5, MAWS `85e83830`].

**Records** (`identity.ts`):

```ts
type OrgRecord = { id: string; name: string; created: string; key_check: string | null };  // set by the first wrapped key
// Beside it the Registry keeps the org's `key_auth` verifier, SHA-256 of the first wrapped key's `auth`, never returned.
type WrappedKeyRecord = {
  id: string;                    // the hub's: 128 random bits as 32 lowercase hex
  method: 'passkey' | 'passphrase';
  label: string;                 // the owner's name for it, 1 to 100 characters
  credential: string | null;     // a passkey's WebAuthn credential id, base64url; null for a passphrase
  kdf: JsonObject;               // how the browser derives the wrapping key; the browser's (DC5's), stored verbatim
  iv: string;                    // 12 bytes, base64url
  wrapped: string;               // AES-256-GCM of the 32-byte org key with its tag: 48 bytes, base64url
  check: string;                 // HMAC-SHA256(org key, "smns-desk-key-check-v1"), 32 bytes, base64url
  created_by: MemberId; created: string;
};
type MemberRecord = { id: MemberId; email: string; role: 'admin' | 'member'; created: string };
type MachineRecord = {
  name: string;
  client_id: string | null;      // the Access service token's client id; null until the mint returns
  token_name: string;            // `desk-<org>-<machine>`
  state: 'pending' | 'active';   // pending until its first authenticated connection confirms it
  enrollment: string;            // the enrollment that created it
  created: string;
  confirmed: string | null;
};
type EnrollmentRecord = {
  id: string; created_by: MemberId; created: string; expires: string;
  state: 'open' | 'pending' | 'confirmed' | 'expired';
  machine: string | null;        // the one machine this token may ever enroll, once redeemed
};
type ProjectRecord = { id: string; name: string; registered_by: string; created: string; archive_machine: string | null };
type PushSubscriptionRecord = { member: MemberId; endpoint: string; keys: { p256dh: string; auth: string }; created: string };
```

**Member ids** are 128 random bits as 32 lowercase hex characters: stable (written into logs for good as
`hub/<member-id>` and `member`), and deliberately not uuids, which sminos reads as session ids (`writer_session`).
DX1's position check binds a `hub/` writer to this form.

**Machine names** match `^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$`, are unique in the org compared without case (a
case-insensitive disk would put two machines' writers in one file), and are never `hub` or `legacy` in any case (the
log's `hub/` and `legacy/` prefixes).

**Enrollment** is a durable state machine in the `Registry`: the browser asks for a one-time token (`open`,
short-lived); redeeming it on the path Access does not guard reserves the name and records the intent to mint before
Cloudflare's API is called, mints the service token `desk-<org>-<machine>`, and returns its client id and secret once
(`pending`); the machine's first authenticated connection confirms it (`confirmed`, machine `active`). A second
redemption while pending rotates the credential (the minted token deleted, a fresh one minted and returned); a pending
enrollment that expires deletes its token and releases the name; a token used for one machine never enrolls another.
Revoking a machine deletes its service token and its record.

**Enrollment's endpoints.** Bodies are JSON (at most 64 KiB, counted in UTF-8 bytes; a larger body is answered `400
bad-shape`); every error is `{"error": <code>, "message"?}`. The
types are in `identity.ts` (`EnrollmentRequest`, `EnrollmentIssued`, `RedeemRequest`, `Redeemed`, `RedeemError`,
`ArchiveRequest`, `HubError`, `REDEEM_PATH`).

| Request | Who | Answer | Errors |
| --- | --- | --- | --- |
| `POST /api/enrollments` `{ttl_s?}` | an admin | `201 {enrollment: EnrollmentRecord, token}`: `token` is 256 random bits, base64url, shown once (the hub keeps only its hash); `ttl_s` from 1 to 3600, default 900 | `403 not-admin`, `400 bad-shape` |
| `POST /machine/enroll` `{token, machine}` (under the Worker's `/machine/*` routes, ahead of the web app's assets) | anyone holding the token: the one path Access bypasses and the Worker admits without an assertion | `200 {org, machine, client_id, client_secret}`: the machine's service token, the secret shown once | `400 bad-shape`, `400 bad-name` (not an admitted machine name), `404 unknown-token`, `410 expired`, `409 confirmed` (the token's machine already connected: it is spent), `409 token-used` (the token is bound to another machine name), `409 name-taken` (another machine holds the name; nothing is bound, so redeem the same token under another name), `409 busy` (a redemption of this token is in flight: retry), `502 mint-failed` (Cloudflare's API failed: retry the same redemption) |
| `GET /api/machines` | a member | `200 {machines: MachineRecord[]}` | |
| `DELETE /api/machines/<name>` | an admin | `200 {revoked: <name>}`: the service token deleted, the record gone, the machine's stream ended, the name released, any archive designation of it cleared | `403 not-admin`, `404 unknown-machine` |
| `GET /api/projects` | a member | `200 {projects: ProjectRecord[]}` | |
| `PUT /api/projects/<id>/archive` `{machine}` | an admin | `200 {project: ProjectRecord}`; `machine` an enrolled machine's name, or null to clear | `403 not-admin`, `400 bad-shape`, `404 unknown-project`, `409 unknown-machine` |
| `GET /api/org/keys` | a member | `200 {key_check, keys: WrappedKeyRecord[]}`: `key_check` the org's, null while it has no key | |
| `POST /api/org/keys` `{method, label, credential, kdf, iv, wrapped, check, auth}` | an admin holding the org key | `201 {key: WrappedKeyRecord}`; the first one sets the org's `key_check` and `key_auth` | `403 not-admin`, `403 not-key-holder` (the org has a key and SHA-256 of `auth` is not its `key_auth`), `400 bad-shape` (`kdf` above 1 KiB, a field of the wrong length, a `credential` on a passphrase or none on a passkey), `409 different-key` (`auth` matches but its `check` is not the org's), `409 credential-taken` (a wrapped key for that passkey exists) |
| `DELETE /api/org/keys/<id>` `{auth}` | an admin holding the org key | `200 {removed: <id>}` | `403 not-admin`, `403 not-key-holder`, `404 unknown-key`, `409 last-key` (the org's only wrapped key is never removed: add another first) |

Redemption recovers from every loss: a lost answer is recovered by redeeming again with the same token and name, which
rotates the credential; an answer that never came back from Cloudflare (a lost mint) leaves a token named
`desk-<org>-<machine>`, which the next redemption, the expiry, or a revocation deletes by name before anything is
minted under it. A pending enrollment lasts `ttl_s` from its latest redemption; the machine confirms it by any
authenticated request (its stream, usually) before then, after which its token is spent (`confirmed`). One that
lapses — open or pending — is expired by the Registry's alarm or by the next redemption, whichever comes first: a
pending one's machine record goes, its name is free again, and its service token is deleted. A token whose deletion
the API failed is kept as an orphan by name and deleted when the API answers (at the next redemption, or an alarm a
minute on); a client id the Registry no longer holds is refused `403 {"error": "not-enrolled"}` meanwhile, though
Access may still admit it. The Registry's calls to the API under one token name — a cleanup's deletion by name, a
redemption's deletion and mint — run one after another, so a cleanup still in flight when the name is enrolled again
finishes before the new token is minted and never deletes it. A rotation stops the previous credential at the hub at once. Two redemptions of one token
at once: one mints, the other is answered `409 busy`. The hub never sees the org key: the browser builds the enrollment
code from the token.

**The enrollment code**, built in the browser so the hub never sees the org key, and pasted on the machine into
`sminos hub enroll` (read from a hidden prompt or stdin, never an argument, §6): the text `smns-enroll-v1.` followed by the base64url (no padding) of the UTF-8 JSON object
`{hub, org, token, machine, key}` — `hub` the hub's origin (`https`, or `http` on a loopback host for the local
runtime), `org` the org id, `token` the one-time token, `machine` the name to claim, `key` the org key as base64url
(32 bytes). A decoder refuses another prefix, a damaged body, a key that is not 256 bits, a name that is not admitted,
and an empty field. (`encodeEnrollmentCode`, `decodeEnrollmentCode`.)

**Archive designation:** `ProjectRecord.archive_machine`, an active machine's name, which DX2's `have.archive` tells
that machine at its next `hello`; revoking the machine clears it. Only the archive machine may upload `legacy/` feeds.
**Push subscriptions:** `PushSubscriptionRecord` `{member, endpoint, keys: {p256dh, auth}, created}`, one per member
device, keyed by `endpoint`, kept in the `Registry`.

**Web Push.** The hub sends Web Push from the Worker on WebCrypto alone (`src/push/web-push.ts`): the payload
encrypted as RFC 8291 has it (`aes128gcm`, one 4096-byte record, a fresh salt and sender key per push; reproduced
byte for byte against RFC 8291's worked example), the request signed with VAPID (RFC 8292, ES256; `aud` the push
service's origin, `exp` twelve hours on, `sub` `mailto:<ORG_ADMIN_EMAIL>`), with `TTL: 3600` and `Urgency: high`.
`VAPID_KEY` is a P-256 private key as JWK JSON (`{kty: "EC", crv: "P-256", x, y, d}`), a Worker secret deployed
(M5); the local command generates one on its first run and keeps it in `apps/desk-hub/.wrangler/vapid.json`
(git-ignored), so a local subscription stays valid across restarts, and the suites generate one per run. None is
committed. The endpoints, the signed-in member's own (types `PushKey`, `PushSubscriptionRequest`,
`PushSubscriptionKept`, `PushSubscriptionDeleted`, `PushSubscriptions` in `identity.ts`):

| Request | Answer | Errors |
| --- | --- | --- |
| `GET /api/push/key` | `200 {key}`: the hub's VAPID public key, the uncompressed P-256 point (65 bytes) in base64url, for `pushManager.subscribe({applicationServerKey})` | |
| `PUT /api/push/subscriptions` `{endpoint, keys: {p256dh, auth}}`, as `PushSubscription.toJSON()` gives them | `200 {subscription: PushSubscriptionRecord}`: kept for the member, replacing any subscription with that endpoint | `400 bad-shape` (an endpoint that is not an https URL of at most 2048 characters, `p256dh` not 65 bytes or `auth` not 16, each in canonical base64url), `409 too-many` (a member keeps at most 20 devices) |
| `DELETE /api/push/subscriptions` `{endpoint}` | `200 {deleted: true \| false}`: the member's own subscription with that endpoint forgotten | `400 bad-shape` |
| `GET /api/push/subscriptions` | `200 {subscriptions: PushSubscriptionRecord[]}`: the member's own | |

**When the hub pushes.** A `raised` request new to the hub (raised live, or first seen in a republished `pending`
set), and a `message` (**[2026-10-18]** or `question`) log event uploaded by a machine and stored for the first time
within ten minutes of its `ts` (so a machine's first sync of an old backlog pushes nothing), each push once to every
subscribed device of every member
of the org who has no browser socket showing the project (DX3 `visibility`, kept in the socket's attachment, so a
hibernated object still holds it) — and to none of a member who has one. The payload, `PushNotice` in `browser.ts`,
carries only what points to a card, since the service worker holds no org key and could check nothing it drew:
`{v: 1, project, name, session, alias, kind, request?, event?, waiting}` — `name` the project's name as the grid
shows it, so a notification says where; `kind` `question` (an `AskUserQuestion`, the ask mod's tool, or an `async`
request, or a `question` event), `permission` (any other request), or `message`; `request` the raised request's id,
or `event` the log event's `{writer, seq}` (a `message`'s, or a `question`'s); `alias` the session's, from its feed's latest event's `from` (null when the
hub holds none); `waiting` the org's waiting count once the push's own event is counted, the sum of the grid's
`ProjectSummary.waiting` over the org's projects, which the service worker sets as the app icon's badge (the app sets
it again from the grid whenever it is open, so an answered request clears). A push service answering 404 or 410 has dropped the subscription, and the hub deletes it; any other
failure is passed over (the push is not retried).
**[2026-10-18]** A question pushes once per ask. A bridge's async ask reaches the hub twice, as a `raised` request and
as the `question` event its log export writes (`src` the call's id: the request's `toolUseId` where it names one,
else the request's id), on the uplink's two planes in either order; whichever the hub takes first pushes, and the other is passed over
(the ask's id kept an hour, `session-store.ts` `asked`). MAWS's async ask (`mcp__maws__ask`) is never raised, so its
event is its one push. Messages and permission requests are unaffected.

**Wrapped keys** (§6; the hub stores them and never sees the org key). The browser draws the org key at random when the
org's first method is set up, and for each unlock method derives a wrapping key (a passkey: from its PRF output; a
passphrase: memory-hard; the derivations and their parameters are the browser's, carried in `kdf`), encrypts the org
key under it with AES-256-GCM, a fresh 12-byte `iv`, and as additional data the UTF-8 of `smns-desk-wrap-v1` LF org id
LF `method` LF `credential` (empty for a passphrase), and posts it. To unlock, a browser fetches the org's wrapped keys,
asks for a passkey among their credentials or for the passphrase, and unwraps straight into a non-extractable HMAC key;
a failed tag is a wrong passphrase or another passkey, and an unwrapped key whose `check` is not the org's
`key_check` is refused. Adding a method, and building an enrollment code, unwrap the key once more as raw bytes and
wipe them after. `key_check` and `key_auth` keep one org from ever holding two keys: a second first-time setup racing the first
carries another `auth` and is refused `not-key-holder`, which the hub checks before anything else, so a caller without
the key learns nothing of the records; `different-key` is left for a holder of the key whose record's `check` is wrong. It reveals nothing a code made with the key does not. **Changing the org's wrapped keys
takes the key, not only an Access session:** `auth` is HMAC-SHA256(org key, UTF-8 `smns-desk-key-auth-v1`), 32 bytes,
base64url, which a browser holding the key computes even from its non-extractable copy. The first wrapped key sets
`key_auth` = SHA-256(`auth`) with `key_check`, in one step; every later add or removal must carry the `auth` whose
hash it is, or is refused `not-key-holder`. `key_check` is public and proves nothing; without this, a stolen admin
session could post a record carrying the public check over junk bytes and then delete every real one, leaving the
org's browsers no way to their key. A hub that is itself compromised can still delete records, as it can withhold
events: that is availability, not authority. An admin session that sets up a key before the owner does makes an org
the owner cannot unlock (the owner's setup is refused `not-key-holder`), and gains no authority with it, since no
machine holds that key; the owner sets up the key right after deploying. The hub can test passphrase guesses
offline against a wrapped key at the derivation's cost per guess, as it could against any code; the memory-hard cost
and the passphrase's length are the defense. Removing a method does not take the key from a browser that kept it;
changing the org key itself means enrolling every machine again and is out of phase 1.

**Built at M2** (proved by `test/enrollment.test.ts` through the stand-in: a name already enrolled refused, case
aside; a confirmed token redeemed again refused; a revoked machine's connection refused, at once and with its token
outliving the revocation; two redemptions at once; the API failing; a mint's answer lost; a redemption's answer lost;
a used token offered for another machine; a pending and an open enrollment expiring; a runtime restart with an
enrollment pending). **Built at M3:** Web Push, its endpoints, and the VAPID key (`test/push/web-push.test.ts`: RFC
8291's example, decryption by an independent reader, the VAPID signature; `test/session-plane.test.ts`: a push per
device of a member not looking, none when one tab shows the project, none for a republished request, a 410
deleting the subscription); the wrapped keys (`test/org-keys.test.ts`: two first setups racing, the attack without
the key refused at each step, a round trip, every malformed shape, a member who is not an admin, the last key and an
unknown one, `key_auth` in no answer). **For M5:** the same against Cloudflare's API and Access, and the deployed
VAPID key.

### Running the local hub and its stand-in for Access (DC3's M2; for DC4 and DC5)

**One command**, from the MAWS worktree root:

    pnpm --filter desk-hub local                     # options: --port <n> --user <email> (no `--`: pnpm passes it through)

It starts `wrangler dev` (the Worker and its Durable Objects on workerd, on `127.0.0.1:<port + 1>`) and, in front of
it, the stand-in for Access on `http://127.0.0.1:8747` (`--port`; it refuses a port something already answers on —
8787, wrangler's default, was taken on the owner's Mac). Talk to the stand-in's URL only, as you will talk to Access
in front of the deployed hub. It prints the URL and what follows. State survives restarts: the hub's objects in
`apps/desk-hub/.wrangler/state`, the stand-in's signing key and minted tokens in `apps/desk-hub/.wrangler/standin.json`
(git-ignored); delete `apps/desk-hub/.wrangler/` to start from nothing. The org is `local`, its admin
`owner@example.com`.

**What the stand-in does**, as Access and Cloudflare's API do for the deployed hub (`apps/desk-hub/local/`):
- **People.** A request with no other identity is signed in as `--user` (default the admin). Another person: the
  header `X-Desk-Standin-User: <email>`, or, in a browser, `GET /standin/login?email=<email>` (sets a cookie, which the
  browser's WebSocket carries too) and `/standin/logout`. With `--user ''`, a request naming nobody is refused `403
  {"error": "access-denied"}`, as Access refuses it.
- **Machines.** `CF-Access-Client-Id` and `CF-Access-Client-Secret` of a service token the stand-in minted (through
  enrollment) are turned into the assertion, as Access does; an unknown token or a wrong secret is refused `403
  {"error": "access-denied"}` before the hub sees it.
- **The redeem path** (`POST /machine/enroll`) passes with no identity, as Access's Bypass policy will.
- **It drops** any `Cf-Access-Jwt-Assertion` a client sent and signs its own (RS256, served at `/standin/certs`, which
  the Worker is configured to verify against), and answers Cloudflare's service-token API at `/standin/client/v4/…`
  for the Worker's enrollment.
- **WebSockets and SSE** pass through it unbuffered.

**An enrollment code without a web app** (the stand-in plays the browser's part, so the hub still never sees a key):

    curl -s -X POST http://127.0.0.1:8747/standin/enrollment-code -d '{"machine": "mini"}'
    # {"code": "smns-enroll-v1.…", "key": "<a fresh org key>", "token": "…"}; pass "key" to reuse an org key, "ttl_s" for a short token

Then on the machine, run `sminos hub enroll` (DC4) and paste the code at its hidden prompt (or pipe it to its stdin;
never an argument, since the code carries the org key). It redeems the token at `/machine/enroll`, opens
`GET /machine/stream` with the returned credential (which confirms the enrollment), and syncs with `POST
/machine/frames`. By hand:

    curl -s -X POST http://127.0.0.1:8747/machine/enroll -H 'content-type: application/json' -d '{"token": "<token>", "machine": "mini"}'
    curl -sN http://127.0.0.1:8747/machine/stream -H 'CF-Access-Client-Id: <client_id>' -H 'CF-Access-Client-Secret: <client_secret>'

A browser (DC5) opens `ws://127.0.0.1:8747/api/projects/<project id>/socket` once a machine has registered the
project; `GET /api/me`, `/api/machines`, `/api/projects` answer the signed-in member. The Worker also serves the web
app's build from `apps/desk-web/dist` on every other path (`run_worker_first` covers `/api/*` and `/machine/*`); the
directory is created empty when missing, since wrangler refuses a missing one.

**In the suites** (`test/support/local.ts`), the same stand-in fronts the hub on Miniflare, with the runtime
restartable over its stored state and the Worker's calls to the service-token API open to faults; DC4 and DC5 may
copy that harness's shape.

### The fake machine (owner DC3; built at M4; for DC5, DC6, and M5's measured run)

An enrolled machine without a Mac. It speaks DX2 with the org key, as DC4's daemon and DC7's controls will, and
replays recorded sessions under DX4. The web children can then build and test against the real protocol. It is
a library, `desk-hub/fake-machine` (`apps/desk-hub/fake-machine/`), and a command. It runs in Node (fetch, WebCrypto,
`node:fs` for recordings). A browser never imports it.

**The recording.** A directory, one session:

| file | what it holds |
| --- | --- |
| `transcript.jsonl` | the session's transcript rows, the lines carrying a `uuid`, verbatim |
| `subagents/agent-<id>.jsonl`, `agent-<id>.meta.json` | each subagent's rows, and its `meta.json` verbatim |
| `events.jsonl` | the bridge's own stream (DX5 `GET /events`, what `sminos watch --json` prints), each line with `_ms`, its arrival in ms |
| `presence.jsonl` | `{_ms, record}` each time the session record's `status`, `waitingFor`, `needs` changed (optional) |
| `log/*.jsonl` | the log events its machine wrote: `joined`, the bridge-exported `message`, … (optional) |
| `deliveries.jsonl` | `{_ms, event: {writer, seq}, session, outcome, reason}`: DX4's `delivery` without its code, each time the daemon settled delivering an event under `log/`, named by its recorded position, to a session (optional) |
| `diff.patch` | the working tree's diff against its base branch (optional) |
| `recorded.json` | `{session, cwd, member}`: `member` is the placeholder that the recording's web answers name in `by` |

Chunks come from the bridge when `events.jsonl` has them. A recording without `chunk` lines, or without the file,
has them synthesized from its transcript, so the format admits both. In a synthesized recording:
- each response row's block streams in 12-character chunks of DX5's shapes (`text`, `thinking`, `tool` then
  `input`);
- then come its `block-row` and the row, and the step's `step-end` after its last row;
- the requests and `usage` in a partial `events.jsonl` are kept.

`loadRecording(dir, {session?})` reads a recording into one timeline of steps. In a real recording each row is
placed right after its notice (`block-row` or `row-seen`), and a row passed over is released with the next one, as
DX5's consumer rule says. `session` renames the session everywhere, rows included, so two fake machines can replay
one recording into one project.

**The committed recording**, `recordings/two-subagents` (`TWO_SUBAGENTS`), is a real haiku session on Claude Code
2.1.300 with DC2's bridge loaded. `fake-machine/record.py` recorded it in isolation:
- a temporary HOME, `CLAUDE_CONFIG_DIR`, and `SMINOS_HOME`;
- a copy of doperpowers' plugin loaded with `--plugin-dir`;
- a tmux server of its own, and no `--bg` job.

The session does the following:
- it starts two subagents, which ran in the background;
- it writes `recorded.txt` through Bash after a permission prompt, allowed from the web;
- it asks with AskUserQuestion (the ask mod's `toolu_plugin_…` request), answered `blue` from the web;
- it sends a `<message>` (a `message` log event);
- in a second prompt, its turn is interrupted mid-response, so a step ends aborted.

Both settlements are `winner: "web"` with `by` the placeholder `000…0`.

Two parts of the recording are synthesized, as `recorded.json`'s `synthesized` says, because no outside-origin
event reached the recorded session:
- a peer session on the same machine (`log/SK.local.5e0c1f2a-….jsonl`), which joins and then says two things to the
  recorded session;
- `deliveries.jsonl`, holding the outcomes of delivering those two says: `delivered`, then `uncertain`.

The stream holds 256 chunks, 14
`block-row`s, 48 `row-seen`s, nine steps, and three `usage` events. The transcript is every line with a `uuid`,
verbatim, except that each `prompt_snapshot` attachment is cut to its first 200 characters. That attachment holds the
engine's whole system prompt and tool definitions, over 100 KB of the engine's own text. To record another session:

    apps/desk-hub/fake-machine/record.py --doperpowers <checkout with DC2's bridge> --out <dir>   # gateway keys in the environment

**The library.**

```ts
import { FakeMachine, loadRecording, TWO_SUBAGENTS, emptyMemory } from 'desk-hub/fake-machine';

// The web app's own enrollment code (what the owner pastes at `sminos hub enroll`):
const { hub, machine, credentials, orgKey } = await FakeMachine.redeem(code);
// or, in DC3's suites, a service token from `enroll(hub, ADMIN, name)` and any 32-byte key.
const fm = new FakeMachine({
  hub, machine, credentials, orgKey,
  project: '<.smns project id>', projectName: 'demo',
  recordings: [loadRecording(TWO_SUBAGENTS)],
  member: '<the member id the recording's web answers should name>',
});
await fm.connect();                  // hello, its events the hub lacks, pending, unacked results, presence
await fm.play({ speed: 0 });         // 1 = the recorded pace; `until: (step, session) => boolean` pauses after a step
```

`FakeMachineOptions`:

| option | meaning |
| --- | --- |
| `hub`, `machine`, `credentials`, `orgKey` | where it connects, its enrolled name, its service token, and the org key (32 bytes or an imported `OrgKey`) |
| `project`, `projectName?` | the one project it opens; the name registers the project at its first `hello` |
| `recordings?` | one session each |
| `member?` | replaces the recording's placeholder in a recorded settlement's `by` |
| `memory?`, `onMemory?` | what outlives a run, for a restart (below) |
| `decisions?` | `recorded` (default): a recorded settlement settles as recorded. `wait`: the replay holds at it until the web answers (an RPC) or `answerInTerminal` does. A request the web answered first is settled by the web either way, and its recorded settlement passed over |
| `readOnly?`, `ceiling?`, `checkouts?` | its policy and the `machine` presence it reports. `checkouts` defaults to each recording's `cwd` on `main`. Read-only refuses every RPC `read-only` and delivers nothing from outside (`refused-read-only`) |
| `bridge?` | `false`: its sessions have no bridge. Presence says so. Rows alone stream (no `chunk`, `block-row`, `step-end`, or `usage`). A steer answers `{row: null}`. Interrupt, decide, answer, model, and compact fail `unsupported` |
| `retime?` | log events take `ts` when first written (default), so a `message` pushes as a fresh one would; `false` keeps the recorded times |
| `snapshot?` | `(session, sub, agentId) => SnapshotOptions`: per-subscription race hooks (below) |
| `script?` | `{[rpc]: (rpc, machine) => outcome \| undefined}`: answers an RPC in place of the default effect (undefined falls through) |
| `delivery?` | `(event, session) => {outcome, reason}`: the DX4 outcome of delivering an outside event (default `delivered`) |
| `reconnect?` | reconnects with backoff (0.5 s, doubling to 10 s) whenever the stream ends, as a daemon does. The command sets it; suites drop and reconnect when they choose |

What it does, as DX2 and DX4 have it:
- **The log plane.** Each recorded log event is written under the fake machine's own writer (`<machine>/<feed>`,
  its `machine` field renamed). It is sealed with a nonce derived from the event (DX1), uploaded when the replay
  reaches it, and written once (`memory.written`). After every (re)connect it sends the following:
  - `hello` with its vector;
  - its own events beyond the hub's `have`, and what a `resend` asks for;
  - `pending` with its complete set;
  - every `rpc-result` the hub has not acknowledged;
  - the DX4 `machine` presence and each session's `presence`.

  Events the hub sends are imported as a daemon does. Each is verified. A bad code, a seen nonce, or a different
  payload at a held position is refused and reported up as `rejected` (`bad-code`, `seen-nonce`, `conflict`), and
  the position is spent: the vector moves past it. A newly imported `human` or `say` from outside, addressed to one
  of its sessions or to `*`, gets one sealed `delivery` per recipient. When the outcome is `delivered`, the text also
  appears in the session's transcript as a user row. A recorded delivery outcome (`deliveries.jsonl`) is sealed and
  published when the replay reaches it. It names the event as this machine rewrote it (its writer and the seq it
  took), so it lines up with the browser's log and its `deliveries` on reconnect.

  Writes to its own feeds run one at a time, whoever asks: the replay, an RPC's effect, or `write`. Each takes the
  next seq, and the write-once check is part of the same step.
- **Requests.** A recorded `raised` is sealed and published (`deadline`, when present, is re-timed to 3 s from now).
  A recorded `settled` is sealed and published, following `decisions` above. A `decide` or `answer` RPC that does
  not fit the pending request it names is malformed: it fails `bad-shape` before any claim (composite `dd908dfa`),
  with the bridge's own words:
  - a deny on an async question: "an async question waits for an answer; it cannot be denied";
  - an `answer` to a permission prompt: "a permission is allowed or denied as asked: updatedInput carries a
    question's answers only";
  - an allow on a question: "a question is allowed with its answers: updatedInput.answers, keyed by the question";
  - answers not keyed by exactly the request's questions.

  A native question can still be denied. A claimed `decide` or `answer` is then checked against the pending
  request, in this order:
  - a digest other than `{session, request, tool, input_sha256}` of the `raised` as published fails
    `digest-mismatch`;
  - a request no longer pending fails `not-pending`, with the settlement's `winner` and `by` (item 1);
  - a decision inside the last 200 ms of a deadline fails `not-pending` with `terminalOnly: true`;
  - otherwise it answers `done {}` and settles `winner: "web"` with `by` the RPC's member, the outcome `allow`,
    `deny`, or `answered`.

  `answerInTerminal(request, outcome?)` settles one as the terminal's.
- **Subscriptions** follow DX4's producer rules (`fake-machine/session.ts`):
  - subscribe before snapshot: the bridge's state and the subscriber joining the stream are taken in one step, the
    rows are read up to the cut taken with them, and what arrived meanwhile follows the snapshot. Rows the snapshot
    holds (by uuid) are dropped, and so are chunks at or below their message's `upTo`;
  - the message-level `upTo` is the watermark;
  - a block leaves the snapshot state at its `block-row`, and its whole message at its step's end, aborted or not;
  - `step-end` follows every `block-row` of its step, and a step still open at its turn's end gets one then;
    **[2026-10-29]** each carries the recording's stamp of the end that ended it (`t`) and, per subscription, the
    `model` and `effort` of the step's start as that subscription knew it, as DX4's `step-end` row says;
  - a main-scope subscription carries every agent's chunks, `block-row`s, and `step-end`s, the subagent tree, and
    `usage`, and its own transcript's rows. A subagent's `block-row` there settles at once, since that subscription
    never carries the subagent's rows. An agent-scope subscription carries that agent's alone;
  - `usage` is the bridge's, after each main turn, on main-scope subscriptions, and in their snapshot;
  - a snapshot carries rows newest first up to `SNAPSHOT_ROW_BUDGET` (256 KiB of JSON, or `budget`). Older rows come
    as `rows` pages, and `diff` answers with the recording's `diff.patch` on a main-scope subscription;
  - `end`:
    - `unsubscribed` when the hub says `unsubscribe`;
    - `session-ended` at `n` 0 for a session it does not hold;
    - `error` at `n` 0 for a subagent it does not hold yet. A browser subscribes to an agent once the tree shows it;
    - at `n` 0 for the next subscribe after `refuseNextSubscribe(reason, message?)`, as for a bridge not ready yet;
    - `discontinuity` at the next `n` for every open subscription after `discontinuity(session?)`, as the end of
      the bridge's own subscription, or a gap in it, does.
- **RPCs** go through a ledger of its own, in DX6's order:
  - the project, then the code (`bad-code`), the machine (`wrong-machine`), the arguments' shape (`bad-shape`, for
    a field missing or of the wrong type), and the session (`no-session`, for the session RPCs). Nothing is claimed
    for a refusal here;
  - the ledger: a nonce it knows is answered from it and never run again;
  - freshness (`stale` past 60 s), then read-only, then a decision or an answer that does not fit its request
    (`bad-shape`, above);
  - the claim (`memory.ledger[nonce]`, outcome null) before any effect;
  - the effect, complete with its trace (`memory.trace[nonce]`: the result, and for a steer its row). This covers a
    decision's settlement and a spawn's or a retire's log event. An effect or a script that throws ends as
    `failed: failed`, its message the error's;
  - the outcome recorded before the result goes out, and republished until `rpc-ack`. Only progress notices follow
    the result: a compaction's `compact` events.

  A claim left without an outcome is answered from its trace. Without one, which happens only for a scripted RPC, it
  is answered `failed: interrupted`. The default effects:
  - `steer`: appends a user row to the running main turn (`[sminos steer from human]\n<text>`, the bridge's shape) and answers its uuid (`idle` with no main turn);
  - `interrupt`: answers `{turnId: <the main turn running, or null>, stopped: [], running: []}`;
  - `model`: answers what is now in force for that session, `"default"` giving null;
  - `compact`: answers `{at: "now"}` with the compaction's `start` and `end` at once, or `{at: "turn-end"}` with them
    at the main turn's end. `rpc` names the RPC's nonce, and the counts are the last `usage`'s tokens and a fifth of
    them;
  - `spawn`: a new empty session, its `joined` (`role` the brief, `by` the member), and its presence. A checkout
    that is not one of `checkouts` fails `unknown-checkout`;
  - `retire`: `retired` with `by`, and presence null;
  - `resume`: `session-live` while the session's presence is live, else presence idle again.
- **Faults on command:**
  - `drop()` and `reconnect()` end the stream, as a daemon losing its network does; the hub ends its subscriptions
    and marks forwarded RPCs `uncertain`;
  - `answerHeartbeats = false` is a suspended daemon, whose lease lapses within 45 s;
  - **[2026-10-19]** `end(session?)`: a session's process gone while the machine stays connected, its presence
    published as null, as the daemon publishes a member whose process it no longer sees (every session, or the one
    named);
  - `crashAfterEffect(match?)`: the next RPC it admits stops the machine after its effect (the request settled,
    the log event written) and before its outcome is recorded. A `FakeMachine` constructed with the same `memory` (and `fm.credentials`) then answers a retry of the
    nonce from the trace, without running it again;
  - `raceNextSnapshot({advance?, overlap?})`: while the next subscription's snapshot is built, `advance` more steps
    of the replay are applied, and they reach the subscriber after the snapshot. With `overlap`, the live part is
    also handed what the snapshot already holds, as a transcript tail that started before the read would hand it:
    its newest row, and each streaming message's last chunk. The row ids and the watermark must drop them. A
    `snapshot` option gives the same hooks per subscription (`duringSnapshot`, `overlap`, `budget`).
- **For a test to read:**
  - `frames` (every frame down), `refusals` (the hub's `refused`), `rejected` (what it refused on import);
  - `rpcs` (`{nonce, rpc, outcome, executed}` each: `executed` says this instance ran the effect);
  - `postErrors` (also any replay step that failed), `sessions` (each `SessionDepth`: its `rows` by transcript, `presence`, `mainTurn`);
  - `pendingRequests()`, `vector()`, `memory`, `isCrashed`, `next` (the next step), and `played`.

  `step(n)` applies the next `n` steps whatever their times. `write(src, writer, fields)` appends an event of
  one's own to one of its feeds, written once per `src`.

**The command**, from the MAWS worktree root (no `--`: pnpm passes the arguments through). It bundles itself with
esbuild, since Node's type stripping cannot load the protocol module's extensionless imports.

    pnpm --filter desk-hub fake-machine enroll --state <file>      # the code on stdin, never an argument (it carries the org key)
    pnpm --filter desk-hub fake-machine run --state <file> --project <uuid> [--name <n>] [--recording <dir>]… \
        [--session <uuid>|new] [--speed <x>] [--loop] [--decisions recorded|wait] [--member <id>] [--read-only] [--keep-times]

`enroll` redeems the code at the hub it names. It keeps the hub, the machine's service token, the org key, and the
memory in the state file (0600). `run` replays and then stays connected, serving subscriptions and answering RPCs,
until Ctrl-C. It reconnects by itself and keeps its ledger in the state file, so a run after a crash answers a
retried nonce from it. `--loop` replays again as a fresh session each round. Against the local hub, the web app's
"Enroll a machine" gives the code. Against M5's deployment, the same code works.

**What it does not do:**
- Interrupt answers with the running turn, but the replay goes on as recorded. The recording's own last turn is a
  real interrupted one.
- A decision from the web settles the request as the web's, but the transcript stays the recorded one. A deny still
  shows the recorded tool result.
- After a restart, a steer's trace row is put back at the head of the session's transcript, not where it ran.
- It opens one project, writes no `legacy/` feed, and is never an archive machine.
- `usage` comes from the recording alone.

### The deployment (owner DC3; built at M5; for every child, the walks, and recomposition)

Folded 2026-10-15 from DC3's `interfaces-M5-reviewed-4495c41e.md`.

**Where.** `https://desk-hub.opencognita-platform.workers.dev`: the Worker `desk-hub` on the owner's Cloudflare
account (60c19eec070f0ed2457828c5d88a8b28), serving the org `ssfskim` ("SSFSKIM"), whose admin is
supremekim17@gmail.com. One Worker serves one org, named by the deploy's variables. The web app (DC5's build) is
served on every path the Worker does not run first for. Every answer except a WebSocket upgrade and a machine's SSE
stream names what is deployed in `X-Desk-Build: hub@<commit>[+dirty] web@<label>` (`dev` for a bundle that named
none), so anyone can check without credentials:

    curl -sI -X POST https://desk-hub.opencognita-platform.workers.dev/machine/enroll | grep -i x-desk-build

**Access in front of it** (Zero Trust team `flat-wave-208c.cloudflareaccess.com`; identity provider "Cloudflare",
restricted to the account's members):

| Application | Destinations | Policies |
| --- | --- | --- |
| `desk-hub` (self-hosted, hostname-level, session 24 h, 401 for a failed service token) | `desk-hub.opencognita-platform.workers.dev` | `desk-hub owner`: Allow, the owner's email. `desk-hub machines`: Service Auth, any Access service token |
| `desk-hub public paths` (self-hosted, more specific, so it takes precedence) | `…/machine/enroll`, `…/manifest.webmanifest`, `…/icons/*` | `desk-hub public paths`: Bypass, everyone |

A hostname-level application is used, not the Worker's own Access toggle, which refuses WebSocket upgrades. The
`desk-hub` application's AUD is the Worker's `ACCESS_AUD`.

**How each party reaches it:**
- **A person**, in a browser: open the URL and sign in; the Access cookie rides every fetch and both WebSockets. From
  a script: `cloudflared access login <url>` once, then `cf-access-token: $(cloudflared access token -app=<url>)` on
  each request and upgrade.
- **A machine**: the `CF-Access-Client-Id` and `CF-Access-Client-Secret` of the service token its enrollment returned,
  on every request (DX2's admission). A freshly minted token is refused `401` by Access for a few seconds, so a daemon
  retries its first connect. A client id the Registry never enrolled passes Access and is refused `403 not-enrolled`.
- **Enrollment's redemption** (`POST /machine/enroll`), the manifest, and the icons need nothing.
- **Unauthenticated:** a person is redirected (302) to the team's login; a bad service token gets Access's own 401.

**Deploying.** Only through `pnpm --filter desk-hub deployment deploy --assets <desk-web's dist> --web <label>`
(`apps/desk-hub/deploy/README.md`): it reconciles Access, deploys with the variables on the command line, and puts
`CF_API_TOKEN` and `VAPID_KEY` only when missing (`VAPID_KEY` is generated once and never rotated, since push
subscriptions bind to it). `wrangler.jsonc` keeps the variables empty, so any other deploy answers `503
not-configured`. DC5 deploys its web build through the same command. A deploy of new code reaches a busy object only
when it restarts, about five minutes later (§2). Every deploy is scheduled with the composite's writer while an owner
walk runs against the deployment.

**The proof commands** (`probe`, `fake-check`, `redeploy-check`, `measure`, `frame-cost`) enroll throwaway machines
and write projects, so they require `--test-org`, refuse the configured org, and check `/api/me` before any write;
they run only after a deploy under a throwaway org (`deploy --org-id <test org>`), never in `ssfskim`. A staging
deployment, so they never switch the production Worker's org, is deferred.

**The owner's first steps** (DX7's ordering): sign in, set up the org key first (the first unlock method), then
enroll machines from the web app's "Enroll a machine" (`sminos hub enroll`, the code pasted at its hidden prompt).

**State** (2026-10-16, night):
- **Deployed:** `hub@f12b122b web@master.f12b122b` (Worker version `ff8af865`), the build the two-Mac walk runs on:
  MAWS #20, the defects found preparing the walk (the web's blank async question, a refused Skip, the delivery reason
  and read-only drawing, the Diff error, a stale spawn dialog, model ids, revoked machines in the grid; on the hub, a
  removal that ends the machine's lease in every project, retried until each takes it, and leaves a name enrolled
  anew alone). No migration: #20's two tables are created on first use inside the objects' own SQLite; variables,
  bindings, secrets and Access unchanged. MAWS #21 (a test's port race) and #22 (item 8's console snippet, pasted by
  the owner, never served) change nothing deployed.
- **Before it:** `hub@47fa64ff web@master.47fa64ff` (Worker version `09cc96e0`), adding machine removal in the web
  (#17), over `hub@2ee490bc web@master.2ee490bc` (Worker `c44f4cd4`): MAWS master after DC3, DC5, DC6 and the
  channel's anchoring fallback (#16) merged, built from a clean checkout of master. The hub's code is
  byte-identical to the previous deploy's (no migration, the same variables, bindings and secrets); the web gained
  DC5's panel fixes and column-reverse channel, DC6's session depth, and #16. Access reconciled with no change; the
  org key and the walk's machine untouched. Before it: `hub@b11ea5f8 web@smns-erb-web.3de8a15e` (Worker `bf5e8232`),
  held through the owner's P2.11 so the step measured an unchanged build.
- **Org key:** set up by the owner in the phone walk's Part 2 (fingerprint `8133-6dc8-be8e`), with a passkey and a
  passphrase.
- **Machines:** `phone-walk`, the fake machine enrolled from an owner-made code for the walk's pushed requests, with
  its project "phone walk"; the walk has ended and its stand-in is stopped. The web had no way to remove a machine
  (the hub's `DELETE /api/machines/<name>` had no caller); MAWS #17 adds an admin's Remove to the Machines dialog,
  with a confirmation step, proven against the double and the real local hub (the stream ends within one heartbeat,
  the reconnect is refused). The owner removed `phone-walk` with it on the deployment (2026-10-16), and read the
  org key's fingerprint unchanged, `8133-6dc8-be8e`, after both deploys. No machine is enrolled now.
- **Leftovers:** the proofs' throwaway org `dc3-m5-test` keeps its Durable Objects' storage on the same Worker,
  unreachable from `ssfskim`.

### DX8 — The web shell's slots (owner DC5; G1)

Folded from DC5's plan (MAWS `66eabe92`,
`docs/doperpowers/plans/2026-10-15-desk-dc5-web.md` on `smns-erb-web`),
written at DC5's M1 and reviewed clean with it (fix wave `16e3aaff`).

Owner DC5, written at M1 (DC5.G1); binds DC6, and DC9 from 2026-10-17
(the amendments marked **[2026-10-17]** below). The reference is the code under
`apps/desk-web/src/shell/` (`slots.ts`, `slot-fallbacks.tsx`,
`session-plane.ts`, `sessions.ts`, `layout.ts`): where this text and those
types ever differ, the types decide and the text is corrected. A later
change is a Decision Log entry that flags DC6.

**Slots** (`slots.ts`, copied from MAWS's `src/renderer/src/app/slots.ts`).
`registerSlot(name, component)` returns its unregistration and the last
registration wins; `useSlot(name)` gives the registered component or the
shell's fallback (a quiet note of what will be there); `resetSlots()` for
tests. DC6 registered both slots from one `connectDepth()` called once from
`apps/desk-web/src/main.tsx`, as MAWS's `connectTranscript()` is called
from `App.tsx`; **[2026-10-17]** DC9 registers `depth` alone there
(`connectDepth()` returns the unregistration of `registerSlot('depth',
Depth)`), and the session view is the center's own component, not a slot:
`ChannelView` mounts it for a direct channel on the desktop layout while
`machineOnline !== false`. The session's main transcript is held per
(machine, session) by one reference-counted owner
(`depth/owner/session-owner.ts`, DC9's M3), which keeps the open-agent
request and the status word; the center passes MAWS's `ownerLane`, and the
Report · Transcript choice is kept per transcript key for the page's life
(as built at DC9's M4, desk-dc9 `7e2bbe642`).

| slot | props | where the shell mounts it |
| --- | --- | --- |
| `depth` | `{project, session: DeskSession \| null, plane: SessionPlane}` | the project view's right column while it is open; `session` is the selected direct channel's, null on the group chat and while the browser is locked. **[2026-10-17]** Its tabs are Subagents (the default), Jobs, Diff and Info, in that order (`DepthColumn.tsx`, DC9's M5); the Transcript tab is gone with the slot |

**[2026-10-17]** The `transcript` slot (`{project, session, plane, range}`;
a direct channel's working record, unfolded in the center at one fold) is
retired with the folds it drew: the center draws the session view over the
session's shared main subscription (§9.1). `TranscriptSlotProps` and the
fallback go with it.

**The working record's range** [retired 2026-10-17]. The fold's `range:
{from, to}` of exchange-item `src`s, clipped at span granularity, has no
consumer once the slot is gone; the per-turn record is MAWS's projection
over the transcript's own turns (§9.1 [binding — owner]). `range.ts` is
deleted, and `DeskTranscript` loses its range options, its `bounds` state
and the key suffix they added.

**The session plane** (`session-plane.ts`), handed to both slots as `plane`:

```ts
type SessionTarget = { machine: string; session: string; agentId: string | null }; // agentId null: the main thread
type SubscriptionMessage = SessionMessage<'snapshot' | 'row' | 'chunk' | 'block-row' | 'step-end' | 'rows' | 'subagents' | 'diff' | 'usage' | 'output'>; // output [2026-10-17]
interface SubscriptionListener {
  message(message: SubscriptionMessage): void; // snapshot (n 0) first, then n = 1, 2, … with no gap
  reset(): void;                                // a discontinuity the client recovers from: drop what was delivered
  end(body: SessionBodies['end']): void;        // the hub ended it, or the client cannot serve it; nothing follows
}
interface Subscription { rows(before: string, limit: number): void; diff(): void; output(taskId: string, tail: number): void; close(): void } // diff(): main transcript only; output() [2026-10-17]: a task's output tail, answered as an `output` message
interface SessionPlane { subscribe(target: SessionTarget, listener: SubscriptionListener): Subscription }
const transcriptKey: (project: string, target: { session: string; agentId: string | null }) => string;
```

The hub client keeps a subscription whole: a gap in `n`, a dropped socket,
a hub restart, and the hub's `end {reason: "discontinuity"}` (the bridge's
own stream lost events) each become `reset`; the client gives the broken
sub up, subscribes again under a fresh `sub` once the socket is up, and a
fresh snapshot follows; a message of a given-up sub is never delivered.
Any other `end` (machine offline, unsubscribed, error; `session-ended`
at `n` 0) ends it for good: the consumer subscribes again when it wants
to, for instance when `DeskSession` shows the machine back. **[2026-10-17]**
A subscription whose session ends stays open, idle and pageable (DX4):
the consumer reads the session's end from `DeskSession.presence`, keeps
the subscription while the view is open, and closes it when the view
goes, so a socket's 32 subscriptions are not spent on sessions nobody is
reading. `close()` ends it silently and it is never re-subscribed. Older
rows arrive as a `rows` message through `message`, a task's output as an
`output` message (`output()` clamps `tail` to 1..524288 and sends nothing
for a task id outside `[A-Za-z0-9_-]{1,64}`). The target's `agentId` scopes the subscription to one
transcript, as DX3's `subscribe` carries it; per-block streaming
(`block-row` settling a block when its row arrives) is the consumer's,
passed through as DX4 has it.

**The session** (`sessions.ts`): `DeskSession` is what the log says of a
session joined with what the session plane says now —
`{project, session, alias, machine, cwd, worktree, member, seat, ended: {by,
reason} | null, charge, status, state: {word, ts} | null, joinedAt, group:
"waiting" | "working" | "idle" | "ended", presence: SessionPresence |
null, machineOnline: boolean | null}`. `presence` is null until the hub
sends one and while the machine is offline. `seat` is the seat its latest
`joined` names, empty for a session the human opened; with `presence` it
gives the session's kind for §5's table: a live record with the bridge is
bridged; without it, a non-empty `seat` is a `--bg` seat and an empty one a
terminal session; a null record is not running. Model, context use, and cost
are not on it: the model comes from the transcript, and context use and
cost from the main subscription's `usage` (DX4), both DC6's. Inside an open project
`useDeskSessions(connection)` and `useDeskSession(connection, id)` serve
any view; `useProjectConnection(project)` (`project/registry.ts`) gives the
project's connection.

**The layout** (`layout.ts`): `useDeskLayout` holds `route` (`{view:
"grid"}` or `{view: "project", project, channel: {kind: "group"} |
{kind: "session", session}}`, mirrored in the URL as `/`, `/p/<project>`,
`/p/<project>/s/<session>`) and `depth: {open, width}` (default open, 380
px, kept in the browser's `localStorage`), with `navigate(route)` and
`setDepth(partial)`. The depth column's own tabs (subagents, jobs, diff, info; **[2026-10-17]**
the transcript tab moved to the center) are DC9's state, as DC6's were.

**The transcript store.** DC6 imports MAWS's transcript model and
`useTranscriptStore` as they stand (the renderer survey) and keeps each
transcript under `transcriptKey(project, target)`. A `TranscriptSource`
built over `SessionPlane` maps `reset` to `onReset`. A transcript is live
while its `DeskSession` has `presence.record` non-null and `machineOnline`
not false; DC6 tells the store through `setLive(key, live)`, as MAWS's
`transcript/shell.tsx` does.
**[2026-10-17]** The session's main transcript is owned per (machine,
session) by one controller the center's session view and the column share
while either holds it, with the open-agent request and the status word on
the same owner; the center passes `ownerLane` to `Transcript` and keeps
the Report · Transcript choice in the transcript store's `view`, as MAWS
does.

## Ordering & Dependency Map

```
DC1 spike ──► DC2 bridge ──G1─────────────────────────┐
                                                    ▼
DC3 hub ──G1──► DC4 uplink ─────────────────────► DC7 machine's controls ──┐
        │                                                               ├──► recomposition
        ├──G1──► DC5 web: conversation ──G1──► DC6 web: depth ────────────┤    (acceptance 1–12)
        └──G5 (fake machine) ──► DC5.G2 and DC6 acceptance ───────────────┘
                                                                          │
   2026-10-17 (§9): DC7 ──► DC8 machine: history and jobs ────────────────┤──► the walk's Part I again
                    DC6 ──► DC9 web: the session view ──(fake machine)────┘    (acceptance 11)
```

DC1 and DC3 start at once. DC3's G1 (the protocols) is its first deliverable
because three children wait on it; DC2's G1 likewise for DC7. DC5 and DC6 build
against DC3's fake machine, so they do not wait for the machine side; the
real two-Mac integration happens at recomposition. DC2, DC4, and DC7 change
doperpowers; DC3, DC5, and DC6 change the MAWS repository (`apps/desk-hub`,
`apps/desk-web`).
DC8 and DC9 (cut 2026-10-17, §9) follow the same shape: DC9 builds
against the contract and the fake machine, as DC5 and DC6 did, and does not
wait for DC8's code; DC8 changes doperpowers (the plane; the bridge for its
optional items), DC9 the MAWS repository (`apps/desk-web`; `apps/desk-hub`
for the `output` frame and kind and the fake machine; `src/` for the two
shared edits, as separate PRs). The one ordering between them is a deploy
order, not a build order: the hub with `output` is deployed before any
uplink release answers it (DX4). They meet on the deployment when the
walk's Part I is run again.

## Risks & Mitigations

- **The mod API is early access** ("may change without notice"). DC1 tests
  on the installed engine; measured churn 2.1.292 → 2.1.300 was additive.
  The bridge's degraded path (§2) is what remains if an API is withdrawn,
  and DC2's tests pin each primitive so a release that breaks one fails
  loudly.
- **Function hooks are behind a flag.** Without
  `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` the bridge does nothing; the daemon
  reports bridge-less sessions in the web rather than failing silently.
- **Organization-managed installs.** `claude plugin validate` warns that
  `PermissionRequest` hooks do not run in a user-installed plugin where an
  organization manages Claude Code; on such a machine permissions and
  questions are the terminal's alone, as the §5 table's no-bridge columns
  say. Not the owner's machines; it matters for the org phase.
- **One Durable Object per project may not carry the stream** (unknown 3).
  Measured: it carries 1,900 relayed messages/s with margin, and a busy
  machine's own uplink is the nearer limit (§8).
- **Bringing MAWS's renderer to the web is the largest piece of work.** DC5
  imports what MAWS keeps free of Electron and copies the skeleton of what
  is entangled, not the app; Electron-only surfaces (the in-app browser,
  voice, native menus) do not come. Living in MAWS's repository, the two
  apps also meet MAWS's gates on every change, and a change to an imported
  MAWS component reaches the web app at once — wanted, and a reason to pin
  what the web relies on with its own tests.
- **Anthropic converging.** Projects and Remote Control cover part of this
  for single users on first-party login; this unit's reason to exist is the
  project log shared by sessions and humans, the owner's machines behind
  their gateway, and the org model.
- **The engine's transcript attachments are internal.** The jobs index
  reads shapes no public typing names (`task_status`, `queued_command`
  with `commandMode: "task-notification"`, `toolUseResult.backgroundTaskId`,
  a Monitor's `toolUseResult`, `mcp_instructions_delta`), as read in
  2.1.300–2.1.301 transcripts. A release that changes one degrades a
  status to `unknown` or drops a job, never the transcript itself; DC8's
  fixture pins each shape so the change is seen at the test, and the
  bridge's live `agent` state covers running agents whatever the rows say.
- **The open-time build is shared across threads.** The index and the
  snapshot are built off the uplink's thread (DC8.G1), so the index is
  shared state between the build thread and `tick`'s live extension: one
  owner per transcript file, handed over through the queue, never read
  half-built.
- **Ended subscriptions count against a socket's 32.** The web closes a
  session's subscription when its view goes (DX8); the hub's bound is
  unchanged.
- **Task output files live under the temporary directory** and can be
  gone when asked for; `output` answers `missing`, never an error, and
  the row's own text (the notification's summary) stands.
- **A large session's agent files** (158 pairs, 1.1 GB observed) are
  stat'ed twice a second and read only on a changed size or mtime; a
  session that writes to many agents at once reads many files once each.

## Deferred / Out of Scope

**Deferred (may return):** phases 2–4 (§7); switching a live session's
permission mode, interrupting one subagent, rewind and fork; the channel
server path (§8 unknown 5); end-to-end encryption; sessions hosted by MAWS
(they stay outside the family, as `.smns` decided); sminos `send` to a live
seat moving from the inbox frame to the supervisor's `reply`, gaining
human-origin delivery (a `.smns` improvement independent of this unit);
per-member asymmetric keys, an admin-signed member list, and a passkey
step-up for spawn and approvals (the org phase, §6); authentication codes on
session depth (§6); a message reviving a closed terminal session by itself
(§3: Resume is the explicit act instead); a cross-project inbox as the
phone's landing view, listing every pending request across projects (the
grid's waiting counts and pushes that open the card carry phase 1; an inbox
needs a registry index the project objects update on raise and settle);
one shared stream per session in place of one per browser (DX4; the lever
past a busy machine's uplink, §8 unknown 3); a staging deployment, so
measurements and proofs never switch the production Worker's org, and on
it a re-measure of the phase-1 streaming budget from a quiet client (DC3's
M5).
From 2026-10-17 (§9): MCP server status in the desk (names only now;
status is the SDK host's `mcp_status`, which no mod or transcript carries,
though a `deferred_tools_delta` attachment names the servers that had
failed, needed auth or were pending at the moment it was written, a "last
known" a later unit could draw); stopping a background job from the web (a
DX6 RPC to the bridge's `TaskStop`, optional in DC8); history left under an old session id after
`/clear`, and sessions on a machine whose daemon predates DC8 (the web
falls back to the log-built channel); the desk as a remote mod surface,
until the engine adds a render call a mod can make or a surface transport
for terminal sessions (§9.6); the bridge's `delivered.uuid` carried to the
web, which DC8 left on the bridge's stream (§9.7; its `$.agent.list()` seed is mandatory since the review).

**Explicitly out of scope (standing exclusions):** the hub storing
transcripts (§3); hosting sessions on the SDK wire (§2); depending on
Remote Control (Purpose); RPCs queued for a machine that is offline (§3);
a hub that connects into machines (§2).

## Tracking Map

| child | artifact | status |
| --- | --- | --- |
| DC1 bridge spike | findings: `docs/doperpowers/specs/2026-10-15-arkho-desk-c1-findings.md` | **landed 2026-10-15**: 11 items, every primitive promoted, six with a change folded into §2 and §5; probe kept at `/tmp/c1probe` |
| DC2 bridge | plan: `docs/doperpowers/plans/2026-10-15-arkho-desk-c2-bridge.md` (doperpowers, branch `worktree-smns-erb`) | **merged 2026-10-15**: M1–M4 and the branch reviewed clean (`high`); PR https://github.com/SSFSKIM/doperpowers/pull/195, merge `a6c90a13`, 7.155.0; report `docs/doperpowers/plans/2026-10-15-arkho-desk-c2-report.md` |
| DC3 hub | plan: `docs/doperpowers/plans/2026-10-15-desk-dc3-hub.md` (MAWS, branch `smns-erb`) | **merged 2026-10-15**: M1–M5, the xhigh panel and its fix waves, and the joint re-review clean; PR https://github.com/SSFSKIM/MAWS/pull/14 (`smns-erb` → `master`), merge `c4d4458e` after master was merged in at `349f524f` (gate run 38848788463); Linux gate run 38846390702 green on `36d6bae3`; deployed `hub@b11ea5f8 web@smns-erb-web.3de8a15e`; residue the staging re-measure and the shared per-session stream (Deferred), two tech-debt rows in the PR; report `docs/doperpowers/plans/2026-10-15-desk-dc3-report.md` |
| DC4 uplink | plan: `docs/doperpowers/plans/2026-10-15-desk-dc4-uplink.md` (doperpowers, branch `worktree-agent-a6d7f69a8ab5f500f`, worktree `.claude/worktrees/agent-a6d7f69a8ab5f500f`) | **merged 2026-10-15**: M1–M4 and the branch reviewed clean (`high`); PR https://github.com/SSFSKIM/doperpowers/pull/194, merge `9e7d3d30`, 7.156.0 (main merged in at `2a864e49` after DC2); report `docs/doperpowers/plans/2026-10-15-desk-dc4-report.md` |
| DC5 web: conversation | plan: `docs/doperpowers/plans/2026-10-15-desk-dc5-web.md` (MAWS, branch `smns-erb-web`) | **merged 2026-10-16**: every task, the xhigh whole-branch panel (`895e27d1..3de8a15e`, 16 findings, 14 fixed over two reviewed waves, one left to DC5's judgment, one to tech debt) and the tail-follow rework reviewed clean; PR https://github.com/SSFSKIM/MAWS/pull/13, merge `76b1de782` at head `12ca2e89`; 287 unit tests; `e2e:desk-web` 45/45 on the Mac mini (run 38899621892) and 49/49 on Linux with WebKit (38899609623), `static,unit` 38899633797; the real-hub suite, gate group `e2e:desk-web-hub`, 16/16 on the mini (38890504759); the owner's phone walk through P2.12, P2.11 pending; residue the wrapped-key label collision (tech debt) and Safari before 27 (Decision Log); report `docs/doperpowers/plans/2026-10-15-desk-dc5-report.md` |
| DC6 web: depth | plan: `docs/doperpowers/plans/2026-10-15-desk-dc6-depth.md` (MAWS, branch `smns-erb-depth`) | **merged 2026-10-16**: M1–M3 and the branch reviewed clean (`high`, after two final fix waves); the xhigh whole-branch panel (`76b1de78..1a59b984`, 3 P2: paging that stalled on a page with no drawn rows, folds cut with a grammar other than the export's, a tool result lost across a fold boundary) fixed in one reviewed wave, its one regression fixed and re-reviewed; PR https://github.com/SSFSKIM/MAWS/pull/12, merge `1a06f2d9` at head `9dc963ab`; `src/depth` 111 unit tests; `static,unit` 38911431438, `e2e:desk-web` on the Mac mini 38912283795 and on Linux 38912751782, `e2e:desk-web-hub` 38913352891; report `docs/doperpowers/plans/2026-10-15-desk-dc6-report.md` |
| DC7 machine's controls | plan: `docs/doperpowers/plans/2026-10-15-desk-dc7-controls.md` (doperpowers, at eb26c82d on `worktree-smns-erb`; built on branch `worktree-agent-ab2de4f299f415dbf`, worktree `.claude/worktrees/agent-ab2de4f299f415dbf`, merging DC4 at 7252a5d7) | **merged 2026-10-15**: M1–M4 and the branch reviewed clean (`high`; four P2 fixed after the final review, the presence watermark among them); PR https://github.com/SSFSKIM/doperpowers/pull/196 (branch `dc7-controls`), merge `af3a5573`, 7.157.0; sminos 1740/1742 (the two load-timing assertions in TECH-DEBT), mods 298/298; Resume live 5/5 on 2.1.301; report `docs/doperpowers/plans/2026-10-15-desk-dc7-report.md` |
| DC8 machine: history and jobs | plan: `docs/doperpowers/plans/2026-10-17-desk-dc8-machine.md` (doperpowers, branch `desk-dc8`) | **merged 2026-10-17**: M1–M4 reviewed clean; the xhigh whole-branch panel (`b8f7d197..d5a54a13`, 3 P2: a refusal lost across a resync, legacy background launches derived `completed` cold, the clear-time retry hiding a new fork) fixed in one wave, reviewer-high on the delta found one more P2 (launch text over an explicit `toolUseResult`), fixed and re-reviewed `correct`; PR https://github.com/SSFSKIM/doperpowers/pull/219, merge `13b6033c` at head `20d3e283`, 7.168.0; CI green on 8 gates (run 39065772977); shared fixture `tests/sminos/dx4-jobs.json` at `48f254aa` (80 cases, 36 planted bugs caught); rolled out to `macbook` and `mini` 2026-10-17 20:23Z, both uplinks reconnected; residue `delivered.uuid` to the web, MAWS backfill's preamble form and origin gate (S2), adopted shells' output; report `docs/doperpowers/plans/2026-10-17-desk-dc8-report.md` |
| DC9 web: the session view | plan: `docs/doperpowers/plans/2026-10-17-desk-dc9-session-view.md` (MAWS, branch `desk-dc9`) | **merged and deployed 2026-10-18**: T0 mockups with the owner's verdicts (and the owner's look at M3–M5's shots); M1–M6 each reviewed clean; the xhigh whole-branch panel (`d94663760..79a8c812f`, 4 P2: a request notification not reaching a virtualized card, a withdrawn async question left waiting, keep-place restoring by raw index in report mode, paging stalling in report mode) fixed in one wave, reviewer-high on the delta found one more P2, fixed and re-reviewed clean; PR https://github.com/SSFSKIM/MAWS/pull/30, merge `f248aae6` at head `af6d5b8c2`; gates `static,unit` 39086239342 and `e2e:desk-web` 39086762891 on the head's tree; deployed `hub@f248aae6 web@master.f248aae6` (Worker version `0a030034`), both machines online after; S1 merged as https://github.com/SSFSKIM/MAWS/pull/26 (`67710dddd`); S2 parked on `desk-backfill-jobs` (§9.5, Decision Log); the bridge's interrupt row fixed in doperpowers #225 (7.170.0); residue in the report; report `docs/doperpowers/plans/2026-10-17-desk-dc9-report.md`, the SDE workspace and shots kept under this worktree's `.doperpowers/sde/` |
| DC10 stop a job from the web | this document's DC10 section (machine half in doperpowers, web half in MAWS) | **cut 2026-10-18** (the owner's approval of 2026-10-17): machine half merged, https://github.com/SSFSKIM/doperpowers/pull/232, merge `717c5b0b` at head `2972de35`, 7.172.0 (reviewer-high's 2 P2 fixed, reviewer-medium on the fix `correct`; ci-gate 39099630158 on the head's tree; live stop check 16/16 on 2.1.302), rolled out to `macbook` and `mini` 2026-10-18 05:21Z; web half merged, https://github.com/SSFSKIM/MAWS/pull/31, merge `484d4283` at head `32b0eb5c2` (reviewer-medium three rounds, the last `correct`; gates 39101526541 on the head's tree after master was merged in), with a subagent's shells and monitors in its drill-in, and the fake machine reading the main loop's stop note for an agent's jobs as the plane does; deployed `hub@484d4283 web@master.484d4283` (Worker version `cbe31407`) 2026-10-18 05:54Z; shots under this worktree's `.doperpowers/sde/2026-10-18-desk-dc10/shots/` |

## Surprises & Discoveries

- Observation: Remote Control cannot be the foundation on this machine.
  Evidence: 2.1.300 refuses it with "ANTHROPIC_BASE_URL is set and does not
  point at api.anthropic.com…", and the owner's settings route through a
  loopback gateway (SPEC §36.2.4; research agent, 2026-10-15).
- Observation: the engine's `--bg` supervisor's `permission-response` op is
  a no-op ("answers `{ok:true}` after the key check", SPEC 38.11.5), and
  `reply` cannot approve a permission prompt; permissions from outside need
  a hook in the session.
  Evidence: SPEC 38.11.5, 38.28.1c (critique round 1).
- Observation: `turn.step` streams subagents' token deltas; the SDK wire
  does not. Evidence: mod API declarations 2.1.300; MAWS
  `research/sdk-wire-gap.md` row 14.
- Observation: DC1 (live, 2.1.300) — the engine never tells a
  `PermissionRequest` hook that the terminal answered first; a web answer
  arriving after that is silently ignored, and the hook polls on.
  Evidence: findings item 5, `daemon.log` in `/tmp/c1probe`.
- Observation: answering a native AskUserQuestion from a `tool.call` hook
  ends the turn `aborted` when the doperpowers ask mod is loaded; the same
  answer through `PermissionRequest` `updatedInput` works in every setup.
  Evidence: findings item 6.
- Observation: `$.config.set({key: 'model'})` switches the session and also
  writes the model into the user's `settings.json` as the default for
  every new session. Evidence: findings item 7 (seen in a throwaway config
  directory, `/tmp/c1cfg/settings.json`).
- Observation: `$.turn.abort` leaves a running Bash alive, moved to the
  background; `TaskStop` on its task id ends it. Evidence: findings item 4.
- Observation: a background subagent's prompt draws no dialog while its
  `PermissionRequest` hook polls (40 s observed); with a 3 s bound the
  dialog appeared at 3.3 s. Evidence: findings item 10.
- Observation: the engine blocks a long foreground `sleep` ("Blocked: sleep
  30 followed by: echo …"). Evidence: findings, notes for the builder.
- Observation: the Arkho checkout read during brainstorming was stale.
  Evidence: `/Users/new/Developer/GitHub/arkho` sat on branch
  `agent-grade-reads` at cb1be4e (2026-08-20); `origin/main` (632 commits,
  last 2026-09-23) carries A3–A5 closed and A6 approved in its tracking
  map. Lesson: ground another repository against its remote's default
  branch, not its working tree.
- Observation: the engine's supervisor stops a `--bg` session that is
  finished or waiting and unattached for about an hour, so a seat whose
  question waits longer than that for an answer from the phone ends; the
  web then shows it ended, and Resume, or a seat's resume on delivery
  (smns §4), brings it back. DC7 checks what happens to a pending request
  across that stop.
  Evidence: code.claude.com/docs/en/agent-view, "Finished or waiting
  sessions unattached for about an hour are stopped", read 2026-10-15 by
  the discarded sminos hub's research (MAWS branch `sminos-hub`,
  `docs/doperpowers/plans/2026-10-15-sminos-hub.md`, Surprises).
- Observation: a message to a closed terminal session does not revive it
  in `.smns` as built; the v1 design said it did.
  Evidence: `push_member` in `skills/sminos/scripts/sminos.py`: "A session
  sminos did not spawn is never resumed: it is the human's to reopen, and
  reads the chat when it is back"; it returns `recorded` (spec review,
  2026-10-15).
- Observation: the daemon cannot verify Ed25519 signatures without a
  dependency: it is stdlib Python, and the standard library has no Ed25519.
  Evidence: `skills/sminos/scripts/sminos_daemon.py` imports only the
  standard library; `hashlib`/`hmac` give HMAC-SHA256 only.
- Observation: a `--bg` job starts in permission mode `auto` when no flag
  is given (engine 2.1.300): the classifier decides each call, and a plain
  Bash call raises no permission request. A background job raises requests
  only when it is launched in a prompting mode, or for a call `auto`
  escalates, so the scene of answering a background job's permission
  prompts from the phone is rarer by default than §4 pictured; questions
  are unaffected.
  Evidence: DC2's M3 live runs (doperpowers `3a33efcd`, 2026-10-15).
- Observation: the engine raises an OpenTelemetry `tool_decision` record
  to a mod's `telemetry.log` hook when a permission is decided, about
  0.1–0.2 s after the answer, carrying `tool_use_id`, `decision`, and
  `source` (`hook`, `user_temporary`, `user_permanent`, `user_reject`,
  `user_abort`). It still arrives with `DISABLE_TELEMETRY` and
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set. The bridge now depends on
  it to name a settlement's winner, and a witness mod in DC2's live check
  pins it against engine updates.
  Evidence: DC2's M3 fix waves (doperpowers `10f913d5`, `4b13cb9e`).
- Observation: a `$.http.fetch` started inside a hook's dispatch dies
  when that hook is aborted (Esc or an interrupt), even through a `$`
  captured earlier. A mod that must keep posting through an abort posts
  from a loop it started at `session.start`, as the bridge now does.
  Evidence: DC2's M3 (doperpowers `3a33efcd`, 2026-10-15).
- Observation: a Workers deploy does not cut what is connected. Objects
  holding a connection ran the previous version for about five minutes
  (+314.0, +315.3, +328.6 s); then they restarted, browser sockets closed,
  but machines' SSE streams kept beating from the old instance while every
  POST was refused `stale-generation`. A fake machine that reconnected only
  on silence lost about two thirds of its events in one run. A Registry
  created 25 s after a deploy that changed the org ran the previous
  variables and stored the old org's id.
  Evidence: DC3's M5, `interfaces-M5.md` "Findings that bear on the
  contracts" (MAWS smns-erb, 2026-10-15).
- Observation: a Durable Object RPC costs about 9 ms on the deployment;
  one Machine-to-Project RPC per frame was the whole session-plane limit
  (about 117 relayed chunks/s per project) until a POST's frames went in
  one call. A freshly minted Access service token is refused 401 for a few
  seconds.
  Evidence: DC3's M5 `frame-cost` and report (MAWS `ebde4565`, `83756611`).
- Observation: the MAWS report view already ships inside the component the
  desk renders. `Transcript` applies `reportRows` whenever the store's UI
  has `ownerLane` set and the reader has not chosen the transcript; the
  desk never passed `ownerLane`, so the direct channel re-implemented a
  cross-turn fold over the log instead, with a subscription per opened
  fold. Evidence: `src/renderer/src/transcript/view/Transcript.tsx:286-298`,
  `apps/desk-web/src/depth/view/TranscriptPane.tsx:159`,
  `apps/desk-web/src/depth/connect.ts:12-14` (the survey, 2026-10-17).
- Observation: each `rows` page re-parsed the whole transcript on the
  uplink's thread, and an ended session's subscription ended at its
  newest 512 KB, so an ended session's history was unreachable and a live
  one's cost about 300 pages of 2.15 s each on a 156 MB, 12,704-row
  transcript (about 11 minutes of stalled uplink). Evidence:
  `sminos_plane.py` `page` and `rows_of`, `finish`; `sminos_uplink.py:685-691`;
  the survey's timing run (`python3 -I`, read-only, 2026-10-17).
- Observation (2026-10-21): desk-open-fast has landed on the machine side
  (doperpowers spec `docs/doperpowers/specs/2026-10-20-desk-open-fast-design.md`;
  doperpowers PRs #301, #302 and #308; sminos 1.2.18, rolled to both Macs
  2026-10-21 00:02Z). A session open's machine share on the owner's MacBook is
  now 0.01–0.13 s: every open line reads `build: warm 0 ms` and `waits 0`. The
  same morning's Resume open took 5.40 s. The rest of what the browser waits is
  the web–hub–machine path. `view.first-rows` is 0.34–0.56 s for an in-app
  reopen and 0.98–1.41 s on a fresh page load, and drawing accounts for only
  0.02–0.11 s of either (`window.deskLatency()`, four doperpowers sessions of
  up to 28,540 rows, 00:11–00:13Z). So the next open-latency gain is the hub's
  (#52), not the machine's. The hub still ends each machine's stream every
  23–96 minutes; reconnects take 1.35 s, occasionally 12–16 s. Residue on the
  MAWS side: #88 (a machine POST's answer names the frames it refused) and #89
  (`older()` dedupe within a page; an unnamed block over 64 KiB kept whole on
  reconnect).
  Evidence: that spec's Surprises & Discoveries (2026-10-21); the owner's
  `daemon.log`; MAWS #52 issuecomment-6302972057.

## Decision Log

- Decision: Verification. This composite gets one independent review round
  on the whole document from `doperpowers:adversarial-reviewer` (the spec is
  technical-heavy) and, in the same round, a second
  `doperpowers:adversarial-reviewer` on the children and contracts for
  buildability. Each plan child names its own branch-review rung in its
  execution document, xhigh for DC3 and DC5 by their size (DC2, DC4 and DC7 amended
  below). Recomposition
  is a scale review: the two-Mac acceptance walk (Parent-Level Acceptance
  1–12) plus an xhigh panel per repository over the children's merged
  range.
  Rationale: a coupled design across two repositories and a security
  boundary; the critique debate on the design already ran (two rounds,
  converged — see the next entry).
  Date/Author: 2026-10-15, design session.
- Decision: The design draft's critique (`doperpowers:critique`, two
  rounds) moved the following before approval: commands reach the bridge
  through a session-lifetime child, and the permission and ask hooks
  long-poll the daemon (inbox frames drain only at the next tool round);
  the three verbs replace "interrupt then send"; pending requests,
  presence, and commands move to the session plane, commands as RPCs never
  queued for an offline machine, the decision audit in the Durable Object;
  presence from the engine's session records, not the debounced `state`; a
  concurrent daemon and an HTTP-pair uplink; the channel servers as the
  path to watch; one host (`from: "human"` plus `member`); the
  bridge-presence rule; at-least-once delivery de-duplicated in the bridge.
  The critic conceded the bridge as the one primary path.
  Rationale: each change is argued where it lives in the design.
  Date/Author: 2026-10-15, design session with the critic.
- Decision: The log's git archive is written by one machine's daemon, not
  by the hub. The owner chose "hub live, git as archive" (2026-10-15); who
  performs the export was not part of the choice. (v1 said a machine
  holding the hub's archive lease; the spec review found no child delivered
  a lease, and a designated machine needs none — see the review entry.)
  Rationale: a Worker cannot run git, and committing through the GitHub API
  would tie the archive to GitHub when `.smns` remotes are any git URL.
  Date/Author: 2026-10-15, design session.
- Decision: Spec review round 1 (two `doperpowers:adversarial-reviewer`
  runs: the whole document; the children for buildability), folded:
  - **Authentication covers every actionable thing the hub carries, with
    one org key (HMAC-SHA256) instead of Ed25519 signatures on web writes
    only.** Rejected then: signing only `human` events and RPCs — a hub
    could still forge a `say`, which `_owed`/`push_event`/`push_member`
    deliver and which resumes a stopped seat; and Ed25519 — the stdlib
    daemon cannot verify it. The owner's ruling (sign web writes, so the hub
    cannot cause execution) is what this serves; the mechanism change is
    reported to the owner.
  - **Approvals carry the digest of the request as drawn**, checked by the
    daemon against the request still pending; a hub that altered the card
    can no longer turn an honest Allow into approval of another command.
  - **Read-only covers delivery**: outside-origin `human` and `say` are
    recorded and settled undelivered, not only RPCs refused.
  - **No revival by message**: v1's "a message revives a closed terminal
    session" misread smns §4 (Surprises); an explicit Resume RPC replaces it
    (DC7.G4).
  - **Machine names are enforced by the hub** for hub projects, replacing
    the git integration's claim check; divergent payloads at an existing
    `(writer, seq)` are refused and reported.
  - **The archive is written by a designated machine** (above), with
    hub-only bootstrap and no git ingestion in DC4's acceptance.
  - **The session plane's semantics are written here** (DX4: subscribe
    before snapshot, numbered live messages, fresh snapshot on any
    discontinuity; pending requests raised then settled with the winner),
    so DC6 does not wait on the machine side; DC3's fake machine implements
    them.
  - **Settlement and audit have gates** (DC2.G3, DC3.G3), **compaction is in
    the spike and the local gate** (DC1, DC2.G2), **DC6 waits on DC5's shell**
    (DX8, DC5.G1), and **the fake machine gates acceptance, not start**
    (DC3.G5).
  - **DC4 split into DC4 (the uplink and the log plane) and DC7 (the machine's
    controls: session plane, RPCs, policy, Resume)**: different state
    owners (log files against live sessions) and verification strategies,
    and v1's DC4 carried both.
  Rationale: each finding was reproduced against the code or the
  contracts; none was dismissed.
  Date/Author: 2026-10-15, design session.
- Decision: Spec review round 2 (the same two lenses, scoped to round 1's
  fold), folded: the authentication code now covers the project id
  (domain-separated) and every field of an event but `mac` — a hub could
  otherwise transplant an authentic feed into another project, where its
  messages are owed afresh (a reviewer ran `_owed` to show it), or add
  `via`/`msg_id` to an honest web event, which `compose_frame` writes into
  the prompt; DX4 gains a per-message chunk watermark (`upTo`) so a
  snapshot's partial text and the buffered stream cannot both carry a
  chunk; DX4 gains delivery outcomes so the web can say a send was
  recorded or held back rather than delivered; Resume gains
  per-session serialization and the same-id postcondition with copy
  cleanup that `resume_session` already applies to seats. Rejected then:
  a closed schema for web events (the full-field code covers it and every
  future field without a list to maintain).
  Rationale: two P1 and three P2, all reproduced; each fix is local to a
  contract and its gates.
  Date/Author: 2026-10-15, design session.
- Decision: Spec review stops at round 2. Round 2's findings were narrow,
  local to contracts, and the reviewers specified their fixes; the
  contracts' full shapes get their next adversarial read at DC3.G1 and
  DC2.G1, which are reviewed before any consumer starts.
  Rationale: a third round on these edits would review the reviewers'
  own wording; the gate reviews see the shapes in their final form.
  Date/Author: 2026-10-15, design session.
- Decision: Four imports from **sminos hub**
  (`MAWS/docs/doperpowers/plans/2026-10-15-sminos-hub.md`), a design for the
  same product written in parallel, whose per-machine host owned sessions
  over the SDK wire. The owner compared the two and ruled that this
  design's bridge is the base, relayed by the comparison session; the one
  scope change was confirmed with the owner directly the same day.
  (1) **The phone in phase 1** [owner]: the PWA, Web Push sent from the
  Worker, mobile layouts for the needs-you loop, a push that only points to
  a card; acceptance 12, DC5.G4, DC3.G3, DX7, unknown 4. Rejected then: the
  phone in phase 4 as approved first; notification actions, which would
  need the org key in the service worker. (2) **One binding table of what
  each kind of session can do** (§5), filled from this spec and checked;
  the cells the comparison left open are settled there (an async question
  needs the ask mod, itself a mod; retiring a terminal session records it
  and leaves the process the human's). (3) **RPCs run at most once**: the
  nonce as id, the daemon's durable ledger answered before the freshness
  check, `uncertain` on a drop after forwarding, results republished on
  reconnect (DX6, DX2, DC7.G2, DC3.G3, DC5.G2); spawn and steer were the cases
  that could double. (4) **Cloudflare's limits** stated where they bind
  (§2): presence, pending requests, and delivery outcomes persisted, since
  a hibernating object can be evicted while its sockets stay open and no
  republish follows; frames bounded at 1 MiB; reconnect with backoff after
  a deploy; SSE's cost in unknown 2; a measured throughput run (DC3.G6).
  Also from the comparison: the SPEC's background-subagent exception to the
  permission race and the person-only prompt, added to DC1 and to the §5
  table. Snapshots became newest-first under the frame bound (DX4).
  Rationale: each import closes a gap this design had (a double spawn, a
  pending set lost to eviction) or follows the owner's scope call; none
  collides with a binding clause.
  Date/Author: 2026-10-15, design session.
- Decision: DC1's verdicts folded (all 11 promoted; six with a change).
  Questions are answered through `PermissionRequest` `updatedInput`, not a
  `tool.call` result, which removes the hook-order question; the bridge
  withdraws a request the terminal answered; a background subagent's
  prompt gets a 3-second window with a published deadline; interrupt adds
  `TaskStop` for a Bash the abort backgrounded; model and effort are
  rewritten per request in `turn.step`, rejecting `$.config.set`, which
  writes the user's default; compact asked mid-turn runs at the turn's
  end; steers are mirrored as `$.ui.log` lines; acceptance 6 uses a Python
  sleep. DC2 is dispatchable.
  Rationale: measured in real sessions (findings file); each change keeps
  the design's intent with the primitive that actually delivers it.
  Date/Author: 2026-10-15, design session.
- Decision: The session view, history to the first line, and jobs (§9;
  two children cut, DC8 in doperpowers and DC9 in MAWS). The owner, after
  a day working from the desk (the walk's Part I, acceptance 11), ruled:
  (1) **[binding — owner, 2026-10-17]** opening a session shows the MAWS
  app's own report over the session's transcript, folded per turn
  ("Working record · N tool calls · M messages", MAWS's `reportRows`),
  with a Report · Transcript toggle — the per-turn shape over the
  terminal's cross-turn folds that the log-built channel mimicked; and
  (2) **[binding — owner, 2026-10-17]** the phone keeps messages only, the
  log-built channel with "Working record · on a computer", reaffirming §4's
  2026-10-15 decision (**superseded 2026-10-18** by the owner: the phone's
  direct channel is the session view, below). From the survey: the report already ships inside
  the component the desk renders and was off only for want of `ownerLane`;
  history stopped at the join (the log) and, through the plane, at an
  ended session's newest 512 KB, each page re-parsing the whole file on
  the uplink's thread (2.15 s per parse of a 156 MB transcript); every
  agent that ran before the bridge loaded, and every nested one, was
  "unknown"; no `$` API lists shells, monitors or MCP servers, but the
  rows carry the shell and monitor lifecycle. So: DC8 builds an offset
  index per transcript, pages and builds it off the uplink's thread (a
  subscribe to a 254 MB transcript held that thread about 4 s on the
  MacBook), keeps an ended
  session's subscription pageable, builds a jobs index from the parse the
  plane already does joined with the bridge's agent state (forwarded, not
  dropped) and cached disk facts, carries it in the widened `subagents`
  body, and answers `output {taskId, tail}` under a containment rule; DC9
  builds the session view over the shared main subscription, the tail rows
  for undelivered sends, the request cards, the fallbacks, the column's
  agents with real status and its jobs view, the hub's `output` frame and
  kind and the fake machine's part, retires the folds and DX8's
  `transcript` slot, and lands the two shared MAWS edits (the ask-tool
  classify entry; shell and monitor starts in the backfill) as separate
  PRs. DX2, DX3 and DX4 gain `output`; DX4's `end {session-ended}` keeps
  its `n` 0 meaning only; DX8 loses the slot and gains `output()`. The hub
  ships before any uplink answers `output`. **Rejected:** the desk as a
  remote mod surface — the surface protocol rides the engine's stream-json
  control channel, held only by the process's SDK host, advertised only
  off a remote transport, and `$.ui` has no `render`, so neither the
  uplink nor the bridge can attach; it would also serve live sessions
  alone and run mod handlers from the web (§9.6); revisit if the engine
  adds a mod-callable render or a surface transport for terminal sessions.
  Also rejected: `request_slot` rows for pending requests in the session
  view (a work row in MAWS's derivation, folded under a closed record);
  patching agent status inside MAWS's `mergeSidecars` (the desktop app's
  semantics); a hub-side history buffer (§3 [binding]); the transcript on
  the phone (§4 [binding]; it also pulls MAWS's Markdown and shiki chunk;
  taken on 2026-10-18, below).
  Flags DC3 (DX2, DX3, DX4's module and the fake machine, now edited by
  DC9), DC5 (DX8, the channel's fallback), DC6 (its depth column and fold
  are what DC9 reshapes), DC7 (DX4's producer, extended by DC8).
  Date/Author: 2026-10-17, owner ruling (the walk's Part I) and design
  session (the survey).
  2026-10-17, after the adversarial review (six findings, all adopted): a
  send's tail row stays until its transcript row is observed, matched one
  to one by the delivery frame's `(writer, seq)` (round 1 kept an ordered
  text-containment fallback; round 2, below, removed it), since
  `delivered` means submitted, not written, and DC8 reports a refusal
  after `submitted` as a `failed` delivery (§9.1, DC8.G5, DX5);
  DC9 bridges DX4's streaming identities into the report's turn and
  live-buffer model, which DC6's turnless tail rows never reached (§9.1,
  DC9.G1); the `$.agent.list()` seed is mandatory and a nested agent's
  outcome is read from its parent's transcript, so `unknown` is allowed
  only in three named cases (§9.3, DC8.G3, DX4, DX5); `output`'s
  containment checks the opened target's realpath against a canonical
  root derived from machine state, besides the name suffix (§9.4, DX4,
  DC8.G4); `output` has four explicit variants and `Job.outputFile` is
  nullable (DX4, DX3, DX8); one normalization table and an evidence
  precedence, from MAWS's own mappings, bind both producers, pinned by the
  shared fixture (DX4, §9.3).
  2026-10-17, after the review's round 2 (three findings, all adopted): a
  web send is matched only by the frame's `(writer, seq)` or an exact row
  uuid — an unframed row, a terminal-typed prompt, never matches it, and
  the tail row stays, as a delivered entry if its row never comes (§9.1,
  DC9.G1); the status precedence is terminal row outcome, then known
  process death as `exited` (session gone, parent ended, bridge stopped
  without a word), then running or pending evidence, which stops counting
  once the process is gone, then `unknown`, with cold reconstruction and
  an open view reaching the same status (DX4, §9.3, DC8.G3, DC9.G5); a
  known task with no output file yet answers `missing` with `path: null`,
  retry-eligible, never `refused`, which stays the containment warning
  (DX4, §9.4, DC8.G4, DC9.G5).
  2026-10-17, DC8's two gaps in DX4, recorded from its Decision Log: the
  `output` containment root is a set — the slugs of the transcript's
  project directory, of the working directory the session joined with and
  of its session record's `cwd` — because the
  engine's temp directory follows the session's original working
  directory and a session that moved into a worktree splits its outputs
  from its transcript (387 and 137 paths in one family session); one root
  would refuse most of its shells, and a root taken from a row would undo
  containment. A background agent's `async_launched` result is `running`
  evidence from the rows at precedence (3), so a bridgeless running
  session's background agent is not `unknown` with a result in hand; the
  shared fixture pins it, and DC9's fake machine applies the same rule.
  2026-10-17, the owner's verdicts on DC9's taste mockups
  (`mockups/desk/09-session-view.html`): a send's delivery state sits in
  its bubble's foot and a send that will not arrive tints the bubble,
  over a caption under MAWS's held bubble (the owner means to suggest the
  same style to the MAWS app, so the foot is its own component); pending
  requests are cards inline at the transcript's tail with a "N waiting ↓"
  pill, over a band above the composer; a job's output opens under its
  row, over the column's whole pane; web Stop draws disabled now and is
  the first follow-up after DC8 and DC9; the end marker as drawn. The ask
  mod's question shows as its card at the tail while pending and as its
  transcript row, which points to the card, then carries the answer (§9.1).
  2026-10-17, the owner, on DC9's screenshots of the session view over a
  copy of a real session: the Transcript side of the toggle keeps the
  MAWS app's shape. Each finished turn folds behind its "Worked for …"
  divider, and one click opens its tool calls. Rejected: opening every
  turn by default. That would make the toggle's Transcript mean
  something other than the MAWS app's, and long sessions would get much
  longer to scroll.
  2026-10-17, DC8's shared fixture (doperpowers `tests/sminos/dx4-jobs.json`)
  binds both producers, its `about` normative where DX4's prose is silent;
  `output` containment is exact — the opened target's realpath equals
  `<realpath of one root>/<taskId>.output` — since a component prefix
  would accept a symlink to another task's file in the same root; the
  `$.agent.list()` seed carries `name` only when the engine's list gives
  one (DX5 as amended; corrected at DC8's M3, which found `AgentInfo.name?`
  in 2.1.300). At DC8's M3: the seed's and the refused delivery's shapes
  (DX5, "As built"), and `delivered.uuid` left on the bridge's stream —
  the frame matched all 174 observed deliveries; carrying the uuid to the
  web is a sealed-contract change deferred (§9.7). Rejected: a `row` on
  DX4 `delivery` now, a hub change for a case no delivery showed.
  2026-10-17, DC9's M2: a task-notification is read in both of the
  engine's forms — the `queued_command` attachment and a plain user row
  whose text is the notification, written when the engine starts a turn
  on one (76 of 300 recent transcripts) — by both producers; the shared
  fixture gains a plain-row case (doperpowers b7511dd9). DC8's survey
  (300 transcripts: 2,166 plain rows in main transcripts, 262 in
  subagent ones, 838 and 162 events in no other form) set the rule: the
  row's `origin.kind` must be `task-notification`, and a subagent's
  transcript writes the notification behind a fixed preamble. Rejected:
  MAWS's backfill's start-only check, which a typed prompt beginning
  with the tag passes; that backfill also misses the preamble form, so
  it loses nested agents' notifications (for the parked S2 work). Reading
  the attachment alone would leave such an agent `running`, then
  `exited`, never its terminal word.
  2026-10-17, §9.5's backfill edit leaves DC9: its review showed backfill
  alone gives the desktop app's disk-only sessions no shells or monitors
  (the store reads no `session.events` for them, drops events without a
  `seq`, and hides jobs without an engine status, by C8b's line), and
  delivering it reverses that product line in the MAWS app; the desk
  takes its jobs from DC8's body. The branch `desk-backfill-jobs` (with
  its review's fixes: expiry, a re-delivered result keeping its start) is
  parked for a MAWS-app follow-up that owns the whole feature, offered to
  its architect. Rejected: landing the backfill without a consumer, a
  half-feature on master that contradicts C8b's documented line.
  2026-10-17, DC8's M4: `adoptShellOutputRoot` is struck from the
  containment roots. In 2.1.300 it is the engine's in-process `--bg`
  takeover state, not a setting, and nothing on the machine names it.
  A shell adopted from another session therefore has its output refused,
  as a known refusal. The three slug roots stay. How many adopted
  shells fall under the original-cwd slug anyway is unmeasured.
  Rejected: taking that root from the adopting session's rows, which
  would undo containment.
  2026-10-17, DC9's M5: the session view ends an open turn at an
  interrupt marker row ("[Request interrupted by user]", and its "for
  tool use" form), whether the interrupt came from the desk or from Esc.
  Only 11 of 171 markers in 60 transcripts are followed by a
  `system/turn_duration`. MAWS's backfill only clears the tool loop
  there, and MAWS's live path ends the turn from the SDK result, which
  the web never receives. Without this, every interrupt leaves the turn
  reading "working" until the next prompt. The marker is an engine row,
  read in order, and the `turn.ended` takes an id derived from its uuid
  and position, so a reset, a rebuild or an older page replays it the
  same way. Rejected for now: relaying the bridge's DX5 turn end as a
  DX4 kind, which is more exact but changes a sealed contract. It is
  kept as residue. A turn with no end row and no marker (a process
  killed mid-turn, a cut replay) still reads "working", and is logged
  as debt. Rejected earlier: ending a turn on idle presence, which
  corrupted turn history.
  2026-10-17, the bridge's interrupt row (doperpowers #225, 7.170.0).
  The bridge wrote one row, `[Request interrupted by user from the
  desk]` followed by "Task …" lines, which no reader takes as the
  engine's marker. It now writes the engine's exact marker as a row of
  its own, then a note row (where the interrupt came from, each
  background task stopped). Both are meta rows with origin `{kind:
  plugin, name: doperpowers}`, since a plugin cannot append any other
  kind. A steer is the same kind of row, so the bridge refuses a steer
  whose text is exactly a marker or begins with the old form. The desk
  ends a turn on the exact marker from Esc (no origin) or from the
  doperpowers plugin. It keeps reading the legacy shape strictly, and
  draws the note row as nothing. The residual is a human steering the
  exact marker text through an older plugin, logged as debt. Rejected:
  telling the rows apart by an append field, since 2.1.300's
  `$.session.append` offers none.
  2026-10-17, DC9.G3 amended at DC9's M6. G3 said the phone's bundle is
  measured without MAWS's Markdown and shiki chunks. But the phone's
  log-built channel has drawn every `<message>` body through MAWS's
  Markdown since DC5, and the owner walked that phone. What §4 binds is
  that the phone never mounts the transcript, so G3 now holds the phone
  to loading no transcript chunk. Rejected: plain-text messages on the
  phone, which would make its report worse to meet a measuring line
  that overreached. A follow-up loads shiki and KaTeX only when a
  message holds code or math. (On 2026-10-18 the phone took the session
  view, and G3 became "no transcript chunk until a session channel opens,
  never the depth column's"; below.)
  2026-10-18, DC10's machine half (doperpowers #232, 7.172.0): a stopped
  job learns it from a note. `TaskStop` through `$.tool.call` writes no
  transcript row, and for a main-loop task the engine queues no
  notification. So a job stopped from the desk, or by DC8's interrupt,
  would have read `running` until the session ended. On success the
  bridge now appends `Task <id>, a background task, was stopped from the
  desk: it is not running.`, and DX4's derivation reads that note, and
  the interrupt note's "was then stopped" line, as `stopped`, each on
  its whole text. A steer that would read as either note is refused, as
  for the interrupt marker. The bridge refuses a stop that names an
  agent (`TaskStop` would kill it), so agents stay out of DC10.
  Rejected: waiting for the engine's notification, which never comes for
  a main-loop task.
  2026-10-18, the owner: a peer's message arrives as a peer's. The bridge
  has submitted every log event as the human's words (`$.prompt.submit`,
  `asUser`). So the terminal, the MAWS app and the desk all drew a
  peer's message as the owner's prompt, and the model read it in the
  owner's voice, approvals included. The desk's "From <name>" label only
  covered that up. A peer's event now takes the session's inbox socket,
  the channel native SendMessage between sessions rides. Claude Code
  delivers it as "Another Claude session sent a message", and MAWS's
  derivation already draws that as an `agent_message` row (`origin`
  `peer`, `parsePeerMessage`). Only the owner's events stay the human's
  words through the bridge. Sending is unchanged: `sminos say`, the log,
  and the hub across machines. Rejected: having agents switch to native
  SendMessage, which reaches only the same machine and leaves no record.
  Also rejected: changing only how surfaces draw the row, which leaves
  the model reading a peer in the owner's voice.
  2026-10-18, the owner: the desk's Access session lasts 30 days
  (`720h`, MAWS #35). At 24 h the phone was signed out every day, and
  until #33 the desk then sat on "Connecting to the hub…" with no word of
  why. Each deploy reconciles the application by name, so the next one
  applies the value. Cloudflare's maximum is one month. The org's global
  session stays 24 h, so an application token past 30 days needs a fresh
  sign-in. Rejected: 7 days, which leaves the weekly sign-in; keeping 24
  h with #33's banner alone.
  2026-10-18, the owner, on what comes after phase 1 (MAWS #36, #37, #38,
  all deferred until the walk ends):
  - Hosting stays on Workers and Durable Objects. Cloud Run would need an
    external store and cross-instance fan-out to rebuild what one object
    per project gives, and its WebSockets end within 60 minutes.
  - App-level Google sign-in is explored only if Access still causes
    trouble after the 30-day session, and then only after a spike on the
    installed iPhone app.
  - Machines join with reusable, expiring tokens and name themselves.
    A token grants membership only; an unlocked desk tab wraps the org key
    to the new machine. Tokens carry a scope and distinct authorities:
    projects, default policy, automatic key handover, expiry, a use cap,
    ephemeral.
  - The org key's authority is split so that machines verify RPCs but
    cannot mint them.

  Rejected: a join token that carries the org key, which would leave the
  power to command every machine wherever the token is stored.
  2026-10-18, a delivery into a running turn (doperpowers #233, another
  session's): the bridge appends the owner's delivery as a row read at
  the loop's next request (`$.session.append`), not as a prompt queued
  to the turn's end (median 39 s, max 253 s observed). The engine keeps
  that row as an `isMeta` row from the plugin, and an append can carry
  no `asUser`. The desk counted a delivery only on the bridge's
  `asUser` prompt or a queued command, so a Send to a busy session
  would have stayed at the tail and its row gone undrawn. #233 is held
  until desk-web reads a bridge meta row that opens with a whole sminos
  frame as the delivery, drawn as "Sent during this turn". The same
  change draws a steer's row, which was drawn as nothing. Steer rows
  are known by exclusion from the bridge's closed set of rows (DX5),
  pinned by a test. Rejected: the owner's message as an inbox frame
  while busy, which would put the owner's words in a peer's shape.
  2026-10-18, landed and rolled: doperpowers #233 (7.176.0) and #236
  (7.177.0, the peer's message as a peer's) merged, both Macs on 7.177.0
  with their daemons restarted; desk-web draws the bridge's wake (a row
  whose first line is `[sminos bridge]`) as a dim system line, and a
  delivery the bridge appended again after an Esc-rewind once, keeping
  the later copy, the one the engine read (MAWS #42, deployed `hub@cfaba533
  web@master.cfaba533`). Rejected for the rewind: walking the chain from
  the leaf, which drops parallel tool results that hang off their
  assistant, not the leaf's ancestry. Still open: the owner's message
  after an Esc pressed in the terminal (or a Remote Control cancel) falls
  back to the inbox frame, and the engine labels that frame as another
  session's, not the human's. The desk draws it as the owner's; the model
  reads it as a peer's. The desk's Interrupt does not cause it: the mod's
  `$.turn.abort` does not set the engine's stop marker (2.1.300). The fix
  proposed: append the owner's row and send only a wake through the inbox.
  2026-10-18, the owner: a steer whose turn an Esc undid before the
  session read it stays undone. It is not added to the next turn, and the
  desk draws it dimmed, "Not read: the turn was undone", so the owner can
  send it again as a message. A steer is guidance for the turn it was
  sent into. Added to a later turn, it could steer different work.
  Rejected: adding it again at the next turn start, as the bridge does for
  a delivered message. In the same change the machine marks the rows an
  Esc-rewind left off the live chain in DX4, and retracts rows already
  sent. The desk drops them, except that an owner's input no on-chain row
  repeats is drawn as undone. This retires #42's frame-line dedupe where
  it becomes a special case.
  2026-10-18, the off-chain marks landed as doperpowers #239 (7.179.0,
  head 686cf6ea, green 39124943916, unmerged until the desk PR that draws
  them is deployed). The DX4 delta is folded above under "The live chain".
  The desk draws them by these rules:
  - **Edited re-sends (orchestrator, within the owner's decision).** A typed
    prompt re-sent from the same point, with nothing answered between,
    counts as a repeat even when its text was edited. Its first wording is
    hidden, not drawn "Not read". Steers and deliveries keep the exact-text
    rule. Across 800 local transcripts there were 975 Esc re-send pairs: 159
    exact repeats, 402 prefix edits, 414 other edits. Under exact text alone,
    about 84% of re-sent prompts would draw a superseded wording dimmed,
    which the owner had already replaced by hand.
  - An off-chain input that an assistant row was written under was read and
    then undone on purpose (a `/rewind`). It is hidden with its turn.
  - Of identical undone inputs, only the last is drawn.
  - Merge order: desk PR deployed, then #238 (7.178.0), then #239 (7.179.0),
    then one Mac roll.
  2026-10-18, a steer's row names itself (doperpowers #240, 7.180.0; MAWS
  #49, deployed `hub@b4480ee6 web@master.b4480ee6`, both Macs rolled). The
  desk knew a steer only by exclusion from the bridge's closed set of
  rows, so any new kind of appended row would have drawn as the owner's
  words. `$.session.append` lets the plugin set only text blocks and an
  `agentId` (2.1.300 `AGt`, `m6r`), so the mark is a first line:
  `[sminos steer from human]`, the line `sminos steer`'s inbox fallback
  already opens with. The desk matches the line first and draws the words
  without it. It falls back to exclusion for unmarked rows, which an older
  bridge writes, and which exist for the minutes between the deploy and
  the roll. With the line, no steer's text reads as the interrupt's marker
  or a note, so #225's and DC10's steer refusals are dropped. The model
  acts on the framed steer at its next request, in a terminal session and
  in a `--bg` job (`tests/mods/live-control-check.py` on the merged tree,
  32 of 32). Rejected:
  pairing the row with the bridge's mirror line, a separate system row
  that other rows can land between, and that older bridges also write.
  The same desk change draws an async answer as the answer (above, the
  async question), and fixes the phone's top bar: a long project name had
  widened the whole app past the screen, pushing the status dot, the key
  state, Menu, "Sign in again" and the composer off it. The bar is
  `min-w-0`, and the name has an 80px floor. A steer through the inbox
  fallback (a session with no bridge) still draws as MAWS's peer message,
  logged as debt.
  2026-10-18, the owner: the phone's top bar says the hub link's state
  in a word only when it needs them ("Reconnecting", "Signed out"); Live
  stays a bare dot (MAWS #51, deployed `hub@df318ba8 web@master.df318ba8`).
  While the word shows, the project name's floor drops to 56px, and the
  key state truncates first. Rejected: the word in every state, which
  costs about 60px of name on every screen; the bare dot alone, which
  left the owner reading a red dot without knowing it meant signed out.
  2026-10-17, DC8's xhigh panel (three P2s, all fixed; doperpowers
  desk-dc8 370662a2, c81b77fc, 578b11b8):
  - DX5's `resync` gains `refused`, so a refusal whose post failed is not
    lost. Before, the desk kept "delivered" on a prompt the engine had
    dropped.
  - DX4 knows a background agent from three more sources: the persisted
    call's flag, and the two exact launch texts. The shared fixture is
    at c81b77fc. Without them, a cold open read older launches and every
    fork `completed`, while the live view read `exited`.
  - The bridge's clear-time retry no longer sets aside an agent that the
    new conversation's own hooks name, and restores one already set
    aside. Rejected: tech debt for the third, because hiding a live
    agent for the rest of a session is worse than the accepted seed
    residual.
- Decision: **The phone's direct channel is the session view** (the
  owner, 2026-10-18). This supersedes §4's 2026-10-15 transcript clause and
  its 2026-10-17 reaffirmation, ruling (2) of the session view's entry
  above. The evidence is acceptance 11: about 18 hours of work from the
  desk, and the one thing that still sent the owner to a terminal was the
  working record, which the phone drew only as the label "Working record ·
  on a computer". The owner pointed to Claude's mobile Remote Control,
  which draws it on the phone. So a direct channel is the session view
  wherever its machine is online (`ChannelView`'s `drawsSessionView` no
  longer reads the layout), with the desktop's fallbacks: an offline
  machine ("Working record · <machine> is offline") and a subscription
  that ends at `n` 0. The depth column (subagents, jobs, diff) stays
  desktop-only, and an Agent row is a plain row on the phone. DC9.G3
  becomes "no transcript chunk until a session channel opens, never the
  depth column's" (`e2e/phone-load.spec.ts`); the Markdown carve-out
  holds. One taste call was made in the build and told to the owner: below
  768 px the session view drops M3's 56 px gutter for "Jump to latest",
  and the control floats over the rows' end while the reader is away from
  the tail, as MAWS draws it in a narrow pane. Rejected: keeping the
  binding, which leaves the phone's report sending the owner to a terminal
  for the one thing they needed; a separate full-screen working-record
  view, a second drawing of what the session view already draws, with its
  own tests and its own gaps. Built as MAWS #55 (`8c06f1b9`, deployed
  `hub@8c06f1b9 web@master.8c06f1b9`); the layout detail is in DC9's plan's
  own entry. Flags MAWS #52, the next phase, where the phone keeps this
  shape.
  Date/Author: 2026-10-18, the owner; folded by the design session.
- Decision: A machine's reconnect is invisible to the reader (MAWS #57). The
  two Macs' `daemon.log`s from 10-17 05:46Z to 10-18 19:13Z hold 53
  hub-side drops. 27 came 298–313 s after a deploy, both machines within 9 s
  of each other, and 2 more after a `wrangler tail`: Cloudflare keeps an
  active object on its old code about five minutes, then routes new requests
  to a successor while the old instance's in-flight request, the machine's
  SSE stream, runs on and beats ("in-flight requests are allowed to finish if
  they do not access a Durable Object's storage"). The next POST reached a
  successor that held no stream, so the machine found out at its next `hb-ack`,
  up to 15 s later. The other 24 hit one machine at a time with no trigger the
  client could see (409s, and clean ends of stream, which is how workerd
  delivers an errored body: workerd #6818); the hub now logs each stream's end
  with its cause to tell them apart. One `1101` was an uncaught `stub.fetch`
  exception in the Worker, a minute after a deploy. The fix, at each place
  the reset was decided: the instance holding a stream asks every second
  which instance its own id reaches and ends the stream once it is another;
  a closed stream's lease holds the machine online for a grace of one
  heartbeat, a `subscribe` or a new RPC in the grace waits for the next
  stream (stored as generation 0 of its route or record, a new value in an
  existing column, no new table, column or key); the Worker answers an
  object's exception as JSON; and the web keeps what a subscription drew
  through any disruption, merges the fresh snapshot into it, and says
  nothing about a gap shorter than the same 15 s. Rejected then: persisting
  the stream's state so a successor could serve it (an SSE stream is a
  request of the old instance, and no successor can write to it); moving the
  machine's link to hibernatable WebSockets, which survive an eviction but
  not a code update and change DX2 and the uplink (deferred: the uplink is
  frozen for the org directory); a 30 s gap as #57 proposed, longer than
  every measured reconnect needs and a closed machine reading online that
  much longer.
  Date/Author: 2026-10-18, MAWS #57's executor.
  2026-10-18, the design session: shipped as MAWS #58 (hub), #61 (web) and
  doperpowers #246 (DX4's chunk `t`), deployed together as `hub@0e6c2d41
  web@master.0e6c2d41`. With them, Workers Logs went on with per-request
  logs off (MAWS #60, the owner's choice), so the hub's stream-cause lines
  are kept. The web's own share, measured in CI against the DX3 double: a
  session view's first rows 142 ms after subscribe; an owner message's row
  57 ms; a session's `<message>` drawn 36 ms after it is logged; a raised
  question 23 ms. The budgets proposed for the deployment, p95 end to end:
  an owner message reaches its session within 1 s; a session's message or
  request is drawn within 2 s; first rows within 1.5 s; a streaming chunk
  within 500 ms. Each is confirmed with the web's latency readout
  (`?latency`, `window.deskLatency()`). Left for after the org directory
  lands: fewer uplink restarts on a plugin roll (restart on the uplink's own
  modules' content, not every script's; or start the new uplink before the
  old one leaves), and the 60 s restart gaps a 15 s grace cannot hide.
- Decision: An open async question counts in the badge and the grid's
  `waiting` until it is answered; the session's state word stays what it
  is, busy while it works (owner, 2026-10-18). Before it the count read
  presence alone, which never says waiting for a non-blocking ask, so a
  push after a question could carry 0 and clear the badge; #59 counted the
  question in its own push only. Both kinds of async ask count alike: the
  ask mod's, raised by a bridge (`async`) and logged, and MAWS's
  `mcp__maws__ask`, which exists in the log alone. An ask is open while a
  bridge holds it raised, or while the log holds its `question` with no
  `answered` of the same `src` from the session and no `retired` of the
  session since, unless the plane settled it; the count is of sessions, so
  one ask learned both ways counts once (DX3's grid). A log question counts
  only while its session's process lives: a session whose kept presence
  says `record: null` (a stopped seat, which never retires, so the log
  holds its ask open) is not counted for it, and counts again once it
  runs, as a bridge's ask is withdrawn when its process ends; the web
  reads it the same way and keeps such a session under ended, where the
  phone's Resume bar and the tail's end marker are. The hub keeps the
  log's side in `open_questions` (session, ask; machine), maintained in the
  transaction that stores each event, so a backlog's events apply in each
  feed's order; the protocol's `questionEffect` is the one reading of an
  event, shared by the hub and the web, whose sidebar puts such a session
  under waiting on you as a pending request does. Not backfilled: of the
  asks open at the deploy, a bridge's counts from the pending set anyway,
  and a log-only one (MAWS's ask, exported since doperpowers 7.182.0 the
  same day) goes uncounted until it is answered; reading every stored body
  in each project's first wake would count that one, and with it every
  older ask whose end the log does not hold, for as long as its session is
  not retired. Rejected: counting asks per request rather than per session
  (the count has always been of sessions); a settlement deleting the log's
  row in place of the count's check (a withdrawn ask's event can reach the
  hub after its settlement, on the other plane, and would open it again).
  Bounds: a settlement is kept a month (`settled`), so a bridge's ask
  withdrawn with no `answered` or `retired` counts again after a month if
  its session runs that long (a stopped one's is not counted; tracked in
  `docs/tech-debt-tracker.md`); and
  an ask a `retired` closed stays closed though a resumed session's ask mod
  reads it back from its transcript (a bridge raises it again, and it
  counts from the pending set).
  Date/Author: 2026-10-18, the owner's ruling; built by the delegated
  executor.
- Decision: A settlement is taken once per raise, not once per request
  (MAWS #65; DX4 `settled` amended, which flags DC7, its producer, and DC3
  and DC9, its consumers). A resumed session's bridge raises its
  still-open async ask again under the call's id, which the first
  process's end had settled (`withdrawn`). The answer's `settled` was then
  dropped twice: by the daemon, on its ledger of settlements the hub took,
  and by the hub at `markSettled`. The request stayed pending, and with
  the open-question count above, its session stayed in `waiting` and the
  badge, until the uplink's next reconnect sent a complete set. Now the
  daemon keys that ledger by the settlement (its request and the bridge's
  `t` stamp) rather than by the request; passes by a snapshot's settlement
  of a request the same snapshot lists pending, since it came before that
  raise; and never sends a settlement after a later raise of the same
  request, a raise dropping from its outbox any settlement of that request
  still unsent. The hub settles a request that is pending again though its
  id is marked settled, and still takes a resend for a request no longer
  pending without a second broadcast or decision. The daemon's order is
  what makes the hub's reading of the pending set sound: a `settled` that
  finds its request pending is of that raise, never an earlier one sent
  again. No storage change: the hub reads the `settled` table and the
  pending set as they are. Built as doperpowers 7.188.2
  (`sminos_requests.py`) and the hub's `settled` (`project.ts`); this
  closes the tech-debt tracker's row for it. Accepted: a daemon older than
  7.188.2 keeps no such order, and the hub settles a raise with a
  withdrawal such a daemon sends again after that raise reached the hub.
  When its outbox gathers both while the machine is offline, and the POST
  that carries the withdrawal and the set holding the raise is applied but
  its answer lost, the next stream opens with the withdrawal again, ahead
  of the set: `waiting` and the badge dip until that set raises the
  request again, and the audit record keeps a spurious `withdrawn`
  decision. It takes a settlement sent again (a lost answer, or a restart
  before the daemon recorded it), and the window closes on each machine as
  the plugin roll brings it to 7.188.2. The web draws a request raised
  again with its earlier settlement, and no answer control, in every tab:
  one open since that settlement, and one opened later while its decision
  is among the 100 audit records each connection replays (a new tracker
  row, DC9's). Rejected: clearing the `settled` mark at each raise (a
  raise settles nothing, and the mark also answers the count's
  `isSettled`); a generation number on `raised` and `settled` (a contract
  change for both producers, for a case the pending set tells apart given
  the daemon's order, and the nonce below would without it); for now,
  keeping each settlement's `mac.nonce` with its mark, so the hub knows a
  resend by its nonce whatever the pending set holds (it would close the
  old daemon's window, but it is a new column on `settled`, a Durable
  Object storage change, which goes to the owner).
  Date/Author: 2026-10-19, MAWS #65's executor; revised after its review.
- Decision: The web draws a request raised again after its settlement as
  pending, with its answer control, until a settlement of that raise
  (MAWS #71; DX3 amended, a raise against a settlement, for DC9 and DC5).
  Before, the web kept a request's latest settlement and drew it settled
  whatever came after, and every connection takes the last 100 audit
  records again at `caught-up`, so no tab could answer a resumed session's
  re-raised ask while the hub counted it in `waiting` and the badge. The
  order is the one the hub already sends on each socket, so nothing new
  crosses the wire: a `raised`, or a `pending` set holding the request,
  ends the settlement the web holds for it, and a `decided` for a request
  the latest `pending` set holds is passed over. The tab's own RPCs on the
  raise that settlement ended stop drawing the card (a late decision's
  refusal on it would otherwise draw it settled). Built in
  `apps/desk-web/src/project/conversation.ts`; this closes the tech-debt
  tracker's DC9 row for it. Accepted: a request raised again and then
  dropped by a machine's republished set, with no settlement, reads
  `closed` in a tab that saw it live, and in a tab that connects later
  reads with the earlier settlement the replay carries; neither is
  answerable, as the hub no longer holds it. Rejected: ordering by the
  audit record's `id` or `at` (a `raised` carries neither, and the
  socket's order already gives the answer).
  Date/Author: 2026-10-19, MAWS #71's executor.
- Decision: The design session deploys desk builds of MAWS master to the `ssfskim` Worker without asking each time:
  the two-Mac walk's Part F redeploy and the fixes the walk turns up. Every deploy goes through the scripted
  `deployment deploy`, and the owner is told the build's `X-Desk-Build` each time. A migration, a change to Access, or
  a secret put or rotated still waits for the owner. The two Macs enroll as `macbook` and `mini`, the walk sheet's
  names. Rejected: the owner approving each deploy in the moment (Part F's redeploy is timed against running
  traffic, and the earlier deploys rested on the plan's M5 rather than a direct confirmation, which the deploy
  tooling flagged).
  Date/Author: 2026-10-16, owner ruling.
- Decision: A removal whose answer from the machine's object is lost is finished by the admin's Remove again, with
  nothing persisted for it in Phase 1. The object fences the credential before it answers and answers a second
  revocation of a fenced credential as it did the first, so the retried DELETE completes (pinned by a test, MAWS #20);
  until then the machine stays listed and its daemon is refused. A removal re-reads the name by enrollment after the
  object answers and touches nothing when that enrollment no longer holds it, so a removal racing another removal and
  a re-enrollment leaves the new machine alone. Rejected: a persisted revocation intent with a sweep that finishes it
  (self-healing, but a second retry machine beside the projects' lease one for a state the admin sees and clears in
  one click); kept in the backlog.
  Date/Author: 2026-10-16, design session (PR #20's review).
- Decision: Acceptance 8 is checked on the deployment with a browser-console snippet for two attacks, a forged
  `human` and a forged RPC to a live session, each with a wrong code. The machine-side suites are the evidence for
  the other three (a `say` under another machine's writer, an Allow whose card digest does not match, a spawn into
  a directory that is not a known checkout). A forged RPC's refusal is evidenced by the refusing daemon's log line
  and the `rpc-state` the snippet prints, not by the web. As built, the web ignores `rpc-state` for a nonce it did
  not send, and the hub neither audits a daemon's RPC refusal nor keeps an `rpc-result` for a nonce it has no record
  of, so "the refusal shows in the web" cannot hold for an RPC the hub forged; drawing those refusals is backlog.
  Nothing deployable could place events at the hub without the org key: the proof commands refuse the real org, and
  an RPC is never stored. Rejected: hand-editing the walk project's Durable Object storage through Cloudflare's Data
  Studio (literal, but a hand-written row in production storage, and a misplaced one stops a writer's uploads); a
  test route or a second Worker bound to the hub's classes (a standing production write path); relying on the
  suites alone (the two live attacks are the cheapest proof that the deployed path refuses).
  Date/Author: 2026-10-16, owner ruling (the walk's preparation).
- Decision: MAWS's recomposition panel is the three children's own xhigh panels. DC3's, DC5's and DC6's ran over
  their own ranges, each landing on master after the one before it (DC5's on top of DC3's hub, DC6's on top of
  both), so every MAWS line of Phase 1 was read by a panel, and the seams between them were read from the later
  child's side and exercised by the real-hub suite. The doperpowers repository's panel ran once over DC2, DC4 and
  DC7's merged range, as planned, and its eight fixes landed (doperpowers #201). Rejected: a second MAWS panel over
  the merged range (master moved with unrelated work in between, so the range would mostly be other initiatives',
  and every desk line in it has had a panel).
  Date/Author: 2026-10-16, design session.
- Decision: An admin removes a machine from the web's Machines dialog (MAWS #17). DX7 specified
  `DELETE /api/machines/<name>` and the hub served it, but no child's web scope named the action, so after the walk
  the owner had no way to remove its stand-in machine. Removal is a full confirmation step, because what it means
  needs more than a row holds: the machine is disconnected and its credential deleted, it keeps the org key it was
  enrolled with, and it needs a new code to return. It asks for no key method, since the hub treats removal as a
  member's admin action, not a key operation. A non-admin is told an admin does it. Rejected: typing the machine's
  name to confirm (heavier than an owner-only org needs); inline confirmation on the row (too little room for the
  consequences).
  Date/Author: 2026-10-16, design session (the owner found the gap).
- Decision: §8 unknown 4 is resolved and holds as designed: the owner's walk on the deployment proved PRF unlock
  with an iCloud Keychain passkey on the Mac (Safari, Chrome) and in the iOS home-screen app, Access carried into the
  standalone app, a passphrase unlock of about 3 s on both devices, a push in about 5 s landing on its request card,
  and (P2.11) a push tapped 23 hours after the phone's last session opening signed in, on the card, with the key
  still unlocked. Nothing in §4–§7 changes. Rejected: re-walking P2.11 on the new build (the deploy it waited for
  changes the web app, not Access's session or the stored key, which are what the step measured).
  Date/Author: 2026-10-16, owner's walk (DC5's P1–P2).
- Decision: The channel follows its tail as a `column-reverse` scroller with the browser's own scroll anchoring (DC5).
  The list keeps its chronological DOM, keyboard and accessibility order inside a reversed container, so the bottom
  is the scroll origin: opening at the tail needs no code, and a reader scrolled back keeps their place through
  growth, collapse and removal above them and a message arriving below. The only scroll code left is a
  notification's landing. Three hand-rolled passes came first, and each review found the next case the browser
  already handles: a scroll event arriving a frame after the row it raced (installed Chrome on the Mac lane, never
  headless Chromium), growth above the reader (native anchoring moved `scrollTop` and read as a return to the
  tail), shrink above (the browser clamps before the hook runs), growth inside the one long row being read, and an
  unreported scroll-up landing with a collapse. Every one of those is now a browser regression. Safari has scroll
  anchoring only from 27.0, and the owner's phone is on iOS 26 or older, so an engine without it gets a fallback
  (MAWS #16, `4c70f5c8`): feature-detected by `overflow-anchor` (WebKit gates the property and the anchoring on one
  setting), active only while the reader is off the tail, it keeps the row at the top of their view in place when the
  list changes size below them. Playwright's WebKit has the anchoring setting on, which is why it held the row; with
  anchoring forced off it shows the phone's one-row jump, and the fallback's browser case proves the hold in Chromium
  and WebKit. A reader less than a shrink's height from the oldest edge still moves (tech debt), and whether setting
  the scroll position cuts an iOS flick short is for the walk. Rejected: a fourth hand-rolled pass (it was rebuilding scroll anchoring case by
  case); a follow-output component (none fit the stack without a heavy dependency). DC6's transcript and subagent
  panes are unaffected: they follow through MAWS's virtualized `Transcript` list, the desktop app's own chat-mode
  follow, and hand-roll only the paging of older rows.
  Date/Author: 2026-10-16, design session (DC5's Mac lane).
- Decision: The real-hub suite bounds a machine's offline step by the local close latency DX2 states, the configured
  heartbeat plus 500 ms; busy, waiting and shell keep 2 s. On the Mac mini (run 38889971966) offline came at
  2,309 ms against the local command's 2 s heartbeat, because workerd sees `wrangler dev`'s graceful close only at
  the next heartbeat write; the MacBook's earlier 1,344 ms was a drop that landed just before one. Acceptance 1's
  2 s holds for offline on the deployed hub, where the edge cancels into workerd at once, and the walk proves it
  there. The suite is the gate group `e2e:desk-web-hub` on the Mac mini, where MAWS's e2e groups now run (the
  gate-offload plan §3.5–3.6). Rejected: a shorter local heartbeat (DC3's to set, and nothing needs it); keeping
  the MacBook pass at `3de8a15e` (it predates the panel's fixes to resume and routing, and passed by timing).
  Date/Author: 2026-10-16, design session (DC5).
  Amended 2026-10-20: the bound is two configured heartbeats plus 500 ms. Since MAWS #57 (merged as #58, 2026-10-18)
  a closed stream's lease holds the machine online for a grace of one heartbeat, so the machine reads offline once the
  close is seen (within one heartbeat locally) and the grace has run: 3,815 to 3,861 ms on the MacBook against the old
  2,500 ms bound, which failed at #58's merge and on every master after it, unseen, since the suite runs in no default
  gate set. The same grace means a dropped machine reads offline on the deployed hub after 15 s, not within the 2 s this
  entry claimed for acceptance 1; #57 chose that over a flap at every reconnect, and acceptance 1's reading of it is
  the owner's.
  Ruled 2026-10-21 by the owner: acceptance 1 reads a dropped machine as offline within two heartbeats, about 15 s on
  the deployed hub, and the grace stays, so the hub's routine stream ends (every 23–96 minutes) never flash a machine
  offline. Acceptance 1's text says so. Rejected: back to 2 s (a 1–16 s offline flash at every reconnect); two speeds,
  a clean close at once and only a drop graced (the hub would first have to tell the two apart; not needed now).
- Decision: The web names a session by its title (§4): the harness's "Session name" (`/rename`'s `custom-title`,
  else the generated `ai-title`), carried through the log as sminos's `titled` (smns §3, §5, §8), which the session's
  machine writes into its file when the value changes. The owner, working a day from the desk, could not tell sessions
  apart as "maws-4d @macbook"; they know that one as "cua_repl". A sidebar row takes the owner's layout: the title
  truncated to fit, then `@machine` and whether the machine is online, and under it the alias, muted, because `@alias`
  is still how the composer addresses it; a session with no title keeps its one line. The direct channel's and the
  depth column's headers follow it; a message's author and a request card, one line each, name it by the title with
  the alias muted beside `@machine`; `@` completion finds a member by its title too and inserts the alias's tag.
  Lifecycle system lines and delivery outcomes keep the alias: they record what was addressed. Rejected: carrying the
  title in session presence (DX4), which an ended session and an offline
  machine's sessions do not have; a field on `renamed` or a new `in-charge` source, which this projection would read
  as an alias or an in-charge line. Older readers pass over the new kind, and the hub verifies any kind.
  Date/Author: 2026-10-17, the desk's session-title change (owner's request; the delegating session's design).
- Decision: A Linux machine is a desk machine, built alongside Phase 1 (Arkho #85): `sminos daemon install`
  writes a systemd user service on Linux (restart on new code, lingering for a machine without a login session),
  and the process-identity check holds on Linux, where `ps -o lstart` reads up to a second early. The owner asked
  whether the daemon assumed Linux; nothing in smns §8 or here planned it, though the desk exists to control
  projects wherever their sessions run, the owner's cloud Linux machines included. The hub and the web are
  already OS-neutral (DX2 is HTTP and SSE), so the gap is the machine side alone. Proven on a throwaway Ubuntu VM
  against a local hub, never by enrolling it into `ssfskim`. Phase 1's acceptance stays the two Macs and the
  phone. Rejected: making a Linux machine part of Phase 1's acceptance (it would gate the close on a machine the
  owner does not yet run); deferring it past Phase 1 (the gap is small and independent of the walk).
  Date/Author: 2026-10-15, owner ruling (design session).
- Decision: A manual compaction's rows are named from the transcript (DX5, Arkho #78). The live engine (2.1.301)
  raises no `session.append` for any manual compaction's rows, the person's typed `/compact` included, not only a
  plugin's own; an automatic compaction's rows it raises. A compaction's result carries each message's `handle`,
  which is the row's uuid, so the mod waits for the summary row on disk and names what lies past its cut before
  anything later. The reload line was never unnamed (it passes `session.append`, door `notice`). Rejected: asking
  upstream for `session.append` on a plugin's own writes (it would not cover a typed `/compact`); accepting the 2 s
  stall per compaction. Flags DC4 (the uplink's ordering is unchanged), DC6, DC7.
  Date/Author: 2026-10-15, design session (Arkho #78, doperpowers #202).
- Decision: A steer's trace for reconciling a lost outcome is the mod's answer, kept by the bridge child under the
  RPC's nonce, not a transcript row (DX6). The recomposition panel (scalpel-2#2) found no reliable link from a
  transcript row to the claim that caused it. Rejected: answering every orphaned steer `interrupted`, which would
  call a steer that landed (DC7's G2 restart test) a failure. Interrupt, model, and compact could reconcile the same
  way (doperpowers TECH-DEBT backlog). Built in doperpowers #201 (7.157.4), with the Resume copy check and the
  never-kept claim answered `interrupted` at once. Flags DC7.
  Date/Author: 2026-10-15, design session (the recomposition panel's fix wave).
- Decision: A `resume` page is counted in frames, not bytes (DX3), and a receiver's open part sets are bounded
  in count and id length as well as bytes (DX2, DX3). As built, a page is four `log` frames of about 256 KiB, so
  about 1 MiB, and up to about 4 MiB when its events approach the 1 MiB event bound. Rejected: a byte cap per page
  (an event alone may be 1 MiB, so a cap still sends near-1 MiB pages, and holding to it exactly would split events
  for no bound the four-frame page lacks). The part-set count (64) and id length (128) close the panel's finding
  that sets with empty data piled up metadata past the byte budget. Flags DC3, DC5.
  Date/Author: 2026-10-15, design session (DC3's panel wave, as built).
- Decision: A browser's `resume` is paged by the browser (DX3): a page of about 1 MiB, then `more {offset}`
  when events remain, and the browser resumes from there; live frames start at `caught-up`. DC3's xhigh panel
  (scalpel-5#3) found the hello backlog and a browser's resume suffix enqueued whole; the hello backlog is now
  paged inside the machine's send queue, but a hibernatable WebSocket gives the hub no send settlement to pace
  pages against. Rejected: an unbounded suffix (a long-lived project's first open on the phone buffers its whole
  log at once); pacing on send settlement (none exists). Flags DC3, DC5.
  Date/Author: 2026-10-15, design session (DC3's panel wave).
- Decision: The heartbeat is configuration and a close's latency is stated per runtime (DX2). DC5's real-hub
  suite saw a dropped machine go offline only after about 30 s against the local command. DC3 measured why:
  workerd notices a peer's graceful close (FIN) on a streaming response only when a later write fails, and an
  abrupt one (RST) at once; `wrangler dev` puts its own proxy between the Access stand-in and the hub and closes
  its hop gracefully. Nothing in the hub's chain lost the close: once the abort fired, the project, the browsers'
  offline view, the `uncertain` RPC and the grid summary followed within 25 ms. Deployed, the edge cancels into
  workerd directly (M1's live probe saw the abort at the client's instant). So: the stand-in proxy resets its
  upstream when its client leaves, `HEARTBEAT_MS` is a variable (unset deployed, 15 s with a 45 s lease; 2 s
  under the local command), and a regression test pins drop → offline → `uncertain` → grid within a stated
  bound. Rejected: running the local command on Miniflare directly (immediate close, but it loses wrangler's
  asset watching and reload); a hub-side workaround for a close only the local hop hides. Flags DC3, DC5.
  Date/Author: 2026-10-15, design session (DC3, DC5's Task 6).
- Decision: DC3's G6 is closed and §8 unknown 3 resolved without a
  per-session object (DC3's M5): the session plane stays on one object per
  project, its threshold 1,900 relayed messages/s (chunks/s × subscribed
  browsers), half the measured limit, after a POST's frames for one project
  went to it in one call (`ebde4565`; no shape changed). The phase-1
  budget (one session at 150 chunks/s, 1–3 browsers) met its log-plane
  bound in every step and chunk p95 ≤ 1 s in four of six; the two misses
  are accepted as explained, not re-measured now: the first began two
  minutes after the batched deploy, inside the window in which objects ran
  the per-frame code (which measured p95 3.8 s at that load), and in the
  second the other machine's presence and log events slowed fourfold in
  the same step, pointing at the measuring client, not the chunk path. A
  re-measure needs the Worker under a test org, which would now mean
  switching the owner's org out; it waits for a staging deployment
  (Deferred). The shared per-session stream stays in the backlog.
  Rejected: one object per session (moves CPU that was a quarter of a
  core and leaves the binding limit, the machine's serial uplink, as it
  was); building the shared stream now (a DX4 change, and the budget is
  met on throughput by a factor of about 25). Flags DC3.
  Date/Author: 2026-10-15, design session (DC3's M5).
- Decision: A refused POST means reconnect (DX2), and §2's deploy line
  is corrected to what DC3's M5 measured: a deploy leaves connected objects
  on the old version for about five minutes, and then a machine's stream
  can beat on from the old instance while every POST is refused
  `stale-generation`. A daemon reconnects on `409 stale-generation` or
  `503 delivery-failed` from any POST, an `hb-ack`'s included; DC4's
  merged uplink already does (any POST not answered 200 ends its stream),
  and DC3's fake machine does since `ea5ae36a`. The hub forces no cut in
  phase 1. The org takes its configured identity while nothing was built
  on a stored one (DX7, `85e83830`), and every answer names its build in
  `X-Desk-Build` so anyone can see what is deployed. Rejected: a forced
  cut from inside the hub (an object cannot reach the old instance holding
  a stream); a deploy script that ends every stream (only needed for a
  change that must take effect at once; noted in §2, not built). Flags
  DC3, DC4, DC5.
  Date/Author: 2026-10-15, design session (DC3's M5).
- Decision: Resume restores a session that ended, never one that was
  retired (DC7's M4): a retired session's Resume is refused `unsupported`,
  and its channel keeps its history with no Resume, naming who retired it.
  Retiring is the owner's deliberate act of taking a session out of the
  project. Reversible by the owner. Rejected: Resume as an un-retire,
  which would make Retire a pause. Flags DC5, DC7.
  Date/Author: 2026-10-15, design session (DC7's M4).
- Decision: A raised request names the transcript call it belongs to
  (`toolUseId`, DX4 and DX5), where that differs from `request`. The ask
  mod's blocking question, the way every interactive session asks, is
  raised by the bridge under the id of the engine dialog the mod opens
  inside its own `mcp__doperpowers__AskUserQuestion` call; no transcript
  row carries that id, so the web could neither bound a working-record
  fold by the question nor tie its card to its row (DC6's M3, from DC3's
  real recording: `toolu_plugin_…` raised, `toolu_01…` in the
  transcript). The bridge already pairs the two, since the raised input
  is the outer call's; it now says so, and stops posting the dialog's own
  `tool/call` and `tool/result`, which name a call no row holds.
  `request` stays the id a decision answers. Rejected: raising under the
  outer call's id and translating inside the bridge, which changes what
  every settlement names; and matching by timing or question text in the
  browser. Flags DC3 (the hub keeps and relays `toolUseId`), DC5 (bounds
  and cards use `toolUseId ?? request`), DC6, DC7 (the bridge and the
  relay).
  Date/Author: 2026-10-15, design session (DC6's M3).
- Decision: The real org is `ssfskim` (display name `SSFSKIM`), and its
  admin, the one email Access allows, is supremekim17@gmail.com (owner,
  2026-10-15). The id is written into every hub project's `.smns` and
  every machine's service-token name, so it is fixed once a machine
  enrolls. The hub is deployed at
  `desk-hub.opencognita-platform.workers.dev` behind Access (team
  `flat-wave-208c`); M5's proofs run under a throwaway org on the same
  deployment, and the deployment is left with the real org and nothing
  enrolled, so the owner sets the org key first. Rejected: `opencognita`,
  after the Cloudflare account's subdomain. Flags DC3 (M5).
  Date/Author: 2026-10-15, owner.
- Decision: DC3's fake machine folded as its own Interfaces section
  (MAWS `.doperpowers/sde/2026-10-15-desk-dc3-hub/
  interfaces-M4-reviewed-c100ed17.md`, M4 reviewed clean and ticked at
  `3b7c4315`), with DX2's `rpc-result` pass-through of a late decision's
  fields (item 3; items 1 and 2 were folded at `bb8b8773` and
  `21c32db7`). The recording is a real throwaway session through DC2's
  bridge, with a synthesized peer session and two delivery outcomes,
  since the real one had no outside-origin event. A decision's `settled`
  reaches the browser before the RPC's `done`, and a spawn's `joined`, a
  retire's `retired` and the presence change before their results.
  Rejected: keeping the fake's API only in DC3's working files, which
  DC5 and DC6 test against and recomposition must read. Flags DC5, DC6.
  Date/Author: 2026-10-15, design session (DC3's M4).
- Decision: A decision that does not fit its request is `bad-shape`,
  refused by the daemon before the claim (DC3's M4 fake machine, DC7's
  M3). The daemon's digest check already reads the pending request from
  the bridge, its input and whether it is async, so it applies the
  bridge's own rule there and a misfit never reaches the ledger; the
  bridge's 400 stays as a backstop and maps to `bad-shape` as well. DX6
  lists `bad-shape` among the daemon's codes, which its shape check
  already used. Rejected: `unsupported`, which says the session's kind
  cannot, and `failed` carrying the bridge's text after a claim. Flags DC3
  (the fake answers `bad-shape` before the claim), DC5 (no card offers a
  misfit, but a test must not pin `unsupported`), DC7.
  Date/Author: 2026-10-15, design session (DC3's M4, DC7's M3).
- Decision: Three DX6 rulings from DC7's M3. A steer to a session with no
  bridge answers `{row: null}`, since a `--bg` seat's `reply` and a send
  append no row the machine can name. Spawn and retire record the RPC's
  `member` as `by`, as acceptance 7 asks, not sminos's operator `""`: the
  RPC is signed by that member. The who-won fields may also come from the
  daemon's digest check, which reads the bridge's own `settled` record
  for a request already settled; that is where the common case is
  caught, and it is the same source as the 409. Rejected: a steer result
  without `row` for that path, and the operator as `by`. Flags DC5 (a
  steer's `row` can be null), DC7.
  Date/Author: 2026-10-15, design session (DC7's M3).
- Decision: A refused decision says who won, as fields (DC3's M4,
  MAWS `c547aaa5`). DX6's failed outcome gains `winner?`, `by?` and
  `terminalOnly?` beside `code` and `message`, so the web's card shows
  "answered by …" without parsing a message or waiting for the
  request's `settled`. DX5's two 409s that name the first answerer only
  in their text gain it as fields: `by` on "already answered by", and
  `winner: "terminal", by: "terminal"` on "the terminal answered it".
  That is an additive change to the bridge (`sminos_bridge.py`'s
  `decide`), which DC7 makes, since it maps these 409s to DX6.
  Rejected: DC7 parsing `by` out of the error text, and leaving the card
  to wait for `settled`, which arrives on another path and may be late.
  Flags DC3 (the hub's shape check admits the fields), DC5 (the card
  reads `failure.by`; `protocol-ahead.ts` goes), DC7 (the bridge's 409s
  and the mapping).
  Date/Author: 2026-10-15, design session (DC3's M4).
- Decision: DX5 final from DC2's close (PR #195, plan `0afc902f`). The
  whole-branch review's two fix waves add: a main turn the module never
  saw start (a reload mid-turn) is taken back from its next request as a
  `turn` start with `recovered: true` and `text: null`; `resync` carries
  `sessionInfo`, so a child whose first post was lost still knows the
  session; the child's hello carries `presence`; and until the mod knows
  whether a main turn runs, `steer`, `interrupt` and `compact` are refused
  with "turn state unknown since the bridge reloaded", `ping` and the
  heartbeat say `isTurnUnknown`, and the verbs exit 1 with that reason
  (before, interrupt answered a false idle). `decide`, `answer` and
  `compact` retry a not-ready 503 within their first snapshot's 8 s.
  Rejected: guessing idle after a reload, which let an interrupt report
  success on a running turn. Flags DC6 (a recovered turn start has no
  text), DC7 (the refusal is a machine-side RPC failure; the retry window).
  Date/Author: 2026-10-15, design session (DC2's close).
- Decision: DC2, DC4 and DC7 take their branch reviews at `high`, run by
  their own controllers, and the doperpowers repository's xhigh panel
  runs once, at recomposition, over their merged range. Their branches
  stack (DC4 is built on DC2's tip, DC7 on DC4's), so a panel per child
  would review the same commits two or three times, and a panel runs only
  from the main session, which would serialize three children behind it.
  DC3 and DC5 keep their xhigh panels, handed up. Rejected: an xhigh panel
  per doperpowers child before its merge. Amends the verification entry.
  Date/Author: 2026-10-15, design session (DC4's completion).
- Decision: Three hub changes from DC5's M4 (the phone). Visibility
  expires: a visible socket repeats its `visibility` every 30 s and counts
  as visible for 90 s after the last, because a phone that sleeps before
  its hidden frame reaches the hub would otherwise hold back that
  member's pushes until the socket closed. `PushNotice` gains `name`, so
  a notification says which project. The manifest and icons get an Access
  bypass at deployment, since iOS fetches them without the Access cookie
  and a home-screen icon would otherwise be a screenshot. Rejected: the
  hub pinging sockets (a hibernated object would wake for every visible
  tab), and inferring the project from the alias. Flags DC3 (M4 and M5),
  DC5.
  Date/Author: 2026-10-15, design session (DC5's M4).
- Decision: The phone as DC5's mockup `05-phone.html` draws it (owner,
  2026-10-15, every recommendation taken). The phone is a stack (Projects,
  a project, a channel, one full screen each, each with its own back);
  a project opens on its session list, waiting first; the grid keeps card
  B in two columns; a direct channel keeps Steer, Send and Interrupt in
  reach and Model and Compact under More; depth and starting a session
  stay on a computer in phase 1. A notification opens the session's
  direct channel with its card lit. The app icon carries the org's
  waiting count, so DX7's `PushNotice` gains `waiting`. The installed
  app's "Keep unlocked on this device" starts checked. Rejected: the
  project opening on its group chat (B), a group-chat landing for
  notifications, no badge, and an unchecked default. Flags DC3
  (`PushNotice.waiting`), DC5.
  Date/Author: 2026-10-15, owner.
- Decision: DX2, DX3, DX4, DX6 and DX7 replaced whole by DC3's M3
  interfaces (MAWS `.doperpowers/sde/2026-10-15-desk-dc3-hub/
  interfaces-M3-reviewed-a190a6d8.md`, 22 items, reviewed clean at
  `a190a6d8` and checked against this file at `ceb34bd4`, with
  `f5a2046b` landed as its item 22). Beyond the amendments folded here as
  they arose, M3 settles: the audit record gains the `decided` frame (a
  `settled` verbatim with the `raised` it settled, so the web can check
  who decided what); `rpc-state` goes to every socket of the issuing
  member, and the hub's at-once refusals are not recorded, so a retry is
  judged afresh; `deliveries` is always sent on connect; a lapsed lease
  withholds its sessions' presence; the lease is 45 s, and a renewal of
  the same generation after a lapse brings the machine back without its
  subscriptions; at most 32 subs per socket; an unknown frame up is
  refused; `raised.deadline` is ISO 8601 UTC with milliseconds (DC7
  converts DX5's epoch ms); Web Push with `VAPID_KEY`, its endpoints and
  `PushNotice`; the grid's counts defined. Rejected: folding the items
  one by one, which the wholesale replacement makes exact, since DC3
  checked each section against this file. Flags DC4, DC5, DC6, DC7.
  Date/Author: 2026-10-15, design session (DC3's M3).
- Decision: DX5 refreshed with DC2's M4 extension (doperpowers
  `89c9f8da`, reviewed clean after two fix waves, `1d55316f` and
  `f0242560`). It carries what the ordering decisions above agreed, as
  built: notices after the append resolves, released in disk order (a
  row's own notice, a later row's notice in its loop, or 2 s after it was
  first seen on disk, so rows written together come out together); each
  loop's cut seeded from the transcript tail at the module's first hello
  for loops older than the module, with requests begun before it never
  streaming and their rows named by `row-seen`; the step-end hold, after
  which a step's pairing is closed, so no `block-row` follows its step's
  end; and a readiness hold: `GET /events` serves no snapshot until the
  mod's first resync to that child is applied, 503 after 5 s, so no
  snapshot is ever taken against an unseeded cut. The DX4 browser rule
  for a late `block-row` becomes moot and is restated. Flags DC6, DC7
  (the real-child proof of M1 runs on this text).
  Date/Author: 2026-10-15, design session (DC2's M4).
- Decision: Omitted thinking draws as a live label that goes when its
  row settles (DC6's M1 fix wave). The step-end decision asked live
  thinking to match its settled drawing; the settled drawing turns out to
  be nothing, since MAWS's renderer draws no row for a thinking block
  without text (`derive.ts`), so depth shows the label while the model
  thinks and it goes when the row lands, as a progress mark does. No text
  ever vanishes, which is what the earlier decision guarded against.
  Rejected: a lasting "thought" row, which needs a change to MAWS's
  renderer this phase does not cut; and nothing live, which leaves a long
  think looking like a stalled session. Flags DC6.
  Date/Author: 2026-10-15, design session (DC6's M1).
- Decision: Three DX4 amendments from DC7's M2. (1) A message to a closed
  terminal session is reported `recorded` without being settled: it stays
  owed, as smns §4 already keeps it, and is delivered if Resume brings the
  session back, its outcome then turning `delivered` under the same key
  (the hub keeps the latest). This is the design's own reading of
  acceptance 7 and §4 ("follows smns §4 as built"), not a new product
  call. Rejected: settling it as `recorded`, which would make Resume drop
  what the owner sent while the session was closed. (2) `delivery.outcome`
  gains `uncertain`, for a push whose frame was taken and never answered.
  Rejected: `delivered` with an "uncertain:" reason, which shows the web a
  certainty the daemon does not have; RPCs already carry `uncertain` for
  the same case. (3) `raised` gains optional `agentId` and `truncated`,
  as DX5's `raised` carries them, so the web can say which subagent asks
  and that the input shown was capped; the code covers every field, so
  binding is unchanged. Flags DC3 (admits the new value and fields), DC5
  (draws them), DC6, DC7.
  Date/Author: 2026-10-15, design session (DC7's M2).
- Decision: The `transcript` slot draws one fold of a direct channel's
  working record, bounded by `range: {from, to}` (DC5's M3, DC6's M1).
  The channel shows what a session sent its human; the working record
  between two of those items folds behind a button, and unfolding one
  fold must draw that stretch and nothing the channel already shows. The
  bounds are the exchange items' own `src` (a span's row uuid and index,
  or a question's call id), exclusive, at span granularity, because one
  transcript row can hold both a marked span the channel draws and
  unmarked text the fold draws; the slot draws through the to-human
  Presenter so a fold reads like the terminal's `[ working record ]`.
  Rejected: bounds by row uuid, which either repeats a message the
  channel shows or loses the text beside it; and the shell trimming the
  slot's output, which would need the shell to parse transcripts. Flags
  DC6.
  Date/Author: 2026-10-15, design session (DC5's M3).
- Decision: The grid socket sends `part` frames down (DC3's M3 review).
  The Registry sent every project's summary in one `grid` value, which an
  org with enough projects pushes past the 1 MiB frame bound; it now
  slices a large `grid` into DX2 `part` frames, as the project socket
  already does. Rejected: paging the grid, which adds a request the
  browser must make before it can draw anything. Flags DC5 (the grid
  receiver reassembles parts).
  Date/Author: 2026-10-15, design session (DC3's M3 review).
- Decision: DC2's live walk of M4 settles the facts the step-end and
  thinking decisions waited on (2.1.300, a terminal session and a `--bg`
  job, load average about 220). A response row can be appended after its
  step's `turn.step` resolves (a withheld refusal or max-output row, the
  tail closing an open block, a hook answering without a request), so the
  bridge holds a step's `step end` until the step's `block-row` notices
  are posted: at most 1 s, released early by the loop's next request, the
  turn's end, or the subagent's stop; the walk saw no `block-row` after
  its step's end. Live `thinking` chunks carry empty text and no
  signature, so depth's collapsed indicator is the only drawing there is.
  Notice order is the engine's append order, which can put a row ahead of
  its own `parentUuid` chain within one same-millisecond batch (a first
  prompt's attachments); DX5's release rule absorbs it (the passed-over
  row released unnamed, its late `row-seen` ignored, nothing lost or
  repeated), and what the daemon may rely on is that a response row's
  `block-row` never follows a notice for a row written after it on disk.
  The worst flush-to-notice lag was 0.68 s, so the 2 s window stands; the
  module loads before a `--bg` job's first prompt row, so the seed rule
  stays narrowed to loops older than the module. Rejected: capping no
  hold, which would let a lost notice stall a step's end forever. DX5's
  text is refreshed from DC2's plan when M4 lands. Flags DC6, DC7.
  Date/Author: 2026-10-15, design session (DC2's M4 walk).
- Decision: A browser never receives the `end {reason: "unsubscribed"}`
  its own `unsubscribe` causes (DC7's M1, run against DC3's local hub).
  The hub drops the sub's route before it forwards the `unsubscribe`, so
  the machine's answer reaches no browser; the client's `close()` already
  ends a sub silently, so nothing waits for it. The real hub's order is
  the contract; a stand-in that delivers the `end` differs harmlessly.
  Rejected: holding the route until the machine answers, which keeps a
  dead sub's traffic flowing to a browser that has let it go. Flags DC3,
  DC5, DC7.
  Date/Author: 2026-10-15, design session (DC7's M1).
- Decision: DX4 gains `step-end` in subscriptions (DC6's M1). A response
  aborted before its blocks were written left partial text with nothing
  to settle it: a subscription carried no step boundary, so the text stood
  until the next snapshot. The daemon relays DX5's `step end` (and a
  `turn complete` that cuts a step off) as `step-end`, after every
  `block-row` of that step, and the browser drops the step's blocks that
  have none. DC2 confirms that DX5 delivers a step's `block-row` notices
  before its `step end`, or holds the step's end until they are posted.
  Rejected: waiting for the next snapshot, which a long-lived subscription
  may not see for hours. And streamed thinking follows the row: where the
  engine records thinking as omitted (`thinkingDisplay: "omitted"`, seen on
  2.1.300), depth draws live thinking as the same collapsed indicator, not
  text that would vanish when its row settles; DC2 confirms what live
  `thinking` chunks carry. Flags DC2, DC3 (the kind), DC5, DC6, DC7.
  Date/Author: 2026-10-15, design session (DC6's M1).
- Decision: The look of agent traffic and of requests (owner, 2026-10-15),
  from DC5's mockups `03-agent-traffic.html` and `04-request-cards.html`.
  A run of messages between sessions folds to one ledger line in the group
  chat (option A: a muted row with the count, who took part, and when,
  opened on a click), so only what sessions send the owner and what the
  owner posts read at full weight. A permission prompt or a question is
  drawn as the session's own message, its card the message's body (option
  A), shrinking to one line when it settles. Rejected: B and C in both.
  Flags DC5.
  Date/Author: 2026-10-15, owner.
- Decision: DX8's `DeskSession` gains `seat` (DC5's M3, additive). §5's
  table differs between a `--bg` seat and a terminal session, and presence
  alone does not tell them apart without a bridge; the log's `joined`
  event already names the seat. Flags DC6.
  Date/Author: 2026-10-15, design session (DC5's M3).
- Decision: Changing the org's wrapped keys needs proof of the key, not
  only an Access session (the wrapped-key contract's adversarial review,
  P1). The public `key_check` let a stolen admin session post a junk
  record that passed every check and then delete every real one, which
  `last-key` did not prevent. Now each add or removal carries `auth`, a
  domain-separated HMAC of a constant under the org key, and the hub
  compares its SHA-256 with the `key_auth` the first wrapped key set and
  never returns. Rejected: per-request codes under the org key, which the
  hub cannot verify. A compromised hub can still delete records (it can
  already withhold events), and an admin session ahead of the owner's
  first setup can lock the owner out, though without gaining any
  authority. The review confirmed WebCrypto unwraps AES-GCM straight into
  a non-extractable HMAC key (a Node probe; Safari not exercised).
  Backlog: a machine already enrolled holds the raw key and could give it
  back to a browser that has lost every method, a recovery path out of
  phase 1. Flags DC3, DC5.
  Date/Author: 2026-10-15, design session (the contract's review).
- Decision: The org key is one random key, wrapped once per unlock method
  (owner, 2026-10-15: "Random key, locked per method"). As §6 first read,
  a passkey (PRF, then HKDF) and a passphrase (Argon2id) derived two
  different keys, and an org can use only one: unlocking a phone with the
  passphrase after setting up with the passkey would have broken every
  code. Now the browser draws the key at random once; the hub keeps it
  wrapped under each method's derived key (DX7's `/api/org/keys`), and any
  method opens the same key. A wrong passphrase now fails the unwrap
  instead of producing a different key. `key_check` stops a second
  first-time setup from minting a second key. Rejected: one unlock path
  recorded per org, which leaves a passkey-only org with no way into a
  browser without PRF, and a passphrase-only org without passkeys. DC5's
  derivations (its plan's Decision Log) become the wrapping keys' and are
  carried in each record's `kdf`, so their cost can rise without a new
  contract. Recommended to the owner in the web: set up a second method
  right after the first, since losing every method loses the key (the
  enrolled machines still hold it, but nothing reads it back). Flags DC3
  (the endpoints, in M3), DC5 (M2's open item closes on this).
  Date/Author: 2026-10-15, owner; contract by the design session.
- Decision: The web's look (owner, 2026-10-15), from DC5's mockups
  (MAWS `smns-erb-web`, `mockups/desk/01-grid.html`, `02-project.html`).
  The project grid uses card B, tiles, with its empty, loading, and
  reconnecting states as mocked. The project view is approved as shown: a
  sidebar with the group channel and the sessions grouped as waiting on
  you, working, idle, and ended; the conversation in the center; the right
  column kept for session depth (DC6). A browser that does not hold the
  org key yet shows an empty sidebar, no session counts, since it cannot
  verify anything it would draw. Rejected: cards A and C, and counts in
  the locked view. Flags DC5, DC6.
  Date/Author: 2026-10-15, owner.
- Decision: A repeated `hello` on an open stream is allowed and
  idempotent (DX2), answered with a fresh `have` and the backlog past its
  vector. DX2 told a machine its archive designation only at `hello`, so a
  machine whose stream never drops would never learn of a later one; DC4's
  M4 re-sends `hello` per open project once per archive period (15
  minutes), and DC3's hub already accepted the repeat without side
  effect. Rejected: a hub push when the designation changes, a new frame
  and new hub work for a backup whose latency does not matter. The
  archive runs only on a fresh `have` naming this machine, so a machine
  that loses the designation stops at the first answer after the change.
  Residue: sminos's SKILL.md still says a `remote` makes `log/` a git
  mirror, wrong for hub projects since DC4's M2; it is updated once for
  the whole desk (hub projects, the bridge, the web's controls) after the
  children merge, through doperpowers:writing-skills, as its own ticket.
  Flags DC3, DC4.
  Date/Author: 2026-10-15, design session (DC4's M4).
- Decision: DX5's row order is disk order. DC2's M4 review broke the
  agreed ordering live: a notice posted at hook entry can precede a row
  the engine writes earlier (a session's first prompt was noticed before
  its environment attachment but written after it), and a compaction's
  rows, which no hook names, were emitted after the next prompt. So the
  mod posts a row's notice once the engine has taken the row (after
  `next()`), making notice order write order within a loop, and the
  consumer emits each loop's rows strictly in disk order: a row past the
  cut is released by its own notice, by a notice for a later row of the
  same loop (a row passed over gets none), or after 2 s with neither;
  every later row waits behind it. History waits for each loop's cut row
  to reach disk (5 s, else a discontinuity), since a notice may now trail
  the flush. A `block-row` for a row already released unnamed still ends
  the subscription; a `row-seen` for one is ignored. History and live then
  agree across a reconnect, both following the disk. Rejected: notices at
  hook entry with a 2 s wait for unnamed rows, which emitted rows out of
  order. Open: the live walk measures the largest flush-to-notice lag,
  since a notice later than the window releases its row unnamed and its
  `block-row` then ends the subscription; the window rises if the lag
  nears it. And the mod seeds each loop's cut at load (DC7's M1 review):
  with notices after `next()`, a `null` cut sent history to the end of
  the file, so a row flushed after a module load but before its notice
  sat in the snapshot's history beside its streaming block. On its first
  `resync` the mod reports each loop's cut as the last row the engine held
  for that loop when the module loaded, and no block of a loop enters
  `streaming` before that loop's cut is seeded; `null` means the loop had
  no rows. Rejected: an exception to DX4's no-overlap rule, healed by the
  discontinuity the late `block-row` causes. DX5's text is refreshed from
  DC2's plan when M4 is reviewed.
  With it, from DC7's M1: an `end` may be a sub's first message, at
  `n` 0 (DX4), and a subagent's `block-row` in a main-scope sub settles
  its block at once, since that sub never carries the row. Flags DC2,
  DC3 (the `end` type), DC5, DC6, DC7.
  Date/Author: 2026-10-15, design session (DC2's M4 review, DC7's M1).
- Decision: DX4's and DX5's `usage` give the engine's shape exactly:
  `context: {tokens?, window, percent?}` and `cost: {usd} | null`. The
  bridge passes `$.session.usage()`'s `context` and `cost` through, so
  the engine decides the shape and DX4 repeats it verbatim; the earlier
  text named the fields without their optionality or the `usd` object.
  DC3's module types (MAWS `068f14f3`) carried it first. Flags DC2 (its
  plan's DX5 copy), DC5, DC6.
  Date/Author: 2026-10-15, design session (DC3's M3 contract types).
- Decision: Five gaps found by the adversarial review of DC7's plan,
  closed in the contracts. (1) A valid code does not say which machine
  should act, since every machine holds the org key. So the daemon binds
  an RPC to itself, its project, and the session (`wrong-machine`,
  `unknown-project`, `no-session`) before anything else, and never relies
  on the hub's routing (DX6). (2) The browser's `diff` had no machine-side
  frame: DX2 gains `diff` down. (3) A compaction's outcome had no route to
  a browser: DX4 gains `compact`, outside subscriptions, carrying the
  RPC's nonce. (4) A child could answer before the mod's first `resync`,
  so a subscriber could take an empty snapshot and then lose the prefix
  of a message already streaming. DC2's M4 makes the child hold `GET
  /events` until its first `resync` is applied, and end every open DX5
  subscription on any later one; a DX5 subscription ending ends the DX4
  subscriptions it touches, as a `gap` does. (5) Resume's "live anywhere"
  means live on the session's machine, since a session's transcript lives
  where it ran. And DX5 gives DC7 a transcript cut and an order for rows
  (DC2's M4, agreed): every row the mod observes gets one notice before it
  is written (`block-row` for a response row, `row-seen` for any other),
  the snapshot carries the per-loop `cut` of notices applied, history is
  read from disk up to the cut and live rows follow their notices, and a
  `block-row` for a row already emitted unnamed ends the DX4 subscription
  as a discontinuity. DC7's
  plan is amended to put its safeguards ahead of the paths they protect:
  the policy, read-only delivery included, comes before any remote
  execution or outside-origin delivery is enabled. Flags DC2, DC3, DC5,
  DC7.
  Date/Author: 2026-10-15, design session (DC7's plan review).
- Decision: DX5 refreshed with DC2's M3 extension (doperpowers
  `9055a181`, reviewed clean after two fix waves). A settlement now names
  its winner from the engine's own evidence for that exact call, instead
  of inferring it with a 1.5 s grace. The source is the `tool_decision`
  telemetry record: a hook decision the bridge handed out goes to the
  side that sent it, a member id or `cli`; a decision made at the dialog
  goes to `terminal`; and an abort, or another mod's decision, is
  `withdrawn` by `bridge`. Where a call has no record, the transcript's
  `hook_permission_decision` mark at the call's result decides. A
  settlement now lands 0.01–0.13 s after the decision. An async question
  answered in the dialog its `[ answer ]` opened is credited to whoever
  answered it. The streaming entry is unchanged from DX4 as aligned at
  `8f7e09d3`. Rejected: the inference it replaces, which could name the
  wrong winner when both sides answered at once. The cost is an engine
  dependency the live check now pins (Surprises). Flags DC3, DC5, DC7.
  Date/Author: 2026-10-15, design session (DC2's M3).
- Decision: Three DX1/DX2 rules from DC4's M3. (1) A machine may derive
  the nonce of its own log events from the org key and the event, under a
  domain of its own, instead of drawing it at random. Local events are
  stored without a code, by processes that hold no key, and an upload
  resent after a lost answer must carry the same bytes or the hub refuses
  it as `conflict`. A verifier cannot tell a derived nonce from a random
  one. Rejected: storing each sealed nonce in the uplink's state before
  uploading, a write-ahead the derived form makes unnecessary. (2) The
  upward refusal gains the reason `conflict`, for an authentic event at a
  position that already holds a different one; calling it `bad-code`
  mislabeled an authentic event. (3) A refused position is spent on the
  daemon that refused it: its vector moves past it, and later events of
  that writer flow. Otherwise one forged web `human`, which the hub stores
  because it cannot verify, blocks that member everywhere. A hub that
  lies gains nothing from this it lacked already, since it could always
  withhold an event. Flags DC3 (DX1 and DX2 in the module), DC4, DC5 (a
  browser's nonces stay random).
  Date/Author: 2026-10-15, design session (DC4's M3).
- Decision: DX2, DX3, and DX7 replaced whole by DC3's M2 (MAWS
  `4de85ff9`, interfaces reviewed clean), DX1 gaining the reviewed
  paragraph on canonical base64url (which replaces the interim sentences
  of `91f839ee`), and "Running the local hub" added after DX7. The changes
  to shapes DC4 and DC5 already used, each with its reason in DC3's
  `interfaces-M2-reviewed-4de85ff9.md`: canonical base64url refused at
  ingest; the redeem path `POST /machine/enroll` (the Worker serves the
  web app's assets, running first only on `/api/*` and `/machine/*`);
  three Cloudflare deploy variables for minting service tokens; a project
  socket for an unknown project refused `unknown-project`; the refusal
  `not-open` for a project the stream has not opened; audit entries to
  every browser of the project; writers with control characters refused;
  each session's latest presence sent on connect; a re-sent `human`
  answered with its original ack; `orgKeyFromCryptoKey`. Every replaced
  subsection was checked against the composite at `8f7e09d3`, so nothing
  folded since is lost (`diff {sub}` kept, marked M3). The enrollment
  endpoints and the POST's answer are final. Flags DC4, DC5.
  Date/Author: 2026-10-15, design session (DC3's M2).
- Decision: The snapshot's streaming entry follows what DC2's M3 built: a
  message-level `upTo` is the watermark (a chunk at or below it is already
  in the text, since `chunkIndex` counts across the message), with `model`
  beside it, and each block's own `upTo` kept as information; blocks are
  `text`, `thinking` or `tool`, a tool block carrying `id`, `name`, and
  its argument JSON as text. A per-block watermark (DX4's earlier wording)
  would also be sound, but it adds a rule a consumer can get wrong for no
  gain. Flags DC3 (DX4's module and the fake machine), DC6.
  Date/Author: 2026-10-15, design session (DC2's M3).
- Decision: The bridge raises a pending request after the session's
  settings hooks have run, not before. This costs up to about 0.4 s before
  the web sees it. Raising first would publish requests that a settings
  hook then decides itself, which would need a fourth `by` and a
  withdrawal the web has to draw. A request's id is the call's
  `tool_use_id` where the engine gives one (an ask-mod question carries
  its `toolu_plugin_…` raise id; otherwise a synthetic `request-…`), and
  every consumer treats it as opaque, the DX6 digest included. Async
  questions are raised with `async: true`; they are answered or withdrawn,
  never denied. A decision that arrives after another has won, or within
  200 ms of a background request's deadline, is answered 409 naming the
  winner (`terminalOnly` for the deadline). The DX5 M3 extension that
  carries these is folded when DC2's M3 review is clean. Flags DC3, DC5,
  DC7.
  Date/Author: 2026-10-15, design session (DC2's M3).
- Decision: The enrollment code is never a command-line argument. It
  carries the org key in reversible base64url, and `sminos hub enroll
  <code>` left it in the process listing for the command's life (up to
  three 30 s attempts) and in the shell's history (DC4's M2 review).
  `sminos hub enroll` reads the code from a hidden prompt, or from stdin
  when piped, and refuses it as an argument, saying how to run it; the
  web's enrollment screen says "run `sminos hub enroll` on the machine and
  paste this code", with the code to copy, never one command line with the
  code inline. Rejected: keeping the argument form with a warning (the
  harm is done by the time the warning prints) and an environment variable
  (it reaches child processes and the shell's history just the same).
  Flags DC4, DC5.
  Date/Author: 2026-10-15, design session (DC4's M2 review).
- Decision: Context use and cost reach the web as DX4 `usage`, on the main
  transcript's subscription (in its snapshot, then after each main turn),
  passed through from the bridge's DX5 `usage` event, which already
  existed but had no route to a browser. DX8 said they "come from the
  transcript", and they do not: MAWS reads them from its main process's
  session digest, and the engine's `cost-state` records carry no `uuid`,
  so a row mapper drops them (the DC6 plan's adversarial review). A
  session without a bridge shows context and cost as unavailable.
  Rejected: shipping uuid-less JSONL records as rows, which would break
  paging by `uuid` and duplicate what the bridge already computes. Flags
  DC3 (DX4's module), DC5 (DX8's types), DC6, DC7 (the producer).
  Date/Author: 2026-10-15, design session (DC6's plan review).
- Decision: The browser asks for a session's diff. DX4 had a `diff`
  message, but no frame asked for one and no rule said when a machine
  sent it, which writing DC6's plan exposed. DX3 gains `diff {sub}`,
  answered as DX4 `diff` on that subscription and valid on a
  main-transcript subscription only, and DX8's `Subscription` gains
  `diff()`. Rejected: the machine pushing a diff after every turn, which
  costs a git run per turn whether or not anyone is looking. Flags DC3
  (DX3), DC5 (DX8), DC6, DC7 (the producer).
  Date/Author: 2026-10-15, design session (DC6's plan).
- Decision: DX8 folded from DC5's M1 (MAWS `66eabe92`, reviewed clean).
  DC6 plugs into two slots, `depth` and `transcript`, registered once
  from `connectDepth()`. It reads sessions through a `SessionPlane` whose
  client turns every discontinuity into `reset` and a fresh snapshot, so
  DC6 never resumes a broken stream, and keeps MAWS's transcript store
  keyed by project and target, live while the session has presence and
  its machine is not offline. The types under `apps/desk-web/src/shell/`
  decide where they and the text differ. Unblocks DC6's plan. Flags DC6.
  Date/Author: 2026-10-15, design session (DC5's M1).
- Decision: DX5 refreshed with DC2's M2 extension (doperpowers `7487ace4`,
  reviewed clean after two fix waves), and §5 and DX6 aligned with what
  the bridge proved. (1) Steer is refused when no turn is running, as the
  new DX6 code `idle`, and the web offers Send instead. A turn that
  answers before any request read the steer gets one wake prompt that
  does not repeat it. (2) Interrupt stops only the aborted turn's
  background Bash (the main loop's and its foreground subagents'), and
  its result names the tasks still running when a stop failed; DX6's
  interrupt result carries them. (3) Model applies to the main loop only,
  and its rewrite reaches the API verbatim, so a bare alias the session
  does not map is refused and the web offers ids; DX6's model result is
  the choice in force. (4) Compact answers at once with `at`, and its
  outcome follows as events, not as the RPC's result, since a compaction
  takes 17–24 s. (5) The `--bg` supervisor's `reply` is sent only with
  `nextTurn`, so it queues a prompt and cannot answer an open question:
  a question in a `--bg` seat without a bridge is terminal only in phase
  1. (6) A peer's `say` reaches a bridged session as the inbox frame's
  text submitted `asUser`, naming the peer in its first line, as every
  live delivery already did. Delivery through the bridge is keyed by the
  event's position and de-duplicated per writer; a module reload in the
  middle of a submission may submit twice, which is §3's at-least-once,
  accepted over persisting first, which would open a window for loss.
  Rejected: a compact RPC that waits for the compaction (it holds an RPC
  open for tens of seconds and gains nothing over the events). Flags DC3
  (DX6's module), DC5, DC7.
  Date/Author: 2026-10-15, design session (DC2's M2).
- Decision: The enrolled machine name becomes the machine's one identity in sminos (`host_name()`),
  for hub and git projects alike, ahead of `DAEMON_HOST` and the system name. Enrollment defaults the
  name to the current host name, so most enrollments rename nothing, and a pinned name no longer
  drifts with macOS's `.local` renames. A rename keeps the machine's existing seats and members
  local and controllable. Its writers already written stay under the old name and never reach the
  hub (DX2's `writer-not-yours`), and the CLI tells the human so. Rejected: a per-project writer
  name, which would change `writer_id` across sminos.py for no gain over one name per machine.
  Flags DC2 (shares sminos.py), DC7.
  Date/Author: 2026-10-15, design session (DC4's M2).
- Decision: Base64url is canonical everywhere DX1–DX7 use it: the unused low bits of the last character
  must be zero, and decoders refuse any other spelling. DC4's Python module (M1) found that the hub's
  decoder accepted all four spellings of a 43-character code while the Python one accepted only the
  canonical spelling, so an event the hub stored under a variant would be refused by every daemon. The
  rule is strict decoding, not normalization: re-encoding a variant would mean storing bytes other
  than the ones the writer sent. DC3 aligns `base64url.ts` and adds a negative vector; DC4 already
  refuses. Flags DC3, DC4, DC5.
  Date/Author: 2026-10-15, design session (DC4's M1).
- Decision: DX1–DX4 and DX7 re-folded from DC3's G1 amendment (MAWS
  `29294260`, reviewed clean after one fix wave), which builds the
  Interfaces review's fixes into the module. Two refinements: a daemon's
  `rejected` report names the event by position, nonce, either, or
  neither, as the event carried them, so a malformed event is still
  reported rather than silenced or given a made-up position; and the two
  moments of a block's settling are kept apart (the producer drops the
  block from its snapshot state on `block-row`; the browser drops the
  drawn partial text when the named row arrives). Enrollment's endpoints
  (`POST /api/enrollments`; redemption at `POST /machine/enroll`, the one
  path Access bypasses) and DX2's POST answer are written in, provisional
  until DC3's M2 review. Flags DC4, DC5.
  Date/Author: 2026-10-15, design session (DC3's G1 amendment).
- Decision: The Interfaces review (2026-10-15, adversarial, over DX1–DX7
  at `cd818262`) found six gaps, all adopted. (1) A `hub/` event's
  writer, seq, and ts, which its code leaves out, could carry text into a
  session's prompt: importers now check them by shape, the writer bound
  to the covered `member` (DX1). (2) The hub's own heartbeat renewed a
  machine's lease: only the daemon's answers renew it now (DX2). (3) A
  daemon had no way to report an event it refused, which acceptance 8
  needs shown in the web: an upward refusal report (DX2). (4) A bridge
  `gap` during an open subscription had no DX4 consequence: it ends the
  subscription (DX4), correcting the DX5 entry's claim. (5) A
  subscription named only a session, so a subagent's transcript could not
  be paged: subscriptions are scoped by `agentId` (DX3, DX2). (6)
  Enrollment's endpoints are DC3's M2, so DC4's and DC5's enrollment
  milestones wait for DC3's M2 rather than its G1. With these, from DC2's
  M2 (2026-10-15): streaming is per content block, settled by row uuid
  through `block-row` (DX4, DX5), since the mod sees no API message id
  and one response is several rows. DC3 aligns its module and the
  Interfaces subsections, which are re-folded from it. Rejected then:
  pairing rows to streams by API message id (invisible to the mod), and
  relaying `gap` and `resync` to browsers (a fresh snapshot is simpler and
  already the rule). Flags DC3, DC4, DC5, DC6, DC7.
  Date/Author: 2026-10-15, design session (Interfaces review; DC2's M2).
- Decision: DC3.G1 — DX1's vectors, DX2, DX3, the DX4 envelope, the DX6
  shapes, and DX7 folded from DC3's M1 (MAWS `140c834b`), with the
  choices that bind consumers: every number in a covered object is an
  IEEE-754 double written as ECMAScript writes it (RFC 8785 in full; tool
  inputs carry fractions, so an integer-only rule would have broken
  request cards), with the Python recipe in DX1; each authenticated shape
  has its own domain string, and an RPC carries its nonce at the top
  level and its code as a bare string, so the one rule is "a code covers
  its shape minus its own value"; member ids are 32 hex characters, never
  uuids, which sminos would read as session ids; machine names follow a
  grammar, are unique without regard to case, and exclude `hub` and
  `legacy`; the enrollment code is `smns-enroll-v1.` plus base64url JSON;
  a background subagent's request past its deadline stays pending, marked
  `terminal_only` by the hub's clock rather than compared against the
  browser's; and settlement's values are DC2's (`allow | deny | answered |
  withdrawn`; a web win names the member, a CLI win is `other` with
  `cli`, an end with no answer used is `withdrawn`, `other`, `bridge`).
  For DC4: the enrolled machine name must be the daemon's writer host
  (sminos's `host_name()`, which reads `DAEMON_HOST`). Rejected then: a
  deadline the web compares with its own clock (skew), uuid member ids.
  Flags DC4, DC5, DC6, DC7.
  Date/Author: 2026-10-15, design session (DC3's M1).
- Decision: DX5 amended by DC2's M1 review (doperpowers `a3756267`): a
  `resync` event carries the mod's own live state to every new child and
  after every `gap`, and the child replaces its state with it, so no
  snapshot claims an `upTo` its text does not cover; a child knows itself
  by its socket's inode; a `/clear` stops routing to the old child at
  once. `resync` stays local to DX5: DC7 does not relay it, since the
  snapshot a DX4 subscriber takes already reflects it. Flags DC7.
  (Corrected the same day: a subscriber whose snapshot preceded the loss
  does not reflect it, so DC7 ends every DX4 subscription a bridge `gap`
  touches; see the Interfaces review's entry.)
  Date/Author: 2026-10-15, design session (DC2's M1 review).
- Decision: DX5 version 1 folded from DC2's M1 (doperpowers `434953ce`).
  Two of DC2's choices revise DX4: the bridge's endpoint, not the daemon,
  builds the live half of a subscription's snapshot under the lock that
  applies events, and DC7 relays it, adding transcript rows from disk; and
  a stream chunk nests the engine's chunk object under `chunk` with
  `turnId`, `agentId`, `step`, and `chunkIndex` beside it, because the
  chunk carries an index field of its own. Also for DC7: a `/clear`
  changes the session id with no `session.start`, so a session's endpoint
  path can change mid-life (the bridge restarts its child under the new id
  within 5 seconds), and bridges are keyed by what `GET /status` reports;
  lost events surface as a `gap` event and subscribers resubscribe.
  Rejected then: a daemon-built snapshot, which would need the daemon to
  reproduce the bridge's lock; chunk fields merged into the envelope,
  which collide. Flags DC6, DC7.
  Date/Author: 2026-10-15, design session (DC2's M1).
- Decision: DC3's plan review (2026-10-15) corrected two contracts and
  two of §2's hub rules. DX1's code covers the `mac` nonce (everything but
  the code's value): with the nonce outside it, a hub could re-sequence a
  web `human` under a fresh nonce and every daemon's seen-nonce check
  would pass the replay, delivering it again. DX6's daemon claims a nonce
  in its ledger before the RPC has any effect and never re-executes a
  claim left without an outcome, which closes the window between the
  effect and the ledger write. §2: a machine is online by a lease fenced
  by connection generation, not by a close callback, since Durable
  Objects promise no shutdown hook; a browser socket's identity,
  visibility, and subscriptions survive hibernation on the socket. And
  the hub runs on its `workers.dev` host (owner, 2026-10-15) behind a
  hostname-level Access application, because Worker-level Access refuses
  WebSocket upgrades with a 403 (Cloudflare's Workers Access page, read
  2026-10-15). Rejected then: an outcome-only ledger as DX6 first said,
  and close notifications as the source of machine presence.
  Date/Author: 2026-10-15, design session (adversarial review of DC3's
  plan).
- Decision: DC3 dispatched with its plan
  (`docs/doperpowers/plans/2026-10-15-desk-dc3-hub.md`, MAWS), whose
  decisions touch the contracts. Machines connect over the HTTP pair (SSE
  down, POST up) and browsers over WebSockets, which fixes the transport
  half of §8 unknown 2 at DX2; DC4 keeps thread against process. One
  Durable Object per enrolled machine holds its down stream and project
  objects reach the machine through it, so DX2's one connection per
  machine meets one object per project. The registry is one Durable Object
  per org, which also streams the grid's per-project summaries. DX1's
  canonical JSON is RFC 8785 (JCS), pinned by shared vectors, and the hub
  keeps the project offset beside a stored event rather than inside it.
  §2, §8, and DX1 revised. Rejected then: D1 for the registry (a second
  storage system for a handful of rows), a socket per project from the
  grid, and machines on WebSockets (a hand-written RFC 6455 client in
  stdlib Python). The composite moved to MAWS the same day, as
  `docs/doperpowers/specs/2026-10-15-desk-design.md`.
  Date/Author: 2026-10-15, design session (DC3's plan).
- Decision: The product's boundary and home (owner, 2026-10-15): an
  independent product whose root is `.smns` alone — not Arkho's child and
  not MAWS's web edition; convergences such as a cloud web MAWS are open
  possibilities. The code lives in the MAWS repository as two pnpm
  workspace apps, importing MAWS components kept free of Electron and
  copying entangled ones; sminos hub is discarded. Child and contract ids
  gain a `D` (DC, DX) so they cannot be read as MAWS's charter C1–C12 and
  X1–X8, which MAWS's `CLAUDE.md` binds. Rejected then: a new repository
  (the owner's alternative), and "MAWS on the web" as the product's
  framing, which this session wrote an hour earlier.
  Date/Author: 2026-10-15, design session.
- Decision: Not a child of Arkho (owner, 2026-10-15): "I don't want to be
  bound to Arkho's existing project; it is closer to MAWS on the web." The
  parent line, §1, the must-not list, and phase 2 revised; the title drops
  "Arkho" and the unit's name "A8" (it remains in earlier commit messages
  and the children's file names). Rejected then: re-chartering Arkho,
  approved earlier the same day on a false premise this session supplied —
  that Arkho's web UI (A3) and terminal gateway (A6) were never dispatched.
  A3 has been live since 2026-09-06 and A6's design was approved
  2026-09-13; the session had read a local checkout stopped at 2026-08-20
  instead of `origin/main` (Surprises).
  Date/Author: 2026-10-15, design session.
- Decision: DC2 residue — the bridge child serves a per-session endpoint
  (`$SMINOS_HOME/bridge/<session-id>.sock`) that the CLI and the daemon
  connect to, rather than connecting to one daemon socket. §2, §6, and DX5
  revised. Rejected then: one daemon socket, which would make local control
  depend on the daemon running. Flags DC7 (it discovers bridges by listing
  the directory).
  Date/Author: 2026-10-15, design session (DC2's plan).
- Decision: The group chat is redrawn on the session view's rendering
  (owner, 2026-10-19: "we took some care over an individual session's
  rendering, but the group chat UI looks quite ugly; use the same
  rendering, but make it work like a group chat"). §4's group-chat clause
  is amended: MAWS's reading column and typography, a session's message
  as MAWS's answer prose, the owner's message as MAWS's user bubble with
  each recipient's delivery as its foot (the tail foot's shape and
  glyphs, `DeliveryFoot.tsx`), a question as the request card while
  answerable here and MAWS's question receipt otherwise (the answer read
  with MAWS's reader of the engine's summary, `ask-mod.ts`, so the
  engine's "Your questions have been answered: …" text is never drawn),
  one header per run of a sender's items within five minutes, lifecycle
  merged per session and folded past three lines, agent traffic as
  MAWS's peer line, day separators. The screenshot the owner judged
  (`acceptance-scratch`) showed every alias twice: a session titled with
  its own alias was named by the title and then the alias; the alias now
  stands beside the title only where it differs. "X is now X" was a
  rename drawn with the session's current alias as its subject; a rename
  names the alias as it stood before, and one to the same name is
  dropped. The bubble and its fold are one component (`Bubble.tsx`),
  which the session view's tail bubble now wraps, so the chat's bubble
  and the tail's cannot drift apart. The group chat's chunk still
  carries none of MAWS's transcript view: the chat draws with MAWS's
  classes and its own small pieces, importing only Markdown, the answer
  reader and an icon from MAWS. Rejected then: a Slack-like avatar
  column per message (the DC5 mockup's 28 px mark), which the session
  view does not have and which the sender's header carries without;
  per-message timestamps within a run (the header carries the run's
  first; the bubble's shows on hover as in the session view); hiding
  state flips (stopped, running again) from the chat altogether — they
  stay, merged into the session's quiet line and folded with it, since
  a session that stopped between two messages is something the reader
  should be able to find; and drawing another human's message as prose
  rather than a bubble (a bubble is a human's words everywhere in the
  desk; the side says whose). The desktop and phone screenshots the
  owner saw before merging are under `mockups/desk/10-group-chat/`.
  Date/Author: 2026-10-19, the chat redraw (branch `desk-chat-render`).
- Decision: The desk's remote capability is rebuilt as a phase of MAWS #52, not patched failure by failure. On
  2026-10-19 the owner judged the desk's latency, speed and basic remote capability below standard: latency,
  connection problems and resuming. A later phase rebuilds the remote protocol from the owner's research on how
  Claude.ai built its Remote Control. Just as MAWS benchmarked Claude Desktop and Codex Desktop, the desk will
  benchmark the Claude Code binary's Remote Control and claude.ai's RC surfaces. The destination is one web
  interface for the agent workspace: a single client controls agents on many machines working on many projects.
  The desk ports MAWS's desktop product side to the web and becomes the one surface for sessions across every
  machine and project. Timing: not now; it is the goal the desk's work keeps in view.

  Until that phase, failures are triaged in two ways:
  - **Protocol-level** (latency, reconnects, stale RPCs, resume speed, the hub's open-state bookkeeping) goes to #52
    as evidence, unless it blocks daily use.
  - **Logic bugs** are fixed as found.

  Two comments on #52 record this. The first holds the owner's words and the baseline: Resume ~30 s, one answer
  refused `stale` after 60.5 s, reconnect after a deploy 1.4–2.0 s, first rows ~5 s against a 1.5 s budget. The
  second holds the evening's diagnosis:
  - the hub drops a project's open state while the stream stays up;
  - the web resends an RPC after a reconnect with its original `created`, so it lands stale;
  - about 25 s of a Resume pass after the session is already running, probably in the bridged subscription's
    open.

  The same diagnosis found the logic bugs fixed under the rule:
  - Resume acted on a transcript-less `--bg` copy that had taken the seat's alias;
  - the audit replay drew old `not-open` refusals as current failures.

  Rejected then: fixing each protocol failure as it appears. Each fix would be rewritten by the rebuild, and the
  baseline the benchmark needs would move under it.
  Date/Author: 2026-10-19, the owner; folded by the design session.
- Decision: The grid shows the active projects by default, those with a
  live session or waiting on the owner, and the rest behind "Show all
  (N)" (owner, 2026-10-19; doperpowers' smns remote identity design, §5,
  its MAWS milestone). That design makes every repository a project by
  its remote, so the grid would otherwise list every repository the org
  has used. The count is the hub's: `Project.reportSummary` counts as
  `live` each presence row whose `record` is not null on the project's
  holders, online or offline, and carries it as `SummaryReport.live`, the
  Registry's `summaries.live`, and `ProjectSummary.live` (DX3's grid).
  Offline machines count because a laptop that sleeps nightly would make
  an online-only grid flap; a revoked machine's rows drop out. One Durable
  Object storage change, the owner's approval given with the brief:
  `summaries` gains `live INTEGER NOT NULL DEFAULT 0` through
  `ADDED_COLUMNS`. A report without `live` keeps the stored count. The
  upsert binds the count twice, `COALESCE(?, 0)` in its values and
  `COALESCE(?, summaries.live)` in its update, because SQLite checks NOT
  NULL before the conflict: the design's `COALESCE(excluded.live,
  summaries.live)` refuses an older report's first insert (proved on
  workerd: `NOT NULL constraint failed: summaries.live`). After the deploy
  a project's `live` reads 0 until its `Project` reports again. In the
  deploy's overlap a `Project` already on this version can report to the
  Registry still on the previous one, which keeps the counts but not
  `live` and answers nothing. The new `Registry.summary` answers `true`; a
  report not so acknowledged leaves the `Project` no copy of it, so the
  `Project` sends its counts again at its next change of any kind, though
  they are the same. A project whose last such change landed on the old
  Registry, or whose every machine is offline at the deploy, still reads
  0, behind Show all, until its next change. The filter is the web's, a
  view preference kept in `localStorage` (`desk.grid.all`); the `grid`
  frame is unchanged. Rejected: the hub filtering the `grid` frame (Show
  all would need a second frame); the grid acquiring every project's
  socket and grouping sessions from the logs (the grid is the home and the
  phone, drawn before any log loads). Not built: the design's optional cut
  of the org view's sockets to active projects.
  Date/Author: 2026-10-19, the remote identity design's MAWS milestone
  (branch `desk-grid-active`).
- Decision: MAWS itself, ported to the web as fully as possible, is #52's yardstick for features. On the evening of
  2026-10-19 the owner refined the protocol phase's target, as recorded by the RC research session on #52 (its
  comment of 21:51Z, as edited):
  - **Features:** MAWS. Claude Desktop's SSH mode is the reference design for remoting only. In it, a daemon on the
    machine owns the session processes and re-adopts them after a disconnect, the same split as MAWS's E10
    supervisor.
  - **Reach and performance:** still benchmarked against the Claude Code binary's Remote Control and claude.ai's RC
    client.

  The research for the phase is on #52 (comment 6279243598) and in MAWS PR #79 (`research/desk-remote/`).
  - It leaves three first-order decisions to the phase's design and the owner:
    - whether to reverse the desk's "bridge, not SDK host" call (§2), since web MAWS hosts sessions;
    - the trust design for carrying MAWS's X2 surface over the hub, which the machine does not trust;
    - the hub's storage.
  - It recommends:
    - keeping the 60 s freshness window for discrete actions, re-sealing an answer or decision while its request is
      pending (the 20:15Z diagnosis's rule);
    - application-level pings between browser and hub;
    - cursors keyed by session, launch epoch and seq.

  Rejected then: Remote Control's feature range as the yardstick. RC is the narrowest of Desktop's session kinds,
  because the client is a guest on a CLI it does not own, and the desk is meant to reach past it.
  Date/Author: 2026-10-19, the owner (through the RC research session); folded by the design session.
- Decision: the web serves both lanes of sessions, which settles the first of the three decisions the entry above left
  open. The design is in the research note `~/claude-code-bundle/2.1.300/notes/web-maws-remote-research.ko.md` §3.7
  (the research session's machine; its gist goes on #52 with the bridge benchmark).
  - **Lane A:** engine-supervised `--bg` sessions and terminal sessions, controlled through the bridge mod (this
    spec's §2 and §5).
  - **Lane B:** MAWS's SDK-host sessions (stdio stream-json), controlled by the MAWS daemon.
  - **One plane for both:** one cursor, one trust channel and one X1 vocabulary, plus a per-session capability list
    that says what the web can do with each session.
    - A session moves between lanes by a resume handoff.
    - In a session MAWS spawns, the bridge only observes.
    - §5's control table gains a row for the SDK host owning the process.

  §2's "bridge, not an SDK host" binding loses its terms leg. The owner confirmed that an SDK product on subscription
  credentials is fine under the terms as of October. The terminal-holdable leg stays, as the reason lane A exists.
  The owner's remaining worry is whether lane A's connection is fast enough. The research session is benchmarking the
  bridge hop and will post the numbers with this decision on #52.

  The first live sample, a desk Resume at 2026-10-20 05:07Z on the MacBook (#52 comment 6283891796), came from the
  plane's per-open log line added by doperpowers #283. The bridged open reached its snapshot after 5.40 s, and the
  bridge's own snapshot was ready at 1.43 s. So the engine-to-bridge leg is not where most of the time goes.

  Rejected: lane A only, the research's first recommendation (§3.6 of the note). The owner chose both, so that web
  MAWS can host sessions as the desktop app does.
  Date/Author: 2026-10-19, the owner (relayed by the RC research session, `2-1-300-19`); folded by the design session
  2026-10-20.
- Decision: DX7 gains a child, **provisioning keys**
  (`docs/doperpowers/specs/2026-10-21-desk-provisioning-keys-design.md`, standalone, with its own execution section).
  A machine joins the desk today only through a one-time code an admin carries by hand, live an hour at most; the
  owner's automated VM provisioning (devcloud, boot step 11) needs a credential that can wait in Secret Manager and
  enroll each new VM at boot with no human. The child adds a reusable, revocable **provisioning key** (a name
  prefix, an expiry, an optional cap on uses, an optional offline auto-revoke), whose code `smns-provision-v1.` an
  admin's browser builds around the key's secret and the org key as it builds a one-time code; its secret is
  redeemed at the same unguarded path, `POST /machine/enroll`, and becomes an ordinary pending enrollment, so DX7's
  confirmation, expiry, rotation, orphan and revocation machinery carry over unchanged; a machine can end its own
  enrollment (`DELETE /machine/enrollment`, `sminos hub leave`); and the Registry revokes a key's machine once it has
  been offline for the key's time, through the revocation path an admin's removal uses. Storage: one new table and an
  `enrollments.key` column, through `CREATE TABLE IF NOT EXISTS` and `ADDED_COLUMNS` (approved). The copy of the org
  key this puts in Secret Manager is readable by a project owner of that GCP project, the same class as every enrolled
  machine's `hub.json` (the child's §7). Rejected there: a second redemption path (an Access policy edit at deploy for
  the same lookup), `smns-enroll-v1.` with a flag (an older sminos would read `machine` for a meaning it lacks), and a
  browserless admin revoke (a member credential outside Access; deferred with its future shape).
  Date/Author: 2026-10-21, the owner (design approved) and the spec's author.
- Decision: DX3's frame bound and DX6's hub check bound what a browser sends, before the org admits members other
  than its owner (the tracker's 2026-10-15 DC3 row). A browser's part set joins to at most 4 MiB in at most 9 parts
  (DX3's frame bound has the derivation); a part past either is refused `too-large`, the first before anything of its
  set is held. The hub fails an RPC over 1 MiB as canonical JSON `bad-shape` (DX6), as DX1 bounds an event: before, an
  RPC was bounded only by the part sets, and one past the storage's row limit failed inside the object, its request left
  waiting. A set's refusal names no request, the frame never read, so the web ends a `human` or an RPC whose frame
  would join past the bound itself (`ProjectClient`, through `HumanRefused` and a `failed` `rpc-state`). Consumers
  flagged: DC5 (the web's sends, changed in the same branch); DC7 (nothing: such an RPC never reaches a daemon).
  Rejected: one per-set bound for every assembler (a machine's stream, and the web's receiving side, carry frames up
  to the 16 MiB a set may hold there: a snapshot, a grid of many projects); a refusal naming the part set's `id` (no
  browser keeps which request went under which id). Left to the org phase (tracker): a bound across a project's
  sockets, each of which still holds up to 16 MiB of unfinished sets.
  Date/Author: 2026-10-21, the desk's debt worker (branch `desk-hub-bounds`).

## Outcomes & Retrospective

**Phase 1 closed on 2026-10-18 by recomposition.** The two-Mac walk checked Parent-Level Acceptance item by item on
the owner's two Macs (`macbook`, `mini`) and iPhone, with the hub deployed for org `ssfskim`. The walk sheet is
`docs/doperpowers/plans/2026-10-16-desk-recomposition-walk.md`. Parts A–H ran on 2026-10-17 between 05:57Z and
07:27Z in the scratch project `desk-walk`. Part I was the owner's working day in MAWS, through 2026-10-18. The text
evidence is under `docs/doperpowers/evidence/desk-walk/`: list captures, the hub's audit, per-writer counts, and the
daemons' refusal lines.

| item | verdict | evidence and notes |
| --- | --- | --- |
| 1 Projects | holds | Part A. Card counts matched `sminos list` on each machine (the `20261017T…` captures). Once, in A1, the card lagged about 10 s, and it did not recur. Local presence flips 0.3–0.5 s after a prompt (`sample-walk-a.txt`), so that lag lay between the uplink and the web. |
| 2 Messages | holds | Part A, after the IPv6 fix below. |
| 3 Questions | holds | Part B. Blocking and async questions on both machines were answered from the web: decided rows in `audit-after-B.txt`, by the owner's member, from `web`. |
| 4 Permissions | holds | Part B: a web deny, a web allow, and a terminal deny that left the web (`audit-after-B.txt`). Deviation: B3's compound command (`mkdir && ls && rm -rf`) prompted as one. |
| 5 Depth | holds | Part C1. |
| 6 The three verbs | holds | Part C. The steer arrived mid-sleep and was acted on. Each of five interrupts stopped the sleep within 2 s. A send to an idle session started a turn. The finding that the model was never told of the interrupt is below. |
| 7 Spawn, retire, resume | holds | Part D. A seat was spawned on `mini` and retired from the web. An ended terminal session showed "recorded, not delivered", and Resume brought it back in about 5 s under the same id (`D-chat-mini.txt`). |
| 8 The machine decides | holds, by the method decided on 2026-10-16 | Part G. Live (G1, G3): a forged `human` event and a forged RPC from the browser console were refused `bad-code` by both daemons (`G-*-daemon.txt`), and the web drew the refusal banner and the audit's rejected rows (`audit-after-G.txt`). Read-only (G6) was also live (`G6-on.txt`, `G6-off.txt`). G2, G4 and G5 were shown by the suites: MAWS gate 39004066775 and doperpowers' `sminos-suites`. A stopped seat under read-only was not exercised; the owner waived it. |
| 9 Offline | holds | Part E. With `mini`'s daemon booted out, the desk read one of two machines online and its session offline, and `mini` rejoined on bootstrap. |
| 10 No loss across restarts | holds | Part F: a Worker redeploy, a daemon restart and a browser reload while both machines wrote a 480-event loop. Before (`F1-counts.txt`) and after convergence (`F4b-counts.txt`) every writer agreed: 8 writers, 1,051 events, nothing lost or duplicated. `F4-counts.txt` caught the import lag below before it converged. |
| 11 The desk | holds | Part I. The owner worked about 18 hours across both Macs from the desk, in MAWS, a hub project since d7c926733. Verdict (owner, 2026-10-18): fine. The one thing that sent them to a terminal was **the working record**. |
| 12 The phone | holds | Part H. A question pushed, the notification opened its card, and the answer "pear" continued the session and closed `mini`'s dialog. A permission pushed and was denied from the phone. |

**Not verified.** The "Sign in again" round trip in the iPhone's installed app was never walked; the owner ended
the walk first. This is the path MAWS #33 added for a lapsed Access session, and since #35 an application session
lasts 30 days. Only the desktop browser's path has been seen working.

**What the walk turned up.** Each finding below was fixed while the walk was still running.
- **IPv6 blackhole (A2).** The MacBook's network has a global IPv6 route that is blackholed toward Cloudflare. The
  uplink tried the AAAA addresses first, serially, and every POST timed out at 60 s. Fixed with Happy Eyeballs
  (doperpowers #206, 7.162.2).
- **Interrupt invisible to the model (C3).** A desk interrupt left the model no record, so it believed the killed
  sleep was still running. #207 (7.162.3) added a record, and #225 (7.170.0) reshaped it into the engine's own
  marker plus a note.
- **Import lag (F).** Under load, the MacBook imported `mini`'s events up to about 5.7 minutes late, because the
  uplink took one frame per tick. Fixed by drain-then-tick (#208, 7.162.4).

Part I then turned into the working day it was meant to be, and the day produced children and fixes. Each one is in
the Tracking Map and the Decision Log:
- DC8 (machine history and jobs), DC9 (the session view) and DC10 (stopping a job from the web);
- the bridge's rows: a delivery appended into a running turn (#233), and a peer's message arriving as a peer's
  (#236);
- the owner's message after an Esc (#238), and the live chain's off-chain marks (#239, MAWS #48);
- the steer's own line (#240, MAWS #49);
- the async answer drawn as the answer, and the phone's top bar (MAWS #49, #51);
- the phone's direct channel as the session view, so the working record that sent the owner to a terminal draws on
  the phone (MAWS #55, reversing §4's phone binding);
- Access lapse detection and a 30-day session (MAWS #33, #35).

**Left for later.**
- The next phase is **MAWS #52**, from the owner's verdict: the desk becomes web MAWS plus a Claude Code
  remote-control client. It is ticketed for a discussion before any design. On 2026-10-19 the owner widened it
  (Decision Log, that date):
  - the remote protocol is rebuilt from their research on Claude.ai's Remote Control;
  - the desk benchmarks the Claude Code binary's Remote Control and claude.ai's RC surfaces;
  - the destination is one web workspace where a single client controls agents on every machine and project.

  Later that evening the owner set MAWS itself, ported to the web, as the feature yardstick, with Claude Desktop's
  SSH mode as the reference design for remoting (the Decision Log's last 2026-10-19 entry). The evidence is on #52:
  the baseline table and the diagnosed failures of 2026-10-19. The research is in MAWS PR #79. The platform direction
  of 2026-10-19 is on #52 too: a machine as the unit of connection, the org as the unit of access, IAM the machine
  verifies, and accounts in several orgs. Its first step, repositories becoming projects by their remote, is being
  built.
- Its likely prerequisites: MAWS #36 (sign-in and hosting), #37 (machine join tokens) and #38 (the org key's split).
- Phase 1 residue: MAWS #43, #44 and #45, and doperpowers #94, #95 and #96.
- The sminos org directory (doperpowers #93) is specced and being built.

**Retrospective.**
- **Real machines found what no suite did.** The suites run on loopback stand-ins and idle machines. Only the
  owner's own hardware, under its real load, exposed a blackholed IPv6 path, an interrupt the model never heard
  of, and an uplink that took one frame per tick. Each was found within an hour of the walk reaching it. The next
  phase should keep a walk like this one, on the same machines.
- **Inference was the fragile part.** At first the desk knew a steer only by exclusion, a rewound row by nothing,
  and an interrupt by a row shape the engine's own readers did not share. Each of these became a positive mark the
  machine writes: the steer's line, the off-chain marks, the engine's own marker. Where the desk reads a transcript,
  the writer should mark what each row means.
- **The standing deploy approval (2026-10-16) set the pace.** A finding went from diagnosis to a deployed fix in
  the same sitting, while the owner kept working. The gates that bound it held: no migration, no Access change and
  no secret without the owner.
- **What the owner still lacks is reading, not control.** Every verb worked from the web. What sent the owner back
  to a terminal was seeing what a session did between its messages, and that is where #52 begins.
