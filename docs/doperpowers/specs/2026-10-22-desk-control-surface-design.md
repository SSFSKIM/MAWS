# The desk's control surface: what the terminal can do, done from the desk (2026-10-22)

The living spec of one run, written from the research session's brief and inventory
(`~/claude-code-bundle/2.1.300/notes/desk-mod-run-brief.md` and
`desk-mod-surface-inventory.md`, 2-1-300-9a, 2026-10-21, the brief as amended by its
adversarial review and by its spike results), the probe that measured commands on
2.1.307 (`mod-command-run-probe.md`), the ten spikes that measured the inventory's
unknowns (`desk-mod-run-spikes.md`, 2026-10-22), and the background-work handoff note
(MAWS PR #79, `research/desk-remote/background-work-handoff.md`, 2.1.307). It extends
the desk's design, `docs/doperpowers/specs/2026-10-15-desk-design.md` (below, "the desk
spec"): its contracts DX2–DX6, its §5 control table, its §6 authentication model. From
here on this document is the reference, the inventory its input; where the two differ,
§14 says so and why, and where the spikes contradicted the inventory the spikes win.

## Purpose

The owner drives their Claude Code sessions from the desk — a phone, another Mac — and
today the desk reaches a tenth of what the terminal does: Send, Steer, Interrupt, a
question's answer, allow or deny, model and effort, Compact without instructions, a
job's Stop, Spawn, Retire, Resume. A `/skill` typed into the desk reaches the model as
words. There is no way to run a plugin command, ask a side question, see the context
grid, allow a tool "and don't ask again", approve a plan into a mode (today's Allow on a
plan does nothing: the terminal's dialog stays), stop one subagent, or fork a
conversation.

After this run, inside today's architecture (the bridge mod in each session → its
`sminos bridge` child → the machine's daemon → the hub → desk-web), two things are true:

1. **Control.** What the owner can do at the terminal they can do from the desk. The
   exceptions are the things that physically need keys in the terminal — a panel the
   engine draws, a dialog the hooks never see, a rewind picker, Shift+Tab, the input
   that clears an Esc — and the desk names each one and says why, instead of hiding it
   or failing when pressed.
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
answer in a side pane while the session's turn goes on. When the session asks to edit a
file, the card offers *Allow*, *Deny*, *Allow for this session* and *Allow and switch to
accept edits*. Pick the mini, still on last week's plugin: the same `/` opens, and each
control the mini cannot take says *mini's plugin is older than the desk's controls:
update sminos on mini*. Turn the latency readout on (`?latency`) and read each new
control's time against its budget.

Done means both are shown working on the owner's two Macs (`macbook` and `mini`), which
run mixed versions while doperpowers rolls out; merged code alone does not count. MAWS
#52's full remote-client protocol continues separately; this run takes what the mod API
allows today.

## Progress

- [x] (2026-10-22 03:10Z) The spec written from the brief, the inventory, the probe, the
  desk spec and both repositories at their heads (MAWS `0ee14186a`, doperpowers
  `646cb02c`, sminos 1.6.2); the inventory's code cites re-checked (§14, Surprises).
- [x] (2026-10-22 03:40Z) Self-review; the static gate green on `c4d9b59e1` (run
  39716397728); PR https://github.com/SSFSKIM/MAWS/pull/118 open.
- [x] (2026-10-22 04:50Z) The ten spikes, the handoff note, the buildability review and
  the design review folded in one revision (Decision Log, entry 2); the self-review
  re-run.
- [x] (2026-10-22 06:00Z) Merged on master (MAWS #118, `ed06afbe2`). The research
  session's re-check of §14 folded (Decision Log, entry 3): the `/background` workflow
  condition tracks task ids, the mode is published from the bridge's own decisions and
  the frequent classic hooks, the catalog re-lists at every heartbeat, the readback rule
  applies to built-in `run` rows alone.
- [x] (2026-10-22) The owner's calls on §15's forks: F1 and F5 as recommended, F6 yes
  under spike 14's condition, F2 and F3 not in this run, F4 and F7 the recommendations
  (Decision Log, entries 4 and 6).
- [x] (2026-10-22) sminos 1.6.3 (`bridge-plan-allow`: the plan approval carries
  `updatedInput`) landed (doperpowers #338, `2920e494`); M3 treats it as its floor.
- [x] (2026-10-22 09:30Z) M0 — foundation: capabilities, the `read` relay, the op-outcome
  pattern, the `command` op's dispatch with five measured rows; built, task-reviewed clean
  and branch-reviewed at `high` in both repositories (doperpowers `desk-ctl-m0`, sminos
  1.7.0; MAWS `desk-ctl-m0`), one late-restart reload edge deferred (Decision Log, entry
  10). Its acceptance walk on both Macs (A1–A9, A33's paths) is the orchestrator's, after
  the rollout of §13.
- [x] (2026-10-22 12:31Z) M0 accepted by the orchestrator after the completed desk
  walk on `web@master.f12fb35c`, MacBook sminos 1.7.1: A2–A4, A6–A8, A9's text
  branch, reload-skills and MCP disable/re-enable passed. The literal *Ran* label,
  A9's replaced-module effect branch and older/stale A1/A5 carry into M1's walk
  below. Observed latency samples are in Outcomes; comparative A33 remains open.
- [x] (2026-10-22 12:36Z) M1 — the command spine: the route table whole, the typeahead;
  build handoff. Both task reviews and both `high` branch reviews were clean;
  sminos 1.8.0's final machine head `70fc4bc6` passed all eight gates. At handoff,
  MAWS's combined-head gates and rollout/walk remained; local headless desktop/phone
  screenshot tests passed (2/2), and both images were inspected. Outcomes records
  the later combined-head verification and live walk.
- [x] (2026-10-22 20:02Z) M1 rolled out: MAWS #126 (`d399c1cac`) deployed at
  19:58Z; doperpowers #353 (`00e34537`, sminos 1.8.0) merged after the older-plugin
  check, then the MacBook rolled at 19:59Z and the mini at 20:01Z. A5's older/stale
  refusals passed; the actual order and A9's missed fixture are recorded below.
- [x] (2026-10-22 20:49Z) M1's first live walk and the owner's attended terminal
  checks completed: the visible Ran label, A10's local opening/names/reasons/MCP,
  A11's two desk commands and terminal command between, A12, and both A13 paths
  passed. A10's Skills grouping and the sleeping-phone recovery failed; the
  observations and A33's measured samples are in Outcomes, not a full M1 sign-off.
- [x] (2026-10-22 22:03Z) First walk fixes deployed: doperpowers #355 (`099a44c9`,
  sminos 1.8.1) and MAWS #127 (`1cea5bc35`), adding Skills membership, guarded
  chunk-load recovery, corrected upgrade/stale guidance and the G1 test-helper fix.
  The live catalog carried `skills`; the deployed Skills UI re-check is below.
- [x] (2026-10-22 23:55Z) Phone wake resnapshot and unseen-receipt recovery deployed
  in MAWS #128 (`4c12e4a1b`), including the missing-outcome line. Committed-head
  Linux and macOS gates passed; browser fixtures are not the owner's phone re-walk.
- [x] (2026-10-23 06:36Z) MAWS #129 (`5a4b93b4c`) deployed: free scroll while
  streaming, after final-head Linux and seven-group Mac gates passed. The
  reader-input policy is in the Decision Log; build and gate evidence in Outcomes.
- [x] (2026-10-24 10:26–10:45Z) Owner's attended physical-phone re-walk on that
  build, MacBook seat `m1-busy`: Skills populated, streaming free scroll worked,
  queued `/color orange` ran after the turn with its row-confirmed Ran receipt;
  unlock preserved the reader's place and showed the completed reply at once.
  Outcomes records the scope; this does not close M1's other branches.
- [ ] M1's unwalked branches: A9's replaced-module effect, A11's same-command
  collision, A14's cached-catalog downgrade and A1's historical no-status fixture
  remain test evidence only. `read.catalog` has no UI consumer and no live timing
  samples; comparative A33 and the full two-Mac acceptance remain open.
- [ ] M2 — native panels from reads: side question, context and usage, model and effort,
  MCP, compact with instructions, status, permissions and hooks. Paused (2026-10-24;
  Decision Log, convergence with MAWS).
- [ ] M3 — requests and modes: rule suggestions with a scope, plan approval into a mode,
  "allow and switch", the mode chip. Paused (2026-10-24; Decision Log, convergence
  with MAWS).
- [ ] M4 — agents, fork, following an id change (three reviewed increments). Paused
  (2026-10-24; Decision Log, convergence with MAWS).
- [ ] M5 — composer parity: attachments, `@` files, history (`!` shell not in this run:
  F3). Paused (2026-10-24; Decision Log, convergence with MAWS).
- [-] M6 — the attach key driver for `--bg` seats: out of this run (F2, the owner's
  choice, 2026-10-22; Decision Log, entry 6).
- [ ] The latency table on #52 against the baseline, and the acceptance walk on both
  Macs.

## Terms

- **The engine** is Claude Code (2.1.307 on the owner's Macs at writing). A **mod** is a
  function-hook plugin the engine loads; **the bridge** is the sminos plugin's mod,
  doperpowers `sminos/hooks/mods/bridge.tsx` and its `bridge-*.tsx` siblings. `$` is the
  engine interface a mod calls (`$.command.run`, `$.session.usage`, …), typed in the
  2.1.300 bundle's `claude-code.d.ts`. A module **reload** (`/reload-plugins`, or a
  restart) replaces the loaded mod; a session keeps the mod it loaded until one.
- **The child** is `sminos bridge --session <id>` (`sminos/skills/sminos/scripts/sminos_bridge.py`),
  spawned by the bridge for the session's life, serving the session's endpoint at
  `$SMINOS_HOME/bridge/<id>.sock` (DX5). An **op** is one command line the child hands
  the bridge (`{id, op, …}`), answered by a `result` event. A **DX5 event** is one line
  of the child's stream (`GET /events`).
- **The daemon** is `sminos daemon` on each Mac; its **uplink** (`sminos_uplink.py`)
  holds the machine's stream to the hub; its **plane** (`sminos_plane.py`) serves the
  session plane: presence and subscriptions; its **requests reader**
  (`sminos_requests.py`) follows each bridge's stream for the requests, settlements and
  compactions it relays session-wide. **RPCs** are the daemon's (`sminos_rpc.py`), DX6.
  The daemon is the execution boundary (desk spec §6).
- **The hub** is MAWS `apps/desk-hub` (a Cloudflare Worker and its Durable Objects);
  **the web** is `apps/desk-web`. **DX2** is machine ↔ hub, **DX3** browser ↔ hub, **DX4**
  the session-plane envelope, **DX5** the bridge's local protocol, **DX6** the RPC shapes
  (the desk spec's Interfaces, where each is defined; this document adds to them).
- **Presence** is DX4's per-session `{record, bridge}` message, kept by the hub and sent
  to every browser; the **machine presence** is DX4's per-machine `{policy, checkouts}`.
  A **subscription** (a **sub**) is one browser's live view of one transcript, numbered
  `n` from its snapshot.
- A **seat** is a session sminos spawned (`claude --bg`); a **terminal session** is one
  the owner opened. A `--bg` **job** is the engine supervisor's record of a seat.
- **X class**: an RPC that causes execution on the machine, so a machine its owner set
  read-only refuses it (`read-only`), and the daemon runs it only after the code, the
  machine, project and session, the ledger, its age and the policy all hold (desk spec
  §6, DX6). Every RPC this document adds is X class.
- **A read** is a request over the session plane that changes nothing on the machine and
  answers on the sub that asked (today: `diff`, `output`; this document adds one `read`
  frame carrying several kinds).
- **The route table** is the bridge's classification of every built-in command, per
  form, by engine version: run, run-prompt, routed, follow, panel, local, drop, with a
  confirm flag (§2; the table itself is in Interfaces).
- **Readback** is how the desk learns what a command did: the engine's printed line
  exists only as a transcript row, never in the call's settled value (H-noout), and the
  bridge reads it in its `session.append` hook (§6).
- **Following** is the desk moving its selection and subscriptions to the new session
  id a command gave the conversation (`/clear`, `/branch`, `/resume <id>`,
  `/background`).
- **A capability** is one entry of the per-session and per-machine lists the bridge and
  the daemon advertise and the web reads to decide what to offer and what to name as
  out of reach (§4).
- **The hazards** H-panel, H-noout, H-default, H-sid, H-esc, H-mcp, H-reply, H-queue and
  H-ctx are the inventory's §1, cited by name below; each is a measured fact about the
  engine, not a design choice. The spikes are cited as **S1**–**S10** (the spikes file's
  sections); the handoff note as **HN**.

## Acceptance

Each item is behavior a person can verify on the owner's machines, with the commands.
`<desk>` is the deployed desk; `<member>` a session as `sminos` names it (`alias#short`).
The readout is `localStorage['desk.latency'] = '1'` or `?latency`; `window.deskLatency()`
prints each path's n, p50, p95 and max. The **older-plugin machine** in each milestone
is the mini while it still runs the sminos version before that milestone's (the
rollout, §13); every milestone is walked once with the mini behind. A **stale session**
is one on an updated machine whose mod loaded before the update (no reload yet); every
milestone's walk includes one.

**M0 — foundation**

- A1. On a session whose bridge is at or above M0's sminos, the Info tab shows the
  engine's version and release base, its repository root and its surfaces within
  `B.read` of the tab opening (a `read status` answered on the sub). On the
  older-plugin machine the tab shows the same fields as *not available from this
  plugin* and the version it would need, not a spinner.
- A2. In the desk's composer, typing `/rename desk-m0` and pressing Send on a bridged
  session at M0's sminos shows *queued*, then *ran*, then *Session renamed to: desk-m0*
  with the mark *confirmed by its row*, and the session's title in the sidebar is
  `desk-m0` (`sminos list --here` shows the new name). `sminos watch <member> --json`
  shows one `run` event with `phase: "end"` and `readback.how: "row"`.
- A3. The same typed `/rename` while the session's turn runs says *queued until
  <name> is idle*, and runs after the turn (H-queue: a mod-path command waits, even an
  `immediate` one).
- A4. Typing `/usage` (a panel) is refused: *opens a panel in the terminal; it would
  hold the session's queue*. Typing `/model sonnet` is refused with *use Model instead:
  /model saves a default for new sessions*. Typing `/foo` is refused *not a command this
  session knows*. At M0 the refusal is the bridge's (the RPC fails with that reason and
  nothing ran: `sminos watch` shows no `run` event); from M1 the composer refuses
  before sending, from the catalog, with the same words.
- A5. On the older-plugin machine, typing `/rename x` is refused in the composer with
  *mini's plugin is older than the desk's controls: update sminos on mini*, with a
  *Send as text anyway* that delivers it as words as today. On a stale session of the
  updated macbook the refusal reads *this session's plugin loaded before the update:
  run /reload-plugins in it, or restart it*, and after `/reload-plugins` typed in that
  terminal the command works.
- A6. With the desk showing a session, stopping its bridge child (`kill <child pid>`;
  the mod respawns it) leaves the composer's controls as they were within 3 s (presence
  re-probed; capabilities unchanged). The e2e, against the fake machine, covers the
  case no live walk can stage: a presence whose capabilities shrink withdraws the
  controls with the reason.
- A7. A `command` RPC sent to a machine set read-only (`sminos daemon policy --read-only
  on`) fails *read-only* and nothing ran (`sminos watch` shows no `run` event).
- A8. Restarting the daemon (`sminos daemon restart`) between a command's *queued* and
  its *ran* still shows the command's *ran* and its line under the same status line
  once the daemon is back (the outcome is owed under the RPC's nonce, as a
  compaction's is).
- A9. `/reload-plugins` from the desk shows *queued*, then *ran: the plugins reloaded*
  (*confirmed by effect*) within 10 s — the bridge answers again from a fresh child, and
  the Info tab's capabilities are those of the reloaded mod; `/reload-skills` shows the
  engine's `Reloaded skills: …` line (*confirmed by text*); `/mcp disable <server>`
  shows `MCP server "<server>" disabled` under the label *saved for this project on
  <machine> until enabled again* (H-default, labelled).

**M1 — the command spine**

- A10. Typing `/` opens the typeahead within `B.palette` of the keystroke with no network
  round trip (the readout's `palette.open` samples are under it, and the socket shows no
  frame between keystroke and draw): every command `$.command.list()` lists for that
  session, named exactly as listed (an MCP prompt as `<server>:<prompt> (MCP)`), grouped
  as MAWS groups them (Engine, Skills, Plugins, Custom), each with its description, and
  each that the desk cannot run marked with its reason (a panel; saves a default; needs
  the terminal; not measured on this engine).
- A11. `/color red` from the typeahead shows `Session color set to: red` (*confirmed by
  its row*). Two commands sent back to back (`/color red`, then `/color blue` before the
  first ran) each show their own line (the bridge runs desk commands one at a time); a
  command typed at the terminal between two desk commands leaves the desk's two lines
  right and the terminal's unattributed. The one case the engine cannot tell apart —
  the same command with the same arguments typed at the terminal during the turn the
  desk's waited on (S7.2) — shows *ran, unconfirmed*, never a neighbour's line.
- A12. A skill command (`/doperpowers:execspec …`) from the typeahead starts a turn in the
  session (the transcript shows the prompt-type command's row and the model's answer);
  the composer's status line says *started a turn*. `/goal <condition>` likewise starts
  a turn; while a goal runs, the typeahead's `/goal clear` says *a queued clear waits
  behind the goal: Interrupt stops it* (S4).
- A13. After the owner presses Esc in the terminal to stop a turn, a desk command is
  refused *stopped at the terminal: commands resume after input is typed there* (S6:
  no mod call clears it, the desk's Send included). After the desk's own Interrupt, a
  desk command is not refused (the mod's `$.turn.abort` does not set the refusal:
  measured, spike 11 — this item checks the built path, the bridge's interrupt and its
  note row).
- A14. On the older-plugin machine the typeahead opens (A10) with the desk's own panels
  (Model, Compact, and whatever M2 has added) and one line, *commands need sminos ≥
  <M1's> on mini*; a session whose catalog the desk cached before its machine fell
  behind (a downgrade; the e2e stages it) draws that catalog labelled *as of <time>*,
  every run item marked as A5 says.

**M0 carryovers in M1's live walk** (M0 accepted with these obligations, 2026-10-22):

- Recheck A2/A9's completed status: the DOM was already `data-command-state="ran"`,
  but the M0 text showed only readback. M1 must visibly say *Ran* alongside it.
- Prove A9's effect branch on the first `/reload-plugins` of an existing seat when
  rolling from sminos 1.7.1 to 1.8.0. The two M0 reloads kept the unchanged module
  and proved only the text branch; this run must actually replace the bridge.
- Recreate A1's older-plugin case and A5's older/stale cases with the MacBook on
  1.8.0, the mini deliberately held behind, and an existing MacBook session not yet
  reloaded. The M0 fixtures had already gained `read.status` before their walk.

**M2 — native panels from reads**

- A15. *Side question* with "one line: what is this session doing?" answers in a side
  pane within `B.btw` (idle: about a second, S3) while the session's turn runs; the
  conversation gains no row (`sminos watch` shows `btw` start and end and no
  `row-seen`); the pane shows the tokens spent. On the older-plugin machine the button
  says *needs sminos ≥ <M2>*.
- A16. The Info tab's *Context* opens the context grid (the categories and their tokens,
  as `/context` draws them) within `B.panel`, from `read usage {breakdown: "summary"}`,
  and *Count exactly* re-reads with `full`; nothing is written into the conversation
  (H-ctx: `/context` is never run).
- A17. *Model* opens the selector with the engine's own options (`default, sonnet, opus,
  …` from `$.config.list()`'s `model` row), the aliases this session maps marked, the
  rest offered as ids; applying one shows *applies to this session's main loop from its
  next request; the terminal's footer keeps showing the launch model* (the session-only
  rewrite; `/model` is never run: H-default).
- A18. The Jobs tab's MCP list shows each server as connected (with its tool count),
  disabled (from the project's `.claude.json`), or unknown, with *Reconnect*, *Disable*
  and *Enable* running M0's `/mcp` forms, and after *Disable* the list marks the server
  disabled; OAuth and a failed server say *in the terminal: /mcp*.
- A19. *Compact* takes instructions, and the status line shows the compaction's start,
  its counts, a hook's skip or the engine's error, as today.
- A20. *Permissions* and *Hooks* (Info tab) show the session's permission rules by
  source and each hook's event and matcher with how many commands it runs; a hook's
  command text is not shown and says *terminal: /hooks* (§11's cut).

**M3 — requests and modes**

- A21. A permission card whose request carries an `addRules` suggestion offers, beside
  Allow and Deny, *Allow for this session* (the rule with destination `session`: no
  file written, the next identical call not raised — `sminos watch` shows no `raised`
  for it) and, where the engine's suggestion names `localSettings`, *Always allow … in
  <project>* labelled as writing `.claude/settings.local.json` on <machine> (the file
  gains the rule). A request without suggestions offers Allow and Deny alone.
- A22. A permission card whose request carries a `setMode` suggestion (the engine
  suggests `acceptEdits` on an edit in default mode, S1) offers *Allow and switch to
  accept edits*; choosing it leaves the session in that mode (the terminal's footer
  reads `⏵⏵ accept edits on`; the chip follows within 3 s).
- A23. An ExitPlanMode request is drawn as a plan card: the plan as markdown, *Implement
  in <mode>* with the modes the machine's ceiling allows, *Keep planning* with feedback
  (a deny carrying the text), and *Clear and implement* once M4's following exists.
  Implementing in `acceptEdits` closes the terminal's *Exit plan mode?* dialog and
  leaves the session in that mode (S1: the allow carries `updatedInput` and `setMode`;
  the chosen mode beats the mode the session was in before plan).
- A24. The mode chip shows the session's current mode stamped *as of <time>* (the
  bridge's own decision the moment it hands one out — A22's switch shows on the chip
  before the terminal's footer is read — else the latest classic hook's reading; a
  Shift+Tab at the terminal on an idle session leaves the chip on the old mode, with
  its stamp, until the next hook fires), and its menu offers *plan* (runs `/plan`)
  and names every other switch *Shift+Tab in the terminal; or allow a request into it*
  (on a `--bg` seat also *M6*). Nothing is "armed": in auto mode and in plan mode
  harmless calls raise no request (S1), so a change waiting for one could wait forever.

**M4 — agents, fork, following**

- A25. In a running subagent's drill-in, *Stop* ends that agent (its row turns
  `stopped`; the parent's turn goes on, and the parent does not spawn it again — the
  note row tells it the person stopped it, S2), and *Message* delivers text the agent
  reads at its next step (`sminos watch` shows the `tell` op; the agent's transcript
  shows the peer message). A background agent (2.1.307's default for every
  model-spawned agent) and, with `CLAUDE_CODE_FORK_SUBAGENT=0`, a foreground one.
- A26. *Fork* on a running or ended session starts a copy as a new seat of the project
  (`claude --bg --resume <id> --fork-session`), listed with *forked from <alias>*, the
  original byte-identical and running (S8: `shasum` of its transcript before and after).
- A27. `/clear` from the desk: the channel ends with *continued as <new alias>*, the
  selection moves to the new session within `B.follow`, an RPC issued to the old id
  before the clear shows its outcome under the old session, unchanged (never re-sealed).
  `/branch <name>` and `/resume <id>` likewise.
- A28. `/background` is offered only while `$.agent.list()` names no running agent and
  no workflow the bridge saw launched is still running — a `Workflow` launched from the
  desk's session hides the control until its `<task-notification>` arrives — (S10: a
  running subagent opens
  *Background this session?*, which holds the queue; a background shell carries over
  with no dialog); its confirm names what the move keeps and loses (§8.3: the running
  shells by id, carried but their exit codes lost; the running monitors by id, lost; an
  MCP call in flight, lost silently; the turn in flight, re-run) and that the terminal
  exits; then the seat appears with the conversation and the channel continues
  *continued as <alias>*. With the old transcript's `continued-in` record deleted by
  hand before the walk, the link still forms from the bridge's notice and the job's
  directory and time, marked *unconfirmed*. With an agent running, the typeahead says
  *terminal only while an agent runs: the engine would ask about it*.
- A29. On a plan card, *Clear and implement* clears the conversation, follows to the new
  session and sends the plan as its first prompt, in that order, and the plan's text is
  the new session's first user row.

**M5 — composer parity**

- A30. A photo pasted or picked on the phone appears in the strip; Send writes it under
  the session's working directory and the model reads it (its answer describes it: the
  prompt names the saved path and asks for a Read, S9 — the engine attaches nothing to
  a mod's prompt); a file over the bound says so before anything is sent.
- A31. Typing `@` lists the working tree's files (from `git ls-files`) fuzzy-filtered as
  typed, within `B.palette` after the first list; picking one inserts its path.
- A32. Up-arrow in an empty composer recalls the previous sends; a draft survives a
  reload of the page.

**Latency, every milestone**

- A33. Each new control's path (§12) is in `window.deskLatency()` after one use, and its
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
| the bridge (mod) | ops `read`, `command`, `btw`, `stop-agent`, `tell`; DX5 events `run`, `btw`, `catalog`, `mode`, `continuing`; `GET /status` `capabilities` and `mode`; `session` start `previous`; `raised.suggestions`; a decision's `updatedPermissions`; desk commands run one at a time |
| the child | relays the ops and keeps the catalog, the capabilities and the mode; keeps an op's `id` → RPC nonce until the op's outcome, not only until its first answer; carries a refusal's `code` |
| the plane / daemon | `presence.capabilities` and `presence.mode`; the machine presence's `desk` capabilities; the `read` relay (one worker thread, as `diff`); DX4 kinds `read`, `catalog`, `op`; the requests reader following `run`, `btw` and `continuing` events into `op` outcomes owed under their nonce; the `reload-plugins` outcome finished by effect; RPCs `command`, `btw`, `stop-agent`, `tell`, `fork`, `attach`; `decide` widened; `compact` with `instructions`; the `continued` log event and the `end {continued}` reason; the lineage of a `/background` |
| the hub | the kinds and frames listed, relayed unread; the RPC names; the presence fields; `welcome.kinds` |
| the web | `capabilities()` from both presences; `Subscription.read()`; the `ops` store; the typeahead and the panels, ported from MAWS's renderer |

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
measured engine base — 2.1.307's is in Interfaces, whole, and checked in as a fixture
both repositories test against — and a session whose base has no table uses the newest
one below it with the capability saying so (`routes.measured` ≠ `engine`). **Every
(name, form) is in one class:** a row has a **bare** route and, where the command takes
arguments, a **with-args** route with its `forms` (Interfaces); the bare route applies
when `args` is empty after trimming, the with-args route otherwise. A route may also
carry `confirm: true`, which makes the web confirm before sending. The classes:

| class | meaning | examples (2.1.307) |
| --- | --- | --- |
| `run` | an argument form measured to print one line and open nothing | `rename <name>`, `color <c>`, `reload-plugins`, `reload-skills`, `mcp enable\|disable\|reconnect <server>`, `cd <path>` (limited to the project's known checkouts), `goal clear`, `exit` (with `confirm`, F6) |
| `run-prompt` | a command that starts a turn, and the turn is its outcome: the built-in prompt-type commands, `goal <condition>` (S4), `plan <description>`, and every `source` other than `builtin` — skills, plugin and MCP commands, named exactly as listed (`<server>:<prompt> (MCP)`), which resolve at turn start with no panel (S5) | `init`, `security-review`, `insights`, `team-onboarding`, every skill |
| `routed` | never run: a dedicated op, read or RPC does it, named in `to` | `model`, `effort` → `model`; `compact` → `compact`; `btw` → `btw`; `context`, `usage` → `read usage`; `plan` (bare) → the mode control, which runs `command plan`; `fork` → the `fork` RPC |
| `follow` | changes the session id (H-sid); refused until M4, then run with following | `clear`, `branch [name]`, `resume <id>`, `background` (with `confirm` and its own condition, §8) |
| `panel` | refused: *opens a panel in the terminal; it would hold the session's queue*; where a read or a tab draws the same, `to` names it | `usage`, `permissions`, `hooks`, `skills`, `status`, `config` (bare), `mcp` (bare), `tasks`, `memory`, `sandbox`, `workflows`, `add-dir`, `rewind`, `plugin`, `resume` (bare), and the plugin panel `diff` |
| `local` | the browser's own | `copy`, `export`, `help` |
| `drop` | not available from the desk, with the reason | `recap` (it refuses any run a plugin starts, S4), `agents`, `login`, `logout`, `theme`, `tui`, and the rest of the table's `drop` rows |

Four more rules bind the table:

- **A built-in not in the table is refused**, `unknown-builtin`, with *not measured on
  this engine* — never tried (the brief's decision 2). A row the spikes did not reach
  (`fast on|off` — the test machine's gateway disables fast mode, S4) is in the table
  with `enabled: false` and *not measured on <engine>* until the research session
  measures it; a measured row is enabled by a one-line table change (spike 13 did this
  for `list-agents` and `subtask`: both `run`, no panel; `list-agents` names the
  machine's other Claude sessions as well as the subagents, sessions outside this
  project included, so its item says so; `subtask <task>` starts a background fork
  agent whose finish arrives as a `<task-notification>` that starts a main turn).
- **What outlives the session is labelled or not offered** (the brief's design rule;
  the inventory's H-default). A `run` row whose command saves a setting carries
  `outlives`, a sentence the web shows with the command: `mcp disable` and `mcp enable`
  (*saved for this project on <machine>: `.claude.json`*). The rows that save a default
  for new sessions — `config k=v`, `autocompact N`, `output-style <s>`, and `fast
  on|off` if it proves to persist — are `drop` in this run with the reason *saves a
  default on <machine>; terminal only*, pending fork F1. `model` and `effort` are never
  run: the desk's Model control is the per-request rewrite, session-only (desk spec §5).
- **The bridge runs no command its own plugin registers** (S5: `$.command.run` skips
  every `command.run` hook of the calling plugin, so such a run falls to the engine's
  "no hook answered" text). A listed command whose `plugin` is `sminos` is refused
  `self` with *run it from the terminal*. The sminos plugin registers none today; the
  rule keeps a later one honest.
- **`/reload-plugins` can replace the bridge itself.** If replaced, the old module's
  posts are fenced off (DX5's nonce, 409), its child is replaced, and its `run end`
  cannot reach the stream. The op answers `queued` before running; the **daemon
  finishes by effect** when a fresh probe sees a different (socket inode, pid), or
  fails at the 60 s deadline. If the engine keeps an unchanged module loaded, the
  bridge instead emits the returned text as `run end`, with readback `text`, and
  frees its desk queue immediately. The first accepted end wins, including for
  nonce-free CLI runs. Decision 11 records the 2.1.308 live walk that superseded the
  assumption that every reload replaces the bridge. `reload-skills` reloads no
  plugin and keeps its `{text}`.

The web never decides a class: it reads the class from the catalog (§5) to draw the
hint and to refuse before sending, and the bridge checks the class again on every
`command` op, so an older or wrong web cannot run a panel.

**The Esc refusal (H-esc) stays, and has no cure from the desk.** After an Esc stops a
turn, the engine rejects `$.command.run` and `$.prompt.submit` with *the session was
stopped and nobody has sent input since* until the person types at the terminal. The
bridge's inbox wake starts a turn but does not clear it (S6); nothing a mod can send
counts as the human's input. The bridge answers a `command` with that refusal verbatim,
code `stopped`, and the web says *stopped at the terminal: commands resume after input is
typed there* — never *Send to wake*. Measured (spike 11, 2.1.307): the mod's own
`$.turn.abort({turnId})` 2 s into a turn ended it 0.24 s later, and right after it
`$.command.run` and `$.prompt.submit({asUser: true})` both ran; in the same session an
Esc keyed into the PTY set the refusal (the run rejected, the submit dropped) and a
prompt typed there cleared it. So the desk's Interrupt leaves commands usable, and the
refusal follows only the terminal's Esc or Remote Control's interrupt; A13 checks the
built path (the bridge's interrupt and its note row). On a `--bg` seat a
supervisor `reply` clears it, which this run does not use: a `reply` is a channel where
text can act as a keystroke (H-reply).

**Mid-turn, every command queues** until the turn ends, `immediate` ones included
(H-queue). The op answers at once with `queued`, and the outcome comes later (§3).

### 3. Ops answer at once; the outcome comes on the stream

The daemon waits at most 10 s for a bridge answer (`COMMAND_WAIT_MS`,
`sminos_control.py`), and a queued command can wait a whole turn. So every op this run
adds answers at once — `{queued: true}` or `{started: true}` with the op's `id` — and
reports its outcome later as DX5 events the daemon turns into one DX4 session-wide kind,
**`op`**, keyed by the RPC's nonce, as `compact` does today, with the plumbing
generalized where `compact`'s is specific:

- **The child keeps the nonce until the outcome.** Today the child maps a relayed
  command's `id` to the RPC nonce the daemon tagged it with (`rpc_of`) and pops the
  mapping at the first `result` event, writing the answer under the nonce
  (`sminos_bridge.py`, `_apply`'s `result` branch). For an op whose first answer is
  `queued` or `started`, the child keeps the mapping until the event that ends it (a
  `run` or `btw` with `phase: "end"` and that `id`), annotating each such event it
  relays with `rpc: <nonce>`, and drops it then or after `RPCS_KEPT` newer ones.
- **The daemon learns the outcome from the requests reader**, which follows every
  bridge's stream for the session-wide events it relays (`WANTED` in
  `sminos_requests.py`: `raised`, `settled`, `resync`, `compact`); it gains `run`,
  `btw` and `continuing`. As `compact` is handled today — `Rpcs.compact()` notes the
  command's `id` on the RPC's claim (`compact_id`), `compacted()` turns each event into
  a DX4 message carrying the nonce or null, `restore_compacts()` re-arms the mapping
  after a restart from the ledger, and the message is owed until the hub takes it — the
  `op` outcome uses the same four pieces made general: a claim notes `op_id` and `op`,
  `op_events()` turns a `run` or `btw` event into DX4 `op {rpc, op, phase, id, …}`
  through the same held-until-named and owed paths, and `restore_ops()` re-arms them.
  A8 proves the restart case. One outcome the daemon finishes itself: a
  `reload-plugins` run, by the bridge answering again (§2).
- **The web keeps `ops[nonce]`** beside `compactions[session]` and draws three states
  for a command — *queued*, *ran*, and the line read back — and never shows a resolved
  promise as success: the transcript row or the checked effect is the success (the
  brief's decision 4).

```
op  {rpc: <nonce> | null, op: "command" | "btw" | "stop-agent" | "tell", phase: "start" | "end", id, ...}
```

`compact` keeps its own kind; everything new rides `op`. An `op` body goes to every
browser of the project, as rows do (the same exposure class); a `btw` answer's `text` is
bounded to 64 KiB so the body fits a frame. The strongest alternative, one DX4 kind per
op (`command`, `btw`, …), lost: each new op would need a hub change to list its kind,
and the hub reads none of these bodies.

### 4. A capability list per session, and one per machine

Today the web hard-codes what each kind of session can do
(`apps/desk-web/src/conversation/capabilities.ts`, the desk spec's §5 table). Every
control this run adds exists on some machines and not others while doperpowers rolls
out, the route table shifts with the engine, a session keeps the mod it loaded until a
reload, and some controls are the daemon's alone (`fork`, `attach`, the `files` read
need no bridge). So two lists:

- **The bridge advertises** in `GET /status` `capabilities` (Interfaces, DX5): its own
  plugin version, the protocol, the engine base, the ops the bridge answers, the read
  kinds it serves, and the route table's measured base. **The plane forwards it in
  presence**, as a sibling field: `presence {record, bridge, capabilities?, mode?}`. Not
  under `bridge`, as the inventory proposed: the hub refuses a presence whose `bridge`
  is not a boolean (`Project.presence`, `apps/desk-hub/src/objects/project.ts`), while
  it passes an extra field through and stores the message whole — so a new daemon's
  presence reaches an old hub and an old web unharmed. The plane learns both fields
  from the body of the probe it already makes (`Bridges.probe`, `sminos_plane.py`, which
  today keeps only whether the status answered); presence is sent again when either
  changes (a module reload spawns a new child, a new socket inode, a new probe; a mode
  change reaches the probe within `BRIDGE_RECHECK`, 2 s).
- **The daemon advertises** in the machine presence: `machine {…, desk?: {sminos, rpcs,
  reads}}` — the plugin's version on the machine, the RPC names this daemon executes,
  the read kinds the plane answers itself (`files`). The hub rebuilds a `machine` body
  from the fields it knows (`machinePresence` in `project.ts`), so M0's hub must admit
  and keep `desk`; through an older hub it is dropped, and the web then says *an older
  plugin* without the number.
- **The web derives from both.** `capabilities()` gains the new verbs; each verb names
  what it needs: a bridge op (in `presence.capabilities.ops`), a daemon RPC (in
  `machine.desk.rpcs`), a read (in either's `reads`), or a combination (`command` needs
  the op and the RPC; `fork` the RPC alone; `btw` both), and reads its `can` and
  `reason` from them. **Three fallbacks**, told apart so the reason sends the owner to
  the right place: a session with no `capabilities` on a machine whose `desk.sminos` is
  at or above the control's version is a **stale session** — *this session's plugin
  loaded before the update: run /reload-plugins in it, or restart it*; a session with
  no `capabilities` on a machine whose `desk` is absent or below is the **older
  machine** — *<machine>'s plugin (<desk.sminos>, when known) is older than the desk's
  controls: update sminos on <machine>*; a `--bg` seat or terminal session without
  a bridge at all keeps the kind table's reasons as today. The capability's own `sminos`
  decides a control's availability; the machine's `desk.sminos` only names the number.

A capability names *what the machine can do*, not *what this moment allows*: a turn
running, a request pending, a mode's ceiling are read from presence and rows as today,
and the capability's `note` says how the action will land.

### 5. Reads over the plane, and the catalogs pushed

**Reads are not RPCs.** RPCs carry a nonce ledger, a code and the 60 s freshness rule,
all for effects; a read changes nothing and should cost one frame each way. The plane
already serves two reads per subscription (`diff`, `output`). This run adds one
up-frame, DX3 `{t: "read", sub, id, what, args?}`, carried to the machine as DX2 with
the sub's session, and one down-kind, DX4 `read {id, what, result?, error?}` on that
sub. The plane finds the sub, and on a worker thread (as `diff` runs git) POSTs the
bridge child `/command?wait=<COMMAND_WAIT_MS>` with `{op: "read", what, args}` — a path
the plane does not use today (it reads the child through `GET /events` and `GET /status`
alone; `post_command` is `sminos_control.py`'s) — and the bridge answers from `$`. No
bridge, no such read, a timeout or a failure come back as the answer's `error`, never as
a hub refusal. A read is a main-transcript subscription's unless its kind says otherwise.

| `what` | answers from | milestone |
| --- | --- | --- |
| `status` | `$.session.version()`, `model()`, `cwd()`, `root()`, `repo()` (its remote URL stripped of any userinfo), `surfaces()`, the bridge's override and its mode | M0 |
| `catalog` | the catalog below, on demand (a refresh after `/reload-plugins`) | M1 |
| `usage {breakdown: "summary" \| "full"}` | `$.session.usage({breakdown})`: the context window with `context.breakdown` in the SDK's `get_context_usage` shape, the rate-limit windows, the cost; never `/context`, which writes its grid into the conversation (H-ctx) | M2 |
| `mcp` | `$.tool.list()` grouped by `mcp__<server>__*` into connected servers with tool counts; the plane adds the servers the project's `.claude.json` disables (`projects[<cwd>].disabledMcpServers`, the one key it reads of that file) as `disabled`; never `$.mcp.call` (H-mcp) | M2 |
| `settings` | `$.settings.read()` cut to what §11 allows: permissions by source, and hooks as event, matcher and count | M2 |
| `files {query?}` | the plane itself, `git ls-files` in the session's working directory, no bridge involved: the tree's file names, which `diff` already exposes | M5 |

**The catalogs are pushed, not fetched.** Nothing a panel shows when it opens should wait
on a fetch if it can be pushed and cached, and the typeahead must open with no round
trip. The command list and the model list belong to one session — plugins and mods add
and replace entries, and aliases resolve through that session's environment — so they
are **live catalogs**, cached by session plus a fingerprint and invalidated by push; only
the built-in routing rules are fixed per engine version (the brief's caching amendment).
The bridge emits a DX5 `catalog` event at `session.start` and whenever its content
changes: it re-lists `$.command.list()` **at every heartbeat** (5 s) and after any
command row (door `command`, whoever typed it) naming `reload-plugins`, `reload-skills`
or `mcp`, and emits only when the fingerprint changed. The list is cheap (1 ms for 92
entries in the probe's one sample, run1 bus 0004) and the start-time list is incomplete
by construction: plugin markdown commands and skills load with their plugin, a mod's
`register()` adds entries when it runs, and an MCP server's prompts exist only once it
connects, often after `session.start` (from the API; when each kind appears was not
measured). A trigger on `$.tool.list()`'s server set, considered first, would miss a
server that offers prompts but no tools, a mod registering late, and a skill change. The
catalog is the commands (`$.command.list()` joined with the route each gets, names
verbatim), the models (`$.config.list()`'s `model` row's options, and which family
aliases this session's `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` maps), and the fingerprint. The
child keeps the latest and puts it in its snapshot; the plane carries it in the DX4
snapshot as `catalog` and relays each change as a DX4 `catalog` message on main subs.
The web caches it per `(session, fingerprint)` in memory and in `localStorage` (the last
32 sessions), so a re-opened session's typeahead draws from the cache before its
snapshot lands, labelled *as of <time>* until the snapshot confirms the fingerprint; a
cache from another session is never used.

### 6. Readback: the row the hook sees, linked by name and arguments

Only `type: "local"` commands return `{text}` (`reload-skills`, `output-style`, `clear`,
a mod's command); the one-line built-ins the desk cares about resolve `{}` whether they
succeeded or failed (`/model bogus` → `{}`), and the printed line exists only as a
transcript row (H-noout). S7 measured where that row is and how it can be linked:

- **The row is written 5–22 ms after the promise settles**, as a `user` row for some
  commands (`/effort`, `/mcp …`, `/goal <c>`, the command row of `/reload-*`) and as a
  `system` row of subtype `local_command` for others (`/color`, `/rename`,
  `/output-style`, `/goal clear`, the output row of `/reload-*`). **`$.session.messages()`
  never shows the `system` rows**; the bridge's `session.append` hook sees both kinds
  (door `command`), and sees the rows of a command the bridge itself ran (S7.2: the
  probe's hook saw its own run's rows; what the hook never sees is a plugin's own
  `$.session.append`). So the readback reads the hook, never `messages()` and never the
  disk.
- **The hook gives `{message, door, origin, uuid}`: no `parentUuid`, no run id.** A
  `user` command row of the desk's run carries `origin {kind: "plugin", name: "sminos"}`;
  a `system` one carries `{kind: "engine"}` whoever ran it. The one link stronger than
  timing is the command row's own text: `<command-name>/color</command-name> …
  <command-args>green</command-args>`.
- **Desk commands run one at a time.** The bridge issues the next `$.command.run` only
  after the previous run's readback settled or timed out (2 s after its settle, to
  `none`); the engine queues them anyway, so this costs no latency, and it makes the
  attribution of two desk commands exact.
- **Which runs the rule applies to: built-in `run` rows alone.** A `run-prompt`
  command's outcome is the turn it starts, and its command row need not carry the
  listed name (the MCP prompt listed as `probe:probe-prompt (MCP)` wrote
  `/mcp__probe__probe-prompt`, S5); a command another plugin serves settles `{text}`
  and leaves `<command-args>` empty in its row (S5), so it reads back by `text`. The
  name-and-args link is never applied to either.
- **The rule.** For a built-in `run` row, after the op's promise settles, take the
  first command row of the main loop whose name and args match the run; then the output
  row that follows it within 100 ms. A command row that is not this run's between the two — a terminal-typed
  command — makes it *ran, unconfirmed*; so does a second matching command row within
  the window (the person typed the same command with the same arguments during the turn
  the desk's run waited on, whose rows the engine writes at the turn's end, the same
  millisecond the queued run settles, S7.2). Never a neighbour's line (the brief's
  amended decision 4).

A `run`'s DX5 `end` event carries, beside the settled value, the **readback**:

```
readback: {how: "text" | "row" | "effect" | "none", text?, uuid?}
```

`text`: the settled value carried the line (a `local` command). `row`: the output row
linked by the rule, its text and uuid. `effect`: the one command whose row cannot reach
the stream, `reload-plugins`, confirmed by the daemon when the bridge answers again
(§2). `none`: *ran, unconfirmed*, shown as such. The desk already draws these rows as
MAWS's `local_command` rows (the transcript is MAWS's `Transcript`); the composer's
status line shows the readback for a command run from the desk, since the desk has no
chips for most settings. Where a command's effect is also drawable (`mcp
enable|disable` → the MCP panel's list, re-read after the op; `cd` → the Info tab's
directory), that panel is the second confirmation; the readback itself stays the row.

### 7. Requests: scopes, "allow and switch", plan approval, and the mode

S1 measured what an allow from a hook can carry: `addRules`, `addDirectories` and
`setMode` with destination `session` take effect at once and write no file; `addRules`
with `localSettings` writes the project's `.claude/settings.local.json`; an ExitPlanMode
allow is dropped unless it carries `updatedInput` (the request's own input, `{}` works),
which the bridge sends for questions and not yet for anything else — so today's Allow on
a plan from the desk does nothing. That fix is being built outside this spec as sminos
1.6.3 (`bridge-plan-allow`: `engineDecision` sends the request's input as
`updatedInput` for every non-question), and M3 treats it as landed.

**"Allow for this session", and "always allow" (B2).** The engine's `PermissionRequest`
hook input carries `permission_suggestions` (the SDK's `PermissionUpdate` list; measured:
`addDirectories [<cwd>] session` and `setMode acceptEdits session` on a Bash in default
mode, `addRules allow [{Bash, <command>}] localSettings` on another, none on a question
or a plan). The bridge drops them today (`raisedFields` in `bridge-stream.tsx`). This
run: `raised` gains `suggestions` (the list verbatim, bounded: Interfaces). A scoped
allow is DX6 `decide {decision: "allow", scope: {suggestion, sha256, destination}}`:
`suggestion` the index into the raised list, `sha256` the SHA-256 of that suggestion's
canonical JSON as the browser drew it, `destination` the one the person chose. The
daemon re-reads the pending request from the bridge (as `check_digest` does), takes the
suggestion at the index, refuses `not-pending` with *the suggestions changed* when its
hash differs, and applies the one transformation MAWS's scope radio applies
(`request-card/scope.ts`): the destination may be replaced by `session`, or kept when
it is the suggestion's own `localSettings`; every other destination is refused
`bad-shape` (§11). The decision the bridge hands the engine is `{behavior: "allow",
updatedInput, updatedPermissions: [that suggestion with that destination]}`. The web
ports the scope radio cut to those two scopes: *Allow for this session* (the first
`addRules` suggestion with destination `session`; when the engine suggested no rule,
no session scope is offered — the desk never constructs a rule) and *Always allow … in
<project>* (a `localSettings` suggestion as offered), labelled as writing the file. The
code the RPC carries covers the scope; the digest binds the request.

**"Allow and switch to <mode>" (C5, on a live request).** Where the suggestions carry a
`setMode`, the card offers it as a third allow, the same `scope` shape with that
suggestion's index; the daemon checks the mode against the machine's ceiling
(`admit_spawn`'s rule, factored out). This is the one place a mode can change from the
desk besides a plan's approval and `/plan`: in auto mode, and in plan mode on 2.1.307,
harmless calls raise no request at all (S1), so a mode "armed for the next answer" could
wait forever, and the inventory's row C5 is narrowed to what a live request carries.

**Plan approval (B4).** An ExitPlanMode request is drawn as MAWS's plan card
(`variants/Plan.tsx`): the plan as markdown from the request's input. *Implement in
<mode>* is `decide {decision: "allow", mode}` → the bridge's `{behavior: "allow",
updatedInput: <the input>, updatedPermissions: [{type: "setMode", mode, destination:
"session"}]}` (S1: the chosen mode beats the mode the session was in before plan;
`acceptEdits`, `default` and `auto` measured; `mode` is allowed only when the pending
request's tool is `ExitPlanMode` and within the ceiling); *Keep planning* is a deny
with the feedback as `message`; *Clear and implement* is M4's following plus a Send
(A29), offered once M4 exists.

**The mode (reading it).** Three sources, in order of trust, each stamped with when it
was read:

1. **The bridge's own decisions, published at once.** The bridge knows every mode it
   sets itself — an allow it handed out carrying `setMode` (a scoped allow, a plan's
   approval), and `/plan` when it ran one — so it publishes the new mode the moment the
   decision is handed to the engine, without waiting for a hook.
2. **Five classic hooks' input, measured (spike 12, 2.1.307).** `permission_mode` is
   carried by `classic.UserPromptSubmit`, `classic.PermissionRequest`,
   `classic.PostToolUse`, `classic.PostToolBatch` and `classic.Stop`, read as the hook
   fires (a Shift+Tab mid-turn showed in the same turn's next `PostToolUse`). It is
   **not** carried by `classic.PreToolUse` (a mod's `e` there is the `ToolCallEnvelope`,
   not the classic input: 34 of 34 had none) nor by `classic.MessageDisplay`. The bridge
   registers `PermissionRequest` today; in auto mode requests are rare, so a reading fed
   by it alone goes stale for long stretches. M3 adds pass-through hooks on the other
   four — `UserPromptSubmit` on every prompt, `PostToolUse` on every tool result,
   `PostToolBatch`, `Stop` — each reading `permission_mode` and calling `next(e)` with
   nothing else (no `$` call, so it holds the turn for nothing). A reading from a hook
   never overrides a decision of the bridge's own that is newer.
3. **Not the rows.** The transcript's `permission-mode` rows appear at flush points and
   skip changes: an allow's `setMode` wrote none; `auto` first showed at the next
   prompt, `acceptEdits` never got a row (S1). They are not read.

**The gap, labelled.** A Shift+Tab at the terminal fires no hook at all
(`ConfigChange` stays silent), and the mod API has no mode read to poll (spike 12), so
a change made at an idle terminal is invisible until the next prompt or tool result
fires one of the five. The bridge emits DX5 `mode {mode, at}`
when its reading changes, the child keeps it, `GET /status` carries it and the plane
forwards it in `presence.mode` (§4); the web draws MAWS's `ModeChip` stamped *as of
<time>* from `at`, and *unknown* before any reading. The menu (`ModeMenu`, with
`MODE_REFUSAL_WORDS`'s pattern): *plan* runs `/plan` (measured: `Enabled plan mode`);
every other switch is named *Shift+Tab in the terminal; or allow a request into it*, and
*M6* on a `--bg` seat. `/config permissionMode=X` is never used: it sets only the default
for new sessions.

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
     to, reason, confirmed: true}` under the machine's writer, ends the old sub with
     `end {reason: "continued", to, confirmed: true}`, and the new id is a member as any
     new session is (the member mark carries, `sminos.py`'s `member_mark`). The hub
     adds the `end` reason; the web moves, redraws the old channel's end marker as
     *continued as <alias>*, and keeps the old channel's history and its RPC outcomes.
   - *Across processes* (`/background`): the TUI exits and the mod loads fresh in the
     supervisor's worker with no old state, and no job record names the old id (S10:
     the supervisor's `list`, the job's `state.json` and `sessions/<pid>.json` all carry
     the new id alone). So the lineage is built in three steps, each weaker than the
     last: (i) before running `/background`, the bridge emits a DX5 `continuing
     {command: "background", cwd, t}`, which the requests reader turns into the daemon
     expecting a continuation of that session from that directory; (ii) the daemon
     reads the old transcript's `continued-in` record (`{type: "continued-in",
     sessionId, continuedInSessionId}`, appended as the TUI exits; written
     best-effort, cli 2.1.307:239409-239430) and links `confirmed: true`; (iii) with the
     record missing, it links the one `--bg` job with `source: "slash"` whose `cwd` is the
     expected directory and whose `startedAt` is within 60 s of the notice, `confirmed:
     false`, and the web shows *continued as <alias> (unconfirmed)*; with none or
     several, no link, and the old channel ends as an ended session does. The new
     record is `kind: "bg"`, so the session's kind changes from terminal to seat.
3. **`/background` has a dialog of its own, and a cost the desk names.** It asks
   *Background this session?* in the terminal when a task would be abandoned or a
   workflow agent runs (cli 2.1.307:239626); a background shell carries over with no
   dialog, a running subagent raises it, and it holds the queue; *Stay* resolves `{}`,
   the same as success (S10). A web confirm does not answer it. The engine's own
   condition counts abandonable tasks and running workflow agents (`abandonable.count
   === 0 && workflowAgents.running === 0`, cli 2.1.307:239626), not tool calls. So the
   bridge offers `background` (the route's condition) only while `$.agent.list()` names
   no running agent and **no workflow it saw launched is still running**. `$.agent.list()`
   leaves workflow agents out, and a `Workflow` tool call settles at once — the tool
   returns a task id and the workflow runs on (cli 2.1.307:793338: "this tool returns
   immediately with a task ID, and a `<task-notification>` arrives when the workflow
   completes") — so a settled call proves nothing. The bridge takes the task id from the
   `Workflow` tool's result (its `tool.call` hook sees every call and result) and holds
   it as running until the `<task-notification>` row naming that task id reaches its
   `session.append` hook with a terminal status (`completed`, `failed`, `killed`). A
   module loaded mid-session still misses a workflow launched before it: the dialog then
   opens in the terminal, and the web, seeing no job within 60 s, says *the terminal is
   asking: answer it there*. Otherwise the command is terminal-only with *terminal only
   while an agent or a workflow runs: the engine would ask about it*. **The confirm names what the move keeps and loses** (HN, measured on
   2.1.307): the running background shells, listed by id from the Jobs tab's ledger,
   carried with the same pid but their exit codes lost (each completes as *exit code
   -1*); the running monitors, listed by id, lost (never fire again); an MCP call in
   flight, lost silently; the turn in flight, re-run from its prompt; session crons,
   kept. Success is judged from the effect — the job appears, the TUI exits — never
   from `{}`. A28 is the acceptance case. The same loss table binds any later takeover
   of a busy terminal session (#52's lane B, outside this spec): it goes terminal →
   `/background` first, and headless only after the job drains, since a plain terminal
   exit kills every shell and monitor (HN).

Until M4, the four commands are refused with *changes the session id; following comes
with M4*.

### 9. Agents, forks, side questions

- **Stop one subagent (G11).** `TaskStop` takes an agent's id or the Agent call's `name`,
  not its description (S2); the bridge refuses agent ids in `stop` on purpose
  (`stopTask`, bridge.tsx) and the daemon's `stop` checks the jobs index only, so this
  is a separate op and RPC, `stop-agent {agentId}`, validated against `$.agent.list()`
  (status `running`; the id or the `name`) in the bridge and the plane's subagent tree
  in the daemon. **The note row matters:** a stopped background agent wakes the parent
  with a notice that credits the stop to Claude, and a stopped foreground agent reads to
  the parent as an interruption of its tool call, which the parent then re-spawned at
  once (S2). So the bridge leaves the parent a note row as `stopNote` does for a job:
  *Agent <id or name> was stopped by the person from the desk: it is not running. Do
  not start it again or redo its task unless the person asks.* On 2.1.307's defaults
  every model-spawned agent runs in the background (`CLAUDE_CODE_FORK_SUBAGENT=0` makes
  one foreground); both are covered.
- **Message one subagent (G12).** `tell {agentId, text}` → `$.session.send({to:
  {agentId}, text})`, the SendMessage tool's own delivery; the agent reads it at its
  next step, framed as a peer's.
- **Fork (E4).** The daemon runs `claude --bg --resume <id> --fork-session` in the
  session's working directory (or a worktree, as spawn does), going around sminos's "a
  flag starts a copy" guard since here the copy is the goal; the copy joins as a seat
  with the spawn's ceiling, named afresh by the engine, and its `joined` event carries
  `fork_of: <id>`. The original is byte-identical and keeps running (S8). `/fork
  <prompt>` through the command op also works with no panel (S4) and is kept `routed` to
  the RPC: the RPC carries the brief, the worktree and the model as spawn does.
- **Side question (E6).** `btw {prompt}` → `$.model.fork({prompt})`: one tool-less
  completion over the session's own transcript as the main thread last sent it, served
  from the prefix cache (about a second idle, S3), nothing written into the
  conversation, not refused after an Esc. Async (a completion can outlast 10 s):
  `{started, id}` at once, then `op` start and end with `text` (at most 64 KiB) and
  `usage` or `reason` (`nothing-to-fork` before the first response or after `/clear`,
  `api-error`, `empty-reply`, `aborted`). **The prompt is framed** so the model does not
  continue its open task or reach for a tool (S3: unframed mid-turn it does, and answers
  about the task or returns `empty-reply`): the bridge prefixes the person's question
  with *Answer the following without using any tools and without continuing your
  current task; one reply, then stop.* The fork sees the main thread's last request, so
  what happened after it (a command, a steer) is not in view; the pane says so under
  the answer. `/btw` itself is an overlay and is never run.

### 10. Composer parity

- **Attachments (A6).** A mod's prompt gets no attachment from `@path`, `asUser` or not
  (S9; the types say so, dts 9359), and `$.session.append` takes text only. What works
  is a Read: the daemon saves the upload inside the session's working directory, where
  a Read asks no permission, and the message tells the model to read it. RPC `attach
  {session, name, type, bytes}` (base64, bounded by the RPC's 1 MiB canonical JSON —
  about 700 KB of bytes; the web downscales a photo to fit and refuses a larger file
  with the bound; `name` a basename, `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`, else
  `bad-shape`) is written by the daemon to `<cwd>/.claude/desk-uploads/<nonce>-<name>`
  (mode 0600; `.claude/desk-uploads/` added to the repository's `.git/info/exclude` on
  first write so it never shows in `git status`; swept with the session's bridge state),
  answering `{path}` relative to the working directory; the web then sends the message
  with a line appended: *The owner attached <name>, saved at <path>. Read it with the
  Read tool.* A session whose working directory is not a git repository gets the file
  under `<cwd>/.claude/desk-uploads/` all the same, with no exclude.
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
status and tool counts — never a server's configuration; of `.claude.json` the plane
reads the one key `disabledMcpServers` and relays nothing else. The `status` read's
repository remote is stripped of any userinfo (a token in an `https://user:token@…`
URL). The `files` read is the working tree's file names, which `diff` already exposes.
The strongest alternative, sealing reads with a code (an RPC-shaped read), lost: it
would put a nonce ledger and the freshness rule on a display path, and still relay the
data through the hub in the clear; authentication codes on session depth stay deferred
(desk spec, Deferred).

**Every effect stays X class.** `command`, `btw`, `stop-agent`, `tell`, `fork`, `attach`
and the widened `decide` are refused `read-only` before execution (after the code, the
name, the machine, project and session, the ledger and the age, in DX6's order), and
the daemon never trusts a class the web asserts: the bridge's route table decides what a
`command` runs. `fork` runs under the spawn's ceiling (`admit_spawn`); a `setMode` on a
decision is checked against the same ceiling; `cd` is limited to the project's known
checkouts as spawn is, checked in the daemon.

**A scoped allow is bound to what was shown.** The web sends an index and the hash of the
suggestion it drew; the daemon resolves the rule from the bridge's current list, never
from the web, and refuses when the list changed (§7). Two destinations are allowed:
`session` (nothing saved) and `localSettings` (`.claude/settings.local.json` of that
checkout, labelled, and only when the engine itself suggested it); `userSettings`,
`projectSettings` and `cliArg` are refused `bad-shape` whatever the suggestion offers —
a project's committed settings and the user's global ones are the terminal's to change,
pending fork F1. The commands that save a default are `drop` (§2) pending the same fork;
`mcp enable|disable` is offered, labelled, because the terminal's `/mcp` does exactly
that and it is what the owner needs when a server misbehaves.

**Channels that stay closed** (the brief): no text through a channel where it could act
as a keystroke (a supervisor `reply` aimed at a dialog becomes a prompt, H-reply; the
desk never sends one, not even to clear an Esc); no `$.command.run` from a held hook
frame (the bridge runs every op from its command loop, outside any hook); no `$.mcp.call`
as a data path (H-mcp).

**An upload lands where a Read asks nothing** (§10): inside the session's working
directory, under the engine's own `.claude/`, with a basename the daemon checks,
excluded from git — never outside it, where a Read would raise a prompt the desk then
answers for itself.

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
| `op.ran` | a command RPC sent → its `op end` | `B.ran` (a sample taken while the session was busy is kept apart, labelled: it waited for the turn) |
| `op.readback` | a command RPC sent → its readback drawn | `B.readback` |
| `btw.answer` | a side question sent → its text drawn | `B.btw` |
| `panel.<name>` | the tap → the panel drawn with content (context, usage, model, mcp, settings, status) | `B.panel` |
| `decide.scoped` | a scoped allow tapped → its `settled` in | `B.decide` (today's `request.*` paths are the diagnosis) |
| `mode.drawn` | a mode change at the engine → the chip redrawn (cross-clock) | `B.mode` |
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
capabilities the presences advertise. So:

1. **MAWS first**, hub and web together (they deploy together: `apps/desk-hub/deploy`).
   The new hub lists every kind, frame and name this document adds and says so in its
   `welcome` (`kinds`, written where the Machine object writes the welcome,
   `apps/desk-hub/src/objects/machine.ts`); the new web offers nothing until a session's
   presence says the bridge can.
2. **Then doperpowers**, the sminos bump installed on the macbook first (the owner's
   working machine), the mini last. Each milestone's acceptance is walked with the mini
   still behind: that is the older-plugin case. A session open through the update keeps
   its old mod until a reload: that is the stale-session case (§4), walked too.
3. **Daemon-first is safe but inert.** A new daemon's `presence.capabilities`,
   `presence.mode` and the snapshot's `catalog` field pass an old hub (an extra field; a
   snapshot's body is relayed unread) and an old web ignores them; the machine
   presence's `desk` is dropped by an old hub, which rebuilds that body. A new *kind*
   (`read`, `catalog`, `op`) an old hub would refuse `bad-shape` into the audit record,
   so the daemon sends a kind only when the stream's `welcome` lists it; a `welcome`
   without `kinds` is the old hub, to which none is sent (an old web asks for none, and
   a CLI-started op's outcome is simply not relayed). An old web never sends a new
   frame.
4. **Per milestone**, each MAWS PR merges and deploys before its doperpowers PR rolls out;
   a milestone's capability names are the gate the web reads, so a partial rollout
   never breaks.

### 14. Departures from the inventory

Listed in one place so the research session can re-check the hazards each leaned on.
Where a spike contradicted the inventory, the spikes file's "What contradicts the
inventory" is the record and this document follows it; the departures that are this
document's own:

1. **`capabilities` and `mode` are siblings of `bridge` in presence, not under it** (§4):
   the hub refuses a non-boolean `bridge`. **The daemon's own capabilities ride in the
   machine presence** (`desk`), since `fork`, `attach` and `files` need no bridge; and
   the capability carries the bridge's own plugin version, so a stale session is told
   apart from an older machine.
2. **The catalogs are pushed in the snapshot and as a `catalog` kind; `read catalog` is
   the refresh** (§5): the inventory had `commands` and `models` as reads only. Cached
   per session and fingerprint (the brief's amendment), never shared across sessions;
   re-listed at every heartbeat, since the start-time list is incomplete (the research
   session's Q1).
3. **One DX4 kind `op` carries every async outcome** (§3); DX5 keeps per-op events, named
   `run` for a command (the child already emits a `command` event of its own for every
   relayed op, DX5 Events).
4. **Readback reads the hook and links by the command row's name and arguments, for
   built-in `run` rows alone, with desk commands run one at a time** (§6, S7); the
   inventory's §3.2 took the hook's view of these rows as read (C), and the probe's
   "read it in `$.session.messages()`" does not hold for `system` rows; a `run-prompt`'s
   outcome is its turn and a mod's command reads back by `text` (the MCP prompt's row
   carries another name, a mod's row empty args, S5). **`/reload-plugins` is confirmed
   by the daemon, by effect**, since it reloads the bridge (§2).
5. **The `settings` read is cut** to permissions and hooks' shape; hook commands and
   `env` never leave the bridge; `mcp` carries no configuration; `status` strips a
   remote's userinfo (§11).
6. **The mode is the bridge's own decision when it set it, else the classic hooks'
   `permission_mode`, forwarded in presence stamped with its time**; the rows are not
   read (§7, S1: an allow's `setMode` writes no `permission-mode` row; the rows trail
   and skip). A Shift+Tab at the terminal is the labelled gap.
7. **No armed mode** (§7, S1): a mode changes only on a live request or by `/plan`.
8. **A scoped allow carries an index, a hash and a destination**, and the daemon applies
   MAWS's one transformation (§7): the inventory's "`suggestion: <index>`" alone could
   not say *this session* for a `localSettings` suggestion, nor refuse a changed list.
9. **`/background` is offered only while no agent runs and no workflow the bridge saw
   launched is still running — tracked by the task id the `Workflow` tool returns at
   once, until its `<task-notification>`, since the call itself settles immediately**
   (§8, S10, cli 2.1.307:793338; a shell carries over), **its confirm names what is lost**
   (HN),
   and its lineage has three sources in order (the bridge's `continuing` notice, the
   `continued-in` record, the job's directory and time), the last `unconfirmed`.
10. **Two kinds of following; issued RPCs stay put** (§8, the brief's amendment).
11. **The `command` op's dispatch contract is in M0** with five measured rows, the
    `mcp` forms among them so M2 needs M0 alone (the brief offered the choice); M1
    fills the table and opens non-built-ins.
12. **`stop-agent` is its own op and RPC**, not a widened `stop` (§9), with a note that
    tells the parent not to redo the task (S2).
13. **The commands that save a default are `drop` pending fork F1** (§2): the inventory
    classed `autocompact`, `output-style` and `config k=v` as `run`. `recap` is `drop`
    (S4); `goal <c>` is `run-prompt` (S4).
14. **Attachments are saved inside the working directory and read by the model** (§10,
    S9): the inventory's `@<path>` route does not exist for a mod's prompt.
15. **`FIRST_WAIT_S` is 8 s** (the CLI's wait); the 5 s is the child's
    `SMINOS_BRIDGE_READY_WAIT` (Surprises).
16. **The sminos tests live under `sminos/tests/`**, not `tests/sminos/` (Surprises).

### 15. The owner's calls: open forks, each with a recommendation

None of M0–M5 waits on these; each is the edge a milestone stops at until answered.
**Ruled by the owner, 2026-10-22** (Decision Log, entry 4): F1 and F5 as recommended;
F6 yes, narrowed by spike 14 (the `exit` row); F2 and F3 not in this run (F2 settled
by the owner's choice between two answers, entry 6); F4 and F7 the recommendations. The text below keeps
each fork as it was put.

- **F1 — Controls whose effect outlives the session.** `/model` and `/effort` save a
  default for new sessions; `/autocompact`, `/output-style`, `/config k=v` write
  `settings.json`; `/mcp disable` writes the project's `.claude.json`; a suggestion's
  `localSettings`, `projectSettings` and `userSettings` write settings files; `/add-dir`
  *remember* likewise. **Recommendation:** offer in this run only what the terminal's own
  session controls do and label it — `mcp enable|disable` (`.claude.json`, per project)
  and a suggestion's `localSettings` as the engine offers it — and keep the defaults
  (`config`, `autocompact`, `output-style`, the model and effort defaults,
  `projectSettings`, `userSettings`) terminal-only, named as such; a later, separate
  *Settings* panel with its own review could add them. The alternative, a labelled
  *save as default* beside Model, is sound if the owner changes models from the phone
  often enough to want it.
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
  `localSettings`. **Recommendation:** both, `localSettings` labelled and only as the
  engine itself suggests it (S1 measured the write: one rule into the project's
  `.claude/settings.local.json`); it is what "don't ask again" means to the owner, and
  it stays in the checkout's untracked local file.
- **F6 — `/exit` from the desk.** Ends the process; for a terminal session that closes
  the owner's terminal session, and a plain exit kills every running background shell
  and monitor (HN). **Recommendation:** offer behind a confirm naming the machine, that
  it closes the terminal session, and the running shells and monitors it will kill (by
  id, from the Jobs tab); Retire already does this for seats.
- **F7 — Fork's placement.** A fork is a spawn: the brief's M4 puts it with agents and
  following. **Recommendation:** as the brief has it; nothing turns on it.

## Plan of Work

**Binding every milestone.**

- Two repositories, one spec. Each milestone has a machine half (doperpowers, under
  `sminos/`) and a hub-and-web half (MAWS, `apps/desk-hub`, `apps/desk-web`); the
  interface between them is fixed in Interfaces and Dependencies, so the two halves can
  be built by two executors at once, each proving its half against the stand-in the
  other repository already keeps: MAWS's fake machine (`apps/desk-hub/fake-machine/`,
  `RpcScript` in `machine.ts` for scripted RPC answers, `SessionDepth` in `session.ts`
  for the plane's producer rules) stands for the machine; doperpowers' hub stand-in
  (`sminos/tests/hub_standin.py`) and the fake mod of `test-bridge-control.sh` stand for
  the hub and the engine. The route table and the catalog shape are one fixture both
  test against (`sminos/tests/routes-2.1.307.json`, vendored to
  `apps/desk-hub/fake-machine/dx4/` as `dx4-jobs.json` is). Each milestone's acceptance
  on the owner's Macs (its A-items) runs after both halves are merged and rolled out in
  §13's order.
- Rollout order §13; mixed versions are the normal state, and every new field is
  additive and optional on the wire.
- doperpowers: every change bumps sminos in the same commit (`scripts/bump-version.sh
  --plugin sminos <version>`, one minor per milestone; M3's floor is 1.6.3), the tests
  `sminos/tests/run-sminos-tests.sh` and `sminos/tests/mods/run.sh`, and
  `tests/mods/typecheck.sh`; DX5 changes land in this document's Interfaces (the desk
  spec's DX5 copy points here from a dated line, added in M0's MAWS PR).
- MAWS: `scripts/ci-gate.sh <worktree> --gates static,unit` on every commit that is
  reviewed, `e2e:desk-web` for a milestone with a web half, `e2e:desk-web-hub` where the
  hub's relay changed; the protocol's types in `apps/desk-hub/src/protocol/` are the
  one place a shape is written; the fake machine produces everything the plane does.
- The hazards bind as measured facts: no bare panel form is run; `/model`, `/effort`,
  `/context`, `/add-dir`, `/recap` are never run; `$.mcp.call` is never used; nothing is
  sent through a supervisor `reply`; nothing is read from `$.session.messages()` for a
  readback; the bridge never awaits its own reload.
- Copy: a refusal names the thing that cannot be done and why, in the reasons' voice
  `capabilities.ts` already uses (*<name> is idle: Send starts a turn*); a control that
  needs a newer plugin names the version and the machine, or the session's stale mod.
- Latency: every new control's path in `PATHS` with its label, sampled whether or not
  the readout is on; a budget from §12.
- Every spike has landed (S1–S10); no row waits on one. A row the spikes did not reach
  stays `enabled: false` in the table (§2) until measured.

### M0 — Foundation: capabilities, the `read` relay, the op outcome, the `command` dispatch

**What exists at its end.** A bridged session and its machine advertise what they can
do; the web offers a control only when they say it can, and names the version, the
machine or the stale session otherwise. One read (`status`) travels browser → hub →
daemon → child → bridge and back on the sub, and the Info tab shows it. The `command`
op runs five measured built-ins (`rename <name>`, `color <c>`, `reload-plugins`,
`reload-skills`, `mcp enable|disable|reconnect <server>`) from a `/` typed in the
composer, answering at once, reporting on the stream, read back by the row rule, by
text or (for `reload-plugins`) by the daemon's effect check, the outcome owed across a
daemon restart; everything else typed as a slash is refused with its class's reason by
the bridge. A read-only machine refuses the RPC. Nothing here waits on an owner's
answer.

**Machine half (doperpowers).**

- `sminos/hooks/mods/bridge-commands.tsx` (new; as built, the rule, with the table's data
  in `bridge-routes.tsx`, generated from the fixture by `routes_check.py --write` and
  checked against it: Decision Log, entry 7): the route table for 2.1.307 from the
  fixture (Interfaces, "The route table"), loaded as data; at M0 the `run` class is
  **enabled** for the five names above, every other `run` and every `run-prompt` row
  carrying `enabled: false` with *comes with M1* — the table is whole from M0 so that
  the catalog (M1) and the refusals (M0) read one source. `routeOf(engineBase, listed,
  name, args)` → the route, or a refusal `{code, reason}` (`unknown-builtin`, `panel`,
  `routed`, `follow`, `drop`, `local`, `bad-args`, `disabled`, `self`); `listed` is the
  `$.command.list()` entry, so a non-built-in's class comes from its `source`.
- `bridge.tsx`: ops `read` and `command` in `commandAnswer`. `read {what, args}` answers
  `{ok, result}` for `status` and `{ok: false, error: "no read <what>"}` otherwise.
  `command {name, args, from, rpc}`: the route check, then the run queued behind any
  desk run still awaiting its readback (§6: one at a time), then `$.command.run
  ({command: name, args})` **not awaited past the call** — answer `{ok: true, result:
  {queued: true, route, id: command.id}}` at once (the engine queues mid-turn, H-queue);
  the settled promise emits DX5 `run {phase: "end", id, name, args, settled,
  readback}`, with `run {phase: "start", id, name, args}` emitted as the call is made;
  the Esc rejection answers `{ok: false, error, code: "stopped"}`; an engine rejection
  after the call is the `end`'s `settled.error`. The readback (§6) in `bridge-rows.tsx`:
  from the settle, the first main-loop command row (door `command`) whose
  `<command-name>` and `<command-args>` match, then the output row within 100 ms, both
  from the `session.append` hook the bridge already has; a foreign command row between,
  or a second matching one within the window, makes it `none`. A `reload-plugins` run
  emits its `start` and nothing more from this module (§2).
- `GET /status` `capabilities` (Interfaces, DX5): assembled by the bridge at its hello
  and after each module load, posted to the child as part of `resync` (`capabilities`
  field) so the child answers it from its state; `engine` from `$.session.version()`,
  `sminos` from the plugin's own manifest.
- `sminos_bridge.py`: keeps `capabilities` from the resync and answers it in `status()`;
  the command response and the kept RPC answer carry `code` beside `result` and `error`
  (today both copy `result` and `error` alone); `rpc_of` is kept past a `queued` or
  `started` answer until the op's `end` (§3), and every relayed `run` event whose `id`
  it holds carries `rpc`.
- `sminos_plane.py`: `Bridges.probe` keeps the status body's `capabilities` (and `mode`,
  M3) and the socket's inode it answered from; `presence_of` adds them when held; the
  machine presence gains `desk: {sminos, rpcs, reads}` (the version from
  `sminos/.claude-plugin/plugin.json` beside the scripts; `rpcs` the daemon's
  `RPC_NAMES`; `reads` empty until M5). The `read` frame: `Plane.read(frame)` finds the
  sub, passes a malformed frame by (as `output` does), and runs `post_command(path,
  {op: "read", what, args}, wait_ms=COMMAND_WAIT_MS)` on a worker thread (as `diff` runs
  git: a thread per read, bounded to 4 in flight per sub, the rest answered `error
  {code: "busy"}`), queuing the answer for the pump, which emits DX4 `read {id, what,
  result | error}` on the sub.
- `sminos_requests.py` and `sminos_rpc.py`: `WANTED` gains `run` (and `btw`,
  `continuing` later); the `op` outcome path of §3 (`op_id` and `op` on the claim,
  `op_events()`, `restore_ops()`, owed through `sminos_owed` as compactions are); for a
  claim whose `op` is `reload-plugins`, the daemon emits `op end {readback: {how:
  "effect"}}` when the plane's probe sees the session's bridge answer from a new inode
  within 60 s of the claim, else `op end {settled: {ok: false, error}}` at 60 s.
  `RPC_NAMES` gains `command`; `shape()` checks `name` (1–128 characters, no control
  characters: a name exactly as `$.command.list()` spells it, ` (MCP)` suffix included)
  and `args` (a string of at most 4,096 characters, optional); `plan()` runs
  `command(path, {op: "command", name, args, rpc: nonce, from: "desk"})` when bridged,
  else `unsupported`; the bridge's `{ok: false, code, error}` is `failed` with the
  bridge's reason as the message and its code as the message's first word.
  `sminos_uplink.py`: the `read` frame handler, and `welcome.kinds` read and kept
  (§13.3): the plane sends a kind this run adds (`read`, `op`; M1's `catalog`) only
  when the stream's `welcome` lists it.
- `sminos_control.py`: `sminos command <member> <name> [args]` and `sminos read <member>
  <what>` as CLI verbs, so the live walk can drive the ops without the hub.
- Tests: `sminos/tests/mods/bridge.test.ts` (the route check's every class from the
  fixture; `command` answering at once and emitting `run` start and end; one at a
  time; readback by text and by row, the foreign-row and two-row cases as `none`; the
  `stopped` code; `reload-plugins` emitting start alone); `test-bridge-control.sh` (the
  child relaying `read` and `command`; `code` in the response and the kept answer;
  `rpc_of` kept to the `end` and the `rpc` annotation; `capabilities` in `status`);
  `test_session_plane.py` (presence with `capabilities`, the machine presence's `desk`,
  the `read` relay and its errors, the inode kept); `test_rpcs.py` (`command`'s shape,
  read-only, unsupported without a bridge; `op` from a `run` event with its nonce, the
  immediate answer then a delayed end, a restart between them, an outcome with no sub
  open, and `reload-plugins` finished by a new inode and by the 60 s timeout).

**Hub and web half (MAWS).**

- `apps/desk-hub/src/protocol/`: `SessionPresence.capabilities?` and `.mode?`;
  `MachinePresence.desk?`; `ProjectUp` gains `read`; DX2's machine frames gain `read`;
  `SUBSCRIPTION_KINDS` gains `read` and `catalog`; `SESSION_WIDE_KINDS` gains `op`;
  `RpcArgs.command`, `RpcResults.command`, `RPC_NAMES`; DX2 `welcome.kinds`. `project.ts`:
  the `read` up-frame (shape check: `sub` owned, `id` a name of at most 64 characters,
  `what` `[a-z-]{1,32}`, `args` absent or an object of at most 4 KiB; carried to the
  machine with the route), `op` relayed unread like `compact`, the machine presence's
  `desk` admitted and kept. `machine.ts`: `kinds` in the `welcome`.
- `apps/desk-hub/fake-machine/`: presence with capabilities and a machine presence with
  `desk` (a `Producer` level `'m0'`), `read status` answered on the sub, a `command` RPC
  answered `queued` and followed by scripted `op` messages with a readback (`RpcScript`
  plus a `commands` script keyed by name, reading the vendored route fixture), the
  older-producer case (no capabilities) and the stale-session case (a machine with
  `desk`, a session without `capabilities`) kept.
- `apps/desk-web/src/conversation/capabilities.ts`: `VERBS` gains `command` and `status`
  (`status` a read's capability, drawn by the Info tab, not a verb button);
  `capabilities()` reads both presences (§4), with the three fallbacks and their
  reasons. `shell/session-plane.ts`: `Subscription.read(what, args) → Promise<JsonValue>`,
  correlating by `id`, rejecting with the answer's `error`, timing out at 15 s (the
  machine's own 10 s plus the hops). `project/conversation.ts`: `ops` beside
  `compactions`, fed by `op` messages. `views/composer/Composer.tsx`: a text beginning
  `/<name>` is a command when `can.command.can` — the RPC `command {session, name,
  args}` — and otherwise refused in place with the capability's reason and *Send as text
  anyway*; a new `CommandStatus` beside `RpcStatus` draws queued → ran → the readback
  (`words.ts` gains `command`'s result and the op's phases). `depth/view/SessionInfo.tsx`:
  the engine's version, base, root, repository, surfaces from `read status`, or *not
  available from this plugin (needs sminos ≥ <M0's>)*. `latency.ts`: `read.status`,
  `op.queued`, `op.ran`, `op.readback`, each with its label; the app-start paths
  (`app.cold`, `app.warm`, `app.reconnect`, `app.me`, `app.chunk`, `app.state`,
  `app.key`) are the `desk-latency-baseline` branch's (Decision Log, entry 4).
  `docs/doperpowers/specs/2026-10-15-desk-design.md`: a dated line under DX4, DX5 and
  DX6 pointing here.
- Tests: hub unit (`session-plane.test.ts`: `read` carried and `op` relayed; the shape
  refusals; `desk` kept), fake-machine tests, web unit (`capabilities.test.ts` for the
  derivation from both presences and the three fallbacks; the composer's slash
  handling; `CommandStatus`'s three states), e2e (`depth-info.spec.ts` for the status
  read; a new `command.spec.ts` for A2–A5 against the fake machine, the older-producer
  and stale-session cases included).

**Interfaces.** Exposes: DX5 `capabilities`, ops `read` and `command`, events `run`;
DX4 `presence.capabilities`, `machine.desk`, kinds `read` and `op`; DX3/DX2 `read`; DX6
`command`; DX2 `welcome.kinds`; the route fixture; the web's `Subscription.read`, `ops`,
`capabilities()`. Consumes nothing new.

**Decisions of this milestone.** The five enabled rows are measured `run` rows whose
readback the row rule, `{text}` or the reload's effect check confirms. `rename`'s match
tolerates the name mod's own `/rename` (`name.tsx`) running between: the match is on
*this* name. The Info tab asks `read status` once per subscription open and on
*Refresh*, not on every presence. A `read` on an agent sub is refused by the web before
sending (`status` is the main transcript's). The MCP panel that draws `mcp`'s effect is
M2's; at M0 the `mcp` forms confirm by their row.

**Does not touch.** The typeahead and the catalog (M1); any read but `status`; any
built-in beyond the five; `compact`'s instructions (M2); the request card (M3).

**Proves.** A1–A9, and A33 for its paths.

### M1 — The command spine: the table whole, the typeahead

**What exists at its end.** Every command of the session is in a typeahead that opens
with no round trip; the enabled `run` rows are the table's measured `run` class, the
`run-prompt` rows and every non-built-in run, and the Esc refusal says what it is.

**What the spikes settled for this milestone.** S4: `goal <condition>` is `run-prompt`
and `goal clear` is `run` (it cannot stop a running goal: the typeahead's hint names
Interrupt); `recap` is `drop`; `fast on|off` stays `enabled: false` (not settled: the
gateway disables it). S5: every non-built-in is `run-prompt`, named verbatim, and a
mod's own command returns `{text}`; the bridge refuses its own plugin's commands `self`.
S6: the Esc refusal's copy is *stopped at the terminal: commands resume after input is
typed there*, with no cure offered; the desk's Interrupt is checked not to set it (A13).
S7: the readback rule of §6, as M0 built it. Spike 13: `list-agents` is `run`, bare,
`{text}` in 24 ms, no panel — its item says it lists this machine's other Claude
sessions too, outside this project (X class like every command, the readback `text`).

**Machine half.** `bridge-commands.tsx`: every measured `run` and `run-prompt` row
enabled; the catalog (§5): `catalogNow($)` joins `$.command.list()` with the route each
entry gets, reads `$.config.list()`'s `model` row's options and resolves each family
alias through the session's environment, fingerprints the two, and emits DX5 `catalog`
at `session.start`, at every heartbeat, and after any command row naming
`reload-plugins`, `reload-skills` or `mcp`, when the fingerprint changed (§5). `sminos_bridge.py`: keeps the latest `catalog` and puts it in the
snapshot. `sminos_plane.py`: the DX4 snapshot gains `catalog` from the child's; a
`catalog` event is relayed as DX4 `catalog` on main subs when the hub lists it; `read
catalog` answers the same body. `sminos_rpc.py`: `cd <path>` is checked against the
project's known checkouts (`sminos_policy.known_checkouts`, as spawn is checked) before
it is forwarded, refused `unknown-checkout`: the bridge cannot know the project's
checkouts.

**Hub and web half.** Hub: `snapshot.catalog?` and the `catalog` kind, relayed unread.
Web: the typeahead ported from MAWS — `composer/mentions/SlashPalette.tsx`, `popup.tsx`,
`rank.ts`, `items.ts`'s `SlashItem` with `origin` from `source`/`plugin` and `action`
from the route (`text` for `run` and `run-prompt`, `widget` for `routed` and
`panel`-with-`to`, `unavailable` with the reason otherwise; the typeahead offers the
argument form of a row whose bare form is a panel: `mcp` shows `enable|disable|
reconnect <server>`), MAWS's tiers and recents as they are — into `SessionComposer`; the
catalog store (`state/catalog.ts`, per session and fingerprint, `localStorage` for the
last 32 sessions, the *as of* label); `CommandStatus` draws *ran, unconfirmed*, *started
a turn* for a `run-prompt`, and the Esc copy. `latency.ts`: `palette.open`,
`catalog.ready`, `read.catalog`. Fake machine: a recorded catalog in the snapshot and a
`catalog` change on command.

**Decisions.** The typeahead's items for a session with no catalog (an older bridge)
come from the cache if one exists, else the desk's own panel items alone with the
version line (A14); the web holds no copy of the route table. A `run-prompt` command's
outcome is the turn it starts: the status line says *started a turn* at the `op end`
and nothing more. A `run` row with `outlives` draws its label under the item and again
in the status line. The composer's typed form (M0's) and the typeahead share one path:
the typeahead inserts text, Send routes it.

**Does not touch.** Panels (M2); the request card (M3); `follow` rows (M4); the `!`
mode.

**Proves.** A10–A14, A33 for its paths.

### M2 — Native panels from reads

**What exists at its end.** Side question, context and usage, the model and effort
selector, MCP status and actions, compact with instructions, status, permissions and
hooks — each a web panel drawn from pushed or read data, none a terminal panel. Built
and reviewed panel by panel over the one read contract; it needs M0 alone (the `mcp`
forms are M0's).

**What the spikes settled.** S3: `$.model.fork` answers in 0.75–1.0 s idle, cache-warm,
writes nothing, is not refused after an Esc, and mid-turn must be told not to continue
the task (§9's framing); an Esc on the main turn does not abort a fork made outside a
hook. `B.btw`'s samples are split by idle and busy.

**Machine half.** `bridge.tsx`: op `btw` (§9, with the framing prefix and the 64 KiB
bound); reads `usage`, `mcp`, `settings` (§5, cut per §11). `bridge.tsx` `compact`:
already takes `instructions`; `sminos_rpc.py` `shape()` gains a `compact` branch
(`instructions` optional text, at most 4,096 characters) and `plan()` passes it;
`RPC_NAMES` gains `btw` (`prompt` text at most 8,192 characters); `WANTED` gains `btw`,
and `btw` events become `op` as `run`'s do. `sminos_plane.py`: the `mcp` read's
`disabled` list from `.claude.json` (the session's working directory's project entry,
the one key).

**Hub and web half.** Hub: `RpcArgs.compact.instructions?`, `RpcArgs.btw`,
`RpcResults.btw`. Web, each ported from MAWS's renderer and cut to the desk's data: the
side pane (`side/BtwWidget.tsx`, `side/store.ts`, `SideTool.tsx`) drawing `op end`'s
text and usage, open while the turn runs, with *answers from the session's last model
request* under it; `widgets/ContextWidget.tsx` and `composer/frame/ContextRing.tsx` from
`read usage` (summary on open, *Count exactly* for full); `widgets/UsageWidget.tsx`
(rate limits are empty without a subscription: say so); `widgets/ModelSelector.tsx`'s
model and effort views from the catalog's models, applying through today's `model` RPC
with the session-only note (A17); `widgets/McpWidget.tsx`'s list from `read mcp` with
*Reconnect*, *Disable*, *Enable* issuing M0's `command` (`mcp <verb> <server>`), the
`outlives` label on the actions, the list re-read after each `op end`, and *in the
terminal: /mcp* for OAuth and a failed server; `widgets/CompactWidget.tsx` with
instructions; `widgets/StatusWidget.tsx` widening the Info tab; `widgets/PermissionsWidget.tsx`
and `HooksWidget.tsx` read-only from `read settings`. The typed `/btw`, `/context`,
`/usage`, `/model`, `/effort`, `/compact`, `/permissions`, `/hooks`, `/status` open
their panel from the typeahead (`widget` action; before M1, from the composer's typed
form). `latency.ts`: `btw.answer`, `read.usage`, `read.mcp`, `read.settings`, `panel.*`.

**Decisions.** A panel opens from what it has (the catalog, the last usage) and reads
on open for what it does not; a read's error draws in the panel with *Retry*. The MCP
panel's *unknown* is a server named by the loop's rows (`mcp` in the `subagents` body)
that `$.tool.list()` does not name and the disabled list does not hold. `read settings`
is asked when the Permissions or Hooks panel opens, never pushed.

**Does not touch.** The request card's scopes (M3); `/mcp`'s bare panel; plugin
management (`/plugin`, a daemon CLI path, out of this run).

**Proves.** A15–A20, A33 for its paths.

### M3 — Requests and modes

**What exists at its end.** A permission card offers the engine's suggestions with a
scope, and "allow and switch" where the engine suggests a mode; a plan is approved into a
chosen mode and the terminal's dialog closes; the mode chip shows the session's mode
from the bridge and reaches what the mod API reaches.

**What the spikes settled.** S1, all of §7: `session` updates apply at once and write no
file; `localSettings` writes the project's local file; a plan allow needs `updatedInput`
(sminos 1.6.3 sends it; this milestone's floor); the chosen mode beats the pre-plan
mode; no armed mode. What S1 left unrun is not offered: `addRules` with `userSettings`
or `projectSettings`, `removeRules`, `removeDirectories`.

**Machine half.** `bridge-stream.tsx` `raisedFields` gains `suggestions` (bounded:
Interfaces); `bridge-requests.tsx` `engineDecision` passes `updatedPermissions` from a
decision's resolved suggestion or `mode`, beside the `updatedInput` 1.6.3 added;
`sminos_bridge.py` `_check_decision` admits `updatedPermissions` (an array of at most 8
objects) on a permission and refuses it on a question. The mode (§7): `bridge.tsx`
publishes the mode from its own decisions at once (an allow it hands out carrying
`setMode`; a `/plan` it ran), reads `permission_mode` from `classic.PermissionRequest`,
and adds pass-through `classic.UserPromptSubmit`, `classic.PostToolUse`,
`classic.PostToolBatch` and `classic.Stop` hooks that read it and call `next(e)` with
no `$` call (the five hooks spike 12 measured to carry it; never `PreToolUse`, whose
`e` carries none), never lets a hook's reading override a newer decision of its own,
and emits DX5 `mode {mode, at}` on change; the child keeps it and answers it in
`status()`.
`sminos_requests.py` `raised_draft` passes `suggestions`; `sminos_rpc.py` `shape()` and
`check_digest`: `scope.suggestion` an integer within the re-read list, `scope.sha256`
equal to that suggestion's canonical hash (else `not-pending`, *the suggestions
changed*), `scope.destination` in `{session, localSettings}` with `localSettings` only
when it is the suggestion's own, `mode` only when the pending request's tool is
`ExitPlanMode` and within the ceiling (`admit_spawn`'s rule, factored out); a
`setMode` suggestion's mode likewise within the ceiling. `sminos_plane.py`: `presence.mode`
from the probe's status body.

**Hub and web half.** Hub: `Raised.suggestions?` (the code covers it; `raisedShapeError`
admits an array of at most 8 objects each at most 2 KiB), `RpcArgs.decide.scope?`,
`.mode?`, `SessionPresence.mode?`. Web: `request-card/scope.ts` and
`variants/Permission.tsx`'s scope radio cut to the two scopes plus *Allow and switch to
<mode>*; `variants/Plan.tsx`; `composer/frame/ModeChip.tsx` and `statusline/ModeMenu.tsx`
with `MODE_REFUSAL_WORDS`'s pattern for the unreachable modes; the mode from
`presence.mode`, with the rows as the fallback. `latency.ts`: `decide.scoped`,
`mode.drawn`.

**Decisions.** A suggestion is shown as the engine words it (the rule's `toolName` and
`ruleContent`), under the scope radio; the hash the web sends is over the suggestion as
drawn, so a list that changed under the card is refused and the card redraws from the
new `raised`. A plan card's modes are the machine's ceiling and below;
`bypassPermissions` is never offered. The chip's *as of its last prompt* appears only on
the rows fallback (a bridge older than M3).

**Does not touch.** Shift+Tab's arbitrary switching (M6 or terminal); `add-dir`'s dialog
(it always confirms: H-panel; only the suggestion path, F5's shape); *Clear and
implement* (M4).

**Proves.** A21–A24, A33 for its paths.

### M4 — Agents, fork, following

**What exists at its end.** One subagent can be stopped or messaged; a conversation can
be forked into a new seat; `/clear`, `/branch`, `/resume <id>` and `/background` are
followed, `/background` with its loss named; a plan can be cleared into a fresh session
and implemented. Executed as **three increments, each reviewed at its boundary** before
the next starts: (a) agents (`stop-agent`, `tell`), (b) fork, (c) following and *Clear
and implement*. Following alone combines in-process migration, cross-process lineage
and the preservation of old RPC outcomes.

**What the spikes and the handoff note settled.** S2: `TaskStop` takes an id or a `name`,
both kinds of agent; the note row must tell the parent not to redo the task. S8:
`--fork-session` on a live session is clean. S10: `/background`'s dialog opens for a
running subagent, not for a shell; no job record names the old id; the `continued-in`
record is best-effort. HN: what `/background` carries and loses (§8.3's confirm). Spike
13: `subtask <task>` is `run` (`{}` in 0.32 s, no panel): it starts a background fork
agent (`$.agent.list()` type `fork`, with a name), its row reads `⑂ forked <name>
(<last 4 of id>)`, and its finish is a `<task-notification>` that starts a main turn.

**Machine half.** (a) `bridge.tsx`: ops `stop-agent` and `tell` (§9) with the note's
text; `bridge-agents.tsx`: the workflows it saw launched, each held as running from the
task id in the `Workflow` tool's result until the `<task-notification>` row naming it
reaches `session.append` with `completed`, `failed` or `killed`, for (c)'s `background`
condition (§8.3). (b) also enables the `subtask <task>` row beside `fork`: its readback
is the `⑂ forked …` row by the name-and-args rule, the fork agent appears in the
subagent tree from `$.agent.list()` as any agent does, and its finish notification is
one more task notification the jobs ledger already reads. `sminos_rpc.py`:
`stop-agent` (the agent in the plane's tree, `unknown-agent` otherwise), `tell`;
`RPC_NAMES`. (b) `sminos_rpc.py`: `fork` (the spawn path with `--resume <id>
--fork-session`, around the copy guard, `fork_of` on the `joined` event). (c)
`bridge.tsx`: `session` start gains `previous` (the mod remembers the ended id and reason
across the id change it already handles, and the heartbeat's fallback for a change with
no `session.end` names `reason: "unknown"`); the `follow` rows enabled, `background`
with §8.3's condition and the DX5 `continuing` notice before the run.
`sminos_requests.py`: `WANTED` gains `continuing`; `sminos_plane.py`: the `continued` log
event and `end {continued, to, confirmed}` (§8.2), the `/background` lineage's three
sources in order.

**Hub and web half.** Hub: the RPC names and shapes; `end`'s `continued` reason with
`to` and `confirmed`; the `continued` log kind is any kind to the hub (it checks the
code, not the kind). Web: (a) `tools/agents/subagents/DrillIn.tsx`'s `StopAgent` with its
confirm and `RelayComposer.tsx` in the subagent drill-in; (b) a subset of
`sessions/ForkSheet.tsx` (no rewind-to-message), *forked from <alias>* from `joined`'s
`fork_of`; (c) following in `shell/sessions.ts` and `ProjectView.tsx` (the selection
moves, subscriptions re-target, RPCs stay); the end marker's *continued as* with
*(unconfirmed)*; the `continued` event in the log projection; `/background`'s confirm
built from the Jobs tab's ledger (the running shells and monitors by id, the loss
table of §8.3); the plan card's *Clear and implement*: the `command clear`, the follow,
then a Send of the plan's text to the new session, each step waiting for the one before
(A29). `latency.ts`: `agent.stop`, `agent.tell`, `fork.joined`, `follow.moved`.

**Decisions.** A `tell` to an agent the tree does not hold is refused `unknown-agent` (a
new DX6 code). `fork`'s result names the new session and alias as `spawn`'s does; the
new seat's brief is the fork's `brief` if given, else none (the conversation is the
brief). Following keeps the old session's channel selectable from the sidebar under its
last title with *continued*. *Clear and implement* is offered only when the session's
capabilities list `command` and the follow class is enabled; its Send is the owner's
`human` event as any Send is.

**Does not touch.** `/resume`'s bare picker; `E5`'s value is covered by Resume; a
workflow agent's own stop (`$.agent.list()` does not list them); a takeover into lane
B (#52).

**Proves.** A25–A29, A33 for its paths.

### M5 — Composer parity

**What exists at its end.** Attachments, `@` file mentions, prompt history and drafts.

**What the spikes settled.** S9: no `@path` attachment for a mod's prompt; a Read of a
file inside the working directory asks nothing and works (§10).

**Machine half.** `sminos_rpc.py`: `attach` (§10: the bound, the basename check, the
directory under `<cwd>/.claude/desk-uploads/`, the exclude, the sweep with the bridge's
`<id>.json`); `sminos_plane.py`: the `files` read (`git ls-files -z`, cached per working
directory for 10 s, at most 20,000 entries then `truncated: true`, answered in parts
above the frame limit as snapshots are); the machine presence's `desk.reads` gains
`files`, `desk.rpcs` `attach`. Fork F3's `shell` is not built.

**Hub and web half.** Hub: `RpcArgs.attach`, `RpcResults.attach`. Web: the editor and
its controller (`composer/editor/Editor.tsx`, `controller.ts`, the long-paste atoms of
`extensions.ts`), `frame/AttachmentStrip.tsx` and `editor/paste.ts` with `pathForFile`
replaced by the `attach` RPC's path and the appended line (§10); `mentions/AtMenu.tsx`
from `read files`; `editor/history.ts` and `drafts.ts` on IndexedDB. `latency.ts`:
`attach.sent`, `read.files`.

**Does not touch.** `!` shell (F3); the queue's edit and withdraw (A4: no mod noun lists
the engine's queue).

**Proves.** A30–A32, A33 for its paths.

### M6 — The attach key driver for `--bg` seats (stub)

Out of this run: the owner chose *not in this run* for F2 (Decision Log, entry 6).
Kept as the shape a later run would take: a daemon key driver that attaches to a `--bg`
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

**MAWS, every milestone.** `scripts/ci-gate.sh` pushes the tree to a `ci/` ref and runs
the gates on GitHub Actions. Run this watcher, and doperpowers' `ci-gate`, bare:
waiting for remote gates is not local heavy work. On the owner's Macs,
`/tmp/maws-review/with-slot.sh` is for local installs, builds and test runs only
(Decision 16); holding a slot while CI waits can starve the focused regression
that would fix the tested head.

```
scripts/ci-gate.sh <worktree> --gates static,unit
scripts/ci-gate.sh <worktree> --gates e2e:desk-web                     # a web half (a Linux lane)
scripts/ci-gate.sh <worktree> --gates e2e:desk-web-hub --runner macos  # the relay changed (not in LINUX_E2E)
pnpm --filter desk-hub test ; pnpm --filter desk-web test               # while iterating
pnpm --filter desk-hub fake-machine -- --help                           # the stand-in's CLI
```
Expected: `ci-gate: run <id> success` then `GREEN <run-url>`; a red gate prints
`FAIL <gate> log=<path>`.

**The live walk, each milestone, on both Macs** (after MAWS is deployed and the sminos
bump installed on the macbook, the mini behind, one session on the macbook left open
through the update):

```
sminos list --here                                        # the sessions and their names
sminos watch <member> --json | grep -E '"type": "(run|catalog|btw|mode|session|continuing)"'
sminos command <member> rename desk-m0                    # M0's CLI verb: the same op the desk issues
sminos read <member> status
sminos daemon policy --read-only on                       # A7, then --read-only off
sminos daemon restart                                     # A8, between a command's queued and its ran
```
Then the desk with `?latency`, the A-items of the milestone in order, and
`window.deskLatency()` copied into the milestone's report under the spec's directory;
the table on #52 updated with the desk's numbers beside RC's.

**M0's first proof**, before any web: `sminos command <member> rename desk-m0` prints
`queued (run) id=<id>`, and `sminos watch` shows `{"type":"run","phase":"end",…,
"readback":{"how":"row","text":"Session renamed to: desk-m0","uuid":"…"}}` within 5 s;
`sminos read <member> status` prints the version, base, root and surfaces; `sminos
command <member> reload-plugins` prints `queued`, and the daemon's log shows the op
finished by effect within 10 s.

## Interfaces and Dependencies

Each interface names the repository that owns it. Fields marked `?` are optional on the
wire and absent from an older producer; a consumer treats absence as "the older side".

### DX5 (doperpowers: `sminos/hooks/mods/`, `sminos/skills/sminos/scripts/sminos_bridge.py`)

**`GET /status`** gains:

```json
"capabilities": {
  "sminos": "1.7.0",
  "protocol": 2,
  "engine": "2.1.307",
  "ops": ["ping","steer","interrupt","stop","model","compact","deliver","answer","read","command"],
  "reads": ["status"],
  "routes": {"measured": "2.1.307"}
},
"mode": {"mode": "default", "at": 1760000000000}
```
`sminos` is the loaded mod's own plugin version. `ops` and `reads` grow by milestone (M1
adds read `catalog`; M2 op `btw`, reads `usage`, `mcp`, `settings`; M4 ops
`stop-agent`, `tell`; M5 nothing of the bridge's). `mode` (M3) is the bridge's current
reading — its own decision's mode, else the latest classic hook input's — with `at`,
when it was read (epoch ms, the machine's clock); absent before M3 or before any
reading. The bridge posts both to the child in `resync` (`capabilities`, `mode`); the
child answers `status()` with the latest.

**Ops** (the child's stdout lines; the mod's `result` events). The child's HTTP answer
to `POST /command?wait=` and the answer it keeps under an RPC nonce carry `code` beside
`result` and `error` when the mod's result has one.

| op | args | result |
| --- | --- | --- |
| `read` | `{what, args?}` | `{ok: true, result}` per kind below; `{ok: false, error}` for a kind it does not serve (`no read <what>`) or a failed call |
| `command` | `{name, args?, from?, rpc?}` | at once: `{ok: true, result: {queued: true, route: <class>, id}}`; refused: `{ok: false, error, code}` with `code` one of `unknown-builtin`, `panel`, `routed`, `follow`, `drop`, `local`, `bad-args`, `disabled`, `self`, `stopped`, `turn-unknown` |
| `btw` (M2) | `{prompt, rpc?}` | `{ok: true, result: {started: true, id}}`; `{ok: false, error}` (empty prompt; `nothing-to-fork` known at once) |
| `stop-agent` (M4) | `{agentId, from?}` | `{ok: true, result: {agentId}}`; `{ok: false, error}` (not a running agent by id or name; TaskStop's error) |
| `tell` (M4) | `{agentId, text}` | `{ok: true, result: {sent: true}}`; `{ok: false, error}` |

The child keeps `rpc_of[id]` for an op answered `queued` or `started` until the `run` or
`btw` event with `phase: "end"` and that `id`, and annotates each such event with `rpc`.
The bridge runs desk `command` ops one at a time (§6).

Read results:

```ts
status:   {version: {version, base?, builtAt?}, model, cwd, root, repo: {remote?, branch?} | null,   // remote without userinfo
           surfaces: string[], override: {model, effort} | null, mode?: {mode: string, at: number}}
catalog:  Catalog                                                   // below
usage:    SessionUsage & {context: {breakdown?: ContextBreakdown}}  // the engine's shape, `$.session.usage(args)`
mcp:      {servers: [{name, status: "connected" | "disabled" | "unknown", tools: number}]}
          // the bridge answers connected servers with counts; the plane adds `disabled` from `.claude.json`
settings: {permissions: {allow: Rule[], ask: Rule[], deny: Rule[], additionalDirectories: string[], defaultMode: string | null,
                         bySource: {[source: "user" | "project" | "local" | "policy" | "cliArg"]: {allow: Rule[], ask: Rule[], deny: Rule[]}}},
           hooks: {[event: string]: [{matcher: string | null, commands: number}]}}       // never a command's text, never `env`
Rule   =  {toolName: string, ruleContent?: string}                 // the engine's PermissionRuleValue
files:    {root: string, entries: string[], truncated: boolean}    // M5; the plane's own; paths relative to root
```
A read error on the sub (DX4 below) is one of `no-bridge`, `unsupported`, `timeout`,
`busy`, `failed`, with a message.

**Events** (the mod's posts):

| type / phase | fields |
| --- | --- |
| `run` / `start` | `id, name, args, t`, and for a `reload-plugins` run `child: [inode, pid]`, the child the run left from, added by that child (Decision Log, entry 9) — the lifecycle of a `command` op (the child's own `command {id, op}` event, DX5 Events, is every relayed op's ingress and is unchanged) |
| `run` / `end` | `id, name, args, settled: {ok: true, text?, context?} \| {ok: false, error}, readback: {how: "text" \| "row" \| "effect" \| "none", text?, uuid?}, t`; `rpc?` added by the child; a replaced `reload-plugins` module cannot emit it (the daemon finishes by effect); an unchanged module kept loaded emits the returned text (Decision 11) |
| `btw` / `start`, `end` (M2) | `id`; on end `text` (≤ 64 KiB), `usage: {input, output, cacheRead?, cacheWrite?}` or `reason`; `rpc?` added by the child |
| `catalog` (M1) | `Catalog`: `{fingerprint, skills?: string[], commands: [{name, description, source, plugin?, route: Route, withArgs?: Route}], models: {options: string[], aliases: {[family]: string \| null}}, measured: "2.1.307"}` |
| `mode` (M3) | `{mode, at}` — the bridge's current reading when it changes: its own decision's mode at once, else the latest classic hook input's `permission_mode`; `at` epoch ms on the machine's clock, when it was read |
| `continuing` (M4) | `{command: "background", cwd, t}` — emitted just before a `follow` run that leaves the process |
| `session` / `start` (M4) | gains `previous?: {session, reason: "clear" \| "resume" \| "branch" \| "unknown"}` |
| `raised` (M3) | gains `suggestions?: PermissionUpdate[]` (at most 8; each rule string at most 512 characters; the list is the engine's `permission_suggestions` verbatim within those bounds, or absent) |

The child's snapshot line gains `capabilities`, `mode` and `catalog` (the latest of each).
A catalog command's `route` is its bare form; for non-empty trimmed arguments the
consumer selects `withArgs ?? route`, then applies that form's validation and
`otherwise`. These are advertised routes, not a second route table in the web.

From sminos 1.8.1, `Catalog.skills?: string[]` carries the names in
`$.session.usage({breakdown: "summary"}).context.breakdown?.skills?.skillFrontmatter`,
verbatim and fully qualified for plugin skills. A current producer sends `[]` when
none are listed or the optional summary is unavailable/shapeless; commands, models
and aliases still publish when that enrichment fails; an older producer omits the field. Names participate in the catalog
fingerprint. This is the engine's model-context listing, not a complete filesystem
skill inventory: a `disable-model-invocation: true` skill is absent and keeps the
previous provenance grouping. No context text or token counts cross the wire.

**`POST /requests/<request>/decision`** (M3) admits `updatedPermissions?:
PermissionUpdate[]` (at most 8) on a permission; refuses it on a question (400). The
decision the bridge hands the engine for a permission is `{behavior: "allow",
updatedInput: <the request's input>, updatedPermissions?}` (the `updatedInput` from
sminos 1.6.3).

### The route table (owner: doperpowers `sminos/tests/routes-2.1.307.json`, loaded by `bridge-commands.tsx`; vendored to MAWS `apps/desk-hub/fake-machine/dx4/`)

```ts
Route = {class: Class, to?: string, reason?: string, forms?: Forms, outlives?: string, confirm?: true, enabled: boolean, measured: "M" | "I", otherwise?: Route}
Class = "run" | "run-prompt" | "routed" | "follow" | "panel" | "local" | "drop"
Forms = {args: "none" | "required" | "optional", pattern?: string /* a JS RegExp source matched whole against the trimmed args */, hint?: string}
Entry = {name: string, bare: Route, withArgs?: Route}   // `withArgs` applies when the trimmed args are non-empty; else `bare`
// `bad-args` is no class: it is derived. With no `withArgs`, `bare` applies to both forms; args that its
// `forms.args` forbids or requires, or that miss its `forms.pattern`, are `bad-args`. `otherwise` is the
// route taken when `forms.pattern` misses (only `goal`: `clear` is `run`, any other text `run-prompt`);
// without it a miss is `bad-args`. `enabled` gates a route's own action: a `panel`, `local`, `drop` or
// `routed` route is `enabled: true` from M0, since its refusal or its routing is in force from M0.
```

A non-built-in (`source` ≠ `builtin`) has no entry: it is `run-prompt` (enabled from M1)
unless it is listed under **plugin exceptions** or its `plugin` is `sminos` (`self`).
The 2.1.307 table (the inventory's §7 as the spikes left it; `enabled` names the
milestone that enables it; `—` means the same as the bare route):

| name | bare | with args (`forms`) | to / outlives / reason / confirm | enabled |
| --- | --- | --- | --- | --- |
| `rename` | `bad-args` (*a name is needed*) | `run`, required | — | M0 |
| `color` | `bad-args` | `run`, required, `^[a-z]+$` | — | M0 |
| `reload-plugins` | `run` (the daemon confirms by effect) | `bad-args` | — | M0 |
| `reload-skills` | `run` | `bad-args` | — | M0 |
| `mcp` | `panel`, to `read mcp` | `run`, required, `^(enable\|disable\|reconnect) \S+$` | outlives *saved for this project on <machine>: `.claude.json`* | M0 |
| `cd` | `bad-args` | `run`, required | the daemon checks the path against the project's known checkouts | M1 |
| `goal` | `panel` (*the bare form opens a panel*) | `clear`: `run` (hint *a queued clear waits behind a running goal: Interrupt stops it*); otherwise `run-prompt` | — | M1 |
| `plan` | `routed`, to the mode control (M3 runs it through the command path) | `run-prompt` | — | M1 (args), M3 (bare) |
| `init`, `security-review`, `insights`, `team-onboarding` | `run-prompt` | `run-prompt` | — | M1 |
| `fast` | `bad-args` | `run`, required, `^(on\|off)$` | *not settled: fast mode was disabled where it was measured* | disabled (I) |
| `list-agents` | `run` (readback `text`; the item says *lists this machine's other Claude sessions too, outside this project*) | `bad-args` | — | M1 (spike 13) |
| `subtask` | `bare: bad-args` | `run`, required (a background fork agent; its finish is a `<task-notification>` that starts a main turn, tracked as a workflow's is) | — | M4 (spike 13) |
| `model`, `effort` | `routed`, to `model` | — | *use Model instead: /model saves a default for new sessions* | — |
| `compact` | `routed`, to `compact` | — | — | — |
| `btw` | `routed`, to `btw` | — | — | — |
| `context`, `usage` | `routed`, to `read usage` (`usage`'s bare form is a panel) | — | — | — |
| `fork` | `routed`, to the `fork` RPC | — | — | — |
| `clear` | `follow` | `bad-args` | — | M4 |
| `branch` | `follow` | `follow`, optional | — | M4 |
| `resume` | `panel` (the picker) | `follow`, required (a session id) | — | M4 (args) |
| `background` | `follow`, confirm, under §8.3's condition | `bad-args` | the confirm names the loss (§8.3) | M4 |
| `exit` | `run`, confirm, only while every running-task class (shell, monitor, agent, workflow, MCP task) and session-created worktree state is positively established clear; unknown state is refused *can't tell whether work is running here: exit there* (Decision 14); known work is refused *the terminal would ask what to do with the running work: exit there* | `bad-args` | F6 and spike 14: the confirm names the machine and that it closes the terminal session, and promises no stop (with work running the engine's own dialog holds the queue until answered at the terminal); the outcome, once a reliable guard exists, is the session's `session.end`, never the settled `{}` | disabled in M1: no complete state proof (Decision 14) |
| `config` | `panel` | `drop` (*saves a default on <machine>; terminal only*, F1) | — | — |
| `autocompact` | `panel` | `drop` (F1) | — | — |
| `output-style` | `panel` | `drop` (F1) | — | — |
| `add-dir` | `panel` (it always confirms) | `panel`, to *a request's suggestion* | — | — |
| `permissions`, `hooks` | `panel`, to `read settings` | — | — | — |
| `skills` | `panel`, to `read catalog` | — | — | — |
| `status` | `panel`, to `read status` | — | — | — |
| `tasks` | `panel`, to *the Jobs tab* | — | — | — |
| `memory`, `sandbox`, `workflows`, `plugin` | `panel` | — | — | — |
| `rewind` | `panel` (the picker), to *M6 on a `--bg` seat* | — | — | — |
| `copy`, `export`, `help` | `local` | `local` | — | — |
| `recap` | `drop` (*it refuses any run a plugin starts*, S4) | — | — | — |
| `agents` | `drop` (*removed by the engine*) | — | — | — |
| `login`, `logout`, `setup-bedrock`, `setup-vertex`, `design-login`, `design-consent`, `design-revoke` | `drop` (*provider setup and sign-in: terminal*) | — | — | — |
| `theme`, `tui`, `ide`, `mobile`, `terminal-setup`, `keybindings`, `statusline`, `stickers`, `focus`, `radio`, `powerup`, `passes`, `pro-trial-expired`, `release-notes`, `feedback`, `bug`, `heapdump` | `drop` (*the terminal's own*) | — | — | — |
| `__remote-workflow`, `workflow-launch-exec` | `drop` (*server-launched only*) | — | — | — |
| **plugin exceptions:** `diff` (plugin `cc-plugin-diff`) | `panel`, to *the Diff tab* | — | — | — |

Any built-in name not in this table: `unknown-builtin`. The fixture carries each row's
`measured` mark (`M` from the probe or the spikes, `I` otherwise) so a later probe moves
rows by data.

### DX4 (owner: MAWS `apps/desk-hub/src/protocol/session.ts`; producers: the plane and the fake machine)

```ts
SessionPresence = { record: JsonObject | null; bridge: boolean; capabilities?: Capabilities; mode?: { mode: string; at: number } };
Capabilities = { sminos: string; protocol: number; engine: string; ops: string[]; reads: string[]; routes: { measured: string } };
MachinePresence = { online; policy; checkouts; desk?: { sminos: string; rpcs: string[]; reads: string[] } };

// subscription kinds (n = 1, 2, …), relayed unread:
read:    { id: string; what: string; result?: JsonValue; error?: { code: 'no-bridge' | 'unsupported' | 'timeout' | 'busy' | 'failed'; message: string } }
catalog: Catalog                                                            // M1; main subs only; also `snapshot.catalog?`
// session-wide (sub and n null), relayed unread:
op:      { rpc: string | null; op: 'command' | 'btw' | 'stop-agent' | 'tell'; phase: 'start' | 'end'; id: string; [field: string]: JsonValue }
// `end` reasons gain:
end:     { reason: ... | 'continued'; to?: string; confirmed?: boolean }      // M4
```
`SUBSCRIPTION_KINDS` lists `read` and `catalog`; `SESSION_WIDE_KINDS` lists `op`. The
hub checks an `op`'s and a `read`'s body only for being an object, as it does `compact`.
The `machine` body's `desk` is admitted as `{sminos: string, rpcs: string[], reads:
string[]}` and kept with the body the hub rebuilds.

### DX3 and DX2 (owner: MAWS `apps/desk-hub/src/protocol/browser.ts`, `machine.ts`)

```ts
// browser → hub
{ t: 'read'; sub: string; id: string; what: string; args?: JsonObject }       // id ≤ 64 chars, what /^[a-z-]{1,32}$/, args ≤ 4 KiB
// hub → machine
{ t: 'read'; project: string; session: string; agentId: string | null; sub: string; id: string; what: string; args?: JsonObject }
// hub → machine, `welcome` gains (written in objects/machine.ts where the welcome is written)
{ t: 'welcome'; ...; kinds?: string[] }                                       // the session kinds this hub lists
```
A `read` on a sub the socket does not own is passed over quietly, as `diff` is; a
malformed one is `bad-shape`.

### DX6 (owner: MAWS `apps/desk-hub/src/protocol/rpc.ts`; executed by `sminos_rpc.py`)

| `rpc` | `args` | result (`done`) | milestone |
| --- | --- | --- | --- |
| `command` | `{session, name, args?}` — `name` 1–128 characters without control characters, exactly as `$.command.list()` spells it; `args` text ≤ 4,096 | `{queued: true, route, id}`; the outcome follows as `op`; a bridge refusal is `failed` with the message `<code>: <reason>` (the bridge's code, a colon, its reason) | M0 |
| `compact` | gains `instructions?` (text ≤ 4,096) | unchanged | M2 |
| `btw` | `{session, prompt}` (≤ 8,192) | `{started: true, id}`; the answer follows as `op` | M2 |
| `decide` | gains `scope?: {suggestion: number, sha256: string, destination: 'session' \| 'localSettings'}` and `mode?: PermissionMode`; at most one of the two, on an allow only | unchanged | M3 |
| `stop-agent` | `{session, agentId}` (`[A-Za-z0-9_-]{1,128}`, an id or a name) | `{agentId}` | M4 |
| `tell` | `{session, agentId, text}` | `{sent: true}` | M4 |
| `fork` | `{session, brief?, worktree?, model?, effort?}` | `{session, alias}` | M4 |
| `attach` | `{session, name, type, bytes}` (base64; the RPC's 1 MiB bound; `name` `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`) | `{path}` (relative to the working directory) | M5 |

New error codes: `unknown-agent` (M4). Every new RPC is X class: `read-only` before
execution; `unsupported` without a bridge (`fork` and `attach` need none: the daemon
runs them). A `decide` with `scope` is refused `not-pending` (*the suggestions changed*)
when the hash does not match the suggestion at the index in the request the bridge
still holds, `bad-shape` for a destination outside the two or a `localSettings` the
suggestion did not offer, `above-ceiling` for a `setMode` above the machine's.

### The log (owner: doperpowers `sminos/skills/sminos/scripts/sminos.py`; read by the web's projection)

`continued {from, to, reason, confirmed}` (M4), written under the machine's writer when a
bridge's first `session` start names `previous` (`confirmed: true`), or when the daemon
links a `/background` from the `continued-in` record (`true`) or from the job's directory
and time alone (`false`); the web's projection draws it as the old channel's end and the
new session's start. `joined` gains `fork_of?: string` (M4).

### The web (owner: MAWS `apps/desk-web/src/`)

```ts
// shell/session-plane.ts
interface Subscription { read(what: string, args?: JsonObject): Promise<JsonValue>; /* rejects with the answer's error; 15 s */ }
// conversation/capabilities.ts
VERBS gains 'command' | 'status' (M0), 'btw' | 'usage' | 'mcp' | 'settings' (M2), 'scope' | 'mode' (M3), 'stop-agent' | 'tell' | 'fork' | 'follow' (M4), 'attach' | 'files' (M5)
// each verb names what it needs: NEEDS: Record<Verb, {op?: string; rpc?: string; read?: string; sminos: string /* the version that added it */}>,
// checked against presence.capabilities.{sminos,ops,reads} and machine.desk.{sminos,rpcs,reads}; a read kind is a capability like a verb;
// the three fallbacks of §4 by (capabilities present?, desk present?, desk.sminos ≥ needed?)
// project/conversation.ts
ops: Record<string /* nonce */, { op: string; phase: 'start' | 'end'; body: JsonObject }>
// state/pending-commands.ts (M1 phone follow-up): browser-owned unseen receipts, localStorage, 24h expiry
PendingCommand = {project: string, machine: string, session: string, nonce: string, name: string, outlives?: string, at: number}
// The hub's op replay supplies the outcome; these nonces select what this browser is waiting on.
// state/catalog.ts (M1)
useCatalog(session): { catalog: Catalog | null; stale: boolean; asOf: number | null }
// A10 grouping with skills present: unqualified built-ins are Engine, listed skills are Skills,
// then names containing a colon are Plugins and the rest Custom (the native MAWS rule).
// An absent skills field (sminos 1.8.0, including its disk cache) keeps the old source/plugin grouping.
```

### Dependencies

- Engine 2.1.307 on both Macs for the measured table; a newer engine uses the table
  with `routes.measured` behind it until a probe re-measures (the research session's).
- sminos 1.6.3 (`bridge-plan-allow`) before M3: the plan allow's `updatedInput`.
- MAWS's renderer units named in each milestone, imported where free of Electron and
  Node, copied and adapted otherwise (the desk spec §2's rule).
- The baseline table on #52 (the `desk-latency-baseline` branch) for every `B.<name>`.
- The spikes file, `~/claude-code-bundle/2.1.300/notes/desk-mod-run-spikes.md`, for the
  measured facts the design rests on (S1–S10); the handoff note, MAWS PR #79
  `research/desk-remote/background-work-handoff.md`, for `/background`'s loss table.

## Surprises & Discoveries

- Observation: The inventory's §3.5 plan to carry capabilities "under the bridge field"
  of presence cannot ship: the hub refuses a presence whose `bridge` is not a boolean,
  and passes extra fields through; the `machine` body it rebuilds from the fields it
  knows, so a daemon-side field there needs the new hub.
  Evidence: `apps/desk-hub/src/objects/project.ts` `presence()`: `typeof body.bridge
  !== 'boolean' … → bad-shape`; `machinePresence()` `putMachinePresence(…, {online,
  policy, checkouts})`.
- Observation: A session keeps the mod it loaded until a reload, so on every rollout the
  machine's version and a live session's bridge version differ for a while; a fallback
  reason keyed on the machine's version alone would send the owner to update a machine
  already updated (the design review, 2026-10-22). The capability carries the bridge's
  own version, and the reason tells a stale session from an older machine.
  Evidence: `bridge.tsx` 46-48 (a module reloads on `/reload-plugins` or restart; the old
  instance is fenced 409).
- Observation: `/reload-plugins` from the desk reloads the bridge itself, so the module
  that ran it never posts its `end`; the daemon confirms it by the bridge answering
  again (the design review; S4's own run that never resolved).
  Evidence: the probe's `Reloaded: 1 plugin` with one plugin loaded; the spikes file's
  contradiction 11; DX5's nonce
  fence.
- Observation: The plane never POSTs the bridge's `/command`; it reads the child only
  through `GET /events` and `GET /status` probes, and throws the status body away. The
  `read` relay is a new path and must block off the uplink's thread as `diff` does.
  Evidence: `sminos_plane.py` `Bridges.probe` keeps `answered` alone; `Plane.diff` runs
  `working_diff` on a thread; `post_command` is `sminos_control.py`'s, called by the
  daemon's RPCs and the CLI verbs only.
- Observation: The child drops an op's nonce at the first `result`, and the daemon
  learns a compaction's outcome from its requests reader, not from the plane: the
  op-outcome pattern needs the child to keep `rpc_of` to the op's end and the reader to
  follow the new events (the buildability review, 2026-10-22).
  Evidence: `sminos_bridge.py` `_apply`: `rpc = self.rpc_of.pop(e.get("id"), None)` on
  `result`; `sminos_requests.py` `WANTED = (b'"raised"', b'"settled"', b'"resync"',
  b'"compact"')`; `sminos_rpc.py` `compact()`, `compacted()`, `restore_compacts()`,
  `compact_id` on the claim.
- Observation: The child's `POST /command` answer and its kept RPC answer copy `result`
  and `error` alone, so a refusal `code` the mod returns never reached the daemon; M0
  widens both.
  Evidence: `sminos_bridge.py` `command()`: `for k in ("result", "error")`; `_apply`'s
  `result` branch: `{k: e[k] for k in ("op", "ok", "result", "error") if k in e}`.
- Observation: The child already emits a `command {id, op}` event for every op it relays,
  so the mod's command lifecycle events are named `run`.
  Evidence: `sminos_bridge.py` `command()`: `self.ingest([{"type": "command", "id": cid,
  "op": body["op"], …}])`; DX5 Events, `command | M1 (the child's own)`.
- Observation: The rows a command the bridge ran writes do reach the bridge's
  `session.append` hook, `system` rows included, 5–22 ms after the promise settles;
  `$.session.messages()` never shows the `system` ones (`/color`, `/rename`,
  `/output-style`, `/goal clear`, the output of `/reload-*`). The inventory's §3.2 had
  the hook's view as C and the probe's `messages()` reading as the fallback; the first is
  now M and the second is wrong.
  Evidence: S7.1's table (`stdout row kept, after settle: +5…+22 ms`; `In
  $.session.messages(): never` for the `system` rows); S7.2's hook stream, which saw the
  probe mod's own `/color green` rows.
- Observation: MAWS's scope radio makes the session scope by copying a suggestion and
  replacing its destination with `session`, so an index alone cannot say which scope
  the person chose; the desk's `decide` carries the index, the suggestion's hash and the
  destination (the buildability and design reviews, 2026-10-22).
  Evidence: `src/renderer/src/request-card/scope.ts` `scopeOptions`: `updatedPermissions:
  [first ? { ...first, destination: 'session' } : …]`.
- Observation: `/background` carries a background shell with its pid but loses its exit
  code, carries a subagent not in a long foreground command, loses monitors and stdio
  MCP tasks (silently), and re-runs the turn in flight; a plain terminal exit kills
  every shell and monitor. Nothing headless adopts a job's carried work.
  Evidence: HN §1–§2, measured on 2.1.307 (runs A–H).
- Observation: A `Workflow` tool call settles the moment the workflow starts, so "no
  `Workflow` call the bridge saw is unfinished" was always true and guarded nothing; the
  engine's own dialog counts running workflow agents, and a workflow's end is the
  `<task-notification>` naming its task id (the research session's re-check,
  2026-10-22).
  Evidence: cli 2.1.307:793338, the tool's description: "this tool returns immediately
  with a task ID, and a `<task-notification>` arrives when the workflow completes";
  cli 2.1.307:239626 `Bo.count === 0 && xo.running === 0` with `xo` the dialog's
  `workflowAgents`. Whether a workflow agent's own calls reach `tool.call` hooks is
  unmeasured, and nothing here depends on it now.
- Observation: An allow's `setMode` writes no `permission-mode` row; the rows appear at
  flush points, `auto` first showing at the next prompt and `acceptEdits` never getting
  one. The transcript is no source for the mode; the bridge's own decisions and five
  classic hooks' `permission_mode` are, and a Shift+Tab at the terminal is the one
  change neither sees until the next of those hooks fires.
  Evidence: S1, "Transcript rows lag"; spike 12 (`desk-mod-run-spikes.md` §12,
  2.1.307): `permission_mode` present on `UserPromptSubmit`, `PermissionRequest`,
  `PostToolUse`, `PostToolBatch` and `Stop`, read as each fires (a mid-turn Shift+Tab
  showed in the same turn's next `PostToolUse`); absent on `PreToolUse` (34 of 34; a
  mod's `e` there is the `ToolCallEnvelope`) and `MessageDisplay`; a Shift+Tab fires no
  hook (`ConfigChange` silent) and the mod API has no mode read. This replaces the
  earlier reading from code (cli ~1084852, the classic base input).
- Observation: `$.command.list()` is cheap enough to re-list every heartbeat — 1 ms for
  92 entries in one sample — and the start-time list is incomplete: MCP prompts exist
  only once their server connects, a mod's entries once its `register()` ran (from the
  API; when each kind appears was not measured).
  Evidence: probe run1 bus 0004 (`t0` 1792633725947, `t1` 1792633725948, 92 entries).
- Observation: The MCP prompt listed as `probe:probe-prompt (MCP)` wrote its command
  row as `/mcp__probe__probe-prompt`, and a command another plugin serves left
  `<command-args>` empty: the name-and-args link holds for built-in `run` rows only.
  Evidence: S5's table (the MCP prompt's row; `probe-reg beta`'s empty args).
- Observation: The desk's own Interrupt does not set the Esc refusal, now measured: a
  mod's `$.turn.abort({turnId})` 2 s into a turn ended it 0.24 s later and
  `$.command.run` and `$.prompt.submit({asUser: true})` ran right after; an Esc keyed
  into the same session's PTY set the refusal and a typed prompt cleared it. What §2
  had from code is a fact.
  Evidence: spike 11 (`desk-mod-run-spikes.md` §11, 2.1.307, isolated).
- Observation: The two built-in rows the table had marked unmeasured open no panel:
  `list-agents` resolves `{text}` with its listing in 24 ms, and the listing names the
  machine's other Claude sessions as well as the subagents; `subtask <task>` resolves
  `{}` in 0.32 s, starts a background fork agent (`$.agent.list()` type `fork`, named),
  writes the row `⑂ forked <name> (<last 4 of id>)`, and finishes with a
  `<task-notification>` that starts a main turn.
  Evidence: spike 13 (`desk-mod-run-spikes.md` §13, 2.1.307, idle session).
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
  hub before the web can send it; the daemon passes a frame it does not handle by;
  `e2e:desk-web-hub` runs on the macOS lane only.
  Evidence: `project.ts:1365` `no RPC ${name}`; `sminos_uplink.py:1302-1305`;
  `.github/workflows/gate.yml` `LINUX_E2E: library artifacts available tools agents
  desk-web`.
- Observation: The spikes contradicted the inventory in ten places, each folded here: the
  Esc refusal has no cure from a mod (S6); `/recap` refuses plugin-origin runs (S4); a
  desk allow on ExitPlanMode did nothing for want of `updatedInput` (S1); an armed mode
  may never find a request in auto or plan mode (S1); `messages()` misses `system` rows
  (S7); no `@path` attachment for a mod's prompt (S9); `/goal <c>` starts a turn and a
  queued clear cannot stop one (S4); every model-spawned agent is background on
  2.1.307's defaults and a foreground stop reads as an interruption the parent redoes
  (S2); a plugin cannot run a command it serves itself (S5); `/background` asks only for
  an agent or a workflow, a shell carries over, and *Stay* resolves like success (S10).
  Evidence: the spikes file, "What contradicts the inventory", 1–11.
- Observation: The inventory's cites otherwise hold at both heads (MAWS `0ee14186a`
  with #116 and #117; doperpowers `646cb02c`, sminos 1.6.2); two moved (`A7`'s
  `sminos_plane.py:2124-2126` is `diffed`, the git work is `working_diff` at 2144 from
  `Plane.diff` at 2548; `capabilities.ts` is 163 lines, the table 44-162), one is weak
  (`E1`'s `sminos.py:2392` says only that the member mark carries across `/clear`), and
  "the depth column is read-only" overstates: the Jobs tab has Stop.
  Evidence: the citation check of 2026-10-22 (a subagent's read of every B/, S/, W/,
  H/ cite; all 63 R/ paths exist).

- Observation: A browser socket that is down when an `op end` is relayed misses it: the
  hub does not replay session-wide messages to a browser that reconnects, so the
  command's status line can stay *queued*. §3's "owed until the hub takes it" covers
  the daemon → hub leg only.
  Evidence: task 2's report, concerns; `apps/desk-hub/src/objects/project.ts` relays
  session-wide kinds unread with no per-browser replay (under review, task 2).
- Observation: A plugin's mod cannot import JSON and `claude plugin test` gives it no
  filesystem, so a data table reaches a mod only as a TS module.
  Evidence: task 1's report, decision 2.

- Observation: M1's `/exit` guard has no single authoritative task/worktree-state
  read in the bundled mod API: the agent list alone omits other task classes, and
  hook tracking after a module reload misses work started earlier. A missing
  observation is not evidence that the class is clear. The transcript and sminos
  worktree record may bridge the reload; TUI child processes are only a cross-check,
  since MCP servers also appear there. Decision 14 requires a refusal for any class
  not positively established clear.
  Evidence: the machine executor's 2.1.308 API inspection and the orchestrator's
  research record check, 2026-10-22; spike 14 proves the dialog condition, not a
  complete mod-readable state noun.
- Observation: RC comparison budgets remain unmeasured. MAWS #52 records the owner's
  deferral of the RC column until a separate claude.ai configuration exists; the
  gateway-configured MacBook cannot start `claude remote-control`. The orchestrator
  initially had no desk samples either; the completed M0 walk now supplies the
  small sample counts recorded in Outcomes, not twenty uses per path. M1 retains
  `B.catalog`/`B.read` and the fixed 50 ms palette budget, and cannot claim
  comparative A33 parity from code or automated tests.
  Evidence: MAWS #52's latency-baseline comment and orchestrator checkpoint,
  2026-10-22.

- Observation: In the completed M0 walk the command DOM reached `ran`, but its
  text replaced *Queued* directly with the readback. M1 now labels the completed
  receipt *Ran* without inventing a timed intermediate phase. A9's two reloads
  confirmed by text because the 1.7.1 module was unchanged; neither proves module
  replacement. The first reload during the 1.8.0 rollout was intended to supply
  that fixture; the rollout observation below records why it did not.
  Older/stale A1/A5 also move to M1's walk because the prior fixtures gained
  `read.status`. These are explicit carryovers, not failed or silently waived tests.
  Evidence: orchestrator's completed M0 walk, 2026-10-22 12:19–12:31Z; Outcomes.
- Observation: Stable engine identity is insufficient to own a catalog: while old
  posts drain, the engine can already have the successor id while the child still
  belongs to the predecessor. M1 now fences refreshes and read responses to their
  requesting bridge session and child generation, including same-session respawn.
  Evidence: the high review's isolated reproduction and three RED-to-GREEN
  lifecycle regressions, doperpowers `70fc4bc6` (305 bridge tests passed).
- Observation: A replay TTL is not a storage-retention bound. Pruning only on
  receipt ingestion or browser join leaves an idle project's SQLite data behind.
  M1 schedules the earliest receipt expiry in the Project alarm and deletes there;
  the regression inspects raw SQLite after the alarm without triggering lazy reads.
  Evidence: MAWS task review and fix `3ecdcb396`, real-hub idle-expiry test.
- Observation: The gate's root-only artifact upload misses desk-web's images under
  `apps/desk-web/test-results`. Passed screenshot-producing tests therefore left no
  downloadable images. CI-opt fixed this on master in MAWS #125 (`ecf2e64b1`);
  the orchestrator explicitly does not move M1's head solely to import it. M1's
  supporting desktop/phone screenshots run locally headless under a slot, with images under
  `/tmp/maws-desk-m1-evidence/`. CI remains functional proof and the deployed live
  walk remains the owner-facing visual acceptance.
  Evidence: run 39774400638's upload log (no files found), reported to the
  orchestrator and CI-opt; no desk-branch `gate.yml` change.

- Observation: A10's live command inventory was right but its grouping was not:
  136 names and descriptions matched, all 83 unavailable commands had reasons,
  and MCP names kept `(MCP)`, yet Skills had zero entries (Engine 98, Plugins 28,
  Custom 10). The engine reports skills with `user`/`plugin` provenance, not a
  distinct skill source. The `skills` enrichment and its bounded model-context
  listing are now specified in Interfaces and the existing fix decision below.
  Evidence: the 20:03–20:22Z walk on `web@master.d399c1ca`, sminos 1.8.0;
  `/tmp/dsk-scripts/m1acc/`, doperpowers #355 and MAWS #127.
- Observation: The retained pre-deploy tab could not reach its project after the
  deploy: its removed `ProjectView-DKS-TIwS.js` returned the SPA HTML fallback.
  Meanwhile the plugin's automatic reload replaced the stale bridge before the
  CLI fallback could exercise A9's effect path. An old tab and an old module are
  separate fixtures, and keeping the first did not preserve the second.
  Evidence: 20:00Z rollout: stale-session refusal at 20:00:06Z, automatic
  `/reload-plugins` at 20:00:12Z, CLI fallback at 20:00:47Z ending `how=text`.
  A9's live effect confirmation remains unproven; MAWS #127 fixes chunk recovery.
- Observation: G1's scroll helper could count a virtual row and lose it before
  scrolling it. The first chunk-recovery candidate failed two remote G1 runs,
  while the pinned baseline passed two; instrumenting the candidate found no
  ProjectView, SessionView or scroller replacement/removal and no preload error.
  Baseline and candidate each passed five local G1 runs. The evidence supported
  a helper race exposed by timing, not the suspected lazy-view remount.
  Evidence: MAWS #127's investigation, `/tmp/dsk-scripts/m1fix/maws-pr.txt`;
  diagnostic run 39858604975 (zero replacements/removals), then two green remote
  browser runs on helper fix `7243dffc4` (39860309618, 39860320211).
- Observation: Hub replay alone did not recover the owner's sleeping phone. On
  unlock the transcript still streamed sentence 426 of 1,000 and caught up slowly;
  reopening reached 1,000 at once. `/color orange`, completed while locked, stayed
  queued, then vanished on reopen. The same walk found that streaming pinned the
  reader to the bottom. These are three different failures: stale stream state,
  browser receipt ownership, and shared transcript follow behavior.
  Evidence: the owner's attended `m1-busy` walk, 20:36–20:49Z; orange ran at
  20:44:55Z. MAWS #128's Chromium/WebKit fixtures pass after the wake/receipt fixes;
  the physical re-walk on #129's deployed build is recorded in Outcomes.
- Observation: The re-walk's seat declined the 2,000-sentence hand-typed fixture:
  it stopped at 92 to ask for a script. A long plain story supplied the streaming
  turn instead; the requested count was not the completed fixture.
  Evidence: the owner's attended `m1-busy` re-walk, 2026-10-24 10:26–10:45Z.
- Observation: A fresh snapshot aggregates the reply so far, but the real plane's
  post-snapshot live backlog can still grow and drain one event at a time. It is
  not enough to dismiss a slow burst as a fake producer's artifact, nor does that
  burst establish a production latency cause.
  Evidence: the phone-fix trace found `BridgeReader.items` unbounded and queued
  events emitted without coalescing or a drain budget (the mod batches up to 500);
  a synthetic 574-chunk post-join burst delayed receipt visibility past five
  seconds. Doperpowers board #128 tracks measuring and bounding this path; the
  wake decision below records the distinction from snapshot recovery.

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
  saved), M4 `high` (forks and following move sessions; three increments, each reviewed),
  M5 `medium`, M6 as its own design says. The last milestone of the run executes the
  acceptance section as written on both Macs.
  Rationale: the stakes, not the size: every milestone widens what the hub's side can
  make a machine do.
  Date/Author: 2026-10-22, the desk orchestrator's spec session (b4948247).
- Decision: The ten spikes, the handoff note and both reviews folded in one revision.
  From the spikes: readback reads the `session.append` hook and links by the command
  row's name and arguments (§6); the armed mode is dropped and a mode changes only on a
  live request or by `/plan` (§7); a scoped allow and a plan's approval are as S1
  measured, with sminos 1.6.3's `updatedInput` as M3's floor; `/background`'s condition
  is a running agent or an unfinished workflow, and its lineage has three sources (§8);
  the stop note tells the parent not to redo the task (§9); uploads are saved inside
  the working directory and read by the model (§10); `recap` is dropped, `goal <c>` is
  `run-prompt`, the Esc refusal has no cure. From the handoff note: `/background`'s
  confirm and `/exit`'s name what is lost (§8.3, F6). From the buildability review: the
  op outcome's plumbing spelled out (the child keeps the nonce to the end, the requests
  reader follows the events, the claim carries `op_id`), the `code` carried through the
  child, the mod's events named `run`, daemon capabilities in the machine presence, the
  suggestion's scope sealed as index, hash and destination, the route table in full as
  a checked-in fixture with `confirm` a flag, the read results typed (`files`, `mcp`'s
  `disabled`, `Rule`), the MCP-list assertion moved to A18, *Clear and implement*
  assigned to M4 (A29), M4 as three reviewed increments, `e2e:desk-web-hub` on the macOS
  lane, `with-slot.sh` named as this host's convention. From the design review: the
  capability carries the bridge's own version and the fallback tells a stale session
  from an older machine (§4, A5); `/reload-plugins` is finished by the daemon by effect
  (§2); desk commands run one at a time, and a foreign command row between makes a
  readback `none` (§6); M0 enables the `mcp` forms so M2 needs M0 alone; `status` strips
  a remote's userinfo, `files` and `.claude.json` named in §11; `attach.name` a checked
  basename; catalog re-lists on any reload or mcp command row and on a changed server
  set; `btw`'s text bounded. Not taken: the buildability review's metadata-read endpoint
  on the child for M0's effect checks (S7 made the hook the readback's source) and the
  design review's armed-mode taste fork (the armed mode is gone).
  Rationale: the spikes replaced every gate with a measured fact, the handoff note
  measured what a `/background` costs, and the reviews found premises in M0 the code
  did not support and a fallback that would have misdirected the owner on every
  rollout; all belong in the document before an executor reads it.
  Date/Author: 2026-10-22, the spec session (b4948247), from 2-1-300-9a's spikes, MAWS
  PR #79's handoff note, the adversarial reviewer's and the design reviewer's reports.
- Decision: The research session's re-check of §14 folded, after the first merge
  (MAWS #118, `ed06afbe2`). Fourteen departures hold; two change. (1) `/background`'s
  workflow condition tracks the task id the `Workflow` tool returns at once, held as
  running until its `<task-notification>` arrives in `session.append` with a terminal
  status; the "no unfinished `Workflow` call" test is dropped, since the call settles
  as the workflow starts and the test was always true. The "the terminal is asking"
  fallback stays for a module that loaded after a workflow was launched. (2) The mode
  is published from the bridge's own decisions the moment it hands one out, then from
  the five classic hooks spike 12 measured to carry `permission_mode`
  (`UserPromptSubmit`, `PermissionRequest`, `PostToolUse`, `PostToolBatch`, `Stop`),
  the four the bridge lacks added as pass-throughs, since `PermissionRequest` alone
  goes stale for long stretches in auto mode; `PreToolUse` carries none and is not
  used; the rows are not read (an allow's `setMode` writes none), the reading carries
  its time and the chip is stamped *as of <time>*, and a Shift+Tab at the terminal —
  which fires no hook, with no mode read to poll — is the labelled gap.
  DX5 `mode` and `presence.mode` become `{mode, at}` (M3's shapes; M0's are untouched).
  Also from the re-check: the catalog re-lists `$.command.list()` at every heartbeat and
  compares fingerprints, in place of a trigger on `$.tool.list()`'s server set, which
  would miss prompt-only servers, late mod registrations and skill changes (Q1); and
  the readback's name-and-args link applies to built-in `run` rows alone — a
  `run-prompt`'s outcome is its turn, a mod's command reads back by `text` — since an
  MCP prompt's row carries another name and a mod's row empty args (the minor). Spike
  11, measured after the merge, turns §2's "from code" on the desk's Interrupt into a
  fact; A13 keeps checking the built path. Spike 12 replaces the "every classic hook
  carries `permission_mode`" reading from code with the five hooks measured to carry it
  and the two that do not. Spike 13 measures the two table rows that were marked
  unmeasured: `list-agents` becomes `run` in M1 (readback `text`; it names sessions
  outside this project, which the item says), `subtask <task>` becomes `run` in M4
  beside fork, its finish notification tracked as a workflow's is.
  Rejected: keeping the rows as the mode's fallback (S1 shows an allow's `setMode`
  writes none, so the fallback would show a mode the engine left); reading the mode
  from `PermissionRequest` alone (stale in auto mode); a `PreToolUse` pass-through
  (its `e` carries no `permission_mode`, spike 12); the server-set trigger for the
  catalog (misses three cases the heartbeat catches for 1 ms).
  Rationale: two conditions in the design were vacuous or stale against the engine's
  own behavior, measured or read from code; the re-check found them before M0 starts.
  Date/Author: 2026-10-22, the spec session (b4948247), from 2-1-300-9a's re-check of
  §14 and its answers to the design reviewer's three questions.

- Decision: The owner's rulings on §15, and M0's execution start. The owner ruled
  (relayed by the orchestrator session, 2026-10-22): **F1** — of the controls that
  outlive the session only `mcp enable|disable` is offered, labelled; the defaults
  (model, effort, `config`, `autocompact`, `output-style`, `projectSettings`,
  `userSettings`) stay terminal-only, as the table and §11 already have them. **F5** — a
  rule suggestion's destinations are `session` and, labelled and only as the engine
  itself suggests it, `localSettings` (M3, as §7 and §11 have it). **F6** — `/exit` is
  offered behind a confirm naming the machine and that it closes the terminal session,
  narrowed by spike 14 (2.1.307, `desk-mod-run-spikes.md` §14): with one background
  shell running, `/exit` opened the terminal's *Background work is running … Exit and
  stop tasks / Move to background and exit / Stay* dialog, its promise pending past
  12 s with a queued `/color` waiting behind it (a panel, H-panel), and *Stay* resolved
  `{}`, the same as success; from code (cli 2.1.307:209156, 616826) the dialog opens
  whenever a task that does not stop on exit runs (shells, monitors, agents, workflows,
  MCP tasks) or the session is in a worktree it created (*Exiting worktree session*),
  and otherwise `/exit` exits at once. So the bridge runs `exit` only while it sees no
  running task and no worktree of the session's own, and refuses it otherwise with *the
  terminal would ask what to do with the running work: exit there*; the confirm
  promises no stop of shells (with work running, nothing stops until someone answers at
  the terminal); the outcome is the session's `session.end`, never the settled `{}`.
  The `exit` row is enabled in M1, where the typeahead draws a route's `confirm` (M0
  enables its five rows alone; `exit` carries `enabled: false`, *comes with M1*, until
  then). **F3** — `!` shell (A5) is not in this run. **F2** — open: the owner answered
  *not in this run* to the orchestrator and *include it as the run's last milestone* to
  the research session's own question on a web terminal for `--bg` jobs; the research
  session is asking which stands. Nothing before the run's last milestone depends on
  it. **F4** and **F7** — the recommendations (§11's cut; fork with M4's agents and
  following). Two execution
  calls for M0: (1) the app-start latency paths (`app.cold`, `app.warm`,
  `app.reconnect`, `app.me`, `app.chunk`, `app.state`, `app.key`) are left to the
  `desk-latency-baseline` branch, which is adding them now with its harness under
  `spikes/desk-latency/`; M0 adds only its own paths (`read.status`, `op.*`), and
  whichever of the two lands second merges master in. (2) M0 is built as two tasks in
  parallel, one per repository, each proving its half against the stand-in the other
  repository keeps; the route fixture is written first, in doperpowers, and vendored to
  MAWS before either half consumes it. The refresh pass found one change at the
  doperpowers base since the spec's pin (`646cb02c` → `a49fb156`): sminos 1.6.3
  (`bridge-plan-allow`, `bridge-requests.tsx`), which M0 does not consume; MAWS master is
  the spec's own merge (`6f7f38ae1`).
  Rationale: the rulings settle every fork the run would have stopped at; the
  latency split keeps two branches from writing the same marks; the two halves meet
  only at the wire shapes Interfaces fixes and the one fixture.
  Date/Author: 2026-10-22, the M0 plan-executor for the orchestrator session (b4948247).

- Decision: The route fixture's shape, from writing it (doperpowers `9cdd2a2b`,
  `sminos/tests/routes-2.1.307.json`, 72 built-ins and the `diff` exception). The
  table's `bad-args` cells are derived from `forms` rather than being a class; `goal`'s
  two with-args routes need `Route.otherwise` (the route on a pattern miss); `enabled`
  is `true` for every refusing or routing class, `false` for `plan` bare (*comes with
  M3*) and every `follow` row (*comes with M4*); `usage` is `panel` to `read usage` (A4
  needs the panel refusal) while `context` is `routed` to it; each route's `measured`
  mark is derived from the inventory's appendix, the probe and the spikes, the table
  having none per row; `outlives` is stored as plain text. Interfaces gains the
  derivation and `otherwise`.
  Rationale: the table's prose cells did not map onto the declared shape one to one;
  both halves read the fixture, so its shape is fixed before either half is built.
  Date/Author: 2026-10-22, the M0 plan-executor, from the fixture task's report.

- Decision: F2 closed — M6 (the attach key driver, and a web terminal for `--bg`
  jobs) is out of this run. Asked by the research session to choose between their two
  answers (entry 4), the owner chose *not in this run*, the answer they gave the
  orchestrator.
  Rationale: the owner's call; it supersedes entry 4's "F2 open".
  Date/Author: 2026-10-22, the M0 plan-executor, relayed by the orchestrator session
  (b4948247).

- Decision: The machine half of M0 as built (doperpowers `fcf9c5a2`, task 1), the
  calls a later reader needs. (1) The route table reaches the mod as a TS module,
  `bridge-routes.tsx`, generated from the fixture (`routes_check.py --write`, a check
  failing on drift), since mods import only TS and `claude plugin test` has no
  filesystem; `bridge-commands.tsx` keeps the rule. (2) A bridge refusal fails the
  `command` RPC with the message `<code>: <reason>`, the convention the MAWS half
  parses (DX6 revised). (3) The child keeps a run's `end` beside the answer it keeps
  under the nonce (`rpcs[nonce].end`), and the daemon's `recover_ops()` sends, once a
  second per outstanding op, an end no stream brought: without it A8 fails whenever the
  turn ends while the daemon is down, since the requests reader never sees the event
  (§3's "owed" covers the daemon → hub leg; this closes the child → daemon one). (4) A
  `reload-plugins` op is finished by effect when the answering child's (socket inode,
  pid) changes, not the inode alone, since an unlinked inode can be reused. (5) `op` and
  `read` go up only when `welcome.kinds` lists them (owed `op` messages are dropped and
  logged otherwise); `presence.capabilities` and `machine.desk` are not gated, the
  deployed hub passing the first and rebuilding the body that holds the second. (6) The
  route check refused by class before the form check (reversed in the fix wave: entry
  9); a disabled `run` row answers
  `disabled` with its reason; an engine older than every table measures `none` and
  refuses every built-in as not measured. (7) The Esc refusal is caught as the answer
  (`stopped`) when the engine rejects within 250 ms; a queued run that meets it later
  ends `settled {ok: false, error, code: "stopped"}`. (8) The `status` read omits
  `repo.branch`, which `$.session.repo()` does not give. (9) The fixture's `effort`
  reason names `/effort`.
  Rationale: each is the spec's intent met where its text did not reach the code
  (mods cannot read JSON; a restart can swallow an end; inodes recur).
  Date/Author: 2026-10-22, the M0 plan-executor (b4948247), from task 1's report.
- Decision: The hub-and-web half of M0 as built (MAWS `7ce3584e3`..`e2e13cf11`, task 2).
  (1) The web keeps `ops` by nonce across a reconnect (the daemon owes the outcome
  under it); an `op` with a null `rpc` (CLI-started) is not drawn; an `end` is never
  replaced by a repeated `start`. (2) `op.ran.busy` is its own latency path, §12's
  "kept apart, labelled". (3) At M0 the `mcp enable|disable` label is the web's own
  (A9's words); from M1 the catalog's `outlives` replaces it. (4) A read-only machine
  does not withhold the `status` read: a read is no RPC. (5) A malformed `machine.desk`
  refuses the machine frame `bad-shape`, its lists bounded at 64 names of 64
  characters. (6) `welcome.kinds` lists every session kind the hub knows. (7) `M0_SMINOS`
  is `1.7.0` in the web and the fake machine. (8) The Info tab reads `status` on mount,
  on *Refresh*, and once per subscription open after the first; never on a presence.
  (9) The fixture is imported as JSON in the fake machine, its CLI running bundled. (10)
  Master merged in (`e2e13cf11`, desk-latency-baseline #120): the `latency.ts` PATHS
  union; command samples pass the nonce as the recorder's `ref`.
  Rationale: as task 2's report argues each; recorded so M1's executor reads them.
  Date/Author: 2026-10-22, the M0 plan-executor (b4948247), from task 2's report.

- Decision: The fix waves after M0's task reviews (doperpowers `a2f4a444`, `f7cfaa3d`;
  MAWS `b28519272`, `26c988573`, `9afee68ae`). Machine half: (1) a route's `forms` are
  checked before its class, so `/clear extra` is `bad-args`, not `follow` (the fake
  machine already did; entry 7's item 6 reversed). (2) A reload is the module's last act:
  its `queued` answer and `run start` reach the child before `$.command.run` is called
  (the start's acknowledgement awaited at most 10 s, `RELOAD_TAKEN_WAIT_MS`; a start not
  taken is not run and ends `{ok: false}`); a desk command arriving while a reload is
  queued or running is refused with *the plugins are reloading: send it again once the
  session answers from its reloaded bridge*, carrying no code (none in the DX5 list
  fits; the web draws it as a plain failure with the reason); a module that outlives its
  reload holds the desk 60 s (`RELOAD_HOLD_MS`); an Esc refusal of a queued reload ends
  the run `settled {ok: false, error, code: "stopped"}`, which the web draws with the
  terminal's guidance. (3) A reload's `run start` names the child it left from (`child:
  [inode, pid]`, DX5 revised), so a reload from the CLI, which carries no nonce, is
  finished by effect from the start alone; a start naming no child fails at 60 s, since
  without it no successor can be told from the predecessor. (4) A command claim keeps
  `op_name` and `op_args` before dispatch; reconcile re-arms a claim it answers `done`
  by writing its `op_id` to the still-open claim before the outcome, so a stop between
  the two writes leaves a claim the next restart re-arms; a failed id write leaves the
  claim unanswered until a later pass. Web: `op.queued` survives an early `op end`, each
  mark taken once; `op.readback` is marked where `CommandStatus` commits that nonce's
  outcome, and an outcome nobody draws gives no sample; a failed *Refresh* draws its
  error beside the kept answer; the fake machine lists a plugin exception by its bare
  name.
  Rationale: the task reviews found A8's outcome lost in two restart windows and a
  reload that could swallow its own acknowledgement; each fix keeps §3's guarantee
  that an issued command's outcome reaches the desk.
  Date/Author: 2026-10-22, the M0 plan-executor (b4948247), from the fix waves' reports
  and both task reviews.

- Decision: The fixes after the doperpowers branch review (`4cab5c44`), and the one
  finding left. (1) The plane numbers its probes as they begin, and a reload counts as
  done only on a different child seen by a probe begun after the daemon first looked at
  the op (ordinals, since the plane's clock is monotonic and the daemon's is wall time);
  a cached predecessor is no evidence. (2) `recover_ops()` reads a reload's kept end like
  any op's, so a reload the engine refused while the daemon was down ends as the child
  kept it; only a reload that ran (module gone, nothing kept) is left to the effect
  check. (3) A respawned child rebuilds its id → nonce map from its kept `command`
  answers that have no end. Left, recorded as an unresolved review finding on the
  doperpowers PR: the probe fence can turn a reload that succeeded while the daemon was
  down into a false 60 s timeout when the daemon returns within a probe of the claim's
  deadline, since the deadline still runs from the claim; the fix is to run the
  deadline from the daemon's first look (or grant one fresh probe before failing).
  Rationale: the three fixes close the ways an outcome could be lost or falsely
  confirmed; the one left needs a daemon outage ending within ~2 s of a reload's 60 s
  deadline, reports a failure the transcript contradicts rather than a false success,
  and the third review round on the same path is where the loop stops.
  Date/Author: 2026-10-22, the M0 plan-executor (b4948247), from the reviewer-high
  rounds on doperpowers.

- Decision: A `/reload-plugins` outcome has two confirmation paths. If the bridge
  module survives (engine 2.1.308 keeps a module whose declaration, linked source,
  options and metadata are deeply equal: "hooks modules unchanged, kept as loaded"),
  the bridge emits the engine's returned text as `run end` with `readback {how:
  "text", text}` and frees its desk queue at once, as `/reload-skills` does. If the
  module is replaced, the daemon keeps the fresh-probe check for a different
  (socket inode, pid) and ends by effect. The first accepted end wins, keyed by
  session and op id even for nonce-free CLI runs; later ends and replayed starts
  cannot re-arm it. The daemon logs each accepted reload end with its op id and path
  (text, effect, timeout). Supersedes the assumption (M0, entries 7–10) that every
  successful reload replaces the bridge. No wire or web change.
  Rationale: found by the M0 machine-side live walk (child unchanged 2+ min after
  "Reloaded: 10 plugins"); doperpowers #351, sminos 1.7.1. Rejected: confirming by
  effect only with a forced module replacement (would make every reload restart the
  bridge child and drop its live state).
  Date/Author: 2026-10-22, the M1 plan-executor, from the orchestrator's M0 live walk.

- Decision: M1 advertises both command forms. `Catalog.commands[].route` is the
  bare `Route`; optional `withArgs: Route` is selected for non-empty trimmed args,
  falling back to `route` when absent. `otherwise` remains on the form whose pattern
  it follows (`goal`'s with-args form). The shared fixture includes verbatim MCP
  names, source/plugin, both forms, and model options/aliases as model ids only.
  Rationale: a single resolved bare route cannot advertise `/mcp enable …` or
  distinguish `/goal clear` from `/goal <condition>`. This additive field beats a
  web-side form table: the bridge remains the one classification source.
  Date/Author: 2026-10-22, the M1 plan-executor, agreed with both executors and the
  orchestrator.

- Decision: M1 recovers command outcomes by replay on browser reconnect. The hub
  durably keeps the latest nonce-bearing command `op` (`op: "command"`) for each
  (machine, session, nonce), preserving an `end` over a late `start`, and replays it when an authenticated
  browser joins the project. Retention is bounded to the latest 256 operations,
  24 hours and 4 MiB per project; nonce-free CLI operations and non-command ops
  (including future `btw` answers) are not cached. This
  is an operation-receipt cache (command name, arguments, op envelope and result
  line), not transcript storage: no transcript/message bodies or rows. The owner
  approved this bounded storage on 2026-10-22. The table is created in code in the
  Project Durable Object's SQLite; deployment needs no wrangler migration. This
  changes no machine frame. A reconnect test must miss the live end and recover its readback from the
  replay; repeated delivery must not regress a terminal outcome.
  Rationale: reading the RPC's terminal state cannot recover this outcome: its
  `done` means `{queued: true, route, id}`, not that the command finished, and the
  browser drops its resend entry at that acknowledgement. Replay closes the
  browser leg without reissuing an effect or widening the daemon's protocol.
  Date/Author: 2026-10-22, the M1 plan-executor, from the hub-and-web executor's
  inspection of the RPC and project reconnect paths.

- Decision: `/exit` fails closed when any running-work or session-created-worktree
  class cannot be established. It runs only when shells, monitors, agents,
  workflows, MCP tasks and a worktree the session created are each positively
  shown clear; an agent list alone is insufficient. Unknown state is refused with
  *can't tell whether work is running here: exit there* (or the existing known-work
  refusal). Transcript/record evidence across a reload may establish a class;
  process descendants can cross-check but cannot replace complete evidence.
  Rationale: the mod API exposes no complete task/worktree-state noun. More
  refusal in M1 is acceptable; a false clear opens a terminal dialog and stalls
  the desk queue, including on seats with no person attached. An engine-level
  task/worktree noun, or a ledger whose completeness the mod can prove, remains
  residue for a later ticket. This narrows F6's availability because of an
  observation gap; it does not reverse the owner's approval of a positively safe
  `/exit`. The owner confirmed *keep it off in M1* ("M1에선 끄기"), 2026-10-22,
  relayed by the orchestrator; this is the approved M1 scope.
  Implementation conclusion: the transcript's jobs ledger is partial after
  reload/compaction, and the sminos member's worktree is spawn metadata rather than
  authoritative `EnterWorktree` state. No complete clear-state proof was found.
  Consequently M1 advertises `/exit` as disabled with the unknown-state reason and
  independently refuses it in the command path, while retaining its measured
  `run`/confirm semantics for a later reliable guard. All desk `/exit` remains
  unavailable; partial trackers and unreachable success handling are not added.
  Date/Author: 2026-10-22, the M1 plan-executor, from the orchestrator's ruling on
  the machine executor's API gap.

- Decision: The daemon admits `/cd` only for a literal absolute path whose
  canonical real path matches one of the project's known checkouts, and forwards
  that canonical absolute path. Relative paths and `~` are refused
  `unknown-checkout`, with guidance to use an absolute known-checkout path.
  Rationale: the daemon's working directory is not the session's, and the joined
  record may lag an earlier `/cd`. Resolving relative input against either could
  validate a different target than the engine would use. This keeps the existing
  known-checkout boundary without a new wire field or a guessed working directory.
  Date/Author: 2026-10-22, the M1 plan-executor, from the machine executor's policy
  implementation and focused tests.

- Decision: Remote CI watchers do not hold this Mac's heavy-run slots. Invoke
  MAWS's `scripts/ci-gate.sh` and ci-kit's `ci-gate` without `with-slot.sh`; keep
  the slot wrapper for local installs, builds and test runs. This supersedes the
  earlier Concrete Steps convention of wrapping the remote watcher too.
  Rationale: two remote CI watchers held both local slots during M1, starving the
  focused RED test needed to fix the superseded head. The orchestrator directed
  normal termination of the obsolete MAWS watcher (its trap released the slot),
  leaving its GitHub run untouched; no slot lock was manually removed.
  Date/Author: 2026-10-22, the M1 plan-executor, from the orchestrator's execution
  correction after the observed slot starvation.

- Decision: A14's catalog gate stands with no M0 fallback, and M1 rolls out web and
  machines back to back. Remote slash commands need sminos 1.8.0's catalog, so a
  1.7.1 machine refuses `/list-agents`, `/rename` and `/reload-plugins` with the
  older-plugin reason while the native controls and `read.status` keep working; once
  the machine is on 1.8.0, a session still loaded on 1.7.1 gets the stale-session
  reason. That is the designed mixed-version behaviour, not a regression, but it
  would refuse every desk slash command from the web deploy to the machines'
  install, so neither half ships early: after cua's hold 3 on the mini releases
  (about 16:40Z on 2026-10-22; the mini pulls the doperpowers marketplace on its own,
  and a sminos daemon restart inside the hold would stop cua's run), doperpowers #353
  merges, MAWS #126 merges and deploys at once, and the MacBook rolls to 1.8.0
  minutes later. M1's walk, in that order:
  1. Before the deploy, open one `web@master.f12fb35c` tab and leave it unrefreshed.
  2. After the deploy, on the still-1.7.1 MacBook: `/list-agents` and `/rename` are
     refused with the older-plugin reason; the native controls work. This proves
     A14 and A5's older-machine half; A1's historical no-`read.status` half has no
     live fixture left (every machine runs 1.7.0 or later) and rests on the
     old-producer tests.
  3. After the MacBook's roll, before any reload: a seat loaded on 1.7.1 is refused
     with the stale-session reason (A5's second half).
  4. A9's replaced-module branch: `/reload-plugins` to that seat from the retained
     old tab, its receipt *confirmed by effect* and `daemon.log`'s `how=effect` line
     for the same op. If the old client can't be kept usable, `sminos command <seat>
     reload-plugins` proves the machine half and the record names the CLI as the
     route; the desk-visible effect receipt is then walked at the next sminos bump,
     on a seat loaded on 1.8.0.
  5. The visible *Ran* label, A10–A14, the sleeping-phone missed-end recovery, and
     A33's samples. The comparative RC column stays deferred (MAWS #52).
  Rationale: the new desk cannot send the first reload to a session whose mod
  predates the catalog, and a browser-side legacy command table would reopen the
  approved gate to keep a window of minutes usable. Rejected: deploying the web as
  soon as its gates pass, which leaves every desk slash command refused until
  16:40Z or later. Date/Author: 2026-10-22, the orchestrator's integration ruling.

- Decision: The M1 live-walk fix adds `Catalog.skills?: string[]` in sminos
  1.8.1, from the mod API's summary context skill listing, and the web tests
  membership before assigning Plugins or Custom (built-ins stay Engine, as MAWS
  does). `$.command.list()`'s `source` is provenance, not a skill discriminator.
  An absent field keeps 1.8.0's grouping; an empty list means no skills were listed.
  Skill membership participates in the fingerprint, so a change pushes a new catalog
  even if commands and models did not change.
  Evidence: the engine-generated 2.1.308 declarations expose `CommandInfo` with
  `name`, `description`, `source`, `plugin?`, and `ContextSkills.skillFrontmatter`
  with `name`, `source`, `pluginName?`, `tokens`. Live throwaway sessions with
  temporary HOME and SMINOS_HOME confirmed that user and plugin skills share
  `user`/`plugin` command sources with ordinary commands. The summary listed
  `user-skill`, the markdown command `custom`, and `catalog-probe:plugin-skill`,
  but not the mod-registered `ordinary-command`. It also omitted a user-invocable
  `manual-only` skill with `disable-model-invocation: true`; that known limit keeps
  such commands in their prior group rather than guessing from disk or names.
  Cost: a live 2.1.308 session with 116 listed skills and 70,245 locally estimated
  context tokens took 11, 4, 3, 3, 3 ms for five summary reads; a final command-list
  plus summary read took 4 ms. A local API trap received zero requests, including
  zero count-token calls. The types say summary estimates locally, unlike full.
  Smaller startup probes took 43 and 13 ms including command.list. The summary runs
  alongside the existing catalog reads, adding no serial read or network dependency
  to catalog arrival or the snapshot. No full token count is requested. A failed or
  shapeless summary is isolated to an empty skills list, not a failed catalog. The
  child and session-plane catalog allowlists carry the field on changes as well as
  resync snapshots; transport tests cover both and older producers that omit it.
  Rejected for now: waiting for a richer engine skill-list API that also exposes
  manual-only skills; it would leave the observed Skills group empty. Also rejected:
  inferring skills from command source or a colon, which the live probe disproves.
  The orchestrator accepted the bounded listing and its documented manual-only gap.
  Date/Author: 2026-10-22, the M1 live-walk fix executor and orchestrator.

- Decision: Every rejected lazy import, and Vite's `vite:preloadError` event
  (including CSS and imports outside the lazy views), triggers a guarded reload of
  the current URL. Browser error text is not an interface: a WebKit run rejected
  HTML with a MIME-type message unlike Chromium's import message. A tab-scoped
  sessionStorage marker is keyed by the page's hashed module-entry URL. Each build
  gets at most one automatic reload, and markers are retained, so another chunk's
  success or alternating old indexes cannot restart a loop. Without writable
  storage no automatic reload is attempted. Persistent failure leaves a visible
  manual reload action. All lazy surfaces, including depth and diff, use this path.
  Navigation freshness: the production notification worker has no fetch handler or
  Cache API and caches no shell. `desk-hub/wrangler.jsonc` sends SPA assets through
  Cloudflare's asset service, not worker.ts (worker-first is `/api/*`, `/machine/*`),
  with no `_headers` override. Cloudflare documents its default as `Cache-Control:
  public, max-age=0, must-revalidate`, requiring network revalidation before reuse
  (https://developers.cloudflare.com/workers/static-assets/headers/). The WebKit
  and Chromium fixture serves an obsolete hashed entry for the first index and
  the current index for recovery under that cache policy; it must fetch the new
  document, retain the route and load the current module. A persistently missing
  module must stop after one reload. The production hub was not contacted for
  this check; source, provider documentation and the controlled browsers are the
  evidence. The fixture serves actual files from an isolated build directory,
  waits for the production notification worker to claim the tab, then replaces
  index.html. Both Chromium and WebKit fetch the current entry on recovery with
  that worker enabled. The local static double mirrors Cloudflare's revalidation
  header; production asset and service-worker behavior is unchanged.
  A14's minimum-version prefix belongs only to the older-machine capability
  branch; an updated machine with a stale session gets reload guidance alone,
  and the plugin to update is sminos.
  Rationale: the owner's home-screen app remains open across deploys, whose removed
  hashed modules get the SPA HTML fallback. Rejected: matching particular error
  strings, which already missed WebKit's MIME refusal; unconditional reloads,
  which loop on persistent failures; and clearing a guard on chunk success, which
  can rearm it while another chunk is still broken.
  Date/Author: 2026-10-22, the M1 live-walk fix executor, incorporating the
  orchestrator's event-based recovery and navigation-cache checks.

- Decision: A phone returning from explicit freeze/resume, back-forward cache, or
  offline reconnects its project immediately. WebKit has no Page Lifecycle
  freeze/resume events, so a 2-second local heartbeat records Date.now(); a gap of
  at least 10 seconds latches JavaScript suspension before updating that timestamp.
  Visibility return, the first visible heartbeat, or the first visible frame after
  that gap reconnects once. The frame dispatch guard latches suspension before
  reducing any buffered chunk; frames arriving before visibilitychange cannot
  erase the gap or mutate the transcript while it awaits a fresh snapshot. This is a
  wall-clock signal, not frame freshness: a burst of old frames at unlock was the
  exact case a last-frame timestamp could misclassify as healthy. Healthy desktop
  tab switches and quiet background tabs whose timers keep running preserve their
  socket and subscription; a unit test pins both with no new subscribe frame.
  Accepted side effect, not another fix: after roughly five quiet hidden minutes,
  Chrome's intensive timer throttling may align callbacks to once a minute. That
  creates a suspension-sized gap even on a healthy socket, so returning to that
  desktop tab pays one reconnect/resnapshot (about a second). Shorter hidden tabs
  have one-second timer throttling and keep the connection. The coordinator accepts
  that long-absence trade because wall-clock suspension is the only signal iOS
  reliably gives. The old socket is fenced before its
  close handshake, so buffered stream frames cannot keep mutating the current
  transcript while it catches up. A new welcome replays command outcomes and
  re-subscribes each active transcript for a current snapshot; the normal staged
  snapshot merge preserves the reader's held history. The old handlers only
  timestamped visibility/online events: they did not request any fresh state, and
  `HubSocket.restart` only called close, leaving queued frames authoritative until
  the close event arrived. That permitted the owner’s observed slow wake catch-up
  while reopening fetched current state; a physical lock/unlock re-check remains
  the final validation of the iOS case. Rejected: speeding up replay of every missed
  chunk, which still makes catch-up proportional to time asleep, and waiting for
  a half-open connection to notice its own failure. Also rejected: rotating on
  every visibility return, which would impose a reconnect on ordinary desktop tab
  switches; a healthy-switch regression pins unchanged socket/subscription counts.
  Browser proof uses an offline mounted page plus dropped socket across the end
  of 1,000 numbered Markdown sentences, then compares current-snapshot and actual
  command-receipt recovery with reopening. Both Chromium and WebKit pass. CDP
  frozen→active could not resume even an empty page on this MacBook, so it supplies
  no app evidence (friction tracker #92); real-WebSocket unit tests separately pin
  iOS wall-clock gaps, buffered-frame-first and heartbeat-first orderings.
  Scope of that proof: both the real bridge/plane and fake producer capture the
  reply-so-far as aggregated streaming blocks plus watermarks, not chunk history.
  Post-capture live deltas can still accumulate in the real plane while transcript
  construction waits and drain individually afterward. A synthetic synchronous
  574-chunk post-join burst delayed receipt visibility past five seconds in a
  focused test; this does not measure production latency or prove its cause, but
  is not grounds to dismiss real backlog exposure. Measuring/bounding that live
  backlog is a separate latency follow-up; this change replaces stale generations
  with current state, not a live-delta coalescing policy.
  Date/Author: 2026-10-22, the phone-fix executor, from the owner's m1-busy walk.

- Decision: Pending command receipts belong to the project conversation, not a
  mounted composer. This browser persists only its own unobserved command nonces
  and display metadata in localStorage (`desk.pending-commands`): project, machine,
  session, nonce, name, optional outlives label and issue time. They expire 24 hours
  after issue and are bounded to 256 per project, matching the hub's replay window.
  There are no arguments, signed RPCs or transcript/result bodies in this record;
  it never reissues an effect. A fresh page can match the hub's replay by nonce and
  draw the actual op end even though the original in-memory RPC is gone. Until the
  replay arrives it says Checking command outcome, not Ran. Refusals before an op
  starts are not retained by the hub: a restored nonce with neither a live RPC nor
  an op must not wait forever. After a join replay completed beyond that nonce's
  60-second RPC_FRESHNESS_MS acceptance window, it says Command outcome unavailable
  · may not have run; check the session. This is not a claimed refusal or success.
  The join sends every retained op before handling resume, whose caught-up frame
  supplies the replay timestamp. A fresh restored batch waits for acceptance to
  expire and requests a deduplicated, visible-only rejoin; this observes outcomes,
  never re-executes commands. Existing RPCs and real starts/ends take precedence,
  including a late op replacing the fallback while its line remains mounted.
  Chosen over extending the hub cache with RPC refusals: the bounded client fallback
  covers any unrecoverable receipt without a protocol/storage change and states
  exactly what is known. A terminal receipt is acknowledged only when its line
  intersects the viewport while the document is
  visible. The mounted composer leaves that line in place while it is read; the
  next view does not resurrect an acknowledged receipt. Other browsers' replayed
  history is not drawn in this composer's receipt list. Rejected: sessionStorage,
  which need not survive a killed iOS home-screen app; component state alone,
  which lost the nonce on reopen; and rendering the hub's entire 256-op/day replay,
  which would bury the reader under other devices' history. The coordinator set
  this browser-ownership boundary explicitly after the phone walk.
  Date/Author: 2026-10-22, the phone-fix executor and orchestrator.

- Decision: The actual M1 rollout reverses entry 17's merge order, not its A14
  gate: deploy MAWS #126, walk the still-1.7.1 MacBook, then merge doperpowers #353
  and roll the machines immediately. The mini's hold did not start at the expected
  time; rollout waited for the owner to unlock and approve it at 19:44Z. The
  MacBook's marketplace clone also auto-pulls, so merging #353 first could erase
  the older-machine fixture before the web was ready. MAWS deployed at 19:58Z;
  older-plugin refusals passed at 19:59Z, the MacBook rolled next, and its stale
  session was observed before automatic reload. The mini settled at 20:01Z.
  Rationale: preserve the short mixed-version check without weakening the catalog
  gate or leaving the two halves apart. Rejected: merging the machine half first
  as entry 17 scheduled, which no longer guaranteed a 1.7.1 machine to walk.
  This walk uses the MacBook as the older machine, rather than §13's intended
  mini fixture; rolling both machines is not a full two-Mac acceptance walk.
  Date/Author: 2026-10-22, the orchestrator's rollout at 19:46–20:03Z.

- Decision: Fix G1's count-then-scroll race in its helper, separately from the
  chunk-recovery production change. Resolve the current matching row and scroll
  it in one browser evaluation; retry a missing or recycled match within the
  existing 120-window budget. Keep the assertions and production scrolling
  unchanged. The sister helper in `depth-jobs.spec.ts` is recorded in
  `docs/tech-debt-tracker.md`, not broadened into this fix.
  Rationale: the baseline/candidate comparison and instrumented run (Surprises)
  did not support a user-facing remount; the detached row was directly observed.
  Rejected: treating two failed gates as a harmless flake, adding waits, or
  changing the lazy-view lifecycle without evidence. The final head must pass
  two remote desk-web runs; `7243dffc4` did, before MAWS #127 merged.
  Date/Author: 2026-10-22, the orchestrator and live-walk fix executor, 21:45Z.

- Decision: Split streaming free scroll out of the phone recovery PR. MAWS #128
  ships only wake/current-snapshot recovery, browser-owned unseen receipts and
  their missing-outcome fallback; its shared Transcript files equal master.
  MAWS #129 carries the reader-follow change separately, with its own review and
  desktop/Mac gates before landing. No outcome for #129 is claimed here.
  Rationale: the first combined candidate exposed shared virtualizer regressions
  (deferred iOS adjustment and nested scrolling), not just a phone-only fix.
  Rejected: holding the independently verifiable wake/receipt repair behind that
  broader change, or shipping the combined head on browser evidence alone.
  Measuring the post-snapshot live backlog also stays separate: doperpowers board
  #128, P2 ready-for-architect. Desk `/exit` remains off under entry 14; its
  complete-state-proof residue is doperpowers board #127, deferred P3.
  Date/Author: 2026-10-22, the orchestrator and phone-fix executor, 23:27–23:40Z.

- Decision: Bring the M1 record forward through rollout, the failed and passed
  live checks, and the deployed follow-ups, without declaring M1 accepted.
  Progress distinguishes deployment from the owner's still-owed phone re-walk;
  Outcomes separates observed timings from comparative A33 and names the branches
  not walked. The existing Skills, chunk, wake and receipt decisions stand.
  Rationale: merged fixes and controlled-browser proof do not replace the physical
  phone check that found the failures. Rejected: closing acceptance from green
  gates, or leaving the record at the executor's pre-rollout handoff.
  Date/Author: 2026-10-23, the orchestrator's M1 record update, from the working
  log, walk artifacts and verified PR merge records.

- Decision: Streaming follow releases only on witnessed reader input: upward
  wheel/touch intent at once; scroll-capable keys captured globally and a scrollbar
  pointer's release arm a 250 ms movement witness. Keyboard/scrollbar release needs
  upward list movement away from the measured end, including before a smaller DOM
  sizer commits. Browser clamps, row replacement and shrink cannot detach a
  follower by themselves. Returning to the end or Jump to latest resumes following;
  explicit app-owned row navigation still opts out.
  Rationale: four review rounds on MAWS #129 moved the near-end heuristic to this
  policy, through measured-end changes, unwitnessed detachment, native key/scrollbar
  ordering and witnessed end clamps. Rejected: inferring reader intent from offset
  or a near-end band, which confuses browser geometry changes with reading and can
  pin small upward gestures back to the bottom. The accepted cost is that native
  find-in-page, focus or selection autoscroll alone does not pause following. The
  bounded stale-end re-entry corner remains in `docs/tech-debt-tracker.md`, retained
  to preserve WebKit's queued return-to-bottom fix.
  Date/Author: 2026-10-23, the free-scroll executor and orchestrator, MAWS #129.

- 2026-10-24: Record #129's deployment and the owner's attended phone re-walk in
  Progress and Outcomes; no change to the unwalked M1 branches or comparative A33.

- Decision: Convergence with MAWS. M2–M5 pause for the remote-session architecture;
  their existing mod-based plan is not the next work to execute. The owner expects the
  desk and the MAWS desktop app to become one kind of application — “MAWS on web”
  and the MAWS app, one GUI workspace for every Claude Code session across projects
  and machines. MAWS already has a mature agent workspace design; showing sessions
  across machines in it is not very different, so the owner expects some
  reconciliation, not much. The desk's org and IAM structure persist: IAM answers
  who owns a session, and one workspace belongs to one org, covering the projects
  of its enrolled machines. The sharing choice imagined when a person opens a
  session is to share it with the org, keep it private, or set a sharing boundary.
  Full remote control is meant to come through a protocol akin to Claude Code
  Desktop's SSH mode, planned but not built here. Since Desktop already does it,
  the owner expects bringing MAWS's native experience to remote sessions not to be
  too hard. The remaining panels — context and usage, model and effort, MCP,
  permissions and more — will likely come through an architectural change rather
  than the working but limited mods API: probably a helper daemon exposing the
  SDK's control surface for full native-level control, not a settled architecture.
  Rationale: MAWS's UX is moving quickly; the owner will wait for that work to
  finish, and the remote-session architecture is not settled. It is not yet time
  for the session-source seam design note the orchestrator proposed before M2;
  that note waits for the architecture too. Rejected: building M2's panels now on
  the mods/bridge surface as desk-only components. M2–M5's existing design and
  acceptance remain the record to reconcile when that architecture settles, not
  authority to continue the current implementation plan.
  Note for that future design, not a decision: a private session's content should
  be withheld at the machine, in what its daemon publishes to the hub, not merely
  hidden in the UI, so the sharing choice is enforced where data leaves the machine.
  Date/Author: 2026-10-24, the owner's direction, recorded by the desk orchestrator.

## Outcomes & Retrospective

**M0 (2026-10-22).** Built in both repositories as two parallel tasks against the
Interfaces and one route fixture, each proved against the other repository's stand-in:
doperpowers `desk-ctl-m0` (sminos 1.7.0: the route table and its check, the `read` and
`command` ops, the child's capabilities and nonce keeping, the daemon's `command` RPC,
`op` outcomes owed and recovered across restart and reload, the `read` relay, `sminos
command` and `sminos read`), MAWS `desk-ctl-m0` (the protocol's new fields, kinds and
frame, the hub's shape checks and `welcome.kinds`, the fake machine's M0 producer, the
web's capabilities from both presences with the three fallbacks, the composer's slash
path and `CommandStatus`, the Info tab's status read, M0's latency paths). What the
reviews found was concentrated where the spec said the risk was: the op-outcome
guarantee. The task reviews and the doperpowers branch review found five ways an
outcome could be lost or falsely confirmed across a daemon restart, a reload or a child
respawn — none visible to a happy-path test — and each became a red test first; the
MAWS reviews found latency marks that measured receipt rather than the draw §12 names.
At the M0 build handoff, acceptance on the owner's Macs (A1–A9, A33's paths) still
needed deployment and rollout; the completed live walk below updates that evidence.
The fake machine does not model A8, which rests on the machine half's tests and the walk. For M1: the route fixture's reading (entries 5, 9)
is the one source both halves read; the web's `outlives` label is local until the
catalog carries it; a browser that misses an `op end` while its socket is down shows
*queued* (Surprises) — a replay or a resync of owed outcomes to a reconnecting browser
was left open by M0 and is resolved by M1's Decision 13.

**M0 live walk accepted (2026-10-22, completed 12:19–12:31Z; orchestrator evidence).**
On `web@master.f12fb35c`, MacBook sminos 1.7.1, the initial 11:35–11:40Z walk
resumed after the lid-close interruption. The orchestrator accepted M0 with the
three carryovers listed under M1 Acceptance. Observations:

| Check | Observed result |
| --- | --- |
| A2 | `/rename desk-m0` on `m0-walk`: Queued 349 ms, row-confirmed 630 ms. Sidebar primary title and session header both became `desk-m0`, supplementary alias retained. The daemon publishes the custom title; production title handling needs no M1 change. |
| A3 | Queued until `m0-busy` is idle at 710 ms; after the turn Queued at 6,090 ms, row-confirmed 6,109 ms. |
| A4 | All three exact refusals, 290–356 ms. |
| A6 | Bridge child 993 killed; controls re-enabled within 1.07 s; replacement 96148 advertised the same capabilities. |
| A7 | Read-only refusal at 885 ms; name unchanged, no rename in bridge RPC records. Policy restored to its before-state: read-only no, ceiling auto from settings. |
| A8 | Daemon restarted 8.8 s after queue; row-confirmed at 34.9 s under the same status line. |
| A9 text | Two reloads confirmed by text at 1,071 and 2,548 ms (`Reloaded: 10 plugins`). Daemon accepted ends `01ea8dc4…` and `347c8bc7…`, `how=text ok=True`. No module replacement occurred, so effect remains owed. |
| reload-skills | Confirmed by text, 502 ms. |
| MCP | `disable notion` showed the saved-for-project label, 713 ms; re-enabled at 1,653 ms. |

The first latency samples (milliseconds) are measured desk observations, not A33's
20-use-per-path or comparative RC-parity proof:

| Path | n | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| read.status | 2 | 127.7 | 303.9 | 303.9 |
| op.queued | 9 | 612.4 | 1811.5 | 1811.5 |
| op.ran | 7 | 664.1 | 2475.1 | 2475.1 |
| op.readback | 9 | 1035.1 | 34724.3 | 34724.3 |
| op.ran.busy | 2 | 6039.3 | 34693.9 | 34693.9 |

**M1 build handoff (2026-10-22 12:36Z; rollout and walk below).** Both repositories implement
one catalog contract and share the byte-identical route/catalog fixture. Sminos
1.8.0 enables measured M1 commands and prompt routes, pushes and serves catalogs,
keeps them through child recovery, and applies the canonical known-checkout `/cd`
boundary. `/exit` remains explicitly unavailable by the owner's ruling. MAWS
provides the per-session cached palette, shared MAWS ranking, capability-aware
form routing, independent command receipts, and bounded command-only replay on
reconnect. Idle storage expiry is alarm-driven; no transcript rows or side-question
answers enter the cache, and the new table is created in code without a wrangler
migration. The two M0 wording defects are corrected: completed confirmations say
*Ran*, and bridged missing usage says *not reported yet*.

Both task reviews and the `high` branch reviews found their consequential issues
at boundaries: malformed path admission, old-engine plugin-panel fallback,
missing advertised argument guidance, durable retention without traffic, and
catalog ownership while a successor session waits for predecessor posts to drain.
Each became a regression before its fix. The final machine head `70fc4bc6` passed
all eight committed gates (run 39776521538); its focused bridge check passed 305
cases. MAWS's code review is clean through `52b93b3e`, with the final test-only
Node typing correction and this evidence record proceeding to combined-head
verification. The prior command browser scenarios all passed; final combined-head
CI and local screenshot inspection remain separate evidence, not implied by review.
The focused headless screenshots passed 2/2 against `52b93b3e` production code
(the later Node-type annotation changes no runtime): desktop 1280×720 and phone
390×844 images under `/tmp/maws-desk-m1-evidence/52b93b3e4-QS7jyz/` were inspected
by executor and controller. The palette, descriptions/refusals and mixed-version
copy fit those viewports. These fake-session images are supporting evidence,
not a substitute for the deployed phone/keyboard and mixed-Mac walk.

That executor handoff left both PRs unmerged and the live walk to the orchestrator.
The following record supersedes its pending verification and rollout status; it
is not a sign-off of the acceptance branches that remain open.

**M1 rollout and first acceptance walk (2026-10-22 19:58–20:49Z).** Both halves
landed back to back, then two fix waves followed the walk. Merge commits below
are checked against each repository's PR record; deployment times and build
labels are the orchestrator's rollout observations.

| Landed change | Merge | Rollout |
| --- | --- | --- |
| [MAWS #126](https://github.com/SSFSKIM/MAWS/pull/126), M1 command spine | `d399c1cac` | 19:58Z, hub `d399c1ca`, web `master.d399c1ca`. |
| [doperpowers #353](https://github.com/SSFSKIM/doperpowers/pull/353), sminos 1.8.0 | `00e34537` | MacBook 19:59Z; mini daemon/uplink restarted 20:01Z. |
| [doperpowers #355](https://github.com/SSFSKIM/doperpowers/pull/355), sminos 1.8.1 | `099a44c9` | MacBook 21:37Z; mini followed through automatic reload after its hold released. |
| [MAWS #127](https://github.com/SSFSKIM/MAWS/pull/127), catalog, chunk and guidance fixes | `1cea5bc35` | 22:03Z, hub `1cea5bc3`, web `master.1cea5bc3`. |
| [MAWS #128](https://github.com/SSFSKIM/MAWS/pull/128), wake and receipt recovery | `4c12e4a1b` | 23:55Z, hub `4c12e4a1`, web `master.4c12e4a1`. |

MAWS #126's final combined head `c4503dce1` passed static, all four unit shards,
`e2e:desk-web` and `e2e:desk-web-hub` in macOS run 39842811898 (attempt 2: the
known `pause-take-over.pty.test.ts` zsh emacs-mode failure passed its rerun).
Doperpowers #353's eight-gate evidence is recorded in the build handoff above.
The live UI walk used the MacBook seats `m1-walk` and `m1-busy`; the mini was
rolled, not a second complete UI walk. Evidence is under
`/tmp/dsk-scripts/m1acc/`; the attended terminal/phone observations are the
orchestrator's working log, 20:36–20:49Z.

| Check | Observed result |
| --- | --- |
| A5 / A14 older machine | On the still-1.7.1 MacBook, `/list-agents` and `/rename` were refused with the older-plugin reason and Send as text anyway; the palette kept the desk's Model/Compact items, and Info's `read.status` still answered. The wording incorrectly named doperpowers as the plugin to update; #127 corrects it to sminos. |
| A5 stale session | After the MacBook roll, its 1.7.1-loaded seat said to run `/reload-plugins` or restart. #127 removes the misleading older-machine minimum-version prefix from this branch. |
| Ran label / A10 | `Ran · Session color set to: red · confirmed by its row` was visible. Palette opening caused no socket frames; all 136 names/descriptions matched, all 83 unavailable entries had reasons and MCP names kept `(MCP)`. Skills grouping failed (zero Skills); #355/#127 repair it. |
| A11 | Desk red then blue each read back their own line. With the owner typing yellow between desk commands at 20:37:03Z, yellow stayed unattributed and both desk lines remained row-confirmed. |
| A12 | A skill command and `/goal` started turns and showed Started a turn; the goal-clear hint named Interrupt rather than promising a queued clear would stop the running goal. |
| A13 | Desk Interrupt left `/color` usable. After the owner's terminal Esc, desk green was refused with *stopped at the terminal: commands resume after input is typed there*; terminal purple cleared the condition and desk green ran at 20:40:19Z. |
| Sleeping phone | Failed on the original M1 build: stale streaming content after unlock, orange still queued after its end, receipt lost on reopen, and no free scroll while streaming. Wake/receipts shipped in #128, scroll in #129; the physical re-walk is below. |

**A33 samples from that walk**, milliseconds, on the original M1 deployment before
the fixes (MacBook load observed at 18–55). The first five paths each have at
least 20 uses; the single busy sample is diagnostic only. The palette meets its
fixed 50 ms budget, but this is not RC parity or the cold/warm/reconnect cohorts
on both Macs. `catalog.ready` mostly measures the cache, not an uncached read.
Source: `/tmp/dsk-scripts/m1acc/final-evidence.txt`.

| Path | n | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| palette.open | 27 | 1.0 | 8.4 | 9.1 |
| catalog.ready | 24 | 0.1 | 0.1 | 408.6 |
| op.queued | 30 | 296.4 | 590.0 | 677.1 |
| op.ran (idle) | 29 | 468.6 | 641.2 | 680.1 |
| op.readback | 30 | 468.1 | 646.1 | 682.7 |
| op.ran.busy | 1 | 345.0 | 345.0 | 345.0 |

`read.catalog` had zero samples: the UI used pushed/cached catalogs and had no
consumer of the on-demand read. A14's cached-catalog downgrade was not staged
live; cache-ready samples do not prove that refusal branch. A9's effect branch
was not reached (the old tab lost its chunk and automatic reload consumed the
stale module before the CLI fallback). A11's identical-command/arguments collision
was not staged in the attended walk; the different terminal command between desk
commands proves only that case. Those branches rest on their automated tests,
not live passes. A1's pre-`read.status` producer likewise had no live fixture.
The comparative RC column stays deferred on MAWS #52; the separate second latency
window was skipped while the owner's screen was locked, yielding no samples.

**Fixes landed (2026-10-22–23; phone revalidation below).** Skills membership
now crosses the child and plane allowlists as well as the mod/web types, and an
unavailable usage summary leaves the command catalog intact. The live 1.8.1
catalog was checked after deployment and carried `skills`; the screen was locked,
so the deployed Skills UI was not re-walked then. #127 also recovers failed lazy chunks
with a build-scoped one-reload guard, fixes both capability wordings and hardens
G1's live-row scroll helper without changing production scrolling. Pre-fix tabs
still need one manual reload to acquire that recovery code.

Doperpowers #355's final `d172adfc` passed all eight gates (39854813385) after
review found and fixed the optional-summary failure and both transport allowlists.
MAWS #127's `7243dffc4` passed static/unit/desk-web (39860309618), a second desk-web
run (39860320211), and macOS desk-web-hub (39861585627); its independent review
had no material findings. #128's `fc5697e51` passed static/unit/desk-web
(39873504020), macOS desk-web-hub (39874568939), and re-review. Its focused
Chromium/WebKit wake/receipt fixtures passed 8/8, including killed/reopened unseen
ends and a missing outcome. These are controlled-browser results, not a deployed
phone latency measurement. The exact fallback is *Command outcome unavailable ·
may not have run; check the session.* It neither claims success nor retries an
effect. The implementation contracts and their tradeoffs are in the existing
wake/receipt Decision Log entries; fix evidence is under `/tmp/dsk-scripts/m1fix/`
and in the linked PRs.

[MAWS #129](https://github.com/SSFSKIM/MAWS/pull/129) merged as `5a4b93b4c` on
2026-10-23 and deployed at 06:36Z as `hub@5a4b93b4 web@master.5a4b93b4`. Its final
head `4644f3e30` passed Linux static/unit/probes/desk-web (39893304199) and the
seven-group Mac set (39909560332): unit:darwin, e2e:default, transcript, panel,
composer, agents and desk-web-hub.

**Owner's physical-phone re-walk (2026-10-24 10:26–10:45Z, attended).** On that
build, MacBook seat `m1-busy`, the command list's Skills group was populated and
free scroll worked while the reply streamed. `/color orange`, sent during the
turn, waited and ran after the turn ended; its line read the row-confirmed *Ran*
result. The phone was locked through the turn's end. On unlock the page kept the
reader's place and showed the completed reply at once, with no slow catch-up.
These are the owner's observed results, not a measured latency distribution or
a full M1 sign-off. The previously unwalked acceptance branches remain open.

Residue stays in the backlog: doperpowers board #127, complete task/worktree proof
before desk `/exit` can be re-enabled (deferred P3), and #128, post-snapshot live
backlog measurement and bounding (P2 ready-for-architect). The wake path caught up
instantly in this walk; that does not close #128's measurement/bounding work.
M2–M5 and comparative A33 remain ahead.

The lesson of this walk is that an outcome reaching the hub is not yet an outcome
the person can read: a sleeping browser needs both a current transcript and its
own unseen receipt identity after reopen. The actual engine inventory likewise
proved more than a fixture could about grouping, and the rollout's automatic
updates consumed a fixture the plan expected to keep. The record preserves those
limits instead of turning merged code or a nearby passing check into acceptance.
