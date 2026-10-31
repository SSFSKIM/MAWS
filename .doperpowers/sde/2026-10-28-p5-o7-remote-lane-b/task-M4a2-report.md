# Task M4a2: the protocol and the endpoint (P5 O7 M4)

Branch `p5-o7-m4`, worktree `/Users/new/.local/share/maws-worktrees/p5-o7`, from b935a4e25. Spec:
`docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md` (M4; §L, §M, §R; Decision Log "M4's execution", "M4a1 as built").

## Commits

- `9c7feb647` P5 O7 M4a2 gate fix: the acceptance's not-offered probe names files.reveal (files.read is offered now); the scm tokens in the new suites minted, not literal
- `e13e81772` P5 O7 M4a2: RL2 1.2: a call may name its session (rl2.call-session) and a sub a feed (rl2.feeds), checkout with its session, attention with none
- `6fb8cc3d6` P5 O7 M4a2: the endpoint's checkout: M4's offer rows, the checkout target rule over call.session, a session's checkout feed, step 6's spawn guard over every spawn row on the machine, machine.op's sealed action (but an upload's); rl2.call-session and rl2.feeds in both capability lists

(`1533da5cc`, M4a1's fix wave 3, sits between them: another executor's, committed to the same branch.)

## What I built

1. **RL2 1.2** (`apps/org-protocol/src/messages.ts`, `channel.ts`).
   - `CallMessage.session?: SessionRef`. The reader checks it when present.
   - `SubMessage` is now `SessionSubMessage | MachineFeedSubMessage`.
     - `SessionSubMessage`: a session's stream, or its `checkout` feed (`feed?: 'checkout'`).
     - `MachineFeedSubMessage`: `{feed: 'attention'}`, which names no session.
   - The reader's rules for a feed: a feed it names; a `checkout` feed must have a session; an `attention` feed must have
     none; no `view`; a cursor that is `(epoch, seq)` only, with no `idx`.
   - `RL2_PROTOCOL` is 1.2.
   - The handshake vectors did not need regenerating. M2a pinned them to `VECTOR_PROTOCOL` 1.0, so a minor's move
     leaves them as they are. The full org-protocol suite is 253/253 with the committed vectors. Running `npm run vectors`
     only re-mints keys, so I reverted its output.
2. **Capabilities.** `rl2.call-session` and `rl2.feeds` are in both `ENDPOINT_CAPABILITIES` and `DEVICE_CAPABILITIES`.
3. **M4's offer rows** (`src/endpoint/offers.ts`), all of §L's.
   - Calls on the machine by `appSessionId`: `files.list`, `files.read`, `files.watch`, `files.unwatch`, `scm.status`,
     `scm.push.plan`, `scm.pr.plan`, `scm.remote.last`, `scm.pr.state`.
   - Calls on the machine by the new `checkout` rule: the ten `git.*` reads.
   - `fs.agentEvents`: an engine-host call by `appSessionId`.
   - Acts on the machine by `appSessionId`: the nine writes.
   - `session.spawn`: an act on the machine, target `machine`, registry grade `spawn`.
   - `session.projects.list`: a call on the machine, target `machine`, registry grade `list`.
   - `Offers` gains `feeds: ['checkout']`.
   - Everything §L says is not offered stays out, and a test pins that.
4. **The `checkout` target rule** (`targets.ts`, `authorize.ts`, `gate.ts`).
   - `TargetRule` gains `'checkout'`.
   - `AuthorizeRequest` gains `session`, which the gate fills from `call.session`.
   - Step 4 resolves the session from `call.session` as a subscription's is resolved, lane B only (else `no-target`),
     and takes the rank from it.
   - Only after the caller is known to stand at the floor, step 4 checks the path with `withinCheckout`:
     - It reads the record with `session.get`.
     - `CheckoutBounds.of` realpaths the record's roots and adds the repository of each root, from `git.status`'s
       `repoRoot`, realpathed.
     - The input's `directory`, else its `repoRoot`, must be absolute, must realpath, and must equal or lie under a bound.
     - Otherwise it is `no-target`.
   - The bounds are kept per set of roots, at most `CHECKOUT_BOUNDS_KEPT` (256) entries, oldest first out. A set whose
     `git.status` reads did not all answer is used once and not kept.
   - The 8-step order is unchanged: the path check is the last part of step 4.
5. **Step 6's spawn guard** now applies to every row whose grade is `spawn` and whose target is `machine`: today
   `sminos.spawn` and `session.spawn`.
6. **Feeds** (`src/endpoint/plane-feeds.ts`, new; `subscriptions.ts`; `endpoint.ts`).
   - **The subscription table.** A feed `sub` is registered, authorized and re-checked like any other subscription,
     and goes to a third plane, `planes.feeds`. A feed is not interest (OX5).
   - **The attention feed.** `{feed: 'attention'}` is answered `ended not-offered` at once, until M6 offers it.
   - **Authorization.** A feed is authorized against `Offers.feeds`. A `checkout` feed needs `view` on a lane B
     session; on a lane A session it is `no-target`; a web-cards device is refused `class`.
   - **Opening.** `PlaneFeeds` answers `subbed {mode: 'snapshot', epoch: 'checkout:<boot id>', seq: 0}` and sends no
     `snap`. Each later event is an `ev {body: {name, payload}}` at the next `seq`.
   - **What it carries:**
     - each `files.changed` and `scm.remote.output` naming the session;
     - each `git.changed` whose `repoRoot` lies within the session's checkout bounds (the same `CheckoutBounds`
       instance the rule uses).
   - **Bounds.** They are read at the opening, and read again at each `session.changed` of the session. A `git.changed`
     that arrives before the first read answers is held, the latest per repository (at most 64), and filtered once the
     bounds are known.
   - **Backlog.** A feed whose unread backlog passes `backlogBytes` (plane B's `BACKLOG_BYTES` by default) ends
     `behind`.
   - **Watch release.** A watch the channel installed is released at the channel's close. The release comes from the
     channel's `ClientRef` ending, which M2 built; this task proves it.
7. **`machine.op`'s `action`** (`actions.ts`). The machine branch sends the sealed action beside the claim for every
   `machine` act except `files.upload`. See decision 1.

## Decisions

1. **`files.upload` goes to `machine.op` without its sealed action (`KEPT_WITHOUT_ACTION`).** What the spec says and
   why I diverged:
   - §O says the endpoint sends `action` "for every `machine` act", and the ledger keeps it with the claim.
   - An upload's args are the file's bytes, about 2.7 MiB of base64 per part.
   - The services' ledger (`spine-ops.jsonl`) keeps entries for `KEPT_S` (24 h). It reads the whole file at each open
     and rewrites it.
   - So every remote upload's bytes would be written a second time, fsynced, and carried in the ledger for a day.
   - The action's purpose is the requester's proof, which is `session.spawn`'s `launchedBy` (RL9's `ownersProof`).
     The claim's `fingerprint` already binds an upload's op to its exact action.
   - I chose an explicit exemption by name, tested, over a size bound. A size bound would have to sit above a 1 MiB
     spawn brief and below a 2 MiB part.
   - For the spec: §O's `MachineOpInputSchema.action` line should read "for every `machine` act but `files.upload`".
2. **A field outside the spawn fields is `malformed`, not `spec-field`.** What the spec says and what the code allows:
   - The spec's Proves list says a `session.spawn` with a field outside `SPAWN_FIELDS` is refused `spec-field`.
   - `SessionSpawnInputSchema` (M4a1) is a `strictObject` of exactly those six fields, and step 2 holds the args to it.
     So any extra field is `malformed` at step 2, before step 6's guard.
   - The spec's own sentence puts step 2 first ("after step 2 has held the args to the registry's schema").
   - So I kept the order, and the test expects `malformed`.
   - `spec-field` still guards `sminos.spawn`, whose grade is on its row and which has no registry schema.
   - For the spec: the Proves line should say `malformed`.
3. **The older peer, explicitly.**
   - The endpoint is a chunk of `mawsd`'s own build, and `dispatch('machine', …)` is the in-process front. So `action`,
     an upload's `part` and `session.spawn` always reach services that read them; there is no older peer on that path.
   - The one older peer the endpoint can forward to is the **engine host**. `mawsd`'s `buildPolicy: 'replace'` serves
     an engine host of another build while it has live sessions (`detached-transport.ts`).
   - A minor-12 engine host refuses `session.events`' `maxBytes` as `invalid_input`. The endpoint passes that code
     through, as it does any non-transport code (`calls.ts`, unchanged).
   - Test: `checkout-rows.test.ts`, "an older engine host behind the endpoint".
   - A minor-12 endpoint seen from the device: it answers M4's names `not-offered` (no row), and `maxBytes` `malformed`
     (its registry's strict schema at step 2). Neither closes the channel.
4. **The `attention` feed is read now and refused `not-offered`.**
   - §M says `rl2.feeds` admits `'checkout' | 'attention'`. So M4's reader reads both, and a later M6 device that sees
     `rl2.feeds` never closes an M4 endpoint's channel.
   - The refusal happens in the subscription table before registration, because an attention `sub` names no session to
     build a `Subscription` on.
   - M6 replaces that line when it adds `'attention'` to `Offers.feeds`.
5. **A checkout read of a lane A session, or with no `session`, is `no-target`.** Lane A's checkouts are sminos's, and
   their roots are not in the spine's record. The same holds for a lane A `checkout` feed.
6. **The path check is the tail of step 4,** after the floor check. A caller below `view` learns nothing of the
   session's checkout or repository: no checkout read and no `git.status` (tested). *Corrected in fix wave 1:*
   placement itself reads `session.get` (and the engine host's `session.status`) for every lane B request, below the
   floor too; what is not read for such a caller is the checkout (no second `session.get`, no `git.status`).
7. **A `checkout` input's path is its `directory`, else its `repoRoot`.**
   - It must be absolute.
   - A path that does not realpath is `no-target`.
   - The second arguments of `git.diff`, `git.log`, `git.worktree.status` and `git.worktree.branch` are bounded by the
     services, as the spec says.
8. **Bounds are cached by the set of roots, not by a record revision.** `session.get` carries no revision, and the
   roots are what the bounds derive from, so a change of roots reads afresh (tested).
9. **The feed's `git.changed` filter uses the rule's admit predicate** (equal to, or under, a bound) rather than an
   exact `repoRoot` match. A device hears every repository it may watch, including a worktree nested under a root, and
   no other.
10. **A feed ends `behind` past its backlog,** a case §R did not name ("ends only with the channel, or `removed`"). A
    device that never refunds credit would otherwise grow the endpoint's queue without bound. The device's answer is
    to treat it as a reconnect (reopen, replay git watches, invalidate files watches).
11. **The bounds' path helper is local to `targets.ts`, not imported from `src/services/files/allowlist.ts`.**
    `withinBounds` is a three-line copy of `under`. The endpoint module imports nothing from `src/services` today, and
    it is a chunk of its own.

## TDD evidence

- **Protocol reader.**
  - RED: `npx vitest run test/messages.test.ts` (in `apps/org-protocol`) with `messages.ts` and `channel.ts` at HEAD:
    4 failed, 5 passed. The failures were the call-session case, the two feed cases and "is at minor 2".
  - GREEN: 9/9.
- **Offer rows.**
  - RED: `test/endpoint/checkout-rows.test.ts` with `offers.ts` at HEAD: 6 failed. For example,
    `expected [ 'git.status', 'not-offered' ] to deeply equal [ 'git.status', 'grade' ]`.
  - GREEN: 8/8; 9/9 with the older-host case.
- **Checkout rule and spawn guard.**
  - RED: `test/endpoint/checkout-rule.test.ts` with the path check disabled and the guard back on
    `name === 'sminos.spawn'`: 3 failed. They were the outside-path refusal, the roots-change case and the ceiling case.
  - GREEN: 10/10.
- **Feeds.**
  - RED: `test/endpoint/feeds.test.ts` without the feeds plane's event hook: 3 failed. They were delivery, the held
    change, and the watch's change on the feed.
  - GREEN: 6/6, with the `behind` case.
- **Caveat on order.** The protocol and the offer rows were written alongside their tests, and RED was taken by
  reverting the implementation, not before writing it.

## Tests run (after the all-clear)

- `pnpm typecheck` (node, web, e2e, desk-hub, desk-web, org-protocol): clean.
- `npx eslint` over every touched file: clean.
- The importers: `npx vitest related --run <every changed src file and the harness>`.
  - Result: 585 files, **9255 passed, 17 skipped, 2 failed**.
  - The 2 failures:
    - `src/main/org/weekly.test.ts`: "focus lost while `lastAsked` is written".
    - `src/services/index/source.test.ts`: "one summary that cannot be applied costs only itself".
  - Both re-ran green alone: 14/14 and 49/49. They timed out under the whole run's load (585 files at once).
  - I did not touch `src/services/index/`.
- `apps/org-protocol`, full suite: 18 files, 253/253.
- The new and changed endpoint suites: `checkout-rows` 9/9, `checkout-rule` 10/10, `feeds` 6/6, `grades` 32/32,
  `lane-b-rows`, `targets`, `subscription-table`, `subscriptions-b`, `actions` and `calls` all green.
- `src/services/index/index.test.ts` was not run: the controller ran it (24/24 at `1533da5cc`).

## Gate

- **Run 41244266133 on `6fb8cc3d6` (tree 146f8c6e): failure.** Two causes, both mine, both fixed in `9c7feb647`.
  - **static:** `maws-app-scan` flagged the literal UUID `scm` tokens in `checkout-rows.test.ts` and `feeds.test.ts`
    as `generic-api-key`. Both suites now mint the token with `randomUUID()`.
  - **unit 3/4:** `test/endpoint/acceptance-local.test.ts` failed on item 8. Its "not-offered" probe
    (`apps/desk-hub/deploy/endpoint-items.ts`) called `files.read`, which M4 now offers, so step 2 answered it
    `malformed`. The probe now calls `files.reveal`, which acts on the asking client and stays unoffered until M5.
- **Run 41245068113 on `9c7feb647` (tree 4478e8ba3d2c90e3f43adcfb8a7d701643390da8, equal to the head's): success.**
  static, unit 1–4/4, probes, and e2e:cross-build against peer 3adf9c97 (wire 3.12 against this tree's 3.13) are all
  green.
- **Not yet rerun locally:** the fix commit's three files (the token literals and one probe name). A second CPU hold
  began right after the fix. CI ran them green; I will rerun them locally at the all-clear if asked.

## Files changed

- Protocol: `apps/org-protocol/src/messages.ts`, `apps/org-protocol/src/channel.ts`,
  `apps/org-protocol/test/messages.test.ts`.
- Endpoint: `src/endpoint/offers.ts`, `targets.ts`, `authorize.ts`, `gate.ts`, `subscriptions.ts`, `plane-feeds.ts`
  (new), `endpoint.ts`, `actions.ts`, `capabilities.ts`.
- Device constant: `src/main/machines/remote/capabilities.ts`.
- The desk-hub acceptance probe: `apps/desk-hub/deploy/endpoint-items.ts` (item 8's not-offered name).
- Tests: `test/endpoint/checkout-rows.test.ts` (new), `checkout-rule.test.ts` (new), `feeds.test.ts` (new),
  `sub-harness.ts`, `subscription-table.test.ts`, `grades.test.ts`.
  - `grades.test.ts`' "not-offered" example moved from `files.read`, now offered, to `files.reveal`.

## New names the wave 2 interface ledger lacks

- **org-protocol:**
  - types `Feed`, `SessionSubMessage`, `MachineFeedSubMessage`;
  - `SubMessage` is now their union;
  - `CallMessage.session?`.
- **`src/endpoint/offers.ts`:** `TargetRule` gains `'checkout'`; `Offers.feeds`.
- **`src/endpoint/targets.ts`:**
  - `CheckoutBounds`, `CHECKOUT_BOUNDS_KEPT`, `withinBounds`, `withinCheckout`;
  - `resolveTarget`'s fifth argument, `session?`.
- **`src/endpoint/authorize.ts`:** `AuthorizeRequest.session?`, `AuthorizeContext.checkoutBounds?`.
- **`src/endpoint/plane-feeds.ts` (new shared file):** `PlaneFeeds`, `PlaneFeedsContext`, `HELD_REPOSITORIES`.
- **`src/endpoint/subscriptions.ts`:** `SubscriptionsContext.planes.feeds` (required).
- **`src/endpoint/endpoint.ts`:** `Endpoint.planeFeeds`, `Endpoint.checkoutBounds`.
- **`src/endpoint/gate.ts`:** `Gate.routes()`'s `sub` now takes a `SessionSubMessage`.
- **`src/endpoint/actions.ts`:** `KEPT_WITHOUT_ACTION`.
- **Test harness (`test/endpoint/sub-harness.ts`):**
  - `FakeEngineHost.emitMachine`;
  - `FakeSpine.handlers`, `.claimed`, `.handle`, `.bus`.

## What M4b (main) must do to consume this

- **`call.session`.** Send it only when the peer's `h2` lists `rl2.call-session` (`peerCapabilities()`). Without it, a
  `git.*` call has no session to place and is `no-target`. Against an older endpoint, `git.*` is `not-offered` anyway.
- **Feeds.** Send `sub {sub, feed: 'checkout', session: {lane: 'B', id: appSessionId}, cursor: null, credit}` only to a
  peer listing `rl2.feeds`. An older endpoint would read it as the session's own stream.
  - Send no `view` and no `idx`.
  - Treat every `subbed` as a fresh start, and dedup by `(epoch, seq)`.
  - Read `ev.body` as `{name, payload}` and emit it with `emitFrom(machine, name, payload)`.
  - An `ended {reason: 'behind'}` or `'unavailable'` means reopen, with the reconnect rules: replay `git.watch`, and
    emit `files.changed {kind: 'invalidated'}`.
  - An `ended 'removed'` or `'grade'` means stop.
- **Refusals on a checkout read.** `no-target` means a path outside the session's checkout, or no session.
- **The older engine host.** A budgeted `session.events` (`maxBytes`) can answer `invalid_input` when `mawsd` is serving
  an older engine host (wire 3.12) across a swap. Read that page again without `maxBytes`, on M2's path (a gap on
  `too-large`).
  - Against an older endpoint (no `rl2.call-session` in its `h2`), don't send `maxBytes` at all: it is `malformed` there.
    The two capabilities and M4a1's services ship in one build, so either capability marks a peer whose registry takes
    `maxBytes`. That is a proxy; if you want it explicit, it needs a capability of its own (a question for the
    controller).
- **Acts.** Every M4 write is a `machine` act in M2's second shape, with no `session` and no `context`. `session.spawn`
  must be stepped up (`step-up` otherwise). Its refusals:
  - `grade`: no `spawn` right;
  - `malformed`: an extra field or no `permission_mode`;
  - `ceiling`;
  - `unknown-checkout`.
- **The spawn's provenance.** `launchedBy.action` is the act as the device sealed it, step-up included.
- **Upload parts.** Give each part its own action (its own `opId`), and keep that op id for a resend. The ledger stores
  no action for an upload (decision 1).
- **The machine menu.** `session.projects.list` is a `list` call with no target; send `input: null`.

## Self-review and concerns

- `withinCheckout` reads `session.get` a second time after placement already read it. It is an in-process index read;
  I kept it for a narrower `Resolved` type.
- There is a TOCTOU between the realpath at authorization and the git service's own read of the path. Reaching it needs
  a write on the machine to swap a symlink, so it is not a remote-only exposure. The files service's own boundary is the
  stronger check for `files.*`.
- `CheckoutBounds` runs a full `git.status` per root on a cache miss. That is one per session per set of roots, and the
  feed shares the cache.
- `fs.agentEvents`: the harness's engine host answers it `unknown_command`. The test proves admission and routing, not
  the engine host's answer.

## Fix wave 1 (task review: three Important findings)

1. **`CheckoutBounds` follows the roots as they resolve now** (`src/endpoint/targets.ts`).
   - Each read realpaths the record's roots.
   - The cache key is the set of canonical roots, so a symlinked root retargeted since reads where it points now.
   - A set is kept only when every root resolved and every repository read answered. A root that resolves later is
     therefore read then.
   - Regression: `checkout-rule.test.ts`, "follows a root that is a symlink retargeted since, and a root that didn't
     resolve until later".
2. **The checkout feed across a change of roots** (`src/endpoint/plane-feeds.ts`).
   - At a `session.changed`, `#readBounds` sets the bounds to unknown synchronously, before anything else is
     delivered. This is the same held state as before the first read: `git.changed` waits, the latest per repository.
   - The held events are released only against the latest read's bounds. The existing read counter is the
     generation, so an older read that lands late is dropped.
   - Regression: `feeds.test.ts`, "across a change of roots…". It removes A and adds B with B's read held, emits A and
     B, and only B's change is delivered. Then two changes in a row, D (held) then C: D's read lands after C's, the
     bounds are C's, and only C's change is delivered.
3. **Placement no longer tells a caller below the floor that a session lags** (`targets.ts` `laneB`, `authorize.ts`
   step 4 and `#sub`, `queries.ts`).
   - A session with a recorded engine session is placed on it. A failed live check (the host runs another engine
     session, or can't answer) is now a flag on the placement, `Resolved.unavailable`, not an immediate refusal.
   - Authorization answers `unavailable` only after the caller stands at the floor on the recorded engine session
     (calls and acts, step 4, before the checkout path check) or at `view` (subscriptions). The 8-step order is kept.
   - The conservative choice:
     - The rank is checked on the **recorded** engine session.
     - A caller who doesn't stand on it is `grade`, even if they own the live engine session. Only the machine's index
       says what the session is, and a lagging live row is exactly what the check distrusts.
     - A caller who stands on it hears `unavailable` until the index catches up, so a rank on the live engine session
       never authorizes against the stale record, and the reverse never happens either.
   - Unchanged:
     - With no recorded engine session the live row is the only placement, and an engine host that can't answer is
       `unavailable` for every such session, known or not, so that answer reveals nothing.
     - A failing spine is `unavailable` for every session.
     - `queries.ts` treats a flagged placement as unplaceable, as before.
   - Regression: `checkout-rule.test.ts`, "answers a caller below view `grade` on a session whose live engine session
     isn't its recorded one, reading nothing of its checkout". It covers a git read, a lane B read and a checkout
     feed, each `grade` with no `git.status`. The owner of the recorded session hears `unavailable`.
   - M2's "lagging" case in `targets.test.ts` (the recorded session's owner hears `unavailable`) stays as it is.
4. **Report corrected:** decision 6 claimed nothing below the floor reads `session.get`. Placement does read it; what
   is not read is the checkout.

### Fix wave 1, addendum (the desk track's notes)

- **Fail-first test:** `test/endpoint/targets.test.ts`, in the describe "the engine session authorized is the one the
  request runs on", case "answers `grade`, not `unavailable`, to a caller who owns only the live engine session during
  the lag".
  - In `lagging()`, `a` owns only `eng-new` (live), and the index records `eng-old`.
  - `a`'s `session.status`, `session.get`, `sub`, `session.send` and `session.acquire` each answer `grade`. Nothing
    past placement's own reads (`session.get`, `session.status`) reaches the machine. Nothing runs, nothing is acquired.
  - Before the wave, each of these answered `unavailable`.
  - The existing case for `b` (who owns the recorded `eng-old`) still expects `unavailable`, as written.
  - `actions.test.ts:418` (a sealed context against the live one) is a different check and is unaffected.
- **`laneB()`'s doc comment** (`targets.ts`) now says `unavailable` is answered only to a caller who stands at the floor
  on the recorded engine session.
- **What changed, precisely, against O10's Decision Log entry of 2026-10-31 (#414).** Scope: a lane B session whose
  index record names an engine session.
  - **Before:** a mismatch between that recorded engine session and the engine host's live row was `unavailable` to
    every caller, before any rank check. So was an engine host that couldn't answer the live check.
  - **Now:** the request is placed on the recorded engine session. The mismatch, or the host's absence, becomes a flag:
    - **Calls and acts:** authorization reads the caller's standing at the command's floor on the recorded engine
      session first. A caller below the floor gets that refusal (`grade`, or `no-target` where the rank is needed and
      absent), whatever engine session they own. Only a caller who stands at the floor hears `unavailable`. This is
      still step 4, after the floor check and before the `checkout` rule's path check.
    - **Subscriptions:** the flag is answered `unavailable` after the `view` check (or the ownership check for
      `cards`); a caller who fails that check gets `grade`, or `class` for web-cards.
    - **Queries:** they read a flagged placement as unplaceable, as before.
  - **Unchanged:**
    - A session with no recorded engine session is placed by the live row alone, and is `unavailable` for every
      caller when the engine host can't answer. That answer is the same for a known and an unknown session.
    - A failing spine is `unavailable` for every session.
    - An engine-host act still skips the live check at placement (`live: false`), and `actions.ts`' context check
      still refuses a lag `unavailable` after authorization.
  - So #414's "a request against a lagging index is `unavailable` until it catches up" now holds only for a caller with
    rank at the floor on the recorded engine session.
- **Not run (CPU hold):** the new test and everything in this wave. The run commands are listed in the hand-back.

### Fix wave 1, test results (after the 22:20Z all-clear; head 3d8cf6e25, with M4b's commits and uncommitted work in the worktree)

- **The touched endpoint suites, one run:** `targets`, `checkout-rule`, `feeds`, `checkout-rows`, `lane-b-rows`,
  `grades`, `subscriptions-b`, `actions`, `queries-machine`, `calls`, `subscription-table`.
  - 11 files, **165/165 green on the first run**.
  - The new fail-first lag case, the symlink and late-root case, the roots-change feed case and the below-view
    mismatch case all pass.
- **`pnpm typecheck`:** clean, with the controller's `9cf6c887c` (`placed` narrowed to the session kind) in.
- **eslint** over this wave's files: clean.
- **`test/lane-b/remote.test.ts`:** 22 passed, 2 failed. Both failures are in M4b's new cases, and neither comes from
  this wave.
  - **"follows git and files watches over the checkout feed…"**
    - Error: `files.watch: internal invalid output of files.watch: expected void, received null`.
    - Cause: the endpoint's `calls.ts` answers a call's output as `response.value ?? null`. That line dates from O10
      M8 and is unchanged here, because RL2's `result` must carry `output` and JSON has no `undefined`.
    - So every `void` command crosses as `output: null`. `files.watch` and `git.unwatch` are the first `void` commands
      offered as calls.
    - The fix belongs on the device side. Main should read `null` as `undefined` for a command whose output schema is
      `z.void()` before it validates the output. This is M4b's adapter or its dispatch over the link.
  - **"hydrates a live launch over 4 MiB in budgeted pages…"**
    - Error: `expected false to be true` at `remote.test.ts:883`. The test asserts that every `session.events` the
      host was asked carried `maxBytes`, and at least one did not.
    - The endpoint forwards `session.events`' input to the engine host as given (`calls.ts`, unchanged), so this is
      about which reads main sends unbudgeted (likely the pane's opening read). It is M4b's.
- **CI:** run 41246661836 on `2e3ad1cf4` passed unit 1–4/4, probes and cross-build. Its static job failed on TS2322
  (the spread onto `placed`), which the controller fixed in `9cf6c887c`. That fix's gate, `o7-m4a2-fix2`, is the
  controller's.
