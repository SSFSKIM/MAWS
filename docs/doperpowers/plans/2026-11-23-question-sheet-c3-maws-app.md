# Question sheet, C3 — the sheet in the MAWS app: execution (2026-11-23)

> **Composite:** `docs/doperpowers/specs/2026-11-23-question-sheet-design.md`, child **C3** (The sheet in the MAWS app). **Parent pin:** `e6a07c35e` (branch `question-sheet`). The document was written at `635073ce9`, moved to `80645243b` when the composite took its entries and the owner's answers on the look, to `5f53131c5` when the composite recorded the set's merge, and to this pin before M4 (2026-11-24), when the composite had taken X5 as built, X2's exits, the tab's name and C6's `no-target`, and C4 had taken the drawing of a refused link as its text (§8.2: one optional function on the Markdown context, which C4 adds); nothing of §8.1 moved. **Ticket:** MAWS board #868, a child of #600. The child's section in the composite ("### C3: The sheet in the MAWS app") is its spec. The composite's §3 ("Readers read the file"), §4.3, §8 and §8.1 are its design, binding where the composite's "Grades" paragraph says (§8.1 is the owner's own ruling); X5 is the contract it owns, and X1, X2, X3 and X7 the ones it consumes. This document carries the constraints, the decisions the composite did not carry, the interfaces and the milestones, and nothing of the design.
>
> **Written against:** MAWS master `90ce5c017`; the sheet's published set as doperpowers pull request #628 carries it (branch `question-sheet-c2`, head `9f4860205`, after its code review's fix wave), which is not merged, so every shape of the set named here is read again at M1's pin; `origin/ux-wave/retire-tool-card` at `9305bfd0b` (board ticket #852, not merged).
>
> **Read before M1:** the composite whole; in doperpowers, `sminos/types/sheet/README.md` and `docs/doperpowers/plans/2026-11-23-question-sheet-c2-sminos.md` (I1 to I7, "What M1 freezes", "Who acts, and on which file"); here, `docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md` (sections l4-approvals-08, O-17, O-21, O-22), `docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md` (Interfaces §A) and `docs/doperpowers/specs/2026-10-15-desk-renderer-survey.md` ("Ranked").

After this child, a terminal session on this Mac that asks through the sheet is answered in the MAWS app. The agent's call draws a row with one line per question, and nothing opens. Open on a line, or a line of the "Waiting for you" card, shows the session's sheet in the side column at that question: every open question as a card, with its context, its files as they were when asked, its options and one text field. The person answers any of them in any order and presses one Send; each answered question's line becomes its receipt (`q7 Auth method → OAuth`) and the agent has the answers together. The session reads "Question waiting", calmly, and never as stopped. A stopped session's questions are still there; an answer given then is shown as queued and can be taken back. The card, the sheet and an overview of sessions are three components that C4's page and desk-web import as they stand.

How to see each of these is Concrete Steps. What closes the child is its two gates in the composite, G1 and G2, mapped to milestones under Plan of Work.

## Progress

- [x] (2026-11-23) This document written against the composite at `635073ce9`, MAWS master `90ce5c017` and doperpowers pull request #628 at `7b53f8a2d`.
- [x] (2026-11-24) The document's buildability review: fifteen findings, each checked against the code and all fifteen held. The composite's writer ruled on five (a carried draft, the Send, the locator, receipts across a parent's and a child's history, the links of the sheet's Markdown); this revision repairs all fifteen and brings §B to §D to the set at `9f4860205`. It is the document's only review round: the milestones' task reviews and the branch reviews check it from here.
- [x] (2026-11-24) The look: a drawn example of six frames put to the owner, and the owner's four answers recorded, each the recommended one ("The look"). The drawing milestones are no longer blocked by it. Parent pin moved to `80645243b`.
- [x] (2026-11-24) doperpowers pull request #628 merged: the pin is doperpowers `2594002af`, sminos 1.57.0, set version 1, digest `594200ae4e539c0688c67b511968861d8ebf03c87d1c45b512903a538326e277`. Between `9f4860205`, which §B to §D were written to, and the merge, the set changed in its README and `schema/show.schema.json` only: a queued `sent` entry is discriminated by kind (an answer or a dismissal carries `id`, a retract `target`, a `delivered` line neither), `show`'s schema states the reader's cuts, a lone surrogate is printed as U+FFFD, and an upload's name is bounded by its stem. §B to §D are corrected to the pin (2026-11-24, in a commit of their own, from the set's diff `9f4860205..2594002af`): the queued `sent` entry's kinds and the lone surrogate in §B, the unlocked reader's glimpse of a rolled-back write in §C; the cuts, the handle and the upload's stem needed no change.
- [x] (2026-11-24 10:05Z) M1 — The pin and the model. Commits `11cc1259f`, fixes `07c389961` and `d5b09d5c7`; task review clean after two fix rounds (the review's rulings are in §B and §C); class 1a green on `d5b09d5c7` (run 45369925862). The pin's merge commit and C2's `show` were found to disagree on a queued line's extra fields; carried to the composite's writer for C2.
- [x] (2026-11-24 13:20Z) M2 — The service: live reading, and the writer's call. Commits `75c86a570`, `550c267f7` (after a merge of master `dc864b948`; `WIRE_MINOR` 65 since the merges of master `5fc0bb8aa` (tail-first took 63) and `bfe82b411` (prestart took 64)); fixes `da0255b93`, `245423f9c` (built on a side branch while M3 ran, cherry-picked); task review clean after two fix rounds, its rulings in §C to §F; gates green on the fix head (run 45390151242). The real door at the pin printed what Concrete Steps says.
- [x] (2026-11-24 14:20Z) M3 — The components (the composite's X5), on fixtures. Commits `55b0cb7b7`, `b535695a1`; three fix rounds (`68726b745`, `c496b78cb`; `1607745d7`; `e28ea1b6e`); task review clean, its rulings in §G (a refused Send releases its hold, refused links carry no destination, every memory change an update through `onMemory`, late pastes owned by their session, the hidden line's header from memory); gates green on `e28ea1b6e` (run 45409302136). Not seen by eye in Electron: the machine could not carry it; the built look is M6's. The pictures the composite's writer asked for if cheap were skipped: desk-web's app mounts no `R/sheet`, and the harness would need a new Mac-lane e2e case.
- [x] (2026-11-24) Landing C3a (M1 to M3): G1 but for the row's drawing. Master `5fc0bb8aa` merged in (`6521b436c`). Pull request #879, its gates green on `96b7b5eb9` (run 45412938027), for the composite's writer's branch review; its merge unblocks C4.
- [x] (2026-11-24) The branch review of #879 (the composite's writer, medium): seven findings, all fixed in one wave (`e53946b44`, `c88e62ee7`), its task review clean after one more round; one of that review's findings shipped with (a reservation committed after a session's last sheet unmounted waits until the sheet is shown again), carried in the pull request. Master `bfe82b411` merged in (`WIRE_MINOR` 65).
- [x] (2026-11-27) M4 — The side sheet, the waiting card, the attention items. Commits `7b0898665`, `3966b1bc1`, `0c3893379`, `4daa71c25`; fixes `cf868a163`, `4609b9802`, `f5db347c2`; task review clean after two fix rounds (its rulings in §H: the compact sheet held for what was sent, a focus request used once a tab, a notice resolved when pressed). Gates on `f5db347c2` (run 45470212254) green but for lane-a's mini copy, whose agents cases X-168 and `:895` fail intermittently there and pass on the hosted lane; a control run at the base settles whose they are (below, in M5's entry). Two review findings shipped with, carried to the landing's pull request: the notifier announcing a revising call once after the take-back of a question queued at the app's start, and a late paste reply recreating a removed record's memory; a third, the channel's section of held-only cards keeping its "Waiting on you" heading, waits for a word the owner has not seen.
- [x] (2026-11-27) M5 — The row's lines and receipts. Commits `c91e48011` (questionSentence's rule), `2aecf2075` (the writer's rulings of 2026-11-27; X5 gains `live?: boolean | null` on `SessionSheetProps` and `QuestionCardProps`, absent meaning not known), `af4cdc412`, `eddee6700`, `7932da929`, `49685844c`, `699bac4f8`; fixes `6832adbd5`, `ccba46b1f`, `7a888a0ab` (the writer's fork ruling), `9e689d0a2`; task review clean after one fix round (its rulings in §I). Gates green on `9e689d0a2` (run 46053751902). Lane A's reshaper race, which failed lane-a's X-168 and `:895` on the mini at master too, was fixed in its own pull request (#882, master `0e903ea7c`), cherry-picked here first (`3ca14e4fc`, `b491fbf89`) and folded by the merge of master `b65a1e175` (`7dae81a6c`). On the mini at load 12, lane-a's `:204` (a bridgeless terminal's holder, no sheet code) failed once (run 46045119581).
- [ ] M6 — Live on a Mac, the built look, the record of what changed (G2). Blocked by: M5; C2.G2 merged in doperpowers.
- [ ] Landing C3b (M4 to M6): G1's row and G2.

## Words this document adds

The composite's Terms define terminal session, MAWS-run session, the tool, sheet, question, asker, surface, the page, the bridge, today's tool and envelope. C2's plan adds the record (one session's sheet directory), the door (`sminos sheet put`) and the published set. Added here:

- **The set** is the published set, `sminos/types/sheet/` in doperpowers. **The pin** is the copy of it this repository holds, with the three values that name its revision (§A).
- **The model** is what a reader computes from a record: the object `sminos sheet show --json` prints (C2's I4). Every drawing in this child reads a model and nothing else of a record.
- **An inbox line** is one JSON object appended to a record's `inbox.jsonl` (composite §4.1). **A row line** is one question's line in a transcript row (composite §8.1). The bare word "line" is avoided where the two could be confused.
- **A sheet call** is a stored call of the tool in the sheet's form: its input has `ask` or `withdraw` (composite §2.1). A call of today's form has `questions`.
- **The spine** is the set of services `mawsd` runs once per machine (`src/services/spine-root.ts`, started through `src/mawsd/spine-seam.ts`). **Lane A** is the code's name for terminal sessions; its driver is `src/services/lane-a/`.
- **The side sheet** is the session's sheet as a tool of the side column (the charter's X5, `src/renderer/src/panel/tool.ts`). The charter's X5 (a panel tool) and the composite's X5 (the components) are different contracts; this document always says which.
- **The look** is the appearance of the new surfaces, settled with the owner on a drawn example ("The look").
- **A sheet item** is the attention item of one open sheet question (§H).
- **The stand-in door** is `test/support/fake-sminos-cli.mjs`, a test's `sminos` (§E).

## Verification

- This document: the buildability review (the composite's Verification, "Each plan child's execution document").
- Each milestone: the task review of doperpowers:subagent-driven-execution at its boundary. M1 (the model every later milestone reads) and M3 (the composite's X5, which C4 and desk-web build on) are reviewed before anything consumes them.
- The branch: doperpowers:review-code at **medium** (the composite's Verification), once for each landing, C3a and C3b.
- The look: the owner's eye, on the drawn example (done, 2026-11-24) and on pictures of the built surface at M6. No review by an agent stands in for it.

## Constraints on every milestone

**Binding inheritance** (the composite's "Constraints on every child" and "Grades"): the engine is unmodified (charter D-1); board ticket 711 (nothing in this child sends a user-role message, so it binds here only as a rule not to start); §3's one writer and §4.2's table (MAWS changes a sheet only by inbox lines through the door, writes nothing in a record but an image under `uploads/` before the door names it, deletes nothing there, and never computes a verdict); §1's shape; §4; §5.3's block; §8.1, the owner's ruling; X1, X2, X3, X7. Nothing the owner uses today stops working at any step: every path here is inert until a record exists under the sminos home or a sheet call appears in a transcript, and the rows, forms and cards of today's tool, of MAWS's `ask` and of the engine's own question are untouched (composite §8.1, last paragraph).

**The repository's rules** (`CLAUDE.md`).

- Light theme is the default; components use tokens only. `test/support/tokens-guard.test.ts` holds every file under `src/renderer` to it and runs with the tests of any milestone that adds renderer source.
- Shapes and colours are today's (the UX wave's law 7, `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`): the visual renewal (board #769) restyles through tokens later. A new surface starts from Claude Desktop (charter D-14, D-20), which here means from the option rows and card parts MAWS already derived from it (§G).
- Copy lives in a `copy.ts` beside its module and follows the word cut's rules (`docs/doperpowers/specs/2026-11-16-word-cut-design.md`). The strings the composite fixes are quoted in §I; every other string is settled in the look.
- Gates (`docs/doperpowers/plans/2026-10-14-gate-offload.md` §3.5). Class 1a, which is typecheck, lint, the unit suite and the probes, runs on GitHub Actions: `scripts/ci-gate.sh <worktree> --gates static,unit,probes`. Each Electron e2e group a milestone names runs on a macOS lane: `scripts/ci-gate.sh <worktree> --gates e2e:<group>`. `e2e:desk-web` runs on the Linux pool. A call naming no gates is refused. The live checks of M6 need a real model and a real terminal, and run by hand on a Mac under the load rule; where the UX wave's UC-10 (no local Electron on the owner's laptop) holds for the machine at hand, that Mac is the project's Mac runner. While iterating, one focused test file may be run on the machine. A group's name is the workflow's (`CLASS1_E2E` in `.github/workflows/gate.yml`): `e2e/requests.spec.ts` runs in `c7`. This child adds cases to existing e2e specs and no spec file, so `default`'s own-spec pin does not move.
- **The repository is public.** No fixture, test, document, commit message or pull request carries a path under the owner's home, a machine's name, an account, or the version of any software installed on the owner's machines. The set's own fixtures use invented paths (`/Users/me/work/proj/...`), which are not the owner's; they are copied byte for byte and never edited. The pin's provenance names the doperpowers merge commit and the sminos version it published, which are facts of that repository. A drawn example and every test fixture use invented names, paths and text (the UX wave's UC-11).

**Facts of the code at the pin**, each read at `90ce5c017`.

- The renderer never talks to `mawsd`. A command whose `owner` is `'machine'` goes from the renderer's `ipc` client through preload and main's router (`src/main/ipc/router.ts`) to `mawsd`'s front (`src/mawsd/front.ts`), and an event `mawsd` emits reaches windows only when it is listed in `MACHINE_EVENTS` (`src/shared/ipc/schema.ts`).
- `mawsd` installed as a service runs with launchd's own environment: no login-shell `PATH`, no `SMINOS_HOME` (`src/mawsd/units/launchd.ts`). The spine receives the login shell's environment as `engineEnv` (`captureShellEnvironment`, `src/shared/host/shell-env.ts`).
- The sminos home is resolved by `sminosHome(env, shell)` in `src/services/lane-a/discovery.ts`. Under a test runner it refuses a home under the real `~/.claude`.
- Nothing in MAWS runs the `sminos` command today. A terminal session is answered over its bridge's socket (`src/services/lane-a/driver.ts`, `answer`). The `sminos` launcher is on a session's `PATH` only because the engine puts a plugin's `bin/` there; it is `bin/sminos` under the plugin's install path, a shell script that runs `python3` from `PATH`, and sminos needs Python 3.10 or later.
- A local terminal session's transcript rows do not come through lane A: the engine host follows the session's file and emits `session.events`; lane A adds only the streaming tail.
- A transcript row never reads the lane A store, because desk-web bundles the rows (`apps/desk-web` imports `src/renderer/src/transcript/**` by relative path). A row reads the stores whose client is a parameter (`src/renderer/src/stores/attention.ts`).
- No lint rule keeps a renderer module that desk-web imports free of Electron, IPC or a store. The only lint-enforced portable tree is `src/artifacts/` (`PORTABLE` in `eslint.config.js`). The convention is the survey's: importing an entangled module is safe in a browser, calling it is not.
- The schema library is zod 4 (`import * as z from 'zod'`); nothing in the repository validates against a JSON Schema document.
- U1's "Today" paragraphs are history: U1b landed (pull request #748). A waiting question's form is in its call's row, the "Waiting for you" card is in the card column, and no side surface opens by itself. What this child amends is that code, named in §H and §I.
- On `origin/ux-wave/retire-tool-card` the rows of question tools are untouched: the branch changes how a tool call's `cell` row is drawn (a quiet line with a chevron, a 12 px glyph slot, detail indented 19 px, no box) and leaves `question` and `ask` rows bordered. It changes `model/rows.ts`, `model/schema.ts`, `model/derive.ts`, `view/transcript.css`, `view/rows/Group.tsx`, 53 files under `test/snapshots/transcript/` and `e2e/words-shots.rig.ts`, which is why M5 waits for it. The wave's session has said (2026-11-24) that the line's classes, its 12 px glyph slot with a 7 px gap and the 19 px indent of what stands under a line are settled unless the owner's last look at #852 changes them, that `GroupRow`'s `renderBody` is a general override of the opened body which another row may use with a test of its own, and that the wave will not restyle the `question` and `ask` rows.

## Decisions settled at authoring

Each is a choice the composite left to this child, numbered S1 to S18 (the charter's decisions are D-1 to D-21; these are not those). Where one makes a sentence of the composite false or incomplete, the sentence is in the last section.

- **S1 · MAWS runs the command** (X2; agreed with C2's side). The writer's call is `sminos sheet put --session <id>`, inbox lines on standard input, one JSON object on standard output. The sminos daemon's socket lost for three reasons the code shows: the daemon is an optional install, and a record must be answerable on a machine without it; MAWS does not connect to that daemon at all, the daemon connects to MAWS (`src/endpoint/rl10/server.ts`), and only while the machine is enrolled; and the command is the one code path that holds the record's lock, which a second server-side path would have to reproduce. The cost is one process of about 0.3 s per Send, paid when a person presses a button.
- **S2 · How MAWS finds the command** (§E, `locate.ts`; the writer's ruling of 2026-11-24). Two sources and no third: the executable named in `MAWS_SMINOS_CLI`, read from `mawsd`'s environment and then the login shell's; or the `bin/sminos` of an installation of the sminos plugin that is of user scope and enabled, read from the engine's own registry `<config>/plugins/installed_plugins.json` and its settings as `src/services/owner/resolve-style.ts` reads them. An installation of project scope, a disabled one, and a `sminos` that merely is on a `PATH` are never run: this is a machine-wide service with no project of its own, and it would be executing code some one project chose. The command runs with the login shell's environment, so `python3` resolves as it does in the person's terminal, with `SMINOS_HOME` set to the home the reader reads. A found command is proven once by a probe, `sminos sheet show --session 00000000-0000-4000-8000-000000000000`, whose exit 3 (`no sheet`) shows that the launcher runs, its Python is new enough and it knows the sheet's verbs; the proof is kept by path and modification time and made again when a spawn fails, since a plugin update removes the old version's directory. Nothing is located or run until there is a record to answer (§E, "When"). Under a test runner only `MAWS_SMINOS_CLI` is read, as `sminosHome` refuses the real home there. Reading stays possible when no command is found: the sheet is drawn and its Send is replaced by the reason. The alternative weighed was the path the sminos daemon's own service uses (`installed_cli` in `sminos_daemon.py`, the marketplace clone): it exists only where that service is installed and names a tree that can be newer than every running session's plugin.
- **S3 · The reader runs on the spine, in `src/services/sheet/`** beside lane A (the composite's advisory lean, taken). One reader per machine serves every window, and C4's page server, which is `mawsd`, calls the same module. It reads every record under the home, whichever kind of session wrote it, so C5 adds no reader.
- **S4 · MAWS's reader is its own code, held to the set.** `src/shared/sheet/read.ts` computes the model as C2's I4 words it, and a test compares it with every `show.before.json` and `show.after.json` of the pin. Calling `sminos sheet show --json` instead would cost a process per change and make reading depend on finding the command. The set's JSON Schema files are kept in the pin as reference and are not executed: the comparison with the set's own `show` outputs is the stronger check, and no JSON Schema validator joins the dependencies for it.
- **S5 · A record this build cannot read is said, not guessed.** Record-sourced shapes are parsed loosely (`z.looseObject`, as lane A parses what a bridge sends), so a later sminos that adds a field does not blank a sheet. A `state.json` whose `v` is not 1, or that does not parse, gives a summary marked `unreadable` and a sheet that says so in place of its cards.
- **S6 · A record is keyed by the engine's session id everywhere in this child**: the service, the wire, the store, the components. The app's own session id is joined on at the edges (a summary carries `appSessionId` when the index holds a session with that engine id, else null).
- **S7 · A change is announced small and read on demand.** `sheet.changed` carries a summary; a window fetches a model with `sheet.read` only for a session it shows. A model with previews can pass 100 KiB and most windows show no sheet.
- **S8 · The history being drawn is the base of a row, the record an overlay** (narrowed by the writer's ruling of 2026-11-24). A sheet call's row, its lines, their ids, "Revised below", "Withdrawn" after a later withdrawal and the receipt of a delivered answer are derived from the one transcript being drawn (X7's first line, the call's input, X3's block in an arrival), so they hold after a reload. While the record lives it supplies what that history lacks: that a question is open (so its line offers Open), an answer accepted and not delivered, a queued answer or dismissal, and an outcome that reached another history. Once the record is gone, a row shows the outcomes its own history holds and no others. A subagent's question answered to it directly, answered to the parent after it ended, or withdrawn by the parent has its outcome in a carrier this child does not read or in the parent's history; with the record gone that row shows its questions without receipts. No join is built across a parent's and a child's history. The alternative, receipts read from the record alone, would leave a cleared session's answered questions with no answer anywhere, because the delivery's own text is not drawn as a bubble.
- **S9 · A sheet call is a new row kind, `sheet`**, not a variant of `question`. `question` rows carry a waiting form and today's receipt shape, are a mod site, and are bundled by desk-web with those meanings; a sheet call shares none of them. The form is told by the call's input (composite §2.1), in the transcript's derivation, since the tool's name is the same.
- **S10 · A sheet item is one attention item per open question that has no queued answer**, of kind `async_input`, id `sheet:<session>:<question>`, made on the spine from the model (§H). It is in the session's waiting list (the "Waiting for you" card, Needs you, the session's row and tab) and in no placement: no form in a row, no card at the transcript's end, no waiting mark on a call. One predicate, `isSheetItem`, makes the difference in the three functions that place requests.
- **S11 · Notices.** A sheet item's notice is in-app only for a terminal session, as every lane A item's is (the owner's ruling in P5 O9, kept by U1's O-22: the terminal announces its own). It fires once per call: an item is announced when it is new and no item of the same call was announced before, so a call of eight questions makes one notice and a revise makes none. C5 decides what a MAWS-run session's sheet item does with macOS notifications.
- **S12 · The side sheet is a tool of the side column** (the charter's X5), id `sheet`, one per session, opened only by a person's act: Open on a row line, a line of the "Waiting for you" card, the notice's own button, or the side column's "+" menu. It is a second tool beside `ask-sheet`, which stays MAWS's `ask` form until C7.
- **S13 · The surface's memory** (drafts, the revision of each question the person last saw, the acts this window sent, a Send in flight) is held per session in the window, outside the components, and passed to them (§G). It is dropped for a question when the model no longer lists it. A draft survives a rewrite and is shown on the rewritten card, but it stays at the revision it was typed against until the person confirms or edits it there, and until then it is neither counted in Send nor sent (§B; the writer's ruling of 2026-11-24).
- **S14 · "Updated" stands until the person touches the card.** A card is marked updated when its revision is higher than the one the person last saw, and the mark clears when the person confirms or edits that card's draft, or dismisses the question. Clearing on sight would remove the mark before it was read.
- **S15 · What a surface shows for an act it sent** is read from the model's `sent` by the act's key, never from the act itself (composite §4.3, §5.4). A refusal as stale marks the card and restores the draft; `closed` and `too-late` are said in a note at the head of the sheet that stays until the person closes it, since a lost answer is worth more than three seconds.
- **S16 · The overview component is built and not mounted in the app.** `SheetOverview` is C4's `/`; §8.1 gives the app no overview of sheets. In the app a stopped session's questions show where every session's do: its pane, its "Waiting for you" card, Needs you.
- **S17 · The live check is set up as C2's own is.** A terminal session takes the sheet only with a live surface registration (composite §7), which C4 writes, and only when the plugin its `claude` loads is one that has the sheet. So G2's session is started as C2's live check starts one: the doperpowers checkout's plugin (`--plugin-dir`), function hooks on, the setting on, C2's stand-in surface running, and one scratch sminos home that the terminal, the stand-in and the app's `mawsd` all share. `MAWS_SMINOS_CLI` names the same checkout's command; it chooses the writer MAWS runs and nothing about the session. The app registers nothing in this child: a registration names a page's address, and the app has none.
- **S18 · Two landings.** C3a is M1 to M3 and C3b is M4 to M6, each a pull request. C3a holds everything C4 consumes and nothing a person can reach in the app, so it can merge as soon as it is reviewed.

## The look

The composite fixes where each thing is and how it behaves; it does not fix appearance. This repository settles appearance for a new surface the way the UX wave's children did: a drawn example goes to the owner with question cards, and the answers are recorded verbatim. That is done.

**The drawn example** is one static page of six frames at real size, in the app's light-theme tokens and today's shapes, with invented names, paths and text. It is kept outside the repository with its generator (the UX wave's UC-11), by the session that holds the composite, which hands it to each drawing milestone's executor with the milestone; nothing of it is copied in. The owner gave no objection to the frames, so the drawn example is the look: where this document's words and a frame differ on spacing, emphasis or what recedes, the frame holds; where a ruling below is later than the frames, the ruling holds, and "What the frames do not show" lists each such place.

1. A sheet in the side column at its usual 380 px: four cards (a single-select question with a recommended option and a preview; a multi-select question with two picks and typed text; a text-only question with Markdown context and two references, one collapsed and changed since asked, one open at its lines; a subagent's), and one Send.
2. One card in each state: open; updated since seen; refused as stale; queued, with its row line; accepted and not yet delivered; and the line of a question hidden by a queued dismissal.
3. The row, on #852's line model: a call that added three, at rest; the same after an answer, a dismissal and a withdrawal; a revised question; a call that partly succeeded; a call that only withdrew; a call of eleven questions.
4. The "Waiting for you" card with five question lines beside a permission prompt's, and the jump button with and without a prompt.
5. The sheet at the column's narrowest, 280 px; the same sheet in place in an Overview card; a stopped session's card; the sidebar's Needs you.
6. The notes: an answer that came second, and the three other notes; a Send that is unavailable; a record this build cannot read; the empty side sheet.

**The owner's answers** (2026-11-24, on the drawn example), in the wave's form:

- "In the transcript, should a call that put questions on the sheet open with a head line ("Asked 3 questions") above its question lines?" = "Head line (Recommended)"
- "On a question card, where should the focused option's preview sit when the side column is at its usual 380 px?" = "Under, beside when wide (Recommended)"
- "Should an open sheet question raise the transcript's "Needs you" pill (the jump button)?" = "No (Recommended)"
- "Should a stopped session's open sheet questions count in the sidebar's Needs you and the dock badge?" = "Count, drawn calm (Recommended)": they are items like any other, but their row in Needs you uses a calm tone, not the warning tone every row there has today.

**Settled**, each with the one place it lives:

| | what is settled | by | where it lives |
|---|---|---|---|
| L1 | A sheet call's row opens with a head line saying what the call did; the question lines stand under it at rest, and its chevron folds them. | the owner | `SheetRow.tsx` |
| L2 | A call of many questions shows its first eight lines, then "N more". | the composite's writer | `SheetRow.tsx`, one constant |
| L3 | The option's preview stands under the options below 560 px of card width and beside them from 560 px. With no option focused it is the picked option's, else the recommended one's, so the card does not move when focus leaves the options. | the owner; the second sentence the writer | `QuestionCard.tsx`, one constant and one rule |
| L4 | An open sheet question does not raise the transcript's jump pill. The pill's visible words are "Needs you" ("Needs your input" is its accessible name, `NEEDS_INPUT` in `R/transcript/model/copy.ts`). | the owner | `placeWaiting` (§H) |
| L5 | A stopped session's open sheet questions are items like any other: the session is in the sidebar's Needs you and counted in the dock badge. Its row there is drawn in a calm tone, as is the row of any session whose waiting items are all sheet questions. | the owner; the reach by the composite's writer | the items, `src/services/sheet/attention.ts`; the tone, `needsYou` in `R/attention/derive.ts` and `R/sidebar/NeedsYou.tsx` (§H) |
| L6 | The words, as drawn and as the writer settled them. | the frames; the writer | §I's lists, in `R/sheet/copy.ts` and `R/transcript/model/copy.ts` |

**Settled by the composite's writer where the drawing showed a gap** (2026-11-24; the first three are in the composite's §8 and §8.1 at the parent pin):

- A row line and a waiting line show the question's first sentence that ends in a question mark, or its first sentence when none does (`questionSentence`, §B), so a question that opens with a statement is not shown as its preamble.
- The preview with no option focused, as L3 says.
- L2's eight.
- The side column's tool is titled "Sheet", with its count: today's ask sheet is titled "Questions" and both live until the flip.
- A call that both adds and revises reads, in its head line, "Asked a question, revised q5". A refused entry's line shows its entry's number where an id would stand, so the "Not done" note can be matched to it.
- A card refused as stale carries the "Updated" badge and its note.
- In "Waiting for you", where the card is too narrow for a subagent's line (its mark, the question, "from <agent>", its age), "from <agent>" gives way before the question does.

**What each drawing milestone builds to match.** The tokens and the app's own classes named here are the drawing's; a milestone's executor has the frames before it and builds to them.

- **M3** (frames 1, 2, 5's left column and its Overview card, 6). The sheet stands on the column's ground: notes at its head, cards 8 px apart inside 12 px, a foot with Send at its right behind one border. A card is the Overview card's box with its blocks 12 px apart: a small muted head (the id fainter, the header, "· from <agent>", and the "Updated" badge at its right); the question at medium weight; the option rows of today's question form, each with its number, its label, a small muted description, and "Recommended" small and muted after the label; a picked row filled, a focused one in the accent ring; the preview in a bordered box that names its option; the text field; Dismiss as a quiet word at the foot. The stale note is a box edged in the warning token above the options. A reference is one line (a chevron, the path in the mono face, its range muted, "Changed since asked" after a small warning dot) that opens to numbered lines, with a control to open the file. A queued answer is read back in the receipt's shape, its text under it, the state's sentence small and muted, "Take back" and "Edit" at the right. An accepted outcome is a read-only box on the column's ground: the receipt, then "Accepted. Not delivered yet." A question hidden by a queued dismissal is one muted line with "Take back". Compact, in an Overview card: no box inside the host's box, each question one fold line (chevron, id, header, sentence) with a rule between, the chosen one open beneath it, one Send.
- **M4** (frame 4; frame 5's stopped session and sidebar; the tab). A question's line in "Waiting for you" is the `?` mark in the calm tone, the question's sentence cut with an ellipsis, "from <agent>" muted, its age muted. The tab is the side column's own, titled "Sheet" with the count beside it. The stopped session's Overview card and its Needs you row, in the calm tone.
- **M5** (frame 3; frame 2's row line). The head is a run's quiet line with its chevron; the question lines stand 19 px in, in one grid, so that ids, headers, sentences and Open stand in columns: the id small and faint, the header at medium weight and cut at about fifteen characters' width, the sentence cut with an ellipsis, Open a quiet button at the line's end. A receipt keeps today's receipt tones (the label, the arrow, the answer). "Dismissed" and "Withdrawn" stand where an answer would, muted; "Revised below", "Not asked" and "queued" are fainter still, and a line that moved away has its header muted. "N more" is a quiet button under the lines and "Not done: …" a small note. A call that only withdrew is its head line alone, with no chevron.

**What the frames do not show**, and what is built there:

- The tab reads "Questions" in the frames; it is "Sheet" (above).
- The frames' row lines and waiting lines show a question's first sentence; they were drawn before the question-mark rule, which holds.
- Frame 4 cuts the question before "from reviewer"; the writer's rule is the other way round, and holds.
- A carried draft. Frame 2's updated card shows the kept pick as picked and has no control to keep it; it was drawn before the ruling that a carried draft is shown as carried and is not sent until kept or edited (§B). Built at one place, `QuestionCard.tsx`: the carried picks in the muted tone and not filled, one line above the options ("You wrote this before the question changed.") with a secondary button ("Keep my answer"), in the stale note's place and shape but edged in the neutral border. This is the one part of the card the owner has not seen; it is on the list for the built look at M6.
- The calm Needs you row. Frame 5's sidebar draws both rows with the warning mark; it was drawn before the answer. Built as the row's own mark in the `info` token, the token "Question waiting" already has, where the list's rows use `warning` today.
- A refused entry's number: frame 3 leaves the id's place empty. Built as the bare number in the id's place and tone.
- Send's rest. No frame has more than fifty drafts; the words stand in the foot at Send's left, small and muted, as the unavailable reason does in frame 6.

**The built look.** M6 photographs the built surfaces with the words rig (`pnpm shots:words`, `e2e/words-shots.rig.ts`), to a directory outside the repository, and hands the pictures to the composite's writer for the owner, the carried draft's card and the calm row first.

## Interfaces and Dependencies

Paths are from the repository's root. `R/` is `src/renderer/src/`. A name given here is the name that must exist at the end of the milestone that makes it; where an executor finds a better shape, it reports it and the controller rewrites this section, since later milestones and two other children read it.

### §A · The pin (M1)

    test/fixtures/sheet/set/           the set, copied whole and byte for byte: README.md, MANIFEST.json, schema/, examples/, grammar/, fixtures/
    test/fixtures/sheet/PROVENANCE.md  what it is a copy of, and the rule for copying it again

`PROVENANCE.md` follows `test/fixtures/lane-a/dx4-jobs.PROVENANCE.md` and holds one table row with the three values C2's plan names: the doperpowers merge commit of pull request #628, the sminos version that merge published, and the manifest's `digest` (with its `version`). It says: never edit a file of the copy; when the composite's writer rules a change to the set, copy the directory again and move the three values.

`src/shared/sheet/pin.test.ts` recomputes the digest as the set's README defines it (the SHA-256 of the lines `<sha256>  <path>\n` of every file but `MANIFEST.json`, sorted by path) and asserts three things: it equals `MANIFEST.json`'s `digest`; it equals the digest `PROVENANCE.md` names; the directory holds no file the manifest lacks. The set holds a PNG, files without a final newline and an inbox that ends in a torn line, so `.gitattributes` marks `test/fixtures/sheet/set/**` as `-text`, and the formatter and the linter ignore the directory.

§B to §D are written to the pin, doperpowers `2594002af`: 21 fixture directories, 6 examples (with `split/then`), the result grammar with its examples, six schemas, and a README whose section "Readings fixed with the set" is read with them. They were first written to the set at `9f4860205` and corrected to the pin on 2026-11-24 (the differences: the queued `sent` entry's three kinds and the lone surrogate, §B; the unlocked reader's glimpse of a rolled-back write, §C). **What the pin holds binds** wherever a later reading finds these sections differ from it.

### §B · The model (M1)

`src/shared/sheet/` is pure TypeScript: no Node builtin, no DOM, no React. It is the half of the composite's X5 that is not a component.

`model.ts` holds the types of the model and their zod schemas, field for field as the pin's `schema/show.schema.json` and `schema/inbox-line.schema.json` state them, their patterns matched against the whole string:

    SheetSessionId  the engine's session id in the form the command takes: ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
    isSheetSession  (value: string) => boolean
    SheetModel      { v: 1, session, seq, open: SheetQuestion[], hidden: { id, key }[], sent: SheetSent[], pending: SheetOutcome[], closed: Record<id, SheetClosed> }
    SheetQuestion   a question of §1 with `handle`, its references each with `changed`, and `queued` when a queued answer stands on it
    SheetOutcome    by `kind`: an answer (with `picks`, the cut labels, and `places`, the same picks as integers from 1) or a dismissal; each with its question's snapshot
    SheetClosed     by `how`: answered (with `receipt` and `places`), dismissed, withdrawn (never a `deliveredAt`)
    SheetSent       by `state`, and within a state by `kind`: queued is an answer or a dismissal (with `id`, and `cancelled` where a queued retract names it), a retract (with `target`) or a `delivered` line (neither);
                    accepted, delivered, stale (with `current`), closed (with `how`), retracted and too-late each as the pin's `show.schema.json` gives their kinds
    SheetSentState  'queued' | 'accepted' | 'delivered' | 'stale' | 'closed' | 'retracted' | 'too-late'
    SheetReference  SheetOption  SheetAsker
    SheetLine       one inbox line as a surface writes it: { v: 1, key, kind: 'answer' | 'dismiss' | 'retract', id?, revision?, picks?, text?, images?, target?, by }
    SheetBy         'maws' | 'page' | 'desk' | 'cli'
    SheetSummary    { session, appSessionId: AppSessionId | null, title: string | null, live: boolean | null, seq, open, queued, pending, hidden,
                      oldestAskedAt: string | null, unreadable: boolean }
    SheetPutEntry   what the door prints for one line: { key, state: 'queued' } | { key, state: 'applied' | 'stale' | 'closed' | 'retracted' | 'too-late', kind, at, … } (loose; the verdict's own fields)
    SheetPutResult  { ok: true, results: SheetPutEntry[] } | { ok: false, why: 'unavailable' | 'no-sheet' | 'refused' | 'busy' | 'failed', message: string }
    SheetBodyRequest { ref: string /* a reference's sha256 */ } | { upload: string /* `uploads/<name>`, as a line names it */ } | { text: string /* a text file's sha256 */ }
    SheetBody       { kind: 'text', text: string } | { kind: 'image', mediaType: SheetImageType, data: string /* base64 */ } | { kind: 'gone' }
    SheetImageType  'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

A surface writes no `at` and no `batch`: the door fills both. `SheetSummary.open` counts the listed questions that carry no queued answer, `queued` those that carry one, `pending` the accepted outcomes not delivered, `hidden` the questions with a queued dismissal. `live` is whether a process holds the session, from the index's holder; null when the index does not hold the session.

`isSheetSession` is the one rule for a session's name in this child. Every function of §C that takes a session, and every command of §D, refuses a value it does not hold for, before any path is made from it: MAWS's own `SessionId` schema takes any non-empty string (`src/shared/graph/ids.ts`), and a record's directory is named by this value.

`read.ts`, the reader's computation:

    export function modelOf(state: SheetState, tail: Uint8Array, changedOf: (reference: StoredReference) => boolean | null): SheetModel
    export function lineError(line: unknown): string | null            // why an inbox line fails the line's schema, or null
    export function summaryOf(model: SheetModel, facts: Pick<SheetSummary, 'appSessionId' | 'title' | 'live'>): SheetSummary

`modelOf` is C2's I4, steps 2 to 7, on bytes already read; `tail` is the inbox from `state.inbox.offset` to the end of the file, and the function itself stops at the last newline. Pitfalls the Python source shows and a port gets wrong: `sent`'s keys sort by code unit (the default comparator; keys are ASCII), never by locale; every cut counts code points (`[...text]`), not UTF-16 units, and a pending outcome is cut as the README lists (the question at 2,000, its header at 60, each label and each pick at 200, a subagent's name at 200) with `places` read from the whole labels before any is cut; a tail line is dropped when it is not valid UTF-8, is not JSON (`NaN` and the infinities are not), holds a lone UTF-16 surrogate in any string, fails the line's schema, or answers an open question at its current revision with a pick that is no label of it or with two picks on a single-select question; a queued line is dropped when its key has a verdict or occurred earlier in the tail. A queued `sent` entry is projected by its kind, as the show schema separates them (an answer's or a dismissal's `id`, a retract's `target`, a `delivered` line's neither), whatever other field the inbox line carried. `sent` and every map keyed by an inbox key keep an own key named `__proto__` (a valid key). A lone UTF-16 surrogate in any string the model carries from `state.json` (where `JSON.parse` keeps it) is written as U+FFFD, as `show` prints it (the README's "A reader never fails on a record's strings"); it is a tail line holding one that is dropped.

`call.ts`, the stored call (X7):

    export function isSheetCall(input: unknown): boolean                 // an object with `ask` or `withdraw`
    export type SheetResult = { form: 'sentences'; added: { id: string; entry?: number }[]; revised: { id: string; entry?: number; revision: number }[]; withdrew: string[] }
                            | { form: 'nothing' } | { form: 'unknown' }
    export function parseSheetResult(text: string): SheetResult | null   // the result's first line alone; null: it is not of the grammar (a denial; not a sheet call's result)
    export interface CallEntry { entry: number; id: string | null; revision: number | null; outcome: 'added' | 'revised' | 'refused' | 'unknown';
                                 header: string | null; question: string; options: string[]; multiSelect: boolean }
    export function callEntries(input: unknown, resultText: string | null): { result: SheetResult | null; entries: CallEntry[]; withdrew: string[]; notDone: string | null }

The pattern is the pin's `grammar/result.md`, matched whole against the result's first line, and `parseSheetResult` answers exactly the `parsed` object of `grammar/result.examples.json`. `callEntries` takes the result's text, not the parsed line: the reasons of a refusal are on the second line, which the first line's parse does not hold, and `notDone` is that line whole (`Not done: …`) when the text has one. It pairs entries with ids by the grammar's own rule: an entry that names an `id` is a revise of that id; the entries that name none are the added ones, in order, paired with `added` by place when no item carries `(entry n)` and by that number when any does; an entry in neither sentence is `refused`. With `resultText` null (the call has no result yet) or a first line of form `unknown`, every entry's `id` is null, a revise's included, and its outcome `unknown`: the grammar's "a reader draws no ids for such a call".

`delivery.ts`, the block (X3):

    export interface SheetDelivery { v: 1; keys: string[]; answered: { id: string; revision: number; picks: number[]; text: string; textCut?: true; textFile?: string; images: string[] }[];
                                     dismissed: string[]; more?: true }
    export function parseSheetDeliveries(text: string): SheetDelivery[]   // every <sheet-delivery>…</sheet-delivery> of a text, each held to the pin's delivery schema; none for a text without one

A reader reads the block and nothing above it (C2's I7). The block is held to every bound the pin's delivery schema states, and, like every record-sourced shape (S5), takes a field it does not know.

`questionSentence`'s rule is one definition shared with C2's terminal row, so the two surfaces show the same line (the composite's writer, 2026-11-24, folded into M5). A sentence ends (a) at a line break; (b) at a run of `.`, `?`, `!` with closing quotes or brackets kept, only where whitespace or the end follows; (c) at a run of the full-width marks `。？！` with closing quotes or brackets kept, whatever follows. A sentence asks when its ending run holds `?` or `？`. The pattern is `/(?:[.?!]+["'”’)\]]*(?=\s|$)|[。？！]+["'”’)\]」』）]*)/g`, and `asks` tests `/[?？]/`. The writer's eleven cases are in `words.test.ts` as given: "We ship Friday. Keep the earlier sailing?" gives "Keep the earlier sailing?"; "Use v1.2 or v2.0?" the whole text; "Pick one" itself; "First line\nWhich one?" "Which one?"; `He said "go?" Then left.` gives `He said "go?"`; "배포할까요？다음 주에 합니다。" gives "배포할까요？"; "Statement。Question？rest" gives "Question？"; "What?! Really." gives "What?!"; "No marks here\nSecond line." gives "No marks here"; "e.g. this?" gives "this?"; "" gives "".

`text.ts` holds strings as the sheet counts them, for every module here: `codePoints`, `cut`, `hasLoneSurrogate`, `wellFormed`.

`words.ts`:

    export function questionSentence(text: string): string               // the first sentence that asks, or the first sentence when none does (the rule below)
    export function receiptOf(labels: readonly string[], text: string): string   // the labels joined by ", "; with none, the text's first 80 characters: the record's own rule (C2's I2), so a receipt reads alike from either source
    export interface QuestionDraft { revision: number; picks: string[]; text: string; images: string[]; replaces?: string }
    export const hasAnswer = (draft: QuestionDraft | undefined): boolean // a pick, or text that is not blank; an image alone is no answer (§4.1)
    export const isConfirmed = (draft: QuestionDraft, question: SheetQuestion): boolean   // draft.revision === question.revision
    export function confirmDraft(draft: QuestionDraft, question: SheetQuestion): QuestionDraft   // the person's act on a rewritten card: its revision becomes the question's; its picks are kept where they are still labels (one at most unless multi-select)
    export const SEND_MAX_LINES = 50
    export function sendOf(open: readonly SheetQuestion[], drafts: ReadonlyMap<string, QuestionDraft>, by: SheetBy, newKey: () => string): { lines: SheetLine[]; ids: string[]; left: number }

A draft holds what the person typed and **the revision they typed it against**. `picks` are labels, `images` are `uploads/<name>`, and `replaces` is the key of a queued answer this draft edits. A draft is never moved onto another revision by code: the revision check exists so that nobody answers wording they did not read (composite §4.2; the writer's ruling of 2026-11-24), so a draft whose revision is not the question's is kept, is shown on the rewritten card, and is neither counted nor sent until the person confirms it or edits it there, which is the only caller of `confirmDraft`.

`sendOf` is one Send (the writer's ruling of 2026-11-24: one Send is one call of the door and at most fifty inbox lines; no chunking). It takes the open questions oldest first, and for each whose draft has an answer and is confirmed it adds that draft's inbox lines: one `answer`, or, where the draft has `replaces`, a `retract` of that key and then the `answer`, the two never parted. It stops before the draft whose lines would pass `SEND_MAX_LINES`, and takes nothing after it: a later one-line draft is not slipped in ahead. An answer's `picks`, `text` and `images` are written only when not empty, and `text` only when not blank. `ids` are the questions it answers, `left` the count of confirmed drafts with an answer that it did not take; they stay drafts for the next Send.

### §C · Reading records (M1), and the service (M2)

`src/services/sheet/` runs in Node, on the spine. As built (M2): `reader.ts`, `service.ts` (following, the join, the door, the boundary), `files.ts` (bodies, uploads and the signature check: confined IO), `timing.ts` (the timing `command-budgets.ts` imports), `locate.ts`, `door.ts`.

`reader.ts` (M1):

    export const sheetRoot = (home: string): string                      // <home>/sheet
    export async function listRecords(home: string): Promise<string[]>   // the session ids with a record: every directory of the root that holds a state.json
    export interface RecordIo { entry(path: string): Promise<'directory' | 'file' | 'other' | null> /* lstat */; readState(path: string): Promise<unknown>; readTail(path: string, offset: number): Promise<Uint8Array>; stat(path: string): Promise<{ size: number; mtimeMs: number } | null> }
    export async function readRecord(home: string, session: string, io?: RecordIo): Promise<{ model: SheetModel } | { unreadable: string } | { busy: true } | null>

`listRecords` skips `surfaces`, `.staging`, the `*.lock` files (C2's I1), any name `isSheetSession` does not hold for, and any entry that is not a real directory. `readRecord` refuses a session `isSheetSession` does not hold for, and is I4's step 1 around `modelOf`: `state.json`, the inbox from its offset, `state.json` again, over while `seq` moved, at most four times; if `seq` moved every time it answers `busy` and **returns no pair it did not verify** (the set's README, "A reader that cannot pair"; the command's own exit 75). Null when there is no record, and when the record's directory is a link or not a directory (it is then not listed either); a `state.json` or inbox that is a link or not a regular file reads `unreadable`, as does a `state.json` whose `v` is not 1, that does not parse, or that fails the loose `SheetStateSchema` (the pin's `state.schema.json` for what the model is computed from). So does a `state.json` that is not valid UTF-8, or whose `session` is not the directory's name. An `unreadable` reason is a fixed sentence of the exported `UNREADABLE` table: it names no path and echoes nothing of the record. Only a missing path reads as absent; any other failure to `lstat` the record is `unreadable`, never gone. `io` exists so that a test can move `seq` under the loop, and every touch of the file system goes through it; it defaults to the file system, exported as `recordIo`. `changedOf` compares the file at a reference's `abs` with the record's `size` and `mtimeMs`, the modification time floored to a millisecond from nanoseconds (`fs.stat` with `bigint: true`: the float `mtimeMs` rounds the other way on some values), and reads a missing file as changed. A reader takes no lock and writes nothing.

**Confinement.** A record is `<root>/<session>` and nothing else. Before a file under it is read or written, the record's directory, and `refs/`, `uploads/` or `texts/` where one is entered, are checked with `lstat` to be real directories, and a body to be a regular file; a symbolic link or a special file at any of them is refused, as the door refuses a linked `uploads/` and a file that is not regular. A name a caller gives (an upload's) is held to the line schema's pattern and so has no separator.

`service.ts` (M2):

    export interface SheetServiceDeps {
      home: Promise<string>;                                   // sminosHome(deps.env, shellEnv), as lane A's driver gets it
      shell: Promise<Record<string, string>>;                  // the login shell's environment
      env: Env; configHome: Promise<string>;                 // the engine's config home, under the login shell's environment
      io?: RecordIo; locate?: { underTest: boolean; systemRoot?: string };   // the tests' seams
      sessionOf(engineSessionId: string): { appSessionId: AppSessionId; title: string | null; live: boolean } | null;   // from the index
      onSessionsChanged(listener: () => void): () => void;     // the index's sessions moved: one was added, changed its holder or title, or was removed
      emit(name: 'sheet.changed', payload: EventPayload<'sheet.changed'>): void;
      timing?: { pollMs: number; debounceMs: number; putMs: number };   // 2000, 50, 25000
    }
    export interface SheetService {
      list(): Promise<SheetSummary[]>;
      read(session: string): Promise<SheetModel | null>;
      put(session: string, lines: SheetLine[]): Promise<SheetPutResult>;
      body(session: string, of: SheetBodyRequest): Promise<SheetBody>;
      upload(session: string, image: { mediaType: SheetImageType; data: string }): Promise<{ ok: true; path: string } | { ok: false; why: string }>;
      onChange(listener: (summary: SheetSummary | null, session: string, was: SheetSummary | null) => void): () => void;   // what §H's items are made from
      door(): DoorState;                                       // what is known now; it starts nothing
      verified(session: string): SheetModel | null;            // the model as last verified: no read, nothing located (M4: what §H's items are made from at an announcement)
      stop(): void;
    }
    export type DoorState /* a z.union: two variants share known: true */ = { known: false } | { known: true; available: true } | { known: true; available: false; reason: string }
    export function createSheetService(deps: SheetServiceDeps): SheetService
    export function registerSheet(service: SheetService, register: Register): void

It is started in `startSpine` (`src/services/spine-root.ts`) beside the lane A driver, under the same condition, and joins `parts` for the stop. It is also what C4's page server calls, in process, so every rule of this section holds at the service's own boundary and not only at the wire's: `SpineRoot` gains `sheet?: SheetService` (absent in a run refused the spine), which is how the page reaches it, since the wire's `sheet.put` stamps `by: 'maws'` and the page's lines are not the app's (the composite's writer, 2026-11-24, for C4's §N and §P).

**Following records.** The service watches `<home>/sheet/` with `watchTree` (`src/shared/fs/watch-tree.ts`) and, because the directory may not exist yet and a file event can be lost, also lists it every `pollMs`, as `watchBridgeDir` does for `bridge/`. While `<home>/sheet/` does not exist the service also notices its creation within the second the milestone promises (a watch of the home, or a poll short enough), so a machine's first record is announced as fast as any later one. A change under a record's directory re-reads that record after `debounceMs`; a reader that takes no lock can see a call's first inbox lines between a short write and its completion, or lines the door then cuts back (the README's "The door"), so an inbox that shrinks is a change like one that grows; a summary is emitted when the record appeared, went, or its `seq`, its inbox's length or its count of queued lines moved. A read that answers `busy` changes nothing: the service keeps the last model it verified, emits nothing, and reads again at the next tick. A record that went emits null.

**Following the index.** A summary joins a record to the app's session by `sessionOf`, and that join moves without any file moving: a record can be found before the index holds its session, a terminal can close without writing to its sheet, a session can be removed. So the service projects again on `onSessionsChanged`, from the models it already holds and with no file read, and emits each summary whose `appSessionId`, `title` or `live` moved; `onChange` hands a listener the summary as it was, so §H's feeder clears the list of the app session a record no longer joins. Lane A's driver follows the index the same way (`index.sessions.onChange` in `spine-root.ts`).

**Bodies.** The service resolves each `SheetBodyRequest` against the record itself and never against a path a window sent: a `ref` must be the `sha256` of a reference of a listed question; an `upload` may be any regular file directly under the record's `uploads/` whose `uploads/<name>` the line schema's image pattern allows, named by the model or not, so a draft's just-pasted image reads again after a remount or a reload (the composite's writer, 2026-11-24); a `text` must be a pending outcome's `textFile`. A text reference is returned as text; an image only as one of the four raster types, its bytes' signature that type's; anything else, anything over 16 MiB, anything missing, and anything Confinement refuses, as `gone`. A text body is decoded leniently (U+FFFD). This is §8.2's fourth rule read for the app, where it costs nothing: bytes an agent chose are never handed to a window as markup.

**Uploads.** `upload` writes `<record>/uploads/maws-<32 hex>.<ext>` exclusively, mode 0600, from at most 5 MiB of decoded bytes (the composer's own bound after `downscaleImage`, `R/composer/editor/attachments.ts`), and answers its `uploads/<name>`. It refuses bytes whose signature is not the raster type `mediaType` names: that check lives here, in the service, so the app and C4's page hold it at one boundary (the composite's writer, 2026-11-24). It refuses when the session has no record (no `state.json`), as `body` does for an upload, and under Confinement: an `uploads/` that is a link is refused before a byte is written, and an absent one is made as a directory of mode 0700. A surface writes `uploads/` itself before the door names the file (C2's "Who acts, and on which file"). An image pasted and never sent stays until the record is removed; that is logged as debt, not swept.

### §D · The wire (M2)

`src/shared/ipc/schema/sheet.ts`, with its names (`src/shared/ipc/names/sheet.ts`) and grades (`src/shared/ipc/grades/sheet.ts`), wired as `src/shared/ipc/schema/lane-a.ts` is. Every command's `owner` is `'machine'`, and every `session` field is the schema of `SheetSessionId`, not `SessionIdSchema`.

    sheet.list    {}                                  → { sessions: SheetSummary[]; door: DoorState }
    sheet.read    { session }                         → { model: SheetModel | null; door: DoorState }
    sheet.put     { session, lines: SheetLine[] }     → SheetPutResult
    sheet.body    { session, of: SheetBodyRequest }   → SheetBody
    sheet.upload  { session, mediaType, data }        → { ok: true; path: string } | { ok: false; why: string }
    event sheet.changed   { session, summary: SheetSummary | null }

`sheet.changed` joins `MACHINE_EVENTS`. `sheet.put` can wait on the record's lock and on the session's bridge, ten seconds each, so it gets a budget of 30 s in `src/services/command-budgets.ts`. A new namespace moves the wire: `WIRE_MINOR` in `src/shared/ipc/wire.ts` rises by one over whatever master holds then, and the pinned `wire-manifest.json`, `wire-fingerprint.json` and `routes.json` are regenerated. `sheet.put`'s handler stamps `by: 'maws'` on every inbox line and refuses, before any process starts, a call of more than fifty inbox lines or a line that fails `lineError`.

**No remote caller reaches these in this child.** The commands must be callable by a window on this machine and refused to every caller that comes through the endpoint, an owner's included, until C6 decides what each does for one. Neither grade that no caller holds fits: `internal` is the main-only commands' and `client` is a fixed set that stays with the app (`src/shared/ipc/grades.test.ts` holds both sets exactly). The contract's own tool for this is the by-effect grade with no rule: each command is graded `{ floor, byEffect: true }` (`list`, `read` and `body` at `view`; `put` and `upload` at `converse`), and `src/endpoint/by-effect.ts` gets one explicit `NO_RULE` row for each, which the endpoint refuses remotely as `no-rule` "until someone reads what the command does for a remote caller". `sheet.list` is refused earlier, as `no-target`: its input names no session, so its `view` floor fails before the row is read; under the real offer table all five are `not-offered`. C6 replaces the rows it needs with rules, and a remote list needs a placement per session as well as a rule. `sheet.changed` goes to this machine's app and to no linked machine's until C6.

### §E · The door and its locator (M2)

`src/services/sheet/locate.ts`:

    export interface SminosCli { path: string; env: Record<string, string>; source: 'named' | 'plugin' }
    export type Located = { ok: true; cli: SminosCli } | { ok: false; reason: 'not-installed' | 'no-sheet-verbs' | 'not-runnable'; detail: string }
    export function locateSminos(deps: { env: Env; shell: Record<string, string>; configHome: string; home: string; underTest?: boolean; systemRoot?: string; proofs?: …; probeMs?: number }): Promise<Located>

S2 is its contract. `env` of the result is the login shell's environment with `SMINOS_HOME` set to `home`. The plugin source reads the registry's entries whose id begins `sminos@` and takes one only when its scope is `user` and its id is enabled (`enabledPlugins[id] === true`) in the settings that apply without a project, the user's and the managed ones, read as `pluginInstallPaths` reads them in `src/services/owner/resolve-style.ts`. An installation of project or local scope, and a disabled one, is never taken, whatever else is missing: the probe executes what it finds, and exit 3 shows that a command can do the work, not that this machine's owner chose it. The probe's three outcomes: exit 3 is `ok`; a process that cannot start, or exits with sminos's own complaint about its Python, is `not-runnable`; any other exit is `no-sheet-verbs` (an installed sminos older than C2's first merge). `detail` is one sentence a card can show; it names no path.

**When.** `locateSminos` runs, and so anything is executed, only when there is a record to answer: at the first `read` that finds a record with something on its sheet, or at a `put`. The rule lives in `SheetService.read` and `put` themselves, not in the wire's handlers, since C4's page reaches the service without the wire. "Something on its sheet" is an open question or a queued dismissal, what a Send or a take back acts on. A `read` locates while the door is not known to be available (so a sheet whose Send is replaced by the reason recovers), and never holds its model back for it: it answers within the host's deadline whatever the probe does, the door's state reading as it was until the probe ends. A `put` locates every time, but only for a session that has a record: a `put` to a session with no `state.json` is `no-sheet` with nothing executed, and one whose `inbox.jsonl` exists and is a link or not a regular file is `refused` ("The sheet's inbox is a link or not a regular file.") with nothing executed. `put` holds its lines to `SheetLineSchema` (a surface writes `answer`, `dismiss` and `retract` only) and to `lineError` at the service's own boundary, so an in-process caller can send no `delivered` line. The probe and the write share the `put`'s one budget, inside the wire's 30 s. only a successful probe is kept. A probe that times out (10 s), a launcher exiting 126 or 127, and a `MAWS_SMINOS_CLI` that is not absolute read `not-runnable`; a named command is taken with no fallback to the plugin; of several user-scope installations the first in the registry's order whose `bin/sminos` exists. `list` and a window's connection start nothing; until then the door's state is `{ known: false }` and a sheet draws its Send as usual.

`src/services/sheet/door.ts`:

    export function putLines(cli: SminosCli, session: string, lines: readonly SheetLine[], timeoutMs: number): Promise<SheetPutResult>

It runs `[cli.path, 'sheet', 'put', '--session', session]` with `execFile`, no shell, the inbox lines as compact JSON on standard input, one a line. Exits, as C2's I3 and the set's README give them: 0, the object on standard output is `{ session, results }` and each result is a `SheetPutEntry`: `{ key, state: 'queued' }` for a line with no verdict yet, or the verdict the session's bridge gave, its `state` the verdict's name (`applied`, not a `SheetSentState`, for an applied line); a surface reads what became of an act from the model's `sent` (S15), never from this; 2 is `refused` with the first line of standard error (a line the door would not take: nothing was appended); 3 is `no-sheet`; 75 is `busy`; 1 (the inbox could not be written, and nothing was appended), any other exit, a timeout and output that is not the object are `failed`. Exit 0 is taken only when the object names the session asked for and holds one result for each inbox line sent, by key; anything else is `failed`. After `busy` or `failed` a surface sends **the same inbox lines again, under the same keys**: after a timeout nobody knows whether the lines were appended, and the key is what makes a resend the same act (composite §4.2).

`test/support/fake-sminos-cli.mjs`, the stand-in door, is an executable Node script that unit tests and e2e launches name in `MAWS_SMINOS_CLI`. It answers the probe with exit 3. For `sheet put` it validates nothing, appends the inbox lines to `<SMINOS_HOME>/sheet/<session>/inbox.jsonl` with `at` and one `batch`, and prints `queued` for each. Its knobs:

- `FAKE_SMINOS_EXIT`: exit with that code and a line on standard error, appending nothing. `FAKE_SMINOS_RESULTS`: a file whose object it prints in place of the `queued` results. `FAKE_SMINOS_RAN`: a file it appends its own path to at every start, so a test can assert which executable ran, or that none did.
- **The barrier.** With `FAKE_SMINOS_BARRIER` naming a file, a `put` waits, before it appends, until that file exists. Two windows' Sends are then both in flight, each seen at the barrier, before either is appended.
- **The staged outcome.** When `<SMINOS_HOME>/sheet/<session>.next/` exists it holds a fixture's `after` `state.json` and `keys.json`, that fixture's own keys in inbox order. The stand-in gives each inbox line it appends the place of the next of those keys, under a directory lock, and when every place is taken it replaces the record's `state.json` with the staged one, in which each of the fixture's keys is replaced by the key that took its place and `inbox.offset` is set to the inbox's real length. **It replays a fixture's `after`; it never applies a line.** §4.2's table has one implementation, the tool's, and a stand-in that computed verdicts would be a second. A window learns what became of an act from the model, as S15 says, so the replay prints no verdict.

**A seeded record** (M4's e2e, and any test that sends into a fixture's state) is a fixture's `before` with its inbox cut to the offset its `state.json` records. A fixture's `before` holds the inbox lines its step is about to apply, and copied whole it is a record on which those answers already stand queued.

`test/support/sminos-barrier.sh` is the barrier alone, for the live gate: named in `MAWS_SMINOS_CLI`, it waits for the file `SMINOS_BARRIER` names and then runs the real `sminos` given in `SMINOS_REAL` with its own arguments and input. Without `SMINOS_BARRIER` it runs it at once. It holds `sheet put` only: held, the locator's probe would make the door read unavailable before any Send. The stand-in's `EXIT`, `RESULTS` and `BARRIER` knobs likewise apply to `put` alone, `RAN` to every start, and it answers a `put` on a session with no `state.json` with exit 3, as the door does.

### §F · The window's store (M2, M4)

`R/stores/sheet.ts`, whose client is a parameter, as `R/stores/attention.ts`'s is, so a transcript row may read it and desk-web may bundle it:

    export const useSheets: UseBoundStore<…>        // summaries by session; models of the sessions on screen; memory by session; the door's state
    export function connectSheets(client: MawsBridge): () => void      // required: the store imports no IPC client; R/App.tsx passes `ipc`
    export function watchSheet(session: string, client?: MawsBridge): () => void   // keeps that session's model read while something shows it; counted; defaults to connectSheets' client
    export function resetSheetStore(): void                               // tests
    export const selectSheetSession = (state, appSessionId: AppSessionId): string | null   // the record of an app session, by its summary
    export const selectSheetModel = (state, session: string | null): SheetModel | null
    export const selectSheetMemory = (state, session: string): SheetMemory
    export function updateSheetMemory(session: string, update: (current: SheetMemory) => SheetMemory): void   // as built (M4): X5's onMemory hands an update; a session's memory is dropped when its record goes

M2 makes the summaries, the models and the connection; M4 adds the memory (§G). `connectSheets` is called where `connectLaneA` is, and connects in `connectLaneA`'s order (`R/stores/lane-a.ts`): it subscribes to `sheet.changed` first, holds what arrives while `sheet.list` is out, applies the list and then what it held, and asks again when the list was not available. It lists again at every new connection to the machine's host (a `mawsd` that restarted knows nothing of what went while it was down), applying the held changes after it and reading every watched session again. A record that appears between a snapshot and a subscription made after it would otherwise never show in that window, since the service speaks only on change. A model is fetched when a session is first watched and again at each `sheet.changed` for it while it is watched, and each read of a session carries a count that only grows: an answer is applied only when no later read of that session has been applied, so two reads that finish in the other order cannot put an older model over a newer one. `seq` cannot stand for that count, since an inbox line changes a model without moving it.

### §G · The components: the composite's X5 (M3)

**What a consumer imports.** Two directories, and nothing else of this child:

- `src/shared/sheet/` (§B): the model's types and schemas, `isSheetSession`, the draft's type with `sendOf` and `confirmDraft`, `receiptOf`, `questionSentence`, the parsers.
- `R/sheet/`, through `R/sheet/index.ts`: `QuestionCard`, `OutcomeCard`, `SessionSheet`, `SheetOverview`, `ReferenceView`, `SheetMarkdown` with its link policy `sheetLinkAction`, the type `SheetHost`, the memory's types with `EMPTY_MEMORY` and `reconcile`, and the copy `SHEET_WORDS`.

**What a consumer supplies.** A `SheetHost` (below), the model or the summaries, and a place to keep each session's memory. For styles: the app's tokens and theme map (`R/styles/app.css`), the Markdown's two stylesheets (`R/transcript/view/transcript.css`, `streamdown/styles.css`), and one Tailwind `@source` line naming `R/sheet` in its own stylesheet, as `apps/desk-web/src/styles/app.css` names the directories it imports. It supplies no link handling of the transcript's: the sheet's Markdown carries its own policy and reaches the consumer only through `host.openLink`.

**What stays in the app** and is no part of X5: `src/services/sheet/` (the files, the watch, the door, the locator), the wire, `R/stores/sheet.ts`, `R/tools/sheet/` (the side column's tool and the app's `SheetHost`), the sheet items and the transcript's row. C4's page server calls `src/services/sheet/` inside `mawsd`; desk-web reaches a machine's service by the path C6 builds.

**The boundary is enforced.** `R/sheet/**` imports only React, Radix primitives, `@shared/sheet/*`, `@shared/graph/ids`, `R/ui/*`, `R/request-card/controls` and `R/transcript/view/markdown/Markdown` with `R/transcript/view/context`: modules desk-web already imports as they stand, or leaves. An ESLint block for `src/renderer/src/sheet/**`, modelled on `PORTABLE`'s for `src/artifacts/`, refuses `electron`, Node builtins, `window.maws`, and any import from `R/ipc`, `R/stores`, `R/panel`, `R/session`, `R/lane-a`, `R/lane-b` and `R/tools`. `apps/desk-web/src/sheet-import.test.tsx` renders `SessionSheet` from a pinned fixture inside desk-web's own test project, so the import path a consumer uses is exercised by a gate; the same test clicks the sheet's links through an injected host ("Markdown", below).

    // R/sheet/host.ts
    export interface SheetHost {
      by: 'maws' | 'page' | 'desk';
      newKey(): string;                                        // one per act, of [A-Za-z0-9._:-], 8 to 128
      send(session: string, lines: SheetLine[]): Promise<SheetPutResult>;
      openLink(url: string): void;                             // an http or https link of agent-written Markdown; no other link reaches a host
      body(session: string, of: SheetBodyRequest): Promise<SheetBody>;
      saveImage?: (session: string, image: { mediaType: SheetImageType; bytes: Uint8Array }) => Promise<{ ok: true; path: string } | { ok: false; why: string }>;   // absent: pasting is not offered (the phone)
      openFile?: (abs: string, line: number | null) => void;   // a reference's file as it is now; absent: no such control
    }

    // R/sheet/memory.ts (as built, M3's second fix round)
    export interface SentAct {
      key: string;
      kind: 'answer' | 'dismiss' | 'retract';
      id: string | null;                       // the question: an answer's or a dismissal's own, a retract's target's
      draft: QuestionDraft | null;             // an answer's draft as it was sent: restored when the answer is refused as stale, or its Send released
      sentAt: number;
      state: 'sending' | SheetSentState | 'failed'; // 'sending' until the model knows the key (S15)
      note: string | null;                     // what the sheet's head says of it: an act that came second, a retract too late, a Send the door released
    }
    export interface SheetMemory {
      drafts: ReadonlyMap<string, QuestionDraft>;
      seen: ReadonlyMap<string, number>;
      marked: ReadonlySet<string>;
      headers: ReadonlyMap<string, string>;    // the header of each question drawn, while it is listed (with a header) or hidden: the hidden line's
      acts: readonly SentAct[];
      // the lines of one Send, held from the press until the door answers; `attempt` names the call that carries them now
      sending: { attempt: string; lines: readonly SheetLine[]; state: 'sending' | 'failed'; note: string | null } | null;
    }
    export const EMPTY_MEMORY: SheetMemory
    export function reconcile(memory: SheetMemory, model: SheetModel): SheetMemory

`reconcile` is pure and is the one place the rules of S13 to S15 live. It marks a question whose revision passed the one the person saw, and leaves its draft as it is, at the revision it was typed against. It reads each act's state from the model's `sent` by key; restores the draft of an act refused as stale, at the revision it was sent against, and marks its question; drops the draft, the seen revision and the mark of a question the model no longer lists; forgets an act once it reads `delivered` or `retracted`, and keeps one that reads `closed` or `too-late` until the person closes its note. `seen` gets a question's revision the first time the question is listed, and again when the person confirms or edits its card. `sending` holds the exact inbox lines of a Send from the press until the door has answered: a Send that failed, or whose answer never came, is sent again as those lines, keys and all, and no new Send is built while one is held.

    // R/sheet/QuestionCard.tsx: one open question; its root element carries data-sheet-question="<the question's id>" in the full and the compact form (X5: C4's page finds a card by it to scroll to it and to know which card is at the top)
    export interface QuestionCardProps {
      session: string;
      question: SheetQuestion;
      draft: QuestionDraft | undefined;
      mark: 'none' | 'updated' | 'stale';
      busy: boolean;                           // a Send of this surface is held (`memory.sending`), or an act on this question is still sending
      host: SheetHost;
      density?: 'full' | 'compact';            // compact: folded to its row line until chosen
      onDraft(update: (current: QuestionDraft | undefined) => QuestionDraft | null): void;   // a field's edit applies to the draft as it is at commit; Discard and Edit of a queued answer replace it whole (the branch review, 2026-11-24)
      onDismiss(): void;
      onRetract(key: string): void;            // take back the queued answer that stands on the question
      onAttach(path: string): void;            // a pasted image, saved (`uploads/<name>`): the handler the card had when the image was pasted is the one called, so it carries that session and question; it joins the draft as it is when it lands, confirming nothing
    }

    // R/sheet/OutcomeCard.tsx: an outcome accepted and not yet delivered, read-only
    export interface OutcomeCardProps { outcome: SheetOutcome }

    // R/sheet/SessionSheet.tsx: one session's sheet
    export interface SessionSheetProps {
      model: SheetModel;
      memory: SheetMemory;
      onMemory(update: (current: SheetMemory) => SheetMemory): void; // applied to this session's memory as it is at commit; may be called after unmount
      host: SheetHost;
      focus?: { id: string; request: number } | null;
      density?: 'full' | 'compact';
      unavailable?: string | null;
    }

    // R/sheet/SheetOverview.tsx: the sessions of a machine that have a sheet
    export interface SheetOverviewProps { sessions: readonly SheetSummary[]; onOpen(session: string): void;
                                          hrefOf?: (session: string) => string }   // given: each row is a real anchor with that href (C4's `/s/<session>`); absent: as without it

    // R/sheet/ReferenceView.tsx: one captured file, collapsed until opened
    export interface ReferenceViewProps { session: string; reference: SheetReference; host: SheetHost; open?: boolean; onOpenChange?: (open: boolean) => void }   // controlled when a card's Markdown link opens it

What each draws is the composite's §8 ("The card", "The sheet") and §4.3; what follows is only what those leave to this child.

- **The card's parts.** A question is in one of the states of frame 2. The card states them from its inputs alone: `question.queued` makes it queued (the queued answer shown, with take back, and edit, which opens a draft that `replaces` the queued answer's key, so that the next Send carries the retract and the new answer together); `mark` makes it updated or stale, and a stale card carries the "Updated" badge with its note; `OutcomeCard` is the accepted state. A draft whose revision is not the question's is drawn as carried, not as chosen: its text in the field, its picks marked where they are still labels, and one control to keep it, which with any edit of the card is what confirms it (`confirmDraft`). Until then the card counts for nothing in Send. The options are today's option rows (the Radix `RadioGroup` and `Checkbox` rows of `R/request-card/variants/Question.tsx`, read as the pattern and written again here, since that file reads the attention store). The preview is L3's: under the options below 560 px of the card's own width and beside them from there (the card measures itself, not the window), showing the focused option's, else the picked one's, else the recommended one's. The text field is always present. Dismiss is set apart, and for a question with a draft it asks nothing: the draft is dropped with the question.
- **References.** `ReferenceView` fetches its body through `host.body` when opened, never before, and draws a text with line numbers from `startLine` (the pattern is `EditDiff`'s numbered lines, `R/transcript/view/cells/EditDetail.tsx`; no CodeMirror, which the viewer store entangles) and an image scaled to the card, from the bytes the host supplied only (`SheetBody`'s base64 as a `data:` URL), never from a URL it was given: C4's page allows no other image source (the composite's writer, 2026-11-24). `changed === true` reads "Changed since asked"; null (a reader not on the session's machine) says nothing.
- **Markdown.** `context` and an option's `preview` are drawn by `SheetMarkdown({ markdown, references, host, onReference })` (`R/sheet/SheetMarkdown.tsx`), which is the transcript's `Markdown` with `live: false` inside a `TranscriptActionsProvider` of the sheet's own. `Markdown` already draws no raw HTML and no remote image; its links, though, are the transcript's (`mailto:`, path, image and artifact links pass its gates, `R/transcript/view/markdown/sanitize.ts`), and the sheet's policy is narrower (composite §8.2's third rule; the writer's ruling of 2026-11-24): an `http` or `https` link goes to `host.openLink`; a path link that names one of the question's own references (its `path` or its `abs`) opens that reference's viewer in the card (`onReference`); every other link does nothing. That policy is one exported predicate in `SheetMarkdown.tsx`, `sheetLinkAction(url, references): { kind: 'open'; url } | { kind: 'reference'; reference } | null`, which C4's page reuses to draw a refused link as text (the composite's writer, 2026-11-24). The provider names every action a link can reach, so none falls through to the app's host actions, and the transcript's Markdown is not changed. A link the policy refuses is drawn as the transcript draws a link but carries no navigable destination, so no click of any kind (a middle click, a context menu, a drag) follows it: a handler that stops the primary click is not enough in a browser (M3's review, 2026-11-24). That takes the smallest seam in `Markdown`, an optional `link` component the transcript does not pass (built: the sheet draws every link from one `sheetLinkAction` call, so a path is decoded once, and a refused link is an `<a>` with no `href`), so the transcript's links are unchanged. A path is normalized once, by the same code for `sheetLinkAction` and for the drawn link.
- **Images.** The text field takes a pasted image only where `host.saveImage` exists, downscaled by the consumer's host, at most eight an answer. A paste that completes after its card was rewritten, edited, sent or unmounted merges into the draft as it is now, without confirming it at another revision; a failed paste is said on the card.
- **What Send may take.** A draft whose answer the card no longer shows (another surface queued an answer on the question, or the queued answer its `replaces` names is no longer the one standing) is kept visible as a conflict and is out of Send's count until the person chooses ("Keep mine" makes it edit the queued answer that stands now, or a plain answer when none does; "Discard mine" drops it); a text past the inbox line's 20,000 code points is kept editable, marked on its card, and out of the count. A Send carries each act's question id, a retract's too, so every note can name its question.
- **Shared memory.** The memory is the consumer's and may be shown by two mounts at once (the side sheet and an Overview card): an act in flight is settled against the memory as it is when the door answers, by its exact attempt (built: each Send carries an attempt name, one registry a window, `R/sheet/attempts.ts`, tracks the attempts still in the air, and the answer lands through the `onMemory` update captured when Send was pressed; the act a Send records holds the very draft its lines were built from; "Send again" is offered only for an attempt the window no longer knows, after a reload; a released Send's first act stays as a closable "Not sent: <reason>" note, and a card waits only for acts still sending; an image pasted while its draft is being sent waits in an image-only draft and merges back if the Send is released or comes back stale), so a late answer neither clears a newer hold nor puts back an older one, and every change of the memory is a function of the memory as it is when applied (`onMemory`'s update), so two mounts, or a settlement and a paste, never overwrite each other. A late completion carries the session and question it began on, and lands in that session's memory whether or not a mount still shows it, never in another session's. An attempt is settled once, while it is still sending; a host that throws before returning is a failed Send. One Send at a time is decided by the shared memory, not by a mount's props: a press prepares its call and asks the memory for the slot (a new Send only when no hold stands, Send again only over the hold it was drawn for), and the host is called once the memory holds that attempt, so two presses before a commit make one call. A stale verdict restores the sent draft only when no draft with an answer stands; a first observed `retracted` retires the very draft that act sent before the act is forgotten. A focus request waits until its question is in the model, and is then used once.
- **The sheet.** Cards oldest first (the model's order), then the accepted outcomes, then one line for what is hidden by a queued dismissal with its take back. One Send, labelled with the count of questions it sends (`sendOf`'s `ids`: "Send 2 answers", "Send 1 answer", and a disabled "Send" with none): a draft not confirmed, and a draft past the fifty inbox lines of one Send, are not in the count and stay drafts. It calls `host.send` once with `sendOf`'s lines, holds them in `memory.sending`, and records the acts. A Send that fails (`busy`, `failed`), or that got no answer, keeps every draft and offers the same Send again: the held lines, under the same keys. A Send the door answered `refused`, `no-sheet` or `unavailable` appended nothing and would be refused again: its hold is released, every draft kept, and the door's reason stands as a note, so the person can edit and send anew. A draft stays on its card after the door has answered until the model shows its act, and is out of Send's count meanwhile. Dismiss and Take back are each sent at once as one call, held and resent as a Send is. `SessionSheet` runs `reconcile` itself, so a consumer keeps the memory and need not call it. The hidden line reads `q5 Notices → Dismissed` with its header when the surface's memory holds it (it drew the card before the dismissal was queued, so it normally does), and `q5 → Dismissed` when it does not: the model's `hidden` carries an id and a key only (the composite's writer, 2026-11-24; the set's next version may carry the header). The notes of S15 stand at the head.
- **The overview.** Sessions with something on their sheet, the stopped ones (`live === false`) grouped apart, each with its counts and its oldest question's age; a session whose `live` is null is listed with the running ones.

### §H · The side sheet, the waiting card, the items (M4)

`R/tools/sheet/`:

    export const SHEET_TOOL_ID = 'sheet'
    export interface SheetToolParams { at?: string }                       // a question's id
    export const sheetTool: PanelTool<SheetToolState, SheetToolParams>     // one per session, not pinnable, offered from "+"
    export function appSheetHost(appSessionId: AppSessionId, client: MawsBridge = ipc): SheetHost      // send → sheet.put, body → sheet.body, saveImage → downscaleImage then sheet.upload, openFile → the app's file opener; the session, because a reference's file opens on the session's machine and a loopback link in its in-app browser (M4)

`sheetTool` is registered in `R/App.tsx` where `askSheetTool` is. It renders `SessionSheet` for the shown session's record over the store's model and memory, watches the session while visible, and shows an empty state when the session has no record. `open(state, params)` moves the focus to `params.at`. Its tab is titled "Sheet" with the count of open questions beside it ("The look"): as built (M4), the strip's existing title suffix ("Sheet · 3"), kept live while the tab exists; the app's part wins over the frame's "Sheet 3". A door known not to run draws frame 6's words (`SHEET_WORDS.unavailable`), not the door's own reason. `openSheet` opens nothing for another machine's session (no window reads that sheet until C6), and that machine's sheet items in the Overview and the channel keep today's per-item cards. The notifier counts the calls of sheet items open when it starts as already told, so a launch makes no burst; a remote sheet item is told once per call too, keyed by machine. The Overview's card mounts the sheet where its request (its oldest tier-1 item) would be a sheet question, live controls or not, so a stopped session's card shows it (frame 5). The Overview's card and the channel's waiting card keep a session's compact sheet, once nothing of it waits, while that sheet holds what the person did there (`selectSheetHeld`: a queued answer, a queued dismissal, an act of the memory sending, carrying a note, or accepted and not yet delivered), so the outcome of a Send stays where it was sent; a queued answer counts as waiting nowhere. The channel's "Waiting on you" section says what waits on the person, so there a sheet with nothing waiting is held only while it holds an act still sending or one carrying a note (a Send that failed or was refused); a queued answer, a queued dismissal and an accepted outcome do not hold the channel's card, which leaves as an answered permission card does, Take back staying in the side sheet; the section, its heading and its count follow the waiting items and those sheets. The difference is one argument of `selectSheetHeld` (the composite's writer, 2026-11-27). A compact card starts open only over an answer this memory queued, and every other card is folded until chosen. The side sheet's focus request is used once for the tab's lifetime: a body the host draws again while the tab stays in view takes it again, and it is used once its body unmounts with the tab out of view, the column showing another session, or the tab closed. A notice's Open session resolves its item when pressed, so a notice that came before the window's list still opens the sheet at its question. (M4's task review, two fix rounds.)

`TranscriptActions` (`R/transcript/view/context.tsx`) gains `openSheet(appSessionId: AppSessionId, questionId: string | null): void`, a no-op in `NO_ACTIONS`; the app's implementation is `panelHost.addTool(SHEET_TOOL_ID, { appSessionId, params: { at: questionId ?? undefined }, activate: true })`. **Nothing else adds or activates this tool.** That is O-17, kept: a test asserts that a record appearing, a question added and a `sheet.changed` each leave the side column as it was.

`src/shared/attention/sheet-item.ts`:

    export const SHEET_ITEM_PREFIX = 'sheet:'
    export const isSheetItem = (id: string): boolean                      // of a bare id and of an address alike
    export const sheetItemId = (session: string, questionId: string): AttentionId
    export function questionOfItem(id: string): { session: string; questionId: string } | null
    export function sheetItemsOf(appSessionId: AppSessionId, model: SheetModel): AttentionItem[]

An attention id is lifted to an address, `<machine>/<bare>`, on its way to a window, on this machine too (`src/shared/machine/address.ts`), so the spine sees `sheet:<session>:<question>` and a window `<machine>/sheet:<session>:<question>`. `isSheetItem` and `questionOfItem` read both, through `isAddress` and `bareOf`; a predicate that only tests how the string starts, as `isLaneAItem` does, would hold on the spine and fail in `placeWaiting` and the waiting card.

One item per listed question without a queued answer: kind `async_input`; `request: { requestId: <question id>, toolUseId: <the question's callId>, taskId: null, agentId: <the asker's, or null> }`; `summary` the question's `questionSentence`; `createdAt` and `stateChangedAt` the question's `askedAt`; state `pending`; no expiry.

`src/services/attention/service.ts` gains a fifth list, `setSheetItems(appSessionId: AppSessionId, items: AttentionItem[]): void`, a live projection like the lane A list: never restored from the store, re-projected at start from the records, and with no request view (`attention.request` answers none for a sheet item). `src/services/sheet/attention.ts` feeds it from the service's `onChange` for every record whose session the index holds, and clears an app session's list when its record goes or no longer joins it (`onChange`'s `was`).

The placement's rules, in `src/shared/attention/waiting.ts` and `kinds.ts`: `waitingRequests` lists sheet items like any other; `waitingForms`, `waitingByCall` and `placeWaiting` skip an item for which `isSheetItem` holds. So the "Waiting for you" card lists them and its presence rule sees them; no row is marked waiting by one, no form and no end card is drawn for one, and the jump button, which reads the placed list, is not raised by one (the look's L4, the owner's answer).

What draws an item and must tell a sheet item apart:

- `WaitingCard` (`R/request-card/WaitingCard.tsx`): a sheet item's line is its mark, its summary, "from <agent>" when a subagent asked (the asker's name from the model where the rows do not know it) and its age; where the card is too narrow for the four, "from <agent>" gives way before the summary does. Choosing it calls `openSheet` with the question's id, where every other line calls `showWaiting`.
- Needs you (`needsYou` in `R/attention/derive.ts`, drawn by `R/sidebar/NeedsYou.tsx`): L5's tone. A row is calm when every item of it that waits is a sheet item, whether its session runs or is stopped (the composite's writer, 2026-11-24: the owner's standing ruling is that no sheet question marks a session as stopped on the human, so the calm tone is not for stopped sessions alone); its mark is then drawn in the `info` token where the list's rows use `warning`. `needsYou` decides and the row draws, so the rule is in one place. Nothing else of the row, of its count or of the dock badge changes: a sheet item is counted as every `async_input` item is.
- `showWaiting` (`R/request-card/show-waiting.ts`), which the notice's "Open session" button and a Needs you row reach: for a sheet item it shows the session and then calls `openSheet`. That is a person's act.
- The notifier (`src/main/attention/notifier.ts`): S11. A sheet item is announced in-app only, where `isLaneAItem` already returns; and beside `seen` it keeps the calls announced, by session and `toolUseId`.
- The Overview's session card (`R/overview/SessionCard.tsx`) and the project channel's waiting cards (`R/channel/Waiting.tsx`): where they would mount a request card for an item, a session's sheet items together mount one `SessionSheet` at `density: 'compact'`, once a session, over the same store and host.
- The sidebar's hover card: a sheet item has no request to preview; it shows the summary and opens the session, as it does today for a request it cannot answer in place.

Sheet items travel wherever a session's lane A items travel today. In a window on another machine they read "Question waiting" and open the session, with nothing to answer in until C6; that is what an asynchronous question whose Dismiss is disabled is there today.

### §I · The row (M5)

`R/transcript/model/rows.ts` gains, with its schema in `model/schema.ts`:

    | { kind: 'sheet'; toolUseId: ToolUseId; state: 'running' | 'done' | 'nothing' | 'unknown' | 'error';
        lines: SheetRowLine[]; withdrew: string[]; notDone: string | null; error: string | null }
    SheetRowLine = { id: string | null; entry: number; header: string | null; sentence: string;
                     place: 'here' | 'revised_below' | 'refused';
                     outcome: { how: 'answered'; receipt: string } | { how: 'dismissed' } | { how: 'withdrawn' } | null }

It is derived in `model/derive.ts` where a call of presentation `question` is resolved: a call for which `isSheetCall(input)` holds builds this row from `callEntries`, and every other call builds the `question` row it builds today. A call the engine denied whole has an error result and no first line: `state: 'error'`, its entries drawn without ids.

What the row's model holds is what the transcript alone shows (S8). The reducer keeps, per transcript, which call's row holds each question's line now and each question's outcome, and bumps the owning turn as `joinAnswers` does:

1. A question's line is `here` in exactly one row, the last call of the transcript that added or revised it. In every earlier row its line is `revised_below`.
2. A question named in any call's `withdrew` has outcome `withdrawn`.
3. A question in a delivery's `answered` has outcome `answered`, its receipt `receiptOf` of the labels the block's `picks` name among the options of the entry that set the answered revision in this transcript, and of the block's `text`. A question in a delivery's `dismissed` has outcome `dismissed`.

A delivery is read from an arrival. `src/shared/engine/arrival.ts` reads a sheet's envelope on the three carriers of a main conversation, the ones it reads today's asynchronous answer on (a prompt the sminos plugin submitted, a hook's added context on a tool's result, the same on a prompt), told by the envelope's head `[sheet v1] ` and its block, and never from text a person typed. It travels on `user.message.arrival` as an entry of class `sheet` holding the parsed deliveries, read by `sheetDeliveriesOf(arrival)` under a strict schema of its own, the way `commandOf` reads class `command` (`src/shared/engine/arrival-schema.ts`): not a member of the carried union, so the wire does not break and a build that knows no such class keeps the event.

An entry of an unknown class is accepted on the wire; nothing writes it there by itself. Both producers build a carried message from a fixed list of classes and drop the rest: `carried` in `src/engine-host/fs/backfill.ts` (a file's rows, a hook's attachment among them) and the live normalizer's `carried(…, carriedOf(claimed))` in `src/engine-host/normalizer.ts`. Each already appends the `command` class beside that list (`commandEntry(commandFactsOf(arrivals))`); the sheet's entry is appended the same way, by `sheetEntry(sheetFactsOf(arrivals))`, in both. The carrier itself draws as today's answer does: no bubble holding the envelope, and the notice row of the turn it reached, worded from the block's ids.

**What is not read** (S8). A running subagent gets its answer as a message of its coordinator, the envelope under one opening line (the set's `examples/subagent/envelope.txt`); that carrier, in the subagent's own history, is not read in this child, and the message draws there as any coordinator's message does. An ended subagent's answer, and a parent's withdrawal of a subagent's question, are in the parent's history. So a subagent's row reads its outcomes from the record while the record lives, and shows its questions without receipts once it is gone.

`R/transcript/view/rows/SheetRow.tsx` draws the row within #852's line model: the quiet line's classes and 12 px glyph slot, what stands under a line indented 19 px, no box. Over the row's own model it lays the store's (`selectSheetSession`, `selectSheetModel`, watching the session while a sheet row is mounted):

| the question, in the store's model | the row line |
|---|---|
| listed, no queued answer | the id, the header, the question's sentence (`questionSentence`), and Open (only where the host's `openSheet` is not the no-op) |
| listed, with a queued answer | its receipt and "queued", and Open |
| hidden by a queued dismissal | "Dismissed" and "queued" |
| in `pending` | its receipt |
| in `closed` | its receipt, "Dismissed" or "Withdrawn", by `how` |
| not in the model, or no model | the row's own `outcome`; with none, the id, the header and the question's sentence, with no Open |

The row's own `outcome` wins where it exists; the model fills only what the transcript does not hold yet. The model's entry for an id is laid over a row line only when that entry names this row's call, wherever the record gives a call id (an open question's `callId`, and a closed or pending entry's where the model carries one); where the record gives no call for an entry, the table stands. A fork's record starts empty and its ids above the floor of the conversation it holds, so a parent's copied rows name ids it does not hold; but a record whose floor could not be read restarts at q1, and then a copied row's q1 must not take the fork's q1 (the composite's writer, 2026-11-27).

The head line says what the call did (L1): "Asked 3 questions", "Asked a question", "Revised q5", "Asked a question, revised q5", "Withdrew q6"; a call that asked and withdrew names both the same way. Its chevron folds the lines under it, which stand open at rest; a call that only withdrew has no lines and no chevron. Past eight lines the rest stand behind "N more" (L2). A refused entry's line shows its entry's number where an id would stand, its header and sentence, and "Not asked"; the call's `notDone` stands under the lines as a note.

The row's opened body may be given through `GroupRow`'s `renderBody` (#852; the wave's answer of 2026-11-24), with a test of its own here. As built (M5): master's `GroupRow` has no `renderBody`, so `SheetRow` draws with #852's classes directly (the head a `button.transcript-run-line` with the shared `Chevron`, the lines in `DisclosureBody.transcript-run-body`, its 19 px), and `GroupRow` is unchanged. `SheetRowLine` carries `revises: boolean` (the entry names an `id`), since the head line must tell a revise from an add and a revised question's line is `here` in the revising row. The fold and "N more" are the transcript's per-transcript disclosures, so they survive a remount; L2's eight is `SHEET_ROW_SHOWN`. The record's overlay applies only to a call whose outcome is known and to a line that is `here` with no outcome of its own; a pending dismissal reads "Dismissed". A refused call's head draws the call line's error mark and its refusal as a small note; a running call the running ring. The head line's other forms: "Nothing done" (form `nothing`), "Changing the sheet" (no result yet), "Outcome not known yet" (form `unknown`) and "Did not change the sheet" (a call the engine denied), with ask entries or withdrawals alike; ids are claimed only for a known outcome. A hook's context and a plugin's prompt read their sheet envelopes first, and today's answer reader reads only the text outside them. A turn that holds only the sheet's carrier is a turn with an arrival (`headRole`). An answer stays answered whatever its preview reads. The carrier's notice row reads, in today's answer notice's words, "answered: q7, q8; dismissed q9". The live wire carries no hook-context frame (only a file's attachment row does), so the live route reads the plugin's prompt and the file route all three carriers. The synthetic transcripts are under `test/fixtures/sheet/transcripts/`, and one snapshot (`test/snapshots/transcript/sheet/delivered.md`) is what every carrier's drawing must match. Wherever the transcript's model treats the `question` kind specially and this section does not say otherwise, a `sheet` row is treated the same: it survives a folded turn (`isPersistentRow`), counts as work, and has its case in `model/serialize.ts`. It is not a mod site: the engine has no component of its own for this plugin tool's new input, so no adapter could hand a mod the shape it expects.

**Strings the composite fixes** (§8.1, §8): `q7 Auth method → OAuth`; "Dismissed"; "Withdrawn"; "Revised below"; "Open"; "Updated"; "from <agent>"; "Question waiting"; "Asked 3 questions"; Send's label carrying the count; "changed since asked".

**Strings as drawn or as the writer settled them** (the look's L6), each in `R/sheet/copy.ts` or `R/transcript/model/copy.ts`: the head line's other forms ("Asked a question", "Revised q5", "Asked a question, revised q5", "Withdrew q6"); "N more"; "Not asked"; "queued"; "Send 2 answers", "Send 1 answer", a disabled "Send"; the text field's placeholder ("Type your own answer"); "Recommended"; "Dismiss"; "Changed since asked"; the queued card ("Queued. The session is stopped and gets this when it resumes.", "Take back", "Edit"); the queued dismissal's line (`q5 Notices → Dismissed`, "queued", "Take back"); the accepted card ("Accepted. Not delivered yet."); the stale card ("The question changed before your answer arrived. Your draft is kept."); the notes ("q7 was already answered", "q7 was already dismissed", "q7 was withdrawn", "q7's answer was already delivered and cannot be taken back"); the unavailable Send ("Answers cannot be sent from here: sminos was not found on this Mac."); a record this build cannot read ("This sheet was written by a newer sminos."); the empty side sheet ("No open questions"); the tab ("Sheet").

**Strings no frame shows**, this child's own until the owner sees the built look (the composite's writer, 2026-11-24: the carried draft's card is seen in M6's built look and does not hold M3): a carried draft ("You wrote this before the question changed.", "Keep my answer"); a queued answer's sentence while the session is not known to be stopped ("Queued. The session has not picked it up yet.", the composite's writer, 2026-11-27, provisional: the card says frame 2's "Queued. The session is stopped and gets this when it resumes." only when the session's `live` is false, read from the summary the store holds, never by widening the wire), its carried picks drawn with a dashed edge and a muted label; Send's rest ("12 more after this"); M3's own (2026-11-24): "q7 is no longer open", "Not sent.", "Send again", "No longer available", the image chips' words and the overview's words; from its fix wave "Not sent: <reason>", "Keep mine", "Discard mine"; all in `R/sheet/copy.ts`; M5's own (2026-11-27), in `R/transcript/model/copy.ts`: "Nothing done", "Changing the sheet" (a call with no result yet), "Outcome not known yet" (X7's first line without its full stop), "Did not change the sheet" (a call refused whole), the list forms "Revised q5, q6" and "Withdrew q6, q7", Open's accessible name "Open q7", and the carrier's notice in today's answer notice's words ("answered: q7, q8; dismissed q9").

## The gates, by clause

The composite's two gates for this child, cut into the clauses a milestone can prove.

| clause | what it says (the composite's C3 section) | proven in |
|---|---|---|
| G1.a | the components render every fixture directory of the set at its pinned revision | M3 |
| G1.b | a card for each state a surface can show: open, updated since seen, queued, accepted, refused as stale | M3 |
| G1.c | the reader lists every session directory under a given `$SMINOS_HOME` | M1 |
| G1.d | a stored call that partly succeeded draws its row's lines with the right ids and no sheet directory | M1 (the ids, at the model), M5 (drawn) |
| G2.a | nothing opens by itself | M4 (stand-in), M6 (live) |
| G2.b | the row's lines; Open shows the side sheet at the question; the receipt | M5 (stand-in), M6 (live) |
| G2.c | an answer sent in the app reaches the agent | M6 |
| G2.d | three answers of one Send arrive together | M4 (one call of the door, one batch), M6 (the agent quotes them in one message) |
| G2.e | a stopped session's questions show | M4 (stand-in), M6 (live) |
| G2.f | a withdrawn question's card disappears and its row reads "Withdrawn" (Acceptance 16) | M4 (the card), M5 (the row), M6 (live) |
| G2.g | of two windows answering the same question, the second reads that it was already answered (Acceptance 19) | M4 (the stand-in door, both Sends held at its barrier), M6 (live: the same barrier in front of the real command) |

## Plan of Work

Six milestones in two landings. M1 and M2 draw nothing and wait for no look. M3 draws on fixtures. M4 puts the sheet in the app without touching a transcript row, so it does not wait for #852; M5 is the only milestone that does. M6 is the live gate and the last milestone.

### M1 — The pin and the model

**At its end.** The set is in the tree at its merged revision with its provenance, and a test fails if one byte of it moves. MAWS computes, for every state the set holds, the same model sminos's own `show` prints. A stored call's entries and their ids, and a delivery's block, are read by pure functions that need no record. A reader lists the session of every record under a given home.

**Touches.** `test/fixtures/sheet/` (new); `.gitattributes` and the formatter's and linter's ignore lists; `src/shared/sheet/` (new: `model.ts`, `read.ts`, `call.ts`, `delivery.ts`, `words.ts`, their tests, `pin.test.ts`); `src/services/sheet/reader.ts` and its test (new).

**Interfaces.** Exposes §A, §B and `reader.ts` of §C. Consumes the set.

**Decisions.**

- Its first act is the pin: copy the set from the merge commit of doperpowers pull request #628 (Concrete Steps), and write `PROVENANCE.md` with the three values. §B to §D were corrected to that commit before M1 was dispatched; a difference the executor still finds between the pin and these sections is reported, and the pin binds.
- Tests walk the directories of the pin; none lists the cases by name. A re-pin that adds a case is then covered without an edit, and one that removes a case fails nothing by accident.
- Each side of a fixture is a home (`<case>/before`, `<case>/after`, each holding `sheet/<session>/`), read in place: `readRecord(<side>, <case.json's session>)` is compared, as parsed JSON, with `show.before.json` or `show.after.json`; a side with no directory compares with `null`. The fixtures' referenced files exist on no machine, so `changedOf` runs for real and reads `true`.
- `grammar/result.examples.json` gives, for each stored call, `input`, `result` and `parsed`: `parseSheetResult(result)` equals `parsed`, and `callEntries` is asserted on the examples the composite names (the call that partly succeeded with an added and a revised entry and a refused one; the foreclosed call; the call whose outcome is not known).
- Each example's `envelope.txt`, and `terminal/steer.txt`, is parsed by `parseSheetDeliveries`: one block, as many keys as `answered` and `dismissed` have entries together.
- These tests use the pin's directories and temporary ones directly and never `sminosHome`, which refuses nothing here but would tie a pure test to an environment.
- The contracts a later milestone cannot change cheaply are pinned here, where they are made: a session's name (`isSheetSession`), the draft and the Send (`sendOf`), the stored call's reasons (`callEntries`), and the reader's verified pair. The last cannot be shown on files that stand still, so its two tests move the record under the reader through `RecordIo`, as sminos's own suite does (`test_a_seq_that_keeps_moving_is_read_again` in `sminos/tests/test_sheet_contract.py`).

**Does not touch.** The renderer; the wire; any process; `src/services/spine-root.ts`.

**Proves.** G1.c; G1.d at the model. Its tests also pin:

- the manifest's digest three ways (§A); a list of records that skips `surfaces`, `.staging`, lock files, a name that is no session id, a linked directory and a directory with no `state.json`; a record whose `v` is not 1 reads `unreadable`; every cut counted in code points (the `imported-legacy` case holds a 2,001-character question and a 201-character label); a torn tail read to its last newline (`torn-tail`, `torn-tail-resent`);
- the verified pair: with a `seq` that moves at every read, `readRecord` answers `busy` after eight reads of `state.json` (state, inbox, state again, four times) and returns no model; with a `seq` that moves once and then stands, at another offset, the model is the one of the pair that stood and holds nothing of the tail read first;
- a session's name: `readRecord` of `..`, of a name with a separator and of an upper-case id each read nothing and touch no path;
- the stored call's reasons: `callEntries` over the example that partly succeeded gives the refused entry and a `notDone` that names the reference and its reason, and over the foreclosed example a `notDone` that says to call again; two results alike in their first line and different in their second give different `notDone`;
- the draft and the Send: a question rewritten while its draft stands leaves the draft at its old revision, and `sendOf` neither counts nor sends it until `confirmDraft`; a draft that `replaces` a queued answer gives a `retract` of that key and then the `answer`, in that order; with forty-nine one-line drafts ahead of such an edit, `sendOf` gives forty-nine inbox lines and `left` 1, never half the pair.

**Gate.** Class 1a.

### M2 — The service: live reading, and the writer's call

**At its end.** With `mawsd` running, a record that appears, changes or goes under the sminos home is announced to every window within a second, and a window can read its model. Inbox lines a window sends are appended by the `sminos` command MAWS found, and their first states come back. A captured file's body and a pasted image make the round trip. A window's store holds the machine's summaries. Nothing is drawn.

**Touches.** `src/services/sheet/` (`service.ts`, `door.ts`, `locate.ts`, tests); `src/services/spine-root.ts`; `src/shared/ipc/schema/sheet.ts`, `names/sheet.ts`, `grades/sheet.ts`, their wiring in `schema.ts`, `names.ts`, `grades.ts`; `src/shared/ipc/wire.ts` and the pinned `wire-manifest.json`, `wire-fingerprint.json`, `routes.json`; `src/services/command-budgets.ts`; `src/endpoint/by-effect.ts` (five `NO_RULE` rows) and its test; `R/stores/sheet.ts` and the place `connectLaneA` is called; `test/support/fake-sminos-cli.mjs` and `test/support/sminos-barrier.sh` (new).

**Interfaces.** Exposes §C's service, §D, §E and §F but for the memory. Consumes M1's.

**Decisions.**

- S1 to S7. The handlers exist only where the spine runs, as lane A's do: a `mawsd` refused the spine has none, and a window's store then starts empty and stays so.
- The locator runs only when there is a record to answer (§E, "When"): never at start, at a window's connection or at `sheet.list`. A machine with no sheet executes nothing.
- The door's unit tests run the stand-in door through the same `execFile` path the real one takes; a test never reaches an installed sminos.
- The real door is checked by hand in this milestone (Concrete Steps), against a doperpowers checkout at the pin's merge commit, because the gate's runners have no sminos.

**Does not touch.** Any component; the attention list; the transcript; `apps/desk-web`.

**Proves.** No clause alone; it is what M4 and C4 stand on. Its tests pin:

- the door: each exit mapped to its `why`, with exit 1, a timeout and unreadable output as `failed`; a call of more than fifty inbox lines, or of a line `lineError` refuses, answered `refused` with no process started; `by` stamped `maws` whatever the window sent;
- the locator, with stub executables that record that they ran (`FAKE_SMINOS_RAN`): a named executable is taken; an enabled user-scope installation is taken; a disabled one is not, and its stub did not run; two installations of project scope for two different projects are not, and neither stub ran; a `sminos` on the `PATH` alone is not; under a test runner only the named one is read; the probe's three outcomes, and a proof made again when the path's modification time moves or a spawn fails;
- when it runs: a window's connection and `sheet.list`, with an enabled installation present and no record, start no process; the first `sheet.read` of a record with an open question does; the same holds called on the service directly, as C4's page calls it through `SpineRoot.sheet`;
- a session's name and confinement, at the service and at the wire: a `read`, a `body` and an `upload` naming `..`, a path, or a session whose record directory is a link to a second scratch directory are refused, and that second directory holds what it held; an `upload` into a record whose `uploads/` is a link writes nothing; a `body` that is a link or a special file is `gone`; a body asked by a hash no listed question names is `gone`; an upload is written exclusively at mode 0600 and refused without a record; an upload whose bytes are not the type it names is refused; an upload the model does not name is served back by `body`, and a file under `uploads/` whose bytes are not its name's raster type is `gone`;
- the grades: each of the five names, asked of the endpoint by an owner, by its command path and by its action path, is refused (`no-rule`, and `sheet.list` `no-target`, §D), and the by-effect table's own test finds a row for each; the namespace's pinned routes send a window's call to the machine host. A write through the real bridge, a window's Send to the stand-in door, is M4's e2e;
- following records: a record that appears, an inbox that grows, a record that goes, each announced once; a `busy` read leaves the last verified model in place, announces nothing and is read again;
- following the index: a record found before the index holds its session is joined when the index gains it; a session whose holder exits, with every file of its record byte for byte the same, is announced with `live: false`; a session removed from the index leaves its summary with `appSessionId: null`, and `onChange` hands the listener what it was;
- the store: a record that changes while `sheet.list` is out is in the store once the list lands; of two reads of one session that finish in the other order, the later read's model stands.

**Gate.** Class 1a; `e2e:lane-a` and `e2e:supervisor-daemon`, unchanged and green (the spine gained a part and the wire moved).

### M3 — The components (the composite's X5), on fixtures

**At its end.** The harness has a page (`#sheet`) that draws any state of the pin as a session's sheet, each card state of frame 2, and the overview, over a host that records what it is sent. The same components render inside desk-web's test project. A consumer can build on `R/sheet/` and `src/shared/sheet/` and nothing else.

**Touches.** `R/sheet/` (new: the five components, `host.ts`, `memory.ts`, `copy.ts`, `index.ts`, a fixture host under `test-support/`, tests); `eslint.config.js` (the boundary's block); `R/harness/` (the route and its reading of the pin's `show.*.json`); `apps/desk-web/src/sheet-import.test.tsx` (new).

**Interfaces.** Exposes §G. Consumes §B.

**Decisions.**

- Built to the drawn example and the settlements under "The look"; the executor has the frames. Where a frame and this document's words differ on how a thing sits on the page, the frame holds.
- The components hold no state of the sheet: everything that must survive a tab's unmount is in the memory a consumer keeps, and `reconcile` is where the memory meets a new model. A component's own state is what dies with it rightly: which reference is open, which option has the pointer.
- The tests render under both renderer projects of `vitest.config.ts` (`renderer` and `renderer-compiled`, the React Compiler), as every component's do.

**Does not touch.** A store, the wire, the side column, the transcript, the attention list. Of desk-web, only the one new test: the `@source` line in `apps/desk-web/src/styles/app.css` is the consumer's, added by the child that first mounts a component there.

**Proves.** G1.a: a test walks every fixture directory of the pin and renders `SessionSheet` from each side that has a record, asserting one card per listed question in the model's order, one accepted card per pending outcome, and the hidden line; and renders `SheetOverview` from the summaries of every record. G1.b, each state from the pin and a memory: open (`answer-applied`, before); updated since seen (`answer-stale`'s model with a memory that saw revision 1 and holds a draft: the card reads "Updated" and the draft's text stands); queued (`stopped-queue`, before); accepted (`answer-applied`, after); refused as stale (`answer-stale`, after, with a memory whose act carries the fixture's key: the card is marked and the draft is back). Its tests also pin: Send's label is the count of questions with a draft answer; one Send calls `host.send` once with inbox lines for those questions only, each at the revision shown; a Send that fails keeps every draft and sends again under the same keys; `reconcile` over `closed-withdrawn` drops the withdrawn question's draft; a reference's body is asked for when it is opened and not before; the text field takes no image without `host.saveImage`; a note for a second answer (`two-surfaces`, after, with the memory's act carrying the second key) reads that the question was already answered; a question rewritten while the person edits another card reads "Updated" with its draft shown as carried, Send's count leaves it out and the Send sends nothing for it, and keeping it puts it back in the count at the new revision; editing a queued answer (`stopped-queue`, before) and sending gives the host a `retract` of the queued key and then the answer, in one call; with more confirmed drafts than fifty inbox lines hold, the label is the count sent, the host gets fifty lines or fewer in one call, and the rest stay drafts; a Send whose answer never came is sent again as the same inbox lines. `sheetLinkAction` answers each of the policy's cases; a card's root carries `data-sheet-question` with its question's id, full and compact; `SheetOverview` with `hrefOf` draws each row as an anchor with that href, and without it as before; an image reference draws from the host's bytes as a `data:` URL. In desk-web's project, with an injected host: an `https` link reaches `openLink`; a path link naming one of the question's references opens that reference; a path link naming another file, a `mailto:` link and an artifact link reach nothing.

**Gate.** Class 1a; `e2e:desk-web`, unchanged and green.

### M4 — The side sheet, the waiting card, the attention items

**At its end.** In the app, a terminal session that has a record reads "Question waiting" on its row, its tab and Needs you. Its "Waiting for you" card has one line per open question, "from <agent>" on a subagent's. Choosing a line shows the session's sheet in the side column at that question; nothing showed it before. The person answers and sends; the inbox lines go through the door as one call; what was sent reads queued, accepted or refused from the record. The Overview's card and the project channel's waiting card draw the same sheet in place. A call's questions make one notice.

**Touches.** `R/tools/sheet/` (new); `R/App.tsx`; `R/transcript/view/context.tsx` and the place the app's actions are composed; `R/stores/sheet.ts` (the memory); `src/shared/attention/sheet-item.ts` (new), `waiting.ts`, `kinds.ts`; `src/services/attention/service.ts`; `src/services/sheet/attention.ts` (new) and `src/services/spine-root.ts`; `R/request-card/WaitingCard.tsx`, `show-waiting.ts`; `R/attention/derive.ts` and `R/sidebar/NeedsYou.tsx` (the calm row); `src/main/attention/notifier.ts`; `R/overview/SessionCard.tsx`; `R/channel/Waiting.tsx`; `e2e/support/launch.ts`, `e2e/support/lane-a.ts`, `e2e/lane-a.spec.ts`; `docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md`; `docs/charter.md`.

**Interfaces.** Exposes §H. Consumes §C to §G.

**Decisions.**

- S10 to S16, and the look's L4 and L5 with the calm tone of a stopped session's Needs you row (§H), which is new and made here from the tokens.
- An e2e case seeds a record as §E says (a fixture's `before`, its inbox cut to the recorded offset) in the launch's sminos home, with the terminal session of `e2e/support/lane-a.ts` given the fixture's session id, and names the stand-in door through the launch's environment. A change of the record is the stand-in's staged outcome.
- The two-window case starts from `two-surfaces` seeded so, on which the question is open and nothing is queued. Both windows answer and press Send while the stand-in holds each at its barrier; the test sees both held, then releases them. The staged outcome gives the first inbox line appended the fixture's first key's place and the second the second's, so one window's act reads accepted and the other's `closed`, whichever window's process the system ran first.
- A sheet item never makes a session read as waiting on the person in its digest: the digest counts the lane A list's stopping requests, which a sheet item is not in. A test pins it, since "calm state only" is the owner's ruling.
- **The record of what changed**, written in this milestone's landing as U1's "Rulings reversed" requires (each amended where it stands, dated). In `U1-requests.md`:
  - under l4-approvals-08: "Amended (the question sheet, §8.1 of `docs/doperpowers/specs/2026-11-23-question-sheet-design.md`; the owner's ruling of 2026-11-23): a question asked through the sheet form of the sminos tool has no form in its call's row and no card at the transcript's end. Its row shows one line per question with Open; it is answered in the side sheet, which the person opens; the waiting-requests card lists it, and its line opens the sheet at it. Every other request keeps this section's placement."
  - under O-17: "Amended (the same ruling): the side column gains the session's question sheet. It is shown only by the person: from a row's line, from a line of the waiting-requests card, from a notice's button, from the side column's own menu. It never opens, activates or closes by itself."
  - under O-22: "Amended (the same ruling): each open question of a sheet is an `async_input` item of its own, in this section's kind, words and tone. A notice fires once per call, in-app only for a terminal session."
  - M5 adds, under O-21: "Amended (the same ruling): a sheet question's receipt is its own line (`q7 Auth method → OAuth`, 'Dismissed', 'Withdrawn'), drawn from the transcript and, for what the transcript does not hold yet, from the sheet's record; a revised question's line stands in the row of the revising call and the earlier row reads 'Revised below'."
  - In the charter's §19, one dated entry: the placement its §13 X4 states, as U1b amended it, is amended again for a sheet question by the composite's §8.1, in the first sentence above.

**Does not touch.** The transcript's rows: until M5 a sheet call draws as master draws it, and M4 does not land alone. `ask-sheet`, MAWS's `ask`, the engine's question and today's sminos form. Lane A's driver and its bridge. A MAWS-run session's launch (C5). The endpoint's grades (C6).

**Proves.** G2.a, G2.d, G2.e, the card of G2.f, G2.g, each against the stand-in door, in `e2e:lane-a`: a record that appears and a question that is added leave the side column as it was; a card line shows the sheet at its question with the keyboard on that card; three drafts and one Send, pressed in a real window, reach the door through the renderer's client, main's router and `mawsd`'s front as one call whose three inbox lines share a batch; a session with no live process lists its questions, and an answer given reads queued and is taken back; a question withdrawn from the seeded record loses its card (as built: no fixture of the pin has a question open on one side and withdrawn on the other, so the case rewrites the seeded `state.json` in the scratch home, in the record's own shapes, to add a question and then to withdraw it, and a unit test reads both rewrites back with the service's reader; fixtures are never edited); two windows whose Sends are both held at the barrier end, once released, with one accepted and one note that the question was already answered. Unit tests pin: the three placing functions skip a sheet item and `waitingRequests` keeps it, for a bare id and for the address a window holds, through `placeWaiting` and the waiting card's own choice of what a line opens; the notifier announces a call of eight once, a revise never, and a sheet item never to the system; the sheet list is not restored from the attention store; the Overview's card mounts one sheet a session; a Needs you row is calm for a stopped session whose waiting items are all sheet items, and so is a running session's whose waiting items are all sheet items (§H; the composite's §8.1), and a row keeps today's tone when any other item waits; with a prompt and a sheet question both waiting the jump pill is raised by the prompt alone, and with only sheet questions it is the plain arrow.

**Gate.** Class 1a; `e2e:lane-a` with the new cases; `e2e:c7` (which runs `e2e/requests.spec.ts`) and `e2e:transcript`, unchanged and green; `e2e:panel` green with one edit, since the side column's menu offers the Sheet (S12) and `e2e/panel.spec.ts` pins that menu's list exactly; `e2e:desk-web`, unchanged and green.

### M5 — The row's lines and receipts

**At its end.** A sheet call's row is a quiet line with one line per question: its id, its header, its first sentence, and Open, which shows the side sheet at that question. After the outcome the line is the receipt. A question that was revised stands in the revising call's row and its earlier row reads "Revised below". All of it reads the same from a transcript with no record beside it, and the envelope that delivered an answer draws no bubble.

**Blocked by** board ticket #852 on master, beside M4: the row is drawn in that ticket's line model, and the two change the same files. M5 starts from a master that holds it.

**Touches.** `src/shared/engine/arrival.ts`, `arrival-schema.ts`; `src/engine-host/fs/backfill.ts` and `src/engine-host/normalizer.ts` (the entry's two producers); `R/transcript/model/` (`rows.ts`, `schema.ts`, `derive.ts`, `reduce.ts`, `serialize.ts`, `copy.ts`, `keys.ts`); `R/transcript/view/rows/Row.tsx` and `SheetRow.tsx` (new); `R/transcript/view/transcript.css`; new files under `test/snapshots/transcript/` and the synthetic transcripts they are made from; `R/harness/` (a sheet session among its fixtures); `e2e/lane-a.spec.ts`, `e2e/transcript.spec.ts`; `U1-requests.md` (O-21's sentence, above).

**Interfaces.** Exposes §I. Consumes §B's `call.ts`, `delivery.ts` and `words.ts`, §F and §H's `openSheet`.

**Decisions.**

- S8 and S9, and the look's L1 and L2 as §I words the head line and the fold.
- The synthetic transcripts are made from the pin's stored calls (`grammar/result.examples.json` gives each call's input and result) and its envelopes, on the carriers C0 recorded (`spikes/protocol-probe/fixtures/qsheet/`, the rows of P5's block): the repository's rule is that a wire claim is checked against a fixture, and those are the fixtures that show how a hook's context and a plugin's prompt are stored. M6 adds one transcript recorded from a real session, scrubbed as `test/fixtures/lane-a/README.md` describes.
- A delivery is proven from the raw rows to the drawn row, not from a hand-built event: the recorded carrier rows go through the file reader (`backfill.ts`) and, as frames, through the live normalizer, then through the reducer and the derivation to the row. A test that starts at a `SessionEvent` it built itself would pass with both producers still dropping the entry.
- No existing snapshot moves: a row of today's form is built by the same code as before, and `R/transcript/view/rows/question-receipt.test.tsx` passes unedited.
- Where the transcript and the record disagree about an outcome, the transcript's stands (§I's table): it is what the model was told.

**Does not touch.** How any other row is drawn; #852's own rules; `apps/desk-web`'s sources (it bundles the row and draws it with no Open, since its actions hold no `openSheet`).

**Proves.** G1.d drawn: the stored call that partly succeeded draws its lines with the right ids, the refused entry as not asked, with no record on the machine. G2.b and the row of G2.f against the stand-in. Its tests also pin: the ids of an eight-question call in the order of its entries; a call of eleven shows eight lines and "3 more"; each head-line form from its call; a line shows the sentence that asks, not the statement before it; a refused entry's line carries its entry's number; a call whose outcome is not known draws no id and no Open; a call the engine denied draws as an error; a revise moves the line and leaves "Revised below"; a delivery on each of the three carriers fills the receipt and draws no bubble; an envelope typed by a person fills nothing; a receipt reads the same from the block and from the record's `closed`; a subagent's transcript draws its own calls' rows, with their receipts while the record lives; with the record removed, the row of an ended subagent whose answer went to the parent shows its questions and no receipt (S8's edge, stated and not repaired); a `question` call of today's form is unchanged.

**Gate.** Class 1a; `e2e:transcript` and `e2e:lane-a` with the new cases; `e2e:c7` and `e2e:to-human`, unchanged and green; `e2e:desk-web`, unchanged and green.

### M6 — Live on a Mac, the built look, the record

**At its end.** G2 is seen with a real terminal session, a real model and the real `sminos`, on a Mac. The pictures of the built surfaces are with the composite's writer. What was accepted as a limit is in the tracker.

**Blocked by** C2.G2 merged in doperpowers (the tool's sheet form in a terminal session), beside M5.

**Touches.** `e2e/words-shots.rig.ts` and `docs/doperpowers/specs/2026-11-16-word-cut/scenes.md` (the sheet's scenes); one recorded transcript under `test/fixtures/`; `docs/tech-debt-tracker.md`; this document's Progress and Outcomes.

**Decisions.**

- The setup is S17's, and its first check comes before any reading of the app: after the agent's first call, `<the scratch sminos home>/sheet/<the session's id>/state.json` exists. If it does not, the session is running today's tool (the wrong plugin, the setting, or no live surface) and nothing the app shows means anything.
- G2.g live is not left to a hand's timing. The app is started with `MAWS_SMINOS_CLI` naming `test/support/sminos-barrier.sh` in front of the real command; both windows' Sends are pressed and wait at the barrier; one touch of the barrier's file releases both to the real `sminos`, and the tool's own step applies one and refuses the other.
- Limits logged in `docs/tech-debt-tracker.md`, one row each: an image pasted and never sent stays in the record until the record is removed; "changed since asked" is as old as the last read of the model; a window on another machine lists a sheet item it cannot answer until C6; a link the sheet's policy refuses is drawn as a link and does nothing; a subagent's own history does not read the delivery its coordinator's message carried, so its row has no receipt once the record is gone.

**Does not touch.** Anything a milestone before it built, but for a fault the live run finds, which is fixed where it lives and reported.

**Proves.** G2.a to G2.g, by the steps quoted under Concrete Steps, in addition to the gates of M4 and M5 on the landing's head.

**Gate.** Class 1a; `e2e:lane-a`, `e2e:transcript`, `e2e:c7`, `e2e:panel`, `e2e:to-human`, `e2e:desk-web` on the landing's head; the live steps by hand.

## Concrete Steps

All from the worktree's root. A gate tests the committed head; while iterating, one focused file may be run on the machine (`pnpm exec vitest run <path>`).

**M1.** From the merge commit of pull request #628 itself, not from a checkout's files on disk:

    rm -rf test/fixtures/sheet/set && mkdir -p test/fixtures/sheet "$TMPDIR/pin"
    git -C <doperpowers> archive 2594002afc6ce00ddf43808791ac78705e80ab47 sminos/types/sheet | tar -x -C "$TMPDIR/pin"
    cp -R "$TMPDIR/pin/sminos/types/sheet" test/fixtures/sheet/set
    pnpm exec vitest run src/shared/sheet src/services/sheet/reader.test.ts
    scripts/ci-gate.sh "$PWD" --gates static,unit,probes

The pin's test fails with the two digests side by side until `PROVENANCE.md` names the copy's. Every fixture directory appears in the run as two comparisons, `before` and `after`.

**M2.** The gates, then the real door by hand, on a record nobody runs:

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:lane-a,e2e:supervisor-daemon
    export SMINOS_HOME="$(mktemp -d)"
    cp -R test/fixtures/sheet/set/fixtures/references/before/sheet "$SMINOS_HOME/"
    S=5eed0000-0000-4000-8000-000000000019
    printf '%s\n' '{"v":1,"key":"maws-demo-0001","kind":"dismiss","id":"q1","by":"maws"}' \
      | <doperpowers>/sminos/bin/sminos sheet put --session "$S"
    <doperpowers>/sminos/bin/sminos sheet show --session 00000000-0000-4000-8000-000000000000; echo "exit $?"

The first prints `{"session": "5eed0000-…", "results": [{"key": "maws-demo-0001", "state": "queued"}]}`; the second prints `no sheet: …` and `exit 3`, the locator's proof. If either differs, S2 or §E is wrong and is corrected before M4.

**M3.** The gates, then the page, on a Mac under the load rule:

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:desk-web
    pnpm dev:harness          # then the harness's #sheet page; ?fixture=references&side=before, ?fixture=stopped-queue&side=before, ?fixture=answer-stale&side=after

`references` shows two cards, one with three collapsed files that open to the captured text at lines 40 to 80, to a three-line file, and to an image; `stopped-queue` shows a queued answer with its take back.

**M4, M5.**

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:lane-a,e2e:c7,e2e:panel,e2e:transcript,e2e:desk-web
    scripts/ci-gate.sh "$PWD" --gates e2e:to-human        # M5

**M6.** On a Mac, under the load rule, with the app built from the landing's head and doperpowers at C2.G2:

1. Set up as C2's live check does (its plan's Concrete Steps, "The live check"): one scratch configuration home and one scratch `SMINOS_HOME`, exported in every shell used below. Start the stand-in surface, `<doperpowers>/sminos/tests/sheet_surface.py`. Start the app from such a shell, in a profile of its own so that its `mawsd` is this one and has this environment, with `MAWS_SMINOS_CLI=<doperpowers>/sminos/bin/sminos`. Start a terminal session in a scratch project with the checkout's plugin and the setting on: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 SMINOS_QUESTION_SHEET=1 claude --plugin-dir <doperpowers>/sminos`.
2. Ask it: "Put three questions to me on your sheet in one call: one with two options and a recommendation, one that references README.md, one with no options. Then keep working: list this directory." The terminal shows `3 open questions`, and `ls "$SMINOS_HOME"/sheet/*/state.json` lists the session's record: go on only if it does.
3. In MAWS, open nothing. The session's row and tab read "Question waiting"; the side column is as it was (G2.a). In the session's transcript the call's row has three lines, `q1` to `q3` (G2.b).
4. Press Open on `q2`: the side column shows the sheet with the keyboard on `q2`'s card, and its file opens to README.md as captured (G2.b).
5. Answer all three, one with a pick and typed text, and press "Send 3". The agent quotes the three answers in one message, at its next tool result or at once when idle (G2.c, G2.d); the three row lines are receipts, the first reading `q1 <header> → <label>` (G2.b); the cards are gone.
6. Ask the agent to put two more questions and then withdraw the first of them. That question's card disappears and its row line reads "Withdrawn" (G2.f).
7. Close the terminal. The session, now stopped, still lists its open question in its "Waiting for you" card and its sheet; answer it: the card reads queued, with take back (G2.e). Resume the session in the terminal and send it any message: the answer goes with it, and the row line becomes the receipt.
8. Restart the app with `MAWS_SMINOS_CLI=test/support/sminos-barrier.sh`, `SMINOS_REAL=<doperpowers>/sminos/bin/sminos` and `SMINOS_BARRIER=<a file that does not exist yet>`. With a second window on the same session and a new question open, answer it in both windows and press Send in each; both wait. Create the barrier's file: one window's line becomes the receipt and the other window reads that the question was already answered (G2.g).
9. `WORDS_ONLY=<the sheet's scenes> pnpm shots:words` with `WORDS_OUT` outside the repository; hand the pictures to the composite's writer.

## Outcomes & Retrospective

**C3a (M1 to M3), 2026-11-24.** The pin, the model, the service, the wire and the components (the composite's X5) are on the branch, each task-reviewed clean; G1.a, G1.b, G1.c and G1.d at the model are proven by tests that walk the pin. What went as planned: M1's port matched sminos's own `show` on every fixture at the first run, so §B was the right grain for a port. What did not:

- The set changed after §B to §D were written; the diff `9f4860205..2594002af` was small enough to read whole, and two corrections came from it before M1 and one from M1's own reading (the door's results are not `SheetSent`s). Reading a pinned artifact's diff, not its prose, was the cheap way to correct a plan written against a moving set.
- The task reviews found more than the plan foresaw, most of all in M3, which took three fix rounds. The plan named the memory's rules (S13 to S15) but not who owns a write when two mounts share one memory and a door's answer or a paste lands late; the answer, an update applied at commit (`onMemory`), is now X5 and changes C4's consumer. A plan for shared UI state should state its write discipline, not only its rules.
- M2's service met two timing promises only after review (the first record within a second; a read never held by a probe), and its door's bound only after a child that ignores SIGTERM was tried. Promises with a number in them deserve a test at production timing from the start.
- Master moved `WIRE_MINOR` under the branch twice (62, then tail-first's 63); the sheet's namespace is 64.

Left for C3b: M4 to M6 as planned; M5's blocker, #852, is now on master. The pictures of the built components wait for M6's built look.

## For the composite's writer

State, like Progress. Three lists: the sentences of the composite, as it stands at the parent pin `e6a07c35e`, that this document makes false or incomplete, each with the replacement proposed; what needs the owner; what the `ux-wave` session should be told. An advisory sentence this child overturns is this document's text from now on; a binding one stands until the writer rules. The entries the composite took by `e6a07c35e` left this list (the calm row's reach, the tab's name, X2's exits, C3's design inheritance and status, X5 as built, C6's `no-target`; the refused link's drawing is C4's, §8.2). What remains:

**Sentences.**

1. §8, "a kept draft … is shown as carried (its picks where they are still labels)". No frame shows it; this document builds it at one place ("The look", "What the frames do not show") in words of its own ("You wrote this before the question changed.", "Keep my answer"). Proposed: nothing in the composite; the owner sees it in the pictures of the built surfaces (C3b).
2. §8.1, "opens with a head line saying what the call did ("Asked 3 questions")". Incomplete for the other calls. Proposed addition, from your settlement and the frames: "A call that revised reads "Revised q5", one that did both "Asked a question, revised q5", one that only withdrew "Withdrew q6" and has no lines; past eight lines the rest stand behind "N more"; a refused entry's line shows its entry's number where an id would stand, and "Not asked"."
3. §8.1, on the "Waiting for you" card: "one line per open question, "from <agent>" when a subagent asked". Proposed addition, from your settlement: "where the card is too narrow, "from <agent>" gives way before the question does."
4. X2 as read at the pin: `sheet put`'s results are `{ key, state: 'queued' }` or the bridge's verdict under its own name (`applied`), not `SheetSent`s; MAWS reads an act's fate from the model's `sent` only. And sminos's `show` at `2594002af` copies `id` and `target` from any queued inbox line that has them, which the show schema's closed queued variants refuse; MAWS projects by kind (reported for C2).

**For the owner, through you.**

1. **The built look**: the pictures of the built surfaces, the carried draft's card and the calm Needs you row first. M3 added words of its own (§I's "Strings no frame shows") and the carried picks' dashed edge, which the owner sees there too.

**For the `ux-wave` session, through you.** #852 is on master (`5fc0bb8aa`); its rig launch 15 is taken, so this child's own launch is numbered after it. M5 touches files #852 touched (`model/rows.ts`, `model/schema.ts`, `model/derive.ts`, `view/rows/Row.tsx`, `view/transcript.css`, new files under `test/snapshots/transcript/`), and the sheet's scenes join `e2e/words-shots.rig.ts`.
