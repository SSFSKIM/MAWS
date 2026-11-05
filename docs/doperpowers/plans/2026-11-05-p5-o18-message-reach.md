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
- from the second member's session, `sminos say "@<short> hi"`: it answers `no member named …`;
- a forged copy of that `say` gets back a `not-reachable` notice;
- the second machine's log files hold no trace of the private session.

Then `sminos share <session> <member> list` (run by the owner at a terminal): the second member's agent now sees the session and messages it, while their transcript read is refused.

## Progress

- [x] (2026-11-05 20:40Z) Document written from the desk track's draft (`notes/477-message-reach-design.md`), the architect's amendments (sminos chat 1128, 1131) and two read-only mappings of today's code.
- [x] (2026-11-05 ~21:00Z) Two adversarial reviews ran. This revision folds their P1 and P2 findings, with the resolutions the architect approved (chat 1131–1132); each course change is in the Decision Log.
- [x] (2026-11-05) A third adversarial review found nine holes; this revision folds each with the resolution the architect decided: one reader check for every hub read surface, an archive of the admitted projection, the session's machine bound at first exposure, `unlisted` as a validated notice, redacted provenance references, the reach gate at the push primitive, an unreadable record failing closed, a bounded retry after `state-unavailable`, and a complete `snapshots?` rebuild.
- [x] (2026-11-05) The round-3 review found four more holes; this revision folds each with the architect's resolution: the archive's own-writer frontier is the hub's `have`, not socket handoff; an old sminos or endpoint never receives an audience stream; a split `say` carries only its own recipients' leading tags; a valid `unlisted` notice is admitted by its own rule.
- [ ] The execution section's buildability review.
- [ ] M1: the hub's policy registry, upload backstop and audience filter (MAWS).
- [ ] M2: the endpoint: the `list` grade, `reach?`, audiences and the policy cache (MAWS).
- [ ] M2b: devices: the audience from the listing (MAWS).
- [ ] M3: sminos's visibility frames, records and audience streams (doperpowers).
- [ ] M4: sminos's send boundary, the setters, refusals and unlisting (doperpowers).
- [ ] M6: live acceptance on the staging org.
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

- **Where the ask happens.** sminos asks its endpoint `reach?` before it pushes any peer message (`say`, `send`, and wakes), on every send path (D8). The ask carries the event's writer, its `verified` block, the project and the recipient session.
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
- **What the sender sees.** A sender's projection of the logs holds only the sessions its person may see (D6), so a tag naming a private session it isn't shared on fails as `no member named …`, the same words as for a session that doesn't exist. A broadcast (`@all`, `--org`, `--project`) wakes only what it sees.
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

A hidden session and a nonexistent one get the same reason, so a refusal never confirms more than the sender already knew. A snapshot in the same upload moves the registry before the events after it are checked. A withheld own snapshot counts as unpublished, so `publish_owners` (`sminos.py:2984`) writes the session's snapshot again.

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
- **At pushing, in the push primitives.** The gate sits inside the functions that hand a log event to a session, not in their callers: `push_live` (`sminos_control.py:183`), the last hop of every live push (`push_member`, `sminos.py:4960`, `:4985`; a receipt's push in `holder_carry`, `:4308`; `send_to_seat`, `:9855`; `send_to_member`'s legacy holder, `:10120`), and `resume_session` (`sminos.py:9535`) when it resumes a stopped seat with a message as its prompt (`:5015`, `:9838`). Every log event they hand over as a peer frame asks `reach?` at that moment; a person's words (verdict `words`) are the words gate's. So a not-yet-delivered peer is checked wherever it comes from, `deliver_verdict`'s human downgraded to a peer (`decideWords` answers `peer` on several paths, `words.ts:53-84`, rank below `converse` among them), a receipt's retry and `SendDelivery`'s queue included. An event the endpoint refuses is settled `refused-reach` and left out; one it can't answer for holds the send owed.
- **Admission never authorizes a later delivery.** Neither the hub's admission, an earlier `reach` answer nor a prepared receipt stands for the push that follows it: each push asks again.
- **A projectless push** (a seat with no project, so no event to ask about) goes only to a session whose owners intersect the sender's; otherwise the CLI refuses it: `<alias> has no project, so only its owners' sessions reach it`.

**Release.** The setters (D10) ship in the same sminos release as these guards: they are built in M4, with the guards. M3 can release alone because without a setter no session can become private.

**Devices.** Desk-web's `say` (`apps/desk-web/src/project/connection.ts:296-306`), and any device that signs a `hub/` human, compute the event's audience from the listings they hold (D7) and seal it into the event. The hub positions it under `hub/<member>~<digest>` when it carries an audience, and `isHubPosition` (`apps/org-protocol/src/names.ts:73-81`) accepts that writer exactly when the digest is the event's own audience's. `takeHuman` applies D5's checks with the member as the sender. A browser that sends no audience (an old one) is refused `not-reachable` toward any session with an audience.

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

- **Where they act.** Both call one function, `set_visibility` (Interfaces §C), which changes the session's record on its own machine (`session-records/<sid>.json`) under the records lock, bumps `policyRev`, writes D6's `unlisted` notice when members are withdrawn and the new snapshot, and has the endpoint restate the record. M5's executor calls the same function.
- **Narrowing is open to anyone in a session's shell:** going private, removing a share, lowering a grade.
- **Widening only from the owner's terminal:** going listed or org-wide, adding a share, raising a grade.
  - Widening runs only as the operator: no `CLAUDE_CODE_SESSION_ID`, with a confirmation read from `/dev/tty`, as Decision Log 28 does for signing.
  - From a session it is refused: `widening reach needs its owner: run this in a terminal, or use MAWS`.

  An agent can't open a session to more people than its owner chose.
- **The policy survives record rebuilds.** `access`, `shares` and `policyRev` are kept when `establish` replaces a record's provenance (`sminos_records.py:166-191`) and copied into a continuation's record by `inherited` (`:520-524`), so a background copy or a resume keeps its predecessor's reach. A sminos-spawned session takes its spawner's access and shares (`spawn_provenance`, `sminos.py:9343-9369`), so a spawn never widens reach; an operator's spawn takes the default. Every write of a record reads and writes these fields under the same lock, so a setter racing a reconciliation can't lose either change.
- **An unreadable established record fails closed.** A session with no record file is new and takes the defaults (`listed`). One whose record file exists but can't be read is established, and its policy is unknown: `ensure_record` returns None for it (`sminos.py:2934-2952`), and `member_frame` would then send the defaults (`sminos_uplink.py:1367-1381`), listing a private session. Until the record reads again, sminos sends no member frame for it (a restatement leaves it out, so the endpoint withdraws its listing, `members.ts:127-131`), writes no event of it (`stream_for` can't choose its stream), and asks no `reach?` for it, so deliveries to it stay owed.
- **Rejected:** a step-up signed widening through the device, as for owner changes (Decision Log 219's list). It's right for the app's picker (M5), but it needs the app. The operator's terminal is the same trust that already admits signing.

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
   - **Nothing new reaches the second machine or member.** That machine and the member's browser receive none of its later events. `sminos list --org`, `find` and `@short` don't name it, the machine's log files and `uplink.json` carry none of its writers, the second machine asking the hub's HTTP history route for its writer by name gets nothing, and the project's git archive holds none of its streams.
   - **Nothing else names it.** A session it spawned that stays listed doesn't name it as its spawner to the second member. A `say` from one of the owner's listed sessions tagging it and a listed session together reaches the second machine only as the listed session's event, whose text names neither the private session's alias nor its short.
   - **A forged `say`** sent to it is refused at the hub's upload, and the sending session gets the `not-reachable` notice.
   - **A share removed, then a stale `say`.** The second member is shared, the share is removed, and their session then sends a `say` from a view that still holds the session. The hub refuses it at upload, and the sender gets the notice; the session never receives it, and the project's git archive holds it only as its tombstone.
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
   - an old browser (the hub refuses its humans toward the session);
   - an owner's own second machine on an old sminos, designated the project's archiver: it never receives the private stream (its endpoint withholds it), and the archive it writes holds none of it.
7. A private session's agent messaging a session outside its audience is refused at its own CLI with the unlisted message (D4), and nothing is written.
8. From an agent's shell, `sminos share <s> <person> view` and `sminos access <s> listed` are refused. `sminos access <s> private` from the same shell succeeds.

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

### M2b — Devices: the audience from the listing (MAWS)

**Scope.** Desk-web, and any device that signs a `hub/` human, seal the right audience into a message to a private session, taken from the private listing it holds.

**Work.**
- **Desk-web:** the listings store keeps a private session's `audience` and `policyRev` from its machine-signed listing; `say` (`apps/desk-web/src/project/connection.ts:296-306`) computes D4's audience for its recipients and seals it into the draft, refuses locally a recipient with no listing it can see, and shows the hub's `not-reachable` refusal on the outbox entry as it shows other refusals.
- **A device-signed human (RL8)** puts `audience` inside its signature the same way.

**Result.** A member's messages from the browser reach a private session they may message, under its stream, and nothing reaches one they may not.

**Proof.** Red first, in desk-web's tests and the local-hub replay (Miniflare, from M1):
- messages alternating between a public and a private session go under `hub/<member>` and `hub/<member>~<digest>` in turn, each reaching only its readers;
- a listing whose `policyRev` rises changes the audience sealed into the next message;
- an old client (no audience) toward the private session is refused, and toward the public one is delivered.

Gates `static,unit`. Review: reviewer-high, security lens.

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
- **The executor:** O12's sminos executor runs each under its opId ledger by calling `set_visibility` (Interfaces §C), the same function the CLI verbs call, so the two paths can't differ.
- **The picker's text:** the **Can message** level; a private session's agents talk only within its audience; what was already shared stays shared; the old "say messages stay org-readable" warning (O8 document `:1032`) is gone.

**Proof:** O8's own e2e for the picker.

### M6 — Live acceptance on the staging org

**Scope.** Acceptance 1–8 run live.
- **Who's on it:** the owner's MacBook session; a devcloud VM enrolled under a second staging member added for the run (`apps/desk-hub/deploy/staging-run.sh endpoint-vm setup|teardown` and `admin …`); the M1 hub deployed to staging; a browser signed in as the second member.
- **What's recorded:** each item with its evidence (a transcript line, a file listing showing absence, an outcome row, the archive's file list) in this document's Surprises or Outcomes.
- **Teardown:** the second member is removed and the VM torn down after the run.
- **Production:** M1's production deploy is the owner's, and it waits for this proof.

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

    # live acceptance (M6):
    zsh <wt>/apps/desk-hub/deploy/staging-run.sh endpoint-vm setup
    devcloud vm ssh <vm> < <script>      # the second member's session's commands
    zsh <wt>/apps/desk-hub/deploy/staging-run.sh endpoint-vm teardown

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
    sessionRefs(event): Array<{ session: string; role: 'addressing' | 'provenance'; path: string }>
      // every structured session reference an event carries (D4); `path` names the field, for redaction
    // the transition notice (sminos log event), content-free:
    { kind: 'unlisted', session: string, policyRev: number, audience: string[] /* the withdrawn members */ }
    // the hub's refusal of an out-of-reach upload, and what it stores in the position's place:
    { t: 'refused', project, refusal: { reason: 'not-reachable', writer, seq } }     // no message
    { writer, seq, withheld: true }                                                 // served in the writer's stream
    // the registry (Registry DO, Policies table):
    Registry.policies({ snapshots: Snapshot[], sessions: string[] }): Promise<Result<Record<string, Policy | null>>>
      // Snapshot = { session, machine, audience: string[] | null, policyRev, created }
      // Policy   = { machine, audience: string[] | null, policyRev, created }   // machine: bound at first exposure,
      //            by a snapshot here or a listing in Registry.storeListing; never moved
    // the one reader check, in the Project, before any read surface returns (D6):
    mayRead(reader: { machine: string; owners: string[]; streams: boolean } | { member: string }, writer: string): boolean
      // streams: the machine's RL1 hello advertised 'audience'; false on a DX2 stream
    // RL1:
    Rl1Welcome.capabilities?: string[]       // 'audience'
    EndpointHello.capabilities?: string[]    // 'audience': this endpoint withholds streams from an sminos without it

sminos computes `audienceDigest` identically in Python, `hashlib.sha256(json.dumps(sorted(set(m)), separators=(',', ':')).encode())`, and a shared vector in `vectors.test.ts` and `sminos/tests/` pins the two together. Use the same JSON separators on both sides.

### B. RL10 and the listing (M2 ↔ M2b, M3, M4)

    sminos → endpoint:  {t: 'reach?', id, project, session /* recipient */, event /* as stored, with verified */}
    endpoint → sminos:  {t: 'reach', id, verdict: 'deliver' | 'refuse', reason?: 'not-reachable' | 'unverified'}
    endpoint → sminos:  {t: 'audience', session, owners: string[], members: string[] | null, digest: string | null, policyRev}
                          // members null: listed; sent for local sessions and for remote ones the policy cache holds
    endpoint → sminos:  {t: 'snapshots?', id, project, after?: string}       // a lost policy cache, one project at a time
    sminos → endpoint:  {t: 'snapshots', id, project, events: [...], next: string | null, done: boolean}
                          // newest stored joined/state per remote writer, a bounded page; `done` on the project's last
    endpoint → sminos:  {t: 'spent', project, writer, seq, reason: 'withheld'}   // a hub tombstone, in stream order
    endpoint hello:     capabilities?: string[]   // 'access', 'reach'
    sminos hello:       capabilities?: string[]   // 'audience': streams may come down; its archive copies only the admitted public projection
    member frame:       access?: 'private' | 'listed' | 'org-view' | 'org-converse'; shares?: [{member, grade: 'list'|'view'|'converse'|'approve'}]; policyRev?: number
    Listing.fields:     audience?: string[]; policyRev?: number     // a private session's channel listing only

`decideReach(ctx: WordsContext, ask) → 'deliver' | {refuse: reason}`, in `src/endpoint/rl10/reach.ts`, takes the same context as `decideWords`.

### C. sminos (M3, M4)

- `sminos access <member> <level>` and `sminos share <member> <person> <grade|none>` (D10), both through `set_visibility(sid, *, access=None, share=None, operator)`: the record change under the records lock, `policyRev` bumped, the `unlisted` notice (when members are withdrawn) and the snapshot written, the endpoint told. M5's executor calls it with the act's proof.
- `stream_for(project, writer_session, recipients, text) → [(writer, audience, recipients, text)]` or the D4 refusal: the one stream choice every append path uses; each split's `text` carries only its recipients' leading tags.
- `ReachGate(project).held(event, session) → None | 'refused' | 'owed'`: the one push check, called inside `push_live` and `resume_session`, so every deliverer reaches it.
- `sessionRefs(event)` in Python, the same list as §A's, pinned by a shared vector.
- `HubLog.withhold_own(writer, seq)`: an own position the hub withheld.
- `uplink.json` `archive_have: {have: {writer: seq}, withheld: {writer: [seq, …]}}`: the own-writer entries of the `have` that last confirmed the archive, and the positions the hub withheld in them; `copy_log`'s frontier for this machine's writers.
- RL1 `have` (M1): optional `withheld: {writer: [seq | [from, to], …]}`, for the hello's own machine's writers only.
- Outcome `refused-reach`. `REACH_WAIT = 10`.

### D. M5 (O8 M6, the architect)

`record.access {access}` and `record.shares {member, grade | null}` in `src/endpoint/offers.ts`, `manage`-graded with step-up, executed by O12's sminos executor through `set_visibility`.

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
- Decision: the setters. Narrowing is open to a session's shell; widening is operator-only, with confirmation at `/dev/tty`. A red-first test covers it.
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
- Decision: browser and device humans get the same registry backstop at `takeHuman`, go under `hub/<member>~<digest>` when they carry an audience, and take the audience from the private session's machine-signed channel listing, which gains `audience` and `policyRev`. An old browser is refused toward any session with an audience. Built in a new M2b.
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

## Outcomes & Retrospective

Pending — written at finish.
