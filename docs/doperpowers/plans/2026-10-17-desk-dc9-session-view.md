# The desk, DC9 — the web: the session view: execution (2026-10-17)

> **Composite:** `docs/doperpowers/specs/2026-10-15-desk-design.md` (MAWS,
> branch `smns-erb`; on this machine
> `/Users/new/Developer/GitHub/MAWS/.claude/worktrees/smns-erb/`), child
> **DC9** (The web — the session view — plan). **Parent pin:** composite
> MAWS commit `417b8d2d3` (re-pinned 2026-10-17 from `77e82d832` via `f60dd668b`, `896f04acc`, `bd9c67b14`, `21ba47570`, `34defe9f6`, `f5df1687d`, `a87d7fa04`, `4021c5bbb`, `52a17353e`, `d447cfe97`, `2a2e16c6f`; Decision Log; the last folds M4's tail window and provenance into §9.1). The child's section there is its design; this
> document carries only the constraints and the milestones. Before M1 read
> the composite's §9 whole, §4 as amended (the phone ruling is binding),
> the DC9 child section, the Cross-Child Contracts DX3, DX4 and DX8 with
> their **[2026-10-17]** amendments in Interfaces (DX2's and DX3's `output`
> frames, DX4's `snapshot`, `subagents`, `output` and `end` rows, its
> "History and ended sessions", "Jobs and agent status", normalization
> table, precedence and `output` paragraphs, DX8 whole), and the
> 2026-10-17 Decision Log entry with its post-review paragraph. The
> evidence behind §9 is
> `docs/doperpowers/specs/2026-10-17-desk-session-view-survey.md`, beside
> the composite. DC5's and DC6's execution documents
> (`docs/doperpowers/plans/2026-10-15-desk-dc5-web.md`,
> `2026-10-15-desk-dc6-depth.md`) record how the code under change was
> built; read DC6's Decision Log before touching `apps/desk-web/src/depth/`.

## Progress

- [x] S1 — Shared edit: the ask tool classified as a question (2026-10-17, reviewed clean: a2fc6a2c..dd7c37ab; gate 39045490193; PR SSFSKIM/MAWS#26, merged to master as 67710ddd after merging master 360f87b3, gate 39071873678)
- [~] S2 — Shared edit: shell and monitor starts and `task_status` in MAWS's backfill — **parked** (2026-10-17; branch `desk-backfill-jobs` pushed, no PR; Decision Log)
- [x] T0 — Mockups of the four taste surfaces (2026-10-17: `desk-dc9-mockups` 73ecf8f0, the owner's choices marked c73916fa)
- [x] M1 — The hub's `output`, the widened bodies, and DX8's `output()` (2026-10-17, reviewed clean: d2c8fec5..af560476, fix 7098835a..89b2e560)
- [x] M2 — The fake machine's part: the session-view recording, jobs and status, `output`, pages after the replay (2026-10-17, reviewed clean: 36131d48..6bb8bb4f, fixes 45c4d172..62c4fbd3 and 62c4fbd3..c4a17632)
- [x] M3 — The per-session owner and the session view (2026-10-17, reviewed clean: 36131d48..57320abd on `desk-dc9-m3`, fixes ..6b2ddded, ..2388b1f3, ..55c6e118; merged at 582aecfd)
- [x] M4 — The channel around the view: tail rows, the inline requests, the overlay, the end marker, the fallbacks, the retirements (2026-10-17, reviewed clean: ec8021c6..7e2bbe64, fixes b05deb29..1b05db7a and 1b05db7a..38791976)
- [x] M5 — The column: agents with real status, the jobs view, `output`, MCP names (2026-10-17, reviewed clean: 34d32461..488b7329 on `desk-dc9-m5`, merge b0b1e3ff, fix ..4cca48d8; merged at ec0e9013)
- [x] M6 — The acceptance, the phone's bundle, and the gate (2026-10-17, reviewed clean: d2772a0e..429fdbf7, fix 2adfb847..4f4495ad; gates static,unit 39080859887 and e2e:desk-web 39081425111 on 4f4495ad)

## Constraints that bind every milestone

- **The composite has one writer**, the session that dispatched this plan.
  This document's controller records this plan's decisions in its own
  Decision Log and messages that session with any decision that touches a
  contract, a residue item, or a design gap; it never edits the
  composite. DX4's producer is DC8, built in parallel in doperpowers: DC9
  builds against the contract text and DC3's fake machine, never DC8's
  code. A rule of DX4 that proves wrong goes to the composite's writer.
- **Where the code lives.** MAWS's pnpm workspace, branch `desk-dc9` in
  its own worktree, started from `origin/master`. `apps/desk-web/src/`
  (the session view, the column, the shell's DX8 types, the channel),
  `apps/desk-hub/src/protocol/` and `src/objects/project.ts` (the `output`
  frame and kind; DX4's bodies widened), `apps/desk-hub/fake-machine/`
  (the recording and the producer's part), and their tests. MAWS's own
  `src/` changes only through S1 and S2, each its own branch and PR from
  `origin/master`, never on `desk-dc9` directly; `desk-dc9` merges S1's
  branch once S1 is reviewed clean (M3 needs the classify entry for the
  ask mod's question row). Branches are merged in, never rebased.
- **Other work on master.** A titles PR (session title on line 1, alias on
  line 2: `apps/desk-web/src/views/project/Sidebar.tsx`, the depth
  column's header, the projection) is open. Nothing here edits those
  files before it merges and `origin/master` is merged into `desk-dc9`;
  the composite's writer says when. Another session commits to master
  often on unrelated work; merge `origin/master` before the final push.
- **The hub ships before any uplink answers `output`** (DX4). The hub
  change is this child's; deploying it is the composite's writer's, after
  merge. Nothing here calls the deployed hub or deploys.
- **MAWS's components are imported as they stand** (DC6's no-cut route,
  guarded by the `window.maws` lint rule): `Transcript` with `ownerLane`,
  `reportRows`, `ShellRow`, `MonitorRow`, MAWS's task graph. What MAWS's
  report needs from IPC (`ReportBar`, mark states) the desk supplies on
  its side (§9.1). MAWS's `mergeSidecars` is not changed (§9.3).
- **Transcript text is untrusted, in a page that holds the org key**
  (DC6's constraint, unchanged): text renders only through MAWS's Markdown
  and presenters with their sanitization; an output tail renders as plain
  text, never as Markdown or HTML; nothing from a row or a file reaches
  `innerHTML`, a URL that navigates this page, or a script.
- ~~**The phone never mounts the transcript** (§4 [binding — owner,
  2026-10-17]): the phone's route loads no chunk of MAWS's transcript,
  Markdown or shiki; the narrow layout draws the log-built channel.~~
  **Reversed by the owner, 2026-10-18** (Decision Log): the phone's
  direct channel is the session view a desktop draws, its fallbacks the
  desktop's (an offline machine, a subscription ended at `n` 0); no chunk
  of MAWS's transcript loads until a session channel first opens, never
  for the grid or the group chat; the depth column stays desktop-only.
- **Visual design** is MAWS's tokens and density, light first. The four
  taste surfaces — the tail row's delivery line, the request band, the end
  marker, the jobs view — go to the owner as mockups before polish (T0),
  through the composite's writer; the milestones build them functionally
  meanwhile and polish to the verdict.
- **Fixtures.** DC8 owns the shared fixture (rows → the widened
  `subagents` body and the `output` cases). Until the composite's writer
  relays its path, the fake machine's derivation is proved against a
  fixture this child writes from DX4's text; once relayed, a copy is
  vendored under `apps/desk-hub/fake-machine/` and the derivation passes
  it, any disagreement going to the composite's writer. No real session of
  the owner's is committed; shapes taken from real transcripts are
  scrubbed of paths, user names, host names and content.
- **Machine rules (bind every worker and reviewer).** Heavy commands —
  pnpm installs, builds, vitest, Playwright, typecheck — run one at a time
  inside `/tmp/maws-review/with-slot.sh <command…>`. Never call the
  deployed hub (`desk-hub.opencognita-platform.workers.dev`), never
  deploy, never read `~/.config/claude-secrets`, never print a
  credential-bearing file. Any sminos code runs under a temporary `HOME`
  and `SMINOS_HOME`; the running daemon and sessions are left alone.
  Commits by explicit paths, no `Co-Authored-By` trailer, history never
  rewritten. A denied action is reported, not worked around.
- **MAWS's gates cover the work**: `scripts/ci-gate.sh <worktree> --gates
  static,unit,probes` (class 1a on GitHub Actions) and the desk-web browser lane
  (`--gates e2e:desk-web --runner linux`); focused unit tests run locally
  under the slot. DC5's and DC6's browser suites pass, or are moved where
  this child changes what they test, with the reason in the milestone's
  report.

## Plan of Work

### S1 — The ask tool classified as a question (MAWS PR, own branch)

**At its end:** `mcp__doperpowers__AskUserQuestion` is classified as
MAWS's `question` presentation in `src/renderer/src/transcript/model/classify.ts`
(the table beside `AskUserQuestion`), with MAWS's own tests showing an
ask-mod call draws as a question row in the transcript and stays in view
in the report. Branch `desk-ask-classify` from `origin/master`, in its own
worktree; reviewed on its own (`doperpowers:reviewer-medium`); PR opened
against `master`, not merged. Before editing, check how MAWS's question row
reads the call's input and result for `AskUserQuestion` and whether the ask
mod's input (`questions[]` plus `async`) and its result text fit it; a
shape that does not fit is handled in the row's reading, not by renaming.

**Touches:** `src/renderer/src/transcript/model/classify.ts` and what the
question row needs to read the ask mod's input and result; their tests.

### S2 — Shell and monitor starts, and `task_status`, in MAWS's backfill (MAWS PR, own branch)

**At its end:** `src/engine-host/fs/backfill.ts` emits, from a disk
transcript, `task.started` of a `local_bash` for a Bash result whose
`toolUseResult.backgroundTaskId` is set (command, description, output
file from "Output is being written to:", background), `task.started` of a
monitor for a Monitor result's `toolUseResult.taskId`, and a status patch
for a `task_status` attachment, through the normalization MAWS already
applies (`parseTaskNotification`); MAWS's own disk-only sessions then show
shells and monitors as its live sessions do. Branch `desk-backfill-jobs`
from `origin/master`, own worktree; reviewed on its own
(`doperpowers:reviewer-medium`); PR against `master`, not merged. The
event shapes follow what MAWS's live normalizer emits for the same tasks
(`engine-host/normalizer-system.ts`), so the task graph treats a
backfilled shell as a live one.

**Touches:** `src/engine-host/fs/backfill.ts` and its tests; nothing in
the renderer unless a test proves the graph needs it.

### T0 — Mockups of the taste surfaces

**At its end:** `mockups/desk/09-session-view.html` (static HTML in MAWS's
tokens, beside DC5's `01`–`05`) shows the session view with: a tail row
for a send in each delivery state (`queued`, `delivered` waiting for its
row, `recorded`, `refused-read-only`, `failed` with a reason,
`uncertain`); the request band above the composer with a permission and a
question card; an ended session's end marker with Resume and a retired
one's; the column's jobs view (a running shell with Output, an ended
shell, a monitor with no output file yet, the MCP names). A screenshot of
each surface at desktop width under `mockups/desk/09-session-view/`. Built
in its own worktree on branch `desk-dc9-mockups` from `origin/master` and
merged into `desk-dc9`; the controller sends the screenshot paths to the
composite's writer. Two alternatives where a surface has a real choice
(the delivery line's placement; band vs. inline for many requests), named
in the file.

### M1 — The hub's `output`, the widened bodies, and DX8's `output()`

**At its end:** `desk-hub/protocol` carries DX3's `output {sub, taskId,
tail}` up (shape-checked: `taskId` `[A-Za-z0-9_-]{1,64}`, `tail` an
integer 1 to 524288, else `bad-shape`), DX2's `output {project, session,
agentId, sub, taskId, tail}` down, and DX4's `output` kind in
`SUBSCRIPTION_KINDS` with its four variants typed as a discriminated
union (`ok`, `missing`, `refused`, `unknown-task`; `missing.path` is
`string | null`, null for a known task whose `outputFile` is still null —
the second review's correction, Decision Log); the `subagents` body
and the snapshot are widened as DX4's `subagents` row says (`status`,
`evidence`, `running?`, `spawn?`, `outcome?`, `file?`; `jobs: Job[]`;
`mcp: {name}[]`), the new fields optional on the wire where a producer
older than DC8 omits them, so the hub and the web accept both. The
`Project` object routes `output` as it routes `rows` (`ownRoute`, the
lease check) to the route's machine with its `agentId`, and relays the
`output` kind unread. DX8's `Subscription` gains `output(taskId, tail)`,
the hub client sends it and passes the `output` message through, and the
DX8 double in `apps/desk-web/test/double/` carries it.

**Proves:** `apps/desk-hub/test/session-plane.test.ts` covers the frame up
(valid on a main and an agent sub, refused `bad-shape` out of form, not
forwarded without a fresh lease) and the kind down (relayed to the one
socket holding the sub, numbered as the machine numbered it); the
protocol's type tests show a `subagents` body of each producer age
typechecks; desk-web's `project-client.test.ts` covers `output()` and the
`output` message.

**Touches:** `apps/desk-hub/src/protocol/{browser,machine,session}.ts`,
`apps/desk-hub/src/objects/project.ts`, their tests;
`apps/desk-web/src/shell/session-plane.ts`,
`apps/desk-web/src/hub/project-client.ts`, the test double.

### M2 — The fake machine's part

**At its end:**
- **The recording** `session-view` (decision below): the committed
  `two-subagents` extended with synthesized rows in engine 2.1.300's
  shapes — a `<message>` turn; a nested agent (spawned by one of the two
  subagents, its result and notification in its parent agent's
  transcript); a background Bash and a Monitor started early, with their
  task-notifications, a `task_status`, and a `TaskStop`; an async question
  from the ask mod (`mcp__doperpowers__AskUserQuestion`, `toolu_plugin_…`
  request, `toolUseId` naming the call) with its log `question` and
  `answered` events; a send recorded undelivered (its log `human` event and
  its `recorded` delivery); `mcp_instructions_delta` attachments; enough
  older history that the transcript is more than one snapshot at the
  budget the acceptance uses; `tasks/<taskId>.output` files for the shell
  (one present, one named but absent, one whose row names a path that
  fails containment).
- **Jobs and status.** `SessionDepth` carries the widened `subagents` body
  in the snapshot and in each `subagents` message, derived from the
  recording's rows by DX4's rules: the one normalization table, the
  precedence as the second review restated it (Decision Log; the fake has no bridge state beyond what its recording's
  timeline declares; a module-reload case is a recorded seed), nested
  agents from their parent's transcript, `exited` once the replayed session
  ends, `jobs` and `mcp`. A `subagents` message is sent whenever any of it
  changes as the replay proceeds.
- **`output`.** The fake answers DX2 `output` on the sub with each DX4
  variant: `ok` (the last `tail` bytes, cut forward to a line break when
  the window does not start the file, `from`, `size`, `truncated`),
  `missing` (a path that passed and is not there, or `path: null` for a
  known task whose `outputFile` is still null), `unknown-task`, `refused`
  with its reason, containment only (a path that does not carry
  `<session>/tasks/<taskId>.output`, or one outside the recording's tasks
  directory once resolved; where the fake models a canonical root it uses
  DX4's set of roots, not one); `FakeMachineReplay`
  (desk-web's e2e double) answers it the same way.
- **After the replay.** A subscription stays open and answers `rows` (and
  `output`) after the replayed session ends; the fake sends
  `end {session-ended}` only at `n` 0 for a session it does not hold.

**Decisions:** the derivation is one module of pure functions over rows
(plus each agent's own rows for nested outcomes), so the shared fixture
can pin it directly. Until DC8's fixture is relayed, a fixture of this
child's own (rows → expected body; DX4's every raw word, the module-reload
case, a nested agent whose parent still runs and one under an ended
parent (`exited`), a cold open of an ended session holding an agent with a
`running` status and no completion notification (`exited`), an unknown
task, a deleted output file (`missing` with its path), a monitor just
started with no path (`missing` with `path: null`)) pins it. Each synthesized row is copied from a real transcript
row's shape (a background Bash, a Monitor, a task-notification, a
`task_status`, an `mcp_instructions_delta`, an agent's rows), scrubbed,
never invented; the Decision Log names where each shape came from, and the
rows are aligned with DC8's fixture once it lands. The precedence gives a
cold open and an already-open subscription the same status for the same
rows.

**Proves:** the fake machine's tests: the derivation against the fixture;
each `output` variant; `rows` answered after the replay's end to the first
row; `two-subagents`' existing tests unchanged.

**Touches:** `apps/desk-hub/fake-machine/**` (the recording under
`recordings/session-view/`), `apps/desk-hub/test/fake-machine/`,
`apps/desk-web/e2e/fake-machine.ts`.

### M3 — The per-session owner and the session view

Starts after the titles PR (MAWS #25, master `6a677a8d`) is merged into this branch.

**At its end:**
- **One owner per (machine, session).** The session's main `DeskTranscript`
  is held by a small store, reference-counted by the views holding it (the
  center's session view and the column), opened at the first hold and
  closed, its store key dropped, at the last release; the open-agent
  request (`openSubagent`) and the status word live on it. The column's
  Transcript tab goes; Subagents, Diff and Info read the shared owner; the
  status word moves to the center's header.
- **The session view.** On a desktop browser whose session's machine is
  online, a direct channel's center is `<Transcript ownerLane>` over the
  shared owner's source: the report (MAWS's `reportRows`) by default, a
  Report · Transcript toggle of the desk's own calling the transcript
  store's `setView`, the choice kept per session as MAWS keeps it. The
  composer stays below it (DC5's, unchanged).
- **Streaming in the report** (§9.1, "Streaming in the report"): a
  main-loop streaming block belongs to the turn of the latest prompt row,
  and its text is that turn's live buffer for the block, so a marked
  response folds its turn and its mark shows while it streams; settlement
  and de-duplication stay DC6's (the `block-row`'s row replaces the live
  row; a settled block's chunks are ignored). The means is this
  milestone's decision, recorded with what lost — whether the desk's
  layer gives its tail rows the turn and a live mark the projection reads,
  or the store's turn is given the live buffer, MAWS's reducer and store
  unchanged either way (DC6's settling decision stands).
- **History in the center.** Older rows page in at the top through DC6's
  `older-pages` and `keep-place`, now in the center, until the first row;
  the view never stalls while a page is out.
- **An ended session stays pageable.** A subscription is kept while the
  view is open whether or not the session runs; liveness is read from
  `presence` (DX8), never from the subscription; `session-ended` after a
  snapshot (a daemon older than DC8) is treated as DC6 treated it.

**Proves:** unit tests for the owner's reference counting (two holders,
one subscription; last release closes and drops the key), the toggle, and
the streaming bridge (a marked block folds its turn before its first row
flushes; unmarked streaming text later in an already-marked turn stays
inside the record; the live row is gone when the `block-row`'s row lands,
no double); browser tests against the fake machine for the report, the
toggle and back, a reload drawing the same rows, paging to the first row on
a live session and on one that ended while open. DC6's depth suites still
pass, moved to the center where they tested the Transcript tab.

**Touches:** `apps/desk-web/src/depth/**` (the owner, the column),
`apps/desk-web/src/views/project/{ProjectView,ChannelView}.tsx` and a new
session view beside them; `apps/desk-web/e2e/`.

### M4 — The channel around the view

**At its end:**
- **Tail rows.** Each send to the session not yet matched to a user row of
  the transcript — an outbox item, or a `human` event addressed to the
  session — is a tail row in MAWS's held-prompt shape (`heldRow`), passed
  as `Transcript`'s `tail`, drawn as the owner chose (1B, Decision Log):
  the bubble identical to MAWS's `UserRow` but for a foot under a hairline
  carrying the state (DX4 `delivery`; an RPC's `uncertain`) and, for a
  send that will not arrive (`recorded`, `refused-read-only`, `failed`), a
  tint of the whole bubble; the foot is a separate component with a small
  props surface (state, short words, reason), long reasons in its tooltip,
  so it can later move into MAWS's `UserRow` (not edited in this round). It stays, whatever the delivery state says,
  until its own user row is observed; matching is one to one and only by
  identity (Decision Log, the second review): the delivery frame's first
  line naming the send's `(writer, seq)` (`[sminos chat <project>
  <writer_short>:<seq> from human → @you…]`, with `hub/<member>:<seq>` for
  a web send; `compose_chat_frame`, `event_ref`, `writer_short` in
  doperpowers' `sminos.py` give the exact grammar); an exact row uuid
  would also do, but `delivered.uuid` is not carried to the web (Decision
  Log, `34defe9f6`), so a uuid path is kept only if it costs nothing. There is no text-containment
  fallback: a row without a frame (a prompt typed at the terminal) never
  matches a web send. A send whose row never arrives because the session
  ends first stays as a delivered entry at the tail, ahead of the end
  marker, never silently hidden. A send whose delivery ends `failed`,
  `refused-read-only` or `recorded` keeps its tail row with that state; a
  second outcome for the same key (`failed` after `delivered`) replaces
  the first.
- **The requests, inline at the tail** (the owner's verdict, 2B,
  superseding the band). The hub's pending requests for the session are
  DC5's request cards drawn as the transcript's last rows, after any tail
  sends, scrolling with it, answerable in place, leaving when settled;
  never folded inside a closed working record (they sit after the last
  one). A reader scrolled up gets an "N waiting ↓" pill that jumps to
  them.
- **The ask mod's question** draws from its transcript row (S1's classify
  entry, merged in), with the log's `question` and `answered` events
  overlaid, joined by the event's `src` (the call's tool-use id): while
  pending the row says "Waiting for your answer · below" (its card is at
  the tail), and once answered it carries the log's answer.
- **The end marker.** An ended or retired session's view carries one
  marker row at its tail, with Resume (or who retired it) as the channel's
  header offers today.
- **The fallbacks.** An offline machine, a subscription ended at `n` 0 (no
  transcript for the session on that machine; the view says why), and the
  phone layout draw the log-built stream (`buildStream`, DC5's), whose
  folds are labels, never buttons: "Working record · <machine> is offline"
  and, on the phone, "Working record · on a computer". The group chat is
  unchanged. (Since 2026-10-18 the phone draws the session view and keeps
  only the desktop's two fallbacks; Decision Log.)
- **The retirements.** `FoldTranscript`, `depth/source/range.ts`,
  `export-marks.ts`, `depth/view/unfold-turns.ts`, DX8's `transcript` slot
  (its props type, its fallback, its registration in `connectDepth()`),
  and the folds' button path in `StreamView` are deleted with their tests;
  `connectDepth()` registers `depth` alone; this document's Decision Log
  records DX8's amendment as built, for the composite's writer to fold.

**Proves:** unit tests for the matcher (the acceptance cases — the
`delivered` outcome before the row; two identical sends each consuming its
own framed row; a submission delayed then refused keeping its tail row as
`failed` — plus a frame naming another send, an exact-uuid match, and the
second review's case: an earlier terminal prompt "continue", then a web
send "continue" acknowledged while the session is busy, whose tail row
stays until its own framed row arrives; a send whose row never arrives
because the session ended first, kept ahead of the end marker); browser tests for the inline requests (a permission
and a question answered, cards gone), the overlay, the end marker with
Resume, each fallback, and the phone drawing no transcript; DC5's
conversation and phone suites pass.

**Touches:** `apps/desk-web/src/views/{project,conversation,requests}/`,
`apps/desk-web/src/conversation/`, the session view, `apps/desk-web/src/depth/`
(deletions), `apps/desk-web/src/shell/{slots,slot-fallbacks}.*`,
`apps/desk-web/src/depth/connect.ts`.

### M5 — The column: agents with real status, jobs, `output`, MCP

**At its end:**
- **Subagents with real status.** `depth/agents/task-feed.ts` patches each
  node's status on the desk side from the widened `subagents` body: DX4's
  `status` replaces `unknown` (never a status the held rows' events
  already made terminal, by DX4's precedence as the second review restated
  it), a nested agent sits under
  the parent its meta or spawn record names, and no recorded agent sits
  under "On disk / status unavailable"; an entry DX4 leaves `unknown` (the
  three cases §9.3 names) is shown as such. A producer older than DC8
  (`agentId` and `meta` alone) draws as DC6 drew it.
- **An Agent row in the center opens the column's Subagents tab on that
  agent**, through the owner's open-agent request (the column opened if it
  was closed).
- **The jobs view**, a tab beside Subagents, Diff and Info: the `jobs` of
  the main subscription drawn with MAWS's `ShellRow` and `MonitorRow`
  (`tools/agents/background/TaskRows.tsx`), adapting a `Job` to what they
  read; a shell's Output asks `output(taskId, tail)` and draws the answer
  by variant as DX4's consumer paragraph says (`ok` the tail as plain text
  with how many bytes precede it; `missing` keeps the row's summary, and
  with `path: null` (no file named yet) it may be asked again once a later
  `subagents` names the job's `outputFile`;
  `refused` its reason, no retry; `unknown-task` waits for the next
  `subagents` to carry the task, then says the task is unknown); the MCP
  names listed below.
- **Agent-message rows name their agent.** MAWS's `agent_message` row reads
  a raw id ("To @ a912e224…"); where a desk-side seam can give it the
  agent's description or type from the tree without editing MAWS, it
  does, else a tech-debt row for the MAWS app (maws-fe).

**Proves:** unit tests for the patch (each DX4 status and evidence,
nested placement, precedence over held-row events, an old producer's
body), and the job adapter; browser tests against the fake machine for
the tree (the nested agent under its parent, every agent's status, none
under "On disk"), an Agent row opening its agent in the column, the jobs
view with the shell's Output in each variant, the MCP names. DC6's
subagent, diff and info suites pass over the shared subscription.

**Touches:** `apps/desk-web/src/depth/**`; `apps/desk-web/e2e/`.

### M6 — The acceptance, the phone's bundle, and the gate

**At its end:** DC9's acceptance, G1 to G5 every clause, passes in a real
browser against the fake machine replaying `session-view` (G6 is S1 and
S2's PRs); the phone's route measured (`e2e/phone-load.spec.ts` or its
successor) loading no chunk carrying MAWS's transcript, Markdown or shiki
(since 2026-10-18: none until a session channel opens; Decision Log);
DC5's group-chat tests unchanged; the gate green (`static,unit` and
`e2e:desk-web` on the Linux lane); the taste surfaces polished to the
owner's verdict on T0. A screenshot set of the session view, the inline requests,
the end marker and the jobs view under the workspace for the composite's
writer.

M6 also polishes from the owner's review of M4: the `[sminos chat …]`
frame line is stripped from the display of a row matched to the owner's
own send (its bubble already says who wrote it), and a row a peer
delivered keeps who sent it — its frame line drawn as a compact sender
label from the frame's `from` — the text the session read unchanged in
both; a landing on a message (not only a request) marks its row in the
session view. And a job's `missing` with `path: null` says plainly that
no output file was named when the job is terminal or the session has
ended (no "asks again"); the retry wording stays for a running job in a
live session.

G2's proof pages across a compaction boundary: rows before a
`compact_boundary` in the same transcript file load and draw above MAWS's
"Compacted earlier" divider, never stopping there (the owner's ask is the
full history), on a committed synthetic recording — never one derived
from the owner's transcripts. The acceptance also asserts that a session
whose last turn has its `system/turn_duration` row reads as finished (no
"working" divider or dots), pinning the narrowed debt row.

**Touches:** `apps/desk-web/e2e/` and whatever the acceptance finds.

## Concrete Steps

From this child's worktree root (`/tmp/desk-dc9`):

    /tmp/maws-review/with-slot.sh pnpm install
    /tmp/maws-review/with-slot.sh pnpm --filter desk-hub test
    /tmp/maws-review/with-slot.sh pnpm --filter desk-web test
    /tmp/maws-review/with-slot.sh pnpm typecheck
    /tmp/maws-review/with-slot.sh pnpm lint
    scripts/ci-gate.sh "$PWD" --gates static,unit
    scripts/ci-gate.sh "$PWD" --gates e2e:desk-web --runner linux

## Interfaces and Dependencies

Consumes DX3, DX4 and DX8 as amended 2026-10-17 (the composite at
`77e82d832`), DC3's fake machine and its `two-subagents` recording, DC5's
channel, composer and request cards, DC6's depth adapter, and MAWS's
report (`owner/report/`), transcript store and `TaskRows`. Produces the
hub's `output` frame and kind (deployed by the composite's writer before
any uplink answers it), the fake machine's widened bodies and `output`,
and DX8's amendment (the `transcript` slot retired, `Subscription.output`,
the depth tabs). Pending from DC8: the shared fixture's path (the
composite's writer relays it; M2 vendors a copy).

Milestone order: M2 consumes M1's types; M3 consumes M1's widened
snapshot and S1's classify entry by M4; M4 consumes M3's view; M5 consumes
M1, M2 and M3's owner; M6 consumes all. S1, S2 and T0 run beside the loop
in their own worktrees.

## Decision Log

- Decision: Verification. Each milestone gets the subagent-driven
  execution's task review at its boundary; S1 and S2 each get their own
  review (`doperpowers:reviewer-medium`) before their PRs open; the branch
  gets an **xhigh** whole-branch panel through `doperpowers:review-code`,
  handed up to the composite's writer with the pinned range (a subagent
  holds no Workflow tool). Rationale: the branch spans the hub's protocol
  (a frame and a kind every machine will meet), the fake machine's
  producer, and the desk's central view in a page that holds the org key —
  DC3's and DC5's size, which took xhigh.
  Date/Author: 2026-10-17, controller (the composite's writer named xhigh
  for a panel-sized range).
- Decision: The acceptance recording is `session-view`, the committed
  `two-subagents` extended with synthesized rows, not a fresh
  `record.py` run. A fresh recording needs a live engine with the
  doperpowers ask mod and bridge loaded under a temporary home, a nested
  agent, background jobs and an undelivered send all in one session —
  model calls and nondeterminism for shapes DX4 and the survey already
  pin; `two-subagents` stays as it is, since DC5's and DC6's suites read
  it. The synthesized rows take engine 2.1.300's shapes from DX4's text and
  from real transcripts read only for shape, scrubbed.
  Date/Author: 2026-10-17, controller (DC9's call, per its child section).
- Decision: S1 and S2 are built on their own branches from `origin/master`
  in their own worktrees, beside the loop, and reviewed on their own; S1's
  branch is merged into `desk-dc9` once clean, since the ask mod's question
  row in the session view needs it (M4). DC9's PR then says it carries
  S1's commit and lands after S1's PR. S2 is independent of the desk.
  Date/Author: 2026-10-17, controller.
- Decision: T0's mockups are static HTML beside DC5's in `mockups/desk/`,
  made at the start in their own worktree so the owner's verdict arrives
  while M1–M3 run; M4 and M5 build the surfaces functionally and M6
  polishes them to the verdict.
  Date/Author: 2026-10-17, controller.

- Decision: The second adversarial review of the composite
  (`4943edea9..77e82d832`, spec edits in flight from the composite's
  writer) corrects three rules, built to now: (1) §9.1, a web send's tail
  row matches only by the event identity its delivery frame carries or by
  an exact row uuid — no ordered text-containment fallback, and an
  unframed (terminal-typed) row never matches a web send; the tail row
  stays until its own row arrives. (2) DX4's status precedence, highest
  first: an explicit terminal outcome in a row; then known process death
  (the session's process gone, the parent agent ended, or the bridge
  stopped without a terminal word), giving `exited`; then running or
  pending evidence; then `unknown` only with no evidence. Cached
  bridge-running evidence stops counting once the process is gone, and a
  cold open and an already-open view agree. (3) DX4 `output`: a known task
  whose `outputFile` is null answers `missing` with `path: null`, retry
  eligible once a later update supplies a path; `refused` is the
  containment refusal only. Also a condition on the `session-view`
  recording: each synthesized row is copied from a real row shape, its
  source named here, and aligned with DC8's fixture when it lands.
  Supersedes the plan's earlier matcher and `missing` wording (M1, M2, M4,
  M5 edited in place).
  Date/Author: 2026-10-17, the composite's writer, folded by the controller.
- Decision: Parent re-pinned to `f60dd668b` (composite smns-erb), which
  writes the three corrections above into §9.1, §9.3, §9.4, DC9.G1 (five
  tail-row cases, the fifth a send whose row never comes, kept ahead of
  the end marker), DC9.G5 (the fixture's cases: a cold open of an ended
  session with a `running` agent, a nested agent under an ended parent, a
  monitor answering `missing` with `path: null`), DX4's `output` row and
  "Precedence" (the producer re-derives every entry when the process goes;
  accepted residual: a background agent resumed after its notification
  shows `completed` until its next notification). Nothing else changed.
  Date/Author: 2026-10-17, controller.
- Decision: Parent re-pinned to `896f04acc`, two DX4 additions DC8 found:
  (1) a background agent's launch result (`toolUseResult.status`
  `"async_launched"`) is `running` evidence from the rows at precedence
  (3), carried as `outcome {status: "running", raw: "async_launched"}`,
  and process death still turns it `exited` — M2's derivation reads it;
  (2) the `output` containment root is a set (the slugs of the
  transcript's directory, the joined cwd and the session record's cwd,
  plus `adoptShellOutputRoot`) — a machine-side matter, which the fake
  follows where it models containment. Both are cases in DC8's shared
  fixture.
  Date/Author: 2026-10-17, controller (the composite's writer's notice).

- Decision (T0, mockups at `desk-dc9-mockups` 73ecf8f03, sent to the
  owner through the composite's writer): the recommended variants are 1A
  (the delivery line under the bubble, MAWS's held caption; in-flight
  sends dimmed, ended ones full strength with a coloured caption; words
  extending DC5's `DELIVERY_TEXT`), 2A (the band above the composer; with
  many requests the oldest stays open, the rest fold to one line each), the
  end marker in MAWS's boundary-row shape with a second Resume, and 4A (a
  shell's output under its row; tab "Jobs · N running", Shells, Monitors,
  "MCP servers · N"). An ask-mod async question pending in the band draws
  its transcript row pointing to the band, and the log's answer once
  answered. A job's Stop draws disabled with its reason ("Stopping a job
  runs from its terminal"): web Stop is optional in §9.4 and has no DX6
  RPC, so it is residue. M4–M6 polish to the owner's verdict when it comes.
  Date/Author: 2026-10-17, controller. **Superseded in part** by the
  owner's verdicts below (1B, 2B).
- Decision: **The owner's verdicts on T0, 2026-10-17** (through the
  composite's writer; the composite's §9.1 is being amended for 1B and
  2B): (1) the delivery line is **1B**, inside the bubble — the state in
  the bubble's foot under a hairline, a send that will not arrive tinting
  the whole bubble; the bubble stays identical to MAWS's `UserRow` apart
  from the foot and tint, the foot a separate component with a small props
  surface (state, short words, reason), long reasons in the tooltip, so it
  can later move into MAWS's `UserRow` (the owner wants to propose the
  style to the app; `UserRow` is not edited in this round); (2) requests
  are **2B**, inline at the transcript's tail — the cards are the
  transcript's last rows, after any tail sends, scrolling with it, never
  folded inside a closed record, with an "N waiting ↓" pill for a reader
  scrolled up; the ask mod's question row reads "Waiting for your answer ·
  below" while pending and carries the log's answer once answered; (3) job
  output is **4A**, under its row; (4) web Stop draws disabled with the
  reason on hover, and becomes a follow-up right after DC8 and DC9 land
  (DX6 RPC, hub route, machine side) — residue in the report; (5) the end
  marker as drawn. The mockup page is updated to the chosen alternatives
  when convenient (not a gate).
  Date/Author: 2026-10-17, the owner via the composite's writer.

- Decision: The titles PR (MAWS #25, master `6a677a8d`) has merged:
  Sidebar, ChannelView, StreamView, DepthColumn, SubagentDetail,
  RequestCard, Composer, completion, the projection and a new
  `shell/SessionLabel.tsx` changed. `desk-dc9` merges `origin/master` at
  or after `6a677a8d` before M3 dispatches. Every new surface that names a
  session (the tail bubbles, the inline request cards, the end marker, the
  center's header) names it through `SessionLabel`, title first and alias
  muted, as the title rule says.
  Date/Author: 2026-10-17, the composite's writer, folded by the controller.

- Decision: Parent re-pinned to `bd9c67b14`, which writes the owner's T0
  verdicts into the composite (§9.1 the tail bubble's foot and tint and
  the inline requests with the "N waiting ↓" pill; §9.4 output under its
  row, Stop disabled with its reason and web Stop the first follow-up;
  DC9.G1 "answered from their cards at the tail"). This document already
  carries them (the owner's verdicts entry above).
  Date/Author: 2026-10-17, controller.

- Decision: DC8's shared fixture is `tests/sminos/dx4-jobs.json` at
  doperpowers `38a45f6b` (branch `desk-dc8`; its runner
  `tests/sminos/jobs_parity.py`, 65/65): 13 body cases and 17 output cases
  with explicit inputs (main rows, agent rows with size and mtime, metas,
  the bridge state or null, whether the session runs, roots under a
  placeholder). M2 vendors a copy under `apps/desk-hub/fake-machine/`
  (with a note of its source commit), and the fake's derivation passes
  every case; its `about` field binds where DX4's prose is open
  (unrecognized raw words, an Agent result's raw word, tie order within a
  precedence level, a job's `startedAt`/`endedAt`/`summary`, MCP removals
  before additions, an output window with no line break not cut). Two
  contract notes: containment is exact (the target's realpath equals
  `<realpath root>/<taskId>.output`), and a `$.agent.list()` seed carries
  no `name`. The `session-view` recording's synthesized rows take the
  fixture's row shapes. The fixture may change in one place (an expired
  monitor ends rather than staying `running`); the composite's writer
  relays the commit, and M2 or a later fix re-vendors it. A copy for the
  executors is at `.doperpowers/sde/2026-10-17-desk-dc9-session-view/dc8/`.
  Date/Author: 2026-10-17, the composite's writer, folded by the controller.

- Decision (M1, as built at `af5604760`): the widened entry keeps the
  name `SubagentMeta` (about ten desk-web files use it; `SubagentEntry`
  collides with MAWS's name in `task-feed.ts`), typed `{agentId, meta} &
  (SubagentStatusFacts | none of them)`, so `status` and `evidence` come
  together (a DC8 producer) or not at all (an older one); `jobs` and `mcp`
  are optional on the snapshot and the `subagents` body. Open field types:
  `SubagentSpawn` follows the bridge's emit (`parentAgentId` and `name`
  `string | null`, `toolUseId?` `string | null`, `background` and `model`
  optional for the seed); `outcome.status` the full status set;
  `file.firstAt`/`lastAt` `string | null`; a job's `startedAt`/`endedAt`
  strings — to be confirmed against DC8's fixture at M2. The bounds
  (`OUTPUT_TAIL_MAX`, `isTaskId`, `isOutputTail`) live in
  `protocol/browser.ts`, shared by the hub, the client and the double; the
  client clamps `tail` and sends nothing for an invalid task id, as it
  clamps `rows`. The hub double shape-checks `output` and leaves answering
  to the test; until M2 the fake machine passes `output` by, as a daemon
  older than DC8 does.
  Date/Author: 2026-10-17, M1 executor, folded by the controller.

- Decision: DC8's fixture moves to doperpowers `8b34237b` (reviewed with
  DC8's M1; `origin/desk-dc8` head `67ef2193`; `jobs_parity` 68/68), which
  replaces `38a45f6b` — vendor this one only. What matters for the fake:
  the `about` states the launch rule alone (an `async_launched` result is
  running evidence, raw `async_launched`, precedence 3); a new case,
  monitors that expire — for a task the ledger holds as a monitor, a
  statusless notification whose `<event>` begins `[Monitor expired after `
  or is `[Monitor timed out` is `completed`, raw `expired`, `endedAt` at
  the notice, `summary` the event text, while a plain event notice, the
  same line on a shell, and a literal status word `expired` elsewhere
  change nothing; the machine's descriptor check after open is the
  machine's own, and the fake needs only the static exact-containment rule
  the fixture pins. The executors' copy at
  `.doperpowers/sde/2026-10-17-desk-dc9-session-view/dc8/` is refreshed.
  Date/Author: 2026-10-17, the composite's writer, folded by the controller.

- Decision (M1 fix): `SubagentSpawn.name` is optional (a `$.agent.list()`
  seed carries none); every body and output case of DC8's fixture at
  `8b34237b` typechecks against the protocol types (a throwaway check). The
  fixture's `refused` cases leave `reason` out of their `expect` — its
  `about` compares `reason` only as a non-empty string, and DC8's runner
  pops it — so M2's vendored runner does the same, while `TaskOutput`
  keeps `reason` required.
  Date/Author: 2026-10-17, M1 executor, folded by the controller.

- Decision: `desk-dc9` merged `origin/master` (the titles PR and the
  architect's work), S1's `desk-ask-classify` (reviewed clean) and the
  mockups branch at `8a1890125`. M2 and M3 then run at once, each in its
  own worktree — M2 in `/tmp/desk-dc9`, M3 in `/tmp/desk-dc9-m3` on branch
  `desk-dc9-m3`, merged back into `desk-dc9` after its review — since they
  touch disjoint trees (M2 the hub's fake machine, M3 desk-web's view and
  column). Their one shared file, `apps/desk-web/e2e/fake-machine.ts`, is
  M2's; M3's browser tests run on the committed `two-subagents` recording
  and leave that file alone, and M4 onward moves to `session-view`.
  Date/Author: 2026-10-17, controller.

- Decision: **S2 is parked**, not landed. Its review found that the
  backfilled job events never reach the MAWS app's production
  background-task store: a disk-only session reads sidecars and workflow
  runs only, rejects seq-null events, and BackgroundTool hides a job with
  no engine status. So the backfill alone does not deliver §9.5's one
  purpose ("so MAWS's own disk-only sessions gain them"), the desk does not
  consume it, and landing it would put a half-feature on master against
  C8b's product line ("known only while the session runs here"). The
  branch `desk-backfill-jobs` is pushed with its fixes (monitor expiry,
  re-delivery) and no PR; the whole feature is one MAWS-app follow-up in
  the report's residue (the backfill, a disk-only `session.events` read
  reversing C8b's documented line, an exited rule for disk-only sessions,
  BackgroundTool's live gate and product line dropped, Stop hidden for
  reconstructed jobs). DC9.G6 is S1's one PR (#26), which depends on
  nothing in S2. The live path's `local_bash` mismatch is kept as a
  tech-debt row on this branch, so it reaches master with DC9. M5 imports
  `TaskRows.tsx` with Stop drawn disabled with its reason, as decided.
  Date/Author: 2026-10-17, the composite's writer (composite amendment to
  §9.5, DC9.G6 in flight), folded by the controller.

- Decision: Parent re-pinned to `21ba47570`: §9.5 records the backfill
  edit leaving DC9, DC9.G6 is one shared PR (S1), with its Decision Log
  entry — what the S2-parked entry above already carries.
  Date/Author: 2026-10-17, controller.

- Decision (M2, as built at `6bb8bb4fb`): the widened body and `output`
  sit behind `producer: 'dc8'` (on `SessionDepth`, `FakeMachine`, the
  command's `--producer`, and `FakeMachineReplay`); the default `'dc3'`
  keeps `two-subagents`' behaviour and gives M5 an older producer to test
  against. Containment: one canonical root per slug of DX4's set
  (`/private/tmp/claude-501/<slug>/<session>/tasks/`), mapped onto the
  recording's `tasks/`, checked by the same `answerOutput` the fixture
  pins; `output` answers from the subscription's own loop. File facts are
  the rows' bytes and the last row's time, deterministic. The bridge's
  agent state comes only from the timeline (`agent` spawn and stop; a
  `snapshot`/`resync` `agents` step as the reload seed). `session-view` is
  built by a committed, deterministic `session-view.py`; its synthesized
  rows are released by `row-seen` events merged by time, and
  `recorded.json` lists every synthesized row's uuid by group with its
  source. **Where each shape came from:** DC8's fixture first (background
  Bash calls and results, Monitor calls and results, completion notices,
  statusless monitor events, `task_status`, the `killed` notice, nested
  metas); `two-subagents`' own rows (the Agent call, the `async_launched`
  result and row envelopes, `mcp_instructions_delta`, DX5 `agent` events);
  real 2.1.300 transcripts read for shape only, scrubbed (the ask mod's
  async call and result text, the plugin-prompt delivery row, `TaskStop`
  results, the `queued_command` and `task_status` envelopes, a Read
  result); sminos code (the log's `question`/`answered`, `human`, the
  `recorded` reason). The vendored fixture (`fake-machine/dx4/`) passes
  60/60 checks (the table, 14 body cases by `subagents`/`jobs`/`mcp`, 17
  output cases).
  Date/Author: 2026-10-17, M2 executor, folded by the controller.

- Decision: Parent re-pinned to `34defe9f6` (via `99d3ec713`): DX4 names
  both notification forms (the `queued_command` attachment and a plain
  user row whose text is the notification), DC8's plane reads both and the
  shared fixture gains a plain-row case (its commit to be relayed; the fake
  keeps reading both). The bridge's `delivered.uuid` stays on the bridge's
  stream and is not carried to the web (deferred), so M4's matcher goes by
  the frame's `(writer, seq)` in practice and keeps a uuid path only if it
  costs nothing. The DX5 seed carries `name?` when the engine's list has
  one, which the optional `spawn.name` fits.
  Date/Author: 2026-10-17, controller (the composite's writer's notice).

- Decision: DC8's fixture moves to doperpowers `b7511dd9` (`jobs_parity`
  71/71), with the case "notifications as plain rows". A plain row is a
  task-notification only when it is a user row, its `origin.kind` is
  `task-notification`, and its text starts with `<task-notification>` or
  with the engine's `[SYSTEM NOTIFICATION - NOT USER INPUT]` preamble, a
  blank line, then the notification (the form subagent transcripts write,
  with `isMeta: true`); it feeds the same derivation as the attachment
  (agents, jobs, monitor expiry). The case holds an agent ending on a plain
  row, a nested agent ending on a preamble-form row in its parent's file, a
  shell failing, a monitor expiring, a monitor event that changes nothing,
  and three forgeries that change nothing (a typed prompt, a peer message,
  text before the notification). The fake's derivation requires the
  origin — stricter than MAWS's start-only check — and reads the preamble
  form; M2's fix wave re-vendors this fixture. (MAWS's backfill misses the
  preamble form too; that belongs to the parked S2 follow-up.)
  Date/Author: 2026-10-17, the composite's writer relaying DC8, folded by
  the controller.

- Decision (M2 fix waves): under the DC8 producer an agent joins the tree
  at its spawn, a seed naming it, or its first row, whichever comes first
  (DC3's still only at a spawn); an agent-scope sub carries that agent's
  own `jobs` and `mcp` in its snapshot and updates (its agent list stays
  empty); `output` resolves the named path as the filesystem does —
  component by component, every symlink expanded where it stands, dangling
  ones included, `..` applied to the resolved prefix, at most 32 links,
  refused on any lookup failure but "no such file" or on `..` past a
  missing component — and opens the path it checked; the normalization
  table is an own-property lookup; a plain-row notification needs the
  engine's `origin.kind` (two-subagents' own rows carry it).
  Date/Author: 2026-10-17, M2 executor, folded by the controller.

- Decision (M3, as built at `57320abdb` on `desk-dc9-m3`): the streaming
  bridge is the desk's layer — its tail rows carry the turn, and a marked
  live text is handed to MAWS's projection as settled text of the same
  words (`live: false`, its open marks closed by DC6's `liveMarkdown`),
  unmarked text staying live; lost, giving the store's turn the live
  buffer (writing reducer state outside the reducer, or provisional events
  the reducer cannot drop, which DC6's settling decision rejected). Cost
  accepted: a marked streaming text draws without streamdown's
  incomplete-Markdown mode. "The turn of the latest prompt row" is read as
  the latest derived row's turn, since a turn a notification or a
  hand-back opens has no prompt. DC6's liveness and retry rules move
  unchanged into a `TranscriptKeeper` the owner runs once; an owner's
  release is deferred one microtask so a same-commit hand-off keeps the
  subscription. The session view draws on a desktop while `machineOnline
  !== false` (null counts as online, as DC6's `reachable`). The status
  word sits in the header's actions group (DC5's two-child header rule).
  The view's chunk loads through one hook in `ChannelView`, not two lazy
  boundaries. The Report · Transcript choice is kept per transcript key
  for the page's life and re-applied when MAWS's store starts the key
  over; a reload opens on Report. The open-agent request runs owner →
  column → Subagents, opening a closed column. Paging's browser proof runs
  on DC6's `DepthPlayer` until M6 proves it on `session-view`. DC6's
  browser suites moved to the center; the fold suite is deleted; six DC5
  conversation tests are `fixme` for M4, which brings the log's items into
  the session view.
  Date/Author: 2026-10-17, M3 executor, folded by the controller.

- Decision: Parent re-pinned to `a87d7fa04` (DC8's M4):
  `adoptShellOutputRoot` is not an engine setting in 2.1.300 but the
  in-process `--bg` takeover state, so `output`'s containment has exactly
  the three slug roots and an adopted shell's output is refused. The fake
  producer never modelled an adopt root (checked); the earlier entry that
  listed it is superseded on that point.
  Date/Author: 2026-10-17, controller (the composite's writer's notice).

- Decision: **The owner keeps MAWS's shape for the Transcript side of the
  toggle** (2026-10-17, after the real-session retake): finished turns stay
  folded behind MAWS's "Worked for …" divider, one click opens them; the
  build does not change. Parent re-pinned to `4021c5bbb`, which records it.
  Date/Author: 2026-10-17, the owner via the composite's writer.

- Decision (M3 fix waves): the jump-to-latest control gets a 56 px gutter
  on the transcript's scroller itself (the container `100cqi` is measured
  against), so rows, wide tables and code blocks all end clear of it; the
  subagent tree's headings carry MAWS's Chevron (Done still starts
  closed); an idle or ended session's jump control drops MAWS's working
  dots for its arrow through a desk CSS rule on `data-at-rest`, a
  decoration only — a synthetic `process.exited` was tried and reverted,
  since an early idle presence ended a turn still running and the marker's
  placement differed across resets, so the transcript stays what its rows
  say and an idle session's last open turn still reads as working inside
  it (desk-only tech-debt row; MAWS's app ends such a turn through its
  disk follower); the session view's chunk loader clears a failed attempt
  and offers Retry and Reload (Chrome caches a failed module import);
  keep-place arms the reader's place from the DOM when the page is
  answered and holds it frame by frame after every page (5 steady frames,
  at most 120), yielding to a gesture in progress (touch or press, from its
  start on the scroller to its end on the window), so the place holds
  through a page that answers late (the probe: 109–830 px of drift before,
  none after).
  Date/Author: 2026-10-17, M3 executor, folded by the controller.

- Decision: An interrupted turn ends at its interrupt marker on the desk
  side (M5, in the adapter). Of 171 interrupt markers in the 60 latest
  local transcripts, 11 are followed by a `turn_duration`; MAWS's backfill
  only clears its tool loop at a marker and its live path ends the turn
  from the SDK result, which the desk never gets; DX4 relays no DX5 turn
  end. The marker row is engine-written and ordered, so the adapter emits
  a `turn.ended` with an id derived from the marker's uuid at its position
  — replayed identically through resets, rebuilds and pages, MAWS's
  backfill unedited. Rejected for now: a relayed DX4 turn-end kind (a
  contract change, DC8 producing it), kept as residue. The debt row then
  covers a process killed mid-turn and a cut replay.
  Date/Author: 2026-10-17, controller (at the composite's writer's ask).
  Confirmed by the composite's writer (composite `52a17353e`) with a
  fourth check: a desk Steer or a queued send mid-turn is never read as a
  marker — the engine's exact marker text and row shape, not a prefix a
  typed prompt could carry.

- Decision: Parent re-pinned to `d447cfe97` (DC8's panel fix wave): an
  agent is known as background by `meta.requestShape`, `spawn.background`,
  the persisted call's `input.run_in_background` (`true` or `"true"`;
  `false` proves nothing), or its result's exact launch text —
  `Async agent launched successfully.` then a line `agentId: …`, or a
  fork's `Fork started — processing in background` — either text being
  `async_launched` running evidence at precedence (3); a launch without a
  `toolUseResult` names no `outputFile`. DC8's fixture moves to
  doperpowers `c81b77fc` (77/77; the legacy case split into a cold open, a
  list-seeded reload, and an agent known as background only from its
  spawn), pushed once DC8's review and CI pass. The fake machine's
  derivation follows it in a small task once the fixture is pushed (a cold
  open would otherwise show older launches and every fork `completed`
  where the live view shows `exited`). DX5's `resync.refused` is
  machine-only.
  Date/Author: 2026-10-17, the composite's writer relaying DC8, folded by
  the controller.

- Decision (the fake's follow-up, `97e3b111..458f60c1` on `desk-dc9-fx`,
  reviewed clean, merged): DC8's fixture is vendored at doperpowers
  `48f254aa` (18 body and 17 output cases; replaces `c81b77fc`); an agent
  is background by `meta.requestShape`, `spawn.background`, the call's
  `run_in_background` (`true` or `"true"`), or a launch among its rows; a
  result row with a `toolUseResult` is decided by its status alone, and
  the engine's launch texts are read only on a row with no `toolUseResult`
  and no `is_error`, so a foreground answer that begins like a launch stays
  `completed`.
  Date/Author: 2026-10-17, M2 executor, folded by the controller.

- Decision (M4, a gap §9.1 did not foresee): a send stays at the tail
  until its own row is observed, but with history only partly held a
  `queued`, `delivered` or `uncertain` send older than the oldest held row
  is left off the tail until the history is complete (`more` false), and
  shows again then if its row never came; a send that ended `failed`,
  `refused-read-only` or `recorded` never gets a row and always stays.
  Reason: §9.1's rule was written for a live send; applied to a reopened
  session it would pile every past web send whose row sits in unpaged
  history at the tail, each wrongly. Rejected: positive reconciliation of
  every logged send against rows not yet loaded (it needs the whole
  transcript on the web, or a new DX4 lookup). Accepted residual: a
  delivered send whose row never came before the session ended, opened
  later with newer history held, shows only once the history is paged to
  its start. Also: the matcher requires affirmative delivery provenance
  (a user row with origin `plugin`/`asUser`, a queued command with `peer`
  or `plugin`) besides the frame's whole first line, so a typed or
  origin-less row never consumes a send.
  Date/Author: 2026-10-17, controller (M4 review).

- Decision: The bridge's interrupt row (the marker line followed by its
  own "Task …" lines) is multi-line, so MAWS's `INTERRUPT_MARKER` misses it
  and MAWS's backfill reads it as a prompt that opens a turn: a desk
  Interrupt left the turn "working" and drew a phantom prompt. Fixed on
  both sides: the bridge writes the marker row as the engine's exact text
  and the task lines as a separate row (a doperpowers follow-up the
  composite's writer dispatches; DC8 is merged); and M5's adapter
  recognizes the bridge's current shape strictly — the marker line
  followed only by the bridge's own "Task …" lines, on a row with the
  bridge's origin, never a typed prompt — and normalizes it before MAWS's
  backfill, so it ends the turn and draws no phantom prompt (history and
  older plugins keep that shape).
  Date/Author: 2026-10-17, the composite's writer, folded by the controller.

- Decision (M4, as built): each tail send is a turnless MAWS
  `request_slot` row (id `desk-tail:<kind>:<key>`) drawn by
  `renderRequest` — turnless, so the report never folds it — after the
  streaming rows, then the inline request cards, then the end marker; the
  bubble is the desk's own markup in `UserRow`'s classes with a separate
  `DeliveryFoot {state, words, reason}`, words naming no session, a
  reason's first line cut to 60 characters (the full text in the tooltip),
  and a `ResizeObserver` as `UserRow` has. Steers are tail rows matched by
  the row uuid their RPC result names (the only uuid path; per tab). The
  matcher reads both frames sminos writes — `[sminos chat … <writer>:<seq>
  from … → @you|@all]` and `[sminos message from … id=<msg_id>]` — on the
  row's whole first line, on a row marking a delivery's provenance (a user
  row `{kind: plugin, asUser: true}`, a queued command `peer` or
  `plugin`); origin-less rows and the bridge's appended steer row never
  match. The ask overlay is portalled into MAWS's question row (found again
  by a frame-throttled `MutationObserver`; CSS hides the receipt's own
  lines while it draws) — the fragile piece, which a `QuestionRow` prop in
  MAWS would replace. "Waiting for your answer · below" while its card is
  at the tail. The end marker shows for `group === 'ended'`, untimed, the
  session named through `SessionLabel`. The n-0 fallback lives in
  `SessionView`. The pill shows while no card is in view; a request landing
  marks and centers its card. DC5's `StreamView` landing effect returned
  Chrome's `scrollIntoView` promise as its cleanup (a crash on unmount),
  fixed. The six DC5 `fixme` tests are moved and pass.
  Date/Author: 2026-10-17, M4 executor, folded by the controller.

- Decision (M5 review; the composite's writer's ruling): a steer and the
  bridge's interrupt row are both doperpowers plugin meta appends, so
  provenance is made distinguishable at the source — doperpowers #225
  writes the interrupt as two meta plugin rows (the engine-exact marker
  `[Request interrupted by user]`, then a note row "The interrupt came
  from the desk." / "… from outside the terminal." with one "Task …" line
  per background task) and its steer refuses a text that is exactly an
  engine marker or begins with the old bridge form. The desk ends the turn
  on the engine-exact marker on an origin-less row (Esc) or a doperpowers
  plugin row, keeps the legacy one-row shape strictly, and draws the note
  row as neither prompt nor bubble. Accepted residual (debt): a human
  steering exactly the marker text through an older plugin. Also from the
  review: when the `subagents` body carries DX4 `status` (a DC8 producer)
  it is authoritative over statuses the held rows' backfill events imply
  (MAWS's backfill marks legacy launches and forks `completed`, which DX4
  corrected; a sidecar's `stoppedByUser` is a hint, not evidence); held
  events fill status only for an older producer. A job's `summary` stays
  visible beside MAWS's row when its output is missing.
  Date/Author: 2026-10-17, controller and the composite's writer.

- Decision (M5, as built): DX4's status is patched onto MAWS's task graph
  on the desk side (`withStatuses` over the graph the held rows build, each
  time anew), authoritative when the body carries it; agents DX4 leaves
  `unknown` sit under "Status unavailable · N" for a DC8 producer (it knows
  every recorded agent); a job's summary is a plain line under MAWS's
  unchanged `ShellRow`/`MonitorRow`; Stop is disabled with its reason by a
  layout effect on the desk's wrapper (MAWS's rows imported unedited); 4A's
  open output draws inside the row's border, asks 4096 bytes, shows the
  path's last two parts, and an `unknown-task` waits 10 s for the next
  `subagents`; monitors get no Output (MAWS's `MonitorRow` has none); the
  terminal-job copy applies once a job is terminal or the session has no
  process (an offline machine is not ended). The interrupted turn ends at
  its marker by a desk check stricter than MAWS's `INTERRUPT_MARKER`, the
  bridge's legacy row normalized on a mapped copy only. Agent names in
  `agent_message` rows: no desk seam without rewriting the call's input,
  so a maws-fe debt row. The column's tabs are Subagents, Jobs, Diff,
  Info. Deferred minor (debt): when DX4's status equals the held one, the
  held end time stays (a legacy launch then a completion keeps the
  launch's time).
  Date/Author: 2026-10-17, M5 executor, folded by the controller.

- Decision: DC9.G3's phone check is "loads no transcript chunk" (the
  composite's writer, amending G3): the phone has drawn `<message>` bodies
  through MAWS's Markdown since DC5, so its channel fetches the markdown,
  KaTeX and shiki chunks, while it never loads SessionView, TranscriptPane
  or any script holding MAWS's Transcript — §4's binding. M6's phone test
  asserts the transcript-chunk check and records the Markdown chunks it
  loads. Residue: shiki and KaTeX loaded on the phone only when a message
  holds code or math.
  Date/Author: 2026-10-17, the composite's writer.

- Decision (M6, as built): the acceptance (G1–G5) runs on `session-view`
  with `producer: 'dc8'`, mapped clause by clause in M6's report; the
  recording gained a compaction in its older history (shapes from MAWS's
  committed `w1-compact.jsonl`), so paging to the first row crosses it.
  The frame line is cut on the drawing copy only (the held row keeps it
  for the tail matcher): the owner's own send (`from human`) shows no
  frame; a peer's row opens with an italic "From <name>" paragraph inside
  the bubble — not a caption, since MAWS's `UserRow` gives a mid-turn send
  its own fixed caption — and a queued peer delivery is redrawn in MAWS's
  mid-turn queued-prompt shape (keyed `user:<source_uuid>`), so its body
  draws. A message landing resolves its span across the row's text blocks
  with MAWS's mark parser and pages toward an older row ("Finding the
  message in the session's history…", then "not in the session's
  transcript" when history runs out). "Finished" is proved on the
  recording's own `turn_duration`. Both interrupt shapes draw no bubble
  and read stopped. Deferred minors: a `$` in a peer's name is not
  escaped (math in the label), and a landing that arrives late can pull
  a reader once from a place chosen while it paged.
  Date/Author: 2026-10-17, M6 executor, folded by the controller.

- Decision: **The phone draws the session view** (the owner, 2026-10-18,
  reversing §4's two phone bindings after a day worked from the desk: the
  working record, which the phone drew only as "Working record · on a
  computer", was the one thing that still sent them to a terminal; Claude's
  mobile Remote Control draws it). A direct channel is the session view
  wherever its machine is online, phone or desktop (`ChannelView`'s
  `drawsSessionView` no longer reads the layout): the report with its
  per-turn records unfolding in place (the desktop's shape: the record, then
  MAWS's "Worked for" divider, then the turn's group line), each tool call
  MAWS's one-line cell that opens its input and output on a tap, the
  running turn streaming, the
  tail's sends and request cards. The fallbacks are the desktop's: an
  offline machine and a subscription ended at `n` 0 draw the log-built
  stream, saying why. Unchanged: the grid, the group chat, and the depth
  column, which stays desktop-only (an Agent row is a plain row on the
  phone, since there is no column to open it in; the ⋯ note now says
  subagents, jobs and diff open on a computer). The session view's chunk
  still loads through `module-loader.ts` the first time one is drawn, so
  DC9.G3's phone check becomes "no transcript chunk until a session channel
  opens" (`e2e/phone-load.spec.ts`: the grid and the group chat fetch none,
  a session channel then fetches the session view's, never the depth
  column's). MAWS's Markdown still loads with the project view, as it has
  since DC5, for the group chat's message bodies. Two narrow-width rules in
  `styles/app.css`: below 768 px the session view drops M3's 56 px gutter
  for "Jump to latest" (a sixth of a 320 px screen; the control floats over
  the rows' end there, as MAWS draws it in any narrow pane, and only while
  the reader is away from the tail), and an opened shell call's command
  wraps across the detail's width with Copy command under it. The phone's
  layout cases (`e2e/phone.spec.ts`, @layout, also in WebKit) pin the loop at 390 and
  320 px against the fake machine: records unfolding, one-line tool rows
  with long inputs truncated, a tool row opened, a running turn, Steer and
  Send, request cards answered at the tail, the offline fallback.
  Date/Author: 2026-10-18, the owner via the composite's writer; built on
  `desk-phone-record`.

## Surprises & Discoveries
- 2026-10-17: an idle session's last turn reads "working" only when the
  transcript never ended it. The engine writes a `system/turn_duration`
  row (with a uuid) at every turn's end — 749, 2,570 and 183 in the
  latest MAWS-project transcripts — which MAWS's backfill maps to
  `turn.ended` (`backfill.ts:415`) and the desk's adapter replays; the
  recordings' last turn is an interrupted one (`isAbortedMidStream`, no
  `turn_duration`). So the desk-only debt row covers an interrupt with no
  end row, a process killed mid-turn, and a cut replay; ordinary idle
  sessions read finished. The local copy of the owner's transcript used
  for the retake and the compaction probe is deleted.
- 2026-10-17 (a probe on a real session, local only): paging crosses a
  compaction cleanly — MAWS's backfill turns `compact_boundary` into one
  historical `boundary.compaction` row and hides only rewind branches, the
  summary row (`isCompactSummary`) is meta in both views by MAWS's design,
  and the desk's `older()` filters nothing — so rows before a compaction
  draw above "Compacted earlier" in Report and Transcript, to the file's
  first row. The same probe found the reader's place lost when an older
  page answers with any delay (100–830 px of drift per page); M3's fix
  wave 2 takes it.
- 2026-10-17 (M3): MAWS's report counts question rows as persistent, not
  as tool calls ("Working record · 1 tool call" for a turn with Bash and
  two questions). MAWS's "Jump to latest" animates working dots whenever
  its store holds an open turn (`state.current !== null`), whatever the
  desk's presence says — after a replay ends, too.
- 2026-10-17 (M2): engine 2.1.300 also writes a `<task-notification>` as a
  plain user row when it opens a turn on one, besides the `queued_command`
  attachment DX4 and the fixture read: `two-subagents`' own notifications
  are that form, and 76 of the last 300 local transcripts hold it. MAWS's
  backfill reads both; the fake reads both (one marked branch), with every
  fixture case still passing. Sent to the composite's writer for DC8 (a
  plane reading only the attachment would disagree on every such agent).
  An agent the bridge reports stopped before its notification lands shows
  `exited`/`bridge` until the notification row (DX4's precedence; about
  2.5 s for alpha), which M5 draws as it comes. Engine metas carry
  `requestShape: "background"` even for a call without
  `run_in_background`.
- 2026-10-17: reviewers and workers dispatched from this controller
  inherit a worktree guard that refuses git commands aimed outside the
  dispatching session's own checkout (`git -C /tmp/...` is refused, as are
  complex shell commands). A review's range is therefore written to a diff
  file under `/tmp/desk-review/` (or the SDE workspace's review package) by
  the controller, and the brief names that path.

## Outcomes & Retrospective

**2026-10-17, at the branch's end (controller).** Every milestone is
built and reviewed clean: S1 (merged as MAWS #26), T0, M1 to M6. S2 is
parked on `desk-backfill-jobs` as the MAWS app's own follow-up. The
whole-branch xhigh panel (`d9466376..79a8c812`, run by the composite's
writer) found four P2s and confirmed nothing in its delivery-truth or
status/jobs/output lenses. All four were fixed in one wave, with the `$`
escape and three tech-debt rows. The delta was re-checked at the high
rung, which found one more P2: a pending landing did not yield to the
reader. That was fixed through a shared `reader-intent.ts`, closing one
debt row, and re-reviewed clean (`79a8c812..13ff05e7`).

DC9's acceptance passes against the fake machine replaying
`session-view` with the DC8 producer, mapped clause by clause in M6's
report:
- the report with its per-turn records, streaming into its turns;
- the toggle;
- tail sends matched by identity and provenance alone;
- requests inline at the tail;
- the ask overlay;
- the end marker;
- paging to the first row across a compaction, live and after the
  session ended;
- the fallbacks;
- the phone loading no transcript chunk (until 2026-10-18, when the
  phone took the session view: none until a session channel opens);
- the column's DX4 statuses, jobs, `output` and MCP names;
- the hub's `output` frame and kind.

DC8's machine side end to end waits for the deployment: the hub ships
first.

What held:
- **MAWS's components imported as they stand.** The report, `UserRow`'s
  classes, `ShellRow` and `MonitorRow`, and the task graph were all used
  unedited. The desk's seams were its own source, its tail rows, a portal
  for the ask overlay, a layout effect for Stop, and a projection of what
  the list draws.
- **One owner per session.** The center and the column share one
  subscription.

What moved under the plan:
- The contract moved repeatedly while it was being built. DC8's fixture
  went through four revisions, and DX4's precedence and the meaning of a
  launch were corrected. There was an adopt root that did not exist,
  plain-row notifications, and the bridge's interrupt rows (fixed on both
  sides, with doperpowers #225). Folding each change into the Decision Log
  before the next dispatch kept the executors on current ground.
- The owner's reviews changed three things: the delivery state moved into
  the bubble (1B), requests moved inline (2B), and the Transcript toggle
  kept MAWS's shape. A real-session probe found the place-keeping drift
  on late pages, which no recording had shown.
- Three ideas were tried and reverted or narrowed: a synthetic turn end
  driven by presence (it corrupted turn history), text-containment
  matching, and an origin-less fallback.
- A cmux restart paused the work mid-execution. Nothing was lost: every
  worker committed WIP first, and the ledger carried the handles.

Left open: the residue and the tech-debt rows named in the report
(`docs/doperpowers/plans/2026-10-17-desk-dc9-report.md`).
