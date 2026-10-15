# The desk, DC6 — the web: session depth: execution (2026-10-15)

> **Composite:** `docs/doperpowers/specs/2026-10-15-desk-design.md` (MAWS,
> branch `smns-erb`; on this machine
> `/Users/new/Developer/GitHub/MAWS/.claude/worktrees/smns-erb/`), child
> **DC6** (The web — session depth — plan). **Parent pin:** composite
> MAWS commit `8f7e09d3` (re-pinned 2026-10-15 from `9471766c` via `05870451`, `d349a87a`). The
> child's section there is its design; this document carries only the
> constraints and the milestones. Read the composite's Purpose, §2 (Web
> client: the adapter), §3 (the session plane), §4 (the right column), and
> the Interfaces DX3 (subscriptions and older rows), DX4 (all of it: the
> session bodies, the snapshot and its watermark, per-block streaming and
> `block-row`, `end`), and DX8 (all of it) before M1. Read
> `docs/doperpowers/specs/2026-10-15-desk-renderer-survey.md` before
> deciding what to import: its paragraph on the DX4 adapter names the risk
> this child exists to retire.

## Progress

- [x] M1 — The main transcript in depth (2026-10-15, reviewed clean: 46382c26..ba48dcda, fix 29fa876a..f6d42944)
- [ ] M2 — Subagents
- [ ] M3 — Diff, session info, the transcript slot, and the replayed acceptance

## Constraints that bind every milestone

- **The composite has one writer**, the session that dispatched this plan.
  The controller records this plan's decisions in its own Decision Log and
  messages that session with any decision that touches a contract, with
  every owner action as soon as it is known, and at each milestone's end;
  it does not edit the composite. DX3 and DX4 are DC3's and DX8 is DC5's,
  both being built in parallel: a type or rule that proves wrong goes to
  that session, never patched on the other side from here.
- **Where the code lives.** `apps/desk-web/src/depth/` in MAWS's pnpm
  workspace. DC6 plugs in only through DX8: `registerSlot` for `depth` and
  `transcript`, from one `connectDepth()` called once from
  `apps/desk-web/src/main.tsx`, and the `SessionPlane` handed to the slots.
  This child works in its own MAWS worktree on branch `smns-erb-depth`,
  started from `smns-erb-web`, and merges `smns-erb-web` (DC5) and
  `smns-erb` (DC3) in as they move, never rebasing them. The shell under
  `apps/desk-web/src/shell/` is DC5's to change and `apps/desk-hub` is
  DC3's: needing a change there is a message, not an edit.
- **MAWS's components.** Import what the survey ranks importable as it
  stands; reach the rest through the seams it names (`TranscriptSource`,
  `TranscriptActions`, `setAgentWorkClient`, `setChildSourceFor`); copy and
  adapt only what it ranks copy-and-adapt, into `apps/desk-web/src/depth/`.
  Cutting an import edge in a MAWS module to make it importable (the
  survey's `DEFAULT_ACTIONS` out of `transcript/view/context.tsx` and the
  ~10 edges it lists) is allowed when MAWS's own behavior and tests stay
  unchanged, and is named in the milestone's message. DC5's M3 needs the
  same Markdown and to-human Presenter behind the same edge: whichever
  child makes a cut first tells the composite's writer, who tells the
  other, so each cut is made once and merged.
- **Transcript text is untrusted, in a page that holds the org key.** A
  session's rows carry whatever tools read and models wrote, and a script
  injected into this page could sign events with the key, extractable or
  not. Text renders only through MAWS's Markdown and presenters with their
  sanitization as it stands (rehype-harden, no raw HTML); a link opens in
  a new context without opener access; nothing from a row reaches
  `innerHTML`, a URL that navigates this page, or a script. A copied
  renderer piece keeps its sanitization.
- **Visual design** is MAWS's: tokens, density, and the transcript's and
  subagent panel's presentation as they stand, light first. At the end of
  M1 and of M2 a screenshot of the running depth column goes to the owner
  through the composite's writer; work continues meanwhile.
- **MAWS's gates cover the work** (`scripts/ci-gate.sh <worktree>`: the
  root `pnpm typecheck`, `lint`, `test`, `build`), and the desk-web
  Playwright suite DC5 joined to the gate (`pnpm e2e:desk-web`) carries
  this child's browser tests. Local heavy runs follow MAWS's load rule.
- **Fixtures** are DC3's fake machine and its recording (DC3's M4) once
  they land. Before then, a double of the session plane fed from a
  transcript recorded in a throwaway session, its subagents included; no
  real session of the owner's is committed.
- No `Co-Authored-By` trailer.

## Plan of Work

### M1 — The main transcript in depth

**At its end:** selecting a direct channel opens the depth column on that
session's main transcript: the snapshot's rows drawn by MAWS's transcript
view; rows arriving live; the text of the model's current request growing
per content block and settling into the row its `block-row` named; older
rows paged in when scrolled to the top. A `reset` drops what was drawn and
redraws from the fresh snapshot; any other `end` keeps what was drawn and
marks the transcript unavailable with its reason, and the column subscribes
again when `DeskSession` shows the session reachable.

**Decisions:**
- *The adapter* is a `TranscriptSource` over DX8's `SessionPlane`, copied
  and adapted from `transcript/source/ipc.ts`: the snapshot's rows
  (newest first) reversed into `recordToEvents` with deterministic ids, so
  a row seen twice is one; `row` the same; the snapshot's `streaming`
  entries and each `chunk` as streaming text keyed by
  `(turnId, agentId, step, index)`; a chunk whose `chunkIndex` is at or
  below its entry's `upTo` is already in the text and dropped; a chunk for
  a settled block is ignored (DX4).
- *Settling without a message id* is this milestone's central decision,
  recorded with the reason and the alternatives that lost. MAWS's reducer
  pairs a streaming block with its completed row by API message id
  (`rs/transcript/model/reduce.ts`, around the delta and `completeBlock`),
  and DX4's chunks carry none; DX4 instead names the settling row by uuid
  in `block-row`, which arrives before the row. Candidates: the adapter
  keeps streaming text in its own layer over the transcript and drops a
  block's text when the row `block-row` named arrives; or it feeds the
  reducer under a provisional id and retires that block when the row
  arrives; or MAWS's reducer learns a second pairing key, allowed only
  with MAWS's behavior and tests unchanged. Whichever is chosen, a block's
  partial text and its row are never drawn together, and nothing streamed
  is lost between them.
- *Liveness:* `setLive(transcriptKey, live)` as DX8 states it.
- *Older rows:* `rows(before, limit)` when the view reaches its top, until
  `more` is false.

**Touches:** `apps/desk-web/src/depth/**`; the MAWS edges cut to import
the transcript view (named in the milestone's message); the one
`connectDepth()` line in `main.tsx` if DC5 has not added it.

**Does not touch:** `apps/desk-web/src/shell/**`, `apps/desk-hub/**`.

**Proves:** against the double (or DC3's fake machine once its M4 lands),
replaying the recorded session: after a response streams and settles, the
transcript store's rows equal the rows a fresh load of the same point
draws (compared as data, not pixels); a reconnect in the middle of a
response, a hub restart, and a chunk arriving while the snapshot is built
each end with no gap and no duplicated text; the Markdown of a row
carrying a script, raw HTML, and a `javascript:` link draws inert. Browser
tests in a real browser; MAWS's own suite unchanged.

### M2 — Subagents

**At its end:** the column's subagents view shows the session's subagent
tree from DX4's `subagents` (each `subagents/*.meta.json`), updated as
subagents start and finish; opening one subscribes with its `agentId` and
draws its transcript and its stream as M1 draws the main thread.

**Decisions:**
- Through MAWS's subagent model and UI with `setAgentWorkClient` and
  `setChildSourceFor`, stamping the `seq` and launch-style ids its live
  path requires (the survey: `store.ts` drops events with a null `seq`),
  or a desk tree view over `tools/agents/model/*` when the client seam
  costs more than it gives; recorded with the reason.
- Each subagent's subscription is its own (DX3 scopes it by `agentId`),
  with its own `reset` and `end`; a subagent's disruption never resets the
  main thread's view, nor the reverse.

**Proves:** the tree matches the recording's `subagents/*.meta.json`; a
reconnect in the middle of a subagent's response, a hub restart, and a
chunk arriving while a subagent's snapshot is built each end with no gap
and no duplicated text in the subagent.

### M3 — Diff, session info, the transcript slot, and the replayed acceptance

**At its end:** the diff view draws DX4's `diff {base, text}` through
`splitPatch` and MAWS's `ReviewView`; session info shows machine, cwd,
and worktree from `DeskSession`, the model from the transcript, and
context use and cost from DX4 `usage` ("unavailable (no bridge)" when
null; Decision Log, 2026-10-15); the `transcript` slot renders a
direct channel's unfolded working record in the center (the main
transcript through M1's adapter) for DC5's M3 to mount; and the whole
acceptance passes against DC3's fake machine.

**Decisions:** one diff, against the session's base branch, not MAWS's
four scopes; it is asked for through `Subscription.diff()` on the main
transcript's subscription (DX3 `diff`, DX8, composite `05870451`) when the
view opens and again on the user's refresh, never polled. Until DC5's
shell and DC3's hub carry `diff()`, M3's diff work runs against the
double.

**Interfaces:** consumes DC3's fake machine (DC3.G5, its M4) and its
local runtime; produces the `transcript` slot's registration DC5's M3
mounts (tell the composite's writer when it is usable).

**Proves:** DC6's acceptance, every clause, against the fake machine
replaying its recording with two subagents in a real browser: the
transcript streams and settles into the same rows a reload shows; the
subagent tree matches the recording's metas; the diff renders; the three
disruptions end with no gap and no duplicated text, in the main thread and
in a subagent. The gate is green.

## Concrete Steps

From this child's worktree root:

    pnpm install
    pnpm --filter desk-web dev                # against the local hub (DC3's M2 says how to run it)
    pnpm typecheck && pnpm lint && pnpm test  # the root scripts the gate runs
    pnpm e2e:desk-web                         # browser tests, under the load rule
    scripts/ci-gate.sh "$PWD"

## Interfaces and Dependencies

Consumes DX8 (DC5's shell: slots, `SessionPlane`, `DeskSession`, the
layout), and DX3 and DX4 as `SessionPlane` delivers them; consumes DC3's
fake machine (its M4). Produces the `depth` and `transcript` slot
registrations through `connectDepth()`.

## Decision Log

- Decision: Verification. Each milestone gets the subagent-driven
  execution's task review at its boundary; the owner sees the depth column
  as screenshots at M1's and M2's end; the branch gets a `high` review
  through `doperpowers:review-code` at the end, run by the controller.
  Rationale: a read-only view whose risks are the stream adapter's
  correctness (no gap, no duplicated text, which the acceptance tests
  directly) and untrusted text in a page that holds the org key; it issues
  no writes, so it is narrower than DC5's key-holding surface.
  Date/Author: 2026-10-15, the composite's writer at dispatch.
- Decision: Parent re-pinned to blob `552e7a77` (MAWS `05870451`). The one
  change since `9471766c` is the diff request (DX3 `diff {sub}`, DX8
  `Subscription.diff()`); M3 already plans for it. On this branch's base,
  `desk-hub/protocol` has DX4's `diff` body and `diff` among the
  subscription kinds but no DX3 `diff` up frame, and DC5's `Subscription`
  has no `diff()`; M1 and M2 do not consume either.
  Date/Author: 2026-10-15, controller (pre-flight).
- Decision: The double's fixture. M1 records one throwaway `claude` session
  in a scratch directory, made to run two subagents, and commits its main
  transcript rows and its `subagents/*.jsonl` and `*.meta.json` (M2 reads
  the same recording). A plain recording carries no bridge stream, so the
  double synthesizes the live part from the recorded rows: each assistant
  row's content block becomes DX5 `turn.step` chunks in DX5's shape,
  followed by its `block-row` and then the row, with the snapshot's
  `streaming` entries and `upTo` derived from the same split. Rationale:
  the plan asks for no gap and no duplicated text across disruptions,
  which needs a controllable stream; a synthesized one exercises the
  adapter's every path, and DC3's fake machine (M4) replaces it at M3.
  Paths and anything identifying in the recording are scrubbed to
  placeholders before commit.
  Date/Author: 2026-10-15, controller (pre-flight).
- Decision: The fixture's conditions, from the composite's writer. The
  synthesized chunks take DX5's real shape, `{turnId, agentId, step,
  chunkIndex, chunk}` with `chunk` the engine's `{kind, index, text}`
  (samples: doperpowers `tests/sminos/test-bridge.sh` near line 198), and
  cover every block kind the recorded responses carry (thinking and tool
  use beside text) so each kind's settling is exercised; the split keeps
  DX4's order (chunks, `block-row`, row), the snapshot's `streaming` and
  `upTo` covering exactly the chunks up to the cut, and one case has a
  chunk arrive after its block's `block-row`, which is ignored; the
  throwaway session runs in a scratch directory outside every repository,
  touching nothing of the owner's (no `~/.claude/settings.json` change),
  and is scrubbed of paths, user names, and host names. DC3's M4 recording
  becomes the one that counts once it lands at M3.
  Date/Author: 2026-10-15, composite's writer via the controller.
- Decision: M1 settles streaming without a message id in **the adapter's
  own layer** over the transcript view: a block's partial text is dropped
  from that layer when the row its `block-row` named lands in the store.
  Lost: the provisional-id route needs an operation MAWS lacks
  (`reduce.ts:544–560` keeps a provisional block with `messageUuid: null`,
  `:817–835` pairs completion only within one API message id,
  `backfill.ts:336–352` gives the completed row the real id so the
  provisional text would stay beside it, and `derive.ts:331–355` drops only
  by a non-null message uuid); a reducer change conflicts with DX8, which
  imports the model and store as they stand. M1's proof adds several blocks
  of one API message (thinking, text, and tool use of one response) and a
  settling row that arrives late, after chunks of later blocks.
  Date/Author: 2026-10-15, plan review via the composite's writer.
- Decision: Older rows enter the chronological model by **rebuild**:
  the adapter keeps the raw rows in order and, when an older page arrives,
  rebuilds the store chronologically from them with a fresh backfill
  context; live streaming carries on in the adapter's layer. Reason:
  `TranscriptSource` (`source/types.ts:6–13`) has no prepend and the
  reducer appends turns in arrival order with turn and tool-loop state in
  its backfill context (`reduce.ts:278–284, 407–416, 469–479`,
  `backfill.ts:27–46`), so a page applied on its own lands older turns
  after newer ones and splits a tool call from its result. M1's proof adds
  a page boundary splitting a turn and a tool call from its result while
  live chunks arrive: order, tool ownership, de-duplication, and the
  reader's scroll position kept.
  Date/Author: 2026-10-15, plan review via the composite's writer.
- Decision: M3's context use and cost come from **DX4 `usage`**
  (composite `d349a87a`), not the transcript: MAWS reads them from its
  main process's digest and `cost-state` records carry no uuid, so the row
  mapper drops them. DX4 gains `usage {context: {tokens, window, percent},
  cost}` (the bridge's DX5 `usage` after each main turn, on main-transcript
  subscriptions only) and the snapshot gains `usage`, null with no bridge
  or none yet, absent on a subagent's snapshot; DX8's `SubscriptionMessage`
  adds `'usage'`. Session info draws context and cost from it and
  "unavailable (no bridge)" when null. M3's proof adds browser checks for
  the initial load, an update after a turn, and a reconnect. DC3 (module)
  and DC5 (DX8 type) add their sides; until then, the double. This
  supersedes M3's "model, context use, and cost from the transcript" for
  context and cost; the model stays the transcript's.
  Date/Author: 2026-10-15, plan review via the composite's writer.
- Decision: DC6 cuts no MAWS renderer edge on its own branch. DC5 makes
  the cut on `smns-erb-web` (its M3, one isolated commit: `DEFAULT_ACTIONS`
  out of `transcript/view/context.tsx` and the survey's other edges
  Markdown and the to-human Presenter need), which DC6 merges; an edge DC6
  needs beyond it goes to the composite's writer, who routes it so each
  cut is made once. Supersedes the constraint's "whichever child makes a
  cut first".
  Date/Author: 2026-10-15, composite's writer.
- Decision: Heavy runs go to the gate's Linux lane (`scripts/ci-gate.sh
  --gates <gate> --runner linux`; DC5's `e2e:desk-web` lane there, or one
  of DC6's own beside it); focused unit tests run locally; nothing heavy
  runs on the Mac. Reason: the harness refuses `with-slot.sh` in these
  worktree sessions and the Mac's load has sat at 25–190 for hours, so
  `waitload20.sh` never clears. Supersedes the constraint's load-rule
  wording and the Concrete Steps' local `e2e`.
  Date/Author: 2026-10-15, composite's writer.
- Decision (M1): MAWS's transcript view is imported as it stands, no edge
  cut: the ~16 edges to `ipc/client.ts` stay reachable but inert on the
  desk (the depth column passes its own `openExternal` and `loadSpill`;
  engine-surface sites ask nothing without a `uiSurface`; browser tests
  assert no page or console error). Cost: desk-web's typecheck covers
  MAWS's renderer closure with MAWS's `env.d.ts`, and the lazy depth chunk
  carries xterm and mermaid. Streaming draws through `Transcript`'s `tail`
  prop with MAWS's row components and Markdown; tool input is not drawn
  while it streams (MAWS draws none). A block settles when the row its
  `block-row` named is *applied* in the store; a `block-row` for another
  transcript's block (`agentId !== target.agentId`) settles at once. Older
  rows rebuild under a new source object, which MAWS's store stages and
  swaps whole; `onReset` serves only DX8's `reset`, which puts the view in
  a `reconnecting` phase until the fresh snapshot. After an `end`, the view
  resubscribes once the session is reachable (`presence.record != null &&
  machineOnline !== false`, the `setLive` value); a fresh snapshot
  continues the held rows only when its oldest row is among them. Leaving
  a session drops its store key. Desk `app.css` (DC5's file, outside
  `shell/`) gains `@source` lines for MAWS's `transcript/`, `owner/`,
  `engine-surface/`, `ui/`. The fixture's thinking text is a one-sentence
  stand-in (the engine recorded it omitted).
  Date/Author: 2026-10-15, M1 executor, folded by the controller.
- Decision: The composite's writer's answers to M1 (composite `34ee27ca`,
  `24448038`), added to M1 before it is ticked. The no-cut route stands,
  guarded by a lint rule forbidding `window.maws` in `apps/desk-web/src`
  (MAWS's own sources outside its scope), since MAWS's `env.d.ts` types it
  there; the depth chunk's xterm and mermaid weight is a known cost, DC5's
  M4 measures it on the phone. DX4 gains `step-end {turnId, agentId,
  step}` in subscriptions (DX8's `SubscriptionMessage` carries it), sent
  when a model request ends — finished, aborted, or cut by its turn's
  end — after every `block-row` of that step; on it the adapter drops the
  partial text of that step's blocks without a `block-row`; tested against
  the double until DC3's type and DC7's producer land. Where the engine
  records thinking omitted, live thinking draws as the same collapsed
  indicator the settled row shows, not as streaming text. Depth stays raw
  for `<message>` marks; the `transcript` slot's marks are confirmed
  before M3.
  Date/Author: 2026-10-15, composite's writer.
- Decision (M1 fix wave 1): Late subagent metadata rebuilds the
  transcript only when it resolves an Agent call a mapping already looked
  up and missed (not at every `subagents`, which usually precedes its
  call's row). A reset fires one shared signal every registered source
  hears; MAWS's store ignores one from an attachment it has released, so
  the attached source is always reached. The lint rule forbids
  `window.maws` and `globalThis.maws` in `apps/desk-web/src`, tests
  included. `step-end` tombstones its request until the next snapshot or
  reset, so a later chunk is ignored. Live thinking is its label alone
  everywhere (DC2: live chunks carry no text); a settled thinking block
  with no text draws no row in MAWS (`derive.ts:356–358`), so the label
  goes when the row settles — accepted as built (composite `62750d48`).
  `step-end` is read through a local stand-in (`depth/stream/step-end.ts`
  and a cast in `DeskTranscript.subscribe`) until DC5's client passes it
  through (its M3 fix wave, `SUBSCRIPTION_KINDS`) and DC3's type
  (`d75f2924`) is merged; then the stand-in and cast go and a browser spec
  covers it. Until then the double's unit coverage carries it.
  Date/Author: 2026-10-15, M1 executor; rulings by the composite's writer.
- Decision (M2): A desk tree view over MAWS's `tools/agents/model/*`, not
  `setAgentWorkClient`/`setChildSourceFor`: MAWS's agent store needs an
  engine status and `seq`/launch ids the desk has no source for, and its
  drill-in issues writes (Stop, Relay). The tree and drill-in are copies of
  MAWS's `AgentList` and `DrillIn` without the team roster, waiting marks,
  live footer, Stop, or Relay. The tree comes from the main subscription's
  `subagents`; each agent's transcript is its own `DeskTranscript` keyed by
  its `agentId`, so one's disruption never touches another's view. An
  agent's status is only as complete as the main transcript's held rows:
  one whose call is older than the snapshot, and any nested agent, reads
  "On disk / status unavailable". The main transcript's view stays mounted,
  hidden and inert, under the Subagents tab. The double synthesizes a text
  answer before each subagent's hand-back; the fixture is unedited. Depth
  keeps the reader's place when an older page renames the row under them
  (`view/keep-place.ts`; MAWS's list anchors on the oldest turn's
  time/divider rows, whose ids change when its prompt arrives — M1's test
  passed only inside the 80 px follow threshold). The kept place is armed
  when the older-page request is answered and used up at the page's rows
  (a live row in between leaves it pending); a jump to an unrendered row
  keeps the saved offset by a per-frame correction (5 steady frames, at
  most 120), which a reader's own wheel, touch, pointer-down, or
  navigation key ends — plain scroll events do not, so the list's own
  realignments are still corrected.
  Date/Author: 2026-10-15, M2 executor (fix waves 1–2 after task review),
  folded by the controller.
- Decision: The siblings' `step-end` sides are ready (DC5's M3 ticked at
  `2af4fbc6` on `smns-erb-web`, with the client's passthrough and DX8's
  `transcript` slot type; DC3's protocol type at `b7fc7ebd` on `smns-erb`
  with the `6fa2252d` amendments). Between M2 and M3, never under a running
  executor, the branch merges both at or after those commits, deletes
  `depth/stream/step-end.ts` and the cast in `DeskTranscript.subscribe`,
  and adds the `step-end` browser spec; M3's executor does this first.
  `raised` now carries optional `agentId` and `truncated`; depth draws no
  pending requests, but would place one on the subagent named by `agentId`.
  Date/Author: 2026-10-15, controller, on the composite's writer's notice.
- Decision: DX5 is final (composite at MAWS `361bee24`, DC2 closed): a
  `turn` start may carry `recovered: true` with `text: null`. Depth draws
  no turn start's text — DX4 relays no `turn` event, and the prompt row it
  draws is the transcript's own user row — so this changes nothing today.
  M3 re-checks after merging `smns-erb`; if a turn start ever reaches
  depth, a null text draws no prompt row.
  Date/Author: 2026-10-15, controller.
- Decision (M3): The `transcript` slot draws through MAWS's to-human
  Presenter, so the unfolded working record reads as the folded view does;
  depth on the right stays raw. It draws an **exclusive range**: DC5 mounts
  it between two `<message>` rows the direct channel already draws and
  passes `{from, to}`, each a `src` (transcript row uuid plus span index)
  or null for an open end; the slot draws what lies strictly between them,
  leaving out each bounding message's marked span but drawing unmarked
  text of the same row before or after it (working record). DC5 does not
  trim the slot's output and writes the prop's exact shape into DX8 when
  it mounts; the composite's writer relays it.
  Date/Author: 2026-10-15, composite's writer (DC5's answer, the writer's
  ruling).
- Decision (M3): The `transcript` slot's props are fixed (composite
  `d7ad26d8`, DC5 `55248421` on `smns-erb-web`, `shell/slots.ts:22–28`):
  `{project, session: DeskSession, plane: SessionPlane, range: {from:
  string | null, to: string | null}}`, mounted once per fold of a direct
  channel's working record. Each end is the `src` of the exchange item
  bounding the fold — `<row uuid>#<span index>` for a `<message>` span, the
  call id for a question — and null when open (the first fold's `from`, a
  live session's last fold's `to`). The slot owns the cut at span
  granularity through the to-human Presenter. M3's proof adds: a row with
  unmarked text and a bounding marked span (text drawn, span not); a fold
  bounded by a question's call id; `to` null on a live session drawing rows
  that arrive after the last item.
  Date/Author: 2026-10-15, composite's writer.
- Decision: Heavy commands run directly, one at a time, once the load check
  clears; browser suites stay on the Linux lane; no effort on the slot
  wrapper. Refines the Linux-lane entry above.
  Date/Author: 2026-10-15, the owner via the composite's writer.

## Surprises & Discoveries
- 2026-10-15 (from DC2's M3, built, in review, via the composite's
  writer): a snapshot's `streaming` entry carries a message-level `upTo`
  and `model` beside `blocks`, where DX4 today words `upTo` per block;
  `chunkIndex` counts across the message, so the adapter's drop rule keys
  on the message-level value (and tolerates the per-block form until DX4
  is aligned). A tool-use block streams as text: it carries `id` and
  `name`, and its `text` is the argument JSON as it streams, not parsed
  while partial; the fixture holds one. In three live runs the nth
  response row of a step was block n; settling stays on `block-row`.
- 2026-10-15, settled at composite `8f7e09d3` (DX4 aligned): the entry is
  `{turnId, agentId, step, model?, upTo, blocks: [{index, kind, text,
  upTo, id?, name?}]}`; the entry's `upTo` is the watermark (a block's is
  informational); `kind` is `text`, `thinking` (redacted included), or
  `tool` (with `id`, the tool_use_id, and `name`); `model` is absent when
  the bridge missed the step's start; an entry with `blocks: []` may
  persist until its step ends and is skipped; a server tool's row gets no
  `block-row`, settles nothing, and is simply drawn.
- 2026-10-15: DC3's M3 contract types landed in `desk-hub/protocol` (MAWS
  `068f14f3`, `smns-erb`; composite `2ae6ac3a` gives `usage` exactly):
  DX4 `usage` is `{context: {tokens?, window, percent?}, cost: {usd} |
  null}`, main-transcript subs only, the snapshot's `usage` null with no
  bridge or none yet and absent on an agent sub, each missing piece drawn
  unavailable; the streaming entry as settled above; `compact` is
  session-wide (`SESSION_WIDE_KINDS`); DX3 `diff {sub}` is up. DC6 merges
  `smns-erb` to build on them.
- 2026-10-15, composite `cd2667d8` (DX4): in a main-scope sub a
  subagent's `block-row` settles its block at once (the main sub never
  carries a subagent's rows; only main-loop blocks wait for their `row`);
  an `end` may be a sub's first message at n 0 (ended before its snapshot:
  unknown session, bridge not ready, a cut row never on disk), drawn as
  reconnecting, not empty, while DC5's shell resubscribes with backoff on
  `discontinuity`. Rows arrive in strict disk order within a transcript,
  live as in history (DC7's daemon, from DC2's revised DX5 notices).
  DC5's renderer cut landed as `5bd20087` on `smns-erb-web`
  (`DEFAULT_ACTIONS` to `view/default-actions.ts`).
- 2026-10-15, composite `1cf94bd2` (DX8, additive, DC5's M3 at
  `7a3ebe39`): `DeskSession.seat` (the latest `joined`'s seat, empty for
  a session the human opened) with `presence` gives the session's kind —
  bridged, `--bg` seat, terminal, not running — through DC5's derivation,
  which depth uses rather than copies.
- 2026-10-15 (M1): thinking is recorded omitted on this engine
  (`thinking: ""`, `thinkingDisplay: "omitted"`); if live `thinking`
  chunks carry text, it vanishes when the row settles — check against real
  `sminos watch` at M3. Assistant rows carry `apiBlockIndex`, equal to the
  chunk `index` (the natural check for DC3's producer). A turn's row ids
  change once an older page brings its opening prompt (`turn:e<eventId>`
  → `turn:<uuid>`). `<message>` marks render literally in the depth column
  (MAWS's to-human Presenter is not attached without an owner lane). A
  response aborted before its `block-row`s leaves partial text drawn until
  the next reset or snapshot: DX4 carries no step end on a subscription.
  desk-hub's `enrollment.test.ts` failed once (502 vs 404), passed on
  rerun.
- 2026-10-15, DC2's live walk (composite `2038124c`, `10b2d830`): live
  `thinking` chunks carry `text: ""` and no signature on 2.1.300, so the
  collapsed indicator is the only drawing of live thinking. The bridge
  holds a step's end up to 1 s for its notices, so a `block-row` can
  rarely follow its step's `step-end`: it names a block already dropped,
  is ignored, and its row draws like any other. Producers remove a block
  from `streaming` at its step's end as at its `block-row`, so a snapshot
  never carries an aborted block.
- 2026-10-15: DC3's fake machine landed at MAWS `60bf893c` (`smns-erb`, in
  task review; API in `.doperpowers/sde/2026-10-15-desk-dc3-hub/interfaces-M4.md`
  there). Its interrupt does not cut the replayed transcript, and the
  recording's haiku ran both subagents in the background. The reviewed
  interfaces come through the composite's writer; M3 consumes them.
- 2026-10-15 (M2): the gate uploads only the repo root's `test-results/`,
  so a failing desk-web browser trace never comes back from the Linux lane.

## Outcomes & Retrospective
