# P5-O18 — Message reach: who may message a session's agent (2026-11-05)

> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (the P5 composite), child **O18**, §"O18: Message reach (desk side)". Parent pin: blob `ff752cccce6b73ca021c196bee91b55b09082551` at master `a168273fc`. Binding on this child:
> - P5 Decision Logs 219 (the owner's direction) and 223 (the owner's ruling: reach is visibility, a `list` share shown as "Can message", `listed` stays the default), and §7 as amended there;
> - the remote layer `docs/doperpowers/specs/2026-10-26-remote-layer-design.md` (cited *RL §n*): §5.5 (grades), §5.7 (signed log events), §5.8 (default owners and peer messages), §6.2 (visibility), RL1 (the relay), RL6 (the session record), RL8 and RL9 (signing and the owner attestation), RL10 (endpoint ↔ sminos). This child amends several of them; the amendments are listed under "RL amendments" below and recorded in the Decision Log;
> - OX1 (P5 §"Cross-cutting": additive change within a major, `capabilities` on hellos).
>
> **Owner:** p5-desk-track-owner (the desk track). **Repositories:** MAWS holds the hub (`apps/desk-hub`), the shared protocol (`apps/org-protocol`), the endpoint (`src/endpoint`), the `list` share grade, and O8's share UI. doperpowers holds sminos (`sminos/skills/sminos/scripts/`, `sminos/tests/`). This corrects P5's O18 "Repos" line, which put the hub in doperpowers; the architect folds the correction into P5. MAWS lands first whenever both repos change, and every new field stays optional. This document is the child's standalone record. Residue decisions go to P5's Decision Log under O18, through the P5 writer.

## Purpose

Today any org member's agent can message any session: a peer `sminos say` is never checked for reach, and every org machine's logs carry every session's existence. Once a second person joins, that is wrong for a person who keeps a session to themselves.

After O18:
- a person sets a session `listed` so other people's agents can talk to it;
- a session set `private` takes messages only from its owners' agents;
- a `private` session shared as **Can message** takes messages from the named people's agents, and they can't read its transcript;
- a private session's events don't reach the machines of anyone else in the org.

Messages among one person's own sessions are never restricted. With the org as the owner alone, nothing visible changes until a second member joins, and O18 has to land before that happens.

**To see it working**, use the staging org (`staging-ssfskim`) with a second member and a second machine enrolled under that member:
- set a session private with `sminos access <session> private`;
- from the second member's session, `sminos say "@<short> hi"`: it answers `no member named …`;
- a forged copy of that `say` gets back a `not-reachable` notice;
- the second machine's log files hold no trace of the private session.

Then `sminos share <session> <member> list` (run by the owner at a terminal): the second member's agent now sees the session and messages it, while their transcript read is refused.

## Progress

- [x] (2026-11-05 20:40Z) Document written from the desk track's draft (`notes/477-message-reach-design.md`), the architect's amendments (sminos chat 1128, 1131) and two read-only mappings of today's code.
- [ ] Spec review (one independent reviewer) and the execution section's buildability review.
- [ ] M1: the hub filters by audience (MAWS).
- [ ] M2: the endpoint: the `list` grade, `reach?`, the audiences (MAWS).
- [ ] M3: sminos's visibility, setters and audience streams (doperpowers).
- [ ] M4: reach at delivery, refusals and unlisting (doperpowers).
- [ ] M5: O8's share picker and help text (MAWS; handed to the architect).
- [ ] M6: live acceptance on the staging org.

## Today (what this child changes)

Read on sminos 1.34.0 and MAWS master `b7e7d9594`/`a168273fc`.

1. **A peer message is never checked for reach.**
   - `deliver_next` (doperpowers `sminos/skills/sminos/scripts/sminos.py:4099`) checks the holder receipt gate, revocations and the read-only policy, then pushes to the recipient's inbox. The sender's CLI (`:5066`) and the retry loop (`:10115`) reach it too.
   - Only `human` events are put to the endpoint (`words?`, MAWS `src/endpoint/rl10/words.ts:49-85`).
2. **Visibility never leaves sminos.**
   - `member_frame` (`sminos_uplink.py:1355-1385`) sends no `access` or `shares`, and the endpoint reads a missing `access` as `listed` (`src/endpoint/grades.ts:40`).
   - An unknown share grade makes `readMember` (`src/endpoint/rl10/members.ts:60-73`) reject the whole member frame.
3. **The logs list every session to the whole org.**
   - A session's `joined`, `state`, `titled` and `renamed` events, and every `say` addressed to it, sit in the hub log of its project.
   - The hub's `fanOut` (`apps/desk-hub/src/objects/project.ts:1206-1215`) sends every accepted event to every machine and browser that follows the project.
   - `hello` (`:405-437`) answers the full writer vector (`have`) and the backlog.
   - Only the hub listing (RL6) honours `private`.
4. **A hidden event would stall the log.**
   - sminos imports each writer strictly by seq (`sminos_hublog.py:249-270`): an event past a hole is held back until the hole is filled.
   - So filtering single events per reader would leave a writer stalled for good. RL §6.2 says so, which is why the log plane was declared org-readable.
5. **The receiving machine knows the sender.**
   - The sending machine's key signs each event together with its `attest` (`owners`, `ownersProof`; MAWS `src/endpoint/rl10/attest.ts`, `apps/org-protocol/src/attest.ts`).
   - The receiving endpoint verifies them and hands sminos `verified: {signer, owners}`.
   - sminos holds no org state, so it can't resolve `@machine` owners or grades; the endpoint can (`resolveOwners`, `src/endpoint/listings.ts:91-100`).
6. **Nothing comes back to a sender.** The CLI prints `recorded (on <machine>)`. Outcomes on the recipient's machine stop at its endpoint (`src/endpoint/rl10/link.ts:16-20`).

## Design

The binding rules are P5's O18 section. What follows is that design as built here, with the means the architect accepted on 2026-11-05 and the alternatives each one beat.

### D1. Reach is visibility

A member's agents may message a session when the member's rank on it is at least `list` (`sessionRank`, `src/endpoint/grades.ts:36-45`):

| The session | Who may message it |
|---|---|
| `listed`, `org-view` or `org-converse` | any member's agents |
| `private` | its owners' agents, plus the agents of members it is shared with at any grade |

- **The `list` share.** It is a new share grade, the lowest, shown as **Can message**. It lets the member's agents see and message the session, and gives no transcript read (`view` and up do). `listed` stays the default.
- **Rejected:** a separate reach setting (the owner declined it, Decision Log 223), and K1 without the `list` grade, which would have forced a transcript grant to let someone's agent message.

### D2. Same owner first; operator events

- **Same owner.** The sender's verified owners intersect the recipient's resolved owners. Then reach is never checked.
- **Owners are per session.** A session another person spawned on my machine is theirs, so it is no "same owner" of mine.
- **Operator events.** An event with no attest takes its machine's owners as the sender, as `decideWords` reads it: a `<machine>/human` line, or a `say` run in a terminal outside any session.

### D3. The receiving endpoint decides

- **Where the ask happens.** sminos's `deliver_next` asks its endpoint `reach?` before it pushes any peer message (`say`, `send`, and wakes). The ask carries the event's writer, its `verified` block, the project and the recipient session.
- **What the endpoint does with it.** It decides by D1 and D2 from its org state and the recipient's record.
- **Failing closed.**
  - An endpoint that can't be asked leaves the delivery owed, retried on each tick like any owed delivery.
  - An unverified sender reaches only a session every member may message (`listed` or org-wide).
- **sminos holds no grade logic.**
- **Rejected:** sminos deciding alone from owner sets pushed down to it. That would duplicate the grade rules in Python and let the two copies drift.

### D4. The sender's check is resolution

- **What the sender sees.** A sender's projection of the logs holds only the sessions its person may see (D6), so a tag naming a private session it isn't shared on fails as `no member named …`, the same words as for a session that doesn't exist. A broadcast (`@all`, `--org`, `--project`) wakes only what it sees.
- **Private senders.** A private session's own agent may message only sessions whose owners are in its own audience:
  - sessions of its owners;
  - sessions of members it is shared with.

  Every event it writes carries its audience (D6), so a message to anyone outside it would be invisible to the recipient's machine. The sender's CLI refuses it before anything is written: `<alias> can't be reached from this session: this session is unlisted; share it as Can message with <person> first`. Messaging out never grants an implicit reach back (the architect's ruling, 2026-11-05).

### D5. A refusal comes back as a signed event

When `reach?` refuses, the recipient's sminos settles the delivery `refused-reach` and appends a `refused` event to the recipient's project log:
- **Its shape:** `{kind: 'refused', of: '<writer>:<seq>', to: [<sender session>], reason}`.
- **Its audience** (D6): the sender's latest audience when the sender is private, else the sender's owners.
- **Its writer:** the recipient's stream for that audience, `<machine>/<recipient session>~<digest>`.
- **At the sender's machine:** its daemon delivers it to the sending session as a notice: `[sminos: your message to <alias> was not delivered: <reason>]`.
- **Reasons:**
  - `not-reachable` covers both "unlisted" and "gone private", one word for both, so a reason never confirms more than the sender already knew;
  - `unverified` is for a sender with no verified identity.
- **When the hub refuses instead** (D7's backstop): the sender's endpoint reports the refusal down as a `spent` with reason `audience`, and sminos tells the sending session the same way.
- **Rejected:** an outcome lane from the receiving endpoint through the hub. It would need a new RL message and hub routing for one notice, and the log path already carries signed, ordered, retried events.

### D6. Audience streams: unlisted means the logs don't carry it

- **What an audience is.** Every event of a private session carries a signed `audience`: the member ids whose rank on it is at least `list`, sorted. The sending machine signs it inside the event, as it signs `attest`.
- **Which events carry it:**
  - the session's own events (`joined`, `state`, `titled`, `renamed`, its `say`s);
  - events addressed to it;
  - the `refused` events of D5.
- **No audience:** an event of a `listed` or org-wide session. Its fan-out is unchanged.

**The audience belongs to a writer stream, not to an event.** Since sminos imports each writer strictly by seq (Today 4), an event with an audience is written under its own writer, `<machine>/<session>~<digest>`.
- The digest is the first 16 hex characters of SHA-256 over the canonical sorted member-id list (`audienceDigest`, Interfaces §A).
- It is still the machine's own writer (the hub takes from a machine only `<machine>/…`), and every event in one stream has one audience.
- **What the hub filters:** whole writers, never single events. A reader outside a stream's audience gets none of its events, no entry for it in `hello`'s `have`, and no stub.
- **Why it can't stall:** no writer a reader can see ever has a hole.

**Rejected alternatives:**
- **Per-event filtering with content-free `spent` stubs.** It would unstall the import, but every stub, and the `have` vector, would name the private session's writer into other people's `uplink.json`, against acceptance 3. The tombstone list would also grow with every hidden event.
- **A private project per person.** It would need project-level follower rules and would split a session across two projects, which every resolver would then have to know.
- **Hiding it in the UI only.** Any member's agent reading its own machine's logs still sees the session. It is a stopgap only while the org has one member.

**Streams change only on a person's action, or a send to a new audience.**
- A session's audience changes when its owners or shares change or it changes access. Each change starts a new stream; the old stream keeps its old signed audience.
- A sender's addressed events open one stream per distinct recipient audience.

So a session's stream count is bounded by its owners' changes plus the distinct audiences it messages, which is at most the number of private sessions its person can see. That needs no cap. The hub's per-writer rows and sminos's per-writer files grow by one per stream.

**Changes over time:**
- **Going private** writes one org-wide `unlisted {session}` event, so every other projection drops the session. It's the log's form of RL6's `gone` revision.
- **Removing a share** writes an `unlisted` event in a stream audienced to the removed member alone.
- **A new share or a raised grade** writes a fresh snapshot (`joined` and `state`) into the new stream, so the new audience learns of the session.
- **Going listed** again writes the session's next events under its plain writer, `<machine>/<session>`.
- **History already fanned out is not taken back.** The app says so where `private` is set (M5). The hub log's git archive keeps everything, and it is the org's.

### D7. Who computes an audience, and the hub's backstop

- **A session's own events.** Its endpoint computes the audience from the session record and the org state:
  - its resolved owners, with `@machine` expanded;
  - plus every share's member, at any grade.

  The endpoint tells sminos each local private session's audience and digest (an RL10 `audience` frame), so sminos writes the event under the right stream before the endpoint signs it. At signing, the endpoint checks that the writer's digest matches the audience it computed. A mismatch is refused at upload as `spent` with reason `audience`, and the audience is frozen in the signature ledger at first signing.
- **An event addressed to another machine's private session.** The sender's endpoint copies the recipient's audience from the newest verified event of the recipient it has relayed down (the inbound index). A sender who can address the recipient has those events (D4).
  - A `say` to recipients of different audiences is split by sminos into one event per audience.
  - An event whose recipients' audiences differ is refused at signing.
- **A device's `hub/<member>` event** addressed to a private session takes the session's audience the same way. Desk-web and the app hold the session's verified events. This is consumed by M2's interfaces.
- **The hub is the backstop.** It records each session's latest audience: the audience of the newest `joined` or `state` event the session's machine wrote for it, or none when that event came under its plain writer. Only those snapshot kinds count, so a `refused` event or an addressed copy never moves it. It refuses at upload an event whose `to` names a session whose latest audience is set, unless the event's audience equals it. This catches:
  - an old endpoint that stamps no audience;
  - a forged event;
  - a sender whose copied audience is stale, as after a share removal.

  The refusal is the `audience` reason of D5. The audience compared is the latest the hub holds when the upload arrives.

### D8. Versions and order (OX1)

- **The hub deploys first**, to staging and then to production. Production is the owner's to deploy (P5 Decision Log 40).
- **The hub advertises it.** The hub's RL1 welcome gains an optional `capabilities: ['audience']`.
- **An endpoint without it upstream** keeps a private session's events owed instead of uploading them. The session goes quiet to its own other machines until the hub is updated, which fails closed.
- **The endpoint lands before sminos sends visibility.** Its RL10 hello gains `capabilities: ['access', 'reach']`. sminos sends `access`, `shares` and the `list` grade, makes the `reach?` ask, and writes audience streams only when its endpoint advertises them. That matters because an old endpoint rejects a whole member frame on an unknown grade (Today 2).
- **An old sminos on a reader's machine** gets only what the hub serves it. The filter sits at the hub, so it needs no change.
- **A session can be private only on a machine running an O18 sminos**, since the setters (D9) and the `access` field live there. So the recipient's side of `reach?` is always new where it matters. An old sminos elsewhere is only ever a sender or a reader, and the two points above cover both.

### D9. The setters

The app's share picker is O8 M6, and it isn't built (`docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md:1029-1036`). So O18 adds two sminos verbs:

    sminos access <member> private|listed|org-view|org-converse
    sminos share <member> <person> list|view|converse|approve|none

- **Where they act.** They act on the session's record on its own machine (`session-records/<sid>.json`), and the endpoint restates it.
- **Narrowing is open to anyone in a session's shell:** going private, removing a share, lowering a grade.
- **Widening only from the owner's terminal:** going listed or org-wide, adding a share, raising a grade.
  - Widening runs only as the operator: no `CLAUDE_CODE_SESSION_ID`, with a confirmation read from `/dev/tty`, as Decision Log 28 does for signing.
  - From a session it is refused: `widening reach needs its owner: run this in a terminal, or use MAWS`.

  An agent can't open a session to more people than its owner chose.
- **Rejected:** a step-up signed widening through the device, as for owner changes (Decision Log 219's list). It's right for the app's picker, which M5 builds that way, but it needs the app. The operator's terminal is the same trust that already admits signing.

### RL amendments

Written into `docs/doperpowers/specs/2026-10-26-remote-layer-design.md` in M1. Each is recorded in the Decision Log below.

| Where | Today | After O18 |
|---|---|---|
| §5.5 grades (~:401) | `list`: "see in listings" | `list`: see in listings and message the session's agent (D1) |
| §5.8 (:446) | "There is no recipient policy, narrowing or off switch" | reach is visibility (D1–D3); the receiving endpoint decides |
| §5.9 (:475) | the log plane is "org-readable by design" | org-readable except a private session's audience streams (D6) |
| §6.2 (:524-550) | shares `view`/`converse`/`approve`; log filtering ruled out; a private `say` stays org-readable | the `list` share ("Can message"); audience streams filtered per writer; a private session's traffic reaches only its audience |
| RL1 welcome (`apps/org-protocol/src/relay.ts:102`) | `{t, generation, heartbeat_ms}` | optional `capabilities` (D8) |
| RL6 (:793) | `shares[{member, grade}]` | grade `list` added |
| RL8/RL9 (:805, :816) | attestation only | optional signed `audience`; writer streams `<machine>/<session>~<digest>`; kinds `refused` and `unlisted` |
| RL10 (:819) | no reach | `reach?`/`reach`, the `audience` frame, `capabilities` on the hello |

## Acceptance

On the staging org `staging-ssfskim` with a second member, added for the run and removed after (`apps/desk-hub/deploy/README.md:281`), and a second machine enrolled under that member (a devcloud VM):

1. A person's own sessions message each other across machines, whatever their visibility, private included.
2. The second member's agent resolves and messages a `listed` session. The message arrives as a peer message with its owner label and counts as nobody's words.
3. Once a session goes `private` with no shares:
   - **Nothing new reaches the second machine.** That machine receives none of its later events. `sminos list --org`, `find` and `@short` don't name it, and the machine's log files and `uplink.json` carry none of its writers.
   - **A forged `say`** sent to it is refused, and the sending session gets the `not-reachable` notice.
   - **A share removed, then a stale `say`.** The second member is shared, the share is removed, and their session then sends a `say` from a view that still holds the session. The hub refuses it at upload, and the sender gets the notice; the session never receives it.
4. **A Can message share.**
   - **What it opens:** the second member's agents see and message the session, while the member's transcript read is refused.
   - **When it is removed:** the session drops out of their projection.
5. With the recipient's endpoint unreachable, a peer message stays owed and is delivered once the endpoint answers.
6. No mix of versions the org can run fans a private session's event out to a machine outside its audience:
   - an old hub (the endpoint holds the events);
   - an old endpoint upstream (the hub refuses);
   - an old reader (the hub filters).
7. A private session's agent messaging a session outside its audience is refused at its own CLI with the unlisted message (D4), and nothing is written.
8. From an agent's shell, `sminos share <s> <person> view` and `sminos access <s> listed` are refused. `sminos access <s> private` from the same shell succeeds.

## Constraints that bind every milestone

- **Fail closed:** an unanswered ask leaves a delivery owed, and a missing capability holds the events back.
- **Optional fields:** every new field is optional, and MAWS lands first.
- **Same owner:** a person's own sessions are never restricted among themselves.
- **One audience per writer:** a writer stream carries exactly one audience, and the hub filters writers, never single events.
- **No new grade logic in sminos.**
- **Narrowing is open, widening needs the owner** (D9).
- **Reviews:** reviewer-high with a security lens on every landing that touches `reach?`, an audience, or the hub's fan-out (P5 O18 Review).
- **The machines:**
  - No machine.sock client on the MacBook's daemon, and MacBook app swaps only on the owner's word.
  - Production hub deploys and org-state signing stay the owner's.
  - A cua_repl hold on the MacBook stops heavy local work until its all-clear.

## Plan of Work

### M1 — The hub filters by audience (MAWS)

**Scope.** The hub learns writer streams and audiences, and serves each stream only to its audience. It also refuses an un-audienced or stale-audienced event addressed to a private session, and advertises the capability.

**Work.**
- **`apps/org-protocol`:**
  - `audienceDigest(members: string[]): string` (Interfaces §A) and `streamOf(writer)` (the base writer and the digest);
  - the optional `audience` on the event types;
  - `capabilities` on `Rl1Welcome`;
  - vectors in `apps/org-protocol/test/vectors.test.ts`.
- **`apps/desk-hub/src/objects/project.ts`, `upload` (`:445-525`):**
  - An event with an `audience` must sit under a writer whose digest matches; otherwise refuse it with reason `audience`.
  - Record each session's latest audience in a new table, `audiences(session, digest, members, at)`.
  - Apply D7's backstop to every event whose `to` names a session with a latest audience. The `to` entries carry the session id.
- **`fanOut` (`:1206-1215`), per recipient:**
  - A machine row gets a stream only when the machine's owners intersect the stream's audience. Use `machineOwners` with the `SignedEvents` head, which needs a read accessor on its `held`.
  - A browser socket gets it only when its `attachment.member` is in the audience.
- **`hello` (`:405-437`):** filter `have` and the `beyond` backlog per reader the same way, and filter the browsers' offset `resume` (`:1132-1150`).
- **The welcome:** `capabilities: ['audience']`.
- **The remote-layer spec:** the RL amendments table above, written into the spec's sections.

**Result.** A staging hub that never serves a private stream outside its audience.

**Proof.** Red first, in `apps/desk-hub/test/log.test.ts` and `signed-log.test.ts`:
- **Filtering:** a stream with audience {A} is served to A's machine and browser and to no one else, in live fan-out, `hello`'s `have`, its backlog and browser resume.
- **Reader position:** a reader outside the audience sees the plain writer of the same session continue with no hole.
- **The backstop:** an addressed event without the session's latest audience is refused; after a share removal, an event carrying the old audience is refused.
- **Mismatch:** a writer whose digest doesn't match its audience is refused.
- **The welcome** carries the capability.

Gates `static,unit` (`scripts/ci-gate.sh <wt> --gates static,unit`), then a staging deploy (`apps/desk-hub/deploy/staging-deploy.sh`). Review: reviewer-high, security lens.

### M2 — The endpoint: the `list` grade, `reach?`, the audiences (MAWS)

**Scope.** The endpoint decides reach, computes and signs audiences, and holds private events back from a hub without the capability.

**Work.**
- **The grade:**
  - `Share.grade` gains `'list'` (`src/endpoint/sources.ts:15`), and `SHARE_GRADES` in `src/endpoint/rl10/members.ts:54`;
  - `sessionRank` already maps it once the type allows it (`src/endpoint/grades.ts:36-45`);
  - check that a `list` share grants no `view`-gated RPC (OX9's namespace grades).
- **`reach?`:**
  - `decideReach` in a new `src/endpoint/rl10/reach.ts` beside `words.ts` (Interfaces §B), dispatched at `link.ts:464` like `words?` and answered once;
  - it re-decides if the head or the recipient's record moves while it decides, as `#words` does (`link.ts:553-579`).
- **Audiences:**
  - computed per local private session: resolved owners (`resolveOwners`, `src/endpoint/listings.ts:91-100`) plus every share's member;
  - sent to sminos as `audience {session, members, digest}` on every change and after each welcome.
- **Signing** (`src/endpoint/rl10/log-relay.ts` `#upAt`, `:270-304`):
  - an event under a stream writer must carry the audience the endpoint computes for it, or the one copied for an addressed remote private recipient;
  - copy that recipient's audience from the newest verified event of the recipient in the inbound index (`src/endpoint/rl10/inbound-index.ts`);
  - refuse a mismatch, or recipients of differing audiences, as `spent {reason: 'audience'}`;
  - add `audience` to `ENDPOINT_ADDS` (`signature-ledger.ts:31`) so sminos can't supply one, to the ledger's `Signature`, to `rebuilt()` (`log-relay.ts:491-493`) and to the echo comparison (`:462`), so a resend is byte-identical and the audience is frozen at first signing.
- **Hold:** while the RL1 welcome lacks `audience`, keep stream events owed.
- **The hello:** RL10's endpoint hello gains `capabilities: ['access', 'reach']`.

**Result.** An endpoint that answers `reach?` by D1 and D2, signs only well-formed audience streams, and never uploads a private stream to a hub that can't filter it.

**Proof.** Red first:
- **`test/endpoint/rl10/reach.test.ts`** (new), the table of D1 and D2:
  - same owner across machines;
  - operator event;
  - listed;
  - private with a `list` share, with a `view` share, with none;
  - unverified sender;
  - the recipient's record moving mid-decision.
- **`test/endpoint/grades.test.ts`:** `list` grants message reach and no view.
- **`uplink.test.ts`, the signing cases:**
  - a mismatched digest refused;
  - a copied audience;
  - differing recipient audiences refused;
  - the ledger keeping the audience across a resend;
  - the hold without the capability.
- **`conversation.local.test.ts`** replays a private session against a local hub (Miniflare) built from M1.

Gates `static,unit` plus the conversation replay. Review: reviewer-high, security lens. The MacBook's and the mini's app builds swap on the owner's word, at the next convenient build.

### M3 — sminos's visibility, setters and audience streams (doperpowers)

**Scope.** sminos sends visibility, gives the owner its setters, and writes private sessions' events under audience streams.

**Work.**
- **`member_frame`** (`sminos_uplink.py:1355-1385`) sends `access` and `shares` when the endpoint advertises `access`.
- **The verbs** `sminos access` and `sminos share` (D9) write the session record and restate it. Widening is operator-only, with confirmation at `/dev/tty`.
- **The `audience` frame:** keep each local session's audience from it (in the uplink state).
- **Streams:**
  - a writer is `<machine>/<session>` or `<machine>/<session>~<digest>`;
  - `lifecycle`, `publish_state`, the title and rename paths, and `cmd_say`'s `log_append` choose the stream by D6 and D7;
  - an addressed event takes the recipient's audience from its latest verified event in the local projection, and a `say` is split per audience;
  - projections, `addressed_to` and `match_members` map every stream of a session to that one session.
- **The private sender's refusal (D4)** happens in `cmd_say` before any append.
- **Snapshots and `unlisted`:** going private, removing a share, and a new share or a raised grade write D6's `unlisted` event and snapshot.
- **The test stand-in:** `sminos/tests/hub_standin.py` filters by audience as M1's hub does (`fan_out`, `:430`; and its hello), so sminos's suites run against the same rule.

**Result.** On a machine with an M2 endpoint and an M1 hub, a private session's events travel only in its streams, and its owner controls its reach from a terminal.

**Proof.** Red first, in `sminos/tests/`:
- **The setters:** an agent's shell running `sminos share <s> <person> view` and `sminos access <s> listed` is refused, and `sminos access <s> private` from the same shell succeeds (acceptance 8).
- **Streams:** every event of a private session lands in its stream; a share change starts a new stream; going listed returns to the plain writer.
- **Addressed events:** an addressed `say` carries the recipient's audience; two private recipients make two events.
- **Refusal:** a private sender to a recipient outside its audience is refused with nothing written (acceptance 7).
- **Projection:** a member reading only the plain writers never names the private session, through the stand-in's filter.
- **Old endpoint:** no `access` capability means nothing new is sent.

Gates `sminos,sminos-suites,sminos-mods,mods-types,repo-checks`. Review: reviewer-high, security lens (it touches audiences). sminos minor bump.

### M4 — Reach at delivery, refusals and unlisting (doperpowers)

**Scope.** The receiving side: `reach?` before every peer push, the `refused` event and the sender's notice, and projections that honour `unlisted`.

**Work.**
- **`deliver_next`** (`sminos.py:4099`): for kinds `say`, `send` and wakes, ask `reach?` (Interfaces §B) after the revocation and read-only checks and before the push, when the endpoint advertises `reach`.
  - No answer within `REACH_WAIT` (10 s, as `WORDS_WAIT`) leaves the delivery owed.
  - `refuse` settles it `refused-reach` (a new outcome in `sminos_outcomes.py`) and appends the `refused` event (D5).
  - Same-machine pushes from the CLI (`:5066`) take the same path.
- **The sender's machine** delivers a `refused` event addressed to a local session as a notice frame. It does the same for a `spent {reason: 'audience'}` of its own upload.
- **Projections** drop a session at an `unlisted` event visible to the reader.

**Result.** A message outside its reach never reaches the session, and its sender learns why in one word.

**Proof.** Red first:
- refused for each D1 refusal, delivered for each grant;
- owed while the endpoint is silent, then delivered (acceptance 5);
- the notice at the sender for both refusal paths;
- a broadcast skipping what it can't see;
- `unlisted` dropping the session from `list --org`, `find` and `@short` resolution.

Gates as M3. Review: reviewer-high, security lens.

### M5 — O8's share picker and help text (MAWS; handed to the architect)

**Scope.** O8 M6's share picker gains the **Can message** level, and visibility's help text says what O18 made true:
- a private session's agents talk only within its audience;
- what was already shared stays shared;
- the old "say messages stay org-readable" warning (O8 document `:1032`) is gone.

Widening through the picker is signed with step-up, as owner and share changes are (Decision Log 219). It consumes M2's grade and M3's record fields. **Proof:** O8's own e2e for the picker. The desk track hands this milestone to the architect, who builds O8.

### M6 — Live acceptance on the staging org

**Scope.** Acceptance 1–8 run live.
- **Who's on it:** the owner's MacBook session; a devcloud VM enrolled under a second staging member added for the run (`apps/desk-hub/deploy/staging-run.sh endpoint-vm setup|teardown` and `admin …`); the M1 hub deployed to staging.
- **What's recorded:** each item with its evidence (a transcript line, a file listing showing absence, an outcome row) in this document's Surprises or Outcomes.
- **Teardown:** the second member is removed and the VM torn down after the run.
- **Production:** M1's production deploy is the owner's, and it waits for this proof.

## Concrete Steps

Working directories are worktrees under `/Users/new/.local/share/p5-desk-track-owner/wt/`.

    # MAWS milestones (M1, M2), from the worktree:
    bash <wt>/scripts/ci-gate.sh <wt> --gates static,unit
    # expected: one PASS per gate, then GREEN <run-url>

    # the hub to staging (M1), agent-runnable:
    zsh <wt>/apps/desk-hub/deploy/staging-deploy.sh

    # sminos milestones (M3, M4), from the doperpowers worktree:
    /Users/new/.claude/plugins/cache/doperpowers/ci-kit/<ver>/bin/ci-gate <wt> --gates sminos,sminos-suites,sminos-mods,mods-types,repo-checks
    # expected: GREEN <run-url>

    # live acceptance (M6):
    zsh <wt>/apps/desk-hub/deploy/staging-run.sh endpoint-vm setup
    devcloud vm ssh <vm> < <script>      # the second member's session's commands
    zsh <wt>/apps/desk-hub/deploy/staging-run.sh endpoint-vm teardown

The gates run on GitHub Actions; the MacBook runs no MAWS Electron e2e.

## Interfaces and Dependencies

### A. Streams and the audience (`apps/org-protocol`, M1; read by M2 and M3)

    audienceDigest(members: readonly string[]): string
      // sha256 over JSON.stringify([...new Set(members)].sort()), first 16 hex chars, lowercase
    streamOf(writer: string): { base: string; digest: string | null }
      // "<machine>/<session>~<digest>" -> { base: "<machine>/<session>", digest }
    // event (optional fields, inside the v2 signature):
    audience?: string[]          // sorted member ids
    // kinds (sminos log events):
    { kind: 'refused', of: string /* writer:seq */, to: [{session, alias}], reason: 'not-reachable' | 'unverified' | 'audience' }
    { kind: 'unlisted', session: string }
    // RL1:
    Rl1Welcome.capabilities?: string[]       // 'audience'

sminos computes `audienceDigest` identically in Python, `hashlib.sha256(json.dumps(sorted(set(m)), separators=(',', ':')).encode())`, and a shared vector in `vectors.test.ts` and `sminos/tests/` pins the two together. Use the same JSON separators on both sides.

### B. RL10 (M2 ↔ M3/M4)

    sminos → endpoint:  {t: 'reach?', id, project, session /* recipient */, event /* as stored, with verified */}
    endpoint → sminos:  {t: 'reach', id, verdict: 'deliver' | 'refuse', reason?: 'not-reachable' | 'unverified'}
    endpoint → sminos:  {t: 'audience', session, members: string[], digest} | {t: 'audience', session, members: null}   // null: listed again
    endpoint hello:     capabilities?: string[]   // 'access', 'reach'
    member frame:       access?: 'private' | 'listed' | 'org-view' | 'org-converse'; shares?: [{member, grade: 'list'|'view'|'converse'|'approve'}]

`decideReach(ctx: WordsContext, ask) → 'deliver' | {refuse: reason}`, in `src/endpoint/rl10/reach.ts`, takes the same context as `decideWords`.

### C. sminos (M3, M4)

`sminos access <member> <level>` and `sminos share <member> <person> <grade|none>` (D9). Outcome `refused-reach`. `REACH_WAIT = 10`.

## Surprises & Discoveries

- Observation: filtering single events would stall every reader's import, because sminos holds back any event past a per-writer hole. RL §6.2 already relied on that to declare the log plane org-readable.
  Evidence: `sminos_hublog.py:249-270` (`append_verbatim` → `"gap"`), RL spec `:542`.
- Observation: the sender's endpoint can't know a remote private session's audience on its own, and neither can a device. Only the recipient's own verified events carry it.
  Evidence: the endpoint knows only local sessions' records (`src/endpoint/rl10/members.ts`); the hub holds no session visibility (`apps/org-protocol/src/types.ts:113-119`).
- Observation: an old endpoint rejects a whole member frame on an unknown share grade, so sending the `list` grade early would fail closed for everyone on that machine.
  Evidence: `src/endpoint/rl10/members.ts:70`.
- Observation: the share picker O18's UI needs is unbuilt.
  Evidence: `docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md:1029-1036`.

## Decision Log

- Decision: the verification. One independent spec review (`doperpowers:adversarial-reviewer`, security lens) and its buildability review of this execution section. Each landing that touches `reach?`, an audience or the hub's fan-out gets reviewer-high with a security lens. M6 is the end-to-end proof.
  Rationale: P5's O18 Review. This is a confidentiality property whose failures are silent.
  Date/Author: 2026-11-05, p5-desk-track-owner.
- Decision: the audience belongs to a writer stream (`<machine>/<session>~<digest>`), and the hub filters whole writers.
  Rationale: sminos's import is strict per writer; per-writer filtering leaves no hole and names no private writer to an outsider.
  Rejected: per-event filtering with `spent` stubs, which leaks writer names and grows tombstones; a private project per person, which splits a session across projects.
  Date/Author: 2026-11-05, p5-desk-track-owner, accepted by the architect (chat 1131).
- Decision: an addressed event takes the recipient's audience from the recipient's newest verified event the sender holds. A `say` is split per audience.
  Rationale: the sender can address only what it sees, and what it sees carries the audience; no new query is needed.
  Rejected: an audience lookup at the hub, a new round trip on every send that tells the hub who is asking about whom.
  Date/Author: 2026-11-05, p5-desk-track-owner, accepted by the architect (chat 1131).
- Decision: the hub is the backstop. It refuses an event addressed to a session whose latest audience is set unless the event's audience equals it, comparing against the latest it holds.
  Rationale: this covers old endpoints, forged events, and stale copied audiences after a share removal (the architect's condition (c)).
  Rejected: trusting the sender's endpoint alone, which an old version or a stale view defeats.
  Date/Author: 2026-11-05, p5-desk-track-owner, accepted by the architect (chat 1131).
- Decision: capabilities gate the order. The hub welcomes with `audience`, and the endpoint holds private streams without it. The endpoint hellos with `access` and `reach`, and sminos sends visibility only then. The hub deploys first.
  Rationale: OX1 asks for additive change within a major, and these two hellos are where each side learns what the other can do.
  Rejected: a strict deploy order with no signal, which can't be checked and fails open in between.
  Date/Author: 2026-11-05, p5-desk-track-owner, accepted by the architect (chat 1131).
- Decision: the setters. Narrowing is open to a session's shell; widening is operator-only, with confirmation at `/dev/tty`. A red-first test covers it.
  Rationale: an agent must never open a session to more people than its owner chose (the architect's condition (a)).
  Rejected for the CLI: device step-up, which needs the app; M5's picker uses it.
  Date/Author: 2026-11-05, p5-desk-track-owner, accepted by the architect (chat 1131).
- Decision: a private session's agent may message only within its own audience, refused at its own CLI. Messaging out grants no reach back.
  Rationale: the architect's ruling (condition (b)). By construction its events reach only its audience, so the alternative would widen its audience implicitly.
  Date/Author: 2026-11-05, the architect (chat 1131).
- Decision: the RL amendments in §"RL amendments", made in M1: §5.5 `list` gains messaging; §5.8 gains the reach rule; §5.9 and §6.2 make the log plane org-readable except audience streams, and add the `list` share; RL1, RL6, RL8/RL9 and RL10 gain their optional fields and frames.
  Rationale: Decision Log 223's ruling and the means above. Each is additive within RL's major (OX1).
  Rejected: leaving §6.2's org-readable log plane and hiding sessions in the UI, which doesn't meet "unlisted".
  Date/Author: 2026-11-05, p5-desk-track-owner.

## Outcomes & Retrospective

Pending — written at finish.
