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
> `docs/charter.md` are MAWS. Its child and contract ids carry a `D` (DC1–DC7, DX1–DX8)
> because MAWS's own charter already binds C1–C12 and X1–X8 in that
> repository.

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
   working/waiting counts match `sminos list` run on each machine, within
   2 seconds of a change.
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
- **Daemon** — `sminos daemon` (smns §8), one per machine, a launchd agent;
  its **uplink** is the part that talks to the hub.
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
object is a WebSocket server, and on eviction "in-memory state is reset";
every deploy restarts every object and disconnects every connection. So:

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
- **After a deploy** browsers and daemons reconnect with backoff, and the
  daemon republishes presence, pending requests, and unacknowledged RPC
  results (DX2, DX6).

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
lifecycle (`joined`, `retired`, `in-charge`, `status`, `renamed`, `state`).
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
- **A project.** Left: `# <project>`, then the sessions as direct
  channels, grouped by waiting on you / working / idle / ended, each with
  its machine and its in-charge line; "+ Session". Center: the selected
  channel. Right: the selected session's depth (transcript, subagents,
  diff, session info: machine, cwd, worktree, model, context, cost).
- **The group chat** shows what is addressed to the human: messages,
  questions (answerable in place), permission prompts while pending
  (decidable in place), lifecycle as system lines, and what humans posted.
  Traffic between agents folds into one row per run, expandable. Posting
  follows `sminos say` (smns §4): untagged is a record that wakes no one,
  `@alias` delivers, `@all` wakes every live member.
- **A direct channel** is one session's exchange with the human — its
  messages, questions, and permission prompts, and what the human sent it —
  with the working record between them folded, as the to-human mod draws a
  session in the terminal. Unfolding opens the live transcript. An ended
  session's channel keeps its history and offers Resume. A message
  the bridge submitted as the human's words is drawn as the human's.
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
  (the transcript stream, the subagent tree, the diff) stays desktop-only.
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
| Send | log | `human` event → `deliver_next` → bridge `$.prompt.submit({asUser: true})`, queued until idle |
| Steer | RPC | bridge `$.session.append` of a user row, read at the loop's next request |
| Interrupt | RPC | bridge `$.turn.abort` (the main loop's turn), then `TaskStop` through `$.tool.call` on any Bash the abort moved to the background, as Esc kills it in the terminal |
| Answer a question | RPC | bridge: `classic.PermissionRequest` returning `updatedInput: {questions, answers}` for a native AskUserQuestion; the ask mod's external-answer path for an async one |
| Allow / deny | RPC | bridge `classic.PermissionRequest`, racing the terminal's dialog |
| Model, effort | RPC | bridge rewrites `model` and `effort` on each of the session's requests in `turn.step` (this session only). `$.config.set({key: 'model'})` was rejected: it also saves the model as the user's default in `settings.json` (DC1) |
| Compact | RPC | bridge `$.session.compact()`; asked during a turn, the bridge holds it and runs it at `turn.complete` (the engine refuses it mid-turn) |
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
| Send | log → `deliver_next` → `$.prompt.submit`, queued until idle | `control.sock` `reply`, at the next step | cross-session frame, at the next tool round | in the log; delivered when the daemon reconnects |
| Steer | `$.session.append`, at the next model request | `reply`, at the next step | as send | fails at once |
| Interrupt | `$.turn.abort` and `TaskStop`, within 2 s | no | no | fails at once |
| Question | native: `PermissionRequest` racing the dialog; async: the ask mod's external path | native: `reply` answers it; async: none (the ask mod is itself a mod) | terminal only | shown, not answerable |
| Allow / deny | `PermissionRequest` racing the dialog; a background subagent's prompt within its 3 s window, then terminal only; a person-only prompt terminal only | terminal only | terminal only | shown, not answerable |
| Model / compact | per request / at the turn's end | no | no | fails at once |
| Messages to the human | as each span completes | at Stop (the record hook) | at Stop | already in the log |
| Presence | the session record, within 1 s | same | same | the last `state` event, with its age |
| Depth | rows (100 ms flush) and `turn.step` chunks, subagents included | rows | rows | unavailable |
| Retire | `--bg`: `claude stop`; terminal: `retired` recorded, the process stays the human's | `claude stop` | `retired` recorded, the process stays the human's | fails at once |
| Resume (ended) | Resume RPC | Resume RPC | Resume RPC | fails at once |

Spawn is a machine RPC, not a session's; it fails at once for a machine
that is offline.

Not in phase 1, because the mod API cannot do them reliably: switching a
live session's permission mode, interrupting one subagent, rewind, and
fork.

### 6. Security, phase 1

- **Humans** sign in through Access in front of the Worker. The registry
  holds one org with the owner as its admin.
- **Machines** enroll with a one-time code the browser generates and the
  owner runs as `sminos hub enroll <code>` on the machine. The code carries
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
  - *The org key* is a 256-bit secret derived in the browser from the
    owner's passkey through the WebAuthn PRF extension (HKDF over the PRF
    output with the org id), or from a passphrase where PRF is unavailable;
    any browser holding the passkey derives the same key. It reaches each
    machine only inside the enrollment code, by the owner's hand.
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
   sessions through one project's object, measured (DC3.G6); one object per
   session for the session plane is the fallback, taken when the
   measurement crosses the threshold DC3 records.
4. **WebAuthn PRF and Access on the phone** (DC5): PRF support in the
   owner's browsers with an iCloud Keychain passkey, and inside an iOS
   home-screen app, whose storage is separate from Safari's, so the key is
   derived again there; Cloudflare Access sign-in inside the standalone app
   (the identity provider's redirect leaves the app's scope, so the Access
   cookie must land in the standalone context); Access session lifetime
   against a push tapped hours later. The passphrase path covers missing
   PRF.
5. **The path to watch.** The engine's channel servers (an MCP server
   declaring `claude/channel` that pushes messages into a session, which
   replies through a tool) are the engine's own shape for "an outside
   service talks to a session"; they are gated behind a flag and an
   Anthropic allowlist today. If they open, the send-and-answer half of the
   bridge can become a small server with native provenance.

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
- **Status:** in-flight (2026-10-15).

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
    which the session plane moves to one object per session.
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
- **Status:** in-flight (2026-10-15).

### DC4: The uplink — plan

- **Purpose:** The machine's connection to the hub and the log plane over
  it: the daemon becomes concurrent, enrolls, syncs hub projects' logs with
  authentication codes, and writes the archive.
- **Acceptance:**
  - **G1 (enroll):** `sminos hub enroll <code>` enrolls a machine under its
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
- **Status:** in-flight (2026-10-15).

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
  - **G3 (the key):** the org key derives from a passkey through PRF in the
    owner's browsers, or from a passphrase; the enrollment code it produces
    enrolls a machine through DC4.
  - **G4 (the phone):** installed to an iPhone's home screen, the app signs
    in through Access, derives the org key, and draws the grid, the group
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
- **Status:** in-flight (2026-10-15).

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
- **Status:** not-dispatched (blocked-by DC5.G1, DC3.G1).

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
    settled delivery of an outside-origin event produces its DX4 `delivery`
    outcome (delivered, recorded for a closed terminal session,
    refused-read-only), which the web shows.
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
- **Status:** not-dispatched (blocked-by DC2.G1, DC4).

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
  events and RPCs up, with their results. Binds DC5, DC6.
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
    tool, input, mac}`, followed by exactly one `settled {request, winner:
    "web" | "terminal" | "other", outcome, by, mac}`, where the bridge names
    the side whose answer the engine used. The hub removes the request on
    `settled` and writes its audit record from it; after a reconnect it
    drops any request the daemon does not republish;
  - **a delivery outcome** is `delivery {event: {writer, seq}, session,
    outcome: "delivered" | "recorded" | "refused-read-only" | "failed",
    reason, mac}`, produced by the daemon when `deliver_next` settles an
    event for a recipient on its machine, one per event and recipient. It
    is how the web knows that a send reached the session, or was only
    recorded (a closed terminal session) or held back (a read-only
    machine). The hub keeps the latest outcome per key and returns it to a
    browser that reconnects. It is kept apart from `settled`, which is
    about a session's pending request, not a log event.
  The hub interprets presence, pending requests, and delivery outcomes;
  everything else it relays.
  Binds DC2 and DC7 (produce), DC3 (relays, implements the semantics in its
  fake machine), DC5 and DC6 (consume).
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
  steer's row is in the transcript) and otherwise answered `failed:
  interrupted`, for the human to look at. An unknown nonce older than 60
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
  `src/renderer/src/transcript/shell.tsx`. Binds DC6.

## Interfaces

Filled by the contract owners at their gates: DX2, DX3, the DX4 envelope, the
DX6 shapes, and DX7 by DC3 at G1; DX5 by DC2 at G1; DX8 by DC5 at G1. Each lands as a subsection
here, reviewed with its gate, and a later change to one is a Decision Log
entry that flags its consumers.

DX1's vectors, DX2, DX3, the DX4 envelope, the DX6 shapes, and DX7 are
folded verbatim from DC3's M1 (MAWS `140c834b`, reviewed) and replaced
by its G1 amendment (MAWS `29294260`, reviewed), which carries the
Interfaces review's fixes; parts marked *M2, provisional* are fixed at
DC3's M2. Their
reference is the protocol module `apps/desk-hub/src/protocol/` (exported
as `desk-hub/protocol`) with its vectors
`apps/desk-hub/src/protocol/vectors/codes.json`, written by `generate.py`
beside them, a stdlib-Python implementation independent of the
TypeScript one: where this text and the module ever differ, the module's
tests decide and the text is corrected. Each subsection ends with what
DC3's later milestones extend. DX5 is DC2's; DX8 waits for DC5.

Conventions throughout: hub-owned multi-word fields are snake_case (as smns's log and DX6's `input_sha256`); fields
that pass through from the engine keep the engine's camelCase (`turnId`, `agentId`, `upTo`, `waitingFor`). Times are
ISO 8601 UTC with milliseconds. A nonce is 128 random bits, base64url without padding (22 characters).

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

### DX2 — Machine ↔ hub (owner DC3; G1)
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
and POST belongs to the newest. The object writes `hb {at}` every `heartbeat_ms` (15 000), and the daemon answers each
with `hb-ack {generation, at}` (the stream's generation and the answered heartbeat's `at`). The daemon treats a stream
silent for three periods as dead and reconnects with backoff. A client closing the stream reaches the object at once
(the request's abort, compatibility flag `enable_request_signal`).

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
| `unsubscribe` | `project`, `sub` | end it |
| `rows` | `project`, `session`, `agentId`, `sub`, `before`, `limit` | older rows of the sub's transcript, before row `before` |
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
`(writer, seq)` whose canonical form differs), `gap`, `bad-shape`, `too-large`, `stale-generation`, and — *M2,
provisional* — `not-open` (events for a project this stream has not opened with `hello`).

**Upward refusals.** A daemon that refuses an event the hub sent it — its code fails (which includes a `hub/` event
whose position fails DX1's shape check, and an event transplanted from another project), its nonce was seen, or it is
not a log event the daemon can read — keeps it out of its log and reports `rejected` with the project, `reason`
(`bad-code`, `seen-nonce`, or `bad-shape`), an optional `message`, and the event named by what it carried, never by
anything the daemon makes up:
- `event` is `{writer, seq}` exactly as they arrived when `writer` was a string and `seq` a number, however wrong
  otherwise (a `hub/` writer failing its shape is reported as it came, control characters and all), and **null** when
  either was missing or of another type — written out as null, not left out;
- `nonce` is its `mac.nonce` exactly as it arrived when that was a string, and absent otherwise.

So an event may be named by its position, by its nonce alone, by both, or by neither; an event that carried neither is
still reported (`event: null`, no `nonce`), so its refusal shows, and `message` says what it was. The hub keeps the
report in the project's audit record and shows it to the project's browsers (DX3 `rejected`), apart from its own
refusals of uploads (`refused`). This is how a forgery placed at the hub shows in the web (the composite's acceptance
8).

**The log handshake, per project.** The daemon sends `hello` with its vector; the hub answers `have` with its own and
then streams, as `events`, every writer's suffix the machine lacks. The daemon uploads, as `events`, the suffix of
its own writers (`<machine>/…`, sminos's `writer_id`) beyond the hub's vector; the archive machine also uploads the
project's `legacy/` feeds (pre-`.smns` chats, frozen, so the one-payload rule keeps them intact). Inserts are
idempotent on `(writer, seq)`; then both directions tail live. A machine sending `hello` for a project id the
registry does not know registers it, under the `name` it sent; any enrolled machine of the org may.

**The POST's answer and the replies** (*M2, provisional*). The hub writes its replies to a POST's frames — `have`
and the backlog after a `hello`, `resend`, `refused` — down the stream, in frame order, and answers the POST only
after they are written: `200 {"ok": true, "frames": <frames applied>}`. So when a POST returns, its replies are
already on the stream ahead of anything later. The POST itself is refused whole, with nothing applied, as `409
{"error": "stale-generation"}` when `X-Desk-Generation` is not the machine's current stream (or it has none: open the
stream first), `413 {"error": "too-large"}` over 4 MiB or for a frame over 1 MiB, and `400 {"error": "bad-shape",
"line": <0-based>}` for a line that is not a JSON frame. Events for a project not opened by `hello` on the current
stream are refused `not-open`. A gap is not a refusal: the hub stores the writer's events up to it, answers `resend`
from its next seq, and skips that writer's later events in the batch.

**After every (re)connect** the daemon sends, per project: `hello`; `pending` with its complete set (the hub drops any
request of that machine's the set no longer holds); every `rpc-result` the hub has not acknowledged; and its
presence as DX4 `machine` and `presence` messages.

**Liveness is a lease** (M3 builds it): a `Project` holds a machine online only while its lease is fresh. Only traffic
from the daemon renews it — its `hb-ack`, which carries the stream's `generation`, never the hub's own heartbeat — so
a suspended daemon or a half-open stream lapses within the lease; a renewal or close from an older generation is
ignored. When the lease lapses, or the current generation's stream closes, the machine is offline, its subscriptions
end (`end {reason: "machine-offline"}`), and its forwarded RPCs without a result become `uncertain` (DX6).

**Frame bound.** Every frame, either direction, is at most 1 MiB of UTF-8. A larger one travels as `part` frames:
each holds a slice of the frame's JSON text (`data`), all with one random `id` and the set's `count`, `index` from 0;
the receiver joins the slices in index order when the last arrives, in whatever order they came, and parses the
whole. A slice never splits a surrogate pair. (`toWire` and `PartAssembler` in `parts.ts`.)

**Measured (M1's probe on the owner's account, 2026-10-15):** an SSE stream held by a Durable Object for 11 minutes
with 15-second heartbeats, never evicted; a second stream idle 150 seconds between heartbeats also held, so the
15-second period is margin, not a requirement found on `workers.dev`; a write from another object's RPC reached the
stream (RPC 43–134 ms); the client's close reached the object at once through the request's abort.

**Left for M2:** `resend`, `refused`, and `rejected` in use, and the audit record; registration by `hello`; the archive
flag in `have`. **For M3:** the lease's length, `hb-ack` in use, `rpc` forwarding and `rpc-ack`, the subscription
frames in use.

### DX3 — Browser ↔ hub (owner DC3; G1)
**Transport.** WebSockets, JSON text frames, behind Access (the browser's Access session becomes the assertion on the
upgrade request like any other):
- `GET /api/projects/<project id>/socket` — a project's view, held by its `Project` object with the Hibernation API.
  Each socket's member, visibility, and subscription ids ride in its attachment, so a woken object can route again.
  *M2, provisional:* a project id the registry does not hold is refused, `404 {"error": "unknown-project"}`; a project
  is registered by the first machine that syncs it (DX2).
- `GET /api/registry/socket` — the grid, held by the org's `Registry` (M3).
- `GET /api/me` — `{org: OrgRecord, member: MemberRecord}` for the signed-in member (DX7); `403 {"error":
  "not-a-member"}` for a person Access admitted whom the org does not hold.

**Frames up** on a project socket (`ProjectUp`):

| `t` | fields | meaning |
| --- | --- | --- |
| `resume` | `after` | every event with an offset above `after` (0 is the start), then `caught-up`, then live |
| `human` | `event` (a sealed `HumanEvent`) | a web `human`; the hub assigns `writer` `hub/<member>`, `seq`, `ts` and answers `human-ack` |
| `rpc` | `rpc` | a sealed RPC (DX6); answered by `rpc-state` |
| `subscribe` | `machine`, `session`, `agentId`, `sub` | a DX4 subscription scoped to one transcript (`agentId` null for the main one); `sub` is the browser's own nonce, unique at the machine |
| `unsubscribe` | `sub` | |
| `rows` | `sub`, `before`, `limit` | older rows of the subscription's transcript |
| `visibility` | `visible` | whether this tab shows the project; a visible tab holds back its member's pushes |
| `part` | as DX2 | |

`HumanDraft` is `{kind: "human", from: "human", member, to: "*" | [{session, alias}], text, created, wake?}`; the
browser seals it as a log event (DX1), so `HumanEvent` is that plus `mac`. The hub accepts it only when `member` is
the signed-in member. *M2, provisional:* a `human` whose `mac.nonce` the hub already stored from this member is not
stored again — the hub answers `human-ack` with the stored event's offset, writer, and seq — so a browser that lost
its answer resends the same sealed event safely; the same nonce with a different payload is refused (`conflict`).

**Frames down** on a project socket (`ProjectDown`):

| `t` | fields | meaning |
| --- | --- | --- |
| `welcome` | `project`, `member`, `head` | first on every socket: whom the hub admitted, and the project's latest offset |
| `log` | `events`: `[{offset, event}]` | log events with their project offset beside them (never inside: a stored event's code verifies as it did on arrival) |
| `caught-up` | `offset` | the backlog after `resume` is sent |
| `human-ack` | `nonce`, `offset`, `writer`, `seq` | the web `human` with this `mac.nonce` is stored |
| `session` | `message` | a DX4 message |
| `pending` | `requests`: `[{machine, raised, terminal_only}]` | the project's pending set, on connect and whenever it changes (a raise, a settlement, a machine's republish, a `deadline` passing); `terminal_only` (below) |
| `deliveries` | `deliveries` | the latest DX4 `delivery` per event and recipient, on connect |
| `machines` | `machines`: `[{machine} + MachinePresence]` | machine presence, on connect and on change |
| `rpc-state` | `nonce`, `state`, `outcome?` | `forwarded`, `done`, `failed`, or `uncertain` (DX6) |
| `refused` | `refusal`: DX2's `Refusal` with `id`, `at`, and `nonce?`, `machine?`, `member?` | a refusal of the hub's own, recorded in the audit record: to the sender and to the project's browsers |
| `rejected` | `rejection`: DX2's `Rejection` with `id`, `at`, `machine` | a daemon's report of an event it refused (DX2 `rejected`), recorded in the audit record: to the project's browsers |
| `part` | as DX2 | |

**The audit record.** Every `refused` and `rejected` is an entry of the project's audit record, kept in the object's
storage: `id` is its place in the record (rising; an entry seen twice is one entry) and `at` when the hub recorded it.
*M2, provisional:* after `caught-up`, the hub replays the record's latest 100 entries as `refused` and `rejected`
frames, oldest first, so a browser that was not connected when something was refused still sees it. M3 adds the
decisions (`settled`) to the same record.

**`terminal_only`** is the hub's, computed by its own clock: a background subagent's request whose `raised.deadline`
has passed. Such a request stays pending (nothing is settled at the deadline) but only the terminal can answer it, and
the web draws it as waiting in the terminal, without Allow or Deny. The web reads it from `pending` and never compares
`deadline` with its own clock; the hub sends `pending` again when the deadline passes (an alarm, M3).

**Grid** (`GridDown`, registry socket): `grid {projects: [ProjectSummary]}` on connect, then `summary {project}` on
change; `ProjectSummary` is `{id, name, machines, machines_online, working, waiting}`.

**Left for M2:** `resume`, `log`, `caught-up`, `human`, `human-ack`, `refused`, and `rejected` in use, and
`welcome.head` from the stored log (M1 sends 0). **For M3:** the session-plane frames, `rpc-state`, `pending`,
`deliveries`, `machines`, `visibility`, the registry socket and its summaries, the attachment's subscription ids.

### DX4 — The session-plane envelope (owner DC3; G1)
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
  | Envelope<'row' | 'chunk' | 'block-row' | 'rows' | 'subagents' | 'diff' | 'end', string, string, number>   // then n = 1, 2, …
  | Envelope<'presence' | 'raised' | 'settled' | 'delivery', string, null, null>                 // to every browser, outside subs
  | Envelope<'machine', null, null, null>;                                                         // names no session
```

(`session.ts` writes it as a mapped type over the kinds, one `Envelope` per kind, so a `chunk` without a sub or a
`machine` message with a session fails to typecheck.)

**A subscription's scope** is one transcript, named when the browser subscribes (DX3) and carried to the machine
(DX2): the session's main transcript (`agentId` null) or one subagent's. The snapshot's rows and every `rows` page
come from that transcript alone. A main-scope sub also carries every agent's chunks and `block-row`s, and the
subagent tree; an agent-scope sub carries that agent's rows, chunks, and `block-row`s, and its snapshot's `subagents`
and `streaming` are that agent's own.

| `kind` | in a sub | body |
| --- | --- | --- |
| `snapshot` | yes (`n` 0) | `{rows, more, subagents, presence, streaming}`: rows of the sub's transcript newest first up to the last flushed row, as many as fit the frame budget; `more` whether older rows exist; `streaming`: the bridge's snapshot entries (DX5) passed through, one per model request still streaming, `{turnId, agentId, step, blocks: [{index, kind, text, upTo}]}` holding only its content blocks without a `block-row` yet, below (`step` the model request's ordinal in the turn; `index` the content block's, the same `index` its chunks carry; `kind` the block's type as the bridge names it; `upTo` the `chunkIndex` of the last chunk `text` includes, -1 for none) |
| `row` | yes | `{row, agentId}`: a transcript row verbatim; `agentId` the subagent whose transcript holds it, or null |
| `chunk` | yes | `{turnId, agentId, step, chunkIndex, chunk}`: DX5's chunk event, the `turn.step` chunk object verbatim under `chunk` (nested, since it has an index field of its own), `chunkIndex` its index in its message from 0 |
| `block-row` | yes | `{uuid, turnId, agentId, step, index}`: the engine wrote the row `uuid` for content block `index` of that step; sent before the row itself arrives |
| `rows` | yes | `{rows, before, more}`: older rows of the sub's transcript, newest first, answering a `rows` request |
| `subagents` | yes | `{subagents: [{agentId, meta}]}`, each `meta` a `subagents/*.meta.json` verbatim |
| `diff` | yes | `{base, text}`: unified diff of the working tree against the base branch |
| `end` | yes | `{reason: "unsubscribed" \| "machine-offline" \| "session-ended" \| "discontinuity" \| "error", message?}` |
| `presence` | no | `{record, bridge}`: `record` is `status`, `waitingFor`, `needs` of `~/.claude/sessions/<pid>.json` verbatim, null when no process is live |
| `machine` | no (`session` null) | `{online, policy: {read_only, ceiling}, checkouts: [{path, branch}]}`; `online` is the hub's, from the lease (a producer sends true) |
| `raised` | no | `{request, session, tool, input, deadline?, mac}` |
| `settled` | no | `{request, winner: "web" \| "terminal" \| "other", outcome, by, mac}` |
| `delivery` | no | `{event: {writer, seq}, session, outcome: "delivered" \| "recorded" \| "refused-read-only" \| "failed", reason, mac}` |

`raised`, `settled`, and `delivery` carry codes under their own domains (DX1). The hub interprets `presence`,
`machine`, `raised`, `settled`, and `delivery`; it relays every other kind, `block-row` included, without reading its
body.

**Streaming is per content block.** One API response becomes several transcript rows, one per content block, and the
mod sees no API message id, so a streaming block is settled by row uuid. A `block-row` touches two parties at two
moments, kept apart:
- **The producer** (the bridge's endpoint; the fake machine) removes the block from its snapshot state when it applies
  the block's `block-row`, under the same lock that takes snapshots and adds subscribers. So a snapshot's `streaming`
  holds only blocks without a `block-row` yet, and never a block whose `block-row` was already sent to that
  subscriber.
- **The browser** keeps drawing the block's partial text after the `block-row` until the `row` whose `uuid` it named
  arrives; that row settles the block, and the browser drops the partial text then. Chunks for a settled block are
  ignored.

Together with the daemon dropping tailed rows the snapshot already holds (by uuid) and chunks at or below a block's
`upTo`, the snapshot and the live part neither overlap nor leave a gap.

**Discontinuity.** A gap in `n`, a hub restart, or a dropped connection makes the browser subscribe again for a fresh
snapshot. A gap in the bridge's own stream (DX5's `gap`) ends every subscription it touches with `end {reason:
"discontinuity"}`, and the browser does the same. Nothing is resumed from a hub buffer.

**Settlement (confirmed by DC2, DX4's producer).** `settled.outcome` is one of `allow`, `deny`, `answered`,
`withdrawn`. `winner` and `by` name who decided: `web` with `by` the member id; `terminal` with `by` `"terminal"`;
`other` with `by` `"cli"` for an answer from the local CLI. A request that ends with no answer used — the turn was
aborted, the session ended, or the call settled another way — is `outcome: "withdrawn", winner: "other", by:
"bridge"`.

**A background subagent's deadline.** `raised.deadline` (optional) is when the web's window on a background
subagent's prompt closes (§2's 3 seconds). Nothing is settled then: the request stays in the pending set, no longer
answerable from outside, until the terminal answers, which settles it with `winner: "terminal"` and the real outcome.
The hub keeps it pending and marks it `terminal_only` in DX3's `pending` (decided here: an explicit flag computed by
the hub, not a comparison the web makes with its own clock, which would be subject to skew).

**Left for M3:** the relay and the hub's reconnect buffer; `end` on a lapsed lease. **For M4:** the fake machine
producing all of it, `block-row` for its rows included.

### DX5 — Local bridge protocol (owner DC2; version 1 as amended by DC2's M1 review, folded 2026-10-15)

Folded from DC2's plan (doperpowers `a3756267`,
`docs/doperpowers/plans/2026-10-15-arkho-desk-c2-bridge.md`, built at DC2's
M1 and amended by its review's fix waves, `79bb122b` and `6ac34e14`; rows
marked [fw1] or [fw2] changed there). Rows marked reserved are proposals
that DC2's M2 and M3 fix and send as extensions; until DC2 closes, its
plan's copy is the working text and this one is refreshed from it at each
extension. Paths in this subsection are doperpowers'.

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
| `usage` | M1 | `context: {tokens, window, percent}, cost` — after each main turn |
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

### DX6 — RPC shapes (owner DC3; G1)

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
| `steer` | `{session, text}` | `{row}` — the uuid of the appended user row |
| `interrupt` | `{session}` | `{}` |
| `answer` | `{session, digest, answers}` — `answers` maps each question's text to the chosen label (several joined by `", "`) | `{}` |
| `decide` | `{session, digest, decision: "allow" \| "deny", message?}` | `{}` |
| `model` | `{session, model?, effort?}` (at least one) | `{}` |
| `compact` | `{session}` | `{at: "now" \| "turn-end"}` |
| `spawn` | `{checkout, worktree?, brief, model?, effort?, permission_mode?}` | `{session, alias}` |
| `retire` | `{session}` | `{}` |
| `resume` | `{session}` | `{session}` — the same id |

`digest` is `{session, request, tool, input_sha256}` (DX1). An outcome is `{state: "done", result}` or `{state:
"failed", error: {code, message}}`; the hub's record of an RPC adds `forwarded` (sent, no result yet) and
`uncertain` (the machine's lease lapsed after forwarding, before a result).

**Error codes.** The hub's: `machine-offline` (no fresh lease: fails at once, nothing queued), `stale` (older than 60
seconds), `not-member` (`member` is not the signed-in member), `bad-shape`. The daemon's, before it executes:
`bad-code`, `read-only`, `digest-mismatch`, `not-pending` (the request is no longer pending), `unknown-checkout`,
`above-ceiling`, `no-session`, `unsupported` (the session's kind cannot, per §5's table), `session-live` (a Resume of
a session live somewhere). After a claim: `copy-started` (a Resume raced the owner reopening the session; the copy is
stopped), `interrupted` (below), `failed` (execution failed; `message` says how).

**At most once.** The nonce is the RPC's id. The daemon claims it in its ledger (`claimed`) before the RPC has any
effect, records the outcome before sending the result, and keeps the entry a day. A nonce the ledger knows is answered
from the ledger, before the freshness check, and never executed again. A nonce left `claimed` with no outcome (the
daemon stopped between the two writes) is not executed again either: it is reconciled from the action's own trace
where one exists (a spawned seat carries its nonce; a steer's row is in the transcript), and otherwise answered
`failed` with `interrupted`. A browser retry reuses the nonce; the hub answers it from its record or forwards it again
once the machine is back. Results reach the hub as DX2 `rpc-result` frames, republished until `rpc-ack`.

**Left for M3:** forwarding, the record per nonce, `uncertain` on a lapsed lease, `rpc-ack`. The policy (DC7) is
unchanged by these shapes.

### DX7 — Identity (owner DC3; G1)
**Access.** Members sign in through Access; the Worker verifies `Cf-Access-Jwt-Assertion` on every request (RS256
against the team's certificate endpoint, the application's AUD, the team's issuer, `exp` and `nbf`) and names a
person by `email` (with `sub`), a service token by `common_name`, its client id. The `Registry` then answers who that
is: a member (by email, case-insensitive), an enrolled machine (by client id), or no one (refused). No configuration
switches verification off; the Worker refuses everything while its deploy configuration is incomplete: `ORG_ID`,
`ORG_NAME`, `ORG_ADMIN_EMAIL`, `ACCESS_ISSUER`, `ACCESS_AUD`, `ACCESS_CERTS_URL`, and — *M2, provisional* —
`CF_API_URL`, `CF_ACCOUNT_ID`, and the secret `CF_API_TOKEN`, through which it mints and deletes machines' service
tokens (Cloudflare's API deployed; the local stand-in for Access locally). The one path that takes no assertion is
enrollment's redemption (below), which Access does not guard either.

**The org** is made from deploy configuration on first use, with `ORG_ADMIN_EMAIL` as its admin — never by whoever
signs in first.

**Records** (`identity.ts`):

```ts
type OrgRecord = { id: string; name: string; created: string };
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

**Enrollment's endpoints** (*M2, provisional*). Bodies are JSON; every error is `{"error": <code>, "message"?}`.

| Request | Who | Answer | Errors |
| --- | --- | --- | --- |
| `POST /api/enrollments` `{ttl_s?}` | an admin | `201 {enrollment: EnrollmentRecord, token}`: `token` is 256 random bits, base64url, shown once (the hub keeps only its hash); `ttl_s` from 1 to 3600, default 900 | `403 not-admin`, `400 bad-shape` |
| `POST /machine/enroll` `{token, machine}` (under the Worker's `/machine/*` routes, ahead of the web app's assets; the one path Access bypasses) | anyone holding the token (Access bypassed on this path) | `200 {org, machine, client_id, client_secret}`: the machine's service token, the secret shown once | `400 bad-shape`, `400 bad-name` (not an admitted machine name), `404 unknown-token`, `410 expired`, `409 confirmed` (the token's machine already connected: it is spent), `409 token-used` (the token is bound to another machine name), `409 name-taken` (another machine holds the name; nothing is bound, so redeem the same token under another name), `409 busy` (a redemption of this token is in flight: retry), `502 mint-failed` (Cloudflare's API failed: retry the same redemption) |
| `GET /api/machines` | a member | `200 {machines: MachineRecord[]}` | |
| `DELETE /api/machines/<name>` | an admin | `200 {revoked: <name>}`: the service token deleted, the record gone, the machine's stream ended, the name released, any archive designation of it cleared | `403 not-admin`, `404 unknown-machine` |
| `GET /api/projects` | a member | `200 {projects: ProjectRecord[]}` | |
| `PUT /api/projects/<id>/archive` `{machine}` | an admin | `200 {project: ProjectRecord}`; `machine` an enrolled machine's name, or null to clear | `403 not-admin`, `400 bad-shape`, `404 unknown-project`, `409 unknown-machine` |

Redemption recovers from every loss: a lost answer is recovered by redeeming again with the same token and name, which
rotates the credential; an answer that never came back from Cloudflare (a lost mint) leaves a token named
`desk-<org>-<machine>`, which the next redemption, the expiry, or a revocation deletes by name before anything is
minted under it. A pending enrollment lasts `ttl_s` from its latest redemption; the machine confirms it by any
authenticated request. The hub never sees the org key: the browser builds the enrollment code from the token.

**The enrollment code**, built in the browser so the hub never sees the org key, and run on the machine as `sminos
hub enroll <code>`: the text `smns-enroll-v1.` followed by the base64url (no padding) of the UTF-8 JSON object
`{hub, org, token, machine, key}` — `hub` the hub's origin (`https`, or `http` on a loopback host for the local
runtime), `org` the org id, `token` the one-time token, `machine` the name to claim, `key` the org key as base64url
(32 bytes). A decoder refuses another prefix, a damaged body, a key that is not 256 bits, a name that is not admitted,
and an empty field. (`encodeEnrollmentCode`, `decodeEnrollmentCode`.)

**Archive designation:** `ProjectRecord.archive_machine`, which DX2's `have.archive` tells that machine. **Push
subscriptions:** `PushSubscriptionRecord`, one per member device.

**Left for M2:** the endpoints above built and fixed, and how to run the local hub and its stand-in for Access.
**For M3:** the push-subscription endpoint and the VAPID public key.

## Ordering & Dependency Map

```
DC1 spike ──► DC2 bridge ──G1─────────────────────────┐
                                                    ▼
DC3 hub ──G1──► DC4 uplink ─────────────────────► DC7 machine's controls ──┐
        │                                                               ├──► recomposition
        ├──G1──► DC5 web: conversation ──G1──► DC6 web: depth ────────────┤    (acceptance 1–12)
        └──G5 (fake machine) ──► DC5.G2 and DC6 acceptance ───────────────┘
```

DC1 and DC3 start at once. DC3's G1 (the protocols) is its first deliverable
because three children wait on it; DC2's G1 likewise for DC7. DC5 and DC6 build
against DC3's fake machine, so they do not wait for the machine side; the
real two-Mac integration happens at recomposition. DC2, DC4, and DC7 change
doperpowers; DC3, DC5, and DC6 change the MAWS repository (`apps/desk-hub`,
`apps/desk-web`).

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
needs a registry index the project objects update on raise and settle).

**Explicitly out of scope (standing exclusions):** the hub storing
transcripts (§3); hosting sessions on the SDK wire (§2); depending on
Remote Control (Purpose); RPCs queued for a machine that is offline (§3);
a hub that connects into machines (§2).

## Tracking Map

| child | artifact | status |
| --- | --- | --- |
| DC1 bridge spike | findings: `docs/doperpowers/specs/2026-10-15-arkho-desk-c1-findings.md` | **landed 2026-10-15**: 11 items, every primitive promoted, six with a change folded into §2 and §5; probe kept at `/tmp/c1probe` |
| DC2 bridge | plan: `docs/doperpowers/plans/2026-10-15-arkho-desk-c2-bridge.md` (doperpowers, branch `worktree-smns-erb`) | in-flight (dispatched 2026-10-15, parent pin 8acb3958) |
| DC3 hub | plan: `docs/doperpowers/plans/2026-10-15-desk-dc3-hub.md` (MAWS, branch `smns-erb`) | in-flight (dispatched 2026-10-15) |
| DC4 uplink | plan: `docs/doperpowers/plans/2026-10-15-desk-dc4-uplink.md` (doperpowers, branch `worktree-agent-a6d7f69a8ab5f500f`, worktree `.claude/worktrees/agent-a6d7f69a8ab5f500f`) | in-flight (dispatched 2026-10-15, parent pin 1c4f1c42) |
| DC5 web: conversation | plan: `docs/doperpowers/plans/2026-10-15-desk-dc5-web.md` (MAWS, branch `smns-erb-web`) | in-flight (dispatched 2026-10-15, parent pin 1c4f1c42) |
| DC6 web: depth | — | not-dispatched |
| DC7 machine's controls | — | not-dispatched |

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

## Decision Log

- Decision: Verification. This composite gets one independent review round
  on the whole document from `doperpowers:adversarial-reviewer` (the spec is
  technical-heavy) and, in the same round, a second
  `doperpowers:adversarial-reviewer` on the children and contracts for
  buildability. Each plan child names its own branch-review rung in its
  execution document, xhigh for DC3, DC4, DC5, and DC7 by their size. Recomposition
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

## Outcomes & Retrospective

Pending — written when the unit closes. Closing is a RECOMPOSITION check:
verify Parent-Level Acceptance as written — all children landed is not the
same event — then retrospect.
