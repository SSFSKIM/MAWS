# Question sheet, C3 — the sheet in the MAWS app: execution (2026-11-23)

> **Composite:** `docs/doperpowers/specs/2026-11-23-question-sheet-design.md`, child **C3** (The sheet in the MAWS app). **Parent pin:** `635073ce9` (branch `question-sheet`; master holds an earlier revision of the composite). **Ticket:** MAWS board #868, a child of #600. The child's section in the composite ("### C3: The sheet in the MAWS app") is its spec. The composite's §3 ("Readers read the file"), §4.3, §8 and §8.1 are its design, binding where the composite's "Grades" paragraph says (§8.1 is the owner's own ruling); X5 is the contract it owns, and X1, X2, X3 and X7 the ones it consumes. This document carries the constraints, the decisions the composite did not carry, the interfaces and the milestones, and nothing of the design.
>
> **Written against:** MAWS master `90ce5c017`; the sheet's published set as doperpowers pull request #628 carries it (branch `question-sheet-c2`, head `7b53f8a2d`, with a fix wave of its review not yet committed), which is not merged, so every shape of the set named here is read again at M1's pin; `origin/ux-wave/retire-tool-card` at `9305bfd0b` (board ticket #852, not merged).
>
> **Read before M1:** the composite whole; in doperpowers, `sminos/types/sheet/README.md` and `docs/doperpowers/plans/2026-11-23-question-sheet-c2-sminos.md` (I1 to I7, "What M1 freezes", "Who acts, and on which file"); here, `docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md` (sections l4-approvals-08, O-17, O-21, O-22), `docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md` (Interfaces §A) and `docs/doperpowers/specs/2026-10-15-desk-renderer-survey.md` ("Ranked").

After this child, a terminal session on this Mac that asks through the sheet is answered in the MAWS app. The agent's call draws a row with one line per question, and nothing opens. Open on a line, or a line of the "Waiting for you" card, shows the session's sheet in the side column at that question: every open question as a card, with its context, its files as they were when asked, its options and one text field. The person answers any of them in any order and presses one Send; each answered question's line becomes its receipt (`q7 Auth method → OAuth`) and the agent has the answers together. The session reads "Question waiting", calmly, and never as stopped. A stopped session's questions are still there; an answer given then is shown as queued and can be taken back. The card, the sheet and an overview of sessions are three components that C4's page and desk-web import as they stand.

How to see each of these is Concrete Steps. What closes the child is its two gates in the composite, G1 and G2, mapped to milestones under Plan of Work.

## Progress

- [x] (2026-11-23) This document written against the composite at `635073ce9`, MAWS master `90ce5c017` and doperpowers pull request #628 at `7b53f8a2d`.
- [ ] The document's buildability review.
- [ ] The look: a drawn example put to the owner, and the owner's answers recorded ("The look").
- [ ] M1 — The pin and the model. Blocked by: doperpowers pull request #628 merged.
- [ ] M2 — The service: live reading, and the writer's call. Blocked by: M1.
- [ ] M3 — The components (the composite's X5), on fixtures. Blocked by: M1; the look.
- [ ] Landing C3a (M1 to M3): G1 but for the row's drawing. Its merge unblocks C4.
- [ ] M4 — The side sheet, the waiting card, the attention items. Blocked by: M2, M3.
- [ ] M5 — The row's lines and receipts. Blocked by: M4; board ticket #852 on master.
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
- The look: the owner's eye, on a drawn example before M3 and on pictures of the built surface at M6. No review by an agent stands in for it.

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
- On `origin/ux-wave/retire-tool-card` the rows of question tools are untouched: the branch changes how a tool call's `cell` row is drawn (a quiet line with a chevron, a 12 px glyph slot, detail indented 19 px, no box) and leaves `question` and `ask` rows bordered. It changes `model/rows.ts`, `model/schema.ts`, `model/derive.ts`, `view/transcript.css`, `view/rows/Group.tsx`, 53 files under `test/snapshots/transcript/` and `e2e/words-shots.rig.ts`, which is why M5 waits for it.

## Decisions settled at authoring

Each is a choice the composite left to this child, numbered S1 to S18 (the charter's decisions are D-1 to D-21; these are not those). Where one makes a sentence of the composite false or incomplete, the sentence is in the last section.

- **S1 · MAWS runs the command** (X2; agreed with C2's side). The writer's call is `sminos sheet put --session <id>`, inbox lines on standard input, one JSON object on standard output. The sminos daemon's socket lost for three reasons the code shows: the daemon is an optional install, and a record must be answerable on a machine without it; MAWS does not connect to that daemon at all, the daemon connects to MAWS (`src/endpoint/rl10/server.ts`), and only while the machine is enrolled; and the command is the one code path that holds the record's lock, which a second server-side path would have to reproduce. The cost is one process of about 0.3 s per Send, paid when a person presses a button.
- **S2 · How MAWS finds the command** (§E, `locate.ts`). In order: the path in `MAWS_SMINOS_CLI`, read from `mawsd`'s environment and then the login shell's; the installed sminos plugin's `bin/sminos`, its install path read from the engine's own registry `<config>/plugins/installed_plugins.json` as `src/services/owner/resolve-style.ts` already reads it; the first executable `sminos` on the login shell's `PATH`, scanned as `findGws` scans (`src/services/delivery/gws.ts`). The command runs with the login shell's environment, so `python3` resolves as it does in the person's terminal, with `SMINOS_HOME` set to the home the reader reads. A found command is proven once by a probe, `sminos sheet show --session 00000000-0000-4000-8000-000000000000`, whose exit 3 (`no sheet`) shows that the launcher runs, its Python is new enough and it knows the sheet's verbs; the proof is kept by path and modification time and made again when a spawn fails, since a plugin update removes the old version's directory. Under a test runner only `MAWS_SMINOS_CLI` is read, as `sminosHome` refuses the real home there. Reading stays possible when no command is found: the sheet is drawn and its Send is replaced by the reason. The alternative weighed was the path the sminos daemon's own service uses (`installed_cli` in `sminos_daemon.py`, the marketplace clone): it exists only where that service is installed and names a tree that can be newer than every running session's plugin.
- **S3 · The reader runs on the spine, in `src/services/sheet/`** beside lane A (the composite's advisory lean, taken). One reader per machine serves every window, and C4's page server, which is `mawsd`, calls the same module. It reads every record under the home, whichever kind of session wrote it, so C5 adds no reader.
- **S4 · MAWS's reader is its own code, held to the set.** `src/shared/sheet/read.ts` computes the model as C2's I4 words it, and a test compares it with every `show.before.json` and `show.after.json` of the pin. Calling `sminos sheet show --json` instead would cost a process per change and make reading depend on finding the command. The set's JSON Schema files are kept in the pin as reference and are not executed: the comparison with the set's own `show` outputs is the stronger check, and no JSON Schema validator joins the dependencies for it.
- **S5 · A record this build cannot read is said, not guessed.** Record-sourced shapes are parsed loosely (`z.looseObject`, as lane A parses what a bridge sends), so a later sminos that adds a field does not blank a sheet. A `state.json` whose `v` is not 1, or that does not parse, gives a summary marked `unreadable` and a sheet that says so in place of its cards.
- **S6 · A record is keyed by the engine's session id everywhere in this child**: the service, the wire, the store, the components. The app's own session id is joined on at the edges (a summary carries `appSessionId` when the index holds a session with that engine id, else null).
- **S7 · A change is announced small and read on demand.** `sheet.changed` carries a summary; a window fetches a model with `sheet.read` only for a session it shows. A model with previews can pass 100 KiB and most windows show no sheet.
- **S8 · The transcript is the base of a row, the record an overlay.** A sheet call's row, its lines, their ids, "Revised below", "Withdrawn" after a later withdrawal and the receipt of a delivered answer are all derived from the transcript alone (X7's first line, the call's input, X3's block in an arrival), so they hold after a reload, in a subagent's transcript, and when the record is gone (a `/clear`, a removal). The model adds what no transcript has yet: that a question is open (so its line offers Open), an answer accepted and not delivered, a queued answer or dismissal, a withdrawal by `/clear`. The alternative, receipts read from the record alone, would leave an old session's answered questions with no answer anywhere, because the delivery's own text is not drawn as a bubble.
- **S9 · A sheet call is a new row kind, `sheet`**, not a variant of `question`. `question` rows carry a waiting form and today's receipt shape, are a mod site, and are bundled by desk-web with those meanings; a sheet call shares none of them. The form is told by the call's input (composite §2.1), in the transcript's derivation, since the tool's name is the same.
- **S10 · A sheet item is one attention item per open question that has no queued answer**, of kind `async_input`, id `sheet:<session>:<question>`, made on the spine from the model (§H). It is in the session's waiting list (the "Waiting for you" card, Needs you, the session's row and tab) and in no placement: no form in a row, no card at the transcript's end, no waiting mark on a call. One predicate, `isSheetItem`, makes the difference in the three functions that place requests.
- **S11 · Notices.** A sheet item's notice is in-app only for a terminal session, as every lane A item's is (the owner's ruling in P5 O9, kept by U1's O-22: the terminal announces its own). It fires once per call: an item is announced when it is new and no item of the same call was announced before, so a call of eight questions makes one notice and a revise makes none. C5 decides what a MAWS-run session's sheet item does with macOS notifications.
- **S12 · The side sheet is a tool of the side column** (the charter's X5), id `sheet`, one per session, opened only by a person's act: Open on a row line, a line of the "Waiting for you" card, the notice's own button, or the side column's "+" menu. It is a second tool beside `ask-sheet`, which stays MAWS's `ask` form until C7.
- **S13 · The surface's memory** (drafts, the revision of each question the person last saw, the acts this window sent) is held per session in the window, outside the components, and passed to them (§G). It is dropped for a question when the model no longer lists it. A draft survives a rewrite: its text and images are kept, and its picks where they are still labels of the new revision.
- **S14 · "Updated" stands until the person touches the card.** A card is marked updated when its revision is higher than the one the person last saw, and the mark clears when the person edits that card's draft, dismisses it or sends it. Clearing on sight would remove the mark before it was read.
- **S15 · What a surface shows for an act it sent** is read from the model's `sent` by the act's key, never from the act itself (composite §4.3, §5.4). A refusal as stale marks the card and restores the draft; `closed` and `too-late` are said in a note at the head of the sheet that stays until the person closes it, since a lost answer is worth more than three seconds.
- **S16 · The overview component is built and not mounted in the app.** `SheetOverview` is C4's `/`; §8.1 gives the app no overview of sheets. In the app a stopped session's questions show where every session's do: its pane, its "Waiting for you" card, Needs you.
- **S17 · The live check uses C2's stand-in surface.** A terminal session takes the sheet only with a live surface registration (composite §7), which C4 writes. Until then G2's session is started with the setting on and `sminos/tests/sheet_surface.py` of the doperpowers checkout running, as C2's own G2 is. The app registers nothing in this child: a registration names a page's address, and the app has none.
- **S18 · Two landings.** C3a is M1 to M3 and C3b is M4 to M6, each a pull request. C3a holds everything C4 consumes and nothing a person can reach in the app, so it can merge as soon as it is reviewed.

## The look

The composite fixes where each thing is and how it behaves; it does not fix appearance. This repository settles appearance for a new surface the way the UX wave's children did: **a drawn example goes to the owner with question cards**, and the answers are recorded verbatim. The drawn example is one static page at real size, in the app's light-theme tokens and today's shapes, with invented names, paths and text. It is kept outside the repository with its generator (the UX wave's UC-11), drawn by the session that holds the composite; this document only says what it shows. The owner's answers are written into this section, in the wave's form (`"<card>" = "<choice>"`), and from then on they are this child's text.

**Frames.**

1. A sheet in the side column at its usual width, four cards: a single-select question with a recommended option and the focused option's preview; a multi-select question with two picks and typed text; a text-only question with Markdown context and two references, one collapsed and marked changed since asked, one open at its line range; a question from a subagent. One Send, labelled with the count of drafts.
2. One card in each state a surface can show: open; updated since seen, with its kept draft; queued, for a stopped session, with take back and edit; accepted and not yet delivered; refused as stale.
3. The row, on #852's line model: a call that added three questions, at rest; the same row after the three outcomes (an answer's receipt, "Dismissed", "Withdrawn"); an earlier row whose question reads "Revised below"; a call that partly succeeded; a call that only withdrew.
4. The "Waiting for you" card with five question lines, one of them "from reviewer", beside a permission prompt's line.
5. The sheet at the side column's narrowest width, and the same session's sheet in place in an Overview card.
6. The notes: an answer that came second ("q7 was already answered"), a sheet whose Send is unavailable, a record this build cannot read.

**Cards**, each with the default that is built if the answer is the recommended one. Each default lives at one named place, so another answer is one edit there.

| card | question | recommended default | where the default lives |
|---|---|---|---|
| L1 | Does a sheet call's row open with a line of its own ("Asked 3 questions") above the question lines, or are the question lines the row? | A head line, the question lines under it at rest, its chevron folds them. | `SheetRow.tsx` |
| L2 | A call of many questions: all lines at rest, or a fold? | The first eight, then "N more". | `SheetRow.tsx`, one constant |
| L3 | The focused option's preview "beside" the options, in a column too narrow for two. | Beside from 560 px of card width, under the options below that. | `QuestionCard.tsx`, one constant |
| L4 | Does an open sheet question raise the jump button's "Needs your input"? | No. The button leads to a form in the transcript, and a sheet question has none; the "Waiting for you" card lists it. | `placeWaiting` (§H) |
| L5 | Do a stopped session's open questions count in Needs you and the dock badge? | Yes: the composite says every open question is an item, and a queued answer is a real answer. | `src/services/sheet/attention.ts` |
| L6 | The words of every state and note not fixed by the composite (§I's second list). | As §I lists them. | `src/renderer/src/sheet/copy.ts` |

L4 and L5 are behaviour more than appearance and are listed again for the owner in the last section.

**What waits for it.** M1 and M2 draw nothing and do not wait. M3 and every later milestone are blocked by the look: by the owner's answers, or by the composite's writer saying to build the defaults (the UX wave's ruling of 2026-11-15 let no milestone wait for a look, each default being one edit away; whether that ruling extends to a surface that is new as a whole is the writer's call, not this document's).

**The built look.** M6 photographs the built surfaces with the words rig (`pnpm shots:words`, `e2e/words-shots.rig.ts`), to a directory outside the repository, and hands the pictures to the composite's writer for the owner.

## Interfaces and Dependencies

Paths are from the repository's root. `R/` is `src/renderer/src/`. A name given here is the name that must exist at the end of the milestone that makes it; where an executor finds a better shape, it reports it and the controller rewrites this section, since later milestones and two other children read it.

### §A · The pin (M1)

    test/fixtures/sheet/set/           the set, copied whole and byte for byte: README.md, MANIFEST.json, schema/, examples/, grammar/, fixtures/
    test/fixtures/sheet/PROVENANCE.md  what it is a copy of, and the rule for copying it again

`PROVENANCE.md` follows `test/fixtures/lane-a/dx4-jobs.PROVENANCE.md` and holds one table row with the three values C2's plan names: the doperpowers merge commit of pull request #628, the sminos version that merge published, and the manifest's `digest` (with its `version`). It says: never edit a file of the copy; when the composite's writer rules a change to the set, copy the directory again and move the three values.

`src/shared/sheet/pin.test.ts` recomputes the digest as the set's README defines it (the SHA-256 of the lines `<sha256>  <path>\n` of every file but `MANIFEST.json`, sorted by path) and asserts three things: it equals `MANIFEST.json`'s `digest`; it equals the digest `PROVENANCE.md` names; the directory holds no file the manifest lacks. The set holds a PNG, files without a final newline and an inbox that ends in a torn line, so `.gitattributes` marks `test/fixtures/sheet/set/**` as `-text`, and the formatter and the linter ignore the directory.

At authoring the set stood at 21 fixture directories, 6 examples (with `split/then`), the result grammar with its examples, six schemas and a README of readings, and its review was still changing it (a closed question's and a pending outcome's `places`, the name cuts of `show`, a reader that answers busy after three moved reads). **What the pin holds binds; this document's §B to §D are corrected to it in M1, before M2 starts.**

### §B · The model (M1)

`src/shared/sheet/` is pure TypeScript: no Node builtin, no DOM, no React. It is the half of the composite's X5 that is not a component.

`model.ts` holds the types of the model and their zod schemas, field for field as the pin's `schema/show.schema.json` and `schema/inbox-line.schema.json` state them:

    SheetModel      { v: 1, session, seq, open: SheetQuestion[], hidden: { id, key }[], sent: SheetSent[], pending: SheetOutcome[], closed: Record<id, SheetClosed> }
    SheetQuestion   a question of §1 with `handle`, its references each with `changed`, and `queued` when a queued answer stands on it
    SheetReference  SheetOption  SheetAsker  SheetOutcome  SheetClosed  SheetSent
    SheetSentState  'queued' | 'accepted' | 'delivered' | 'stale' | 'closed' | 'retracted' | 'too-late'
    SheetLine       one inbox line as a surface writes it: { v: 1, key, kind: 'answer' | 'dismiss' | 'retract', id?, revision?, picks?, text?, images?, target?, by }
    SheetBy         'maws' | 'page' | 'desk' | 'cli'
    SheetSummary    { session, appSessionId: AppSessionId | null, title: string | null, live: boolean | null, seq, open, queued, pending, hidden,
                      oldestAskedAt: string | null, unreadable: boolean }
    SheetPutResult  { ok: true, results: SheetSent[] } | { ok: false, why: 'unavailable' | 'no-sheet' | 'refused' | 'busy' | 'failed', message: string }
    SheetBodyRequest { ref: string /* a reference's sha256 */ } | { upload: string /* a name under uploads/ */ } | { text: string /* a text file's sha256 */ }
    SheetBody       { kind: 'text', text: string } | { kind: 'image', mediaType: SheetImageType, data: string /* base64 */ } | { kind: 'gone' }
    SheetImageType  'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

A surface writes no `at` and no `batch`: the door fills both. `SheetSummary.open` counts the listed questions that carry no queued answer, `queued` those that carry one, `pending` the accepted outcomes not delivered, `hidden` the questions with a queued dismissal. `live` is whether a process holds the session, from the index's holder; null when the index does not hold the session.

`read.ts`, the reader's computation:

    export function modelOf(state: SheetState, tail: Uint8Array, changedOf: (reference: StoredReference) => boolean | null): SheetModel
    export function lineError(line: unknown): string | null            // why an inbox line fails the line's schema, or null
    export function summaryOf(model: SheetModel, facts: Pick<SheetSummary, 'appSessionId' | 'title' | 'live'>): SheetSummary

`modelOf` is C2's I4, steps 2 to 7, on bytes already read; `tail` is the inbox from `state.inbox.offset` to the end of the file, and the function itself stops at the last newline. Pitfalls the Python source shows and a port gets wrong: `sent`'s keys sort by code unit (the default comparator; keys are ASCII), never by locale; every cut counts code points (`[...text]`), not UTF-16 units; a tail line that is not valid UTF-8 or not JSON is dropped, as is one holding `NaN`, an infinity or a lone surrogate; a queued line is dropped when its key has a verdict or occurred earlier in the tail; a queued answer with more than one pick on a single-select question is dropped as a pick that is no label is.

`call.ts`, the stored call (X7):

    export function isSheetCall(input: unknown): boolean                 // an object with `ask` or `withdraw`
    export type SheetResult = { form: 'sentences'; added: { id: string; entry?: number }[]; revised: { id: string; entry?: number; revision: number }[]; withdrew: string[] }
                            | { form: 'nothing' } | { form: 'unknown' }
    export function parseSheetResult(text: string): SheetResult | null   // null: the first line is not of the grammar (a denial; not a sheet call's result)
    export interface CallEntry { entry: number; id: string | null; revision: number | null; outcome: 'added' | 'revised' | 'refused' | 'unknown';
                                 header: string | null; question: string; options: string[]; multiSelect: boolean }
    export function callEntries(input: unknown, result: SheetResult | null): { entries: CallEntry[]; withdrew: string[]; notDone: string | null }

The pattern is the pin's `grammar/result.md`, matched whole against the result's first line. `callEntries` pairs entries with ids by the grammar's own rule: an entry that names an `id` is a revise of that id; the entries that name none are the added ones, in order, paired with `added` by place when no item carries `(entry n)` and by that number when any does; an entry in neither sentence is `refused`. With `result` null (the call has no result yet) or of form `unknown`, every new entry's `id` is null and its outcome `unknown`. `notDone` is the result's `Not done: ` line, whole, when it has one.

`delivery.ts`, the block (X3):

    export interface SheetDelivery { v: 1; keys: string[]; answered: { id: string; revision: number; picks: number[]; text: string; textCut?: true; textFile?: string; images: string[] }[];
                                     dismissed: string[]; more?: true }
    export function parseSheetDeliveries(text: string): SheetDelivery[]   // every <sheet-delivery>…</sheet-delivery> of a text, each held to the pin's delivery schema; none for a text without one

A reader reads the block and nothing above it (C2's I7).

`words.ts`:

    export function firstSentence(text: string): string                  // through the first `.`, `?` or `!` that ends a word, or the first line break; at most 120 characters, then `…`
    export function receiptOf(labels: readonly string[], text: string): string   // the labels joined by ", "; with none, the text's first 80 characters: the record's own rule (C2's I2), so a receipt reads alike from either source
    export function linesOfSend(open: readonly SheetQuestion[], drafts: ReadonlyMap<string, QuestionDraft>, by: SheetBy, newKey: () => string): SheetLine[]
    export interface QuestionDraft { revision: number; picks: string[]; text: string; images: string[] }   // picks are labels; images are `uploads/<name>`
    export const hasAnswer = (draft: QuestionDraft | undefined): boolean // a pick, or text that is not blank; an image alone is no answer (§4.1)
    export function carryDraft(draft: QuestionDraft, question: SheetQuestion): QuestionDraft   // onto another revision (S13)

`linesOfSend` gives one answer inbox line per open question whose draft has an answer and whose draft's revision is the question's, oldest first.

### §C · Reading records (M1), and the service (M2)

`src/services/sheet/` runs in Node, on the spine.

`reader.ts` (M1):

    export const sheetRoot = (home: string): string                      // <home>/sheet
    export async function listRecords(home: string): Promise<string[]>   // the session ids with a record: every directory of the root that holds a state.json
    export async function readRecord(home: string, session: string): Promise<{ model: SheetModel } | { unreadable: string } | { busy: true } | null>

`listRecords` skips `surfaces`, `.staging` and the `*.lock` files (C2's I1) and any name that is not an engine session id. `readRecord` is I4's step 1 around `modelOf`: `state.json`, the inbox from its offset, `state.json` again, over while `seq` moved, as the pin's README words the end of that loop; null when there is no record. `changedOf` compares the file at a reference's `abs` with the record's `size` and `mtimeMs`, the modification time floored to a millisecond from nanoseconds (`fs.stat` with `bigint: true`: the float `mtimeMs` rounds the other way on some values), and reads a missing file as changed. A reader takes no lock and writes nothing.

`service.ts` (M2):

    export interface SheetServiceDeps {
      home: Promise<string>;                                   // sminosHome(deps.env, shellEnv), as lane A's driver gets it
      shell: Promise<Record<string, string>>;                  // the login shell's environment
      env: Env; configHome: string;
      sessionOf(engineSessionId: string): { appSessionId: AppSessionId; title: string | null; live: boolean } | null;   // from the index
      emit(name: 'sheet.changed', payload: EventPayload<'sheet.changed'>): void;
      timing?: { pollMs: number; debounceMs: number; putMs: number };   // 2000, 50, 25000
    }
    export interface SheetService {
      list(): Promise<SheetSummary[]>;
      read(session: string): Promise<SheetModel | null>;
      put(session: string, lines: SheetLine[]): Promise<SheetPutResult>;
      body(session: string, of: SheetBodyRequest): Promise<SheetBody>;
      upload(session: string, image: { mediaType: SheetImageType; data: string }): Promise<{ ok: true; path: string } | { ok: false; why: string }>;
      onChange(listener: (summary: SheetSummary | null, session: string) => void): () => void;   // what §H's items are made from
      door(): Promise<{ available: true } | { available: false; reason: string }>;
      stop(): void;
    }
    export function createSheetService(deps: SheetServiceDeps): SheetService
    export function registerSheet(service: SheetService, register: Register): void

It is started in `startSpine` (`src/services/spine-root.ts`) beside the lane A driver, under the same condition, and joins `parts` for the stop.

**Following records.** The service watches `<home>/sheet/` with `watchTree` (`src/shared/fs/watch-tree.ts`) and, because the directory may not exist yet and a file event can be lost, also lists it every `pollMs`, as `watchBridgeDir` does for `bridge/`. A change under a record's directory re-reads that record after `debounceMs`; a summary is emitted when the record appeared, went, or its `seq`, its inbox's length or its count of queued lines moved. `busy` is read again at the next tick. A record that went emits null.

**Bodies.** The service resolves each `SheetBodyRequest` (§B) against the record itself and never against a path a window sent: a `ref` must be the `sha256` of a reference of a listed question; an `upload` must be named by a queued answer or a pending outcome of the model; a `text` must be a pending outcome's `textFile`. A text reference is returned as text; an image only as one of the four raster types; anything else, and anything missing, as `gone`. This is §8.2's fourth rule read for the app, where it costs nothing: bytes an agent chose are never handed to a window as markup.

**Uploads.** `upload` writes `<record>/uploads/maws-<32 hex>.<ext>` exclusively, mode 0600, from at most 5 MiB of decoded bytes (the composer's own bound after `downscaleImage`, `R/composer/editor/attachments.ts`), and answers its `uploads/<name>`; it refuses when the session has no record. A surface writes `uploads/` itself before the door names the file (C2's "Who acts, and on which file"). An image pasted and never sent stays until the record is removed; that is logged as debt, not swept.

### §D · The wire (M2)

`src/shared/ipc/schema/sheet.ts`, with its names (`src/shared/ipc/names/sheet.ts`) and grades (`src/shared/ipc/grades/sheet.ts`), wired as `src/shared/ipc/schema/lane-a.ts` is. Every command's `owner` is `'machine'`.

    sheet.list    {}                                  → { sessions: SheetSummary[]; door: { available: true } | { available: false; reason: string } }
    sheet.read    { session }                         → { model: SheetModel | null }
    sheet.put     { session, lines: SheetLine[] }     → SheetPutResult
    sheet.body    { session, of: SheetBodyRequest }   → SheetBody
    sheet.upload  { session, mediaType, data }        → { ok: true; path: string } | { ok: false; why: string }
    event sheet.changed   { session, summary: SheetSummary | null }

`sheet.changed` joins `MACHINE_EVENTS`. The grades keep all five commands on this machine: the endpoint denies them (C6 opens what it needs). `sheet.put` can wait on the record's lock and on the session's bridge, ten seconds each, so it gets a budget of 30 s in `src/services/command-budgets.ts`. A new namespace moves the wire: `WIRE_MINOR` in `src/shared/ipc/wire.ts` rises by one and the pinned `wire-manifest.json`, `wire-fingerprint.json` and `routes.json` are regenerated. `sheet.put`'s handler stamps `by: 'maws'` on every inbox line and refuses, before any process starts, a call of more than fifty lines or a line that fails `lineError`.

### §E · The door and its locator (M2)

`src/services/sheet/locate.ts`:

    export interface SminosCli { path: string; env: Record<string, string>; source: 'named' | 'plugin' | 'path' }
    export type Located = { ok: true; cli: SminosCli } | { ok: false; reason: 'not-installed' | 'no-sheet-verbs' | 'not-runnable'; detail: string }
    export function locateSminos(deps: { env: Env; shell: Record<string, string>; configHome: string; home: string; underTest?: boolean }): Promise<Located>

S2 is its contract. `env` of the result is the login shell's environment with `SMINOS_HOME` set to `home`. For the plugin source, the registry's entries whose id begins `sminos@` are read; a user-scope installation is taken first, else the one updated last. The probe's three outcomes: exit 3 is `ok`; a process that cannot start, or exits with Python's own complaint about its version, is `not-runnable`; any other exit is `no-sheet-verbs` (an installed sminos older than C2's first merge). `detail` is one sentence a card can show; it names no path.

`src/services/sheet/door.ts`:

    export function putLines(cli: SminosCli, session: string, lines: readonly SheetLine[], timeoutMs: number): Promise<SheetPutResult>

It runs `[cli.path, 'sheet', 'put', '--session', session]` with `execFile`, no shell, the inbox lines as compact JSON on standard input, one a line. Exits, as C2's I3 and the set's README give them: 0, the object on standard output is `{ session, results }` and each result is a `SheetSent` with state `queued` or a verdict; 2 is `refused` with the first line of standard error (a line the door would not take: nothing was appended); 3 is `no-sheet`; 75 is `busy`; anything else, a timeout and output that is not the object are `failed`. After `busy` or `failed` a surface sends again **under the same keys**: the key is what makes a resend the same act (composite §4.2).

`test/support/fake-sminos-cli.mjs`, the stand-in door, is an executable Node script that unit tests and e2e launches name in `MAWS_SMINOS_CLI`. It answers the probe with exit 3. For `sheet put` it validates nothing, waits `FAKE_SMINOS_DELAY_MS`, appends the inbox lines to `<SMINOS_HOME>/sheet/<session>/inbox.jsonl` with `at` and one `batch`, and prints `queued` for each. Three knobs serve the tests: `FAKE_SMINOS_EXIT` (exit with that code and a line on standard error, appending nothing), `FAKE_SMINOS_RESULTS` (a file whose object it prints in place of the `queued` results), and a staged record: when `<SMINOS_HOME>/sheet/<session>.next/` exists, it holds a fixture's `after` record and `keys.json`, that fixture's own keys in inbox order; the stand-in gives each arriving inbox line the place of the next of those keys, under a directory lock, and when every place is taken it replaces the record's `state.json` with the staged one, the fixture's keys replaced by the arriving ones. **It replays a fixture's `after`; it never applies a line.** §4.2's table has one implementation, the tool's, and a stand-in that computed verdicts would be a second. A window learns what became of an act from the model, as S15 says, so the replay needs to print no verdict.

### §F · The window's store (M2, M4)

`R/stores/sheet.ts`, whose client is a parameter, as `R/stores/attention.ts`'s is, so a transcript row may read it and desk-web may bundle it:

    export const useSheets: UseBoundStore<…>        // summaries by session; models of the sessions on screen; memory by session; the door's state
    export function connectSheets(client: MawsBridge = ipc): () => void     // sheet.list, then sheet.changed
    export function watchSheet(session: string, client?: MawsBridge): () => void   // keeps that session's model read while something shows it; counted
    export const selectSheetSession = (state, appSessionId: AppSessionId): string | null   // the record of an app session, by its summary
    export const selectSheetModel = (state, session: string | null): SheetModel | null
    export const selectSheetMemory = (state, session: string): SheetMemory
    export function setSheetMemory(session: string, next: SheetMemory): void

M2 makes the summaries, the models and the connection; M4 adds the memory (§G). `connectSheets` is called where `connectLaneA` is. A model is fetched when a session is first watched and again at each `sheet.changed` for it while it is watched.

### §G · The components: the composite's X5 (M3)

**What a consumer imports.** Two directories, and nothing else of this child:

- `src/shared/sheet/` (§B): the model's types and schemas, `linesOfSend`, `receiptOf`, `firstSentence`, the parsers.
- `R/sheet/`, through `R/sheet/index.ts`: `QuestionCard`, `OutcomeCard`, `SessionSheet`, `SheetOverview`, `ReferenceView`, the type `SheetHost`, the memory's types with `EMPTY_MEMORY` and `reconcile`, and the copy `SHEET_WORDS`.

**What a consumer supplies.** A `SheetHost` (below), the model or the summaries, and a place to keep each session's memory. For styles: the app's tokens and theme map (`R/styles/app.css`), the Markdown's two stylesheets (`R/transcript/view/transcript.css`, `streamdown/styles.css`), and one Tailwind `@source` line naming `R/sheet` in its own stylesheet, as `apps/desk-web/src/styles/app.css` names the directories it imports. For Markdown links: a `TranscriptActionsProvider` around the tree (`R/transcript/view/context.tsx`), as desk-web wraps its Markdown in `BROWSER_ACTIONS`; without one, links are inert.

**What stays in the app** and is no part of X5: `src/services/sheet/` (the files, the watch, the door, the locator), the wire, `R/stores/sheet.ts`, `R/tools/sheet/` (the side column's tool and the app's `SheetHost`), the sheet items and the transcript's row. C4's page server calls `src/services/sheet/` inside `mawsd`; desk-web reaches a machine's service by the path C6 builds.

**The boundary is enforced.** `R/sheet/**` imports only React, Radix primitives, `@shared/sheet/*`, `@shared/graph/ids`, `R/ui/*`, `R/request-card/controls` and `R/transcript/view/markdown/Markdown` with `R/transcript/view/context`: modules desk-web already imports as they stand, or leaves. An ESLint block for `src/renderer/src/sheet/**`, modelled on `PORTABLE`'s for `src/artifacts/`, refuses `electron`, Node builtins, `window.maws`, and any import from `R/ipc`, `R/stores`, `R/panel`, `R/session`, `R/lane-a`, `R/lane-b` and `R/tools`. `apps/desk-web/src/sheet-import.test.tsx` renders `SessionSheet` from a pinned fixture inside desk-web's own test project, so the import path a consumer uses is exercised by a gate.

    // R/sheet/host.ts
    export interface SheetHost {
      by: 'maws' | 'page' | 'desk';
      newKey(): string;                                        // one per act, of [A-Za-z0-9._:-], 8 to 128
      send(session: string, lines: SheetLine[]): Promise<SheetPutResult>;
      body(session: string, of: SheetBodyRequest): Promise<SheetBody>;
      saveImage?: (session: string, image: { mediaType: SheetImageType; bytes: Uint8Array }) => Promise<{ ok: true; path: string } | { ok: false; why: string }>;   // absent: pasting is not offered (the phone)
      openFile?: (abs: string, line: number | null) => void;   // a reference's file as it is now; absent: no such control
    }

    // R/sheet/memory.ts
    export interface SentAct { key: string; kind: 'answer' | 'dismiss' | 'retract'; id: string | null; draft: QuestionDraft | null; sentAt: number;
                               state: 'sending' | SheetSentState | 'failed'; note: string | null }
    export interface SheetMemory { drafts: ReadonlyMap<string, QuestionDraft>; seen: ReadonlyMap<string, number>; marked: ReadonlySet<string>; acts: readonly SentAct[] }
    export const EMPTY_MEMORY: SheetMemory
    export function reconcile(memory: SheetMemory, model: SheetModel): SheetMemory

`reconcile` is pure and is the one place the rules of S13 to S15 live: it carries a draft onto a new revision and marks the question; reads each act's state from the model's `sent` by key; restores the draft of an act refused as stale and marks its question; drops the draft, the seen revision and the mark of a question the model no longer lists; forgets an act once it reads `delivered` or `retracted`, and keeps one that reads `closed` or `too-late` until the person closes its note. `seen` gets a question's revision the first time the question is listed.

    // R/sheet/QuestionCard.tsx: one open question
    export interface QuestionCardProps {
      session: string;
      question: SheetQuestion;
      draft: QuestionDraft | undefined;
      mark: 'none' | 'updated' | 'stale';
      busy: boolean;                                           // an act of this surface on this question is in flight
      host: SheetHost;
      density?: 'full' | 'compact';                            // compact: folded to its row line until chosen
      onDraft(next: QuestionDraft | null): void;
      onDismiss(): void;
      onRetract(key: string): void;                            // take back the queued answer that stands on the question
    }

    // R/sheet/OutcomeCard.tsx: an outcome accepted and not yet delivered, read-only
    export interface OutcomeCardProps { outcome: SheetOutcome }

    // R/sheet/SessionSheet.tsx: one session's sheet
    export interface SessionSheetProps {
      model: SheetModel;
      memory: SheetMemory;
      onMemory(next: SheetMemory): void;
      host: SheetHost;
      focus?: { id: string; request: number } | null;          // bring this question's card into view and put the keyboard on it; `request` grows with each ask
      density?: 'full' | 'compact';
      unavailable?: string | null;                             // why this surface cannot send now; drawn in place of Send
    }

    // R/sheet/SheetOverview.tsx: the sessions of a machine that have a sheet
    export interface SheetOverviewProps { sessions: readonly SheetSummary[]; onOpen(session: string): void }

    // R/sheet/ReferenceView.tsx: one captured file, collapsed until opened
    export interface ReferenceViewProps { session: string; reference: SheetReference; host: SheetHost }

What each draws is the composite's §8 ("The card", "The sheet") and §4.3; what follows is only what those leave to this child.

- **The card's parts.** A question is in one of the states of frame 2. The card states them from its inputs alone: `question.queued` makes it queued (the queued answer shown, with take back, and edit, which is a retract and a new answer in one Send); `mark` makes it updated or stale; `OutcomeCard` is the accepted state. The options are today's option rows (the Radix `RadioGroup` and `Checkbox` rows of `R/request-card/variants/Question.tsx`, read as the pattern and written again here, since that file reads the attention store). The text field is always present. Dismiss is set apart, and for a question with a draft it asks nothing: the draft is dropped with the question.
- **References.** `ReferenceView` fetches its body through `host.body` when opened, never before, and draws a text with line numbers from `startLine` (the pattern is `EditDiff`'s numbered lines, `R/transcript/view/cells/EditDetail.tsx`; no CodeMirror, which the viewer store entangles) and an image scaled to the card. `changed === true` reads "Changed since asked"; null (a reader not on the session's machine) says nothing.
- **Markdown.** `context` and an option's `preview` are drawn by `Markdown` with `live: false`. That component already draws no raw HTML and no remote image, and holds links to its allowlist, which is §8.2's third rule.
- **Images.** The text field takes a pasted image only where `host.saveImage` exists, downscaled by the consumer's host, at most eight an answer.
- **The sheet.** Cards oldest first (the model's order), then the accepted outcomes, then one line for what is hidden by a queued dismissal with its take back. One Send, labelled with the count of questions that have a draft answer; it calls `host.send` once with `linesOfSend`, in chunks of fifty should there be more, and records the acts in memory. A Send that fails keeps every draft and offers the same Send again, which sends under the same keys. The notes of S15 stand at the head.
- **The overview.** Sessions with something on their sheet, the stopped ones (`live === false`) grouped apart, each with its counts and its oldest question's age; a session whose `live` is null is listed with the running ones.

### §H · The side sheet, the waiting card, the items (M4)

`R/tools/sheet/`:

    export const SHEET_TOOL_ID = 'sheet'
    export interface SheetToolParams { at?: string }                       // a question's id
    export const sheetTool: PanelTool<SheetToolState, SheetToolParams>     // one per session, not pinnable, offered from "+"
    export function appSheetHost(client: MawsBridge = ipc): SheetHost      // send → sheet.put, body → sheet.body, saveImage → downscaleImage then sheet.upload, openFile → the app's file opener

`sheetTool` is registered in `R/App.tsx` where `askSheetTool` is. It renders `SessionSheet` for the shown session's record over the store's model and memory, watches the session while visible, and shows an empty state when the session has no record. `open(state, params)` moves the focus to `params.at`. Its tab's title carries the count of open questions.

`TranscriptActions` (`R/transcript/view/context.tsx`) gains `openSheet(appSessionId: AppSessionId, questionId: string | null): void`, a no-op in `NO_ACTIONS`; the app's implementation is `panelHost.addTool(SHEET_TOOL_ID, { appSessionId, params: { at: questionId ?? undefined }, activate: true })`. **Nothing else adds or activates this tool.** That is O-17, kept: a test asserts that a record appearing, a question added and a `sheet.changed` each leave the side column as it was.

`src/shared/attention/sheet-item.ts`:

    export const SHEET_ITEM_PREFIX = 'sheet:'
    export const isSheetItem = (id: string): boolean
    export const sheetItemId = (session: string, questionId: string): AttentionId
    export function questionOfItem(id: string): { session: string; questionId: string } | null
    export function sheetItemsOf(appSessionId: AppSessionId, model: SheetModel): AttentionItem[]

One item per listed question without a queued answer: kind `async_input`; `request: { requestId: <question id>, toolUseId: <the question's callId>, taskId: null, agentId: <the asker's, or null> }`; `summary` the question's first sentence (U1's rule for a question's line); `createdAt` and `stateChangedAt` the question's `askedAt`; state `pending`; no expiry.

`src/services/attention/service.ts` gains a fifth list, `setSheetItems(appSessionId: AppSessionId, items: AttentionItem[]): void`, a live projection like the lane A list: never restored from the store, re-projected at start from the records, and with no request view (`attention.request` answers none for a sheet item). `src/services/sheet/attention.ts` feeds it from the service's `onChange` for every record whose session the index holds, and clears a session's list when its record goes.

The placement's rules, in `src/shared/attention/waiting.ts` and `kinds.ts`: `waitingRequests` lists sheet items like any other; `waitingForms`, `waitingByCall` and `placeWaiting` skip an item for which `isSheetItem` holds. So the "Waiting for you" card lists them and its presence rule sees them; no row is marked waiting by one, no form and no end card is drawn for one, and the jump button, which reads the placed list, is not raised by one (the look's L4).

What draws an item and must tell a sheet item apart:

- `WaitingCard` (`R/request-card/WaitingCard.tsx`): a sheet item's line is its mark, its summary, "from <agent>" when a subagent asked (the asker's name from the model where the rows do not know it) and its age; choosing it calls `openSheet` with the question's id, where every other line calls `showWaiting`.
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

A delivery is read from an arrival. `src/shared/engine/arrival.ts` reads a sheet's envelope on the three carriers it reads today's asynchronous answer on (a prompt the sminos plugin submitted, a hook's added context on a tool's result, the same on a prompt), told by the envelope's head `[sheet v1] ` and its block, and never from text a person typed. It travels on `user.message.arrival` as an entry of class `sheet` holding the parsed deliveries, read by `sheetDeliveriesOf(arrival)` under a strict schema of its own, the way `commandOf` reads class `command` (`src/shared/engine/arrival-schema.ts`): not a member of the carried union, so the wire does not break and a build that knows no such class keeps the event. The carrier itself draws as today's answer does: no bubble holding the envelope, and the notice row of the turn it reached, worded from the block's ids.

`R/transcript/view/rows/SheetRow.tsx` draws the row within #852's line model: the quiet line's classes and 12 px glyph slot, what stands under a line indented 19 px, no box. Over the row's own model it lays the store's (`selectSheetSession`, `selectSheetModel`, watching the session while a sheet row is mounted):

| the question, in the store's model | the row line |
|---|---|
| listed, no queued answer | the id, the header, the first sentence, and Open (only where the host's `openSheet` is not the no-op) |
| listed, with a queued answer | its receipt and "queued", and Open |
| hidden by a queued dismissal | "Dismissed" and "queued" |
| in `pending` | its receipt |
| in `closed` | its receipt, "Dismissed" or "Withdrawn", by `how` |
| not in the model, or no model | the row's own `outcome`; with none, the id, the header and the first sentence, with no Open |

The row's own `outcome` wins where it exists; the model fills only what the transcript does not hold yet.

Wherever the transcript's model treats the `question` kind specially and this section does not say otherwise, a `sheet` row is treated the same: it survives a folded turn (`isPersistentRow`), counts as work, and has its case in `model/serialize.ts`. It is not a mod site: the engine has no component of its own for this plugin tool's new input, so no adapter could hand a mod the shape it expects.

**Strings the composite fixes** (§8.1, §8): `q7 Auth method → OAuth`; "Dismissed"; "Withdrawn"; "Revised below"; "Open"; "Updated"; "from <agent>"; "Question waiting"; Send's label carrying the count; "changed since asked".

**Strings this child proposes**, the look's L6, each in `R/sheet/copy.ts` or `R/transcript/model/copy.ts`: the row's head line ("Asked 3 questions", "Asked a question", "Revised q3", "Withdrew q2"); "queued"; the queued card ("Queued. The session is stopped and gets this when it resumes.", "Take back", "Edit"); the accepted card ("Accepted. Not delivered yet."); the stale card ("The question changed before your answer arrived. Your draft is kept."); the notes ("q7 was already answered", "q7 was already dismissed", "q7 was withdrawn", "q7's answer was already delivered and cannot be taken back"); a row line that was refused ("Not asked"); the unavailable Send ("Answers cannot be sent from here: sminos was not found on this Mac."); a record this build cannot read ("This sheet was written by a newer sminos."); the empty side sheet ("No open questions").

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
| G2.g | of two windows answering the same question, the second reads that it was already answered (Acceptance 19) | M4 (stand-in), M6 (attempted live; see M6) |

## Plan of Work

Six milestones in two landings. M1 and M2 draw nothing and wait for no look. M3 draws on fixtures. M4 puts the sheet in the app without touching a transcript row, so it does not wait for #852; M5 is the only milestone that does. M6 is the live gate and the last milestone.

### M1 — The pin and the model

**At its end.** The set is in the tree at its merged revision with its provenance, and a test fails if one byte of it moves. MAWS computes, for every state the set holds, the same model sminos's own `show` prints. A stored call's entries and their ids, and a delivery's block, are read by pure functions that need no record. A reader lists the session of every record under a given home.

**Touches.** `test/fixtures/sheet/` (new); `.gitattributes` and the formatter's and linter's ignore lists; `src/shared/sheet/` (new: `model.ts`, `read.ts`, `call.ts`, `delivery.ts`, `words.ts`, their tests, `pin.test.ts`); `src/services/sheet/reader.ts` and its test (new).

**Interfaces.** Exposes §A, §B and `reader.ts` of §C. Consumes the set.

**Decisions.**

- Its first act is the pin: copy the set from the merge commit of doperpowers pull request #628, write `PROVENANCE.md` with the three values, then read the pinned README's "Readings fixed with the set" against §B to §D of this document and report every difference; the controller corrects those sections before M2 is dispatched. This document was written while the set's review was still changing it.
- Tests walk the directories of the pin; none lists the cases by name. A re-pin that adds a case is then covered without an edit, and one that removes a case fails nothing by accident.
- Each side of a fixture is a home (`<case>/before`, `<case>/after`, each holding `sheet/<session>/`), read in place: `readRecord(<side>, <case.json's session>)` is compared, as parsed JSON, with `show.before.json` or `show.after.json`; a side with no directory compares with `null`. The fixtures' referenced files exist on no machine, so `changedOf` runs for real and reads `true`.
- `grammar/result.examples.json` gives, for each stored call, `input`, `result` and `parsed`: `parseSheetResult(result)` equals `parsed`, and `callEntries` is asserted on the examples the composite names (the call that partly succeeded with an added and a revised entry and a refused one; the foreclosed call; the call whose outcome is not known).
- Each example's `envelope.txt`, and `terminal/steer.txt`, is parsed by `parseSheetDeliveries`: one block, as many keys as `answered` and `dismissed` have entries together.
- These tests use the pin's directories and temporary ones directly and never `sminosHome`, which refuses nothing here but would tie a pure test to an environment.

**Does not touch.** The renderer; the wire; any process; `src/services/spine-root.ts`.

**Proves.** G1.c; G1.d at the model. Its tests also pin: the manifest's digest three ways (§A); a list of records that skips `surfaces`, `.staging`, lock files and a directory with no `state.json`; a record whose `v` is not 1 reads `unreadable`; every cut counted in code points (the `imported-legacy` case holds a 2,001-character question and a 201-character label); a torn tail read to its last newline (`torn-tail`, `torn-tail-resent`).

**Gate.** Class 1a.

### M2 — The service: live reading, and the writer's call

**At its end.** With `mawsd` running, a record that appears, changes or goes under the sminos home is announced to every window within a second, and a window can read its model. Inbox lines a window sends are appended by the `sminos` command MAWS found, and their first states come back. A captured file's body and a pasted image make the round trip. A window's store holds the machine's summaries. Nothing is drawn.

**Touches.** `src/services/sheet/` (`service.ts`, `door.ts`, `locate.ts`, tests); `src/services/spine-root.ts`; `src/shared/ipc/schema/sheet.ts`, `names/sheet.ts`, `grades/sheet.ts`, their wiring in `schema.ts`, `names.ts`, `grades.ts`; `src/shared/ipc/wire.ts` and the pinned `wire-manifest.json`, `wire-fingerprint.json`, `routes.json`; `src/services/command-budgets.ts`; `R/stores/sheet.ts` and the place `connectLaneA` is called; `test/support/fake-sminos-cli.mjs` (new).

**Interfaces.** Exposes §C's service, §D, §E and §F but for the memory. Consumes M1's.

**Decisions.**

- S1 to S7. The handlers exist only where the spine runs, as lane A's do: a `mawsd` refused the spine has none, and a window's store then starts empty and stays so.
- The service asks the locator when a `put` first needs it and at `sheet.list`, not at start: a machine with no sminos pays nothing.
- The door's unit tests run the stand-in door through the same `execFile` path the real one takes; a test never reaches an installed sminos.
- The real door is checked by hand in this milestone (Concrete Steps), against a doperpowers checkout at the pin's merge commit, because the gate's runners have no sminos.

**Does not touch.** Any component; the attention list; the transcript; `apps/desk-web`.

**Proves.** No clause alone; it is what M4 stands on. Its tests pin: each exit of the door mapped to its `why`, with a timeout and unreadable output as `failed`; a call of more than fifty inbox lines, or of a line `lineError` refuses, answered `refused` with no process started; `by` stamped `maws` whatever the window sent; the locator's order, the probe's three outcomes, a proof made again when the path's modification time moves or a spawn fails, and only the named source under a test runner; a body asked by a hash no listed question names, or by a name with a path separator, answered `gone`; an upload written exclusively at mode 0600 and refused without a record; a record that appears, an inbox that grows, a record that goes, each announced once; a `busy` read tried again.

**Gate.** Class 1a; `e2e:lane-a` and `e2e:supervisor-daemon`, unchanged and green (the spine gained a part and the wire moved).

### M3 — The components (the composite's X5), on fixtures

**At its end.** The harness has a page (`#sheet`) that draws any state of the pin as a session's sheet, each card state of frame 2, and the overview, over a host that records what it is sent. The same components render inside desk-web's test project. A consumer can build on `R/sheet/` and `src/shared/sheet/` and nothing else.

**Touches.** `R/sheet/` (new: the five components, `host.ts`, `memory.ts`, `copy.ts`, `index.ts`, a fixture host under `test-support/`, tests); `eslint.config.js` (the boundary's block); `R/harness/` (the route and its reading of the pin's `show.*.json`); `apps/desk-web/src/sheet-import.test.tsx` (new).

**Interfaces.** Exposes §G. Consumes §B.

**Decisions.**

- Built to the look's answers, or to its defaults on the composite's writer's word ("The look").
- The components hold no state of the sheet: everything that must survive a tab's unmount is in the memory a consumer keeps, and `reconcile` is where the memory meets a new model. A component's own state is what dies with it rightly: which reference is open, which option has the pointer.
- The tests render under both renderer projects of `vitest.config.ts` (`renderer` and `renderer-compiled`, the React Compiler), as every component's do.

**Does not touch.** A store, the wire, the side column, the transcript, the attention list. Of desk-web, only the one new test: the `@source` line in `apps/desk-web/src/styles/app.css` is the consumer's, added by the child that first mounts a component there.

**Proves.** G1.a: a test walks every fixture directory of the pin and renders `SessionSheet` from each side that has a record, asserting one card per listed question in the model's order, one accepted card per pending outcome, and the hidden line; and renders `SheetOverview` from the summaries of every record. G1.b, each state from the pin and a memory: open (`answer-applied`, before); updated since seen (`answer-stale`'s model with a memory that saw revision 1 and holds a draft: the card reads "Updated" and the draft's text stands); queued (`stopped-queue`, before); accepted (`answer-applied`, after); refused as stale (`answer-stale`, after, with a memory whose act carries the fixture's key: the card is marked and the draft is back). Its tests also pin: Send's label is the count of questions with a draft answer; one Send calls `host.send` once with inbox lines for those questions only, each at the revision shown; a Send that fails keeps every draft and sends again under the same keys; `reconcile` over `closed-withdrawn` drops the withdrawn question's draft; a reference's body is asked for when it is opened and not before; the text field takes no image without `host.saveImage`; a note for a second answer (`two-surfaces`, after, with the memory's act carrying the second key) reads that the question was already answered.

**Gate.** Class 1a; `e2e:desk-web`, unchanged and green.

### M4 — The side sheet, the waiting card, the attention items

**At its end.** In the app, a terminal session that has a record reads "Question waiting" on its row, its tab and Needs you. Its "Waiting for you" card has one line per open question, "from <agent>" on a subagent's. Choosing a line shows the session's sheet in the side column at that question; nothing showed it before. The person answers and sends; the inbox lines go through the door as one call; what was sent reads queued, accepted or refused from the record. The Overview's card and the project channel's waiting card draw the same sheet in place. A call's questions make one notice.

**Touches.** `R/tools/sheet/` (new); `R/App.tsx`; `R/transcript/view/context.tsx` and the place the app's actions are composed; `R/stores/sheet.ts` (the memory); `src/shared/attention/sheet-item.ts` (new), `waiting.ts`, `kinds.ts`; `src/services/attention/service.ts`; `src/services/sheet/attention.ts` (new) and `src/services/spine-root.ts`; `R/request-card/WaitingCard.tsx`, `show-waiting.ts`; `src/main/attention/notifier.ts`; `R/overview/SessionCard.tsx`; `R/channel/Waiting.tsx`; `e2e/support/launch.ts`, `e2e/support/lane-a.ts`, `e2e/lane-a.spec.ts`; `docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md`; `docs/charter.md`.

**Interfaces.** Exposes §H. Consumes §C to §G.

**Decisions.**

- S10 to S16.
- An e2e case seeds a record by copying one side of a pinned fixture into the launch's sminos home, with the terminal session of `e2e/support/lane-a.ts` given the fixture's session id, and names the stand-in door through the launch's environment. A change of the record is the stand-in's replay of the fixture's `after`.
- A sheet item never makes a session read as waiting on the person in its digest: the digest counts the lane A list's stopping requests, which a sheet item is not in. A test pins it, since "calm state only" is the owner's ruling.
- **The record of what changed**, written in this milestone's landing as U1's "Rulings reversed" requires (each amended where it stands, dated). In `U1-requests.md`:
  - under l4-approvals-08: "Amended (the question sheet, §8.1 of `docs/doperpowers/specs/2026-11-23-question-sheet-design.md`; the owner's ruling of 2026-11-23): a question asked through the sheet form of the sminos tool has no form in its call's row and no card at the transcript's end. Its row shows one line per question with Open; it is answered in the side sheet, which the person opens; the waiting-requests card lists it, and its line opens the sheet at it. Every other request keeps this section's placement."
  - under O-17: "Amended (the same ruling): the side column gains the session's question sheet. It is shown only by the person: from a row's line, from a line of the waiting-requests card, from a notice's button, from the side column's own menu. It never opens, activates or closes by itself."
  - under O-22: "Amended (the same ruling): each open question of a sheet is an `async_input` item of its own, in this section's kind, words and tone. A notice fires once per call, in-app only for a terminal session."
  - M5 adds, under O-21: "Amended (the same ruling): a sheet question's receipt is its own line (`q7 Auth method → OAuth`, 'Dismissed', 'Withdrawn'), drawn from the transcript and, for what the transcript does not hold yet, from the sheet's record; a revised question's line stands in the row of the revising call and the earlier row reads 'Revised below'."
  - In the charter's §19, one dated entry: the placement its §13 X4 states, as U1b amended it, is amended again for a sheet question by the composite's §8.1, in the first sentence above.

**Does not touch.** The transcript's rows: until M5 a sheet call draws as master draws it, and M4 does not land alone. `ask-sheet`, MAWS's `ask`, the engine's question and today's sminos form. Lane A's driver and its bridge. A MAWS-run session's launch (C5). The endpoint's grades (C6).

**Proves.** G2.a, G2.d, G2.e, the card of G2.f, G2.g, each against the stand-in door, in `e2e:lane-a`: a record that appears and a question that is added leave the side column as it was; a card line shows the sheet at its question with the keyboard on that card; three drafts and one Send make one call of the door whose three inbox lines share a batch; a session with no live process lists its questions, and an answer given reads queued and is taken back; a record replaced by `closed-withdrawn`'s `after` loses the withdrawn question's card; two windows whose Sends are both in flight (the stand-in's delay) end with one applied and one note. Unit tests pin: the three placing functions skip a sheet item and `waitingRequests` keeps it; the notifier announces a call of eight once, a revise never, and a sheet item never to the system; the sheet list is not restored from the attention store; the Overview's card mounts one sheet a session.

**Gate.** Class 1a; `e2e:lane-a` with the new cases; `e2e:c7` (which runs `e2e/requests.spec.ts`), `e2e:panel` and `e2e:transcript`, unchanged and green; `e2e:desk-web`, unchanged and green.

### M5 — The row's lines and receipts

**At its end.** A sheet call's row is a quiet line with one line per question: its id, its header, its first sentence, and Open, which shows the side sheet at that question. After the outcome the line is the receipt. A question that was revised stands in the revising call's row and its earlier row reads "Revised below". All of it reads the same from a transcript with no record beside it, and the envelope that delivered an answer draws no bubble.

**Blocked by** board ticket #852 on master, beside M4: the row is drawn in that ticket's line model, and the two change the same files. M5 starts from a master that holds it.

**Touches.** `src/shared/engine/arrival.ts`, `arrival-schema.ts`; `R/transcript/model/` (`rows.ts`, `schema.ts`, `derive.ts`, `reduce.ts`, `serialize.ts`, `copy.ts`, `keys.ts`); `R/transcript/view/rows/Row.tsx` and `SheetRow.tsx` (new); `R/transcript/view/transcript.css`; new files under `test/snapshots/transcript/` and the synthetic transcripts they are made from; `R/harness/` (a sheet session among its fixtures); `e2e/lane-a.spec.ts`, `e2e/transcript.spec.ts`; `U1-requests.md` (O-21's sentence, above).

**Interfaces.** Exposes §I. Consumes §B's `call.ts`, `delivery.ts` and `words.ts`, §F and §H's `openSheet`.

**Decisions.**

- S8 and S9.
- The synthetic transcripts are made from the pin's stored calls (`grammar/result.examples.json` gives each call's input and result) and its envelopes, on the carriers C0 recorded (`spikes/protocol-probe/fixtures/qsheet/`, the rows of P5's block): the repository's rule is that a wire claim is checked against a fixture, and those are the fixtures that show how a hook's context and a plugin's prompt are stored. M6 adds one transcript recorded from a real session, scrubbed as `test/fixtures/lane-a/README.md` describes.
- No existing snapshot moves: a row of today's form is built by the same code as before, and `R/transcript/view/rows/question-receipt.test.tsx` passes unedited.
- Where the transcript and the record disagree about an outcome, the transcript's stands (§I's table): it is what the model was told.

**Does not touch.** How any other row is drawn; #852's own rules; `apps/desk-web`'s sources (it bundles the row and draws it with no Open, since its actions hold no `openSheet`).

**Proves.** G1.d drawn: the stored call that partly succeeded draws its lines with the right ids, the refused entry as not asked, with no record on the machine. G2.b and the row of G2.f against the stand-in. Its tests also pin: the ids of an eight-question call in the order of its entries; a call whose outcome is not known draws no id and no Open; a call the engine denied draws as an error; a revise moves the line and leaves "Revised below"; a delivery on each of the three carriers fills the receipt and draws no bubble; an envelope typed by a person fills nothing; a receipt reads the same from the block and from the record's `closed`; a subagent's transcript draws its own calls' rows; a `question` call of today's form is unchanged.

**Gate.** Class 1a; `e2e:transcript` and `e2e:lane-a` with the new cases; `e2e:c7` and `e2e:to-human`, unchanged and green; `e2e:desk-web`, unchanged and green.

### M6 — Live on a Mac, the built look, the record

**At its end.** G2 is seen with a real terminal session, a real model and the real `sminos`, on a Mac. The pictures of the built surfaces are with the composite's writer. What was accepted as a limit is in the tracker.

**Blocked by** C2.G2 merged in doperpowers (the tool's sheet form in a terminal session), beside M5.

**Touches.** `e2e/words-shots.rig.ts` and `docs/doperpowers/specs/2026-11-16-word-cut/scenes.md` (the sheet's scenes); one recorded transcript under `test/fixtures/`; `docs/tech-debt-tracker.md`; this document's Progress and Outcomes.

**Decisions.**

- The session takes the sheet by the setting and C2's stand-in surface (S17). The `sminos` MAWS runs is the one the session's plugin is: where the merged sminos is not yet the installed plugin, `MAWS_SMINOS_CLI` names the checkout's `sminos/bin/sminos`.
- G2.g live: the two Sends must be in flight together, which a hand may not hit in the fraction of a second the record takes to move. It is attempted three times; if none lands in the gap, the clause stands on M4's e2e case and that is said in the report (the last section proposes the clause's wording).
- Limits logged in `docs/tech-debt-tracker.md`, one row each: an image pasted and never sent stays in the record until the record is removed; "changed since asked" is as old as the last read of the model; a window on another machine lists a sheet item it cannot answer until C6.

**Does not touch.** Anything a milestone before it built, but for a fault the live run finds, which is fixed where it lives and reported.

**Proves.** G2.a to G2.g, by the steps quoted under Concrete Steps, in addition to the gates of M4 and M5 on the landing's head.

**Gate.** Class 1a; `e2e:lane-a`, `e2e:transcript`, `e2e:c7`, `e2e:panel`, `e2e:to-human`, `e2e:desk-web` on the landing's head; the live steps by hand.

## Concrete Steps

All from the worktree's root. A gate tests the committed head; while iterating, one focused file may be run on the machine (`pnpm exec vitest run <path>`).

**M1.** With a doperpowers checkout at the merge commit of pull request #628:

    rm -rf test/fixtures/sheet/set && mkdir -p test/fixtures/sheet
    cp -R <doperpowers>/sminos/types/sheet test/fixtures/sheet/set
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

1. Start the stand-in surface, `<doperpowers>/sminos/tests/sheet_surface.py`, as C2's own Concrete Steps start it. Start a terminal session in a scratch project with the setting on: `SMINOS_QUESTION_SHEET=1 claude`.
2. Ask it: "Put three questions to me on your sheet in one call: one with two options and a recommendation, one that references README.md, one with no options. Then keep working: list this directory." The terminal shows `3 open questions`.
3. In MAWS, open nothing. The session's row and tab read "Question waiting"; the side column is as it was (G2.a). In the session's transcript the call's row has three lines, `q1` to `q3` (G2.b).
4. Press Open on `q2`: the side column shows the sheet with the keyboard on `q2`'s card, and its file opens to README.md as captured (G2.b).
5. Answer all three, one with a pick and typed text, and press "Send 3". The agent quotes the three answers in one message, at its next tool result or at once when idle (G2.c, G2.d); the three row lines are receipts, the first reading `q1 <header> → <label>` (G2.b); the cards are gone.
6. Ask the agent to put two more questions and then withdraw the first of them. That question's card disappears and its row line reads "Withdrawn" (G2.f).
7. Close the terminal. The session, now stopped, still lists its open question in its "Waiting for you" card and its sheet; answer it: the card reads queued, with take back (G2.e). Resume the session in the terminal and send it any message: the answer goes with it, and the row line becomes the receipt.
8. With a second window on the same session and a new question open, press Send in both windows together (G2.g; the decision under M6).
9. `WORDS_ONLY=<the sheet's scenes> pnpm shots:words` with `WORDS_OUT` outside the repository; hand the pictures to the composite's writer.

## Outcomes & Retrospective

Pending — written at finish.

## For the composite's writer

State, like Progress. Three lists: the sentences of the composite, as it stands at `635073ce9`, that this document makes false or incomplete, each with the replacement proposed; what needs the owner; what the `ux-wave` session should be told. An advisory sentence this child overturns is this document's text from now on; a binding one stands until the writer rules.

**Sentences.**

1. X2, "Whether MAWS calls the command or the same code over the sminos daemon's socket is settled by C2 and C3 and recorded here. C2's side (2026-11-23), which waits on C3's agreement: …"; and C3's Design inheritance, "whether MAWS reaches the writer through the `sminos` command or the sminos daemon's socket (`src/endpoint/rl10/`): C2 and C3 settle it between them and record it under X2". Proposed, in X2: "Settled by C2 and C3 (2026-11-23): MAWS runs the command, inbox lines on standard input and one JSON object of results on standard output; nothing is served over the daemon's socket. MAWS finds the command by, in order, a path named in `MAWS_SMINOS_CLI`, the installed sminos plugin's `bin/sminos` (read from the engine's plugin registry) and `sminos` on the login shell's `PATH`; runs it with the login shell's environment and `SMINOS_HOME` set to the home its reader reads; and proves a found command once by `sminos sheet show` of a session that has no sheet, whose exit 3 it takes as the proof." This makes that exit, and the door's exits 0, 2, 3 and 75, part of what X2 freezes. Reasons: S1 and S2.
2. C3's Design inheritance, "where the reader runs (`mawsd`'s spine, beside the terminal-session driver in `src/services/lane-a/`)" [advisory]. Taken as leaned; proposed as fact: "the reader runs on `mawsd`'s spine, in `src/services/sheet/`, and reads every record under the sminos home whichever kind of session wrote it; C4's page server and C5 call it and add no reader."
3. X5, "The question card, the session's sheet and the overview, over one model of a sheet read from X1, importable from MAWS's renderer by the page and by desk-web." Proposed: "X5 is two directories. `src/shared/sheet/` holds the model's types, the reader's computation, the parsers of X7's first line and of X3's block, and the builder of a Send's inbox lines. `src/renderer/src/sheet/` holds the card, the card of an accepted outcome, the session's sheet, the overview and the reference viewer; they take a model, the surface's memory and a host (send, a file's body, an optional image save) as props, and import no store, no IPC and nothing of Electron, which a lint rule holds. Not part of it: the reader's file access, the door and the locator (`src/services/sheet/`), which C4 calls inside `mawsd` and C6 reaches remotely; the window's store; the side column's tool; the transcript's row."
4. C3's Acceptance, G1, "a stored call that partly succeeded draws its row's lines with the right ids and no sheet directory", with C4's Edges, "blocked-by: C2.G2, C3.G1", and the map's `C3.G1 ──► C4`. The row is drawn within #852's line model and so in the one milestone that waits for that ticket; nothing C4 imports does. Proposed, in C3's Edges: "blocked-by: C2.G1 for G1; C2.G2 for G2; board ticket #852 on master for the row's drawing (G1's last clause, and G2)". In C4's: "blocked-by: C2.G2 and C3's first landing (the pin, the reader, the service, the components: G1 but for the row's drawing)".
5. C3's Acceptance, G2, "for a terminal session on this machine with the sheet on". A terminal session takes the sheet only with a live surface registration (§7), which C4 writes, and C4 follows C3. Proposed: "with the sheet on (the setting, and C2's stand-in surface registered, as in C2.G2, until C4's page registers itself)".
6. C3's Acceptance, G2, "of two windows answering the same question, the second reads that it was already answered (Acceptance 19)". A second window can answer a question only in the gap before the first answer moves the record: once it has, the card is gone (a running session) or shows the first window's queued answer, which the second window edits (a stopped one). Proposed: "of two windows whose Sends for one question are in flight together, the second reads that it was already answered (Acceptance 19), shown by a test that holds both in flight". Acceptance 19 itself stands; at recomposition its first half is easier to show with the command line as one of the two surfaces.
7. §8.1, "A notification fires once per call, not once per question." Incomplete: it does not say which notification a terminal session's question makes, and U1's O-22 keeps a terminal session's requests out of macOS notifications. Proposed: "A notice fires once per call, not once per question, and a revise fires none. For a terminal session it is the in-app notice only, as for every request of a terminal session (U1's O-22)."
8. §8.1, "Every open question is a calm "Question waiting" item". Incomplete for a question that carries a queued answer, and for a stopped session. Proposed: "Every open question that has no queued answer is a calm "Question waiting" item …, also while its session is stopped." The second half is the look's L5 and waits on the owner.
9. §8.1, "The Overview and the project channel's waiting cards mount the same sheet component in place where they answer in place today." Those places mount one request card an item. Proposed: "… mount the session's sheet in place, once a session, in a compact form: each card folded to its line until chosen."
10. §4.3, "from which a row's receipt or "Withdrawn" is drawn while the record lives", with §8.1's second bullet. S8: the transcript is the base. Proposed, in §8.1: "A row is drawn from the transcript alone (the call's input, its result's first line, later calls and the deliveries' blocks), so it reads the same after a reload, in a subagent's transcript and when the record is gone. The record adds what no transcript holds yet: that a question is open, an answer accepted or queued." And in §4.3: "… from which a row line reads an outcome the transcript does not hold yet".
11. §8, "A card whose question was rewritten since the human last saw it says "Updated" and keeps the draft", and "Drafts are kept per question in the surface's memory". Proposed additions: "A draft's text and images are kept across a rewrite, and its picks where they are still labels of the new revision. "Updated" stands until the person touches the card." And: "An answer refused as stale puts its draft back on the card, which says so; an answer that came second, or a retract that came too late, is said in a note on the sheet."
12. §8.1's list says nothing of the jump button ("Needs your input", U1's l2-transcript-10), which reads the same list as the "Waiting for you" card. Proposed, pending the owner (L4): "An open sheet question does not raise the jump button: that button leads to a form in the transcript, and a sheet question has none."
13. C5's section. MAWS's launch environment does not pass `SMINOS_HOME` or `DAEMON_HOME` to an engine it starts (`ALLOWED_KEYS` and `ALLOWED_PREFIXES` in `src/engine-host/launch.ts`), while MAWS's reader resolves the home from `mawsd`'s environment and then the login shell's (`sminosHome`). Where the owner exports `SMINOS_HOME`, a MAWS-run session's record would be written under the default home and read under the exported one. Proposed, among C5's acceptance: "a MAWS-run session's sminos writes its record under the home MAWS's reader reads (the launch names it)".
14. The header's "Amends: the UX wave's U1 (… sections l4-approvals-08, O-17, O-21, O-22)". This child writes the amending sentences into those four sections (their text is under M4), and one dated entry in the charter's §19 for its §13 X4. If the writer would rather word the charter's entry, say so before C3b lands.
15. C3's Status, and the Tracking Map's row. Proposed: "in-flight: its execution document is written (branch `question-sheet-c3`); the look's drawn example is owed to the owner; M1 waits on doperpowers pull request #628's merge." The set was still changing under its review when this document was written (a closed question's `places`, among others); M1 takes it as merged.

**For the owner, through you.**

1. **The look.** A drawn example of the six frames under "The look", with the cards L1 to L6 and their recommended defaults. M3 and everything after it wait for the answers, or for your word to build the defaults.
2. **L4, the jump button.** Recommended: an open sheet question does not raise "Needs your input".
3. **L5, a stopped session's questions.** Recommended: they are items like any other, so the session is listed in Needs you and counted in the dock badge until they are answered or dismissed. The cost: a sheet left alone for days keeps its session in Needs you, and the badge counts each open question, since it counts `async_input` items today. The alternative is to show a stopped session's questions only in its own pane.
4. **Whether a milestone waits for a look.** The UX wave's ruling of 2026-11-15 let none wait. For a surface that is new as a whole, the recommendation is that M3 waits for frames 1, 2 and 5, and M5 for frame 3; M1 and M2 start at the pin.

**For the `ux-wave` session, through you.**

1. This child draws a sheet call's row within #852's line model and its row milestone (M5) starts from a master that holds #852. Please say when it merges.
2. M5 touches files #852 touches: `model/rows.ts` and `model/schema.ts` (a new row kind, `sheet`), `model/derive.ts` (`isPersistentRow` and the place a `question` call is resolved), `view/rows/Row.tsx`, `view/transcript.css`, new files under `test/snapshots/transcript/`, and M6 adds scenes to `e2e/words-shots.rig.ts`, whose launch count #852 moves.
3. The row will use #852's quiet-line vocabulary: the run line's classes, the 12 px glyph slot, the 19 px indent, and `GroupRow`'s `renderBody` if a non-tool row may use it. Please say if any of these is still moving, or if `renderBody` is meant for a run of one only.
4. #852 leaves the `question` and `ask` rows bordered. This child does not restyle them: the sheet's row is a new kind, and today's rows stay as they are until C7 retires `ask`. If the wave means to restyle those rows too, the two should agree on who does.
5. This child's first landing adds an IPC namespace, `sheet.*`, and so moves `WIRE_MINOR` and regenerates the pinned wire manifest, fingerprint and routes. `ux-wave/prestart-engine` and `ux-wave/subagent-tell` change the same pinned files; whichever lands later regenerates them.
6. Nothing here fixes a launch's shape: `MAWS_QUESTION_SHEET` and the launch key #851 asked about are C5's.
