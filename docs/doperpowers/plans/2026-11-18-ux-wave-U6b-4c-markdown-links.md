# UX wave · U6, landing U6b-4c: a link inside a shown Markdown file, and in a subagent's transcript

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*): in its item "O-37 · a linked file opens in MAWS, and a refusal says why", the paragraphs "What became of U6c's list for U6b's design" and "The two links of a shown Markdown file and of a subagent's transcript (answered 2026-11-18 (UTC))". Board ticket 673.
>
> **Where this landing comes from:** U6b-4b's document (`docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md`, cited below as *U6b-4b*), its section "The two links" and its point P1, left both links to a landing of their own with the reasons a design must answer. The outside-file rules it stands on are U6c's (`docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md`) and U6e's (`docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md`), cited by those names.
>
> **Parent pin:** `c0e4555f4`, the head of `ux-wave/U6b-4b` when this was written: the code of `ux-wave/U6b-2` (`eb7f378ee`, master `bf0b3d2a4` plus U6b-2) and U6b-4b's document, not yet built. Every statement about the code below was checked against that code. Revision 2 was written on `f3568e398` of that branch, merged here, which holds U6b-4b's first milestone (the rule's three repairs). The root and the child's file are read on the branch `ux-wave-spec` (`5615f136f`), which holds the owner's two answers of 2026-11-18.
>
> **Revision 2 (2026-11-18).** The adversarial review of the first writing (`9d8b0216f`) returned fifteen findings, nine of the first rank; each was checked in the cited code and all are accepted (Decision Log 2). The design stands: one command at the click, then a record the daemon keeps. What moved: a relative link is proven against the folder the daemon confirmed, not the spelling the window sent; the target is resolved after the proof, not before; a subagent's file is opened with no link on its way; a source MAWS never writes gives no save; the wire gains an optional property in place of a new enum value, which the wire's own rule calls breaking; every costly step waits for its slot first and the follow has one deadline; a read sent before the click is read again after the follow; R1 says what a faulty page can do, which is more than the first writing said (Q3); four more points are reported.
>
> **Revision 3 (2026-11-18).** The delta review of revision 2 (`2f753d03a`) found nine things, six of the first rank, and judged the first review's fifteen answered or answered in part; each was checked in the cited code and all are accepted (Decision Log 5). The design and the owner's two answers stand. What moved: the session's own folder is inside the no-link check of a subagent's file; a link record answers this machine's own caller alone, also on a head that holds U6f, where a claimed caller of another machine reaches the evidence; a subagent's search is joined only by a request bound to the same transcript; every follow is counted before its first file system call; the deadline says what it does not promise; the target's proof is the last resolution, as a grant's is, and its tests are placed where the order makes them fail; the window reads again by a count of follows, not by a callback; the rule's reader hands the service a link's written path; a record's `from` is the source of the strength it has.
>
> **Revision 4 (2026-11-18), the last on the document.** The narrow read of revision 3 (`8ef361278`), confined to the six first-rank passages and the replacement of `followed`, found one thing of the first rank and four of the second, and judged the passage on another machine's caller to hold; all five are accepted (Decision Log 7). What moved: a subagent's file is a source only where an open can be confirmed to have followed no link (`OPENS_CONFIRMED`); a refused read that lands while a follow is still under way waits for it before it compares; the window shares a subagent's follow only under one engine session; a follow keeps its place until its locator has answered; X5.10 names the subagent's hook and outcome. What this revision leaves is the branch panel's.
>
> **Branch:** `ux-wave/U6b-4c`, cut from `ux-wave/U6b-4b`. **This landing is built on U6b-4b as built**: it consumes that landing's `resolveRelative`, `OpenFileOptions.base`, the `artifactView` prop and the notice (its Interfaces §B and §C) by those names. "Statements to check again" lists what to read on the head it is built on. This document carries the design the two links needed, the constraints and the milestones.

## Purpose

A Markdown file shown in MAWS is full of links: to the file beside it, to a file in another folder. So is the transcript of a subagent, which the person reads in its drill-in. Today a click on such a link opens the file only when it is inside the session's folders, or when the session's own transcript happens to write the same path. Otherwise the tab reads that the file is outside the folders, although the person is looking at the text that links it.

After this landing, on this Mac: a link in a shown Markdown file opens the file it names, wherever it is, editable, written only when the person presses Save; a relative link in a Markdown file that itself stands outside the folders opens the file beside it; a link or a file chip in a subagent's transcript opens by the rule the session's own transcript has. The tab comes back after a relaunch and still saves. What decides is still the daemon alone: the window says where a link stands, and the daemon reads that file itself and finds the link, or opens nothing.

How to see it working: in a session on this Mac, open a Markdown file of the session's folder whose text holds `[notes](/<a folder outside>/notes.txt)`. Click the link: the file opens beside the chat; type, press ⌘S, and the file on disk holds the change. Quit and relaunch: the tab is there and saves again. Open a subagent's drill-in whose text links a file outside the folders and click it: the same. Acceptance K1 to K14 below is the whole list.

## Progress

- [x] (2026-11-18) U6b-4b's P1, the child's paragraphs, U6c's and U6e's documents and the code read against the pin; the design made; the document written.
- [x] (2026-11-18) The adversarial review of the first writing (`9d8b0216f`): fifteen findings, all accepted; revision 2. `ux-wave/U6b-4b` merged at `f3568e398`.
- [x] (2026-11-18) ux-wave's rulings on Q1, Q4 and Q6 to Q17 (Decision Log 3).
- [x] (2026-11-18) The owner's answers on Q3 and Q2 (Decision Log 4). No answer is owed before M4, or before any milestone.
- [x] (2026-11-18) The delta review of revision 2 (`2f753d03a`): nine findings, all accepted; revision 3 (Decision Log 5). Its verdict on revision 2 was "do not dispatch"; revision 3 has not been read by a reviewer.
- [x] (2026-11-18) ux-wave's rulings on Q18 and Q19 (Decision Log 6).
- [x] (2026-11-18) The narrow read of revision 3 (`8ef361278`): five findings, all accepted; revision 4 (Decision Log 7). Its verdict on revision 3 was "do not dispatch", for the one first-rank finding; revision 4 answers it and is read by no reviewer: by ux-wave's ruling this was the last round, and the rest is the branch panel's.
- [x] (2026-11-19) M1 — The rule reads a Markdown file's links and a subagent's records. Reviewed clean after one fix round (`579496c5e`..`11c7c8438`).
- [ ] M2 — The record, the command, and a Markdown file as the source.
- [ ] M3 — A subagent's transcript as the source.
- [ ] M4 — The window follows.
- [ ] M5 — The scenes, the older builds, the record, and the acceptance run.

## Words used in this document

- **Build F, build M.** The two older builds that bind (root UC-14): build F is `f1852de3a`, kept as the build to go back to; build M is `2c7044231`, the build in use. Both are read with `git show <sha>:<path>`.
- **The daemon.** The background process that reads and writes a session's files for the window (`src/services/files/`, registered in `src/services/checkouts-root.ts`, wired in `src/services/spine-root.ts`). Main and the window never read a session's file themselves.
- **The folders.** The folders a session may read: its roots as `rootsOf` gives them (`src/services/files/allowlist.ts`).
- **The evidence.** What admits one file outside the folders for one session, decided by the daemon in `precheck` (`src/services/files/service.ts`, `firstEvidence`): the person chose it in the system's chooser (a **grant**, `src/services/files/grants.ts`), the agent sent it, the session's transcript names it, or the Library holds it. The first that holds is the file's **mark**.
- **The rule.** U6c's rule of what a transcript names: `src/shared/files/named.ts`. `clickPath` reads one link destination as the click reads it; `linkSteps` finds the destinations in a text as the window's Markdown draws them; `rowClaimSteps` applies them to one transcript record.
- **A counted form, a result form.** U6e's two classes of a name: a person's own message, the agent's own text and a tool call's input are counted, and admit a read and a save; what a tool returned, or a message someone else wrote, is a result form and admits a read only.
- **The search.** `src/services/files/named.ts`: `names(appSessionId, path)` reads the session's transcript backwards for a record that names the path. One search runs at a time for the whole daemon, eight may wait, a waiter's patience is 8 s.
- **A shown Markdown file.** A file's tab whose body is drawn as rendered Markdown: `MarkdownView` (`src/renderer/src/tools/code/viewer/MarkdownView.tsx`), for a file the viewer's `kindOf` calls `markdown` (a name ending `.md`, `.mdx` or `.markdown`, text, at most 1 MiB).
- **A subagent's transcript, a drill-in.** A session's child agent writes its own records to `<session>/subagents/…/agent-<agentId>.jsonl` beside the session's transcript. The window draws them with the same `Transcript` component, `variant="child"`, in three places: the Agents tool's drill-in (`tools/agents/subagents/DrillIn.tsx`), a main tab of the agent (`transcript/view/TranscriptSlot.tsx`), and the drill-in of a session on another machine (`lane-a/view/RemoteAgentTranscript.tsx`).
- **A follow.** This landing's new act: the window asks the daemon to look, in a file it names or in a subagent's transcript it names, for a link to one path, and to remember what it finds. The command is `files.follow`.
- **A link record.** What the daemon remembers of a follow that found the link: one real path, for one session, with the time, and whether the file may be saved. Kept in `<profile>/sessions/file-links.json`.
- **The differential.** `src/renderer/src/tools/code/named-links.test.tsx`: it draws strings with the window's own Markdown, clicks every chip, and holds that what a chip asks for is among the rule's paths, and (over seeded strings) that every path the rule names is a chip the window draws.

## The landing's edge

**In.**

1. A link in a shown Markdown file, absolute or relative, to a file outside the folders: it opens, editable, saved by the person's Save (the owner's first answer of 2026-11-18).
2. The same where the Markdown file itself stands outside the folders: a relative link resolves against that file's own folder (the owner's second answer; the resolution itself is U6b-4b's).
3. A link, a read's or an edit's chip, and an anchored comment's chip in a subagent's transcript, in all three places it is drawn for a session on this Mac: it opens by the rule of the session's own transcript, read over that subagent's file (the owner's answer of 2026-11-15, "the same rule").
4. The record that makes 1 to 3 hold again after a relaunch, with nothing added to a stored tab.
5. One new command of the files service, `files.follow`, and one new optional property in a read's answer (`outside.linked`), with the wire's next minor.
6. One sentence for a file that opens read-only because the file that links it is read-only (Q2).
7. The records this loosening owes: a dated entry in the charter's §19 and a dated line at K1 in C8's document (`docs/doperpowers/plans/2026-09-28-c8-right-panel.md`), as U6c and U6e each wrote theirs.

**Not in, and whose.** A session on another machine: no follow is sent for it, and what opens there is what U6f's rule opens (Q6). A File artifact's Markdown view: U6b-4b leaves its relative links unresolved, and it follows nothing. A link in a side question's answer, in a mod's own text and in a tool result the window draws as "generic": each keeps U6b-4b's rule R4 (no evidence), for the child's reason: none is a file or a transcript the daemon can read for the link. An image written in a Markdown file (`![…](pic.png)`), which the window draws as a chip that names its source and opens nothing. A link with a heading's fragment (`[x](#usage)`, `[x](guide.md#usage)`), which the window reads as a file name: it stood so before this landing and is reported (Q5). The notice's sentences (U6b-4b's). A listing, a watch or Reveal of a folder outside the folders (the child's "Not included"). The subagents of a conversation the session has left behind with `/clear`.

## What the code holds today (at the pin)

- **The evidence, in order.** For a request of this machine that carries `named: true` (and for every outside save), `firstEvidence` asks: a grant (`grants.has`, skipped when the request carries `agent: true`); the agent's delivery (`sent`); the search (`named`), where a counted form answers the mark `named`; the grant once more, since the search awaits; then, for a request that is no save, a result form (`result`) and any other record of the Library (`added`). A read answers `named: true` and `outside: { real, writable, why? }`, `why` being `result` or `added` for the two marks that admit no save. A request from another machine never reaches the question (`!remote`).
- **A grant is main's alone.** `files.grant` is in `MAIN_ONLY_COMMANDS`; main sends it once, after the system's chooser answered (`src/main/files/open-file.ts`). The grants are `<profile>/sessions/file-grants.json`, `{ version: 1, sessions: { <id>: [{ real, at }] } }`, at most 256 a session, written whole and atomically before memory changes, dropped when the session's record is removed (`followView`). Neither build F nor build M has `grants.ts`; each names `sessions/intents/`, `sessions/bootstraps/` and `sessions/uploads.json` in that folder and no other entry (U6e's document, its Surprises, M1).
- **The outside save is the app window's page's alone.** `guardCommand(['files.writeOutside', 'layout.openFile'], appPageOnly(appUrl))` in `src/main/app.ts` refuses every other asker before anything is forwarded; `files.writeOutside` has a row in `REMOTE_UNAVAILABLE` (`src/shared/ipc/remote-unavailable.ts`) and none in the endpoint's `OFFERS`.
- **The search reads one file per session.** `createNamedPaths({ transcript })` is given a locator that answers the path of the session's own transcript (`spine-root.ts`: the index's `transcriptPath` when it is the record's engine session's file, else where the engine writes it). A job's key is the session, that path and the asked path; what it remembers (`entries`, at most 256) is keyed by the session and the asked path, and rests on the file's identity. Nothing reads a subagent's file.
- **A session can have thousands of subagent files**, directly under `<session>/subagents/` or up to three directories deep (a workflow run's are under `subagents/workflows/<runId>/`): `src/engine-host/fs/subagents.ts` (`MAX_DEPTH`; the tracker's row of 2026-10-31 measures a tree of 4,000). The session's folder is its transcript's path without `.jsonl` (`test/fixtures/transcripts/` holds one such pair).
- **A subagent's records carry no origin.** In the recorded fixtures every record of a subagent's file has `isSidechain: true` and no `origin`; its first `user` record is the prompt its parent wrote. `rowClaimSteps` counts a `user` record's text only when `personsOwn` holds (`origin.kind === 'human'`), so by today's reading a subagent's `user` record is a result form (`other`), and its `assistant` records (text, a tool call's input) are counted.
- **The window's click in a child's transcript asks for the parent session.** `useRowSession` (`transcript/view/context.tsx`) cuts the agent's id off the store key `<appSessionId>:<agentId>`; every click source calls `actions.openFile(path, line, session, options)`, and `codeTranscriptActions.openFile` (`tools/code/open-file.ts`) opens it for that session. The agent's id is in the mount's `source.agentId` (`Transcript.tsx`) and reaches no click.
- **A shown Markdown file's click** is `MarkdownView`'s own `openFile`, bound to the entry's session; nothing says which file the link stood in. The same component draws a File artifact's Markdown (`DrawnFile` in `tools/artifacts/viewers/ByteViewer.tsx`).
- **Which files are drawn as Markdown is decided in the window alone**: `MARKDOWN` (the three extensions) and `MARKDOWN_RENDER_CAP` (1 MiB) in `tools/code/viewer/kinds.ts`. The text drawn is the read's `content`, decoded by the daemon (`chunk.toString('utf8')` in `readOpened`).
- **Only a session on this Mac asks by name.** `readChunk` (`viewer/viewer-store.ts`) sends `named: true` when `machineOf(appSessionId) === client.localMachine`, and `agent: true` beside it while the entry holds the mark of an open the agent asked for. The first `files.read` of a tab decides its kind; a frame, "Open externally" and a save come after it.
- **A stored file tab holds nothing to put a source in.** A main tab of kind `file` is the strict object `{ id, kind, path, line, appSessionId, pinned }` (`FileTabV2Schema`, `src/shared/ipc/schema/layout.ts`), to which root UC-14 lets no field be added. A Files tab beside the chat holds `{ file, line, preview?, agent? }` under `panelTools.params` (`tools/code/files/tabs.ts`).
- **A file that cannot be saved says why.** `ViewerEntry.locked` is `'maws' | 'added' | 'result' | null`, from the read's `own` and `outside.why`; `readOnlyReason` and `EDITOR_COPY.readOnly` (`tools/code/copy.ts`) turn it into the label's sentence.
- **A new command has a known footprint.** `files.writeOutside` is named in: `src/shared/ipc/schema/files.ts`, `names/files.ts`, `grades/files.ts`, `routes.json`, `wire.ts` (the minor's comment), `wire-manifest.json`, `remote-unavailable.ts`, `src/shared/machine/address-paths.json`, `src/services/files/register.ts`, `src/main/app.ts` (the guard), `src/renderer/src/test-support/code-disk.ts` (the suites' fake disk), and the tests `src/shared/ipc/schema.test.ts`, `src/main/daemon-root.test.ts`, `test/support/spine-lists.ts`, `test/endpoint/checkout-rows.test.ts`, `test/lane-b/renderer-guards.test.ts`, `test/cross-build/files-schema.test.ts`, `e2e/support/cross-build-samples.ts`. The wire's minor is 53 at the pin.
- **The wire's rule calls a new enum member breaking.** `src/shared/ipc/wire.ts` (its header): within a major a change is a new command, a new event, a new optional property or a new capability; "an added enum member included" takes a major, since an older reader refuses it, and `wire.test.ts` writes no minor manifest for one.
- **The guard is main's router's.** `appPageOnly` runs in main, before a command is forwarded. The daemon's own front (`src/mawsd/front.ts`, `serve`) answers a local client of its socket with the registered handler and no such guard; that is so for `files.writeOutside` today.
- **A page can write a file of the folders.** `files.write` saves over an existing file inside the roots, and `files.upload` stores bytes the caller gives under the session's working folder and keeps a usable extension (`src/services/files/upload.ts`). Both are bridged.
- **The older windows' side tab is the tree.** In both older builds the Files surface reads `params.path`, not `params.file`, so a tab beside the chat that holds a file is drawn there as the Files tree; a main `file` tab is drawn as a file tab.
- **The host forgets a request after its time-out and does not stop the handler** (`REQUEST_TIMEOUT_MS`, `src/shared/host/host-supervisor.ts`); `endOf` in `register.ts` ends with the client, not with the request.
- **U6b-4b's first milestone, as built on this branch** (`f3568e398`): the rule refuses a text that holds a carriage return no line feed follows, passes over a leading byte order mark, and reads a table as the window's tokenizer does.
- **A fragment is part of the file's name.** `clickPath('guide.md#usage')` is `guide.md#usage`, and `clickPath('#usage')` is `#usage`: only `#L<n>` and `:<n>` are cut off as a line.

## The design: the daemon records a followed link

**What had to be answered.** U6b-4b's P1 gave four reasons the two links were no small addition. The daemon cannot find the Markdown file by itself, so it must be told; told on the request, every later read of the same tab needs the telling again (shown again, restored, drawn in a frame, opened outside MAWS, saved), which is a key on four commands and a value stored with the tab, and a main file tab may store none (UC-14). And a session's subagent files are too many to search at every click.

**The answer.** The telling happens once, at the click, and what the daemon found is the daemon's to keep.

1. A click on a link in a shown Markdown file, or in a subagent's transcript, sends one new command before the tab's first read: `files.follow`, with the session, the path the click asks for, and where the link stands: `{ file: <the Markdown file's path> }` or `{ agent: <the subagent's id> }`.
2. The daemon checks the source itself. For a file: it admits and opens the Markdown file for that session exactly as a read of it would, reads its text through that descriptor, and looks for an inline link whose path, read as the click reads it, is the path asked, and which, resolved against the folder the daemon itself confirmed the file in, leads to the same file. For a subagent: it finds that agent's file under the session's own transcript folder and runs the search over that one file. The window's word is only where to look.
3. When the link is there, the daemon writes a link record for the file's real path and the session, in a file of its own in the profile. From then on the file stands admitted as a chosen file does: every later request finds the record in `firstEvidence`, with no key that says where it came from. The read, the frame, "Open externally" and the save are the commands they were.
4. The tab stores what it stored: a path. After a relaunch its read asks by name as every read of this Mac's does, and the record answers.

So the stored-tab problem has an answer inside UC-14: nothing is added to a tab, to `main.tabs`, to the stored side surfaces or to a settings file, and the one new stored thing is a profile file neither older build names, as U6e's grants file is. The subagent search has one too: the request names one agent, one file is searched, in the search's one slot and under its bounds, and the answer is kept as a record, so nothing is searched at a later read.

**Why this, and what lost.**

| the alternative | what it is | why it lost, or what it would lose |
|---|---|---|
| a key on every read, and the source stored under a layout key of the window's own | UC-14 allows a new layout key (a map from session and path to the source) | four commands gain the key (`files.read`, `files.openExternal`, `files.writeOutside`, the frame's ask); the daemon reads and scans the source again at every chunk, or keeps a cache it must prove; the window holds a fact the daemon needs at every save |
| a hint the daemon keeps and proves again at every read | the record holds the source, and each read checks the link is still there | a file linked through two Markdown files needs the first proven to prove the second, at every read; a tab restored after the linking file changed reads as refused with a sentence that no longer says why; it stops nothing more than the record does, since what it re-reads is the same file the same page could name |
| the daemon finds the source itself: it remembers which Markdown files it served to the session | no command, no minor | "served" is not "shown" (Review, the Source view, the agent's own open read files too); the memory goes with the daemon while the tab stays; nothing of it works for a subagent, whose records another process serves |
| a record kept in the daemon's memory alone | the same design, with no file | the smallest scope if the stored record is ruled out: a link opens and saves, and after the daemon restarts the tab reads as outside the folders until the link is clicked again; an edit held across that restart cannot be saved until then. One place changes: `openFileLinks` is given no file |
| a followed link written as a grant | no new store | U6e's sentence "a grant is made by main alone, after the system's chooser" would stop being true of that file's entries, and a record that admits a read only has no place in it |
| every subagent file searched at every click | no key | the search's bounds: thousands of files, one job, 8 s |

**What the design costs.** One command and one wire minor, so two cross-build runs (root UC-10); a profile file; and one sentence. A followed link is remembered: the record outlives the text that linked it, as a chosen file's grant outlives the chooser (Q1). And the proof the daemon makes is of what a file holds, not of who put it there (R1, Q3).

## The trust rules

This landing widens what opens from outside the folders. Each rule is stated with what it leaves alone and the cases that must stay refused. Every such case is a test in the file named, with its control in the same test: the same request, admitted where the link is there.

### R1 · Who may ask, and what the asking is worth

**The rule.** In main's router `files.follow` is answered only for a live page of the app's own window (`appPageOnly`, the guard `files.writeOutside` has), never for a caller on another machine (the service refuses `remote` itself, where the act runs, and the endpoint offers the command to no machine), and only for a session the daemon knows. The guard's reach is the outside save's and no wider: a local process that speaks to the daemon's own socket is not behind main's router, for this command as for that one (Q14). What the request says is a place to look. It is no evidence: a request that names a file that does not hold the link, or an agent whose transcript does not, changes nothing and learns nothing but "not linked".

**What it does not stop, said plainly.** The daemon proves what a file holds. It cannot know that a person clicked, and it cannot know who wrote the link. A fault in the app window's own page could follow, unseen, any link that stands in a Markdown file the session may read or in one of its subagents' transcripts, and then read that file and save over it. And it need not find a link: the same page may save over a Markdown file of the folders (`files.write`) or upload one (`files.upload`), so it can write the link first and follow it next. The reach of such a fault is therefore any regular file the daemon's user can read, and for a save any such file the outside save itself would write (a text within its size bound, that the user may write, outside MAWS's own folders), in a session that has, or can be given, a Markdown file. That reach is not new: U6c's ruling already says its check "does not stop a caller that can also send a message into that session, which could write the link first", and the page can send one. What is new is the trace. A link written into a message stays in the transcript, where the person sees it; a link written into a file leaves a changed or new file on disk and the record, and nothing in the conversation. So the record keeps where each link stood (`from`, Interfaces §B), and every record written is one line of the daemon's log (the session and the time, no path). Whether that is enough, or a follow that opens a file outside the folders needs an act main can attest (a confirmation main draws, once per session or per file), was put to the owner (Q3), who answered on 2026-11-18: "(a) record and log only". No confirmation is built, and no read-only fallback.

**Stays refused, as tests.**

| # | the case | must be | test file |
|---|---|---|---|
| X1.1 | `files.follow` asked by main itself, by a presentation window's page, and through `dispatchLocal` | `forbidden_sender`; no record | `src/main/daemon-root.test.ts`, `src/main/files/open-file.route.test.ts` |
| X1.2 | `follow` called with `remote` true, for a link that is there | the service's refusal; the links file untouched. Control: the same call, not remote, records | `src/services/files/service.test.ts`, `src/services/files/register.test.ts` |
| X1.3 | the endpoint's offers | hold no row for `files.follow`; `REMOTE_UNAVAILABLE` holds one | `test/endpoint/checkout-rows.test.ts` |
| X1.4 | an unknown session; a relative `path`; a `path` that is not lexically normal or ends in a separator; a `path` longer than `NAMED_PATH_MAX` bytes; an `agent` that holds `/`, `.` or 129 characters | the first two fail as a read does (`unknown app session: …`, `path must be absolute`); the next is the refusal; the long path is `not-linked`; the agent is refused at the schema, before the service | `service.test.ts`, `src/shared/ipc/schema.test.ts` |
| X1.5 | a follow for a path the source does not link, then a read of that path with `named: true` | `not-linked`; the read is refused with the refusal sentence; `file-links.json` is not written | `service.test.ts` |
| X1.6 | a record written by a follow | holds `from` as the request gave it, and the log holds one line with the session's id and no path | `service.test.ts`, `links.test.ts` |

### R2 · The source is admitted as a read admits it, and the daemon reads it itself

**The rule, for a file.** The daemon opens `from.file` by the read's own boundary (`openConfirmed`, for that session, as a person's request that asks by name: `named: true`, no `agent`), so the source is a file the session could show: inside the folders, or outside them with evidence of its own, a link record included. It then reads the text from the descriptor it confirmed, never again by path, and keeps the real path that open confirmed: R3 resolves a relative link against that file's real folder. Three things make the source a Markdown file the window draws as one, by tests the window and the daemon now share (Interfaces §A): its name (as the request gave it) ends `.md`, `.mdx` or `.markdown`; the file is at most `MARKDOWN_RENDER_CAP` bytes; and the daemon's own reading calls it text (the same `fileMime` and `isTextMime` that give a read its `utf8` encoding). The text is decoded as a read decodes it. A file the window would show as code, as a head or as a row links nothing.

**The rule, for a subagent.** The daemon finds the file, and opens only a file that is where it looked. It takes the session's own transcript path from its locator (the one the search uses), takes the real path of the folder that holds that transcript (the engine's folder for the project), and in it the folder named as the transcript without `.jsonl`, which must be a directory itself and no link: resolving through that name would let a link there stand another session's folder in its place. Under its `subagents/`, again a directory itself, it looks for `agent-<id>.jsonl`, in that folder or at most three directories below it. The walk reads directories alone and passes over every entry it sees as a link: an entry counts as a folder only when it is a directory itself, and as the file only when it is a regular file itself. The walk is how the file is found, not what makes it safe: a folder can be replaced by a link between two of its reads. The authority is the open. Exactly one such file is the source; none, or two, is `not-linked`. It is then opened with no link anywhere on its way (the open the files service uses, `../fs/no-link`), so a folder swapped for a link between the walk and the open is refused, and the descriptor must be a regular file. That holds only where an open can be confirmed to have followed no link (`OPENS_CONFIRMED` in `src/services/fs/no-link.ts`: always on macOS; on Linux only with `/proc/self/fd`, without which `confirmOpened` checks nothing). Where it cannot, a subagent's file is no source at all: not linked, nothing opened. The window never names a transcript's path.

**What it leaves alone.** What the Markdown file's tab shows and what the daemon reads can differ: text typed and not saved, or a file changed on disk since it was drawn. The daemon's reading decides, so a link that is only on the screen opens nothing, and a link the person did not see can be followed only by a request that asks for exactly that path (R1).

**Stays refused, as tests** (`src/services/files/service.test.ts` unless named).

| # | the case | must be |
|---|---|---|
| X2.1 | `from.file` outside the folders, with no evidence for it, holding the link | `not-linked`; no record. Control: the same file once the person chose it |
| X2.2 | `from.file` named `notes.txt`, `README` and `guide.md.bak`, each holding the link text | `not-linked` |
| X2.3 | a `.md` file of 1 MiB and one byte holding the link in its first line; a `.md` file whose first bytes hold a NUL | `not-linked`. Control: the same link in a file of exactly 1 MiB |
| X2.4 | `from.file` that ends in a symlink to a Markdown file inside the folders; `from.file` not lexically normal | `not-linked` (the read's own refusal), no record |
| X2.5 | at the suite's `before-open` hook: a folder on the source's way swapped for a link to a folder that holds a file of the same name with the link in it; and the source replaced by a regular file without the link | the first is refused by the read's boundary: `not-linked`. The second is read as it now is: `not-linked`, because the text read is the new file's. Control: replaced by a regular file that holds the link, `linked` (what is on disk decides) |
| X2.6 | a session with two files `agent-<id>.jsonl` under `subagents/` in different directories; an id with no file; a file four directories down | `not-linked` (`src/services/files/named.test.ts`) |
| X2.9 | each with a record that would otherwise count: the session's own folder (the transcript's name without `.jsonl`) that is a link to another session's folder; `subagents` that is a link to another session's `subagents`; a folder under `subagents/` that is a link; `agent-<id>.jsonl` that is a link to another session's agent file; a folder on the way swapped for a link after the walk found the file (the suite's hook between the walk and the open) | `not-linked` for each (`src/services/files/named.test.ts`). Control: the same file reached with no link, the session's folder an ordinary directory. Two more: with `OPENS_CONFIRMED` false (mocked, as `src/services/files/upload-unconfirmed.test.ts` mocks it) every agent source is `not-linked` and no file is opened; and, where the platform walks (`WALKED`, Linux), a folder swapped for a link between the open helper's own walk and its open is refused by the descriptor's own path |
| X2.7 | an agent's file of another session's transcript folder, asked under this session | `not-linked`. Control: asked under its own session, `linked` |
| X2.8 | a session whose locator answers no transcript, asked with `from.agent` | `not-linked`, and nothing is read (M3) |
| X2.11 | a subagent's search held open (the `opened` hook); the session bound to a new transcript (`/clear`); a second follow for the same agent id and path | the second does not join the first: it is answered from the new transcript's folder (`not-linked` where that folder has no such agent), whatever the first then answers (`src/services/files/named.test.ts`) |
| X2.10 | a Markdown file under MAWS's own folders, inside the session's folders and outside them once chosen, linking a file outside | `linked`, and the record admits no save (R4). Control: the same file outside MAWS's folders gives a save |

### R3 · A link is read as the click reads it

**The rule.** A link of a Markdown file must pass two tests, and the second is the one that gives it authority.

*The click's reading.* The paths the text links are `fileLinkSteps(text, base)` (Interfaces §A): each path `linkSteps` yields, resolved by `resolveRelative(base, path)`, with `base` the folder of `from.file` as the request gave it, lexically. That is the window's reading to the letter: U6b-4b's `MarkdownView` resolves a relative chip against `dirname(entry.path)` with the same `resolveRelative`, which this landing moves into the shared rule so that both sides hold one copy, and `from.file` is `entry.path`. The path asked is compared with each, whole, byte for byte.

*The daemon's own folder.* The spelling of `from.file` is the window's word, and a relative link resolved against a spelling would let the asker choose what the link means: the read's boundary admits a source by its real path and refuses a link only in its last component, so the same admitted file can be named through a folder that is a link, and `../x` then leads beside that link, not beside the file. So for a link that passed the first test the daemon resolves the same written path against the folder of the source's confirmed real path, takes the real path of the result, and requires it to be the real path of the file asked for. An absolute link passes by construction; a relative one passes exactly when both spellings lead to one file (`/tmp/…` and `/private/tmp/…` do; a folder reached through a link whose parent is elsewhere does not, and such a link opens nothing).

So everything U6c proved of a link's reading holds here with no second proof: a link in a code fence, in inline code, in `$$` math, as an autolink, as a reference, in a table cell the window does not draw, with a character reference or a letter written as `%XX`, links nothing. The `file:` form is U6b-4b's, through the same `clickPath`.

For a subagent, the rule is `rowClaimSteps` on each record of its file, as on the session's: the link form, the chip of a read or an edit, an anchored comment's path, results waiting for their calls.

**A relative link can lead anywhere, and that is the answer given.** `[x](../../<elsewhere>/secret.md)` in a shown Markdown file resolves to an absolute path, and the daemon finds the same. The owner's second answer opens the file beside an outside Markdown file "by the same rule", and an absolute link in the same file could name the same path. U6b-4b's rule that a relative link *in the transcript* names nothing is untouched: the transcript has no folder.

**Stays refused, as tests.**

| # | the case | must be | test file |
|---|---|---|---|
| X3.1 | a Markdown file whose text holds the path in prose, in a code span, in a fence, as `<…>`, as a reference `[x][l]`, in the third cell of a row under a two-cell head, and as an image `![x](…)` | `fileLinkTargets` holds no such path; the follow is `not-linked`. Control: the inline link | `src/shared/files/named.test.ts`, `src/services/files/service.test.ts` |
| X3.2 | a Markdown file outside the folders, admitted by the person's choice, at `/out/docs/guide.md`, holding `[x](sub/a.md)`; every target exists and is outside the folders; asked for `/out/sub/a.md` and for `/out/docs/sub/b.md` | `not-linked` for both. Control: `/out/docs/sub/a.md`, `linked` | the same two |
| X3.3 | the path asked differs from the linked one in letter case, or in Unicode normal form | `not-linked` | `service.test.ts` |
| X3.6 | one Markdown file under two spellings: its real path `/out/real/docs/guide.md`, and `/out/alias/docs/guide.md` where `/out/alias/docs` is a link to `/out/real/docs`; it holds `[x](../secret.txt)`; `/out/real/secret.txt` and `/out/alias/secret.txt` both exist | asked with the alias as `from.file` for `/out/alias/secret.txt`: `not-linked`, no record. Controls: asked with the real spelling for `/out/real/secret.txt`, `linked`; and a file under a folder whose two spellings have the same parent (the suite's temporary folder, by its real path and by its path through the system's alias where the platform has one) is `linked` under either | `service.test.ts` |
| X3.7 | a `.md` file whose lines end in carriage returns alone, a link in a block the window draws as code; a `.md` file that begins with a byte order mark and then an indented code block holding a link | `fileLinkTargets` names nothing for the first (the text is refused whole) and not the link for the second; the same text drawn by `MarkdownView` draws no chip for either. Control: the same texts with line feeds, and with the mark before prose | `src/shared/files/named.test.ts`, `named-links.test.tsx` |
| X3.4 | the differential, for a file | M1: for the fixed rows the differential already holds as "a path chip asks for a path the rule names", with relative forms added (`a.md`, `./a.md`, `../a.md`, `sub/a b.md` in angle brackets, `a.md#L3`), the path each chip asks for, resolved by `resolveRelative('/base/dir', …)`, is among `fileLinkTargets(text, '/base/dir')`; over the seeded strings, with the fragments `./`, `../`, `a/`, `#u` and `?q` added to the alphabet, every path `fileLinkTargets` names is the resolved path of a chip the window draws. The chips the window draws and the rule refuses on purpose (U6b-4b's N1.6) stay counted, not failed, as today. M4: drawn in a `MarkdownView` whose entry stands at `/base/dir/doc.md`, a click's follow carries `from.file` equal to the entry's path and `path` equal to the path the read then asks | `src/renderer/src/tools/code/named-links.test.tsx` (M1), `tools/code/viewer/viewer.test.tsx` (M4) |
| X3.5 | a text whose scan passes its budget (`WORK_PER_CHAR`) before the link | `not-linked`; the scan yields at every pause (a test counts the turns given back) | `service.test.ts` |

### R4 · A link is no stronger than what writes it

**The rule.** A record says whether the file may be saved.

- A link in a Markdown file: the file may be saved when the Markdown file itself is one the files service would save for the session: inside the folders, or outside them by a mark that admits a save (chosen, sent, named by a counted form, or a link record that admits a save), and not under MAWS's own folders. When the Markdown file is one the service never saves for the session (named only by a tool's result, only in the Library, reached through such a file, or MAWS's own, wherever it stands and whatever admits it), what it links opens read-only, marked `linked`. This is about what the service admits, not about what the editor can do: a Markdown file the editor holds read-only for its encoding or its size still gives a save.
- A link in a subagent's transcript: a counted form admits a save, and only an `assistant` record counts there. A `user` record or an attachment of a subagent's file is never the person's own text, whatever its fields say: it is a result form, `why: 'result'`. The search over a subagent's file reads it so by a guard of its own (`agentRowClaimSteps`), and does not rest on the engine leaving `origin` out.
- A record that admits a save is never lowered by a later follow that finds less; a read-only record is raised by one that finds more.

**Why.** U6e's write rule keeps text the agent only read from admitting a save. Without this rule one click would launder it: a tool's result names a Markdown file (read-only), and that file's text links the path. The owner's first answer speaks of a file a shown Markdown file links; this rule holds it for every Markdown file the session could itself save. The rest was put to the owner (Q2), who answered on 2026-11-18: "read-only inheritance", as built, with its sentence.

**Never written, whatever the record says.** A file in MAWS's own folders (`own`, checked at every write on the confirmed real path, unchanged); anything for a caller from another machine.

**Stays refused, as tests** (`service.test.ts` unless named).

| # | the case | must be |
|---|---|---|
| X4.1 | a Markdown file outside the folders that only an MCP tool's result names, linking `/out/b.txt`; follow, read, save | `linked`; the read answers `outside: { writable: false, why: 'result', linked: true }`; `files.writeOutside` is refused and the bytes are unchanged. Control: the same once the person chose the Markdown file: a new follow, then the read answers `writable: true` and the save writes |
| X4.2 | a Markdown file only an added record of the Library admits, linking a file | as X4.1 |
| X4.3 | a subagent's file whose only mention of the path is in its first `user` record, in a `user` record forged with `origin: { kind: 'human' }`, and in an MCP tool's result | `namesInAgent` answers `'result'` for each; the record is read-only, `why: 'result'`; the save is refused (`src/shared/files/named.test.ts`, `src/services/files/named.test.ts`, `service.test.ts`). Control: the same path in an `assistant` record's text answers `'counted'` |
| X4.4 | a record that admits a save, made from a Markdown file; then a follow from a subagent's transcript that finds only a result form | the record still admits a save and still holds the Markdown file as its `from`; it is the session's newest |
| X4.5 | a link record for a file under MAWS's own folders | the read answers `own: true`; the save answers `not writable` |

### R5 · The record

**The rule.** A link record is one real path, for one session, with the time and, when it admits no save, why. It is written only by the daemon, only at the end of a follow that found the link, for a target that resolves, is a regular file and is outside the folders (a target inside them needs none: `inside`). The target is resolved for the record after the link is proven, directly before the write, as `grant` resolves the file it records: what was resolved before a search that can take seconds is used for the early answer `inside` alone. It admits that file and nothing beside it, for that session and no other, and it is asked exactly where a grant is asked: a request of this machine that asks by name or is a save, and that the agent did not ask for. In `firstEvidence` a record that admits a save stands directly after the grant, and again after the search, as the grant does; a read-only record stands after the transcript's result form and before the Library's record, so a counted name always wins over it.

**Its life.** Records are `<profile>/sessions/file-links.json`, written whole and atomically before the daemon's memory changes, read once at the daemon's start, so a relaunch of the app or of the daemon changes nothing. A session holds at most 256, the oldest going first; a follow of a path that has a record makes it the newest. A tab still open when its record is pushed out reads as refused at its next read, and an edit it holds is refused at Save with U6e's sentence, edits kept, until the link is clicked again (Q1). A session's records go when its record is removed. The failures are U6e's decision 21, unchanged: a file this build cannot read holds nothing for the run and is left as it is until the next change; a write that fails fails the follow, memory untouched.

**An open the agent asked for is never admitted by a link record** (`agent: true`), as it is never admitted by a grant: following a link is the person's act.

**A path that is gone.** A request for a path that no longer resolves answers `not found: <path>` when that path, as asked, is a recorded real path, as a chosen file's does. A tab holds the path the link wrote, which can be another spelling of the real path (`/tmp/…` for `/private/tmp/…`); for such a tab a file followed and later deleted reads as outside the folders, since nothing resolves any more to find the record by. The record never answers by a spelling it did not prove. A link whose target does not exist when it is followed records nothing, and its tab reads as any unadmitted path does (Q7).

**Stays refused, as tests.**

| # | the case | must be | test file |
|---|---|---|---|
| X5.1 | a record for session S; the same path read under session T | refused | `service.test.ts` |
| X5.2 | a record; a read with `agent: true` | refused. Control: without `agent`, admitted | `service.test.ts` |
| X5.10 | the target changed during a follow, at two hooks of the suite. Before R3's second test resolves it (after the source's text is read; for a subagent, at the search's `searched` hook): its folder swapped for a link to a folder with a file of the same name. After the proof and before step 5 resolves the target again (for a Markdown source, after R3's second test; for a subagent, after `agentNames` has answered): the same swap, to a folder outside the session's folders that holds a regular file of that name; and the target removed | before: a Markdown source is `not-linked` unless the link, resolved from the source's confirmed folder, leads to that same new file, and a subagent source records the real path the named path now leads to, as a read of it would. After: a Markdown source records nothing (the real path is not the one the second test found); a subagent source records the real path step 5 resolves, the new file's, since the transcript names the path and step 5 is its only resolution; and a removed target records nothing for either source. In no case is a real path recorded other than the one step 5 last resolved | `service.test.ts` |
| X5.11 | a `path` inside the folders that ends in a link; a `path` outside them that ends in a link to a file inside | `not-linked` for both, never `inside` | `service.test.ts` |
| X5.12 | a follow whose proof is held open past its own deadline, the client still alive | `not-linked`, and that follow records nothing. What the deadline does not promise is decision 7's | `service.test.ts` |
| X5.13 | a record, its file then deleted: read by the real path, and by another spelling of it (a folder that is a link) | `not found: <path>` for the first; the refusal sentence for the second | `service.test.ts` |
| X5.14 | in the window: a tab of a followed file with unsaved edits whose record is gone (the fake disk drops it) | Save is refused with U6e's sentence and the edits stand; after a click on the link and its follow's answer `linked`, Save writes (a Save pressed before that answer is refused as before, edits kept) | `tools/code/viewer/viewer.test.tsx` (M4) |
| X5.3 | a record; the path later resolves to another real path (its folder replaced by a link) | refused, and the save answers the refusal, not `FILES_MOVED` | `service.test.ts` |
| X5.4 | a record; a read with no `named` | refused, as a chosen file's is | `service.test.ts` |
| X5.5 | a record; a request from another machine with `named`, with no claim; and, on a head that holds U6f, a read and a save under U6f's claim | refused for each, and a path that is gone answers the refusal, not `not found`. Controls: this machine's own request is admitted; a grant of the same file admits the claimed caller as U6f built it | `service.test.ts` |
| X5.6 | the 257th record of a session; a session removed; a view that becomes available with a session gone | the oldest is gone; all of the session's are gone; reconciled | `src/services/files/links.test.ts` |
| X5.7 | a links file of another version, of no JSON, with an entry lacking `real`, with a `why` this build does not know | nothing held, logged once with its size; the entry read past; an unknown `why` read as read-only `linked` | `links.test.ts` |
| X5.8 | a follow whose client ended while the search ran | no record is written after the end (the signal is read before the write) | `service.test.ts` |
| X5.9 | a links file that cannot be written | the follow fails; no record in memory; a later read is refused | `links.test.ts`, `service.test.ts` |

### R6 · What stays exactly as it was

A session on another machine (no follow; the read is today's to the byte). `files.read`, `files.openExternal`, `files.writeOutside` and the frame's ask: their inputs do not change. `names`, the search over the session's own transcript: a path written only in a subagent's file is still not named by it (U6b-4b's pin stays), and only a follow that names the agent reads that file. The mounts that add no evidence (U6b-4b's R4). `files.write`, `list`, `watch` and `reveal`: the folders alone.

## Decisions settled at authoring

1. **A command of its own, not a key on the read.** `files.follow` runs before the tab's first read and the read waits for it in the window (W1). A key on `files.read` lost: it would have to ride every read until one is answered, Retry included, and three more commands would need it or an order between them.
2. **The record is its own store, `src/services/files/links.ts`**, built as `grants.ts` is built (the same atomic write, the same failure rules) and sharing with it only the options' type and `followView`, both used as they are. `grants.ts` is not edited: every entry of the grants file stays one main made after the chooser, and a fault in one store cannot lose the other's entries.
3. **The follow is sent for every click that has a source**, also when the target turns out to be inside the folders; the daemon answers `inside` without reading the source. The window does not try to know the roots.
4. **The early answers come before the source is read.** A `path` that ends in a link or does not resolve is not linked; one whose real path is under a root is `inside`, whatever it is (a folder too: nothing is recorded for it either way). So a follow costs a source's read only where a record could be written. Whether the target is a regular file is judged where it is recorded (§D, step 5).
5. **The Markdown test is shared.** `MARKDOWN_RENDER_CAP` and the test of a Markdown name move to `src/shared/files/markdown.ts`; `viewer/kinds.ts` reads them from there. The daemon then calls a Markdown file what the window draws as one.
6. **`resolveRelative` moves into `src/shared/files/named.ts`**, and `tools/code/open-file.ts` exports it on, as it does `normalizeLexically`. One copy is what makes R3 need no second proof.
7. **Bounds, each taken before the cost it bounds.** (i) At most `FOLLOW_IN_FLIGHT_MAX` (nine) follows are in the service at once. A tenth is answered `not-linked` before its first file system call, and a follow leaves the count only when its own work has ended, not when its patience has: calls stuck on a mount that stopped answering keep their places, and no burst piles up behind them (the search keeps its one slot the same way, U6c). A follow's own work is its early answers, its Markdown proof, and for a subagent its call of the transcript locator, which can touch the disk (where the index holds no path it resolves the session's folder) and which the search does not wait for once a request's patience has run out: the place is kept until that call has answered, whatever the follow itself answered. The search that then runs in the search's slot is bounded there and is not counted here. This bounds the early answers too, which resolve the session's roots as a read does. (ii) A Markdown source's proof (its open, its read of up to 1 MiB, its scan) runs one at a time for the daemon, and the scan gives the event loop back at every pause of the rule. (iii) A subagent's search takes the search's own slot and bounds, and the walk that finds its file runs inside the slot. (iv) A follow's patience is `NAMED_WAIT_MS` (8 s) from the moment its handler is entered: past it the answer is `not-linked`, and it is read once more directly before the record is written. *What the deadline does not promise.* The host counts its ten seconds from before a request is sent, and the daemon's front can hold a request before its handler runs; so the window can have been answered `timeout` while a follow that entered late still finds its link and records it. And the store's write is synchronous: a deadline that passes during it undoes nothing. Such a record is of a link the daemon found, for a request the app's page made; the tab that gave up reads the file when it is next shown or the link is next clicked. Carrying a request's own expiry to the daemon is the host's work and not this landing's (Q18; one tracker row).
8. **The search over a subagent's file is the search**, with two differences: the file, and `agentRowClaimSteps`. What it remembers is keyed with the agent's id, so it never meets an entry of the session's own transcript. It shares the 256 entries, the eight waiting jobs and the 8 s.
9. **The agent's id reaches the click through the mount, not through each click source.** `Transcript.tsx`, for `variant === 'child'` with a `source.agentId`, gives its rows an `openFile` that adds `agent` to the options. Editing each click source (the link, the two chips, the comment) lost: four places, and a fifth forgotten later would silently keep today's refusal.
10. **The window waits for the follow where it reads**, in `readChunk`: a tab opens at once and shows its loading state, as a link the transcript names does while the search runs. Waiting before the tab opens lost: up to 8 s with nothing on screen.
11. **A new optional property, `outside.linked`, with its own sentence** (Interfaces §C and §F). A new value of `outside.why` lost: the wire's rule calls an added enum member breaking, and a window of this wave that knows `why` would refuse the whole answer. The answer keeps `why: 'result'` beside `linked: true`, so such a window holds the file read-only with the sentence of a file a tool's output names, which is the nearest true one it has; this build reads `linked` and says its own.
12. **The grade of `files.follow` is `manage`**, as the outside save's: it writes an admission a save may use.
13. **`follow` answers three words and no reason**: `linked`, `inside`, `not-linked`. Why a follow found nothing (no such source, no such link, no such target) is not said, so the command tells nothing about what exists outside the folders that a read would not tell.
14. **No watch and no new listing.** A followed file is read again as every outside file is: when its tab is shown again or the link is clicked again.
15. **The record keeps where the link stood**, `from`, as the request gave it. Nothing admits by it and no reader of the service asks for it: it is there for a person, or a later build, to see what wrote a record (R1).

## The sequences that must hold

**W1 · The click, the follow and the read.** The states of one session and path in the window: no follow; a follow under way; none again. `follow` is called before the tab is placed. (a) While the follow is under way the tab shows its loading state and no `files.read` for that session and path is sent; when it is answered, exactly one first read is. A test holds the follow open and counts. (b) A follow that fails (`unknown_command` from a daemon of an older build, `timeout`, `host_unavailable`, `forbidden_sender`) or answers `not-linked` settles the wait the same way: the read is sent, and what it answers is drawn, the notice included. A follow never rejects into the store. (c) A second click on the same link while the follow is under way starts no second follow. (d) The tab closed, or the same path opened for another session, while the follow is under way: the read that was waiting lands nowhere (U6c's W2, unchanged), and the other session's read does not wait. (e) An open kept for an unread layout (U6b-1's kept open) sends its follow when the open is made, not when it is kept. (f) A tab that already shows the file with a failed read is read again after the follow, and then shows the file. (g) A read of the tab was already sent when the click came (a restored tab still loading, a tab being shown again): it passed no wait, `revisit` starts nothing while a read is pending, and its refusal would land after the follow succeeded. So the window counts, per session and path, the follows answered `linked` (`linkedCount`, Interfaces §F). A read notes the count as it is sent. When its answer lands as a refusal, or as a file from outside the folders that may not be saved, the answer is drawn as it is, and the store then compares: at once when no follow for that session and path is under way, else when the last of them has settled (the old read can land first and the follow answer `linked` after it). If the count has moved since the read noted it, and the entry is still that session's, that path's and of the generation the read landed in, the store reads the entry once more: after the landed load has left `pending`, by the path a re-read of a shown or hidden tab already takes (`readAgain` when the view is mounted, else left for its next mount), nothing over unsaved edits, and with the entry's own `agent` mark. A read that waited for the follow notes the count after the wait, so an ordinary first open through a link sends one read and no second. Tests count the reads sent: one for a first open through a link; two where a first read was held open and the click came, in both orders (the follow answers `linked` and then the held read lands refused; the held read lands refused and then the follow answers `linked`); and no further one for a key whose entry meanwhile became another session's. (h) Two clicks for one path from two sources (a Markdown file and a subagent's transcript) are two follows: a follow is shared only between clicks of the same session, path and source, since one source can give a save where the other gives a read. A read waits until no follow for its session and path is under way, a source that arrived during its wait included. (i) Several loads that waited for one follow each send their read when it settles, as they would have without it; the generations discard every answer but the newest.

**W2 · The daemon, between the check and the record.** The order of a follow is fixed (Interfaces §D): the early answers; a place in the gate or the slot; the proof; the target resolved again; then the deadline and the client read and the record written in one synchronous step. (a) The client ends while the source is read or searched: the scan stops at its next turn and nothing is recorded. (b) The session is removed meanwhile: `add` asks the view in the same synchronous step as its write, and fails. (c) A read of the same path arrives before the record is written: it is refused, as it would have been; the window's own read waits (W1), and any other reader reads again when its tab is shown. (d) Two follows of one path, one finding a counted form and one a result form, in either order: the record admits a save (R4). (e) The target changes while the proof runs: X5.10. (f) The request times out at the host while the proof runs: X5.12.

**W3 · The search's slot.** A subagent's search waits behind a running search and gives up after its patience; the follow then answers `not-linked`, the tab reads as refused, and a click on the link tries again. Nothing is remembered of a search nobody waited for. A request joins a running or waiting search only when it is bound to the same transcript: the job's key holds the transcript path the locator answered for that request, as the search's own key does, so a request made after `/clear` never takes the answer of a search over the conversation left behind (X2.11).

## What is stored and sent, and what each older build does with it

No field is added to a stored tab, to `main.tabs`, to `regions` or to the stored side surfaces; no version moves; neither settings file is touched; no layout key is added.

**Stored.**

| what | what this landing writes | build F (`f1852de3a`) and build M (`2c7044231`) | this build, then the older one, then this build |
|---|---|---|---|
| `<profile>/sessions/file-links.json` (new) | `{ "version": 1, "sessions": { "<session>": [{ "real": "<real path>", "at": <ms>, "from": { "file": "<path>" } \| { "agent": "<id>" }, "why"?: "result" \| "linked" }] } }`, whole, atomically, mode 0600 | neither names it: each names `sessions/intents/`, `sessions/bootstraps/` and `sessions/uploads.json` alone and neither lists the folder (U6e's row for `file-grants.json`, confirmed by its M1); neither reads nor removes it | the older build leaves the file as it was; back on this build the tab reads and saves |
| the tab of a followed file, beside the chat | nothing new: a Files tab's `{ file, line }` | both read `params.path`, which this build does not write: each draws that tab as its Files tree, makes no read of the file, and keeps `file` through its own layout writes (U6b-1's row) | the tab is there, reads and saves as before the stay |
| the tab of a followed file, in the main area | nothing new: a main `file` tab | each draws its file tab. F reads without `named`: its refusal. M reads with `named`, and its own daemon holds no record: its refusal, unless its own transcript names the file | the same |

**Sent.**

| what | to whom | a daemon of build F | a daemon of build M | an older window on this build's daemon |
|---|---|---|---|---|
| `files.follow` (new) | this Mac's daemon, from the app window's page, for a session on this Mac | `unknown_command`: the window goes on to the read, which that daemon refuses for an outside file; the tab shows the notice | the same; a file its transcript also names opens as it did | never sent |
| `files.read`'s answer: `outside` may hold `linked: true` (a new optional property; `why` keeps its two values) | the window | never answers `outside` | never answers `outside` | F's window sends no `named` and is answered no `outside`. M's window sends `named`: a file this build's window followed earlier is admitted to it, and it holds every such file read-only, since it knows no `outside` and has no outside save. A window of this wave from before this landing drops the key it does not know and reads `why: 'result'` |

The wire takes its next minor (54 if nothing else has taken it at the head this is built on). By root UC-10 the landing owes two cross-build runs, one with each older build as the exact peer, and adds its row and its scene to the cross-build coverage table (Interfaces §H). The proof at the schema is `test/cross-build/files-schema.test.ts`, over the committed snapshots of the two peers; `src/shared/ipc/schema.test.ts` also reads a `linked` answer of this build through `readTolerant` with `outside`'s schema as it stood before this landing, written out in the test: the key is dropped and `why: 'result'` is read.

## Acceptance

Each item is a behaviour a person can check. "Unit" runs on the build VM; a scene runs on a Mac and is the architect's to start.

- **K1** (the owner's first answer). In a session on this Mac, a Markdown file of the session's folder holds `[notes](/<outside>/notes.txt)`. A click on the link in the rendered file opens `notes.txt` beside the chat, with no "Read-only" label; typing and ⌘S write the file on disk; ⌘-click opens it in the main area. A PDF linked the same way is drawn in its frame.
- **K2** (the stored-tab problem). With K1's tab open, quit and relaunch: the tab is there, shows the saved text, and saves again, for as long as the session keeps the record (R5). `main.tabs` and `panelTools.params` hold no key they did not hold before U6b-4c (unit: the stored layout after a followed open equals the one after a plain open of the same path), and `sessions/file-links.json` holds one entry for the session.
- **K3** (the owner's second answer). A Markdown file outside the folders, opened by Open File… or by a link, holds `[next](next.md)` and `[up](../other/up.md)`: each click opens the file at that place relative to the Markdown file's own folder, editable.
- **K4** (R4). A Markdown file outside the folders that only an MCP tool's result names opens read-only, and a file it links opens with the label "Read-only", whose panel reads the sentence of Interfaces §F and offers Open File…. After the person chooses the Markdown file with Open File…, a click on the same link opens the file editable.
- **K5** (a subagent, "the same rule"). In the Agents tool's drill-in of a subagent, and in a main tab of that agent, a link in the subagent's own text and the chip of a file it read, each to a file outside the folders that the session's own transcript does not write, open the file, editable. A path only a tool's result in that subagent's transcript holds opens read-only.
- **K6** (R2, R3; in a session with no other evidence for the target). A link the rendered file still draws after the file was changed on disk to hold it no more: the click shows U6b-4b's first notice and opens nothing. A link typed into the Source view and not saved is not drawn (the rendered view draws the saved text), and a direct `files.follow` for it answers `not-linked`; so does one for a path the file writes only in a code fence.
- **K7** (R1; unit and scene). In a session with no other evidence for the path, `files.follow` for a path the named source does not link answers `not-linked`, and a read of that path is refused. Asked through main's router by anything but the app window's page, it answers `forbidden_sender` (the guard's reach is R1's).
- **K8** (R5). With no tab of the file open in the session, `show_pane` for a file that only a link record admits shows the refusal; the person's own click on the link then opens it. (Where the session already shows the file, the agent's open selects that tab and reads nothing, as U6e built it.)
- **K9** (a session removed). Removing the session removes its entries from `sessions/file-links.json`.
- **K10** (another machine). For a session on another machine no `files.follow` is sent (unit: the window's follow and the renderer guard), and a click on a link in a Markdown file there opens what it opened before.
- **K11** (an older daemon). On a daemon of build F or of build M this build's window draws the notice for a followed link to an outside file, and opens a file inside the folders as before (scene, cross-build).
- **K12** (going back). After K1, a run of build F and of build M on the same profile leaves `sessions/file-links.json` as it was, and this build then reads and saves the file again (scene, cross-build).
- **K13** (the bounds; unit). A follow of a subagent whose file is searched to its bound gives the event loop back as the search does; with eight searches waiting, a further follow answers `not-linked` at once and reads no directory of the transcript's folder (its roots and its target were read, under the count of follows); with nine follows whose locators are held open past their patience, each answered `not-linked`, a tenth makes no file system call until one locator answers; with nine follows in the service a tenth is answered `not-linked` and makes no file system call (a test counts the calls of the suite's fake file system: roots, target, source); a session with 4,000 subagent files finds one agent's file by reading directories alone (a test counts the files opened: one).
- **K14** (nothing else moved; unit). `files.read`, `files.openExternal` and `files.writeOutside` validate the inputs they validated and no key more (`src/shared/ipc/schema.test.ts`); `names` does not name a path written only in a subagent's file.

## Constraints that bind every milestone

- **The build brief binds** (the wave's common brief for building a child): nothing is typechecked, linted, tested, built or started on the owner's MacBook (root UC-10); every check runs on the build VM in a checkout of the pushed head, under a time limit; the gate runs Node 22 where the VM runs a newer one; the VM's known failures are read against the brief's list and never edited away.
- **The root's contracts.** UC-3 and UC-8 (every edit in a file another child owns is the insertion Interfaces §G names, and nothing more); UC-7 (each act says what it does for a session on another machine: R6, K10); UC-11 (public repository: invented names, paths and text in every test, fixture and scene); UC-14 (the tables above; no layout key, no field on a tab, no settings change).
- **The daemon's admission is the only authority.** No milestone may let the window's word stand for a fact: a source is read by the daemon, through the descriptor it confirmed, and a record is written only by `follow`. A milestone that finds it needs the window to say more than where to look stops and reports.
- **The rule stays one-directional.** Every path the rule names for a file is a chip the window draws in that file; where a reading cannot tell, it names nothing.
- **A test that asserts an absence** (no record, nothing named, no call, refused) over input it builds by hand carries its control in the same test.
- **Fail towards the refusal.** Every failure inside a follow (an unreadable source, a bound passed, a client gone, a full queue) is `not-linked`, with nothing written and no path in a log line.
- **Tokens only** in renderer source; a ticket or item number is written in words there. Run `test/support/tokens-guard.test.ts` with any milestone that adds renderer source.
- **No wall time is asserted**; a scene waits on a state it names.
- **Other packages read the app's source.** `apps/desk-web` imports `transcript/view/context` and `transcript/view/markdown/Markdown`. M4 adds `pnpm --filter desk-web typecheck`, `pnpm --filter desk-web build` and `pnpm --filter desk-web test` to its proof; each milestone lists the importers again, following imports until no new file appears (M1's `viewer/kinds.ts` among them).
- **Merge, never rebase or force-push.** Never push master or `ux-wave-spec`.

## Plan of Work

Five milestones, built in this order. M1 is the pure rule both sides read. M2 and M3 are the daemon: M2 brings the command, the record and the Markdown source, and leaves the subagent source answering `not-linked`; M3 adds the subagent's search. M4 is the window and consumes M2's command. M5 is last. M3 and M4 share no source file and could be built side by side, but both add cases to `src/services/files/service.test.ts` or to suites M2 touches, so they are built one after the other. Each milestone is red first: its tests are written and seen failing before its source changes.

### M1 — The rule reads a Markdown file's links and a subagent's records

**At its end.** The shared rule can say which paths a Markdown file's text links when the file stands in a given folder, and can read a subagent's record without ever counting a `user` record; the window and the daemon share one test of what a Markdown file is. Nothing a person sees changes.

**Touches.** `src/shared/files/named.ts` (`resolveRelative` moved in; `fileLinkSteps`, `fileLinkTargets`, `agentRowClaimSteps`; the header comment gains the two sources). New: `src/shared/files/markdown.ts`. `src/renderer/src/tools/code/open-file.ts` (exports `resolveRelative` on), `src/renderer/src/tools/code/viewer/kinds.ts` (reads the shared test and cap). Tests: `src/shared/files/named.test.ts`, a new `src/shared/files/markdown.test.ts`, `src/renderer/src/tools/code/named-links.test.tsx`.

**Interfaces.** Exposes §A. Consumes U6b-4b's `resolveRelative` (its §B), which it moves.

**Decisions.** R3's first test; decisions 5 and 6. `fileLinkSteps` is `linkSteps` with each path it names handed on as written and as resolved (a link that names none is passed over); it adds no scan of its own and charges nothing new to the meter. `linkSteps` stays private. The rule's reading of line endings and of a leading byte order mark is U6b-4b's first milestone, on this branch; M1 adds no repair of its own and holds X3.7 as fixed controls for a file's text. If X3.7 shows a block the rule and the window still read apart, the executor stops and reports: a repair of the rule is its own red-first commit, as U6b-4b's were. `agentRowClaimSteps` runs `rowClaimSteps` and turns a counted answer from a record whose `type` is not `assistant` into the result form already resolved (`other`).

**Does not touch.** `clickPath`, `linkSteps`' scan, `rowClaimSteps`, every scanner of `named.ts`. The daemon. `MarkdownView`.

**Proves.** X3.1 and X3.2's rule half, X3.4's M1 half, X3.7, X4.3's rule half; `kindOf` answers as before for every case of its suite; the differential green in both directions with the new fragments (its seeded case runs up to 300 s: give its command a limit of 600).

### M2 — The record, the command, and a Markdown file as the source

**At its end.** The daemon answers `files.follow`. For a Markdown source it checks the link and writes a record; every later read, open outside MAWS, frame and save of that file for that session is admitted by the record, across a restart of the daemon. For a subagent source it answers `not-linked` (M3). No window sends the command yet; the suites and a direct request do.

**Touches.** New: `src/services/files/links.ts`, `links.test.ts`. `src/services/files/service.ts` (`follow`; `firstEvidence`, the marks and the read's answer; the missing-path branch of `precheck`; the header comment), `src/services/files/register.ts`, `src/services/checkouts-root.ts`, `src/services/spine-root.ts` (the store opened beside the grants, `followView` given it). The wire: `src/shared/ipc/schema/files.ts`, `names/files.ts`, `grades/files.ts`, `remote-unavailable.ts`, `wire.ts` (the minor and its comment), and the three generated snapshots `routes.json`, `wire-manifest.json` with its fingerprint, `src/shared/machine/address-paths.json`. `src/main/app.ts` (the guard's list gains the name). Tests: `src/services/files/service.test.ts`, `register.test.ts`, `src/shared/ipc/schema.test.ts`, `src/main/daemon-root.test.ts`, `src/main/files/open-file.route.test.ts`, `test/support/spine-lists.ts`, `test/endpoint/checkout-rows.test.ts`, `test/cross-build/files-schema.test.ts`, `e2e/support/cross-build-samples.ts`.

**Interfaces.** Exposes §B, §C and §D. Consumes §A.

**Decisions.** R1, R2 (for a file), R3's second test, R4 (for a file), R5; decisions 1, 2, 4, 7, 11 to 13 and 15; W2. The service reads the source with the functions a read uses (`openConfirmed`, `readWhole`, `fileMime`, `isTextMime`), closes the handle on every path, and never opens the source a second time. The read's answer changes by one optional property, so the window compiles and draws as it did until M4 reads it. `follow` with `from.agent` answers `not-linked` while the service is given no `agentNames`. The snapshots are written again on the VM by the switch each test names and their diffs brought back, never edited by hand (Concrete Steps).

**Does not touch.** `grants.ts`. `named.ts` of the services. `write`, `list`, `watch`, `reveal`, `readResolved`. The endpoint's `OFFERS`. Any renderer source.

**Proves.** K7, K9, K12's and K14's unit halves; X1.1 to X1.6, X2.1 to X2.5, X2.10, X3.1 to X3.3, X3.5 and X3.6's service half, X4.1, X4.2, X4.4, X4.5, X5.1 to X5.13 for a Markdown source; the wire's tests green with the new minor (`pnpm wire:manifest` writes it without the rebase switch: every change is additive); neither peer's snapshot knows `files.follow`.

### M3 — A subagent's transcript as the source

**At its end.** `files.follow` with `from.agent` finds that agent's file under the session's own transcript folder, searches it by the rule, and records what it finds: a save for a counted form in an `assistant` record, a read for a result form.

**Touches.** `src/services/files/named.ts` (`namesInAgent`, the file's locator, the job's rule and its remembered key), `src/services/checkouts-root.ts` (hands `namesInAgent` to the service as `agentNames`). Tests: `src/services/files/named.test.ts`, `service.test.ts`.

**Interfaces.** Exposes §E. Consumes §A (`agentRowClaimSteps`) and §D (`agentNames`).

**Decisions.** R2 (for a subagent), R4's second point; decisions 7 and 8; W3. The order is §E's: the locator is asked first, the job is keyed with the transcript it answered and takes its place in the queue, and the walk and the open run inside the job. The locator reads directories and opens no agent file but the one it found; depth and the file's name are the engine host's (`src/engine-host/fs/subagents.ts`, `MAX_DEPTH` and `AGENT_TRANSCRIPT`), restated here with a test over `test/fixtures/transcripts/` that fails if the two readings part. The walk stops at `NAMED_AGENT_DIRS_MAX` directories (4,096) and answers none past it.

**Does not touch.** `names`, its queue's bounds, the scanner's reading of a line. `src/engine-host/`. The service's evidence order.

**Proves.** K5's and K13's unit halves; X2.6 to X2.9, X2.11, X4.3, X4.4, and X5.10 and X5.12 for a subagent source; with eight jobs waiting, a burst of follows for one session reads no directory (a test counts `readdir` calls); `names` answers `false` for a path written only in a subagent's file, as before, in the same test that finds it with `namesInAgent`.

### M4 — The window follows

**At its end.** A click on a link in a shown Markdown file, and on a link or a chip in a subagent's transcript, of a session on this Mac sends the follow, and the tab's read waits for it. A file that opens read-only through a read-only Markdown file says why.

**Touches.** New: `src/renderer/src/tools/code/follow.ts`, `follow.test.ts`. `tools/code/open-file.ts` (`OpenFileOptions.from`; `place` follows; `codeTranscriptActions.openFile` passes the agent), `tools/code/viewer/MarkdownView.tsx` (its `openFile` gives `from`), `tools/code/viewer/viewer-store.ts` (`readChunk` waits and notes the count; the re-read of W1 g; `locked` gains `linked`), `tools/code/viewer/FileViewer.tsx` and `tools/code/copy.ts` (the reason's sentence, and Open File… offered for it), `transcript/view/context.tsx` (`openFile`'s options gain `agent`), `transcript/view/Transcript.tsx` (the child's `openFile`), `src/renderer/src/test-support/code-disk.ts` (the fake disk answers `files.follow`). Tests: `tools/code/files/tabs.test.tsx`, `tools/code/viewer/viewer.test.tsx`, `tools/code/editor/editor.test.tsx`, `transcript/view/Transcript.test.tsx`, `test/lane-b/renderer-guards.test.ts`; and the cases that hold U6b-4b's L14 and N2.3, which this landing reverses in the window: each now expects one `files.follow` and then one `files.read` where it expected the read alone.

**Interfaces.** Exposes §F. Consumes §C (the command) and U6b-4b's §B (`base`, `artifactView`).

**Decisions.** Decisions 3, 9, 10 and 11; W1. `follow.ts` sends nothing for a session that is not on this Mac, for no session, and for a path that is not absolute; it is the one module that names the command, and its row in `GUARDED_ELSEWHERE` says so. `MarkdownView` gives `from` exactly where U6b-4b gives `base`: for a file's tab, never for an artifact's view. An open with `asked: 'agent'` never follows.

**Does not touch.** `Link.tsx`, `ReadDetail.tsx`, `EditDetail.tsx` and every other click source. `DrillIn.tsx`, `TranscriptSlot.tsx`, `RemoteAgentTranscript.tsx`. The notice. The Files tab's params and `layout.openTab`'s argument. `apps/`.

**Proves.** K1 to K6, K8, K10 and K11's unit halves (K11 over the fake disk's older daemon); X3.4's M4 half; X5.14; W1 (a) to (i), each with the follow or the read held open by the test; the store asserts no `files.read` before the follow settles; a child transcript's click carries the agent's id from each of its click sources (the link, a read's chip, an edit's chip, an anchored comment), and a session's own transcript carries none.

### M5 — The scenes, the older builds, the record, and the acceptance run

**At its end.** The scenes of Interfaces §H are written and typecheck; the cross-build table holds the landing's row; the charter and C8's document hold their dated lines; the tracker's rows are closed and opened; the acceptance's unit half and the whole unit suite have run.

**Touches.** `e2e/sessions.spec.ts`, `e2e/cross-build.spec.ts`; `docs/charter.md` (§19, one dated entry); `docs/doperpowers/plans/2026-09-28-c8-right-panel.md` (one dated line at K1); `docs/tech-debt-tracker.md`; this document's record.

**Interfaces.** §H.

**Decisions.** The charter's entry, exactly: "2026-11-18 (owner; UX wave U6b-4c, O-37): on the machine that holds a session, the files service (C8's K1 as amended 2026-11-13 and 2026-11-14) also opens, for a read and for the person's Save, a file outside the session's folders that a Markdown file the session may read links, or that the transcript of one of the session's subagents names. The window says only where the link stands; the daemon reads that file itself, and records what it finds for that session. A file linked only by a file that is itself read-only for the session opens read-only." The line at K1: "Amended 2026-11-18 (UX wave U6b-4c): also a file that a readable Markdown file links or a subagent's transcript names, once the daemon has found the link itself (`files.follow`); charter §19." The entry's last sentence states R4's first point, which the owner answered on 2026-11-18 (Q2, "read-only inheritance"): it is written as it stands here.

**Does not touch.** Any source of M1 to M4, but for what a scene's typecheck shows wrong.

**Proves.** K1 to K14 read once against the tests and scenes that hold each, with the list in the hand-back; the whole unit suite, once; the script tests (the diff touches `e2e/`).

## Concrete Steps

All commands are run from the worktree `…/.claude/worktrees/ux-wave-U6b-4c` on the MacBook, and every check through the helper, which runs it on the build VM in a checkout of the pushed head. `V` below stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b-4c --`. The helper's exit status is the command's; never pipe it into `tail` or `head` without `set -o pipefail`. The branch was cut from another branch: push it by name, `git push origin ux-wave/U6b-4c`.

Once, before M1:

    git fetch origin master && git merge origin/master                     # or the head the architect names: ask before merging (U6b-4b's own build was told to)
    git fetch origin ux-wave/U6b-4b && git merge origin/ux-wave/U6b-4b    # only while U6b-4b is not on that head
    git push origin ux-wave/U6b-4c
    V 'timeout 1500 pnpm typecheck'

Expect no error. Then read "Statements to check again" against the merged head. **If the merged head does not hold U6b-4b as built (no `resolveRelative` in `tools/code/open-file.ts`), stop and report: this landing is built on it.**

Per milestone, after the push (each line is one call; expect every test file named to pass and eslint to print nothing). A milestone that edits a test in a folder not listed adds that folder. Several of these folders hold files the build brief lists as timing out under load on the VM: read a time-out against that list and show the file passing alone.

    # M1 (shared and window: both TypeScript projects)
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
    V 'timeout 900 pnpm exec vitest run src/shared/files/ src/services/files/ src/renderer/src/tools/code/viewer/ src/renderer/src/tools/code/files/ test/support/tokens-guard.test.ts'
    V 'timeout 600 pnpm exec vitest run src/renderer/src/tools/code/named-links.test.tsx'
    V 'timeout 300 pnpm exec eslint src/shared/files src/renderer/src/tools/code'

    # M2 (the daemon, main and the wire: both projects)
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
    V 'timeout 1500 pnpm exec vitest run src/services/files/ src/shared/ipc/ src/shared/machine/ src/main/files/ src/main/daemon-root.test.ts test/cross-build/ test/endpoint/checkout-rows.test.ts test/lane-b/'
    V 'timeout 300 pnpm exec eslint src/services/files src/services/checkouts-root.ts src/services/spine-root.ts src/shared/ipc src/main/app.ts test/support test/cross-build e2e/support'

The three snapshots are written on the VM and brought back as a patch, as U6e's document does it (its Concrete Steps, steps 5 and 6): run the switch, print `git diff -- <the file>` in the same call, apply the diff in the worktree, commit, push, and run the test again without the switch.

    V 'MAWS_ROUTES_WRITE=1 timeout 300 pnpm exec vitest run src/shared/ipc/routes.test.ts; git diff -- src/shared/ipc/routes.json'
    V 'MAWS_ADDRESS_PATHS_WRITE=1 timeout 300 pnpm exec vitest run src/shared/machine/coverage.test.ts; git diff -- src/shared/machine/address-paths.json'
    V 'timeout 300 pnpm wire:manifest; git diff -- src/shared/ipc/'

Read each diff before it is applied: the routes gain one name, the address paths one line (`commands.files.follow.input`, its `.appSessionId`), the manifest one command, one optional property in `files.read`'s output (and wherever that output's schema is shared: `library.read`, `files.readResolved`) and the minor. Anything else in a diff is a finding; a manifest that asks for a major, or for the rebase switch, is one: stop and report. Also add to M2's vitest call every suite that constructs the checkouts or the spine's root, found with `grep -rlE "startCheckouts|openFileGrants" src test --include=*.test.ts`.

    # M3
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
    V 'timeout 1200 pnpm exec vitest run src/services/files/ src/shared/files/'
    V 'timeout 300 pnpm exec eslint src/services/files src/services/checkouts-root.ts'

    # M4
    V 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
    V 'timeout 1800 pnpm exec vitest run src/renderer/src/tools/ src/renderer/src/transcript/ src/renderer/src/shell/ src/renderer/src/panel/ src/renderer/src/side/ src/renderer/src/lane-a/ test/lane-b/ test/support/tokens-guard.test.ts'
    V 'timeout 300 pnpm exec eslint src/renderer/src/tools/code src/renderer/src/transcript/view src/renderer/src/test-support test/lane-b'
    V 'timeout 1200 bash -c "pnpm --filter desk-web typecheck && pnpm --filter desk-web build && pnpm --filter desk-web test"'

    # M5
    V 'timeout 1500 pnpm typecheck'
    V 'timeout 600 pnpm exec eslint e2e'
    V 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
    V 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'
    V 'timeout 600 pnpm exec vitest run src/shared/machine'
    V 'timeout 3600 pnpm test'

The whole unit suite runs once, here; read a failure against the build brief's list of the VM's own failures, and show each such file passing alone or failing the same way at the branch's base before setting it aside. `src/services/files/service.test.ts` holds cases guarded for macOS, which are skipped on the VM and run in the Mac lane: say so in the hand-back. If the head has taken a merge of master since a milestone's proof, run that milestone's set again, not the whole suite.

Then stop and hand back to the architect: what exists, each command with its result, what is not verified, the decisions made, anything that contradicts this document or the child's file, and the scene list of §H with the groups that must run. The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e: class 1a, the review of the branch, the cross-build runs and the pull request are the architect's.

## Interfaces and Dependencies

### §A. The rule's two readers, and the shared Markdown test (M1)

In `src/shared/files/named.ts`:

    /** `path` when it begins with `/`, or when `base` is not an absolute path; else `base`, `/` and `path`, lexically normal. Reads no disk. Moved here from tools/code/open-file.ts (U6b-4b), which exports it on. */
    export function resolveRelative(base: string | null, path: string): string;

    /** The path each inline link of a Markdown file's text asks for when the file stands in the folder `base` (absolute):
        for every link `linkSteps` names, the path as the link writes it (`clickPath`'s answer) and that path resolved by
        `resolveRelative`. One bounded step at a time, PAUSE as `linkSteps`. */
    export interface FileLink { written: string; path: string }
    export function* fileLinkSteps(text: string, base: string): Generator<FileLink | typeof PAUSE, void, void>;
    export function fileLinkTargets(text: string, base: string): string[]; // every `path`, run at once (tests, the differential)

    /** A record of a subagent's transcript, read as `rowClaimSteps` reads one, but that only an `assistant` record names by a
        counted form: a counted answer from any other record is the result form already resolved (`other`). */
    export function* agentRowClaimSteps(row: unknown, path: string): Steps<RowClaim>;

In `src/shared/files/markdown.ts` (new; imports `./mime` alone):

    export const MARKDOWN_RENDER_CAP = 1024 * 1024; // a Markdown file past this is shown as its source, and links nothing
    /** Whether a file of this name is drawn as Markdown: its extension is `md`, `mdx` or `markdown` (`extensionOf`). */
    export function isMarkdownName(name: string): boolean;

`viewer/kinds.ts` reads both and exports `MARKDOWN_RENDER_CAP` on for its importers; `kindOf` does not change what it answers.

### §B. The record (M2; `src/services/files/links.ts`, new)

    export const LINKS_PER_SESSION_MAX = 256;
    export type LinkWhy = 'result' | 'linked'; // why a followed file admits no save; absent, it admits one
    export interface FileLinks {
      /** Records the real path for the session, as the newest, with where the link stood. Throws for a session the view
          does not know, or when the file cannot be written (memory untouched). A record that admits a save is not lowered: a
          follow that finds less makes it the newest and changes neither its `why` nor its `from`, so `from` is always the
          source that proved the strength the record has. */
      add(appSessionId: AppSessionId, real: string, from: { file: string } | { agent: string }, why?: LinkWhy): void;
      get(appSessionId: AppSessionId, real: string): { why: LinkWhy | null } | null;
      drop(appSessionId: AppSessionId): void; // never throws
      reconcile(): void;                       // never throws
    }
    export function openFileLinks(file: string, options: FileGrantsOptions): FileLinks; // the options' type is grants.ts's

The file: `{ "version": 1, "sessions": { "<session>": [{ "real": "<absolute real path>", "at": <ms>, "from": { "file": "<path>" } | { "agent": "<id>" }, "why"?: "result" | "linked" }] } }`, oldest first. The reader takes an entry with an absolute `real` and a finite `at`; `why` absent is a save; any `why` that is not `"result"` is read as `"linked"`; `from` is kept as read and never asked for. Everything else is `grants.ts`'s rule (its header, decision 21 of U6e). `spine-root.ts` opens it at `join(sessionsDir, 'file-links.json')` in a run that has the spine (null otherwise), hands it to `followView`, and to `startCheckouts` as `links`.

### §C. The command on the wire (M2)

In `src/shared/ipc/schema/files.ts`:

    export const FilesFollowInputSchema = SessionPathSchema.extend({
      from: z.union([
        z.strictObject({ file: z.string() }),                                  // the shown Markdown file's path, as its tab holds it
        z.strictObject({ agent: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }), // the subagent whose transcript holds the link
      ]),
    });
    export const FilesFollowOutputSchema = z.strictObject({ status: z.enum(['linked', 'inside', 'not-linked']) });
    'files.follow': { input: FilesFollowInputSchema, output: FilesFollowOutputSchema, owner: 'machine' }

and `outside` of `FilesReadOutputSchema` gains one optional property, `linked: z.literal(true).optional()`: present exactly on a file the daemon admits for a read alone because the file that links it admits no save. `why` keeps its two values. The agent's pattern is `laneA.watch`'s (`src/shared/ipc/schema/lane-a.ts`).

Its footprint, each beside `files.writeOutside`'s entry of the same kind: `names/files.ts` (bridged, not main-only); `grades/files.ts` (`'manage'`); `remote-unavailable.ts` (`notYet('following a link to a file outside that session’s folders')`); `wire.ts` (the minor, and in its comment "the UX wave's U6b-4c: files.follow, and files.read's answer's outside's linked"); `src/main/app.ts` (`guardCommand(['files.writeOutside', 'layout.openFile', 'files.follow'], appPageOnly(appUrl))`); `test/support/spine-lists.ts` (both lists); `test/endpoint/checkout-rows.test.ts` (among the unoffered); `e2e/support/cross-build-samples.ts` (`{ appSessionId: 'x', path: 'x', from: { file: 'x' } }`); `test/cross-build/files-schema.test.ts` (neither peer knows it); `src/shared/ipc/schema.test.ts` (the list of `files.*`, both `from` shapes valid, a `from` with both keys or neither invalid, `files.follow` not main-only).

`register.ts`: `register('files.follow', (input, context?) => files.follow({ ...input, appSessionId: session(input.appSessionId) }, remote(context), endOf(true, context)))`.

### §D. The service (M2, and M3 for `agentNames`; `src/services/files/service.ts`)

    // FilesServiceOptions gains
    links?: Pick<FileLinks, 'add' | 'get'>;                                                                             // absent: nothing is followed, and `follow` answers not-linked
    agentNames?: (appSessionId: AppSessionId, agentId: string, path: string, signal?: AbortSignal, located?: () => void) => Promise<Naming>;  // absent: a subagent source is not-linked. `located`: called once, when the request's call of the transcript locator has settled (answered, thrown, or never made)
    // FilesService gains
    follow(input: FilesFollowInput, remote?: boolean, signal?: AbortSignal): Promise<FilesFollowOutput>;
    export const FOLLOW_IN_FLIGHT_MAX = 9; // follows in the service at once, counted before the first file system call
    // FilesServiceOptions also gains  log?: (line: string) => void   // one line per record written: the session and the time, never a path

`follow`, in this order; "not linked" below means the answer `{ status: 'not-linked' }` with nothing written. The deadline is `NAMED_WAIT_MS` from the call's start.

1. `remote` (on a head that holds U6f: any caller that is not this machine's own, under a claim or not): the refusal, thrown. No `links`: not linked. `FOLLOW_IN_FLIGHT_MAX` follows already in the service: not linked, before any file system call; this follow is counted from here until its work ends (decision 7).
2. `path` not absolute: `path must be absolute`. No record for the session: `unknown app session: <id>`. `path` not lexically normal, or ending in a separator: the refusal. `path` longer than `NAMED_PATH_MAX` bytes: not linked.
3. The early answers, from which no record follows: `path` ends in a link (`lstat`), or does not resolve: not linked. Its real path is under one of the session's roots: `{ status: 'inside' }`.
4. The proof, by `from`:
   - `file`: its name, as given, is not a Markdown name: not linked. The proof waits its turn (decision 7 (ii): one at a time; with nine follows in the service at most eight wait), and everything below runs inside that turn. `openConfirmed(appSessionId, from.file, 'file', DELIVERED_OR_OUTSIDE, false, { named: true, signal })`; any failure is not linked. The descriptor's size is over `MARKDOWN_RENDER_CAP`: not linked. The whole file is read through the handle; its mime, from its first `BINARY_SNIFF_BYTES`, is not text: not linked. `fileLinkSteps(text, dirname(from.file))` is run, the event loop given back at every PAUSE and the scan ended when `signal` is aborted or the deadline has passed. A link it yields is the link when both hold: its `path` equals `path` (R3's first test), and the real path of `resolveRelative(dirname(<the source's confirmed real path>), link.written)` is the real path of `path`, both resolved then (R3's second test). None is: not linked. The handle is closed on every path. The record's `why`: none when the source's confirmed real path is not under MAWS's own folders (`isOwn`) and its mark is null (inside the folders), `chosen`, `sent`, `named` or `linked`; `linked` in every other case.
   - `agent`: `agentNames` absent: not linked. Its answer `'counted'`: no `why`; `'result'`: `why: 'result'`; `false`: not linked. The follow's place in the count of step 1 is given back only when `located` has been called as well (decision 7).
5. The record. `real = realpath(path)` once more, a failure not linked; `path` ends in a link, or `real` is not a regular file (`lstat`): not linked; `real` under a root: `{ status: 'inside' }`; for a Markdown source, `real` is not the real path the second test found: not linked. Then, in one synchronous step after the last of those awaits: `signal` aborted or the deadline passed: not linked; else `links.add(appSessionId, real, from, why)`, the log's line, and `{ status: 'linked' }`. A throw of `add` is the command's failure. This resolution is the proof of the target, as `grant`'s `realpath` and `lstat` are of the file it records: it is the last thing learned before the write and is not one act with it, so a path changed in that instant can leave a record for the real path it led to a moment before. Every later read resolves the path again and finds the record only if it still leads there (X5.3).

The service takes `written` from the same step that passed the first test, so the second test is run on that one link and no other.

The evidence. The marks become `'chosen' | 'linked' | 'sent' | 'named' | 'result' | 'link-only' | 'added'`, and `firstEvidence`, with `followed(real)` standing for `links.get(appSessionId, real)`, which answers nothing when the request carries `agent: true` and nothing when the caller is not this machine's own. The second condition is tested where the record is asked and does not rest on how the question is reached: at the pin no request of another machine reaches `firstEvidence`, but on a head that holds U6f a caller of another machine under a claim does, and a grant admits it there while a link record must not (Q6; X5.5):

| order | the test | the mark | a save |
|---|---|---|---|
| 1 | a grant (as today) | `chosen` | yes |
| 2 | `followed(real)` with no `why` | `linked` | yes |
| 3 | the agent's delivery | `sent` | yes |
| 4 | the search answers a counted form | `named` | yes |
| 5 | tests 1 and 2 once more (the search awaited) | as theirs | yes |
| 6 | for a save: nothing further | — | — |
| 7 | the search answered a result form | `result` | no |
| 8 | `followed(real)` with a `why` | `result` when the `why` is `result`, else `link-only` | no |
| 9 | another record of the Library | `added` | no |

A read's answer: `outside: { real, writable: true }` for `linked`; `{ real, writable: false, why: 'result', linked: true }` for `link-only`; the others as today. In `precheck`'s branch for a path that does not resolve, a path that has a link record (asked as a grant is there, by the path as given, and by `followed`, so for this machine's own caller alone) answers `not found: <path>`. A session with no resolvable root reaches a link record as it reaches a grant (`precheck`'s `evidence` counts `links` too).

### §E. The search over one subagent's file (M3; `src/services/files/named.ts`)

    export const NAMED_AGENT_DIRS_MAX = 4096; // directories read to find one agent's file
    // NamedPaths gains
    namesInAgent(appSessionId: AppSessionId, agentId: string, path: string, signal?: AbortSignal, located?: () => void): Promise<Naming>;

`namesInAgent` is `names` with four differences. The job: the locator is asked first, as `names` asks it (it answers from the index and walks nothing), and the job's key is the session, the transcript path `T` it answered, the agent's id and the path; the request joins or enters the queue with that key (a full queue: not named, with nothing read), so it shares a search only with requests bound to the same transcript. The walk and the open below run when the job runs, in the slot. The file: `T` must end `.jsonl`; `P` is the real path of the folder that holds `T`, and `S` is `P` joined with `T`'s name without `.jsonl`, not resolved further. `S` and `S/subagents` must each be a directory itself (`lstat`). `agent-<agentId>.jsonl` is looked for in `S/subagents` and in each folder at most three levels below it, by `readdir` with file types: a folder is an entry that is a directory, the file an entry that is a regular file, and an entry seen as a link is neither (this finds the file; it does not prove the way to it, which the open does). Exactly one match is the file; none, two, an error, or more than `NAMED_AGENT_DIRS_MAX` folders is "not named". It is opened by its path under `P` with the transcript's flags and no link on its way (`NO_LINK`, and on Linux the walk and the descriptor's own path, as `openNoLink` in `service.ts` does it: that function moves to `../fs/no-link` or is handed in, the executor's choice), so `S` and everything below it is inside the check, and it is judged a regular file on its descriptor, as today. Before the walk: `OPENS_CONFIRMED` false is "not named", with nothing opened. A test hook stands between the walk and the open. The rule: each line is read by `agentRowClaimSteps`. The memory: what the job remembers is keyed by the session, the agent's id and the path, and rests on the file's identity. The request's patience and its client's signal run from the moment it is made, and `located` is called when its locator call settles, also after the request itself was answered.

### §F. The window (M4)

`src/renderer/src/tools/code/follow.ts` (new):

    export type LinkSource = { file: string } | { agent: string };
    /** Asks this Mac's daemon to find and record the link (`files.follow`), once at a time per session and path. Sends nothing
        for no session, for a session that is not on this Mac, and for a path that is not absolute. Never throws: a failure
        is a follow that found nothing. */
    export function follow(appSessionId: AppSessionId | null, path: string, from: LinkSource): void;
    /** The follow under way for this session and path, settled (never rejected) when it is answered; null when none is. */
    export function following(appSessionId: AppSessionId | null, path: string): Promise<void> | null; // every follow under way for the session and path, whatever its source
    /** How many follows for this session and path have answered `linked` since the window loaded. */
    export function linkedCount(appSessionId: AppSessionId | null, path: string): number;
    export function resetFollows(): void; // tests

A follow is shared between calls of the same session, path and source, and no further; for a subagent source the source is the agent's id together with the engine session the session's record holds at the call (`engineSessionId`, null when the record is not known), so a click after `/clear` is a follow of its own and is never handed the answer of one made for the conversation left behind. `follow.ts` calls nothing of the store: the store reads `following` and `linkedCount`.

`tools/code/open-file.ts`: `OpenFileOptions` gains `from?: LinkSource`, held in memory alone. `place` calls `follow(appSessionId, path, options.from)` first, when `from` is set and `asked` is not `'agent'`; nothing of `from` reaches `layout.openTab` or a tab's params. `codeTranscriptActions.openFile` passes `from: { agent }` when its options hold `agent`.

`tools/code/viewer/MarkdownView.tsx`: its `openFile` passes `from: { file: entry.path }` beside U6b-4b's `base`, when `entry.appSessionId` is not null and the view is not an artifact's (`artifactView`).

`tools/code/viewer/viewer-store.ts`: `readChunk`, before it sends a `files.read`, waits until `following(appSessionId, entry.path)` answers null (it asks again after each wait), then notes `linkedCount(appSessionId, entry.path)` for that read. Where a `files.read`'s answer lands (the commit of a load, and `fail`) as a refusal, or with `outside.writable === false`: the answer is drawn, and the store then waits until `following` answers null for that session and path, outside the load (the load has ended and left `pending`). Then, when the count is higher than the read noted, and the entry of that key is still that session's, that path's and of the generation the answer landed in, it starts one more read as a re-read of a tab is started today: `readAgain(tabId, entry, 'revisit')` when the view is mounted, else the key is left in `stale` for its next mount; nothing over unsaved edits; the entry's own `agent`. It does not call `revisit`, which would take the mark from an agent's tab. The new read notes the new count, so it starts no further one. `ViewerEntry.locked` gains `'linked'`: `admissionOf` answers it for `outside.writable === false` with `outside.linked === true`, before it reads `why`; `readOnlyReason` answers it.

`transcript/view/context.tsx`: `openFile(path: string, line?: number, appSessionId?: AppSessionId | null, options?: { main?: boolean; agent?: string }): void`. `transcript/view/Transcript.tsx`: where it builds the context's actions, when `variant === 'child'` and `source.agentId` is a string, `openFile` is the mount's own with `agent: source.agentId` added to the options it is called with.

The sentence, in `tools/code/copy.ts`:

    EDITOR_COPY.readOnly.linked = 'Read-only: the file that links this one is read-only in this conversation. Choose it with File ▸ Open File… to edit it'

The label's panel offers Open File… for it, as for `result` and `added`.

`src/renderer/src/test-support/code-disk.ts`: the fake disk answers `files.follow` from a list its setup is given (`links`: per source, the paths it links, and whether each admits a save), admits a read and a save by it, and answers `unknown_command` when `daemon.older`.

`test/lane-b/renderer-guards.test.ts`, in `GUARDED_ELSEWHERE`: `'tools/code/follow.ts': { commands: ['files.follow'], guard: 'sent only for a session on this Mac (the module’s own test of the session’s machine), as a read asks by name only there (UX wave U6b-4c)' }`, and `files.follow` joins the fake disk's entry.

### §G. Files other children own, or that no table names (root UC-8)

| file | owner | the insertion | milestone |
|---|---|---|---|
| `src/shared/files/named.ts` | no row (U6c's) | `resolveRelative`, `fileLinkSteps`, `fileLinkTargets`, `agentRowClaimSteps` | M1 |
| `tools/code/viewer/kinds.ts` | U6 | the Markdown test and cap read from the shared file | M1 |
| `src/services/files/service.ts`, `register.ts`, `named.ts`; `checkouts-root.ts`, `spine-root.ts` | no row (U8c-2 inserts in `allowlist.ts`; U6f rewrites parts of `service.ts` and `register.ts`) | §D, §E and the wiring | M2, M3 |
| `src/shared/ipc/schema/files.ts` and the wire's files | the wire is the MAWS architect's, the session that keeps master | §C | M2 |
| `src/main/app.ts` | the same | one name in the guard's list | M2 |
| `transcript/view/context.tsx` | UC-3 | `agent` in `openFile`'s options | M4 |
| `transcript/view/Transcript.tsx` | UC-3; **in no table of the cut** | the child's `openFile` | M4 |
| `tools/code/viewer/viewer-store.ts`, `MarkdownView.tsx`, `FileViewer.tsx`, `tools/code/copy.ts`, `tools/code/open-file.ts` | U6 (and U5, each its strings, in `copy.ts`) | §F | M4 |
| `src/renderer/src/test-support/code-disk.ts` | no row | the fake disk's `files.follow` | M4 |
| `test/lane-b/renderer-guards.test.ts`, `test/support/spine-lists.ts`, `test/endpoint/checkout-rows.test.ts` | U9's and P5's guards | one entry each | M2, M4 |
| `e2e/cross-build.spec.ts` | the cross-build proof (U13a began its table) | one row and two scenes | M5 |
| `docs/charter.md`, C8's document | the architect's | the dated lines of M5 | M5 |

The insertions in the wire's files, in `src/main/app.ts` and in `Transcript.tsx` are reported to the architect with this document (Q8).

### §H. The scenes (M5 writes them; the architect runs them on a Mac)

| group | spec | the scene |
|---|---|---|
| `e2e` (the gate's `e2e:default`) | `e2e/sessions.spec.ts`, a new case beside "a file the transcript links opens from outside the session's folder, …", staged as that case stages its files and transcripts | "a link in a shown Markdown file opens a file from outside the session's folder, editable, and the tab comes back". The session's folder holds `guide.md`, which links `<outside>/notes.txt` by its absolute path and holds `<outside>/fenced.txt` only in a code fence; `<outside>/index.md` links `next.md` beside it. Steps: open `guide.md` from the Files tree; click the link: the viewer of `notes.txt` shows its text, `data-editable="true"`, no "Read-only"; type, save, read the bytes back from disk; `sessions/file-links.json` holds one entry for the session. Relaunch on the profile: the tab is there, reads, and saves again. Choose `index.md` with Open File… (the pick seam); click `next`: `next.md` opens. Then, through `window.maws.invoke`: `files.follow` for `fenced.txt` from `guide.md` answers `not-linked` and a read of it with `named` is refused; `files.follow` for `notes.txt` from a `.txt` file that holds the same link text answers `not-linked` |
| `e2e` (`e2e:default`) | the same spec, a case staged as its case of a background agent is (`backgroundAgentRecords` and `backgroundAgentSidecars`, `e2e/support/lane-a`: the parent's call in the session's transcript, the child's file and its meta beside it) | a subagent: the child's `assistant` text links `<outside>/by-agent.txt`, which the parent's records do not write (the call's prompt and its result do not hold the path). Open the agent by the app's own drill-in (its row, as this spec's background-agent case reaches it; the "Show child" control of `e2e/transcript.spec.ts` is the harness's and is not it), and click the link: the file opens, editable, and saves. The click is the proof of K5: a direct `files.follow` is no substitute for it, and a scene that cannot be staged is handed back unrun, with what stopped it |
| `e2e:cross-build` | `e2e/cross-build.spec.ts`, a new scene "(a followed link, both ways)", built as "(an outside file, both ways)" is | this build follows a link in a Markdown file to two text files outside the folders, one left beside the chat and one moved to a main tab, saves the first, and quits; the peer launches on the profile: beside the chat it draws its Files tree and no viewer, in the main tab the refusal it could always give, and its layout write leaves `sessions/file-links.json` as it was (compared by bytes); this build then finds both tabs, reads both, and saves once more. For F and for M |
| `e2e:cross-build` | the same spec, the scene "(outside file, on the peer’s daemon) …" gains a step | this build's window on the peer's daemon: the click on the link in the Markdown file sends `files.follow`, answered `unknown_command`, and the tab shows U6b-4b's first notice; a link to a file inside the folders opens |
| `e2e:agents`, `e2e:transcript`, `e2e:lane-a` | their specs | none is expected to change; run because `Transcript.tsx` gives a child's rows another `openFile` |
| `e2e:code` | `e2e/code-tools.spec.ts`, `e2e/code-editor.spec.ts` | none is expected to change; run because `readChunk` and `kinds.ts` are edited |

The coverage table (the comment block U13a's M5 began) gains the row "U6b-4c: `sessions/file-links.json`, a profile file the peer does not know; the tab of a followed file", with the scene's name and what the return shows. No spec file is added, so the gate's counts of spec files do not move.

### §I. What a later landing may rely on, by name

`files.follow` and its three answers; `FileLinks` and the links file's form; the mark `linked` and `outside.linked`; `fileLinkSteps`, `agentRowClaimSteps`, `isMarkdownName`; `namesInAgent`; `follow` and `following`; `OpenFileOptions.from`. A landing that offers the follow to another machine (Q6) gives `files.follow` its row at U6f's grade and lifts the test in `follow.ts`; nothing in the service's `follow` rests on the caller being this Mac's but its first step.

## The sentences a person reads

One is new: "Read-only: the file that links this one is read-only in this conversation. Choose it with File ▸ Open File… to edit it", the reason of a file that opens through a link in a Markdown file that is itself read-only for the session (Q2). Every other sentence is one that exists: a followed file that can be saved carries no label (U6e's "No label if savable"), and a link that opens nothing shows U6b-4b's notice.

## Points reported to the architect

Each has the default this document builds and the one place a ruling changes. Q1, Q4 and Q6 to Q17 are ruled (Decision Log 3): accepted as built. Q3 and Q2 are answered by the owner (Decision Log 4): each as built. Q18 and Q19 came with the delta review and are ruled too (Decision Log 6): accepted as built.

| # | the point | the default built | the one place |
|---|---|---|---|
| Q1 | **A followed link is remembered.** The record outlives the text that linked it: the Markdown file edited, the conversation cleared, the subagent's transcript gone. It goes with the session, or when 256 newer ones push it out. A chosen file's grant behaves so; a name in the transcript does not (it goes with `/clear`). | remembered, in the profile | R5; the smaller scope is the design's table, row "memory alone" |
| Q2 | **For the owner: read-only through a read-only file, and its sentence.** The owner's answer makes a file a shown Markdown file links editable. This document holds that for every Markdown file the session could itself save, and opens read-only what a read-only Markdown file links, with one new sentence. Without the rule, a path a tool's output only mentioned becomes writable in two clicks. | R4; the sentence of §F | R4's first point; `EDITOR_COPY.readOnly.linked` |
| Q3 | **For the architect and the owner, before M4: what a fault in the app's own page can do, and its trace.** R1 says it. The daemon proves what a file holds, not who wrote it, and the page may itself write a Markdown file of the folders (`files.write`, `files.upload`). So a faulty page can open, and save over, any file the daemon's user can, by writing a link and following it. The same page could already do so by sending a message that links the file (U6c's ruled limit); the difference is that a message stays in the transcript and a changed file does not. Three ways: (a) built: the record keeps where each link stood and the daemon logs each record; (b) a follow that would open a file outside the folders asks once through a confirmation main draws (per session, or per file), which a page cannot press: an act main attests, at the cost of a prompt on a click; (c) followed files open read-only until chosen with Open File…, which loses the owner's first answer. | (a) | R1; §B's `from`; the gate for (b) would stand in main, before `files.follow` is forwarded |
| Q4 | **U6b-4b's first notice now lists three ways a file from elsewhere opens** (its P13, ruled: "MAWS opens a file from elsewhere when this session's transcript links it, when you choose it with File ▸ Open File…, or when the agent sends it."). After this landing there is a fourth. The sentence stays true, since it says "when" and not "only when"; it is the one a person reads after a link in a Markdown file opened nothing. | the sentence unchanged | U6b-4b's table of sentences; the fourth way would read "…, or when a file open here links it" |
| Q5 | **A link with a heading's fragment does not open.** `[x](#usage)` and `[x](guide.md#usage)` are read as file names, in a transcript and in a Markdown file alike; a README's table of contents is made of the first. It stood so before this landing. Opening the file and going to the heading is a design of its own (the click's reading changes, in the window and in the rule together). | not built; one tracker row | the tracker |
| Q6 | **A session on another machine is not in.** After U6f a machine's owner can open an outside file there by that machine's evidence; a link in a Markdown file shown from there still opens only what that evidence admits. Lost: K1 to K5 on another machine. What a later landing needs is in §I. | no follow is sent | `follow.ts`'s test of the machine |
| Q7 | **A linked file that is not there reads as outside the folders**, not "No file at this path.", since nothing can be recorded for a path that does not resolve. A file followed once and deleted later reads "No file at this path." only where the tab's path is the real path itself; under another spelling of it, as outside the folders. | as said; one tracker row | §D, step 3; R5 |
| Q8 | **Insertions in files this child does not own.** The wire's files and `src/main/app.ts` (the session that keeps master), `transcript/view/Transcript.tsx` and `context.tsx` (UC-3). | made, each the smallest | §G |
| Q9 | **This landing reverses two of U6b-4b's pins in the window**: its L14 ("the two links add no evidence") and its N2.3 (one `files.read` and nothing else for a relative link in an outside Markdown file). Their daemon halves stand: without a follow nothing is admitted, and `names` does not read a subagent's file. | the window's cases rewritten in M4 | M4's Touches |
| Q10 | **A wire minor and a new command**, so two cross-build runs are owed (root UC-10), and the minor's number is whatever is free at the head this is built on. | as said | §C |
| Q11 | **The subagents of a conversation left behind with `/clear` are not searched**: the locator answers the session's present transcript. A drill-in of such an agent, where the window can still show one, keeps the refusal. | as said | §E |
| Q12 | **A subagent's file too long to search within 8 s behind other searches never opens its links**, as a session's own transcript of that kind does not (U6c's accepted bound). | as said; the tracker's row for the search's bound gains the case | W3 |
| Q14 | **The app-page guard is main's router's, as the outside save's is.** A local process that speaks to the daemon's own socket (`src/mawsd/front.ts`) reaches `files.follow`, as it reaches `files.writeOutside`, with no such guard; the service itself refuses only another machine. This landing claims what U6e claims and no more. Binding either act to main at the daemon's front is the work of the session that keeps master. | as U6e | R1 |
| Q15 | **The wire's rule made the new reason a property, not a value.** A window of this wave from before this landing shows a file that opens read-only through a read-only Markdown file with the sentence of a file a tool's output names. | `outside.linked`, with `why: 'result'` | §C |
| Q16 | **Three repairs of the rule that U6b-4b's first milestone made are relied on here** for a file's text (a lone carriage return, a leading byte order mark, the table's reading). Files hold such bytes far more often than an agent's text does. | X3.7 holds them as controls; a gap it finds stops M1 | M1's Decisions |
| Q17 | **A relative link in a Markdown file reached through a linked folder opens nothing** where the folder's two spellings do not share a parent, since the window and the daemon would mean different files by it (R3's second test). The notice is the first one. | fail closed; one tracker row | R3 |
| Q18 | **A follow the window gave up on can still record.** The host's ten seconds start before the request is sent and the daemon's front can hold it; the follow's own 8 s start when its handler is entered. The late record is of a link the daemon found for a request the app's page made, and the tab reads the file at its next showing or click. Closing it needs the request's expiry carried to the daemon, which is the host's. | as said; one tracker row | decision 7 |
| Q19 | **The target is proven at the last resolution before the write, not in one act with it**, as a grant's is. A path changed in that instant can leave a record for the real path it led to a moment before; a later read finds the record only while the path still leads there. | as `grant` | §D, step 5 |
| Q13 | **No `user` record of a subagent's transcript counts for a save.** If a build lets a person write to a running subagent, its file would hold that message as a `user` record; this landing reads every such record as a result form whatever its origin says, because the recorded fixtures show no origin there and the daemon has no proof of who wrote it of the kind U3a's reader gives for the session's own transcript. A link only such a record holds opens read-only. | R4's second point | `agentRowClaimSteps` |

## Proof that an executor does not run

- **The scenes of §H, on a Mac**, under the load rule: `e2e:default` (the cases of `sessions.spec.ts`), `e2e:cross-build` twice (`--peer-exact f1852de3a` and `--peer-exact 2c7044231`), and `e2e:agents`, `e2e:transcript`, `e2e:lane-a` and `e2e:code` once each, unchanged. Each needs the pushed head that holds M5; the cross-build runs need the peer builds as that group always does.
- **The macOS-guarded cases of `src/services/files/service.test.ts`**, in the Mac lane, since the follow reads through the read's boundary.
- **Class 1a** (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b4c`).
- **The branch review**: the xhigh panel (Decision Log 1).
- **The owner.** Nothing: no answer is owed before M4 or before any milestone. The two points that were the owner's are answered (Decision Log 4): Q3, "(a) record and log only", and Q2, "read-only inheritance", with its sentence. No drawn example is needed: nothing new is drawn but Q2's sentence, in a label and a panel that exist. Q5 is offered as a question for later and holds nothing up.

## Size and review

About 2,800 changed lines over about 56 files, tests and scenes included: M1 about 340 over 7 files, M2 about 1,100 over 25 (ten of them one-line entries in registries and guards), M3 about 500 over 6, M4 about 580 over 15, M5 about 380 over 6. The branch takes the **xhigh panel**: it is past the mark by size, and it widens the daemon's admission of files outside a session's folders, which the root calls a security boundary. One reviewer of the panel reads R1 to R6 and their tables against the diff, and one reads W1 to W3 against the store and the service.

## Statements to check again on the head this landing is built on

- **U6b-4b as built.** Its document is at revision 4 on this branch, and its first milestone is built (`f3568e398`). `resolveRelative` and `OpenFileOptions.base` in `tools/code/open-file.ts`; `MarkdownView` passing `base: dirname(entry.path)` for a file's tab and `base: null` for an artifact's view, told by `artifactView`; `fileUrlRest` inside `clickPath`; the notice (`ViewerEntry.failure`, `retry`, and its sentence for this Mac as P13 worded it). Read again where its executor's Decision Log moved a name, and where its L14 and N2.3 cases live. Its `retry` and this landing's re-read of W1 g both read an entry again: read that neither starts a second read where the other has one pending.
- **U6f (an outside file on another machine)**, which U6b-4b's rulings place on the head before this landing, rewrites how `register.ts` and `service.ts` tell a caller (a claim in place of `remote`), adds commands beside `files.writeOutside`, and may change `readChunk`'s test of the machine. Read again: step 1 of `follow`; where `firstEvidence` stands and what it is handed; the guard's list in `src/main/app.ts`; Q6. At U6f's `7751d2312` a caller of another machine under a claim reaches the outside evidence (`outside` in `precheck` holds for `caller.claim !== null`), and a grant admits it by design: `followed` must answer nothing for it, in `firstEvidence` and in the branch for a path that is gone (X5.5 is written against that head's caller).
- **U6b-4a ("Open in")** adds `files.admit`, a read of the daemon's admission: read again that it asks through `precheck`, so that a link record answers it as a grant does; if it has an evidence order of its own, the record joins it at the same place.
- **U6b-3 and U6b-5** edit `FilesTool.tsx` and the Files tab's keyboard: nothing here rests on them, but M4's suites in `tools/code/files/` are theirs too.
- **Any landing that takes a wire minor**: the number in §C's comment follows the head.
- **Any landing of U3 or U8 in `transcript/view/Transcript.tsx`**: read again where the context's actions are built.

## The pull request

Its body names the class 1a run, the panel's verdict, the two cross-build runs and the residue, and carries the charter's dated entry and K1's dated line where they stand. Tracker rows: it closes the row of 2026-11-13 (a link drawn inside a subagent's drill-in) and U6b-4b's row for the two links; it adds Q5 (a heading's fragment), Q7 (a linked file that is not there), a session on another machine (Q6), and that the differential's direction for a file is seeded over static drawings only.

## Surprises & Discoveries

- Observation: U6e already stores, in a profile file neither older build names, the daemon's own record of one file for one session, and `firstEvidence` already reads it with no key on the request. The stored-tab problem is the same shape, so its answer is a second such record and not a key.
  Evidence: `src/services/files/grants.ts`; `chosen(real)` in `precheck`; U6e's document, Interfaces §A, the row for `sessions/file-grants.json`.
- Observation: a subagent's records, read by today's rule, already split as the owner's "same rule" needs: `assistant` records are counted, and a `user` record is never the person's own, because the engine writes no `origin` there.
  Evidence: `test/fixtures/transcripts/9a1d4262-…/subagents/agent-ad286defbc77bc090.jsonl` and `test/fixtures/lane-a/subagents/agent-a654aa674a1f1dd0a.jsonl` (every record `isSidechain: true`, no `origin`); `personsOwn` in `src/shared/files/named.ts`.
- Observation: a subagent's file is not at one path: a workflow run's agents are under `subagents/workflows/<runId>/`, up to three directories down.
  Evidence: `MAX_DEPTH` and `WORKFLOW_RUN` in `src/engine-host/fs/subagents.ts`.
- Observation: the agent's id is in every child mount's `source` and in no click.
  Evidence: `useRowSession` in `transcript/view/context.tsx` cuts it off the store key; `Transcript.tsx` reads `source.agentId` for the waiting requests alone.
- Observation: which files are Markdown is decided in the window alone today.
  Evidence: `MARKDOWN` and `MARKDOWN_RENDER_CAP` in `tools/code/viewer/kinds.ts`; no reader under `src/services/` or `src/shared/`.
- Observation: a fragment is read as part of a file's name, so a README's table of contents is made of links that open nothing.
  Evidence: `LINE` in `src/shared/files/named.ts` and in `markdown/Link.tsx` cut `#L<n>` and `:<n>` alone.

- Observation: a relative link written `[n](notes.md:7)` opens nothing, in the rule and in the window alike: `notes.md:` reads as a URL scheme. `./notes.md:7` and `notes.md#L7` open. In a transcript, whose paths are absolute, it does not arise; in a Markdown file it is a plausible spelling. Not changed here (the click's reading is shared and pinned); it joins Q5's tracker row.
  Evidence: M1's commit `cf9d0644b`, which pins it as a fixed case of the rule and the window.

- Observation: a snapshot's write switch (`MAWS_ROUTES_WRITE`, `MAWS_ADDRESS_PATHS_WRITE`, `pnpm wire:manifest`) leaves the VM's checkout of the branch dirty, so the helper's next checkout of a newer head fails until the written files are discarded there.
  Evidence: M2's report (`task-2-report.md` in the run's workspace); the helper checks out with `git checkout -q --detach`.

## Decision Log

1. **2026-11-18 · The verification call.** This document gets an adversarial review before an executor starts (the design, the trust rules and buildability). The branch gets the `doperpowers:review-code` xhigh panel, by size (about 2,500 changed lines, about 55 files) and because it widens the daemon's admission of files outside a session's folders. Class 1a on GitHub Actions is the gate of record; the scenes of §H and the two cross-build runs run on a Mac.

2. **2026-11-18 · The adversarial review of the first writing (`9d8b0216f`): fifteen findings, each read in the cited code, all accepted.** It judged the record sound for every later read of a tab while the record lives, and the claims about the profile file and `unknown_command` on both older builds right. First rank. (1) The page can write its own evidence (`files.write`, `files.upload`), so its reach is not bounded by links that exist; U6c's ruled limit already had that reach by a message, and what differs is the trace: R1 rewritten, the record keeps `from`, a log line, and the choice put to the architect and the owner (Q3). (2) A relative link resolved against the spelling the window sent let the asker choose its meaning through a linked folder: R3's second test, against the folder the daemon confirmed (X3.6; Q17). (3) The subagent's file was found by name and opened by path: found by a walk that follows no link, opened with none on its way (R2; X2.9; §E). (4) A new value of `outside.why` is a breaking change by the wire's own rule: an optional property, `outside.linked`, with `why: 'result'` as what an earlier window reads (decision 11; §C; Q15). (5) Line endings and a leading byte order mark: U6b-4b's first milestone, merged here, repairs the rule; X3.7 holds a file's cases (Q16). (6) A source under MAWS's own folders gave a save: R4 reads `isOwn` of the source (X2.10). (7) The target was resolved before a proof that can take seconds: resolved again at the write, and a path that ends in a link is never `inside` (§D steps 3 and 5; X5.10, X5.11). (8) The guard is main's router's: said so, as U6e's is (R1; Q14). (9) Costs ran before their bounds, and a request the host gave up on could still record: the gate and the queue are entered first, the walk runs in the slot, one deadline read before the write (decision 7; X5.12). Second rank. (10) A read sent before the click passed no wait: `followed` (W1 g to i; §F). (11) M1 could not prove what only M4 sends, and M2 would have changed a type the window reads: X3.4 split, the property is optional, X2.8 moved to M3. (12) Both older windows draw a side tab that holds a file as their tree: the stored table and the scene stage both placements. (13) A record cannot answer `not found` by a spelling it did not prove; a tab can outlive its record: both said (R5; Q7; K2). (14) Four negative tests were not constructible as written (X2.5, X3.2, K6, K8): restated. (15) The subagent's scene clicks, staged as the spec already stages an agent, with no direct request in its place; the gate's group is `e2e:default`.
3. **2026-11-18 · ux-wave's rulings.** Q1, Q4 and Q6 to Q17 are accepted with the defaults this document builds. Q8's insertions are named insertions (UC-8); the ones in `src/main/app.ts` and in the wire's files are told to the MAWS architect when the pull request goes up. Q3 and Q2 are put to the owner, with (a) recommended for Q3 (the record keeps where the link stood and the daemon logs each record; no confirmation) and the read-only rule as built for Q2; their answers come before M4, and M1 to M3 do not wait. Revision 2 gets one delta review, against the first review's fifteen findings and R1 to R6; if it finds the document can be dispatched there is no third.
4. **2026-11-18 · The owner's answers on Q3 and Q2**, received through ux-wave. Q3 (what a fault in the app's own page can do, and its trace): "(a) record and log only". The record keeps where each link stood and the daemon logs each record written; no confirmation is drawn before a follow, and a followed file does not fall back to read-only. Q2 (a file linked only by a Markdown file that is itself read-only for the session): "read-only inheritance", as R4 builds it, with the sentence of Interfaces §F. Both are the defaults this document already builds, so no section moves but the ones that said an answer was awaited. No further answer is needed before M4.
5. **2026-11-18 · The delta review of revision 2 (`2f753d03a`): nine findings, each read in the cited code, all accepted.** It judged the first review's fifteen answered but for four answered in part (the subagent's file, the target's identity, the bounds, the read sent before the click), and its verdict on revision 2 was "do not dispatch". First rank. (1) The session's own folder was resolved before the no-link check began, so a link there could stand another session's folder in its place: the check starts at the folder that holds the transcript (R2; §E; X2.9). (2) On a head that holds U6f a caller of another machine under a claim reaches the outside evidence, and the record was skipped only for the agent's open: a link record answers this machine's own caller alone, where it is asked (§D; X5.5; "Statements to check again"). (3) A subagent's job keyed before its transcript was known could hand a request made after `/clear` the answer of the conversation left behind: the key holds the transcript, as the search's own does (§E; W3; X2.11). (4) The deadline starts at the handler, later than the host's: what it does not promise is said, and X5.12 claims only the follow's own (decision 7; Q18). (5) X5.10 placed its change where both resolutions would see it, and "at the write" claimed more than a resolution gives: two hooks, and the proof stated as the last resolution, as a grant's (§D step 5; X5.10; Q19). (6) The early answers resolved roots and the target before any bound: every follow is counted before its first file system call (decision 7; K13). Second rank. (7) `followed(tabId)` could not tell which read or session it was for, and made an ordinary first open read twice: a count of follows answered `linked`, noted by each read as it is sent (W1 g to i; §F). (8) The service needs a link's written path and `linkSteps` is private: `fileLinkSteps` yields it (§A). (9) A weaker follow replaced the `from` of a stronger record: `from` stays the source of the strength the record has (§B; X4.4). Folded with them: the reach in R1 qualified by what the outside save writes; `files.readResolved` among the outputs that share the schema; the earlier reader's test written out in `schema.test.ts`, no new snapshot; decision 4 and K7 worded to what the code does; X5.13 and X5.14 for a deleted file's two spellings and a save after a record is gone; K6 and K7 in a session with no other evidence; the scene's drill-in is the app's own.
6. **2026-11-18 · ux-wave's rulings on Q18 and Q19, and the last round.** Q18 (a follow the window gave up on can still record) is accepted as built, with its tracker row. Q19 (the target is proven at the last resolution before the write, as a grant's is) is accepted as built. Revision 3 gets one narrow read, confined to the six first-rank passages of the delta review (R2 and §E; §D steps 1 to 5 with the count of follows in the service; decision 7; X5.5; X5.10; X2.11) and to the replacement of `followed` (W1 g to i; §F). It is the last round on this document: what it leaves goes to the branch's panel.
7. **2026-11-18 · The narrow read of revision 3 (`8ef361278`): five findings, each read in the cited code, all accepted; the last round.** It judged the passage on another machine's caller (§D's `followed`, X5.5) to hold against U6f's code, and the session-folder substitution closed on macOS. First rank. (1) On Linux without `/proc/self/fd` the open's confirmation checks nothing (`confirmOpened`, `src/services/fs/no-link.ts`), so the prescribed open could not refuse a folder swapped after its walk: a subagent's file is a source only where `OPENS_CONFIRMED` holds, as the upload's read already requires; the walk is said to find the file and not to prove the way (R2; §E; X2.9). Second rank. (2) A refused read that lands while the follow is still under way compared a count that had not moved yet: the comparison waits for the follow, the re-read goes by `readAgain` or `stale` and not by `revisit` from inside `fail`, and X5.14's Save is after `linked` (W1 g; §F). (3) M3's Decisions still queued before the transcript was known, and the window shared a subagent's follow across `/clear`: M3 follows §E's order, and the window's key holds the engine session (§F). (4) The transcript locator can touch the disk and outlive a request's patience: a follow keeps its place until its locator has answered (`located`; decision 7; K13). (5) X5.10 had no second hook for a subagent and no outcome for a swap to another outside file: named. Its verdict on revision 3 was "do not dispatch", for (1). Revision 4 is not read again: what it leaves goes to the branch's panel, which reads R1 to R6 and W1 to W3 against the diff.

8. **2026-11-19 · Refresh at the build's start: `ux-wave/U6b-4b` merged at `796895fe8`** (its five milestones, U6f and the batch 5 union; merge `aa95d32c3`), by ux-wave's instruction, and "Statements to check again" read against that head. U6b-4b as built holds `resolveRelative` and `OpenFileOptions.base` in `tools/code/open-file.ts`, `MarkdownView`'s `artifactView` and `base: artifactView ? null : dirname(entry.path)`, the notice's `retry` and `retrying`; its L14 and N2.3 cases are in `tools/code/viewer/viewer.test.tsx` (the `describe` near line 2520). U6f is on the head, so four names in this document read as follows there, with the intent unchanged. (a) The service takes a caller, `FilesCaller` (`THIS_MACHINE`, `UNCLAIMED`, or a claim), not a `remote` flag: §D's `openConfirmed(…, false, { named: true, signal })` is `openConfirmed(…, THIS_MACHINE, { named: true, signal })`, and step 1's refusal is for every caller that is not `THIS_MACHINE`, claimed or not; `follow`'s signature takes the caller where §D writes `remote`, and `register.ts` hands it as it hands `read`'s. (b) The guard's list is no longer written in `src/main/app.ts`: it is `APP_PAGE_ONLY` in `src/main/files/open-file.ts` (`[...OUTSIDE_ACTS, 'layout.openFile']`), and `files.follow` is appended there, **not** to `OUTSIDE_ACTS` (`src/shared/files/outside.ts`), which is the list U6f offers to another machine under a claim: the follow is offered to no machine (R1, Q6), so its `REMOTE_UNAVAILABLE` row is a `notYet` of its own, as §C words it. `src/main/app.ts` is then not edited. (c) `firstEvidence` and `chosen` stand in `precheck` as §D describes, and the missing-path branch is `chosen(path) || namesIt()`; `followed` answers nothing for a caller that is not `THIS_MACHINE` (X5.5, against this head's caller). (d) The wire's minor is 57 at this head (U6f's), so this landing's is 58. U6b-4a's `files.admit` is not on this head; nothing here waits for it.

9. **2026-11-19 · M1's means (the executor's, accepted).** The differential's seeded alphabet gains, beside the five fragments X3.4 names, two whole relative links, since the fragments alone almost never form one; the file direction is held inside the two seeded loops the differential already has, so each string is drawn once; a chip is resolved for the comparison exactly as `openFile`'s `resolvedPath` resolves it, from the raw path the click hands on. X3.7's window half draws `MarkdownView` itself (a fake main) and reads the chips' titles without clicking. `agentRowClaimSteps` lowers only a `{ names: true }` answer of a record that is not `assistant`; a waiting or a read-only answer passes as `rowClaimSteps` gives it. No test of `isMarkdownName` beside `kindOf`'s suite, which passes unchanged and is the behaviour (a test of the moved constant would restate the edit). Every file M1 changed is reached by `apps/desk-web`, whose typecheck, build and tests joined M1's proof.

10. **2026-11-19 · M2's means (the executor's, accepted unless the review reverses one).** Two test hooks of the suite, `after-follow-read` (after the source's text is read) and `before-follow-record` (after step 5's resolution, before the synchronous step), hold X5.8, X5.10 and X5.12; X5.12 moves the clock past the deadline at a hook rather than waiting 8 s. X3.5 is held by a text the rule refuses at its cap (a quote tower) before the link, not by one that passes `WORK_PER_CHAR` first, since no text was found that reaches the work budget before a cap; the test counts the turns given back and they equal the scan's pauses. A follow waiting for its turn at the one-at-a-time Markdown proof leaves at its deadline or when its client ends, and gives up its place in that line alone. A follow whose `agentNames` rejects gives back its place in the count itself, so a fault cannot hold one of the nine until a restart. The log line is "a link followed for session <id> at <time>" in the `[files]` log. In the links file a `why` absent admits a save, and any other value but `"result"` (`null` included) is read as `"linked"`. Of two read-only follows of one path, the newer one's `why` and `from` replace the older's (R4 forbids only lowering a record that admits a save). `CheckoutsDeps.links` is required, as `grants` is; a wiring test in `spine-root`'s suite sits beside U6e's grants case. The snapshots' diffs were what Concrete Steps predicts, all additive, with one more: `files.readOutside` (U6f's) shares the read's output schema, so its `outside` gains `linked` too. Every milestone that edits the wire is reached by `apps/desk-web`, whose typecheck, build and tests joined M2's proof.

## Outcomes & Retrospective

Pending — written at finish.
