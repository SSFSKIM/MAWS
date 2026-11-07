# P5-O18 — Message reach: who may message a session's agent (2026-11-05)

> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (the P5 composite), child **O18**, §"O18: Message reach (desk side)". Parent pin: blob `ff752cccce6b73ca021c196bee91b55b09082551` at master `a168273fc`. Binding on this child:
> - P5 Decision Logs 219 (the owner's direction) and 223 (the owner's ruling: reach is visibility, a `list` share shown as "Can message", `listed` stays the default), and §7 as amended there;
> - the remote layer `docs/doperpowers/specs/2026-10-26-remote-layer-design.md` (cited *RL §n*): §5.5 (grades), §5.7 (signed log events), §5.8 (default owners and peer messages), §6.2 (visibility), RL1 (the relay), RL6 (the session record), RL8 and RL9 (signing and the owner attestation), RL10 (endpoint ↔ sminos). This child amends several of them; the amendments are listed under "RL amendments" below and recorded in the Decision Log;
> - OX1 (P5 §"Cross-cutting": additive change within a major, `capabilities` on hellos).
>
> **Owner:** p5-desk-track-owner (the desk track). **Repositories:** MAWS holds the hub (`apps/desk-hub`), the shared protocol (`apps/org-protocol`), the endpoint (`src/endpoint`), desk-web (`apps/desk-web`), the `list` share grade, and O8's share UI. doperpowers holds sminos (`sminos/skills/sminos/scripts/`, `sminos/tests/`). This corrects P5's O18 "Repos" line, which put the hub in doperpowers; the architect folds the correction into P5. MAWS lands first whenever both repos change, and every new field stays optional. This document is the child's standalone record. Residue decisions go to P5's Decision Log under O18, through the P5 writer.

## Purpose

Today any org member's agent can message any session: a peer `sminos say` is never checked for reach, and every org machine's logs carry every session's existence. Once a second person joins, that is wrong for a person who keeps a session to themselves.

After O18:
- a person sets a session `listed` so other people's agents can talk to it;
- a session set `private` takes messages only from its owners' agents;
- a `private` session shared as **Can message** takes messages from the named people's agents, and they can't read its transcript;
- a private session's events don't reach the machines, browsers or archive of anyone else in the org.

Messages among one person's own sessions are never restricted. With the org as the owner alone, nothing visible changes until a second member joins, and O18 has to land before that happens.

**To see it working**, use the staging org (`staging-ssfskim`) with a second member and a second machine enrolled under that member:
- set a session private with `sminos access <session> private`;
- from the second member's session, `sminos say "@<short> hi"`: it answers `no member @<short> in project <p>`;
- a forged copy of that `say` gets back a `not-reachable` notice;
- the second machine's log files hold no trace of the private session.

Then `sminos share <session> <member> list` (run by the owner at a terminal): the second member's agent now sees the session and messages it, while their transcript read is refused.

## Progress

- [x] (2026-11-05 20:40Z) Document written from the desk track's draft (`notes/477-message-reach-design.md`), the architect's amendments (sminos chat 1128, 1131) and two read-only mappings of today's code.
- [x] (2026-11-05 ~21:00Z) Two adversarial reviews ran. This revision folds their P1 and P2 findings, with the resolutions the architect approved (chat 1131–1132); each course change is in the Decision Log.
- [x] (2026-11-05) A third adversarial review found nine holes; this revision folds each with the resolution the architect decided: one reader check for every hub read surface, an archive of the admitted projection, the session's machine bound at first exposure, `unlisted` as a validated notice, redacted provenance references, the reach gate at the push primitive, an unreadable record failing closed, a bounded retry after `state-unavailable`, and a complete `snapshots?` rebuild.
- [x] (2026-11-05) The round-3 review found four more holes; this revision folds each with the architect's resolution: the archive's own-writer frontier is the hub's `have`, not socket handoff; an old sminos or endpoint never receives an audience stream; a split `say` carries only its own recipients' leading tags; a valid `unlisted` notice is admitted by its own rule.
- [ ] The execution section's buildability review.
- [x] (2026-11-05 22:50Z) M1: the hub's policy registry, upload backstop and audience filter (MAWS). Branch `p5-o18-m1`, `49dd6b262..`; static and unit GREEN on `a091ce1cb` (run 42120533710); reviewer-high with a security lens converged on the third pass.
- [x] M2: the endpoint: the `list` grade, `reach?`, audiences and the policy cache (MAWS). Branch `p5-o18-m2` from `9f49f8fbc`; built at `062e061a0` (2026-11-06 00:00Z); M1's same-batch reference fix at `bf194ee8c`; the review's fix wave at `c100ab45f`; high-rung re-review clean (2026-11-06).
- [x] (2026-11-06 01:40Z) M2b: devices: an unchanged browser refused toward a private session (MAWS). static, unit and e2e:desk-web GREEN on the merged head `b656e8ddb` (run 42141731122); reviewer-high with a security lens: no findings. Branch `p5-o18-m2b` from `b30f810fb`. A first build sealed audiences from hub policy rows (`7c57f8cf0`, `50d47bb9f`), set aside by the architect's ruling (2026-11-06); what stands is the hub proof and desk-web's tombstone verdict.
- [x] (2026-11-06 01:33Z) M3: sminos's visibility frames, records and audience streams (doperpowers). sminos 1.35.0, doperpowers PR #463 (`386c4b07..4a6bc875`), merged 2026-11-07 00:07Z as `da1080d6`; all five sminos gates GREEN on `4a6bc875` (run 42142252798); reviewer-high with a security lens, three rounds, the third correct.
- [x] (2026-11-06 03:57Z) M4: sminos's send boundary, the setters, refusals and unlisting (doperpowers). sminos 1.36.0, branch `o18-m4-sminos` on M3's head (`4a6bc875..bccda6f1`); GREEN on `bccda6f1` (run 42157326546); merged 2026-11-07 01:17Z as doperpowers PR #464 (`2d9a79da`) after merging main at `be2c0a20` (GREEN, run 42318773133); reviewer-high with a security lens, three rounds, the third correct. One finding stands by the architect's ruling until M5's step-up cutover (Decision Log, 2026-11-06).
- [x] (2026-11-06 05:09Z) D5's restatement of a withheld own snapshot (board #492): sminos 1.37.0, branch `o18-d5-restate` on M4's head (`bccda6f1..c9850331`); all five sminos gates GREEN on `c9850331` (run 42164345530); reviewer-medium, two rounds, the second correct; merged 2026-11-07 02:01Z as doperpowers PR #465 (`2cd36862`); board #492 done.
- [x] (2026-11-06 06:50Z) M5's sminos executors, `record.access`, `record.shares` and O8's `record.owners` (O8 M6b and M5b): sminos 1.38.0, branch `o18-record-executors` on D5's head (`c9850331..23035da7`); GREEN on `23035da7` (run 42174469720); reviewer-high with a security lens, three rounds, every finding fixed; merged 2026-11-07 02:26Z as doperpowers PR #466 (`b26ffe81`).
- [x] (2026-11-07 03:15Z) M5's widening cutover in sminos's CLI, keyed on the endpoint's `record` welcome (P5 Decision Logs 231 and 232; the architect's ruling, chat 1164): sminos 1.39.0, branch `o18-widening-cutover` on the executors' head (`23035da7..4a0c3b89`); reviewer-high, two rounds, the second correct; all five sminos gates GREEN on `ff2c40e8` (run 42179385114), and on the merged head `213b49de` (run 42327542258) but for the known `test_manager_serve` flake, with sminos-suites GREEN on the identical tree `4a0c3b89` (run 42329436955); merged as doperpowers PR #467 (`0759115d`).
- [ ] M6: live acceptance on the staging org. Shape ruled 2026-11-07 (the architect, chat 1204, on the desk track's mapping); the harness on MAWS branch `p5-o18-m6` first, then the run.
  - [x] (2026-11-07) The harness: `vm/scene.sh --scene`, its reach verbs, `vm/setup.sh` and `vm/teardown.sh`'s reach mode, `vm/check.sh`'s reach lines, `VmMachine`'s scene and verbs, `OrgAdmin`'s `owners`, `reach-acceptance.ts` and `reach-items.ts`, `staging-run.sh reach` and `reach-vm`, the README's section; unit-tested against stand-ins (`test/deploy/reach-acceptance.test.ts`, `reach-scene.test.ts`, `staging-scripts.test.ts`) and PA and PB's own path against the suites' local hub (`reach-probes.test.ts`), O10's run unchanged under the parametrized scene. Branch `p5-o18-m6` from `4eb50d0c8`. Its review (reviewer-high, security lens) and the run follow.
- [ ] M5 is an external contract, blocked on O8 M6 and outside O18's acceptance.

## Today (what this child changes)

Read on MAWS master `b7e7d9594`/`a168273fc`. sminos line numbers are at doperpowers `76132b84` (sminos 1.33.0); sminos 1.34.0 (`386c4b07`) shifts some `sminos.py` lines, so find each by its function name.

1. **A peer message is never checked for reach.**
   - `deliver_next` (doperpowers `sminos/skills/sminos/scripts/sminos.py:4099`) checks the holder receipt gate, revocations and the read-only policy, then pushes to the recipient's inbox. The sender's CLI (`:5066`) and the retry loop (`:10115`) reach it too.
   - It is not the only push. `send_to_seat` (`:9774`) pushes a live seat or resumes a stopped one with the send as its message (`:9836-9856`). `send_to_member` (`:10079`) pushes a legacy holder directly (`:10109-10120`). Both carry `SendDelivery`'s queue (`:9947`), whose `checked` (`:9972-9989`) looks only at revocations, and only on a cut-over machine.
   - `record_message` (`:10054-10074`) appends every send under the plain writer, and `record_copy` (`:5025`) copies a cross-project message into the sender's home project under the same writer.
   - Only `human` events are put to the endpoint (`words?`, MAWS `src/endpoint/rl10/words.ts:49-85`).
2. **Visibility never leaves sminos.**
   - `member_frame` (`sminos_uplink.py:1355-1385`) sends no `access` or `shares`, and the endpoint reads a missing `access` as `listed` (`src/endpoint/grades.ts:40`).
   - An unknown share grade makes `readMember` (`src/endpoint/rl10/members.ts:60-73`) reject the whole member frame.
   - A session record keeps only its provenance across a rebuild: `_record` (`sminos_records.py:166-175`) copies `PROVENANCE` and `controller` when `establish` (`:178-191`) replaces it, and a continuation's `inherited` (`:520-524`) copies only `PROVENANCE`. A spawned session copies its spawner's `PROVENANCE` (`sminos.py:9343-9369`).
3. **The logs list every session to the whole org.**
   - A session's `joined`, `state`, `titled` and `renamed` events, and every `say` addressed to it, sit in the hub log of its project.
   - The hub's `fanOut` (`apps/desk-hub/src/objects/project.ts:1206-1215`) sends every accepted event to every machine and browser that follows the project.
   - `hello` (`:405-437`) answers the full writer vector (`have`) and the backlog.
   - A browser's `human` is stored under `hub/<member>` (`takeHuman`, `:1174-1203`) and fanned out the same way.
   - The audit record goes to every browser of the project: a refusal with its writer, seq and message (`refusal`, `:1225-1229`; `refuseBrowser`, `:1231-1234`), a daemon's `rejected` (`:538-554`), and the replay on a browser's resume (`:1148`).
   - Any enrolled machine reads any writer's stored events over HTTP: `GET /machine/projects/<project>/log?writer=…&after=…` (`apps/desk-hub/src/worker.ts:319-324` → `historyPage`, `project.ts:564` → `LogStore.writerPage`, `log-store.ts:201-210`), beside the history inventory (`historyWriters`, `project.ts:559`) and the attestations route (`project.ts:569`).
   - The session plane names sessions to every browser of the project: each session's presence (`plane.presence()`, `project.ts:158`, `:925`), the pending set (`pendingFrame`, `:976-980`), delivery outcomes (`plane.deliveries()`, `:162`) and op outcomes (`plane.ops`, `:161`).
   - sminos's archive copies every writer file of a project's `log/` to the project's shared git remote (`copy_log`, `sminos_archive.py:109-140`), own events the hub hasn't admitted yet included.
   - Only the hub listing (RL6) honours `private`.
4. **A hidden event would stall the log.**
   - sminos imports each writer strictly by seq (`sminos_hublog.py:249-270`): an event past a hole is held back until the hole is filled.
   - So filtering single events per reader would leave a writer stalled for good. RL §6.2 says so, which is why the log plane was declared org-readable.
   - A hub refusal stops the writer for good: `HubLog.on_refused` (`sminos_hublog.py:796-813`) marks it stuck for the stopping reasons, and `HubLog.spend_own` (`:990-1012`) refuses to spend a position an own event already holds.
5. **The receiving machine knows the sender.**
   - The sending machine's key signs each event together with its `attest` (`owners`, `ownersProof`; MAWS `src/endpoint/rl10/attest.ts`, `apps/org-protocol/src/attest.ts`). `attest.owners` are member ids.
   - The receiving endpoint verifies them and hands sminos `verified: {signer, owners}`.
   - sminos holds no org state, so it can't resolve `@machine` owners or grades; the endpoint can (`resolveOwners`, `src/endpoint/listings.ts:91-100`).
   - Desk-web verifies log events only by the org MAC (`apps/desk-web/src/log/verify.ts:15-18`), which every member holds. It trusts machine signatures only on listings.
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

- **Where the ask happens.** sminos asks its endpoint `reach?` before it pushes any peer message (`say`, `send`, and wakes), on every send path (D8). The ask carries the event as stored, less sminos's `verified` (the endpoint verifies the sender itself, Decision Log M2), the project and the recipient session.
- **What the endpoint does with it.** It decides by D1 and D2 from its org state and the recipient's record.
- **Failing closed.**
  - An endpoint that can't be asked leaves the delivery owed, retried on each tick like any owed delivery.
  - An unverified sender reaches only a session every member may message (`listed` or org-wide).
- **A refusal here stays here.** sminos settles the delivery `refused-reach` and writes one content-free line to that machine's own `daemon.log` (project, position, reason). No event goes back. The hub's upload check (D5) is where a sender learns of a refusal; this one is defense in depth.
- **sminos holds no grade logic.**
- **Rejected:** sminos deciding alone from owner sets pushed down to it. That would duplicate the grade rules in Python and let the two copies drift.

### D4. An event's audience is the intersection of the sessions it names

- **What an audience is.** A private session's audience is the member ids whose rank on it is at least `list`, sorted: its resolved owners, with `@machine` expanded, plus every share's member at any grade. A listed or org-wide session has no audience: it is the whole org.
- **The sessions an event names** are what one extractor, `sessionRefs(event)` (Interfaces §A), lists: every structured session reference the event carries, each marked addressing or provenance. Found so far:
  - addressing: `to[].session`, and the `session` of an event written under another session's writer (an `in-charge` or status event, read at `sminos.py:3737-3762`);
  - provenance: `origin.spawnerSession` (set at spawn, `sminos.py:9365`; published in `joined` by `published_provenance`, `:2813-2827`), the same in the attestation's origin (`attestFor`, `src/endpoint/rl10/attest.ts:27-37`), and a `retired {reason: 'continued'}`'s `to`, its successor (`:2863`).
  Every place that reads a session from an event uses `sessionRefs`, so a new reference is found once, there.
- **An event's audience** is the intersection of the audiences of the writing session (when private) and every addressing reference's session (when private). An event naming no private session has no audience.
  - Example: a private session S with audience {A, B} messages a private session R owned by A with audience {A, C}. The event's audience is {A}.
- **A provenance reference never widens what a session's id reaches.** One whose session's audience doesn't contain the event's audience (a listed child of a private parent, say) is redacted, by sminos at writing and by the endpoint at signing: written null in a sminos field, and left out of the attestation, whose verifier refuses a null `spawnerSession` (`apps/org-protocol/src/attest.ts:45-48`), so an old receiver still verifies it. The hub refuses an event that carries one unredacted (D5). Provenance takes no part in the intersection: a child shouldn't go private because its parent is.
- **Delivery needs the recipient inside.** An event is sent only when every recipient's resolved owners are inside its audience, and the writing session's owners are too. The sender's CLI refuses before anything is written: `<alias> can't be reached from this session: this session is unlisted; share it as Can message with <person> first` when the writing session is private and the recipient's owners fall outside its audience. This generalizes the architect's ruling (b): messaging out never grants an implicit reach back.
- **What the sender sees.** A sender's projection of the logs holds only the sessions its person may see (D6), so a tag naming a private session it isn't shared on fails as `no member @<alias> in project <p>`, the same words as for a session that doesn't exist. A broadcast (`@all`, `--org`, `--project`) wakes only what it sees.
- **Splitting.** A `say` to several sessions is split into one event per resulting audience, each with the recipients that produce it. A cross-project copy (`record_copy`, `sminos.py:5025`) carries the same audience as the original it copies, and is split the same way: one copy per distinct audience among the delivering events.
  - **Each split carries only its own recipients' tags.** `cmd_say` stores the whole `a.text` (`sminos.py:5218`), and its opening run of `@name#short` tags (`leading_tags`, `:4655`) is the addressing itself: unchanged, the public event of `@private#12345678 @public hello` would name the private alias and its short. Each split's `text` is rebuilt as the raw tags of its own recipients, in their original order, then the body after the run unchanged; each tag resolves to exactly one member (`resolve_tags`, `:4881-4910`), and `@all` stands alone and names no session. A copy's text is its own split's. This rewrites the CLI's addressing syntax only, never prose: an `@` after the leading run is text and stays as written.
- **Who computes it.** sminos computes the intersection from the audiences its endpoint sends (D7) so it can choose the writer stream before the event is signed. The endpoint computes it again at signing and refuses a mismatch.

### D5. The hub refuses at upload; it can only refuse

**The policy registry.** The hub keeps one org-wide, revisioned registry of session policies in the org's Registry Durable Object (`apps/desk-hub/src/objects/registry.ts`), as a table its new `Policies` module keeps, the way the Registry keeps `OrgRecords`. Every Project already calls its Registry (`this.registry()`, `project.ts:1026`), so every project can consult it at upload.
- **Its rows:** keyed by session id, each with the session's machine, its latest audience (or none), its `policyRev`, and the signed `created` of the snapshot that set it.
- **`policyRev`** is a per-session monotonic counter that sminos keeps in the session's record, bumps on each access, share or owner change, and writes into every `joined` and `state` snapshot, where the machine's signature covers it.
- **What updates it:** only `joined` and `state` snapshots from the session's own writers (`<machine>/<session>` and `<machine>/<session>~<digest>`). The highest `policyRev` wins; a tie goes to the newest `created`. A snapshot under the plain writer sets the audience to none.
- **The session's machine is bound at its first exposure.** The Registry binds a session id to the machine that first published either its RL6 listing (`Registry.storeListing`, `registry.ts:1451`) or a snapshot for it. The listing has to count: sminos sends a session's member frame before any upload that carries it (`upload` and its `members_before`, `sminos_uplink.py:2066-2093`), and the endpoint lists the session from that frame (`members.ts:134-146`), so the listing usually reaches the hub first. A private session is never listed at the hub, and its machine uploads its own snapshot before any event that names it, so its id never reaches the hub before its own machine's snapshot does.
  - Snapshots, transition notices (D6) and policy for a bound id are accepted only from its bound machine; another machine's is refused `not-reachable`, which tombstones it like any other.
  - The binding never moves. The endpoint's policy cache (D7) restores it on a rebuild and never chooses it anew.
- **At M1's deploy** the Registry fills the table once from every project's newest plain snapshot per session (rev 0, no audience), asking each Project as its history inventory does (`registry.ts:633-636`), each row bound to that snapshot's machine. Until that has run, and whenever the Registry can't be read, an upload that needs it is refused `state-unavailable`.
- **`state-unavailable` is retried at its position, never tombstoned.** Whoever holds the upload rewinds to the refused seq. On RL10 the endpoint opens a hole at that seq when it signed the position, as it does for a hub `resend` (`#hole`, `uplink.ts:197-202`), due after `ASK_MS` (30 s, `uplink.ts:42`), so sminos is asked to resend from there. Today its `refused` only re-arms a hole that already exists (`uplink.ts:155-166`). On a direct stream, `HubLog.on_refused` (`sminos_hublog.py:796-813`) sets `sent[writer]` back to `seq - 1` with the same wait. The bound is one retry per writer per `ASK_MS`, for as long as the stream is open; a new stream starts again from the hub's `have`. Nothing is given up: the position stays owed, which fails closed.

**The refusal.** At upload, after the signature check, the Project consults the registry for the writing session and every session `sessionRefs` (D4) lists (a copy's `to[].project` names another project's session; the registry is org-wide, so the same row answers). It refuses an event as `not-reachable` when:
- it names a session the registry doesn't know;
- its audience isn't a subset of each addressed session's latest audience;
- it carries, unredacted, a provenance reference whose session's latest audience doesn't contain the event's audience;
- its sender's attested owners (`attest.owners`, or the machine's owners for an event with no attest) aren't inside its audience (a transition notice aside, below);
- it is a snapshot or a transition notice for a session bound to another machine;
- or it is an `unlisted` notice (D6) that breaks the notice's rule: it must sit under its session's own writer namespace on the bound machine, with a `policyRev` newer than the registry row's and an audience that is a subset of the row's audience (the previous one; the whole org for a listed row). The notice doesn't move the row; the snapshot after it does. That its audience also excludes the new audience is checked at signing (D7), where the new one is known.

**A transition notice has its own admission rule.** A notice's audience is the members the change withdraws, so its sender's owners are outside it by construction, and the sender-inside-audience check would refuse every valid one. A content-free `unlisted` notice that passes the last item (bound machine, newer `policyRev`, audience within the previous one) is admitted by that rule in place of the sender check; the signer's notice rule (D7) likewise stands in place of D4's at signing. Every other check still holds for it: the signature, the writer's digest, the binding. No other kind is exempt.

A hidden session and a nonexistent one get the same reason, so a refusal never confirms more than the sender already knew. A snapshot in the same upload moves the registry before the events after it are checked.

**A withheld own snapshot is restated once** (board #492, sminos 1.37.0). Every publisher compares against its writer file, which keeps the withheld event, so without this the hub's row for an idle session would stay where the withhold left it, and a session the registry doesn't know is refused every message that names it, its owner's included.
- When `withhold_own` settles a position holding the session's own `joined` or `state`, it records a restatement as owed in the project's `restate.json`, which has its own lock.
- The daemon's next tick writes the snapshot again through `lifecycle`, from the record as it is then: a `joined` takes its fields from the session's last one (`joined_again`), a `state` takes the member's word now. It writes nothing when a later own snapshot of the same kind exists, or when the session is no longer a local member; a `joined` also needs the session's latest membership to be `joined`, so a restatement never undoes a retirement.
- A restatement the hub withholds again owes nothing. `daemon.log` names the session, and its next natural snapshot is the next try, so a cause that holds (a session bound to another machine) costs one extra position per natural snapshot and never loops.
- The bound: a transient cause (a provenance reference whose parent narrowed in between) is repaired one tick after the refusal reaches sminos, on the upload's own answer or, when a disconnect lost it, at the next archive `have` (`ARCHIVE_EVERY`, 15 minutes). Positions withheld before 1.37.0 are never owed; production's hub withholds nothing before M1 deploys there.

**Back to the sender, over its own upload path.**
- The hub stores a content-free tombstone `{writer, seq, withheld: true}` at the refused position and serves it in that writer's stream, so the writer continues at the next seq. It keeps the refused event's body hash beside it, so a byte-identical resend gets the same refusal and another body gets `conflict`.
- The refusal goes to the sending machine as today's `refused {project, refusal: {reason: 'not-reachable', writer, seq}}`, with no message. The endpoint passes it down (`log-relay.ts:312-314`) and takes the position as settled, not as a stop (`uplink.ts:156`).
- sminos settles its own event withheld (`HubLog.withhold_own`, below) and shows the sending session `[sminos: your message to <alias> was not delivered: not-reachable]`.
- Readers of the writer's stream get the tombstone as RL10 `spent {project, writer, seq, reason: 'withheld'}`, in stream order, as the endpoint already sends a refused arrival (`log-relay.ts:355-359`).

**The new own-refused settlement.** `spend_own` (`sminos_hublog.py:990`) refuses a position an own event holds, and that is right for every reason it serves. A hub-withheld position is different: the event exists locally and the hub holds a tombstone in its place. `HubLog.withhold_own(writer, seq)` records the position in the hub log state as withheld, counts it as uploaded so the writer's next events go up, keeps the event in the writer file as this machine's record of what its session tried to send, and queues the notice. It runs for a `refused` with reason `not-reachable` and for an own position's `withheld` tombstone seen on resync.

**The invariant.** The hub can only refuse, never admit. A relay can already drop anything, so refusing gains it no power. The receiving endpoint's `reach?` (D3) authorizes every delivery, and a hub that admitted what it should have refused still delivers nothing to a session outside its reach.

- **Rejected:** a signed `refused` event appended by the recipient's machine. It needed an audience and a stream of its own toward the sender, told the sender's machine that the recipient's machine holds the session, and arrived only after the event had already fanned out. The hub sees the event at upload and has every fact it needs there.
- **Rejected:** an outcome lane from the receiving endpoint through the hub. It would need a new RL message and hub routing for one notice.

### D6. Audience streams: unlisted means the logs don't carry it

- **The event carries its audience.** An event with an audience (D4) carries it signed, `audience`, as the sending machine signs `attest`.
- **Which events carry one:** a private session's own events (`joined`, `state`, `titled`, `renamed`, its `say`s), and any event that names a private session.
- **No audience:** an event naming only listed or org-wide sessions. Its fan-out is unchanged.

**The audience belongs to a writer stream, not to an event.** Since sminos imports each writer strictly by seq (Today 4), an event with an audience is written under its own writer, `<machine>/<session>~<digest>`.
- The digest is the first 16 hex characters of SHA-256 over the canonical sorted member-id list (`audienceDigest`, Interfaces §A).
- It is still the machine's own writer (the hub takes from a machine only `<machine>/…`), and every event in one stream has one audience.
- A device's events follow the same rule under `hub/<member>~<digest>` (D8).
- **What the hub filters:** whole writers, never single events. A reader outside a stream's audience gets none of its events, no entry for it in `hello`'s `have`, and no stub.
- **One reader check for every read surface.** Every route or frame of the hub that returns stored events, writer names, vectors, audit rows or session-plane rows passes the authenticated reader into the Project and through one function, `mayRead(reader, writer)` (Interfaces §A), before it returns anything. A reader is a machine with its owners and whether its RL1 hello advertised `audience` (D9), or a browser's member. `mayRead` is true for a plain writer and, for a stream, exactly when the reader's members meet the stream's audience and, for a machine, it advertised `audience`. A session-plane row names a session rather than a writer, and is read against that session's current stream in the registry. The surfaces today are listed in Today 3 and M1's Work. No surface filters on its own, so a new route can't skip the check and still return what it stores.
- **Why it can't stall:** no writer a reader can see ever has a hole. A withheld position (D5) is a tombstone in its own writer's stream, seen only by that stream's readers.

**Rejected alternatives:**
- **Per-event filtering with content-free `spent` stubs.** It would unstall the import, but every stub, and the `have` vector, would name the private session's writer into other people's `uplink.json`, against acceptance 3. The tombstone list would also grow with every hidden event.
- **A private project per person.** It would need project-level follower rules and would split a session across two projects, which every resolver would then have to know.
- **Hiding it in the UI only.** Any member's agent reading its own machine's logs still sees the session. It is a stopgap only while the org has one member.

**Streams change only on a person's action, or a send to a new audience.**
- A session's audience changes when its owners or shares change or it changes access. Each change bumps `policyRev` and starts a new stream; the old stream keeps its old signed audience.
- A sender's addressed events open one stream per distinct event audience.

So a session's stream count is bounded by its policy changes plus the distinct audiences it messages, which is at most the number of private sessions its person can see. That needs no cap. The hub's per-writer rows and sminos's per-writer files grow by one per stream.

**Changes over time:**
- **`unlisted` is a transition notice.** Content-free, `{kind: 'unlisted', session, policyRev, audience}`, its audience the members the change withdraws: the session's previous audience minus its new one. It is written only by the session's bound machine, under the session's own writer namespace (`<machine>/<session>~<digest of the withdrawn set>`), at the new `policyRev`, just before the new snapshot. The endpoint computes the withdrawn set at signing from its own policy history of that local session and refuses a notice that differs; the hub checks what its registry holds (D5). A reader's projection drops the session at a notice visible to it unless it also sees a snapshot at that `policyRev` or later.
  - **Going private** withdraws everyone else in the org: the notice's audience is the org's members minus the new audience, so every other projection drops the session. It's the log's form of RL6's `gone` revision.
  - **Removing a share** withdraws the removed member alone.
- **A new share or a raised grade** writes a fresh snapshot (`joined` and `state`) into the new stream, so the new audience learns of the session.
- **Going listed** again writes the session's next snapshot, and its later events, under its plain writer, `<machine>/<session>`, at the next `policyRev`.
- **History already fanned out is not taken back.** The app says so where `private` is set (M5).
- **The git archive copies only the hub-admitted public projection.** Previously public history stays in it. It holds a plain writer's positions the hub admitted: for another machine's writer, what was imported from the hub; for this machine's own, positions up to the hub's vector in the `have` that confirmed the run, each withheld one as its tombstone. A local event whose admission isn't confirmed is never copied: a `say` written under the plain writer from a stale view of a now-private recipient sits in the writer file until the hub refuses it, and today's `copy_log` would copy it in that window. Audience streams never enter the archive (M3).
  - **The frontier is the hub's `have`, not `taken`.** `HubLog.taken` (`sminos_hublog.py:560`) moves when an upload is answered, and on RL10 that is when the endpoint's socket takes the frame (`Link.uploaded`, `sminos_uplink.py:2096`; `SocketLane`, `:1155`), before the hub has admitted or refused anything. The hub's `have` is its own vector, tombstones included. Every archive run already waits for one: the uplink says `hello` every `ARCHIVE_EVERY` (`sminos_archive.py:10-14`, `:44`) and runs on the `have` that answers it (`HubLog.on_have`, `sminos_hublog.py:708-739`). A `have` alone isn't enough: a refusal lost to a disconnect never comes back, because on reconnect sminos advertises its own head and the hub's backlog starts past it (`HubLog.vector`, `sminos_hublog.py:485`; `Project.hello`, `project.ts:429`; `LogStore.beyond`, `log-store.ts:175`). So the hub's `have` also carries, for the hello's own machine's writers only, the positions it withheld (`withheld: {writer: [seq, …]}`, range-compressed). These are the machine's own writers, so the list names nothing it doesn't already hold. `on_have` saves the own-writer vector and that list together, as `archive_have`. `copy_log` copies this machine's writers up to the vector and writes a tombstone at every listed position, whatever the local file holds there, so a refusal lost on an earlier stream is still honoured at the next run.
- **The audit record.** Beyond `mayRead`, a refusal of an audience stream's position also goes to the member whose own send it refuses, live and on resume, with its message dropped. A `not-reachable` refusal never carries a message.

### D7. Who knows which audience

- **A local session's own audience.** Its endpoint computes it from the session record and the org state (D4). It sends sminos each local session's audience, resolved owners and `policyRev` in an RL10 `audience` frame, so sminos writes the event under the right stream before the endpoint signs it. At signing, the endpoint checks that the writer's digest matches the audience it computes. A mismatch is refused to sminos as `audience`, and the audience is frozen in the signature ledger at first signing. The endpoint keeps each local session's past audiences by `policyRev`, which is what an `unlisted` notice's withdrawn set is checked against.
- **A remote session's audience: the endpoint's policy cache.** The endpoint keeps a persistent per-session cache (`src/endpoint/rl10/policy-cache.ts`, a file in its state directory), fed from the verified `joined` and `state` snapshots of remote sessions as they arrive, each with its machine, audience (or none), `policyRev`, signed `created` and the attested owners (`verified.owners`).
  - Ordered by `policyRev` (ties by `created`), so streams arriving out of order settle on the newest. A plain-writer snapshot of a higher rev clears the audience.
  - Bound to the session's machine as the hub's registry is (D5). A rebuild restores the binding and never chooses it: every snapshot the log holds passed the hub's binding check, so the machine they name is the bound one. A session whose stored snapshots name two machines (a log from before O18) stays unbound in the cache, so nothing is taken from it and the hub decides.
  - Read at start. A missing or unreadable file is rebuilt from the log: the endpoint asks sminos, project by project, for the newest stored snapshots of each remote session's writers (`snapshots?`, Interfaces §B), page after page until sminos marks the project's last page, and verifies each snapshot again before taking it, so sminos carries them and is never their source. A rebuild cut short (the RL10 link drops, sminos restarts) starts again from the first project not yet marked done.
  - **While the rebuild is incomplete**, an upload naming a remote session whose policy the cache hasn't confirmed stays owed (held), never signed plain and never refused, and goes up once the rebuild completes or the session's snapshot arrives.
  - Once complete, a session the cache doesn't know is taken as having no audience. The hub's registry is the authoritative backstop: an event built on a stale or missing entry is refused at upload (D5), and its sender learns of it.
  - The endpoint sends sminos an `audience` frame for every remote session it knows, the same shape as a local one's.
- **Not the inbound index.** `src/endpoint/rl10/inbound-index.ts` holds content hashes and positions only, pruned at 30 days. It is no source of policy.
- **A device** takes a private session's audience from the session's listing, which the session's machine signs and sends only over channels to its owners' and shares' devices (RL6, §6.2; `endpoint.listings`, `src/endpoint/calls.ts:510-519`). That listing gains `audience` and `policyRev`. Devices can't take it from log events, which desk-web verifies only by the org MAC (Today 5).

### D8. Every send path goes through one boundary

sminos has one authorization and stream-selection boundary, used by every path that writes or pushes a peer message:
- **At writing:** `record_message`, `cmd_say` and `record_copy` choose each event's writer by D4 (`stream_for`, Interfaces §C), split per audience, and refuse before appending when a recipient falls outside.
- **At pushing, in the push primitives.** The gate sits inside the functions that hand a log event to a session, not in their callers: `push_live` (`sminos_control.py:183`), the last hop of every live push (`push_member`, `sminos.py:4960`, `:4985`; a receipt's push in `holder_carry`, `:4308`; `send_to_seat`, `:9855`; `send_to_member`'s legacy holder, `:10120`), and `resume_session` (`sminos.py:9535`) when it resumes a stopped seat with a message as its prompt (`:5015`, `:9838`). Every log event they hand over as a peer frame needs the endpoint's answer for that one push, asked by the uplink (Interfaces §C); a person's words (verdict `words`) are the words gate's. So a not-yet-delivered peer is checked wherever it comes from, `deliver_verdict`'s human downgraded to a peer (`decideWords` answers `peer` on several paths, `words.ts:53-84`, rank below `converse` among them), a receipt's retry and `SendDelivery`'s queue included. An event the endpoint refuses is settled `refused-reach` and left out; one it can't answer for holds the send owed.
- **Admission never authorizes a later delivery.** Neither the hub's admission, an earlier `reach` answer nor a prepared receipt stands for the push that follows it: each push asks again.
- **A projectless push** (a seat with no project, so no event to ask about) goes only to a session whose owners intersect the sender's; otherwise the CLI refuses it: `<alias> has no project, so only its owners' sessions reach it`.

**Release.** The setters (D10) ship in the same sminos release as these guards: they are built in M4, with the guards. M3 can release alone because without a setter no session can become private.

**Devices.** A device's words toward a private session are judged at the hub. `takeHuman` applies D5's checks with the member as the sender, and words that carry no audience are refused `not-reachable` toward any session with an audience: the whole event, an `@all` naming one included, with nothing stored or fanned out. The hub would position words that carry an audience under `hub/<member>~<digest>`, and `isHubPosition` (`apps/org-protocol/src/names.ts:73-81`) accepts that writer exactly when the digest is the event's own audience's (M1). No device composes them yet. Desk-web's `say` (`apps/desk-web/src/project/connection.ts`) is in its frozen DX6 client and stays unchanged, so it seals no audience: from the browser, a private session can't be messaged, and that is a refusal, never a leak. Toward a listed session, or to everyone, its words go as before. A later client that should message a private session takes the route the Decision Log sets aside for this one (M2b).

### D9. Versions and order (OX1)

- **The hub deploys first**, to staging and then to production. Production is the owner's to deploy (P5 Decision Log 40).
- **The hub advertises it.** The hub's RL1 welcome gains an optional `capabilities: ['audience']`.
- **An endpoint without it upstream** keeps a private session's events owed instead of uploading them. The session goes quiet to its own other machines until the hub is updated, which fails closed.
- **The endpoint lands before sminos sends visibility.** Its RL10 hello gains `capabilities: ['access', 'reach']`. sminos sends `access`, `shares`, `policyRev` and the `list` grade, makes the `reach?` ask, and writes audience streams only when its endpoint advertises them. That matters because an old endpoint rejects a whole member frame on an unknown grade (Today 2).
- **An old sminos never receives an audience stream.** It copies every log file into the shared git archive (`copy_log`, `sminos_archive.py:109-140`), so a stream it imported would reach the org-readable remote whenever its machine is the project's archiver. Two hellos close this:
  - sminos's RL10 hello (`hello_frame`, `sminos_rl10.py:290-296`, today `capabilities: []`) advertises `audience` only in a release whose archive copies the admitted public projection (D6, M3). The endpoint passes down no frame naming a stream writer (`events`, `have` entries, `spent`, `refused`) to an sminos without it;
  - the endpoint's RL1 hello (`EndpointHello`, `apps/org-protocol/src/relay.ts:99`) advertises `audience` once it applies that rule. `mayRead` (D6) serves a stream to a machine only on an RL1 connection that advertised it, so an old endpoint, and a machine on a direct DX2 stream, gets no stream either.

  Either way the old side doesn't see private sessions, and has no hole to stall on. The cost: an owner's own machine running an old sminos or endpoint doesn't show their private sessions until it is updated.
- **An old endpoint upstream** stamps no audience; the hub refuses its events toward a private session (D5).
- **An old browser** sends no audience; the hub refuses its humans toward a private session (D8).
- **A session can be private only on a machine running an O18 sminos**, since the setters (D10) and the `access` field live there. So the recipient's side of `reach?` is always new where it matters. An old sminos elsewhere is only ever a sender or a reader, and the points above cover both.

### D10. The setters and the records that keep them

The app's share picker is O8 M6, and it isn't built (`docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md:1029-1036`). So O18 adds two sminos verbs:

    sminos access <member> private|listed|org-view|org-converse
    sminos share <member> <person> list|view|converse|approve|none

- **Where they act.** Both call one function, `set_visibility` (Interfaces §C), which changes the session's record on its own machine (`session-records/<sid>.json`) under the records lock, bumps `policyRev`, and records the change for the uplink. The uplink has the endpoint restate the record and, once the endpoint's `audience` frame at the new `policyRev` comes, writes D6's `unlisted` notice when members are withdrawn, then the new snapshot. M5's executor calls the same function.
- **Narrowing is open to anyone in a session's shell:** going private, removing a share, lowering a grade.
- **Widening only from the owner's terminal:** going listed or org-wide, adding a share, raising a grade.
  - Widening runs only as the operator: no `CLAUDE_CODE_SESSION_ID`, with a confirmation read from `/dev/tty`, as Decision Log 28 does for signing.
  - From a session it is refused: `widening reach needs its owner: run this in a terminal, or use MAWS`.

  An agent that follows its instructions can't open a session to more people than its owner chose. M5's cutover closes widening to every agent that goes through sminos; a machine enrolled at no hub keeps this gate (M5).
- **The policy survives record rebuilds.** `access`, `shares` and `policyRev` are kept when `establish` replaces a record's provenance (`sminos_records.py:166-191`) and copied into a continuation's record by `inherited` (`:520-524`), so a background copy or a resume keeps its predecessor's reach. A sminos-spawned session takes its spawner's access and shares (`spawn_provenance`, `sminos.py:9343-9369`), so a spawn never widens reach; an operator's spawn takes the default. Every write of a record reads and writes these fields under the same lock, so a setter racing a reconciliation can't lose either change.
- **An unreadable established record fails closed.** A session with no record file is new and takes the defaults (`listed`). One whose record file exists but can't be read is established, and its policy is unknown: `ensure_record` returns None for it (`sminos.py:2934-2952`), and `member_frame` would then send the defaults (`sminos_uplink.py:1367-1381`), listing a private session. Until the record reads again, sminos sends no member frame for it (a restatement leaves it out, so the endpoint withdraws its listing, `members.ts:127-131`), writes no event of it (`stream_for` can't choose its stream), and asks no `reach?` for it, so deliveries to it stay owed.
- **Rejected for the CLI:** a step-up signed widening through the device, as for owner changes (Decision Log 219's list). It needs the app, so it is the app's picker's (M5); until the cutover, the operator's terminal is the same trust that already admits signing.

### RL amendments

Written into `docs/doperpowers/specs/2026-10-26-remote-layer-design.md` in M1. Each is recorded in the Decision Log below.

| Where | Today | After O18 |
|---|---|---|
| §5.5 grades (~:401) | `list`: "see in listings" | `list`: see in listings and message the session's agent (D1) |
| §5.8 (:446) | "There is no recipient policy, narrowing or off switch" | reach is visibility (D1–D3); the receiving endpoint decides, and the hub refuses at upload what it can see is out of reach (D5) |
| §5.9 (:475) | the log plane is "org-readable by design" | org-readable except audience streams (D6) |
| §6.2 (:524-550) | shares `view`/`converse`/`approve`; log filtering ruled out; a private `say` stays org-readable; the hub learns nothing of a private session but its traffic | the `list` share ("Can message"); audience streams filtered per writer; a private session's traffic reaches only its audience; the hub holds each session's audience and `policyRev` in its policy registry (D5) |
| RL1 welcome and endpoint hello (`apps/org-protocol/src/relay.ts:99-102`) | `{t, generation, heartbeat_ms}`; the hello carries none | optional `capabilities` on both; a stream is served only to an endpoint whose hello advertises `audience` (D9) |
| RL1 log plane | a refused position stops its writer; any enrolled machine reads any writer over the history route | `not-reachable` refusals leave a `withheld` tombstone the writer continues past; `state-unavailable` is retried at its position; every read surface passes `mayRead` (D5, D6) |
| RL6 (:793) | `shares[{member, grade}]` | grade `list` added; record gains `policyRev`; a private session's channel listing gains `audience` and `policyRev` (D7) |
| RL8/RL9 (:805, :816) | attestation only | optional signed `audience` and `policyRev`; writer streams `<machine>/<session>~<digest>` and `hub/<member>~<digest>`; the `unlisted` transition notice; provenance references redacted when narrower (D4) |
| RL10 (:819) | no reach | `reach?`/`reach`, the `audience` frame, paged `snapshots?`/`snapshots`, `spent` reason `withheld`, `capabilities` on both hellos; no stream goes down to an sminos without `audience` |

## Acceptance

On the staging org `staging-ssfskim` with a second member, added for the run and removed after (`apps/desk-hub/deploy/README.md:281`), and a second machine enrolled under that member (a devcloud VM):

1. A person's own sessions message each other across machines, whatever their visibility, private included.
2. The second member's agent resolves and messages a `listed` session. The message arrives as a peer message with its owner label and counts as nobody's words.
3. Once a session goes `private` with no shares:
   - **Nothing new reaches the second machine or member.** That machine and the member's browser receive none of its later events. `sminos list --org`, `find` and `@short` don't name it, the machine's log files and `uplink.json` carry none of its audience streams and nothing of it after its `unlisted` notice (its plain history from while it was listed stays, and the notice is served to the withdrawn, D6; a session born private shows none at all), the second machine asking the hub's HTTP history route for its writer by name gets nothing, and the project's git archive holds none of its streams.
   - **Nothing else names it.** A session it spawned that stays listed doesn't name it as its spawner to the second member. A `say` from one of the owner's listed sessions tagging it and a listed session together reaches the second machine only as the listed session's event, whose text names neither the private session's alias nor its short.
   - **A forged `say`** sent to it is refused at the hub's upload, and the sending session gets the `not-reachable` notice. It goes under the sender's plain writer, so the project's git archive holds it only as its tombstone.
   - **A share removed, then a stale `say`.** The second member is shared, the share is removed, and their session then sends a `say` from a view that still holds the session. The hub refuses it at upload, and the sender gets the notice; the session never receives it, and the project's git archive holds no file of its stream: the stale `say` carries the audience the share gave (D4), so it travels in an audience stream, which never enters the archive (D6).
   - **A share removed after admission.** A message the hub admitted while the share stood, still undelivered when the share is removed, is never delivered.

   P5's acceptance 3 reads "refused at the recipient's machine"; O18 meets it as "refused before delivery: at the hub's upload, with the recipient's endpoint as defense in depth" (Decision Log, 2026-11-05).
4. **A Can message share.**
   - **What it opens:** the second member's agents see and message the session, while the member's transcript read is refused.
   - **When it is removed:** the session drops out of their projection.
5. With the recipient's endpoint unreachable, a peer message stays owed and is delivered once the endpoint answers.
6. No mix of versions the org can run fans a private session's event out to a machine or browser outside its audience:
   - an old hub (the endpoint holds the events);
   - an old endpoint upstream (the hub refuses);
   - an old reader (the hub filters);
   - an old browser, or today's desk-web, whose frozen client seals no audience (the hub refuses its humans toward the session, and its words toward a listed session go as before);
   - an owner's own second machine on an old sminos, designated the project's archiver: it never receives the private stream (its endpoint withholds it), and the archive it writes holds none of it.
7. A private session's agent messaging a session outside its audience is refused at its own CLI with the unlisted message (D4), and nothing is written.
8. From an agent's shell, `sminos share <s> <person> view` and `sminos access <s> listed` are refused for an agent that follows its instructions, and `sminos access <s> private` from the same shell succeeds. M5's step-up cutover, before a second member joins the production org, closes widening to every agent that goes through sminos; a machine enrolled at no hub keeps the terminal gate (P5 Decision Logs 229 and 231).

## Constraints that bind every milestone

- **Fail closed:** an unanswered ask leaves a delivery owed, a missing capability holds the events back, and an unreadable registry refuses `state-unavailable`.
- **The hub only refuses:** nothing the hub decides admits a delivery; `reach?` does (D5).
- **Optional fields:** every new field is optional, and MAWS lands first.
- **Same owner:** a person's own sessions are never restricted among themselves.
- **One reader check:** every hub surface that returns stored events, writer names, vectors, audit rows or session-plane rows goes through `mayRead` (D6).
- **Each push asks:** no earlier admission or answer authorizes a later delivery (D8).
- **One audience per writer:** a writer stream carries exactly one audience, and the hub filters writers, never single events.
- **No new grade logic in sminos.** Intersecting the member lists the endpoint sends is set arithmetic, not grades.
- **Narrowing is open, widening needs the owner** (D10).
- **Reviews:** reviewer-high with a security lens on every landing that touches `reach?`, an audience, the registry, or the hub's fan-out (P5 O18 Review).
- **The machines:**
  - No machine.sock client on the MacBook's daemon, and MacBook app swaps only on the owner's word.
  - Production hub deploys and org-state signing stay the owner's.
  - A cua_repl hold on the MacBook stops heavy local work until its all-clear.

## Plan of Work

### M1 — The hub's policy registry, upload backstop and audience filter (MAWS)

**Scope.** The hub keeps the org's policy registry, refuses at upload what is out of reach and leaves a tombstone, serves each audience stream only to its audience (machines, browsers and the audit record alike), and takes device humans under audience streams.

**Work.**
- **First, the inventory of the hub's read surfaces.** Find every route and frame that returns stored events, writer names, vectors, audit rows or session-plane rows, and record the list in this document's Surprises. Found so far:
  - to machines: RL1 live fan-out (`fanOut`, `project.ts:1206-1215`), and `hello`'s `have` and `beyond` backlog (`:429-435`). The `have` also gains the hello's own machine's withheld positions (`withheld`, D6's archive), never another machine's;
  - over HTTP: the history log page (`worker.ts:319-324` → `historyPage`, `project.ts:564`), the history inventory (`worker.ts:314-318` → `historyWriters`, `project.ts:559`) and the attestations, each naming its writer (`worker.ts:326-331` → `project.ts:569`);
  - to browsers: live fan-out, `resume`'s pages and `after` offset (`:1132-1150`), the audit record live (`refusal`, `refuseBrowser`, `rejected`, `:1225-1234`, `:538-554`) and replayed (`:1148`), and the session plane's presence, pending set, deliveries and op outcomes at connect and as they change (`:155-163`, `:925`, `:976-985`).
  The browsers' `subscribe`, `rows`, `read` and `output` go to the session's machine, whose endpoint grades them, and stay as they are.
- **`mayRead(reader, writer)`** (Interfaces §A) in the Project, and each surface above passing it the authenticated reader (a machine's owners and its RL1 hello's `audience` capability, false on a DX2 stream; a browser's `attachment.member`) before it returns anything. The HTTP routes pass the machine principal into the Project's call.
- **`apps/org-protocol`:**
  - `audienceDigest(members)`, `streamOf(writer)` and `sessionRefs(event)` (Interfaces §A), used wherever a session is read from a writer or an event, the hub's push included (`project.ts:511`);
  - the optional `audience` and `policyRev` on the event types, the `withheld` tombstone and the `unlisted` notice;
  - `isHubPosition` (`names.ts:73-81`) accepting `hub/<member>~<digest>` when the digest is the event's audience's, and the device signing and verification rules covering `audience`;
  - `capabilities` on `Rl1Welcome` and on `EndpointHello`;
  - vectors in `apps/org-protocol/test/vectors.test.ts`.
- **The registry:** `apps/desk-hub/src/objects/policies.ts` (new), kept by the Registry like `OrgRecords`, with `Registry.policies({snapshots, sessions})` (Interfaces §A): one bounded call per upload batch that records the batch's snapshots and answers the rows of the sessions it names. The binding at first exposure: `Registry.storeListing` (`registry.ts:1451`) binds an unbound session id to the listing's machine, as a first snapshot does. The one-time backfill from every project's newest plain snapshots.
- **`upload` (`project.ts:445-525`):**
  - An event with an `audience` must sit under a writer whose digest matches; otherwise it is refused `audience`.
  - D5's checks against the registry, the `sessionRefs` of each event included: the binding, the redaction of narrower provenance references, and the `unlisted` notice's rule, which admits a valid notice in place of the sender-inside-audience check; the tombstone with the refused body's hash; a byte-identical resend refused the same way.
  - `state-unavailable` while the registry can't be read or hasn't been filled, storing nothing at the position.
- **`takeHuman` (`:1174-1203`):** the same checks with the member as the sender; the writer `hub/<member>~<digest>` for an event with an audience; an event with no audience toward a session with one refused `not-reachable`.
- **The machine's owners** for `mayRead`: `machineOwners` with the `SignedEvents` head, which needs a read accessor on its `held`.
- **The audit record:** besides `mayRead`, a row of an audience stream also goes to the member whose send it refuses, with its message dropped. `not-reachable` rows never carry a message.
- **The welcome:** `capabilities: ['audience']`.
- **The remote-layer spec:** the RL amendments table above, written into the spec's sections.

**Result.** A staging hub that never serves a private stream outside its audience, and refuses before fan-out what is out of reach.

**Proof.** Red first, in `apps/desk-hub/test/log.test.ts`, `signed-log.test.ts` and a new `policies.test.ts`:
- **Every read surface:** one test per surface in the inventory, a stream with audience {A} served to A's machine or browser and to no one else: live fan-out, `hello`'s `have` and backlog, browser resume, the audit record live and replayed, each session-plane frame, the history inventory and attestations, and a non-audience machine fetching a known private writer by name over `GET /machine/projects/<project>/log?writer=…`, which returns no events.
- **Reader position:** a reader outside the audience sees the plain writer of the same session continue with no hole.
- **Old endpoints:** a machine whose owners are in the audience gets none of the stream, live, in `have` or over HTTP, when its RL1 hello lacks `audience` or it syncs over DX2.
- **The registry:** a higher `policyRev` wins whatever the order of arrival; a tie goes to the newer `created`; an addressed copy or `titled` never moves it; a plain-writer snapshot clears the audience.
- **The binding:** a session listed by machine M, then a second machine racing a snapshot for the freshly listed id, is refused `not-reachable`, and M's own snapshot is then accepted; a snapshot binds an id never listed; a transition notice from a machine other than the bound one is refused.
- **`unlisted`:** a notice forged by another machine is refused; one whose `policyRev` isn't newer than the row's, or whose audience leaves the row's previous audience, is refused; a real removed-member notice from the bound machine is admitted, though its sender's owners are outside its audience, and served only to that member; a `say` of the same shape, its sender outside its audience, is still refused.
- **Provenance:** an event carrying an unredacted spawner reference to a session whose audience doesn't contain the event's is refused; the same event redacted is admitted.
- **`state-unavailable`:** with the registry unreadable, an upload is refused `state-unavailable` and nothing, no tombstone either, is stored at its position.
- **The backstop:** an event naming an unknown session, an event whose audience isn't a subset of a named session's, and an event whose sender's owners fall outside its audience are each refused `not-reachable`; after a share removal, an event carrying the old audience is refused; two same-owner private sessions with different shares exchange messages only under their intersection; the S→R example of D4 is admitted with audience {A} and refused with {A, B}.
- **Tombstone:** the writer's next event is accepted after a refused one; readers of the stream get the tombstone; a byte-identical resend is refused again, another body `conflict`.
- **Devices:** a browser's human toward a private session with the session's audience goes under `hub/<member>~<digest>` and reaches only the audience; an old browser's (no audience) is refused; a member outside the audience is refused.
- **Audit:** a browser outside the audience gets no row for a private stream's refusal, live or on resume.
- **Mismatch:** a writer whose digest doesn't match its audience is refused.
- **The welcome** carries the capability.

Gates `static,unit` (`scripts/ci-gate.sh <wt> --gates static,unit`), then a staging deploy (`apps/desk-hub/deploy/staging-deploy.sh`). Review: reviewer-high, security lens.

### M2 — The endpoint: the `list` grade, `reach?`, audiences and the policy cache (MAWS)

**Scope.** The endpoint decides reach, knows every session's audience it can verify, signs only well-formed audience streams, passes the hub's tombstones down, and holds private events back from a hub without the capability.

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
  - the policy cache (`src/endpoint/rl10/policy-cache.ts`, new) for remote sessions, fed from verified snapshots, its binding restored from what the hub admitted, rebuilt through paged `snapshots?` project by project when its file is lost, with each project marked done at sminos's last page and an interrupted rebuild resumed from the first project not done (D7);
  - while the rebuild is incomplete, uploads naming a remote session the cache hasn't confirmed held owed, and released when it completes or the session's snapshot arrives;
  - each local session's past audiences kept by `policyRev`, for the `unlisted` check;
  - sent to sminos as `audience` frames, local and remote, on every change and after each welcome.
- **Stream writers:** `sessionOfWriter` (`src/endpoint/rl10/attest.ts:20-24`) reads the session through `streamOf`, so a stream writer's events carry their attest.
- **Signing** (`src/endpoint/rl10/log-relay.ts` `#upAt`, `:270-304`):
  - an event under a stream writer must carry the intersection D4 gives from the endpoint's own records and cache;
  - refuse a mismatch, or a `say` whose recipients give differing audiences, to sminos as `audience`;
  - a snapshot's `policyRev` must be its record's;
  - an `unlisted` notice is signed only for a local session, under its own namespace, with an audience equal to its previous audience minus its new one, from the endpoint's own policy history; anything else is refused to sminos as `audience`;
  - provenance references (`sessionRefs`) whose session's audience doesn't contain the event's are redacted before signing, the attestation's `origin.spawnerSession` (`attestFor`, `attest.ts:27-37`) by leaving it out;
  - add `audience` and `policyRev` to `ENDPOINT_ADDS` (`signature-ledger.ts:31`) so sminos can't supply them, to the ledger's `Signature`, to `rebuilt()` (`log-relay.ts:491-493`) and to the echo comparison (`:462`), so a resend is byte-identical and the audience is frozen at first signing.
- **From the hub:** a `withheld` tombstone goes down as `spent {reason: 'withheld'}` in stream order; a `not-reachable` refusal goes down as today and settles the position rather than stopping the writer (`uplink.ts:156`); a `state-unavailable` refusal of a position the endpoint signed opens a hole at that seq, due after `ASK_MS`, in `refused` (`uplink.ts:155-166`), so the position is asked of sminos again with no reconnect and no further writes (D5).
- **The listing:** `recordFor` (`listings.ts:183-195`) adds `audience` and `policyRev` to a private session's channel listing.
- **Hold:** while the RL1 welcome lacks `audience`, keep stream events owed.
- **Down to an old sminos:** while sminos's RL10 hello lacks `audience`, no frame naming a stream writer goes down to it: stream events, their `have` entries, `spent` and `refused`. The policy cache still takes their snapshots (D9).
- **The hellos:** RL10's endpoint hello gains `capabilities: ['access', 'reach']`; the RL1 `EndpointHello` gains `capabilities: ['audience']`.

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
- **`test/endpoint/rl10/policy-cache.test.ts`** (new): a quiet session keeps its entry; a restart reads it back; a lost file is rebuilt through `snapshots?` and re-verified; streams arriving out of order settle on the highest `policyRev`; a plain-writer snapshot of a higher rev clears it; an unverifiable snapshot is not taken; a rebuild keeps each session's bound machine, and one whose stored snapshots name two machines stays unbound.
- **The rebuild across projects**, with a scripted sminos: several projects, several pages each, every page taken and each project marked done; a link dropped mid-rebuild resumes from the first project not done; an upload naming an unconfirmed session meanwhile stays owed, neither signed plain nor refused, and goes up once the rebuild completes.
- **`uplink.test.ts`, the signing cases:**
  - a mismatched digest refused;
  - the intersection signed for a private sender to a private recipient (D4's S→R example);
  - differing recipient audiences refused;
  - a stream writer's event attested;
  - the ledger keeping the audience across a resend;
  - the hold without the capability;
  - an sminos whose hello lacks `audience`, its machine's owner in a stream's audience and its machine the archiver: no stream event, `have` entry, `spent` or `refused` naming the stream goes down, the plain writers continue, and the policy cache still takes the stream's snapshot;
  - a tombstone passed down as `spent`, and a `not-reachable` refusal leaving the writer uploading;
  - an `unlisted` notice whose audience differs from the withdrawn set refused, the right one signed;
  - a listed child's snapshot and attest signed with a private parent's `spawnerSession` redacted.
- **`conversation.local.test.ts`** replays a private session against a local hub (Miniflare) built from M1, and:
  - owner A removes B's share: the notice, audience {B}, goes through the real signer, is admitted and is served to B only;
  - A makes a listed session private: the notice, audience every other member of the org, is admitted;
  - private parent, child later listed: the child's new snapshots and attests don't name the parent;
  - the registry down, then recovered, with no further writes and no reconnect: the refused event lands.

Gates `static,unit` plus the conversation replay. Review: reviewer-high, security lens. The MacBook's and the mini's app builds swap on the owner's word, at the next convenient build.

### M2b — Devices: an unchanged browser toward a private session (MAWS)

**Scope.** What the browser does toward a private session once M1 and M2 are in: refused at the hub, with nothing reaching an outsider, while its words toward listed sessions go as before. Desk-web's frozen DX6 client stays unchanged (D8, the architect's ruling).

**Work.**
- **The hub proof:** desk-web's words as its unchanged `say` seals them (DX1, no audience), against M1's `takeHuman`.
- **Desk-web reads the hub's `withheld` tombstone** (D5) as its own verdict, neither drawn nor reported as a forgery (`src/log/verify.ts`, `src/log/project-log.ts`), closing M1's residue.
- **Not built:** a browser that seals an audience (D8), and the policy rows it would read (Decision Log, M2b).

**Result.** From the browser, a private session can't be messaged and nothing of the attempt reaches anyone outside its audience. A listed session is messaged as today.

**Proof.** Red first, in `apps/desk-hub/test/policies.test.ts` on M1's local hub (Miniflare):
- the unchanged browser's words toward the private session, and an `@all` naming it with a listed one, are refused `not-reachable` and stored nowhere;
- the outsider's browser and machine hold no event naming the session, and the audit rows they see are content-free, naming no session and carrying no message (D5);
- its words toward the listed session, and its untagged record to everyone, go under `hub/<member>` and reach the outsider as before.

Also `apps/desk-web/src/log/verify.test.ts`: a tombstone is `withheld`, and one with anything more is malformed.

Gates `static,unit,e2e:desk-web`. Review: reviewer-high, security lens.

### M3 — sminos's visibility frames, records and audience streams (doperpowers)

**Scope.** sminos sends visibility, keeps it across record rebuilds, writes events under audience streams, and keeps those streams out of the archive. No setter yet (M4), so nothing here makes a session private outside the tests.

**Work.**
- **`member_frame`** (`sminos_uplink.py:1356-1385`) sends `access`, `shares` and `policyRev` when the endpoint advertises `access`. A session whose record file exists but can't be read (`sminos_records.unreadable`, `:115`) gets no member frame, is left out of a restatement, and writes no event (D10).
- **Records** (`sminos_records.py`): `access`, `shares` and `policyRev` kept by `_record`/`establish` (`:166-191`) and `inherited` (`:520-524`); a spawn takes its spawner's (`spawn_provenance`, `sminos.py:9343-9369`); all under the records lock.
- **The `audience` frame:** keep each session's audience, owners and `policyRev` from it (in the uplink state).
- **Streams:**
  - a writer is `<machine>/<session>` or `<machine>/<session>~<digest>`; the allocator learns the suffix (`HubLog.allocated_here`, `sminos_hublog.py:979-988`, and `writer_id`/`writer_path`, `sminos.py:1810`, `:1838`);
  - `stream_for` (Interfaces §C) chooses the writer by D4 for `lifecycle`, `publish_state`, the title and rename paths, `cmd_say`, `record_message` and `record_copy`, splitting per audience, each split's `text` its own recipients' leading tags and the unchanged body (D4);
  - snapshots carry `policyRev`;
  - projections, `addressed_to` and `match_members` map every stream of a session to that one session.
- **The private sender's refusal (D4)** in `stream_for`, before any append.
- **`sessionRefs`** in Python, pinned to the TypeScript one by a shared vector, used by projections, `addressed_to` and `stream_for`; a provenance reference narrower than the event's audience written null (`spawn_provenance`'s `spawnerSession`, `sminos.py:9365`, as `published_provenance` publishes it, `:2813-2827`; a continuation's `to`).
- **The archive copies the admitted public projection (D6):** `HubLog.on_have` (`sminos_hublog.py:708-739`) saves the `have`'s own-writer entries and its own-writer `withheld` list as `archive_have` in `uplink.json`, beside `archive_at`; M1's `hello` produces the list. `copy_log` (`sminos_archive.py:109-140`) writes, per plain writer, the positions the hub admitted: another machine's as imported, this machine's up to `archive_have`, each withheld position as its tombstone. No stream file. Both decisions come from the one saved `have`, never from `sent`, `taken` or a separately refreshed list. A writer this machine authored under a former name (`HubLog.is_own`, `sminos_hublog.py:902`) counts as its own here, never as imported. A `withheld` list too large for one frame (the 16 MiB assembled-frame limit, `apps/desk-hub/src/protocol/parts.ts:67`) fails the run; it is never truncated and taken as complete.
- **The hello:** `hello_frame` (`sminos_rl10.py:290-296`) advertises `capabilities: ['audience']`, in the same release as the archive's admitted projection (D9).
- **The `snapshots?` responder:** for each `snapshots?`, one project's newest stored `joined` and `state` per remote session writer, plain and stream, in pages of a bounded size, each answer naming the cursor of the next page and the last one marked `done: true` (Interfaces §B).
- **`state-unavailable` on a direct stream** (`HubLog.coded`; on RL10 the endpoint rewinds): `HubLog.on_refused` (`sminos_hublog.py:796-813`) sets `sent[writer]` back to `seq - 1`, due after the same wait as the endpoint's, so the position goes up again without a reconnect (D5).
- **The test stand-in:** `sminos/tests/hub_standin.py` filters by audience and refuses by the registry rule as M1's hub does (`fan_out`, `:430`; its hello and upload), with the tombstone, so sminos's suites run against the same rule. `sminos/tests/endpoint_standin.py` sends `audience` frames.

**Result.** On a machine with an M2 endpoint and an M1 hub, a private session's events travel only in its streams, and its policy survives every rebuild of its record.

**Proof.** Red first, in `sminos/tests/`:
- **Streams:** every event of a private session lands in its stream; a policy change starts a new stream with a higher `policyRev`; going listed returns to the plain writer.
- **Addressed events:** D4's S→R example writes under audience {A}; two private recipients with different audiences make two events; a cross-project copy carries its original's audience and splits the same way. From a listed sender, `@private#12345678 @public hello` makes a public event whose text is `@public hello`, naming neither the private alias nor `12345678`, and a private one whose text is `@private#12345678 hello`; the same split across projects gives copies with the same texts; an `@` after the leading run is kept as written.
- **Refusal:** a private sender to a recipient whose owners fall outside its audience is refused with nothing written (acceptance 7).
- **Projection:** a member reading only the plain writers never names the private session, through the stand-in's filter.
- **Records** (`test_records.py`): a provenance replacement, a continuation (background copy and resume) and a spawn keep `access`, `shares` and `policyRev`; a setter-shaped record write racing a reconciliation keeps both.
- **Archive** (`test-archive.sh`): the archive's commit holds the plain writer files and no stream file. On the archive machine, connected to its endpoint stand-in, with a stale listed view of a now-private recipient: a `say` written under the plain writer and taken by the endpoint's socket, while the stand-in hub holds back its admission, is not in an archive made then, though `taken` already covers it; after the hub's refusal and the next `have`, the archive holds its tombstone. Also: the hub tombstones the event, then the connection drops before the refusal reaches sminos; after a reconnect, and with no further write, the next archive holds the tombstone and not the body.
- **Snapshots:** a `snapshots?` over a project with more snapshots than a page answers every page and marks the last `done`; a project with none answers one empty page marked `done`.
- **Unreadable record:** an established private session's record corrupted: no member frame and no listing for it, and nothing written under any of its writers; once the record reads again, both resume. A session with no record file still restates with the defaults.
- **`state-unavailable`, direct stream:** the stand-in hub refuses it once, then recovers; with no further writes and no reconnect, the event lands.
- **Old endpoint:** no `access` capability means nothing new is sent.

Gates `sminos,sminos-suites,sminos-mods,mods-types,repo-checks`. Review: reviewer-high, security lens (it touches audiences). sminos minor bump.

### M4 — sminos's send boundary, the setters, refusals and unlisting (doperpowers)

**Scope.** Every push asks `reach?`, the owner gets the setters in the same release, a hub refusal reaches the sender as a notice, and projections honour `unlisted`.

**Work.**
- **The boundary** (D8): `ReachGate` (Interfaces §C) beside `WordsGate` (`sminos.py:4374`), called inside the push primitives, `push_live` (`sminos_control.py:183`) and `resume_session` (`sminos.py:9535`) when it carries a message, for every log event handed over as a peer frame, on every machine whose endpoint advertises `reach`. Every caller (`deliver_next`, `deliver_verdict`'s `peer`, `holder_carry`'s receipt pushes and retries, `send_to_seat`, `send_to_member`, `SendDelivery`'s queue) reaches it through them, and none asks on its own. A refused or unanswered ask raises before anything is handed over, so the caller settles or keeps the delivery as it does a failed push. A recipient whose record can't be read (D10) is held owed without an ask. The projectless push's owner check (D8).
  - No answer within `REACH_WAIT` (10 s, as `WORDS_WAIT`) leaves the delivery owed.
  - `refuse` settles it `refused-reach` (a new outcome in `sminos_outcomes.py`, beside `refused-words`) with one content-free `daemon.log` line.
- **The setters:** `sminos access` and `sminos share` (D10) through `set_visibility`. Widening is operator-only, with confirmation at `/dev/tty`. A change that withdraws members (going private, removing a share) writes D6's `unlisted` notice, its audience the previous audience minus the new one, then the new snapshot; a new share or a raised grade writes the snapshot alone.
- **The sender's side:** `HubLog.on_refused` (`sminos_hublog.py:796`) takes `not-reachable` to `HubLog.withhold_own` (D5), as does an own `withheld` tombstone on resync; the daemon shows the sending session the notice.
- **Projections** drop a session at an `unlisted` notice visible to the reader, unless they also see a snapshot at its `policyRev` or later.

**Result.** A message outside its reach never reaches the session, its sender learns why in one word, and its owner controls its reach from a terminal.

**Proof.** Red first:
- **The setters:** an agent's shell running `sminos share <s> <person> view` and `sminos access <s> listed` is refused, and `sminos access <s> private` from the same shell succeeds (acceptance 8).
- **Every path:** refused for each D1 refusal, delivered for each grant, through a live seat, a stopped seat's resume, a legacy holder's direct push, and a same-machine session of another member; an earlier queued event the endpoint refuses is left out of the batch.
- **Registry admits, endpoint refuses:** the stand-in hub admits an event (its registry still listed), the endpoint stand-in refuses `reach?`, and nothing is delivered.
- **Admission doesn't carry over:** a member's `hub/` human toward a private session shared to them is admitted, the share is removed before the words verdict, the verdict comes back `peer`, and the push asks `reach?` again and is refused; likewise a receipt's retry after a share removal.
- **Unreadable recipient:** a message to an established session whose record is corrupt stays owed, with no `reach?` asked, and is delivered once the record reads again.
- **Owed:** owed while the endpoint is silent, then delivered (acceptance 5).
- **The notice:** a `not-reachable` refusal settles the own event withheld, the writer's next event uploads, and the sending session gets the notice.
- **Broadcast:** a broadcast skips what it can't see.
- **Unlisting:** `unlisted` drops the session from `list --org`, `find` and `@short` resolution for the withdrawn member, and not for a member still in the audience; removing one share writes a notice audienced to that member alone, going private one to everyone else in the org.

Gates as M3. Review: reviewer-high, security lens. sminos minor bump; this release is the first in which a session can be made private.

### M5 — O8's share picker and help text (an external contract; blocked on O8 M6)

M5 is outside O18's acceptance, which runs on the CLI setters. It is built by the architect with O8 M6, and needs:
- **Two offers** in `src/endpoint/offers.ts`, named as O8's `record.owners` is (P5 Decision Log 50), `manage`-graded, each carrying a step-up (the endpoint requires one for every `record.*`, `src/endpoint/step-up.ts:14`, which covers every widening):
  - `record.access {access: 'private' | 'listed' | 'org-view' | 'org-converse'}`;
  - `record.shares {member, grade: 'list' | 'view' | 'converse' | 'approve' | null}` (null removes the share).
- **The executor:** O12's sminos executor runs each under its opId ledger by calling `set_visibility` (Interfaces §C), the same function the CLI verbs call, so the two paths can't differ. Built in sminos 1.38.0 beside O8's `record.owners` (`sminos_visibility.add_owner`), behind the `record` capability on sminos's RL10 hello (Interfaces §C; the frame is O8's, its document's §Q).
- **The picker's text:** the **Can message** level; a private session's agents talk only within its audience; what was already shared stays shared; the old "say messages stay org-readable" warning (O8 document `:1032`) is gone.
- **The cutover.** Once this machine's endpoint serves the app's `record.access`, `record.shares` and `record.owners` offers (O8 M6b), sminos's CLI refuses widening, from a terminal too ("use MAWS"), and keeps narrowing; the desk track builds it (P5 Decision Log 232). M6's live run, if it comes later, widens through the app or a staging-only path instead of the CLI. Why: a same-user agent can defeat the CLI's `/dev/tty` confirmation by running the CLI under a pty it controls, with `CLAUDE_CODE_SESSION_ID` unset (M4's first review reproduced it), so only the app's step-up closes widening to agents. The cutover lands before a second member joins the production org (M6).
  - **Keyed on the endpoint's word, not a landing date** (the architect's ruling, sminos chat 1164). The endpoint's welcome carries `record` exactly when it serves those offers; a headless machine's sessions are widened from any member's MAWS through its endpoint, so it counts. sminos updates through the plugin marketplace on its own and the MAWS app only by swap, so a cutover keyed on M6b's landing could reach a machine whose endpoint can't carry the acts and leave its owner no way to widen.
    - Sticky: sminos keeps the last welcome's capabilities (`daemon/audiences.json`). An endpoint that is away, stopped or unreachable leaves the cutover in force, so stopping mawsd never reopens the terminal gate; only a later welcome without `record` (a MAWS rollback) lifts it. On a machine cut over to its endpoint, a missing or unreadable file counts as `record`.
    - A machine not cut over to an endpoint gets no welcome and keeps the terminal gate: one enrolled at no hub (below), and one on a hub over DX2 alone, which no record act can reach.
    - The second member's precondition: every enrolled machine runs sminos 1.39.0 or later and its endpoint's welcome carries `record`, beside the production hub rule (P5 Decision Log 227) and board #492's restatement (Decision Log 229).
  - **What it closes:** widening by every agent that goes through sminos, not by a hostile process of the same user. Neither the endpoint nor the hub checks a widening against an act: the endpoint takes a session's access and shares from sminos's member frame, and the hub's registry takes the machine-signed snapshot, checking only its binding and `policyRev` order. A process that writes sminos's record file, calls `set_visibility` itself or moves `hub.json` aside still widens; it could already send the transcript anywhere, so a hub-checked act would close one path of many.
  - **A machine enrolled at no hub keeps the terminal gate.** It has no org, no second member and no app path, so refusing would leave its owner no way back from private. Enrolled means `hub.json` in the same sminos home as the records, never an environment variable, a flag or a state directory pointing elsewhere; enrolling changes no record, so the cutover applies from enrollment on. The exception is per machine, not per project: on an enrolled machine every directory without a `.smns` is in a hub project, a project a committed `.smns` declares with no hub publishes nothing (so a session stranded there reaches no one), and a per-project exception would open a path through sminos's own verbs: join a project with no hub, widen at a terminal, join back (P5 Decision Log 231).

**Proof:** O8's own e2e for the picker; for the cutover, a sminos test that a widening from a terminal is refused and a narrowing still runs, and that a machine enrolled at no hub still widens at its terminal.

### M6 — Live acceptance on the staging org

**Scope.** Acceptance 1–8 run live on `staging-ssfskim`, except the three clauses cited below, each item's evidence recorded in Outcomes. M1's production deploy, the owner's, waits for this proof. The shape is the architect's ruling (2026-11-07, Decision Log).

**The scene.**
- One devcloud VM holding four scratch scenes. Each is its own Linux user, home, mawsd profile, sminos home, ports, tmux socket and mount namespace, so the hub sees four machines:
  - A1 (`o18a1`) and A2 (`o18a2`), owned by the staging admin member, the owner's staging identity. S runs on A1 and T on A2. S spawns L1 while listed and C1 once private.
  - B1 (`o18b`), owned by a second member B added for the run (O10's `buildScene` member, named per run, with its device `b1`). U runs on B1.
  - A3 (`o18a3`), owned by the admin, on sminos 1.34.0 (`386c4b07`, before M3), brought up last for 6e as the designated archiver.
- Two in-process probe machines on the MacBook, speaking only to the staging hub: PA, owned by the admin, whose RL1 hello lacks `audience` (an old endpoint and an old reader); and PB, owned by B, whose hello carries it.
- One project with a fresh id. Every scene's `.smns` names it with the staging hub and a `remote` at a bare repository on the VM, the archive. The archiver is designated per item through the admin's `PUT /api/projects/<p>/archive`, with `SMINOS_ARCHIVE_EVERY=60`.
- **Pins.** MAWS is pinned to the M6 branch's cut, before O8 M6b, so the scene's endpoints advertise no `record` and the terminal gate still widens. sminos is pinned by commit: doperpowers `0759115d` (1.39.0) or later for A1, A2 and B1, and `386c4b07` for A3. Each is copied into its scene from the run's payload, never taken from the VM's marketplace.
- **The VM:** created for the run without the MAWS project, so no mawsd of its own is provisioned into the production org (the owner's answer, 2026-11-07, Decision Log). It is leased for about a day. The harness brings its own MAWS checkout (a full bundle) and depends on none on the VM, nor on devenv's MAWS setup: `vm/setup.sh` installs what devcloud's base image lacks, pinned, and `vm/check.sh` reports it.

**The harness** (MAWS, `apps/desk-hub/deploy/`), built on O10 M11's pieces (`VmMachine`, `ScriptRunner`, `OrgAdmin`, `ItemReport`, `Cleanup`, `RelayDialer`). O10's own run is unchanged.
- **`vm/scene.sh`, parametrized by scene:** user, ports, verb registry (`/run/o18-<scene>-verbs`), sminos copy and archive environment. It defaults to O10's `o10acc`, and `stop_verbs` matches its own scene's registry alone. Every new verb that starts or touches an engine runs inside the scene's namespace, which hides the VM's managed settings (the stub-model guard).
  - `as-session <sid> <subverb> …`: the session's shell, with `CLAUDE_CODE_SESSION_ID` set. Its subverbs are structured (`say <token> <tag>…`, `access`, `share`, `spawn`, `list-org`, `find`), since a VM step's words admit no space and no `#` (`endpoint-machine.ts:337`).
  - `operator <access|share …>`: the operator at the scene's terminal, under a pty the run controls, answering `y`.
  - `operator-say`. And `forge-say <writer> <recipient> <alias> <token>`, which writes a `say` under the plain writer through `sminos.log_append`, past `stream_for`.
  - Reads: `log-files`, `grep-home <token> [--after <ts>]`, `uplink`, `owed`, `policy-cache`, `archive-ls`.
  - `mawsd-freeze`, `mawsd-thaw`, `mawsd-stop`, `mawsd-start`.
- **`vm/setup.sh` and `vm/teardown.sh`:** the scene users, one shared pack build, the pinned sminos copies, and the archive's bare repository and group. Teardown removes every scene user, the repository and the ports.
- **`endpoint-machine.ts`** gets a `scene` option on `VmMachine` and a method per new verb. **`org-admin.ts`** gets `owners?` on `enrollListed` and `listedMachine`, which today hard-code `[this.member]` (`:206`, `:249`).
- **`reach-acceptance.ts` and `reach-items.ts`**, registered in `deploy/bin.ts`, with the scene pieces they share factored out of `buildScene` rather than bending O10's `ITEMS`. The run prints one `PASS`, `FAIL` or `NOT SHOWN` line per item and sub-item, `report.bySuites` for the cited clauses, and `LEFT` and `KEPT` lines after the undo.
- **`staging-run.sh reach [args…]`**, modelled on `endpoint`: production's header before and after, the token on stdin, and the secret scan. Beside it, `reach-vm setup [--vm <vm>] [--sminos <commit>] [--old-sminos <commit>] | teardown [--vm <vm>]` (no `<base>`: a full bundle has none; Decision Log 2026-11-07), and the README's section for both.
- **The pty path is staging's alone.** `operator` widening is refused unless the run's hub is staging's (`staging.json`'s host and org) and the machine is one of the run's own scenes. A test pins both refusals.
- The stale O10 defaults (the deleted VM `dc-acceptance-7f80`, its address, the 0.15.1 devcloud path) give way to required arguments and the devcloud on PATH.

**Items, live, in the run's order.**
1. The scene comes up and is preflighted: every session is in `/api/listings`, every sminos is on RL10, every `audiences.json` carries `access` and `reach`, and PB's welcome carries `audience`.
2. Item 2, with S listed. S spawns L1.
3. Item 8's first sentence: going private succeeds, then going listed and adding a share are both refused, with `policyRev` unchanged.
4. 3a, with C1 born private and A1 archiving.
5. 3b: the spawner, and the split `say`.
6. 3c, with B1 archiving (the tombstone).
7. Item 7.
8. Item 1: S and T, then both private.
9. Item 5: A2 frozen, then stopped.
10. Item 4: shared, seen, messaged, `b1`'s transcript read refused, unshared, dropped.
11. 3e: A1 stopped across the removal.
12. 3d: B1 frozen across the removal.
13. 6b and 6c from PA.
14. 6d: a device human on the owner's socket, refused toward S and admitted toward T.
15. 6e on A3.

**Cited, not run:**
- 6a, an old hub (`test/endpoint/rl10/audience-signing.test.ts`, the holds while the hub's welcome lacks `audience`). Running a pre-M1 hub over M1's stored tombstones would put staging's logs at risk.
- Acceptance 8's cutover sentence (sminos `test_visibility.py` `Cutover`). The scene's MAWS predates the `record` acts, and O8 M6b's own e2e proves the step-up path.
- 3a's browser half (`apps/desk-hub/test/audience-reads.test.ts`). The second member is `@staging.invalid`, and the hub resolves a browser's member by Access email alone.

**Steps:**
1. Prep: a MAWS worktree on the M6 branch, the sminos commits, and `staging-run.sh prod before`.
2. `staging-run.sh deploy`, then `build`. Its `hub@` must be the worktree's HEAD, with M1's merge `ff1b9d581` as an ancestor.
3. Bring the VM up (`devcloud vm up`, no `--project`) and run `vm/check.sh`, then `reach-vm setup --vm <vm>`.
4. Rehearse item by item (`--items`), then run the whole sequence.
5. Record the evidence, then `reach-vm teardown` and `devcloud vm down`.

**Undo**, each step registered before the thing it undoes: shares removed and seats retired; scenes down; A1, A2, B1, A3, PA and PB taken out of the state and revoked; the archive designation cleared; B removed and `b1` revoked. Then the read-back prints `LEFT` for anything still current. Kept by design: the project and its log, the run's registry rows, the machines' names and retired keys, the state's versions, and staging at the M6 build.

**Proof:**
- The harness's tests: O10's run unchanged under the parametrized scene, the pty path's two refusals, and the new verbs' argument checks.
- The run's lines, with every item `PASS` or cited.
- reviewer-high with a security lens on the harness, which enrolls, signs and widens.

**Production:** M1's production deploy is the owner's, after this proof. A second member joins the production org only once O18 has landed, and M5's cutover with it (M5 says why).

## Concrete Steps

Working directories are worktrees under `/Users/new/.local/share/p5-desk-track-owner/wt/`.

    # MAWS milestones (M1, M2, M2b), from the worktree:
    bash <wt>/scripts/ci-gate.sh <wt> --gates static,unit
    # expected: one PASS per gate, then GREEN <run-url>

    # the hub to staging (M1), agent-runnable:
    zsh <wt>/apps/desk-hub/deploy/staging-deploy.sh

    # sminos milestones (M3, M4), from the doperpowers worktree:
    /Users/new/.claude/plugins/cache/doperpowers/ci-kit/<ver>/bin/ci-gate <wt> --gates sminos,sminos-suites,sminos-mods,mods-types,repo-checks
    # expected: GREEN <run-url>

    # live acceptance (M6), from the M6 worktree:
    zsh <wt>/apps/desk-hub/deploy/staging-run.sh prod before
    zsh <wt>/apps/desk-hub/deploy/staging-run.sh deploy
    zsh <wt>/apps/desk-hub/deploy/staging-run.sh build        # expected: hub@<the worktree's HEAD sha8>
    zsh <wt>/apps/desk-hub/deploy/staging-run.sh reach-vm setup --vm <vm>   # the scenes on the run's VM
    zsh <wt>/apps/desk-hub/deploy/staging-run.sh reach --vm <vm> --direct-url ws://<its tailnet address> [--items <list>]
                                                                            # expected: PASS per item, CITED 6a, then no LEFT
    zsh <wt>/apps/desk-hub/deploy/staging-run.sh reach-vm teardown --vm <vm>

The gates run on GitHub Actions; the MacBook runs no MAWS Electron e2e.

## Interfaces and Dependencies

### A. Streams, audiences and the registry (`apps/org-protocol`, `apps/desk-hub`, M1; read by M2, M2b and M3)

    audienceDigest(members: readonly string[]): string
      // sha256 over JSON.stringify([...new Set(members)].sort()), first 16 hex chars, lowercase
    streamOf(writer: string): { base: string; digest: string | null }
      // "<machine>/<session>~<digest>" -> { base: "<machine>/<session>", digest }; likewise "hub/<member>~<digest>"
    // event (optional fields, inside the v2 signature, and inside a device's seal):
    audience?: string[]          // sorted member ids
    policyRev?: number           // on joined and state snapshots
    sessionRefs(event): EventSessionRef[]   // EventSessionRef = { session: string; role: 'addressing' | 'provenance'; path: string }
      // every structured session reference an event carries (D4), the writing session's own aside; `path` names the
      // field, dot-separated (`to.0.session`), for redaction. The type is EventSessionRef, not SessionRef: the package
      // already exports RL3's SessionRef ({lane, id}, messages.ts). A null or absent reference is none.
    writerSession(writer): string | null          // the session a writer (plain or stream) is the feed of
    isAudience(v): v is string[]                   // member ids, at least one, sorted, distinct
    streamWriter(base, audience): string           // `${base}~${audienceDigest(audience)}`
    isUnlistedNotice(event), isWithheldTombstone(value)
    // the transition notice (sminos log event), content-free:
    { kind: 'unlisted', session: string, policyRev: number, audience: string[] /* the withdrawn members */ }
    // the hub's refusal of an out-of-reach upload, and what it stores in the position's place:
    { t: 'refused', project, refusal: { reason: 'not-reachable', writer, seq } }     // no message: the hub's
      // machine-protocol `Refusal.message` is optional from M1 on (apps/desk-hub/src/protocol/machine.ts)
    { t: 'refused', project, refusal: { reason: 'audience', writer, seq, message } } // audience and writer disagree
    { writer, seq, withheld: true }                                                 // served in the writer's stream
    // the registry (Registry DO, Policies table):
    Registry.policies({ machine?, snapshots: Snapshot[], sessions: string[] }): Promise<Result<{ rows, mine }>>
      // machine: the uploader's name (absent for a device's words); every snapshot is that machine's own
      // Snapshot = { session, audience: string[] | null, policyRev, created }
      // rows: Record<session, Policy | null>, each as it stood BEFORE the batch; the Project replays the batch in order
      // mine: Record<session, boolean>, bound to `machine` AFTER the batch (a binding never moves)
      // Policy   = { audience: string[] | null, policyRev, created }
      // The binding (held inside the Registry): the machine's ref, by a snapshot here or a listing in
      // Registry.storeListing; `name:<key>` for a machine with no ref, taken as its ref once it has one. A live listing
      // of a session no snapshot set stands as listed at policyRev -1. `503 state-unavailable` until the fill is done.
    // the one reader check, in the Project, before any read surface returns (D6):
    mayRead(reader: { machine: string; owners: string[]; streams: boolean } | { member: string }, writer: string): boolean
      // streams: the machine's RL1 hello advertised 'audience'; false on a DX2 stream
    // RL1:
    Rl1Welcome.capabilities?: string[]       // 'audience' (HUB_CAPABILITIES)
    EndpointHello.capabilities?: string[]    // 'audience': this endpoint withholds streams from an sminos without it
    RL1_CAPABILITIES.audience, isCapabilities(v)   // at most 32 names of at most 64 characters
    // a machine's own writers (its name the writer's prefix) are always its to read, whatever their audience

sminos computes `audienceDigest` identically in Python, `hashlib.sha256(json.dumps(sorted(set(m)), separators=(',', ':')).encode())`, and a shared vector in `vectors.test.ts` and `sminos/tests/` pins the two together. Use the same JSON separators on both sides.

### B. RL10 and the listing (M2 ↔ M2b, M3, M4)

    sminos → endpoint:  {t: 'reach?', id, project, session /* recipient */, event /* as stored, less sminos's verified */}
    endpoint → sminos:  {t: 'reach', id, verdict: 'deliver' | 'refuse', reason?: 'not-reachable' | 'unverified'}
    endpoint → sminos:  {t: 'audience', session, owners: string[], members: string[] | null, digest: string | null, policyRev, withdrawn?: string[]}   // withdrawn (M4): who this rev's change withdrew, the exact audience of its `unlisted` notice; absent when none
                          // members null: listed; sent for local sessions and for remote ones the policy cache holds
    endpoint → sminos:  {t: 'snapshots?', id, project, after?: string}       // a lost policy cache, one project at a time
    sminos → endpoint:  {t: 'snapshots', id, project, events: [...], next: string | null, done: boolean}
                          // newest stored joined/state per remote writer, a bounded page; `done` on the project's last
    endpoint → sminos:  {t: 'spent', project, writer, seq, reason: 'withheld'}   // a hub tombstone, in stream order
    sminos → endpoint:  {ts, writer, seq, kind: 'void', of: seq, audience?}     // an uploaded event at a position refused `audience`,
                          // reviving the writer; `audience` (a stream's only) is sminos's claim, signed when its digest is the writer's
    endpoint hello:     capabilities?: string[]   // 'access', 'reach'
    sminos hello:       capabilities?: string[]   // 'audience': streams may come down; its archive copies only the admitted public projection
    member frame:       access?: 'private' | 'listed' | 'org-view' | 'org-converse'; shares?: [{member, grade: 'list'|'view'|'converse'|'approve'}]; policyRev?: number
    Listing.fields:     audience?: string[]; policyRev?: number     // a private session's channel listing only

`decideReach(ctx: WordsContext, ask) → 'deliver' | {refuse: reason}`, in `src/endpoint/rl10/reach.ts`, takes the same context as `decideWords`.

### C. sminos (M3, M4, D5's restatement, M5's executors)

- `sminos access <member> <level>` and `sminos share <member> <person> <grade|none>` (D10), both through `set_visibility(sid, *, access=None, share=None, operator) → {record, changed, transition}`: the record change under the records lock (`sminos_records.set_policy`, `policyRev` bumped) and the pending transition, which the uplink completes as D10 says. A widening without `operator` raises `Widening`. M5's executor calls it with the act's proof.
- `stream_for(project, writer_session, recipients, text=None, raws=None) → [(writer, audience, recipients, text)]`, raising `Unreachable` (the D4 refusal) or `StreamUnknown` (D10): the one stream choice every append path uses; given `raws` (each recipient's raw leading tags), each split's `text` carries only its own recipients' tags.
- `ReachGate(project).held(event, session, words=None) → None | 'owed'`: the one push check, called inside `push_live` and `resume_session` (`reach_hold` raises `ReachHeld` before anything is handed over), so every deliverer reaches it. It lets a peer frame through only under the single-use permit the uplink sets around the one push that follows a `reach {deliver}` (`deliver_reach`), or between one owner's sessions of this machine; a refusal is settled in `deliver_reach`, never by the gate.
- `sessionRefs(event)` in Python, the same list as §A's, pinned by a shared vector.
- `HubLog.withhold_own(writer, seq)`: an own position the hub withheld.
- `uplink.json` `archive_have: {have: {writer: seq}, withheld: {writer: [seq | [from, to], …]}}`: the own-writer entries of the `have` that last confirmed the archive, and the positions the hub withheld in them, as runs on the wire; `copy_log`'s frontier for this machine's writers. Beside it, `dead {writer: {at, last, final?}}` (writers stopped by an `audience` refusal), `voided` and `withheld` (`{writer: [seq]}`, each for good) and the notices not yet shown.
- `daemon/audiences.json` `{v, capabilities, sessions: {sid: {owners, members, policyRev, withdrawn?}}}`: the endpoint's capabilities and `audience` frames, kept by the uplink and read by every writer, the CLI's included.
- `<project home>/streams.json` `{writer: audience}`: this machine's own streams, each kept before its first event; a void's claimed audience.
- `daemon/visibility.json` `{v, sessions: {sid: transition}}`: the transitions `set_visibility` records and the uplink completes.
- RL1 `have` (M1): optional `withheld: {writer: [seq | [from, to], …]}`, for the hello's own machine's writers only.
- Outcome `refused-reach`, settled on this machine and never reported. `REACH_WAIT = 10`.
- `<project home>/restate.json` `{session: {kind: {writer, seq, ts, restating?, restated?}}}` under its own lock: the restatement owed for a withheld own `joined` or `state` (D5), one per session and kind, written by `withhold_own` (`sminos_daemon.owe_restatement`) and the daemon tick (`restate_withheld`).
- RL10 `rpc` `record.access {session, access}`, `record.shares {session, member, grade | null}` and `record.owners {session, member, add: true}`, each with its act as `proof`, offered behind the hello capability `record` (sminos 1.38.0). They answer `done {changed, policyRev}` or refuse `no-session`, `unsupported`, `bad-shape` or `read-only` (sminos) and `stale`, `expired` or `tombstoned` (the ledger). `record.access` and `record.shares` call `set_visibility(..., operator=True)`; `record.owners` calls `sminos_visibility.add_owner`, which admits `[@machine, B]` (RL §5.8), appends the act to `ownersProof` and bumps `policyRev` whatever the access. The proof must be this op's own `isAction`-shaped act: its target, change, opId, device and machine are the RPC's.

### D. M5 (O8 M6, the architect)

`record.access {access}` and `record.shares {member, grade | null}` in `src/endpoint/offers.ts`, `manage`-graded with step-up, executed by O12's sminos executor through `set_visibility`. They ride O8 M6b's Share sheet beside `record.owners`; sminos's half, with the frame §C gives, is built in 1.38.0.

## Surprises & Discoveries

- Observation: filtering single events would stall every reader's import, because sminos holds back any event past a per-writer hole. RL §6.2 already relied on that to declare the log plane org-readable.
  Evidence: `sminos_hublog.py:249-270` (`append_verbatim` → `"gap"`), RL spec `:542`.
- Observation: the sender's endpoint can't know a remote private session's audience on its own, and neither can a device. Only the session's own signed snapshots, or its channel listing, carry it.
  Evidence: the endpoint knows only local sessions' records (`src/endpoint/rl10/members.ts`); the hub holds no session visibility (`apps/org-protocol/src/types.ts:113-119`).
- Observation: an old endpoint rejects a whole member frame on an unknown share grade, so sending the `list` grade early would fail closed for everyone on that machine.
  Evidence: `src/endpoint/rl10/members.ts:70`.
- Observation: the share picker O18's UI needs is unbuilt.
  Evidence: `docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md:1029-1036`.
- Observation: copying the recipient's audience would put a private sender's words before members of the recipient's audience that the sender never shared with. The two audiences have to be intersected.
  Evidence: review, 2026-11-05; D4's S→R example.
- Observation: a hub refusal stops its writer for good, and an own position can't be spent once an event holds it, so a refusal at upload needs a tombstone and a settlement of its own.
  Evidence: `sminos_hublog.py:796-813`, `:990-1012`.
- Observation: the inbound index holds content hashes only, pruned at 30 days, so it can't be where a sender learns an audience.
  Evidence: `src/endpoint/rl10/inbound-index.ts:1-11`.
- Observation: a stream writer would lose its attest and its allocation without a change, since both read the session from the writer by exact shape.
  Evidence: `src/endpoint/rl10/attest.ts:20-24`; `sminos_hublog.py:979-988`.
- Observation: four push paths besides `deliver_next` carry a send straight to a session.
  Evidence: `sminos.py:9836-9856`, `:10109-10120`, `:9972-9989`, `:10054-10074`.
- Observation: a record's rebuild drops every field but its provenance, so a session's policy would reset to listed on a resume.
  Evidence: `sminos_records.py:166-175`, `:520-524`.
- Observation: the audit record and the git archive each send every writer to everyone in the project, outside the fan-out the design filters.
  Evidence: `project.ts:538-554`, `:1148`, `:1225-1234`; `sminos_archive.py:109-140`.
- Observation: desk-web trusts machine signatures only on listings; log events it verifies by the org MAC, which any member can produce.
  Evidence: `apps/desk-web/src/log/verify.ts:15-18`.
- Observation: filtering the fan-out isn't enough: the hub's HTTP history route hands any enrolled machine any writer it names, and the session plane names sessions to every browser.
  Evidence: `apps/desk-hub/src/worker.ts:319-324`, `log-store.ts:201-210`; `project.ts:155-163`.
- Observation: the archive copies an own event before the hub has answered for it, so a refused body can reach the public remote.
  Evidence: `sminos_archive.py:109-140` reads the writer file whole; the hub's frontier is `HubLog.taken`, `sminos_hublog.py:560`.
- Observation: a session's listing usually reaches the hub before its first snapshot, so a binding by first snapshot alone leaves a window to race.
  Evidence: `sminos_uplink.py:2083` (`members_before`), `members.ts:134-146`.
- Observation: an unreadable established record restates as the defaults, so a corrupt record would list a private session.
  Evidence: `sminos.py:2950-2952` returns None; `sminos_uplink.py:1367-1381` fills in the defaults.
- Observation: a hub `state-unavailable` stalls its position until a reconnect, because the endpoint only re-arms a hole it already holds.
  Evidence: `src/endpoint/rl10/uplink.ts:155-166`; `sminos_hublog.py:796-813`.
- Observation: a spawn names its spawner in three places (the record's origin, the `joined`, the attestation), so a listed child would name a private parent.
  Evidence: `sminos.py:9365`, `:2813-2827`; `src/endpoint/rl10/attest.ts:27-37`.
- Observation: every live peer push ends in `push_live`, whichever caller started it, so the gate belongs there, not in five callers.
  Evidence: `sminos_control.py:183`; its callers at `sminos.py:4308`, `:4960`, `:4985`, `:9855`, `:10120`.
- Observation: `taken` isn't admission. On RL10 it moves when the endpoint's socket takes the frame. No echo of an own event comes back live to show admission either: the hub's fan-out skips the sender, and a hello's backlog starts past the machine's own `have`, so the endpoint's echo check sees an own event only after its machine lost it. The one hub-confirmed frontier the sender gets is the vector in each `have`, which the archive already waits for.
  Evidence: `sminos_uplink.py:1155-1166`, `:2096-2102`; `apps/desk-hub/src/objects/project.ts:503`, `:1205-1215`, `:434`; `src/endpoint/rl10/log-relay.ts:455-466`; `sminos_archive.py:10-14`, `sminos_hublog.py:708-739`.
- Observation: an old sminos inside a stream's audience would put the stream on the org-readable archive if its machine archives the project, and the hub's audience filter can't tell, since the machine's owners are inside.
  Evidence: `sminos_archive.py:109-140`; `sminos_rl10.py:295` and `src/endpoint/rl10/link.ts:397` advertise no capabilities; `EndpointHello` has none (`apps/org-protocol/src/relay.ts:99`).
- Observation: a `say`'s text opens with its addressing tags, so splitting by audience without rewriting the text would leave the private recipient's alias and short in the public event.
  Evidence: `sminos.py:4655-4674` (`leading_tags`), `:5218` (`"text": a.text`).
- Observation: D5's sender-inside-audience check refuses every valid `unlisted` notice, since the notice's audience is exactly the members its sender's change withdraws.
  Evidence: review, round 3; D5's refusal list against D6's notice.

- Observation (M1, the inventory of the hub's read surfaces, on master `49dd6b262`): these are every route and frame that returns stored events, writer names, vectors, audit rows or session-plane rows. Each now asks `Project.mayRead` for its reader first; session-plane rows ask `maySeeSession`.
  - To machines:
    - the live fan-out (`fanOut`);
    - a hello's `have`, its new `withheld` and its backlog (`hello` → `LogStore.beyond`);
    - the `refused` and `resend` frames, which go only to the uploading machine and name its own writers.
  - Over HTTP:
    - the history page (`historyPage`);
    - the inventory (`historyWriters`, through `Registry.historyInventory`);
    - the attestations, on both the machine route and the member route (`/api/projects/<p>/attestations`, `worker.ts:280-284`). The first list missed the member route.
  - To browsers:
    - the live fan-out, and `resume`'s pages;
    - the audit record, live (`refusal`, `refuseBrowser`, `rejected`, and `settled`'s `decided` row) and replayed;
    - the session plane at connect (presence, pending, ops, deliveries) and as it changes (`session` for `op`, `presence`, `raised`, `settled` and `delivery`; `cameOnline`; `pendingChanged`).
  - Web Push: the push the log plane sends for a DX2 machine's `message` or `question` names its session to every member, so an audience stream's event is never pushed. The grid summary carries counts only.
  - Not surfaces:
    - `subscribe`, `rows`, `read` and `output` go to the session's machine, and its endpoint grades them.
    - Session-plane frames: the DX2 stream has been gone from the hub since O14 M5b, so such a frame reaches a Project only through the suites' seam. M1 filters the rows the Project holds all the same.
  Evidence: `apps/desk-hub/src/objects/project.ts` (every `broadcast`, `toSocket` and `toMachine` call site), `worker.ts:280-331`.
- Observation (M1): a browser still sees the project-wide offsets (`welcome.head`, `caught-up`, `more`), so a stream's hidden events show up as gaps in the offset counter. That leaks volume, but never a session or a writer. The architect accepted it as residue (2026-11-05).
  Evidence: `LogStore.after` numbers every event; `Project.resume` sends the last offset it scanned.
- Observation (M1): a `continued` retirement's successor is often written before the successor's `joined` reaches the hub. Refusing every unknown provenance reference would therefore tombstone continuations for every session, private or not.
  Evidence: `sminos.py:3669` writes the retirement right after `ensure_record` makes the new record, and the uplink uploads writers in no fixed order.
- Observation (M1): an `unlisted` notice and the snapshot after it usually travel in one upload batch. A registry that applied the batch's snapshots before judging its events would refuse every valid notice, since its `policyRev` would no longer be newer.
  Evidence: D6 writes the notice "just before the new snapshot", and one upload carries a writer's whole suffix.
- Observation (M1): the hub's sender check reads `attest.owners` as the machine's signed claim, and the hub verifies no attestation, so a machine can claim owners that pass the check. That fits the rule that the hub only refuses: the receiving endpoint verifies the attestation before it answers `reach?`.
  Evidence: `project.ts` `factsOf`; `apps/org-protocol/src/attest.ts` `verifyAttestation` runs only at the endpoint.
- Observation (M1, second review): a reader check at enqueue isn't enough. A live frame waits in the Machine's queue, and an owner change can come in between, so `toMachineAll` checks each stream frame against the reader again when it leaves the queue (`stillReads`).
  Evidence: `project.ts` `toMachineAll`; the second review's P1.
- Observation (M1, third review): a frame already handed to `Machine.send` and `Relay.relaySend` is checked against the connection's generation, not its audience (`relay.ts:584`). An owner change that lands in that window can't stop a socket write already underway. The window predates O18 and is as wide as one socket write. It's left as review debt, because closing it would mean an audience check inside the relay's send path.
  Evidence: `apps/desk-hub/src/objects/relay.ts:584`; the third review, 2026-11-05.

- Observation (M2): sminos keeps the endpoint's verdict (`verified`) inside each event it stores, and the v2 signature
  covers every field but `sig` and `mac`. So an event sminos hands back (`reach?`'s, a `snapshots` page's) verifies only
  once `verified` is taken out.
  Evidence: `sminos_hublog.py:940` (`e["verified"] = verified`); `apps/org-protocol/src/events.ts` `coveredV2`.
- Observation (M2): a refusal at signing leaves its position unsigned, and the hub's copy of the writer then has a gap
  that every later upload of the writer meets as a `resend`. Refusing `audience` from a stale view without a way back
  would stall the writer for as long as the mismatch held, the stall the design forbids. It led to the coordinator's
  ruling below (the stop and the `void`).
  Evidence: `uplink.ts` (`refused`, `resend`); the hub's `upload` (`project.ts`, a gap answered by `resend`).
- Observation (M2): `isListing` (`apps/org-protocol/src/shapes.ts`) checks a listing's fields exactly, so a desk-web
  built before this change refuses a private session's channel listing that carries `audience` and `policyRev`, and
  shows its owner nothing of that session until desk-web is updated (M2b). A listed session's listing gains neither.
  Evidence: `shapes.ts` `isListing`; `records.ts` `verifyListing`.
- Observation (M2): the RL1 link sends each project's hello before its welcome hook runs, so what the endpoint learns
  from the welcome (`capabilities`) is in place for the first upload of the connection but not for the hellos.
  Evidence: `src/endpoint/hub-link.ts` `#welcomed`.
- Observation (M2): a machine re-enrolled under a new name keeps its registry bindings only when it keeps its ref.
  - An endpoint-enrolled machine does. Its ref is the profile's `machine.json` MachineRef, which survives unenroll,
    and `machineNames` gives both names that ref, so `refOf(new name)` answers it.
  - A delegated machine re-certified under another delegation gets a new ref, since its ref carries the
    delegation's prefix. It is a new machine by construction.
  - A phase-1 name-held binding (`name:<old>`) is lost on a rename. Proposed fix, not built: `boundTo` also accepts
    such a row when `refOfName(head, <old name>)` is the caller's ref. Left as residue (coordinator, 2026-11-05).
- Observation (M2, the fix wave): the hub refusing `audience` at a position the endpoint already signed can't be revived
  by a void. The ledger holds the signed body there, so the void would be refused `conflict`. The endpoint never signs an
  audience whose digest disagrees with its writer, so the hub has no ground to refuse one. That stop stays terminal,
  and a test holds it there.
- Observation (M2b): desk-web never holds a private session's listing. Its listings store is fed only by the hub's
  registry socket, and a private listing never reaches the hub (`Listings.welcome` withdraws it). The one place it
  exists is `endpoint.listings` over a device channel (`src/endpoint/calls.ts`), which desk-web never calls. O13's
  binding constraint "Nothing but cards" (`2026-10-27-p5-o13-web-cards.md:53`, pinned by `cards/client.test.ts`)
  rules out a `call` on its channel, even though the endpoint grants one to a web-cards device (`authorize.ts` step 3).
  A lane B session is also listed under its appSessionId, not the sminos session id the log addresses, so desk-web
  couldn't have matched a listing to a recipient anyway.
  Evidence: `apps/desk-web/src/cards/listings-store.ts`, `cards/client.ts:1-8`; `src/endpoint/listings.ts` `welcome`,
  `recordFor`; `src/endpoint/rl10/members.ts` `listingId`.
- Observation (M2b): no `hub/` human is composed anywhere in the MAWS app. Desk-web's `ProjectConnection.say` is the
  one composer. The RL8 device-signed human exists only in `apps/org-protocol/test-support` (`deviceHuman`), whose
  `signEvent` covers every field, `audience` included, and whose hub check M1 already applies.
  Evidence: a grep for `kind: 'human'` and `t: 'human'` over `src/` and `apps/*/src`.
- Observation (M2b): `isListing` accepts `audience` and `policyRev` since M2, so desk-web built from this branch takes
  a private listing. M2's residue is only the deployed desk-web, which the next hub deploy replaces (desk-web is
  served by the hub's Worker).
  Evidence: `apps/org-protocol/src/shapes.ts` `isListing`.

- Observation (M3): the hub's withheld list speaks only for the machine's current name, since the hub knows no former names. A refusal lost before a rename can never be learned from the hub's word, so a former name's archive frontier can be no later than the last `have` that listed it.
  Evidence: `LogStore.withheldOf(machine)` (`apps/desk-hub/src/objects/log-store.ts:171`), called with the hello's machine (`project.ts:531`).
- Observation (M3): an event's `ts` is the only order across a session's streams, at millisecond resolution, so own events written in the same millisecond under different streams merge in file order. A test that assumed otherwise failed in CI.
  Evidence: run 42135171871 (`test_streams`).
- Observation (M3, second review): an own writer's archive frontier can move backwards. A frozen former name, or the cap below a kept conflict, can leave the confirmed top below what the archive file already holds from another archiver's run, and rewriting the file whole then deleted public history, with no audience involved. The fix keeps those positions (Decision Log, M3), with a limit: an edit someone else made to a position between the top and the kept bound survives, for a former name indefinitely, because the bytes can't tell it from another archiver's copy. The archive repo is no authority; the hub log is.
  Evidence: review 2 on `5e26289b`; `copy_log` (`sminos_archive.py`).
- Observation (M4): only the uplink can ask `reach?`. The endpoint's RL10 server serves one connection, and a new one replaces the last, so the CLI, the daemon's tick and every other process can't ask. On a reach-capable machine every peer delivery but the same-owner local one goes through the uplink's ask.
  Evidence: `src/endpoint/rl10/server.ts`; sminos's `Link.ask_words` (`sminos_uplink.py`).
- Observation (M4): the member frame sminos sends ahead of an ask (`members_before`) is load-bearing for `reach?`: `decideReach` answers nothing for a recipient whose member record the endpoint doesn't hold (Decision Log, M2), so without the frame the ask goes unanswered.
  Evidence: `src/endpoint/rl10/reach.ts`; `sminos_uplink.py` `members_before`.
- Observation (M4): MAWS's RL10 conversation fixture advertises `reach` but stages no `reach?`. sminos's conformance replay, re-pinned in M3 to the fixture at MAWS `c100ab45f`, now answers each unstaged `reach?` with `deliver`, as it answers an unstaged `words?` with `refuse`, and passes at 107 ok, 0 FAIL. One staged `reach?` exchange in MAWS's fixture would pin the frame's shape.
  Evidence: `test/endpoint/rl10/conversation.json`; sminos's `rl10-conversation.source.json`.
- Observation (M4): two setter changes in quick succession, the second before the endpoint has answered the first, give a withdrawn set that sminos computes across both and the endpoint across the last alone. The endpoint then refuses the notice `audience`, which stops only the notice's stream, so it fails closed. The endpoint's `withdrawn` makes the set exact.
  Evidence: `sminos_visibility.py` (the withdrawn set without `withdrawn`); the signer's `#notice` (`src/endpoint/rl10/log-relay.ts`).
- Observation (M4): `daemon probe` writes `identity.json` but not the endpoint's capabilities, so between a probe's cutover and the uplink's first welcome every peer push is held. That fails closed and lasts seconds.
  Evidence: `sminos_audience.reach_capable` takes a missing `audiences.json` on a cut-over machine as capable.
- Observation (D5, board #492): D5's first sentence on a withheld own snapshot ("counts as unpublished, so `publish_owners` writes the session's snapshot again") had nothing behind it. `withhold_own` keeps the withheld event in its writer file, and every publisher compares against that file, so a withheld snapshot counted as published.
  Evidence: `publish_state` (`sminos_daemon.py:611`) against the log's last `state`; `publish_owners` (`sminos.py:3214`) against its last publishing `joined`; at sminos 1.36.0.
- Observation (M5's executors): MAWS's RL10 conversation fixture compares sminos's hello exactly, so advertising `record` broke sminos's conformance replay until the fixture's three hello lines carried it.
  Evidence: MAWS #496 (merge `bdd6cb7db`, blob `bc2593f1`); sminos's copy re-pinned to that merge.

- Observation (M6): staging serves `hub@0d43cbda` (`web@p5-o10-laneb-live`, 2026-10-30), which contains neither M1 (`ff1b9d581`), M2 (`617fde4b5`) nor M2b (`9a3848039`). M1's Proof ends in a staging deploy, so either that deploy never ran or O10's lane B live run replaced it. M6 deploys first.
  Evidence: the credential-free `X-Desk-Build` (`staging-run.sh build`'s read), 2026-11-06; `git merge-base --is-ancestor` on each merge.
- Observation (M6): O10 M11's scene can't show an O18 item as it stands. It has one machine, owned by the admin, and its second member owns none. Its VM `dc-acceptance-7f80` was deleted on 2026-11-01, its defaults still name that VM and its address, and its sminos is whatever the VM's marketplace holds.
  Evidence: `endpoint-acceptance.ts:36-39`, `:70`, `:210-233`; `vm/setup.sh:20`, `:36-40`; `org-admin.ts:206`, `:249`; the friction tracker (MAWS, the scene's defaults).
- Observation (M6): no browser can be the run's second member. O10's member is `@staging.invalid`, and the hub resolves a browser's member by its Access email alone. M6's first text also named the owner's MacBook session, which is enrolled in production.
  Evidence: `endpoint-acceptance.ts:214`; `apps/desk-hub/src/worker.ts:182-188`; `objects/registry.ts:246-250`.
- Observation (M6, the harness): devcloud's base image (0.15.3, `image/packages.sh`) carries everything the reach scenes need of a VM made without the MAWS project but pnpm: git, tmux, python3, build-essential, iproute2, procps, util-linux and Node LTS (NodeSource), and `claude` at `/usr/local/bin/claude`. `vm/setup.sh`'s reach mode installs pnpm per build at `package.json`'s pin, any missing tool from Ubuntu's archive, and mawsd's pinned Node for the build where the VM's is below 22.12; `vm/check.sh` reports each.
  Evidence: `~/.claude/plugins/cache/doperpowers/devcloud/0.15.3/image/packages.sh` and `image/setup.sh`; MAWS `devenv/setup.sh` (the devenv step this VM never runs).
- Observation (M6, the harness): O14's production run still pins its machine to the deleted VM (`PRODUCTION_MACHINE` in `endpoint-production.ts`: `dc-acceptance-7f80`); the harness removed only the defaults M6 names (the VM, its address, the devcloud path), so a production endpoint run now needs `--vm` and `--direct-url` and still refuses any machine but that pin.
  Evidence: `apps/desk-hub/deploy/endpoint-production.ts`; `endpoint-acceptance.ts`'s `directUrlFor` at `p5-o18-m6`.
- Observation (M6, the harness): a full bundle of the branch is about 287 MB (a shallow one 171 MB), past what one composed step should carry as base64, so `reach-vm setup` stages it in 24 MiB steps and setup.sh checks its sha256.

- Observation (M6, the harness, 2026-11-07): parts of `fake-machine/` are dead against any hub since O8 M5b, but not the pieces PA and PB stand on: `FakeEndpoint`, `enrollV2`'s `V2Machine` and `credentialHeaders` are what the suites' own RL1 support (`test/support/rl1.ts`) uses, and `OrgAdmin.listedMachine`'s `/api/enrollments` and `/key` routes answer. `test/deploy/reach-probes.test.ts` drives the probes' real path on the local hub: listing for their owners, the welcome's `audience`, a hand-signed say refused `not-reachable` with no message and kept as a tombstone on the owner's log, the hello's `have` and backlog, and the history page by writer (200, the stream empty, the plain writer served). No switch to another path was needed.
  Evidence: `git bundle create … HEAD` at `4eb50d0c8`, 2026-11-07.

## Decision Log

- Decision: the verification. One independent spec review (`doperpowers:adversarial-reviewer`, security lens) and its buildability review of this execution section. Each landing that touches `reach?`, an audience, the registry or the hub's fan-out gets reviewer-high with a security lens. M6 is the end-to-end proof.
  Rationale: P5's O18 Review. This is a confidentiality property whose failures are silent.
  Date/Author: 2026-11-05, p5-desk-track-owner.
- Decision: the audience belongs to a writer stream (`<machine>/<session>~<digest>`), and the hub filters whole writers.
  Rationale: sminos's import is strict per writer; per-writer filtering leaves no hole and names no private writer to an outsider.
  Rejected: per-event filtering with `spent` stubs, which leaks writer names and grows tombstones; a private project per person, which splits a session across projects.
  Date/Author: 2026-11-05, p5-desk-track-owner, accepted by the architect (chat 1131).
- Decision (superseded below by the intersection and the policy cache): an addressed event takes the recipient's audience from the recipient's newest verified event the sender holds. A `say` is split per audience.
  Rationale: the sender can address only what it sees, and what it sees carries the audience; no new query is needed.
  Rejected: an audience lookup at the hub, a new round trip on every send that tells the hub who is asking about whom.
  Date/Author: 2026-11-05, p5-desk-track-owner, accepted by the architect (chat 1131).
- Decision (superseded below by the policy registry): the hub is the backstop. It refuses an event addressed to a session whose latest audience is set unless the event's audience equals it, comparing against the latest it holds.
  Rationale: this covers old endpoints, forged events, and stale copied audiences after a share removal (the architect's condition (c)).
  Rejected: trusting the sender's endpoint alone, which an old version or a stale view defeats.
  Date/Author: 2026-11-05, p5-desk-track-owner, accepted by the architect (chat 1131).
- Decision: capabilities gate the order. The hub welcomes with `audience`, and the endpoint holds private streams without it. The endpoint hellos with `access` and `reach`, and sminos sends visibility only then. The hub deploys first.
  Rationale: OX1 asks for additive change within a major, and these two hellos are where each side learns what the other can do.
  Rejected: a strict deploy order with no signal, which can't be checked and fails open in between.
  Date/Author: 2026-11-05, p5-desk-track-owner, accepted by the architect (chat 1131).
- Decision (amended below, 2026-11-06: widening moves to the app's step-up before a second member joins the production org): the setters. Narrowing is open to a session's shell; widening is operator-only, with confirmation at `/dev/tty`. A red-first test covers it.
  Rationale: an agent must never open a session to more people than its owner chose (the architect's condition (a)).
  Rejected for the CLI: device step-up, which needs the app; M5's picker uses it.
  Date/Author: 2026-11-05, p5-desk-track-owner, accepted by the architect (chat 1131).
- Decision: a private session's agent may message only within its own audience, refused at its own CLI. Messaging out grants no reach back.
  Rationale: the architect's ruling (condition (b)). By construction its events reach only its audience, so the alternative would widen its audience implicitly.
  Date/Author: 2026-11-05, the architect (chat 1131).
- Decision: the RL amendments in §"RL amendments", made in M1: §5.5 `list` gains messaging; §5.8 gains the reach rule; §5.9 and §6.2 make the log plane org-readable except audience streams, add the `list` share, and let the hub hold each session's audience; RL1, RL6, RL8/RL9 and RL10 gain their optional fields, frames and the tombstone.
  Rationale: Decision Log 223's ruling and the means above. Each is additive within RL's major (OX1).
  Rejected: leaving §6.2's org-readable log plane and hiding sessions in the UI, which doesn't meet "unlisted".
  Date/Author: 2026-11-05, p5-desk-track-owner.
- Decision (the sessions it names defined below by `sessionRefs`): an event's audience is the intersection of the visibility audiences of every session it names, and it is sent only when its recipients' owners and its sender's are inside. A `say` and a cross-project copy split per resulting audience.
  Rationale: copying the recipient's audience would show a private sender's words to members of the recipient's audience the sender never shared with. The intersection is the one audience that every named session's owner chose; it generalizes ruling (b).
  Rejected: copying the recipient's audience (the first draft).
  Date/Author: 2026-11-05, p5-desk-track-owner, approved by the architect (chat 1131–1132), from the adversarial reviews.
- Decision: the hub keeps an org-wide, revisioned policy registry in the Registry DO, keyed by session, updated only from the session's own `joined`/`state` snapshots by highest `policyRev` (ties by `created`), and consulted by every project at upload for the writing session and every named one.
  Rationale: a message and its copies cross projects, and an event's arrival order across streams says nothing of which policy is newer; one org-wide row per session with a signed counter answers both.
  Rejected: a per-project table of latest audiences, which a cross-project copy bypasses and which arrival order can roll back.
  Date/Author: 2026-11-05, p5-desk-track-owner, approved by the architect (chat 1131–1132).
- Decision: D5 rewritten. The hub refuses at upload an event naming an unknown session, an audience outside a named session's latest, or a sender outside its audience, all as `not-reachable`; the refusal returns over the sender's own upload path, leaves a content-free `withheld` tombstone the writer continues past, and is settled by `HubLog.withhold_own`. The receiving endpoint's `reach?` stays as defense in depth, settled locally with a `daemon.log` line. The hub can only refuse, never admit. P5's acceptance 3, "refused at the recipient's machine", becomes "refused before delivery: at the hub's upload, with the recipient's endpoint as defense in depth"; the architect amends P5 at landing.
  Rationale: the hub sees every event before fan-out and already speaks back to the sender's machine; a relay that can drop anything gains nothing by refusing.
  Rejected: a signed `refused` log event from the recipient's machine, which needed its own audience stream toward the sender, confirmed the recipient's machine holds the session, and came only after fan-out.
  Date/Author: 2026-11-05, p5-desk-track-owner, approved by the architect (chat 1131–1132).
- Decision (amended in M2b: the backstop stands, and no device composes audience words yet, desk-web's client staying frozen): browser and device humans get the same registry backstop at `takeHuman`, go under `hub/<member>~<digest>` when they carry an audience, and take the audience from the private session's machine-signed channel listing, which gains `audience` and `policyRev`. An old browser is refused toward any session with an audience. Built in a new M2b.
  Rationale: a device verifies log events only by the org MAC, so a listing is the one machine-signed source it has; M2b's verification (desk-web tests against the local hub) differs from M2's.
  Rejected: leaving device humans under plain `hub/<member>`, which fans a message to a private session out to the whole org.
  Date/Author: 2026-11-05, p5-desk-track-owner, approved by the architect (chat 1131–1132).
- Decision: the audit record of an audience stream goes only to its audience, or to the member whose send it refuses, live and on resume, with its diagnostics dropped.
  Rationale: refusals and rejections name the writer and seq, which outside the audience is the leak the streams prevent.
  Rejected: keeping the audit record project-wide.
  Date/Author: 2026-11-05, p5-desk-track-owner, approved by the architect (chat 1131–1132).
- Decision (narrowed below to the admitted projection): sminos's git archive copies plain writers only. Previously public history stays; private streams never enter it. This corrects the first draft's "the archive keeps everything".
  Rationale: the archive's remote is the project's, readable by the org.
  Rejected: archiving streams to a remote per audience, which no project has.
  Date/Author: 2026-11-05, p5-desk-track-owner, approved by the architect (chat 1131–1132).
- Decision: every send path goes through one authorization and stream-selection boundary (`stream_for` at writing, `ReachGate` at pushing), each queued event checked before it joins a batch or a resume. The setters move into M4, with the guards, so they ship in the same sminos release.
  Rationale: four push paths besides `deliver_next` reach a session directly. A release with the setters and without the guards would let a session be made private and still be messaged.
  Rejected: releasing M3 and M4 together while M3 stays unbumped on main, which the bump-on-merge rule makes fragile.
  Date/Author: 2026-11-05, p5-desk-track-owner, approved by the architect (chat 1131–1132).
- Decision: `access`, `shares` and `policyRev` survive provenance replacement and continuations, and a sminos-spawned session inherits its spawner's access and shares.
  Rationale: a resume or a background copy would otherwise reset a private session to listed, and a spawn would widen reach without its owner.
  Rejected: a spawned session at the default `listed`.
  Date/Author: 2026-11-05, p5-desk-track-owner, approved by the architect (chat 1131–1132).
- Decision: the endpoint keeps a persistent per-session policy cache from verified snapshots, ordered by `policyRev`, rebuilt from the log through sminos when lost; an unknown session counts as having no audience, with the hub's registry as the backstop.
  Rationale: the sender's endpoint must know a remote session's audience to sign the intersection, and a quiet session may have written its snapshot long ago.
  Rejected: the inbound index, which holds hashes only and forgets after 30 days.
  Date/Author: 2026-11-05, p5-desk-track-owner, approved by the architect (chat 1131–1132).
- Decision: M5 becomes an external contract, blocked on O8 M6 and outside O18's acceptance: offers `record.access` and `record.shares` with step-up, executed through `set_visibility`. O18's acceptance runs on the CLI setters.
  Rationale: O8 M6 is unbuilt and the architect's; O18 shouldn't wait on it to prove reach.
  Rejected: keeping M5 inside O18's milestones.
  Date/Author: 2026-11-05, p5-desk-track-owner, approved by the architect (chat 1131–1132).
- Decision: every hub surface that returns stored events, writer names, vectors, audit rows or session-plane rows passes the authenticated reader into the Project and through one `mayRead(reader, writer)` before returning anything; M1 begins with an inventory of those surfaces and tests each.
  Rationale: the third review found the HTTP history route serving any writer to any machine, a surface the fan-out filter never saw; a single check is what keeps the next such route from being missed.
  Rejected: filtering each surface as it is found, which is how the history route was missed.
  Date/Author: 2026-11-05, p5-desk-track-owner, decided by the architect from the third adversarial review.
- Decision (its own-writer frontier set below by the hub's `have`): the archive copies only the hub-admitted public projection: plain writers' admitted positions, withheld ones as tombstones, never a local event before its admission is confirmed.
  Rationale: a `say` written under a plain writer from a stale view can be refused after it is written; copying the writer file whole puts that body on the org-readable remote in the window.
  Rejected: copying plain writer files whole (the second revision), which has that race.
  Date/Author: 2026-11-05, p5-desk-track-owner, decided by the architect from the third adversarial review.
- Decision: the registry binds a session id to the machine that first exposes it, by its RL6 listing or a snapshot; only that machine's snapshots, notices and policy are accepted for it; the endpoint's cache restores the binding on a rebuild.
  Rationale: the listing reaches the hub before the first upload, so a binding by first snapshot left a window in which another machine that saw the listing could bind the id first.
  Rejected: binding by first snapshot alone (the second revision).
  Date/Author: 2026-11-05, p5-desk-track-owner, decided by the architect from the third adversarial review.
- Decision: `unlisted` is a content-free transition notice `{session, policyRev, audience: <withdrawn members>}` from the bound machine under the session's own namespace, validated at signing (the withdrawn set from the endpoint's policy history) and at upload (bound machine, newer `policyRev`, audience inside the previous one). Going private withdraws everyone else in the org.
  Rationale: an exemption from the upload check let any machine write an `unlisted` naming any session, to any audience.
  Rejected: exempting `unlisted` from the upload check (the second revision).
  Choice made in this revision, by the desk track: the hub checks the audience only against the previous audience, which its registry holds when the notice arrives; that it excludes the new audience is the signer's check, since the snapshot carrying the new one comes after the notice. A notice is content-free, so an overlap would tell a member nothing they can't see.
  Date/Author: 2026-11-05, p5-desk-track-owner, decided by the architect from the third adversarial review.
- Decision: one extractor, `sessionRefs(event)`, lists every session reference an event carries; addressing references join D4's intersection, and a provenance reference whose session's audience doesn't contain the event's is redacted at writing and signing, an unredacted one refused by the hub.
  Rationale: a listed child named its private parent in its record's origin, its `joined` and its attestation, outside every audience check.
  Rejected: intersecting provenance too, which would make a child private because its parent is.
  Choice made in this revision, by the desk track: in the attestation, redaction leaves `spawnerSession` out rather than null, because today's verifier refuses a null (`apps/org-protocol/src/attest.ts:45-48`).
  Date/Author: 2026-11-05, p5-desk-track-owner, decided by the architect from the third adversarial review.
- Decision: `ReachGate` sits inside the push primitives, `push_live` and `resume_session`, so every not-yet-delivered peer is checked at push time; no earlier admission or answer authorizes a later delivery.
  Rationale: the caller list missed `deliver_verdict`'s human downgraded to a peer and the receipt's retries; every one of them ends in a primitive.
  Rejected: gating each caller (the second revision).
  Choice made in this revision, by the desk track: the review named `holder_push`/`push_event`; both end in `push_live`, which `send_to_seat`, `send_to_member` and `holder_carry` also call directly, so the gate is there, with `resume_session` for the stopped-seat resume.
  Date/Author: 2026-11-05, p5-desk-track-owner, decided by the architect from the third adversarial review.
- Decision: an established record that can't be read fails closed: no member frame, no listing, no event written, deliveries to it owed; a session with no record file is new and takes the defaults.
  Rationale: `ensure_record` returns None for it and `member_frame` then sends the defaults, listing a private session.
  Rejected: restating it with the defaults, which is today's behaviour.
  Choice made in this revision, by the desk track: "refuse reach" is held owed, not settled `refused-reach`, so a repaired record still gets its messages.
  Date/Author: 2026-11-05, p5-desk-track-owner, decided by the architect from the third adversarial review.
- Decision: a hub `state-unavailable` creates a retry at that position, never a tombstone: the endpoint opens a hole at the seq on RL10, `HubLog.on_refused` rewinds `sent` on a direct stream, one retry per writer per `ASK_MS` for as long as the stream is open.
  Rationale: the endpoint only re-armed a hole it already held and sminos never rewound, so the position waited for a reconnect or a later write.
  Rejected: tombstoning it, which would drop an event the hub merely couldn't check; and giving up after a count, which would do the same later.
  Date/Author: 2026-11-05, p5-desk-track-owner, decided by the architect from the third adversarial review.
- Decision: sminos answers `snapshots?` (M3) one project per request, in bounded pages with an explicit `done`; while the endpoint's cache is incomplete, an upload naming a session it hasn't confirmed stays owed.
  Rationale: a rebuild with no producer and no end could never tell an empty answer from an unfinished one, and an upload signed meanwhile would take a private session for listed.
  Rejected: signing meanwhile as "no audience" with the hub as backstop, which tombstones messages that should simply wait.
  Date/Author: 2026-11-05, p5-desk-track-owner, decided by the architect from the third adversarial review.
- Decision: the archive's frontier for this machine's own writers is the hub's vector in the `have` that confirms the run (saved as `archive_have`), withheld positions written as their tombstones; never `taken`.
  Rationale: `taken` moves on RL10 when the socket takes the frame, before the hub admits or refuses it. The `have` is the hub's own vector, it follows any refusal on the same stream, and every run already waits for one.
  Rejected: `taken` (the third revision), which copies an event the hub may still refuse; and the endpoint's echo comparison, which the architect proposed: the hub's fan-out skips the sender, so no echo comes back live and it yields no frontier.
  Choice made in this revision, by the desk track: the `have` rather than a new admission frame carried over RL10, since the `have` already exists and the archive already runs on it.
  Amended 2026-11-05, after the round-3 verification: the vector alone admits a body whose refusal a disconnect lost (the reconnect's backlog starts past the advertised head). So the `have` also carries the own writers' withheld positions, and the archive tombstones them whatever the local file holds. Rejected: replaying own positions after the last reconciled frontier with a completion barrier, which needs a new replay mode for a list the hub can state in one field.
  Date/Author: 2026-11-05, p5-desk-track-owner, decided by the architect from the round-3 review.
- Decision: an audience stream goes down only to an sminos whose RL10 hello advertises `audience`, which it does only once its archive copies the admitted public projection; the hub serves a stream only to an endpoint whose RL1 hello advertises `audience`. An old sminos or endpoint, even its owner's own, sees no private session until updated.
  Rationale: an old sminos copies every log file into the shared archive, and the hub's audience filter passes a machine whose owners are inside.
  Rejected: serving streams to every machine inside the audience, which archives them on an owner's old machine.
  Choice made in this revision, by the desk track: the hub-side gate, beyond the endpoint rule the architect set, because an old endpoint passes every stream down to its old sminos and only the hub can stop it.
  Date/Author: 2026-11-05, p5-desk-track-owner, decided by the architect from the round-3 review.
- Decision: splitting a `say` per audience rebuilds each split's text from its own recipients' leading tags and the unchanged body, cross-project copies included.
  Rationale: the leading tag run is the addressing, and stored whole it names a private recipient's alias and short in the public event.
  Rejected: keeping `a.text` whole in every split (the third revision).
  Date/Author: 2026-11-05, p5-desk-track-owner, decided by the architect from the round-3 review.
- Decision: a validated content-free `unlisted` notice is admitted by its own rule (bound machine, newer `policyRev`, audience within the previous one) in place of the sender-inside-audience check, every other check kept; no other kind is exempt.
  Rationale: the notice's audience is the withdrawn members, outside which its sender sits by construction.
  Rejected: applying the general rule to it, which refuses every valid notice.
  Date/Author: 2026-11-05, p5-desk-track-owner, decided by the architect from the round-3 review.

- Decision (M1): `Registry.policies` answers two things for each named session: its policy as it stood before the batch, and whether it is bound to the uploader after the batch. The Project replays the batch in order and takes each snapshot by the same rule the Registry uses (`newer`). The Registry records the batch's snapshots in the same synchronous step, so no other project's batch can move a row between the read and the record.
  Rationale: an `unlisted` notice and its snapshot share a batch. If the snapshot were applied first, every valid notice would be stale. A binding never moves, so reading it after the batch gives the same answer whatever the order.
  Cost: a snapshot the Project then withholds for another reason (an unredacted provenance reference, or a sender outside its audience) has still moved the row. The row stays right, because the snapshot is its own bound machine's statement of its policy.
  Date/Author: 2026-11-05, p5-desk-track-owner (M1), approved by the architect.
- Decision (M1): an unknown provenance reference is admitted. Only an unknown addressing reference is refused.
  Rationale: refusing a `continued` retirement whose successor the hub hasn't seen yet would tombstone continuations for every session (Surprises, M1). That breaks the promise that nothing visible changes while the org is the owner alone. Admitting is safe: a spawner existed before its child, and a private session's own machine uploads its snapshot before any event that names it. A session the registry doesn't know is therefore no one's private session yet. A known provenance session still gets the redaction check.
  Date/Author: 2026-11-05, p5-desk-track-owner (M1), approved by the architect.
- Decision (M1): the writing session is not a named session. The hub doesn't refuse a plain-writer event because its own session is unknown, or private at the registry.
  Rationale: the session's own endpoint checks the digest at signing, and that check is the authority for the session's own audience (D7). A session can only be private behind an M2 endpoint. The hub's backstop is for the remote sessions a sender can be stale about.
  Date/Author: 2026-11-05, p5-desk-track-owner (M1), approved by the architect.
- Decision (M1): `mayRead` also gives a machine every writer of its own machine, whatever the writer's audience.
  Rationale: a session another person spawned on my machine has an audience that may not include my machine's owners, and the endpoint's resend logic reads its own writers in `have`. The machine holds those writers already, so nothing leaks.
  Date/Author: 2026-11-05, p5-desk-track-owner (M1), approved by the architect.
- Decision (M1): a live RL6 listing of a session the registry holds no policy for binds the session and records it as listed at `policyRev` -1. A `gone` listing only binds. The fill takes the log's snapshot over a row that only a listing made.
  Rationale: a session's listing reaches the hub before its first upload (D5), and a listed session is open to the whole org's messages. Any snapshot overrides the listing's row.
  Date/Author: 2026-11-05, p5-desk-track-owner (M1), approved by the architect.
- Decision (M1): a machine reader's owners are resolved at its hello and fixed for the connection, with one exception: each org state the project is told of narrows them, so an owner the state dropped reads no more. An owner the state adds waits for the machine's next hello. An unreadable head narrows the owners to none. HTTP readers and DX2 get no stream except their own.
  Rationale: a stream that became readable mid-connection would start, for that reader, at a seq past 1: the hole the streams exist to prevent. A stream that becomes unreadable just stops. Either way the reader fails closed.
  Date/Author: 2026-11-05, p5-desk-track-owner (M1).
- Decision (M1): who is shown which audit and session-plane rows.
  - The audit row of a withheld position goes to its stream's audience and to the members whose send it was: its attested owners, else the uploading machine's owners, or the member for a device's words.
  - Any other refusal of a stream's position goes to the stream's audience alone.
  - Session-plane rows and `decided` rows are read against the session's latest policy the project has seen. That is `known_policies`, kept from the registry rows each upload reads and replays.
  Rationale: the sender learns of a refusal over its own upload path anyway (D5). A refusal other than `not-reachable` concerns a stream whose sender was inside its audience when its earlier positions were admitted.
  Date/Author: 2026-11-05, p5-desk-track-owner (M1).
- Decision (M1): the first `policies` call waits up to 10 s for the fill before refusing `state-unavailable`. Until the fill completes, every upload that names a session is refused that way.
  Rationale: one bounded wait means fewer refusals than answering at once, and a `state-unavailable` refusal is retried (D5). Until M2's endpoint lands, a `state-unavailable` position waits for the next reconnect or write, as a signature check's does today.
  Date/Author: 2026-11-05, p5-desk-track-owner (M1).
- Decision (M1, from the first review): a machine reader's owners are re-resolved fail-closed. Each machine row keeps the owners its hello resolved and a `current` set. Every org-state announcement nulls `current` synchronously, before anything awaits, so the reader reads no stream while its owners are re-resolved. `current` then becomes the hello-owners intersected with the fresh set, so a reader never widens mid-connection. A stream event the reader could read at its hello but can't now ends its connection: it re-hellos and gets a coherent view instead of a hole. A hello's backlog asks the current row before every page.
  Rationale: the review found an upload fanning out to a revoked owner while the head was read, and a backlog running on the Reader it captured at hello.
  Cost: an org-state change can reconnect the machines whose stream reads it interrupts, and only those.
  Rejected: narrowing after the head read (the first build), which leaves that window open; and blanking reads with no reconnect, which leaves a hole.
  Date/Author: 2026-11-05, p5-desk-track-owner (M1), approved by the architect.
- Decision (M1, from the first review): a device's words take their sender from the authenticated member alone, never from the event body (an `attest` on it is ignored). An `unlisted` notice carries no session reference.
  Date/Author: 2026-11-05, p5-desk-track-owner (M1).
- Decision (M1): the read-surface tests live in a new `apps/desk-hub/test/audience-reads.test.ts`, beside `policies.test.ts`, rather than in `log.test.ts`. Both files need an org with a second member and machines that advertise `audience`, which the org `log.test.ts` shares doesn't have. `log.test.ts` and `signed-log.test.ts` run unchanged, as the regression check.
  Date/Author: 2026-11-05, p5-desk-track-owner (M1).

- Decision (M2, the coordinator's ruling): `audience` is a stop on both sides. The uplink's STOPS gains it, and sminos's
  stops gain it (M3). The refused position is never signed with its body. A stream writer refused for a stale digest is
  dead while its digest isn't the session's current audience, and sminos writes later events under the new stream. If
  the digest becomes current again, sminos first uploads a content-free `{ts, writer, seq: p, kind: 'void', of: p,
  audience?}` at each refused position, and the writer continues.
  Rationale: a refusal at signing leaves a gap at the hub (Surprises, M2), so a stop without a way back would stall
  the writer.
  Date/Author: 2026-11-05, the coordinator (p5-desk-track-owner), for M2 and M3.
- Decision (M2, the coordinator's ruling): a `void` carries `audience`, sminos's claim of its writer's audience. The
  endpoint signs it exactly when `audienceDigest(audience)` equals the writer's digest, for any kind of stream (a
  session's, a human's, an addressed one). Under a plain writer a void carries none. Any other shape is refused
  `malformed`.
  Rationale: a void is content-free, so who may read it isn't a confidentiality question. The digest alone binds the
  claim to its writer, and a human stream whose first position was refused has nothing in the ledger to check against.
  Rejected: taking the audience from the ledger's earlier positions of the writer, which can't revive such a stream.
  Date/Author: 2026-11-05, the coordinator (p5-desk-track-owner).
- Decision (M2, from M3): sminos never stores `audience` or `policyRev` in its events. The endpoint adds both at
  signing: `policyRev` from the session's member frame (on `joined`, `state` and `unlisted`), the audience from its
  own computation. One sminos sends anyway is left out (`ENDPOINT_ADDS`), so it is never what is signed. A terminal
  `say` to a private session goes under `<machine>/human~<digest>`, whose audience is the intersection of its
  recipients'. M1's writer grammar, `streamOf` and the hub's sender rule (the machine's owners) already admit it.
  Date/Author: 2026-11-05, the coordinator from M3; checked in M2.
- Decision (M2): `reach?` judges the sender itself and reads nothing of sminos's `verified`:
  - an own writer's sender is its session's resolved owners (or the ledger's attestation), and the machine's owners
    for an operator's writer;
  - a device's words are their member;
  - another machine's event counts only once its v2 signature verifies now. Its attestation's owners are the sender,
    and an attestation that fails makes the sender unverified. With no attestation, the signing machine's owners are
    the sender, as the hub reads it.
  Members the head no longer holds are no one's sender. Every sender must hold `list` unless one shares an owner with
  the recipient. A recipient the endpoint holds no record of gets no answer, so the delivery stays owed through
  sminos's restatement.
  Rationale: the verdict authorizes delivery (D5's invariant), so it rests on the endpoint's own verification, as
  `words?` does. Refusing a recipient that has no record would drop a message for good during a restatement.
  Date/Author: 2026-11-05, p5-desk-track-owner (M2).
- Decision (M2): the policy cache's rebuild runs only with an sminos whose hello advertises `audience`, the release
  that holds the `snapshots?` responder.
  - Completeness: every project sminos has opened is `done`. A project, once read back, stays done, its later
    snapshots arriving live. A project first opened later is read back then.
  - An old sminos: nothing waits on the rebuild, an unknown session counts as having no audience, and the hub is the
    backstop.
  - A hold: the position stays unsigned, parked as an uplink hole and released when the rebuild completes, a project
    finishes, a snapshot arrives, or the hub's welcome advertises `audience`. Released, it is asked of sminos again.
  Rationale: a rebuild with no responder never completes, and holding on it would stall every machine on an old
  sminos.
  Date/Author: 2026-11-05, p5-desk-track-owner (M2).
- Decision (M2): local history and redaction.
  - Local history: each local session's audience at its `policyRev` is remembered in the cache (`policy/cache.json`,
    newest 16 revs) on every member frame and every new head. A local session whose record has gone is read at the
    newest remembered audience, so its last events still sign under its stream.
  - Redaction: a narrower provenance reference is written null in the signed body, and the ledger keeps the paths it
    redacted and the hash of the redacted form. A resend is then rebuilt byte for byte, and an echo compares against
    what was signed. The attestation's spawner is left out.
  Date/Author: 2026-11-05, p5-desk-track-owner (M2).
- Decision (M2): the D9 down-filter (no stream writer to an sminos without `audience`) also leaves out `resend`
  frames naming a stream, and the `have`'s `withheld` entries for streams.
  Date/Author: 2026-11-05, p5-desk-track-owner (M2).
- Decision (M2): where the tests live.
  - The signing and hub-side cases are in a new `test/endpoint/rl10/audience-signing.test.ts`, on a `LogRelay` with
    a stand-in hub, rather than in `uplink.test.ts`, whose scene is a 24 MiB burst against a paused socket.
  - The private-session replay is a second test in `conversation.local.test.ts` against the M1 hub, with B's
    machine on RL1 as the reader. It is not in `conversation.json`, whose cases sminos's conformance replay plays too.
  - `EndpointOptions.uplink` is a suites' seam for the ask wait, so a `state-unavailable` lands within the test.
  Date/Author: 2026-11-05, p5-desk-track-owner (M2).
- Decision (M2, a fix to M1 at the coordinator's request, from M3): the hub judges an upload's references in two
  passes. `reachOf` first takes every snapshot of the batch whose session is bound to the uploader, or that the batch
  binds, into `after`, the registry's rows with the whole batch applied; `judge` then checks every reference,
  addressing or provenance, against `after`. Before this, a say to a seat whose first `joined` sat under a writer later
  in the same batch was withheld for good: a seat spawned and messaged at once. An `unlisted` notice is still judged
  against the rows from before the batch, so the share removal's notice-then-snapshot batch holds. `keepPolicies`
  stores `after`.
  Consequence, accepted by the coordinator: a say in a batch that also takes its session private is judged against
  the private policy even when the say comes first. That fails closed.
  Date/Author: 2026-11-05, p5-desk-track-owner (M2), ruled by the coordinator.

- Decision (M2b, the coordinator's ruling; set aside below, kept as the route a later client takes): a browser takes a private session's audience from its member's policy row,
  which the hub's registry sends on the registry socket, not from the session's channel listing (D7's "A device").
  - What the hub sends: after the grid, on every registry socket (an app's or not), `{t: 'policies', rows}`, one row
    `{session, audience, policyRev}` per private session whose audience holds the socket's member. Then, whenever a
    snapshot moves a row (`Registry.policies`), `{t: 'policy', session, policy}` goes to each member of the row's old
    or new audience: the new row while it holds them, else null. A listed session has no row. A member outside a
    row's audience is never sent it.
  - What desk-web does: `say` seals the row's audience. A recipient with no row goes plain, the hub being the
    backstop. A recipient the log shows private (its newest own snapshot is in a stream, or an `unlisted` notice
    reached this reader) with no row, or a row the member is outside, is refused locally and nothing is sent.
  Rationale:
  - It needs no `call` on the cards channel, so O13's "Nothing but cards" stands.
  - The row is keyed by the sminos session id the log addresses, so lane B sessions are covered.
  - It is the registry `takeHuman` judges the words against, so a stale row is the hub's own to refuse.
  - It adds no trust. The hub already decides who is served a stream, and a device verifies log events only by the
    org MAC. The sealed audience chooses which stream the words go into, never who may receive them, and the
    recipient's endpoint still answers `reach?` on its own verification (D3, D5).
  - The rows a member is sent name only sessions whose audience holds them, so they show nothing the member's
    browser isn't served anyway.
  Rejected: an `endpoint.listings` call on desk-web's channel to the session's machine. It would widen O13's pin,
  need a listed device and a channel per machine, and leave lane B sessions unmatched.
  The machine-signed private listing keeps its `audience` and `policyRev` (M2) for a native device.
  Date/Author: 2026-11-05, the coordinator (p5-desk-track-owner), for M2b.
- Decision (M2b; set aside with the policy rows): a say naming sessions of different audiences becomes one event per audience, in the order each
  group's first recipient was named. Each split's text is its own recipients' raw leading tags, in order, then the
  body after the run (D4). `@all` names no session and stays in every split. A say with one audience keeps its text as
  typed. The outbox holds one entry per split. A local refusal is one refused outbox entry for the whole say.
  Date/Author: 2026-11-05, p5-desk-track-owner (M2b).
- Decision (M2b, the architect's ruling, relayed by the coordinator 2026-11-06): desk-web's frozen DX6 client stays
  frozen. M1's `takeHuman` refuses a human with no audience that names a private session, so the unchanged `say` is
  refused, never leaked, and the browser not reaching a private session is its recorded behaviour.
  - The `say` change and the hub's policy rows (`{t: 'policies'}`, `{t: 'policy'}`) are reverted. With `say` frozen
    the rows have no consumer, and unused code doesn't land. The route stays designed above, for a later client: the
    rows on the registry socket, the split per audience, the local refusal.
  - Before reverting, the premise was checked: no traffic the hub can't catch names no session yet carries a private
    session's content. An untagged record (`to: '*'`) names none and carries only the words the member typed, which
    is prose and not addressing (D4). An `@all` resolves to every live member desk-web sees, a private one included,
    so it is refused whole while the member sees any private session in the project. That is a refusal, not a leak:
    the member reaches everyone by tagging the listed sessions.
  - What the proof found: the hub's audit row of a refused device human, under the plain `hub/<member>`, goes to every
    browser of the project, as a plain writer's withheld position is a tombstone every reader of it gets (D5). It is
    content-free: its reason, writer, nonce and member, with no session and no message. A refusal toward a session
    that doesn't exist reads the same.
  - The proof is in `apps/desk-hub/test/policies.test.ts` ("from an unchanged browser"), on the M1 local hub.
  - Kept: desk-web's tombstone verdict, in `src/log/`, outside the frozen DX6 client (`src/project/`,
    `src/hub/project-client.ts`).
  Date/Author: 2026-11-06, the architect, relayed by the coordinator (p5-desk-track-owner).
- Decision (M2b, the architect's ruling): the audit row of a refused device human stays as it is, shown to every
  browser of the project.
  Rationale:
  - It is content-free: no session and no message. A refusal toward a session that doesn't exist reads the same, so
    it is no oracle.
  - It matches D5, where every reader of a plain writer sees that writer's tombstones.
  - It tells the project's browsers only that a member had a send refused.
  Rejected: narrowing it to the sender alone in `auditFor`/`refuseBrowser`, which would protect nothing a reader of
  the plain writer doesn't already see.
  Date/Author: 2026-11-06, the architect, relayed by the coordinator (p5-desk-track-owner).
- Decision (M2b): desk-web reads the hub's `withheld` tombstone as its own verdict, neither drawn nor reported as a
  forgery, closing M1's "desk-web reads a tombstone as malformed" residue.
  Date/Author: 2026-11-05, p5-desk-track-owner (M2b).
- Decision: the endpoint's `audience` frame for a local session carries an optional `withdrawn`, the members the change at that `policyRev` withdrew, computed by the same `withdrawnBy` the signer's `#notice` check uses (`src/endpoint/rl10/audiences.ts`); absent when the change withdrew no one, and on a session's first rev the cache holds.
  Rationale: going private from listed or org-wide withdraws "the org's members less the new audience" (D6), and sminos holds no member list, so it couldn't name the notice's stream writer; M4 found it. One function for both sides keeps the frame's set and the signer's check equal by construction.
  Rejected: the head's member ids on the `org` frame, which would hand every machine's sminos the whole member list to compute one set the endpoint already computes.
  Date/Author: 2026-11-06, p5-desk-track-owner (an M2 follow-up landed beside M4).

- Decision (M3): the endpoint's word is kept where every writer reads it. The uplink keeps the endpoint's capabilities and its `audience` frames in `daemon/audiences.json` (`keep_capabilities`, `keep_audience`), and a frame of an older `policyRev` never replaces a newer one. A local private session writes under a stream only when the kept audience is at exactly its record's `policyRev`; otherwise the write raises `StreamUnknown`, and a required write fails (`LogWriteFailed`) while any other warns and writes nothing. Without `access`, member frames carry no visibility and every event goes under its plain writer.
  Rationale: the CLI writes events, so it reads the endpoint's word outside the uplink process; frames can be reordered across reconnects; an audience from another revision is no audience, so the write fails closed.
  Date/Author: 2026-11-05, p5-desk-track-owner (M3).
- Decision (M3): writing and splitting.
  - Streams exist only in hub projects (`streams_here`). A git-mirrored or local project keeps plain writers, and a copy under a stream is never written into a home that isn't a hub project's; a warning says why (review 1).
  - `streams.json` in a project's home catalogues this machine's own streams and their audiences (`keep_stream`). An audience is kept before its stream's first event, a copy's included, inside the copy's error handling: a copy that can't keep it is skipped with a warning and delivery goes on (reviews 1 and 2). Readers stat the file and never glob the log, and the uplink reads it to build voids.
  - A listed sender toward a private session is refused before any append when the recipient's owners, or the sender's, fall outside the event's audience or are unknown, with the words a session that doesn't exist gets: `no member @<alias> in project <p>`. The operator's writer, `<machine>/human`, has no sender-owners check.
  - A say's text is rewritten only when it splits; `@all` and selectors are never rewritten.
  - `spawnerSession`, and a `retired {reason: 'continued'}`'s `to`, are written null when the referenced session's audience doesn't contain the event's, or can't be told.
  Rationale: a git mirror publishes the log whole, so a stream there would hide nothing; the refusal's words tell the sender nothing of a private session it can't see (D4).
  Date/Author: 2026-11-05, p5-desk-track-owner (M3).
- Decision (M3): a record's policy and its member frame.
  - A record keeps its own `access`, `shares` and `policyRev` across a replacement and takes the provenance's only when it has none. The fields are written only when present, and a record whose policy fields don't parse is unreadable (D10).
  - Shares are sorted by member, and a duplicate member is refused.
  - A spawn takes its spawner's `access` and `shares` at `policyRev` 0; with the spawner's record unreadable, it is private with no shares.
  - `sminos_records.set_policy(sid, mutate, deadline=None)` returns `(record, changed)`: a no-op writes nothing, and a missing or unreadable record raises `NoRecord`.
  - A member frame is built from the record as it reads at publication (`Link.fresh_frame`), never from a cached plane row (review 1). An unreadable established record gets no frame, and `gone` if one was sent before.
  Rationale: an unreadable policy, or a spawner's, must never read as the listed default, and a frame from a cached row could restate a policy the record no longer holds.
  Date/Author: 2026-11-05, p5-desk-track-owner (M3).
- Decision (M3): a `snapshots` page holds at most 200 events and 256 KiB, in whole writers, at least one; its cursor (`next`) is its last writer, in Python string order. An unknown project, or one that isn't a hub project, gets one empty page marked `done: true`.
  Date/Author: 2026-11-05, p5-desk-track-owner (M3).
- Decision (M3): the archive's frontier, with the reviews' fixes.
  - `archive_have.withheld` keeps the hub's runs as they come on the wire. A run fails when no `have` has been saved, or when the saved `have`'s withheld list disagrees with its own vector, which then confirms nothing.
  - A kept `conflict` caps its own writer below it.
  - A former name's entry is frozen at the last `have` that listed it (review 1); a former name with none saved stays out of the archive.
  - Past an own writer's confirmed top, `copy_log` keeps the archive's existing positions up to the larger of this machine's last local seq and the hub's vector (review 2). Every position recorded here as withheld, refused or voided is written as its tombstone, no local body past the top is copied, and lines past both bounds are dropped, since only this machine writes its own writers.
  Rationale: the hub's withheld list speaks only for current names, and a frontier that moves backwards must not delete public history another archiver copied (Surprises, M3).
  Date/Author: 2026-11-05, p5-desk-track-owner (M3).
- Decision (M3): sminos's side of the `audience` stop and the void (the coordinator's rulings, M2).
  - An `audience` refusal stops its writer, recorded as `dead` in `uplink.json`. An event appended after the stop revives it: each refused position goes up as a void (Interfaces §B), kept in `voided` for good, with the original `ts`, so a resend is byte-identical.
  - A void the endpoint answers `conflict` stops its writer for good (`final`).
  - A stream whose audience isn't kept here stays stopped, and daemon.log says so: no void goes up without a claimed audience.
  - On a direct stream, a hub tombstone is a spent position, never reported.
  Date/Author: 2026-11-05, p5-desk-track-owner (M3); the `conflict` stop ruled by the coordinator.

- Decision (M4): the `reach?` ask runs only in the uplink, and the gate passes a push under a single-use permit. `ReachGate` sits inside `push_live` and `resume_session` (D8) and passes a peer frame only under a permit keyed by project, recipient, writer, seq and event hash, which the uplink sets around the one push that follows a `reach {deliver}` (`deliver_reach`) and clears in `finally`. Every other deliverer (`say`'s fast path, the daemon's tick, `send`) leaves the writer owed at that event and nudges, as a words-gated writer is left owed, and `say` prints `recorded; the endpoint decides its delivery`. The gate raises `ReachHeld` before anything is handed over or launched.
  Rationale: the endpoint serves one RL10 connection, the uplink's (Surprises, M4), so no other process can ask; a permit for exactly one push keeps "each push asks".
  Rejected: a relay from the CLI to the uplink, which is new local IPC for one question; and asking at the caller, which D8 rejects.
  Date/Author: 2026-11-06, p5-desk-track-owner (M4), approved by the coordinator.
- Decision (M4, the coordinator's ruling): the same-owner local path. An event a session of this machine wrote under its own writer (`<current name>/<session>` or one of its streams) to another session of this machine is delivered with no ask when both records read and their `owners` are equal as sets (both `['@machine']`, or the same member ids), so one person's sessions on one machine keep messaging while mawsd is down. It applies only in a project that can't import this machine's own writers from anyone: a hub project of this org with no git remote, or a project nothing syncs. A git remote, even one kept after `project init --hub` with its imported history, can import an own-name line (reviews 1 and 2). Every other case asks: a remote sender, the operator's writer, `hub/` words and their `peer` downgrade, differing owners, an unreadable record.
  Rationale: it reads no access, share, grade or org state, so it is no grade logic. It compares the identities of two records on one machine, where `@machine` is one owner set, and the endpoint would answer `deliver` anyway (D2).
  Date/Author: 2026-11-06, the coordinator (p5-desk-track-owner), for M4.
- Decision (M4): an unanswered ask leaves the delivery owed, with no attempt counted. No answer within `REACH_WAIT` (10 s), or a malformed one, leaves it owed: it is asked again under a new id, never given up, and said once in daemon.log. A recipient whose record can't be read is held owed with no ask.
  Rationale: acceptance 5 is "delivered once the endpoint answers", however long that takes; the 60-attempt give-up would drop it after five minutes.
  Date/Author: 2026-11-06, p5-desk-track-owner (M4), approved by the coordinator.
- Decision (M4): `refused-reach` stays on this machine: one content-free daemon.log line (project, writer:seq, the recipient's short, reason), no outbox record, and no delivery outcome goes up.
  Rationale: D3, "a refusal here stays here"; the hub's `DELIVERY_OUTCOMES` has no such outcome anyway.
  Date/Author: 2026-11-06, p5-desk-track-owner (M4), approved by the coordinator.
- Decision (M4): a words verdict `peer` chains into `reach?`, and the batch rule is met per event. On a reach-capable machine a `peer` verdict queues `reach?` under the same `(project, session, writer)` key and pushes only on `deliver`. A `send` whose queue holds an event that needs an answer is held whole, and the uplink then delivers that writer one event at a time, in order: a refused earlier event settles `refused-reach`, and the next is asked.
  Rationale: M4's Proof: "the verdict comes back `peer`, and the push asks `reach?` again", and "an earlier queued event the endpoint refuses is left out of the batch".
  Date/Author: 2026-11-06, p5-desk-track-owner (M4).
- Decision (M4): the projectless push. `resume <seat> <msg>`, `fill`'s resume and a raw `send` carry no log event; on a reach-capable machine they go only to a session whose owners meet the sender's. Owners are the endpoint's resolved ones (the operator's: those it resolved for this machine's `@machine` sessions, `machine_owners()`), with the records' tokens as the fallback. Unknown owners are refused with D8's message.
  Rationale: without `machine_owners()`, the owner at their own terminal would be refused on a seat their own desk spawned.
  Date/Author: 2026-11-06, p5-desk-track-owner (M4).
- Decision (M4): the setters' transition is asynchronous, completed by the uplink. `set_visibility` changes the policy (`sminos_records.set_policy`) and records the pending transition in `daemon/visibility.json`, both under one lock. The uplink completes it once the endpoint's `audience` frame at the new `policyRev` is kept (on that frame, and at each tick): the notice first, then the snapshot (`joined`, `state`) under the new stream, or under the plain writer once listed. A snapshot write that fails leaves the transition pending for the next tick without writing the notice twice. The CLI waits up to 5 s while a daemon runs, and says whether the notice and snapshot are written or still pending.
  - The notice goes under `<machine>/<session>~audienceDigest(withdrawn)`, from the frame's `withdrawn` (the M2 follow-up above), else the previous audience less the new one when both are known. A change from the whole org with neither writes the snapshot alone and a daemon.log line; that fails closed, since the hub's registry and the recipient's `reach?` refuse what the withdrawn members send.
  - The notice goes up before its snapshot: `HubLog.uploads` draws a writer whose first event is an `unlisted` notice before the others, and writing a notice or completing a transition cancels a draw already made of the project.
  Rationale: the new audience is the endpoint's word, known only once the member frame at the new `policyRev` has reached it; the hub judges a notice against its rows from before the batch, so a snapshot uploaded in an earlier batch would make every valid notice stale.
  Date/Author: 2026-11-06, p5-desk-track-owner (M4).
- Decision (M4): without the endpoint's `access`, the setters take only a no-op or a change whose result is `listed` with the shares unchanged; `share` is always refused.
  Rationale: a private session behind an endpoint that can't carry it writes nothing (`StreamUnknown`, Decision Log M3), and a share no endpoint carries would mislead its owner.
  Date/Author: 2026-11-06, p5-desk-track-owner (M4).
- Decision (M4): a lost private session comes back private.
  - A continuation known only from its predecessor's `joined` under an audience stream is private with no shares; under a plain writer it takes the listed default. Before this, M3 made every such continuation listed.
  - A session whose record file is lost, and that has an own stream catalogued in some project's `streams.json` (this machine's former names counted), is recreated private with no shares. A corrupt pending launch is claimed private.
  - Each recreated private record's `policyRev` is the larger of its candidate's and the floor above every revision this machine still holds (`policy_rev_floor`: `audiences.json` + 1, `visibility.json` + 1).
  Rationale: each would otherwise widen a private session without its owner, or leave it blocked on an audience at an older revision.
  Date/Author: 2026-11-06, p5-desk-track-owner (M4).
- Decision (M4): every operator writer waits for its own head. `waits_for_head`, the queues and their release cover `<machine>/human` and each `<machine>/human~<digest>`, each released above its own head in the `have`, a former name's queue draining into its namesake. The enrolment's first `have` is kept as `headed`, so a stream that `have` didn't name stops waiting at once.
  Rationale: a re-enrolled machine's operator stream would otherwise restart at seq 1 under positions the hub holds (#147). M3's first review found it, and it was deferred here.
  Date/Author: 2026-11-06, p5-desk-track-owner (M4).
- Decision (M4): `HubLog.withhold_own` records the position in `uplink.json`'s `withheld`, counts it taken (`keep_taken`; `sent` stays as it is, so a `resend` from before it is still answered), keeps the event in its file and queues one notice. It runs on a `not-reachable` refusal, on RL10's `spent {reason: 'withheld'}`, on a direct stream's tombstone and on a `have`'s withheld list (`withhold_listed`), so a refusal lost to a disconnect still reaches its sender. The notice goes to message kinds only, as `[sminos: your message to <aliases> was not delivered: not-reachable]`, in a frame no log holds, kept while the session isn't live and dropped a day after the message; the operator's writer gets a daemon.log line instead. `copy_log` writes a tombstone at each position recorded here.
  Date/Author: 2026-11-06, p5-desk-track-owner (M4).
- Decision (the architect's ruling, from M4's first review; amended below by the ruling on a hubless machine, which also narrows what the cutover closes): until M5's step-up cutover, widening from an agent's shell stands as built, and the cutover lands before a second member joins the production org.
  - What stands: an agent's shell can unset `CLAUDE_CODE_SESSION_ID`, run the CLI under a pty it opened and type `y`, and `sminos access <s> listed` succeeds (the review's repro). Meanwhile sminos's skill tells agents to hand widening to their human.
  - The cutover (M5): once the app's `record.access` and `record.shares` offers exist, sminos's CLI refuses widening ("use MAWS") and keeps narrowing, and M6's live widening moves to the app or a staging-only path.
  - Acceptance 8 reads: refused for an agent that follows its instructions; closed to every agent by the cutover, before a second member joins the production org.
  Rationale: D10 chose the operator's terminal as the trust that already admits signing, and any local check is defeatable by a shell of the same user. Only the app's step-up, signed by the device's step-up key, closes widening to every agent. While the org is the owner alone, a widened session reaches no one but its owner.
  Rejected: an ancestry check (refuse when a `claude` process is an ancestor), which adds code and closes nothing, since tmux, launchd and setsid detach the CLI from its agent; and step-up on the CLI, which is M5-sized.
  Date/Author: 2026-11-06, the architect (chat 1150), relayed by the coordinator (p5-desk-track-owner).
- Decision (board #492): a withheld own snapshot is restated once, as D5 now says. `withhold_own` records the debt in `restate.json`; the daemon's next tick writes the snapshot again from the record as it is then, unless a later own snapshot of the same kind exists or the session is no longer a local member (for a `joined`, a joined one); a restatement withheld again owes nothing and is logged. A tick interrupted between its intent and its append adopts the first later own snapshot of that kind as the restatement. Positions withheld before sminos 1.37.0 are never owed.
  Rationale: an idle session's registry row would otherwise stay where the withhold left it, and an unknown session is refused every message naming it, its owner's included. One restatement repairs a transient cause within a tick of the refusal reaching sminos (at worst the next archive `have`, 15 minutes), and a cause that holds costs one position per natural snapshot. That bound is what P5 Decision Log 229 asked of it, and its version is a precondition of the production hub deploy.
  Rejected: republishing on every reconciliation, which loops on a session bound to another machine; "a later own snapshot" of any kind, which would leave a withheld `state`'s word unpublished whenever a natural `joined` came first; matching the kind costs at most one extra position.
  Date/Author: 2026-11-06, p5-desk-track-owner (sminos 1.37.0, reviewer-medium, two rounds, the second correct).
- Decision (the architect's ruling, P5 Decision Log 231): after the cutover a machine enrolled at no hub keeps the terminal gate, and the cutover closes widening to every agent that goes through sminos, not to a hostile process of the same user (M5).
  - Enrolled means `hub.json` in the same sminos home as the records; enrolling changes no record, so the cutover applies from enrollment on. On an enrolled machine a session in a project a committed `.smns` declares with no hub can't be widened after the cutover. That is accepted: sminos publishes nothing of such a project, so its reach has no effect.
  - Acceptance 8 is reworded to match. The setter test for the cutover (M5's Proof) also covers a hubless machine's terminal widening.
  Rationale: a hubless machine has no org and no app path, so refusing would leave its owner no way back from private. Neither the endpoint nor the hub checks a widening against an act, and a same-user process that bypasses sminos can already send the transcript anywhere.
  Rejected: a per-project exception (the desk track's proposal), which a join, a terminal widening and a join back would turn into a path through sminos's own verbs, and which buys nothing, since every directory of an enrolled machine without a `.smns` is in a hub project; a hub-checked act, which closes one path of many.
  Date/Author: 2026-11-06, the architect, on the desk track's question (P5 Decision Log 231).
- Decision (the architect's ruling, sminos chat 1164, on the desk track's proposal): the cutover is keyed on the endpoint's welcome carrying `record`, not on O8 M6b's landing, kept sticky in `daemon/audiences.json` (M5).
  - The exception's test becomes "not cut over to an endpoint": a machine enrolled at no hub, and one on a hub over DX2 alone, get no welcome and keep the terminal gate.
  - The second member's precondition gains: every enrolled machine on sminos 1.39.0 or later, its endpoint's welcome carrying `record`.
  Rationale: sminos and the MAWS app update on different paths, so a date-keyed cutover could refuse widening where no app can carry it; the endpoint's word is the fact the cutover depends on. Keeping the word through an endpoint's absence stops a stopped mawsd from reopening the terminal gate through sminos's own path.
  Rejected: keying on M6b's landing (the version skew above); reading the endpoint live at each widening, which an endpoint that is away would answer as "no `record`".
  Date/Author: 2026-11-06, the architect (chat 1164), on the desk track's proposal (p5-desk-track-owner).
- Decision (M5's executors, O8 M6b and M5b's sminos half, sminos 1.38.0): `record.access`, `record.shares` and `record.owners` run under the opId ledger as Interfaces §C gives them. `record.owners` admits `@machine` beside member ids, once and first (RL §5.8), and a mixed record's `joined` publishes the endpoint's resolved owners at the record's `policyRev`, never the token. Every real owner change bumps `policyRev`, whatever the access. The proof must be this op's own act, bound to its target and change. An owner an act added is the session's current state, kept with its proof chain when stronger evidence replaces the record.
  Rationale: the app checks each outcome against the revision it caused, and a malformed act let into `ownersProof` would fail every later attestation of the session.
  Rejected: bumping `policyRev` only when a private session's audience changes, which leaves a listed session's owner add with no revision for the app to check its outcome against; taking any act as the proof, which an endpoint bug could turn into a permanent bad entry.
  Date/Author: 2026-11-06, p5-desk-track-owner, agreed with the architect for O8's §Q (reviewer-high with a security lens, three rounds, every finding fixed).

- Decision (the architect's ruling, chat 1204, on the desk track's mapping): M6 runs as a new `deployment reach-acceptance` on one VM of scratch scenes (A1 and A2 the admin's, B1 a second member's, A3 on sminos 1.34.0 for 6e) with two in-process probe machines (PA without `audience`, PB with it), built on O10 M11's pieces (M6).
  Rationale: every O18 item needs a machine of the second member's and two of the owner's, which O10's one-machine scene lacks. Scratch users on one VM are separate machines to the hub at a fraction of the cost of several VMs, and the probes show the old-endpoint and old-reader cases without an old MAWS build.
  Rejected: extending O10's `ITEMS`, whose scene and verdicts are shaped for one machine; the owner's MacBook as the owner's machine, which is enrolled in production; a browser as the second member, which the hub can't resolve to `@staging.invalid`.
  Date/Author: 2026-11-07, the architect (chat 1204), on p5-desk-track-owner's mapping.
- Decision (the architect's ruling, chat 1204): the run widens on its scratch machines through a pty it controls, the staging-only path M5 allows. The harness refuses that path for any hub but staging's and any machine outside the run's own scenes, and a test pins the refusal. The scene's MAWS is pinned to the M6 branch's cut, before O8 M6b, so its endpoints advertise no `record` and the terminal path widens. The step-up path is proved by M6b's own e2e, and acceptance 8's cutover sentence is cited from `Cutover`.
  Rationale: `devcloud vm ssh` gives no `/dev/tty`, and O8 M6b is behind M7b and M6a, so waiting for step-up acts would hold M1's production deploy on O8.
  Rejected: waiting for M6b and widening by step-up acts; building both paths.
  Date/Author: 2026-11-07, the architect (chat 1204).
- Decision (the architect's ruling, chat 1204): acceptance 3a, 3c and 3d are corrected to D4 and D6, not lowered. In 3a, the second machine carries none of the session's audience streams and nothing of it after its `unlisted` notice, and C1, born private, shows the literal none. The archive's tombstone moves from 3d to 3c. 3d's archive holds no file of the stale `say`'s stream.
  Rationale: B1 keeps the plain history from while S was listed, since D6 takes nothing back, and receives S's `unlisted` notice, which D6 serves to the withdrawn. A stale `say` after a share removal carries the audience the share gave (D4), so it travels in an audience stream, which never enters the archive. A plain-writer `say`, the forged one, is what the archive holds as a tombstone.
  Rejected: running the clauses as first written, which would fail on behaviour the design requires.
  Date/Author: 2026-11-07, the architect (chat 1204), on the desk track's mapping (its §8.6 and §8.7).
- Decision (the architect's ruling, chat 1204): 6a (an old hub) and 3a's browser half are cited from suites, and 6e runs live on A3 (sminos 1.34.0, `386c4b07`).
  Rationale: a pre-M1 hub deployed over M1's stored tombstones and policies would put staging's logs at risk for a case the endpoint's hold tests already show. A browser can't be the second member. 6e costs one more scene.
  Rejected: two staging deploys for 6a; a real mailbox for the second member.
  Date/Author: 2026-11-07, the architect (chat 1204).
- Decision (the owner, on the desk track's question): the run's VM is created with `devcloud vm up` without the MAWS project, so devenv's MAWS setup never runs on it and no scratch machine joins the production org (M6).
  Rationale: a VM made with the MAWS project provisions its own mawsd into production for its lifetime, and the run needs none of it: the harness brings the branch as a full bundle and installs what the base image lacks.
  Rejected: `--project maws`, which provisions the VM's own mawsd into production under the delegation for the VM's lifetime.
  Date/Author: 2026-11-07, the owner, on the desk track's question.
- Decision (M6's harness, p5-desk-track-owner): `reach-vm setup` takes `--vm`, `--sminos` and `--old-sminos` and no `<base>`; `reach` takes `--vm` and `--direct-url ws://<the VM's tailnet address>`, each scene's listener its own port there (47841–47844).
  Rationale: the branch goes as a full bundle, which has no base, and the VM is made for the run, so nothing about it can be a default.
  Rejected: a `<base>` kept for a bundle cut from the VM's checkout, which a VM without the MAWS project does not have.
  Date/Author: 2026-11-07, p5-desk-track-owner (M6's harness).
- Decision (M6's harness): every item first sets the visibility it needs (narrowing from the session's own shell, widening by the operator's pty), so `--items` rehearses one alone; two items follow from it. Item 5's cross-machine variant is S → T, not U → T, and 6d makes T listed again first: item 1 leaves T private, and U, outside T's audience, could not message it.
  Rationale: the run order makes each item's state its predecessors', which a rehearsal of one item does not have; the spec's items name what they show, not the sender of 5's variant.
  Rejected: a fixed state machine across items, which only the whole run reaches.
  Date/Author: 2026-11-07, p5-desk-track-owner (M6's harness).
- Decision (M6's harness): 6a prints as its own `CITED 6a: …` line after the summary, 3a's browser half and 8's cutover sentence as `by the suites` notes under their items, and the preflight as the item `scene`.
  Rationale: 6a has no live sub-item to hang a note on, and an item with no check would read `FAIL`.
  Date/Author: 2026-11-07, p5-desk-track-owner (M6's harness).
- Decision (M6's harness): the operator's terminal is a pty `vm/scene.sh` holds through Python's `pty.fork`, which answers `y` once sminos asks `Confirm? [y/N]`, rather than util-linux `script` fed on stdin; the pack is built once, as `o18a1`, into `/opt/o18-m6/packs`, which root then owns and every scene reads.
  Rationale: `script` ends its child on stdin's EOF, so the answer would race the prompt; the scene homes are 0700, so one build serves all four only from a shared directory.
  Date/Author: 2026-11-07, p5-desk-track-owner (M6's harness).

## Outcomes & Retrospective

- M1 (2026-11-05). The hub now does everything Interfaces §A gives it:
  - It keeps a policy registry, bound at first exposure. The registry is filled once from every project's newest snapshots, with a bounded 10 s wait before `state-unavailable`.
  - It refuses at upload, in batch order with replay. Out of reach gives a tombstone and `not-reachable`, a digest mismatch gives `audience`, and when the state is unavailable nothing is stored.
  - Every read surface (machines, HTTP, browsers, Web Push) asks `mayRead` or `maySeeSession` first.
  - RL1 hellos carry `capabilities` and the welcome answers `audience`.

  The diff is 28 files, +2007/−115 over seven commits. There are two new test files, `policies.test.ts` (15 tests) and `audience-reads.test.ts` (11 tests). The existing log, signed-log, relay, org and push suites run unchanged. Static and unit are GREEN on `a091ce1cb`.
- What the reviews caught. The first review (five findings) and the second (one) found reader-side races: owners narrowed after the head read, a backlog on the Reader captured at hello, and a queued frame never rechecked. They also found two places where the sender's identity came from the event body. Each fix fails closed, re-resolves the reader and ends a connection it would otherwise leave holed. The lesson for M2 and M3: a reader's authority is checked where data leaves, not where it's chosen.
- Left for later:
  - the browser offset counter shows a stream's volume (accepted residue);
  - the send-path window in the relay (Surprises, third review);
  - today's endpoints and desk-web read a tombstone as malformed, until M2 and M2b.
- M2 (2026-11-06). The endpoint now:
  - decides `reach?` from the sender it verifies itself (the `list` grade among the share grades);
  - signs audience streams with the meet of the sessions' audiences, redacting provenance and voiding refused positions;
  - keeps the policy cache, rebuilt from paged `snapshots?` when sminos advertises `audience`;
  - holds private streams while the hub's welcome lacks `audience`;
  - reads M1's tombstone as a spent, withheld position.

  The same branch fixes M1's same-batch withholding (a seat spawned and messaged at once) with a two-pass judgment.
  There are three new endpoint suites (`reach`, `audience-signing`, `policy-cache`) and a private-session replay against
  the M1 hub in `conversation.local.test.ts`.
- What the reviews caught. The first high-rung review found three things:
  - a ledger resend that skipped the hub-capability hold;
  - a device's stream writer that resolved to no member;
  - an `audience` stop that a void never lifted.

  The lesson repeats M1's: a gate belongs where data leaves (every send path), not only where it is first decided.
  The re-review was clean.
- Left for later: a phase-1 name-held binding lost on a machine's rename (Surprises, M2), and desk-web's exact
  `isListing` (M2b).
- M2b (2026-11-06). Desk-web's DX6 client stays frozen (the architect's ruling).
  - It seals no audience. M1's `takeHuman` refuses its words toward a private session, an `@all` naming one included,
    and nothing about the attempt reaches an outsider but a content-free audit row. Toward listed sessions it works
    as before.
  - A hub test on M1's local hub proves it. Desk-web reads the hub's tombstone as `withheld`, closing M1's residue.
    M2's `isListing` residue turned out to be the deployed desk-web alone, which the next hub deploy replaces.
  - A browser that does message a private session was built first: the hub's per-member policy rows on the registry
    socket, and a `say` that splits per audience. It was reverted unmerged when the ruling came in. The Decision Log
    keeps it as the route for a later client, and why it beat an `endpoint.listings` call (O13's "Nothing but cards").
  - The lesson: before changing a frozen client to reach a new capability, check whether the backstop already makes
    its old behaviour a refusal. If it does, the frozen client's "can't" is a recorded behaviour, not a gap.
- M3 (2026-11-06, sminos 1.35.0, doperpowers PR #463). With an M2 endpoint and an M1 hub, sminos now:
  - sends `access`, `shares` and `policyRev` to an endpoint that advertises `access`, keeps them across every rebuild of a record, and sends nothing for a record it can't read;
  - writes a private session's events only under its audience streams, splitting a `say` and its copies per audience so the public part names nothing private, with narrower provenance redacted;
  - archives only the hub-admitted public projection, never a stream file, and keeps the public history the archive already held;
  - answers `snapshots?`, and stops a writer refused `audience` until a new event revives it with voids.

  Each Proof item has a red-first test: `test_streams` (22), `test_reach` (30), `test_snapshots` (5), `test_records`' policy cases (9), and 13 new assertions in `test-archive.sh` (68 in all). Replayed against a pre-M2 endpoint's conversation with only the hello amended, 1.35.0 sends what 1.34.0 sent (107 ok, 0 FAIL).
  - What the reviews caught (three rounds; the third correct): state taken from somewhere other than its authority at the moment of use. A member frame was built from a cached record, a former name's frontier came from a `have` that couldn't speak for it, a copy went into a home whose transport doesn't filter, and a frontier that moved backwards rewrote public history. The lesson repeats M1's: decide from authoritative state, read where the data leaves.
  - Left for later: a former name with no saved frontier stays out of the archive for good, and a refusal lost before a rename can't be learned from the hub. Both fail closed, and a former-name list on the hub's side would close both. Two gaps went to M4, which closed them: the operator stream's head-wait on re-enrolment, and a continuation known only from the log taking the listed defaults.
- M4 (2026-11-06, sminos 1.36.0, branch `o18-m4-sminos`). On a machine whose endpoint advertises `reach`:
  - every peer push is authorized as it leaves, by the endpoint's `reach` or by the identity of two local records, and silence never drops a message;
  - a refusal stays on the machine;
  - the owner narrows from any shell and widens from a terminal;
  - a withdrawn member's projection drops the session at its `unlisted` notice;
  - a sender whose message the hub withheld is told once.

  Tests, each red first: `test_reach_gate` (26 and more), `test_visibility` (19 and more), `test_withheld` (9), and additions to `test_records`, `test_heads` and `test_streams`; the conformance replay at 107 ok, 0 FAIL.
  - What the reviews caught (three rounds; the third correct): as in M3, provenance and capability read from somewhere other than their authority. A writer name stood for local provenance though a git mirror can import it, a missing `audiences.json` read as an old endpoint's "no capability", a recovered record's `policyRev` came from evidence older than what survived on the machine, and a draw suspended across a transition sent the snapshot ahead of its notice. One finding stands until M5's cutover by the architect's ruling: an agent can pass the terminal's confirmation under a pty of its own (Decision Log, 2026-11-06). The lesson for M6: check that a fast path's condition is still true of the data in hand, not of the configuration around it.
  - Left for later:
    - D5's republishing of a withheld own snapshot isn't built. Unbounded, a snapshot refused for good (a session bound to another machine) would go up on every reconciliation, so it needs a bound or a ruling. Built since as a single restatement (board #492, sminos 1.37.0; D5).
    - `cmd_steer` pushes to another session's bridge, supervisor or inbox with no event and no reach check. It is a control verb outside D8's list, but on a shared machine it reaches another person's session. Board doperpowers #173 (P2).
    - A project whose git remote was removed by hand, while it still holds imported own-name lines, takes the same-owner fast path for them. Closing it needs per-event provenance for a session's `say`; receipts exist only for `human`.
    - Smaller: `send --wait` returns early when only `push_live`'s hold fired; a transition for a session that is no member here stays pending, at one stat per tick; events to sessions that aren't live are now asked too, which adds `reach?` traffic; MAWS's conversation fixture stages no `reach?` (Surprises, M4). The hand-removed remote and the three sminos items are board doperpowers #174 (P3); the fixture is a row in the architect's tracker.
- D5's restatement (2026-11-06, sminos 1.37.0, board #492). A withheld own `joined` or `state` is written again once, on the daemon's next tick, and a second withhold is logged and left to the session's next natural snapshot. Tests, red first: `test_withheld`'s `Restate` class (repair, no loop, nothing owed after a newer snapshot, a retired session and a message owing nothing), against a hub stand-in whose registry binds the session elsewhere; the fix wave after the first review (three findings) added six more, each red first: the debt survives a failed save, an `OSError` while owing still settles the position, and a tick interrupted between its intent and its append is recovered without a loop.
  - The lesson: a record that a mechanism is "already done" by an existing path needs the path read, not assumed; D5's sentence named a publisher that compares against the very file the withhold keeps.
- M5's sminos executors (2026-11-06, sminos 1.38.0). A step-up act the endpoint verified changes a session's access, a share or its owners on its own machine, through the CLI's setters, and answers with the revision it caused. Tests, red first: `test_visibility`'s `RecordRpcs` over the real RL10 link (every executor, every refusal, the ledger's replay), with additions to `test_records`, `test_rl10`, `test_streams` and `test_rpcs`; the conformance replay at 107 ok.
  - What the reviews caught (three rounds, every finding fixed): an owner added to a provisional record was lost when the hook's evidence replaced it, and the act was first taken without being bound to its target, its change or its op. All of it is defence in depth behind the endpoint's own verification; what it protects is `ownersProof`, where a malformed act would fail every later attestation.
- M5's widening cutover (2026-11-07, sminos 1.39.0, doperpowers PR #467). Once a machine's endpoint welcome carries `record` (it serves the Share sheet's `record.access`, `record.shares` and `record.owners`), `sminos access` and `sminos share` refuse every widening with "use MAWS", from a terminal too, and narrowing still runs.
  - The kept welcome is sticky: an endpoint that is away leaves it standing, and only a later welcome without `record` lifts it. A missing or unreadable `audiences.json` on a cut-over machine counts as `record`. A machine not cut over to an endpoint, a hubless one among them, keeps the terminal gate, and the record acts' own path still widens.
  - Tests: `test_visibility`'s `Cutover` class (seven cases: refusal and narrowing, the sticky word, a lost file, a rebuilt file, a welcome that arrives while the terminal waits, a machine not cut over, the record acts).
  - What the review caught (two rounds, the second correct): an `audience` frame that rebuilt a lost `audiences.json` wrote `capabilities: []`, which read as a welcome without `record` and reopened the terminal; a rebuild now writes no capabilities and they read as not known yet. And the cutover was checked only before the y/N prompt, which can wait indefinitely; it is now decided again at the write, under the records lock. The lesson repeats M4's: check the condition against the data in hand at the moment of the act, and never let a file you rebuilt stand in for a word nobody said.
  - What stays open for a second member: DL 235's precondition also needs every machine's endpoint to send the `record` welcome, which waits on O8 M6b's app.
