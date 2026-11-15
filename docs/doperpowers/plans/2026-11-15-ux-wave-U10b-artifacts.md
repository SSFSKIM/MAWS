# UX wave · U10, second landing (U10b): the rest of the artifacts work, in four pull requests

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U10, second landing (**U10b**). **Parent pin:** master `93905c9effbda94ead21518439800f8bcbd72d24`, the commit every statement about the code below was checked against; the root, the child's file and the register are read at that commit.
>
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U10-artifacts.md`, cited below as *section*: its parts l6-artifacts-07 (b) and (c), O-43, l6-artifacts-08, l6-artifacts-15, l6-artifacts-18 and l8-settings-13, with the acceptance items A3 to A10, the Design inheritance, the checks under "Probes and checks" that are not marked done, and "Rulings reversed". This document carries the constraints, the milestones, the interfaces and what the section leaves open, and nothing else of the design. Where the code at the pin contradicts the section, "Where the section no longer holds" says so and gives the default built; the architect rules, and a ruling changes the one place each row names.
>
> **Revision 2 (2026-11-15).** The adversarial review of the first writing (`56e90d508`) returned seven findings; the architect accepted all seven and ruled on the points the first writing reported, and the six drawn pages of "The look" are back with rulings of their own (L1 to L7; B1 to B10; R1 to R5; M1, M2). What moved: an agent may delete an artifact only while the store holds a mark that this build wrote at the agent's create and kept in step with every write since (§C.1); a deleted artifact takes no content, and an editor open on it shows the deletion with Undo (§C.5); U10b-1 owes both exact peers; U10b-3 lands after U1b; an export after a page change fails rather than print the old page; the export's page takes the editor's spacing (§B.4); the component canvas is chosen per component (M11). The Decision Log has a line for each ruling.
>
> **Branches:** this document is on `ux-wave/U10b`. Each of the four pull requests is built on a branch of its own from master, `ux-wave/U10b-1` to `ux-wave/U10b-4`, with this document merged in. **Board:** ticket 595, under epic 573. **Items:** l6-artifacts-07 (b), l6-artifacts-07 (c), l6-artifacts-18, O-43, l6-artifacts-08, l8-settings-13, l6-artifacts-15. **Not in this landing:** see "The landing's edge".

## Purpose

An agent that works on artifacts in MAWS still hands four chores to the person. It cannot make a memo fit one page, because the page a document prints on is chosen per export and nothing says how many pages came out. It retypes a whole HTML page to publish a new version, and can never get the page back as a file. It cannot remove a draft it abandoned. And it cannot be told how work in a Space should be done, or which design system the person picked for a new artifact.

On the person's side, the chat that floats over an artifact still carries a title row and a row of controls under the box, and cannot be put away; "Make something new" on the Library page is seven cards with thirteen buttons; and a design system's page draws its components at a fifth of their size.

After the four pull requests of this landing:

1. **The agent's documents and pages (U10b-1).** The agent sets a document's page (Letter or A4, compact density) with one op of the edit tool and reads from a PDF export how many pages it has. The person sees the same setting as checked items in the document's Export menu, and their own export uses it. The agent publishes an HTML page by naming the file it wrote, and exports the page back as the same bytes; the person has "Save a copy…" on an HTML artifact.
2. **A draft the agent can take back (U10b-2).** The agent deletes an artifact its own session made and no person wrote to. The transcript shows "Deleted <title>" with Undo; Undo brings it back, also on another machine's library. A deleted artifact takes no further edit, and an editor that was open on it says so and offers the same Undo.
3. **The chat over an artifact (U10b-3).** After Expand, only the composer's box floats at the lower right, with two small buttons. One opens the conversation; the other hides the chat, and the header of what it floated over then shows "Show chat".
4. **The Library (U10b-4).** "Make something new" is four cards that each start a chat, a More menu, and one design-system choice that the agent's `artifact_create` can honour. A Space carries instructions for agents, written from its menu, which reach an agent as a chip in the draft or in the artifact tools' answers. A design system's page shows its largest type sample whole and its components at up to twice today's size.

**How to see it working**, on the wave's build, in a session MAWS runs. Ask for a one-page memo: the agent's edit holds `set_page`, its PDF export answers `pages: 1`, and the document's Export menu shows "Compact" checked. Ask it to rebuild an HTML page: the publish call's input holds a path. Ask it to delete the draft it just made: the transcript reads "Deleted Draft" with Undo, and Undo puts the draft back in the Library. Open a document beside the chat and press Expand: only the box is left; press its Hide chat button and "Show chat" appears in the document's header. On the Library page, pick a design system in the heading of "Make something new" and click Document: a new chat opens with the opening words in its box.

## Progress

- [x] (2026-11-15) Document written against master `93905c9ef`: every "Today" statement of the seven items checked in the code, the two builds a trial can meet read at their commits (`2c7044231`, `f1852de3a`), the Claude Desktop citations of the section read again in `app-5.1231.2`. Twenty-eight places where the section no longer holds or leaves a choice open, each with the default built. (First writing, `56e90d508`.)
- [x] (2026-11-15) The adversarial review of the document (seven findings, all accepted) and the architect's rulings on "Where the section no longer holds".
- [x] (2026-11-15) The six pages of "The look" drawn, printed and measured, the memo redrawn on the export as ruled; the architect's rulings on what they found (L1 to L7; B1 to B10; R1 to R5; M1, M2).
- [x] (2026-11-15) Revision 2: the review's rulings and the drawn pages' rulings folded in (Decision Log).
- [ ] The owner's answers to the eight cards, before M3, M5, M7, M8, M9 and M11 are built; each milestone builds the card's first option until then.
- [ ] M1 — An HTML page is published from a file and exported as itself.
- [ ] M2 — A document's page is a setting of the document, and an export says how many pages it has.
- [ ] M3 — The person's Export menu shows the page, and the scenes of U10b-1.
- [ ] M4 — The agent deletes its own draft, the delete can be undone, and a deleted artifact takes no content.
- [ ] M5 — The transcript's row for a delete, the editor's notice, their Undo, and the scenes of U10b-2.
- [ ] M6 — The float has three presentations.
- [ ] M7 — The bar and "Show chat" are drawn, and the scenes of U10b-3.
- [ ] M8 — "Make something new": four cards, More, and a design-system choice that binds.
- [ ] M9 — A Space carries instructions: the store, the sheet, the mark and the chip.
- [ ] M10 — The artifact tools give a Space's instructions.
- [ ] M11 — The design system's page, and the scenes and the record of U10b-4.
- [ ] Per pull request: the proofs an executor does not run ("Proof that an executor does not run").

## The cut: four pull requests

The landing is about 9,100 changed lines over about 175 files, in four areas, and its parts wait on different things: U10b-1 on the owner's look at a memo, U10b-3 on the look at the bar and on U1b, U10b-4 on the look at the component cards. One pull request of that size cannot be read in one pass. So it is four pull requests, each of which leaves master releasable. U10b-1, U10b-2 and U10b-4 need none of the others; U10b-3 lands only after U1b is on master (below). Rejected: one pull request, which no reviewer reads in one pass; two (the tools, the window), which would tie the Library to the float and the delete's offer over the machine link to the page setting.

| pull request | branch | items | milestones | what the owner gets | what it stores or sends that is new | waits for |
|---|---|---|---|---|---|---|
| **U10b-1** | `ux-wave/U10b-1` | l6-artifacts-18, l6-artifacts-07 (b) | M1, M2, M3 | An agent can make a memo fit a page and say how many pages it is; a PDF is spaced as the editor shows the document; the Export menu shows the page; an agent publishes an HTML page from its file; "Save a copy…" on an HTML artifact | one attribute in a document's content (`page`); no command, no wire minor | the owner's look at a memo at two densities, before it lands |
| **U10b-2** | `ux-wave/U10b-2` | l6-artifacts-07 (c) | M4, M5 | An agent removes its own abandoned draft; "Deleted <title>" with Undo in the transcript and in an editor open on it; a deleted artifact takes no edit | one command (`artifacts.undelete`), one key per agent-made artifact in the store's `meta`, one optional property in `artifacts.get`'s answer, one capability over the machine link; a wire minor and a link minor | nothing |
| **U10b-3** | `ux-wave/U10b-3` | O-43 | M6, M7 | Over an artifact the chat is the box alone and can be hidden; "Show chat" in the header | nothing | **U1b on master**; the owner's look at the bar |
| **U10b-4** | `ux-wave/U10b-4` | l6-artifacts-08, l8-settings-13, l6-artifacts-15 | M8, M9, M10, M11 | Four cards and one design-system choice; a Space's instructions; component cards at a readable size | two commands, one key in the store's `meta`; a wire minor | the owner's look at the component cards on a Mac, before it lands |

**U10b-3 and U1b** (ruled 2026-11-15). U1b removes a request's dock from the composer and draws the line "Waiting for you · N" in the compact pane. Without it, "Show chat" on a hidden chat whose session has a request waiting would mount a full docked request in the bar's place. So U10b-3 may be built in parallel against master, and it lands after U1b: before it lands, the combined scene of A6 runs on a head that holds both. No second, temporary drawing of a request is built.

**Files more than one of the four edits.** Each later pull request merges master first, and its milestone's executor reads the earlier one's change before editing.

| file | pull requests |
|---|---|
| `src/shared/maws/tools.ts`, `tools.test.ts`, the probe snapshot `spikes/protocol-probe/scenarios/pass3/p4-maws-tools.json` | U10b-1, U10b-2, U10b-4 |
| `src/shared/maws/document-tools.ts`, `src/engine-host/tool-server/documents.ts`, `artifact-tools.ts` | U10b-1, U10b-4 |
| `src/engine-host/documents/store.ts`, `register.ts`, `src/shared/ipc/wire.ts`, `wire-manifest.json` | U10b-2, U10b-4 |
| `src/renderer/src/panel/PanelHeader.tsx` (the document header's menu; the side column's controls) | U10b-1, U10b-3 |
| `src/renderer/src/library/` (`export.ts`, `RowMenu.tsx` in U10b-1; `actions.ts`, `ArtifactTab.tsx` in U10b-2; the section and the Space's sheet in U10b-4) and `Library.test.tsx` | U10b-1, U10b-2, U10b-4 |
| `e2e/cross-build.spec.ts`, `e2e/library.spec.ts`, `e2e/maws-tools.spec.ts` | U10b-1, U10b-2, U10b-4 |
| `docs/charter.md` (X9's dated lines), `docs/tech-debt-tracker.md` | U10b-1, U10b-2, U10b-4 |

Order: U10b-1, U10b-2 and U10b-4 in any order; U10b-3 after U1b. Two of them move `WIRE_MINOR`; each takes the next number above whatever master holds at its own merge.

## The landing's edge

**In.** A3 to A10 of the section, with the three keep items of A9 held by tests. The dated amendments of the rulings its items reverse, each in the pull request that reverses it ("The pull requests").

**Already done, nothing to build.**

- A1 and A2 (U10a, pull request 618).
- A11, the caret under a final chart: the three gap-caret scenes of `e2e/dashboard.spec.ts` ran green on the Mac lane on U10a's branch after its fix round, as pull request 618's body records. Whether the owner has looked at the screenshot of the caret is not recorded in the repository; it is U10a's look, listed under "What was not verified".
- l6-artifacts-14 (a first letter lost while typing Korean). The section has it wait for a question "asked when this child starts". The register records the question as asked and answered on 2026-11-14 ("No, never seen it"), and the tracker's row was removed that day by commit `22f9476fd`. Nothing is asked and nothing is built. The related tracker row on the input method's attach delay (the row of 2026-10-22, "Two input-method behaviours …") stays as it is.

**Out.** Each is the section's "Waiting" or "Not included", or another child's.

- The rest of l6-artifacts-09 (the short `since` in `artifact_read`, a deck's text box binding read-only, the rows the editor's binding writes at first sync), after U14's reproduction. l6-artifacts-16 (the design-law check). l6-artifacts-11 (a next step after a deliverable).
- A paginated editor; margins, orientation or columns as settings; a page setting for a dashboard, a deck or a design.
- Hard deletion; an Undo for the person's own delete in the Library; a "Recently deleted" view.
- A header row repeated when a table splits across pages (a tracker row).
- Remembering the bar or the hidden chat across a relaunch; resizing or moving the bar; the chip a Browser surface draws in its tab row for a closed card; a chord for Show chat.
- Composer chips for a design system; a card for motion; "Make something new" on another machine's library; a Space's instructions edited from another machine.
- Reader controls in the dashboard kind.
- The register, the board and the closing of tracker rows, which the sessions that keep them update at landing.

## Words used here

- **The float:** a session's conversation drawn over what is beside it (`src/renderer/src/shell/`): over the other pane of a split in the main area ("the split's card"), or over a side surface that has taken the main area's place ("the panel's card"). Its **presentation** is one of **card** (the whole conversation), **bar** (the composer's box alone; in code today "the pill") and **hidden**.
- **The settings node:** the root `meta` of a document's shared content (`src/artifacts/document/meta.ts`), a keyed node beside `tabs` and `threads`. Today it holds one attribute, `dsOverrides`.
- **The store:** the artifact store, `<userData>/artifacts/store.sqlite`, opened by the engine host alone (`src/engine-host/documents/`). Its **`meta` table** is a key-value table of host-held values, read by key.
- **The machine link, an offer, a capability:** as in the root. `OFFERS` in `src/endpoint/offers.ts` is the table of what a machine accepts over the link; a capability is a string a machine's handshake lists (`src/endpoint/capabilities.ts`), which a device checks before it sends something an older machine would not know.
- **The two older builds:** `2c7044231` (the build in use) and `f1852de3a` (build F, kept to go back to). "Both older builds" means these two; each statement about them was read with `git show <sha>:<path>`.
- **The lineage:** `lineageOf(ctx, deps)` in `src/engine-host/tool-server/artifact-context.ts`: the calling session, then the sessions a side thread was opened from, nearest first.

## Landings in flight: what this document assumes of each

One list, checked again by the executor of the milestone named, at its merge of master, whichever side lands first. An assumption that no longer holds stops that milestone and goes back to the architect.

| landing | branch | what is assumed | who checks, when |
|---|---|---|---|
| **U1b** (requests drawn in the transcript) | `origin/ux-wave/U1b` | **U10b-3 lands after it** (ruled 2026-11-15). (1) Its line "Waiting for you · N" is drawn by `SessionPane` in its `compact` branch, above the composer, and calls `openCard` from `shell/floating.ts` (its decision 19). U10b-3 keeps mounting `SessionPane` with `compact` inside the bar and keeps `openCard`'s name and meaning, so the line shows in the bar with no edit on either side. (2) It removes the request's dock from the composer, so nothing of a request is drawn in the bar's box. M7's last step is the combined scene on a head that holds both: a request arrives while the chat is hidden, Show chat, the bar's line, Open conversation. (3) It edits `transcript/model/derive.ts`, `rows.ts`, `schema.ts`, `copy.ts` and `serialize.ts`; M5 edits the same files at the `artifact` row only. (4) It edits `e2e/cross-build.spec.ts`; M3, M5 and M11 append scenes there. (5) It does not edit `shell/floating.ts` or `shell/FloatingPill.tsx` (its UC-8 table says none). (6) It edits `composer/Composer.tsx` where the dock is derived; M7's lines there are the bar's read, the registered `draftShown`, the dictation notice and `PluginHint`. | M7 (which does not finish before U1b is on master) and M5 |
| **U2b** (the to-human view) | `origin/ux-wave/U2b` | (1) It removes the `ReportBar` mount from `SessionPane.tsx` and mounts its switch in `Composer.tsx` directly after `PluginBand`; M7's lines in `Composer.tsx` are at the `Frame` call, the dictation notice and `PluginHint`, not there. (2) `isPersistentRow` keeps `artifact` rows in view through a fold, in MAWS's own folds and in the mirrored view, so the delete row stays where the owner learns of the delete. | M7 and M5 |
| **U6b-1** (a file opens beside the chat) | `origin/ux-wave/U6b` | (1) It adds one line to `TOOL_ERRORS` in `src/shared/maws/tools.ts` and a case in `tools.test.ts`; M1, M4 and M8 edit the same two files elsewhere. (2) It edits `panel/TabStrip.tsx`, `panel/host.ts` and `panel/SurfaceRow.tsx`, not `RegionControls` in `panel/PanelHeader.tsx`, where M7 inserts. (3) Whether a file's main tab has a header row is read at run time by M7's rule (`useEditorHostRegistration`), so a header it adds to a tab makes Hide chat offered there with no edit. | M7, M1, M4, M8 |
| **U6e** (outside files editable, Open File…) | `origin/ux-wave/U6e` | It edits the files service and `src/services/library/store.ts` and shares no file with this landing. M4's undelete announces `created`, which main's library sync already reads as a refresh. | M4 |
| **U11c** (Customize) | `origin/ux-wave/U11c` | A document only at this writing. Assumed to touch nothing under `library/`, `shell/`, `composer/frame/` or `src/artifacts/`. | M8 |
| any landing that moves `WIRE_MINOR` or `RL2_PROTOCOL.minor` | — | M4 and M9 each take the next free number at their merge, and regenerate `src/shared/ipc/wire-manifest.json`. | M4, M9 |

## Where the section no longer holds

Checked at the pin. "Default" is what this document builds unless the architect rules otherwise; "place" is the one place a different ruling changes. The first twelve change what the owner or an agent meets and were put to the architect; each is ruled (2026-11-15, the Decision Log), and the default written here is the ruling unless the row says otherwise. The rest are corrections of fact.

| # | the section says | what the code holds | default built | place |
|---|---|---|---|---|
| H1 | Undo is "a call `artifacts.restore` beside today's `artifacts.delete`" | `artifacts.restore` exists and restores a *version* (`{artifactId, versionId}`, `src/shared/ipc/schema/artifacts.ts`; graded, offered over the link, in `ARTIFACT_OP_COMMANDS`, used by the history rail). Making `versionId` optional is a wire major by `src/shared/ipc/wire.ts`'s rule | a new command, `artifacts.undelete {artifactId}` | §C.2 |
| H2 | "A Space gains `instructions`" (the entity, the `spaces` table) | A fifth entry in `STORE_MIGRATIONS` makes both older builds open the artifact store read-only and refuse every write with `storeTooNew` (`openStore` in `src/engine-host/documents/migrations.ts`, identical at `2c7044231` and `f1852de3a`). `SpaceSchema` is a strict object, and `library.spaces` answers every Space, uncut, to any member who can list the machine | the text is held in the store's `meta` table under one key, read and written by two commands of its own that are not offered over the link; `SpaceSchema`, the table and `library.spaces` do not change | §E.1 |
| H3 | the agent may delete an artifact "that no person has written to" | Nothing stored says so durably. The log loses it: a person's row is pruned after seven days once a later write follows. The client bindings never had it for a deletion alone (no client is bound) or for an accepted suggestion (the copy is bound to the suggester). And rows credited to the person exist that are not their edits: a design's migration at an open, a deck's rows when a text box is selected (the open half of l6-artifacts-09), the clean-up an editor of an older build sends | (ruled 2026-11-15, F1) the delete rests on a mark the store keeps per agent-made artifact, which any person's write, and any write the mark did not account for, breaks for good; no mark, no delete. A deck or a design the owner only opened is still refused ("the user has edited it"): the safe side, one tracker row, ending with the rest of l6-artifacts-09 | §C.1 |
| H4 | Undo is "sent to that machine as the Library page's own acts are" | The route carries a new name only after six insertions (§C.3). And the endpoint cannot place a deleted artifact for a member who does not own the machine: `placeArtifact` reads the library entry, which is null once `deletedAt` is set, so the act would be refused `grade` | over the link the act is the machine's owners', as Fork is (`owners: true` on its row); a member who does not own the machine sees Undo disabled with "Only <machine>’s owners can restore an artifact there." | §C.3 |
| H5 | "annotated as destructive" | No `maws` tool carries `destructiveHint`; the annotation types admit `readOnlyHint` and `openWorldHint` only; nothing recorded shows what the engine does with the hint | the hint is added (`destructiveHint: true`); nothing is claimed from it and no code of MAWS depends on the engine reading it; no probe (ruled 2026-11-15) | §C.1 |
| H6 | `set_page` is "atomic with the batch it is in" | `applyEdit` opens no transaction when a plan touches no block, so a batch of `set_page` alone would write nothing. And a batch that lands as suggestions (`mode: 'suggest'`, or the owner's "agent edits as suggestions") writes into the suggestion document, whose settings node nothing carries over at an accept | the plan gains the page, and a batch that sets only the page writes one row. A batch that would land as suggestions and holds `set_page` is refused whole, with a sentence | §B.2 |
| H7 | the export's page is "the size named in the `artifact_export` call; the document's; the design system's; Letter" | The document header's six rows each send a size, Markdown and Web page included, so the person's export never reaches the second step | the four format rows send no size; the three page items write the document's setting | §B.5 |
| H8 | "Not included: … page settings for other kinds" | A dashboard shares the document's header, edit tool, read tool, export source and exporters | `set_page` is refused for a dashboard, `page` is answered for a document only, and a dashboard's Export menu keeps today's six rows | §B.2, §B.5 |
| H9 | `artifact_export` accepts `html` for an HTML artifact, and the Export menus gain "Save a copy…" | `html` is already in `ARTIFACT_EXPORT_FORMATS`; the menus list whatever the registry serves for the kind, so registering the exporter also adds an "HTML" row beside "Save a copy…": two rows for the same bytes | the person's menus leave the `html` format out for an HTML artifact and show "Save a copy…", which also works against a machine of an older build | §A.3 |
| H10 | the design-system choice "applies to the kinds a design system governs (document, presentation, design)" | A dashboard is given the governing system's guide at its create (`documentCreateTool`) and is themed by it at export (`src/artifacts/dashboard/export.ts`); all four cards are therefore governed kinds | `designSystem` is accepted for document, presentation, design and dashboard, and the choice applies to all four cards | §D.1, `DESIGN_SYSTEM_KINDS` |
| H11 | in the bar "nothing under the box" | The composer draws a plugin's hint under its frame (`PluginHint`), which is a mod's drawing (law 2). The three chords that open the toolbar's menus ask a predicate the composer registers (`draftShown`), which knows a docked card and not the bar | the hint is not drawn in the bar; the plugin's band above the frame is. The bar joins the predicate the chords ask, so they change no menu state and run no open callback (ruled 2026-11-15, F5) | §F.3 |
| H12 | "the float changing to another session's shows the card, as today" | For the float over a side surface the card is one card that follows the session in front (`floatIdentity` answers `'panel'`), and its closed state is kept when another session's tab comes in front. The section's "as today" rests on a premise the code contradicts | **an owner's card** (card 8; ruled 2026-11-15). Built until answered: it stays as the person left it, and "Show chat" carries the new session's mark. The rule is one function, so each answer is one edit | §F.1, `presentationForNewSession` |
| H13 | "only an artifact that this session, or a session it was opened from, created (the lineage the handle lookup already uses)" | The lookup applies the lineage to a handle only; an id resolves for any session. The lineage is the side thread's ancestors (`artifactScopeOf`), not a fork's source, and is empty after an engine-host handover | `createdBy` is compared with `lineageOf(ctx, deps)`; an artifact another session made is refused with a third sentence | §C.1 |
| H14 | "Restored <title> with Open" | The row draws Open only for a registered HTML delivery (`deliverableId` and `version`) | the delete row's Open calls `actions.openArtifact` with the artifact's id for any kind | §C.4 |
| H15 | Undo is disabled with "<machine> is offline" | UC-7's one function words a disabled act "<Act> is unavailable while <machine> is offline." (`disabledWords` in `src/shared/ipc/remote-unavailable.ts`); only a refusal after the fact reads "Not <done>: <machine> is offline" | the function's words: "Restore is unavailable while <machine> is offline." | §C.3 |
| H16 | the path is "resolved and read as `artifact_create`'s is (against the session's working folder …)" | Create resolves a relative path against the working folder and takes an absolute path anywhere; it accepts `.htm` too; the steps are inline | one function serves both tools, with create's rule unchanged | §A.1 |
| H17 | `pages` is read "from the bytes `printToPDF` returns" | Those bytes exist only in the render process; the tool server names the exported file's path and already reads the file for `to` | the tool server counts the pages in the exported file. No schema between processes changes | §B.4 |
| H18 | a design system named "resolved as `space` is" | `spaceNamed` is the Space's; a design system has two names, the artifact's title and the law's title, which differ on a copy | the artifact's title, which is what the Library, the choice and the opening words show | §D.1 |
| H19 | "The draft's pasted-text chip keeps accepting a name of the caller's choosing (it does today)" | A prefill's `pasted[k].name` is dropped: `available` in `composer/editor/recall.ts` names every atom "Pasted text #n". Only a dropped text file keeps its name | `available` takes the prefill's name when one is given; one insertion in U4's file | §E.3 |
| H20 | "Needs from U4: the composer drawn as its bar alone (one property …)" | No such property exists; `ComposerProps` is `{appSessionId, paneIndex, client?}` and the `composer` slot passes the first two | a context read by `Composer`, and one prop of `Frame`; three insertions in U4's files | §F.3 |
| H21 | "the 76 px Display sample" | There is no Display role. The largest is `title`, whose deck sample is 76 to 112 px in the three bundled systems, drawn at half size. The drawn page shows a Korean word does break under `overflow-wrap: anywhere` in the app's Chromium | the rule is on every sample, as the section's After has it; the sideways-scroll fallback is not needed | M11 |
| H22 | components "drawn on a 960 × 540 canvas … at twice today's size"; "none of the three bundled systems has" a component the smaller canvas clips | Measured on the drawn page: 960 × 540 does not hold two of the bundled tables, and only 1,280 × 720 holds every bundled component | (ruled 2026-11-15, L7) the canvas is chosen per component: the smallest of 960 × 540, 1,120 × 630 and 1,280 × 720 that holds it with at least 8 px to spare. The promise becomes "up to twice today's size" | M11, §J |
| H23 | "As today, the cards are disabled until the Space … is known" | Today only Ask Claude is disabled; New and Add a file… stay enabled and pass the Space's id | (ruled 2026-11-15, L5) while the Space loads, a card and its "Blank" link are both disabled; Add a file… stays as today | M8 |
| H24 | a restore's announcement | `artifacts.changed`'s `change` is a closed set (`created`, `updated`, `deleted`, `linked`); a fifth word is a wire major | an undelete announces `created` | §C.2 |
| H25 | A7: the artifact's "Theme panel names it" | A deck and a design have the Theme panel; a document names its system in its breadcrumb ("Design: <name>") | A7 is read on a deck's Theme panel and a document's breadcrumb | Acceptance |
| H26 | tracker rows 195, 364, 358 | Row 195 is the row of 2026-10-19 "Canon components now draw on a 1920 × 1080 slide canvas …"; "364" is the row of 2026-10-23 "Sitting candidate 61: canon previews …"; "358" was removed on 2026-11-14 | the two that remain close on A10's look | "The pull requests" |
| H27 | "Needs from U7b", "Needs from U1" (one insertion in `SessionPane.tsx`), "Needs from the architect" | Met on master: `newChat`, `openTab` and `openSession` leave a page, and the narrowed view lives in `useLibraryView`. No edit of `SessionPane.tsx` is needed. The `artifact` row's third action is M5's insertion | — | — |
| H28 | "Make something new" and the Space's menu on another machine's library | Neither is drawn there: `linesOf` in `Library.tsx` adds the section only for this Mac's library, and `SpaceMenu` offers management only for a Space of this Mac | unchanged; A7 and A8's sheet are this Mac's library's | Routes |

**The section's Claude Desktop citations**, read again in `app-5.1231.2`. Each holds, with these corrections; the pull requests' amendments use the corrected places.

- Delete: the class table is `main-process/index.chunk-BV3uOqbK.js:246075-246117` (`delete_artifact` at `:246105`), the destructive set `:246193-246199`. `:247044-247046` does not take the tool out of an allowed-tools list: it drops every "always allow" suggestion for it. The notification is `:247078-247103` (its words at `:247098-247100`; allow-once is off for every hosted artifact tool, not only delete). The request is never passed to a dispatching parent: `:247104-247110`, used at `:405914-405930`.
- Show chat: the strings are `web/app/v1/frame-shell-chrome-DV8q7Xxq.js:9488-9494`, the hidden-chat branch `:10116-10152`: an icon and the words "Show chat", no tooltip, the last control of the header's right-hand group. Pressing it puts the keyboard in the chat's input (`c48b15ac1-hOK47A9x.js:2495-2520`). The control carries no mark for a waiting request. **Correction of substance:** with the gates off and at normal width the frame does not draw an icon in its place; it draws a labelled "Chat" toggle earlier in the header (`:10093-10115`, placed at `:81110-81118`), which both hides and shows the chat. The gate chain also runs through `frame-shell-chrome:9617-9632` and `shared-frame-Bz73oHR9.js:37244-37317`; the numeric gate is defined at `shared-5-C9P6KnmH.js:7531-7558` and read at `:7683-7691`.
- The composer alone: the flag is `shared-130-EowXggL2.js:6826` (read at `:8040-8047`); the state is `c21f11e6d-DN-6LT8H.js:37237-37260` and `:32816-32828`. What is drawn beside the seated composer was not resolved in the source.
- The toast: `c293c7b4d-Cy2YBTrh.js:3504-3590`, mounted at `:12185` on the condition computed at `:9026-9036`. **Of substance:** its "Show chat" action opens the chat *card* (`:9985-9987`). The section has MAWS's "Show chat" return the bar; that stays the section's choice, and is already in the register's list of decisions the owner may see differently.
- New typed artifacts: `c62e545cb-CldHVH1U.js:1172-1178` and `:1183-1228` hold. `designSystemChoice` is `shared-5-C9P6KnmH.js:27887-28025`; the picker itself is in a server-gated chunk that is not in the tree, so how Desktop draws the choice cannot be read.
- Publish from a file: `main-process/index.chunk-BYfa-446.js:2145-2160` (the shared `html_path`), `:2216-2245` (create), `:2320-2349` (update).
- A Space's instructions: `ce28369f9-DBHDWa6P.js:6738-6741`; `c8ad300b7-B6Ph3bHV.js:2940-2948`, `:3047-3086`; the save is `:484-521`; the editor is a dialog, `:523-680`: an eight-row field, "Cancel" and "Save", no limit and no helper line, and no mark on a Space that has instructions. The system-prompt block and the uncalled reminder hold as cited.

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). In the worktree: edit, commit, push; no install, typecheck, lint, test, build or Electron there. Every check runs on the wave's build VM in a checkout of the pushed head (Concrete Steps). An executor starts no Electron e2e, runs no `scripts/ci-gate.sh` and opens no pull request. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution. Master is taken by merge, never by rebase or force-push.
2. **What binds from the section** (Design inheritance, "Binds"). No row is written to an artifact without a gesture of a person or a tool call of an agent behind it, each credited to the one who made it (U10a's rule: a page item chosen in the Export menu is a gesture; nothing else in this landing writes from the window). What the agent can set on a document, the person can see where it applies. Over an artifact the smallest chat is the bar alone and it can be closed; "Show chat" is in the header. Today's tokens and shapes only (law 7): no new colour, radius or shadow; components use tokens.
3. **Keep means keep** (law 8). An executor that finds one of these would change stops and reports: an agent's edits still appear live in an open artifact (l6-artifacts-02); every session MAWS launches still has `artifact_create` (l6-artifacts-03); a deck's history line reads as before (l6-artifacts-10).
4. **The tool texts are frozen** (root UC-15, charter X9). Every change to a tool's name, description, input or answer is one of §A to §E's, word for word, and is one dated line in the charter's X9 record in the same pull request. `MAWS_SERVER_INSTRUCTIONS` gains no character in any of the four pull requests.
5. **Stored and sent** (root UC-14's rule, applied to the artifact store). No entry is added to `STORE_MIGRATIONS` and `PRAGMA user_version` stays 4: a fifth entry would make both older builds open the store read-only. No field is added to `ArtifactSchema`, `SpaceSchema` or any other strict object that crosses a process or the link to a build that may be older; no member is added to any enum that crosses a process or the link (`artifacts.changed`'s `change`, `ARTIFACT_REFUSALS`, `spaces.changed`'s `change`). Neither settings file changes. §G states, per value, what each older build does with what this landing writes, and the reverse. A wire minor is taken above whatever master holds at that pull request's own merge (master has moved past the pin: it holds `WIRE_MINOR` 48 at `63c97b5c0`); this document names no number.
6. **Authorization is checked where the act runs, on the value the act uses, and it fails closed.** The agent's delete evaluates its rules inside the store's own batch that sets `deletedAt`, not in the tool before it, and its eligibility is a mark the store holds, never an absence of evidence in a log: an artifact with no mark, or with a mark that lags its newest write, is not deletable (§C.1). The undelete checks the same mark in the store method, whoever called. Over the link the endpoint decides on the command's own name; nothing in main or in `mawsd` turns another command into `artifacts.undelete`.
7. **Files other children own** (root UC-8). The insertions are listed once, in §H, each with its owner. An executor that finds another child's file must change beyond that list stops and reports.
8. **The repository is public** (root UC-11). Fixtures, scenes and tests use invented content: invented Space names, titles, paths and memo text. Nothing of a person's sessions, documents or machines is copied or described.
9. **Anything that awaits.** Each act that awaits something has, in its milestone, a test that holds the awaited thing open and one that makes it fail; §I lists them.

## Routes (root law 5)

Artifact tools exist only in a session MAWS runs, on this Mac or on another machine; a terminal session has none, so for A3, A4, A5, A7's tool half and A8's tool half "terminal session" reads "no artifact tools, nothing drawn". For a session on another machine the tool server and the store are that machine's, at that machine's build.

| acceptance | a session MAWS runs here | a session MAWS runs on another machine | a terminal session |
|---|---|---|---|
| A3, the agent's half (`set_page`, `page`, `pages`) | yes | yes, by that machine's tool server and render host | no tools |
| A3, the person's half (the Export menu's page items) | the document's own Export menu | the same menu on a document of that machine: an item's write travels as any edit does, through `documents.open`, and needs the grade an edit needs; opened to view only, the items show the setting and are disabled. The export is printed by that machine's render host: a machine of an older build stores the setting and ignores it (§G) | not tied to a session |
| A4, the tool | yes | yes | no tools |
| A4, the row and Undo, and an editor open on the deleted artifact | the row; Undo calls `artifacts.undelete` here. An editor open on the artifact shows that an agent deleted it, takes no edit, and offers the same Undo | the row is derived in this window from that machine's events; Undo is the offer of §C.3: an act on the `artifact` target, grade `manage`, the machine's owners only, behind the capability `rl2.artifact-undelete`. Drawn disabled, with `disabledWords`' sentence as a line of the row, while the machine is offline ("Restore is unavailable while <machine> is offline."), while its build does not list the capability ("Can’t restore on <machine> yet. Update MAWS on <machine> and try again."), and for a member who does not own it. An editor of this window open on that machine's artifact is fenced there as a local one is (§C.5) and shows the same state for an owner; a member who does not own the machine cannot be placed on a deleted artifact and sees the notice an unreachable artifact has today, with their unsent edit kept while the tab stays open | no such call |
| A5, the tool (`path`, `html`) | yes | yes | no tools |
| A5, "Save a copy…" | `library.saveAs` from the stored file | the same command pages the stored file to this Mac (`saveRemote`), which a machine of either older build already serves | not tied to a session |
| A6 | the bar is `SessionPane`'s compact form, so it sends, queues and stops as the pane does | the same; while the machine's link is not up the bar shows the link's phase words above the box, on the raised surface, as the session's tab shows them, and where the pane draws a notice in the composer's place the bar shows it with the float's edge and its two buttons | the same; a terminal session that cannot be driven shows the holder's notice in the box's place, with the float's edge and the two buttons |
| A7 | the cards are on this Mac's Library page; the chat they start is in a project of this Mac; `designSystem` on the tool works in any session MAWS runs | the section is not drawn while the page lists another machine's library (as today); the tool's `designSystem` resolves against that machine's systems | no tools |
| A8, the sheet and the mark | this Mac's Spaces | not drawn for a Space of another machine (the menu offers no management there today); no command over the link reads or changes a Space's instructions | — |
| A8, the chip | in the draft of the chat a card starts | — (a card starts a chat on this Mac) | — |
| A8, the tools' answers | yes | yes, from that machine's store, to every session there that makes or reads an artifact in the Space, whoever drives it | no tools |
| A9 | held by tests | held by tests | — |
| A10 | a design system's page | the same page for a design system of another machine (it is a view) | — |

**What a caller on another machine can newly ask for: one thing.** `OFFERS` gains one row, `artifacts.undelete` (§C.3). Proof, by test in M4 and by `git diff origin/master...HEAD -- src/endpoint/offers.ts` in the pull request: no other row is added or changed in any of the four pull requests. One answer gains a property: `artifacts.get`, which is offered today, answers for a deleted artifact that it was deleted and whether an agent's delete can be undone, with its title and kind (§C.5). Over the link only a machine's owner receives that, because nobody else can be placed on a deleted artifact (`placeArtifact` reads a library entry that no longer exists), and M4 pins it. `artifacts.create` over the link already takes `designSystemId` in its orphan form, which only the machine's owners hold; nothing sends it from another machine in this landing. A document's `page` attribute travels in the document's content to whoever may open the document, as its text does.

**A Space's instructions, said as it is** (ruled 2026-11-15, F4). No command over the link reads or changes them: `spaces.instructions` and `spaces.setInstructions` are not offered (`test/endpoint/artifact-rows.test.ts` pins them among the names that are refused), and `library.spaces`' answer is unchanged. Their text does reach agents on that machine through the tools' answers, in every session there that makes or reads an artifact in the Space or describes a kind for it, whoever started or drives that session. So whoever can read those sessions can read the text, a member on another machine included, as with a project's instruction file. No narrower policy is built. The sheet says so in one line (§E.2), and M10 pins it as intended with a session a member who does not own the machine drives.

**What the one new offer lets a caller do, and no more.** `artifacts.undelete` brings back only an artifact that an agent's `artifact_delete` removed and that nobody has restored since (the store's mark, checked in the store method), to the state it had at the delete (nothing can be written to it while it is deleted: §C.5); an artifact the machine's owner deleted in the Library is refused. The caller must be an owner of the machine. The tests it owes are in M4: a row test for each refusal the row can give (`not-offered` from a machine without the capability, where the device sends nothing; `owners-only`; `malformed` for an extra key; the store's refusal for an artifact with no mark), and the coverage tests that pin the table.

**Promotions.** A sweep of main, the services, `mawsd` and the endpoint for places where one received command is sent on as another (`invokeOwn`, `bus.invoke`, `dispatchLocal`, `dispatchToHost`, `link.act`, the endpoint's wrappers) found none on the artifact, library, Space and export paths that turns a window's or a remote caller's command into a privileged one. The one wrapper an undelete passes is `mawsd`'s `host.artifactOp`, which carries the name the endpoint already authorized, admits only the fixed set `ARTIFACT_OP_COMMANDS` and validates the input strictly again. M4 adds `artifacts.undelete` to that set and to no other wrapper, and its review lens reads the sweep again on the final diff.

## Plan of Work

Eleven milestones in four pull requests. Each stands on this document and the code, has its own proof and leaves the tree green. Interfaces are defined once, in "Interfaces and Dependencies" (§A to §J); a milestone points at them. M3, M5, M7, M8, M9 and M11 draw something the owner has a card on ("The look"): each builds its card's first option, at the one place the card names, and an answer that differs changes that place.

**Pull request U10b-1 · the agent's documents and pages**

### M1 — An HTML page is published from a file and exported as itself

**What exists at its end.** `artifact_publish` on an HTML artifact takes `path` in place of `files`, and the stored page is that file byte for byte. `artifact_export` with `format: 'html'` on an HTML artifact writes the stored page unchanged. An HTML artifact has "Save a copy…" in its viewer's Export menu and in the Library's row menu. The dashboard guide says when to choose an HTML page, and the HTML guide names `path`.

**What it touches.** `src/shared/maws/tools.ts` (the publish schema, two descriptions, one refusal) and `tools.test.ts`; `src/engine-host/tool-server/artifact-context.ts`, `artifact-tools.ts`, `artifact-publish.ts` and their tests; `src/render/export.ts` (`registerHtmlExporters`) with `compose.test.ts` and `src/main/library/files.test.ts`; `src/renderer/src/library/export.ts`, `RowMenu.tsx`, `src/renderer/src/tools/artifacts/viewers/ByteViewer.tsx` and their tests; `src/artifacts/types/dashboard/SKILL.md`, `src/artifacts/types/html/SKILL.md`; the probe snapshot `spikes/protocol-probe/scenarios/pass3/p4-maws-tools.json` (rewritten with `MAWS_WRITE_PROBE_TOOLS=1`, since two descriptions change).

**Interfaces.** Exposes §A. Consumes nothing of this landing.

**Decisions.**

1. One function reads an HTML source for both tools (§A.1), taken out of `artifact_create`'s inline steps with no change of behaviour: a path relative to the working folder or absolute, `.html` or `.htm`, a regular file, at most `ARTIFACT_MAX_BYTES`. The section's "as `artifact_create`'s is" is kept literally (H16); confining publish to the working folder while create is not would make the two differ for no gain.
2. The bytes stored are the file's bytes, read once as a buffer; they are not decoded and encoded again. The conflict check against the session's base and `force` are as for `files`. Where the publish path reads `input.files` after the write (`placed`, the replay), it reads the text of what was stored instead; a replayed call answers what it recorded and reads no file.
3. A refused path (missing, not HTML, too large, another kind) writes nothing and answers before any store call.
4. The `html` exporter copies the stored file; it renders nothing. The person's menus do not list `html` as a format for an HTML artifact (H9): the rule is in `library/export.ts`, where the formats per kind are held, so the viewer and the row menu agree.
5. The guide sentences are the section's, word for word (§A.4).

**What it does not touch.** `files` for the kinds made of several files; any kind's `path` but HTML's; the dashboard grammar; `artifact_create`'s behaviour; the menus of other kinds.

**What it proves.** A5. Tests must also pin: a file whose bytes are not valid UTF-8 is stored and exported unchanged; `path` and `files` together, and neither, are refused by the schema; `path` on a file artifact or a document is refused with §A.2's sentence; a publish from a stale base with `path` is refused as with `files`; the exported file's sha256 equals the published file's.

### M2 — A document's page is a setting of the document, and an export says how many pages it has

**What exists at its end.** A document's settings node holds `page`. The agent sets it with `set_page`, in a batch with other ops or alone, and reads it in `artifact_read`. PDF, Word and web-page exports and the screenshot's export layout print on the size the call names, else the document's, else the system's, else Letter, and at compact density when the document says so. A PDF export's answer holds `pages`. An exported page is spaced as the editor shows the document, and a heading is not left alone at a page's foot. The document guide tells the agent how to fit a page.

**What it touches.** `src/artifacts/document/meta.ts`; `src/shared/maws/document-tools.ts` (the op, the description, `DocumentReadResult`), `src/shared/maws/tools.ts` (the export result, two descriptions); `src/artifacts/document/edit-ops.ts`, `edit-plan.ts`, `patch-writer.ts`; `src/engine-host/tool-server/documents.ts`, `artifact-export.ts`; `src/artifacts/document/export/source.ts`, `design-system.ts`, `html.ts`, `docx.ts`; `src/artifacts/types/document/SKILL.md`; their tests; the probe snapshot.

**Interfaces.** Exposes §B.1 to §B.4. Consumes U10a's constructors and write path (its §A and §C).

**Decisions.**

1. The setting is one attribute of the settings node, set as one value, beside `dsOverrides` (§B.1). A version pins it because a version is the whole state; a restore brings the old setting back because the revert undoes map attributes too. Both are tested, not assumed.
2. `set_page` is an op of the plan (§B.2): the plan carries the page the batch leaves, `applyEdit` writes when the plan touches a block or sets the page, and the settings node is written inside the same transaction as the blocks. So a batch is one row whether or not it also changes text (U10a's constraint: one row per write), and a refused batch writes nothing. Rejected: writing the page in the tool's `writeAs` callback beside `reply`, which would leave the op out of the plan's all-or-none check.
3. `set_page` is refused for a dashboard, and refused, with the whole batch, when the batch would land as suggestions (H6, H8; §B.2's two sentences). A page is not something the person accepts passage by passage, and an agent whose edits the owner reviews should not change how the document prints unreviewed.
4. Compact is computed where every export binds the document's overrides, `exportDesign` (§B.4), from the governing system's resolved tokens, beneath the document's own overrides. Each number keeps its unit. With the three bundled systems and the house fallback the margin rule changes nothing (their margin is already 0.75 in); it matters for a system whose margin is larger. The three numbers are constants in one place and move on the owner's word (card 3). Their measured reach, on the export of decision 7, is §B.4's: a memo up to about nine lines over one page comes onto it.
5. `pages` is counted by the tool server in the exported file (§B.4), not sent from the render process (H17): no schema between processes changes, and an export made by a render host of an older build still gets a count. A count of zero is never answered; the field is left out.
6. `page` in the read answers the document's setting, with `system` and `standard` for what is not set (§B.3). The tool server does not resolve the system's tokens, so it cannot name the system's size; the agent's check is `pages`.
7. The export's page takes the editor's spacing (ruled 2026-11-15, L1; the built default of card 9). Today the exported page has no reset of the browser's own block margins, and the editor has one, so in a PDF the gaps follow the type size and not the spacing tokens: the drawn memo is 887.8 px tall as the editor lays it out and prints at 1,120.3 px, on two pages. One rule in the export's page CSS removes those margins on the document's blocks (§B.4), so the theme's gap rule and the tokens govern as in the editor; measured, the PDF is then the editor's layout to a tenth of a pixel. It is one rule in one place, so the other answer to the card is one edit. It tightens every export that uses the document's page (a document's and a dashboard's web page and PDF, and the screenshot's export layout); Word is laid out from the tokens already and does not move.
8. A heading is not left alone at a page's foot: `break-after: avoid` for headings in the export's print block (L2). A table that splits across pages without repeating its header row is a tracker row, not built.

**What it does not touch.** The editor's view (it has no pages) and `editor/theme.css`; the Export menu (M3); a design system's page tokens; Markdown export; a dashboard's exports beyond the gate of decision 3 and the spacing of decision 7; `MawsArtifactExportAnswerSchema` and every other schema between processes.

**What it proves.** A3's agent half. Tests must also pin: a batch of `set_page` alone is one row credited to the agent and moves the revision once; `set_page` with a refused op in the same batch leaves the page as it was; a version made before a `set_page` reads the old page and a restore of it puts the old page back; `dsOverrides` survives a `set_page` and the reverse; a call's `pageSize` beats the document's; a document's override of a type size beats compact's value for that token; a `rem` token is scaled in `rem`; `artifact_screenshot` of a compact document draws compact; a reader's replica that receives a `set_page` sends nothing back (U10a's A2, for this write); the export's page CSS holds the margin rule at zero specificity, over the block elements the document's schema writes, and the print block holds the headings' `break-after`. What decision 7 moves: no unit test holds a layout, so none moves; the expectations to read again on the Mac run are the page counts of `e2e/document.spec.ts`'s export scene (three pages, one per tab, which should hold) and anything in `e2e/dashboard-export.spec.ts` that rests on a block's height. The equality with the editor is a scene of M3, since only a real layout shows it.

### M3 — The person's Export menu shows the page, and the scenes of U10b-1

**What exists at its end.** A document's Export menu is four formats (Markdown, Web page, Word, PDF), a separator, and three checked items: Letter, A4, Compact, every row keeping the check mark's room so that all labels start at one edge. An item writes the document's setting as a row of the person's; the format rows then export with it. The history card's menu is the four formats. A dashboard's menu is unchanged. The scenes of U10b-1 exist, the cross-build scene among them, and the record is written.

**What it touches.** `src/renderer/src/tools/document/header.ts`, `tab-state.ts`, `DocumentPanel.tsx`; `src/renderer/src/panel/editor-host.ts` and `PanelHeader.tsx` (U8's: §H); their tests (`header.test.ts`, `tab-state.test.ts`, `DocumentPanel.test.tsx`, `PanelHeader.test.tsx`); `e2e/document.spec.ts`, `e2e/artifacts-store.spec.ts`, `e2e/library.spec.ts`, `e2e/cross-build.spec.ts`; `docs/charter.md`, `docs/doperpowers/plans/2026-10-12-p3-b-documents.md`.

**Interfaces.** Consumes §B.1 and §B.4. Exposes §B.5.

**Decisions.**

1. The three items behave as §B.5 says: Letter and A4 show the size in force, and choosing the one that equals the system's page clears the document's size, so the document follows its system again; Compact is a toggle. Built as the default of card 2. A document whose own overrides set another page size has neither checked, and choosing one replaces that override (L4).
2. An item writes on the editor's own replica, in one transaction with an origin of the person's, as a tab's rename does; it is credited as that rename is. While the editor is read-only (a document opened to view, a shown version) the items show the setting and are disabled.
3. An export started after an item was chosen prints with it or fails; it never prints the old page (ruled 2026-11-15, F7). `export` waits until the host has acknowledged the editor's writes, for at most five seconds. A document port that is down, a refused write, a provider that was disposed, or the end of the wait is an export failure with one fixed sentence (§B.5), shown where an export's failure is shown today. The export command answers on a channel of its own, so a port that is down does not make it fail by itself: the wait is what does.
4. The checked items are drawn by the header's menu for an entry that carries a checked state (§B.5); no other editor's menu changes.
5. `e2e/document.spec.ts`'s export scene (its line 297) is rewritten: where it picked "PDF, A4 (.pdf)" it chooses A4 and then PDF. A3's scene is new (Acceptance), and so is the spacing scene: the web-page export of a document with a paragraph, a heading, a list and a table, loaded in a page, has the same gap between each pair of blocks as the editor shows for them.
6. The cross-build scene "(document page, both ways)" runs against both exact peers and on an equal wire (ruled 2026-11-15, F3). On each peer it accepts a suggestion on the peer's side, and back on this build the document still holds its page setting (§G).

**What it does not touch.** The Library row menu's Export for a document (it sends no size and so already follows the document's setting after M2); a dashboard's header; decks' and designs' menus.

**What it proves.** A3's person half, and U10b-1's rows of §G by the cross-build scene. Tests must also pin: with nothing set and a system whose page is Letter, "Letter" is checked and nothing is written until an item is chosen; choosing "A4" writes one row of the person's and "A4" is then checked in a second window on the same document; opening the menu writes nothing; with an override of the page's width in the document neither size is checked, and choosing "A4" removes the override in the same row; an export with the document port down and the export command still answering fails with the sentence and asks for no export; an export with a connected provider that never acknowledges fails with the sentence after the wait; an item's write adds no paragraph to a document that ends in a chart (the write reaches the editor as the binding's transaction, which U10a's repairs do not answer).

**Pull request U10b-2 · a draft the agent can take back**

### M4 — The agent deletes its own draft, the delete can be undone, and a deleted artifact takes no content

**What exists at its end.** The store keeps a mark for each artifact an agent made, in step with every write. The tool `artifact_delete`, last in the list, deletes only an artifact whose mark stands. The store's `deleteOwnDraft` and `undelete`; the command `artifacts.undelete`, served here and over the machine link by the machine's owners. A deleted artifact admits no content frame and no new replica, whoever deleted it, and `artifacts.get` says of a deleted artifact that it was deleted and whether that can be undone.

**What it touches.** `src/shared/maws/tools.ts`, `tools.test.ts`, the probe snapshot; a new `src/engine-host/tool-server/artifact-delete.ts`, `tool-server/tools.ts`, `server.test.ts`; `src/engine-host/documents/store.ts`, `storage.ts`, `service.ts`, `register.ts` and tests; `src/shared/ipc/schema/artifacts.ts`, `names/artifacts.ts`, `grades/artifacts.ts`, `schema/host.ts`, `routes.json`, `wire.ts`, `wire-manifest.json`; `src/endpoint/offers.ts`, `capabilities.ts`, `src/shared/ipc/remote-unavailable.ts`, `apps/org-protocol/src/channel.ts` (U9's, by its rule for a later child's offer: §H); `src/main/lane-b/remote-artifacts.ts`; `test/endpoint/artifact-rows.test.ts`, `test/lane-b/offer-coverage.test.ts`, `src/engine-host/ops.test.ts`, `apps/org-protocol/test/messages.test.ts`, a new row test.

**Interfaces.** Exposes §C.1, §C.2, §C.3 and the host's half of §C.5. Consumes U10a's write path: `integrated` in `service.ts` stays the one place a document's row is appended.

**Decisions.**

1. **Eligibility is a mark, and it fails closed** (ruled 2026-11-15, F1; §C.1). "No person has written to it" is not read from the log or from the client bindings: the log is pruned, a deletion alone binds no client, and an accepted suggestion's copy is bound to the suggester. The store holds one key per agent-made artifact in `meta`, written when a session creates the artifact and advanced with each of the artifact's content rows that a session writes. A person's content row breaks it for good. So does any row the mark did not account for: when a row is appended and the mark does not name the row before it, the mark is broken, which is what a stay under an older build leaves (that build appends rows and never touches the key). An artifact with no mark (made before this build, by an older build, by a person, or copied by a person) is never deletable by an agent. Entity changes (a rename, a move to a Space, a pin) write no content row and are not counted, as the section's rule is about what was written.
2. The upkeep is in the two places every content row is appended, `appendInBatch` and `appendContentInBatch` in `storage.ts`, inside the batch the row joins, and it covers the artifact's own document and its suggestion document (an accepted or a rejected suggestion writes there or in the main document as the person's row). The newest row of a document is never pruned (`pruneLog` keeps it), so "the mark names the artifact's newest row" stays checkable after a checkpoint and a prune. M4's executor confirms by a search that nothing but `pruneLog` deletes from `artifact_updates`; if something does, it stops and reports.
3. The rules of the agent's delete (§C.1) are one store method and run inside the batch that sets `deletedAt`, on the rows that batch reads (Constraint 6). A person's frame admitted before the delete has already broken the mark in that batch or an earlier one, so the delete is refused; one that arrives after is refused at admission (decision 5).
4. Only an artifact an agent's delete removed can be undeleted: the delete records itself in the same key, and `undelete` requires it (§C.2). This is what bounds the offer over the link, and what keeps Undo from bringing back something the person deleted on purpose. The key needs no migration, and both older builds read `meta` by key and never see it.
5. **A deleted artifact takes no content** (ruled 2026-11-15, F2; §C.5). The document service refuses a content frame, and a new replica, for an artifact that is deleted. The fence is raised at the start of the delete's batch, before `deletedAt` is written, on the one thread that also admits frames, so a frame is either admitted before the fence, and is then part of what the delete's rules read and of the state that is deleted, or refused after it; none is acknowledged after the delete. A refused frame closes its connection as a refusal does today, and the editor's provider keeps the update as unacknowledged. This holds for the person's own delete in the Library too: today a replica still attached can go on writing into an artifact no library lists, and that hole closes here (the record says so).
6. An undelete lowers the fence, clears `deletedAt` and announces `created` (H24): main's library sync refreshes on it, the endpoint's placement cache drops its entry on any change but `updated`, and the linked-folder mirror writes the files again. An undelete of an artifact that is already live answers success and changes nothing, so two presses, or two windows, end the same way. The mark's standing is kept across a delete and its undo, since nothing was written in between.
7. A handle the deleted artifact held may have been taken by a newer artifact meanwhile. Both then hold it; the lookup already answers the newer one, and the restored one is reached by its id. Nothing is renamed.
8. Over the link the act is the machine's owners' (H4), behind a capability of its own, with `requires` read from `REMOTE_NEEDS` (U9's rule; `remote-artifacts.ts` hard-codes `rl2.artifacts` today, which would let an act held while offline go to a machine that does not know the command).
9. The tool is annotated `destructiveHint: true` (H5); the annotation types widen for it, and nothing is claimed from the hint. It passes the session's permission mode like any `maws` tool: only `ask` is pre-allowed at launch.

**What it does not touch.** The person's delete beyond the fence it now raises; `artifacts.restore` (the version restore); `artifacts.changed`'s schema; the endpoint's target rules (`src/endpoint/targets.ts`) and its placement read; connector grants (a delete removes them and an undelete does not bring them back, as the section says); `STORE_MIGRATIONS`.

**What it proves.** A4's tool half, its route's authorization, and that nothing is written to a deleted artifact. Tests must pin, each at the store's file (rows and the key read after the commit):

- *The mark.* A session's create writes it; a session's edit advances it; each of these breaks it, and after a checkpoint and a prune of the log the agent's delete is still refused: a person's insert; a person's deletion alone; a person's accept of the agent's suggestion; a person's reject of it; a person's restore of a version; a design's migration at an open. An artifact a person made, one a person copied, and one with no key are refused.
- *A stay under an older build.* A two-build scene, in "(deleted draft, both ways)" (the two-build spec already calls a `maws` tool through `agent.call`): this build's agent makes a draft; under each peer a person types in it; back on this build the agent's delete is refused with §C.1's sentence. And a unit case that appends a row as an older build's storage does (the same statement, read at both commits and byte-identical there, with no upkeep), then prunes, then asserts the refusal: it holds the rule in class 1a, where the scene cannot run.
- *The delete.* A draft made by the session is deleted; one made by a side thread's parent is deleted from the side thread; one another session made is refused; a design system still in use is refused as for the person; a replayed call answers the first answer and deletes nothing twice.
- *The fence.* A replica held open, for the agent's delete and for the Library's: a person's update just before the delete (the agent's delete is refused and the update is a row; the Library's delete goes through and the update is in the deleted state); a person's update just after (refused, the connection closed, no row, no acknowledgement, the update still in the replica as unacknowledged); the same two through a replica over the machine link's document stream; a new open of the deleted artifact's document refused.
- *The undo.* Undelete of an artifact an agent deleted clears `deletedAt`, announces `created`, and the held replica's update then arrives as a row of the person's, which breaks the mark; undelete of an artifact deleted in the Library is refused and leaves it deleted; undelete of a live one is a success with no write; `artifacts.get` of each answers as §C.5 says, and over the link a member who does not own the machine is refused it; `PRAGMA user_version` is 4 after all of it.

### M5 — The transcript's row for a delete, the editor's notice, their Undo, and the scenes of U10b-2

**What exists at its end.** An `artifact_delete` call draws the artifact row: "Deleting <title>…", then "Deleted <title>" with Undo, or "Could not delete <title>: <reason>" in words for the person. While the artifact is live again the row reads "Restored <title>" with Open. An editor that is open on an artifact when an agent deletes it stays in place, takes no edit, and shows a notice with the same Undo; after Undo it reconnects and an edit it had not sent is sent. For a session or an artifact on another machine Undo acts there, and is disabled with a visible sentence where it cannot work. The scenes of U10b-2 exist and the record is written.

**What it touches.** `src/renderer/src/transcript/model/classify.ts`, `derive.ts`, `rows.ts`, `schema.ts`, `copy.ts`, `serialize.ts`, `src/renderer/src/transcript/view/rows/Artifact.tsx`, `view/context.tsx`, `transcript.css` (per UC-3: §H) and their tests (`artifacts.test.ts`, `Artifact.test.tsx`, the snapshot suite); `src/renderer/src/library/actions.ts`, `ArtifactTab.tsx`, `copy.ts` and `App.tsx` (the action's registration); `src/renderer/src/tools/artifacts/RecordView.tsx` (the side column's view of one artifact); `e2e/maws-tools.spec.ts`, `e2e/deliverables.spec.ts`, `e2e/library.spec.ts`, `e2e/remote.spec.ts`, `e2e/cross-build.spec.ts`; `docs/charter.md`; `docs/tech-debt-tracker.md`.

**Interfaces.** Consumes §C.2, §C.3, §C.5. Exposes §C.4.

**Decisions.**

1. What the row shows is read, not remembered: "Restored" while the library of the session's machine lists the artifact, "Deleted" while it does not (§C.4). So the row is right after a relaunch, in a second window, and after an Undo pressed elsewhere. Until the read has answered, the row reads "Deleted <title>" with Undo disabled (R5).
2. Undo is disabled while its act is in flight. An act that ends without its effect leaves its sentence as a line of the row and Undo enabled again: over the link the sentence is `refusalWords`' or `failureWords`'; here it is "Not restored: <the store's sentence>". The sentence of a disabled Undo is a visible line of the row too, not a tooltip alone (R5).
3. The row speaks to the person (R2, R3). The tool's name never reaches them: the row's refusal reader (`refusalForHuman` in `transcript/model/copy.ts`) covers the delete tool as it covers create, update and publish. For each refusal the delete can give, §C.4 fixes two sentences, the agent's and the row's; the row finds which by a key in the refusal's JSON, and a refusal it has no words for (a newer machine's) is drawn through the refusal reader.
4. The row names the artifact by the tool's answer (`title`, `artifactId`); before the answer, by the reference the call gave. A long heading takes the room that is left and wraps beside the icon; Undo and Open keep their place at the row's end and are at least 24 px tall as pressed areas (R1, R4). Its text in a copied transcript is the heading alone.
5. The row is an `artifact` row, so it stays in view when its turn folds (`isPersistentRow`), which is where the owner learns of the delete.
6. The editor's notice (§C.5). The two places that show one artifact, `ArtifactView` in `library/ArtifactTab.tsx` and the side column's `RecordView`, today replace the editor with "This artifact was deleted, or it is not in the library." once the library has no row and the host says the artifact is absent, which unmounts the editor and its replica. Where the host says an agent deleted the artifact and that can be undone, they keep the editor they hold mounted instead, taking no edit, under a notice with the same words, the same Undo and the same disabled sentences as the row. For a delete that cannot be undone (the person's own, in the Library) they show today's notice.
7. After Undo the artifact is in the library again, the view mounts its editor as live, the provider reconnects, and an update the fence refused is sent in the reconnect's first exchange as the person's write. If the tab is closed while the artifact is deleted, the unsent update is gone with the replica; the notice says the edit is not saved (§C.5's line).

**What it does not touch.** The rows of create and publish and their Open; `openArtifactInPanel`; U6d's link element and click rule; the transcript's groups and folds; the kinds' editors beyond the state each already has for a reader who may only view.

**What it proves.** A4. Tests must also pin: the row of a session on another machine routes Undo to that machine by the session's address, also for an artifact the window has never listed; Undo held open shows the control disabled and a second press sends nothing; a link that drops while the act is in flight ends with the sentence and no change of state; the disabled sentences for offline, for a machine without the capability, and for a member who does not own it, each as a line in the row; each refusal's row sentence, and none of them holding the tool's name or "the user"; an editor open on a document when the agent deletes it keeps its text on screen, refuses a keystroke, shows the notice, and after Undo sends an update that was typed just before the notice appeared.


**Pull request U10b-3 · the chat over an artifact**

### M6 — The float has three presentations

**What exists at its end.** The float's state knows card, bar and hidden, with every transition of §F.1's table and the keyboard's place after each. Nothing is drawn differently yet: with no Hide control on screen, hidden is reached only by tests, and a bar draws as today's pill.

**What it touches.** `src/renderer/src/shell/floating.ts` and `floating.test.ts`.

**Interfaces.** Exposes §F.1 and §F.2.

**Decisions.**

1. `closed` keeps its name and its meaning, "not the card", and a second flag says whether the closed float is hidden (§F.1). Every reader of `closed` outside the shell (`session/visibility.ts`, `side/BtwCard.tsx`, `shell/DocumentSessionSpace.tsx`, the browser pane's column, `panel/PanelHeader.tsx`) is then right without an edit: a hidden chat is not on screen, reserves no column and is not the card. U1b's line calls `openCard`, which opens the card from either closed presentation. Rejected: one three-valued field, which would change every reader and U1b's call.
2. The table of §F.1 is fixed before any code: the events, the three states, the next state and where the keyboard goes. The rule for a new request reads the presentation at the moment the request arrives: from the bar it opens the card as today; from hidden it does nothing.
3. Hidden exists only while a header holds "Show chat" (§F.2). When what the float sits over changes to something with no such header, a hidden chat becomes the bar once and stays the bar; it does not hide again by itself when the header comes back.
4. Every end of the float (Dock, Restore split, the float's identity changing) clears both flags, as it clears `closed` today. Neither is stored.
5. What the float over a side surface shows when another session's tab comes in front is one function, `presentationForNewSession` (§F.1), because it is an owner's card (card 8; H12). Built until answered: the presentation stays as the person left it.
6. While the chat is hidden the side column's float control keeps its label and its act: it opens the card. "Show chat" brings the bar (B7).

**What it does not touch.** `transfer.ts`; the layout store; the card's size and the column reservation; who counts as on screen.

**What it proves.** The transitions half of A6, by `floating.test.ts`: each row of §F.1's table is a case that asserts the next state and the focus mark; a request that arrives while hidden leaves the state and the focused element as they were; a request that arrives in the same tick as Hide chat is judged against the state that tick leaves (hidden: nothing opens); the header going away turns hidden into the bar; another session's tab coming in front over a side surface leaves a bar a bar and a hidden chat hidden, through `presentationForNewSession`; hidden, ⌥⌘B opens the card.

### M7 — The bar and "Show chat" are drawn, and the scenes of U10b-3

**What exists at its end.** After Expand, or after the card's Close, the float is the composer's box alone, 420 px wide at the lower right, with Open conversation and, where a header exists, Hide chat to its right. Hidden, the header of what the float sat over shows "Show chat" with the session's mark. The scenes of U10b-3 exist, the combined scene with U1b among them, and P4's Decision Log 83 is amended. **This milestone does not finish before U1b is on master** (the cut).

**What it touches.** `src/renderer/src/shell/FloatingPill.tsx`, `FloatingCard.tsx`, `floating.ts` (the bar's published height) and their tests (`FloatingPill.test.tsx`, `FloatingCard.test.tsx`, `SplitCard.test.tsx`); in U4's files, a new `src/renderer/src/composer/frame/bar.ts`, `Frame.tsx` and `Composer.tsx` with `Composer.test.tsx` and the chords' test; in U9's file, `src/renderer/src/main/Pane.tsx`; in U8's file, `src/renderer/src/panel/PanelHeader.tsx` with `PanelHeader.test.tsx` (§H); the readers of the open card's place that give a scrolling artifact its room (the document's and the dashboard's body, through `shell/DocumentSessionSpace.tsx`); `e2e/panel.spec.ts`, `e2e/layout-transfer.spec.ts`; `docs/doperpowers/plans/2026-10-19-p4-smoothing.md`.

**Interfaces.** Consumes §F.1, §F.2 and U1b's compact line. Exposes §F.3 and §F.4.

**Decisions.**

1. The bar mounts the session's pane in its compact form, as the pill does, inside a provider that tells the composer it is a bar (§F.3). So everything the pane draws in the composer's place or above it is in the bar with no code of its own: the holder's notice of a terminal session, the `/btw` card, the tab notes, U1b's waiting line, and a setup card (trust, a relay that is down, a start that failed), which takes the box's place as it does in a pane. `session/SessionPane.tsx` is not edited: the bar's region sets the composer column's side padding (`--measure-pad`, which `.thread-column` reads) to zero for its subtree, in `FloatingPill.tsx` (B1).
2. **The bar's size, once** (B1). The box is 420 px wide. The two buttons stand to its right, outside it, bottom-aligned with it. The bar is 484 px wide, and 452 px over a tab with no header, where only Open conversation is drawn. It sits 16 px from the right and the bottom, as the pill does, and is never wider than the area less 32 px.
3. **What is raised** (B2, B3, B8). The box carries the float's border and shadow. Each of the two buttons is a raised button with the box's ground, border and shadow, so its glyph reads over any page. Whatever stands in the box's place (the holder's notice, a refusal, a setup card) has the float's edge as the box has. What the composer draws above the box stands on one raised surface, only while something is there (the default of card 1): it runs from 8 px above the topmost thing down to the box and includes it, with the box's radius and the float's edge; what it holds is inset 8 px; the waiting line, the link's phase words and a pane's notice stand on it too; the two buttons stand beside it. There is no section frame, no title row and nothing under the box, the plugin's hint included (H11).
4. A session whose machine's link is not up shows the link's phase words above the box, on the raised surface, as the session's tab shows them (B4; `LinkStatusLine` in `lane-b/link-status`, which the main pane already draws).
5. In the bar the composer's toolbar stays mounted and hidden, by the mechanism a docked card already uses (`DraftShownContext`), not unmounted. The three chords that open its menus (the model, effort and mode menus) ask the predicate the composer registers on its focus target, `draftShown`; the bar joins that predicate, apart from whether the draft itself is usable, so in the bar a chord changes no menu state and runs no open callback (ruled 2026-11-15, F5). Dictation by its chord still works, and its notice moves above the frame as it does under a docked card. Rejected: unmounting the toolbar, which leaves a menu chord with no anchor; relying on `DraftShownContext` alone, which closes a popover and still lets the chord write the menu's request into the store and read the engine's lists.
6. The two buttons: Open conversation (its tooltip the session's title) and Hide chat. The session's mark stands at Open conversation's upper right, outside the glyph; a waiting request wins over unread; one mark at a time (B5). After the card's Close the keyboard is on Open conversation; after Expand and after Show chat it is in the box's editor.
7. "Show chat" is a labelled button with the session's mark, as words at every width (B9): while the chat floats over a side surface the side column fills the main area, and its first strip is never narrower than 588 px, where the words fit. In the main area it stands in the artifact's header directly before Restore split (`TabHeader` in `main/Pane.tsx`); over a side surface, in the side column's controls directly before the float control (`RegionControls`). After Hide chat it has the keyboard.
8. A scrolling artifact keeps its end readable (B6): the bar's height is published as the open card's place is (`rect` and `host` in the float's store), and the page under it gets that much room at the end of its scroll, by the reader that already keeps a document's controls out from under the card. A deck's Notes row under the bar is accepted and recorded; Hide chat is the way to clear it.
9. Over a main tab whose body registers no header (a file, a diff, another session) the bar has Open conversation only. Over a Browser page the chip in the page's tab row stays as it is (the section's "Not included").
10. The inline chip's accessible name ("Show session card") is kept, since the Browser's scenes read it; the bar's region is renamed from "Compact session composer" to "Chat", and the two scene files that read the old name change with it.
11. The combined scene with U1b (ruled 2026-11-15, F6), on a head that holds both: with the chat hidden, a permission request of the session arrives; nothing opens and "Show chat" carries the waiting mark; Show chat brings the bar with the line "Waiting for you · 1" above the box and no request drawn in the box; Open conversation opens the card, where the request is drawn. No other drawing of a request in the bar is built.

**What it does not touch.** `session/SessionPane.tsx`; `shell/transfer.ts`; the card and its header; the Browser's chip; the deck stage's reserve; any stored layout.

**What it proves.** A6. Tests must also pin: the bar has no element with the toolbar's role in the accessibility tree and no title button; its width with two buttons and with one; attached files and a waiting message draw above the box in the bar, on the raised surface; each of the three menu chords, pressed with the keyboard in the bar, leaves the composer store's menu state as it was and calls no open callback; a comment sent to the main session while the chat is hidden is delivered and opens nothing (UC-5); ⇧⌘\ from the artifact opens a bar or a hidden chat as the card with the keyboard in its composer; ⌥⌘B over a side surface does the same; "Show chat" is absent while the chat is a bar or a card; the mark shows waiting when the session is both unread and waiting; a document under the bar can be scrolled until its last line stands above the bar.

**Pull request U10b-4 · the Library**

### M8 — "Make something new": four cards, More, and a design-system choice that binds

**What exists at its end.** `artifact_create` takes `designSystem`. On the Library page the section is four cards (Document, Presentation, Dashboard, Design), each one button that starts a chat with the opening words, beside a "Blank" link; a More menu (Design system, HTML page, Add a file…) as the row's last cell; and one design-system choice in the heading.

**What it touches.** `src/shared/maws/tools.ts`, `tools.test.ts`, the probe snapshot; `src/engine-host/tool-server/artifact-tools.ts`, `documents.ts` (the document and dashboard create) and tests; `src/renderer/src/library/MakeSomethingNew.tsx`, `copy.ts`, `Library.test.tsx`, `LibraryMachineMenu.test.tsx`.

**Interfaces.** Exposes §D.

**Decisions.**

1. `designSystem` resolves a design system by id, then by the artifact's title exactly, then ignoring case and spaces, among live design systems (H18); two matches are refused naming their ids, none is refused naming the systems that exist. The new artifact carries it as its own system and the answer's guide is that system's. A create without it sets none, as today (the test "sets no designSystemId" stays).
2. The kinds that take it are document, presentation, design and dashboard, one constant (H10).
3. The choice is state of the section's component: it holds while the page is open and is gone when the page closes, which is the section's "not stored". The default shown is what `useDocumentGoverningSystem({ spaceId })` answers for the Space the page is narrowed to.
4. Blank passes `designSystemId` only when the chosen system is not the default, so an artifact made under the default keeps following the defaults.
5. The card's parts are fixed by the drawn page (ruled 2026-11-15, L5; §D.2). A card and its "Blank" link are siblings, not a button inside a button; while the Space the page is narrowed to is still loading both are disabled (H23). A card shows the kind's icon, its name and today's one-line description (`KIND_BLURBS`), the default of card 4. The cards share the row in columns that fill it, none narrower than 200 px, and wrap to a second line in a narrow window, so no description is cut; More is the row's last cell at its own width. "Blank" is at least 24 px tall as a pressed area. The section shows where it shows today: on All, on General and on a narrowed Space; not on the list of all Spaces, not on Pinned and not during a search.
6. The opening words are §D.2's, exact. A card press awaits the session's creation (and, for a Space with a linked folder, the folder's project first): the card is disabled meanwhile so a second press starts no second chat; a failure is the toast it is today; if the person has moved to another tab meanwhile the new chat opens behind, by `createSession`'s existing rule.

**What it does not touch.** The page itself and how it is left (`stores/layout.ts`); the Library's lists; another machine's library, where the section stays undrawn; a Space's default system.

**What it proves.** A7. Tests must also pin: the opening words for each of the four kinds, with and without a Space, with and without a chosen system; "Blank" on a card with a chosen system calls `artifacts.create` with its id, and with the default calls it with none; `designSystem` on an HTML page or a file is refused; the More menu's three entries; a card pressed while the design systems are still being read starts its chat with no system in the words; while the Space loads, the card and "Blank" are both disabled.

### M9 — A Space carries instructions: the store, the sheet, the mark and the chip

**What exists at its end.** A Space's menu has "Instructions…", which opens a sheet with one field; a Space that has instructions shows a mark on its heading line. A chat started from a card with the page narrowed to such a Space carries the instructions as one chip after the opening words.

**What it touches.** `src/engine-host/documents/store.ts`, `register.ts`, tests; `src/shared/ipc/schema/spaces.ts`, `names/spaces.ts`, the grades and routes tables, `wire.ts`, `wire-manifest.json`; `test/endpoint/artifact-rows.test.ts` (the names that stay refused); `src/renderer/src/library/SpaceDialogs.tsx`, `dialogs.ts`, `Library.tsx`, `Rows.tsx`, `actions.ts`, `store.ts`, `copy.ts`, `MakeSomethingNew.tsx` and tests; in U4's file, `src/renderer/src/composer/editor/recall.ts` with its test (§H).

**Interfaces.** Consumes §D.2. Exposes §E.1 to §E.3.

**Decisions.**

1. The text is held in the store's `meta` table, not in a column and not in the entity (H2; Constraint 5). Two commands read and write it; neither is offered over the link.
2. A write announces through the existing `spaces.changed` with `change: 'updated'`, whose payload does not change. Deleting a Space removes its text; a text whose Space no longer exists (a Space deleted under an older build) is dropped at the next write.
3. The sheet is the library's sheet pattern with a multi-line field: Enter makes a new line and Save is a button. The field starts eight lines tall and grows with its text to 40 % of the window's height, then scrolls, so Save stays in view (ruled 2026-11-15, L6). Save is offered whenever the text differs from what is stored, the empty text included: saving an empty text is how instructions are removed. At 8,000 characters the field takes no more, a paste is cut there, and a line under the field says so. Saving awaits the command: the buttons are disabled meanwhile, a failure shows its sentence in the sheet and keeps the text, and closing the sheet while a save is in flight does not cancel the save.
3a. The sheet says in one line who receives the text (ruled 2026-11-15, F4; §E.2): every agent on this Mac that works in the Space, and whoever can read its session.
4. The chip is the composer's pasted-text atom, placed by the prefill after the opening words, named `Instructions for “<name>”`. The prefill's name is kept (H19). The chip keeps the pasted chip's own " +N lines" after the name and is cut with an ellipsis when the name is long (L6). Its body opens with the section's line, then the text.
5. The mark and the menu item are drawn where Space management is drawn today: for a Space of this Mac. "Instructions…" stands directly after "Rename…" in the Space's menu. The mark is at least 24 px tall as a pressed area.

**What it does not touch.** `SpaceSchema`, the `spaces` table, `library.spaces`, `STORE_MIGRATIONS`; main's index mirror of Spaces; the Settings section that holds a Space's default design system; another machine's Spaces.

**What it proves.** A8's first two sentences. Tests must also pin: 8,001 characters are refused by the command and cannot be saved from the sheet; saving empty text removes the instructions and the mark; a Space with no instructions starts a chat with no chip; the chip's body is what is sent with the first message; `PRAGMA user_version` is 4 after a write; a save held open disables Save, and a failed save keeps the sheet open with the text.

### M10 — The artifact tools give a Space's instructions

**What exists at its end.** `artifact_create` in a Space, `artifact_read` of an artifact in a Space and `artifact_describe_type` answer `spaceInstructions` the first time a session meets that Space, and again only after the text has changed or the session's context was compacted. `artifact_describe_type` takes `space`.

**What it touches.** `src/shared/maws/tools.ts`, `document-tools.ts`, `tools.test.ts`, the probe snapshot; `src/engine-host/tool-server/artifact-context.ts`, `artifact-tools.ts`, `documents.ts`, `src/engine-host/session-maws.ts` and tests.

**Interfaces.** Consumes §E.1. Exposes §E.4.

**Decisions.**

1. What a session was given is kept beside `guided` in the session's artifact state: per Space, the stamp of the text it was given. An answer carries the instructions when the Space has text and the stamp differs or is absent.
2. A compaction clears it: `SessionMaws.observe` sees the engine host's `boundary.compaction` event (the engine's `compact_boundary` frame, recorded in `spikes/protocol-probe/fixtures/pass3/compact.jsonl`) before any tool answers after it. A boundary marked historical clears too; at worst the instructions are given once more.
3. Every path of the three tools carries it: the generic create and the document and dashboard create; the generic read and the document read; describe. Two reads do not: the read MAWS makes for an artifact the person attached to a message, which would spend the session's one delivery inside the person's message, and the legacy dashboard read.
4. A replayed call answers what it recorded and marks nothing.
5. A resumed or relaunched session, and a session adopted after an engine-host handover, start with nothing marked, so the instructions are given once more. That is accepted.

**What it does not touch.** The engine's system prompt; `MAWS_SERVER_INSTRUCTIONS`; the launch; terminal sessions.

**What it proves.** A8's third sentence. Tests must also pin, through the session's real tool server: create in a Space, then read in the same Space, gives the instructions once; a change of the text gives them again at the next answer; the fixture's compaction frame fed to the session gives them again; two Spaces are tracked apart; a Space with no text adds no field; a linked read neither carries nor marks; a session that a member who does not own the machine drives receives the instructions as any session does (pinned as intended: F4).

### M11 — The design system's page, and the scenes and the record of U10b-4

**What exists at its end.** On a design system's page a type sample breaks inside a word that does not fit its cell, and each component is drawn on the smallest of three canvases that holds it, with a 64 px inset at the smallest: up to twice today's size in the same card. Layouts keep the slide canvas. The scenes of U10b-4 exist, and the record is written.

**What it touches.** `src/artifacts/design-system/page/page.css`, `page/Canon.tsx`, a new `page/component-canvas.ts`, `DesignSystemPage.test.tsx`; `e2e/design-systems.spec.ts`, `e2e/library.spec.ts`, `e2e/cross-build.spec.ts`; `docs/charter.md`, `docs/doperpowers/plans/2026-10-12-p3-l-library.md`, the P3 interface ledger's X23 entry, `docs/tech-debt-tracker.md`.

**Interfaces.** Exposes §J.

**Decisions.**

1. `overflow-wrap: anywhere` goes on the sample's text inside `.dsp-specimen`, on every role; the system's own `word-break` still decides wherever the word fits. The drawn page shows that the app's Chromium does break a Korean word under `keep-all` with it, so the section's sideways-scroll fallback is not built; one scene shows the break in the app (ruled 2026-11-15, L7).
2. **The canvas is chosen per component** (L7; §J). 960 × 540 does not hold two of the bundled tables and only 1,280 × 720 holds every bundled component, so one canvas for all would either clip or give up most of the gain. The canvas of a component is the smallest of 960 × 540, 1,120 × 630 and 1,280 × 720 that holds it with at least 8 px to spare, the inset a fifteenth of the canvas's width. "Holds" is measured as the children's margin boxes inside the canvas less the inset; a scroll height does not see the inset.
3. The page cannot measure a component: its frame is sandboxed and stays so. So the choice for the bundled systems' components is a table in the source (§J), and a scene measures every bundled component outside the sandbox by the rule above and fails when the table is not what the rule gives. A component the table does not name (a system the person or an agent made) is drawn on the largest canvas, which is the one most likely to hold it and still half again today's size. Reported under "What could not be settled": the rule's reach beyond the bundled systems.
4. `SlideFrame` takes its canvas as a property, and takes its scale from the frame's client width: today's 1 px border cuts 2 px off every frame (L7).
5. The frames' sandbox and content policy do not change.

**What it does not touch.** The canon's files and the three bundled systems; the type classes `generateTokensCss` writes; the layouts' canvas.

**What it proves.** A10's two tests, and U10b-4's rows of §G by the cross-build scene. The owner's look at the component cards is "Proof", 3.

## Concrete Steps

`$BRANCH` is the pull request's branch (`ux-wave/U10b-1` to `-4`), made by the architect from master with `ux-wave/U10b` merged in, and mapped to a build VM before its first milestone. Every command below runs from the worktree and reaches the VM through the helper; nothing is installed or run in the worktree itself.

1. **Start of every milestone.**

       git fetch origin master && git merge origin/master

   Merge, never rebase. Then read "Landings in flight" against the merged tree for the rows that name this milestone.

2. **After each push, the milestone's own checks** (the brief's rule: the typecheck of each project changed, eslint on the files changed, vitest over the folders touched and the folders that import what changed; the helper's exit status is the command's):

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh $BRANCH -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh $BRANCH -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh $BRANCH -- 'timeout 600 pnpm exec eslint <the files changed>'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh $BRANCH -- 'timeout 1200 pnpm exec vitest run <the folders below>'

   The folders, per milestone:

   | milestone | vitest folders and files |
   |---|---|
   | M1 | `src/shared/maws src/engine-host/tool-server src/render src/main/library src/renderer/src/library src/renderer/src/tools/artifacts src/artifacts/types` |
   | M2 | `src/shared/maws src/artifacts/document src/engine-host/tool-server src/engine-host/documents src/render src/artifacts/types` |
   | M3 | `src/renderer/src/tools/document src/renderer/src/tools/dashboard src/renderer/src/panel src/artifacts/document` |
   | M4 | `src/shared/maws src/shared/ipc src/shared/machine src/engine-host/tool-server src/engine-host/documents src/engine-host/ops.test.ts src/endpoint test/endpoint test/lane-b src/main/lane-b apps/org-protocol/test` |
   | M5 | `src/renderer/src/transcript src/renderer/src/library src/renderer/src/tools/artifacts src/renderer/src/lane-b test/support/tokens-guard.test.ts` |
   | M6 | `src/renderer/src/shell` |
   | M7 | `src/renderer/src/shell src/renderer/src/composer src/renderer/src/main src/renderer/src/panel src/renderer/src/session src/renderer/src/side src/renderer/src/lane-b src/renderer/src/app src/renderer/src/tools/document test/support/tokens-guard.test.ts` |
   | M8 | `src/shared/maws src/engine-host/tool-server src/renderer/src/library test/support/tokens-guard.test.ts` |
   | M9 | `src/shared/ipc src/engine-host/documents src/endpoint test/endpoint src/renderer/src/library src/renderer/src/composer test/support/tokens-guard.test.ts` |
   | M10 | `src/shared/maws src/engine-host/tool-server src/engine-host/session-maws.test.ts` |
   | M11 | `src/artifacts/design-system` |

   Two files are generated, and nothing can generate them in the worktree. The generator runs on the VM and prints its diff, which the executor applies in the worktree as a patch, commits and pushes; then the check that holds the file runs on the pushed head. If the diff cannot be brought back whole, the executor stops and reports.

   - The probe snapshot `spikes/protocol-probe/scenarios/pass3/p4-maws-tools.json`, for a milestone that changes a tool's description, input or answer (M1, M2, M4, M8, M10):

         ~/.local/share/maws-ux-wave/tools/vmcheck.sh $BRANCH -- 'MAWS_WRITE_PROBE_TOOLS=1 timeout 300 pnpm exec vitest run src/shared/maws/search-tools.test.ts; git diff'
         ~/.local/share/maws-ux-wave/tools/vmcheck.sh $BRANCH -- 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'

   - The wire manifest `src/shared/ipc/wire-manifest.json`, for a milestone that adds a command (M4, M9), after `WIRE_MINOR` is moved in `src/shared/ipc/wire.ts`:

         ~/.local/share/maws-ux-wave/tools/vmcheck.sh $BRANCH -- 'timeout 300 pnpm wire:manifest; git diff'
         ~/.local/share/maws-ux-wave/tools/vmcheck.sh $BRANCH -- 'timeout 900 pnpm exec vitest run src/shared/machine src/shared/ipc'

3. **A milestone that edits `e2e/`** (M3, M5, M7, M11) typechecks the scenes and runs the gate's script tests; it starts no Electron:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh $BRANCH -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh $BRANCH -- 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

   Expected: both exit 0. A scene count a script test pins (a group's declared cases) is updated in the same commit as the scene.

4. **The last milestone of each pull request** (M3, M5, M7, M11), once, after its own checks and a final merge of master:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh $BRANCH -- 'timeout 1500 pnpm typecheck'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh $BRANCH -- 'timeout 900 pnpm lint'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh $BRANCH -- 'timeout 3600 pnpm test'

   Expected: exit 0, apart from the files the build brief lists as failing on master on the VM; a file that fails under the suite's load is run again alone and named in the hand-back. Then the pull request's own lines of "Acceptance", whose outputs go into Progress.

5. **Stop.** The executor hands back to the architect: the head's sha, what ran and its result, what is not verified, the decisions made, the scenes written and not run. It runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e.

## Interfaces and Dependencies

Exact strings below are decisions: tool texts are frozen (Constraint 4) and the agent reads them.

### §A. HTML: publish from a file, export as itself (M1)

**§A.1** In `src/engine-host/tool-server/artifact-context.ts`:

    // The .html source an agent names: relative to the working folder or absolute; .html or .htm; a regular file; at most ARTIFACT_MAX_BYTES.
    export function readHtmlSource(tool: ArtifactToolName, cwd: string, path: string): Promise<{ bytes: Buffer; name: string; source: string }>;

Its refusals are today's: `TOOL_ERRORS.artifactNotAFile`, `notHtml`, `tooLarge`. `artifact_create` calls it where its inline steps stand.

**§A.2** `ArtifactPublishInputSchema` (`src/shared/maws/tools.ts`): `files` becomes optional, `path: z.string().min(1).optional()` is added, and the schema's refinement requires exactly one of the two. The JSON schema's `required` becomes `['artifact', 'baseRevision']`. New refusals in `TOOL_ERRORS`:

    publishPathOrFiles: 'artifact_publish: give path or files, not both and not neither',
    publishPathHtmlOnly: (kind: string) => `artifact_publish: path publishes an html page; send files for a ${kind}`,

The description gains, directly after "(an html page is its one file, index.html)": ` For an html page, path (the .html file you wrote, absolute or relative to the working directory) publishes that file's bytes in place of files.`

**§A.3** `registerHtmlExporters` (`src/render/export.ts`) registers `html/html`: the stored file, copied unchanged. `artifact_export`'s description changes one clause: "Formats: pdf or png for an html page;" becomes "Formats: pdf, png or html (the stored page, unchanged) for an html page;". In `src/renderer/src/library/export.ts` the formats shown for kind `html` leave `html` out. "Save a copy…" is offered for kinds `file` and `html` in `ByteViewer.tsx` and `RowMenu.tsx`; it calls today's `saveArtifactCopy`.

**§A.4** Guides. `src/artifacts/types/dashboard/SKILL.md`, at the end of "When to use this kind": `A dashboard's views have no controls for the reader: a filter is fixed in each view's spec. When the user should filter or explore the data themselves, make an \`html\` page.` `src/artifacts/types/html/SKILL.md`, in "Reading and editing", after the sentence on `files`: `When you rebuilt the page as a file, pass \`path\` (that .html file) in place of \`files\`: its bytes become the new version.`

### §B. A document's page (M2, M3)

**§B.1** In `src/artifacts/document/meta.ts`, beside `dsOverrides`:

    export interface DocPage { size?: 'letter' | 'a4'; density?: 'compact' }   // absent: the system's page, standard density
    export function docPage(doc: Y.Doc): DocPage;                              // {} when absent; an unknown value of a field is read as absent
    export function setDocPage(doc: Y.Doc, page: DocPage, origin?: unknown): void;  // one transaction; an empty page removes the attribute

The attribute's key on the settings node is `page`.

**§B.2** The op, in `EditOpSchema` (`src/shared/maws/document-tools.ts`) and its twin `Op` (`src/artifacts/document/edit-ops.ts`):

    z.strictObject({ op: z.literal('set_page'), size: z.enum(['letter', 'a4', 'system']).optional(), density: z.enum(['standard', 'compact']).optional() })   // at least one of the two

`system` clears the size and `standard` clears the density; a field not given is left as it was. `Plan` (`edit-plan.ts`) gains `page?: DocPage`, the page the batch leaves when it holds a `set_page`; `applyEdit` (`patch-writer.ts`) writes when the plan touches a block or `page` is set, and writes the settings node in the same transaction. The op's result names what is in force after it: `{ op: 'set_page', size: 'letter' | 'a4' | 'system', density: 'standard' | 'compact' }`. Refusals, both of the whole batch:

    'artifact_edit: set_page: a dashboard has no page setting'
    'artifact_edit: set_page cannot be a suggestion; send it in a batch that is not suggested, or ask the user to set the page in the Export menu'

`artifact_edit`'s description gains one sentence, after its list of ops: ` set_page {size: letter | a4 | system, density: standard | compact} sets the page a document's exports print on (give at least one; a document only).`

**§B.3** `DocumentReadResult` gains, for a document (not a dashboard), on a live read and on a version read (the version's own): `page: { size: 'letter' | 'a4' | 'system'; density: 'standard' | 'compact' }`. `artifact_read`'s description gains, after "a document's structure": `(with its page setting)`.

**§B.4** Export. `ExportSource` (`src/artifacts/document/export/source.ts`) gains `page: DocPage`, read by `exportSource`. The size an export prints on is `options.pageSize ?? source.page.size`, handed to `pageOf`, which then falls to the system's page and to Letter as today. In `src/artifacts/document/export/design-system.ts`:

    export const COMPACT = { type: 0.9, space: 0.75, margin: '0.75in' } as const;
    export function exportDesign(system: ExportSystem | undefined, overrides: TokenOverrides, density?: 'compact'): ExportDesign;

With `density`, the design resolves over `{ ...compactOf(system), ...overrides }`: each `--ds-type-<role>-size` of the eight roles times `COMPACT.type`, each `--ds-space-<n>` times `COMPACT.space`, each in its own unit and rounded to two decimals, and `--ds-page-margin` set to `COMPACT.margin` when the system's is larger. `html.ts` and `docx.ts` pass `source.page.density`. Measured on the drawn memo, on the export as the next paragraph leaves it: Compact as written brings onto one page a memo that runs up to about nine lines over it; a memo ten lines over stays at two pages by 30.8 px, which type at 85 % and spacing at 60 % would fit (card 3).

The export's page takes the editor's spacing (L1). `pageCss` in `html.ts` gains one rule, which is the one place the other answer to card 9 changes:

    .ds-doc :where(p, h1, h2, h3, ul, ol, blockquote, table, pre) { margin-block: 0; }

at zero specificity, so the theme's gap rule (`.ds-doc .doc-content > * + *`) and every spacing token win as they do in the editor, where the app's base stylesheet removes the same margins. Its print block gains `.ds-doc :where(h1, h2, h3) { break-after: avoid; }` (L2). `ArtifactExportResultSchema` gains `pages: z.number().int().positive().optional()`, answered for `format: 'pdf'` from the exported file by a counter in the tool server:

    // The number of page objects in a PDF as Chromium writes it; null when none is found.
    export function countPdfPages(bytes: Uint8Array): number | null;   // counts /\/Type\s*\/Page(?![s\w])/g, the count e2e/document.spec.ts asserts today

`artifact_export`'s description gains, after "Returns the exported file's path;": ` a pdf's answer also names pages, its page count;`. The document guide (`src/artifacts/types/document/SKILL.md`) gains, after the sentence that fonts, colours, spacing and page size come from the system: `To fit a page, set the document's page with \`set_page\` and check the PDF's \`pages\`.`

**§B.5** The person's menu. `documentExports` in `src/renderer/src/tools/document/header.ts` answers, for a document: four format rows with no size ("Markdown (.md)", "Web page (.html)", "Word (.docx)", "PDF (.pdf)"), then three page items, "Letter", "A4", "Compact"; for a dashboard, today's six rows. `EditorHostExport` (`src/renderer/src/panel/editor-host.ts`) gains an optional `checked?: boolean`; an entry that has it is drawn by `ExportEntries` (`panel/PanelHeader.tsx`) as a checkbox item, after a separator; once any entry of a menu can be checked, every row of that menu keeps the check mark's room, so all labels start at one edge (L3). The rule: "Letter" or "A4" is checked when it is the size in force (the document's, else the system's page when that is one of the two); choosing an unchecked one writes it, except that choosing the one that equals the system's page removes the document's size; choosing the checked one does nothing. A document whose own overrides set the page's width or height to another size has neither checked; choosing one writes it and removes those two overrides in the same transaction (L4). "Compact" is checked when the density is compact; choosing it toggles. `DocumentTabState.export` sends a size only where the row carries one (a dashboard's rows) and, before it asks for the export, waits until the editor's provider reports no write the host has not acknowledged (`unsaved` in the provider's state), for at most `EXPORT_ACK_WAIT_MS = 5000`. If the provider is not connected, is refused, is disposed, or the wait ends first, nothing is exported and the export fails with one fixed sentence, shown where a failed export's message is shown today:

    exportNotSaved: 'Your last change to this document is not saved yet, so nothing was exported. Try again in a moment.'

### §C. The agent's delete and its undo (M4, M5)

**§C.1** The tool, last in `MAWS_TOOL_NAMES` and last in `mawsTools`' array (the order `tools/list` answers):

    artifact_delete { artifact: <id or handle> }  →  { status: 'deleted', artifactId, kind, title }
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
    title: 'Delete artifact'
    description: "Delete a MAWS artifact this session made and no longer needs, such as an abandoned draft; without this tool, ask the user to delete it in the Library. Only an artifact that this session, or the session a side thread was opened from, created and that only agents have written to; anything else is refused with the reason. The user can undo it from the transcript. Returns the deleted artifact's id, kind and title."

**The mark.** One key per agent-made artifact in the store's `meta` table, `agentDraft:<artifactId>`, whose value is the JSON of

    { by: string;                         // the creating session's actor key, 'session:<id>'
      seq: number;                        // the sequence of the last content row the mark accounts for; 0 before the first
      broken?: 'person' | 'unaccounted';  // set once and never cleared
      deleted?: { at: number; by: string } }   // set by the agent's delete, removed by the undelete

- *Written* in the batch that inserts an artifact whose `createdBy` is a session, with `seq: 0`.
- *Kept in step* in `appendInBatch` and `appendContentInBatch` (`storage.ts`), for a row of the artifact's own document or of its suggestion document, inside the row's batch. With N the document pair's newest sequence before the row: when `seq` is not N the mark becomes `broken: 'unaccounted'`; else when the row's actor is a person it becomes `broken: 'person'`; else `seq` becomes the row's sequence. An artifact with no key costs one lookup, which the store may hold in memory since the engine host is the store's one writer.
- *Stands* when it exists, is not broken, and `seq` equals the newest sequence of the document pair's rows now (0 when there are none).
- *Both older builds* never read or write the key (they read `meta` by key only). A write made under either leaves `seq` behind the newest row, which their pruning keeps as this build's does, so the mark does not stand after such a stay.

In `ArtifactStore`:

    // The agent's delete of its own draft. The rules run in the batch that sets deletedAt, in this order; the first that fails refuses.
    deleteOwnDraft(artifactId: string, lineage: readonly AppSessionId[], inFrame?: InFrame<void>): Promise<void>;

1. `createdBy` is a session of `lineage`. Otherwise `byUser` when a person created it, `otherSession` when another session did.
2. The mark stands. Otherwise `edited` when it is `broken: 'person'`, `unknown` when it is absent, `broken: 'unaccounted'`, or behind.
3. A design system that is another live artifact's own system is refused as `delete` refuses it (`designSystemInUse`).

Then it raises the fence (§C.5), does what `delete` does, and sets `deleted` in the mark. The refusals the agent receives, word for word, each followed by the refusal's JSON as every artifact refusal is, with the reason `invalid` and one more key, `why`, that the row reads (§C.4):

    deleteByUser: (title: string) => `artifact_delete: "${title}" was created by the user; ask them to delete it in the Library`,                              // why: 'byUser'
    deleteEdited: (title: string) => `artifact_delete: the user has edited "${title}"; ask them to delete it in the Library`,                                  // why: 'edited'
    deleteOtherSession: (title: string) => `artifact_delete: "${title}" was created by another session; ask the user to delete it in the Library`,              // why: 'otherSession'
    deleteUnknown: (title: string) => `artifact_delete: MAWS cannot tell that only agents have written to "${title}"; ask the user to delete it in the Library`, // why: 'unknown'

**§C.2** The command, engine-host owned, grade `manage`:

    'artifacts.undelete': host(z.strictObject({ artifactId: Id }), z.void())

`ArtifactStore.undelete(artifactId)`: a live artifact, success and no write; a deleted artifact whose mark holds `deleted`, the fence lowered, `deletedAt` cleared, `updatedAt` set, `deleted` removed from the mark, `created` announced; a deleted artifact without it, refused with the existing reason `invalid` and the sentence "this artifact was deleted in the Library, not by an agent"; an unknown id, `notFound`.

**§C.3** Over the machine link, by U9's rule for a later child's offer (its document, "How a later child inserts an offer"), these places and no others:

| place | what is added |
|---|---|
| `src/endpoint/offers.ts` | `'artifacts.undelete': { ...artifact('act'), owners: true }` |
| `src/endpoint/capabilities.ts` | `rl2.artifact-undelete`, appended, with its comment |
| `apps/org-protocol/src/channel.ts` | `RL2_PROTOCOL.minor` moved by one |
| `src/shared/ipc/remote-unavailable.ts` | `REMOTE_NEEDS['artifacts.undelete'] = 'rl2.artifact-undelete'`; `ACT_WORDS['artifacts.undelete'] = { act: 'restore', done: 'restored' }`; in `disabledWords`, beside Fork's line: `Only ${machine}’s owners can restore an artifact there.` when the standing says the member is not an owner |
| `src/shared/ipc/schema/host.ts` | the name in `ARTIFACT_OP_COMMANDS` |
| `src/main/lane-b/remote-artifacts.ts` | the name in `ARTIFACT_ACTS`; the act's `requires` read as `REMOTE_NEEDS[name] ?? 'rl2.artifacts'` |

Tests: `test/endpoint/artifact-rows.test.ts` (the row's exact shape; the artifact acts equal `ARTIFACT_OP_COMMANDS`), `src/engine-host/ops.test.ts` (the names, now fourteen), `test/lane-b/offer-coverage.test.ts` unchanged and green, `apps/org-protocol/test/messages.test.ts` (the minor), a row test at the endpoint for `owners-only` and `malformed`, and a device test that a peer whose handshake lacks the capability is sent nothing.

**§C.4** The row. `rows.ts`: the `artifact` row's `action` becomes `'create' | 'update' | 'delete'`, and a delete's row carries `why?: string`, read from the refusal's JSON. `classify.ts`: `artifact_delete` presents as `'artifact'`. The row of a delete takes `title` and `artifactId` from the tool's answer once it is in. `refusalForHuman` (`copy.ts`) strips the delete tool's prefix as it strips create's, update's and publish's. `copy.ts`, in `ARTIFACT`:

    deleting: (title: string) => `Deleting ${title}…`, deleted: (title: string) => `Deleted ${title}`, restored: (title: string) => `Restored ${title}`,
    couldNotDelete: (title: string, reason: string) => `Could not delete ${title}: ${reason}`, undo: 'Undo', notRestored: (sentence: string) => `Not restored: ${sentence}`

The reason the row draws, for the person, by `why`; a `why` it does not know is drawn as `refusalForHuman` leaves the agent's sentence:

| `why` | the row's reason |
|---|---|
| `byUser` | you made it. Delete it from the Library if you no longer need it. |
| `edited` | you have edited it. Delete it from the Library if you no longer need it. |
| `otherSession` | another session made it. Delete it from the Library if you no longer need it. |
| `unknown` | MAWS cannot tell that only agents have written to it. Delete it from the Library if you no longer need it. |
| a design system in use | it still styles other artifacts. Move them to another design system first. |

`TranscriptActions` (`transcript/view/context.tsx`) gains:

    // UX wave U10b: undo an agent's delete on the session's machine. Resolves null when the artifact is live again, else the sentence to show.
    undeleteArtifact?(appSessionId: AppSessionId, artifactId: string): Promise<string | null>;

implemented in `library/actions.ts` and registered in `App.tsx` beside `openArtifact`. It records the artifact's machine as `openArtifactInPanel` does (`sessionArtifactMachine`, `recordArtifactMachine`) and invokes `artifacts.undelete` there. The row view reads whether the artifact is live from `useLibraryRow(artifactId)` after the same record, and whether Undo can work from `useRemoteUnavailable(appSessionId, 'artifacts.undelete')`. Until the library has answered, Undo is drawn disabled. The sentence of a disabled Undo, and the sentence of an Undo that ended without its effect, are a line of the row under the heading. The heading wraps beside the icon in the room that is left; Undo and Open stand at the row's end, at least 24 px tall.

**§C.5** A deleted artifact takes no content, and what an open editor shows.

*The fence.* `DocumentService` is given `isDeleted(artifactId: string): boolean` by the store: true while the artifact's row holds `deletedAt` (so it holds across a restart of the engine host), and already from the start of a delete's batch, before the row is written; false again once an undelete has cleared it. It is asked with the main artifact's id for a suggestion document too. `content` refuses a frame for a deleted artifact before it checks or applies anything, with the reason `deleted: the artifact was deleted`, as it refuses with `storeTooNew:` for a read-only store; a replica's open of a deleted artifact's document is refused with the same reason. A refusal closes the connection; the provider keeps what was not acknowledged.

*The host's word.* `artifacts.get`'s answer gains one optional property, present only for an artifact that is deleted:

    deleted?: { title: string; kind: ArtifactKind; undoable: boolean }   // undoable: the mark holds `deleted` (an agent's delete)

*The notice.* Where `deleted.undoable` is true, `ArtifactView` and `RecordView` keep the editor they hold mounted, in the state each kind has for a reader who may only view, under a notice in the place today's notices of a held editor stand:

    deletedByAgent: 'An agent deleted this artifact. It takes no edits until it is restored.'      // with the button ARTIFACT.undo
    deletedUnsent: 'An agent deleted this artifact. Your last edit is not saved; restoring the artifact saves it.'   // while the provider holds an unacknowledged write

Undo here is the row's: the same action, the same disabled sentences (`disabledWords` for the artifact's machine), the same line for an act that ended without its effect. Where `deleted.undoable` is false, or the host answers no artifact at all, the views show today's "This artifact was deleted, or it is not in the library."

### §D. "Make something new" and the design-system choice (M8)

**§D.1** `ArtifactCreateInputSchema` gains `designSystem: z.string().min(1).max(200).optional()`. In `src/shared/maws/tools.ts`: `export const DESIGN_SYSTEM_KINDS = ['document', 'presentation', 'design', 'dashboard'] as const`. In the tool server, beside `spaceNamed`: `designSystemNamed(store, ref)`, with the refusals

    noDesignSystem: (ref: string, names: readonly string[]) => `artifact_create: no design system "${ref}"; the design systems are: ${names.join(', ')}`,
    designSystemAmbiguous: (ref: string, ids: readonly string[]) => `artifact_create: more than one design system is named "${ref}"; give one of these ids: ${ids.join(', ')}`,
    designSystemNotForKind: (kind: string) => `artifact_create: a ${kind} takes no design system`,

`artifact_create`'s description gains, after the sentence on `space`: ` Give designSystem (a design system's id or its name) to bind a document, presentation, design or dashboard to that system in place of the default; one that does not exist is refused.` (The description's length pinned in `tools.test.ts` moves with it.)

**§D.2** In `src/renderer/src/library/copy.ts`:

    export function askClaudePrefill(kind: ArtifactKind, spaceName?: string, systemName?: string): string;
    // `Make a document: ` · `Make a document in the Space “Work”: ` · `Make a document, in the design system “Classroom”: ` · `Make a document in the Space “Work”, in the design system “Classroom”: `

with today's article ("an" for an HTML page) and today's nouns. `systemName` is given only for a kind of `DESIGN_SYSTEM_KINDS` and a chosen system that is not the default. The section's labels: the cards "Document", "Presentation", "Dashboard", "Design", each with its kind's line from `KIND_BLURBS` as it stands today; the link "Blank"; the menu "More" with "Design system" (its two entries "Ask Claude" and "Blank"), "HTML page" and "Add a file…"; the choice's default entry `<name> · default`.

Fixed by the drawn page (L5), each said once:

- A card is a button, and "Blank" is a second button beside it at the card's upper right, a sibling in the markup; neither is inside the other. "Blank" is at least 24 px tall.
- The row: the four cards in columns that fill the row, none narrower than 200 px, wrapping when the row is narrower; More is the row's last cell, at its own width.
- More's menu opens under it, aligned to its right edge; the two entries of "Design system" open as a submenu on the menu's left side.
- The choice, while the design systems or the defaults are still being read, shows the words "Design system" muted and is disabled; a card pressed then starts its chat with no system in the opening words.
- While the Space the page is narrowed to is loading, each card and its "Blank" are disabled.
- Where the section shows: on All, on General and on a narrowed Space, as today; not on the list of all Spaces, on Pinned or during a search.

### §E. A Space's instructions (M9, M10)

**§E.1** The store. One key of `meta`, `spaceInstructions`, whose value is the JSON of `{ [spaceId]: { text: string; at: number } }`. `export const SPACE_INSTRUCTIONS_MAX = 8000` (characters), beside `SpaceSchema`'s file but not in it. Commands, engine-host owned, in `src/shared/ipc/schema/spaces.ts`, not in `OFFERS`:

    'spaces.instructions': host(z.strictObject({}), z.strictObject({ instructions: z.array(z.strictObject({ spaceId: z.uuid(), text: z.string(), at: z.number().int().nonnegative() })) }))
    'spaces.setInstructions': host(z.strictObject({ spaceId: z.uuid(), text: z.string().max(SPACE_INSTRUCTIONS_MAX) }), z.void())   // '' removes

A write announces `spaces.changed { spaceId, change: 'updated' }`. `ArtifactStore.spaceInstructions(spaceId): { text: string; at: number } | null` is what the tool server reads.

**§E.2** The renderer. `useSpaceInstructions(): ReadonlyMap<string, string>` in `library/store.ts`, read on this Mac and refreshed on `spaces.changed`; `setSpaceInstructions(spaceId, text)` in `library/actions.ts`. Copy, in `SPACE_COPY`: the menu item "Instructions…", directly after "Rename…"; the sheet's title, which quotes the name as the chip does, `Instructions for “${name}”`; its buttons "Cancel" and "Save"; the mark "Instructions", at least 24 px tall. The sheet's one line, which says who receives the text (F4) and replaces the section's:

    receivers: 'Every agent on this Mac that makes or opens an artifact in this Space is given these, and whoever can read its session can read them.'

The field (L6): eight lines tall at first, growing with its text to 40 % of the window's height, then scrolling. Save is enabled whenever the text differs from what is stored, the empty text included (it removes the instructions). The field takes at most `SPACE_INSTRUCTIONS_MAX` characters; a paste is cut there; from 7,500 characters a line under the field reads

    limit: (n: number) => `${n.toLocaleString('en-US')} of 8,000 characters`

**§E.3** The chip. `Prefill.pasted[k].name` is honoured: `available` in `composer/editor/recall.ts` names the atom by the prefill's name when it is given, else "Pasted text #n" as today. The chip then reads as a pasted chip reads: the name, then " +N lines"; a long name is cut with an ellipsis (L6). The card's prefill is the opening words followed by one pasted placeholder, with

    pasted: [{ name: `Instructions for “${space.name}”`, text: `Instructions of the Space “${space.name}”, set by the user in MAWS:\n${text}` }]

**§E.4** The tools. `ArtifactCreateResultSchema`, `ArtifactReadResultSchema`, `DocumentReadResult` and `ArtifactDescribeTypeResultSchema` gain `spaceInstructions?: { spaceId: string; name: string; text: string }`. `ArtifactDescribeTypeInputSchema` gains `space: z.string().min(1).max(200).optional()`, resolved by `spaceNamed`; with it and no `artifact`, the answer's `home` and design system are that Space's. `ArtifactSession` (`artifact-context.ts`) gains `instructed: Map<string, number>` (per Space, the `at` of the text given) and `forgetInstructed()`, which `SessionMaws.observe` calls on a `boundary.compaction` event. Description sentences: `artifact_describe_type`, after "without artifact this describes the default for a new artifact": ` Pass space (a Space's id or its name) to describe a new artifact in that Space.`; and at the end of `artifact_create`'s, `artifact_read`'s and `artifact_describe_type`'s: ` When the artifact's Space has instructions from the user, the answer carries them as spaceInstructions, the first time and again after they change: follow them for work in that Space.`

### §F. The chat over an artifact (M6, M7)

**§F.1** `useFloatingCard` (`src/renderer/src/shell/floating.ts`) gains `hidden: boolean` (meaningful only while `closed`) and `showChatTakesFocus: boolean`; `setClosed(false)`, and every reset of `closed`, clear `hidden`. New exports:

    export type ChatPresentation = 'card' | 'bar' | 'hidden';
    export const chatPresentation = (state: Pick<FloatingCardState, 'closed' | 'hidden'>): ChatPresentation;
    export function hideChat(): void;            // bar → hidden; "Show chat" takes the keyboard
    export function showChat(): void;            // hidden → bar; the bar's editor takes the keyboard (markFocusOnMount)
    export function showChatHeaderGone(): void;  // hidden → bar, the keyboard left where it is; a no-op in any other state

`openCard`, `closeCard`, `expandPane`, `focusSplitCard`, `togglePanelFloat` and `dockCard` keep their names and their acts: while the chat is hidden, the float control keeps its label and its act (it opens the card), and "Show chat" brings the bar (B7).

    // What the float over a side surface shows when another session's tab comes in front (card 8). Built: the presentation the person left.
    export function presentationForNewSession(left: ChatPresentation): ChatPresentation;   // 'keep' today: returns `left`

The bar publishes its height as the open card publishes its place (`rect` and `host` in the store), so that a scrolling artifact under it leaves that much room at its end (B6). The table, which is the section's with the two rows this document adds (the last two):

| from | by | to | the keyboard goes to |
|---|---|---|---|
| split | Expand pane | bar | the bar's editor |
| card | the card's Close | bar | Open conversation on the bar |
| bar | Open conversation; the session chosen in the sidebar or its tab (the split's float); ⇧⌘\; ⌥⌘B over a side surface | card | the card's composer |
| bar | Hide chat | hidden | Show chat in the header |
| hidden | Show chat | bar | the bar's editor |
| hidden | the session chosen in the sidebar or its tab (the split's float); ⇧⌘\; ⌥⌘B over a side surface | card | the card's composer |
| bar | a new request of that session (permission, question, plan, elicitation, dialog) | card | the card's composer if the keyboard was in the bar; otherwise where it was |
| hidden | a new request of that session | hidden | where it was |
| any | Dock, Restore split, the float ending | no float | as today |
| hidden | what the float sits over changes to something with no header for Show chat | bar | where it was |
| bar or hidden, over a side surface | another session's tab comes in front | what `presentationForNewSession` answers: the same presentation, for that session, until card 8 is answered | where it was |

**§F.2** Where Hide chat is offered: one hook in `src/renderer/src/shell/`, `useShowChatHeader(): boolean`, true for the panel's float always (the side column's controls are drawn), and for the split's float while the tab in front of the other pane registers a header (`useEditorHostRegistration` for its scope). The bar draws Hide chat only while it is true, and the float's layer calls `showChatHeaderGone` when it turns false.

**§F.3** The composer as a bar, in U4's folder. New `src/renderer/src/composer/frame/bar.ts`:

    export const ComposerBarContext = createContext(false);   // true inside the float's bar

`Composer` reads it and passes `bar` to `Frame`; `FrameProps` gains `bar?: boolean`. In a bar: the toolbar is mounted and hidden and `DraftShownContext` is false for it; the box takes the float's border and shadow; the dictation notice is drawn above the frame, as when a card is docked; the plugin's hint under the frame is not drawn. The predicate the three menu chords ask, which the composer registers on its focus target, becomes

    draftShown: () => !promptState.current.docked && !bar   // the menus' availability; whether the draft is usable stays `docked` alone

**The bar's measures** (B1 to B5, B8), in `shell/FloatingPill.tsx`: the box 420 px; the bar 484 px with both buttons, 452 px with one; 16 px from the right and the bottom; `--measure-pad: 0` on the region, so the composer's column has no side padding inside it. The two buttons are raised: the box's ground, the float's border and shadow. The raised surface for what stands above the box: from 8 px above the topmost thing down to the box, including it, with the box's radius and the float's edge, its content inset 8 px. The mark on Open conversation: at the button's upper right, outside the glyph; waiting before unread; one at a time.

**§F.4** Names the scenes and tests read: the bar's region `aria-label="Chat"`, with `data-pane="card"` and `data-compact-session` kept; the buttons' accessible names "Open conversation", "Hide chat", "Show chat"; `data-chat-presentation="bar"` on the region.

### §G. What this landing stores and sends, and what each older build does with it

"2c" is `2c7044231`, "F" is `f1852de3a`. "Read" means read in that build's source at that commit; "scene" is the cross-build scene that asserts it. Nothing in the layout or in either settings file changes in any of the four pull requests.

| value | pull request | what 2c and F do with what this build writes | what this build does with theirs | this build, then one of them, then this build | proof |
|---|---|---|---|---|---|
| `page` on a document's settings node | U10b-1 | Read: every reader of the node asks for `dsOverrides` only, and `setDsOverrides` replaces that attribute alone, so `page` is ignored and kept. Their exports print on the export's size or the system's, at standard density; their Export menu shows the six rows. An accepted suggestion there pairs units over every root's attributes and has no list that would drop an unknown one (read at both commits); the scene accepts one on each peer and reads the page back here | a document without `page` is the system's page at standard density | the setting is still there and still in force; a version made there pins it as any content | scene "(document page, both ways)", against both exact peers and on an equal wire |
| `artifact_edit`'s op `set_page` | U10b-1 | their tool servers refuse the op as invalid arguments; their agents are never told of it (the tool list is that build's) | — | — | read |
| `pages` in the export tool's answer | U10b-1 | not sent between processes: counted by this build's tool server in the file a render host of any build wrote | — | — | unit |
| the key `agentDraft:<id>` in `meta` (the mark of §C.1, with an agent's delete recorded in it), and a cleared `deletedAt` | U10b-2 | Read: `meta` is read by key only (`storage.ts`, identical at both), so the key is never seen, changed or removed. A deleted artifact is deleted there too; one this build undeleted is live there. `user_version` stays 4, so their stores stay writable. Any content row they append leaves the mark behind the artifact's newest row | an artifact they made has no key and is never deletable by an agent; one they deleted has no `deleted` in its key and cannot be undeleted | an agent's delete made here is still undoable after a stay on either; an agent's draft that was written to during the stay is no longer deletable by an agent | scene "(deleted draft, both ways)"; the unit case of M4 |
| the command `artifacts.undelete` | U10b-2 | as a machine: its endpoint answers `not-offered`, and this build's device sends nothing because the handshake lacks `rl2.artifact-undelete`; Undo is drawn disabled with "Can’t restore on <machine> yet…" | as a window of theirs on this build's machine: it never sends the command, and it draws an `artifact_delete` call as an ordinary tool call | — | device test; scene's gap check |
| `deleted` in `artifacts.get`'s answer | U10b-2 | as a window: an answer's unknown property is dropped before their strict reader sees it (remote answers and the engine host's are read tolerantly in both), so they show their own "deleted, or not in the library". As a host: they never send it, and this build's views then show that same notice, with no Undo | — | — | unit; read |
| the fence on a deleted artifact | U10b-2 | as a host: neither refuses a frame for a deleted artifact (the hole this build closes), so a replica of this build attached to their host can still write after a delete there, as today | — | — | read |
| the tool `artifact_delete` in a transcript | U10b-2 | they draw the call as a tool call of a server they know, with no row of its own | a transcript they recorded holds no such call | — | read |
| the key `spaceInstructions` in `meta` | U10b-4 | never read. A Space renamed there keeps its text; a Space deleted there leaves an entry that this build drops at its next write | no key: no Space has instructions | the text is there for every Space that still exists | scene "(space instructions, both ways)" |
| the commands `spaces.instructions`, `spaces.setInstructions` | U10b-4 | an engine host of theirs answers `unknown_command`; the window then shows no mark, and the sheet's Save fails with its sentence | — | — | unit; scene's gap check |
| a stored draft whose chip carries a name | U10b-4 | Read: a pasted atom's `name` is any string in both (a dropped text file already stores one); their composer opens the draft with the chip named as stored | — | — | scene, in "(space instructions, both ways)" |
| `designSystem` on `artifact_create`; `space` on `artifact_describe_type`; `path` on `artifact_publish` | U10b-4, U10b-1 | tool inputs, validated by the tool server of the build that listed them; nothing crosses builds | — | — | read |

**Wire.** U10b-2 and U10b-4 each add engine-host commands and so each move `WIRE_MINOR` by one (`src/shared/ipc/wire.ts`: a new command is additive, and so is the optional property U10b-2 adds to `artifacts.get`'s answer, in the same minor); U10b-2 also moves `RL2_PROTOCOL.minor` by one for its capability. Each minor is taken above whatever master holds at that pull request's own merge; master has moved since the pin and other landings will move it again. U10b-1 and U10b-3 add no command, no event and no property to any schema between processes, and move neither. No minor is taken for the gate's sake.

**The cross-build scenes** go in `e2e/cross-build.spec.ts` beside the existing stored-form scenes (the pattern is "(sidebar, both ways)"): each reads the stored form both ways first, skips only on a fact read from the peer's own source, and never skips on `sameWire`, so it runs when the two builds speak one wire. Each adds its row to the coverage table in that spec's header comment ("UC-14's coverage"), which has no artifact-store row today. Every one of the three asserts that the peer's `artifacts.status` is `ok`, not `readOnly`, after this build wrote: that is the proof that no migration was added. A stored form is owed against both exact peers whether or not a minor is taken (root UC-14; ruled 2026-11-15, F3), so all three run with `--peer-exact f1852de3a` and with `--peer-exact 2c7044231`. The two-build spec calls a `maws` tool through its `agent.call` helper today, which is how "(deleted draft, both ways)" makes an agent's draft and its delete.

### §H. Files other children own, and files several landings edit (root UC-8)

| file | owner | the insertion | milestone |
|---|---|---|---|
| `src/renderer/src/composer/frame/bar.ts` (new), `frame/Frame.tsx`, `Composer.tsx` | U4 | §F.3: the context, one prop, three conditions, and the bar in the registered `draftShown` | M7 |
| `src/renderer/src/composer/editor/recall.ts` | U4 | §E.3: a prefill's pasted name is kept. If the pasted chip's pressed area is under 24 px tall (L5), M9's executor reports it and does not change the chip, which is the composer's | M9 |
| `src/renderer/src/main/Pane.tsx` | U9 | "Show chat" in `TabHeader`'s controls, before Restore split | M7 |
| `src/renderer/src/panel/PanelHeader.tsx` | U8 | "Show chat" in `RegionControls`, before the float control (M7); a checkbox entry in `ExportEntries` (M3) | M7, M3 |
| `src/renderer/src/panel/editor-host.ts` | U8 | `checked?` on `EditorHostExport` | M3 |
| `src/renderer/src/transcript/model/classify.ts`, `derive.ts`, `rows.ts`, `schema.ts`, `copy.ts`, `serialize.ts`, `transcript/view/rows/Artifact.tsx`, `view/context.tsx`, `transcript.css` | per UC-3 | the `artifact` row's third action, §C.4 | M5 |
| `src/shared/maws/tools.ts`, `document-tools.ts` | per UC-15 | §A to §E's tool texts and schemas | M1, M2, M4, M8, M10 |
| `src/endpoint/offers.ts`, `capabilities.ts`, `src/shared/ipc/remote-unavailable.ts` | U9 | §C.3, by U9's own rule; U9 reviews | M4 |
| `apps/org-protocol/src/channel.ts`, `src/shared/ipc/wire.ts`, `wire-manifest.json`, `schema/host.ts`, the names, grades and routes tables | no child | the minors, the generated manifest, the registries' rows | M4, M9 |
| `src/main/lane-b/remote-artifacts.ts` | no child | §C.3's two lines | M4 |
| `src/render/export.ts`, `src/renderer/src/tools/document/`, `src/renderer/src/tools/artifacts/viewers/ByteViewer.tsx` | no child (the comment binding in `tools/document/comments.tsx` is U5's and is not edited) | §A.3, §B.5 | M1, M3 |
| `e2e/cross-build.spec.ts` | shared by the landings | three scenes and three rows of the coverage table | M3, M5, M11 |
| `src/renderer/src/session/SessionPane.tsx` | U1 | none: the bar cancels the composer column's side padding from its own region, through `--measure-pad` | — |
| `src/engine-host/documents/service.ts`, `storage.ts`, `src/renderer/src/library/ArtifactTab.tsx`, `src/renderer/src/shell/DocumentSessionSpace.tsx` | U10 | the fence and the mark's upkeep (M4); the deleted artifact's notice (M5); the room under the bar (M7) | M4, M5, M7 |
| `src/renderer/src/tools/artifacts/RecordView.tsx` | no child | the deleted artifact's notice in the side column's view (M5) | M5 |

U5a's insertions in U10's files (`reply` in `document-tools.ts` and `edit-plan.ts`, the pass in `tool-server/documents.ts`, the count rule, the flash, the guide's one clause) are on master; M2 edits `document-tools.ts`, `edit-plan.ts`, `documents.ts` and the document guide beside them and changes none of them.

### §I. Acts that await, and the test that holds each open

| act | awaits | the person acts meanwhile | it fails or never comes | test |
|---|---|---|---|---|
| publish from `path` | the file's read | — (a tool call) | refused before any write | M1 |
| the agent's delete | the store's batch | a person's write lands first: it breaks the mark and the delete is refused. One that arrives after is refused at admission and stays unacknowledged in that editor | the store's refusal, worded | M4, the replica held open on both sides of the delete |
| export after a page item | the host's acknowledgement of the write (at most 5 s), then the export | a second export is ignored while one runs, as today | the port down, a refused write, a disposed provider or the wait's end: the export fails with `exportNotSaved` and nothing is exported | M3, the port down while the export command answers; a provider that never acknowledges |
| the tool's `pages` | the exported file's read | — | the field is left out | M2 |
| Undo | `artifacts.undelete` here or over the link | Undo is disabled; a second press sends nothing | the sentence under the row; Undo enabled again; a link that drops mid-act ends with "Not restored: <machine> is offline" | M5 |
| the row's live state | the library's read | Undo is drawn disabled until it answers | an offline machine: "Deleted <title>" with Undo disabled and its sentence as a line of the row | M5 |
| an edit in an editor open on a deleted artifact | the host's acknowledgement, which does not come | the editor takes no further edit and shows the notice; Undo restores the artifact and the edit is sent | the tab closed while deleted: the unsent edit goes with the replica, as the notice said | M5 |
| a card of "Make something new" | the linked folder's project, then the session's creation | the card is disabled; moving to another tab opens the chat behind | today's toast | M8 |
| the sheet's Save | `spaces.setInstructions` | the buttons are disabled; closing the sheet does not cancel | the sentence in the sheet, the text kept | M9 |
| Show chat, Hide chat | nothing (state changes at the press) | a request arriving in the same tick is judged against the state the tick leaves | — | M6 |

### §J. The component canvas (M11)

In a new `src/artifacts/design-system/page/component-canvas.ts`:

    export const COMPONENT_CANVASES = [{ width: 960, height: 540 }, { width: 1120, height: 630 }, { width: 1280, height: 720 }] as const;
    export const CANVAS_SPARE = 8;                                            // px a component must leave free on the canvas it is given
    export const insetOf = (canvas: { width: number }) => canvas.width / 15;  // 64 px at 960
    // The canvas a bundled system's component is drawn on; a component the table does not name takes the largest.
    export function componentCanvas(systemId: string, componentPath: string): (typeof COMPONENT_CANVASES)[number];

The table behind `componentCanvas` names each component of the three bundled systems with the smallest canvas on which the margin boxes of the frame's children fit inside the canvas less the inset, with `CANVAS_SPARE` to spare. The scene of M11 computes the same for every bundled component from the frame's own document, loaded outside the sandbox at each canvas in turn, and fails when the table differs. `SlideFrame` takes `canvas` and scales by its client width over the canvas's width.


## Acceptance

The acceptance is the section's A3 to A10 as written there, read with the corrections of "Where the section no longer holds". "Unit" is run by the milestone's executor on the VM and again by class 1a. "Scene" is written by the milestone named and run by the architect on a Mac. Routes are in "Routes".

| item | proved by | milestone |
|---|---|---|
| A3: asked for a one-page memo, the agent sets the page, exports a PDF, and its answer names the page count; the Export menu shows the same size and "Compact" checked; the owner's own PDF has the same count | unit: `set_page` through the real document service (one row, the agent's), the read's `page`, the export's precedence and compact tokens, `countPdfPages`, the page CSS's margin rule. Scenes, new, in `e2e/document.spec.ts`: (1) an agent's `artifact_edit` with `set_page { size: 'a4', density: 'compact' }` on a memo that is two pages at standard density; `artifact_export` answers `pages: 1`; the window's Export menu shows "A4" and "Compact" checked; the menu's PDF, saved, has one page by the scene's own count; the scene attaches the standard and the compact PDF; (2) the spacing scene: the web-page export has the editor's gaps between the same blocks | M2, M3 |
| A4: the agent deletes a draft it made; one row, "Deleted <title>", with Undo; the Library no longer lists it; Undo brings it back and the row reads "Restored <title>"; an artifact the owner made or edited is refused with the reason; on another machine the row and Undo act there, and Undo is disabled with its sentence while that machine is offline. And by the rulings of 2026-11-15: a deleted artifact takes no content, and an editor open on it shows the deletion with Undo | unit: M4's mark, delete, fence and undo cases, each at the store's file; the row's cases; the route's cases. Scenes: in `e2e/maws-tools.spec.ts`, the nineteen tools and a refusal; in `e2e/library.spec.ts`, the row, the Library without the draft, Undo, the draft back, and a document open in a tab when the agent deletes it (the notice, a keystroke that changes nothing, Undo, the edit typed just before the notice saved); in `e2e/remote.spec.ts`, Undo on another machine's library and the disabled Undo with that machine stopped; in `e2e/cross-build.spec.ts`, the stay under each older build with a person's edit there, then the refusal here | M4, M5 |
| A5: publish by path (the call's input holds a path); the `html` export equals the published file byte for byte; "Save a copy…" in an HTML artifact's Export menu; asked for a dashboard the reader can filter, the agent makes an HTML page and says why | unit: M1's cases. Scenes: in `e2e/artifacts-store.spec.ts`, publish by path then export `html` and compare sha256; in `e2e/library.spec.ts`, "Save a copy…" in the row menu and in the viewer. The last clause is the guide's sentence, held by a unit case on the guide's text; what an agent then does is not proven by a scene (Proof, 10) | M1, M3 |
| A6: Expand leaves only the box at the lower right; its close control removes it; the header shows "Show chat", which brings the bar back with the keyboard in it; Open conversation brings the conversation back; a request while hidden leaves it hidden and takes no keyboard, "Show chat" carries the waiting mark, and the bar it brings back shows the one line "Waiting for you · N"; while the bar shows, a request opens the card; on all three routes and over a side surface | unit: §F.1's table case by case, the bar's drawing and measures, the two header controls, the chords. Scenes, in `e2e/panel.spec.ts`: the split's float over a document (Expand, the bar's parts by role and its width, Hide chat, Show chat and where the keyboard is, the same while the bar shows); the panel's float over a side surface; **the combined scene with U1b** (M7, decision 11), on a head that holds both, before U10b-3 lands; in `e2e/layout-transfer.spec.ts` the two cases that read the compact region. The terminal route and the other machine's are the bar showing what the pane shows, by unit cases over `SessionPane`'s compact branch with a holder notice and with a link that is not up | M6, M7 |
| A7: four cards and a More menu, one design-system choice in the heading; a card leaves the page for a new chat whose composer holds the opening words; with a system chosen, the artifact the agent makes is governed by it; "Blank" makes an empty artifact in that system and opens it | unit: M8's cases; the tool's `designSystem` through the real store (the new artifact's own system, the guide). Scene, in `e2e/library.spec.ts`: the four cards and More; a system chosen; a card clicked, the page left, the composer's words; "Blank" and the opened artifact naming the system (a deck's Theme panel, a document's breadcrumb: H25) | M8, M11 |
| A8: instructions written from the Space's menu; a chat started from that Space carries them as one chip; a session started elsewhere is given them in the tool's answer, once, and again only after the text changes or a compaction | unit: M9's and M10's cases, the compaction through the recorded frame. Scene, in `e2e/library.spec.ts`: the sheet, the mark, a card clicked, the chip in the draft by its name | M9, M10, M11 |
| A9: an agent's edits still appear live (l6-artifacts-02); every session MAWS launches still has `artifact_create` (l6-artifacts-03); a deck's history line reads as before (l6-artifacts-10) | `e2e/document-presence.spec.ts` and `e2e/presentations-history.spec.ts` as they stand, in each pull request's groups; `tools.test.ts`'s list still holds `artifact_create` first among the artifact tools | every pull request |
| A10: a type sample is whole in its cell; each component of the three bundled systems is legible and not clipped; the owner looks at the component cards on a Mac | unit: `DesignSystemPage.test.tsx` (each component's canvas from the table, the scale from the client width). Scenes, in `e2e/design-systems.spec.ts`: the title sample's cell at a narrow width has no horizontal overflow, with a Korean word broken inside it; every bundled component, measured outside the sandbox by §J's rule, is on the canvas the table names. The owner's look: Proof, 3 | M11 |

The last milestone of each pull request runs Concrete Steps 4 and its own lines below, and writes their output into Progress.

    # U10b-1 (M3): no migration, nothing between processes, nothing over the link
    git diff origin/master...HEAD --stat -- src/engine-host/documents/migrations.ts src/shared/ipc src/shared/artifacts/entity.ts src/endpoint apps/org-protocol src/shared/maws/instructions.ts
    # U10b-2 (M5): no migration, no entity field, no change to the endpoint's target rules or to the tab's state; exactly one offer added
    git diff origin/master...HEAD --stat -- src/engine-host/documents/migrations.ts src/shared/artifacts/entity.ts src/endpoint/targets.ts src/shared/maws/instructions.ts
    git diff origin/master...HEAD -- src/endpoint/offers.ts | grep -c "^+  '"
    # U10b-3 (M7): the renderer alone, and not U1's pane or the transfer
    git diff origin/master...HEAD --stat -- src/shared src/main src/engine-host src/services src/endpoint src/renderer/src/session/SessionPane.tsx src/renderer/src/shell/transfer.ts
    # U10b-4 (M11): no migration, no entity field, no offer
    git diff origin/master...HEAD --stat -- src/engine-host/documents/migrations.ts src/shared/artifacts/entity.ts src/endpoint/offers.ts src/shared/maws/instructions.ts

Expected: each `--stat` prints nothing; the count prints `1`.

## Proof that an executor does not run

Each line has an owner other than an executor.

| # | what | when | what it needs | what comes back |
|---|---|---|---|---|
| 1 | **The owner's answers to the eight cards** | before M3, M5, M7, M8, M9, M11; each builds its card's first option until the answer is in | "The look": the six pages are drawn and ruled on; the cards are with the owner | each answer changes the one place its card names |
| 2 | **The owner's look at a memo at two densities** | on the drawn page (done, with cards 3 and 9); on the built branch before U10b-1 lands | the two PDFs A3's scene attaches (an invented memo, standard and compact, Letter), and the spacing scene's verdict | the owner's word; a different number is `COMPACT` alone; the other answer to card 9 is one rule |
| 3 | **The owner's look at the component cards** (A10; closes two tracker rows) | before U10b-4 lands | the branch running on a Mac, a design system's page for each of the three bundled systems at three columns | the owner's word. A component that reads badly at the canvas reached is the declared-size route, a new item |
| 4 | **The owner's look at the bar and "Show chat"** | on the drawn page (done) | page 1 of "The look" | answers to cards 1, 7 and 8 |
| 5 | **The new and reworked scenes, alone** | after each pull request's last milestone | a Mac under the load rule. U10b-1: `e2e/document.spec.ts` (the export scene, A3's two) in `e2e:document-app`; `e2e/artifacts-store.spec.ts` in `e2e:artifacts`; `e2e/library.spec.ts` in `e2e:library`. U10b-2: `e2e/maws-tools.spec.ts` in `e2e:tools`; `e2e/library.spec.ts`; `e2e/remote.spec.ts` in `e2e:remote`. U10b-3: `e2e/panel.spec.ts` in `e2e:panel`, the combined scene with U1b on a head that holds both; `e2e/layout-transfer.spec.ts` in `e2e:default`. U10b-4: `e2e/library.spec.ts`; `e2e/design-systems.spec.ts` in `e2e:design-systems` | a verdict per scene; a red scene goes back as a fix |
| 6 | **The groups each change reaches** | after the scenes alone are green | U10b-1: `e2e:document-app`, `e2e:document`, `e2e:dashboard` (its export scene picks "PDF (.pdf)" and "Markdown (.md)", which a dashboard keeps; its exports are spaced as the editor's from M2 on, so any expectation there that rests on a block's height is read again), `e2e:artifacts`, `e2e:library`, `e2e:remote` (another machine's PDF export), `e2e:deliverables` (a replayed publish with `files`), `e2e:panel` (its Export › PDF scene), `e2e:tools`. U10b-2: `e2e:tools`, `e2e:deliverables` (the artifact row's replay), `e2e:library`, `e2e:remote`, `e2e:machines`, `e2e:transcript`; and, because every delete now raises the fence and every content row passes the mark's upkeep, the groups that write or delete artifacts: `e2e:document-app`, `e2e:document`, `e2e:dashboard`, `e2e:presentations`, `e2e:design`, `e2e:artifacts`, `e2e:design-systems`, `e2e:connectors`, `e2e:supervisor-daemon`. U10b-3: `e2e:panel`, `e2e:default`, `e2e:browser` (the chip, unchanged), `e2e:composer` and `e2e:side` (the composer's frame and the `/btw` card with the bar property off), `e2e:layout`, `e2e:document-app` (a document's room under the bar). U10b-4: `e2e:library`, `e2e:design-systems`, `e2e:tools`, `e2e:composer` (a prefill's chip), `e2e:document-app` (a document's create). `e2e:requests` and `e2e:discover` cross none of it and run on their own lane only | verdicts by group |
| 7 | **The cross-build runs** | after the last milestone of U10b-1, U10b-2 and U10b-4 | `scripts/ci-gate.sh "$PWD" --gates e2e:cross-build` in the background, twice for each of the three: `--peer-exact f1852de3a` and `--peer-exact 2c7044231`. A stored form is owed against both whether or not a minor is taken; U10b-1 takes none, and its scene runs on an equal wire without skipping. U10b-3 stores and sends nothing and owes none; its pull request says so with the `--stat` above | the runs' ids; a red is read against the same command on master |
| 8 | **The branch reviews** | after each last milestone | `doperpowers:review-code` at the rung "Size and review" names, with its lenses; U9 reads M4's insertions in its files | a verdict and findings; fixes are one wave through the controller |
| 9 | **U1b on master, then U10b-3** | before U10b-3 lands | a merge of the master that holds U1b into `ux-wave/U10b-3`, and M7's combined scene on that head | the scene's verdict; U10b-3's pull request names the head |
| 10 | **A paid live scene, allowed once** (ruled 2026-11-15, under the owner's standing answer for paid live groups) | once, at U10b-4's landing, on its final head | `e2e:library-live`, one new case: from the opening words with a chosen system and a Space with instructions, a real agent's `artifact_create` passes `designSystem` and its answer carries `spaceInstructions`. It is the only proof that an agent acts on the words | a verdict. A second paid run is a new question to the owner, unless the first failed for a harness reason that is named |
| 11 | **The deck stage at 1280 px with the bar** (l6-artifacts-04's owed look) | with U10b-3's Mac runs | a deck beside a session at a 1280 px window, Expand | a note; a fault is U14's item |
| 12 | **Class 1a** | once per pull request, on the head it will carry, after the review's fixes | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label <u10b-n>`, in the background | the run's id |

## The look

Two drawn examples of this wave found faults the text had missed, so every new or changed surface was drawn at real sizes before it is built. The six pages are drawn, printed and measured, outside the repository and with invented labels, titles and text (root UC-11); the architect ruled on what they found, and those rulings are folded into the milestones and the interfaces (the Decision Log names each). The window is 1440 × 900 unless a frame says otherwise.

**Page 1 · The chat over an artifact (M7).** Nine frames: the bar after Expand beside today's pill; the bar with two attached files and one waiting message over a dense page, on a raised surface and with nothing behind them (card 1); the bar with the line "Waiting for you · 2" and the waiting mark on Open conversation; hidden, with "Show chat" before Restore split, unmarked, unread and waiting; the chat floated over a side surface, "Show chat" before the float control; the bar of a terminal session that cannot be driven and of a session whose machine is offline; the bar over a main tab with no header; the bar with a long draft and the card it opens; a deck's stage at a 1280 px window with the bar. What it found: the bar's width was said two ways (B1); a bare glyph is lost over a page (B2); a notice in the box's place had no edge (B3); an offline machine's words had no place (B4); where the mark stands (B5); a document's last lines could not be read under the bar (B6); what the float control does while hidden (B7); the raised surface's exact reach (B8); that "Show chat" always has room for its words (B9, card 5 withdrawn).

**Page 2 · A memo at two densities (M2, M3).** One invented memo through the repository's own export stylesheet and the house system's tokens at Letter, at standard and compact, beside the editor's own layout of it; the same for one bundled system; the Export menu open. What it found: the export does not draw what the editor draws (L1, M1; card 9); a heading left alone at a page's foot (L2); labels that jump when a row is checked (L3); a document whose overrides set another size (L4); and how far Compact reaches once the export is the editor's (M2; card 3).

**Page 3 · The transcript's row for a delete, and the editor's notice (M5).** "Deleted Draft plan" with Undo; "Restored Draft plan" with Open; Undo disabled with its sentence as a line of the row; a refusal in the row's own words for the person (§C.4's table), where the first drawing showed the agent's sentence; the row in a folded turn; a long title. At the transcript's column width and in the 560 px card. And, added by the ruling on the review's second finding: a document open in a tab when an agent deletes it, with the notice "An agent deleted this artifact. It takes no edits until it is restored." and Undo; the same with an unsent edit; the same on another machine's artifact with Undo disabled and its sentence. What it found: a long heading broke the row (R1); the tool's name and "the user" reached the person (R2, R3); small pressed areas (R4); a disabled Undo explained only by a tooltip (R5).

**Page 4 · "Make something new" (M8).** The section narrowed to a Space at 1440 and at 1100 px; the choice open; More open; a card under the pointer; the cards disabled while the Space loads. What it found (L5): a button inside a button; descriptions cut in a narrow window; pressed areas; and four things the text had not said.

**Page 5 · A Space's instructions (M9).** The menu with "Instructions…"; the sheet empty and with twenty lines; the mark; the composer with the chip. What it found (L6): a sheet that grew past the window with Save out of view; where the item stands; what Save does with an empty text; the limit; the chip's own " +N lines".

**Page 6 · A design system's page (M11).** Each bundled component on today's canvas and on the three smaller ones; the tallest table; the title's sample in a narrow cell. What it found (L7): 960 × 540 does not hold two tables; the border's 2 px; the Korean word does break.

**Cards for the owner.** Eight, sent by the architect; each question stands on its own, and its first option is the one recommended and the one built until the owner answers otherwise. In order of consequence: 9, 1, 8, 3, 2, 4, 6, 7. Card 5 (the words or an icon for "Show chat" in a narrow side column) is withdrawn: while the chat floats, the side column fills the main area, and its first strip is never narrower than 588 px, where the words fit (B9).

1. **Over an artifact the chat shrinks to its box alone. When files are attached or a message is waiting to be sent, they are drawn above the box. What should be behind them?**
   - *One raised surface from the topmost of them down to the box, only while something is there (recommended).* The chips and the waiting message are readable over any page, and with nothing attached the bar is the box alone, as you asked.
   - *Nothing: each chip and row stands on the artifact.* The smallest footprint, but text over text is hard to read over a dense document.
   - *Always a surface around the box.* Steady, but it is the frame you asked to remove.
   - Place: the bar's wrapper in `shell/FloatingPill.tsx`.
2. **A document's Export menu will show its page: "Letter", "A4" and "Compact", with a check mark. How should the two sizes behave?**
   - *One of the two is checked whenever the page is Letter or A4, whether the document or its design system says so; choosing the other switches (recommended).* The menu always says what the PDF will be.
   - *A size is checked only when you chose it for this document; unchecked means "as the design system says".* Shows whose choice it is, but an unchecked menu does not say what will print.
   - Place: `documentExports` in `tools/document/header.ts`.
3. **"Compact" makes a document's exports tighter so that more fits a page: type at 90 %, the space between blocks at 75 %, page margins no wider than 0.75 in. Measured on the drawn memo: this brings onto one page a memo that runs up to about nine lines over; the drawn memo of ten lines over stays at two pages by 30.8 px. Is Compact right?**
   - *As drawn (recommended).*
   - *Tighter: type at 85 %, spacing at 60 %.* Fits the ten-line memo; small type on paper.
   - *Spacing only: type stays, spacing at 60 %.* Keeps the reading size; fits less.
   - Place: `COMPACT` in `src/artifacts/document/export/design-system.ts`.
4. **"Make something new" becomes four cards, each one button that starts a chat. What does a card show?**
   - *The kind's icon, its name, one line that says what it is for, and a small "Blank" link at the card's corner (recommended).* A first-time reader learns what a Design is; the row is about 96 px tall.
   - *The icon, the name and "Blank" only.* A shorter row; the one-line description moves to the tooltip.
   - Place: the card in `library/MakeSomethingNew.tsx`.
6. **A Space that has instructions shows a mark on its heading line. Which?**
   - *The word "Instructions", small and muted, which opens the sheet (recommended).* Says what it is without a legend.
   - *A small icon with the word in its tooltip.* Quieter; needs learning.
   - Place: the mark in `library/Rows.tsx` and `Library.tsx`.
7. **The bar has two small buttons: one opens the conversation, one hides the chat. Which glyphs?**
   - *The expand glyph the pane's header uses for "Expand pane", and a plain ×, as the card's own Close (recommended).* Both are glyphs you already read in this place. Its cost: the same expand glyph reads "Dock session" on the card that opens one click later.
   - *A chat bubble and a chevron pointing down.* Says "chat" and "put away". Both glyphs exist in the app already: the bubble is the comments glyph, and the chevron folds lists.
   - Place: the two buttons in `shell/FloatingPill.tsx`.
8. **You shrank or hid the chat over a side surface and then bring another session in front. How does that session's chat appear?**
   - *It stays as you left it (built until answered).* A bar stays a bar and a hidden chat stays hidden; "Show chat" carries the new session's mark.
   - *A bar stays a bar, and a hidden chat comes back as the bar.* The new session's box is always in reach.
   - *The card, as the plan's text says.* The new session's whole conversation opens over the surface each time.
   - Place: `presentationForNewSession` in `shell/floating.ts`.
9. **Today a PDF or web-page export of a document is about a quarter longer than the editor shows it, because the export keeps the browser's own gaps between blocks. Should a PDF's spacing match the editor's?**
   - *Yes: the export is spaced as the editor is (recommended, and built).* What you see is what prints; the drawn memo is one page instead of two; every existing document's export becomes shorter.
   - *No: keep today's wider gaps.* Existing exports keep their length; the editor stays no guide to the fit, and Compact's spacing does almost nothing.
   - Place: one rule in `pageCss` in `src/artifacts/document/export/html.ts`.

## The pull requests

Each is opened on the architect's word, not by an executor. Each body opens with the composite's path, the child id (U10, second landing, and which of its four pull requests), the parent pin `93905c9ef` and board ticket 595; names its items; names its class 1a run by id on the head it carries; names the branch review's verdict and what was done with each finding; says which scenes and groups ran and where; names its cross-build runs by id, or says why it owes none; names its residue; and ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and no other attribution.

The dated amendments each carries, where the ruling stands (the section's "Rulings reversed", with the corrections of this document):

| pull request | amendment | where |
|---|---|---|
| U10b-1 | "Amended <date> (UX wave, U10): the document's own page setting comes after the export call's choice and before the system's; the Export menu's size rows become the document's setting." And, beside it, one dated line: the exported page removes the browser's own block margins, so an export is spaced as the editor is (the owner's card of 2026-11-15, once answered). | P3-B Decision Log 43, `docs/doperpowers/plans/2026-10-12-p3-b-documents.md` |
| U10b-1 | one dated line each: `path` on `artifact_publish`; the op `set_page` and `page` in a document's read; `html` as an export format of an HTML artifact and `pages` in a PDF export's answer | charter X9, `docs/charter.md` |
| U10b-2 | one dated line: the tool `artifact_delete`, annotated destructive; undone by the command `artifacts.undelete` (not `artifacts.restore`, which is the version restore). The body also says, as its own line of residue closed: a deleted artifact refuses content frames and new replicas, for the person's delete in the Library too, where a replica still attached could write on before | charter X9 |
| U10b-3 | "Amended <date> (UX wave, U10; the owner's O-43): the compact composer is the bar alone, with Open conversation and Hide chat on it; hidden, the header shows Show chat, the place and the word of Claude Desktop 5.1231.2's hosted-artifact frame, where the worded button is behind server gates and the frame otherwise draws a labelled Chat toggle; a request that arrives while the chat is hidden leaves it hidden and marks Show chat. The presentation stays transient." (The section's sentence, with the one correction of fact from the citations above.) | P4 Decision Log 83, `docs/doperpowers/plans/2026-10-19-p4-smoothing.md` |
| U10b-4 | "Amended <date> (UX wave, U10): `artifact_create` takes `designSystem` (an id or a name) and binds the new artifact to it; the owner's choice on the Library page reaches the agent through it." | charter X9 |
| U10b-4 | "Decision Log 13 amended <date> (UX wave, U10; the owner's mark on l6-artifacts-08): four kinds are cards and the whole card asks Claude; Blank is a link; the other kinds are under More." | `docs/doperpowers/plans/2026-10-12-p3-l-library.md` |
| U10b-4 | one dated line each: `space` on `artifact_describe_type`; `spaceInstructions` in three answers | charter X9 |
| U10b-4 | X23: a Space's instructions are held beside the entity, in the store's `meta` table, and read and written by `spaces.instructions` and `spaces.setInstructions`; `SpaceSchema` is unchanged | the P3 interface ledger's X23 entry |

Tracker rows (`docs/tech-debt-tracker.md`), added by the pull request named and with no board ticket now:

1. (U10b-2) The agent's delete refuses a deck or a design the owner only opened, because opening still writes rows credited to the person there, which break the mark (H3). Closes with the rest of l6-artifacts-09.
2. (U10b-2) After an engine-host handover a side thread's lineage is empty, so it cannot delete a draft its parent made (H13). Closes when an adopted session is given its scope.
3. (U10b-2) A member who does not own a machine, with an editor open on an artifact an agent deletes there, sees the notice of an unreachable artifact and no Undo; their unsent edit is kept only while the tab stays open. Closes when a deleted artifact can be placed for a member, with H4.
4. (U10b-1) A machine of an older build stores a document's page and ignores it at export; this window's menu there shows the setting all the same (§G). Closes when no older build is a peer.
5. (U10b-1) A table that splits across pages does not repeat its header row (L2).
6. (U10b-4) The name of an instructions chip is not kept once the message is sent: the transcript shows "Pasted text #1". Closes with a name carried in the sent form, a composer item.
7. (U10b-4) A component of a design system that is not bundled is drawn on the largest canvas, unmeasured, because its frame is sandboxed (M11, decision 3). Closes with a size the canon declares, the route the section names.
8. (U10b-3) In the bar the three menu chords of the composer do nothing, and a plugin's hint is not drawn (H11). Closes on the owner's word if either is missed.
9. (U10b-3) A deck's Notes row stands under the bar; Hide chat clears it (B6).

Rows 195 and "364" (H26) close on the owner's look at the component cards (Proof, 3), through the board scripts, by the session that keeps them.

## Size and review

Counted from the code at the pin: the functions and tests each milestone changes, and the scenes it writes. "Files" counts source, tests, scenes and documents.

| milestone | source | tests | scenes | files |
|---|---|---|---|---|
| M1 | about 160 | about 270 | about 70 | about 17 |
| M2 | about 350 | about 590 | — | about 23 |
| M3 | about 240 | about 370 | about 270 | about 16 |
| **U10b-1** | **about 750** | **about 1,230** | **about 340** | **about 50** (about 2,300 lines) |
| M4 | about 480 | about 860 | about 60 | about 34 |
| M5 | about 330 | about 480 | about 300 | about 26 |
| **U10b-2** | **about 810** | **about 1,340** | **about 360** | **about 54** (about 2,500 lines) |
| M6 | about 130 | about 350 | — | 2 |
| M7 | about 300 | about 500 | about 270 | about 20 |
| **U10b-3** | **about 430** | **about 850** | **about 270** | **about 22** (about 1,550 lines) |
| M8 | about 290 | about 420 | — | about 12 |
| M9 | about 330 | about 480 | — | about 23 |
| M10 | about 220 | about 470 | — | about 11 |
| M11 | about 130 | about 150 | about 270 | about 13 |
| **U10b-4** | **about 970** | **about 1,520** | **about 270** | **about 53** (about 2,750 lines) |

The whole: about 2,960 lines of source, 4,940 of tests and 1,240 of scenes, about 9,100 in all, over about 175 files. Revision 2 added about 1,500 lines to the first writing's count: the mark and the fence in M4 (the largest part), the editor's notice in M5, the export's wait and spacing in M3, and the per-component canvas in M11.

What the counts rest on, for the largest: M2's planner (`apply` 56 lines, `targetsOf` 15, `Plan` 17, `applyEdit` 10), the edit tool (133) and the read tool (69), `exportDesign` (7) and `pageOf` (8) with their callers, and eight test files that pin page sizes. M4's `delete` (19 lines) beside which two methods stand; the mark's upkeep at the two appends in `storage.ts` and the fence at `content` and at a replica's open in `service.ts` (46 lines today), each with cases that hold a replica open, prune the log and read the store's file; seven registries with one row each; and five test files that pin the offer table. M7's `Pill` (about 45 lines) rewritten, `Frame` (20 lines of markup), and four test files of 172 to 660 lines in which about twenty cases name the pill. M8's `KindCard` (43 lines) and `MakeSomethingNew` (17) rewritten and nine cases of `Library.test.tsx`. M10's five tool paths (104, 89, 68, 69 and 29 lines).

**Review.**

| pull request | rung | why | lenses |
|---|---|---|---|
| U10b-1 | the xhigh panel | about 50 files; a new write to every document's shared content, and a change to how every document and dashboard export is spaced | the plan's all-or-none with an op that changes no block, and one row per write (U10a's constraint); what both older builds do with `page` (§G), restore and suggestions included; the export's precedence, the margin rule and the compact tokens across PDF, Word, web page and screenshot; the menu's write as the person's row, and the export's wait failing closed |
| U10b-2 | the xhigh panel | delicate: an agent's destructive tool, a fence on the path every document write takes, and an offer over the machine link (the root names U9's offers delicate) | the mark: every place a content row is appended keeps it, nothing but a session's accounted write advances it, and it survives a checkpoint, a prune and a stay under each older build; the fence's order with the delete and with a frame in flight, for both deletes, locally and over the link; the three rules in the store's batch; the offer bounded by the mark, and the sweep for promotions on the final diff; U9's rule followed place by place; the row's and the editor's state on each route |
| U10b-3 | `doperpowers:reviewer-high` | about 22 files in one area, nothing stored or sent; the risk is the keyboard's hand-offs | §F.1's table against the code, row by row, the request rule in the same tick included; every reader of `closed` outside the shell; the chords' predicate (no menu state changes in the bar); the combined scene with U1b; the insertions in U4's, U8's and U9's files at their smallest |
| U10b-4 | the xhigh panel | about 53 files across the store, the tool server, the composer and the Library | no migration and no entity change (§G), and what an older engine host answers; who receives a Space's instructions, said as it is; "once per session" across compaction, replay, linked reads and adoption; `designSystem`'s resolution and the kinds; the card's awaited start and the page left; the canvas table against its rule |

Class 1a on GitHub Actions is the gate of record for each.

## What was not verified, and what could not be settled

- The owner's look at the screenshot of the caret under a final chart (U10a's): the repository records the scenes green, not the look.
- Whether the history rail lists a revision that changes only the settings node, and what `sinceRevision` answers after one. M2's executor reads it; a page-only revision that the rail shows as an empty change is reported, not patched.
- Whether the kind adapters' forgotten state is rebuilt when an artifact comes back: read as lazy, not run. M4's undo case opens the restored document through the real service and edits it.
- **Could not be settled: the component canvas for a system that is not bundled.** The ruled rule measures a component, and the page cannot measure inside a sandboxed frame without loosening the sandbox, which the section declines. This document builds the rule as a table for the bundled systems, held by a scene, and the largest canvas for any other component (M11, decision 3; tracker row 7). If the rule is meant to hold for every system at run time, it needs a ruling on how the page may measure.
- **Could not be settled: each kind's read-only state for the editor's notice.** A document's editor has one (a reader who may only view). Whether a deck's, a design's and a dashboard's editors each have a state that takes no edit and still scrolls was not read; §C.5 states the contract, and M5's executor reports a kind that has none, where the fallback is that kind's body made inert under the notice.
- **Could not be settled: the pasted chip's pressed height.** It is the composer's chip (U4's); if it is under 24 px, M9's executor reports it and does not change it.
- Whether events wired in at an engine-host handover reach `SessionMaws.observe`; either answer is covered by M10's decision 5.
- What Claude Desktop draws beside its seated composer; the section's sentence that it was not traced stands.
- That no promotion exists was established by a sweep of the call patterns named under "Routes", not by an exhaustive read of every `bus.invoke` site.
- The sizes are counted from the functions and tests at the pin and from the review's and the drawn pages' additions; none is from a trial build.

## Surprises & Discoveries

- Observation: a migration of the artifact store cannot be used by this wave. A file whose `user_version` is higher than a build knows is opened read-only by that build, and every write there is refused.
  Evidence: `openStore` in `src/engine-host/documents/migrations.ts` (`if (version > known) … status: 'readOnly'`), byte-identical at `2c7044231` and `f1852de3a`; `register.ts` answers `storeTooNew`. Hence H2 and Constraint 5.
- Observation: the name the section gives the undo is already a command.
  Evidence: `'artifacts.restore'` in `src/shared/ipc/schema/artifacts.ts`, `{artifactId, versionId}`; `store.restore` restores a version. H1.
- Observation: a deleted artifact has no standing for anyone but the machine's owners.
  Evidence: `placeArtifact` in `src/endpoint/targets.ts` reads the library entry through `store.get`, which answers null once `deletedAt` is set; owners pass by `artifactShortCut` with no read. H4.
- Observation: a batch that changes no block writes nothing today.
  Evidence: `applyEdit` in `src/artifacts/document/patch-writer.ts`: the transaction opens only when `plan.tops.size > 0 || plan.actions.length > 0`. H6.
- Observation: the person's document export never used the design system's page.
  Evidence: `documentExports` in `src/renderer/src/tools/document/header.ts`: each of the six rows carries `pageSize`, Markdown included. H7.
- Observation: Claude Desktop's own "Show chat", pressed from its toast, opens the chat card, and its header control carries no mark for a waiting request.
  Evidence: `app-5.1231.2/web/app/v1/c293c7b4d-Cy2YBTrh.js:9985-9987`; `frame-shell-chrome-DV8q7Xxq.js:10116-10152`.
- Observation: the question on Korean typing was asked and answered before this landing started.
  Evidence: the register's answers table ("No, never seen it", 2026-11-14) and commit `22f9476fd`, which removed the tracker's row.
- Observation: nothing stored says durably that no person wrote to an artifact. A deletion alone binds no client; an accepted suggestion's copy is bound to the suggester; the person's log row is pruned once a later write follows.
  Evidence: `integrated` in `src/engine-host/documents/service.ts` binds only inserted clients; `writeCopy` credits the copy to the suggester; `pruneLog` in `storage.ts` keeps only each document's newest row. Found by the adversarial review; hence the mark of §C.1.
- Observation: a deleted artifact still takes edits from a replica that is attached.
  Evidence: `ArtifactStore.delete` closes no connection, and `content` in `service.ts` admits a frame without reading `deletedAt`. Found by the adversarial review; hence the fence of §C.5, for both deletes.
- Observation: the exported page is not spaced as the editor is. The export has no reset of the browser's block margins, so its gaps follow the type size; the drawn memo is 887.8 px tall in the editor's layout and prints at 1,120.3 px, on two pages. With the margins removed the PDF is the editor's layout to a tenth of a pixel.
  Evidence: `pageCss` in `src/artifacts/document/export/html.ts` against the app's base stylesheet; the drawn and measured page 2 of "The look". Hence §B.4's rule and card 9.
- Observation: 960 × 540 does not hold two of the bundled tables, and only 1,280 × 720 holds every bundled component.
  Evidence: the measured page 6 of "The look". Hence the per-component canvas of §J.
- Observation: the three menu chords of the composer ask a predicate the composer registers, not the context that hides the toolbar's popovers.
  Evidence: `draftShown: () => !promptState.current.docked` in `composer/Composer.tsx`, read by `toggleFocusedMenu` in `ComposerAppKeys.tsx`. Found by the adversarial review; hence §F.3's predicate.

## Decision Log

- Decision: the verification call. This document gets an adversarial review before any executor starts, dispatched by the architect. Each of the four branches gets `doperpowers:review-code` at the rung "Size and review" names: the xhigh panel for U10b-1, U10b-2 and U10b-4, `doperpowers:reviewer-high` for U10b-3. Class 1a on GitHub Actions is the gate of record for each pull request; the cross-build runs are the ones "Proof", 7 names.
  Rationale: three of the four are of panel size or delicate by the root's own list (an offer over the link); the fourth is one area with nothing stored or sent.
  Date/Author: 2026-11-15, the author of this document.

The rulings of 2026-11-15 (UTC), by the architect, after the adversarial review of the first writing (`56e90d508`; seven findings, all accepted) and the six drawn pages. Each line says what moved and where.

- F1 (review, P1): the agent's delete rests on a durable mark that fails closed, not on the log or the client bindings. §C.1 (the mark), M4 decisions 1 to 3 and its tests, §G, H3. Rejected: reading the log and `client_actors`, which lose the evidence.
- F2 (review, P1): a deleted artifact takes no content; an editor open on it shows the deletion, takes no edit and offers Undo. §C.5, M4 decision 5, M5 decisions 6 and 7, "The look" page 3, Routes (A4). It holds for the person's Library delete too. Rejected: leaving it as an unverified item because the person's delete behaves so today.
- F3 (review, P1): U10b-1 owes both exact peers; its scene runs on an equal wire and accepts a suggestion on each peer's side. §G, M3 decision 6, Proof 7.
- F4 (review, P2): a Space's instructions are said as they are: no command over the link reads or changes them, and whoever can read a session that received them can read them. No narrower policy. Routes, §E.2 (the sheet's line), M9 decision 3a, M10's test.
- F5 (review, P2): the bar joins the predicate the three menu chords ask. §F.3, M7 decision 5 and its tests, H11.
- F6 (review, P2): U10b-3 lands after U1b; the combined scene runs on a head that holds both; no temporary drawing of a request. "The cut", "Landings in flight", M7 decision 11, Proof 9.
- F7 (review, P2): an export after a page change needs the write acknowledged and otherwise fails with one sentence. §B.5, M3 decision 3 and its tests, §I.
- H1, H2, H4, H6, H7, H8, H9, H10 approved as written. H3 approved on top of F1. H5: the hint is added, nothing is claimed from it, no probe. H11 approved with F5. H12 becomes an owner's card (card 8), built at one place (`presentationForNewSession`).
- The further points approved as written: the tracker row for the page items on an older build's machine; the shared helper's offline sentence; the third refusal sentence; Open for any kind on the delete's row.
- The paid live scene: allowed once, at U10b-4's landing (Proof 10).
- The cut: four pull requests kept; the files more than one of them edits are listed, and each later one merges master first ("The cut").
- Master moved past the pin (`63c97b5c0`, `WIRE_MINOR` 48): not merged here; each minor is taken above what master holds at that pull request's merge (§G, Constraint 5).
- L1, M1 (page 2): the export's page removes the browser's block margins, so an export is spaced as the editor is; the built default of card 9; one rule. §B.4, M2 decision 7, M3's spacing scene.
- L2: headings take `break-after: avoid` in print; a split table's header row is a tracker row. §B.4, M2 decision 8.
- L3: the Export menu keeps the check mark's room on every row. §B.5. L4: a document whose overrides set another size has neither size checked, and choosing one replaces the override. §B.5, M3 decision 1.
- M2 (the memo's redraw): Compact's measured reach is stated, and card 3 carries the numbers; the built default stays as written. §B.4, card 3.
- L5 (page 4): the card and "Blank" are siblings, both disabled while the Space loads; descriptions are today's blurbs; the row wraps at a 200 px minimum; pressed areas of 24 px; the choice while loading, More's place and submenu, and where the section shows are each said once. §D.2, M8 decision 5, H23.
- L6 (page 5): the sheet's field grows to 40 % of the window and then scrolls; the title quotes the name; where "Instructions…" stands; Save with an empty text; the limit; the chip's own " +N lines". §E.2, §E.3, M9 decisions 3 to 5.
- L7 (page 6): the canvas is chosen per component among three, with 8 px to spare; "up to twice today's size"; the scale from the client width; the Korean word breaks, so no fallback. §J, M11.
- B1 to B8 (page 1): the bar's measures said once; raised buttons; the float's edge on whatever stands in the box's place; an offline machine's phase words; the mark's place and precedence; room at the end of a scrolling artifact; the float control's act while hidden; the raised surface's reach. §F.1, §F.3, M7 decisions 1 to 8.
- B9: card 5 withdrawn; "Show chat" is words at every width. M7 decision 7. B10: card 7's options described truly.
- R1 to R5 (page 3): a long heading wraps beside the icon; the tool's name never reaches the person; each refusal has an agent's sentence and a row's; pressed areas of 24 px; a disabled Undo's sentence is a visible line, and Undo is disabled until the library answers. §C.4, M5 decisions 1 to 4.

## Outcomes & Retrospective

Pending — written at finish.
