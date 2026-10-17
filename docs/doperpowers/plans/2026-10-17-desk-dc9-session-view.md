# The desk, DC9 — the web: the session view: execution (2026-10-17)

> **Composite:** `docs/doperpowers/specs/2026-10-15-desk-design.md` (MAWS,
> branch `smns-erb`; on this machine
> `/Users/new/Developer/GitHub/MAWS/.claude/worktrees/smns-erb/`), child
> **DC9** (The web — the session view — plan). **Parent pin:** composite
> MAWS commit `bd9c67b14` (re-pinned 2026-10-17 from `77e82d832` via `f60dd668b`, `896f04acc`; Decision Log). The child's section there is its design; this
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

- [ ] S1 — Shared edit: the ask tool classified as a question (own PR)
- [ ] S2 — Shared edit: shell and monitor starts and `task_status` in MAWS's backfill (own PR)
- [x] T0 — Mockups of the four taste surfaces (2026-10-17: `desk-dc9-mockups` 73ecf8f0, the owner's choices marked c73916fa)
- [x] M1 — The hub's `output`, the widened bodies, and DX8's `output()` (2026-10-17, reviewed clean: d2c8fec5..af560476, fix 7098835a..89b2e560)
- [ ] M2 — The fake machine's part: the session-view recording, jobs and status, `output`, pages after the replay
- [ ] M3 — The per-session owner and the session view
- [ ] M4 — The channel around the view: tail rows, the inline requests, the overlay, the end marker, the fallbacks, the retirements
- [ ] M5 — The column: agents with real status, the jobs view, `output`, MCP names
- [ ] M6 — The acceptance, the phone's bundle, and the gate

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
- **The phone never mounts the transcript** (§4 [binding — owner,
  2026-10-17]): the phone's route loads no chunk of MAWS's transcript,
  Markdown or shiki; the narrow layout draws the log-built channel.
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
- **MAWS's gates cover the work**: `scripts/ci-gate.sh <worktree>` (static,
  unit, probes on GitHub Actions) and the desk-web browser lane
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
  doperpowers' `sminos.py` give the exact grammar), or an exact row uuid
  (the bridge's optional `delivered.uuid`). There is no text-containment
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
  unchanged.
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
successor) loading no chunk carrying MAWS's transcript, Markdown or shiki;
DC5's group-chat tests unchanged; the gate green (`static,unit` and
`e2e:desk-web` on the Linux lane); the taste surfaces polished to the
owner's verdict on T0. A screenshot set of the session view, the inline requests,
the end marker and the jobs view under the workspace for the composite's
writer.

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

## Surprises & Discoveries
- 2026-10-17: reviewers and workers dispatched from this controller
  inherit a worktree guard that refuses git commands aimed outside the
  dispatching session's own checkout (`git -C /tmp/...` is refused, as are
  complex shell commands). A review's range is therefore written to a diff
  file under `/tmp/desk-review/` (or the SDE workspace's review package) by
  the controller, and the brief names that path.

## Outcomes & Retrospective
