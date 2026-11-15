# UX wave · U6, a landing of its own (U6f): a file from outside the session's folders on another machine, and Open File… there

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*), a landing of its own (**U6f**). **Parent pin:** master `30e09139acbb18231acdeeb5904a86d6e7b444fd`, the commit every statement about the code below was checked against; the root and the child's file are read at that commit. **The two builds a peer can be:** `2c7044231` (every machine runs it) and `f1852de3a` (build F, kept as the build to go back to); wherever this document says "an older build" it means each of the two, and a claim about one is made about both.
>
> **The design** is the owner's two answers of 2026-11-15 ("The owner's answers") and the eight conditions of the session that keeps master ("The conditions"), over U6e (`docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md`, cited below as *U6e*): the same thing on this Mac. The child's file does not hold this landing; where it or U6e says "never for a caller from another machine", the owner's newer answer and the conditions hold, and "The pull request" lists the sentences that follow. This document carries the constraints, the decisions the answers and the conditions leave to the design, the cards for the owner, the milestones and the interfaces.
>
> **Branch:** `ux-wave/U6f`, at `49f1676cd`: master at the pin plus the documents of the landings this one stands on. **Board:** ticket 677. **Stands on, none of it built at authoring:** U6e (final; its M1 and M2 are in build) and the first landing of U6b (`docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md`, cited below as *U6b-1*, in build). Every milestone here is built on a master that holds both; "Statements to check again once U6e and U6b-1 are on master" lists what to read again then. It also follows U9's recipe for an act offered later (`docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md`, Interfaces §2, cited below as *U9 §2*).

## Purpose

A session can run on another machine: a second Mac, a Linux host. From this Mac its chat, its files inside its folders, its terminal and its source control already work over the machine link. A file outside its folders does not: a link to one in the conversation is refused, a file the agent sent from outside opens but cannot be saved, and File ▸ Open File… (U6e's command) is unavailable with such a chat in front, because the system's file chooser shows this Mac's files and the session's files are on the other machine.

After this landing both work there as U6e makes them work here. A file from outside the session's folders on the other machine opens when that machine's own evidence admits it (the session's transcript there names it, the session's agent sent it, or the person chose it), is editable, and is saved on that machine only when the person presses Save, under the same write rule. Open File… with such a chat in front shows a chooser MAWS draws of that machine's folders and files; the file picked opens beside the chat. Both are limited to a person who may already open a terminal on that machine: the right is checked on that machine, for every request, by the same decision that admits a terminal. For anyone else, and for a machine that runs an older build, the item is unavailable and says why, and what such a person can see of that machine does not change.

How to see it working: on this Mac open the chat of a session that runs on a second machine, whose transcript links a text file outside its folders there. Click the link: the file opens beside the chat with the bar "Outside this session's folders". Type a word and press ⌘S: the file on the second machine holds the word, and that machine's daemon log has one line naming who wrote it and when. Press ⌘O: a sheet lists the second machine's home folder; walk to a file and open it; edit and save it; quit and relaunch: the tab is there and saves again.

## Progress

- [x] (2026-11-15) Document written against master `30e09139a`: the machine link's path for a call and for an act, the offer table, the authorization, the services' ledger, the files service and the device's adapter read at that head; U6e's and U6b-1's documents read in this worktree; the owner's two answers and the eight conditions folded in (Decision Log 1 to 4).
- [ ] The adversarial review of this document, and the architect's rulings on "Points for the architect's ruling" and on the cards.
- [ ] U6e and U6b-1 on master (a stop before M1: Concrete Steps 1), and the owner's answers on the cards, or the word to build the defaults.
- [ ] M1 — The other machine's daemon: the claimed caller, the read, the listing, the choice, the save, the log.
- [ ] M2 — The endpoint and the link's vocabulary: the four rows, the capability, what the ledger keeps, the two older builds' tables.
- [ ] M3 — This Mac's main: the adapter for the outside acts, the guard's names, the words, the standing.
- [ ] M4 — The window: reading and saving there, the chooser, Open File… for a session on another machine.
- [ ] M5 — The scenes, the two older builds, the record, and the acceptance run.
- [ ] The proof an executor does not run: the two-machine scenes and their groups on a Mac, the runs with each of the two older builds, the macOS unit files, class 1a, the branch's review, the owner's look at the chooser, the pull request.

## Words used here

U6e's words hold as it defines them: **the folders** (a session's roots), **outside**, **the daemon** (`mawsd`), **main**, **the page**, **named by a counted form**, **a grant**, **chosen**, **sent**, **added**, **the real path**, **the pin**, **MAWS's own folders**. New here:

- **The other machine**: the machine a session runs on when that is not this Mac, reached over a machine link. **This Mac**, or **the device**: the Mac whose app window the person looks at.
- **The machine link**: the sealed channel (RL2) between this Mac's main and the other machine's endpoint, direct or relayed by the hub, which sees sealed frames only (`apps/org-protocol/src/channel.ts`). A machine reached this way is "over RL2" (`isOverRl2`, `src/renderer/src/lane-b/remote-session.ts`). Another profile of this Mac, reached over a socket, is not one, and nothing here changes for it.
- **The endpoint**: the part of the other machine's `mawsd` that answers a machine link (`src/endpoint/`). **The offer table** (`OFFERS`, `src/endpoint/offers.ts`) lists every name that crosses; a name with no row is refused `not-offered`. A **row** says whether the name is a `call` (a read) or an `act`, who runs it, and where its target is read.
- **The grading function**: `Authorizer.authorize` (`src/endpoint/authorize.ts`), the one function that decides every request of a link, in eight steps: the row, the grade, the device's class, the caller's standing, the effect, the machine's policy, the class's words, presence. **A grade** is what a command asks of its caller: a rank on a session (`list` to `manage`) or a right on the machine (`spawn`, `shell`, `machine-admin`).
- **The terminal's row**: the row of `pty.spawn` in the offer table, with the grade the registry declares for `pty.spawn` (`src/shared/ipc/grades/pty.ts`; today `shell`, a right on the machine held by its owners and by a member a grant names). **At the terminal's grade**: a caller the grading function admits on that row. **Below it**: everyone else.
- **A step-up**: the device's signature of one act after the person confirms it with Touch ID or the login password (`src/main/device/step-up.ts`). The grading function asks one for a `shell` act of a member who is not one of the machine's owners, and none of an owner.
- **A claimed act**: an act the endpoint admitted and handed to the machine's services through `machine.op` (`src/services/machine-ops.ts`), which writes a claim (the member, the device, the operation's id) into the services' ledger before the command runs and hands the claim to the command's handler as `HandlerContext.op` (`src/shared/ipc/client.ts`). A handler sees `remote: true` for every request the endpoint dispatched, and `op` only for a claimed act.
- **The ledger**: `<profile>/spine-ops.jsonl` on the other machine (`src/shared/host/op-ledger.ts`), one record per operation id, so that an act runs once and a lost answer is asked again by its id.
- **A capability**: a word an endpoint lists in its handshake once it serves an addition (`src/endpoint/capabilities.ts`); the device sends the addition to no endpoint that does not list it (`REMOTE_NEEDS`, `src/shared/ipc/remote-unavailable.ts`).
- **The standing**: what the page knows of a session's machine when it draws a control (`RemoteStanding`): its name, the link's phase, the capabilities listed, whether the person is an owner, and, new here, the person's rights there. It decides how a control is drawn and never what the machine allows.
- **The chooser**: the sheet MAWS draws for Open File… when the files are on another machine. The system's chooser, which U6e uses on this Mac, cannot show them.
- **A private folder**: a folder macOS protects by its privacy settings (Desktop, Documents, Downloads and the like; `src/shared/machine/home-folders.ts`). Reading inside one may raise a privacy prompt on the machine that reads.

## The landing's edge

**In.** For a session MAWS runs on a machine reached over RL2, whose endpoint lists the capability, for a person at the terminal's grade there:

- A file outside the session's folders there opens beside the chat when that machine's daemon admits it by U6e's evidence, is editable and is saved by `files.writeOutside`, under U6e's write rule as "The write rule on another machine" restates it.
- Open File… (the menu's item, ⌘O and the Files list's row): the chooser, the pick recorded as a grant by that machine's daemon, the chosen file opened beside the chat as a kept tab, which a relaunch keeps.
- MAWS's own folders on that machine are read-only as on this Mac; the real path is compared at the save there.
- One line per save and per choice in that machine's daemon log.
- "Open externally" on such a file opens a copy on this Mac, as it does for a file inside the folders.

**In, for everyone else.** The item is unavailable with one sentence that names the reason (below the terminal's grade; the machine runs an older build; the machine is offline or its link is coming up), and a link to a file outside the folders opens a tab that shows that sentence and nothing of the file. A file the agent delivered from outside the folders, which a remote viewer can read today, opens read-only with a sentence in place of a tab that takes typing and fails at Save (decision 9).

**Not in, and unchanged.** What a caller below the terminal's grade can read: P5's Decision Log 237 stands for them to the byte (condition (c)). `files.read`, `files.list`, `files.watch`, `files.write` and every git and source-control read over a link. The Files list of a chat rooted at the other machine's home, which stays empty for every caller from another machine (point 6). A session of another profile of this Mac, reached over a socket, and a terminal session on another machine: Open File… keeps U6e's sentence for them and nothing outside their folders opens (point 7). Which files open by a link (U6b-4), other kinds drawn in the tab (U6b-2), creating, renaming or deleting a file, a listing or a watch of a folder outside the folders beyond the chooser's own listing.

## The owner's answers

Received 2026-11-15T01:28Z, through the architect; recorded verbatim, question and answer (Decision Log 1).

**Question.** "On this Mac, a file from outside a session's folders will open and be editable (the landing now in work). For a session that runs on another machine, such as a second Mac, a link to a file outside that session's folders is refused today, and nothing outside its folders is edited there. What should happen on another machine?"
**Answer.** "Open and edit there too (Recommended)"

**Question.** "The new command Open File… (⌘O) shows a file chooser and opens the picked file beside the chat. When the chat in front belongs to a session that runs on another machine, what should Open File… do?"
**Answer.** "Pick a file on that machine (Recommended)"

The cards said: this comes as a landing after the one for this Mac; it is limited to a person who may already open a terminal on that machine; until it lands the menu item is unavailable for such a chat and says the session runs on another machine.

## The conditions

The session that keeps master set eight conditions (its message of 2026-11-15 UTC; Decision Log 2). They bind, and they change a rule of 2026-11-06, P5's Decision Log 237 ("a remote caller never reaches a machine's home through a session rooted at it"; the files service narrows every remote request to the session's roots less the home). Each has a place that meets it and a test that tries to break it.

| | the condition | the place that meets it | the test that tries to break it | milestone |
|---|---|---|---|---|
| (a) | Reading and writing outside a session's folders over a machine link take exactly `pty.spawn`'s offer row (an act, its target the machine), checked by the same grading function, not by a copy of its outcome; if that row's grade changes later, this follows by construction | `asTerminal` in `src/endpoint/offers.ts`: each of the four rows is `pty.spawn`'s row with the services as its executor; `src/shared/ipc/grades/files.ts` declares each name's grade as the value `pty.spawn`'s declaration holds; the grading function is not edited (decision 1) | **The differential.** For each of the four names and each caller of a table (an owner; a member with a `shell` grant, with and without a step-up; a member with a `spawn` grant only; a member with `view` on the session and no right; a web-cards device; a device the head removed; the machine read-only; a head too old), `authorize` of the act answers what `authorize` of a `pty.spawn` act from the same caller answers, word for word. **The follow.** With `pty.spawn`'s grade moved to `machine-admin` through the authorizer's `gradeOf` seam and, apart, its row marked `owners`, a caller who passed is refused on all five names alike. **No copy.** A text guard: the modules this landing adds (`src/shared/files/outside.ts`, `src/main/lane-b/remote-outside-files.ts`, `tools/code/files/elsewhere.ts`), the four rows and the four grade lines hold the word `shell` nowhere; the device's pre-check and the page's drawing read `gradeOf('pty.spawn')` | M2 |
| (b) | Admission: that machine's daemon alone reads the evidence, by U6e's five-line rule. Nothing the calling device sends counts as evidence, and the grant lives on that machine | `precheck` in `src/services/files/service.ts`, run by the other machine's daemon over its own transcript, its own grants file and its own Library index; the inputs are held to strict schemas at the endpoint's step 2 and again by `machine.op` | Through the service with a claimed remote caller over real files: a path with no evidence, one admitted only for another session, and one only an added record admits are refused with the bytes read back; an input that carries any key beyond the schema's is `malformed` at the endpoint and never reaches the service; a `files.grant` act is `not-offered`, and a `files.grant` dispatched with a remote context is refused with the grants untouched; after a choice the grants file on that machine holds the real path and the asking device holds nothing | M1, M2 |
| (c) | P5's Decision Log 237 stays as it is for every caller below that grade: a remote viewer without the terminal grade still sees no files of a chat rooted at the machine's home, and a test holds that | The outside rule is reached, for a remote request, only under a claimed act of one of the four names (`register.ts`); `files.read`, `files.list`, `files.watch` and `files.write` take the roots less the home as today | For a session rooted at a home, a remote caller with no claim: `files.list` of the roots and of the home, `files.read` of a file in it with and without `named`, `files.watch` and `files.write` each answer what the pin's cases of the home-root rule expect, the transcript's, the grants' and the Library's spies untouched, and a claim changes none of those answers; a remote request to one of the four handlers that carries no claim is refused before anything is read; at the endpoint a member with `view` and no right is refused `grade` on the four acts and `act-required` on a call of them | M1, M2 |
| (d) | The chooser: the same grade. It may list files and folders anywhere the daemon's user can read. The pick is recorded as a grant by that machine's daemon, not by the caller | `files.listOutside` and `files.chooseOutside`, two more rows made by `asTerminal`; `chooseOutside` runs U6e's `grant` in the daemon, which resolves the path itself and writes its own grants file | A listing outside the home and of the filesystem's root answers; the same from a caller with no claim, and from this machine's own client, is refused; a choice of a directory, a package and a special file is refused `not-a-file` with no grant; a choice records the target's real path for a link; the caller's input holds no key that could name a grant's content | M1, M2 |
| (e) | The refusal of MAWS's own profile folder and app bundles and the real-path pin apply on that machine as in U6e | `own()` and the comparison of `input.real` in `writeOutside`, U6e's code, reached by the claimed caller with nothing skipped | With a claimed remote caller: a file under the profile, under the daemon's bundle and under a told bundle reads `own: true` and is refused by `files.writeOutside`; a folder on the path swapped for a link between the read and the save answers `FILES_MOVED`; both with the bytes read back | M1 |
| (f) | Each remote write outside the folders is logged in that machine's own daemon log with the member and the time; the path stays out of the hub | `outsideLog` in the files service, written through the spine's `[files]` log into `<profile>/mawsd/mawsd.log`, which stamps each line with the time (decision 10) | Each ending of a claimed `files.writeOutside` (written, conflict, refused) writes exactly one line that holds the claim's member, device and operation id; a local save writes none. Over the relay carrier with the hub's fake recording every byte it carries and every HTTP call it receives: the path and the content appear in none of them | M1, M2 |
| (g) | New offer rows for the remote open, list and save, so that an older endpoint (`f1852de3a`, `2c7044231`) leaves the items unavailable and never mis-answers | The four names and the capability `rl2.outside-files`; the device sends none of them to an endpoint that does not list it (`REMOTE_NEEDS`) | With the committed tables of each of the two builds (`test/cross-build/peers/`): none of the four names has a row and the capability is not listed, so the authorizer over that table answers each `not-offered`; the device's adapter sends such a peer nothing (the link's fake records no act) and answers the sentence; the scene with that build as the other machine | M2, M3, M5 |
| (h) | Review of the build: reviewer-high with an authorization lens, or the panel if the change passes about twenty files | Decision Log 4: the change passes twenty files, so the panel, with the authorization lens first | — | the architect |

## The write rule on another machine

U6e's five lines hold on the other machine, read by its daemon. What each becomes when the page and the daemon are on two machines:

1. **Evidence.** The other machine's daemon writes a file outside a session's folders only when it holds, itself, evidence that admits the file for that session: its transcript names the path by a counted form, the person chose the file, or the session's agent sent it. A `user` row's text counts only when the person wrote it; a peer session's message and a notification row admit nothing, as a tool's result admits nothing (the architect's ruling after U6e's last revision; Decision Log 3). The choice is the one piece of evidence that begins on the device: it is an act of its own at the terminal's grade, and the daemon makes the record (condition (d)).
2. **The sender.** Two checks in a row. On this Mac, U6e's guard in the router lets the four names through only for a live page of an app window, before anything is forwarded to the link. On the other machine, the endpoint admits the act only on the terminal's row, for the member and the device the channel proved, and the services run it only as a claimed act.
3. **The real path.** The save names the real path the file had on the other machine when it was shown, and that machine's daemon refuses it when the path no longer resolves there. The read and the save are two operations, and the link may drop between them: nothing is held open across them, and the save alone carries what it must hold to (the pin and the hash).
4. **The content.** The save carries the hash of the content the person was shown; other content on that machine's disk answers `conflict`. The save is one operation id: the ledger there runs it once, and a lost answer is asked again by that id ("The sequences that must hold", R5).
5. **Never.** For a caller below the terminal's grade; for a remote request that is no claimed act; a file in one of MAWS's own folders on that machine; through `files.write`; a file only an added record or only a tool's result admits; a create, a rename, a watch or a reveal outside the folders.

**What it does not stop, beyond U6e's list.** A fault in the app window's own page code, for a person at the terminal's grade on a machine: it can list that machine's folders, choose a file and then read and save it with no press. The same page can already open a terminal there, since `pty.spawn` is a command of the page, so no reach is added: this is the reason the conditions take the terminal's row (condition (a)). For a member who is not an owner, each such act stops at the step-up sheet, which shows the act's own fields and is answered by the person.

## What the code holds today

Read at master `30e09139a`. What U6e adds is cited from its document and is in "Statements to check again".

1. **How a request crosses a link.** A `call` is a read: the grading function refuses one for a row that is an act (`act-required`) and one whose grade is above `view`. An `act` is sealed by the device, checked for freshness, decided by `Authorizer.authorize`, and handed to its executor; for the executor `machine` that is `machine.op`, which runs only a `machine`-owned command whose grade is neither `list`, `view`, `client` nor `internal` (`claimable`, `src/services/machine-ops.ts`), validates the input again, writes the claim, runs the command with the claim in its context, keeps its answer and returns it (`src/endpoint/actions.ts`).
2. **`pty.spawn`'s row** is the constant `pty` in `offers.ts`: `{ kind: 'act', executor: 'pty-host', target: 'machine' }`, with no grade of its own, so its grade is the registry's: `'pty.spawn': 'shell'` (`src/shared/ipc/grades/pty.ts`). The grading function reads of a row: `kind`, `target`, `grade`, `accepts`, `owners`, `sminos`, `stream`, and `executor` only to choose how a session is placed, which a `machine` target does not ask. Its name-keyed rules (the web-cards list, forks, the setup's directories, the record acts' step-up) name neither `pty.spawn` nor any `files.` command. Step 6 refuses everything graded above `view` on a machine in read-only mode; step 8 asks a step-up for `shell` of a member who does not own the machine (`stepUpRequired`, `src/endpoint/step-up.ts`).
3. **The files commands a link carries today.** `files.list`, `files.read`, `files.watch`, `files.unwatch` as calls at `view` on the session; `files.write` and `files.upload` as `machine` acts at `manage`. Each reaches the files service with `remote: true`, read from the handler's context in `src/services/files/register.ts`, never from the input; `rootsOf(record, homes())` then leaves out the machine's home and anything above it (the rule of P5's Decision Log 237). A file a delivered record admits is read from outside the roots for a remote caller too (`admitted`, with no test of `remote`), unmarked.
4. **What the ledger keeps.** The claim, with the sealed action beside it unless the name is in `KEPT_WITHOUT_ACTION` (`files.upload`, a draft's save: `actions.ts`), and the command's whole answer, in memory and in the file, until the ledger is next opened more than a day after the claim (`KEPT_S`, compaction at open only). A known operation id met again answers what is kept and runs nothing. No act of today answers a file's bytes: the terminal's bytes ride a stream, and every bulk read is a call.
5. **The channel's bound.** One message is at most 4 MiB (`MESSAGE_MAX_BYTES`). A call's answer past it is refused `too-large` and the device reads it again in pages (`readInPages`, `src/main/lane-b/remote-files-read.ts`); an act's answer has no such refusal.
6. **The device's side.** The router forwards a command for an RL2 machine to main's adapter (`createRemoteLaneB`, `src/main/lane-b/remote.ts`): a name in `MACHINE_ACTS` goes as a `machine` act placed by its arguments (`machineAct`), answered at its outcome or, at the pending bound, with "<machine> took the request but hasn't confirmed it" while the link goes on asking by the operation's id; an act never put on a channel waits under the link's hold and then answers "Not sent: <machine> is offline". Step-up is asked only when the endpoint refuses for it (`if-asked`). A name in `REMOTE_NEEDS` is sent only to a peer that lists its capability, judged at each transmission (`requires`).
7. **What the page knows of the machine.** `MachineState` carries `capabilities`, `owner` and `rights` (the person's machine rights there, from the link's `caps`) to the page (`src/shared/ipc/schema/machines.ts`); `RemoteStanding` reads the first two (`src/renderer/src/lane-b/remote-standing.ts`). `disabledWords` and `refusalWords` (`src/shared/ipc/remote-unavailable.ts`) word a disabled control and an act that ended without its effect (root UC-7).
8. **The page's file requests for a session on another machine.** The viewer reads with `named` only for a session on this Mac (`readChunk`, `tools/code/viewer/viewer-store.ts`); "Open externally" opens a copy main pages here (`remote.openCopy`, `src/renderer/src/lane-b/open-copy.ts`, `src/main/lane-b/remote-artifacts.ts`). `test/lane-b/renderer-guards.test.ts` holds every command the page issues for a session to the helper of UC-7 or to a named guard, and names the viewer's `named` read as "issued only when the session is this Mac's".
9. **A folder browser of another machine exists.** New chat's and Add project's Browse… lists a machine's folders a page at a time from its home (`machine.folders.list`, the owners' call at `list`; `FolderBrowser` in `src/renderer/src/sidebar/FolderField.tsx`): folders only, names only, no link listed, a private folder entered only after the person confirms, since reading inside one may raise a privacy prompt on that machine and nobody may be sitting there (`src/shared/machine/home-folders.ts`, `src/services/machine/folders.ts`).
10. **The step-up sheet's words.** The summary is a sentence per action, "Use a terminal on <machine>" for every `pty.` act, and `<action> on <machine>` for a name with none (`sentenceOf`, `src/main/device/step-up.ts`); the detail lists every signed field.
11. **A web client.** The desk's web app reaches a machine as a `web-cards` device, which the grading function's step 3 holds to four names (`WEB_CARDS`); its session tail draws transcript rows and asks no `files.` command.
12. **A terminal session on another machine** is reached by lane A's adapter, which takes only `laneA.*` (`src/main/lane-a/remote.ts`); the files service places a request by a session's record, which such a session has none of under its bare id. Its files are not read over a link today.
13. **The two-machine rig.** `e2e/remote.spec.ts` (group `e2e:remote`) runs machine B as a private `mawsd` enrolled in a local org and machine A as the app under test (`e2e/support/remote-scene.ts`); the scene's org has one member, who owns B, so no act there asks a step-up. An endpoint of an earlier build is staged by withholding a capability (`MAWS_E2E_ENDPOINT_WITHOUT`, read under `MAWS_E2E=1` alone: `src/endpoint/endpoint.ts`). B's daemon is started from this checkout's build (`startProfileDaemon`, `e2e/support/profile-daemon.ts`); `e2e/cross-build.spec.ts` stages no second machine.
14. **The two older builds.** Neither knows `files.writeOutside`, a grant, or any name of this landing; `2c7044231`'s `files.read` schema knows `named`, `f1852de3a`'s does not, and an endpoint holds an input to its schema strictly (an unknown key is `malformed`). `2c7044231` lists the capabilities up to `rl2.session-acts` (RL2 minor 14, the wire's minor 46, both the pin's); `f1852de3a` lists them up to `rl2.channel` (RL2 minor 12, the wire's minor 33). Neither has a row for any `files.` name beyond the pin's.

## Decisions settled at authoring

Each names what it beat. The numbers are cited as "decision N". The exact shapes are in Interfaces and Dependencies.

1. **The four rows are `pty.spawn`'s row by derivation, and the grading function is not edited.** `asTerminal()` answers the object `pty.spawn` holds with one member replaced: the executor, `machine`, since the files service runs in the machine's services and not in the pty host. The registry declares the grade of each of the four names as the value `pty.spawn`'s own declaration holds, by reference. So every member the grading function reads is `pty.spawn`'s, a change of that row or of that grade moves the four with it, and step-up, the read-only policy, the device's class and a removed device follow with no line of their own. The differential test of condition (a) holds the names to `pty.spawn` across every refusal the function can give, so a rule keyed on one name later fails it. *Beat:* a field on the row that the authorizer resolves to another row (`as: 'pty.spawn'`): it edits the one function every request of every link passes, for what a derived constant gives. *Beat:* declaring `shell` for the four names: a copy, which a later change of the terminal's grade would leave behind. *Beat:* remembering on the machine that a member held the right (a ticket minted by one graded act and honoured by later calls): a copy of the outcome, which a withdrawn grant would outlive.
2. **Four acts, one per thing done.** `files.readOutside` (the open: a read of one file by the outside rule), `files.listOutside` (one page of one folder, for the chooser), `files.chooseOutside` (the pick: the daemon grants one file) and U6e's `files.writeOutside` (the save), which gains its row. Each is a `machine` act on the terminal's row, addressed by the session it is for. *Beat:* three rows with the pick folded into the read as a flag: a read that leaves a lasting grant behind hides the one act that begins evidence on the device, which wants its own log line and its own guard. *Beat:* giving `files.read` a grade that follows its input: its row is a call at `view` on the session, and the grading function refuses a call above `view`; the terminal's row is an act on the machine.
3. **The outside rule is reached, for a remote request, only under a claim.** `register.ts` hands the service who asks: this machine's own client; a remote caller with no claim; or a remote caller with the claim `machine.op` made (`HandlerContext.op`). Only the handlers of the four names pass a claim on. `precheck`'s step 3 ("may the outside rule admit?") says yes for a remote request only when it carries one; `files.read`, `files.list`, `files.watch` and `files.write` never do, so they are today's for every remote caller, the terminal's grade included. The roots of a remote request stay the roots less the home in every case (point 6). The check sits where the act runs and reads the context of the very request it runs, not a key of its input and not a flag set where the request entered. *Beat:* the services asking the endpoint again for the member's right: a second decision beside the grading function, on less than it reads (no policy, no presence, no device).
4. **A read crosses in small pages, and its answer is not kept by the ledger.** A file's bytes as an act's answer would be kept by the ledger in memory and on disk until a restart ("What the code holds today" 4), and an act's answer has no `too-large` refusal. So the device asks `files.readOutside` in pages of at most `REMOTE_OUTSIDE_PAGE_BYTES` (256 KiB, which fits a message at the worst escaping), each with the hash when the read asked for it, assembled and checked as `readInPages` does; and `machine.op` keeps, for the names in `ANSWER_NOT_KEPT` (`files.readOutside`, `files.listOutside`), that the operation ended and not what it answered: a copy of the same operation met again answers `NOT_KEPT`, and the device asks afresh, once, under a new id. A read is safe to run twice. The save's sealed action, which holds the file's text, joins `KEPT_WITHOUT_ACTION`; its small answer is kept, so a save still runs once. *Beat:* leaving the answers in the ledger: every outside file a person reads from afar would stay in the daemon's memory and in a file of the profile for a day or more. *Beat:* a stream opened under one graded act, as the terminal's bytes ride: a new stream kind in RL2's vocabulary and in both ends, for files of a few kilobytes.
5. **The device asks the plain read first.** For a session over RL2 the page's read carries `named` (and `agent` where U6e's mark holds). Main's adapter then: (i) to an endpoint that does not list the capability, sends today's `files.read` with both keys taken off, and answers what comes; (ii) otherwise sends `files.read` as the call it is, with `named`; an answer for a file inside the folders is returned as it is; (iii) on the service's refusal sentence, or on an answer marked `added` (decision 9), sends `files.readOutside`, unless the link's `caps` say the person lacks the terminal's grade; its answer is the read's; (iv) where `caps` say so, answers the refusal with UC-7's sentence and sends no act (rights not yet known send the act: the machine decides). A file inside the folders therefore costs one call, as today, and no confirmation; only a file outside them costs an act. *Beat:* the act first for every read: every file of every session there would pass the ledger, and a member who is not an owner would confirm each. *Beat:* the page choosing between the two commands: the choice needs the link's state at the moment of sending, which main holds.
6. **Reads, listings and the choice do not wait for a link; the save does, as today's.** With no channel current the adapter answers a read, a listing and a choice at once as a call is answered ("<machine> is not reachable"), and sends each on one channel only (`oneChannel`). The save goes as `files.write` goes: held under the link's hold, answered at its outcome or at the pending bound. *Beat:* holding a read under the link's hold: a tab shown again while the machine is away would wait for seconds and then fail.
7. **The pick is a claimed act, and the chooser is the page's.** `files.chooseOutside { appSessionId, path }` runs U6e's `grant` in the other machine's daemon, which resolves the path itself, grants only a regular file and records the real path in its own grants file with its own clock; the answer is the real path, which the tab opens. `files.grant` stays main-only and is offered to no link. U6e's router guard gains the three new names, so only a live page of an app window sends them. The page draws the chooser, because main has no surface of its own and the system's panel shows this Mac. So `layout.openFile` is still refused for a session of another machine, as U6e builds it: of the two places U6e names for this landing, `remote` in `precheck` changes, and the second is `connectOpenFile`'s registration with a handler of the page's own, not the router's refusal (point 4). *Beat:* main keeping the chooser's listing and taking the pick as an index into it: the page steers the listing, so an index binds nothing a path does not.
8. **The listing touches no private folder unasked, and stats nothing.** `files.listOutside` resolves its path one component at a time and answers `protected` before it touches anything inside a private folder the request did not open (`open: true`, which the page sends only after the person confirmed that folder); it reads a folder's entries by their directory entry types alone, so a folder of thousands of names on a slow disk costs one `readdir`; it answers one page of `OUTSIDE_LIST_PAGE` (200) entries, folders first, names that begin with a dot after the rest, and a link as a link, never followed. It lists anywhere the daemon's user can read (condition (d)); a folder it cannot read answers `unreadable`. It answers only a claimed remote caller: this Mac's own chooser is the system's, and a page gains no way to list this Mac's folders. *Beat:* extending `machine.folders.list`: it is the owners' call at `list`, bound to the home, folders only. *Beat:* a size and a date per entry: a `stat` per name, slow over a network disk, and a read inside a folder the person only looked at.
9. **A delivered file, for a caller below the grade, is marked and read-only.** Today a remote viewer reads a file the agent delivered from outside the folders, the tab takes typing, and Save fails. A remote `files.read` that carries `named` and no claim is answered exactly what it is answered today, and where a delivered record admitted a file from outside the roots the answer carries `named` and `outside: { real, writable: false, why: 'added' }`. Nothing else is asked for it: no grant, no transcript, no maker. The page holds it read-only with a sentence. For a caller at the terminal's grade the adapter follows with the act (decision 5), which tells a sent file (writable) from an added one. Condition (c) holds: the bytes are the ones answered today, and one mark is added to them. *Beat:* leaving it: "open and edit there too" would look true and fail at Save for exactly the files a chat in a home folder delivers.
10. **The log line.** One line per ending of a claimed `files.writeOutside` and of a claimed `files.chooseOutside`, written by the files service through the spine's `[files]` log into the other machine's `<profile>/mawsd/mawsd.log`, which stamps each line with the time in UTC and keeps one earlier generation: `outside write: member <member> device <device> session <id> op <opId>: ok <bytes> bytes <real path>`, or `: conflict <real path>`, or `: refused (<word>) <path as asked>`; `outside choice: member … op <opId>: granted <real path>` or `: refused (<word>) <path as asked>`. The member and the device are the claim's, which the endpoint proved, never a value of the input. The file's text is never logged. The line holds the path because the record is of what was written, and the file is the machine's own, mode 0600 in a 0700 folder; nothing sends that log, the path or the claim to the hub (the act crosses as sealed frames, and no listing, notice or status carries it). A read and a listing write no line. *Beat:* a file of its own for these lines: the condition names the daemon log, and a second file is a second thing to rotate and to find.
11. **What the page asks, and for whom.** For a session MAWS runs on a machine over RL2: every read carries `named`; an entry with a pin saves by `files.writeOutside`, and never by `files.write`, as on this Mac. For a session of another profile of this Mac and for a terminal session on another machine: today's requests to the byte. So U6e's pin "a session on another machine: the read carries no `named` and the save is `files.write`" narrows to those two kinds.
12. **Where it is offered, and what it says where it is not.** One helper, UC-7's, asked about `files.chooseOutside` for Open File… and about `files.writeOutside` for a file's title. The sentences, in order, the first that applies:

    | the state | Open File… (the Files list's row; the menu's item is disabled) | a tab opened by a link outside the folders | an outside file that is open and cannot be saved |
    |---|---|---|---|
    | the machine's build does not list the capability | "Can't open a file on studio yet. Update MAWS on studio and try again." | "Not opened: update MAWS on studio and try again" | — (such a machine answers no mark) |
    | the person does not hold the terminal's right there | "Open File needs the right to use a terminal on studio." | "Not opened: you need the right to use a terminal on studio" | "Read-only: Saving this file needs the right to use a terminal on studio." |
    | the machine is offline | "Open File is unavailable while studio is offline." | the read's own failure, as for any file there | the document stands; Save answers "Not saved: studio is offline" |
    | the link connects or reconnects | "Connecting to studio…", "Reconnecting to studio…" | as the row above | as the row above |
    | the machine is in read-only mode | (enabled; the chooser says it) | "Not opened: studio is in read-only mode" | "Not saved: studio is in read-only mode" |
    | another profile of this Mac; a terminal session there | U6e's "Open File… (this session runs on studio)" | today's refusal | — |

    The right is read from the standing (`rights`), compared with `gradeOf('pty.spawn')`; unknown rights close nothing, and the machine decides every request again. The sentences are the output of `disabledWords` and `refusalWords` for the rows of §D (their apostrophes are typographic, as U9 writes them); where this table and those functions differ by a character, the functions' output stands. *Beat:* one sentence for every case ("this session runs on another machine"): the person could not tell an update from a right they lack.
13. **A confirmation is asked only on a press.** For a member at the terminal's grade who does not own the machine, the endpoint asks a step-up of each act, so each open, each folder of the chooser, each choice and each save shows the sheet. The page therefore makes no automatic read that would ask one: U6c's re-read when a tab is shown again (`revisit`) is skipped for an outside entry of a session over RL2 unless the standing says the person owns the machine; a click on the link, Open File… and Reload read. The sheet's summary reads "Open a file on studio", "List a folder on studio", "Choose a file on studio" and "Save a file on studio" (Card 4 puts the cost to the owner). *Beat:* reading on every show: a Touch ID sheet for switching tabs.
14. **An edited tab across a drop, a restart and an older build.** The document and its edits are the page's; no read replaces a document with unsaved edits (U6c's rule), so a drop of the link changes nothing on screen. Save while the machine is away answers "Not saved: studio is offline" with the edits kept, and works once the link is up: the pin and the hash are the entry's, and the other machine's daemon decides again at the save, on evidence it reads then. A restart of that daemon changes nothing: the grants are a file, the transcript is a file. That daemon replaced by an older build: its endpoint no longer lists the capability, so Save answers "Not saved: update MAWS on studio and try again", nothing is sent, and the page never sends `files.write` in its place (U6e's rule for a pin); a tab then shown again is read by today's `files.read`, whose refusal lands on the entry as U6e's W-sequences say.
15. **"Open externally" there opens a copy here**, through the same read: `remote.openCopy`'s read of a session's file takes the adapter's outside-aware read, so a chosen PDF on the other machine opens as a copy on this Mac. `files.openExternal` and `files.reveal` stay declared unavailable for another machine.
16. **Every other route that reads a file of a session on another machine is unchanged**, and none reaches the outside rule: `files.read`, `files.list` and `files.watch` as calls; `library.read` and an artifact page's request (`artifacts.fetch`), which read a file the Library's own record resolved, on the artifact's rank; the git and source-control reads under the checkout rule; a send's uploads, which the endpoint reads from the session's upload folder; a terminal session's rows, output and diff, which are its transcript's; and the desk's web app, a `web-cards` device, which the grading function holds to listings and answers. A test holds the last (`class` on each of the four names), and constraint 5 the first.
17. **The chooser, as built until the owner answers the cards** ("The cards", with the drawn example): a sheet over the window, one folder at a time, in the look of the folder browser the owner already uses for another machine (`FolderBrowser`), with files listed too. It starts in that machine's home; a path can be typed. This is the one named place a card changes: `tools/code/files/RemoteChooser.tsx` and its model.

## The cards

Not resolved here. Each is a question as it could be put to the owner, the options with what each means in use, a recommendation, and what is built until the answer (the conservative default, at one named place). The chooser is a new surface a person sees, so the owner should see the drawn example before M4 is built.

### Card 1 · What Open File… shows when the files are on another machine

*"Open File… with a chat of another machine in front cannot use the Mac's own file chooser, which only shows this Mac. What should MAWS show in its place?"*

- **A list of one folder at a time (Recommended; built).** A sheet over the window: the folder's path on top, which you can also type or paste; the folders and files in it as rows; a row for the folder above. Click a folder to enter it, a file to select it, then Open (or double-click the file). It looks like the folder list New chat already shows for another machine. On a slow connection each folder takes a moment, and the sheet says "Reading the folders…" while everything else in it stays usable.
- **A path only.** A small sheet with one field: type or paste the file's path on that machine, with completion as you type. Fastest when you know the path; nothing to browse when you do not.
- **Columns, like Finder.** Folders side by side as you walk down. Familiar, but each column is a request to the other machine, it needs a wide sheet, and it is the most to build and to keep working on a slow link.

Drawn, with invented names (the built default):

    ┌─ Open a file on studio ────────────────────────────────────────────┐
    │ ~/notes/plans                                              [ Go ]  │
    ├────────────────────────────────────────────────────────────────────┤
    │  ↑  ..                                                             │
    │  ▸  archive                                                        │
    │  ▸  drafts                                                         │
    │  ▸  Documents                                            private   │
    │     roadmap.md                                                     │
    │     todo.txt                                                       │
    │     latest → drafts/roadmap-2.md                            link   │
    │  ▸  .config                                                        │
    │     .env.example                                                   │
    │  More…                                                             │
    ├────────────────────────────────────────────────────────────────────┤
    │ Files on studio, read as its MAWS service can read them.           │
    │                                              [ Cancel ]  [ Open ]  │
    └────────────────────────────────────────────────────────────────────┘

A private folder asks first: "Open Documents on studio? macOS protects this folder, and opening it may show a privacy prompt on studio's own screen." with Back and Open. A folder that cannot be read says "MAWS on studio cannot read this folder." in the list's place, and ".." still works. While a folder is read: "Reading the folders…". A folder that does not answer: "studio has not answered yet." with Try again.

**Built until answered:** the first option. **The one place:** `tools/code/files/RemoteChooser.tsx` with `remote-chooser.ts`.

### Card 2 · Where the chooser starts

*"When Open File… opens for a chat on another machine, which folder should it show first?"*

- **That machine's home folder (Recommended; built).** The files inside the session's own folders are already in the Files list, so Open File… is for the rest, and the home is where the rest starts. During one run of the app it reopens where you last were on that machine.
- **The session's working folder.** Close to what the chat is about; one or two steps up to reach anything else.

**Built until answered:** the home, and the last folder shown per machine for the run (kept in memory, stored nowhere). **The one place:** `startOf` in `remote-chooser.ts`.

### Card 3 · Hidden files in the chooser

*"Files whose names begin with a dot (a shell profile, `.env`, `.gitconfig`) are hidden by the Mac's chooser until you press ⇧⌘. Should MAWS's chooser for another machine show them?"*

- **Shown, after the other names (Recommended; built).** A shell profile or a configuration file is exactly what you open on another machine, and there is no Finder habit to follow on a Linux host. They sit below the ordinary names, so a folder reads as usual.
- **Hidden until asked.** A "Show hidden files" switch in the sheet, off at first, as the Mac's chooser behaves.

**Built until answered:** shown after the rest. **The one place:** the order and the filter in `remote-chooser.ts` (the daemon lists every name).

### Card 4 · Someone who may use a terminal there but does not own the machine

*"A member you granted the right to use a terminal on a machine confirms each terminal with Touch ID. The same rule now covers files outside a session's folders there, and it asks once per act: once to open a file, once for each folder the chooser shows, once to save. Is that right for them?"*

- **Yes, each act confirmed (Recommended; built).** It is the terminal's own rule, so nothing new is decided about who may do what. It is slow in the chooser: several folders are several confirmations; typing the path is one. MAWS never asks for a confirmation by itself (switching tabs does not re-read such a file).
- **Owners only for now.** A member with a grant keeps today's behaviour (the item unavailable, with a sentence) until one confirmation can cover a whole sitting in the chooser, which is a design of its own on the machine link.

**Built until answered:** the first option; it is what the grading function does for the terminal's row, and the owner's card promised the terminal's population. **The one place:** nothing on the machine; in the page, `outsideUnavailable` in `tools/code/files/elsewhere.ts` would close the items for a member who is not an owner.

## Points for the architect's ruling

Each is something the code or the conditions leave open, or a place where this document reads a sentence of U6e or of a condition in one of two ways. The built default is stated, with the one place a ruling changes.

| # | the point | built by default | the one place a ruling changes |
|---|---|---|---|
| 1 | **"Exactly `pty.spawn`'s row"** cannot be the row whole: its executor is the pty host, and the files service runs in the machine's services. Every member the grading function reads is the same | The row derived with the executor replaced; the grade by reference; the grading function not edited (decision 1) | `asTerminal` in `src/endpoint/offers.ts` |
| 2 | **Four rows where condition (g) names three** (open, list, save): the pick is a row of its own | `files.chooseOutside` (decision 2) | `OFFERS` |
| 3 | **The ledger.** A claimed read would leave each file's bytes in the services' ledger, and a claimed save its text. `src/services/machine-ops.ts` and `src/endpoint/actions.ts` are the P5 work's | `ANSWER_NOT_KEPT` for the read and the listing; the save in `KEPT_WITHOUT_ACTION` (decision 4). Without either the landing still works, and the bytes stay in the ledger until a restart | the two sets |
| 4 | **U6e names "the router's refusal of `layout.openFile` for another machine" as a place this landing changes.** It does not change: the chooser for another machine is the page's, and main's command stays this Mac's | `connectOpenFile`'s registration, with the page's handler (decision 7) | `tools/code/files/open-chosen.ts` |
| 5 | **A member at the terminal's grade who is not an owner** confirms each act; the save's sheet lists the file's whole text among the signed fields, since the step-up module shows every field | As the grading function has it (Card 4); a tracker row for a bounded rendering of a long value in the sheet | `outsideUnavailable`; `renderNamed` in `src/main/device/step-up.ts` |
| 6 | **A chat rooted at the other machine's home**, seen from this Mac by someone at the terminal's grade. The roots of every remote request still leave the home out (237 as written), so the Files list stays empty; its files open by a link, by the agent's delivery and by Open File…, and each is marked "Outside this session's folders", which is not how the person thinks of a chat that works in the home. Condition (c) fixes 237 for callers below the grade and is silent above it | 237's root rule unchanged for every remote caller; the label as U6e's. A ruling could let the home count as a root for a claimed act (the label gone, a file there saved with no evidence), or word the label for a file under a root 237 withholds | the roots a claimed remote request gets, in `precheck` |
| 7 | **A terminal session on another machine, and a session of another profile of this Mac.** Neither has a files route this landing can extend: the first has no record the files service can place and no files read over a link today; the second has no grade, no endpoint and no member | Unchanged; Open File… keeps U6e's sentence for both. Law 5 (three routes, one behaviour) is not met for a terminal session there, as it is not met for its Files list today | `connectOpenFile`'s predicate |
| 8 | **No rank on the session is asked** beyond the terminal's row: a member with the right and no `view` on a session can ask by its id, and learns whether its transcript names a path; that member can read the transcript file in a terminal. The page offers the acts only from a chat the person has open. One consequence: a lost answer is asked again by a query, which takes `view` on the session the operation names, so for such a member a lost answer stays unconfirmed | As the row has it | a rule beside `FORKS` in `authorize.ts` (not built) |
| 9 | **A privacy prompt on the other machine.** The outside read resolves the path before it reads the evidence, as on this Mac, so a click on a link into a private folder that nothing on that machine has read can raise macOS's prompt there, with nobody at its screen; the request then waits and the device says the machine has not answered. A delivered file's read can do the same today, and a terminal there can | As the read on this Mac; the chooser alone asks first (decision 8) | `precheck`'s step 4 for a claimed caller |
| 10 | **The log line holds the path** and is in the daemon log; a choice is logged as a save is; a read is not | Decision 10 | `outsideLog` |
| 11 | **The proof with a real older build as the other machine** needs the rig to start machine B from the peer's build, which `startProfileDaemon` cannot do today | M5 adds the option and one scene per peer in `e2e/cross-build.spec.ts`; until it has run, the proof of condition (g) is the committed tables and the withheld capability | `e2e/support/profile-daemon.ts` |
| 12 | **A file the daemon's user may not read** can be chosen (the choice records a path); its tab then shows the read's refusal in the service's words, which do not say "permission". The same holds on this Mac under U6e | As U6e; one tracker row for U6b-4's plain words | — |

## Acceptance

Observable behaviour; the proof of each is named in the milestone that carries it. "There" is the other machine; "studio" stands for its name. A, the person, owns the machine unless a line says otherwise.

- **B1 · Opening a linked file there.** In the chat of a session that runs there, click a link to a text file outside its folders that its transcript names. The file opens beside the chat with the bar "Outside this session's folders" and its path; the label's tooltip ends "Save writes to <real path> on studio". The same for a file the agent sent from outside, opened with "Open as file".
- **B2 · Editing and saving there.** Type: Save appears and the file on the other machine is unchanged. Press ⌘S: the file there holds the text typed, and nothing beside it changed. Opening, typing, switching tabs and a re-read send no save.
- **B3 · Open File… there.** With that chat in front, File ▸ Open File… (⌘O) and the Files list's row open the chooser on that machine's home. Enter a folder, select a file outside the session's folders, Open: it opens beside the chat as a kept tab with the same bar, edits and saves as in B2. Cancel changes nothing. Quit and relaunch: the tab is there, shows the saved text and saves again.
- **B4 · The chooser's edges.** A private folder asks before it is read and is read only after Open; a folder the daemon's user cannot read says so and ".." still works; a folder of more than 200 names shows the first 200 and More…; a link to a file opens its target, a link to a folder shows that folder; a typed path that names a file selects it, one that names a folder shows it, one that is neither says "There is no file or folder at that path on studio."; while a folder is read, Cancel, the path field and ".." answer at once, and an answer for a folder no longer shown changes nothing.
- **B5 · Below the terminal's grade.** For a member with `view` on the session and no right to a terminal there: Open File… is disabled, and the Files list's row reads "Open File needs the right to use a terminal on studio."; a link to a file outside the folders opens a tab that says "Not opened: you need the right to use a terminal on studio" and shows nothing of the file; a file the agent delivered from outside opens read-only with "Read-only: Saving this file needs the right to use a terminal on studio."; a chat rooted at studio's home shows its conversation and none of its files, as today.
- **B6 · An older machine.** With studio on `f1852de3a`, on `2c7044231`, or with the capability withheld: Open File… is disabled and the row reads "Can't open a file on studio yet. Update MAWS on studio and try again."; a link outside the folders says "Not opened: update MAWS on studio and try again"; nothing of this landing is sent to studio, and every request that is sent is today's to the byte.
- **B7 · What stays refused there.** Through the page's bridge, at the terminal's grade, each answers a refusal and writes nothing: `files.readOutside` and `files.writeOutside` of a path with no evidence, of a path only another session's evidence admits, of a file only an added record admits and of one only a tool's result names (the last two are read, read-only, and not saved); `files.writeOutside` of a file of MAWS's own there; of a path whose folder was swapped for a link since the read (`FILES_MOVED`); with a stale hash (`conflict`, and the merge view opens). `files.write` of an outside file is refused as today.
- **B8 · The record on that machine.** After B2's save, studio's daemon log holds one line `[files] outside write: member … device … session … op …: ok <n> bytes <real path>` stamped with the time; after B3's Open, one `[files] outside choice: … granted <real path>`. Nothing the hub carried or received holds the path.
- **B9 · A drop, a restart, an older build under an edited tab.** With an edit unsaved in an outside file there, cut the link: the tab and the edit stand; Save says "Not saved: studio is offline". Restore it: Save writes. Restart studio's daemon between the read and the save: Save writes. Replace studio's daemon by one of an older build: Save says "Not saved: update MAWS on studio and try again", the file there is unchanged, and no `files.write` is sent.
- **B10 · A member with a grant who is not an owner.** Each open of an outside file, each folder the chooser reads, each choice and each save shows the step-up sheet, with the summaries of decision 13; a refused sheet leaves "Not opened: the confirmation was cancelled" or "Not saved: the confirmation was cancelled" and changes nothing; showing the tab again asks nothing.
- **B11 · Nothing else reads more.** A web-cards device is refused each of the four names (`class`); a call of each is refused (`act-required`); `files.read`, `files.list`, `files.watch` and `files.write` over a link answer what they answer at the pin for a caller with a claim or without one.
- **B12 · Nothing gated got worse.** Typecheck, lint and the unit suite pass on the build VM; the e2e groups that cross the code pass on a Mac.

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push; no `pnpm install`, typecheck, eslint, vitest, build or Electron. Every check runs on the wave's build VM in a checkout of the pushed head, through `vmcheck.sh` (Concrete Steps). An executor starts no Electron e2e, runs no `scripts/ci-gate.sh` and opens no pull request. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.
2. **The owner's answers and the eight conditions bind** (Decision Log 1, 2), with the architect's ruling on a `user` row (Decision Log 3). The cards and the points are built at their defaults and change only on the architect's word.
3. **The grading function is not edited, and nothing copies its outcome.** `src/endpoint/authorize.ts`, `grades.ts`, `step-up.ts`, `by-effect.ts`, `policy.ts` and `gate.ts` are read. No code of this landing compares a right with a literal for the four names, remembers that a member held one, or passes a flag that says so: the endpoint decides each act, and the services act on the claim of the act they run.
4. **U6e's boundary is not reopened.** A read and a save from another machine go through U6e's `precheck`, open, confirmations, `own()` and comparison of the real path, with one question changed (who may reach the outside rule) and nothing skipped. A change that needs another route to the bytes stops and reports.
5. **Below the terminal's grade, to the byte.** For a remote request with no claim, every answer of `files.list`, `files.read` without `named`, `files.watch`, `files.unwatch`, `files.write` and `files.upload` is the pin's; `files.read` with `named` differs by decision 9's mark alone. The tests of P5's Decision Log 237 pass unchanged.
6. **Stored and sent** (root UC-14). Interfaces §A states every command, key, capability and stored record, with what each of the two older builds does in both directions. No field is added to a stored tab, to the layout or to either settings file; nothing new is stored on this Mac.
7. **Files other children own** (root UC-8, UC-7). Interfaces §F lists every file and every insertion with its owner. The insertions in U9's files follow U9 §2's five places and no others. An executor that finds another file must change stops and reports.
8. **The repository is public** (root UC-11), and a fault is never reproduced by reading a person's session, file, settings or folder: structure and counts only, none of it in the repository. Tests, fixtures and scenes use invented paths under a temporary folder, invented text and the machine name the rig gives; "a private folder" in a test is a temporary folder handed to the service as such; no real machine's name, path or installed software appears.
9. **The wave's laws.** Law 3: one sheet is added, no setting. Law 4: one admission step for a read and a save on either machine. Law 5: point 7 says where it is not met. Law 6: nothing about the engine is assumed; no engine runs on the MacBook, and an engine fact the recorded fixtures do not hold goes to the architect.
10. **Guards that read source text.** In renderer source and its tests a ticket or item number is written in words; run the tokens guard (`test/support/tokens-guard.test.ts`) with M4. Components use tokens only. A scene asserts no duration (the gate's script tests read a compared time as a raw bound). `src/shared/machine/coverage.test.ts` pins every place a session id travels.
11. **The base.** The branch takes master by merge, never by rebase or force-push.
12. **The level of proof.** A refusal is asserted with what was not done: the file's bytes read back, the transcript's, the grants' and the Library's spies untouched, no act recorded by the link's fake. A save is asserted on the bytes on the other machine's disk. A claim about an older build is asserted against the committed tables of that build or in a scene with that build as the other machine, and a skipped scene is not evidence.
13. **Disk.** If any command fails with "No space left on device": stop, report, delete nothing.

## The sequences that must hold

Each act below awaits something. For each: what happens when the person, the link or the disk acts in between, what happens when the awaited thing fails or never comes, and the test that holds the sequence open. The service's suite holds its points with `BoundaryHooks`; the endpoint's with the authorizer's context seams; main's with the link's fake (`test/lane-b/fake-link.ts`), whose answers the test releases; the page's with a client whose answers the test releases.

| # | sequence | what must hold | held open by |
|---|---|---|---|
| R1 | the endpoint admitted an outside act; before the services take it, the member's grant is withdrawn or the device removed | the act is decided again, once, and refused; nothing runs (the decision's `stands`, as for every `machine` act) | M2 |
| R2 | a claimed read found the file admitted; before its open, the last component becomes a link, or a folder on the path is swapped | U6e's S1 and S2 with a claimed caller: the refusal; nothing read from the other file | M1, `before-open` |
| R3 | the read's pages: the file changes on that machine between two pages | pages that answer different hashes are read again, at most `REMOTE_READ_TRIES` times, then the read fails with "kept changing"; no document is assembled from two versions | M3 |
| R4 | a read's or a listing's answer is lost and the link sends the same operation again | the ledger answers `NOT_KEPT`; the adapter asks once more under a new id; a second `NOT_KEPT` is the read's failure | M2 (the ledger), M3 (the adapter) |
| R5 | a save's answer is lost: the act was put on a channel and the channel ended | the page is answered at the pending bound ("studio took the request but hasn't confirmed it"), the edits stand; the link asks by the operation's id and the ledger answers the kept outcome, which runs nothing twice. A second press is a new operation with the same expected hash: where the first landed it answers `conflict` and the merge view shows the disk's version, which is the person's own text; where it did not, it writes | M2 (one id, one run), M3, M4 |
| R6 | the read and the save are minutes apart; the link dropped and came back, or the other machine's daemon restarted between them | the save carries the pin and the hash it held; the daemon resolves the path and reads the evidence at the save; it writes exactly when both still hold | M1 (a new service over the same files), M3 |
| R7 | a named file was read; the session's transcript there no longer names it at the save, or the grant was dropped | the save is refused with the service's sentence, nothing written; the page words it as U6e's `outsideRefused`; a choice of the same file, then the same save, lands | M1, M4 |
| R8 | a save is under the link's hold (no channel); the person closes the tab or quits | the tab's close question is U6e's; a save not yet sent when the page ends is not sent later (the act belongs to the adapter's pending bound; a late outcome is logged and lands nowhere) | M3 |
| R9 | the other machine's daemon is replaced by an older build while a tab holds unsaved edits | at the next channel the capability is not listed: the save is refused on this Mac, `not-offered`, nothing sent, no `files.write` in its place; the standing's sentence is the title | M3, M4 |
| R10 | the device's `caps` do not yet hold the person's rights (the link just came up) | the adapter sends the act (unknown is not a refusal); the endpoint decides. With rights known and the right absent, no act is sent | M3 |
| C1 | the chooser reads a folder; the person enters another, goes up, types a path, or cancels | each ask carries a sequence number; only the newest ask's answer lands; Cancel closes at once and a late answer lands nowhere | M4 |
| C2 | a listing never answers | at the pending bound the list's place says "studio has not answered yet." with Try again; the rest of the sheet is live | M4 |
| C3 | Open is pressed; the choice is in flight; the person presses Open again, or Cancel | one choice is sent; Open is busy until it answers; Cancel closes the sheet, and a grant that then arrives is kept by the machine and opens nothing | M4 |
| C4 | the choice answers after its session left the page's records, or after the chat in front changed | a session that left: nothing opens. A chat that changed: the file opens under the session it was chosen for, beside that session's chat (U6b-1's opener) | M4 |
| C5 | the link drops while the sheet is open | the list's place says "studio is not reachable." with Try again; the sheet stays, and its path stands | M4 |
| C6 | Open File… is asked again while the sheet is open | the sheet takes the keyboard; no second sheet | M4 |
| C7 | a member who is not an owner cancels the step-up for a folder | the list's place says "Not listed: the confirmation was cancelled" with Try again; nothing else is asked | M3, M4 |
| W1 | an outside entry of a session over RL2 with unsaved edits; a read answers the standing's refusal (the right withdrawn) | the document stands; the entry stops being editable, with the standing's sentence as its title; Save sends nothing (U6e's W4, with the reason `elsewhere`) | M4 |
| W2 | a tab of an outside file there is shown again | an owner: one read, as U6c's `revisit`. A member who is not known to own the machine: no read; a click on its link, Open File… and Reload read | M4 |

## Plan of Work

Five milestones. Each stands on this document and the code, has its own proof and leaves the tree green. M2 consumes M1's commands; M3 consumes both; M4 consumes M3's adapter and words; M5 consumes all. Sizes are estimates of changed lines, tests included. All five are built on a master that holds U6e and U6b-1 (Concrete Steps 1).

### M1 — The other machine's daemon: the claimed caller, the read, the listing, the choice, the save, the log

**What exists at its end.** `mawsd`'s files service answers `files.readOutside`, `files.listOutside`, `files.chooseOutside` and `files.writeOutside` for a remote request that carries a claim, by U6e's rule over that machine's own evidence, and writes the log lines of decision 10. A remote request without a claim is answered what it is answered at the pin, with decision 9's mark on a delivered file. Nothing sends these yet, and no row offers them, so nothing changes on screen.

**What it touches.** `src/shared/files/outside.ts` (new: `TERMINAL_ACT`, the four names, the capability's name); `src/shared/ipc/schema/files.ts`, `names/files.ts`, `grades/files.ts`; `src/services/files/service.ts`, `register.ts`, `outside-list.ts` (new) and their suites; `src/services/checkouts-root.ts` and `src/services/spine-root.ts` (the log handed to the service; the homes, as `machine.folders.list` gets them); `src/shared/ipc/wire.ts`, `wire-manifest.json`, `wire-fingerprint.json` (the minor, provisional); `src/shared/machine/address-paths.json`; `src/shared/ipc/routes.json`; the header comments of `service.ts` and `schema/files.ts`, which state the old rule; this document's record.

**Interfaces.** Exposes §A's commands and §B. Consumes U6e's §B as it lands (`precheck`'s order, `grant`, `writeOutside`, `own`, the marks).

**Decisions.** 2, 3, 8, 9, 10. In the code: the caller is one value made in `register.ts` from the handler's context and handed to the service where `remote` is handed today; `precheck`'s step 3 reads it; no other step changes. `files.readOutside` is `read` asked with `named` by that caller, so on this machine's own client it is U6e's keyed read and adds nothing. `files.writeOutside` and `grant` lose U6e's refusal of every remote caller and keep it for one without a claim. `files.listOutside` and `files.chooseOutside` answer a claimed remote caller alone. The log is a dependency of the service, called once per ending of a claimed save and choice, after the answer is known, and never throws. Pitfalls seen: `HandlerContext.op` is present for every claimed act, also `files.write` and `files.upload`, so the claim is passed on by the four handlers only and not read from the context inside the service; a remote request reaches `files.readOutside` with no claim only if something other than `machine.op` dispatched it, and that is refused before the roots are computed; U6e's early refusal for a session with no resolvable root must let a claimed caller through as it lets a local keyed one through (a chat rooted at a home has no root for a remote caller); the listing must not call `realpath` on a path it has not walked, since that touches inside a private folder; the home is the daemon user's, by the helper `machine.folders.list` uses, and on a host that is not macOS no folder is private. Tests fail first: the suite "files from another machine" in `service.test.ts`, beside U6e's "files saves outside the folders" and in its shape, with the real transcript search, a real grants file and a real Library index.

**What it does not touch.** The endpoint; main; the page. `allowlist.ts`, `admission.ts`, `named.ts`, `grants.ts`, `own.ts` (read). `src/shared/machine/home-folders.ts` and `src/services/machine/folders.ts`, unless the walk is shared by one exported parameter that leaves `machine.folders.list` byte-identical, which is reported.

**What it proves.** Conditions (b), (c), (d), (e) and (f)'s first half at the service; B7's and B8's daemon halves; B11's service half; R2, R6, R7. Behaviours its tests pin beyond those:

- *The claimed caller.* With a claim: a named, a chosen and a sent file read with `outside.writable: true` and saved, the bytes on disk the content sent; a result-named and an added one read with `writable: false` and refused at the save; a file inside the remote roots read unmarked and saved by `files.writeOutside` with the real path compared. Without a claim, each of the four commands: refused, with the transcript's, the grants' and the Library's spies untouched and the roots never computed for the listing and the choice.
- *Below the grade, to the byte* (condition (c)). The suite's cases of the home-root rule pass unchanged. Added, for a session rooted at a home and for one rooted in a project: a remote caller with no claim is answered by `files.list` (the roots, the home, a folder in it), `files.read` without `named`, `files.watch` and `files.write` exactly what the pin's cases expect, with the transcript's, the grants' and the Library's spies untouched; a remote caller with a claim is answered the same, deep-equal, by those four commands (a claim changes nothing outside the four names); `files.read` with `named` and no claim of a delivered file outside the roots: the same bytes as without the key, with `named` and `outside: { real, writable: false, why: 'added' }`; of a file only the transcript names, and of one only a grant holds: the refusal, neither asked.
- *The listing.* A folder outside the home and the filesystem's root listed; one page of 200 with the cursor of the next, names in the stated order; entries' kinds from the directory entry alone (a spy on `stat` and `lstat` sees no call for an entry); a link listed as a link; a private folder's inside refused `protected` without `open` and listed with it, the walk touching nothing inside it before the refusal (a spy on the file system's calls); a link from outside the home into a private folder refused the same way; a folder the user cannot read `unreadable`; a path that is a file `not-a-folder`; a missing path `no-folder`; on a platform that is not macOS nothing is private.
- *The choice.* A regular file granted, the answer its real path, the grants file holding it; a directory, a package-shaped directory and a special file `not-a-file`; a path inside a private folder `protected` without `open`; a link granted as its target; a choice for a session the view does not know refused; the 257th choice of a session dropping the oldest (U6e's bound, reached remotely).
- *The log.* One line per ending, in decision 10's words, holding the claim's member, device and operation id and never the content; none for a local save, a read or a listing; a log that throws changes no answer.
- *MAWS's own folders and the pin, remotely* (condition (e)). As the conditions' table says.
- *The names.* The four names graded by the value `pty.spawn`'s declaration holds (asserted as identity with `gradeOf('pty.spawn')`, not as the word); `claimable` true for each.

**Size.** About 420 lines of source and 1,150 of tests, over about 20 files.

### M2 — The endpoint and the link's vocabulary: the four rows, the capability, what the ledger keeps, the two older builds' tables

**What exists at its end.** A device at the terminal's grade that sends one of the four acts to this build's endpoint is admitted exactly as it would be for `pty.spawn`, and the act runs in the services as a claimed act; anyone else is refused as for `pty.spawn`. The endpoint lists `rl2.outside-files`. The ledger keeps no file's bytes. Main carries the four names as plain `machine` acts for an app window's page that asks by hand, to a peer that lists the capability; no page asks yet.

**What it touches.** `src/endpoint/offers.ts` (four rows and `asTerminal`), `capabilities.ts` (one entry), `actions.ts` (one name in `KEPT_WITHOUT_ACTION`); `src/services/machine-ops.ts` and its suite (`ANSWER_NOT_KEPT`); `apps/org-protocol/src/channel.ts` (the RL2 minor alone, with the number its test pins); `src/shared/ipc/remote-unavailable.ts` (`REMOTE_NEEDS`: four entries; and, if U6e declared `files.writeOutside` in `REMOTE_UNAVAILABLE`, that entry removed); `src/main/lane-b/remote.ts` (the four names in `MACHINE_ACTS`) and `src/main/files/open-file.ts` (three names in the guard's list), with `src/main/lane-b/remote.test.ts` and `src/main/ipc/router.test.ts`; `test/endpoint/outside-rows.test.ts` (new), `test/endpoint/outside-ledger.test.ts` (new), `test/endpoint/outside-hub.test.ts` (new); `test/cross-build/outside-offers.test.ts` (new) with the committed tables under `test/cross-build/peers/<commit>/` and U6e's `generate.sh` extended; `test/lane-b/offer-coverage.test.ts` only if it must name a new set (U9 §2 says it passes unchanged); the suites that classify an offered command's input keys (`test/endpoint/checkout-rows.test.ts`), only where one asks.

**Interfaces.** Exposes §C. Consumes §B's commands and `TERMINAL_ACT`.

**Decisions.** 1, 2, 4. U9 §2's places 1 to 3 land together here: `test/lane-b/offer-coverage.test.ts` holds every act row to a name the device's adapter handles, so the names join `MACHINE_ACTS` with the rows, and the router's guard takes the three new names in the same milestone, so that no row exists without the sender's check before it; M3 then gives the adapter its order, its pages and its words. In the code: `asTerminal` is written beside the constant `pty` and reads it, so that the four rows and `pty.spawn`'s are one object but for the executor; the suite asserts it over the exported table (`OFFERS.commands['pty.spawn']`), so a later row of its own for `pty.spawn` fails the suite until the four follow. `ANSWER_NOT_KEPT` is consulted at the one `ledger.finish` of `machine.op`; the caller of that run still gets the real answer. Pitfalls seen: the authorizer's step 2 holds a registry command's input to its schema whatever grade the row has, so no `accepts` is needed; the claim's `target` is the session the input names, which a later query places and asks `view` on (point 8); `machine.op` validates a decoded copy of the input, so a save's text is held to `FILES_WRITE_MAX_BYTES` there as at the endpoint; an act's arguments past the channel's bound never arrive (the device refuses them, as for `files.write`). Tests fail first: the differential, red while the rows do not exist.

**What it does not touch.** `src/endpoint/authorize.ts`, `step-up.ts`, `grades.ts`, `policy.ts`, `calls.ts`, `gate.ts`, `streams.ts` (read). `apps/org-protocol` beyond the minor. Main beyond the two lists; the page.

**What it proves.** Conditions (a), (g)'s endpoint half, (f)'s second half, and the endpoint halves of (b), (c) and (d); B11's endpoint half; R1, R4's and R5's ledger halves. Behaviours its tests pin beyond the conditions' table:

- *The rows.* Each of the four deep-equals `pty.spawn`'s row with `executor: 'machine'`, read from the exported table; each is an act (`not-offered` for a `stream`, `act-required` for a call); an act whose input fails the schema is `malformed`.
- *The run.* Through the endpoint's act path with the services' fake: an admitted act reaches `machine.op` with the claim's member and device the channel's, the sealed action beside it for the read, the listing and the choice and absent for the save; the answer goes back as the act's `done`.
- *The ledger.* A read's and a listing's operation met again answers `NOT_KEPT` and runs nothing; the ledger's file after a read of invented text holds no byte of that text, and after a save holds neither its text nor its action; a save's operation met again answers its kept outcome and the file's bytes are written once; a query of each answers `done`.
- *The hub.* Condition (f)'s second half, over the relay carrier with `test/endpoint/fake-hub.ts`.
- *The older tables* (`test/cross-build/outside-offers.test.ts`). For each of `f1852de3a` and `2c7044231`, with the committed copy of that build's `src/endpoint/offers.ts` and `capabilities.ts`: no row for any of the four names, the capability not listed, and the authorizer run over that table answers `not-offered` to an act of each from an owner. The suite needs no git history and never skips.
- *The capability.* Listed by this build; withheld under `MAWS_E2E_ENDPOINT_WITHOUT` as every capability is; an act of each of the four names carries it as its `requires`, and a peer that does not list it is sent nothing.
- *The guard.* `files.readOutside`, `files.listOutside` and `files.chooseOutside` from a frame, from a window that is no app window and through `dispatchLocal` answer `forbidden_sender` with neither dispatcher called, as U6e's suite holds `files.writeOutside`.

**Size.** About 120 lines of source and 800 of tests, over about 21 files (the committed tables, four copied files, not counted in the lines).

### M3 — This Mac's main: the adapter for the outside acts, the guard's names, the words, the standing

**What exists at its end.** Main sends the four acts for a session over RL2 to a machine that lists the capability, when the link's `caps` do not rule the right out, and answers every other case with UC-7's sentence and sends nothing. The page's keyed read of such a session is answered by decision 5's order. The step-up sheet has its four summaries. The page still asks nothing new, so nothing changes on screen.

**What it touches.** `src/main/lane-b/remote-outside-files.ts` (new) and its suite; `src/main/lane-b/remote.ts` (the dispatch of the keyed read and of the four names to the new module), `remote-files-read.ts` (the paged read taking the function that reads one page), `remote-artifacts.ts` (`remote.openCopy`'s session read); `src/main/device/step-up.ts` and `step-up-words.test.ts` (four summaries); `src/shared/ipc/remote-unavailable.ts` and its suite (`ACT_WORDS` rows with `noun`, the terminal's row of `disabledWords` and of `reasonOf`, `rights` in `RemoteStanding`); `src/renderer/src/lane-b/remote-standing.ts` and its suite (`rights` read from the roster); `src/main/lane-b/remote.test.ts`, `test/lane-b/remote.test.ts`.

**Interfaces.** Exposes §D. Consumes §C's rows and capability, U6e's `guardCommand` and `appPageOnly`, U9's `REMOTE_NEEDS`, `refusalResult` and the link's `act`, `caps` and `peerCapabilities`.

**Decisions.** 5, 6, 12, 13 (the summaries), 14, 15. In the code: the module owns every decision about the outside acts on the device, and `remote.ts` gains only the lines that hand it a request, so U9's reviewer reads the insertion against U9 §2. The pre-check of the right reads `gradeOf(TERMINAL_ACT)` and the link's `caps`; rights not yet known send the act. The service's refusal is recognised as U6e's page recognises it (the sentence `FILES_REFUSAL` as the error's message, as it crosses a call's answer); M3's executor confirms how a failed call's message reaches the adapter (`refusalError`, `src/main/machines/remote/dispatch.ts`) before relying on it, and reports a difference. A read's pages go one after another, each a `machine` act with `oneChannel` and the capability as its `requires`; the save is `machineAct` as `files.write` is. Tests fail first: the adapter's table of cases and the sequences R3 to R6 and R8 to R10 over the link's fake.

**What it does not touch.** `src/main/machines/remote/` (the link, its acts and its capabilities list are read). `src/main/ipc/router.ts` (U6e's mechanism is used, not changed). The page beyond `remote-standing.ts`.

**What it proves.** Condition (g)'s device half; B6's and B9's main halves; R3 to R6, R8 to R10, C7's main half. Behaviours its tests pin beyond those:

- *The order of decision 5*, each branch with the link's fake recording every call and act: a peer without the capability gets one `files.read` whose input holds neither `named` nor `agent`, and no act, whatever the answer; a peer with it gets `files.read` with `named`, and then, only on the refusal sentence or an `added` mark and only with the right not ruled out, `files.readOutside` in pages; a file inside the folders costs one call and no act; with the right absent in `caps`, no act, and the answer is `refusalWords('files.readOutside', machine, 'grade')` with `issues.refusal: 'grade'`; an `added` answer followed by a refused act is returned as the call answered it.
- *The pages.* A file of three pages assembled to the one answer the page asked for, `outside` and `named` from the pages; a page answered `NOT_KEPT` asked again once; pages of two hashes read again and then failed.
- *No link.* A read, a listing and a choice with no channel current answer at once and record no act; a save waits under the hold and answers "Not saved: studio is offline".
- *The words.* Each sentence of decision 12's table from `disabledWords` and `refusalWords`, by the standing; unknown rights and unknown capabilities close nothing; the four summaries of the step-up sheet, and the sheet's detail naming the session and the path.
- *The copy.* `remote.openCopy` of an outside file of a session there reads through the outside-aware read and opens the copy; of a file inside the folders, as today.

**Size.** About 320 lines of source and 740 of tests, over about 15 files.

### M4 — The window: reading and saving there, the chooser, Open File… for a session on another machine

**What exists at its end.** B1 to B6, B9 and B10 on screen: an outside file of a session over RL2 opens, edits and saves; Open File… opens the chooser for such a chat and the picked file opens beside it; where it is unavailable the Files list's row and the tab say why.

**What it touches.** `tools/code/viewer/viewer-store.ts` (the keyed read for a session over RL2, the reason `elsewhere`, `revisit`'s cause), `viewer/FileViewer.tsx` (the tooltip that names the machine), `tools/code/copy.ts`; `tools/code/files/elsewhere.ts` (new: which sessions take the remote route, and the sentence), `tools/code/files/open-chosen.ts` (`connectOpenFile`'s predicate and handler), `tools/code/files/FilesTool.tsx` (the row), `tools/code/files/RemoteChooser.tsx` and `remote-chooser.ts` (new); `src/renderer/src/test-support/code-disk.ts`; `test/lane-b/renderer-guards.test.ts` (the entries for the viewer's commands and the chooser's); the suites `viewer/viewer.test.tsx`, `files/files.test.tsx`, a suite each for `elsewhere.ts`, `remote-chooser.ts` and `RemoteChooser.tsx`, and the opener's suite.

**Interfaces.** Exposes §E. Consumes §D; from U6e, by name: `ViewerEntry`'s `pin` and `locked`, `save`'s choice of command, `openChosen`, `connectOpenFile`, `OPEN_FILE_COPY`, the label in `FileBody`; from U6b-1: `openFile(appSessionId, path, line, { keep })`; from U9: `useRemoteStanding`, `useRemoteUnavailableAs`; from U11: the sheet (`sessions/Sheet.tsx`).

**Decisions.** 11 to 14, 17; Cards 1 to 3 at their defaults. In the code: one predicate, `takesRemoteRoute(appSessionId)`, says whether a session's reads carry `named` and whether Open File… may use the chooser (a session MAWS runs on a machine over RL2); everything else about availability is the standing's sentence. The chooser's model is a small state machine apart from its component, tested without a DOM: its states are `reading`, `listed`, `asking` (a private folder's confirmation), `failed` (with its sentence and Try again) and `choosing`; its events are open, enter, up, go (a typed path), more, select, confirm, back, choose, answered (with its sequence number), cancel; only an answer whose number is the newest lands. The sheet is U11's `Sheet`, so it takes the scrim, Escape and the focus rules sheets have; `openChosenElsewhere` mounts it itself, in a root of its own under the document's body, so that ⌘O works with no Files tab mounted and no component of another child gains a mount. If the app's sheets need a provider the shell holds, the one line in `app/Shell.tsx` (U8's) is reported before it is added. A typed path is sent as a listing first and, on `not-a-folder`, selected as a file in its parent's listing; a link is chosen as a file and, on `not-a-file`, listed as a folder. Nothing of the chooser is stored. Tests fail first: C1 to C7, W1, W2 and the call shapes.

**What it does not touch.** `CodeView.tsx`, `EditorControls.tsx`, the Files store and its watch, the strip, the transcript's files, `src/renderer/src/lane-b/` beyond what M3 changed, `src/renderer/src/sidebar/FolderField.tsx` (its look is followed, its code is not shared: it lists folders for another purpose under another grade).

**What it proves.** B1 to B6, B9, B10 as far as a unit test reaches; C1 to C7, W1, W2, R7's and R9's page halves. Behaviours its tests pin beyond those: with a client that records every call, for a session over RL2 every read carries `named` and an entry with a pin saves by one `files.writeOutside`, never `files.write`, whatever the answer; for a session of another profile of this Mac and for a terminal session there, the read carries no `named` and the save is `files.write`; the tooltip names the machine; an entry marked `added` whose standing has a sentence reads `readOnlyReason` `'elsewhere'` with that sentence, and with none reads `'added'`; `file.open` registered for a chat over RL2 exactly while the helper has no sentence for `files.chooseOutside`, and its handler opens the chooser and never calls `layout.openFile`; the row's sentence in each state of decision 12; the chooser sends `open: true` only for a folder the person confirmed and for paths under it; the choice sent once per Open; `opened` calls the opener once with `keep`; every refusal's sentence; `files.listOutside` and `files.chooseOutside` called by no code but the chooser's model (a text guard beside the renderer guards).

**Size.** About 520 lines of source and 1,050 of tests, over about 17 files.

### M5 — The scenes, the two older builds, the record, and the acceptance run

**What exists at its end.** The scenes of Interfaces §G are written and typecheck. The rig can start machine B from another build. The charter, C8's document and U6e's document carry their dated lines; the tracker has its rows. The whole unit suite has run, and Progress says what is left for the architect.

**What it touches.** `e2e/remote.spec.ts` (one scene added, two assertions in an existing one); `e2e/support/profile-daemon.ts` and `remote-scene.ts` (the build root of machine B, an option whose default is today's); `e2e/cross-build.spec.ts` (one row in the coverage table, one scene per peer); other specs only where §G says a scene reads differently; `docs/charter.md`, `docs/doperpowers/plans/2026-09-28-c8-right-panel.md`, `docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md`, `docs/tech-debt-tracker.md` ("The pull request"); this document's record.

**Interfaces.** Consumes everything above and the e2e helpers as U6e's M4 and U6b-1's M5 leave them.

**Decisions.** The two-machine scene lives in `e2e/remote.spec.ts`, the spec that already runs machine B with a session on a replay journal and reads B's disk over its own socket. It asserts the bytes on B's disk and B's daemon log, never only the page. It needs no step-up: the scene's member owns B. A member who is not an owner is not driven by any scene (the scene's org has one member); B10 is the unit suites'. The chooser's rows are found by role and name, not by position. A scene waits with `expect.poll` and asserts no duration.

**What it does not touch.** `src/`, but for a marker a scene proves it needs, reported.

**What it proves.** B12 by Concrete Steps 9; the scenes' typecheck and the gate's script tests. Not proved by an executor: every scene's run ("Proof that an executor does not run").

**Size.** About 560 lines of scenes and support and 60 of documents, over about 9 files.

**The whole landing:** about 1,380 lines of source, 3,740 of tests and 560 of scenes, over about 80 files.

## Concrete Steps

Working directory for every command: the branch's worktree (the controller's brief names it). The VM sees only what is pushed. `vmcheck.sh` prints `vmcheck: ux-wave/U6f at <short sha>`, then the command's own output, and exits with the command's status; the first call for the branch installs dependencies and takes a few minutes. The VM is shared: a check that is slow or times out is read against its load first. Every command there runs under a time limit sized to what it should take.

1. **Before M1: a stop.** M1 starts only when both hold, and the controller asks the architect when they do not:

       git fetch origin master
       git log --oneline origin/master -- src/services/files/grants.ts | head -1                    # U6e's M1: prints a commit
       git log --oneline origin/master -- src/renderer/src/tools/code/files/open-chosen.ts | head -1   # U6e's M3: prints a commit

   Each prints a commit only once U6e is on master whole (the second file is its last milestone's; it needs U6b-1 on master before it). Then `git merge origin/master && git push origin ux-wave/U6f`, and read "Statements to check again once U6e and U6b-1 are on master" against the merged code before the first edit; a difference is reported before it is built around.

2. **Before each milestone:**

       git fetch origin master && git merge origin/master
       git push origin ux-wave/U6f

   A merge, never a rebase or a force-push. After a merge that brought changes, run the previous milestone's proof again (the same set, not the whole suite).

3. **The tests before the modules** (each milestone). Commit the suite of the milestone's "What it proves" with the new exports naming nothing; push; run it; the cases that assert the new behaviour fail and the ones that assert what stays pass. Then build.

4. **While building**, after each push (M1 to M3 change the node project; M4 the web project; `src/shared/` is compiled by both):

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6f -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6f -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6f -- 'timeout 600 pnpm exec eslint <the paths changed>'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6f -- 'timeout 900 pnpm exec vitest run <the test files touched>'

5. **Each milestone's proof** is the typecheck of the projects it changed, eslint on its changed files, and vitest over the folders it touched and those that import what it changed:

   - M1: `src/services/files src/services/spine-root.test.ts src/services/machine src/shared/ipc src/shared/files src/shared/machine src/mawsd test/mawsd`
   - M2: `src/endpoint test/endpoint test/lane-b test/cross-build src/services/machine-ops.test.ts src/shared/ipc src/shared/host apps/org-protocol src/main/lane-b src/main/files src/main/ipc`
   - M3: `src/main/lane-b src/main/machines src/main/files src/main/ipc src/main/device src/shared/ipc src/renderer/src/lane-b test/lane-b`
   - M4: `src/renderer/src/tools/code src/renderer/src/lane-b src/renderer/src/panel test/lane-b test/support/tokens-guard.test.ts`

   as `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6f -- 'timeout 1800 pnpm exec vitest run <the list>'`. Expected: every file passes but the ones the build brief lists as failing on master on the VM too. `service.test.ts`'s cases guarded for macOS are skipped there and run in the Mac lane; M1 says in its report which of its new cases are among them.

6. **The snapshots** (M1). `src/shared/ipc/routes.json` and `src/shared/machine/address-paths.json` gain the three new commands' lines, each written again on the VM by its own switch and brought back as a patch, as U6e's Concrete Steps 5 has it (`MAWS_ROUTES_WRITE=1`, `MAWS_ADDRESS_PATHS_WRITE=1`); before each is written again its test fails and names what is missing, which is the expected red.

7. **Two numbers are provisional.** The wire's minor (`WIRE_MINOR`, `src/shared/ipc/wire.ts`: three commands added) and the RL2 minor (`RL2_PROTOCOL.minor`, `apps/org-protocol/src/channel.ts`: one capability). Another landing may take the next number first. Set each one above master's when its milestone needs it (M1, M2), with its comment; at the last merge of master before the hand-back take each again, one above master's then, the wire's **in one commit of its own** that holds `wire.ts` and the two generated files and nothing else, made on the VM and brought back as a patch as U6e's Concrete Steps 6 has it (`pnpm wire:manifest`), then `pnpm exec vitest run src/shared/ipc/wire.test.ts src/shared/ipc/wire-fingerprint.test.ts` there.

   **The committed tables** (M2). U6e's `test/cross-build/peers/generate.sh` gains two files per commit: that commit's `src/endpoint/offers.ts` and `src/endpoint/capabilities.ts`, with nothing changed but the import paths; the script and its output are committed, and the suite never skips. If a copied `offers.ts` does not compile against this tree's modules, the executor commits instead, from the same script, the list of that commit's row names and the list of its capabilities as JSON, and the suite builds the table from the names with a constant row; it reports which.

8. **A scene is typechecked, not run** (M5):

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6f -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6f -- 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

9. **The acceptance run** (M5's last step), on the pushed head, after a last merge of master and step 7's commit:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6f -- 'timeout 2400 pnpm typecheck'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6f -- 'timeout 1800 pnpm lint'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6f -- 'timeout 3600 pnpm test'

   Expected: each exits 0, apart from the files the build brief lists as failing on master on the VM too; vitest's summary names no other failed file, and the suites of the committed tables ran for both builds. If a fixture file is added, also run `node --test .github/scripts/maws-app-scan.test.mjs` there. The whole unit suite runs this once, by M5's executor. Acceptance against these runs: the daemon and endpoint halves of B5 to B8 and B11 are M1's and M2's suites; B6's, B9's and B10's device halves are M3's; B1 to B6, B9 and B10 as far as a unit test reaches are M4's; B12 is the three commands; every scene is the architect's.

10. **Stop and hand back.** M5's executor writes into Progress what ran and what is left, pushes, and stops. Class 1a (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6f`), the branch review, the e2e runs and the pull request are the architect's.

## Interfaces and Dependencies

### §A. What is stored and sent, and what each older build does with it (M1 to M4)

The two older builds are `2c7044231` and `f1852de3a`. Nothing new is stored on this Mac: the tab of a file on another machine is a Files tab with U6b-1's params, as any; no settings file is touched; no version moves.

**Stored, on the other machine.**

| what | what this landing writes | what each older build does with it | what this build does with their write | this build, then the older, then this build |
|---|---|---|---|---|
| `<profile>/sessions/file-grants.json` (U6e's file, unchanged in form) | a grant per choice made from another machine, as a choice made at that machine writes one | U6e's row: neither names the file, neither reads nor removes it | they write nothing there | read back whole; a tab on the device reads and saves again |
| `<profile>/spine-ops.jsonl` (the services' ledger) | records of the four names: a claim per act; for `files.readOutside` and `files.listOutside` a result that says it was not kept; for `files.writeOutside` its `ok` or `conflict` and no sealed action | both read the ledger by a record's shape, never by its command's name (`OpLedger`'s load, the same at each commit); a claim older than a day goes at the open | — | the records stand until they age out; an operation id met again is answered from them |
| `<profile>/mawsd/mawsd.log` | the lines of decision 10 | a log is appended to, never read | — | — |

**Sent over the machine link.**

| | new in it | an endpoint of `f1852de3a` | an endpoint of `2c7044231` |
|---|---|---|---|
| the handshake | this build's endpoint lists `rl2.outside-files`; the RL2 minor moves by one | lists neither; a device reads capabilities, never the minor | the same |
| `files.readOutside`, `files.listOutside`, `files.chooseOutside`, `files.writeOutside` (acts) | the four names | never sent (the capability is not listed). If one arrived: no row, `not-offered`, nothing read | the same |
| `files.read` (a call) | to an endpoint that lists the capability, the input may carry `named` and `agent`; the answer may carry `named` and `outside` for a delivered file | never sent these keys: the adapter takes them off for a peer without the capability, since this build's strict schema would answer `malformed` | the same (its schema knows `named` and would ignore it for a remote caller; the adapter still takes it off, so the request is today's to the byte) |
| `files.write` | nothing | as today | as today |

**A device of an older build, this build's endpoint.** It lists no new capability and sends none of the four names; its `files.read` and `files.write` are answered as at the pin (constraint 5); it passes by a capability it does not know, as it passes by every one newer than its build.

**Sent on the other machine's own socket** (the wire manifest): three commands added (`files.readOutside`, `files.listOutside`, `files.chooseOutside`), one command's grade changed in the registry (`files.writeOutside`), all additive within the major; the minor is taken at the last merge in a commit of its own (Concrete Steps 7). Each of the three carries a session's id, so `address-paths.json` and `routes.json` gain their lines; none falls in the path class (each input always names a session).

**The pairings, and what proves each.**

| the pairing | what must hold | the proof |
|---|---|---|
| this build's app, the other machine on `f1852de3a` | B6: the items unavailable with the update sentence; nothing of this landing sent; every request today's | M2's suite over that build's committed table; M3's adapter suite (a peer without the capability is sent no act and no new key); the scene "(another machine's outside file, the peer as that machine)" with that peer |
| this build's app, the other machine on `2c7044231` | the same | the same, with that peer |
| an app of either older build, the other machine on this build | it sends nothing new; its requests are answered as at the pin | proved at the endpoint and the service, and said to be so: constraint 5's recorded answers (M1) and the unchanged rows of `files.read` and `files.write` (M2's suite reads the table). No scene stages an older app against this build's endpoint |
| this build on both, the capability withheld | as the first row | the scene of `e2e/remote.spec.ts` under `MAWS_E2E_ENDPOINT_WITHOUT=rl2.outside-files` |

### §B. The other machine's daemon (M1)

    // src/shared/files/outside.ts (new; the endpoint, the services, main and the page read it)
    export const TERMINAL_ACT = 'pty.spawn';                 // the act whose row and grade the four take
    export const OUTSIDE_ACTS = ['files.readOutside', 'files.listOutside', 'files.chooseOutside', 'files.writeOutside'] as const;
    export const OUTSIDE_FILES_CAPABILITY = 'rl2.outside-files';

    // src/shared/ipc/grades/files.ts: each of the four is the value `pty.spawn`'s declaration holds
    import { grades as pty } from './pty';
    'files.readOutside': pty[TERMINAL_ACT], 'files.listOutside': pty[TERMINAL_ACT], 'files.chooseOutside': pty[TERMINAL_ACT], 'files.writeOutside': pty[TERMINAL_ACT],

    // src/shared/ipc/schema/files.ts
    export const OUTSIDE_LIST_PAGE = 200;
    export const FilesReadOutsideInputSchema = FilesReadInputSchema.omit({ named: true });      // always asks by the outside rule; `agent` stays
    export const FilesListOutsideInputSchema = z.strictObject({
      appSessionId: AppSessionIdSchema,                       // the session the chooser is open for; it places the request on its machine
      path: z.string().min(1).max(4096).optional(),           // absolute, or `~` and `~/…`; absent: the home
      open: z.literal(true).optional(),                       // read inside the private folders the path itself enters
      cursor: z.string().min(1).max(1024).optional(),         // the last name of the page before
    });
    export const OutsideEntrySchema = z.strictObject({ name: z.string(), path: z.string(), kind: z.enum(['dir', 'file', 'link', 'other']), protected: z.boolean() });
    export const FilesListOutsideOutputSchema = z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('listed'), path: z.string(), parent: z.string().nullable(), home: z.string(), entries: z.array(OutsideEntrySchema), cursor: z.string().nullable() }),
      z.strictObject({ status: z.literal('refused'), reason: z.enum(['no-folder', 'not-a-folder', 'unreadable', 'protected']) }),
    ]);
    export const FilesChooseOutsideInputSchema = z.strictObject({ appSessionId: AppSessionIdSchema, path: z.string().min(1).max(4096), open: z.literal(true).optional() });
    export const FilesChooseOutsideOutputSchema = z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('granted'), path: z.string() }),                                         // the real path: what the tab opens
      z.strictObject({ status: z.literal('refused'), reason: z.enum(['not-a-file', 'no-file', 'protected']) }),
    ]);
    'files.readOutside':   { input: FilesReadOutsideInputSchema,   output: FilesReadOutputSchema,          owner: 'machine' }
    'files.listOutside':   { input: FilesListOutsideInputSchema,   output: FilesListOutsideOutputSchema,   owner: 'machine' }
    'files.chooseOutside': { input: FilesChooseOutsideInputSchema, output: FilesChooseOutsideOutputSchema, owner: 'machine' }
    // 'files.writeOutside' and 'files.grant' are U6e's, unchanged in shape; `files.grant` stays main-only

    // src/services/files/service.ts
    /** Who asks: this machine's own client; another machine's with no claim; another machine's under the claim `machine.op` made for the act it runs. */
    export type FilesCaller = { remote: false } | { remote: true; claim: null } | { remote: true; claim: { member: string; device: string; opId: string } };
    export interface FilesServiceOptions {
      // … as U6e leaves them, and:
      outsideLog?: (line: string) => void;                       // decision 10's lines; absent: none
      home?: () => string;                                       // the daemon user's home (`machineHome`), for the listing and the choice; a suite's fake one
      platform?: NodeJS.Platform;                                // only macOS has private folders; a suite's
    }
    interface FilesService {
      // where U6e takes `remote?: boolean`, each method takes `caller?: FilesCaller` (absent: this machine's own client)
      read(input: FilesReadInput, caller?: FilesCaller, signal?: AbortSignal): Promise<FilesReadOutput>;
      writeOutside(input: FilesWriteOutsideInput, caller?: FilesCaller, signal?: AbortSignal): Promise<FilesWriteOutput>;
      grant(appSessionId: AppSessionId, path: string, caller?: FilesCaller): Promise<FilesGrantOutput>;                  // U6e's; a remote caller needs a claim
      listOutside(input: FilesListOutsideInput, caller: FilesCaller): Promise<FilesListOutsideOutput>;                  // a claimed remote caller alone
      chooseOutside(input: FilesChooseOutsideInput, caller: FilesCaller): Promise<FilesChooseOutsideOutput>;            // a claimed remote caller alone
      // list, watch, unwatch, write, openExternal, reveal, readResolved: unchanged; a remote caller is a remote caller, with a claim or without
    }

**`precheck`, the one question that changes** (U6e's order, its step 3): *may the outside rule admit?* Only when the operation is `read`, `openExternal` or `writeOutside`; the request asked; and the caller is this machine's own client, or a remote caller with a claim and the operation is `read` or `writeOutside`. Settled from the caller alone, before a grant, the Library or the transcript is touched. The roots are computed as today: less the home for every remote caller. Every other step is U6e's, also for a claimed caller: the grants, the delivery, the transcript's counted forms, the grant once more, then a result form and an added record for a read alone; `own()` and the comparison of the real path at the save.

**A remote read that asked, with no claim** (decision 9). Step 3 says no; the delivered admission is today's; where it admitted a real path outside the roots, the answer carries `named: true` and `outside: { real, writable: false, why: 'added' }`. A remote read that did not ask is answered unmarked, as today.

**`listOutside`.** A caller that is not remote with a claim: the service's refusal. The session has a record, else `unknown app session`. The path is expanded (`~`), then walked one component at a time from the filesystem's root, links followed where they stand (at most 32); before a component inside a private folder is touched, when the request carries no `open`: `refused: protected`. A missing component: `no-folder`; the walk ends at something that is no directory: `not-a-folder`; `readdir` refused: `unreadable`. Then one `readdir` with entry types; `kind` from the entry type alone (`dir`, `file`, `link`, else `other`); `protected` true for an entry that is itself a private folder; the names ordered folders first, then by name, a name that begins with a dot after the rest of its group; one page of `OUTSIDE_LIST_PAGE` after `cursor`; `path` the walked real path, `parent` its parent or null at the root, `home` the daemon user's home.

**`chooseOutside`.** A caller that is not remote with a claim: the service's refusal. The same walk, with the same `protected` refusal, to the path's parent; then U6e's `grant` with the caller (the real path, a regular file or `not-a-file`, the grants' add); a path that is gone: `no-file`. Then the log line.

**The log** (`outsideLog`, decision 10; exact forms): `outside write: member <member> device <device> session <appSessionId> op <opId>: ok <bytes> bytes <real>`; `…: conflict <real>`; `…: refused (<word>) <path>`, the word one of `outside`, `own`, `moved`, `missing`, `not-writable`, `other`; `outside choice: member <member> device <device> session <appSessionId> op <opId>: granted <real>`; `…: refused (<reason>) <path>`. One line per claimed request, written after its answer is known.

**Wiring.** `register.ts`: `const caller = (context) => context?.remote !== true ? LOCAL : NO_CLAIM`, and for the four handlers alone `context.op` present gives `{ remote: true, claim: { member, device, opId } }`; `files.readOutside` calls `read({ ...input, named: true }, caller, endOf(...))`; `files.listOutside` and `files.chooseOutside` call their methods; `files.writeOutside` passes the caller. `endOf`'s per-client signal is made for a claimed remote read too (the client is the channel's). `spine-root.ts` hands `outsideLog: (line) => console.warn(`[files] ${line}`)`, which the daemon's entry routes into `mawsd.log`.

### §C. The endpoint and the ledger (M2)

    // src/endpoint/offers.ts, beside the constant `pty`
    /** UX wave U6f: a file outside a session's folders, read, listed, chosen and saved from another machine: `pty.spawn`'s own row, run by the machine's services. */
    const asTerminal = (): OfferRow => ({ ...pty, executor: 'machine' });
    'files.readOutside': asTerminal(), 'files.listOutside': asTerminal(), 'files.chooseOutside': asTerminal(), 'files.writeOutside': asTerminal(),

    // src/endpoint/capabilities.ts: 'rl2.outside-files' appended, with its comment
    // apps/org-protocol/src/channel.ts: RL2_PROTOCOL.minor one above master's (apps/org-protocol/test/messages.test.ts pins the number)
    // src/endpoint/actions.ts: KEPT_WITHOUT_ACTION gains 'files.writeOutside'
    // src/shared/ipc/remote-unavailable.ts: REMOTE_NEEDS gains the four names, each OUTSIDE_FILES_CAPABILITY

    // src/services/machine-ops.ts
    /** Acts whose answer is a file's bytes or a folder's names: the ledger keeps that the operation ended, never what it answered. */
    export const ANSWER_NOT_KEPT: ReadonlySet<string> = new Set(['files.readOutside', 'files.listOutside']);
    export const NOT_KEPT = { ok: false, error: { code: 'internal', message: 'the answer was not kept: ask again', issues: { refusal: 'not-kept' } } } as const;
    // op(): `ledger.finish(opId, ANSWER_NOT_KEPT.has(name) ? NOT_KEPT : result)`; the run's own caller is returned `result`

No other line of the endpoint changes. The four acts are decided by `Authorizer.authorize` as any act, handed to `machine.op` by the branch every `machine` act takes, and answered by `done`.

### §D. This Mac's main (M3)

    // src/main/lane-b/remote-outside-files.ts (new)
    export const REMOTE_OUTSIDE_PAGE_BYTES = 256 * 1024;
    export interface RemoteOutsideDeps {
      call(link: RemoteLink, name: 'files.read', fields: Fields): Promise<Result>;                                   // today's paged call (`readFileInPages`)
      act(link: RemoteLink, name: OutsideAct, fields: Fields, options: { oneChannel: boolean; deadline: number }): Promise<Result>;   // `machineAct`, the capability as its `requires`
      now(): number; pendingMs: number; log(line: string): void;
    }
    export function createRemoteOutsideFiles(deps: RemoteOutsideDeps): {
      handles(name: CommandName): boolean;                                // the four names (`files.read` is the adapter's already; its `run` hands one whose input carries `named` to `read`)
      dispatch(link: RemoteLink, name: CommandName, fields: Fields): Promise<Result>;
      read(link: RemoteLink, fields: Fields): Promise<Result>;            // decision 5's order; `remote.openCopy`'s session read too
    };
    export function terminalHeld(link: Pick<RemoteLink, 'caps'>): boolean | null;   // the link's `caps` hold `gradeOf(TERMINAL_ACT)`; null: not known

`read`, in order (decision 5): the peer does not list the capability: `call` with `named` and `agent` taken off, its answer returned. Else `call` with the input as given. An answer with no `outside`: returned. The service's refusal sentence, or an answer whose `outside.why` is `'added'`: when `terminalHeld` is false, the refusal is `refusalResult('files.readOutside', machine, 'grade')` (for the `added` answer, the call's answer is returned as it is); else `files.readOutside` in pages of `REMOTE_OUTSIDE_PAGE_BYTES`, each an act on one channel, assembled as `readInPages` assembles pages; a page answered `not-kept` is asked again once; a failed act after an `added` answer returns the call's answer. With no channel current, every branch answers `host_unavailable` at once and nothing is sent.

`dispatch` for the four names: the peer does not list the capability: `refusalResult(name, machine, 'not-offered')`, nothing sent (with no channel current, `files.writeOutside` goes to `machineAct` and waits under the hold, its `requires` judged at the channel it meets; the other three answer at once). `terminalHeld` false: `refusalResult(name, machine, 'grade')`, nothing sent. Else the act: `files.writeOutside` as `files.write` goes (`machineAct`, the pending bound); `files.listOutside` and `files.chooseOutside` on one channel. A refusal the endpoint gives is worded by `refusalResult`, since each name has its `ACT_WORDS` row.

    // src/shared/ipc/remote-unavailable.ts (U9's; insertions by U9 §2)
    export type ActWords = { act: string; done: string; closes?: true; noun?: string };   // `noun`: what opens "… is unavailable" and "… needs the right"; absent: the act, capitalised
    ACT_WORDS gains:
      'files.readOutside':   { act: 'open this file', done: 'opened', noun: 'Opening this file' },
      'files.writeOutside':  { act: 'save this file', done: 'saved',  noun: 'Saving this file' },
      'files.chooseOutside': { act: 'open a file',    done: 'opened', noun: 'Open File', closes: true },
      'files.listOutside':   { act: 'list a folder',  done: 'listed', noun: 'Listing a folder' },
    export type RemoteStanding = { /* … as today, and: */ rights: readonly string[] | null };   // MachineState.rights; null: not known
    // disabledWords, a row after the capability's and before the offline row:
    //   OUTSIDE_ACTS holds the command, `rights` is known and lacks gradeOf(TERMINAL_ACT):  `${noun} needs the right to use a terminal on ${machine}.`
    // the offline row reads `${noun ?? capitalised(act)} is unavailable while ${machine} is offline.`
    // reasonOf, case 'grade': for a command of OUTSIDE_ACTS:  `you need the right to use a terminal on ${machine}`

    // src/main/device/step-up.ts, `sentenceOf`:
    'files.readOutside': 'Open a file on', 'files.listOutside': 'List a folder on', 'files.chooseOutside': 'Choose a file on', 'files.writeOutside': 'Save a file on'

    // src/main/files/open-file.ts (U6e's): guardCommand(['files.writeOutside', 'layout.openFile', 'files.readOutside', 'files.listOutside', 'files.chooseOutside'], appPageOnly)

### §E. The window (M4)

    // tools/code/files/elsewhere.ts (new)
    export function takesRemoteRoute(appSessionId: AppSessionId): boolean;      // a session MAWS runs on a machine over RL2 (`isRemoteLaneB` and `isOverRl2`)
    export function outsideUnavailable(standing: RemoteStanding | null, command: 'files.chooseOutside' | 'files.writeOutside' | 'files.readOutside'): string | null;
    // `disabledWords(command, standing)`; null with no standing

    // tools/code/viewer/viewer-store.ts
    // readChunk: `named: true` for a session on this Mac (U6c) and for one that `takesRemoteRoute`; `agent` as U6e
    // readOnlyReason gains 'elsewhere': an entry of a session that takes the remote route, `locked === 'added'`, for which
    //   `outsideUnavailable(standing, 'files.writeOutside')` is a sentence; the title is `Read-only: ${that sentence}`
    // revisit(tabId, appSessionId, cause: 'shown' | 'opened'): for an entry with a pin of a session that takes the remote route,
    //   cause 'shown' reads only when the standing's `owner` is true

Copy, in `tools/code/copy.ts` (exact strings; "studio" stands for the machine's name):

    VIEWER_COPY.outsideSavesOn = (real: string, machine: string) => `This file is not in the folders this session works in. Save writes to ${real} on ${machine}`
    EDITOR_COPY.readOnly.elsewhere = (words: string) => `Read-only: ${words}`
    REMOTE_CHOOSER_COPY = {
      title: (machine: string) => `Open a file on ${machine}`,
      go: 'Go', up: '..', more: 'More…', open: 'Open', cancel: 'Cancel', back: 'Back', retry: 'Try again',
      private: 'private', link: 'link',
      foot: (machine: string) => `Files on ${machine}, read as its MAWS service can read them.`,
      reading: 'Reading the folders…',
      empty: 'Nothing here',
      openPrivate: (folder: string, machine: string) => `Open ${folder} on ${machine}? macOS protects this folder, and opening it may show a privacy prompt on ${machine}’s own screen.`,
      unreadable: (machine: string) => `MAWS on ${machine} cannot read this folder.`,
      noAnswer: (machine: string) => `${machine} has not answered yet.`,
      unreachable: (machine: string) => `${machine} is not reachable.`,
      nothingThere: (machine: string) => `There is no file or folder at that path on ${machine}.`,
      notAFile: 'Open File opens one file. A folder or an app’s package cannot be opened here.',   // U6e's sentence
    }

    // tools/code/files/remote-chooser.ts (new): the model, no DOM
    export type ChooserState =
      | { at: 'reading'; path: string | null }
      | { at: 'listed'; path: string; parent: string | null; home: string; entries: OutsideEntry[]; cursor: string | null; selected: string | null }
      | { at: 'asking'; folder: OutsideEntry }                      // a private folder's confirmation
      | { at: 'failed'; path: string | null; words: string }       // with Try again
      | { at: 'choosing'; path: string };
    export interface RemoteChooser {
      state(): ChooserState; subscribe(listener: () => void): () => void;
      enter(entry: OutsideEntry): void; up(): void; go(path: string): void; more(): void; select(path: string): void;
      confirm(): void; back(): void; choose(): Promise<string | null>;   // the granted real path, or null
      retry(): void; cancel(): void;
    }
    export function createRemoteChooser(appSessionId: AppSessionId, deps: { list(input): Promise<Result>; choose(input): Promise<Result>; machine(): string; startAt: string | null }): RemoteChooser;
    export function startOf(machine: MachineRef): string | null;   // the last folder shown there this run; null: the home (Card 2)

    // tools/code/files/RemoteChooser.tsx (new): the sheet of Card 1, on U11's `Sheet`; `[data-remote-chooser]`, rows `[data-entry]` with `data-kind`
    // tools/code/files/open-chosen.ts (U6e's)
    //   connectOpenFile: `file.open` is registered also while the chat in front is a session that `takesRemoteRoute` and
    //     `remoteUnavailableOf(session, 'files.chooseOutside')` is null; its handler then opens the chooser (never `layout.openFile`)
    //   openChosenElsewhere(appSessionId): opens the chooser; on a granted path, when the page still knows the session,
    //     `openFile(appSessionId, path, null, { keep: true })`
    // tools/code/files/FilesTool.tsx: the row `[data-open-file]` for a session that takes the remote route: enabled, calling
    //   `openChosenElsewhere`; or disabled with `useRemoteUnavailableAs('Open File', appSessionId, 'files.chooseOutside')`,
    //   shown the way a session menu's disabled item shows its sentence (U9's). Every other session of another machine: U6e's `elsewhere(machine)`

### §F. Files other children own, or no child owns (UC-8, UC-7)

| files | owner | this landing |
|---|---|---|
| `src/endpoint/offers.ts`, `capabilities.ts`; `src/shared/ipc/remote-unavailable.ts`; `src/main/lane-b/remote.ts`; `src/main/device/step-up.ts`; `src/renderer/src/lane-b/remote-standing.ts`; `test/lane-b/offer-coverage.test.ts` | U9 (UC-7, UC-8) | U9 §2's five places: four rows and `asTerminal`; one capability; four `REMOTE_NEEDS` entries, four `ACT_WORDS` rows with the optional `noun`, one row each in `disabledWords` and `reasonOf`, `rights` in `RemoteStanding`; the four names in `MACHINE_ACTS` and the lines that hand a request to the new module; four summaries; `rights` read from the roster. U9 reviews them |
| `src/endpoint/actions.ts` | the P5 work, with the session that keeps master | one name in `KEPT_WITHOUT_ACTION` (point 3) |
| `src/services/machine-ops.ts` and its suite | the P5 work | `ANSWER_NOT_KEPT`, `NOT_KEPT`, one condition at the ledger's `finish` (point 3) |
| `apps/org-protocol/src/channel.ts`, `apps/org-protocol/test/messages.test.ts` | the P5 work | the RL2 minor and the number its test pins |
| `src/main/lane-b/remote-files-read.ts`, `remote-artifacts.ts` | the P5 work | the paged read takes the function that reads one page (today's callers pass today's); `remote.openCopy`'s session read calls the outside-aware read |
| `src/main/lane-b/remote-outside-files.ts` (new) and its suite | U6 | the adapter |
| `src/services/files/service.ts`, `register.ts`, `outside-list.ts` (new), their suites; `src/services/checkouts-root.ts` | no child (the row lists U6c, U8c-2 and, from its landing, U6e) | the caller, the two new methods, the log |
| `src/services/spine-root.ts` and its suite | the P5 work (U6c and U6e inserted) | one dependency handed on: the log |
| `src/shared/files/outside.ts` (new); `src/shared/ipc/schema/files.ts`, `names/files.ts`, `grades/files.ts` | U6 (`src/shared/files/`); no row for the schema | the names, the schemas, the grades by reference |
| `src/shared/ipc/wire.ts`, `wire-manifest.json`, `wire-fingerprint.json`, `src/shared/machine/address-paths.json`, `src/shared/ipc/routes.json` | no child; the wire's row lists the landings that raise the minor | the minor, at the merge, in a commit of its own; three commands' lines |
| `src/main/files/open-file.ts`, `src/main/app.ts` | U6e's; no child | three names in the guard's list |
| `src/main/ipc/router.ts` | the session that keeps master | read, not edited |
| `src/renderer/src/tools/code/viewer/`, `tools/code/files/`, `tools/code/copy.ts`, `tools/code/editor/register.ts`, `test-support/code-disk.ts` | U6 | the window |
| `test/lane-b/renderer-guards.test.ts` | U9 | the entry for the viewer's `named` read reworded (issued for this Mac's session and for one that takes the remote route), entries for the chooser's two commands |
| `test/endpoint/outside-rows.test.ts`, `outside-ledger.test.ts`, `outside-hub.test.ts`, `test/cross-build/outside-offers.test.ts` (new); `test/cross-build/peers/` (U6e's, extended) | no row | the endpoint's suites; the two builds' tables |
| `e2e/remote.spec.ts`, `e2e/support/remote-scene.ts`, `e2e/support/profile-daemon.ts` | the P5 work | one scene, two assertions; machine B's build root |
| `e2e/cross-build.spec.ts` | the P5 work; the table is U13a's | one row, one scene per peer |
| `docs/charter.md`, `docs/doperpowers/plans/2026-09-28-c8-right-panel.md`, `docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md`, `docs/tech-debt-tracker.md` | the record | one dated line each; the tracker's rows ("The pull request") |
| `docs/doperpowers/plans/2026-10-27-p5-org.md` | the session that keeps master | not edited here: that session writes Decision Log 277, amending 237, at the landing |
| `src/endpoint/authorize.ts`, `grades.ts`, `step-up.ts`, `by-effect.ts`, `policy.ts`, `calls.ts`, `gate.ts`, `streams.ts`; `src/main/machines/remote/`; `src/shared/machine/home-folders.ts`, `src/services/machine/folders.ts`; `src/renderer/src/sidebar/FolderField.tsx`; `src/services/files/allowlist.ts`, `admission.ts`, `named.ts`, `grants.ts`, `own.ts`; `src/engine-host/` | as UC-8 names them | read, and not edited |

### §G. The e2e groups whose scenes cross this change

By the group's name in `package.json`.

| group | spec | scenes that change, or are added |
|---|---|---|
| `e2e:remote` | `e2e/remote.spec.ts` | **Added:** "U6f: a file outside the session's folders on B opens in A, is edited, and is written on B only by Save; Open File… picks a file on B; a relaunch keeps it; with the capability withheld the items say to update B". B's session runs a journal whose transcript links `notes.txt` in a fresh folder outside its checkout; B's disk also holds `unnamed.txt` beside it, a file in a second fresh folder for the chooser, and a file under B's profile. In A: click the link: the tab beside the chat, `[data-outside="writable"]`, the tooltip naming B; type: `data-dirty="true"`, B's file unchanged (read over B's own socket); ⌘S: B's file holds the text, and B's daemon log gains one `outside write:` line naming A's member; change the file on B, type, Save: the merge view, B's bytes still B's. Through `window.maws.invoke`, each refused with B's bytes read back: `files.readOutside` and `files.writeOutside` of `unnamed.txt`, `files.writeOutside` of the file under B's profile, `files.write` of `notes.txt`. ⌘O: the sheet `[data-remote-chooser]` on B's home; a typed path to the second folder lists it; select the file, Open: a kept tab with the label; type and ⌘S: B's bytes, and an `outside choice:` line; cut the scene's pipe: Save says "Not saved: … is offline" and the edit stands; restore: Save writes; relaunch A on the same profile: the tab, the text, one more save. Then B restarted under `MAWS_E2E_ENDPOINT_WITHOUT=rl2.outside-files`: A's machine entry lists no such capability, File ▸ Open File… is disabled, the Files list's row reads the update sentence, the link's tab says "Not opened: update MAWS on … and try again", and B's daemon log gains no line. **Changed:** in the first scene, the step where the editor saves a file of B's checkout gains two assertions: the save is `files.write`, and the read of a file inside the checkout is one call and no act (B's ledger holds no `files.readOutside` record) |
| `e2e:cross-build` | `e2e/cross-build.spec.ts` | **Added, for each of the two peers:** "(another machine's outside file, the peer as that machine)": machine B's daemon is started from the peer's build (`MAWS_E2E_PEER_ROOT`, through the rig's new option); this build's app as A reaches it; A's machine entry for B lists no `rl2.outside-files`; Open File… is disabled with the update sentence; a link outside the folders shows its sentence; B's ledger and log hold no record of any of the four names; the editor's save of a file inside B's checkout still lands. The coverage table (U13a's block) gains the row "U6f: nothing stored on this Mac; on the other machine U6e's grants file, ledger records of four names, log lines; sent: four acts behind `rl2.outside-files`". The scene skips, saying so, unless the peer is one of the two builds or where the rig cannot start the peer's daemon as B; a skipped scene is not evidence |
| `e2e` | `e2e/sessions.spec.ts` | none is expected to change: U6e's scenes are this Mac's. Run because the viewer's read and `revisit` gained a branch |
| `e2e:code` | `e2e/code-editor.spec.ts`, `e2e/code-tools.spec.ts` | none is expected to change; run because the store's read and save are theirs |
| `e2e:machines` | `e2e/machines.spec.ts` | read for a scene that opens a file of another profile's session: such a session takes no remote route, and its requests are today's; changed only if a scene there counted on `named` being absent in a way the guard's new words affect |
| `e2e:settings` | `e2e/settings.spec.ts`, `e2e/org-page.spec.ts` | none is expected to change (no setting, no grant's wording) |
| `e2e:presentations` | `e2e/presentations-present.spec.ts` | none is expected to change; run because the guard's list is longer |
| `e2e:lane-a` | `e2e/lane-a.spec.ts` | none is expected to change; run because a terminal session on another machine keeps U6e's sentence |

### §H. What a sibling may rely on

- **U6b-4** (the link forms; the refusal in plain words): a form it adds to the rule is read by the other machine's daemon as by this Mac's, so a file it opens here opens there with no change in this landing. Its notice table can recognise the sentences of decision 12 by `issues.refusal` (`grade`, `not-offered`, `step-up`, `read-only`) on a failed read of a session over RL2.
- **U6b-2** (a file's bytes to a frame): a route that asks `files.read` with `named` for a session over RL2 is answered by decision 5's order in main; a frame's route never sends one of the four names (the guard refuses a frame).
- **U9**: the insertions of §F, by U9 §2. `RemoteStanding.rights` and `ActWords.noun` are there for any later act that words a right or a noun.
- **Whoever offers another act on a file outside the folders**: `asTerminal` is the one way to its row, `OUTSIDE_ACTS` the one list the words, the guard and the adapter read, and a claim the one thing the services act on.

## Statements to check again once U6e and U6b-1 are on master

Each is a statement of this document that rests on U6e's or U6b-1's document and not on code at the parent pin. M1's executor reads rows 1 to 9 against the merged code before the first edit, M3's rows 10 and 11, M4's rows 12 to 18, and each reports a difference before building around it.

| # | the statement | where it is used | read it in |
|---|---|---|---|
| 1 | `precheck` settles "may the outside rule admit?" in one step, from the request's own context, before any evidence is touched, and a remote request is refused there | decision 3; §B | `src/services/files/service.ts` |
| 2 | The service's methods take `remote?: boolean` from `register.ts`, which reads it from the handler's context; `writeOutside` and `grant` refuse every remote caller | §B (`FilesCaller` takes that parameter's place) | `service.ts`, `register.ts` |
| 3 | The marks are `chosen`, `sent`, `named`, `result`, `added`; a read's answer carries `named` and `outside: { real, writable, why? }` exactly for a marked file, and `own` for a file of MAWS's own | decisions 5, 9; §B | `service.ts`, `src/shared/ipc/schema/files.ts` |
| 4 | **What a remote read that carries `named` answers for a delivered file outside the roots** under U6e: unmarked (as at the pin) or marked `added`. This landing defines it as marked `added`; if U6e already marks it, decision 9 adds nothing, and if U6e answers unmarked, M1 adds the mark | decision 9 | `precheck`'s step 5 as built |
| 5 | `grant(appSessionId, path, remote?)` resolves the path itself, grants only a regular file and answers the real path; the grants are a file of the profile with at most 256 per session | decision 7; `chooseOutside` | `service.ts`, `src/services/files/grants.ts` |
| 6 | `writeOutside` tests `own()` and compares `input.real` after the open, on the confirmed real path, and shares `write`'s writer | condition (e) | `service.ts` |
| 7 | A `user` row's text counts for a save only when the person wrote it; a peer session's message and a notification row admit nothing (the architect's ruling after U6e's revision 3) | the write rule, line 1 | `src/shared/files/named.ts`, `src/services/files/named.ts` |
| 8 | `files.writeOutside` is a bridged `machine` command with no row in `OFFERS`; its declared grade (U6e wrote `manage`) is replaced here by the terminal's | §B, §C | `src/shared/ipc/grades/files.ts`, `src/endpoint/offers.ts` |
| 9 | Whether U6e declared `files.writeOutside` in `REMOTE_UNAVAILABLE` (it does so only if `test/lane-b/offer-coverage.test.ts` asked); if it did, the entry is removed with the row's arrival | M2 | `src/shared/ipc/remote-unavailable.ts` |
| 10 | `guardCommand(names, guard)` runs after the input is validated and before a request is forwarded to another machine's link, for every way a request enters; `appPageOnly` is registered for `files.writeOutside` and `layout.openFile` | the write rule, line 2; §D | `src/main/ipc/router.ts`, `src/main/files/open-file.ts`, `src/main/app.ts` |
| 11 | `layout.openFile` is refused by the router for a session of another machine before any handler runs | decision 7; point 4 | `src/main/ipc/router.ts` |
| 12 | `ViewerEntry` holds `pin`, `locked` and `agent`; `save` sends `files.writeOutside` for an entry with a pin and never `files.write`; a failed outside save is worded `outsideRefused` or `outsideUnavailable` | decisions 11, 14; §E | `tools/code/viewer/viewer-store.ts` |
| 13 | `readOnlyReason` answers `'maws'`, `'added'`, `'result'`, `'outside'` and today's reasons, and `EDITOR_COPY.readOnly` holds their sentences | §E (`'elsewhere'` joins them) | `viewer-store.ts`, `tools/code/copy.ts` |
| 14 | The label is drawn in `FileBody`'s bar from the entry (`[data-outside=…]`), with `VIEWER_COPY.outsideSaves(real)` as the writable label's tooltip | B1; §E | `tools/code/viewer/FileViewer.tsx` |
| 15 | `connectOpenFile` keeps `file.open` registered while no page is open and the chat in front is a session of this Mac; `openChosen` invokes `layout.openFile`; the Files list's row reads `OPEN_FILE_COPY.elsewhere(machine)` for a session on another machine | decisions 7, 12; §E | `tools/code/files/open-chosen.ts`, `tools/code/files/FilesTool.tsx` |
| 16 | `revisit(tabId, appSessionId)` is called when a tab is shown again and when its file is opened again, and reads only an entry with no unsaved edits; this landing gives it the cause | decision 13; W2 | `viewer-store.ts`, `tools/code/open-file.ts`, the Files tab's mount |
| 17 | `openFile(appSessionId, path, line?, { keep })` opens beside the chat of the session it names, also when another chat is in front, and for a session on another machine as for one here | C4; §E | `tools/code/open-file.ts` (U6b-1) |
| 18 | U6e's scene helpers in `e2e/sessions.spec.ts` and the markers `[data-outside]`, `[data-open-file]`, `[data-files-menu]` as its M4 leaves them | §G | `e2e/sessions.spec.ts`, `e2e/support/` |

## Proof that an executor does not run

Each is a step for the architect, with what it needs.

1. **The two-machine scene**, alone, then the group `e2e:remote`, on a Mac under the load rule, from the branch's head. Needs: the built app; nothing of the owner's (the scene's local org, its two scratch profiles, its folders). It is the only proof that the act crosses a real channel, that the bytes land on the other machine's disk and that its daemon log holds the line.
2. **The groups that cross the code** (§G): `e2e`, `e2e:code`, `e2e:machines`, `e2e:settings`, `e2e:presentations`, `e2e:lane-a`.
3. **The runs with each older build as the other machine**: `e2e:cross-build` with `--peer-exact f1852de3a` and again with `--peer-exact 2c7044231`, on the final head. Needs: the peer checked out and built beside the checkout, as the gate does for that group, and the rig's new option proven to start that build's daemon as machine B; if it cannot, the architect is told which step failed, and the proof of condition (g) for a real older endpoint stays the committed tables and the withheld capability, which the pull request then says. The group's existing scenes also carry the wire's new minor across each peer.
4. **The macOS unit files.** `src/services/files/service.test.ts` is among the files `scripts/darwin-unit-files.sh` lists; its guarded cases, old and new (the swaps under `O_NOFOLLOW_ANY` with a claimed caller, the private folders of the listing where they rest on the platform), run in the Mac lane.
5. **Class 1a**, once, when the branch is complete: `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6f`.
6. **The branch review** (Decision Log 4): the panel, the authorization lens first.
7. **A member who is not an owner.** No scene drives one (the rig's org has one member). B10 rests on the endpoint's and the adapter's suites. If the architect wants it seen, it needs a second member in the scene's org with a `shell` grant and `MAWS_E2E_STEP_UP=accept`, which is rig work beyond this landing.
8. **The owner's look.** Before M4: Card 1's drawn chooser, with Cards 2 to 4. In a sitting with two machines: B1, B2, B3, B4's private folder on a real Mac (the one place a real privacy prompt can appear), B5 with a second member if there is one, and B9's drop.

## The pull request

Its body names its class 1a run, the review's verdict with what was dismissed or deferred, the two-machine run, the two runs with the older builds (or what stands in their place), which pairings were proved at the endpoint and the service alone, and its residue. It carries, dated, the rulings this landing changes where they stand (root UC-10, "The record"):

- **P5's Decision Log 277, amending 237**: written by the session that keeps master at the landing, not by this branch.
- **`docs/charter.md`, §19 (Decision log), one entry:** "2026-11-15 (owner; UX wave U6f): what the entry of 2026-11-14 allows on the machine that holds a session is allowed from another machine too, for a person who may open a terminal on that machine and for nobody else. The owner's answers: 'Open and edit there too' and 'Pick a file on that machine'. A file outside a session's folders there is read, chosen and saved over the machine link by acts that take the terminal's own offer row, decided by the same function; that machine's daemon alone reads the evidence and keeps the grant, refuses its own profile folder and app bundles, compares the real path at the save, and logs each such save and choice with the member and the time. A caller below that grade reaches what it reached before (P5 Decision Log 237, as amended by 277). This replaces 'never for a caller from another machine' of the entry of 2026-11-14 for such a person."
- **`docs/doperpowers/plans/2026-09-28-c8-right-panel.md`, at K1, one line under U6e's:** "Amended 2026-11-15 (UX wave U6f): for a caller from another machine under a claimed act of the terminal's offer row, `files.readOutside` and `files.writeOutside` reach one regular file outside the roots by the same evidence, `files.chooseOutside` records a grant, and `files.listOutside` lists one folder for the chooser; every other remote request takes what it took."
- **U6e's document, one line in its Decision Log** (written with this landing): "2026-11-15: U6f builds the owner's answers on another machine. Of the two places named for it, `remote` in `precheck` changed (a claimed act of the terminal's row reaches the outside rule); the router's refusal of `layout.openFile` for another machine did not: the chooser there is the page's, and `connectOpenFile` registers it."

`docs/tech-debt-tracker.md` gains: the step-up sheet lists a save's whole text among its signed fields (point 5); a chooser sitting for a member who is not an owner costs one confirmation per folder, with the exit (one confirmation covering a sitting, a design on the machine link; Card 4); a chat rooted at a machine's home, seen from another machine at the terminal's grade, has an empty Files list and labels its own files as outside (point 6); a terminal session on another machine has no files route (point 7); a file the daemon's user may not read can be chosen and its tab shows the service's refusal (point 12); a save whose answer was lost and which had landed meets the merge view with the person's own text on both sides (R5; the editor's, not this landing's); no scene drives a member who is not an owner.

What the pull request tells the owner, beyond the two answers: the chooser as built and the cards still open; that a file the agent sent from outside the folders on another machine is now read-only with a sentence for someone who may not use a terminal there, where it took typing and failed at Save; that nothing changes for a machine until it runs this build, and the item says so.

## Surprises & Discoveries

- Observation: a read graded above `view` cannot be a call, so a file's bytes at the terminal's grade must be an act's answer, and every executor keeps an act's answer.
  Evidence: `if (kind === 'call' && grade !== 'list' && grade !== 'view') return no('act-required')` in `src/endpoint/authorize.ts`; `ledger.finish(opId, result)` in `src/services/machine-ops.ts`; `entry.result = { value: result }` and the compaction at open alone in `src/shared/host/op-ledger.ts`.
- Observation: `pty.spawn`'s row cannot be taken whole, because its executor is the pty host; everything the grading function reads of it can.
  Evidence: `const pty: OfferRow = { kind: 'act', executor: 'pty-host', target: 'machine' }` in `src/endpoint/offers.ts`; `row.executor` is read in `#command` only for `placing`, and in `actions.ts` to choose the ledger.
- Observation: the grading function asks a step-up of every `shell` act by a member who does not own the machine, so the terminal's row gives such a member one confirmation per act, where a terminal asks one per spawn and then streams.
  Evidence: `if (grade === 'shell') return !ownsMachine` in `src/endpoint/step-up.ts`; "step-up is the link's `if-asked`, so a non-owner with a `shell` grant confirms each" in `src/main/lane-b/remote-pty.ts`.
- Observation: a handler can tell a claimed act from every other remote request without reading the input.
  Evidence: `HandlerContext.op`, "set by `machine.op` for the run it claimed", and `remote`, "set by `mawsd`'s services front for the endpoint's dispatch alone, never from a request's args", in `src/shared/ipc/client.ts`.
- Observation: a remote viewer already reads a delivered file from outside the roots, and the tab then takes typing and fails at Save.
  Evidence: `if (admits && (await admitted?.(appSessionId, real0))) roots = [...roots, real0]` in `precheck`, with no test of `remote`; the viewer sends `named` for a session on this Mac alone, so the answer is unmarked.
- Observation: the page already holds the person's rights on a machine, so an item can say "needs the right to use a terminal" before anything is asked.
  Evidence: `rights: z.array(z.enum(MACHINE_RIGHTS)).optional()` in `src/shared/ipc/schema/machines.ts`; `RemoteStanding` reads `capabilities` and `owner` and not `rights` (`src/renderer/src/lane-b/remote-standing.ts`).
- Observation: a folder browser of another machine exists, with the rule for private folders this landing's chooser needs, and it cannot be the chooser's command.
  Evidence: `ownersCall` for `machine.folders.list` in `offers.ts` (the owners', at `list`); `entry.isDirectory()` alone, and `outside-home`, in `src/services/machine/folders.ts`; `FolderBrowser` in `src/renderer/src/sidebar/FolderField.tsx`.
- Observation: the step-up sheet has a sentence per action and lists every signed field, so a save confirmed by a member who is not an owner lists the file's text.
  Evidence: `sentenceOf` and `renderNamed` in `src/main/device/step-up.ts`.
- Observation: no rig starts the other machine from another build, so a real older endpoint is not staged by any group today.
  Evidence: `join(REPO_ROOT, 'out', 'main', 'mawsd.js')` in `e2e/support/profile-daemon.ts`; the header of `e2e/cross-build.spec.ts` stages one profile.
- Observation: a terminal session on another machine has no files route, and a web-cards device is held to four names.
  Evidence: "lane A's adapter takes only `laneA.*`" (`src/renderer/src/lane-b/remote-unavailable.ts`, `src/main/lane-a/remote.ts`); `WEB_CARDS` in `src/endpoint/authorize.ts`.

## Decision Log

1. **2026-11-15T01:28Z · The owner's answers** (from the dispatch, verbatim). Question: "On this Mac, a file from outside a session's folders will open and be editable (the landing now in work). For a session that runs on another machine, such as a second Mac, a link to a file outside that session's folders is refused today, and nothing outside its folders is edited there. What should happen on another machine?" Answer: "Open and edit there too (Recommended)". Question: "The new command Open File… (⌘O) shows a file chooser and opens the picked file beside the chat. When the chat in front belongs to a session that runs on another machine, what should Open File… do?" Answer: "Pick a file on that machine (Recommended)". The cards said: this comes as a landing after the one for this Mac; it is limited to a person who may already open a terminal on that machine; until it lands the menu item is unavailable for such a chat and says the session runs on another machine.

2. **2026-11-15 (UTC) · The conditions of the session that keeps master** (from the dispatch; they change P5's Decision Log 237, which that session amends as 277 at the landing). (a) Grade: reading and writing outside a session's folders over a machine link take exactly `pty.spawn`'s offer row (act, target machine), checked by the same grading function, not by a copy of its outcome. Reason, for the record: whoever may open a terminal there can already read and write any file the daemon's user can, so this adds no reach; if that row's grade changes later, this follows by construction. (b) Admission: that machine's daemon alone reads the evidence, by U6e's five-line rule. Nothing the calling device sends counts as evidence, and the grant lives on that machine. (c) P5's Decision Log 237 stays as it is for every caller below that grade: a remote viewer without the terminal grade still sees no files of a chat rooted at the machine's home, and a test holds that. (d) The chooser: the same grade. It may list files and folders anywhere the daemon's user can read (beyond what New chat's folder browser lists; fine at this grade). The pick is recorded as a grant by that machine's daemon, not by the caller. (e) The refusal of MAWS's own profile folder and app bundles and the real-path pin apply on that machine as in U6e. (f) Each remote write outside the folders is logged in that machine's own daemon log with the member and the time; the path stays out of the hub. (g) New offer rows for the remote open, list and save, so that an older endpoint (`f1852de3a`, `2c7044231`) leaves the items unavailable and never mis-answers. (h) Review of the build: reviewer-high with an authorization lens, or the panel if the change passes about twenty files. "The conditions" names the place and the test of each.

3. **2026-11-15 (UTC) · The architect's ruling after U6e's last revision, which binds here too.** For a save, "the transcript names the path" counts a `user` row's text only when the person wrote it; a peer session's message and a notification row admit nothing, like a tool's result. It is U6e's to build ("Reported" 17 there); on another machine the same search decides, so nothing here adds to it ("Statements to check again" 7).

4. **2026-11-15 (UTC) · The verification call** (the author, at authoring). This document gets an adversarial review before an executor starts (the architect dispatches it). The branch gets the `doperpowers:review-code` panel (xhigh): condition (h) asks for reviewer-high with an authorization lens, or the panel past about twenty files, and the change is about eighty files and 5,700 lines, two thirds of them tests and scenes. The lenses: (a) **authorization, first**: the four rows against `pty.spawn`'s and the differential; that no code copies the grading's outcome; the claim as the one thing the services act on, read where the act runs; every remote request without a claim, to the byte; the web-cards class, a call, a stream; the standing as drawing only; (b) the boundary on the other machine: U6e's `precheck` with a claimed caller, the roots less the home, `own()`, the real path at the save, the listing's walk and what it touches in a private folder; (c) evidence: that nothing of the input admits, the choice as the one act that begins a grant, `files.grant` unreachable from a link; (d) the ledger and the log: what each keeps of a file's bytes and path, one run per save, the hub; (e) the device: decision 5's order, what is sent to a peer without the capability, no link, the pending bound, the guard's names; (f) the two older builds, in both directions; (g) the window: no save but on a press, no `files.write` for a pin, no automatic read that asks a confirmation, the chooser's sequences; (h) the public repository: fixtures and scenes hold nothing of the owner's. Each milestone's own review is the controller's at its boundary; M1 and M2 carry the authorization and are read with lens (a). Class 1a on GitHub Actions is the gate of record.

The decisions as they stand are in "Decisions settled at authoring", each with what it beat. Entries below this line record what moves after.

## Outcomes & Retrospective

Pending — written at finish.
