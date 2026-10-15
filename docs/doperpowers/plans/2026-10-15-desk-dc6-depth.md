# The desk, DC6 — the web: session depth: execution (2026-10-15)

> **Composite:** `docs/doperpowers/specs/2026-10-15-desk-design.md` (MAWS,
> branch `smns-erb`; on this machine
> `/Users/new/Developer/GitHub/MAWS/.claude/worktrees/smns-erb/`), child
> **DC6** (The web — session depth — plan). **Parent pin:** blob `9471766c`
> of that file (MAWS commit `52922154`), as it stood at dispatch. The
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

- [ ] M1 — The main transcript in depth
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
and worktree from `DeskSession`, and model, context use, and cost from the
transcript, derived as MAWS derives them; the `transcript` slot renders a
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

## Surprises & Discoveries

## Outcomes & Retrospective
