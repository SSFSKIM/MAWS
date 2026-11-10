# The org's project registry: one project, a location on each machine (2026-11-10)

**Status.** Approved by the owner on 2026-11-10 for building (Decision Log 9; P5 Decision Log 265). Written by the MAWS architect with doperpowers:brainstorming, from the owner's proposal at O8 M8's sitting (2026-11-10) and their answers that day (§12). Revision 6 folds in the desk track's two reviews of §4, §5 and §8 and a critic's four rounds, the last of which left notes for the spec alone (Decision Log 3 to 8; §17).

- **Board:** MAWS #521 (the app's half) and the desk board's #181 (sminos's half). This document is the design both wait for.
- **Execution:** `docs/doperpowers/plans/2026-11-10-project-registry.md`, the milestones on both tracks, their interfaces and the record of the build.
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
- **A folder that takes what lies beneath it.** A project folder never takes a clone of another repository under it out of that repository's project.

## Terms

- **Project.** A thing of the org: an id, a name, and its locations.
- **Location.** A folder on one machine that belongs to a project: a machine and a path. A project may have several locations on one machine (two clones).
- **Declared.** A location is declared when it is a sidebar row of its machine: a folder someone added (Add project, the command line, a request from another device) or started a MAWS session in, and has not removed, as today; and a folder holding a `.smns` when a session has run in it or beneath it (owner, 2026-11-10). It is what P5 called a checkout.
- **Stored statement.** The machine's own record that a folder is in a given project, kept in its index and changed only by an act: a **minted** id for a folder whose files name no project, or a **link** to another project. It behaves as a `.smns` kept outside the folder, except that it does not cover a clone of another repository beneath it (§8).
- **Projects record.** One machine's signed statement of its locations (§4).
- **The registry.** The projects records of the org's machines, kept by the hub and read by every device. Nothing else is stored.

## What exists (master 1a0ce4c5f)

- **Four ids for one idea.** A machine's index id for a project (`<ref>/<uuid>` as an address). The app's row key `OrgKey` (`smns:`, `remote:`, `repo:<ref>:`, `folder:<ref>:`; `src/services/index/org-project.ts`). sminos's project id (a `.smns` id, or `uuid5(org, remote key)`; `src/shared/machine/project-ids.ts`). And `OrgState.projects` in the signed head, which nothing writes (`apps/org-protocol/src/types.ts:62,84`).
- **Key and id are not one-to-one.** `sminos project init --hub` writes a `.smns` holding the remote-derived id, so a clone with that file is `smns:<id>` and a clone without it is `remote:<key>`, both with one id. A repository with no remote is keyed by a hash of its path, so its key changes when it moves.
- **A folder or a repository with no remote has no sminos id.** It joins nothing on another machine, its sessions are in sminos's machine project, and it has no Channel (`src/services/channel/lane-b.ts:19-22`).
- **A row's sessions are those started in exactly its folder,** or in a worktree of it (`src/services/index/projects.ts`, `projectAt`). A session started in a subfolder gets a row of its own, which joins its parent's row only through git or a `.smns`.
- **A machine reached over the network sends the app no project list.** The page takes no snapshot from a machine its rows cover (`src/renderer/src/ipc/events.ts:296`), so the sidebar's project rows come from this Mac's own index alone, and `joinIds` maps a listing's project to a row through this Mac's projects only (`src/main/org/rows.ts:599-612`). A session whose project has no folder here sits under its machine's row.
- **A listing names a project by sminos's id and carries no path** (`apps/org-protocol/src/types.ts:114-121`). The id comes from sminos's own resolution on that machine (`src/endpoint/listings.ts`).
- **Over the network only two project commands are offered:** `session.projects.list`, and `session.projects.addFolder` (`machine-admin`, the machine's owners, always with Touch ID; `src/endpoint/offers.ts:265-270`). `add`, `update` and `remove` are refused before they leave, so "Remove from sidebar" on another machine's project does nothing.
- **sminos learns the org's projects from the endpoint's directory,** which lists only `head.projects`, always empty (#181). The hub's own `projects` table (DX2), filled at a machine's `hello`, is what the Worker checks before it serves a project's log, and what desk-web lists.
- **A machine-signed record kept once per machine already exists:** the endpoint record (`smns-endpoint-v1`), kept by the hub at its newest and verified against the head (`apps/desk-hub/src/objects/org-records.ts:285-293`).
- **There is no command for projects in a terminal.** `mawsd`'s socket `<profile>/mawsd/machine.sock` serves the whole command table to a caller holding the profile's token (`src/mawsd/machine-client.ts`).

## Design

### 1. The shape

**Each machine states its own locations in one signed record. The hub keeps the newest record of each machine and hands the records to the org's devices and machines. Every reader verifies a record against the org state and assembles the projects from the records it holds.**

- A machine is the only writer of its record. A change to a location on machine M, asked from anywhere, is a request M carries out and then states. So an entry a machine removed cannot come back from another device's stale copy.
- The hub is the central store: a project is listed on the MacBook while its machine is off, and on a Mac that never spoke to that machine.
- The record is status, the request is intent. The first version delivers a request only to a machine that is up, with one exception the app holds itself: a removal (§6). A request the hub holds for a machine that is off is left out (owner, 2026-11-10). It is not the present signed act kept longer: an act is refused after 60 seconds and is sealed for a machine that is up (RL4).

### 2. Identity

- **A project is its id: sminos's project id.** Listings, the Channel and sminos's logs key by it already. The app groups locations and sessions by id. Where a row has no id (signed out, or not enrolled) it is grouped by its key, as today.
- **A folder's project is §8's rule.** At one folder the order is: a link, a minted id, a `.smns`, the repository's remote (`uuid5(org, remote key)`). A stored statement beats the folder's files.
- **Minting happens at a declaring act:** an add, a first MAWS use, and, for the rows that exist then, the moment stored statements first become possible on the machine (the upgrade, its enrollment, its sminos saying it reads locations). A folder that §8 would at that moment leave in the machine's own project gets a random UUID as its stored statement, once. It stays through a move of the folder, a new path, a remote or a `.smns` added later, and beside a link. A subfolder of a project's folder is already in that project and is not minted. Nothing else mints: a declared folder that later falls to the machine's project (its parent's row was removed) carries the machine's id until that changes.
- **A link** is a stored statement naming another project's id.
- **A stored statement changes only by an act.** So a project never splits because a file changed. Where files alone name the project (a `.smns`, a remote) the project follows the files, as today.
- **A stored statement wins at its own folder, a `.smns` there included.** Any folder may be linked (owner, 2026-11-10), a clone whose `.smns` is committed among them; the other clones of that repository follow the file until they are linked too. A `.smns` that appears later in a folder with a minted id changes nothing by itself, so no git operation moves a session; the app shows it as a suggestion to follow the file, which is a link. `sminos project init` in a folder with a stored statement writes that id, as `--hub` pins a remote's id today, and says so.
- **A stored statement is about one folder, not whatever is at its path.** The machine records the folder's device, inode and birth time when the statement is made. When the path later holds a different folder (deleted and cloned anew, a reused scratch name), the statement counts on neither side and the location reads "replaced" until a person says "use this folder" or removes it. Without this an unrelated repository at the old path would be in the old project silently, since a statement beats its files. A folder restored from a backup asks once, which is the safe direction.
- **A link sits beside the minted id and does not replace it.** Removing the link returns the folder to its minted project, where other machines' links into it still are.
- **`OrgKey` stays as the folder's label on its machine,** unchanged, so a key still does not change at enrollment (Decision Log 27).
- **A row's layout key on a device is assigned once and kept.** It is the device's own location's key at that moment when it has one, so today's tab sets stay where they are, and otherwise a key made from the id alone. It does not change when locations come and go. When two keys on one device turn out to be one project, the second's set is moved whole into the first's.
- **Clones.** Two clones of one repository derive one id and are one project with no act. A folder that was declared before it had a remote keeps its minted id, and a clone of that remote on another machine derives the repository's own id. The app shows the match as a suggestion on the row, and Add project asks with the link as its default. Nothing is linked unasked: a remote a record reports joins nothing by itself.
- **Names never join.** A name is a label. Two projects may share a name.

### 3. The machine's side

The machine's index holds a row per project folder (`projects` in `index.sqlite`). The registry adds to it:

- **The stored statement:** the minted id and, beside it, a link's target, in columns of their own. `org_source` keeps its four values, so neither its CHECK nor the wire enum changes.
- **No statement by side effect for the broadest folders.** The home directory, a folder above it and a filesystem root get a stored statement only by an explicit add. Today any MAWS start in a folder makes it a sidebar row (`usedByMaws`), and a statement there would cover what lies beneath (§8).
- **The folder's anchor** (device, inode, birth time; §2), **a name's counter** (§9) and **a state**, `missing` or `replaced` (§10).
- **Publishing.** After any change to a declared row, and at each connection to the hub, the endpoint signs and sends its projects record (§4), as it sends its listings.
- **Unknown is not empty.** The endpoint never signs a record from an index it could not load. It keeps its last signed record on disk, and an index that was rebuilt takes its stored statements back from that record, by path, before the next record is signed.
- **For sminos.** The endpoint's org frame gains this machine's declared locations, and its directory lists the org's projects (§8).
- **Minting and linking wait for sminos.** A machine makes a stored statement only once its sminos has said it reads locations (a capability in its `hello`). Until then the sessions would be listed under another project than the app expected.

**Commands** (`src/shared/ipc/schema/session.ts`; all `owner: 'machine'`):

- `session.projects.addFolder {directory, into?, own?}` gains `into: <project id>`: declare the folder and link it. The machine refuses an id it finds in no verified projects record (`unknown-project`), and a target that is no hub project (Decision Log 10). Adding a folder that is already inside a project adds it as a location of that project and says so; a project of its own there is by request (`own`).
- `session.projects.link {id, into | null}`: link a declared location, or remove its link.
- `session.projects.relocate {id, directory}`: point a location at the folder's new path. When the index already holds a row at that path, the two are merged: its sessions move to the located row. It is refused when that row has a stored statement of its own.
- `session.projects.update` (rename) and `session.projects.remove` (which hides the row, so it leaves the record; its stored statement is kept, counts on neither side while the row is removed, and adding the folder again restores the same project) are offered over the network.
- Over the network each is `machine-admin` and the machine's owners' alone, as `addFolder` is. `addFolder`, `link` and `relocate` ask Touch ID, since each makes a folder a place sessions may start in; `update` and `remove` do not.
- Every change to a stored statement (a declaration, a link or its removal, a remove, a relocate) answers only after the endpoint has restated its locations to sminos, so that the next session in the folder is not filed elsewhere and then moved.
- One step of `WIRE_MINOR` for the machines, which swap once (the execution document's Decision Log 2).

### 4. The projects record

In `apps/org-protocol`, beside the endpoint record:

    ProjectsRecord = { org, machine: MachineRef, revision, issued, locations: Location[], known: Known[] }
    Location = { pid, id, key, name, nameRev?, path, source, stated?: 'minted'|'linked', hub?: false, remote?, state?: 'missing'|'replaced' }
    Known    = { id, name }

- `pid` is the machine's own id for the row, which commands to that machine name it by. `path` is canonical (the real path, NFC) and absolute. `key` and `source` are the folder's label and what its files derive. `remote` is the folder's observed remote key, for suggesting and linking; it joins nothing by itself. `hub: false` marks a location whose project its `.smns` decides when that file names no hub of this org: its log is not on the hub, so it is a row in the app and is left out of sminos's directory.
- `locations` are the declared ones. A declared folder that §8 leaves in the machine's own project (a home directory made a row by use) is carried with that id and stays under the machine's row. `known` are projects with live sessions on the machine and no declared location there: no path, and no row of their own. They let sminos on other machines follow those projects (#181).
- Signed with the machine's key under a new domain, `smns-projects-v1`, and verified as an endpoint record is (`machineSigned`).
- One per machine, ordered by `revision`, a counter as a listing's is; `issued` is for display. The hub refuses a revision that is not higher, and a reader keeps each machine's highest and takes none below it.
- Bounded: at most 1,000 locations and 256 KiB. At the bound the machine refuses a new declaration and says so.
- A record of a machine the head retired no longer verifies, so its locations are gone from the app with no cleanup (§8 for sminos).

### 5. The hub

- A table as `endpoints` is: one row per machine ref at its highest revision. An up frame `{t: 'projects', record}` beside `listing` and `endpoint`.
- Served to a member's devices with the listings, and sent to each machine at its welcome and on change, so that an endpoint can build sminos's directory.
- Verified against the head as a courtesy, as the other records are. The hub confers nothing; every reader verifies.
- The hub's own `projects` table stays what it is: the projects that have a log. A minted project enters it at its machine's sminos's first `hello`, and its Channel is served from then. That table keeps the name of the first `hello`, so the phone and desk-web show a project's old name after a rename: residue for the desk track.
- `OrgState.projects` stays unwritten and is marked reserved.

### 6. The app

- **Main** reads the projects records with the listings, verifies each, and keeps them under `<userData>/org/`, so a relaunch with the hub unreachable still lists them.
- **Grouping by id.** The page's assembly groups every machine's locations by project id, and a listing's session goes to its project by id. A wrong key in a record can therefore not pull sessions under another row. On a Mac that is signed in and not enrolled, the app computes a `remote:` row's id from its key, as `joinIds` does today.
- **The store.** For a machine reached over the network, main gives the page a project for each of its declared locations (its address from `pid`, its `directory` the path, its `org` the key, name, source and id, and its state).
- **Every Mac lists every project of the org that the person can reach** (owner, 2026-11-10). A row shows its machines. A location whose machine is off reads "offline" with the time the machine was last seen; a missing one reads "folder not found on <machine>".
- **The hover card** lists the locations: machine, path, state, and Remove and Locate… for a missing one.
- **Add project** takes a machine (this Mac, or another machine the person owns that is up), a folder (browsed with `machine.folders.list`, or typed), and optionally an existing project to add it to.
- **"Add location…"** on a project's menu is Add project with the project filled in.
- **"+ Session"** offers the project's locations, as it does today from a live read; the record saves the round trip.
- **The Channel** opens for any project the records name, once its log exists (§5).
- **"Remove from sidebar"** keeps its meaning: it removes the project's locations on every machine, for everyone. For a location on a machine that is off, the app keeps the removal, bound to the location as it was when asked, shows it as pending with a way to cancel, hides the row on this device, and sends the removal when the machine is next up. So a project on a stopped VM can be removed, which the kept records would otherwise prevent. Until it is delivered the other Macs still list the row.

### 7. Declaring from a terminal

A command `maws` (owner, 2026-11-10), put on PATH when the machine's daemon is installed, a thin front on the daemon's socket:

- `maws project add [DIR] [--into <project>] [--name <name>]`, `maws project list`, `maws project show [DIR]`, `maws project remove [DIR]`, `maws project link [DIR] --into <project> | --none`.
- **On the machine itself** it needs the profile's token and nothing else: no login, no confirmation. This is the case of a folder on a VM, typed over SSH.
- **Aimed at another machine** (`maws project add mini:/srv/scrape`), on a Mac where MAWS is signed in and running, the daemon passes the request to the app, which shows it and asks Touch ID, as Add project on another machine does. The command waits and prints the result. With no app running it says so and names the alternative: run it on that machine.
- **On a machine with no app** a command aimed elsewhere is refused. A login there would be a new device class with a member key on disk (owner, 2026-11-10: left out).
- `--into` takes a project's name or id, and lists the candidates when a name is shared.

### 8. One rule for a directory's project (sminos and MAWS)

For a directory D that is in no linked worktree, with R the root of its repository's checkout (none when D is in no repository):

1. Walking up from D, take the nearest folder that holds a `.smns` and the nearest folder that has a stored statement. A statement on a folder above R does not count when R derives a remote: a project folder does not take the clones beneath it. Of the two, the nearer decides; at one folder a link decides, then a minted id, then the file. A removed row's stored statement does not count, nor one whose path holds a different folder than it was made on (§2); the org frame's locations carry each statement's anchor, so sminos sees a replaced folder at once.
2. Else R's remote gives `uuid5(org, remote key)`.
3. Else the machine's own project.

A linked worktree is in its owning checkout's project. For a directory in a worktree of the main checkout R:

- when the rule at R is decided by R's own stored statement, that statement decides for the worktree too, before any `.smns` in the worktree. Otherwise a repository whose main checkout is linked would split, since each worktree carries the committed `.smns` at its own root;
- else a `.smns` on the worktree's own path decides, as today;
- else the rule is applied from R.

With no stored statements this is today's rule, but for one corner: a worktree outside its repository now takes a `.smns` above R as its main checkout does, where sminos today reads R's own file only. sminos's per-session `join` stays above the rule, as today.

- **In MAWS** the derivation of a row's project (`deriveOrg`) takes the same rule, so a session started in a subfolder of a declared plain folder is in that folder's project, which today it is not.
- **In sminos** the walk gains the lookup of stored statements. They reach it in the org frame the endpoint already restates and sminos already keeps whole (`daemon/org.json`): a top-level `locations` field, this machine's declared locations, each marked when its project is a stored statement. The frame is restated when the record changes as well as when the head does. An older sminos drops the field unread, and a frame without the field does not erase the locations sminos kept.
- **A session started in a terminal resolves with no daemon running,** from the last kept file. On a machine whose endpoint has said it sends locations and has not yet sent them, sminos keeps what it recorded and does not resolve again by files alone. Beside an older `mawsd`, which says no such thing, sminos resolves as today. A machine that is not enrolled resolves as today.
- **Paths are compared in one canonical form on both sides** (the real path, NFC), pinned by vectors shared by both repositories, as sminos's remote-key vectors are vendored in `test/fixtures/sminos/` today. sminos compares lexical paths today, and `/tmp` against `/private/tmp` would miss.
- **The directory.** The endpoint's org directory lists as hub projects every project the records name (`locations` and `known`), in place of `head.projects`. This closes #181 with no change in sminos.
- **Leaving.** sminos follows a project until the directory marks it retired. A new rule in sminos: a followed project with no folder here leaves when it has been absent, for a period the spec sets, from directories that were complete, that is, built from a verified current record of every machine the endpoint has held a record of that still has a key speaking for it. An incomplete directory removes nothing, so the hub cannot make machines drop a project by withholding a record. Leaving keeps the log on disk.
- **Spawns.** sminos counts every declared location as a known checkout, so a start in a folder declared a moment ago is admitted.
- **At the upgrade** a declared folder with no id gets one once its folder is found, and sminos moves its sessions from the machine's project into the new one, once, by the reconcile it already has.

### 9. Names

- A project that has a location whose project its `.smns` decides is named by the file, as the app already behaves, and Rename is not offered for it. A file under a stored statement names nothing.
- Otherwise its name is the chosen name with the highest `nameRev` among its locations, a counter set at each rename to one above the highest in the records for that project (a tie goes to the lower machine ref); else the remote's name; else the folder name of its first location in machine order. Every device computes the same name from the same records.
- Rename sends `session.projects.update` to one location's machine.

### 10. Missing, offline, moved, retired

- **Missing and offline are different states and neither removes anything.** Missing is the holding machine's own statement that the folder is not there (not found, or not a directory). A folder the daemon may not read is present. Offline is the machine's state, shown with the record the hub kept.
- The machine checks its declared folders at start, every ten minutes, and when a start in one fails.
- **Replaced.** A different folder at a stated location's path is the machine's statement too (§2), with "Use this folder" and Remove beside it. The suggestion to link by a reported remote (§2) is not made from a replaced location.
- **Moved.** Locate… points the location at the new path, and the project is unchanged, since its statement or its files travel with it. A folder that returns to its path is present again. Finding a moved folder automatically is left out of the first version.
- **Copied.** A second folder on a machine in a project that already has a location there is a second location, as two clones are today.
- **Retired.** A retired machine's record stops verifying.
- **A project with no location left** is in no record and leaves every sidebar and, by §8's rule, every directory. Its log stays on the hub.

### 11. Who sees what

- The hub hands the records to every member, as it hands listings. The app lists a project for a member who owns or holds a grant on a machine with a location of it, or who sees a session of it. In the second case alone the row has the sessions and no location actions.
- **Declared paths and observed remote keys become readable by the hub and by every member's device.** RL §5.9's account of what the hub reads gains them. A member with a grant on a machine sees every declared path on it. Both follow from "visibility follows access" with the hub as it is, and are stated here so that they are chosen, not found.
- Signed out there is no registry, and the local rows are today's.

### 12. The owner's decisions (2026-11-10)

1. **Every Mac lists the same projects.** Not a collapsed group for projects with no folder here, and not a list each Mac picks.
2. **A `.smns` in a folder declares it** when a session first runs there. A repository with no `.smns` that an agent merely ran in gets no row of its own; its sessions sit under their project's row when some machine declared that project, else under their machine's row, as today.
3. **The command is `maws project …`.**

Stated to the owner as the design's reading, open to objection:

- "Worked from other machines" means sessions on the holding machine, each with that machine's terminal, files and diff. A project-level terminal or file browser with no session is a later step.
- Linking a folder that has history moves its sessions under the project. Its earlier Channel messages stay under the old id and are not shown.
- A link is a statement about one folder on one machine. Linking a clone into another project leaves that repository's other clones where they are until they are linked too.

### 13. What this amends

- **OX3** becomes: an org project is the registry's, grouped by its id, with its declared locations; `OrgProject.checkouts` are locations, read from the projects records for machines reached over the network and from the machine's own answer otherwise. Decision Log 27's "a checkout is a project someone opened on its machine" becomes "a declared location", and its row key becomes the folder's label.
- **RL §5.9** gains declared paths and observed remote keys among what the hub and members' devices read (§11).
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
- **A stored project record signed by a member's device** (id, name, removals) beside the machines' records. It gives one writer for a name and removal on a machine that is off, at the cost of a second kind of record and a rule for when the two disagree. Deferred. What makes the deferral safe is in the design: grouping by id, stored statements that change only by an act, a machine that never signs from an unknown index, and the app's held removal. If it comes, device-signed events in the project's own log are a carrier that already exists.
- **Derived unless linked** (revision 1). A folder project that gained a remote would become the repository's project, its links broken and its Channel history out of view. Rejected for stored statements that change only by an act.
- **Every location's project fixed at declaration.** Then a `.smns` or a remote would be read once and never again, and sminos would need the org's map of remotes to file a session in a clone nobody declared. Rejected: only stored statements are fixed.
- **Grouping by the app's key** (revision 1). A clone with a pinning `.smns` and one without are two keys and one id, and a moved repository with no remote changes its key. Rejected for grouping by id.
- **A stored statement on a folder covering everything beneath it,** as a `.smns` does. One MAWS session started in a folder that holds many clones would take them all out of their projects. Rejected for §8's bound.
- **Declaring by writing a `.smns` into the folder.** No change to sminos's resolution, and it survives a lost index. It writes into the owner's folders, and linking a clone whose `.smns` is committed would change a committed file. Rejected; its property is kept: a stored statement behaves as a `.smns` kept outside the folder.
- **Linking a clone automatically by the remote a record reports** (revision 2). One odd link elsewhere could satisfy "exactly one project holds this remote", the result depended on the order records arrived in, and a wrong `remote` in one machine's record would write links on others. Rejected for a suggestion.
- **A `.smns` above a minted id at one folder** (revision 3). A pulled file holding another id would move a live session, and a branch without the file would move it back. Rejected for stored statements above files, uniformly.
- **Refusing to link a folder that holds a `.smns`** (revision 2). It narrowed the owner's "any folders", and its commonest case is a clone whose file is committed. Rejected.
- **The app reading each machine's project list live, with no record.** No hub copy, so nothing for a machine that is off, for sminos, or for the phone. Rejected.

### 16. Unknowns, each with the move that settles it

- Moving a whole tab set from one key to another (§2): `layout-model.ts`'s `rekeySets` does it for address keys only, and `refile` moves session tabs one at a time and leaves a set's file and artifact tabs behind. The spec designs the whole-set move and where the assigned key is kept.
- Whether a "Don't work in a project" chat makes the home directory a sidebar row today: the spec reads `usedByMaws`'s callers and the home row in a live index; §3's exception holds either way.
- The order of rows with no folder on this Mac: built provisionally after the local rows, shown to the owner at the first build.
- The time from a declaration on one machine to the row on another: measured at the live check; the bound proposed is 5 s.
- How the daemon passes a terminal's request to the app: the spec picks between an event on the daemon's socket and a new app-side listener, after reading how main attaches to `machine.sock`.
- Whether sminos compares folders by canonical path or by device and inode: the desk track's choice; the shared vectors are the contract either way.

### 17. Notes for the spec, from the reviews

- **The upgrade's order.** Evaluate every existing row against §8 with no statements, then mint, so that which of two nested declared folders is minted first decides nothing and every project from before is present after (P5 acceptance 1).
- **A worktree's own `.smns` that differs from its main checkout's project,** with no statement on the main checkout, is filed one way by sminos and another by MAWS's rows. It exists today and stays a residual; acceptance 10 claims equality for its vectors.
- **A repository with no remote whose `.smns` is on another branch** at a declaring moment is minted and then does not follow the file; the suggestion covers it. A vector.
- **`sminos project show`** says when a stored statement overrides a `.smns` in the folder, since the app's suggestion does not reach a VM. `sminos project init` beside a link and a minted id writes the id in effect.
- **Several profiles on one machine:** `maws` uses the socket of the profile whose endpoint sminos is bound to.
- **The hub keeps a project's first name** (§5): residue for the desk track.
- **`nameRev`, the held removal, the layout key's store, the canonical path form and the complete directory** are specified in §9, §6, §2, §8 and need their tests named.

## Acceptance

On the MacBook, the mini and one devcloud VM, signed in to production's org:

1. **#521.** On a Mac with no folder of a project that is declared on another machine, by an act or by its `.smns`: `sminos list --org` shows its sessions under the project, the sidebar shows the project with them, and its Channel shows their messages, each marked with its machine. For a repository nobody declared, `sminos list --org` shows its sessions under the project and the sidebar shows them under their machine (§12.2).
2. **A folder on one machine.** A folder on the mini with no git and no `.smns`, declared there over SSH with one command, is a row on the MacBook within the measured bound. "+ Session" on it starts a session on the mini in that folder. A session started in a terminal in a subfolder of it is under the same row. Its Channel works.
3. **From elsewhere.** The same from the MacBook's app (Add project, the VM, a folder, Touch ID) and from the MacBook's terminal.
4. **Link.** A folder on the MacBook added to that project: one row, two locations, sessions of both under it, one project in `sminos list` on both machines, both machines' messages in the Channel.
5. **Clones.** The same repository on two machines is one row with no act, also when one clone holds a pinning `.smns` and the other does not. A clone under a declared plain folder stays in its repository's project.
6. **Missing, moved and replaced.** A declared repository with no remote renamed on disk: the location reads "folder not found", nothing is removed, Locate… restores it in the same project, and so does moving it back. A different repository cloned at a stated folder's path reads "replaced", and a session started there is not in the old project.
7. **Offline.** With the mini's daemon stopped the project is still listed after a relaunch, its location "offline".
8. **Removal.** Remove acts on another machine's location; on a machine that is off it is held and delivered when the machine returns; a retired machine's locations are gone.
9. **Signed out.** Every project and session as before (P5 acceptance 1).
10. **One rule.** For each directory of the shared vectors, the project sminos gives is the project of the row MAWS files a session there under: nested declarations, a `.smns` above and below a statement, a link and a `.smns` at one folder, a clone under a declared folder, a linked worktree inside its repository, one outside it under another project's folder, a main checkout that is linked with a worktree carrying the committed `.smns` (both the link's project), a removed folder with a subfolder row, a folder linked and then unlinked (its minted project again), a subfolder, `/tmp` against `/private/tmp`.
11. **No session moves twice.** Over restarts of the daemon, a missing org file, a `.smns` appearing and going in a folder with a minted id (which moves nothing), and both orders of upgrading `mawsd` and sminos, each session's count of `moved` events is at most one, and a session started beside an older `mawsd` still resolves.

## Route

doperpowers:execspec, as a spec with milestones on two tracks, written at `docs/doperpowers/plans/2026-11-10-project-registry.md`. The desk track: the record in `org-protocol`, the hub, sminos (§4, §5, §8). The MAWS architect: the index and endpoint, main, the page, the command (§3, §6, §7), and the live check.

## Decision Log

1. **2026-11-10, the owner, at O8 M8's sitting.** The proposal: a project per org with each machine's location stored centrally, a folder declared from the app or a command line. Visibility follows access. Any folders may be linked. Declaring a path on another machine is allowed, as a request to that machine. The command line takes no separate login. The design is written right after M8 and built as a follow-up outside P5's acceptance.
2. **2026-11-10, the owner, to the first round of questions.** Every Mac lists the same projects; a `.smns` in a folder declares it; the command is `maws project …` (§12).
3. **2026-11-10, the architect, from the desk track's review of revision 1.** The locations reach sminos as a field of the org frame, not a new frame or file. A `.smns` wins at its own folder and such a folder cannot be linked. A `.smns` naming no hub of this org is carried with `hub: false`. The per-session `join` stays above the rule. The file's name wins. sminos gains the leaving rule, counts declared locations as known checkouts, and compares canonical paths. Minting waits for a sminos that reads locations.
4. **2026-11-10, the architect, from the critic's first round on revision 1.** Adopted: a project is its id and the app groups by id; stored statements change only by an act (revision 1's "derived unless linked" would have split a folder project when it gained a remote); a statement does not cover a clone beneath its folder, and the broadest folders get one only by an explicit add (revision 1's walk would have moved several hundred sessions on the owner's MacBook into a home project after one MAWS chat there); a revision counter in place of clocks; a machine never signs from an unknown index; the app holds a removal for a machine that is off; automatic finding of a moved folder is cut; RL §5.9 is amended; acceptance 1 is scoped to the owner's second answer and acceptance 11 counts moves. Not adopted: "a folder made a row by use gets no id". Every Mac lists the same rows by the owner's first answer, and a row with no id would be empty on every other Mac; the exception for the broadest folders and §8's bound answer the capture.
5. **2026-11-10, the architect, from the critic's second round on revision 2.** Adopted: a linked worktree takes its owning checkout's project, so §8 starts its walk at the main checkout (revision 2 measured its bound from a root the worktree is not under); a folder is minted only when §8 would leave it in the machine's project (a subfolder made a row by use would have split from its parent); a `.smns` shadows a minted id and does not erase it; a row's layout key is assigned once per device and a set moves whole (`rekeySets` moves address keys only); a clone is never linked unasked (revision 2's automatic link by a reported remote is a suggestion); sminos leaves a project only on lasting absence from complete directories; the held removal is bound, shown and cancellable; `nameRev` is taken from the records. Reverted: revision 2's refusal to link a folder holding a `.smns`, which narrowed the owner's "any folders"; a link wins at its own folder, as revision 1 had it.
6. **2026-11-10, the architect, from the desk track's reading of revision 3.** In §8 a statement that decides for a main checkout's own folder decides for its worktrees before a `.smns` in the worktree: revision 3 both started a worktree's walk at the main checkout and kept sminos's first read of the worktree's own `.smns`, and the two disagreed for a linked main checkout, whose worktrees each carry the committed file. The reversal of Decision Log 5 breaks nothing else in sminos: a linked clone's sessions move once, the project it shadowed keeps its log and is followed, and `project init` in a linked folder will say that the link shadows the file it writes.
7. **2026-11-10, the architect, from the critic's third round on revision 3.** Adopted: at one folder a minted id is above the file, so stored statements beat files uniformly and no git operation moves a session (revision 3's order moved a session twice when a `.smns` came and went, against acceptance 11); a link sits beside the minted id; a removed row's statement counts on neither side; minting happens only at a declaring act; `relocate` is refused onto a row with a statement of its own; every statement change answers after the restate; a file under a stored statement neither names nor marks the project; a complete directory is defined over the machines the endpoint has held a record of; acceptance 10 compares with the row a session is filed under. The critic's first finding was the one Decision Log 6 had answered. It named nothing for the owner.
8. **2026-11-10, the architect, from the critic's fourth round on revision 5.** Adopted: a stored statement is bound to the folder it was made on, by device, inode and birth time, and a different folder at its path reads "replaced" and counts on neither side (with statements above files since Decision Log 7, an unrelated repository cloned at an old path would have been in the old project silently, and the remote suggestion would have offered its real clones the stale project). The critic's remaining items are notes for the spec (§17), and it named nothing for the owner. The debate ends here: four rounds, each narrower than the last.
9. **2026-11-10, the owner.** Approved, as presented at revision 6 with its six points marked for the owner's care (a stored statement beats the folder's files; a link is about one folder on one machine; declared paths are readable by the hub and every member's device; Remove from sidebar removes for every Mac; what the upgrade does; the two readings of §12). The build: the execution spec is written now, the desk track starts its half at once, and the app-side changes reach master only after O15 has fixed the build P5 is verified on.
10. **2026-11-10, the architect, at the writing of the execution document.** Refinements of statements above, each with its reason in that document ("Decisions made in writing this document" and its Decision Log): `addFolder` takes `own` for a project of its own inside another project's folder; a link into a project that is no hub project is refused, and a link to the id a folder's own `.smns` names is allowed though no record names it; sminos acknowledges the locations it kept, which is what "after the restate" in §3 waits for; the org frame says whether its directory is complete, the carrier of §8's leaving rule, whose period is 24 hours of time counted while connected under a complete directory that lacks the project; the org frame's locations carry `hub: false`, and sminos registers a declared project with the hub only where it is eligible; the record's revision follows the listing's rule (the later of one past the last and the clock's milliseconds) with a floor taken from the machine's own record at the hub; a rebuilt index is told from an upgraded one by an id kept in the database, and the kept file holds the statements whole; `WIRE_MINOR` is bumped by two milestones and is one step for the machines; a stored statement's birth time is compared where both sides have one, within a microsecond, since the two runtimes read it at different precision, and sminos on Linux has none without `statx`; and a project that is only `known` on some machine has no row of its own, by the owner's second answer. Of §16's unknowns: the whole-set move and the key's store, the home directory's row (not declared on the owner's MacBook today) and the terminal's way to the app (the client port) are settled there; the order of rows with no folder here and the time to a row are settled at the live check; the comparison of folders in sminos stays the desk track's choice.
