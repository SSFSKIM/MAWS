# UX wave · U6, landing U6b-4c: a link inside a shown Markdown file, and in a subagent's transcript

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*): in its item "O-37 · a linked file opens in MAWS, and a refusal says why", the paragraphs "What became of U6c's list for U6b's design" and "The two links of a shown Markdown file and of a subagent's transcript (answered 2026-11-18 (UTC))". Board ticket 673.
>
> **Where this landing comes from:** U6b-4b's document (`docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md`, cited below as *U6b-4b*), its section "The two links" and its point P1, left both links to a landing of their own with the reasons a design must answer. The outside-file rules it stands on are U6c's (`docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md`) and U6e's (`docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md`), cited by those names.
>
> **Parent pin:** `c0e4555f4`, the head of `ux-wave/U6b-4b` when this was written: the code of `ux-wave/U6b-2` (`eb7f378ee`, master `bf0b3d2a4` plus U6b-2) and U6b-4b's document, not yet built. Every statement about the code below was checked against that code. The root and the child's file are read on the branch `ux-wave-spec` (`5615f136f`), which holds the owner's two answers of 2026-11-18.
>
> **Branch:** `ux-wave/U6b-4c`, cut from `ux-wave/U6b-4b`. **This landing is built on U6b-4b as built**: it consumes that landing's `resolveRelative`, `OpenFileOptions.base`, the `artifactView` prop and the notice (its Interfaces §B and §C) by those names. "Statements to check again" lists what to read on the head it is built on. This document carries the design the two links needed, the constraints and the milestones.

## Purpose

A Markdown file shown in MAWS is full of links: to the file beside it, to a file in another folder. So is the transcript of a subagent, which the person reads in its drill-in. Today a click on such a link opens the file only when it is inside the session's folders, or when the session's own transcript happens to write the same path. Otherwise the tab reads that the file is outside the folders, although the person is looking at the text that links it.

After this landing, on this Mac: a link in a shown Markdown file opens the file it names, wherever it is, editable, written only when the person presses Save; a relative link in a Markdown file that itself stands outside the folders opens the file beside it; a link or a file chip in a subagent's transcript opens by the rule the session's own transcript has. The tab comes back after a relaunch and still saves. What decides is still the daemon alone: the window says where a link stands, and the daemon reads that file itself and finds the link, or opens nothing.

How to see it working: in a session on this Mac, open a Markdown file of the session's folder whose text holds `[notes](/<a folder outside>/notes.txt)`. Click the link: the file opens beside the chat; type, press ⌘S, and the file on disk holds the change. Quit and relaunch: the tab is there and saves again. Open a subagent's drill-in whose text links a file outside the folders and click it: the same. Acceptance K1 to K14 below is the whole list.

## Progress

- [x] (2026-11-18) U6b-4b's P1, the child's paragraphs, U6c's and U6e's documents and the code read against the pin; the design made; the document written.
- [ ] The adversarial review of this document, and what survives absorbed.
- [ ] The architect's rulings on the points reported (Q1 to Q13).
- [ ] M1 — The rule reads a Markdown file's links and a subagent's records.
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
5. One new command of the files service, `files.follow`, and one new value in a read's answer (`why: 'linked'`), with the wire's next minor.
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
- **A fragment is part of the file's name.** `clickPath('guide.md#usage')` is `guide.md#usage`, and `clickPath('#usage')` is `#usage`: only `#L<n>` and `:<n>` are cut off as a line.

## The design: the daemon records a followed link

**What had to be answered.** U6b-4b's P1 gave four reasons the two links were no small addition. The daemon cannot find the Markdown file by itself, so it must be told; told on the request, every later read of the same tab needs the telling again (shown again, restored, drawn in a frame, opened outside MAWS, saved), which is a key on four commands and a value stored with the tab, and a main file tab may store none (UC-14). And a session's subagent files are too many to search at every click.

**The answer.** The telling happens once, at the click, and what the daemon found is the daemon's to keep.

1. A click on a link in a shown Markdown file, or in a subagent's transcript, sends one new command before the tab's first read: `files.follow`, with the session, the path the click asks for, and where the link stands: `{ file: <the Markdown file's path> }` or `{ agent: <the subagent's id> }`.
2. The daemon checks the source itself. For a file: it admits and opens the Markdown file for that session exactly as a read of it would, reads its text through that descriptor, and looks for an inline link whose path, read as the click reads it and resolved against the file's folder, is the path asked. For a subagent: it finds that agent's file under the session's own transcript folder and runs the search over that one file. The window's word is only where to look.
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

**What the design costs.** One command and one wire minor, so two cross-build runs (root UC-10); a profile file; and one sentence. A followed link is remembered: the record outlives the text that linked it, as a chosen file's grant outlives the chooser (Q1).

## The trust rules

This landing widens what opens from outside the folders. Each rule is stated with what it leaves alone and the cases that must stay refused. Every such case is a test in the file named, with its control in the same test: the same request, admitted where the link is there.

### R1 · Who may ask, and what the asking is worth

**The rule.** `files.follow` is answered only for a live page of the app's own window (`appPageOnly`, the guard `files.writeOutside` has), never for a caller on another machine (the service refuses `remote` itself, where the act runs, and the endpoint offers the command to no machine), and only for a session the daemon knows. What the request says is a place to look. It is no evidence: a request that names a file that does not hold the link, or an agent whose transcript does not, changes nothing and learns nothing but "not linked".

**What it does not stop, said plainly.** The daemon cannot know that a person clicked. A fault in the app window's own page could follow, unseen, any link that stands in a Markdown file the session may read, or in one of its subagents' transcripts, and then read that file and save over it. Before this landing such a fault could reach what the session's transcript names by a counted form; now it can also reach what those files link. A session's folders hold Markdown the person never read and the agent never wrote (a dependency's README), and such a file can link any absolute path. This is the reach the owner's answers give a link, it is of the kind U6e's write rule already states ("the rule does not stop a fault in the app window's own page code"), and it is reported (Q3). It still cannot reach a file nothing links.

**Stays refused, as tests.**

| # | the case | must be | test file |
|---|---|---|---|
| X1.1 | `files.follow` asked by main itself, by a presentation window's page, and through `dispatchLocal` | `forbidden_sender`; no record | `src/main/daemon-root.test.ts`, `src/main/files/open-file.route.test.ts` |
| X1.2 | `follow` called with `remote` true, for a link that is there | the service's refusal; the links file untouched. Control: the same call, not remote, records | `src/services/files/service.test.ts`, `src/services/files/register.test.ts` |
| X1.3 | the endpoint's offers | hold no row for `files.follow`; `REMOTE_UNAVAILABLE` holds one | `test/endpoint/checkout-rows.test.ts` |
| X1.4 | an unknown session; a relative `path`; a `path` that is not lexically normal or ends in a separator; a `path` longer than `NAMED_PATH_MAX` bytes; an `agent` that holds `/`, `.` or 129 characters | the first two fail as a read does (`unknown app session: …`, `path must be absolute`); the next is the refusal; the long path is `not-linked`; the agent is refused at the schema, before the service | `service.test.ts`, `src/shared/ipc/schema.test.ts` |
| X1.5 | a follow for a path the source does not link, then a read of that path with `named: true` | `not-linked`; the read is refused with the refusal sentence; `file-links.json` is not written | `service.test.ts` |

### R2 · The source is admitted as a read admits it, and the daemon reads it itself

**The rule, for a file.** The daemon opens `from.file` by the read's own boundary (`openConfirmed`, for that session, as a person's request that asks by name: `named: true`, no `agent`), so the source is a file the session could show: inside the folders, or outside them with evidence of its own, a link record included. It then reads the text from the descriptor it confirmed, never again by path. Three things make the source a Markdown file the window draws as one, by tests the window and the daemon now share (Interfaces §A): its name (as the request gave it) ends `.md`, `.mdx` or `.markdown`; the file is at most `MARKDOWN_RENDER_CAP` bytes; and the daemon's own reading calls it text (the same `fileMime` and `isTextMime` that give a read its `utf8` encoding). The text is decoded as a read decodes it. A file the window would show as code, as a head or as a row links nothing.

**The rule, for a subagent.** The daemon finds the file. It takes the session's own transcript path from its locator (the one the search uses), reads the folder of that name beside it, and looks under `subagents/` for `agent-<id>.jsonl`, in that folder or at most three directories below it, by reading directories alone. Exactly one such file is the source; none, or two, is `not-linked`. The window never names a transcript's path.

**What it leaves alone.** What the Markdown file's tab shows and what the daemon reads can differ: text typed and not saved, or a file changed on disk since it was drawn. The daemon's reading decides, so a link that is only on the screen opens nothing, and a link the person did not see can be followed only by a request that asks for exactly that path (R1).

**Stays refused, as tests** (`src/services/files/service.test.ts` unless named).

| # | the case | must be |
|---|---|---|
| X2.1 | `from.file` outside the folders, with no evidence for it, holding the link | `not-linked`; no record. Control: the same file once the person chose it |
| X2.2 | `from.file` named `notes.txt`, `README` and `guide.md.bak`, each holding the link text | `not-linked` |
| X2.3 | a `.md` file of 1 MiB and one byte holding the link in its first line; a `.md` file whose first bytes hold a NUL | `not-linked`. Control: the same link in a file of exactly 1 MiB |
| X2.4 | `from.file` that ends in a symlink to a Markdown file inside the folders; `from.file` not lexically normal | `not-linked` (the read's own refusal), no record |
| X2.5 | the source swapped for another file between the daemon's check and its open (the suite's `before-open` hook) | the read's boundary refuses; `not-linked` |
| X2.6 | a session with two files `agent-<id>.jsonl` under `subagents/` in different directories; an id with no file; a file four directories down | `not-linked` (`src/services/files/named.test.ts`) |
| X2.7 | an agent's file of another session's transcript folder, asked under this session | `not-linked`. Control: asked under its own session, `linked` |
| X2.8 | a session whose locator answers no transcript | `not-linked`, and nothing is read |

### R3 · A link is read as the click reads it

**The rule.** For a Markdown file, the paths its text links are `fileLinkSteps(text, base)` (Interfaces §A): each path `linkSteps` yields, resolved by `resolveRelative(base, path)`, with `base` the folder of `from.file` as the request gave it, lexically. That is the window's reading to the letter. U6b-4b's `MarkdownView` resolves a relative chip against `dirname(entry.path)` with the same `resolveRelative`, which this landing moves into the shared rule so that both sides hold one copy, and `from.file` is `entry.path`. The path asked is compared with each, whole, byte for byte. So everything U6c proved of a link's reading holds here with no second proof: a link in a code fence, in inline code, in `$$` math, as an autolink, as a reference, in a table cell the window does not draw, with a character reference or a letter written as `%XX`, links nothing. The `file:` form is U6b-4b's, through the same `clickPath`.

For a subagent, the rule is `rowClaimSteps` on each record of its file, as on the session's: the link form, the chip of a read or an edit, an anchored comment's path, results waiting for their calls.

**A relative link can lead anywhere, and that is the answer given.** `[x](../../<elsewhere>/secret.md)` in a shown Markdown file resolves to an absolute path, and the daemon finds the same. The owner's second answer opens the file beside an outside Markdown file "by the same rule", and an absolute link in the same file could name the same path. U6b-4b's rule that a relative link *in the transcript* names nothing is untouched: the transcript has no folder.

**Stays refused, as tests.**

| # | the case | must be | test file |
|---|---|---|---|
| X3.1 | a Markdown file whose text holds the path in prose, in a code span, in a fence, as `<…>`, as a reference `[x][l]`, in the third cell of a row under a two-cell head, and as an image `![x](…)` | `fileLinkTargets` holds no such path; the follow is `not-linked`. Control: the inline link | `src/shared/files/named.test.ts`, `src/services/files/service.test.ts` |
| X3.2 | `[x](sub/a.md)` in `/work/docs/guide.md`, asked for `/work/sub/a.md` and for `/work/docs/sub/b.md` | `not-linked` for both. Control: `/work/docs/sub/a.md` | the same two |
| X3.3 | the path asked differs from the linked one in letter case, or in Unicode normal form | `not-linked` | `service.test.ts` |
| X3.4 | the differential, for a file | for strings drawn in a `MarkdownView` whose entry stands at `/base/dir/doc.md`: what a chip's click asks to follow (`path`, with `from.file`) is among `fileLinkTargets(text, '/base/dir')`; over the seeded strings, with the relative fragments `./`, `../`, `a/`, `#u`, `?q` and a carriage return added to the alphabet, every path the rule names is asked by a chip | `src/renderer/src/tools/code/named-links.test.tsx` |
| X3.5 | a text whose scan passes its budget (`WORK_PER_CHAR`) before the link | `not-linked`; the scan yields at every pause (a test counts the turns given back) | `service.test.ts` |

### R4 · A link is no stronger than what writes it

**The rule.** A record says whether the file may be saved.

- A link in a Markdown file: the file may be saved when the Markdown file itself is inside the folders, or outside them by a mark that admits a save (chosen, sent, named by a counted form, or a link record that admits a save). When the Markdown file is itself read-only for the session (named only by a tool's result, only in the Library, or reached through such a file), what it links opens read-only, `why: 'linked'`.
- A link in a subagent's transcript: a counted form admits a save, and only an `assistant` record counts there. A `user` record or an attachment of a subagent's file is never the person's own text, whatever its fields say: it is a result form, `why: 'result'`. The search over a subagent's file reads it so by a guard of its own (`agentRowClaimSteps`), and does not rest on the engine leaving `origin` out.
- A record that admits a save is never lowered by a later follow that finds less; a read-only record is raised by one that finds more.

**Why.** U6e's write rule keeps text the agent only read from admitting a save. Without this rule one click would launder it: a tool's result names a Markdown file (read-only), and that file's text links the path. The owner's first answer speaks of a file a shown Markdown file links; this rule holds it for every Markdown file the session could itself save, and reports the rest (Q2).

**Never written, whatever the record says.** A file in MAWS's own folders (`own`, checked at every write on the confirmed real path, unchanged); anything for a caller from another machine.

**Stays refused, as tests** (`service.test.ts` unless named).

| # | the case | must be |
|---|---|---|
| X4.1 | a Markdown file outside the folders that only an MCP tool's result names, linking `/out/b.txt`; follow, read, save | `linked`; the read answers `outside: { writable: false, why: 'linked' }`; `files.writeOutside` is refused and the bytes are unchanged. Control: the same once the person chose the Markdown file: a new follow, then the read answers `writable: true` and the save writes |
| X4.2 | a Markdown file only an added record of the Library admits, linking a file | as X4.1 |
| X4.3 | a subagent's file whose only mention of the path is in its first `user` record, in a `user` record forged with `origin: { kind: 'human' }`, and in an MCP tool's result | `namesInAgent` answers `'result'` for each; the record is read-only, `why: 'result'`; the save is refused (`src/shared/files/named.test.ts`, `src/services/files/named.test.ts`, `service.test.ts`). Control: the same path in an `assistant` record's text answers `'counted'` |
| X4.4 | a record that admits a save, then a follow that finds only a result form | the record still admits a save |
| X4.5 | a link record for a file under MAWS's own folders | the read answers `own: true`; the save answers `not writable` |

### R5 · The record

**The rule.** A link record is one real path, for one session, with the time and, when it admits no save, why. It is written only by the daemon, only at the end of a follow that found the link, for a target that resolves, is a regular file and is outside the folders (a target inside them needs none: `inside`). It admits that file and nothing beside it, for that session and no other, and it is asked exactly where a grant is asked: a request of this machine that asks by name or is a save, and that the agent did not ask for. In `firstEvidence` a record that admits a save stands directly after the grant, and again after the search, as the grant does; a read-only record stands after the transcript's result form and before the Library's record, so a counted name always wins over it.

**Its life.** Records are `<profile>/sessions/file-links.json`, written whole and atomically before the daemon's memory changes, read once at the daemon's start, so a relaunch of the app or of the daemon changes nothing. A session holds at most 256, the oldest going first; a follow of a path that has a record makes it the newest. A session's records go when its record is removed. The failures are U6e's decision 21, unchanged: a file this build cannot read holds nothing for the run and is left as it is until the next change; a write that fails fails the follow, memory untouched.

**An open the agent asked for is never admitted by a link record** (`agent: true`), as it is never admitted by a grant: following a link is the person's act.

**A path that is gone.** A request for a path that has a record and no longer resolves answers `not found: <path>`, as a chosen file's does. A link whose target does not exist when it is followed records nothing, and its tab reads as any unadmitted path does (Q7).

**Stays refused, as tests.**

| # | the case | must be | test file |
|---|---|---|---|
| X5.1 | a record for session S; the same path read under session T | refused | `service.test.ts` |
| X5.2 | a record; a read with `agent: true` | refused. Control: without `agent`, admitted | `service.test.ts` |
| X5.3 | a record; the path later resolves to another real path (its folder replaced by a link) | refused, and the save answers the refusal, not `FILES_MOVED` | `service.test.ts` |
| X5.4 | a record; a read with no `named` | refused, as a chosen file's is | `service.test.ts` |
| X5.5 | a record; a request from another machine with `named` | refused | `service.test.ts` |
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
4. **The target is checked before the source is read**: resolved, a regular file, outside the folders. A follow therefore costs a source's read only where a record could be written.
5. **The Markdown test is shared.** `MARKDOWN_RENDER_CAP` and the test of a Markdown name move to `src/shared/files/markdown.ts`; `viewer/kinds.ts` reads them from there. The daemon then calls a Markdown file what the window draws as one.
6. **`resolveRelative` moves into `src/shared/files/named.ts`**, and `tools/code/open-file.ts` exports it on, as it does `normalizeLexically`. One copy is what makes R3 need no second proof.
7. **One scan at a time.** A Markdown file's scan runs behind a gate of the service's own: one at a time for the daemon, at most eight waiting (`FOLLOW_WAITING_MAX`), a ninth answered `not-linked` at once; it gives the event loop back at every pause of the rule. A subagent's search takes the search's own slot and bounds.
8. **The search over a subagent's file is the search**, with two differences: the file, and `agentRowClaimSteps`. What it remembers is keyed with the agent's id, so it never meets an entry of the session's own transcript. It shares the 256 entries, the eight waiting jobs and the 8 s.
9. **The agent's id reaches the click through the mount, not through each click source.** `Transcript.tsx`, for `variant === 'child'` with a `source.agentId`, gives its rows an `openFile` that adds `agent` to the options. Editing each click source (the link, the two chips, the comment) lost: four places, and a fifth forgotten later would silently keep today's refusal.
10. **The window waits for the follow where it reads**, in `readChunk`: a tab opens at once and shows its loading state, as a link the transcript names does while the search runs. Waiting before the tab opens lost: up to 8 s with nothing on screen.
11. **A new `why`, `linked`, with its own sentence** (Interfaces §F). Reusing `result` lost: "only a tool's output names this file" is false of a file a read-only Markdown file links.
12. **The grade of `files.follow` is `manage`**, as the outside save's: it writes an admission a save may use.
13. **`follow` answers three words and no reason**: `linked`, `inside`, `not-linked`. Why a follow found nothing (no such source, no such link, no such target) is not said, so the command tells nothing about what exists outside the folders that a read would not tell.
14. **No watch and no new listing.** A followed file is read again as every outside file is: when its tab is shown again or the link is clicked again.

## The sequences that must hold

**W1 · The click, the follow and the read.** The states of one session and path in the window: no follow; a follow under way; none again. `follow` is called before the tab is placed. (a) While the follow is under way the tab shows its loading state and no `files.read` for that session and path is sent; when it is answered, exactly one first read is. A test holds the follow open and counts. (b) A follow that fails (`unknown_command` from a daemon of an older build, `timeout`, `host_unavailable`, `forbidden_sender`) or answers `not-linked` settles the wait the same way: the read is sent, and what it answers is drawn, the notice included. A follow never rejects into the store. (c) A second click on the same link while the follow is under way starts no second follow. (d) The tab closed, or the same path opened for another session, while the follow is under way: the read that was waiting lands nowhere (U6c's W2, unchanged), and the other session's read does not wait. (e) An open kept for an unread layout (U6b-1's kept open) sends its follow when the open is made, not when it is kept. (f) A tab that already shows the file with a failed read is read again after the follow (`revisit`), and then shows the file.

**W2 · The daemon, between the check and the record.** (a) The client ends while the source is read or searched: the scan stops at its next turn and nothing is recorded. (b) The session is removed meanwhile: `add` asks the view in the same synchronous step as its write, and fails. (c) A read of the same path arrives before the record is written: it is refused, as it would have been; the window's own read waits (W1), and any other reader reads again when its tab is shown. (d) Two follows of one path, one finding a counted form and one a result form, in either order: the record admits a save (R4).

**W3 · The search's slot.** A subagent's search waits behind a running search and gives up after its patience; the follow then answers `not-linked`, the tab reads as refused, and a click on the link tries again. Nothing is remembered of a search nobody waited for.

## What is stored and sent, and what each older build does with it

No field is added to a stored tab, to `main.tabs`, to `regions` or to the stored side surfaces; no version moves; neither settings file is touched; no layout key is added.

**Stored.**

| what | what this landing writes | build F (`f1852de3a`) and build M (`2c7044231`) | this build, then the older one, then this build |
|---|---|---|---|
| `<profile>/sessions/file-links.json` (new) | `{ "version": 1, "sessions": { "<session>": [{ "real": "<real path>", "at": <ms>, "why"?: "result" \| "linked" }] } }`, whole, atomically, mode 0600 | neither names it: each names `sessions/intents/`, `sessions/bootstraps/` and `sessions/uploads.json` alone and neither lists the folder (U6e's row for `file-grants.json`, confirmed by its M1); neither reads nor removes it | the older build leaves the file as it was; back on this build the tab reads and saves |
| the tab of a followed file | nothing new: a Files tab's `{ file, line }`, or a main `file` tab | as U6e's row for a chosen file: F reads without `named`, so its tab shows its refusal; M reads with `named` and its own daemon holds no record, so its tab shows its refusal unless its own transcript names the file | the tab is there, reads and saves as before the stay |

**Sent.**

| what | to whom | a daemon of build F | a daemon of build M | an older window on this build's daemon |
|---|---|---|---|---|
| `files.follow` (new) | this Mac's daemon, from the app window's page, for a session on this Mac | `unknown_command`: the window goes on to the read, which that daemon refuses for an outside file; the tab shows the notice | the same; a file its transcript also names opens as it did | never sent |
| `files.read`'s answer: `outside.why` may be `linked` | the window | never answers `outside` | never answers `outside` | F's window sends no `named` and is answered no `outside`. M's window sends `named`: a file this build's window followed earlier is admitted to it, and it holds every such file read-only, since it knows no `outside` and has no outside save |

The wire takes its next minor (54 if nothing else has taken it at the head this is built on). By root UC-10 the landing owes two cross-build runs, one with each older build as the exact peer, and adds its row and its scene to the cross-build coverage table (Interfaces §H). The proof at the schema is `test/cross-build/files-schema.test.ts`, over the committed snapshots of the two peers.

## Acceptance

Each item is a behaviour a person can check. "Unit" runs on the build VM; a scene runs on a Mac and is the architect's to start.

- **K1** (the owner's first answer). In a session on this Mac, a Markdown file of the session's folder holds `[notes](/<outside>/notes.txt)`. A click on the link in the rendered file opens `notes.txt` beside the chat, with no "Read-only" label; typing and ⌘S write the file on disk; ⌘-click opens it in the main area. A PDF linked the same way is drawn in its frame.
- **K2** (the stored-tab problem). With K1's tab open, quit and relaunch: the tab is there, shows the saved text, and saves again. `main.tabs` and `panelTools.params` hold no key they did not hold before U6b-4c (unit: the stored layout after a followed open equals the one after a plain open of the same path), and `sessions/file-links.json` holds one entry for the session.
- **K3** (the owner's second answer). A Markdown file outside the folders, opened by Open File… or by a link, holds `[next](next.md)` and `[up](../other/up.md)`: each click opens the file at that place relative to the Markdown file's own folder, editable.
- **K4** (R4). A Markdown file outside the folders that only an MCP tool's result names opens read-only, and a file it links opens with the label "Read-only", whose panel reads the sentence of Interfaces §F and offers Open File…. After the person chooses the Markdown file with Open File…, a click on the same link opens the file editable.
- **K5** (a subagent, "the same rule"). In the Agents tool's drill-in of a subagent, and in a main tab of that agent, a link in the subagent's own text and the chip of a file it read, each to a file outside the folders that the session's own transcript does not write, open the file, editable. A path only a tool's result in that subagent's transcript holds opens read-only.
- **K6** (R2, R3). None of these is followed, and where the rendered file draws a chip for it the click shows U6b-4b's first notice: a link typed into the Markdown file's Source view and not saved; a link whose Markdown file was changed on disk to hold it no more. A path the Markdown file writes only in a code fence is no chip, and a direct `files.follow` for it answers `not-linked`.
- **K7** (R1; unit and scene). `files.follow` for a path the named source does not link answers `not-linked`, and a read of that path is refused; asked by anything but the app window's page it answers `forbidden_sender`.
- **K8** (R5). `show_pane` for a file that only a link record admits shows the refusal; the person's own click on the link then opens it.
- **K9** (a session removed). Removing the session removes its entries from `sessions/file-links.json`.
- **K10** (another machine). For a session on another machine no `files.follow` is sent (unit: the window's follow and the renderer guard), and a click on a link in a Markdown file there opens what it opened before.
- **K11** (an older daemon). On a daemon of build F or of build M this build's window draws the notice for a followed link to an outside file, and opens a file inside the folders as before (scene, cross-build).
- **K12** (going back). After K1, a run of build F and of build M on the same profile leaves `sessions/file-links.json` as it was, and this build then reads and saves the file again (scene, cross-build).
- **K13** (the bounds; unit). A follow of a subagent whose file is searched to its bound gives the event loop back as the search does; with eight searches waiting a ninth follow answers `not-linked` at once; a session with 4,000 subagent files finds one agent's file by reading directories alone (a test counts the files opened: one).
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

**Decisions.** R3's readers; decisions 5 and 6. `fileLinkSteps` is `linkSteps` with each path resolved; it adds no scan of its own and charges nothing new to the meter. `agentRowClaimSteps` runs `rowClaimSteps` and turns a counted answer from a record whose `type` is not `assistant` into the result form already resolved (`other`).

**Does not touch.** `clickPath`, `linkSteps`' scan, `rowClaimSteps`, every scanner of `named.ts`. The daemon. `MarkdownView`.

**Proves.** X3.1 and X3.2's rule half, X3.4, X4.3's rule half; `kindOf` answers as before for every case of its suite; the differential green in both directions with the new fragments (its seeded case runs up to 300 s: give its command a limit of 600).

### M2 — The record, the command, and a Markdown file as the source

**At its end.** The daemon answers `files.follow`. For a Markdown source it checks the link and writes a record; every later read, open outside MAWS, frame and save of that file for that session is admitted by the record, across a restart of the daemon. For a subagent source it answers `not-linked` (M3). No window sends the command yet; the suites and a direct request do.

**Touches.** New: `src/services/files/links.ts`, `links.test.ts`. `src/services/files/service.ts` (`follow`; `firstEvidence`, the marks and the read's answer; the missing-path branch of `precheck`; the header comment), `src/services/files/register.ts`, `src/services/checkouts-root.ts`, `src/services/spine-root.ts` (the store opened beside the grants, `followView` given it). The wire: `src/shared/ipc/schema/files.ts`, `names/files.ts`, `grades/files.ts`, `remote-unavailable.ts`, `wire.ts` (the minor and its comment), and the three generated snapshots `routes.json`, `wire-manifest.json` with its fingerprint, `src/shared/machine/address-paths.json`. `src/main/app.ts` (the guard's list gains the name). Tests: `src/services/files/service.test.ts`, `register.test.ts`, `src/shared/ipc/schema.test.ts`, `src/main/daemon-root.test.ts`, `src/main/files/open-file.route.test.ts`, `test/support/spine-lists.ts`, `test/endpoint/checkout-rows.test.ts`, `test/cross-build/files-schema.test.ts`, `e2e/support/cross-build-samples.ts`.

**Interfaces.** Exposes §B, §C and §D. Consumes §A.

**Decisions.** R1, R2 (for a file), R4 (for a file), R5; decisions 1, 2, 4, 7, 12 and 13; W2. The service reads the source with the functions a read uses (`openConfirmed`, `readWhole`, `fileMime`, `isTextMime`), closes the handle on every path, and never opens the source a second time. `follow` with `from.agent` answers `not-linked` while the service is given no `agentNames`. The snapshots are written again on the VM by the switch each test names and their diffs brought back, never edited by hand (Concrete Steps).

**Does not touch.** `grants.ts`. `named.ts` of the services. `write`, `list`, `watch`, `reveal`, `readResolved`. The endpoint's `OFFERS`. Any renderer source.

**Proves.** K7, K9, K12's and K14's unit halves; X1.1 to X1.5, X2.1 to X2.5, X2.8, X3.1 to X3.3 and X3.5's service half, X4.1, X4.2, X4.4, X4.5, X5.1 to X5.9; the wire's tests green with the new minor; neither peer's snapshot knows `files.follow`.

### M3 — A subagent's transcript as the source

**At its end.** `files.follow` with `from.agent` finds that agent's file under the session's own transcript folder, searches it by the rule, and records what it finds: a save for a counted form in an `assistant` record, a read for a result form.

**Touches.** `src/services/files/named.ts` (`namesInAgent`, the file's locator, the job's rule and its remembered key), `src/services/checkouts-root.ts` (hands `namesInAgent` to the service as `agentNames`). Tests: `src/services/files/named.test.ts`, `service.test.ts`.

**Interfaces.** Exposes §E. Consumes §A (`agentRowClaimSteps`) and §D (`agentNames`).

**Decisions.** R2 (for a subagent), R4's second point; decision 8; W3. The locator reads directories and opens no agent file but the one it found; depth and the file's name are the engine host's (`src/engine-host/fs/subagents.ts`, `MAX_DEPTH` and `AGENT_TRANSCRIPT`), restated here with a test over `test/fixtures/transcripts/` that fails if the two readings part. The walk stops at `NAMED_AGENT_DIRS_MAX` directories (4,096) and answers none past it.

**Does not touch.** `names`, its queue's bounds, the scanner's reading of a line. `src/engine-host/`. The service's evidence order.

**Proves.** K5's and K13's unit halves; X2.6, X2.7, X4.3; `names` answers `false` for a path written only in a subagent's file, as before, in the same test that finds it with `namesInAgent`.

### M4 — The window follows

**At its end.** A click on a link in a shown Markdown file, and on a link or a chip in a subagent's transcript, of a session on this Mac sends the follow, and the tab's read waits for it. A file that opens read-only through a read-only Markdown file says why.

**Touches.** New: `src/renderer/src/tools/code/follow.ts`, `follow.test.ts`. `tools/code/open-file.ts` (`OpenFileOptions.from`; `place` follows; `codeTranscriptActions.openFile` passes the agent), `tools/code/viewer/MarkdownView.tsx` (its `openFile` gives `from`), `tools/code/viewer/viewer-store.ts` (`readChunk` waits; `locked` gains `linked`), `tools/code/viewer/FileViewer.tsx` and `tools/code/copy.ts` (the reason's sentence, and Open File… offered for it), `transcript/view/context.tsx` (`openFile`'s options gain `agent`), `transcript/view/Transcript.tsx` (the child's `openFile`), `src/renderer/src/test-support/code-disk.ts` (the fake disk answers `files.follow`). Tests: `tools/code/files/tabs.test.tsx`, `tools/code/viewer/viewer.test.tsx`, `tools/code/editor/editor.test.tsx`, `transcript/view/Transcript.test.tsx`, `test/lane-b/renderer-guards.test.ts`; and the cases that hold U6b-4b's L14 and N2.3, which this landing reverses in the window: each now expects one `files.follow` and then one `files.read` where it expected the read alone.

**Interfaces.** Exposes §F. Consumes §C (the command) and U6b-4b's §B (`base`, `artifactView`).

**Decisions.** Decisions 3, 9, 10 and 11; W1. `follow.ts` sends nothing for a session that is not on this Mac, for no session, and for a path that is not absolute; it is the one module that names the command, and its row in `GUARDED_ELSEWHERE` says so. `MarkdownView` gives `from` exactly where U6b-4b gives `base`: for a file's tab, never for an artifact's view. An open with `asked: 'agent'` never follows.

**Does not touch.** `Link.tsx`, `ReadDetail.tsx`, `EditDetail.tsx` and every other click source. `DrillIn.tsx`, `TranscriptSlot.tsx`, `RemoteAgentTranscript.tsx`. The notice. The Files tab's params and `layout.openTab`'s argument. `apps/`.

**Proves.** K1 to K6, K8, K10 and K11's unit halves (K11 over the fake disk's older daemon); W1 (a) to (f), each with the follow held open by the test; the store asserts no `files.read` before the follow settles; a child transcript's click carries the agent's id from each of its click sources (the link, a read's chip, an edit's chip, an anchored comment), and a session's own transcript carries none.

### M5 — The scenes, the older builds, the record, and the acceptance run

**At its end.** The scenes of Interfaces §H are written and typecheck; the cross-build table holds the landing's row; the charter and C8's document hold their dated lines; the tracker's rows are closed and opened; the acceptance's unit half and the whole unit suite have run.

**Touches.** `e2e/sessions.spec.ts`, `e2e/cross-build.spec.ts`; `docs/charter.md` (§19, one dated entry); `docs/doperpowers/plans/2026-09-28-c8-right-panel.md` (one dated line at K1); `docs/tech-debt-tracker.md`; this document's record.

**Interfaces.** §H.

**Decisions.** The charter's entry, exactly: "2026-11-18 (owner; UX wave U6b-4c, O-37): on the machine that holds a session, the files service (C8's K1 as amended 2026-11-13 and 2026-11-14) also opens, for a read and for the person's Save, a file outside the session's folders that a Markdown file the session may read links, or that the transcript of one of the session's subagents names. The window says only where the link stands; the daemon reads that file itself, and records what it finds for that session. A file linked only by a file that is itself read-only for the session opens read-only." The line at K1: "Amended 2026-11-18 (UX wave U6b-4c): also a file that a readable Markdown file links or a subagent's transcript names, once the daemon has found the link itself (`files.follow`); charter §19."

**Does not touch.** Any source of M1 to M4, but for what a scene's typecheck shows wrong.

**Proves.** K1 to K14 read once against the tests and scenes that hold each, with the list in the hand-back; the whole unit suite, once; the script tests (the diff touches `e2e/`).

## Concrete Steps

All commands are run from the worktree `…/.claude/worktrees/ux-wave-U6b-4c` on the MacBook, and every check through the helper, which runs it on the build VM in a checkout of the pushed head. `V` below stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b-4c --`. The helper's exit status is the command's; never pipe it into `tail` or `head` without `set -o pipefail`. The branch was cut from another branch: push it by name, `git push origin ux-wave/U6b-4c`.

Once, before M1:

    git fetch origin master && git merge origin/master
    git fetch origin ux-wave/U6b-4b && git merge origin/ux-wave/U6b-4b    # only while U6b-4b is not on master; the architect says which
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

Read each diff before it is applied: the routes gain one name, the address paths one line (`commands.files.follow.input`, its `.appSessionId`), the manifest one command, one enum value in `files.read`'s output and the minor. Anything else in a diff is a finding. Also add to M2's vitest call every suite that constructs the checkouts or the spine's root, found with `grep -rlE "startCheckouts|openFileGrants" src test --include=*.test.ts`.

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
        every path `linkSteps` yields, resolved by `resolveRelative`. One bounded step at a time, PAUSE as `linkSteps`. */
    export function* fileLinkSteps(text: string, base: string): Generator<string | typeof PAUSE, void, void>;
    export function fileLinkTargets(text: string, base: string): string[]; // the same, run at once (tests, the differential)

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
      /** Records the real path for the session, as the newest. Throws for a session the view does not know, or when the
          file cannot be written (memory untouched). A record that admits a save is not lowered: `why` is then ignored. */
      add(appSessionId: AppSessionId, real: string, why?: LinkWhy): void;
      get(appSessionId: AppSessionId, real: string): { why: LinkWhy | null } | null;
      drop(appSessionId: AppSessionId): void; // never throws
      reconcile(): void;                       // never throws
    }
    export function openFileLinks(file: string, options: FileGrantsOptions): FileLinks; // the options' type is grants.ts's

The file: `{ "version": 1, "sessions": { "<session>": [{ "real": "<absolute real path>", "at": <ms>, "why"?: "result" | "linked" }] } }`, oldest first. The reader takes an entry with an absolute `real` and a finite `at`; `why` absent is a save; any `why` that is not `"result"` is read as `"linked"`. Everything else is `grants.ts`'s rule (its header, decision 21 of U6e). `spine-root.ts` opens it at `join(sessionsDir, 'file-links.json')` in a run that has the spine (null otherwise), hands it to `followView`, and to `startCheckouts` as `links`.

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

and `outside.why` of `FilesReadOutputSchema` becomes `z.enum(['result', 'added', 'linked'])`. The agent's pattern is `laneA.watch`'s (`src/shared/ipc/schema/lane-a.ts`).

Its footprint, each beside `files.writeOutside`'s entry of the same kind: `names/files.ts` (bridged, not main-only); `grades/files.ts` (`'manage'`); `remote-unavailable.ts` (`notYet('following a link to a file outside that session’s folders')`); `wire.ts` (the minor, and in its comment "the UX wave's U6b-4c: files.follow, and files.read's answer's outside.why's linked"); `src/main/app.ts` (`guardCommand(['files.writeOutside', 'layout.openFile', 'files.follow'], appPageOnly(appUrl))`); `test/support/spine-lists.ts` (both lists); `test/endpoint/checkout-rows.test.ts` (among the unoffered); `e2e/support/cross-build-samples.ts` (`{ appSessionId: 'x', path: 'x', from: { file: 'x' } }`); `test/cross-build/files-schema.test.ts` (neither peer knows it); `src/shared/ipc/schema.test.ts` (the list of `files.*`, both `from` shapes valid, a `from` with both keys or neither invalid, `files.follow` not main-only).

`register.ts`: `register('files.follow', (input, context?) => files.follow({ ...input, appSessionId: session(input.appSessionId) }, remote(context), endOf(true, context)))`.

### §D. The service (M2, and M3 for `agentNames`; `src/services/files/service.ts`)

    // FilesServiceOptions gains
    links?: Pick<FileLinks, 'add' | 'get'>;                                                                             // absent: nothing is followed, and `follow` answers not-linked
    agentNames?: (appSessionId: AppSessionId, agentId: string, path: string, signal?: AbortSignal) => Promise<Naming>;  // absent: a subagent source is not-linked
    // FilesService gains
    follow(input: FilesFollowInput, remote?: boolean, signal?: AbortSignal): Promise<FilesFollowOutput>;
    export const FOLLOW_WAITING_MAX = 8;

`follow`, in this order; "not linked" below means the answer `{ status: 'not-linked' }` with nothing written:

1. `remote`: the refusal, thrown. No `links`: not linked.
2. `path` not absolute: `path must be absolute`. No record for the session: `unknown app session: <id>`. `path` not lexically normal, or ending in a separator: the refusal. `path` longer than `NAMED_PATH_MAX` bytes: not linked.
3. The target: `realpath(path)`; a failure is not linked. Under one of the session's roots: `{ status: 'inside' }`. Not a regular file (`lstat` of the real path), or `path` ends in a symlink: not linked.
4. The source, by `from`:
   - `file`: its name, as given, is not a Markdown name: not linked. `openConfirmed(appSessionId, from.file, 'file', DELIVERED_OR_OUTSIDE, false, { named: true, signal })`; any failure is not linked. The descriptor's size is over `MARKDOWN_RENDER_CAP`: not linked. The whole file is read through the handle; its mime, from its first `BINARY_SNIFF_BYTES`, is not text: not linked. Behind the gate of decision 7, `fileLinkSteps(text, dirname(from.file))` is run to the first path that equals `path`, the event loop given back at every PAUSE and the scan ended when `signal` is aborted; none found: not linked. The handle is closed on every path. The record's `why`: none when the source's mark is null (inside the folders), `chosen`, `sent`, `named` or a link record that admits a save; `linked` for every other mark.
   - `agent`: `agentNames` absent: not linked. Its answer `'counted'`: no `why`; `'result'`: `why: 'result'`; `false`: not linked.
5. `signal` aborted: not linked. `links.add(appSessionId, real, why)`; a throw is the command's failure. Then `{ status: 'linked' }`.

The evidence. The marks become `'chosen' | 'linked' | 'sent' | 'named' | 'result' | 'link-only' | 'added'`, and `firstEvidence`, with `followed(real)` standing for `links.get(appSessionId, real)` unless the request carries `agent: true`:

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

A read's answer: `outside: { real, writable: true }` for `linked`; `{ real, writable: false, why: 'linked' }` for `link-only`; the others as today. In `precheck`'s branch for a path that does not resolve, a path that has a link record (asked as a grant is there, by the path as given) answers `not found: <path>`. A session with no resolvable root reaches a link record as it reaches a grant (`precheck`'s `evidence` counts `links` too).

### §E. The search over one subagent's file (M3; `src/services/files/named.ts`)

    export const NAMED_AGENT_DIRS_MAX = 4096; // directories read to find one agent's file
    // NamedPaths gains
    namesInAgent(appSessionId: AppSessionId, agentId: string, path: string, signal?: AbortSignal): Promise<Naming>;

`namesInAgent` is `names` with three differences. The file: after the locator answers the session's transcript path `T` (which must end `.jsonl`), the agent's file is looked for under `<T without .jsonl>/subagents/`: `agent-<agentId>.jsonl` in that folder and in each folder at most three levels below it, the folders found by `readdir` alone; exactly one match is the file, and none, two, an error, or more than `NAMED_AGENT_DIRS_MAX` folders is "not named". The rule: each line is read by `agentRowClaimSteps`. The memory: the job's key holds the agent's file, and what it remembers is keyed by the session, the agent's id and the path. The request's patience and its client's signal run from the moment it is made, the locator's and the walk's time included. `checkouts-root.ts` hands the same `createNamedPaths` object's `namesInAgent` to the service as `agentNames`.

### §F. The window (M4)

`src/renderer/src/tools/code/follow.ts` (new):

    export type LinkSource = { file: string } | { agent: string };
    /** Asks this Mac's daemon to find and record the link (`files.follow`), once at a time per session and path. Sends nothing
        for no session, for a session that is not on this Mac, and for a path that is not absolute. Never throws: a failure
        is a follow that found nothing. */
    export function follow(appSessionId: AppSessionId | null, path: string, from: LinkSource): void;
    /** The follow under way for this session and path, settled (never rejected) when it is answered; null when none is. */
    export function following(appSessionId: AppSessionId | null, path: string): Promise<void> | null;
    export function resetFollows(): void; // tests

`tools/code/open-file.ts`: `OpenFileOptions` gains `from?: LinkSource`, held in memory alone. `place` calls `follow(appSessionId, path, options.from)` first, when `from` is set and `asked` is not `'agent'`; nothing of `from` reaches `layout.openTab` or a tab's params. `codeTranscriptActions.openFile` passes `from: { agent }` when its options hold `agent`.

`tools/code/viewer/MarkdownView.tsx`: its `openFile` passes `from: { file: entry.path }` beside U6b-4b's `base`, when `entry.appSessionId` is not null and the view is not an artifact's (`artifactView`).

`tools/code/viewer/viewer-store.ts`: `readChunk`, before it sends a `files.read`, awaits `following(appSessionId, entry.path)` when there is one. `ViewerEntry.locked` gains `'linked'` (from `outside.why`), and `readOnlyReason` answers it.

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
| `e2e` | `e2e/sessions.spec.ts`, a new case beside "a file the transcript links opens from outside the session's folder, …", staged as that case stages its files and transcripts | "a link in a shown Markdown file opens a file from outside the session's folder, editable, and the tab comes back". The session's folder holds `guide.md`, which links `<outside>/notes.txt` by its absolute path and holds `<outside>/fenced.txt` only in a code fence; `<outside>/index.md` links `next.md` beside it. Steps: open `guide.md` from the Files tree; click the link: the viewer of `notes.txt` shows its text, `data-editable="true"`, no "Read-only"; type, save, read the bytes back from disk; `sessions/file-links.json` holds one entry for the session. Relaunch on the profile: the tab is there, reads, and saves again. Choose `index.md` with Open File… (the pick seam); click `next`: `next.md` opens. Then, through `window.maws.invoke`: `files.follow` for `fenced.txt` from `guide.md` answers `not-linked` and a read of it with `named` is refused; `files.follow` for `notes.txt` from a `.txt` file that holds the same link text answers `not-linked` |
| `e2e` | the same spec, the same case or one beside it | a subagent: the staged transcript's folder gains `subagents/agent-<id>.jsonl` and its meta, whose `assistant` text links `<outside>/by-agent.txt`, which the session's own transcript does not write. Open the agent's drill-in and click the link: the file opens, editable. Where the app's harness cannot stage a drill-in for a transcript on disk, the click is held by M4's unit tests and the scene asks through `window.maws.invoke` (`files.follow` with `from: { agent }`, then the read and the save); the hand-back says which |
| `e2e:cross-build` | `e2e/cross-build.spec.ts`, a new scene "(a followed link, both ways)", built as "(an outside file, both ways)" is | this build follows a link in a Markdown file to a text file outside the folders, saves it, and quits; the peer launches on the profile, shows of that file only what it could before, and its writes leave `sessions/file-links.json` as it was (compared by bytes); this build then reads the tab and saves once more. For F and for M |
| `e2e:cross-build` | the same spec, the scene "(outside file, on the peer’s daemon) …" gains a step | this build's window on the peer's daemon: the click on the link in the Markdown file sends `files.follow`, answered `unknown_command`, and the tab shows U6b-4b's first notice; a link to a file inside the folders opens |
| `e2e:agents`, `e2e:transcript`, `e2e:lane-a` | their specs | none is expected to change; run because `Transcript.tsx` gives a child's rows another `openFile` |
| `e2e:code` | `e2e/code-tools.spec.ts`, `e2e/code-editor.spec.ts` | none is expected to change; run because `readChunk` and `kinds.ts` are edited |

The coverage table (the comment block U13a's M5 began) gains the row "U6b-4c: `sessions/file-links.json`, a profile file the peer does not know; the tab of a followed file", with the scene's name and what the return shows. No spec file is added, so the gate's counts of spec files do not move.

### §I. What a later landing may rely on, by name

`files.follow` and its three answers; `FileLinks` and the links file's form; the mark `linked` and `outside.why: 'linked'`; `fileLinkSteps`, `agentRowClaimSteps`, `isMarkdownName`; `namesInAgent`; `follow` and `following`; `OpenFileOptions.from`. A landing that offers the follow to another machine (Q6) gives `files.follow` its row at U6f's grade and lifts the test in `follow.ts`; nothing in the service's `follow` rests on the caller being this Mac's but its first step.

## The sentences a person reads

One is new: "Read-only: the file that links this one is read-only in this conversation. Choose it with File ▸ Open File… to edit it", the reason of a file that opens through a link in a Markdown file that is itself read-only for the session (Q2). Every other sentence is one that exists: a followed file that can be saved carries no label (U6e's "No label if savable"), and a link that opens nothing shows U6b-4b's notice.

## Points reported to the architect

Each has the default this document builds and the one place a ruling changes.

| # | the point | the default built | the one place |
|---|---|---|---|
| Q1 | **A followed link is remembered.** The record outlives the text that linked it: the Markdown file edited, the conversation cleared, the subagent's transcript gone. It goes with the session, or when 256 newer ones push it out. A chosen file's grant behaves so; a name in the transcript does not (it goes with `/clear`). | remembered, in the profile | R5; the smaller scope is the design's table, row "memory alone" |
| Q2 | **For the owner: read-only through a read-only file, and its sentence.** The owner's answer makes a file a shown Markdown file links editable. This document holds that for every Markdown file the session could itself save, and opens read-only what a read-only Markdown file links, with one new sentence. Without the rule, a path a tool's output only mentioned becomes writable in two clicks. | R4; the sentence of §F | R4's first point; `EDITOR_COPY.readOnly.linked` |
| Q3 | **What a fault in the app's own page can now reach.** R1 says it: any file that a readable Markdown file or a subagent's transcript links, read and written, with no click. It is inherent in "a link in a shown file opens it, editable"; the narrower forms each lose the owner's answer in part (read-only for every followed file; a save only after Open File…). | as the owner answered | R1 |
| Q4 | **U6b-4b's first notice says "MAWS opens a file from elsewhere only when this session's transcript links it."** After this landing a file a shown file links opens too, so the sentence is short of the truth, as it already is for a chosen and a sent file. | the sentence unchanged (it is the child's table) | U6b-4b's table of sentences |
| Q5 | **A link with a heading's fragment does not open.** `[x](#usage)` and `[x](guide.md#usage)` are read as file names, in a transcript and in a Markdown file alike; a README's table of contents is made of the first. It stood so before this landing. Opening the file and going to the heading is a design of its own (the click's reading changes, in the window and in the rule together). | not built; one tracker row | the tracker |
| Q6 | **A session on another machine is not in.** After U6f a machine's owner can open an outside file there by that machine's evidence; a link in a Markdown file shown from there still opens only what that evidence admits. Lost: K1 to K5 on another machine. What a later landing needs is in §I. | no follow is sent | `follow.ts`'s test of the machine |
| Q7 | **A linked file that is not there reads as outside the folders**, not "No file at this path.", since nothing can be recorded for a path that does not resolve. A file followed once and deleted later does read "No file at this path." | as said; one tracker row | §D, step 3 |
| Q8 | **Insertions in files this child does not own.** The wire's files and `src/main/app.ts` (the session that keeps master), `transcript/view/Transcript.tsx` and `context.tsx` (UC-3). | made, each the smallest | §G |
| Q9 | **This landing reverses two of U6b-4b's pins in the window**: its L14 ("the two links add no evidence") and its N2.3 (one `files.read` and nothing else for a relative link in an outside Markdown file). Their daemon halves stand: without a follow nothing is admitted, and `names` does not read a subagent's file. | the window's cases rewritten in M4 | M4's Touches |
| Q10 | **A wire minor and a new command**, so two cross-build runs are owed (root UC-10), and the minor's number is whatever is free at the head this is built on. | as said | §C |
| Q11 | **The subagents of a conversation left behind with `/clear` are not searched**: the locator answers the session's present transcript. A drill-in of such an agent, where the window can still show one, keeps the refusal. | as said | §E |
| Q12 | **A subagent's file too long to search within 8 s behind other searches never opens its links**, as a session's own transcript of that kind does not (U6c's accepted bound). | as said; the tracker's row for the search's bound gains the case | W3 |
| Q13 | **No `user` record of a subagent's transcript counts for a save.** If a build lets a person write to a running subagent, its file would hold that message as a `user` record; this landing reads every such record as a result form whatever its origin says, because the recorded fixtures show no origin there and the daemon has no proof of who wrote it of the kind U3a's reader gives for the session's own transcript. A link only such a record holds opens read-only. | R4's second point | `agentRowClaimSteps` |

## Proof that an executor does not run

- **The scenes of §H, on a Mac**, under the load rule: `e2e` (the cases of `sessions.spec.ts`), `e2e:cross-build` twice (`--peer-exact f1852de3a` and `--peer-exact 2c7044231`), and `e2e:agents`, `e2e:transcript`, `e2e:lane-a` and `e2e:code` once each, unchanged. Each needs the pushed head that holds M5; the cross-build runs need the peer builds as that group always does.
- **The macOS-guarded cases of `src/services/files/service.test.ts`**, in the Mac lane, since the follow reads through the read's boundary.
- **Class 1a** (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b4c`).
- **The branch review**: the xhigh panel (Decision Log 1).
- **The owner.** Nothing must be answered before the build starts. Q2 is the owner's: a rule that narrows their answer in one case, and one new sentence; its ruling changes one place. No drawn example is needed: nothing new is drawn but that sentence, in a label and a panel that exist. Q5 is offered as a question for later and holds nothing up.

## Size and review

About 2,500 changed lines over about 55 files, tests and scenes included: M1 about 320 over 7 files, M2 about 950 over 24 (ten of them one-line entries in registries and guards), M3 about 420 over 5, M4 about 520 over 15, M5 about 350 over 6. The branch takes the **xhigh panel**: it is past the mark by size, and it widens the daemon's admission of files outside a session's folders, which the root calls a security boundary. One reviewer of the panel reads R1 to R6 and their tables against the diff, and one reads W1 to W3 against the store and the service.

## Statements to check again on the head this landing is built on

- **U6b-4b as built.** `resolveRelative` and `OpenFileOptions.base` in `tools/code/open-file.ts`; `MarkdownView` passing `base: dirname(entry.path)` for a file's tab and `base: null` for an artifact's view, told by `artifactView`; `fileUrlRest` inside `clickPath`; the notice (`ViewerEntry.failure`, `retry`). Read again where its executor's Decision Log moved a name, and where its L14 and N2.3 cases live.
- **U6f (an outside file on another machine)** rewrites how `register.ts` and `service.ts` tell a caller (a claim in place of `remote`), adds commands beside `files.writeOutside`, and may change `readChunk`'s test of the machine. Read again: step 1 of `follow`; where `firstEvidence` stands and what it is handed; the guard's list in `src/main/app.ts`; Q6.
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

## Decision Log

1. **2026-11-18 · The verification call.** This document gets an adversarial review before an executor starts (the design, the trust rules and buildability). The branch gets the `doperpowers:review-code` xhigh panel, by size (about 2,500 changed lines, about 55 files) and because it widens the daemon's admission of files outside a session's folders. Class 1a on GitHub Actions is the gate of record; the scenes of §H and the two cross-build runs run on a Mac.

## Outcomes & Retrospective

Pending — written at finish.
