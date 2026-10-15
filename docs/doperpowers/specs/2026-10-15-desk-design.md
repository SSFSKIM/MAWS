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
| Steer | RPC | bridge `$.session.append` of a user row, read at the loop's next request; refused when no turn is running (the web offers Send instead); a turn that answers before any request read the steer gets one wake prompt, at most once per turn (DX5) |
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
| Send | log → `deliver_next` → `$.prompt.submit`, queued until idle | `control.sock` `reply`, at the next step | cross-session frame, at the next tool round | in the log; delivered when the daemon reconnects |
| Steer | `$.session.append`, at the next model request | `reply`, at the next step | as send | fails at once |
| Interrupt | `$.turn.abort` and `TaskStop`, within 2 s | no | no | fails at once |
| Question | native: `PermissionRequest` racing the dialog; async: the ask mod's external path | terminal only: the supervisor's `reply` goes out with `nextTurn`, which queues a prompt rather than answering, and no path sends one without it in phase 1; async: none (the ask mod is itself a mod) | terminal only | shown, not answerable |
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
   sessions through one project's object, measured (DC3.G6); one object per
   session for the session plane is the fallback, taken when the
   measurement crosses the threshold DC3 records.
4. **WebAuthn PRF and Access on the phone** (DC5): PRF support in the
   owner's browsers with an iCloud Keychain passkey, and inside an iOS
   home-screen app, whose storage is separate from Safari's, so the key is
   unwrapped again there; Cloudflare Access sign-in inside the standalone app
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
- **Status:** in-flight (2026-10-15).

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
- **Status:** in-flight (2026-10-15).

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

### DX2 — Machine ↔ hub (owner DC3; G1, amended; the log plane built at M2)

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
| `diff` | `project`, `session`, `sub` | the browser's DX3 `diff` on a main-transcript sub: answer with DX4 `diff` on that sub (M3) |
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
`(writer, seq)` whose canonical form differs), `bad-shape`, `too-large`, `not-open` (events, or a `rejected` report,
for a project the current stream has not opened with `hello`), `stale-generation`, and `gap` (kept in the type, never
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
`200 {"ok": true, "frames": <frames applied>}`. So when a POST returns, its replies are already on the stream ahead of
anything later. The POST itself is refused whole, with nothing applied, as `409 {"error": "stale-generation"}` when
`X-Desk-Generation` is not the machine's current stream (or it has none: open the stream first), `413 {"error":
"too-large"}` over 4 MiB or for a frame over 1 MiB (with its `line`), and `400 {"error": "bad-shape", "line":
<0-based>}` for a line that is not a JSON object with a string `t`. Blank lines are skipped. A frame naming no `.smns`
project id (a lowercase uuid) is refused `bad-shape` down the stream. `part` frames may span POSTs of one stream; a
set is joined when its last part arrives. The stream is checked again once the body has been read and before each
frame: when a newer stream of the machine opened meanwhile, the POST stops there with `409 {"error":
"stale-generation", "frames": <frames applied>}`, and nothing it would still apply reaches the newer stream's
projects (a `hello` that was already on its way never takes a newer stream's place in the project). When a reply
could not be written for a reason other than the stream having gone, the hub ends the stream and answers `503
{"error": "delivery-failed", "frames": <frames applied>}`: reconnect, send `hello` again, and the handshake heals
whatever was missed. A live event the hub could not deliver to a stream likewise ends that stream. The hub takes `hb-ack` now and renews nothing with it until M3; it passes
over `rpc-result`, `pending`, and every `session` message but `presence` (DX3) until M3. A machine should post serially: two POSTs in flight are applied
interleaved, which the handshake heals (a gap is resent) but costs a round.

**After every (re)connect** the daemon sends, per project: `hello`; `pending` with its complete set (the hub drops any
request of that machine's the set no longer holds); every `rpc-result` the hub has not acknowledged; and its
presence as DX4 `machine` and `presence` messages.

**Liveness is a lease** (M3 builds it): a `Project` holds a machine online only while its lease is fresh. Only traffic
from the daemon renews it — its `hb-ack`, which carries the stream's `generation`, never the hub's own heartbeat — so
a suspended daemon or a half-open stream lapses within the lease; a renewal or close from an older generation is
ignored. When the lease lapses, or the current generation's stream closes, the machine is offline, its subscriptions
end (`end {reason: "machine-offline"}`), and its forwarded RPCs without a result become `uncertain` (DX6).

**Frame bound.** Every frame on the wire, either direction, is at most 1 MiB of UTF-8, measured before it is read; a
browser's larger frame is refused `too-large`, unread. A larger frame travels as `part` frames, and a joined set is
one logical frame, which may be larger than 1 MiB (the bound is the wire's):
each holds a slice of the frame's JSON text (`data`), all with one random `id` and the set's `count`, `index` from 0;
the receiver joins the slices in index order when the last arrives, in whatever order they came, and parses the
whole. A slice never splits a surrogate pair. (`toWire` and `PartAssembler` in `parts.ts`.)

**Measured (M1's probe on the owner's account, 2026-10-15):** an SSE stream held by a Durable Object for 11 minutes
with 15-second heartbeats, never evicted; a second stream idle 150 seconds between heartbeats also held, so the
15-second period is margin, not a requirement found on `workers.dev`; a write from another object's RPC reached the
stream (RPC 43–134 ms); the client's close reached the object at once through the request's abort.

**Built at M2:** the stream, the POST, `hello`/`have` with registration and the archive flag, the backlog, `events`
both ways, `resend`, `refused`, and `rejected` with the audit record (proved on the local runtime by
`test/log.test.ts`: two machines and a `hub/` writer interleaving, a gap, a cut mid-backlog, a runtime restart between
uploads, forged writers, a conflict, a respelled code, a stale POST, an unopened project). **For M3:** the lease's
length, `hb-ack` renewing it, `rpc` forwarding and `rpc-ack`, the subscription frames, `pending`.

### DX3 — Browser ↔ hub (owner DC3; G1, amended; the log plane built at M2)

**Transport.** WebSockets, JSON text frames, behind Access (the browser's Access session becomes the assertion on the
upgrade request like any other):
- `GET /api/projects/<project id>/socket` — a project's view, held by its `Project` object with the Hibernation API.
  Each socket's member, visibility, and subscription ids ride in its attachment, so a woken object can route again.
  A project id the registry does not hold is refused, `404 {"error": "unknown-project"}`; a project is registered by
  the first machine that sends `hello` for it (DX2).
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
| `diff` | `sub` | the session's working-tree diff against its base branch, answered as DX4 `diff` on that sub; only on a main-transcript subscription (`agentId` null). Computed on request, never pushed, since it costs the machine a git run whether or not a view is open (M3) |
| `visibility` | `visible` | whether this tab shows the project; a visible tab holds back its member's pushes |
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
across hibernation: the hub sends every event with an offset above `after` in `log` frames of about 256 KiB, then
`caught-up {offset}` with the head, then each new event live as it is stored. A socket that has not resumed gets no
`log` frames. Resuming again sends the backlog again from the new `after`. `welcome.head` is the latest offset when the
socket opened.

**Frames down** on a project socket (`ProjectDown`):

| `t` | fields | meaning |
| --- | --- | --- |
| `welcome` | `project`, `member`, `head` | first on every socket: whom the hub admitted, and the project's latest offset |
| `log` | `events`: `[{offset, event}]` | log events with their project offset beside them (never inside: a stored event's code verifies as it did on arrival) |
| `caught-up` | `offset` | the backlog after `resume` is sent |
| `human-ack` | `nonce`, `offset`, `writer`, `seq` | the web `human` with this `mac.nonce` is stored |
| `session` | `message` | a DX4 message. Built at M2 for `presence` only: right after `welcome`, each session's latest `presence` the project's machines reported, one frame per session; then each `presence` as a machine posts it, to every socket of the project |
| `pending` | `requests`: `[{machine, raised, terminal_only}]` | the project's pending set, on connect and whenever it changes (a raise, a settlement, a machine's republish, a `deadline` passing); `terminal_only` (below) |
| `deliveries` | `deliveries` | the latest DX4 `delivery` per event and recipient, on connect |
| `machines` | `machines`: `[{machine} + MachinePresence]` | machine presence, on connect and on change |
| `rpc-state` | `nonce`, `state`, `outcome?` | `forwarded`, `done`, `failed`, or `uncertain` (DX6) |
| `refused` | `refusal`: DX2's `Refusal` with `id`, `at`, and `machine?` (a machine's upload), or `member?` and `nonce?` (a browser's frame) | a refusal of the hub's own, recorded in the audit record: to every browser of the project, the sender included |
| `rejected` | `rejection`: DX2's `Rejection` with `id`, `at`, `machine` | a daemon's report of an event it refused (DX2 `rejected`), recorded in the audit record: to every browser of the project |
| `part` | as DX2 | |

**The audit record.** Every `refused` and `rejected` is an entry of the project's audit record, kept in the object's
storage: `id` is its place in the record (rising; an entry seen twice is one entry) and `at` when the hub recorded it.
An entry goes to every browser of the project as it is recorded, whether or not the browser follows the log; and
after each `caught-up`, the hub replays the record's latest 100 entries as `refused` and `rejected` frames, oldest
first, so a browser that was not connected when something was refused still sees it. M3 adds the decisions
(`settled`) to the same record.

**`terminal_only`** is the hub's, computed by its own clock: a background subagent's request whose `raised.deadline`
has passed. Such a request stays pending (nothing is settled at the deadline) but only the terminal can answer it, and
the web draws it as waiting in the terminal, without Allow or Deny. The web reads it from `pending` and never compares
`deadline` with its own clock; the hub sends `pending` again when the deadline passes (an alarm, M3).

**Grid** (`GridDown`, registry socket): `grid {projects: [ProjectSummary]}` on connect, then `summary {project}` on
change; `ProjectSummary` is `{id, name, machines, machines_online, working, waiting}`.

**Built at M2:** the socket's admission (a registered project), `welcome.head`, `resume`, `log`, `caught-up`, `human`
and `human-ack`, `refused` and `rejected` with the audit record and its replay, `session` frames carrying
`presence` (each session's latest on connect, then live), and `part` frames up (a part set a
socket sends is lost with a hibernation, as a half-sent frame would be). **For M3:** the other session-plane frames, `rpc-state`, `pending`,
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
  | Envelope<'row' | 'chunk' | 'block-row' | 'step-end' | 'rows' | 'subagents' | 'diff' | 'usage' | 'end', string, string, number>   // then n = 1, 2, … (`end` may come first, at n 0)
  | Envelope<'presence' | 'raised' | 'settled' | 'delivery' | 'compact', string, null, null>     // to every browser, outside subs
  | Envelope<'machine', null, null, null>;                                                         // names no session
```

(`session.ts` writes it as a mapped type over the kinds, one `Envelope` per kind, so a `chunk` without a sub or a
`machine` message with a session fails to typecheck.)

**An `end` may be a sub's first message**, at `n` 0, when the subscription ends before its snapshot could be taken: an
unknown session, a bridge not ready yet, a cut row that never reached disk (DX5). It carries the reason it would carry
later; on `discontinuity` at `n` 0 the browser subscribes again after a short backoff rather than at once.

**A subscription's scope** is one transcript, named when the browser subscribes (DX3) and carried to the machine
(DX2): the session's main transcript (`agentId` null) or one subagent's. The snapshot's rows and every `rows` page
come from that transcript alone. A main-scope sub also carries every agent's chunks and `block-row`s, and the
subagent tree; since it carries no subagent's rows, a subagent's `block-row` there settles that block at once, and the
browser drops its partial text (the row is drawn by that agent's own sub). An agent-scope sub carries that agent's rows, chunks, and `block-row`s, and its snapshot's `subagents`
and `streaming` are that agent's own.

| `kind` | in a sub | body |
| --- | --- | --- |
| `snapshot` | yes (`n` 0) | `{rows, more, subagents, presence, streaming, usage}`: `usage` is the bridge's last `usage` (DX5) on a main-transcript subscription, null when the session has no bridge or none has come yet, and absent on a subagent's; rows of the sub's transcript newest first up to the last flushed row, as many as fit the frame budget; `more` whether older rows exist; `streaming`: the bridge's snapshot entries (DX5) passed through, one per model request still streaming, `{turnId, agentId, step, model?, upTo, blocks: [{index, kind, text, upTo, id?, name?}]}` holding only its content blocks without a `block-row` yet, below (`step` the model request's ordinal in the turn; `model` what the request was sent with, absent when its start was not seen; the entry's `upTo` the `chunkIndex` of the last chunk applied to the message, -1 for none, and **the watermark**: `chunkIndex` counts across the whole message, so a chunk at or below it is already in the text, whichever block it belongs to; `index` the content block's, the same `index` its chunks and its `block-row` carry; `kind` one of `text`, `thinking` (redacted thinking included), `tool`; `text` the partial text, a tool block's being its argument JSON streamed so far, unparsed until its row; a block's `upTo` informational only; `id` and `name` the call's `tool_use_id` and tool name, on a tool block only). An entry whose `blocks` is empty can remain until its step ends and is skipped |
| `row` | yes | `{row, agentId}`: a transcript row verbatim; `agentId` the subagent whose transcript holds it, or null |
| `chunk` | yes | `{turnId, agentId, step, chunkIndex, chunk}`: DX5's chunk event, the `turn.step` chunk object verbatim under `chunk` (nested, since it has an index field of its own), `chunkIndex` its index in its message from 0 |
| `block-row` | yes | `{uuid, turnId, agentId, step, index}`: the engine wrote the row `uuid` for content block `index` of that step; sent before the row itself arrives |
| `step-end` | yes | `{turnId, agentId, step}`: that model request ended — finished, aborted, or cut off by its turn's end — from DX5's `step end` or `turn complete`; sent after every `block-row` of the step, so a block of it still without one never gets one, and the browser drops its partial text |
| `rows` | yes | `{rows, before, more}`: older rows of the sub's transcript, newest first, answering a `rows` request |
| `subagents` | yes | `{subagents: [{agentId, meta}]}`, each `meta` a `subagents/*.meta.json` verbatim |
| `diff` | yes | `{base, text}`: unified diff of the working tree against the base branch |
| `usage` | yes | `{context: {tokens?, window, percent?}, cost: {usd} \| null}`: the bridge's `usage` event (DX5) verbatim (`tokens` and `percent` absent until a response has reported the window's fill; `cost` null where the engine keeps no ledger), after each main turn, on main-transcript subscriptions only. It is the one source of a session's context use and cost on the web: the transcript's rows do not carry them (the engine's `cost-state` records have no `uuid` and are not rows here), so a session without a bridge shows both as unavailable |
| `end` | yes | `{reason: "unsubscribed" \| "machine-offline" \| "session-ended" \| "discontinuity" \| "error", message?}` |
| `presence` | no | `{record, bridge}`: `record` is `status`, `waitingFor`, `needs` of `~/.claude/sessions/<pid>.json` verbatim, null when no process is live |
| `machine` | no (`session` null) | `{online, policy: {read_only, ceiling}, checkouts: [{path, branch}]}`; `online` is the hub's, from the lease (a producer sends true) |
| `raised` | no | `{request, session, tool, input, deadline?, mac}` |
| `settled` | no | `{request, winner: "web" \| "terminal" \| "other", outcome, by, mac}` |
| `delivery` | no | `{event: {writer, seq}, session, outcome: "delivered" \| "recorded" \| "refused-read-only" \| "failed", reason, mac}` |
| `compact` | no | `{rpc, phase: "start" \| "end", tokensBefore?, tokensAfter?, skip?, error?}`: a compaction's progress, from the bridge's DX5 `compact` events; `rpc` the nonce of the DX6 `compact` that asked for it, or null for one the session started itself; on `end`, `tokensBefore` and `tokensAfter` (null when the engine recorded none), or `skip` (a hook vetoed it), or `error` (the engine refused it) |

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
  ignored. A block whose step ended (`step-end`) without a `block-row` for it — a response aborted mid-block — is
  dropped then, so no partial text outlives its request.

Together with the daemon dropping tailed rows the snapshot already holds (by uuid) and chunks at or below their
entry's `upTo`, the snapshot and the live part neither overlap nor leave a gap. A row no `block-row` named (a server
tool's, whose block streamed as none of the three kinds) settles nothing and is simply drawn.

**Discontinuity.** A gap in `n`, a hub restart, or a dropped connection makes the browser subscribe again for a fresh
snapshot. A gap in the bridge's own stream (DX5's `gap`), and the end of a DX5 subscription the daemon holds (the
child ends every open one when it applies any `resync` after its first: a module reload, a replacement child), each
end every DX4 subscription they touch with `end {reason: "discontinuity"}`, and the browser does the same. Nothing is
resumed from a hub buffer.

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

### DX5 — Local bridge protocol (owner DC2; version 1 with its M2 and M3 extensions, folded 2026-10-15)

Folded from DC2's plan (doperpowers `9055a181`,
`docs/doperpowers/plans/2026-10-15-arkho-desk-c2-bridge.md`): version 1 as
built at DC2's M1 and amended by its review's fix waves; the M2 extension,
reviewed clean after two fix waves (`75faba58`, `7842ae4e`); and the M3
extension (requests from outside and their settlement), reviewed clean
after two fix waves (`10f913d5`, `4b13cb9e`). Rows marked [fw1] or [fw2]
changed in the fix waves of the milestone that built them; rows marked
[M2] or [M3] were built or changed there. Until DC2 closes, its plan's
copy is the working text, and this one is refreshed from it. Paths in
this subsection are doperpowers'.

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
| `usage` | M1 | `context: {tokens?, window, percent?}, cost: {usd} \| null` — the engine's `$.session.usage()` context and cost as it returns them (`tokens` and `percent` absent before the first response; `cost` null without a ledger) — after each main turn |
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
| `steer` | M2 **[M2]** **[fw1]** | `{text}` | `{row: <uuid of the appended user row>}`. During the main turn: `$.session.append` of a user row (one text block), read at the main loop's next model request; the running tool goes on; mirrored as the transcript line `steer: <text>` (`$.ui.log`). Refused idle (`ok: false`, "no turn is running to steer: send it instead"). **[fw1]** The steer is bound to the main turn it was given in before the append is awaited. When that turn ends with `answer` and no main-loop request of it began after the row was in (or the turn ended while the append was pending, and the row then lands), the bridge submits **one wake prompt** (`asUser`) that does not repeat the steer. **[fw2]** The wake is owned by the originating turn: it is decided once the turn has ended *and* every append given in it has settled (in, refused, or failed), and is issued at most once per turn: "I added a note to the conversation while you were finishing your answer. Read it and act on it." (`STEER_WAKE`); the next request reads the row. A turn ending `aborted`/`error`/`refusal` wakes nothing. One wake per turn, however many steers |
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
| `POST /requests/<request>/decision` | M3 **[M3]** | `{behavior: "allow"\|"deny", message?, updatedInput?: {answers: {<question>: <answer>}}, by}`. `by` is `cli` or a member id (`terminal` and `bridge` are reserved). `updatedInput` only for a question, whose allow requires `answers` keyed by its questions. An async question cannot be denied | 200 `{accepted: true, request}`: the settlement follows on the stream. 400 `{error}`: malformed or not allowed. 404: not pending. 409 `{error: "already settled", settled}`. 409 `{error: "already answered by <by>; …"}`. 409 `{error: "the window … closed; the terminal answers it", terminalOnly: true}`: past a background deadline minus 200 ms. 409 `{error: "the terminal answered it; …"}`. For an async question, the child relays it as op `answer` (wait 5 s); the mod's refusal is a 409 carrying its error |

##### The child's stdout: lines for the mod

| Op | Built | Arguments | Result |
| --- | --- | --- | --- |
| `answer` | M3 **[M3]** | `{request, answers: {<question>: <answer>}, by}`: an async question's answer, relayed from `POST …/decision` | `{answered: true}` once the ask mod took it, which delivers it as tool-result context or as a plugin prompt when the session is idle; `ok: false` with the ask mod's reason otherwise (not pending, already answered, its dialog is up, not serving) |

##### Events

| `type` / `phase` | Built | Fields |
| --- | --- | --- |
| `raised` | M3 **[M3]** (was reserved) | `request` (the call's tool-use id; `toolu_plugin_…` for the ask mod's dialog; `request-<base36>-<n>` for a call no check named), `tool`, `input` (strings capped, fw1), `agentId`, `deadline?` (epoch ms, only for a background subagent: raise + 3000), `async?: true` (an ask mod async question, tool `mcp__doperpowers__AskUserQuestion`), `truncated?`. DX4's pending request. Raised only when the settings hooks beneath did not decide. A person-only prompt raises nothing |
| `settled` | M3 **[M3]** (was reserved), **[fw1]** | `request, winner, outcome, by`. `outcome` ∈ `allow \| deny \| answered \| withdrawn`. `winner` ∈ `terminal \| other \| web`. `by` is `terminal` when the terminal's answer was used, `cli` when the CLI's was (winner `other`), the member id when the web's was (winner `web`), and `bridge` for `withdrawn` (winner `other`). A passed deadline settles nothing: the request stays pending, answerable only in the terminal, until the terminal's answer settles it as `terminal` with its real outcome. Exactly one per `raised`. **[fw1] Evidence, all tied to the call's own id:** (1) the engine's `tool_decision` record for the call, which arrives at decision time: source `hook` with the bridge's handed-out decision of the same behavior means the decider; `user_temporary`, `user_permanent` or `user_reject` means the terminal, with the record's real outcome (accept is `allow`/`answered`, reject is `deny`); anything else (`user_abort`, `config`, a hook's decision the bridge did not hand out) means `withdrawn` by `bridge`. A request the bridge's interrupt aborted is `withdrawn` whatever the record says. (2) With no record within 1 s of a real call's result row, the call's transcript (its subagent's own for a subagent) once the result row is in it: a `hook_permission_decision` mark carrying the call's `toolUseID` means the hook's answer was used (then as (1) with source `hook`); none means the terminal's, with the outcome the result shows. (3) Neither available (the ask mod's dialog keeps no rows; the transcript unreadable or the result never written within about 2 s): `withdrawn` by `bridge`. A turn's end and the session's end withdraw as before. An async question answered through a dialog a press opened settles with that dialog's request: `answered` by its `by` (or `withdrawn` when the dialog's was) |
| `block-row` | M3 **[M3]** | `uuid, turnId, agentId, step, index`: the transcript row `uuid` holds block `index` of that message. Posted from `session.append` for each response row, paired by the row's block type and the order of the step's block starts (a tool row by its call id), never by position. The child removes the block from `streaming` under the lock; later chunks of that block are ignored. A row whose block never streamed (a server tool) names none |
| `chunk` | M1, **[M3]** | Unchanged on the wire. The child now folds each chunk into its **block** (`chunk.index`) |
| `resync` | M1 fw1, M2, **[M3]**, **[fw1]** | `turns, streaming` (per block, as the snapshot's, **[fw1]** each entry also carrying `settled: [<index>…]`, the blocks a `block-row` settled), `agents, override, delivered`, **`pending`** (each `raised`'s fields with `t`), **`settled`** (recent settlements). The child replaces its pending set with `pending` (keeping a request's decided/closed state) and merges `settled` with its own. **[fw1]** The child keeps an entry's `settled` blocks out of the message and ignores their late chunks, and a block it saw settled itself stays settled across the resync, even when the copy does not name it (the snapshot's `streaming` entry shape is unchanged: `settled` is never shown) |

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
| `steer` | `{session, text}` | `{row}` — the uuid of the appended user row; refused `idle` when no turn is running |
| `interrupt` | `{session}` | `{turnId, stopped, running}` — the aborted turn (null when idle), the background tasks stopped, and those whose stop failed; a non-empty `running` is an incomplete interrupt, drawn as such |
| `answer` | `{session, digest, answers}` — `answers` maps each question's text to the chosen label (several joined by `", "`) | `{}` |
| `decide` | `{session, digest, decision: "allow" \| "deny", message?}` | `{}` |
| `model` | `{session, model?, effort?}` (at least one) — `model` an id, a family alias the session maps, or `"default"` (§5) | `{model, effort}` now in force, null for the session's own |
| `compact` | `{session}` | `{at: "now" \| "turn-end"}` — answered at once; the compaction's outcome follows as the session's `compact` events (DX5), carried on the session plane by DC7 |
| `spawn` | `{checkout, worktree?, brief, model?, effort?, permission_mode?}` | `{session, alias}` |
| `retire` | `{session}` | `{}` |
| `resume` | `{session}` | `{session}` — the same id |

`digest` is `{session, request, tool, input_sha256}` (DX1). An outcome is `{state: "done", result}` or `{state:
"failed", error: {code, message}}`; the hub's record of an RPC adds `forwarded` (sent, no result yet) and
`uncertain` (the machine's lease lapsed after forwarding, before a result).

**Bound to where it runs.** Every enrolled machine holds the org key, so a valid code does not say which machine
should act. Right after the code verifies, the daemon refuses an RPC whose `machine` is not its own enrolled name
(`wrong-machine`), whose `project` is not a hub project of this machine with the org it enrolled in
(`unknown-project`), or whose session is not a session of that project on this machine (`no-session`), before the
ledger, before freshness, and before anything else. It never relies on the hub's routing for this.

**Error codes.** The hub's: `machine-offline` (no fresh lease: fails at once, nothing queued), `stale` (older than 60
seconds), `not-member` (`member` is not the signed-in member), `bad-shape`. The daemon's, before it executes:
`bad-code`, `wrong-machine`, `unknown-project`, `read-only`, `digest-mismatch`, `not-pending` (the request is no longer pending), `unknown-checkout`,
`above-ceiling`, `no-session`, `unsupported` (the session's kind cannot, per §5's table), `session-live` (a Resume of
a session live on its machine: a session's transcript lives on the machine that ran it, so "live anywhere" means any
process of this machine holding the session, terminal or `--bg`), `idle` (a steer while no turn is running: the web offers Send instead). After a claim: `copy-started` (a Resume raced the owner reopening the session; the copy is
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

### DX7 — Identity (owner DC3; G1, amended; enrollment built at M2; wrapped keys at M3)

**Access.** Members sign in through Access; the Worker verifies `Cf-Access-Jwt-Assertion` on every request (RS256
against the team's certificate endpoint, the application's AUD, the team's issuer, `exp` and `nbf`) and names a
person by `email` (with `sub`), a service token by `common_name`, its client id. The `Registry` then answers who that
is: a member (by email, case-insensitive), an enrolled machine (by client id), or no one (refused). No configuration
switches verification off; the Worker refuses everything while its deploy configuration is incomplete: `ORG_ID`,
`ORG_NAME`, `ORG_ADMIN_EMAIL`, `ACCESS_ISSUER`, `ACCESS_AUD`, `ACCESS_CERTS_URL`, `CF_API_URL`, `CF_ACCOUNT_ID`, and
the secret `CF_API_TOKEN` — the last three the API through which it mints and deletes machines' service
tokens (Cloudflare's API deployed; the local stand-in for Access locally). The one path that takes no assertion is
enrollment's redemption (below), which Access does not guard either.

**The org** is made from deploy configuration on first use, with `ORG_ADMIN_EMAIL` as its admin — never by whoever
signs in first.

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
**Push subscriptions:** `PushSubscriptionRecord`, one per member device.

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
enrollment pending). **For M3:** the push-subscription endpoint and the VAPID public key. **For M5:** the same against
Cloudflare's API and Access.

### Running the local hub and its stand-in for Access (DC3's M2; for DC4 and DC5)

**One command**, from the MAWS worktree root:

    pnpm --filter desk-hub local                     # options: -- --port <n> --user <email>

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

### DX8 — The web shell's slots (owner DC5; G1)

Folded from DC5's plan (MAWS `66eabe92`,
`docs/doperpowers/plans/2026-10-15-desk-dc5-web.md` on `smns-erb-web`),
written at DC5's M1 and reviewed clean with it (fix wave `16e3aaff`).

Owner DC5, written at M1 (DC5.G1); binds DC6. The reference is the code under
`apps/desk-web/src/shell/` (`slots.ts`, `slot-fallbacks.tsx`,
`session-plane.ts`, `sessions.ts`, `layout.ts`): where this text and those
types ever differ, the types decide and the text is corrected. A later
change is a Decision Log entry that flags DC6.

**Slots** (`slots.ts`, copied from MAWS's `src/renderer/src/app/slots.ts`).
`registerSlot(name, component)` returns its unregistration and the last
registration wins; `useSlot(name)` gives the registered component or the
shell's fallback (a quiet note of what will be there); `resetSlots()` for
tests. DC6 registers both slots from one `connectDepth()` called once from
`apps/desk-web/src/main.tsx`, as MAWS's `connectTranscript()` is called
from `App.tsx`.

| slot | props | where the shell mounts it |
| --- | --- | --- |
| `depth` | `{project, session: DeskSession \| null, plane: SessionPlane}` | the project view's right column while it is open; `session` is the selected direct channel's, null on the group chat and while the browser is locked |
| `transcript` | `{project, session: DeskSession, plane: SessionPlane}` | a direct channel's working record, unfolded in the center (DC5's M3 mounts it) |

**The session plane** (`session-plane.ts`), handed to both slots as `plane`:

```ts
type SessionTarget = { machine: string; session: string; agentId: string | null }; // agentId null: the main thread
type SubscriptionMessage = SessionMessage<'snapshot' | 'row' | 'chunk' | 'block-row' | 'rows' | 'subagents' | 'diff' | 'usage'>;
interface SubscriptionListener {
  message(message: SubscriptionMessage): void; // snapshot (n 0) first, then n = 1, 2, … with no gap
  reset(): void;                                // a discontinuity the client recovers from: drop what was delivered
  end(body: SessionBodies['end']): void;        // the hub ended it, or the client cannot serve it; nothing follows
}
interface Subscription { rows(before: string, limit: number): void; diff(): void; close(): void } // diff(): main transcript only
interface SessionPlane { subscribe(target: SessionTarget, listener: SubscriptionListener): Subscription }
const transcriptKey: (project: string, target: { session: string; agentId: string | null }) => string;
```

The hub client keeps a subscription whole: a gap in `n`, a dropped socket,
a hub restart, and the hub's `end {reason: "discontinuity"}` (the bridge's
own stream lost events) each become `reset`; the client gives the broken
sub up, subscribes again under a fresh `sub` once the socket is up, and a
fresh snapshot follows; a message of a given-up sub is never delivered.
Any other `end` (machine offline, session ended, unsubscribed, error) ends
it for good: the consumer subscribes again when it wants to, for instance
when `DeskSession` shows the machine back. `close()` ends it silently and
it is never re-subscribed. Older rows arrive as a `rows` message through
`message`. The target's `agentId` scopes the subscription to one
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
`setDepth(partial)`. The depth column's own tabs (transcript, subagents,
diff, info) are DC6's state.

**The transcript store.** DC6 imports MAWS's transcript model and
`useTranscriptStore` as they stand (the renderer survey) and keeps each
transcript under `transcriptKey(project, target)`. A `TranscriptSource`
built over `SessionPlane` maps `reset` to `onReset`. A transcript is live
while its `DeskSession` has `presence.record` non-null and `machineOnline`
not false; DC6 tells the store through `setLive(key, live)`, as MAWS's
`transcript/shell.tsx` does.

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
| DC6 web: depth | plan: `docs/doperpowers/plans/2026-10-15-desk-dc6-depth.md` (MAWS, branch `smns-erb-depth`) | in-flight (dispatched 2026-10-15, parent pin 9471766c) |
| DC7 machine's controls | plan: `docs/doperpowers/plans/2026-10-15-desk-dc7-controls.md` (doperpowers, at eb26c82d on `worktree-smns-erb`; built on branch `worktree-agent-ab2de4f299f415dbf`, worktree `.claude/worktrees/agent-ab2de4f299f415dbf`, merging DC4 at 7252a5d7) | in-flight (dispatched 2026-10-15, after DC4's M3 was reviewed clean) |

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

## Outcomes & Retrospective

Pending — written when the unit closes. Closing is a RECOMPOSITION check:
verify Parent-Level Acceptance as written — all children landed is not the
same event — then retrospect.
