# The desk's control surface: what the terminal can do, done from the desk (2026-10-22)

The living spec of one run, written from the research session's brief and inventory
(`~/claude-code-bundle/2.1.300/notes/desk-mod-run-brief.md` and
`desk-mod-surface-inventory.md`, 2-1-300-9a, 2026-10-21, the brief as amended by its
adversarial review) and the probe that measured commands on 2.1.307
(`mod-command-run-probe.md`). It extends the desk's design,
`docs/doperpowers/specs/2026-10-15-desk-design.md` (below, "the desk spec"): its
contracts DX2–DX6, its §5 control table, its §6 authentication model. From here on this
document is the reference, the inventory its input; where the two differ, §14 says so
and why.

## Purpose

The owner drives their Claude Code sessions from the desk — a phone, another Mac — and
today the desk reaches a tenth of what the terminal does: Send, Steer, Interrupt, a
question's answer, allow or deny, model and effort, Compact without instructions, a
job's Stop, Spawn, Retire, Resume. A `/skill` typed into the desk reaches the model as
words. There is no way to run a plugin command, ask a side question, see the context
grid, allow a tool "and don't ask again", approve a plan into a mode, stop one
subagent, or fork a conversation.

After this run, inside today's architecture (the bridge mod in each session → its
`sminos bridge` child → the machine's daemon → the hub → desk-web), two things are true:

1. **Control.** What the owner can do at the terminal they can do from the desk. The
   exceptions are the things that physically need keys in the terminal — a panel the
   engine draws, a dialog the hooks never see, a rewind picker, Shift+Tab — and the desk
   names each one and says why, instead of hiding it or failing when pressed.
2. **Latency.** Every desk load is as fast as its claude.ai/code Remote Control
   equivalent, at p50 and p95, under the same machine load, measured end to end from the
   person's action to useful content with usable controls, in three cohorts (cold, warm,
   reconnect).

**How to see it working.** Open the desk on the phone, pick a session on the MacBook,
type `/` — the typeahead opens at once with that session's commands, each badged where it
comes from and, for the ones the desk cannot run, why. Run `/rename desk-walk`: the
composer's status line says *queued*, then *ran*, then shows the engine's own line,
`Session renamed to: desk-walk`, read back from the transcript, and the channel's title
changes. Press *Side question*, ask "what did we decide about the cache?", and read the
answer in a side pane while the session's turn goes on. When the session asks to run
`git push`, the card offers *Allow*, *Deny*, and *Allow and don't ask again for this
session*. Pick the mini, still on last week's plugin: the same `/` opens, and each
control the mini cannot take says *mini's sminos predates desk commands: update
doperpowers on mini*. Turn the latency readout on (`?latency`) and read each new
control's time against its budget.

Done means both are shown working on the owner's two Macs (`macbook` and `mini`), which
run mixed versions while doperpowers rolls out; merged code alone does not count. MAWS
#52's full remote-client protocol continues separately; this run takes what the mod API
allows today.

## Progress

- [x] (2026-10-22 03:10Z) The spec written from the brief, the inventory, the probe, the
  desk spec and both repositories at their heads (MAWS `0ee14186a`, doperpowers
  `646cb02c`, sminos 1.6.2); the inventory's code cites re-checked (§14, Surprises).
- [ ] Self-review (execspec step 2) and the independent reviews (Decision Log, entry 1).
- [ ] The owner's calls on §15's forks (each has a recommendation; M0–M5 need none of
  them to start, M6 needs the first).
- [ ] M0 — foundation: capabilities, the `read` relay, the op-outcome pattern, the
  `command` op's dispatch with a three-row table (doperpowers; MAWS).
- [ ] M1 — the command spine: the route table whole, readback by row, the typeahead
  (gated on spikes 4–7).
- [ ] M2 — native panels from reads: side question, context and usage, model and effort,
  MCP, compact with instructions, status (`btw` gated on spike 3).
- [ ] M3 — requests and modes: rule suggestions, plan approval into a mode, the mode
  chip (gated on spike 1).
- [ ] M4 — agents, fork, following an id change (gated on spikes 2 and 8).
- [ ] M5 — composer parity: attachments, `@` files, history (attachments gated on spike 9;
  `!` shell on the owner's yes).
- [ ] M6 — the attach key driver for `--bg` seats (a stub until the owner answers).
- [ ] The latency table on #52 against the baseline, and the acceptance walk on both
  Macs.

## Terms

- **The engine** is Claude Code (2.1.307 on the owner's Macs at writing). A **mod** is a
  function-hook plugin the engine loads; **the bridge** is the sminos plugin's mod,
  doperpowers `sminos/hooks/mods/bridge.tsx` and its `bridge-*.tsx` siblings. `$` is the
  engine interface a mod calls (`$.command.run`, `$.session.usage`, …), typed in the
  2.1.300 bundle's `claude-code.d.ts`.
- **The child** is `sminos bridge --session <id>` (`sminos/skills/sminos/scripts/sminos_bridge.py`),
  spawned by the bridge for the session's life, serving the session's endpoint at
  `$SMINOS_HOME/bridge/<id>.sock` (DX5). An **op** is one command line the child hands
  the bridge (`{id, op, …}`), answered by a `result` event. A **DX5 event** is one line
  of the child's stream (`GET /events`).
- **The daemon** is `sminos daemon` on each Mac; its **uplink** (`sminos_uplink.py`)
  holds the machine's stream to the hub; its **plane** (`sminos_plane.py`) serves the
  session plane: presence and subscriptions. **RPCs** are the daemon's (`sminos_rpc.py`),
  DX6. The daemon is the execution boundary (desk spec §6).
- **The hub** is MAWS `apps/desk-hub` (a Cloudflare Worker and its Durable Objects);
  **the web** is `apps/desk-web`. **DX2** is machine ↔ hub, **DX3** browser ↔ hub, **DX4**
  the session-plane envelope, **DX5** the bridge's local protocol, **DX6** the RPC shapes
  (the desk spec's Interfaces, where each is defined; this document adds to them).
- **Presence** is DX4's per-session `{record, bridge}` message, kept by the hub and sent
  to every browser. A **subscription** (a **sub**) is one browser's live view of one
  transcript, numbered `n` from its snapshot.
- A **seat** is a session sminos spawned (`claude --bg`); a **terminal session** is one
  the owner opened. A `--bg` **job** is the engine supervisor's record of a seat.
- **X class**: an RPC that causes execution on the machine, so a machine its owner set
  read-only refuses it (`read-only`), and the daemon runs it only after the code, the
  machine, project and session, the ledger and the policy all hold (desk spec §6, DX6).
  Every RPC this document adds is X class.
- **A read** is a request over the session plane that changes nothing on the machine and
  answers on the sub that asked (today: `diff`, `output`; this document adds one `read`
  frame carrying several kinds).
- **The route table** is the bridge's classification of every built-in command by
  engine version: run, run-prompt, routed, follow, confirm, panel, local, drop (§2).
- **Readback** is how the desk learns what a command did: the engine's printed line
  exists only as a `<local-command-stdout>` transcript row, never in the call's
  settled value (the probe's H-noout).
- **Following** is the desk moving its selection and subscriptions to the new session
  id a command gave the conversation (`/clear`, `/branch`, `/resume <id>`,
  `/background`).
- **A capability** is one entry of the per-session list the bridge advertises and the
  web reads to decide what to offer and what to name as out of reach (§4).
- **The hazards** H-panel, H-noout, H-default, H-sid, H-esc, H-mcp, H-reply, H-queue and
  H-ctx are the inventory's §1, cited by name below; each is a measured fact about the
  engine, not a design choice.

## Acceptance

Each item is behavior a person can verify on the owner's machines, with the commands.
`<desk>` is the deployed desk; `<member>` a session as `sminos` names it (`alias#short`).
The readout is `localStorage['desk.latency'] = '1'` or `?latency`; `window.deskLatency()`
prints each path's n, p50, p95 and max. The **older-plugin machine** in each milestone
is the mini while it still runs the sminos version before that milestone's (the
rollout, §13); every milestone is walked once with the mini behind.

**M0 — foundation**

- A1. On a session whose bridge is at or above M0's sminos, the Info tab shows the
  engine's version and release base, its repository root and its surfaces within
  `B.read` of the tab opening (a `read status` answered on the sub). On the
  older-plugin machine the tab shows the same fields as *not available from this
  plugin* and the version it would need, not a spinner.
- A2. In the desk's composer, typing `/rename desk-m0` and pressing Send on a bridged
  session at M0's sminos shows *queued*, then *ran*, then *Session renamed to: desk-m0*
  with the mark *confirmed by effect*, and the session's title in the sidebar is
  `desk-m0` (`sminos list --here` shows the new name). `sminos watch <member> --json`
  shows one `command` event with `phase: "end"` and `readback.how: "effect"`.
- A3. The same typed `/rename` while the session's turn runs says *queued until
  <name> is idle*, and runs after the turn (H-queue: a mod-path command waits, even an
  `immediate` one).
- A4. Typing `/usage` (a panel) is refused: *opens a panel in the terminal; it would
  hold the session's queue*. Typing `/model sonnet` is refused with *use Model instead:
  /model saves a default for new sessions*. Typing `/foo` is refused *not a command this
  session knows*. At M0 the refusal is the bridge's (the RPC fails with that reason and
  nothing ran: `sminos watch` shows no `command` event); from M1 the composer refuses
  before sending, from the catalog, with the same words.
- A5. On the older-plugin machine, typing `/rename x` is refused in the composer with
  *mini's sminos (1.6.2) predates desk commands: update doperpowers on mini*, with a
  *Send as text anyway* that delivers it as words as today.
- A6. With the desk showing a session, stopping its bridge child (`kill <child pid>`;
  the mod respawns it) leaves the composer's controls as they were within 3 s (presence
  re-probed; capabilities unchanged). The e2e, against the fake machine, covers the
  case no live walk can stage: a presence whose capabilities shrink withdraws the
  controls with the reason.
- A7. A `command` RPC sent to a machine set read-only (`sminos daemon policy --read-only
  on`) fails *read-only* and nothing ran (`sminos watch` shows no `command` event).

**M1 — the command spine**

- A8. Typing `/` opens the typeahead within `B.palette` of the keystroke with no network
  round trip (the readout's `palette.open` samples are under it, and the socket shows no
  frame between keystroke and draw): every command `$.command.list()` lists for that
  session, grouped as MAWS groups them (Engine, Skills, Plugins, Custom), each with its
  description, and each that the desk cannot run marked with its reason (a panel; saves
  a default; needs the terminal; not measured on this engine).
- A9. `/reload-plugins` from the typeahead shows the engine's `Reloaded: …` line
  (`confirmed by text`); `/color red` shows `Session color set to: red` (`confirmed by
  row` or `by effect`); `/mcp disable <server>` shows `MCP server "<server>" disabled`
  under the label *saved for this project on <machine> until enabled again*
  (H-default, labelled), and the Jobs tab's MCP list marks the server disabled.
- A10. Two commands sent back to back (`/color red`, then `/color blue` before the first
  ran) each show their own line; a command typed at the terminal between two desk
  commands leaves the desk's two lines right and the terminal's unattributed. Where the
  link is ambiguous (spike 7's cases), the desk shows *ran, unconfirmed*, never a
  neighbour's line.
- A11. A skill command (`/doperpowers:execspec …`) from the typeahead starts a turn in the
  session (the transcript shows the prompt-type command's row and the model's answer);
  the composer's status line says *started a turn*.
- A12. After the owner presses Esc in the terminal to stop a turn, a desk command is
  refused *the session was stopped and nobody has sent input since* with the way to
  clear it that spike 6 found (a Send from the desk, or a keystroke in the terminal),
  named in the refusal.
- A13. On the older-plugin machine the typeahead opens (A8) with the desk's own panels
  (Model, Compact, and whatever M2 has added) and one line, *commands need sminos ≥
  <M1's> on mini*; a session whose catalog the desk cached before its machine fell
  behind (a downgrade; the e2e stages it) draws that catalog labelled *as of <time>*,
  every run item marked as A5 says.

**M2 — native panels from reads**

- A14. *Side question* with "one line: what is this session doing?" answers in a side
  pane within `B.btw` while the session's turn runs; the conversation gains no row
  (`sminos watch` shows `btw` start and end and no `row-seen`); the pane shows the
  tokens spent. On the older-plugin machine the button says *needs sminos ≥ <M2>*.
- A15. The Info tab's *Context* opens the context grid (the categories and their tokens,
  as `/context` draws them) within `B.panel`, from `read usage {breakdown: "summary"}`,
  and *Count exactly* re-reads with `full`; nothing is written into the conversation
  (H-ctx: `/context` is never run).
- A16. *Model* opens the selector with the engine's own options (`default, sonnet, opus,
  …` from `$.config.list()`'s `model` row), the aliases this session maps marked, the
  rest offered as ids; applying one shows *applies to this session's main loop from its
  next request; the terminal's footer keeps showing the launch model* (the session-only
  rewrite; `/model` is never run: H-default).
- A17. The Jobs tab's MCP list shows each server as connected (with its tool count),
  disabled (from the project's `.claude.json`), or unknown, with *Reconnect*, *Disable*
  and *Enable* running M1's `/mcp` forms; OAuth and a failed server say *in the
  terminal: /mcp*.
- A18. *Compact* takes instructions, and the status line shows the compaction's start,
  its counts, a hook's skip or the engine's error, as today.
- A19. *Permissions* and *Hooks* (Info tab) show the session's permission rules by
  source and each hook's event and matcher with how many commands it runs; a hook's
  command text is not shown and says *terminal: /hooks* (§11's cut).

**M3 — requests and modes**

- A20. A permission card whose request carries suggestions offers, beside Allow and
  Deny, *Allow and don't ask again* with a scope: *this session*, or *this project on
  <machine>* (labelled as writing `.claude/settings.local.json`); choosing one settles
  the request `allow` and the next identical call is not raised (`sminos watch` shows no
  `raised` for it). A request without suggestions offers Allow and Deny alone.
- A21. An ExitPlanMode request is drawn as a plan card: the plan as markdown, *Implement
  in <mode>* with the modes the machine's ceiling allows, *Keep planning* with feedback
  (a deny carrying the text), and *Clear and implement* only once M4's following exists.
  Implementing in `acceptEdits` leaves the session in that mode (the terminal's footer
  says so; the next user row's `permissionMode` is `acceptEdits`).
- A22. The mode chip shows the session's current mode from its rows; its menu offers
  *plan* (runs `/plan`), the mode spike 1 made reachable at the next allow (labelled so),
  and names the rest *Shift+Tab in the terminal*. On a `--bg` seat it also says which M6
  would reach.

**M4 — agents, fork, following**

- A23. In a running subagent's drill-in, *Stop* ends that agent (its row turns
  `stopped`; the parent's turn goes on), and *Message* delivers text the agent reads at
  its next step (`sminos watch` shows the `tell` op; the agent's transcript shows the
  peer message). A foreground and a background subagent both (spike 2).
- A24. *Fork* on a running or ended session starts a copy as a new seat of the project
  (`claude --bg --resume <id> --fork-session`), listed with *forked from <alias>*, the
  original untouched (its id, its transcript's row count: spike 8).
- A25. `/clear` from the desk: the channel ends with *continued as <new alias>*, the
  selection moves to the new session within `B.follow`, an RPC issued to the old id
  before the clear shows its outcome under the old session, unchanged (never re-sealed).
  `/branch <name>` and `/resume <id>` likewise.
- A26. `/background` is offered only when the bridge can show no running shell or
  monitor, no running agent and no workflow it saw unfinished, and the module saw the
  session from its first row; then, after a confirm, the terminal exits, the seat
  appears with the conversation and the channel continues; the old transcript's
  `continued-in` record missing (deleted by hand for the walk) still links through the
  supervisor's job record. Otherwise the typeahead says *terminal only: the session has
  tasks or agents the engine would ask about*.

**M5 — composer parity**

- A27. A photo pasted or picked on the phone appears in the strip; Send writes it on the
  machine under the session's attachments directory and the session reads it (the
  model's answer describes it); a file over the bound says so before anything is sent.
- A28. Typing `@` lists the working tree's files (from `git ls-files`) fuzzy-filtered as
  typed, within `B.palette` after the first list; picking one inserts its path.
- A29. Up-arrow in an empty composer recalls the previous sends; a draft survives a
  reload of the page.

**Latency, every milestone**

- A30. Each new control's path (§12) is in `window.deskLatency()` after one use, and its
  p50 and p95 over 20 uses are under its budget. The end-to-end cohorts (`app.cold`,
  `app.warm`, `app.reconnect`) are under theirs on both Macs, under the same load as
  the RC measurement they are compared with, and the table on #52 shows desk and RC
  side by side for each.

## Design

### 1. What this document extends, and the architecture it stays inside

Nothing here changes the shape of the desk spec's §2: the hub never connects into a
machine, the hub never stores transcripts, every effect is an RPC the daemon admits, and
session depth is relayed without codes. The run adds, in order of distance from the
session:

| Layer | Adds |
| --- | --- |
| the bridge (mod) | ops `read`, `command`, `btw`, `mode`, `stop-agent`, `tell`; DX5 events `command`, `btw`, `catalog`; `GET /status` `capabilities`; `session` start `previous`; `raised.suggestions`; a decision's `updatedPermissions` |
| the child | relays the ops and keeps the catalog; maps an op's `id` to the RPC nonce that asked it (as it does for `compact`) |
| the plane / daemon | `presence.capabilities`; the `read` relay (one worker thread, as `diff`); DX4 kinds `read`, `catalog`, `op`; RPCs `command`, `btw`, `stop-agent`, `tell`, `fork`, `attach`; `decide` widened; `compact` with `instructions`; the `continued` log event and the `end {continued}` reason; the lineage of a `/background` |
| the hub | the kinds and frames listed, relayed unread; the RPC names; presence's new field |
| the web | `capabilities()` from presence; `Subscription.read()`; the `ops` store; the typeahead and the panels, ported from MAWS's renderer |

The owner's two Macs run mixed versions throughout; §13 orders the rollout so that no
pair of old and new breaks.

### 2. Every command sorted three ways, and the route table

The engine's own thin client sorts a slash command as *post-text* (send it, the session
runs it), *control-request* (the client draws its own panel from a read), or *local*
(the client's own). MAWS's widgets outrank the engine's catalogue the same way
(`src/renderer/src/composer/mentions/items.ts`, `WIDGET_COMMANDS` first). The desk does
the same, with the mod API as the control path:

- **post-text** is a bridge op `command {name, args}` over `$.command.run` — only for
  argument forms measured to open no panel;
- **control-request** is a native web panel fed by bridge reads — or named as
  terminal-only when no read can draw it;
- **local** stays in the browser.

**A bare panel form is never run.** `$.command.run` of a panel command holds its promise
and the session's whole input queue — desk Sends included, since `$.prompt.submit` joins
the same queue — until someone presses keys in the terminal, and a mod cannot (H-panel).

**The route table lives in the bridge, keyed by engine version, and is advertised.**
`$.command.list()` says nothing about a command's type or whether it opens a panel, and
types move between releases (`/rewind` and `/fork` changed between 2.1.300 and 2.1.307).
So the bridge carries, in `sminos/hooks/mods/bridge-commands.tsx`, one table per
measured engine base (2.1.307 at writing, from the inventory's §7 and the probe), and a
session whose base has no table uses the newest one below it with the capability saying
so (`routes.measured` ≠ `engine`). Every built-in name is in one class:

| class | meaning | examples (2.1.307) |
| --- | --- | --- |
| `run` | an argument form measured to print one line and open nothing; `forms` is the argument shape it needs | `rename <name>`, `color <c>`, `reload-plugins`, `mcp enable\|disable\|reconnect <server>`, `cd <path>` (limited to the project's known checkouts), `output-style <s>` (after fork F1), `autocompact N` (after F1), `fast on\|off` and `goal <c>\|clear` (after spike 4), `recap`, `list-agents`, `subtask <task>` |
| `run-prompt` | a prompt-type command: it starts a turn, and the turn is its outcome; every `source` other than `builtin` (skills, plugin, user and MCP commands) once spike 5 holds | `init`, `security-review`, `insights`, `team-onboarding`, every skill |
| `routed` | never run: a dedicated op or read does it, named in `to` | `model`, `effort` → `model`; `compact` → `compact`; `btw` → `btw`; `context`, `usage` → `read usage`; `plan` → `mode` (bare; `plan <description>` is `run`) |
| `follow` | changes the session id (H-sid); refused until M4, then run with following | `clear`, `branch [name]`, `resume <id>`, `background` (with its own condition, §8) |
| `confirm` | destructive: the web confirms before sending; the bridge runs it | `exit` (after fork F6) |
| `panel` | refused: *opens a panel in the terminal; it would hold the session's queue*; where a read or a tab draws the same, `to` names it | `usage`, `permissions`, `hooks`, `skills`, `status`, `config` (bare), `mcp` (bare), `tasks`, `memory`, `sandbox`, `workflows`, `add-dir`, `rewind`, `plugin`, `resume` (bare), `help` |
| `local` | the browser's own | `copy`, `export`, `help` |
| `drop` | not available from the desk, with the reason | `login`, `logout`, `theme`, `tui`, `ide`, `mobile`, `terminal-setup`, `keybindings`, `statusline`, `stickers`, `heapdump`, `radio`, `passes`, `powerup`, `pro-trial-expired`, `release-notes`, `feedback`, `bug`, `focus`, `agents`, `setup-bedrock`, `setup-vertex`, `design-*`, `__remote-workflow`, `workflow-launch-exec` |

Two more rules bind the table:

- **A built-in not in the table is refused**, `unknown-builtin`, with *not measured on
  this engine* — never tried (the brief's decision 2).
- **What outlives the session is labelled or not offered** (the brief's design rule;
  the inventory's H-default). A `run` row whose command saves a setting carries
  `outlives`, a sentence the web shows with the command: `mcp disable` and `mcp enable`
  (*saved for this project on <machine>: `.claude.json`*). The rows that save a default
  for new sessions — `config k=v`, `autocompact`, `output-style`, and `fast` if spike 4
  finds it persists — are `drop` in this run with the reason *saves a default on
  <machine>; terminal only*, pending fork F1. `model` and `effort` are never run: the
  desk's Model control is the per-request rewrite, session-only (desk spec §5).

The web never decides a class: it reads the class from the catalog (§5) to draw the
hint and to refuse before sending, and the bridge checks the class again on every
`command` op, so an older or wrong web cannot run a panel.

**The Esc refusal (H-esc).** After an Esc stops a turn, the engine rejects
`$.command.run` and `$.prompt.submit` with *the session was stopped and nobody has sent
input since* until the person submits input. The bridge answers a `command` with that
refusal verbatim, code `stopped`; the web names the way out that spike 6 found (M1's
decision slot).

**Mid-turn, every command queues** until the turn ends, `immediate` ones included
(H-queue). The op answers at once with `queued`, and the outcome comes later (§3).

### 3. Ops answer at once; the outcome comes on the stream

The daemon waits at most 10 s for a bridge answer (`COMMAND_WAIT_MS`,
`sminos_control.py`), and a queued command can wait a whole turn. So every op this run
adds answers at once — `{queued: true}` or `{started: true}` with the op's `id` — and
reports its outcome later as DX5 events the daemon turns into one DX4 session-wide kind,
**`op`**, keyed by the RPC's nonce, exactly as `compact` does today (DX4 `compact {rpc,
phase, …}` from DX5 `compact` start and end, the child's `rpc_of` mapping the command's
`id` to the nonce, the daemon's owed ledger sending the outcome again after a restart).
`compact` keeps its own kind; everything new rides `op`:

```
op  {rpc: <nonce> | null, op: "command" | "btw" | "stop-agent" | "tell" | "mode", phase: "start" | "end", id, ...}
```

The web keeps `ops[nonce]` beside `compactions[session]` and draws three states for a
command — *queued*, *ran*, and the line read back — and never shows a resolved promise
as success: the transcript row or the checked effect is the success (the brief's
decision 4). The strongest alternative, one DX4 kind per op (`command`, `btw`, …), lost:
each new op would need a hub change to list its kind, and the hub reads none of these
bodies.

### 4. A capability list per session

Today the web hard-codes what each kind of session can do
(`apps/desk-web/src/conversation/capabilities.ts`, the desk spec's §5 table). Every
control this run adds exists on some machines and not others while doperpowers rolls
out, and the route table shifts with the engine. So:

- **The bridge advertises.** `GET /status` gains `capabilities` (Interfaces, DX5): the
  protocol, the engine base, the ops the bridge answers, the read kinds it serves, and
  the route table's measured base.
- **The plane forwards it in presence**, as a sibling field: `presence {record, bridge,
  capabilities?}`. Not under `bridge`, as the inventory proposed: the hub refuses a
  presence whose `bridge` is not a boolean (`Project.presence`,
  `apps/desk-hub/src/objects/project.ts`), while it passes an extra field through and
  stores the message whole — so a new daemon's presence reaches an old hub and an old
  web unharmed. The plane learns it from the body of the probe it already makes
  (`Bridges.probe`, `sminos_plane.py`, which today keeps only whether the status
  answered), and a presence changes, and is sent again, when the capabilities change
  (a module reload to a new version spawns a new child, a new socket inode, a new
  probe).
- **The web derives from it.** `capabilities()` gains the new verbs and reads its `can`
  and `reason` from the session's own list; a session with no list (an older bridge, a
  `--bg` seat or terminal session without one) falls back to the kind table as today,
  and each new verb's reason names the version: *<machine>'s sminos (<version>) predates
  <control>: update doperpowers on <machine>*. The version comes from the machine's
  `machine` presence (DX4), which gains `sminos: "<version>"` for this. The hub
  rebuilds a `machine` body from the fields it knows (`machinePresence` in
  `project.ts`), so M0's hub must admit and keep the field; through an older hub it is
  dropped, and the web then says *an older plugin* without the number.

A capability names *what the bridge can do*, not *what this moment allows*: a turn
running, a request pending, a mode's ceiling are read from presence and rows as today,
and the capability's `note` says how the action will land.

### 5. Reads over the plane, and the catalogs pushed

**Reads are not RPCs.** RPCs carry a nonce ledger, a code and the 60 s freshness rule,
all for effects; a read changes nothing and should cost one frame each way. The plane
already serves two reads per subscription (`diff`, `output`). This run adds one
up-frame, DX3 `{t: "read", sub, id, what, args?}`, carried to the machine as DX2 with
the sub's session, and one down-kind, DX4 `read {id, what, result?, error?}` on that
sub. The plane finds the sub, and on a worker thread (as `diff` runs git) POSTs the
bridge child `/command?wait=<COMMAND_WAIT_MS>` with `{op: "read", what, args}`; the
child relays any op (DX5 Routes), and the bridge answers from `$`. No bridge, no such
read, a timeout or a failure come back as the answer's `error`, never as a hub refusal.
A read is a main-transcript subscription's unless its kind says otherwise.

| `what` | answers from | milestone |
| --- | --- | --- |
| `status` | `$.session.version()`, `model()`, `cwd()`, `root()`, `repo()`, `surfaces()`, the bridge's override | M0 |
| `catalog` | the catalog below, on demand (a refresh after `/reload-plugins`) | M1 |
| `usage {breakdown: "summary" \| "full"}` | `$.session.usage({breakdown})`: the context window with `context.breakdown` in the SDK's `get_context_usage` shape, the rate-limit windows, the cost; never `/context`, which writes its grid into the conversation (H-ctx) | M2 |
| `mcp` | `$.tool.list()` grouped by `mcp__<server>__*` into connected servers with tool counts; the plane adds `disabled` from the project's `.claude.json` (`projects[<cwd>].disabledMcpServers`); never `$.mcp.call` (H-mcp) | M2 |
| `settings` | `$.settings.read()` cut to what §11 allows: permissions by source, and hooks as event, matcher and count | M2 |
| `files {query?}` | the plane itself, `git ls-files` in the session's working directory, no bridge involved | M5 |

**The catalogs are pushed, not fetched.** Nothing a panel shows when it opens should wait
on a fetch if it can be pushed and cached, and the typeahead must open with no round
trip. The command list and the model list belong to one session — plugins and mods add
and replace entries, and aliases resolve through that session's environment — so they
are **live catalogs**, cached by session plus a fingerprint and invalidated by push; only
the built-in routing rules are fixed per engine version (the brief's caching amendment).
The bridge emits a DX5 `catalog` event at `session.start` and whenever its content
changes (re-listed after each `command` end and at each heartbeat while a `/reload-*` or
`/mcp` command ran in the last minute, compared by fingerprint): the commands
(`$.command.list()` joined with the route class each gets), the models
(`$.config.list()`'s `model` row's options, and which family aliases this session's
`ANTHROPIC_DEFAULT_<FAMILY>_MODEL` maps), and the fingerprint. The child keeps the latest
and puts it in its snapshot; the plane carries it in the DX4 snapshot as `catalog` and
relays each change as a DX4 `catalog` message on main subs. The web caches it per
`(session, fingerprint)` in memory and in `localStorage` (the last 32 sessions), so a
re-opened session's typeahead draws from the cache before its snapshot lands, labelled
*as of <time>* until the snapshot confirms the fingerprint; a cache from another session
is never used.

### 6. Readback: confirming by the row or the effect

Only `type: "local"` commands return `{text}` (`reload-plugins`, `output-style`,
`clear`); the one-line built-ins the desk cares about resolve `{}` whether they
succeeded or failed (`/model bogus` → `{}`), and the printed line exists only as a
`<local-command-stdout>` row (H-noout). So a `command`'s DX5 `end` event carries, beside
the settled value, a **readback**:

```
readback: {how: "text" | "row" | "effect" | "none", text?, uuid?}
```

- `text`: the settled value carried the line (a `local` command).
- `row`: the stdout row the bridge linked to **this** command's own row — the user row
  the engine writes for the queued command (its `<command-name>`, the plugin origin the
  transcript draws as *› Prompt from the sminos plugin*). The link is demonstrated, never
  assumed (the brief's amended decision 4): the stdout row's `parentUuid` is the command
  row's uuid, or, where the engine does not chain them, it is the first stdout row of
  the loop after the command row with **no other command row between** (desk-issued or
  typed at the terminal). Several desk commands can queue behind one turn and the person
  can type commands at the terminal, so "the next stdout row within a window" would
  attach a neighbour's line. Spike 7 (readback timing, back-to-back and interleaved
  commands) settles which of the two links holds on 2.1.307, and whether these rows
  reach the bridge's `session.append` hook at all — the bridge's own appends do not, and
  a command the bridge ran may count as its own; if they do not, the bridge reads them
  from disk through the child's rows after the settlement, as it already does for a
  compaction's rows (doperpowers #78).
- `effect`: a check specific to the command — `rename` → a `custom-title` row carrying
  the name; `color` → an `agent-color` row; `mcp enable|disable|reconnect` →
  `$.tool.list()` gaining or losing `mcp__<server>__*`; `cd` → `$.session.cwd()`.
  Spike-free, so M0 ships on these.
- `none`: *ran, unconfirmed*. The link was ambiguous. Shown as such, never as success.

The desk already draws stdout rows as MAWS's `local_command` rows (the transcript is
MAWS's `Transcript`); the composer's status line shows the readback for a command run
from the desk, since the desk has no chips for most settings.

### 7. Requests: scopes, plan approval, and the mode

**"Allow, and don't ask again" (B2).** The engine's `PermissionRequest` hook input
carries `permission_suggestions` (the SDK's `PermissionUpdate` list: `addRules`,
`setMode`, `addDirectories`, … each with a `destination`), and an allow may answer with
`updatedPermissions`. The bridge drops both today (`raisedFields` in
`bridge-stream.tsx`; `engineDecision` in `bridge-requests.tsx` answers `{behavior:
"allow"}`). This run: `raised` gains `suggestions` (the list verbatim, bounded:
Interfaces); the decision route and DX6 `decide` gain `suggestion: <index>`, resolved
against the raised list — never free-form rules from the web — and the daemon checks it
against the request still pending in the bridge (`check_digest`'s re-read), the
destination against §11's allowed set, and a `setMode` against the machine's ceiling.
The web ports MAWS's scope radio (`request-card/scope.ts`, `variants/Permission.tsx`)
cut to the destinations §11 allows: *this session* and *this project on <machine>*,
the second labelled as writing `.claude/settings.local.json`. The code the decision
carries covers the index; the digest binds the request.

**Plan approval (B4).** An ExitPlanMode request is drawn as MAWS's plan card
(`variants/Plan.tsx`): the plan as markdown from the request's input. *Implement in
<mode>* is an allow with `updatedPermissions: [{type: "setMode", mode, destination:
"session"}]` (DX6 `decide` gains `mode`, allowed only for an ExitPlanMode request and
checked against the ceiling); *keep planning* is a deny with the feedback as `message`;
*clear and implement* is M4's following plus a Send, offered only once M4 exists.
Whether an allow's `setMode` changes the live session's mode is spike 1; §M3 says what
each result changes.

**The mode (C5).** No mod call returns the current mode, but the transcript carries it:
`permission-mode` rows and each user row's `permissionMode`. The web derives it from the
rows it already holds (the latest such row on the live chain; *unknown* before any),
and draws MAWS's `ModeChip` and `ModeMenu`. The menu's entries: *plan* runs `/plan`
(measured: `Enabled plan mode`); a mode spike 1 made reachable is *armed* — the bridge
op `mode {mode}` keeps it and attaches `{type: "setMode", mode, destination: "session"}`
to the next allow it hands out from outside (the desk's or the CLI's, never the
terminal's), the chip saying *at the next permission you allow from the desk*; the rest
are named *Shift+Tab in the terminal* (and *M6* on a `--bg` seat). `/config
permissionMode=X` is never used: it sets only the default for new sessions.

### 8. Following an id change

`/clear`, `/branch`, `/resume <id>` and `/background` change the session id, and the
desk keys everything on it: the log member, the plane subscription, the bridge socket,
RPC `args.session` (H-sid). The desk follows rather than avoids (the brief's decision
5), under three contracts:

1. **Issued RPCs stay put.** Following moves the selection, the subscriptions and future
   actions only. An RPC already issued stays bound to its original session and nonce,
   and its outcome is shown under the old session when it arrives; it is never re-sealed
   or reissued against the new id — the code covers the session argument and the ledger
   keys execution by nonce (`project-client.ts`'s RPC map; desk spec DX6). Re-sealing
   could run an approval or an interrupt against the wrong conversation, or twice.
2. **Two kinds of following.**
   - *Within one process* (`/clear`, `/branch`, `/resume <id>`): the bridge already
     spawns a child for the new id (DX5, "When the mod spawns one"); its first `session`
     start to that child gains `previous: {session, reason}`. The plane, seeing a new
     session whose bridge start names `previous`, writes the log event `continued {from,
     to, reason}` under the machine's writer, ends the old sub with `end {reason:
     "continued", to}`, and the new id is a member as any new session is (the member
     mark carries, `sminos.py`'s `member_mark`). The hub adds the `end` reason; the web
     moves, redraws the old channel's end marker as *continued as <alias>*, and keeps
     the old channel's history and its RPC outcomes.
   - *Across processes* (`/background`): the TUI exits and the mod loads fresh in the
     supervisor's worker with no old state, so the bridge cannot say `previous`. The
     daemon builds the lineage: the supervisor's job record (`control.sock` `list`, a
     job with `source: "slash"` whose start is within 30 s of the old session's end),
     joined with the old transcript's `continued-in` record where 2.1.307 wrote one (it
     is best-effort, cli 2.1.307:239409-239430); with the record missing, the job record
     alone links when exactly one such job appeared; with neither, no link, and the old
     channel ends as an ended session does. The new record is `kind: "bg"`, so the
     session's kind changes from terminal to seat.
3. **`/background` has a dialog of its own.** It asks *Background this session?* in the
   terminal whenever abandonable tasks or running workflow agents exist (cli
   2.1.307:239626 and on), and a web confirm does not answer it: the session's input
   would be held behind it. So the bridge offers `background` (the route's `forms`
   check) only when it can establish that neither exists: its jobs ledger holds no
   running shell or monitor, `$.agent.list()` names no running agent, no `Workflow` tool
   call it saw is unfinished (`$.agent.list()` leaves workflow agents out, so the bridge
   counts the calls it saw settle), and the module saw the session from its first row
   (a module loaded mid-session cannot know what ran before it). Otherwise the command
   is terminal-only, with that reason. A26 is the acceptance case.

Until M4, the four commands are refused with *changes the session id; following comes
with M4*.

### 9. Agents, forks, side questions

- **Stop one subagent (G11).** `TaskStop` takes an agent id or name; the bridge refuses
  agent ids in `stop` on purpose (`stopTask`, bridge.tsx) and the daemon's `stop` checks
  the jobs index only, so this is a separate op and RPC, `stop-agent {agentId}`, checked
  against `$.agent.list()` in the bridge and the plane's subagent tree in the daemon,
  leaving a note row as a job stop does (`stopNote`'s form, naming the agent). Spike 2
  settles a foreground against a background subagent.
- **Message one subagent (G12).** `tell {agentId, text}` → `$.session.send({to:
  {agentId}, text})`, the SendMessage tool's own delivery; the agent reads it at its
  next step, framed as a peer's.
- **Fork (E4).** The daemon runs `claude --bg --resume <id> --fork-session` in the
  session's working directory (or a worktree, as spawn does), going around sminos's "a
  flag starts a copy" guard since here the copy is the goal; the copy joins as a seat
  with the spawn's ceiling, and its `joined` event carries `fork_of: <id>`. The live
  session is untouched (spike 8). `/fork` through the command op is not used: its 2.1.307
  gate may open a panel.
- **Side question (E6).** `btw {prompt}` → `$.model.fork({prompt})`: one tool-less
  completion over the session's own transcript as the main thread last sent it, served
  from the prefix cache, nothing written into the conversation. Async (a completion can
  outlast 10 s): `{started, id}` at once, then `op` start and end with `text` and `usage`
  or `reason` (`nothing-to-fork` before the first response or after `/clear`,
  `api-error`, `empty-reply`, `aborted`). `/btw` itself is an overlay and is never run.
  Spike 3 measures it mid-turn and idle; M2's `btw` ships after it.

### 10. Composer parity

- **Attachments (A6).** `$.prompt.submit` refuses `attachments` and `$.session.append`
  takes text only, so a file goes to the machine first: RPC `attach {session, name,
  type, bytes}` (base64, bounded by the RPC's 1 MiB canonical JSON — about 700 KB of
  bytes; the web downscales a photo to fit and refuses a larger file with the bound),
  written by the daemon under `$SMINOS_HOME/attachments/<session>/<nonce>-<name>` (mode
  0600, swept with the session's bridge state), answering `{path}`; the web then sends
  the message with `@<path>` appended, which spike 9 verifies the engine's attachment
  extraction takes for a plugin-submitted prompt.
- **`@` files (A7).** The `files` read above; the web ports MAWS's `AtMenu` with the
  list filtered in the browser.
- **History and drafts (A8).** Web-local: the transcript's own human rows plus
  IndexedDB.
- **`!` shell (A5).** Not built without the owner's yes (fork F3): it changes the
  machine's security policy.

### 11. Security: the authentication model applied

The desk spec's model (§6): every effect is an RPC sealed with the org key the hub never
holds and executed only by the machine's daemon under its policy; session depth is
display, relayed without codes, and what the human approves is bound by digest. This
run keeps every line of it and makes two calls the brief asked for.

**Reads that expose more than the transcript are cut to what the UI shows.** A read goes
over the plane uncoded, like rows. `$.settings.read()` returns everything, `env` and
hook commands included ("nothing is filtered", the engine's types), and an MCP server's
configuration carries URLs and headers. Neither is shown. The `settings` read answers
`permissions` (the rules by source: `allow`, `ask`, `deny`, `additionalDirectories`,
`defaultMode`, what `/permissions` draws) and `hooks` as each event's matchers and how
many commands each runs — never the command text, which the web names *terminal:
/hooks*; `env` and every other key never leave the bridge. The `mcp` read answers names,
status and tool counts — never a server's configuration. The strongest alternative,
sealing reads with a code (an RPC-shaped read), lost: it would put a nonce ledger and
the freshness rule on a display path, and still relay the data through the hub in the
clear; authentication codes on session depth stay deferred (desk spec, Deferred).

**Every effect stays X class.** `command`, `btw`, `stop-agent`, `tell`, `fork`, `attach`
and the widened `decide` are refused `read-only` before anything else, and the daemon
never trusts a class the web asserts: the bridge's route table decides what a
`command` runs. `fork` runs under the spawn's ceiling (`admit_spawn`); a `setMode` on a
decision is checked against the same ceiling; `cd` is limited to the project's known
checkouts as spawn is.

**What outlives the session is labelled or not offered.** Three destinations are
allowed for a suggestion from the desk: `session` (nothing saved), and
`localSettings` (`.claude/settings.local.json` of that checkout, labelled); `userSettings`
and `projectSettings` are refused by the daemon (`bad-shape`) whatever the suggestion
offers — a project's committed settings and the user's global ones are the terminal's
to change, pending fork F1. The commands that save a default are `drop` (§2) pending the
same fork; `mcp enable|disable` is offered, labelled, because the terminal's `/mcp` does
exactly that and it is what the owner needs when a server misbehaves.

**Channels that stay closed** (the brief): no text through a channel where it could act
as a keystroke (a supervisor `reply` aimed at a dialog becomes a prompt, H-reply; the
desk never sends one); no `$.command.run` from a held hook frame (the bridge runs every
op from its command loop, outside any hook); no `$.mcp.call` as a data path (H-mcp).

### 12. Latency: marks, budgets, cohorts

Every new control gets a path in `apps/desk-web/src/latency/latency.ts`'s `PATHS` and a
budget. The budgets are **named placeholders tied to the baseline table** the
`desk-latency-baseline` branch is measuring now and will post on #52: `B.<name>` means
*the RC equivalent's p50 and p95 for that load, from the baseline table, under the same
machine load*, and parity means desk ≤ RC at both. Until the table lands the names
stand; the executor of each milestone fills the number from the table when it exists and
leaves the name where it does not yet. `B.palette` is the one fixed number, 50 ms: a
typeahead that touches the network has failed whatever the table says.

| path | measures | budget |
| --- | --- | --- |
| `app.cold` | navigation start → the first session view drawn with its controls usable (capabilities applied) | `B.cold` |
| `app.warm` | the tab shown again (`visibilitychange`) → presence fresh and the subscription live | `B.warm` |
| `app.reconnect` | the project socket dropped → controls usable again | `B.reconnect` |
| `app.me`, `app.chunk`, `app.state`, `app.key` | `/api/me`, the project chunk, project state, the device-key gate: per-hop, for diagnosis (today's paths start at the subscription, so the app's own start sits outside them: `App.tsx`, `ProjectView.tsx`) | none; diagnosis |
| `palette.open` | the `/` keystroke → the typeahead drawn | `B.palette` = 50 ms |
| `catalog.ready` | subscribe sent → the catalog usable (the snapshot's, or the cache's) | `B.catalog` |
| `read.<what>` | a read sent → its answer in, per kind | `B.read` |
| `op.queued` | a command RPC sent → `queued` | `B.op` |
| `op.ran` | a command RPC sent → its `op end` | `B.ran` (minus the turn it waited for: a sample taken while the session was busy is kept apart, labelled) |
| `op.readback` | a command RPC sent → its readback drawn | `B.readback` |
| `btw.answer` | a side question sent → its text drawn | `B.btw` |
| `panel.<name>` | the tap → the panel drawn with content (context, usage, model, mcp, settings, status) | `B.panel` |
| `decide.scoped` | a scoped allow tapped → its `settled` in | `B.decide` (today's `request.*` paths are the diagnosis) |
| `follow.moved` | the old sub's `end {continued}` → the new session's first rows drawn | `B.follow` |
| `agent.stop`, `agent.tell`, `fork.joined` | the tap → `op end`; → the new seat's presence | `B.op`, `B.spawn` |
| `attach.sent` | the file picked → `{path}` in | `B.attach` |

Acceptance is end to end (the brief's amendment): the action (navigation, choosing a
session, returning to a tab, a tap) to useful content with usable controls, in the three
cohorts, with the RC side measured at its matching endpoints under the same load. Per-hop
marks diagnose; they do not prove parity.

**The method** (the brief's latency track): take the baseline, rank the offenders by
their gap to RC times how often the load happens, fix in that order, measure again after
each fix. The suspects on record are hypotheses for the ranking, not a fix list: the
bridge child's Python imports under load (1–2 s), the snapshot held for the mod's first
resync (the child's 5 s `SMINOS_BRIDGE_READY_WAIT`; the CLI's `FIRST_WAIT_S` is 8 s, not
the 5 the brief cites — Surprises), the hub ending machine streams every 23–96 min with
1.35 s reconnects and 12–16 s outliers, and every hop a read adds unless it is pushed.
The fixes are a separate line of work on #52 this spec does not schedule; what this spec
binds is that nothing it adds makes the ranking worse: a panel opens from pushed data,
the typeahead from the cache, and a read costs one frame each way.

### 13. Rollout across mixed versions

The hub refuses a frame it does not list (`no frame "read"`), a session kind it does not
list (`no session message "op"`), and an RPC name it does not know (`no RPC "command"`),
each `bad-shape` into the audit record; the daemon passes a frame it does not handle by
(`sminos_uplink.py`, *not handled here yet: passed by*); the web acts only on
capabilities the presence advertises. So:

1. **MAWS first**, hub and web together (they deploy together: `apps/desk-hub/deploy`).
   The new hub lists every kind, frame and name this document adds; the new web offers
   nothing until a session's presence says the bridge can.
2. **Then doperpowers**, the sminos bump installed on the macbook first (the owner's
   working machine), the mini last. Each milestone's acceptance is walked with the mini
   still behind: that is the older-plugin case.
3. **Daemon-first is safe but inert.** A new daemon's `presence.capabilities` and the
   snapshot's `catalog` field pass an old hub (an extra field; a snapshot's body is
   relayed unread) and an old web ignores them. A new *kind* (`read`, `catalog`, `op`)
   an old hub would refuse `bad-shape` into the audit record, so the daemon sends a kind
   only when the hub's `welcome` lists it: DX2 `welcome` gains `kinds`, and a `welcome`
   without it is the old hub, to which none is sent (an old web asks for none, and a
   CLI-started op's outcome is simply not relayed). An old web never sends a new frame.
4. **Per milestone**, each MAWS PR merges and deploys before its doperpowers PR rolls out;
   a milestone's capability names are the gate the web reads, so a partial rollout
   never breaks.

### 14. Departures from the inventory

Listed in one place so the research session can re-check the hazards each leaned on.

1. **`capabilities` is a sibling of `bridge` in presence, not under it** (§4): the hub
   refuses a non-boolean `bridge`.
2. **The catalogs are pushed in the snapshot and as a `catalog` kind; `read catalog` is
   the refresh** (§5): the inventory had `commands` and `models` as reads only. Cached
   per session and fingerprint (the brief's amendment), never shared across sessions.
3. **One DX4 kind `op` carries every async outcome** (§3); DX5 keeps per-op events.
4. **Readback links by the command's own row or by an effect, never by a window** (§6,
   the brief's amendment); and whether the rows reach `session.append` is a spike — the
   inventory's §3.2 took it as read (C `bridge.tsx:1752`), but the bridge's own appends
   do not pass that hook.
5. **The `settings` read is cut** to permissions and hooks' shape; hook commands and
   `env` never leave the bridge; `mcp` carries no configuration (§11).
6. **The current mode is derived in the web from rows**, not by the plane (§7).
7. **`/background` is offered only when the bridge can show no abandonable task and no
   unfinished workflow it saw, and the module saw the session from its first row**
   (§8, the brief's amendment); workflow agents are invisible to `$.agent.list()`.
8. **Two kinds of following; issued RPCs stay put** (§8, the brief's amendment).
9. **The `command` op's dispatch contract is in M0** with a three-row table (the brief
   offered the choice); M1 fills the table and opens non-built-ins.
10. **`stop-agent` is its own op and RPC**, not a widened `stop` (§9).
11. **The commands that save a default are `drop` pending fork F1** (§2): the inventory
    classed `autocompact`, `output-style` and `config k=v` as `run`.
12. **The machine's sminos version rides in the `machine` presence** (§4), so the web
    can name the version a control needs.
13. **`FIRST_WAIT_S` is 8 s** (the CLI's wait); the 5 s is the child's
    `SMINOS_BRIDGE_READY_WAIT` (Surprises).
14. **The sminos tests live under `sminos/tests/`**, not `tests/sminos/` (Surprises).

### 15. The owner's calls: open forks, each with a recommendation

None of M0–M5 waits on these; each is the edge a milestone stops at until answered.

- **F1 — Controls whose effect outlives the session.** `/model` and `/effort` save a
  default for new sessions; `/autocompact`, `/output-style`, `/config k=v` write
  `settings.json`; `/mcp disable` writes the project's `.claude.json`; a suggestion's
  `localSettings`, `projectSettings` and `userSettings` write settings files; `/add-dir`
  *remember* likewise. **Recommendation:** offer in this run only what the terminal's own
  session controls do and label it — `mcp enable|disable` (`.claude.json`, per project)
  and a suggestion's `localSettings` — and keep the defaults (`config`, `autocompact`,
  `output-style`, the model and effort defaults, `projectSettings`, `userSettings`)
  terminal-only, named as such; a later, separate *Settings* panel with its own review
  could add them. The alternative, a labelled *save as default* beside Model, is sound
  if the owner changes models from the phone often enough to want it.
- **F2 — M6, the attach key driver for `--bg` seats** (Shift+Tab at any moment, the
  rewind picker, Enter on a dialog) and whether this run includes a web terminal for
  `--bg` jobs. **Recommendation:** not in this run. It picks by screen position, races a
  person attached at the same time, and reads nothing back from the screen; every row it
  would unlock is already named terminal-only with its reason, which is the brief's
  bar. Becomes worth it if the owner runs most sessions as `--bg` seats and rewind from
  the phone matters more than its fragility.
- **F3 — `!` shell from the web (A5).** `$.process.run` plus the `<bash-input>` rows,
  behind the machine's policy. **Recommendation:** not in this run. It is arbitrary
  execution from the hub's side of the boundary, exactly what §6 keeps the daemon from
  passing. If wanted: a per-machine policy flag (`shell: true`, default off, set only by
  `sminos daemon policy` on the machine), X class, its own review.
- **F4 — The settings and MCP reads' gate.** **Recommendation:** the cut in §11 (rules
  and hooks' shape, no commands, no `env`, no MCP configuration). The alternative is a
  coded read, which brings the RPC machinery onto a display path for data the hub would
  still relay in the clear.
- **F5 — Rule suggestions' destinations.** `session` only, or `session` and
  `localSettings`. **Recommendation:** both, `localSettings` labelled; it is what "don't
  ask again" means to the owner, and it stays in the checkout's untracked local file.
- **F6 — `/exit` from the desk.** Ends the process; for a terminal session that closes
  the owner's terminal session. **Recommendation:** offer behind a confirm naming the
  machine and that it closes the terminal session; Retire already does this for seats.
- **F7 — Fork's placement.** A fork is a spawn: the brief's M4 puts it with agents and
  following. **Recommendation:** as the brief has it; nothing turns on it.

## Plan of Work

**Binding every milestone.**

- Two repositories, one spec. Each milestone has a machine half (doperpowers, under
  `sminos/`) and a hub-and-web half (MAWS, `apps/desk-hub`, `apps/desk-web`); the
  interface between them is fixed in Interfaces and Dependencies, so the two halves can
  be built by two executors at once, each proving its half against the stand-in the
  other repository already keeps: MAWS's fake machine (`apps/desk-hub/fake-machine/`,
  `RpcScript` for scripted RPC answers, `SessionDepth` for the plane's producer rules)
  stands for the machine; doperpowers' hub stand-in (`sminos/tests/hub_standin.py`) and
  the fake mod of `test-bridge-control.sh` stand for the hub and the engine. Each
  milestone's acceptance on the owner's Macs (its A-items) runs after both halves are
  merged and rolled out in §13's order.
- Rollout order §13; mixed versions are the normal state, and every new field is
  additive and optional on the wire.
- doperpowers: every change bumps sminos in the same commit (`scripts/bump-version.sh
  --plugin sminos <version>`, one minor per milestone), the tests
  `sminos/tests/run-sminos-tests.sh` and `sminos/tests/mods/run.sh`, and
  `tests/mods/typecheck.sh`; DX5 changes land in this document's Interfaces (the desk
  spec's DX5 copy points here from a dated line).
- MAWS: `scripts/ci-gate.sh <worktree> --gates static,unit` on every commit that is
  reviewed, `e2e:desk-web` for a milestone with a web half, `e2e:desk-web-hub` where the
  hub's relay changed; the protocol's types in `apps/desk-hub/src/protocol/` are the
  one place a shape is written; the fake machine produces everything the plane does.
- The hazards bind as measured facts: no bare panel form is run; `/model`, `/effort`,
  `/context`, `/add-dir` are never run; `$.mcp.call` is never used; nothing is sent
  through a supervisor `reply` that could act as a keystroke.
- Copy: a refusal names the thing that cannot be done and why, in the reasons' voice
  `capabilities.ts` already uses (*<name> is idle: Send starts a turn*); a control that
  needs a newer plugin names the version and the machine.
- Latency: every new control's path in `PATHS` with its label, sampled whether or not
  the readout is on; a budget from §12.
- Spikes gate rows, not milestones' starts: a milestone whose row waits on a spike builds
  everything else and leaves that row's capability unadvertised until the spike's result
  is folded in (Surprises), with the capability's reason saying *measured on <engine>
  pending*.

### M0 — Foundation: capabilities, the `read` relay, the op outcome, the `command` dispatch

**What exists at its end.** A bridged session advertises what it can do; the web offers
a control only when the session says it can, and names the version otherwise. One read
(`status`) travels browser → hub → daemon → child → bridge and back on the sub, and the
Info tab shows it. The `command` op runs three measured built-ins (`rename <name>`,
`color <c>`, `reload-plugins`) from a `/` typed in the composer, answering at once,
reporting on the stream, read back by effect or text; everything else typed as a slash
is refused with its class's reason before it is sent, or by the bridge if sent. A
read-only machine refuses the RPC. Nothing here waits on a spike or an owner's answer.

**Machine half (doperpowers).**

- `sminos/hooks/mods/bridge-commands.tsx` (new): the route table for 2.1.307 with every
  built-in of the inventory's §7 in its class, `forms` for the `run` rows, `to` for the
  routed and panel rows, `outlives` where it applies, and `reason` copy; at M0 the `run`
  class is **enabled** for `rename`, `color` and `reload-plugins` only, every other `run`
  and every `run-prompt` row carrying `enabled: false` with *comes with M1* — the table
  is whole from M0 so that the catalog (M1) and the refusals (M0) read one source.
  `routeOf(engineBase, name, source, args)` → the class, or a refusal `{code, reason}`
  (`unknown-builtin`, `panel`, `routed`, `follow`, `drop`, `local`, `bad-args`,
  `disabled`).
- `bridge.tsx`: ops `read` and `command` in `commandAnswer`. `read {what, args}` answers
  `{ok, result}` for `status` and `{ok: false, error: "no read <what>"}` otherwise.
  `command {name, args, from}`: the route check, then `$.command.run({command: name,
  args})` **not awaited past the call** — answer `{ok: true, result: {queued: true,
  route, id: command.id}}` at once (the engine queues mid-turn, H-queue); the settled
  promise emits DX5 `command {phase: "end", id, name, args, settled, readback}`, with
  `command {phase: "start", id, name, args}` emitted as the call is made; the Esc
  rejection answers `{ok: false, error, code: "stopped"}`; an engine rejection after the
  call is the `end`'s `settled.error`. The readback at M0: `text` from a settled `{text}`;
  `effect` for `rename` (a `custom-title` row with the name, read from the child's rows
  within 3 s of the settlement) and `color` (an `agent-color` row); `none` otherwise.
  Decision: the three rows' effect checks read from disk through the child
  (`GET /rows`, as the compaction path does), so M0 does not depend on whether the
  engine's rows for a plugin-run command pass `session.append` (spike 7).
- `GET /status` `capabilities` (Interfaces, DX5): assembled by the bridge at its hello
  and after each module load, posted to the child as part of `resync` (`capabilities`
  field) so the child answers it from its state; `engine` from `$.session.version()`.
- `sminos_bridge.py`: keeps `capabilities` from the resync and answers it in `status()`;
  `rpc_of` already maps an op's `id` to the RPC nonce for any op the daemon tags with
  `rpc` — the child annotates each `command` (and later `btw`, …) event it relays with
  `rpc` when it holds one for that `id`, as the plane needs.
- `sminos_plane.py`: `Bridges.probe` keeps the status body's `capabilities`;
  `presence_of` adds `capabilities` when held; `machine` presence gains `sminos` (the
  plugin's version, read from `sminos/.claude-plugin/plugin.json` beside the scripts).
  The `read` frame: `Plane.read(frame)` finds the sub, refuses malformed frames by
  passing them by (as `output` does), and runs `post_command(path, {op: "read", what,
  args}, wait_ms=COMMAND_WAIT_MS)` on a worker thread (as `diff` runs git: a thread per
  read, bounded to 4 in flight per sub, the rest answered `error {code: "busy"}`),
  queuing the answer for the pump, which emits DX4 `read {id, what, result | error}` on
  the sub. DX5 `command` events with an `rpc` become DX4 `op {rpc, op: "command", phase,
  …}`, session-wide, through the same path `compact` events take
  (`sminos_rpc.compacted` generalized to `op` outcomes, owed until acknowledged); a
  `command` event without `rpc` (a terminal-typed command does not produce one; a CLI
  `sminos command` would) is `op` with `rpc: null`.
- `sminos_rpc.py`: `RPC_NAMES` gains `command`; `shape()` checks `name`
  (`[A-Za-z0-9:_-]{1,64}`) and `args` (a string of at most 4,096 characters, optional);
  `plan()` runs `command(path, {op: "command", name, args, rpc: nonce, from: "desk"})`
  when bridged, else `unsupported`; the bridge's `{ok: false}` is `failed` with the
  bridge's reason as the message and `code` carried in the message's first word (the
  web shows the message). `sminos_uplink.py`: the `read` frame handler, and
  `welcome.kinds` read and kept (§13.3): the plane sends a kind this run adds (`read`,
  `op`; M1's `catalog`) only when the stream's `welcome` lists it.
- `sminos_control.py`: `sminos command <member> <name> [args]` and `sminos read <member>
  <what>` as CLI verbs, so the live walk can drive the ops without the hub.
- Tests: `sminos/tests/mods/bridge.test.ts` (the route check's every class; `command`
  answering at once and emitting start and end; readback by text and by effect; the
  `stopped` code); `test-bridge-control.sh` (the child relaying `read` and `command`,
  `rpc_of` annotation, `capabilities` in `status`); `test_session_plane.py` (presence
  with `capabilities`, the `read` relay and its errors, `op` from a tagged `command`
  event); `test_rpcs.py` (`command`'s shape, read-only, unsupported without a bridge).

**Hub and web half (MAWS).**

- `apps/desk-hub/src/protocol/`: `SessionPresence.capabilities?` and
  `MachinePresence.sminos?`; `ProjectUp` gains `read`; DX2's machine frames gain `read`;
  `SUBSCRIPTION_KINDS` gains `read` and `catalog`; `SESSION_WIDE_KINDS` gains `op`;
  `RpcArgs.command`, `RpcResults.command`, `RPC_NAMES`; DX2 `welcome.kinds`. `project.ts`:
  the `read` up-frame (shape check: `sub` owned, `id` a name of at most 64 characters,
  `what` `[a-z-]{1,32}`, `args` absent or an object of at most 4 KiB; carried to the
  machine with the route), `op` relayed unread like `compact`, presence's extra field
  passed through (it already is).
- `apps/desk-hub/fake-machine/`: presence with capabilities (a `Producer` level
  `'m0'`), `read status` answered on the sub, a `command` RPC answered `queued` and
  followed by scripted `op` messages with a readback (`RpcScript` plus a `commands`
  script keyed by name), and the older-producer case (no capabilities) kept.
- `apps/desk-web/src/conversation/capabilities.ts`: `VERBS` gains `command` and `read`
  (`read` a capability of the Info tab, not a verb button); `capabilities()` reads
  `presence.capabilities` when present, with the fallback and the version-naming reasons
  (§4). `shell/session-plane.ts`: `Subscription.read(what, args) → Promise<ReadResult>`,
  correlating by `id`, rejecting with the answer's `error`, timing out at 15 s (the
  machine's own 10 s plus the hops). `project/conversation.ts`: `ops` beside
  `compactions`, fed by `op` messages. `views/composer/Composer.tsx`: a text beginning
  `/<name>` is a command when `can.command.can` — the RPC `command {session, name,
  args}` — and otherwise refused in place with the capability's reason and *Send as text
  anyway*; a new `CommandStatus` beside `RpcStatus` draws queued → ran → the readback
  (`words.ts` gains `command`'s result and the op's phases). `depth/view/SessionInfo.tsx`:
  the engine's version, base, root, repository, surfaces from `read status`, or *not
  available from this plugin (needs sminos ≥ <M0's>)*. `latency.ts`: `read.status`,
  `op.queued`, `op.ran`, `op.readback`, and the app-start paths (`app.cold`, `app.warm`,
  `app.reconnect`, `app.me`, `app.chunk`, `app.state`, `app.key`), each with its label.
- Tests: hub unit (`session-plane.test.ts`: `read` carried and `op` relayed; the shape
  refusals), fake-machine tests, web unit (`capabilities.test.ts` for the derivation and
  the fallback; the composer's slash handling; `CommandStatus`'s three states), e2e
  (`depth-info.spec.ts` for the status read; a new `command.spec.ts` for A2–A5 against
  the fake machine, the older-producer case included).

**Interfaces.** Exposes: DX5 `capabilities`, ops `read` and `command`, events `command`;
DX4 `presence.capabilities`, `machine.sminos`, kinds `read` and `op`; DX3/DX2 `read`;
DX6 `command`; DX2 `welcome.kinds`; the web's `Subscription.read`, `ops`,
`capabilities()`. Consumes nothing new.

**Decisions of this milestone.** The three enabled rows are the ones whose effect check
needs no spike. `rename`'s effect check tolerates the name mod's own `/rename`
(`name.tsx`) running between: the check looks for a `custom-title` row with *this*
name. The Info tab asks `read status` once per subscription open and on *Refresh*, not
on every presence. A `read` on an agent sub is refused by the web before sending
(`status` is the main transcript's). The web's fallback reason uses the `machine`
presence's `sminos`, and *an older plugin* when that too is absent (a daemon, or a hub,
older than M0).

**Does not touch.** The typeahead and the catalog (M1); any read but `status`; any
built-in beyond the three; `compact`'s instructions (M2); the request card (M3).

**Proves.** A1–A7, and A30 for its paths.

### M1 — The command spine: the table whole, readback by row, the typeahead

**What exists at its end.** Every command of the session is in a typeahead that opens
with no round trip; the enabled `run` rows are the inventory's whole `run` class, the
`run-prompt` rows and every non-built-in run, the readback links a stdout row to its
command, and the Esc refusal names its way out.

**Gates.** The `run` rows for `fast on|off` and `goal <c>|clear` wait on spike 4; the
non-built-ins on spike 5; the Esc refusal's copy on spike 6; the row-link readback on
spike 7. Each result changes one thing:

| spike | holds | fails |
| --- | --- | --- |
| 4 (`/goal`, `/fast`, `/fork`, `/recap` print one line) | the row is `run` with its form; `fast` carries `outlives` if it persists (then `drop` pending F1) | the row is `panel` with *measured: opens a panel on <engine>* |
| 5 (plugin, skill and MCP commands run without a panel) | every non-builtin is `run-prompt` | the source that opened a panel is `panel`, by `source`; the rest run |
| 6 (a desk Send clears the Esc refusal) | the refusal's copy offers *Send a message from the desk to wake it* | *press a key in the terminal*; the desk's Send is still offered as a wake with *may not clear it* |
| 7 (readback: the link, back-to-back, interleaved; whether the rows pass `session.append`) | `parentUuid` holds: `row` readback by parent; else by adjacency with no command row between; the rows reach the hook, or are read from disk | ambiguous cases are `none`; the rule's exact boundary is recorded in Surprises |

**Machine half.** `bridge-commands.tsx`: every `run` and `run-prompt` row enabled as the
spikes allow; the catalog (§5): `catalogNow($)` joins `$.command.list()` with the route
table, reads `$.config.list()`'s `model` row's options and resolves each family alias
through the session's environment, fingerprints the two, and emits DX5 `catalog` at
`session.start`, after each `command` end whose name is `reload-plugins`,
`reload-skills` or `mcp`, and at each heartbeat for a minute after one, when the
fingerprint changed. The readback by row (§6) in `bridge-rows.tsx`: the command row
recognized by its `<command-name>` and this plugin's origin; the stdout row linked by
the rule spike 7 settled. `sminos_bridge.py`: keeps the latest `catalog` and puts it in
the snapshot. `sminos_plane.py`: the DX4 snapshot gains `catalog` from the child's; a
`catalog` event is relayed as DX4 `catalog` on main subs when the hub lists it; `read
catalog` answers the same body. `sminos_rpc.py`: nothing new (the RPC is M0's).

**Hub and web half.** Hub: `snapshot.catalog?` and the `catalog` kind, relayed unread.
Web: the typeahead ported from MAWS — `composer/mentions/SlashPalette.tsx`, `popup.tsx`,
`rank.ts`, `items.ts`'s `SlashItem` with `origin` from `source`/`plugin` and `action`
from the route class (`text` for `run` and `run-prompt`, `widget` for `routed` and
`panel`-with-`to`, `unavailable` with the reason otherwise; the typeahead offers the
argument form of a `run` row whose bare form is a panel: `mcp` shows `enable|disable|
reconnect <server>`), MAWS's tiers and recents as they are — into `SessionComposer`; the
catalog store (`state/catalog.ts`, per session and fingerprint, `localStorage` for the
last 32 sessions, the *as of* label); `CommandStatus` draws `row` readbacks and
*ran, unconfirmed*. `latency.ts`: `palette.open`, `catalog.ready`, `read.catalog`.
Fake machine: a recorded catalog in the snapshot and a `catalog` change on command.

**Decisions.** The typeahead's items for a session with no catalog (an older bridge)
come from the cache if one exists, else the desk's own panel items alone with the
version line (A13); the web holds no copy of the route table. Rows the inventory marked
I that no spike covers (`list-agents`, `subtask <task>`, `reload-skills`) stay `run` with
`enabled: false` and *not measured on <engine>* until the research session measures
them; a measured row is enabled by a one-line table change. `cd <path>` is checked in
the daemon before it is forwarded, against the project's known checkouts
(`sminos_policy.known_checkouts`, as spawn is checked), refused `unknown-checkout`:
the bridge cannot know the project's checkouts. A `run-prompt` command's outcome is the turn
it starts: the status line says *started a turn* at the `op end` and nothing more. A
`run` row with `outlives` draws its label under the item and again in the status line.
The composer's typed form (M0's) and the typeahead share one path: the typeahead
inserts text, Send routes it.

**Does not touch.** Panels (M2); the request card (M3); `follow` rows (M4); the `!`
mode.

**Proves.** A8–A13, A30 for its paths.

### M2 — Native panels from reads

**What exists at its end.** Side question, context and usage, the model and effort
selector, MCP status and actions, compact with instructions, status, permissions and
hooks — each a web panel drawn from pushed or read data, none a terminal panel.

**Gate.** `btw` ships after spike 3 (`$.model.fork` mid-turn and idle: latency, cost, its
`aborted` case). Holds: the op as §9 says, with the spike's mid-turn latency in
Surprises and `B.btw`'s sample split by idle and busy. Fails mid-turn only: the
capability's `note` says *answers once the turn ends* and the bridge holds the fork to
`turn.complete` as it holds a compaction. Fails outright: the panel says *side questions
need an engine newer than <engine>*.

**Machine half.** `bridge.tsx`: op `btw` (§9); reads `usage`, `mcp`, `settings` (§5,
cut per §11). `bridge.tsx` `compact`: already takes `instructions`; `sminos_rpc.py`
`shape()` gains a `compact` branch (`instructions` optional text, at most 4,096
characters) and `plan()` passes it; `RPC_NAMES` gains `btw` (`prompt` text at most
8,192 characters); `btw` events become `op` as `command`'s do. `sminos_plane.py`: the
`mcp` read's `disabled` list from `.claude.json` (the session's working directory's
project entry).

**Hub and web half.** Hub: `RpcArgs.compact.instructions?`, `RpcArgs.btw`,
`RpcResults.btw`. Web, each ported from MAWS's renderer and cut to the desk's data: the
side pane (`side/BtwWidget.tsx`, `side/store.ts`, `SideTool.tsx`) drawing `op end`'s
text and usage, and open while the turn runs; `widgets/ContextWidget.tsx` and
`composer/frame/ContextRing.tsx` from `read usage` (summary on open, *Count exactly* for
full); `widgets/UsageWidget.tsx` (rate limits are empty without a subscription: say so);
`widgets/ModelSelector.tsx`'s model and effort views from the catalog's models, applying
through today's `model` RPC with the session-only note (A16); `widgets/McpWidget.tsx`'s
list from `read mcp` with *Reconnect*, *Disable*, *Enable* issuing M1's `command`
(`mcp <verb> <server>`), the `outlives` label on the actions, and *in the terminal:
/mcp* for OAuth and a failed server; `widgets/CompactWidget.tsx` with instructions;
`widgets/StatusWidget.tsx` widening the Info tab; `widgets/PermissionsWidget.tsx` and
`HooksWidget.tsx` read-only from `read settings`. The typed `/btw`, `/context`,
`/usage`, `/model`, `/effort`, `/compact`, `/permissions`, `/hooks`, `/status` open
their panel from the typeahead (`widget` action). `latency.ts`: `btw.answer`, `read.usage`,
`read.mcp`, `read.settings`, `panel.*`.

**Decisions.** A panel opens from what it has (the catalog, the last usage) and reads
on open for what it does not; a read's error draws in the panel with *Retry*. The MCP
panel's *unknown* is a server named by the loop's rows (`mcp` in the `subagents` body)
that `$.tool.list()` does not name and the disabled list does not hold. `read settings`
is asked when the Permissions or Hooks panel opens, never pushed.

**Does not touch.** The request card's scopes (M3); `/mcp`'s bare panel; plugin
management (`/plugin`, a daemon CLI path, out of this run).

**Proves.** A14–A19, A30 for its paths.

### M3 — Requests and modes

**What exists at its end.** A permission card offers the engine's suggestions with a
scope; a plan is approved into a chosen mode; the mode chip shows the session's mode and
reaches what the mod API reaches.

**Gate.** Spike 1 (an allow carrying `setMode`, `addDirectories` or `addRules` with
destination `session` changes the live session). Holds for `addRules`: A20's *this
session* scope. Holds for `setMode`: A21's *Implement in <mode>* and the armed mode
(§7). Holds for `addDirectories`: the `add-dir` row becomes *at a prompt: allow and add
the directory* (F5's shape, with the directory from the suggestions). Each that fails:
the control is not offered, with *the engine ignores <type> from a hook on <engine>*.
Spike 1 measures destination `session`; M3's first step measures `localSettings` the
same way on the machine (an allow carrying `addRules` with that destination, then the
file and the next identical call), and offers that scope only if it holds.

**Machine half.** `bridge-stream.tsx` `raisedFields` gains `suggestions` (bounded:
Interfaces); `bridge-requests.tsx` `engineDecision` passes `updatedPermissions` from a
decision's `suggestion` (index into the raised list) or `mode`; `sminos_bridge.py`
`_check_decision` admits `updatedPermissions` (an array of at most 8 objects) on a
permission and refuses it on a question; the mode op (§7). `sminos_requests.py`
`raised_draft` passes `suggestions`; `sminos_rpc.py` `shape()` and `check_digest`:
`suggestion` an integer within the re-read list, its destination in `{session,
localSettings}`, `mode` only when the pending request's tool is `ExitPlanMode` and
within the ceiling (`admit_spawn`'s rule, factored out); `RPC_NAMES` gains `mode`.
`sminos_plane.py`: nothing (the mode is the web's from rows).

**Hub and web half.** Hub: `Raised.suggestions?` (the code covers it; `raisedShapeError`
admits an array of at most 8 objects each at most 2 KiB), `RpcArgs.decide.suggestion?`,
`.mode?`, `RpcArgs.mode`. Web: `request-card/scope.ts` and `variants/Permission.tsx`'s
scope radio cut to the two scopes; `variants/Plan.tsx`; `composer/frame/ModeChip.tsx`
and `statusline/ModeMenu.tsx` with `MODE_REFUSAL_WORDS`'s pattern for the unreachable
modes; the mode derived from rows (`depth/source/`'s derivation, `permission-mode` rows
and user rows' `permissionMode`). `latency.ts`: `decide.scoped`, `mode.drawn`.

**Decisions.** A suggestion is shown as the engine words it (the rule's `toolName` and
`ruleContent`), under the scope radio; the digest stays over `input` alone, and the
index is checked against the bridge's current list, so a changed list refuses
`digest-mismatch`-like (`not-pending` with the reason). A plan card's modes are the
machine's ceiling and below; `bypassPermissions` is never offered. The armed mode is
forgotten at the turn's end if no allow carried it, and the chip says so.

**Does not touch.** Shift+Tab's arbitrary switching (M6 or terminal); `add-dir`'s dialog
(it always confirms: H-panel; only the suggestion path).

**Proves.** A20–A22, A30 for its paths.

### M4 — Agents, fork, following

**What exists at its end.** One subagent can be stopped or messaged; a conversation can
be forked into a new seat; `/clear`, `/branch`, `/resume <id>` and `/background` are
followed.

**Gates.** Spike 2 (`TaskStop` on a foreground and a background subagent id): holds →
A23 for both; holds for one → the other's *Stop* says *stops only <kind> agents on
<engine>*. Spike 8 (`--fork-session` of a live session copies and leaves the original
untouched): holds → A24; fails on a live session → *Fork* offered for ended sessions
only, with *fork a running session from its terminal*.

**Machine half.** `bridge.tsx`: ops `stop-agent` and `tell` (§9); `session` start gains
`previous` (the mod remembers the ended id and reason across the id change it already
handles, and the heartbeat's fallback for a change with no `session.end` names
`reason: "unknown"`); the `follow` rows enabled with `background`'s condition (§8.3),
`bridge-agents.tsx` tracking `Workflow` calls it saw. `sminos_plane.py`: the `continued`
log event and `end {continued, to}` (§8.2); the `/background` lineage from the
supervisor's `list` and the `continued-in` record. `sminos_rpc.py`: `stop-agent` (the
agent in the plane's tree), `tell`, `fork` (the spawn path with `--resume <id>
--fork-session`, around the copy guard, `fork_of` on the `joined` event); `RPC_NAMES`.

**Hub and web half.** Hub: the RPC names and shapes; `end`'s `continued` reason with
`to`; the `continued` log kind is any kind to the hub (it checks the code, not the
kind). Web: `tools/agents/subagents/DrillIn.tsx`'s `StopAgent` with its confirm and
`RelayComposer.tsx` in the subagent drill-in; a subset of `sessions/ForkSheet.tsx` (no
rewind-to-message); following in `shell/sessions.ts` and `ProjectView.tsx` (the
selection moves, subscriptions re-target, RPCs stay); the end marker's *continued as*;
the `continued` event in the log projection. `latency.ts`: `agent.stop`, `agent.tell`,
`fork.joined`, `follow.moved`.

**Decisions.** A `tell` to an agent the tree does not hold is refused `unknown-task`'s
sibling, `unknown-agent` (a new DX6 code). `fork`'s result names the new session and
alias as `spawn`'s does; the new seat's brief is the fork's `brief` if given, else none
(the conversation is the brief). Following keeps the old session's channel selectable
from the sidebar under its last title with *continued*.

**Does not touch.** `/resume`'s bare picker; `E5`'s value is covered by Resume.

**Proves.** A23–A26, A30 for its paths.

### M5 — Composer parity

**What exists at its end.** Attachments, `@` file mentions, prompt history and drafts.

**Gate.** Spike 9 (`@<path>` in a plugin-submitted prompt takes the engine's attachment
extraction). Holds → A27 as §10. Fails → the attachment is sent as a message naming the
path (*the file is at <path>*) and the strip says the model must read it; images stay
refused with *images need a newer engine*.

**Machine half.** `sminos_rpc.py`: `attach` (§10, the bound, the directory, the sweep
with the bridge's `<id>.json`); `sminos_plane.py`: the `files` read (`git ls-files -z`,
cached per working directory for 10 s, at most 20,000 entries then `truncated: true`,
answered in parts above the frame limit as snapshots are). Fork F3's `shell` is not
built.

**Hub and web half.** Hub: `RpcArgs.attach`, `RpcResults.attach`. Web: the editor and
its controller (`composer/editor/Editor.tsx`, `controller.ts`, the long-paste atoms of
`extensions.ts`), `frame/AttachmentStrip.tsx` and `editor/paste.ts` with `pathForFile`
replaced by the `attach` RPC's path; `mentions/AtMenu.tsx` from `read files`;
`editor/history.ts` and `drafts.ts` on IndexedDB. `latency.ts`: `attach.sent`,
`read.files`.

**Does not touch.** `!` shell (F3); the queue's edit and withdraw (A4: no mod noun lists
the engine's queue).

**Proves.** A27–A29, A30 for its paths.

### M6 — The attach key driver for `--bg` seats (stub)

Waits on fork F2. If the owner says yes: a daemon key driver that attaches to a `--bg`
job under a pty, sends a key sequence, detaches, and reads the result back from rows,
never the screen; the rows it would reach are the inventory's §3.6 (Shift+Tab ×N, Enter
or `4` on a prompt the hooks never saw, the rewind picker by position, Esc on a panel);
offered only where the capability says `attach`. The spec gains its design and
milestone then, with a dated line.

## Concrete Steps

Working directories: doperpowers at its clone (`sminos/` paths below are the plugin's);
MAWS at its clone. Each milestone's branch names its half: `desk-ctl-m<N>` in both.

**doperpowers, every milestone.**

```
scripts/bump-version.sh --plugin sminos <next minor>     # same commit as the change
sminos/tests/run-sminos-tests.sh                          # the sminos gate; SMINOS_PART=core|suites|all
sminos/tests/mods/run.sh                                  # the sminos-mods gate (claude plugin test)
tests/mods/typecheck.sh                                   # the mods-types gate
```
Expected: each script ends with its pass count and exit 0; `run-sminos-tests.sh` prints
`PASS <n>` per suite and `all suites passed`.

**MAWS, every milestone.**

```
/tmp/maws-review/with-slot.sh scripts/ci-gate.sh <worktree> --gates static,unit
/tmp/maws-review/with-slot.sh scripts/ci-gate.sh <worktree> --gates e2e:desk-web        # a web half
/tmp/maws-review/with-slot.sh scripts/ci-gate.sh <worktree> --gates e2e:desk-web-hub    # the relay changed
pnpm --filter desk-hub test ; pnpm --filter desk-web test                                # while iterating
pnpm --filter desk-hub fake-machine -- --help                                            # the stand-in's CLI
```
Expected: `ci-gate: run <id> success` then `GREEN <run-url>`; a red gate prints
`FAIL <gate> log=<path>`.

**The live walk, each milestone, on both Macs** (after MAWS is deployed and the sminos
bump installed on the macbook, the mini behind):

```
sminos list --here                                        # the sessions and their names
sminos watch <member> --json | grep -E '"type": "(command|catalog|btw|session)"'
sminos command <member> rename desk-m0                    # M0's CLI verb: the same op the desk issues
sminos read <member> status
sminos daemon policy --read-only on                       # A7, then --read-only off
```
Then the desk with `?latency`, the A-items of the milestone in order, and
`window.deskLatency()` copied into the milestone's report under the spec's directory;
the table on #52 updated with the desk's numbers beside RC's.

**M0's first proof**, before any web: `sminos command <member> rename desk-m0` prints
`queued (run) id=<id>`, and `sminos watch` shows `{"type":"command","phase":"end",…,
"readback":{"how":"effect","text":"Session renamed to: desk-m0"}}` within 5 s;
`sminos read <member> status` prints the version, base, root and surfaces.

## Interfaces and Dependencies

Each interface names the repository that owns it. Fields marked `?` are optional on the
wire and absent from an older producer; a consumer treats absence as "the older side".

### DX5 (doperpowers: `sminos/hooks/mods/`, `sminos/skills/sminos/scripts/sminos_bridge.py`)

**`GET /status`** gains:

```json
"capabilities": {
  "protocol": 2,
  "engine": "2.1.307",
  "ops": ["ping","steer","interrupt","stop","model","compact","deliver","answer","read","command"],
  "reads": ["status"],
  "routes": {"measured": "2.1.307"}
}
```
`ops` and `reads` grow by milestone (M1 adds read `catalog`; M2 op `btw`, reads
`usage`, `mcp`, `settings`; M3 op `mode`; M4 ops `stop-agent`, `tell`; M5 nothing of the
bridge's). The bridge posts it to the child in `resync.capabilities`; the child answers
`status()` with the latest.

**Ops** (the child's stdout lines; the mod's `result` events):

| op | args | result |
| --- | --- | --- |
| `read` | `{what, args?}` | `{ok: true, result}` per kind below; `{ok: false, error}` for a kind it does not serve (`no read <what>`) or a failed call |
| `command` | `{name, args?, from?, rpc?}` | at once: `{ok: true, result: {queued: true, route: <class>, id}}`; refused: `{ok: false, error, code}` with `code` one of `unknown-builtin`, `panel`, `routed`, `follow`, `drop`, `local`, `bad-args`, `disabled`, `stopped`, `turn-unknown` |
| `btw` (M2) | `{prompt, rpc?}` | `{ok: true, result: {started: true, id}}`; `{ok: false, error}` (empty prompt; `nothing-to-fork` known at once) |
| `mode` (M3) | `{mode}` | `plan`: as `command plan`; another mode: `{ok: true, result: {armed: true}}` when spike 1 holds, else `{ok: false, error, code: "unreachable"}` |
| `stop-agent` (M4) | `{agentId, from?}` | `{ok: true, result: {agentId}}`; `{ok: false, error}` (not an agent the engine lists; TaskStop's error) |
| `tell` (M4) | `{agentId, text}` | `{ok: true, result: {sent: true}}`; `{ok: false, error}` |

Read results:

```ts
status:   {version: {version, base?, builtAt?}, model, cwd, root, repo: {remote?, branch?} | null,
           surfaces: string[], override: {model, effort} | null}
catalog:  Catalog                                                   // below
usage:    SessionUsage & {context: {breakdown?: ContextBreakdown}}  // the engine's shape, `$.session.usage(args)`
mcp:      {servers: [{name, status: "connected" | "unknown", tools: number}]}   // the plane adds disabled ones
settings: {permissions: {allow: Rule[], ask: Rule[], deny: Rule[], additionalDirectories: string[], defaultMode: string | null,
                         bySource: {[source]: {allow, ask, deny}}},
           hooks: {[event]: [{matcher: string | null, commands: number}]}}       // never a command's text, never `env`
```

**Events** (the mod's posts):

| type / phase | fields |
| --- | --- |
| `command` / `start` | `id, name, args, t` |
| `command` / `end` | `id, name, args, settled: {ok: true, text?, context?} \| {ok: false, error}, readback: {how: "text" \| "row" \| "effect" \| "none", text?, uuid?}, t` |
| `btw` / `start`, `end` (M2) | `id`; on end `text, usage: {input, output, cached?}` or `reason` |
| `catalog` (M1) | `Catalog`: `{fingerprint, commands: [{name, description, source, plugin?, route: {class, to?, reason?, forms?, outlives?, enabled}}], models: {options: string[], aliases: {[family]: string \| null}}, measured: "2.1.307"}` |
| `session` / `start` (M4) | gains `previous?: {session, reason: "clear" \| "resume" \| "branch" \| "unknown"}` |
| `raised` (M3) | gains `suggestions?: PermissionUpdate[]` (at most 8; each rule string at most 512 characters; the list is the engine's `permission_suggestions` verbatim within those bounds, or absent) |

The child annotates any relayed event carrying an `id` it holds in `rpc_of` with `rpc:
<nonce>`, as it does for `compact`. The child's snapshot line gains `capabilities` and
`catalog` (the latest of each).

**`POST /requests/<request>/decision`** (M3) admits `updatedPermissions?:
PermissionUpdate[]` (at most 8) on a permission; refuses it on a question (400).

### DX4 (owner: MAWS `apps/desk-hub/src/protocol/session.ts`; producers: the plane and the fake machine)

```ts
SessionPresence = { record: JsonObject | null; bridge: boolean; capabilities?: Capabilities };
Capabilities = { protocol: number; engine: string; ops: string[]; reads: string[]; routes: { measured: string } };
MachinePresence = { online; policy; checkouts; sminos?: string };          // the plugin's version

// subscription kinds (n = 1, 2, …), relayed unread:
read:    { id: string; what: string; result?: JsonValue; error?: { code: 'no-bridge' | 'unsupported' | 'timeout' | 'busy' | 'failed'; message: string } }
catalog: Catalog                                                            // M1; main subs only; also `snapshot.catalog?`
// session-wide (sub and n null), relayed unread:
op:      { rpc: string | null; op: 'command' | 'btw' | 'mode' | 'stop-agent' | 'tell'; phase: 'start' | 'end'; id: string; [field: string]: JsonValue }
// `end` reasons gain:
end:     { reason: ... | 'continued'; to?: string }                           // M4
```
`SUBSCRIPTION_KINDS` lists `read` and `catalog`; `SESSION_WIDE_KINDS` lists `op`. The
hub checks an `op`'s and a `read`'s body only for being an object, as it does `compact`.

### DX3 and DX2 (owner: MAWS `apps/desk-hub/src/protocol/browser.ts`, `machine.ts`)

```ts
// browser → hub
{ t: 'read'; sub: string; id: string; what: string; args?: JsonObject }       // id ≤ 64 chars, what /^[a-z-]{1,32}$/, args ≤ 4 KiB
// hub → machine
{ t: 'read'; project: string; session: string; agentId: string | null; sub: string; id: string; what: string; args?: JsonObject }
// hub → machine, `welcome` gains
{ t: 'welcome'; ...; kinds?: string[] }                                       // the session kinds this hub lists
```
A `read` on a sub the socket does not own is passed over quietly, as `diff` is; a
malformed one is `bad-shape`.

### DX6 (owner: MAWS `apps/desk-hub/src/protocol/rpc.ts`; executed by `sminos_rpc.py`)

| `rpc` | `args` | result (`done`) | milestone |
| --- | --- | --- | --- |
| `command` | `{session, name, args?}` — `name` `[A-Za-z0-9:_-]{1,64}`, `args` text ≤ 4,096 | `{queued: true, route, id}`; the outcome follows as `op`; a bridge refusal is `failed` with the bridge's reason | M0 |
| `compact` | gains `instructions?` (text ≤ 4,096) | unchanged | M2 |
| `btw` | `{session, prompt}` (≤ 8,192) | `{id}`; the answer follows as `op` | M2 |
| `decide` | gains `suggestion?: number`, `mode?: PermissionMode` | unchanged | M3 |
| `mode` | `{session, mode}` | `{armed: true}`; for `plan`, `{ran: true, id}` and the outcome follows as `op {op: "command"}` (the bridge runs `/plan` through its command path) | M3 |
| `stop-agent` | `{session, agentId}` (`[A-Za-z0-9_-]{1,128}`) | `{agentId}` | M4 |
| `tell` | `{session, agentId, text}` | `{sent: true}` | M4 |
| `fork` | `{session, brief?, worktree?, model?, effort?}` | `{session, alias}` | M4 |
| `attach` | `{session, name, type, bytes}` (base64; the RPC's 1 MiB bound) | `{path}` | M5 |

New error codes: `unknown-agent` (M4). Every new RPC is X class: `read-only` first;
`unsupported` without a bridge (`fork` and `attach` need none: the daemon runs them).

### The log (owner: doperpowers `sminos/skills/sminos/scripts/sminos.py`; read by the web's projection)

`continued {from, to, reason}` (M4), written under the machine's writer when a bridge's
first `session` start names `previous`, or when the daemon links a `/background`; the
web's projection draws it as the old channel's end and the new session's start. `joined`
gains `fork_of?: string` (M4).

### The web (owner: MAWS `apps/desk-web/src/`)

```ts
// shell/session-plane.ts
interface Subscription { read(what: string, args?: JsonObject): Promise<JsonValue>; /* rejects with the answer's error; 15 s */ }
// conversation/capabilities.ts
VERBS gains 'command' | 'status' (M0), 'btw' | 'usage' | 'mcp' | 'settings' (M2), 'scope' | 'mode' (M3), 'stop-agent' | 'tell' | 'fork' | 'follow' (M4), 'attach' | 'files' (M5)
// a read kind is a capability like a verb: `can` from `capabilities.reads`, `reason` naming the version otherwise
// project/conversation.ts
ops: Record<string /* nonce */, { op: string; phase: 'start' | 'end'; body: JsonObject }>
// state/catalog.ts (M1)
useCatalog(session): { catalog: Catalog | null; stale: boolean; asOf: number | null }
```

### Dependencies

- Engine 2.1.307 on both Macs for the measured table; a newer engine uses the table
  with `routes.measured` behind it until a probe re-measures (the research session's).
- MAWS's renderer units named in each milestone, imported where free of Electron and
  Node, copied and adapted otherwise (the desk spec §2's rule).
- The baseline table on #52 (the `desk-latency-baseline` branch) for every `B.<name>`.
- The spikes file, `~/claude-code-bundle/2.1.300/notes/desk-mod-run-spikes.md`, for the
  gates; the research session says when each lands.

## Surprises & Discoveries

- Observation: The inventory's §3.5 plan to carry capabilities "under the bridge field"
  of presence cannot ship: the hub refuses a presence whose `bridge` is not a boolean,
  and passes extra fields through.
  Evidence: `apps/desk-hub/src/objects/project.ts` `presence()`: `typeof body.bridge
  !== 'boolean' … → bad-shape`; the message is stored whole (`putPresence`).
- Observation: The plane never POSTs the bridge's `/command`; it reads the child only
  through `GET /events` and `GET /status` probes, and throws the status body away. The
  `read` relay is a new path and must block off the uplink's thread as `diff` does.
  Evidence: `sminos_plane.py` `Bridges.probe` keeps `answered` alone; `Plane.diff` runs
  `working_diff` on a thread; `post_command` is `sminos_control.py`'s, called by the
  daemon's RPCs and the CLI verbs only.
- Observation: Whether the rows of a command the bridge runs reach its `session.append`
  hook is unknown: the bridge's own appends and its own compaction pass none of its
  hooks. The inventory's §3.2 marked this C; it is spike 7's.
  Evidence: `bridge.tsx` 332 ("The hook does not see the plugin's own append"),
  1771-1772 ("This plugin's own compaction passes no hook of its").
- Observation: `FIRST_WAIT_S` is 8 s, not 5; it is the CLI verbs' wait for a first
  snapshot. The 5 s the brief and the inventory cite is the child's
  `SMINOS_BRIDGE_READY_WAIT` (`_ready_wait()`), and the plane's own bound on a bridge
  that sends no snapshot is `OPEN_WAIT`, 20 s.
  Evidence: `sminos_control.py:39` `FIRST_WAIT_S = 8`; `sminos_bridge.py:130-135`;
  `sminos_plane.py:178`.
- Observation: The daemon's `compact` RPC sends `{"op": "compact"}` alone and `shape()`
  has no `compact` branch, while the bridge's op and the CLI's `sminos compact` already
  take `instructions`: M2's change is the daemon's and the hub type's.
  Evidence: `sminos_rpc.py:592`, `:855-890`; `sminos_control.py:311-313`.
- Observation: The bridge already calls `$.settings.read({source: 'user'})` (to find
  the secrets guard) and `$.session.usage()` without `breakdown`; `$.command.list`,
  `$.model.fork` and `$.config.list` appear nowhere in the mods, and `$.command.run` only
  in the name mod's `/rename`.
  Evidence: `bridge.tsx:1212`, `:1492`; `name.tsx:188`.
- Observation: The sminos tests live under `sminos/tests/` (`bridge_order.py`,
  `dx4-jobs.json`, `run-sminos-tests.sh`), not `tests/sminos/` as the inventory and the
  desk spec's DX4 cite; `dx4-jobs.gen.py` and the fake machine's README still print the
  old path.
  Evidence: `ls /tmp/dp-main/sminos/tests`; `tests/` at origin/main holds `mods/` only.
- Observation: The hub refuses an RPC whose name it does not list, so a new RPC needs the
  hub before the web can send it; the daemon passes a frame it does not handle by.
  Evidence: `project.ts:1365` `no RPC ${name}`; `sminos_uplink.py:1302-1305`.
- Observation: `$.agent.list()` leaves workflow agents out, so the bridge cannot see a
  running workflow agent except through the `Workflow` calls it saw itself; `/background`'s
  own dialog turns on exactly those.
  Evidence: the 2.1.300 types, `agent.list` (dts 3262-3269); cli 2.1.307:239626.
- Observation: The inventory's cites otherwise hold at both heads (MAWS `0ee14186a`
  with #116 and #117; doperpowers `646cb02c`, sminos 1.6.2); two moved (`A7`'s
  `sminos_plane.py:2124-2126` is `diffed`, the git work is `working_diff` at 2144 from
  `Plane.diff` at 2548; `capabilities.ts` is 163 lines, the table 44-162), one is weak
  (`E1`'s `sminos.py:2392` says only that the member mark carries across `/clear`), and
  "the depth column is read-only" overstates: the Jobs tab has Stop.
  Evidence: the citation check of 2026-10-22 (a subagent's read of every B/, S/, W/,
  H/ cite; all 63 R/ paths exist).

## Decision Log

- Decision: Verification. One independent spec review of the design (a
  general-purpose subagent, model fable, with this path and two sentences of context),
  and the `doperpowers:adversarial-reviewer` agent's buildability review of the
  execution section (more than one milestone), in the same round; findings weighed, the
  surviving changes folded with a dated line here, the self-review re-run, stopping at
  a round that changes nothing. Each milestone's branch, in each repository, gets
  `doperpowers:review-code` at the rung its stakes set: M0 `high` (the foundation every
  later milestone and both repositories consume), M1 `high` (arbitrary commands run on
  the owner's machine from the web), M2 `medium`, M3 `high` (permission rules and modes
  saved), M4 `high` (forks and following move sessions), M5 `medium`, M6 as its own
  design says. The last milestone of the run executes the acceptance section as written
  on both Macs.
  Rationale: the stakes, not the size: every milestone widens what the hub's side can
  make a machine do.
  Date/Author: 2026-10-22, the desk orchestrator's spec session (b4948247).

## Outcomes & Retrospective

Pending — written at finish.
