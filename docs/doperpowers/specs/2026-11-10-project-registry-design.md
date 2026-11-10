# The org's project registry: one project, a location on each machine (2026-11-10)

**Status.** A design draft, not approved for building. Written by the MAWS architect with doperpowers:brainstorming, from the owner's proposal at O8 M8's sitting (2026-11-10) and their answers that day. Three owner decisions are open (§12). A critic's review and the desk track's review of §4, §5 and §8 are pending.

- **Board:** MAWS #521 (the app's half) and the desk board's #181 (sminos's half). This document is the design both wait for.
- **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (P5). It is a follow-up to P5, outside P5's acceptance (owner, 2026-11-10; P5 Decision Log 263).
- **Amends:** P5's contract OX3 and Decision Logs 21 and 27 (§13).
- **Research behind it:** a map of the project model in MAWS at master 1a0ce4c5f, a map of sminos's at doperpowers' checkout of 2026-11-10, a reading of the three reference apps, and a prior-art survey (§14).

## Purpose

**Higher purpose.** P5's: one MAWS app shows every machine a person may see, the org's projects, and the sessions in each, and drives each session on whatever machine it runs. P5's scene says "the sidebar lists projects, not folders".

**What it is for.** Today a project is something each machine works out from its own files, and the app shows a project only when this Mac holds a folder of it. The registry makes the project a stored thing of the org: one project, with the folder it lives in on each machine that holds it. Then:

1. the same project on several machines is one project everywhere, also when its folders are not clones of one repository;
2. a project whose only folder is on another machine is listed on every Mac and can be worked from there, the work running on the machine that holds the folder;
3. a folder becomes a project by one act, in the app or in a terminal, on the machine itself or from another one.

### The scene at its best

On the mini, over SSH, the owner types `maws project add .` in `/srv/scrape`, a folder with no git and no `.smns`. Within seconds the MacBook's sidebar has a row `scrape` marked `mini`. "+ Session" on that row starts a session on the mini in that folder, with the mini's terminal, files and diff. Its to-human messages are in the project's Channel tab.

Later the owner makes a folder for the same work on the MacBook and picks "Add location…" on the row. The row now reads `mini · macbook`; sessions from both machines sit under it, and `sminos list` on either machine files them in the one project. A clone of a repository on a third machine joins its project with no act at all, as today.

The mini is switched off. The row stays, its mini location reads "offline". The owner renames the folder on the MacBook; the location reads "folder not found on macbook" with Locate… and Remove beside it, and nothing was deleted.

### What it must not be

- **A file sync.** Nothing copies files between machines. A location is where work runs.
- **A second permission system.** Who sees a project follows from the machines and sessions they can already see (owner, 2026-11-10).
- **A table that clients edit.** No device writes another machine's path as a fact. Zed's account-held list of (server, path) rows was removed six months after it shipped, with entries that could not be deleted and stale entries that survived a reinstall (§14).
- **A change that needs the root's signature per folder.** That would rule out a terminal on a VM.
- **A requirement for sign-in.** Signed out, MAWS works as today (P5 acceptance 1).
- **A second rule for a session's project.** sminos and MAWS decide a directory's project by one rule, or sessions move between projects at every reconcile.

## Terms

- **Project.** A thing of the org: an id, a name, and its locations.
- **Location.** A folder on one machine that belongs to a project: a machine and a path. A project may have several locations on one machine (two clones).
- **Declared.** A location is declared when someone added it (Add project, the command line), or by the automatic rule the owner picks in §12. It is what P5 called a checkout.
- **Link.** A stored statement that a folder belongs to a named project, whatever its files would derive.
- **Projects record.** One machine's signed statement of its locations (§4).
- **The registry.** The projects records of the org's machines, kept by the hub and read by every device. Nothing else is stored.

## What exists (master 1a0ce4c5f)

- **Four ids for one idea.** A machine's index id for a project (`<ref>/<uuid>` as an address). The app's row key `OrgKey` (`smns:`, `remote:`, `repo:<ref>:`, `folder:<ref>:`; `src/services/index/org-project.ts`). sminos's project id (a `.smns` id, or `uuid5(org, remote key)`; `src/shared/machine/project-ids.ts`). And `OrgState.projects` in the signed head, which nothing writes (`apps/org-protocol/src/types.ts:62,84`; its only reader is `src/endpoint/rl10/org-directory.ts:53`).
- **A folder or a repository with no remote has no sminos id.** Its key holds its machine's ref, so it joins nothing on another machine, its sessions are in sminos's machine project, and it has no Channel (`src/services/channel/lane-b.ts:19-22`).
- **A machine reached over the network sends the app no project list.** The page takes no snapshot from a machine its rows cover (`src/renderer/src/ipc/events.ts:296`), so the sidebar's project rows come from this Mac's own index alone. `joinIds` maps a listing's project to a row through this Mac's projects only (`src/main/org/rows.ts:599-612`). A session whose project has no folder here sits under its machine's row.
- **A listing names a project by sminos's id and carries no path** (`apps/org-protocol/src/types.ts:114-121`).
- **Over the network only two project commands are offered:** `session.projects.list`, and `session.projects.addFolder` (`machine-admin`, the machine's owners, always with Touch ID; `src/endpoint/offers.ts:265-270`, `src/main/lane-b/remote.ts:245`). `add`, `update` and `remove` are refused before they leave, so "Remove from sidebar" on another machine's project does nothing.
- **sminos learns the org's projects from the endpoint's directory,** which lists only `head.projects`, always empty (#181). The hub still holds DX2's unsigned `projects` table, filled at a machine's `hello`; RL10 does not read it.
- **A machine-signed record kept once per machine already exists:** the endpoint record (`EndpointRecord`, `smns-endpoint-v1`), kept by the hub at its newest `issued` and verified against the head (`apps/desk-hub/src/objects/org-records.ts:285-293`).
- **There is no command for projects in a terminal.** `mawsd` has `status`, `restart`, `logs`, `enroll`, `keys`, `install`, `uninstall`, `render` and `endpoint …`. Its socket `<profile>/mawsd/machine.sock` serves the whole command table to a caller holding the profile's token (`src/mawsd/machine-client.ts`).

## Design

### 1. The shape

**Each machine states its own locations in one signed record. The hub keeps the newest record of each machine and hands the records to the org's devices and machines. Every reader verifies a record against the org state and assembles the projects from the records it holds.**

- A machine is the only writer of its record. A change to a location on machine M, asked from anywhere, is a request M carries out and then states. So an entry a machine removed cannot come back from another device's stale copy.
- The hub is the central store: a project is listed on the MacBook while its machine is off, and on a Mac that never spoke to that machine.
- The record is status, the request is intent. The first version delivers a request only to a machine that is up. Holding a request for a machine that is off is the same signed request kept by the hub for later, and is left out of the first version (owner, 2026-11-10).

### 2. Identity

- **A project has one id in the org: sminos's project id.** A folder with a `.smns` has the id in the file. A clone has `uuid5(org, remote key)`. A declared folder that derives neither gets a random id, minted by its machine and kept in its index. Listings, the Channel and sminos's logs already key by this id.
- **The app's row key stays.** `OrgKey` is unchanged, so no persisted layout moves, and a key still does not change at enrollment (Decision Log 27). A location's entry carries both its key and its id. The app groups locations by key and maps a listing's project id to a key through every record it holds.
- **Derived unless linked.** A location's project is what its files derive (a `.smns`, else the remote, else the folder itself), as today, unless it carries a link. A link stores the target project's key and id on the location and is not re-derived. So clones still join with no act, and a `.smns` is still read.
- **Names never join.** A name is a label on a project. Two projects may share a name.
- **Known edge.** A folder project that later gains a git remote or a `.smns` becomes the project those name, as today. Folders linked to it from other machines stay in the old project until relinked.

### 3. The machine's side

The machine's index already holds a row per project folder (`projects` in `index.sqlite`: `directory`, `origin`, `hidden`, `org_key`, `org_name`, `org_source`, `org_smns_id`). The registry adds to it:

- **Minting.** On an enrolled machine, a declared row whose derivation gives no id (`repository`, `folder`) gets a random id in `org_smns_id`, kept while its key is unchanged.
- **Links.** `org_source` gains `link`: the row's key, id and name are the target's, and the refresh that re-derives rows skips it.
- **A name's time.** `named`, set when a person names or renames the project (§9).
- **An anchor.** The folder's device, inode and birth time, taken at declaration, for finding a moved folder (§10).
- **A state.** `missing`, when the folder is not found (§10).
- **Publishing.** After any change to a declared row, and at each connection to the hub, the endpoint signs and sends its projects record (§4), as it sends its listings.
- **For sminos.** The endpoint tells the local sminos this machine's declared locations (path, project id, name), and the org's projects for its directory (§8).

**Commands** (`src/shared/ipc/schema/session.ts`; all `owner: 'machine'`):

- `session.projects.addFolder {directory, into?}` gains `into: {key, id}`: declare the folder and link it into that project. The machine refuses a target it finds in no verified projects record (`unknown-project`).
- `session.projects.link {id, into | null}`: change a declared location's project, or return it to what its files derive.
- `session.projects.relocate {id, directory}`: point a location at the folder's new path.
- `session.projects.update` (rename) and `session.projects.remove` (which hides the row, so it leaves the record) are offered over the network.
- Over the network each is `machine-admin` and the machine's owners' alone, as `addFolder` is. `addFolder`, `link` and `relocate` ask Touch ID, since each makes a folder a place sessions may start in; `update` and `remove` do not.
- One `WIRE_MINOR` bump.

### 4. The projects record

In `apps/org-protocol`, beside the endpoint record:

    ProjectsRecord = { org, machine: MachineRef, issued, locations: Location[], known: Known[] }
    Location = { pid, key, id, name, named?, path, source: 'smns'|'remote'|'repository'|'folder'|'link', remote?, state?: 'missing' }
    Known    = { key, id, name }

- `pid` is the machine's own id for the row, which commands to that machine name it by. `path` is canonical and absolute. `remote` is the folder's observed remote key, for suggesting folders; it joins nothing.
- `locations` are the declared ones. `known` are projects the machine has sessions in with no declared location: no path, and no row in the sidebar (unless §12's second question is answered "any repository"). They let sminos on other machines follow those projects (#181).
- Signed with the machine's key under a new domain, `smns-projects-v1`, and verified as an endpoint record is (`machineSigned`: the key that speaks for the ref in the head now).
- One per machine. A newer `issued` replaces the older; the machine never issues one that is not newer than its last.
- Bounded: at most 1,000 locations and 256 KiB. At the bound the machine refuses a new declaration and says so.
- A record of a machine the head retired no longer verifies, so its locations are gone from every reader with no cleanup.

### 5. The hub

- A table as `endpoints` is: one row per machine ref, the newest `issued`, refused `409` when not newer. An up frame `{t: 'projects', record}` beside `listing` and `endpoint`.
- Served to a member's devices with the listings, and sent to each machine at its welcome and on change, so that an endpoint can build sminos's directory.
- Verified against the head as a courtesy, as the other records are. The hub confers nothing; every reader verifies.
- `OrgState.projects` stays unwritten and is marked reserved. DX2's `projects` table stays unread. Removing either is a hub cleanup outside this design.

### 6. The app

- **Main** reads the projects records with the listings, verifies each, and keeps them under `<userData>/org/`, so a relaunch with the hub unreachable still lists them.
- **The join.** `joinIds` maps project id to key from every record, not from this Mac's rows alone.
- **The store.** For a machine reached over the network, main gives the page a project for each of its declared locations (its address from `pid`, its `directory` the path, its `org` the key, name, source and id, and its state). The page's assembly (`orgIndex`) then lists a project that has no folder on this Mac, and files remote sessions under it, by the rules it already has.
- **A row** shows its machines. A location whose machine is off reads "offline" with the time the machine was last seen; a missing one reads "folder not found on <machine>".
- **The hover card** lists the locations: machine, path, state, and Remove and Locate… for a missing one.
- **Add project** takes a machine (this Mac, or another machine the person owns that is up), a folder (browsed with `machine.folders.list`, or typed), and optionally an existing project to add it to.
- **"Add location…"** on a project's menu is Add project with the project filled in.
- **"+ Session"** offers the project's locations, as it does today from a live read; the record saves the round trip.
- **The Channel** opens for any project the records name, by its id.
- **"Remove from sidebar"** keeps its meaning: it removes the project's locations on every machine that is up, for everyone. A location on a machine that is off stays and the row returns with it, as today.

### 7. Declaring from a terminal

A command `maws project` (its name is §12's third question), a thin front on the daemon's socket:

- `maws project add [DIR] [--into <project>] [--name <name>]`, `maws project list`, `maws project show [DIR]`, `maws project remove [DIR]`, `maws project link [DIR] --into <project> | --none`.
- **On the machine itself** it needs the profile's token and nothing else: no login, no confirmation. This is the case of a folder on a VM, typed over SSH.
- **Aimed at another machine** (`maws project add mini:/srv/scrape`), on a Mac where MAWS is signed in and running, the daemon passes the request to the app, which shows it and asks Touch ID, as Add project on another machine does. The command waits and prints the result. With no app running it says so and names the alternative: run it on that machine.
- **On a machine with no app** a command aimed elsewhere is refused. A login there would be a new device class with a member key on disk (owner, 2026-11-10: left out).
- `--into` takes a project's name or id, and lists the candidates when a name is shared.

### 8. One rule for a directory's project (sminos and MAWS)

Walking up from the directory, the first folder that is a declared location or holds a `.smns` decides. At a folder that is both, a link wins over the file; otherwise the two agree. With none found: a linked worktree repeats the walk from its owning repository; then the repository's remote gives `uuid5(org, remote key)`; then the machine's own project. The last three steps are today's.

- sminos reads the machine's declared locations from a file the endpoint keeps current, so a session started in a terminal resolves with no daemon running. A machine that is not enrolled has no such file and resolves as today.
- The endpoint's org directory lists as hub projects every project the records name (`locations` and `known`), in place of `head.projects`. This closes #181: a machine follows a project whose sessions are all elsewhere.
- Shared vectors pin the rule in both repositories, as sminos's remote-key vectors are vendored in `test/fixtures/sminos/` today.
- **At the upgrade** a declared folder with no id gets one, and sminos moves its sessions from the machine's project into the new one, once.

### 9. Names

- An entry carries `name`, and `named` when a person chose it.
- A project's name is the chosen name with the newest `named` among its locations; else a `.smns`'s name; else the remote's; else the folder name of its first location in machine order. Every device computes the same name from the same records.
- Rename sends `session.projects.update` to one location's machine.

### 10. Missing, offline, moved, retired

- **Missing and offline are different states and neither removes anything.** Missing is the holding machine's own statement that the folder is not there (not found, or not a directory). A folder the daemon may not read is present. Offline is the machine's state, shown with the record the hub kept.
- The machine checks its declared folders at start, every ten minutes, and when a start in one fails.
- **Moved.** When a folder is declared or first seen whose anchor equals a missing location's, that location is pointed at it. Locate… does the same by hand. A folder that returns to its path is present again.
- **Copied.** A second folder on a machine deriving a project that already has a present location there is a second location, as two clones are today.
- **Retired.** A retired machine's record stops verifying.

### 11. Who sees what

- The hub hands the records to every member, as it hands listings. The app lists a project for a member who owns or holds a grant on a machine with a location of it, or who sees a session of it. In the second case alone the row has the sessions and no location actions.
- A member with a grant on a machine therefore sees every declared path on it. This follows from "visibility follows access" and is stated here so that it is chosen, not found.
- Signed out there is no registry, and the local rows are today's.

### 12. Open owner decisions, with recommendations (asked 2026-11-10)

1. **Which projects each Mac lists.** Recommended: the same list on every Mac. Alternatives: the same list with projects that have no folder on this Mac in a collapsed group; or each Mac lists only what was added on it.
2. **What declares a folder with no act.** Recommended: a `.smns` in the folder (#521's case). Alternatives: also every repository a session ran in; or nothing.
3. **The command's name.** Recommended: `maws project …`. Alternatives: `sminos project add`; or both.

Stated to the owner as the design's reading, open to objection:

- "Worked from other machines" means sessions on the holding machine, each with that machine's terminal, files and diff. A project-level terminal or file browser with no session is a later step.
- Linking a folder that has history moves its sessions under the project. Its earlier Channel messages stay under the old id and are not shown.

### 13. What this amends

- **OX3** becomes: an org project is the registry's, with its declared locations; `OrgProject.checkouts` are locations, read from the projects records for machines reached over the network and from the machine's own answer otherwise. Decision Log 27's "a checkout is a project someone opened on its machine" becomes "a declared location".
- **#521's options.** The directory's projects come from the records: (a)'s result with a signed source, and neither a head change (b) nor a second path in sminos (c).
- **`session.projects.remove` and `update` over the network,** which the sidebar already sends and the endpoint refuses.

### 14. Prior art

- **Syncthing** is the working model closest to this: a generated folder id shared by all devices, a path each device keeps for itself, a label apart from the id, and a folder whose marker is missing is stopped, never treated as deleted. Its introducer feature shows what several writers of one list cost: a removed device is added again.
- **Zed** held remote projects per account on its server and removed the feature in favour of plain SSH after six months.
- **The Codex app, Claude Desktop and T3 Code** each store one location per record. T3 alone merges the same repository across machines, by a key derived from the git remote, and offers the machine in the composer. None stores a project with several locations or links folders that are not clones.
- **VS Code** keys a remote workspace by a hash of host and path, so a moved folder loses its state, and it prunes nothing; its maintainers' rule for pruning is "only on a real not-found, never on unreachable".
- **Kubernetes and Consul** separate what is asked from what the node reports, with the node's report authoritative for its own state.

### 15. Alternatives rejected

- **Projects in the signed head.** A root signature per folder; no terminal on a VM could declare. Rejected.
- **A table in the hub that devices edit.** The hub would become an authority, against RL's trust model, and Zed's history is the failure. Rejected.
- **A stored project record signed by a member's device** (id, name, tombstones) beside the machines' records. It gives one writer for a name and removal on a machine that is off, at the cost of a second kind of record and a rule for when the two disagree. Deferred with the held requests of §1; nothing here blocks it.
- **Freezing a location's project at declaration.** Stable, but a folder that later gains a remote would no longer join its clones, which works today, and sminos would need the org's map of remotes. Rejected for "derived unless linked".
- **The app reading each machine's project list live, with no record.** No hub copy, so nothing for a machine that is off, for sminos, or for the phone. Rejected.

### 16. Unknowns, each with the move that settles it

- Whether an older sminos ignores the new frames: the desk track reads `sminos_uplink.py`'s intake; else a version gate.
- The order of rows with no folder on this Mac: built provisionally after the local rows, shown to the owner at the first build.
- The time from a declaration on one machine to the row on another: measured at the live check; the bound proposed is 5 s.
- How the daemon passes a terminal's request to the app: the spec picks between an event on the daemon's socket and a new app-side listener, after reading how main attaches to `machine.sock`.

## Acceptance

On the MacBook, the mini and one devcloud VM, signed in to production's org:

1. **#521.** On a Mac with no folder of a project whose sessions run elsewhere: `sminos list --org` shows them under the project, the sidebar shows the project with them, and its Channel shows their messages, each marked with its machine.
2. **A folder on one machine.** A folder on the mini with no git and no `.smns`, declared there over SSH with one command, is a row on the MacBook within the measured bound. "+ Session" on it starts a session on the mini in that folder. Its Channel works.
3. **From elsewhere.** The same from the MacBook's app (Add project, the VM, a folder, Touch ID) and from the MacBook's terminal.
4. **Link.** A folder on the MacBook added to that project: one row, two locations, sessions of both under it, one project in `sminos list` on both machines, both machines' messages in the Channel.
5. **Clones.** The same repository on two machines is one row with no act.
6. **Missing.** The folder renamed on disk: the location reads "folder not found", nothing is removed, Locate… restores it, and so does moving it back.
7. **Offline.** With the mini's daemon stopped the project is still listed after a relaunch, its location "offline".
8. **Removal.** Remove acts on another machine's location; a retired machine's locations are gone.
9. **Signed out.** Every project and session as before (P5 acceptance 1).
10. **One rule.** sminos and MAWS give the same project id for each directory of the shared vectors.

## Route

doperpowers:execspec, as a spec with milestones on two tracks. The desk track: the record in `org-protocol`, the hub, sminos (§4, §5, §8). The MAWS architect: the index and endpoint, main, the page, the command (§3, §6, §7), and the live check.

## Decision Log

1. **2026-11-10, the owner, at O8 M8's sitting.** The proposal: a project per org with each machine's location stored centrally, a folder declared from the app or a command line. Visibility follows access. Any folders may be linked. Declaring a path on another machine is allowed, as a request to that machine. The command line takes no separate login. The design is written right after M8 and built as a follow-up outside P5's acceptance.
2. **2026-11-10, the architect.** Each machine states its own locations in one signed record kept by the hub; the head's list and a hub table were rejected (§15). The project's id is sminos's, minted for a folder that derives none; the app's key is unchanged; a location's project is derived unless linked (§2).
