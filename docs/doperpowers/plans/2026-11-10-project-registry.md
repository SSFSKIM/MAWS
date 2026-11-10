# The project registry: execution (2026-11-10)

> **Design:** `docs/doperpowers/specs/2026-11-10-project-registry-design.md`, cited below as *design §n*. Pin: blob `52c2565ee6fbb8cdc51ff67249aad21474288be2`, the design as the commit that adds this document leaves it: revision 6, approved by the owner on 2026-11-10 (master `a839e6bb2`, blob `64763d606a71f98bca5f7946b9bda6b603e3c996`, its Decision Log 1 to 9; P5 Decision Log 265), with its Decision Log 10 recording this document's refinements. The design is this work's contract: purpose, terms, the rule, the shapes, acceptance 1 to 11. This file holds the execution only and repeats none of it.
>
> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (P5). The registry is a follow-up to P5, outside P5's acceptance (P5 Decision Logs 263 and 265). It amends P5's contract OX3 as design §13 says, and no other.
>
> **What binds.** The design, whole. P5's contracts OX1 (wire compatibility), OX2 (machine refs and addresses), OX3 as amended, OX4 (the client port, which this work leaves as it is) and OX8 (the Registry socket). The remote layer, `docs/doperpowers/specs/2026-10-26-remote-layer-design.md`, cited *RL §n*: RL1 (the endpoint's link to the hub), RL2 (a device's channel to a machine), RL4 (signed acts and step-up), RL6 (machine-signed records), RL10 (the endpoint's socket for sminos), §5.9 as the design amends it. The repository's rules in `CLAUDE.md`.
>
> **Two tracks, one document.** The **desk track** (the session that owns `apps/org-protocol`, `apps/desk-hub` and sminos, in the doperpowers repository) builds M1 to M7. The **MAWS architect** (this document's writer) builds M8 to M12 through executors and runs M13 with the desk track and the owner. The architect is this file's one writer: the desk track reports each landing, and the architect records it here.
>
> **Board:** MAWS #521 (the app's half), the desk board's #181 (sminos's half).

## Purpose

Today a project is something each machine works out from its own files, and the app lists a project only when this Mac holds a folder of it. After this work a project is a stored thing of the org: one id, one name, and the folder it lives in on each machine that holds it (a *location*). Each machine signs a record of its own locations, the hub keeps the newest record of each machine, and every device and machine reads them.

What a person can do afterwards that they cannot do now:

- On the mini, over SSH, type `maws project add .` in a folder with no git and no `.smns`. Within seconds the MacBook's sidebar has that project, marked with the mini, and "+ Session" on it starts a session on the mini in that folder.
- Add a folder on the MacBook to the same project. The row then names both machines, and `sminos list` on either machine files both machines' sessions in the one project.
- See every project of the org on every Mac, also those with no folder on that Mac, and still see them after a relaunch while the holding machine is off.
- Rename or delete a declared folder on disk and see "folder not found" with Locate… and Remove beside it, with nothing removed.

**How to see it working.** In the suites: the shared vectors (Interfaces §B) pass in sminos's Python tests and in MAWS's unit suite with the same expected project for every directory; a local suite runs two endpoints against the hub in Miniflare and sees a folder declared on one arrive as a project in the other's directory and in the app's view. Live: design acceptance 1 to 11 on the MacBook, the mini and one devcloud VM, signed in to production's org (M13).

## Progress

Status words: *specified* (ready to build), *building*, *landed* (on master, or merged in doperpowers), *live* (running on the three machines).

- [x] M1 — The projects record and the shared vectors (desk track; a MAWS PR) — landed (2026-11-10, master 82f706120, the merge of `registry-m1` at 7f641867b; class 1a run 42792480991 green on the merge's tree; reviewed at reviewer-high by the desk track; Decision Log 8)
- [x] M2 — The hub keeps and hands out projects records (desk track; a MAWS PR; staging deploy) — landed (2026-11-10, master caaef871c, the merge of `registry-m2` at b947d5e8b; class 1a run 42809053795 green on the merged tree, e2e:remote and e2e:remote-latency-check run 42807149245 green on the head; reviewed by the desk track at reviewer-high, then reviewer-medium twice; Decision Log 9; project-rule.json version 2; tracker #552). Staging deployed at hub@caaef871, production unchanged; the app feed sends projects-all. One step open: a staging endpoint's welcome read for `projects`, which closes in O15's staging run on the final build, where the VM enrolls.
- [x] M3 — sminos: the rule and canonical paths, against the vectors (desk track; doperpowers) — landed (2026-11-10, doperpowers PR #481, merge 2c0d084e; sminos 1.42.0; the vectors at version 2, MAWS caaef871c; reviewed at reviewer-high in four rounds. With no locations, resolution matches main but for §8's corner, checked in 18 layout comparisons. Fixed along the way: worktrees of bare repositories, protected main checkouts and gitdirs, separate git dirs and submodules, and an empty locations frame read as absent.)
- [ ] M4 — sminos: declared locations are known checkouts and rooted projects (desk track; doperpowers) — specified
- [ ] M5 — sminos: the org frame's `locations`, kept and acknowledged; the capability advertised (desk track; doperpowers) — specified
- [ ] M6 — sminos: leaving a project (desk track; doperpowers) — specified
- [ ] M7 — sminos: `project init` and `project show` beside a stored statement (desk track; doperpowers) — specified
- [ ] M8 — The wire and the index: stored statements, the rule, states (architect) — built and reviewed clean on `registry-app` (2026-11-10 11:56Z; d563695ff..bc1c2f7ce, three review rounds at reviewer-high, Decision Logs 13 and 14; class 1a green, run 42809400448); lands with the branch after O15 fixes P5's verified build
- [ ] M9 — The endpoint: the record signed and published, locations to sminos, the directory from the records, the offers (architect) — built and reviewed clean on `registry-app` (2026-11-10 14:07Z; 862266399..11f5be9ca, five review rounds at reviewer-high, Decision Logs 15 and 16; class 1a green, run 42827137236); lands with the branch
- [ ] M10 — Main: the registry read, verified and kept; row keys; held removals (architect) — built and reviewed clean on `registry-app` (2026-11-10 15:17Z; 7407b65e1..cf8e2b2fe, five review rounds at reviewer-high, Decision Log 17; class 1a green, run 42840236348); lands with the branch
- [ ] M11 — The page: one project per id, its locations, Add project, states (architect) — specified; after M10
- [ ] M12 — `maws project` (architect) — specified; after M9 for a machine's own folders, after M11 for another machine's
- [ ] M13 — The live check on three machines, and acceptance (architect, desk track, owner) — specified
- [x] (2026-11-10) This document written from the approved design; the desk track's three requirements carried (Decision Log 1).
- [x] (2026-11-10) First round of both reviews folded: the desk track's seven findings on M1 to M7 and Interfaces §A to §E (Decision Log 5) and the independent reviewer's seven on the whole execution section (Decision Log 6).
- [x] (2026-11-10) The desk track's verdict on the revision of its sections at 26d3d5b56: yes, with three notes folded (its message 735). The document lands on master, and the desk track may start M1.
- [x] (2026-11-10) The independent reviewer's second reading: two details in the app's sections adopted (Decision Log 7). The reviews end here: the round was narrower than the first and left only these.

Each sminos milestone records its sminos version here when it merges (Interfaces §L).

## Acceptance

Acceptance is the design's, items 1 to 11, unchanged. Where each is proved:

| Design acceptance | Proved in the suites by | Proved live at |
|---|---|---|
| 1 (#521: a project with no folder here) | M9 (the directory), M10, M11 | M13 |
| 2 (a folder on one machine, one command) | M3, M5, M8, M9, M12 | M13 |
| 3 (from elsewhere: the app, a terminal) | M11, M12 | M13, the owner's Touch ID |
| 4 (link) | M8, M9, M11 | M13 |
| 5 (clones) | M1 (vectors), M3, M8, M11 | M13 |
| 6 (missing, moved, replaced) | M8, M11 | M13 |
| 7 (offline) | M10 | M13 |
| 8 (removal) | M9, M10, M11 | M13 |
| 9 (signed out) | M8, M11 | M13 |
| 10 (one rule) | M1 (the vectors), M3, M8 | M13 reads three directories on each machine |
| 11 (no session moves twice) | M3, M5, M9 | M13's soak; the two upgrade orders on staging VMs |

Added by this document, measured at M13: the time from a declaration on one machine to its row on another Mac, with both online, is at most 5 seconds (design §16). A longer time is recorded with its cause and decided there.

## Execution

### Constraints (bind every milestone)

1. **The build P5 is verified on comes first** (the owner, 2026-11-10; design Decision Log 9). M8 to M12 change what the app and `mawsd` do, and none of them reaches master before P5's closing verification (O15) has recorded the commit it verified. They may be built on branches before that. M1 and M2 may land at once: M1 adds types and vectors that nothing calls yet, and M2 adds a table and frames that no machine sends until M9 is installed. M3 to M7 merge in doperpowers when the desk track is ready; with no `locations` in the org frame each leaves resolution as it is today but for the one corner design §8 names (a worktree outside its repository takes a `.smns` above its main checkout), which M3's review must show.
2. **One rule, two implementations, one set of vectors.** A directory's project is design §8's rule in sminos (Python) and in MAWS (`deriveOrg`). Neither side reasons from the other's code: both pass the shared vectors (Interfaces §B), and a disagreement between them is a defect in the design, fixed there first.
3. **Nothing is gated on a version string.** MAWS decides by capabilities (Interfaces §L): a sminos that has not advertised `locations` gets no stored statement made for it, a hub that has not advertised `projects` is sent no projects record, an app that has not advertised `machine.project-acts` is asked nothing by `maws`, and a machine whose endpoint has not advertised `rl2.project-acts` is sent none of the new project acts.
4. **Unknown is not empty** (design §3, §8). The endpoint signs no projects record while the index is not loaded. sminos does not resolve by files alone on a machine whose endpoint sends locations and has not sent them yet. A reader never treats a record the hub did not send as a record with no locations. A frame without `locations` erases none.
5. **A stored statement changes only by a person's act** (design §2). No refresh, reconcile, upgrade step or repair writes, clears or moves one, with two exceptions the design names: minting at a declaring moment, and restoring a rebuilt index from the kept file (Interfaces §H).
6. **The hub confers nothing.** Every reader verifies a projects record against the org state it holds (`verifyProjectsRecord`) and keeps a per-machine high-water mark of the revision it accepted. The hub's own check is a courtesy.
7. **Signed out, and on a machine that is not enrolled, everything is as today** (design acceptance 9): no record, no stored statement in force, rows grouped by their key.
8. **Wire and names.** Every change to what crosses `machine.sock` or an RL2 channel is additive under OX1's rule (`src/shared/ipc/wire.ts`): a new command, a new event, a new optional property, a new capability. No existing property becomes required and no enum gains a member, since each of those takes a wire major. `WIRE_MINOR` is bumped by the two milestones that add to the wire, M8 and M12 (Decision Log 2); the machines take one step, at M13's swap. New names are the ones Interfaces fixes; a milestone that needs another name adds it there first.
9. **Gates** (`CLAUDE.md`): class 1a through `scripts/ci-gate.sh <worktree> --gates static,unit,probes`; each app milestone lands on a green `--gates all` and `--gates packaged` run of its tree. Electron e2e runs on a Mac under the load rule, never as a local Electron on the MacBook outside an owner-approved sitting. A sminos milestone runs doperpowers' own suite.
10. **Privacy.** A declared path and an observed remote key are readable by the hub and every member's device (design §11). Nothing else of a folder is published: no file name, no branch, no content. Neither of the owner's email addresses is written into a repository, a PR, the board or a chat.
11. **Copy.** Sentence case, no metaphor, the strings Interfaces §J and §K fix. A state is said in words a person would use: "offline", "folder not found on mini", "replaced".

### Orientation

How the parts fit, for a reader who knows neither track.

- **The index** is a SQLite database on each machine (`<profile>/index.sqlite`), served by the services that `mawsd` (the machine's daemon) loads. Its `projects` table has a row per project folder; `ProjectStore` (`src/services/index/projects.ts`) writes it and `deriveOrg` (`src/services/index/org-project.ts`) computes each row's org project. A row is *declared* when its `origin` is `user` and it is not hidden.
- **The endpoint** (`src/endpoint/`) is the module inside `mawsd` that holds the machine's key, keeps a link to the hub (RL1, `hub-link.ts`), signs the machine's records (`listings.ts`), serves other devices' requests after checking them (`authorize.ts`, `offers.ts`), and talks to the local sminos daemon over a Unix socket (RL10, `rl10/link.ts`). Over RL10 it sends sminos the *org frame*: the org's directory of projects and machines (`rl10/org-directory.ts`), which sminos keeps whole in `daemon/org.json`.
- **The hub** (`apps/desk-hub`) is a Cloudflare Worker with Durable Objects. A per-machine Relay object holds the endpoint's socket (`objects/relay.ts`); the Registry object keeps the org's chain and the machine-signed records (`objects/org-records.ts`) and feeds the members' apps over the Registry socket (OX8).
- **`org-protocol`** (`apps/org-protocol`) is the package of shared types, signing and verification that the hub, the endpoint, the app and desk-web all use. Its vectors live in `apps/org-protocol/vectors/`.
- **Main** (`src/main/org/`) is the app's side of the org: it holds the verified org state, reads the Registry socket (`registry-feed.ts`), verifies and caches listings (`rows.ts`) and hands the page `org.rows`. It reaches other machines over RL2 links (`src/main/lane-b/remote.ts`, `src/main/machines/remote/`).
- **The page** (`src/renderer/src/`) assembles the sidebar's rows from every machine's projects (`stores/org-projects.ts`) and keeps a tab set per row (`stores/layout-model.ts`).
- **sminos** (doperpowers, `sminos/skills/sminos/scripts/`) resolves a session's project from its launch directory (`sminos.py`: `resolve_project`, `smns_at`, `derivation`), keeps the org frame (`sminos_uplink.py`: `keep_org`), and moves a live session whose directory resolves to another project (`_reconcile`, `retire_moved`), which is why the two implementations of the rule must agree.

### Plan of Work

The order, and what each milestone waits for:

```
desk track   M1 ──► M2 ───────────────────────────────┐
              │                                        │
              ├──► M3 ──► M4 ──► M5 ──► M6 ──► M7      │
              │                   │                    │
architect     └──► M8 ──► M9 ────┴──► M10 ──► M11 ──► M13
                           └──► M12 (own folders) ──► M12 (another machine's, after M11)
```

- M1 is first for both tracks: it fixes the record's shape and the vectors that M3 and M8 are built against.
- M3 to M7 are each a doperpowers PR with a sminos version bump, merged by the desk track and rolled out through the plugin marketplace, never through a MAWS swap. Each is useful alone and none needs an app change.
- M8 to M12 are built on branches from the day this document is reviewed and land in order after constraint 1 is met. M9's local suite needs M2 on master. M9's proof of a stored statement reaching sminos needs M5 merged; until then M9 is proved against the RL10 stand-in.
- M13 needs every milestone landed, the production hub deployed with M2 (the owner's command), the three machines swapped to the master that holds M12, and sminos at M7's version on each.

Reviews (Decision Log 1): each milestone's branch is reviewed before it lands, at `doperpowers:reviewer-high` for M1, M2, M8, M9 and M10 (records, signing, identity and the rule) and `doperpowers:reviewer-medium` for M11 and M12; the desk track reviews its sminos PRs by its own practice and the architect reads M3's and M5's diffs against Interfaces §D and §E.

**Decisions made in writing this document.** Each refines something the design left to the spec (design §16, §17) or states a carrier the design did not name. Each is defined once in Interfaces; the reason is here.

1. **`addFolder` takes `own`** (§G). The design says a project of its own inside another project's folder "is by request" and names no argument. A separate verb was the alternative; one flag on the act that already declares is less surface.
2. **A link into a project that is not a hub project is refused** (`not-a-hub-project`, §G). Such a project's log is mirrored by git and never reaches the hub, so a folder linked into it would send its sessions' words to the hub under an id whose other folders write elsewhere. The desk track asked for non-hub `.smns` projects to be excluded explicitly.
3. **A link to the id a folder's own `.smns` names is allowed though no record names it** (§G). It is the act behind the page's "Follow the file", and the machine reads that id from its own disk. Any other id must be in a verified record, or a typing error would create a project.
4. **sminos acknowledges the locations it kept** (`locations-kept`, §D). The design says a statement change answers after the endpoint has restated to sminos. Without an acknowledgement "restated" could only mean "written to the socket", and the app's own flow declares a folder and starts a session in it in two calls with nothing between, where a lane A start is admitted from sminos's org file. A fixed delay was the alternative and guarantees nothing.
5. **The org frame says whether its directory is complete** (§D), because the leaving rule (design §8) is defined over complete directories and sminos cannot tell from a directory's content whether a record was withheld.
6. **The period for leaving is 24 hours of counted time** (§E.4): time during which sminos was connected to an endpoint whose last org frame was complete and lacked the project. Leaving wrongly costs little (the log stays, and the project is followed again when it is listed); the period only has to outlast a restart, a hub outage and a re-keyed machine. A week was the alternative and keeps a removed project in `sminos list --org` for no gain. Counting directories was the first draft and was wrong: the endpoint restates only on a change, so a quiet org would never reach a count, and an outage would read as absence (the desk track's review, Decision Log 5).
7. **The record's revision follows the listing's rule, with a floor taken from the hub** (§H): the later of one past the last and the clock's milliseconds, and never below the revision of the machine's own record as the hub holds it. The design says "a counter as a listing's is"; a plain counter would be refused by the hub after a lost state directory until it passed the old value, and the clock alone does not recover a state file restored from an older copy, or one lost after a clock that ran ahead and was corrected (Decision Log 5).
8. **A rebuilt index is told from an upgraded one by an id kept in the database** (§F.1, §H). The design says a rebuilt index takes its statements back from the kept record. Restoring whenever the index holds fewer statements than the file was the alternative, and would undo an unlink whose file write was lost in a crash.
9. **The kept file holds the statements whole, not only the signed record** (§H): a linked folder's minted id beneath its link is in no record, and a removed row's statement is in none either, and both must survive a rebuilt index.
10. **The row keys and the held removals are main's files** (§I), not fields of the page's layout (M10's decision). A key belongs to one project id only: a label is not an identity, and two clones with one label can be two projects once one of them is linked.
11. **`maws` reaches the app by an event and a command of its own** (§K), shaped as the client port's request and answer are. A ninth client-port kind was the first draft; the kinds are an enum on the wire, and a new enum member takes a wire major (Decision Log 6).
12. **The anchor's birth time is compared where both sides have one, within a microsecond** (§D; Decision Log 3).
13. **A removal names what it expects to remove** (§G): the row's path and project, checked on the target machine in the same step that hides the row. The design binds a held removal to the location as it was when asked; checking only in the app before sending leaves a window in which the machine relocates or relinks the row.
14. **The index's new columns and its one new table are added without moving the database's version** (§F.1), by the opener's existing lists (`ADDED_COLUMNS`, `ADDED_TABLES`), so the build each machine keeps as its rollback still opens the file. A numbered migration would leave the whole index unavailable to that build (`src/services/index/db.ts`).

### M1 — The projects record and the shared vectors *(desk track; a MAWS PR)*

**What exists at its end.** `org-protocol` exports the projects record, its verification and the assembly of projects from records; the shared vectors of design §8's rule and of the record are in the repository, and a unit test proves every record vector.

**What it touches.** `apps/org-protocol/src/` (`types.ts`, `shapes.ts`, `records.ts`, a new `projects.ts`, `index.ts`), `apps/org-protocol/vectors/` (a new `project-rule.json`; record vectors through `generate.ts`), `apps/org-protocol/test/`.

**Interfaces.** Produces §A (the record, `verifyProjectsRecord`, `assembleProjects`) and §B (the vector files and their sync rule). Consumes nothing new.

**Decisions.**
- The record follows the endpoint record's pattern end to end (`Signed<T>`, `signRecord`, `machineSigned`), under the new domain `smns-projects-v1`. The alternative, a field added to the endpoint record, was not taken: that record is fetched per connection attempt and stays small.
- `assembleProjects` lives here, not in the app, because the endpoint (the directory for sminos) and main (the sidebar) must compute the same projects and the same names from the same records (design §9).
- The rule's vectors are written from the design's text, by hand, before either implementation exists. Their expected values are the design's; when an implementation disagrees with a vector, the design is read again and the loser is fixed, never the vector alone (constraint 2).

**It does not touch** `OrgState` (its `projects` field stays unwritten; a comment marks it reserved), the hub, the app.

**It proves.** Every record vector verifies or is refused with the code the vector names. `assembleProjects` gives one project for two records naming one id, names it by §A's order, and leaves a machine's own project out, also that of a devcloud VM that exists only by its certificate. The rule's vector file parses against its schema and holds every case §B lists.

### M2 — The hub keeps and hands out projects records *(desk track; a MAWS PR; staging deploy)*

**What exists at its end.** A machine's endpoint can send its projects record up, the hub keeps the newest per machine, every member's app receives all of them on the Registry socket, and every machine's endpoint receives all of them on its own socket.

**What it touches.** `apps/desk-hub/src/objects/org-records.ts` (storage), `objects/relay.ts` (the up frame, the down frames to the endpoint), `objects/registry.ts` (the app socket's snapshot and live frames), `apps/org-protocol/src/relay.ts` (the capability), `apps/desk-hub/test/`.

**Interfaces.** Produces §C. Consumes §A.

**Decisions.**
- Storage is a table of its own, `projects_records`, one row per machine ref at its highest revision. The Registry's existing `projects` table (the projects that have a log, filled at a machine's `hello`) keeps its meaning and is not touched.
- The hub hands every record to every member and every machine, as it hands listings (design §11). It filters nothing by owner.
- A record of a machine the head has retired stops verifying at every reader. The hub may keep its row; pruning is not required.
- The hub's `projects` table keeps the name of a project's first `hello`, so the phone and desk-web show a project's old name after a rename (design §5): a tracker row, not this milestone's work.

**It does not touch** the log plane, the Worker's `unknown-project` check, desk-web.

**It proves.** In desk-hub's suite: a record is stored; the same bytes again are taken with nothing stored; a revision not above the held one is refused `stale-projects`; a record that fails verification is refused with its verdict's code; the app socket's snapshot carries the records after the listings pages and a later record arrives live; an endpoint socket receives the snapshot after its welcome and the live frame after another machine's change; the welcome advertises `projects` only once the Registry has answered the probe, proved with a Relay of this build against a Registry of the build before and the reverse, since one deploy replaces the two objects at different moments and a suite on one build shows neither.

**After landing** the desk track deploys the merged master to staging. Production's hub takes it at the owner's next production deploy.

### M3 — sminos: the rule and canonical paths, against the vectors *(desk track; doperpowers)*

**What exists at its end.** sminos resolves a directory's project by design §8's rule whenever its kept org frame holds `locations`, and passes the shared vectors. With no `locations` it resolves as today, but for the worktree corner constraint 1 names.

**What it touches.** In doperpowers, `sminos/skills/sminos/scripts/sminos.py` (`smns_at`, `_read_project`, `resolve_project`, `project_source`), `sminos/tests/` (the vendored vectors, their pin and its check, a harness that builds each vector's tree).

**Interfaces.** Consumes §B and §D's `locations` shape as a file fixture. Produces §E.1.

**Decisions.**
- sminos reads stored statements only from the last kept `daemon/org.json`, synchronously, with no daemon running (design §8). The capability is not advertised yet, so no endpoint sends the field: the code is exercised by the vectors alone until M5.
- Paths are compared in the canonical form (the real path, NFC). Whether sminos also compares a statement's folder by device and inode is the desk track's choice (design §16); the vectors are the contract either way. A statement whose anchor does not match the folder at its path does not count (§D).
- `project_source` gains the cases "a link at X" and "a stored id at X", so `sminos project show` can say what decided (M7 uses them).

**It does not touch** the uplink, `keep_org`, the hello.

**It proves.** Every case of `project-rule.json` gives the vector's project and deciding source, and every `anchors` case compares as the vector says. The pin check fails, naming the vendored file's hash and the pinned one, when they differ. With an org file that has no `locations`, every earlier resolution test passes unchanged.

### M4 — sminos: declared locations are known checkouts and rooted projects *(desk track; doperpowers)*

**What exists at its end.** A folder declared a moment ago, with no session in it yet, is admitted for a spawn, appears in the machine's presence, and its project is held, not merely followed.

**What it touches.** `sminos_policy.py` (`known_checkouts`), `sminos.py` (the registration of a declared project with its root and its hub), `sminos_uplink.py` (`Link.holds`), their tests.

**Interfaces.** Consumes §D. Produces §E.2.

**Decisions.** Every declared location that is neither `missing` nor `replaced` counts as a known checkout, whatever decided its project. A declared project is registered rooted at its location with its hub set only where the location is eligible for the hub, that is, where its entry does not say `hub: false`; then `holds` is true for it. A location that says `hub: false` (its `.smns` names no hub, or another org's) is a known checkout and resolves as §E.1 says, and its project's registration and transport are left exactly as they are today: registering it with this org's hub would rewrite its transport and stream a git-mirrored log to the hub. A project with several locations on the machine keeps one root, as today (`kept_root`).

**It does not touch** resolution (M3), the frame's keeping (M5).

**It proves.** With an org file naming a declared folder that has no session: `admit_spawn` admits a spawn there, the presence lists it, and the project's hello says `follow: false`. A declared folder whose `.smns` names no hub, and one whose `.smns` names another org, are each admitted for a spawn and keep the registration and transport they have today.

### M5 — sminos: the org frame's `locations`, kept and acknowledged; the capability advertised *(desk track; doperpowers)*

**What exists at its end.** sminos keeps the org frame's `locations` and `complete` fields with the directory in one atomic write, tells the endpoint which revision it kept, and advertises `locations` in its hello. From this version on a machine's MAWS makes stored statements.

**What it touches.** `sminos_uplink.py` (`keep_org`), `sminos_rl10.py` (`CAPABILITIES`, the acknowledgement frame), `sminos.py` (the reading of an unknown state), their tests.

**Interfaces.** Consumes and completes §D. Produces §E.3.

**Decisions.**
- A frame without `locations` keeps the locations already held (design §8). A frame with `locations` replaces them whole.
- On a machine whose endpoint's welcome lists `locations` and whose org file holds none yet, a session keeps the project sminos recorded for it and is not resolved again by files alone (constraint 4). Beside an endpoint whose welcome lists no such capability, sminos resolves as today.
- The move of a declared folder's sessions out of the machine's project into its new one is the reconcile sminos already has (`_reconcile`); no migration is written (design §8, "At the upgrade").

**It does not touch** the leaving rule (M6).

**It proves.** The org file after a frame holds the directory and the locations together, and the acknowledgement names the frame's `gen`. After a same-path "Use this folder", which changes an anchor and nothing in the record, the acknowledgement is a new one and resolution uses the new anchor at once. A frame without the field leaves the held locations. Over a daemon restart, a deleted org file, and a welcome that promises locations before any frame arrives, a session's count of `moved` events is at most one (design acceptance 11, sminos's part). A hello to an endpoint lists `locations`.

### M6 — sminos: leaving a project *(desk track; doperpowers)*

**What exists at its end.** A project that sminos follows and holds no folder of leaves once §E.4's counted time has passed: it is no longer streamed and no longer listed by `sminos list --org`. Its log stays on disk, and it is followed again when a directory lists it.

**What it touches.** `sminos_uplink.py` (`hub_projects`, the counted time kept per project), `sminos.py` (`org_scope` and the listing, which read the same kept set), their tests.

**Interfaces.** Consumes §D's `complete`. Produces §E.4.

**Decisions.** The rule is conservative by construction: time under an incomplete directory, under a directory from an endpoint that sends no `complete` field, and while disconnected from the endpoint is not counted. Having left is one kept set of project ids that both the uplink's subscription and the command line's org scope read, so a project that left is absent from both and not from one. The alternative, the endpoint listing vanished projects as retired, was not taken: the endpoint would have to remember every project it ever listed.

**It does not touch** projects sminos holds a folder of, machine projects, a project the directory marks retired (which leaves at once, as today).

**It proves.** A followed, rootless project that complete directories lack for the counted period leaves: it is in neither the uplink's subscription nor `sminos list --org`, and its log directory is still there. A stretch disconnected, or under an incomplete directory, adds nothing to the count. A directory that lists the project sets the count to zero, and a project that had left is followed again. A project held here never leaves by this rule.

### M7 — sminos: `project init` and `project show` beside a stored statement *(desk track; doperpowers)*

**What exists at its end.** In a folder with a stored statement, `sminos project init` writes the id in effect and says that a stored statement decides here; `sminos project show` says when a stored statement overrides a `.smns` in the folder, and which kind it is.

**What it touches.** `sminos.py` (`project_init`, the `project show` text), its tests.

**Interfaces.** Consumes §E.1's sources. Produces §E.5.

**Decisions.** `project init` beside a link and a stored id writes the link's project, the id in effect (design §17). It still requires a git repository, as today; a plain folder is declared with `maws project add`, and `init`'s refusal there says so.

**It does not touch** any path that writes a stored statement: sminos never writes one.

**It proves.** In a linked folder `init` writes the link's id and prints the sentence §E.5 fixes; `show` in a folder whose `.smns` names another project than its stored statement prints both and which decides.

### M8 — The wire and the index: stored statements, the rule, states *(architect)*

**What exists at its end.** On one machine, with no network involved: a folder is declared, linked, unlinked, relocated, renamed and removed through `session.projects.*`; the index keeps each folder's stored statement, its anchor, its name counter and its state; `deriveOrg` gives every row the project design §8's rule gives; a folder is minted at the declaring moments and at no other; a folder holding a `.smns` becomes declared when a session runs in or beneath it. Stored statements are made only while the registry seam (§H) says they may be, and M8 ships that seam's default, which says no: until M9 a machine behaves as today.

**What it touches.** `src/services/index/` (`migrations.ts`, `projects.ts`, `org-project.ts`, `index.ts`, `add-folder.ts`, `register.ts`, new files for statements and for the folder checks), `src/shared/ipc/schema/session.ts`, `src/shared/ipc/grades/session.ts`, `src/shared/ipc/wire.ts` and the wire manifest, `src/shared/machine/` (the seams' types), their tests, and `test/fixtures/` for the MAWS harness over `apps/org-protocol/vectors/project-rule.json`.

**Interfaces.** Produces §F (the index's columns, the rule in MAWS, minting, states) and §G (the commands and their refusals), and the types of §H's two seams. Consumes §A's types and §B's vectors.

**Decisions.**
- **A row's label does not change.** `org_key`, `org_name` and `org_source` stay what the folder's files derive (design §2, §3). The project the rule gives is carried in `org_smns_id`, which until now held sminos's id for `.smns` and remote rows only. It stays null when the rule gives the machine's own project, so a signed-out page and every existing consumer of `ProjectOrg.smnsId` read what they read today.
- **Statements are in force only on an enrolled machine** (constraint 7). With no enrollment the lookup answers none, and `deriveOrg` is today's function.
- **The folder holding the deciding `.smns` is the declared one** (the owner's second answer, design §12): when a session runs in a directory whose project a `.smns` decides, the row of the folder that holds that file is made the user's, as a first MAWS use does today (`usedByMaws`), creating the row when there is none. It never un-hides a removed row. In a linked worktree the folder is the main checkout, not the worktree's own copy of the file.
- **After a statement change** the changed folder's own row is derived again before the command answers; rows beneath it are derived again through the refresh queue (`refreshOrgProjects`'s slots) after the answer. For a moment the page may still file a subfolder's sessions under their old row. The alternative, deriving every row beneath before answering, makes an add of a folder with hundreds of rows beneath it wait on hundreds of git calls.
- **The anchor is checked at every lookup,** not only by the ten-minute check: one `stat` of a folder per statement consulted. A session started in a replaced folder is therefore not filed in the old project even before the periodic check has run (design acceptance 6).
- **Pitfalls seen in the code.** `ensureForDirectory(…, 'user')` un-hides; the `.smns` promotion must not go through it. `ProjectStore.update` writes `org_name` for folder rows; the name counter is written in the same statement. `locate()` folds a worktree under its main checkout before any of this runs, so a statement is never made on a worktree. The `org_source` CHECK and the wire enum keep their four values. Rows are never deleted today; `relocate`'s merge is the one place a row is deleted (§G).
- **`WIRE_MINOR`** goes from 33 to 34 here. The design's "one `WIRE_MINOR` bump" is one step for the machines, which swap once, from 33 to the value master holds at M13; on master M12 bumps it once more for its own commands and event (Decision Log 2). Everything M8 adds is additive (constraint 8): the new arguments and the new fields of an answer are optional, and a peer that lacks them is told apart by the capability `rl2.project-acts` (§G), which M8 declares and M9's endpoint advertises.

**It does not touch** the endpoint, the offers, main, the page. `session.projects.add` and `addFolder` without the new arguments answer as before.

**It proves.** The MAWS harness builds each case of `project-rule.json` on disk and `deriveOrg` gives the vector's project and source for every asked directory (design acceptance 10, MAWS's half), and the anchor's comparison gives every `anchors` case's answer. On Linux a folder on a filesystem with no birth time is anchored with birth `"0"`, never with its change time. The opener adds the columns and the table to a current database without moving its `user_version`, every row and key kept, and the same file opens afterwards with the migrations and added lists of the build before this one. The wire manifest's change classifies as additive, with nothing breaking. The minting table of §F.4, case by case. A removed row's statement does not count, and adding the folder again restores the same id. A link and its removal return the folder to its minted id. `relocate` merges an unstated row at the new path and refuses a stated one. A deleted folder reads `missing`, a different folder at the path reads `replaced`, a folder the process may not read reads present. A `.smns` written into a minted folder, and removed again, changes no row's project. A rename sets the name counter one above the highest the seam reports for the project. With the seam's default, every earlier test of the index passes unchanged (design acceptance 9).

### M9 — The endpoint: the record, locations for sminos, the directory, the offers *(architect)*

**What exists at its end.** An enrolled machine's endpoint signs its projects record after every change to a declared row and sends it at every welcome; keeps it on disk and gives a rebuilt index its statements back; verifies and keeps the other machines' records; sends sminos an org frame that carries this machine's `locations` and whether the directory is complete, with every project the records name listed as a hub project; and serves the project commands to other devices. From this milestone a machine whose sminos advertises `locations` makes stored statements.

**What it touches.** `src/endpoint/` (new modules for the machine's own record and for the held records; `hub-link.ts`, `endpoint.ts`, `state/store.ts`, `offers.ts`, `rl10/link.ts`, `rl10/org-directory.ts`, `rl10/members.ts`), `src/mawsd/daemon.ts` (the two seams wired between the loaded services and the endpoint), their tests under `src/endpoint/` and `test/endpoint/`, and the text of RL §5.9 in `docs/doperpowers/specs/2026-10-26-remote-layer-design.md`, which gains declared paths and observed remote keys among what the hub and members' devices read (design §13).

**Interfaces.** Produces §H (the kept file, publishing, the held records, the seams' implementations) and the endpoint's half of §D. Consumes §A, §C, §F, §G.

**Decisions.**
- **A record is signed when its content changes, and resent byte for byte otherwise,** as a listing is (`listings.ts`). Its revision follows the listing's rule: the later of one past the last and the clock's milliseconds, and never below the revision of its own record as the hub holds it (§H), so it rises across a lost state directory, a state file restored from an older copy and a corrected clock.
- **`known`** is read as the desk track advised: a project counts when sminos holds it (its hello's `follow` is false) and its set of sessions from this machine is not empty, and no declared location here has its id, and it is not the machine's own project. It drops out when its last session ends.
- **A statement change answers after sminos's acknowledgement** (§D), waiting at most `RESTATE_WAIT_MS` (2,000 ms). With no sminos connected, or none that acknowledges in time, the command still succeeds and its answer says `restated: false`; the page shows nothing for it and `maws` prints one line. The alternative, failing the command, would make a folder impossible to declare while sminos restarts.
- **The directory.** Hub projects are the records' (`assembleProjects` over the held records and this machine's own), in place of `head.projects`. A project any of whose locations says `hub: false` is left out. A project's name is §A's.
- **Offers.** `session.projects.link`, `relocate`, `update` and `remove` join `addFolder` as machine acts graded `machine-admin` for the machine's owners alone; `addFolder`, `link` and `relocate` are always stepped up (design §3). `session.projects.resolve` is an owners' call, as `machine.folders.list` is. Over the network `update` takes a name alone: a row's order is its own machine's. `relocate` and `resolve` name a directory, so they join the commands whose directory the endpoint checks against the machine's setup policy before anything reads in it, and a remote `addFolder` with `into` or `own` keeps today's checked path (`setupAddFolder`). The endpoint lists `rl2.project-acts` in its RL2 handshake from this milestone, which is how an app tells a machine that serves these from one that does not (§G).
- **Pitfall.** `#restate` sends a restatement only when the head changed; it must also run when this machine's record or the held records change, still one at a time.

**It does not touch** the index's rules (M8), main, the page. It does not change what a listing carries.

**It proves.** A local suite, two endpoints against the hub in Miniflare: a folder declared on A is in B's held records, and B's org frame lists its project as a hub project, also after B restarts with the hub unreachable (design acceptance 1 and #181, the directory's half). An index that is not loaded signs nothing. An endpoint started on a state file older than what the hub holds, with its clock behind that revision, is refused once, takes its floor from its own record in the hub's snapshot, and its next record is stored. A replaced index takes its statements back from the kept file and the next record carries the same ids. A record below a machine's mark is ignored; a retired machine's record is dropped. `complete` is false until the hub's snapshot ended, and false when a machine the endpoint has held a record of is missing from it. A statement change's answer waits for the acknowledgement and answers `restated: false` after the wait. Over the endpoint's acceptance harness: an owner's `addFolder {into}`, `link` and `relocate` without a step-up are refused, a non-owner's are refused, `update` and `remove` need no step-up, an unknown `into` is refused `unknown-project`. Across an endpoint restart sminos's stand-in receives the same locations and no session is told to move (design acceptance 11, the endpoint's part).

### M10 — Main: the registry read, verified and kept; row keys; held removals *(architect)*

**What exists at its end.** The app's main process receives the projects records with the listings, verifies each, keeps them across a relaunch, and hands the page the registry as the signed-in member may see it; it assigns each project its row key on this device once; it keeps a removal for a machine that is off and delivers it when the machine returns; and it sends the new project acts over a machine's link.

**What it touches.** `src/main/org/` (`registry-feed.ts`, `rows.ts`, `register.ts`, `channel/channel.ts`, new modules for the records, the key table and the held removals), `src/shared/ipc/schema/org.ts`, `src/shared/machine/org-key.ts`, `src/main/lane-b/remote.ts`, `src/main/machines/remote/dispatch.ts`, their tests and `test/org/`.

**Interfaces.** Produces §I. Consumes §A, §C, §G.

**Decisions.**
- **Records are replaced only by a higher revision.** Unlike listings, the hub's snapshot removes nothing: a machine the snapshot lacks keeps its last verified record (constraint 4). A record leaves only when it stops verifying.
- **The join is by id.** `joinIds` goes: a listing's row key is the key table's entry for its `project`. A key written in a record is a label and joins nothing (design §6).
- **What a member sees** (design §11): the locations on machines they own or hold a grant on, with actions where they own the machine; and a project they see a session of, with its sessions and no locations.
- **The key table and the held removals are main's files,** not the page's layout: there is one per device whatever the number of windows, and a build that is rolled back ignores files it does not know, where it would reject a layout it could not parse.
- **The Channel** accepts any hub project of the registry view, not only one this Mac holds a folder of.

**It does not touch** the page's assembly (M11), the endpoint.

**It proves.** A local suite against the hub in Miniflare and a real endpoint: the view lists the endpoint's project; after a relaunch with the hub unreachable it still does (design acceptance 7); a record whose location names another project's key moves no session; a retired machine's locations are gone (acceptance 8). Unit: the marks' rules; the member's view in the three cases; a key assigned once and unchanged after the device's own location is removed; two of this device's rows with one label and two project ids given two keys, also when the table is first filled with both present; a project that lost its last location to another project named in `moved`, one whose locations moved twice mapped to their present project, and one that came back and was then removed mapped nowhere; a held removal sent with its expectation when its machine's link comes up, and cancelled on request. Over the endpoint's harness: a held removal whose row was relocated or relinked on the machine after the app's last record is refused `changed` and removes nothing; one for a declared subfolder whose parent was relinked, with the subfolder's own refresh held back, is refused `changed` too; one whose rule gets no answer is refused `unresolved` and stays held.

### M11 — The page: one project per id, its locations, Add project, states *(architect)*

**What exists at its end.** The sidebar lists every project of the org the person can reach, one row per project id, each naming its machines; a location reads offline, folder not found or replaced when it is; the hover card lists the locations with their actions; Add project takes a machine, a folder and optionally a project; "Add location…" adds a folder to a project; "+ Session" offers the project's locations from the record; a suggestion is shown where a folder's files name another project than its stored statement; Remove from sidebar removes every location and shows the removals that wait for a machine.

**What it touches.** `src/renderer/src/stores/` (`org-projects.ts`, `layout-model.ts`, `layout.ts`, the sessions store's projects), `src/renderer/src/ipc/events.ts`, `src/renderer/src/sidebar/`, `src/renderer/src/sessions/` (`remote-setup.ts`, `remote-spawn.ts`, `actions.ts`), their tests, a new `e2e/registry.spec.ts` with its fixture.

**Interfaces.** Produces §J. Consumes §I and §G.

**Decisions.**
- **Other machines' locations enter the page's projects map as project records** (their address from the machine and `pid`), built from `org.projects`, so the code that already reads that map (the hover card, "+ Session", the row's actions) reads them unchanged. The alternative, a second structure beside the map, would duplicate each of those readers.
- **The whole-set move** generalises `rekeySets`, `rekeyContexts` and `rekeyExpanded` from address keys to any key that is no longer a row (§J.2). `refile` still moves session tabs one at a time when a single session's project changes.
- **The order of rows with no folder on this Mac** is provisional: after this Mac's rows, by name. It is shown to the owner at M13 (design §16).
- **Nothing links unasked** (design §2). A suggestion is a line on the row with one button.

**It does not touch** the Org page, the Channel tab's content, the session panes.

**It proves.** Unit: two keys with one id are one row; two rows with one label and two ids are two rows; a row with no id is grouped by its key; a location carrying its machine's own project id makes no row; the name follows §A; the whole-set move takes a set's file and artifact tabs with it, for a label key and for an `id:` key whose project's locations were linked into another, panel contexts and expanded entries included. E2e over a fixture registry: a project with no folder on this Mac is a row with its machine named; a missing, an offline and a replaced location each read as §J.3 says; Add project on a fixture machine sends `addFolder` with the chosen project; a pending removal is listed and can be cancelled. Every existing sidebar spec passes with the app signed out (design acceptance 9).

### M12 — `maws project` *(architect)*

**What exists at its end.** A command `maws` beside `mawsd` on every machine where the daemon is installed. `maws project add|list|show|remove|link` act on the machine's own folders with the profile's token alone. `list`, `show` and a project named by `--into` read the org's projects from the daemon, with no app. Aimed at another machine (`maws project add mini:/srv/scrape`) on a Mac where MAWS runs signed in, the request is shown in the app, confirmed with Touch ID there, and its result printed in the terminal. With no app, a command aimed elsewhere is refused with what to do instead.

**What it touches.** `src/mawsd/` (`cli.ts` or a new module beside it, `install.ts`, `front.ts`, `daemon.ts` for the registry read's wiring), `src/shared/ipc/schema/` (the three commands and the event of §K), `src/shared/ipc/wire.ts` and the manifest, main's handler of the act request and a confirmation sheet in the page, their tests.

**Interfaces.** Produces §K. Consumes §G, §H's `RegistryRead` (for `list`, `show` and `--into`), §I (the act's sending).

**Decisions.**
- **`maws` is the `mawsd` program started with `maws` as its first argument,** installed as a second wrapper and, for the default profile, a second link beside `mawsd`'s. No second entry point is packed.
- **It finds its daemon as sminos finds its endpoint:** `--profile`, else `MAWS_USER_DATA`, else the platform's default profile (`sminos_rl10.py` reads the same two). So on a machine with several profiles `maws` and sminos speak to the same one (design §17).
- **`list`, `show` and the resolution of `--into` are answered by the daemon** through one command of the front, `projects.registry`, served from the endpoint's held records and the machine's own, so they work on a VM with no app. Only a change aimed at another machine needs the app, because only a member's device can sign that act.
- **The way to the app** is an event to the attached app and a command for its answer (§K), modelled on the client port's request and answer and routed as the port routes a request with no asking client: to the connection whose hello names the attached app, and only when that hello lists `machine.project-acts`. With no such app the daemon answers the terminal at once. The client port itself is not extended (Decision Log 6).
- **`WIRE_MINOR`** is bumped once more here, for `projects.registry`, `projects.forward`, `projects.act.request` and `projects.act.answer`.

**It does not touch** the endpoint's offers, the index's commands, the client port.

**It proves.** Unit, on a scratch profile with a stand-in daemon: each verb's output and exit code as §K fixes them; `--into` with a name two projects share lists both and exits 1; a target on another machine with no capable app exits 2 with §K's sentence. Against a real daemon with an enrolled endpoint and no app: `maws project list` prints a project held only on another machine, and `--into` resolves it by name. A local suite with a stand-in app answering the act request: the act reaches the target endpoint and the terminal prints its result; the app's connection ending while a request waits ends the wait with the refusal. `install` writes both wrappers and both links, and `uninstall` removes them. The manifest's change is additive.

### M13 — The live check on three machines, and acceptance *(architect, desk track, owner)*

**What exists at its end.** Design acceptance 1 to 11 observed on the MacBook, the mini and one devcloud VM in production's org, recorded here with their evidence; MAWS #521 and the desk board's #181 closed.

**Preconditions.** Every milestone landed; O15's verified build recorded (constraint 1); production's hub deployed from a master that holds M2 (the owner's command); the three machines swapped to the master that holds M12, each keeping its previous build as its rollback; sminos at M7's version or later on each.

**What it does.** The steps are Concrete Steps §4. Three parts need a person: the owner's Touch ID for each `addFolder`, `link` and `relocate` sent from the app to another machine (acceptance 3, 4 and 6); the owner's look at the order of rows with no folder on this Mac; and the production hub deploy. Everything else the architect and the desk track drive and read.

**Decisions.**
- **What the upgrade does on each machine is read before the swap and told to the owner:** the declared folders that will be minted, and the `.smns` folders that will become rows. On the MacBook's index of 2026-11-10 that is four folders minted (three of them scratch folders under `/private/tmp`) and the visible `.smns` folders with sessions made rows.
- **A rollback after the swap** opens the same index (§F.1) and ignores its stored statements, while its older endpoint sends sminos no locations, so the sessions in minted and linked folders are filed by their files again and move once more. It is the exception the kept build exists for, and it is said to the owner with the swap's notice.
- **The two upgrade orders** (acceptance 11: `mawsd` before sminos, and sminos before `mawsd`) are run by the desk track on two devcloud VMs in staging's org, since each production machine can be upgraded in one order only.
- **The soak** for acceptance 11 is one hour with a daemon restart on each machine, the org file deleted once on the VM, and a `.smns` written into and removed from a minted folder; afterwards every session's `moved` count in sminos's logs is at most one.

**It proves.** The acceptance table's last column, item by item, and the 5-second bound.

### Concrete Steps

Run from the milestone's worktree (`.claude/worktrees/<name>` of the repository) unless a step says otherwise. Expected output is the suite's own summary with no failure; a step that prints something else is named.

**1. M1 and M2 (the desk track's MAWS PRs).**

    pnpm --filter org-protocol vectors      # regenerates vectors/vectors.json; `git diff --stat` then shows only the new record vectors
    pnpm --filter org-protocol typecheck && pnpm --filter org-protocol test
    pnpm --filter desk-hub typecheck && pnpm --filter desk-hub test
    scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label registry-m1

Landing is the architect's, as for every desk-track PR: a plumbing merge on master, the static gate on the merged tree, the tree hash compared with the gated run's, then the push. After M2 the desk track deploys staging with its own deploy command and reads the welcome of a staging endpoint for `projects`.

**2. M3 to M7 (doperpowers).** In the doperpowers checkout the desk track runs sminos's suite as it does for every sminos PR. The vendored vectors are refreshed only by the sync script of §B, from a named commit of MAWS's master:

    sminos/tests/vectors/maws/sync.sh <path to a MAWS checkout> <commit>     # copies project-rule.json, rewrites the pin
    python3 sminos/tests/project_rule_parity.py                              # every case: "ok <name>"; the last line "N cases, 0 failed"

The script's and the test's names are the desk track's to change in its review. A copy that differs from its pin fails with one line naming both hashes: `project-rule.json: vendored <sha256> is not the pinned <sha256> (MAWS <commit>)`.

**3. M8 to M12 (the app).** On the MacBook only focused runs: eslint on one file, vitest on one test file, never a typecheck of any kind, the whole lint or a directory of tests (Decision Log 12). The whole lint, the typecheck and the unit suite are class 1a's.

    pnpm exec eslint <one file>                                    # local, one file at a time
    pnpm exec vitest run --project node <one test file>            # local, one file at a time; e.g. M9's test/endpoint/projects.local.test.ts, M10's test/org/projects.local.test.ts
    MAWS_WIRE_MANIFEST_WRITE=1 pnpm exec vitest run src/shared/ipc/wire.test.ts            # M8, M12, then the same for wire-fingerprint.test.ts:
                                                                   #   the manifest's diff is the new and changed names only
    scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label registry-m<n>     # each boundary: lint, typecheck, unit (renderer included), probes
    scripts/ci-gate.sh "$PWD" --gates all --label registry-app     # the branch's final head, with --gates packaged beside it (Decision Log 10)

`e2e/registry.spec.ts` (M11) runs in the gate's e2e groups on the Mac the gate uses, not locally on the MacBook.

**4. M13 (live).** Each line names who acts. Machine names: `macbook`, `mini`, and production's devcloud VM, today `dc-linux171-1e68` (written `vm`).

1. *Architect, before the swap.* On each machine read the declared rows that will be minted and the `.smns` folders that will become rows (a read-only query of `index.sqlite`), and send the owner the list.
2. *Owner.* The production hub deploy from the master that holds M2. *Desk track and mini-ops.* The swap of the three machines; each reads `mawsd status` for the build and wire minor, and its sminos version.
3. *Architect, on `mini` over SSH.* `mkdir -p /tmp/registry-live/scrape && cd /tmp/registry-live/scrape && maws project add .` prints `added scrape as a new project (<id>)`. The time until the MacBook's sidebar shows `scrape`, marked `mini`, is measured from the command's return (acceptance 2; the 5-second bound).
4. *Architect.* "+ Session" on that row from the MacBook starts a session on `mini` in that folder; a session started in a terminal on `mini` in `scrape/sub` is under the same row; `sminos list --org` on the MacBook and on `vm` shows both under `scrape`; the project's Channel tab shows a to-human message from each (acceptance 1 and 2).
5. *Owner at the MacBook.* Add project, machine `vm`, folder `/tmp/registry-live/other`, Touch ID. Then in the MacBook's terminal `maws project add vm:/tmp/registry-live/third`, confirmed in the app with Touch ID (acceptance 3).
6. *Owner.* "Add location…" on `scrape`, this Mac, a new folder; Touch ID is not asked for this Mac's own folder. The row reads `mini · macbook`; a session in each sits under it; `sminos list` on both machines files them in one project (acceptance 4).
7. *Architect.* Clones: a repository cloned on `mini` and `vm`, one clone with a pinning `.smns`, is one row with no act; a clone made under `scrape` stays in its repository's project (acceptance 5).
8. *Architect.* On the MacBook rename the folder of step 6 on disk: its location reads "folder not found on macbook" within ten minutes or at the next start there; Locate… restores it. Delete it and clone an unrelated repository at its path: it reads "replaced", and a session started there is not in `scrape` (acceptance 6).
9. *Architect.* Stop `mawsd` on `mini`, relaunch MAWS on the MacBook: `scrape` is listed, its `mini` location "offline" (acceptance 7). Remove the `vm` project of step 5 while `vm`'s daemon is stopped: the removal is listed as pending and delivered when `vm` returns (acceptance 8).
10. *mini-ops, on the mini.* A scratch profile that never signed in, opened with the new build: its sidebar lists the same projects and sessions as the previous build did on that profile (acceptance 9). The e2e suite is this item's main proof; this is its live reading.
11. *Architect.* On each machine, for three directories (one declared plain folder's subfolder, one clone, one worktree) `sminos project show <dir>` and `maws project show <dir>` name the same project (acceptance 10).
12. *Architect and desk track.* The soak and the two upgrade orders (M13's decisions); then `/tmp/registry-live` and its projects are removed everywhere (acceptance 11).

### Interfaces and Dependencies

Each interface is defined once here. A milestone names the sections it produces and consumes.

#### §A. The projects record (`apps/org-protocol`)

In `src/types.ts`, beside the endpoint record:

    SIGNING_DOMAINS.projects = 'smns-projects-v1'

    type ProjectLocation = {
      pid: string            // the machine's own id of the row; a command to the machine names the row by it
      id: string             // the project the rule gives this folder; the machine's own project id when the rule gives that
      key: string            // the folder's label on its machine (an OrgKey): what its files derive. It joins nothing
      name: string           // the location's own name (below)
      nameRev?: number       // set at a rename on this machine (§G)
      path: string           // absolute, the real path, NFC
      source: 'smns' | 'remote' | 'repository' | 'folder'    // the label's kind
      stated?: 'minted' | 'linked'                            // present when a stored statement decides `id`
      hub?: false            // `id` is decided by a `.smns` that names no hub of this org
      remote?: string        // the repository's observed remote key (sminos's `remote_key`), whatever decided `id`
      state?: 'missing' | 'replaced'
    }
    type KnownProject = { id: string; name: string }
    type ProjectsRecord = { org: string; machine: MachineRef; revision: number; issued: string; locations: ProjectLocation[]; known: KnownProject[] }

- **A location's own `name`:** the deciding `.smns`'s name when a file decides; else the name chosen by a rename when `nameRev` is set; else the remote's name (`remote_name`) when the repository has a remote; else the folder's base name.
- **Shape and bounds** (`isProjectsRecord` in `src/shapes.ts`): at most 1,000 locations and 1,000 known projects; the canonical form of the record's body (what the signature covers) at most 262,144 bytes; `revision` a positive safe integer; `path` starting with `/`, NFC, at most 4,096 bytes; `pid` and `id` of the form `[A-Za-z0-9._-]{1,64}`; `key` at most 600 bytes; `name` 1 to 128 characters; `remote` at most 512 bytes; no two locations with one `pid` or one `path`; no two known projects with one id, and none with a location's id.
- **Verification** (`src/records.ts`): `verifyProjectsRecord(state, record, certs, now): Promise<Verdict>`, through `machineSigned` exactly as `verifyEndpointRecord`.
- **Assembly** (new `src/projects.ts`), the one function the endpoint and the app both call:

      type RegistryProject = {
        id: string; name: string
        hub: boolean                 // false when any location says `hub: false`
        renamable: boolean           // false when a location's project is decided by its `.smns`
        locations: Array<ProjectLocation & { machine: MachineRef }>    // ordered by machine ref, then path
        known: MachineRef[]          // machines with sessions of it and no location
      }
      function assembleProjects(records: readonly ProjectsRecord[], machineProjects: ReadonlySet<string>): RegistryProject[]   // ordered by id

  `machineProjects` holds the id of each machine's own project. Two exported functions give machine names, each caller mapping a name to its id with `machineProjectId(org, name)`:
  - `directoryMachineNames(state, certificates, now)`: the names the endpoint's directory lists, each with a machine project and a `machines` entry. They are the enrolled machines' names and the names of certificates under a live, unrevoked delegation (today's `machineNames` in `src/endpoint/rl10/org-directory.ts`, moved here unchanged). A former name is not among them: in the directory it would read as an enrolled machine that is never online.
  - `machineProjectNames(state, certificates, now)`: the set `machineProjects` is built from, by the endpoint and by the app alike. It is the directory's set plus every name `state.machineNames` binds to a ref `state.machines` still holds, the former names of enrolled machines, so a session recorded under a renamed machine's old machine-project id is that machine's own project and registers nothing.

  A location or a known entry carrying one of those ids makes no project: its sessions sit under their machine's row (design §4).
- **A project's name** (design §9), the first that applies: (1) the `name` of a location with `source: 'smns'` and no `stated`, the first in order; (2) the `name` of the location with the highest `nameRev`, a tie going to the earlier in order; (3) the `name` of the first location in order that has `remote` and is not `stated: 'linked'`; (4) the `name` of the first location in order, those not `linked` before those that are; (5) with no location, the `known` name from the lowest machine ref.

#### §B. The shared vectors and their sync rule

Owned in `apps/org-protocol/vectors/`: `project-rule.json` (the rule) and the record's vectors in `vectors.json` (written by `generate.ts`, as the other records' are: a valid record, a wrong domain, each bound exceeded by one, a duplicate `pid`, a relative path, a retired machine's record).

`project-rule.json`:

    { "about": "…", "version": 2, "org": "<org>", "machine": "<machine name>",
      "cases": [ { "name": "…", "platform"?: "darwin" | "linux", "under"?: "/tmp",
                   "tree": [ Entry… ], "statements": [ Statement… ], "ask": [ Ask… ] } ] }

    Entry     = { "dir": P }                                        // a folder
              | { "repo": P, "remote"?: URL, "remotes"?: { name: URL } }   // a main checkout: P/.git/ with a config naming the remotes
              | { "worktree": P, "of": P }                          // a linked worktree of the checkout `of`, as git lays it out
              | { "smns": P, "project": ID, "name"?: S, "hub"?: true | false | "other-org" }   // P/.smns
              | { "symlink": P, "to": P }
    Statement = { "path": P, "minted"?: ID, "linked"?: ID, "removed"?: true, "replaced"?: true }
    Ask       = { "dir": P, "project": ID | { "remote": KEY } | "machine", "by": "link" | "minted" | "smns" | "remote" | "machine", "at"?: P }

A harness creates each case's tree under a fresh real directory (every `P` is relative to it; made in `under`, and asked through that spelling, when a case names one), writing git's files directly, with no git command, and hands its implementation the statements as that implementation receives them in production (sminos: an org file's `locations`; MAWS: the index's lookup), at the canonical form of their paths. `about` states these conventions in the file. `removed` is a removed row's statement; `replaced` is a statement whose anchor does not match the folder. An expected `{ "remote": KEY }` is `uuid5` of the org and the key by the existing rule; `"machine"` is the machine's own project id. `at` is the folder that decided. `dir` may run through a `symlink` entry, which is how one spelling of a path is asked against a statement made on another.

The file holds at least these cases: a plain folder with no statement (machine); a minted folder and its subfolder; two nested minted folders (the nearer decides); a `.smns` above a statement and one below it; at one folder a link with a `.smns`, a minted id with a `.smns`, and a link with a minted id; a clone with a remote under a minted folder (remote), a repository with no remote under one (minted), a repository with several remotes and none named `origin` under one (minted), a statement on the repository's own root (the statement); a subfolder with a `.smns` inside a linked checkout (the file); a linked worktree inside its repository, with and without a `.smns`; a linked worktree outside its repository under another project's folder (its repository's project); a main checkout that is linked, with a worktree carrying the committed `.smns` (both the link's project); a worktree outside its repository whose main checkout has a `.smns` above it (that file's project, the one change from today); a removed folder with a declared subfolder (machine); a folder linked and then unlinked (its minted project); a replaced folder (its statement does not count); a path asked through a symlink; on `darwin`, a statement made under `/private/tmp` asked as `/tmp`; a folder whose name is stored decomposed on disk and stated composed.

The file also holds `anchors`, the comparison of §D pinned across the two runtimes:

    "anchors": [ { "name": "…", "anchor": { "dev": S, "ino": S, "birth": S },
                   "reading": { "dev": S, "ino": S, "birthNs"?: S, "birthSeconds"?: <float> },
                   "same": true | false } ]

`reading` is a folder as one runtime reads it: Node gives `birthNs`, Python `birthSeconds`, and a platform with no birth time gives neither. The cases: the pair measured on one folder by both runtimes (the same folder); a birth 2,000 ns apart (another folder); an anchor with birth `"0"` against a reading with one, and the reverse (compared by device and inode alone); a reading with no birth time; another inode; another device.

Not a case, by design §17: a worktree whose own `.smns` names another project than its main checkout's, with no statement on the main checkout. sminos and MAWS file it differently today and still do.

**The sync rule.** Neither side edits the vectors alone.
- A change to `project-rule.json` is a MAWS PR that raises `version`, reviewed by the architect and the desk track, with MAWS's harness green on it.
- doperpowers holds a copy at `sminos/tests/vectors/maws/project-rule.json` and a pin beside it, `PIN.json` = `{ "repository": "SSFSKIM/MAWS", "commit": "<sha>", "path": "apps/org-protocol/vectors/project-rule.json", "sha256": "<hex>" }`. The copy and the pin are written only by `sync.sh` (Concrete Steps §2), in the PR that makes sminos pass that version.
- A sminos test recomputes the copy's hash and fails, naming both, when it is not the pin's. MAWS's M13 reads the pin on each machine's installed sminos and compares its commit's file with master's: a difference is resolved before acceptance 10 is read.

#### §C. The hub (`apps/desk-hub`)

- **Storage:** table `projects_records (machine TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL, stored TEXT NOT NULL)`. `storeProjects(body)`: `400 malformed` for a wrong shape; the verdict's code for one that does not verify; the same bytes as held taken with nothing stored; `409 stale-projects`, its message naming the held revision, for a revision not above the held one; else stored.
- **Up, on an endpoint's socket:** `{ t: 'projects', record: Signed<ProjectsRecord> }`. A refusal is told as a listing's is, naming the frame `projects` and the code.
- **Down, on an endpoint's socket and on the app's Registry socket alike:** the snapshot as pages `{ t: 'projects-all', records: Signed<ProjectsRecord>[], last: boolean }`, each within the byte budget the listings pages use, sent after the endpoint's welcome and, to an app, after the listings pages; then `{ t: 'projects', record }` each time a record is stored. Every machine's record goes to every member and every machine. A machine receives its own record too, and reads one thing from it: its revision, as a floor for its next (§H).
- **Capability:** `RL1_CAPABILITIES.projects = 'projects'`. The Relay object advertises it in a welcome only after the Registry object has answered a probe that it keeps projects records: one deploy replaces the two objects at different moments, and a Relay of the new build can run against a Registry of the old one (the skew `objects/registry.ts` documents, which #538's keyed revoke met). While the Registry answers `503 hub-updating`, the Relay's welcome leaves the capability out, and a `projects` frame sent meanwhile is refused with that code, which the endpoint retries as it retries a listing.

#### §D. The org frame for sminos (RL10)

The endpoint's org frame keeps its `projects` and `machines` and gains two top-level fields, which an older sminos passes by:

    "complete": true | false,
    "locations": { "gen": <a number that rises with every change to this object's content>,
                   "at": [ { "path": P, "project": ID,
                             "hub"?: false,
                             "stated"?: "minted" | "linked",
                             "anchor"?: { "dev": "<decimal>", "ino": "<decimal>", "birth": "<nanoseconds since the epoch, decimal; \"0\" for none>" },
                             "state"?: "missing" | "replaced" } ] }

- **`locations.at`** is every declared location of this machine, in canonical path form. `project` is the rule's answer as MAWS holds it. `stated` and `anchor` are present exactly when a stored statement decides at that folder. `hub: false` is the record's (§A): the location's project is decided by a `.smns` that names no hub of this org. sminos uses `project` in its walk only where `stated` is present; the other entries are for §E.2.
- **A statement does not count** when its entry says `replaced`, or when the folder now at `path` does not match `anchor`.
- **The anchor, exactly.** MAWS writes `dev` and `ino` as the exact decimal of the folder's `st_dev` and `st_ino`, and `birth` as the exact decimal of its birth time in nanoseconds, all read with a 64-bit `stat` (`bigint: true`; a float loses the last digits). `birth` is `"0"` where the filesystem reports no birth time; the change time is never written in its place. A reader compares `dev` and `ino` exactly. It compares `birth` only when both the anchor's and its own reading are not zero, and counts them equal within 1,000 nanoseconds: Python reads the birth time as a float of seconds, which differs from Node's nanoseconds in the last digits for the same folder (on the owner's MacBook `/tmp` reads 197164871.45394439 s in Python 3.12 and 197164871453944374 ns in Node). On a platform where the reader has no birth time (Python on Linux) it compares `dev` and `ino` alone (Decision Log 3).
- **`gen`** is the endpoint's own number for this object, kept in §H's file: the later of one past the last and the clock's milliseconds, raised whenever the object's canonical content changes, an anchor alone included. It is not the record's revision: an anchor is in no record, so a same-path "Use this folder" changes this object and leaves the record as it was.
- **`complete`** is true when the endpoint is connected to the hub, the hub's projects snapshot of that connection has ended, and every machine the endpoint has held a record of and whose key still speaks for it under the head was in that snapshot at or above the endpoint's mark for it. Otherwise false, and so false from the moment the hub connection ends. An absent field reads false.
- **The frame is restated** when the head changes, as today, and also when this machine's `locations`, the held records or `complete` change.
- **Capabilities.** The endpoint's welcome lists `locations`: it sends the field with every org frame. sminos's hello lists `locations`: it applies them (§E.1 to §E.3) and acknowledges.
- **The acknowledgement.** After the atomic write of the org file that holds a frame, sminos sends `{ "t": "locations-kept", "gen": <that frame's locations.gen> }`, in order with its other frames. The endpoint releases the commands waiting on a `gen` at or below it (§H). An acknowledgement counts only on the connection its frame was sent on.

#### §E. sminos

1. **The rule.** Design §8, applied from the last kept org file with no daemon running. The deciding source it reports is one of `link`, `minted`, `smns`, `remote`, `machine`. The per-session `join` stays above it.
2. **Declared locations.** Each `locations.at` entry that is neither `missing` nor `replaced` is a known checkout. Where the entry does not say `hub: false`, its project is registered rooted there with its hub set. Where it does, the project's registration and transport stay as they are today. An entry whose project is this machine's own project (a declared folder that is not minted yet) is a known checkout and registers nothing: the machine's project is never rooted at a folder.
3. **Keeping.** `locations` and `complete` are kept with the directory in one atomic write: `daemon/org.json` holds them under those two keys, as the frame carries them. A frame without `locations` keeps the held ones. On a machine whose endpoint's welcome lists `locations` and whose org file holds none, a session keeps its recorded project until a frame arrives.
4. **Leaving.** `LEAVE_AFTER_S = 86,400`. For each followed project with no folder here sminos keeps a count of seconds. The count runs while sminos is connected to its endpoint and the last org frame of that connection is complete and lacks the project. It stands still while disconnected, and under a frame that is incomplete or has no `complete` field. A frame that lists the project sets it to zero. At `LEAVE_AFTER_S` the project has left: its id enters one kept set that the uplink's subscription (`hub_projects`) and the command line's org scope (`org_scope`, and so `sminos list --org`) both leave out. A later frame that lists the project takes it out of the set. The log directory stays. The count and the set survive a restart of the daemon.
5. **Words.** `project init` in a folder with a stored statement writes the id in effect and says that a stored statement on this machine decides the folder's project, which kind it is, and that the file it wrote is not what decides. `project show` names the deciding source and its folder, and, where a `.smns` in the folder names another project, both ids and which decides. `project init` in a folder that is no git repository says that a plain folder is declared with `maws project add`.

#### §F. The index (`src/services/index/`)

1. **Storage.** `projects` gains five nullable columns through the opener's `ADDED_COLUMNS` (`src/services/index/migrations.ts`), which adds a column without moving `user_version`: `stated_minted TEXT` (a project id: a random UUID, lower case), `stated_linked TEXT` (a project id), `anchor TEXT` (JSON `{dev, ino, birth}`, §D's strings), `name_rev INTEGER`, `location_state TEXT` (`missing`, `replaced` or null). The database gains one table through `ADDED_TABLES`, `index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`, holding `index_id`, a random UUID written when the table is first made, which §H's restore reads, and `statements_gen`, the counter §G's checked `remove` reads. No numbered migration is added and no existing column changes, so a build from before this work opens the file and leaves the new columns as they are (Plan of Work, decision 14).
2. **The lookup** `deriveOrg` reads statements through: for a canonical path, the row's `{ minted, linked }` when the row is declared, has one of them, and the folder now at the path matches its anchor; else none. It answers none for every path while the machine is not enrolled.
3. **`deriveOrg`** gains the lookup as an argument and returns, with today's `ProjectOrg`, how it decided (and null, as today, when git gave no answer in time):

       { org: ProjectOrg, by: 'link' | 'minted' | 'smns' | 'remote' | 'machine', at: string | null, smnsFolder: string | null, remote: string | null, hub: boolean }

   `org.key`, `org.name` and `org.source` are the folder's label, computed as today. `org.smnsId` is the rule's project: the link's or the minted id, the deciding file's id, the remote's `uuid5` when enrolled, and null for `machine` and for a remote on a machine that is not enrolled. `smnsFolder` is the folder holding the deciding `.smns` (the main checkout's for a worktree). `remote` is the repository's remote key, whatever decided. `hub` is false when a `.smns` decides and names no hub of the enrollment's org.
4. **Minting.** A row is minted (given `stated_minted` and its anchor) only at these moments and only when all the conditions hold.

   | Moment | Rows considered |
   |---|---|
   | (a) an explicit add: `session.projects.add`, `addFolder` | the added row |
   | (b) a first MAWS use: `usedByMaws` making a row the user's | that row |
   | (c) stored statements become possible on the machine (§H's seam turns to possible: after an upgrade, an enrollment, a sminos that advertises `locations`) | every declared row |

   Conditions: stored statements are possible (§H); the row is declared and has no `stated_minted`; the rule, evaluated at the row's folder, gives `machine`; and, except for an explicit add of that very folder, the folder is not the home directory, a folder above it, or a filesystem root. At moment (c) every declared row is evaluated first and the rows to mint are minted afterwards, so the order of two nested folders decides nothing (design §17). `addFolder {own: true}` mints although the rule gives a project (§G).
5. **Declared by a file.** On an enrolled machine, when a session's directory resolves with `by: 'smns'`, the row at `smnsFolder` is made the user's, created when absent, never un-hidden. It is done when a session starts or is discovered, and at each start's refresh for every row that has a session, which is how the rows that exist at the upgrade are covered. On a machine that is not enrolled nothing is promoted (constraint 7).
6. **States.** Each declared row's folder is checked at start, every ten minutes, and when a start in it fails. `missing`: `stat` says the path does not exist or is no directory. `replaced`: the row has an anchor and the folder at the path does not match it. A folder that cannot be read for want of permission is present. A change of state is a change of the row, told as any project change is.

`ProjectRecord` (the wire's shape of a row, `src/shared/ipc/schema/session.ts`) gains the optional fields `stated`, `state`, `nameRev`, `remote` and `hub`, with §A's meanings, absent where they do not apply.

#### §G. The commands (`src/shared/ipc/schema/session.ts`; all `owner: 'machine'`)

    session.projects.addFolder { directory, opened?, into?: string, own?: true }
        → { project, location, by?, at?, restated? }    // `project` and `location` as today; `by` and `at` as §F.3 gives them after the add
    session.projects.resolve   { directory: string }                    → { project: string | null, by, at, label: ProjectOrg }   // the rule's answer; changes nothing
    session.projects.link      { id: ProjectId, into: string | null }   → { project, restated: boolean }
    session.projects.relocate  { id: ProjectId, directory: string }     → { project, merged: boolean, restated: boolean }
    session.projects.update    { id, patch: { name?, order? } }         → ProjectRecord        // unchanged shape
    session.projects.remove    { id, expect?: { path: string, project: string | null } }   → void

- **`addFolder`** declares the folder, as today, and mints by §F.4. When the rule already gives the folder a project other than the machine's, nothing is minted and the folder is a location of that project; the answer's `by` and `at` say what decided, and `at` above the folder means it lies inside another project's folder. `own: true` makes it a project of its own there (a minted id). `into` declares and links in one act; where the rule would leave the folder in the machine's project it is minted as well, so removing the link later returns it to a project of its own. `into` with `own` is refused.
- **`resolve`** answers the rule for a directory and writes nothing. Add project reads it before the act, to say when a folder is inside a project; `maws project show` prints it.
- **`link`** sets or, with `null`, clears the row's link. The row must be declared. It never mints.
- **`relocate`** points the row at `directory` (which must exist and be a directory), records the anchor of the folder there and clears the row's state. With the row's own path it is "Use this folder". When another row holds that path: one with a stored statement of its own refuses the command; one without is merged, its sessions moving to the located row and its row deleted.
- **`update`** with a `name` sets `name_rev` to one above the highest `nameRev` the verified records and this machine's rows hold for the row's project.
- **`remove`** hides the row. Its statement stays and does not count; adding the folder again restores it. With `expect`, the row is hidden only if its path and its project are the expected ones; otherwise the command is refused `changed` and nothing is hidden. The project compared is the rule's answer computed for this command, never the row's kept `org_smns_id`, which may be stale for a moment after a statement above the row changed (M8's decision on rows beneath a changed folder). Because the rule is asynchronous and the hide is one synchronous transaction, the two are tied by a counter: `index_meta` holds `statements_gen`, raised in every transaction that changes a stored statement or a declared row's path; the handler reads it, computes the rule, and in the hiding transaction checks that it has not moved, computing again when it has (three times at most, then `unresolved`). When the rule has no answer (git gave none in time) the command is refused `unresolved`, which changes nothing and is not a mismatch. A held removal always sends `expect` (§I).
- **Refusals,** as the command's error code: `not-a-directory`; `not-declared` (a `link` or `relocate` of a row that is hidden or not the user's); `statements-unavailable` with its reason `not-enrolled`, `sminos-too-old` or `endpoint-off` (an `into`, an `own`, a `link` to a project); `unknown-project` (the id is in no verified projects record and is not the id the folder's own `.smns` names); `not-a-hub-project` (the target has a location that says `hub: false`); `too-many-locations` (the declared rows would not fit one record, §A's bounds); `has-statement` (`relocate` onto a stated row); `into-and-own`; `changed` (a `remove` whose expectation no longer holds); `unresolved` (a `remove` with an expectation whose project could not be computed now: try again).
- **`restated`** in an answer is false when sminos did not acknowledge the change within `RESTATE_WAIT_MS` (§H); the change itself stands.
- **Older peers.** Every new argument and every new field of an answer is optional on the wire (constraint 8). A machine whose endpoint does not list `rl2.project-acts` in its handshake is sent none of `into`, `own`, `link`, `relocate`, `resolve` or `expect`: for it the page offers today's plain add, and says `Update MAWS on <machine> to add this folder to a project.` An answer without `by` reads as not known, and the page then shows no notice.
- **Grades** (`src/shared/ipc/grades/session.ts`): `link` and `relocate` are `machine-admin`, as `update` and `remove` are; `resolve` is `list`.

#### §H. The endpoint and its two seams

Types in `src/shared/machine/` (M8), implemented in `src/endpoint/` and wired in `src/mawsd/daemon.ts` (M9).

    // what the machine's services ask of the endpoint, in process
    interface RegistrySeam {
      statements(): { possible: true } | { possible: false; reason: 'not-enrolled' | 'sminos-too-old' | 'endpoint-off' }
      onStatements(listener: () => void): () => void        // it changed; turning to possible is minting's moment (c)
      project(id: string): { hub: boolean; nameRev: number } | null     // from the verified records; null when none names the id
      fits(rows: readonly DeclaredRow[]): boolean           // §A's bounds for a record of these rows
      published(): Promise<{ restated: boolean }>           // resolves when sminos acknowledged the next locations frame, or after RESTATE_WAIT_MS
    }
    const NO_REGISTRY: RegistrySeam      // M8's default: not possible ('endpoint-off'), no project, everything fits, published at once with restated: false

    // what the endpoint reads of the index, in process
    interface ProjectsSource {
      snapshot(): { indexId: string; rows: DeclaredRow[]; statements: KeptStatement[] } | null    // null: the index is not loaded or not available
      restore(statements: readonly KeptStatement[]): void
      onChange(listener: () => void): () => void
    }
    type DeclaredRow   = { pid: string; path: string; name: string; nameRev?: number; org: ProjectOrg; stated?: 'minted' | 'linked'; hub?: false; remote?: string; state?: 'missing' | 'replaced' }
    type KeptStatement = { path: string; minted: string | null; linked: string | null; anchor: Anchor | null; name: string; nameRev: number | null; hidden: boolean }

    // what the daemon's front reads of the endpoint, in process, for `maws` (§K)
    interface RegistryRead {
      read(): { enrolled: boolean; machine: { ref: MachineRef; name: string }; machines: Array<{ ref: MachineRef; name: string }>; projects: RegistryProject[] }
    }

`RegistryRead.read` answers `assembleProjects` over the held records and the machine's own, with the machines' names from the head; on a machine that is not enrolled, `enrolled: false` and no projects.

- **Possible** means: the machine is enrolled, and the sminos connected on RL10 advertised `locations` in its hello; while no sminos is connected, the last connection's answer, which the kept file remembers.
- **The kept file,** `<profile>/mawsd/endpoint/projects.json` through `state/store.ts`: `{ version: 1, indexId, sminosLocations: boolean, record: Signed<ProjectsRecord> | null, statements: KeptStatement[], locationsGen: number }`. It is written before a new record is sent.
- **Signing.** At a change of the source and at each welcome the endpoint builds the record's body from the snapshot and `known`. When the body's content equals the kept record's, the kept bytes are sent again; otherwise a new record is signed at a revision that is the later of one past the last and the clock's milliseconds, and above the floor. The floor is the revision of this machine's own record as the hub's snapshot or a live frame last showed it, taken only from a record that verifies under this machine's own key: a counter the hub merely states is never trusted. A record refused `stale-projects` is signed again once the floor is known. One case is left as it is for listings today: after a machine's key changes under the same ref, the hub's held record no longer verifies under the new key and gives no floor, and the clock's milliseconds clear the held revision unless the clock went back. A null snapshot signs and sends nothing. A location's `id` is its row's `org.smnsId`, or the machine's own project id where that is null. The record is sent only to a hub whose welcome lists `projects`.
- **Restoring.** When the snapshot's `indexId` is not the kept file's and the kept file has statements, the endpoint calls `restore` with them before it signs anything: each statement is written to the row at its path, the row created when absent and hidden when the statement says so. Then the file takes the new `indexId`.
- **The held records,** `<profile>/mawsd/endpoint/projects-held.json`: the newest verified record of every other machine, with a mark per machine (its revision, the hash of its canonical form, the key id that signed it). A record below the mark is ignored; one at the mark with another hash is a conflict, ignored and logged; one above it is verified and kept. A mark and its record are dropped only when the head no longer lets that key speak for the machine. The hub's snapshot removes nothing.
- **`RESTATE_WAIT_MS = 2000`.**

#### §I. Main (`src/main/org/`, `src/shared/ipc/schema/org.ts`)

    'org.projects':          { input: void, output: OrgProjects }        // owner: 'main'
    'org.projects.changed':  OrgProjects                                 // the whole value, coalesced, as org.rows.changed is
    'org.removals.hold':     { input: { machine: MachineRef, pid: string }, output: void }
    'org.removals.cancel':   { input: { id: string }, output: void }

    type OrgProjects = {
      projects: Array<{ id: string; name: string; hub: boolean; renamable: boolean
                        locations: Array<{ machine: MachineRef; pid: string; path: string; key: OrgKey; name: string; source: ProjectLocation['source']
                                           stated?: 'minted' | 'linked'; state?: 'missing' | 'replaced'; remote?: string
                                           acts: boolean }> }>          // acts: the signed-in member owns the machine
      keys: Record<string, OrgKey>               // project id → this device's row key, one to one
      moved: Record<string, OrgKey>              // a key no project has any more → the key its tabs belong under now
      removals: Array<{ id: string; project: string; machine: MachineRef; pid: string; path: string; askedAt: string }>
      seen: Record<string, string>               // machine ref → when the machine was last seen, for "offline since"
    }

- **The records** are verified with `verifyProjectsRecord` against the held org view and kept in `<userData>/org/projects.json` under §H's mark rules. `OrgProjects.projects` is `assembleProjects` over them, less the projects with no location, filtered to what the member may see (M10's decision): a project the member sees only through a session of it is listed with no locations. Signed out, `org.projects` answers an empty value. `seen` is, per machine, the later of the last time this device's link to it was up and the `issued` of its newest record, kept in the same file.
- **The key table,** `<userData>/org/project-keys.json`: project id → row key, one to one. An id gets its key the first time main sees it as a registry project (a record's location) or on one of this device's own rows. The key is the label (`org.key`) of one of this device's own rows that carry the id, a declared row before any other and then in the rows' order, provided the row is not linked into the id (`stated: 'linked'`) and the label is not already another id's key; else `id:<project id>`. `id:` joins the prefixes of `src/shared/machine/org-key.ts`. Ids first seen together are taken in id order. An entry never changes. For a signed-in Mac that is not enrolled, a `remote:` row's id is computed from its key, as `joinIds` did. `RemoteRow.orgKey` becomes the table's entry for the row's `project`, and null where there is none: a listing alone assigns no key, and its session sits under its machine's row, as an unjoined listing does today.
- **`moved`** is computed at each emission and never kept. What the file keeps, per id, is the locations (machine and `pid`) the id last had, updated whenever the id has any. For each id of the table that has no row now, neither a registry location nor one of this device's own rows, main takes the first of its last locations that some project carries now and maps the id's key to that project's key. A location is looked up by where it is now, so an id whose locations moved twice maps straight to their present project, and an id that has a row again has no entry: nothing stale can redirect a project that came back and was later removed.
- **A held removal,** `<userData>/org/held-removals.json`, holds the location as it was when asked: machine, `pid`, path and project. When that machine's link is next up, the removal is sent as `session.projects.remove` with `expect` naming that path and project, and the machine decides (§G): a refusal `changed` drops the held removal and tells the person that the location changed and was not removed; a refusal `unresolved` keeps it, to be sent again at the next link-up or after a minute. While held, the location is left out of `OrgProjects.projects` on this device and listed in `removals`.
- **Acts.** `session.projects.link`, `relocate`, `update` and `remove` join the machine acts main sends over a link; `link` and `relocate` join `addFolder` in the set that is always stepped up.

#### §J. The page

1. **Grouping.** A project record's row key is `keys[org.smnsId]` when it has an id and the table has it, else its own `org.key` (else its address, as today). Other machines' locations are project records in the same map, built from `OrgProjects`: the address from the machine and `pid`, `directory` the path, `org` the key, name, source and id. A row is listed when its project has a declared location on some machine, that is, when `OrgProjects.projects` holds it or one of this Mac's own declared rows carries it. A project that is only `known` somewhere has no row of its own, and its sessions sit under their machine's row (the owner's second answer, design §12).
2. **The whole-set move.** Take a tab set, a panel context or an expanded entry whose key K is no row's key now and is neither a machine's row nor the no-project set. Its new key is `moved[K]` when main names one (§I): that covers a project whose locations were linked into another, an `id:` key included. Otherwise, among the project records whose label (`org.key`) is K and which are not hidden, take the first (this Mac's first, then by machine ref): the entry moves to that record's row key. With neither it stays, as a hidden project's set does today. The move is `rekeySets`' merge: the set that was current, else the first in key order, keeps its panes, and the others' tabs follow in its focused pane.
3. **Words.**

   | Where | Text |
   |---|---|
   | a row's machines | the machines' names joined by ` · `, this Mac's first |
   | a location whose machine is off | `offline`, and in the hover card `offline since <time>` |
   | a missing location | `folder not found on <machine>`, with `Locate…` and `Remove` |
   | a replaced location | `replaced: another folder is at this path`, with `Use this folder` and `Remove` |
   | a held removal | `removal pending until <machine> is back`, with `Cancel` |
   | a folder already inside a project, in Add project | `This folder is inside <project>. It is added as a location of <project>.`, with the choice `Make it a separate project` |
   | a suggestion, files against a stored statement | `<folder> on <machine> has a .smns that names <project>.` with `Follow the file`; `<folder> on <machine> is a clone of <project>'s repository.` with `Link` |
   | sminos too old on the machine | `Update sminos on <machine> to add this folder to a project.` |
   | a project with a `.smns` | Rename is not offered |

   Rename, where offered, sends `session.projects.update` to one location's machine: this Mac's when it has one, else the first in order that is up.

   A suggestion's button sends `link` with the named project; none is shown for a replaced location. "Follow the file" appears for a location with `stated` and `source: 'smns'` whose key names another id than its `id`. "Link" appears for a location with `stated: 'minted'` and a `remote` whose `uuid5` is another project in the registry.

#### §K. `maws`

    maws project add    [DIR | MACHINE:PATH] [--into <project>] [--new] [--name <name>]
    maws project list   [--json]
    maws project show   [DIR] [--json]
    maws project remove [DIR | MACHINE:PATH]
    maws project link   [DIR | MACHINE:PATH] (--into <project> | --none)

- `DIR` defaults to the working directory. `MACHINE:PATH` is a machine's name in the org, a colon and an absolute path; anything else is a local path. `--new` is `addFolder`'s `own`. `--into` takes a project's id or name; a name that two projects share prints both with their ids and locations and exits 1.
- **Output.** `add`: `added <name> as a new project (<id>)` when the answer's `by` is `minted` at the folder itself, else `added <path> as a location of <name> (<id>)`, else, where the rule leaves it in the machine's own project, `added <path>; it stays under this machine until sminos here is updated`; a second line `sminos has not confirmed yet; a session started now may be filed under this machine for a moment` when `restated` is false. `list`: one line per project, `<name>  <id>  <machine>:<path> [state]…`. `show`: the project of `DIR`, what decided it and where (`a link at <path>`, `a stored id at <path>`, `.smns at <path>`, `the repository's remote`, `this machine's own project`), and its locations. On a machine that is not enrolled, `add` declares the folder and prints `added <path>; this machine is not enrolled, so it is a project of this machine only`.
- **Exit codes** are `mawsd`'s: 0 done, 1 failed or refused (the refusal's code and one sentence), 2 not available here, 3 the daemon is not running.
- **The daemon's commands** (the front's own, served with no services loaded, to a `machine.sock` client alone and never to a forwarded caller):

      'projects.registry': { input: void, output: { enrolled: boolean, machine: { ref, name }, machines: [{ ref, name }], projects: RegistryProject[] } }     // §H's RegistryRead
      'projects.forward':  { input: { verb: 'add' | 'remove' | 'link', machine: string, path: string, into?: string | null, own?: true, name?: string },
                             output: { ok: true, text: string } | { ok: false, code: string, text: string } }
      'projects.act.answer': { input: { id: string, result: <projects.forward's output> }, output: void }     // from the app alone
      event 'projects.act.request': { id: string, verb, machine, path, into?, own?, name? }                  // to the app alone

- **Aimed at another machine.** `maws` sends `projects.forward`. The daemon posts `projects.act.request` to the attached app when its hello lists `machine.project-acts`, and waits for `projects.act.answer` with that id while the terminal's connection and the app's both live. The app shows the request with where it came from (`From a terminal on this Mac: add /srv/scrape on mini`), asks Touch ID where the act is stepped up, sends the act over the machine's link and answers with its result or refusal. An answer for an id that was not asked is refused. With no such app, or when the app's connection ends first, the command exits 2: `MAWS is not running on this machine, so it cannot ask <machine>. Run this on <machine>: maws project add <path>`.

#### §L. Capabilities, and the sminos version each needs

| Capability | Who says it, where | What it promises | From | Facing its absence |
|---|---|---|---|---|
| `projects` | the hub, in its RL1 welcome | it keeps and hands out projects records | M2 | the endpoint sends no record and holds none; the app's registry is empty |
| `locations` | the endpoint, in its RL10 welcome | every org frame carries `locations` and `complete` | M9 | sminos resolves as today (design §8) |
| `locations` | sminos, in its RL10 hello | it applies §E.1 to §E.3 and acknowledges | sminos M5 | the machine makes no stored statement: no minting, and `into`, `own` and `link` are refused `statements-unavailable: sminos-too-old`. A plain add still declares the folder, which is carried with the machine's own project id until sminos is updated, and is minted then (§F.4, moment (c)) |
| `rl2.project-acts` | the endpoint, in its RL2 handshake | it serves `link`, `relocate`, `resolve`, `update` and `remove` for projects, and `addFolder`'s `into` and `own` | M9 (the name is declared in M8) | the app sends that machine none of them and offers today's plain add (§G) |
| `machine.project-acts` | the app, in its `machine.sock` hello | it answers `projects.act.request` | M12 | `maws` aimed at another machine exits 2 |

The leaving rule (M6) has no capability: it reads `complete`, and an endpoint that sends none never makes a project leave. `project init` and `show` (M7) have none either.

Minimum sminos versions: stored statements need the version that merges M5, which contains M3 and M4; acceptance at M13 needs M7's. sminos is at 1.41.0 on 2026-11-10. Each milestone's version is written into Progress when its PR merges, and that line is the reference; MAWS's code names no version (constraint 3). The one place a version is shown to a person is the page's "Update sminos" line, which names none.

## Surprises & Discoveries

- Observation: the home directory is not a declared row on the owner's MacBook today, so nothing mints it at the upgrade. It answers design §16's second unknown; §F.4's exception for the broadest folders holds either way.
  Evidence: the MacBook's `index.sqlite`, read-only, 2026-11-10: `/Users/new|discovered|0|folder`. A chat in the home directory gives it a row by discovery, and `usedByMaws` makes it the user's only when a MAWS start or resume names that row.
- Observation: the daemon already has a way to ask the attached app for something only the app can do and to refuse at once when no app can answer: the client port (`src/mawsd/client-port.ts`, OX4). Its kinds are an enum on the wire, so it cannot take a new kind within the wire major; `maws` uses the same routing through an event and a command of its own (M12; Decision Log 6). It settles design §16's fifth unknown.
  Evidence: `src/shared/ipc/wire.ts`: "a changed type, `const`, `enum` or union member set (an added enum member included, since an older reader refuses it)" takes a major; `src/shared/ipc/schema/client-port.ts`: `kind: z.enum(CLIENT_PORT_KINDS)`.
- Observation: the index's schema is at version 15, and a build that meets a newer `user_version` leaves the whole index unavailable. Columns and tables can be added without moving the version (`ADDED_COLUMNS`, `ADDED_TABLES`), which is what keeps a machine's rollback build usable.
  Evidence: `src/services/index/migrations.ts` (versions 14 and 15, and the two lists' comments); `src/services/index/db.ts`: "user_version … is newer than this app knows".
- Observation: `rekeySets` already merges whole tab sets, panes and ratio included, but is asked of address keys only (`isProjectAddress`). The whole-set move of design §2 is that function asked of more keys (§J.2), not a new one.
  Evidence: `src/renderer/src/stores/layout-model.ts`, "Whole sets move, not tabs one by one".
- Observation: Python's `os.stat` gives no birth time on Linux, so sminos on a devcloud VM cannot compare an anchor's `birth` without `statx`. Node reads it on both platforms.
  Evidence: the `os.stat_result` documentation: `st_birthtime` is available on macOS, FreeBSD and Windows.
- Observation: `installDaemon` already writes a wrapper `<profile>/mawsd/bin/mawsd` and, for the default profile, a link `~/.local/bin/mawsd` (`src/mawsd/install.ts`), so `maws` needs a second wrapper and link and no new installer.
- Observation: on the MacBook's index of 2026-11-10 the upgrade's first minting covers four visible folder rows, three of them scratch folders under `/private/tmp` that macOS may delete, which will then read "folder not found". The owner is told the list before the swap (M13).
  Evidence: `select directory from projects where origin='user' and hidden=0 and org_source='folder'`: four rows.
- Observation: on Linux a folder whose name is stored decomposed on disk is not named by its NFC path, so MAWS's own check of a declared folder at its canonical path would read it `missing`. Recorded, not designed for: such names are rare off macOS. The vector case "a folder whose name is stored decomposed on disk and stated composed" is `darwin` only for this reason.
  Evidence: APFS looks names up without regard to normalization, ext4 by bytes; the canonical form is the real path in NFC (design §8).
- Observation: `session.projects.add` does not fold a worktree under its main checkout (it uses `locate().realpath`), where `addFolder` does (`projectDirectory`). So a plain `add` of a worktree path can make a row there; M8 never mints such a row.
  Evidence: `src/services/index/register.ts` and `add-folder.ts` at M8 (d563695ff); the executor's guard test fails with the guard removed.
- Observation: libuv on Linux reports a folder's change time as its birth time where the kernel gives no birth time, so Node's `birthtimeNs` there is not a birth time.
  Evidence: M8's anchor reader first treated a birth equal to the change time as none (Decision Log 13 (7)), which Decision Log 14 (2) replaced with a once-per-process probe; its tests in `src/services/index/anchor.test.ts`.
- Observation: the remote setup's policy refuses a remote `addFolder` or `relocate` outside the machine's home (`outside-home`), so M13's step 5 (`/tmp/registry-live/other` on `vm`, from the MacBook's app) would be refused as written; a folder under the VM's home serves.
  Evidence: M9's `project-acts.test.ts`, its relocate case with a `tmpdir` path.
- Observation: retiring a machine by removing it from the head's `machines` alone is refused `409 malformed` (keys unaccounted); its key has to enter `retired` as well.
  Evidence: M9's local suite (`test/endpoint/projects.local.test.ts`), its retired case.

## Decision Log

1. **2026-11-10, the architect, at authoring: the verification, and the desk track's requirements.** This document gets two reviews before any milestone is built: the desk track's, of M1 to M7 and Interfaces §A to §E (its condition for starting, its message 732), and a `doperpowers:adversarial-reviewer` reading of the whole execution section against the design for completeness and buildability. Each milestone's branch is reviewed before it lands at the rung Plan of Work names. The desk track's three requirements are carried: sminos milestones are doperpowers PRs it merges, each with a version bump, rolled out through the marketplace, with the capability and the minimum version per behaviour in §L; the vectors' ownership and sync rule in §B; its order of milestones as M3 to M7. One composite document written by the architect was the desk track's choice over a document per track: the contract shapes are in one place.
2. **2026-11-10, the architect: `WIRE_MINOR` is bumped in M8 and again in M12.** The design says one bump. Its purpose is one step for the machines, which swap once; on master each milestone that adds to the wire bumps it, so each is self-contained and reviewable. Rejected: every wire schema of M12 inside M8, which would land commands with no handler.
3. **2026-11-10, the architect, corrected the same day from the desk track's review: an anchor's birth time is compared where both sides have one, within a microsecond.** The design binds a stored statement to its folder by device, inode and birth time. MAWS records all three, exactly, from a 64-bit `stat`, on macOS and Linux. The first draft had every reader compare the three for equality, which the desk track measured to be wrong: Python reads a birth time as a float of seconds and Node as integer nanoseconds, and the two differ in the last digits for one folder, so equality would mark an unchanged folder replaced. §D now fixes the comparison. sminos on Linux compares device and inode alone, the desk track's decision (its message 735): Python has no `os.statx` before 3.15, and calling `statx` through `ctypes` is not worth its risk. The weaker check there can miss a new folder that reuses a deleted folder's inode, until MAWS's own check, which runs at every lookup and every ten minutes, marks the location `replaced` in the next frame. Rejected: dropping birth time everywhere, which would weaken macOS, where every reader has it.
4. **2026-11-10, the architect: the residue decisions** listed under Plan of Work, "Decisions made in writing this document", 1 to 14, with their reasons there. Those that refine a statement of the design are recorded in the design's Decision Log 10.
5. **2026-11-10, the architect, from the desk track's review of its sections at 8c284bf2c** (its message 733; it read them itself and had an adversarial reviewer read them against the code). Seven findings, all adopted. (1) The org frame's locations carry `hub: false`, and sminos registers a declared project with this org's hub only where the location is eligible; the draft's "with its hub set" would have moved a git-mirrored or other-org project's log to the hub (§D, §E.2, M4). (2) The anchor's comparison is fixed across the two runtimes (Decision Log 3; §B's `anchors`). (3) The acknowledgement names the locations' own `gen`, not the record's revision: an anchor is in no record, so a same-path re-anchor left the revision as it was and an earlier acknowledgement could have released the command (§D, §H). (4) The hub advertises `projects` only after its Registry object answered a probe, since a deploy replaces the Relay and the Registry at different moments (§C, M2). (5) A machine's own project is recognised by the directory's whole name set, certificate-only devcloud machines included, through one exported function (§A, M1). (6) The record's revision takes its floor from the machine's own record at the hub, verified by its own key (§H, M9). (7) Leaving counts connected time under a complete directory that lacks the project, where the draft counted directories, which the endpoint sends only on a change; having left is one kept set read by the subscription and by `sminos list --org` (§E.4, M6). The desk track's decisions 5, 6 and 7 of the architect's list stand as written.
6. **2026-11-10, the architect, from the independent review of the execution section at 8c284bf2c** (`doperpowers:adversarial-reviewer`; it read both documents and traced the index, hub, RL10, sminos, layout, command line and wire code; it ran nothing). Seven findings, all adopted. (1) Non-hub projects and the hub: the desk track's first finding, already folded (Decision Log 5). (2) The index is at version 15, not 13, and a numbered migration would make the kept rollback build unable to open the index: the columns and the table are added through the opener's lists with the version unmoved (§F.1; Plan of Work decision 14). (3) A row key belongs to one project id: the draft gave an id its own row's label without asking whether another id held it, so two clones with one label and two ids, one of them linked, would have been merged again by key (§I). (4) A removal carries what it expects and the target machine checks it while hiding; the draft checked only in the app before sending (§G, §I; decision 13). (5) The draft's wire changes were not additive: required fields added to `addFolder`'s answer, and a ninth client-port kind, each a wire major under OX1. The answer's new fields are optional, older peers are told apart by `rl2.project-acts`, and `maws` reaches the app by an event and a command of its own, so OX4 is not amended (constraint 8, §G, §K). (6) A set under an `id:` key had no successor when its project's locations were linked into another: main now names the successor (`moved`, §I, §J.2). (7) The daemon's read for `maws project list`, `show` and `--into` was named nowhere: `projects.registry` over §H's `RegistryRead` (§K, M12).
7. **2026-11-10, the architect, from the independent reviewer's second reading (26d3d5b56 against its seven findings):** five closed, with no remaining duplicate key and nothing left that the wire manifest would refuse; two contract details adopted. (1) A checked `remove` compares the project the rule gives at that moment, tied to the hide by `statements_gen`, and a rule with no answer is `unresolved`, which keeps the held removal: the first form compared a kept column that M8 lets lag behind a parent's change (§G, §F.1, §I). (2) `moved` is computed from where each last-known location is now and is never kept: a kept redirect would have outlived a project that came back, and a location moved twice would have pointed at a key with no row (§I, §J.2).
8. **2026-11-10, the desk track, at M1.** (1) Two machine-name sets, not one (§A): the directory keeps today's set, `directoryMachineNames`, and the registry's `machineProjectNames` adds the former names of enrolled refs. The first draft of §A said today's `machineNames` includes former names, which it does not; folding them into the directory would list each as an enrolled machine never online, and leaving them out of the registry's set would make a renamed machine's old machine-project id a project of the registry. The architect ruled for the two sets; M1's review found the same gap. (2) The 262,144-byte bound is on the canonical form of the record's body, the text the signature covers, so a writer checks it with the same function the readers use; measuring the whole signed envelope was the alternative, and adds only the signature's fixed size. (3) `project-rule.json` carries a top-level `about`, which states the harness's conventions (statements handed at their canonical path, `removed`, `replaced` and `at`), and an optional `under` per case: the `/tmp` case needs its fresh directory made in `/tmp` and asked through that spelling, which §B's format could not say. (4) A removed or replaced statement "does not count" as if it were absent: the walk goes on outward to the next statement that counts (the architect's reading). The vector "a removed and a replaced statement nearer than a counting one: the walk goes on to it" pins it.
9. **2026-11-10, the desk track, at M2: the carriers §C names without fixing.** (1) The probe is a Registry method of its own, `keepsProjects()`, which the Relay asks at the endpoint's upgrade beside `machineBinds`: workerd refuses a method the callee's code lacks, so a Registry of the build before answers "does not implement" (`lacksMethod`), the hub's existing reading of `hub-updating`, and the connection is welcomed without `projects`. Any other failure refuses the upgrade `503 hub-unavailable`, as `machineBinds`' does, so a Registry out of reach does not leave a connection without the capability for its life. Asking at the welcome was the alternative; it would hold the welcome behind a Registry call, during which the log plane could not reach the endpoint. (2) The endpoint's snapshot is read from the Registry after the welcome a page per call (`projectPage(after)`, a cursor on the machine ref, each answer within the listings' page budget, so no RPC answer grows with the org's records toward the runtime's 32 MiB limit), and each page is written as it arrives; records stored while it is read are held by the Relay and written after the last page, so the pages come first. A page the Registry could not give is asked again on the same connection as retry.ts's calls are, one line logged for each failure, and after `RETRY_ATTEMPTS` the snapshot is given up with the connection kept: what was held is written and live records follow, and the endpoint, never sent the last page, holds the snapshot incomplete. The log plane and the channels never end for the snapshot's sake; ending the connection was the first draft, and would have looped at every reconnect while the Registry failed, taking today's endpoints, which ignore these frames, down with it. (3) A record stored reaches each machine's ref object through the Registry's `relays` table (every ref that has opened an RL1 socket), by `Machine.relayProjects`, sent again on failure as retry.ts's calls are; a ref object of the build before lacks the method and is passed by. A live `projects` frame shares the directory push's limit (retry.ts's header): one lost after those retries, or with the Registry reset under them, reaches that endpoint at its next welcome's snapshot. Only a connection welcomed with `projects` is sent records (§L: facing the absence, the endpoint holds none). (4) A `projects` frame on a connection welcomed without the capability is still handed to the Registry: refused `503 hub-updating` while it lacks `storeProjects`, kept once it has it. (5) Endpoints of today's build receive the pages and the live frames from the deploy on, and ignore them with one log line per link (`hub-link.ts`'s unknown-frame rule); the app's Registry feed and desk-web ignore them silently. (6) `project-rule.json` is at version 2, with one case added on the architect's ruling (its message 1402): a worktree's own `.smns` walk runs from the directory up to, and not including, the first folder that is its main checkout R or an ancestor of R, and the rule at R weighs what lies above, so a nearer statement at R beats a `.smns` above it for a worktree inside R and for one outside it. With no statements nothing resolves differently beyond §8's named corner, since R's own walk reaches a file on a shared ancestor.
10. **2026-11-10, the app's executor (M8 to M12, branch `registry-app`), at its pre-flight.** M8 to M12 are built on one branch and land as one pull request, held until the author records P5's verified build (constraint 1). Each milestone is reviewed at its boundary at Plan of Work's rung: `doperpowers:reviewer-high` for M8, M9 and M10, which also reads the milestone against this document as the loop's task reviewer would, and `doperpowers:task-reviewer` (the medium rung's model and effort) for M11 and M12. Constraint 9's per-milestone `--gates all` and `--gates packaged` are taken once, on the branch's final head, since no milestone lands alone; each boundary takes class 1a, and M11 runs its own e2e group when it is built. Renderer suites (happy-dom) and Electron run only through `scripts/ci-gate.sh` on this branch; only focused runs are local, eslint on one file and vitest on one test file (Decision Logs 11 and 12).
11. **2026-11-10, the architect, by the owner's standing rule of 2026-11-02.** No typecheck runs on the MacBook (`tsc`, `pnpm typecheck`, any `tsc --noEmit`): it is class 1a's static gate on GitHub Actions alone. Concrete Steps §3 opens with `pnpm lint` and no longer with `pnpm typecheck`. The static-first rule holds: after each commit that touches product or test TypeScript, a static-only or class 1a run of `scripts/ci-gate.sh` comes before any run that holds the CI Mac.
12. **2026-11-10, the architect, by the owner's rule as first recorded on 2026-11-02, wider than Decision Log 11.** On the MacBook no typecheck of any kind and no multi-file eslint or vitest, at any load: what runs locally is eslint on one file and vitest on one test file. The whole lint and the unit suite are class 1a's on CI (`scripts/ci-gate.sh <worktree> --gates static,unit,probes`, no clearance needed). Concrete Steps §3 says exactly this; its `pnpm lint`, `pnpm test -- <directory>` and `pnpm wire:manifest` lines (the last runs two files) are gone for their focused forms.
13. **2026-11-10, the app's executor, at M8.** (1) The index keeps two more nullable columns than §F.1 names, `org_remote` and `org_hub`, written only on an enrolled machine: a `DeclaredRow`'s `remote` and `hub: false` must survive a restart as the label does, or a record signed before the first derivation would list a git-mirrored project as a hub project. (2) A linked worktree's own `.smns` (design §8, "a `.smns` on the worktree's own path decides, as today") is looked for from the directory up to, and not including, the first folder that is the main checkout R or an ancestor of R; from there the rule is applied from R. Ruled by the architect as the design's author (2026-11-10): the files and statements on the folders the worktree and R share are weighed by the rule at R, the nearer of file and statement, and a worktree walk that read them first would let a `.smns` above beat a nearer statement and split a worktree from its main checkout, against §8's first sentence on worktrees (read as today's whole upward walk, a worktree of a minted `f/repo` with a `.smns` above `f` would be filed under that file while its main checkout is under `f`). The vectors do not pin this corner yet; the desk track adds the case to `project-rule.json`, with its version bump, in its next PR. (3) `deriveOrg` keeps today's signature and answer (`ProjectOrg`), and §F.3's whole answer is a new function beside it, `deriveProject`, so the earlier index tests pass literally unchanged. (4) Minting's moment (c) is remembered in `index_meta` (`minting`): set once (c) has run, cleared whenever the seam reads not possible, so a plain restart mints nothing and a declared folder that later fell to the machine's project keeps the machine's id (design §2); a folder not found at (c) is minted when the folder checks find it (design §8, "once its folder is found"). (5) `stated` is set on a row only when its own statement decides its project; a subfolder under a parent's statement carries none (§D). (6) The index's half of §H's `ProjectsSource` is M8's (`Index.projectsSource()`), since M9 touches nothing under `src/services/index`; M9 wires it. Its snapshot is null while the index is unavailable or a declared row is not yet derived. (7) On Linux a birth time equal to the change time is read as none (`"0"`): libuv reports the change time as the birth time where `statx` gives none, and §D forbids writing the change time in its place. (8) With `NO_REGISTRY` in force, `add` and `addFolder` answer exactly as before, with no `by`, `at` or `restated`.
14. **2026-11-10, the app's executor, from M8's review (three rounds at `doperpowers:reviewer-high`).** Twenty findings, eighteen fixed in the milestone (87162c26d, a442c5262, 2938a46e1), two deferred to `docs/tech-debt-tracker.md`. What changed in M8's design as Decision Log 13 recorded it: (1) Decision Log 13 (5) is reversed: the record's `stated` (§A) is set whenever a stored statement decides a row's project, its own or one above, so `assembleProjects` never reads a `.smns` under a statement as the deciding file (design §9); the org frame's `stated` and `anchor` (§D) stay a statement at that very folder. The index carries how and where a row was decided (`org_by`, `org_at`, two more nullable columns), and `DeclaredRow.statedAt` names the deciding folder. (2) Decision Log 13 (7) is replaced: whether a process's birth times are libuv's change-time fallback is decided once per process by a probe (a scratch folder's change time moved, its birth time read again); under the fallback every anchor reads birth `"0"`, else the birth time is used as read. The per-reading rule had dropped real birth times on Linux, where a new folder's birth equals its change time. (3) Decision Log 13 (4)'s marker is narrowed: moment (c) remembers the rows it could not mint (`index_meta.minting_pending`), and only those are retried when their folders are found. (4) A missing declared folder keeps its identity on an enrolled machine, taken from its own statement when it has one (design §10: missing removes nothing); off enrollment it keeps none (§F.2). (5) A session filed into a row whose project a statement decides, its own or one above, checks that statement's anchor first, so a session started inside a replaced folder is never filed in the old project (design acceptance 6); a returning original folder is derived again with the rows beneath it. (6) A remote `addFolder` keeps the setup's checked reader through every derivation of the act. (7) A link needs a folder to anchor (`not-a-directory` otherwise), and a link to the id a folder's own `.smns` names is refused `not-a-hub-project` when that file names no hub of this org. (8) `own` on a linked row clears the link. (9) The exception for the broadest folders holds only for an explicit add of that very folder, not of a folder that folds to it. (10) Explicit declarations run one at a time, each checked against the bounds with the row as it will be published. Deferred: the same admission for first use and `.smns` promotion (tech-debt row of 2026-11-10), since it needs about 1,000 declared folders on one machine.
15. **2026-11-10, the app's executor, at M9.** (1) The endpoint's RL10 welcome lists `locations`, and its org frames carry `locations` and `complete`, only to an sminos whose hello lists `locations` (§D, §L): sminos's conformance replay pins `test/endpoint/rl10/conversation.json`, so an sminos of before M5 is sent today's frames byte for byte. The behaviour §E.3 reads from the welcome is unchanged for an sminos that applies them. (2) A new record is signed only once the welcome's projects snapshot has ended, or after `FLOOR_WAIT_MS` (10 s), so the floor of §H is known first and a record is refused `stale-projects` at most once. (3) The kept record is sent again at every welcome, also while the index is not loaded, so a hub that lost it gets it back; while the index is not loaded, sminos's `locations` are built from the kept record and statements (constraint 4). (4) `locations.gen` is raised once per change of the object's content within a process, as the later of one past the last and the clock's milliseconds, and kept in `projects.json`. (5) `complete` (§D) counts the other machines' records; this machine's own is its own to know. (6) `known` keeps its last answer while sminos is away; a project is known when its log-plane hello names it without `follow`. (7) At an unenroll, `projects-held.json` moves aside with the org's other state and `projects.json` stays, so the machine's own statements survive a re-enrollment. (8) RL2's minor moves 12 to 13 for `rl2.project-acts`; `WIRE_MINOR` does not move (the manifest is unchanged). (9) `SpineRoot` gains `projects`, one field in `src/services/spine-root.ts`, the only handle `mawsd` has on the loaded index. (10) `RegistryRead.read()` is implemented and left unexposed; M12 wires it. (11) A record over §A's bounds is logged and not signed; names are clamped to 128 code points before it is built. (12) §I's "Acts" line is moved forward from M10: `src/main/lane-b/remote.ts` sends `link`, `relocate`, `update` and `remove` over a machine's link, `link` and `relocate` stepped up, since `test/lane-b/offer-coverage.test.ts` ties every offer of the endpoint to main's adapter.
16. **2026-11-10, the app's executor, from M9's review (five rounds at `doperpowers:reviewer-high`, each narrower than the last).** Eleven findings, all fixed (17167265f to 11f5be9ca). What it changed beyond Decision Log 15: (1) Over the network every derivation whose answer goes back to the caller reads through the asking member's opens: `resolve` and `relocate` through the remote setup's checked reader (`setupGuarded`, as `addFolder`), `link` (an unlink, a link to a target a record names, a link to the folder's own `.smns`) and `remove` (its `expect` check and the derivation after the hide) through `rowFiles`, which counts the asker's opens alone and checks no directory first. A refused read answers as naming nothing (`unknown-project` for a link's own-file target), never as a distinct refusal that would tell the caller where a file is. Re-deriving the rows beneath an added or relocated folder stays the machine's own unguarded refresh: nothing from it is answered to the caller. (2) When a remote act's derivation is refused, the row's own link or minted id decides, under its stored label, only where that statement governs under design §8, that is, outside a linked worktree as the rule itself reads the layout (`inLinkedWorktree` in `org-project.ts`); a remote link change after which no governing statement of the row's own decides, and whose rule needs a file the asker cannot read, is refused `unresolved` before anything is written. (3) `projects.json` keeps the last restated `locations` whole with its `gen`, apart from the record's signing, so a restart with the index not loaded restates what sminos last acknowledged. (4) A write of either kept file that fails stops the send and leaves the in-memory state as it was (§H: written before sent). (5) Held records are verified again at the endpoint's start and at the soonest delegation expiry in the state; a machine counts as seen in a snapshot only for a record that verified or is byte-identical to the one held; work queued from an ended hub connection is dropped. (6) A command is answered `restated: true` only by an acknowledgement of a `gen` that includes its own change. (7) `known` is seeded from the kept record at start. (8) `WIRE_MINOR` moves once for M9, 34 to 35, for the `opened` of `resolve`, `relocate`, `link` and `remove`; M12 takes the next. Left as it was: a stored label from the machine's own derivations is visible to a remote caller through `update`, a no-change `link` and `session.projects.list`, as design §11 publishes the same labels in every record.
17. **2026-11-10, the app's executor, at M10 and from its review (five rounds at `doperpowers:reviewer-high`; eleven findings, all fixed, 70097cb50 to cf8e2b2fe).** (1) `src/main/org/channel/channel.ts` is unchanged: main already opens any lower-case UUID, which is every id the hub keeps a log for; offering the Channel tab only where the page has a row is M11's. (2) "Holds a grant on" (design §11) is read from each machine's own ledger (`endpoint.grants`, which answers a non-owner their own entry) at link-up, at each new head and at each capability change of the link, overlapping reads coalesced into one more, and kept per member in a fourth file, `<userData>/org/member-grants.json`, with the key id that signed each grant, so a grant whose signer the held head revokes ends while the machine is off. (3) A record that does not verify when it arrives waits, the newest per machine, and is tried again at each session change, as the rows' waiting set does. A held record is verified again at the soonest delegation expiry and at the next sign-in once an expiry has passed; its deadline is taken, at the same instant as its verification, from the delegation of a certificate that verifies, and a delegated machine with none is hidden until it is verified again. A mark is dropped only when the head retires or revokes its key, also for marks loaded from the file. (4) The key table's first computation waits for the file and this Mac's first rows, so an entry is never published from an empty table (§I: an entry never changes). (5) A held removal is the asking member's act, listed and sent only while that member is signed in, and is sent when the machine's link has a current channel, not only on the link's up transition. A refusal from another machine reaches main as `internal` with its `<code>:` words, so a held removal and the page read the code from the message: `unresolved`, `host_unavailable` and `timeout` keep it held, anything else drops it with `<path> on <machine> was not removed: it changed after you asked.` (6) A project all of whose locations are held for removal leaves this device's view; a project's name, `hub` and `renamable` are computed from all its locations, not only those the member sees. (7) `moved` also names an id whose locations went back to an earlier project. (8) `src/main/app.ts` gains the registry's composition at the `createRemoteRows` block and nothing else (the architect's ruling, told to O15's coordinator); the rows lose `localProjects`. (9) The capability guard of §G is at lane B's send (`src/main/lane-b/remote.ts`): to a peer whose handshake lacks `rl2.project-acts`, `addFolder` with `into` or `own`, `link`, `relocate`, `remove` with `expect` and `resolve` are refused `not-offered` before sending, and each act carries the requirement so a resend after a reconnection is checked again; with no current channel they are refused `host_unavailable`.
18. **2026-11-10, the app's executor, at M11 and from its review (three rounds at `doperpowers:task-reviewer`; seven findings, all fixed, ad70265b3 and da785cb15).** (1) Other machines' locations enter the projects map as records the page tells apart by identity, not by a field on the wire's `ProjectRecord`; this Mac's own locations stay its index's records, and a machine's own answer at an address wins over the registry's record there. (2) The machines line shows on registry rows only, with `<name> offline` for a machine that is off, so a signed-out page is unchanged (design acceptance 9). (3) The Link suggestion finds the project by the id the clone's remote derives, which main now gives each location (`remoteProject`, an optional field of §I's `OrgProjects` that main fills; the machines' wire is unchanged); suggestions and acts appear only where `acts` holds and the machine is up. (4) A project the member sees only through sessions is a row with no hover card and no location actions, keeping its Channel (a hub project's) and its People toggle. (5) "+ Session" on a project with no folder on this Mac opens a New chat on its first location whose machine is up and whose folder is present, and the unstarted tab keeps the registry project, so switching machine offers that project's location there with no live read; after a page reload such a tab is a plain New chat, since main's intents carry no registry id (deferred). (6) A remote setup's choices for a registry project are its own locations, by id, never another project's that shares its label. (7) Add project keeps the chosen machine when it goes down and disables Add with the reason. (8) Non-address layout keys move only once this Mac's projects are loaded. (9) `e2e/registry.spec.ts` runs in `e2e:settings` over a harness-only fixture in main (`src/main/org/registry-fixture.ts`, inert in a packaged app and without `MAWS_E2E_REGISTRY`), installed by one line beside the other fixtures in `src/main/app.ts`, with a stand-in for another machine's project acts in `src/main/lane-b/remote.ts` ahead of the link and the step-up; `src/main/ipc/router.ts` is untouched. The bare e2e set's count is 108.

## Outcomes & Retrospective

Pending — written at finish.
