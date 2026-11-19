# MW · sminos channels and threads in MAWS: the endpoint, the hub, the readers (2026-11-18)

> **Parent:** the doperpowers repository, `docs/doperpowers/specs/2026-11-17-sminos-channels-and-threads-design.md` (the composite spec "sminos: channels and threads", its root), child **MW** ("MAWS: channels at the endpoint and the hub"), parent pin `88e771ba5ee4de076b4258a5b56d8657411bc3f0` (its `main`). Read it with `git -C <a doperpowers checkout> show 88e771ba:docs/doperpowers/specs/2026-11-17-sminos-channels-and-threads-design.md`.
>
> **The design** is the parent's: child MW's section, whose acceptance is this work's contract item by item; D6, "The contract with MAWS"; D3 (the id of version 8, the seven days); D1 (lane B left out, the lane change); D7 (the reader rule for `thread`); contracts X4, X5 and X7. The owner approved the cut on 2026-11-18. The lines this work is built to are quoted once, under "The contract"; nothing else of the design is repeated here.
>
> **This document holds** what the design does not: what MAWS's code does today, the decisions the contract leaves to MAWS, the names and shapes sminos's children build on, and the execution.
>
> **Base:** master `77af813a4`. **Two pull requests, in a binding order** (Decision Log 4): M1 alone, with this document, on `mw-channels`; then M2 and M3 on `mw-channels-2`, opened from a master that holds the first. The parent has MW as "one change in that repository"; the order was agreed with the session holding it, so that sminos's T1 can pin the vectors from master.

## Purpose

sminos is giving the owner's sessions two things: a *thread*, a session's membership that outlives its process, and a *declared channel*, a named set of threads with a log of its own that crosses repositories and machines. Both rest on MAWS: the endpoint on each machine stands between sminos and the hub, the hub keeps every log, and the app reads the logs. This work is MAWS's half, built so that sminos's half lands after it and finds nothing missing.

What holds afterwards that does not hold today:

- A machine that holds a thread placed in a declared channel says so in the record it signs, for as long as it holds one. Every machine of the org then follows that channel's log, by the mechanism that already carries a project with sessions and no folder. Nothing declares a channel at the hub.
- A channel's id is told from a project's by the id alone, wherever MAWS acts on one: a folder cannot be linked to a channel, and a session whose project is a channel (which an older sminos allows through `join`) is not held.
- A channel no machine has listed for seven days leaves the hub's grid, and returns when a machine lists it again. Its log is kept throughout.
- A thread that stays `stopped` is handled where MAWS assumed a closed session was gone: an `ended` written by a sminos from before threads no longer makes the thread unaddressable in the app's project chat, a session reopened under the other lane is listed once, and the web desk's two sentences about a closed terminal session are true of a thread.

Until an sminos advertises `channels`, nothing a person or a machine sees changes: frames and records are byte for byte today's.

**How to see it working.** In the suites; there is no live scene until sminos's own children land. The shared vectors pass in MAWS's suite and are the file sminos copies. The RL10 conversation replays with the capability and its one channel case. Two endpoints against the hub in Miniflare show a `member` frame with `channels` arrive as `known` in one machine's record and as a hub project in the other machine's directory, and leave again. For an sminos that does not list `channels`, a scripted session lane gives, frame for frame, what master's endpoint gave for it. The hub's suite retires a channel's row at seven days and brings it back. "Acceptance" names the proof of each item and the gate that carries it.

## Progress

Status words: *specified* (ready to build), *building*, *built* (reviewed clean on the branch), *landed* (on master).

- [x] (2026-11-18) This document written from the approved cut, against master `77af813a4` and the parent at `88e771ba`.
- [ ] Step 0 — The pre-adoption check (the architect and the owner; no executor). Done: the records half and the local sminos store on one Mac, read 2026-11-18, no id of version 8 (Surprises & Discoveries 1). Remaining: the hub's own table, which only the owner reads ("Step 0's commands").
- [x] (2026-11-18) The adversarial review of the execution section (Decision Log 1): two findings, both taken. A listing record that reaches the hub before its channel's row is registered (Decision Log 2), and a mixed-fleet proof that compared the new endpoint only with itself (Decision Log 3).
- [x] (2026-11-18) The order made binding: M1 lands alone and first (Decision Log 4).
- [x] (2026-11-18) M1 — The predicate, the shared vectors, and the readers of a stopped thread; the first pull request, alone — built: reviewed clean at `doperpowers:reviewer-high` in three rounds (Decision Log 6 to 11); `channel-rule.json` at version 1 with five `retired` cases. Landed 2026-11-18: #765, merged as `8a7f308ff` (its tree is the PR head `9c2f9679f`'s), green on class 1a and `e2e:desk-web` in run 44413845424.
- [x] (2026-11-18) The master commit that holds `channel-rule.json` handed to the session holding the parent, for T1's pin (the architect): `8a7f308ff`, version 1, the file's last commit `7665dba00`, sha256 `7cd64b2dbd5a97c28e8640f3e5e44c5574a9f2377d8ac0765788b0227b748f52`. From here the file changes only by §B's sync rule; the second pull request does not touch it.
- [x] (2026-11-18) M2 — Channels at the endpoint: the capability pair, `channels` into `known`, the two refusals, the baseline — built on `mw-channels-2` from master `8a7f308ff`: reviewed clean at `doperpowers:reviewer-high` in four rounds (Decision Log 13); the baseline captured from `77af813a4` before the endpoint changed, equal on the Linux runner.
- [x] (2026-11-18) M3 — The hub retires an unlisted channel's row and brings it back — built on `mw-channels-2-m3`, merged into `mw-channels-2`: reviewed at `doperpowers:reviewer-high` in three rounds, the third leaving two deferred P2s (Decision Log 14).
- [ ] M4 — The second pull request's acceptance, its review, and what is handed to sminos (the controller and the architect) — building: the gates and the baseline's second capture by the controller; the branch is panel-sized (about 24 files and 2,800 lines), so its review is the xhigh panel from the main session (Decision Log 1 (c), 4)

## The contract

Quoted from the parent at its pin. Where this document and these lines differ, these lines bind, and the difference is reported to the session holding the parent, through the architect ("Where the contract meets the code").

D6, the contract with MAWS:

> - a capability pair named `channels`, in hello and welcome, with the RL10 conversation fixture extended in the same change on both sides;
> - the `member` frame's optional `channels`, a bounded list of ids, counted only when the hello listed the capability, and read in one place, so that a channel is in the machine's `known` while the machine holds a member of it;
> - one predicate, `isChannelId`, with test vectors shared with sminos's suite; by it MAWS refuses to link a folder to a channel id and refuses a member whose project is a channel id (which an older sminos would allow by `join`);
> - the hub retiring a channel's row once no machine's record has listed it as known for seven days, and making it active again at the next record that lists it;
> - for threads: the endpoint withdrawing a session's old listing when its lane changes; the web desk's two sentences that say a closed terminal session is reopened only by its human; and the app's reading of who is a member of a project (`projectSessions`) taking D7's rule for a `retired` that carries no `thread`, with vector cases shared with sminos's suite beside the id's.
>
> No declaration record, no new kind of project at the hub, and no change to listings or notifications. MAWS treats no channel event as authoritative.

Child MW's acceptance:

> D6's contract, item by item, each with MAWS's own test. First, before the id rule is adopted: MAWS's hub table holds no hand-written version-8 id, and if it holds one the rule waits until that is resolved. Then: with the capability advertised by both sides, a `member` frame carrying `channels: [<id>]` puts `<id>` in the machine's `known` while that member is held (that sminos opened the log without `follow` is CH's acceptance), and removes it when the last such member goes; without the capability on either side, frames and `known` are byte for byte what they are today; `isChannelId` passes the shared vectors; a link to a channel id and a member whose project is a channel id are refused; a channel's row retires after seven days unlisted and is active again when listed; a lane change withdraws the old listing; `projectSessions` passes the shared vector cases for a `retired` without `thread` (a stamped `joined` then an unstamped `ended` is still a member; then an unstamped `moved` is not; then a stamped `ended` is not; an unstamped `joined` then an unstamped `ended` is not). The RL10 conversation fixture (`test/endpoint/rl10/conversation.json` in MAWS, copied to `sminos/tests/rl10-conversation.json` and replayed by `sminos/tests/rl10_conformance.py`) carries the capability and one case with `channels`.

The id (D3): "a minted UUID, lowercase, with RFC 9562's variant bits and version nibble 8". The reader rule (D7): "Every reader that knows threads, MAWS's app included, ignores a `retired` with reason `ended` that carries no `thread`, for a session whose latest `joined` carries one: only older code writes it, on any verb that reads the store. Every other `retired` is honoured whoever wrote it (`moved`, `continued`, an explicit retire)." Lane B (D1): a session the app itself launched "is not placed in a declared channel". The wire (X5): "RL10 stays at its version; the capability pair `channels` gates `member.channels`. Each side is inert until the other advertises it. The conversation fixture is one file, changed in MAWS and copied byte for byte."

## Words used here

- **Channel.** Three things carry the word in this repository. RL2's channel is a device's encrypted connection to a machine (`apps/org-protocol/src/channel.ts`). The project channel is the app's chat of one project (`src/main/org/channel/`). A **declared channel**, or **sminos channel**, is the parent's: a log that holds no folder and no session's own facts, whose members are threads of any project. In this document "channel" alone means the declared one; code and comments of this work always say "sminos channel" or "declared channel".
- **Thread.** What a session sminos did not launch through the app becomes in the parent: its membership stays when its process ends, and its lifecycle events carry its thread id in the field `thread`. sminos's child T1 writes that field; MAWS only reads whether it is there.
- **Lane.** A session the app launched and reopens is lane B; every other session is lane A. The `member` frame states it.
- **Log, hello, hold, follow.** A project's append-only record at the hub. sminos opens one on RL10 with a log-plane `hello {project, name, have}`; with `follow: true` it only reads it, and without it the machine *holds* the log.
- **The projects record.** What each machine's endpoint signs and the hub keeps at its newest: the machine's `locations` (its folders, each with its project) and `known` (`{id, name}` of each log the machine holds a member of with no folder there). The records, assembled, are the org's projects, and each endpoint hands sminos the hub projects among them as its **directory**, which sminos follows.
- **Listing.** The signed line of one session that the endpoint keeps at the hub (RL6), by the session's id for lane A and by the app's session id for lane B.
- **Capability.** A name each side of RL10 lists (sminos in its hello, the endpoint in its welcome), so that neither sends the other a shape it does not know.
- **Stamped.** A lifecycle event is stamped when its `thread` is a non-empty string.
- **Counted.** Of a `member` frame's `channels`: the entries the endpoint takes (Interfaces §C). Of a projects record at the hub: one that still verifies (Interfaces §F).

## Today, at `77af813a4`

How the parts fit, and what each does today that this work changes or leans on.

- **The endpoint's RL10** (`src/endpoint/rl10/link.ts`). The hello's `capabilities` are kept per connection. The welcome lists `access`, `reach`, `record` while the build serves the record acts, and `locations` only to an sminos whose hello listed it: that is the precedent for a capability pair. A `member` frame goes to `Members.member` (`src/endpoint/rl10/members.ts`), which reads it for the fields the endpoint relies on (`readMember`, which returns the frame itself, unknown fields and all), keeps it by its session id, and reports its listing.
- **`known`** (`src/endpoint/registry.ts`, `#knownNow`). The logs sminos opened without `follow` whose id is among `sminosView().sessionProjects()`, which is each held member's `project` and nothing else. While no sminos is connected, or its restatement after a welcome has not closed, the last answer stands. `OwnProjects` (`src/endpoint/projects.ts`) puts the candidates into the record less the located and the machines' own projects, sorted by id, at most 1,000. Each `member` frame, `restated` and log-plane `hello` makes the record be built again (`onProjects`, `knownMoved`).
- **From `known` to every machine.** `assembleProjects` (`apps/org-protocol/src/projects.ts`) makes a project of every id a verified record names, in `locations` or in `known`. The endpoint's directory hands sminos each as a hub project unless a location says `hub: false`. The app drops a project with no location before it makes rows (`src/main/org/project-registry.ts`). So a log that is only `known` is followed by every machine and has no row in the app: exactly what a channel needs, with nothing to build.
- **A link's target** (`src/services/index/statements.ts`, `Statements.target`). The one place both `session.projects.link` and `session.projects.addFolder`'s `into` pass: the target is a hub project a verified record names, or the id the folder's own `.smns` names. A log that is only `known` is such a project, so a link to a channel's id would be accepted today.
- **A lane change** (`Members.member`). Nothing withdraws the listing the session had under its other lane. From lane A to lane B it stays for good: the restatement after a welcome clears the old listing's id from the set to withdraw, because that id is the session's own. From lane B to lane A it stays until the next restatement.
- **The hub's project table** (`apps/desk-hub/src/objects/registry.ts`). `registerProject` inserts any id a machine says hello for as `kind 'hub'` (the shape check is `PROJECT_ID`, a lowercase UUID of any version, at the Relay's log plane). `retired` is set only for a revoked machine's own project; a retired row is left out of the grid and of live summaries and is still answered at a hello. No `hub` row is ever retired. The table is a Durable Object's SQLite; a column joins a stored table through `ADDED_COLUMNS`; the alarm's `sweep` runs what is due and `scheduleAlarm` sets the next.
- **The hub's projects records** (`apps/desk-hub/src/objects/org-records.ts`). One per machine ref at its highest revision, kept also after the head retires the machine: "every reader verifies it, and refuses it then".
- **The app's reader** (`src/main/org/channel/address.ts`, `projectSessions`). A session is a member from its latest `joined` until any `retired`, read by offset from the session's own writer. It never reads the log whole: the channel hands it the kept lifecycle (`src/main/org/channel/cache.ts`), which holds, per session and provenance, the latest event of each kind, so one `retired`.
- **The web desk** (`apps/desk-web/src/conversation/capabilities.ts`). For a session with no seat, the retire note reads `records it retired; the process stays yours to close`, and the send note of one that is not running reads `recorded, not delivered: a closed terminal session is reopened only by Resume`. A unit test and one Playwright scene pin them.
- **The shared vectors' precedent** (`apps/org-protocol/vectors/project-rule.json`, exported as `PROJECT_RULE`, shape-checked by `apps/org-protocol/test/project-rule.test.ts`). sminos vendors a copy with a pin, written only by its sync script.
- **The RL10 conversation fixture** (`test/endpoint/rl10/conversation.json`). Thirteen cases, run in order on one endpoint by `conversation.local.test.ts` against the hub in Miniflare; three sminos hellos and two welcomes carry capability lists; what happens on the endpoint's side is a `scene`, which sminos's replay skips. That suite's endpoint has no index behind it, so it signs no projects record.

## Where the contract meets the code

Each point is a place where the parent's statement of MW is incomplete or imprecise against the code. Each says how this document stands; the architect reports them to the session holding the parent.

1. **The reader rule is not `projectSessions`' alone.** The contract names `projectSessions`. That function is fed the kept lifecycle, one `retired` per session, the latest by offset (`cache.ts`, `keyOf` and `note`). An unstamped `ended` that the rule passes by would displace an earlier `moved` that the rule honours, and the session would read as a member again. This document puts the rule in both: the reader, and the cache's key (Interfaces §G).
2. **The two sentences do not say what the contract says they say, and the contract gives no new words.** "the web desk's two sentences that say a closed terminal session is reopened only by its human": one says a retire leaves the process to its human, the other that such a session is "reopened only by Resume", the web desk's own verb. This document reads the item as: both sentences state today's model of a session its human opened, and both are made true of a thread under every sminos in the field. The words are Interfaces §H; they are copy, and stand until the architect says otherwise.
3. **"MAWS's hub table" is not every id MAWS holds.** The pre-adoption check names the hub's table. An id in a projects record is any `[A-Za-z0-9._-]{1,64}` (`apps/org-protocol/src/shapes.ts`, `isProjectId`), and a project whose `.smns` names no hub of this org is in the records and never at the hub. The member refusal reaches those too. Step 0 reads the records as well as the table.
4. **"no machine's record" has to mean a record that still verifies.** The hub keeps a retired machine's record. Read literally, a VM that was deleted while it held a member of a channel would keep that channel's row for good. This document counts a record only while `verifyProjectsRecord` accepts it (Interfaces §F), which is how every other reader of the records already treats a retired machine.
5. **The four reader cases can be read two ways.** "then a stamped `ended` is not" follows either the first case or the second. This document takes the first (a stamped `ended` after the unstamped one that was passed by), which is the reading that tests something; each case gives the membership after every event, so the other reading's prefix is covered (Interfaces §B).
6. **"a bounded list" names no bound, and no rule for a thread in no channel.** This document fixes 128 counted entries, and that a member in no declared channel carries no `channels` key, so that such a member's frame is today's with the capability on (Interfaces §C). sminos's child CH consumes both.
7. **A folder takes a project id with no link.** "MAWS refuses to link a folder to a channel id" covers the link acts. A folder whose own `.smns` names an id of version 8 takes that id by derivation, with no act to refuse. After adoption such an id is a channel to every part: its sessions' member frames are refused and its hub row retires. This work adds nothing for it; Step 0 shows none exists.
8. **`maws project list` prints every project the records name,** a location-less one too, and `--into <name>` resolves among them (`src/mawsd/maws-cli.ts`). A channel in `known` is printed there as any such log is today, and a name a project and a channel share is asked for by id, as two projects' is. Left as it is: the contract says no change to listings, and the parent defers the app's view of channels.
9. **The parent says MW's "two thread items are wanted by T1's release"; D6 lists three.** All three are in M1, which lands alone and first (Plan of Work).
10. **A listing can reach the hub before the row it lists.** "making it active again at the next record that lists it" and the seven days both assume the row exists when a record names it. A connection's log-plane frames and its records reach the Registry through separate queues (`apps/desk-hub/src/objects/relay.ts`, `logPlane` and `record`), so a record that lists a channel can be stored before the hello that registers its row. The registration therefore reads the records already held (Interfaces §F, event 1).

## Acceptance

The parent's acceptance sentence, split into items in its own order. A10 is D6's item on the two sentences, which the sentence does not repeat. Every proof is a test that fails before its milestone and passes after. Class 1a is `scripts/ci-gate.sh <worktree> --gates static,unit,probes`; the root `pnpm test` it runs holds the hub's, the web desk's and the protocol package's suites as projects.

| | Item | Proved by | Milestone | Gate |
|---|---|---|---|---|
| A0 | Before the id rule is adopted, MAWS holds no hand-written id of version 8 | Step 0: the records on one machine, and the owner's read of the hub's table | Step 0 | none: a read |
| A1 | With `channels` listed by both sides, a `member` frame's `channels: [<id>]` puts `<id>` in the machine's `known` while that member is held, and removes it when the last such member goes | a new `test/endpoint/rl10/sminos-channels.test.ts` (a real `Rl10` and a scripted sminos on its socket: what the endpoint counts), `test/endpoint/projects-records.test.ts` (`known` over a view), `test/endpoint/projects.local.test.ts` (two endpoints and the hub: the record's `known`, the other machine's directory) | M2 | class 1a |
| A2 | Without the capability on either side, frames and `known` are byte for byte today's | "The mixed fleet". Its oracle is a new `test/endpoint/mixed-fleet.local.test.ts` against `test/endpoint/mixed-fleet-baseline.json`, the frames `77af813a4` sent for the same script (Interfaces §K); beside it the welcome's literal, and the hub's and the app's unchanged cases | M1, M2, M3 | class 1a (the oracle in its `unit` job) |
| A3 | `isChannelId` passes the shared vectors | `apps/org-protocol/test/channel-rule.test.ts` | M1 | class 1a |
| A4 | A link to a channel id is refused | `src/services/index/statements.test.ts`: `link` and `addFolder` `into`, an id a record lists as `known` and one the folder's own `.smns` names | M2 | class 1a |
| A5 | A member whose project is a channel id is refused | `test/endpoint/rl10/members.test.ts` | M2 | class 1a |
| A6 | A channel's row retires after seven days unlisted and is active again when listed | `apps/desk-hub/test/channel-retention.test.ts` | M3 | class 1a |
| A7 | A lane change withdraws the old listing | `test/endpoint/rl10/members.test.ts` | M1 | class 1a |
| A8 | `projectSessions` passes the four shared cases for a `retired` without `thread`, and the fifth of Decision Log 6 | `src/main/org/channel/address.test.ts` (the reader), `src/main/org/channel/cache.test.ts` (the same cases through the kept lifecycle) | M1 | class 1a |
| A9 | The RL10 conversation fixture carries the capability and one case with `channels` | `test/endpoint/rl10/conversation.local.test.ts` on the edited `conversation.json` | M2 | class 1a |
| A10 | The web desk's two sentences are true of a thread | `apps/desk-web/src/conversation/capabilities.test.ts`; `apps/desk-web/e2e/conversation.spec.ts` | M1 | class 1a; `e2e:desk-web` |

## Execution

### Constraints (bind every milestone)

1. **The parent binds.** D6's contract and X5 (the wire) were agreed between the two architects; D3's id, D1's lane B and D7's reader rule are marked binding there. An executor that finds one wrong against the code stops and reports; it does not build around it.
2. **One predicate.** `isChannelId` (Interfaces §A) is the only test of a channel's id in the repository. No second pattern, no test of the version digit beside it. The three `PROJECT_ID` checks (`apps/desk-hub/src/objects/project.ts`, its use in `apps/desk-hub/src/objects/relay.ts`, `src/main/org/channel/channel.ts`) stay as they are: a channel's log is opened, relayed and registered as any id's.
3. **Capabilities, never versions.** Nothing reads an sminos version or a build string. RL10 stays at `{major: 1, minor: 0}`. This work adds nothing to `machine.sock` or to RL2: `WIRE_MINOR` and `src/shared/ipc/wire-manifest.json` do not move, and a diff in either is a reason to stop.
4. **Inert alone.** To an sminos whose hello does not list `channels`, every frame the endpoint sends and every record it signs is what master's endpoint would send and sign for the same input ("The mixed fleet"). Three things are not gated by the capability, by design. The two refusals exist for an sminos without it, and act on no input that exists today (Step 0). The lane change withdraws a listing that is stale today.
5. **The hub declares nothing.** No record of a channel, no new `kind`, no change to a listing, to notify or to a count. No code of this work reads an event of a channel's log.
6. **Lane B is left out** (D1). A lane B member's `channels` count for nothing.
7. **Step 0 gates adoption, not building.** M2 and M3 adopt the id rule. They may be built at once, and the second pull request reaches master only after Step 0 reads zero. M1 adopts nothing: the first pull request does not wait for it.
8. **Where checks run.** On the MacBook an executor runs one test file at a time and eslint on one file at a time. It never runs `pnpm typecheck`, `pnpm lint`, `pnpm test` or a vitest over several files there. The full gates run on GitHub Actions through `scripts/ci-gate.sh`, launched by the controller at each milestone's boundary, never by an executor. Nothing here starts Electron or an engine.
9. **A public repository.** Fixtures, tests and comments use invented ids and names. No version of any software on the owner's machines and no email address is written into a file, a commit or a pull request.
10. **Copy.** Sentence case, no metaphor. The strings a person reads are the ones Interfaces §D and §H fix.

### Step 0 — The pre-adoption check *(the architect and the owner)*

**The question.** Does any project MAWS holds today carry an id that `isChannelId` would call a channel? If one does, M2 would stop holding its sessions and M3 would retire its row seven days after the deploy.

**Two places hold ids, and one read each.**

- *The projects records* hold every id a machine has a folder or a session for, hub project or not. Each endpoint keeps its own record and every other machine's newest verified record in its state directory (`projects.json`, `projects-held.json`), so one enrolled machine that was connected with a complete snapshot answers for the org. Read on one Mac on 2026-11-18: no id of version 8 (Surprises & Discoveries 1). That half is done; "Step 0's commands" has the command to repeat it.
- *The hub's table* also holds ids that no record names any more: a log some machine once said hello for. Nothing on a machine caches it. The app receives the grid on its Registry socket and drops it; the endpoint is never sent it. The one read is `GET /api/projects` as a member, with the owner's Access token. `apps/desk-hub/deploy/README.md` rules that the owner runs production's steps and "an agent never does, not even read-only". So this half is the owner's: one command, under "Step 0's commands", which writes nothing and prints a count.

**Reading the answer.** `0 of version 8`: Step 0 is closed, with the date and the row count recorded in Progress. Anything else: M2 and M3 do not land. The architect sends the session holding the parent the rows (id, kind, name, registered by, created), and the rule waits for that session's answer, as the parent says. M1 is not affected.

**Again at the deploy.** The owner runs the same command once more in the sitting that deploys M3 to production, since a row could be registered between the two.

### Plan of Work

```
Step 0 (the owner's read) ──────────────────────────────────────────┐
                                                                     ▼ gates the second pull request's landing
M1 ──► the first pull request lands on master ──┬──► M2 ──┐
        (sminos's T1 pins the vectors from it)  └──► M3 ──┴──► M4 ──► the second pull request
```

M1 comes first because it produces what M2 and M3 both consume, the predicate and the vectors, and because everything in it is wanted by sminos's T1 and adopts nothing. M2 and M3 touch no file in common (the machine's endpoint and services; the hub) and may be built side by side once M1's review is clean. M4 runs the acceptance on the second pull request's head.

**Two pull requests, and the order binds** (Decision Log 4; the architect's ruling, agreed with the session holding the parent).

- **The first is M1 alone,** with this document, on `mw-channels`. It lands on master by itself, ahead of M2 and M3, whatever their state. sminos's T1 pins `apps/org-protocol/vectors/channel-rule.json` from the master commit that holds it, so nothing of M2 or M3 may ride in that commit's pull request, and the file's content may not change between M1's review and its landing. Step 0 does not gate it.
- **The second carries M2 and M3,** on `mw-channels-2`, a branch the architect opens from a master that holds the first. M2 and M3 may be built before the first lands, on a branch from M1's reviewed head; that branch is merged with master once the first has landed, and is opened as a pull request only then. Step 0 gates its landing.

The cut follows the code and the verification, not the contract's bullets. The lane change sits in M1 though it is the endpoint's, because it is a thread item, is proved by a unit test with no capability in sight, and shares `members.ts` with M2, which then builds on a reviewed file. The two refusals sit together in M2 though one is the endpoint's and one the index's, because they are one rule and one acceptance line.

**Reviews** (Decision Log 1, as Decision Log 4 moves it): each milestone's diff at `doperpowers:reviewer-high` before a milestone that consumes it starts. The first pull request is M1's range and nothing else, so M1's review is its branch review. The second pull request's branch review is M4's.

### M1 — The predicate, the shared vectors, and the readers of a stopped thread

**What exists at its end.** `org-protocol` exports `isChannelId`, and the vector file exists whole at version 1. The app's project chat keeps a thread a member through an unstamped `ended`, whether it reads the events as they arrive or the lifecycle it kept. The endpoint withdraws a session's listing under its old lane when a `member` frame states the other. The web desk's two sentences read as Interfaces §H gives them. Nothing refuses or retires anything yet: `isChannelId` has no caller outside its test.

**What it touches.** `apps/org-protocol/src/` (a new `channel-id.ts`, `index.ts`), `apps/org-protocol/vectors/` (a new `channel-rule.json`, `index.ts`), `apps/org-protocol/test/` (a new `channel-rule.test.ts`). `src/main/org/channel/address.ts` and `cache.ts`, with `address.test.ts` and `cache.test.ts`. `src/endpoint/rl10/members.ts` and a new `test/endpoint/rl10/members.test.ts`. `apps/desk-web/src/conversation/capabilities.ts`, `capabilities.test.ts`, and `apps/desk-web/e2e/conversation.spec.ts`.

**Interfaces.** Produces §A, §B, §E, §G and §H. Consumes from sminos by name alone: the field `thread` and the `reason` of a `retired` (§G).

**Decisions.**
- The vector file is written first, from Interfaces §B, exactly, before either implementation is touched. Its expected values are the parent's. When an implementation disagrees with a vector, the parent is read again and the loser is fixed; the vector alone is never changed.
- The reader rule lives in two places, the reader and the cache's key, for the reason "Where the contract meets the code" 1 gives. The alternative, keeping every `retired` of a session, makes the kept lifecycle grow with every stray `ended` an older sminos writes; three kept events decide membership exactly (§G shows why).
- A lane change is handled as the session leaving and then arriving: `Members.gone` runs first. It is the one path that withdraws a listing, and it also drops what notify keeps, the lane B join and the record read, each of which belongs to the old lane. sminos sends `gone` itself at a lane change from T1 on; after it the endpoint holds no member of that session, so the two never withdraw twice.
- The two sentences are worded to be true under every sminos in the field, since the web desk cannot tell which one a machine runs and nothing may be gated on a version (§H).

**It does not touch** the web desk's projection of a log (`apps/desk-web/src/log/projection.ts`) or its Resume capability; the hub's closing of a session's open questions at any `retired` (`apps/desk-hub/src/protocol/log.ts`); how the app draws a `stopped` session; `ChannelSessionSchema` (no field is added); anything that writes `thread`.

**It proves** A3, A7, A8 and A10, and of A2 the app's half. Red first: the first shared `retired` case through `projectSessions` (today the session is no member after the unstamped `ended`). Beyond the acceptance its tests pin:
- every `ids` entry answers as its `channel` says, the trailing newline included; the file's shape and its version;
- the five shared cases through `projectSessions`, and the same five through a cache that is fed the events one at a time, written to its file and read back;
- a stamped `joined`, an unstamped `moved`, then an unstamped `ended`: no member, read from the kept lifecycle (the displacement the cache's key exists for);
- a stamped `joined`, then an unstamped `joined`, then an unstamped `ended`: no member (the rule reads the latest `joined`);
- an unstamped `retired` with reason `continued`, and one with reason `retire`, after a stamped `joined`: no member;
- a log with no `thread` anywhere reads as it does on master (the existing cases of both suites, unchanged);
- lane A to lane B: the listing under the session's id is withdrawn once, and the session is reported under its app session id once joined; lane B to lane A: the listing under the app session id is withdrawn unless another held member still reports under it; a frame that keeps the lane withdraws nothing; a `gone` followed by the other lane's frame withdraws once;
- the two sentences, in the unit test and in the Playwright scene.

**Its landing** (the controller and the architect; Concrete Steps 6). M1 is the whole of the first pull request. Its gates are class 1a and `e2e:desk-web` on its head; its review at `doperpowers:reviewer-high` is the pull request's review. Once it is on master, the architect gives the session holding the parent the master commit that holds `channel-rule.json` and the file's version, and records both in Progress. From then a change to the file is a change under §B's sync rule.

### M2 — Channels at the endpoint: the capability pair, `channels` into `known`, the two refusals

**What exists at its end.** An sminos whose hello lists `channels` is welcomed with `channels`. From then each lane A member's counted `channels` are logs the machine holds a member of, so a channel whose log sminos opened without `follow` is `known` in the machine's projects record while such a member is held, reaches every machine's directory through the records, and leaves when the last such member goes. A link to a channel's id is refused `channel-id`. A `member` frame whose project is a channel's id leaves that session not held. The fixture carries the capability and the channel case. To an sminos that did not list `channels`, every frame and the record are master's.

**What it touches.** `src/endpoint/rl10/link.ts` and `members.ts`; `src/endpoint/registry.ts` (the words on `SminosView` and `known`); `src/services/index/statements.ts`; `src/shared/ipc/schema/session.ts` (`PROJECT_REFUSALS`). `test/endpoint/rl10/conversation.json`, `conversation.local.test.ts`, `members.test.ts` and a new `sminos-channels.test.ts` (a real `Rl10` with the scripted sminos on its socket and no hub, as `reach.test.ts` builds one); `test/endpoint/projects-records.test.ts`, `test/endpoint/projects.local.test.ts`; `src/services/index/statements.test.ts`. The baseline: a new `test/endpoint/mixed-fleet.local.test.ts`, its `test/endpoint/mixed-fleet-baseline.json`, and one line in `vitest.config.ts` (the suite joins `TIMING_NODE_TESTS`, where the other suites against the hub in Miniflare are).

**Interfaces.** Produces §C, §D, §I and §K. Consumes §A and §B.

**Decisions.**
- The welcome lists `channels` only in answer to a hello that lists it, as it does `locations`. A welcome that listed it to everyone would differ from master's for an older sminos.
- `readMember` does not check `channels`. A member frame carries what authorization reads, and a malformed optional list must not cost a session its record; and without the capability nothing about the field may matter. What counts is decided in one function, read from one place (§C).
- An entry that is not a channel's id does not count. Otherwise `channels` would be a way to make a project `known` on a machine that holds no session of it.
- The member refusal is "not held", by `Members.gone`, with a log line. The alternative, ignoring the frame and keeping the record held before it, would leave authorization reading owners and shares the session no longer states. It is not gated by the capability: the sminos that can send such a frame is one from before channels.
- The link refusal is the first check of `Statements.target`, before the registry or the folder's `.smns` is read, so it holds for both link routes and for the "follow the file" link. Its code is new, `channel-id`: `unknown-project` would be false (a record does name the id) and `not-a-hub-project` too (its log is on the hub).
- Nothing new carries a change of `channels` to the record. Every `member` frame already tells the registry that the held logs may have moved.
- While sminos is away or restating, the last answer for `known` stands, for a channel as for a project.
- The record's bound of 1,000 `known` entries is unchanged and shared by projects and channels.
- "Byte for byte today's" is proved against today, not against this build (Decision Log 3). The baseline is written before any line of M2: the suite's file is added first, the frames are captured from `77af813a4` with it, and only then is the endpoint changed. On an unchanged endpoint the suite is green; what shows that it can fail is §K's own cases, which alter a transcript and must be refused. The alternative, running the script against a second checkout inside the gate, was not taken: the unit job has one tree, and a committed transcript with a capture that anyone can repeat is the same evidence.
- The baseline outlives this work, on purpose: it is the endpoint's frames for an sminos without `channels`. §K says what happens when another change means to move one.

**It does not touch** `src/endpoint/hub-link.ts`; the log plane; the three `PROJECT_ID` checks; `pending`, `session` and presence frames that name a channel's id (sminos's CH proves it sends none; the endpoint polices none); a folder whose `.smns` names a channel's id; `maws` (`project list`, `--into <name>`); the app's rows; listings and notify; `WIRE_MINOR`.

**It proves** A1, A4, A5 and A9, and of A2 the endpoint's half. Red first, in `sminos-channels.test.ts`: after a hello that lists `channels` and a lane A `member` frame that states a channel, `sminosView().sessionProjects()` holds the channel's id (today it holds the project alone). Its tests pin:
- the welcome: `['access', 'reach', 'record', 'locations', 'channels']` to a hello that lists `locations` and `channels`; master's list to one that lists `locations` alone; `channels` after `record` to one that lists `channels` without `locations`;
- `known` gains the channel at the `member` frame and loses it when: the member's next frame carries no `channels`; the member is `gone`; a restatement leaves the member out; and keeps it while a second member still states it;
- `known` does not gain: a channel whose log was opened with `follow`; a channel stated by a lane B member; an entry that is a project's id; an entry past the 128th; anything when `channels` is not an array;
- with the capability absent, the same frames give master's `known` and master's frames ("The mixed fleet", rows 1 to 3): the two variants of §K's script each equal the baseline captured from `77af813a4`, and equal each other;
- the baseline suite is not vacuous: with a field added to a frame down, a field added to a record's body up, a `known` entry altered, the channel's id added to `known`, or a frame dropped, its comparison fails and names the kind;
- the baseline captured twice from `77af813a4` is byte for byte one file;
- across the hub: the record at the hub lists `{id, name}` of the channel under `known`, the second endpoint's directory hands its sminos the channel as a hub project, and both go when the member does;
- a `member` frame whose project is a channel's id: a session not held before stays not held, with no listing; a session held under a project is withdrawn as `gone` withdraws it; the same with and without the capability;
- `link` and `addFolder` with `into` naming a channel's id are refused `channel-id`, the statement unchanged, when a record lists the id as `known` and when the folder's own `.smns` names it;
- the conversation replays whole on the edited fixture.

### M3 — The hub retires an unlisted channel's row and brings it back

**What exists at its end.** A channel's row that no counted record has listed as `known` for seven days is retired: it leaves the grid, `GET /api/projects` shows it retired, and its log still answers. The next stored record that lists it makes it active again, on the grid. A row whose id is not a channel's is never touched.

**What it touches.** `apps/desk-hub/src/objects/registry.ts`, and `apps/desk-hub/src/objects/org-records.ts` for two reads (for a pass, the held records that count, with their machines and revisions; for a registration, whether any held record's `known` names an id). The suite's seams: `apps/desk-hub/test/support/worker-under-test.ts`, `apps/desk-hub/test/support/local.ts`, and `apps/desk-hub/test/support/send-fault.ts`, which names the `/__test/` paths. A new `apps/desk-hub/test/channel-retention.test.ts`.

**Interfaces.** Produces §F. Consumes §A.

**Decisions.**
- A row carries the time since which it has been unlisted, in a column (`unlisted`), not in memory: the object is evicted and reset, and a suite moves a stored time back as it does a machine's `seen`.
- A record counts only while it verifies under the head and certificates as they stand. A retired machine's record lists nothing ("Where the contract meets the code" 4).
- Registration reconciles with the records the hub already holds, in the insert's own synchronous step (§F, event 1; Decision Log 2). A listing record can be stored before the row exists ("Where the contract meets the code" 10). A row that started its clock at the insert regardless would be retired seven days after its registration, however recently it stopped being listed. The read checks no signature, which is what lets it be synchronous, so nothing is left to run after the insert and nothing has to be scheduled durably. Its one imprecision keeps a row, never retires one: a held record that no longer counts makes the row read as listed until the next pass, a day at most. The alternative, an asynchronous pass owed in storage and run by the alarm, is exact a moment later and adds a column, an alarm source and a retry to be right about.
- The listing is evaluated in a *pass* (§F), at each record the hub accepts and at each sweep, and at least daily while an active channel's row is listed. A certificate that expires stops its record counting with no event; the daily pass starts the clock within a day. Lateness of a day in a seven-day rule costs a row one more day on the grid. The alternative, a call site for every way a record can stop counting, misses the ones that are only the passage of time.
- A pass runs before `storeProjects` answers, not beside it. A pass left running after the answer can be lost to the object's reset, and a retired row waiting on it would stay retired with nothing scheduled to look again.
- The pass's listing is tied to the records held at the moment it applies (§F, Order). Without that, a pass that began before a listing record arrived could retire the row the record had just listed, and the grid would lose and regain it.
- A hello does not make a retired channel's row active; only a record that lists it does. `registerProject` keeps answering a retired row as held, as it does today. The parent's words are "active again at the next record that lists it".
- Retention is all inside the Registry object, so one deploy's skew between objects does not reach it. `unlisted` is not among the columns a `ProjectRecord` is read from: `GET /api/projects` and the grid's frames carry what they carry today.
- A reactivated row returns to the grid by the steps `registerProject` takes for a new one (`seedProject`, then a `summary`). Seeding is safe whether or not the row was announced the states accepted while it was retired, since an announcement only ever moves forward.

**It does not touch** the Relay or the Project objects; the log plane; how a record is stored, verified or pushed; a machine's own project and its retirement; the web desk.

**It proves** A6, and of A2 the hub's half. Red first: a channel's row registered by a hello and never listed is retired once its `unlisted` is seven days old (today nothing retires it). Its tests pin:
- never listed, and no held record names it when it is registered: `unlisted` is the registration's time; retired at seven days and not at six days and twenty-three hours; the grid comes again whole without it; `GET /api/projects` shows `retired: true`; a hello of its log is still answered and its events are still there;
- **the listing stored before the row is registered** (Decision Log 2), in this order and with nothing else between the steps: (1) a machine's record that lists the channel as `known` is stored while the table holds no row of it; (2) the alarm is cleared through the suite's seam and the row is registered by a hello of its log; straight after the hello's answer, with no record stored since and before any alarm the registration set can fire, its `unlisted` reads null, so it was the registration that read the records and no pass; (3) that machine's next record leaves the channel out, and `unlisted` then reads a time no earlier than that store was sent, which is later than the registration's; (4) with `unlisted` moved back six days and twenty-three hours the sweep leaves the row active, and moved back seven days it retires it. Seven full days run from the removal, not from the registration;
- a record of a machine the head has since retired names the id when the row is registered: `unlisted` reads null, and the next pass sets it to that pass's time;
- listed, then left out of that machine's next record: the clock starts at that store;
- listed by two machines: the clock starts when the second leaves it out;
- listed for as long as it is listed: no retirement, and the alarm is set no later than a day ahead;
- retired, then listed: active, a `summary` of it on a grid socket, `unlisted` cleared;
- retired, then a hello alone: still retired;
- the record of a machine the head has retired stops counting at the next pass;
- two records stored one after the other end with the listing the later one gives; a record sent again unchanged runs a pass;
- a deadline that has passed, with the head unreadable: the alarm is set no sooner than the retry wait;
- a `hub` row whose id is of version 4, never listed, thirty days on: active, `unlisted` null, and the alarm has no deadline from it; a machine's own project: untouched;
- a table stored before the column opens, and its rows read as never unlisted.

### M4 — The second pull request's acceptance, its review, and what is handed to sminos *(the controller and the architect)*

**What exists at its end.** With the first pull request on master, the head of `mw-channels-2` is green on the gates "Acceptance" names, reviewed, and ready to land once Step 0 is closed. sminos's CH has what it copies; T1 had its part when the first landed.

**Work.** Concrete Steps 7, in order. No executor is dispatched for it unless the branch review returns findings, which go to a fix wave.

**It does not touch** production. The hub's part reaches staging through `apps/desk-hub/deploy/staging-deploy.sh`, by the architect's dispatch, and production at the owner's next production deploy. The endpoint's and the app's parts reach a machine at its next swap. Until both, and until sminos lists `channels`, nothing runs.

**It proves** A0 to A10 as "Acceptance" lists them, on one tree: the items M1 proved (A3, A7, A8, A10) are run again there, since the tree holds them.

### The mixed fleet

The parent's item: "without the capability on either side, frames and `known` are byte for byte what they are today". Each row is one way a side can lack it, and the test that shows it.

| | The fleet | What must be master's | How a test shows it |
|---|---|---|---|
| 1 | sminos without `channels`, this endpoint: the welcome | the welcome frame | `test/endpoint/record-acts.test.ts` and `test/endpoint/rl10/reach.test.ts` already assert the welcome's capabilities as literals for hellos that list neither; they pass unchanged. `sminos-channels.test.ts` adds the literal for a hello that lists `locations` alone, `['access', 'reach', 'record', 'locations']`, which is the fixture's welcome on master |
| 2 | sminos without `channels`, this endpoint: everything, against master itself | every frame down to sminos, every frame up to the hub, the signed record's `locations` and `known` | **The baseline oracle** (§K), `test/endpoint/mixed-fleet.local.test.ts`: one scripted session lane is run against this build's endpoint, and its normalized transcript must equal `test/endpoint/mixed-fleet-baseline.json`, the transcript `77af813a4`'s endpoint gave for the same script, captured by running the same file there. Both variants are held to it: member frames without `channels`, and with them. A field this build added to any frame, for whatever reason, is a difference from master and fails; the suite's own cases show the comparison refuses an added field in each direction and an altered `known`. Gate: class 1a, the `unit` job |
| 3 | the same fleet: the field alone | nothing may follow from `member.channels` | **The field isolation**, in the same file: this build's transcript with `channels` on the member frames equals its transcript without. It compares this build with itself, so it shows only that the field is inert; that either transcript is master's is row 2's to show |
| 4 | this sminos, an endpoint from before this work | nothing of this work runs there | That endpoint is master. Its welcome lists no `channels`, so an sminos that keeps X5 sends none; that is sminos's proof, in CH. If one arrived all the same, master's `readMember` passes an unknown field by |
| 5 | this endpoint, a hub from before M3 | the record is stored and pushed as any record | No test: that hub is master's, and a `known` entry whose id is a channel's is an entry like another to it. The row is never retired there |
| 6 | a hub with M3, machines from before this work | the grid, `GET /api/projects`, the alarm | `channel-retention.test.ts`: with rows of version 4 and 5 only, records that list and stop listing them as `known`, and thirty days gone by, every grid frame and the directory are what they were, no row's `unlisted` is set, and the alarm has gained no deadline |
| 7 | the app with M1, an sminos from before T1 | who is a member | The existing cases of `address.test.ts` and `cache.test.ts` pass unchanged, and the fourth shared case (an unstamped `joined`, an unstamped `ended`: no member) is master's answer |

The first thirteen cases of the conversation fixture change in five lists and nowhere else (§I): with the capability on, a member in no channel sends master's frame and gets master's answers.

### Concrete Steps

Commands run from the worktree's top unless a step says otherwise.

1. **Base,** before each milestone and before the hand-back. Merge, never rebase, never force-push:

       git fetch origin master && git merge origin/master
       git grep -n "sessionProjects" origin/master -- src/endpoint/rl10/link.ts src/endpoint/registry.ts
       git grep -n "private async target" origin/master -- src/services/index/statements.ts
       git grep -n "registerProject(id: string" origin/master -- apps/desk-hub/src/objects/registry.ts
       git grep -n "export function projectSessions" origin/master -- src/main/org/channel/address.ts

   Each grep must answer. One that does not means master moved what "Today" describes: stop and report.

2. **Dependencies.** The worktree holds no `node_modules` at authoring. Once: `pnpm install --frozen-lockfile`. This work changes no `package.json` and no lockfile.

3. **One file at a time,** on the MacBook. Red before the change, green after:

       pnpm exec vitest run apps/org-protocol/test/channel-rule.test.ts         # M1
       pnpm exec vitest run src/main/org/channel/address.test.ts                # M1
       pnpm exec vitest run src/main/org/channel/cache.test.ts                  # M1
       pnpm exec vitest run test/endpoint/rl10/members.test.ts                  # M1, M2
       pnpm exec vitest run apps/desk-web/src/conversation/capabilities.test.ts # M1
       pnpm exec vitest run test/endpoint/rl10/sminos-channels.test.ts          # M2
       pnpm exec vitest run test/endpoint/projects-records.test.ts              # M2
       pnpm exec vitest run src/services/index/statements.test.ts               # M2
       pnpm exec vitest run test/endpoint/projects.local.test.ts                # M2 (starts the hub in Miniflare)
       pnpm exec vitest run test/endpoint/rl10/conversation.local.test.ts       # M2 (the same)
       pnpm exec vitest run test/endpoint/mixed-fleet.local.test.ts             # M2 (the same; the baseline oracle)
       pnpm exec vitest run apps/desk-hub/test/channel-retention.test.ts        # M3 (the same)
       pnpm exec eslint <one changed file>

   Expect ` Test Files  1 passed (1)` for green and a ` FAIL ` line naming the new case for red. The four suites that start Miniflare are slow on a loaded Mac; a case that times out there is run alone once before it counts, and if the Mac cannot settle it, the executor reports the file as not run and the controller reads it from step 4's iteration run.

4. **The gates** (the controller, after each milestone's push; never an executor):

       scripts/ci-gate.sh "$PWD" --gates unit --affected --label mw-channels          # an iteration run: never landing evidence
       scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label mw-channels       # class 1a, at each milestone's boundary
       scripts/ci-gate.sh "$PWD" --gates e2e:desk-web --label mw-channels             # M1, for the pinned sentence

   The last line of each is `ci-gate: run <id> success`. A red job's report is under `/tmp/maws-review/gates/`.

5. **Step 0.** Its two commands are under "Step 0's commands", after this list. Expect `<n> ids; 0 of version 8` from the first and `<n> rows; 0 of version 8` from the second.

6. **The first pull request** (M1's landing), on the head of `mw-channels` after step 1:

       scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:desk-web --label mw-channels
       git diff --stat origin/master...HEAD | tail -1
       git diff --name-only origin/master...HEAD -- src/endpoint/rl10/link.ts src/services apps/desk-hub test/endpoint/rl10/conversation.json   # prints nothing: nothing of M2 or M3
       git diff origin/master...HEAD -- src/shared/ipc/wire.ts src/shared/ipc/wire-manifest.json                                              # prints nothing

   Then: M1's review at `doperpowers:reviewer-high` on the whole range, a fix wave for what it finds and the gates again on the new head; the pull request, which names its class 1a run and its `e2e:desk-web` run; and, once it is on master, the master commit that holds `apps/org-protocol/vectors/channel-rule.json` and the file's version, given to the session holding the parent and written into Progress.

7. **The second pull request's acceptance** (M4), on the head of `mw-channels-2` after step 1, with the first pull request on master:

       scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:desk-web --label mw-channels-2
       git diff --stat origin/master...HEAD | tail -1
       git diff origin/master...HEAD -- src/shared/ipc/wire.ts src/shared/ipc/wire-manifest.json src/endpoint/hub-link.ts   # prints nothing
       git diff origin/master...HEAD -- test/endpoint/rl10/conversation.json                                               # §I's edits and no other
       git diff origin/master...HEAD -- apps/org-protocol/vectors/channel-rule.json                                         # prints nothing: T1 pinned it
       git grep -n "8\[0-9a-f\]{3}" -- src apps ':!apps/org-protocol/src/channel-id.ts'                                     # prints nothing: one predicate

   Then, in order: the baseline captured once more ("The baseline's capture", below), after which `git diff --exit-code -- test/endpoint/mixed-fleet-baseline.json` prints nothing; the branch review (Decision Log 1 as Decision Log 4 moves it), with a fix wave for what it finds and the gates again on the new head; Step 0's state read from Progress; the staging deploy of the merged master and one read of its `X-Desk-Build`; the hand-off of Interfaces §J to the session holding the parent, with the master commit that holds the fixture.

8. **Hand back** (an executor, at its milestone's end) with: the head's sha; each command of step 3 it ran with its result; what it did not run; every decision it made beyond this document; anything that contradicts "Today".

#### The baseline's capture

M2's executor, once, before the endpoint is touched, and the controller once more in step 7. It runs one test file, in a second worktree at `77af813a4`, beside this one. Nothing but that file is copied there.

```sh
OUT="$PWD/test/endpoint/mixed-fleet-baseline.json"
git worktree add --detach ../mw-baseline 77af813a4a4a642d747f7511a343448db489a9ab
cp test/endpoint/mixed-fleet.local.test.ts ../mw-baseline/test/endpoint/
(cd ../mw-baseline && pnpm install --frozen-lockfile)
(cd ../mw-baseline && MAWS_MIXED_FLEET_CAPTURE="$OUT" pnpm exec vitest run test/endpoint/mixed-fleet.local.test.ts --testTimeout 60000 --hookTimeout 120000)
cp "$OUT" /tmp/mixed-fleet-first.json
(cd ../mw-baseline && MAWS_MIXED_FLEET_CAPTURE="$OUT" pnpm exec vitest run test/endpoint/mixed-fleet.local.test.ts --testTimeout 60000 --hookTimeout 120000)
cmp "$OUT" /tmp/mixed-fleet-first.json
git worktree remove --force ../mw-baseline
```

`cmp` prints nothing: two captures are one file. The two timeouts are given on the command line because at `77af813a4` the file is in no list of slow suites. If `cmp` answers, something in a frame varies that §K's rules do not cover: the rules or the script are fixed first, and nothing of the endpoint is changed until two captures agree.

#### Step 0's commands

The records half, on any enrolled machine: a read of two files. `STATE` is the endpoint's state directory, `<userData>/mawsd/endpoint` on a Mac the app runs on.

```sh
python3 - "$STATE/projects.json" "$STATE/projects-held.json" <<'EOF'
import json, re, sys
V8 = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
ids = set()
def walk(v):
    if isinstance(v, dict):
        if isinstance(v.get("locations"), list) and isinstance(v.get("known"), list):
            ids.update(e.get("id", "") for e in v["locations"] + v["known"] if isinstance(e, dict))
        for x in v.values(): walk(x)
    elif isinstance(v, list):
        for x in v: walk(x)
for path in sys.argv[1:]: walk(json.load(open(path)))
hits = sorted(i for i in ids if V8.fullmatch(i))
print(len(ids), "ids;", len(hits), "of version 8"); print("\n".join(hits))
EOF
```

The hub's half, **the owner's command**, from the worktree's top. It sends one GET to production and writes nothing; the token is never an argument and is never printed. The owner needs a `cloudflared access login` of the production host, as for every production run. No agent runs it.

```sh
cd apps/desk-hub
HOST="$(node -p "require('./deploy/config.json').host")"
cloudflared access token -app="https://$HOST" | sed 's/^/cf-access-token: /' \
  | curl -fsS -H @- "https://$HOST/api/projects" | python3 -c '
import json, re, sys
V8 = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
rows = json.load(sys.stdin)["projects"]
hits = [p for p in rows if V8.fullmatch(p["id"])]
print(len(rows), "rows;", len(hits), "of version 8")
for p in hits: print(p["id"], p["kind"], p["name"], p["registered_by"], p["created"])'
```

### Interfaces and Dependencies

#### §A. The predicate (`apps/org-protocol/src/channel-id.ts`; M1)

    /** A sminos declared channel's id: a lowercase UUID whose version digit is 8 and whose variant digit is 8, 9, a or b. */
    export const CHANNEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    export function isChannelId(value: unknown): value is string;

The string is tested as given: not trimmed, not folded. Anything that is not a string is no channel's id. Exported from the package's index. Its callers once both pull requests have landed, and no others: `memberChannels` and `Members.member` (§C, §D), `Statements.target` (§D), the hub's pass and its registration of a row (§F).

#### §B. The shared vectors and their sync rule (`apps/org-protocol/vectors/channel-rule.json`; M1)

One file, beside `project-rule.json`, exported from `apps/org-protocol/vectors/index.ts` as `CHANNEL_RULE` with its type. Its content at version 1, exactly:

    {
      "about": "sminos's declared channels and threads as MAWS and sminos both read them (the design: the doperpowers repository, docs/doperpowers/specs/2026-11-17-sminos-channels-and-threads-design.md, D3's id and D7's reader rule; its contracts X4 and X7). `ids`: `id` is a declared channel's id exactly when `channel` is true; the string is tested as written, never trimmed and never folded to lower case. `retired`: each case is one session's own lifecycle events in log order, and each step says whether the session is a member of the project once its event is read. An event shows only what the rule reads (`kind`, `reason`, `thread`); a harness adds what its implementation needs to take the events as one session's, from that session's own writer, authenticated. An event is stamped when its `thread` is a non-empty string. The file changes only by the sync rule of MAWS docs/doperpowers/plans/2026-11-18-mw-sminos-channels.md, Interfaces §B.",
      "version": 1,
      "ids": [
        {"id": "5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c", "channel": true, "why": "version 8, variant 9"},
        {"id": "00000000-0000-8000-8000-000000000000", "channel": true, "why": "version 8, variant 8, every other digit zero"},
        {"id": "0123abcd-4567-8abc-a123-456789abcdef", "channel": true, "why": "version 8, variant a"},
        {"id": "ffffffff-ffff-8fff-bfff-ffffffffffff", "channel": true, "why": "version 8, variant b, every other digit f"},
        {"id": "7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d", "channel": false, "why": "version 4: a minted project id"},
        {"id": "2ed02f3c-5d7b-5e0a-9b1f-6a4c8d2e0f13", "channel": false, "why": "version 5: a project id derived from a remote or a machine's name"},
        {"id": "c232ab00-9414-11ec-b3c8-9f6bdeced846", "channel": false, "why": "version 1"},
        {"id": "018f4d2a-6b3c-7e1d-8a9b-0c1d2e3f4a5b", "channel": false, "why": "version 7"},
        {"id": "5c2a9e10-8b3d-4f41-9a6c-2d4e6f8a0b1c", "channel": false, "why": "version 4 with an 8 opening the second group: the version is the third group's first digit"},
        {"id": "5c2a9e10-7b3d-8f41-7a6c-2d4e6f8a0b1c", "channel": false, "why": "version 8, variant digit 7: not RFC 9562's variant"},
        {"id": "5c2a9e10-7b3d-8f41-0a6c-2d4e6f8a0b1c", "channel": false, "why": "version 8, variant digit 0"},
        {"id": "5c2a9e10-7b3d-8f41-ca6c-2d4e6f8a0b1c", "channel": false, "why": "version 8, variant digit c"},
        {"id": "5c2a9e10-7b3d-8f41-fa6c-2d4e6f8a0b1c", "channel": false, "why": "version 8, variant digit f"},
        {"id": "00000000-0000-0000-0000-000000000000", "channel": false, "why": "the nil UUID"},
        {"id": "ffffffff-ffff-ffff-ffff-ffffffffffff", "channel": false, "why": "the max UUID"},
        {"id": "5C2A9E10-7B3D-8F41-9A6C-2D4E6F8A0B1C", "channel": false, "why": "upper case: an id is lower case, and is never folded before the test"},
        {"id": "5c2a9e10-7b3d-8F41-9a6c-2d4e6f8a0b1c", "channel": false, "why": "one upper-case digit"},
        {"id": "5c2a9e107b3d8f419a6c2d4e6f8a0b1c", "channel": false, "why": "no hyphens"},
        {"id": "{5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c}", "channel": false, "why": "braces"},
        {"id": "urn:uuid:5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c", "channel": false, "why": "a URN"},
        {"id": "5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c\n", "channel": false, "why": "a trailing newline: the whole string is the id (a pattern's `$` must not pass it)"},
        {"id": " 5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c", "channel": false, "why": "a leading space"},
        {"id": "5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c ", "channel": false, "why": "a trailing space"},
        {"id": "5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1", "channel": false, "why": "one digit short"},
        {"id": "5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c0", "channel": false, "why": "one digit long"},
        {"id": "5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1g", "channel": false, "why": "a digit that is not hexadecimal"},
        {"id": "５c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c", "channel": false, "why": "a full-width digit: ASCII digits alone count"},
        {"id": "desk-integration", "channel": false, "why": "a name"},
        {"id": "", "channel": false, "why": "the empty string"}
      ],
      "retired": [
        { "name": "a stamped joined, then an unstamped ended: still a member",
          "steps": [
            {"event": {"kind": "joined", "thread": "11111111-1111-4111-8111-111111111111"}, "member": true},
            {"event": {"kind": "retired", "reason": "ended"}, "member": true}
          ] },
        { "name": "then an unstamped moved: a member no more",
          "steps": [
            {"event": {"kind": "joined", "thread": "11111111-1111-4111-8111-111111111111"}, "member": true},
            {"event": {"kind": "retired", "reason": "ended"}, "member": true},
            {"event": {"kind": "retired", "reason": "moved"}, "member": false}
          ] },
        { "name": "a stamped ended after the unstamped one: a member no more",
          "steps": [
            {"event": {"kind": "joined", "thread": "11111111-1111-4111-8111-111111111111"}, "member": true},
            {"event": {"kind": "retired", "reason": "ended"}, "member": true},
            {"event": {"kind": "retired", "reason": "ended", "thread": "11111111-1111-4111-8111-111111111111"}, "member": false}
          ] },
        { "name": "an unstamped joined, then an unstamped ended: a member no more",
          "steps": [
            {"event": {"kind": "joined"}, "member": true},
            {"event": {"kind": "retired", "reason": "ended"}, "member": false}
          ] },
        { "name": "a stamped joined, then an unstamped moved, then an unstamped ended: a member no more",
          "steps": [
            {"event": {"kind": "joined", "thread": "11111111-1111-4111-8111-111111111111"}, "member": true},
            {"event": {"kind": "retired", "reason": "moved"}, "member": false},
            {"event": {"kind": "retired", "reason": "ended"}, "member": false}
          ] }
      ]
    }

`apps/org-protocol/test/channel-rule.test.ts` checks the file's shape (these keys and no others, `version` a positive integer, at least one `ids` entry of each answer, every step's `event.kind` one of `joined` and `retired`) and runs `ids` through `isChannelId`. The `retired` cases are run by `address.test.ts` and `cache.test.ts`, whose harness gives every event of a case one session, that session's own writer, rising offsets and a verdict that authenticates it.

The first four cases are the parent's four clauses, in its order; the second and the third each continue the first. The fifth follows from D7 alone (an honoured `moved`, then an unstamped `ended` the rule passes by) and is there for a reader that keeps one `retired` per session, as MAWS's cache did before §G: such a reader lets the `ended` displace the `moved` and reads a member again, and the parent's four cases cannot show it, since none puts an honoured `retired` before an unstamped one (Decision Log 6). Each step's `member` covers every prefix.

**The sync rule** is `project-rule.json`'s (the project registry's execution document, Interfaces §B), for this file:
- a change is a MAWS pull request that raises `version`, with MAWS's tests green on it, reviewed by the architect and by the session holding the parent;
- sminos holds a copy and a pin beside it, written only by its sync script, and a sminos test fails when the copy's hash is not the pin's. Adding this file to that script is sminos's change, in T1 (the `retired` cases) or CH (the ids), whichever lands first;
- neither side edits the vectors alone.

#### §C. RL10: the capability pair and `member.channels` (M2)

- **The name.** `CHANNELS_CAPABILITY = 'channels'`, in `src/endpoint/rl10/link.ts` beside `RECORD_CAPABILITY`.
- **The pair.** sminos lists it in its hello's `capabilities`. The endpoint's welcome lists it, last, exactly when the hello of that connection listed it. With `locations` too the welcome's list is `['access', 'reach', 'record', 'locations', 'channels']`.
- **The field.** A `member` frame may carry `channels`: the ids of the declared channels the session's thread is in. A member in none carries no `channels` key. `Member` gains `channels?: unknown`; `readMember` neither requires nor checks it.
- **What counts** (`src/endpoint/rl10/members.ts`):

      export const MEMBER_CHANNELS_MAX = 128;
      /** The declared channels a member frame states, as the endpoint counts them. */
      export function memberChannels(member: Member): string[];

  Nothing when `channels` is not an array. Otherwise its entries that pass `isChannelId`, each once, in the frame's order, the first `MEMBER_CHANNELS_MAX` of them. 128 guards the endpoint and is far past any use the parent describes; it keeps the list under five kilobytes of a frame.
- **The one reader.** `Rl10.sminosView().sessionProjects()` answers the logs this machine holds a member of: each held session's `project`, and, when this connection's hello listed `channels`, `memberChannels` of each held lane A member. `memberChannels` is called from there and from nowhere else in `src/`. `SminosView.sessionProjects`'s words in `src/endpoint/registry.ts` say so. `#knownNow` is not changed: a channel is `known` by the rule a project is, a log opened without `follow` that is among those ids.
- **What is dropped is dropped quietly.** sminos knows its own ids and the bound (§J); a log line per frame would repeat at every restatement.

#### §D. The two refusals (M2)

- **A link.** `Statements.target` (`src/services/index/statements.ts`) opens with: an `into` that passes `isChannelId` is refused. The code is `channel-id`, added to `PROJECT_REFUSALS` (`src/shared/ipc/schema/session.ts`); the refusal is `invalid_input` as the others are, and its message, which the page and `maws` both show as written, is

      channel-id: <id> is a sminos channel, not a project: a folder is linked to a project

  A code an older page or `maws` does not know is shown by its message, so nothing else changes for them.
- **A member.** `Members.member` (`src/endpoint/rl10/members.ts`), after `readMember`: a frame whose `project` passes `isChannelId` is logged and the session is handled as `gone`. The frame is not kept, restates nothing, and reports no listing. The log line names the session's first eight characters and says that a channel is no project. A lane B frame so refused is still a record seen, for the hand-off from its spawner (Decision Log 13): before anything is awaited its engine session is marked handed off and authorization is told, then its app session is found as the join finds one (the engine host's live rows, else the spawn's proof) and marked, and only then does `gone` run. A member already joined keeps its app session's mark.

#### §E. A lane change (M1)

`Members.member`: when the session is held and the frame's `lane` is not the held one, `gone(session)` runs first, and the frame is then taken as that session's first. Nothing else is added: the withdrawal, what notify forgets, the join and the record read are `gone`'s.

#### §F. The hub's retention (`apps/desk-hub/src/objects/registry.ts`; M3)

**Names.**

    /** How long a channel's row stays on the grid with no counted record listing it as known. */
    export const CHANNEL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
    /** The longest a listed channel's row goes without a pass. */
    export const CHANNEL_RECHECK_MS = 24 * 60 * 60 * 1000;

**State.** `projects.unlisted TEXT`, added through `ADDED_COLUMNS`: the ISO time since which no counted record has listed the row; null while one does, on every row that is not a channel's, and, from a registration to the next pass, on a row a held record names (event 1). It is not read into a `ProjectRecord`.

**Terms.** A *channel's row* is a row of `projects` whose `kind` is `hub` and whose id passes `isChannelId`. A record *counts* when it is the record held for its machine and `verifyProjectsRecord` accepts it under the head and certificates as they stand. A channel's row is *listed* when a counted record's `known` names its id.

**Events.**
1. A channel's row is inserted by `registerProject`. In the insert's own synchronous step the held projects records are read, counted or not: when the `known` of one names the id, the row is inserted with `unlisted` null, and when none does, with the insert's time. This is the registration's reconciliation, and it is needed because a listing record can be stored before the row exists: a connection's log-plane frames and its records reach the Registry through separate queues (`apps/desk-hub/src/objects/relay.ts`, `logPlane` and `record`), and a pass that meets no row does nothing. No signature is checked in that step. A held record was verified when it was stored; one that has stopped counting since makes the row read as listed until the next pass, which the alarm brings within `CHANNEL_RECHECK_MS`, and that pass starts the clock. So the step can keep a row a day longer and can never start a listed row's clock. No pass is run or owed after the insert. The alarm is then scheduled as `seedProject` schedules it today; the row is what is durable, and every later `scheduleAlarm` derives the same deadline from it, so one lost with a reset is set again by the next and the row is late, never early.
2. `storeProjects` accepts a record, whether it stores it or holds the same bytes already. In the store's own synchronous step, the record just verified applies the table's "Listed" column to the channel rows its `known` names: a clock is cleared, a retired row is made active (and returns to the grid before the answer). That side can only keep or bring back a row, never retire one, so it needs no pass's ordering; it makes a listing durable at its acceptance, whatever becomes of the pass after it (Decision Log 14). The alarm is then armed for what the store owes, and a pass runs once before the answer. The same bytes again count because an endpoint sends its kept record again at each welcome, which is how a pass lost to a reset of the object is made up.
3. The alarm's `sweep`: a pass runs, and the sweep waits for it before it sets the next alarm. Only the alarm runs it: the housekeeping sweep that enrollment's redemption calls, on a route outside Access, runs no pass.

**A pass.** With no channel's row in the table it does nothing and verifies nothing, so an org that holds no channel pays nothing. Otherwise it reads the held records, each with its machine and revision, and finds which count. Then, in one synchronous step, it reads the held records' machines and revisions again. If they are not the ones it verified, it applies nothing: a record was accepted meanwhile, its listing already applied at its store (event 2), and that store's own pass follows. If they are, it reads every channel's row and applies:

| The row | Listed | Not listed |
|---|---|---|
| active, `unlisted` null | nothing | `unlisted` becomes now |
| active, `unlisted` set, less than `CHANNEL_RETENTION_MS` ago | `unlisted` becomes null | nothing |
| active, `unlisted` set, `CHANNEL_RETENTION_MS` ago or more | `unlisted` becomes null | retired |
| retired | active, `unlisted` becomes null | nothing |

A row that retired makes the grid go again whole, as a revoked machine's project does. A row that became active returns as a new row does (`seedProject`, then its `summary`).

**Order.** One pass at a time; one asked for while another runs waits its turn and reads the records as it starts. The synchronous step is the pass's one moment: the listing it applies is that of the records held at that moment, counted as the pass found them, and the rows it changes are the rows as they are then. So no pass retires a row that such a record lists, and none leaves active past its seven days a row that none lists. A record that stops counting between two passes (its machine retired, its certificate expired) is seen by the next one.

**The alarm.** `scheduleAlarm` adds, over the active channel's rows: for one with `unlisted` set, that time plus `CHANNEL_RETENTION_MS`; and, if any has `unlisted` null, now plus `CHANNEL_RECHECK_MS`. A retired row adds nothing: only a record brings it back, and a record's arrival runs a pass. A deadline that has passed and that the sweep's pass did not act on (it applied nothing, or the head could not be read) waits the Registry's retry wait (`RETRY_MS`) before the next alarm, as its other owed work does; it must never set the alarm for at once. Nothing of that wait is kept in memory or storage: an overdue channel deadline contributes no earlier than now plus `RETRY_MS`, which holds across an eviction, and costs a due row at most that long.

**The suite's seams.** The test Worker's backdate takes a channel's row and a time for its `unlisted`, and one read gives a row's `unlisted`. Neither exists in the deployed Worker.

#### §G. The app's reader rule (`src/main/org/channel/`; M1)

In `address.ts`:

    /** Whether a lifecycle event carries its thread's id (sminos's threads): a non-empty string in `thread`. */
    export const isStamped = (event: Logged): boolean;
    /** A `retired` a reader may have to pass by: reason `ended`, not stamped; what a sminos from before threads writes for a session whose process ended. */
    export const isUnstampedEnd = (event: Logged): boolean;

- **The rule,** in `projectSessions`: a `retired` that `isUnstampedEnd` changes nothing when the latest `joined` read before it, of the same session and provenance, `isStamped`. Every other `retired` ends the membership, as today. A `joined` is any `joined`, a relocated one too. No field is added to `ChannelSession`.
- **The kept lifecycle,** in `cache.ts`: an event that `isUnstampedEnd` is kept under a key of its own, apart from every other `retired` of the session. So the cache holds, per session and provenance, the latest of each of five: `joined`, `renamed`, `titled`, a `retired` every reader honours, and an unstamped `ended`.
- **Why three events decide.** Membership is the state after the last event that takes effect. The latest `joined` always does, and so does the latest honoured `retired`. An unstamped `ended` takes effect only when the latest `joined` before it is unstamped; one that comes before the latest `joined` is overtaken by it, and among those after it only the latest matters. So the latest of each of the three gives the same answer as the whole log.
- **The file.** Its shape and version are unchanged; it may hold two `retired` events for one session. A build from before this work that reads it keeps the later of the two, which is what it does today.
- **Consumed from sminos (T1, contracts X2 and X7):** the field's name `thread`, and `reason` with the values `ended`, `moved`, `continued` and `retire`. The rule reads `ended` alone by name.

#### §H. The web desk's two sentences (`apps/desk-web/src/conversation/capabilities.ts`; M1)

| Where | Today | After |
|---|---|---|
| the retire note of a member with no seat | `records it retired; the process stays yours to close` | `records it retired; it returns only if its human reopens it` |
| the send note of a session with no seat that is not running | `recorded, not delivered: a closed terminal session is reopened only by Resume` | ``recorded: ${s.machine} wakes it for this, or holds it until its human reopens it`` |

Each is true before threads (a retirement holds until the session runs again; a message waits for the session to be reopened), with threads and no wake (the same), and with the wake (a message wakes the thread unless its machine holds it). The seat's sentence beside the second, `resumes the seat to read it`, stays.

#### §I. The conversation fixture (`test/endpoint/rl10/conversation.json`; M2)

Three edits and no other.

1. Each of the three sminos hellos' `capabilities` becomes `["audience", "record", "locations", "channels"]`, and each of the two welcomes' `["access", "reach", "record", "locations", "channels"]`.
2. `bindings` gains `"channel:C": "5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c"`.
3. One case is appended, the fourteenth:

       {
         "name": "a declared channel: a lane A member's channels count while the hello listed channels, and stop counting once the member states none",
         "steps": [
           { "up": { "t": "hello", "project": "{{channel:C}}", "name": "desk-integration", "have": {} }, "note": "the channel's log, opened without follow: this machine holds a member of it" },
           { "down": { "t": "have", "project": "{{channel:C}}", "have": {}, "archive": false }, "vary": ["have", "archive"] },
           { "up": { "t": "member", "session": "{{session:S1}}", "alias": "main", "project": "{{project:P}}", "lane": "A", "state": "idle", "title": "the main session", "cwd": "{{checkout}}", "launch": "{{launch:L1b}}", "owners": ["@machine"], "ownersProof": [], "origin": { "kind": "terminal" }, "principal": "@machine", "inference": { "kind": "slot", "configDir": "{{configDir}}" }, "controller": { "lane": "A", "since": "2026-10-27T18:01:00Z" }, "access": "listed", "shares": [], "policyRev": 0, "channels": ["{{channel:C}}"] }, "vary": ["controller.since"], "note": "S1's project stays P: its declared channels are stated beside it" },
           { "scene": "holds", "log": "{{channel:C}}", "held": true, "within": 2000, "note": "the endpoint counts a member of the channel's log, which puts it in the machine's record as known" },
           { "up": { "t": "member", "session": "{{session:S1}}", "alias": "main", "project": "{{project:P}}", "lane": "A", "state": "idle", "title": "the main session", "cwd": "{{checkout}}", "launch": "{{launch:L1b}}", "owners": ["@machine"], "ownersProof": [], "origin": { "kind": "terminal" }, "principal": "@machine", "inference": { "kind": "slot", "configDir": "{{configDir}}" }, "controller": { "lane": "A", "since": "2026-10-27T18:01:00Z" }, "access": "listed", "shares": [], "policyRev": 0 }, "vary": ["controller.since"], "note": "a member in no declared channel carries no channels key: this is case 11's frame" },
           { "scene": "holds", "log": "{{channel:C}}", "held": false, "within": 2000 }
         ]
       }

The two `member` frames are case 11's frame of S1, the first with `channels` added. The scene `holds` is new: in `conversation.local.test.ts` it waits up to `within` milliseconds for `endpoint.rl10.sminosView()?.sessionProjects().includes(<log>)` to equal `held`. That suite's endpoint signs no record, so the record's `known` is proved in `projects.local.test.ts`, not here.

sminos copies the file byte for byte when CH lands its half; until then it keeps the copy pinned to the commit it has.

After M2, in a pull request of its own (Decision Log 17), the fixture takes the three lines sminos's threads (T1) change, so sminos's replay needs no amendment table once it copies the file:

1. Case 4's first upload (step 4): S1's `joined` and `titled` and S4's `joined` carry `thread`, and S2 has a second `joined`, stamped, at its writer's seq 2, directly after its first. The step's `vary` lists every `thread` path and the new event's `ts`: a thread's id is minted by sminos and compared only for presence, so the values written are samples.
2. The two hellos of P that state a vector (case 4 step 0, and case 11's, step 18 before item 4 moves it) hold S2's writer at 2.
3. One scene is appended to case 4 (step 17, `hub-holds` for S2's seq 2, with `thread`): the endpoint signed and attested the second `joined` with its thread inside the signature. It is appended, not placed after the upload, because sminos's replay keys its tables by case and step number.
4. Case 11's restatement after the restart states S4 again (a new step 12, after S2's frame): an ordinary `member` frame, lane A, with the state word `gone`, since a thread whose process ended stays a member and the fixture's S4 has no transcript. The steps after it move down by one, which sminos's tables follow at their next copy. The scene `withdrawn` for S4 stays, now for another reason (Decision Log 18): the member is held and its listing is withdrawn.
5. Case 11's hello of P (now step 19) holds S4's writer at 1, not 2: a stopped thread writes no `retired`. S3, lane B, is still retired and stays at 2.

#### §J. What sminos's children build on

| Name | Value | Who consumes it |
|---|---|---|
| the vectors | `apps/org-protocol/vectors/channel-rule.json`, version 1 | T1 (`retired`), CH (`ids`) |
| the capability | `channels`, in the hello's `capabilities`; the welcome lists it only in answer | CH |
| `member.channels` | absent for a thread in none; ids that pass the predicate; lane A only; the first 128 count and the rest are dropped with no word, so a 129th membership is sminos's to refuse or to report | CH |
| what makes a channel `known` | a held lane A member that states it, and its log opened on RL10 without `follow` | CH |
| a member whose project is a channel's id | not held by the endpoint, so not listed | CH (`sminos join <channel>` is refused there) |
| a link to a channel's id | refused `channel-id` | none |
| a lane change | the endpoint withdraws the old listing itself; sminos's own `gone` before it is harmless | T1 |
| the retention | seven days with no counted record listing the id as `known`; active again at the next stored record that lists it; a hello alone does not bring it back | CH |
| the fixture | `test/endpoint/rl10/conversation.json` at the master commit that holds M2 | CH |

#### §K. The baseline oracle (`test/endpoint/mixed-fleet.local.test.ts`, `test/endpoint/mixed-fleet-baseline.json`; M2)

**What it is.** One scripted session lane, run against a real endpoint and the hub in Miniflare. Every frame the endpoint sends is compared with the frames master's endpoint sent for the same script. The baseline was made by running this same file on `77af813a4`, the master this work started from.

**The file runs on both builds.** It imports nothing this work adds and names no symbol `77af813a4` lacks: `createEndpoint`, `fakeServices`, `startMiniflareHub`, the org fixtures, `FakeSminos`, and a stand-in of its own for the index (`ProjectsSource`). Every frame it sends is a plain object. It has two modes: with `MAWS_MIXED_FLEET_CAPTURE=<path>` set it writes the baseline, and otherwise it compares with the one committed.

**The script.** One endpoint, enrolled and listed, whose index declares one folder of project P. Each step waits for the frames it causes before the next is sent, so that no two steps' effects can merge and the count of frames does not depend on timing.

1. The endpoint is connected to the hub and its projects snapshot has ended.
2. sminos's RL10 hello, listing `audience`, `record` and `locations`, and never `channels`.
3. The machine presence of P; a `member` frame of S1 (lane A, project P); one of S2 (lane A, project Q, which has no folder here); `restated`.
4. Log-plane hellos: P and Q without `follow`, R with `follow: true`, and C, a channel's id, without `follow`.
5. S1's `member` frame again, with another title.
6. S2 `gone`.

Two variants. In *without*, no member frame carries `channels`. In *with*, S1's and S2's carry `channels: [C]`. The ids of sessions, projects and the channel are constants of the file. The script holds no lane change and no member whose project is a channel's id: those are what this work does on purpose to an sminos without the capability (Constraint 4), and each has its own test.

**The transcript** of one variant has two halves. `down` is every frame the scripted sminos received on its RL10 socket. `up` is every frame handed to the endpoint's hub link `send`, watched as `conversation.local.test.ts` watches it; the link's own hello, its heartbeats and each log's opening hello go by another path in `src/endpoint/hub-link.ts`, which no milestone changes and step 7 checks. Each half is grouped by the frame's `t`, the kinds in name order and a kind's frames in the order they were sent: two kinds can race each other, and within a kind the order is the endpoint's own.

**Normalization** (version 1). These rules, in this order, and nothing else. No key and no frame is ever dropped, and no other value is changed.

1. *Identities.* A value the run itself made or was given is replaced wherever it occurs, as a whole string, inside a string, or as an object's key, the longest value first: the org's id `{{org}}`, the hub's URL `{{hub}}`, the machine's name `{{name}}`, its ref `{{ref}}`, its key's id `{{kid}}`, its enrollment's time `{{enrolled}}`, the build string `{{build}}`, the RL10 token `{{token}}`, the owner's member id `{{member}}` and device id `{{device}}`, and the scratch directory in its real spelling `{{root}}`.
2. *Signatures.* In a `sig` object (`{kid, value}`), a `value` that is a non-empty string becomes `{{sig}}`; its `kid` is rule 1's. A `sig` that is missing, or whose `value` is empty, stays as it is, so a signature that went missing is a difference.
3. *Clocks.* The run notes its start before it enrolls. A string that reads as an ISO-8601 instant at or after the start becomes `{{time:n}}`, and a safe integer at or after the start's milliseconds becomes `{{clock:n}}`. `n` numbers the distinct values of that kind in the order a walk of the grouped transcript meets them (`down` before `up`, kinds in name order, frames in order, keys in name order). Equal values keep one name, and the order in which values first appear is kept. The file may also pin the endpoint's clock through `EndpointOptions.now`; what it pins needs no replacing.
4. *The host.* Each entry of an `endpoint` record's `addresses` becomes `{{address:n}}` by its position: they are the host's interfaces and a port of the run.

The capture is taken on a Mac and the suite runs on the gate's Linux runner. A value bound to the host that these rules miss (a device or inode number, a path's spelling) shows as a red first run of the gate and is fixed in the rules, with `normalization` raised and the baseline captured again. The script keeps such values out: its declared row carries no anchor.

**The baseline file.** Written only by the suite's capture mode, never by hand. JSON, keys sorted, indented by two spaces, ending in a newline:

    { "about": "…", "from": "<the full sha of the commit the capture ran on>", "normalization": 1,
      "variants": { "without": { "down": { "<t>": [ … ] }, "up": { "<t>": [ … ] } }, "with": { … } } }

**What the suite asserts,** on every run in compare mode:

1. the baseline's `from` is `77af813a4a4a642d747f7511a343448db489a9ab` and its `normalization` is the file's own;
2. **the oracle:** this build's *without* transcript equals the baseline's *without*, and its *with* equals the baseline's *with*, key for key and value for value;
3. **the field isolation:** this build's *with* equals its own *without*;
4. **the comparison refuses what it must.** Each of these, made to this build's transcript, makes the comparison with the baseline fail and name the kind of frame: a field added to the `welcome` (a frame down); a field added to the body of a `projects` record (a frame up); the id of one `known` entry altered; an entry added to `known` whose id is C; one frame dropped;
5. the baseline holds what those cases need: an `org` frame, and a `projects` record whose `known` is not empty.

In capture mode, on `77af813a4`, it asserts that master's *with* equals master's *without* (master passes the unknown field by) before it writes the file.

**The gate.** Class 1a, the `unit` job. The suite is listed in `vitest.config.ts`'s `TIMING_NODE_TESTS`, where the other suites against the hub in Miniflare are, and reads the baseline as a file beside it.

**When master moves a frame.** The baseline is the endpoint's frames at `77af813a4` for an sminos without `channels`. If a merge of master brings another work's change to a frame, the suite goes red for it. The baseline is then captured again from the master commit that was merged, which holds nothing of M2; `from` and assertion 1's constant move with it, in the same commit, with a line in the Decision Log. The same holds after this work lands, for any change that means to move a frame.

### Proof that an executor does not run

1. **Step 0's hub half:** the owner, "Step 0's commands".
2. **The gates:** the controller, Concrete Steps 4, 6 and 7.
3. **The staging deploy** of the merged master and the read of its `X-Desk-Build`: the architect's dispatch. A seven-day rule is not observed on a deployed hub in a sitting, and the suite's seams are not deployed; the hub's proof is its suite.
4. **The live scene** (a thread placed in a channel on one machine, followed on another, the row retiring after a week) needs sminos's CH. It is CH's cross-machine gate and the parent's acceptance, not this document's.

### Size and review

Estimated from the code at `77af813a4`: the files each milestone names and the tests that pin today's behaviour.

| | files | changed lines, about | what it is |
|---|---|---|---|
| M1 | 14 | +450 −20 | a predicate, a vector file, a rule in two functions, one branch in `Members`, two strings |
| **the first pull request** | **about 15** | **about 500, and this document** | M1 alone |
| M2 | 15 | +1,100 −20 | a capability, one reader, two refusals, the fixture's case, the baseline suite and its captured transcript |
| M3 | 6 | +600 −10 | one state machine in the Registry, the registration's read, its seams, its suite |
| **the second pull request** | **about 21** | **about 1,700** | M2 and M3 |

The first pull request is one milestone under twenty files: its review is M1's, at `doperpowers:reviewer-high`. By `doperpowers:review-code`'s measure (about twenty files or a couple of thousand lines) the second is panel-sized by its files, and it touches the hub's registry, the endpoint's acceptance of frames and the wire. Decision Log 1 names the reviews, as Decision Log 4 moves them.

## Surprises & Discoveries

1. Observation: no id of version 8 exists where this document could look without the owner.
   Evidence: on one Mac of the fleet, read 2026-11-18. The endpoint's own projects record and the other machines' records it holds ("Step 0's commands", the first): `24 ids; 0 of version 8`, 16 of version 4 and 8 of version 5. sminos's kept directory, marked complete: 52 projects, 43 of version 5 and 9 of version 4. sminos's log store: 130 directories, 105 named by a UUID, 87 of version 5 and 18 of version 4. None of version 8 in any.
2. Observation: the app's reader is fed one `retired` per session, so a rule placed in the reader alone can be undone by the cache.
   Evidence: `src/main/org/channel/cache.ts`, "By `<session>\n<kind>\n<authenticated or legacy>`: the latest of each that didn't fail", and `sessions: () => projectSessions(lifecycle.values())`.
3. Observation: a session that changes from lane A to lane B keeps its lane A listing for good; the other way, until the next restatement.
   Evidence: `src/endpoint/rl10/members.ts`: `welcome` puts every listed id into the set to withdraw, and `member` deletes `member.session` from it, which is the lane A listing's id.
4. Observation: the hub keeps a retired machine's projects record.
   Evidence: `apps/desk-hub/src/objects/org-records.ts`, on `storeProjects`: "A record of a machine the head has since retired stays kept: every reader verifies it, and refuses it then."
5. Observation: an id in a projects record need not be a UUID, and a project off the hub is in the records only.
   Evidence: `apps/org-protocol/src/shapes.ts`, `isProjectId`: `/^[A-Za-z0-9._-]{1,64}$/`; `ProjectLocation.hub: false`.
6. Observation: production's hub is read by the owner alone.
   Evidence: `apps/desk-hub/deploy/README.md`, "Production runs": "The owner runs them; an agent never does, not even read-only or `--dry-run` against the real configuration."
7. Observation: at the hub, a machine's projects record and its log-plane hello of one log are not ordered with each other, so a record can list a channel before the channel's row exists (the adversarial review, 2026-11-18).
   Evidence: `apps/desk-hub/src/objects/relay.ts`: `logPlane` runs a log's frames in the queue `project:<id>`, and `record` runs a record in the queue `registry`.
8. Observation: a pattern written with `^` and `$` passes a trailing newline in Python and not in JavaScript, which is why the vectors hold one.
   Evidence: the 29 `ids` entries run through both at authoring: 0 mismatches with JavaScript's `test` and with Python's `fullmatch`; Python's `match` on the `^…$` form passes the entry with the trailing newline.
9. Observation: the parent's four `retired` cases pass through master's cache once the reader alone is fixed; only a case with an honoured `retired` before an unstamped `ended` shows the cache's displacement (M1, 2026-11-18).
   Evidence: `cache.test.ts` with `address.ts` fixed and `cache.ts` unchanged: the four shared cases green, `keeps a moved that an unstamped end follows` red (`[true, false, true]` against `[true, false, false]`). Hence Decision Log 6.
10. Observation: the web desk's retire note is also the body of its retire confirmation (`ChannelView.tsx`: "Retire X? This …"), so §H's first sentence shows there too, with no test pinning it.
    Evidence: M1's executor's read of `apps/desk-web`, 2026-11-18.

## Decision Log

1. 2026-11-18 — **Verification.** (a) This document's execution section gets one `doperpowers:adversarial-reviewer` pass before M1 is dispatched, on four questions: whether the milestones prove the parent's acceptance item by item; whether "The mixed fleet" leaves a way for a frame or a record to differ; whether §F's pass can retire a listed row or keep an unlisted one; whether §G's three kept events decide membership as the whole log does. (b) Each milestone's diff is reviewed at `doperpowers:reviewer-high` before a milestone that consumes it starts: M1's before M2 and M3, M2's and M3's before M4. The stakes set the rung: the hub's registry, the endpoint's acceptance of frames, the wire. (c) The branch review, in M4: the xhigh panel, run from the main session, since the branch is panel-sized by its files ("Size and review"). Its lenses: the mixed fleet, path by path, with the capability absent on each side; §F as a state machine, with resets, the alarm and records that stop counting; what the endpoint holds and withdraws when a frame is refused or a lane changes, restatements included; the reader rule through the cache, with rejudging and the two provenances. If the branch ends under twenty files and two thousand lines, one `doperpowers:reviewer-high` on the whole branch takes the panel's place. Findings go to a fix wave; a round that leaves only logged debt and dismissals ends the reviews.
2. 2026-11-18 — **The registration reads the records already held** (the adversarial review's first finding, taken). The review found that a listing record can be stored before its channel's row is registered: a connection's log-plane frames and its records reach the Registry through separate queues (`apps/desk-hub/src/objects/relay.ts`, `logPlane` and `record`), and the row is inserted by `registerProject`. As §F stood, a pass that met no row did nothing and the registration then set `unlisted` to its own time, so a record that stopped listing the channel on the sixth day would have had it retired on the seventh, a day after the removal. What moved: §F's event 1 and its "State"; M3's Decisions and its tests, with the ordered case (the listing stored, the row registered, the listing removed, seven full days from the removal); "Where the contract meets the code" 10. The reconciliation is synchronous, in the insert's own step, over the held records with no signature checked, so nothing is owed after the insert and nothing needs a durable schedule; a record that no longer counts can only keep the row a day longer. Alternative rejected: a pass owed in storage and run by the alarm, which is exact a moment later and adds a column, an alarm source and a retry.
3. 2026-11-18 — **The mixed fleet is proved against master, not against this build** (the adversarial review's second finding, taken). The differential compared two runs of the new endpoint, so a field the new endpoint added to a frame without condition would have passed it. What moved: "The mixed fleet" (row 2 is the baseline oracle, row 3 the differential kept as the field isolation); a new Interfaces §K, which defines the script, the transcript, the normalization of identities, signatures, clocks and the host, the baseline file, and the cases showing that the comparison refuses an added field in each direction and an altered `known`; M2's files, Decisions and tests; "The baseline's capture" in Concrete Steps; A2 in "Acceptance". The gate is class 1a, the `unit` job. Alternative rejected: running the script against a second checkout of `77af813a4` inside the gate, since the unit job has one tree; the transcript is captured by the suite's own file on that commit, twice to the byte, and again at the second pull request's acceptance.
4. 2026-11-18 — **M1 lands alone and first; the order binds** (the architect's ruling, agreed with the session holding the parent). The document allowed it; it is now required. sminos's T1 pins `apps/org-protocol/vectors/channel-rule.json` from the master commit that holds M1, so that commit's pull request carries M1 and this document and nothing of M2 or M3. What moved: the header; "Plan of Work" (two pull requests; the second on `mw-channels-2` from a master that holds the first); Constraint 7; M1's landing; M4, which is now the second pull request's acceptance; Concrete Steps 6 and 7; "Size and review". The parent has MW as "one change in that repository"; this is the difference, and it is the parent's holder who agreed it. The verification call of entry 1 now reads: (b) stands; (c) the first pull request's review is M1's, at `doperpowers:reviewer-high` on its whole range; the second's is the xhigh panel with entry 1's lenses, or one `doperpowers:reviewer-high` on the whole branch if it ends under twenty files and two thousand lines.

5. 2026-11-18 — **The base moves to master `874b73f54`** (the architect's instruction at dispatch), merged into `mw-channels` as `a41e39e49` before M1. Concrete Steps 1's four greps answer on it. Master's drift since `77af813a4` touches none of M1's files (it is in `src/endpoint/capabilities.ts`, `offers.ts`, `src/shared/ipc/remote-unavailable.ts`, `apps/org-protocol/src/channel.ts` and their tests). "Today" stands as written. §K's baseline stays a capture of `77af813a4`; if its comparison goes red on the merged base, §K's "When master moves a frame" applies.
6. 2026-11-18 — **A fifth `retired` case in the shared vectors, at version 1** (M1's executor's discovery, taken by the controller). With the reader fixed, the parent's four cases passed through master's cache unchanged: none of them puts an honoured `retired` before an unstamped `ended`, so none shows the displacement §G's cache key exists for ("Where the contract meets the code" 1). Only M1's own extra case did. The vectors are what sminos's suite runs, and a reader there that keeps one `retired` per session would pass the four with the same bug. So a fifth case is appended after the parent's four, derived from D7 alone: a stamped `joined`, an unstamped `moved` (no member), an unstamped `ended` (still no member). The file stays at version 1: nothing has pinned it, and the sync rule binds it from the master commit that holds it (M1's landing). The parent's four keep their order and their words. Alternative rejected: the parent's four alone now and the case later as version 2, which would cost T1 a second sync for a case known today.
7. 2026-11-18 — **The lane change keeps `gone` whole** (M1's executor's discovery, left as §E has it). A lane B to lane A change inside a restatement withdraws the app session's listing at the frame, and `restated` asks `listings.gone` for it once more, since only a member frame takes an id out of the set still to restate. The second call reaches the hub as nothing (`Listings.#withdraw` returns at a listing already `gone`; notify's `forget` is idempotent), and master's explicit `gone` frame during a restatement does the same. Not changed: dropping the id from that set in `Members.gone` would change today's explicit-`gone` path for no frame that differs.
8. 2026-11-18 — **M1's small names** (M1's executor's decisions, kept). The cache keys an unstamped `ended` under the kind segment `retired-unstamped-ended`, with the session still the key's first segment and the provenance in it, so `boundSessions` is unchanged and a legacy `ended` never displaces an authenticated one. `isUnstampedEnd` also requires `kind === 'retired'`. A passed-by `ended` creates no row in `projectSessions`. `test/endpoint/rl10/members.test.ts` is named for `Members` whole, so M2's member refusal joins it. The suites read the vectors through the `CHANNEL_RULE` export, as `PROJECT_RULE` is read (revised by entry 10 for the app's suites).
9. 2026-11-18 — **The lane change at a restatement** (M1's `doperpowers:reviewer-high` review, round 1; the second half reversed in round 2, below). §E handled only a session held in memory. After an endpoint restart nothing is held, and a frame's `#unrestated.delete(member.session)` took a lane A listing as restated when the same engine session came back in lane B, so the old listing stood for good (Surprise 3's restatement half, which §E left open). What moved: a welcome now keeps the held engine sessions still to be restated (`#unrestated`) apart from the hub's listings still to be reported (`#unreported`); a frame confirms its engine session and the one listing it reports (lane A its session id, lane B its app session id once joined); `restated` runs `gone` for a held member not restated, after taking that member's own listing out of the unreported set, and withdraws each listing left unreported unless a held member reports under it. Second: when two engine sessions share a lane B app listing and the one it was last reported from leaves (now also by a lane change), the listing is reported again from the members that stay, through `#report`, so under Decision Log 190 (b)'s deferral; a `#reporters` map, set in `#report` and cleared at a withdrawal, names the last reporter. It runs only when the departed member was that reporter: re-reporting at every departure added a third report after a reconnect that master does not make (`test/endpoint/rl10/review.test.ts`), a frame different from master's for an sminos without `channels` (Constraint 4). Entry 7's idempotent second `gone` still holds for a lane change inside a restatement. **Reversed in round 2:** the narrowed re-report still sent signed listings master does not send (a plain `gone` of the second of two directly joined engines withdrew the app's listing, master's sends nothing), recorded the reporter before its awaited record read (concurrent reports left the wrong member named), and at `restated` could re-list one omitted member as another's survivor. The stale shared listing it addressed is master's behaviour for any `gone` of a shared listing's reporter, and master's lane-change frame left it stale too, so M1 does not cause it. `#reporters` and the re-report are removed, master's `gone` for a listing another member holds is restored (its Decision Log 190 (b) loop over superseded survivors), and a test pins master's answer for the plain `gone`. The stale listing is logged in `docs/tech-debt-tracker.md`. The restatement split stands.
10. 2026-11-18 — **The app's suites read `channel-rule.json` from disk** (class 1a run 44409060623, `static`: TS6307). Importing `apps/org-protocol/vectors/index.ts` from `src/main/org/channel/*.test.ts` pulled the vectors' scenario and replay modules into `tsconfig.node.json`'s program, which does not list them. The app's suites now read the file as `src/services/index/project-rule.test.ts` reads `project-rule.json`, with a local type; `apps/org-protocol/test/channel-rule.test.ts` keeps `CHANNEL_RULE`.
11. 2026-11-18 — **Two review findings on the kept lifecycle deferred** (M1's review; `docs/tech-debt-tracker.md`). (a) A cache file that an app from before M1 compacted while a sminos with threads ran may have lost an honoured `retired` that an unstamped `ended` displaced (master's key keeps one `retired`), and M1 reads that file as a member. §G keeps the file's version; closing this needs a marker or a version that makes M1 replay such a file. The window needs an app from before M1, a sminos with threads (T1, which pins the vectors only after M1 lands) and a sminos from before threads writing to one session's lifecycle, with the `moved` already past the event bound; its cost is one retired session shown as addressable. (b) A rejudged cache loses an earlier `retired` that a later one displaced once the later one's signer stops verifying. The loss is master's, for any two `retired` events of one provenance; §G's "three events decide" holds while verdicts are fixed. M1 makes it observable in one more case (round 2): a stamped `joined` from A, `moved` from A, `moved` from B, an unstamped `ended` from A, then B removed by a new head. Master's kept unstamped `ended` ends the membership; M1 passes it by, and with the `moved` lost reads a member where a replay of the log reads none. Deferred all the same: it needs two signers retiring one session and the later one's removal, and its cost is one retired session shown as addressable; the close is the tracker row's, a rejudge that loses a kept `retired` replays that session.
12. 2026-11-18 — **M2 and M3 are built side by side, in two checkouts** (the controller). Both start from master `8a7f308ff`, which holds the first pull request. M2 is built on `mw-channels-2`, and M3 on `mw-channels-2-m3`, a second worktree, so that two executors never share one tree; the two touch no file in common (Plan of Work). Each is reviewed at `doperpowers:reviewer-high` on its own range (Decision Log 1 (b)). M3's branch is then merged into `mw-channels-2`, and M4 runs on that head. `mw-channels-2-m3` is never opened as a pull request.
13. 2026-11-18 — **M2 as built, and its review** (M2's executor; `doperpowers:reviewer-high`, rounds 1 to 3). The baseline: captured twice from `77af813a4` with `cmp` agreeing before any endpoint line changed, and equal on the Linux runner at the first class 1a run. Its suite pins the endpoint's clock to one that never returns the same millisecond twice (so §K rule 3's numbering cannot vary), replaces the random `snapshots?` ids as `{{ask:n}}` under rule 1, passes `env: {}` so the direct listener is off and `addresses` is empty, runs each variant on its own hub in Miniflare, and makes each step wait on what it causes (the checkout's presence held, each member held with its `audience` frame, the restatement closed) before a quiet window whose counts are sampled before it is judged. `memberChannels` reads the frame in one pass that stops at the 128th distinct id. The `holds` scene compares the optional answer with `held`, so a disconnected sminos answers neither. The member refusal runs before the lane-change check and leaves the restatement sets alone. A lane B frame refused for its project skipped the hand-off mark, so the spawner kept an owner's access, across a `/clear` too (§D, "A member", now says what it does). The review's one tension: this path exists only for a malformed frame from an older sminos in an app-launched session, and three rounds were spent on its hand-off; it was closed rather than deferred because what it leaked was access.
14. 2026-11-18 — **§F's listing is durable at the store** (M3's `doperpowers:reviewer-high` review, rounds 1 to 3; §F events 2 and 3 and "The alarm" revised in place). As §F stood, a store's listing reached the rows only through a pass, and a pass applies nothing when the held revisions moved, when the head cannot be read, or when the object resets before it applies. In each, the machine could then withdraw the listing (its next record waits only for the store's answer), the withdrawal's pass saw no listing, and the row kept a clock started before the listing, so it retired up to six days early. A loop that re-ran the store's pass until it applied closed the revision case only, and could starve under sustained writes. What moved: the verified record applies the table's "Listed" column to the rows its `known` names in the store's own synchronous step (one function shared with the pass), which can only keep or bring back a row; the store then runs one pass, which defers to the newer store's when the revisions moved. Also from the review: only the alarm runs a pass (enrollment's redemption, on a route outside Access, called the same sweep before checking its token); the store arms the alarm for its owed pushes before the pass can suspend; an overdue channel deadline contributes no earlier than now plus `RETRY_MS`, with nothing kept, so the wait holds across an eviction; a deterministic test of Order, through a pass barrier in the test Worker only; and row 6 pins the directory's and the first grid frame's keys and the whole frame sequence after. Deferred as small at this fleet's size: the pass reads every hub row to find the channel rows when none exists, and each record's verification re-evaluates the certificate set (`docs/tech-debt-tracker.md`). Round 3 left two P2s, deferred there as the review's convergence: a resend of identical bytes after an eligibility change does not fence an older sweep (harm needs a reset besides), and sustained overlapping writes from two machines can keep every pass reporting moved (a finite burst drains; projects records change far below that rate).
15. 2026-11-18 — **The branch review: the xhigh panel on `8a7f308ff..7c29a8473`** (the architect's dispositions; the panel's verdict "incorrect", two P1s and nine P2s, each confirmed by its verifier). *Fixed:* `scalpel-2#2`, a `member` frame whose handler awaited (the lane change's `gone`, the refusal's lookup) could resume after a later frame for the same session had been handled, set its stale member and join it, so a refused session came back held. The rule is entry 16's (one frame at a time across a replacement), which replaced the per-session turn first built here. It was on master since M1 and is not special to the refusal. *Accepted as a residual, no code:* `scalpel-2#1`, a `/clear` that replaces an unjoined engine session before the refusal's lookup leaves the new engine session and the app session unmarked until the new session's own frame arrives, which marks it synchronously. It needs a sminos from before channels whose human typed a channel's id into `join`, that record to be the session's first, and a `/clear` in the lookup's window; what it gives is the person who launched the session a short further window of the owner bridge to their own session, and nobody else gains anything. *Logged, no code* (`docs/tech-debt-tracker.md`): `sweep#1` (a record at the 256 KiB bound becomes unsignable once a channel is added, as on master for any added `known` project; the fleet is three orders of magnitude below it); `scalpel-1#1`, `#2`, `#3` (a renewal accepted between a pass's snapshot and its apply, which self-heals at the machine's next record while the hub keeps the log; a due alarm replaced by a lease update; an alarm write that fails after registration; the last two only keep a row longer); `scalpel-3#2`, `#3` (a channel briefly missing from, or briefly present in, a record signed during a reconnect's restatement: the existing project rule applied to channels, corrected at the next revision, and sminos's own leaving rule waits a day); `scalpel-4#1`, `#2`, `#3` (the oracle does not check order between frame kinds, the revisions' order, or that the hub applied the final withdrawal; it proves frames and `known` unchanged without the capability, and the three are other suites' subjects). The fix's delta gets one `doperpowers:reviewer-high`, the last round: after it, only a P1, or a reachable P2 of the fix's class, goes back to the architect.
16. 2026-11-18 — **One RL10 frame at a time, across a replacement too** (the architect's ruling, replacing entry 15's mechanism). The first fix gave each session a turn and had a handler check it after every await; its review found five more continuations (a replacement's empty restatement reviving a session, a join written before the check, a superseded engine's re-report, a record read refilling the cache, the gone tail clearing the archive flag), and each would have needed its own check. The turn patched continuations one at a time. The root is narrower: `Rl10Connection.read` (`src/endpoint/rl10/server.ts`) already hands one connection's frames to the link one at a time, so two handlers are in flight only when a replacement connection's frames start while the replaced connection's last handler is still awaiting. The rule: `Rl10` takes nothing of a new connection, neither its welcome (`members.welcome()`'s snapshot, still before the link's listeners hear of it) nor its frames, until the replaced connection's in-flight handler has settled; one chain in `src/endpoint/rl10/link.ts` runs every connection's hello and frames, `closed` stays outside it so the link goes down at once, a hello whose connection is no longer current at its turn is not taken, and a replaced connection's frame that reaches its turn is dropped as before. The turn and its checks are reverted; `members.ts` is 7c29a8473's. Before relying on the chain, every await a member, gone or restated handler can reach was checked for a bound with the hub or the engine host away: `listings` is a local queue whose hub sends are synchronous and whose retries run on timers; `engine.sessions` carries the host request's 10 s timeout; `session.get` and `session.list` go through `spine.ensure` (a 5 s lock, a 30 s resync bound) and the discovery wake (8 s); the handed-off mark is a synchronous write. One is bounded only transitively: `spine.ensure` meeting a quiet release awaits the spine's own settling, whose host requests carry the 10 s timeout. No wait limit was added at the replacement. Pinned in `test/endpoint/rl10/replacement.test.ts` (a real `Rl10`, two sockets): the panel's interleaving and the review's empty restatement, both red on 7c29a8473's `link.ts` and `members.ts`, and a replacement that closes while it waits. The review's finding 4 (a stale `session.get` refilling the record cache) is reached only from frame handlers and `recordChanged`, which caches its fresh read before it reports, so the chain covers it; the same race is on master. A neighbour is logged: `recordChanged` runs outside the chain, so its report can queue behind a frame's withdrawal and list a session that has gone, until a later frame corrects it (on master too; `docs/tech-debt-tracker.md`). The chain's review found one regression of its own: the server makes the replacement current before its hello is taken, so the replaced connection's paused handler could send on the new socket ahead of its welcome (an `audience` frame first, which sminos's handshake refuses). The link now keeps the connection it welcomed, and every outbound path (`send`, `connected`, `adopted`, `restate`, the audience frames, `#frame`'s entry check) answers only while that connection is still the server's current one; a frame meant for a connection not yet welcomed is dropped, since the welcome's restatement and the replacement's own frames say everything again. Pinned: the replacement's first frame is `welcome` under a paused handler with `audience` and a policy change.
17. 2026-11-19 — **The fixture takes T1's three amended lines, after M2 and apart from it** (the architect, on the sminos composite's request). sminos's T1 stamps a lane A session's lifecycle events with `thread` and adopts S2 (lane B at its join, lane A once its bridge relays the verdict) with a second, stamped `joined`; its replay amended those lines in its own harness (`AMENDMENTS` in `sminos/tests/rl10_conformance.py`, doperpowers `sminos-threads-t1` at d38b7cd2). They are written into the fixture as §I's closing list gives them, with no product change: the endpoint already signs an own event whole, `thread` included, and the suite passed on the amended lines unchanged. The alternative, inside the second pull request, was refused because that pull request was already reviewed and gated at its head. The second `joined` of a session that is already a member also reaches the web desk's frozen project view, which prints one more "joined" line and resets the join time; a fix was built (PR 767) and closed on the owner's decision of 2026-11-19, the view being frozen and the effect cosmetic.
18. 2026-11-19 — **A lane A member whose state word is `gone` is held, and its listing withdrawn** (the architect, on the sminos composite's report of T1's third milestone). From T1 on a lane A session whose process ended is restated as an ordinary `member` frame whose state word is `stopped`, or `gone` when it has no transcript to reopen; until then only a stopped seat did this. `Members.#report` passed the state word into the listing, and a listing whose state is `gone` is RL6's withdrawal (`LISTING_GONE`): the hub serves it to no app, but it was signed by the listing path, with its owners, project and title, only once the endpoint relayed the project, and without settling what the hub was told of the session's pending questions. After a restart the listing from before stood until the project opened. The rule: for lane A, that state word withdraws the listing through `listings.gone`, the one path that withdraws, and the member stays held, so `known`, the restatement and a later state (which lists it again) are as for any member. Lane B is untouched (a lane B session is retired, not stopped, and two engine sessions can share its listing). `stopped` is listed like any state. Pinned in `test/endpoint/rl10/members.test.ts` (three cases, two red without the line) and by the fixture's case 11, where S4's `withdrawn` scene holds with S4 restated. The `endpoint.listings` call follows the same predicate (`listingWithdrawn` in `src/endpoint/rl10/members.ts`) and signs no listing for such a member, pinned in `test/endpoint/calls.test.ts`. *Beat:* leaving the collision as it fell (the listing path signing a withdrawal with fields); asking sminos for another word, which would change what a stopped seat sends today.

## Outcomes & Retrospective

2026-11-18, at the second pull request's opening; the branch review (the xhigh panel) and its fix waves refresh it.

**What holds.** The first pull request landed alone as `8a7f308ff`, and `channel-rule.json` is pinned there at version 1 with five `retired` cases. The second, on `mw-channels-2`, carries the capability pair, `channels` into `known` (lane A only, 128 at most, read in one place), the two refusals, the fixture's channel case, the baseline oracle, and the hub's retention. Each milestone's tests are in "Acceptance"'s files. The baseline was captured from `77af813a4` twice to the byte before the endpoint changed, captured twice more at the acceptance with no difference, and is equal on the Linux runner. Step 0's hub half is still the owner's, and it gates the second pull request's landing.

**Against the purpose.** Everything the contract lists is built and tested. No live scene exists until sminos's CH lands. Until a sminos lists `channels`, the endpoint's frames are master's, except the two changes Constraint 4 allows: the lane change and the member refusal.

**What the reviews changed.** Every milestone's first review found a real defect, and most were in what the design left implicit, not in what it said:
- the lane change after a restart (Decision Log 9);
- a refused lane B record's hand-off, which leaked access (Decision Log 13);
- §F's listing, which reached the rows only through a pass that can skip, so a row could retire six days early (Decision Log 14).

The fix for §F follows the shape of the design's own event 1: a step that can only keep or bring back a row runs in the synchronous part of the store, so it needs no ordering. That shape would have served at authoring.

**What to watch.** One fix was reverted. A fix that diverged from master for an older sminos (the shared lane B listing's re-report) cost a review round and was taken back; Constraint 4 decided it. Seven review findings are deferred with reasons in `docs/tech-debt-tracker.md`. Two concern the kept lifecycle (M1), one concerns the stale shared lane B listing (master's), and four concern the hub's retention at scale or under rare interleavings (M3).
